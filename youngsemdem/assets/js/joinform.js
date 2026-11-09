/*!
 * assets/js/joinform.js (W6): the join form, used by join.html, newsletter.html (compact) and home (W1, compact).
 *
 * CONTRACT
 *   YSD.joinForm.mount(formEl, opts?) -> controller { form, root, member(), reset(), showStep2() }
 *     formEl   a <form data-join-form> (static markup from join.html, or an EMPTY form: then the
 *              standard fields are rendered from data/slices/core.js strings, so any page can drop in
 *              <form class="form" name="join" data-join-form data-compact></form>).
 *     opts     { compact: bool        (default: form has [data-compact]) three fields, short success,
 *                                       no step two inline (it links to join.html#more instead)
 *                headingLevel: 2 | 3  (default: form[data-heading] or 3) level of the success heading
 *                source: 'join'|'home'|'newsletter'  (default: <html data-page>) stored as joinSource
 *                card: Element|null    where to mount the member card after joining (default: the
 *                                       element [data-join-card] names, or none)
 *                cardHref: '#card'     shows "See your card" in the success panel (default: form[data-card-href])
 *              Rendered (empty) forms also read form[data-submit-key] for the button label (default cta.join).
 *                onJoined(member, {isNew, compact})   called after every successful join
 *                onSaved(member)       called after step two is saved }
 *   Auto-mount: every form[data-join-form] without [data-join-manual] mounts when ui.js is ready.
 *   YSD.joinForm.parseContact('407 555 0123') -> { phone } | { email } | { email, noAt: true } | {}
 *
 *   Fields (3 required, BRIEF 4.2): firstName, contact (email OR mobile, one field), age (free entry,
 *   the FTC's neutral age screen; never pre-filled, never a list of allowed ages), plus the hidden
 *   honeypot _hp. Validation is YSD.members.validate; errors render through YSD.ui.form.errors
 *   (aria-invalid, aria-describedby = hint + error, an error summary that takes focus).
 *   Under 14: the friendly too-young message shows, the inputs are cleared and NOTHING is stored or
 *   sent (members.join is never called). Under 18: members.js gives a random-style refCode, and this
 *   module never adds a `from` name to a teen's links. The ref captured on arrival (share.js) is
 *   frozen into the member as referredBy by members.join.
 *   Success: line 13 (success.join.*), toast.joined, confetti (YSD.ui.confetti: no-op under reduced
 *   motion or Pause motion), focus moves to the success heading, the member card mounts
 *   (YSD.memberCard.mount from W5 when present, else a small built-in card with your link and the
 *   squad meter, simulated members filtered out). The join sticker is W5's: membercard.js hears
 *   ysd:joined (members.js) and logs the organizing action itself, so this module awards nothing.
 *   Step two (full mode, all optional): city chips (city colourways), issue chips (data/issues.js or a
 *   slice with items[].id/title/color; falls back to the core form.wants.* list), language, access
 *   needs, a guardian email for ages 14 to 17, and the SMS opt-in (unchecked, legal wording, only
 *   when a mobile number was given and the member is 18 or older; teens see form.consent.smsTeen).
 *   The SMS consent version is recorded with the member (smsConsentVersion, smsConsentAt).
 *   DOM events (document, via YSD.emit): ysd:join-form-joined {member, isNew, compact},
 *   ysd:join-form-saved {member}, ysd:join-form-too-young {}, ysd:join-form-reset {}.
 *   Rendered markup uses only core component classes (.form .field .chip .btn .notice .consent
 *   .stack .cluster), so it looks right on any page; hooks are data-join-*; style extras under your
 *   page class. Copy: data/slices/core.js, then data/pages/join.js ("join:" keys) when loaded, else
 *   the built-in fallback below (kept identical to data/pages/join.js).
 *   Analytics: YSD.track('join_step2', {fields}) only; members.js tracks 'join'. No personal data.
 */
(function (w, d) {
  'use strict';
  var YSD = w.YSD = w.YSD || {};

  // Fallback copy for the few strings core.js doesn't have. Mirrors data/pages/join.js; keep in sync.
  var FALLBACK = {
    'form.contactHint': { en: 'One is enough. For your invites and the Thursday Letter, never more than once a week.', es: 'Con uno basta. Para tus invitaciones y la Carta del Jueves, nunca más de una vez por semana.' },
    'done.title': { en: "You're in, {name}.", es: 'Ya eres parte, {name}.' },
    'done.already': { en: "You're already in, {name}.", es: 'Ya eres parte, {name}.' },
    'done.listed': { en: "You're on the list, {name}.", es: 'Ya estás en la lista, {name}.' },
    'done.reset': { en: 'Not {name}? Start over', es: '¿No eres {name}? Empezar de nuevo' },
    'done.card': { en: 'See your card', es: 'Ver tu tarjeta' },
    'done.more': { en: 'Pick your city and issues', es: 'Elige tu ciudad y tus temas' },
    'step2.title': { en: 'Make it yours', es: 'Hazlo tuyo' },
    'step2.sub': { en: 'All optional. Skip anything, change it anytime.', es: 'Todo es opcional. Sáltate lo que quieras y cámbialo cuando quieras.' },
    'step2.issues': { en: 'What do you care about? Pick any.', es: '¿Qué te importa? Elige los que quieras.' },
    'step2.save': { en: 'Save my picks', es: 'Guardar mis opciones' },
    'step2.saved': { en: "Saved. We'll only send what matches.", es: 'Guardado. Solo te mandamos lo que coincida.' },
    'step2.summary': { en: 'Your picks', es: 'Lo que elegiste' },
    'step2.none': { en: 'Nothing picked yet.', es: 'Todavía no elegiste nada.' },
    'mc.title': { en: 'Your invite link', es: 'Tu enlace de invitación' },
    'mc.since': { en: 'Member since {month}', es: 'Miembro desde {month}' },
    'mc.showName': { en: 'Show my first name on my link', es: 'Mostrar mi nombre en mi enlace' },
    'mc.squad': { en: 'Friends who joined with your link: {count} of 3. Three friends, not 300.', es: 'Personas que se unieron con tu enlace: {count} de 3. Tres, no 300.' },
    'mc.squadHint': { en: 'DEMO: only joins on this device count.', es: 'DEMO: solo cuentan las uniones en este dispositivo.' }
  };
  // City ids match data/sharekit.js cities (W5's member card); 'seminole' = unincorporated Seminole.
  var CITIES = [
    ['sanford', 'Sanford', 'celery'], ['lake-mary', 'Lake Mary', 'sky'], ['oviedo', 'Oviedo', 'tangerine'],
    ['winter-springs', 'Winter Springs', 'mint'], ['altamonte-springs', 'Altamonte Springs', 'bubblegum'],
    ['casselberry', 'Casselberry', 'hotpink'], ['longwood', 'Longwood', 'teal'],
    ['seminole', 'form.city.unincorporated', 'unincorporated'], ['outside', 'form.city.outside', ''], ['not-sure', 'form.city.notSure', '']
  ];
  var WANTS = ['social', 'volunteer', 'voting', 'learn', 'create', 'spanish', 'students', 'lgbtq'];
  var SMS_VERSION_FALLBACK = 'sms-consent-2026-11-09-draft';
  var uidN = 0;

  function lang() { return YSD.lang === 'es' ? 'es' : 'en'; }
  function fillVars(s, vars) {
    return String(s).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? String(vars[k]) : m; });
  }
  /** Core or page string, then the built-in fallback. */
  function T(key, vars) {
    var v = '';
    if (typeof YSD.t === 'function') {
      if (key.indexOf(':') < 0 && FALLBACK[key]) v = YSD.t('join:' + key, vars);
      else v = YSD.t(key, vars);
    }
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
  function pageHref(file) {
    var root = YSD.root || '';
    return root + (lang() === 'es' ? 'es/' : '') + file;
  }
  function reduced() { return YSD.ui && YSD.ui.motion ? YSD.ui.motion.paused() : false; }

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
      var params = { from: showName && !isMinor(member) ? String(member.firstName || '').replace(/[^\p{L}\s-]/gu, '').slice(0, 20) || null : null };
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
      if (YSD.share && YSD.share.copy) YSD.share.copy(u).then(function (ok) { if (YSD.ui) YSD.ui.toast(ok ? T('toast.linkCopied') : T('error.share.failed'), { tone: ok ? 'success' : 'error' }); });
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

  // ---------------------------------------------------------------- controller
  function mount(form, opts) {
    if (!form || form.__ysdJoin) return form && form.__ysdJoin;
    opts = opts || {};
    var compact = opts.compact != null ? !!opts.compact : form.hasAttribute('data-compact');
    var level = String(opts.headingLevel || form.getAttribute('data-heading') || 3) === '2' ? 'h2' : 'h3';
    var source = opts.source || d.documentElement.getAttribute('data-page') || 'join';
    var root = form.closest('[data-join]') || form.parentNode;
    var cardHost = opts.card || (form.getAttribute('data-join-card') ? d.querySelector(form.getAttribute('data-join-card')) : null);
    var cardHref = opts.cardHref || form.getAttribute('data-card-href') || '';
    if (!form.querySelector('[name="firstName"]')) renderFields(form, compact);

    var f = {
      first: form.querySelector('[name="firstName"]'),
      contact: form.querySelector('[name="contact"]'),
      age: form.querySelector('[name="age"]'),
      hp: form.querySelector('[name="_hp"]'),
      btn: form.querySelector('[type="submit"]')
    };

    // panels created after the form
    var young = el('div', { class: 'notice notice--info', 'data-join-young': true, tabindex: '-1', hidden: true });
    var done = el('div', { class: 'stack', 'data-join-done': true, hidden: true });
    var step2 = compact ? null : el('form', { class: 'form', 'data-join-step2': true, novalidate: true, hidden: true });
    var picks = compact ? null : el('div', { class: 'stack stack--sm', 'data-join-picks': true, hidden: true });
    var anchor = form;
    [young, done, step2, picks].forEach(function (n) { if (n) { anchor.parentNode.insertBefore(n, anchor.nextSibling); anchor = n; } });

    function setState(s) { if (root && root.setAttribute) root.setAttribute('data-join-state', s); }

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
      if (YSD.ui && YSD.ui.form) YSD.ui.form.clear(form);
      young.textContent = '';
      young.appendChild(el('p', { text: T('error.age.too_young') }));
      young.appendChild(el('p', {}, [el('a', { class: 'link', href: pageHref('index.html'), text: T('cta.home') })]));
      young.hidden = false;
      young.focus();
      setState('young');
      emit('join-form-too-young', {});
    }

    function overAge(member) { return !!(member && member.warnings && member.warnings.age === 'over_age_cap'); }
    function headingText(member, already) {
      // Past the age cap (members.enforceAgeCap off): on the list, but not "in" as a member.
      if (overAge(member)) return T('done.listed', { name: member.firstName || '' });
      return T(already ? 'done.already' : 'done.title', { name: member.firstName || '' });
    }

    function paintDone(member, already) {
      done.textContent = '';
      var h = el(level, { class: 'h3', tabindex: '-1', 'data-join-done-title': true, text: headingText(member, already) });
      done.appendChild(h);
      if (!already) done.appendChild(el('p', { class: 'lead', text: [T('success.join.letter'), T('success.join.signoff')].filter(Boolean).join(' ') }));
      if (member.warnings && member.warnings.age === 'over_age_cap') done.appendChild(el('p', { class: 'notice notice--info', text: T('error.age.over_age_cap') }));
      if (cfg('demo', true) !== false && !already) done.appendChild(el('p', { class: 'small muted', text: T('success.join.demo') }));
      var row = el('div', { class: 'btn-row' });
      if (cardHref) row.appendChild(el('a', { class: 'btn btn--ink', href: cardHref, text: T('done.card') }));
      if (compact) row.appendChild(el('a', { class: 'btn btn--ghost', href: pageHref('join.html') + '#more', text: T('done.more') }));
      if (row.childNodes.length) done.appendChild(row);
      var reset = el('button', { class: 'btn btn--quiet btn--sm', type: 'button', 'data-join-reset': true, text: T('done.reset', { name: member.firstName || '' }) });
      reset.addEventListener('click', ctl.reset);
      done.appendChild(reset);
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
    function chip(type, name, value, label, color, checked) {
      var input = el('input', { type: type, name: name, value: value });
      if (checked) input.checked = true;
      var dot = null;
      if (color) { dot = el('span', { class: 'x-dot', 'aria-hidden': 'true' }); dot.style.setProperty('--dot', color); }
      return el('label', { class: 'chip' }, [input, dot, el('span', { text: label })]);
    }
    function paintStep2(member) {
      if (!step2) return;
      step2.textContent = '';
      var tid = uid('s2');
      step2.setAttribute('aria-labelledby', tid);
      var hl = level === 'h2' ? 'h3' : 'h4';
      step2.appendChild(el('div', { class: 'stack stack--sm' }, [
        el(hl, { class: 'h4', id: tid, text: T('step2.title') }),
        el('p', { class: 'small muted', text: T('step2.sub') })
      ]));
      step2.appendChild(el('div', { class: 'form__summary', hidden: true }, [el('p', { class: 'form__summary-title', 'data-summary-title': true }), el('ul')]));

      // city
      var cityRow = el('div', { class: 'chip-row' });
      CITIES.forEach(function (c) {
        var label = c[1].indexOf('.') > 0 ? T(c[1]) : c[1];
        cityRow.appendChild(chip('radio', 'city', c[0], label, c[2] ? 'var(--city-' + (c[0] === 'seminole' ? 'unincorporated' : c[0]) + ')' : '', member.city === c[0]));
      });
      step2.appendChild(el('fieldset', { class: 'field' }, [el('legend', { class: 'field__label', text: T('form.city.label') }), cityRow]));

      // issues (or the core interests list)
      var issues = issuesList(), have = Array.isArray(member.interests) ? member.interests : [];
      var issueRow = el('div', { class: 'chip-row' });
      if (issues.length) issues.forEach(function (x) { issueRow.appendChild(chip('checkbox', 'interests', x.id, x.label, x.color, have.indexOf(x.id) >= 0)); });
      else WANTS.forEach(function (k) { issueRow.appendChild(chip('checkbox', 'interests', k, T('form.wants.' + k), '', have.indexOf(k) >= 0)); });
      step2.appendChild(el('fieldset', { class: 'field' }, [el('legend', { class: 'field__label', text: issues.length ? T('step2.issues') : T('form.wants.label') }), issueRow]));

      // language
      var langRow = el('div', { class: 'seg' });
      ['en', 'es', 'both'].forEach(function (k) {
        var input = el('input', { type: 'radio', name: 'langPref', value: k });
        if (member.langPref === k) input.checked = true;
        langRow.appendChild(el('label', { class: 'seg__opt' }, [input, el('span', { text: T('form.language.' + k) })]));
      });
      step2.appendChild(el('fieldset', { class: 'field' }, [el('legend', { class: 'field__label', text: T('form.language.label') }), langRow]));

      // access needs
      var aid = uid('access');
      var ta = el('textarea', { id: aid, name: 'access', rows: '3', maxlength: '500', 'aria-describedby': aid + '-hint' });
      ta.value = member.access || '';
      step2.appendChild(el('div', { class: 'field' }, [
        el('label', { class: 'field__label', for: aid }, [T('form.access.label') + ' ', el('span', { class: 'field__opt', text: T('form.optional') })]),
        ta, el('p', { class: 'field__hint', id: aid + '-hint', text: T('form.access.hint') }),
        el('p', { class: 'field__error', id: aid + '-error', hidden: true })
      ]));

      // guardian email, ages 14 to 17
      if (isMinor(member)) {
        var gid = uid('guardian');
        var gi = el('input', { id: gid, name: 'guardianEmail', type: 'email', inputmode: 'email', autocomplete: 'off', 'aria-describedby': gid + '-hint', maxlength: '254' });
        gi.value = member.guardianEmail || '';
        step2.appendChild(el('div', { class: 'field' }, [
          el('label', { class: 'field__label', for: gid, text: T('form.guardian.label') }), gi,
          el('p', { class: 'field__hint', id: gid + '-hint', text: T('form.guardian.hint') }),
          el('p', { class: 'field__error', id: gid + '-error', hidden: true })
        ]));
      }

      // SMS: only with a mobile number; adults only for now
      if (member.phone) {
        if (isMinor(member)) step2.appendChild(el('p', { class: 'notice notice--info small', text: T('form.consent.smsTeen') }));
        else {
          var sid = uid('sms');
          var box = el('input', { id: sid, name: 'smsOptIn', type: 'checkbox', value: 'yes' });
          if (member.smsOptIn === true) box.checked = true;
          step2.appendChild(el('div', { class: 'stack stack--sm' }, [
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
      skip.addEventListener('click', function () { step2.hidden = true; paintPicks(YSD.members.current() || member); picks.hidden = false; });
      step2.appendChild(el('div', { class: 'btn-row' }, [save, skip]));
      step2.hidden = false;
      if (picks) picks.hidden = true;
    }

    function paintPicks(member) {
      if (!picks) return;
      picks.textContent = '';
      var bits = [];
      var city = CITIES.filter(function (c) { return c[0] === member.city; })[0];
      if (city) bits.push(city[1].indexOf('.') > 0 ? T(city[1]) : city[1]);
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
    }

    if (step2) step2.addEventListener('submit', function (e) {
      e.preventDefault();
      var me = YSD.members.current();
      if (!me) return;
      var fd = new FormData(step2);
      var interests = fd.getAll('interests').map(String);
      var g = String(fd.get('guardianEmail') || '').trim();
      if (g && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(g)) {
        if (YSD.ui && YSD.ui.form) YSD.ui.form.errors(step2, { guardianEmail: 'invalid' }, { messages: { guardianEmail: T('error.email.invalid') } });
        return;
      }
      if (YSD.ui && YSD.ui.form) YSD.ui.form.clear(step2);
      var sms = !!fd.get('smsOptIn') && !!me.phone && !isMinor(me);
      var L = (w.YSD_DATA || {}).legal, ver = L && L.snippets && L.snippets.smsConsent && L.snippets.smsConsent.version;
      var profile = {
        firstName: me.firstName, email: me.email, phone: me.phone, age: me.age,
        city: String(fd.get('city') || ''), interests: interests, langPref: String(fd.get('langPref') || ''),
        access: String(fd.get('access') || '').trim(), smsOptIn: sms
      };
      if (isMinor(me)) profile.guardianEmail = g;
      if (sms && me.smsOptIn !== true) { profile.smsConsentVersion = ver || SMS_VERSION_FALLBACK; profile.smsConsentAt = Date.now(); }
      var saved;
      try { saved = YSD.members.join(profile); } catch (err) {
        if (YSD.ui) YSD.ui.toast(T('error.submit.failed'), { tone: 'error' });
        return;
      }
      track('join_step2', { fields: (profile.city ? 1 : 0) + (interests.length ? 1 : 0) + (profile.langPref ? 1 : 0) + (profile.access ? 1 : 0) + (sms ? 1 : 0) });
      step2.hidden = true;
      paintPicks(saved);
      if (YSD.ui) YSD.ui.toast(T('step2.saved'), { tone: 'success' });
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
      var existing = YSD.members.current(), member;
      try { member = YSD.members.join(profile); } catch (err) {
        if (err && err.errors && YSD.ui) YSD.ui.form.errors(form, err.errors);
        else if (YSD.ui) YSD.ui.toast(T('error.submit.failed'), { tone: 'error' });
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
      var h = paintDone(member, false);
      if (!compact) paintStep2(member);
      setState('done');
      if (YSD.ui) YSD.ui.toast(T('toast.joined'), { tone: 'success' });
      mountCard(cardHost, member);
      h.focus();
      emit('join-form-joined', { member: member, isNew: !!isNew, compact: compact });
      if (typeof opts.onJoined === 'function') { try { opts.onJoined(member, { isNew: !!isNew, compact: compact }); } catch (x) {} }
    }

    var ctl = {
      form: form, root: root,
      member: function () { return YSD.members ? YSD.members.current() : null; },
      reset: function () {
        // "Not {name}? Start over" forgets the member, but the invite link this visit arrived on
        // (share.js 'ref' and 'utm') still applies, so a re-join keeps referredBy (BRIEF 5.1, B20).
        var keep = {};
        try { if (YSD.store) ['ref', 'utm', 'utm:first'].forEach(function (k) { keep[k] = YSD.store.get(k, null); }); } catch (x) {}
        try { if (YSD.members) YSD.members.forget(); } catch (x) {}
        try { if (YSD.store) Object.keys(keep).forEach(function (k) { if (keep[k] != null) YSD.store.set(k, keep[k]); }); } catch (x) {}
        form.reset();
        form.hidden = false;
        done.hidden = true; young.hidden = true;
        if (step2) step2.hidden = true;
        if (picks) picks.hidden = true;
        if (cardHost) { if (cardHost.__ysdCard && cardHost.__ysdCard.destroy) cardHost.__ysdCard.destroy(); cardHost.__ysdCard = null; cardHost.textContent = ''; cardHost.hidden = true; }
        setState('idle');
        emit('join-form-reset', {});
        if (f.first) f.first.focus();
      },
      showStep2: function () {
        var me = YSD.members && YSD.members.current();
        if (!me || !step2) return false;
        paintStep2(me);
        var first = step2.querySelector('input'); if (first) first.focus();
        return true;
      }
    };
    form.__ysdJoin = ctl;

    // returning member: show the "already in" state instead of an empty form
    var me = YSD.members && YSD.members.current();
    if (me && me.firstName) {
      form.hidden = true;
      paintDone(me, true);
      if (!compact) { paintPicks(me); if (/^#more$/.test(w.location.hash)) paintStep2(me); }
      mountCard(cardHost, me);
      setState('done');
    } else setState('idle');
    return ctl;
  }

  function mountAll(root) {
    Array.prototype.forEach.call((root || d).querySelectorAll('form[data-join-form]:not([data-join-manual])'), function (f) { mount(f); });
  }

  YSD.joinForm = { mount: mount, mountAll: mountAll, parseContact: parseContact, parseAge: parseAge };
  function boot() { mountAll(d); }
  if (YSD.ui && YSD.ui.ready) YSD.ui.ready(boot);
  else if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window, document);
