/*!
 * assets/js/reel.js (W4): vertical clip cards for the home Reel strip and the clips feed.   YSD.reel
 *
 * Needs (load before it): the core stack, data/clips.js, assets/js/clips.js. Optional: data/events.js or
 * a slice with events.items (dated "Next one" chips), data/pages/clips.js or data/slices/clips.js
 * (labels, Spanish captions, prompt schedule; without them built-in EN/ES labels are used).
 * assets/js/feed.js may be left out: reel.js loads it on the first tap (no video bytes before that).
 *
 * ------------------------------------------------------------------------------------- HOME STRIP
 *   <div class="snap" data-qa="reel" data-reel></div>          the container (any element)
 *   YSD.reel.mount(el, { limit: 4, sort: 'new', showPost: true, postHref: 'post.html',
 *                        moreHref: 'clips.html', autoplay: false, report: true })
 *     -> controller { el, clips, ready: Promise<controller>, feed (null until the first tap),
 *                     render(), destroy() }
 *   Renders one card per clip, exactly the styleguide `.story` markup plus the YSD.feed hooks:
 *     <article class="story" data-feed-item data-clip-id="ID" data-reel-card aria-label="Clip 1 of 4: …">
 *       <div class="story__frame">
 *         <img src="poster.jpg" alt="" width="720" height="1280" loading="lazy" decoding="async">
 *         <video data-src="clip.mp4" data-poster="poster.jpg" muted playsinline preload="none" aria-label="Video by @handle: caption"></video>
 *         <div class="story__bars" aria-hidden="true"><i data-feed-progress></i></div>
 *         <button class="story__play" type="button" data-feed-play aria-pressed="false" aria-label="Play clip by @handle">…</button>
 *         <button class="story__mute" …data-feed-mute>    only when the clip has sound (demo clips have none)
 *       </div>
 *       <div class="story__meta"><p class="story__handle">@demo.maria</p><span class="tag tag--demo">DEMO clip</span></div>
 *       <a class="chip story__action" href="vote.html#renew-mail-ballot" data-reel-action="renew">How to renew</a>
 *       <details class="story__captions" data-reel-captions><summary>Read the captions</summary>…</details>
 *       <a class="story__report" href="clips.html?report=ID">Report</a>       (report: true)
 *     </article>
 *     …then, with showPost, the styleguide `.story story--post` card linking to postHref.
 *   Clips play only on tap (autoplay: false is forced for the strip), muted, one at a time; keyboard
 *   users tab to each Play button. No view or like numbers are ever rendered.
 *   Styling: components.css has every .story class except .story__captions and .story__report (a Lead
 *   request is filed); until then the host page styles those two.
 *
 * ------------------------------------------------------------------------------------- HELPERS
 *   YSD.reel.card(clip, { variant: 'strip' | 'feed', index, total, report })  -> <article>
 *     'feed' adds the clips-page layout classes (x-clip*, styled by assets/css/pages/clips.css): a rail
 *     with Like (heart, aria-pressed, no count), Sound (only with audio) and Share, plus Report and a
 *     native "Video controls" toggle under the caption.
 *   YSD.reel.action(clip)     -> { kind, href, label }   one action chip per clip (BRIEF §6 tag map)
 *   YSD.reel.info(clip)       -> { title, who, caption, captionLang, translated, lines, linesEs, hasAudio }
 *   YSD.reel.transcript(clip) -> <details class="story__captions">  built from burnedInText
 *   YSD.reel.prompt(date?)    -> this week's prompt { tag, title, from, to, rest?, script?, tips? } or null
 *   YSD.reel.whenFeed()       -> Promise<YSD.feed>  (injects assets/js/feed.js once if missing)
 *   YSD.reel.share(clip)      -> native share or copy of the clip's link (clips.html#clip-ID, with ref)
 *   YSD.reel.label(key, vars) -> 'clips:reel.*' / 'clips:action.*' copy with built-in fallbacks
 *   YSD.reel.announce(text)   -> writes a screen-reader-only line into the shared role=status region
 * Events (document, via YSD.emit): ysd:reel-report {id, opener} when a feed card's Report is pressed
 *   (the clips page opens its report sheet), ysd:reel-rendered {el, count}.
 * Untrusted text (captions, handles, tags) always goes in with textContent. No AI, no counts, no trackers.
 */
(function (w) {
  'use strict';
  var YSD = w.YSD = w.YSD || {};
  var d = w.document;

  // Built-in labels (used when data/pages/clips.js or its slice isn't on the page).
  var L = {
    en: {
      'reel.play': 'Play clip by {who}', 'reel.like': 'Like clip by {who}', 'reel.mute': 'Mute', 'reel.share': 'Share this clip',
      'reel.report': 'Report', 'reel.reportLabel': 'Report clip by {who}', 'reel.captions': 'Read the captions',
      'reel.captionsOriginal': 'On screen', 'reel.captionsSpanish': 'In Spanish', 'reel.translated': 'Translated from English',
      'reel.controls': 'Video controls', 'reel.silent': 'No sound · captions on', 'reel.videoBy': 'Video by {who}: {caption}',
      'reel.postTitle': 'Post yours', 'reel.postSub': '60 seconds, filmed vertical, about why you showed up.',
      'reel.more': 'See all clips', 'reel.moreCaption': 'More', 'reel.lessCaption': 'Less', 'reel.liked': 'Liked. Only you can see it.', 'reel.unliked': 'Like removed.',
      'reel.playing': 'Playing', 'reel.paused': 'Paused', 'reel.soundOn': 'Sound on', 'reel.soundOff': 'Sound off',
      'reel.shareText': 'Short clip from someone here in Seminole. Worth a minute:',
      'action.renew': 'How to renew', 'action.vote': 'Get voting help', 'action.volunteer': 'Find a volunteer shift',
      'action.event': 'Come to the next one', 'action.eventDated': 'Next hangout: {date}', 'action.join': 'Join free',
      'demo.clip': 'DEMO clip', 'stock': 'Stock photo · not members', 'clipOf': 'Clip {n} of {total}: {title}', 'you': 'You'
    },
    es: {
      'reel.play': 'Reproducir el clip de {who}', 'reel.like': 'Me gusta el clip de {who}', 'reel.mute': 'Silenciar', 'reel.share': 'Compartir este clip',
      'reel.report': 'Reportar', 'reel.reportLabel': 'Reportar el clip de {who}', 'reel.captions': 'Leer los subtítulos',
      'reel.captionsOriginal': 'En pantalla (en inglés)', 'reel.captionsSpanish': 'En español', 'reel.translated': 'Traducido del inglés',
      'reel.controls': 'Controles del video', 'reel.silent': 'Sin sonido · con subtítulos', 'reel.videoBy': 'Video de {who}: {caption}',
      'reel.postTitle': 'Sube el tuyo', 'reel.postSub': '60 segundos, grabado en vertical, sobre por qué participaste.',
      'reel.more': 'Ver todos los clips', 'reel.moreCaption': 'Más', 'reel.lessCaption': 'Menos', 'reel.liked': 'Te gustó. Solo tú lo ves.', 'reel.unliked': 'Quitaste el me gusta.',
      'reel.playing': 'Reproduciendo', 'reel.paused': 'En pausa', 'reel.soundOn': 'Sonido activado', 'reel.soundOff': 'Sonido desactivado',
      'reel.shareText': 'Un clip corto de alguien de aquí, de Seminole. Vale la pena verlo:',
      'action.renew': 'Cómo renovar', 'action.vote': 'Ayuda para votar', 'action.volunteer': 'Busca un turno de voluntariado',
      'action.event': 'Ven a la próxima', 'action.eventDated': 'Próximo encuentro: {date}', 'action.join': 'Únete gratis',
      'demo.clip': 'Clip DEMO', 'stock': 'Foto de archivo · no son miembros', 'clipOf': 'Clip {n} de {total}: {title}', 'you': 'Tú'
    }
  };
  // Fallback action map (BRIEF §6), used when YSD_DATA.reel.actions is missing. First match wins.
  var ACTIONS = [
    { kind: 'renew', tags: ['vote-by-mail'], href: 'vote.html#renew-mail-ballot' },
    { kind: 'volunteer', tags: ['canvass', 'volunteer', 'text-bank'], href: 'events.html?kind=volunteer' },
    { kind: 'join', tags: ['precinct-captain', 'organizing'], href: 'join.html' },
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
    controls: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 17h18M3 7h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="8" cy="17" r="2.4"/><circle cx="16" cy="7" r="2.4"/></svg>'
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
  function data() { return w.YSD_DATA || {}; }
  function reelData() { return data().reel || {}; }
  function el(tag, attrs, kids) {
    var n = d.createElement(tag);
    if (attrs) for (var k in attrs) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'text') n.textContent = String(v);
      else if (k === 'html') n.innerHTML = v; // trusted static markup only (icons)
      else if (k === 'class') n.className = v;
      else n.setAttribute(k, v === true ? '' : String(v));
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? d.createTextNode(c) : c); });
    return n;
  }
  function resolve(p) { return YSD.clips && YSD.clips.resolve ? YSD.clips.resolve(p) : p; }
  function track(e, p) { try { if (typeof YSD.track === 'function') YSD.track(e, p); } catch (x) {} }
  function emit(n, det) { if (typeof YSD.emit === 'function') YSD.emit(n, det); else { try { d.dispatchEvent(new CustomEvent('ysd:' + n, { detail: det })); } catch (e) {} } }

  // This script's own folder, so feed.js can be injected from any page depth.
  var siteBase = (function () {
    try {
      var s = d.currentScript && d.currentScript.src;
      if (s && /assets\/js\/reel\.js/.test(s)) return s.replace(/assets\/js\/reel\.js.*$/, '');
    } catch (e) {}
    return typeof YSD.root === 'string' ? YSD.root : '';
  })();

  // ------------------------------------------------------------------ clip facts
  function rawItem(id) {
    var c = data().clips, items = c && c.items || [];
    for (var i = 0; i < items.length; i++) if (items[i] && items[i].id === id) return items[i];
    return null;
  }
  function info(clip) {
    var L2 = lang(), tr = (reelData().clips || {})[clip.id] || {}, raw = clip.source === 'demo' ? rawItem(clip.id) : null;
    var lines = (tr.lines && tr.lines.en || clip.burnedInText || (raw && raw.burnedInText) || []).slice();
    var who = (clip.author && (clip.author.handle || clip.author.name)) || label('you');
    var title = (tr.title && (tr.title[L2] || tr.title.en)) || lines[0] || String(clip.caption || '').slice(0, 48) || who;
    var caption = clip.caption || '', captionLang = null, translated = false;
    if (L2 === 'es' && tr.caption && tr.caption.es) { caption = tr.caption.es; translated = true; }
    else if (L2 === 'es' && clip.source === 'demo') captionLang = 'en';
    return {
      title: title, who: who, caption: caption, captionLang: captionLang, translated: translated,
      lines: lines, linesEs: L2 === 'es' && tr.lines && tr.lines.es ? tr.lines.es.slice() : null,
      hasAudio: clip.source === 'local' ? true : raw ? raw.audio !== false : clip.source !== 'demo'
    };
  }

  // ------------------------------------------------------------------ action chip
  function nextEvent(kind, series) {
    var E = data().events, items = E && E.items || [], now = Date.now(), best = null;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it || !it.start || Date.parse(it.start) <= now) continue;
      if (kind && it.kind !== kind) continue;
      if (series && series.indexOf(it.series) < 0) continue;
      if (it.status === 'cancelled') continue;
      if (!best || Date.parse(it.start) < Date.parse(best.start)) best = it;
    }
    return best;
  }
  function action(clip) {
    var map = (reelData().actions && reelData().actions.length) ? reelData().actions : ACTIONS;
    var tags = (clip.tags || []).map(function (t) { return String(t).toLowerCase(); });
    var pick = null;
    for (var i = 0; i < map.length && !pick; i++) {
      var a = map[i], tt = a.tags || [];
      if (!tt.length) pick = a;
      else for (var j = 0; j < tt.length; j++) if (tags.indexOf(tt[j]) >= 0) { pick = a; break; }
    }
    pick = pick || ACTIONS[ACTIONS.length - 1];
    var out = { kind: pick.kind, href: pick.href, label: label('action.' + pick.kind) };
    if (pick.kind === 'event') {
      var ev = nextEvent(null, tags) || nextEvent(pick.eventKind) || nextEvent(null);
      if (ev) {
        out.href = 'events/' + ev.id + '.html';
        out.eventId = ev.id;
        out.label = YSD.fmt && YSD.fmt.date ? label('action.eventDated', { date: YSD.fmt.date(ev.start) }) : label('action.event');
      }
    }
    return out;
  }
  function actionEl(clip, variant) {
    var a = action(clip);
    var kids = [el('span', { text: a.label })];
    if (variant === 'feed') kids.push(el('span', { class: 'x-chip-arrow', 'aria-hidden': 'true', html: ICON.arrow }));
    var link = el('a', { class: 'chip story__action', href: a.href, 'data-reel-action': a.kind, 'data-feed-ignore': true }, kids);
    link.addEventListener('click', function () { track('clip_action', { clip: clip.id, target: a.kind }); });
    return link;
  }

  // ------------------------------------------------------------------ transcript
  function transcript(clip) {
    var f = info(clip);
    var det = el('details', { class: 'story__captions', 'data-reel-captions': true, 'data-feed-ignore': true });
    det.appendChild(el('summary', { text: label('reel.captions') }));
    var body = el('div', { class: 'story__captions-body' });
    var lines = f.lines.length ? f.lines : (clip.caption ? [clip.caption] : []);
    if (f.linesEs) {
      body.appendChild(el('p', { class: 'story__captions-label', text: label('reel.captionsOriginal') }));
      body.appendChild(list(lines, 'en'));
      body.appendChild(el('p', { class: 'story__captions-label', text: label('reel.captionsSpanish') }));
      body.appendChild(list(f.linesEs, null));
    } else {
      body.appendChild(list(lines, lang() === 'es' && clip.source === 'demo' ? 'en' : null));
    }
    det.appendChild(body);
    return det;
    function list(arr, lg) {
      var ol = el('ol', { class: 'story__captions-list', lang: lg });
      arr.forEach(function (s) { ol.appendChild(el('li', { text: s })); });
      return ol;
    }
  }

  // ------------------------------------------------------------------ posters: load only near the screen
  // The <video> carries data-poster; its poster attribute is set when it comes within half a screen.
  // (Native lazy loading fetches far ahead and would put three or four 100 KB posters in the first view.)
  var posterIO = null;
  function showPoster(v) { var s = v.getAttribute('data-poster'); if (s && !v.getAttribute('poster')) v.setAttribute('poster', resolve(s)); }
  function lazyPoster(v) {
    if (!('IntersectionObserver' in w)) { showPoster(v); return v; }
    if (!posterIO) posterIO = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { showPoster(e.target); posterIO.unobserve(e.target); } });
    }, { rootMargin: '50% 50% 50% 50%' });
    posterIO.observe(v);
    return v;
  }

  // ------------------------------------------------------------------ cards
  function frame(clip, f, variant) {
    var fr = el('div', { class: 'story__frame' + (variant === 'feed' ? ' x-clip__frame' : '') });
    var v = el('video', {
      'data-src': clip.src || null, 'data-poster': clip.poster || null, muted: true, playsinline: true, preload: 'none',
      'aria-label': label('reel.videoBy', { who: f.who, caption: f.title })
    });
    v.muted = true;
    fr.appendChild(lazyPoster(v));
    fr.appendChild(el('div', { class: 'story__bars', 'aria-hidden': 'true' }, [el('i', { 'data-feed-progress': true })]));
    fr.appendChild(el('button', { class: 'story__play', type: 'button', 'data-feed-play': true, 'aria-pressed': 'false', 'aria-label': label('reel.play', { who: f.who }), html: variant === 'feed' ? ICON.play + ICON.pause : ICON.play }));
    if (variant === 'strip' && f.hasAudio) fr.appendChild(el('button', { class: 'story__mute', type: 'button', 'data-feed-mute': true, 'aria-pressed': 'true', 'aria-label': label('reel.mute'), html: ICON.sound }));
    if (variant === 'feed') fr.appendChild(el('span', { class: 'x-clip__burst', 'aria-hidden': 'true', html: ICON.heart }));
    return fr;
  }
  function stockTag(clip, cls) {
    var raw = clip.source === 'demo' ? rawItem(clip.id) : null;
    return raw && raw.photos && raw.photos.length ? el('span', { class: 'tag tag--stock' + (cls ? ' ' + cls : ''), text: core('tag.stock', label('stock')) }) : null;
  }
  function meta(clip, f, withStock) {
    var m = el('div', { class: 'story__meta' }, [el('p', { class: 'story__handle', text: f.who, translate: 'no' })]);
    if (clip.demo) m.appendChild(el('span', { class: 'tag tag--demo', text: core('demo.badgeClip', label('demo.clip')) }));
    if (withStock) { var st = stockTag(clip); if (st) m.appendChild(st); }
    return m;
  }
  function card(clip, opts) {
    opts = opts || {};
    var variant = opts.variant === 'feed' ? 'feed' : 'strip';
    var f = info(clip);
    var art = el('article', {
      class: 'story' + (variant === 'feed' ? ' x-clip' : ''), 'data-feed-item': true, 'data-clip-id': clip.id, 'data-reel-card': true,
      'data-demo': clip.demo ? 'true' : null, id: variant === 'feed' ? 'clip-' + clip.id : null,
      'aria-label': opts.total ? label('clipOf', { n: (opts.index || 0) + 1, total: opts.total, title: f.title }) : f.title
    });
    if (variant === 'strip') {
      art.appendChild(frame(clip, f, variant));
      art.appendChild(meta(clip, f, true));
      art.appendChild(actionEl(clip));
      art.appendChild(transcript(clip));
      if (opts.report) art.appendChild(el('a', { class: 'story__report', href: (opts.reportHref || 'clips.html') + '?report=' + encodeURIComponent(clip.id), 'aria-label': label('reel.reportLabel', { who: f.who }), text: label('reel.report') }));
      return art;
    }
    // feed variant: [frame][rail] then the info column
    var stage = el('div', { class: 'x-clip__stage' });
    var fr = frame(clip, f, variant);
    var st = stockTag(clip, 'x-clip__stock');
    if (st) fr.appendChild(st);
    stage.appendChild(fr);
    var rail = el('div', { class: 'x-clip__rail' });
    rail.appendChild(el('button', { class: 'x-rail-btn x-rail-btn--like', type: 'button', 'data-feed-like': true, 'aria-pressed': clip.liked ? 'true' : 'false', 'aria-label': label('reel.like', { who: f.who }), html: ICON.heart }));
    var sh = el('button', { class: 'x-rail-btn', type: 'button', 'data-reel-share': true, 'aria-label': label('reel.share'), html: ICON.share });
    sh.addEventListener('click', function () { share(clip); });
    rail.appendChild(sh);
    var rep = el('button', { class: 'x-rail-btn', type: 'button', 'data-reel-report': true, 'aria-label': label('reel.reportLabel', { who: f.who }), html: ICON.flag });
    rep.addEventListener('click', function () { emit('reel-report', { id: clip.id, clip: clip, opener: rep }); });
    rail.appendChild(rep);
    var ctl = el('button', { class: 'x-rail-btn', type: 'button', 'data-reel-controls': true, 'aria-pressed': 'false', 'aria-label': label('reel.controls'), html: ICON.controls });
    ctl.addEventListener('click', function () { toggleControls(art, ctl); });
    rail.appendChild(ctl);
    if (f.hasAudio) rail.appendChild(el('button', { class: 'x-rail-btn x-rail-btn--mute', type: 'button', 'data-feed-mute': true, 'aria-pressed': 'true', 'aria-label': label('reel.mute'), html: ICON.sound }));
    stage.appendChild(rail);
    art.appendChild(stage);

    var inf = el('div', { class: 'x-clip__info' });
    var m = meta(clip, f, false);
    if (f.translated) m.appendChild(el('span', { class: 'x-clip__note', 'data-kind': 'translated', text: label('reel.translated') }));
    else if (!f.hasAudio) m.appendChild(el('span', { class: 'x-clip__note', 'data-kind': 'silent', text: label('reel.silent') }));
    inf.appendChild(m);
    if (f.caption) {
      var capEl = el('p', { class: 'x-clip__caption', id: 'cap-' + clip.id, lang: f.captionLang, text: f.caption });
      inf.appendChild(capEl);
      // "more" only when the 4-line clamp actually cuts the caption (measured once it's in the page)
      var more = el('button', { class: 'x-more', type: 'button', hidden: true, 'aria-expanded': 'false', 'aria-controls': 'cap-' + clip.id, 'data-feed-ignore': true, text: label('reel.moreCaption') });
      more.addEventListener('click', function () {
        var open = more.getAttribute('aria-expanded') !== 'true';
        more.setAttribute('aria-expanded', String(open));
        if (open) capEl.setAttribute('data-expanded', ''); else capEl.removeAttribute('data-expanded');
        more.textContent = label(open ? 'reel.lessCaption' : 'reel.moreCaption');
      });
      inf.appendChild(more);
      (w.requestAnimationFrame || setTimeout)(function () { if (capEl.scrollHeight > capEl.clientHeight + 2) more.hidden = false; });
    }
    var row = el('div', { class: 'x-clip__row' });
    row.appendChild(actionEl(clip, 'feed'));
    row.appendChild(transcript(clip));
    inf.appendChild(row);
    art.appendChild(inf);
    return art;
  }
  function toggleControls(art, btn) {
    var v = art.querySelector('video');
    if (!v) return;
    var on = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(on));
    if (on) {
      var ds = v.getAttribute('data-src');
      if (ds && !v.getAttribute('src')) { v.preload = 'metadata'; v.setAttribute('src', resolve(ds)); }
      var dp = v.getAttribute('data-poster');
      if (dp && !v.getAttribute('poster')) v.setAttribute('poster', resolve(dp));
      v.setAttribute('data-feed-ignore', '');
    } else v.removeAttribute('data-feed-ignore');
    v.controls = on;
    art.setAttribute('data-controls', on ? 'on' : 'off');
  }
  function postCard(opts) {
    var a = el('a', { class: 'story__frame', href: opts.postHref || 'post.html' }, [
      el('span', { class: 'story__plus', 'aria-hidden': 'true', text: '+' }),
      el('span', { class: 'story__post-title', text: label('reel.postTitle') }),
      el('span', { class: 'small', text: label('reel.postSub') })
    ]);
    return el('article', { class: 'story story--post', 'data-reel-post': true }, [a]);
  }

  // ------------------------------------------------------------------ share one clip
  function share(clip) {
    var page = (lang() === 'es' ? 'es/' : '') + 'clips.html#clip-' + clip.id;
    var url = YSD.share && YSD.share.url ? YSD.share.url(page) : String(w.location.href).split('#')[0] + '#clip-' + clip.id;
    var text = core('share.clip.sms', label('reel.shareText') + ' {link}', { link: '' }).replace(/\s+$/, '');
    // the link follows the text, so the DEMO label goes before a trailing colon: "Worth a minute (DEMO clip): <link>"
    if (clip.demo) { var colon = /:$/.test(text); text = text.replace(/:$/, '') + ' (' + core('demo.badgeClip', label('demo.clip')) + ')' + (colon ? ':' : ''); }
    var title = info(clip).title;
    var p = YSD.share && YSD.share.native ? YSD.share.native({ title: title, text: text, url: url, channel: 'share' }) : Promise.resolve('failed');
    return p.then(function (res) {
      if (res === 'copied' && YSD.ui && YSD.ui.toast) YSD.ui.toast(core('toast.linkCopied', 'Link copied.'));
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
    r.textContent = '';
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
    opts = assignTo({ limit: 4, sort: 'new', showPost: true, postHref: 'post.html', moreHref: 'clips.html', report: true, preload: 0 }, opts || {});
    var ctrl = { el: root, clips: [], feed: null, ready: null, render: render, destroy: destroy };
    var off = [];
    function render() {
      if (!YSD.clips || !YSD.clips.list) return Promise.resolve(ctrl);
      return YSD.clips.list({ sort: opts.sort, limit: opts.limit }).then(function (clips) {
        ctrl.clips = clips;
        root.textContent = '';
        clips.forEach(function (c, i) { root.appendChild(card(c, { variant: 'strip', index: i, total: clips.length, report: opts.report, reportHref: opts.moreHref })); });
        if (opts.showPost) root.appendChild(postCard(opts));
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
    // Nothing downloads before this.
    function onFirst(e) {
      if (ctrl.feed) return;
      var item = e.target.closest && e.target.closest('[data-feed-item]');
      if (!item || e.target.closest('a, details, summary')) return;
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
    mount: mount, card: card, action: action, info: info, transcript: transcript, prompt: prompt,
    whenFeed: whenFeed, share: share, label: label, announce: announce, icons: ICON,
    _ny: { today: nyToday, addDays: addDays, mondayOf: mondayOf }
  };
})(window);
