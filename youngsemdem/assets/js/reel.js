/*!
 * assets/js/reel.js (G-VIDEO): vertical clip cards for the home Reel strip and the clips feed.    YSD.reel
 *
 * Needs (load before it): the core stack, data/clips.js, assets/js/clips.js. Optional: an events slice
 * (dated action chips), data/pages/clips.js or data/slices/clips.js (labels, prompt schedule; built-in EN/ES
 * fallbacks otherwise). assets/js/feed.js may be left out: reel.js loads it on the first tap. The card
 * stylesheet assets/css/reel.css is loaded by reel.js itself when the page doesn't link it (home doesn't
 * have to), and the first render waits for it, so nothing jumps.
 *
 * ------------------------------------------------------------------------------------- HOME STRIP
 *   <div class="snap" data-qa="reel" data-reel></div>
 *   YSD.reel.mount(el, { limit: 4, sort: 'new', showPost: true, postHref: 'post.html', moreHref: 'clips.html',
 *                        series: '' })   -> controller { el, clips, ready: Promise, feed, render(), destroy(), attach() }
 *   One card per clip (round 1, genz-brand-07: fewer labels):
 *     <article class="story x-rc" data-reel-card data-feed-item data-clip-id="ID" data-demo="true" data-series="seminole-60"
 *              style="--clip-color:#4A3A8C;--clip-lqip:url(data:…)" aria-label="Clip 1 of 4: Renew your mail ballot request">
 *       <div class="story__frame x-rc__frame">            the placeholder colour + blurred lqip, never black
 *         <video data-src data-poster muted playsinline preload="none" aria-label="Video by @demo.maria: …"></video>
 *         <div class="x-rc__cap" data-reel-cap aria-hidden="true">…</div>   TikTok-style captions, page language
 *         <div class="story__bars"><i data-feed-progress></i></div>
 *         <span class="tag tag--demo x-rc__demo">DEMO · stock photo</span>            the one label
 *         <a class="x-rc__series" href="clips.html?series=seminole-60">Seminole in 60</a>   the format badge
 *         <button class="story__play" data-feed-play>…</button>
 *         <button class="x-rc__more" data-reel-more aria-haspopup="dialog">···</button>  captions, report, share
 *       </div>
 *       <a class="chip story__action" data-reel-action="renew">How to renew</a>       the one thing under the clip
 *     </article>
 *   then, with showPost, a `.story story--post` card. Clips play only on tap there, muted, one at a time.
 *   Host layout: give the strip items a width (--snap-item); the card is the frame plus one chip (about
 *   frame height + 56 px). No view or like numbers are ever rendered.
 *
 * ------------------------------------------------------------------------------------- HELPERS
 *   YSD.reel.card(clip, { variant: 'strip' | 'feed', index, total, moreHref })  -> <article>
 *     'feed' adds the clips-page layout (x-clip*, assets/css/pages/clips.css): a rail with Like (heart, no
 *     count), Captions on/off, Share and ··· (more), plus an info panel (handle, format, caption, action).
 *   YSD.reel.action(clip)     -> { kind, href, label }   one action chip per clip (tag map, see actionMap())
 *   YSD.reel.info(clip)       -> { title, who, caption, captionLang, translated, from, cues, cuesOriginal, series, hasAudio }
 *   YSD.reel.cues(clip, lang) -> [[start, end, text]]   captions for one language (falls back to the original)
 *   YSD.reel.series(id?)      -> one format { id, name, blurb, cadence, sticker, color } or the list
 *   YSD.reel.seriesBadge(id, {href, tag}) -> <a|span class="x-rc__series">  sticker + name (for shelves too)
 *   YSD.reel.transcript(clip) -> <details class="story__captions">  built from the caption cues
 *   YSD.reel.more(clip, opener, {feed}) opens the ··· sheet (captions, share, report, video controls, how it works)
 *   YSD.reel.captionsOn() / setCaptions(bool)   overlay captions preference (store 'reel:cc', default on)
 *   YSD.reel.poster(card)     loads that card's poster now (feeds call it for the next card)
 *   YSD.reel.prompt(date?)    -> this week's prompt { tag, title, from, to, rest?, script?, tips? } or null
 *   YSD.reel.whenFeed()       -> Promise<YSD.feed>  (injects assets/js/feed.js once if missing)
 *   YSD.reel.whenCss()        -> Promise  (assets/css/reel.css is on the page)
 *   YSD.reel.share(clip)      -> native share or copy of the clip's link (clips.html#clip-ID, with ref)
 *   YSD.reel.label(key, vars) -> 'clips:*' copy with built-in fallbacks
 *   YSD.reel.announce(text)   -> a screen-reader-only line in the shared role=status region
 * Events (document): ysd:reel-report {id, clip, opener} (the clips page opens its report sheet; elsewhere the
 *   ··· sheet links to clips.html?report=ID), ysd:reel-rendered {el, count}, ysd:reel-controls {id, on}.
 * Untrusted text (captions, handles, tags) always goes in with textContent. No AI, no counts, no trackers.
 */
(function (w) {
  'use strict';
  var YSD = w.YSD = w.YSD || {};
  var d = w.document;

  // Built-in labels (used when data/pages/clips.js or its slice isn't on the page, e.g. home).
  var L = {
    en: {
      'reel.play': 'Play clip by {who}', 'reel.like': 'Like clip by {who}', 'reel.mute': 'Mute', 'reel.share': 'Share this clip',
      'reel.report': 'Report this clip', 'reel.reportLabel': 'Report clip by {who}', 'reel.captions': 'Read the captions',
      'reel.captionsOriginal': 'As filmed ({lang})', 'reel.captionsSpanish': 'In Spanish', 'reel.translated': 'Captions translated from {lang}',
      'reel.controls': 'Video controls', 'reel.videoBy': 'Video by {who}: {caption}',
      'reel.postTitle': 'Post yours', 'reel.postSub': '60 seconds, filmed vertical, about why you showed up.',
      'reel.more': 'More: captions, share, report', 'reel.moreLabel': 'More for the clip by {who}: captions, share, report',
      'reel.moreCaption': 'More', 'reel.lessCaption': 'Less', 'reel.liked': 'Liked. Only you can see it.', 'reel.unliked': 'Like removed.',
      'reel.playing': 'Playing', 'reel.paused': 'Paused', 'reel.soundOn': 'Sound on', 'reel.soundOff': 'Sound off',
      'reel.cc': 'Captions on the video', 'reel.ccOn': 'Captions on', 'reel.ccOff': 'Captions off',
      'reel.shareText': 'Short clip from someone here in Seminole. Worth a minute:',
      'reel.how': 'How the Reel works', 'reel.series': 'Format: {name}', 'reel.close': 'Close', 'reel.photos': 'Photos: Unsplash stand-ins. People shown are not members.',
      'reel.facts': 'Sources for this clip', 'reel.lang.en': 'English', 'reel.lang.es': 'Spanish',
      'action.renew': 'How to renew', 'action.vote': 'Get voting help', 'action.volunteer': 'Find a volunteer shift',
      'action.event': 'Come to the next one', 'action.eventDated': 'Next hangout: {date}', 'action.join': 'Join free',
      'action.role': 'Ask about the role', 'action.post': 'Post yours', 'action.studentId': 'What ID to bring',
      'action.sunrail': 'SunRail social: {date}', 'action.sunrailDrop': 'SunRail social drops {date}',
      'demo.clip': 'DEMO clip', 'demo.stock': 'DEMO · stock photo', 'clipOf': 'Clip {n} of {total}: {title}', 'you': 'You'
    },
    es: {
      'reel.play': 'Reproducir el clip de {who}', 'reel.like': 'Me gusta el clip de {who}', 'reel.mute': 'Silenciar', 'reel.share': 'Compartir este clip',
      'reel.report': 'Reportar este clip', 'reel.reportLabel': 'Reportar el clip de {who}', 'reel.captions': 'Leer los subtítulos',
      'reel.captionsOriginal': 'Como se grabó ({lang})', 'reel.captionsSpanish': 'En español', 'reel.translated': 'Subtítulos traducidos del {lang}',
      'reel.controls': 'Controles del video', 'reel.videoBy': 'Video de {who}: {caption}',
      'reel.postTitle': 'Sube el tuyo', 'reel.postSub': '60 segundos, grabado en vertical, sobre por qué participaste.',
      'reel.more': 'Más: subtítulos, compartir, reportar', 'reel.moreLabel': 'Más opciones del clip de {who}: subtítulos, compartir, reportar',
      'reel.moreCaption': 'Más', 'reel.lessCaption': 'Menos', 'reel.liked': 'Te gustó. Solo tú lo ves.', 'reel.unliked': 'Quitaste el me gusta.',
      'reel.playing': 'Reproduciendo', 'reel.paused': 'En pausa', 'reel.soundOn': 'Sonido activado', 'reel.soundOff': 'Sonido desactivado',
      'reel.cc': 'Subtítulos en el video', 'reel.ccOn': 'Subtítulos activados', 'reel.ccOff': 'Subtítulos desactivados',
      'reel.shareText': 'Un clip corto de alguien de aquí, de Seminole. Vale la pena verlo:',
      'reel.how': 'Cómo funcionan los clips', 'reel.series': 'Formato: {name}', 'reel.close': 'Cerrar', 'reel.photos': 'Fotos: de archivo (Unsplash). Las personas no son miembros.',
      'reel.facts': 'Fuentes de este clip', 'reel.lang.en': 'inglés', 'reel.lang.es': 'español',
      'action.renew': 'Cómo renovar', 'action.vote': 'Ayuda para votar', 'action.volunteer': 'Busca un turno de voluntariado',
      'action.event': 'Ven a la próxima', 'action.eventDated': 'Próximo encuentro: {date}', 'action.join': 'Únete gratis',
      'action.role': 'Pregunta por el puesto', 'action.post': 'Sube el tuyo', 'action.studentId': 'Qué identificación llevar',
      'action.sunrail': 'Encuentro SunRail: {date}', 'action.sunrailDrop': 'El encuentro SunRail sale el {date}',
      'demo.clip': 'Clip DEMO', 'demo.stock': 'DEMO · foto de archivo', 'clipOf': 'Clip {n} de {total}: {title}', 'you': 'Tú'
    }
  };
  // Fallback action map, used when YSD_DATA.reel.actions is missing. First match wins (BRIEF §6, round 1).
  var ACTIONS = [
    { kind: 'renew', tags: ['vote-by-mail'], href: 'vote.html#renew-mail-ballot' },
    { kind: 'studentId', tags: ['student-id'], href: 'vote.html#student-id' },
    { kind: 'sunrail', tags: ['sunrail', 'transit'], series: 'sunrail', href: 'join.html' },
    { kind: 'post', tags: ['why-i-showed-up', 'open-mic'], href: 'post.html?tag=why-i-showed-up' },
    { kind: 'volunteer', tags: ['canvass', 'volunteer', 'text-bank'], href: 'events.html?kind=volunteer' },
    { kind: 'role', tags: ['precinct-captain', 'organizing'], href: 'join.html?intent=role' },
    { kind: 'event', tags: ['events', 'recap', 'trivia', 'social', 'meetup', 'rally', 'squad'], eventKind: 'social', href: 'events.html' },
    { kind: 'vote', tags: ['explainer', 'how-to-vote', 'first-time-voter', 'register', 'psa'], href: 'vote.html' },
    { kind: 'join', tags: [], href: 'join.html' }
  ];
  var ICON = {
    play: '<svg class="x-i-play" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg class="x-i-pause" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
    heart: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 2.9 4.5 6.6 4.5c2.1 0 3.6 1.1 5.4 3.2 1.8-2.1 3.3-3.2 5.4-3.2 3.7 0 5.7 3.9 4.2 7.3C19.5 16.4 12 21 12 21z"/></svg>',
    sound: '<svg class="x-i-on" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 9h4l5-4v14l-5-4H4zM16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg><svg class="x-i-off" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>',
    share: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3.5 11.2 20.5 4l-5.6 16.5-3.6-6.8z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="none"/><path d="M11.3 13.7 20.5 4" stroke="currentColor" stroke-width="2" fill="none"/></svg>',
    flag: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 21V4M5 4h11l-2 4 2 4H5" stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="none"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12h13M13 6l6 6-6 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
    controls: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 17h18M3 7h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="8" cy="17" r="2.4"/><circle cx="16" cy="7" r="2.4"/></svg>',
    cc: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="2.5" y="5" width="19" height="14" rx="3.5" stroke="currentColor" stroke-width="2" fill="none"/><path d="M10.4 10.2a2.6 2.6 0 1 0 0 3.6M17.4 10.2a2.6 2.6 0 1 0 0 3.6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>',
    dots: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="5" cy="12" r="2.3"/><circle cx="12" cy="12" r="2.3"/><circle cx="19" cy="12" r="2.3"/></svg>',
    info: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9.5" stroke="currentColor" stroke-width="2" fill="none"/><path d="M12 11v6M12 7.2v.1" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" fill="none"/></svg>'
  };

  // ------------------------------------------------------------------ small utils
  function lang() { return YSD.lang || (/^es/i.test(d.documentElement.getAttribute('lang') || '') ? 'es' : 'en'); }
  function fill(s, vars) { return String(s == null ? '' : s).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? String(vars[k]) : m; }); }
  function label(key, vars) {
    var s = '';
    if (typeof YSD.t === 'function' && YSD.t.has && YSD.t.has('clips:' + key)) s = YSD.t('clips:' + key, vars);
    if (s) return s;
    var tbl = L[lang()] || L.en;
    return fill(tbl[key] != null ? tbl[key] : (L.en[key] || ''), vars);
  }
  function core(key, fb, vars) { var s = typeof YSD.t === 'function' && YSD.t.has && YSD.t.has(key) ? YSD.t(key, vars) : ''; return s || fill(fb, vars); }
  function pick(o) { return o && typeof o === 'object' ? (o[lang()] || o.en || '') : (o || ''); }
  function data() { return w.YSD_DATA || {}; }
  function reelData() { return data().reel || {}; }
  function el(tag, attrs, kids) {
    var n = d.createElement(tag);
    if (attrs) for (var k in attrs) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'text') n.textContent = String(v);
      else if (k === 'html') n.innerHTML = v; // trusted static markup only (icons, sticker art)
      else if (k === 'class') n.className = v;
      else n.setAttribute(k, v === true ? '' : String(v));
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? d.createTextNode(c) : c); });
    return n;
  }
  function resolve(p) { return YSD.clips && YSD.clips.resolve ? YSD.clips.resolve(p) : p; }
  function track(e, p) { try { if (typeof YSD.track === 'function') YSD.track(e, p); } catch (x) {} }
  function emit(n, det) { if (typeof YSD.emit === 'function') YSD.emit(n, det); else { try { d.dispatchEvent(new CustomEvent('ysd:' + n, { detail: det })); } catch (e) {} } }
  function reduced() { try { return w.matchMedia('(prefers-reduced-motion: reduce)').matches || !!(YSD.ui && YSD.ui.motion && YSD.ui.motion.paused()); } catch (e) { return false; } }
  function sget(k, f) { try { return YSD.store ? YSD.store.get(k, f) : f; } catch (e) { return f; } }
  function sset(k, v) { try { if (YSD.store) YSD.store.set(k, v); } catch (e) {} }

  // This script's own folder, so feed.js and reel.css can be loaded from any page depth.
  var siteBase = (function () {
    try {
      var s = d.currentScript && d.currentScript.src;
      if (s && /assets\/js\/reel\.js/.test(s)) return s.replace(/assets\/js\/reel\.js.*$/, '');
    } catch (e) {}
    return typeof YSD.root === 'string' ? YSD.root : '';
  })();

  // ------------------------------------------------------------------ the card stylesheet (home loads it lazily)
  var cssPromise = null;
  function whenCss() {
    if (cssPromise) return cssPromise;
    var have = d.querySelector('link[rel="stylesheet"][href*="assets/css/reel.css"]');
    if (have) { cssPromise = Promise.resolve(); return cssPromise; }
    cssPromise = new Promise(function (res) {
      var l = d.createElement('link');
      l.rel = 'stylesheet'; l.href = siteBase + 'assets/css/reel.css';
      var done = function () { res(); };
      l.onload = done; l.onerror = done;
      setTimeout(done, 1800);
      (d.head || d.body).appendChild(l);
    });
    return cssPromise;
  }

  // ------------------------------------------------------------------ clip facts
  function rawItem(id) {
    var c = data().clips, items = c && c.items || [];
    for (var i = 0; i < items.length; i++) if (items[i] && items[i].id === id) return items[i];
    return null;
  }
  function field(clip, k) { if (clip[k] != null) return clip[k]; var r = clip.source === 'demo' ? rawItem(clip.id) : null; return r ? r[k] : null; }
  function seriesList() { var c = data().clips; return (c && c.series) || []; }
  function series(id) {
    if (!arguments.length) return seriesList();
    var list = seriesList();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function cues(clip, lg) {
    var caps = field(clip, 'captions');
    lg = lg || lang();
    if (caps) {
      var t = caps[lg] || caps[field(clip, 'lang') || 'en'] || caps.en;
      if (t && t.cues) return t.cues.slice();
    }
    var bt = field(clip, 'burnedInText');
    if (bt && bt.length) { var dur = +clip.duration || 10, step = dur / bt.length; return bt.map(function (s, i) { return [i * step, (i + 1) * step, s]; }); }
    return [];
  }
  function info(clip) {
    var L2 = lang(), tr = (reelData().clips || {})[clip.id] || {};
    var from = field(clip, 'lang') || 'en';
    var t = field(clip, 'title'), ci = field(clip, 'captionI18n');
    var cs = cues(clip, L2), co = cues(clip, from);
    var who = (clip.author && (clip.author.handle || clip.author.name)) || label('you');
    var title = (t && (t[L2] || t.en)) || (tr.title && (tr.title[L2] || tr.title.en)) || (cs[0] && cs[0][2]) || String(clip.caption || '').slice(0, 48) || who;
    var caption = clip.caption || '', captionLang = null, translated = false;
    if (ci && ci[L2]) { caption = ci[L2]; translated = from !== L2; }
    else if (L2 === 'es' && tr.caption && tr.caption.es) { caption = tr.caption.es; translated = true; }
    else if (clip.source === 'demo' && from !== L2) captionLang = from;
    return {
      title: title, who: who, caption: caption, captionLang: captionLang, translated: translated, from: from,
      cues: cs, cuesOriginal: from !== L2 ? co : null, series: field(clip, 'series') || null,
      hasAudio: clip.source === 'local' ? true : (rawItem(clip.id) ? rawItem(clip.id).audio !== false : clip.source !== 'demo')
    };
  }
  function hasPhotos(clip) { var p = field(clip, 'photos'); return !!(p && p.length); }

  // ------------------------------------------------------------------ action chip
  function nyParts(iso) {
    try {
      var f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' });
      return f.format(new Date(iso));
    } catch (e) { return ''; }
  }
  function weekday(iso) { return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].indexOf(nyParts(iso)) >= 0; }
  function eventsData() { return data().events || {}; }
  function nextEvent(match) {
    var items = eventsData().items || [], now = Date.now(), best = null;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it || !it.start || Date.parse(it.start) <= now || it.status === 'cancelled') continue;
      if (!match(it)) continue;
      if (!best || Date.parse(it.start) < Date.parse(best.start)) best = it;
    }
    return best;
  }
  function dropInfo() {
    var E = eventsData(), dr = E.schedule && E.schedule.drop;
    if (!dr || !dr.opensAt) return null;
    return { opensAt: dr.opensAt, cutoff: dr.cutoff, open: Date.now() >= Date.parse(dr.opensAt) };
  }
  function fmtDate(iso, o) { return YSD.fmt && YSD.fmt.date ? YSD.fmt.date(iso, o) : String(iso).slice(0, 10); }
  function actionMap() { return (reelData().actions && reelData().actions.length) ? reelData().actions : ACTIONS; }
  function action(clip) {
    var tags = (clip.tags || []).map(function (t) { return String(t).toLowerCase(); });
    var map = actionMap(), pick1 = null;
    for (var i = 0; i < map.length && !pick1; i++) {
      var a = map[i], tt = a.tags || [];
      if (!tt.length) pick1 = a;
      else for (var j = 0; j < tt.length; j++) if (tags.indexOf(tt[j]) >= 0) { pick1 = a; break; }
    }
    pick1 = pick1 || ACTIONS[ACTIONS.length - 1];
    var out = { kind: pick1.kind, href: pick1.href, label: label('action.' + pick1.kind) };
    if (pick1.kind === 'event') {
      var ev = nextEvent(function (it) { return tags.indexOf(it.series) >= 0; }) || nextEvent(function (it) { return it.kind === (pick1.eventKind || 'social'); }) || nextEvent(function () { return true; });
      if (ev) { out.href = 'events/' + ev.id + '.html'; out.eventId = ev.id; out.label = label('action.eventDated', { date: fmtDate(ev.start) }); }
    } else if (pick1.kind === 'sunrail') {
      // SunRail runs weekdays only (sunrail.com, checked Nov 10, 2026): only ever point at a weekday event.
      var sr = nextEvent(function (it) { return (it.series === (pick1.series || 'sunrail') || /sunrail/i.test(it.id)) && weekday(it.start); });
      // A January event stays a teaser until the drop opens (events.html keeps its date hidden till then).
      var dr = dropInfo(), locked = sr && dr && !dr.open && Date.parse(sr.start) > Date.parse(dr.opensAt);
      if (sr && !locked) { out.href = 'events/' + sr.id + '.html'; out.eventId = sr.id; out.label = label('action.sunrail', { date: fmtDate(sr.start) }); }
      else if (locked) { out.href = 'events.html#drop'; out.label = label('action.sunrailDrop', { date: fmtDate(dr.opensAt, { weekday: false }) }); }
      else { out.kind = 'join'; out.href = pick1.href || 'join.html'; out.label = label('action.join'); }
    }
    return out;
  }
  function actionEl(clip, variant) {
    var a = action(clip);
    var kids = [el('span', { text: a.label })];
    kids.push(el('span', { class: 'x-chip-arrow', 'aria-hidden': 'true', html: ICON.arrow }));
    var link = el('a', { class: 'chip story__action', href: a.href, 'data-reel-action': a.kind, 'data-feed-ignore': true }, kids);
    if (a.kind === 'post') { var tg = (clip.tags || []).indexOf('why-i-showed-up') >= 0 ? 'why-i-showed-up' : 'open-mic'; link.setAttribute('data-post-tag', tg); }
    link.addEventListener('click', function () { track('clip_action', { clip: clip.id, target: a.kind }); });
    return link;
  }

  // ------------------------------------------------------------------ series badge
  function stickerSvg(id) {
    if (YSD.ui && YSD.ui.stickerSvg) return YSD.ui.stickerSvg(id) || '';
    var S = data().stickers, items = S && S.items || [];
    for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i].svg;
    return '';
  }
  function seriesBadge(id, o) {
    var s = series(id);
    if (!s) return null;
    o = o || {};
    var name = pick(s.name);
    var attrs = { class: 'x-rc__series' + (o.cls ? ' ' + o.cls : ''), 'data-series-badge': s.id, 'data-color': s.color || null, 'data-feed-ignore': true };
    if (s.id === 'en-espanol' && lang() !== 'es') attrs.lang = 'es';
    var n;
    if (o.href) { attrs.href = o.href; n = el('a', attrs); }
    else if (o.button) { attrs.type = 'button'; n = el('button', attrs); }
    else n = el('span', attrs);
    n.appendChild(el('span', { class: 'x-rc__series-art', 'aria-hidden': 'true', html: stickerSvg(s.sticker) }));
    n.appendChild(el('span', { class: 'x-rc__series-name', text: name }));
    return n;
  }

  // ------------------------------------------------------------------ transcript
  function transcript(clip, opts) {
    var f = info(clip);
    var det = el('details', { class: 'story__captions', 'data-reel-captions': true, 'data-feed-ignore': true, open: opts && opts.open });
    det.appendChild(el('summary', { text: label('reel.captions') }));
    var body = el('div', { class: 'story__captions-body' });
    var lines = f.cues.map(function (c) { return c[2]; });
    if (!lines.length && clip.caption) lines = [clip.caption];
    if (f.cuesOriginal) {
      body.appendChild(el('p', { class: 'story__captions-label', text: label('reel.translated', { lang: label('reel.lang.' + f.from) }) }));
      body.appendChild(list(lines, null));
      body.appendChild(el('p', { class: 'story__captions-label', text: label('reel.captionsOriginal', { lang: label('reel.lang.' + f.from) }) }));
      body.appendChild(list(f.cuesOriginal.map(function (c) { return c[2]; }), f.from));
    } else body.appendChild(list(lines, null));
    det.appendChild(body);
    return det;
    function list(arr, lg) {
      var ol = el('ol', { class: 'story__captions-list', lang: lg });
      arr.forEach(function (s) { ol.appendChild(el('li', { text: s })); });
      return ol;
    }
  }

  // ------------------------------------------------------------------ captions on the video
  function captionsOn() { return sget('reel:cc', true) !== false; }
  function setCaptions(on) {
    sset('reel:cc', !!on);
    Array.prototype.forEach.call(d.querySelectorAll('[data-reel-card]'), function (c) { c.setAttribute('data-cc', on ? 'on' : 'off'); });
    Array.prototype.forEach.call(d.querySelectorAll('[data-reel-cc]'), function (b) { b.setAttribute('aria-pressed', String(!!on)); });
  }
  function cueAt(list, t) {
    for (var i = 0; i < list.length; i++) if (t >= list[i][0] - 0.01 && t < list[i][1]) return list[i];
    return t >= (list.length ? list[list.length - 1][1] : 0) ? list[list.length - 1] : list[0];
  }
  function captionEngine(art, clip, v, box) {
    var list = info(clip).cues, raf = 0, last = '';
    if (!list.length) { box.hidden = true; return; }
    function draw(t, playing) {
      var c = cueAt(list, t);
      if (!c) return;
      var words = String(c[2]).split(/\s+/), n = words.length, k = n;
      if (playing && !reduced()) {
        var span = Math.max(0.35, (c[1] - c[0]) * 0.6);
        k = Math.max(1, Math.min(n, Math.ceil(((t - c[0]) / span) * n + 0.001)));
      }
      var key = c[0] + ':' + k;
      if (key === last) return;
      last = key;
      box.textContent = '';
      var line = el('span', { class: 'x-rc__cap-text' });
      // word-by-word while playing (the box grows like TikTok's auto captions); the full line when paused
      words.slice(0, k).forEach(function (wd, i) {
        var s = el('span', { class: 'x-rc__w', text: wd });
        if (playing && i === k - 1 && k < n) s.setAttribute('data-on', '');
        line.appendChild(s);
        if (i < k - 1) line.appendChild(d.createTextNode(' '));
      });
      box.appendChild(line);
    }
    function loop() { draw(v.currentTime || 0, true); raf = (w.requestAnimationFrame || setTimeout)(loop); }
    function stop() { if (raf) { (w.cancelAnimationFrame || clearTimeout)(raf); raf = 0; } }
    v.addEventListener('play', function () { stop(); loop(); });
    v.addEventListener('playing', function () { stop(); loop(); });
    v.addEventListener('pause', function () { stop(); draw(v.currentTime || 0, false); });
    v.addEventListener('seeked', function () { if (v.paused) draw(v.currentTime || 0, false); });
    v.addEventListener('emptied', function () { stop(); draw(0, false); });
    v.addEventListener('ended', function () { stop(); draw(0, false); });
    draw(0, false);
    // native captions for the controls / fullscreen mode (no file fetch: cues come from the data)
    try {
      if (v.addTextTrack && w.VTTCue) {
        var tt = v.addTextTrack('captions', lang() === 'es' ? 'Español' : 'English', lang());
        list.forEach(function (c) { tt.addCue(new w.VTTCue(c[0], c[1], c[2])); });
        tt.mode = 'hidden';
        v.__ysdTrack = tt;
      }
    } catch (e) {}
  }

  // ------------------------------------------------------------------ posters: placeholder colour first, poster near the screen
  var vio = null;
  function showPoster(v) { if (!v) return; var s = v.getAttribute('data-poster'); if (s && !v.getAttribute('poster')) v.setAttribute('poster', resolve(s)); }
  function poster(card) { showPoster(card && card.querySelector('video')); }
  function observe(v, root) {
    if (!('IntersectionObserver' in w)) { showPoster(v); return; }
    if (root) {
      // a horizontal strip: watch the cards against the strip itself, a full strip-width ahead
      if (!root.__ysdPosterIO) root.__ysdPosterIO = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { showPoster(e.target); root.__ysdPosterIO.unobserve(e.target); } });
      }, { root: root, rootMargin: '0px 100% 0px 100%' });
      root.__ysdPosterIO.observe(v);
      return;
    }
    if (!vio) vio = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { showPoster(e.target); vio.unobserve(e.target); } });
    }, { rootMargin: '100% 0px 100% 0px' });
    vio.observe(v);
  }

  // ------------------------------------------------------------------ cards
  function frame(clip, f, variant, opts) {
    var fr = el('div', { class: 'story__frame x-rc__frame' + (variant === 'feed' ? ' x-clip__frame' : '') });
    var v = el('video', {
      'data-src': clip.src || null, 'data-poster': clip.poster || null, muted: true, playsinline: true, preload: 'none',
      'aria-label': label('reel.videoBy', { who: f.who, caption: f.title })
    });
    v.muted = true;
    fr.appendChild(v);
    var cap = el('div', { class: 'x-rc__cap', 'data-reel-cap': true, 'aria-hidden': 'true' });
    fr.appendChild(cap);
    fr.appendChild(el('div', { class: 'story__bars', 'aria-hidden': 'true' }, [el('i', { 'data-feed-progress': true })]));
    if (clip.demo) fr.appendChild(el('span', { class: 'tag tag--demo x-rc__demo', text: hasPhotos(clip) ? label('demo.stock') : core('demo.badgeClip', label('demo.clip')) }));
    if (f.series) {
      // strips: a small label (the ··· sheet links the format); the feed: a 44 px link that filters to the format
      var sb = seriesBadge(f.series, variant === 'feed' ? { href: (opts.moreHref || 'clips.html') + '?series=' + encodeURIComponent(f.series) } : {});
      if (sb) fr.appendChild(sb);
    }
    fr.appendChild(el('button', { class: 'story__play', type: 'button', 'data-feed-play': true, 'aria-pressed': 'false', 'aria-label': label('reel.play', { who: f.who }), html: ICON.play + ICON.pause }));
    if (variant === 'strip') {
      if (f.hasAudio) fr.appendChild(el('button', { class: 'story__mute', type: 'button', 'data-feed-mute': true, 'aria-pressed': 'true', 'aria-label': label('reel.mute'), html: ICON.sound }));
      fr.appendChild(moreButton(clip, f, opts, 'x-rc__more'));
    }
    if (variant === 'feed') fr.appendChild(el('span', { class: 'x-clip__burst', 'aria-hidden': 'true', html: ICON.heart }));
    return { fr: fr, v: v, cap: cap };
  }
  function moreButton(clip, f, opts, cls) {
    var b = el('button', { class: cls, type: 'button', 'data-reel-more': true, 'data-feed-ignore': true, 'aria-haspopup': 'dialog', 'aria-label': label('reel.moreLabel', { who: f.who }), html: ICON.dots });
    b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); more(clip, b, { feed: opts.variant === 'feed', moreHref: opts.moreHref }); });
    return b;
  }
  function card(clip, opts) {
    opts = opts || {};
    var variant = opts.variant === 'feed' ? 'feed' : 'strip';
    opts.variant = variant;
    var f = info(clip);
    var color = field(clip, 'color'), lqip = field(clip, 'lqip');
    var style = '';
    if (color && /^#[0-9a-f]{3,8}$/i.test(color)) style += '--clip-color:' + color + ';';
    if (lqip && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(lqip)) style += '--clip-lqip:url(' + lqip + ');';
    var art = el('article', {
      class: 'story x-rc' + (variant === 'feed' ? ' x-clip' : ''), 'data-feed-item': true, 'data-clip-id': clip.id, 'data-reel-card': true,
      'data-demo': clip.demo ? 'true' : null, 'data-series': f.series, 'data-cc': captionsOn() ? 'on' : 'off', id: variant === 'feed' ? 'clip-' + clip.id : null,
      style: style || null,
      'aria-label': opts.total ? label('clipOf', { n: (opts.index || 0) + 1, total: opts.total, title: f.title }) : f.title
    });
    var parts = frame(clip, f, variant, opts);
    if (variant === 'strip') {
      art.appendChild(parts.fr);
      art.appendChild(actionEl(clip, variant));
    } else {
      var stage = el('div', { class: 'x-clip__stage' });
      stage.appendChild(parts.fr);
      var rail = el('div', { class: 'x-clip__rail' });
      rail.appendChild(el('button', { class: 'x-rail-btn x-rail-btn--like', type: 'button', 'data-feed-like': true, 'aria-pressed': clip.liked ? 'true' : 'false', 'aria-label': label('reel.like', { who: f.who }), html: ICON.heart }));
      var cc = el('button', { class: 'x-rail-btn x-rail-btn--cc', type: 'button', 'data-reel-cc': true, 'data-feed-ignore': true, 'aria-pressed': String(captionsOn()), 'aria-label': label('reel.cc'), html: ICON.cc });
      cc.addEventListener('click', function () { var on = !captionsOn(); setCaptions(on); announce(label(on ? 'reel.ccOn' : 'reel.ccOff')); });
      rail.appendChild(cc);
      var sh = el('button', { class: 'x-rail-btn', type: 'button', 'data-reel-share': true, 'data-feed-ignore': true, 'aria-label': label('reel.share'), html: ICON.share });
      sh.addEventListener('click', function () { share(clip); });
      rail.appendChild(sh);
      rail.appendChild(moreButton(clip, f, opts, 'x-rail-btn x-rail-btn--more'));
      if (f.hasAudio) rail.appendChild(el('button', { class: 'x-rail-btn x-rail-btn--mute', type: 'button', 'data-feed-mute': true, 'aria-pressed': 'true', 'aria-label': label('reel.mute'), html: ICON.sound }));
      stage.appendChild(rail);
      art.appendChild(stage);
      var inf = el('div', { class: 'x-clip__info' });
      var who = el('p', { class: 'x-clip__who' }, [el('span', { class: 'story__handle', translate: 'no', text: f.who })]);
      inf.appendChild(who);
      if (f.caption) {
        var capEl = el('p', { class: 'x-clip__caption', id: 'cap-' + clip.id, lang: f.captionLang, text: f.caption });
        inf.appendChild(capEl);
      }
      var row = el('div', { class: 'x-clip__row' });
      row.appendChild(actionEl(clip, variant));
      inf.appendChild(row);
      art.appendChild(inf);
    }
    captionEngine(art, clip, parts.v, parts.cap);
    observe(parts.v, opts.posterRoot || null);
    return art;
  }
  function toggleControls(art, on) {
    var v = art.querySelector('video');
    if (!v) return;
    if (on) {
      var ds = v.getAttribute('data-src');
      if (ds && !v.getAttribute('src')) { v.preload = 'metadata'; v.setAttribute('src', resolve(ds)); }
      showPoster(v);
      v.setAttribute('data-feed-ignore', '');
    } else v.removeAttribute('data-feed-ignore');
    v.controls = on;
    if (v.__ysdTrack) v.__ysdTrack.mode = on && captionsOn() ? 'showing' : 'hidden';
    art.setAttribute('data-controls', on ? 'on' : 'off');
    emit('reel-controls', { id: art.getAttribute('data-clip-id'), on: on });
  }
  function postCard(opts) {
    var a = el('a', { class: 'story__frame', href: opts.postHref || 'post.html' }, [
      el('span', { class: 'story__plus', 'aria-hidden': 'true', text: '+' }),
      el('span', { class: 'story__post-title', text: label('reel.postTitle') }),
      el('span', { class: 'small', text: label('reel.postSub') })
    ]);
    return el('article', { class: 'story story--post', 'data-reel-post': true }, [a]);
  }

  // ------------------------------------------------------------------ the ··· sheet
  var moreDlg = null, moreFor = null;
  function moreSheet() {
    if (moreDlg) return moreDlg;
    moreDlg = el('dialog', { class: 'sheet x-more', id: 'reel-more', 'aria-labelledby': 'reel-more-title' });
    moreDlg.innerHTML = '';
    var head = el('div', { class: 'sheet__head' }, [
      el('div', { class: 'stack stack--sm x-more__head' }, [
        el('p', { class: 'x-more__tags', 'data-more-tags': true }),
        el('h2', { class: 'sheet__title', id: 'reel-more-title', 'data-more-title': true }),
        el('p', { class: 'small x-more__who', 'data-more-who': true })
      ]),
      el('button', { class: 'sheet__close', type: 'button', 'data-sheet-close': true, 'aria-label': core('a11y.close', label('reel.close')), html: ICON.close })
    ]);
    moreDlg.appendChild(head);
    moreDlg.appendChild(el('div', { class: 'sheet__body x-more__body', 'data-more-body': true }));
    moreDlg.querySelector('[data-sheet-close]').addEventListener('click', function () { closeMore(); });
    (d.querySelector('main') || d.body).appendChild(moreDlg);   // inside main, so it takes the page's colour world
    return moreDlg;
  }
  function closeMore() { if (moreDlg && YSD.ui && YSD.ui.sheet) YSD.ui.sheet.close(moreDlg); else if (moreDlg && moreDlg.close) moreDlg.close(); }
  function more(clip, opener, o) {
    o = o || {};
    var dlg = moreSheet(), f = info(clip);
    moreFor = clip;
    var tags = dlg.querySelector('[data-more-tags]');
    tags.textContent = '';
    if (clip.demo) tags.appendChild(el('span', { class: 'tag tag--demo', text: hasPhotos(clip) ? label('demo.stock') : label('demo.clip') }));
    if (f.series) { var sb = seriesBadge(f.series, { href: (o.moreHref || 'clips.html') + '?series=' + encodeURIComponent(f.series), cls: 'x-rc__series--inline' }); if (sb) tags.appendChild(sb); }
    dlg.querySelector('[data-more-title]').textContent = f.title;
    var whoLine = f.who + (f.series && series(f.series) ? ' · ' + pick(series(f.series).cadence) : '');
    dlg.querySelector('[data-more-who]').textContent = whoLine;
    var body = dlg.querySelector('[data-more-body]');
    body.textContent = '';
    var list = el('div', { class: 'x-more__list' });
    var tr = transcript(clip, { open: true });
    tr.classList.add('x-more__captions');
    var art = opener && opener.closest ? opener.closest('[data-reel-card]') : null;
    function row(icon, text, attrs, fn) {
      var b = el(attrs && attrs.href ? 'a' : 'button', Object.assign({ class: 'x-more__row', type: attrs && attrs.href ? null : 'button' }, attrs || {}), [
        el('span', { class: 'x-more__icon', 'aria-hidden': 'true', html: icon }), el('span', { text: text })
      ]);
      if (fn) b.addEventListener('click', fn);
      return b;
    }
    list.appendChild(row(ICON.share, label('reel.share'), null, function () { share(clip); }));
    if (o.feed && art) {
      var on = art.getAttribute('data-controls') === 'on';
      var ctl = row(ICON.controls, label('reel.controls'), { 'aria-pressed': String(on) }, function () {
        var nowOn = ctl.getAttribute('aria-pressed') !== 'true';
        ctl.setAttribute('aria-pressed', String(nowOn));
        toggleControls(art, nowOn);
      });
      list.appendChild(ctl);
    }
    var ccRow = row(ICON.cc, label('reel.cc'), { 'aria-pressed': String(captionsOn()), 'data-reel-cc': true }, function () { var v = !captionsOn(); setCaptions(v); announce(label(v ? 'reel.ccOn' : 'reel.ccOff')); });
    list.appendChild(ccRow);
    if (o.feed && art) list.appendChild(row(ICON.flag, label('reel.report'), null, function () { closeMore(); var op = art.querySelector('[data-reel-more]') || opener; setTimeout(function () { emit('reel-report', { id: clip.id, clip: clip, opener: op }); }, 40); }));
    else list.appendChild(row(ICON.flag, label('reel.report'), { href: (o.moreHref || 'clips.html') + '?report=' + encodeURIComponent(clip.id) }));
    var howHref = (o.moreHref || 'clips.html') + '#how';
    list.appendChild(row(ICON.info, label('reel.how'), o.feed ? { 'data-reel-how': true } : { href: howHref }, o.feed ? function () { closeMore(); setTimeout(function () { emit('reel-how', { opener: art && art.querySelector('[data-reel-more]') }); }, 40); } : null));
    body.appendChild(list);
    body.appendChild(tr);
    var facts = field(clip, 'facts') || [];
    if (facts.length) {
      var fx = el('div', { class: 'x-more__facts' }, [el('p', { class: 'story__captions-label', text: label('reel.facts') })]);
      var ul = el('ul', { class: 'x-more__factlist' });
      facts.forEach(function (fa) {
        var host = ''; try { host = new URL(fa.source).hostname.replace(/^www\./, ''); } catch (e) {}
        ul.appendChild(el('li', null, [el('a', { href: fa.source, rel: 'noopener', text: host || fa.source })]));
      });
      fx.appendChild(ul);
      body.appendChild(fx);
    }
    if (hasPhotos(clip)) body.appendChild(el('p', { class: 'small x-more__credit', text: label('reel.photos') }));
    if (YSD.ui && YSD.ui.sheet) YSD.ui.sheet.open(dlg, { opener: opener });
    else if (dlg.showModal) dlg.showModal();
    var first = list.querySelector('button, a');
    if (first) first.focus();
    return dlg;
  }

  // ------------------------------------------------------------------ share one clip
  function share(clip) {
    var page = 'clips.html#clip-' + clip.id;
    var url = YSD.share && YSD.share.url ? YSD.share.url(page) : String(w.location.href).split('#')[0] + '#clip-' + clip.id;
    var text = core('share.clip.sms', label('reel.shareText') + ' {link}', { link: '' }).replace(/\s+$/, '');
    if (clip.demo) { var colon = /:$/.test(text); text = text.replace(/:$/, '') + ' (' + core('demo.badgeClip', label('demo.clip')) + ')' + (colon ? ':' : ''); }
    var title = info(clip).title;
    var p = YSD.share && YSD.share.native ? YSD.share.native({ title: title, text: text, url: url, channel: 'share' }) : Promise.resolve('failed');
    return p.then(function (res) {
      if (res === 'copied' && YSD.ui && YSD.ui.toast) YSD.ui.toast(core('toast.linkCopied', 'Link copied.'), { priority: 'high' });
      else if (res === 'failed' && YSD.ui && YSD.ui.toast) YSD.ui.toast(core('error.share.failed', 'Sharing didn’t work. Copy the address bar instead.'), { tone: 'error' });
      return res;
    });
  }

  // ------------------------------------------------------------------ status line (screen readers only)
  function announce(text) {
    if (!text) return;
    var r = d.querySelector('[data-toast-region]');
    if (!r) return;
    var p = el('p', { class: 'u-visually-hidden', text: text });
    Array.prototype.forEach.call(r.querySelectorAll('.u-visually-hidden'), function (x) { x.remove(); });
    r.appendChild(p);
  }

  // ------------------------------------------------------------------ weekly prompt
  function nyToday(date) {
    try {
      var f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
      var o = {}; f.formatToParts(date || new Date()).forEach(function (p) { o[p.type] = p.value; });
      return o.year + '-' + o.month + '-' + o.day;
    } catch (e) { var x = date || new Date(); return x.toISOString().slice(0, 10); }
  }
  function addDays(ymd, n) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd), t = Date.UTC(+m[1], +m[2] - 1, +m[3]) + n * 864e5;
    return new Date(t).toISOString().slice(0, 10);
  }
  function mondayOf(ymd) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd), dow = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();
    return addDays(ymd, -((dow + 6) % 7));
  }
  function prompt(date) {
    var R = reelData(), today = nyToday(date), list = R.prompts || [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i], to = addDays(p.weekOf, 6);
      if (today >= p.weekOf && today <= to) return assignTo({ from: p.weekOf, to: to }, p);
    }
    if (!R.evergreen) return null;
    var mon = mondayOf(today);
    return assignTo({ from: mon, to: addDays(mon, 6), evergreen: true }, R.evergreen);
  }
  function assignTo(t, s) { for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) t[k] = s[k]; return t; }

  // ------------------------------------------------------------------ feed.js on demand
  var feedPromise = null;
  function whenFeed() {
    if (YSD.feed && YSD.feed.attach) return Promise.resolve(YSD.feed);
    if (feedPromise) return feedPromise;
    feedPromise = new Promise(function (res, rej) {
      var s = d.createElement('script');
      s.src = siteBase + 'assets/js/feed.js';
      s.onload = function () { YSD.feed ? res(YSD.feed) : rej(new Error('feed.js did not load')); };
      s.onerror = function () { feedPromise = null; rej(new Error('feed.js failed')); };
      d.body.appendChild(s);
    });
    return feedPromise;
  }

  // ------------------------------------------------------------------ home strip
  function mount(root, opts) {
    if (typeof root === 'string') root = d.querySelector(root);
    if (!root) return null;
    opts = assignTo({ limit: 4, sort: 'new', showPost: true, postHref: 'post.html', moreHref: 'clips.html', preload: 0, series: '' }, opts || {});
    var ctrl = { el: root, clips: [], feed: null, ready: null, render: render, destroy: destroy };
    var off = [];
    function render() {
      if (!YSD.clips || !YSD.clips.list) return Promise.resolve(ctrl);
      return Promise.all([YSD.clips.list({ sort: opts.sort, limit: opts.series ? 0 : opts.limit }), whenCss()]).then(function (r) {
        var clips = r[0];
        if (opts.series) clips = clips.filter(function (c) { return field(c, 'series') === opts.series; });
        clips = clips.filter(function (c) { return c.source !== 'local'; }).slice(0, opts.limit || clips.length);
        ctrl.clips = clips;
        root.textContent = '';
        clips.forEach(function (c, i) { root.appendChild(card(c, { variant: 'strip', index: i, total: clips.length, moreHref: opts.moreHref, posterRoot: root })); });
        if (opts.showPost) root.appendChild(postCard(opts));
        root.addEventListener('scroll', function onS() { var cs = root.querySelectorAll('[data-reel-card]'); for (var i = 0; i < Math.min(cs.length, 2); i++) poster(cs[i]); root.removeEventListener('scroll', onS); }, { passive: true });
        emit('reel-rendered', { el: root, count: clips.length });
        return ctrl;
      });
    }
    function attach() {
      if (ctrl.feed) return Promise.resolve(ctrl.feed);
      return whenFeed().then(function (F) {
        if (!ctrl.feed) ctrl.feed = F.attach(root, { autoplay: false, keyboard: false, preload: opts.preload, scrollBehavior: 'auto', doubleTapLike: false, like: false });
        return ctrl.feed;
      });
    }
    // First tap on a card: load feed.js, attach, then replay the tap so YSD.feed plays that card.
    function onFirst(e) {
      if (ctrl.feed) return;
      var item = e.target.closest && e.target.closest('[data-feed-item]');
      if (!item || e.target.closest('a, details, summary, [data-reel-more]')) return;
      e.preventDefault(); e.stopPropagation();
      var target = e.target, x = e.clientX, y = e.clientY;
      attach().then(function () {
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      }).catch(function () {
        var v = item.querySelector('video');
        if (v) { v.setAttribute('src', resolve(v.getAttribute('data-src'))); v.controls = true; }
      });
    }
    root.addEventListener('click', onFirst, true);
    off.push(function () { root.removeEventListener('click', onFirst, true); });
    function destroy() { off.forEach(function (f) { f(); }); if (ctrl.feed) ctrl.feed.destroy(); ctrl.feed = null; }
    ctrl.attach = attach;
    ctrl.ready = render();
    return ctrl;
  }

  YSD.reel = {
    mount: mount, card: card, action: action, info: info, cues: cues, series: series, seriesBadge: seriesBadge,
    transcript: transcript, more: more, closeMore: closeMore, captionsOn: captionsOn, setCaptions: setCaptions, poster: poster,
    toggleControls: toggleControls, prompt: prompt, whenFeed: whenFeed, whenCss: whenCss, share: share, label: label, announce: announce, icons: ICON,
    _ny: { today: nyToday, addDays: addDays, mondayOf: mondayOf, weekday: weekday }
  };
})(window);
