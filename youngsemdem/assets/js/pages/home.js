/*! YDSC · assets/js/pages/home.js (W1). Home page behaviour (BRIEF §4.1). Classic script, no AI, no network
 * beyond the page's own files and images.unsplash.com photos.
 *
 * Loads after the core stack, data/slices/home.js, assets/js/eventcard.js and assets/js/rsvp.js (W2).
 *  - The next DEMO event (YSD.events.upcoming) becomes the hero ticket (.invite--compact on phones,
 *    .invite--hero on desktop), the pinned "Next hangout" card and the first of the three invites, so one
 *    RSVP sheet submit updates all three (rsvp.js keeps every [data-rsvp] / [data-rsvp-count] in sync).
 *  - Pinned civic cards follow data/civic.js nextActions windows ([data-show-until]); the mail-ballot card
 *    flips to the 2027 wording on Jan 1, 2027; the January reminder is the civic .ics (Mon, Jan 4, 2027,
 *    10 am ET). The Nov 3 debrief band hides after Dec 31, 2026.
 *  - The January drop's Notify me writes an .ics for Tue, Dec 15, 2026, noon ET and remembers drop:notify.
 *  - Lazy groups, loaded when their section comes within ~500 px of the viewport (or the URL hash points
 *    into it), so the first view stays inside the home budget (BRIEF §7.10):
 *      reel  -> data/clips.js, assets/js/clips.js, assets/js/reel.js           YSD.reel.mount (W4)
 *      maker -> assets/css/maker.css, data/slices/growth.js, cards-brand.js,
 *               membercard.js, maker.js                                        YSD.maker.mount (W5)
 *      join  -> the maker group's card files, then assets/js/joinform.js       YSD.joinForm.mount (W6)
 *  - Word stickers switch to the hand font only when they come near the viewport (keeps the 58 KB hand
 *    font out of the first view).
 * Exposes window.YSD.home = { next(), load(group) -> Promise } for tests. Storage: drop:notify (W2 key).
 */
(function (w, d) {
  'use strict';
  var YSD = w.YSD = w.YSD || {};
  var NOW = Date.now();

  function $(s, r) { return (r || d).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || d).querySelectorAll(s)); }
  function t(k, v) { return typeof YSD.t === 'function' ? YSD.t(k, v) : ''; }
  function lang() { return YSD.lang || (/^es/i.test(d.documentElement.lang) ? 'es' : 'en'); }
  function tx(o) { return o ? (o[lang()] || o.en || '') : ''; }
  function data() { return w.YSD_DATA || {}; }
  function el(tag, cls, text) { var n = d.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function toast(s, tone) { if (s && YSD.ui && YSD.ui.toast) YSD.ui.toast(s, { tone: tone || 'success' }); }
  function track(e, p) { try { if (typeof YSD.track === 'function') YSD.track(e, p); } catch (x) {} }
  function store(k, v) { try { if (!YSD.store) return null; return arguments.length > 1 ? YSD.store.set(k, v) : YSD.store.get(k, null); } catch (x) { return null; } }
  function root() { return typeof YSD.root === 'string' ? YSD.root : (lang() === 'es' ? '../' : ''); }
  function byId(list, id) { for (var i = 0; list && i < list.length; i++) if (list[i] && list[i].id === id) return list[i]; return null; }

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

  /* ------------------------------------------------------------------ events: ticket, hangout pin, invites */
  var EV = YSD.events;
  var upcoming = EV && EV.upcoming ? EV.upcoming({ limit: 4 }) : [];
  var next = upcoming[0] || null;

  function ticket() {
    var slot = $('[data-x-ticket]');
    if (!slot || !next) return;
    slot.textContent = '';
    var phone = EV.render(next, { variant: 'compact', level: 2 });
    phone.classList.add('x-ticket__phone');
    // The phone ticket's cover is about a third of the card wide, so it never needs the 92vw candidate.
    var pim = phone.querySelector('img'); if (pim) pim.setAttribute('sizes', '(min-width: 1000px) 1px, 34vw');
    var desk = EV.render(next, { variant: 'hero', level: 2 });
    desk.classList.add('x-ticket__desk');
    slot.appendChild(phone);
    slot.appendChild(desk);
  }

  function hangout() {
    var card = $('[data-x-hangout]');
    if (!card || !next) return;
    var kick = $('.pin__kicker', card);
    if (kick && next.demo !== false) {
      var tag = el('span', 'tag tag--demo', EV.label('demoEvent') || 'DEMO event');
      kick.insertBefore(tag, kick.firstChild);
      kick.insertBefore(d.createTextNode(' '), tag.nextSibling);
    }
    var title = $('[data-x-hangout-title]', card);
    if (title) {
      title.textContent = '';
      var a = el('a', 'x-pin__link', tx(next.title));
      a.href = EV.url(next);
      title.appendChild(a);
    }
    var body = $('[data-x-hangout-body]', card);
    if (body) {
      body.textContent = '';
      body.appendChild(el('b', null, EV.when(next) + ' · ' + EV.city(next) + '.'));
      body.appendChild(d.createTextNode(' ' + (tx(next.cost && next.cost.label) || t('home:hangout.free'))));
    }
    var acts = $('[data-x-hangout-actions]', card);
    if (acts) {
      acts.textContent = '';
      var go = el('a', 'btn btn--ink btn--sm', EV.isFull(next) ? (EV.label('waitlist') || t('cta.waitlist')) : (t('cta.imIn') || "I'm in"));
      go.href = EV.joinHref ? EV.joinHref(next) : 'join.html?e=' + next.id;
      go.setAttribute('data-rsvp', next.id);
      acts.appendChild(go);
      var det = el('a', 'btn btn--ghost btn--sm', t('cta.details') || 'Details');
      det.href = EV.url(next);
      det.setAttribute('aria-label', (t('cta.details') || 'Details') + ': ' + tx(next.title));
      acts.appendChild(det);
    }
    var fine = el('p', 'pin__fine');
    fine.setAttribute('data-rsvp-count', next.id);
    card.appendChild(fine);
  }

  function invites() {
    var strip = $('[data-x-invites]');
    if (!strip || !upcoming.length) return;
    strip.textContent = '';
    upcoming.slice(0, 3).forEach(function (e) { strip.appendChild(EV.render(e, { variant: 'invite', level: 3 })); });
  }

  if (EV && next) {
    try { ticket(); hangout(); invites(); } catch (x) { if (YSD.log) YSD.log('home: events', x); }
    if (YSD.rsvp && YSD.rsvp.refresh) YSD.rsvp.refresh();
  }

  /* ------------------------------------------------------------------ the January drop */
  var dropBox = $('[data-x-drop]');
  var DROP = (data().events && data().events.schedule && data().events.schedule.drop) || null;
  if (dropBox && DROP) {
    var open = EV && EV.drop && EV.drop.isOpen ? EV.drop.isOpen() : NOW >= Date.parse(DROP.opensAt);
    var nb = $('[data-x-notify]', dropBox);
    if (open) {
      var line = $('.x-drop__line', dropBox), sub = $('.x-drop__sub', dropBox);
      if (line) line.textContent = t('home:js.dropOpen');
      if (sub) sub.hidden = true;
      if (nb) nb.hidden = true;
    } else if (nb && YSD.cal) {
      if (store('drop:notify')) nb.setAttribute('aria-pressed', 'true');
      nb.addEventListener('click', function () {
        var start = DROP.opensAt, end = new Date(Date.parse(start) + 30 * 60000).toISOString();
        var ok = YSD.cal.download({
          id: 'ysd-drop-2027-01', title: tx(DROP.calTitle), start: start, end: end, description: tx(DROP.calDescription),
          url: YSD.share && YSD.share.url ? YSD.share.url('events.html') : '', alarm: 0
        }, 'young-dems-january-drop.ics');
        if (ok) { store('drop:notify', Date.now()); nb.setAttribute('aria-pressed', 'true'); toast(t('home:drop.saved')); track('drop_notify', {}); }
      });
    }
  }

  /* ------------------------------------------------------------------ chip-in link (config ActBlue, with ref) */
  var chip = $('[data-x-chip]');
  if (chip && YSD.share && YSD.share.actblue) {
    var u = YSD.share.actblue(5);
    if (u) chip.href = u; else chip.closest('.x-chip').hidden = true;
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
      var ctl = YSD.reel.mount(strip, { limit: 4, sort: 'new', showPost: true, postHref: 'post.html', moreHref: 'clips.html', autoplay: false, report: true });
      var p = YSD.reel.prompt ? YSD.reel.prompt() : null, slot = $('[data-x-prompt]');
      if (slot && p && !p.rest && p.title) slot.textContent = tx(p.title);
      return ctl && ctl.ready;
    });
  };
  groups.maker = function () {
    return Promise.all([loadCss('assets/css/maker.css'), chain(CARD_FILES.concat(['assets/js/maker.js']))]).then(function () {
      var slot = $('[data-x-maker]');
      if (!slot || !YSD.maker || !YSD.maker.mount) return;
      YSD.maker.mount(slot, { templates: ['invite', 'psa-mail', 'join', 'cover'], template: 'invite', eventId: next ? next.id : undefined, meter: true });
      moreToggle(slot);
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
    if (!loaded['group:' + name]) {
      loaded['group:' + name] = groups[name]().catch(function (e) { if (YSD.log) YSD.log(e); });
    }
    return loaded['group:' + name];
  }

  /* Phones: the maker's secondary controls (event, city, issue, looks, photo, size, message) fold behind
     "More options" so the section stays a quick make-and-send. Desktop shows everything. */
  function moreToggle(slot) {
    var controls = $('.maker__controls', slot);
    if (!controls || $('[data-x-maker-more]', slot)) return;
    var b = el('button', 'btn btn--quiet btn--sm x-maker__more', t('home:maker.more') || 'More options');
    b.type = 'button';
    b.setAttribute('data-x-maker-more', '');
    b.setAttribute('aria-expanded', 'false');
    controls.setAttribute('data-x-folded', '');
    var nameField = $('[data-field="name"]', controls);
    if (nameField && nameField.nextSibling) controls.insertBefore(b, nameField.nextSibling); else controls.appendChild(b);
    b.addEventListener('click', function () {
      var open = b.getAttribute('aria-expanded') !== 'true';
      b.setAttribute('aria-expanded', String(open));
      b.textContent = open ? (t('home:maker.less') || 'Fewer options') : (t('home:maker.more') || 'More options');
      if (open) controls.removeAttribute('data-x-folded'); else controls.setAttribute('data-x-folded', '');
    });
  }

  var lazies = $$('[data-x-lazy]');
  var hands = $$('.x-hand');
  function hashGroup() {
    var id = String(w.location.hash || '').slice(1);
    if (!id) return;
    var target = null;
    try { target = d.getElementById(decodeURIComponent(id)); } catch (x) { target = null; }
    var sec = target && target.closest ? target.closest('[data-x-lazy]') : null;
    if (sec) load(sec.getAttribute('data-x-lazy'));
  }
  if ('IntersectionObserver' in w) {
    var io = new w.IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        io.unobserve(en.target);
        load(en.target.getAttribute('data-x-lazy'));
      });
    }, { rootMargin: '0px 0px 500px 0px' });
    lazies.forEach(function (s) { io.observe(s); });
    var hio = new w.IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { hio.unobserve(en.target); en.target.setAttribute('data-x-seen', ''); } });
    }, { rootMargin: '0px 0px 300px 0px' });
    hands.forEach(function (h) { hio.observe(h); });
  } else {
    lazies.forEach(function (s) { load(s.getAttribute('data-x-lazy')); });
    hands.forEach(function (h) { h.setAttribute('data-x-seen', ''); });
  }
  hashGroup();
  w.addEventListener('hashchange', hashGroup);
  // A tap on a hero CTA that jumps to #join should find the form ready.
  d.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href^="#"]') : null;
    if (!a) return;
    var target = d.getElementById(a.getAttribute('href').slice(1));
    var sec = target && target.closest('[data-x-lazy]');
    if (sec) load(sec.getAttribute('data-x-lazy'));
  });

  YSD.home = { next: function () { return next; }, load: load };
})(window, document);
