/*!
 * Young Democrats of Seminole County: service worker registration (YSD.sw). Tooling workstream;
 * API in docs/infra/tooling.md.
 *
 * Load after assets/js/config.js (optional: works without it). Registers <site root>/sw.js on
 * window 'load' when ALL of these hold:
 *   - the page is served over http or https (never on file://),
 *   - the browser supports service workers,
 *   - YSD_CONFIG.pwa.serviceWorker !== false,
 *   - not demo mode, unless YSD_CONFIG.pwa.serviceWorkerInDemo === true
 *     (demo mode is YSD_CONFIG.demo !== false; demo deploys change often, so no caching there),
 *   - the URL does not carry ?sw=0 (a debugging kill switch that also unregisters).
 * When registration is disabled for a config reason (not file:// or unsupported), any earlier
 * registration of THIS site's sw.js is removed and its caches cleared, so flipping the config
 * really turns the worker off for returning visitors.
 *
 * API: YSD.sw.status          'idle'|'file'|'unsupported'|'disabled'|'registering'|'registered'|'error'
 *      YSD.sw.reason          why it is not registered ('' when registered)
 *      YSD.sw.enabled()       -> {ok, reason}
 *      YSD.sw.register()      -> Promise<ServiceWorkerRegistration|null>
 *      YSD.sw.unregister()    -> Promise<number> (registrations removed; also clears caches)
 *      YSD.sw.update()        -> Promise (asks the browser to check for a new sw.js)
 *      YSD.sw.applyUpdate()   tells a waiting worker to take over (then the page may reload)
 *      YSD.sw.url             absolute URL of sw.js
 * Events on document (design hooks, CustomEvent detail in brackets):
 *   ysd:sw-registered {scope}   ysd:sw-disabled {reason}   ysd:sw-error {message}
 *   ysd:sw-update-ready {}      a new version is installed and waiting (show a "refresh" prompt)
 *   ysd:sw-controller {}        a new worker took control of this page
 *   ysd:network {online}        the browser went online or offline
 */
(function (w) {
  'use strict';
  var YSD = w.YSD = w.YSD || {};
  if (YSD.sw && YSD.sw._loaded) return;
  var nav = w.navigator || {};

  function cfg(path, fallback) {
    if (typeof YSD.cfg === 'function') return YSD.cfg(path, fallback);
    var cur = w.YSD_CONFIG, parts = String(path).split('.');
    for (var i = 0; i < parts.length; i++) {
      if (cur == null || typeof cur !== 'object' || !(parts[i] in cur)) return fallback;
      cur = cur[parts[i]];
    }
    return cur === undefined ? fallback : cur;
  }

  function emit(name, detail) {
    if (typeof YSD.emit === 'function') return YSD.emit(name, detail);
    try {
      var ev = new w.CustomEvent('ysd:' + name, { detail: detail });
      w.document.dispatchEvent(ev);
    } catch (e) {}
  }

  function log() {
    if (typeof YSD.log === 'function') YSD.log.apply(null, ['[sw]'].concat([].slice.call(arguments)));
  }

  /** Site root: YSD.root from config.js, else derived from this script's own src. */
  var root = (function () {
    if (YSD.root) return YSD.root;
    var re = /^(.*\/)assets\/js\/sw-register\.js(?:[?#].*)?$/;
    try {
      var cs = w.document.currentScript;
      var m = cs && re.exec(cs.src || '');
      if (m) return m[1];
      var ss = w.document.getElementsByTagName('script');
      for (var i = ss.length - 1; i >= 0; i--) { m = re.exec(ss[i].src || ''); if (m) return m[1]; }
    } catch (e) {}
    try { return new w.URL('./', w.location.href).href; } catch (e2) { return ''; }
  })();

  var swUrl = '';
  try { swUrl = new w.URL(cfg('pwa.swUrl', 'sw.js'), root).href; } catch (e) {}

  var api = YSD.sw = {
    _loaded: true,
    status: 'idle',
    reason: '',
    url: swUrl,
    registration: null,
    enabled: enabled,
    register: register,
    unregister: unregister,
    update: update,
    applyUpdate: applyUpdate
  };

  function protocolOk() {
    try { return /^https?:$/.test(w.location.protocol); } catch (e) { return false; }
  }

  function killSwitch() {
    try { return /[?&]sw=0(?:&|#|$)/.test(String(w.location.search || '')); } catch (e) { return false; }
  }

  function enabled() {
    if (!protocolOk()) return { ok: false, reason: 'file' };
    if (!('serviceWorker' in nav) || !swUrl) return { ok: false, reason: 'unsupported' };
    if (killSwitch()) return { ok: false, reason: 'url-kill-switch' };
    if (cfg('pwa.serviceWorker', true) === false) return { ok: false, reason: 'config' };
    if (cfg('demo', true) !== false && cfg('pwa.serviceWorkerInDemo', false) !== true) return { ok: false, reason: 'demo' };
    return { ok: true, reason: '' };
  }

  function setStatus(s, reason) { api.status = s; api.reason = reason || ''; }

  function watch(reg) {
    function onState(worker) {
      if (!worker) return;
      worker.addEventListener('statechange', function () {
        if (worker.state === 'installed' && nav.serviceWorker.controller) emit('sw-update-ready', {});
      });
    }
    if (reg.waiting && nav.serviceWorker.controller) emit('sw-update-ready', {});
    onState(reg.installing);
    reg.addEventListener('updatefound', function () { onState(reg.installing); });
  }

  function register() {
    var st = enabled();
    if (!st.ok) {
      setStatus(st.reason === 'file' ? 'file' : st.reason === 'unsupported' ? 'unsupported' : 'disabled', st.reason);
      emit('sw-disabled', { reason: st.reason });
      return Promise.resolve(null);
    }
    setStatus('registering');
    var scope = new w.URL('./', swUrl).href;
    return nav.serviceWorker.register(swUrl, { scope: scope }).then(function (reg) {
      api.registration = reg;
      setStatus('registered');
      watch(reg);
      emit('sw-registered', { scope: reg.scope });
      log('registered', reg.scope);
      return reg;
    }, function (err) {
      setStatus('error', String((err && err.message) || err));
      emit('sw-error', { message: api.reason });
      log('registration failed', err);
      return null;
    });
  }

  function clearCaches(reg) {
    var worker = reg && (reg.active || reg.waiting || reg.installing);
    if (!worker || typeof w.MessageChannel !== 'function') return Promise.resolve();
    return new Promise(function (resolve) {
      var ch = new w.MessageChannel();
      var t = setTimeout(resolve, 1500);
      ch.port1.onmessage = function () { clearTimeout(t); resolve(); };
      try { worker.postMessage({ type: 'CLEAR_CACHES' }, [ch.port2]); } catch (e) { clearTimeout(t); resolve(); }
    });
  }

  /** Delete this site's caches from the page too (requests made while unregistering refill them). */
  function deletePageCaches() {
    var c = w.caches;
    if (!c || typeof c.keys !== 'function') return Promise.resolve();
    return c.keys().then(function (names) {
      return Promise.all(names.filter(function (n) { return n.indexOf('ysd-') === 0; }).map(function (n) { return c['delete'](n); }));
    })['catch'](function () {});
  }

  /** Remove registrations of this site's sw.js only (other apps on the origin are left alone). */
  function unregister() {
    if (!('serviceWorker' in nav) || !protocolOk() || typeof nav.serviceWorker.getRegistrations !== 'function') return Promise.resolve(0);
    return nav.serviceWorker.getRegistrations().then(function (regs) {
      var mine = regs.filter(function (r) {
        var wk = r.active || r.waiting || r.installing;
        return wk && wk.scriptURL && wk.scriptURL.split('?')[0] === swUrl.split('?')[0];
      });
      return Promise.all(mine.map(function (r) {
        return clearCaches(r).then(function () { return r.unregister(); });
      })).then(function () {
        if (!mine.length) return 0;
        log('unregistered', mine.length);
        api.registration = null;
        return deletePageCaches().then(function () { return mine.length; });
      });
    })['catch'](function () { return 0; });
  }

  function update() {
    return api.registration ? api.registration.update() : Promise.resolve();
  }

  function applyUpdate() {
    var reg = api.registration;
    if (reg && reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
  }

  if ('serviceWorker' in nav && nav.serviceWorker && nav.serviceWorker.addEventListener) {
    var hadController = !!nav.serviceWorker.controller;
    nav.serviceWorker.addEventListener('controllerchange', function () {
      if (hadController) emit('sw-controller', {});
      hadController = true;
    });
  }
  try {
    w.addEventListener('online', function () { emit('network', { online: true }); });
    w.addEventListener('offline', function () { emit('network', { online: false }); });
  } catch (e) {}

  function boot() {
    var st = enabled();
    if (st.ok) { register(); return; }
    setStatus(st.reason === 'file' ? 'file' : st.reason === 'unsupported' ? 'unsupported' : 'disabled', st.reason);
    emit('sw-disabled', { reason: st.reason });
    if (st.reason !== 'file' && st.reason !== 'unsupported') unregister();
  }

  try {
    if (w.document.readyState === 'complete') setTimeout(boot, 0);
    else w.addEventListener('load', boot);
  } catch (e) {}
})(typeof window !== 'undefined' ? window : this);
