/*! YDSC · assets/js/pages/about.js (W7; G-ABOUT round 1, Nov 10, 2026). Behaviour for about.html and 404.html.
 *
 * about.html (html[data-page="about"])
 *   - [data-rd-game]     "Real or DEMO?" deck, the hero object (genz-brand-18, genz-brand-01). Without JS every card
 *                        shows its answer and source. With JS it is a stack: guess, the card flips to the answer
 *                        (REAL or DEMO tag, why, source), "Next card", and a final score with "Dare a friend"
 *                        (YSD.ui.share, a link from YSD.share.url) and "Play again". Nothing is stored.
 *   - [data-crew-finder] crew map (right-wing-crew-map): pins are links to #crew-<id> cards (work without JS);
 *                        with JS a pin shows only its crew's card beside or under the map and moves focus to it.
 *                        "Start this crew" links carry join.html?intent=crew&crew=<id> (ids: data/pages/about.js).
 *   - [data-roles]       compact role tiles from data/team.js (no names; DEMO structure), [data-run] "Run for a
 *                        role" copy; its button goes to links.contact when set, else join.html?intent=role
 *   - [data-contact-*]   contact block: hidden while links.contact is '' (join form instead)
 * 404.html (html[data-page="notFound"])
 *   - [data-toy]         sticker toy: a round deals 10 of the stickers in data/stickers.js; tap to slap one on the
 *                        lid and read its sourced fact. Nothing is stored.
 *   - [data-toy-send]    "Send my laptop" (genz-brand-28): renders the decorated lid with the `laptop` template of
 *                        assets/js/cards-brand.js (G-GROWTH contract), loaded on the first slap so the 404's first
 *                        view stays light, rendered before the tap, shared with YSD.cards.share. Guarded with
 *                        YSD.cards.has('laptop'); without it the button shares the link instead.
 *   - [data-nf-share]    shares the home page (a link that works), not the broken URL
 * Classic script, no network beyond our own cards-brand.js, no storage. All copy comes from our data files and is
 * rendered with textContent; sticker SVG comes from our own data file.
 */
(function (w, d) {
  'use strict';
  var YSD = w.YSD || {};
  var html = d.documentElement;
  var page = html.getAttribute('data-page');
  var lang = YSD.lang || (String(html.lang).slice(0, 2) === 'es' ? 'es' : 'en');
  var ES = lang === 'es' ? 'es/' : '';
  var mq = w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)');
  function still() { return (mq && mq.matches) || (YSD.ui && YSD.ui.motion && YSD.ui.motion.paused && YSD.ui.motion.paused()); }

  function $(sel, root) { return (root || d).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || d).querySelectorAll(sel)); }
  function L(o) { return o ? (o[lang] != null ? o[lang] : (o.en || '')) : ''; }
  function t(key, vars) {
    var s = YSD.t ? YSD.t(key, vars) : '';
    if (!s || s === key) {
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
  function focus(n) { if (!n) return; if (!n.hasAttribute('tabindex') && !/^(A|BUTTON)$/.test(n.tagName)) n.setAttribute('tabindex', '-1'); try { n.focus({ preventScroll: true }); } catch (e) { n.focus(); } }
  function into(n) { try { n.scrollIntoView({ block: 'nearest', behavior: still() ? 'auto' : 'smooth' }); } catch (e) {} }
  function toast(s, o) { if (YSD.ui && YSD.ui.toast && s) YSD.ui.toast(s, o || {}); }
  function track(n, p) { if (YSD.track) try { YSD.track(n, p); } catch (x) {} }
  function link(path) { return YSD.share && YSD.share.url ? YSD.share.url(ES + path) : ''; }
  function ready(fn) { if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', fn); else fn(); }

  /* ------------------------------------------------------------------ about: real or DEMO deck */
  function game() {
    var root = $('[data-rd-game]');
    if (!root) return;
    var box = root.closest('.x-game') || root.parentNode;
    var cards = $$('.x-rd', root), total = cards.length;
    var count = $('[data-rd-count]', box), live = $('[data-rd-live]', box), end = $('[data-rd-end]', box);
    var big = $('[data-rd-big]', box), line = $('[data-rd-line]', box);
    var idx = 0, right = 0;
    if (!total) return;
    box.setAttribute('data-ready', '');

    function place(i) {
      cards.forEach(function (c, k) {
        var pos = k < i ? 'gone' : String(Math.min(k - i, 3));
        c.setAttribute('data-pos', pos);
        if (k === i) { c.removeAttribute('inert'); c.removeAttribute('aria-hidden'); } else { c.setAttribute('inert', ''); c.setAttribute('aria-hidden', 'true'); }
      });
      if (count) count.textContent = t('about:rd.count', { n: Math.min(i + 1, total), total: total });
    }
    function clear() {
      idx = 0; right = 0;
      cards.forEach(function (c) {
        c.setAttribute('data-state', 'idle');
        c.removeAttribute('data-correct');
        $$('[data-rd-pick]', c).forEach(function (b) { b.setAttribute('aria-pressed', 'false'); b.removeAttribute('aria-disabled'); });
        var v = $('[data-rd-verdict]', c); if (v) v.textContent = '';
      });
      var lastNext = $('[data-rd-next]', cards[total - 1]);
      if (lastNext) lastNext.textContent = t('about:rd.last');
      root.hidden = false;
      if (end) end.hidden = true;
      box.removeAttribute('data-done');
      if (live) live.textContent = '';
      place(0);
    }
    function finish() {
      box.setAttribute('data-done', '');
      root.hidden = true;
      if (count) count.textContent = '';
      if (big) big.textContent = t('about:rd.big', { n: right, total: total });
      if (line) line.textContent = t('about:rd.final', { n: right, total: total }) + ' ' + (right === total ? t('about:rd.perfect') : t('about:rd.done'));
      if (end) end.hidden = false;
      if (right === total && YSD.ui && YSD.ui.confetti && end) YSD.ui.confetti(end);
      focus(big);
      track('about_real_or_demo_done', { right: right, total: total });
    }
    clear();

    root.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-rd-pick]');
      if (b && root.contains(b)) {
        var c = b.closest('.x-rd');
        if (!c || c.getAttribute('data-state') === 'answered') return;
        var ok = b.getAttribute('data-rd-pick') === c.getAttribute('data-rd');
        if (ok) right++;
        c.setAttribute('data-state', 'answered');
        c.setAttribute('data-correct', ok ? 'true' : 'false');
        $$('[data-rd-pick]', c).forEach(function (x) { x.setAttribute('aria-disabled', 'true'); });
        b.setAttribute('aria-pressed', 'true');
        var v = $('[data-rd-verdict]', c); if (v) v.textContent = t(ok ? 'about:rd.right' : 'about:rd.wrong');
        // the back face carries the verdict, the tag, the why and the source: read it next
        focus($('[data-rd-back]', c));
        if (live) live.textContent = t('about:rd.score', { n: right, total: idx + 1 });
        track('about_real_or_demo', { right: ok });
        return;
      }
      var n = e.target.closest && e.target.closest('[data-rd-next]');
      if (n && root.contains(n)) {
        idx++;
        if (idx >= total) { finish(); return; }
        place(idx);
        var first = $('[data-rd-pick]', cards[idx]);
        focus(first);
      }
    });
    var reset = $('[data-rd-reset]', box);
    if (reset) reset.addEventListener('click', function () { clear(); focus($('[data-rd-pick]', cards[0])); });
    var share = $('[data-rd-share]', box);
    if (share) share.addEventListener('click', function () {
      if (!YSD.ui || !YSD.ui.share || !YSD.share || !YSD.share.url) return; // share URLs only ever come from YSD.share.url()
      YSD.ui.share({ url: link('about.html#real-or-demo'), text: t('about:rd.shareText', { n: right, total: total }), title: t('about:rd.shareTitle') });
    });
  }

  /* ------------------------------------------------------------------ about: crew map */
  function crews() {
    var box = $('[data-crew-finder]');
    if (!box) return;
    var list = $('[data-crew-list]', box), cards = list ? $$('.x-crew[data-crew]', list) : [], pins = $$('[data-crew-pin]', box);
    if (!cards.length || !pins.length) return;
    var ids = cards.map(function (c) { return c.getAttribute('data-crew'); });
    box.setAttribute('data-ready', '');
    function select(id, move) {
      var card = null;
      cards.forEach(function (c) { var on = c.getAttribute('data-crew') === id; c.hidden = !on; if (on) card = c; });
      pins.forEach(function (p) {
        var on = p.getAttribute('data-crew-pin') === id;
        if (on) p.setAttribute('aria-current', 'true'); else p.removeAttribute('aria-current');
        p.parentNode.toggleAttribute('data-on', on);
      });
      if (move && card) {
        focus(card);
        into(card);
        if (!still()) { card.removeAttribute('data-pop'); void card.offsetWidth; card.setAttribute('data-pop', ''); }
      }
      return card;
    }
    var m = /^#crew-([\w-]+)$/.exec(w.location.hash || '');
    select(m && ids.indexOf(m[1]) >= 0 ? m[1] : ids[0], false);
    box.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('[data-crew-pin]');
      if (!a) return;
      e.preventDefault();
      select(a.getAttribute('data-crew-pin'), true);
      track('about_crew_pin', { crew: a.getAttribute('data-crew-pin') });
    });
  }

  /* ------------------------------------------------------------------ about: roles (data/team.js) */
  function roles() {
    var box = $('[data-roles]'), T = (w.YSD_DATA || {}).team;
    if (!box || !T || !T.roles) return;
    var labels = T.labels || {};
    T.roles.slice().sort(function (a, b) { return a.order - b.order; }).forEach(function (r) {
      var li = el('li', 'x-role');
      var tok = (r.avatar && r.avatar.token) || '--violet';
      li.style.setProperty('--role', 'var(' + (tok === '--ink' ? '--night' : tok) + ')');
      var det = el('details', 'x-role__det');
      var sum = el('summary', 'x-role__sum');
      var mono = el('span', 'x-role__mono', (r.avatar && r.avatar.monogram) || '?');
      mono.setAttribute('aria-hidden', 'true');
      var info = (T.tokens || {})[tok] || {};
      if (info.fg && /^#F/i.test(info.fg)) mono.setAttribute('data-fg', 'light');
      var txt = el('span', 'x-role__txt');
      txt.appendChild(el('span', 'x-role__title', L(r.title)));
      txt.appendChild(el('span', 'x-role__seat', L(r.seat === 'officer' ? labels.officer : labels.chair)));
      sum.appendChild(mono);
      sum.appendChild(txt);
      det.appendChild(sum);
      var body = el('div', 'x-role__body');
      body.appendChild(el('p', 'x-role__bio', L(r.bio)));
      if (r.does && r.does.length) {
        var ul = el('ul', 'x-role__does');
        r.does.forEach(function (x) { ul.appendChild(el('li', '', L(x))); });
        body.appendChild(ul);
      }
      det.appendChild(body);
      li.appendChild(det);
      box.appendChild(li);
    });
  }

  // Run for a role: a short lead and the button up front; the long version, eligibility and "something bigger" fold away
  function run() {
    var box = $('[data-run]'), T = (w.YSD_DATA || {}).team, R = T && T.runForRole;
    if (!box || !R) return;
    box.appendChild(el('p', 'x-run__lead', t('about:run.lead') || L(R.body)));
    var row = el('div', 'btn-row');
    var a = el('a', 'btn btn--primary', L(R.cta && R.cta.label));
    var contact = cfg((R.cta && R.cta.key) || 'links.contact');
    a.href = contact || 'join.html?intent=role';
    row.appendChild(a);
    box.appendChild(row);
    var more = el('details', 'x-run__elig');
    more.appendChild(el('summary', '', t('about:run.more')));
    more.appendChild(el('p', '', L(R.body)));
    more.appendChild(el('p', '', L(R.bigger)));
    box.appendChild(more);
    var elig = el('details', 'x-run__elig');
    elig.appendChild(el('summary', '', t('about:run.elig')));
    elig.appendChild(el('p', '', L(R.eligibility)));
    box.appendChild(elig);
    var note = el('p', 'x-run__note');
    note.appendChild(el('span', 'tag tag--demo', L((T.labels || {}).demo) || 'DEMO'));
    note.appendChild(d.createTextNode(' ' + L(R.demoNote)));
    box.appendChild(note);
  }

  /* ------------------------------------------------------------------ about: contact */
  function contact() {
    var url = cfg('links.contact');
    if (!url) return;
    var a = $('[data-contact-link]'), set = $('[data-contact-set]');
    if (a) { a.href = url; a.hidden = false; }
    if (set) set.hidden = false;
    var fb = $('[data-contact-fallback]'); if (fb) fb.hidden = true;
    var j = $('[data-contact-join]'); if (j) j.hidden = true;
  }

  /* ------------------------------------------------------------------ 404: sticker toy */
  var ROUND = 10;
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var x = a[i]; a[i] = a[j]; a[j] = x; }
    return a;
  }
  function factOf(s) {
    var f = s.fact;
    if (s.expires && Date.now() >= Date.parse(s.expires) && s.next) f = s.next;
    return L(f);
  }
  function svgOf(s) { return String(s.svg || '').replace('<svg ', '<svg aria-hidden="true" focusable="false" '); } // trusted: our own data file
  // Ten slots spread over the lid (percent of width/height), so stickers overlap a little, not a lot.
  var SLOTS = [[14, 20], [40, 14], [68, 18], [86, 34], [20, 56], [80, 72], [54, 78], [12, 84], [34, 40], [62, 46]];

  // cards-brand.js (75 KB) loads only once someone plays, from the folder this script came from
  var cardsP = null;
  function haveLaptop() { return !!(YSD.cards && YSD.cards.has && YSD.cards.has('laptop') && YSD.brandCards); }
  function loadCards() {
    if (haveLaptop()) return Promise.resolve(true);
    if (cardsP) return cardsP;
    cardsP = new Promise(function (res) {
      var me = d.querySelector('script[src*="js/pages/about.js"]');
      if (!me || !YSD.cards) { res(false); return; }
      var s = d.createElement('script');
      s.src = me.src.replace(/js\/pages\/about\.js(\?[^#]*)?$/, 'js/cards-brand.js');
      s.onload = function () { res(haveLaptop()); };
      s.onerror = function () { cardsP = null; res(false); };
      d.head.appendChild(s);
    });
    return cardsP;
  }

  function toy() {
    var root = $('[data-toy]');
    var S = (w.YSD_DATA || {}).stickers;
    if (!root || !S || !S.items || !S.items.length) return;
    var btn = $('[data-toy-btn]', root), art = $('[data-toy-art]', root), lid = $('[data-toy-lid]', root);
    var bubble = $('[data-toy-fact]', root), count = $('[data-toy-count]', root), again = $('[data-toy-reset]', root);
    var done = $('[data-toy-done]', root), send = $('[data-toy-send]', root);
    var items = S.items.filter(function (s) { return s && s.svg; });
    var size = Math.min(ROUND, items.length);
    var deck = [], found = 0, slots = [], placed = [];
    var canvas = null, canvasN = -1, seq = 0, timer = 0;
    root.setAttribute('data-ready', '');

    function show(s) {
      art.innerHTML = svgOf(s);
      btn.setAttribute('aria-label', t('notFound:toy.btn', { name: L(s.name) }));
      btn.setAttribute('data-sticker-id', s.id);
      if (!still()) { art.removeAttribute('data-state'); void art.offsetWidth; art.setAttribute('data-state', 'in'); }
    }
    function updateCount() { count.textContent = t('notFound:toy.count', { n: found, total: size }); }
    function render() {
      var n = placed.length, my = ++seq;
      return loadCards().then(function (ok) {
        if (!ok) return null;
        return YSD.brandCards.render('laptop', { stickers: placed.slice(), link: link('404.html'), total: size, lang: lang }, { size: 'portrait' }).then(function (c) {
          if (my === seq) { canvas = c; canvasN = n; }
          return c;
        });
      });
    }
    function queue() { clearTimeout(timer); timer = setTimeout(function () { render().catch(function () {}); }, 250); }
    function start() {
      deck = shuffle(items.slice()).slice(0, size);
      slots = shuffle(SLOTS.slice());
      found = 0; placed = []; canvas = null; canvasN = -1; seq++;
      $$('.x-slapped', lid).forEach(function (n) { n.remove(); });
      lid.removeAttribute('data-full');
      bubble.textContent = '';
      bubble.appendChild(el('span', 'x-bubble__hint', t('notFound:toy.hint')));
      bubble.removeAttribute('data-civic');
      btn.hidden = false;
      if (done) done.hidden = true;
      if (send) send.hidden = true;
      again.hidden = true;
      updateCount();
      show(deck[0]);
    }
    function slap() {
      var s = deck[found];
      if (!s) return;
      var pos = slots[found % slots.length];
      var x = pos[0] + (Math.random() * 6 - 3), y = pos[1] + (Math.random() * 6 - 3), r = Math.round(Math.random() * 50 - 25);
      var n = el('span', 'sticker x-slapped');
      n.setAttribute('aria-hidden', 'true');
      n.innerHTML = svgOf(s);
      n.style.setProperty('--x', x.toFixed(1) + '%');
      n.style.setProperty('--y', y.toFixed(1) + '%');
      n.style.setProperty('--rot', r + 'deg');
      lid.appendChild(n);
      placed.push({ id: s.id, x: +(x / 100).toFixed(3), y: +(y / 100).toFixed(3), r: r, size: 0.19 });
      // the fact, with its source
      bubble.textContent = '';
      bubble.appendChild(el('strong', 'x-bubble__name', L(s.name)));
      bubble.appendChild(d.createTextNode(' ' + factOf(s) + ' '));
      if (s.source && s.source.url) {
        var sl = s.source.label, own = sl && typeof sl === 'object' ? (sl[lang] || sl.en) : sl;
        var label = (lang !== 'en' && t('notFound:toy.src.' + s.id)) || own || s.source.url;
        var a = el('a', 'x-bubble__src', t('notFound:toy.source', { label: label }));
        a.href = s.source.url;
        if (/^https?:/.test(s.source.url)) a.rel = 'noopener';
        bubble.appendChild(a);
      }
      if (s.tone === 'calm' || s.kind === 'civic' || s.id === 'envelope') bubble.setAttribute('data-civic', ''); else bubble.removeAttribute('data-civic');
      found++;
      updateCount();
      if (send && send.hidden) send.hidden = false;
      queue();
      track('notfound_sticker', { id: s.id });
      if (found >= deck.length) {
        lid.setAttribute('data-full', '');
        btn.hidden = true;
        if (done) done.hidden = false;
        again.hidden = false;
        focus(send && !send.hidden ? send : again);
        if (!bubble.hasAttribute('data-civic') && YSD.ui && YSD.ui.confetti) YSD.ui.confetti(lid);
        return;
      }
      show(deck[found]);
    }
    btn.addEventListener('click', slap);
    again.addEventListener('click', function () { start(); btn.focus(); });
    if (send) send.addEventListener('click', function () {
      if (!placed.length) return;
      var n = placed.length;
      var text = t('notFound:toy.sendText', { n: n, total: size }), url = link('404.html');
      function go(c) {
        if (!c) { // no card template: share the link so the button still does something useful
          if (YSD.ui && YSD.ui.share && url) return YSD.ui.share({ url: url, text: text, title: t('notFound:toy.sendTitle') });
          return null;
        }
        return YSD.cards.share(c, { title: t('notFound:toy.sendTitle'), text: text, url: url, filename: 'ydsc-laptop.png' }).then(function (res) {
          if (res === 'downloaded') toast(t('notFound:toy.saved'), { priority: 'high' });
          else if (res === 'failed') toast(t('notFound:toy.failed'), { tone: 'error', priority: 'high' });
          track('notfound_laptop_card', { result: res, n: n });
          return res;
        });
      }
      if (canvas && canvasN === n) { go(canvas); return; }
      send.setAttribute('aria-busy', 'true');
      render().then(go, function () { toast(t('notFound:toy.failed'), { tone: 'error', priority: 'high' }); })
        .then(function () { send.removeAttribute('aria-busy'); }, function () { send.removeAttribute('aria-busy'); });
    });
    start();
  }

  function nfShare() {
    var b = $('[data-nf-share]');
    if (!b) return;
    b.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation(); // the page-level [data-share] handler would share this broken URL
      if (!YSD.share || !YSD.share.url || !YSD.ui || !YSD.ui.share) return; // share URLs only ever come from YSD.share.url()
      YSD.ui.share({ url: link('index.html'), text: t('notFound:share.text'), title: t('notFound:share.title') });
    }, true);
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
    if (page === 'about') { game(); crews(); roles(); run(); contact(); }
    if (page === 'notFound') { fixFragments(); toy(); nfShare(); }
  });
})(window, document);
