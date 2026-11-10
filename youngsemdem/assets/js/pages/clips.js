/*!
 * assets/js/pages/clips.js (W4, round 1 G-VIDEO): "The Reel" (clips.html). BRIEF §4.5, §5.9, §6.
 * Video first at every width (genz-brand-05/25): one sticky bar (The Reel · DEMO, the weekly-prompt chip, a
 * formats-and-filters button), then the full-height clip feed. 1024 px and up: a side panel (prompt card, the
 * named formats as a shelf, topic filters, the moderation promise) and an "Up next" rail on every clip.
 * - Cards come from YSD.reel.card(…, {variant:'feed'}); the user's own clips show only as "Pending review"
 *   cards (YSD.post.pending), never in the feed.
 * - Poster first: no video bytes until the visitor engages (scroll, tap, key, mouse). Then feed.js loads and
 *   autoplays the clip most in view, muted (never under reduced motion, Save-Data or 2G: feed.js enforces it).
 * - Filters: a format (?series=<id>, from the badges and home) or a topic chip; both sync across the side panel
 *   and the filter sheet. Sheets: weekly prompt, formats and filters, How the Reel works (#how), post, report.
 * No view or like numbers anywhere. No AI. Untrusted text goes in with textContent.
 */
(function (w) {
  'use strict';
  var YSD = w.YSD = w.YSD || {};
  var d = w.document;
  if (!d || !d.body || !d.body.classList.contains('p-clips')) return;

  function t(key, vars) { return typeof YSD.t === 'function' ? YSD.t(key, vars) : ''; }
  function p(key, vars) { return t('clips:' + key, vars); }
  function lang() { return YSD.lang || 'en'; }
  function pick(o) { return o ? (o[lang()] || o.en || '') : ''; }
  function $(s, r) { return (r || d).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || d).querySelectorAll(s)); }
  function data() { return w.YSD_DATA || {}; }
  function el(tag, attrs, kids) {
    var n = d.createElement(tag);
    for (var k in attrs || {}) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'text') n.textContent = String(v); else if (k === 'class') n.className = v; else if (k === 'html') n.innerHTML = v; else n.setAttribute(k, v === true ? '' : String(v));
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? d.createTextNode(c) : c); });
    return n;
  }
  var base = (function () {
    try { var s = d.currentScript && d.currentScript.src; if (s) return s.replace(/assets\/js\/pages\/clips\.js.*$/, ''); } catch (e) {}
    return typeof YSD.root === 'string' ? YSD.root : '';
  })();
  function loadScript(rel, test) {
    if (test()) return Promise.resolve();
    return new Promise(function (res, rej) {
      var s = d.createElement('script');
      s.src = base + rel;
      s.onload = function () { test() ? res() : rej(new Error(rel)); };
      s.onerror = function () { rej(new Error(rel)); };
      d.body.appendChild(s);
    });
  }
  function whenPost() { return loadScript('assets/js/pages/post.js', function () { return !!(YSD.post && YSD.post.mount); }); }
  function sheetOpen(id, opener) { var dlg = d.getElementById(id); if (dlg && YSD.ui && YSD.ui.sheet) YSD.ui.sheet.open(dlg, { opener: opener }); return dlg; }
  function sheetClose(dlg) { if (YSD.ui && YSD.ui.sheet) YSD.ui.sheet.close(dlg); }

  var feedEl = $('[data-reel-feed]'), endCard = $('[data-reel-end]'), emptyEl = $('[data-reel-empty]');
  var R = data().reel || {};
  var state = { filter: 'all', clips: [], feed: null, attaching: null, userAct: 0, prompt: null };

  // ------------------------------------------------------------------ weekly prompt (side card + sheet)
  function renderPrompt() {
    var pr = state.prompt = YSD.reel && YSD.reel.prompt ? YSD.reel.prompt() : null;
    if (!pr) return;
    var datesTxt = YSD.fmt ? p('prompt.dates', { from: YSD.fmt.date(pr.from, { weekday: false }), to: YSD.fmt.date(pr.to, { weekday: false }) }) : '';
    var tips = [];
    if (pr.tips) tips = pr.tips.map(pick);
    else if (pr.script) {
      var sc = ((data().sharekit || {}).scripts || []).filter(function (s) { return s.id === pr.script; })[0];
      if (sc) {
        if (sc.hook && sc.hook.line) tips.push('“' + pick(sc.hook.line) + '”');
        if (sc.hook && sc.hook.onScreen) tips.push(pick(sc.hook.onScreen));
        if (sc.cta && sc.cta.onScreen) tips.push(pick(sc.cta.onScreen));
        if (sc.safety) tips.push(pick(sc.safety));
      }
    }
    if (!pr.rest) tips.push(p('prompt.tag', { tag: pr.tag }));
    var E = data().events || {}, ev = null;
    (E.items || []).forEach(function (it) { if (it.id === R.helpEvent && Date.parse(it.start) > Date.now()) ev = it; });
    $$('[data-reel-prompt]').forEach(function (box) {
      var datesEl = $('[data-prompt-dates]', box), subEl = $('[data-prompt-sub]', box);
      var titleEl = $('[data-prompt-title]', box) || $('[data-prompt-title]', box.closest('dialog') || box);
      if (datesEl) datesEl.textContent = datesTxt;
      if (pr.rest) {
        box.setAttribute('data-rest', 'true');
        if (titleEl) titleEl.textContent = p('prompt.rest');
        if (subEl) { subEl.textContent = p('prompt.restSub'); subEl.hidden = false; }
        var tb = $('[data-prompt-tips]', box); if (tb) tb.hidden = true;
        return;
      }
      if (titleEl) titleEl.textContent = pick(pr.title);
      var list = $('[data-prompt-tips] ul', box);
      if (list) { list.textContent = ''; tips.forEach(function (x) { if (x) list.appendChild(el('li', { text: x })); }); }
      var help = $('[data-prompt-help]', box);
      if (help && ev && YSD.fmt) {
        var a = $('a', help);
        a.href = 'events/' + ev.id + '.html';
        a.textContent = p('prompt.helpEvent', { title: pick(ev.title), when: YSD.fmt.date(ev.start, { time: true }), city: pick((E.cities || {})[ev.city]) || ev.city });
        help.hidden = false;
      }
    });
    if (pr.rest) { $$('[data-filter="prompt"]').forEach(function (c) { c.hidden = true; }); return; }
    $$('[data-post-open][data-post-prompt]').forEach(function (b) { b.setAttribute('data-tag', pr.tag); b.setAttribute('href', 'post.html?tag=' + encodeURIComponent(pr.tag)); });
  }

  // ------------------------------------------------------------------ formats (series) shelf
  function seriesCount(id) { return state.clips.filter(function (c) { return c.series === id; }).length; }
  function renderShelves() {
    var list = YSD.reel.series() || [];
    $$('[data-series-list]').forEach(function (ul) {
      ul.textContent = '';
      list.forEach(function (s) {
        var n = seriesCount(s.id);
        var b = el('button', { class: 'x-shelf__item', type: 'button', 'data-filter': 'series:' + s.id, 'aria-pressed': 'false', 'data-color': s.color });
        b.appendChild(el('span', { class: 'x-shelf__art', 'aria-hidden': 'true', html: (YSD.ui && YSD.ui.stickerSvg && YSD.ui.stickerSvg(s.sticker)) || '' }));
        var txt = el('span', { class: 'x-shelf__txt' });
        txt.appendChild(el('span', { class: 'x-shelf__name', lang: s.id === 'en-espanol' && lang() !== 'es' ? 'es' : null, text: pick(s.name) }));
        txt.appendChild(el('span', { class: 'x-shelf__blurb', text: pick(s.blurb) }));
        txt.appendChild(el('span', { class: 'x-shelf__meta', text: pick(s.cadence) + ' · ' + (n ? (YSD.t.plural ? YSD.t.plural('clips:shelf.count', n) : n) : p('shelf.first')) }));
        b.appendChild(txt);
        ul.appendChild(el('li', null, [b]));
      });
    });
  }

  // ------------------------------------------------------------------ filters + feed
  function filterDef(id) {
    if (/^series:/.test(id)) return { id: id, series: id.slice(7) };
    return (R.filters || []).filter(function (f) { return f.id === id; })[0] || { id: 'all' };
  }
  function filterName(f) {
    if (f.series) { var s = YSD.reel.series(f.series); return s ? pick(s.name) : f.series; }
    var chip = $('[data-filter="' + f.id + '"]');
    return chip ? chip.textContent.trim() : f.id;
  }
  function matches(clip, f) {
    if (f.id === 'all') return true;
    if (f.series) return clip.series === f.series;
    var tags = f.id === 'prompt' ? [state.prompt && state.prompt.tag].filter(Boolean) : (f.tags || []);
    return (clip.tags || []).some(function (x) { return tags.indexOf(String(x).toLowerCase()) >= 0; });
  }
  function load() {
    return YSD.clips.list({ sort: 'new' }).then(function (all) {
      state.clips = all.filter(function (c) { return c.source !== 'local'; });
      renderShelves();
      syncFilterUi();
      render();
    });
  }
  function upNext(list, i) {
    var next = [];
    for (var k = 1; k <= 3 && list.length > 1; k++) { var c = list[(i + k) % list.length]; if (c && next.indexOf(c) < 0 && c !== list[i]) next.push(c); }
    if (!next.length) return null;
    var box = el('div', { class: 'x-upnext' }, [el('p', { class: 'x-upnext__title', text: p('upnext.title') })]);
    var ol = el('ol', { class: 'x-upnext__list' });
    next.forEach(function (c) {
      var f = YSD.reel.info(c), s = c.series && YSD.reel.series(c.series);
      var b = el('button', { class: 'x-upnext__item', type: 'button', 'data-goto': c.id, 'aria-label': p('upnext.go', { title: f.title }), 'data-feed-ignore': true });
      var th = el('span', { class: 'x-upnext__thumb', 'aria-hidden': 'true' });
      if (c.color && /^#[0-9a-f]{6}$/i.test(c.color)) th.style.setProperty('--clip-color', c.color);
      if (c.lqip && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(c.lqip)) th.style.setProperty('--clip-lqip', 'url(' + c.lqip + ')');
      if (c.poster) th.appendChild(el('img', { src: c.poster, alt: '', width: 54, height: 96, loading: 'lazy', decoding: 'async' }));
      b.appendChild(th);
      var tx = el('span', { class: 'x-upnext__txt' }, [el('span', { class: 'x-upnext__name', text: f.title })]);
      if (s) tx.appendChild(el('span', { class: 'x-upnext__series', text: pick(s.name) }));
      b.appendChild(tx);
      b.addEventListener('click', function () { goTo(c.id); });
      ol.appendChild(el('li', null, [b]));
    });
    box.appendChild(ol);
    return box;
  }
  function render() {
    var f = filterDef(state.filter);
    var shown = state.clips.filter(function (c) { return matches(c, f); });
    feedEl.textContent = '';
    shown.forEach(function (c, i) {
      var card = YSD.reel.card(c, { variant: 'feed', index: i, total: shown.length, moreHref: 'clips.html' });
      var info = $('.x-clip__info', card), un = upNext(shown, i);
      if (info && un) info.appendChild(un);
      feedEl.appendChild(card);
    });
    if (emptyEl) emptyEl.hidden = shown.length > 0;
    if (endCard) endCard.hidden = shown.length === 0;
    renderHidden();
    if (state.feed && state.feed.refresh) state.feed.refresh();
    return shown.length;
  }
  function renderHidden() {
    var b = $('[data-reel-unhide]');
    if (!b) return;
    var h = (YSD.store && YSD.store.get('clips:hidden', {})) || {}, n = Object.keys(h).length;
    b.hidden = !n;
    var s = $('span', b) || b;
    s.textContent = p('end.hidden', { count: n });
  }
  function syncFilterUi() {
    var f = filterDef(state.filter);
    $$('[data-filter]').forEach(function (c) { c.setAttribute('aria-pressed', String(c.getAttribute('data-filter') === state.filter)); });
    var on = f.id !== 'all', name = on ? filterName(f) : '';
    var dot = $('[data-filter-dot]'); if (dot) dot.hidden = !on;
    var lbl = $('[data-filter-btn-label]'); if (lbl) lbl.textContent = on ? p('bar.filtersOn', { name: name }) : p('bar.filters');
    var line = $('[data-filter-line]');
    if (line) { line.hidden = !on; var tx = $('[data-filter-line-text]', line); if (tx) tx.textContent = on ? p('filters.showing', { name: name }) : ''; }
  }
  function setFilter(id, opts) {
    opts = opts || {};
    if (id === state.filter && !opts.force) return;
    state.filter = id;
    syncFilterUi();
    var n = render();
    if (YSD.reel && !opts.quiet) YSD.reel.announce(YSD.t.plural('clips:filters.count', n));
    try {
      var u = new URL(w.location.href);
      u.searchParams.delete('series');
      if (/^series:/.test(id)) u.searchParams.set('series', id.slice(7));
      u.hash = '';
      w.history.replaceState(null, '', u.pathname + u.search);
    } catch (e) {}
    if (!opts.noScroll) {
      var top = $('[data-reel-feed-top]');
      if (top) top.scrollIntoView({ block: 'start' });
    }
  }
  function wireFilters() {
    d.addEventListener('click', function (e) {
      var chip = e.target.closest && e.target.closest('[data-filter]');
      if (!chip) return;
      var id = chip.getAttribute('data-filter');
      if (chip.getAttribute('aria-pressed') === 'true' && id !== 'all') id = 'all';   // a second tap on a format clears it
      var dlg = chip.closest('dialog');
      setFilter(id, { force: true });
      if (dlg) sheetClose(dlg);
    });
    var clr = $('[data-filter-clear]');
    if (clr) clr.addEventListener('click', function () { setFilter('all'); var b = $('[data-filter-btn]'); if (b) b.focus({ preventScroll: true }); });
  }
  function goTo(id) {
    var item = d.getElementById('clip-' + id);
    if (!item) return;
    state.userAct = Date.now();
    item.scrollIntoView({ block: 'start', behavior: w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    var b = $('[data-feed-play]', item); if (b) setTimeout(function () { b.focus({ preventScroll: true }); }, 300);
  }

  // ------------------------------------------------------------------ attach on intent
  function attachFeed() {
    if (state.attaching) return state.attaching;
    state.attaching = YSD.reel.whenFeed().then(function (F) {
      state.feed = F.attach(feedEl, { autoplay: 'auto', preload: 1, keyboard: true, scrollBehavior: 'smooth' });
      var note = $('[data-reel-autoplay-off]');
      if (note) note.hidden = state.feed.autoplayAllowed();
      return state.feed;
    }).catch(function () { state.attaching = null; });
    return state.attaching;
  }
  var INTENT = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
  function onIntent(e) {
    if (e.type === 'pointermove') {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      state.moved = (state.moved || 0) + Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);
      if (state.moved < 24) return;
    }
    if (e.type === 'scroll' && (w.scrollY || 0) < 40) return;
    if (e.target && e.target.closest && e.target.closest('dialog')) return;
    stopIntent();
    var replay = e.type === 'keydown' && /^(j|J|k|K|l|L|m|M|ArrowDown|ArrowUp)$/.test(e.key) && !e.altKey && !e.ctrlKey && !e.metaKey &&
      !(e.target && e.target.closest && e.target.closest('input, textarea, select, [contenteditable], dialog')) ? e : null;
    attachFeed().then(function (f) {
      if (!f || !replay) return;
      var sent = false, off = null;
      function send() {
        if (sent) return; sent = true; if (off) setTimeout(off, 0);
        (replay.target || d).dispatchEvent(new KeyboardEvent('keydown', { key: replay.key, code: replay.code, bubbles: true, cancelable: true }));
      }
      if (f.index >= 0) return send();
      off = f.on('change', send);
      setTimeout(send, 600);
    });
  }
  function stopIntent() { INTENT.concat(['pointermove', 'scroll']).forEach(function (n) { w.removeEventListener(n, onIntent, { passive: true }); }); }
  function startIntent() { INTENT.concat(['pointermove', 'scroll']).forEach(function (n) { w.addEventListener(n, onIntent, { passive: true }); }); }
  // A tap on a card before feed.js is ready: attach, then replay the tap so YSD.feed handles it.
  function onCardTapBeforeFeed(e) {
    if (state.feed) return;
    var item = e.target.closest && e.target.closest('[data-feed-item]');
    if (!item || e.target.closest('a, details, summary, [data-feed-ignore], [data-reel-share], [data-reel-more], [data-reel-cc]')) return;
    e.preventDefault(); e.stopPropagation();
    var target = e.target, x = e.clientX, y = e.clientY;
    attachFeed().then(function () {
      // autoplay may have started this very clip while feed.js loaded: then a Play tap is already done
      var v = item.querySelector('video');
      if (target.closest && target.closest('[data-feed-play]') && v && !v.paused) return;
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    });
  }

  // ------------------------------------------------------------------ feed feedback
  function wireFeedEvents() {
    feedEl.addEventListener('click', function (e) { if (e.target.closest('[data-feed-play], [data-feed-mute], [data-feed-like]')) state.userAct = Date.now(); }, true);
    d.addEventListener('keydown', function (e) { if (/^( |k|K|j|J|m|M|l|L|ArrowUp|ArrowDown)$/.test(e.key)) state.userAct = Date.now(); }, true);
    function user() { return Date.now() - state.userAct < 1500; }
    feedEl.addEventListener('ysd:feed-play', function () { if (user()) YSD.reel.announce(p('reel.playing')); });
    feedEl.addEventListener('ysd:feed-pause', function () { if (user()) YSD.reel.announce(p('reel.paused')); });
    feedEl.addEventListener('ysd:feed-mute', function (e) { if (e.detail && e.detail.reason === 'user') YSD.reel.announce(p(e.detail.muted ? 'reel.soundOff' : 'reel.soundOn')); });
    // genz-brand-22: the next two posters load as soon as a clip becomes active, so a fast swipe never lands on black
    feedEl.addEventListener('ysd:feed-change', function (e) {
      var items = $$('[data-feed-item]', feedEl), i = e.detail && e.detail.index;
      if (typeof i !== 'number') return;
      [i + 1, i + 2].forEach(function (k) { if (items[k]) YSD.reel.poster(items[k]); });
    });
    feedEl.addEventListener('ysd:feed-like', function (e) {
      var det = e.detail || {}, item = det.item;
      if (item && det.via === 'doubletap' && det.x != null) {
        var b = $('.x-clip__burst', item), fr = $('.x-clip__frame', item);
        if (b && fr) {
          var fb = fr.getBoundingClientRect(), ib = item.getBoundingClientRect();
          b.style.setProperty('--x', (det.x - (fb.left - ib.left)) + 'px');
          b.style.setProperty('--y', (det.y - (fb.top - ib.top)) + 'px');
          b.removeAttribute('data-on'); void b.offsetWidth; b.setAttribute('data-on', '');
        }
      }
      YSD.reel.announce(p(det.liked === false ? 'reel.unliked' : 'reel.liked'));
    });
  }

  // ------------------------------------------------------------------ report sheet
  var reportFor = null;
  function legalReport() { var L = data().legal; return (L && L.snippets && L.snippets.report) || null; }
  function buildReport() {
    var dlg = $('#report-sheet'), form = dlg && $('[data-report-form]', dlg), rep = legalReport();
    if (!form || !rep || form.__built) return dlg;
    form.__built = true;
    $('#report-title', dlg).textContent = pick(rep.title);
    var fs = el('fieldset', { class: 'field field--choice x-report__reasons' }, [el('legend', { text: pick(rep.prompt) })]);
    rep.reasons.forEach(function (r) {
      fs.appendChild(el('label', { class: 'choice' }, [el('input', { type: 'radio', name: 'reason', value: r.id }), el('span', { text: pick(r.label) })]));
    });
    var sum = el('div', { class: 'form__summary', hidden: true }, [el('p', { class: 'form__summary-title', 'data-summary-title': true }), el('ul')]);
    var det = el('div', { class: 'field' }, [
      el('label', { class: 'field__label', for: 'report-details', text: pick(rep.details) }),
      el('textarea', { id: 'report-details', name: 'details', rows: 3, maxlength: 600 })
    ]);
    var danger = el('p', { class: 'notice notice--warn x-report__danger', text: pick(rep.danger) });
    var demo = el('p', { class: 'consent' }, [el('span', { text: p('report.demo') })]);
    var btns = el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn btn--primary', type: 'submit', text: p('report.send') }),
      el('button', { class: 'btn btn--quiet', type: 'button', 'data-sheet-close': true, text: t('cta.cancel') || 'Cancel' })
    ]);
    var done = el('div', { class: 'x-report__done', 'data-report-done': true, hidden: true }, [
      el('p', { class: 'h4', tabindex: '-1', 'data-report-done-title': true, text: pick(rep.thanks) }),
      el('p', { class: 'small', text: p('report.demo') }),
      el('div', { class: 'btn-row' }, [el('button', { class: 'btn btn--primary', type: 'button', 'data-sheet-close': true, text: t('cta.done') || 'Done' })])
    ]);
    [sum, danger, fs, det, demo, btns].forEach(function (n) { form.appendChild(n); });
    form.parentNode.appendChild(done);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var r = $('[name="reason"]:checked', form);
      if (!r) { YSD.ui.form.errors(form, { reason: 'required' }, { messages: { reason: p('report.pick') } }); return; }
      YSD.ui.form.clear(form);
      var id = reportFor;
      Promise.resolve(id && YSD.clips.remove(id)).then(function () {
        form.hidden = true; done.hidden = false;
        var h = $('[data-report-done-title]', done); if (h) h.focus();
        state.clips = state.clips.filter(function (c) { return c.id !== id; });
      });
    });
    dlg.addEventListener('close', function () {
      if (form.hidden) {
        var idx = Math.max(0, $$('[data-feed-item]', feedEl).map(function (n) { return n.getAttribute('data-clip-id'); }).indexOf(reportFor));
        render(); renderShelves(); syncFilterUi();
        var next = $$('[data-feed-item]', feedEl)[idx] || $$('[data-feed-item]', feedEl).pop();
        var target = next ? $('[data-feed-play]', next) : $('[data-reel-feed-top]');
        setTimeout(function () { if (target) { target.focus({ preventScroll: true }); (next || target).scrollIntoView({ block: 'start' }); } }, 30);
      }
    });
    return dlg;
  }
  function openReport(id, opener) {
    var dlg = buildReport();
    if (!dlg) return;
    var form = $('[data-report-form]', dlg), done = $('[data-report-done]', dlg);
    form.reset(); form.hidden = false; if (done) done.hidden = true;
    YSD.ui.form.clear(form);
    reportFor = id;
    var clip = state.clips.filter(function (c) { return c.id === id; })[0];
    var about = $('[data-report-about]', dlg);
    if (about) about.textContent = clip ? p('report.about', { who: (clip.author && clip.author.handle) || '' }) : '';
    YSD.ui.sheet.open(dlg, { opener: opener });
  }

  // ------------------------------------------------------------------ post sheet + pending
  var postApi = null;
  function openPost(opener, tag) {
    whenPost().then(function () {
      var dlg = $('#post-sheet'), form = $('[data-post-form]', dlg);
      if (!postApi) postApi = YSD.post.mount(form, { mode: 'sheet', tag: tag, onDone: function () {
        YSD.ui.sheet.close(dlg);
        showPending().then(function () {
          var sec = $('[data-post-pending]');
          if (sec) sec.scrollIntoView({ block: 'nearest' });
        });
      } });
      else postApi.setTag(tag || '');
      if (postApi.step) postApi.step(1, { focus: false });
      var open = d.querySelector('dialog[open]');
      if (open && open !== dlg) sheetClose(open);
      YSD.ui.sheet.open(dlg, { opener: opener });
    }, function () { w.location.href = 'post.html' + (tag ? '?tag=' + encodeURIComponent(tag) : ''); });
  }
  function showPending() {
    var sec = $('[data-post-pending]');
    if (!sec) return Promise.resolve(0);
    return whenPost().then(function () { return YSD.post.pending(sec, { focusAfter: '[data-filter-btn]' }); });
  }
  function storedPending() {
    try {
      var s = YSD.store;
      var a = s && s.get('clips:links', []), b = s && s.get('clips:local', []);
      return (Array.isArray(a) && a.length) || (Array.isArray(b) && b.length);
    } catch (e) { return false; }
  }

  // ------------------------------------------------------------------ desktop Previous / Next
  function wireNav() {
    var nav = $('[data-reel-nav]');
    if (!nav || !w.matchMedia) return;
    var mq = w.matchMedia('(hover: hover) and (min-width: 1024px)'), inView = false;
    function sync() { nav.hidden = !(mq.matches && inView && $$('[data-feed-item]', feedEl).length > 1); }
    if ('IntersectionObserver' in w) new IntersectionObserver(function (es) {
      var e = es[0], vh = w.innerHeight || 1;
      inView = e.isIntersecting && e.intersectionRect.height > vh * 0.5;
      sync();
    }, { threshold: [0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 0.7, 0.9, 1] }).observe(feedEl);
    if (mq.addEventListener) mq.addEventListener('change', sync);
    function step(dir) {
      state.userAct = Date.now();
      attachFeed().then(function (f) { if (!f) return; if (dir > 0) f.next(); else f.prev(); });
    }
    $('[data-reel-prev]', nav).addEventListener('click', function () { step(-1); });
    $('[data-reel-next]', nav).addEventListener('click', function () { step(1); });
  }

  // ------------------------------------------------------------------ boot
  function boot() {
    if (!feedEl || !YSD.reel || !YSD.clips) return;
    var q = {};
    try { new URL(w.location.href).searchParams.forEach(function (v, k) { q[k] = v; }); } catch (e) {}
    if (q.series && /^[a-z0-9-]+$/.test(q.series)) state.filter = 'series:' + q.series;
    renderPrompt();
    wireFilters();
    wireNav();
    wireFeedEvents();
    feedEl.addEventListener('click', onCardTapBeforeFeed, true);
    startIntent();
    d.addEventListener('ysd:reel-report', function (e) { openReport(e.detail.id, e.detail.opener); });
    d.addEventListener('ysd:reel-how', function (e) { sheetOpen('how-sheet', e.detail && e.detail.opener); });
    d.addEventListener('ysd:clips-changed', function (e) {
      var r = e.detail && e.detail.reason;
      if (r === 'unhide' || r === 'reset') load();
    });
    // post buttons and the Open Mic action chip open the post sheet (post.html without JS)
    d.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-post-open], [data-reel-action="post"]');
      if (!b) return;
      e.preventDefault();
      openPost(b, b.getAttribute('data-tag') || b.getAttribute('data-post-tag') || '');
    });
    // a link inside one sheet that opens another
    $$('[data-sheet-swap]').forEach(function (b) {
      b.addEventListener('click', function () {
        var cur = b.closest('dialog'), opener = $('[data-filter-btn]');
        if (cur) sheetClose(cur);
        setTimeout(function () { sheetOpen(b.getAttribute('data-sheet-swap'), opener); }, 30);
      });
    });
    var watch = $('[data-prompt-watch]');
    if (watch) watch.addEventListener('click', function () { var dl = watch.closest('dialog'); if (dl) sheetClose(dl); setFilter('series:open-mic', { force: true }); });
    var un = $('[data-reel-unhide]');
    if (un) un.addEventListener('click', function () { YSD.clips.unhideAll(); });
    var top = $('[data-reel-top]');
    if (top) top.addEventListener('click', function () {
      var first = $('[data-feed-item]', feedEl);
      if (first) { first.scrollIntoView({ block: 'start' }); var b = $('[data-feed-play]', first); if (b) b.focus({ preventScroll: true }); }
    });
    if (storedPending()) showPending();
    load().then(function () {
      var hash = String(w.location.hash || '');
      if (hash === '#how') { sheetOpen('how-sheet', $('[data-filter-btn]')); return; }
      var id = q.report || (hash.indexOf('#clip-') === 0 ? hash.slice(6) : '');
      var item = id && d.getElementById('clip-' + id);
      if (item) {
        item.scrollIntoView({ block: 'start' });
        if (q.report) openReport(id, $('[data-reel-more]', item));
      }
    });
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', boot); else boot();
})(window);
