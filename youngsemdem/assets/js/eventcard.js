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
 *
 * Fields an event needs (keep these in any slice, e.g. W1's data/slices/home.js):
 *   id, demo, status, kind, tone, title{}, start, end, city, place{ kind, name{} }, language[],
 *   vibes[], cost{ label{} }, capacity, going, cover{ token, sticker, short{}, photo? }, share{ title{},
 *   text{} }, calDescription{}, ages{ guardian }; plus labels{}, cities{}, vibes{}, schedule.drop.
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
  function label(key, vars, l) {
    var L = data().labels || {};
    return fill(tx(L[key], l), vars);
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
      location: [tx(p.name, l), city(e, l)].filter(Boolean).join(', '),
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
    if (cv.photo && cv.photo.id) {
      var fig = el('figure', 'photo photo--duo');
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
    if (opts.anchor) art.id = e.id;
    if (isPast(e)) art.setAttribute('data-state', 'past');
    art.appendChild(cover(e, opts));
    var body = el('div', 'invite__body');
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
      (e.vibes || []).slice(0, variant === 'hero' ? 2 : 3).forEach(function (v) { if (V[v]) vibes.appendChild(el('li', null, tx(V[v], l))); });
      if (vibes.childNodes.length) body.appendChild(vibes);
    }
    body.appendChild(goingRow(e, { size: 'sm' }));
    body.appendChild(rsvpRow(e, { variant: variant, lang: l }));
    art.appendChild(body);
    if (YSD.ui && YSD.ui.stickers) YSD.ui.stickers(art);
    return art;
  }

  YSD.events = {
    all: all, get: get, upcoming: upcoming, render: render, ticket: ticket, cal: cal, url: url, path: path,
    drop: drop, isPast: isPast, isFull: isFull, when: when, place: place, city: city, label: label,
    fillGoing: fillGoing, facepile: facepile, photoUrl: photoUrl, joinHref: joinHref, rootPrefix: rootPrefix
  };
})(window, document);
