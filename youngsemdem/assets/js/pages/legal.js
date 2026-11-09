/*! YDSC · assets/js/pages/legal.js (W7). Renders the five policy pages from data/legal.js.
 *
 * Page contract (privacy.html, accessibility.html, teen-safety.html, content-policy.html, conduct.html):
 *   main.legal[data-legal="<pageId>"]   pageId is a key of YSD_DATA.legal.pages (privacy, minors,
 *                                       moderation, conduct, accessibility)
 *   [data-legal-meta]                   "Last updated ... · Not in effect yet" line
 *   [data-legal-tldr]                   the TL;DR list ("The short version")
 *   [data-legal-toc] in [data-legal-tocbox]   table of contents (a <details>, open from 1024 px)
 *   section[data-legal-sec][id]         one static shell per section, so #anchors (#privacy-sms)
 *                                       resolve from other pages without JS; filled here
 *   [data-legal-srclist]                laws and sources, from the page's `sources`
 *   [data-device]                       "What this browser remembers" + Forget me on this device
 * Forget me: YSD.members.forget(), YSD.clips.reset(), then every ysd: key in localStorage and
 * sessionStorage except prefs:* (theme, motion), and the clip blob buckets. Nothing is sent anywhere.
 * Plain text only (textContent); {tokens} fill from YSD_CONFIG with the legalText() rule in
 * data/legal.js. No network, no inline handlers.
 */
(function (w, d) {
  'use strict';
  var YSD = w.YSD || {};
  var html = d.documentElement;
  var lang = YSD.lang || (String(html.lang).slice(0, 2) === 'es' ? 'es' : 'en');
  var D = (w.YSD_DATA || {}).legal;

  function $(sel, root) { return (root || d).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || d).querySelectorAll(sel)); }
  function el(tag, cls, text) {
    var e = d.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function cfg(p) { return typeof YSD.cfg === 'function' ? YSD.cfg(p, '') : ''; }
  /** legalText() from the data/legal.js header: language pick + {token} fill from config. */
  function T(o) {
    var s = (o && (o[lang] != null ? o[lang] : o.en)) || '';
    return String(s).replace(/\{(\w+)\}/g, function (m, k) {
      var tk = D && D.tokens && D.tokens[k];
      if (!tk) return m;
      var v = tk.from ? cfg(tk.from) : '';
      return v !== '' && v != null ? String(v) : ((tk.fallback && (tk.fallback[lang] || tk.fallback.en)) || m);
    });
  }
  function t(key, vars) {
    var s = YSD.t ? YSD.t(key, vars) : '';
    if (!s) {
      var i = key.indexOf(':'), P = ((w.YSD_DATA || {}).pages || {})[key.slice(0, i)] || {};
      var o = P[key.slice(i + 1)];
      s = o ? (o[lang] || o.en || '') : '';
      if (vars) s = s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? String(vars[k]) : m; });
    }
    return s;
  }
  function fmtDate(ymd) {
    if (!ymd) return '';
    if (YSD.fmt && YSD.fmt.date) { try { return YSD.fmt.date(ymd, { year: true }); } catch (e) {} }
    return ymd;
  }
  function ready(fn) { if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', fn); else fn(); }

  /* ------------------------------------------------------------------ blocks */
  function pageHref(id) {
    var p = D.pages[id];
    return p ? p.slug : '#';
  }
  function block(b) {
    if (b.p) return el('p', 'legal__p', T(b.p));
    if (b.note) {
      var n = el('div', 'notice notice--warn legal__note');
      n.appendChild(el('p', '', T(b.note)));
      return n;
    }
    if (b.list || b.steps) {
      var list = el(b.steps ? 'ol' : 'ul', b.steps ? 'legal__steps' : 'legal__list');
      (b.list || b.steps).forEach(function (x) { list.appendChild(el('li', '', T(x))); });
      return list;
    }
    if (b.links) {
      var ul = el('ul', 'legal__links');
      b.links.forEach(function (x) {
        var li = el('li'), a = el('a', 'legal__link', T(x.label));
        if (x.page) a.href = pageHref(x.page);
        else if (x.href) {
          a.href = x.href;
          if (/^tel:/.test(x.href)) a.className += ' legal__link--tel';
          else if (/^https?:/.test(x.href)) { a.rel = 'noopener'; a.className += ' legal__link--out'; }
        }
        li.appendChild(a);
        ul.appendChild(li);
      });
      return ul;
    }
    return null;
  }

  /* ------------------------------------------------------------------ page */
  function render(main, P) {
    var meta = $('[data-legal-meta]');
    if (meta) {
      var bits = [T(D.labels.updated) + ' ' + fmtDate(D.updated)];
      bits.push(D.effective ? T(D.labels.effective) + ' ' + fmtDate(D.effective) : T(D.labels.notYetEffective));
      meta.textContent = bits.join(' · ');
    }
    var tl = $('[data-legal-tldr]');
    if (tl) (P.tldr || []).forEach(function (x) { tl.appendChild(el('li', 'x-tldr__item', T(x))); });

    var toc = $('[data-legal-toc]'), box = $('[data-legal-sections]') || $('.x-sections') || main;
    var last = null;
    (P.sections || []).forEach(function (s, i) {
      var sec = d.getElementById(s.id);
      if (!sec) {
        sec = el('section', 'legal__section');
        sec.id = s.id;
        sec.setAttribute('data-legal-sec', '');
        if (last && last.parentNode) last.parentNode.insertBefore(sec, last.nextSibling); else box.insertBefore(sec, box.firstChild);
      }
      last = sec;
      sec.textContent = '';
      var h = el('h2', 'legal__h', T(s.heading));
      h.id = s.id + '-h';
      var num = el('span', 'legal__num', String(i + 1).padStart(2, '0'));
      num.setAttribute('aria-hidden', 'true');
      h.insertBefore(num, h.firstChild);
      sec.setAttribute('aria-labelledby', h.id);
      sec.appendChild(h);
      (s.body || []).forEach(function (b) { var n = block(b); if (n) sec.appendChild(n); });
      if (toc) {
        var li = el('li'), a = el('a', 'x-toc__link', T(s.heading));
        a.href = '#' + s.id;
        li.appendChild(a);
        toc.appendChild(li);
      }
    });

    var tb = $('[data-legal-tocbox]');
    if (tb && w.matchMedia) {
      var mq = w.matchMedia('(min-width: 1024px)');
      var sync = function () { if (mq.matches) tb.open = true; };
      sync();
      if (mq.addEventListener) mq.addEventListener('change', sync);
      tb.addEventListener('click', function (e) {
        var a = e.target.closest && e.target.closest('a');
        if (a && !mq.matches) tb.open = false; // phones: close the list after jumping
      });
    }

    var src = $('[data-legal-srclist]');
    if (src) {
      (P.sources || []).forEach(function (id) {
        var s = D.sources[id];
        if (!s) return;
        var li = el('li', 'x-sources__item');
        var a = el('a', 'x-sources__link', s.cite);
        a.href = s.url; a.rel = 'noopener';
        var lab = el('span', 'x-sources__label', s.label);
        if (lang !== 'en') { a.lang = 'en'; lab.lang = 'en'; } // source titles are in English
        li.appendChild(a);
        li.appendChild(d.createTextNode(' · '));
        li.appendChild(lab);
        li.appendChild(d.createTextNode(' · '));
        li.appendChild(el('span', 'x-sources__checked', T(D.labels.checked) + ' ' + fmtDate(s.checked)));
        src.appendChild(li);
      });
      var sum = $('.x-sources__sum');
      if (sum) sum.textContent = sum.textContent + ' (' + (P.sources || []).length + ')';
    }
  }

  /* ------------------------------------------------------------------ this device + Forget me */
  var S = function () { return YSD.store; };
  function allKeys() {
    try { return (S() && S().keys) ? S().keys() : []; } catch (e) { return []; }
  }
  function get(k, fb) { try { return S() ? S().get(k, fb) : fb; } catch (e) { return fb; } }
  function sizeOf(v) {
    if (Array.isArray(v)) return v.length;
    if (v && typeof v === 'object') return Object.keys(v).length;
    return v ? 1 : 0;
  }
  function inventory() {
    var keys = allKeys(), seen = {}, out = { member: 0, ref: 0, rsvp: 0, quiz: 0, maker: 0, stickers: 0, clips: 0, other: 0 };
    function take(k) { seen[k] = true; }
    keys.forEach(function (k) {
      if (/^prefs:/.test(k)) { take(k); return; }
      if (k === 'member' || k === 'joins' || k === 'squad:remote') { if (k === 'member' && get(k, null)) out.member = -1; take(k); return; }
      if (k === 'ref' || k === 'utm' || k === 'utm:first' || /^invite:/.test(k)) { if (k === 'ref' && get(k, null)) out.ref = -1; take(k); return; }
      if (/^rsvp:/.test(k)) { if (k !== 'rsvp:queue') out.rsvp++; take(k); return; }
      if (/^quiz:/.test(k)) { out.quiz++; take(k); return; }
      if (/^maker:/.test(k)) { out.maker++; take(k); return; }
      if (k === 'stickers' || k === 'streak') { if (k === 'stickers') out.stickers += sizeOf(get(k, [])); else if (!out.stickers && get(k, null)) out.stickers = -1; take(k); return; }
      if (/^clips:/.test(k)) { if (k === 'clips:local' || k === 'clips:liked' || k === 'clips:links') out.clips += sizeOf(get(k, [])); take(k); return; }
    });
    keys.forEach(function (k) { if (!seen[k]) out.other++; });
    return out;
  }
  function paintDevice() {
    var box = $('[data-device]');
    if (!box) return;
    var inv = inventory();
    $$('[data-device-row]', box).forEach(function (row) {
      var n = inv[row.getAttribute('data-device-row')] || 0, v = $('[data-device-val]', row);
      if (!v) return;
      v.textContent = n === -1 ? t('legal:device.yes') : n > 0 ? t('legal:device.n', { n: n }) : t('legal:device.none');
      row.setAttribute('data-has', n ? 'yes' : 'no');
    });
  }
  function forgetAll() {
    try { if (YSD.members && YSD.members.forget) YSD.members.forget(); } catch (e) {}
    var jobs = [];
    try { if (YSD.clips && YSD.clips.reset) jobs.push(YSD.clips.reset()); } catch (e) {}
    allKeys().forEach(function (k) { if (!/^prefs:/.test(k)) { try { S().remove(k); } catch (e) {} } });
    try {
      var ss = w.sessionStorage, rm = [];
      for (var i = 0; i < ss.length; i++) { var k = ss.key(i); if (k && k.indexOf('ysd:') === 0) rm.push(k); }
      rm.forEach(function (k) { ss.removeItem(k); });
    } catch (e) {}
    return Promise.all(jobs).catch(function () {}).then(function () {
      if (YSD.db && YSD.db.clear) return Promise.all([YSD.db.clear('clips'), YSD.db.clear('clip-posters')]).catch(function () {});
    });
  }
  function device() {
    var box = $('[data-device]');
    if (!box) return;
    paintDevice();
    if (S() && S().on) S().on('*', paintDevice);
    d.addEventListener('ysd:forgot', paintDevice);
    var btn = $('[data-forget]', box), conf = $('[data-forget-confirm]', box), text = $('[data-forget-text]', box);
    var yes = $('[data-forget-yes]', box), no = $('[data-forget-no]', box);
    if (!btn || !conf) return;
    var snip = (D && D.snippets && D.snippets.forgetMe) || {};
    function close(focus) {
      conf.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      if (focus) btn.focus();
    }
    btn.addEventListener('click', function () {
      if (!conf.hidden) { close(false); return; }
      text.textContent = T(snip.confirm);
      conf.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      text.focus();
    });
    no.addEventListener('click', function () { close(true); });
    conf.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(true); });
    yes.addEventListener('click', function () {
      yes.setAttribute('data-state', 'loading');
      forgetAll().then(function () {
        yes.removeAttribute('data-state');
        close(true);
        paintDevice();
        if (YSD.ui && YSD.ui.toast) YSD.ui.toast(T(snip.done), { tone: 'success' });
      });
    });
  }

  ready(function () {
    var main = $('main.legal[data-legal]');
    if (!main || !D || !D.pages) return;
    var P = D.pages[main.getAttribute('data-legal')];
    try {
      if (P) render(main, P);
      device();
    } finally {
      var pend = $('[data-legal-pending]');
      if (pend) pend.removeAttribute('data-legal-pending');
    }
    // a hash that pointed at a section before it was filled: re-scroll once the content exists
    if (w.location.hash) {
      var target = d.getElementById(decodeURIComponent(w.location.hash.slice(1)));
      if (target && target.hasAttribute('data-legal-sec')) target.scrollIntoView();
    }
  });
})(window, document);
