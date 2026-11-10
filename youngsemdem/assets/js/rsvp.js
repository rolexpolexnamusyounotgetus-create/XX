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
 *   YSD.rsvp.shareUrl(eventId) / .shareText(eventId)   the +1 link (your ref, ?e=, ?from= for adults who allow it)
 *   YSD.invite.landing(root?)                    shows [data-invite-landing] when the URL has ?ref or ?from
 *                                                (runs on load; returns the banner element or null)
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
 *                      contactType: 'email'|'phone', plusOne, access, showName, under18, shareName,
 *                      ref, from, lang, ts, synced: false, demo: true }
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
  var KEY = 'rsvp:', QUEUE = 'rsvp:queue';
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
  var FALLBACK = { youreIn: "You're in", waitlist: 'Join the waitlist', going: '{n} going (DEMO)', rsvp: 'Save my seat', notNow: 'Not now', done: 'Done' };
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
    var r = state(id), from = null;
    if (r && r.firstName && !r.under18 && r.shareName !== false) from = cleanName(r.firstName) || null;
    var m = YSD.members && YSD.members.current ? YSD.members.current() : null;
    if (m && m.age != null && +m.age < 18) from = null;
    try { return YSD.share.url(sharePath(e), { e: e.id, from: from }); } catch (x) { return ''; }
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
  function build() {
    if (sheet) return sheet;
    var F = (data().rsvpForm || {});
    var fieldLabel = function (name) { var fs = F.fields || []; for (var i = 0; i < fs.length; i++) if (fs[i].name === name) return tx(fs[i].label); return ''; };
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
    row.appendChild(field('firstName', t('form.firstName.label') || fieldLabel('firstName'), { required: true, autocomplete: 'given-name' }));
    row.appendChild(field('contact', t('form.contact.label') || 'Email or mobile', { required: true, autocomplete: 'email', inputmode: 'email', hint: t('form.rsvp.contact.hint') }));
    body.appendChild(row);
    body.appendChild(field('plusOne', t('form.rsvp.plusOne.label') || 'Bringing someone?', { kind: 'select', optional: true,
      options: [['0', t('form.rsvp.plusOne.none') || 'Just me'], ['1', t('form.rsvp.plusOne.plus1') || 'Me +1'], ['2', t('form.rsvp.plusOne.plus2') || 'Me +2']] }));
    body.appendChild(field('access', t('form.access.label') || 'Anything that would make this easier?', { kind: 'textarea', optional: true, hint: t('form.access.hint') }));
    body.appendChild(field('under18', fieldLabel('under18') || "I'm under 18", { type: 'checkbox', check: true }));
    var guard = el('p', 'notice notice--info rsvp-sheet__guardian', tx(data().policy && data().policy.guardian)); guard.setAttribute('data-rsvp-guardian', ''); guard.hidden = true;
    body.appendChild(guard);
    body.appendChild(field('showName', t('form.rsvp.showName.label') || "Show my first name on the who's going list", { type: 'checkbox', check: true, hint: t('form.rsvp.showName.hint') }));
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

    // ---- the success state
    var done = el('div', 'rsvp-done'); done.setAttribute('data-rsvp-done', ''); done.hidden = true;
    var db = el('div', 'sheet__body');
    var hero = el('div', 'rsvp-done__hero');
    hero.appendChild(el('span', 'rsvp-done__ticket'));
    var dt = el('div', 'stack stack--sm');
    dt.appendChild(el('p', 'rsvp-done__line', t('success.rsvp.body')));
    var dn = el('p', 'small muted'); dn.setAttribute('data-rsvp-done-note', ''); dt.appendChild(dn);
    hero.appendChild(dt);
    db.appendChild(hero);
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
    var sh = el('button', 'btn btn--primary', lbl('plusOneFriend')); sh.type = 'button'; sh.setAttribute('data-rsvp-share', '');
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
    done.appendChild(db);
    var df = el('div', 'sheet__foot');
    var ok = el('button', 'btn btn--ink', lbl('done')); ok.type = 'button'; ok.setAttribute('data-sheet-close', '');
    var ch = el('button', 'btn btn--quiet', lbl('changeRsvp')); ch.type = 'button'; ch.setAttribute('data-rsvp-change', '');
    var ca = el('button', 'btn btn--quiet', lbl('cantAnymore')); ca.type = 'button'; ca.setAttribute('data-rsvp-cancel', '');
    df.appendChild(ok); df.appendChild(ch); df.appendChild(ca);
    done.appendChild(df);
    dlg.appendChild(done);

    (d.querySelector('main') || d.body).appendChild(dlg);
    sheet = dlg;

    // ---- behaviour
    var u18 = form.elements.under18, show = form.elements.showName;
    u18.addEventListener('change', function () { syncTeen(); });
    form.addEventListener('submit', onSubmit);
    ch.addEventListener('click', function () { var r0 = state(current); showForm(current, r0 && r0.status === 'waitlist' ? 'waitlist' : 'in'); });
    ca.addEventListener('click', function () { var id = current; set(id, 'cant'); YSD.ui && YSD.ui.toast(lbl('cantSaved')); if (YSD.ui) YSD.ui.sheet.close(dlg); });
    swi.addEventListener('change', function () { var r = state(current); if (r) { r.shareName = swi.checked; sset(KEY + r.eventId, r); } syncDoneLinks(); });
    return dlg;

    function syncTeen() {
      var teenOn = u18.checked;
      if (teenOn) show.checked = false;
      show.disabled = teenOn;
      var e = ev(current);
      guard.hidden = !(teenOn && e && e.ages && e.ages.guardian);
    }
  }
  function syncTeenNow() { if (!sheet) return; var f = sheet.querySelector('[data-rsvp-form]'); f.elements.under18.dispatchEvent(new Event('change')); }

  function prefill(form, id) {
    var r = state(id), last = null, m = YSD.members && YSD.members.current ? YSD.members.current() : null;
    if (!r) {
      // your details from a past RSVP on this device (yours, never made up), else your member record
      var keys = [];
      try { keys = YSD.store && YSD.store.keys ? YSD.store.keys() : []; } catch (e) { keys = []; }
      keys.forEach(function (k) { var s = String(k).replace(/^ysd:/, ''); if (s.indexOf(KEY) === 0 && s !== QUEUE) { var x = sget(s, null); if (x && x.firstName && (!last || x.ts > last.ts)) last = x; } });
    }
    var src = r || last || {};
    form.elements.firstName.value = src.firstName || (m && m.firstName) || '';
    form.elements.contact.value = src.contact || (m && (m.email || m.phone)) || '';
    form.elements.plusOne.value = String(r && r.plusOne ? r.plusOne : 0);
    form.elements.access.value = (r && r.access) || '';
    var minor = (src.under18 === true) || !!(m && m.age != null && +m.age < 18);
    form.elements.under18.checked = minor;
    form.elements.showName.checked = !!(r && r.showName && !minor);
    form.elements._hp.value = '';
  }

  function headFor(e, mode) {
    var title = sheet.querySelector('#rsvp-sheet-title'), sub = sheet.querySelector('[data-rsvp-sheet-sub]'), tagEl = sheet.querySelector('[data-rsvp-sheet-tag]');
    tagEl.hidden = !e.demo;
    sub.textContent = tx(e.title) + ' · ' + eventWhen(e);
    if (mode === 'done-in') title.textContent = t('success.rsvp.title') || 'Seat saved.';
    else if (mode === 'done-waitlist') title.textContent = lbl('onWaitlist');
    else if (mode === 'waitlist') title.textContent = lbl('waitlistTitle');
    else title.textContent = lbl('rsvp');
  }
  function showForm(id, status) {
    var e = ev(id); if (!e) return;
    var form = sheet.querySelector('[data-rsvp-form]'), done = sheet.querySelector('[data-rsvp-done]');
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
    form.hidden = false; done.hidden = true;
    syncTeenNow();
    setTimeout(function () { try { form.elements.firstName.focus(); } catch (x) {} }, 0);
  }
  function syncDoneLinks() {
    var id = current, e = ev(id); if (!e || !sheet) return;
    var c = calEvent(e);
    if (c && YSD.cal) {
      var g = sheet.querySelector('[data-rsvp-cal-google]'), o = sheet.querySelector('[data-rsvp-cal-outlook]');
      try { g.href = YSD.cal.google(c); o.href = YSD.cal.outlook(c); } catch (x) {}
    }
    var s = sheet.querySelector('[data-rsvp-sms]'); if (s) s.href = smsHref(id);
  }
  function showDone(id) {
    var e = ev(id), r = state(id); if (!e || !r) return;
    var form = sheet.querySelector('[data-rsvp-form]'), done = sheet.querySelector('[data-rsvp-done]');
    sheet.setAttribute('data-mode', 'done');
    headFor(e, r.status === 'waitlist' ? 'done-waitlist' : 'done-in');
    var note = sheet.querySelector('[data-rsvp-sheet-note]'); note.hidden = true;
    var tk = done.querySelector('.rsvp-done__ticket'); tk.textContent = '';
    if (YSD.events && YSD.events.ticket) tk.appendChild(YSD.events.ticket(e));
    var line = done.querySelector('.rsvp-done__line');
    line.textContent = r.status === 'waitlist' ? lbl('waitlistDone') : (t('success.rsvp.body') || '');
    done.querySelector('[data-rsvp-done-note]').textContent = e.demo ? (t('success.rsvp.demo') || '') : '';
    var swi = done.querySelector('[data-rsvp-share-name]'), teen = done.querySelector('[data-rsvp-teen]');
    swi.checked = !r.under18 && r.shareName !== false;
    swi.disabled = !!r.under18;
    swi.closest('label').hidden = !!r.under18;
    teen.hidden = !r.under18;
    form.hidden = true; done.hidden = false;
    syncDoneLinks();
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
    var v = YSD.members && YSD.members.validate ? YSD.members.validate(isEmail ? { firstName: first, email: contact } : { firstName: first, phone: contact }) : { ok: !!(first && contact), errors: {} };
    var errs = {}, msgs = {};
    if (!first) { errs.firstName = 'required'; msgs.firstName = t('error.firstName.required'); }
    var badContact = !contact || (isEmail ? !!v.errors.email : !!(v.errors.phone || !(v.clean && v.clean.phone)));
    if (badContact) { var ce = contactError(contact); errs.contact = ce.code; msgs.contact = ce.msg || lbl('contactInvalid'); }
    if (Object.keys(errs).length) {
      if (YSD.ui && YSD.ui.form) YSD.ui.form.errors(form, errs, { messages: msgs });
      return;
    }
    if (YSD.ui && YSD.ui.form) YSD.ui.form.clear(form);
    if (form.elements._hp.value) { showDone(id); return; } // a bot: pretend, store nothing
    var under18 = !!form.elements.under18.checked;
    var rec = set(id, status, {
      firstName: (v.clean && v.clean.firstName) || first,
      contact: isEmail ? ((v.clean && v.clean.email) || contact) : ((v.clean && v.clean.phone) || contact),
      contactType: isEmail ? 'email' : 'phone',
      plusOne: Math.max(0, Math.min(2, parseInt(form.elements.plusOne.value, 10) || 0)),
      access: String(form.elements.access.value || '').trim().slice(0, 500),
      showName: !under18 && !!form.elements.showName.checked,
      under18: under18,
      shareName: under18 ? false : (state(id) && state(id).shareName === false ? false : true)
    });
    var payload = {}; for (var k in rec) payload[k] = rec[k];
    payload.eventTitle = tx(e.title); payload.page = String(w.location.pathname || '');
    submit(payload).then(function (res) { emit('rsvp-submitted', { eventId: id, status: status, mode: res.mode }); track('rsvp_submitted', { mode: res.mode }); });
    showDone(id);
    var title = sheet.querySelector('#rsvp-sheet-title');
    setTimeout(function () { try { title.focus(); } catch (x) {} }, 0);
    if (status === 'in') {
      if (YSD.ui) YSD.ui.toast([t('success.rsvp.title'), t('success.rsvp.body')].filter(Boolean).join(' '), { tone: 'success' });
      if (e.tone !== 'calm' && YSD.ui && YSD.ui.confetti) YSD.ui.confetti(sheet.querySelector('.rsvp-done__ticket') || sheet);
    } else if (YSD.ui) YSD.ui.toast(lbl('waitlistDone'), { tone: 'success' });
  }

  function open(id, opts) {
    opts = opts || {};
    var e = ev(id);
    if (!e) return null;
    build();
    current = id;
    sheet.style.setProperty('--duo', 'var(' + ((e.cover && e.cover.token) || '--violet') + ')');
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
    box.textContent = '';
    box.className = 'invite-landing';
    if (e && !past) box.style.setProperty('--duo', 'var(' + ((e.cover && e.cover.token) || '--celery') + ')');
    var inner = el('div', 'wrap invite-landing__inner');
    var av = el('span', 'avatar avatar--lg invite-landing__avatar', from ? from.charAt(0).toUpperCase() : '');
    av.setAttribute('aria-hidden', 'true');
    if (!from) { av.setAttribute('data-sticker', 'heart'); av.className = 'sticker sticker--sm invite-landing__avatar'; }
    inner.appendChild(av);
    var copy = el('div', 'invite-landing__copy');
    copy.appendChild(el('p', 'invite-landing__who', from ? lbl('invitedBy', { name: from }) : lbl('invitedAnon')));
    var what = e && !past ? lbl('invitedTo', { event: tx(e.title), when: eventWhen(e) }) : e && past ? lbl('invitedPast') : lbl('invitedToUs');
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

  YSD.rsvp = { open: open, state: state, set: set, count: count, on: on, submit: submit, refresh: refresh, decorate: decorate, shareUrl: shareUrl, shareText: shareText, share: doShare, retry: retry };
  YSD.invite = YSD.invite || {};
  YSD.invite.landing = landing;

  function init() { refresh(); landing(); retry(); }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', init); else init();
})(window, document);
