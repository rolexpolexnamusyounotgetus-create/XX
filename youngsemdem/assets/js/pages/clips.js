/*!
 * assets/js/pages/clips.js (W4): "The Reel" feed page (clips.html). BRIEF §4.5, §5.9, §6.
 * - Renders the public clips with YSD.reel.card(…, {variant:'feed'}) into [data-reel-feed]; the
 *   user's own clips show only as "Pending review" cards (YSD.post.pending), never in the feed.
 * - Poster first: no video bytes until the visitor engages (scroll, tap, key, mouse). Then feed.js is
 *   loaded and YSD.feed autoplays the clip most in view, muted (never under reduced motion,
 *   Save-Data or 2G: feed.js enforces it).
 * - Weekly prompt card from YSD.reel.prompt(); tag filters; report sheet (legal snippets); the post
 *   sheet (same form as post.html, wired by assets/js/pages/post.js, loaded on demand).
 * No view or like numbers anywhere. No AI. Untrusted text goes in with textContent.
 */
(function (w) {
  'use strict';
  var YSD = w.YSD = w.YSD || {};
  var d = w.document;
  if (!d.body || !d.body.classList.contains('p-clips')) return;

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

  var feedEl = $('[data-reel-feed]'), endCard = $('[data-reel-end]'), emptyEl = $('[data-reel-empty]');
  var R = data().reel || {};
  var state = { filter: 'all', clips: [], feed: null, attaching: null, userAct: 0, prompt: null };

  // ------------------------------------------------------------------ weekly prompt
  function renderPrompt() {
    var box = $('[data-reel-prompt]');
    var pr = state.prompt = YSD.reel && YSD.reel.prompt ? YSD.reel.prompt() : null;
    if (!box || !pr) return;
    var datesEl = $('[data-prompt-dates]', box), titleEl = $('[data-prompt-title]', box), subEl = $('[data-prompt-sub]', box);
    if (datesEl && YSD.fmt) datesEl.textContent = p('prompt.dates', { from: YSD.fmt.date(pr.from, { weekday: false }), to: YSD.fmt.date(pr.to, { weekday: false }) });
    if (pr.rest) {
      box.setAttribute('data-rest', 'true');
      if (titleEl) titleEl.textContent = p('prompt.rest');
      if (subEl) { subEl.textContent = p('prompt.restSub'); subEl.hidden = false; }
      var tips0 = $('[data-prompt-tips]', box); if (tips0) tips0.hidden = true;
      var chip = $('[data-filter="prompt"]'); if (chip) chip.hidden = true;
      return;
    }
    if (titleEl) titleEl.textContent = pick(pr.title);
    $$('[data-post-open]').forEach(function (b) { if (b.hasAttribute('data-post-prompt')) b.setAttribute('data-tag', pr.tag); });
    // "How to film it": the prompt's own tips, or the sharekit script's hook, end card and safety note.
    var tipsBox = $('[data-prompt-tips]', box), list = tipsBox && $('ul', tipsBox), tips = [];
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
    tips.push(p('prompt.tag', { tag: pr.tag }));
    if (list) { list.textContent = ''; tips.forEach(function (x) { if (x) list.appendChild(el('li', { text: x })); }); }
    // Every viral moment ends offline: the creator-night DEMO event, while it's upcoming.
    var help = $('[data-prompt-help]', box), E = data().events || {}, ev = null;
    (E.items || []).forEach(function (it) { if (it.id === R.helpEvent && Date.parse(it.start) > Date.now()) ev = it; });
    if (help && ev && YSD.fmt) {
      var a = $('a', help);
      a.href = 'events/' + ev.id + '.html';
      a.textContent = p('prompt.helpEvent', { title: pick(ev.title), when: YSD.fmt.date(ev.start, { time: true }), city: pick((E.cities || {})[ev.city]) || ev.city });
      help.hidden = false;
    }
  }

  // ------------------------------------------------------------------ filters + feed
  function filterDef(id) { return (R.filters || []).filter(function (f) { return f.id === id; })[0] || { id: 'all' }; }
  function matches(clip, f) {
    if (f.id === 'all') return true;
    var tags = f.id === 'prompt' ? [state.prompt && state.prompt.tag].filter(Boolean) : (f.tags || []);
    return (clip.tags || []).some(function (x) { return tags.indexOf(String(x).toLowerCase()) >= 0; });
  }
  function load() {
    return YSD.clips.list({ sort: 'new' }).then(function (all) {
      state.clips = all.filter(function (c) { return c.source !== 'local'; });
      render();
    });
  }
  function render() {
    var f = filterDef(state.filter);
    var shown = state.clips.filter(function (c) { return matches(c, f); });
    feedEl.textContent = '';
    shown.forEach(function (c, i) { feedEl.appendChild(YSD.reel.card(c, { variant: 'feed', index: i, total: shown.length })); });
    if (emptyEl) emptyEl.hidden = shown.length > 0;
    if (endCard) endCard.hidden = shown.length === 0;
    var countEl = $('[data-reel-count]');
    if (countEl) countEl.textContent = YSD.t.plural ? YSD.t.plural('clips:filters.count', shown.length) : String(shown.length);
    renderHidden();
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
  function wireFilters() {
    $$('[data-filter]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var id = chip.getAttribute('data-filter');
        if (id === state.filter) return;
        state.filter = id;
        $$('[data-filter]').forEach(function (c) { c.setAttribute('aria-pressed', String(c === chip)); });
        var n = render();
        if (YSD.reel) YSD.reel.announce(YSD.t.plural('clips:filters.count', n));
        var top = $('[data-reel-feed-top]');
        if (top && top.getBoundingClientRect().top < 0) top.scrollIntoView({ block: 'start' });
      });
    });
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
      // Browsers fire synthetic mouse moves on load and layout (movement 0): only a real move of 24 px counts.
      if (e.pointerType && e.pointerType !== 'mouse') return;
      state.moved = (state.moved || 0) + Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);
      if (state.moved < 24) return;
    }
    if (e.type === 'scroll' && (w.scrollY || 0) < 40) return;
    stopIntent();
    var replay = e.type === 'keydown' && /^(j|J|k|K|l|L|m|M|ArrowDown|ArrowUp)$/.test(e.key) && !e.altKey && !e.ctrlKey && !e.metaKey &&
      !(e.target && e.target.closest && e.target.closest('input, textarea, select, [contenteditable], dialog')) ? e : null;
    attachFeed().then(function (f) {
      // The first j/k press only loaded feed.js: replay it so the feed moves on the first try.
      if (f && replay) (replay.target || d).dispatchEvent(new KeyboardEvent('keydown', { key: replay.key, code: replay.code, bubbles: true, cancelable: true }));
    });
  }
  function stopIntent() {
    INTENT.concat(['pointermove', 'scroll']).forEach(function (n) { w.removeEventListener(n, onIntent, { passive: true }); });
  }
  function startIntent() {
    INTENT.concat(['pointermove', 'scroll']).forEach(function (n) { w.addEventListener(n, onIntent, { passive: true }); });
  }
  // A tap on a card before feed.js is ready: attach, then replay the tap so YSD.feed handles it.
  function onCardTapBeforeFeed(e) {
    if (state.feed) return;
    var item = e.target.closest && e.target.closest('[data-feed-item]');
    if (!item || e.target.closest('a, details, summary, [data-reel-share], [data-reel-report], [data-reel-controls]')) return;
    e.preventDefault(); e.stopPropagation();
    var target = e.target, x = e.clientX, y = e.clientY;
    attachFeed().then(function () { target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y })); });
  }

  // ------------------------------------------------------------------ feed feedback
  function wireFeedEvents() {
    feedEl.addEventListener('click', function (e) { if (e.target.closest('[data-feed-play], [data-feed-mute], [data-feed-like]')) state.userAct = Date.now(); }, true);
    d.addEventListener('keydown', function (e) { if (/^( |k|K|j|J|m|M|l|L|ArrowUp|ArrowDown)$/.test(e.key)) state.userAct = Date.now(); }, true);
    function user() { return Date.now() - state.userAct < 1500; }
    feedEl.addEventListener('ysd:feed-play', function () { if (user()) YSD.reel.announce(p('reel.playing')); });
    feedEl.addEventListener('ysd:feed-pause', function () { if (user()) YSD.reel.announce(p('reel.paused')); });
    feedEl.addEventListener('ysd:feed-mute', function (e) { if (e.detail && e.detail.reason === 'user') YSD.reel.announce(p(e.detail.muted ? 'reel.soundOff' : 'reel.soundOn')); });
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
  var reportFor = null, reportOpener = null;
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
        // the reported clip is hidden now: re-render and put focus on the next clip
        var idx = Math.max(0, $$('[data-feed-item]', feedEl).map(function (n) { return n.getAttribute('data-clip-id'); }).indexOf(reportFor));
        render();
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
    reportFor = id; reportOpener = opener;
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
      YSD.ui.sheet.open(dlg, { opener: opener });
    }, function () { w.location.href = 'post.html' + (tag ? '?tag=' + encodeURIComponent(tag) : ''); });
  }
  function showPending() {
    var sec = $('[data-post-pending]');
    if (!sec) return Promise.resolve(0);
    return whenPost().then(function () { return YSD.post.pending(sec, { focusAfter: '[data-post-open]' }); });
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
    renderPrompt();
    wireFilters();
    wireNav();
    wireFeedEvents();
    feedEl.addEventListener('click', onCardTapBeforeFeed, true);
    startIntent();
    d.addEventListener('ysd:reel-report', function (e) { openReport(e.detail.id, e.detail.opener); });
    d.addEventListener('ysd:clips-changed', function (e) {
      var r = e.detail && e.detail.reason;
      if (r === 'unhide' || r === 'reset') load();
    });
    $$('[data-post-open]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.preventDefault(); openPost(b, b.getAttribute('data-tag') || ''); });
    });
    var un = $('[data-reel-unhide]');
    if (un) un.addEventListener('click', function () { YSD.clips.unhideAll(); });
    var top = $('[data-reel-top]');
    if (top) top.addEventListener('click', function () {
      var first = $('[data-feed-item]', feedEl);
      if (first) { first.scrollIntoView({ block: 'start' }); var b = $('[data-feed-play]', first); if (b) b.focus({ preventScroll: true }); }
    });
    if (storedPending()) showPending();
    load().then(function () {
      var q = '', hash = String(w.location.hash || '');
      try { q = new URL(w.location.href).searchParams.get('report') || ''; } catch (e) {}
      var id = q || (hash.indexOf('#clip-') === 0 ? hash.slice(6) : '');
      var item = id && d.getElementById('clip-' + id);
      if (item) {
        item.scrollIntoView({ block: 'start' });
        if (q) openReport(id, $('[data-reel-report]', item));
      }
    });
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', boot); else boot();
})(window);
