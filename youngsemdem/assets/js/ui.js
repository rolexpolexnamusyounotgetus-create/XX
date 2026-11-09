/*! YDSC · assets/js/ui.js (F0). Shared UI behaviour for every page (BRIEF §7.7).
 *
 * Classic script, loaded by the scripts partial after the infra stack and data/slices/core.js.
 * Tolerates missing siblings (config, store, share, track, data), renders untrusted text with
 * textContent, and emits ysd:* events through YSD.emit. Pages work without it: every hook here is
 * an enhancement of static markup (styleguide.html shows each markup contract).
 *
 * API
 *   YSD.lang                          'en' | 'es' (from <html lang>)
 *   YSD.t(key, vars?, lang?)          string lookup: 'cta.join' (data/strings.js or a slice) or
 *                                     'page:key' (data/pages/<page>.js). Honours showFrom, expires +
 *                                     next, demo-only entries and config tokens. '' when missing.
 *   YSD.t.plural(key, n, vars?)       key.one when n === 1, else key.other, with {count}
 *   YSD.t.has(key)
 *   YSD.fmt.date(iso, {weekday, time, year})  'Thu, Nov 19 · 7 pm' / 'jue 19 de nov · 7 p. m.' (New York time)
 *   YSD.fmt.time(iso)                 '7 pm', '10:30 am'
 *   YSD.fmt.when(start, end)          'Thu, Nov 19 · 7 to 9 pm'
 *   YSD.fmt.days(ymd)                 whole days from today (New York) to 'YYYY-MM-DD'
 *   YSD.ui.toast(text, {tone, timeout})        tone 'success' | 'info' | 'error'; via the role=status region
 *   YSD.ui.sheet.open(el | id, {opener}) / .close(el?) / .current()   native <dialog>, focus returns
 *   YSD.ui.menu.open() / .close({focus}) / .toggle() / .isOpen()
 *   YSD.ui.theme.get() / .set('auto'|'light'|'dark') / .cycle()        stored in ysd:prefs:theme
 *   YSD.ui.motion.paused() / .toggle() / .set(bool)                    stored in ysd:prefs:motion
 *   YSD.ui.countdown(el)              reads data-countdown="YYYY-MM-DD" (New York days)
 *   YSD.ui.confetti(el)               CSS burst < 1 s; no-op under reduced motion, Pause motion,
 *                                     or inside .band--serious / [data-tone="calm"] / [data-civic]
 *   YSD.ui.prettyLink(url)            no protocol, no index.html, no utm_* or click ids; keeps ref
 *   YSD.ui.langHref(lang?)            URL of this page in the other language (es/ tree)
 *   YSD.ui.stickers(root)             draws data/stickers.js art into empty [data-sticker] elements
 *   YSD.ui.stickerFacts(root)         wires button[data-sticker]: wiggle + sourced fact toast
 *   YSD.ui.sticker(id) / .stickerSvg(id) / .stickerDataUrl(id)   art for canvas (W5 cards)
 *   YSD.ui.fill(template, vars)       delegates to YSD.fill (config.js): {link} and {url}, any {key}
 *   YSD.ui.form.errors(form, {field: code}, {messages}) / .clear(form)  aria-invalid, describedby, summary
 *   YSD.ui.share(opts?)               native share with this page's share.<page>.* text, else copy
 *   YSD.ui.stopLive()                 stops demo counter ticks (also called on load)
 *   YSD.ui.joinCta()                  header [data-join-cta]: "Join free" -> join.html#join-form, or, once
 *                                     YSD.members.current() exists, "Your card" (cta.yourCard) -> join.html#card.
 *                                     Runs on load, on ysd:joined and on ysd:forgot.
 *   YSD.ui.ready(fn)
 * Declarative hooks (wired on DOMContentLoaded): [data-theme-toggle], [data-motion-toggle],
 * [data-menu-toggle], [data-sheet-open="id"], [data-sheet-close], [data-countdown], [data-rotor],
 * [data-ticker], [data-sticker], [data-lang-link], [data-share], [data-cfg-href="links.x"],
 * [data-social], [data-year], [data-reload], [data-join-cta].
 * There is no AI feature here, and no network call.
 */
(function (w, d) {
  'use strict';
  var YSD = w.YSD = w.YSD || {};
  var html = d.documentElement;
  var TZ = 'America/New_York';
  var reduceMQ = w.matchMedia ? w.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  function cfg(p, f) { return typeof YSD.cfg === 'function' ? YSD.cfg(p, f) : f; }
  function emit(n, det) { if (typeof YSD.emit === 'function') YSD.emit(n, det); }
  function track(e, p) { try { if (typeof YSD.track === 'function') YSD.track(e, p); } catch (x) {} }
  function data() { return w.YSD_DATA || {}; }
  function $$(sel, root) { return Array.prototype.slice.call((root || d).querySelectorAll(sel)); }
  function store(key, val) {
    var s = YSD.store;
    if (arguments.length < 2) {
      if (s && s.get) return s.get(key, null);
      try { var raw = w.localStorage.getItem('ysd:' + key); return raw == null ? null : JSON.parse(raw); } catch (e) { return null; }
    }
    if (s && s.set) return s.set(key, val);
    try { w.localStorage.setItem('ysd:' + key, JSON.stringify(val)); } catch (e) {}
    return val;
  }

  YSD.lang = String(html.getAttribute('lang') || 'en').slice(0, 2).toLowerCase() === 'es' ? 'es' : 'en';

  /* ------------------------------------------------------------------ strings */
  function entry(key) {
    var k = String(key || ''), i = k.indexOf(':');
    if (i > 0) {
      var pages = data().pages || {}, P = pages[k.slice(0, i)];
      return P ? P[k.slice(i + 1)] : undefined;
    }
    var S = data().strings;
    return S && S.entries ? S.entries[k] : undefined;
  }
  function t(key, vars, lang) {
    var e = entry(key), L = lang || YSD.lang;
    if (!e) { if (YSD.log) YSD.log('ui: missing string', key); return ''; }
    if (typeof e === 'string') return YSD.fill ? YSD.fill(e, vars || {}) : e;
    var now = Date.now();
    if (e.expires && now >= Date.parse(e.expires)) return e.next ? t(e.next, vars, L) : '';
    if (e.showFrom && now < Date.parse(e.showFrom)) return '';
    if (e.demo && cfg('demo', true) === false) return '';
    var s = e[L] != null ? e[L] : (e.en || '');
    var S = data().strings || {}, tokens = S.tokens || {};
    return String(s).replace(/\{(\w+)\}/g, function (m, k) {
      if (vars && vars[k] != null) return String(vars[k]);
      if ((k === 'link' || k === 'url') && vars && (vars.link || vars.url)) return String(vars.link || vars.url);
      var tk = tokens[k];
      if (!tk) return m;
      var v = tk.from ? cfg(tk.from, '') : '';
      return v !== '' && v != null ? String(v) : ((tk.fallback && (tk.fallback[L] || tk.fallback.en)) || m);
    });
  }
  t.plural = function (key, n, vars) {
    var v = {}; for (var k in vars || {}) v[k] = vars[k];
    v.count = n;
    return t(key + (Number(n) === 1 ? '.one' : '.other'), v);
  };
  t.has = function (key) { return !!entry(key); };
  YSD.t = t;

  /* ------------------------------------------------------------------ dates (New York) */
  var DTF = {};
  function dtf(lang, opts) {
    var k = lang + JSON.stringify(opts);
    if (!DTF[k]) { try { DTF[k] = new Intl.DateTimeFormat(lang === 'es' ? 'es-US' : 'en-US', opts); } catch (e) { DTF[k] = null; } }
    return DTF[k];
  }
  function toDate(iso) {
    if (iso instanceof Date) return iso;
    var s = String(iso || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T12:00:00-05:00'); // all-day: noon NY keeps the day
    return new Date(s);
  }
  function parts(iso, lang) {
    var f = dtf(lang, { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
    var o = {};
    if (!f) return o;
    f.formatToParts(toDate(iso)).forEach(function (p) { o[p.type] = p.value; });
    o.weekday = String(o.weekday || '').replace(/\.$/, '');
    o.month = String(o.month || '').replace(/\.$/, '');
    o.ampm = /p/i.test(o.dayPeriod || '') ? 'pm' : 'am';
    return o;
  }
  function pattern(key, fallback, L) { var s = t(key, null, L); return s || fallback; }
  function fmtTime(iso, opts) {
    var L = (opts && opts.lang) || YSD.lang, p = parts(iso, L);
    var ampm = pattern('format.ampm.' + p.ampm, L === 'es' ? (p.ampm === 'pm' ? 'p. m.' : 'a. m.') : p.ampm, L);
    var hm = p.hour + (p.minute && p.minute !== '00' ? ':' + p.minute : '');
    return opts && opts.bare ? hm : hm + ' ' + ampm;
  }
  function fmtDate(iso, opts) {
    opts = opts || {};
    var L = opts.lang || YSD.lang, p = parts(iso, L);
    var key = opts.year ? 'format.dateYear' : 'format.date';
    var fb = L === 'es' ? (opts.year ? '{weekday} {day} de {month} de {year}' : '{weekday} {day} de {month}') : (opts.year ? '{weekday}, {month} {day}, {year}' : '{weekday}, {month} {day}');
    var pat = pattern(key, fb, L);
    if (opts.weekday === false) pat = pat.replace(/\{weekday\},?\s*/, '');
    var s = pat.replace('{weekday}', p.weekday).replace('{month}', p.month).replace('{day}', p.day).replace('{year}', p.year);
    if (opts.time) s += ' · ' + fmtTime(iso, { lang: L });
    return s;
  }
  function fmtWhen(start, end, opts) {
    var L = (opts && opts.lang) || YSD.lang;
    if (!end) return fmtDate(start, { time: !/^\d{4}-\d{2}-\d{2}$/.test(String(start)), lang: L });
    var a = parts(start, L), b = parts(end, L);
    var sameDay = a.year === b.year && a.month === b.month && a.day === b.day;
    var range = pattern('format.timeRange', L === 'es' ? 'de {start} a {end}' : '{start} to {end}', L);
    if (!sameDay) return fmtDate(start, { time: true, lang: L }) + ' – ' + fmtDate(end, { time: true, lang: L });
    var s = a.ampm === b.ampm ? fmtTime(start, { lang: L, bare: true }) : fmtTime(start, { lang: L });
    return fmtDate(start, { lang: L }) + ' · ' + range.replace('{start}', s).replace('{end}', fmtTime(end, { lang: L }));
  }
  function nyYmd(date) {
    var f = dtf('en', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
    if (!f) { var x = date || new Date(); return [x.getFullYear(), x.getMonth() + 1, x.getDate()]; }
    var o = {}; f.formatToParts(date || new Date()).forEach(function (p) { o[p.type] = p.value; });
    return [+o.year, +o.month, +o.day];
  }
  function days(ymd) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
    if (!m) return NaN;
    var n = nyYmd(new Date());
    return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(n[0], n[1] - 1, n[2])) / 864e5);
  }
  YSD.fmt = { date: fmtDate, time: fmtTime, when: fmtWhen, days: days };

  var ui = YSD.ui = YSD.ui || {};
  ui.fill = function (tpl, vars) { return typeof YSD.fill === 'function' ? YSD.fill(tpl, vars) : String(tpl == null ? '' : tpl); };
  ui.ready = function (fn) { if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', fn); else fn(); };

  /* ------------------------------------------------------------------ toast */
  var toastTimer = 0;
  function region() {
    var r = d.querySelector('[data-toast-region]');
    if (!r) {
      r = d.createElement('div');
      r.className = 'toast-region'; r.setAttribute('role', 'status'); r.setAttribute('aria-live', 'polite'); r.setAttribute('data-toast-region', '');
      d.body.appendChild(r);
    }
    return r;
  }
  ui.toast = function (text, opts) {
    opts = opts || {};
    var r = region(), el = d.createElement('p');
    el.className = 'toast';
    if (opts.tone) el.setAttribute('data-tone', opts.tone);
    el.textContent = String(text == null ? '' : text);
    r.textContent = '';
    r.appendChild(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.setAttribute('data-state', 'out');
      setTimeout(function () { if (el.parentNode === r) r.removeChild(el); }, 260);
    }, opts.timeout || Math.max(4200, Math.min(9000, el.textContent.length * 60)));
    emit('toast', { text: el.textContent, tone: opts.tone || 'success' });
    return el;
  };

  /* ------------------------------------------------------------------ sheet (<dialog>) */
  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  var openers = typeof WeakMap === 'function' ? new WeakMap() : null;
  function dialogEl(x) { return typeof x === 'string' ? d.getElementById(x.replace(/^#/, '')) : x; }
  ui.sheet = {
    open: function (x, opts) {
      var dlg = dialogEl(x);
      if (!dlg) return null;
      var opener = (opts && opts.opener) || d.activeElement;
      if (openers && opener) openers.set(dlg, opener);
      if (!dlg.__ysdWired) {
        dlg.__ysdWired = true;
        dlg.addEventListener('close', function () {
          var o = openers && openers.get(dlg);
          emit('sheet-close', { id: dlg.id });
          if (o && typeof o.focus === 'function' && d.contains(o)) setTimeout(function () { o.focus(); }, 0);
        });
        dlg.addEventListener('click', function (e) { if (e.target === dlg) ui.sheet.close(dlg); }); // backdrop
      }
      if (typeof dlg.showModal === 'function') { if (!dlg.open) dlg.showModal(); }
      else dlg.setAttribute('open', '');
      var first = dlg.querySelector('[autofocus]') || dlg.querySelector('.sheet__body ' + FOCUSABLE.split(', ').join(', .sheet__body ')) || dlg.querySelector(FOCUSABLE);
      if (first) first.focus();
      emit('sheet-open', { id: dlg.id });
      return dlg;
    },
    close: function (x) {
      var dlg = dialogEl(x) || d.querySelector('dialog[open]');
      if (!dlg) return;
      if (typeof dlg.close === 'function') dlg.close(); else { dlg.removeAttribute('open'); dlg.dispatchEvent(new Event('close')); }
    },
    current: function () { return d.querySelector('dialog[open]'); }
  };

  /* ------------------------------------------------------------------ menu */
  function menuParts() {
    var btn = d.querySelector('[data-menu-toggle]');
    var panel = btn ? d.getElementById(btn.getAttribute('aria-controls')) : null;
    return { btn: btn, panel: panel };
  }
  ui.menu = {
    isOpen: function () { var m = menuParts(); return !!(m.btn && m.btn.getAttribute('aria-expanded') === 'true'); },
    open: function () {
      var m = menuParts(); if (!m.btn || !m.panel) return;
      m.panel.hidden = false; m.btn.setAttribute('aria-expanded', 'true');
      emit('menu', { open: true });
    },
    close: function (o) {
      var m = menuParts(); if (!m.btn || !m.panel || m.panel.hidden) return;
      m.panel.hidden = true; m.btn.setAttribute('aria-expanded', 'false');
      if (o && o.focus) m.btn.focus();
      emit('menu', { open: false });
    },
    toggle: function () { if (ui.menu.isOpen()) ui.menu.close(); else ui.menu.open(); }
  };

  /* ------------------------------------------------------------------ theme */
  var MODES = ['auto', 'light', 'dark'];
  function themeLabel(mode) { return t('a11y.theme' + mode.charAt(0).toUpperCase() + mode.slice(1)) || mode; }
  function paintTheme(mode) {
    html.setAttribute('data-theme', mode);
    $$('[data-theme-toggle]').forEach(function (b) {
      b.setAttribute('data-mode', mode);
      var lab = b.querySelector('[data-theme-label]');
      if (lab) lab.textContent = themeLabel(mode);
      var aria = t('a11y.themeChange', { mode: themeLabel(mode) });
      if (aria) b.setAttribute('aria-label', aria);
    });
  }
  ui.theme = {
    get: function () { var m = html.getAttribute('data-theme'); return MODES.indexOf(m) >= 0 ? m : 'auto'; },
    set: function (mode) {
      if (MODES.indexOf(mode) < 0) mode = 'auto';
      store('prefs:theme', mode);
      paintTheme(mode);
      emit('theme', { mode: mode });
      track('theme', { mode: mode });
      return mode;
    },
    cycle: function () { return ui.theme.set(MODES[(MODES.indexOf(ui.theme.get()) + 1) % MODES.length]); }
  };

  /* ------------------------------------------------------------------ motion */
  var rotors = [];
  function paintMotion() {
    var p = html.getAttribute('data-motion') === 'paused';
    $$('[data-motion-toggle]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(p));
      var lab = b.querySelector('[data-motion-label]') || b;
      var txt = t(p ? 'cta.playMotion' : 'cta.pauseMotion');
      if (txt) lab.textContent = txt;
    });
  }
  // Cross-document view transitions: boot.js injects the rule on http(s) unless motion was paused at load;
  // this keeps it in step with the Pause motion toggle afterwards. Never on file:// (aborted-transition errors).
  var VT_RULE = '@media (prefers-reduced-motion:no-preference){@view-transition{navigation:auto}}';
  function viewTransitions(on) {
    if (!/^https?:$/i.test(w.location.protocol)) return;
    var st = d.querySelector('style[data-view-transition]');
    if (!st && on) {
      st = d.createElement('style');
      st.setAttribute('data-view-transition', '');
      st.textContent = VT_RULE;
      d.head.appendChild(st);
    }
    if (st) st.disabled = !on;
  }
  ui.motion = {
    paused: function () { return reduceMQ.matches || html.getAttribute('data-motion') === 'paused'; },
    set: function (paused) {
      if (paused) html.setAttribute('data-motion', 'paused'); else html.removeAttribute('data-motion');
      store('prefs:motion', paused ? 'paused' : 'on');
      viewTransitions(!paused);
      paintMotion();
      rotors.forEach(function (r) { if (paused) r.stop(); else r.start(); });
      emit('motion', { paused: !!paused });
      return !!paused;
    },
    toggle: function () { return ui.motion.set(html.getAttribute('data-motion') !== 'paused'); }
  };

  /* ------------------------------------------------------------------ rotor */
  function Rotor(el) {
    var items = $$('.rotor__item', el), idx = 0, loops = 0, timer = 0;
    if (items.length < 2) return null;
    el.setAttribute('data-ready', '');
    items[0].setAttribute('data-active', '');
    function step() {
      if (ui.motion.paused()) return;
      items[idx].removeAttribute('data-active');
      idx = (idx + 1) % items.length;
      if (idx === 0) loops++;
      items[idx].setAttribute('data-active', '');
      if (loops >= 4 && idx === 0) return; // stops after 4 loops, on the first phrase
      timer = setTimeout(step, 2600);
    }
    return {
      start: function () { clearTimeout(timer); if (!ui.motion.paused() && !(loops >= 4)) timer = setTimeout(step, 2600); },
      stop: function () { clearTimeout(timer); }
    };
  }

  /* ------------------------------------------------------------------ ticker */
  function ticker(el) {
    if (el.hasAttribute('data-ready')) return;
    var track = el.querySelector('.ticker__track');
    if (!track) return;
    $$(':scope > li', track).forEach(function (li) {
      var c = li.cloneNode(true);
      c.setAttribute('aria-hidden', 'true');
      $$('[id]', c).forEach(function (n) { n.removeAttribute('id'); });
      c.removeAttribute('data-t');
      track.appendChild(c);
    });
    el.setAttribute('data-ready', '');
  }

  /* ------------------------------------------------------------------ countdown */
  ui.countdown = function (el) {
    if (!el) return null;
    var target = el.getAttribute('data-countdown'), n = days(target);
    if (isNaN(n)) return null;
    var num = el.querySelector('[data-countdown-n]'), unit = el.querySelector('[data-countdown-unit]');
    if (n < 0) {
      el.setAttribute('data-state', 'done');
      if (el.hasAttribute('data-countdown-hide')) el.hidden = true;
      return n;
    }
    el.setAttribute('data-state', n === 0 ? 'today' : 'counting');
    if (num) num.textContent = String(n);
    var base = el.getAttribute('data-countdown-key') || 'count.daysLeft';
    var label = n === 0 ? t('count.today') : t.plural(base, n);
    if (unit) {
      // unit shows the label without the number ("days left"): strip the count we already show
      var u = el.getAttribute('data-countdown-unit-key');
      unit.textContent = u ? t.plural(u, n) : String(label).replace(String(n), '').replace(/\s{2,}/g, ' ').trim() || label;
    }
    var sr = el.querySelector('[data-countdown-sr]');
    if (sr) sr.textContent = label;
    return n;
  };

  /* ------------------------------------------------------------------ confetti */
  var COLORS = ['#C8F03C', '#6A2BFF', '#FF7AC6', '#4FD6FF', '#FF8B3D', '#FFD23F'];
  ui.confetti = function (el) {
    if (ui.motion.paused()) return false;
    if (el && el.closest && el.closest('.band--serious, [data-tone="calm"], [data-tone="serious"], [data-civic]')) return false;
    var r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : { left: w.innerWidth / 2, top: w.innerHeight / 2, width: 0, height: 0 };
    var box = d.createElement('div');
    box.className = 'confetti'; box.setAttribute('aria-hidden', 'true');
    box.style.left = (r.left + r.width / 2) + 'px'; box.style.top = (r.top + r.height / 2) + 'px';
    for (var i = 0; i < 26; i++) {
      var b = d.createElement('i'), a = (Math.PI * 2 * i) / 26 + Math.random() * .4, dist = 70 + Math.random() * 110;
      b.className = 'confetti__bit';
      b.style.setProperty('--c', COLORS[i % COLORS.length]);
      b.style.setProperty('--dx', Math.round(Math.cos(a) * dist) + 'px');
      b.style.setProperty('--dy', Math.round(Math.sin(a) * dist + 60) + 'px');
      b.style.setProperty('--r', Math.round(Math.random() * 540 - 270) + 'deg');
      box.appendChild(b);
    }
    d.body.appendChild(box);
    setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 1000);
    return true;
  };

  /* ------------------------------------------------------------------ links */
  ui.prettyLink = function (url) {
    var s = String(url == null ? '' : url).trim(), hash = '', query = '';
    var hi = s.indexOf('#'); if (hi >= 0) { hash = s.slice(hi); s = s.slice(0, hi); }
    var qi = s.indexOf('?'); if (qi >= 0) { query = s.slice(qi + 1); s = s.slice(0, qi); }
    s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^\/\/+/, '');
    s = s.replace(/(^|\/)index\.html?$/i, '$1');
    var keep = query.split('&').filter(function (kv) {
      if (!kv) return false;
      var k = decodeURIComponent(kv.split('=')[0] || '').toLowerCase();
      return !/^utm_/.test(k) && ['fbclid', 'gclid', 'dclid', 'msclkid', 'mc_eid', 'igshid', 'twclid', 'ttclid'].indexOf(k) < 0;
    });
    if (/^[^/]+\/$/.test(s)) s = s.slice(0, -1); // bare host: drop the lone slash
    return s + (keep.length ? '?' + keep.join('&') : '') + hash;
  };
  ui.langHref = function (lang) {
    var to = lang || (YSD.lang === 'es' ? 'en' : 'es');
    if (html.getAttribute('data-es') === 'none') return (YSD.root || '') + (to === 'es' ? 'es/index.html' : 'index.html'); // page has no twin
    var root = YSD.root || '', here = String(w.location.href).split('#')[0].split('?')[0];
    var rel = root && here.indexOf(root) === 0 ? here.slice(root.length) : '';
    if (rel === '' || /\/$/.test(rel)) rel += 'index.html';
    var isEs = /^es\//.test(rel);
    if (to === 'es' && !isEs) rel = 'es/' + rel;
    if (to === 'en' && isEs) rel = rel.slice(3);
    return root ? root + rel : (to === 'es' ? 'es/index.html' : '../index.html');
  };

  /* ------------------------------------------------------------------ stickers */
  function stickerItem(id) {
    var S = data().stickers, items = (S && S.items) || [];
    for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i];
    return null;
  }
  ui.sticker = stickerItem;
  ui.stickerSvg = function (id) { var s = stickerItem(id); return s ? s.svg : ''; };
  ui.stickerDataUrl = function (id) { var s = stickerItem(id); return s ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s.svg) : ''; };
  ui.stickers = function (root) {
    $$('[data-sticker]', root).forEach(function (el) {
      if (el.querySelector('svg')) return;
      var s = stickerItem(el.getAttribute('data-sticker'));
      if (!s) return;
      el.insertAdjacentHTML('afterbegin', s.svg.replace('<svg ', '<svg aria-hidden="true" focusable="false" ')); // trusted: our own data file
      if (el.tagName === 'BUTTON' && !el.getAttribute('aria-label')) {
        var label = t('a11y.stickerTap', { name: s.name[YSD.lang] || s.name.en });
        if (label) el.setAttribute('aria-label', label);
      }
    });
  };
  function factText(s) {
    var f = s.fact;
    if (s.expires && Date.now() >= Date.parse(s.expires) && s.next) f = s.next;
    var txt = (f && (f[YSD.lang] || f.en)) || '';
    var lab = s.source && s.source.label;
    lab = lab && typeof lab === 'object' ? (lab[YSD.lang] || lab.en || '') : (lab || ''); // {en, es}; plain strings still work
    if (s.kind === 'fact' && lab) txt += ' ' + (t('a11y.source', { label: lab }) || ((YSD.lang === 'es' ? 'Fuente: ' : 'Source: ') + lab));
    return txt;
  }
  ui.stickerFacts = function (root) {
    $$('button[data-sticker]', root).forEach(function (b) {
      if (b.__ysdFact) return;
      b.__ysdFact = true;
      b.addEventListener('click', function () {
        var s = stickerItem(b.getAttribute('data-sticker'));
        if (!s) return;
        b.removeAttribute('data-state'); void b.offsetWidth; b.setAttribute('data-state', 'wiggle');
        setTimeout(function () { b.removeAttribute('data-state'); }, 650);
        ui.toast(factText(s), { tone: 'info' });
        track('sticker_fact', { id: s.id });
        emit('sticker-fact', { id: s.id });
      });
    });
  };

  /* ------------------------------------------------------------------ forms */
  function fieldOf(control) { return control.closest('.field') || control.parentNode; }
  ui.form = {
    clear: function (form) {
      $$('[aria-invalid="true"]', form).forEach(function (c) {
        c.removeAttribute('aria-invalid');
        var err = fieldOf(c).querySelector('.field__error');
        if (err) { err.textContent = ''; err.hidden = true; }
      });
      var sum = form.querySelector('.form__summary'); if (sum) sum.hidden = true;
    },
    errors: function (form, errors, opts) {
      opts = opts || {};
      ui.form.clear(form);
      var names = Object.keys(errors || {}), items = [];
      names.forEach(function (name) {
        var code = errors[name];
        var c = form.querySelector('[name="' + name + '"]') || form.querySelector('#' + name);
        var msg = (opts.messages && opts.messages[name]) || t('error.' + name + '.' + code) || t('error.' + code) || t('error.required');
        if (!c) { items.push({ msg: msg }); return; }
        c.setAttribute('aria-invalid', 'true');
        var f = fieldOf(c), err = f.querySelector('.field__error');
        if (!err) { err = d.createElement('p'); err.className = 'field__error'; f.appendChild(err); }
        if (!c.id) c.id = 'f-' + name + '-' + Math.random().toString(36).slice(2, 7);
        if (!err.id) err.id = c.id + '-error';
        err.textContent = msg; err.hidden = false;
        var ids = (c.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
        if (ids.indexOf(err.id) < 0) ids.push(err.id);
        c.setAttribute('aria-describedby', ids.join(' '));
        items.push({ msg: msg, id: c.id });
      });
      var sum = form.querySelector('.form__summary');
      if (sum && items.length) {
        var title = sum.querySelector('[data-summary-title]'), list = sum.querySelector('ul');
        if (title) title.textContent = t.plural('error.form.summary', items.length);
        if (list) {
          list.textContent = '';
          items.forEach(function (it) {
            var li = d.createElement('li');
            if (it.id) { var a = d.createElement('a'); a.href = '#' + it.id; a.textContent = it.msg; li.appendChild(a); }
            else li.textContent = it.msg;
            list.appendChild(li);
          });
        }
        sum.hidden = false;
        sum.setAttribute('tabindex', '-1');
        sum.focus();
      } else if (items[0] && items[0].id) {
        var first = d.getElementById(items[0].id); if (first) first.focus();
      }
      return items.length;
    }
  };

  /* ------------------------------------------------------------------ share */
  function meta(name) { var m = d.querySelector('meta[property="' + name + '"], meta[name="' + name + '"]'); return m ? m.getAttribute('content') || '' : ''; }
  ui.share = function (opts) {
    opts = opts || {};
    var page = opts.page || html.getAttribute('data-page') || 'home';
    var url = opts.url || (YSD.share && YSD.share.url ? YSD.share.url() : String(w.location.href));
    var text = opts.text || t('share.' + page + '.sms', { link: '{link}' }) || meta('og:description') || meta('description');
    text = String(text).replace(/\s*\{(?:link|url)\}\s*$/, '');
    var title = opts.title || t('seo.' + page + '.ogTitle') || meta('og:title') || d.title;
    var done = function (res) {
      if (res === 'copied') ui.toast(t('toast.linkCopied') || 'Link copied.');
      else if (res === 'failed') ui.toast(t('toast.shareFailed') || t('error.share.failed'), { tone: 'error' });
      return res;
    };
    if (YSD.share && YSD.share.native) return YSD.share.native({ title: title, text: text, url: url }).then(done);
    if (navigator.share) return navigator.share({ title: title, text: text, url: url }).then(function () { return 'shared'; }, function () { return 'cancelled'; });
    return Promise.resolve(done('failed'));
  };

  /* ------------------------------------------------------------------ header CTA */
  // The header's "Join free" goes straight to the form (join.html#join-form). Once this browser has a member
  // it becomes "Your card" (cta.yourCard) and points at join.html#card. The href keeps its own root and es/
  // prefix, so the same code serves both partials. Same .btn--sm classes: still 44 px and fits at 320 px.
  function currentMember() { try { return YSD.members && YSD.members.current ? YSD.members.current() : null; } catch (e) { return null; } }
  ui.joinCta = function () {
    var m = currentMember(), card = m ? t('cta.yourCard') : '';
    $$('[data-join-cta]').forEach(function (a) {
      if (!a.__ysdJoin) a.__ysdJoin = { href: a.getAttribute('href') || '', label: a.textContent };
      var o = a.__ysdJoin;
      if (card) {
        a.textContent = card;
        a.setAttribute('href', o.href.replace(/#.*$/, '') + '#card');
        a.setAttribute('data-member', 'yes');
      } else {
        a.textContent = o.label;
        a.setAttribute('href', o.href);
        a.removeAttribute('data-member');
      }
    });
  };

  /* ------------------------------------------------------------------ counters */
  ui.stopLive = function () { try { if (YSD.counters && YSD.counters.stopLive) YSD.counters.stopLive(); } catch (e) {} };
  ui.stopLive();

  /* ------------------------------------------------------------------ wiring */
  function wireConfig(root) {
    $$('[data-cfg-href]', root).forEach(function (a) {
      var v = cfg(a.getAttribute('data-cfg-href'), '');
      if (v) a.setAttribute('href', v); else (a.closest('li') || a).hidden = true;
    });
    $$('[data-social]', root).forEach(function (list) {
      var soc = cfg('social', {}) || {}, any = false;
      Object.keys(soc).forEach(function (k) {
        var s = soc[k]; if (!s || !s.url) return;
        var li = d.createElement('li'), a = d.createElement('a');
        a.href = s.url; a.rel = 'noopener'; a.textContent = k.charAt(0).toUpperCase() + k.slice(1);
        li.appendChild(a); list.appendChild(li); any = true;
      });
      var box = list.closest('[data-social-group]') || list;
      box.hidden = !any;
    });
    $$('[data-year]', root).forEach(function (el) { el.textContent = String(nyYmd(new Date())[0]); });
  }

  function init() {
    paintTheme(ui.theme.get());
    paintMotion();
    ui.stickers(d);
    ui.stickerFacts(d);
    $$('[data-countdown]').forEach(ui.countdown);
    $$('[data-ticker]').forEach(ticker);
    $$('[data-rotor]').forEach(function (el) { var r = Rotor(el); if (r) { rotors.push(r); r.start(); } });
    $$('[data-lang-link]').forEach(function (a) {
      var to = a.getAttribute('hreflang') || (YSD.lang === 'es' ? 'en' : 'es');
      a.href = ui.langHref(to);
      a.addEventListener('click', function () { track('lang_switch', { to: to }); });
    });
    wireConfig(d);
    ui.joinCta();
    ui.stopLive();
    html.setAttribute('data-ui', 'ready');
    emit('ui-ready', {});
  }

  d.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target : e.target.parentElement;
    if (!el || !el.closest) return;
    var b;
    if ((b = el.closest('[data-theme-toggle]'))) { ui.theme.cycle(); return; }
    if ((b = el.closest('[data-motion-toggle]'))) { ui.motion.toggle(); return; }
    if ((b = el.closest('[data-menu-toggle]'))) { ui.menu.toggle(); return; }
    if ((b = el.closest('[data-sheet-open]'))) { e.preventDefault(); ui.sheet.open(b.getAttribute('data-sheet-open'), { opener: b }); return; }
    if ((b = el.closest('[data-sheet-close]'))) { ui.sheet.close(b.closest('dialog')); return; }
    if ((b = el.closest('[data-reload]'))) { e.preventDefault(); w.location.reload(); return; }
    if ((b = el.closest('[data-share]')) && b.tagName !== 'FORM') {
      e.preventDefault();
      ui.share({ page: b.getAttribute('data-share') || undefined });
      return;
    }
    // menu: a link inside closes it; a click outside closes it
    if (ui.menu.isOpen()) {
      var m = menuParts();
      if (m.panel && m.panel.contains(el)) { if (el.closest('a')) ui.menu.close(); }
      else if (!(m.btn && m.btn.contains(el))) ui.menu.close();
    }
  });
  d.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && ui.menu.isOpen() && !d.querySelector('dialog[open]')) { ui.menu.close({ focus: true }); }
  });
  w.addEventListener('pageshow', ui.stopLive);
  d.addEventListener('ysd:joined', function () { ui.joinCta(); });
  d.addEventListener('ysd:forgot', function () { ui.joinCta(); });
  ui.ready(init);
})(window, document);
