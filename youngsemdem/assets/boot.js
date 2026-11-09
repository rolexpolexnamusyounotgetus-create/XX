/*! YDSC · assets/boot.js (F0). Runs in <head> before the first paint (classic script, no defer):
 * adds .js to <html>, applies the saved theme (data-theme="auto|light|dark") and the saved motion
 * preference (data-motion="paused"), so a reload never flashes the wrong theme. Reads the same keys
 * YSD.store writes (JSON values under the "ysd:" prefix): ysd:prefs:theme, ysd:prefs:motion.
 * Storage can be blocked (private windows): every read is wrapped, and the defaults still render.
 * It lives outside assets/js on purpose: it is the only script that must run before the CSS paints. */
(function (d) {
  var r = d.documentElement, t = 'auto', m = '';
  function read(k) {
    try {
      var v = window.localStorage.getItem('ysd:prefs:' + k);
      if (v == null) return '';
      try { return JSON.parse(v); } catch (e) { return v; }
    } catch (e) { return ''; }
  }
  r.className = (r.className ? r.className + ' ' : '') + 'js';
  t = read('theme');
  if (t !== 'light' && t !== 'dark') t = 'auto';
  r.setAttribute('data-theme', t);
  m = read('motion');
  if (m === 'paused') r.setAttribute('data-motion', 'paused');
})(document);
