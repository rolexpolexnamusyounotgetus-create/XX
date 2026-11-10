/*! YDSC · assets/js/rsvp.js (W2). The shared RSVP state, the RSVP sheet, calendar and +1 sharing, and the
 * invite landing banner (BRIEF 5.1, 5.4, 7.6, 7.7). Partiful-style: one tap opens a short sheet, no account.
 *
 * Classic script. Load after the core stack (config, store, share, cal, members, track, ui) and after
 * assets/js/eventcard.js and the events data (data/events.js or a slice with the same namespace).
 * Pages that load it also load assets/css/rsvp.css. Every module it uses is optional: it degrades to
 * the plain links in the markup. Untrusted text (names, ?from=) is always set with textContent.
 *
 * API
 *   YSD.rsvp.open(eventId, { opener, status })   opens the sheet ('in' by default; 'waitlist' when the
 *                                                event is full). Already in? Opens the success state.
 *   YSD.rsvp.state(eventId)                      -> stored record or null (shape below)
 *   YSD.rsvp.set(eventId, status)                'maybe' | 'cant' | 'in' | 'waitlist' | null (clear).
 *                                                Maybe and Can't need no sheet; they get a warm toast.
 *   YSD.rsvp.count(eventId)                      -> DEMO going count + 1 + plus-ones when you're in
 *   YSD.rsvp.on(cb)                              -> off(); cb(eventId, record) after every change
 *   YSD.rsvp.submit(payload)                     -> Promise<{ ok, mode: 'demo'|'rsvp'|'form'|'mobilize'|'queued' }>
 *   YSD.rsvp.refresh(eventId?)                   re-syncs every control on the page
 *   YSD.rsvp.last()                              -> rsvp:last { firstName, contact, contactType, eventId, ts } or null
 *   YSD.rsvp.shareUrl(eventId) / .shareText(eventId)   the +1 link (your ref, ?e=, ?from= for adults who allow it)
 *   YSD.invite.landing(root?)                    shows [data-invite-landing] when the URL has ?ref or ?from
 *                                                (runs on load; returns the banner element or null). On an event
 *                                                page (or when ?e= names this page's event) it is one slim line,
 *                                                "Kira invited you" + dismiss, with no title, date or button (the
 *                                                page already has them; journeys-15). Elsewhere it names the event,
 *                                                the date and the city (journeys-25).
 *
 * ROUND 1 (G-EVENTS, Tue Nov 10, 2026)
 *   Age screen (journeys-02, BRIEF 5.4): the sheet asks "How old are you?" (core strings form.age.*, mirrors of
 *   legal.snippets.ageLabel/ageHint) as a free number field, never prefilled, skipped when YSD.members.current().age
 *   is known or an earlier RSVP on this device already answered it. Under 14: the sheet shows error.age.too_young,
 *   clears what was typed, and stores and sends nothing. 14 to 17: under18 is derived (no checkbox), the guardian
 *   note shows on ages.guardian events, "show my name" is off and invite links never carry the name.
 *   Success (genz-brand-08): the sheet turns into a ticket ("Admit SOFIA +1", a SEAT SAVED stamp, your initial in the
 *   face pile) with confetti drawn above the open dialog (YSD.ui.confetti uses the top layer); static under reduced
 *   motion, no confetti on calm events.
 *   I'm-going card (genz-brand-09): the success state lazy-loads assets/js/cards-brand.js, renders
 *   YSD.brandCards.render('going', ..., { size: 'story' }) before any tap (guarded by YSD.cards.has('going')) and
 *   shares it with YSD.cards.share. Under-18s' cards carry no name.
 *   Join from the RSVP (journeys-09): when nobody has joined on this device, "Want credit when friends come?" joins
 *   in one tap with the name, contact and age just given (YSD.members.join, joinSource 'rsvp'); the +1 link and the
 *   text link then carry the new ref. Without an age from this visit it links to join.html instead.
 *   rsvp:last = { firstName, contact, contactType, eventId, ts } (no age) is saved on every I'm in / waitlist, for
 *   join.html's prefill (G-JOIN reads it; YSD.members.reset() clears it).
 *   YSD.rsvp.open(eventId, opts) works on any page that loads eventcard.js, rsvp.js, rsvp.css and the events data
 *   (data/slices/events.js is enough): join.html?e=<id> calls it (journeys-13). It returns the dialog, or null when
 *   the id is unknown (keep your plain link then).
 *
 * MARKUP CONTRACT (data attributes; rsvp.js wires them on load and keeps them in sync)
 *   [data-rsvp="<id>"]                     I'm in. Ship it as <a href="join.html?e=<id>"> so it works with
 *                                          JS off; rsvp.js adds role="button" and aria-pressed, and the
 *                                          label becomes "You're in" (or "Join the waitlist" when full).
 *                                          Add data-rsvp-keep to keep your own label.
 *   [data-rsvp="<id>"][data-rsvp-status="maybe|cant"]   Maybe / Can't buttons (aria-pressed). Ship them
 *                                          with `hidden`; rsvp.js shows them (they need JS).
 *   [data-rsvp-going="<id>"]              the going row: face pile + count + spots (YSD.events.fillGoing)
 *   [data-rsvp-count="<id>"]              any element whose text becomes "{n} going (DEMO)"
 *   [data-rsvp-seats="<id>"]              a seats bar + "{n} of {cap} seats saved (DEMO)" (YSD.events.fillSeats)
 *   [data-rsvp-state="<id>"]              gets data-state="in|maybe|cant|waitlist|none" for CSS
 *   [data-rsvp-cal="<id>"]                button: downloads the .ics; [data-rsvp-cal-google|outlook="<id>"]
 *                                          links get their href
 *   [data-rsvp-share="<id>"]              +1 a friend (Web Share, copy fallback); [data-rsvp-sms="<id>"]
 *                                          link gets an sms: href with the invite text
 *   [data-invite-landing]                 empty, hidden container at the top of <main>
 * DOM events (on document, via YSD.emit): ysd:rsvp {eventId, record}, ysd:rsvp-submitted {eventId, status, mode},
 *   ysd:invite-landing {eventId, ref, from}.
 *
 * STORAGE (YSD.store, so keys get the ysd: prefix)
 *   rsvp:<eventId> = { eventId, status: 'in'|'maybe'|'cant'|'waitlist', firstName, contact,
 *                      contactType: 'email'|'phone', plusOne, access, showName, under18, ageChecked, shareName,
 *                      ref, from, lang, ts, synced: false, demo: true }   (the exact age is never stored)
 *   rsvp:last = { firstName, contact, contactType, eventId, ts }   for join.html's prefill
 *   rsvp:queue = [payload]   submits that failed; retried on 'online' and on load
 *   invite:seen:<ref>        timestamp, set when someone dismisses the landing banner
 * Production seam: submit() POSTs JSON to integrations.rsvpEndpoint, else to integrations.formEndpoint
 * with formName 'rsvp', else opens the event's Mobilize URL (event.mobilize) with the ref as
 * utm_source. In demo mode nothing leaves the browser. Contact details never go to analytics.
 * There is no AI feature here.
 */
(function (w, d) {
  'use strict';
  var YSD = w.YSD = w.YSD || {};
  var KEY = 'rsvp:', QUEUE = 'rsvp:queue', LAST = 'rsvp:last';
  var ages = {};          // eventId -> the age typed on this visit (memory only; used by the one-tap join)
  var cardFor = null, cardCanvas = null, cardLoading = null;
  var listeners = [];
  var mem = {};
  var sheet = null, current = null, landingFrom = '';

  /* ------------------------------------------------------------------ helpers */
  function cfg(p, f) { return typeof YSD.cfg === 'function' ? YSD.cfg(p, f) : f; }
  function emit(n, det) { if (typeof YSD.emit === 'function') YSD.emit(n, det); }
  function track(e, p) { try { if (typeof YSD.track === 'function') YSD.track(e, p); } catch (x) {} }
  function lang() { return YSD.lang || (String(d.documentElement.getAttribute('lang') || 'en').slice(0, 2) === 'es' ? 'es' : 'en'); }
  function data() { return (w.YSD_DATA && w.YSD_DATA.events) || { items: [] }; }
  function tx(o) { if (o == null) return ''; if (typeof o === 'string') return o; return o[lang()] != null ? o[lang()] : (o.en || ''); }
  function fill(s, vars) { return String(s == null ? '' : s).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? String(vars[k]) : m; }); }
  function t(key, vars) { return typeof YSD.t === 'function' ? YSD.t(key, vars) : ''; }
  // English fallbacks, so a page whose events slice predates a label still reads right (re-run the slice for Spanish)
  var FALLBACK = { youreIn: "You're in", waitlist: 'Join the waitlist', going: '{n} going (DEMO)', rsvp: 'Save my seat', notNow: 'Not now', done: 'Done',
    stamp: 'Seat saved', admit: 'Admit', plus: '+{n}', you: 'You', goingTitle: 'Tell your people', goingBtn: "Share my I'm-going card", goingFile: 'im-going',
    joinTitle: 'Want credit when friends come?', joinSub: "Get your own invite link. We'll use the name and contact you just gave, so it takes 10 seconds.",
    joinBtn: 'Join free, get my link', joinMore: 'More options on the join page', joinDone: "You're in. Your +1 link and your text now carry your own code.",
    joinFace: 'You just joined the pile.', tooYoungTitle: 'Thanks for wanting to come', invitedLineSub: 'Free, no account. Save your seat below.',
    ageGuardian: "Under 18? This one ends after dark or involves door-knocking, so we'll send a quick guardian form after you RSVP.", onWaitlist: 'On the waitlist',
    demoEvent: 'DEMO event', calTitle: 'Add it to your calendar', calIcs: 'Calendar file (.ics)', calGoogle: 'Google', calOutlook: 'Outlook.com', bringTitle: 'Bring a friend',
    plusOneFriend: '+1 a friend', share: 'Text this to a friend', changeRsvp: 'Change my RSVP', cantAnymore: "Can't make it anymore" };
  function lbl(key, vars) { var L = data().labels || {}; return fill(tx(L[key]) || FALLBACK[key] || '', vars); }
  function el(tag, cls, text) { var n = d.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function $$(sel, root) { return Array.prototype.slice.call((root || d).querySelectorAll(sel)); }
  function sget(k, fb) { try { if (YSD.store) return YSD.store.get(k, fb); } catch (e) {} return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : fb; }
  function sset(k, v) { try { if (YSD.store) { YSD.store.set(k, v); return v; } } catch (e) {} mem[k] = v; return v; }
  function sdel(k) { try { if (YSD.store) { YSD.store.remove(k); return; } } catch (e) {} delete mem[k]; }
  function ev(id) {
    if (YSD.events && YSD.events.get) return YSD.events.get(id);
    var items = data().items || [];
    for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i];
    return null;
  }
  function isFull(e) { return YSD.events && YSD.events.isFull ? YSD.events.isFull(e) : (e && e.status === 'full'); }
  function isDemo() { return cfg('demo', true) !== false; }
  function capRef() { try { return YSD.share && YSD.share.ref ? YSD.share.ref() : null; } catch (e) { return null; } }
  function cleanName(s) { return String(s == null ? '' : s).replace(/[^\p{L}\p{M} '-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 20); }
  function eventWhen(e) { return YSD.events && YSD.events.when ? YSD.events.when(e) : tx(e.when); }
  function svgClose() {
    var ns = 'http://www.w3.org/2000/svg', s = d.createElementNS(ns, 'svg'), p = d.createElementNS(ns, 'path');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('focusable', 'false');
    p.setAttribute('d', 'M6 6l12 12M18 6 6 18'); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '2.6');
    p.setAttribute('stroke-linecap', 'round'); p.setAttribute('fill', 'none'); s.appendChild(p);
    return s;
  }

  /* ------------------------------------------------------------------ state */
  function state(id) { var r = sget(KEY + id, null); return r && r.eventId ? r : null; }
  function count(id) {
    var e = ev(id); if (!e) return 0;
    var n = +e.going || 0, r = state(id);
    if (r && r.status === 'in') n += 1 + Math.max(0, Math.min(5, +r.plusOne || 0));
    return n;
  }
  function on(cb) { listeners.push(cb); return function () { listeners = listeners.filter(function (f) { return f !== cb; }); }; }
  function notify(id, rec) {
    listeners.slice().forEach(function (f) { try { f(id, rec); } catch (e) {} });
    emit('rsvp', { eventId: id, record: rec });
    refresh(id);
  }
  function save(rec) { sset(KEY + rec.eventId, rec); notify(rec.eventId, rec); return rec; }
  function set(id, status, extra) {
    var prev = state(id);
    if (!status) { sdel(KEY + id); notify(id, null); return null; }
    var rec = {};
    var k;
    if (prev) for (k in prev) rec[k] = prev[k];
    if (extra) for (k in extra) rec[k] = extra[k];
    rec.eventId = id; rec.status = status; rec.lang = lang(); rec.ts = Date.now();
    rec.ref = rec.ref || capRef(); rec.from = rec.from || landingFrom || null;
    rec.synced = false; rec.demo = isDemo();
    if (status === 'in' && !(prev && prev.status === 'in') && !(prev && prev.countedIn)) {
      rec.countedIn = true;
      try { if (YSD.counters && YSD.counters.bump) YSD.counters.bump('rsvps'); } catch (e) {}
    }
    track('rsvp', { event: id, status: status, referred: !!rec.ref });
    return save(rec);
  }

  /* ------------------------------------------------------------------ submit (production seam) */
  function post(url, body, form) {
    if (typeof w.fetch !== 'function') return Promise.reject(new Error('no fetch'));
    var opts = { method: 'POST', headers: {}, body: '' };
    if (form) {
      opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      opts.body = Object.keys(body).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(body[k] == null ? '' : body[k]); }).join('&');
    } else { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return w.fetch(url, opts).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r; });
  }
  function submit(payload) {
    payload = payload || {};
    if (isDemo()) return Promise.resolve({ ok: true, mode: 'demo' });
    var rsvpUrl = cfg('integrations.rsvpEndpoint', ''), formUrl = cfg('integrations.formEndpoint', '');
    var p;
    if (rsvpUrl) p = post(rsvpUrl, payload, false).then(function () { return { ok: true, mode: 'rsvp' }; });
    else if (formUrl) {
      var body = { 'form-name': 'rsvp', formName: 'rsvp' }; for (var k in payload) body[k] = typeof payload[k] === 'object' ? JSON.stringify(payload[k]) : payload[k];
      p = post(formUrl, body, cfg('integrations.formEncoding', 'json') === 'form').then(function () { return { ok: true, mode: 'form' }; });
    } else {
      var e = ev(payload.eventId);
      if (e && e.mobilize) {
        try { var u = new w.URL(e.mobilize); if (payload.ref) u.searchParams.set('utm_source', payload.ref); w.open(u.href, '_blank', 'noopener'); } catch (x) {}
        return Promise.resolve({ ok: true, mode: 'mobilize' });
      }
      return Promise.resolve({ ok: false, mode: 'none' });
    }
    return p.then(function (r) {
      var rec = state(payload.eventId); if (rec) { rec.synced = true; sset(KEY + rec.eventId, rec); }
      return r;
    }, function () {
      var qd = sget(QUEUE, []); if (!Array.isArray(qd)) qd = [];
      qd.push(payload); sset(QUEUE, qd.slice(-20));
      return { ok: false, mode: 'queued' };
    });
  }
  function retry() {
    if (isDemo()) return;
    var qd = sget(QUEUE, []); if (!Array.isArray(qd) || !qd.length) return;
    sset(QUEUE, []);
    qd.forEach(function (p) { submit(p); });
  }

  /* ------------------------------------------------------------------ share (+1 a friend) */
  function sharePath(e) { return YSD.events && YSD.events.path ? YSD.events.path(e) : ((lang() === 'es' ? 'es/' : '') + 'events/' + e.id + '.html'); }
  function shareUrl(id) {
    var e = ev(id); if (!e) return '';
    // from: the RSVP's first name for adults who allow it; none for under-18s; otherwise share.url decides
    // (an adult member's links carry their first name automatically)
    var r = state(id), from;
    if (r && r.under18) from = false;
    else if (r && r.firstName && r.shareName !== false) from = cleanName(r.firstName) || undefined;
    else if (r && r.shareName === false) from = false;
    var m = YSD.members && YSD.members.current ? YSD.members.current() : null;
    if (m && m.age != null && +m.age < 18) from = false;
    var params = { e: e.id }; if (from !== undefined) params.from = from;
    try { return YSD.share.url(sharePath(e), params); } catch (x) { return ''; }
  }
  function shareText(id, withLink) {
    var e = ev(id); if (!e) return '';
    var tpl = tx(e.share && e.share.text) || '';
    var demo = isDemo() && e.demo ? ' ' + lbl('demoShare') : '';
    var base = tpl.replace(/\s*\{(?:url|link)\}\s*$/, '');
    return withLink ? base + demo + ' ' + shareUrl(id) : base + demo;
  }
  function doShare(id, btn) {
    var e = ev(id); if (!e) return;
    var opts = { title: tx(e.share && e.share.title) || tx(e.title), text: shareText(id, false), url: shareUrl(id) };
    if (YSD.ui && YSD.ui.share) YSD.ui.share(opts);
    else if (YSD.share && YSD.share.native) YSD.share.native(opts);
    if (btn) { btn.setAttribute('data-state', 'pressed'); setTimeout(function () { btn.removeAttribute('data-state'); }, 160); }
  }
  function smsHref(id) {
    var text = shareText(id, true);
    try { if (YSD.share && YSD.share.links) { var L = YSD.share.links(shareText(id, false), shareUrl(id)); if (L && L.sms) return L.sms; } } catch (x) {}
    return 'sms:?&body=' + encodeURIComponent(text);
  }
  function calEvent(e) { return YSD.events && YSD.events.cal ? YSD.events.cal(e, lang()) : null; }

  /* ------------------------------------------------------------------ the sheet */
  var uid = 0;
  function field(name, labelText, opts) {
    opts = opts || {};
    var f = el('div', 'field' + (opts.check ? ' field--check' : ''));
    var id = 'rsvp-' + name + '-' + (++uid);
    var input;
    if (opts.kind === 'select') {
      input = d.createElement('select');
      opts.options.forEach(function (o) { var op = el('option', null, o[1]); op.value = o[0]; input.appendChild(op); });
    } else if (opts.kind === 'textarea') { input = d.createElement('textarea'); input.rows = 2; }
    else { input = d.createElement('input'); input.type = opts.type || 'text'; }
    input.id = id; input.name = name;
    if (opts.autocomplete) input.setAttribute('autocomplete', opts.autocomplete);
    if (opts.inputmode) input.setAttribute('inputmode', opts.inputmode);
    if (opts.pattern) input.setAttribute('pattern', opts.pattern);
    if (opts.maxlength) input.setAttribute('maxlength', String(opts.maxlength));
    if (opts.required) { input.required = true; input.setAttribute('aria-required', 'true'); }
    var lab = el('label', 'field__label'); lab.htmlFor = id; lab.textContent = labelText;
    if (opts.optional) { lab.appendChild(d.createTextNode(' ')); lab.appendChild(el('span', 'field__opt', t('form.optional') || '(optional)')); }
    var hint = null;
    if (opts.hint) { hint = el('p', 'field__hint', opts.hint); hint.id = id + '-hint'; input.setAttribute('aria-describedby', hint.id); }
    var err = el('p', 'field__error'); err.id = id + '-error'; err.hidden = true;
    if (opts.check) { f.appendChild(input); f.appendChild(lab); if (hint) f.appendChild(hint); }
    else { f.appendChild(lab); if (hint) f.appendChild(hint); f.appendChild(input); f.appendChild(err); }
    return f;
  }
  function minAge() { return +cfg('org.minAge', 14) || 14; }
  function member() { try { return YSD.members && YSD.members.current ? YSD.members.current() : null; } catch (e) { return null; } }
  function knownAge() { var m = member(); return m && m.age != null && m.age !== '' && !isNaN(+m.age) ? +m.age : null; }
  /** An earlier RSVP on this device already answered the age screen: reuse its under-18 answer (never the age). */
  function priorAgeAnswer(id) {
    var r = state(id);
    if (r && r.ageChecked) return { under18: !!r.under18 };
    var best = null, keys = [];
    try { keys = YSD.store && YSD.store.keys ? YSD.store.keys() : []; } catch (e) { keys = []; }
    keys.forEach(function (k) { var s0 = String(k).replace(/^ysd:/, ''); if (s0.indexOf(KEY) === 0 && s0 !== QUEUE && s0 !== LAST) { var x = sget(s0, null); if (x && x.ageChecked && (!best || x.ts > best.ts)) best = x; } });
    return best ? { under18: !!best.under18 } : null;
  }
  function parseAge(v) { var s0 = String(v == null ? '' : v).trim(); return /^\d{1,3}$/.test(s0) ? parseInt(s0, 10) : NaN; }

  function build() {
    if (sheet) return sheet;
    var F = (data().rsvpForm || {});
    var dlg = el('dialog', 'sheet rsvp-sheet');
    dlg.setAttribute('data-rsvp-sheet', '');
    dlg.setAttribute('aria-labelledby', 'rsvp-sheet-title');
    var head = el('div', 'sheet__head');
    var hs = el('div', 'stack stack--sm');
    var tag = el('span', 'tag tag--demo', lbl('demoEvent')); tag.setAttribute('data-rsvp-sheet-tag', '');
    var title = el('h2', 'sheet__title', lbl('rsvp')); title.id = 'rsvp-sheet-title'; title.tabIndex = -1;
    var sub = el('p', 'small muted rsvp-sheet__sub'); sub.setAttribute('data-rsvp-sheet-sub', '');
    hs.appendChild(tag); hs.appendChild(title); hs.appendChild(sub);
    var close = el('button', 'sheet__close'); close.type = 'button'; close.setAttribute('data-sheet-close', '');
    close.setAttribute('aria-label', t('a11y.close') || 'Close'); close.appendChild(svgClose());
    head.appendChild(hs); head.appendChild(close);
    dlg.appendChild(head);

    // ---- the form
    var form = el('form', 'rsvp-sheet__form'); form.noValidate = true; form.setAttribute('data-rsvp-form', '');
    var body = el('div', 'sheet__body');
    var note = el('p', 'rsvp-sheet__note'); note.setAttribute('data-rsvp-sheet-note', ''); note.hidden = true;
    body.appendChild(note);
    var sum = el('div', 'form__summary'); sum.hidden = true;
    var st = el('p', 'form__summary-title'); st.setAttribute('data-summary-title', ''); sum.appendChild(st); sum.appendChild(el('ul'));
    body.appendChild(sum);
    var row = el('div', 'form__row form__row--2');
    row.appendChild(field('firstName', t('form.firstName.label') || 'First name', { required: true, autocomplete: 'given-name' }));
    row.appendChild(field('contact', t('form.contact.label') || 'Email or mobile', { required: true, autocomplete: 'email', inputmode: 'email', hint: t('form.rsvp.contact.hint') }));
    body.appendChild(row);
    // neutral age screen: free entry, no minimum hinted, never prefilled (legal.snippets.ageLabel/ageHint)
    var ageF = field('age', t('form.age.label') || 'How old are you?', { required: true, inputmode: 'numeric', pattern: '[0-9]*', maxlength: 3, hint: t('form.age.hint'), autocomplete: 'off' });
    ageF.classList.add('rsvp-sheet__age'); ageF.setAttribute('data-rsvp-age', '');
    body.appendChild(ageF);
    var guard = el('p', 'notice notice--info rsvp-sheet__guardian', lbl('ageGuardian') || tx(data().policy && data().policy.guardian)); guard.setAttribute('data-rsvp-guardian', ''); guard.hidden = true;
    body.appendChild(guard);
    body.appendChild(field('plusOne', t('form.rsvp.plusOne.label') || 'Bringing someone?', { kind: 'select', optional: true,
      options: [['0', t('form.rsvp.plusOne.none') || 'Just me'], ['1', t('form.rsvp.plusOne.plus1') || 'Me +1'], ['2', t('form.rsvp.plusOne.plus2') || 'Me +2']] }));
    body.appendChild(field('access', t('form.access.label') || 'Anything that would make this easier?', { kind: 'textarea', optional: true, hint: t('form.access.hint') }));
    var showF = field('showName', t('form.rsvp.showName.label') || "Show my first name on the who's going list", { type: 'checkbox', check: true, hint: t('form.rsvp.showName.hint') });
    body.appendChild(showF);
    var hp = el('div', 'u-visually-hidden'); hp.setAttribute('aria-hidden', 'true');
    var hpi = d.createElement('input'); hpi.type = 'text'; hpi.name = '_hp'; hpi.tabIndex = -1; hpi.autocomplete = 'off'; hp.appendChild(hpi);
    body.appendChild(hp);
    var consent = el('p', 'consent');
    var cs = el('span');
    cs.appendChild(d.createTextNode([tx(F.consent), t('form.privacyPromise'), tx(F.demoNote)].filter(Boolean).join(' ') + ' '));
    var pl = el('a', null, t('form.consent.privacyLink') || 'Privacy Policy');
    pl.href = (YSD.events && YSD.events.rootPrefix ? YSD.events.rootPrefix() : '') + (lang() === 'es' ? 'es/' : '') + 'privacy.html';
    cs.appendChild(pl); cs.appendChild(d.createTextNode('.'));
    consent.appendChild(cs);
    body.appendChild(consent);
    form.appendChild(body);
    var foot = el('div', 'sheet__foot');
    var sb = el('button', 'btn btn--primary btn--lg', lbl('rsvp')); sb.type = 'submit'; sb.setAttribute('data-rsvp-submit', '');
    var nn = el('button', 'btn btn--quiet', lbl('notNow')); nn.type = 'button'; nn.setAttribute('data-sheet-close', '');
    foot.appendChild(sb); foot.appendChild(nn);
    form.appendChild(foot);
    dlg.appendChild(form);

    // ---- too young (under the minimum age): nothing kept, nothing sent
    var young = el('div', 'rsvp-young'); young.setAttribute('data-rsvp-young', ''); young.hidden = true;
    var yb = el('div', 'sheet__body');
    var yst = el('span', 'sticker sticker--lg rsvp-young__sticker'); yst.setAttribute('data-sticker', 'heart'); yst.setAttribute('aria-hidden', 'true');
    yb.appendChild(yst);
    var yp = el('p', 'rsvp-young__line'); yp.setAttribute('data-rsvp-young-line', ''); yp.tabIndex = -1;
    yb.appendChild(yp);
    young.appendChild(yb);
    var yf = el('div', 'sheet__foot');
    var yok = el('button', 'btn btn--ink', lbl('done')); yok.type = 'button'; yok.setAttribute('data-sheet-close', '');
    yf.appendChild(yok);
    young.appendChild(yf);
    dlg.appendChild(young);

    // ---- the success state: the ticket is the hero
    var done = el('div', 'rsvp-done'); done.setAttribute('data-rsvp-done', ''); done.hidden = true;
    var db = el('div', 'sheet__body');
    var tkt = el('div', 'rsvp-ticket'); tkt.setAttribute('data-rsvp-ticket', '');
    var tm = el('div', 'rsvp-ticket__main');
    tm.appendChild(el('p', 'rsvp-ticket__admit', lbl('admit')));
    var tn = el('p', 'rsvp-ticket__name'); tn.setAttribute('data-rsvp-ticket-name', ''); tm.appendChild(tn);
    var te = el('p', 'rsvp-ticket__event'); te.setAttribute('data-rsvp-ticket-event', ''); tm.appendChild(te);
    var tw = el('p', 'rsvp-ticket__when'); tw.setAttribute('data-rsvp-ticket-when', ''); tm.appendChild(tw);
    tkt.appendChild(tm);
    var stub = el('div', 'rsvp-ticket__stub'); stub.setAttribute('data-rsvp-ticket-stub', ''); stub.setAttribute('aria-hidden', 'true');
    tkt.appendChild(stub);
    var stamp = el('span', 'rsvp-ticket__stamp', lbl('stamp')); stamp.setAttribute('data-rsvp-stamp', '');
    tkt.appendChild(stamp);
    var ttag = el('span', 'tag tag--demo rsvp-ticket__tag', lbl('demoEvent')); ttag.setAttribute('data-rsvp-ticket-tag', '');
    tkt.appendChild(ttag);
    db.appendChild(tkt);
    var gp = el('div', 'rsvp-done__going'); gp.setAttribute('data-rsvp-done-going', '');
    db.appendChild(gp);
    var dt = el('div', 'stack stack--sm');
    dt.appendChild(el('p', 'rsvp-done__line', t('success.rsvp.body')));
    var dn = el('p', 'small muted'); dn.setAttribute('data-rsvp-done-note', ''); dt.appendChild(dn);
    db.appendChild(dt);

    // I'm-going card (rendered before any tap, so Web Share keeps its user gesture)
    var cg = el('div', 'rsvp-done__group rsvp-card'); cg.setAttribute('data-rsvp-card', ''); cg.hidden = true;
    var cprev = el('div', 'rsvp-card__preview'); cprev.setAttribute('data-rsvp-card-preview', ''); cprev.setAttribute('aria-hidden', 'true');
    cg.appendChild(cprev);
    var cbody = el('div', 'rsvp-card__body');
    cbody.appendChild(el('h3', 'rsvp-done__h', lbl('goingTitle')));
    var cbtn = el('button', 'btn btn--primary', lbl('goingBtn')); cbtn.type = 'button'; cbtn.setAttribute('data-rsvp-card-share', ''); cbtn.disabled = true;
    cbody.appendChild(cbtn);
    cg.appendChild(cbody);
    db.appendChild(cg);

    var calG = el('div', 'rsvp-done__group');
    calG.appendChild(el('h3', 'rsvp-done__h', lbl('calTitle')));
    var calR = el('div', 'rsvp-done__row');
    var ics = el('button', 'btn btn--violet', lbl('calIcs')); ics.type = 'button'; ics.setAttribute('data-rsvp-cal', '');
    var gg = el('a', 'btn', lbl('calGoogle')); gg.setAttribute('data-rsvp-cal-google', ''); gg.target = '_blank'; gg.rel = 'noopener';
    var ol = el('a', 'btn', lbl('calOutlook')); ol.setAttribute('data-rsvp-cal-outlook', ''); ol.target = '_blank'; ol.rel = 'noopener';
    calR.appendChild(ics); calR.appendChild(gg); calR.appendChild(ol);
    calG.appendChild(calR);
    db.appendChild(calG);
    var shG = el('div', 'rsvp-done__group');
    shG.appendChild(el('h3', 'rsvp-done__h', lbl('bringTitle')));
    var shR = el('div', 'rsvp-done__row');
    var sh = el('button', 'btn btn--ink', lbl('plusOneFriend')); sh.type = 'button'; sh.setAttribute('data-rsvp-share', '');
    var sms = el('a', 'btn', lbl('share') || 'Text this to a friend'); sms.setAttribute('data-rsvp-sms', '');
    shR.appendChild(sh); shR.appendChild(sms);
    shG.appendChild(shR);
    var sw = el('label', 'switch rsvp-done__switch');
    var swi = d.createElement('input'); swi.type = 'checkbox'; swi.setAttribute('role', 'switch'); swi.name = 'shareName'; swi.setAttribute('data-rsvp-share-name', '');
    var trk = el('span', 'switch__track'); trk.setAttribute('aria-hidden', 'true');
    sw.appendChild(swi); sw.appendChild(trk); sw.appendChild(d.createTextNode(lbl('shareName')));
    shG.appendChild(sw);
    var teen = el('p', 'small muted', lbl('shareNameTeen')); teen.setAttribute('data-rsvp-teen', ''); teen.hidden = true;
    shG.appendChild(teen);
    db.appendChild(shG);

    // join from the RSVP (journeys-09)
    var jg = el('div', 'rsvp-join'); jg.setAttribute('data-rsvp-join', ''); jg.hidden = true;
    jg.appendChild(el('h3', 'rsvp-join__title', lbl('joinTitle')));
    jg.appendChild(el('p', 'rsvp-join__sub', lbl('joinSub')));
    var jr = el('div', 'rsvp-done__row');
    var jb = el('button', 'btn btn--primary', lbl('joinBtn')); jb.type = 'button'; jb.setAttribute('data-rsvp-join-btn', '');
    var jl = el('a', 'btn btn--ghost', lbl('joinMore')); jl.setAttribute('data-rsvp-join-more', '');
    jr.appendChild(jb); jr.appendChild(jl);
    jg.appendChild(jr);
    var jc = el('p', 'consent rsvp-join__consent'); var jcs = el('span', null, t('form.consent.join')); jc.appendChild(jcs);
    if (!t('form.consent.join')) jc.hidden = true;
    jg.appendChild(jc);
    var jd = el('p', 'rsvp-join__done', lbl('joinDone')); jd.setAttribute('data-rsvp-join-done', ''); jd.hidden = true; jd.setAttribute('tabindex', '-1');
    jg.appendChild(jd);
    db.appendChild(jg);

    done.appendChild(db);
    var df = el('div', 'sheet__foot');
    var ok = el('button', 'btn btn--ink', lbl('done')); ok.type = 'button'; ok.setAttribute('data-sheet-close', '');
    var ch = el('button', 'btn btn--quiet', lbl('changeRsvp')); ch.type = 'button'; ch.setAttribute('data-rsvp-change', '');
    var ca = el('button', 'btn btn--quiet', lbl('cantAnymore')); ca.type = 'button'; ca.setAttribute('data-rsvp-cancel', '');
    df.appendChild(ok); df.appendChild(ch); df.appendChild(ca);
    done.appendChild(df);
    dlg.appendChild(done);

    (d.querySelector('main') || d.body).appendChild(dlg);
    if (YSD.ui && YSD.ui.stickers) YSD.ui.stickers(dlg);
    sheet = dlg;

    // ---- behaviour
    form.elements.age.addEventListener('input', syncTeen);
    form.addEventListener('submit', onSubmit);
    ch.addEventListener('click', function () { var r0 = state(current); showForm(current, r0 && r0.status === 'waitlist' ? 'waitlist' : 'in'); });
    ca.addEventListener('click', function () { var id = current; set(id, 'cant'); YSD.ui && YSD.ui.toast(lbl('cantSaved')); if (YSD.ui) YSD.ui.sheet.close(dlg); });
    swi.addEventListener('change', function () { var r = state(current); if (r) { r.shareName = swi.checked; sset(KEY + r.eventId, r); } syncDoneLinks(); prepareCard(current, true); });
    cbtn.addEventListener('click', function () { shareCard(current, cbtn); });
    jb.addEventListener('click', function () { joinFromRsvp(current); });
    return dlg;
  }
  /** Teen state from the age field (or the known answer): guardian note, "show my name" off for under-18s. */
  function teenNow() {
    if (!sheet) return false;
    var f = sheet.querySelector('[data-rsvp-form]');
    if (f.getAttribute('data-age') === 'skip') return f.getAttribute('data-under18') === 'true';
    var a = parseAge(f.elements.age.value);
    return !isNaN(a) && a >= minAge() && a < 18;
  }
  function syncTeen() {
    if (!sheet) return;
    var f = sheet.querySelector('[data-rsvp-form]'), show = f.elements.showName, guard = sheet.querySelector('[data-rsvp-guardian]');
    var teenOn = teenNow(), e = ev(current);
    if (teenOn) show.checked = false;
    show.disabled = teenOn;
    guard.hidden = !(teenOn && e && e.ages && e.ages.guardian);
  }

  function prefill(form, id) {
    var r = state(id), last = null, m = member();
    if (!r) {
      // your details from a past RSVP on this device (yours, never made up), else your member record
      last = sget(LAST, null);
      if (!last || !last.firstName) {
        var keys = [];
        try { keys = YSD.store && YSD.store.keys ? YSD.store.keys() : []; } catch (e) { keys = []; }
        keys.forEach(function (k) { var s0 = String(k).replace(/^ysd:/, ''); if (s0.indexOf(KEY) === 0 && s0 !== QUEUE && s0 !== LAST) { var x = sget(s0, null); if (x && x.firstName && (!last || x.ts > last.ts)) last = x; } });
      }
    }
    var src = r || last || {};
    form.elements.firstName.value = src.firstName || (m && m.firstName) || '';
    form.elements.contact.value = src.contact || (m && (m.email || m.phone)) || '';
    form.elements.plusOne.value = String(r && r.plusOne ? r.plusOne : 0);
    form.elements.access.value = (r && r.access) || '';
    // the age screen: skipped when the member's age is known or this device already answered it; never prefilled
    var ka = knownAge(), prior = ka == null ? priorAgeAnswer(id) : null;
    var ageBox = sheet.querySelector('[data-rsvp-age]');
    form.elements.age.value = '';
    if (ka != null) { form.setAttribute('data-age', 'skip'); form.setAttribute('data-under18', ka < 18 ? 'true' : 'false'); }
    else if (prior) { form.setAttribute('data-age', 'skip'); form.setAttribute('data-under18', prior.under18 ? 'true' : 'false'); }
    else { form.setAttribute('data-age', 'ask'); form.removeAttribute('data-under18'); }
    ageBox.hidden = form.getAttribute('data-age') === 'skip';
    form.elements.age.required = !ageBox.hidden;
    var minor = form.getAttribute('data-under18') === 'true';
    form.elements.showName.checked = !!(r && r.showName && !minor);
    form.elements._hp.value = '';
  }

  function headFor(e, mode, r) {
    var title = sheet.querySelector('#rsvp-sheet-title'), sub = sheet.querySelector('[data-rsvp-sheet-sub]'), tagEl = sheet.querySelector('[data-rsvp-sheet-tag]');
    tagEl.hidden = !e.demo;
    sub.textContent = tx(e.title) + ' · ' + eventWhen(e);
    var name = r && r.firstName ? cleanName(r.firstName) : '';
    if (mode === 'done-in') title.textContent = lbl('youreIn') + (name ? ', ' + name : '') + '.';
    else if (mode === 'done-waitlist') title.textContent = lbl('onWaitlist');
    else if (mode === 'waitlist') title.textContent = lbl('waitlistTitle');
    else if (mode === 'young') title.textContent = lbl('tooYoungTitle') || lbl('rsvp');
    else title.textContent = lbl('rsvp');
  }
  function panes(which) {
    ['[data-rsvp-form]', '[data-rsvp-done]', '[data-rsvp-young]'].forEach(function (sel, i) { sheet.querySelector(sel).hidden = ['form', 'done', 'young'][i] !== which; });
  }
  function showForm(id, status) {
    var e = ev(id); if (!e) return;
    var form = sheet.querySelector('[data-rsvp-form]');
    var wait = status === 'waitlist';
    sheet.setAttribute('data-mode', wait ? 'waitlist' : 'in');
    form.setAttribute('data-status', wait ? 'waitlist' : 'in');
    headFor(e, wait ? 'waitlist' : 'in');
    var note = sheet.querySelector('[data-rsvp-sheet-note]');
    note.textContent = wait ? lbl('waitlistSub') : (tx(e.bringFriend) || '');
    note.hidden = !note.textContent;
    sheet.querySelector('[data-rsvp-submit]').textContent = wait ? lbl('waitlistTitle') : lbl('rsvp');
    if (YSD.ui && YSD.ui.form) YSD.ui.form.clear(form);
    prefill(form, id);
    panes('form');
    syncTeen();
    setTimeout(function () { try { form.elements.firstName.focus(); } catch (x) {} }, 0);
  }
  function showYoung(id) {
    var e = ev(id); if (!e) return;
    var form = sheet.querySelector('[data-rsvp-form]');
    form.reset(); form.elements.age.value = '';
    if (YSD.ui && YSD.ui.form) YSD.ui.form.clear(form);
    sheet.setAttribute('data-mode', 'young');
    headFor(e, 'young');
    sheet.querySelector('[data-rsvp-sheet-note]').hidden = true;
    var line = sheet.querySelector('[data-rsvp-young-line]');
    line.textContent = t('error.age.too_young', { minAge: minAge() }) || '';
    panes('young');
    setTimeout(function () { try { line.focus(); } catch (x) {} }, 0);
    emit('rsvp-too-young', { eventId: id });
  }
  function syncDoneLinks() {
    var id = current, e = ev(id); if (!e || !sheet) return;
    var c = calEvent(e);
    if (c && YSD.cal) {
      var g = sheet.querySelector('[data-rsvp-cal-google]'), o = sheet.querySelector('[data-rsvp-cal-outlook]');
      try { g.href = YSD.cal.google(c); o.href = YSD.cal.outlook(c); } catch (x) {}
    }
    var s0 = sheet.querySelector('[data-rsvp-sms]'); if (s0) s0.href = smsHref(id);
    var jl = sheet.querySelector('[data-rsvp-join-more]');
    if (jl) jl.href = (YSD.events && YSD.events.rootPrefix ? YSD.events.rootPrefix() : '') + (lang() === 'es' ? 'es/' : '') + 'join.html?e=' + encodeURIComponent(id) + '#join-form';
  }
  function placeLine(e) {
    var c = YSD.events && YSD.events.city ? YSD.events.city(e) : tx((data().cities || {})[e.city]);
    var p = YSD.events && YSD.events.place ? YSD.events.place(e) : '';
    return [eventWhen(e), c].filter(Boolean).join(' · ') + (p && p !== c ? ' · ' + p : '');
  }
  function paintTicket(e, r) {
    var tk = sheet.querySelector('[data-rsvp-ticket]');
    var name = cleanName(r.firstName) || lbl('you');
    sheet.querySelector('[data-rsvp-ticket-name]').textContent = '';
    var nm = sheet.querySelector('[data-rsvp-ticket-name]');
    nm.appendChild(el('span', 'rsvp-ticket__first', name));
    var plus = Math.max(0, Math.min(2, +r.plusOne || 0));
    if (plus && r.status === 'in') nm.appendChild(el('span', 'rsvp-ticket__plus', lbl('plus', { n: plus })));
    sheet.querySelector('[data-rsvp-ticket-event]').textContent = tx(e.title);
    sheet.querySelector('[data-rsvp-ticket-when]').textContent = placeLine(e);
    var stub = sheet.querySelector('[data-rsvp-ticket-stub]'); stub.textContent = '';
    if (YSD.events && YSD.events.ticket) stub.appendChild(YSD.events.ticket(e));
    sheet.querySelector('[data-rsvp-stamp]').textContent = r.status === 'waitlist' ? lbl('onWaitlist') : lbl('stamp');
    sheet.querySelector('[data-rsvp-ticket-tag]').hidden = !e.demo;
    tk.setAttribute('data-status', r.status);
    var gp = sheet.querySelector('[data-rsvp-done-going]'); gp.textContent = '';
    if (r.status === 'in' && YSD.events && YSD.events.facepile) {
      gp.appendChild(YSD.events.facepile(e, { size: 'sm' }));
      var cnt = el('span', 'rsvp-done__count', lbl('going', { n: count(e.id) }));
      gp.appendChild(cnt);
      if (r.showName && !r.under18) gp.appendChild(el('span', 'rsvp-done__you', lbl('joinFace')));
      gp.hidden = false;
    } else gp.hidden = true;
  }
  function showDone(id, fresh) {
    var e = ev(id), r = state(id); if (!e || !r) return;
    sheet.setAttribute('data-mode', 'done');
    sheet.toggleAttribute('data-fresh', !!fresh);
    headFor(e, r.status === 'waitlist' ? 'done-waitlist' : 'done-in', r);
    var note = sheet.querySelector('[data-rsvp-sheet-note]'); note.hidden = true;
    paintTicket(e, r);
    var done = sheet.querySelector('[data-rsvp-done]');
    var line = done.querySelector('.rsvp-done__line');
    line.textContent = r.status === 'waitlist' ? lbl('waitlistDone') : (t('success.rsvp.body') || '');
    done.querySelector('[data-rsvp-done-note]').textContent = e.demo ? (t('success.rsvp.demo') || '') : '';
    var swi = done.querySelector('[data-rsvp-share-name]'), teen = done.querySelector('[data-rsvp-teen]');
    swi.checked = !r.under18 && r.shareName !== false;
    swi.disabled = !!r.under18;
    swi.closest('label').hidden = !!r.under18;
    teen.hidden = !r.under18;
    // join block: only when nobody has joined on this device
    var jg = done.querySelector('[data-rsvp-join]');
    var m = member();
    jg.hidden = !!m || r.status !== 'in';
    if (!jg.hidden) {
      var hasAge = ages[id] != null;
      done.querySelector('[data-rsvp-join-btn]').hidden = !hasAge;
      done.querySelector('[data-rsvp-join-more]').className = hasAge ? 'btn btn--ghost' : 'btn btn--primary';
      done.querySelector('[data-rsvp-join-done]').hidden = true;
    }
    panes('done');
    syncDoneLinks();
    // the I'm-going card (in only)
    var cg = done.querySelector('[data-rsvp-card]');
    if (r.status === 'in') prepareCard(id); else cg.hidden = true;
  }

  /* ---- the I'm-going story card (genz-brand-09): cards-brand.js loads on demand, the card renders before any tap */
  function loadBrandCards() {
    if (YSD.cards && YSD.cards.has && YSD.cards.has('going')) return Promise.resolve(true);
    if (cardLoading) return cardLoading;
    cardLoading = new Promise(function (res) {
      if (!YSD.cards || typeof YSD.cards.render !== 'function') { res(false); return; }
      var sc = d.createElement('script');
      sc.src = (YSD.root || (YSD.events && YSD.events.rootPrefix ? YSD.events.rootPrefix() : '')) + 'assets/js/cards-brand.js';
      sc.onload = function () { res(!!(YSD.cards.has && YSD.cards.has('going'))); };
      sc.onerror = function () { res(false); };
      d.head.appendChild(sc);
    });
    return cardLoading;
  }
  function cardData(e, r) {
    var adult = !r.under18 && !(knownAge() != null && knownAge() < 18);
    var tok = (e.cover && e.cover.token) || '--violet';
    var c = YSD.events && YSD.events.city ? YSD.events.city(e) : '';
    var p = YSD.events && YSD.events.place ? YSD.events.place(e) : '';
    return { first: adult && r.shareName !== false ? cleanName(r.firstName) : '', eventTitle: tx(e.title), when: eventWhen(e),
      place: p && p !== c ? c + ' · ' + p : c, link: shareUrl(e.id), colorToken: tok, lang: lang(), demo: e.demo !== false, sticker: e.cover && e.cover.sticker };
  }
  function prepareCard(id, again) {
    var e = ev(id), r = state(id), box = sheet && sheet.querySelector('[data-rsvp-card]');
    if (!e || !r || !box) return;
    if (!again && cardFor === id && cardCanvas) { box.hidden = false; return; }
    var btn = box.querySelector('[data-rsvp-card-share]'), prev = box.querySelector('[data-rsvp-card-preview]');
    btn.disabled = true;
    loadBrandCards().then(function (ok) {
      if (!ok || current !== id) { if (!ok) box.hidden = true; return null; }
      box.hidden = false;
      return YSD.brandCards.render('going', cardData(e, state(id) || r), { size: 'story' });
    }).then(function (canvas) {
      if (!canvas || current !== id) return;
      cardFor = id; cardCanvas = canvas;
      prev.textContent = '';
      var img = d.createElement('img');
      try { img.src = canvas.toDataURL('image/jpeg', 0.7); } catch (x) { img = canvas; }
      img.alt = '';
      prev.appendChild(img);
      btn.disabled = false;
    }, function () { box.hidden = true; });
  }
  function shareCard(id, btn) {
    var e = ev(id); if (!e || !cardCanvas || cardFor !== id || !YSD.cards || !YSD.cards.share) return;
    var r = state(id) || {};
    var res = YSD.cards.share(cardCanvas, { title: tx(e.share && e.share.title) || tx(e.title), text: shareText(id, false), url: shareUrl(id),
      filename: (lbl('goingFile') || 'im-going') + '-' + e.id + '.png' });
    if (btn) { btn.setAttribute('data-state', 'pressed'); setTimeout(function () { btn.removeAttribute('data-state'); }, 160); }
    Promise.resolve(res).then(function (out) {
      if (out === 'downloaded' && YSD.ui) YSD.ui.toast(t('toast.cardSaved') || t('success.card.body') || '', { tone: 'success', priority: 'high' });
      else if (out === 'failed' && YSD.ui) YSD.ui.toast(t('toast.shareFailed'), { tone: 'error', priority: 'high' });
      if (out === 'shared' || out === 'downloaded') { try { if (YSD.stickers && YSD.stickers.act) YSD.stickers.act('share-card', { ref: e.id }); } catch (x) {} }
      track('going_card', { event: e.id, result: out, teen: !!r.under18 });
    });
  }

  /* ---- join from the RSVP (journeys-09) */
  function joinFromRsvp(id) {
    var e = ev(id), r = state(id), age = ages[id];
    if (!e || !r || age == null || !YSD.members || member()) return;
    var profile = { firstName: r.firstName, age: age, lang: lang(), joinSource: 'rsvp', joinEvent: e.id, contactType: r.contactType };
    if (r.contactType === 'phone') profile.phone = r.contact; else profile.email = r.contact;
    var v = YSD.members.validate(profile);
    if (!v.ok) { var jl = sheet.querySelector('[data-rsvp-join-more]'); if (jl) jl.focus(); return; }
    var m;
    try { m = YSD.members.join(profile); } catch (x) { if (YSD.ui) YSD.ui.toast(t('error.submit.failed'), { tone: 'error', priority: 'high' }); return; }
    if (!m) return;
    var box = sheet.querySelector('[data-rsvp-join]');
    box.querySelector('[data-rsvp-join-btn]').hidden = true;
    box.querySelector('[data-rsvp-join-more]').hidden = true;
    var jc = box.querySelector('.rsvp-join__consent'); if (jc) jc.hidden = true;
    var jd = box.querySelector('[data-rsvp-join-done]'); jd.hidden = false;
    syncDoneLinks();
    refresh();               // the page's own +1 and text links get the new code too
    prepareCard(id, true);   // the card's printed link now carries the new code
    setTimeout(function () { try { jd.focus(); } catch (x) {} }, 0);
    if (YSD.ui) YSD.ui.toast(lbl('joinDone'), { tone: 'success', priority: 'high' });
    track('rsvp_join', { event: e.id });
  }

  function contactError(raw) {
    var v = String(raw || '').trim();
    if (!v) return { code: 'required', msg: t('error.email.required') };
    if (v.indexOf('@') >= 0) return { code: 'invalid', msg: t('error.email.invalid') };
    var digits = v.replace(/\D/g, '');
    if (/[a-z]/i.test(v) && digits.length < 7) return { code: 'missingAt', msg: t('error.email.missingAt') };
    if (digits.length) return { code: 'invalid', msg: t('error.phone.invalid') };
    return { code: 'invalid', msg: lbl('contactInvalid') };
  }
  function onSubmit(evt) {
    evt.preventDefault();
    var form = evt.currentTarget, id = current, e = ev(id);
    if (!e) return;
    var status = form.getAttribute('data-status') === 'waitlist' ? 'waitlist' : 'in';
    var first = String(form.elements.firstName.value || '').trim();
    var contact = String(form.elements.contact.value || '').trim();
    var isEmail = contact.indexOf('@') >= 0;
    var asking = form.getAttribute('data-age') !== 'skip';
    var age = asking ? parseAge(form.elements.age.value) : NaN;
    var v = YSD.members && YSD.members.validate ? YSD.members.validate(isEmail ? { firstName: first, email: contact } : { firstName: first, phone: contact }) : { ok: !!(first && contact), errors: {} };
    var errs = {}, msgs = {};
    if (!first) { errs.firstName = 'required'; msgs.firstName = t('error.firstName.required'); }
    var badContact = !contact || (isEmail ? !!v.errors.email : !!(v.errors.phone || !(v.clean && v.clean.phone)));
    if (badContact) { var ce = contactError(contact); errs.contact = ce.code; msgs.contact = ce.msg || lbl('contactInvalid'); }
    if (asking && isNaN(age)) { errs.age = 'invalid'; msgs.age = t('error.age.invalid') || t('error.required'); }
    if (Object.keys(errs).length) {
      if (YSD.ui && YSD.ui.form) YSD.ui.form.errors(form, errs, { messages: msgs });
      return;
    }
    if (YSD.ui && YSD.ui.form) YSD.ui.form.clear(form);
    // Under the minimum age: say so kindly, keep nothing, send nothing (MINORS_POLICY; journeys-02).
    if (asking && age < minAge()) { showYoung(id); return; }
    if (form.elements._hp.value) { showFakeDone(id, first); return; } // a bot: pretend, store nothing
    var under18 = asking ? age < 18 : form.getAttribute('data-under18') === 'true';
    if (asking) ages[id] = age;
    var cleanContact = isEmail ? ((v.clean && v.clean.email) || contact) : ((v.clean && v.clean.phone) || contact);
    var rec = set(id, status, {
      firstName: (v.clean && v.clean.firstName) || first,
      contact: cleanContact,
      contactType: isEmail ? 'email' : 'phone',
      plusOne: Math.max(0, Math.min(2, parseInt(form.elements.plusOne.value, 10) || 0)),
      access: String(form.elements.access.value || '').trim().slice(0, 500),
      showName: !under18 && !!form.elements.showName.checked,
      under18: under18,
      ageChecked: true,
      shareName: under18 ? false : (state(id) && state(id).shareName === false ? false : true)
    });
    sset(LAST, { firstName: rec.firstName, contact: rec.contact, contactType: rec.contactType, eventId: id, ts: Date.now() });
    var payload = {}; for (var k in rec) payload[k] = rec[k];
    payload.eventTitle = tx(e.title); payload.page = String(w.location.pathname || '');
    submit(payload).then(function (res) { emit('rsvp-submitted', { eventId: id, status: status, mode: res.mode }); track('rsvp_submitted', { mode: res.mode }); });
    cardFor = null; cardCanvas = null;
    showDone(id, true);
    var title = sheet.querySelector('#rsvp-sheet-title');
    setTimeout(function () { try { title.focus(); } catch (x) {} }, 0);
    if (status === 'in') {
      if (YSD.ui) YSD.ui.toast([t('success.rsvp.title'), t('success.rsvp.body')].filter(Boolean).join(' '), { tone: 'success' });
      if (e.tone !== 'calm' && YSD.ui && YSD.ui.confetti) setTimeout(function () { YSD.ui.confetti(sheet.querySelector('[data-rsvp-stamp]') || sheet); }, 180);
    } else if (YSD.ui) YSD.ui.toast(lbl('waitlistDone'), { tone: 'success' });
  }
  /** Honeypot: look done, keep nothing (no record, no rsvp:last, no count). */
  function showFakeDone(id, first) {
    var e = ev(id); if (!e) return;
    sheet.setAttribute('data-mode', 'done');
    headFor(e, 'done-in', { firstName: first });
    paintTicket(e, { firstName: first, status: 'in', plusOne: 0 });
    sheet.querySelector('[data-rsvp-join]').hidden = true;
    sheet.querySelector('[data-rsvp-card]').hidden = true;
    panes('done');
  }

  function open(id, opts) {
    opts = opts || {};
    var e = ev(id);
    if (!e) return null;
    build();
    if (current !== id) { cardFor = null; cardCanvas = null; }
    current = id;
    var tok = (e.cover && e.cover.token) || '--violet';
    sheet.style.setProperty('--duo', 'var(' + tok + ')');
    sheet.setAttribute('data-duo', tok.replace(/^--/, ''));
    if (e.tone === 'calm') sheet.setAttribute('data-tone', 'calm'); else sheet.removeAttribute('data-tone');
    var r = state(id);
    if (r && (r.status === 'in' || r.status === 'waitlist') && !opts.edit) showDone(id);
    else showForm(id, opts.status || (isFull(e) ? 'waitlist' : 'in'));
    if (YSD.ui && YSD.ui.sheet) YSD.ui.sheet.open(sheet, { opener: opts.opener });
    else if (sheet.showModal) sheet.showModal();
    if (r && (r.status === 'in' || r.status === 'waitlist') && !opts.edit) { var tt = sheet.querySelector('#rsvp-sheet-title'); setTimeout(function () { try { tt.focus(); } catch (x) {} }, 0); }
    else setTimeout(function () { try { sheet.querySelector('[data-rsvp-form]').elements.firstName.focus(); } catch (x) {} }, 0);
    return sheet;
  }

  /* ------------------------------------------------------------------ page controls */
  /** Syncs one [data-rsvp] control with the stored state (eventcard.js calls it on fresh cards). */
  function decorate(c) {
    var eid = c.getAttribute('data-rsvp'), e = ev(eid), r = state(eid), s = c.getAttribute('data-rsvp-status') || 'in';
    if (!e) return;
    if (c.tagName === 'A') c.setAttribute('role', 'button');
    if (c.hasAttribute('hidden') && s !== 'in') c.hidden = false;
    var pressed = !!(r && (r.status === s || (s === 'in' && r.status === 'waitlist')));
    c.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    if (s === 'in' && !c.hasAttribute('data-rsvp-keep')) {
      var txt = r && r.status === 'in' ? lbl('youreIn') : r && r.status === 'waitlist' ? lbl('onWaitlist') : isFull(e) ? lbl('waitlist') : (t('cta.imIn') || "I'm in");
      if (c.textContent !== txt) c.textContent = txt;
    }
  }
  function refresh(id) {
    $$(id ? '[data-rsvp="' + id + '"]' : '[data-rsvp]').forEach(decorate);
    $$(id ? '[data-rsvp-going="' + id + '"]' : '[data-rsvp-going]').forEach(function (row) {
      var e = ev(row.getAttribute('data-rsvp-going'));
      if (e && YSD.events && YSD.events.fillGoing) YSD.events.fillGoing(row, e, { size: row.getAttribute('data-size') || 'sm' });
    });
    $$(id ? '[data-rsvp-count="' + id + '"]' : '[data-rsvp-count]').forEach(function (n) {
      if (n.closest('[data-rsvp-going]')) return;
      n.textContent = lbl('going', { n: count(n.getAttribute('data-rsvp-count')) });
    });
    $$(id ? '[data-rsvp-seats="' + id + '"]' : '[data-rsvp-seats]').forEach(function (n) {
      var e = ev(n.getAttribute('data-rsvp-seats'));
      if (e && YSD.events && YSD.events.fillSeats) YSD.events.fillSeats(n, e);
    });
    $$(id ? '[data-rsvp-state="' + id + '"]' : '[data-rsvp-state]').forEach(function (n) {
      var r = state(n.getAttribute('data-rsvp-state'));
      n.setAttribute('data-state', r ? r.status : 'none');
    });
    $$(id ? '[data-rsvp-cal-google="' + id + '"], [data-rsvp-cal-outlook="' + id + '"], [data-rsvp-sms="' + id + '"]' : '[data-rsvp-cal-google], [data-rsvp-cal-outlook], [data-rsvp-sms]').forEach(function (a) {
      if (sheet && sheet.contains(a)) return;
      var eid = a.getAttribute('data-rsvp-cal-google') || a.getAttribute('data-rsvp-cal-outlook') || a.getAttribute('data-rsvp-sms');
      var e = ev(eid); if (!e) return;
      try {
        if (a.hasAttribute('data-rsvp-sms')) a.href = smsHref(eid);
        else if (YSD.cal) { var c = calEvent(e); a.href = a.hasAttribute('data-rsvp-cal-google') ? YSD.cal.google(c) : YSD.cal.outlook(c); }
      } catch (x) {}
    });
  }

  d.addEventListener('click', function (evt) {
    var t0 = evt.target && evt.target.closest ? evt.target : null;
    if (!t0) return;
    var c = t0.closest('[data-rsvp]');
    if (c) {
      var id = c.getAttribute('data-rsvp'), e = ev(id);
      if (!e) return; // unknown event: let the link work
      evt.preventDefault();
      var s = c.getAttribute('data-rsvp-status') || 'in';
      if (s === 'in') { open(id, { opener: c }); return; }
      var r = state(id);
      if (r && r.status === s) { set(id, null); if (YSD.ui) YSD.ui.toast(lbl('cleared')); return; }
      set(id, s);
      if (YSD.ui) YSD.ui.toast(s === 'maybe' ? lbl('maybeSaved') : lbl('cantSaved'));
      c.setAttribute('data-state', 'pressed'); setTimeout(function () { c.removeAttribute('data-state'); }, 160);
      return;
    }
    var calBtn = t0.closest('[data-rsvp-cal]');
    if (calBtn) {
      var cid = calBtn.getAttribute('data-rsvp-cal') || current, ce = ev(cid);
      if (ce && YSD.cal) { evt.preventDefault(); if (YSD.cal.download(calEvent(ce)) && YSD.ui) YSD.ui.toast(t('toast.calendarReady')); track('reminder_add', { id: ce.id }); }
      return;
    }
    var shBtn = t0.closest('[data-rsvp-share]');
    if (shBtn) { evt.preventDefault(); doShare(shBtn.getAttribute('data-rsvp-share') || current, shBtn); }
  });
  d.addEventListener('keydown', function (evt) {
    if (evt.key !== ' ' && evt.key !== 'Spacebar') return;
    var c = evt.target && evt.target.closest ? evt.target.closest('a[data-rsvp][role="button"]') : null;
    if (c) { evt.preventDefault(); c.click(); }
  });
  w.addEventListener('online', retry);
  w.addEventListener('storage', function (evt) { if (evt.key && evt.key.indexOf('ysd:' + KEY) === 0) refresh(evt.key.slice(4 + KEY.length)); });

  /* ------------------------------------------------------------------ invite landing (BRIEF 5.1) */
  function params() {
    var out = {}, s = '';
    try { s = String(w.location.search || '').replace(/^\?/, ''); } catch (e) { s = ''; }
    s.split('&').forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf('='), k = i < 0 ? kv : kv.slice(0, i), v = i < 0 ? '' : kv.slice(i + 1);
      try { k = decodeURIComponent(k.replace(/\+/g, ' ')); v = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (x) { return; }
      if (!(k in out)) out[k] = v;
    });
    return out;
  }
  function landing(root) {
    var box = (root || d).querySelector('[data-invite-landing]');
    if (!box) return null;
    var p = params();
    var ref = /^[A-Za-z0-9_-]{2,32}$/.test(p.ref || '') ? String(p.ref).toUpperCase() : '';
    var from = cleanName(p.from);
    if (!ref && !from) return null;
    if (sget('invite:seen:' + (ref || 'from-' + from.toLowerCase()), null)) return null;
    landingFrom = from;
    var pageEvent = d.documentElement.getAttribute('data-event') || '';
    var e = ev(p.e || '') || ev(pageEvent);
    var past = e && YSD.events && YSD.events.isPast ? YSD.events.isPast(e) : false;
    // On the invited event's own page the page already shows the title, date and I'm in: one slim line (journeys-15).
    var compact = !!(e && pageEvent && e.id === pageEvent && !past);
    box.textContent = '';
    box.className = 'invite-landing' + (compact ? ' invite-landing--compact' : '');
    if (compact) return landingCompact(box, e, ref, from);
    if (e && !past) box.style.setProperty('--duo', 'var(' + ((e.cover && e.cover.token) || '--celery') + ')');
    var inner = el('div', 'wrap invite-landing__inner');
    var av = el('span', 'avatar avatar--lg invite-landing__avatar', from ? from.charAt(0).toUpperCase() : '');
    av.setAttribute('aria-hidden', 'true');
    if (!from) { av.setAttribute('data-sticker', 'heart'); av.className = 'sticker sticker--sm invite-landing__avatar'; }
    inner.appendChild(av);
    var copy = el('div', 'invite-landing__copy');
    copy.appendChild(el('p', 'invite-landing__who', from ? lbl('invitedBy', { name: from }) : lbl('invitedAnon')));
    var cityName = e && YSD.events && YSD.events.city ? YSD.events.city(e) : '';
    var what = e && !past ? lbl('invitedTo', { event: tx(e.title), when: eventWhen(e) }) + (cityName ? ' · ' + cityName : '') : e && past ? lbl('invitedPast') : lbl('invitedToUs');
    var whatP = el('p', 'invite-landing__what', what);
    if (e && !past && e.demo !== false && !e.real) {
      // Demo events always carry DEMO (BRIEF 0.2; review journeys-03).
      whatP.appendChild(document.createTextNode(' '));
      whatP.appendChild(el('span', 'tag tag--demo', lbl('demoEvent')));
    }
    copy.appendChild(whatP);
    if (e && !past) copy.appendChild(el('p', 'invite-landing__sub', lbl('invitedSub')));
    inner.appendChild(copy);
    var acts = el('div', 'invite-landing__actions');
    var prefix = YSD.events && YSD.events.rootPrefix ? YSD.events.rootPrefix() : '';
    var es = lang() === 'es' ? 'es/' : '';
    var btn;
    if (e && !past) {
      btn = el('a', 'btn btn--primary btn--lg', t('cta.imIn') || "I'm in");
      btn.href = prefix + es + 'join.html?e=' + encodeURIComponent(e.id);
      btn.setAttribute('data-rsvp', e.id);
    } else if (e && past) {
      btn = el('a', 'btn btn--primary btn--lg', t('cta.seeWhatsOn') || "See what's on");
      btn.href = prefix + es + 'events.html';
    } else {
      btn = el('a', 'btn btn--primary btn--lg', t('cta.join') || 'Join free');
      btn.href = prefix + es + 'join.html';
    }
    acts.appendChild(btn);
    var x = el('button', 'invite-landing__close'); x.type = 'button';
    x.setAttribute('aria-label', lbl('dismiss') || t('a11y.close') || 'Close'); x.appendChild(svgClose());
    x.addEventListener('click', function () {
      sset('invite:seen:' + (ref || 'from-' + from.toLowerCase()), Date.now());
      box.hidden = true;
      var h = d.querySelector('main h1'); if (h) { if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1'); h.focus(); }
    });
    inner.appendChild(acts);
    inner.appendChild(x);
    box.appendChild(inner);
    if (YSD.ui && YSD.ui.stickers) YSD.ui.stickers(box);
    box.hidden = false;
    refresh(e ? e.id : null);
    track('invite_landing', { event: e ? e.id : null, referred: !!ref });
    emit('invite-landing', { eventId: e ? e.id : null, ref: ref || null, from: from || null });
    return box;
  }

  /** The slim invite line for the event's own page: avatar, "Kira invited you", one short reassurance, dismiss. */
  function landingCompact(box, e, ref, from) {
    box.style.setProperty('--duo', 'var(' + ((e.cover && e.cover.token) || '--celery') + ')');
    var inner = el('div', 'wrap invite-landing__inner');
    var av = el('span', 'avatar invite-landing__avatar', from ? from.charAt(0).toUpperCase() : '');
    av.setAttribute('aria-hidden', 'true');
    if (!from) { av.setAttribute('data-sticker', 'heart'); av.className = 'sticker sticker--sm invite-landing__avatar'; }
    inner.appendChild(av);
    var copy = el('p', 'invite-landing__line');
    copy.appendChild(el('span', 'invite-landing__who', from ? lbl('invitedBy', { name: from }) : lbl('invitedAnon')));
    copy.appendChild(d.createTextNode(' '));
    copy.appendChild(el('span', 'invite-landing__sub', lbl('invitedLineSub')));
    inner.appendChild(copy);
    var x = el('button', 'invite-landing__close'); x.type = 'button';
    x.setAttribute('aria-label', lbl('dismiss') || t('a11y.close') || 'Close'); x.appendChild(svgClose());
    x.addEventListener('click', function () {
      sset('invite:seen:' + (ref || 'from-' + from.toLowerCase()), Date.now());
      box.hidden = true;
      var h = d.querySelector('main h1'); if (h) { if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1'); h.focus(); }
    });
    inner.appendChild(x);
    box.appendChild(inner);
    if (YSD.ui && YSD.ui.stickers) YSD.ui.stickers(box);
    box.hidden = false;
    refresh(e.id);
    track('invite_landing', { event: e.id, referred: !!ref, compact: true });
    emit('invite-landing', { eventId: e.id, ref: ref || null, from: from || null });
    return box;
  }

  YSD.rsvp = { open: open, state: state, set: set, count: count, on: on, submit: submit, refresh: refresh, decorate: decorate, shareUrl: shareUrl, shareText: shareText, share: doShare, retry: retry,
    last: function () { return sget(LAST, null); } };
  YSD.invite = YSD.invite || {};
  YSD.invite.landing = landing;

  function init() { refresh(); landing(); retry(); }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', init); else init();
})(window, document);
