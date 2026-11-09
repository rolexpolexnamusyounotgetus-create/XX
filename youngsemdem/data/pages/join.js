/*!
 * data/pages/join.js (W6): page copy for join.html (EN + ES), plus the "join:" strings that
 * assets/js/joinform.js reads (form.*, done.*, step2.*, mc.*; joinform.js carries an identical
 * fallback for pages that don't load this file). Shared strings (form labels, errors, success lines,
 * join.*) live in data/strings.js and reach the page through data/slices/core.js and data/slices/join.js.
 *
 * Facts used here: membership is ages 14 to 39 (under 40); dues are $20 a year, due in January;
 * voting members live in Seminole County or go to school here; non-voting membership is free for
 * anyone who qualifies but can't pay, money or citizenship status (YDSC's ActBlue dues page,
 * https://secure.actblue.com/donate/ydscdues, checked Mon, Nov 9, 2026; BRIEF 9). Line 26 (chip-in)
 * is BRIEF 2.7. Spanish is a draft until a fluent reviewer signs off.
 */
window.YSD_DATA = window.YSD_DATA || {};
window.YSD_DATA.pages = window.YSD_DATA.pages || {};
window.YSD_DATA.pages.join = {
  'og.alt': { en: "Join the Young Dems. Come as you are. Bring a friend. Young Democrats of Seminole County, ages 14 to 39. DEMO preview.", es: "Únete a los Young Dems. Ven como eres. Trae a alguien. Young Democrats of Seminole County, de 14 a 39 años. Vista previa DEMO." },
  'og.kicker': { en: "JOIN FREE", es: "ÚNETE GRATIS" },

  'hero.eyebrow': { en: "YOUNG DEMS · AGES 14 TO 39", es: "YOUNG DEMS · DE 14 A 39 AÑOS" },
  'hero.title': { en: "Join free.", es: "Únete gratis." },
  'hero.kicker': { en: "We saved you a seat.", es: "Te guardamos un lugar." },
  'hero.r1': { en: "Under a minute", es: "Menos de un minuto" },
  'hero.r2': { en: "3 questions", es: "3 preguntas" },
  'hero.r3': { en: "Money optional", es: "El dinero es opcional" },
  'hero.secondary': { en: "See how dues work", es: "Mira cómo va la cuota" },
  'hero.receiptsLabel': { en: "Joining at a glance", es: "Unirte, en resumen" },

  'pass.kind': { en: "MEMBER", es: "MIEMBRO" },
  'pass.name': { en: "Your name", es: "Tu nombre" },
  'pass.county': { en: "Seminole County", es: "Condado de Seminole" },
  'pass.since': { en: "Member since {month}", es: "Miembro desde {month}" },
  'pass.sinceStatic': { en: "Member since Nov 2026", es: "Miembro desde nov. 2026" },
  'pass.stamp': { en: "You're in", es: "Ya eres parte" },

  'consent.before': { en: "By joining, you'll get updates from YDSC. We never sell your info. See our", es: "Al unirte, recibirás novedades de YDSC. Nunca vendemos tus datos. Consulta nuestra" },
  'consent.link': { en: "Privacy Policy", es: "Política de privacidad" },

  'tiers.eyebrow': { en: "MEMBERSHIP", es: "MEMBRESÍA" },
  'tiers.title': { en: "$20 a year. Or free.", es: "$20 al año. O gratis." },
  'tier1.name': { en: "Come to things", es: "Ven a lo que quieras" },
  'tier1.what': { en: "Join the list, come to every event, make cards, post clips.", es: "Únete a la lista, ven a todos los eventos, haz tarjetas y sube clips." },
  'tier1.l1': { en: "The Thursday Letter, once a week", es: "La Carta del Jueves, una vez por semana" },
  'tier1.l2': { en: "Events are open to any party or none", es: "Eventos abiertos a cualquier partido o a ninguno" },
  'tier2.name': { en: "Voting member", es: "Miembro con voto" },
  'tier2.per': { en: "a year, due in January", es: "al año, se paga en enero" },
  'tier2.what': { en: "Vote and make motions at chapter meetings.", es: "Vota y presenta mociones en las reuniones del capítulo." },
  'tier2.cta': { en: "Pay dues on ActBlue", es: "Paga la cuota en ActBlue" },
  'tier3.name': { en: "Non-voting member", es: "Miembro sin voto" },
  'tier3.what': { en: "For anyone who qualifies but can't pay dues, whatever the reason, money or citizenship status.", es: "Para quien cumple los requisitos pero no puede pagar la cuota, sea cual sea la razón: dinero o situación de ciudadanía." },
  'tier3.l1': { en: "No dues, no questions asked", es: "Sin cuota y sin preguntas" },
  'tiers.source': { en: "From YDSC's dues page on ActBlue, checked Nov 9, 2026.", es: "Según la página de cuotas de YDSC en ActBlue, revisada el 9 de noviembre de 2026." },
  'tiers.sourceLink': { en: "See the dues page", es: "Ver la página de cuotas" },

  'next.eyebrow': { en: "AFTER YOU JOIN", es: "DESPUÉS DE UNIRTE" },
  'next.title': { en: "What happens next", es: "Qué sigue" },
  'next.s1.title': { en: "We say hi.", es: "Te saludamos." },
  'next.s1.body': { en: "A short welcome in English or Spanish, your pick. No quiz, no homework.", es: "Una bienvenida corta, en inglés o en español, como prefieras. Sin examen y sin tarea." },
  'next.s2.title': { en: "We invite you to one thing near you.", es: "Te invitamos a algo cerca de ti." },
  'next.s2.body': { en: "A trivia night, a sunset walk, a text bank. Bring a friend so you're not the only new person.", es: "Una noche de trivia, una caminata al atardecer, una jornada de mensajes. Trae a alguien para no ser la única persona nueva." },
  'next.s3.title': { en: "We only send what you asked for.", es: "Solo te mandamos lo que pediste." },
  'next.s3.body': { en: "One letter a week, on Thursdays. Texts only if you tick the box.", es: "Una carta por semana, los jueves. Mensajes de texto solo si marcas la casilla." },
  'next.sticker': { en: "first time? perfect", es: "¿primera vez? perfecto" },
  'next.shareLead': { en: "Know someone who'd come with you? Send them this page.", es: "¿Conoces a alguien que vendría contigo? Mándale esta página." },

  'card.eyebrow': { en: "YOURS WHEN YOU JOIN", es: "TUYO AL UNIRTE" },
  'card.title': { en: "Your card, your link, your stickers.", es: "Tu tarjeta, tu enlace, tus stickers." },
  'card.sub': { en: "A member card with your first name, an invite link that gives you credit when friends join, and a sticker book. Stickers are for showing up and bringing friends, never for voting.", es: "Una tarjeta de miembro con tu nombre, un enlace de invitación que te da crédito cuando alguien se une y un álbum de stickers. Los stickers son por ir y por traer gente, nunca por votar." },
  'card.lockedCta': { en: "Join to get yours", es: "Únete y es tuya" },
  'card.lockedNote': { en: "Preview. Your card shows up here once you join.", es: "Vista previa. Tu tarjeta aparece aquí cuando te unes." },
  'pack.title': { en: "The county sticker pack", es: "El paquete de stickers del condado" },
  'pack.body': { en: "Ten die-cut stickers drawn from Seminole: celery, a gator, SunRail, an Oviedo chicken and more. Tap one for a local fact.", es: "Diez stickers troquelados inspirados en Seminole: apio, un caimán, SunRail, una gallina de Oviedo y más. Toca uno para ver un dato local." },
  'pack.cta': { en: "Download the pack (PNG)", es: "Descargar el paquete (PNG)" },
  'pack.locked': { en: "Unlocks when you join. It's free.", es: "Se desbloquea al unirte. Es gratis." },
  'pack.done': { en: "Sticker pack saved.", es: "Paquete de stickers guardado." },
  'pack.file': { en: "young-dems-sticker-pack.png", es: "young-dems-paquete-de-stickers.png" },

  'chip.title': { en: "Got $5 to spare?", es: "¿Te sobran $5?" },
  'chip.body': { en: "That's coffee for one volunteer night. Don't have it? Come anyway.", es: "Eso es el café de una noche de voluntariado. ¿No los tienes? Ven de todos modos." },
  'chip.cta': { en: "Chip in $5", es: "Aporta $5" },

  'landing.from': { en: "{from} invited you to the Young Dems.", es: "{from} te invitó a los Young Dems." },
  'landing.generic': { en: "A friend invited you to the Young Dems.", es: "Alguien te invitó a los Young Dems." },
  'landing.sub': { en: "Join free and come to the next thing together.", es: "Únete gratis y vengan juntos a lo próximo." },

  // joinform.js strings (identical fallback copy lives in assets/js/joinform.js)
  'form.contactHint': { en: "One is enough. For your invites and the Thursday Letter, never more than once a week.", es: "Con uno basta. Para tus invitaciones y la Carta del Jueves, nunca más de una vez por semana." },
  'done.title': { en: "You're in, {name}.", es: "Ya eres parte, {name}." },
  'done.already': { en: "You're already in, {name}.", es: "Ya eres parte, {name}." },
  'done.listed': { en: "You're on the list, {name}.", es: "Ya estás en la lista, {name}." },
  'done.reset': { en: "Not {name}? Start over", es: "¿No eres {name}? Empezar de nuevo" },
  'done.card': { en: "See your card", es: "Ver tu tarjeta" },
  'done.more': { en: "Pick your city and issues", es: "Elige tu ciudad y tus temas" },
  'step2.title': { en: "Make it yours", es: "Hazlo tuyo" },
  'step2.sub': { en: "All optional. Skip anything, change it anytime.", es: "Todo es opcional. Sáltate lo que quieras y cámbialo cuando quieras." },
  'step2.issues': { en: "What do you care about? Pick any.", es: "¿Qué te importa? Elige los que quieras." },
  'step2.save': { en: "Save my picks", es: "Guardar mis opciones" },
  'step2.saved': { en: "Saved. We'll only send what matches.", es: "Guardado. Solo te mandamos lo que coincida." },
  'step2.summary': { en: "Your picks", es: "Lo que elegiste" },
  'step2.none': { en: "Nothing picked yet.", es: "Todavía no elegiste nada." },
  'mc.title': { en: "Your invite link", es: "Tu enlace de invitación" },
  'mc.since': { en: "Member since {month}", es: "Miembro desde {month}" },
  'mc.showName': { en: "Show my first name on my link", es: "Mostrar mi nombre en mi enlace" },
  'mc.squad': { en: "Friends who joined with your link: {count} of 3. Three friends, not 300.", es: "Personas que se unieron con tu enlace: {count} de 3. Tres, no 300." },
  'mc.squadHint': { en: "DEMO: only joins on this device count.", es: "DEMO: solo cuentan las uniones en este dispositivo." }
};
