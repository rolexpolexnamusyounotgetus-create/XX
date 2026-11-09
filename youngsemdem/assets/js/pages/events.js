/*! YDSC · assets/js/pages/events.js (W2). The events list: next-up card, ticket rail, filters, the lineup,
 * the January drop, REAL partner events. Rendering comes from YSD.events (eventcard.js); RSVP state and the
 * sheet come from YSD.rsvp (rsvp.js). Filters live in the URL (?kind=volunteer&city=sanford&lang=es) so a
 * filtered list can be shared; ?drop=open previews the January drop. ?series=<id> (a data/events.js series,
 * e.g. ?series=trivia from the quiz's "Events made for you" chips) narrows the lineup to that format and shows
 * a chip above the count that clears it. No network calls, no AI.
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

  var E, filters = { kind: '', city: '', lang: '', series: '' };
  function noFilters() { return { kind: '', city: '', lang: '', series: '' }; }
  function anyFilter() { return !!(filters.kind || filters.city || filters.lang || filters.series); }
  function knownSeries() { var k = {}; (data().items || []).forEach(function (e) { if (e && e.series) k[e.series] = 1; }); return k; }
  function seriesLabel(id) {
    var s = t('events:series.' + id);
    if (s) return s;
    var items = data().items || [];
    for (var i = 0; i < items.length; i++) if (items[i].series === id) return tx(items[i].cover && items[i].cover.short) || tx(items[i].title);
    return id;
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
  }
  function writeUrl() {
    try {
      var u = new w.URL(w.location.href);
      ['kind', 'city', 'lang', 'series'].forEach(function (k) { if (filters[k]) u.searchParams.set(k, filters[k]); else u.searchParams['delete'](k); });
      w.history.replaceState(null, '', u.pathname + u.search + u.hash);
    } catch (e) {}
  }

  /* ------------------------------------------------------------------ hero: next up + ticket rail */
  function hero() {
    var next = E.upcoming({ limit: 1 })[0];
    var box = $('[data-hero-next]');
    if (box && next) {
      box.textContent = '';
      box.appendChild(el('p', 'ev-hero__label', t('events:hero.next')));
      box.appendChild(E.render(next, { variant: 'hero', level: 2, eager: false }));
    }
    var rail = $('[data-rail]');
    if (!rail) return;
    var list = E.upcoming({ limit: 6 });
    rail.textContent = '';
    list.forEach(function (e, i) {
      var li = el('li'), a = el('a', 'ev-rail__t');
      a.href = '#' + e.id;
      a.style.setProperty('--duo', 'var(' + ((e.cover && e.cover.token) || '--celery') + ')');
      a.style.setProperty('--rot', (i % 2 ? 3 : -3) + 'deg');
      if (e.cover && e.cover.token === '--violet') a.setAttribute('data-ink', 'light');
      a.appendChild(E.ticket(e));
      a.appendChild(el('span', 'u-visually-hidden', tx(e.title) + ', ' + E.when(e)));
      li.appendChild(a);
      rail.appendChild(li);
    });
    if (!list.length) rail.hidden = true;
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
  }
  /** The ?series= chip: "Only showing [Trivia nights ×]". One tap clears it; it is gone when no series is set. */
  function seriesChip() {
    var count = $('[data-count]');
    var box = $('[data-series-filter]');
    if (!box && count && filters.series) {
      box = el('p', 'cluster cluster--sm');
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
  function lineup() {
    var grid = $('[data-lineup]'), empty = $('[data-empty]'), count = $('[data-count]');
    if (!grid) return;
    seriesChip();
    var list = E.upcoming({ kind: filters.kind, city: filters.city, lang: filters.lang }).filter(function (e) { return !filters.series || e.series === filters.series; });
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
      var line = $('[data-empty-line]', empty); if (line) line.textContent = E.label('empty');
      var clear = $('[data-clear]', empty); if (clear) clear.hidden = !anyFilter();
    }
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
      if (e.cover && e.cover.token === '--violet') t0.setAttribute('data-ink', 'light');
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
      writeUrl();
      lineup();
    });
    f.addEventListener('submit', function (evt) { evt.preventDefault(); });
    var clear = $('[data-clear]');
    if (clear) clear.addEventListener('click', function () {
      filters = noFilters();
      syncForm(); writeUrl(); lineup();
      var first = $('input[name="kind"]', f); if (first) first.focus();
    });
  }

  /* ------------------------------------------------------------------ the January drop */
  function dropBand() {
    var band = $('[data-drop]'); if (!band) return;
    var cfg = E.drop.cfg();
    var evs = E.drop.events();
    if (!cfg || !evs.length) { band.hidden = true; return; }
    var open = E.drop.isOpen();
    var title = $('[data-drop-title]', band), sub = $('[data-drop-sub]', band);
    var notify = $('[data-drop-notify]', band), cd = $('.ev-drop__count', band);
    var tickets = $('[data-drop-tickets]', band), cnt = $('[data-drop-count]', band);
    tickets.textContent = '';
    evs.forEach(function (e, i) {
      var li = el('li', 'ev-drop__t');
      li.style.setProperty('--duo', 'var(' + ((e.cover && e.cover.token) || '--celery') + ')');
      li.style.setProperty('--rot', ((i % 3) - 1) * 4 + 'deg');
      if (e.cover && e.cover.token === '--violet') li.setAttribute('data-ink', 'light');
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
      if (notify) notify.closest('.btn-row').hidden = true;
      cnt.textContent = '';
      return;
    }
    cnt.textContent = t('events:drop.locked', { count: evs.length });
    if (!notify) return;
    var label = $('[data-drop-notify-label]', notify);
    function paint() {
      var on = !!sget('drop:notify', null);
      notify.setAttribute('aria-pressed', on ? 'true' : 'false');
      label.textContent = on ? t('events:drop.notified') : t('events:drop.notify');
    }
    paint();
    notify.addEventListener('click', function () {
      var start = cfg.opensAt, end = new Date(Date.parse(start) + 30 * 60000).toISOString();
      var link = YSD.share && YSD.share.url ? YSD.share.url((lang() === 'es' ? 'es/' : '') + 'events.html', { ref: false, utm: false }) : '';
      var ok = YSD.cal && YSD.cal.download({ id: 'ydsc-drop-2026-12-15', title: tx(cfg.calTitle), start: start, end: end, description: tx(cfg.calDescription), url: link, alarm: 15 });
      sset('drop:notify', Date.now());
      paint();
      notify.setAttribute('data-state', 'pressed'); setTimeout(function () { notify.removeAttribute('data-state'); }, 160);
      if (YSD.ui) YSD.ui.toast(ok === false ? t('toast.shareFailed') : t('events:drop.notifiedToast'), { tone: ok === false ? 'error' : 'success' });
      track('drop_notify', {});
    });
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
    if (!id && filters.series) { var lu = d.getElementById('lineup'); if (lu) lu.scrollIntoView({ block: 'start' }); return; }   // ?series= lands on the filtered lineup
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
    hero();
    wireFilters();
    lineup();
    dropBand();
    real();
    if (YSD.ui && YSD.ui.stickers) YSD.ui.stickers(d);
    if (YSD.rsvp) YSD.rsvp.refresh();
    jumpToHash();
  }
  if (YSD.ui && YSD.ui.ready) YSD.ui.ready(init); else if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', init); else init();
})(window, document);
