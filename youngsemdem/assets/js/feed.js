/*!
 * Young Seminole Democrats: headless vertical video feed (YSD.feed). Video workstream.
 *
 *   var feed = YSD.feed.attach(container, opts)   // any markup that follows the data contract
 *   YSD.feed.mount(container, clips, opts)         // render minimal markup from clips, then attach
 *
 * Markup contract (no classes or styles required):
 *   [data-feed-item]                one per clip; data-clip-id="ID" links it to YSD.clips
 *     <video>                       muted/loop/playsinline are applied for you; data-src and
 *                                   data-poster are lazy-loaded; <source data-src> works too
 *     [data-feed-mute]              button: toggles sound (aria-pressed="true" while muted)
 *     [data-feed-play]              button: play/pause (aria-pressed="true" while playing)
 *     [data-feed-like]              button: like/unlike via YSD.clips (aria-pressed)
 *     [data-feed-likes]             text: like count      [data-feed-views] text: view count
 *     [data-feed-progress]          <progress> gets value/max; anything else gets --ysd-feed-progress
 *     [data-feed-ignore]            taps inside never toggle play or like
 * State written back for CSS: item[data-feed-active], item[data-feed-state=idle|loading|playing|
 * paused|ended|error], item style --ysd-feed-progress (0..1), container[data-feed-muted],
 * container[data-feed-autoplay=on|off], container[data-feed-index].
 * Behaviour: the item most in view (IntersectionObserver) plays, others pause; muted by default;
 * keys ArrowDown/j next, ArrowUp/k prev, Space play/pause, m mute, l like, Home/End;
 * tap toggles play, double-tap likes (event carries x/y for a heart burst); preloads the next
 * item and unloads far ones; no autoplay under prefers-reduced-motion or data saver; pauses
 * when the tab is hidden; counts a view after 2 s (or half the clip).
 * Events bubble from the container: ysd:feed-change, -play, -pause, -mute, -like, -view, -ended,
 * -error, -autoplay-blocked (detail: {index, item, id, ...}).
 */
(function (w) {
  'use strict';
  var YSD = w.YSD = w.YSD || {};
  var doc = w.document;
  var hasOwn = Object.prototype.hasOwnProperty;

  var DEFAULTS = {
    itemSelector: '[data-feed-item]',
    videoSelector: 'video',
    threshold: 0.6,            // share of an item that must be visible to become active
    autoplay: 'auto',          // 'auto' (respects reduced motion + data saver) | true | false
    muted: true,
    loop: true,
    preload: 1,                // items ahead to preload (0 under data saver)
    unloadDistance: 4,         // free decoders for items this far away (0 = never)
    keyboard: true,            // true (document, when the feed is on screen) | 'container' | false
    tapToPause: true,
    doubleTapLike: true,
    doubleTapMs: 300,
    viewSeconds: 2,
    root: undefined,           // IntersectionObserver root; default: container if it scrolls, else viewport
    scrollBehavior: 'smooth',
    like: true,                // call YSD.clips.like on double-tap / like buttons
    countViews: true,          // call YSD.clips.view
    onChange: null, onPlay: null, onPause: null, onLike: null, onView: null, onMute: null, onError: null
  };
  var registry = [];
  var sharedMuted = null;      // mute choice shared by every feed on the page

  function assign(t) {
    for (var i = 1; i < arguments.length; i++) { var s = arguments[i]; if (s) for (var k in s) if (hasOwn.call(s, k)) t[k] = s[k]; }
    return t;
  }
  function mq(q) { try { return w.matchMedia ? w.matchMedia(q) : null; } catch (e) { return null; } }
  function connection() { try { return w.navigator.connection || w.navigator.mozConnection || w.navigator.webkitConnection || null; } catch (e) { return null; } }
  function saveDataOn() {
    var c = connection();
    if (c && (c.saveData || /(^|-)2g$/.test(String(c.effectiveType || '')))) return true;
    var m = mq('(prefers-reduced-data: reduce)');
    return !!(m && m.matches);
  }
  function reducedMotionOn() { var m = mq('(prefers-reduced-motion: reduce)'); return !!(m && m.matches); }
  function isEditable(el) {
    if (!el || el === doc.body) return false;
    var tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    return !!el.isContentEditable;
  }
  function resolve(p) { return YSD.clips && typeof YSD.clips.resolve === 'function' ? YSD.clips.resolve(p) : p; }
  function closest(el, sel, stop) {
    while (el && el !== stop && el.nodeType === 1) { if (el.matches && el.matches(sel)) return el; el = el.parentNode; }
    return null;
  }

  function attach(container, options) {
    if (typeof container === 'string') container = doc.querySelector(container);
    if (!container || container.nodeType !== 1) throw new Error('YSD.feed.attach: container element required');
    for (var r = 0; r < registry.length; r++) if (registry[r].container === container) registry[r].destroy();

    var o = assign({}, DEFAULTS, options || {});
    var items = [], index = -1, ratios = [], destroyed = false;
    var listeners = {}, offs = [], io = null, mo = null, lockUntil = 0, lockIndex = -1;
    var viewed = {}, played = {}, lastTime = {}, wasPlaying = false, userPaused = {};
    var muted = sharedMuted === null ? o.muted !== false : sharedMuted;
    var tapTimer = null, lastTap = null, lockTimer = null;

    function on(el, ev, fn, opt) { el.addEventListener(ev, fn, opt || false); offs.push(function () { el.removeEventListener(ev, fn, opt || false); }); }
    function fire(name, detail) {
      detail = assign({ controller: ctrl }, detail || {});
      try { container.dispatchEvent(new w.CustomEvent('ysd:feed-' + name, { detail: detail, bubbles: true })); } catch (e) {}
      var cbName = 'on' + name.charAt(0).toUpperCase() + name.slice(1);
      if (typeof o[cbName] === 'function') { try { o[cbName](detail); } catch (e) {} }
      (listeners[name] || []).slice().forEach(function (cb) { try { cb(detail); } catch (e) {} });
    }
    function autoplayAllowed() {
      if (o.autoplay === false) return false;
      if (o.autoplay === true) return true;
      return !reducedMotionOn() && !saveDataOn();
    }
    function videoOf(i) { var it = items[i]; return it ? it.querySelector(o.videoSelector) : null; }
    function idOf(i) { var it = items[i]; return it ? it.getAttribute('data-clip-id') || '' : ''; }
    function setState(i, s) { if (items[i]) items[i].setAttribute('data-feed-state', s); }
    function rootEl() {
      if (o.root !== undefined) return o.root;
      try {
        var cs = w.getComputedStyle(container);
        if (/(auto|scroll)/.test(cs.overflowY) && container.scrollHeight > container.clientHeight + 1) return container;
      } catch (e) {}
      return null;
    }

    // ---------------------------------------------------------------- sources
    function ensureSrc(v) {
      if (!v) return;
      var ds = v.getAttribute('data-src');
      if (ds && !v.getAttribute('src')) { v.setAttribute('src', resolve(ds)); }
      var srcs = v.querySelectorAll('source[data-src]'), changed = false;
      for (var s = 0; s < srcs.length; s++) if (!srcs[s].getAttribute('src')) { srcs[s].setAttribute('src', resolve(srcs[s].getAttribute('data-src'))); changed = true; }
      if (changed) { try { v.load(); } catch (e) {} }
      var dp = v.getAttribute('data-poster');
      if (dp && !v.getAttribute('poster')) v.setAttribute('poster', resolve(dp));
    }
    function unload(v) {
      if (!v || !v.getAttribute('src') && !v.querySelector('source[src]')) return;
      try { v.pause(); } catch (e) {}
      var src = v.getAttribute('src');
      if (src) { if (!v.getAttribute('data-src')) v.setAttribute('data-src', src); v.removeAttribute('src'); }
      var srcs = v.querySelectorAll('source[src]');
      for (var s = 0; s < srcs.length; s++) { if (!srcs[s].getAttribute('data-src')) srcs[s].setAttribute('data-src', srcs[s].getAttribute('src')); srcs[s].removeAttribute('src'); }
      try { v.load(); } catch (e) {}
    }
    function manageSources(active) {
      var sd = saveDataOn(), ahead = sd ? 0 : Math.max(0, o.preload | 0);
      for (var i = 0; i < items.length; i++) {
        var v = videoOf(i);
        if (!v) continue;
        var d = i - active;
        if (d === 0) { v.preload = sd && !autoplayAllowed() ? 'metadata' : 'auto'; ensureSrc(v); }
        else if (d > 0 && d <= ahead) { v.preload = 'auto'; ensureSrc(v); }
        else if (d === -1 || d === 1) { v.preload = 'metadata'; if (!sd) ensureSrc(v); }
        else if (o.unloadDistance > 0 && Math.abs(d) > o.unloadDistance) { v.preload = 'none'; unload(v); }
        else if (!v.getAttribute('src')) { v.preload = 'none'; }
        // keep posters visible for nearby items even when the video is not loaded
        if (Math.abs(d) <= Math.max(2, ahead + 1)) { var dp = v.getAttribute('data-poster'); if (dp && !v.getAttribute('poster')) v.setAttribute('poster', resolve(dp)); }
      }
    }

    // ---------------------------------------------------------------- playback
    function applyMute() {
      for (var i = 0; i < items.length; i++) { var v = videoOf(i); if (v) v.muted = muted; }
      container.setAttribute('data-feed-muted', String(muted));
      var btns = container.querySelectorAll('[data-feed-mute]');
      for (var b = 0; b < btns.length; b++) btns[b].setAttribute('aria-pressed', String(muted));
    }
    function setMuted(m, why) {
      m = !!m;
      var changed = m !== muted;
      muted = m; sharedMuted = m;
      applyMute();
      if (changed) fire('mute', { muted: muted, reason: why || 'user', index: index, item: items[index] || null, id: idOf(index) });
      if (!muted && index >= 0) { var v = videoOf(index); if (v && v.paused && !userPaused[index] && autoplayAllowed()) playIndex(index, true); }
      return muted;
    }
    function playIndex(i, user) {
      var v = videoOf(i);
      if (!v) return Promise.resolve(false);
      ensureSrc(v);
      v.muted = muted;
      if (user) userPaused[i] = false;
      var p;
      try { p = v.play(); } catch (e) { p = null; }
      if (!p || typeof p.then !== 'function') return Promise.resolve(!v.paused);
      return p.then(function () { return true; }, function (err) {
        var name = err && err.name;
        if (name === 'NotAllowedError' && !v.muted) {
          setMuted(true, 'autoplay-blocked');
          fire('autoplay-blocked', { index: i, item: items[i], id: idOf(i) });
          return v.play().then(function () { return true; }, function () { setState(i, 'paused'); return false; });
        }
        if (name !== 'AbortError') { setState(i, 'paused'); if (name === 'NotAllowedError') fire('autoplay-blocked', { index: i, item: items[i], id: idOf(i) }); }
        return false;
      });
    }
    function pauseIndex(i, user) {
      var v = videoOf(i);
      if (!v) return;
      if (user) userPaused[i] = true;
      try { v.pause(); } catch (e) {}
    }

    function activate(i, why) {
      if (destroyed || i < 0 || i >= items.length) return;
      var prev = index;
      if (prev !== i) {
        if (prev >= 0 && items[prev]) { pauseIndex(prev); items[prev].removeAttribute('data-feed-active'); }
        index = i;
        items[i].setAttribute('data-feed-active', 'true');
        container.setAttribute('data-feed-index', String(i));
        manageSources(i);
        fire('change', { index: i, previous: prev, item: items[i], id: idOf(i), reason: why || 'scroll' });
      }
      if (autoplayAllowed() && !userPaused[i]) playIndex(i, false);
      else if (!videoOf(i) || videoOf(i).paused) setState(i, items[i].getAttribute('data-feed-state') === 'ended' ? 'ended' : 'idle');
    }
    function deactivate() {
      if (index < 0) return;
      pauseIndex(index);
    }

    // ---------------------------------------------------------------- per-item wiring
    function wireItem(it, i) {
      if (it.__ysdFeedWired) return;
      it.__ysdFeedWired = true;
      var v = it.querySelector(o.videoSelector);
      if (!it.hasAttribute('data-feed-state')) it.setAttribute('data-feed-state', 'idle');
      if (!v) return;
      v.muted = muted; v.defaultMuted = true; v.setAttribute('muted', '');
      v.playsInline = true; v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
      if (o.loop) v.loop = true;
      v.removeAttribute('autoplay'); v.autoplay = false;
      v.controls = false;
      if (!v.getAttribute('preload')) v.preload = 'none';
      function idx() { return items.indexOf(it); }
      function st(s) { it.setAttribute('data-feed-state', s); }
      on(v, 'playing', function () { st('playing'); var k = idx(); if (k === index) fire('play', { index: k, item: it, id: idOf(k) }); syncPlayButtons(); });
      on(v, 'pause', function () { if (it.getAttribute('data-feed-state') !== 'ended') st('paused'); var k = idx(); if (k === index) fire('pause', { index: k, item: it, id: idOf(k) }); syncPlayButtons(); });
      on(v, 'waiting', function () { if (!v.paused) st('loading'); });
      on(v, 'ended', function () { st('ended'); var k = idx(); fire('ended', { index: k, item: it, id: idOf(k) }); });
      on(v, 'error', function () { if (!v.getAttribute('src') && !v.querySelector('source[src]')) return; st('error'); var k = idx(); fire('error', { index: k, item: it, id: idOf(k), error: v.error && v.error.code }); });
      on(v, 'timeupdate', function () {
        var d = v.duration, t = v.currentTime, k = idx();
        if (isFinite(d) && d > 0) {
          var p = Math.max(0, Math.min(1, t / d));
          it.style.setProperty('--ysd-feed-progress', p.toFixed(4));
          var bars = it.querySelectorAll('[data-feed-progress]');
          for (var b = 0; b < bars.length; b++) {
            if ((bars[b].tagName || '').toLowerCase() === 'progress') { bars[b].max = 1; bars[b].value = p; }
            else bars[b].style.setProperty('--ysd-feed-progress', p.toFixed(4));
          }
        }
        // view counting: accumulate real playback time
        var key = k + ':' + idOf(k), lt = lastTime[key];
        if (typeof lt === 'number' && t > lt && t - lt < 1.5) played[key] = (played[key] || 0) + (t - lt);
        lastTime[key] = t;
        var need = isFinite(d) && d > 0 ? Math.min(o.viewSeconds, d * 0.5) : o.viewSeconds;
        if (!viewed[key] && (played[key] || 0) >= need) {
          viewed[key] = true;
          var id = idOf(k), stats = null;
          if (o.countViews && id && YSD.clips && typeof YSD.clips.view === 'function') {
            try { stats = YSD.clips.view(id); } catch (e) {}
            if (stats) setCount(it, '[data-feed-views]', stats.views);
          }
          fire('view', { index: k, item: it, id: id, stats: stats });
        }
      });
      on(v, 'seeking', function () { lastTime[idx() + ':' + idOf(idx())] = undefined; });
      // initial counts from YSD.clips
      var cid = it.getAttribute('data-clip-id');
      if (cid && YSD.clips && typeof YSD.clips.stats === 'function') {
        try {
          var s0 = YSD.clips.stats(cid);
          var likeBtns = it.querySelectorAll('[data-feed-like]');
          for (var lb = 0; lb < likeBtns.length; lb++) likeBtns[lb].setAttribute('aria-pressed', String(!!s0.liked));
        } catch (e) {}
      }
    }
    function setCount(it, sel, n) {
      var els = it.querySelectorAll(sel), txt = YSD.counters && YSD.counters.format ? YSD.counters.format(n) : String(n);
      for (var i = 0; i < els.length; i++) els[i].textContent = txt;
    }
    function syncPlayButtons() {
      for (var i = 0; i < items.length; i++) {
        var v = videoOf(i), b = items[i].querySelectorAll('[data-feed-play]');
        for (var k = 0; k < b.length; k++) b[k].setAttribute('aria-pressed', String(!!(v && !v.paused)));
      }
    }

    // ---------------------------------------------------------------- likes
    function likeIndex(i, via, pt, toggle) {
      var it = items[i];
      if (!it) return null;
      var id = idOf(i), stats = null;
      if (o.like && id && YSD.clips) {
        try { stats = toggle && YSD.clips.toggleLike ? YSD.clips.toggleLike(id) : YSD.clips.like(id); } catch (e) {}
      }
      if (stats) {
        setCount(it, '[data-feed-likes]', stats.likes);
        var bs = it.querySelectorAll('[data-feed-like]');
        for (var b = 0; b < bs.length; b++) bs[b].setAttribute('aria-pressed', String(!!stats.liked));
      }
      fire('like', { index: i, item: it, id: id, via: via, x: pt ? pt.x : null, y: pt ? pt.y : null, liked: stats ? stats.liked : true, likes: stats ? stats.likes : null });
      return stats;
    }

    // ---------------------------------------------------------------- input
    function onClick(e) {
      var it = closest(e.target, o.itemSelector, container);
      if (!it) return;
      var i = items.indexOf(it);
      if (i < 0) return;
      var btn = closest(e.target, '[data-feed-mute],[data-feed-play],[data-feed-like]', it);
      if (btn) {
        e.preventDefault();
        if (btn.hasAttribute('data-feed-mute')) { if (i !== index) activate(i, 'tap'); setMuted(!muted, 'user'); if (!muted) playIndex(i, true); }
        else if (btn.hasAttribute('data-feed-play')) {
          // a Play tap on a clip that isn't the active one means "play this": activate() may already have
          // started it (autoplay), so only toggle when it was already the active clip
          if (i !== index) { activate(i, 'tap'); var pv = videoOf(i); if (pv && pv.paused) playIndex(i, true); }
          else toggleIndex(i);
        }
        else likeIndex(i, 'button', null, true);
        return;
      }
      if (closest(e.target, 'a,button,input,textarea,select,label,[data-feed-ignore],[contenteditable="true"]', it)) return;
      var rect = it.getBoundingClientRect(), pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      var t = Date.now();
      if (o.doubleTapLike && lastTap && lastTap.i === i && t - lastTap.t < o.doubleTapMs && Math.abs(lastTap.x - pt.x) < 40 && Math.abs(lastTap.y - pt.y) < 40) {
        clearTimeout(tapTimer); tapTimer = null; lastTap = null;
        likeIndex(i, 'doubletap', pt, false);
        return;
      }
      lastTap = { i: i, t: t, x: pt.x, y: pt.y };
      if (!o.tapToPause) return;
      clearTimeout(tapTimer);
      tapTimer = setTimeout(function () {
        tapTimer = null;
        if (i !== index) { activate(i, 'tap'); playIndex(i, true); return; }
        toggleIndex(i);
      }, o.doubleTapLike ? o.doubleTapMs : 0);
    }
    function toggleIndex(i) {
      var v = videoOf(i);
      if (!v) return;
      if (v.paused) playIndex(i, true); else pauseIndex(i, true);
    }
    function feedOnScreen() {
      try {
        var r = container.getBoundingClientRect(), vh = w.innerHeight || doc.documentElement.clientHeight;
        var vis = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
        return vis >= Math.min(r.height, vh) * 0.3;
      } catch (e) { return true; }
    }
    function onKey(e) {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditable(e.target)) return;
      if (o.keyboard !== 'container') {
        if (!feedOnScreen()) return;
        var ae = doc.activeElement;
        for (var r = 0; r < registry.length; r++) if (registry[r] !== ctrl && registry[r].container.contains(ae)) return;
      }
      var key = e.key, tgt = e.target, onButton = tgt && /^(button|a|summary)$/i.test(tgt.tagName || '');
      var handled = true;
      if (key === 'ArrowDown' || key === 'j' || key === 'J' || key === 'PageDown') next();
      else if (key === 'ArrowUp' || key === 'k' || key === 'K' || key === 'PageUp') prev();
      else if ((key === ' ' || key === 'Spacebar') && !onButton) toggle();
      else if (key === 'm' || key === 'M') setMuted(!muted, 'user');
      else if (key === 'l' || key === 'L') { if (index >= 0) likeIndex(index, 'keyboard', null, true); }
      else if (key === 'Home') goTo(0);
      else if (key === 'End') goTo(items.length - 1);
      else handled = false;
      if (handled) e.preventDefault();
    }

    // ---------------------------------------------------------------- observers
    function onIntersect(entries) {
      if (destroyed) return;
      for (var e = 0; e < entries.length; e++) {
        var k = items.indexOf(entries[e].target);
        if (k >= 0) ratios[k] = entries[e].isIntersecting ? entries[e].intersectionRatio : 0;
      }
      pick();
    }
    function pick() {
      var best = -1, bestR = 0;
      for (var i = 0; i < items.length; i++) if ((ratios[i] || 0) > bestR + 0.001) { bestR = ratios[i]; best = i; }
      // While goTo() scrolls, ignore other candidates; re-check once the scroll has settled.
      if (Date.now() < lockUntil && lockIndex >= 0) return;
      if (best >= 0 && bestR >= Math.min(o.threshold, 0.99)) activate(best, 'scroll');
      else if (index >= 0 && (ratios[index] || 0) < 0.25) deactivate();
    }
    function observe() {
      if (io) io.disconnect();
      if (!('IntersectionObserver' in w)) { if (items.length && index < 0) activate(0, 'init'); return; }
      io = new w.IntersectionObserver(onIntersect, { root: rootEl(), threshold: [0, 0.25, 0.5, 0.6, 0.75, 0.9, 1] });
      for (var i = 0; i < items.length; i++) io.observe(items[i]);
    }
    function refresh() {
      var found = [].slice.call(container.querySelectorAll(o.itemSelector));
      var activeEl = items[index] || null;
      items = found;
      ratios = items.map(function () { return 0; });
      items.forEach(wireItem);
      index = activeEl ? items.indexOf(activeEl) : -1;
      applyMute();
      container.setAttribute('data-feed-autoplay', autoplayAllowed() ? 'on' : 'off');
      observe();
      if (index >= 0) manageSources(index);
      else if (items.length) manageSources(0);
      return items.length;
    }

    // ---------------------------------------------------------------- navigation
    function goTo(i, opts) {
      if (!items.length) return -1;
      i = Math.max(0, Math.min(items.length - 1, i | 0));
      var smooth = (opts && opts.smooth != null) ? opts.smooth : (o.scrollBehavior === 'smooth' && !reducedMotionOn());
      var lockMs = smooth ? 900 : 250;
      lockIndex = i; lockUntil = Date.now() + lockMs;
      clearTimeout(lockTimer);
      lockTimer = setTimeout(function () { lockIndex = -1; if (!destroyed) pick(); }, lockMs + 60);
      try { items[i].scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' }); } catch (e) { try { items[i].scrollIntoView(true); } catch (x) {} }
      activate(i, 'nav');
      return i;
    }
    function next() { return goTo(index < 0 ? 0 : index + 1); }
    function prev() { return goTo(index < 0 ? 0 : index - 1); }
    function play() { if (index < 0 && items.length) activate(0, 'api'); return playIndex(index, true); }
    function pause() { if (index >= 0) pauseIndex(index, true); }
    function toggle() { if (index < 0 && items.length) { activate(0, 'api'); return; } toggleIndex(index); }

    // ---------------------------------------------------------------- environment changes
    function envChanged() {
      container.setAttribute('data-feed-autoplay', autoplayAllowed() ? 'on' : 'off');
      if (index >= 0) { manageSources(index); if (!autoplayAllowed()) pauseIndex(index); }
    }
    function onVisibility() {
      if (doc.hidden) { var v = videoOf(index); wasPlaying = !!(v && !v.paused); if (index >= 0) pauseIndex(index); }
      else if (wasPlaying && index >= 0 && autoplayAllowed()) { playIndex(index, false); wasPlaying = false; }
    }
    var mqs = [mq('(prefers-reduced-motion: reduce)'), mq('(prefers-reduced-data: reduce)')];
    mqs.forEach(function (m) {
      if (!m) return;
      if (m.addEventListener) { m.addEventListener('change', envChanged); offs.push(function () { m.removeEventListener('change', envChanged); }); }
      else if (m.addListener) { m.addListener(envChanged); offs.push(function () { m.removeListener(envChanged); }); }
    });
    var conn = connection();
    if (conn && conn.addEventListener) { conn.addEventListener('change', envChanged); offs.push(function () { conn.removeEventListener('change', envChanged); }); }

    on(container, 'click', onClick);
    on(doc, 'visibilitychange', onVisibility);
    if (o.keyboard === 'container') {
      if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '0');
      on(container, 'keydown', onKey);
    } else if (o.keyboard) on(doc, 'keydown', onKey);
    if ('MutationObserver' in w) {
      var pending = false;
      mo = new w.MutationObserver(function (muts) {
        var relevant = muts.some(function (m) { return m.type === 'childList' && (m.addedNodes.length || m.removedNodes.length); });
        if (!relevant || pending) return;
        pending = true;
        setTimeout(function () { pending = false; if (!destroyed) refresh(); }, 0);
      });
      mo.observe(container, { childList: true, subtree: true });
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      clearTimeout(tapTimer); clearTimeout(lockTimer);
      if (io) io.disconnect();
      if (mo) mo.disconnect();
      offs.forEach(function (f) { try { f(); } catch (e) {} });
      for (var i = 0; i < items.length; i++) { pauseIndex(i); items[i].__ysdFeedWired = false; items[i].removeAttribute('data-feed-active'); }
      var k = registry.indexOf(ctrl);
      if (k >= 0) registry.splice(k, 1);
    }

    var ctrl = {
      container: container,
      options: o,
      items: function () { return items.slice(); },
      active: function () { return items[index] || null; },
      goTo: goTo, next: next, prev: prev,
      play: play, pause: pause, toggle: toggle,
      mute: function () { return setMuted(true, 'api'); },
      unmute: function () { return setMuted(false, 'api'); },
      toggleMute: function () { return setMuted(!muted, 'api'); },
      setMuted: function (m) { return setMuted(m, 'api'); },
      like: function (i) { return likeIndex(i == null ? index : i, 'api', null, false); },
      refresh: refresh, destroy: destroy,
      autoplayAllowed: autoplayAllowed,
      on: function (name, cb) {
        (listeners[name] = listeners[name] || []).push(cb);
        return function () { var a = listeners[name] || [], j = a.indexOf(cb); if (j >= 0) a.splice(j, 1); };
      }
    };
    Object.defineProperty(ctrl, 'index', { get: function () { return index; } });
    Object.defineProperty(ctrl, 'muted', { get: function () { return muted; } });
    registry.push(ctrl);
    refresh();
    return ctrl;
  }

  // ------------------------------------------------------------------ optional minimal renderer
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function fmt(n) { return YSD.counters && YSD.counters.format ? YSD.counters.format(n) : String(n || 0); }
  /** Default item markup (all user text escaped). Design teams pass opts.template instead. */
  function template(c) {
    var a = c.author || {}, who = a.handle || a.name || '';
    var label = 'Video' + (who ? ' by ' + who : '') + (c.caption ? ': ' + c.caption : '');
    return '<article class="ysd-feed-item" data-feed-item data-clip-id="' + esc(c.id) + '" data-orientation="' + esc(c.orientation || '') + '"' + (c.demo ? ' data-demo="true"' : '') + '>' +
      '<video playsinline muted loop preload="none" data-src="' + esc(c.src || '') + '"' + (c.poster ? ' data-poster="' + esc(c.poster) + '"' : '') + ' aria-label="' + esc(label) + '"></video>' +
      '<div class="ysd-feed-meta" data-feed-meta>' +
        (who ? '<p class="ysd-feed-author" data-feed-author>' + esc(who) + '</p>' : '') +
        (c.caption ? '<p class="ysd-feed-caption" data-feed-caption>' + esc(c.caption) + '</p>' : '') +
        (c.tags && c.tags.length ? '<p class="ysd-feed-tags" data-feed-tags>' + c.tags.map(function (t) { return '#' + esc(t); }).join(' ') + '</p>' : '') +
        (c.demo ? '<p class="ysd-feed-demo" data-feed-demo>Demo clip</p>' : '') +
      '</div>' +
      '<div class="ysd-feed-actions" data-feed-actions>' +
        '<button type="button" class="ysd-feed-btn" data-feed-like aria-pressed="' + (c.liked ? 'true' : 'false') + '">Like <span data-feed-likes>' + esc(fmt(c.likes)) + '</span></button>' +
        '<button type="button" class="ysd-feed-btn" data-feed-mute aria-pressed="true">Sound</button>' +
      '</div>' +
      '<progress class="ysd-feed-progress" data-feed-progress max="1" value="0" aria-hidden="true"></progress>' +
    '</article>';
  }

  /* ==== FALLBACK STYLES (video workstream placeholder; the design team replaces these) ==== */
  var FALLBACK_CSS = [
    '.ysd-feed-fallback{height:100vh;height:100dvh;overflow-y:auto;scroll-snap-type:y mandatory;overscroll-behavior:contain;background:#000;color:#fff;font:15px/1.35 system-ui,sans-serif}',
    '.ysd-feed-fallback .ysd-feed-item{position:relative;height:100%;scroll-snap-align:start;scroll-snap-stop:always;display:flex;align-items:center;justify-content:center;overflow:hidden;touch-action:manipulation}',
    '.ysd-feed-fallback video{width:100%;height:100%;object-fit:contain;background:#000}',
    '.ysd-feed-fallback .ysd-feed-meta{position:absolute;left:16px;right:96px;bottom:24px;text-shadow:0 1px 3px rgba(0,0,0,.7)}',
    '.ysd-feed-fallback .ysd-feed-meta p{margin:4px 0}',
    '.ysd-feed-fallback .ysd-feed-actions{position:absolute;right:12px;bottom:24px;display:flex;flex-direction:column;gap:8px}',
    '.ysd-feed-fallback .ysd-feed-btn{font:inherit;color:inherit;background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.5);border-radius:999px;padding:8px 12px;min-height:44px}',
    '.ysd-feed-fallback .ysd-feed-btn[aria-pressed="true"]{background:rgba(255,255,255,.25)}',
    '.ysd-feed-fallback .ysd-feed-progress{position:absolute;left:0;right:0;bottom:0;width:100%;height:3px;border:0;appearance:none;-webkit-appearance:none}',
    '.ysd-feed-fallback .ysd-feed-demo{display:inline-block;font-size:12px;border:1px solid currentColor;border-radius:999px;padding:1px 8px}'
  ].join('\n');
  /* ==== END FALLBACK STYLES ==== */
  function injectFallbackStyles() {
    if (!doc || doc.getElementById('ysd-feed-fallback-css')) return;
    var s = doc.createElement('style');
    s.id = 'ysd-feed-fallback-css';
    s.setAttribute('data-ysd-fallback', 'feed');
    s.textContent = FALLBACK_CSS;
    (doc.head || doc.documentElement).appendChild(s);
  }

  /**
   * Render clips into container and attach. opts: everything attach() takes, plus
   * template(clip, i) -> HTML string or Element, fallbackStyles (default: true when using the
   * default template), append (keep existing children).
   */
  function mount(container, clips, opts) {
    if (typeof container === 'string') container = doc.querySelector(container);
    if (!container) throw new Error('YSD.feed.mount: container element required');
    opts = opts || {};
    var tpl = typeof opts.template === 'function' ? opts.template : template;
    if (opts.fallbackStyles === true || (opts.fallbackStyles !== false && tpl === template)) {
      injectFallbackStyles();
      container.classList.add('ysd-feed-fallback');
    }
    if (!opts.append) container.innerHTML = '';
    var frag = doc.createDocumentFragment();
    (clips || []).forEach(function (c, i) {
      var out = tpl(c, i);
      if (typeof out === 'string') {
        var box = doc.createElement('div');
        box.innerHTML = out;
        while (box.firstChild) frag.appendChild(box.firstChild);
      } else if (out && out.nodeType) frag.appendChild(out);
    });
    container.appendChild(frag);
    return attach(container, opts);
  }

  YSD.feed = {
    version: '1.0.0',
    attach: attach,
    mount: mount,
    template: template,
    injectFallbackStyles: injectFallbackStyles,
    fallbackCSS: FALLBACK_CSS,
    defaults: DEFAULTS,
    instances: function () { return registry.slice(); },
    escape: esc
  };
})(typeof window !== 'undefined' ? window : this);
