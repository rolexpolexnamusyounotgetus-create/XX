/*!
 * assets/js/cards-og.js: type-only link-preview cards (1200 x 630) for YSD.cards.   Owner: W8
 *
 * Templates (registered with YSD.cards.register, size 'wide'):
 *   og-page   { kicker, title, accent?, sub?, color?, sticker?, lang? }
 *   og-event  { kicker?, title, start? (ISO, New York time) | month, day, weekday, time, place?, meta?,
 *               cta?, color?, sticker?, lang?, demoEvent? (default true in demo) }
 *   og-quiz   { kicker, title, sub?, cta?, color?, lang?, character? ('show-up/hype-captain'),
 *               characters? ([up to 3 paths]) }  art from assets/img/characters/characters.js (make_og loads it);
 *               the subline gets two lines and its height reserved, so it is never cut mid-sentence
 * Shared fields: color = a brand colour world (violet, violet-deep, night, lake, celery, bubblegum,
 *   pink/hotpink, sky, tangerine, orange, teal, lime/mint, sun); 'lake' is the serious template
 *   (no stickers, no tilt). accent = words of the title drawn in the pop colour (or on a marker).
 *   footer = paid-for line (default: config legal.cardFooter, without its trailing "· DEMO").
 *
 * Rules it follows (docs/BRIEF.md 3.2, 3.6, 5.8): brand colours are constants, so a card looks the
 * same whatever theme made it; text always sits on a flat fill; no photos or faces; every card
 * carries the Saved Seat lockup (YSD.cards.brand, round 1), the paid-for line, and a DEMO tag while YSD_CONFIG.demo is on. Nothing here fetches
 * anything: stickers come from data/stickers.js (inline SVG) when it is loaded, else they are drawn.
 * tools/make_og.js renders these into assets/img/og/ (+ og/es/) from each page's ysd:og meta.
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
  // Colour worlds: bg, text, pop (accent text), mark (marker swipe on bright fills), pill + its text.
  function world(name) {
    var dark = { fg: C.cream, pop: C.celery, mark: null, pill: C.celery, pillFg: C.night, band: C.night, bandFg: C.cream, edge: C.night };
    var bright = { fg: C.night, pop: C.night, mark: C.cream, pill: C.night, pillFg: C.cream, band: C.night, bandFg: C.cream, edge: C.night };
    var map = {
      violet: [dark, C.violet], 'violet-deep': [dark, C.violetDeep], night: [dark, C.night], lake: [dark, C.lake],
      celery: [bright, C.celery], bubblegum: [bright, C.bubblegum], pink: [bright, C.hotpink], hotpink: [bright, C.hotpink],
      sky: [bright, C.sky], tangerine: [bright, C.tangerine], orange: [bright, C.orange], teal: [bright, C.teal],
      lime: [bright, C.mint], mint: [bright, C.mint], sun: [bright, C.sun]
    };
    var m = map[String(name || 'violet')] || map.violet;
    var o = {};
    for (var k in m[0]) o[k] = m[0][k];
    o.bg = m[1];
    o.name = map[name] ? name : 'violet';
    o.dark = m[0] === dark;
    if (o.name === 'night') { o.band = C.violet; }
    if (o.name === 'lake') { o.pop = C.cream; o.pill = C.cream; o.pillFg = C.night; o.serious = true; }
    if (o.name === 'celery') o.mark = C.bubblegum;
    if (o.name === 'bubblegum' || o.name === 'pink' || o.name === 'hotpink') o.mark = C.cream;
    if (o.name === 'sun' || o.name === 'lime' || o.name === 'mint') o.mark = C.bubblegum;
    return o;
  }

  var COPY = {
    en: { ages: 'Ages 14 to 39', county: 'of Seminole County', demoEvent: 'DEMO event', imIn: "I'm in", whatsYours: "What's yours?",
      invited: "YOU'RE INVITED", free: 'Free', footer: 'Paid for by [committee name and address placeholder]' },
    es: { ages: 'De 14 a 39 a\u00f1os', county: 'of Seminole County', demoEvent: 'Evento DEMO', imIn: 'Me apunto', whatsYours: '\u00bfY el tuyo?',
      invited: 'TE INVITAMOS', free: 'Gratis', footer: 'Pagado por [nombre y direcci\u00f3n del comit\u00e9]' }
  };
  function copy(data) { return COPY[data && data.lang === 'es' ? 'es' : 'en']; }
  function cfg(p, fb) { return typeof YSD.cfg === 'function' ? YSD.cfg(p, fb) : fb; }

  // ---------------------------------------------------------------- type helpers
  function fam(env, which) {
    var t = env.theme || {};
    var f = which === 'display' ? t.fontDisplay : t.fontBody;
    if (!f || /system-ui, -apple-system/.test(f) && !/Bricolage|Atkinson/.test(f)) {
      f = which === 'display' ? '"Bricolage Grotesque", "Bricolage fb", "Arial Narrow", sans-serif' : '"Atkinson Hyperlegible Next", "Atkinson fb", system-ui, sans-serif';
    }
    return f;
  }
  function setFont(ctx, size, weight, family, stretch) {
    ctx.font = (stretch ? stretch + ' ' : '') + weight + ' ' + Math.round(size) + 'px ' + family;
    try { ctx.fontStretch = stretch || 'normal'; } catch (e) { /* older canvas */ }
  }
  function spacing(ctx, px) { try { ctx.letterSpacing = px ? px + 'px' : '0px'; } catch (e) { /* unsupported */ } }
  function wordsOf(t) { return String(t == null ? '' : t).trim().split(/\s+/).filter(function (x) { return x; }); }
  function wrap(ctx, text, maxW) {
    var ws = wordsOf(text), lines = [], line = '';
    for (var i = 0; i < ws.length; i++) {
      var test = line ? line + ' ' + ws[i] : ws[i];
      if (line && ctx.measureText(test).width > maxW) { lines.push(line); line = ws[i]; } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }
  /** Largest size (step 2) where text fits maxLines in maxW and maxH. Sets ctx.font. */
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
      if (all.length > cut.length) {
        var last = cut[cut.length - 1];
        while (last && ctx.measureText(last + '\u2026').width > maxW) last = last.replace(/\s*\S+$/, '');
        cut[cut.length - 1] = last + '\u2026';
      }
      best = { size: o.min, lines: cut, lh: o.min * lh };
    }
    setFont(ctx, best.size, o.weight || 800, o.family, o.stretch);
    return best;
  }
  /** Draw wrapped lines; words inside `accent` get the pop colour or a marker swipe. */
  function drawLines(ctx, fitted, x, y, wd, colors, accent) {
    var acc = wordsOf(accent).map(function (s) { return s.toLowerCase(); });
    var all = [], k;
    for (k = 0; k < fitted.lines.length; k++) all = all.concat(wordsOf(fitted.lines[k]).map(function (s) { return { w: s, line: k }; }));
    // mark the first run of words matching the accent phrase
    if (acc.length) {
      for (var s = 0; s + acc.length <= all.length; s++) {
        var hit = true;
        for (var j = 0; j < acc.length; j++) if (all[s + j].w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '') !== acc[j].replace(/[^\p{L}\p{N}']/gu, '')) { hit = false; break; }
        if (hit) { for (j = 0; j < acc.length; j++) all[s + j].acc = true; break; }
      }
    }
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    var space = ctx.measureText(' ').width, size = fitted.size;
    for (k = 0; k < fitted.lines.length; k++) {
      var lx = x, base = y + fitted.lh * k + size * 0.8;
      var row = all.filter(function (a) { return a.line === k; });
      for (var i = 0; i < row.length; i++) {
        var ww = ctx.measureText(row[i].w).width;
        if (row[i].acc && colors.mark) {
          ctx.fillStyle = colors.mark;
          var ext = i < row.length - 1 && row[i + 1].acc ? space : 0;
          ctx.fillRect(lx - size * 0.04, base - size * 0.3, ww + ext + size * 0.08, size * 0.36);
        }
        ctx.fillStyle = row[i].acc && !colors.mark ? colors.pop : colors.fg;
        ctx.fillText(row[i].w, lx, base);
        lx += ww + space;
      }
    }
    return fitted.lines.length * fitted.lh;
  }
  function rr(ctx, x, y, wd, ht, r) {
    var h = YSD.cards.h;
    if (h && h.roundRect) { h.roundRect(ctx, x, y, wd, ht, r); return; }
    ctx.beginPath(); ctx.rect(x, y, wd, ht);
  }
  /** Sticker-style pill: fill, 3 px edge, hard offset shadow. Returns its width. */
  function pill(ctx, env, text, x, y, o) {
    o = o || {};
    var size = o.size || 22;
    setFont(ctx, size, 800, fam(env, 'body'));
    spacing(ctx, o.track == null ? size * 0.08 : o.track);
    var tw = ctx.measureText(text).width, padX = o.padX || size * 0.75, ht = o.height || size * 2.05, wd = tw + padX * 2;
    ctx.save();
    ctx.translate(x, y);
    if (o.rotate) ctx.rotate(o.rotate * Math.PI / 180);
    if (o.shadow) { ctx.fillStyle = o.shadow; rr(ctx, o.shadowX || 5, o.shadowY || 5, wd, ht, ht / 2); ctx.fill(); }
    ctx.fillStyle = o.bg; rr(ctx, 0, 0, wd, ht, o.radius == null ? ht / 2 : o.radius); ctx.fill();
    if (o.edge) { ctx.lineWidth = o.edgeWidth || 3; ctx.strokeStyle = o.edge; ctx.stroke(); }
    ctx.fillStyle = o.fg;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(text, padX, ht / 2 + size * 0.04);
    ctx.restore();
    spacing(ctx, 0);
    return wd;
  }

  // ---------------------------------------------------------------- brand mark and band
  /** The brand lockup (genz-brand-20): the Saved Seat ticket and the lettered "Young Dems" wordmark from
   *  YSD.cards.brand (assets/js/cards.js, the same paths as the header, icons and default OG), with "of Seminole
   *  County" under the wordmark. (x, y) is the top-left of the old 64 x 54 slot: the ticket spans about y - 11 to
   *  y + 49, the wordmark's baseline sits at y + 26 and the county line at y + 50. Colours as in cards-brand.js:
   *  a celery ticket (cream on celery) with a night outline (cream on night); swoosh bubblegum on dark worlds,
   *  violet on bright ones. */
  function brand(ctx, env, wd, x, y, scale) {
    var s = scale || 1, B = YSD.cards.brand, bg = String(wd.bg).toLowerCase();
    var tx = x + 80 * s;
    if (B && typeof B.mark === 'function' && typeof w.Path2D === 'function') {
      B.mark(ctx, x - 3 * s, y - 14 * s, 76 * s, { body: bg === C.celery.toLowerCase() ? C.cream : C.celery, ink: C.night, edge: bg === C.night.toLowerCase() ? C.cream : C.night });
      B.word(ctx, x + 78 * s, y - 2 * s, 36 * s, { fill: wd.fg, swoosh: wd.dark ? C.bubblegum : C.violet });
    } else {
      setFont(ctx, 34 * s / 1.05, 800, fam(env, 'display'));
      ctx.fillStyle = wd.fg; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.fillText('Young Dems', tx, y + 26 * s);
    }
    setFont(ctx, 17 * s / 1.05, 700, fam(env, 'body'));
    ctx.fillStyle = wd.fg;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(copy(env.data).county, tx, y + 50 * s);
  }
  function band(ctx, env, wd, data, label) {
    var W = env.width, H = env.height, bh = 66, y = H - bh;
    ctx.fillStyle = wd.band;
    ctx.fillRect(0, y, W, bh);
    var c = copy(data);
    var footer = data.footer != null ? String(data.footer) : (data.lang === 'es' ? c.footer : String(cfg('legal.cardFooter', '') || c.footer));
    footer = footer.replace(/\s*[\u00b7|-]\s*DEMO\s*$/i, '');
    var right = W - 56;
    if (env.demo) {
      setFont(ctx, 20, 800, fam(env, 'body'));
      spacing(ctx, 1.6);
      var lw = ctx.measureText(label || 'DEMO').width + 34;
      spacing(ctx, 0);
      right = W - 56 - lw;
      pill(ctx, env, label || 'DEMO', W - 56 - lw, y + 13, { size: 20, bg: C.tangerine, fg: C.night, height: 40, padX: 17, track: 1.6 });
      right -= 24;
    }
    setFont(ctx, 19, 600, fam(env, 'body'));
    ctx.fillStyle = wd.bandFg;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    var t = footer;
    while (t && ctx.measureText(t).width > right - 56) t = t.slice(0, -2) + '\u2026';
    ctx.fillText(t, 56, y + bh / 2 + 1);
    return y;
  }

  // ---------------------------------------------------------------- stickers (die-cut)
  function canvasOf(wd, ht) { var c = w.document.createElement('canvas'); c.width = Math.ceil(wd); c.height = Math.ceil(ht); return c; }
  function silhouette(src, color) {
    var s = canvasOf(src.width, src.height), x = s.getContext('2d');
    x.drawImage(src, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = color;
    x.fillRect(0, 0, s.width, s.height);
    return s;
  }
  /** Draw art (fn(ctx, size) or an Image) with a white die-cut edge and a hard shadow. */
  function dieCut(ctx, art, cx, cy, size, rot, shadow) {
    var edge = Math.round(size * 0.06), pad = edge + 14;
    var c = canvasOf(size + pad * 2, size + pad * 2), x = c.getContext('2d');
    x.translate(pad, pad);
    if (typeof art === 'function') art(x, size);
    else x.drawImage(art, 0, 0, size, size);
    var white = silhouette(c, C.white);
    var o = canvasOf(c.width, c.height), ox = o.getContext('2d');
    for (var a = 0; a < 28; a++) { var ang = a / 28 * Math.PI * 2; ox.drawImage(white, Math.cos(ang) * edge, Math.sin(ang) * edge); }
    ox.drawImage(c, 0, 0);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((rot || 0) * Math.PI / 180);
    if (shadow) ctx.drawImage(silhouette(o, shadow), -o.width / 2 + 7, -o.height / 2 + 7);
    ctx.drawImage(o, -o.width / 2, -o.height / 2);
    ctx.restore();
  }
  function check(x, ax, ay, s, color, lw) {
    x.beginPath(); x.moveTo(ax, ay); x.lineTo(ax + s * 0.35, ay + s * 0.35); x.lineTo(ax + s, ay - s * 0.45);
    x.lineWidth = lw; x.lineCap = 'round'; x.lineJoin = 'round'; x.strokeStyle = color; x.stroke();
  }
  var ART = {
    calendar: function (x, s) {
      x.fillStyle = C.cream; rr(x, s * 0.08, s * 0.12, s * 0.84, s * 0.8, s * 0.1); x.fill();
      x.lineWidth = s * 0.03; x.strokeStyle = C.night; x.stroke();
      x.fillStyle = C.hotpink; rr(x, s * 0.08, s * 0.12, s * 0.84, s * 0.22, [s * 0.1, s * 0.1, 0, 0]); x.fill(); x.stroke();
      x.fillStyle = C.night; rr(x, s * 0.27, s * 0.04, s * 0.07, s * 0.17, s * 0.035); x.fill(); rr(x, s * 0.66, s * 0.04, s * 0.07, s * 0.17, s * 0.035); x.fill();
      check(x, s * 0.28, s * 0.62, s * 0.42, C.violet, s * 0.09);
    },
    envelope: function (x, s) {
      x.fillStyle = C.sky; rr(x, s * 0.06, s * 0.22, s * 0.88, s * 0.6, s * 0.06); x.fill();
      x.lineWidth = s * 0.03; x.strokeStyle = C.night; x.stroke();
      x.beginPath(); x.moveTo(s * 0.08, s * 0.25); x.lineTo(s * 0.5, s * 0.56); x.lineTo(s * 0.92, s * 0.25); x.stroke();
      x.fillStyle = C.celery; x.beginPath(); x.arc(s * 0.76, s * 0.76, s * 0.17, 0, Math.PI * 2); x.fill(); x.stroke();
      check(x, s * 0.68, s * 0.77, s * 0.16, C.night, s * 0.045);
    },
    heart: function (x, s) {
      x.fillStyle = C.bubblegum; rr(x, s * 0.06, s * 0.1, s * 0.88, s * 0.66, s * 0.16); x.fill();
      x.beginPath(); x.moveTo(s * 0.28, s * 0.72); x.lineTo(s * 0.22, s * 0.94); x.lineTo(s * 0.46, s * 0.74); x.fill();
      x.lineWidth = s * 0.03; x.strokeStyle = C.night; rr(x, s * 0.06, s * 0.1, s * 0.88, s * 0.66, s * 0.16); x.stroke();
      x.fillStyle = C.night; x.beginPath();
      var cx = s * 0.5, cy = s * 0.36, r = s * 0.11;
      x.moveTo(cx, cy + r * 2.1); x.bezierCurveTo(cx - r * 3.2, cy + r * 0.2, cx - r * 1.4, cy - r * 2.2, cx, cy - r * 0.4);
      x.bezierCurveTo(cx + r * 1.4, cy - r * 2.2, cx + r * 3.2, cy + r * 0.2, cx, cy + r * 2.1); x.fill();
    },
    sun: function (x, s) {
      x.fillStyle = C.sun; x.strokeStyle = C.night; x.lineWidth = s * 0.03;
      for (var i = 0; i < 12; i++) {
        var a = i / 12 * Math.PI * 2;
        x.beginPath();
        x.moveTo(s / 2 + Math.cos(a - 0.14) * s * 0.3, s / 2 + Math.sin(a - 0.14) * s * 0.3);
        x.lineTo(s / 2 + Math.cos(a) * s * 0.47, s / 2 + Math.sin(a) * s * 0.47);
        x.lineTo(s / 2 + Math.cos(a + 0.14) * s * 0.3, s / 2 + Math.sin(a + 0.14) * s * 0.3);
        x.closePath(); x.fill(); x.stroke();
      }
      x.beginPath(); x.arc(s / 2, s / 2, s * 0.3, 0, Math.PI * 2); x.fill(); x.stroke();
      x.fillStyle = C.night; rr(x, s * 0.27, s * 0.42, s * 0.2, s * 0.12, s * 0.05); x.fill(); rr(x, s * 0.53, s * 0.42, s * 0.2, s * 0.12, s * 0.05); x.fill();
      x.fillRect(s * 0.45, s * 0.44, s * 0.1, s * 0.03);
      x.beginPath(); x.arc(s / 2, s * 0.6, s * 0.09, 0.15 * Math.PI, 0.85 * Math.PI); x.lineWidth = s * 0.03; x.stroke();
    }
  };
  /** Sticker art: data/stickers.js SVG when loaded, else the drawn fallback. Resolves to art or null. */
  function stickerArt(id) {
    if (!id) return Promise.resolve(null);
    var items = w.YSD_DATA && w.YSD_DATA.stickers && w.YSD_DATA.stickers.items;
    var it = null;
    if (items && items.length) for (var i = 0; i < items.length; i++) if (items[i].id === id) it = items[i];
    if (it && it.svg && YSD.cards.h && YSD.cards.h.loadImage) {
      var svg = String(it.svg);
      if (!/xmlns=/.test(svg)) svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
      return YSD.cards.h.loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)).then(null, function () { return ART[id] || null; });
    }
    return Promise.resolve(ART[id] || null);
  }

  // ---------------------------------------------------------------- templates
  function bg(ctx, env, wd) { ctx.fillStyle = wd.bg; ctx.fillRect(0, 0, env.width, env.height); }

  function ogPage(ctx, data, env) {
    env.data = data;
    var wd = world(data.color), W = env.width, pad = 60;
    bg(ctx, env, wd);
    var sticker = wd.serious ? null : (data.sticker === undefined ? 'calendar' : data.sticker);
    return stickerArt(sticker).then(function (art) {
      var bandY = band(ctx, env, wd, data, 'DEMO');
      brand(ctx, env, wd, pad, 46, 1);
      var titleW = W - pad * 2 - (art ? 250 : 0);
      if (art) dieCut(ctx, art, W - pad - 112, 168, 190, 8, C.night);
      var y = 146;
      if (data.kicker) {
        pill(ctx, env, String(data.kicker).toUpperCase(), pad, y, { size: 22, bg: wd.pill, fg: wd.pillFg, edge: wd.dark ? null : null, rotate: wd.serious ? 0 : -1.5, shadow: wd.serious ? null : (wd.dark ? C.night : null) });
        y += 72;
      }
      var subH = data.sub ? 56 : 0;
      var maxH = bandY - 36 - y - subH;
      var f = fit(ctx, String(data.title || ''), titleW, { max: 132, min: 52, maxLines: 3, lh: 0.92, maxH: maxH, family: fam(env, 'display'), stretch: 'condensed' });
      var used = drawLines(ctx, f, pad, y, titleW, wd, data.accent);
      if (data.sub) {
        setFont(ctx, 28, 500, fam(env, 'body'));
        ctx.fillStyle = wd.fg;
        ctx.textBaseline = 'alphabetic';
        var sub = wrap(ctx, String(data.sub), W - pad * 2)[0] || '';
        ctx.fillText(sub, pad, Math.min(bandY - 34, y + used + 44));
      }
    });
  }

  var MONTHS = { en: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'], es: ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'] };
  var DAYS = { en: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], es: ['DOM', 'LUN', 'MAR', 'MI\u00c9', 'JUE', 'VIE', 'S\u00c1B'] };
  /** Month, day, weekday and time in New York time for an ISO start ("7 PM" / "7 P. M."). */
  function when(iso, lang) {
    var d = new Date(iso);
    if (isNaN(d)) return null;
    var parts = {};
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
        .formatToParts(d).forEach(function (p) { parts[p.type] = p.value; });
    } catch (e) { return null; }
    var L = lang === 'es' ? 'es' : 'en';
    var wk = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
    var hm = parts.hour + (parts.minute && parts.minute !== '00' ? ':' + parts.minute : '');
    var ap = String(parts.dayPeriod || '').toLowerCase();
    var time = L === 'es' ? hm + ' ' + (ap === 'pm' ? 'p. m.' : 'a. m.') : hm + ' ' + ap;
    var wd = DAYS[L][wk] || '';
    wd = L === 'es' ? wd.toLowerCase() : wd.charAt(0) + wd.slice(1).toLowerCase();
    return { month: MONTHS[L][+parts.month - 1], day: String(+parts.day), weekday: wd, time: time };
  }

  function ogEvent(ctx, data, env) {
    env.data = data;
    var c = copy(data), wd = world(data.color || 'sky'), W = env.width, pad = 60;
    bg(ctx, env, wd);
    var wn = data.start ? when(data.start, data.lang) : null;
    var month = String(data.month || (wn && wn.month) || '').toUpperCase();
    var day = String(data.day || (wn && wn.day) || '');
    // Times stay "7 pm" / "7 p. m." (BRIEF 2.4); only the month reads as an all-caps tag.
    var wkTime = [data.weekday || (wn && wn.weekday), data.time || (wn && wn.time)].filter(function (x) { return x; }).join(' \u00b7 ');
    var demoEvent = env.demo && data.demoEvent !== false;
    return stickerArt(wd.serious ? null : data.sticker).then(function (art) {
      var bandY = band(ctx, env, wd, data, demoEvent ? c.demoEvent.toUpperCase() : 'DEMO');
      brand(ctx, env, wd, pad, 46, 1);
      var colW = 640, y = 146;
      pill(ctx, env, String(data.kicker || c.invited).toUpperCase(), pad, y, { size: 22, bg: wd.pill, fg: wd.pillFg, rotate: wd.serious ? 0 : -1.5, shadow: wd.dark && !wd.serious ? C.night : null });
      y += 74;
      var meta = data.meta || [data.place, data.free === false ? '' : c.free].filter(function (x) { return x; }).join(' \u00b7 ');
      var maxH = bandY - 40 - y - (meta ? 54 : 0);
      var f = fit(ctx, String(data.title || ''), colW, { max: 118, min: 50, maxLines: 3, lh: 0.92, maxH: maxH, family: fam(env, 'display'), stretch: 'condensed' });
      var used = drawLines(ctx, f, pad, y, colW, wd, data.accent);
      if (meta) {
        setFont(ctx, 30, 700, fam(env, 'body'));
        ctx.fillStyle = wd.fg;
        ctx.textBaseline = 'alphabetic';
        var m = meta;
        while (m && ctx.measureText(m).width > colW) m = m.slice(0, -2) + '\u2026';
        ctx.fillText(m, pad, Math.min(bandY - 36, y + used + 46));
      }
      // ticket stub
      var tw = 330, th = 430, tx = W - pad - tw + 6, ty = 62, rot = wd.serious ? 0 : 2.5;
      ctx.save();
      ctx.translate(tx + tw / 2, ty + th / 2);
      ctx.rotate(rot * Math.PI / 180);
      ctx.translate(-tw / 2, -th / 2);
      ctx.fillStyle = C.night; rr(ctx, 10, 10, tw, th, 22); ctx.fill();
      ctx.fillStyle = C.cream; rr(ctx, 0, 0, tw, th, 22); ctx.fill();
      ctx.lineWidth = 4; ctx.strokeStyle = C.night; ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      setFont(ctx, 36, 800, fam(env, 'body'));
      spacing(ctx, 5);
      ctx.fillStyle = C.violetDeep;
      ctx.fillText(month, tw / 2 + 2.5, 74);
      spacing(ctx, 0);
      var df = fit(ctx, day, tw - 60, { max: 190, min: 80, maxLines: 1, lh: 1, family: fam(env, 'display'), stretch: 'condensed' });
      ctx.fillStyle = C.night;
      ctx.textAlign = 'center';
      ctx.fillText(day, tw / 2, 82 + df.size * 0.76);
      var wf = fit(ctx, wkTime, tw - 40, { max: 30, min: 18, maxLines: 1, weight: 800, family: fam(env, 'body') });
      ctx.fillText(wkTime, tw / 2, 82 + df.size * 0.76 + 50 + (30 - wf.size) / 2);
      // perforation
      var py = 300;
      ctx.setLineDash([10, 10]); ctx.lineWidth = 3; ctx.strokeStyle = C.night;
      ctx.beginPath(); ctx.moveTo(24, py); ctx.lineTo(tw - 24, py); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = wd.bg;
      ctx.beginPath(); ctx.arc(0, py, 16, -Math.PI / 2, Math.PI / 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(tw, py, 16, Math.PI / 2, Math.PI * 1.5); ctx.fill(); ctx.stroke();
      // the I'm in button
      var label = String(data.cta || c.imIn);
      setFont(ctx, 32, 800, fam(env, 'body'));
      var bw = Math.min(tw - 60, ctx.measureText(label).width + 80), bx = (tw - bw) / 2, by = 334;
      ctx.fillStyle = C.night; rr(ctx, bx, by + 7, bw, 66, 33); ctx.fill();
      ctx.fillStyle = C.celery; rr(ctx, bx, by, bw, 66, 33); ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = C.night; ctx.stroke();
      ctx.fillStyle = C.night; ctx.textBaseline = 'middle';
      ctx.fillText(label, tw / 2, by + 35);
      ctx.restore();
      if (art) dieCut(ctx, art, W - pad - tw - 10, 470, 120, -10, C.night);
    });
  }

  /** Character art (assets/img/characters/characters.js, loaded by make_og.js) as an Image, or null. */
  function characterArt(p) {
    var X = w.YSD_DATA && w.YSD_DATA.characters, it = X && X.items && X.items[p];
    var svg = it ? (typeof it === 'string' ? it : it.svg) : '';
    if (!svg || !YSD.cards.h || !YSD.cards.h.loadImage) return Promise.resolve(null);
    return YSD.cards.h.loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)).then(null, function () { return null; });
  }
  /** Draw a character with a white die-cut edge and a hard ink shadow, keeping its aspect ratio. */
  function drawCharacter(ctx, img, cx, cy, size, rot) {
    var iw = img.naturalWidth || img.width || 256, ih = img.naturalHeight || img.height || 264, k = size / Math.max(iw, ih);
    var dw = iw * k, dh = ih * k, edge = Math.round(size * 0.03), pad = edge + 10;
    var c = canvasOf(dw + pad * 2, dh + pad * 2), x = c.getContext('2d');
    x.drawImage(img, pad, pad, dw, dh);
    var white = silhouette(c, C.white), o = canvasOf(c.width, c.height), ox = o.getContext('2d');
    for (var a = 0; a < 24; a++) { var ang = a / 24 * Math.PI * 2; ox.drawImage(white, Math.cos(ang) * edge, Math.sin(ang) * edge); }
    ox.drawImage(c, 0, 0);
    ctx.save(); ctx.translate(cx, cy); ctx.rotate((rot || 0) * Math.PI / 180);
    ctx.drawImage(silhouette(o, C.night), -o.width / 2 + 8, -o.height / 2 + 8);
    ctx.drawImage(o, -o.width / 2, -o.height / 2);
    ctx.restore();
  }
  /**
   * og-quiz (round 1, genz-brand-15): the result's own character at about 300 px on the right (or a fanned trio
   * from `characters` for the quiz page), the title in two lines at most, and the subline whole: up to two lines,
   * height reserved, fitted down before it is ever cut. Serious results (color 'lake') stay upright and calm.
   */
  function ogQuiz(ctx, data, env) {
    env.data = data;
    var c = copy(data), wd = world(data.color || 'violet'), W = env.width, pad = 60;
    var one = data.character ? [data.character] : [], many = Array.isArray(data.characters) ? data.characters.slice(0, 3) : [];
    return Promise.all((one.length ? one : many).map(characterArt)).then(function (imgs) {
      imgs = imgs.filter(Boolean);
      bg(ctx, env, wd);
      var bandY = band(ctx, env, wd, data, 'DEMO');
      brand(ctx, env, wd, pad, 46, 1);
      var hasArt = imgs.length > 0;
      if (hasArt && imgs.length === 1) drawCharacter(ctx, imgs[0], W - pad - 170, bandY / 2 + 14, 330, wd.serious ? 0 : 5);
      else if (hasArt) {
        var spots = [[W - 330, bandY / 2 + 40, 230, -9], [W - 130, bandY / 2 + 50, 230, 9], [W - 230, bandY / 2 + 6, 260, -1]];
        for (var i = 0; i < imgs.length; i++) { var sp = spots[imgs.length === 2 ? i : i]; drawCharacter(ctx, imgs[i], sp[0], sp[1], sp[2], wd.serious ? 0 : sp[3]); }
      } else if (!wd.serious) {
        // decorative answer chips (no text) when there's no art
        var chips = [[C.bubblegum, -8, 820, 150], [C.sky, 5, 870, 262], [C.celery, -3, 800, 372]];
        for (var j = 0; j < chips.length; j++) {
          ctx.save();
          ctx.translate(chips[j][2] + 150, chips[j][3] + 40);
          ctx.rotate(chips[j][1] * Math.PI / 180);
          ctx.fillStyle = C.night; rr(ctx, -150 + 7, -40 + 7, 300, 80, 40); ctx.fill();
          ctx.fillStyle = chips[j][0] === wd.bg ? C.cream : chips[j][0]; rr(ctx, -150, -40, 300, 80, 40); ctx.fill();
          ctx.lineWidth = 3; ctx.strokeStyle = C.night; ctx.stroke();
          ctx.fillStyle = C.cream; ctx.beginPath(); ctx.arc(-102, 0, 22, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          if (j === 1) check(ctx, -113, 1, 22, C.violet, 7);
          ctx.fillStyle = 'rgba(23,11,51,.35)'; rr(ctx, -62, -9, 170 - j * 30, 18, 9); ctx.fill();
          ctx.restore();
        }
      }
      var colW = hasArt ? W - pad * 2 - (imgs.length === 1 ? 360 : 440) : (wd.serious ? W - pad * 2 : 680), y = 140;
      if (data.kicker) { pill(ctx, env, String(data.kicker).toUpperCase(), pad, y, { size: 22, bg: wd.pill, fg: wd.pillFg, rotate: wd.serious ? 0 : -1.5, shadow: wd.dark && !wd.serious ? C.night : null }); y += 72; }
      // reserve the subline's two lines and the CTA before the title takes its share
      var sub = String(data.sub || ''), sf = null;
      if (sub) sf = fit(ctx, sub, colW, { max: 30, min: 21, maxLines: 2, lh: 1.22, weight: 600, family: fam(env, 'body') });
      var subH = sf ? sf.lines.length * sf.lh + 14 : 0, ctaH = 76;
      var f = fit(ctx, String(data.title || ''), colW, { max: 132, min: 52, maxLines: 2, lh: 0.92, maxH: bandY - 24 - y - subH - ctaH, family: fam(env, 'display'), stretch: 'condensed' });
      var used = drawLines(ctx, f, pad, y, colW, wd, data.accent);
      var yy = y + used;
      if (sf) {
        setFont(ctx, sf.size, 600, fam(env, 'body'));
        ctx.fillStyle = wd.fg; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
        for (var k = 0; k < sf.lines.length; k++) ctx.fillText(sf.lines[k], pad, yy + 14 + sf.size * 0.85 + k * sf.lh);
        yy += subH;
      }
      pill(ctx, env, String(data.cta || c.whatsYours), pad, Math.min(bandY - 76, yy + 18), {
        size: 26, bg: wd.dark ? C.celery : C.night, fg: wd.dark ? C.night : C.cream, edge: C.night, shadow: C.night, rotate: wd.serious ? 0 : -2, track: 0, height: 58
      });
    });
  }

  YSD.cards.register('og-page', ogPage, { size: 'wide' });
  YSD.cards.register('og-event', ogEvent, { size: 'wide' });
  YSD.cards.register('og-quiz', ogQuiz, { size: 'wide' });
  YSD.cardsOg = { templates: ['og-page', 'og-event', 'og-quiz'], world: world, when: when, version: 1 };
})(window);
