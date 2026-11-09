/*!
 * Young Seminole Democrats: sharing and referral links.  YSD.share
 *
 *   captureRef()              runs on load: stores ?ref= (referral code) and utm_* params
 *   ref()                     the captured referral code still inside the attribution window, or null
 *   utm()                     last captured utm_* params ({} when none)
 *   url(path, params)         absolute URL carrying MY refCode and default utm_* tags
 *   native({title,text,url,files})  Web Share API, copy fallback -> 'shared'|'copied'|'cancelled'|'failed'
 *   copy(text)                clipboard write -> Promise<boolean>
 *   links(text, url, opts)    {sms, whatsapp, x, threads, bluesky, facebook, email, telegram}
 *   actblue(amount, extra)    ActBlue URL with refcode ('' when links.actblue is not configured)
 *
 * Load after config.js and store.js. Works without them (in-memory), without navigator.share or
 * navigator.clipboard, and from file://. Never throws on missing browser APIs.
 * Store keys used: 'ref', 'utm', 'utm:first' (written here), 'member' (read: my refCode).
 */
(function (w) {
  'use strict';
  var YSD = w.YSD = w.YSD || {};
  function cfg(p, fb) { return typeof YSD.cfg === 'function' ? YSD.cfg(p, fb) : fb; }
  function emit(n, d) { if (typeof YSD.emit === 'function') YSD.emit(n, d); }
  function track(e, p) { try { if (typeof YSD.track === 'function') YSD.track(e, p); } catch (x) {} }
  function log() { if (typeof YSD.log === 'function') YSD.log.apply(null, arguments); }

  // Store access that survives a missing store module.
  // Shared in-memory fallback (one object for every module) when assets/js/store.js is missing.
  var mem = YSD._mem = YSD._mem || {};
  function sget(k, fb) {
    try { if (YSD.store) return YSD.store.get(k, fb); } catch (e) {}
    return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : fb;
  }
  function sset(k, v) {
    try { if (YSD.store) { YSD.store.set(k, v); return; } } catch (e) {}
    mem[k] = v;
  }

  var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
  var STRIP_KEYS = ['debug', 'fbclid', 'gclid', 'msclkid', 'ttclid', 'igshid', 'mc_cid', 'mc_eid'];
  var CODE_RE = /^[A-Za-z0-9_-]{2,32}$/;
  var DAY = 86400000;

  /** Referral codes are case-insensitive: stored and compared upper-case. '' when malformed. */
  function normCode(c) {
    c = String(c == null ? '' : c).replace(/^\s+|\s+$/g, '');
    return CODE_RE.test(c) ? c.toUpperCase() : '';
  }
  function myCode() {
    var m = sget('member', null);
    return m && m.refCode ? String(m.refCode).toUpperCase() : '';
  }
  function loc() { try { return w.location || null; } catch (e) { return null; } }
  function parseQuery(q) {
    var out = {};
    q = String(q || '').replace(/^\?/, '');
    if (!q) return out;
    var parts = q.split('&');
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      var eq = parts[i].indexOf('='), k, v;
      k = eq < 0 ? parts[i] : parts[i].slice(0, eq);
      v = eq < 0 ? '' : parts[i].slice(eq + 1);
      try { k = decodeURIComponent(k.replace(/\+/g, ' ')); v = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { continue; }
      if (!(k in out)) out[k] = v;   // first occurrence wins
    }
    return out;
  }
  function currentPath() {
    var l = loc();
    if (!l) return '';
    var root = YSD.root || '', href = String(l.href || '').split('#')[0].split('?')[0];
    if (root && href.indexOf(root) === 0) return '/' + href.slice(root.length);
    return String(l.pathname || '');
  }
  function referrerHost() {
    try {
      var r = w.document && w.document.referrer;
      if (!r) return '';
      var h = new w.URL(r).hostname;
      var l = loc();
      return l && h === l.hostname ? '' : h;
    } catch (e) { return ''; }
  }

  // ------------------------------------------------------------------ capture
  /**
   * Read ?ref= (config share.refParam) and utm_* from the current URL and store them.
   * Last touch wins for 'ref' (firstTs remembers when this code was first seen); my own code
   * is ignored. utm_* are stored as 'utm' (last) and 'utm:first' (first touch, never replaced).
   * Returns { captured, ref, utm }.
   */
  function captureRef() {
    var l = loc();
    var q = parseQuery(l ? l.search : '');
    var out = { captured: false, ref: null, utm: {} };
    var now = Date.now();
    var code = normCode(q[cfg('share.refParam', 'ref')]);
    if (code && code !== myCode()) {
      var prev = sget('ref', null);
      var rec = {
        code: code,
        ts: now,
        firstTs: prev && prev.code === code && prev.firstTs ? prev.firstTs : now,
        path: currentPath(),
        referrer: referrerHost()
      };
      sset('ref', rec);
      out.captured = true;
      emit('ref', rec);
      track('ref_captured', { ref: code });
      log('share: captured ref', code);
    }
    var utm = {}, has = false;
    for (var i = 0; i < UTM_KEYS.length; i++) {
      var v = q[UTM_KEYS[i]];
      if (v) { utm[UTM_KEYS[i]] = String(v).slice(0, 120); has = true; }
    }
    if (has) {
      utm.ts = now; utm.path = currentPath();
      sset('utm', utm);
      if (!sget('utm:first', null)) sset('utm:first', utm);
    }
    out.ref = ref();
    out.utm = getUtm();
    if ((code || has) && cfg('share.cleanUrl', false)) scheduleClean();
    return out;
  }

  /** The captured referral code while inside share.attributionDays, else null. */
  function ref() {
    var r = sget('ref', null);
    if (!r || !r.code) return null;
    var days = +cfg('share.attributionDays', 30) || 30;
    if (r.ts && Date.now() - r.ts > days * DAY) return null;
    var code = normCode(r.code);
    return code && code !== myCode() ? code : null;
  }
  function getUtm() {
    var u = sget('utm', null);
    var out = {};
    if (u) for (var i = 0; i < UTM_KEYS.length; i++) if (u[UTM_KEYS[i]]) out[UTM_KEYS[i]] = u[UTM_KEYS[i]];
    return out;
  }

  function scheduleClean() {
    function clean() {
      try {
        var l = loc(), h = w.history;
        if (!l || !h || typeof h.replaceState !== 'function' || typeof w.URL !== 'function') return;
        var u = new w.URL(l.href);
        u.searchParams['delete'](cfg('share.refParam', 'ref'));
        for (var i = 0; i < UTM_KEYS.length; i++) u.searchParams['delete'](UTM_KEYS[i]);
        h.replaceState(h.state, '', u.href);
      } catch (e) { /* file:// and sandboxed frames may refuse; harmless */ }
    }
    try {
      if (w.document && w.document.readyState === 'complete') setTimeout(clean, 1000);
      else if (w.addEventListener) w.addEventListener('load', function () { setTimeout(clean, 1000); });
    } catch (e) {}
  }

  // ------------------------------------------------------------------ urls
  /** Root that relative paths resolve against: site.url (production) or YSD.root (where the files are). */
  function siteRoot() {
    var u = String(cfg('site.url', '') || '');
    if (u) return u.replace(/\/+$/, '') + '/';
    if (YSD.root) return YSD.root;
    var l = loc();
    try { return new w.URL('.', l.href).href; } catch (e) { return ''; }
  }

  /**
   * Absolute share URL.
   *   path    'join.html', '/events.html#x', 'https://elsewhere/...' or ''/undefined for this page.
   *           Relative and '/'-paths resolve against the site root (see siteRoot), so they work the
   *           same on file://, localhost and a real domain.
   *   params  extra query params; a value of null/undefined/false removes that param. Special keys:
   *           ref: false  -> no referral code;  ref: 'CODE' -> that code instead of mine
   *           utm: false  -> no default utm_* tags (explicit utm_* keys still apply)
   * The current page keeps its own query (minus ref, utm_*, debug and ad click ids).
   */
  function url(path, params) {
    params = params || {};
    var root = siteRoot();
    var target, keepQuery = null;
    try {
      if (path == null || path === '') {
        var l = loc();
        var rel = currentPath().replace(/^\/+/, '');
        target = new w.URL(rel, root);
        keepQuery = parseQuery(l ? l.search : '');
      } else if (/^[a-z][a-z0-9+.-]*:/i.test(path)) {
        target = new w.URL(path);
      } else {
        target = new w.URL(String(path).replace(/^\/+/, ''), root);
      }
    } catch (e) {
      log('share.url: cannot build URL', path, e);
      return String(path || '');
    }
    var sp = target.searchParams, k;
    if (keepQuery) {
      for (k in keepQuery) {
        if (k === cfg('share.refParam', 'ref') || UTM_KEYS.indexOf(k) >= 0 || STRIP_KEYS.indexOf(k) >= 0) continue;
        sp.set(k, keepQuery[k]);
      }
    }
    if (params.utm !== false) {
      var utm = cfg('share.utm', {}) || {};
      for (k in utm) if (utm[k] && !sp.has(k)) sp.set(k, utm[k]);
    }
    var refParam = cfg('share.refParam', 'ref');
    var code = params.ref === undefined ? myCode() : (params.ref ? normCode(params.ref) : '');
    if (code && cfg('features.referrals', true) !== false) sp.set(refParam, code);
    else sp['delete'](refParam);
    for (k in params) {
      if (k === 'ref' || k === 'utm' || !Object.prototype.hasOwnProperty.call(params, k)) continue;
      var v = params[k];
      if (v === null || v === undefined || v === false) sp['delete'](k);
      else sp.set(k, String(v));
    }
    return target.href;
  }

  // ------------------------------------------------------------------ copy / native share
  function legacyCopy(text) {
    try {
      var d = w.document;
      if (!d || !d.body || typeof d.execCommand !== 'function') return false;
      var ta = d.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.setAttribute('aria-hidden', 'true');
      ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none';
      var active = d.activeElement;
      d.body.appendChild(ta);
      ta.select();
      try { ta.setSelectionRange(0, text.length); } catch (e) {}
      var ok = false;
      try { ok = d.execCommand('copy'); } catch (e) { ok = false; }
      d.body.removeChild(ta);
      try { if (active && active.focus) active.focus(); } catch (e) {}
      return !!ok;
    } catch (e) { return false; }
  }
  /** Copy text to the clipboard. Resolves true/false; never rejects. */
  function copy(text) {
    text = String(text == null ? '' : text);
    return new Promise(function (resolve) {
      function done(ok) { if (ok) emit('copied', { text: text }); resolve(ok); }
      var nav = w.navigator, clip = null;
      try { clip = nav && nav.clipboard && typeof nav.clipboard.writeText === 'function' ? nav.clipboard : null; } catch (e) {}
      if (clip) {
        var p;
        try { p = clip.writeText(text); } catch (e) { p = null; }
        if (p && typeof p.then === 'function') { p.then(function () { done(true); }, function () { done(legacyCopy(text)); }); return; }
      }
      done(legacyCopy(text));
    });
  }

  function joinTextUrl(text, u) {
    text = String(text || ''); u = String(u || '');
    if (!u) return text;
    if (!text) return u;
    return text.indexOf(u) >= 0 ? text : text + ' ' + u;
  }

  /**
   * Native share sheet with fallbacks. opts = { title, text, url, files, count, channel }.
   *   files that the browser cannot share are dropped (share the link instead; YSD.cards.share
   *   handles image files with a download fallback).
   *   No Web Share API, or it fails for a reason other than the user closing it -> copy
   *   "text url" to the clipboard.
   * Resolves 'shared' | 'copied' | 'cancelled' | 'failed' (failed = no share and copy refused).
   * Bumps the 'shares' counter on shared/copied unless opts.count === false.
   * Call it directly inside a click handler: browsers require a user gesture for both APIs.
   */
  function native(opts) {
    opts = opts || {};
    var data = {};
    if (opts.title) data.title = String(opts.title);
    if (opts.text) data.text = String(opts.text);
    if (opts.url) data.url = String(opts.url);
    var nav = w.navigator;
    return new Promise(function (resolve) {
      var method = 'share';
      function done(result) {
        var info = { result: result, method: method, url: data.url || '', channel: opts.channel || '' };
        try {
          if ((result === 'shared' || result === 'copied') && opts.count !== false && YSD.counters) YSD.counters.bump('shares');
        } catch (e) {}
        emit('share', info);
        track('share', { result: result, method: method, channel: opts.channel || '' });
        resolve(result);
      }
      function fallback() {
        method = 'copy';
        copy(joinTextUrl(data.text, data.url) || data.title || '').then(function (ok) { done(ok ? 'copied' : 'failed'); });
      }
      var canShare = false;
      try { canShare = !!(nav && typeof nav.share === 'function'); } catch (e) {}
      if (!canShare) { fallback(); return; }
      var files = opts.files && opts.files.length ? [].slice.call(opts.files) : null;
      try {
        if (files && typeof nav.canShare === 'function' && nav.canShare({ files: files })) data.files = files;
        if (typeof nav.canShare === 'function' && !nav.canShare(data)) { fallback(); return; }
      } catch (e) { delete data.files; }
      var p;
      try { p = nav.share(data); } catch (e) { fallback(); return; }
      if (!p || typeof p.then !== 'function') { done('shared'); return; }
      p.then(function () { done('shared'); }, function (err) {
        if (err && err.name === 'AbortError') done('cancelled');
        else fallback();   // NotAllowedError (no user gesture), DataError, etc.
      });
    });
  }

  // ------------------------------------------------------------------ network links
  /**
   * Share-intent links. text and url are plain strings (they are encoded here).
   * opts = { subject (email), hashtags (X only, default share.hashtags), via (X handle) }.
   * Formats (checked 2026-11-09 against each platform's docs where one exists):
   *   x         https://x.com/intent/tweet?text&url&hashtags   (docs.x.com web intent)
   *   threads   https://www.threads.com/intent/post?text&url   (Meta Threads web intents)
   *   bluesky   https://bsky.app/intent/compose?text            (docs.bsky.app intent links)
   *   facebook  https://www.facebook.com/sharer/sharer.php?u
   *   whatsapp  https://wa.me/?text      telegram  https://t.me/share/url?url&text
   *   sms       sms:?&body=  (works on iOS and Android)        email  mailto:?subject&body
   */
  function links(text, u, opts) {
    opts = opts || {};
    var e = encodeURIComponent;
    text = String(text || ''); u = String(u || '');
    var both = joinTextUrl(text, u);
    var tags = opts.hashtags || cfg('share.hashtags', []) || [];
    var subject = opts.subject || cfg('site.title', '') || cfg('org.name', '');
    var x = 'https://x.com/intent/tweet?text=' + e(text) + (u ? '&url=' + e(u) : '');
    if (tags.length) x += '&hashtags=' + e(tags.join(','));
    if (opts.via) x += '&via=' + e(String(opts.via).replace(/^@/, ''));
    return {
      sms: 'sms:?&body=' + e(both),
      whatsapp: 'https://wa.me/?text=' + e(both),
      x: x,
      threads: 'https://www.threads.com/intent/post?text=' + e(text) + (u ? '&url=' + e(u) : ''),
      bluesky: 'https://bsky.app/intent/compose?text=' + e(both),
      facebook: 'https://www.facebook.com/sharer/sharer.php?u=' + e(u || siteRoot()),
      email: 'mailto:?subject=' + e(subject) + '&body=' + e(both),
      telegram: 'https://t.me/share/url?url=' + e(u || siteRoot()) + (text ? '&text=' + e(text) : '')
    };
  }

  // ------------------------------------------------------------------ ActBlue
  function refcodeSafe(s) { return String(s || '').replace(/[^A-Za-z0-9_]/g, '_').slice(0, 64); }
  /**
   * ActBlue contribution URL, or '' when YSD_CONFIG.links.actblue is not set.
   *   amount  number pre-selected on the form (omitted when falsy)
   *   extra   { refcode, refcode2, mine, recurring, express_lane, ...any other ActBlue param }
   * refcode default: 'ref_<CODE>' for the visitor's referrer (ref()), or with extra.mine === true
   * for MY code (use mine for donate links people share); otherwise share.actblueRefcode.
   * refcode2 default: the last utm_source, if any. ActBlue documents refcode and refcode2
   * (help.actblue.com "Refcodes"); express_lane=true only works when ActBlue has enabled
   * Express Lane for the entity, and recurring=true needs ActBlue approval: pass them only then.
   */
  function actblue(amount, extra) {
    var base = String(cfg('links.actblue', '') || '');
    if (!base) return '';
    extra = extra || {};
    var u;
    try { u = new w.URL(base); } catch (e) { return base; }
    var sp = u.searchParams;
    var amt = +amount;
    if (amt > 0 && isFinite(amt)) sp.set('amount', String(Math.round(amt * 100) / 100));
    var code = extra.mine ? myCode() : ref();
    var refcode = extra.refcode !== undefined ? extra.refcode : (code ? 'ref_' + code : cfg('share.actblueRefcode', 'ysd_site'));
    if (refcode) sp.set('refcode', refcodeSafe(refcode));
    var src = getUtm().utm_source;
    var refcode2 = extra.refcode2 !== undefined ? extra.refcode2 : (src ? 'utm_' + src : '');
    if (refcode2) sp.set('refcode2', refcodeSafe(refcode2));
    for (var k in extra) {
      if (!Object.prototype.hasOwnProperty.call(extra, k) || k === 'refcode' || k === 'refcode2' || k === 'mine') continue;
      var v = extra[k];
      if (v === null || v === undefined || v === false) sp['delete'](k);
      else sp.set(k, String(v));
    }
    return u.href;
  }

  YSD.share = {
    captureRef: captureRef,
    ref: ref,
    utm: getUtm,
    myCode: myCode,
    normCode: normCode,
    root: siteRoot,
    url: url,
    native: native,
    copy: copy,
    links: links,
    actblue: actblue
  };

  try { captureRef(); } catch (e) { log('share: captureRef failed', e); }
})(typeof window !== 'undefined' ? window : this);
