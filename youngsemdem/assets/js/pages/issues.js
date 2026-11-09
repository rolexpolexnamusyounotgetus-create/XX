/*! assets/js/pages/issues.js · W3 · issues.html.
 * Renders the nine issue sections from data/issues.js into the static shells (id = issue id, so
 * issues.anchors.issues and quiz links resolve without JS). Every fact shows its source on tap; demo
 * activities say DEMO (and hide when YSD_CONFIG.demo is false); serious issues use the calm template
 * (no sticker, no rotation, no money ask). Share actions send a 4:5 stat card (YSD.cards, rendered
 * before the click) or, failing that, the issue's group-chat text with a link from YSD.share.url().
 * Testing: ?now=2027-01-02 previews time-bound hooks, labels and stale facts on another day.
 */
(function (w, d) {
  'use strict';
  var YSD = w.YSD = w.YSD || {};
  var I = (w.YSD_DATA || {}).issues;
  if (!I) return;
  var L = YSD.lang === 'es' ? 'es' : 'en';
  var q = /[?&]now=(\d{4}-\d{2}-\d{2})/.exec(w.location.search);
  var NOW = q ? Date.parse(q[1] + 'T12:00:00-05:00') : Date.now();
  var DEMO = YSD.cfg ? YSD.cfg('demo', true) !== false : true;
  // fills for canvas cards (same constants as tokens.css); serious issues use Lake blue
  var HEX = { orange: '#FF6B1A', pink: '#FF4FA3', violet: '#6A2BFF', bubblegum: '#FF7AC6', 'violet-deep': '#4B12D6', lime: '#7EE081', celery: '#C8F03C', sky: '#4FD6FF', teal: '#00B3A6', lake: '#2236C9' };
  var STICKER = { transit: 'train', wages: 'sun', voting: 'envelope', water: 'gator' };

  function t(k, v) { return YSD.t ? YSD.t('issues:' + k, v) : ''; }
  function tx(o) { return o == null ? '' : typeof o === 'string' ? o : (o[L] != null ? o[L] : (o.en || '')); }
  function after(o) { return o && o.date && NOW >= Date.parse(o.date + 'T00:00:00-05:00'); }
  function $(s, r) { return (r || d).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || d).querySelectorAll(s)); }
  function el(tag, cls, text) { var e = d.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function add(p) { for (var i = 1; i < arguments.length; i++) if (arguments[i]) p.appendChild(arguments[i]); return p; }
  function toast(s, o) { if (s && YSD.ui && YSD.ui.toast) YSD.ui.toast(s, o); }
  function track(e, p) { try { if (YSD.track) YSD.track(e, p || {}); } catch (x) {} }
  function fresh(f) { return !f.staleAfter || NOW < Date.parse(f.staleAfter + 'T23:59:59-05:00'); }
  function fmtDay(ymd) { return YSD.fmt ? YSD.fmt.date(ymd + 'T12:00:00-05:00', { year: true, weekday: false }) : ymd; }
  function enOnly(node) { if (L === 'es') node.setAttribute('lang', 'en'); return node; }
  function serious(it) { return it.tone === 'serious'; }
  function fill(it) { return serious(it) ? 'lake' : it.color; }
  function fillVar(it) { return serious(it) ? 'var(--lake)' : 'var(--issue-' + it.color + ')'; }
  function sv(st) { return L === 'es' && st.valueEs ? st.valueEs : st.value; } // stat.value is shared; valueEs only where words differ
  function firstStat(it) { for (var i = 0; i < it.facts.length; i++) if (it.facts[i].stat && fresh(it.facts[i])) return it.facts[i]; return null; }
  function pageHref(a) { return (I.pages[a.page] || 'index.html') + (a.query ? '?' + a.query : '') + (a.hash ? '#' + a.hash : ''); }
  function shareUrl(it) { return YSD.share ? YSD.share.url('issues.html#' + it.id) : w.location.href.split('#')[0] + '#' + it.id; }

  /* ---------- jump tiles: add each issue's headline number ---------- */
  I.items.forEach(function (it) {
    var a = $('[data-chip="' + it.id + '"]'); if (!a) return;
    a.style.setProperty('--fill', fillVar(it));
    a.setAttribute('data-on', serious(it) || it.onColor === 'paper' ? 'light' : 'dark');
    var f = it.facts.filter(function (x) { return x.stat && fresh(x) && !/^\d$/.test(x.stat.value); })[0]; // skip bare digits ("4") on tiles
    if (f) a.insertBefore(el('span', 'x-chip__n', sv(f.stat)), a.firstChild);
    else a.setAttribute('data-nonum', ''); // no sourced number: the name itself becomes the headline
  });

  /* ---------- one issue ---------- */
  function factItem(f, showStat) {
    var li = el('li', 'x-fact');
    if (showStat && f.stat) add(li, add(el('p', 'x-fact__n'), el('span', '', sv(f.stat)), el('span', 'x-fact__l', ' ' + tx(f.stat.label))));
    var ft = el('p', 'x-fact__t', tx(f.text)); ft.setAttribute('data-real', ''); add(li, ft);
    var det = el('details', 'x-src'), body = el('div', 'x-src__body');
    add(det, el('summary', '', t('js.source')));
    var a = enOnly(el('a', '', f.sourceName)); a.href = f.source; a.rel = 'noopener';
    add(body, add(el('p'), a));
    (f.sources || []).forEach(function (s) { var x = enOnly(el('a', '', s.name)); x.href = s.url; x.rel = 'noopener'; add(body, add(el('p'), x)); });
    if (f.sourceEs && L === 'es') { var e = el('a', '', f.sourceEs); e.href = f.sourceEs; e.rel = 'noopener'; add(body, add(el('p'), e)); }
    add(body, el('p', 'x-fine', t('js.checked', { date: fmtDay(f.verified) }) + (f.computed ? ' ' + t('js.computed') : '')));
    add(li, add(det, body));
    return li;
  }
  function actionRow(it) {
    var row = el('div', 'x-acts');
    [it.action].concat(it.moreActions || []).forEach(function (a, i) {
      if (!a) return;
      var label = after(a.labelAfter) ? tx(a.labelAfter) : tx(a.label), cls = 'btn btn--sm ' + (i ? 'btn--ghost' : 'btn--primary');
      var wrap = el('span', 'x-act'), b;
      if (a.type === 'share') { b = el('button', cls, label); b.type = 'button'; b.setAttribute('data-issue-share', it.id); }
      else { b = el('a', cls, label); b.href = pageHref(a); }
      add(wrap, b);
      if (a.demo && DEMO) add(wrap, el('span', 'tag tag--demo', YSD.t ? YSD.t('demo.badge') : 'DEMO'));
      var off = a.official && YSD.cfg ? YSD.cfg(a.official, '') : '';
      if (off) { var o = el('a', 'x-off', t('js.official')); o.href = off; o.rel = 'noopener'; o.setAttribute('data-official', ''); add(wrap, o); }
      row.appendChild(wrap);
    });
    return row;
  }
  function render(it) {
    var sec = d.getElementById(it.id); if (!sec) return;
    var calm = serious(it), stat = firstStat(it);
    sec.setAttribute('data-tone', calm ? 'calm' : 'bright');
    sec.style.setProperty('--fill', fillVar(it));
    var h2 = $('.x-issue__title', sec);
    h2.textContent = tx(it.title);
    var wrap = el('div', 'wrap x-issue__grid');
    var head = el('header', 'x-issue__head');
    head.setAttribute('data-on', calm || it.onColor === 'paper' ? 'light' : 'dark');
    var hook = el('p', 'x-issue__hook', after(it.hookAfter) ? tx(it.hookAfter) : tx(it.hook));
    hook.setAttribute('data-real', ''); // hooks only use numbers sourced in the facts below
    add(head, el('p', 'eyebrow', tx(it.short).toUpperCase()), h2, hook);
    if (stat) add(head, add(el('p', 'x-issue__big'), el('span', 'x-issue__n', sv(stat.stat)), el('span', 'x-issue__l', tx(stat.stat.label))));
    if (!calm && STICKER[it.id]) { var st = el('button', 'sticker x-issue__sticker'); st.type = 'button'; st.setAttribute('data-sticker', STICKER[it.id]); head.appendChild(st); }
    var body = el('div', 'x-issue__body');
    var facts = el('ol', 'x-facts');
    it.facts.filter(fresh).forEach(function (f) { facts.appendChild(factItem(f, f !== stat)); });
    add(body, el('h3', 'x-h', t('js.numbers')), facts);
    var doing = (it.ydsc || []).filter(function (y) { return DEMO || !y.demo; });
    if (doing.length) {
      var ul = el('ul', 'x-doing');
      doing.forEach(function (y) {
        var li = el('li', y.demo ? 'x-doing__demo' : 'x-doing__real', tx(y.text));
        if (!y.demo && y.source) { li.appendChild(d.createTextNode(' ')); var a = el('a', 'x-tap', t('js.source')); a.href = y.source; a.rel = 'noopener'; li.appendChild(a); }
        ul.appendChild(li);
      });
      add(body, el('h3', 'x-h', t('js.doing')), ul);
    }
    add(body, el('h3', 'x-h', t('js.do')), actionRow(it));
    sec.textContent = '';
    add(sec, add(wrap, head, body));
  }
  I.items.forEach(render);
  if (YSD.ui) { if (YSD.ui.stickers) YSD.ui.stickers(d); if (YSD.ui.stickerFacts) YSD.ui.stickerFacts(d); }
  if (w.location.hash) { var target = d.getElementById(w.location.hash.slice(1)); if (target) setTimeout(function () { target.scrollIntoView(); }, 0); }

  /* ---------- share cards ---------- */
  var cards = YSD.cards, canvases = {};
  function byId(id) { for (var i = 0; i < I.items.length; i++) if (I.items[i].id === id) return I.items[i]; return null; }
  function shareText(it) { return after(it.share.textAfter) ? tx(it.share.textAfter) : tx(it.share.text); }
  function draw(ctx, data, env) {
    var it = byId(data.id), W = env.width, H = env.height, s = W / 1080, h = env.h, th = env.theme, m = 84 * s;
    var bg = HEX[fill(it)], ink = serious(it) || it.onColor === 'paper' ? '#FFF6EA' : '#170B33';
    var stat = firstStat(it), f = stat || it.facts[0];
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = 'top'; ctx.textAlign = 'left'; ctx.fillStyle = ink;
    var y = m;
    ctx.font = h.font(34 * s, 700, th.fontBody);
    var k = tx(it.short).toUpperCase() + ' · SEMINOLE';
    h.roundRect(ctx, m, y, ctx.measureText(k).width + 48 * s, 64 * s, 32 * s, { fill: ink });
    ctx.fillStyle = bg; ctx.fillText(k, m + 24 * s, y + 15 * s); ctx.fillStyle = ink;
    y += 120 * s;
    var big = stat ? sv(stat.stat) : tx(it.title);
    var ft = h.fitText(ctx, big, W - 2 * m, { max: (stat ? 300 : 150) * s, min: 80 * s, weight: 800, family: th.fontDisplay, maxLines: stat ? 1 : 3, lineHeight: 0.92 });
    ft.lines.forEach(function (ln, i) { ctx.fillText(ln, m, y + i * ft.lineHeight); });
    y += ft.lines.length * ft.lineHeight + 24 * s;
    if (stat) { ctx.font = h.font(52 * s, 700, th.fontBody); y += h.wrapText(ctx, tx(stat.stat.label), m, y, W - 2 * m, 62 * s, { maxLines: 2 }).height + 32 * s; }
    ctx.font = h.font(40 * s, 400, th.fontBody);
    y += h.wrapText(ctx, tx(f.text), m, y, W - 2 * m, 54 * s, { maxLines: 6 }).height + 28 * s;
    ctx.font = h.font(28 * s, 700, th.fontBody);
    h.wrapText(ctx, t('js.cardSource', { source: f.sourceName }), m, y, W - 2 * m, 36 * s, { maxLines: 2 });
    var fy = H - m - 110 * s;
    ctx.globalAlpha = 0.3; ctx.fillRect(m, fy - 28 * s, W - 2 * m, 3 * s); ctx.globalAlpha = 1;
    ctx.font = h.font(38 * s, 800, th.fontBody);
    ctx.fillText(YSD.ui && YSD.ui.prettyLink ? YSD.ui.prettyLink(data.url) : data.url, m, fy);
    ctx.font = h.font(26 * s, 400, th.fontBody);
    h.wrapText(ctx, (YSD.cfg && YSD.cfg('legal.cardFooter', '')) || '', m, fy + 54 * s, W - 2 * m, 34 * s, { maxLines: 2 });
  }
  function prerender(it) {
    if (!cards || canvases[it.id] !== undefined) return;
    canvases[it.id] = null;
    cards.render('w3-issue', { id: it.id, url: shareUrl(it) }, { width: 1080, height: 1350 }).then(function (cv) { canvases[it.id] = cv; }, function () {});
  }
  if (cards && cards.register) {
    cards.register('w3-issue', draw, { size: 'square' });
    if ('IntersectionObserver' in w) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { io.unobserve(e.target); prerender(byId(e.target.id)); } });
      }, { rootMargin: '400px' });
      $$('[data-issue]').forEach(function (s) { io.observe(s); });
    }
  }
  d.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-issue-share]'); if (!b) return;
    var it = byId(b.getAttribute('data-issue-share')), cv = canvases[it.id], url = shareUrl(it), text = shareText(it);
    track('card_made', { template: 'w3-issue', issue: it.id });
    if (cv && cards) {
      cards.share(cv, { title: tx(it.share.title), text: text, url: url, filename: 'ydsc-' + it.id + '.png' }).then(function (r) {
        if (r === 'downloaded') toast(t('js.cardReady'));
        else if (r === 'failed' && YSD.share) YSD.share.copy(text + ' ' + url).then(function () { toast(t('js.cardFail')); });
      });
    } else if (YSD.share && YSD.share.native) {
      YSD.share.native({ title: tx(it.share.title), text: text, url: url }).then(function (r) { if (!YSD.t) return; if (r === 'copied') toast(YSD.t('toast.linkCopied')); else if (r === 'failed') toast(YSD.t('toast.shareFailed'), { tone: 'error' }); });
    }
  });
})(window, document);
