/*!
 * Young Seminole Democrats: video clips (YSD.clips). Video workstream; API in docs/infra/video.md.
 *
 * Member video posts, kept in the browser in demo mode:
 *   - validate(file) checks type and size synchronously; check(file) adds duration/playability.
 *   - probe(file) reads duration, size, orientation and a JPEG poster frame with a hidden
 *     <video> + <canvas> (also fixes WebM files that report an Infinity duration).
 *   - add(file, {caption, author, tags}) stores the file in IndexedDB (YSD.db when loaded, an own
 *     fallback otherwise), the metadata in YSD.store, and returns the clip.
 *   - list({sort}) merges demo clips (YSD_DATA.clips, hidden when YSD_CONFIG.demo is false),
 *     a production source (useSource) and this browser's clips; get, like, view, remove.
 *   - Object URLs are created lazily, cached per clip and revoked on remove/release.
 *   - Production seam: when YSD_CONFIG.demo is false and integrations.videoUploadEndpoint is set,
 *     add() asks that endpoint for a one-time direct-upload URL (Cloudflare Stream or Mux; see
 *     functions/api/video-upload.js) and uploads with XMLHttpRequest progress events.
 *
 * Events (document, via YSD.emit, all prefixed "ysd:"): clip-added, clip-rejected, clip-removed,
 * clip-liked, clip-view, clip-upload-start, clip-upload-progress, clip-uploaded,
 * clip-upload-failed, clip-ready, clips-changed. No styling here.
 * Load after config.js and store.js (both optional); classic script, no modules, no fetch of
 * local files, works from file://.
 */
(function (w) {
  'use strict';
  var YSD = w.YSD = w.YSD || {};
  var doc = w.document;
  var hasOwn = Object.prototype.hasOwnProperty;

  // ------------------------------------------------------------------ small shared helpers
  function cfg(path, fb) { return typeof YSD.cfg === 'function' ? YSD.cfg(path, fb) : fb; }
  function emit(name, detail) {
    if (typeof YSD.emit === 'function') { YSD.emit(name, detail); return; }
    try { doc.dispatchEvent(new w.CustomEvent('ysd:' + name, { detail: detail })); } catch (e) {}
  }
  function log() { if (typeof YSD.log === 'function') YSD.log.apply(null, ['[clips]'].concat([].slice.call(arguments))); }
  function track(ev, props) { try { if (typeof YSD.track === 'function') YSD.track(ev, props); } catch (e) {} }
  function isDemo() { return cfg('demo', true) !== false; }
  function uid(prefix) {
    if (typeof YSD.uid === 'function') return YSD.uid(prefix);
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  function assign(t) {
    for (var i = 1; i < arguments.length; i++) {
      var s = arguments[i];
      if (s) for (var k in s) if (hasOwn.call(s, k)) t[k] = s[k];
    }
    return t;
  }
  function copy(v) { try { return JSON.parse(JSON.stringify(v)); } catch (e) { return v; } }
  function now() { return Date.now(); }
  function noop() {}
  function mkErr(code, message) { var e = new Error(message || messages[code] || code); e.code = code; return e; }

  // ------------------------------------------------------------------ limits and messages
  var DEFAULTS = {
    maxBytes: 150 * 1024 * 1024,      // 150 MB
    maxDuration: 180,                 // 3 minutes
    minDuration: 0.5,
    types: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v', 'video/3gpp', 'video/3gpp2', 'video/ogg', 'video/x-matroska'],
    extensions: ['mp4', 'm4v', 'mov', 'webm', '3gp', '3g2', 'ogv', 'mkv'],
    captionMax: 300,
    tagsMax: 8,
    posterMaxSide: 720,
    posterQuality: 0.82,
    probeTimeout: 15000,
    pollInterval: 5000,
    pollTries: 60
  };
  /** Effective limits: defaults < YSD_CONFIG.clips < per-call opts. */
  function limits(opts) {
    var out = assign({}, DEFAULTS), c = cfg('clips', null);
    if (c && typeof c === 'object') for (var k in DEFAULTS) if (hasOwn.call(c, k) && c[k] != null) out[k] = c[k];
    if (opts) for (var j in DEFAULTS) if (hasOwn.call(opts, j) && opts[j] != null) out[j] = opts[j];
    return out;
  }
  /** User-facing copy, keyed by result code. The design/content team may overwrite entries. */
  var messages = {
    'no-file': 'Choose a video to post.',
    'type': 'That file is not a video we can post. Try MP4, MOV or WebM.',
    'empty': 'That video file is empty.',
    'size': 'Videos can be up to {max}. This one is {size}.',
    'duration': 'Videos can be up to {max} long. This one is {duration}.',
    'too-short': 'That video is too short.',
    'unplayable': 'This browser cannot play that video. Try exporting it as MP4.',
    'timeout': 'That video took too long to open. Try a shorter clip.',
    'missing': 'That video is no longer stored on this device.',
    'demo': 'Uploads are off in the demo. Your clip stays on this device.',
    'no-endpoint': 'Video uploads are not set up yet.',
    'network': 'Upload failed: check your connection and try again.',
    'aborted': 'Upload cancelled.',
    'create-failed': 'We could not start the upload. Please try again.',
    'upload-failed': 'Upload failed. Please try again.',
    'interrupted': 'The upload stopped when the page closed. Tap retry.'
  };
  function msg(code, vars) {
    var s = messages[code] || code;
    return s.replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? vars[k] : m; });
  }
  function formatBytes(n) {
    n = +n || 0;
    if (n >= 1024 * 1024 * 1024) return (n / 1073741824).toFixed(1).replace(/\.0$/, '') + ' GB';
    if (n >= 1024 * 1024) return (n / 1048576).toFixed(n >= 10 * 1048576 ? 0 : 1).replace(/\.0$/, '') + ' MB';
    if (n >= 1024) return Math.round(n / 1024) + ' KB';
    return n + ' B';
  }
  function formatDuration(sec) {
    sec = Math.max(0, Math.round(+sec || 0));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  // ------------------------------------------------------------------ site-root path resolution
  // Data files use site-root-relative paths ("assets/video/x.mp4"). Pages may live in sub-folders,
  // so resolve against this script's own URL (works on file://, localhost and real domains).
  var siteBase = (function () {
    try {
      var s = doc && doc.currentScript && doc.currentScript.src;
      if (!s && doc) {
        var all = doc.getElementsByTagName('script');
        for (var i = all.length - 1; i >= 0; i--) if (/assets\/js\/clips\.js(?:[?#]|$)/.test(all[i].src)) { s = all[i].src; break; }
      }
      if (s && /assets\/js\/clips\.js(?:[?#].*)?$/.test(s)) return s.replace(/assets\/js\/clips\.js(?:[?#].*)?$/, '');
    } catch (e) {}
    return '';
  })();
  function resolve(path) {
    if (!path || typeof path !== 'string') return path || null;
    if (/^(?:[a-z][a-z0-9+.\-]*:|\/\/|\/|#)/i.test(path)) return path;   // absolute, blob:, data:, root-relative
    return siteBase ? siteBase + path : path;
  }

  // ------------------------------------------------------------------ storage (YSD.store / YSD.db or fallbacks)
  var miniStore = null;
  function S() {
    if (YSD.store && typeof YSD.store.get === 'function') return YSD.store;
    if (miniStore) return miniStore;
    var mem = {}, ls = null;
    try { ls = w.localStorage; ls.setItem('ysd:__clips_probe__', '1'); ls.removeItem('ysd:__clips_probe__'); } catch (e) { ls = null; }
    function read(k) { if (hasOwn.call(mem, k)) return mem[k]; try { return ls ? ls.getItem('ysd:' + k) : null; } catch (e) { return null; } }
    miniStore = {
      get: function (k, fb) { var r = read(k); if (r == null) return fb; try { return JSON.parse(r); } catch (e) { return fb; } },
      set: function (k, v) {
        var raw = JSON.stringify(v);
        try { if (ls) { ls.setItem('ysd:' + k, raw); delete mem[k]; } else mem[k] = raw; } catch (e) { mem[k] = raw; }
        emit('store-change', { key: k });
        return v;
      },
      update: function (k, fn, fb) { var v = fn(miniStore.get(k, fb)); miniStore.set(k, v); return v; },
      remove: function (k) { delete mem[k]; try { if (ls) ls.removeItem('ysd:' + k); } catch (e) {} },
      on: function (k, cb) {
        function h(e) { if (e.key === 'ysd:' + k) { try { cb(JSON.parse(e.newValue), { key: k, source: 'remote' }); } catch (x) {} } }
        try { w.addEventListener('storage', h); } catch (e) {}
        return function () { try { w.removeEventListener('storage', h); } catch (e) {} };
      }
    };
    return miniStore;
  }

  var ownDb = null;
  function D() {
    if (YSD.db && typeof YSD.db.put === 'function') return YSD.db;
    if (ownDb) return ownDb;
    // Minimal IndexedDB blob store with an in-memory fallback (same API subset as YSD.db).
    var memdb = {}, open = null;
    function mb(b) { return (memdb[b] = memdb[b] || {}); }
    function openDb() {
      if (open) return open;
      open = new Promise(function (resolveDb) {
        var idb = null;
        try { idb = w.indexedDB || null; } catch (e) {}
        if (!idb) { ownDb.backend = 'memory'; resolveDb(null); return; }
        var settled = false, timer = setTimeout(function () { if (!settled) { settled = true; ownDb.backend = 'memory'; resolveDb(null); } }, 4000);
        var req;
        try { req = idb.open('ysd-clips', 1); } catch (e) { clearTimeout(timer); ownDb.backend = 'memory'; resolveDb(null); return; }
        req.onupgradeneeded = function () { try { req.result.createObjectStore('blobs', { keyPath: ['bucket', 'id'] }); } catch (e) {} };
        req.onsuccess = function () { clearTimeout(timer); if (settled) return; settled = true; ownDb.backend = 'indexeddb'; resolveDb(req.result); };
        req.onerror = function () { clearTimeout(timer); if (settled) return; settled = true; ownDb.backend = 'memory'; resolveDb(null); };
      });
      return open;
    }
    function tx(db, mode, fn) {
      return new Promise(function (res, rej) {
        var t, out;
        try { t = db.transaction('blobs', mode); } catch (e) { rej(e); return; }
        t.oncomplete = function () { res(out); };
        t.onerror = t.onabort = function () { rej(t.error || new Error('idb')); };
        var r = fn(t.objectStore('blobs'));
        if (r) r.onsuccess = function () { out = r.result; };
      });
    }
    ownDb = {
      backend: 'pending',
      put: function (b, id, v) {
        return openDb().then(function (db) {
          if (!db) { mb(b)[id] = v; return id; }
          return tx(db, 'readwrite', function (os) { return os.put({ bucket: b, id: id, value: v, ts: now() }); })
            .then(function () { return id; }, function (err) { mb(b)[id] = v; emit('db-fallback', { bucket: b, id: id, error: String(err) }); return id; });
        });
      },
      get: function (b, id) {
        if (hasOwn.call(mb(b), id)) return Promise.resolve(mb(b)[id]);
        return openDb().then(function (db) {
          if (!db) return null;
          return tx(db, 'readonly', function (os) { return os.get([b, id]); }).then(function (r) { return r ? r.value : null; }, function () { return null; });
        });
      },
      del: function (b, id) {
        delete mb(b)[id];
        return openDb().then(function (db) {
          if (!db) return true;
          return tx(db, 'readwrite', function (os) { return os['delete']([b, id]); }).then(function () { return true; }, function () { return true; });
        });
      }
    };
    return ownDb;
  }

  var K_LOCAL = 'clips:local', K_LIKED = 'clips:liked', K_VIEWS = 'clips:views', K_HIDDEN = 'clips:hidden';
  var B_FILES = 'clips', B_POSTERS = 'clip-posters';
  var SESSION = uid('s');                 // this page load (non-persisted clips die with it)

  function locals() { var a = S().get(K_LOCAL, []); return Array.isArray(a) ? a : []; }
  function findLocal(id) { var a = locals(); for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i]; return null; }
  function patchLocal(id, patch) {
    var out = null;
    S().update(K_LOCAL, function (arr) {
      arr = Array.isArray(arr) ? arr : [];
      return arr.map(function (r) {
        if (r.id !== id) return r;
        out = assign({}, r, patch);
        if (patch && patch.upload && r.upload) out.upload = assign({}, r.upload, patch.upload);
        return out;
      });
    }, []);
    changed('update', id);
    return out;
  }
  function changed(reason, id) { emit('clips-changed', { reason: reason, id: id || null }); }

  /** Store a blob; resolves true when it really reached persistent storage (not memory). */
  function saveBlob(bucket, id, blob) {
    var db = D(), fellBack = false;
    function onFb(e) { if (e && e.detail && String(e.detail.id) === String(id)) fellBack = true; }
    try { doc.addEventListener('ysd:db-fallback', onFb); } catch (e) {}
    function off() { try { doc.removeEventListener('ysd:db-fallback', onFb); } catch (e) {} }
    return Promise.resolve().then(function () { return db.put(bucket, id, blob); }).then(function () {
      off();
      return !fellBack && db.backend !== 'memory';
    }, function (err) { off(); throw err; });
  }

  // ------------------------------------------------------------------ object URL lifecycle
  var urls = {};            // bucket + ':' + id -> object URL
  function urlKey(bucket, id) { return bucket + ':' + id; }
  function cacheUrl(bucket, id, blob) {
    var k = urlKey(bucket, id);
    if (urls[k]) return urls[k];
    try { urls[k] = w.URL.createObjectURL(blob); } catch (e) { return null; }
    return urls[k];
  }
  function objectUrl(bucket, id) {
    var k = urlKey(bucket, id);
    if (urls[k]) return Promise.resolve(urls[k]);
    return Promise.resolve().then(function () { return D().get(bucket, id); }).then(function (blob) {
      return blob ? cacheUrl(bucket, id, blob) : null;
    }, function () { return null; });
  }
  /** Revoke the object URLs of one clip (they are re-created on the next list/get). */
  function release(id) {
    [B_FILES, B_POSTERS].forEach(function (b) {
      var k = urlKey(b, id);
      if (urls[k]) { try { w.URL.revokeObjectURL(urls[k]); } catch (e) {} delete urls[k]; }
    });
  }
  function releaseAll() { Object.keys(urls).forEach(function (k) { try { w.URL.revokeObjectURL(urls[k]); } catch (e) {} delete urls[k]; }); }

  // ------------------------------------------------------------------ validation and probing
  function extOf(name) { var m = /\.([a-z0-9]+)$/i.exec(String(name || '')); return m ? m[1].toLowerCase() : ''; }
  var EXT_TYPES = { mp4: 'video/mp4', m4v: 'video/x-m4v', mov: 'video/quicktime', webm: 'video/webm', '3gp': 'video/3gpp', '3g2': 'video/3gpp2', ogv: 'video/ogg', mkv: 'video/x-matroska' };
  function result(ok, code, vars, extra) {
    return assign({ ok: ok, code: code, reason: ok ? '' : msg(code, vars) }, extra || {});
  }
  /**
   * Synchronous checks: type (MIME, or extension when the browser gives no MIME) and size.
   * opts.duration (seconds) adds a duration check. Returns {ok, reason, code, type, size}.
   */
  function validate(file, opts) {
    var L = limits(opts);
    if (!file || typeof file !== 'object' || typeof file.size !== 'number') return result(false, 'no-file');
    var type = String(file.type || '').toLowerCase().split(';')[0], ext = extOf(file.name);
    var typeOk = type ? L.types.indexOf(type) >= 0 : L.extensions.indexOf(ext) >= 0;
    var info = { type: type || EXT_TYPES[ext] || '', size: file.size };
    if (!typeOk) return result(false, 'type', null, info);
    if (file.size <= 0) return result(false, 'empty', null, info);
    if (file.size > L.maxBytes) return result(false, 'size', { max: formatBytes(L.maxBytes), size: formatBytes(file.size) }, info);
    var d = opts && opts.duration;
    if (typeof d === 'number' && isFinite(d)) {
      if (d > L.maxDuration + 0.5) return result(false, 'duration', { max: formatDuration(L.maxDuration), duration: formatDuration(d) }, info);
      if (d < L.minDuration) return result(false, 'too-short', null, info);
    }
    return result(true, 'ok', null, info);
  }

  function orientationOf(wd, ht) {
    if (!wd || !ht) return null;
    var r = wd / ht;
    if (r < 0.95) return 'vertical';
    if (r > 1.05) return 'horizontal';
    return 'square';
  }

  /**
   * Read a video's metadata and a poster frame. input: File/Blob or URL string.
   * Resolves (never rejects) to {duration, width, height, orientation, aspect, playable,
   * poster: Blob|null, posterType, error: null|'unplayable'|'timeout'}.
   * opts: {posterAt: seconds (default min(1, 10% of duration)), poster: false to skip,
   *        posterMaxSide, posterQuality, timeout}
   */
  function probe(input, opts) {
    opts = opts || {};
    var L = limits(opts);
    return new Promise(function (done) {
      var meta = { duration: NaN, width: 0, height: 0, orientation: null, aspect: null, playable: false, poster: null, posterType: null, error: null };
      if (!doc || !input) { meta.error = 'unplayable'; done(meta); return; }
      var url, revoke = false;
      if (typeof input === 'string') url = input;
      else { try { url = w.URL.createObjectURL(input); revoke = true; } catch (e) { meta.error = 'unplayable'; done(meta); return; } }
      var v = doc.createElement('video');
      v.muted = true; v.defaultMuted = true; v.playsInline = true; v.preload = 'auto';
      v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('aria-hidden', 'true');
      if (typeof input === 'string' && opts.crossOrigin !== false && !/^(blob|data):/.test(input)) v.crossOrigin = 'anonymous';
      v.style.cssText = 'position:fixed;left:-10000px;top:0;width:4px;height:4px;opacity:0;pointer-events:none;';
      var finished = false, stage = 'meta';
      var timer = setTimeout(function () { finish(meta.playable ? null : 'timeout'); }, L.probeTimeout);
      function finish(err) {
        if (finished) return;
        finished = true; clearTimeout(timer);
        if (err && !meta.error) meta.error = err;
        try { v.removeAttribute('src'); v.load(); } catch (e) {}
        if (v.parentNode) v.parentNode.removeChild(v);
        if (revoke) { try { w.URL.revokeObjectURL(url); } catch (e) {} }
        done(meta);
      }
      function capture() {
        if (opts.poster === false) { finish(); return; }
        try {
          var vw = v.videoWidth, vh = v.videoHeight;
          if (!vw || !vh) { finish(); return; }
          var sc = Math.min(1, L.posterMaxSide / Math.max(vw, vh));
          var c = doc.createElement('canvas');
          c.width = Math.max(1, Math.round(vw * sc)); c.height = Math.max(1, Math.round(vh * sc));
          var ctx = c.getContext('2d');
          ctx.drawImage(v, 0, 0, c.width, c.height);
          if (!c.toBlob) { finish(); return; }
          c.toBlob(function (b) {
            if (b) { meta.poster = b; meta.posterType = b.type || 'image/jpeg'; }
            finish();
          }, 'image/jpeg', L.posterQuality);
        } catch (e) { log('poster capture failed', e); finish(); }   // tainted canvas etc.
      }
      function seekForPoster() {
        stage = 'poster';
        if (opts.poster === false) { finish(); return; }
        var d = meta.duration, at = typeof opts.posterAt === 'number' ? opts.posterAt : Math.min(1, (isFinite(d) ? d : 1) * 0.1);
        if (isFinite(d)) at = Math.max(0, Math.min(at, d - 0.05));
        if (at <= 0.01 && v.readyState >= 2 && v.currentTime < 0.02) { raf(capture); return; }
        var onSeeked = function () { v.removeEventListener('seeked', onSeeked); raf(capture); };
        v.addEventListener('seeked', onSeeked);
        try { v.currentTime = Math.max(at, 0.001); } catch (e) { v.removeEventListener('seeked', onSeeked); finish(); }
      }
      function raf(fn) { if (w.requestAnimationFrame) w.requestAnimationFrame(function () { setTimeout(fn, 0); }); else setTimeout(fn, 16); }
      v.addEventListener('error', function () { if (stage === 'meta') finish('unplayable'); else finish(); });
      v.addEventListener('loadedmetadata', function () {
        meta.playable = true;
        meta.width = v.videoWidth; meta.height = v.videoHeight;
        meta.orientation = orientationOf(meta.width, meta.height);
        meta.aspect = meta.height ? Math.round(meta.width / meta.height * 1000) / 1000 : null;
        if (isFinite(v.duration) && v.duration > 0) { meta.duration = v.duration; seekForPoster(); return; }
        // MediaRecorder WebM reports Infinity until the end is seeked once.
        stage = 'duration';
        var fix = function () {
          if (isFinite(v.duration) && v.duration > 0) {
            v.removeEventListener('durationchange', fix); v.removeEventListener('timeupdate', fix); v.removeEventListener('seeked', fix);
            meta.duration = v.duration;
            seekForPoster();
          }
        };
        v.addEventListener('durationchange', fix); v.addEventListener('timeupdate', fix); v.addEventListener('seeked', fix);
        try { v.currentTime = 1e7; } catch (e) { finish(); }
      });
      doc.body ? doc.body.appendChild(v) : doc.documentElement.appendChild(v);
      v.src = url;
      try { v.load(); } catch (e) {}
    });
  }

  /** validate() + probe() + duration/playability checks. Resolves {ok, reason, code, meta}. */
  function check(file, opts) {
    opts = opts || {};
    var v = validate(file, opts);
    if (!v.ok) return Promise.resolve(assign(v, { meta: null }));
    return probe(file, opts).then(function (meta) {
      var L = limits(opts), info = { type: v.type, size: v.size, meta: meta };
      var allowUnplayable = opts.allowUnplayable != null ? !!opts.allowUnplayable : uploadEnabled();
      if (!meta.playable && !allowUnplayable) return result(false, meta.error === 'timeout' ? 'timeout' : 'unplayable', null, info);
      if (isFinite(meta.duration)) {
        if (meta.duration > L.maxDuration + 0.5) return result(false, 'duration', { max: formatDuration(L.maxDuration), duration: formatDuration(meta.duration) }, info);
        if (meta.duration < L.minDuration) return result(false, 'too-short', null, info);
      }
      return result(true, 'ok', null, info);
    });
  }

  // ------------------------------------------------------------------ normalising clips
  function cleanText(s, max) {
    s = String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\s+\n/g, '\n').trim();
    return max && s.length > max ? s.slice(0, max) : s;
  }
  function normTags(tags, max) {
    if (typeof tags === 'string') tags = tags.split(/[\s,]+/);
    if (!Array.isArray(tags)) return [];
    var out = [];
    tags.forEach(function (t) {
      t = String(t || '').toLowerCase().replace(/^#+/, '').replace(/[^a-z0-9_\-]/g, '').slice(0, 30);
      if (t && out.indexOf(t) < 0 && out.length < (max || 8)) out.push(t);
    });
    return out;
  }
  function normAuthor(a) {
    if (typeof a === 'string') a = { handle: a };
    a = a && typeof a === 'object' ? a : {};
    if (!a.handle && !a.name) {
      try {
        var me = YSD.members && typeof YSD.members.current === 'function' ? YSD.members.current() : null;
        if (me) a = { handle: me.handle || '', name: me.firstName || me.name || me.first || '', id: me.id || '' };
      } catch (e) {}
    }
    var handle = cleanText(a.handle, 40).replace(/\s+/g, '');
    if (handle && handle.charAt(0) !== '@') handle = '@' + handle;
    return { handle: handle, name: cleanText(a.name, 60) || (handle ? '' : 'You'), id: a.id ? String(a.id) : '' };
  }

  var demoIndex = {}, sourceIndex = {};
  function demoData() { return (w.YSD_DATA && w.YSD_DATA.clips) || null; }
  function demoItems() {
    var d = demoData(), items = d && Array.isArray(d.items) ? d.items : (Array.isArray(d) ? d : []);
    var defDemo = !(d && d.demo === false);
    return items.map(function (it) { return assign({}, it, { demo: it.demo != null ? !!it.demo : defDemo }); });
  }

  var uploadState = {};       // id -> {loaded, total, progress} (memory only; status lives in the store)

  function demoById(id) {
    if (demoIndex[id]) return demoIndex[id];
    var items = demoItems();
    for (var i = 0; i < items.length; i++) if (items[i] && items[i].id === id) return (demoIndex[id] = items[i]);
    return null;
  }
  function baseLikes(id) {
    var r = sourceIndex[id] || demoById(id);
    if (r) return +r.likes || 0;
    var l = findLocal(id);
    return l ? +l.likes || 0 : 0;
  }
  function baseViews(id) {
    var r = sourceIndex[id] || demoById(id);
    if (r) return +r.views || 0;
    var l = findLocal(id);
    return l ? +l.views || 0 : 0;
  }
  function likedMap() { var m = S().get(K_LIKED, {}); return m && typeof m === 'object' ? m : {}; }
  function viewsMap() { var m = S().get(K_VIEWS, {}); return m && typeof m === 'object' ? m : {}; }
  function hiddenMap() { var m = S().get(K_HIDDEN, {}); return m && typeof m === 'object' ? m : {}; }

  /** Public clip shape (a fresh copy; never the stored record). */
  function decorate(rec, origin) {
    var liked = !!likedMap()[rec.id];
    var c = {
      id: String(rec.id),
      source: origin,                                   // 'demo' | 'remote' | 'local'
      demo: origin === 'demo' ? rec.demo !== false : !!rec.demo,
      mine: origin === 'local',
      src: null, poster: null, hls: rec.hls || null, iframe: rec.iframe || null,
      type: rec.type || 'video/mp4',
      width: +rec.width || 0, height: +rec.height || 0,
      orientation: rec.orientation || orientationOf(rec.width, rec.height),
      aspect: rec.aspect || (rec.height ? Math.round(rec.width / rec.height * 1000) / 1000 : null),
      duration: +rec.duration || 0,
      caption: rec.caption || '',
      author: copy(rec.author || {}),
      tags: (rec.tags || []).slice(),
      createdAt: rec.createdAt || null,
      likes: (+rec.likes || 0) + (liked ? 1 : 0),
      liked: liked,
      views: (+rec.views || 0) + (+viewsMap()[rec.id] || 0),
      status: rec.status || 'ready',
      persisted: rec.persisted !== false,
      size: rec.size || rec.bytes || 0,
      upload: rec.upload ? assign({}, rec.upload, uploadState[rec.id] || {}) : null
    };
    if (origin === 'local') {
      var pb = rec.playback || {};
      c.src = urls[urlKey(B_FILES, rec.id)] || pb.mp4 || null;
      c.poster = urls[urlKey(B_POSTERS, rec.id)] || pb.poster || null;
      c.hls = pb.hls || null; c.iframe = pb.iframe || null;
      c.name = rec.name || '';
    } else {
      c.src = resolve(rec.src || rec.mp4 || null);
      c.poster = resolve(rec.poster || null);
      if (rec.photos) c.photos = copy(rec.photos);
      if (rec.facts) c.facts = copy(rec.facts);
      if (rec.burnedInText) c.burnedInText = rec.burnedInText.slice();
    }
    return c;
  }

  // ------------------------------------------------------------------ production list source
  var source = null, sourceCache = [], sourceAt = 0;
  /**
   * Production seam for the public feed: fn() -> Promise<Array<clipLike>> (e.g. a moderated list
   * from your server). Items need id + src or hls; same fields as data/clips.js items.
   * opts.ttl (ms, default 60000) caches the result. useSource(null) removes it.
   */
  function useSource(fn, opts) {
    source = typeof fn === 'function' ? { fn: fn, ttl: (opts && opts.ttl) || 60000 } : null;
    sourceCache = []; sourceAt = 0; sourceIndex = {};
    changed('source');
  }
  function remoteItems(force) {
    if (!source) return Promise.resolve([]);
    if (!force && sourceAt && now() - sourceAt < source.ttl) return Promise.resolve(sourceCache);
    return Promise.resolve().then(source.fn).then(function (arr) {
      sourceCache = Array.isArray(arr) ? arr.filter(function (x) { return x && x.id; }) : [];
      sourceAt = now(); sourceIndex = {};
      sourceCache.forEach(function (x) { sourceIndex[x.id] = x; });
      return sourceCache;
    }, function (err) { log('source failed', err); return sourceCache; });
  }

  // ------------------------------------------------------------------ list / get
  function prune() {
    // Clips whose file only lived in memory during an earlier page load are gone: drop them.
    var arr = locals(), keep = arr.filter(function (r) {
      return !(r.persisted === false && r.session !== SESSION && !(r.playback && (r.playback.hls || r.playback.mp4)));
    });
    // Uploads cut off by a page close.
    var fixed = false;
    keep = keep.map(function (r) {
      if (r.status === 'uploading' && r.session !== SESSION) { fixed = true; return assign({}, r, { status: 'failed', upload: assign({}, r.upload || {}, { error: 'interrupted' }) }); }
      return r;
    });
    if (keep.length !== arr.length || fixed) S().set(K_LOCAL, keep);
    return keep;
  }
  function localClips() {
    var recs = prune();
    return Promise.all(recs.map(function (r) {
      return Promise.all([objectUrl(B_FILES, r.id), r.hasPoster ? objectUrl(B_POSTERS, r.id) : null]).then(function (u) {
        var c = decorate(r, 'local');
        c.available = !!(u[0] || c.hls || c.src);
        return c;
      });
    }));
  }
  function score(c) {
    var t = Date.parse(c.createdAt || '') || now();
    var ageH = Math.max(0, (now() - t) / 3600000);
    return (c.likes * 3 + c.views * 0.15 + 4) / Math.pow(ageH + 2, 1.2);
  }
  var SORTS = {
    'new': function (a, b) { return (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0); },
    'oldest': function (a, b) { return (Date.parse(a.createdAt || '') || 0) - (Date.parse(b.createdAt || '') || 0); },
    'top': function (a, b) { return b.likes - a.likes || SORTS['new'](a, b); },
    'views': function (a, b) { return b.views - a.views || SORTS['new'](a, b); },
    'trending': function (a, b) { return score(b) - score(a); }
  };
  /**
   * All clips. opts: {sort: 'new'|'top'|'trending'|'views'|'oldest' (default 'new'), tag, author,
   * orientation, mine: true (only this browser's), includeDemo (default: YSD_CONFIG.demo),
   * includeHidden, includeUnavailable, limit, refresh (bypass the useSource cache)}.
   * Resolves to an array of clip objects with playable src/poster URLs.
   */
  function list(opts) {
    opts = opts || {};
    var includeDemo = opts.includeDemo != null ? !!opts.includeDemo : isDemo();
    return Promise.all([localClips(), opts.mine ? [] : remoteItems(opts.refresh)]).then(function (res) {
      demoIndex = {};
      var demo = [];
      if (!opts.mine) {
        demoItems().forEach(function (it) {
          if (!it || !it.id) return;
          demoIndex[it.id] = it;
          if (it.demo && !includeDemo) return;
          demo.push(decorate(it, 'demo'));
        });
      }
      var remote = res[1].map(function (r) { return decorate(r, 'remote'); });
      var seen = {}, all = [];
      res[0].concat(remote, demo).forEach(function (c) { if (!seen[c.id]) { seen[c.id] = 1; all.push(c); } });
      var hidden = hiddenMap();
      all = all.filter(function (c) {
        if (!opts.includeHidden && hidden[c.id]) return false;
        if (!opts.includeUnavailable && c.source === 'local' && c.available === false) return false;
        if (opts.tag && c.tags.indexOf(String(opts.tag).replace(/^#/, '').toLowerCase()) < 0) return false;
        if (opts.author && (c.author.handle || '').toLowerCase() !== String(opts.author).toLowerCase()) return false;
        if (opts.orientation && c.orientation !== opts.orientation) return false;
        return true;
      });
      all.sort(SORTS[opts.sort] || SORTS['new']);
      if (opts.limit > 0) all = all.slice(0, opts.limit);
      return all;
    });
  }
  /** One clip by id (hidden and demo clips included), or null. */
  function get(id) {
    id = String(id);
    return list({ includeDemo: true, includeHidden: true, includeUnavailable: true }).then(function (all) {
      for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
      return null;
    });
  }

  // ------------------------------------------------------------------ likes and views (sync)
  function statsOf(id) {
    var liked = !!likedMap()[id];
    return { id: id, liked: liked, likes: baseLikes(id) + (liked ? 1 : 0), views: baseViews(id) + (+viewsMap()[id] || 0) };
  }
  function setLiked(id, on) {
    id = String(id);
    var was = !!likedMap()[id];
    if (was !== !!on) {
      S().update(K_LIKED, function (m) {
        m = m && typeof m === 'object' ? m : {};
        if (on) m[id] = now(); else delete m[id];
        return m;
      }, {});
    }
    var st = statsOf(id);
    if (was !== !!on) {
      emit('clip-liked', st);
      track(on ? 'clip_like' : 'clip_unlike', { id: id });
      changed('like', id);
    }
    return st;
  }
  /** Like a clip (one like per browser). Returns {id, liked, likes, views} synchronously. */
  function like(id) { return setLiked(id, true); }
  function unlike(id) { return setLiked(id, false); }
  function toggleLike(id) { return setLiked(id, !likedMap()[String(id)]); }
  function isLiked(id) { return !!likedMap()[String(id)]; }

  var viewedThisPage = {};
  /** Count a view (once per clip per page session unless opts.force). Returns stats. */
  function view(id, opts) {
    id = String(id);
    var key = 'ysd:clip-viewed:' + id;
    var seen = viewedThisPage[id];
    try { seen = seen || (w.sessionStorage && w.sessionStorage.getItem(key) === '1'); } catch (e) {}
    if (seen && !(opts && opts.force)) return statsOf(id);
    viewedThisPage[id] = true;
    try { w.sessionStorage && w.sessionStorage.setItem(key, '1'); } catch (e) {}
    S().update(K_VIEWS, function (m) { m = m && typeof m === 'object' ? m : {}; m[id] = (+m[id] || 0) + 1; return m; }, {});
    var st = statsOf(id);
    emit('clip-view', st);
    track('clip_view', { id: id });
    return st;
  }

  // ------------------------------------------------------------------ add / remove
  /**
   * Post a clip. opts: {caption, author ('@handle' or {handle, name}), tags (array or "a, b"),
   * upload: false to skip the production upload, awaitUpload: true to resolve after it,
   * onProgress(p), signal (AbortSignal), plus any limits override}.
   * Resolves to the clip; rejects with Error{code, result} when validation fails.
   */
  function add(file, opts) {
    opts = opts || {};
    var L = limits(opts);
    return check(file, opts).then(function (res) {
      if (!res.ok) {
        emit('clip-rejected', { code: res.code, reason: res.reason, name: file && file.name, size: file && file.size });
        var e = mkErr(res.code, res.reason); e.result = res; throw e;
      }
      var meta = res.meta || {}, id = uid('clip');
      var rec = {
        id: id, caption: cleanText(opts.caption, L.captionMax), author: normAuthor(opts.author),
        tags: normTags(opts.tags, L.tagsMax), createdAt: new Date().toISOString(),
        duration: isFinite(meta.duration) ? Math.round(meta.duration * 100) / 100 : 0,
        width: meta.width || 0, height: meta.height || 0, orientation: meta.orientation, aspect: meta.aspect,
        size: file.size, type: res.type || file.type || 'video/mp4', name: cleanText(file.name, 120),
        status: 'local', persisted: true, hasPoster: !!meta.poster, session: SESSION,
        likes: 0, views: 0, upload: null, playback: null, demo: false
      };
      return saveBlob(B_FILES, id, file).then(function (persisted) {
        rec.persisted = persisted;
        return meta.poster ? saveBlob(B_POSTERS, id, meta.poster)['catch'](noop) : null;
      }).then(function () {
        cacheUrl(B_FILES, id, file);
        if (meta.poster) cacheUrl(B_POSTERS, id, meta.poster);
        S().update(K_LOCAL, function (arr) { arr = Array.isArray(arr) ? arr : []; return arr.concat([rec]); }, []);
        var clip = decorate(rec, 'local');
        clip.available = true;
        emit('clip-added', { clip: clip });
        track('clip_add', { duration: rec.duration, orientation: rec.orientation, size: rec.size });
        changed('add', id);
        if (!rec.persisted) emit('clip-not-persisted', { id: id });
        if (opts.upload === false || !uploadEnabled()) return clip;
        var up = upload(id, opts);
        if (opts.awaitUpload) return up;
        up['catch'](noop);
        clip.status = 'uploading';
        return clip;
      });
    });
  }

  /**
   * Remove a clip. Local clips: deletes the stored file/poster, metadata and object URLs (and
   * cancels an upload). Demo/remote clips: hidden in this browser (unhide/unhideAll restore).
   */
  function remove(id) {
    id = String(id);
    var rec = findLocal(id);
    if (!rec) {
      S().update(K_HIDDEN, function (m) { m = m && typeof m === 'object' ? m : {}; m[id] = now(); return m; }, {});
      emit('clip-removed', { id: id, hidden: true });
      changed('remove', id);
      return Promise.resolve(true);
    }
    cancelUpload(id);
    release(id);
    S().update(K_LOCAL, function (arr) { return (Array.isArray(arr) ? arr : []).filter(function (r) { return r.id !== id; }); }, []);
    return Promise.all([D().del(B_FILES, id), D().del(B_POSTERS, id)]).then(function () { return true; }, function () { return true; }).then(function () {
      emit('clip-removed', { id: id, hidden: false });
      track('clip_remove', { id: id });
      changed('remove', id);
      return true;
    });
  }
  function unhide(id) {
    S().update(K_HIDDEN, function (m) { m = m && typeof m === 'object' ? m : {}; delete m[String(id)]; return m; }, {});
    changed('unhide', id);
  }
  function unhideAll() { S().set(K_HIDDEN, {}); changed('unhide'); }

  // ------------------------------------------------------------------ production upload seam
  function endpoint() { return String(cfg('integrations.videoUploadEndpoint', '') || ''); }
  function uploadEnabled() { return !isDemo() && !!endpoint(); }
  var xhrs = {}, polls = {};

  function readJson(r) {
    return r.text().then(function (t) { try { return t ? JSON.parse(t) : {}; } catch (e) { return {}; } });
  }
  function sendFile(id, ticket, blob, rec, opts) {
    return new Promise(function (resolveSend, rejectSend) {
      var xhr = new w.XMLHttpRequest();
      xhrs[id] = xhr;
      var method = String(ticket.method || 'POST').toUpperCase();
      xhr.open(method, ticket.uploadUrl, true);
      var hdrs = ticket.headers || {};
      for (var h in hdrs) if (hasOwn.call(hdrs, h)) { try { xhr.setRequestHeader(h, hdrs[h]); } catch (e) {} }
      var last = 0;
      function report(loaded, total, force) {
        var t = now();
        var p = total ? Math.min(1, loaded / total) : 0;
        uploadState[id] = { loaded: loaded, total: total, progress: p };
        if (!force && t - last < 120 && p < 1) return;
        last = t;
        var d = { id: id, loaded: loaded, total: total, progress: p };
        emit('clip-upload-progress', d);
        if (typeof opts.onProgress === 'function') { try { opts.onProgress(d); } catch (e) {} }
      }
      if (xhr.upload) xhr.upload.onprogress = function (e) { if (e.lengthComputable) report(e.loaded, e.total); };
      xhr.onload = function () {
        delete xhrs[id];
        if (xhr.status >= 200 && xhr.status < 300) { report(blob.size, blob.size, true); resolveSend(xhr); }
        else rejectSend(mkErr('upload-failed', msg('upload-failed') + ' (HTTP ' + xhr.status + ')'));
      };
      xhr.onerror = function () { delete xhrs[id]; rejectSend(mkErr('network')); };
      xhr.onabort = function () { delete xhrs[id]; rejectSend(mkErr('aborted')); };
      if (opts.signal) {
        if (opts.signal.aborted) { xhr.abort(); return; }
        opts.signal.addEventListener('abort', function () { try { xhr.abort(); } catch (e) {} });
      }
      var body;
      if (method === 'PUT') {
        body = blob;
        if (!hdrs['Content-Type'] && !hdrs['content-type'] && blob.type) { try { xhr.setRequestHeader('Content-Type', blob.type); } catch (e) {} }
      } else {
        body = new w.FormData();
        var ext = 'mp4';
        for (var e in EXT_TYPES) if (hasOwn.call(EXT_TYPES, e) && EXT_TYPES[e] === (blob.type || rec.type)) { ext = e; break; }
        body.append(ticket.field || 'file', blob, rec.name || (rec.id + '.' + ext));
      }
      report(0, blob.size, true);
      xhr.send(body);
    });
  }

  /**
   * Upload a stored clip to the production endpoint (also used as "retry").
   * Protocol (see docs/infra/video.md): POST endpoint {action:'create', ...metadata} ->
   * {ok, provider, id, uploadUrl, method:'POST'|'PUT', field?, headers?}; then the file goes
   * straight to uploadUrl; then GET endpoint?id=&provider= is polled until state 'ready'.
   * opts: {onProgress, signal, poll: false, pollInterval, pollTries, force (ignore demo mode)}.
   */
  function upload(id, opts) {
    opts = opts || {};
    id = String(id);
    var ep = endpoint();
    if (!ep) return Promise.reject(mkErr('no-endpoint'));
    if (isDemo() && !opts.force) return Promise.reject(mkErr('demo'));
    if (typeof w.fetch !== 'function' || !w.XMLHttpRequest) return Promise.reject(mkErr('network'));
    var rec = findLocal(id);
    if (!rec) return Promise.reject(mkErr('missing'));
    var ticketRef = null;
    patchLocal(id, { status: 'uploading', upload: { provider: null, id: null, error: null, startedAt: new Date().toISOString() } });
    emit('clip-upload-start', { id: id });
    return Promise.resolve(D().get(B_FILES, id)).then(function (blob) {
      if (!blob) throw mkErr('missing');
      var hook = typeof api.beforeUpload === 'function' ? api.beforeUpload(decorate(rec, 'local')) : null;
      return Promise.resolve(hook).then(function (extra) {
        var me = null;
        try { me = YSD.members && YSD.members.current ? YSD.members.current() : null; } catch (e) {}
        var body = assign({
          action: 'create', clientId: id, filename: rec.name || '', size: blob.size || rec.size,
          type: blob.type || rec.type, duration: rec.duration, width: rec.width, height: rec.height,
          caption: rec.caption, tags: rec.tags, author: rec.author && rec.author.handle || '',
          ref: me && me.refCode || ''
        }, extra && typeof extra === 'object' ? extra : null);
        return w.fetch(ep, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
      }).then(function (r) {
        return readJson(r).then(function (j) {
          if (!r.ok || !j || j.ok === false || !j.uploadUrl) { var e = mkErr('create-failed', (j && j.message) || msg('create-failed')); e.server = j && j.error; throw e; }
          return j;
        });
      }, function (e) { if (e && e.code) throw e; throw mkErr('network'); }).then(function (ticket) {
        ticketRef = ticket;
        patchLocal(id, { upload: { provider: ticket.provider || null, id: ticket.id || null } });
        return sendFile(id, ticket, blob, rec, opts);
      });
    }).then(function () {
      var up = { provider: ticketRef.provider || null, id: ticketRef.id || null, uploadedAt: new Date().toISOString(), error: null };
      var updated = patchLocal(id, { status: 'processing', upload: up });
      emit('clip-uploaded', { id: id, provider: up.provider, remoteId: up.id });
      track('clip_upload', { provider: up.provider, size: rec.size, duration: rec.duration });
      if (opts.poll !== false && up.id) pollStatus(id, opts);
      return decorate(updated || rec, 'local');
    })['catch'](function (e) {
      var code = e && e.code || 'upload-failed';
      patchLocal(id, { status: 'failed', upload: { error: code, message: e && e.message || '' } });
      emit('clip-upload-failed', { id: id, code: code, message: e && e.message || msg(code) });
      throw e;
    });
  }
  function cancelUpload(id) {
    var x = xhrs[String(id)];
    if (x) { try { x.abort(); } catch (e) {} return true; }
    if (polls[id]) { clearTimeout(polls[id]); delete polls[id]; }
    return false;
  }
  /** One status check against the endpoint: resolves the server JSON ({state, playback, ...}). */
  function status(id) {
    var rec = findLocal(String(id)), ep = endpoint();
    if (!rec || !rec.upload || !rec.upload.id || !ep || typeof w.fetch !== 'function') return Promise.resolve(null);
    var q = (ep.indexOf('?') >= 0 ? '&' : '?') + 'id=' + encodeURIComponent(rec.upload.id) + '&provider=' + encodeURIComponent(rec.upload.provider || '');
    return w.fetch(ep + q, { headers: { Accept: 'application/json' }, credentials: 'same-origin' }).then(function (r) {
      return readJson(r).then(function (j) {
        if (!r.ok || !j) return null;
        if (j.state === 'ready') {
          patchLocal(rec.id, { status: 'ready', playback: j.playback || null, duration: j.duration || rec.duration });
          emit('clip-ready', { id: rec.id, playback: j.playback || null });
        } else if (j.state === 'error') {
          patchLocal(rec.id, { status: 'failed', upload: { error: 'processing-failed', message: j.message || '' } });
          emit('clip-upload-failed', { id: rec.id, code: 'processing-failed', message: j.message || '' });
        }
        return j;
      });
    }, function () { return null; });
  }
  function pollStatus(id, opts) {
    var L = limits(opts), tries = 0;
    var interval = (opts && opts.pollInterval) || L.pollInterval, max = (opts && opts.pollTries) || L.pollTries;
    function tick() {
      delete polls[id];
      tries++;
      status(id).then(function (j) {
        if (j && (j.state === 'ready' || j.state === 'error')) return;
        if (tries < max && findLocal(id)) polls[id] = setTimeout(tick, interval);
      });
    }
    polls[id] = setTimeout(tick, interval);
  }

  // ------------------------------------------------------------------ misc
  /** Subscribe to any clip change (this tab and other tabs). Returns unsubscribe. */
  function onChange(cb) {
    if (typeof cb !== 'function') return noop;
    var offs = [];
    var h = function (e) { try { cb(e.detail || {}); } catch (x) {} };
    try { doc.addEventListener('ysd:clips-changed', h); offs.push(function () { doc.removeEventListener('ysd:clips-changed', h); }); } catch (e) {}
    [K_LOCAL, K_LIKED, K_HIDDEN].forEach(function (k) {
      var off = S().on && S().on(k, function (v, info) { if (info && info.source === 'remote') { try { cb({ reason: 'remote', key: k }); } catch (x) {} } });
      if (typeof off === 'function') offs.push(off);
    });
    return function () { offs.forEach(function (f) { try { f(); } catch (e) {} }); };
  }
  /** Ask the browser to keep stored clips (may show a prompt in some browsers). */
  function requestPersist() {
    try { if (w.navigator.storage && w.navigator.storage.persist) return w.navigator.storage.persist(); } catch (e) {}
    return Promise.resolve(false);
  }
  /** Remove every local clip, like, view and hidden flag (this browser only). */
  function reset() {
    var ids = locals().map(function (r) { return r.id; });
    return Promise.all(ids.map(remove)).then(function () {
      [K_LOCAL, K_LIKED, K_VIEWS, K_HIDDEN].forEach(function (k) { S().remove(k); });
      changed('reset');
      return ids.length;
    });
  }

  var api = {
    version: '1.0.0',
    // core contract
    add: add, list: list, get: get, like: like, remove: remove, validate: validate,
    // extras
    check: check, probe: probe, unlike: unlike, toggleLike: toggleLike, liked: isLiked,
    view: view, stats: statsOf, unhide: unhide, unhideAll: unhideAll,
    url: function (id) { return objectUrl(B_FILES, String(id)); },
    posterUrl: function (id) { return objectUrl(B_POSTERS, String(id)); },
    release: release, releaseAll: releaseAll,
    upload: upload, retry: upload, cancelUpload: cancelUpload, status: status,
    uploadEnabled: uploadEnabled, useSource: useSource, beforeUpload: null,
    onChange: onChange, requestPersist: requestPersist, reset: reset,
    limits: limits, messages: messages, resolve: resolve,
    format: { bytes: formatBytes, duration: formatDuration },
    orientationOf: orientationOf,
    keys: { local: K_LOCAL, liked: K_LIKED, views: K_VIEWS, hidden: K_HIDDEN, filesBucket: B_FILES, postersBucket: B_POSTERS }
  };
  YSD.clips = api;
})(typeof window !== 'undefined' ? window : this);
