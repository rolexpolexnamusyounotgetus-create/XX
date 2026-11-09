/*!
 * Young Democrats of Seminole County: service worker (tooling workstream; docs/infra/tooling.md).
 *
 * Registered by assets/js/sw-register.js (only on http/https, never on file://, and not in demo
 * mode unless YSD_CONFIG.pwa.serviceWorkerInDemo is true).
 *
 * Strategy
 *  - Pages (navigations): network first. A good response is cached (keyed without ?query, so
 *    ?ref= and utm_* share links share one entry). When the network fails, or takes longer than
 *    NETWORK_TIMEOUT_MS and a cached copy exists, the cached page is served; with no cached copy,
 *    offline.html (owned by the design team; may not exist yet), else a built-in plain page.
 *  - Same-origin assets (js, css, images, fonts, data, manifest): stale-while-revalidate.
 *  - Cross-origin: only Google Fonts and Unsplash, and only CORS (non-opaque) responses.
 *  - Never cached or touched: /api/*, /.netlify/*, /cdn-cgi/*, non-GET requests, Range requests
 *    (video), video/audio files, and this file.
 *
 * Deploys: bump VERSION to drop every old cache at once (DEPLOY.md). Messages from pages:
 *   {type:'SKIP_WAITING'}  activate a waiting worker now
 *   {type:'CLEAR_CACHES'}  delete this site's caches (sw-register's YSD.sw.unregister() sends it)
 *   {type:'VERSION'}       replies on the message port with {version}
 */
'use strict';

var VERSION = 'ysd-v1';
var PREFIX = 'ysd-';
var PAGES = VERSION + '-pages';
var ASSETS = VERSION + '-assets';
var MAX_PAGES = 40;
var MAX_ASSETS = 150;
var NETWORK_TIMEOUT_MS = 4000;

var SCOPE = (self.registration && self.registration.scope) || new URL('./', self.location.href).href;
var SCOPE_PATH = new URL(SCOPE).pathname;
var OFFLINE_URL = new URL('offline.html', SCOPE).href;
var CROSS_ORIGIN_OK = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com', 'https://images.unsplash.com'];
var ASSET_EXT = /\.(?:js|mjs|css|json|webmanifest|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf)$/i;
var MEDIA_EXT = /\.(?:mp4|m4v|mov|webm|ogv|ogg|mp3|m4a|wav|aac|m3u8|mpd|ts)$/i;
var offlineTried = false;
var retired = false;   // set by CLEAR_CACHES: the page is unregistering this worker

function noop() {}

function isNeverTouch(url) {
  var p = url.pathname;
  if (url.origin !== self.location.origin) return false;
  if (p.indexOf(SCOPE_PATH + 'api/') === 0 || p.indexOf('/api/') === 0) return true;
  if (p.indexOf('/.netlify/') === 0 || p.indexOf('/cdn-cgi/') === 0) return true;
  if (p === SCOPE_PATH + 'sw.js') return true;
  return false;
}

function isNavigation(req) {
  if (req.mode === 'navigate') return true;
  if (req.destination === 'document') return true;
  var accept = req.headers.get('accept') || '';
  return req.destination === '' && accept.indexOf('text/html') >= 0 && !ASSET_EXT.test(new URL(req.url).pathname);
}

function cacheable(res) {
  if (!res || res.status !== 200) return false;
  if (res.type !== 'basic' && res.type !== 'cors' && res.type !== 'default') return false;
  var cc = res.headers.get('cache-control') || '';
  return !/no-store/i.test(cc);
}

function pageKey(url) {
  var u = new URL(url);
  u.search = '';
  u.hash = '';
  return u.href;
}

function trim(cacheName, max) {
  return caches.open(cacheName).then(function (cache) {
    return cache.keys().then(function (keys) {
      var extra = keys.length - max, jobs = [];
      for (var i = 0; i < extra; i++) jobs.push(cache['delete'](keys[i]));
      return Promise.all(jobs);
    });
  })['catch'](noop);
}

function putPage(key, res) {
  return caches.open(PAGES).then(function (cache) {
    return cache.put(key, res);
  }).then(function () { return trim(PAGES, MAX_PAGES); })['catch'](noop);
}

/** Cached copy of a page: exact path, then dir/index.html, then pretty URL (/about -> about.html). */
function matchPage(url) {
  var key = pageKey(url);
  var tries = [key];
  var u = new URL(key);
  if (/\/$/.test(u.pathname)) tries.push(key + 'index.html');
  else if (/\/index\.html$/.test(u.pathname)) tries.push(key.replace(/index\.html$/, ''));
  else if (!/\.[a-z0-9]+$/i.test(u.pathname)) tries.push(key + '.html');
  else if (/\.html$/i.test(u.pathname)) tries.push(key.replace(/\.html$/i, ''));
  return caches.open(PAGES).then(function (cache) {
    var i = 0;
    function next() {
      if (i >= tries.length) return undefined;
      return cache.match(tries[i++]).then(function (hit) { return hit || next(); });
    }
    return next();
  })['catch'](function () { return undefined; });
}

function builtInOffline() {
  var html = '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="robots" content="noindex"><title>You are offline</title></head>' +
    '<body data-ysd-offline="builtin"><main><h1>You are offline</h1>' +
    '<p>This page is not saved on this device yet. Reconnect and try again.</p>' +
    '<p><a href="' + SCOPE + '">Go to the home page</a></p></main></body></html>';
  return new Response(html, {
    status: 503,
    statusText: 'Offline',
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function offlineResponse() {
  return caches.match(OFFLINE_URL).then(function (hit) { return hit || builtInOffline(); })
    ['catch'](function () { return builtInOffline(); });
}

/** Cache offline.html if it exists. A missing file is fine (design team adds it later). */
function cacheOfflinePage() {
  return fetch(new Request(OFFLINE_URL, { cache: 'reload', credentials: 'same-origin' })).then(function (res) {
    if (!cacheable(res)) return;
    return caches.open(PAGES).then(function (cache) { return cache.put(OFFLINE_URL, res); });
  })['catch'](noop);
}

function networkFirst(event) {
  var req = event.request;
  var cacheDone = Promise.resolve();
  var network = Promise.resolve(event.preloadResponse).then(function (pre) {
    return pre || fetch(req);
  }).then(function (res) {
    if (cacheable(res) && !res.redirected) cacheDone = putPage(pageKey(req.url), res.clone());
    if (!offlineTried) {
      offlineTried = true;
      cacheDone = cacheDone.then(function () {
        return caches.match(OFFLINE_URL).then(function (hit) { return hit || cacheOfflinePage(); });
      });
    }
    return res;
  });
  event.waitUntil(network.then(function () { return cacheDone; }, noop));

  return new Promise(function (resolve) {
    var settled = false;
    function done(res) { if (!settled) { settled = true; resolve(res); } }
    var timer = setTimeout(function () {
      matchPage(req.url).then(function (hit) { if (hit) done(hit); });
    }, NETWORK_TIMEOUT_MS);
    network.then(function (res) {
      clearTimeout(timer);
      done(res);
    }, function () {
      clearTimeout(timer);
      matchPage(req.url).then(function (hit) { return hit || offlineResponse(); }).then(done);
    });
  });
}

function staleWhileRevalidate(event) {
  var req = event.request;
  return caches.open(ASSETS).then(function (cache) {
    return cache.match(req).then(function (hit) {
      var network = fetch(req).then(function (res) {
        if (cacheable(res)) {
          var copy = res.clone();
          event.waitUntil(cache.put(req, copy).then(function () { return trim(ASSETS, MAX_ASSETS); })['catch'](noop));
        }
        return res;
      });
      if (hit) {
        event.waitUntil(network.then(noop, noop));
        return hit;
      }
      return network;
    });
  });
}

self.addEventListener('install', function (event) {
  event.waitUntil(cacheOfflinePage().then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (n) {
        if (n.indexOf(PREFIX) === 0 && n !== PAGES && n !== ASSETS) return caches['delete'](n);
      }));
    }).then(function () {
      if (self.registration.navigationPreload) return self.registration.navigationPreload.enable()['catch'](noop);
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (retired || req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
  if (isNeverTouch(url)) return;
  if (req.headers.has('range')) return;
  if (MEDIA_EXT.test(url.pathname) || req.destination === 'video' || req.destination === 'audio') return;

  if (url.origin === self.location.origin) {
    if (isNavigation(req)) { event.respondWith(networkFirst(event)); return; }
    var dest = req.destination;
    if (ASSET_EXT.test(url.pathname) || dest === 'script' || dest === 'style' || dest === 'image' ||
        dest === 'font' || dest === 'manifest') {
      event.respondWith(staleWhileRevalidate(event));
    }
    return;
  }
  if (CROSS_ORIGIN_OK.indexOf(url.origin) >= 0 && req.mode === 'cors') {
    event.respondWith(staleWhileRevalidate(event));
  }
});

self.addEventListener('message', function (event) {
  var data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
  else if (data.type === 'CLEAR_CACHES') {
    retired = true;
    event.waitUntil(caches.keys().then(function (names) {
      return Promise.all(names.filter(function (n) { return n.indexOf(PREFIX) === 0; }).map(function (n) { return caches['delete'](n); }));
    }).then(function () {
      if (event.ports && event.ports[0]) event.ports[0].postMessage({ cleared: true });
    }));
  } else if (data.type === 'VERSION') {
    if (event.ports && event.ports[0]) event.ports[0].postMessage({ version: VERSION });
  }
});
