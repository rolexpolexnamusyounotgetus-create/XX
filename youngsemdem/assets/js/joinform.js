/*!
 * assets/js/joinform.js (W6, round 1 G-JOIN): the join form, used by join.html, newsletter.html (compact, step two
 * inline) and home (W1, compact).
 *
 * CONTRACT
 *   YSD.joinForm.mount(formEl, opts?) -> controller { form, root, member(), reset(), showStep2(opts), intent() }
 *     formEl   a <form data-join-form> (static markup from join.html, or an EMPTY form: then the
 *              standard fields are rendered from data/slices/core.js strings, so any page can drop in
 *              <form class="form" name="join" data-join-form data-compact></form>).
 *     opts     { compact: bool        (default: form has [data-compact]) three fields, short success,
 *                                       no step two inline (it links to join.html#more instead)
 *                step2Inline: bool     compact only (default: form[data-step2="inline"]): "Pick your city and issues"
 *                                       opens step two right there instead of linking to join.html#more
 *                step2: Element|'#sel' where step two and the picks summary mount (default: form[data-step2-host], else
 *                                       right after the form). Its [data-join-more] ancestor (or itself) is hidden until
 *                                       a member exists. join.html puts it in <section id="more"> below the hero.
 *                headingLevel: 2 | 3  (default: form[data-heading] or 3) level of the success heading
 *                titles: { done, already }  string keys for the success heading (default: form[data-title-done],
 *                                       form[data-title-already]; else "You're in, {name}." / "You're already in, {name}.")
 *                moreHref: '#more'     full mode: adds "Pick your city and crew" to the success panel (form[data-more-href])
 *                source: 'join'|'home'|'newsletter'  (default: <html data-page>) stored as joinSource
 *                card: Element|null    where to mount the member card after joining (default: the
 *                                       element [data-join-card] names, or none)
 *                cardHref: '#card'     shows "See your card" in the success panel (default: form[data-card-href])
 *                prefill: bool         (default true) fill first name and contact from the last RSVP on this device
 *                                       (store 'rsvp:last' {firstName, contact}, else the newest 'rsvp:<id>') when
 *                                       nobody has joined yet; age stays blank. Also after an RSVP on the same page.
 *                intent: bool          (default true) read ?intent=host|crew|role|volunteer and &crew=<id> from the URL:
 *                                       step one shows a matching heading and a pre-ticked "I want to..." box, and the
 *                                       intent rides in the join payload
 *              Rendered (empty) forms also read form[data-submit-key] for the button label (default cta.join).
 *                onJoined(member, {isNew, compact, resumed})   called after every successful join (and "Back to {name}")
 *                onSaved(member)       called after step two is saved }
 *   Auto-mount: every form[data-join-form] without [data-join-manual] mounts when ui.js is ready.
 *   YSD.joinForm.parseContact('407 555 0123') -> { phone } | { email } | { email, noAt: true } | {}
 *   YSD.joinForm.urlIntent() -> { intent: 'host'|'crew'|'role'|'volunteer'|'', crew: '<id>'|'' }
 *
 *   Fields (3 required, BRIEF 4.2): firstName, contact (email OR mobile, one field), age (free entry,
 *   the FTC's neutral age screen; never pre-filled, never a list of allowed ages), plus the hidden
 *   honeypot _hp. Validation is YSD.members.validate; errors render through YSD.ui.form.errors
 *   (aria-invalid, aria-describedby = hint + error, an error summary that takes focus).
 *   Under 14: the friendly too-young message shows, the inputs are cleared and NOTHING is stored or
 *   sent (members.join is never called). Under 18: members.js gives a random-style refCode, and this
 *   module never adds a `from` name to a teen's links. The ref captured on arrival (share.js) is
 *   frozen into the member as referredBy by members.join.
 *   Payload fields this module adds (strings, so members.js keeps and submits them): intent (comma list of
 *   intents, 'host,volunteer'), crew (the crew someone wants to start), crews (comma list of crews to hear about),
 *   plus city, interests, langPref, access, guardianEmail (14 to 17), smsOptIn with smsConsentVersion/At.
 *   Ids come from window.YSD_DATA.joinPicks (data/pages/join.js); without it step two skips intents and crews.
 *   Success: line 13 (success.join.*), toast.joined, confetti (YSD.ui.confetti: no-op under reduced
 *   motion or Pause motion), focus moves to the success heading, the member card mounts
 *   (YSD.memberCard.mount from W5 when present, else a small built-in card with your link and the
 *   squad meter, simulated members filtered out). The join sticker is W5's: membercard.js hears
 *   ysd:joined (members.js) and logs the organizing action itself, so this module awards nothing.
 *   "Not {name}? Start over" (journeys-06) asks first, then calls YSD.members.reset(): the member is archived
 *   into this browser's join log (kept, so friends credited to their code still count), their stickers, streak and
 *   RSVPs leave, and ?ref in the current URL is captured again, so a friend joining on the same phone through the
 *   member's own link is credited to that member. The idle form then offers "Back to {name}"
 *   (YSD.members.resume), which shows the squad meter moving on one device.
 *   Step two (all optional): "I want to..." intents, city chips (city colourways; the city's DEMO crew shows under
 *   them), DEMO crews (identity crews), issue chips (data/issues.js or a slice with items[].id/title/color; falls
 *   back to the core form.wants.* list), language, access needs, a guardian email for ages 14 to 17, and the SMS
 *   opt-in (unchecked, legal wording, only when a mobile number was given and the member is 18 or older; teens see
 *   form.consent.smsTeen). The SMS consent version is recorded with the member (smsConsentVersion, smsConsentAt).
 *   #more (journeys-11): a member opening <page>#more gets step two painted, scrolled to and focused.
 *   DOM events (document, via YSD.emit): ysd:join-form-joined {member, isNew, compact, resumed},
 *   ysd:join-form-saved {member}, ysd:join-form-too-young {}, ysd:join-form-reset {previous},
 *   ysd:join-form-step2 {member}.
 *   Rendered markup uses only core component classes (.form .field .chip .btn .notice .consent
 *   .stack .cluster), so it looks right on any page; hooks are data-join-*; style extras under your
 *   page class. Copy: data/slices/core.js, then data/pages/join.js ("join:" keys) when loaded, else
 *   the built-in fallback below (kept identical to data/pages/join.js).
 *   Analytics: YSD.track('join_step2', {fields}) only; members.js tracks 'join'. No personal data, no crews.
 */
(function (w, d) {
  'use strict';
  var YSD = w.YSD = w.YSD || {};

  // Fallback copy for the strings core.js doesn't have. Mirrors data/pages/join.js; keep in sync.
  var FALLBACK = {
    'form.contactHint': { en: 'One is enough. For your invites and the Thursday Letter, never more than once a week.', es: 'Con uno basta. Para tus invitaciones y la Carta del Jueves, nunca más de una vez por semana.' },
    'done.title': { en: "You're in, {name}.", es: 'Ya eres parte, {name}.' },
    'done.already': { en: "You're already in, {name}.", es: 'Ya eres parte, {name}.' },
    'done.listed': { en: "You're on the list, {name}.", es: 'Ya estás en la lista, {name}.' },
    'done.reset': { en: 'Not {name}? Start over', es: '¿No eres {name}? Empezar de nuevo' },
    'done.resetAsk': { en: "Start over on this phone? {name}'s card, stickers and RSVPs leave this browser. {name}'s join stays on the list.", es: '¿Empezar de nuevo en este teléfono? La tarjeta, los stickers y las confirmaciones de {name} salen de este navegador. Su registro se queda en la lista.' },
    'done.resetYes': { en: 'Start over', es: 'Empezar de nuevo' },
    'done.resetNo': { en: 'Keep {name}', es: 'Seguir como {name}' },
    'done.switchLabel': { en: 'Joined on this phone before:', es: 'Ya se unieron en este teléfono:' },
    'done.switch': { en: 'Back to {name}', es: 'Volver a {name}' },
    'done.resumed': { en: 'Back to {name}. Friends who joined with this link here: {count} of 3.', es: 'De vuelta, {name}. Personas que se unieron con este enlace aquí: {count} de 3.' },
    'done.card': { en: 'See your card', es: 'Ver tu tarjeta' },
    'done.more': { en: 'Pick your city and issues', es: 'Elige tu ciudad y tus temas' },
    'done.moreFull': { en: 'Pick your city and crew', es: 'Elige tu ciudad y tu grupo' },
    'step2.title': { en: 'Make it yours', es: 'Hazlo tuyo' },
    'step2.sub': { en: 'All optional. Skip anything, change it anytime.', es: 'Todo es opcional. Sáltate lo que quieras y cámbialo cuando quieras.' },
    'step2.issues': { en: 'What do you care about? Pick any.', es: '¿Qué te importa? Elige los que quieras.' },
    'step2.save': { en: 'Save my picks', es: 'Guardar mis opciones' },
    'step2.saved': { en: "Saved. We'll only send what matches.", es: 'Guardado. Solo te mandamos lo que coincida.' },
    'step2.summary': { en: 'Your picks', es: 'Lo que elegiste' },
    'step2.none': { en: 'Nothing picked yet.', es: 'Todavía no elegiste nada.' },
    'prefill.note': { en: 'Filled in from your RSVP on this phone.', es: 'Lo llenamos con tu confirmación en este teléfono.' },
    'prefill.clear': { en: 'Clear', es: 'Borrar' },
    'intent.label': { en: 'I want to…', es: 'Quiero…' },
    'intent.hint': { en: 'Pick any. It tells us what to send you first.', es: 'Elige lo que quieras. Así sabemos qué mandarte primero.' },
    'crews.label': { en: 'Find your crew (DEMO)', es: 'Encuentra tu grupo (DEMO)' },
    'crews.hint': { en: "Crews are DEMO ideas waiting for a host. Pick any and we'll tell you when one starts. Only the chapter sees this: never your card, never your link.", es: 'Los grupos son ideas DEMO que esperan a alguien que los organice. Elige los que quieras y te avisamos cuando empiece uno. Solo lo ve el capítulo: nunca tu tarjeta ni tu enlace.' },
    'crews.city': { en: 'Your city crew: {crew} (DEMO, needs a host)', es: 'Tu grupo de la ciudad: {crew} (DEMO, busca anfitrión)' },
    'crews.cityStart': { en: "Your city crew: {crew} (DEMO). You'd be starting it.", es: 'Tu grupo de la ciudad: {crew} (DEMO). Lo empezarías tú.' },
    'mc.title': { en: 'Your invite link', es: 'Tu enlace de invitación' },
    'mc.since': { en: 'Member since {month}', es: 'Miembro desde {month}' },
    'mc.showName': { en: 'Show my first name on my link', es: 'Mostrar mi nombre en mi enlace' },
    'mc.squad': { en: 'Friends who joined with your link: {count} of 3. Three friends, not 300.', es: 'Personas que se unieron con tu enlace: {count} de 3. Tres, no 300.' },
    'mc.squadHint': { en: 'DEMO: this counts friends who joined with your link in this browser.', es: 'DEMO: esto cuenta a quienes se unieron con tu enlace en este navegador.' }
  };
  // City ids match data/sharekit.js cities (W5's member card); 'seminole' = unincorporated Seminole.
  var CITIES = [
    ['sanford', 'Sanford', 'celery'], ['lake-mary', 'Lake Mary', 'sky'], ['oviedo', 'Oviedo', 'tangerine'],
    ['winter-springs', 'Winter Springs', 'mint'], ['altamonte-springs', 'Altamonte Springs', 'bubblegum'],
    ['casselberry', 'Casselberry', 'hotpink'], ['longwood', 'Longwood', 'teal'],
    ['seminole', 'form.city.unincorporated', 'unincorporated'], ['outside', 'form.city.outside', ''], ['not-sure', 'form.city.notSure', '']
  ];
  var WANTS = ['social', 'volunteer', 'voting', 'learn', 'create', 'spanish', 'students', 'lgbtq'];
  var INTENTS = ['host', 'crew', 'role', 'volunteer'];
  var SMS_VERSION_FALLBACK = 'sms-consent-2026-11-09-draft';
  var uidN = 0;

  function lang() { return YSD.lang === 'es' ? 'es' : 'en'; }
  function L(o) { return o == null ? '' : typeof o === 'string' ? o : (o[lang()] != null ? o[lang()] : (o.en || '')); }
  function fillVars(s, vars) {
    return String(s).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? String(vars[k]) : m; });
  }
  function pageStrings() { var P = (w.YSD_DATA || {}).pages; return (P && P.join) || null; }
  /** Core or page string, then the built-in fallback. Keys without a namespace try "join:" first when it has them. */
  function T(key, vars) {
    var v = '', P = pageStrings();
    if (typeof YSD.t === 'function') {
      if (key.indexOf(':') < 0 && ((P && P[key]) || FALLBACK[key])) v = YSD.t('join:' + key, vars);
      else v = YSD.t(key, vars);
    }
    if (!v && P && P[key]) v = fillVars(L(P[key]), vars);
    if (!v && FALLBACK[key]) v = fillVars(FALLBACK[key][lang()] || FALLBACK[key].en, vars);
    return v || '';
  }
  function el(tag, attrs, kids) {
    var n = d.createElement(tag);
    for (var k in attrs || {}) {
      if (!Object.prototype.hasOwnProperty.call(attrs, k) || attrs[k] == null || attrs[k] === false) continue;
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else n.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? d.createTextNode(c) : c); });
    return n;
  }
  function uid(p) { uidN += 1; return 'jf' + uidN + '-' + p; }
  function emit(n, det) { if (typeof YSD.emit === 'function') YSD.emit(n, det); }
  function track(e, p) { try { if (typeof YSD.track === 'function') YSD.track(e, p); } catch (x) {} }
  function cfg(p, fb) { return typeof YSD.cfg === 'function' ? YSD.cfg(p, fb) : fb; }
  function sget(k, fb) { try { return YSD.store ? YSD.store.get(k, fb) : fb; } catch (e) { return fb; } }
  function pageHref(file) {
    var root = YSD.root || '';
    return root + (lang() === 'es' ? 'es/' : '') + file;
  }
  function reduced() { return YSD.ui && YSD.ui.motion ? YSD.ui.motion.paused() : false; }
  function toast(text, tone, priority) { if (YSD.ui && YSD.ui.toast && text) YSD.ui.toast(text, { tone: tone || 'success', priority: priority }); }
  function focusEl(n) { if (!n) return; if (!n.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(n.tagName)) n.setAttribute('tabindex', '-1'); try { n.focus({ preventScroll: true }); } catch (e) { n.focus(); } }
  function jumpTo(n) {
    if (!n) return;
    if (YSD.ui && typeof YSD.ui.jump === 'function') { YSD.ui.jump(n); return; }
    try { n.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' }); } catch (e) { n.scrollIntoView(); }
    focusEl(n.querySelector('h2, h3, h4') || n);
  }

  /** Split "Email or mobile" into what members.validate expects. */
  function parseContact(raw) {
    var v = String(raw == null ? '' : raw).trim();
    if (!v) return {};
    if (v.indexOf('@') >= 0) return { email: v };
    var digits = v.replace(/\D/g, '');
    if (/^[\d\s().+\-]+$/.test(v) && digits.length >= 7) return { phone: v };
    return { email: v, noAt: true };
  }
  function parseAge(raw) {
    var v = String(raw == null ? '' : raw).trim();
    if (!/^\d{1,3}$/.test(v)) return NaN;
    var n = parseInt(v, 10);
    return n > 0 && n < 120 ? n : NaN;
  }

  // ---------------------------------------------------------------- picks: intents and crews (data/pages/join.js)
  function picksData() { return (w.YSD_DATA || {}).joinPicks || null; }
  function intentIds() { var P = picksData(); return P && Array.isArray(P.intents) ? P.intents.map(function (x) { return x.id; }) : INTENTS; }
  function intentOf(id) { var P = picksData(); return P && Array.isArray(P.intents) ? P.intents.filter(function (x) { return x.id === id; })[0] || null : null; }
  function crewId(raw) {
    var v = String(raw == null ? '' : raw).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40), P = picksData();
    if (v && P && P.aliases && P.aliases[v]) v = P.aliases[v];
    return v;
  }
  function crewName(id) {
    var P = picksData();
    if (!P || !id) return '';
    var c = (P.crews || []).filter(function (x) { return x.id === id; })[0];
    if (c) return L(c.name);
    return P.cityCrews && P.cityCrews[id] ? P.cityCrews[id].name : '';
  }
  function cityCrew(city) { var P = picksData(); var id = P && P.cityToCrew ? P.cityToCrew[city] : ''; return id && P.cityCrews && P.cityCrews[id] ? id : ''; }
  function list(s) { return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); }
  /** ?intent=host|crew|role|volunteer and &crew=<id> on this page's URL (anything else is ignored). */
  function urlIntent() {
    var out = { intent: '', crew: '' };
    try {
      var q = new URLSearchParams(w.location.search);
      var i = String(q.get('intent') || '').toLowerCase();
      if (intentIds().indexOf(i) >= 0) out.intent = i;
      out.crew = crewId(q.get('crew'));
      if (out.crew && !out.intent) out.intent = 'crew';
    } catch (e) {}
    return out;
  }

  /** Text with its link label turned into a link (consent lines). */
  function linkify(text, label, href) {
    var frag = d.createDocumentFragment(), i = label ? text.indexOf(label) : -1;
    if (i < 0) { frag.appendChild(d.createTextNode(text)); return frag; }
    frag.appendChild(d.createTextNode(text.slice(0, i)));
    frag.appendChild(el('a', { href: href, text: label }));
    frag.appendChild(d.createTextNode(text.slice(i + label.length)));
    return frag;
  }

  // ---------------------------------------------------------------- step one markup (empty forms)
  function renderFields(form, compact) {
    var first = uid('first'), contact = uid('contact'), age = uid('age'), hp = uid('hp');
    form.classList.add('form');
    if (!form.getAttribute('name')) form.setAttribute('name', 'join');
    form.setAttribute('novalidate', '');
    var summary = el('div', { class: 'form__summary', hidden: true }, [el('p', { class: 'form__summary-title', 'data-summary-title': true }), el('ul')]);
    function field(id, name, label, input, hint) {
      var hid = hint ? id + '-hint' : null;
      if (hid) input.setAttribute('aria-describedby', hid);
      return el('div', { class: 'field' }, [
        el('label', { class: 'field__label', for: id, text: label }), input,
        hint ? el('p', { class: 'field__hint', id: hid, text: hint }) : null,
        el('p', { class: 'field__error', id: id + '-error', hidden: true })
      ]);
    }
    var row = el('div', { class: 'form__row' + (compact ? ' form__row--3' : '') }, [
      field(first, 'firstName', T('form.firstName.label'), el('input', { id: first, name: 'firstName', type: 'text', autocomplete: 'given-name', autocapitalize: 'words', maxlength: '60', required: true })),
      field(contact, 'contact', T('form.contact.label'), el('input', { id: contact, name: 'contact', type: 'text', inputmode: 'email', autocomplete: 'email', autocapitalize: 'off', spellcheck: 'false', maxlength: '254', required: true }), T('form.contactHint')),
      field(age, 'age', T('form.age.label'), el('input', { id: age, name: 'age', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '3', autocomplete: 'off', required: true }), T('form.age.hint'))
    ]);
    var trap = el('div', { class: 'u-visually-hidden', 'aria-hidden': 'true' }, [
      el('label', { for: hp, text: T('form.honeypot') || 'Leave this empty' }),
      el('input', { id: hp, name: '_hp', type: 'text', tabindex: '-1', autocomplete: 'off' })
    ]);
    var btn = el('button', { class: 'btn btn--primary btn--lg', type: 'submit', text: T(form.getAttribute('data-submit-key') || 'cta.join') || T('cta.join') });
    var consent = el('p', { class: 'consent' }, [el('span', {}, [linkify(T('form.consent.join'), T('form.consent.privacyLink'), pageHref('privacy.html'))])]);
    [summary, row, trap, el('div', { class: 'btn-row' }, [btn]), consent].forEach(function (n) { form.appendChild(n); });
  }

  // ---------------------------------------------------------------- the built-in member card (fallback)
  function monthLabel(ts) {
    try { return new Intl.DateTimeFormat(lang() === 'es' ? 'es-US' : 'en-US', { month: 'short', year: 'numeric', timeZone: 'America/New_York' }).format(new Date(ts || Date.now())).replace('.', ''); }
    catch (e) { return ''; }
  }
  function isMinor(m) { return m && typeof m.age === 'number' && m.age < 18; }
  function realSquad() {
    try { return (YSD.members.squad() || []).filter(function (x) { return x && x.simulated !== true; }); } catch (e) { return []; }
  }
  function fallbackCard(host, member) {
    host.textContent = '';
    var showName = !isMinor(member) && host.getAttribute('data-show-name') !== 'off';
    var linkEl = el('a', { class: 'link', 'data-join-link': true, rel: 'nofollow' });
    function link() {
      var params = { from: showName && !isMinor(member) ? String(member.firstName || '').replace(/[^\p{L}\s-]/gu, '').slice(0, 20) || null : false };
      return YSD.share && YSD.share.url ? YSD.share.url('join.html', params) : '';
    }
    function paint() {
      var u = link();
      linkEl.href = u || '#';
      linkEl.textContent = YSD.ui && YSD.ui.prettyLink ? YSD.ui.prettyLink(u) : u;
    }
    var copyBtn = el('button', { class: 'btn btn--ink btn--sm', type: 'button', text: T('cta.copyLink') });
    copyBtn.addEventListener('click', function () {
      var u = link();
      if (YSD.share && YSD.share.copy) YSD.share.copy(u).then(function (ok) { toast(ok ? T('toast.linkCopied') : T('error.share.failed'), ok ? 'success' : 'error', 'high'); });
    });
    var sendBtn = el('button', { class: 'btn btn--primary btn--sm', type: 'button', text: T('cta.shareGroup') });
    sendBtn.addEventListener('click', function () {
      var u = link();
      var text = (YSD.t && YSD.t('share.join.sms', { link: '' })) || '';
      text = text.replace(/\s*\{(?:link|url)\}\s*$/, '').trim();
      if (YSD.ui && YSD.ui.share) YSD.ui.share({ page: 'join', url: u, text: text || undefined });
    });
    var kids = [
      el('p', { class: 'eyebrow', text: T('mc.title') }),
      el('p', { class: 'h3', translate: 'no', text: String(member.firstName || '') }),
      el('p', { class: 'small muted', text: T('mc.since', { month: monthLabel(member.joinedAt) }) }),
      el('p', { class: 'x-card-link' }, [linkEl]),
      el('div', { class: 'btn-row' }, [sendBtn, copyBtn])
    ];
    if (!isMinor(member)) {
      var tog = el('button', { class: 'btn btn--quiet btn--sm', type: 'button', 'aria-pressed': showName ? 'true' : 'false', text: T('mc.showName') });
      tog.addEventListener('click', function () {
        showName = !showName;
        tog.setAttribute('aria-pressed', showName ? 'true' : 'false');
        host.setAttribute('data-show-name', showName ? 'on' : 'off');
        try { if (YSD.members && YSD.members.setShareName) YSD.members.setShareName(showName); } catch (x) {}
        paint();
      });
      kids.push(tog);
    }
    var meter = el('p', { class: 'small', 'data-join-squad': true });
    var hint = el('p', { class: 'small muted', text: T('mc.squadHint') });
    function paintSquad() { meter.textContent = T('mc.squad', { count: Math.min(realSquad().length, 3) }); }
    kids.push(meter, cfg('demo', true) !== false ? hint : null);
    host.appendChild(el('div', { class: 'stack stack--sm', 'data-join-fallback-card': true }, kids));
    paint(); paintSquad();
    if (YSD.members && YSD.members.onSquad) YSD.members.onSquad(paintSquad);
  }
  function mountCard(host, member) {
    if (!host) return;
    host.hidden = false;
    try {
      if (YSD.memberCard && typeof YSD.memberCard.mount === 'function') {
        if (host.__ysdCard && host.__ysdCard.destroy) host.__ysdCard.destroy();
        host.__ysdCard = YSD.memberCard.mount(host);   // kept so a page can refresh() it later
        return;
      }
    } catch (e) { if (YSD.log) YSD.log('joinform: memberCard.mount failed', e); }
    fallbackCard(host, member);
  }

  // ---------------------------------------------------------------- the last RSVP on this device (journeys-10)
  function lastRsvp() {
    var r = sget('rsvp:last', null);
    if (r && typeof r === 'object' && (r.firstName || r.contact)) return r;
    var best = null;
    try {
      var keys = YSD.store && YSD.store.keys ? YSD.store.keys() : [];
      keys.forEach(function (k) {
        if (k.indexOf('rsvp:') !== 0 || k === 'rsvp:queue' || k === 'rsvp:last') return;
        var v = sget(k, null);
        if (v && typeof v === 'object' && v.firstName && v.contact && (!best || (v.ts || 0) > (best.ts || 0))) best = v;
      });
    } catch (e) {}
    return best;
  }

  // ---------------------------------------------------------------- controller
  function mount(form, opts) {
    if (!form || form.__ysdJoin) return form && form.__ysdJoin;
    opts = opts || {};
    var compact = opts.compact != null ? !!opts.compact : form.hasAttribute('data-compact');
    var inline = compact && (opts.step2Inline != null ? !!opts.step2Inline : form.getAttribute('data-step2') === 'inline');
    var hasStep2 = !compact || inline;
    var level = String(opts.headingLevel || form.getAttribute('data-heading') || 3) === '2' ? 'h2' : 'h3';
    var source = opts.source || d.documentElement.getAttribute('data-page') || 'join';
    var root = form.closest('[data-join]') || form.parentNode;
    var cardHost = opts.card || (form.getAttribute('data-join-card') ? d.querySelector(form.getAttribute('data-join-card')) : null);
    var cardHref = opts.cardHref || form.getAttribute('data-card-href') || '';
    var moreHref = opts.moreHref || form.getAttribute('data-more-href') || '';
    var s2sel = opts.step2 || form.getAttribute('data-step2-host') || null;
    var s2host = typeof s2sel === 'string' ? d.querySelector(s2sel) : s2sel;
    var s2heading = s2host ? (form.getAttribute('data-step2-heading') === 'h3' ? 'h3' : 'h2') : (level === 'h2' ? 'h3' : 'h4');
    var titles = opts.titles || { done: form.getAttribute('data-title-done') || '', already: form.getAttribute('data-title-already') || '' };
    var want = opts.intent !== false ? urlIntent() : { intent: '', crew: '' };
    if (!form.querySelector('[name="firstName"]')) renderFields(form, compact);

    var f = {
      first: form.querySelector('[name="firstName"]'),
      contact: form.querySelector('[name="contact"]'),
      age: form.querySelector('[name="age"]'),
      hp: form.querySelector('[name="_hp"]'),
      btn: form.querySelector('[type="submit"]')
    };

    // panels created around the form
    var switchRow = el('div', { class: 'cluster cluster--sm', 'data-join-switch': true, hidden: true });
    form.parentNode.insertBefore(switchRow, form);
    var young = el('div', { class: 'notice notice--info', 'data-join-young': true, tabindex: '-1', hidden: true });
    var done = el('div', { class: 'stack', 'data-join-done': true, hidden: true });
    var step2 = hasStep2 ? el('form', { class: 'form', 'data-join-step2': true, novalidate: true, hidden: true }) : null;
    var picks = hasStep2 ? el('div', { class: 'stack stack--sm', 'data-join-picks': true, hidden: true }) : null;
    var anchor = form;
    [young, done].forEach(function (n) { anchor.parentNode.insertBefore(n, anchor.nextSibling); anchor = n; });
    if (s2host) { if (step2) s2host.appendChild(step2); if (picks) s2host.appendChild(picks); }
    else [step2, picks].forEach(function (n) { if (n) { anchor.parentNode.insertBefore(n, anchor.nextSibling); anchor = n; } });

    function setState(s) { if (root && root.setAttribute) root.setAttribute('data-join-state', s); }
    function hostShow(on) { if (!s2host) return; var sec = s2host.closest('[data-join-more]') || s2host; sec.hidden = !on; }

    // ---------------- the intent this visit came with (right-wing-intent-lost)
    var intentBox = null;
    function intentTitle(id) {
      var it = intentOf(id), named = want.crew && crewName(want.crew);
      if (!it) return '';
      return named && it.titleNamed ? fillVars(L(it.titleNamed), { crew: named }) : L(it.title);
    }
    function paintIntent() {
      if (intentBox) { intentBox.remove(); intentBox = null; }
      var it = want.intent && intentOf(want.intent);
      if (!it) return;
      var id = uid('intent'), named = want.crew && crewName(want.crew);
      var box = el('input', { type: 'checkbox', id: id, name: 'intent', value: want.intent, checked: true, 'aria-describedby': id + '-note' });
      intentBox = el('div', { class: 'notice notice--info', 'data-join-intent': want.intent }, [
        el('p', { class: 'h4', 'data-join-intent-title': true, text: intentTitle(want.intent) }),
        el('div', { class: 'field field--check' }, [box, el('label', { class: 'field__label', for: id, text: named && it.checkNamed ? fillVars(L(it.checkNamed), { crew: named }) : L(it.check) })]),
        el('p', { class: 'small', id: id + '-note', text: L(it.note) })
      ]);
      var at = form.querySelector('.form__summary');
      form.insertBefore(intentBox, at ? at.nextSibling : form.firstChild);
    }
    function stepOneIntent() {
      var b = intentBox && intentBox.querySelector('input[name="intent"]');
      return b && b.checked ? b.value : '';
    }

    // ---------------- prefill from the last RSVP (journeys-10)
    var prefillNote = null;
    function clearPrefill(focus) {
      if (prefillNote) { prefillNote.remove(); prefillNote = null; }
      if (focus) { f.first.value = ''; f.contact.value = ''; f.first.dispatchEvent(new Event('input', { bubbles: true })); f.first.focus(); }
    }
    function applyPrefill(r) {
      if (opts.prefill === false || !r || (YSD.members && YSD.members.current())) return false;
      if (f.first.value.trim() || f.contact.value.trim()) return false;
      var name = String(r.firstName || '').trim().slice(0, 60), contact = String(r.contact || '').trim().slice(0, 254);
      if (!name && !contact) return false;
      if (name) f.first.value = name;
      if (contact) f.contact.value = contact;
      f.first.dispatchEvent(new Event('input', { bubbles: true }));
      if (!prefillNote) {
        var clr = el('button', { class: 'btn btn--quiet btn--sm', type: 'button', 'data-join-prefill-clear': true, text: T('prefill.clear') });
        clr.addEventListener('click', function () { clearPrefill(true); });
        prefillNote = el('p', { class: 'small cluster cluster--sm', 'data-join-prefill': true }, [el('span', { text: T('prefill.note') }), clr]);
        var at = f.first.closest('.form__row') || f.first.closest('.field') || f.first;
        at.parentNode.insertBefore(prefillNote, at);
      }
      return true;
    }
    d.addEventListener('ysd:rsvp', function (e) {
      var r = e.detail && e.detail.record;
      if (r && r.status === 'in' && !form.hidden) applyPrefill(r);
    });

    // live field fixes: clear an error as soon as the field is fixed
    function fieldOk(name) {
      if (name === 'firstName') return !!f.first.value.trim();
      if (name === 'contact') {
        var c = parseContact(f.contact.value);
        if (!c.email && !c.phone) return false;
        var v = YSD.members.validate({ firstName: 'x', email: c.email, phone: c.phone });
        return !c.noAt && !v.errors.email && !v.errors.phone;
      }
      if (name === 'age') return !isNaN(parseAge(f.age.value));
      return true;
    }
    form.addEventListener('input', function (e) {
      var t = e.target;
      if (!t || t.getAttribute('aria-invalid') !== 'true' || !fieldOk(t.name)) return;
      t.removeAttribute('aria-invalid');
      var err = (t.closest('.field') || t.parentNode).querySelector('.field__error');
      if (err) { err.textContent = ''; err.hidden = true; }
      if (!form.querySelector('[aria-invalid="true"]')) { var s = form.querySelector('.form__summary'); if (s) s.hidden = true; }
    });

    function errorsFor() {
      var c = parseContact(f.contact.value), age = parseAge(f.age.value);
      var profile = { firstName: f.first.value, email: c.email, phone: c.phone, age: isNaN(age) ? undefined : age };
      var v = YSD.members.validate(profile);
      var errs = {}, msgs = {};
      if (v.errors.firstName) { errs.firstName = 'required'; msgs.firstName = T('error.firstName.required'); }
      if (v.errors.email || v.errors.phone || c.noAt) {
        errs.contact = 'invalid';
        msgs.contact = !c.email && !c.phone ? T('error.email.required')
          : c.noAt ? T('error.email.missingAt')
            : v.errors.phone ? T('error.phone.invalid') : T('error.email.invalid');
      }
      if (isNaN(age)) { errs.age = 'invalid'; msgs.age = T('error.age.invalid'); }
      return { errs: errs, msgs: msgs, v: v, profile: profile, contact: c, age: age };
    }

    function showYoung() {
      form.reset();
      clearPrefill(false);
      if (YSD.ui && YSD.ui.form) YSD.ui.form.clear(form);
      young.textContent = '';
      young.appendChild(el('p', { text: T('error.age.too_young') }));
      young.appendChild(el('p', {}, [el('a', { class: 'link', href: pageHref('index.html'), text: T('cta.home') })]));
      young.hidden = false;
      young.focus();
      setState('young');
      emit('join-form-too-young', {});
    }

    function overAge(member) {
      if (!member) return false;
      if (member.warnings && member.warnings.age === 'over_age_cap') return true;
      var cap = +cfg('org.ageCap', 39) || 39;
      return typeof member.age === 'number' && member.age > cap;
    }
    function headingText(member, already) {
      var name = member.firstName || '';
      // Past the age cap (members.enforceAgeCap off): on the list, but not "in" as a member.
      if (overAge(member)) return T('done.listed', { name: name });
      var key = already ? (titles.already || 'done.already') : (titles.done || 'done.title');
      return T(key, { name: name }) || T(already ? 'done.already' : 'done.title', { name: name });
    }

    // ---------------- "Not {name}? Start over" (asks first) and "Back to {name}"
    function resetControl(member) {
      var name = member.firstName || '';
      var wrap = el('div', { class: 'stack stack--sm', 'data-join-reset-wrap': true });
      var btn = el('button', { class: 'btn btn--quiet btn--sm', type: 'button', 'data-join-reset': true, text: T('done.reset', { name: name }) });
      var ask = el('div', { class: 'notice notice--info stack stack--sm', 'data-join-reset-ask': true, hidden: true }, [
        el('p', { class: 'small', text: T('done.resetAsk', { name: name }) })
      ]);
      var yes = el('button', { class: 'btn btn--ink btn--sm', type: 'button', 'data-join-reset-yes': true, text: T('done.resetYes') });
      var no = el('button', { class: 'btn btn--quiet btn--sm', type: 'button', 'data-join-reset-no': true, text: T('done.resetNo', { name: name }) });
      ask.appendChild(el('div', { class: 'btn-row' }, [yes, no]));
      btn.addEventListener('click', function () { btn.hidden = true; ask.hidden = false; yes.focus(); });
      no.addEventListener('click', function () { ask.hidden = true; btn.hidden = false; btn.focus(); });
      yes.addEventListener('click', function () { ctl.reset(); });
      wrap.appendChild(btn); wrap.appendChild(ask);
      return wrap;
    }
    function paintSwitch() {
      switchRow.textContent = '';
      var arch = [];
      try { arch = YSD.members && YSD.members.archived ? YSD.members.archived() : []; } catch (e) { arch = []; }
      if (!arch.length || (YSD.members && YSD.members.current())) { switchRow.hidden = true; return; }
      switchRow.appendChild(el('span', { class: 'small', text: T('done.switchLabel') }));
      arch.slice(0, 3).forEach(function (a) {
        var b = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'data-join-resume': a.id, translate: 'no', text: T('done.switch', { name: a.firstName || '?' }) });
        b.addEventListener('click', function () { resume(a.id); });
        switchRow.appendChild(b);
      });
      switchRow.hidden = false;
    }
    function resume(id) {
      var m = null;
      try { m = YSD.members.resume(id); } catch (e) { m = null; }
      if (!m) { paintSwitch(); return; }
      clearPrefill(false);
      showMember(m, true);
      var h = done.querySelector('[data-join-done-title]'); if (h) h.focus();
      toast(T('done.resumed', { name: m.firstName || '', count: Math.min(realSquad().length, 3) }), 'success', 'high');
      emit('join-form-joined', { member: m, isNew: false, compact: compact, resumed: true });
      if (typeof opts.onJoined === 'function') { try { opts.onJoined(m, { isNew: false, compact: compact, resumed: true }); } catch (x) {} }
    }

    function paintDone(member, already) {
      done.textContent = '';
      var h = el(level, { class: 'h3', tabindex: '-1', 'data-join-done-title': true, text: headingText(member, already) });
      done.appendChild(h);
      if (!already) done.appendChild(el('p', { class: 'lead', text: [T('success.join.letter'), T('success.join.signoff')].filter(Boolean).join(' ') }));
      if (overAge(member)) done.appendChild(el('p', { class: 'notice notice--info', text: T('success.join.supporter') || T('error.age.over_age_cap') }));   // 40+: a supporter on the list, not a member
      if (cfg('demo', true) !== false && !already) done.appendChild(el('p', { class: 'small muted', text: T('success.join.demo') }));
      var row = el('div', { class: 'btn-row' });
      if (cardHref) row.appendChild(el('a', { class: 'btn btn--ink', href: cardHref, 'data-join-see-card': true, text: T('done.card') }));
      if (compact && inline) {
        var mb = el('button', { class: 'btn btn--ghost', type: 'button', 'data-join-more': true, text: T('done.more') });
        mb.addEventListener('click', function () { ctl.showStep2({ focus: true }); });
        row.appendChild(mb);
      } else if (compact) row.appendChild(el('a', { class: 'btn btn--ghost', href: pageHref('join.html') + '#more', text: T('done.more') }));
      else if (moreHref) {
        var ma = el('a', { class: 'btn btn--ghost', href: moreHref, 'data-join-more': true, text: T('done.moreFull') });
        ma.addEventListener('click', function (e) { e.preventDefault(); ctl.showStep2({ focus: true, keep: true }); });
        row.appendChild(ma);
      }
      if (row.childNodes.length) done.appendChild(row);
      done.appendChild(resetControl(member));
      done.hidden = false;
      return h;
    }

    // ---------------- step two
    function issuesList() {
      var I = (w.YSD_DATA || {}).issues, items = I && Array.isArray(I.items) ? I.items : [];
      return items.filter(function (x) { return x && x.id && x.title; }).map(function (x) {
        return { id: x.id, label: x.title[lang()] || x.title.en, color: x.color ? 'var(--issue-' + x.color + ')' : '' };
      });
    }
    function chip(type, name, value, label, color, checked, sub) {
      var input = el('input', { type: type, name: name, value: value });
      if (checked) input.checked = true;
      var dot = null;
      if (color) { dot = el('span', { class: 'chip__dot', 'aria-hidden': 'true' }); dot.style.setProperty('--dot', color); }
      var text = sub ? el('span', { class: 'chip__text' }, [el('span', { class: 'chip__name', text: label }), el('span', { class: 'chip__sub', text: sub })]) : el('span', { text: label });
      return el('label', { class: 'chip' }, [input, dot, text]);
    }
    function group(kind, legend, hint, kids) {
      var hid = hint ? uid(kind + '-hint') : null;
      var fs = el('fieldset', { class: 'field', 'data-join-group': kind, 'aria-describedby': hid }, [el('legend', { class: 'field__label', text: legend })]);
      if (hint) fs.appendChild(el('p', { class: 'field__hint', id: hid, text: hint }));
      (kids || []).forEach(function (k) { if (k) fs.appendChild(k); });
      return fs;
    }
    function crewLine(box, city, intents) {
      var id = cityCrew(city);
      box.textContent = id ? T(intents.indexOf('crew') >= 0 ? 'crews.cityStart' : 'crews.city', { crew: crewName(id) }) : '';
      box.hidden = !id;
    }
    function paintStep2(member, o) {
      if (!step2) return;
      o = o || {};
      step2.textContent = '';
      var P = picksData();
      var tid = uid('s2');
      step2.setAttribute('aria-labelledby', tid);
      step2.appendChild(el('div', { class: 'stack stack--sm', 'data-join-step2-head': true }, [
        el(s2heading, { class: s2heading === 'h2' ? 'h2' : 'h4', id: tid, tabindex: '-1', 'data-join-step2-title': true, text: T('step2.title') }),
        el('p', { class: 'small muted', text: T('step2.sub') })
      ]));
      step2.appendChild(el('div', { class: 'form__summary', hidden: true }, [el('p', { class: 'form__summary-title', 'data-summary-title': true }), el('ul')]));

      var haveIntent = list(member.intent);
      if (want.intent && haveIntent.indexOf(want.intent) < 0) haveIntent.push(want.intent);   // this visit's link asked for it

      // I want to... (right-wing-intent-lost)
      if (P && Array.isArray(P.intents) && P.intents.length) {
        var irow = el('div', { class: 'chip-row' });
        P.intents.forEach(function (it) {
          var lab = it.id === 'crew' && (want.crew || member.crew) && crewName(want.crew || member.crew) && it.checkNamed
            ? fillVars(L(it.checkNamed), { crew: crewName(want.crew || member.crew) }) : L(it.label);
          irow.appendChild(chip('checkbox', 'intent', it.id, lab, '', haveIntent.indexOf(it.id) >= 0));
        });
        step2.appendChild(group('intent', T('intent.label'), T('intent.hint'), [irow]));
      }

      // city (+ its DEMO crew)
      var cityRow = el('div', { class: 'chip-row' });
      var urlCity = want.crew && P && P.cityCrews && P.cityCrews[want.crew] ? P.cityCrews[want.crew].city : '';
      var city = member.city || urlCity;
      CITIES.forEach(function (c) {
        var label = c[1].indexOf('.') > 0 ? T(c[1]) : c[1];
        cityRow.appendChild(chip('radio', 'city', c[0], label, c[2] ? 'var(--city-' + (c[0] === 'seminole' ? 'unincorporated' : c[0]) + ')' : '', city === c[0]));
      });
      var cl = el('p', { class: 'small', 'data-join-crewline': true, 'aria-live': 'polite', hidden: true });
      step2.appendChild(group('city', T('form.city.label'), '', [cityRow, P ? cl : null]));
      if (P) crewLine(cl, city, haveIntent);

      // DEMO crews (right-wing-identity-crews)
      if (P && Array.isArray(P.crews) && P.crews.length) {
        var haveCrews = list(member.crews);
        if (want.crew && P.crews.some(function (c) { return c.id === want.crew; }) && haveCrews.indexOf(want.crew) < 0) haveCrews.push(want.crew);
        var crow = el('div', { class: 'chip-row', 'data-join-crews': true });
        P.crews.forEach(function (c) { crow.appendChild(chip('checkbox', 'crews', c.id, L(c.name), 'var(--' + (c.color || 'celery') + ')', haveCrews.indexOf(c.id) >= 0, L(c.sub))); });
        step2.appendChild(group('crews', T('crews.label'), T('crews.hint'), [crow]));
      }

      // issues (or the core interests list)
      var issues = issuesList(), have = Array.isArray(member.interests) ? member.interests : [];
      var issueRow = el('div', { class: 'chip-row' });
      if (issues.length) issues.forEach(function (x) { issueRow.appendChild(chip('checkbox', 'interests', x.id, x.label, x.color, have.indexOf(x.id) >= 0)); });
      else WANTS.forEach(function (k) { issueRow.appendChild(chip('checkbox', 'interests', k, T('form.wants.' + k), '', have.indexOf(k) >= 0)); });
      step2.appendChild(group('issues', issues.length ? T('step2.issues') : T('form.wants.label'), '', [issueRow]));

      // language
      var langRow = el('div', { class: 'seg' });
      ['en', 'es', 'both'].forEach(function (k) {
        var input = el('input', { type: 'radio', name: 'langPref', value: k });
        if (member.langPref === k) input.checked = true;
        langRow.appendChild(el('label', { class: 'seg__opt' }, [input, el('span', { text: T('form.language.' + k) })]));
      });
      step2.appendChild(group('lang', T('form.language.label'), '', [langRow]));

      // access needs
      var aid = uid('access');
      var ta = el('textarea', { id: aid, name: 'access', rows: '3', maxlength: '500', 'aria-describedby': aid + '-hint' });
      ta.value = member.access || '';
      step2.appendChild(el('div', { class: 'field', 'data-join-group': 'access' }, [
        el('label', { class: 'field__label', for: aid }, [T('form.access.label') + ' ', el('span', { class: 'field__opt', text: T('form.optional') })]),
        ta, el('p', { class: 'field__hint', id: aid + '-hint', text: T('form.access.hint') }),
        el('p', { class: 'field__error', id: aid + '-error', hidden: true })
      ]));

      // guardian email, ages 14 to 17
      if (isMinor(member)) {
        var gid = uid('guardian');
        var gi = el('input', { id: gid, name: 'guardianEmail', type: 'email', inputmode: 'email', autocomplete: 'off', 'aria-describedby': gid + '-hint', maxlength: '254' });
        gi.value = member.guardianEmail || '';
        step2.appendChild(el('div', { class: 'field', 'data-join-group': 'guardian' }, [
          el('label', { class: 'field__label', for: gid, text: T('form.guardian.label') }), gi,
          el('p', { class: 'field__hint', id: gid + '-hint', text: T('form.guardian.hint') }),
          el('p', { class: 'field__error', id: gid + '-error', hidden: true })
        ]));
      }

      // SMS: only with a mobile number; adults only for now
      if (member.phone) {
        if (isMinor(member)) step2.appendChild(el('p', { class: 'notice notice--info small', 'data-join-group': 'sms', text: T('form.consent.smsTeen') }));
        else {
          var sid = uid('sms');
          var box = el('input', { id: sid, name: 'smsOptIn', type: 'checkbox', value: 'yes' });
          if (member.smsOptIn === true) box.checked = true;
          step2.appendChild(el('div', { class: 'stack stack--sm', 'data-join-group': 'sms' }, [
            el('div', { class: 'field field--check' }, [box, el('label', { class: 'field__label', for: sid, text: T('form.consent.sms') })]),
            el('p', { class: 'small' }, [
              el('a', { href: pageHref('privacy.html'), text: T('form.consent.privacyLink') }), ' · ',
              el('a', { href: pageHref('privacy.html') + '#privacy-sms', text: T('form.consent.smsTermsLink') })
            ])
          ]));
        }
      }

      var save = el('button', { class: 'btn btn--primary', type: 'submit', text: T('step2.save') });
      var skip = el('button', { class: 'btn btn--quiet', type: 'button', 'data-join-skip': true, text: T('cta.notNow') });
      skip.addEventListener('click', function () { step2.hidden = true; paintPicks(YSD.members.current() || member); picks.hidden = false; var eb = picks.querySelector('[data-join-edit]'); if (eb) eb.focus(); });
      step2.appendChild(el('div', { class: 'btn-row', 'data-join-group': 'actions' }, [save, skip]));
      step2.hidden = false;
      if (picks) picks.hidden = true;
      hostShow(true);
      emit('join-form-step2', { member: member });
      if (o.focus) setTimeout(function () { jumpTo(step2.querySelector('[data-join-step2-title]')); }, 30);
    }
    if (step2) step2.addEventListener('change', function (e) {
      var t = e.target;
      if (!t || (t.name !== 'city' && t.name !== 'intent')) return;
      var cl = step2.querySelector('[data-join-crewline]');
      if (!cl) return;
      var fd = new FormData(step2);
      crewLine(cl, String(fd.get('city') || ''), fd.getAll('intent').map(String));
    });

    function paintPicks(member) {
      if (!picks) return;
      picks.textContent = '';
      var bits = [];
      list(member.intent).forEach(function (id) { var it = intentOf(id); if (it) bits.push(L(it.label)); });
      var city = CITIES.filter(function (c) { return c[0] === member.city; })[0];
      if (city) bits.push(city[1].indexOf('.') > 0 ? T(city[1]) : city[1]);
      list(member.crews).forEach(function (id) { var n = crewName(id); if (n) bits.push(n); });
      var issues = issuesList(), have = Array.isArray(member.interests) ? member.interests : [];
      have.forEach(function (id) {
        var x = issues.filter(function (i) { return i.id === id; })[0];
        bits.push(x ? x.label : (T('form.wants.' + id) || id));
      });
      picks.appendChild(el('p', { class: 'small' }, [el('strong', { text: T('step2.summary') + ': ' }), bits.length ? bits.join(' · ') : T('step2.none')]));
      var edit = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'data-join-edit': true, text: T('cta.edit') });
      edit.addEventListener('click', function () { paintStep2(YSD.members.current() || member); var first = step2.querySelector('input, textarea'); if (first) first.focus(); });
      picks.appendChild(edit);
      picks.hidden = false;
      hostShow(true);
    }

    if (step2) step2.addEventListener('submit', function (e) {
      e.preventDefault();
      var me = YSD.members.current();
      if (!me) return;
      var fd = new FormData(step2);
      var interests = fd.getAll('interests').map(String);
      var intents = fd.getAll('intent').map(String).filter(function (x) { return intentIds().indexOf(x) >= 0; });
      var crews = fd.getAll('crews').map(String);
      var g = String(fd.get('guardianEmail') || '').trim();
      if (g && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(g)) {
        if (YSD.ui && YSD.ui.form) YSD.ui.form.errors(step2, { guardianEmail: 'invalid' }, { messages: { guardianEmail: T('error.email.invalid') } });
        return;
      }
      if (YSD.ui && YSD.ui.form) YSD.ui.form.clear(step2);
      var sms = !!fd.get('smsOptIn') && !!me.phone && !isMinor(me);
      var Lg = (w.YSD_DATA || {}).legal, ver = Lg && Lg.snippets && Lg.snippets.smsConsent && Lg.snippets.smsConsent.version;
      var city = String(fd.get('city') || '');
      var profile = {
        firstName: me.firstName, email: me.email, phone: me.phone, age: me.age,
        city: city, interests: interests, langPref: String(fd.get('langPref') || ''),
        access: String(fd.get('access') || '').trim(), smsOptIn: sms,
        intent: intents.join(','), crews: crews.join(','),
        crew: intents.indexOf('crew') >= 0 ? (want.crew || me.crew || cityCrew(city) || '') : ''
      };
      if (isMinor(me)) profile.guardianEmail = g;
      if (sms && me.smsOptIn !== true) { profile.smsConsentVersion = ver || SMS_VERSION_FALLBACK; profile.smsConsentAt = Date.now(); }
      var saved;
      try { saved = YSD.members.join(profile); } catch (err) {
        toast(T('error.submit.failed'), 'error');
        return;
      }
      track('join_step2', { fields: (profile.city ? 1 : 0) + (interests.length ? 1 : 0) + (profile.langPref ? 1 : 0) + (profile.access ? 1 : 0) + (sms ? 1 : 0) + (intents.length ? 1 : 0) + (crews.length ? 1 : 0) });
      step2.hidden = true;
      paintPicks(saved);
      toast(T('step2.saved'), 'success');
      var eb = picks.querySelector('[data-join-edit]'); if (eb) eb.focus();
      emit('join-form-saved', { member: saved });
      if (typeof opts.onSaved === 'function') { try { opts.onSaved(saved); } catch (x) {} }
    });

    // ---------------- step one submit
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!YSD.members) return;
      young.hidden = true;
      var r = errorsFor();
      if (Object.keys(r.errs).length) {
        if (YSD.ui && YSD.ui.form) YSD.ui.form.errors(form, r.errs, { messages: r.msgs });
        return;
      }
      if (r.v.errors.age === 'too_young') { showYoung(); return; }     // stores nothing
      if (YSD.ui && YSD.ui.form) YSD.ui.form.clear(form);
      var profile = {
        firstName: r.profile.firstName, age: r.age, lang: lang(), joinSource: source,
        contactType: r.contact.phone ? 'phone' : 'email', _hp: f.hp ? f.hp.value : ''
      };
      if (r.contact.email) profile.email = r.contact.email; else profile.phone = r.contact.phone;
      var it = stepOneIntent();
      if (it) { profile.intent = it; if (it === 'crew' && want.crew) profile.crew = want.crew; }
      var existing = YSD.members.current(), member;
      try { member = YSD.members.join(profile); } catch (err) {
        if (err && err.errors && YSD.ui) YSD.ui.form.errors(form, err.errors);
        else toast(T('error.submit.failed'), 'error');
        return;
      }
      if (f.btn) f.btn.setAttribute('data-state', 'loading');
      setTimeout(function () {
        if (f.btn) f.btn.removeAttribute('data-state');
        succeed(member, !existing);
      }, reduced() ? 0 : 320);
    });

    function succeed(member, isNew) {
      var burstFrom = f.btn;
      if (YSD.ui && YSD.ui.confetti && burstFrom) YSD.ui.confetti(burstFrom);
      form.hidden = true;
      switchRow.hidden = true;
      clearPrefill(false);
      var h = paintDone(member, false);
      if (!compact) paintStep2(member);
      setState('done');
      toast(overAge(member) ? (T('toast.subscribed') || T('toast.joined')) : T('toast.joined'), 'success');   // 40+: "You're on the list", never "You're in"
      mountCard(cardHost, member);
      h.focus();
      emit('join-form-joined', { member: member, isNew: !!isNew, compact: compact });
      if (typeof opts.onJoined === 'function') { try { opts.onJoined(member, { isNew: !!isNew, compact: compact }); } catch (x) {} }
    }

    /** Show an existing member (returning visit or "Back to {name}"). */
    function showMember(me, already) {
      form.hidden = true;
      young.hidden = true;
      switchRow.hidden = true;
      paintDone(me, already);
      if (!compact) {
        if (want.intent && list(me.intent).indexOf(want.intent) < 0) paintStep2(me);   // a member back through a host/crew link
        else paintPicks(me);
      }
      mountCard(cardHost, me);
      setState('done');
    }

    var ctl = {
      form: form, root: root,
      member: function () { return YSD.members ? YSD.members.current() : null; },
      intent: function () { return { intent: want.intent, crew: want.crew }; },
      reset: function () {
        var prev = YSD.members ? YSD.members.current() : null;
        if (YSD.members && typeof YSD.members.reset === 'function') {
          // journeys-06: archive into the join log, clear the old member's own state, re-capture ?ref
          try { YSD.members.reset(); } catch (x) { if (YSD.log) YSD.log('joinform: members.reset failed', x); }
        } else {
          var keep = {};
          try { if (YSD.store) ['ref', 'utm', 'utm:first'].forEach(function (k) { keep[k] = YSD.store.get(k, null); }); } catch (x) {}
          try { if (YSD.members) YSD.members.forget(); } catch (x) {}
          try { if (YSD.store) Object.keys(keep).forEach(function (k) { if (keep[k] != null) YSD.store.set(k, keep[k]); }); } catch (x) {}
        }
        form.reset();
        clearPrefill(false);
        form.hidden = false;
        done.hidden = true; young.hidden = true;
        if (step2) step2.hidden = true;
        if (picks) picks.hidden = true;
        hostShow(false);
        if (cardHost) { if (cardHost.__ysdCard && cardHost.__ysdCard.destroy) cardHost.__ysdCard.destroy(); cardHost.__ysdCard = null; cardHost.textContent = ''; cardHost.hidden = true; }
        setState('idle');
        paintSwitch();
        emit('join-form-reset', { previous: prev ? { id: prev.id, firstName: prev.firstName || '' } : null });
        if (f.first) f.first.focus();
      },
      showStep2: function (o) {
        o = o || {};
        var me = YSD.members && YSD.members.current();
        if (!me || !step2) return false;
        if (!o.keep || step2.hidden) paintStep2(me);
        if (o.focus !== false) setTimeout(function () { jumpTo(step2.querySelector('[data-join-step2-title]')); }, 30);
        return true;
      }
    };
    form.__ysdJoin = ctl;

    // returning member: show the "already in" state instead of an empty form
    var me = YSD.members && YSD.members.current();
    if (me && me.firstName) {
      showMember(me, true);
      if (hasStep2 && /^#more$/.test(w.location.hash)) ctl.showStep2({ focus: true });   // journeys-11
    } else {
      setState('idle');
      paintIntent();
      paintSwitch();
      applyPrefill(lastRsvp());
    }
    w.addEventListener('hashchange', function () {
      if (/^#more$/.test(w.location.hash) && hasStep2 && YSD.members && YSD.members.current()) ctl.showStep2({ focus: true, keep: true });
    });
    return ctl;
  }

  function mountAll(root) {
    Array.prototype.forEach.call((root || d).querySelectorAll('form[data-join-form]:not([data-join-manual])'), function (f) { mount(f); });
  }

  YSD.joinForm = { mount: mount, mountAll: mountAll, parseContact: parseContact, parseAge: parseAge, urlIntent: urlIntent };
  function boot() { mountAll(d); }
  if (YSD.ui && YSD.ui.ready) YSD.ui.ready(boot);
  else if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window, document);
