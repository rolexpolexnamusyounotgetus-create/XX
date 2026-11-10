/*! assets/js/pages/vote.js · W3 (round 1 rework: G-VOTE) · the "2027 Ready" vote hub (vote.html).
 * Renders steps, key dates, the plan builder, the private checklist, the FAQ, hotlines and the share cards from
 * data/civic.js (the single source for voting facts). Static copy lives in vote.html + data/pages/vote.js; this
 * file never types a voting URL: every link is YSD.cfg(link.key, link.url) from civic.links (config wins).
 *
 * Round 1 (docs/reviews/round-1): steps sit behind a "How do you want to vote?" switch (3 open steps for the
 * chosen method, the other 5 folded below; every step keeps id="<step.id>" so old links still land), the
 * checklist is the "Done" ticks on the steps plus one count line, dates show 3 then "Show all", the FAQ shows 4
 * then "Show all", and the Dec 31 / Jan 1 tiles open a sheet that renders a 9:16 or 4:5 card (YSD.cards:
 * w3-dates, w3-psa-mail, w3-psa-id), rendered before the share click. A mail voter's plan .ics carries the
 * 7 pm ARRIVAL deadline and a separate "Mail your ballot today" event a week earlier (journeys-17).
 *
 * Storage (YSD.store, prefixed ysd:): vote:checklist { stepId: ts }, vote:plan { answer ids, ts },
 * vote:method ('mail'|'early'|'election-day'); never an address, birth date or party. Civic steps earn nothing:
 * no points, stickers or confetti.
 * Testing: ?now=2027-01-02 previews the page on another day (flips the mail card, hides expired dates).
 */
(function (w, d) {
  'use strict';
  var YSD = w.YSD = w.YSD || {};
  var C = (w.YSD_DATA || {}).civic;
  if (!C) return;
  var L = YSD.lang === 'es' ? 'es' : 'en';
  var q = /[?&]now=(\d{4}-\d{2}-\d{2}(?:T[\d:]+)?)/.exec(w.location.search);
  var NOW = q ? Date.parse(q[1].length === 10 ? q[1] + 'T12:00:00-05:00' : q[1]) : Date.now();
  var TZ = 'America/New_York';

  function t(k, v) { return YSD.t ? YSD.t('vote:' + k, v) : ''; }
  function tc(k, v) { return YSD.t ? YSD.t(k, v) : ''; }
  function tx(o) { return o == null ? '' : typeof o === 'string' ? o : (o[L] != null ? o[L] : (o.en || '')); }
  function fill(s, v) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return v[k] != null ? v[k] : m; }); }
  function $(s, r) { return (r || d).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || d).querySelectorAll(s)); }
  function el(tag, cls, text) { var e = d.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function add(p) { for (var i = 1; i < arguments.length; i++) if (arguments[i]) p.appendChild(arguments[i]); return p; }
  function byId(list, id) { for (var i = 0; i < (list || []).length; i++) if (list[i].id === id) return list[i]; return null; }
  function track(e, p) { try { if (YSD.track) YSD.track(e, p || {}); } catch (x) {} }
  function toast(s, o) { if (s && YSD.ui && YSD.ui.toast) YSD.ui.toast(s, o); }
  function shareDone(r) { if (r === 'copied') toast(tc('toast.linkCopied'), { priority: 'high' }); else if (r === 'failed') toast(tc('toast.shareFailed'), { tone: 'error', priority: 'high' }); return r; }
  function store(k, v) { var S = YSD.store; if (!S) return v; try { return arguments.length > 1 ? S.set(k, v) : S.get(k, null); } catch (x) { return null; } }
  function live(item) { return !item.expires || Date.parse(item.expires) > NOW; }

  /* ---------- links: always from config (links.vote.*) or civic.links, never typed here ---------- */
  function href(id) {
    var l = C.links[id]; if (!l) return '';
    var u = L === 'es' && l.urlEs ? l.urlEs : l.url;
    return l.key && YSD.cfg ? YSD.cfg(l.key, u) || u : u;
  }
  function official(id, cls, label) {
    var l = C.links[id]; if (!l) return null;
    var a = el('a', cls || 'link', label || tx(l.label));
    a.href = href(id); a.rel = 'noopener'; a.setAttribute('data-official', '');
    if (L === 'es' && l.urlEs) a.hreflang = 'es';
    return a;
  }
  var TEL = C.office.tel, PHONE = (YSD.cfg && YSD.cfg('links.vote.countyPhone', '')) || C.office.phone;
  function telLink(tel, text, cls) { var a = el('a', cls || '', text); a.href = 'tel:' + tel; a.setAttribute('translate', 'no'); return a; }
  function srcName(u) { var s = C.sourceTitles && C.sourceTitles[u]; if (s) return tx(s); try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } }
  function srcLink(u) { var a = el('a', '', srcName(u)); a.href = u; a.rel = 'noopener'; return a; }
  function checked(iso) { return fill(tx(C.labels.lastChecked), { date: YSD.fmt ? YSD.fmt.date(iso + 'T12:00:00-05:00', { year: true, weekday: false }) : iso }); }

  /* ---------- dates ---------- */
  var DTF = {};
  function part(iso, opt) {
    var k = JSON.stringify(opt);
    if (!DTF[k]) try { DTF[k] = new Intl.DateTimeFormat(L === 'es' ? 'es-US' : 'en-US', Object.assign({ timeZone: TZ }, opt)); } catch (e) { return ''; }
    return DTF[k].format(new Date(iso)).replace(/\.$/, '');
  }
  function longDate(iso) { return YSD.fmt ? YSD.fmt.date(iso, { year: true }) : iso.slice(0, 10); }
  function calEvent(dt, extra) {
    var ev = { id: 'ysd-civic-' + dt.id, title: tx(dt.title), description: tx(dt.short) + (dt.computed ? '\n\n' + tx(dt.computed.note) : '') + '\n\n' + tx(C.disclaimer), url: dt.source };
    if (dt.allDay) ev.start = dt.date.slice(0, 10); else { ev.start = dt.date; if (dt.end) ev.end = dt.end; }
    for (var k in extra || {}) ev[k] = extra[k];
    return ev;
  }
  function download(ev, name) {
    if (YSD.cal && YSD.cal.download(ev, name)) { toast(t('js.calDone')); track('reminder_add', { id: (Array.isArray(ev) ? ev[0] : ev).id }); }
  }
  // 'YYYY-MM-DD' of a New York date-time minus n days (plain calendar arithmetic, no DST drift)
  function nyDayMinus(iso, n) {
    var ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)).split('-');
    return new Date(Date.UTC(+ymd[0], +ymd[1] - 1, +ymd[2] - n)).toISOString().slice(0, 10);
  }

  /* ---------- static links, phones and the mail-ballot card ---------- */
  $$('[data-civic-link]').forEach(function (a) { var u = href(a.getAttribute('data-civic-link')); if (u) a.href = u; });
  $$('[data-soe-tel]').forEach(function (a) { a.href = 'tel:' + TEL; a.textContent = PHONE; });

  var na = byId(C.nextActions, 'na-renew-reminder-2026');
  var after = NOW >= Date.parse('2027-01-01T00:00:00-05:00');
  if (after) {
    $$('[data-mail-now]').forEach(function (e) { e.hidden = true; });
    $$('[data-mail-later]').forEach(function (e) { e.hidden = false; });
  } else if (na && na.calendar) {
    var rc = na.calendar;
    var rem = { id: 'ysd-civic-' + na.id, title: tx(rc.title), start: rc.date, end: rc.end, description: tx(rc.description), url: href('voteByMail'), alarm: 5 };
    var rb = $('[data-remind]');
    if (rb) rb.addEventListener('click', function () { download(rem, 'renew-mail-ballot-reminder.ics'); });
    if (YSD.cal) {
      var g = $('[data-remind-google]'), o = $('[data-remind-outlook]');
      if (g) { g.href = YSD.cal.google(rem); g.target = '_blank'; g.rel = 'noopener'; }
      if (o) { o.href = YSD.cal.outlook(rem); o.target = '_blank'; o.rel = 'noopener'; }
    }
  }

  /* ---------- private checklist: the "Done" ticks on each step (local only, no points) ---------- */
  var done = store('vote:checklist') || {};
  var steps = (C.steps || []).slice().sort(function (a, b) { return a.order - b.order; });
  var countEl = $('[data-check-count]');
  function syncChecks() {
    $$('[data-done]').forEach(function (c) { c.checked = !!done[c.getAttribute('data-done')]; });
    if (countEl) countEl.textContent = t('check.count', { n: steps.filter(function (s) { return done[s.id]; }).length, total: steps.length });
  }
  function checkbox(id, label, hidden) {
    var lab = el('label', 'field field--check x-done'), c = el('input');
    c.type = 'checkbox'; c.setAttribute('data-done', id);
    var sp = el('span', 'field__label', label);
    if (hidden) sp.appendChild(el('span', 'u-visually-hidden', hidden));
    return add(lab, c, sp);
  }
  d.addEventListener('change', function (e) {
    var c = e.target; if (!c.matches || !c.matches('[data-done]')) return;
    var id = c.getAttribute('data-done');
    if (c.checked) done[id] = Date.now(); else delete done[id];
    store('vote:checklist', done); syncChecks();
  });
  var clr = $('[data-check-clear]');
  if (clr) clr.addEventListener('click', function () { done = {}; try { YSD.store.remove('vote:checklist'); } catch (e) {} syncChecks(); toast(t('check.cleared')); });

  /* ---------- steps: "How do you want to vote?" ---------- */
  var BY_METHOD = { mail: ['check-registration', 'renew-mail-ballot', 'register'], early: ['check-registration', 'early-voting', 'what-id'], 'election-day': ['check-registration', 'polling-place', 'what-id'] };
  var yoursList = $('[data-steps]'), moreList = $('[data-steps-more]'), moreH = $('[data-steps-more-h]');
  function stepBody(s) {
    var body = el('div', 'x-stepd__body');
    add(body, el('p', 'x-step__sum', tx(s.summary)));
    var row = el('div', 'x-step__act');
    if (s.cta) add(row, official(s.cta.linkId, 'btn btn--ink btn--sm', tx(s.cta.label)));
    (s.hotlineIds || []).slice(0, 1).forEach(function () { add(row, telLink(TEL, t('js.call') + ' ' + PHONE, 'btn btn--ghost btn--sm')); });
    row.appendChild(checkbox(s.id, t('check.done'), t('check.doneHidden')));
    body.appendChild(row);
    var det = el('details', 'x-how');
    det.appendChild(el('summary', '', t('js.how')));
    var how = el('ol', 'x-how__list');
    (s.how || []).forEach(function (h) { how.appendChild(el('li', '', tx(h))); });
    det.appendChild(how);
    (s.extra || []).forEach(function (x) { add(det, add(el('div', 'x-extra'), el('h4', 'x-extra__t', tx(x.title)), el('p', '', tx(x.body)))); });
    var ds = (s.dateIds || []).map(function (id) { return byId(C.dates, id); }).filter(function (x) { return x && live(x); }).slice(0, 3);
    if (ds.length) {
      var dl = el('ul', 'x-mini');
      ds.forEach(function (x) { add(dl, add(el('li'), el('b', '', longDate(x.date)), d.createTextNode(' · ' + tx(x.title) + (x.status === 'expected' ? ' (' + tx(C.labels.expected).split('.')[0] + ')' : hedged(x) && x.statusNote ? '. ' + tx(x.statusNote) : '')))); });
      add(det, el('h4', 'x-extra__t', t('js.dates')), dl);
    }
    var ls = (s.linkIds || []).filter(function (id) { return !s.cta || id !== s.cta.linkId; });
    if (ls.length) {
      var ul = el('ul', 'x-mini');
      ls.forEach(function (id) { var a = official(id); if (a) add(ul, add(el('li'), a)); });
      add(det, el('h4', 'x-extra__t', t('js.links')), ul);
    }
    var srcs = [];
    (s.facts || []).forEach(function (f) { if (srcs.indexOf(f.source) < 0) srcs.push(f.source); });
    var meta = el('p', 'step__meta x-fine');
    meta.appendChild(d.createTextNode(tx(C.labels.sources) + ': '));
    srcs.slice(0, 4).forEach(function (u, j) { if (j) meta.appendChild(d.createTextNode(' · ')); meta.appendChild(srcLink(u)); });
    meta.appendChild(d.createTextNode(' · ' + checked(s.verified)));
    det.appendChild(meta);
    body.appendChild(det);
    return body;
  }
  var stepEls = {};
  steps.forEach(function (s) {
    var li = d.getElementById(s.id); if (!li) return;
    if (s.tone === 'serious') li.setAttribute('data-tone', 'calm');
    var det = el('details', 'x-stepd'), sum = el('summary'), n = el('span', 'step__n');
    n.setAttribute('aria-hidden', 'true');
    add(sum, n, el('h3', 'step__title', tx(s.title)));
    add(det, sum, stepBody(s));
    li.textContent = '';
    li.appendChild(det);
    stepEls[s.id] = { li: li, det: det, n: n };
  });
  var methods = Object.keys(BY_METHOD), plan0 = store('vote:plan');
  var method = store('vote:method');
  if (methods.indexOf(method) < 0) method = plan0 && methods.indexOf(plan0.method) >= 0 ? plan0.method : 'mail';
  function arrange(m, keepOpen) {
    if (!yoursList || !moreList) return;
    var mine = BY_METHOD[m] || BY_METHOD.mail;
    mine.forEach(function (id, i) { var x = stepEls[id]; if (!x) return; x.n.textContent = String(i + 1); x.n.hidden = false; if (!keepOpen) x.det.open = true; yoursList.appendChild(x.li); });
    var rest = steps.filter(function (s) { return mine.indexOf(s.id) < 0; });
    rest.forEach(function (s) { var x = stepEls[s.id]; if (!x) return; x.n.hidden = true; if (!keepOpen) x.det.open = false; moreList.appendChild(x.li); });
    moreList.hidden = !rest.length; if (moreH) moreH.hidden = !rest.length;
  }
  var seg = $('[data-method]');
  if (seg) {
    $$('input[name="vote-method"]', seg).forEach(function (r) { r.checked = r.value === method; });
    seg.addEventListener('change', function (e) {
      if (e.target.name !== 'vote-method') return;
      method = e.target.value; store('vote:method', method); arrange(method);
      track('vote_method', { method: method });
    });
  }
  arrange(method);
  syncChecks();

  /* ---------- hash targets: open a folded step, a hidden FAQ answer or a folded box ---------- */
  function openHash() {
    var id = decodeURIComponent((w.location.hash || '').slice(1)), x = id && d.getElementById(id);
    if (!x) return;
    if (x.matches('[data-step]')) { var sd = $('.x-stepd', x); if (sd) sd.open = true; }
    if (x.matches('.x-qa')) { if (x.hidden) { faqAll = true; renderFaq(); x = d.getElementById(id); } if (x) x.open = true; }
    if (x && x.tagName === 'DETAILS') x.open = true;
    for (var p = x && x.parentElement; p; p = p.parentElement) if (p.tagName === 'DETAILS') p.open = true;
  }
  w.addEventListener('hashchange', openHash);

  /* ---------- key dates ---------- */
  var place = 'all', datesBox = $('[data-dates]'), chips = $('[data-date-places]');
  var placeList = (C.places || []).filter(function (p) { return p.kind !== 'unknown'; });
  function chip(label, pressed, attr, val) {
    var b = el('button', 'chip', label); b.type = 'button'; b.setAttribute(attr, val); b.setAttribute('aria-pressed', pressed ? 'true' : 'false'); return b;
  }
  function scopeNames(sc) { return sc.map(function (id) { var p = byId(C.places, id); return p ? tx(p.name) : id; }).join(', '); }
  var allDates = false, DATES_FIRST = 3;
  function computedLabel(x) {
    var r = x.computed && x.computed.rule;
    return r === 'reg29' || r === 'reg29-holiday' ? tx(C.labels.computedReg) : r === 'mail12' ? tx(C.labels.computedMail) : x.computed ? tx(x.computed.note) : '';
  }
  // A deadline is only as sure as its election (ruling 00: Lake Mary and Altamonte Springs are "expected").
  function expectedFor(x, pl) {
    if (x.status === 'expected') return true;
    var rel = (x.appliesTo || []).map(function (id) { return byId(C.dates, id); }).filter(function (e) { return e && (!pl || pl === 'all' || e.scope.indexOf(pl) >= 0 || e.scope.indexOf('all') >= 0); });
    return rel.length > 0 && rel.every(function (e) { return e.status === 'expected'; });
  }
  function hedged(x) { return (x.appliesTo || []).some(function (id) { var e = byId(C.dates, id); return e && e.status === 'expected'; }); }
  function renderDates() {
    if (!datesBox) return;
    datesBox.textContent = '';
    var items = (C.dates || []).filter(function (x) { return live(x) && (place === 'all' || x.scope.indexOf('all') >= 0 || x.scope.indexOf(place) >= 0); })
      .sort(function (a, b) { return Date.parse(a.date) - Date.parse(b.date); });
    if (place !== 'all' && !items.some(function (x) { return x.scope.indexOf(place) >= 0; })) datesBox.appendChild(el('p', 'notice notice--info', t('dates.none')));
    var total = items.length;
    if (!allDates) items = items.slice(0, DATES_FIRST);
    var year = '', grid;
    items.forEach(function (x) {
      var y = part(x.date, { year: 'numeric' });
      if (y !== year) { year = y; grid = el('ol', 'x-dates__grid'); add(datesBox, el('h3', 'x-year', y), grid); }
      var row = el('li', 'x-date x-date--' + x.kind);
      var stub = add(el('p', 'x-date__stub'), el('span', 'x-date__m', part(x.date, { month: 'short' })), el('span', 'x-date__d', part(x.date, { day: 'numeric' })), el('span', 'x-date__w', part(x.date, { weekday: 'short' })), x.time && !/ to | a /.test(tx(x.time)) ? el('span', 'x-date__time', tx(x.time)) : null);
      stub.setAttribute('aria-hidden', 'true');
      var b = el('div', 'x-date__body');
      var tags = el('p', 'x-date__tags'), isExp = expectedFor(x, place);
      add(tags, el('span', isExp ? 'tag tag--outline' : 'tag tag--real', isExp ? tx(C.labels.expected).split('.')[0] : tx(C.labels.confirmed)));
      if (x.scope.indexOf('all') < 0) add(tags, el('span', 'tag tag--outline', t('js.scope') + ': ' + scopeNames(x.scope)));
      add(b, tags, el('h4', 'x-date__title', tx(x.title)), el('p', 'u-visually-hidden', longDate(x.date) + (x.time ? ', ' + tx(x.time) : '')));
      if (x.kind === 'election') add(b, el('p', 'x-date__short', tx(x.short))); // the rest repeat cards above
      var note = x.status === 'expected' ? tx(C.labels.expected) : computedLabel(x) || (x.statusNote ? tx(x.statusNote) : '');
      if (note) add(b, el('p', 'x-fine', note));
      if (x.status !== 'expected' && x.computed && x.statusNote && hedged(x)) add(b, el('p', 'x-fine', tx(x.statusNote)));
      var act = el('p', 'x-date__act');
      if (x.calendar) {
        var cb = el('button', 'btn btn--quiet btn--sm x-date__cal', t('js.add')); cb.type = 'button';
        cb.addEventListener('click', function () { download(calEvent(x, { alarm: 1440 })); });
        act.appendChild(cb);
      }
      var s = el('span', 'x-fine'); s.appendChild(d.createTextNode(tx(C.labels.source) + ': ')); s.appendChild(srcLink(x.source));
      add(act, s); add(b, act);
      add(grid, add(row, stub, b));
    });
    if (total > DATES_FIRST) {
      var more = el('button', 'btn btn--ink btn--sm x-dates__more', allDates ? t('dates.less') : t('dates.more', { n: total }));
      more.type = 'button'; more.setAttribute('aria-expanded', allDates ? 'true' : 'false');
      more.addEventListener('click', function () { allDates = !allDates; renderDates(); var m = $('.x-dates__more'); if (m) m.focus(); });
      datesBox.appendChild(more);
    }
  }
  if (chips) {
    chips.appendChild(chip(t('dates.all'), true, 'data-place', 'all'));
    placeList.forEach(function (p) { chips.appendChild(chip(p.kind === 'city' ? tx(p.name) : tx(p.name).split(' (')[0], false, 'data-place', p.id)); });
    chips.addEventListener('click', function (e) {
      var b = e.target.closest('[data-place]'); if (!b) return;
      place = b.getAttribute('data-place');
      $$('[data-place]', chips).forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      renderDates();
    });
  }
  renderDates();

  /* ---------- FAQ: 4 first, then "Show all" ---------- */
  var FAQ_TAGS = ['all', 'vote-by-mail', 'id', 'register', 'party', 'students', 'under-18', 'election-day'], faqTag = 'all', faqAll = false, FAQ_FIRST = 4;
  var faqBox = $('[data-faq]'), faqTags = $('[data-faq-tags]');
  function renderFaq(focusMore) {
    if (!faqBox) return;
    faqBox.textContent = '';
    var list = (C.faq || []).filter(function (f) { return faqTag === 'all' || (f.tags || []).indexOf(faqTag) >= 0; });
    var cut = faqTag === 'all' && !faqAll ? FAQ_FIRST : list.length;
    list.forEach(function (f, i) {
      var det = el('details', 'x-qa'); det.id = f.id;
      if (i >= cut) det.hidden = true;
      det.appendChild(el('summary', '', tx(f.q)));
      var body = add(el('div', 'x-qa__a'), el('p', '', tx(f.a)));
      var links = el('p', 'x-qa__links');
      (f.linkIds || []).forEach(function (id) { var a = official(id); if (a) add(links, a, d.createTextNode(' ')); });
      add(body, links);
      var src = el('p', 'x-fine'); src.appendChild(d.createTextNode(tx(C.labels.source) + ': ')); src.appendChild(srcLink(f.source)); src.appendChild(d.createTextNode(' · ' + checked(f.verified)));
      add(det, add(body, src));
      faqBox.appendChild(det);
    });
    if (faqTag === 'all' && list.length > FAQ_FIRST) {
      var more = el('button', 'btn btn--ink btn--sm x-faq__more', faqAll ? t('faq.less') : t('faq.more', { n: list.length }));
      more.type = 'button'; more.setAttribute('aria-expanded', faqAll ? 'true' : 'false');
      more.addEventListener('click', function () {
        faqAll = !faqAll; renderFaq(true);
        if (faqAll) { var nx = faqBox.querySelectorAll('.x-qa')[FAQ_FIRST]; if (nx) $('summary', nx).focus(); }
      });
      faqBox.appendChild(more);
      if (focusMore && !faqAll) more.focus();
    }
  }
  if (faqTags) {
    FAQ_TAGS.forEach(function (tg) { faqTags.appendChild(chip(t('faq.tag.' + tg), tg === 'all', 'data-faq-tag', tg)); });
    faqTags.addEventListener('click', function (e) {
      var b = e.target.closest('[data-faq-tag]'); if (!b) return;
      faqTag = b.getAttribute('data-faq-tag');
      $$('[data-faq-tag]', faqTags).forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      renderFaq();
    });
  }
  renderFaq();

  /* ---------- hotlines (compact: name, what it's for, hours, call) ---------- */
  var hl = $('[data-hotlines]');
  if (hl) {
    hl.textContent = '';
    (C.hotlines || []).forEach(function (h) {
      var li = el('li', 'x-line');
      add(li, el('h4', 'x-line__name', tx(h.name)), el('p', 'x-line__use', tx(h.use) + (h.hours ? ' ' + tx(h.hours) : '')));
      var row = el('p', 'btn-row');
      row.appendChild(telLink(h.tel, h.vanity ? h.vanity + ' · ' + h.phone : h.phone, 'btn btn--ink btn--sm'));
      (h.alt || []).forEach(function (a) { add(row, telLink(a.tel, tx(C.labels.inSpanish) + ': ' + (a.vanity || a.phone), 'btn btn--ghost btn--sm')); });
      add(li, row);
      var o = official(h.linkId, 'link x-fine'); if (o) add(li, add(el('p'), o));
      hl.appendChild(li);
    });
  }

  /* ---------- make a plan ---------- */
  var P = C.plan, form = $('[data-planner]'), qsBox = $('[data-plan-qs]'), out = $('[data-plan-out]');
  var ans = {};
  var saved = plan0;
  if (saved && saved.election && byId(C.dates, saved.election) && live(byId(C.dates, saved.election))) for (var k in saved) if (k !== 'ts') ans[k] = saved[k];
  function shown(qq) { var s = qq.showIf; if (!s) return true; for (var k in s) if (s[k].indexOf(ans[k]) < 0) return false; return true; }
  function optionsFor(qq) {
    if (qq.optionsFrom === 'places') return C.places.map(function (p) { return { id: p.id, label: p.name, note: p.note }; });
    if (qq.optionsFrom === 'dates') {
      var f = qq.filter, pl = ans.where || 'not-sure';
      return C.dates.filter(function (x) {
        return x.kind === f.kind && f.statuses.indexOf(x.status) >= 0 && live(x) && (x.scope.indexOf('all') >= 0 || x.scope.indexOf(pl) >= 0);
      }).map(function (x) {
        var note = (qq.optionNotes && qq.optionNotes[x.id]) || (x.status === 'expected' ? C.labels.expected : null);
        return { id: x.id, label: { en: x.title.en + ' · ' + YSD.fmt.date(x.date, { year: true, lang: 'en' }), es: x.title.es + ' · ' + YSD.fmt.date(x.date, { year: true, lang: 'es' }) }, note: note };
      });
    }
    if (qq.optionsByMethod) return (qq.optionsByMethod[ans.method] || []).map(function (o) { return { id: o.id, label: o.label, note: qq.notes && qq.notes[o.id] }; });
    return qq.options || [];
  }
  function renderPlan(focus) {
    if (!qsBox) return;
    qsBox.textContent = '';
    var complete = true, outcome = 'plan';
    for (var i = 0; i < P.questions.length; i++) {
      var qq = P.questions[i];
      if (!shown(qq)) { delete ans[qq.id]; continue; }
      var opts = optionsFor(qq);
      if (ans[qq.id] && !byId(opts, ans[qq.id])) delete ans[qq.id];
      var fs = el('fieldset', 'x-q');
      add(fs, el('legend', 'x-q__p', tx(qq.prompt)));
      if (qq.help) add(fs, el('p', 'x-fine', tx(qq.help)));
      if (!opts.length) { add(fs, el('p', 'notice notice--info', t('plan.noElection'))); qsBox.appendChild(fs); complete = false; break; }
      var row = el('div', 'chip-row');
      opts.forEach(function (o) {
        var lab = el('label', 'chip'), inp = el('input');
        inp.type = 'radio'; inp.name = 'plan-' + qq.id; inp.value = o.id; inp.checked = ans[qq.id] === o.id;
        add(row, add(lab, inp, d.createTextNode(tx(o.label))));
      });
      add(fs, row);
      var sel = byId(opts, ans[qq.id]);
      if (sel && sel.note) add(fs, el('p', 'x-q__note', tx(sel.note)));
      qsBox.appendChild(fs);
      if (!ans[qq.id]) { complete = false; break; }
      if (sel && sel.outcome) outcome = sel.outcome;
    }
    if (focus) { var f = $('input[name="plan-' + focus.name + '"][value="' + focus.value + '"]', qsBox); if (f) f.focus(); }
    if (complete) renderOut(outcome); else out.hidden = true;
  }
  function vars() {
    var dt = byId(C.dates, ans.election), lab = P.labels, pl = byId(C.places, ans.where);
    var dl = null;
    if (dt) {
      var kind = ans.method === 'mail' && ans.status === 'registered' ? 'mail-ballot-deadline' : 'registration-deadline';
      if (ans.method === 'mail' && ans.status !== 'registered') kind = 'registration-deadline';
      dl = C.dates.filter(function (x) { return x.kind === kind && live(x) && (x.appliesTo || []).indexOf(dt.id) >= 0; })[0] || null;
    }
    return {
      dt: dt, dl: dl,
      v: {
        city: pl ? tx(pl.name) : '', electionTitle: dt ? tx(dt.title) : '', election: dt ? tx(dt.planName || dt.title) : '',
        electionDate: dt ? longDate(dt.date) : '', method: tx((lab.method || {})[ans.method]), when: tx((lab.when || {})[ans.when]),
        getThere: tx((lab.getThere || {})[ans.getThere]), 'with': tx((lab['with'] || {})[ans['with']]),
        deadlineTitle: dl ? tx(dl.title) : '', deadlineShort: dl ? tx(dl.short) : '',
        url: YSD.share ? YSD.share.url('vote.html#plan') : w.location.href.split('#')[0]
      }
    };
  }
  // journeys-17: a mail voter's calendar never says "Vote" at 7 pm on Election Day. Event 1 is the ARRIVAL
  // deadline (titleMail), event 2 the registration or mail-request deadline, event 3 "Mail your ballot today"
  // a week earlier (cal.mailEvent), so the alarm and the event agree.
  function planEvents(V, v, mail) {
    var cal = P.outputs.calendar, dt = V.dt;
    var ev = { id: 'ysd-plan-' + dt.id, title: fill(tx(mail && cal.titleMail ? cal.titleMail : cal.title), v), description: fill(tx(mail ? cal.descriptionMail : cal.description), v), url: href('countyElections'), alarm: cal.remindersMinutesBefore[0] };
    if (mail && dt.end) { ev.start = dt.end; ev.end = dt.end.replace(/T19:00/, 'T19:30'); ev.alarm = cal.remindersMinutesBefore[1] || 1440; } else { ev.start = dt.date; ev.end = dt.end; }
    var evs = [ev];
    var me = cal.mailEvent;
    if (mail && me) {
      var day = nyDayMinus(dt.date, me.daysBefore || 7), hm = (me.time || '10:00').split(':');
      var endMin = (+hm[0]) * 60 + (+hm[1]) + (me.minutes || 30), pad = function (n) { return (n < 10 ? '0' : '') + n; };
      evs.push({ id: 'ysd-plan-mail-' + dt.id, title: fill(tx(me.title), v), description: fill(tx(me.description), v), url: href('voteByMail'),
        start: day + 'T' + pad(+hm[0]) + ':' + pad(+hm[1]) + ':00', end: day + 'T' + pad(Math.floor(endMin / 60)) + ':' + pad(endMin % 60) + ':00', alarm: (me.remindersMinutesBefore || [0])[0] });
    }
    if (V.dl) evs.push(calEvent(V.dl, { id: 'ysd-plan-' + V.dl.id, title: fill(tx(cal.deadlineEvent.title), v), description: fill(tx(cal.deadlineEvent.description), v), alarm: cal.deadlineEvent.remindersMinutesBefore[0] }));
    return evs;
  }
  YSD.votePlanEvents = function (a) { var keep = ans; ans = a; try { var V = vars(); return V.dt ? planEvents(V, V.v, a.method === 'mail') : []; } finally { ans = keep; } }; // test hook (tests/QA)
  function renderOut(outcome) {
    var o = P.outcomes[outcome], V = vars(), v = V.v, mail = ans.method === 'mail';
    out.textContent = '';
    var card = el('div', 'x-plancard');
    add(card, el('p', 'x-plancard__k', t('plan.cardKicker')));
    if (outcome === 'plan') {
      add(card, el('p', 'x-plancard__t', v.electionTitle));
      P.outputs.card.lines.forEach(function (ln) { var s = fill(tx(ln), v); if (s.indexOf('{') < 0 && s.replace(/\s/g, '')) add(card, el('p', 'x-plancard__l', s)); });
    } else add(card, el('p', 'x-plancard__t', tx(o.title)));
    out.appendChild(card);
    add(out, el('h3', 'x-plan__ot', tx(o.title)), el('p', '', fill(tx(o.body), v)));
    if (outcome === 'plan' && V.dl) add(out, el('p', 'x-plan__dl', fill(tx(o.deadlineLine), v)));
    var ids = (o.stepIds || []).slice();
    [P.questions[2], P.questions[3]].forEach(function (qq) { var op = qq && byId(qq.options || [], ans[qq.id]); if (op && op.stepId && ids.indexOf(op.stepId) < 0) ids.unshift(op.stepId); });
    if (ids.length) {
      var ul = el('ul', 'x-mini');
      ids.forEach(function (id) { var s = byId(C.steps, id); if (!s) return; var a = el('a', '', tx(s.title)); a.href = '#' + id; add(ul, add(el('li'), a)); });
      add(out, el('p', 'x-plan__next', t('plan.next')), ul);
    }
    var row = el('div', 'btn-row');
    function btn(label, cls, fn) { var b = el('button', 'btn btn--sm ' + cls, label); b.type = 'button'; b.addEventListener('click', fn); row.appendChild(b); return b; }
    var invite = fill(tx(outcome === 'plan' ? (mail ? P.outputs.inviteMail : P.outputs.invite) : P.pledge.statement[outcome]), v);
    if (outcome === 'plan' && V.dt) {
      btn(t('plan.cal'), 'btn--ink', function () { download(planEvents(V, v, mail), 'my-voting-plan.ics'); });
      var self = fill(tx(mail ? P.outputs.textToSelfMail : P.outputs.textToSelf), v);
      var sms = el('a', 'btn btn--sm btn--ghost', t('plan.text')); sms.href = 'sms:?&body=' + encodeURIComponent(self); row.appendChild(sms);
    }
    btn(t('plan.invite'), 'btn--primary', function () {
      var text = invite.replace(/\s*\{url\}|\s*https?:\/\/\S+$/, '');
      if (YSD.share && YSD.share.native) YSD.share.native({ title: tx(P.title), text: text, url: v.url }).then(shareDone);
    });
    btn(t('plan.reset'), 'btn--quiet', function () { ans = {}; try { YSD.store.remove('vote:plan'); } catch (e) {} renderPlan(); var f = $('input', qsBox); if (f) f.focus(); });
    out.appendChild(row);
    if (outcome === 'plan' && V.dt && mail) out.appendChild(el('p', 'x-fine', t('plan.calMail')));
    out.appendChild(el('p', 'consent', t('plan.saved')));
    out.hidden = false;
    var keep = { ts: Date.now() }; for (var k in ans) keep[k] = ans[k];
    store('vote:plan', keep);
    track('plan_made', { outcome: outcome });
  }
  if (form) {
    form.addEventListener('submit', function (e) { e.preventDefault(); });
    form.addEventListener('change', function (e) {
      var i = e.target; if (!i.name || i.name.indexOf('plan-') !== 0) return;
      var id = i.name.slice(5); ans[id] = i.value;
      if (id === 'method') {
        delete ans.when;
        if (methods.indexOf(i.value) >= 0 && seg) { method = i.value; store('vote:method', method); $$('input[name="vote-method"]', seg).forEach(function (r) { r.checked = r.value === method; }); arrange(method); }
      }
      renderPlan({ name: id, value: i.value });
      if (!out.hidden && e.isTrusted) out.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    renderPlan();
  }

  /* ---------- share cards: "Send these 2 dates" sheet (canvas, rendered before the click) ---------- */
  var cards = YSD.cards, sheet = $('#dates-sheet'), frame = $('[data-dcard-frame]');
  var LAKE = '#2236C9', CREAM = '#FFF6EA', NIGHT = '#170B33', TANG = '#FF8B3D', SUN = '#FFD23F';
  var PSA = {
    both: { title: t('psa.both'), text: t('psa.bothText'), hash: '' },
    mail: { fill: TANG, ink: NIGHT, kicker: tx(byId(C.changes, 'mail-ballot-expiry').eyebrow), title: t('mail.title'), body: t('mail.body1') + ' ' + t('mail.bodyLink') + ' ' + t('mail.body2'), sticker: 'envelope', hash: 'mail-ballot', text: t('psa.mailText') },
    id: { fill: LAKE, ink: CREAM, kicker: tx(byId(C.changes, 'student-id').eyebrow), title: t('id.title'), body: t('id.copy'), sticker: null, hash: 'student-id', text: t('psa.idText') }
  };
  var kind = after ? 'id' : 'both', dsize = 'story', canv = {};
  function shareUrl(k) { return YSD.share ? YSD.share.url('vote.html' + (PSA[k].hash ? '#' + PSA[k].hash : '')) : w.location.href; }
  function prettyUrl(u) { return YSD.ui && YSD.ui.prettyLink ? YSD.ui.prettyLink(u) : u; }
  function footer(ctx, env, data, ink) {
    var W = env.width, H = env.height, s = W / 1080, h = env.h, th = env.theme, m = 84 * s, fy = H - m - 120 * s;
    ctx.fillStyle = ink; ctx.globalAlpha = 0.3; ctx.fillRect(m, fy - 28 * s, W - 2 * m, 3 * s); ctx.globalAlpha = 1;
    ctx.font = h.font(38 * s, 800, th.fontBody); ctx.textBaseline = 'top';
    ctx.fillText(prettyUrl(data.url), m, fy);
    ctx.font = h.font(26 * s, 400, th.fontBody);
    h.wrapText(ctx, (YSD.cfg && YSD.cfg('legal.cardFooter', '')) || '', m, fy + 56 * s, W - 2 * m - 150 * s, 34 * s, { maxLines: 2 });
    return fy;
  }
  function tile(ctx, env, x, y, w2, h2, rot, o) {
    var s = env.width / 1080, h = env.h, th = env.theme, pad = 34 * s;
    ctx.save(); ctx.translate(x + w2 / 2, y + h2 / 2); ctx.rotate(rot); ctx.translate(-w2 / 2, -h2 / 2);
    h.roundRect(ctx, 14 * s, 16 * s, w2, h2, 40 * s, { fill: NIGHT });
    h.roundRect(ctx, 0, 0, w2, h2, 40 * s, { fill: o.bg });
    ctx.save(); h.roundRect(ctx, 0, 0, w2, h2, 40 * s); ctx.clip(); ctx.fillStyle = NIGHT; ctx.fillRect(0, 0, w2, 52 * s); ctx.restore();
    ctx.fillStyle = LAKE; [0.28, 0.72].forEach(function (f) { ctx.beginPath(); ctx.arc(w2 * f, 26 * s, 10 * s, 0, Math.PI * 2); ctx.fill(); });
    ctx.lineWidth = 6 * s; ctx.strokeStyle = NIGHT; h.roundRect(ctx, 0, 0, w2, h2, 40 * s); ctx.stroke();
    ctx.textBaseline = 'top'; ctx.fillStyle = NIGHT; ctx.font = h.font(30 * s, 700, th.fontBody);
    ctx.fillText(o.k, pad, 80 * s);
    ctx.fillStyle = o.fg;
    var ft = h.fitText(ctx, o.big, w2 - 2 * pad, { max: 210 * s, min: 90 * s, weight: 800, family: th.fontDisplay, maxLines: 1, lineHeight: 0.9 });
    ctx.fillText(ft.lines[0], pad, 130 * s);
    ctx.fillStyle = NIGHT; ctx.font = h.font(34 * s, 700, th.fontBody);
    h.wrapText(ctx, o.t, pad, 130 * s + ft.lineHeight + 26 * s, w2 - 2 * pad, 42 * s, { maxLines: 4 });
    ctx.restore();
  }
  function drawBoth(ctx, data, env) {
    var W = env.width, H = env.height, s = W / 1080, h = env.h, th = env.theme, m = 84 * s, tall = H > 1500;
    ctx.fillStyle = LAKE; ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    var y = m + (tall ? 90 * s : 0);
    ctx.font = h.font(32 * s, 700, th.fontBody);
    var kk = t('card.kicker'), kw = ctx.measureText(kk).width;
    h.roundRect(ctx, m, y, kw + 48 * s, 62 * s, 31 * s, { fill: CREAM });
    ctx.fillStyle = NIGHT; ctx.fillText(kk, m + 24 * s, y + 15 * s);
    y += (tall ? 120 : 96) * s;
    ctx.fillStyle = CREAM;
    var ft = h.fitText(ctx, t('card.title'), W - 2 * m, { max: (tall ? 150 : 120) * s, min: 70 * s, weight: 800, family: th.fontDisplay, maxLines: 2, lineHeight: 0.92 });
    ft.lines.forEach(function (ln, i) { ctx.fillText(ln, m, y + i * ft.lineHeight); });
    y += ft.lines.length * ft.lineHeight + (tall ? 70 : 44) * s;
    var gap = 44 * s, tw = (W - 2 * m - gap) / 2, thh = (tall ? 620 : 450) * s;
    tile(ctx, env, m, y, tw, thh, -0.045, { bg: TANG, fg: NIGHT, k: t('tile.mail.k'), big: t('tile.mail.big'), t: t('tile.mail.t') });
    tile(ctx, env, m + tw + gap, y, tw, thh, 0.035, { bg: CREAM, fg: LAKE, k: t('tile.id.k'), big: t('tile.id.big'), t: t('tile.id.t') });
    y += thh + (tall ? 100 : 56) * s;
    [[TANG, t('card.mailLine')], [CREAM, t('card.idLine')]].forEach(function (pr) {
      ctx.fillStyle = pr[0]; ctx.beginPath(); ctx.arc(m + 14 * s, y + 24 * s, 13 * s, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = CREAM; ctx.font = h.font((tall ? 42 : 36) * s, 700, th.fontBody);
      y += h.wrapText(ctx, pr[1], m + 50 * s, y, W - 2 * m - 50 * s, (tall ? 54 : 46) * s, { maxLines: 3 }).height + (tall ? 30 : 18) * s;
    });
    ctx.fillStyle = SUN; ctx.font = h.font((tall ? 40 : 34) * s, 800, th.fontBody);
    ctx.fillText(t('psa.official'), m, y + (tall ? 12 : 4) * s);
    ctx.fillStyle = CREAM; footer(ctx, env, data, CREAM);
  }
  function drawPsa(k) {
    return function (ctx, data, env) {
      var p = PSA[k], W = env.width, H = env.height, s = W / 1080, h = env.h, th = env.theme, m = 84 * s;
      ctx.fillStyle = p.fill; ctx.fillRect(0, 0, W, H);
      ctx.textBaseline = 'top'; ctx.textAlign = 'left';
      var y = m + (H > 1500 ? 140 * s : 0);
      ctx.font = h.font(34 * s, 700, th.fontBody);
      var kw = ctx.measureText(p.kicker).width;
      h.roundRect(ctx, m, y, kw + 48 * s, 64 * s, 32 * s, { fill: p.ink });
      ctx.fillStyle = p.fill; ctx.fillText(p.kicker, m + 24 * s, y + 15 * s);
      y += 110 * s;
      ctx.fillStyle = p.ink;
      var ft = h.fitText(ctx, p.title, W - 2 * m - (p.sticker ? 120 * s : 0), { max: 150 * s, min: 70 * s, weight: 800, family: th.fontDisplay, maxLines: 3, lineHeight: 0.95 });
      ft.lines.forEach(function (ln, i) { ctx.fillText(ln, m, y + i * ft.lineHeight); });
      y += ft.lines.length * ft.lineHeight + 40 * s;
      ctx.font = h.font(48 * s, 400, th.fontBody);
      var r = h.wrapText(ctx, p.body, m, y, W - 2 * m, 64 * s, { maxLines: 8 });
      y += r.height + 36 * s;
      ctx.font = h.font(42 * s, 700, th.fontBody);
      ctx.fillText(t('psa.official'), m, y);
      footer(ctx, env, data, p.ink);
      if (p.sticker && YSD.ui && YSD.ui.stickerDataUrl) {
        return h.loadImage(YSD.ui.stickerDataUrl(p.sticker)).then(function (img) {
          ctx.save(); ctx.translate(W - m - 90 * s, m + 70 * s + (H > 1500 ? 140 * s : 0)); ctx.rotate(0.22);
          ctx.drawImage(img, -95 * s, -95 * s, 190 * s, 190 * s); ctx.restore();
        }, function () {});
      }
    };
  }
  function cardKey() { return kind + '-' + dsize; }
  function renderCard(k, z) {
    var key = k + '-' + z;
    if (canv[key] !== undefined || !cards || !cards.render) return Promise.resolve(canv[key]);
    canv[key] = null;
    return cards.render('w3-' + (k === 'both' ? 'dates' : 'psa-' + k), { url: shareUrl(k) }, z === 'story' ? { width: 1080, height: 1920 } : { width: 1080, height: 1350 }).then(function (cv) {
      cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', PSA[k].title + '. ' + PSA[k].text);
      canv[key] = cv; return cv;
    }, function () { delete canv[key]; return null; });
  }
  function showCard() {
    if (!frame) return;
    var key = cardKey();
    frame.setAttribute('data-size', dsize);
    if (canv[key]) { frame.textContent = ''; frame.appendChild(canv[key]); return; }
    frame.textContent = ''; frame.appendChild(el('p', 'x-dsheet__wait', t('js.cardMaking')));
    renderCard(kind, dsize).then(function (cv) { if (cv && cardKey() === key) { frame.textContent = ''; frame.appendChild(cv); } });
  }
  if (cards && cards.register) {
    cards.register('w3-dates', drawBoth, { size: 'story' });
    cards.register('w3-psa-mail', drawPsa('mail'), { size: 'story' });
    cards.register('w3-psa-id', drawPsa('id'), { size: 'story' });
    // render the default card early (idle), so the share click has a canvas ready (browsers need a fresh gesture)
    var warm = function () { renderCard(kind, dsize); };
    if (w.requestIdleCallback) w.requestIdleCallback(warm, { timeout: 2500 }); else setTimeout(warm, 1200);
  }
  if (after && sheet) $$('input[name="dcard"]', sheet).forEach(function (r) { if (r.value !== 'id') r.closest('.seg__opt').hidden = true; else r.checked = true; });
  if (sheet) {
    sheet.addEventListener('change', function (e) {
      var r = e.target;
      if (r.name === 'dcard') kind = r.value; else if (r.name === 'dsize') dsize = r.value; else return;
      showCard();
    });
    sheet.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-dcard-share],[data-dcard-save],[data-dcard-copy]'); if (!b) return;
      var p = PSA[kind], cv = canv[cardKey()], url = shareUrl(kind), file = 'ydsc-' + (kind === 'both' ? 'two-dates' : kind + '-heads-up') + '.png';
      if (b.hasAttribute('data-dcard-copy')) {
        if (YSD.share) YSD.share.copy(p.text + ' ' + url).then(function (ok) { if (ok) toast(t('sheet.copied'), { priority: 'high' }); });
        return;
      }
      if (b.hasAttribute('data-dcard-save')) {
        if (cv) cards.download(cv, file).then(function (r) { if (r === 'downloaded') toast(t('psa.ready'), { priority: 'high' }); });
        return;
      }
      track('card_made', { template: kind === 'both' ? 'w3-dates' : 'w3-psa-' + kind, size: dsize });
      if (cv) cards.share(cv, { title: p.title, text: p.text, url: url, filename: file }).then(function (r) {
        if (r === 'downloaded') toast(t('psa.ready'), { priority: 'high' });
        else if (r === 'failed' && YSD.share) YSD.share.copy(p.text + ' ' + url).then(function () { toast(t('js.cardFail'), { priority: 'high' }); });
      });
      else if (YSD.share) YSD.share.native({ title: p.title, text: p.text, url: url }).then(shareDone);
    });
  }
  d.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-dates-open]'); if (!b || !sheet) return;
    e.preventDefault();
    if (YSD.ui && YSD.ui.sheet) YSD.ui.sheet.open(sheet, { opener: b }); else if (sheet.showModal) sheet.showModal();
    showCard();
    track('dates_sheet_open', {});
  });

  openHash();
})(window, document);
