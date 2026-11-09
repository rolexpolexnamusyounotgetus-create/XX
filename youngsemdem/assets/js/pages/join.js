/*!
 * assets/js/pages/join.js (W6): join.html behaviour around the shared join form (assets/js/joinform.js):
 * the live member pass in the ticket, the invite landing banner (until W2's YSD.invite is on this
 * page), the sticker shelf and the county sticker pack PNG (unlocked by joining, BRIEF 6b B40), the
 * chip-in link (YSD.share.actblue(5); hidden for members under 18) and in-page jumps to the form.
 * Untrusted text (the ?from= name, the typed first name) only ever goes in with textContent.
 */
(function (w, d) {
  'use strict';
  var YSD = w.YSD = w.YSD || {};
  function t(k, v) { return typeof YSD.t === 'function' ? YSD.t(k, v) : ''; }
  function $(s, r) { return (r || d).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || d).querySelectorAll(s)); }
  function lang() { return YSD.lang === 'es' ? 'es' : 'en'; }
  function member() { try { return YSD.members ? YSD.members.current() : null; } catch (e) { return null; } }
  function isMinor(m) { return !!m && typeof m.age === 'number' && m.age < 18; }

  var form = $('#join-form');
  var pass = $('[data-join-pass]');
  var CITY_LABEL = { sanford: 'Sanford', 'lake-mary': 'Lake Mary', oviedo: 'Oviedo', 'winter-springs': 'Winter Springs', 'altamonte-springs': 'Altamonte Springs', casselberry: 'Casselberry', longwood: 'Longwood' };

  // ------------------------------------------------------------- the live pass
  function monthLabel(ts) {
    try { return new Intl.DateTimeFormat(lang() === 'es' ? 'es-US' : 'en-US', { month: 'short', year: 'numeric', timeZone: 'America/New_York' }).format(new Date(ts || Date.now())); }
    catch (e) { return ''; }
  }
  function paintName(name) {
    var n = pass && $('[data-pass-name]', pass);
    if (!n) return;
    var v = String(name || '').trim().slice(0, 24);
    n.textContent = v || t('join:pass.name');
    pass.toggleAttribute('data-filled', !!v);
    // long names step the pass type down so they wrap at a hyphen or space, not mid-letter, at 320 px
    var len = Array.from(v).length;
    if (len > 12) pass.setAttribute('data-len', 'l'); else if (len > 8) pass.setAttribute('data-len', 'm'); else pass.removeAttribute('data-len');
  }
  function paintCity(city) {
    if (!pass) return;
    var label = $('[data-pass-city]', pass);
    if (city && /^[a-z-]+$/.test(city) && city !== 'outside' && city !== 'not-sure') {
      pass.style.setProperty('--pass', 'var(--city-' + (city === 'seminole' ? 'unincorporated' : city) + ')');
      pass.toggleAttribute('data-dark', city === 'seminole');   // violet colourway: cream text
      if (label) label.textContent = CITY_LABEL[city] || t('join:pass.county');
    } else {
      pass.style.removeProperty('--pass');
      pass.removeAttribute('data-dark');
      if (label) label.textContent = t('join:pass.county');
    }
  }
  function paintSince(ts) {
    var s = pass && $('[data-pass-since]', pass);
    var m = monthLabel(ts);
    if (s && m) s.textContent = t('join:pass.since', { month: m });
  }
  function stamp(on) {
    var s = pass && $('[data-pass-stamp]', pass);
    if (s) s.hidden = !on;
  }

  // ------------------------------------------------------------- locked / unlocked
  var packBtn = $('[data-sticker-pack]'), packNote = $('[data-pack-note]');
  var locked = $('[data-card-locked]'), chipSec = $('[data-chip-in-section]');
  function unlock(m) {
    if (packBtn) packBtn.removeAttribute('aria-disabled');
    if (packNote) packNote.hidden = true;
    if (locked) locked.hidden = true;
    if (chipSec) chipSec.hidden = isMinor(m);   // no money asks aimed at members under 18
    paintName(m.firstName); paintCity(m.city); paintSince(m.joinedAt);
    stamp(!(m.warnings && m.warnings.age === 'over_age_cap'));   // past the age cap: on the list, no "You're in" stamp
    if (pass) pass.setAttribute('data-state', 'joined');
  }
  function relock() {
    if (packBtn) packBtn.setAttribute('aria-disabled', 'true');
    if (packNote) packNote.hidden = false;
    if (locked) locked.hidden = false;
    if (chipSec) chipSec.hidden = false;
    paintName(''); paintCity(''); paintSince(); stamp(false);
    if (pass) pass.removeAttribute('data-state');
  }

  // ------------------------------------------------------------- jumps to the form
  function jump(e) {
    var m = member();
    var target = m ? $('[data-join-done-title]') : $('#join-first');
    if (!target) return;
    if (e) e.preventDefault();
    var box = target.closest('.x-ticket') || target;
    try { box.scrollIntoView({ block: 'start', behavior: YSD.ui && YSD.ui.motion && YSD.ui.motion.paused() ? 'auto' : 'smooth' }); } catch (x) { box.scrollIntoView(); }
    setTimeout(function () { try { target.focus({ preventScroll: true }); } catch (x) { target.focus(); } }, 350);
  }
  d.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-join-jump], .site-header a.btn--primary[href$="join.html"]');
    if (a) jump(e);
  });

  // ------------------------------------------------------------- invite landing (fallback for W2's YSD.invite)
  function landing() {
    var box = $('[data-invite-landing]');
    if (!box) return;
    if (YSD.invite && typeof YSD.invite.landing === 'function') { YSD.invite.landing(box); return; }
    var q;
    try { q = new URLSearchParams(w.location.search); } catch (e) { return; }
    var ref = (q.get('ref') || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
    if (!ref || member()) return;
    var seenKey = 'invite:seen:' + ref.toUpperCase();
    try { if (YSD.store && YSD.store.get(seenKey, null)) return; } catch (e) {}
    var from = (q.get('from') || '').replace(/[^\p{L}\s-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 20);
    box.textContent = '';
    var inner = d.createElement('div'); inner.className = 'wrap x-landing__inner';
    var txt = d.createElement('div'); txt.className = 'x-landing__text';
    var p1 = d.createElement('p'); p1.className = 'x-landing__title';
    p1.textContent = from ? t('join:landing.from', { from: from }) : t('join:landing.generic');
    var p2 = d.createElement('p'); p2.className = 'small'; p2.textContent = t('join:landing.sub');
    txt.appendChild(p1); txt.appendChild(p2);
    var go = d.createElement('a'); go.className = 'btn btn--primary btn--sm'; go.href = '#join-form'; go.setAttribute('data-join-jump', ''); go.textContent = t('cta.join');
    var x = d.createElement('button'); x.type = 'button'; x.className = 'btn btn--ghost btn--sm'; x.textContent = t('cta.close');
    x.addEventListener('click', function () {
      box.hidden = true;
      try { if (YSD.store) YSD.store.set(seenKey, Date.now()); } catch (e) {}
    });
    var acts = d.createElement('div'); acts.className = 'x-landing__acts'; acts.appendChild(go); acts.appendChild(x);
    inner.appendChild(txt); inner.appendChild(acts);
    box.appendChild(inner);
    box.hidden = false;
    try { if (YSD.track) YSD.track('invite_landing', { event: null, referred: true }); } catch (e) {}
  }

  // ------------------------------------------------------------- sticker shelf + pack
  function stickerItems() { var S = (w.YSD_DATA || {}).stickers; return S && Array.isArray(S.items) ? S.items : []; }
  function shelf() {
    var box = $('[data-sticker-shelf]');
    if (!box) return;
    var rots = [-8, 6, -4, 9, -6, 5, -10, 7, -3, 8];
    stickerItems().forEach(function (s, i) {
      var b = d.createElement('button');
      b.type = 'button'; b.className = 'sticker x-pack__sticker';
      b.setAttribute('data-sticker', s.id);
      b.style.setProperty('--rot', rots[i % rots.length] + 'deg');
      b.setAttribute('aria-label', t('a11y.stickerTap', { name: (s.name && (s.name[lang()] || s.name.en)) || s.id }) || s.id);
      box.appendChild(b);
    });
    if (YSD.ui) { YSD.ui.stickers(box); YSD.ui.stickerFacts(box); }
  }
  function svgUrl(svg) { return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(String(svg).replace('<svg ', '<svg width="480" height="480" ')); }
  function loadImg(src) {
    return new Promise(function (res, rej) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = rej; i.src = src; });
  }
  function fontsReady() {
    try {
      if (!d.fonts || !d.fonts.load) return Promise.resolve();
      return Promise.all([d.fonts.load('800 72px "Bricolage Grotesque"'), d.fonts.load('700 32px "Atkinson Hyperlegible Next"')]).then(null, function () {});
    } catch (e) { return Promise.resolve(); }
  }
  function drawPack() {
    return fontsReady().then(drawPackNow);
  }
  function drawPackNow() {
    var items = stickerItems();
    var cols = 5, cell = 360, pad = 80, top = 200;
    var W = cols * cell + pad * 2, H = top + Math.ceil(items.length / cols) * cell + 140;
    var c = d.createElement('canvas'); c.width = W; c.height = H;
    var x = c.getContext('2d');
    x.fillStyle = '#FFF6EA'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#170B33';
    x.font = '800 72px "Bricolage Grotesque", "Bricolage fb", sans-serif';
    x.textBaseline = 'alphabetic';
    x.fillText('Young Dems', pad, 112);
    x.font = '700 32px "Atkinson Hyperlegible Next", "Atkinson fb", sans-serif';
    x.fillStyle = '#574D70';
    x.fillText(t('join:pack.title'), pad, 162);
    return Promise.all(items.map(function (s) { return loadImg(svgUrl(s.svg)); })).then(function (imgs) {
      imgs.forEach(function (img, i) {
        var size = 280, r = 10;
        var cx = pad + (i % cols) * cell + (cell - size) / 2, cy = top + Math.floor(i / cols) * cell + (cell - size) / 2;
        var sil = d.createElement('canvas'); sil.width = sil.height = size;
        var sx = sil.getContext('2d'); sx.drawImage(img, 0, 0, size, size);
        sx.globalCompositeOperation = 'source-in'; sx.fillStyle = '#FFFFFF'; sx.fillRect(0, 0, size, size);
        x.save(); x.shadowColor = 'rgba(23, 11, 51, .25)'; x.shadowBlur = 18; x.shadowOffsetY = 10;
        x.drawImage(sil, cx, cy + 4); x.restore();
        for (var a = 0; a < 16; a++) { var ang = a * Math.PI / 8; x.drawImage(sil, cx + Math.cos(ang) * r, cy + Math.sin(ang) * r); }
        x.drawImage(img, cx, cy, size, size);
      });
      x.font = '700 26px "Atkinson Hyperlegible Next", "Atkinson fb", sans-serif';
      x.fillStyle = '#574D70';
      x.fillText(String(YSD.cfg ? YSD.cfg('legal.cardFooter', '') : ''), pad, H - 60);
      return c;
    });
  }
  if (packBtn) packBtn.addEventListener('click', function () {
    if (packBtn.getAttribute('aria-disabled') === 'true') {
      if (YSD.ui) YSD.ui.toast(t('join:pack.locked'), { tone: 'info' });
      jump();
      return;
    }
    packBtn.setAttribute('data-state', 'loading');
    drawPack().then(function (canvas) {
      packBtn.removeAttribute('data-state');
      if (YSD.cards && YSD.cards.download) YSD.cards.download(canvas, t('join:pack.file') || 'young-dems-sticker-pack.png');
      else {
        var a = d.createElement('a'); a.href = canvas.toDataURL('image/png'); a.download = 'young-dems-sticker-pack.png'; d.body.appendChild(a); a.click(); a.remove();
      }
      if (YSD.ui) YSD.ui.toast(t('join:pack.done'), { tone: 'success' });
      try { if (YSD.track) YSD.track('sticker_pack', {}); } catch (e) {}
    }, function () {
      packBtn.removeAttribute('data-state');
      if (YSD.ui) YSD.ui.toast(t('error.submit.failed'), { tone: 'error' });
    });
  });

  // ------------------------------------------------------------- chip-in
  function chipIn() {
    var a = $('[data-chip-in]');
    if (!a) return;
    var u = YSD.share && YSD.share.actblue ? YSD.share.actblue(5) : '';
    if (u) a.href = u; else if (chipSec) chipSec.hidden = true;
  }


  // Hand face: switch it on only when a [data-hand] element nears the viewport (see the page CSS).
  function lazyHand() {
    var els = d.querySelectorAll('[data-hand]');
    if (!els.length) return;
    var on = function () { d.documentElement.setAttribute('data-hand', 'on'); };
    if (!('IntersectionObserver' in w)) { on(); return; }
    var io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { on(); io.disconnect(); } }, { rootMargin: '600px 0px' });
    Array.prototype.forEach.call(els, function (e) { io.observe(e); });
  }

  // ------------------------------------------------------------- card saving, loaded after the page
  // W5's "Save my card" needs cards-brand.js + maker.js (about 90 KB). Only members see the card, so
  // they load when someone joins (or arrives already joined), then the member card repaints with the button.
  function loadScript(src) {
    return new Promise(function (res, rej) { var s = d.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; d.body.appendChild(s); });
  }
  function lateCardTools() {
    if (YSD.brandCards && YSD.maker) return;
    var root = YSD.root || '';
    loadScript(root + 'assets/js/cards-brand.js').then(function () { return loadScript(root + 'assets/js/maker.js'); }).then(function () {
      var host = $('#join-card');
      if (host && host.__ysdCard && host.__ysdCard.refresh) host.__ysdCard.refresh();
    }, function () {});
  }

  // ------------------------------------------------------------- wiring
  if (form) {
    var first = $('#join-first');
    if (first) first.addEventListener('input', function () { paintName(first.value); });
    form.addEventListener('reset', function () { setTimeout(function () { paintName(''); }, 0); });
  }
  d.addEventListener('change', function (e) {
    var el = e.target;
    if (el && el.name === 'city' && el.closest('[data-join]')) paintCity(el.value);
  });
  d.addEventListener('ysd:join-form-joined', function (e) { unlock((e.detail && e.detail.member) || member() || {}); lateCardTools(); });
  d.addEventListener('ysd:join-form-saved', function (e) { var m = e.detail && e.detail.member; if (m) paintCity(m.city); });
  d.addEventListener('ysd:join-form-reset', relock);

  function boot() {
    paintSince();
    var m = member();
    if (m && m.firstName) unlock(m);
    landing();
    shelf();
    chipIn();
    lazyHand();
    if (m && m.firstName) lateCardTools();
  }
  if (YSD.ui && YSD.ui.ready) YSD.ui.ready(boot); else boot();
})(window, document);
