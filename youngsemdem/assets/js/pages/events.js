/*! YDSC · assets/js/pages/events.js (W2; round 1 by G-EVENTS, Tue Nov 10, 2026). The events list: the ticket-stack
 * hero, the Seminole Sunday tentpole band, filters, the lineup, the named-series shelf, the January drop, REAL partner
 * events. Rendering comes from YSD.events (eventcard.js); RSVP state and the sheet come from YSD.rsvp (rsvp.js).
 * Filters live in the URL (?kind=volunteer&city=sanford&lang=es&teen=1) so a filtered list can be shared;
 * ?drop=open previews the January drop. ?series=<id> (a data/events.js series, e.g. ?series=trivia from the quiz's
 * "Events made for you" chips, or ?series=seminole-sunday) narrows the lineup to that format and shows a chip above
 * the count that clears it. When a filter matches nothing that's open yet but matches events locked behind the drop,
 * the empty state shows the drop teaser, Notify me and the next open night of the same kind (journeys-05,
 * right-wing-quiz-deadends). No network calls, no AI.
 */
(function (w, d) {
  'use strict';
  var YSD = w.YSD = w.YSD || {};
  function $(s, r) { return (r || d).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || d).querySelectorAll(s)); }
  function t(k, v) { return YSD.t ? YSD.t(k, v) : ''; }
  function lang() { return YSD.lang || 'en'; }
  function data() { return (w.YSD_DATA && w.YSD_DATA.events) || { items: [] }; }
  function tx(o) { return o ? (o[lang()] != null ? o[lang()] : o.en || '') : ''; }
  function el(tag, cls, text) { var n = d.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function track(e, p) { try { if (YSD.track) YSD.track(e, p); } catch (x) {} }
  function sget(k, f) { try { return YSD.store ? YSD.store.get(k, f) : f; } catch (e) { return f; } }
  function sset(k, v) { try { if (YSD.store) YSD.store.set(k, v); } catch (e) {} }
  function fmtDate(iso) { return YSD.fmt && YSD.fmt.date ? YSD.fmt.date(iso) : iso; }

  var E, filters = { kind: '', city: '', lang: '', series: '', teen: '' };
  function noFilters() { return { kind: '', city: '', lang: '', series: '', teen: '' }; }
  function anyFilter() { return !!(filters.kind || filters.city || filters.lang || filters.series || filters.teen); }
  function tentId() { var T = data().tentpole; return T ? T.id : ''; }
  function knownSeries() {
    var k = {};
    Object.keys(data().series || {}).forEach(function (id) { k[id] = 1; });
    (data().items || []).forEach(function (e) { if (e && e.series) k[e.series] = 1; });
    if (tentId()) k[tentId()] = 1;
    return k;
  }
  function seriesLabel(id) {
    if (id && id === tentId()) return tx(data().tentpole.name);
    var s = E.seriesName ? E.seriesName(id, { short: true }) : '';
    if (s) return s;
    var items = data().items || [];
    for (var i = 0; i < items.length; i++) if (items[i].series === id) return tx(items[i].cover && items[i].cover.short) || tx(items[i].title);
    return id;
  }
  function inSeries(e, id) { return e.series === id || (id === tentId() && !!e.tentpole); }
  function matches(e) {
    if (filters.series && !inSeries(e, filters.series)) return false;
    if (filters.teen && !E.isTeen(e)) return false;
    return true;
  }

  function readUrl() {
    var p = {};
    String(w.location.search || '').replace(/^\?/, '').split('&').forEach(function (kv) {
      var i = kv.indexOf('='); if (i < 0) return;
      try { p[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' ')); } catch (e) {}
    });
    var kinds = ['social', 'learn', 'volunteer', 'create'];
    filters.kind = kinds.indexOf(p.kind) >= 0 ? p.kind : '';
    filters.city = (data().cities || {})[p.city] ? p.city : '';
    filters.lang = p.lang === 'es' ? 'es' : '';
    filters.series = p.series && knownSeries()[p.series] ? p.series : '';
    filters.teen = p.teen === '1' ? '1' : '';
  }
  function writeUrl() {
    try {
      var u = new w.URL(w.location.href);
      ['kind', 'city', 'lang', 'series', 'teen'].forEach(function (k) { if (filters[k]) u.searchParams.set(k, filters[k]); else u.searchParams['delete'](k); });
      w.history.replaceState(null, '', u.pathname + u.search + u.hash);
    } catch (e) {}
  }
  function inkFor(token) { return /violet|lake/.test(token || '') ? 'light' : 'dark'; }

  /* ------------------------------------------------------------------ hero: the ticket stack (the big one up front) */
  function heroStack() {
    var box = $('[data-stack]'); if (!box) return;
    var T = E.tentpole ? E.tentpole() : null;
    var list = E.upcoming({ limit: 4 });
    var big = T && T.next;
    var others = list.filter(function (e) { return !big || e.id !== big.id; }).slice(0, big ? 2 : 3);
    var stack = others.slice(0, 2).reverse();          // back cards first; the front card is last in the DOM
    var front = big || others[2] || others[0];
    if (!big && others.length >= 3) { stack = [others[2], others[1]]; front = others[0]; }
    box.textContent = '';
    stack.concat(front ? [front] : []).forEach(function (e) {
      if (!e) return;
      var li = el('li', 'ev-tk'), a = el('a', 'ev-tk__link');
      var tok = (e.cover && e.cover.token) || '--celery';
      li.style.setProperty('--duo', 'var(' + tok + ')');
      li.setAttribute('data-ink', inkFor(tok));
      if (e === front && big) li.setAttribute('data-big', '');
      a.href = e === front && big ? '#big-one' : '#' + e.id;
      var tk = E.ticket(e);
      a.appendChild(tk);
      var nm = el('span', 'ev-tk__name', e === front && big ? T.name : (E.seriesName(e, { short: true }) || tx(e.cover && e.cover.short)));
      nm.setAttribute('aria-hidden', 'true');
      a.appendChild(nm);
      a.appendChild(el('span', 'ev-tk__city', E.city(e)));
      if (e === front && big) a.appendChild(el('span', 'ev-tk__flag', t('events:hero.bigOne') || T.eyebrow));
      a.appendChild(el('span', 'u-visually-hidden', ', ' + tx(e.title) + ', ' + E.when(e)));
      li.appendChild(a);
      box.appendChild(li);
    });
    if (!box.children.length) box.hidden = true;
  }

  /* ------------------------------------------------------------------ the tentpole band */
  function tentBand() {
    var sec = $('[data-tentpole-band]'), box = $('[data-tentpole]');
    if (!sec || !box || !E.tentpole || !E.renderTentpole) return;
    var T = E.tentpole();
    if (!T || !T.next) { sec.hidden = true; return; }
    box.textContent = '';
    box.appendChild(E.renderTentpole(T.next, { level: 2 }));
    sec.hidden = false;
  }

  /* ------------------------------------------------------------------ filters + lineup */
  function cityChips() {
    var row = $('[data-city-chips]'); if (!row) return;
    var C = data().cities || {}, used = {};
    E.all().forEach(function (e) { used[e.city] = 1; });
    Object.keys(C).forEach(function (id) {
      if (!used[id]) return;
      var lab = el('label', 'chip'), inp = d.createElement('input');
      inp.type = 'radio'; inp.name = 'city'; inp.value = id;
      lab.appendChild(inp); lab.appendChild(el('span', null, tx(C[id])));
      row.appendChild(lab);
    });
  }
  function syncForm() {
    var f = $('[data-filters]'); if (!f) return;
    $$('input[name="kind"]', f).forEach(function (i) { i.checked = i.value === filters.kind; });
    $$('input[name="city"]', f).forEach(function (i) { i.checked = i.value === filters.city; });
    var es = $('input[name="lang"]', f); if (es) es.checked = filters.lang === 'es';
    var tn = $('input[name="teen"]', f); if (tn) tn.checked = filters.teen === '1';
  }
  /** The ?series= chip: "Only showing [Trivia Thursday ×]". One tap clears it; it is gone when no series is set. */
  function seriesChip() {
    var count = $('[data-count]');
    var box = $('[data-series-filter]');
    if (!box && count && filters.series) {
      box = el('p', 'cluster cluster--sm ev-serieschip');
      box.setAttribute('data-series-filter', '');
      count.parentNode.insertBefore(box, count);
    }
    if (!box) return;
    box.textContent = '';
    box.hidden = !filters.series;
    if (!filters.series) return;
    var name = seriesLabel(filters.series);
    box.appendChild(el('span', null, t('events:filter.seriesOnly')));
    var b = el('button', 'chip');
    b.type = 'button';
    b.setAttribute('data-series-clear', '');
    b.setAttribute('aria-label', t('events:filter.seriesClear', { series: name }) || name);
    b.appendChild(el('span', null, name));
    var x = el('span', null, '×'); x.setAttribute('aria-hidden', 'true');
    b.appendChild(x);
    b.addEventListener('click', function () {
      filters.series = '';
      writeUrl(); lineup();
      var first = $('input[name="kind"]:checked') || $('input[name="kind"]'); if (first) first.focus();
      track('events_series_clear', {});
    });
    box.appendChild(b);
  }
  function filtered(opts) {
    return E.upcoming({ kind: filters.kind, city: filters.city, lang: filters.lang, includeDrop: !!(opts && opts.includeDrop) }).filter(matches);
  }
  function lineup() {
    var grid = $('[data-lineup]'), empty = $('[data-empty]'), count = $('[data-count]');
    if (!grid) return;
    seriesChip();
    var list = filtered();
    var dropOpen = E.drop.isOpen();
    grid.textContent = '';
    list.forEach(function (e) {
      grid.appendChild(E.render(e, { variant: 'invite', level: 3, anchor: true, isNew: dropOpen && E.drop.isDropEvent(e) }));
    });
    var dropEvs = E.drop.events();
    if (!dropOpen && dropEvs.length && !anyFilter() && E.drop.cfg()) grid.appendChild(dropTile(dropEvs));
    if (count) count.textContent = YSD.t && YSD.t.plural ? YSD.t.plural('events:count', list.length) : String(list.length);
    if (empty) {
      empty.hidden = list.length > 0;
      var clear = $('[data-clear]', empty); if (clear) clear.hidden = !anyFilter();
      emptyDrop(empty, list.length);
    }
  }
  /** Empty, but the drop has matches: "Karaoke is in January's lineup. It drops Tue, Dec 15 at noon (DEMO)." + Notify
      me (.ics) + the next open night of the same kind. Never says "this week" (journeys-05). */
  function emptyDrop(empty, n) {
    var box = $('[data-empty-drop]', empty), title = $('[data-empty-title]', empty), line = $('[data-empty-line]', empty);
    if (!box) return;
    box.textContent = '';
    box.hidden = true;
    if (title) title.textContent = t('events:empty.title');
    if (line) { line.textContent = t('events:empty.line'); line.hidden = false; }
    if (n || E.drop.isOpen() || !E.drop.cfg()) return;
    var locked = filtered({ includeDrop: true }).filter(function (e) { return E.drop.isDropEvent(e); });
    if (!locked.length) return;
    var name = filters.series ? seriesLabel(filters.series) : '';
    if (title) title.textContent = t('events:empty.dropTitle');
    if (line) line.textContent = name ? E.label('dropSeries', { series: name }) : tx(E.drop.cfg().label);
    var tickets = el('div', 'ev-empty__tickets'); tickets.setAttribute('aria-hidden', 'true');
    locked.slice(0, 3).forEach(function (e, i) {
      var tk = E.ticket(e);
      tk.style.setProperty('--duo', 'var(' + ((e.cover && e.cover.token) || '--celery') + ')');
      tk.style.setProperty('--rot', (i - 1) * 6 + 'deg');
      if (inkFor(e.cover && e.cover.token) === 'light') tk.setAttribute('data-ink', 'light');
      tickets.appendChild(tk);
    });
    box.appendChild(tickets);
    var nb = el('button', 'btn btn--primary', '');
    nb.type = 'button';
    nb.setAttribute('data-empty-notify', '');
    paintNotify(nb);
    nb.addEventListener('click', function () { notify(nb); });
    box.appendChild(nb);
    // the next open night of the same kind (or the next open night at all)
    var kind = filters.kind || (locked[0] && locked[0].kind);
    var open = E.upcoming({}).filter(function (e) { return e.kind === kind; })[0] || E.upcoming({})[0];
    if (open) {
      box.appendChild(el('p', 'ev-empty__next', t('events:empty.next')));
      box.appendChild(E.render(open, { variant: 'compact', level: 3 }));
    }
    box.hidden = false;
  }
  /** The last tile in the lineup while the drop is closed: a locked teaser that jumps to the drop band. */
  function dropTile(evs) {
    var a = el('a', 'ev-droptile');
    a.href = '#drop';
    var tk = el('span', 'ev-droptile__tickets'); tk.setAttribute('aria-hidden', 'true');
    evs.slice(0, 3).forEach(function (e, i) {
      var t0 = E.ticket(e), day = $('.ticket__day', t0), tm = $('.ticket__time', t0);
      if (day) day.textContent = '?'; if (tm) tm.textContent = '· · ·';
      t0.style.setProperty('--rot', (i - 1) * 7 + 'deg');
      t0.style.setProperty('--duo', 'var(' + ((e.cover && e.cover.token) || '--celery') + ')');
      if (inkFor(e.cover && e.cover.token) === 'light') t0.setAttribute('data-ink', 'light');
      tk.appendChild(t0);
    });
    a.appendChild(tk);
    a.appendChild(el('span', 'ev-droptile__title', t('events:drop.tile.title', { count: evs.length })));
    a.appendChild(el('span', 'ev-droptile__sub', tx(E.drop.cfg().label)));
    a.appendChild(el('span', 'ev-droptile__cta', t('events:drop.tile.cta')));
    return a;
  }

  function wireFilters() {
    var f = $('[data-filters]'); if (!f) return;
    f.addEventListener('change', function (evt) {
      var i = evt.target;
      if (i.name === 'kind') filters.kind = i.value;
      else if (i.name === 'city') filters.city = i.value;
      else if (i.name === 'lang') filters.lang = i.checked ? 'es' : '';
      else if (i.name === 'teen') filters.teen = i.checked ? '1' : '';
      writeUrl();
      lineup();
      if (i.name === 'teen' && i.checked) track('events_teen_filter', {});
    });
    f.addEventListener('submit', function (evt) { evt.preventDefault(); });
    var clear = $('[data-clear]');
    if (clear) clear.addEventListener('click', function () {
      filters = noFilters();
      syncForm(); writeUrl(); lineup();
      var first = $('input[name="kind"]', f); if (first) first.focus();
    });
  }

  /* ------------------------------------------------------------------ the named series shelf (genz-brand-27) */
  function seriesShelf() {
    var sec = $('[data-series-shelf]'), list = $('[data-series-list]');
    if (!sec || !list || !E.seriesList) return;
    var all = E.seriesList({ all: true }).filter(function (s) { return s.id !== tentId(); });
    if (!all.length) { sec.hidden = true; return; }
    // recurring formats first, then by next date
    all.sort(function (a, b) { return (b.recurs ? 1 : 0) - (a.recurs ? 1 : 0); });
    list.textContent = '';
    all.forEach(function (s) {
      var first = s.next || s.later[0];
      var tok = (first.cover && first.cover.token) || '--celery';
      var li = el('li', 'ev-sr');
      li.style.setProperty('--duo', 'var(' + tok + ')');
      li.setAttribute('data-ink', inkFor(tok));
      var a = el('a', 'ev-sr__link');
      a.href = '?series=' + encodeURIComponent(s.id) + '#lineup';
      a.setAttribute('data-series-link', s.id);
      var top = el('span', 'ev-sr__top');
      var st = el('span', 'sticker sticker--sm ev-sr__sticker'); st.setAttribute('data-sticker', (first.cover && first.cover.sticker) || 'calendar'); st.setAttribute('aria-hidden', 'true');
      top.appendChild(st);
      var n = s.dates.length + s.later.length;
      top.appendChild(el('span', 'ev-sr__count', YSD.t && YSD.t.plural ? YSD.t.plural('events:series.dates', n) : String(n)));
      a.appendChild(top);
      a.appendChild(el('span', 'ev-sr__name', s.name));
      if (s.recurs) a.appendChild(el('span', 'ev-sr__recurs', s.recurs));
      if (s.blurb) a.appendChild(el('span', 'ev-sr__blurb', s.blurb));
      a.appendChild(el('span', 'ev-sr__next', s.next ? t('events:series.next', { date: fmtDate(s.next.start) }) : t('events:series.locked')));
      li.appendChild(a);
      list.appendChild(li);
    });
    list.addEventListener('click', function (evt) {
      var a = evt.target.closest && evt.target.closest('[data-series-link]');
      if (!a) return;
      evt.preventDefault();
      filters = noFilters(); filters.series = a.getAttribute('data-series-link');
      syncForm(); writeUrl(); lineup();
      if (YSD.ui && YSD.ui.jump) YSD.ui.jump('#lineup'); else { var lu = d.getElementById('lineup'); if (lu) lu.scrollIntoView(); }
      track('events_series_pick', { series: filters.series });
    });
    if (YSD.ui && YSD.ui.stickers) YSD.ui.stickers(list);
    sec.hidden = false;
  }

  /* ------------------------------------------------------------------ the January drop */
  function notifyOn() { return !!sget('drop:notify', null); }
  function paintNotify(btn) {
    var on = notifyOn();
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    var lab = $('[data-drop-notify-label]', btn) || btn;
    lab.textContent = on ? t('events:drop.notified') : t('events:drop.notify');
  }
  function notify(btn) {
    var cfg = E.drop.cfg(); if (!cfg) return;
    var start = cfg.opensAt, end = new Date(Date.parse(start) + 30 * 60000).toISOString();
    var link = YSD.share && YSD.share.url ? YSD.share.url((lang() === 'es' ? 'es/' : '') + 'events.html', { ref: false, utm: false }) : '';
    var ok = YSD.cal && YSD.cal.download({ id: 'ydsc-drop-2026-12-15', title: tx(cfg.calTitle), start: start, end: end, description: tx(cfg.calDescription), url: link, alarm: 15 });
    sset('drop:notify', Date.now());
    $$('[data-drop-notify], [data-empty-notify]').forEach(paintNotify);
    btn.setAttribute('data-state', 'pressed'); setTimeout(function () { btn.removeAttribute('data-state'); }, 160);
    if (YSD.ui) YSD.ui.toast(ok === false ? t('toast.shareFailed') : t('events:drop.notifiedToast'), { tone: ok === false ? 'error' : 'success', priority: 'high' });
    track('drop_notify', {});
  }
  function dropBand() {
    var band = $('[data-drop]'); if (!band) return;
    var cfg = E.drop.cfg();
    var evs = E.drop.events();
    if (!cfg || !evs.length) { band.hidden = true; return; }
    var open = E.drop.isOpen();
    var title = $('[data-drop-title]', band), sub = $('[data-drop-sub]', band);
    var btn = $('[data-drop-notify]', band), cd = $('.ev-drop__count', band);
    var tickets = $('[data-drop-tickets]', band), cnt = $('[data-drop-count]', band);
    tickets.textContent = '';
    evs.forEach(function (e, i) {
      var li = el('li', 'ev-drop__t');
      li.style.setProperty('--duo', 'var(' + ((e.cover && e.cover.token) || '--celery') + ')');
      li.style.setProperty('--rot', ((i % 3) - 1) * 4 + 'deg');
      if (inkFor(e.cover && e.cover.token) === 'light') li.setAttribute('data-ink', 'light');
      var tk = E.ticket(e);
      if (!open) { var day = $('.ticket__day', tk); if (day) day.textContent = '?'; var tm = $('.ticket__time', tk); if (tm) tm.textContent = '· · ·'; }
      li.appendChild(tk);
      tickets.appendChild(li);
    });
    if (open) {
      band.setAttribute('data-state', 'open');
      title.textContent = t('events:drop.liveTitle');
      sub.textContent = t('events:drop.liveSub');
      if (cd) cd.hidden = true;
      if (btn) btn.closest('.btn-row').hidden = true;
      cnt.textContent = '';
      return;
    }
    cnt.textContent = t('events:drop.locked', { count: evs.length });
    if (!btn) return;
    paintNotify(btn);
    btn.addEventListener('click', function () { notify(btn); });
  }

  /* ------------------------------------------------------------------ REAL partner events */
  function real() {
    var sec = $('[data-real]'), list = $('[data-real-list]');
    if (!sec || !list) return;
    var now = Date.now();
    var items = (data().partners || []).filter(function (p) { return p.real && now < Date.parse(p.end); })
      .sort(function (a, b) { return Date.parse(a.start) - Date.parse(b.start); }).slice(0, 3);
    if (!items.length) { sec.hidden = true; return; }
    list.textContent = '';
    items.forEach(function (p) {
      var li = el('li', 'ev-real__item');
      li.appendChild(E.ticket(p));
      var body = el('div', 'ev-real__body');
      var h = el('h3', 'ev-real__title'); h.appendChild(el('span', null, tx(p.title))); h.appendChild(d.createTextNode(' ')); h.appendChild(el('span', 'tag tag--real', t('tag.real') || 'REAL'));
      body.appendChild(h);
      body.appendChild(el('p', 'ev-real__when', E.when(p) + ' · ' + tx((data().cities || {})[p.city])));
      body.appendChild(el('p', 'ev-real__detail', tx(p.detail)));
      var a = el('a', 'link link--out', t('events:real.link'));
      a.href = p.url; a.rel = 'noopener'; a.target = '_blank';
      a.setAttribute('aria-label', t('events:real.link') + ': ' + tx(p.title) + ', ' + E.when(p));
      body.appendChild(a);
      li.appendChild(body);
      list.appendChild(li);
    });
  }

  function jumpToHash() {
    var id = String(w.location.hash || '').slice(1);
    if ((!id || id === 'lineup') && (filters.series || filters.teen)) { var lu = d.getElementById('lineup'); if (lu) lu.scrollIntoView({ block: 'start' }); return; }   // ?series= lands on the filtered lineup
    if (!id) return;
    var target = d.getElementById(id);
    if (target && target.classList.contains('invite')) target.scrollIntoView({ block: 'start' });
  }

  function init() {
    E = YSD.events;
    if (!E) return;
    readUrl();
    cityChips();
    syncForm();
    heroStack();
    tentBand();
    wireFilters();
    lineup();
    seriesShelf();
    dropBand();
    real();
    if (YSD.ui && YSD.ui.stickers) YSD.ui.stickers(d);
    if (YSD.rsvp) YSD.rsvp.refresh();
    jumpToHash();
  }
  if (YSD.ui && YSD.ui.ready) YSD.ui.ready(init); else if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', init); else init();
})(window, document);
