/*! YDSC · assets/js/pages/host.js (G-EVENTS, round 1, Tue Nov 10, 2026). host.html, "Host a night (chapter in a box)"
 * (right-wing-chapter-kit): the checklist (kept in this browser only: ysd:host:check), the flyer, story card and name
 * tags drawn with YSD.cards (templates 'host-flyer' and 'host-tags', registered here; each carries the link, the DEMO
 * mark and the paid-for line), and copy-paste invite texts filled from the same details. Nothing typed here leaves the
 * browser. Cards render when the section comes near the screen (or on "Draw my cards"), before any share tap, so Web
 * Share keeps its user gesture. Share links come from YSD.share.url(). No network calls, no AI.
 */
(function (w, d) {
  'use strict';
  var YSD = w.YSD = w.YSD || {};
  var CHECK = 'host:check';
  var CITIES = ['Altamonte Springs', 'Casselberry', 'Lake Mary', 'Longwood', 'Oviedo', 'Sanford', 'Winter Springs'];
  var C = { tangerine: '#FF8B3D', night: '#170B33', cream: '#FFF6EA', white: '#FFFFFF', celery: '#C8F03C', sky: '#4FD6FF', bubblegum: '#FF7AC6', sun: '#FFD23F', violet: '#6A2BFF', mint: '#7EE081' };
  var DISPLAY = '"Bricolage Grotesque", "Bricolage fb", "Arial Narrow", sans-serif';
  var BODY = '"Atkinson Hyperlegible Next", "Atkinson fb", system-ui, sans-serif';
  var canvases = {}, rendering = null, dirty = true;

  function $(s, r) { return (r || d).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || d).querySelectorAll(s)); }
  function t(k, v) { return YSD.t ? YSD.t('host:' + k, v) : ''; }
  function lang() { return YSD.lang || 'en'; }
  function cfg(p, f) { return typeof YSD.cfg === 'function' ? YSD.cfg(p, f) : f; }
  function sget(k, f) { try { return YSD.store ? YSD.store.get(k, f) : f; } catch (e) { return f; } }
  function sset(k, v) { try { if (YSD.store) YSD.store.set(k, v); } catch (e) {} }
  function track(e, p) { try { if (YSD.track) YSD.track(e, p); } catch (x) {} }
  function toast(text, opts) { if (YSD.ui && YSD.ui.toast && text) YSD.ui.toast(text, opts || {}); }
  function link() { try { return YSD.share.url((lang() === 'es' ? 'es/' : '') + 'events.html'); } catch (e) { return ''; } }
  function pretty(u) { return YSD.ui && YSD.ui.prettyLink ? YSD.ui.prettyLink(u) : u; }

  /* ------------------------------------------------------------------ checklist (per-viewer convenience only) */
  function checklist() {
    var list = $('[data-checklist]'), prog = $('[data-check-progress]'), reset = $('[data-check-reset]');
    if (!list) return;
    var boxes = $$('input[type="checkbox"]', list);
    var saved = sget(CHECK, []); if (!Array.isArray(saved)) saved = [];
    boxes.forEach(function (b) { b.checked = saved.indexOf(b.value) >= 0; });
    function paint() {
      var n = boxes.filter(function (b) { return b.checked; }).length;
      if (prog) prog.textContent = t('check.progress', { n: n, total: boxes.length });
      list.setAttribute('data-done', n === boxes.length ? 'all' : String(n));
    }
    list.addEventListener('change', function () {
      sset(CHECK, boxes.filter(function (b) { return b.checked; }).map(function (b) { return b.value; }));
      paint();
      if (boxes.every(function (b) { return b.checked; }) && YSD.ui && YSD.ui.confetti) YSD.ui.confetti(prog || list);
    });
    if (reset) reset.addEventListener('click', function () { boxes.forEach(function (b) { b.checked = false; }); sset(CHECK, []); paint(); if (boxes[0]) boxes[0].focus(); });
    paint();
  }

  /* ------------------------------------------------------------------ details (form or sample) */
  function nextThursday() {
    var n = new Date(); n.setHours(12, 0, 0, 0);
    var add = (4 - n.getDay() + 7) % 7 || 7;
    n.setDate(n.getDate() + add + 7); // two weeks-ish out: room to promote it
    if (n.getDate() >= 8 && n.getDate() <= 14) n.setDate(n.getDate() + 7); // never the second Thursday
    return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
  }
  /** New York offset for a calendar date: EDT from the second Sunday of March to the first Sunday of November. */
  function nyOffset(y, m, dd) {
    function nthSunday(month, nth) { var x = new Date(Date.UTC(y, month, 1)); var first = (7 - x.getUTCDay()) % 7 + 1; return first + (nth - 1) * 7; }
    var start = nthSunday(2, 2), end = nthSunday(10, 1);
    var dst = (m > 3 && m < 11) || (m === 3 && dd >= start) || (m === 11 && dd < end);
    return dst ? '-04:00' : '-05:00';
  }
  function monthOf(iso) {
    try { return new Intl.DateTimeFormat(lang() === 'es' ? 'es-US' : 'en-US', { timeZone: 'America/New_York', month: 'short' }).format(new Date(iso)).replace(/\.$/, ''); } catch (e) { return ''; }
  }
  function details() {
    var f = $('[data-host-form]');
    var v = function (n) { var i = f && f.elements[n]; return i ? String(i.value || '').trim() : ''; };
    var date = /^\d{4}-\d{2}-\d{2}$/.test(v('date')) ? v('date') : nextThursday();
    var time = /^\d{2}:\d{2}$/.test(v('time')) ? v('time') : '19:00';
    var p = date.split('-').map(Number);
    var iso = date + 'T' + time + ':00' + nyOffset(p[0], p[1], p[2]);
    return {
      night: v('night').slice(0, 48) || t('cards.sampleName'),
      place: v('place').slice(0, 48) || t('cards.samplePlace'),
      city: v('city') || 'Oviedo',
      iso: iso,
      date: YSD.fmt && YSD.fmt.date ? YSD.fmt.date(iso) : date,
      month: monthOf(iso), day: String(p[2]),
      time: YSD.fmt && YSD.fmt.time ? YSD.fmt.time(iso) : time,
      link: link()
    };
  }

  /* ------------------------------------------------------------------ card templates */
  function stickerImg(id) {
    try {
      var url = YSD.ui && YSD.ui.stickerDataUrl ? YSD.ui.stickerDataUrl(id) : '';
      if (!url) return Promise.resolve(null);
      return YSD.cards.h.loadImage(url).catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }
  function footer(ctx, W, H, s, y, url) {
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = C.night;
    ctx.font = '800 ' + Math.round(30 * s) + 'px ' + BODY;
    ctx.fillText(t('cards.rsvp'), 80 * s, y);
    ctx.font = '700 ' + Math.round(30 * s) + 'px ' + BODY;
    YSD.cards.h.wrapText(ctx, pretty(url), 80 * s, y + 42 * s, W - 160 * s, 36 * s, { maxLines: 2 });
    var legal = cfg('legal.cardFooter', '');
    ctx.fillStyle = C.night; ctx.fillRect(0, H - 92 * s, W, 92 * s);
    ctx.fillStyle = C.cream; ctx.font = '600 ' + Math.round(22 * s) + 'px ' + BODY;
    YSD.cards.h.wrapText(ctx, legal, 80 * s, H - 54 * s, W - 330 * s, 26 * s, { maxLines: 2 });
  }
  function drawFlyer(ctx, data, env) {
    var W = env.width, H = env.height, s = env.scale, h = env.h, tall = H / W > 1.5;
    ctx.fillStyle = C.tangerine; ctx.fillRect(0, 0, W, H);
    // a soft sun disc, flat (no gradient behind text)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.22)'; ctx.beginPath(); ctx.arc(W * 0.92, H * (tall ? 0.42 : 0.5), W * 0.42, 0, Math.PI * 2); ctx.fill();
    if (YSD.cards.brand) YSD.cards.brand.lockup(ctx, 80 * s, 72 * s, 76 * s, { word: { fill: C.night, swoosh: C.white } });
    // DEMO EVENT pill
    h.sticker(ctx, t('cards.demoEvent').toUpperCase(), W - 190 * s, 110 * s, { size: 28 * s, bg: C.white, fg: C.night, family: BODY, weight: 800, border: C.night, borderWidth: 4 * s, rotate: 4 });
    var y = (tall ? 330 : 230) * s;
    ctx.fillStyle = C.night; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.font = '800 ' + Math.round(30 * s) + 'px ' + BODY;
    ctx.fillText(t('cards.hostedBy').toUpperCase(), 80 * s, y);
    y += 56 * s;
    var fit = h.fitText(ctx, data.night, W - 160 * s, { max: (tall ? 170 : 140) * s, min: 64 * s, maxLines: 3, lineHeight: 0.9, family: DISPLAY });
    fit.lines.forEach(function (ln, i) { ctx.fillText(ln, 80 * s, y + i * fit.lineHeight); });
    y += fit.lines.length * fit.lineHeight + (tall ? 70 : 44) * s;
    // date ticket
    var tw = 300 * s, th = (tall ? 250 : 210) * s;
    h.roundRect(ctx, 80 * s, y, tw, th, 28 * s, { fill: C.white, stroke: C.night, lineWidth: 6 * s });
    ctx.textAlign = 'center'; ctx.fillStyle = C.night;
    ctx.font = '800 ' + Math.round(36 * s) + 'px ' + BODY;
    ctx.fillText(data.month.toUpperCase(), 80 * s + tw / 2, y + 26 * s);
    ctx.font = '800 ' + Math.round((tall ? 120 : 100) * s) + 'px ' + DISPLAY;
    var dayNum = data.day;
    ctx.fillText(dayNum, 80 * s + tw / 2, y + 70 * s);
    ctx.font = '700 ' + Math.round(34 * s) + 'px ' + BODY;
    ctx.fillText(data.time, 80 * s + tw / 2, y + th - 56 * s);
    ctx.textAlign = 'left';
    var lx = 80 * s + tw + 44 * s, lw = W - lx - 80 * s;
    ctx.font = '800 ' + Math.round(44 * s) + 'px ' + DISPLAY;
    var r1 = h.wrapText(ctx, data.date, lx, y + 6 * s, lw, 50 * s, { maxLines: 2 });
    ctx.font = '700 ' + Math.round(34 * s) + 'px ' + BODY;
    var r2 = h.wrapText(ctx, data.place, lx, y + 20 * s + r1.height, lw, 40 * s, { maxLines: 2 });
    ctx.fillText(data.city, lx, y + 28 * s + r1.height + r2.height);
    y += th + (tall ? 60 : 40) * s;
    ctx.font = '800 ' + Math.round(34 * s) + 'px ' + BODY;
    ctx.fillText(t('cards.free'), 80 * s, y);
    return stickerImg('megaphone').then(function (img) {
      if (img) { ctx.save(); ctx.translate(W - 210 * s, y - (tall ? 160 : 140) * s); ctx.rotate(-0.18); ctx.drawImage(img, -120 * s, -120 * s, 240 * s, 240 * s); ctx.restore(); }
      footer(ctx, W, H, s, H - (tall ? 240 : 200) * s, data.link);
    });
  }
  function drawTags(ctx, data, env) {
    var W = env.width, H = env.height, s = env.scale, h = env.h;
    ctx.fillStyle = C.cream; ctx.fillRect(0, 0, W, H);
    var cols = 2, rows = 3, gx = 80 * s, gy = 70 * s, gap = 36 * s;
    var cw = (W - gx * 2 - gap) / cols, ch = (H - 260 * s - gap * (rows - 1)) / rows;
    var bands = [C.tangerine, C.celery, C.sky, C.bubblegum, C.sun, C.mint];
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var x = gx + c * (cw + gap), y = gy + r * (ch + gap), i = r * cols + c;
      ctx.setLineDash([14 * s, 10 * s]);
      h.roundRect(ctx, x, y, cw, ch, 26 * s, { fill: C.white, stroke: C.night, lineWidth: 4 * s });
      ctx.setLineDash([]);
      h.roundRect(ctx, x, y, cw, ch * 0.36, [26 * s, 26 * s, 0, 0], { fill: bands[i % bands.length] });
      ctx.fillStyle = C.night; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.font = '800 ' + Math.round(46 * s) + 'px ' + DISPLAY;
      ctx.fillText(t('cards.hello'), x + 28 * s, y + 26 * s);
      ctx.font = '700 ' + Math.round(20 * s) + 'px ' + BODY;
      ctx.fillText(data.night.slice(0, 30), x + 28 * s, y + ch * 0.36 - 34 * s);
      if (YSD.cards.brand) YSD.cards.brand.mark(ctx, x + cw - 92 * s, y + ch - 78 * s, 64 * s, {});
    }
    ctx.fillStyle = C.night; ctx.fillRect(0, H - 120 * s, W, 120 * s);
    ctx.fillStyle = C.cream; ctx.font = '600 ' + Math.round(22 * s) + 'px ' + BODY; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    h.wrapText(ctx, pretty(data.link), 80 * s, H - 74 * s, W - 330 * s, 28 * s, { maxLines: 1 });
    h.wrapText(ctx, cfg('legal.cardFooter', ''), 80 * s, H - 40 * s, W - 330 * s, 26 * s, { maxLines: 1 });
  }
  function register() {
    if (!YSD.cards || typeof YSD.cards.register !== 'function') return false;
    if (!(YSD.cards.has && YSD.cards.has('host-flyer'))) YSD.cards.register('host-flyer', drawFlyer, { size: 'story' });
    if (!(YSD.cards.has && YSD.cards.has('host-tags'))) YSD.cards.register('host-tags', drawTags, { size: 'story' });
    return true;
  }
  var SIZES = { flyer: ['host-flyer', { width: 1080, height: 1350 }], story: ['host-flyer', { width: 1080, height: 1920 }], tags: ['host-tags', { width: 1080, height: 1350 }] };
  function renderAll() {
    if (!register()) return Promise.resolve();
    var data = details();
    dirty = false;
    var waitFonts = YSD.cards.h && YSD.cards.h.waitForFonts ? YSD.cards.h.waitForFonts(['800 40px "Bricolage Grotesque"', '700 30px "Atkinson Hyperlegible Next"'], 1500).catch(function () {}) : Promise.resolve();
    rendering = waitFonts.then(function () {
      return Promise.all(Object.keys(SIZES).map(function (k) {
        return YSD.cards.render(SIZES[k][0], data, SIZES[k][1]).then(function (cv) {
          canvases[k] = cv;
          var box = $('[data-card="' + k + '"] [data-prev]');
          if (!box) return;
          box.textContent = '';
          var img = d.createElement('img');
          try { img.src = cv.toDataURL('image/jpeg', 0.72); } catch (e) { img = cv; }
          img.alt = t('cards.alt', { kind: t('cards.' + k).toLowerCase() });
          box.appendChild(img);
        });
      }));
    }).catch(function () {});
    return rendering;
  }
  function wireCards() {
    var f = $('[data-host-form]'); if (!f) return;
    var sel = $('[data-host-city]', f);
    if (sel && !sel.options.length) CITIES.forEach(function (c) { var o = d.createElement('option'); o.value = c; o.textContent = c; o.setAttribute('translate', 'no'); if (c === 'Oviedo') o.selected = true; sel.appendChild(o); });
    f.addEventListener('input', function () { dirty = true; texts(); });
    f.addEventListener('change', function () { dirty = true; texts(); });
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      renderAll().then(function () { var first = $('[data-card-share="flyer"]'); if (first) first.focus(); });
      track('host_cards', {});
    });
    $$('[data-card-save]').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-card-save'), cv = canvases[k];
        if (!cv || dirty) { renderAll(); return; }
        YSD.cards.download(cv, 'young-dems-' + k + '.png').then(function (r) { if (r === 'downloaded') toast(t('cards.saved'), { tone: 'success', priority: 'high' }); });
        track('host_card_save', { kind: k });
      });
    });
    $$('[data-card-share]').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-card-share'), cv = canvases[k];
        if (!cv || dirty) { renderAll(); return; }
        var data = details();
        YSD.cards.share(cv, { title: data.night, text: textFor(2, data), url: data.link, filename: 'young-dems-' + k + '.png' }).then(function (r) {
          if (r === 'downloaded') toast(t('cards.saved'), { tone: 'success', priority: 'high' });
          else if (r === 'failed') toast(YSD.t ? YSD.t('toast.shareFailed') : '', { tone: 'error', priority: 'high' });
        });
        track('host_card_share', { kind: k });
      });
    });
    // draw when the section comes near the screen, so the first view stays light
    var sec = $('#cards');
    if (sec && 'IntersectionObserver' in w) {
      var io = new w.IntersectionObserver(function (en) { if (en.some(function (x) { return x.isIntersecting; })) { io.disconnect(); renderAll(); } }, { rootMargin: '400px 0px' });
      io.observe(sec);
    } else renderAll();
  }

  /* ------------------------------------------------------------------ invite texts */
  function textFor(n, data) {
    data = data || details();
    var tpl = t('texts.' + n);
    var demo = cfg('demo', true) !== false ? ' ' + t('texts.demo') : '';
    var base = String(tpl).replace(/\s*\{link\}\s*$/, '');
    var filled = YSD.fill ? YSD.fill(base, { night: data.night, date: data.date, time: data.time, place: data.place, city: data.city }) : base;
    return filled + demo + ' ' + data.link;
  }
  function texts() {
    var data = details();
    $$('[data-text]').forEach(function (li) {
      var body = $('[data-text-body]', li);
      if (body) body.textContent = textFor(li.getAttribute('data-text'), data);
    });
  }
  function wireTexts() {
    texts();
    $$('[data-copy]').forEach(function (b) {
      b.addEventListener('click', function () {
        var txt = textFor(b.getAttribute('data-copy'));
        Promise.resolve(YSD.share && YSD.share.copy ? YSD.share.copy(txt) : false).then(function (ok) {
          toast(ok ? t('texts.copied') : (YSD.t ? YSD.t('toast.shareFailed') : ''), { tone: ok ? 'success' : 'error', priority: 'high' });
          b.setAttribute('data-state', 'pressed'); setTimeout(function () { b.removeAttribute('data-state'); }, 160);
        });
        track('host_text_copy', { n: b.getAttribute('data-copy') });
      });
    });
  }

  /* ------------------------------------------------------------------ send the kit to a co-host */
  function wireShare() {
    var b = $('[data-host-share]'); if (!b) return;
    b.addEventListener('click', function (evt) {
      evt.preventDefault();
      evt.stopPropagation(); // ui.js would share the generic page text instead
      var url = YSD.share && YSD.share.url ? YSD.share.url((lang() === 'es' ? 'es/' : '') + 'host.html') : '';
      var text = String(t('share.text')).replace(/\s*\{link\}\s*$/, '');
      if (YSD.ui && YSD.ui.share) YSD.ui.share({ title: t('seo.ogTitle'), text: text, url: url });
      else if (YSD.share && YSD.share.native) YSD.share.native({ title: t('seo.ogTitle'), text: text, url: url });
      track('host_kit_share', {});
    });
  }

  function init() {
    checklist();
    wireCards();
    wireTexts();
    wireShare();
    if (YSD.ui && YSD.ui.stickers) YSD.ui.stickers(d);
  }
  if (YSD.ui && YSD.ui.ready) YSD.ui.ready(init); else if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', init); else init();
})(window, document);
