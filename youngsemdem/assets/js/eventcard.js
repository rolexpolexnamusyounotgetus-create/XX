/*! YDSC · assets/js/eventcard.js (W2). Event data helpers and the .invite card renderer (BRIEF 3.8, 4.3, 7.7).
 *
 * Classic script. Load after the core stack (config, store, share, cal, ui) and after the events data
 * (data/events.js, or a slice that keeps the same namespace: window.YSD_DATA.events). rsvp.js is
 * optional: when it is loaded, cards show your own RSVP and the live count. Nothing here fetches.
 *
 * API (window.YSD.events)
 *   upcoming({ limit, until, includeDrop, includePast, kind, city, lang })  -> [event] by start time.
 *        Hides past events (end has passed), cancelled events, and drop events (start after
 *        schedule.drop.cutoff) until schedule.drop.opensAt by the visitor's clock, unless
 *        includeDrop is true or the page URL has ?drop=open. kind: 'social'|'learn'|'volunteer'|
 *        'create'; city: a data city id; lang: 'es' keeps events that run in Spanish.
 *   get(id)                     -> event | null
 *   all()                       -> every event in the data (no filtering)
 *   render(event, { variant: 'invite'|'compact'|'hero', level: 3, anchor: false, eager: false,
 *                   lang })     -> <article class="invite"> Element (text set with textContent)
 *   ticket(event, { lang })     -> <span class="ticket"> date stub Element
 *   cal(event, lang)            -> a YSD.cal event: title + " (DEMO)", New York times, 3-hour alarm
 *   url(event, { lang })        -> relative link to events/<id>.html from the current page
 *                                  (es/events/<id>.html on Spanish pages)
 *   path(event, { lang })       -> root-relative path, 'events/<id>.html' (for YSD.share.url)
 *   drop: { cutoff(), opensAt(), isOpen(), isDropEvent(event), events() }
 *   isPast(event), isFull(event), when(event, lang), place(event, lang), city(event, lang)
 *   label(key, vars, lang)      -> data/events.js labels.<key> in the page language, {n} etc. filled
 *   ROUND 1 (G-EVENTS, Tue Nov 10, 2026):
 *   series(idOrEvent)           -> { id, name, short, recurs, blurb } in the page language (recurs already
 *                                  carries "(DEMO)"; '' for a one-off), or null. seriesName(idOrEvent, {short})
 *   seriesList({ withDates })   -> every series that has a visible upcoming event (or every one): [{ ...series,
 *                                  next: event | null, dates: [event], locked: bool (only drop events left) }]
 *   tentpole()                  -> { id, name, recurs, tagline, eyebrow, next: event | null, editions: [event] }
 *                                  (next = the next visible edition by the visitor's clock; null when none)
 *   renderTentpole(event, { level, lang, eager }) -> <article class="tentpole"> the poster-grade band (CSS in
 *                                  rsvp.css): duotone type lock-up, date ticket, DEMO seats bar, countdown, I'm in
 *   isTeen(event)               -> true when under-18s need no guardian form (ages.guardian false): "Good for
 *                                  under-18s" (filter + tag; right-wing-teen-path)
 *   duoDefs()                   -> injects the two-tone photo map (SVG feComponentTransfer filters, one per cover
 *                                  colour: shadows to --night, highlights to the event colour) once and sets
 *                                  <html data-duo-map>; rsvp.css applies it to .photo--duo[data-duo]
 *                                  (genz-brand-16). Static event pages ship the same defs in their HTML.
 *   cover.photo.card false      -> cards use the type poster instead of the photo (subject too small at card size);
 *                                  the event page still shows the photo
 *
 * Fields an event needs (keep these in any slice, e.g. W1's data/slices/home.js):
 *   id, demo, status, series, tentpole, kind, tone, title{}, start, end, city, place{ kind, name{}, address },
 *   language[], vibes[], cost{ label{} }, capacity, going, cover{ token, sticker, short{}, photo? }, share{ title{},
 *   text{} }, bringFriend{}, calDescription{}, ages{ guardian }; plus labels{}, cities{}, vibes{}, policy{},
 *   rsvpForm{}, schedule.drop, series{}, tentpole{}. data/slices/events.js carries exactly this (load it, not
 *   data/events.js, on any page that only lists events or opens the RSVP sheet).
 *
 * MARKUP CONTRACT (what render() returns; copy it for static HTML, see styleguide.html "Ticket and invite")
 *   <article class="invite [invite--compact|invite--hero]" style="--duo: var(--sky)" data-event="<id>"
 *            data-kind data-city data-lang="en es" [id="<id>" when anchor]>
 *     <div class="invite__cover"> <figure class="photo photo--duo">img + .tag--stock</figure> (verified
 *       photo) | <p class="invite__cover-title" aria-hidden="true">short title</p> (no photo)
 *       <span class="sticker" data-sticker aria-hidden="true"> <span class="invite__date">.ticket</span>
 *       <span class="tag tag--demo">DEMO event</span> </div>
 *     <div class="invite__body">
 *       <h3 class="invite__title"><a href="events/<id>.html">Title</a></h3>   (the link covers the card)
 *       <ul class="invite__meta"> when · where · cost </ul>   <ul class="invite__vibes"> (invite, hero)
 *       <div class="invite__going" data-rsvp-going="<id>"> facepile + "{n} going (DEMO)" </div>
 *       <div class="invite__rsvp"><a class="btn btn--primary" href="join.html?e=<id>" data-rsvp="<id>">I'm in</a>
 *         <a class="btn btn--ghost" href="events/<id>.html">Details</a></div>
 *     </div></article>
 *   rsvp.js keeps every [data-rsvp="<id>"] and [data-rsvp-going="<id>"] in sync after an RSVP.
 * There is no AI feature here, and no network call (photos load from images.unsplash.com as <img>).
 */
(function (w, d) {
  'use strict';
  var YSD = w.YSD = w.YSD || {};
  var UNSPLASH = 'https://images.unsplash.com/' + 'photo-'; // + id (split so tools/credits.py doesn't read the prefix as a photo)
  var AVATAR_COLORS = ['var(--bubblegum)', 'var(--sky)', 'var(--tangerine)', 'var(--celery)', 'var(--mint)', 'var(--sun)'];
  var INITIALS = 'ADJKLMNRSTVYBCEGP';

  function data() { return (w.YSD_DATA && w.YSD_DATA.events) || { items: [] }; }
  function lang(l) { return l || YSD.lang || (String(d.documentElement.getAttribute('lang') || 'en').slice(0, 2) === 'es' ? 'es' : 'en'); }
  function tx(o, l) { if (o == null) return ''; if (typeof o === 'string') return o; return o[lang(l)] != null ? o[lang(l)] : (o.en || ''); }
  function t(key, vars) { return typeof YSD.t === 'function' ? YSD.t(key, vars) : ''; }
  function fill(s, vars) {
    return String(s == null ? '' : s).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? String(vars[k]) : m; });
  }
  var FALLBACK = { recurs: '{recurs} (DEMO)', teen: 'Good for under-18s', teenHint: "It's in the daytime, so under-18s don't need a guardian form.",
    seats: '{n} of {cap} seats saved (DEMO)', daysToGo: '{n} days to go', dayToGo: '1 day to go', today: "It's today", demoEvent: 'DEMO event',
    going: '{n} going (DEMO)', dropSeries: "{series} is in January's lineup. It drops Tue, Dec 15 at noon (DEMO)." };
  function label(key, vars, l) {
    var L = data().labels || {};
    return fill(tx(L[key], l) || FALLBACK[key] || '', vars);
  }
  function el(tag, cls, text) {
    var n = d.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function now() { return Date.now(); }
  function q() { try { return String(w.location.search || ''); } catch (e) { return ''; } }

  /* ------------------------------------------------------------------ data access */
  function all() { return (data().items || []).slice(); }
  function get(id) {
    var items = data().items || [];
    for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i];
    return null;
  }
  function isPast(e) { return !!e && now() >= Date.parse(e.end || e.start); }
  function isFull(e) { return !!e && (e.status === 'full' || (+e.capacity > 0 && +e.going >= +e.capacity)); }

  var drop = {
    cfg: function () { return (data().schedule && data().schedule.drop) || null; },
    cutoff: function () { var c = drop.cfg(); return c ? c.cutoff : ''; },
    opensAt: function () { var c = drop.cfg(); return c ? c.opensAt : ''; },
    isOpen: function () {
      var c = drop.cfg();
      if (!c) return true;
      if (/[?&]drop=open(&|$)/.test(q())) return true;
      return now() >= Date.parse(c.opensAt);
    },
    isDropEvent: function (e) { var c = drop.cfg(); return !!(c && e && Date.parse(e.start) > Date.parse(c.cutoff)); },
    events: function () { return all().filter(function (e) { return drop.isDropEvent(e) && !isPast(e) && e.status !== 'cancelled'; }); }
  };

  function upcoming(opts) {
    opts = opts || {};
    var open = opts.includeDrop || drop.isOpen();
    var until = opts.until ? Date.parse(opts.until) : Infinity;
    var out = all().filter(function (e) {
      if (e.status === 'cancelled') return false;
      if (!opts.includePast && isPast(e)) return false;
      if (!open && drop.isDropEvent(e)) return false;
      if (Date.parse(e.start) > until) return false;
      if (opts.kind && e.kind !== opts.kind) return false;
      if (opts.city && e.city !== opts.city) return false;
      if (opts.lang && (e.language || []).indexOf(opts.lang) < 0) return false;
      return true;
    });
    out.sort(function (a, b) { return Date.parse(a.start) - Date.parse(b.start); });
    return opts.limit ? out.slice(0, opts.limit) : out;
  }

  /* ------------------------------------------------------------------ text helpers */
  function when(e, l) {
    if (YSD.fmt && YSD.fmt.when) return YSD.fmt.when(e.start, e.end, { lang: lang(l) });
    return tx(e.when, l);
  }
  function city(e, l) { var c = data().cities || {}; return tx(c[e.city], l) || ''; }
  function place(e, l) {
    var p = e.place || {}, name = tx(p.name, l);
    if (p.kind === 'public') return String(name).split(',')[0];
    return label('demoVenue', null, l) || name;
  }
  function going(e) {
    if (YSD.rsvp && typeof YSD.rsvp.count === 'function') return YSD.rsvp.count(e.id);
    return +e.going || 0;
  }

  /* ------------------------------------------------------------------ links */
  function rootPrefix() {
    var root = YSD.root || '';
    var here = '';
    try { here = String(w.location.href).split('#')[0].split('?')[0]; } catch (e) { return ''; }
    var dir = here.slice(0, here.lastIndexOf('/') + 1);
    if (!root || dir.indexOf(root) !== 0) return '';
    var depth = dir.slice(root.length).split('/').filter(Boolean).length;
    var s = '';
    for (var i = 0; i < depth; i++) s += '../';
    return s;
  }
  function path(e, opts) {
    var l = lang(opts && opts.lang);
    return (l === 'es' ? 'es/' : '') + 'events/' + encodeURIComponent(e.id) + '.html';
  }
  function url(e, opts) { return rootPrefix() + path(e, opts); }
  function joinHref(e) { return rootPrefix() + (lang() === 'es' ? 'es/' : '') + 'join.html?e=' + encodeURIComponent(e.id); }

  /** "Central Winds Park, Winter Springs"; the city is left off when the place name already says it (journeys-24:
      "A board-game café in Casselberry (DEMO venue)" stays as it is). */
  function calLocation(e, l) {
    var name = tx((e.place || {}).name, l), c = city(e, l);
    if (!c || name.toLowerCase().indexOf(c.toLowerCase()) >= 0) return name || c;
    return [name, c].filter(Boolean).join(', ');
  }
  function cal(e, l) {
    l = lang(l);
    var link = '';
    try { link = YSD.share && YSD.share.url ? YSD.share.url(path(e, { lang: l }), { ref: false, utm: false }) : ''; } catch (x) { link = ''; }
    var p = e.place || {};
    return {
      id: 'ydsc-' + e.id,
      title: tx(e.title, l) + (e.demo ? ' (DEMO)' : ''),
      start: e.start,
      end: e.end,
      location: calLocation(e, l),
      address: p.address || '',
      description: tx(e.calDescription, l),
      url: link,
      alarm: 180
    };
  }

  /* ------------------------------------------------------------------ pieces */
  function photoUrl(id, wpx) { return UNSPLASH + id + '?w=' + wpx + '&q=60&auto=format&fit=crop'; }

  function ticket(e, opts) {
    var l = lang(opts && opts.lang);
    var tk = el('span', 'ticket');
    var mo = '', day = '', time = '';
    try {
      var f = new Intl.DateTimeFormat(l === 'es' ? 'es-US' : 'en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });
      f.formatToParts(new Date(e.start)).forEach(function (p) { if (p.type === 'month') mo = p.value.replace(/\.$/, ''); if (p.type === 'day') day = p.value; });
    } catch (x) { mo = ''; day = ''; }
    time = YSD.fmt && YSD.fmt.time ? YSD.fmt.time(e.start, { lang: l }) : '';
    tk.appendChild(el('span', 'ticket__month', mo));
    tk.appendChild(el('span', 'ticket__day', day));
    if (time) tk.appendChild(el('span', 'ticket__time', time));
    tk.setAttribute('aria-hidden', 'true');
    return tk;
  }

  function hash(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
  /** Face pile: up to 3 DEMO initials (made up, deterministic per event) plus your own initial if you opted in. */
  function facepile(e, opts) {
    opts = opts || {};
    var pile = el('span', 'facepile');
    pile.setAttribute('aria-hidden', 'true');
    var rec = YSD.rsvp && YSD.rsvp.state ? YSD.rsvp.state(e.id) : null;
    var shown = 0, h = hash(e.id), size = opts.size === 'sm' ? ' avatar--sm' : '';
    if (rec && rec.status === 'in' && rec.showName && !rec.under18 && rec.firstName) {
      var me = el('span', 'avatar' + size + ' avatar--me', String(rec.firstName).charAt(0).toUpperCase());
      me.style.setProperty('--avatar', 'var(--celery)');
      pile.appendChild(me);
      shown++;
    }
    var n = going(e);
    for (var i = 0; shown < 3 && i < 3 && i < n; i++, shown++) {
      var a = el('span', 'avatar' + size, INITIALS.charAt((h >> (i * 4)) % INITIALS.length));
      a.style.setProperty('--avatar', AVATAR_COLORS[(h + i) % AVATAR_COLORS.length]);
      pile.appendChild(a);
    }
    if (n > shown) pile.appendChild(el('span', 'facepile__more', '+' + (n - shown)));
    return pile;
  }
  function goingRow(e, opts) {
    var row = el('div', 'invite__going');
    row.setAttribute('data-rsvp-going', e.id);
    fillGoing(row, e, opts);
    return row;
  }
  /** (Re)fills an [data-rsvp-going] row: face pile, "{n} going (DEMO)", spots left or Full. */
  function fillGoing(row, e, opts) {
    row.textContent = '';
    var n = going(e);
    row.appendChild(facepile(e, opts));
    var c = el('span', 'invite__count', fill(label('going') || '{n} going (DEMO)', { n: n }));
    c.setAttribute('data-rsvp-count', e.id);
    row.appendChild(c);
    var left = (+e.capacity || 0) - n;
    if (isFull(e) || (+e.capacity && left <= 0)) row.appendChild(el('span', 'tag tag--outline', label('fullDemo') || 'Full (DEMO)'));
    else if (+e.capacity && left <= 6) row.appendChild(el('span', 'invite__left', label('spotsLeftDemo', { n: left })));
  }

  /* Photos below the fold get their src only when they come within 300 px of the viewport (native
     lazy loading starts far earlier and would spend the first view's request budget). */
  var io = null;
  function lazy(img, src, srcset) {
    if (!('IntersectionObserver' in w)) { img.srcset = srcset; img.src = src; return; }
    img.setAttribute('data-src', src); img.setAttribute('data-srcset', srcset);
    if (!io) io = new w.IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var im = en.target; io.unobserve(im);
        im.srcset = im.getAttribute('data-srcset'); im.src = im.getAttribute('data-src');
        im.removeAttribute('data-srcset'); im.removeAttribute('data-src');
      });
    }, { rootMargin: '300px 0px' });
    io.observe(img);
  }

  function cover(e, opts) {
    var c = el('div', 'invite__cover');
    var cv = e.cover || {}, l = lang(opts.lang);
    var usePhoto = cv.photo && cv.photo.id && !(cv.photo.card === false && opts.variant !== 'page');
    if (usePhoto) {
      duoDefs();
      var fig = el('figure', 'photo photo--duo');
      fig.setAttribute('data-duo', String(cv.token || '--violet').replace(/^--/, ''));
      if (cv.photo.lift) fig.style.setProperty('--duo-lift', String(cv.photo.lift));
      var img = d.createElement('img');
      var src = photoUrl(cv.photo.id, 640), srcset = [320, 640, 960, 1280].map(function (wd) { return photoUrl(cv.photo.id, wd) + ' ' + wd + 'w'; }).join(', ');
      img.sizes = opts.variant === 'hero' ? '(min-width: 1000px) 440px, 92vw' : '(min-width: 1000px) 380px, (min-width: 700px) 46vw, 92vw';
      img.width = cv.photo.width || 640;
      img.height = cv.photo.height || 427;
      img.alt = tx(cv.photo.alt, l);
      img.decoding = 'async';
      if (opts.eager) { img.setAttribute('fetchpriority', 'high'); img.srcset = srcset; img.src = src; }
      else { img.loading = 'lazy'; lazy(img, src, srcset); }
      img.setAttribute('data-photographer', cv.photo.photographer || '');
      img.setAttribute('data-source', cv.photo.page || '');
      fig.appendChild(img);
      fig.appendChild(el('span', 'tag tag--stock photo__tag', t('tag.stock') || 'Stock photo · not members'));
      c.appendChild(fig);
    } else {
      var title = el('p', 'invite__cover-title', tx(cv.short, l) || tx(e.share && e.share.title, l));
      title.setAttribute('aria-hidden', 'true');
      c.appendChild(title);
    }
    if (cv.sticker) {
      var st = el('span', 'sticker');
      st.setAttribute('data-sticker', cv.sticker);
      st.setAttribute('aria-hidden', 'true');
      c.appendChild(st);
    }
    var date = el('span', 'invite__date');
    date.appendChild(ticket(e, { lang: l }));
    c.appendChild(date);
    var tags = el('span', 'invite__tags');
    if (e.demo) tags.appendChild(el('span', 'tag tag--demo', label('demoEvent') || t('demo.badgeEvent') || 'DEMO event'));
    if (opts.isNew) tags.appendChild(el('span', 'tag tag--new', label('newTag')));
    c.appendChild(tags);
    return c;
  }

  function rsvpRow(e, opts) {
    var row = el('div', 'invite__rsvp');
    var sm = opts.variant === 'compact' ? ' btn--sm' : '';
    if (isPast(e)) { row.appendChild(el('p', 'small muted', label('past'))); }
    else {
      var a = el('a', 'btn btn--primary' + sm, isFull(e) ? (label('waitlist') || 'Join the waitlist') : (t('cta.imIn') || "I'm in"));
      a.href = joinHref(e);
      a.setAttribute('data-rsvp', e.id);
      if (YSD.rsvp && YSD.rsvp.decorate) YSD.rsvp.decorate(a);
      row.appendChild(a);
    }
    var det = el('a', 'btn btn--ghost' + sm, t('cta.details') || 'Details');
    det.href = url(e, opts);
    det.setAttribute('aria-label', (t('cta.details') || 'Details') + ': ' + tx(e.title, opts.lang));
    row.appendChild(det);
    return row;
  }

  function render(e, opts) {
    opts = opts || {};
    var l = lang(opts.lang), variant = opts.variant || 'invite';
    var art = el('article', 'invite' + (variant === 'compact' ? ' invite--compact' : variant === 'hero' ? ' invite--hero' : ''));
    var token = (e.cover && e.cover.token) || '--violet';
    art.style.setProperty('--duo', 'var(' + token + ')');
    art.setAttribute('data-duo', token.replace(/^--/, ''));
    art.setAttribute('data-event', e.id);
    art.setAttribute('data-kind', e.kind || '');
    art.setAttribute('data-city', e.city || '');
    art.setAttribute('data-lang', (e.language || []).join(' '));
    if (e.tone === 'calm') art.setAttribute('data-tone', 'calm');
    if (e.series) art.setAttribute('data-series', e.series);
    if (e.tentpole) art.setAttribute('data-tentpole', '');
    if (isTeen(e)) art.setAttribute('data-teen', '');
    if (opts.anchor) art.id = e.id;
    if (isPast(e)) art.setAttribute('data-state', 'past');
    art.appendChild(cover(e, opts));
    var body = el('div', 'invite__body');
    var sr = series(e, l);
    if (sr && variant !== 'compact') {
      var kick = el('p', 'invite__series' + (e.tentpole ? ' invite__series--tentpole' : ''));
      kick.appendChild(el('span', 'invite__series-name', e.tentpole && data().tentpole ? tx(data().tentpole.name, l) : (sr.short || sr.name)));
      var rec = e.tentpole && data().tentpole ? label('recurs', { recurs: tx(data().tentpole.recurs, l) }, l) : sr.recurs;
      if (rec) kick.appendChild(el('span', 'invite__series-recurs', rec));
      body.appendChild(kick);
    }
    var h = el('h' + Math.min(6, Math.max(2, opts.level || 3)), 'invite__title');
    var link = el('a', null, tx(e.title, l));
    link.href = url(e, { lang: l });
    h.appendChild(link);
    body.appendChild(h);
    var meta = el('ul', 'invite__meta');
    meta.appendChild(el('li', null, when(e, l)));
    meta.appendChild(el('li', null, [city(e, l), place(e, l)].filter(Boolean).join(' · ')));
    if (variant !== 'compact') meta.appendChild(el('li', null, tx(e.cost && e.cost.label, l) || t('event.free')));
    body.appendChild(meta);
    if (variant !== 'compact') {
      var vibes = el('ul', 'invite__vibes'), V = data().vibes || {};
      if (isTeen(e)) { var tli = el('li', 'invite__teen', label('teen', null, l)); tli.title = label('teenHint', null, l); vibes.appendChild(tli); }
      (e.vibes || []).slice(0, (variant === 'hero' ? 2 : 3) - (isTeen(e) ? 1 : 0)).forEach(function (v) { if (V[v]) vibes.appendChild(el('li', null, tx(V[v], l))); });
      if (vibes.childNodes.length) body.appendChild(vibes);
    }
    body.appendChild(goingRow(e, { size: 'sm' }));
    body.appendChild(rsvpRow(e, { variant: variant, lang: l }));
    art.appendChild(body);
    if (YSD.ui && YSD.ui.stickers) YSD.ui.stickers(art);
    return art;
  }


  /* ------------------------------------------------------------------ round 1: series, tentpole, teen, two-tone map */
  function isTeen(e) { return !!(e && e.ages && e.ages.guardian === false && (+e.ages.min || 14) < 18); }

  function series(x, l) {
    var id = typeof x === 'string' ? x : (x && x.series);
    var S = data().series || {}, r = id && S[id];
    if (!r) return null;
    var name = tx(r.name, l);
    return { id: id, name: name, short: tx(r.short, l) || name, recurs: r.recurs ? label('recurs', { recurs: tx(r.recurs, l) }, l) : '', blurb: tx(r.blurb, l) };
  }
  function seriesName(x, opts) { var r = series(x, opts && opts.lang); return r ? (opts && opts.short ? r.short : r.name) : ''; }
  /** Series with their dates. Default: only series with a visible upcoming event (the drop rules apply);
      { all: true } also returns series whose only dates are locked behind the drop (locked: true). */
  function seriesList(opts) {
    opts = opts || {};
    var S = data().series || {}, out = [];
    var vis = upcoming({}), every = all().filter(function (e) { return e.status !== 'cancelled' && !isPast(e); });
    Object.keys(S).forEach(function (id) {
      var r = series(id, opts.lang);
      var dates = vis.filter(function (e) { return e.series === id; });
      var later = every.filter(function (e) { return e.series === id && dates.indexOf(e) < 0; });
      if (!dates.length && !(opts.all && later.length)) return;
      r.dates = dates; r.next = dates[0] || null; r.locked = !dates.length; r.later = later;
      out.push(r);
    });
    out.sort(function (a, b) { var x = a.next || a.later[0], y = b.next || b.later[0]; return Date.parse(x.start) - Date.parse(y.start); });
    return out;
  }
  function tentpole(l) {
    var T = data().tentpole;
    if (!T) return null;
    var eds = all().filter(function (e) { return e.tentpole && e.status !== 'cancelled' && !isPast(e); })
      .sort(function (a, b) { return Date.parse(a.start) - Date.parse(b.start); });
    var open = drop.isOpen();
    var vis = eds.filter(function (e) { return open || !drop.isDropEvent(e); });
    return { id: T.id, name: tx(T.name, l), recurs: tx(T.recurs, l), tagline: tx(T.tagline, l), eyebrow: tx(T.eyebrow, l), next: vis[0] || null, editions: eds, demo: T.demo !== false };
  }

  /** Two-tone photo map (genz-brand-16): shadows go to --night, mid-tones to the event colour, highlights to a pale
      tint of it, so a dark interior no longer turns to olive mud under a multiply. One filter per cover colour. */
  var DUO = { celery: '#C8F03C', sky: '#4FD6FF', bubblegum: '#FF7AC6', violet: '#6A2BFF', tangerine: '#FF8B3D', sun: '#FFD23F',
    mint: '#7EE081', teal: '#00B3A6', orange: '#FF6B1A', hotpink: '#FF4FA3', lake: '#2236C9' };
  var NIGHT = [23, 11, 51];
  function rgb(hex) { var n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function duoTable(hex) {
    var c = rgb(hex), hi = c.map(function (v) { return Math.round(v + (255 - v) * 0.62); });
    return [0, 1, 2].map(function (i) { return [NIGHT[i], c[i], hi[i]].map(function (v) { return (v / 255).toFixed(3); }).join(' '); });
  }
  function duoMarkup() {
    var f = '';
    Object.keys(DUO).forEach(function (k) {
      var t = duoTable(DUO[k]);
      f += '<filter id="ysd-duo-' + k + '" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0 0 0 1 0"/>' +
        '<feComponentTransfer><feFuncR type="table" tableValues="' + t[0] + '"/><feFuncG type="table" tableValues="' + t[1] + '"/><feFuncB type="table" tableValues="' + t[2] + '"/></feComponentTransfer></filter>';
    });
    return '<svg id="ysd-duo-defs" width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute;width:0;height:0;overflow:hidden"><defs>' + f + '</defs></svg>';
  }
  function duoDefs() {
    try {
      if (!d.getElementById('ysd-duo-defs') && d.body) {
        var box = d.createElement('div');
        box.innerHTML = duoMarkup(); // static markup built from the constants above, no outside text
        d.body.appendChild(box.firstChild);
      }
      if (d.getElementById('ysd-duo-defs')) d.documentElement.setAttribute('data-duo-map', '');
    } catch (x) {}
  }

  function tokenOf(e) { return (e.cover && e.cover.token) || '--violet'; }
  function inkOn(token) { return /violet|lake|night/.test(token) ? 'light' : 'dark'; }

  /** The poster-grade tentpole band (right-wing-no-tentpole): a duotone type lock-up with the date ticket, the DEMO
      seats bar, a countdown and I'm in. Home and events both mount it; rsvp.js keeps the seats and the button live. */
  function renderTentpole(e, opts) {
    opts = opts || {};
    var l = lang(opts.lang), T = tentpole(l), tok = (data().tentpole && data().tentpole.token) || tokenOf(e);
    var art = el('article', 'tentpole');
    art.style.setProperty('--duo', 'var(' + tok + ')');
    art.setAttribute('data-duo', tok.replace(/^--/, ''));
    art.setAttribute('data-ink', inkOn(tok));
    art.setAttribute('data-event', e.id);
    var poster = el('div', 'tentpole__poster');
    poster.setAttribute('aria-hidden', 'true');
    var brand = el('p', 'tentpole__brand');
    String(T ? T.name : tx(e.title, l)).split(' ').forEach(function (w) { brand.appendChild(el('span', null, w)); });
    poster.appendChild(brand);
    var sr = series(e, l);
    poster.appendChild(el('p', 'tentpole__edition', sr && sr.id !== (T && T.id) ? sr.name : tx(e.cover && e.cover.short, l)));
    var tk = el('span', 'tentpole__ticket'); tk.appendChild(ticket(e, { lang: l })); poster.appendChild(tk);
    if (e.cover && e.cover.sticker) { var st = el('span', 'sticker tentpole__sticker'); st.setAttribute('data-sticker', e.cover.sticker); st.setAttribute('aria-hidden', 'true'); poster.appendChild(st); }
    art.appendChild(poster);

    var body = el('div', 'tentpole__body');
    var eb = el('p', 'tentpole__eyebrow');
    eb.appendChild(el('span', null, T ? T.eyebrow : ''));
    if (e.demo) { eb.appendChild(d.createTextNode(' ')); eb.appendChild(el('span', 'tag tag--demo', label('demoEvent', null, l))); }
    body.appendChild(eb);
    var h = el('h' + Math.min(6, Math.max(2, opts.level || 3)), 'tentpole__title');
    var a = el('a', null, tx(e.title, l)); a.href = url(e, { lang: l });
    h.appendChild(a);
    body.appendChild(h);
    if (T && T.tagline) body.appendChild(el('p', 'tentpole__tagline', T.tagline));
    var meta = el('ul', 'tentpole__meta');
    meta.appendChild(el('li', null, when(e, l)));
    meta.appendChild(el('li', null, [city(e, l), place(e, l)].filter(Boolean).join(' · ')));
    meta.appendChild(el('li', null, [tx(e.cost && e.cost.label, l) || t('event.free'), isTeen(e) ? label('teen', null, l) : ''].filter(Boolean).join(' · ')));
    body.appendChild(meta);
    var seats = el('div', 'tentpole__seats');
    seats.setAttribute('data-rsvp-seats', e.id);
    fillSeats(seats, e, l);
    body.appendChild(seats);
    var n = YSD.fmt && YSD.fmt.days ? YSD.fmt.days(String(e.start).slice(0, 10)) : NaN;
    if (!isNaN(n) && n >= 0) body.appendChild(el('p', 'tentpole__count', n === 0 ? label('today', null, l) : n === 1 ? label('dayToGo', null, l) : label('daysToGo', { n: n }, l)));
    var acts = rsvpRow(e, { variant: 'tentpole', lang: l });
    acts.className = 'tentpole__actions';
    var first = acts.querySelector('.btn--primary'); if (first) first.classList.add('btn--lg');
    var det = acts.querySelector('.btn--ghost'); if (det) det.classList.add('btn--lg');
    body.appendChild(acts);
    if (T && T.editions.length > 1) {
      var more = T.editions.filter(function (x) { return x.id !== e.id; }).slice(0, 2).map(function (x) {
        var f = YSD.fmt && YSD.fmt.date ? YSD.fmt.date(x.start, { lang: l }) : tx(x.when, l);
        return f + ' · ' + city(x, l);
      });
      body.appendChild(el('p', 'tentpole__recurs', label('recurs', { recurs: T.recurs }, l) + (more.length ? ' · ' + more.join(', ') : '')));
    }
    art.appendChild(body);
    if (YSD.ui && YSD.ui.stickers) YSD.ui.stickers(art);
    return art;
  }
  /** (Re)fills a [data-rsvp-seats] box: a bar and "{n} of {cap} seats saved (DEMO)". */
  function fillSeats(box, e, l) {
    box.textContent = '';
    var n = going(e), cap = +e.capacity || 0;
    if (!cap) return;
    var bar = el('span', 'tentpole__bar'); bar.setAttribute('aria-hidden', 'true');
    var fillEl = el('span'); fillEl.style.setProperty('--fill', Math.max(4, Math.min(100, Math.round(n / cap * 100))) + '%');
    bar.appendChild(fillEl);
    box.appendChild(bar);
    box.appendChild(el('span', 'tentpole__seats-label', label('seats', { n: n, cap: cap }, l)));
  }

  YSD.events = {
    all: all, get: get, upcoming: upcoming, render: render, ticket: ticket, cal: cal, url: url, path: path,
    drop: drop, isPast: isPast, isFull: isFull, when: when, place: place, city: city, label: label,
    fillGoing: fillGoing, facepile: facepile, photoUrl: photoUrl, joinHref: joinHref, rootPrefix: rootPrefix,
    series: series, seriesName: seriesName, seriesList: seriesList, tentpole: tentpole, renderTentpole: renderTentpole,
    fillSeats: fillSeats, isTeen: isTeen, duoDefs: duoDefs, duoMarkup: duoMarkup, calLocation: calLocation
  };
})(window, document);
