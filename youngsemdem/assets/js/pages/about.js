/*! YDSC · assets/js/pages/about.js (W7). Behaviour for about.html and 404.html.
 *
 * about.html (html[data-page="about"])
 *   - [data-team]        team cards from data/team.js (every name is a DEMO placeholder)
 *   - [data-run]         "Run for a role" copy from data/team.js runForRole; its button goes to
 *                        links.contact when the chapter sets one, else to join.html
 *   - [data-rd-game]     "Real or DEMO?" toy: answers are visible without JS; with JS they hide
 *                        until you guess. Nothing is stored.
 *   - [data-contact-*]   contact block: hidden while links.contact is '' (join form instead)
 * 404.html (html[data-page="notFound"])
 *   - [data-toy]         sticker toy: tap the sticker to slap it on the laptop lid and read its
 *                        sourced fact (data/stickers.js). Nothing is stored.
 *   - [data-nf-share]    shares the home page (a link that works), not the broken URL
 * Classic script, no network, no storage. Untrusted text: none (all copy comes from our data files);
 * still rendered with textContent. Sticker SVG comes from our own data file.
 */
(function (w, d) {
  'use strict';
  var YSD = w.YSD || {};
  var html = d.documentElement;
  var page = html.getAttribute('data-page');
  var lang = YSD.lang || (String(html.lang).slice(0, 2) === 'es' ? 'es' : 'en');
  var reduce = w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function $(sel, root) { return (root || d).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || d).querySelectorAll(sel)); }
  function L(o) { return o ? (o[lang] != null ? o[lang] : (o.en || '')) : ''; }
  function t(key, vars) {
    var s = YSD.t ? YSD.t(key, vars) : '';
    if (!s) {
      var i = key.indexOf(':'), P = ((w.YSD_DATA || {}).pages || {})[key.slice(0, i)] || {};
      s = L(P[key.slice(i + 1)]);
      if (vars) s = s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? String(vars[k]) : m; });
    }
    return s;
  }
  function cfg(p) { return typeof YSD.cfg === 'function' ? YSD.cfg(p, '') : ''; }
  function el(tag, cls, text) {
    var e = d.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function ready(fn) { if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', fn); else fn(); }

  /* ------------------------------------------------------------------ about: team */
  function renderTeam() {
    var box = $('[data-team]'), T = (w.YSD_DATA || {}).team;
    if (!box || !T || !T.roles) return;
    var labels = T.labels || {};
    T.roles.slice().sort(function (a, b) { return a.order - b.order; }).forEach(function (r) {
      var li = el('li', 'team-card x-tcard');
      var tok = (r.avatar && r.avatar.token) || '--violet';
      var info = (T.tokens || {})[tok] || {};
      var av = el('span', 'avatar avatar--lg x-tcard__avatar', (r.avatar && r.avatar.monogram) || '?');
      av.setAttribute('aria-hidden', 'true');
      av.style.setProperty('--avatar', 'var(' + (tok === '--ink' ? '--night' : tok) + ')');
      if (info.fg && /^#F/i.test(info.fg)) av.setAttribute('data-fg', 'light');
      var who = el('div', 'x-tcard__who');
      who.appendChild(el('p', 'team-card__name', L(r.name)));
      var role = el('p', 'team-card__role');
      role.appendChild(d.createTextNode(L(r.title) + ' · ' + L(r.seat === 'officer' ? labels.officer : labels.chair) + ' '));
      role.appendChild(el('span', 'tag tag--demo', L(labels.demo) || 'DEMO'));
      who.appendChild(role);
      li.appendChild(av);
      li.appendChild(who);
      li.appendChild(el('p', 'x-tcard__bio', L(r.bio)));
      if (r.does && r.does.length) {
        var det = el('details', 'x-tcard__does');
        det.appendChild(el('summary', '', L(labels.whatTheyDo)));
        var ul = el('ul');
        r.does.forEach(function (x) { ul.appendChild(el('li', '', L(x))); });
        det.appendChild(ul);
        li.appendChild(det);
      }
      box.appendChild(li);
    });
  }

  function renderRun() {
    var box = $('[data-run]'), T = (w.YSD_DATA || {}).team, R = T && T.runForRole;
    if (!box || !R) return;
    box.appendChild(el('p', 'x-run__lead', L(R.body)));
    var elig = el('details', 'x-run__elig');
    elig.appendChild(el('summary', '', t('about:run.elig')));
    elig.appendChild(el('p', '', L(R.eligibility)));
    box.appendChild(elig);
    box.appendChild(el('p', '', L(R.bigger)));
    var row = el('div', 'btn-row');
    var a = el('a', 'btn btn--primary', L(R.cta && R.cta.label));
    var contact = cfg((R.cta && R.cta.key) || 'links.contact');
    a.href = contact || 'join.html';
    row.appendChild(a);
    box.appendChild(row);
    var note = el('p', 'x-run__note');
    note.appendChild(el('span', 'tag tag--demo', 'DEMO'));
    note.appendChild(d.createTextNode(' ' + L(R.demoNote)));
    box.appendChild(note);
  }

  /* ------------------------------------------------------------------ about: real or DEMO */
  function game() {
    var root = $('[data-rd-game]');
    if (!root) return;
    var cards = $$('.x-rd', root), score = $('[data-rd-score]'), reset = $('[data-rd-reset]');
    var total = cards.length;
    root.setAttribute('data-ready', '');
    function tally() {
      var answered = 0, right = 0;
      cards.forEach(function (c) {
        if (c.getAttribute('data-state') === 'answered') { answered++; if (c.getAttribute('data-correct') === 'true') right++; }
      });
      return { answered: answered, right: right };
    }
    function clear() {
      cards.forEach(function (c) {
        c.setAttribute('data-state', 'idle');
        c.removeAttribute('data-correct');
        $$('[data-rd-pick]', c).forEach(function (b) { b.setAttribute('aria-pressed', 'false'); b.removeAttribute('aria-disabled'); });
        var v = $('[data-rd-verdict]', c); if (v) v.textContent = '';
      });
      if (score) score.textContent = '';
      if (reset) reset.hidden = true;
    }
    clear();
    root.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-rd-pick]');
      if (!b || !root.contains(b)) return;
      var c = b.closest('.x-rd');
      if (!c || c.getAttribute('data-state') === 'answered') return;
      var ok = b.getAttribute('data-rd-pick') === c.getAttribute('data-rd');
      c.setAttribute('data-state', 'answered');
      c.setAttribute('data-correct', ok ? 'true' : 'false');
      $$('[data-rd-pick]', c).forEach(function (x) { x.setAttribute('aria-disabled', 'true'); });
      b.setAttribute('aria-pressed', 'true');
      var verdict = t(ok ? 'about:rd.right' : 'about:rd.wrong');
      var v = $('[data-rd-verdict]', c); if (v) v.textContent = verdict;
      var s = tally();
      var line = t('about:rd.score', { n: s.right, total: s.answered });
      if (s.answered === total) {
        line = t('about:rd.final', { n: s.right, total: total }) + ' ' + (s.right === total ? t('about:rd.perfect') : t('about:rd.done'));
        if (reset) reset.hidden = false;
      }
      if (score) score.textContent = verdict + ' ' + line;
      if (YSD.track) try { YSD.track('about_real_or_demo', { right: ok }); } catch (x) {}
    });
    if (reset) reset.addEventListener('click', function () {
      clear();
      var first = $('[data-rd-pick]', root);
      if (first) first.focus();
    });
  }

  /* ------------------------------------------------------------------ about: contact */
  function contact() {
    var url = cfg('links.contact');
    if (!url) return;
    var link = $('[data-contact-link]'), set = $('[data-contact-set]');
    if (link) { link.href = url; link.hidden = false; }
    if (set) set.hidden = false;
    var fb = $('[data-contact-fallback]'); if (fb) fb.hidden = true;
    var j = $('[data-contact-join]'); if (j) j.hidden = true;
  }

  /* ------------------------------------------------------------------ 404: sticker toy */
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var x = a[i]; a[i] = a[j]; a[j] = x; }
    return a;
  }
  function factOf(s) {
    var f = s.fact;
    if (s.expires && Date.now() >= Date.parse(s.expires) && s.next) f = s.next;
    return L(f);
  }
  // Ten slots spread over the lid (percent of width/height), so stickers overlap a little, not a lot.
  var SLOTS = [[14, 20], [40, 14], [68, 18], [86, 34], [20, 56], [80, 72], [54, 78], [12, 84], [34, 40], [62, 46]];

  function toy() {
    var root = $('[data-toy]');
    var S = (w.YSD_DATA || {}).stickers;
    if (!root || !S || !S.items || !S.items.length) return;
    var btn = $('[data-toy-btn]', root), art = $('[data-toy-art]', root), lid = $('[data-toy-lid]', root);
    var bubble = $('[data-toy-fact]', root), count = $('[data-toy-count]', root), again = $('[data-toy-reset]', root);
    var done = $('[data-toy-done]', root);
    var items = S.items.slice(), deck = [], found = 0, slots = [];
    root.setAttribute('data-ready', '');

    function show(s) {
      art.innerHTML = s.svg.replace('<svg ', '<svg aria-hidden="true" focusable="false" '); // trusted: our own data file
      btn.setAttribute('aria-label', t('notFound:toy.btn', { name: L(s.name) }));
      btn.setAttribute('data-sticker-id', s.id);
      if (!reduce) { art.removeAttribute('data-state'); void art.offsetWidth; art.setAttribute('data-state', 'in'); }
    }
    function updateCount() {
      count.textContent = t('notFound:toy.count', { n: found, total: items.length });
    }
    function start() {
      deck = shuffle(items.slice());
      slots = shuffle(SLOTS.slice());
      found = 0;
      $$('.x-slapped', lid).forEach(function (n) { n.remove(); });
      lid.removeAttribute('data-full');
      bubble.textContent = '';
      bubble.appendChild(el('span', 'x-bubble__hint', t('notFound:toy.hint')));
      bubble.removeAttribute('data-civic');
      btn.hidden = false;
      if (done) done.hidden = true;
      again.hidden = true;
      updateCount();
      show(deck[0]);
    }
    function slap() {
      var s = deck[found];
      if (!s) return;
      var pos = slots[found % slots.length];
      var n = el('span', 'sticker x-slapped');
      n.setAttribute('aria-hidden', 'true');
      n.innerHTML = s.svg.replace('<svg ', '<svg aria-hidden="true" focusable="false" ');
      n.style.setProperty('--x', (pos[0] + (Math.random() * 6 - 3)).toFixed(1) + '%');
      n.style.setProperty('--y', (pos[1] + (Math.random() * 6 - 3)).toFixed(1) + '%');
      n.style.setProperty('--rot', Math.round(Math.random() * 50 - 25) + 'deg');
      lid.appendChild(n);
      // the fact, with its source
      bubble.textContent = '';
      var name = el('strong', 'x-bubble__name', L(s.name));
      bubble.appendChild(name);
      bubble.appendChild(d.createTextNode(' ' + factOf(s) + ' '));
      if (s.source && s.source.url) {
        // data/stickers.js labels are English only: Spanish pages take theirs from data/pages/about.js
        var label = (lang !== 'en' && t('notFound:toy.src.' + s.id)) || s.source.label || s.source.url;
        var a = el('a', 'x-bubble__src', t('notFound:toy.source', { label: label }));
        a.href = s.source.url;
        if (/^https?:/.test(s.source.url)) a.rel = 'noopener';
        bubble.appendChild(a);
      }
      if (s.tone === 'calm' || s.id === 'envelope') bubble.setAttribute('data-civic', ''); else bubble.removeAttribute('data-civic');
      found++;
      updateCount();
      if (YSD.track) try { YSD.track('notfound_sticker', { id: s.id }); } catch (x) {}
      if (found >= deck.length) {
        lid.setAttribute('data-full', '');
        btn.hidden = true;
        if (done) done.hidden = false;
        again.hidden = false;
        again.focus();
        if (!bubble.hasAttribute('data-civic') && YSD.ui && YSD.ui.confetti) YSD.ui.confetti(lid);
        return;
      }
      show(deck[found]);
    }
    btn.addEventListener('click', slap);
    again.addEventListener('click', function () { start(); btn.focus(); });
    start();
  }

  function nfShare() {
    var b = $('[data-nf-share]');
    if (!b) return;
    b.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation(); // the page-level [data-share] handler would share this broken URL
      if (!YSD.share || !YSD.share.url || !YSD.ui || !YSD.ui.share) return; // share URLs only ever come from YSD.share.url()
      YSD.ui.share({ url: YSD.share.url('index.html'), text: t('notFound:share.text'), title: t('notFound:share.title') });
    });
  }

  /* 404.html carries <base href="/">, so a bare "#main" (the skip link) would resolve to the home page.
     Same-page fragment links keep their href and are handled here instead (focus + scroll, no navigation). */
  function fixFragments() {
    if (!d.querySelector('base[href]')) return;
    d.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href^="#"]');
      if (!a || e.defaultPrevented) return;
      var target = d.getElementById(decodeURIComponent(a.getAttribute('href').slice(1)));
      if (!target) return;
      e.preventDefault();
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus();
      target.scrollIntoView();
    });
  }

  ready(function () {
    if (page === 'about') { renderTeam(); renderRun(); game(); contact(); }
    if (page === 'notFound') { fixFragments(); toy(); nfShare(); }
  });
})(window, document);
