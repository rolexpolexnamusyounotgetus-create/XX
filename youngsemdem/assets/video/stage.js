/*!
 * assets/video/stage.js: the in-page frame engine for the DEMO creator clips (build tool, never loaded by
 * a site page). assets/video/render_clips.js opens a blank 720x1280 page, injects this file, calls
 * STAGE.build(clip, assets) once and STAGE.render(t) for every frame, and screenshots each frame.
 *
 * A clip is a list of shots with hard cuts between them (jump-cut rhythm). Each shot stacks layers:
 *   photo      a stock photo, cover-fit, with a focus point, punch-in zoom and a small handheld shake
 *   phone      a screen recording of a phone browser: skeleton UI (no words but the domain), tap dots
 *   date       a calendar tile with a big numeral (numbers only, so it reads the same in EN and ES)
 *   map        a stylised Seminole County map (not to scale): city dots, pins that pop in, a facecam bubble
 *   route      the SunRail line through the four Seminole stops, with the train sticker riding it
 *   score      a trivia scoreboard: sticker "teams", bars and numerals, then a tiebreaker
 *   ids        a student ID that gets a big X, then three other IDs that get checks (icons, no words)
 *   seats      a row of chairs, one saved with a heart
 *   badge      a listicle numeral in a circle
 *   stickers   brand stickers (data/stickers.js art, white die-cut edge) popping in with a wobble
 *   burst      a shower of stickers
 * There is no caption, title or handle in the picture: captions are WebVTT/HTML so Spanish works.
 * The only burned-in word is a small DEMO bug in the video (never on the poster), so a clip saved on
 * its own can't pass as real. Everything is deterministic: render(t) depends on t only.
 */
(function (w) {
  'use strict';
  var W = 720, H = 1280;
  var d = w.document;
  var C = { violet: '#6A2BFF', deep: '#4B12D6', celery: '#C8F03C', bubble: '#FF7AC6', hot: '#FF4FA3', sky: '#4FD6FF', tang: '#FF8B3D',
    orange: '#FF6B1A', teal: '#00B3A6', mint: '#7EE081', sun: '#FFD23F', lake: '#2236C9', night: '#170B33', cream: '#FFF6EA' };

  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function lerp(a, b, p) { return a + (b - a) * p; }
  function easeOut(p) { p = clamp(p, 0, 1); return 1 - Math.pow(1 - p, 3); }
  function easeInOut(p) { p = clamp(p, 0, 1); return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }
  function back(p) { p = clamp(p, 0, 1); var c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); }
  function popScale(t, t0, dur) { return t < t0 ? 0 : back((t - t0) / (dur || 0.32)); }
  function el(tag, cls, css, html) {
    var n = d.createElement(tag);
    if (cls) n.className = cls;
    if (css) n.style.cssText = css;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function shake(t, amp, seed) {
    seed = seed || 1;
    return [amp * (Math.sin(t * 2.1 + seed) * 0.6 + Math.sin(t * 5.3 + seed * 2) * 0.4),
      amp * (Math.sin(t * 1.7 + seed * 3) * 0.6 + Math.sin(t * 4.1 + seed) * 0.4)];
  }

  var A = null;          // assets: { photos: {key: {src, w, h}}, stickers: {id: svg} }
  var shots = [], dur = 0, watermark = null;

  // ------------------------------------------------------------------ stickers
  function sticker(id, size) {
    var svg = A.stickers[id] || A.stickers.heart;
    var e = Math.max(3, Math.round(size / 32));
    var n = el('div', 'stk', 'position:absolute;width:' + size + 'px;height:' + size + 'px;margin:' + (-size / 2) + 'px 0 0 ' + (-size / 2) + 'px;' +
      'filter:drop-shadow(' + e + 'px 0 0 #fff) drop-shadow(-' + e + 'px 0 0 #fff) drop-shadow(0 ' + e + 'px 0 #fff) drop-shadow(0 -' + e + 'px 0 #fff) drop-shadow(0 ' + (e * 3) + 'px ' + (e * 3) + 'px rgba(23,11,51,.35));', svg);
    var s = n.querySelector('svg'); if (s) { s.setAttribute('width', size); s.setAttribute('height', size); }
    return n;
  }
  function placeSticker(n, it, t) {
    var k = popScale(t, it.t, 0.34);
    var wob = t > it.t ? Math.sin((t - it.t) * 7) * Math.exp(-(t - it.t) * 2.2) * 9 : 0;
    var drift = it.float ? Math.sin(t * 1.6 + it.x) * 6 : 0;
    n.style.left = it.x + 'px'; n.style.top = (it.y + drift) + 'px';
    n.style.transform = 'scale(' + k + ') rotate(' + ((it.rot || 0) + wob) + 'deg)';
    n.style.opacity = t < it.t ? 0 : 1;
    if (it.out != null) { var o = clamp((it.out - t) / 0.15, 0, 1); n.style.opacity = Math.min(+n.style.opacity, o); }
  }

  // ------------------------------------------------------------------ layers
  var LAYERS = {};

  LAYERS.solid = function (L) {
    var n = el('div', '', 'position:absolute;inset:0;background:' + (L.bg || C.night));
    if (L.dots) n.style.backgroundImage = 'radial-gradient(' + L.dots + ' 3px, transparent 3.5px)', n.style.backgroundSize = '44px 44px';
    return { node: n, render: function () {} };
  };

  LAYERS.photo = function (L) {
    var p = A.photos[L.photo];
    var box = el('div', '', 'position:absolute;inset:0;overflow:hidden;background:#000');
    var img = el('img', '', 'position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform;' + (L.filter ? 'filter:' + L.filter + ';' : ''));
    img.src = p.src; img.width = p.w; img.height = p.h;
    box.appendChild(img);
    if (L.grade === 'golden') {
      box.appendChild(el('div', '', 'position:absolute;inset:0;mix-blend-mode:soft-light;background:linear-gradient(180deg,rgba(255,210,63,.55),rgba(255,79,163,.45))'));
    } else if (L.grade === 'cool') {
      box.appendChild(el('div', '', 'position:absolute;inset:0;mix-blend-mode:soft-light;background:linear-gradient(180deg,rgba(79,214,255,.4),rgba(106,43,255,.45))'));
    } else if (L.grade === 'dim') {
      box.appendChild(el('div', '', 'position:absolute;inset:0;background:rgba(23,11,51,.55)'));
    }
    var s0 = Math.max(W / p.w, H / p.h);
    return {
      node: box,
      render: function (t, lt, sd) {
        var q = easeOut(lt / Math.max(0.01, sd));
        var z = lerp(L.zoom[0], L.zoom[1], L.ease === 'linear' ? clamp(lt / sd, 0, 1) : q);
        var f0 = L.focus[0], f1 = L.focus[1] || L.focus[0];
        var fx = lerp(f0[0], f1[0], q), fy = lerp(f0[1], f1[1], q);
        var s = s0 * z, iw = p.w * s, ih = p.h * s;
        var x = W / 2 - fx * iw, y = H / 2 - fy * ih;
        x = clamp(x, W - iw, 0); y = clamp(y, H - ih, 0);
        var sh = shake(t, L.shake == null ? 3 : L.shake, L.seed || 1);
        var pad = Math.abs(L.shake == null ? 3 : L.shake) + 1;
        x = clamp(x + sh[0], W - iw - pad, pad); y = clamp(y + sh[1], H - ih - pad, pad);
        if (iw < W + 2 * pad || ih < H + 2 * pad) { x = clamp(x, W - iw, 0); y = clamp(y, H - ih, 0); }
        img.style.transform = 'translate(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px) scale(' + s.toFixed(5) + ')';
      }
    };
  };

  // A phone browser screen recording: the frame is the screen. Skeleton UI only; the one word is the domain.
  LAYERS.phone = function (L) {
    var n = el('div', '', 'position:absolute;inset:0;background:#F4F2FA;overflow:hidden;font-family:"Atkinson Hyperlegible Next",sans-serif');
    n.innerHTML =
      '<div style="position:absolute;left:0;right:0;top:0;height:64px;display:flex;align-items:center;justify-content:space-between;padding:0 40px;font:800 30px/1 \'Atkinson Hyperlegible Next\';color:#170B33">' +
      '<span>9:41</span><span style="display:flex;gap:10px;align-items:center"><i style="display:block;width:30px;height:18px;border-radius:4px;border:3px solid #170B33;position:relative"></i></span></div>' +
      '<div style="position:absolute;left:28px;right:28px;top:78px;height:76px;border-radius:38px;background:#E6E1F3;display:flex;align-items:center;gap:14px;padding:0 30px;font:700 32px/1 \'Atkinson Hyperlegible Next\';color:#170B33">' +
      '<svg width="26" height="30" viewBox="0 0 26 30"><rect x="3" y="13" width="20" height="15" rx="3" fill="#170B33"/><path d="M7 13V9a6 6 0 0 1 12 0v4" stroke="#170B33" stroke-width="3.4" fill="none"/></svg>' +
      '<span>voteseminole.gov</span></div>' +
      '<div data-scroll style="position:absolute;left:0;right:0;top:176px;will-change:transform"></div>' +
      '<div data-views style="position:absolute;left:0;right:0;top:176px;bottom:0"></div>';
    var views = n.querySelector('[data-views]');
    function bar(wd, h, c, r, extra) { return '<i style="display:block;width:' + wd + ';height:' + (h || 26) + 'px;border-radius:' + (r == null ? 13 : r) + 'px;background:' + (c || '#D9D3EA') + ';' + (extra || '') + '"></i>'; }
    function card(inner, extra) { return '<div style="margin:0 28px 26px;padding:30px;border-radius:30px;background:#fff;box-shadow:0 2px 0 rgba(23,11,51,.06);' + (extra || '') + '">' + inner + '</div>'; }
    var env = '<svg width="96" height="96" viewBox="0 0 96 96"><rect x="8" y="22" width="80" height="54" rx="8" fill="#2236C9"/><path d="M10 26l38 28 38-28" stroke="#fff" stroke-width="6" fill="none" stroke-linejoin="round"/></svg>';
    var check = function (sz, bg) { return '<svg width="' + sz + '" height="' + sz + '" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="' + (bg || '#1E6B3A') + '"/><path d="M28 52l15 15 30-32" stroke="#fff" stroke-width="10" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>'; };
    var person = '<svg width="120" height="120" viewBox="0 0 120 120"><circle cx="60" cy="60" r="58" fill="#E6E1F3"/><circle cx="60" cy="48" r="20" fill="#9C93BC"/><path d="M24 100c6-20 22-28 36-28s30 8 36 28" fill="#9C93BC"/></svg>';
    var V = {
      home: '<div style="padding-top:30px">' + '<div style="margin:0 28px 30px">' + bar('70%', 46, '#170B33', 10) + '<div style="height:16px"></div>' + bar('50%', 46, '#170B33', 10) + '</div>' +
        card('<div style="display:flex;gap:26px;align-items:center">' + env + '<div style="flex:1;display:grid;gap:14px">' + bar('80%', 30, '#170B33') + bar('60%') + '</div></div>', 'outline:6px solid transparent') +
        card('<div style="display:grid;gap:16px">' + bar('70%', 30, '#2A2150') + bar('90%') + bar('55%') + '</div>') +
        card('<div style="display:grid;gap:16px">' + bar('60%', 30, '#2A2150') + bar('85%') + '</div>') + '</div>',
      form: '<div style="padding-top:30px">' + '<div style="margin:0 28px 34px;display:flex;gap:20px;align-items:center">' + env + bar('55%', 40, '#170B33', 10) + '</div>' +
        [0, 1, 2].map(function (i) { return '<div style="margin:0 28px 30px">' + bar((40 + i * 10) + '%', 22, '#8D84AE') + '<div data-field="' + i + '" style="margin-top:14px;height:92px;border-radius:20px;background:#fff;border:4px solid #CFC8E3;display:flex;align-items:center;padding:0 26px"><i data-type style="display:block;height:26px;border-radius:13px;background:#170B33;width:0"></i></div></div>'; }).join('') +
        '<div style="margin:10px 28px 0;display:flex;gap:22px;align-items:center"><div data-box style="width:56px;height:56px;border-radius:14px;border:5px solid #170B33;background:#fff"></div>' + bar('62%', 24, '#8D84AE') + '</div>' +
        '<div data-submit style="margin:44px 28px 0;height:110px;border-radius:55px;background:#2236C9;display:flex;align-items:center;justify-content:center">' + bar('34%', 30, 'rgba(255,255,255,.92)') + '</div></div>',
      done: '<div style="padding-top:120px;display:grid;justify-items:center;gap:40px"><div data-check style="transform:scale(0)">' + check(260) + '</div>' + bar('64%', 44, '#170B33', 12) + bar('48%', 30) + bar('56%', 30) + '</div>',
      record: '<div style="padding-top:34px">' + card('<div style="display:flex;gap:28px;align-items:center">' + person + '<div style="flex:1;display:grid;gap:16px">' + bar('70%', 34, '#170B33') + bar('50%') + '</div></div>') +
        card('<div style="display:grid;gap:22px">' + [0, 1].map(function () { return '<div style="display:flex;justify-content:space-between;align-items:center">' + bar('48%') + bar('26%', 26, '#E6E1F3') + '</div>'; }).join('') +
          '<div data-row style="display:flex;justify-content:space-between;align-items:center;padding:18px;margin:0 -18px;border-radius:20px">' + '<div style="display:flex;gap:18px;align-items:center;width:60%"><span style="transform:scale(.6);transform-origin:left center;width:58px">' + env + '</span>' + bar('70%', 26, '#170B33') + '</div><span data-ok style="transform:scale(0)">' + check(70) + '</span></div>' +
          [0, 1].map(function () { return '<div style="display:flex;justify-content:space-between;align-items:center">' + bar('40%') + bar('30%', 26, '#E6E1F3') + '</div>'; }).join('') + '</div>') + '</div>'
    };
    var nodes = {};
    Object.keys(V).forEach(function (k) { var v = el('div', '', 'position:absolute;inset:0;will-change:transform', V[k]); v.hidden = true; nodes[k] = v; views.appendChild(v); });
    var taps = (L.taps || []).map(function (tp) { var r = el('div', '', 'position:absolute;width:120px;height:120px;margin:-60px 0 0 -60px;border-radius:50%;background:rgba(200,240,60,.55);border:6px solid #170B33;opacity:0'); n.appendChild(r); return { n: r, tp: tp }; });
    return {
      node: n,
      render: function (t, lt) {
        var cur = L.views[0];
        L.views.forEach(function (v) { if (lt >= v.t) cur = v; });
        Object.keys(nodes).forEach(function (k) { nodes[k].hidden = k !== cur.view; });
        var vn = nodes[cur.view], vt = lt - cur.t;
        vn.style.transform = 'translateY(' + (cur.scroll ? -easeInOut(vt / cur.scroll[1]) * cur.scroll[0] : 0) + 'px)';
        if (cur.view === 'form') {
          vn.querySelectorAll('[data-type]').forEach(function (b, i) { b.style.width = (clamp((vt - 0.15 - i * 0.42) / 0.38, 0, 1) * (64 - i * 9)) + '%'; });
          var box = vn.querySelector('[data-box]'); var on = vt > 1.45;
          box.style.background = on ? '#170B33' : '#fff';
          box.innerHTML = on ? '<svg viewBox="0 0 40 40" width="46" height="46"><path d="M9 21l7 7 15-16" stroke="#C8F03C" stroke-width="6" fill="none" stroke-linecap="round"/></svg>' : '';
          vn.querySelector('[data-submit]').style.transform = 'scale(' + (vt > 1.85 && vt < 2.05 ? 0.95 : 1) + ')';
        }
        if (cur.view === 'done') vn.querySelector('[data-check]').style.transform = 'scale(' + popScale(vt, 0.05, 0.4) + ')';
        if (cur.view === 'record') {
          vn.querySelector('[data-ok]').style.transform = 'scale(' + popScale(vt, 0.7, 0.4) + ')';
          vn.querySelector('[data-row]').style.background = vt > 0.6 ? 'rgba(200,240,60,.45)' : 'transparent';
        }
        taps.forEach(function (o) {
          var k = (lt - o.tp.t) / 0.45;
          o.n.style.left = o.tp.x + 'px'; o.n.style.top = o.tp.y + 'px';
          o.n.style.opacity = k < 0 || k > 1 ? 0 : (k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8);
          o.n.style.transform = 'scale(' + (0.5 + 0.7 * easeOut(k)) + ')';
        });
      }
    };
  };

  LAYERS.date = function (L) {
    var n = el('div', '', 'position:absolute;inset:0;background:' + (L.bg || C.tang));
    if (L.rays) n.style.backgroundImage = 'repeating-conic-gradient(from 0deg at 50% 38%, rgba(255,255,255,.14) 0 10deg, transparent 10deg 20deg)';
    var card = el('div', '', 'position:absolute;left:50%;top:' + (L.top || 380) + 'px;width:' + (L.w || 470) + 'px;margin-left:-' + ((L.w || 470) / 2) + 'px;border-radius:44px;background:' + C.cream + ';border:8px solid ' + C.night + ';box-shadow:18px 18px 0 ' + C.night + ';overflow:hidden;text-align:center');
    card.innerHTML = '<div style="height:96px;background:' + (L.band || C.hot) + ';border-bottom:8px solid ' + C.night + ';display:flex;justify-content:center;gap:120px;align-items:center"><i style="width:26px;height:26px;border-radius:50%;background:' + C.night + '"></i><i style="width:26px;height:26px;border-radius:50%;background:' + C.night + '"></i></div>' +
      '<div style="font:800 ' + (L.size || 300) + 'px/1.02 \'Bricolage Grotesque\';font-stretch:76%;color:' + C.night + ';letter-spacing:-.04em;padding:10px 0 ' + (L.sub ? 0 : 30) + 'px">' + L.num + '</div>' +
      (L.sub ? '<div style="font:800 96px/1 \'Bricolage Grotesque\';font-stretch:80%;color:' + C.night + ';padding:0 0 40px;opacity:.85">' + L.sub + '</div>' : '');
    n.appendChild(card);
    var x = null;
    if (L.cross) { x = el('div', '', 'position:absolute;left:50%;top:' + ((L.top || 380) + 60) + 'px;width:520px;height:520px;margin-left:-260px', '<svg viewBox="0 0 100 100" width="520" height="520"><path d="M18 18 82 82M82 18 18 82" stroke="#FF4FA3" stroke-width="13" stroke-linecap="round"/></svg>'); n.appendChild(x); }
    return {
      node: n,
      render: function (t, lt) {
        var k = popScale(lt, L.at || 0, 0.42);
        card.style.transform = 'rotate(' + ((L.rot || -4) * k) + 'deg) scale(' + k + ')';
        if (x) x.style.transform = 'scale(' + popScale(lt, L.cross, 0.3) + ')';
      }
    };
  };

  // Stylised Seminole County, not to scale: approximate city positions; lakes as soft shapes.
  var CITIES = { sanford: ['Sanford', 0.56, 0.20], lakemary: ['Lake Mary', 0.30, 0.30], longwood: ['Longwood', 0.27, 0.52], altamonte: ['Altamonte Springs', 0.20, 0.71],
    casselberry: ['Casselberry', 0.38, 0.78], wintersprings: ['Winter Springs', 0.56, 0.64], oviedo: ['Oviedo', 0.76, 0.74] };
  LAYERS.map = function (L) {
    var n = el('div', '', 'position:absolute;inset:0;background:' + (L.bg || C.sky));
    var MX = 50, MY = L.top || 330, MW = 620, MH = 700;
    var svg = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" style="position:absolute;inset:0">' +
      '<path d="' + [[0.06, 0.16], [0.30, 0.08], [0.44, 0.13], [0.62, 0.05], [0.82, 0.14], [0.93, 0.36], [0.98, 0.62], [0.95, 0.92], [0.06, 0.94], [0.02, 0.6]].map(function (p, i) { return (i ? 'L' : 'M') + (MX + p[0] * MW).toFixed(1) + ' ' + (MY + p[1] * MH).toFixed(1); }).join('') + 'Z" fill="' + C.cream + '" stroke="' + C.night + '" stroke-width="8" stroke-linejoin="round"/>' +
      '<ellipse cx="' + (MX + 0.50 * MW) + '" cy="' + (MY + 0.06 * MH) + '" rx="' + (0.20 * MW) + '" ry="' + (0.07 * MH) + '" fill="' + C.lake + '" opacity=".9"/>' +
      '<ellipse cx="' + (MX + 0.66 * MW) + '" cy="' + (MY + 0.44 * MH) + '" rx="' + (0.17 * MW) + '" ry="' + (0.055 * MH) + '" fill="' + C.lake + '" opacity=".9" transform="rotate(-14 ' + (MX + 0.66 * MW) + ' ' + (MY + 0.44 * MH) + ')"/>' +
      '</svg>';
    n.innerHTML = svg;
    var dots = Object.keys(CITIES).map(function (k) {
      var c = CITIES[k], x = MX + c[1] * MW, y = MY + c[2] * MH;
      var g = el('div', '', 'position:absolute;left:' + x + 'px;top:' + y + 'px');
      g.innerHTML = '<i style="position:absolute;left:-13px;top:-13px;width:26px;height:26px;border-radius:50%;background:' + C.night + '"></i>' +
        '<b style="position:absolute;' + (c[1] > 0.6 ? 'right:22px;' : 'left:22px;') + 'top:-22px;white-space:nowrap;font:800 34px/1 \'Bricolage Grotesque\';font-stretch:84%;color:' + C.night + ';background:' + C.cream + ';padding:4px 10px;border-radius:10px">' + c[0] + '</b>';
      n.appendChild(g); return g;
    });
    var pins = (L.pins || []).map(function (p) {
      var x = MX + p.x * MW, y = MY + p.y * MH;
      var g = el('div', '', 'position:absolute;left:' + x + 'px;top:' + y + 'px;width:0;height:0', '<svg width="70" height="92" viewBox="0 0 70 92" style="position:absolute;left:-35px;top:-88px"><path d="M35 90C35 90 4 54 4 34a31 31 0 0 1 62 0c0 20-31 56-31 56z" fill="' + (p.color || C.hot) + '" stroke="' + C.night + '" stroke-width="6"/><circle cx="35" cy="34" r="11" fill="' + C.cream + '"/></svg>');
      n.appendChild(g); return { g: g, p: p };
    });
    var cam = null;
    if (L.facecam) {
      var fc = L.facecam, ph = A.photos[fc.photo];
      cam = el('div', '', 'position:absolute;left:' + fc.x + 'px;top:' + fc.y + 'px;width:' + fc.size + 'px;height:' + fc.size + 'px;border-radius:50%;overflow:hidden;border:10px solid ' + C.cream + ';box-shadow:0 0 0 8px ' + C.night + ',14px 14px 0 8px ' + C.night + ';background:#000');
      var im = el('img', '', 'position:absolute;left:0;top:0;transform-origin:0 0'); im.src = ph.src;
      var s = fc.size / (ph.w * fc.span);
      im.style.transform = 'translate(' + (fc.size / 2 - fc.fx * ph.w * s) + 'px,' + (fc.size / 2 - fc.fy * ph.h * s) + 'px) scale(' + s + ')';
      cam.appendChild(im); n.appendChild(cam);
    }
    return {
      node: n,
      render: function (t, lt) {
        dots.forEach(function (g, i) { var k = popScale(lt, 0.05 + i * 0.05, 0.3); g.style.transform = 'scale(' + k + ')'; });
        pins.forEach(function (o) { var k = popScale(lt, o.p.t, 0.36); o.g.style.transform = 'scale(' + k + ')'; o.g.style.opacity = lt < o.p.t ? 0 : 1; });
        if (cam) { var sh = shake(t, 2.5, 3); cam.style.transform = 'translate(' + sh[0] + 'px,' + sh[1] + 'px) scale(' + popScale(lt, 0, 0.35) + ')'; }
      }
    };
  };

  LAYERS.route = function (L) {
    var n = el('div', '', 'position:absolute;inset:0;background:' + (L.bg || C.night));
    n.style.backgroundImage = 'radial-gradient(rgba(255,246,234,.10) 3px, transparent 3.5px)';
    n.style.backgroundSize = '44px 44px';
    var X = L.x || 120, Y0 = L.top || 170, Y1 = L.bottom || 700;
    n.appendChild(el('div', '', 'position:absolute;left:' + (X - 14) + 'px;top:' + (Y0 - 30) + 'px;width:28px;height:' + (Y1 - Y0 + 60) + 'px;border-radius:14px;background:' + C.celery + ';border:6px solid ' + C.cream));
    var stops = L.stops.map(function (s, i) {
      var y = Y0 + (Y1 - Y0) * (i / (L.stops.length - 1));
      var g = el('div', '', 'position:absolute;left:' + X + 'px;top:' + y + 'px');
      g.innerHTML = '<i style="position:absolute;left:-30px;top:-30px;width:60px;height:60px;border-radius:50%;background:' + C.cream + ';border:10px solid ' + C.night + ';box-shadow:0 0 0 6px ' + C.cream + '"></i>' +
        '<b style="position:absolute;left:62px;top:-36px;white-space:nowrap;font:800 58px/1.1 \'Bricolage Grotesque\';font-stretch:78%;color:' + C.cream + ';letter-spacing:-.01em">' + s + '</b>';
      n.appendChild(g); return { g: g, y: y };
    });
    var train = sticker('train', 170); n.appendChild(train);
    return {
      node: n,
      render: function (t, lt, sd) {
        var p = easeInOut((lt - (L.t0 || 0.3)) / ((L.t1 || sd - 0.3) - (L.t0 || 0.3)));
        var y = lerp(Y0, Y1, p);
        stops.forEach(function (o) {
          var reached = y >= o.y - 4;
          var b = o.g.querySelector('b'), i = o.g.querySelector('i');
          b.style.opacity = reached ? 1 : 0.32;
          b.style.transform = 'translateX(' + (reached ? 0 : -14) + 'px) scale(' + (reached && y - o.y < 40 ? 1.06 : 1) + ')';
          b.style.transformOrigin = 'left center';
          i.style.background = reached ? C.celery : C.cream;
        });
        placeSticker(train, { x: X, y: y, t: 0, rot: -8 + Math.sin(lt * 9) * 2 }, lt + 1);
      }
    };
  };

  LAYERS.score = function (L) {
    var n = el('div', '', 'position:absolute;left:50px;right:50px;top:' + (L.top || 160) + 'px;border-radius:40px;background:' + C.cream + ';border:8px solid ' + C.night + ';box-shadow:16px 16px 0 ' + C.night + ';padding:34px 34px 20px');
    var rows = L.rows.map(function (r) {
      var row = el('div', '', 'display:flex;align-items:center;gap:22px;height:118px');
      var av = el('div', '', 'position:relative;width:100px;height:100px;flex:none');
      var s = sticker(r.sticker, 96); s.style.left = '50px'; s.style.top = '50px'; av.appendChild(s);
      var track = el('div', '', 'flex:1;height:44px;border-radius:22px;background:#E9E0CF;overflow:hidden');
      var fill = el('i', '', 'display:block;height:100%;width:0;border-radius:22px;background:' + r.color);
      track.appendChild(fill);
      var num = el('b', '', 'width:110px;text-align:right;font:800 84px/1 \'Bricolage Grotesque\';font-stretch:78%;color:' + C.night);
      row.appendChild(av); row.appendChild(track); row.appendChild(num); n.appendChild(row);
      return { row: row, fill: fill, num: num, r: r };
    });
    return {
      node: n,
      render: function (t, lt) {
        n.style.transform = 'translateY(' + (1 - easeOut(lt / 0.35)) * 80 + 'px)';
        n.style.opacity = clamp(lt / 0.2, 0, 1);
        rows.forEach(function (o, i) {
          var p = easeOut((lt - 0.25 - i * 0.12) / 1.1);
          var v = o.r.score * p;
          if (o.r.bump && lt > o.r.bump) v = o.r.score + 1;
          o.fill.style.width = (v / L.max * 100) + '%';
          o.num.textContent = Math.round(v);
          o.row.style.transform = o.r.bump && lt > o.r.bump ? 'scale(' + (1 + 0.06 * Math.max(0, 1 - (lt - o.r.bump) / 0.4)) + ')' : 'none';
        });
      }
    };
  };

  function idCard(kind) {
    var icon = {
      student: '<svg viewBox="0 0 100 100" width="120" height="120"><path d="M50 22 6 40l44 18 44-18z" fill="#170B33"/><path d="M24 50v18c0 7 12 12 26 12s26-5 26-12V50L50 61z" fill="#170B33"/><path d="M88 42v24" stroke="#170B33" stroke-width="5"/></svg>',
      license: '<svg viewBox="0 0 100 100" width="120" height="120"><path d="M16 60l8-22c2-5 5-7 10-7h32c5 0 8 2 10 7l8 22v18H16z" fill="#170B33"/><circle cx="30" cy="70" r="7" fill="#FFF6EA"/><circle cx="70" cy="70" r="7" fill="#FFF6EA"/><rect x="30" y="38" width="40" height="14" rx="3" fill="#FFF6EA"/></svg>',
      state: '<svg viewBox="0 0 100 100" width="120" height="120"><rect x="14" y="20" width="72" height="60" rx="10" fill="#170B33"/><circle cx="38" cy="46" r="10" fill="#FFF6EA"/><path d="M24 70c3-9 9-12 14-12s11 3 14 12" fill="#FFF6EA"/><rect x="58" y="38" width="20" height="6" rx="3" fill="#FFF6EA"/><rect x="58" y="52" width="16" height="6" rx="3" fill="#FFF6EA"/></svg>',
      passport: '<svg viewBox="0 0 100 100" width="120" height="120"><rect x="24" y="10" width="54" height="80" rx="8" fill="#170B33"/><circle cx="51" cy="44" r="15" fill="none" stroke="#FFF6EA" stroke-width="4"/><path d="M36 44h30M51 29c-7 8-7 22 0 30M51 29c7 8 7 22 0 30" stroke="#FFF6EA" stroke-width="3" fill="none"/><rect x="38" y="70" width="26" height="5" rx="2.5" fill="#FFF6EA"/></svg>'
    }[kind];
    var col = { student: C.sky, license: C.sun, state: C.mint, passport: C.bubble }[kind];
    return el('div', '', 'position:absolute;width:300px;height:200px;margin:-100px 0 0 -150px;border-radius:26px;background:' + col + ';border:7px solid ' + C.night + ';box-shadow:10px 10px 0 ' + C.night + ';display:flex;align-items:center;gap:16px;padding:0 22px',
      '<div style="width:120px;height:120px;flex:none">' + icon + '</div><div style="flex:1;display:grid;gap:14px"><i style="display:block;height:18px;border-radius:9px;background:#170B33;width:90%"></i><i style="display:block;height:18px;border-radius:9px;background:rgba(23,11,51,.45);width:70%"></i><i style="display:block;height:18px;border-radius:9px;background:rgba(23,11,51,.45);width:50%"></i></div>');
  }
  function mark(ok) {
    return el('div', '', 'position:absolute;width:120px;height:120px;margin:-60px 0 0 -60px', ok ?
      '<svg viewBox="0 0 100 100" width="120" height="120"><circle cx="50" cy="50" r="46" fill="#C8F03C" stroke="#170B33" stroke-width="7"/><path d="M28 52l15 15 30-32" stroke="#170B33" stroke-width="11" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>' :
      '<svg viewBox="0 0 100 100" width="120" height="120"><circle cx="50" cy="50" r="46" fill="#FF4FA3" stroke="#170B33" stroke-width="7"/><path d="M32 32l36 36M68 32 32 68" stroke="#170B33" stroke-width="11" stroke-linecap="round"/></svg>');
  }
  LAYERS.ids = function (L) {
    var n = el('div', '', 'position:absolute;inset:0');
    var items;
    if (L.mode === 'one') {
      var c1 = idCard('state'); c1.style.left = '360px'; c1.style.top = '380px'; n.appendChild(c1);
      var sig = el('div', '', 'position:absolute;left:150px;top:560px;width:420px;height:120px', '<svg viewBox="0 0 420 120" width="420" height="120"><path d="M10 80c30-50 50-60 60-20s-10 50 10 30 40-70 60-40 0 50 30 30 30-40 50-20 20 30 50 10 40-20 70-10" stroke="#170B33" stroke-width="9" fill="none" stroke-linecap="round" stroke-linejoin="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/></svg>');
      n.appendChild(sig);
      var ok1 = mark(true); ok1.style.left = '560px'; ok1.style.top = '250px'; n.appendChild(ok1);
      items = [{ n: c1, t: 0, rot: -5, s: 1.55 }, { n: ok1, t: L.ok || 1.4, rot: 0, s: 1.4 }];
      var path1 = sig.querySelector('path');
      return {
        node: n,
        render: function (t, lt) {
          items.forEach(function (o) { var k = popScale(lt, o.t, 0.34); o.n.style.transform = 'rotate(' + o.rot + 'deg) scale(' + (k * o.s) + ')'; o.n.style.opacity = lt < o.t ? 0 : 1; });
          path1.setAttribute('stroke-dashoffset', String(1 - easeInOut((lt - 0.35) / 0.9)));
        }
      };
    }
    if (L.mode === 'student') {
      var c = idCard('student'); c.style.left = '360px'; c.style.top = '400px'; n.appendChild(c);
      var x = mark(false); x.style.left = '500px'; x.style.top = '300px'; n.appendChild(x);
      items = [{ n: c, t: 0, rot: -6, s: 1.5 }, { n: x, t: L.x || 0.9, rot: 0, s: 1.6 }];
    } else {
      var ks = ['license', 'state', 'passport'];
      items = [];
      ks.forEach(function (k, i) {
        var cc = idCard(k); cc.style.left = '360px'; cc.style.top = (220 + i * 230) + 'px'; n.appendChild(cc);
        var m = mark(true); m.style.left = '540px'; m.style.top = (170 + i * 230) + 'px'; n.appendChild(m);
        items.push({ n: cc, t: 0.1 + i * 0.28, rot: [-4, 3, -2][i], s: 1.25 });
        items.push({ n: m, t: 0.55 + i * 0.28, rot: 0, s: 1 });
      });
    }
    return {
      node: n,
      render: function (t, lt) {
        items.forEach(function (o) { var k = popScale(lt, o.t, 0.34); o.n.style.transform = 'rotate(' + o.rot + 'deg) scale(' + (k * o.s) + ')'; o.n.style.opacity = lt < o.t ? 0 : 1; });
      }
    };
  };

  LAYERS.seats = function (L) {
    var n = el('div', '', 'position:absolute;left:0;right:0;top:' + (L.top || 300) + 'px;height:300px');
    var chair = function (col) { return '<svg viewBox="0 0 100 120" width="150" height="180"><rect x="18" y="8" width="64" height="56" rx="14" fill="' + col + '" stroke="#170B33" stroke-width="7"/><rect x="10" y="60" width="80" height="22" rx="8" fill="' + col + '" stroke="#170B33" stroke-width="7"/><path d="M20 82v32M80 82v32" stroke="#170B33" stroke-width="8" stroke-linecap="round"/></svg>'; };
    var cs = [0, 1, 2, 3].map(function (i) {
      var c = el('div', '', 'position:absolute;top:40px;left:' + (24 + i * 170) + 'px;width:150px;height:180px', chair(i === (L.saved || 2) ? C.celery : C.cream));
      n.appendChild(c); return c;
    });
    var h = sticker('heart', 130); n.appendChild(h);
    var hx = 24 + (L.saved || 2) * 170 + 75;
    return {
      node: n,
      render: function (t, lt) {
        cs.forEach(function (c, i) { var k = popScale(lt, 0.05 + i * 0.08, 0.3); c.style.transform = 'scale(' + k + ')' + (i === (L.saved || 2) && lt > (L.heart || 0.8) ? ' translateY(' + (-10 * Math.sin(Math.min(1, (lt - (L.heart || 0.8)) / 0.3) * Math.PI)) + 'px)' : ''); });
        placeSticker(h, { x: hx, y: 30, t: L.heart || 0.8, rot: 10 }, lt);
      }
    };
  };

  LAYERS.badge = function (L) {
    var n = el('div', '', 'position:absolute;left:' + L.x + 'px;top:' + L.y + 'px;width:0;height:0');
    var b = el('div', '', 'position:absolute;width:' + (L.size || 190) + 'px;height:' + (L.size || 190) + 'px;margin:-' + ((L.size || 190) / 2) + 'px 0 0 -' + ((L.size || 190) / 2) + 'px;border-radius:50%;background:' + (L.color || C.celery) + ';border:9px solid ' + C.night + ';box-shadow:12px 12px 0 ' + C.night + ';display:grid;place-items:center;font:800 ' + Math.round((L.size || 190) * 0.62) + 'px/1 \'Bricolage Grotesque\';font-stretch:78%;color:' + C.night, String(L.n));
    n.appendChild(b);
    return { node: n, render: function (t, lt) { var k = popScale(lt, L.at || 0.05, 0.36); b.style.transform = 'rotate(' + ((L.rot || -8) + Math.sin(lt * 3) * 2) + 'deg) scale(' + k + ')'; } };
  };

  // A week as seven dots: five filled with checks, the weekend two crossed out (no day letters: they differ by language).
  LAYERS.week = function (L) {
    var n = el('div', '', 'position:absolute;inset:0;background:' + (L.bg || C.night));
    n.style.backgroundImage = 'radial-gradient(rgba(255,246,234,.10) 3px, transparent 3.5px)';
    n.style.backgroundSize = '44px 44px';
    var top = L.top || 470, size = 84, gap = 10, left = (W - (7 * size + 6 * gap)) / 2;
    var ds = [0, 1, 2, 3, 4, 5, 6].map(function (i) {
      var on = i < 5;
      var c = el('div', '', 'position:absolute;top:' + top + 'px;left:' + (left + i * (size + gap)) + 'px;width:' + size + 'px;height:' + size + 'px;border-radius:50%;border:7px solid ' + C.cream + ';background:' + (on ? C.celery : 'transparent') + ';display:grid;place-items:center',
        on ? '<svg viewBox="0 0 40 40" width="44" height="44"><path d="M9 21l7 7 15-16" stroke="#170B33" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>' : '<svg viewBox="0 0 40 40" width="44" height="44"><path d="M10 10l20 20M30 10 10 30" stroke="#FF4FA3" stroke-width="6" stroke-linecap="round"/></svg>');
      n.appendChild(c); return c;
    });
    var tr = sticker('train', 200); n.appendChild(tr);
    return {
      node: n,
      render: function (t, lt) {
        ds.forEach(function (c, i) { var k = popScale(lt, 0.1 + i * 0.11, 0.3); c.style.transform = 'scale(' + k + ')'; });
        placeSticker(tr, { x: 250 + easeOut((lt - 0.2) / 1.4) * 220, y: top - 170, t: 0.15, rot: -6 }, lt);
      }
    };
  };

  LAYERS.stickers = function (L) {
    var n = el('div', '', 'position:absolute;inset:0;pointer-events:none');
    var items = L.items.map(function (it) { var s = sticker(it.id, it.size || 190); n.appendChild(s); return { s: s, it: it }; });
    return { node: n, render: function (t, lt) { items.forEach(function (o) { placeSticker(o.s, o.it, lt); }); } };
  };

  LAYERS.burst = function (L) {
    var n = el('div', '', 'position:absolute;inset:0;pointer-events:none');
    var ids = L.ids, cx = L.x || 360, cy = L.y || 420;
    var items = ids.map(function (id, i) {
      var a = (i / ids.length) * Math.PI * 2 + 0.4, r = 200 + (i % 3) * 70;
      var s = sticker(id, 120 + (i % 3) * 30); n.appendChild(s);
      return { s: s, it: { id: id, x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r * 1.15, t: (L.at || 0) + i * 0.06, rot: (i % 2 ? 1 : -1) * (8 + i * 3), float: true } };
    });
    return { node: n, render: function (t, lt) { items.forEach(function (o) { placeSticker(o.s, o.it, lt); }); } };
  };

  // ------------------------------------------------------------------ build + render
  function build(clip, assets) {
    A = assets;
    var stage = d.getElementById('stage');
    stage.textContent = '';
    shots = []; dur = clip.duration;
    var acc = 0;
    clip.shots.forEach(function (sh, i) {
      var root = el('div', '', 'position:absolute;inset:0;overflow:hidden');
      var layers = sh.layers.map(function (L) { var o = LAYERS[L.type](L); root.appendChild(o.node); return o; });
      stage.appendChild(root);
      shots.push({ root: root, layers: layers, t0: acc, t1: acc + sh.seconds, sh: sh, i: i });
      acc += sh.seconds;
    });
    dur = acc;
    watermark = el('div', '', 'position:absolute;z-index:50;left:34px;bottom:44px;padding:6px 14px;border-radius:999px;background:' + C.tang + ';border:3px solid ' + C.night + ';font:800 22px/1 \'Atkinson Hyperlegible Next\';letter-spacing:.1em;color:' + C.night, 'DEMO');
    stage.appendChild(watermark);
    return dur;
  }
  function render(t, opts) {
    opts = opts || {};
    var cur = shots[shots.length - 1];
    for (var i = 0; i < shots.length; i++) if (t >= shots[i].t0 && t < shots[i].t1) { cur = shots[i]; break; }
    shots.forEach(function (s) { s.root.style.display = s === cur ? 'block' : 'none'; });
    var lt = t - cur.t0, sd = cur.t1 - cur.t0;
    // transitions at the head of a shot: whip (slide with blur) or flash (2 white frames)
    var tr = cur.sh.transition, k = lt / 0.2;
    cur.root.style.transform = ''; cur.root.style.filter = '';
    if (tr === 'whip' && k < 1) { cur.root.style.transform = 'translateX(' + ((1 - easeOut(k)) * 260) + 'px)'; cur.root.style.filter = 'blur(' + ((1 - k) * 14).toFixed(1) + 'px)'; }
    if (tr === 'punch' && k < 1) { cur.root.style.transform = 'scale(' + (1.12 - 0.12 * easeOut(k)) + ')'; }
    cur.layers.forEach(function (L) { L.render(t, lt, sd); });
    var flash = d.getElementById('flash');
    flash.style.opacity = tr === 'flash' && lt < 0.07 ? 0.85 : 0;
    watermark.style.display = opts.poster ? 'none' : 'block';
  }
  w.STAGE = { build: build, render: render, W: W, H: H, colors: C };
})(window);
