/*!
 * Young Seminole Democrats: share-card engine (canvas).  YSD.cards
 *
 *   register(name, drawFn, meta)        add a template. drawFn(ctx, data, env) may return a Promise.
 *                                       env = { width, height, scale, theme, h (helpers), canvas, demo, name }
 *                                       meta = { size: 'story'|'square'|'wide', fonts: [css font specs] }
 *   render(name, data, opts)            -> Promise<HTMLCanvasElement>
 *                                       opts = { size | preset, width, height, theme: {overrides}, el }
 *   toBlob(canvas, type, quality)       -> Promise<Blob>  (rejects if the canvas is tainted)
 *   share(canvas, {title,text,url,filename,count}) -> Promise<'shared'|'downloaded'|'cancelled'|'failed'>
 *   download(canvasOrBlob, filename)    -> Promise<'downloaded'|'failed'>
 *   theme(el)                           colours/fonts from CSS custom properties, config fallbacks
 *   sizes                               { story: 1080x1920, square: 1080x1080, wide: 1200x630 }
 *   h / helpers                         roundRect, wrapText, fitText, font, gradient, sticker,
 *                                       loadImage, cover, waitForFonts
 *
 * Theme: for each key in YSD_CONFIG.theme (bg, fg, brand, accent, pop, muted, ink, paper,
 * fontDisplay, fontBody) the engine reads --ysd-card-<kebab-key>, then --ysd-<kebab-key>, from
 * :root (or opts.el), then falls back to the config hex. The design team restyles cards from CSS.
 *
 * The two built-in templates ('joined', 'pledge') are deliberately neutral PLACEHOLDERS for the
 * design team to replace; their default copy is placeholder text too.
 */
(function (w) {
  'use strict';
  var YSD = w.YSD = w.YSD || {};
  function cfg(p, fb) { return typeof YSD.cfg === 'function' ? YSD.cfg(p, fb) : fb; }
  function emit(n, d) { if (typeof YSD.emit === 'function') YSD.emit(n, d); }
  function track(e, p) { try { if (typeof YSD.track === 'function') YSD.track(e, p); } catch (x) {} }
  function log() { if (typeof YSD.log === 'function') YSD.log.apply(null, arguments); }

  var SIZES = {
    story: { width: 1080, height: 1920 },
    square: { width: 1080, height: 1080 },
    wide: { width: 1200, height: 630 }
  };
  var DEFAULT_THEME = {
    bg: '#101114', fg: '#ffffff', brand: '#2f5bea', accent: '#ff4f8b', pop: '#ffd23f',
    muted: '#9aa0aa', ink: '#101114', paper: '#ffffff',
    fontDisplay: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    fontBody: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
  };
  var templates = {};

  // ------------------------------------------------------------------ theme
  function kebab(k) { return k.replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); }); }
  /** Read theme values: --ysd-card-<key>, then --ysd-<key>, then YSD_CONFIG.theme, then built-ins. */
  function theme(el, overrides) {
    var base = {}, k;
    var conf = cfg('theme', null) || {};
    for (k in DEFAULT_THEME) base[k] = DEFAULT_THEME[k];
    for (k in conf) if (Object.prototype.hasOwnProperty.call(conf, k)) base[k] = conf[k];
    var cs = null;
    try {
      var d = w.document;
      var target = el || (d && d.documentElement);
      if (target && typeof w.getComputedStyle === 'function') cs = w.getComputedStyle(target);
    } catch (e) { cs = null; }
    var out = {};
    for (k in base) {
      var v = '';
      if (cs) {
        try {
          v = String(cs.getPropertyValue('--ysd-card-' + kebab(k)) || '').trim() ||
              String(cs.getPropertyValue('--ysd-' + kebab(k)) || '').trim();
        } catch (e) { v = ''; }
      }
      out[k] = v || base[k];
    }
    if (overrides) for (k in overrides) if (Object.prototype.hasOwnProperty.call(overrides, k)) out[k] = overrides[k];
    return out;
  }

  // ------------------------------------------------------------------ helpers
  /** Trace a rounded-rectangle path. r: number or [tl, tr, br, bl]. style = { fill, stroke, lineWidth }. */
  function roundRect(ctx, x, y, wd, ht, r, style) {
    var rr = Array.isArray(r) ? r : [r || 0, r || 0, r || 0, r || 0];
    var max = Math.min(Math.abs(wd), Math.abs(ht)) / 2;
    var tl = Math.min(rr[0] || 0, max), tr = Math.min(rr[1] || 0, max), br = Math.min(rr[2] || 0, max), bl = Math.min(rr[3] || 0, max);
    ctx.beginPath();
    ctx.moveTo(x + tl, y);
    ctx.lineTo(x + wd - tr, y);
    ctx.arcTo(x + wd, y, x + wd, y + tr, tr);
    ctx.lineTo(x + wd, y + ht - br);
    ctx.arcTo(x + wd, y + ht, x + wd - br, y + ht, br);
    ctx.lineTo(x + bl, y + ht);
    ctx.arcTo(x, y + ht, x, y + ht - bl, bl);
    ctx.lineTo(x, y + tl);
    ctx.arcTo(x, y, x + tl, y, tl);
    ctx.closePath();
    if (style) {
      if (style.fill) { ctx.fillStyle = style.fill; ctx.fill(); }
      if (style.stroke) { ctx.strokeStyle = style.stroke; ctx.lineWidth = style.lineWidth || 2; ctx.stroke(); }
    }
    return ctx;
  }

  /** CSS font shorthand. family defaults to the theme display font. */
  function font(size, weight, family) {
    return (weight || 700) + ' ' + Math.round(size) + 'px ' + (family || DEFAULT_THEME.fontDisplay);
  }

  function splitLines(ctx, text, maxWidth) {
    var paras = String(text == null ? '' : text).split(/\r?\n/), lines = [];
    for (var p = 0; p < paras.length; p++) {
      var words = paras[p].split(/\s+/).filter(function (x) { return x.length; });
      if (!words.length) { lines.push(''); continue; }
      var line = '';
      for (var i = 0; i < words.length; i++) {
        var word = words[i];
        if (!line) {
          if (ctx.measureText(word).width <= maxWidth) { line = word; continue; }
          // A word longer than the line on its own: break it by characters.
          var chunk = '';
          var chars = Array.from ? Array.from(word) : word.split('');
          for (var c = 0; c < chars.length; c++) {
            if (chunk && ctx.measureText(chunk + chars[c]).width > maxWidth) { lines.push(chunk); chunk = ''; }
            chunk += chars[c];
          }
          line = chunk;
          continue;
        }
        var test = line + ' ' + word;
        if (ctx.measureText(test).width <= maxWidth) line = test;
        else { lines.push(line); line = ''; i--; }   // retry this word on a fresh line
      }
      if (line) lines.push(line);
    }
    return lines;
  }
  /**
   * Word-wrap text inside maxWidth starting at (x, y), one line every lineHeight px. Uses the
   * ctx's current font, fillStyle, textAlign and textBaseline (set textBaseline='top' to treat y
   * as the top). opts = { maxLines, ellipsis ('\u2026'), draw (default true) }.
   * Returns { lines, width, height, truncated }.
   */
  function wrapText(ctx, text, x, y, maxWidth, lineHeight, opts) {
    opts = opts || {};
    var lines = splitLines(ctx, text, maxWidth), truncated = false;
    if (opts.maxLines && lines.length > opts.maxLines) {
      truncated = true;
      lines = lines.slice(0, opts.maxLines);
      var ell = opts.ellipsis === undefined ? '\u2026' : opts.ellipsis, last = lines[lines.length - 1];
      while (last && ctx.measureText(last + ell).width > maxWidth) last = last.slice(0, -1);
      lines[lines.length - 1] = last.replace(/\s+$/, '') + ell;
    }
    var width = 0;
    for (var i = 0; i < lines.length; i++) {
      width = Math.max(width, ctx.measureText(lines[i]).width);
      if (opts.draw !== false) ctx.fillText(lines[i], x, y + i * lineHeight);
    }
    return { lines: lines, width: width, height: lines.length * lineHeight, truncated: truncated };
  }

  /**
   * Largest font size (between min and max) at which text fits maxWidth in maxLines lines (and
   * maxHeight, if given). Sets ctx.font and returns { size, font, lines, lineHeight }.
   * opts = { max 160, min 24, weight 800, family, maxLines 1, lineHeight 1.05 (x size), maxHeight }.
   */
  function fitText(ctx, text, maxWidth, opts) {
    opts = opts || {};
    var lo = opts.min || 24, hi = opts.max || 160, lh = opts.lineHeight || 1.05, maxLines = opts.maxLines || 1;
    var weight = opts.weight || 800, family = opts.family;
    function fits(size) {
      ctx.font = font(size, weight, family);
      var lines = splitLines(ctx, text, maxWidth);
      if (lines.length > maxLines) return null;
      for (var i = 0; i < lines.length; i++) if (ctx.measureText(lines[i]).width > maxWidth) return null;
      if (opts.maxHeight && lines.length * size * lh > opts.maxHeight) return null;
      return lines;
    }
    var best = lo, bestLines = null;
    while (hi - lo > 1) {
      var mid = Math.floor((lo + hi) / 2);
      if (fits(mid)) lo = mid; else hi = mid;
    }
    best = fits(hi) ? hi : lo;
    bestLines = fits(best) || splitLines(ctx, text, maxWidth);
    ctx.font = font(best, weight, family);
    return { size: best, font: ctx.font, lines: bestLines, lineHeight: best * lh };
  }

  /** Linear gradient. stops: ['#a', '#b', ...] (even spacing) or [[0, '#a'], [1, '#b']]. */
  function gradient(ctx, x0, y0, x1, y1, stops) {
    var g = ctx.createLinearGradient(x0, y0, x1, y1);
    stops = stops || [];
    for (var i = 0; i < stops.length; i++) {
      var s = stops[i];
      if (Array.isArray(s)) g.addColorStop(Math.max(0, Math.min(1, s[0])), s[1]);
      else g.addColorStop(stops.length === 1 ? 0 : i / (stops.length - 1), s);
    }
    return g;
  }

  /**
   * Pill-shaped label centred on (x, y), optionally rotated (degrees).
   * opts = { bg, fg, size 44, weight 900, family, padX, padY, radius, rotate, border, borderWidth, shadow }.
   * Returns { width, height }.
   */
  function sticker(ctx, text, x, y, opts) {
    opts = opts || {};
    var size = opts.size || 44;
    ctx.save();
    ctx.font = font(size, opts.weight || 900, opts.family);
    var tw = ctx.measureText(String(text)).width;
    var padX = opts.padX != null ? opts.padX : size * 0.6, padY = opts.padY != null ? opts.padY : size * 0.35;
    var wd = tw + padX * 2, ht = size + padY * 2;
    ctx.translate(x, y);
    if (opts.rotate) ctx.rotate(opts.rotate * Math.PI / 180);
    if (opts.shadow) { ctx.shadowColor = opts.shadow; ctx.shadowBlur = size * 0.4; ctx.shadowOffsetY = size * 0.12; }
    roundRect(ctx, -wd / 2, -ht / 2, wd, ht, opts.radius != null ? opts.radius : ht / 2, { fill: opts.bg || DEFAULT_THEME.pop });
    ctx.shadowColor = 'transparent';
    if (opts.border) roundRect(ctx, -wd / 2, -ht / 2, wd, ht, opts.radius != null ? opts.radius : ht / 2, { stroke: opts.border, lineWidth: opts.borderWidth || 4 });
    ctx.fillStyle = opts.fg || DEFAULT_THEME.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(text), 0, size * 0.04);
    ctx.restore();
    return { width: wd, height: ht };
  }

  var tainted = typeof WeakSet === 'function' ? new WeakSet() : null;
  /**
   * Load an image for drawing. Uses crossOrigin='anonymous' (so the canvas stays exportable) for
   * http(s) URLs; data: and blob: URLs need none. On file:// pages, where CORS cannot succeed, it
   * retries without crossOrigin; such an image taints the canvas and toBlob() will reject, so use
   * data: URLs or user-picked files (blob: URLs) for images on file://.
   * opts = { timeout 8000 }. Resolves to the HTMLImageElement; rejects on error/timeout.
   */
  function loadImage(src, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      if (typeof w.Image !== 'function') { reject(new Error('YSD.cards: Image unavailable')); return; }
      var s = String(src || '');
      var needCors = /^https?:/i.test(s) || !/^(data|blob):/i.test(s);
      var timer = null;
      function attempt(useCors) {
        var img = new w.Image();
        if (useCors) img.crossOrigin = 'anonymous';
        img.decoding = 'async';
        img.onload = function () {
          clearTimeout(timer);
          if (!useCors && needCors && tainted) tainted.add(img);
          resolve(img);
        };
        img.onerror = function () {
          var isFile = false;
          try { isFile = w.location && w.location.protocol === 'file:'; } catch (e) {}
          if (useCors && isFile && !/^https?:/i.test(s)) { attempt(false); return; }
          clearTimeout(timer);
          reject(new Error('YSD.cards: image failed to load: ' + s));
        };
        img.src = s;
      }
      timer = setTimeout(function () { reject(new Error('YSD.cards: image timeout: ' + s)); }, opts.timeout || 8000);
      attempt(needCors);
    });
  }

  /** Draw an image cropped to cover the box (like CSS object-fit: cover). */
  function cover(ctx, img, x, y, wd, ht) {
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    if (!iw || !ih) return;
    var scale = Math.max(wd / iw, ht / ih);
    var sw = wd / scale, sh = ht / scale;
    ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, wd, ht);
  }

  /**
   * Wait for web fonts before drawing (canvas does not wait on its own). specs: CSS font
   * shorthands like '800 64px Inter'. Resolves true when all loaded, false on timeout or when
   * the Font Loading API is missing. Never rejects.
   */
  function waitForFonts(specs, timeoutMs) {
    var fonts = null;
    try { fonts = w.document && w.document.fonts; } catch (e) {}
    if (!fonts || typeof fonts.load !== 'function') return Promise.resolve(false);
    // On file:// Chrome blocks web-font loads (CORS) and boot.js switches to the fallback faces,
    // so waiting would only log errors: draw with whatever is available.
    try { if (w.location && w.location.protocol === 'file:') return Promise.resolve(false); } catch (e) {}
    specs = (specs || []).filter(function (x) { return x; });
    var work = Promise.all(specs.map(function (s) { return fonts.load(s).then(null, function () { return null; }); }))
      .then(function () { return fonts.ready; })
      .then(function () { return true; }, function () { return false; });
    var timeout = new Promise(function (resolve) { setTimeout(function () { resolve(false); }, timeoutMs || 2500); });
    return Promise.race([work, timeout]);
  }

  var helpers = {
    roundRect: roundRect, wrapText: wrapText, fitText: fitText, font: font, gradient: gradient,
    sticker: sticker, loadImage: loadImage, cover: cover, waitForFonts: waitForFonts
  };

  // ------------------------------------------------------------------ engine
  function isDemo() { return cfg('demo', true) !== false; }
  function makeCanvas(wd, ht) {
    try {
      var d = w.document;
      if (!d || typeof d.createElement !== 'function') return null;
      var c = d.createElement('canvas');
      if (!c || typeof c.getContext !== 'function') return null;
      c.width = wd; c.height = ht;
      return c;
    } catch (e) { return null; }
  }
  function resolveSize(opts, meta) {
    var key = opts.size || opts.preset || (meta && meta.size) || 'story';
    var s = SIZES[key] || SIZES.story;
    return { width: Math.round(+opts.width || s.width), height: Math.round(+opts.height || s.height) };
  }

  function register(name, drawFn, meta) {
    if (typeof drawFn !== 'function') throw new TypeError('YSD.cards.register: drawFn must be a function');
    templates[String(name)] = { draw: drawFn, meta: meta || {} };
    return api;
  }

  function demoMark(ctx, env) {
    if (!env.demo || cfg('cards.demoWatermark', true) === false) return;
    var s = env.scale;
    ctx.save();
    ctx.globalAlpha = 0.85;
    sticker(ctx, 'DEMO', env.width - 110 * s, env.height - 60 * s, {
      size: 26 * s, bg: 'rgba(0,0,0,0.55)', fg: '#ffffff', family: env.theme.fontBody, weight: 800
    });
    ctx.restore();
  }

  /** Render a registered template to a new canvas. */
  function render(name, data, opts) {
    opts = opts || {};
    return Promise.resolve().then(function () {
      var t = templates[name];
      if (!t) throw new Error('YSD.cards: unknown template "' + name + '"');
      var size = resolveSize(opts, t.meta);
      var canvas = makeCanvas(size.width, size.height);
      if (!canvas) throw new Error('YSD.cards: canvas is not available');
      var ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('YSD.cards: 2D context is not available');
      var th = theme(opts.el, opts.theme);
      var env = {
        name: name, width: size.width, height: size.height,
        scale: Math.min(size.width, size.height) / 1080,
        theme: th, h: helpers, helpers: helpers, canvas: canvas, demo: isDemo()
      };
      var fonts = [].concat(cfg('cards.fonts', []) || [], t.meta.fonts || [], opts.fonts || []);
      return waitForFonts(fonts, opts.fontTimeout || 2500).then(function () {
        return t.draw(ctx, data || {}, env);
      }).then(function () {
        demoMark(ctx, env);
        emit('card-rendered', { name: name, width: size.width, height: size.height, canvas: canvas });
        track('card_render', { template: name, size: size.width + 'x' + size.height });
        return canvas;
      });
    });
  }

  /** Canvas -> Blob. Rejects when the canvas is tainted by a cross-origin image. */
  function toBlob(canvas, type, quality) {
    type = type || 'image/png';
    return new Promise(function (resolve, reject) {
      if (!canvas) { reject(new Error('YSD.cards.toBlob: no canvas')); return; }
      try {
        if (typeof canvas.toBlob === 'function') {
          canvas.toBlob(function (b) { if (b) resolve(b); else reject(new Error('YSD.cards.toBlob: empty result')); }, type, quality);
          return;
        }
        var url = canvas.toDataURL(type, quality);
        var bin = w.atob(url.split(',')[1]), arr = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        resolve(new w.Blob([arr], { type: type }));
      } catch (e) {
        emit('card-error', { error: String(e && e.name || e), reason: e && e.name === 'SecurityError' ? 'tainted' : 'export' });
        reject(e);
      }
    });
  }

  function saveBlob(blob, filename) {
    try {
      var d = w.document, URLo = w.URL || w.webkitURL;
      if (!d || !d.body || !URLo || typeof URLo.createObjectURL !== 'function') return false;
      var href = URLo.createObjectURL(blob);
      var a = d.createElement('a');
      a.href = href; a.download = filename; a.rel = 'noopener'; a.style.display = 'none';
      d.body.appendChild(a);
      a.click();
      d.body.removeChild(a);
      setTimeout(function () { try { URLo.revokeObjectURL(href); } catch (e) {} }, 60000);
      return true;
    } catch (e) { log('cards: download failed', e); return false; }
  }
  /** Save a canvas or Blob as a PNG file. */
  function download(src, filename) {
    filename = filename || 'ydsc-card.png';
    var p = src && typeof src.getContext === 'function' ? toBlob(src) : Promise.resolve(src);
    return p.then(function (blob) { return blob && saveBlob(blob, filename) ? 'downloaded' : 'failed'; }, function () { return 'failed'; });
  }

  /**
   * Share the card image with the native share sheet (files), else download it.
   * opts = { title, text, url, filename, count }. Many share targets drop `url` when files are
   * attached, so the url is appended to the text. Bumps the 'cards' counter on shared/downloaded
   * unless opts.count === false. Call from a click handler; render the canvas beforehand so the
   * user gesture is still active when share() runs.
   */
  function share(canvas, opts) {
    opts = opts || {};
    var filename = opts.filename || 'ydsc-card.png';
    function done(result) {
      try { if ((result === 'shared' || result === 'downloaded') && opts.count !== false && YSD.counters) YSD.counters.bump('cards'); } catch (e) {}
      emit('card-share', { result: result, filename: filename });
      track('card_share', { result: result });
      return result;
    }
    return toBlob(canvas).then(function (blob) {
      var nav = w.navigator, file = null;
      try { file = typeof w.File === 'function' ? new w.File([blob], filename, { type: blob.type || 'image/png' }) : null; } catch (e) { file = null; }
      var can = false;
      try { can = !!(file && nav && typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: [file] })); } catch (e) { can = false; }
      if (!can) return done(saveBlob(blob, filename) ? 'downloaded' : 'failed');
      var text = String(opts.text || '');
      if (opts.url) text = text ? (text.indexOf(opts.url) >= 0 ? text : text + ' ' + opts.url) : String(opts.url);
      var payload = { files: [file] };
      if (opts.title) payload.title = String(opts.title);
      if (text) payload.text = text;
      return nav.share(payload).then(function () { return done('shared'); }, function (err) {
        if (err && err.name === 'AbortError') return done('cancelled');
        return done(saveBlob(blob, filename) ? 'downloaded' : 'failed');
      });
    }, function () { return done('failed'); });
  }

  // ------------------------------------------------------------------ neutral example templates
  // PLACEHOLDER layouts and copy. They only show how a template reads the theme and data.
  function handleLine() {
    var h = cfg('org.handle', '');
    return h ? '@' + h : cfg('org.name', '');
  }
  function shortUrl(u) { return String(u || '').replace(/^[a-z]+:\/\//i, '').replace(/\/$/, ''); }
  function footer(ctx, env, y) {
    var t = env.theme, s = env.scale, W = env.width;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = t.fg;
    ctx.globalAlpha = 0.9;
    ctx.font = font(40 * s, 800, t.fontBody);
    ctx.fillText(handleLine(), W / 2, y);
    var legal = cfg('legal.cardFooter', '');
    if (legal) {
      ctx.globalAlpha = 0.7;
      ctx.font = font(22 * s, 500, t.fontBody);
      wrapText(ctx, legal, W / 2, y + 40 * s, W - 160 * s, 28 * s, { maxLines: 2 });
    }
    ctx.globalAlpha = 1;
  }

  /**
   * 'joined': "I'm in" card. data = { name, refCode, url, headline, sub, sticker }.
   */
  register('joined', function (ctx, data, env) {
    var t = env.theme, h = env.h, W = env.width, H = env.height, s = env.scale;
    var tall = H / W > 1.4, pad = 90 * s;
    ctx.fillStyle = h.gradient(ctx, 0, 0, W * 0.4, H, [t.brand, t.accent]);
    ctx.fillRect(0, 0, W, H);
    var y = tall ? H * 0.16 : H * 0.14;
    h.sticker(ctx, data.sticker || "I'M IN", W / 2, y, { bg: t.pop, fg: t.ink, size: 64 * s, rotate: -5, family: t.fontDisplay });
    y += 110 * s;
    // Bottom-anchored blocks first, so the headline gets whatever space is left.
    var footerY = H - (tall ? 140 : 60) * s;
    var boxW = W - pad * 2, boxH = (tall ? 260 : 190) * s;
    var boxBottomMax = footerY - (tall ? 160 : 70) * s;
    var nameH = data.name ? 90 * s : 0;
    var headroom = (data.refCode ? boxBottomMax - boxH - 30 * s : footerY - 80 * s) - y - nameH - 30 * s;
    var headline = data.headline || ('I just joined ' + cfg('org.name', 'Young Seminole Democrats'));
    var fit = h.fitText(ctx, headline, W - pad * 2, { max: (tall ? 150 : 110) * s, min: 40 * s, maxLines: tall ? 4 : 3, maxHeight: headroom, family: t.fontDisplay, weight: 900 });
    ctx.fillStyle = t.fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    h.wrapText(ctx, headline, W / 2, y, W - pad * 2, fit.lineHeight, { maxLines: tall ? 4 : 3 });
    y += fit.lines.length * fit.lineHeight + 30 * s;
    if (data.name) {
      ctx.font = font(52 * s, 700, t.fontBody);
      ctx.globalAlpha = 0.95;
      ctx.fillText(String(data.name), W / 2, y);
      ctx.globalAlpha = 1;
      y += nameH;
    }
    if (data.refCode) {
      var boxY = Math.min(Math.max(y, tall ? H * 0.58 : y), boxBottomMax - boxH);
      h.roundRect(ctx, pad, boxY, boxW, boxH, 36 * s, { fill: t.paper });
      ctx.fillStyle = t.ink;
      ctx.font = font(36 * s, 700, t.fontBody);
      ctx.fillText(data.sub || 'Join my squad with code', W / 2, boxY + (tall ? 34 : 26) * s);
      h.fitText(ctx, String(data.refCode), boxW - 80 * s, { max: (tall ? 120 : 100) * s, min: 40 * s, family: t.fontDisplay, weight: 900 });
      ctx.fillText(String(data.refCode), W / 2, boxY + (tall ? 90 : 74) * s);
      if (data.url && tall) {
        ctx.font = font(30 * s, 600, t.fontBody);
        ctx.globalAlpha = 0.75;
        h.wrapText(ctx, shortUrl(data.url), W / 2, boxY + boxH + 30 * s, boxW, 38 * s, { maxLines: 2 });
        ctx.globalAlpha = 1;
      }
    }
    footer(ctx, env, footerY);
  }, { size: 'story' });

  /**
   * 'pledge': pledge card. data = { pledge (or text), name, count, headline, sticker }.
   */
  register('pledge', function (ctx, data, env) {
    var t = env.theme, h = env.h, W = env.width, H = env.height, s = env.scale;
    var tall = H / W > 1.4, pad = 90 * s;
    ctx.fillStyle = t.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = h.gradient(ctx, 0, 0, W, 0, [t.brand, t.accent, t.pop]);
    ctx.fillRect(0, 0, W, 24 * s);
    ctx.fillRect(0, H - 24 * s, W, 24 * s);
    var y = tall ? H * 0.14 : H * 0.12;
    h.sticker(ctx, data.sticker || 'MY PLEDGE', W / 2, y, { bg: t.accent, fg: t.paper, size: 56 * s, rotate: 4, family: t.fontDisplay });
    y += 100 * s;
    if (data.headline) {
      ctx.fillStyle = t.muted;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.font = font(44 * s, 700, t.fontBody);
      h.wrapText(ctx, String(data.headline), W / 2, y, W - pad * 2, 54 * s, { maxLines: 2 });
      y += 130 * s;
    }
    var footerY = H - (tall ? 120 : 60) * s;
    var stickerY = footerY - (tall ? 120 : 84) * s;
    var bottomLimit = (data.count ? stickerY - 50 * s : footerY - 70 * s) - (data.name ? 80 * s : 0) - 30 * s;
    var pledge = '\u201c' + String(data.pledge || data.text || 'I pledge to vote in every election.') + '\u201d';
    var avail = Math.min(H * 0.5, bottomLimit - y);
    var fit = h.fitText(ctx, pledge, W - pad * 2, { max: (tall ? 130 : 100) * s, min: 40 * s, maxLines: tall ? 7 : 5, maxHeight: avail, family: t.fontDisplay, weight: 900 });
    ctx.fillStyle = t.fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    h.wrapText(ctx, pledge, W / 2, y, W - pad * 2, fit.lineHeight, { maxLines: tall ? 7 : 5 });
    y += Math.min(fit.lines.length, tall ? 7 : 5) * fit.lineHeight + (tall ? 50 : 30) * s;
    if (data.name) {
      ctx.fillStyle = t.pop;
      ctx.font = font(50 * s, 800, t.fontBody);
      ctx.fillText('\u2014 ' + String(data.name), W / 2, y);
      y += 80 * s;
    }
    if (data.count) {
      var label = (YSD.counters && YSD.counters.format ? YSD.counters.format(data.count) : String(data.count)) + ' ' + (data.countLabel || 'pledges and counting');
      h.sticker(ctx, label, W / 2, tall ? Math.min(Math.max(y + 40 * s, H * 0.78), stickerY) : stickerY, { bg: t.paper, fg: t.ink, size: 34 * s, weight: 800, family: t.fontBody });
    }
    footer(ctx, env, footerY);
  }, { size: 'story' });

  var api = {
    sizes: SIZES,
    register: register,
    render: render,
    toBlob: toBlob,
    share: share,
    download: download,
    theme: function (el, overrides) { return theme(el, overrides); },
    has: function (name) { return Object.prototype.hasOwnProperty.call(templates, name); },
    list: function () { return Object.keys(templates); },
    isTainted: function (img) { return !!(tainted && img && tainted.has(img)); },
    h: helpers,
    helpers: helpers
  };
  // Expose helpers at the top level too (YSD.cards.roundRect(...)).
  for (var k in helpers) if (Object.prototype.hasOwnProperty.call(helpers, k)) api[k] = helpers[k];
  YSD.cards = api;
})(typeof window !== 'undefined' ? window : this);
