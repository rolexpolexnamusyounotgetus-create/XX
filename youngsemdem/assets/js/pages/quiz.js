/*! YDSC · assets/js/pages/quiz.js (W5; G-GROWTH round 1, Nov 10, 2026). quiz.html and the static result pages
 * (quiz/show-up/*, quiz/issue/*). Classic script, no AI.
 *
 * quiz.html: the two quizzes in "app mode" (the hero and galleries step aside, each question gets a full-bleed colour
 * world, picture tiles on three questions, the picked answer pops, an honest "Leaning: …" line from question 4),
 * the result reveal (character, name, top-two numerals, the poster card via YSD.maker compact, 3 actions, event
 * series that never dead-end), the type and issue galleries and "Me, on the cover". quiz.html#show-up and #issue
 * start that quiz on load and on hashchange (journeys-16).
 * Result pages ([data-quiz-rpage] on <main>, config JSON from tools/make_quiz_pages.js): "Kira got The Hype Captain.
 * Your turn…" from ?from= (letters only, textContent), the share button sends quiz.html#<quiz> with MY ref and from
 * (journeys-23), and the event series re-check against today's calendar and the January drop (journeys-05).
 *
 * Scoring is the reference scorer from data/quiz.js, copied verbatim (tests compare the two).
 * Stores only quiz:<quizId>:result = { resultId, undertone, ts } (never the answers).
 * Analytics: quiz_start { quiz }, quiz_complete { quiz, result }.
 * Test hook: YSD.quizPage = { score, state, start(id, mode), answer(optionId), skip(), series(ids) }.
 */
(function (w, d) {
  'use strict';
  var YSD = w.YSD = w.YSD || {};
  var DATA = w.YSD_DATA || {}, Q = DATA.quiz || {}, I = DATA.issues || {};
  var L = YSD.lang === 'es' ? 'es' : 'en';
  var ART = { hype: 'sun', chat: 'calendar', data: 'cypress', doors: 'chicken', creator: 'camera', plusone: 'heart' };
  var DARK = { violet: 1, 'violet-deep': 1, lake: 1, night: 1 };
  var WORLDS = ['celery', 'sky', 'bubblegum', 'tangerine', 'mint', 'violet', 'sun', 'teal'];

  function t(k, v) { return YSD.t ? YSD.t('quiz:' + k, v) : ''; }
  function pick(o) { return !o ? '' : typeof o === 'string' ? o : (o[L] != null ? o[L] : (o.en || '')); }
  function fill(s, v) { return String(s == null ? '' : s).replace(/\{(\w+)\}/g, function (m, k) { return v && v[k] != null ? String(v[k]) : m; }); }
  function longest(s) { return String(s || '').split(/\s+/).reduce(function (m, x) { return Math.max(m, x.length); }, 0); }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  function statVal(st) { return (L === 'es' && st.valueEs) || st.value; }
  function srcName(f) { return String(f.sourceName || '').split(/[,:]/)[0].trim(); }
  function $(s, r) { return (r || d).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || d).querySelectorAll(s)); }
  function byId(a, id) { for (var i = 0; i < (a || []).length; i++) if (a[i] && a[i].id === id) return a[i]; return null; }
  function track(e, p) { try { if (YSD.track) YSD.track(e, p); } catch (x) {} }
  function toast(text, o) { if (YSD.ui && YSD.ui.toast && text) YSD.ui.toast(text, o || {}); }
  function reduced() { try { return YSD.ui && YSD.ui.motion ? YSD.ui.motion.paused() : w.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  function h(tag, attrs, kids) {
    var el = d.createElement(tag);
    for (var k in attrs || {}) {
      var v = attrs[k]; if (v == null || v === false) continue;
      if (k === 'text') el.textContent = v; else if (k === 'cls') el.className = v;
      else if (k === 'style') for (var s in v) el.style.setProperty(s, v[s]);
      else el.setAttribute(k, v === true ? '' : v);
    }
    (kids || []).forEach(function (c) { if (c) el.appendChild(typeof c === 'string' ? d.createTextNode(c) : c); });
    return el;
  }
  function colorVar(name, kind) { return kind === 'issue' ? 'var(--issue-' + name + ')' : 'var(--' + name + ')'; }
  function onColor(name) { return DARK[name] ? 'var(--cream)' : 'var(--night)'; }
  function root() { return YSD.root || ''; }
  function charSrc(p) { return root() + 'assets/img/characters/' + p + '.svg'; }

  // ---------------------------------------------------------------- sender (?from), shared by both page kinds
  /** The sender's first name from ?from=: letters (any script), spaces, apostrophes and hyphens, 20 at most. */
  function fromName() {
    var v = '';
    try { v = new URLSearchParams(w.location.search).get('from') || ''; } catch (e) { v = ''; }
    v = v.replace(/\s+/g, ' ').trim();
    return /^[\p{L}\p{M}]+(?:[ '’-][\p{L}\p{M}]+)*$/u.test(v) && v.length <= 20 ? v : '';
  }
  function hasRef() { try { return !!new URLSearchParams(w.location.search).get('ref'); } catch (e) { return false; } }

  // ---------------------------------------------------------------- events: series that never dead-end (journeys-05)
  function events() { var E = DATA.events; return (E && E.items) || []; }
  function drop() { var E = DATA.events; return (E && E.schedule && E.schedule.drop) || null; }
  function dropClosed() {
    var dr = drop();
    return !!(dr && Date.now() < Date.parse(dr.opensAt) && !/[?&]drop=open(&|$)/.test(String(w.location.search)));
  }
  function upcoming(e) { return e && e.status !== 'cancelled' && Date.parse(e.end || e.start) >= Date.now(); }
  function hiddenByDrop(e) { var dr = drop(); return dropClosed() && Date.parse(e.start) > Date.parse(dr.cutoff); }
  /** 'open' (a visible upcoming event), 'drop' (only events behind the closed January drop) or 'none'. */
  function seriesState(s) {
    var st = 'none';
    events().forEach(function (e) { if (e.series !== s || !upcoming(e)) return; if (!hiddenByDrop(e)) st = 'open'; else if (st !== 'open') st = 'drop'; });
    return st;
  }
  function kindOpen(k) { return events().some(function (e) { return e.kind === k && upcoming(e) && !hiddenByDrop(e); }); }
  function kindOfSeries(s) { var e = events().filter(function (x) { return x.series === s; })[0]; return e ? e.kind : ''; }
  var PRE = '';   // path from this page to the language root: '' on quiz.html, '../../' on result pages
  function nextEvent(series) {
    var best = null;
    events().forEach(function (e) {
      if (series.indexOf(e.series) < 0 || !upcoming(e) || hiddenByDrop(e)) return;
      if (!best || Date.parse(e.start) < Date.parse(best.start)) best = e;
    });
    return best;
  }
  function notifyDrop(btn, done) {
    var dr = drop(); if (!dr || !YSD.cal) return;
    var end = new Date(Date.parse(dr.opensAt) + 30 * 60000).toISOString(), link = '';
    try { link = YSD.share.url((L === 'es' ? 'es/' : '') + 'events.html'); } catch (e) { link = ''; }
    var ok = YSD.cal.download({ id: 'ydsc-drop-2026-12-15', title: pick(dr.calTitle), start: dr.opensAt, end: end, description: pick(dr.calDescription), url: link, alarm: 15 });
    if (ok) { toast(done, { priority: 'high' }); if (btn) btn.setAttribute('data-state', 'done'); }
  }
  /**
   * The "Events made for you" block. series: [{ id, label }], kinds: [{ id, label }] (fallback), ui: copy.
   * Chips only for series with a visible event; drop-only series become one line with Notify me; with no chips
   * left it routes by kind (only kinds that have a visible event). Returns a DocumentFragment.
   */
  function seriesBlock(series, kinds, ui) {
    var frag = d.createDocumentFragment(), chips = h('div', { cls: 'chip-row' }), dropped = [];
    series.forEach(function (s) {
      var st = seriesState(s.id);
      if (st === 'open') chips.appendChild(h('a', { cls: 'chip', href: PRE + 'events.html?series=' + encodeURIComponent(s.id), text: s.label }));
      else if (st === 'drop') dropped.push(s.label);
    });
    if (!chips.children.length) kinds.forEach(function (k) { if (kindOpen(k.id)) chips.appendChild(h('a', { cls: 'chip', href: PRE + 'events.html?kind=' + encodeURIComponent(k.id), text: k.label })); });
    if (chips.children.length) frag.appendChild(chips);
    var dr = drop();
    if (dropped.length && dr) {
      dropped = dropped.map(function (x, i) { return i && /^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(\s|$)/.test(x) ? x.charAt(0).toLowerCase() + x.slice(1) : x; });
      var list = dropped.length > 1 ? dropped.slice(0, -1).join(', ') + (L === 'es' ? ' y ' : ' and ') + dropped[dropped.length - 1] : dropped[0];
      var btn = h('button', { type: 'button', cls: 'btn btn--ink btn--sm', 'data-quiz-notify': '', text: ui.notify });
      frag.appendChild(h('div', { cls: 'x-drop', 'data-quiz-drop': '' }, [
        h('p', { cls: 'x-drop__text' }, [h('b', { text: fill(ui.dropSeries, { series: list }) }), ' ', h('span', { text: ui.dropWhen || pick(dr.label) })]),
        btn
      ]));
    }
    var nx = nextEvent(series.map(function (s) { return s.id; }));
    if (nx) {
      var when = ''; try { when = YSD.fmt.date(nx.start, { time: true }); } catch (e) {}
      frag.appendChild(h('p', { cls: 'x-next' }, [h('span', { cls: 'x-next__label', text: ui.next + ': ' }), h('a', { href: PRE + 'events/' + nx.id + '.html', text: pick(nx.title) }), ' · ' + when + ' ', nx.demo !== false ? h('span', { cls: 'tag tag--demo', text: 'DEMO' }) : null]));
    }
    return frag;
  }
  /** Action links that filter by series: keep them when the series is open, tag January ones, re-route dead ones. */
  function fixActionLinks(scope, ui) {
    $$('a[data-series]', scope).forEach(function (a) {
      var s = a.getAttribute('data-series'), st = seriesState(s), li = a.closest('li') || a.parentNode;
      var old = li && $('.x-action__when', li); if (old) old.remove();
      if (st === 'drop') { if (li) li.insertBefore(h('span', { cls: 'tag tag--new x-action__when', title: fill(ui.dropSeries, { series: '' }).replace(/^[:\s]+/, ''), text: ui.dropTag }), a.nextSibling); return; }
      if (st === 'none') {
        var k = a.getAttribute('data-kind') || kindOfSeries(s);
        a.setAttribute('href', (a.getAttribute('href') || '').replace(/events\.html\?series=[^#&]*/, k && kindOpen(k) ? 'events.html?kind=' + k : 'events.html'));
      }
    });
  }
  /** Character art marked data-src loads when it nears the screen (keeps the first view under 30 requests). */
  function lazyArt() {
    var imgs = $$('img[data-src]').filter(function (i) { return !i.getAttribute('src'); });
    var load = function (img) { img.src = root() + img.getAttribute('data-src'); };
    if (!('IntersectionObserver' in w)) { imgs.forEach(load); return; }
    var io = new IntersectionObserver(function (es) { es.forEach(function (x) { if (x.isIntersecting) { io.unobserve(x.target); load(x.target); } }); }, { rootMargin: '0px 0px 240px 0px' });
    imgs.forEach(function (i) { io.observe(i); });
  }
  YSD.quizPage = { series: seriesState };

  // ================================================================ STATIC RESULT PAGES
  var rpage = $('[data-quiz-rpage]');
  if (rpage) {
    var cfg = {};
    try { cfg = JSON.parse(rpage.getAttribute('data-quiz-rpage') || '{}'); } catch (e) { cfg = {}; }
    var ui = cfg.ui || {};
    PRE = cfg.base || '../../';
    var init = function () {
      // who sent this (genz-brand-13): never for under-18 links, which never carry from
      var name = fromName(), line = $('[data-quiz-from]');
      if (line && name && cfg.from) {
        line.textContent = fill(cfg.from, { name: name }); line.hidden = false;
        var gen = $('[data-quiz-someone]'); if (gen) gen.hidden = true;
      }
      // events made for you, against today's calendar
      var slot = $('[data-quiz-series-slot]');
      if (slot && cfg.series) { slot.textContent = ''; slot.appendChild(seriesBlock(cfg.series, cfg.kinds || [], ui)); }
      fixActionLinks(d, ui);
      lazyArt();
    };
    // capture phase: this runs before ui.js's generic [data-share] handler, which would share this static page
    d.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-quiz-share],[data-quiz-notify]') : null;
      if (!b) return;
      if (b.hasAttribute('data-quiz-notify')) { notifyDrop(b, ui.notifyDone); return; }
      // share the quiz (with my ref and from), not this static page (journeys-23)
      e.preventDefault(); e.stopPropagation();
      var url = cfg.share || 'quiz.html';
      try { url = YSD.share.url(url); } catch (x) {}
      var mine = null; try { mine = YSD.store && YSD.store.get('quiz:' + cfg.quizId + ':result', null); } catch (x) {}
      var text = cfg.shareText || '';
      if (mine && cfg.mineText && cfg.names && cfg.names[mine.resultId]) text = fill(cfg.mineText, { match: cfg.names[mine.resultId] });
      if (YSD.ui && YSD.ui.share) YSD.ui.share({ page: 'quiz', url: url, text: text });
    }, true);
    if (YSD.ui && YSD.ui.ready) YSD.ui.ready(init); else if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', init); else init();
    return;
  }

  // ================================================================ QUIZ PAGE
  // ---------------------------------------------------------------- reference scorer (data/quiz.js, verbatim)
  function ysdScoreQuiz(quiz, answers) {
    var s = quiz.scoring, ids = s.resultIds, raw = {}, max = {}, fit = {}, last = {}, n = 0, i, id;
    for (i = 0; i < ids.length; i++) { raw[ids[i]] = 0; max[ids[i]] = 0; last[ids[i]] = -1; }
    for (var qi = 0; qi < quiz.questions.length; qi++) {
      var q = quiz.questions[qi], pick = answers[q.id], w = q.weight || 1, best = {}, chosen = null;
      if (pick == null) continue;
      for (var oi = 0; oi < q.options.length; oi++) {
        var o = q.options[oi];
        for (id in o.scores) if (o.scores[id] > (best[id] || 0)) best[id] = o.scores[id];
        if (o.id === pick) chosen = o;
      }
      if (!chosen) continue;
      n++;
      for (id in best) if (id in max) max[id] += best[id] * w;
      var top = 0;
      for (id in chosen.scores) { if (id in raw) raw[id] += chosen.scores[id] * w; if (chosen.scores[id] > top) top = chosen.scores[id]; }
      for (id in chosen.scores) if (id in last && chosen.scores[id] === top) last[id] = qi;
    }
    for (i = 0; i < ids.length; i++) id = ids[i], fit[id] = s.normalize ? (max[id] ? raw[id] / max[id] : 0) : raw[id];
    var ranked = ids.slice().sort(function (a, b) {
      return (fit[b] - fit[a]) || (raw[b] - raw[a]) || (s.recency ? last[b] - last[a] : 0) || (ids.indexOf(a) - ids.indexOf(b));
    });
    var total = 0, mix = {}, rem = [], used = 0;
    for (i = 0; i < ids.length; i++) total += fit[ids[i]];
    for (i = 0; i < ids.length; i++) {
      var exact = total ? 100 * fit[ids[i]] / total : 0;
      mix[ids[i]] = Math.floor(exact); used += mix[ids[i]]; rem.push([ids[i], exact - mix[ids[i]], i]);
    }
    rem.sort(function (a, b) { return (b[1] - a[1]) || (a[2] - b[2]); });
    for (i = 0; total && used < 100; i++, used++) mix[rem[i][0]]++;
    return { match: n ? ranked[0] : null, undertone: n && fit[ranked[1]] > 0 ? ranked[1] : null,
             ranked: ranked, fit: fit, raw: raw, mix: mix, answered: n };
  }

  // The card stack (characters, maker, brand cards, member card, growth copy) loads on demand: when a quiz starts or
  // the cover maker comes near the screen. It keeps the first view light (BRIEF 6b B1).
  var STACK = ['data/slices/growth.js', 'assets/img/characters/characters.js', 'assets/js/cards-brand.js', 'assets/js/maker.js', 'assets/js/membercard.js'];
  var stackP = null;
  function need() {
    if (stackP) return stackP;
    stackP = STACK.reduce(function (chain, src) {
      return chain.then(function () {
        return new Promise(function (res) {
          var s = d.createElement('script');
          s.src = root() + src; s.async = false;
          s.onload = s.onerror = function () { res(); };
          d.body.appendChild(s);
        });
      });
    }, Promise.resolve());
    return stackP;
  }
  var QUIZ = { 'show-up': Q.organizerEra, issue: Q.issueFinder };
  var st = { id: null, mode: 'full', qs: [], i: 0, answers: {}, order: {}, result: null, rank: 0, maker: null, busy: false };
  YSD.quizPage.score = ysdScoreQuiz; YSD.quizPage.state = st; YSD.quizPage.need = need;
  if (!Q.organizerEra || !Q.issueFinder) return;
  var UI = {
    notify: pick(Q.ui.notify), notifyDone: pick(Q.ui.notifyDone), dropSeries: pick(Q.ui.dropSeries), dropWhen: pick(Q.ui.dropWhen), dropTag: pick(Q.ui.dropTag),
    next: t('result.next')
  };

  // ---------------------------------------------------------------- results data
  function showUpResult(id) { return byId(Q.organizerEra.results, id); }
  function issueItem(id) { return byId(I.items, id); }
  function issueRes(id) { return Q.issueFinder.results[id] || {}; }
  function identity(id) { var r = issueRes(id); return r.identity ? pick(r.identity.name) : ''; }
  /** Display name: the type name, or the issue identity ("The Rent Realist"), or the plain issue. */
  function resultName(kind, id) { if (kind === 'show-up') { var r = showUpResult(id); return r ? pick(r.name) : ''; } var it = issueItem(id); return identity(id) || (it ? cap(pick(it.short)) : ''); }
  function shortName(kind, id) { if (kind === 'show-up') return resultName(kind, id); var it = issueItem(id); return it ? pick(it.short) : ''; }
  function resultColor(kind, id) { if (kind === 'show-up') { var r = showUpResult(id); return r ? r.color : 'violet'; } var it = issueItem(id); return it ? it.color : 'violet'; }
  function serious(kind, id) { var it = kind === 'issue' && issueItem(id); return !!(it && it.tone === 'serious'); }
  function charPath(kind, id) {
    if (kind === 'show-up') { var r = showUpResult(id); return r && r.character !== false ? 'show-up/' + r.slug : ''; }
    var res = issueRes(id); return res.slug && res.character !== false ? 'issue/' + res.slug : '';
  }
  function pageHref(a) {
    var file = (I.pages || {})[a.page] || (a.page + '.html');
    return file + (a.query ? '?' + a.query : '') + (a.hash ? '#' + a.hash : '');
  }
  function actionLabel(a) {
    if (a.labelAfter && Date.now() >= Date.parse(a.labelAfter.date + 'T00:00:00-05:00')) return pick(a.labelAfter);
    return pick(a.label);
  }

  // ---------------------------------------------------------------- app mode
  var main = $('#main'), stage = $('#play'), player = $('[data-quiz-player]'), resultEl = $('[data-quiz-result]');
  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), x = a[i]; a[i] = a[j]; a[j] = x; } return a; }
  /** mode: '' (browsing), 'quiz' (questions: only the stage shows) or 'result' (hero hidden, galleries back). */
  function appMode(mode) {
    if (mode) main.setAttribute('data-playing', mode); else main.removeAttribute('data-playing');
    $$('[data-quiz-intro]').forEach(function (el) { el.hidden = !!mode; });
    $$('[data-quiz-hide]').forEach(function (el) { el.hidden = mode === 'quiz'; });
    var hero = $('[data-quiz-hero]'); if (hero) hero.hidden = !!mode;
    if (mode !== 'quiz') world('');
  }
  /** Full-bleed colour world for the stage (genz-brand-11). Bright worlds are light islands, violet a dark one. */
  function world(name) {
    if (!name) { stage.removeAttribute('data-world'); stage.style.removeProperty('--world'); stage.classList.remove('theme-light', 'theme-dark'); return; }
    stage.setAttribute('data-world', name); stage.style.setProperty('--world', 'var(--' + name + ')');
    stage.classList.toggle('theme-dark', !!DARK[name]); stage.classList.toggle('theme-light', !DARK[name]);
  }
  function toStage() {
    var top = stage.getBoundingClientRect().top + (w.pageYOffset || 0);
    var hdr = $('.site-header'), hh = hdr ? hdr.getBoundingClientRect().height : 0;
    w.scrollTo({ top: Math.max(0, top - hh), behavior: 'auto' });
  }
  function start(id, mode) {
    var quiz = QUIZ[id];
    if (!quiz) return;
    st.id = id; st.mode = id === 'issue' ? (mode || 'quick') : 'full';
    st.answers = {}; st.order = {}; st.i = 0; st.result = null; st.rank = 0; st.busy = false;
    var ids = id === 'issue' && st.mode === 'quick' ? quiz.modes.quick.questionIds : null;
    st.qs = quiz.questions.filter(function (q) { return !ids || ids.indexOf(q.id) >= 0; });
    st.qs.forEach(function (q) { st.order[q.id] = quiz.shuffleOptions ? shuffle(q.options) : q.options.slice(); });
    appMode('quiz');
    resultEl.hidden = true;
    player.hidden = false;
    track('quiz_start', { quiz: quiz.id });
    paintQ();
    toStage();
    need();
  }
  function leaning() {
    var answered = Object.keys(st.answers).length;
    if (st.i < 3 || !answered) return '';
    var r = ysdScoreQuiz(QUIZ[st.id], st.answers);
    return r.match ? fill(pick(Q.ui.leaning), { name: resultName(st.id, r.match) }) : '';
  }
  function iconUrl(key) { var svg = (Q.icons || {})[key]; return svg ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) : ''; }
  function paintQ() {
    var quiz = QUIZ[st.id], q = st.qs[st.i], total = st.qs.length, picked = st.answers[q.id];
    world(WORLDS[st.i % WORLDS.length]);
    player.textContent = '';
    player.setAttribute('data-quiz', st.id);
    var from = fromName(), sent = st.i !== 0 ? '' : from ? fill(pick(Q.ui.sentBy), { name: from }) : (hasRef() ? pick(Q.ui.sentByFriend) : '');
    var top = h('div', { cls: 'x-player__top' }, [
      h('p', { cls: 'x-player__quiz', text: pick(quiz.title) }),
      h('button', { type: 'button', cls: 'btn btn--quiet btn--sm', 'data-quiz-quit': '', text: t('player.quit') })
    ]);
    var dots = h('ol', { cls: 'x-progress__dots', 'aria-hidden': 'true', style: { '--n': String(total) } });
    for (var k = 0; k < total; k++) dots.appendChild(h('li', { 'data-state': k < st.i ? 'done' : k === st.i ? 'now' : 'todo' }));
    var count = h('p', { cls: 'x-player__count', text: fill(pick(Q.ui.progress), { n: st.i + 1, total: total }) });
    var lean = leaning();
    var head = h('h2', { cls: 'x-q', id: 'x-q', tabindex: '-1', text: pick(q.prompt) });
    var tiles = st.order[q.id].every(function (o) { return o.icon && (Q.icons || {})[o.icon]; });
    var list = h('ul', { cls: 'x-opts' + (tiles ? ' x-opts--tiles' : ''), role: 'list', 'aria-labelledby': 'x-q' });
    st.order[q.id].forEach(function (o, i) {
      var kids = tiles
        ? [h('img', { cls: 'x-opt__icon', src: iconUrl(o.icon), alt: '', width: '72', height: '72', draggable: 'false' }), h('span', { cls: 'x-opt__label', text: pick(o.label) })]
        : [h('span', { cls: 'x-opt__key', 'aria-hidden': 'true', text: String.fromCharCode(65 + i) }), h('span', { cls: 'x-opt__label', text: pick(o.label) })];
      list.appendChild(h('li', {}, [h('button', { type: 'button', cls: 'x-opt', 'data-opt': o.id, 'aria-pressed': String(o.id === picked) }, kids)]));
    });
    var nav = h('div', { cls: 'x-player__nav' }, [
      st.i > 0 ? h('button', { type: 'button', cls: 'btn btn--ghost', 'data-quiz-back': '', text: pick(Q.ui.back) }) : h('span'),
      h('button', { type: 'button', cls: 'btn btn--quiet', 'data-quiz-skip': '', text: t('player.skip') })
    ]);
    player.appendChild(top);
    if (sent) player.appendChild(h('p', { cls: 'x-sent', text: sent }));
    player.appendChild(dots); player.appendChild(count);
    player.appendChild(head);
    if (lean) player.appendChild(h('p', { cls: 'x-lean', text: lean }));
    player.appendChild(list); player.appendChild(nav);
    head.focus({ preventScroll: true });
  }
  function answer(optId) {
    if (st.busy) return;
    var q = st.qs[st.i];
    st.answers[q.id] = optId;
    $$('.x-opt', player).forEach(function (b) {
      var on = b.getAttribute('data-opt') === optId;
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('data-state', on ? 'picked' : 'dim');
    });
    st.busy = true;
    setTimeout(function () { st.busy = false; advance(); }, reduced() ? 90 : 380);
  }
  function advance() { if (st.i < st.qs.length - 1) { st.i++; paintQ(); } else finish(); }
  function skip() { delete st.answers[st.qs[st.i].id]; advance(); }
  function back() { if (st.i > 0) { st.i--; paintQ(); } }
  YSD.quizPage.start = start; YSD.quizPage.answer = answer; YSD.quizPage.skip = skip;

  // ---------------------------------------------------------------- finish + result
  function finish() {
    var quiz = QUIZ[st.id], r = ysdScoreQuiz(quiz, st.answers);
    if (!r.match) {
      start(st.id, st.mode);
      var note = h('p', { cls: 'x-player__note', text: t('player.needOne') });
      player.insertBefore(note, $('.x-q', player));
      toast(t('player.needOne'));
      return;
    }
    st.result = r; st.rank = 0;
    try { if (YSD.store) YSD.store.set('quiz:' + quiz.id + ':result', { resultId: r.match, undertone: r.undertone, ts: Date.now() }); } catch (e) {}
    track('quiz_complete', { quiz: quiz.id, result: r.match });
    player.hidden = true;
    appMode('result');
    paintResult(true);
    // the sticker reveal waits for the result to land (genz-brand-10); YSD.stickers announces it (reveal or toast)
    need().then(function () {
      try { if (YSD.stickers) YSD.stickers.act('quiz', { ref: quiz.id, delay: reduced() ? 600 : 1800 }); } catch (e) {}
    });
  }
  function current() {
    var r = st.result, id = r.ranked[st.rank], next = r.ranked[st.rank + 1];
    var und = st.rank === 0 ? r.undertone : (r.fit[next] > 0 ? next : null);
    return { id: id, undertone: und };
  }
  function mixItems(kind, mix) {
    var out = [];
    for (var id in mix) if (mix[id] > 0) out.push({ id: id, pct: mix[id], name: kind === 'issue' ? cap(shortName(kind, id)) : resultName(kind, id), color: resultColor(kind, id) });
    out.sort(function (a, b) { return b.pct - a.pct; });
    return out.slice(0, 5);
  }
  function seriesFor(kind, id) {
    var ids = kind === 'show-up' ? showUpResult(id).eventSeries : (issueRes(id).eventSeries || issueItem(id).eventSeries || []);
    return (ids || []).filter(function (s) { return Q.eventSeries[s]; }).map(function (s) { return { id: s, label: pick(Q.eventSeries[s].label) }; });
  }
  function kindsFallback() { return ['learn', 'social', 'volunteer'].filter(function (k) { return (Q.eventKinds || {})[k]; }).map(function (k) { return { id: k, label: pick(Q.eventKinds[k].label) }; }); }
  function paintResult(reveal) {
    var kind = st.id, quiz = QUIZ[kind], cur = current(), id = cur.id, calm = serious(kind, id);
    var color = resultColor(kind, id), name = resultName(kind, id), copy = quiz.copy, art = charPath(kind, id);
    resultEl.textContent = '';
    resultEl.hidden = false;
    resultEl.setAttribute('data-kind', kind);
    resultEl.setAttribute('data-result', id);
    resultEl.setAttribute('data-reveal', reveal && !reduced() ? 'on' : 'off');
    if (calm) resultEl.setAttribute('data-tone', 'calm'); else resultEl.removeAttribute('data-tone');
    resultEl.style.setProperty('--res', colorVar(color, kind === 'issue' ? 'issue' : ''));
    resultEl.style.setProperty('--res-fg', onColor(color));
    // hero band: kicker, character, name, (issue chip), undertone, description, the top-two numerals
    var hero = h('div', { cls: 'x-result__hero' + (DARK[color] ? ' theme-dark' : ' theme-light') + (art ? ' x-result__hero--art' : '') });
    hero.appendChild(h('p', { cls: 'x-result__kicker', text: kind === 'issue' && identity(id) ? pick(copy.identityLabel) : pick(copy.matchLabel) }));
    if (art) hero.appendChild(h('img', { cls: 'x-result__char', src: charSrc(art), alt: '', width: '256', height: '264', decoding: 'async' }));
    hero.appendChild(h('h2', { cls: 'x-result__name', tabindex: '-1', 'data-len': longest(name) > 10 ? 'long' : null, text: name }));
    if (kind === 'issue' && identity(id)) hero.appendChild(h('p', { cls: 'x-result__issue', text: cap(shortName(kind, id)) }));
    if (cur.undertone) {
      var und = fill(pick(copy.undertone), { match: kind === 'issue' ? cap(shortName(kind, id)) : name, undertone: kind === 'issue' ? shortName(kind, cur.undertone) : resultName(kind, cur.undertone) });
      hero.appendChild(h('p', { cls: 'x-result__under', text: und }));
    }
    if (kind === 'show-up') {
      var r = showUpResult(id);
      hero.appendChild(h('p', { cls: 'x-result__desc', text: (r.description[L] || r.description.en).join(' ') }));
    } else {
      hero.appendChild(h('p', { cls: 'x-result__desc', 'data-real': '', text: pick(issueItem(id).hook) }));
    }
    var items = mixItems(kind, st.result.mix);
    if (items.length > 1 && !calm) {
      var nums = h('dl', { cls: 'x-nums' });
      items.slice(0, 2).forEach(function (m) { nums.appendChild(h('div', { cls: 'x-nums__item', style: { '--c': colorVar(m.color, kind === 'issue' ? 'issue' : '') } }, [h('dt', { text: m.name }), h('dd', { text: m.pct + '%' })])); });
      hero.appendChild(nums);
    }
    resultEl.appendChild(hero);

    var grid = h('div', { cls: 'x-result__grid' });
    var cardCol = h('section', { cls: 'x-result__card', 'aria-labelledby': 'x-card-title' }, [
      h('h3', { id: 'x-card-title', text: t('result.cardTitle') }),
      h('p', { cls: 'x-result__sub', text: t('result.cardSub') }),
      h('div', { 'data-quiz-maker': '' })
    ]);
    grid.appendChild(cardCol);
    var info = h('div', { cls: 'x-result__info' });
    if (items.length > 1) {
      var bar = h('div', { cls: 'x-mix__bar', 'aria-hidden': 'true' });
      var legend = h('ul', { cls: 'x-mix__legend' });
      items.forEach(function (m) {
        var c = colorVar(m.color, kind === 'issue' ? 'issue' : '');
        bar.appendChild(h('span', { style: { '--w': m.pct + '%', '--c': c } }));
        legend.appendChild(h('li', { style: { '--c': c } }, [h('b', { text: m.pct + '%' }), ' ', m.name]));
      });
      info.appendChild(h('section', { cls: 'x-mix', 'aria-labelledby': 'x-mix-title' }, [
        h('h3', { id: 'x-mix-title', text: pick(copy.mixLabel) }), h('p', { cls: 'x-result__sub', text: t('result.mixHint') }), bar, legend
      ]));
    }
    if (st.result.ranked.length > st.rank + 1 && st.result.fit[st.result.ranked[st.rank + 1]] > 0) {
      info.appendChild(h('p', {}, [h('button', { type: 'button', cls: 'btn btn--ghost', 'data-quiz-next': '', text: pick(copy.notQuite) })]));
    }
    if (kind === 'show-up') {
      var res = showUpResult(id), ul = h('ul', { cls: 'x-strengths' });
      (res.strengths[L] || res.strengths.en).forEach(function (s) { ul.appendChild(h('li', { text: s })); });
      info.appendChild(h('section', { 'aria-labelledby': 'x-str' }, [h('h3', { id: 'x-str', text: pick(copy.strengthsTitle) }), ul]));
    } else {
      var it = issueItem(id), fl = h('ul', { cls: 'x-facts', 'data-real': '' });
      (it.facts || []).slice(0, 3).forEach(function (f) {
        var li = h('li', { cls: 'x-fact' });
        if (f.stat) li.appendChild(h('p', { cls: 'x-fact__stat' }, [h('b', { text: statVal(f.stat) }), ' ', h('span', { text: pick(f.stat.label) })]));
        li.appendChild(h('p', { cls: 'x-fact__text', text: pick(f.text) }));
        if (f.source) li.appendChild(h('p', { cls: 'x-fact__src' }, [h('a', { cls: 'link link--out', href: f.source, rel: 'noopener' }, [h('span', { text: pick(Q.ui.source) + ':' }), ' ', h('span', { lang: 'en', translate: 'no', text: srcName(f) })])]));
        fl.appendChild(li);
      });
      info.appendChild(h('section', { 'aria-labelledby': 'x-facts' }, [h('h3', { id: 'x-facts', text: pick(copy.factsTitle) }), fl]));
    }
    // three actions; series filters never dead-end (journeys-05)
    var acts = kind === 'show-up' ? showUpResult(id).actions : [issueItem(id).action].concat(issueItem(id).moreActions || []);
    var ol = h('ol', { cls: 'x-actions' });
    acts.slice(0, 3).forEach(function (a, i) {
      var m = /(?:^|&)series=([^&]+)/.exec(a.query || '');
      var li = h('li', { cls: 'x-action' }, [
        h('span', { cls: 'x-action__n', 'aria-hidden': 'true', text: String(i + 1) }),
        h('a', { cls: 'x-action__link', href: pageHref(a), 'data-series': m ? decodeURIComponent(m[1]) : null, text: actionLabel(a) })
      ]);
      if (a.demo) li.appendChild(h('span', { cls: 'tag tag--demo', text: 'DEMO' }));
      var off = a.official && YSD.cfg ? YSD.cfg(a.official, '') : '';
      if (off) li.appendChild(h('a', { cls: 'link link--out x-action__official', href: off, rel: 'noopener', text: t('result.official') }));
      ol.appendChild(li);
    });
    info.appendChild(h('section', { 'aria-labelledby': 'x-acts' }, [h('h3', { id: 'x-acts', text: pick(copy.actionsTitle) }), ol]));
    var sec = h('section', { 'aria-labelledby': 'x-ev' }, [h('h3', { id: 'x-ev', text: pick(Q.organizerEra.copy.eventsTitle) })]);
    sec.appendChild(seriesBlock(seriesFor(kind, id), kindsFallback(), UI));
    info.appendChild(sec);
    var other = kind === 'show-up' ? 'issue' : 'show-up';
    info.appendChild(h('div', { cls: 'btn-row x-result__again' }, [
      h('button', { type: 'button', cls: 'btn btn--ink', 'data-quiz-start': kind, 'data-quiz-mode': st.mode, text: t('result.retake') }),
      h('button', { type: 'button', cls: 'btn btn--ghost', 'data-quiz-start': other, text: pick(Q.ui.otherQuiz) }),
      h('a', { cls: 'btn btn--quiet', href: '#cover', text: t('result.coverCta') })
    ]));
    grid.appendChild(info);
    resultEl.appendChild(grid);
    fixActionLinks(resultEl, UI);
    if (YSD.ui) { YSD.ui.stickers(resultEl); }
    // the poster card (maker, compact)
    var tpl = kind === 'show-up' ? 'quiz-show-up' : 'quiz-issue';
    var msg = '';
    if (kind === 'issue' && identity(id)) msg = fill(pick(copy.shareIdentity), { identity: identity(id), issue: shortName(kind, id) });
    else msg = YSD.t ? YSD.t(kind === 'show-up' ? 'share.quizEra.sms' : 'share.quizIssue.sms', { match: kind === 'issue' ? shortName(kind, id) : name, link: '{link}' }) : '';
    var slot = $('[data-quiz-maker]', resultEl), mdata = { resultId: id, undertone: cur.undertone, mix: st.result.mix };
    need().then(function () {
      if (YSD.maker && d.contains(slot)) st.maker = YSD.maker.mount(slot, { templates: [tpl], template: tpl, compact: true, nameOptional: true, data: mdata, message: msg });
    });
    var head = $('.x-result__name', resultEl);
    var top = resultEl.getBoundingClientRect().top + (w.pageYOffset || 0), hdr = $('.site-header');
    w.scrollTo({ top: Math.max(0, top - (hdr ? hdr.getBoundingClientRect().height : 0) - 12), behavior: reduced() ? 'auto' : 'smooth' });
    head.focus({ preventScroll: true });
    if (reveal && !calm && YSD.ui && YSD.ui.confetti) setTimeout(function () { YSD.ui.confetti(head); }, 350);
  }

  // ---------------------------------------------------------------- galleries, peeks, deck
  // "Rent and housing" under "Rent + housing" says nothing new: compare the words that matter.
  function sameWords(a, b) {
    var stop = { and: 1, the: 1, y: 1, de: 1, la: 1, el: 1, los: 1, las: 1, '+': 1 };
    function words(x) { return String(x || '').toLowerCase().replace(/[^\p{L}\p{N}+ ]/gu, ' ').split(/\s+/).filter(function (v) { return v && !stop[v]; }); }
    var bw = words(b);
    return words(a).every(function (v) { return bw.indexOf(v) >= 0; });
  }
  function typeCard(r) {
    return h('li', {}, [h('a', { cls: 'x-type', href: 'quiz/show-up/' + r.slug + '.html', style: { '--c': colorVar(r.color), '--fg': onColor(r.color) } }, [
      h('img', { cls: 'x-type__char', 'data-src': 'assets/img/characters/show-up/' + r.slug + '.svg', alt: '', width: '256', height: '264', decoding: 'async' }),
      h('span', { cls: 'x-type__name', text: pick(r.name) }),
      h('span', { cls: 'x-type__line', text: pick(r.card.subline) })
    ])]);
  }
  function paintGalleries() {
    var tg = $('[data-quiz-types]');
    if (tg) { tg.textContent = ''; Q.organizerEra.results.forEach(function (r) { tg.appendChild(typeCard(r)); }); }
    var ig = $('[data-quiz-issues]');
    if (ig && I.items) {
      ig.textContent = '';
      I.items.forEach(function (it) {
        var res = Q.issueFinder.results[it.id]; if (!res) return;
        var ident = res.identity ? pick(res.identity.name) : '', art = res.character !== false ? 'issue/' + res.slug : '';
        ig.appendChild(h('li', {}, [h('a', { cls: 'x-issue' + (art ? ' x-issue--art' : ''), href: 'quiz/issue/' + res.slug + '.html', style: { '--c': colorVar(it.color, 'issue'), '--fg': onColor(it.color) } }, [
          art ? h('img', { cls: 'x-issue__char', 'data-src': 'assets/img/characters/' + art + '.svg', alt: '', width: '256', height: '264', decoding: 'async' }) : null,
          h('span', { cls: 'x-issue__short', text: ident || cap(pick(it.short)) }),
          h('span', { cls: 'x-issue__title', text: ident ? cap(pick(it.short)) : (sameWords(pick(it.title), pick(it.short)) ? '' : pick(it.title)) })
        ])]));
      });
    }
    var p1 = $('[data-quiz-peek="show-up"]');
    if (p1) ['hype', 'data', 'plusone'].forEach(function (id) { var r = showUpResult(id); if (r) p1.appendChild(h('li', { style: { '--c': colorVar(r.color), '--fg': onColor(r.color) }, text: pick(r.name) })); });
    var p2 = $('[data-quiz-peek="issue"]');
    if (p2 && I.items) ['housing', 'transit', 'water', 'schools'].forEach(function (id) { var it = issueItem(id); if (it) p2.appendChild(h('li', { style: { '--c': colorVar(it.color, 'issue'), '--fg': onColor(it.color) }, text: identity(id) || cap(pick(it.short)) })); });
    $$('[data-quiz-deck] [data-type]').forEach(function (card) {
      var r = showUpResult(card.getAttribute('data-type')); if (!r) return;
      var n = $('.x-deck__name', card); if (n) n.textContent = pick(r.name);
      var k = $('.x-deck__kicker', card); if (k) k.textContent = pick(Q.organizerEra.copy.matchLabel);
    });
    var deck = $('[data-quiz-deck]'); if (deck) deck.setAttribute('data-state', 'named');
    // a friend's link: say who sent it, right on the hero
    var sent = $('[data-quiz-sent]'), from = fromName();
    if (sent && (from || hasRef())) { sent.textContent = from ? fill(pick(Q.ui.sentBy), { name: from }) : pick(Q.ui.sentByFriend); sent.hidden = false; }
    if (YSD.ui) YSD.ui.stickers(d);
  }

  // ---------------------------------------------------------------- events
  d.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-quiz-start],[data-opt],[data-quiz-back],[data-quiz-skip],[data-quiz-quit],[data-quiz-next],[data-quiz-notify]') : null;
    if (!el) return;
    if (el.hasAttribute('data-quiz-start')) { e.preventDefault(); start(el.getAttribute('data-quiz-start'), el.getAttribute('data-quiz-mode')); return; }
    if (el.hasAttribute('data-opt')) { answer(el.getAttribute('data-opt')); return; }
    if (el.hasAttribute('data-quiz-back')) { back(); return; }
    if (el.hasAttribute('data-quiz-skip')) { skip(); return; }
    if (el.hasAttribute('data-quiz-notify')) { notifyDrop(el, UI.notifyDone); return; }
    if (el.hasAttribute('data-quiz-quit')) {
      player.hidden = true; resultEl.hidden = true; appMode('');
      try { if (/^#(show-up|issue)$/.test(w.location.hash)) w.history.replaceState(null, '', w.location.pathname + w.location.search); } catch (x) {}
      var s = $('#' + (st.id === 'issue' ? 'issue' : 'show-up')) || $('#show-up'), sb = s && $('[data-quiz-start]', s);
      if (s) s.scrollIntoView({ block: 'start' });
      if (sb) sb.focus({ preventScroll: true });
      return;
    }
    if (el.hasAttribute('data-quiz-next')) { st.rank = (st.rank + 1) % st.result.ranked.length; if (!(st.result.fit[st.result.ranked[st.rank]] > 0)) st.rank = 0; paintResult(false); }
  });
  // quiz.html#show-up and #issue start that quiz (journeys-16): home "Start the quiz", result pages "Find my type"
  function fromHash() {
    var m = /^#(show-up|issue)$/.exec(String(w.location.hash || ''));
    if (m && (player.hidden || st.id !== m[1])) start(m[1]);
  }
  w.addEventListener('hashchange', fromHash);

  function mountCover() {
    var el = $('[data-quiz-cover]');
    if (!el || el.__mounted) return;
    el.__mounted = true;
    need().then(function () { if (YSD.maker) YSD.maker.mount(el, { templates: ['cover', 'join'], template: 'cover' }); });
  }
  function init() {
    paintGalleries();
    lazyArt();
    fromHash();
    var el = $('[data-quiz-cover]');
    if (!el) return;
    if ('IntersectionObserver' in w) {
      var io = new IntersectionObserver(function (es) { if (es.some(function (x) { return x.isIntersecting; })) { io.disconnect(); mountCover(); } }, { rootMargin: '600px 0px' });
      io.observe(el);
    } else mountCover();
    if (/^#cover$/.test(String(w.location.hash))) mountCover();
  }
  if (YSD.ui && YSD.ui.ready) YSD.ui.ready(init); else if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', init); else init();
})(window, document);
