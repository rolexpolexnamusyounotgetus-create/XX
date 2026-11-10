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
 * Facts: shown when someone taps a sticker (YSD.ui.stickerFacts). Each fact carries its source:
 *   source { url, label: { en, es } }. ui.js renders the label in the page language through
 *   t('a11y.source'); a Spanish label notes "(en inglés)" when the page it cites is English only.
 *   kind: 'fact'    a checkable claim: source.url is the citation, verified is when it was checked
 *         'promise' something this site commits to; source.url is the page that keeps the promise
 *   expires + next: the fact stops showing at `expires` and `next` (an evergreen version) takes over.
 * Facts marked verified "2026-11-09" were checked in docs/research/01 §7-8 (Sanford, Lake Jesup,
 * Oviedo, Big Tree Park, minimum wage), docs/research/03 §5 (Celery City, UCF RICHES), 04 Part C
 * (CDC) and docs/research/00 (the mail-ballot rule and its required wording).
 *
 * Facts marked verified "2026-11-10" (round 1, right-wing-sticker-art: eight new pieces so the sticker book
 * has 15 distinct arts) were checked by G-CORE against the cited page that day: FWC (Lake Monroe acreage),
 * Save the Manatee Club (Oct 2024 sightings: a Blue Spring manatee at the Sanford Marina), the county's 2023
 * trails guide (Cross Seminole Trail, about 30 miles), F.S. 286.0114 (public comment), the county library's
 * card page (free for residents, owners and county public-school students; five branches), Florida EDR's
 * county profile (23.1% speak a language other than English at home, Census ACS), US Fish & Wildlife
 * (Wekiva: Wild and Scenic since Oct 13, 2000) and F.S. 15.031 (sabal palm, 1953).
 * Not drawn: a sky lantern. Sky lanterns are a fire and litter hazard and we found no county source to cite,
 * so the two bilingual speech bubbles (a county language fact) took that slot.
 *
 * The 18 arts: celery gator train chicken cypress sun envelope heart calendar camera lake manatee bike
 * megaphone library bubbles wekiva palm. Suggested one-art-per-sticker map for data/levels.js (15 distinct,
 * envelope kept off rewards because it is a civic step): doors-open heart · saved-seat calendar ·
 * first-night celery · golden-hour lake · on-the-platform train · trivia-brain gator · plus-one chicken ·
 * squad-of-three manatee · on-camera camera · shift-done megaphone · city-hopper bike · bridge-builder
 * bubbles · card-maker library · quiz-done sun · long-game cypress. Spares: wekiva, palm, envelope.
 *
 * Word stickers (Caveat Brush on a pill, .word-sticker): English pages use `en`, Spanish pages use
 * `es`. Never show a Spanish word sticker on an English page or the reverse. Lowercase on purpose:
 * they are handwritten notes, not branding.
 *
 * Load: classic script, any time before assets/js/ui.js (the scripts partial loads it). No functions.
 */
window.YSD_DATA = window.YSD_DATA || {};
window.YSD_DATA.stickers = {
  version: 2,
  updated: "2026-11-10",
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
      source: { url: "https://richesmi.cah.ucf.edu/omeka/exhibits/show/origins_of_the_celery_city", label: { en: "UCF RICHES", es: "UCF RICHES (en inglés)" } },
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
      source: { url: "https://en.wikipedia.org/wiki/Lake_Jesup", label: { en: "Wikipedia: Lake Jesup", es: "Wikipedia: lago Jesup (en inglés)" } },
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
      source: { url: "https://sunrail.com/stations/", label: { en: "SunRail stations", es: "estaciones de SunRail" } },
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
      source: { url: "https://en.wikipedia.org/wiki/Oviedo,_Florida", label: { en: "Wikipedia: Oviedo", es: "Wikipedia: Oviedo (en inglés)" } },
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
      source: { url: "https://en.wikipedia.org/wiki/The_Senator_(tree)", label: { en: "Wikipedia: The Senator", es: "Wikipedia: The Senator (en inglés)" } },
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
      source: { url: "https://www.flsenate.gov/Laws/Constitution", label: { en: "Florida Constitution, Art. X §24", es: "Constitución de Florida, art. X §24 (en inglés)" } },
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
      source: { url: "https://www.flsenate.gov/Laws/Statutes/2025/101.62", label: { en: "F.S. 101.62", es: "Ley de Florida 101.62 (en inglés)" } },
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
      source: { url: "conduct.html", label: { en: "Code of conduct", es: "Código de conducta" } },
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
      source: { url: "events.html", label: { en: "Events", es: "Eventos" } },
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
      source: { url: "https://www.cdc.gov/disability-and-health/articles-documents/disability-impacts-all-of-us-infographic.html", label: { en: "CDC: Disability Impacts All of Us", es: "CDC: La discapacidad nos afecta a todos (en inglés)" } },
      verified: "2026-11-09", confidence: "high",
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><circle cx="60" cy="60" r="56" fill="#FF4FA3" stroke="#170B33" stroke-width="4"/><g stroke="#170B33" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"><rect x="36" y="16" width="48" height="88" rx="12" fill="#FFF6EA"/><rect x="42" y="26" width="36" height="64" rx="5" fill="#6A2BFF"/><path d="M54 46L70 56L54 66Z" fill="#C8F03C"/></g><circle cx="71" cy="33" r="4" fill="#FF8B3D" stroke="#170B33" stroke-width="2"/><rect x="45" y="74" width="30" height="11" rx="3" fill="#170B33"/><path d="M49 78H71M49 82H64" stroke="#FFF6EA" stroke-width="2" stroke-linecap="round"/></svg>'
    },
    {
      id: "lake",
      name: { en: "Lake Monroe sunset", es: "atardecer en el lago Monroe" },
      motif: "Sunset over Lake Monroe, with a pier",
      kind: "fact",
      fact: {
        en: "The St. Johns River flows through 9,406-acre Lake Monroe, and Sanford sits on its southern shore. Golden hour here is a local sport.",
        es: "El río St. Johns atraviesa el lago Monroe, de 9,406 acres, y Sanford está en su orilla sur. Ver el atardecer aquí es deporte local."
      },
      source: { url: "https://myfwc.com/fishing/freshwater/sites-forecasts/ne/lake-monroe", label: { en: "FWC: Lake Monroe", es: "FWC: lago Monroe (en inglés)" } },
      verified: "2026-11-10", confidence: "high",
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><circle cx="60" cy="60" r="56" fill="#FFD23F"/><g stroke="#FF8B3D" stroke-width="3" stroke-linecap="round" opacity=".9"><path d="M60 22V30M36 30l5 6M84 30l-5 6M22 48h8M90 48h8"/></g><path d="M30 66A30 30 0 0 1 90 66Z" fill="#FF6B1A" stroke="#170B33" stroke-width="3.5" stroke-linejoin="round"/><path d="M4.3 66H115.7A56 56 0 0 1 4.3 66Z" fill="#2236C9"/><g stroke="#FFD23F" stroke-width="3.5" stroke-linecap="round"><path d="M38 75H82M46 84H74M53 93H67"/></g><g stroke="#FFF6EA" stroke-width="2.5" stroke-linecap="round" opacity=".55"><path d="M16 80H28M94 88H104M20 96H30"/></g><path d="M4.3 66H115.7" stroke="#170B33" stroke-width="3.5"/><g stroke="#170B33" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="#FFF6EA"><path d="M84 60H112V66H84Z"/><path d="M88 66V80M100 66V82M110 66V76" fill="none"/></g><circle cx="60" cy="60" r="56" fill="none" stroke="#170B33" stroke-width="4"/></svg>'
    },
    {
      id: "manatee",
      name: { en: "manatee", es: "manatí" },
      motif: "A manatee with a paddle tail",
      kind: "fact",
      fact: {
        en: "In warm months, manatees from Blue Spring swim up the St. Johns. One was spotted at the Sanford Marina on Lake Monroe in July 2024.",
        es: "En los meses cálidos, los manatíes de Blue Spring remontan el río St. Johns. En julio de 2024 vieron uno en la marina de Sanford, en el lago Monroe."
      },
      source: { url: "https://savethemanatee.org/manatee-sightings-october-2024/", label: { en: "Save the Manatee Club", es: "Save the Manatee Club (en inglés)" } },
      verified: "2026-11-10", confidence: "high",
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><circle cx="60" cy="60" r="56" fill="#00B3A6"/><g fill="none" stroke="#FFF6EA" stroke-width="3" stroke-linecap="round" opacity=".55"><path d="M18 40q8-5 16 0M84 96q8-5 16 0"/></g><path d="M30 64C24 50 10 50 9 62C8 76 22 80 32 70Z" fill="#A9B8C8" stroke="#170B33" stroke-width="3.5" stroke-linejoin="round"/><path d="M30 60C36 48 54 40 74 42C94 44 104 54 103 66C102 78 90 86 72 86C54 86 40 82 31 72C29 68 29 64 30 60Z" fill="#A9B8C8" stroke="#170B33" stroke-width="3.5" stroke-linejoin="round"/><path d="M93 52C102 50 108 56 106 66C104 72 98 74 94 72" fill="#C4D0DC" stroke="#170B33" stroke-width="3.5" stroke-linejoin="round"/><circle cx="88" cy="56" r="3" fill="#170B33"/><g stroke="#170B33" stroke-width="2" stroke-linecap="round"><path d="M104 63l6-2M104 67l6 1M103 70l5 3"/></g><path d="M66 78C64 88 58 94 52 94C50 90 54 84 60 78" fill="#C4D0DC" stroke="#170B33" stroke-width="3.5" stroke-linejoin="round"/><path d="M46 56C52 52 60 50 66 51" fill="none" stroke="#FFF6EA" stroke-width="3" stroke-linecap="round" opacity=".7"/><g fill="#FFF6EA" stroke="#170B33" stroke-width="2.5"><circle cx="96" cy="34" r="5"/><circle cx="86" cy="26" r="3.5"/></g><circle cx="60" cy="60" r="56" fill="none" stroke="#170B33" stroke-width="4"/></svg>'
    },
    {
      id: "bike",
      name: { en: "trail bike", es: "bici del sendero" },
      motif: "A bicycle on a trail line",
      kind: "fact",
      fact: {
        en: "The paved Cross Seminole Trail runs about 30 miles across the county, through downtown Oviedo and Lake Mary, and crosses I-4 on a footbridge.",
        es: "El Cross Seminole Trail, un sendero pavimentado, recorre unas 30 millas del condado, pasa por el centro de Oviedo y por Lake Mary, y cruza la I-4 por un puente peatonal."
      },
      source: { url: "https://www.seminolecountyfl.gov/docs/default-source/pdf/nl-trails-parks-and-natural-lands-brochure-2023-for-web.pdf", label: { en: "Seminole County trails guide (2023)", es: "Guía de senderos del condado de Seminole, 2023 (en inglés)" } },
      verified: "2026-11-10", confidence: "high",
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><circle cx="60" cy="60" r="56" fill="#6A2BFF"/><path d="M10 86H110" stroke="#FFF6EA" stroke-width="3" stroke-linecap="round" stroke-dasharray="8 7" opacity=".6"/><g fill="#FFF6EA" stroke="#170B33" stroke-width="3.5"><circle cx="34" cy="72" r="17"/><circle cx="86" cy="72" r="17"/></g><g fill="#6A2BFF" stroke="#170B33" stroke-width="2.5"><circle cx="34" cy="72" r="5"/><circle cx="86" cy="72" r="5"/></g><path d="M34 72L50 46H80L86 72M50 46L60 72L80 46M60 72H34" fill="none" stroke="#170B33" stroke-width="8" stroke-linejoin="round" stroke-linecap="round"/><path d="M34 72L50 46H80L86 72M50 46L60 72L80 46M60 72H34" fill="none" stroke="#C8F03C" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/><path d="M48 40H60" stroke="#170B33" stroke-width="6" stroke-linecap="round"/><path d="M50 46L48 40" stroke="#170B33" stroke-width="4" stroke-linecap="round"/><path d="M80 46L77 34H86" fill="none" stroke="#170B33" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="60" cy="72" r="4" fill="#FFD23F" stroke="#170B33" stroke-width="2.5"/><circle cx="60" cy="60" r="56" fill="none" stroke="#170B33" stroke-width="4"/></svg>'
    },
    {
      id: "megaphone",
      name: { en: "megaphone", es: "megáfono" },
      motif: "A megaphone with sound waves",
      kind: "fact",
      fact: {
        en: "Florida law gives the public a reasonable chance to be heard before most city and county board decisions (F.S. 286.0114). Public comment is yours.",
        es: "La ley de Florida le da al público una oportunidad razonable de hablar antes de la mayoría de las decisiones de las juntas municipales y del condado (F.S. 286.0114). El comentario público es tuyo."
      },
      source: { url: "https://www.flsenate.gov/Laws/Statutes/2025/286.0114", label: { en: "Florida Statutes 286.0114", es: "Estatutos de Florida 286.0114 (en inglés)" } },
      verified: "2026-11-10", confidence: "high",
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><circle cx="60" cy="60" r="56" fill="#FF4FA3"/><g transform="rotate(-14 60 60)"><path d="M28 52H40L76 34V86L40 68H28Z" fill="#FFF6EA" stroke="#170B33" stroke-width="3.5" stroke-linejoin="round"/><path d="M28 52V68H22C19 68 18 66 18 64V56C18 54 19 52 22 52Z" fill="#6A2BFF" stroke="#170B33" stroke-width="3.5" stroke-linejoin="round"/><path d="M40 52V68" stroke="#170B33" stroke-width="3"/><path d="M54 45V75" stroke="#6A2BFF" stroke-width="7"/><ellipse cx="76" cy="60" rx="6" ry="26" fill="#FFD23F" stroke="#170B33" stroke-width="3.5"/><path d="M38 68L44 84H52L48 72" fill="#FFF6EA" stroke="#170B33" stroke-width="3.5" stroke-linejoin="round"/><g fill="none" stroke="#170B33" stroke-width="4" stroke-linecap="round"><path d="M90 46q8 14 0 28M98 38q14 22 0 44"/></g></g><circle cx="60" cy="60" r="56" fill="none" stroke="#170B33" stroke-width="4"/></svg>'
    },
    {
      id: "library",
      name: { en: "library card", es: "tarjeta de la biblioteca" },
      motif: "A library card with a book and a barcode",
      kind: "fact",
      fact: {
        en: "Seminole County library cards are free if you live here, own property here or go to a county public school, and they work at all five branches.",
        es: "La tarjeta de la biblioteca del condado de Seminole es gratis si vives aquí, tienes una propiedad aquí o estudias en una escuela pública del condado, y sirve en las cinco sucursales."
      },
      source: { url: "https://www.seminolecountyfl.gov/departments-services/parks-recreation/seminole-county-library/library-information/library-cards", label: { en: "Seminole County Library", es: "Biblioteca del condado de Seminole (en inglés)" } },
      verified: "2026-11-10", confidence: "high",
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><circle cx="60" cy="60" r="56" fill="#FF6B1A"/><g transform="rotate(-10 60 60)"><rect x="18" y="34" width="84" height="54" rx="8" fill="#FFF6EA" stroke="#170B33" stroke-width="3.5"/><path d="M20 36H100V48H20Z" fill="#6A2BFF"/><path d="M18 48H102" stroke="#170B33" stroke-width="3"/><rect x="18" y="34" width="84" height="54" rx="8" fill="none" stroke="#170B33" stroke-width="3.5"/><path d="M28 56C34 54 40 54 44 57C48 54 54 54 60 56V76C54 74 48 74 44 77C40 74 34 74 28 76Z" fill="#C8F03C" stroke="#170B33" stroke-width="3" stroke-linejoin="round"/><path d="M44 57V77" stroke="#170B33" stroke-width="2.5"/><g stroke="#170B33" stroke-width="2.6"><path d="M68 58V78M72 58V78M77 58V78M80 58V78M85 58V78M88 58V78M92 58V78"/></g><circle cx="92" cy="42" r="3" fill="#C8F03C"/></g><circle cx="60" cy="60" r="56" fill="none" stroke="#170B33" stroke-width="4"/></svg>'
    },
    {
      id: "bubbles",
      name: { en: "two speech bubbles", es: "dos burbujas de diálogo" },
      motif: "Two speech bubbles: typing dots, and ¡!",
      kind: "fact",
      fact: {
        en: "Almost 1 in 4 people in Seminole County (23.1%) speak a language other than English at home. Every page here has a Spanish twin.",
        es: "Casi 1 de cada 4 personas en el condado de Seminole (23.1 %) habla en casa un idioma que no es el inglés. Cada página aquí tiene su versión en español."
      },
      source: { url: "https://www.edr.state.fl.us/content/area-profiles/county/seminole.pdf", label: { en: "Florida EDR county profile (Census data)", es: "Perfil del condado, Florida EDR, datos del Censo (en inglés)" } },
      verified: "2026-11-10", confidence: "high",
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><circle cx="60" cy="60" r="56" fill="#4FD6FF"/><path d="M18 30H66Q74 30 74 38V58Q74 66 66 66H36L24 78L27 66H18Q12 66 12 58V38Q12 30 18 30Z" fill="#FFF6EA" stroke="#170B33" stroke-width="3.5" stroke-linejoin="round"/><g fill="#6A2BFF"><circle cx="30" cy="48" r="4.5"/><circle cx="43" cy="48" r="4.5"/><circle cx="56" cy="48" r="4.5"/></g><path d="M54 56H100Q108 56 108 64V82Q108 90 100 90H92L96 102L82 90H54Q46 90 46 82V64Q46 56 54 56Z" fill="#C8F03C" stroke="#170B33" stroke-width="3.5" stroke-linejoin="round"/><g fill="#170B33"><circle cx="69" cy="66" r="2.8"/><path d="M72 84h-6l1-12h4Z"/><path d="M78 66h6l-1 12h-4Z"/><circle cx="81" cy="83" r="2.8"/></g><circle cx="60" cy="60" r="56" fill="none" stroke="#170B33" stroke-width="4"/></svg>'
    },
    {
      id: "wekiva",
      name: { en: "Wekiva kayak", es: "kayak en el Wekiva" },
      motif: "A kayak on a clear spring run",
      kind: "fact",
      fact: {
        en: "The Wekiva River, along Seminole's western edge, has been a National Wild and Scenic River since Oct 13, 2000.",
        es: "El río Wekiva, en el borde oeste de Seminole, es Río Nacional Salvaje y Escénico desde el 13 de octubre de 2000."
      },
      source: { url: "https://www.fws.gov/rivers/river/wekiva", label: { en: "US Fish & Wildlife Service: Wekiva River", es: "Servicio de Pesca y Vida Silvestre de EE. UU.: río Wekiva (en inglés)" } },
      verified: "2026-11-10", confidence: "high",
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><circle cx="60" cy="60" r="56" fill="#7EE081"/><path d="M8 50C30 42 42 56 60 50C78 44 92 56 112 48V78C92 86 78 72 60 78C42 84 30 70 8 78Z" fill="#4FD6FF" stroke="#170B33" stroke-width="3.5" stroke-linejoin="round"/><g fill="none" stroke="#FFF6EA" stroke-width="2.5" stroke-linecap="round" opacity=".8"><path d="M20 62q6-3 12 0M84 70q6-3 12 0M74 56q5-2 10 0"/></g><path d="M30 66C44 72 76 72 92 64C80 60 44 60 30 66Z" fill="#FF8B3D" stroke="#170B33" stroke-width="3.5" stroke-linejoin="round"/><ellipse cx="61" cy="65" rx="9" ry="3" fill="#170B33"/><path d="M44 82L80 46" stroke="#170B33" stroke-width="3.5" stroke-linecap="round"/><g fill="#FFD23F" stroke="#170B33" stroke-width="3" stroke-linejoin="round"><path d="M38 86L44 80L48 84L42 90Z"/><path d="M76 50L82 44L86 48L80 54Z"/></g><g fill="none" stroke="#2F7A14" stroke-width="3" stroke-linecap="round"><path d="M28 40L24 26M32 40V24M36 40L40 27M84 98L80 86M88 98V84M92 98L96 87"/></g><g fill="#B07A45" stroke="#170B33" stroke-width="2"><rect x="29.5" y="20" width="5" height="10" rx="2.5"/><rect x="85.5" y="80" width="5" height="10" rx="2.5"/></g><circle cx="60" cy="60" r="56" fill="none" stroke="#170B33" stroke-width="4"/></svg>'
    },
    {
      id: "palm",
      name: { en: "sabal palm", es: "palma sabal" },
      motif: "A sabal palm at sunset",
      kind: "fact",
      fact: {
        en: "The sabal palm, also called the cabbage palm, has been Florida's state tree since 1953.",
        es: "La palma sabal, también llamada palma de col, es el árbol oficial de Florida desde 1953."
      },
      source: { url: "https://www.flsenate.gov/Laws/Statutes/2025/15.031", label: { en: "Florida Statutes 15.031", es: "Estatutos de Florida 15.031 (en inglés)" } },
      verified: "2026-11-10", confidence: "high",
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><circle cx="60" cy="60" r="56" fill="#FF7AC6"/><circle cx="84" cy="80" r="14" fill="#FFD23F" stroke="#170B33" stroke-width="3"/><path d="M10.5 88H109.5A56 56 0 0 1 10.5 88Z" fill="#45B649" stroke="#170B33" stroke-width="3.5" stroke-linejoin="round"/><path d="M56 98C58 80 60 62 58 44L64 44C66 62 66 80 64 98Z" fill="#B07A45" stroke="#170B33" stroke-width="3.5" stroke-linejoin="round"/><g stroke="#170B33" stroke-width="2" stroke-linecap="round" opacity=".7"><path d="M58 58h6M58 70h6M58 82h6"/></g><g fill="#2F9A3A" stroke="#170B33" stroke-width="3" stroke-linejoin="round"><path d="M61 44C50 30 34 28 20 34C34 34 44 38 50 46Z"/><path d="M61 44C72 30 88 28 102 34C88 34 78 38 72 46Z"/><path d="M61 44C54 32 52 22 56 14C58 24 62 32 66 40Z"/><path d="M61 44C48 42 34 48 26 60C38 52 48 50 56 50Z"/><path d="M61 44C74 42 88 48 96 60C84 52 74 50 66 50Z"/></g><circle cx="61" cy="45" r="4.5" fill="#B07A45" stroke="#170B33" stroke-width="2.5"/><circle cx="60" cy="60" r="56" fill="none" stroke="#170B33" stroke-width="4"/></svg>'
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
