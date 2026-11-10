/*! YDSC · assets/js/pages/home.js (W1; rebuilt by G-HOME, round 1, Nov 10, 2026). Home page behaviour (BRIEF §4.1).
 * Classic script, no AI, no network beyond the page's own files and images.unsplash.com photos.
 *
 * Loads after the core stack, data/slices/home.js, assets/js/eventcard.js and assets/js/rsvp.js (G-EVENTS).
 *  - Events, never repeated on the page (right-wing-repeat-event): the tentpole (YSD.events.tentpole().next, G-EVENTS'
 *    monthly Seminole Sunday edition) gets the poster band in #invites; the next other event is the hero's
 *    NEXT UP ticket; the one after it is the pinned "Coming up" card; the rest fill the invites strip. One RSVP sheet
 *    submit updates every control for that event (rsvp.js keeps [data-rsvp], [data-rsvp-count] and the tentpole's
 *    [data-rsvp-seats] in sync).
 *  - Pinned civic cards follow data/civic.js windows ([data-show-until]); the mail-ballot card flips to the 2027
 *    wording on Jan 1, 2027; the January reminder is the civic .ics (Mon, Jan 4, 2027, 10 am ET). The Nov 3 debrief
 *    hides after Dec 31, 2026 (the rest of the "real" band stays).
 *  - The drop card: January's lineup and DEMO Drop 01 (merch earned by organizing only) land together, so one Notify me
 *    writes one .ics for Tue, Dec 15, 2026, noon ET and remembers drop:notify and merch:notify.
 *  - Lazy groups, loaded when their section comes within ~600 px of the viewport, when the URL hash points into or
 *    below them, or when a same-page link jumps past them (so the page above the target is final before the scroll):
 *      reel    -> data/clips.js, assets/js/clips.js, assets/js/reel.js       YSD.reel.mount (G-VIDEO)
 *      maker   -> assets/css/maker.css, data/slices/growth.js, cards-brand.js,
 *                 membercard.js, maker.js                                    YSD.maker.mountQuick (G-GROWTH)
 *      stickers-> the maker group's card files                               YSD.membercard.rulesPanel({ max: 3 })
 *      join    -> the card files, then assets/js/joinform.js                 YSD.joinForm.mount (G-JOIN)
 *  - Join free (#join, #join-form) lands on the form (right-wing-join-jump): every lazy group above it mounts first,
 *    then the page scrolls (smooth unless reduced motion or Pause motion), re-checks the spot once the scroll settles
 *    and moves focus to the first field. Other same-page links do the same and focus the target's heading.
 *  - Word stickers switch to the hand font only when they come near the viewport (keeps the 58 KB hand font out of
 *    the first view; the hero's hand note is inline SVG for the same reason).
 * Exposes window.YSD.home = { next(), tentpole(), shown(), load(group) -> Promise, jump(id) -> Promise } for tests.
 * Storage: drop:notify (G-EVENTS key), merch:notify (home).
 */
(function (w, d) {
  'use strict';
  var YSD = w.YSD = w.YSD || {};
  var NOW = Date.now();

  function $(s, r) { return (r || d).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || d).querySelectorAll(s)); }
  function t(k, v) { return typeof YSD.t === 'function' ? YSD.t(k, v) : ''; }
  function lang() { return YSD.lang || (/^es/i.test(d.documentElement.lang) ? 'es' : 'en'); }
  function tx(o) { return o == null ? '' : typeof o === 'string' ? o : (o[lang()] || o.en || ''); }
  function data() { return w.YSD_DATA || {}; }
  function el(tag, cls, text) { var n = d.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function toast(s, tone) { if (s && YSD.ui && YSD.ui.toast) YSD.ui.toast(s, { tone: tone || 'success' }); }
  function track(e, p) { try { if (typeof YSD.track === 'function') YSD.track(e, p); } catch (x) {} }
  function store(k, v) { try { if (!YSD.store) return null; return arguments.length > 1 ? YSD.store.set(k, v) : YSD.store.get(k, null); } catch (x) { return null; } }
  function root() { return typeof YSD.root === 'string' ? YSD.root : (lang() === 'es' ? '../' : ''); }
  function byId(list, id) { for (var i = 0; list && i < list.length; i++) if (list[i] && list[i].id === id) return list[i]; return null; }
  function paused() { try { return YSD.ui && YSD.ui.motion ? YSD.ui.motion.paused() : w.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (x) { return false; } }

  /* ------------------------------------------------------------------ time windows */
  $$('[data-show-until]').forEach(function (n) {
    var until = Date.parse(n.getAttribute('data-show-until'));
    if (!isNaN(until) && NOW >= until) n.hidden = true;
  });
  // The mail-ballot card stays through 2027 with the new wording (data/strings.js nudge.mailBallot2027).
  var mail = $('#mail-ballot');
  if (mail && NOW >= Date.parse('2027-01-01T00:00:00-05:00')) {
    mail.hidden = false;
    $$('[data-mail-now]', mail).forEach(function (n) { n.hidden = true; });
    $$('[data-mail-later]', mail).forEach(function (n) { n.hidden = false; });
  }

  /* ------------------------------------------------------------------ January reminder (.ics) */
  var C = data().civic || {};
  var na = byId(C.nextActions, 'na-renew-reminder-2026');
  if (na && na.calendar && YSD.cal) {
    var rc = na.calendar;
    var rem = { id: 'ysd-civic-' + na.id, title: tx(rc.title), start: rc.date, end: rc.end, description: tx(rc.description), url: YSD.cfg ? YSD.cfg('links.vote.voteByMail', 'https://voteseminole.gov/how-to-vote/vote-by-mail/') : '', alarm: 5 };
    $$('[data-x-remind]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (YSD.cal.download(rem, 'renew-mail-ballot-reminder.ics')) { toast(t('home:js.reminderSaved')); track('reminder_add', { id: rem.id }); }
      });
    });
  } else {
    $$('[data-x-remind]').forEach(function (b) { b.hidden = true; });
  }

  /* ------------------------------------------------------------------ events: who goes where (no repeats) */
  var EV = YSD.events;
  var upcoming = EV && EV.upcoming ? EV.upcoming({ limit: 12 }) : [];
  var TP = EV && EV.tentpole ? EV.tentpole() : null;
  var tent = TP && TP.next && upcoming.indexOf(TP.next) >= 0 ? TP.next : null;
  for (var i = 0; i < upcoming.length && !tent && !TP; i++) if (upcoming[i].tentpole === true) tent = upcoming[i];
  if (!tent && upcoming.length > 2) {
    // No flag in the data: the biggest upcoming night after the very next one (capacity), within 45 days.
    var horizon = NOW + 45 * 864e5;
    upcoming.slice(1).forEach(function (e) {
      if (Date.parse(e.start) > horizon || !(e.capacity > 0)) return;
      if (!tent || e.capacity > tent.capacity) tent = e;
    });
  }
  var others = upcoming.filter(function (e) { return e !== tent; });
  var next = others[0] || null;
  var pinEv = others[1] || null;
  var invList = others.slice(2, 5);
  var shown = [];

  function rsvpHref(e) { return EV.joinHref ? EV.joinHref(e) : (root() + (lang() === 'es' ? 'es/' : '') + 'join.html?e=' + encodeURIComponent(e.id)); }
  function demoTag(e) { return e.demo !== false ? el('span', 'tag tag--demo', EV.label('demoEvent') || 'DEMO event') : null; }
  function token(e) {
    var tk = String((e.cover && e.cover.token) || '').replace(/^--/, '');
    return /^(celery|sky|sun|mint|bubblegum|pink|tangerine|orange|teal)$/.test(tk) ? tk : 'celery';
  }

  // The hero's NEXT UP ticket: date stub, DEMO tag, title, when + city, I'm in and the live count.
  function ticket() {
    var slot = $('[data-x-ticket]');
    if (!slot || !next) return;
    var card = el('article', 'x-tk');
    card.setAttribute('data-event', next.id);
    card.style.setProperty('--tk', 'var(--' + token(next) + ')');
    var stub = EV.ticket(next); stub.classList.add('x-tk__stub'); card.appendChild(stub);
    var body = el('div', 'x-tk__body');
    var tag = demoTag(next); if (tag) { var kick = el('p', 'x-tk__kick'); kick.appendChild(tag); body.appendChild(kick); }
    var h = el('h2', 'x-tk__title'); var a = el('a', null, tx(next.title)); a.href = EV.url(next); h.appendChild(a); body.appendChild(h);
    body.appendChild(el('p', 'x-tk__meta', EV.when(next) + ' · ' + EV.city(next)));
    var foot = el('div', 'x-tk__foot');
    var go = el('a', 'btn btn--ink btn--sm', EV.isFull(next) ? (EV.label('waitlist') || t('cta.waitlist')) : (t('cta.imIn') || "I'm in"));
    go.href = rsvpHref(next); go.setAttribute('data-rsvp', next.id); foot.appendChild(go);
    var cnt = el('span', 'x-tk__going'); cnt.setAttribute('data-rsvp-count', next.id); foot.appendChild(cnt);
    body.appendChild(foot);
    card.appendChild(body);
    slot.textContent = '';
    slot.appendChild(card);
    shown.push(next.id);
  }

  function hangout() {
    var card = $('[data-x-hangout]');
    if (!card || !pinEv) return;
    var kick = $('.pin__kicker', card), tag = demoTag(pinEv);
    if (kick && tag) { kick.insertBefore(tag, kick.firstChild); kick.insertBefore(d.createTextNode(' '), tag.nextSibling); }
    var title = $('[data-x-hangout-title]', card);
    if (title) { title.textContent = ''; var a = el('a', 'x-pin__link', tx(pinEv.title)); a.href = EV.url(pinEv); title.appendChild(a); }
    var body = $('[data-x-hangout-body]', card);
    if (body) {
      body.textContent = '';
      body.appendChild(el('b', null, EV.when(pinEv) + ' · ' + EV.city(pinEv) + '.'));
      body.appendChild(d.createTextNode(' ' + (tx(pinEv.cost && pinEv.cost.label) || t('home:hangout.free'))));
    }
    var acts = $('[data-x-hangout-actions]', card);
    if (acts) {
      acts.textContent = '';
      var go = el('a', 'btn btn--ink btn--sm', EV.isFull(pinEv) ? (EV.label('waitlist') || t('cta.waitlist')) : (t('cta.imIn') || "I'm in"));
      go.href = rsvpHref(pinEv); go.setAttribute('data-rsvp', pinEv.id); acts.appendChild(go);
      var det = el('a', 'btn btn--ghost btn--sm', t('cta.details') || 'Details');
      det.href = EV.url(pinEv); det.setAttribute('aria-label', (t('cta.details') || 'Details') + ': ' + tx(pinEv.title));
      acts.appendChild(det);
    }
    var fine = el('p', 'pin__fine'); fine.setAttribute('data-rsvp-count', pinEv.id); card.appendChild(fine);
    shown.push(pinEv.id);
  }

  function invites() {
    var strip = $('[data-x-invites]');
    if (!strip || !invList.length) return;
    strip.textContent = '';
    invList.forEach(function (e) { strip.appendChild(EV.render(e, { variant: 'invite', level: 3 })); shown.push(e.id); });
  }

  // The tentpole (right-wing-no-tentpole): G-EVENTS' poster-grade band (YSD.events.renderTentpole: duotone lock-up,
  // date ticket, DEMO seats bar, countdown, I'm in; rsvp.js keeps the seats and the button live). Without it, a
  // plain invite card.
  function poster() {
    var slot = $('[data-x-tent]');
    if (!slot || !tent) return;
    var card = EV.renderTentpole ? EV.renderTentpole(tent, { level: 3 }) : EV.render(tent, { variant: 'invite', level: 3 });
    slot.textContent = '';
    slot.appendChild(card);
    slot.hidden = false;
    shown.push(tent.id);
  }

  if (EV && upcoming.length) {
    try { poster(); ticket(); hangout(); invites(); } catch (x) { if (YSD.log) YSD.log('home: events', x); }
    if (YSD.rsvp && YSD.rsvp.refresh) YSD.rsvp.refresh();
  }

  /* ------------------------------------------------------------------ the drop: January's lineup + Drop 01 (one moment) */
  // One Notify me: one .ics for Tue, Dec 15, 2026 at noon ET that names both, and both keys remembered.
  var DROP = (data().events && data().events.schedule && data().events.schedule.drop) || null;
  var dropBox = $('[data-x-drop]');
  if (dropBox && DROP) {
    var dropOpen = EV && EV.drop && EV.drop.isOpen ? EV.drop.isOpen() : NOW >= Date.parse(DROP.opensAt);
    var nb = $('[data-x-notify]', dropBox);
    if (dropOpen) {
      var line = $('.x-drop__line', dropBox), sub = $('[data-x-drop-sub]', dropBox);
      if (line) line.textContent = t('home:js.dropOpen');
      if (sub) sub.hidden = true;
      if (nb) nb.hidden = true;
    } else if (nb && YSD.cal) {
      if (store('drop:notify') || store('merch:notify')) nb.setAttribute('aria-pressed', 'true');
      nb.addEventListener('click', function () {
        var start = DROP.opensAt, end = new Date(Date.parse(start) + 30 * 60000).toISOString();
        var ok = YSD.cal.download({
          id: 'ysd-drop-2027-01', title: t('home:js.merch.calTitle') || tx(DROP.calTitle), start: start, end: end,
          description: t('home:js.merch.calDescription') || tx(DROP.calDescription), url: YSD.share && YSD.share.url ? YSD.share.url('events.html') : '', alarm: 0
        }, 'young-dems-drop.ics');
        if (ok) { store('drop:notify', Date.now()); store('merch:notify', Date.now()); nb.setAttribute('aria-pressed', 'true'); toast(t('home:js.merch.saved')); track('drop_notify', { merch: true }); }
      });
    }
  }

  /* ------------------------------------------------------------------ chip-in link (config ActBlue, with ref) */
  var chip = $('[data-x-chip]');
  if (chip && YSD.share && YSD.share.actblue) {
    var cu = YSD.share.actblue(5);
    if (cu) chip.href = cu; else chip.closest('.x-chip').hidden = true;
  }

  /* ------------------------------------------------------------------ lazy groups */
  var loaded = {};
  function loadScript(src) {
    if (loaded[src]) return loaded[src];
    loaded[src] = new Promise(function (res, rej) {
      var s = d.createElement('script');
      s.src = root() + src;
      s.onload = function () { res(); };
      s.onerror = function () { rej(new Error('home: could not load ' + src)); };
      d.body.appendChild(s);
    });
    return loaded[src];
  }
  function loadCss(href) {
    if (loaded[href]) return loaded[href];
    loaded[href] = new Promise(function (res) {
      var l = d.createElement('link');
      l.rel = 'stylesheet'; l.href = root() + href;
      l.onload = function () { res(); }; l.onerror = function () { res(); };
      d.head.appendChild(l);
    });
    return loaded[href];
  }
  function chain(list) { return list.reduce(function (p, src) { return p.then(function () { return loadScript(src); }); }, Promise.resolve()); }
  var CARD_FILES = ['data/slices/growth.js', 'assets/js/cards-brand.js', 'assets/js/membercard.js'];
  var groups = {};
  groups.reel = function () {
    return chain(['data/clips.js', 'assets/js/clips.js', 'assets/js/reel.js']).then(function () {
      var strip = $('[data-reel]');
      if (!strip || !YSD.reel || !YSD.reel.mount) return;
      var ctl = YSD.reel.mount(strip, { limit: 4, sort: 'new', showPost: true, postHref: 'post.html', moreHref: 'clips.html' });
      var p = YSD.reel.prompt ? YSD.reel.prompt() : null, slot = $('[data-x-prompt]');
      if (slot && p && !p.rest && p.title) slot.textContent = tx(p.title);
      return ctl && ctl.ready;
    });
  };
  groups.maker = function () {
    return Promise.all([loadCss('assets/css/maker.css'), chain(CARD_FILES.concat(['assets/js/maker.js']))]).then(function () {
      var slot = $('[data-x-maker]');
      if (!slot || !YSD.maker || !YSD.maker.mountQuick) return;
      // The invite card asks a friend to the big night (or the next one when there's no tentpole).
      var q = YSD.maker.mountQuick(slot, { templates: ['invite', 'psa-mail', 'cover'], eventId: (tent || next || {}).id });
      if (q) slot.setAttribute('data-maker', ''); // qa hook: tools/qa.js's home scenario waits for [data-maker]
    });
  };
  groups.stickers = function () {
    return Promise.all([loadCss('assets/css/maker.css'), chain(CARD_FILES)]).then(function () {
      var box = $('[data-x-rules]');
      if (box && YSD.membercard && YSD.membercard.rulesPanel) {
        YSD.membercard.rulesPanel(box, { heading: 'h3', id: 'home-stickers', max: 3, cta: false, eyebrow: false });
      }
    });
  };
  groups.join = function () {
    return Promise.all([loadCss('assets/css/maker.css'), chain(CARD_FILES.concat(['assets/js/joinform.js']))]).then(function () {
      var form = $('[data-join-form]');
      if (!form || !YSD.joinForm || !YSD.joinForm.mount) return;
      YSD.joinForm.mount(form, { compact: true, source: 'home', headingLevel: 3, card: $('[data-x-card]'), cardHref: '#member-card' });
      $$('[data-x-nojs]').forEach(function (n) { n.hidden = true; });
    });
  };
  function load(name) {
    if (!groups[name]) return Promise.resolve();
    if (!loaded['group:' + name]) loaded['group:' + name] = groups[name]().catch(function (e) { if (YSD.log) YSD.log(e); });
    return loaded['group:' + name];
  }

  // Drop 01's sticker sheet: six die-cut county stickers from data/stickers.js (already on the page).
  (function sheet() {
    var box = $('[data-x-sheet]');
    if (!box || !YSD.ui || !YSD.ui.sticker) return;
    ['celery', 'chicken', 'train', 'manatee', 'gator', 'sun'].forEach(function (id) {
      var s = YSD.ui.sticker(id);
      if (!s || !s.svg) return;
      var c = el('span', 'x-drop1__die');
      c.innerHTML = s.svg; // trusted: our own data file
      box.appendChild(c);
    });
  })();

  var lazies = $$('[data-x-lazy]');
  var hands = $$('.x-hand');
  function groupsUpTo(target) {
    // every lazy section above the target, plus the one that holds it
    return lazies.filter(function (s) {
      return s.contains(target) || (s.compareDocumentPosition(target) & 4); // 4: target follows s
    }).map(function (s) { return s.getAttribute('data-x-lazy'); });
  }
  if ('IntersectionObserver' in w) {
    var io = new w.IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (!en.isIntersecting) return; io.unobserve(en.target); load(en.target.getAttribute('data-x-lazy')); });
    }, { rootMargin: '0px 0px 600px 0px' });
    lazies.forEach(function (s) { io.observe(s); });
    var hio = new w.IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { hio.unobserve(en.target); en.target.setAttribute('data-x-seen', ''); } });
    }, { rootMargin: '0px 0px 300px 0px' });
    hands.forEach(function (h) { hio.observe(h); });
  } else {
    lazies.forEach(function (s) { load(s.getAttribute('data-x-lazy')); });
    hands.forEach(function (h) { h.setAttribute('data-x-seen', ''); });
  }

  /* ------------------------------------------------------------------ jumps that land (right-wing-join-jump) */
  function frames(n) { return new Promise(function (res) { (function f(k) { if (k <= 0) return res(); w.requestAnimationFrame(function () { f(k - 1); }); })(n || 2); }); }
  function settle(maxMs) {
    // resolves when the window stops scrolling (or after maxMs)
    return new Promise(function (res) {
      var last = w.scrollY, still = 0, t0 = Date.now();
      (function tick() {
        w.requestAnimationFrame(function () {
          if (Math.abs(w.scrollY - last) < 1) still++; else still = 0;
          last = w.scrollY;
          if (still > 6 || Date.now() - t0 > maxMs) res(); else tick();
        });
      })();
    });
  }
  function focusIn(target) {
    var field = target.querySelector('input:not([type="hidden"]):not([disabled]), select, textarea');
    if (field && field.getClientRects().length) { try { field.focus({ preventScroll: true }); } catch (x) { field.focus(); } return field; }
    return YSD.ui && YSD.ui.jump ? YSD.ui.jump(target, { scroll: false }) : null;
  }
  var jumping = 0;
  function jump(id, opts) {
    opts = opts || {};
    var target = d.getElementById(id);
    if (!target) return Promise.resolve(null);
    var join = id === 'join' || id === 'join-form';
    if (join) target = d.getElementById('join-form') || target;
    var my = ++jumping;
    return Promise.all(groupsUpTo(target).map(load)).then(function () { return frames(2); }).then(function () {
      if (my !== jumping) return null;
      var smooth = !paused() && opts.smooth !== false;
      try { target.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' }); } catch (x) { target.scrollIntoView(); }
      return settle(smooth ? 1600 : 120).then(function () {
        if (my !== jumping) return null;
        // late layout (fonts, posters) can still nudge the target: one instant correction
        var top = target.getBoundingClientRect().top, want = (parseFloat(w.getComputedStyle(target).scrollMarginTop) || 0) + (parseFloat(w.getComputedStyle(d.documentElement).scrollPaddingTop) || 0);
        if (Math.abs(top - want) > 8) { try { target.scrollIntoView({ block: 'start', behavior: 'auto' }); } catch (x) {} }
        return join ? focusIn(target) : (YSD.ui && YSD.ui.jump ? YSD.ui.jump(target, { scroll: false }) : null);
      });
    });
  }
  d.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href^="#"]') : null;
    if (!a) return;
    var id = a.getAttribute('href').slice(1), target = id && d.getElementById(id);
    if (!target) return;
    var pending = groupsUpTo(target).filter(function (g) { return !loaded['group:' + g]; });
    if (!a.hasAttribute('data-x-jump') && !pending.length) return; // nothing above it can move: ui.js handles it
    e.preventDefault();
    try { if (w.history && w.history.pushState) w.history.pushState(null, '', '#' + id); } catch (x) {}
    jump(id);
  });
  // Arriving with #join (or any hash below a lazy section): same thing, once.
  (function arrive() {
    var id = String(w.location.hash || '').slice(1);
    if (!id) return;
    try { id = decodeURIComponent(id); } catch (x) {}
    var target = d.getElementById(id);
    if (!target || !groupsUpTo(target).length) return;
    jump(id, { smooth: false });
  })();
  w.addEventListener('hashchange', function () {
    var id = String(w.location.hash || '').slice(1), target = id && d.getElementById(id);
    if (target && groupsUpTo(target).some(function (g) { return !loaded['group:' + g]; })) jump(id, { smooth: false });
  });

  YSD.home = { next: function () { return next; }, tentpole: function () { return tent; }, shown: function () { return shown.slice(); }, load: load, jump: jump };
})(window, document);
