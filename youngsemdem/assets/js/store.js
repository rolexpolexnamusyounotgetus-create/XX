/*!
 * Young Seminole Democrats: state layer.
 *   YSD.store     small JSON key/value store (localStorage, in-memory fallback), keys "ysd:<key>",
 *                 change events across modules and tabs, pluggable production adapter.
 *   YSD.db        Promise-based IndexedDB blob store (bucket + id), in-memory fallback.
 *   YSD.counters  social-proof counters seeded from YSD_DATA.counters (demo baselines are flagged).
 *   YSD.uid       short random ids.
 * Load order: after assets/js/config.js, before everything else. Never throws on missing APIs.
 */
(function (w) {
  'use strict';
  var YSD = w.YSD = w.YSD || {};
  var PREFIX = 'ysd:';
  function cfg(path, fb) { return typeof YSD.cfg === 'function' ? YSD.cfg(path, fb) : fb; }
  function emit(name, detail) { if (typeof YSD.emit === 'function') YSD.emit(name, detail); }
  function log() { if (typeof YSD.log === 'function') YSD.log.apply(null, arguments); }

  // ---------------------------------------------------------------- ids
  function uid(prefix) {
    var s = '';
    try {
      var c = w.crypto || w.msCrypto;
      if (c && c.getRandomValues) {
        var a = new Uint8Array(8); c.getRandomValues(a);
        for (var i = 0; i < a.length; i++) s += (a[i] % 36).toString(36);
      }
    } catch (e) {}
    if (!s) s = Math.random().toString(36).slice(2, 10);
    return (prefix ? prefix + '_' : '') + Date.now().toString(36) + s;
  }
  YSD.uid = uid;

  // ---------------------------------------------------------------- YSD.store
  function probe(kind) {
    try {
      var s = w[kind];
      if (!s) return null;
      var k = PREFIX + '__probe__';
      s.setItem(k, '1'); s.removeItem(k);
      return s;
    } catch (e) { return null; }
  }
  var ls = probe('localStorage');
  var mem = {};            // full key -> JSON string (fallback and quota overflow)
  var listeners = {};      // key -> [cb]   ('*' = every key)
  var adapter = null;
  var warnedFull = false;

  function parse(raw) {
    if (raw === null || raw === undefined) return undefined;
    try { return JSON.parse(raw); } catch (e) { return undefined; }
  }
  function readRaw(full) {
    if (Object.prototype.hasOwnProperty.call(mem, full)) return mem[full];
    if (!ls) return null;
    try { return ls.getItem(full); } catch (e) { return null; }
  }
  function writeRaw(full, raw) {
    if (ls) {
      try { ls.setItem(full, raw); delete mem[full]; return true; } catch (e) {
        if (!warnedFull) { warnedFull = true; emit('storage-full', { key: full, error: String(e && e.name || e) }); }
      }
    }
    mem[full] = raw;
    return false;
  }
  function removeRaw(full) {
    delete mem[full];
    if (ls) { try { ls.removeItem(full); } catch (e) {} }
  }
  function fire(key, value, oldValue, source) {
    var info = { key: key, oldValue: oldValue, source: source };
    var lists = key === '*' ? [listeners['*'] || []] : [listeners[key] || [], listeners['*'] || []];
    for (var l = 0; l < lists.length; l++) {
      var arr = lists[l].slice();
      for (var i = 0; i < arr.length; i++) {
        try { arr[i](value, info); } catch (e) { log('store listener error', key, e); }
      }
    }
  }
  function clone(v) {
    if (v === undefined) return undefined;
    try { return JSON.parse(JSON.stringify(v)); } catch (e) { return v; }
  }

  function get(key, fallback) {
    var v = parse(readRaw(PREFIX + key));
    return v === undefined ? fallback : v;
  }
  function setInternal(key, value, source, forward) {
    var full = PREFIX + key;
    var oldValue = parse(readRaw(full));
    if (value === undefined) { removeRaw(full); }
    else {
      var raw;
      try { raw = JSON.stringify(value); } catch (e) { log('store: value not serialisable', key, e); return value; }
      writeRaw(full, raw);
    }
    if (forward && adapter && matches(key)) {
      try {
        var p = value === undefined ? (adapter.remove && adapter.remove(key)) : (adapter.save && adapter.save(key, clone(value)));
        if (p && typeof p.then === 'function') p.then(null, function (err) { emit('store-error', { key: key, error: String(err) }); });
      } catch (err) { emit('store-error', { key: key, error: String(err) }); }
    }
    fire(key, clone(value), oldValue, source);
    return value;
  }
  function matches(key) {
    if (!adapter) return false;
    if (typeof adapter.match === 'function') { try { return !!adapter.match(key); } catch (e) { return false; } }
    return true;
  }
  function set(key, value) { return setInternal(key, value, 'local', true); }
  function update(key, fn, fallback) {
    var next = fn(get(key, fallback));
    set(key, next);
    return next;
  }
  function remove(key) { setInternal(key, undefined, 'local', true); }
  function list(name) {
    var v = get(name, []);
    return Array.isArray(v) ? v : [];
  }
  /** Append to the array at key `name`. Plain objects get id/ts if missing. Returns the stored item. */
  function push(name, item, opts) {
    var max = (opts && opts.max) || 1000;
    var stored = item;
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      stored = {};
      if (item.id === undefined) stored.id = uid();
      if (item.ts === undefined) stored.ts = Date.now();
      for (var k in item) if (Object.prototype.hasOwnProperty.call(item, k)) stored[k] = item[k];
    }
    update(name, function (arr) {
      arr = Array.isArray(arr) ? arr : [];
      arr.push(stored);
      if (arr.length > max) arr = arr.slice(arr.length - max);
      return arr;
    }, []);
    return stored;
  }
  /** Subscribe to a key ('*' for all). cb(value, {key, oldValue, source}). Returns unsubscribe. */
  function on(key, cb) {
    if (typeof cb !== 'function') return function () {};
    (listeners[key] = listeners[key] || []).push(cb);
    return function off() {
      var arr = listeners[key] || [];
      var i = arr.indexOf(cb);
      if (i >= 0) arr.splice(i, 1);
    };
  }
  function keys() {
    var out = {}, k;
    for (k in mem) if (k.indexOf(PREFIX) === 0) out[k.slice(PREFIX.length)] = 1;
    if (ls) {
      try {
        for (var i = 0; i < ls.length; i++) {
          k = ls.key(i);
          if (k && k.indexOf(PREFIX) === 0) out[k.slice(PREFIX.length)] = 1;
        }
      } catch (e) {}
    }
    return Object.keys(out).filter(function (x) { return x !== '__probe__'; });
  }
  /** Remove every "ysd:" key (this site's data only). */
  function clear() {
    var ks = keys();
    for (var i = 0; i < ks.length; i++) remove(ks[i]);
  }
  /**
   * Production backend seam. adapter = {
   *   name: 'my-backend',
   *   load():  Promise<{key: value} | [[key, value], ...]>   hydrate local cache (optional)
   *   save(key, value): Promise|void                           mirror a write (optional)
   *   remove(key): Promise|void                                mirror a removal (optional)
   *   subscribe(cb(key, value)): unsubscribeFn                 remote changes (optional)
   *   match(key): boolean                                      which keys to sync (optional)
   * }
   * The synchronous API keeps working on the local cache; the adapter mirrors it.
   * Returns a Promise that resolves when load() has hydrated the cache.
   */
  var adapterUnsub = null;
  function useAdapter(a) {
    if (adapterUnsub) { try { adapterUnsub(); } catch (e) {} adapterUnsub = null; }
    adapter = a || null;
    if (!adapter) return Promise.resolve(null);
    var apply = function (key, value) { if (matches(key)) setInternal(key, value === null ? undefined : value, 'adapter', false); };
    if (typeof adapter.subscribe === 'function') {
      try { adapterUnsub = adapter.subscribe(apply) || null; } catch (e) { log('adapter subscribe failed', e); }
    }
    if (typeof adapter.load !== 'function') return Promise.resolve(adapter);
    return Promise.resolve().then(function () { return adapter.load(); }).then(function (data) {
      if (Array.isArray(data)) data.forEach(function (pair) { apply(pair[0], pair[1]); });
      else if (data && typeof data === 'object') Object.keys(data).forEach(function (k) { apply(k, data[k]); });
      return adapter;
    }, function (err) { emit('store-error', { key: null, error: String(err) }); return adapter; });
  }

  // Cross-tab: localStorage "storage" events from other tabs of this origin.
  try {
    if (w.addEventListener) {
      w.addEventListener('storage', function (e) {
        try {
          if (ls && e.storageArea && e.storageArea !== ls) return;
          // key null = another tab called localStorage.clear(): '*' listeners get key '*'.
          if (e.key === null) { fire('*', undefined, undefined, 'remote'); return; }
          if (e.key.indexOf(PREFIX) !== 0) return;
          var key = e.key.slice(PREFIX.length);
          if (key === '__probe__') return;
          fire(key, parse(e.newValue), parse(e.oldValue), 'remote');
        } catch (err) {}
      });
    }
  } catch (e) {}

  YSD.store = {
    prefix: PREFIX,
    backend: ls ? 'localStorage' : 'memory',
    persistent: !!ls,
    get: get, set: set, update: update, remove: remove,
    list: list, push: push, on: on,
    keys: keys, clear: clear,
    useAdapter: useAdapter,
    uid: uid
  };

  // ---------------------------------------------------------------- YSD.db
  var DB_NAME = 'ysd', OS = 'blobs', DB_VERSION = 1, OPEN_TIMEOUT = 4000;
  var memdb = {};           // bucket -> { id: {value, ts} }
  var dbPromise = null;
  var dbApi = { backend: 'pending' };

  function memBucket(b) { return (memdb[b] = memdb[b] || {}); }
  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve) {
      var idb = null;
      try { idb = w.indexedDB || null; } catch (e) { idb = null; }
      if (!idb) { dbApi.backend = 'memory'; resolve(null); return; }
      var settled = false;
      function fallback(why) {
        if (settled) return;
        settled = true; dbApi.backend = 'memory';
        log('db: using memory fallback', why);
        resolve(null);
      }
      var timer = setTimeout(function () { fallback('timeout'); }, OPEN_TIMEOUT);
      var req;
      try { req = idb.open(DB_NAME, DB_VERSION); } catch (e) { clearTimeout(timer); fallback(e); return; }
      req.onupgradeneeded = function () {
        try {
          var db = req.result;
          if (!db.objectStoreNames.contains(OS)) {
            var os = db.createObjectStore(OS, { keyPath: ['bucket', 'id'] });
            os.createIndex('bucket', 'bucket', { unique: false });
          }
        } catch (e) { log('db upgrade failed', e); }
      };
      req.onsuccess = function () {
        clearTimeout(timer);
        var db = req.result;
        if (settled) { try { db.close(); } catch (e) {} return; }
        settled = true;
        db.onversionchange = function () { try { db.close(); } catch (e) {} dbPromise = null; };
        dbApi.backend = 'indexeddb';
        resolve(db);
      };
      req.onerror = function () { clearTimeout(timer); fallback(req.error); };
    });
    return dbPromise;
  }
  function tx(db, mode, fn) {
    return new Promise(function (resolve, reject) {
      var t, result;
      try { t = db.transaction(OS, mode); } catch (e) { reject(e); return; }
      t.oncomplete = function () { resolve(result); };
      t.onerror = function () { reject(t.error); };
      t.onabort = function () { reject(t.error || new Error('aborted')); };
      try {
        var r = fn(t.objectStore(OS));
        if (r) r.onsuccess = function () { result = r.result; };
      } catch (e) { try { t.abort(); } catch (x) {} reject(e); }
    });
  }

  /** Store value (Blob/File/object) under bucket/id. Resolves to id (string). */
  dbApi.put = function (bucket, id, value) {
    bucket = String(bucket); id = String(id);
    var rec = { bucket: bucket, id: id, value: value, ts: Date.now() };
    return openDb().then(function (db) {
      if (!db) { memBucket(bucket)[id] = rec; return id; }
      return tx(db, 'readwrite', function (os) { return os.put(rec); }).then(function () {
        delete memBucket(bucket)[id];
        return id;
      }, function (err) {
        memBucket(bucket)[id] = rec;
        emit('db-fallback', { bucket: bucket, id: id, error: String(err && err.name || err) });
        return id;
      });
    });
  };
  /** Resolves to the stored value, or null when missing. */
  dbApi.get = function (bucket, id) {
    bucket = String(bucket); id = String(id);
    var m = memBucket(bucket)[id];
    if (m) return Promise.resolve(m.value);
    return openDb().then(function (db) {
      if (!db) return null;
      return tx(db, 'readonly', function (os) { return os.get([bucket, id]); })
        .then(function (r) { return r ? r.value : null; }, function () { return null; });
    });
  };
  function allRecords(bucket) {
    bucket = String(bucket);
    return openDb().then(function (db) {
      if (!db) return [];
      if (typeof IDBIndex !== 'undefined' && IDBIndex.prototype && IDBIndex.prototype.getAll) {
        return tx(db, 'readonly', function (os) { return os.index('bucket').getAll(bucket); })
          .then(function (r) { return r || []; }, function () { return []; });
      }
      // Old engines without getAll: walk a cursor.
      var acc = [];
      return tx(db, 'readonly', function (os) {
        var req = os.index('bucket').openCursor(bucket);
        req.onsuccess = function () {
          var c = req.result;
          if (c) { acc.push(c.value); c['continue'](); }
        };
        return null;
      }).then(function () { return acc; }, function () { return acc; });
    }).then(function (recs) {
      var byId = {}, i;
      for (i = 0; i < recs.length; i++) byId[recs[i].id] = recs[i];
      var mb = memBucket(bucket);
      for (var k in mb) byId[k] = mb[k];
      return Object.keys(byId).map(function (k) { return byId[k]; })
        .sort(function (a, b) { return a.ts - b.ts; });
    });
  }
  /** Resolves to every value in the bucket, oldest first. */
  dbApi.all = function (bucket) { return allRecords(bucket).then(function (r) { return r.map(function (x) { return x.value; }); }); };
  /** Resolves to every id in the bucket, oldest first. */
  dbApi.keys = function (bucket) { return allRecords(bucket).then(function (r) { return r.map(function (x) { return x.id; }); }); };
  /** Delete one record. Resolves to true. */
  dbApi.del = function (bucket, id) {
    bucket = String(bucket); id = String(id);
    delete memBucket(bucket)[id];
    return openDb().then(function (db) {
      if (!db) return true;
      return tx(db, 'readwrite', function (os) { return os['delete']([bucket, id]); }).then(function () { return true; }, function () { return true; });
    });
  };
  /** Delete every record in a bucket. Resolves to the number removed. */
  dbApi.clear = function (bucket) {
    return dbApi.keys(bucket).then(function (ids) {
      return Promise.all(ids.map(function (id) { return dbApi.del(bucket, id); })).then(function () { return ids.length; });
    });
  };
  /** Resolves to 'indexeddb' or 'memory' once the database is open. */
  dbApi.ready = function () { return openDb().then(function () { return dbApi.backend; }); };
  YSD.db = dbApi;

  // ---------------------------------------------------------------- YSD.counters
  /*
   * value(name) = baseline + local bumps + demo live ticks      (demo, or production without endpoint)
   *             = server value                                   (production with countersEndpoint)
   * Baseline: YSD_DATA.counters.items[name].base (+ perDay growth since `epoch` in demo).
   * Items are demo unless the data file (or the item) says demo:false. Demo baselines are never
   * shown when YSD_CONFIG.demo is false, so fake social proof cannot leak into production.
   */
  var cListeners = {};
  function cdata() { return (w.YSD_DATA && w.YSD_DATA.counters) || {}; }
  function citems() { return cdata().items || {}; }
  function isDemo() { return cfg('demo', true) !== false; }
  function itemIsDemo(it) {
    if (it && it.demo === false) return false;
    if (it && it.demo === true) return true;
    return cdata().demo !== false;
  }
  function baseline(name) {
    var it = citems()[name];
    if (!it) return 0;
    var demoItem = itemIsDemo(it);
    if (!isDemo() && demoItem) return 0;
    var base = +it.base || 0;
    if (isDemo() && demoItem && it.perDay) {
      var epoch = Date.parse(it.epoch || cdata().epoch || '');
      if (!isNaN(epoch)) {
        var days = Math.max(0, (Date.now() - epoch) / 86400000);
        base += Math.floor(days * +it.perDay);
      }
    }
    return base;
  }
  function remoteMode() { return !isDemo() && !!cfg('integrations.countersEndpoint', ''); }
  function cget(name) {
    name = String(name);
    if (remoteMode()) {
      var r = get('counter:remote:' + name, null);
      if (typeof r === 'number') return r + (get('counter:pending:' + name, 0) || 0);
      return baseline(name) + (get('counter:' + name, 0) || 0);
    }
    var v = baseline(name) + (get('counter:' + name, 0) || 0);
    if (isDemo()) v += get('counter:sim:' + name, 0) || 0;
    return v;
  }
  function cbump(name, n) {
    name = String(name);
    n = n === undefined ? 1 : +n || 0;
    if (remoteMode()) {
      update('counter:pending:' + name, function (v) { return (v || 0) + n; }, 0);
      postCounter(name, n);
    } else {
      update('counter:' + name, function (v) { return (v || 0) + n; }, 0);
    }
    return cget(name);
  }
  function postCounter(name, n) {
    var url = cfg('integrations.countersEndpoint', '');
    if (!url || typeof w.fetch !== 'function') return;
    w.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name, n: n }), keepalive: true })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && typeof j[name] === 'number') {
          update('counter:pending:' + name, function (v) { return Math.max(0, (v || 0) - n); }, 0);
          set('counter:remote:' + name, j[name]);
        }
      })['catch'](function () { /* keep pending; still shown optimistically */ });
  }
  /** Production: pull server values. Demo: resolves to the local values. */
  function crefresh() {
    var url = cfg('integrations.countersEndpoint', '');
    if (!remoteMode() || typeof w.fetch !== 'function') return Promise.resolve(call());
    return w.fetch(url, { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (j) {
        Object.keys(j || {}).forEach(function (k) {
          if (typeof j[k] === 'number') { set('counter:pending:' + k, 0); set('counter:remote:' + k, j[k]); }
        });
        return call();
      }, function () { return call(); });
  }
  function cnames() {
    var out = {}, k;
    for (k in citems()) out[k] = 1;
    keys().forEach(function (key) {
      var m = /^counter:(?:(?:sim|remote|pending):)?(.+)$/.exec(key);
      if (m) out[m[1]] = 1;
    });
    return Object.keys(out);
  }
  function call() {
    var out = {};
    cnames().forEach(function (n) { out[n] = cget(n); });
    return out;
  }
  function con(name, cb) {
    if (typeof cb !== 'function') return function () {};
    name = String(name);
    (cListeners[name] = cListeners[name] || []).push(cb);
    return function () {
      var arr = cListeners[name] || [], i = arr.indexOf(cb);
      if (i >= 0) arr.splice(i, 1);
    };
  }
  function cnotify(name) {
    var v = cget(name);
    var arr = (cListeners[name] || []).concat(cListeners['*'] || []);
    for (var i = 0; i < arr.length; i++) { try { arr[i](v, name); } catch (e) { log('counter listener error', e); } }
    emit('counter', { name: name, value: v });
  }
  // Every counter write goes through YSD.store, so one listener covers same-tab and cross-tab.
  on('*', function (value, info) {
    if (!info || typeof info.key !== 'string') return;
    var m = /^counter:(?:(?:sim|remote|pending):)?(.+)$/.exec(info.key);
    if (m) cnotify(m[1]);
  });
  /** Compact display: 987 -> "987", 1234 -> "1,234", 12500 -> "12.5K". */
  function cformat(n, opts) {
    n = +n || 0;
    var compactFrom = (opts && opts.compactFrom) || 10000;
    try {
      if (Math.abs(n) >= compactFrom && typeof Intl !== 'undefined') {
        return new Intl.NumberFormat(cfg('site.lang', 'en'), { notation: 'compact', maximumFractionDigits: 1 }).format(n);
      }
      if (typeof Intl !== 'undefined') return new Intl.NumberFormat(cfg('site.lang', 'en')).format(n);
    } catch (e) {}
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  // Demo-only live ticks: "other people" bump counters while the page is visible. Persisted under
  // counter:sim:<name> so reloads never go backwards; wiped by YSD.counters.resetDemo().
  var liveTimer = null, liveTicks = 0, liveOpts = null;
  function liveEligible() {
    return isDemo() && cfg('features.demoLiveCounters', true) !== false && cdata().demo !== false;
  }
  function liveStart(opts) {
    liveStop();
    liveOpts = opts || {};
    if (!liveEligible() && !liveOpts.force) return false;
    var minMs = liveOpts.minMs || 7000, maxMs = liveOpts.maxMs || 22000, maxTicks = liveOpts.maxTicks || 40;
    liveTicks = 0;
    var schedule = function () {
      liveTimer = setTimeout(function () {
        liveTimer = null;
        try {
          var hidden = w.document && w.document.hidden;
          if (!hidden) {
            var items = citems(), names = [], weights = [], total = 0;
            for (var k in items) {
              if (items[k].live === false || !itemIsDemo(items[k])) continue;
              var wgt = Math.max(0.1, +items[k].perDay || 1);
              names.push(k); weights.push(wgt); total += wgt;
            }
            if (names.length) {
              var r = Math.random() * total, pick = names[0];
              for (var i = 0; i < names.length; i++) { r -= weights[i]; if (r <= 0) { pick = names[i]; break; } }
              update('counter:sim:' + pick, function (v) { return (v || 0) + 1; }, 0);
              liveTicks++;
            }
          }
        } catch (e) {}
        if (liveTicks < maxTicks) schedule();
      }, minMs + Math.random() * Math.max(0, maxMs - minMs));
    };
    schedule();
    return true;
  }
  function liveStop() { if (liveTimer) { clearTimeout(liveTimer); liveTimer = null; } }
  function resetDemo() {
    keys().forEach(function (k) { if (/^counter:sim:/.test(k)) remove(k); });
  }
  function autoStartLive() { if (liveEligible() && !liveTimer) liveStart(); }
  try {
    if (w.document && w.document.readyState === 'loading') w.document.addEventListener('DOMContentLoaded', autoStartLive);
    else setTimeout(autoStartLive, 0);
  } catch (e) {}

  YSD.counters = {
    get: cget, bump: cbump, on: con, all: call, names: cnames, refresh: crefresh,
    format: cformat, baseline: baseline,
    isDemo: function (name) { var it = citems()[name]; return isDemo() && (!it || itemIsDemo(it)); },
    startLive: liveStart, stopLive: liveStop, resetDemo: resetDemo
  };
})(typeof window !== 'undefined' ? window : this);
