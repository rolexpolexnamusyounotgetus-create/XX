/*! YDSC · assets/boot.js (F0). The first script in <head>, before the stylesheets (classic, no defer), so it
 * never waits for CSS and runs before the first paint:
 *  1. adds .js to <html>;
 *  2. applies the saved theme (data-theme="auto|light|dark") and motion choice (data-motion="paused"), so a
 *     reload never flashes the wrong theme. Same keys YSD.store writes (JSON under "ysd:"): ysd:prefs:theme,
 *     ysd:prefs:motion. Storage can be blocked (private windows): every read is wrapped;
 *  3. preloads the two critical fonts (BRIEF §3.3) on http(s). On file:// Chrome refuses font loads (CORS,
 *     console errors), so there it skips the preloads and points the font tokens at the metric-matched
 *     fallback faces instead: same layout, no errors, no request.
 * It lives outside assets/js on purpose: it is the only script that must run before the CSS paints. */
(function (d) {
  var r = d.documentElement, t, m;
  function read(k) {
    try {
      var v = window.localStorage.getItem('ysd:prefs:' + k);
      if (v == null) return '';
      try { return JSON.parse(v); } catch (e) { return v; }
    } catch (e) { return ''; }
  }
  r.className = (r.className ? r.className + ' ' : '') + 'js';
  t = read('theme');
  r.setAttribute('data-theme', t === 'light' || t === 'dark' ? t : 'auto');
  m = read('motion');
  if (m === 'paused') r.setAttribute('data-motion', 'paused');

  var me = d.currentScript, src = (me && me.src) || '', base = src.replace(/assets\/boot\.js(?:[?#].*)?$/, '');
  if (/^https?:/i.test(location.protocol)) {
    ['bricolage-800-wdth', 'atkinson-next-var'].forEach(function (f) {
      var l = d.createElement('link');
      l.rel = 'preload'; l.as = 'font'; l.type = 'font/woff2'; l.crossOrigin = 'anonymous';
      l.href = base + 'assets/fonts/' + f + '.woff2';
      (me && me.parentNode ? me.parentNode : d.head).insertBefore(l, me ? me.nextSibling : null);
    });
  } else if (location.protocol === 'file:') {
    r.setAttribute('data-protocol', 'file');
    var fb = { '--font-display': '"Bricolage fb", sans-serif', '--font-display-76': '"Bricolage fb 76", sans-serif',
      '--font-display-84': '"Bricolage fb 84", sans-serif', '--font-display-88': '"Bricolage fb 84", sans-serif',
      '--font-body': '"Atkinson fb", system-ui, sans-serif', '--font-hand': '"Bradley Hand", "Segoe Print", "Atkinson fb", sans-serif',
      '--ysd-font-display': '"Bricolage fb", sans-serif', '--ysd-font-body': '"Atkinson fb", sans-serif',
      '--ysd-card-font-display': '"Bricolage fb", sans-serif', '--ysd-card-font-body': '"Atkinson fb", sans-serif' };
    for (var k in fb) r.style.setProperty(k, fb[k]);
  }
})(document);
