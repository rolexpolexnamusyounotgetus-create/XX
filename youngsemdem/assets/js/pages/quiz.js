/*! YDSC · assets/js/pages/quiz.js (W5). quiz.html: the two quizzes, the result reveal, the result card
 * (YSD.maker compact), the type and issue galleries and "Me, on the cover". Classic script, no AI.
 * Scoring is the reference scorer from data/quiz.js, copied verbatim (tests compare the two).
 * Stores only quiz:<quizId>:result = { resultId, undertone, ts } (never the answers).
 * Analytics: quiz_start { quiz }, quiz_complete { quiz, result }.
 * Test hook: YSD.quizPage = { score, state, start(id, mode), answer(optionId), skip() }.
 */
(function (w, d) {
  'use strict';
  var YSD = w.YSD = w.YSD || {};
  var DATA = w.YSD_DATA || {}, Q = DATA.quiz || {}, I = DATA.issues || {};
  var L = YSD.lang === 'es' ? 'es' : 'en';
  var ART = { hype: 'sun', chat: 'calendar', data: 'cypress', doors: 'chicken', creator: 'camera', plusone: 'heart' };
  var ISSUE_ART = { housing: 'heart', heat: 'sun', repro: '', lgbtq: '', schools: 'calendar', wages: 'celery', transit: 'train', water: 'gator', voting: 'calendar' };
  var DARK = { violet: 1, 'violet-deep': 1 };

  function t(k, v) { return YSD.t ? YSD.t('quiz:' + k, v) : ''; }
  function pick(o) { return !o ? '' : typeof o === 'string' ? o : (o[L] != null ? o[L] : (o.en || '')); }
  function fill(s, v) { return String(s == null ? '' : s).replace(/\{(\w+)\}/g, function (m, k) { return v && v[k] != null ? String(v[k]) : m; }); }
  function longest(s) { return String(s || '').split(/\s+/).reduce(function (m, w) { return Math.max(m, w.length); }, 0); }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  function $(s, r) { return (r || d).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || d).querySelectorAll(s)); }
  function byId(a, id) { for (var i = 0; i < (a || []).length; i++) if (a[i] && a[i].id === id) return a[i]; return null; }
  function track(e, p) { try { if (YSD.track) YSD.track(e, p); } catch (x) {} }
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
  function colorVar(name, kind) {
    if (kind === 'issue') return 'var(--issue-' + name + ')';
    return 'var(--' + name + ')';
  }

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

  // The card stack (maker, brand cards, member card, growth copy) loads on demand: when a quiz starts or
  // the cover maker comes near the screen. It keeps the first view light (BRIEF 6b B1).
  var STACK = ['data/slices/growth.js', 'assets/js/cards-brand.js', 'assets/js/maker.js', 'assets/js/membercard.js'];
  var stackP = null;
  function need() {
    if (stackP) return stackP;
    var root = YSD.root || '';
    stackP = STACK.reduce(function (chain, src) {
      return chain.then(function () {
        return new Promise(function (res) {
          var s = d.createElement('script');
          s.src = root + src; s.async = false;
          s.onload = s.onerror = function () { res(); };
          d.body.appendChild(s);
        });
      });
    }, Promise.resolve());
    return stackP;
  }
  var QUIZ = { 'show-up': Q.organizerEra, issue: Q.issueFinder };
  var st = { id: null, mode: 'full', qs: [], i: 0, answers: {}, order: {}, result: null, rank: 0, maker: null, busy: false };
  YSD.quizPage = { score: ysdScoreQuiz, state: st, need: need };
  if (!Q.organizerEra || !Q.issueFinder) return;

  // ---------------------------------------------------------------- results data
  function showUpResult(id) { return byId(Q.organizerEra.results, id); }
  function issueItem(id) { return byId(I.items, id); }
  function resultName(kind, id) { if (kind === 'show-up') { var r = showUpResult(id); return r ? pick(r.name) : ''; } var it = issueItem(id); return it ? pick(it.short) : ''; }
  function resultColor(kind, id) { if (kind === 'show-up') { var r = showUpResult(id); return r ? r.color : 'violet'; } var it = issueItem(id); return it ? it.color : 'violet'; }
  function serious(kind, id) { var it = kind === 'issue' && issueItem(id); return !!(it && it.tone === 'serious'); }
  function pageHref(a) {
    var file = (I.pages || {})[a.page] || (a.page + '.html');
    return file + (a.query ? '?' + a.query : '') + (a.hash ? '#' + a.hash : '');
  }
  function actionLabel(a) {
    if (a.labelAfter && Date.now() >= Date.parse(a.labelAfter.date + 'T00:00:00-05:00')) return pick(a.labelAfter);
    return pick(a.label);
  }
  function resultPath(kind, id) {
    if (kind === 'show-up') { var r = showUpResult(id); return 'quiz/show-up/' + (r ? r.slug : '') + '.html'; }
    var res = Q.issueFinder.results[id]; return 'quiz/issue/' + (res ? res.slug : '') + '.html';
  }

  // ---------------------------------------------------------------- player
  var stage = $('#play'), player = $('[data-quiz-player]'), resultEl = $('[data-quiz-result]');
  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), x = a[i]; a[i] = a[j]; a[j] = x; } return a; }
  function intro(on) { $$('[data-quiz-intro]').forEach(function (el) { el.hidden = !on; }); }
  function start(id, mode) {
    var quiz = QUIZ[id];
    if (!quiz) return;
    st.id = id; st.mode = id === 'issue' ? (mode || 'quick') : 'full';
    st.answers = {}; st.order = {}; st.i = 0; st.result = null; st.rank = 0;
    var ids = id === 'issue' && st.mode === 'quick' ? quiz.modes.quick.questionIds : null;
    st.qs = quiz.questions.filter(function (q) { return !ids || ids.indexOf(q.id) >= 0; });
    st.qs.forEach(function (q) { st.order[q.id] = quiz.shuffleOptions ? shuffle(q.options) : q.options.slice(); });
    intro(false);
    resultEl.hidden = true;
    player.hidden = false;
    track('quiz_start', { quiz: quiz.id });
    paintQ(true);
    need();
  }
  function paintQ(scroll) {
    var quiz = QUIZ[st.id], q = st.qs[st.i], total = st.qs.length, picked = st.answers[q.id];
    player.textContent = '';
    player.setAttribute('data-quiz', st.id);
    var count = h('p', { cls: 'x-player__count', text: fill(pick(Q.ui.progress), { n: st.i + 1, total: total }) });
    var top = h('div', { cls: 'x-player__top' }, [
      h('p', { cls: 'x-player__quiz', text: pick(quiz.title) }),
      h('button', { type: 'button', cls: 'btn btn--quiet btn--sm', 'data-quiz-quit': '', text: t('player.quit') })
    ]);
    var bar = h('div', { cls: 'x-progress', 'aria-hidden': 'true' }, [h('span', { style: { '--p': Math.round((st.i / total) * 100) + '%' } })]);
    var dots = h('ol', { cls: 'x-progress__dots', 'aria-hidden': 'true' });
    for (var k = 0; k < total; k++) dots.appendChild(h('li', { 'data-state': k < st.i ? 'done' : k === st.i ? 'now' : 'todo' }));
    var head = h('h2', { cls: 'x-q', id: 'x-q', tabindex: '-1', text: pick(q.prompt) });
    var list = h('ul', { cls: 'x-opts', role: 'list', 'aria-labelledby': 'x-q' });
    st.order[q.id].forEach(function (o, i) {
      list.appendChild(h('li', {}, [h('button', { type: 'button', cls: 'x-opt', 'data-opt': o.id, 'aria-pressed': String(o.id === picked) }, [
        h('span', { cls: 'x-opt__key', 'aria-hidden': 'true', text: String.fromCharCode(65 + i) }),
        h('span', { cls: 'x-opt__label', text: pick(o.label) })
      ])]));
    });
    var nav = h('div', { cls: 'x-player__nav' }, [
      st.i > 0 ? h('button', { type: 'button', cls: 'btn btn--ghost', 'data-quiz-back': '', text: pick(Q.ui.back) }) : h('span'),
      h('button', { type: 'button', cls: 'btn btn--quiet', 'data-quiz-skip': '', text: t('player.skip') })
    ]);
    player.appendChild(top); player.appendChild(bar); player.appendChild(dots);
    player.appendChild(count); player.appendChild(head); player.appendChild(list); player.appendChild(nav);
    if (scroll) player.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
    head.focus({ preventScroll: true });
  }
  function answer(optId) {
    if (st.busy) return;
    var q = st.qs[st.i];
    st.answers[q.id] = optId;
    $$('.x-opt', player).forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-opt') === optId)); });
    st.busy = true;
    setTimeout(function () { st.busy = false; advance(); }, reduced() ? 0 : 220);
  }
  function advance() { if (st.i < st.qs.length - 1) { st.i++; paintQ(false); } else finish(); }
  function skip() { delete st.answers[st.qs[st.i].id]; advance(); }
  function back() { if (st.i > 0) { st.i--; paintQ(false); } }
  YSD.quizPage.start = start; YSD.quizPage.answer = answer; YSD.quizPage.skip = skip;

  // ---------------------------------------------------------------- finish + result
  function finish() {
    var quiz = QUIZ[st.id], r = ysdScoreQuiz(quiz, st.answers);
    if (!r.match) { start(st.id, st.mode); return; }
    st.result = r; st.rank = 0;
    try { if (YSD.store) YSD.store.set('quiz:' + quiz.id + ':result', { resultId: r.match, undertone: r.undertone, ts: Date.now() }); } catch (e) {}
    track('quiz_complete', { quiz: quiz.id, result: r.match });
    player.hidden = true;
    paintResult(true);
    need().then(function () {
      try { if (YSD.stickers) YSD.stickers.act('quiz', { ref: quiz.id }); } catch (e) {}
    });
  }
  function current() {
    var r = st.result, id = r.ranked[st.rank], next = r.ranked[st.rank + 1];
    var und = st.rank === 0 ? r.undertone : (r.fit[next] > 0 ? next : null);
    return { id: id, undertone: und };
  }
  function mixItems(kind, mix) {
    var out = [];
    for (var id in mix) if (mix[id] > 0) out.push({ id: id, pct: mix[id], name: resultName(kind, id), color: resultColor(kind, id) });
    out.sort(function (a, b) { return b.pct - a.pct; });
    return out.slice(0, 5);
  }
  function paintResult(reveal) {
    var kind = st.id, quiz = QUIZ[kind], cur = current(), id = cur.id, calm = serious(kind, id);
    var color = resultColor(kind, id), name = resultName(kind, id), copy = quiz.copy;
    resultEl.textContent = '';
    resultEl.hidden = false;
    resultEl.setAttribute('data-kind', kind);
    resultEl.setAttribute('data-result', id);
    resultEl.setAttribute('data-reveal', reveal && !reduced() ? 'on' : 'off');
    if (calm) resultEl.setAttribute('data-tone', 'calm'); else resultEl.removeAttribute('data-tone');
    resultEl.style.setProperty('--res', colorVar(color, kind === 'issue' ? 'issue' : ''));
    resultEl.style.setProperty('--res-fg', DARK[color] ? 'var(--cream)' : 'var(--night)');
    // hero band
    var hero = h('div', { cls: 'x-result__hero' });
    hero.appendChild(h('p', { cls: 'x-result__kicker', text: pick(copy.matchLabel) }));
    var title = kind === 'issue' ? cap(name) : name;
    hero.appendChild(h('h2', { cls: 'x-result__name', tabindex: '-1', 'data-len': longest(title) > 10 ? 'long' : null, text: title }));
    if (cur.undertone) {
      var und = fill(pick(copy.undertone), { match: kind === 'issue' ? cap(name) : name, undertone: resultName(kind, cur.undertone) });
      hero.appendChild(h('p', { cls: 'x-result__under', text: und }));
    }
    if (kind === 'show-up') {
      var r = showUpResult(id);
      hero.appendChild(h('p', { cls: 'x-result__desc', text: (r.description[L] || r.description.en).join(' ') }));
    } else {
      hero.appendChild(h('p', { cls: 'x-result__desc', 'data-real': '', text: pick(issueItem(id).hook) }));
    }
    var art = kind === 'show-up' ? ART[id] : ISSUE_ART[id];
    if (!calm && art) hero.appendChild(h('span', { cls: 'sticker sticker--lg x-result__sticker', 'data-sticker': art, 'aria-hidden': 'true' }));
    resultEl.appendChild(hero);

    var grid = h('div', { cls: 'x-result__grid' });
    // card column
    var cardCol = h('section', { cls: 'x-result__card', 'aria-labelledby': 'x-card-title' }, [
      h('h3', { id: 'x-card-title', text: t('result.cardTitle') }),
      h('p', { cls: 'x-result__sub', text: t('result.cardSub') }),
      h('div', { 'data-quiz-maker': '' })
    ]);
    grid.appendChild(cardCol);
    // info column
    var info = h('div', { cls: 'x-result__info' });
    var items = mixItems(kind, st.result.mix);
    if (items.length > 1) {
      var bar = h('div', { cls: 'x-mix__bar', 'aria-hidden': 'true' });
      var legend = h('ul', { cls: 'x-mix__legend' });
      items.forEach(function (m) {
        var c = colorVar(m.color, kind === 'issue' ? 'issue' : '');
        bar.appendChild(h('span', { style: { '--w': m.pct + '%', '--c': c } }));
        legend.appendChild(h('li', { style: { '--c': c } }, [h('b', { text: m.pct + '%' }), ' ', kind === 'issue' ? cap(m.name) : m.name]));
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
        if (f.stat) li.appendChild(h('p', { cls: 'x-fact__stat' }, [h('b', { text: f.stat.value }), ' ', h('span', { text: pick(f.stat.label) })]));
        li.appendChild(h('p', { cls: 'x-fact__text', text: pick(f.text) }));
        if (f.source) li.appendChild(h('p', { cls: 'x-fact__src' }, [h('a', { cls: 'link link--out', href: f.source, rel: 'noopener' }, [h('span', { text: pick(Q.ui.source) + ':' }), '\u00a0', h('span', { lang: 'en', translate: 'no', text: String(f.sourceName || '').split(',')[0] })])]));
        fl.appendChild(li);
      });
      info.appendChild(h('section', { 'aria-labelledby': 'x-facts' }, [h('h3', { id: 'x-facts', text: pick(copy.factsTitle) }), fl]));
    }
    // three actions
    var acts = kind === 'show-up' ? showUpResult(id).actions : [issueItem(id).action].concat(issueItem(id).moreActions || []);
    var ol = h('ol', { cls: 'x-actions' });
    acts.slice(0, 3).forEach(function (a, i) {
      var li = h('li', { cls: 'x-action' }, [
        h('span', { cls: 'x-action__n', 'aria-hidden': 'true', text: String(i + 1) }),
        h('a', { cls: 'x-action__link', href: pageHref(a), text: actionLabel(a) })
      ]);
      if (a.demo) li.appendChild(h('span', { cls: 'tag tag--demo', text: 'DEMO' }));
      var off = a.official && YSD.cfg ? YSD.cfg(a.official, '') : '';
      if (off) li.appendChild(h('a', { cls: 'link link--out x-action__official', href: off, rel: 'noopener', text: t('result.official') }));
      ol.appendChild(li);
    });
    info.appendChild(h('section', { 'aria-labelledby': 'x-acts' }, [h('h3', { id: 'x-acts', text: pick(copy.actionsTitle) }), ol]));
    // event series
    var series = kind === 'show-up' ? showUpResult(id).eventSeries : (issueItem(id).eventSeries || []);
    {
      var chips = h('div', { cls: 'chip-row' });
      series.forEach(function (s) { var lab = Q.eventSeries[s]; if (lab) chips.appendChild(h('a', { cls: 'chip', href: 'events.html?series=' + encodeURIComponent(s), text: pick(lab.label) })); });
      // no series for this issue yet: route by kind instead (learn, then hang out)
      if (!chips.children.length) ['learn', 'social'].forEach(function (k) { var kl = (Q.eventKinds || {})[k]; if (kl) chips.appendChild(h('a', { cls: 'chip', href: 'events.html?kind=' + k, text: pick(kl.label) })); });
      var sec = h('section', { 'aria-labelledby': 'x-ev' }, [h('h3', { id: 'x-ev', text: pick(copy.eventsTitle || { en: 'Events made for you', es: 'Eventos hechos para ti' }) }), chips]);
      var nx = nextEvent(series);
      if (nx) {
        var when = ''; try { when = YSD.fmt.date(nx.start, { time: true }); } catch (e) {}
        sec.appendChild(h('p', { cls: 'x-next' }, [h('span', { cls: 'x-next__label', text: t('result.next') + ': ' }), h('a', { href: 'events.html#' + nx.id, text: pick(nx.title) }), ' · ' + when + ' ', nx.demo !== false ? h('span', { cls: 'tag tag--demo', text: 'DEMO' }) : null]));
      }
      info.appendChild(sec);
    }
    var other = kind === 'show-up' ? 'issue' : 'show-up';
    info.appendChild(h('div', { cls: 'btn-row x-result__again' }, [
      h('button', { type: 'button', cls: 'btn btn--ink', 'data-quiz-start': kind, 'data-quiz-mode': st.mode, text: t('result.retake') }),
      h('button', { type: 'button', cls: 'btn btn--ghost', 'data-quiz-start': other, text: pick(Q.ui.otherQuiz) }),
      h('a', { cls: 'btn btn--quiet', href: '#cover', text: t('result.coverCta') })
    ]));
    grid.appendChild(info);
    resultEl.appendChild(grid);
    if (YSD.ui) { YSD.ui.stickers(resultEl); }
    // the result card (maker, compact)
    var tpl = kind === 'show-up' ? 'quiz-show-up' : 'quiz-issue';
    var shareKey = kind === 'show-up' ? 'share.quizEra.sms' : 'share.quizIssue.sms';
    var msg = YSD.t ? YSD.t(shareKey, { match: kind === 'issue' ? name : name, link: '{link}' }) : '';
    var slot = $('[data-quiz-maker]', resultEl), mdata = { resultId: id, undertone: cur.undertone, mix: st.result.mix };
    need().then(function () {
      if (YSD.maker && d.contains(slot)) st.maker = YSD.maker.mount(slot, { templates: [tpl], template: tpl, compact: true, nameOptional: true, data: mdata, message: msg });
    });
    var head = $('.x-result__name', resultEl);
    resultEl.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
    head.focus({ preventScroll: true });
    if (reveal && !calm && YSD.ui && YSD.ui.confetti) setTimeout(function () { YSD.ui.confetti(head); }, 350);
  }
  function nextEvent(series) {
    var E = DATA.events, now = Date.now(), best = null;
    ((E && E.items) || []).forEach(function (e) {
      if (series.indexOf(e.series) < 0 || e.status === 'cancelled' || Date.parse(e.start) < now) return;
      if (!best || Date.parse(e.start) < Date.parse(best.start)) best = e;
    });
    return best;
  }

  // ---------------------------------------------------------------- galleries, peeks, deck
  function typeCard(r) {
    var dark = !!DARK[r.color];
    return h('li', {}, [h('a', { cls: 'x-type', href: resultPath('show-up', r.id), style: { '--c': colorVar(r.color), '--fg': dark ? 'var(--cream)' : 'var(--night)' } }, [
      h('span', { cls: 'sticker sticker--md x-type__sticker', 'data-sticker': ART[r.id], 'aria-hidden': 'true' }),
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
        ig.appendChild(h('li', {}, [h('a', { cls: 'x-issue', href: resultPath('issue', it.id), style: { '--c': colorVar(it.color, 'issue'), '--fg': DARK[it.color] ? 'var(--cream)' : 'var(--night)' } }, [
          h('span', { cls: 'x-issue__short', text: cap(pick(it.short)) }),
          h('span', { cls: 'x-issue__title', text: pick(it.title) })
        ])]));
      });
    }
    var p1 = $('[data-quiz-peek="show-up"]');
    if (p1) ['hype', 'data', 'plusone'].forEach(function (id) { var r = showUpResult(id); if (r) p1.appendChild(h('li', { style: { '--c': colorVar(r.color), '--fg': DARK[r.color] ? 'var(--cream)' : 'var(--night)' }, text: pick(r.name) })); });
    var p2 = $('[data-quiz-peek="issue"]');
    if (p2 && I.items) ['housing', 'transit', 'water', 'voting'].forEach(function (id) { var it = issueItem(id); if (it) p2.appendChild(h('li', { style: { '--c': colorVar(it.color, 'issue'), '--fg': DARK[it.color] ? 'var(--cream)' : 'var(--night)' }, text: cap(pick(it.short)) })); });
    var deck = $('[data-quiz-deck]');
    if (deck) {
      var names = ['chat', 'creator', 'hype'];
      $$('.x-deck__card', deck).forEach(function (card, i) {
        var r = showUpResult(names[i]); if (!r) return;
        var k = $('.x-deck__kicker', card); if (k) k.textContent = pick(Q.organizerEra.copy.matchLabel);
        var bars = $$('.x-deck__bar', card);
        if (bars[0]) { var n = h('span', { cls: 'x-deck__name', text: pick(r.name) }); card.replaceChild(n, bars[0]); }
        if (bars[1]) { var l = h('span', { cls: 'x-deck__line', text: pick(r.card.subline) }); card.replaceChild(l, bars[1]); }
      });
      deck.setAttribute('data-state', 'named');
    }
    if (YSD.ui) YSD.ui.stickers(d);
  }

  // ---------------------------------------------------------------- events
  d.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-quiz-start],[data-opt],[data-quiz-back],[data-quiz-skip],[data-quiz-quit],[data-quiz-next]') : null;
    if (!el) return;
    if (el.hasAttribute('data-quiz-start')) { e.preventDefault(); start(el.getAttribute('data-quiz-start'), el.getAttribute('data-quiz-mode')); return; }
    if (el.hasAttribute('data-opt')) { answer(el.getAttribute('data-opt')); return; }
    if (el.hasAttribute('data-quiz-back')) { back(); return; }
    if (el.hasAttribute('data-quiz-skip')) { skip(); return; }
    if (el.hasAttribute('data-quiz-quit')) { player.hidden = true; resultEl.hidden = true; intro(true); var s = $('#show-up'); if (s) s.scrollIntoView({ block: 'start' }); return; }
    if (el.hasAttribute('data-quiz-next')) { st.rank = (st.rank + 1) % st.result.ranked.length; if (!(st.result.fit[st.result.ranked[st.rank]] > 0)) st.rank = 0; paintResult(false); }
  });

  function mountCover() {
    var el = $('[data-quiz-cover]');
    if (!el || el.__mounted) return;
    el.__mounted = true;
    need().then(function () { if (YSD.maker) YSD.maker.mount(el, { templates: ['cover', 'join'], template: 'cover' }); });
  }
  function init() {
    paintGalleries();
    var el = $('[data-quiz-cover]');
    if (!el) return;
    if ('IntersectionObserver' in w) {
      var io = new IntersectionObserver(function (es) { if (es.some(function (x) { return x.isIntersecting; })) { io.disconnect(); mountCover(); } }, { rootMargin: '600px 0px' });
      io.observe(el);
    } else mountCover();
    if (/^#cover$/.test(String(w.location.hash))) mountCover();
  }
  if (YSD.ui && YSD.ui.ready) YSD.ui.ready(init); else if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', init); else init();
  void stage;
})(window, document);
