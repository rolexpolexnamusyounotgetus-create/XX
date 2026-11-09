/*!
 * data/stickers.js: the die-cut county stickers and the word stickers, EN + ES.   STATUS: DRAFT
 * window.YSD_DATA.stickers                                         Owner: F0, then the lead.
 *
 * BRIEF §3.7. Every sticker is drawn from Seminole County itself (Sanford's celery, Lake Jesup's
 * gators, SunRail, Oviedo's chickens, Longwood's cypress) or from the site's own promises. There is
 * NO Native American imagery or language here, by rule (docs/research/00, brand safety): the county
 * is named for the Seminole people, so the art comes from the place, never from that name.
 *
 * Art: one SVG string per sticker (viewBox 0 0 120 120, no ids, no text, no external refs), so the
 * same art renders inline in the DOM (YSD.ui.stickers, inside .sticker) and on canvas as
 * data:image/svg+xml (YSD.ui.stickerDataUrl(id)) with no canvas tainting on file://. The white
 * die-cut edge is a CSS drop-shadow chain in the DOM and a stroked outline on canvas.
 *
 * Facts: shown when someone taps a sticker (YSD.ui.stickerFacts). Each fact carries its source.
 *   kind: 'fact'    a checkable claim: source.url is the citation, verified is when it was checked
 *         'promise' something this site commits to; source.url is the page that keeps the promise
 *   expires + next: the fact stops showing at `expires` and `next` (an evergreen version) takes over.
 * Facts marked verified "2026-11-09" were checked in docs/research/01 §7-8 (Sanford, Lake Jesup,
 * Oviedo, Big Tree Park, minimum wage), docs/research/03 §5 (Celery City, UCF RICHES), 04 Part C
 * (CDC) and docs/research/00 (the mail-ballot rule and its required wording).
 *
 * Word stickers (Caveat Brush on a pill, .word-sticker): English pages use `en`, Spanish pages use
 * `es`. Never show a Spanish word sticker on an English page or the reverse. Lowercase on purpose:
 * they are handwritten notes, not branding.
 *
 * Load: classic script, any time before assets/js/ui.js (the scripts partial loads it). No functions.
 */
window.YSD_DATA = window.YSD_DATA || {};
window.YSD_DATA.stickers = {
  version: 1,
  updated: "2026-11-09",
  reviewedSpanish: false,
  items: [
    {
      id: "celery",
      name: { en: "celery", es: "apio" },
      motif: "A celery bunch with a violet band",
      kind: "fact",
      fact: {
        en: "Sanford was known as the Celery City by about 1900, when its celery farms made its name.",
        es: "Hacia 1900 a Sanford ya la llamaban la Ciudad del Apio (Celery City), por sus cultivos de apio."
      },
      source: { url: "https://richesmi.cah.ucf.edu/omeka/exhibits/show/origins_of_the_celery_city", label: "UCF RICHES" },
      verified: "2026-11-09", confidence: "high",
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><circle cx="60" cy="60" r="56" fill="#C8F03C" stroke="#170B33" stroke-width="4"/><g stroke="#170B33" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"><path d="M47 104C45 84 43 64 38 46L49 43C53 62 56 82 58 104Z" fill="#7BC043"/><path d="M78 104C77 84 79 64 85 47L95 51C89 67 86 85 87 104Z" fill="#6DB33A"/><path d="M56 104C57 82 58 60 58 40H69C68 60 67 82 67 104Z" fill="#A6DB5E"/><circle cx="42" cy="38" r="9" fill="#3F9A2C"/><circle cx="33" cy="31" r="7" fill="#3F9A2C"/><circle cx="63" cy="31" r="10" fill="#3F9A2C"/><circle cx="54" cy="22" r="7" fill="#3F9A2C"/><circle cx="72" cy="22" r="7" fill="#3F9A2C"/><circle cx="90" cy="42" r="9" fill="#3F9A2C"/><circle cx="98" cy="34" r="6" fill="#3F9A2C"/><rect x="44" y="80" width="46" height="10" rx="4" fill="#6A2BFF"/></g><path d="M62 50V74M51 56L53 74M84 60L82 74" stroke="#2F7A14" stroke-width="2" stroke-linecap="round" opacity=".6"/></svg>'
    },
    {
      id: "gator",
      name: { en: "gator", es: "caimán" },
      motif: "A gator peeking out of Lake Jesup",
      kind: "fact",
      fact: {
        en: "Lake Jesup, Seminole's biggest lake, has one of Florida's densest alligator populations.",
        es: "El lago Jesup, el más grande de Seminole, tiene una de las poblaciones de caimanes más densas de Florida."
      },
      source: { url: "https://en.wikipedia.org/wiki/Lake_Jesup", label: "Wikipedia: Lake Jesup" },
      verified: "2026-11-09", confidence: "med",
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><circle cx="60" cy="60" r="56" fill="#4FD6FF"/><path d="M15 80C15 66 28 58 44 58L96 60C107 60 111 67 109 73C107 79 101 81 92 81L30 83C21 83 15 82 15 80Z" fill="#45B649" stroke="#170B33" stroke-width="3.5" stroke-linejoin="round"/><circle cx="38" cy="54" r="11" fill="#45B649" stroke="#170B33" stroke-width="3.5"/><circle cx="58" cy="54" r="11" fill="#45B649" stroke="#170B33" stroke-width="3.5"/><circle cx="38" cy="53" r="6.5" fill="#fff"/><circle cx="58" cy="53" r="6.5" fill="#fff"/><circle cx="40" cy="54" r="3.2" fill="#170B33"/><circle cx="60" cy="54" r="3.2" fill="#170B33"/><circle cx="101" cy="66" r="2.2" fill="#170B33"/><circle cx="94" cy="65" r="2.2" fill="#170B33"/><path d="M38 75L104 73" stroke="#170B33" stroke-width="3" stroke-linecap="round"/><path d="M50 75l3 4l3-4ZM66 74.5l3 4l3-4ZM82 74l3 4l3-4Z" fill="#fff" stroke="#170B33" stroke-width="1.8" stroke-linejoin="round"/><path d="M10.4 86Q24 79 36 86T61 86T86 86T109.6 86A56 56 0 0 1 10.4 86Z" fill="#2A8FE0"/><path d="M18 98Q28 93 38 98M72 102Q82 97 92 102" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" opacity=".7"/><circle cx="60" cy="60" r="56" fill="none" stroke="#170B33" stroke-width="4"/></svg>'
    },
    {
      id: "train",
      name: { en: "SunRail train", es: "tren SunRail" },
      motif: "A commuter-train front",
      kind: "fact",
      fact: {
        en: "SunRail stops at four Seminole stations: Altamonte Springs, Longwood, Lake Mary and Sanford.",
        es: "SunRail para en cuatro estaciones de Seminole: Altamonte Springs, Longwood, Lake Mary y Sanford."
      },
      source: { url: "https://sunrail.com/stations/", label: "SunRail stations" },
      verified: "2026-11-09", confidence: "high",
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><circle cx="60" cy="60" r="56" fill="#FF8B3D" stroke="#170B33" stroke-width="4"/><g stroke="#170B33" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"><rect x="33" y="22" width="54" height="72" rx="15" fill="#FFF6EA"/><rect x="40" y="30" width="40" height="24" rx="7" fill="#4FD6FF"/><rect x="33" y="62" width="54" height="9" fill="#6A2BFF"/><circle cx="45" cy="81" r="5" fill="#C8F03C"/><circle cx="75" cy="81" r="5" fill="#C8F03C"/><path d="M41 94L31 106M79 94L89 106M24 106H96" fill="none"/></g></svg>'
    },
    {
      id: "chicken",
      name: { en: "Oviedo chicken", es: "gallina de Oviedo" },
      motif: "A chicken",
      kind: "fact",
      fact: {
        en: "Oviedo's free-roaming downtown chickens are local legend. Growth ended most of the roaming, so these days it's mostly nostalgia.",
        es: "Las gallinas sueltas del centro de Oviedo son leyenda local. Con el crecimiento casi dejaron de andar por ahí, así que hoy es más que nada nostalgia."
      },
      source: { url: "https://en.wikipedia.org/wiki/Oviedo,_Florida", label: "Wikipedia: Oviedo" },
      verified: "2026-11-09", confidence: "med",
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><circle cx="60" cy="60" r="56" fill="#FF7AC6" stroke="#170B33" stroke-width="4"/><g stroke="#170B33" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"><path d="M55 96V106M67 96V106" stroke="#FF8B3D" stroke-width="4.5"/><path d="M38 88C26 80 28 56 44 50C46 36 58 30 68 36C76 40 76 50 72 56C86 54 98 60 96 74C94 90 76 96 60 96C50 96 44 92 38 88Z" fill="#fff"/><path d="M54 35C53 26 60 24 62 30C64 22 73 24 70 33" fill="#FF4D6D"/><path d="M44 47L33 51L44 55Z" fill="#FF8B3D"/><path d="M62 70C70 62 84 66 84 74C78 80 68 80 62 70Z" fill="#FFE3F2"/></g><circle cx="52" cy="44" r="3.2" fill="#170B33"/></svg>'
    },
    {
      id: "cypress",
      name: { en: "young cypress", es: "ciprés joven" },
      motif: "A young bald cypress with its knees, after The Phoenix at Big Tree Park",
      kind: "fact",
      fact: {
        en: "Longwood's Big Tree Park was home to The Senator, a bald cypress about 3,500 years old that burned in 2012. A clone called The Phoenix was planted when the park reopened in 2014.",
        es: "En Big Tree Park, en Longwood, vivía The Senator, un ciprés calvo de unos 3,500 años que se quemó en 2012. Cuando el parque reabrió en 2014, plantaron un clon llamado The Phoenix."
      },
      source: { url: "https://en.wikipedia.org/wiki/The_Senator_(tree)", label: "Wikipedia: The Senator" },
      verified: "2026-11-09", confidence: "med",
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><circle cx="60" cy="60" r="56" fill="#7EE081" stroke="#170B33" stroke-width="4"/><path d="M14 88H106A56 56 0 0 1 14 88Z" fill="#2A8FE0"/><g stroke="#170B33" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"><path d="M54 92C55 80 56 70 56 60H64C64 70 65 80 66 92C70 94 74 95 78 95H42C46 95 50 94 54 92Z" fill="#9C6B3F"/><path d="M33 96C33 92 35 90 37 90C39 90 41 92 41 96Z" fill="#9C6B3F"/><path d="M80 96C80 92 82 90 84 90C86 90 88 92 88 96Z" fill="#9C6B3F"/><path d="M60 14C66 24 74 30 72 38C80 42 84 50 80 56C88 60 88 70 78 72C70 74 66 70 60 70C54 70 50 74 42 72C32 70 32 60 40 56C36 50 40 42 48 38C46 30 54 24 60 14Z" fill="#2E9E57"/><path d="M60 26C63 32 66 36 64 42M52 48C56 52 62 52 66 50M46 60C52 64 66 64 74 60" fill="none" stroke="#1B6B3A" stroke-width="2.5"/></g><circle cx="88" cy="30" r="9" fill="#FFD23F" stroke="#170B33" stroke-width="3"/></svg>'
    },
    {
      id: "sun",
      name: { en: "sun in sunglasses", es: "sol con lentes" },
      motif: "A sun in sunglasses",
      kind: "fact",
      fact: {
        en: "Florida's minimum wage reached $15 an hour on Sep 30, 2026. From Sep 30, 2027, it rises with inflation every year.",
        es: "El salario mínimo de Florida llegó a $15 la hora el 30 de septiembre de 2026. Desde el 30 de septiembre de 2027 sube cada año con la inflación."
      },
      source: { url: "https://www.flsenate.gov/Laws/Constitution", label: "Florida Constitution, Art. X §24" },
      verified: "2026-11-09", confidence: "high",
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><circle cx="60" cy="60" r="56" fill="#4FD6FF" stroke="#170B33" stroke-width="4"/><path d="M60 14V24M60 96V106M14 60H24M96 60H106M27 27L34 34M86 86L93 93M93 27L86 34M34 86L27 93" stroke="#FF8B3D" stroke-width="6" stroke-linecap="round"/><circle cx="60" cy="60" r="29" fill="#FFD23F" stroke="#170B33" stroke-width="3.5"/><path d="M36 55H84" stroke="#170B33" stroke-width="4" stroke-linecap="round"/><rect x="38" y="52" width="19" height="13" rx="6" fill="#170B33"/><rect x="63" y="52" width="19" height="13" rx="6" fill="#170B33"/><path d="M49 73Q60 82 71 73" fill="none" stroke="#170B33" stroke-width="3.5" stroke-linecap="round"/></svg>'
    },
    {
      id: "envelope",
      name: { en: "mail ballot", es: "boleta por correo" },
      motif: "A mail-ballot envelope with a check",
      kind: "fact",
      tone: "civic",
      fact: {
        en: "Asked for a mail ballot before Nov 3? That request ends Dec 31. Ask again and you should be set through 2028. Check My Voter Record to be sure.",
        es: "¿Pediste la boleta por correo antes del 3 de noviembre? Esa solicitud vence el 31 de diciembre. Pídela otra vez y debería cubrirte hasta 2028. Revisa tu registro de votante para confirmarlo."
      },
      expires: "2027-01-01T00:00:00-05:00",
      next: {
        en: "A Florida mail-ballot request lasts through the end of the calendar year of the next general election. Check My Voter Record to see yours.",
        es: "En Florida, una solicitud de boleta por correo dura hasta el final del año de las siguientes elecciones generales. Revisa tu registro de votante para ver la tuya."
      },
      source: { url: "https://www.flsenate.gov/Laws/Statutes/2025/101.62", label: "F.S. 101.62" },
      verified: "2026-11-09", confidence: "high",
      note: "Required wording, docs/research/00 (copy shape). Civic content: never paired with confetti or a reward.",
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><circle cx="60" cy="60" r="56" fill="#FF8B3D" stroke="#170B33" stroke-width="4"/><g stroke="#170B33" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"><rect x="22" y="36" width="72" height="50" rx="7" fill="#fff"/><path d="M22 41L58 66L94 41" fill="none"/><circle cx="88" cy="84" r="16" fill="#C8F03C"/><path d="M80 84L86 90L96 78" fill="none" stroke-width="4"/></g></svg>'
    },
    {
      id: "heart",
      name: { en: "heart", es: "corazón" },
      motif: "A heart in a speech bubble",
      kind: "promise",
      fact: {
        en: "Come as you are: LGBTQ+, disabled and Spanish-speaking neighbors, first-timers and the not-yet-sure are all welcome here.",
        es: "Ven como eres: aquí son bienvenidas las personas LGBTQ+, con discapacidad, hispanohablantes, las que vienen por primera vez y las que todavía no están seguras."
      },
      source: { url: "conduct.html", label: "Code of conduct" },
      verified: "2026-11-09", confidence: "high",
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><circle cx="60" cy="60" r="56" fill="#6A2BFF" stroke="#170B33" stroke-width="4"/><g stroke="#170B33" stroke-width="3.5" stroke-linejoin="round"><path d="M24 32H96a9 9 0 0 1 9 9V75a9 9 0 0 1-9 9H54L36 99L39 84H24a9 9 0 0 1-9-9V41a9 9 0 0 1 9-9Z" fill="#fff"/><path d="M60 76C46 67 40 61 40 53C40 47 45 43 50 43C55 43 58 46 60 49C62 46 65 43 70 43C75 43 80 47 80 53C80 61 74 67 60 76Z" fill="#FF7AC6"/></g></svg>'
    },
    {
      id: "calendar",
      name: { en: "calendar", es: "calendario" },
      motif: "A calendar page with a check: your saved seat",
      kind: "promise",
      fact: {
        en: "Saved seat. Every invite here lists the time, the cost and an access note, and goes on your calendar in one tap.",
        es: "Lugar guardado. Cada invitación aquí dice la hora, el costo y una nota de accesibilidad, y se agrega a tu calendario con un toque."
      },
      source: { url: "events.html", label: "Events" },
      verified: "2026-11-09", confidence: "high",
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><circle cx="60" cy="60" r="56" fill="#4FD6FF" stroke="#170B33" stroke-width="4"/><g stroke="#170B33" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"><rect x="26" y="30" width="66" height="62" rx="9" fill="#FFF6EA"/><path d="M26 39a9 9 0 0 1 9-9H83a9 9 0 0 1 9 9V48H26Z" fill="#6A2BFF"/><path d="M42 24V36M76 24V36" stroke-width="5"/></g><g fill="#170B33"><circle cx="40" cy="60" r="3.5"/><circle cx="53" cy="60" r="3.5"/><circle cx="66" cy="60" r="3.5"/><circle cx="79" cy="60" r="3.5"/><circle cx="40" cy="74" r="3.5"/><circle cx="53" cy="74" r="3.5"/></g><g stroke="#170B33" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"><circle cx="84" cy="84" r="17" fill="#C8F03C"/><path d="M76 84L82 90L92 78" fill="none" stroke-width="4"/></g></svg>'
    },
    {
      id: "camera",
      name: { en: "phone camera", es: "cámara del celular" },
      motif: "A phone filming, captions on",
      kind: "fact",
      fact: {
        en: "Captions on, always. Every clip here has captions and a transcript, because up to 1 in 4 US adults has a disability (CDC).",
        es: "Subtítulos siempre. Cada clip aquí tiene subtítulos y transcripción, porque hasta 1 de cada 4 adultos en EE. UU. tiene una discapacidad (CDC)."
      },
      source: { url: "https://www.cdc.gov/disability-and-health/articles-documents/disability-impacts-all-of-us-infographic.html", label: "CDC: Disability Impacts All of Us" },
      verified: "2026-11-09", confidence: "high",
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><circle cx="60" cy="60" r="56" fill="#FF4FA3" stroke="#170B33" stroke-width="4"/><g stroke="#170B33" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"><rect x="36" y="16" width="48" height="88" rx="12" fill="#FFF6EA"/><rect x="42" y="26" width="36" height="64" rx="5" fill="#6A2BFF"/><path d="M54 46L70 56L54 66Z" fill="#C8F03C"/></g><circle cx="71" cy="33" r="4" fill="#FF8B3D" stroke="#170B33" stroke-width="2"/><rect x="45" y="74" width="30" height="11" rx="3" fill="#170B33"/><path d="M49 78H71M49 82H64" stroke="#FFF6EA" stroke-width="2" stroke-linecap="round"/></svg>'
    }
  ],
  words: [
    { id: "first-time", en: "first time? perfect", es: "¿primera vez? perfecto", color: "celery" },
    { id: "come-as-you-are", en: "come as you are", es: "ven como eres", color: "bubblegum" },
    { id: "official-links", en: "official links only", es: "solo enlaces oficiales", color: "sky" },
    { id: "captions", en: "captions on, always", es: "subtítulos siempre", color: "sun" },
    { id: "bring-a-friend", en: "bring a friend", es: "trae a alguien", color: "mint" },
    { id: "rest-counts", en: "rest counts too", es: "descansar también cuenta", color: "sky" }
  ]
};
