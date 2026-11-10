/*!
 * Young Seminole Democrats: analytics shim.  YSD.track(event, props)
 *
 *   YSD.track(event, props)   record an event. Returns true when it was sent to a provider.
 *   YSD.track.pageview()      record a page view (custom endpoint only; Plausible and Cloudflare
 *                             count page views by themselves)
 *   YSD.track.enabled()       true when events leave the browser (not demo, provider set, no DNT/GPC)
 *   YSD.track.history()       the last 100 events of this page (for debugging and tests)
 *
 * Every call also dispatches a 'ysd:track' DOM event ({ event, props, ts, path }) and logs to the
 * console when the page was opened with ?debug=1. Demo mode never sends anything.
 * Providers (YSD_CONFIG.integrations.analytics.provider):
 *   'plausible'  loads plausibleSrc (data-domain = plausibleDomain) and calls plausible(event, {props})
 *   'cloudflare' loads the Web Analytics beacon with cloudflareToken (page views only; custom
 *                events are not supported by Cloudflare and are only logged)
 *   'custom'     navigator.sendBeacon(endpoint, JSON as text/plain), fetch keepalive fallback
 * Privacy: props are flattened to primitives, strings cut to 200 chars, at most 30 keys, and keys
 * that look like personal data (email, phone, name, address, zip, age, ...) are dropped.
 */
(function (w) {
  'use strict';
  var YSD = w.YSD = w.YSD || {};
  function cfg(p, fb) { return typeof YSD.cfg === 'function' ? YSD.cfg(p, fb) : fb; }
  function emit(n, d) { if (typeof YSD.emit === 'function') YSD.emit(n, d); }
  function isDemo() { return cfg('demo', true) !== false; }
  function debugOn() {
    if (YSD.debug) return true;
    try { return /[?&]debug=1\b/.test(String(w.location.search || '')); } catch (e) { return false; }
  }

  var PII = {
    email: 1, emailaddress: 1, phone: 1, phonenumber: 1, mobile: 1, name: 1, firstname: 1, lastname: 1, fullname: 1,
    givenname: 1, familyname: 1, address: 1, street: 1, streetaddress: 1, zip: 1, zipcode: 1, postalcode: 1,
    dob: 1, birthday: 1, birthdate: 1, birthyear: 1, age: 1, ip: 1, password: 1, token: 1
  };
  function clean(props) {
    var out = {}, n = 0;
    if (!props || typeof props !== 'object') return out;
    for (var k in props) {
      if (!Object.prototype.hasOwnProperty.call(props, k)) continue;
      if (PII[String(k).toLowerCase().replace(/[^a-z]/g, '')]) continue;
      var v = props[k];
      if (v === null || v === undefined) continue;
      if (typeof v === 'string') v = v.slice(0, 200);
      else if (typeof v === 'number') { if (!isFinite(v)) continue; }
      else if (typeof v === 'boolean') v = v ? 'true' : 'false';
      else continue;
      out[String(k).slice(0, 40)] = v;
      if (++n >= 30) break;
    }
    return out;
  }
  function dnt() {
    try {
      var n = w.navigator || {};
      return n.globalPrivacyControl === true || n.doNotTrack === '1' || n.doNotTrack === 'yes' || w.doNotTrack === '1' || n.msDoNotTrack === '1';
    } catch (e) { return false; }
  }
  function provider() { return String(cfg('integrations.analytics.provider', 'none') || 'none'); }
  function enabled() {
    if (isDemo()) return false;
    var p = provider();
    if (p === 'none') return false;
    if (cfg('integrations.analytics.respectDoNotTrack', true) !== false && dnt()) return false;
    if (p === 'plausible') return !!cfg('integrations.analytics.plausibleSrc', '');
    if (p === 'cloudflare') return !!cfg('integrations.analytics.cloudflareToken', '');
    if (p === 'custom') return !!cfg('integrations.analytics.endpoint', '');
    return false;
  }
  function path() { try { return String(w.location.pathname || ''); } catch (e) { return ''; } }

  var queued = YSD.track && YSD.track.q && YSD.track.q.slice ? YSD.track.q.slice() : [];
  var hist = [];
  var loaded = false;
  function addScript(src, attrs) {
    try {
      var d = w.document;
      if (!d || !d.createElement) return;
      var s = d.createElement('script');
      s.src = src;
      s.defer = true;
      for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) s.setAttribute(k, attrs[k]);
      (d.head || d.documentElement).appendChild(s);
    } catch (e) {}
  }
  function ensureProvider() {
    if (loaded || !enabled()) return;
    loaded = true;
    var p = provider();
    if (p === 'plausible') {
      // Queue stub from Plausible's snippet; works with both the classic script.js (data-domain)
      // and the newer per-site pa-*.js script (which reads plausible.init options).
      if (typeof w.plausible !== 'function') {
        w.plausible = function () { (w.plausible.q = w.plausible.q || []).push(arguments); };
        w.plausible.init = w.plausible.init || function (i) { w.plausible.o = i || {}; };
        w.plausible.init();
      }
      var attrs = {};
      var dom = cfg('integrations.analytics.plausibleDomain', '');
      if (dom) attrs['data-domain'] = dom;
      addScript(cfg('integrations.analytics.plausibleSrc', ''), attrs);
    } else if (p === 'cloudflare') {
      addScript('https://static.cloudflareinsights.com/beacon.min.js', {
        'data-cf-beacon': JSON.stringify({ token: cfg('integrations.analytics.cloudflareToken', '') })
      });
    }
  }
  function sendCustom(rec) {
    var ep = cfg('integrations.analytics.endpoint', '');
    if (!ep) return false;
    var body = JSON.stringify(rec);
    try {
      var n = w.navigator;
      if (n && typeof n.sendBeacon === 'function' && typeof w.Blob === 'function') {
        if (n.sendBeacon(ep, new w.Blob([body], { type: 'text/plain;charset=UTF-8' }))) return true;
      }
    } catch (e) {}
    try {
      if (typeof w.fetch === 'function') {
        w.fetch(ep, { method: 'POST', body: body, keepalive: true, headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, credentials: 'omit' })['catch'](function () {});
        return true;
      }
    } catch (e) {}
    return false;
  }

  function track(event, props) {
    event = String(event == null ? '' : event).replace(/[^\w:.-]/g, '_').slice(0, 64);
    if (!event) return false;
    var rec = { event: event, props: clean(props), ts: Date.now(), path: path() };
    hist.push(rec);
    if (hist.length > 100) hist.shift();
    if (debugOn()) { try { w.console && w.console.log('[ysd] track', event, rec.props); } catch (e) {} }
    emit('track', rec);
    if (!enabled()) return false;
    ensureProvider();
    var p = provider();
    try {
      if (p === 'plausible' && typeof w.plausible === 'function') { w.plausible(event, { props: rec.props }); return true; }
      if (p === 'custom') {
        var ref = null;
        try { ref = YSD.share && YSD.share.ref ? YSD.share.ref() : null; } catch (e) {}
        rec.ref = ref;
        return sendCustom(rec);
      }
    } catch (e) {}
    return false;   // cloudflare: no custom events
  }
  track.pageview = function () {
    if (!enabled()) { if (debugOn()) { try { w.console.log('[ysd] pageview', path()); } catch (e) {} } return false; }
    ensureProvider();
    if (provider() === 'custom') {
      var r = '';
      try { r = w.document.referrer || ''; } catch (e) {}
      return sendCustom({ event: 'pageview', props: { referrer: r.slice(0, 200) }, ts: Date.now(), path: path() });
    }
    return true;   // Plausible and Cloudflare scripts count page views themselves
  };
  track.enabled = enabled;
  track.history = function () { return hist.slice(); };
  track.clean = clean;
  YSD.track = track;
  // Replay calls made before this file loaded (queued by the stub in config.js).
  for (var qi = 0; qi < queued.length; qi++) { try { track.apply(null, queued[qi]); } catch (e) {} }

  // Boot: load the provider script and count the page view once the DOM is ready.
  try {
    var boot = function () { if (enabled()) track.pageview(); };
    if (w.document && w.document.readyState === 'loading') w.document.addEventListener('DOMContentLoaded', boot);
    else setTimeout(boot, 0);
  } catch (e) {}
})(typeof window !== 'undefined' ? window : this);
