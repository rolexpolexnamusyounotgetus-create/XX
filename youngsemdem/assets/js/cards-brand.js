/*! YDSC · assets/js/cards-brand.js (W5). Brand share-card templates for YSD.cards (BRIEF 5.2, 5.5, 5.6).
 *
 * CONTRACT (Home W1, Join W6 and the quiz page use it; load after assets/js/cards.js and ui.js, with
 * data/slices/growth.js or data/sharekit.js + data/levels.js, plus data/issues.js or its slice for cover
 * and quiz-issue, data/quiz.js for the quiz cards and events data for invite):
 *
 *   YSD.brandCards.render(name, data, { size: 'portrait' | 'story' }) -> Promise<canvas>
 *       portrait = 4:5, 1080 x 1350; story = 9:16, 1080 x 1920. Wraps YSD.cards.render.
 *   YSD.brandCards.templates        ['invite','psa-mail','psa-id','join','cover','quiz-show-up',
 *                                    'quiz-issue','membercard','rewind'] (registered with YSD.cards)
 *   YSD.brandCards.available(name, now?) -> false outside a template's window (psa-mail ends
 *                                    Jan 1, 2027; rewind opens Thu, Dec 17, 2026, 7 am, or with ?preview=rewind)
 *   YSD.brandCards.path(name, data)  -> site path the card links to ('join.html', 'quiz/show-up/x.html'...)
 *   YSD.brandCards.sizes, .colorways(), .cities(), .stickers(), .issues(), .event(id), .marks(canvas)
 *
 *   data (all optional unless noted): { lang 'en'|'es', name (first name; generic copy without it),
 *     url (absolute share URL from YSD.share.url; else built from path()), colorway, sticker (data/stickers.js
 *     id), city (sharekit.cities id) } plus, per template:
 *       invite        { eventId | event }          cover         { issue (issues id), photo (Image) }
 *       quiz-show-up  { resultId, undertone, mix } quiz-issue    { resultId, undertone, mix }
 *       membercard    { since (ISO), stickers [ids] }
 *       rewind        { slide 1|2|3|'summary', counts { rsvps, cards, friends, stickers }, stickers [ids] }
 *
 * Every card, every size, prints the link (YSD.ui.prettyLink: no protocol, no utm, keeps ref), a DEMO mark
 * while YSD_CONFIG.demo is on, and the paid-for line (legal.cardFooter). PSA cards print "Official info:
 * voteseminole.gov" and use the required wording from docs/research/00. psa-id and serious issues
 * (data/issues.js tone 'serious') use the serious template: no stickers, no tilt. Colours are brand
 * constants (never theme tokens), so a card looks the same in light or dark. The selfie on the cover is
 * drawn as a two-colour halftone, never stored and never uploaded. YSD.brandCards.marks(canvas) returns
 * the boxes of the link, paid-for line and DEMO mark (for the pixel tests).
 * No AI, no network: sticker art comes from data/stickers.js as data: URLs.
 */
(function (w) {
  'use strict';
  var YSD = w.YSD = w.YSD || {};
  if (!YSD.cards || typeof YSD.cards.register !== 'function') return;

  var C = {
    violet: '#6A2BFF', violetDeep: '#4B12D6', celery: '#C8F03C', bubblegum: '#FF7AC6', hotpink: '#FF4FA3',
    sky: '#4FD6FF', tangerine: '#FF8B3D', orange: '#FF6B1A', teal: '#00B3A6', mint: '#7EE081', sun: '#FFD23F',
    lake: '#2236C9', night: '#170B33', cream: '#FFF6EA', white: '#FFFFFF'
  };
  var FILL = {
    violet: [C.violet, 1], 'violet-deep': [C.violetDeep, 1], night: [C.night, 1], lake: [C.lake, 1],
    celery: [C.celery, 0], bubblegum: [C.bubblegum, 0], pink: [C.hotpink, 0], hotpink: [C.hotpink, 0], sky: [C.sky, 0],
    tangerine: [C.tangerine, 0], orange: [C.orange, 0], teal: [C.teal, 0], lime: [C.mint, 0], mint: [C.mint, 0],
    sun: [C.sun, 0], cream: [C.cream, 0]
  };
  var SIZES = { portrait: { width: 1080, height: 1350 }, story: { width: 1080, height: 1920 } };
  var DISPLAY = '"Bricolage Grotesque", "Bricolage fb", "Arial Narrow", sans-serif';
  var BODY = '"Atkinson Hyperlegible Next", "Atkinson fb", system-ui, sans-serif';
  var BUBBLE = 'M10 3 H54 a8 8 0 0 1 8 8 V35 a8 8 0 0 1 -8 8 H28 L14 54 L16 43 H10 a8 8 0 0 1 -8 -8 V11 a8 8 0 0 1 8 -8 Z';
  var RESULT_ART = { hype: 'sun', chat: 'calendar', data: 'cypress', doors: 'chicken', creator: 'camera', plusone: 'heart' };
  var ISSUE_ART = { housing: 'heart', heat: 'sun', schools: 'calendar', wages: 'celery', transit: 'train', water: 'gator', voting: 'calendar' };
  var REWIND_FROM = '2026-12-17T07:00:00-05:00', PSA_MAIL_UNTIL = '2027-01-01T00:00:00-05:00';

  // ---------------------------------------------------------------- data access
  function D() { return w.YSD_DATA || {}; }
  function kit() { return D().sharekit || {}; }
  function cfg(p, fb) { return typeof YSD.cfg === 'function' ? YSD.cfg(p, fb) : fb; }
  function langOf(data) { var l = data && data.lang; return l === 'es' || l === 'en' ? l : (YSD.lang === 'es' ? 'es' : 'en'); }
  function pick(o, L) { return !o ? '' : typeof o === 'string' ? o : (o[L] != null ? o[L] : (o.en || '')); }
  function fill(s, vars) { return String(s == null ? '' : s).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? String(vars[k]) : m; }); }
  var FALLBACK = {
    'common.paidFor': { en: 'Paid for by [committee name and address placeholder]', es: 'Pagado por [nombre y dirección del comité]' },
    'common.demo': { en: 'DEMO', es: 'DEMO' }
  };
  function K(path, L, vars) {
    var o = kit().cards, parts = path.split('.');
    for (var i = 0; i < parts.length && o; i++) o = o[parts[i]];
    if (!o && FALLBACK[path]) o = FALLBACK[path];
    return fill(pick(o, L), vars);
  }
  function list(name) { var v = kit()[name]; return Array.isArray(v) ? v : []; }
  function byId(arr, id) { for (var i = 0; i < (arr || []).length; i++) if (arr[i] && arr[i].id === id) return arr[i]; return null; }
  function issues() { var I = D().issues; return (I && I.items) || []; }
  function quiz() { return D().quiz || {}; }
  function eventById(id) {
    if (!id) return null;
    try { if (YSD.events && typeof YSD.events.get === 'function') { var e = YSD.events.get(id); if (e) return e; } } catch (x) {}
    var E = D().events;
    return byId(E && E.items, id);
  }
  function cityName(id, L) {
    var c = byId(list('cities'), id);
    if (c) return pick(c.name, L);
    var E = D().events, m = E && E.cities && E.cities[id];
    return m ? pick(m, L) : '';
  }
  function now() { return Date.now(); }
  function previewRewind() { try { return /[?&]preview=rewind\b/.test(String(w.location.search)); } catch (e) { return false; } }

  // ---------------------------------------------------------------- canvas helpers
  function canvasOf(wd, ht) { var c = w.document.createElement('canvas'); c.width = Math.max(1, Math.ceil(wd)); c.height = Math.max(1, Math.ceil(ht)); return c; }
  function fam(env, which) {
    var t = env.theme || {}, f = which === 'display' ? t.fontDisplay : t.fontBody;
    if (!f || !/Bricolage|Atkinson/.test(f)) f = which === 'display' ? DISPLAY : BODY;
    return f;
  }
  function setFont(ctx, size, weight, family, stretch) {
    ctx.font = (stretch ? stretch + ' ' : '') + weight + ' ' + Math.round(size) + 'px ' + family;
    try { ctx.fontStretch = stretch || 'normal'; } catch (e) {}
  }
  function track(ctx, px) { try { ctx.letterSpacing = (px || 0) + 'px'; } catch (e) {} }
  function rr(ctx, x, y, wd, ht, r) { YSD.cards.h.roundRect(ctx, x, y, wd, ht, r); }
  function words(t) { return String(t == null ? '' : t).trim().split(/\s+/).filter(Boolean); }
  function wrap(ctx, text, maxW) {
    var ws = words(text), lines = [], line = '';
    for (var i = 0; i < ws.length; i++) {
      var t = line ? line + ' ' + ws[i] : ws[i];
      if (line && ctx.measureText(t).width > maxW) { lines.push(line); line = ws[i]; } else line = t;
    }
    if (line) lines.push(line);
    return lines;
  }
  /** Largest size (step 2) that fits maxLines in maxW (and maxH). Sets ctx.font. */
  function fit(ctx, text, maxW, o) {
    var lh = o.lh || 1, best = null;
    for (var s = o.max; s >= o.min; s -= 2) {
      setFont(ctx, s, o.weight || 800, o.family, o.stretch);
      var ls = wrap(ctx, text, maxW), ok = ls.length <= (o.maxLines || 1) && ls.length * s * lh <= (o.maxH || 1e9);
      for (var i = 0; ok && i < ls.length; i++) if (ctx.measureText(ls[i]).width > maxW) ok = false;
      if (ok) { best = { size: s, lines: ls, lh: s * lh }; break; }
    }
    if (!best) {
      setFont(ctx, o.min, o.weight || 800, o.family, o.stretch);
      var all = wrap(ctx, text, maxW), cut = all.slice(0, o.maxLines || 1);
      if (all.length > cut.length) cut[cut.length - 1] = cut[cut.length - 1] + '…';
      best = { size: o.min, lines: cut, lh: o.min * lh };
    }
    setFont(ctx, best.size, o.weight || 800, o.family, o.stretch);
    best.height = best.lines.length * best.lh;
    return best;
  }
  /** Draw fitted lines from top y; align 'left' | 'center'. Optional marker swipe under the last line. */
  function draw(ctx, f, x, y, color, align, markColor) {
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = align || 'left';
    for (var i = 0; i < f.lines.length; i++) {
      var base = y + f.lh * i + f.size * 0.8;
      if (markColor && i === f.lines.length - 1) {
        var lw = ctx.measureText(f.lines[i]).width, lx = align === 'center' ? x - lw / 2 : x;
        ctx.fillStyle = markColor;
        ctx.fillRect(lx - f.size * 0.03, base - f.size * 0.26, lw + f.size * 0.06, f.size * 0.3);
      }
      ctx.fillStyle = color;
      ctx.fillText(f.lines[i], x, base);
    }
    return f.height;
  }
  function textW(ctx, s) { return ctx.measureText(s).width; }
  /** Pill: fill, edge, hard shadow. Returns {w, h}. */
  function pill(ctx, env, text, x, y, o) {
    o = o || {};
    var size = o.size || 26;
    setFont(ctx, size, 800, fam(env, 'body'));
    track(ctx, o.track == null ? size * 0.1 : o.track);
    var tw = textW(ctx, text), padX = o.padX || size * 0.8, ht = o.height || Math.round(size * 2.1), wd = tw + padX * 2;
    ctx.save();
    ctx.translate(x, y);
    if (o.rotate) ctx.rotate(o.rotate * Math.PI / 180);
    if (o.shadow) { ctx.fillStyle = o.shadow; rr(ctx, 6, 6, wd, ht, ht / 2); ctx.fill(); }
    ctx.fillStyle = o.bg; rr(ctx, 0, 0, wd, ht, ht / 2); ctx.fill();
    if (o.edge) { ctx.lineWidth = o.edgeWidth || 3; ctx.strokeStyle = o.edge; ctx.stroke(); }
    ctx.fillStyle = o.fg; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillText(text, padX, ht / 2 + size * 0.05);
    ctx.restore();
    track(ctx, 0);
    return { w: wd, h: ht };
  }
  function mark(env, key, x, y, wd, ht) {
    env.marks = env.marks || {};
    env.marks[key] = [Math.round(x), Math.round(y), Math.round(wd), Math.round(ht)];
    try { env.canvas.__ysdMarks = env.marks; } catch (e) {}
  }
  function world(name) {
    var f = FILL[name] || FILL.violet;
    return { name: FILL[name] ? name : 'violet', bg: f[0], dark: !!f[1], fg: f[1] ? C.cream : C.night, mark: f[1] ? C.bubblegum : C.cream, kickBg: f[1] ? C.celery : C.night, kickFg: f[1] ? C.night : C.cream };
  }

  // ---------------------------------------------------------------- brand mark, DEMO tag, band, link panel
  function brand(ctx, env, wd, x, y, scale) {
    var s = scale || 1;
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    if (typeof w.Path2D === 'function') {
      var p = new w.Path2D(BUBBLE);
      ctx.fillStyle = wd.bg === C.violet ? C.night : C.violet; ctx.fill(p);
      ctx.lineWidth = 3; ctx.strokeStyle = wd.dark ? C.cream : C.night; ctx.stroke(p);
    }
    setFont(ctx, 21, 800, fam(env, 'display'));
    ctx.fillStyle = C.celery; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('YD', 32, 31);
    setFont(ctx, 34, 800, fam(env, 'display'), 'semi-condensed');
    ctx.fillStyle = wd.fg; ctx.textAlign = 'left';
    ctx.fillText('Young Dems', 74, 33);
    ctx.restore();
  }
  /** The brand's tangerine DEMO tag (top right). The engine adds its own small DEMO chip in the band. */
  function demoTag(ctx, env, data, label, right, y) {
    if (!env.demo) return 0;
    var L = langOf(data), t = String(label || K('common.demo', L)).toUpperCase();
    setFont(ctx, 26, 800, fam(env, 'body')); track(ctx, 2.6);
    var wd = textW(ctx, t) + 44; track(ctx, 0);
    var x = right - wd;
    pill(ctx, env, t, x, y, { size: 26, bg: C.tangerine, fg: C.night, edge: C.night, shadow: C.night, track: 2.6, padX: 22 });
    mark(env, 'demoTag', x, y, wd, 55);
    return wd;
  }
  var BAND = 120;
  /** Bottom band: the paid-for line, plus room for the engine's DEMO chip (or our own when it is off). */
  function band(ctx, env, data) {
    var W = env.width, H = env.height, y = H - BAND, L = langOf(data);
    ctx.fillStyle = C.night; ctx.fillRect(0, y, W, BAND);
    var right = W - 64;
    if (env.demo) {
      var engine = cfg('cards.demoWatermark', true) !== false;
      var s = env.scale;
      if (engine) {
        // cards.js draws 'DEMO' centred at (W - 110s, H - 60s), 26s type: reserve that box.
        mark(env, 'demo', W - 170 * s, H - 84 * s, 120 * s, 48 * s);
        right = W - 196 * s;
      } else {
        setFont(ctx, 24, 800, fam(env, 'body')); track(ctx, 2.4);
        var pw = textW(ctx, 'DEMO') + 40; track(ctx, 0);
        pill(ctx, env, 'DEMO', W - 64 - pw, y + (BAND - 50) / 2, { size: 24, bg: C.tangerine, fg: C.night, height: 50, padX: 20, track: 2.4 });
        mark(env, 'demo', W - 64 - pw, y + (BAND - 50) / 2, pw, 50);
        right = W - 64 - pw - 28;
      }
    }
    var paid = L === 'es' ? K('common.paidFor', L) : String(cfg('legal.cardFooter', '') || K('common.paidFor', L));
    paid = paid.replace(/\s*[·|-]\s*DEMO\s*$/i, '');
    var f = fit(ctx, paid, right - 64, { max: 26, min: 18, maxLines: 2, lh: 1.25, weight: 700, family: fam(env, 'body') });
    var top = y + (BAND - f.height) / 2 - 2;
    draw(ctx, f, 64, top, C.cream, 'left');
    var pw2 = 0; for (var i = 0; i < f.lines.length; i++) pw2 = Math.max(pw2, textW(ctx, f.lines[i]));
    mark(env, 'paidFor', 64, top, pw2, f.height);
    return y;
  }
  function linkFor(data, name) {
    var url = data.url;
    if (!url) { try { url = YSD.share && YSD.share.url ? YSD.share.url(path(name, data)) : path(name, data); } catch (e) { url = path(name, data); } }
    var pretty = data.link || (YSD.ui && YSD.ui.prettyLink ? YSD.ui.prettyLink(url) : String(url).replace(/^[a-z]+:\/\//i, ''));
    return pretty;
  }
  /** Link panel: cream box, ink edge, hard shadow; lead line + the link. Returns its height. */
  function linkPanel(ctx, env, data, name, lead, x, yBottom, wdMax, o) {
    o = o || {};
    var link = linkFor(data, name), pad = 30, innerW = wdMax - pad * 2;
    setFont(ctx, 34, 800, fam(env, 'body'));
    var lf = fit(ctx, link, innerW, { max: 36, min: 22, maxLines: 2, lh: 1.2, weight: 700, family: fam(env, 'body') });
    var leadH = lead ? 46 : 0, ht = pad * 2 + leadH + lf.height - 4, y = yBottom - ht;
    ctx.fillStyle = C.night; rr(ctx, x + 9, y + 9, wdMax, ht, 26); ctx.fill();
    ctx.fillStyle = o.bg || C.cream; rr(ctx, x, y, wdMax, ht, 26); ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = C.night; ctx.stroke();
    if (lead) {
      setFont(ctx, 32, 800, fam(env, 'body'));
      ctx.fillStyle = C.violetDeep; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
      ctx.fillText(lead + '  →', x + pad, y + pad + 30);
    }
    setFont(ctx, lf.size, 700, fam(env, 'body'));
    draw(ctx, lf, x + pad, y + pad + leadH - 2, C.night, 'left');
    mark(env, 'link', x, y, wdMax, ht);
    return ht;
  }
  function bubbleSize(ctx, env, text, maxW, o) {
    var f = fit(ctx, text, maxW - 64, { max: o.max || 44, min: 28, maxLines: o.maxLines || 3, lh: 1.18, weight: 700, family: fam(env, 'body') });
    var lw = 0; for (var i = 0; i < f.lines.length; i++) lw = Math.max(lw, textW(ctx, f.lines[i]));
    return { w: Math.min(maxW, lw + 64), h: f.height + 44 };
  }
  /** Speech bubble (cream, ink edge, tail bottom-left). Returns height. */
  function bubble(ctx, env, text, x, y, maxW, o) {
    o = o || {};
    var f = fit(ctx, text, maxW - 64, { max: o.max || 44, min: 28, maxLines: o.maxLines || 3, lh: 1.18, weight: 700, family: fam(env, 'body') });
    var lw = 0; for (var i = 0; i < f.lines.length; i++) lw = Math.max(lw, textW(ctx, f.lines[i]));
    var bw = Math.min(maxW, lw + 64), bh = f.height + 44;
    ctx.save();
    if (o.rotate) { ctx.translate(x, y); ctx.rotate(o.rotate * Math.PI / 180); ctx.translate(-x, -y); }
    ctx.fillStyle = C.night; rr(ctx, x + 7, y + 7, bw, bh, [30, 30, 30, 8]); ctx.fill();
    ctx.fillStyle = o.bg || C.cream; rr(ctx, x, y, bw, bh, [30, 30, 30, 8]); ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = C.night; ctx.stroke();
    setFont(ctx, f.size, 700, fam(env, 'body'));
    draw(ctx, f, x + 32, y + 20, o.fg || C.night, 'left');
    ctx.restore();
    return bh;
  }

  // ---------------------------------------------------------------- stickers (die-cut) and photo
  var artCache = {};
  function stickerUrl(id) {
    if (YSD.ui && typeof YSD.ui.stickerDataUrl === 'function') return YSD.ui.stickerDataUrl(id);
    var S = D().stickers, it = byId(S && S.items, id);
    return it ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(it.svg) : '';
  }
  function art(id) {
    if (!id) return Promise.resolve(null);
    if (!artCache[id]) {
      var url = stickerUrl(id);
      artCache[id] = url ? YSD.cards.h.loadImage(url).then(null, function () { return null; }) : Promise.resolve(null);
    }
    return artCache[id];
  }
  function arts(ids) { return Promise.all(ids.map(art)); }
  function silhouette(src, color) {
    var s = canvasOf(src.width, src.height), x = s.getContext('2d');
    x.drawImage(src, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, s.width, s.height);
    return s;
  }
  /** Draw sticker art with a white die-cut edge and a hard ink shadow, centred on (cx, cy). */
  function dieCut(ctx, img, cx, cy, size, rot) {
    if (!img) return;
    var edge = Math.round(size * 0.055), pad = edge + 16;
    var c = canvasOf(size + pad * 2, size + pad * 2), x = c.getContext('2d');
    x.drawImage(img, pad, pad, size, size);
    var white = silhouette(c, C.white), o = canvasOf(c.width, c.height), ox = o.getContext('2d');
    for (var a = 0; a < 24; a++) { var g = a / 24 * Math.PI * 2; ox.drawImage(white, Math.cos(g) * edge, Math.sin(g) * edge); }
    ox.drawImage(c, 0, 0);
    ctx.save(); ctx.translate(cx, cy); ctx.rotate((rot || 0) * Math.PI / 180);
    ctx.drawImage(silhouette(o, C.night), -o.width / 2 + 9, -o.height / 2 + 9);
    ctx.drawImage(o, -o.width / 2, -o.height / 2);
    ctx.restore();
  }
  /** Two-colour halftone of a photo inside a box (zine look; keeps PNGs small; nothing is stored). */
  function halftone(ctx, img, x, y, wd, ht, dot, paper, cell) {
    cell = cell || 10;
    var cols = Math.max(4, Math.round(wd / cell)), rows = Math.max(4, Math.round(ht / cell));
    var sc = canvasOf(cols, rows), sx = sc.getContext('2d');
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    var k = Math.max(cols / iw, rows / ih), sw = cols / k, sh = rows / k;
    sx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, 0, 0, cols, rows);
    var px;
    try { px = sx.getImageData(0, 0, cols, rows).data; } catch (e) { px = null; }
    ctx.fillStyle = paper; ctx.fillRect(x, y, wd, ht);
    if (!px) return;
    var lo = 255, hi = 0, i, lum = new Array(cols * rows);
    for (i = 0; i < cols * rows; i++) { var v = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]; lum[i] = v; if (v < lo) lo = v; if (v > hi) hi = v; }
    var span = Math.max(30, hi - lo), cw = wd / cols, ch = ht / rows, rmax = Math.min(cw, ch) * 0.62;
    ctx.fillStyle = dot;
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var d = 1 - (lum[r * cols + c] - lo) / span;
      if (d < 0.06) continue;
      ctx.beginPath(); ctx.arc(x + (c + 0.5) * cw, y + (r + 0.5) * ch, rmax * Math.sqrt(d), 0, Math.PI * 2); ctx.fill();
    }
  }

  // ---------------------------------------------------------------- shared frame
  function base(ctx, env, wd) { ctx.fillStyle = wd.bg; ctx.fillRect(0, 0, env.width, env.height); }
  function top(ctx, env, wd, data, demoLabel) {
    brand(ctx, env, wd, 64, 60, 1.25);
    demoTag(ctx, env, data, demoLabel, env.width - 64, 66);
    return 160;
  }
  function kicker(ctx, env, wd, text, x, y, serious) {
    return pill(ctx, env, text, x, y, { size: 28, bg: wd.kickBg, fg: wd.kickFg, edge: C.night, shadow: wd.dark ? C.night : null, rotate: serious ? 0 : -2, track: 2.4 });
  }
  /** Mix strip: label, segmented bar, top-3 legend. items [{label, pct, color}] sorted desc. Returns height. */
  function mixStrip(ctx, env, wd, label, items, x, y, width) {
    setFont(ctx, 24, 800, fam(env, 'body')); track(ctx, 2.4);
    ctx.fillStyle = wd.fg; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    ctx.fillText(label, x, y + 22); track(ctx, 0);
    var by = y + 40, bh = 52, tot = 0, i;
    for (i = 0; i < items.length; i++) tot += items[i].pct;
    if (!tot) return 0;
    ctx.save();
    rr(ctx, x, by, width, bh, bh / 2); ctx.clip();
    var cx = x;
    for (i = 0; i < items.length; i++) {
      var sw = width * items[i].pct / tot;
      ctx.fillStyle = items[i].color; ctx.fillRect(cx, by, sw + 1, bh);
      if (i) { ctx.fillStyle = C.night; ctx.fillRect(cx - 2, by, 4, bh); }
      cx += sw;
    }
    ctx.restore();
    rr(ctx, x, by, width, bh, bh / 2); ctx.lineWidth = 4; ctx.strokeStyle = C.night; ctx.stroke();
    var ly = by + bh + 44, lx = x;
    setFont(ctx, 28, 700, fam(env, 'body'));
    for (i = 0; i < Math.min(3, items.length); i++) {
      var t = items[i].pct + '% ' + items[i].label, tw = textW(ctx, t) + 52;
      if (lx + tw > x + width) break;
      ctx.fillStyle = items[i].color; ctx.beginPath(); ctx.arc(lx + 14, ly - 9, 14, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = C.night; ctx.stroke();
      ctx.fillStyle = wd.fg; ctx.fillText(t, lx + 38, ly);
      lx += tw + 18;
    }
    return ly - y + 10;
  }
  function done(env) { return env.marks; }

  // ---------------------------------------------------------------- template: quiz-show-up
  function resultOf(id) { var Q = quiz().organizerEra; return Q ? byId(Q.results, id) : null; }
  function mixItems(data, L, kind) {
    var mix = data.mix || {}, out = [];
    for (var id in mix) {
      if (!mix[id]) continue;
      if (kind === 'show-up') { var r = resultOf(id); if (r) out.push({ label: pick(r.name, L).replace(/^(The|La|El) /, ''), pct: mix[id], color: (FILL[r.color] || FILL.violet)[0] }); }
      else { var it = byId(issues(), id); if (it) out.push({ label: pick(it.short, L), pct: mix[id], color: (FILL[it.color] || FILL.violet)[0] }); }
    }
    out.sort(function (a, b) { return b.pct - a.pct; });
    return out.slice(0, 5);
  }
  function quizShowUp(ctx, data, env) {
    var L = langOf(data), r = resultOf(data.resultId) || (quiz().organizerEra || { results: [] }).results[0];
    if (!r) return Promise.reject(new Error('cards-brand: quiz data missing'));
    var wd = world(r.color), W = env.width, H = env.height, tall = H > 1500, pad = 64;
    var ids = [RESULT_ART[r.id] || 'sun', data.sticker || 'celery'];
    return arts(ids).then(function (im) {
      base(ctx, env, wd);
      var y = top(ctx, env, wd, data);
      y += tall ? 70 : 20;
      var kickY = y;
      kicker(ctx, env, wd, K('quizShowUp.kicker', L), pad, y);
      y += tall ? 120 : 96;
      var name = pick(r.name, L), bandY = H - BAND, line = pick(r.card && r.card.subline, L);
      if (data.name) line = data.name + ': \u201c' + line + '\u201d';
      // plan bottom-up (link panel, mix strip, bubble), then give the name what's left
      var linkBottom = bandY - (tall ? 120 : 48);
      var linkH = linkPanel(ctx, env, data, 'quiz-show-up', K('common.whatsYours', L), pad, linkBottom, W - pad * 2 - 10);
      var items = mixItems(data, L, 'show-up'), mixH = items.length > 1 ? 150 : 0;
      var mixY = linkBottom - linkH - (tall ? 60 : 40) - mixH;
      if (mixH) mixStrip(ctx, env, wd, K('quizShowUp.mix', L), items, pad, mixY, W - pad * 2);
      var bubW = W - pad * 2 - (tall ? 250 : 230), bubO = { max: tall ? 46 : 38, maxLines: 3, rotate: -1.5 };
      var bubH = bubbleSize(ctx, env, line, bubW, bubO).h;
      var bubTop = mixY - (tall ? 70 : 40) - bubH;
      var und = data.undertone && resultOf(data.undertone);
      var undTxt = und ? K('quizShowUp.undertone', L, { undertone: pick(und.name, L) }) : '';
      var uf = und ? fit(ctx, undTxt, W - pad * 2, { max: 40, min: 28, maxLines: 2, lh: 1.2, weight: 700, family: fam(env, 'body') }) : null;
      var room = bubTop - (tall ? 60 : 30) - y - (uf ? uf.height + 22 : 0);
      var nf = fit(ctx, name, W - pad * 2, { max: tall ? 270 : 190, min: 70, maxLines: 3, lh: 0.88, maxH: room, family: fam(env, 'display'), stretch: 'condensed' });
      y += draw(ctx, nf, pad, y, wd.fg, 'left', wd.mark);
      if (uf) { y += 22; setFont(ctx, uf.size, 700, fam(env, 'body')); y += draw(ctx, uf, pad, y, wd.fg, 'left'); }
      bubble(ctx, env, line, pad, bubTop, bubW, bubO);
      dieCut(ctx, im[0], W - pad - (tall ? 110 : 95), bubTop + bubH / 2, tall ? 220 : 180, 10);
      if (tall) dieCut(ctx, im[1], W - pad - 70, kickY + 30, 130, -12);
      band(ctx, env, data);
      return done(env);
    });
  }

  // ---------------------------------------------------------------- template: quiz-issue
  function issueFact(it, ref) {
    if (!it || !ref) return null;
    var fid = String(ref).split('.')[1];
    return byId(it.facts, fid);
  }
  function quizIssue(ctx, data, env) {
    var L = langOf(data), it = byId(issues(), data.resultId) || issues()[0];
    if (!it) return Promise.reject(new Error('cards-brand: issues data missing'));
    var Q = quiz().issueFinder || {}, res = (Q.results || {})[it.id] || {}, card = res.card || {};
    var serious = it.tone === 'serious', wd = world(it.color), W = env.width, H = env.height, tall = H > 1500, pad = 64;
    var useAfter = card.sublineAfter && now() >= Date.parse(card.sublineAfter.date + 'T00:00:00-05:00');
    var sub = useAfter ? pick(card.sublineAfter, L) : pick(card.subline, L);
    sub = sub.replace(/\s*(Find your issue\.|Encuentra tu tema\.)\s*$/, '');
    var fact = issueFact(it, useAfter ? card.sublineAfter.factRef : card.factRef);
    var ids = serious ? [] : [ISSUE_ART[it.id] || 'celery', data.sticker || 'gator'];
    return arts(ids).then(function (im) {
      base(ctx, env, wd);
      var y = top(ctx, env, wd, data);
      y += tall ? 70 : 20;
      kicker(ctx, env, wd, K('quizIssue.kicker', L), pad, y, serious);
      y += tall ? 120 : 96;
      var title = pick(it.short, L); title = title.charAt(0).toUpperCase() + title.slice(1) + '.';
      var tf = fit(ctx, title, W - pad * 2 - (serious ? 0 : 60), { max: tall ? 230 : 190, min: 90, maxLines: 3, lh: 0.9, family: fam(env, 'display'), stretch: 'condensed' });
      y += draw(ctx, tf, pad, y, wd.fg, 'left', serious ? null : wd.mark);
      var und = data.undertone && byId(issues(), data.undertone);
      if (und) {
        y += 20;
        var uf = fit(ctx, K('quizIssue.undertone', L, { undertone: pick(und.short, L) }), W - pad * 2, { max: 40, min: 28, maxLines: 2, lh: 1.2, weight: 700, family: fam(env, 'body') });
        y += draw(ctx, uf, pad, y, wd.fg, 'left');
      }
      var bandY = H - BAND;
      var linkH = linkPanel(ctx, env, data, 'quiz-issue', K('quizIssue.findYours', L), pad, bandY - (tall ? 120 : 48), W - pad * 2 - 10);
      var bottom = bandY - (tall ? 120 : 48) - linkH - (tall ? 60 : 36);
      var items = mixItems(data, L, 'issue');
      if (items.length > 1 && tall) { bottom -= 170; mixStrip(ctx, env, wd, K('quizShowUp.mix', L), items, pad, bottom + 20, W - pad * 2); bottom -= 30; }
      // fact block: panel with stat or the subline, and its source
      var panelW = W - pad * 2 - (serious ? 0 : (tall ? 0 : 170)), px = pad, inner = panelW - 64;
      var statTxt = fact && fact.stat ? fact.stat.value : '', statLbl = fact && fact.stat ? pick(fact.stat.label, L) : '';
      var src = fact && fact.sourceName ? K('quizIssue.source', L, { source: String(fact.sourceName).split(',')[0] }) : '';
      var sf = statTxt ? fit(ctx, statTxt, inner, { max: tall ? 150 : 120, min: 60, maxLines: 1, lh: 0.95, family: fam(env, 'display'), stretch: 'condensed' }) : null;
      var lf = fit(ctx, statTxt ? statLbl : sub, inner, { max: 38, min: 26, maxLines: 3, lh: 1.2, weight: 700, family: fam(env, 'body') });
      var srcF = src ? fit(ctx, src, inner, { max: 24, min: 18, maxLines: 2, lh: 1.25, weight: 600, family: fam(env, 'body') }) : null;
      var ph = 48 + (sf ? sf.height + 6 : 0) + lf.height + (srcF ? srcF.height + 14 : 0);
      var py = Math.max(y + 40, bottom - ph);
      ctx.fillStyle = C.night; rr(ctx, px + 9, py + 9, panelW, ph, 26); ctx.fill();
      ctx.fillStyle = C.cream; rr(ctx, px, py, panelW, ph, 26); ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = C.night; ctx.stroke();
      var ty = py + 26;
      if (sf) { setFont(ctx, sf.size, 800, fam(env, 'display'), 'condensed'); ty += draw(ctx, sf, px + 32, ty, C.violetDeep, 'left') + 6; }
      setFont(ctx, lf.size, 700, fam(env, 'body')); ty += draw(ctx, lf, px + 32, ty, C.night, 'left');
      if (srcF) { setFont(ctx, srcF.size, 600, fam(env, 'body')); draw(ctx, srcF, px + 32, ty + 14, '#574D70', 'left'); }
      if (!serious) {
        dieCut(ctx, im[0], W - 150, py - (tall ? 40 : 10), tall ? 200 : 170, 12);
        if (tall) dieCut(ctx, im[1], W - 140, y - 30, 130, -10);
      }
      band(ctx, env, data);
      return done(env);
    });
  }

  // ---------------------------------------------------------------- template: invite
  function colorOfEvent(ev) {
    var tok = ev && ev.cover && ev.cover.token ? String(ev.cover.token).replace(/^--/, '') : '';
    return FILL[tok] ? tok : 'violet';
  }
  function nyParts(iso, L) {
    var d = new Date(iso), out = { mon: '', day: '', wk: '', time: '' };
    if (isNaN(d)) return out;
    try {
      var loc = L === 'es' ? 'es-US' : 'en-US', tz = { timeZone: 'America/New_York' };
      out.mon = new Intl.DateTimeFormat(loc, { month: 'short', timeZone: tz.timeZone }).format(d).replace('.', '').toUpperCase();
      out.day = new Intl.DateTimeFormat(loc, { day: 'numeric', timeZone: tz.timeZone }).format(d);
      out.wk = new Intl.DateTimeFormat(loc, { weekday: 'short', timeZone: tz.timeZone }).format(d).replace('.', '');
    } catch (e) {}
    try { out.time = YSD.fmt && YSD.fmt.time ? YSD.fmt.time(iso) : ''; } catch (e) {}
    return out;
  }
  function invite(ctx, data, env) {
    var L = langOf(data), ev = data.event || eventById(data.eventId);
    var wd = world(data.colorway || colorOfEvent(ev)), W = env.width, H = env.height, tall = H > 1500, pad = 64;
    var title = ev ? pick(ev.title, L) : K('invite.fallbackTitle', L);
    var demoEv = ev ? ev.demo !== false : true;
    return arts([data.sticker || 'calendar']).then(function (im) {
      base(ctx, env, wd);
      var y = top(ctx, env, wd, data, demoEv ? K('invite.demoEvent', L) : null);
      y += tall ? 80 : 26;
      kicker(ctx, env, wd, K('invite.kicker', L), pad, y);
      y += tall ? 130 : 100;
      var head = data.name ? K('invite.withName', L, { name: data.name }) : K('invite.generic', L);
      var hf = fit(ctx, head, W - pad * 2, { max: tall ? 170 : 140, min: 80, maxLines: 3, lh: 0.9, family: fam(env, 'display'), stretch: 'condensed' });
      y += draw(ctx, hf, pad, y, wd.fg, 'left', wd.mark) + (tall ? 70 : 40);
      // the ticket: event card (cream) with a date stub
      var tw = W - pad * 2, stub = 230, th = tall ? 470 : 360, tx = pad, ty = y;
      ctx.save(); ctx.translate(tx + tw / 2, ty + th / 2); ctx.rotate(-1.2 * Math.PI / 180); ctx.translate(-tw / 2, -th / 2);
      ctx.fillStyle = C.night; rr(ctx, 10, 10, tw, th, 28); ctx.fill();
      ctx.fillStyle = C.cream; rr(ctx, 0, 0, tw, th, 28); ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = C.night; ctx.stroke();
      ctx.setLineDash([12, 12]); ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(stub, 22); ctx.lineTo(stub, th - 22); ctx.stroke(); ctx.setLineDash([]);
      var p = nyParts(ev && ev.start, L);
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      setFont(ctx, 34, 800, fam(env, 'body')); track(ctx, 5); ctx.fillStyle = C.violetDeep; ctx.fillText(p.mon, stub / 2 + 2, 78); track(ctx, 0);
      var df = fit(ctx, p.day || '?', stub - 50, { max: 170, min: 80, maxLines: 1, lh: 1, family: fam(env, 'display'), stretch: 'condensed' });
      ctx.fillStyle = C.night; ctx.textAlign = 'center'; ctx.fillText(p.day, stub / 2, 92 + df.size * 0.8);
      setFont(ctx, 30, 800, fam(env, 'body')); ctx.fillText(p.wk + (p.time ? ' · ' + p.time : ''), stub / 2, 92 + df.size * 0.8 + 52);
      var bx = stub + 36, bw = tw - stub - 64;
      var tf = fit(ctx, title, bw, { max: tall ? 72 : 60, min: 38, maxLines: tall ? 4 : 3, lh: 1, family: fam(env, 'display'), stretch: 'semi-condensed' });
      var used = draw(ctx, tf, bx, 40, C.night, 'left');
      var meta = [ev ? cityName(ev.city, L) : '', K('common.free', L)].filter(Boolean).join(' · ');
      setFont(ctx, 32, 700, fam(env, 'body')); ctx.fillStyle = '#574D70'; ctx.textAlign = 'left';
      ctx.fillText(meta, bx, Math.min(th - 120, 40 + used + 52));
      var lab = K('invite.imIn', L); setFont(ctx, 34, 800, fam(env, 'body'));
      var bbw = textW(ctx, lab) + 90, bby = th - 98;
      ctx.fillStyle = C.night; rr(ctx, bx, bby + 7, bbw, 68, 34); ctx.fill();
      ctx.fillStyle = C.celery; rr(ctx, bx, bby, bbw, 68, 34); ctx.fill(); ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = C.night; ctx.textBaseline = 'middle'; ctx.fillText(lab, bx + 45, bby + 36);
      ctx.restore();
      dieCut(ctx, im[0], W - pad - 40, ty + th - 30, tall ? 170 : 140, 14);
      if (tall && ev && ev.tagline) bubble(ctx, env, pick(ev.tagline, L), pad, ty + th + 90, W - pad * 2 - 140, { max: 44, maxLines: 3, rotate: -1.5 });
      var bandY = H - BAND;
      linkPanel(ctx, env, data, 'invite', K('cover.comeWithMe', L), pad, bandY - (tall ? 140 : 44), W - pad * 2 - 10);
      band(ctx, env, data);
      return done(env);
    });
  }

  // ---------------------------------------------------------------- templates: psa-mail, psa-id
  function daysUntil(ymd) {
    try { if (YSD.fmt && YSD.fmt.days) return YSD.fmt.days(ymd); } catch (e) {}
    return Math.ceil((Date.parse(ymd + 'T23:59:59-05:00') - now()) / 864e5);
  }
  function officialLine(ctx, env, wd, L, x, y, width) {
    var f = fit(ctx, K('common.officialInfo', L), width, { max: 32, min: 22, maxLines: 2, lh: 1.2, weight: 800, family: fam(env, 'body') });
    return draw(ctx, f, x, y, wd.fg, 'left');
  }
  function psaMail(ctx, data, env) {
    var L = langOf(data), wd = world('tangerine'), W = env.width, H = env.height, tall = H > 1500, pad = 64;
    return arts(['envelope']).then(function (im) {
      base(ctx, env, wd);
      var y = top(ctx, env, wd, data);
      y += tall ? 70 : 16;
      kicker(ctx, env, wd, K('psaMail.kicker', L), pad, y);
      y += tall ? 130 : 96;
      var n = daysUntil('2026-12-31');
      if (n > 0) {
        var nf = fit(ctx, K('psaMail.days', L, { n: n }), W - pad * 2 - 260, { max: tall ? 260 : 200, min: 110, maxLines: 1, lh: 0.88, family: fam(env, 'display'), stretch: 'condensed' });
        y += draw(ctx, nf, pad, y, C.night, 'left', C.cream) + 14;
        var lf = fit(ctx, K('psaMail.daysLabel', L), W - pad * 2 - 200, { max: 38, min: 28, maxLines: 2, lh: 1.2, weight: 700, family: fam(env, 'body') });
        y += draw(ctx, lf, pad, y, C.night, 'left') + (tall ? 60 : 30);
      } else {
        var hf = fit(ctx, K('psaMail.headline', L), W - pad * 2, { max: 130, min: 70, maxLines: 3, lh: 0.92, family: fam(env, 'display'), stretch: 'condensed' });
        y += draw(ctx, hf, pad, y, C.night, 'left') + 40;
      }
      dieCut(ctx, im[0], W - 170, 330 + (tall ? 70 : 0), tall ? 230 : 190, 10);
      var bandY = H - BAND, linkBottom = bandY - (tall ? 130 : 40);
      var linkH = linkPanel(ctx, env, data, 'psa-mail', data.name ? K('psaMail.fromName', L, { name: data.name }) : '', pad, linkBottom, W - pad * 2 - 10);
      // the required wording, on a flat cream panel
      var inner = W - pad * 2 - 64;
      var tf = fit(ctx, K('psaMail.text', L), inner, { max: tall ? 48 : 40, min: 28, maxLines: 6, lh: 1.25, weight: 700, family: fam(env, 'body') });
      var of = 46, ph = tf.height + of + 64, lowest = linkBottom - linkH - 40 - ph, py = Math.max(y, tall ? y + (lowest - y) * 0.45 : lowest);
      ctx.fillStyle = C.night; rr(ctx, pad + 9, py + 9, W - pad * 2 - 10, ph, 26); ctx.fill();
      ctx.fillStyle = C.cream; rr(ctx, pad, py, W - pad * 2 - 10, ph, 26); ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = C.night; ctx.stroke();
      setFont(ctx, tf.size, 700, fam(env, 'body'));
      var ty = py + 28 + draw(ctx, tf, pad + 32, py + 28, C.night, 'left');
      officialLine(ctx, env, { fg: C.violetDeep }, L, pad + 32, ty + 12, inner);
      mark(env, 'official', pad, py, W - pad * 2, ph);
      band(ctx, env, data);
      return done(env);
    });
  }
  function psaId(ctx, data, env) {
    var L = langOf(data), wd = world('lake'), W = env.width, H = env.height, tall = H > 1500, pad = 64;
    base(ctx, env, wd);
    var y = top(ctx, env, wd, data);
    y += tall ? 80 : 20;
    pill(ctx, env, K('psaId.kicker', L), pad, y, { size: 28, bg: C.cream, fg: C.night, edge: C.night, track: 2.4 });
    y += tall ? 130 : 100;
    var hf = fit(ctx, K('psaId.headline', L), W - pad * 2, { max: tall ? 170 : 140, min: 80, maxLines: 4, lh: 0.92, family: fam(env, 'display'), stretch: 'condensed' });
    y += draw(ctx, hf, pad, y, C.cream, 'left') + (tall ? 70 : 40);
    var bandY = H - BAND, linkBottom = bandY - (tall ? 130 : 40);
    var linkH = linkPanel(ctx, env, data, 'psa-id', data.name ? K('psaId.fromName', L, { name: data.name }) : '', pad, linkBottom, W - pad * 2 - 10);
    var room = linkBottom - linkH - 50 - y - 70;
    var tf = fit(ctx, K('psaId.text', L), W - pad * 2, { max: tall ? 48 : 40, min: 26, maxLines: 7, lh: 1.28, weight: 700, family: fam(env, 'body'), maxH: room });
    y += draw(ctx, tf, pad, y, C.cream, 'left') + 26;
    officialLine(ctx, env, { fg: C.celery }, L, pad, y, W - pad * 2);
    mark(env, 'official', pad, y, W - pad * 2, 40);
    band(ctx, env, data);
    return Promise.resolve(done(env));
  }

  // ---------------------------------------------------------------- template: join
  function join(ctx, data, env) {
    var L = langOf(data), wd = world(data.colorway || 'violet'), W = env.width, H = env.height, tall = H > 1500, pad = 64;
    var ids = [data.sticker || 'celery', 'gator', 'train'];
    return arts(ids).then(function (im) {
      base(ctx, env, wd);
      var y = top(ctx, env, wd, data);
      y += tall ? 90 : 24;
      kicker(ctx, env, wd, K('join.kicker', L), pad, y);
      y += tall ? 140 : 104;
      var head = data.name ? K('join.withName', L, { name: data.name }) : K('join.generic', L);
      var hf = fit(ctx, head, W - pad * 2, { max: tall ? 230 : 180, min: 90, maxLines: 4, lh: 0.88, family: fam(env, 'display'), stretch: 'condensed' });
      y += draw(ctx, hf, pad, y, wd.fg, 'left', wd.mark) + 34;
      var sf = fit(ctx, K('join.sub', L), W - pad * 2, { max: 50, min: 32, maxLines: 2, lh: 1.15, weight: 800, family: fam(env, 'body') });
      y += draw(ctx, sf, pad, y, wd.fg, 'left') + 20;
      if (tall) {
        var pf = fit(ctx, K('join.promise', L), W - pad * 2 - 40, { max: 36, min: 26, maxLines: 3, lh: 1.25, weight: 600, family: fam(env, 'body') });
        y += draw(ctx, pf, pad, y, wd.fg, 'left');
      }
      var bandY = H - BAND, linkBottom = bandY - (tall ? 140 : 44);
      var linkH = linkPanel(ctx, env, data, 'join', K('cover.comeWithMe', L), pad, linkBottom, W - pad * 2 - 10);
      var sy = linkBottom - linkH - (tall ? 200 : 120);
      dieCut(ctx, im[0], W - 210, sy, tall ? 260 : 190, -8);
      dieCut(ctx, im[1], W - 470, sy + (tall ? 50 : 30), tall ? 170 : 130, 9);
      if (tall) dieCut(ctx, im[2], W - 690, sy + 20, 140, -12);
      band(ctx, env, data);
      return done(env);
    });
  }

  // ---------------------------------------------------------------- template: cover ("Me, on the cover")
  function monthYear(L, iso) {
    try { return new Intl.DateTimeFormat(L === 'es' ? 'es-US' : 'en-US', { month: 'short', year: 'numeric', timeZone: 'America/New_York' }).format(iso ? new Date(iso) : new Date()).replace('.', '').toUpperCase(); } catch (e) { return ''; }
  }
  function cover(ctx, data, env) {
    var L = langOf(data), cw = byId(list('colorways'), data.colorway), wd = world(cw ? cw.id : 'violet');
    var W = env.width, H = env.height, tall = H > 1500, pad = 64;
    var issue = byId(issues(), data.issue), issueTxt = issue ? pick(issue.short, L) : '';
    var name = data.name || K('cover.you', L), city = data.city ? cityName(data.city, L) : '';
    var ids = [data.sticker || 'celery', 'gator', 'sun'];
    return arts(ids).then(function (im) {
      base(ctx, env, wd);
      // folio rule + masthead
      setFont(ctx, 26, 800, fam(env, 'body')); track(ctx, 4);
      ctx.fillStyle = wd.fg; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
      ctx.fillText(K('cover.folio', L) + ' · ' + monthYear(L), pad, 92);
      ctx.textAlign = 'right'; ctx.fillText(K('common.ages', L).toUpperCase(), W - pad, 92); track(ctx, 0);
      ctx.fillRect(pad, 112, W - pad * 2, 5);
      var mf = fit(ctx, 'Young Dems', W - pad * 2, { max: 330, min: 150, maxLines: 1, lh: 0.84, family: fam(env, 'display'), stretch: 'condensed' });
      ctx.fillStyle = wd.fg; ctx.textAlign = 'left';
      ctx.fillText('Young Dems', pad - 6, 128 + mf.size * 0.78);
      var y = 128 + mf.size * 0.84 + (tall ? 40 : 18);
      // DEMO flash (circle, tangerine) over the masthead's right edge
      if (env.demo) {
        var fr = tall ? 96 : 78, fx = W - pad - fr + 6, fy = 128 + mf.size * 0.84 + fr * 0.55;
        ctx.save(); ctx.translate(fx, fy); ctx.rotate(-14 * Math.PI / 180);
        ctx.fillStyle = C.night; ctx.beginPath(); ctx.arc(7, 7, fr, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = C.tangerine; ctx.beginPath(); ctx.arc(0, 0, fr, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = 4; ctx.strokeStyle = C.night; ctx.stroke();
        var fl = words(K('cover.flash', L));
        setFont(ctx, fr * 0.4, 800, fam(env, 'display'), 'condensed'); ctx.fillStyle = C.night; ctx.textAlign = 'center';
        ctx.fillText(fl[0] || 'DEMO', 0, -2); ctx.fillText(fl.slice(1).join(' '), 0, fr * 0.42);
        ctx.restore();
        mark(env, 'demoTag', fx - fr, fy - fr, fr * 2, fr * 2);
      }
      // the star: photo (halftone, framed) or a sticker composition
      var bandY = H - BAND, linkBottom = bandY - (tall ? 120 : 40);
      var nameMax = tall ? 250 : 190;
      var starH = tall ? 700 : 420, sx = pad, sw = W - pad * 2;
      if (data.photo) {
        var fw = tall ? sw - 60 : sw - 300, fh = starH, fx2 = tall ? pad + 30 : pad;
        ctx.save(); ctx.translate(fx2 + fw / 2, y + fh / 2); ctx.rotate(-2 * Math.PI / 180); ctx.translate(-fw / 2, -fh / 2);
        ctx.fillStyle = C.night; rr(ctx, 14, 14, fw, fh, 30); ctx.fill();
        ctx.save(); rr(ctx, 0, 0, fw, fh, 30); ctx.clip();
        halftone(ctx, data.photo, 0, 0, fw, fh, C.night, wd.dark ? C.cream : C.cream, tall ? 11 : 9);
        ctx.restore();
        rr(ctx, 0, 0, fw, fh, 30); ctx.lineWidth = 6; ctx.strokeStyle = C.night; ctx.stroke();
        ctx.restore();
        dieCut(ctx, im[0], W - (tall ? 150 : 200), y + fh - 40, tall ? 200 : 210, 12);
        if (!tall) dieCut(ctx, im[1], W - 190, y + 90, 150, -10);
      } else {
        dieCut(ctx, im[0], W / 2 + (tall ? 40 : 160), y + starH / 2, tall ? 520 : 340, -8);
        dieCut(ctx, im[1], pad + (tall ? 150 : 120), y + starH * 0.32, tall ? 210 : 150, 10);
        dieCut(ctx, im[2], pad + (tall ? 210 : 330), y + starH * 0.8, tall ? 170 : 120, -14);
      }
      y += starH + (tall ? 70 : 34);
      // name, huge; then the cover lines
      var nf = fit(ctx, name, W - pad * 2, { max: nameMax, min: 90, maxLines: 1, lh: 0.88, family: fam(env, 'display'), stretch: 'condensed' });
      y += draw(ctx, nf, pad, y, wd.fg, 'left', wd.mark) + 18;
      var lines = [];
      if (city) lines.push(K('cover.cityLine', L, { city: city }));
      if (issueTxt) lines.push(K('cover.hereFor', L, { issue: issueTxt }));
      if (!lines.length) lines.push(K('join.sub', L));
      var lf = fit(ctx, lines.join(' '), W - pad * 2, { max: tall ? 50 : 40, min: 28, maxLines: 2, lh: 1.18, weight: 800, family: fam(env, 'body') });
      y += draw(ctx, lf, pad, y, wd.fg, 'left');
      if (tall) {
        var teasers = [K('cover.teaser1', L), K('cover.teaser2', L), K('cover.teaser3', L)];
        setFont(ctx, 34, 700, fam(env, 'body'));
        var ty = y + 60;
        for (var i = 0; i < teasers.length && ty < linkBottom - 230; i++) {
          ctx.fillStyle = wd.dark ? C.celery : C.night; ctx.fillRect(pad, ty - 24, 36, 10);
          ctx.fillStyle = wd.fg; ctx.textAlign = 'left'; ctx.fillText(teasers[i], pad + 54, ty - 8);
          ty += 56;
        }
      }
      linkPanel(ctx, env, data, 'cover', K('cover.comeWithMe', L), pad, linkBottom, W - pad * 2 - 10);
      band(ctx, env, data);
      return done(env);
    });
  }

  // ---------------------------------------------------------------- template: membercard
  function membercard(ctx, data, env) {
    var L = langOf(data), cw = byId(list('colorways'), data.colorway), wd = world(cw ? cw.id : 'violet');
    var W = env.width, H = env.height, tall = H > 1500, pad = 64;
    var stk = (data.stickers || []).slice(0, 8), S = D().levels, book = (S && S.stickers) || [];
    var artIds = stk.map(function (id) { var b = byId(book, id); return b ? b.art : id; });
    return arts(artIds).then(function (im) {
      base(ctx, env, wd);
      top(ctx, env, wd, data);
      var cwid = W - pad * 2, ch = tall ? 1080 : 820, cx = pad, cy = tall ? 300 : 190;
      ctx.save(); ctx.translate(cx + cwid / 2, cy + ch / 2); ctx.rotate(-1.5 * Math.PI / 180); ctx.translate(-cwid / 2, -ch / 2);
      ctx.fillStyle = C.night; rr(ctx, 14, 14, cwid, ch, 40); ctx.fill();
      ctx.fillStyle = C.cream; rr(ctx, 0, 0, cwid, ch, 40); ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = C.night; ctx.stroke();
      ctx.fillStyle = wd.bg; rr(ctx, 0, 0, cwid, 150, [40, 40, 0, 0]); ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, 150); ctx.lineTo(cwid, 150); ctx.stroke();
      brand(ctx, env, wd, 40, 40, 1.15);
      setFont(ctx, 26, 800, fam(env, 'body')); track(ctx, 3); ctx.fillStyle = wd.fg; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(K('membercard.kicker', L), cwid - 40, 86); track(ctx, 0);
      var name = data.name || K('membercard.friend', L);
      var nf = fit(ctx, name, cwid - 80, { max: tall ? 200 : 160, min: 70, maxLines: 2, lh: 0.9, family: fam(env, 'display'), stretch: 'condensed' });
      var yy = 200 + draw(ctx, nf, 40, 200, C.night, 'left', wd.dark ? C.celery : wd.bg) + 20;
      var meta = [data.city ? cityName(data.city, L) : '', K('membercard.since', L, { month: monthYear(L, data.since) })].filter(Boolean).join(' · ');
      setFont(ctx, 34, 700, fam(env, 'body')); ctx.fillStyle = '#574D70'; ctx.textAlign = 'left';
      ctx.fillText(meta, 40, yy + 30); yy += 80;
      setFont(ctx, 26, 800, fam(env, 'body')); track(ctx, 2.4); ctx.fillStyle = C.night;
      ctx.fillText(K('membercard.stickers', L, { n: (data.stickers || []).length }).toUpperCase(), 40, yy + 20); track(ctx, 0);
      var sz = tall ? 170 : 128, per = Math.floor((cwid - 40) / (sz + 22)), sy = yy + 50 + sz / 2;
      for (var i = 0; i < stk.length && i < per * (tall ? 2 : 1); i++) {
        var col = i % per, row = Math.floor(i / per);
        dieCut(ctx, im[i], 40 + sz / 2 + col * (sz + 22), sy + row * (sz + 36), sz * 0.86, (i % 2 ? 7 : -6));
      }
      if (!stk.length) {
        ctx.setLineDash([10, 10]); ctx.lineWidth = 4; ctx.strokeStyle = '#574D70';
        for (var j = 0; j < Math.min(per, 4); j++) { ctx.beginPath(); ctx.arc(40 + sz / 2 + j * (sz + 22), sy, sz * 0.42, 0, Math.PI * 2); ctx.stroke(); }
        ctx.setLineDash([]);
      }
      if (env.demo) {
        setFont(ctx, 28, 800, fam(env, 'body')); track(ctx, 2); ctx.fillStyle = C.night; ctx.textAlign = 'center';
        var wm = K('membercard.watermark', L).toUpperCase(), wmw = textW(ctx, wm) + 48;
        ctx.fillStyle = C.tangerine; rr(ctx, cwid / 2 - wmw / 2, ch - 86, wmw, 54, 27); ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = C.night; ctx.stroke();
        ctx.fillStyle = C.night; ctx.fillText(wm, cwid / 2, ch - 49); track(ctx, 0);
      }
      ctx.restore();
      var bandY = H - BAND;
      linkPanel(ctx, env, data, 'membercard', K('cover.comeWithMe', L), pad, bandY - (tall ? 130 : 40), W - pad * 2 - 10);
      band(ctx, env, data);
      return done(env);
    });
  }

  // ---------------------------------------------------------------- template: rewind (Seminole Rewind)
  function rewind(ctx, data, env) {
    var L = langOf(data), W = env.width, H = env.height, tall = H > 1500, pad = 64;
    var slide = data.slide || (tall ? 1 : 'summary'), c = data.counts || {};
    var map = { 1: 'violet', 2: 'bubblegum', 3: 'celery', summary: 'night' };
    var wd = world(map[slide] || 'violet');
    var stk = (data.stickers || []).slice(0, 9), S = D().levels, book = (S && S.stickers) || [];
    var artIds = slide === 3 ? stk.map(function (id) { var b = byId(book, id); return b ? b.art : id; }) : [];
    return arts(artIds).then(function (im) {
      base(ctx, env, wd);
      var y = top(ctx, env, wd, data);
      y += tall ? 70 : 20;
      kicker(ctx, env, wd, K('rewind.kicker', L), pad, y);
      y += tall ? 120 : 96;
      var tf = fit(ctx, K('rewind.title', L), W - pad * 2, { max: 70, min: 44, maxLines: 2, lh: 1, family: fam(env, 'display'), stretch: 'semi-condensed' });
      y += draw(ctx, tf, pad, y, wd.fg, 'left') + (tall ? 80 : 40);
      function big(n, label, yy, max) {
        var nf = fit(ctx, String(n || 0), W - pad * 2, { max: max, min: 120, maxLines: 1, lh: 0.86, family: fam(env, 'display'), stretch: 'condensed' });
        yy += draw(ctx, nf, pad, yy, wd.fg, 'left', wd.mark) + 10;
        var lf = fit(ctx, label, W - pad * 2, { max: 48, min: 30, maxLines: 2, lh: 1.15, weight: 800, family: fam(env, 'body') });
        return yy + draw(ctx, lf, pad, yy, wd.fg, 'left');
      }
      if (slide === 1) { y = big(c.rsvps, K('rewind.rsvps', L), y, 560) + 60; y = bigLine(K('rewind.slide1', L)); }
      else if (slide === 2) { y = big(c.friends, K('rewind.friends', L), y, 340) + 50; y = big(c.cards, K('rewind.cards', L), y, 240) + 40; y = bigLine(K('rewind.slide2', L)); }
      else if (slide === 3) {
        y = big(c.stickers, K('rewind.stickers', L), y, 300) + 40;
        var sz = 210, per = 4;
        for (var i = 0; i < stk.length; i++) dieCut(ctx, im[i], pad + sz / 2 + (i % per) * (sz + 20), y + sz / 2 + Math.floor(i / per) * (sz + 20), sz * 0.85, i % 2 ? 8 : -7);
        y += Math.ceil(stk.length / per) * (sz + 20) + 20;
        y = bigLine(K('rewind.slide3', L), y);
      } else {
        var cells = [[c.rsvps, K('rewind.rsvps', L)], [c.friends, K('rewind.friends', L)], [c.cards, K('rewind.cards', L)], [c.stickers, K('rewind.stickers', L)]];
        var cwd = (W - pad * 2 - 30) / 2, chh = tall ? 360 : 240;
        for (var k = 0; k < 4; k++) {
          var gx = pad + (k % 2) * (cwd + 30), gy = y + Math.floor(k / 2) * (chh + 30);
          ctx.fillStyle = [C.violet, C.bubblegum, C.celery, C.sky][k]; rr(ctx, gx, gy, cwd, chh, 28); ctx.fill();
          ctx.lineWidth = 4; ctx.strokeStyle = C.cream; ctx.stroke();
          var fg = k === 0 ? C.cream : C.night;
          var lf2 = fit(ctx, cells[k][1], cwd - 60, { max: 32, min: 22, maxLines: 3, lh: 1.15, weight: 800, family: fam(env, 'body') });
          draw(ctx, lf2, gx + 30, gy + chh - 30 - lf2.height, fg, 'left');
          var nf2 = fit(ctx, String(cells[k][0] || 0), cwd - 60, { max: 170, min: 60, maxLines: 1, lh: 0.9, maxH: chh - lf2.height - 76, family: fam(env, 'display'), stretch: 'condensed' });
          draw(ctx, nf2, gx + 30, gy + 26, fg, 'left');
        }
        y += chh * 2 + (tall ? 60 : 30);
        if (tall) y = bigLine(K('rewind.summary', L), y);
      }
      function bigLine(t, yy) {
        yy = yy || y;
        var f = fit(ctx, t, W - pad * 2, { max: 80, min: 44, maxLines: 2, lh: 1, family: fam(env, 'display'), stretch: 'semi-condensed' });
        return yy + draw(ctx, f, pad, yy, wd.fg, 'left');
      }
      var bandY = H - BAND, linkBottom = bandY - (tall ? 120 : 40);
      var linkH = linkPanel(ctx, env, data, 'rewind', K('cover.comeWithMe', L), pad, linkBottom, W - pad * 2 - 10);
      var nf3 = fit(ctx, K('rewind.local', L), W - pad * 2, { max: 26, min: 20, maxLines: 2, lh: 1.2, weight: 600, family: fam(env, 'body') });
      draw(ctx, nf3, pad, linkBottom - linkH - 30 - nf3.height, wd.fg, 'left');
      band(ctx, env, data);
      return done(env);
    });
  }

  // ---------------------------------------------------------------- registry and public API
  var DRAW = {
    invite: invite, 'psa-mail': psaMail, 'psa-id': psaId, join: join, cover: cover,
    'quiz-show-up': quizShowUp, 'quiz-issue': quizIssue, membercard: membercard, rewind: rewind
  };
  var FONTS = ['800 64px "Bricolage Grotesque"', '700 32px "Atkinson Hyperlegible Next"', '800 32px "Atkinson Hyperlegible Next"'];
  Object.keys(DRAW).forEach(function (n) { YSD.cards.register(n, DRAW[n], { size: 'story', fonts: FONTS }); });

  function path(name, data) {
    data = data || {};
    var es = langOf(data) === 'es' ? 'es/' : '';
    var Q = quiz();
    if (name === 'invite') { var ev = data.event || eventById(data.eventId); return ev ? es + 'events/' + ev.id + '.html' : es + 'events.html'; }
    if (name === 'psa-mail') return es + 'vote.html#renew-mail-ballot';
    if (name === 'psa-id') return es + 'vote.html#what-id';
    if (name === 'quiz-show-up') { var r = resultOf(data.resultId); return es + (r ? 'quiz/show-up/' + r.slug + '.html' : 'quiz.html#show-up'); }
    if (name === 'quiz-issue') { var res = Q.issueFinder && Q.issueFinder.results && Q.issueFinder.results[data.resultId]; return es + (res ? 'quiz/issue/' + res.slug + '.html' : 'quiz.html#issue'); }
    if (name === 'rewind') return es + 'index.html';
    return es + 'join.html';
  }
  function available(name, t) {
    t = t == null ? now() : +t;
    if (name === 'rewind') return previewRewind() || t >= Date.parse(REWIND_FROM);
    if (name === 'psa-mail') return t < Date.parse(PSA_MAIL_UNTIL);
    return !!DRAW[name];
  }
  YSD.brandCards = {
    version: 1,
    templates: Object.keys(DRAW),
    sizes: SIZES,
    rewindFrom: REWIND_FROM,
    render: function (name, data, opts) {
      opts = opts || {};
      var sz = SIZES[opts.size] || SIZES.portrait;
      return YSD.cards.render(name, data || {}, { width: sz.width, height: sz.height, el: opts.el, fontTimeout: opts.fontTimeout });
    },
    available: available,
    path: path,
    colorways: function () { return list('colorways'); },
    cities: function () { return list('cities'); },
    stickers: function () { var s = kit().makerStickers; return Array.isArray(s) ? s : ['celery', 'gator', 'train', 'chicken', 'cypress', 'sun', 'heart', 'camera']; },
    issues: issues,
    event: eventById,
    copy: K,
    marks: function (canvas) { return (canvas && canvas.__ysdMarks) || null; },
    world: world
  };
})(typeof window !== 'undefined' ? window : this);
