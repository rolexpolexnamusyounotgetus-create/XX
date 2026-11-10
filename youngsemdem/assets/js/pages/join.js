/*!
 * assets/js/pages/join.js (W6, round 1 G-JOIN): join.html behaviour around the shared join form (assets/js/joinform.js):
 *  - the hero: the live member pass in the ticket, the H1 that switches to "You're in, {name}." once a member exists
 *    (journeys-12), and the "who sent this" line for ?ref / ?from ("Kira invited you", kicker "Kira saved you a
 *    seat."; <body data-landing="custom"> keeps ui.js's generic banner off this page, and the line keeps
 *    [data-invite-landing] for the B20 check);
 *  - join.html?e=<eventId> (journeys-13): loads exactly what an event page loads (data/slices/events.js,
 *    data/events.js, data/pages/events.js, eventcard.js, rsvp.js, rsvp.css), shows "Save your seat" with the event
 *    and an I'm in that opens YSD.rsvp.open(eventId); after joining, the success panel offers the same seat;
 *  - "What you get": the member card (W5) or its locked preview, the county sticker pack PNG (unlocked by joining,
 *    BRIEF 6b B40), the honest squad-meter demo path (journeys-06) and the public sticker rules
 *    (YSD.membercard.rulesPanel, right-wing-rewards-hidden), shown before anyone joins;
 *  - the chip-in link (YSD.share.actblue(5); hidden for members under 18) and in-page jumps to the form.
 * Untrusted text (the ?from= name, the typed first name) only ever goes in with textContent.
 */
(function (w, d) {
  'use strict';
  var YSD = w.YSD = w.YSD || {};
  function t(k, v) { return typeof YSD.t === 'function' ? YSD.t(k, v) : ''; }
  function $(s, r) { return (r || d).querySelector(s); }
  function lang() { return YSD.lang === 'es' ? 'es' : 'en'; }
  function L(o) { return o == null ? '' : typeof o === 'string' ? o : (o[lang()] != null ? o[lang()] : (o.en || '')); }
  function member() { try { return YSD.members ? YSD.members.current() : null; } catch (e) { return null; } }
  function isMinor(m) { return !!m && typeof m.age === 'number' && m.age < 18; }
  function track(e, p) { try { if (YSD.track) YSD.track(e, p); } catch (x) {} }
  function el(tag, cls, text) { var n = d.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  // 40 and up: on the email list as a SUPPORTER, not a member (lead, Nov 9, 2026; membership is 14 to 39).
  function isSupporter(m) {
    if (!m) return false;
    var cap = +(YSD.cfg ? YSD.cfg('org.ageCap', 39) : 39) || 39;
    if (typeof m.age === 'number') return m.age > cap;
    return !!(m.warnings && m.warnings.age === 'over_age_cap');
  }
  function query() { try { return new URLSearchParams(w.location.search); } catch (e) { return { get: function () { return null; } }; } }
  function cleanName(s) {
    var v = String(s == null ? '' : s);
    try { v = v.replace(/[^\p{L}\p{M} '-]/gu, ''); } catch (e) { v = v.replace(/[^A-Za-zÀ-ɏ '-]/g, ''); }
    return v.replace(/\s+/g, ' ').trim().slice(0, 20);
  }

  var form = $('#join-form');
  var pass = $('[data-join-pass]');
  var CITY_LABEL = { sanford: 'Sanford', 'lake-mary': 'Lake Mary', oviedo: 'Oviedo', 'winter-springs': 'Winter Springs', 'altamonte-springs': 'Altamonte Springs', casselberry: 'Casselberry', longwood: 'Longwood' };
  var Q = query();
  var landingFrom = '';

  // ------------------------------------------------------------- the live pass
  function monthLabel(ts) {
    try { return new Intl.DateTimeFormat(lang() === 'es' ? 'es-US' : 'en-US', { month: 'short', year: 'numeric', timeZone: 'America/New_York' }).format(new Date(ts || Date.now())); }
    catch (e) { return ''; }
  }
  function paintName(name) {
    var n = pass && $('[data-pass-name]', pass);
    if (!n) return;
    var v = String(name || '').trim().slice(0, 24);
    n.textContent = v || t('join:pass.name');
    pass.toggleAttribute('data-filled', !!v);
    // long names step the pass type down so they wrap at a hyphen or space, not mid-letter, at 320 px
    var len = Array.from(v).length;
    if (len > 12) pass.setAttribute('data-len', 'l'); else if (len > 8) pass.setAttribute('data-len', 'm'); else pass.removeAttribute('data-len');
  }
  function paintCity(city) {
    if (!pass) return;
    var label = $('[data-pass-city]', pass);
    if (city && /^[a-z-]+$/.test(city) && city !== 'outside' && city !== 'not-sure') {
      pass.style.setProperty('--pass', 'var(--city-' + (city === 'seminole' ? 'unincorporated' : city) + ')');
      pass.toggleAttribute('data-dark', city === 'seminole');   // violet colourway: cream text
      if (label) label.textContent = CITY_LABEL[city] || t('join:pass.county');
    } else {
      pass.style.removeProperty('--pass');
      pass.removeAttribute('data-dark');
      if (label) label.textContent = t('join:pass.county');
    }
  }
  function paintSince(ts, supporter) {
    var s = pass && $('[data-pass-since]', pass);
    var m = monthLabel(ts);
    if (s && m) s.textContent = t(supporter ? 'join:pass.sinceSupporter' : 'join:pass.since', { month: m });
  }
  function paintKind(supporter) {
    var k = pass && $('[data-pass-kind]', pass);
    if (k) k.textContent = t(supporter ? 'join:pass.kindSupporter' : 'join:pass.kind');
    if (pass) pass.toggleAttribute('data-supporter', !!supporter);   // join.css keeps the SUPPORTER pill in place of the stamp
  }
  function stamp(on) {
    var s = pass && $('[data-pass-stamp]', pass);
    if (s) s.hidden = !on;
  }

  // ------------------------------------------------------------- the hero: joined state (journeys-12)
  var hero = $('.x-hero');
  var H = {
    title: $('[data-hero-title]'), kicker: $('[data-hero-kicker]'), lead: $('[data-hero-lead]'), eyebrow: $('[data-hero-eyebrow]'),
    receipts: $('[data-hero-receipts]'), secondary: $('[data-hero-secondary]'), card: $('[data-hero-card]'), invited: $('[data-invite-landing]'),
    teen: $('.x-teenlink'), rules: $('.x-rules')
  };
  /** ?intent=host|crew|role|volunteer: the kicker says what this visit came for ("Hosting starts here."). */
  function intentKicker() {
    var u = YSD.joinForm && YSD.joinForm.urlIntent ? YSD.joinForm.urlIntent() : null;
    var P = (w.YSD_DATA || {}).joinPicks;
    if (!u || !u.intent || !P) return '';
    var it = (P.intents || []).filter(function (x) { return x.id === u.intent; })[0];
    if (!it) return '';
    var crew = '';
    if (u.crew) { var c = (P.crews || []).filter(function (x) { return x.id === u.crew; })[0]; crew = c ? L(c.name) : (P.cityCrews && P.cityCrews[u.crew] ? P.cityCrews[u.crew].name : ''); }
    return crew && it.titleNamed ? L(it.titleNamed).replace('{crew}', crew) : L(it.title);
  }
  function heroState(m) {
    if (!H.title) return;
    if (m && m.firstName) {
      var sup = isSupporter(m), name = String(m.firstName).trim().slice(0, 24);
      H.title.textContent = t(sup ? 'join:hero.listedTitle' : 'join:hero.joinedTitle', { name: name });
      H.kicker.textContent = t(sup ? 'join:hero.listedKicker' : 'join:hero.joinedKicker');
      if (H.lead) H.lead.textContent = t('join:hero.joinedLead');
      if (H.receipts) H.receipts.hidden = true;
      if (H.secondary) H.secondary.hidden = true;
      if (H.card) H.card.hidden = false;
      if (H.invited) H.invited.hidden = true;
      if (H.eyebrow) H.eyebrow.hidden = false;
      if (H.teen) H.teen.hidden = !isMinor(m);
      if (H.rules) H.rules.hidden = true;   // the member card carries the full sticker book
      if (hero) hero.setAttribute('data-joined', Array.from(name).length > 9 ? 'long' : '');
    } else {
      H.title.textContent = t('join:hero.title');
      H.kicker.textContent = intentKicker() || (landingFrom ? t('join:hero.kickerFrom', { from: landingFrom }) : t('join:hero.kicker'));
      if (H.teen) H.teen.hidden = false;
      if (H.rules) H.rules.hidden = false;
      if (H.lead) H.lead.textContent = t('brand.welcome');
      if (H.receipts) H.receipts.hidden = !!eventId;
      if (H.secondary) H.secondary.hidden = false;
      if (H.card) H.card.hidden = true;
      if (hero) hero.removeAttribute('data-joined');
    }
  }

  // ------------------------------------------------------------- locked / unlocked
  var packBtn = $('[data-sticker-pack]'), packNote = $('[data-pack-note]');
  var locked = $('[data-card-locked]'), chipSec = $('[data-chip-in-section]');
  function unlock(m) {
    if (packBtn) packBtn.removeAttribute('aria-disabled');
    if (packNote) packNote.hidden = true;
    if (locked) locked.hidden = true;
    if (chipSec) chipSec.hidden = isMinor(m);   // no money asks aimed at members under 18
    var sup = isSupporter(m);
    paintName(m.firstName); paintCity(m.city); paintSince(m.joinedAt, sup); paintKind(sup);
    stamp(!sup);   // past the age cap: on the list as a supporter, no "You're in" stamp
    if (pass) pass.setAttribute('data-state', 'joined');
    heroState(m);
    squadDemo(m);
  }
  function relock() {
    if (packBtn) packBtn.setAttribute('aria-disabled', 'true');
    if (packNote) packNote.hidden = false;
    if (locked) locked.hidden = false;
    if (chipSec) chipSec.hidden = false;
    paintName(''); paintCity(''); paintSince(); paintKind(false); stamp(false);
    if (pass) pass.removeAttribute('data-state');
    heroState(null);
    squadDemo(null);
  }

  // ------------------------------------------------------------- the squad meter, honestly (journeys-06)
  function squadDemo(m) {
    var box = $('[data-squad-demo]');
    if (!box) return;
    var demo = YSD.cfg ? YSD.cfg('demo', true) !== false : true;
    if (!m || !m.firstName || !demo) { box.hidden = true; return; }
    var name = String(m.firstName).trim().slice(0, 20);
    var s1 = $('[data-squad-step="1"]', box), s2 = $('[data-squad-step="2"]', box), s3 = $('[data-squad-step="3"]', box);
    if (s1) s1.textContent = t('join:squad.s1');
    if (s2) s2.textContent = t('join:squad.s2', { name: name });
    if (s3) s3.textContent = t('join:squad.s3', { name: name });
    var a = $('[data-squad-open]', box);
    if (a && YSD.share && YSD.share.url) a.href = YSD.share.url('join.html', { utm: false });
    box.hidden = false;
  }

  // ------------------------------------------------------------- jumps to the form
  function jump(e) {
    var m = member();
    var target = m ? $('[data-join-done-title]') : $('#join-first');
    if (!target) return;
    if (e) e.preventDefault();
    var box = target.closest('.x-ticket') || target;
    try { box.scrollIntoView({ block: 'start', behavior: YSD.ui && YSD.ui.motion && YSD.ui.motion.paused() ? 'auto' : 'smooth' }); } catch (x) { box.scrollIntoView(); }
    setTimeout(function () { try { target.focus({ preventScroll: true }); } catch (x) { target.focus(); } }, 350);
  }
  d.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-join-jump], a[href="#join-form"], .site-header a[href$="join.html#join-form"]');
    if (a) jump(e);
  });

  // ------------------------------------------------------------- who sent this (?ref / ?from), in the hero
  function landing() {
    var box = H.invited;
    if (!box) return;
    var ref = String(Q.get('ref') || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32).toUpperCase();
    var from = cleanName(Q.get('from'));
    if ((!ref && !from) || member()) return;
    var mine = YSD.share && YSD.share.myCode ? YSD.share.myCode() : '';
    if (ref && mine && ref === mine) return;
    landingFrom = from;
    box.textContent = '';
    var av = el('span', from ? 'x-invited__av' : 'sticker x-invited__av', from ? from.charAt(0).toUpperCase() : null);
    av.setAttribute('aria-hidden', 'true');
    if (!from) av.setAttribute('data-sticker', 'heart');
    box.appendChild(av);
    box.appendChild(el('span', 'x-invited__text', from ? t('join:hero.invited', { from: from }) : t('join:hero.invitedAnon')));
    box.hidden = false;
    if (H.eyebrow) H.eyebrow.hidden = true;
    if (from && H.kicker && !intentKicker()) H.kicker.textContent = t('join:hero.kickerFrom', { from: from });
    if (YSD.ui && YSD.ui.stickers) YSD.ui.stickers(box);
    track('invite_landing', { event: eventId || null, referred: !!ref });
  }

  // ------------------------------------------------------------- join.html?e=<eventId> (journeys-13)
  var eventId = String(Q.get('e') || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 80);
  var eventObj = null;
  function loadScript(src) {
    return new Promise(function (res, rej) { var s = d.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; d.body.appendChild(s); });
  }
  function loadCss(href) {
    if (d.querySelector('link[href$="' + href + '"]')) return;
    var l = d.createElement('link'); l.rel = 'stylesheet'; l.href = (YSD.root || '') + href; d.head.appendChild(l);
  }
  function chain(list) {
    var root = YSD.root || '';
    return list.reduce(function (p, src) { return p.then(function () { return loadScript(root + src); }); }, Promise.resolve());
  }
  function eventBox() { return $('[data-join-event]'); }
  function eventLoading() {
    var box = eventBox();
    if (!box) return;
    box.textContent = '';
    box.setAttribute('data-state', 'loading');
    box.appendChild(el('p', 'x-event__kicker', t('join:event.kicker')));
    box.appendChild(el('p', 'x-event__lead', t('join:event.loading')));
    box.hidden = false;
    if (H.receipts) H.receipts.hidden = true;
  }
  function eventMissing(past) {
    var box = eventBox();
    if (!box) return;
    box.textContent = '';
    box.setAttribute('data-state', past ? 'past' : 'missing');
    box.appendChild(el('p', 'x-event__lead', t(past ? 'join:event.past' : 'join:event.missing')));
    var a = el('a', 'btn btn--ink btn--sm', t('join:event.all'));
    a.href = (YSD.root || '') + (lang() === 'es' ? 'es/' : '') + 'events.html';
    var row = el('p'); row.appendChild(a); box.appendChild(row);
    box.hidden = false;
    if (H.receipts) H.receipts.hidden = false;
  }
  function eventRender(e) {
    var box = eventBox(), E = YSD.events;
    if (!box || !E) return;
    box.textContent = '';
    box.removeAttribute('data-state');
    box.style.setProperty('--duo', 'var(' + ((e.cover && e.cover.token) || '--celery') + ')');
    box.appendChild(el('p', 'x-event__kicker', t('join:event.kicker')));
    var row = el('div', 'x-event__row');
    try { var tk = E.ticket(e, { lang: lang() }); if (tk) { tk.classList.add('x-event__ticket'); row.appendChild(tk); } } catch (x) {}
    var txt = el('div', 'x-event__text');
    txt.appendChild(el('p', 'x-event__title', L(e.title)));
    var where = L(e.place && e.place.name) || (E.place ? E.place(e, lang()) : '');   // the place itself, not only "DEMO venue" (journeys-25)
    var meta = el('p', 'x-event__meta', [E.when ? E.when(e, lang()) : '', where].filter(Boolean).join(' · '));
    if (e.demo !== false && !e.real) { meta.appendChild(d.createTextNode(' ')); meta.appendChild(el('span', 'tag tag--demo', E.label ? E.label('demoEvent', null, lang()) : 'DEMO')); }
    txt.appendChild(meta);
    row.appendChild(txt);
    box.appendChild(row);
    box.appendChild(el('p', 'x-event__lead', t(member() ? 'join:event.leadMember' : 'join:event.lead')));
    var acts = el('div', 'btn-row x-event__acts');
    var go = el('a', 'btn btn--primary', t('cta.imIn'));
    go.href = E.url ? E.url(e, { lang: lang() }) : '#';
    go.setAttribute('data-rsvp', e.id);
    var more = el('a', 'btn btn--quiet', t('join:event.details'));
    more.href = go.href;
    acts.appendChild(go); acts.appendChild(more);
    box.appendChild(acts);
    box.hidden = false;
    if (YSD.rsvp && YSD.rsvp.refresh) YSD.rsvp.refresh(e.id);
  }
  function eventBoot() {
    if (!eventId) return;
    eventLoading();
    // rsvp.js fills any [data-invite-landing] box with its own banner when it loads: the hero line keeps its
    // place, so it gives the attribute up first (B20 is checked on the plain page, without ?e).
    if (H.invited) H.invited.removeAttribute('data-invite-landing');
    loadCss('assets/css/rsvp.css');
    chain(['data/slices/events.js', 'data/events.js', 'data/pages/events.js', 'assets/js/eventcard.js', 'assets/js/rsvp.js']).then(function () {
      var e = YSD.events && YSD.events.get ? YSD.events.get(eventId) : null;
      if (!e) { eventMissing(false); return; }
      if (YSD.events.isPast && YSD.events.isPast(e)) { eventMissing(true); return; }
      eventObj = e;
      eventRender(e);
      offerSeat();
    }, function () { eventMissing(false); });
  }
  /** After joining (or arriving joined) with ?e: the success panel offers the seat too, until it's saved. */
  function offerSeat() {
    var e = eventObj, done = $('[data-join-done]');
    if (!e || !done || done.hidden || !YSD.rsvp) return;
    var have = $('[data-join-seat]', done);
    var r = YSD.rsvp.state ? YSD.rsvp.state(e.id) : null;
    if (r && (r.status === 'in' || r.status === 'waitlist')) { if (have) have.remove(); return; }
    if (have) return;
    var row = $('.btn-row', done);
    var b = el('button', 'btn btn--primary', t('join:event.afterJoin', { event: L(e.title) }));
    b.type = 'button'; b.setAttribute('data-join-seat', '');
    b.addEventListener('click', function () { YSD.rsvp.open(e.id, { opener: b }); });
    if (row) row.insertBefore(b, row.firstChild); else done.appendChild(b);
  }
  d.addEventListener('ysd:rsvp', function () { offerSeat(); });

  // ------------------------------------------------------------- sticker shelf + pack
  function stickerItems() { var S = (w.YSD_DATA || {}).stickers; return S && Array.isArray(S.items) ? S.items : []; }
  function shelf() {
    var box = $('[data-sticker-shelf]');
    if (!box) return;
    var rots = [-8, 6, -4, 9, -6, 5, -10, 7, -3, 8];
    stickerItems().forEach(function (s, i) {
      var b = d.createElement('button');
      b.type = 'button'; b.className = 'sticker x-pack__sticker';
      b.setAttribute('data-sticker', s.id);
      b.style.setProperty('--rot', rots[i % rots.length] + 'deg');
      b.setAttribute('aria-label', t('a11y.stickerTap', { name: (s.name && (s.name[lang()] || s.name.en)) || s.id }) || s.id);
      box.appendChild(b);
    });
    if (YSD.ui) { YSD.ui.stickers(box); YSD.ui.stickerFacts(box); }
  }
  function svgUrl(svg) { return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(String(svg).replace('<svg ', '<svg width="480" height="480" ')); }
  function loadImg(src) {
    return new Promise(function (res, rej) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = rej; i.src = src; });
  }
  function fontsReady() {
    try {
      if (!d.fonts || !d.fonts.load) return Promise.resolve();
      return Promise.all([d.fonts.load('800 72px "Bricolage Grotesque"'), d.fonts.load('700 32px "Atkinson Hyperlegible Next"')]).then(null, function () {});
    } catch (e) { return Promise.resolve(); }
  }
  function drawPack() {
    return fontsReady().then(drawPackNow);
  }
  function drawPackNow() {
    var items = stickerItems();
    var cols = 5, cell = 360, pad = 80, top = 200;
    var W = cols * cell + pad * 2, Hh = top + Math.ceil(items.length / cols) * cell + 140;
    var c = d.createElement('canvas'); c.width = W; c.height = Hh;
    var x = c.getContext('2d');
    x.fillStyle = '#FFF6EA'; x.fillRect(0, 0, W, Hh);
    x.fillStyle = '#170B33';
    x.font = '800 72px "Bricolage Grotesque", "Bricolage fb", sans-serif';
    x.textBaseline = 'alphabetic';
    x.fillText('Young Dems', pad, 112);
    x.font = '700 32px "Atkinson Hyperlegible Next", "Atkinson fb", sans-serif';
    x.fillStyle = '#574D70';
    x.fillText(t('join:pack.title'), pad, 162);
    return Promise.all(items.map(function (s) { return loadImg(svgUrl(s.svg)); })).then(function (imgs) {
      imgs.forEach(function (img, i) {
        var size = 280, r = 10;
        var cx = pad + (i % cols) * cell + (cell - size) / 2, cy = top + Math.floor(i / cols) * cell + (cell - size) / 2;
        var sil = d.createElement('canvas'); sil.width = sil.height = size;
        var sx = sil.getContext('2d'); sx.drawImage(img, 0, 0, size, size);
        sx.globalCompositeOperation = 'source-in'; sx.fillStyle = '#FFFFFF'; sx.fillRect(0, 0, size, size);
        x.save(); x.shadowColor = 'rgba(23, 11, 51, .25)'; x.shadowBlur = 18; x.shadowOffsetY = 10;
        x.drawImage(sil, cx, cy + 4); x.restore();
        for (var a = 0; a < 16; a++) { var ang = a * Math.PI / 8; x.drawImage(sil, cx + Math.cos(ang) * r, cy + Math.sin(ang) * r); }
        x.drawImage(img, cx, cy, size, size);
      });
      x.font = '700 26px "Atkinson Hyperlegible Next", "Atkinson fb", sans-serif';
      x.fillStyle = '#574D70';
      x.fillText(String(YSD.cfg ? YSD.cfg('legal.cardFooter', '') : ''), pad, Hh - 60);
      return c;
    });
  }
  if (packBtn) packBtn.addEventListener('click', function () {
    if (packBtn.getAttribute('aria-disabled') === 'true') {
      if (YSD.ui) YSD.ui.toast(t('join:pack.locked'), { tone: 'info' });
      jump();
      return;
    }
    packBtn.setAttribute('data-state', 'loading');
    drawPack().then(function (canvas) {
      packBtn.removeAttribute('data-state');
      if (YSD.cards && YSD.cards.download) YSD.cards.download(canvas, t('join:pack.file') || 'young-dems-sticker-pack.png');
      else {
        var a = d.createElement('a'); a.href = canvas.toDataURL('image/png'); a.download = 'young-dems-sticker-pack.png'; d.body.appendChild(a); a.click(); a.remove();
      }
      if (YSD.ui) YSD.ui.toast(t('join:pack.done'), { tone: 'success' });
      track('sticker_pack', {});
    }, function () {
      packBtn.removeAttribute('data-state');
      if (YSD.ui) YSD.ui.toast(t('error.submit.failed'), { tone: 'error' });
    });
  });

  // ------------------------------------------------------------- chip-in
  function chipIn() {
    var a = $('[data-chip-in]');
    if (!a) return;
    var u = YSD.share && YSD.share.actblue ? YSD.share.actblue(5) : '';
    if (u) a.href = u; else if (chipSec) chipSec.hidden = true;
  }

  // ------------------------------------------------------------- public sticker rules (before joining)
  // On phones the sticker grid is a swipe rail (join.css): a scroll region needs a name and keyboard focus.
  function railA11y(host) {
    var g = $('.rules__grid', host), h = $('.rules__title', host);
    if (!g) return;
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'list');
    if (h && h.id) g.setAttribute('aria-labelledby', h.id);
  }
  function rules() {
    var host = $('[data-rules-host]');
    if (!host) return;
    var api = YSD.membercard || YSD.memberCard;
    if (api && typeof api.rulesPanel === 'function') {
      try {
        api.rulesPanel(host, { heading: 'h2', id: 'how-stickers-work' });
        railA11y(host);
        d.addEventListener('ysd:sticker', function () { railA11y(host); });
        d.addEventListener('ysd:joined', function () { setTimeout(function () { railA11y(host); }, 0); });
        return;
      } catch (e) {}
    }
    var sec = host.closest('.x-rules'); if (sec) sec.hidden = true;
  }

  // Hand face: switch it on only when a [data-hand] element nears the viewport (see the page CSS).
  function lazyHand() {
    var els = d.querySelectorAll('[data-hand]');
    if (!els.length) return;
    var on = function () { d.documentElement.setAttribute('data-hand', 'on'); };
    if (!('IntersectionObserver' in w)) { on(); return; }
    var io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { on(); io.disconnect(); } }, { rootMargin: '600px 0px' });
    Array.prototype.forEach.call(els, function (e) { io.observe(e); });
  }

  // ------------------------------------------------------------- card saving, loaded after the page
  // W5's "Save my card" needs cards-brand.js + maker.js (about 120 KB). Only members see the card, so
  // they load when someone joins (or arrives already joined), then the member card repaints with the button.
  function lateCardTools() {
    if (YSD.brandCards && YSD.maker) return;
    var root = YSD.root || '';
    loadScript(root + 'assets/js/cards-brand.js').then(function () { return loadScript(root + 'assets/js/maker.js'); }).then(function () {
      var host = $('#join-card');
      if (host && host.__ysdCard && host.__ysdCard.refresh) host.__ysdCard.refresh();
    }, function () {});
  }

  // ------------------------------------------------------------- wiring
  if (form) {
    var first = $('#join-first');
    if (first) first.addEventListener('input', function () { paintName(first.value); });
    form.addEventListener('reset', function () { setTimeout(function () { paintName(''); }, 0); });
  }
  d.addEventListener('change', function (e) {
    var tEl = e.target;
    if (tEl && tEl.name === 'city' && tEl.closest('[data-join-step2]')) paintCity(tEl.value);
  });
  d.addEventListener('ysd:join-form-joined', function (e) {
    var m = (e.detail && e.detail.member) || member() || {};
    unlock(m); lateCardTools(); offerSeat();
  });
  d.addEventListener('ysd:join-form-saved', function (e) { var m = e.detail && e.detail.member; if (m) paintCity(m.city); });
  d.addEventListener('ysd:join-form-reset', relock);

  function boot() {
    paintSince();
    var m = member();
    landing();
    heroState(m);
    if (m && m.firstName) unlock(m);
    shelf();
    chipIn();
    rules();
    lazyHand();
    eventBoot();
    if (m && m.firstName) lateCardTools();
  }
  if (YSD.ui && YSD.ui.ready) YSD.ui.ready(boot); else boot();
})(window, document);
