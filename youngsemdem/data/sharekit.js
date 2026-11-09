/*!
 * data/sharekit.js: the launch kit's machine-usable parts, EN + ES.   window.YSD_DATA.sharekit
 *
 * The human plan lives in docs/LAUNCH_KIT.md (30-day calendar, full video scripts with beats, the
 * Instagram carousel, Seminole Rewind, outreach, measurement). This file holds the parts pages
 * render as "copy this" buttons: 10 group-chat templates, 12 sticker phrases, 12 video-script
 * hooks with CTAs and captions, the Bring Three referral challenge copy, and the link/UTM scheme.
 *
 * REAL COPY, DEMO-AWARE (demo:false at file level). The facts are real and sourced (facts{}, each
 * with source + verified + confidence). Anything that depends on demo content (demo events, demo
 * counts, demo people, the demo squad) is flagged demo:true or carries a demoPrefix, and pages must
 * show "DEMO" visibly while YSD_CONFIG.demo === true. No real officers, no politicians as endorsers,
 * no candidate names or faces, no real businesses as hosts, no Native imagery or language.
 * There is no chatbot or AI feature anywhere in this kit.
 *
 * Load: classic script, after assets/js/config.js (and assets/js/share.js if you build links).
 * No modules, no fetches, no functions. Node check:
 *   node -e "global.window={};require('./data/sharekit.js');console.log(Object.keys(window.YSD_DATA))"
 *
 * CONVENTIONS (same as data/civic.js and data/issues.js)
 *  - Bilingual text is { en, es }. The Spanish is written for neutral Latin American readers
 *    (Puerto Rican, Cuban, Colombian, Venezuelan, Mexican), not translated word for word; same facts,
 *    same links. It still needs a fluent human reviewer before launch (reviewedSpanish: false).
 *  - Dates are ISO 8601 with the America/New_York offset (all of Dec 2026 and Jan 2027 is EST, -05:00).
 *  - Mail-ballot scope (binding, matches data/civic.js changes[mail-ballot-expiry]): requests made
 *    BEFORE the Nov 3, 2026 election run out Dec 31, 2026. Never write "every request runs out":
 *    under F.S. 101.62(1)(a) and the Division of Elections page, a request made after Nov 3 should
 *    already run through Dec 31, 2028. Seminole hasn't said how it handles those, so the December
 *    ask is "set a Jan 1 reminder" and "renew in January", never "you can't renew until Jan 1".
 *  - Spanish terms follow data/civic.js and Florida's Spanish forms: "solicitud de boleta por correo"
 *    (the request), "boleta por correo" (the ballot), "voto por correo" (the method), "inscribirse"
 *    (register), "identificación de estudiante", "Supervisor de Elecciones" / "la oficina electoral".
 *    The club is "los Young Dems" with the article, as in data/strings.js.
 *  - Placeholders: {url} (the final share link, always last), {result} (quiz result name in the
 *    reader's language), {event} {when} {city} (from a data/events.js item: title, when, cities[city]),
 *    {name} (first name), {n} (a number). Fill every placeholder or don't render the template.
 *  - Text is plain (render with textContent). No emoji in this file: social posts may add at most one
 *    at the end of a line (docs/research/05 section 6), never on tone:'calm' items.
 *  - tone: 'bright' | 'calm'. Calm = the serious template: no emoji, no exclamation marks, no
 *    confetti, no donate or dues module beside it (docs/research/05 principle 8).
 *  - Facts: items list factIds[] -> facts[id] = { claim{}, source, sources?, verified, confidence,
 *    audience ('public' | 'editor'), via?, computed?, note? }. confidence and editor facts are for
 *    editors; never render confidence. Show a "Sources" disclosure with source links if you like
 *    (labels.sources).
 *  - Visibility windows: showFrom / showUntil (ISO). Don't render outside them. after{} = replacement
 *    text from after.date on (like hookAfter in data/issues.js). variants[] carry their own windows.
 *  - requires: a condition an editor must confirm before the item goes live (e.g.
 *    'soe-2027-requests-open': an editor has checked that Seminole's online request form records new
 *    requests for the 2027-28 elections, on Jan 1 or when the Supervisor of Elections posts it).
 *    Pages: render items with `requires` only when YSD_CONFIG.sharekit?.confirmed?.[requires] === true
 *    (suggested config key; core may add it). Until then, skip them.
 *
 * LINKS AND ATTRIBUTION (matches assets/js/share.js and assets/js/config.js `share`)
 *  - Every item has link { page, hash?, query? }. page is a key of pages{}; Spanish pages live under
 *    esPrefix ('es/'), same file names; if es/ pages don't exist, use the EN page with ?lang=es.
 *    Hashes this file links to are listed in anchors{} so page builders create them. vote.html
 *    hashes are data/civic.js step ids ('renew-mail-ballot', 'what-id', 'register') plus 'dates',
 *    the same as data/issues.js anchors.vote. Events filters use ?series=<series> or ?kind=<kind>
 *    (data/quiz.js page-map note); there is no ?type= filter.
 *  - Build the share URL with YSD.share.url(path, params):
 *      path   = (lang === 'es' ? esPrefix : '') + pages[link.page] + (link.query ? '?' + link.query : '')
 *               + (link.hash ? '#' + link.hash : '')
 *      params = { utm_source: <channel code from utm.sources>, utm_medium: 'p2p',
 *                 utm_campaign: item.utm.campaign, utm_content: item.utm.content }
 *    share.js adds the member's ?ref=CODE automatically (my refCode) and fills any missing utm_*
 *    from config share.utm ({utm_source:'share', utm_medium:'social', utm_campaign:'youngsemdems'}).
 *    For a plain "Copy" button the destination is unknown: use utm_source 'share'. For the
 *    YSD.share.links() buttons use that network's key as the code (sms, whatsapp, x, threads, bluesky,
 *    facebook, email, telegram: the keys links() returns). Pass the same code as `channel` to
 *    YSD.share.native() so the 'share' track event
 *    and the UTM agree. Full scheme: utm{} below and docs/LAUNCH_KIT.md section 10.
 *  - pages.rewind is PROPOSED (no page yet): render its links only when the page exists, else
 *    fall back to proposedPages.rewind.fallback.
 *
 * TOP LEVEL (window.YSD_DATA.sharekit)
 *   version, demo, updated, verified, timezone, reviewedSpanish, reviewedByCounsel
 *   campaign{}       name{}, window{ start, end }, coda{ start, end }, note{}
 *   pages{}, esPrefix, anchors{}, newAnchors[] (hashes no other file asks for yet), proposedPages{}
 *   labels{}         UI chrome for "copy this" blocks
 *   utm{}            param rules, sources{}, mediums{}, campaigns{}, contentIds{}, terms, rules[], examples[]
 *   groupChat[]      GROUP CHAT TEMPLATE (10)
 *   stickers[]       STICKER (12) + stickerSpec{} + stickerSets{}
 *   scripts[]        SCRIPT HOOK (12)
 *   soundPresets{}   ids used by scripts[].sound
 *   referral{}       REFERRAL (the Bring Three challenge)
 *   facts{}          every fact the copy above relies on
 *   recheck{}        what to re-verify, and by when
 *
 * GROUP CHAT TEMPLATE
 *   { id 'gc01'..'gc10', use{} (one line: when to send it), audience{}, tone, text{} (ends with {url}),
 *     after?{ date, requires?, en, es } (from `date` on, show after.en/es instead of text; if
 *     after.requires is set and not yet confirmed, keep showing text), link{}, utm{ campaign, content }, channels[] (utm source codes it suits
 *     best), factIds[], placeholders[], demoPrefix?{} (prepend while the linked content is demo),
 *     showFrom?, showUntil?, placeholder? ('chapter-confirm' = relies on a policy the chapter hasn't
 *     confirmed: render it, keep it on the launch checklist), demoNote? (which linked part is demo:
 *     the item itself still renders in production), note? (editors) }
 *   No item in this file is demo:true (that flag would hide it when YSD_CONFIG.demo is false). Demo
 *   dependence is carried by demoPrefix (prepend while the linked content is demo) or demoNote.
 *
 * STICKER
 *   { id 'stk01'..'stk12', phrase{}, alt{} (screen-reader text for the image), visual{} (art brief),
 *     palette { fill, ink, accent } (Celery City Pop tokens from docs/research/03: ink, paper, violet,
 *     violet-deep, celery, sky, bubblegum; map to var(--ysd-<token>)), use[] ('stories' | 'chat' |
 *     'print' | 'card'), set ('starter' | 'friend' | 'pack'), place? (the real local thing it nods to),
 *     factIds[], safety (editor note), season?{ from, until } }
 *
 * SCRIPT HOOK  (full beats, timing, filming notes: docs/LAUNCH_KIT.md section 3)
 *   { id 'v01'..'v12', title{}, primaryLang ('en' | 'es'), format, lengthSec [min, max], tone,
 *     sound (soundPresets key), hook{ visual{}, line{} | null, onScreen{} } (first 1.5 seconds),
 *     cta{ line{}, onScreen{} }, caption{}, link{}, utm{ campaign, content }, factIds[],
 *     variants?[{ id, showFrom, showUntil, requires?, line{}, onScreen{} }] (a variant replaces
 *     hook.line and hook.onScreen inside its window; utm_content becomes '<id>-<variant id>'), safety{} }
 *
 * REFERRAL
 *   { id, name{}, tagline{}, window{ start, end, timeLabel{} }, evergreen, attribution{},
 *     steps[{}], counts{}, rewards[{ at, side ('inviter' | 'friend' | 'both'), badgeId?, stickerIds?,
 *     reward{}, costsMoney:false }], rules[{ id, text{} }], progress{ 0, 1, 2, 3, more } (use {n}),
 *     shoutout{ optIn{}, adult{}, teen{}, demo{} }, share{ text{} }, faq[{ q{}, a{} }], legal (editor) }
 *     badgeIds refer to data/levels.js badges ('plus-one', 'squad-of-three'); stickerIds to stickers[].
 */
window.YSD_DATA = window.YSD_DATA || {};
window.YSD_DATA.sharekit = {
  version: 1,
  demo: false,
  updated: "2026-11-09",
  verified: "2026-11-09",
  timezone: "America/New_York",
  reviewedSpanish: false,
  reviewedByCounsel: false,

  campaign: {
    name: { en: "Dec 31, handled", es: "El 31 de diciembre, bajo control" },
    window: { start: "2026-12-02T00:00:00-05:00", end: "2026-12-31T23:59:59-05:00" },
    coda: { start: "2027-01-01T00:00:00-05:00", end: "2027-01-03T23:59:59-05:00" },
    note: {
      en: "Day 1 is Wed, Dec 2, 2026; day 30 is Thu, Dec 31, when Florida mail-ballot requests made before the Nov 3 election run out. Seminole hasn't said how it treats requests made after Nov 3, so the December ask is: set a Jan 1 reminder, and renew in January. If launch moves, keep the date-locked posts on their dates.",
      es: "El día 1 es el miércoles 2 de diciembre de 2026; el día 30 es el jueves 31 de diciembre, cuando vencen las solicitudes de boleta por correo en Florida hechas antes de las elecciones del 3 de noviembre. Seminole no ha dicho cómo trata las solicitudes hechas después del 3 de noviembre, así que lo que pedimos en diciembre es: pon un recordatorio para el 1 de enero y renueva en enero. Si el lanzamiento se mueve, las publicaciones con fecha fija se quedan en su fecha."
    }
  },

  /** Page map (same keys as data/issues.js pages, plus the proposed rewind page). */
  pages: {
    home: "index.html",
    issues: "issues.html",
    quiz: "quiz.html",
    vote: "vote.html",
    events: "events.html",
    join: "join.html",
    clips: "clips.html",
    post: "post.html",
    rewind: "rewind.html"
  },
  esPrefix: "es/",
  /** Every hash this file links to, by page key. */
  anchors: {
    vote: ["renew-mail-ballot", "what-id", "register", "dates"],
    join: ["bring-three", "texts"],
    quiz: ["era", "issue"],
    events: ["creator-night-60-seconds", "renew-ready-party"]
  },
  /** Anchors no other data file asks for yet: page builders must add these ids. */
  newAnchors: ["join#bring-three", "join#texts", "quiz#era", "quiz#issue"],
  proposedPages: {
    rewind: {
      fallback: "home",
      showFrom: "2026-12-17T07:00:00-05:00",
      note: "Seminole Rewind (docs/LAUNCH_KIT.md section 8). Until rewind.html exists, link to the home page."
    }
  },

  labels: {
    copy: { en: "Copy", es: "Copiar" },
    copied: { en: "Copied. Paste it anywhere.", es: "Copiado. Pégalo donde quieras." },
    copyFailed: { en: "Couldn't copy that one. Press and hold the text to copy it.", es: "No se pudo copiar. Mantén presionado el texto para copiarlo." },
    send: { en: "Send it", es: "Enviar" },
    textsTitle: { en: "Texts you can copy", es: "Mensajes para copiar" },
    textsIntro: {
      en: "Written so they sound like you. Change any word you want before you send.",
      es: "Escritos para que suenen a ti. Cambia lo que quieras antes de enviarlos."
    },
    stickersTitle: { en: "Sticker pack", es: "Paquete de stickers" },
    scriptsTitle: { en: "Film one of these", es: "Graba uno de estos" },
    scriptHook: { en: "First 1.5 seconds", es: "Primer segundo y medio" },
    scriptCta: { en: "End on", es: "Termina con" },
    referralTitle: { en: "Bring Three", es: "Trae a tres" },
    demo: { en: "DEMO", es: "DEMO" },
    demoEvent: { en: "Demo event", es: "Evento de muestra" },
    sources: { en: "Where these facts come from", es: "De dónde salen estos datos" },
    lastChecked: { en: "Last checked {date}", es: "Revisado por última vez el {date}" },
    expected: { en: "Expected, not yet posted by the elections office.", es: "Previsto; la oficina electoral todavía no lo ha publicado." },
    unofficial: { en: "Unofficial until certified.", es: "Extraoficial hasta la certificación." }
  },

  // ------------------------------------------------------------------------------------- UTM
  utm: {
    refParam: "ref",
    refRule: {
      en: "ref = the member's referral code (letters, digits, _ or -, 2 to 32 characters, stored upper-case). share.js adds it to every link a member shares, ignores your own code, keeps the last code seen for 30 days (config share.attributionDays).",
      es: "ref = el código de invitación del miembro (letras, números, _ o -, de 2 a 32 caracteres, guardado en mayúsculas). share.js lo agrega a cada enlace que comparte un miembro, ignora tu propio código y guarda el último código visto durante 30 días (config share.attributionDays)."
    },
    params: ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"],
    /** utm_source = where the link physically sits. Same codes as YSD.share.native({channel}). */
    sources: {
      share: { label: "Unknown destination (copy button or the phone's share sheet). Matches config share.utm default." },
      tiktok: { label: "TikTok (our account, bio or a member's post)" },
      ig: { label: "Instagram: feed, Reels, Stories link sticker, DMs, bio" },
      x: { label: "X" },
      threads: { label: "Threads" },
      bluesky: { label: "Bluesky" },
      facebook: { label: "Facebook" },
      yt: { label: "YouTube Shorts" },
      sms: { label: "Text message, iMessage, RCS, group SMS" },
      whatsapp: { label: "WhatsApp" },
      telegram: { label: "Telegram" },
      email: { label: "The Thursday Letter or any email" },
      qr: { label: "A printed QR code (stickers, flyers, table tents)" },
      press: { label: "A news story or newsletter by someone else" },
      creator: { label: "A local creator's own post (unpaid)" }
    },
    /** utm_medium = who is doing the sharing. */
    mediums: {
      social: { label: "Our own account's post" },
      p2p: { label: "A member sending to friends: DMs, group chats, copy buttons" },
      print: { label: "Something printed (always with utm_source=qr)" },
      email: { label: "Email we send" },
      creator: { label: "A creator who isn't us" },
      press: { label: "Earned media" }
    },
    /** utm_campaign = the arc. Format YYYY-MM-<arc>. */
    campaigns: {
      "2026-12-launch": { label: "Launch week and evergreen hello posts", start: "2026-12-02", end: "2026-12-06" },
      "2026-12-renew": { label: "Mail-ballot requests run out Dec 31; set the Jan 1 reminder", start: "2026-12-02", end: "2026-12-31" },
      "2026-12-idrule": { label: "Student IDs stop counting at the polls Jan 1, 2027", start: "2026-12-02", end: "2026-12-31" },
      "2026-12-bring3": { label: "The Bring Three referral challenge", start: "2026-12-07", end: "2026-12-31" },
      "2026-12-rewind": { label: "Seminole Rewind, the year-end recap", start: "2026-12-14", end: "2026-12-31" },
      "2027-01-renewday": { label: "Renew day and the first days of the new rules", start: "2027-01-01", end: "2027-01-31" },
      "evergreen": { label: "Bio links, stickers and anything not tied to an arc" }
    },
    /** utm_content = the asset. Lowercase, digits and hyphens. */
    contentIds: {
      pattern: "<asset>[-<variant>]",
      assets: {
        "v01..v12": "short-video scripts (add -es for the Spanish cut, or the variant id: v01-this-week, v01-tonight, v01-renew-day, v01-new-year, v02-home-from-college)",
        "r1": "Seminole Rewind reel",
        "car1-s01..car1-s10": "Instagram launch carousel slide (link sticker or bio click that names a slide)",
        "car2": "Rewind carousel",
        "gc01..gc10": "group-chat templates",
        "stk01..stk12": "stickers (printed QR versions add utm_source=qr&utm_medium=print)",
        "txt-d01..txt-d30": "the daily text post on X, Threads and Bluesky (day number)",
        "story-d01..story-d30": "the Instagram Stories link sticker for that day",
        "ltr-YYYY-MM-DD": "a Thursday Letter issue",
        "bio": "link-in-bio",
        "bio-v01..bio-v12": "link-in-bio while that video is the pinned or latest post",
        "creator-<slug>": "a creator's own post (utm_source=creator&utm_medium=creator)",
        "referral": "the Bring Three share text"
      }
    },
    terms: {
      rule: "utm_term is optional and only ever a city slug, for printed QR placements and city-specific posts.",
      values: ["altamonte-springs", "casselberry", "lake-mary", "longwood", "oviedo", "sanford", "winter-springs", "unincorporated"]
    },
    rules: [
      "Lowercase letters, digits and hyphens only; 40 characters or fewer per value (share.js keeps up to 120).",
      "Never put a person's name, email, phone, school or city of residence in a UTM. The ref code is the only person-linked parameter, and it is pseudonymous.",
      "Don't add UTMs to the /go/* official short links (they redirect straight to official sites); count those in the host's redirect logs.",
      "Don't add UTMs to links that point at official sites (voteseminole.gov, registertovoteflorida.gov, dos.fl.gov).",
      "ActBlue links get refcode/refcode2 from YSD.share.actblue(), never utm_* by hand. No ActBlue or donation links on TikTok at all (TikTok bars political accounts from fundraising solicitation).",
      "One code per place: if a sticker sits on a Sanford coffee-shop corkboard, the QR is utm_source=qr&utm_medium=print&utm_campaign=evergreen&utm_content=stk05&utm_term=sanford."
    ],
    examples: [
      { what: "Member copies gc01 (renew reminder) and pastes it somewhere", params: "utm_source=share&utm_medium=p2p&utm_campaign=2026-12-renew&utm_content=gc01&ref=KIRA7QX" },
      { what: "Member taps the WhatsApp button under gc03 (family chat) on es/vote.html#renew-mail-ballot", params: "utm_source=whatsapp&utm_medium=p2p&utm_campaign=2026-12-renew&utm_content=gc03&ref=KIRA7QX" },
      { what: "TikTok bio link while V01 is pinned", params: "utm_source=tiktok&utm_medium=social&utm_campaign=2026-12-renew&utm_content=bio-v01" },
      { what: "Instagram Stories link sticker on day 16 (Rewind drop)", params: "utm_source=ig&utm_medium=social&utm_campaign=2026-12-rewind&utm_content=story-d16" },
      { what: "Printed sticker stk01 with QR, handed out in Oviedo", params: "utm_source=qr&utm_medium=print&utm_campaign=2026-12-renew&utm_content=stk01&utm_term=oviedo" },
      { what: "The Thursday Letter, Dec 31 issue, renew button", params: "utm_source=email&utm_medium=email&utm_campaign=2026-12-renew&utm_content=ltr-2026-12-31" }
    ]
  },

  // ------------------------------------------------------------------------------- GROUP CHAT
  groupChat: [
    {
      id: "gc01",
      use: { en: "The main one: requests made before Nov 3 run out Dec 31, so set a Jan 1 reminder.", es: "El principal: las solicitudes hechas antes del 3 de noviembre vencen el 31 de diciembre, así que toca poner un recordatorio para el 1 de enero." },
      audience: { en: "Friends, roommates, coworkers", es: "Amistades, compañeros de casa, compañeros de trabajo" },
      tone: "calm",
      text: {
        en: "Heads up: if you asked for a mail ballot before Nov 3, that request runs out Dec 31 (mine too). Renew in January and one request covers you through 2028. I set a Jan 1 reminder. Set yours: {url}",
        es: "Ojo: si pediste la boleta por correo antes del 3 de noviembre, esa solicitud vence el 31 de diciembre (la mía también). Renuévala en enero y una sola solicitud te cubre hasta finales de 2028. Ya puse un recordatorio para el 1 de enero. Pon el tuyo: {url}"
      },
      after: {
        date: "2027-01-01T00:00:00-05:00",
        requires: "soe-2027-requests-open",
        en: "New year, new mail-ballot request: the ones made before Nov 3 ended Dec 31. Renew once and you're covered for every election through 2028. Official link and how: {url}",
        es: "Año nuevo, solicitud nueva: las de boleta por correo hechas antes del 3 de noviembre vencieron el 31 de diciembre. Renueva la tuya una vez y te cubre en todas las elecciones hasta finales de 2028. Enlace oficial y cómo hacerlo: {url}"
      },
      link: { page: "vote", hash: "renew-mail-ballot" },
      utm: { campaign: "2026-12-renew", content: "gc01" },
      channels: ["sms", "whatsapp", "ig", "share"],
      factIds: ["mail-expiry", "mail-renew-jan1", "mail-covers-2028"],
      placeholders: ["url"],
      showUntil: "2028-03-10T00:00:00-05:00"
    },
    {
      id: "gc02",
      use: { en: "Student IDs stop counting at the polls on Jan 1, 2027. Uses the required wording.", es: "La identificación de estudiante deja de servir para votar el 1 de enero de 2027. Usa el texto obligatorio." },
      audience: { en: "Students, younger siblings, anyone who votes with a school ID", es: "Estudiantes, hermanos menores, cualquiera que vote con su identificación de estudiante" },
      tone: "calm",
      text: {
        en: "Passing this along: Starting Jan 1, 2027, Florida stops accepting student IDs at the polls (it's being challenged in court). Bring a driver's license, state ID or passport, and check voteseminole.gov before you go. More here: {url}",
        es: "Te paso esto: desde el 1 de enero de 2027, Florida deja de aceptar la identificación de estudiante para votar (la medida está impugnada en los tribunales). Lleva tu licencia de conducir, tu identificación estatal o tu pasaporte, y revisa voteseminole.gov antes de ir. Más información: {url}"
      },
      link: { page: "vote", hash: "what-id" },
      utm: { campaign: "2026-12-idrule", content: "gc02" },
      channels: ["sms", "whatsapp", "share"],
      factIds: ["student-id", "student-id-lawsuit"],
      placeholders: ["url"],
      note: "The sentence from 'Starting Jan 1, 2027' to 'before you go.' is required wording (docs/research/00). Keep it verbatim; the Spanish matches data/civic.js changes[student-id].copy.es (only 'desde' is lowercased after the colon). Re-check the court case before each send window (Dec 9, Dec 22, Dec 31, Jan 1)."
    },
    {
      id: "gc03",
      use: { en: "For the family chat, in whichever language your family texts in. Covers relatives outside Seminole too.", es: "Para el chat de la familia, en el idioma en que se escriben. Sirve también para familiares fuera de Seminole." },
      audience: { en: "Parents, aunts and uncles, grandparents, cousins", es: "Mamá, papá, tías y tíos, abuelos, primos" },
      tone: "calm",
      text: {
        en: "Family, quick heads-up: if you vote by mail in Florida and asked for your ballot before Nov 3, that request runs out Dec 31. In January, renew online or call your county elections office (Seminole: 407-585-8683). One request covers you through 2028. Details: {url}",
        es: "Familia, un aviso: si votan por correo en Florida y pidieron la boleta antes del 3 de noviembre, esa solicitud vence el 31 de diciembre. En enero, renuévenla en línea o llamando a la oficina electoral de su condado (Seminole: 407-585-8683), y quedan cubiertos hasta finales de 2028. Detalles: {url}"
      },
      after: {
        date: "2027-01-01T00:00:00-05:00",
        requires: "soe-2027-requests-open",
        en: "Family, quick heads-up: Florida mail-ballot requests made before Nov 3 ended Dec 31. If you vote by mail, renew now, online or by phone (Seminole: 407-585-8683, weekdays), and you're covered through 2028. Details: {url}",
        es: "Familia, un aviso rápido: las solicitudes de boleta por correo en Florida hechas antes del 3 de noviembre vencieron el 31 de diciembre. Si votan por correo, renuévenla ahora, en línea o por teléfono (en Seminole: 407-585-8683, de lunes a viernes), y quedan cubiertos hasta finales de 2028. Los detalles: {url}"
      },
      link: { page: "vote", hash: "renew-mail-ballot" },
      utm: { campaign: "2026-12-renew", content: "gc03" },
      channels: ["whatsapp", "sms", "share"],
      factIds: ["mail-expiry", "mail-renew-jan1", "mail-covers-2028", "mail-phone"],
      placeholders: ["url"],
      showUntil: "2028-03-10T00:00:00-05:00",
      note: "Default the language picker to Spanish when this template is shown on an es/ page."
    },
    {
      id: "gc04",
      use: { en: "Invite one friend to one event. Fill the placeholders from data/events.js.", es: "Invitar a una persona a un evento. Los espacios se llenan con data/events.js." },
      audience: { en: "The friend you'd actually go with", es: "La persona con quien de verdad irías" },
      tone: "bright",
      text: {
        en: "{event}, {when}, in {city}. First time? Perfect, that's the point. Come with me? {url}",
        es: "{event}, {when}, en {city}. ¿Primera vez? Perfecto, de eso se trata. ¿Vienes conmigo? {url}"
      },
      demoPrefix: { en: "(DEMO event) ", es: "(Evento DEMO) " },
      link: { page: "events", hash: "{eventId}" },
      utm: { campaign: "evergreen", content: "gc04" },
      channels: ["sms", "whatsapp", "ig", "share"],
      factIds: [],
      placeholders: ["event", "when", "city", "url"],
      note: "Link hash is the event id (events.html#<id>). Use the event's own share text from data/events.js when it has one; this template is the generic fallback. While events are demo, prepend demoPrefix."
    },
    {
      id: "gc05",
      use: { en: "After the organizer-era quiz: share your result.", es: "Después del quiz «¿Cuál es tu modo de organizar?»: comparte tu resultado." },
      audience: { en: "Group chat", es: "Chat del grupo" },
      tone: "bright",
      text: {
        en: "Took a quiz on what kind of organizer I'd be and got {result}. It knows me too well. What do you get? {url}",
        es: "Hice el quiz «¿Cuál es tu modo de organizar?» y me salió {result}. Me conoce demasiado. ¿A ti cuál te sale? {url}"
      },
      link: { page: "quiz", hash: "era" },
      utm: { campaign: "evergreen", content: "gc05" },
      channels: ["sms", "whatsapp", "ig", "share"],
      factIds: [],
      placeholders: ["result", "url"],
      note: "{result} = data/quiz.js organizerEra result name in the reader's language (e.g. 'The Spreadsheet Witch' / 'Magia en Celdas')."
    },
    {
      id: "gc06",
      use: { en: "The Bring Three ask, one friend at a time.", es: "La invitación de Trae a tres, una persona a la vez." },
      audience: { en: "One of your three", es: "Una de tus tres personas" },
      tone: "bright",
      text: {
        en: "I joined the Young Dems here in Seminole (under 40, good people, things to actually do). There's a Bring Three thing and you're one of my three. No pressure. Here's my link: {url}",
        es: "Me uní a los Young Dems aquí en Seminole (menos de 40 años, gente buena y cosas que hacer de verdad). Hay un reto que se llama Trae a tres y tú eres una de mis tres personas. Sin presión. Aquí está mi enlace: {url}"
      },
      link: { page: "join" },
      utm: { campaign: "2026-12-bring3", content: "gc06" },
      channels: ["sms", "whatsapp", "ig", "share"],
      factIds: [],
      placeholders: ["url"],
      showFrom: "2026-12-07T00:00:00-05:00",
      note: "The ref code in {url} is what makes the friend count. Don't render without YSD.share.url() building the link."
    },
    {
      id: "gc07",
      use: { en: "For the friend who isn't in any party (the biggest group of Seminole voters 18 to 40).", es: "Para la persona que no está en ningún partido (el grupo más grande de votantes de 18 a 40 en Seminole)." },
      audience: { en: "Independent and not-sure friends", es: "Amistades independientes o que no están seguras" },
      tone: "bright",
      text: {
        en: "You don't have to be a Democrat, or in any party, to come to a Young Dems event. Trivia nights, sunset walks, that kind of thing. Want to come with me sometime? {url}",
        es: "No hace falta ser demócrata, ni tener partido, para ir a un evento de los Young Dems. Noches de trivia, caminatas al atardecer, ese tipo de cosas. ¿Te animas a venir conmigo un día? {url}"
      },
      link: { page: "events" },
      utm: { campaign: "evergreen", content: "gc07" },
      channels: ["sms", "whatsapp", "ig", "share"],
      factIds: ["events-open", "npa-18-40"],
      placeholders: ["url"],
      placeholder: "chapter-confirm",
      note: "Relies on the draft event policy in data/events.js (policy.ages): open to everyone 14 and up, member or not, any party or none. The chapter must confirm it."
    },
    {
      id: "gc08",
      use: { en: "Pre-registration for 16- and 17-year-olds.", es: "Preinscripción para jóvenes de 16 y 17 años." },
      audience: { en: "Younger siblings, cousins, the parents of teens", es: "Hermanos menores, primos, mamás y papás de adolescentes" },
      tone: "bright",
      text: {
        en: "Know someone who's 16 or 17? Florida lets them pre-register to vote now, so they can vote in any election once they turn 18. Official link and how: {url}",
        es: "¿Conoces a alguien de 16 o 17 años? En Florida ya puede preinscribirse para votar, y así vota en cualquier elección desde que cumpla 18. El enlace oficial y cómo hacerlo: {url}"
      },
      link: { page: "vote", hash: "register" },
      utm: { campaign: "evergreen", content: "gc08" },
      channels: ["sms", "whatsapp", "share"],
      factIds: ["prereg-16"],
      placeholders: ["url"]
    },
    {
      id: "gc09",
      use: { en: "Recruit a member video (60 seconds, vertical, human-reviewed).", es: "Invitar a alguien a mandar un video (60 segundos, vertical, revisado por una persona)." },
      audience: { en: "The friend with opinions", es: "La persona del grupo que siempre opina" },
      tone: "bright",
      text: {
        en: "Got 60 seconds and an opinion about Seminole? The Young Dems post member videos, and a real person checks every one before it goes up. Film it vertical: {url}",
        es: "¿Tienes 60 segundos y algo que decir sobre Seminole? Los Young Dems publican videos de sus miembros, y una persona de verdad revisa cada uno antes de subirlo. Grábalo en vertical: {url}"
      },
      link: { page: "post" },
      utm: { campaign: "evergreen", content: "gc09" },
      channels: ["sms", "whatsapp", "ig", "share"],
      factIds: [],
      placeholders: ["url"],
      placeholder: "chapter-confirm",
      note: "Promises human review of every clip (docs/legal/MODERATION_POLICY.md, draft). Under-18s need guardian consent before a clip goes public (docs/legal/MINORS_POLICY.md)."
    },
    {
      id: "gc10",
      use: { en: "Share Seminole Rewind, the year-end recap.", es: "Compartir Seminole Rewind, el resumen del año." },
      audience: { en: "Anyone who was there, and anyone who should be next year", es: "Quien estuvo, y quien debería estar el próximo año" },
      tone: "bright",
      text: {
        en: "The Young Dems put Seminole's 2026 into nine cards. Tap through, then make your own: {url}",
        es: "Los Young Dems resumieron el 2026 de Seminole en nueve tarjetas. Míralas y luego haz la tuya: {url}"
      },
      link: { page: "rewind" },
      utm: { campaign: "2026-12-rewind", content: "gc10" },
      channels: ["sms", "whatsapp", "ig", "share"],
      factIds: [],
      placeholders: ["url"],
      showFrom: "2026-12-17T07:00:00-05:00",
      showUntil: "2027-01-31T23:59:59-05:00",
      demoNote: "The template itself is real. The Rewind page it links to carries DEMO numbers until the chapter supplies real 2026 counts; those cards must say DEMO.",
      note: "The template states no facts itself; the cards and their facts are in docs/LAUNCH_KIT.md section 8. It no longer names a 'favorite card': the sender hasn't seen them yet, and card 2 is an election result."
    }
  ],

  // ---------------------------------------------------------------------------------- STICKERS
  stickerSpec: {
    digital: "512 x 512 px PNG with a transparent background and a 16 px white keyline (reads on dark and light Stories). Export WebP copies for WhatsApp (check WhatsApp's current sticker FAQ for size limits before you ship).",
    print: "3 in die-cut, matte vinyl. QR versions put the code on a separate 2 in square sticker, black on white, with the short URL printed under it.",
    type: "Display type from docs/research/03 Pairing 1 (League Gothic) for phrases; body type only for Spanish accents that need it. Text is always ink on celery/sky/bubblegum/paper, or paper/celery on violet (all pass 4.5:1 in report 03).",
    never: "No Native American imagery, patterns, feathers or language. No candidate or officeholder names or faces. No school names, mascots or logos. No real business logos (SunRail's included). No Spotify-style or other brand look-alikes."
  },
  stickerSets: {
    starter: { en: "Everyone who joins gets these four.", es: "Todas las personas que se unen reciben estos cuatro.", ids: ["stk02", "stk06", "stk11", "stk12"] },
    friend: { en: "Unlocked for both people when a friend joins through your link.", es: "Se desbloquea para las dos personas cuando alguien se une con tu enlace.", ids: ["stk04"] },
    pack: { en: "The full pack of 12 unlocks at Bring Three.", es: "El paquete completo de 12 se desbloquea al completar Trae a tres.", ids: ["stk01", "stk02", "stk03", "stk04", "stk05", "stk06", "stk07", "stk08", "stk09", "stk10", "stk11", "stk12"] }
  },
  stickers: [
    {
      id: "stk01",
      phrase: { en: "Renew on Jan 1", es: "Renueva el 1 de enero" },
      alt: { en: "A torn calendar page reading JAN 1 with an envelope tucked behind it, and the words Renew on Jan 1.", es: "Una hoja de calendario arrancada que dice 1 ENE, con un sobre detrás, y las palabras Renueva el 1 de enero." },
      visual: { en: "Tear-off calendar page, big JAN 1 (ENE 1 on the Spanish version), a mail envelope peeking out from behind it.", es: "Hoja de calendario arrancada con un 1 ENE grande y un sobre asomándose por detrás." },
      palette: { fill: "celery", ink: "ink", accent: "violet" },
      use: ["stories", "chat", "print", "card"],
      set: "pack",
      factIds: ["mail-expiry", "mail-renew-jan1"],
      season: { from: "2026-12-02T00:00:00-05:00", until: "2027-03-01T00:00:00-05:00" },
      safety: "Time-bound: retire after Feb 2027. A 'Renewed through 2028' version would reward renewing a mail ballot: only with counsel's OK (see referral.legal), only for people who say they did it, and never ask for proof."
    },
    {
      id: "stk02",
      phrase: { en: "I know the deadline", es: "Yo sé la fecha" },
      alt: { en: "A speech bubble with a small alarm clock inside and the words I know the deadline.", es: "Un globo de diálogo con un despertador pequeño y las palabras Yo sé la fecha." },
      visual: { en: "Chunky speech bubble, a tiny wind-up alarm clock in the corner mid-ring.", es: "Globo de diálogo grueso con un despertador de cuerda sonando en la esquina." },
      palette: { fill: "violet", ink: "paper", accent: "celery" },
      use: ["stories", "chat", "print", "card"],
      set: "starter",
      factIds: [],
      safety: "Evergreen. The voice line of the whole brand (docs/research/05)."
    },
    {
      id: "stk03",
      phrase: { en: "Celery City Democrat", es: "Demócrata de Celery City" },
      alt: { en: "A celery stalk wearing sunglasses, with the words Celery City Democrat.", es: "Un tallo de apio con lentes de sol y las palabras Demócrata de Celery City." },
      visual: { en: "One confident celery stalk in round sunglasses, leaves like a fresh haircut.", es: "Un tallo de apio muy seguro de sí, con lentes de sol redondos y las hojas como corte de pelo recién hecho." },
      palette: { fill: "celery", ink: "ink", accent: "bubblegum" },
      use: ["stories", "chat", "print", "card"],
      set: "pack",
      place: "Sanford, nicknamed the Celery City",
      factIds: ["celery-city"],
      safety: "A nickname, not the City of Sanford's brand: no city seal or logo."
    },
    {
      id: "stk04",
      phrase: { en: "Bring a friend", es: "Trae a alguien" },
      alt: { en: "Two hands with pinkies linked, and the words Bring a friend.", es: "Dos manos con los meñiques entrelazados y las palabras Trae a alguien." },
      visual: { en: "Two hands, different skin tones, pinky promise, small hearts popping.", es: "Dos manos de distintos tonos de piel, promesa de meñique, corazoncitos saltando." },
      palette: { fill: "bubblegum", ink: "ink", accent: "violet" },
      use: ["stories", "chat", "print", "card"],
      set: "friend",
      factIds: [],
      safety: "Evergreen."
    },
    {
      id: "stk05",
      phrase: { en: "Ask me about my mail ballot", es: "Pregúntame por mi boleta por correo" },
      alt: { en: "A mail envelope with googly eyes and a small smile, and the words Ask me about my mail ballot.", es: "Un sobre con ojos saltones y una sonrisita, y las palabras Pregúntame por mi boleta por correo." },
      visual: { en: "A friendly envelope with googly eyes, waving a tiny flag that says ASK ME.", es: "Un sobre simpático con ojos saltones que agita una banderita que dice PREGÚNTAME." },
      palette: { fill: "sky", ink: "ink", accent: "violet" },
      use: ["stories", "print"],
      set: "pack",
      factIds: ["mail-expiry"],
      safety: "Whoever wears it should know the basics (requests made before Nov 3 run out Dec 31; renew in January; voteseminole.gov) or point people to the vote page."
    },
    {
      id: "stk06",
      phrase: { en: "First time? Perfect.", es: "¿Primera vez? Perfecto." },
      alt: { en: "A HELLO name tag that reads First time? Perfect.", es: "Una etiqueta de HOLA que dice ¿Primera vez? Perfecto." },
      visual: { en: "Classic HELLO name tag, the name line filled in by hand with the phrase.", es: "Etiqueta clásica de HOLA con la frase escrita a mano en la línea del nombre." },
      palette: { fill: "paper", ink: "ink", accent: "violet" },
      use: ["stories", "print", "card"],
      set: "starter",
      factIds: [],
      safety: "Evergreen. Hand these out at the door at every event."
    },
    {
      id: "stk07",
      phrase: { en: "Golden hour on Lake Monroe", es: "Hora dorada en el lago Monroe" },
      alt: { en: "A sun setting over a lake with sailboat masts in silhouette, and the words Golden hour on Lake Monroe.", es: "Un sol que se pone sobre un lago, con mástiles de veleros en silueta, y las palabras Hora dorada en el lago Monroe." },
      visual: { en: "Flat sunset over water, three sailboat masts from the Sanford marina in silhouette, no people.", es: "Atardecer plano sobre el agua, tres mástiles de veleros de la marina de Sanford en silueta, sin personas." },
      palette: { fill: "bubblegum", ink: "ink", accent: "violet-deep" },
      use: ["stories", "card"],
      set: "pack",
      place: "Lake Monroe and the Sanford Riverwalk",
      factIds: ["celery-city"],
      safety: "Pairs with the Golden Hour badge in data/levels.js."
    },
    {
      id: "stk08",
      phrase: { en: "The long game", es: "A largo plazo" },
      alt: { en: "A young cypress growing beside an old stump with tree rings, and the words The long game.", es: "Un ciprés joven que crece junto a un tocón viejo con anillos, y las palabras A largo plazo." },
      visual: { en: "A wide old stump with rings, a bright young cypress growing right beside it.", es: "Un tocón ancho y viejo con anillos y, justo al lado, un ciprés joven y brillante." },
      palette: { fill: "celery", ink: "ink", accent: "violet-deep" },
      use: ["stories", "print", "card"],
      set: "pack",
      place: "Big Tree Park, Longwood: The Senator and its clone, The Phoenix",
      factIds: ["senator-tree"],
      safety: "Pairs with The Long Game badge in data/levels.js. Don't draw the 2012 fire."
    },
    {
      id: "stk09",
      phrase: { en: "Took the train", es: "Llegué en tren" },
      alt: { en: "A commuter train with a heart-shaped headlight, and the words Took the train.", es: "Un tren de cercanías con el faro en forma de corazón y las palabras Llegué en tren." },
      visual: { en: "A generic two-level commuter train front, heart-shaped headlight. No SunRail logo or livery.", es: "El frente de un tren de cercanías genérico de dos pisos, con el faro en forma de corazón. Sin el logo ni los colores de SunRail." },
      palette: { fill: "sky", ink: "ink", accent: "bubblegum" },
      use: ["stories", "card"],
      set: "pack",
      place: "SunRail's four Seminole stations",
      factIds: ["sunrail-stations"],
      safety: "Generic train only: SunRail's name and look belong to SunRail."
    },
    {
      id: "stk10",
      phrase: { en: "Oviedo chicken energy", es: "Orgullo de gallo de Oviedo" },
      alt: { en: "A strutting rooster holding a tiny clipboard, and the words Oviedo chicken energy.", es: "Un gallo que camina orgulloso con una tablilla pequeña, y las palabras Orgullo de gallo de Oviedo." },
      visual: { en: "A proud rooster mid-strut, chest out, a tiny clipboard under one wing.", es: "Un gallo orgulloso a medio paso, pecho afuera, con una tablilla pequeña bajo el ala." },
      palette: { fill: "celery", ink: "ink", accent: "violet" },
      use: ["stories", "chat", "card"],
      set: "pack",
      place: "Oviedo's downtown chickens (local legend; mostly a memory now)",
      factIds: ["oviedo-chickens"],
      safety: "The Spanish is its own joke on purpose: 'gallina' reads as 'coward' in much of Latin America, so the Spanish sticker is a proud rooster (gallo). Treat the chickens as nostalgia, not a current fact."
    },
    {
      id: "stk11",
      phrase: { en: "Sent it to the group chat", es: "Ya lo mandé al chat" },
      alt: { en: "A phone showing a chat bubble with a check mark, and the words Sent it to the group chat.", es: "Un teléfono con un globo de chat y una palomita, y las palabras Ya lo mandé al chat." },
      visual: { en: "A phone tilted mid-wiggle, a chat bubble with a big check mark popping out.", es: "Un teléfono inclinado, moviéndose, con un globo de chat y una palomita grande saliendo." },
      palette: { fill: "sky", ink: "ink", accent: "violet" },
      use: ["stories", "chat", "card"],
      set: "starter",
      factIds: [],
      safety: "Evergreen. The reward sticker after any share."
    },
    {
      id: "stk12",
      phrase: { en: "Come as you are. Ven como eres.", es: "Ven como eres. Come as you are." },
      alt: { en: "Two overlapping speech bubbles, one in English and one in Spanish, saying Come as you are.", es: "Dos globos de diálogo superpuestos, uno en inglés y otro en español, que dicen Ven como eres." },
      visual: { en: "Two speech bubbles overlapping, one sky and one bubblegum, each carrying one language.", es: "Dos globos de diálogo superpuestos, uno celeste y otro rosa chicle, cada uno con un idioma." },
      palette: { fill: "paper", ink: "ink", accent: "sky" },
      use: ["stories", "chat", "print", "card"],
      set: "starter",
      factIds: [],
      safety: "Both languages on one sticker, full phrases (no token Spanish words)."
    }
  ],

  // ----------------------------------------------------------------------------------- SCRIPTS
  soundPresets: {
    "voice-only": "Your own voice, no music. Best for facts and dates.",
    "library-low": "A calm instrumental from the audio library the account actually has in the app (organization and business accounts often get only the commercial library), kept well under your voice. No lyrics.",
    "trend-licensed": "A trending sound only if it's in the account's in-app library, has no lyrics that fight the message, and is still under a week past its peak. Never rip audio from another video or a song you'd have to name.",
    "room-tone": "No music at all, just natural room sound. Use for calm topics; captions do the work."
  },
  scripts: [
    {
      id: "v01",
      title: { en: "The expiration date", es: "La fecha de vencimiento" },
      primaryLang: "en",
      format: "talking head + prop",
      lengthSec: [20, 25],
      tone: "bright",
      sound: "voice-only",
      hook: {
        visual: { en: "Hold an envelope with a hand-drawn EXP 12/31 sticker right next to your face.", es: "Sostén junto a tu cara un sobre con un sticker hecho a mano que diga VENCE 31/12." },
        line: { en: "Your mail-ballot request has an expiration date.", es: "Tu solicitud de boleta por correo tiene fecha de vencimiento." },
        onScreen: { en: "Mail-ballot requests from before Nov 3 expire Dec 31", es: "Las solicitudes de boleta por correo de antes del 3 de nov. vencen el 31 de dic." }
      },
      cta: {
        line: { en: "The reminder and the official link are in my bio. Send this to whoever you vote with.", es: "El recordatorio y el enlace oficial están en mi perfil. Mándaselo a quien vota contigo." },
        onScreen: { en: "Set a Jan 1 reminder · link in bio", es: "Pon un recordatorio para el 1 de enero · enlace en el perfil" }
      },
      caption: {
        en: "Asked for a Florida mail ballot before Nov 3? That request runs out Dec 31. Renew in January and one request covers you through 2028. Reminder and official link in bio.",
        es: "¿Pediste la boleta por correo en Florida antes del 3 de noviembre? Esa solicitud vence el 31 de diciembre. Renuévala en enero y una sola solicitud te cubre hasta finales de 2028. Recordatorio y enlace oficial en el perfil."
      },
      link: { page: "vote", hash: "renew-mail-ballot" },
      utm: { campaign: "2026-12-renew", content: "v01" },
      factIds: ["mail-expiry", "mail-renew-jan1", "mail-covers-2028"],
      variants: [
        {
          id: "this-week",
          showFrom: "2026-12-28T00:00:00-05:00",
          showUntil: "2026-12-31T00:00:00-05:00",
          line: { en: "This Thursday night, mail-ballot requests from before Nov 3 run out.", es: "Este jueves por la noche vencen las solicitudes de boleta por correo hechas antes del 3 de noviembre." },
          onScreen: { en: "Thu, Dec 31: requests from before Nov 3 run out", es: "Jueves 31 de dic.: vencen las solicitudes de antes del 3 de nov." }
        },
        {
          id: "tonight",
          showFrom: "2026-12-31T00:00:00-05:00",
          showUntil: "2027-01-01T00:00:00-05:00",
          line: { en: "Tonight, mail-ballot requests from before Nov 3 run out.", es: "Esta noche vencen las solicitudes de boleta por correo hechas antes del 3 de noviembre." },
          onScreen: { en: "Tonight: old requests run out. Tomorrow: renew.", es: "Esta noche vencen. Mañana: renueva." }
        },
        {
          id: "renew-day",
          showFrom: "2027-01-01T00:00:00-05:00",
          showUntil: "2027-01-03T00:00:00-05:00",
          requires: "soe-2027-requests-open",
          line: { en: "Renew day. Mail-ballot requests from before Nov 3 ended last night.", es: "Hoy toca renovar. Las solicitudes de boleta por correo de antes del 3 de noviembre vencieron anoche." },
          onScreen: { en: "Renew now: covers you through 2028", es: "Renueva ya: te cubre hasta finales de 2028" }
        },
        {
          id: "new-year",
          showFrom: "2027-01-03T00:00:00-05:00",
          showUntil: "2027-03-01T00:00:00-05:00",
          requires: "soe-2027-requests-open",
          line: { en: "New year, new mail-ballot request.", es: "Año nuevo, solicitud nueva." },
          onScreen: { en: "Old requests ended Dec 31. Renew once, covered through 2028.", es: "Las anteriores vencieron el 31 de dic. Renueva una vez y te cubre hasta 2028." }
        }
      ],
      safety: { en: "Don't show your real ballot, voter record or address on camera.", es: "No muestres en cámara tu boleta real, tu registro de votante ni tu dirección." }
    },
    {
      id: "v02",
      title: { en: "Student IDs stop counting Jan 1", es: "La identificación de estudiante deja de servir el 1 de enero" },
      primaryLang: "en",
      format: "hands-only tabletop (no face needed)",
      lengthSec: [18, 22],
      tone: "calm",
      sound: "room-tone",
      hook: {
        visual: { en: "Hands only: slide a sample card marked STUDENT ID (SAMPLE) onto a table. No real school names or logos.", es: "Solo manos: desliza sobre la mesa una tarjeta de muestra que diga ID DE ESTUDIANTE (MUESTRA). Sin nombres ni logos de escuelas reales." },
        line: { en: "Starting Jan 1, 2027, Florida stops accepting student IDs at the polls.", es: "Desde el 1 de enero de 2027, Florida deja de aceptar la identificación de estudiante para votar." },
        onScreen: { en: "Jan 1, 2027: student IDs stop counting at Florida polls", es: "1 de enero de 2027: la identificación de estudiante deja de servir para votar en Florida" }
      },
      cta: {
        line: { en: "It's being challenged in court. Bring a driver's license, state ID or passport, and check voteseminole.gov before you go.", es: "La medida está impugnada en los tribunales. Lleva tu licencia de conducir, tu identificación estatal o tu pasaporte, y revisa voteseminole.gov antes de ir." },
        onScreen: { en: "Bring a driver's license, state ID or passport · check voteseminole.gov", es: "Lleva licencia, identificación estatal o pasaporte · revisa voteseminole.gov" }
      },
      caption: {
        en: "Starting Jan 1, 2027, Florida stops accepting student IDs at the polls (it's being challenged in court). Bring a driver's license, state ID or passport, and check voteseminole.gov before you go. Details in bio.",
        es: "Desde el 1 de enero de 2027, Florida deja de aceptar la identificación de estudiante para votar (la medida está impugnada en los tribunales). Lleva tu licencia de conducir, tu identificación estatal o tu pasaporte, y revisa voteseminole.gov antes de ir. Detalles en el perfil."
      },
      link: { page: "vote", hash: "what-id" },
      utm: { campaign: "2026-12-idrule", content: "v02" },
      factIds: ["student-id", "student-id-lawsuit"],
      variants: [
        {
          id: "home-from-college",
          showFrom: "2026-12-14T00:00:00-05:00",
          showUntil: "2027-01-01T00:00:00-05:00",
          line: { en: "Home from college for break? This one's for you. Starting Jan 1, 2027, Florida stops accepting student IDs at the polls.", es: "¿Volviste de la universidad por vacaciones? Esto es para ti. Desde el 1 de enero de 2027, Florida deja de aceptar la identificación de estudiante para votar." },
          onScreen: { en: "Home for break? Your student ID stops counting at the polls Jan 1", es: "¿De vacaciones en casa? Tu identificación de estudiante deja de servir para votar el 1 de enero" }
        }
      ],
      safety: { en: "Calm template: no jokes, no trending sound, no emoji. Required wording, verbatim. Don't list other accepted IDs from memory; point to voteseminole.gov.", es: "Tono sereno: sin chistes, sin sonido de moda, sin emoji. Texto obligatorio, palabra por palabra. No enumeres de memoria otras identificaciones válidas; remite a voteseminole.gov." }
    },
    {
      id: "v03",
      title: { en: "Seminole went blue (for governor)", es: "Seminole votó azul (para gobernador)" },
      primaryLang: "en",
      format: "green screen over your own simple graphic",
      lengthSec: [20, 25],
      tone: "bright",
      sound: "library-low",
      hook: {
        visual: { en: "Point up at a big text card: SEMINOLE: BLUE (for governor). Your own county-outline graphic, no candidate photos or names.", es: "Señala un letrero grande: SEMINOLE: AZUL (para gobernador). Un gráfico propio con la silueta del condado, sin fotos ni nombres de candidatos." },
        line: { en: "Seminole County voted blue for governor on Nov 3.", es: "El condado de Seminole votó azul para gobernador el 3 de noviembre." },
        onScreen: { en: "Seminole voted blue for governor (unofficial until certified)", es: "Seminole votó azul para gobernador (extraoficial hasta la certificación)" }
      },
      cta: {
        line: { en: "Next up: city elections. Oviedo votes Nov 2, 2027, and Lake Mary and Altamonte Springs are expected to. Smaller races, fewer voters, more say for each one. Link in bio.", es: "Lo que sigue: elecciones municipales. Oviedo vota el 2 de noviembre de 2027, y se espera que Lake Mary y Altamonte Springs también. Contiendas más chicas, menos votantes, más peso para cada voto. Enlace en el perfil." },
        onScreen: { en: "Next: Nov 2, 2027 city elections · link in bio", es: "Lo próximo: municipales del 2 de nov. de 2027 · enlace en el perfil" }
      },
      caption: {
        en: "Seminole went blue for governor on Nov 3: about 54% to 45% here in unofficial returns, while the state went the other way by less than 2 points. Next up: 2027 city elections. Link in bio.",
        es: "Seminole votó azul para gobernador el 3 de noviembre: cerca de 54% frente a 45% aquí, según resultados extraoficiales, mientras en el estado ganó el otro partido por menos de 2 puntos. Lo que sigue: las elecciones municipales de 2027. Enlace en el perfil."
      },
      link: { page: "join" },
      utm: { campaign: "2026-12-launch", content: "v03" },
      factIds: ["gov-seminole", "gov-statewide", "city-2027-oviedo", "city-2027-expected"],
      safety: { en: "No candidate names or faces (results are facts, not endorsements). After certification, swap in the official figures and drop 'unofficial'. Pride, not gloating. A city race with one qualified candidate comes off the ballot (it happened to Oviedo's seats in 2025), so re-check the 2027 dates before posting.", es: "Sin nombres ni caras de candidatos (los resultados son datos, no respaldos). Después de la certificación, usa las cifras oficiales y quita 'extraoficial'. Orgullo, sin burlas. Si en una contienda municipal se postula una sola persona, sale de la boleta (pasó con los puestos de Oviedo en 2025), así que revisa las fechas de 2027 antes de publicar." }
    },
    {
      id: "v04",
      title: { en: "The biggest group isn't a party", es: "El grupo más grande no es un partido" },
      primaryLang: "en",
      format: "talking head + props",
      lengthSec: [18, 22],
      tone: "bright",
      sound: "voice-only",
      hook: {
        visual: { en: "Three paper cups labeled DEM, REP and NO PARTY. The NO PARTY stack is the tallest.", es: "Tres vasos de papel con las etiquetas DEM, REP y SIN PARTIDO. La torre de SIN PARTIDO es la más alta." },
        line: { en: "The biggest group of Seminole voters 18 to 40? Not Democrats. Not Republicans.", es: "¿El grupo más grande de votantes de 18 a 40 años en Seminole? No son los demócratas. Tampoco los republicanos." },
        onScreen: { en: "Biggest group of Seminole voters 18-40: no party (NPA)", es: "El grupo más grande de votantes de 18 a 40 en Seminole: sin partido" }
      },
      cta: {
        line: { en: "You don't need a party to come to our events. Find one, link in bio.", es: "No necesitas partido para venir a nuestros eventos. Busca uno en el enlace del perfil." },
        onScreen: { en: "Any party or none · events in bio", es: "Con partido o sin partido · eventos en el perfil" }
      },
      caption: {
        en: "Among Seminole's active voters aged 18 to 40, no-party (NPA) voters are the biggest group, about 34% (our math from the Supervisor of Elections' July 2026 counts). Our events are open to anyone 14 and up, any party or none. Link in bio.",
        es: "Entre los votantes activos de 18 a 40 años en Seminole, los que no tienen partido son el grupo más grande, cerca del 34% (cálculo nuestro con las cifras de julio de 2026 del Supervisor de Elecciones). Nuestros eventos están abiertos a cualquier persona desde los 14 años, con partido o sin partido. Enlace en el perfil."
      },
      link: { page: "events" },
      utm: { campaign: "2026-12-launch", content: "v04" },
      factIds: ["npa-18-40", "events-open", "closed-primaries"],
      safety: { en: "Say 'biggest group', never 'most': 34% is a plurality, not a majority. Invite, don't scold.", es: "Di 'el grupo más grande', nunca 'la mayoría': 34% no es más de la mitad. Invita, no regañes." }
    },
    {
      id: "v05",
      title: { en: "POV: the friend who knows the deadline", es: "POV: la persona que se sabe la fecha" },
      primaryLang: "en",
      format: "screen recording of a made-up group chat",
      lengthSec: [12, 15],
      tone: "bright",
      sound: "trend-licensed",
      hook: {
        visual: { en: "Made-up group chat on screen, labeled 'skit, names are made up'. First bubble: 'wait our mail ballots EXPIRE??'", es: "Un chat inventado en pantalla, con la nota 'parodia, nombres inventados'. Primer mensaje: 'espera, ¿¿nuestras boletas por correo VENCEN??'" },
        line: null,
        onScreen: { en: "POV: you're the friend who knows the deadline", es: "POV: eres la persona del grupo que se sabe la fecha" }
      },
      cta: {
        line: { en: "(Last bubble) 'the requests do, if we asked before nov 3. they end dec 31. renew in jan and it covers us thru 2028. reminder link below'", es: "(Último mensaje) 'las solicitudes sí, si las pedimos antes del 3 de nov. vencen el 31 de dic. se renuevan en enero y cubren hasta 2028. el recordatorio está abajo'" },
        onScreen: { en: "Be that friend · texts to copy in bio", es: "Sé esa persona · mensajes para copiar en el perfil" }
      },
      caption: {
        en: "Every group chat needs one. Mail-ballot requests from before Nov 3 run out Dec 31; renew in January. Copy-paste texts in English and Spanish, link in bio.",
        es: "Todo chat necesita a alguien así. Las solicitudes de boleta por correo hechas antes del 3 de noviembre vencen el 31 de diciembre; se renuevan en enero. Mensajes para copiar en inglés y en español, enlace en el perfil."
      },
      link: { page: "join", hash: "texts" },
      utm: { campaign: "2026-12-renew", content: "v05" },
      factIds: ["mail-expiry", "mail-renew-jan1", "mail-covers-2028"],
      safety: { en: "Fake chat built in a mockup tool, never a real screenshot. No real names or numbers. The 'skit' label stays on screen.", es: "Chat falso hecho con una herramienta de maqueta, nunca una captura real. Sin nombres ni números reales. La nota de 'parodia' se queda en pantalla." }
    },
    {
      id: "v06",
      title: { en: "How Seminole are you?", es: "¿Qué tan de Seminole eres?" },
      primaryLang: "en",
      format: "quiz-show talking head",
      lengthSec: [25, 30],
      tone: "bright",
      sound: "library-low",
      hook: {
        visual: { en: "Game-show energy: tap a desk bell (or a pen on a mug) as the first question pops up.", es: "Ambiente de concurso: toca una campanita (o un bolígrafo contra una taza) mientras aparece la primera pregunta." },
        line: { en: "Which Seminole city is nicknamed after a vegetable?", es: "¿Qué ciudad de Seminole tiene apodo de verdura?" },
        onScreen: { en: "How Seminole are you? 3 questions, no googling", es: "¿Qué tan de Seminole eres? 3 preguntas, sin googlear" }
      },
      cta: {
        line: { en: "Three out of three? You'd crush our trivia night. Zero out of three? Come anyway, we'll put you on a team.", es: "¿Tres de tres? Arrasarías en nuestra noche de trivia. ¿Cero de tres? Ven igual, te armamos un equipo." },
        onScreen: { en: "Our events · link in bio", es: "Nuestros eventos · enlace en el perfil" }
      },
      caption: {
        en: "Sanford is the Celery City (celery was first planted there in 1896). The Senator, Big Tree Park's cypress, was about 3,500 years old when it burned in 2012; a clone called The Phoenix grows there now. And Seminole has 4 SunRail stations. How'd you do?",
        es: "Sanford es la Celery City (allí se sembró apio por primera vez en 1896). The Senator, el ciprés de Big Tree Park, tenía unos 3,500 años cuando se quemó en 2012; ahora crece ahí un clon llamado The Phoenix. Y Seminole tiene 4 estaciones de SunRail. ¿Cómo te fue?"
      },
      link: { page: "events" },
      utm: { campaign: "2026-12-launch", content: "v06" },
      factIds: ["celery-city", "senator-tree", "sunrail-stations", "i-voted-sticker"],
      safety: { en: "Part 2 (day 22) swaps in the 2026 'I Voted' sticker question. Don't name the student designer. Link the events page, not a trivia filter: the only demo trivia night (Nov 19) is over before launch.", es: "La parte 2 (día 22) usa la pregunta del sticker 'I Voted' de 2026. No nombres a la estudiante que lo diseñó. Enlaza la página de eventos, no un filtro de trivia: la única noche de trivia de muestra (19 de noviembre) termina antes del lanzamiento." }
    },
    {
      id: "v07",
      title: { en: "A quiz called me a Spreadsheet Witch", es: "Un quiz me dijo Magia en Celdas" },
      primaryLang: "en",
      format: "reaction + stitch prompt",
      lengthSec: [15, 20],
      tone: "bright",
      sound: "trend-licensed",
      hook: {
        visual: { en: "Hold your phone up to the camera showing your result card, then turn it back to yourself in mock outrage.", es: "Muestra a la cámara tu tarjeta de resultado en el teléfono y luego gírala hacia ti con indignación fingida." },
        line: { en: "A quiz just called me a Spreadsheet Witch, and I can't even argue.", es: "Un quiz me dijo que lo mío es Magia en Celdas, y ni puedo discutirlo." },
        onScreen: { en: "What's your organizer era?", es: "¿Cuál es tu modo de organizar?" }
      },
      cta: {
        line: { en: "Eight questions. Stitch this with yours.", es: "Ocho preguntas. Haz un stitch con tu resultado." },
        onScreen: { en: "Take the quiz · link in bio", es: "Haz el quiz · enlace en el perfil" }
      },
      caption: {
        en: "Six types: Hype Captain, Group-Chat General, Spreadsheet Witch, Door-Knock Natural, Creator, Plus-One. Which are you? Stitch it.",
        es: "Seis modos: «La Chispa», «Modo Admin», «Magia en Celdas», «Toc, Toc», «Luces, Cámara, Acción» y «Conoce a Medio Mundo». ¿Cuál eres? Haz tu stitch."
      },
      link: { page: "quiz", hash: "era" },
      utm: { campaign: "2026-12-bring3", content: "v07" },
      factIds: [],
      safety: { en: "Swap in your own result. Result names come from data/quiz.js, spelled as there; Spanish names are their own jokes.", es: "Usa tu propio resultado. Los nombres vienen de data/quiz.js, escritos igual que allí; los nombres en español son chistes propios." }
    },
    {
      id: "v08",
      title: { en: "Three friends. Not 300.", es: "Tres personas. No trescientas." },
      primaryLang: "en",
      format: "talking head",
      lengthSec: [18, 22],
      tone: "bright",
      sound: "voice-only",
      hook: {
        visual: { en: "Hold up three fingers. Behind you, a phone screen with three contacts, names blurred.", es: "Muestra tres dedos. Detrás, un teléfono con tres contactos, con los nombres borrosos." },
        line: { en: "I'm picking three friends. Not 300. Three.", es: "Voy a escoger a tres personas. No a trescientas. A tres." },
        onScreen: { en: "Bring Three: Dec 7-31", es: "Trae a tres: del 7 al 31 de diciembre" }
      },
      cta: {
        line: { en: "Get your own link on the site, link in our bio. Nobody pays anything, nobody gets spammed.", es: "Saca tu propio enlace en el sitio (está en nuestro perfil). Nadie paga nada y a nadie le llega spam." },
        onScreen: { en: "Get your link · bio", es: "Tu enlace · perfil" }
      },
      caption: {
        en: "Send your Young Dems link to three people you actually talk to. One joins: a badge. Three join: the full sticker pack and a shoutout if you want one. Ends Dec 31, 11:59 pm.",
        es: "Manda tu enlace de Young Dems a tres personas con las que de verdad hablas. Se une una: una insignia. Se unen tres: el paquete completo de stickers y una mención si la quieres. Termina el 31 de diciembre a las 11:59 p. m."
      },
      link: { page: "join", hash: "bring-three" },
      utm: { campaign: "2026-12-bring3", content: "v08" },
      factIds: [],
      safety: { en: "Blur every contact name and photo. Joining counts, never registering or voting (see referral.legal).", es: "Desenfoca todos los nombres y fotos de contactos. Cuenta unirse, nunca inscribirse ni votar (ver referral.legal)." }
    },
    {
      id: "v09",
      title: { en: "2027-28 in five dates", es: "2027-28 en cinco fechas" },
      primaryLang: "en",
      format: "green screen over a calendar graphic",
      lengthSec: [20, 25],
      tone: "bright",
      sound: "library-low",
      hook: {
        visual: { en: "Green screen over a plain calendar. Tap each date as it lights up.", es: "Pantalla verde sobre un calendario sencillo. Toca cada fecha cuando se ilumine." },
        line: { en: "Five dates to save for voting in Seminole in 2027 and 2028.", es: "Cinco fechas para votar en Seminole en 2027 y 2028. Guárdalas." },
        onScreen: { en: "5 dates to save: 2027-28", es: "5 fechas para guardar: 2027-28" }
      },
      cta: {
        line: { en: "Check voteseminole.gov before each one. Every date, link in bio.", es: "Revisa voteseminole.gov antes de cada una. Todas las fechas, en el enlace del perfil." },
        onScreen: { en: "All dates + calendar files · link in bio", es: "Todas las fechas y archivos de calendario · perfil" }
      },
      caption: {
        en: "Oct 4, 2027: registration closes for city elections. Nov 2, 2027: city elections (Oviedo confirmed; Lake Mary and Altamonte Springs expected). Mar 21, 2028: presidential primary. Aug 22, 2028: primary. Nov 7, 2028: general election.",
        es: "4 de octubre de 2027: cierra la inscripción para las elecciones municipales. 2 de noviembre de 2027: elecciones municipales (Oviedo confirmado; se esperan Lake Mary y Altamonte Springs). 21 de marzo de 2028: primaria presidencial. 22 de agosto de 2028: primaria. 7 de noviembre de 2028: elección general."
      },
      link: { page: "vote", hash: "dates" },
      utm: { campaign: "2026-12-rewind", content: "v09" },
      factIds: ["city-2027-reg-deadline", "city-2027-oviedo", "city-2027-expected", "reg-29", "ppp-2028", "primary-2028", "general-2028", "closed-primaries"],
      safety: { en: "Say 'expected' for Lake Mary and Altamonte Springs. Not every city votes in 2027.", es: "Di 'se esperan' para Lake Mary y Altamonte Springs. No todas las ciudades votan en 2027." }
    },
    {
      id: "v10",
      title: { en: "Turning 16?", es: "¿Vas a cumplir 16?" },
      primaryLang: "en",
      format: "talking head",
      lengthSec: [12, 15],
      tone: "bright",
      sound: "voice-only",
      hook: {
        visual: { en: "Talking head, close and friendly. If the person on camera is under 18: guardian consent on file, first name only, no school clothes, logos or locations.", es: "A cámara, de cerca y con buena onda. Si quien sale tiene menos de 18: permiso del tutor por escrito, solo el nombre de pila, sin uniformes, logos ni lugares." },
        line: { en: "If you're 16, Florida lets you pre-register to vote. Today.", es: "Si tienes 16 años, en Florida ya puedes preinscribirte para votar. Hoy mismo." },
        onScreen: { en: "16 or 17? Pre-register in Florida", es: "¿16 o 17? Preinscríbete en Florida" }
      },
      cta: {
        line: { en: "Then you can vote in any election once you're 18. Official link in bio.", es: "Así votas en cualquier elección desde que cumplas 18. Enlace oficial en el perfil." },
        onScreen: { en: "Pre-register · official link in bio", es: "Preinscríbete · enlace oficial en el perfil" }
      },
      caption: {
        en: "Florida lets 16- and 17-year-olds pre-register, so they can vote in any election on or after their 18th birthday. Do it on the official site, link in bio.",
        es: "En Florida, los jóvenes de 16 y 17 años pueden preinscribirse, y así votan en cualquier elección desde que cumplen 18. Hazlo en el sitio oficial, enlace en el perfil."
      },
      link: { page: "vote", hash: "register" },
      utm: { campaign: "evergreen", content: "v10" },
      factIds: ["prereg-16"],
      safety: { en: "Teens on camera follow docs/legal/MINORS_POLICY.md. Never collect anyone's registration info; the official site does that.", es: "Si salen adolescentes, se sigue docs/legal/MINORS_POLICY.md. Nunca recogemos datos de inscripción de nadie; eso lo hace el sitio oficial." }
    },
    {
      id: "v11",
      title: { en: "One thing you'd fix in Seminole", es: "Una cosa que arreglarías en Seminole" },
      primaryLang: "en",
      format: "street interviews (listening on camera)",
      lengthSec: [30, 45],
      tone: "bright",
      sound: "room-tone",
      hook: {
        visual: { en: "On the Sanford Riverwalk, mic out to an adult passerby who already said yes on camera.", es: "En el Sanford Riverwalk, micrófono hacia una persona adulta que ya dijo que sí en cámara." },
        line: { en: "One thing you'd fix in Seminole. Go.", es: "Dime una cosa que arreglarías en Seminole." },
        onScreen: { en: "One thing you'd fix in Seminole?", es: "¿Qué arreglarías en Seminole?" }
      },
      cta: {
        line: { en: "Mine's [your answer]. What's yours? Find your issue, link in bio.", es: "La mía es [tu respuesta]. ¿Y la tuya? Encuentra tu tema en el enlace del perfil." },
        onScreen: { en: "Find your issue · 7 questions · bio", es: "Encuentra tu tema · 7 preguntas · perfil" }
      },
      caption: {
        en: "We asked people on the Sanford Riverwalk one thing they'd fix in Seminole. What's yours? Find your issue in 7 questions, link in bio.",
        es: "Le preguntamos a la gente en el Sanford Riverwalk qué cosa arreglaría en Seminole. ¿Y tú? Encuentra tu tema en 7 preguntas, enlace en el perfil."
      },
      link: { page: "quiz", hash: "issue" },
      utm: { campaign: "2026-12-launch", content: "v11" },
      factIds: [],
      safety: { en: "Adults only: ask 'are you 18 or older?' and get an on-camera OK plus a signed release. No last names. Crop out kids in the background. Never post an answer with false voting info. Listening, not debating.", es: "Solo personas adultas: pregunta '¿tienes 18 años o más?' y consigue un sí en cámara y una autorización firmada. Sin apellidos. Recorta a niños que salgan al fondo. Nunca publiques una respuesta con información falsa sobre cómo votar. Escuchar, no debatir." }
    },
    {
      id: "v12",
      title: { en: "What changes in 2027 (in Spanish)", es: "Lo que cambia en 2027" },
      primaryLang: "es",
      format: "talking head in Spanish, English subtitles burned in",
      lengthSec: [28, 35],
      tone: "calm",
      sound: "voice-only",
      hook: {
        visual: { en: "A Spanish-speaking member on camera holds up two fingers, then one, then two.", es: "Una persona del grupo que habla español, a cámara, muestra dos dedos, luego uno, luego dos." },
        line: { en: "Two things are changing for Florida voters, and both could affect you.", es: "Dos cosas cambian para votar en Florida, y las dos te pueden afectar." },
        onScreen: { en: "2 voting changes for 2027", es: "2 cambios para votar en 2027" }
      },
      cta: {
        line: { en: "Everything, in Spanish, at the link in our bio. Send it to the family chat.", es: "Toda la información, en español, en el enlace del perfil. Mándaselo al chat de la familia." },
        onScreen: { en: "In Spanish · link in bio", es: "En español · enlace en el perfil" }
      },
      caption: {
        en: "1) Asked for a mail ballot before Nov 3? That request runs out Dec 31. Renew in January, online or at 407-585-8683, and you're covered through 2028. 2) Starting Jan 1, 2027, Florida stops accepting student IDs at the polls (it's being challenged in court). Bring a driver's license, state ID or passport, and check voteseminole.gov before you go.",
        es: "1) ¿Pediste la boleta por correo antes del 3 de noviembre? Esa solicitud vence el 31 de diciembre. Renuévala en enero, en línea o al 407-585-8683, y te cubre hasta finales de 2028. 2) Desde el 1 de enero de 2027, Florida deja de aceptar la identificación de estudiante para votar (la medida está impugnada en los tribunales). Lleva tu licencia de conducir, tu identificación estatal o tu pasaporte, y revisa voteseminole.gov antes de ir."
      },
      link: { page: "vote", hash: "renew-mail-ballot" },
      utm: { campaign: "2026-12-renew", content: "v12-es" },
      factIds: ["mail-expiry", "mail-renew-jan1", "mail-covers-2028", "mail-phone", "student-id", "student-id-lawsuit"],
      safety: { en: "Spanish-first, not a dub. Link the es/ page. The Supervisor of Elections has Spanish request forms (data/civic.js links.mailBallotFormPdf.urlEs).", es: "Primero en español, no un doblaje. Enlaza la página es/. La oficina del Supervisor de Elecciones tiene formularios de solicitud en español (data/civic.js links.mailBallotFormPdf.urlEs)." }
    }
  ],

  // ---------------------------------------------------------------------------------- REFERRAL
  referral: {
    id: "bring-three",
    name: { en: "Bring Three", es: "Trae a tres" },
    tagline: { en: "Three friends. Not 300.", es: "Tres personas. No trescientas." },
    window: {
      start: "2026-12-07T00:00:00-05:00",
      end: "2026-12-31T23:59:59-05:00",
      timeLabel: { en: "Mon, Dec 7 to Thu, Dec 31 at 11:59 pm", es: "Del lunes 7 de diciembre al jueves 31 de diciembre a las 11:59 p. m." }
    },
    evergreen: true,
    attribution: {
      en: "A friend counts when they join through your link (it carries your code). If they open two people's links, the last one they opened in the 30 days before joining gets the credit.",
      es: "Una persona cuenta cuando se une con tu enlace (lleva tu código). Si abre los enlaces de dos personas, el crédito es para el último que abrió en los 30 días antes de unirse."
    },
    intro: {
      en: "Pick three people you actually talk to and send them your link, one at a time, in your own words. That's the whole challenge.",
      es: "Escoge a tres personas con las que de verdad hablas y mándales tu enlace, una por una, con tus propias palabras. Ese es todo el reto."
    },
    steps: [
      { en: "Join, or open your member card, to get your link.", es: "Únete, o abre tu tarjeta de miembro, para tener tu enlace." },
      { en: "Pick three people. Not a blast: three names you'd actually text.", es: "Escoge a tres personas. Nada de mensajes masivos: tres nombres a quienes de verdad les escribirías." },
      { en: "Send it one by one. Use a template or your own words.", es: "Mándalo uno por uno. Con una plantilla o con tus palabras." },
      { en: "When someone joins through your link, they show up in your squad and the badge lands on your card.", es: "Cuando alguien se une con tu enlace, aparece en tu grupo y la insignia llega a tu tarjeta." }
    ],
    counts: {
      yes: { en: "A friend joins the Young Dems through your link. Voting or non-voting membership, it counts the same.", es: "Alguien se une a los Young Dems con tu enlace. Membresía con voto o sin voto, cuenta igual." },
      no: { en: "Clicks, likes, follows, RSVPs, or anything to do with registering or voting. Those matter, but they're not what this counts.", es: "Clics, me gusta, seguidores, confirmaciones a eventos, o cualquier cosa relacionada con inscribirse o votar. Importan, pero no es lo que cuenta este reto." }
    },
    rewards: [
      {
        at: 1,
        side: "both",
        badgeId: "plus-one",
        stickerIds: ["stk04"],
        reward: {
          en: "The Plus-One badge for you, and the Bring a friend sticker for both of you.",
          es: "La insignia «Trajiste a alguien» para ti, y el sticker «Trae a alguien» para las dos personas."
        },
        costsMoney: false
      },
      {
        at: 3,
        side: "inviter",
        badgeId: "squad-of-three",
        stickerIds: ["stk01", "stk02", "stk03", "stk04", "stk05", "stk06", "stk07", "stk08", "stk09", "stk10", "stk11", "stk12"],
        reward: {
          en: "The Squad of Three badge, the full 12-sticker digital pack, a shoutout if you want one, and first pick from the next printed sticker sheet.",
          es: "La insignia «Grupo de tres», el paquete digital completo de 12 stickers, una mención si la quieres y la primera elección de la próxima hoja de stickers impresa."
        },
        costsMoney: false,
        demoNote: "Printed sticker sheets don't exist yet: show '(DEMO)' after 'first pick from the next printed sticker sheet' until the chapter prints them."
      }
    ],
    rules: [
      { id: "free", text: { en: "Nothing here costs money or is worth money: no cash, gift cards, raffles or prizes. Badges, stickers and shoutouts only.", es: "Nada aquí cuesta dinero ni vale dinero: sin efectivo, tarjetas de regalo, rifas ni premios. Solo insignias, stickers y menciones." } },
      { id: "join-only", text: { en: "Only joining counts. This challenge never rewards registering to vote, renewing a mail-ballot request or voting.", es: "Solo cuenta unirse. Este reto nunca premia inscribirse para votar, renovar la solicitud de boleta por correo ni votar." } },
      { id: "once", text: { en: "Each person counts once, for one inviter. Your own code doesn't count for you.", es: "Cada persona cuenta una sola vez y para una sola persona. Tu propio código no cuenta para ti." } },
      { id: "real", text: { en: "Real people only. Duplicate or made-up sign-ups just don't count; we won't call anyone out.", es: "Solo personas reales. Los registros duplicados o inventados simplemente no cuentan; no vamos a señalar a nadie." } },
      { id: "no-board", text: { en: "No leaderboard of people. Everyone who hits three gets the same thing, so there's nothing to win by beating a friend.", es: "No hay tabla de posiciones de personas. Todas las que lleguen a tres reciben lo mismo, así que no se gana nada superando a nadie." } },
      { id: "privacy", text: { en: "You see the first names of friends who joined through your link. Nobody ever sees who didn't.", es: "Ves el nombre de pila de quienes se unieron con tu enlace. Nadie ve nunca quién no se unió." } },
      { id: "no-pressure", text: { en: "One message per friend. If they say no or don't answer, that's the answer.", es: "Un mensaje por persona. Si dice que no o no contesta, esa es la respuesta." } },
      { id: "teens", text: { en: "Under 18? You can play. Shoutouts for teens are first name only, with no photo, school or city, and we never send money asks to anyone under 18.", es: "¿Menos de 18 años? Puedes participar. Las menciones de adolescentes van solo con el nombre de pila, sin foto, escuela ni ciudad, y nunca le pedimos dinero a menores de 18." } },
      { id: "keeps", text: { en: "Badges never expire. Friends who join after Dec 31 still count toward your badges, just not toward this round's shoutouts.", es: "Las insignias no vencen. Quienes se unan después del 31 de diciembre siguen contando para tus insignias, solo que no para las menciones de esta ronda." } }
    ],
    progress: {
      "0": { en: "Your three are out there. Start with the friend who always replies.", es: "Tus tres personas están por ahí. Empieza con quien siempre te contesta." },
      "1": { en: "One in. Two to go.", es: "Ya va una. Faltan dos." },
      "2": { en: "Two in. One more and the full pack is yours.", es: "Ya van dos. Una más y el paquete completo es tuyo." },
      "3": { en: "Three. You did the whole thing. Pack unlocked.", es: "Tres. Lo lograste. Paquete desbloqueado." },
      more: { en: "{n} friends in. This is how it works: one person asks another.", es: "Ya van {n}. Así funciona esto: una persona invita a otra." }
    },
    shoutout: {
      optIn: { en: "Shout me out (first name and city only)", es: "Quiero una mención (solo nombre de pila y ciudad)" },
      adult: { en: "Shoutout to {name} from {city}, who brought three friends into the Young Dems this month.", es: "Una mención para {name}, de {city}, que trajo a tres personas a los Young Dems este mes." },
      teen: { en: "Shoutout to {name}, who brought three friends in this month.", es: "Una mención para {name}, que trajo a tres personas este mes." },
      demo: { en: "Shoutout to Maya from Oviedo (DEMO), who brought three friends in this month.", es: "Una mención para Maya, de Oviedo (DEMO), que trajo a tres personas este mes." },
      note: "Opt-in only, unchecked by default. Shoutouts run on Stories and in the Thursday Letter, text only. Use the teen template for anyone under 18 (docs/legal/MINORS_POLICY.md)."
    },
    share: {
      text: {
        en: "I'm doing Bring Three for the Young Dems and you're one of my three. No pressure. Here's my link: {url}",
        es: "Estoy haciendo el reto Trae a tres de los Young Dems y tú eres una de mis tres personas. Sin presión. Aquí está mi enlace: {url}"
      },
      link: { page: "join" },
      utm: { campaign: "2026-12-bring3", content: "referral" }
    },
    faq: [
      {
        q: { en: "Do my friends have to pay dues?", es: "¿Mis amistades tienen que pagar la cuota?" },
        a: { en: "No. Dues are $20 a year, and anyone who can't pay can join as a non-voting member. A join is a join either way.", es: "No. La cuota es de $20 al año, y quien no pueda pagar puede unirse como miembro sin voto. De cualquier forma, cuenta igual." },
        factIds: ["dues"]
      },
      {
        q: { en: "Can my friend be under 18?", es: "¿Mi amistad puede tener menos de 18?" },
        a: { en: "Yes, members can be 14 to 39. Teens get first-name-only shoutouts and the teen safety rules.", es: "Sí, los miembros pueden tener de 14 a 39 años. Los adolescentes reciben menciones solo con el nombre de pila y siguen las reglas de seguridad para menores." },
        factIds: ["ages"]
      },
      {
        q: { en: "Do they need to be a Democrat?", es: "¿Tiene que ser demócrata?" },
        a: { en: "Anyone can come to our events, any party or none. Voting membership follows the chapter's rules; the join page explains them.", es: "Cualquier persona puede venir a nuestros eventos, con partido o sin partido. La membresía con voto sigue las reglas del capítulo; la página para unirse las explica." },
        factIds: ["events-open"]
      },
      {
        q: { en: "What if a friend opened someone else's link too?", es: "¿Y si mi amistad también abrió el enlace de otra persona?" },
        a: { en: "The last link they opened in the 30 days before joining gets the credit. No hard feelings: you both get the same rewards when you reach the same number.", es: "El crédito es para el último enlace que abrió en los 30 días antes de unirse. Sin rencores: las dos personas reciben lo mismo cuando llegan al mismo número." },
        factIds: []
      }
    ],
    legal: "Editors: rewards are tied to joining the club only. Federal law bars paying, or offering to pay, for registering to vote or for voting in elections with federal candidates (52 U.S.C. 10307(c)), and Florida regulates third-party voter registration (F.S. 97.0575), so this challenge never touches registration or voting, and nobody collects forms. The join-only rule is scoped to this challenge on purpose: data/levels.js does award XP, a 'Renew-Ready' badge (for setting the reminder) and a 'Renewed' badge (for renewing a mail-ballot request; non-monetary, honor system), and counsel should review those, plus any 'Renewed through 2028' sticker (stk01 safety), before launch."
  },

  // ------------------------------------------------------------------------------------ FACTS
  facts: {
    "mail-expiry": {
      claim: {
        en: "A Florida mail-ballot request covers all elections from the day it's made through the end of the calendar year of the next regularly scheduled general election. That election was Nov 3, 2026, so every request made before it ends Dec 31, 2026.",
        es: "Una solicitud de boleta por correo en Florida cubre todas las elecciones desde el día en que se hace hasta el final del año de la siguiente elección general ordinaria. Esa elección fue el 3 de noviembre de 2026, así que todas las solicitudes hechas antes vencen el 31 de diciembre de 2026."
      },
      source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62",
      sources: ["https://dos.fl.gov/elections/for-voters/voting/vote-by-mail/"],
      verified: "2026-11-09",
      confidence: "high",
      audience: "public",
      via: "data/civic.js changes[mail-ballot-expiry]",
      note: "Scope it: 'requests made before Nov 3', never 'every request'. The Division of Elections page says a request covers elections 'from the date a request was submitted', so one made after Nov 3 should run through Dec 31, 2028 (re-read Nov 9, 2026)."
    },
    "mail-renew-jan1": {
      claim: {
        en: "Seminole voters can renew a mail-ballot request online, by phone or on a signed form. Under the state rule, a request made after Nov 3, 2026 should already run through 2028, but as of Nov 9 Seminole's vote-by-mail page still says new requests apply to the Nov 3 election. A request made on or after Jan 1, 2027 covers 2027-28 for sure, so the safe ask is a Jan 1 reminder; anyone who renews earlier should check My Voter Record in January.",
        es: "Los votantes de Seminole pueden renovar su solicitud de boleta por correo en línea, por teléfono o con un formulario firmado. Según la regla del estado, una solicitud hecha después del 3 de noviembre de 2026 ya debería servir hasta 2028, pero al 9 de noviembre la página de voto por correo de Seminole todavía dice que las solicitudes nuevas se aplican a las elecciones del 3 de noviembre. Una solicitud hecha a partir del 1 de enero de 2027 cubre 2027-28 con seguridad, así que lo prudente es un recordatorio para el 1 de enero; quien renueve antes debe revisar My Voter Record en enero."
      },
      source: "https://voteseminole.gov/how-to-vote/vote-by-mail/",
      sources: ["https://dos.fl.gov/elections/for-voters/voting/vote-by-mail/", "https://www.flsenate.gov/Laws/Statutes/2026/101.62", "https://voteseminole.gov/voters/my-voter-record/"],
      verified: "2026-11-09",
      confidence: "med",
      audience: "public",
      via: "data/civic.js changes[mail-ballot-expiry]",
      note: "Recheck by Dec 15, 2026: if Seminole confirms that Nov-Dec 2026 requests count for 2027-28, set YSD_CONFIG.sharekit.confirmed['soe-2027-requests-open'] and switch the 'set a Jan 1 reminder' lines to 'renew now'."
    },
    "mail-covers-2028": {
      claim: {
        en: "A request made in 2027 covers every election through Dec 31, 2028 (the next regularly scheduled general election is Nov 7, 2028).",
        es: "Una solicitud hecha en 2027 cubre todas las elecciones hasta el 31 de diciembre de 2028 (la siguiente elección general ordinaria es el 7 de noviembre de 2028)."
      },
      source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62",
      verified: "2026-11-09",
      confidence: "high",
      audience: "public",
      computed: { rule: "101.62(1)(a) applied to the Nov 7, 2028 general election" }
    },
    "mail-phone": {
      claim: { en: "Seminole voters can request a mail ballot by phone at 407-585-8683.", es: "Los votantes de Seminole pueden pedir la boleta por correo por teléfono al 407-585-8683." },
      source: "https://voteseminole.gov/how-to-vote/vote-by-mail/",
      verified: "2026-11-09",
      confidence: "high",
      audience: "public",
      via: "data/civic.js and assets/js/config.js links.vote.countyPhone"
    },
    "student-id": {
      claim: {
        en: "HB 991 (Ch. 2026-26) removes student IDs from Florida's list of acceptable photo IDs at the polls, effective Jan 1, 2027.",
        es: "La HB 991 (Cap. 2026-26) quita la identificación de estudiante de la lista de identificaciones con foto válidas para votar en Florida, a partir del 1 de enero de 2027."
      },
      source: "https://flsenate.gov/Committees/BillSummaries/2026/html/991",
      sources: ["https://flsenate.gov/Session/Bill/2026/991"],
      verified: "2026-11-09",
      confidence: "high",
      audience: "public"
    },
    "student-id-lawsuit": {
      claim: { en: "A federal lawsuit filed Oct 16, 2026 challenges the student-ID ban.", es: "Una demanda federal presentada el 16 de octubre de 2026 impugna la prohibición de la identificación de estudiante." },
      source: "https://www.democracydocket.com/wp-content/uploads/2026/10/2026-10-16-Complaint.pdf",
      verified: "2026-11-09",
      confidence: "high",
      audience: "public",
      sources: ["https://www.democracydocket.com/cases/florida-student-id-ban-challenge/"],
      via: "docs/research/00 (lead fact-check)",
      note: "Filed by the Florida State Conference of the NAACP; the case page lists no ruling as of Nov 9, 2026. Re-check before each calm post (Dec 9, Dec 22, Dec 31, Jan 1)."
    },
    "gov-seminole": {
      claim: {
        en: "In Seminole County, the Democratic candidate for governor got about 54% to the Republican's about 45% on Nov 3, 2026, in unofficial returns.",
        es: "En el condado de Seminole, el candidato demócrata a gobernador obtuvo cerca de 54% y el republicano cerca de 45% el 3 de noviembre de 2026, según resultados extraoficiales."
      },
      source: "https://www.wftv.com/news/local/florida-election-results-by-county-explore-governor-us-senate-races/M4I4A3YEGJH6BJ3TSVPISSSXHA/",
      sources: ["https://enr.electionsfl.org/SEM/4119/Summary/", "https://floridaphoenix.com/2026/11/03/donalds-defeats-jolly-becoming-floridas-first-black-governor/"],
      verified: "2026-11-09",
      confidence: "high",
      audience: "public",
      note: "WFTV showed 54.08% to 44.59% on Nov 9 (unofficial). Say 'about 54% to 45%' and 'unofficial until certified'; switch to certified figures from the Supervisor of Elections once posted."
    },
    "gov-statewide": {
      claim: { en: "Statewide, the Republican won the governor's race by less than 2 points (about 50% to 48.7%, unofficial).", es: "En todo el estado, el republicano ganó la elección a gobernador por menos de 2 puntos (cerca de 50% a 48.7%, extraoficial)." },
      source: "https://floridaphoenix.com/2026/11/03/donalds-defeats-jolly-becoming-floridas-first-black-governor/",
      sources: ["https://www.floridatrend.com/articles/2026/11/04/donalds-fends-off-jolly-moody-hangs-us-senate-seat/"],
      verified: "2026-11-09",
      confidence: "high",
      audience: "public"
    },
    "youth-turnout": {
      claim: { en: "CIRCLE (Tufts) estimates 27% of young people (ages 18 to 29) voted in the 2026 midterms (plus or minus 2 points), the second-highest midterm youth turnout in 30 years, behind 2018.", es: "CIRCLE (Tufts) estima que el 27% de los jóvenes (de 18 a 29 años) votó en las elecciones de medio término de 2026 (con un margen de 2 puntos), la segunda participación juvenil más alta en una elección de medio término en 30 años, después de 2018." },
      source: "https://circle.tufts.edu/latest-research/2026-youth-voter-turnout-second-highest-last-30-years",
      sources: ["https://circle.tufts.edu/2026-election"],
      verified: "2026-11-09",
      confidence: "high",
      audience: "public",
      note: "Preliminary estimate; attribute to CIRCLE and call it an estimate."
    },
    "npa-18-40": {
      claim: {
        en: "Among Seminole's 124,626 active voters aged 18 to 40 (July 1, 2026), no-party voters are the biggest group at about 34.3%, ahead of Democrats (32.7%) and Republicans (27.4%).",
        es: "Entre los 124,626 votantes activos de 18 a 40 años en Seminole (1 de julio de 2026), los que no tienen partido son el grupo más grande, con cerca del 34.3%, por delante de los demócratas (32.7%) y los republicanos (27.4%)."
      },
      source: "https://voteseminole.gov/wp-content/uploads/2026/07/District-Demographic-Analysis.pdf",
      verified: "2026-11-09",
      confidence: "high",
      audience: "public",
      computed: { rule: "Shares computed in docs/research/01 section 6c from the SOE's age-band counts." },
      note: "A plurality, not a majority: write 'biggest group', never 'most'. The SOE's bands end at 40, so this stat says 18 to 40 even though membership is under 40."
    },
    "share-18-40": {
      claim: { en: "Voters aged 18 to 40 are 36.8% of Seminole's 338,692 active voters (July 1, 2026).", es: "Los votantes de 18 a 40 años son el 36.8% de los 338,692 votantes activos de Seminole (1 de julio de 2026)." },
      source: "https://voteseminole.gov/wp-content/uploads/2026/07/District-Demographic-Analysis.pdf",
      verified: "2026-11-09",
      confidence: "high",
      audience: "public",
      computed: { rule: "docs/research/01 section 6c" }
    },
    "prereg-16": {
      claim: { en: "Floridians can pre-register at 16 and vote in any election on or after their 18th birthday.", es: "En Florida se puede hacer la preinscripción a los 16 años y votar en cualquier elección desde que se cumplen 18." },
      source: "https://voteseminole.gov/voters/register-to-vote/",
      sources: ["http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0000-0099/0097/Sections/0097.041.html"],
      verified: "2026-11-09",
      confidence: "high",
      audience: "public"
    },
    "closed-primaries": {
      claim: {
        en: "In a Florida primary you can vote only your own party's ballot, except when every candidate for an office is from one party and the winner faces no one in November; nonpartisan races like school board and judges are open to every voter.",
        es: "En una primaria de Florida solo puedes votar la boleta de tu propio partido, salvo cuando todos los candidatos a un cargo son del mismo partido y quien gane no tiene rival en noviembre; las contiendas no partidistas, como la junta escolar y los jueces, están abiertas a todos los votantes."
      },
      source: "https://www.flsenate.gov/Laws/Statutes/2026/101.021",
      sources: ["https://www.flsenate.gov/Laws/Constitution", "https://voteseminole.gov/wp-content/uploads/2026/04/UPDATED2026-Election-Facts.pdf"],
      verified: "2026-11-09",
      confidence: "high",
      audience: "public",
      via: "data/civic.js steps[party-and-primaries]"
    },
    "reg-29": {
      claim: { en: "Florida's registration books close on the 29th day before each election.", es: "En Florida, la inscripción cierra el día 29 antes de cada elección." },
      source: "https://www.flsenate.gov/Laws/Statutes/2026/97.055",
      verified: "2026-11-09",
      confidence: "high",
      audience: "public"
    },
    "city-2027-reg-deadline": {
      claim: { en: "For the Nov 2, 2027 city elections, registration closes Mon, Oct 4, 2027.", es: "Para las elecciones municipales del 2 de noviembre de 2027, la inscripción cierra el lunes 4 de octubre de 2027." },
      source: "https://www.flsenate.gov/Laws/Statutes/2026/97.055",
      verified: "2026-11-09",
      confidence: "high",
      audience: "public",
      computed: { rule: "29 days before Nov 2, 2027", note: "Computed from Florida's 29-day rule. Confirm with the Supervisor of Elections." },
      via: "data/civic.js dates[city-2027-reg-deadline]"
    },
    "city-2027-oviedo": {
      claim: { en: "Oviedo votes for mayor and City Council Group 1 on Tue, Nov 2, 2027.", es: "Oviedo vota por alcalde y el escaño 1 del Concejo Municipal el martes 2 de noviembre de 2027." },
      source: "https://cityofoviedo.net/724/Elections",
      verified: "2026-11-09",
      confidence: "high",
      audience: "public",
      via: "data/civic.js dates[city-2027-oviedo]"
    },
    "city-2027-expected": {
      claim: { en: "Lake Mary and Altamonte Springs are expected to hold city elections on Nov 2, 2027 (not yet posted by the elections office).", es: "Se espera que Lake Mary y Altamonte Springs tengan elecciones municipales el 2 de noviembre de 2027 (la oficina electoral todavía no lo ha publicado)." },
      source: "https://www.yahoo.com/news/articles/candidates-three-seminole-cities-win-125700315.html",
      verified: "2026-11-09",
      confidence: "med",
      audience: "public",
      via: "data/civic.js dates[city-2027-lake-mary-altamonte]",
      note: "Always label 'expected'."
    },
    "ppp-2028": {
      claim: { en: "Florida's presidential preference primary is Tue, Mar 21, 2028.", es: "La primaria presidencial de Florida es el martes 21 de marzo de 2028." },
      source: "https://www.flsenate.gov/Laws/Statutes/2026/103.101",
      verified: "2026-11-09",
      confidence: "high",
      audience: "public",
      via: "data/civic.js dates[ppp-2028]"
    },
    "primary-2028": {
      claim: { en: "Florida's 2028 primary is Tue, Aug 22, 2028.", es: "La primaria de Florida de 2028 es el martes 22 de agosto de 2028." },
      source: "https://www.flsenate.gov/Laws/Statutes/2026/100.061",
      verified: "2026-11-09",
      confidence: "high",
      audience: "public",
      via: "data/civic.js dates[primary-2028]"
    },
    "general-2028": {
      claim: { en: "The 2028 general election is Tue, Nov 7, 2028.", es: "La elección general de 2028 es el martes 7 de noviembre de 2028." },
      source: "https://www.flsenate.gov/Laws/Statutes/2026/100.031",
      verified: "2026-11-09",
      confidence: "high",
      audience: "public",
      via: "data/civic.js dates[general-2028]"
    },
    "celery-city": {
      claim: { en: "Sanford, on the south shore of Lake Monroe, is nicknamed the Celery City; celery was first planted there in 1896.", es: "Sanford, en la orilla sur del lago Monroe, tiene el apodo de Celery City; allí se sembró apio por primera vez en 1896." },
      source: "https://en.wikipedia.org/wiki/Sanford,_Florida",
      verified: "2026-11-09",
      confidence: "med",
      audience: "public"
    },
    "senator-tree": {
      claim: { en: "The Senator, a bald cypress in Longwood's Big Tree Park, was about 3,500 years old when it burned in January 2012. A clone, The Phoenix, was growing there when the park reopened in March 2014, and Lady Liberty, about 2,000 years old, stands nearby.", es: "The Senator, un ciprés calvo de Big Tree Park en Longwood, tenía unos 3,500 años cuando se quemó en enero de 2012. Un clon, The Phoenix, ya crecía allí cuando el parque reabrió en marzo de 2014, y cerca sigue Lady Liberty, de unos 2,000 años." },
      source: "https://en.wikipedia.org/wiki/The_Senator_(tree)",
      verified: "2026-11-09",
      confidence: "med",
      audience: "public"
    },
    "sunrail-stations": {
      claim: { en: "Four of SunRail's 17 stations are in Seminole County: Sanford, Lake Mary, Longwood and Altamonte Springs.", es: "Cuatro de las 17 estaciones de SunRail están en el condado de Seminole: Sanford, Lake Mary, Longwood y Altamonte Springs." },
      source: "https://sunrail.com/stations/",
      verified: "2026-11-09",
      confidence: "high",
      audience: "public"
    },
    "oviedo-chickens": {
      claim: { en: "Oviedo was known for chickens that roamed downtown; as the city grew, they stopped wandering the streets.", es: "Oviedo era conocida por las gallinas que andaban sueltas por el centro; con el crecimiento de la ciudad, dejaron de verse por las calles." },
      source: "https://en.wikipedia.org/wiki/Oviedo,_Florida",
      verified: "2026-11-09",
      confidence: "med",
      audience: "public",
      note: "Folklore and nostalgia, not a current fact (docs/research/01). Secondary source only."
    },
    "i-voted-sticker": {
      claim: { en: "Seminole's 2026 'I Voted' sticker was the county's first designed by a student, a sixth grader at a local middle school, picked from more than 50 entries.", es: "El sticker 'I Voted' de Seminole en 2026 fue el primero del condado diseñado por una estudiante, de sexto grado en una escuela local, elegido entre más de 50 propuestas." },
      source: "https://voteseminole.gov/wp-content/uploads/2026/05/Ballots-And-Beyond-Edition-7.pdf",
      verified: "2026-11-09",
      confidence: "high",
      audience: "public",
      note: "The source names the student and her school. We don't: she's a minor."
    },
    "events-open": {
      claim: { en: "Our events are open to everyone 14 and up; you don't have to be a member or registered with any party.", es: "Nuestros eventos están abiertos a todas las personas de 14 años en adelante; no tienes que ser miembro ni estar inscrito en ningún partido." },
      source: "data/events.js policy.ages",
      verified: "2026-11-09",
      confidence: "med",
      audience: "public",
      note: "A draft chapter policy, not an outside fact. The chapter must confirm it before launch (placeholder: chapter-confirm)."
    },
    "dues": {
      claim: { en: "YDSC dues are $20 a year, paid in January; members who can't pay can join as non-voting members.", es: "La cuota de YDSC es de $20 al año y se paga en enero; quienes no pueden pagar pueden unirse como miembros sin voto." },
      source: "https://secure.actblue.com/donate/ydscdues",
      verified: "2026-11-09",
      confidence: "high",
      audience: "public",
      via: "docs/research/00 and 02"
    },
    "ages": {
      claim: { en: "Members are 14 to under 40.", es: "Los miembros tienen de 14 años a menos de 40." },
      source: "https://secure.actblue.com/donate/ydscdues",
      verified: "2026-11-09",
      confidence: "high",
      audience: "public",
      via: "docs/research/00"
    },
    "tiktok-gpppa": {
      claim: { en: "TikTok turns off advertising for politician and political party accounts, removes gifting, tipping and e-commerce, and disallows campaign fundraising solicitation, such as a party directing people to a donation page.", es: "TikTok desactiva la publicidad en cuentas de políticos y partidos, les quita regalos, propinas y comercio electrónico, y no permite pedir donaciones de campaña, como que un partido mande a la gente a una página para donar." },
      source: "https://newsroom.tiktok.com/updating-our-policies-for-political-accounts?lang=en",
      verified: "2026-11-09",
      confidence: "high",
      audience: "editor",
      note: "Announced Sep 21, 2022. Treat the chapter's TikTok as a party account: no donation links or asks there."
    },
    "tiktok-branded": {
      claim: { en: "TikTok's ads policy bars paid political ads and creators being compensated for branded political content.", es: "La política de anuncios de TikTok prohíbe los anuncios políticos pagados y que se les pague a creadores por contenido político patrocinado." },
      source: "https://ads.tiktok.com/resources/help/article/tiktok-ads-policy-politics-government-and-elections?lang=en",
      verified: "2026-11-09",
      confidence: "high",
      audience: "editor"
    },
    "meta-siep": {
      claim: { en: "Meta requires advertisers to complete authorization and add a verified 'Paid for by' disclaimer to ads about social issues, elections or politics; ads without one are disapproved.", es: "Meta exige que los anunciantes completen una autorización y agreguen un aviso verificado de 'Pagado por' en los anuncios sobre temas sociales, elecciones o política; los que no lo tienen se rechazan." },
      source: "https://transparency.meta.com/policies/ad-standards/SIEP-advertising/SIEP/",
      verified: "2026-11-09",
      confidence: "high",
      audience: "editor"
    },
    "fl-disclaimer-exempt": {
      claim: { en: "Florida's political-ad disclaimer rule exempts free posts on sites that cost nothing to post on and unpaid accounts where the source is clear; paid ads need 'Pd. pol. adv.' plus who paid and their address.", es: "La regla de Florida sobre avisos en publicidad política exime las publicaciones gratuitas en sitios donde publicar no cuesta y las cuentas no pagadas donde está claro quién publica; los anuncios pagados necesitan 'Pd. pol. adv.' más quién pagó y su dirección." },
      source: "http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0100-0199/0106/Sections/0106.143.html",
      verified: "2026-11-09",
      confidence: "high",
      audience: "editor",
      via: "docs/research/06 section 7.1",
      note: "Counsel decides committee status (F.S. 106.011(16)) and final wording. No paid boosts until then."
    },
    "usc-10307c": {
      claim: { en: "Federal law makes it a crime to pay, offer to pay or accept payment for registering to vote or for voting in elections with federal candidates.", es: "La ley federal castiga pagar, ofrecer pagar o aceptar pago por inscribirse para votar o por votar en elecciones con candidatos federales." },
      source: "https://www.law.cornell.edu/uscode/text/52/10307",
      verified: "2026-11-09",
      confidence: "high",
      audience: "editor"
    }
  },

  recheck: {
    by: "2026-12-15",
    items: [
      "SOE: how Seminole treats mail-ballot requests made Nov 4 to Dec 31, 2026 (the state rule says through 2028). If Seminole confirms, flip 'set a reminder' to 'renew now' and set confirmed['soe-2027-requests-open'].",
      "HB 991 student-ID lawsuit (NAACP, filed Oct 16, 2026): any court order. gc02, v02, v12, carousel slide 5 and the Day 8, 21, 30 and Jan 1 calm posts change the same day if it does. Re-check Dec 9, Dec 22, Dec 31 and Jan 1.",
      "Certified Nov 3 results from the Supervisor of Elections (replace 'about 54% to 45%, unofficial').",
      "Whether the SOE has posted the Nov 2, 2027 city elections (Lake Mary, Altamonte Springs still 'expected'; any race with one qualified candidate comes off the ballot).",
      "Jan 1, 2027 morning: confirm the official request page accepts 2027-28 requests before any 'renew now' post goes out."
    ]
  }
};
