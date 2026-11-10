/*! YDSC · assets/js/maker.js (W5). The share-card maker (BRIEF 5.2). Classic script, no AI, no network.
 *
 * CONTRACT (Home W1 uses it; the quiz page uses it for result cards and "Me, on the cover"):
 *   Load after the core stack: assets/js/cards-brand.js, then this file; assets/css/maker.css in the head;
 *   data/slices/growth.js (or data/sharekit.js + data/levels.js); issues data (slice or full) for the
 *   cover's "I'm here for"; events data (or W2's eventcard.js) for invite; assets/js/membercard.js is optional
 *   (it powers the squad meter and the "Card Maker" sticker).
 *
 *   var m = YSD.maker.mount(el, {
 *     templates: ['invite', 'psa-mail', 'join', 'cover'],   // shown as chips, in this order; unavailable
 *                                                           // ones are dropped (psa-mail ends Jan 1, 2027;
 *                                                           // rewind opens Dec 17, 2026, 7 am or ?preview=rewind)
 *     template: 'cover',        // first one shown (else the saved draft's, else the first)
 *     eventId: '<events.js id>',// invite: preselect this event
 *     size: 'portrait'|'story', // 4:5 (default) or 9:16
 *     data: {},                 // extra template data (quiz: { resultId, undertone, mix })
 *     message: '',              // prefilled message (else data/sharekit.js groupChat in a friend's voice)
 *     compact: false,           // quiz result mode: preview, size, optional name, actions, get-your-link
 *     nameOptional: false,      // true for quiz cards; otherwise the first name is required to send
 *     meter: false              // true: show the squad meter under the actions (needs membercard.js)
 *   });
 *   m.set({ template, data, size, ... }) re-renders; m.canvas() is the current card; m.state; m.destroy().
 *
 *   QUICK MODE (Home, genz-brand-04):
 *   var q = YSD.maker.mountQuick(el, { templates: ['invite', 'psa-mail', 'cover'], eventId, onCustomize(template) });
 *   A swipeable row of 3 ready-made 4:5 cards (each at least 320 px wide), one optional first-name field and one
 *   "Send it to the group chat" button; "Customize" opens the full maker in a sheet on the chosen template (or calls
 *   onCustomize). q.select(template), q.canvas(), q.render(), q.destroy(). Markup: .mq, .mq__row, .mq__card
 *   [aria-pressed], .mq__controls (maker.css). Same events and analytics as mount() (card_made { quick: true }).
 *
 *   Toasts for share and copy results are priority 'high' (YSD.ui.toast), so the "Card Maker" sticker can't wipe
 *   "Link copied" (journeys-14); the sticker announces itself after the result. "Copy link" copies only the link
 *   (journeys-22). Links come from YSD.share.url(), which adds from=<FirstName> for adults (journeys-08).
 *   Markup: el gets <div class="maker" data-maker> with __preview, __controls, __actions (maker.css).
 *   Storage: YSD.store 'maker:draft' = { template, size, city, colorway, sticker, issue, message, eventId };
 *   never the first name, never the photo. The link is YSD.share.url(...): it carries a ref only after the
 *   visitor joins ("Want credit when friends join? Get your link"). Events: 'ysd:maker-render',
 *   'ysd:maker-share' { template, result }. Analytics: card_made { template, size }.
 */
(function (w, d) {
  'use strict';
  var YSD = w.YSD = w.YSD || {};
  var MAX_BYTES = 1.2 * 1024 * 1024, uid = 0;

  function D() { return w.YSD_DATA || {}; }
  function kit() { return D().sharekit || {}; }
  function L() { return YSD.lang === 'es' ? 'es' : 'en'; }
  function pick(o) { return !o ? '' : typeof o === 'string' ? o : (o[L()] != null ? o[L()] : (o.en || '')); }
  function M(path, vars) {
    var o = kit().maker, parts = path.split('.');
    for (var i = 0; i < parts.length && o; i++) o = o[parts[i]];
    return fill(pick(o), vars);
  }
  function fill(s, vars) { return String(s == null ? '' : s).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? String(vars[k]) : m; }); }
  function store(k, v) {
    try {
      if (!YSD.store) return v === undefined ? null : v;
      if (v === undefined) return YSD.store.get(k, null);
      YSD.store.set(k, v); return v;
    } catch (e) { return null; }
  }
  function track(e, p) { try { if (YSD.track) YSD.track(e, p); } catch (x) {} }
  function emit(n, det) { try { if (YSD.emit) YSD.emit(n, det); } catch (x) {} }
  // share and copy outcomes are priority toasts, so a sticker note can never wipe "Link copied" (journeys-14)
  function toast(t, tone) { if (YSD.ui && YSD.ui.toast && t) YSD.ui.toast(t, { tone: tone, priority: 'high' }); }
  function linkCopiedText() { return (YSD.t && YSD.t('toast.linkCopied')) || M('toast.copied'); }
  function h(tag, attrs, kids) {
    var el = d.createElement(tag);
    for (var k in attrs || {}) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'text') el.textContent = v;
      else if (k === 'cls') el.className = v;
      else if (k === 'style') for (var s in v) el.style.setProperty(s, v[s]);
      else el.setAttribute(k, v === true ? '' : v);
    }
    (kids || []).forEach(function (c) { if (c) el.appendChild(typeof c === 'string' ? d.createTextNode(c) : c); });
    return el;
  }
  function byId(arr, id) { for (var i = 0; i < (arr || []).length; i++) if (arr[i] && arr[i].id === id) return arr[i]; return null; }
  var NAME_RE = /^[\p{L}\p{M}]+(?:[ '’-][\p{L}\p{M}]+)*$/u;

  // ---------------------------------------------------------------- data helpers
  function events() {
    var now = Date.now(), out = [];
    try {
      if (YSD.events && typeof YSD.events.upcoming === 'function') out = YSD.events.upcoming({ limit: 12 }) || [];
    } catch (e) { out = []; }
    if (!out.length) {
      var E = D().events;
      out = ((E && E.items) || []).filter(function (e) { return e && e.start && Date.parse(e.end || e.start) > now && e.status !== 'cancelled'; })
        .sort(function (a, b) { return Date.parse(a.start) - Date.parse(b.start); });
    }
    return out;
  }
  function groupChatText(template, vars) {
    var ids = (kit().maker && kit().maker.messageIds && kit().maker.messageIds[template]) || [];
    var gc = kit().groupChat || [], now = Date.now(), conf = (YSD.cfg && YSD.cfg('sharekit.confirmed', {})) || {};
    for (var i = 0; i < ids.length; i++) {
      var g = byId(gc, ids[i]);
      if (!g) continue;
      if (g.showFrom && now < Date.parse(g.showFrom)) continue;
      if (g.showUntil && now >= Date.parse(g.showUntil)) continue;
      var txt = pick(g.text);
      if (g.after && now >= Date.parse(g.after.date) && (!g.after.requires || conf[g.after.requires] === true)) txt = pick(g.after);
      if (g.demoPrefix && vars && vars.demoEvent) txt = pick(g.demoPrefix) + txt;
      return txt;
    }
    var own = kit().maker && kit().maker.messages && kit().maker.messages[template];
    return own ? pick(own) : '';
  }
  function stripLink(t) { return String(t || '').replace(/\s*\{(?:url|link)\}\s*$/, '').replace(/\{(?:url|link)\}/g, '').trim(); }
  /** Chip label; people 40 and up hold a Supporter card, never a "Member card" (lead, Nov 9, 2026). */
  function templateLabel(t) {
    if (t === 'membercard') { try { if (YSD.memberCard && YSD.memberCard.data().supporter) return M('templates.supportercard'); } catch (e) {} }
    return M('templates.' + t);
  }

  // ---------------------------------------------------------------- mount
  function mount(el, opts) {
    el = typeof el === 'string' ? d.querySelector(el) : el;
    var BC = YSD.brandCards;
    if (!el || !BC) return null;
    opts = opts || {};
    var id = 'mk' + (++uid);
    var templates = (opts.templates || ['invite', 'psa-mail', 'join', 'cover']).filter(function (t) { return BC.templates.indexOf(t) >= 0 && BC.available(t); });
    if (!templates.length) return null;
    var draft = store('maker:draft') || {};
    var st = {
      template: templates.indexOf(opts.template) >= 0 ? opts.template : (templates.indexOf(draft.template) >= 0 ? draft.template : templates[0]),
      size: opts.size || draft.size || 'portrait',
      city: draft.city || '', colorway: draft.colorway || '', colorwayPicked: !!draft.colorway,
      sticker: draft.sticker || '', issue: draft.issue || '', eventId: opts.eventId || draft.eventId || '',
      name: '', photo: null, slide: 1, data: opts.data || {}, message: '', messageEdited: false,
      canvas: null, blob: null, seq: 0
    };
    if (draft.message && draft.template === st.template && !opts.message) { st.message = draft.message; st.messageEdited = true; }
    var compact = !!opts.compact;

    // ------------------------------------------------ DOM
    var root = h('div', { cls: 'maker' + (compact ? ' maker--compact' : ''), 'data-maker': '', 'data-template': st.template, 'data-size': st.size });
    var frame = h('figure', { cls: 'maker__frame', 'data-size': st.size });
    var loading = h('p', { cls: 'maker__loading', text: M('labels.previewLoading') });
    frame.appendChild(loading);
    var bubble = h('p', { cls: 'bubble bubble--me maker__bubble', 'data-maker-bubble': '' });
    var chat = h('div', { cls: 'maker__chat' }, [h('p', { cls: 'maker__chat-label', text: M('labels.bubble') }), bubble]);
    var preview = h('div', { cls: 'maker__preview' }, [frame, compact ? null : chat]);
    var controls = h('div', { cls: 'maker__controls' });
    var actions = h('div', { cls: 'maker__actions' });
    var linkBox = h('div', { cls: 'maker__link', 'data-maker-link': '' });
    var side = h('div', { cls: 'maker__side' }, [controls, actions, linkBox]);
    root.appendChild(preview); root.appendChild(side);

    // template chips
    var chips = null;
    if (templates.length > 1) {
      chips = h('div', { cls: 'chip-row maker__templates', role: 'group', 'aria-label': M('labels.template') });
      templates.forEach(function (t) {
        var b = h('button', { cls: 'chip', type: 'button', 'aria-pressed': String(t === st.template), 'data-maker-template': t, text: templateLabel(t) });
        chips.appendChild(b);
      });
      controls.appendChild(chips);
    }
    // first name
    var nameId = id + '-name', nameErr = id + '-name-err', nameHint = id + '-name-hint';
    var nameIn = h('input', { id: nameId, name: 'firstName', type: 'text', autocomplete: 'given-name', maxlength: '20', 'aria-describedby': nameHint + ' ' + nameErr, spellcheck: 'false' });
    var nameField = h('div', { cls: 'field maker__field', 'data-field': 'name' }, [
      h('label', { cls: 'field__label', 'for': nameId, 'data-maker-name-label': '' }),
      h('p', { cls: 'field__hint', id: nameHint, text: M('labels.firstNameHint') }),
      nameIn,
      h('p', { cls: 'field__error', id: nameErr, 'aria-live': 'polite' })
    ]);
    controls.appendChild(nameField);
    // event (invite)
    var evSel = h('select', { id: id + '-event', name: 'event' });
    var evList = events();
    evList.forEach(function (e) {
      var t = pick(e.title), when = '';
      try { when = YSD.fmt && YSD.fmt.date ? YSD.fmt.date(e.start, { time: false }) : ''; } catch (x) {}
      evSel.appendChild(h('option', { value: e.id, text: (when ? when + ' · ' : '') + t + (e.demo !== false ? ' (DEMO)' : '') }));
    });
    if (!st.eventId && evList[0]) st.eventId = evList[0].id;
    if (st.eventId) evSel.value = st.eventId;
    var evField = h('div', { cls: 'field maker__field', 'data-field': 'event' }, [h('label', { cls: 'field__label', 'for': id + '-event', text: M('labels.event') }), evSel]);
    controls.appendChild(evField);
    // city + issue (selects side by side)
    var citySel = h('select', { id: id + '-city', name: 'city' }, [h('option', { value: '', text: '—' })]);
    BC.cities().forEach(function (c) { citySel.appendChild(h('option', { value: c.id, text: pick(c.name) })); });
    citySel.value = st.city;
    var cityField = h('div', { cls: 'field maker__field', 'data-field': 'city' }, [h('label', { cls: 'field__label', 'for': id + '-city', text: M('labels.city') }), citySel]);
    var issueSel = h('select', { id: id + '-issue', name: 'issue' }, [h('option', { value: '', text: '—' })]);
    BC.issues().forEach(function (it) { issueSel.appendChild(h('option', { value: it.id, text: pick(it.short) })); });
    issueSel.value = st.issue;
    var issueField = h('div', { cls: 'field maker__field', 'data-field': 'issue' }, [h('label', { cls: 'field__label', 'for': id + '-issue', text: M('labels.issue') }), issueSel]);
    controls.appendChild(h('div', { cls: 'maker__pair' }, [cityField, issueField]));
    // colourway swatches
    var swRow = h('div', { cls: 'maker__swatches' });
    BC.colorways().forEach(function (c) {
      var inp = h('input', { type: 'radio', name: id + '-colorway', value: c.id });
      if (c.id === st.colorway) inp.checked = true;
      swRow.appendChild(h('label', { cls: 'swatch', style: { '--swatch': c.bg } }, [inp, h('span', { cls: 'u-visually-hidden', text: pick(c.name) })]));
    });
    var swField = h('fieldset', { cls: 'maker__fieldset', 'data-field': 'colorway' }, [h('legend', { cls: 'field__label', text: M('labels.colorway') }), swRow]);
    // sticker picker
    var stRow = h('div', { cls: 'maker__stickers' });
    BC.stickers().forEach(function (sid) {
      var it = YSD.ui && YSD.ui.sticker ? YSD.ui.sticker(sid) : null;
      var inp = h('input', { type: 'radio', name: id + '-sticker', value: sid });
      if (sid === st.sticker) inp.checked = true;
      var art = h('span', { cls: 'maker__sticker-art', 'aria-hidden': 'true' });
      if (it && it.svg) art.innerHTML = it.svg; // trusted: our own data file
      stRow.appendChild(h('label', { cls: 'maker__sticker' }, [inp, art, h('span', { cls: 'u-visually-hidden', text: it ? pick(it.name) : sid })]));
    });
    var stField = h('fieldset', { cls: 'maker__fieldset', 'data-field': 'sticker' }, [h('legend', { cls: 'field__label', text: M('labels.sticker') }), stRow]);
    controls.appendChild(h('div', { cls: 'maker__pair maker__pair--looks' }, [swField, stField]));
    // photo (cover)
    var photoId = id + '-photo';
    // The native file control prints the browser's own "Choose File" (English on a Spanish page in many
    // browsers); keep it focusable but hidden, and show a brand button label for it.
    var photoIn = h('input', { id: photoId, type: 'file', accept: 'image/*', cls: 'maker__file', 'aria-describedby': id + '-photo-hint' });
    var photoPick = h('label', { 'for': photoId, cls: 'btn btn--ghost btn--sm maker__file-btn', text: M('labels.photoPick') || M('labels.photo') });
    var photoRm = h('button', { type: 'button', cls: 'btn btn--quiet btn--sm', hidden: true, 'data-maker-photo-remove': '', text: M('labels.photoRemove') });
    var photoField = h('div', { cls: 'field maker__field', 'data-field': 'photo' }, [
      h('label', { cls: 'field__label', 'for': photoId, text: M('labels.photo') }),
      h('p', { cls: 'field__hint', id: id + '-photo-hint', text: M('labels.photoHint') }),
      h('div', { cls: 'cluster cluster--sm' }, [photoIn, photoPick, photoRm])
    ]);
    controls.appendChild(photoField);
    // slide (rewind)
    var slideSeg = h('fieldset', { cls: 'seg', 'data-field': 'slide' }, [h('legend', { cls: 'u-visually-hidden', text: M('labels.slide') })]);
    [1, 2, 3, 'summary'].forEach(function (s) {
      var inp = h('input', { type: 'radio', name: id + '-slide', value: String(s) });
      if (s === st.slide) inp.checked = true;
      slideSeg.appendChild(h('label', { cls: 'seg__opt' }, [inp, h('span', { text: s === 'summary' ? '4:5' : String(s) })]));
    });
    controls.appendChild(slideSeg);
    // size
    var sizeSeg = h('fieldset', { cls: 'seg maker__size', 'data-field': 'size' }, [h('legend', { cls: 'u-visually-hidden', text: M('labels.size') })]);
    [['portrait', M('labels.sizePortrait')], ['story', M('labels.sizeStory')]].forEach(function (p) {
      var inp = h('input', { type: 'radio', name: id + '-size', value: p[0] });
      if (p[0] === st.size) inp.checked = true;
      sizeSeg.appendChild(h('label', { cls: 'seg__opt' }, [inp, h('span', { text: p[1] })]));
    });
    controls.appendChild(sizeSeg);
    // message
    var msgId = id + '-msg';
    var msgIn = h('textarea', { id: msgId, name: 'message', rows: '3', 'aria-describedby': id + '-msg-hint' });
    var msgField = h('div', { cls: 'field maker__field', 'data-field': 'message' }, [
      h('label', { cls: 'field__label', 'for': msgId, text: M('labels.message') }),
      h('p', { cls: 'field__hint', id: id + '-msg-hint', text: M('labels.messageHint') }),
      msgIn
    ]);
    controls.appendChild(msgField);

    // actions
    var bShare = h('button', { type: 'button', cls: 'btn btn--primary btn--lg maker__share', 'data-maker-action': 'share', text: M('actions.share') });
    var bSave = h('button', { type: 'button', cls: 'btn btn--ghost', 'data-maker-action': 'save', text: M('actions.save') });
    var aSms = h('a', { cls: 'btn btn--quiet btn--sm', href: 'sms:', 'data-maker-action': 'sms', text: M('actions.sms') });
    var aWa = h('a', { cls: 'btn btn--quiet btn--sm', href: '#', target: '_blank', rel: 'noopener', 'data-maker-action': 'whatsapp', text: M('actions.whatsapp') });
    var bCopy = h('button', { type: 'button', cls: 'btn btn--quiet btn--sm', 'data-maker-action': 'copy', text: M('actions.copy') });
    actions.appendChild(h('div', { cls: 'btn-row' }, [bShare, bSave]));
    actions.appendChild(h('div', { cls: 'btn-row maker__more' }, [aSms, aWa, bCopy]));
    if (YSD.cfg && YSD.cfg('demo', true) !== false) actions.appendChild(h('p', { cls: 'maker__demo' }, [h('span', { cls: 'tag tag--demo', text: 'DEMO' }), ' ', h('span', { text: stripDemo(M('labels.demoNote')) })]));
    var meterEl = null;
    if (opts.meter && YSD.squadMeter) { meterEl = h('div', { cls: 'maker__meter' }); actions.appendChild(meterEl); YSD.squadMeter.mount(meterEl); }
    function stripDemo(t) { t = String(t).replace(/^DEMO:\s*/, ''); return t.charAt(0).toUpperCase() + t.slice(1); }

    el.textContent = '';
    el.appendChild(root);

    // ------------------------------------------------ state -> UI
    function needsName() { return !(opts.nameOptional || /^quiz-/.test(st.template) || st.template === 'rewind'); }
    function show(field, on) { var f = root.querySelector('[data-field="' + field + '"]'); if (f) f.hidden = !on; }
    function sync() {
      var t = st.template;
      root.setAttribute('data-template', t); root.setAttribute('data-size', st.size);
      frame.setAttribute('data-size', st.size);
      if (chips) Array.prototype.forEach.call(chips.children, function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-maker-template') === t)); });
      var lab = root.querySelector('[data-maker-name-label]');
      lab.textContent = needsName() ? M('labels.firstName') : M('labels.firstNameOptional');
      if (needsName()) nameIn.setAttribute('aria-required', 'true'); else nameIn.removeAttribute('aria-required');
      var full = !compact;
      show('name', t !== 'rewind');
      show('event', full && t === 'invite' && evList.length > 0);
      show('city', full && (t === 'cover' || t === 'join' || t === 'membercard'));
      show('issue', full && t === 'cover');
      show('colorway', full && (t === 'cover' || t === 'join' || t === 'invite' || t === 'membercard'));
      show('sticker', full && !/^psa-/.test(t) && t !== 'rewind' && t !== 'membercard' && !(t === 'quiz-issue' && serious()));
      show('photo', full && t === 'cover');
      show('slide', t === 'rewind');
      show('size', t !== 'rewind');
      show('message', full);
      var pair = root.querySelectorAll('.maker__pair');
      Array.prototype.forEach.call(pair, function (p) { p.hidden = Array.prototype.every.call(p.children, function (c) { return c.hidden; }); });
      if (!st.messageEdited) st.message = defaultMessage();
      if (d.activeElement !== msgIn) msgIn.value = st.message;
    }
    function serious() { var it = byId(BC.issues(), st.data && st.data.resultId); return !!(it && it.tone === 'serious'); }
    function quizName() {
      var Q = D().quiz || {};
      if (st.template === 'quiz-show-up') { var r = byId((Q.organizerEra || {}).results, st.data.resultId); return r ? pick(r.name) : ''; }
      if (st.template === 'quiz-issue') { var it = byId(BC.issues(), st.data.resultId); return it ? pick(it.short) : ''; }
      return '';
    }
    function defaultMessage() {
      if (opts.message) return stripLink(opts.message);
      var t = st.template, vars = {};
      if (t === 'invite') {
        var ev = BC.event(st.eventId);
        if (ev) {
          vars.event = pick(ev.title);
          try { vars.when = YSD.fmt.date(ev.start, { time: true }); } catch (e) { vars.when = ''; }
          vars.city = BC.cities().length && byId(BC.cities(), ev.city) ? pick(byId(BC.cities(), ev.city).name) : ev.city;
          vars.demoEvent = ev.demo !== false;
        }
      }
      if (/^quiz-/.test(t)) vars.result = vars.match = quizName();
      return stripLink(fill(groupChatText(t, vars), vars));
    }
    function data() {
      var o = { lang: L(), name: validName() ? st.name : '', colorway: st.colorway || '', sticker: st.sticker || '', city: st.city || '', issue: st.issue || '', eventId: st.eventId, photo: st.photo, slide: st.slide };
      for (var k in st.data) o[k] = st.data[k];
      if (st.template === 'membercard' && YSD.memberCard) { var mc = YSD.memberCard.data(); for (var j in mc) if (o[j] == null || o[j] === '') o[j] = mc[j]; }
      if (st.template === 'rewind' && YSD.rewind) { var rc = YSD.rewind.data(); o.counts = rc.counts; o.stickers = rc.stickers; }
      o.url = url(o);
      return o;
    }
    function url(o) {
      var p = BC.path(st.template, o || st.data);
      try { return YSD.share && YSD.share.url ? YSD.share.url(p) : p; } catch (e) { return p; }
    }
    function validName() { return !!st.name && NAME_RE.test(st.name) && st.name.length <= 20; }
    function sizeFor() { return st.template === 'rewind' ? (st.slide === 'summary' ? 'portrait' : 'story') : st.size; }
    function summary(o) {
      var bits = [M('templates.' + st.template)];
      if (o.name) bits.push(o.name);
      if (/^quiz-/.test(st.template)) bits.push(quizName());
      if (o.city) { var c = byId(BC.cities(), o.city); if (c) bits.push(pick(c.name)); }
      if (st.template === 'cover' && o.issue) { var it = byId(BC.issues(), o.issue); if (it) bits.push(pick(it.short)); }
      if (st.template === 'invite') { var ev = BC.event(st.eventId); if (ev) bits.push(pick(ev.title)); }
      return bits.filter(Boolean).join(', ');
    }

    // ------------------------------------------------ render
    var timer = 0;
    function schedule(now) { clearTimeout(timer); timer = setTimeout(render, now ? 0 : 140); }
    function render() {
      sync();
      var seq = ++st.seq, o = data(), size = sizeFor();
      root.setAttribute('data-state', 'loading');
      return BC.render(st.template, o, { size: size }).then(function (cv) {
        if (seq !== st.seq) return;
        cv.className = 'maker__canvas';
        cv.setAttribute('role', 'img');
        cv.setAttribute('aria-label', M('labels.preview', { summary: summary(o) }));
        frame.textContent = '';
        frame.appendChild(cv);
        frame.setAttribute('data-size', size);
        st.canvas = cv; st.blob = null; st.url = o.url;
        root.setAttribute('data-state', 'idle');
        updateLinks(o.url);
        YSD.cards.toBlob(cv).then(function (b) { if (seq === st.seq) { st.blob = b; if (b.size > MAX_BYTES && YSD.log) YSD.log('maker: PNG over 1.2 MB', b.size); } }, function () {});
        emit('maker-render', { template: st.template, size: size });
      }, function (err) {
        if (seq !== st.seq) return;
        root.setAttribute('data-state', 'error');
        if (YSD.log) YSD.log('maker: render failed', err);
      });
    }
    function pretty(u) { return YSD.ui && YSD.ui.prettyLink ? YSD.ui.prettyLink(u) : u; }
    function updateLinks(u) {
      bubble.textContent = '';
      bubble.appendChild(d.createTextNode(st.message ? st.message + ' ' : ''));
      bubble.appendChild(h('span', { cls: 'maker__bubble-link', text: pretty(u) }));
      var links = YSD.share && YSD.share.links ? YSD.share.links(st.message, u) : null;
      if (links) { aSms.href = links.sms; aWa.href = links.whatsapp; }
      paintLinkBox();
    }
    function saveDraft() {
      store('maker:draft', { template: st.template, size: st.size, city: st.city, colorway: st.colorwayPicked ? st.colorway : '', sticker: st.sticker, issue: st.issue, message: st.messageEdited ? st.message : '', eventId: st.eventId });
    }

    // ------------------------------------------------ name validation
    function nameError(code) {
      var err = d.getElementById(nameErr);
      if (code) { nameIn.setAttribute('aria-invalid', 'true'); err.textContent = M(code === 'chars' ? 'errors.firstNameChars' : 'errors.firstName'); }
      else { nameIn.removeAttribute('aria-invalid'); err.textContent = ''; }
    }
    function check() {
      var v = st.name;
      if (!v) { if (needsName()) { nameError('required'); nameIn.focus(); return false; } nameError(null); return true; }
      if (!validName()) { nameError('chars'); nameIn.focus(); return false; }
      nameError(null); return true;
    }

    // ------------------------------------------------ actions
    // the Card Maker sticker lands after the share result has been seen (journeys-14, genz-brand-10)
    function sticker() { try { if (YSD.stickers && YSD.stickers.act) YSD.stickers.act('share-card', { ref: st.template, delay: 1200 }); } catch (e) {} }
    function made(result) {
      track('card_made', { template: st.template, size: sizeFor() });
      emit('maker-share', { template: st.template, result: result });
    }
    function filename() { return 'young-dems-' + st.template + '.png'; }
    function share() {
      if (!check() || !st.canvas) return;
      var title = M('templates.' + st.template), file = null, can = false;
      try { file = st.blob && typeof w.File === 'function' ? new w.File([st.blob], filename(), { type: 'image/png' }) : null; } catch (e) { file = null; }
      try { can = !!(file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })); } catch (e) { can = false; }
      if (can) {
        YSD.cards.share(st.canvas, { title: title, text: st.message, url: st.url, filename: filename() }).then(function (res) {
          if (res === 'shared') { toast(M('toast.ready')); if (YSD.ui.confetti && !/^psa-/.test(st.template)) YSD.ui.confetti(bShare); }
          else if (res === 'downloaded') toast(M('toast.saved'));
          else if (res === 'failed') toast(M('toast.failed'), 'error');
          made(res);
        });
        return;
      }
      // No file sharing here: send the text + link, which falls back to copying it.
      var p = YSD.share && YSD.share.native ? YSD.share.native({ title: title, text: st.message, url: st.url }) : Promise.resolve('failed');
      p.then(function (res) {
        if (res === 'shared') { toast(M('toast.ready')); sticker(); }
        else if (res === 'copied') { toast(YSD.t && YSD.t('toast.textCopied') || M('toast.copied')); sticker(); }
        else if (res === 'failed') toast(M('toast.failed'), 'error');
        made(res);
      });
    }
    function save() {
      if (!check() || !st.canvas) return;
      YSD.cards.download(st.canvas, filename()).then(function (res) {
        if (res === 'downloaded') { toast(M('toast.saved')); sticker(); try { if (YSD.counters) YSD.counters.bump('cards'); } catch (e) {} }
        else toast(M('toast.failed'), 'error');
        made(res);
      });
    }
    // "Copy link" copies only the link (journeys-22); "Send it to the group chat" sends the message with it
    function copy() {
      var p = YSD.share && YSD.share.copy ? YSD.share.copy(st.url || '') : Promise.resolve(false);
      p.then(function (ok) { toast(ok ? linkCopiedText() : M('toast.failed'), ok ? null : 'error'); });
    }

    // ------------------------------------------------ get your link (a ref is minted only by joining)
    var linkState = '';
    function paintLinkBox() {
      var isMember = false;
      try { isMember = !!(YSD.members && YSD.members.isMember()); } catch (e) {}
      // Re-renders (name, size, colour...) must not wipe a half-filled join form: rebuild only on a state change.
      if (linkState === (isMember ? 'member' : 'ask')) return;
      linkState = isMember ? 'member' : 'ask';
      linkBox.textContent = '';
      if (isMember) {
        linkBox.setAttribute('data-state', 'done');
        linkBox.appendChild(h('p', { cls: 'maker__link-done', text: M('getLink.done') }));
        return;
      }
      if (!YSD.members || typeof YSD.members.join !== 'function') { linkBox.hidden = true; return; }
      linkBox.removeAttribute('data-state');
      var open = h('button', { type: 'button', cls: 'btn btn--ink btn--sm', 'aria-expanded': 'false', 'aria-controls': id + '-join', text: M('getLink.open') });
      var box = h('div', { id: id + '-join', cls: 'maker__join', hidden: true });
      linkBox.appendChild(h('div', { cls: 'maker__link-ask' }, [
        h('div', {}, [h('p', { cls: 'maker__link-title', text: M('getLink.title') }), h('p', { cls: 'maker__link-body', text: M('getLink.body') })]),
        open
      ]));
      linkBox.appendChild(box);
      open.addEventListener('click', function () {
        var on = open.getAttribute('aria-expanded') !== 'true';
        open.setAttribute('aria-expanded', String(on));
        box.hidden = !on;
        if (on && !box.firstChild) buildJoin(box);
        if (on) { var f = box.querySelector('input:not([type=hidden]):not([tabindex="-1"])'); if (f) f.focus(); }
      });
    }
    function buildJoin(box) {
      if (YSD.joinForm && typeof YSD.joinForm.mount === 'function') {
        var f0 = h('form', { cls: 'form', novalidate: true });
        box.appendChild(f0);
        YSD.joinForm.mount(f0, { compact: true, onJoined: function () { schedule(true); } });
        return;
      }
      var fid = id + '-j';
      var form = h('form', { cls: 'form maker__joinform', novalidate: true, name: 'maker-join' });
      function field(name, label, type, auto, hint, req) {
        var i = h('input', { id: fid + name, name: name, type: type, autocomplete: auto, 'aria-required': req ? 'true' : null, 'aria-describedby': (hint ? fid + name + '-h ' : '') + fid + name + '-e' });
        if (name === 'firstName' && st.name) i.value = st.name;
        return h('div', { cls: 'field' }, [
          h('label', { cls: 'field__label', 'for': fid + name, text: label }),
          hint ? h('p', { cls: 'field__hint', id: fid + name + '-h', text: hint }) : null,
          i,
          h('p', { cls: 'field__error', id: fid + name + '-e' })
        ]);
      }
      form.appendChild(field('firstName', M('labels.firstName'), 'text', 'given-name', '', true));
      form.appendChild(field('contact', M('getLink.contact'), 'text', 'email', M('getLink.contactHint'), true));
      // A neutral age screen (docs/legal/MINORS_POLICY.md, FTC COPPA FAQ H.3): a free-entry number, never a
      // list of allowed ages. Under 14 stores nothing; under 18 gets a random-style code from members.js.
      var ageField = field('age', M('getLink.age'), 'text', 'off', M('getLink.teenNote'), true);
      var ageIn = ageField.querySelector('input');
      ageIn.setAttribute('inputmode', 'numeric'); ageIn.setAttribute('maxlength', '3'); ageIn.setAttribute('pattern', '[0-9]*');
      form.appendChild(ageField);
      form.appendChild(h('input', { type: 'text', name: '_hp', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true', cls: 'u-visually-hidden' }));
      form.appendChild(h('p', { cls: 'field__hint maker__privacy', text: M('getLink.privacy') }));
      form.appendChild(h('div', { cls: 'btn-row' }, [h('button', { type: 'submit', cls: 'btn btn--violet', text: M('getLink.submit') })]));
      box.appendChild(form);
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var els = form.elements;
        var first = String(els.firstName.value || '').trim(), contact = String(els.contact.value || '').trim();
        var ageRaw = String(els.age.value || '').trim();
        var profile = { firstName: first, _hp: els._hp.value };
        if (contact.indexOf('@') >= 0) profile.email = contact; else profile.phone = contact;
        if (/^\d{1,3}$/.test(ageRaw)) profile.age = parseInt(ageRaw, 10);
        var v = YSD.members.validate(profile), errs = {};
        if (v.errors.age === 'too_young') {
          // Too young to join: say so kindly, clear what was typed and store nothing.
          box.textContent = '';
          var young = h('p', { cls: 'notice notice--info', tabindex: '-1', text: (YSD.t ? YSD.t('error.age.too_young', { minAge: YSD.cfg ? YSD.cfg('org.minAge', 14) : 14 }) : '') });
          box.appendChild(young);
          var opener = linkBox.querySelector('[aria-expanded]'); if (opener) { opener.setAttribute('aria-expanded', 'true'); opener.disabled = true; }
          young.focus();
          return;
        }
        if (v.errors.firstName) errs.firstName = M('errors.firstName');
        if (v.errors.email || v.errors.phone || !contact) errs.contact = M('getLink.contactError');
        if (profile.age == null) errs.age = M('getLink.ageError');
        ['firstName', 'contact', 'age'].forEach(function (k) {
          var err = d.getElementById(fid + k + '-e'), input = els[k];
          if (err) err.textContent = errs[k] || '';
          if (input) { if (errs[k]) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); }
        });
        var firstBad = errs.firstName ? els.firstName : errs.contact ? els.contact : errs.age ? els.age : null;
        if (firstBad) { firstBad.focus(); return; }
        try { YSD.members.join(profile); } catch (x) { toast(M('toast.failed'), 'error'); return; }
        if (!st.name && first && NAME_RE.test(first) && first.length <= 20) { st.name = first; nameIn.value = first; }
        toast(M('getLink.done'));
        schedule(true);
      });
    }

    // ------------------------------------------------ events
    root.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-maker-template],[data-maker-action],[data-maker-photo-remove]') : null;
      if (!t) return;
      if (t.hasAttribute('data-maker-template')) { st.template = t.getAttribute('data-maker-template'); st.messageEdited = false; saveDraft(); schedule(true); return; }
      if (t.hasAttribute('data-maker-photo-remove')) { st.photo = null; photoIn.value = ''; photoRm.hidden = true; schedule(true); return; }
      var a = t.getAttribute('data-maker-action');
      if (a === 'share') share();
      else if (a === 'save') save();
      else if (a === 'copy') copy();
      else if (a === 'sms' || a === 'whatsapp') { if (!check()) { e.preventDefault(); return; } made(a); }
    });
    root.addEventListener('input', function (e) {
      var t = e.target;
      if (t === nameIn) { st.name = String(nameIn.value || '').trim(); if (nameIn.getAttribute('aria-invalid') && (validName() || (!st.name && !needsName()))) nameError(null); schedule(); return; }
      if (t === msgIn) { st.message = String(msgIn.value || ''); st.messageEdited = true; updateLinks(st.url); saveDraft(); return; }
    });
    root.addEventListener('change', function (e) {
      var t = e.target, n = t.name || '';
      if (t === citySel) {
        st.city = citySel.value;
        if (!st.colorwayPicked) { var c = byId(BC.cities(), st.city); st.colorway = c ? c.colorway : ''; var r = root.querySelector('input[name="' + id + '-colorway"][value="' + st.colorway + '"]'); if (r) r.checked = true; }
      } else if (t === issueSel) st.issue = issueSel.value;
      else if (t === evSel) { st.eventId = evSel.value; if (!st.messageEdited) st.message = ''; }
      else if (n === id + '-colorway') { st.colorway = t.value; st.colorwayPicked = true; }
      else if (n === id + '-sticker') st.sticker = t.value;
      else if (n === id + '-size') st.size = t.value;
      else if (n === id + '-slide') st.slide = t.value === 'summary' ? 'summary' : +t.value;
      else if (t === photoIn) { readPhoto(); return; }
      else return;
      saveDraft();
      schedule(true);
    });
    function readPhoto() {
      var f = photoIn.files && photoIn.files[0];
      if (!f) return;
      var URLo = w.URL || w.webkitURL, src = URLo.createObjectURL(f), img = new Image();
      img.onload = function () { st.photo = img; photoRm.hidden = false; toast(M('toast.photo')); schedule(true); setTimeout(function () { URLo.revokeObjectURL(src); }, 4000); };
      img.onerror = function () { URLo.revokeObjectURL(src); photoIn.value = ''; toast(M('toast.photoBad'), 'error'); };
      img.src = src;
    }
    var offJoin = function () { schedule(true); };
    d.addEventListener('ysd:joined', offJoin);

    sync();
    render();
    return {
      el: root, state: st,
      render: function () { return render(); },
      canvas: function () { return st.canvas; },
      set: function (patch) {
        patch = patch || {};
        if (patch.template && templates.indexOf(patch.template) >= 0) { st.template = patch.template; st.messageEdited = false; }
        if (patch.data) st.data = patch.data;
        if (patch.size) st.size = patch.size;
        if (patch.message != null) { opts.message = patch.message; st.messageEdited = false; }
        if (patch.eventId) { st.eventId = patch.eventId; evSel.value = patch.eventId; }
        return render();
      },
      destroy: function () { d.removeEventListener('ysd:joined', offJoin); clearTimeout(timer); el.textContent = ''; }
    };
  }

  // ---------------------------------------------------------------- quick mode (Home; genz-brand-04 contract)
  /**
   * YSD.maker.mountQuick(el, { templates: ['invite', 'psa-mail', 'cover'], eventId?, size?: 'portrait',
   *                            onCustomize?(template) })  -> { el, state, select(template), canvas(), destroy() }
   * A swipeable row of ready-made cards (4:5, each at least 320 px wide), one first-name field (optional) and one
   * Send button. Tapping a card (or swiping it to the middle) selects it; Send shares that card's image when the
   * browser can, else its message and link (copy fallback, "Message copied" as a priority toast). "Customize"
   * calls onCustomize(template), or opens the full maker in a sheet on that template. Templates that are out of
   * their window drop out (psa-mail ends Jan 1, 2027) and 'join' fills the gap. Needs what mount() needs.
   */
  function mountQuick(el, opts) {
    el = typeof el === 'string' ? d.querySelector(el) : el;
    var BC = YSD.brandCards;
    if (!el || !BC) return null;
    opts = opts || {};
    var id = 'mq' + (++uid);
    var want = (opts.templates || ['invite', 'psa-mail', 'cover']).slice(0, 3);
    var list = want.filter(function (t) { return BC.templates.indexOf(t) >= 0 && BC.available(t); });
    ['join', 'cover', 'invite'].forEach(function (t) { if (list.length < want.length && list.indexOf(t) < 0 && BC.available(t)) list.push(t); });
    if (!list.length) return null;
    var evs = events(), eventId = opts.eventId || (evs[0] && evs[0].id) || '';
    var st = { template: list[0], name: '', canvases: {}, blobs: {}, urls: {}, seq: 0 };
    var root = h('div', { cls: 'mq', 'data-maker-quick': '' });
    var row = h('div', { cls: 'mq__row', role: 'group', 'aria-label': M('labels.quickPick') });
    var cards = {};
    list.forEach(function (t) {
      var b = h('button', { type: 'button', cls: 'mq__card', 'data-mq': t, 'aria-pressed': String(t === st.template) }, [
        h('span', { cls: 'mq__frame', 'data-state': 'loading' }, [h('span', { cls: 'maker__loading', text: M('labels.previewLoading') })]),
        h('span', { cls: 'mq__label', text: templateLabel(t) })
      ]);
      cards[t] = b; row.appendChild(b);
    });
    var nameId = id + '-name', errId = id + '-err', hintId = id + '-hint';
    var nameIn = h('input', { id: nameId, type: 'text', name: 'firstName', autocomplete: 'given-name', maxlength: '20', spellcheck: 'false', 'aria-describedby': hintId + ' ' + errId });
    var send = h('button', { type: 'button', cls: 'btn btn--primary btn--lg mq__send', 'data-mq-send': '', text: M('actions.share') });
    var custom = h('button', { type: 'button', cls: 'btn btn--ghost mq__custom', 'data-mq-customize': '', text: M('actions.customize') });
    var controls = h('div', { cls: 'mq__controls' }, [
      h('div', { cls: 'field mq__field' }, [
        h('label', { cls: 'field__label', 'for': nameId, text: M('labels.quickName') }),
        h('p', { cls: 'field__hint', id: hintId, text: M('labels.quickHint') }),
        nameIn,
        h('p', { cls: 'field__error', id: errId, 'aria-live': 'polite' })
      ]),
      h('div', { cls: 'btn-row mq__actions' }, [send, custom])
    ]);
    root.appendChild(h('p', { cls: 'mq__swipe', text: M('labels.quickSwipe') }));
    root.appendChild(row);
    root.appendChild(controls);
    if (YSD.cfg && YSD.cfg('demo', true) !== false) root.appendChild(h('p', { cls: 'maker__demo' }, [h('span', { cls: 'tag tag--demo', text: 'DEMO' }), ' ', h('span', { text: String(M('labels.demoNote')).replace(/^DEMO:\s*/, '').replace(/^./, function (c) { return c.toUpperCase(); }) })]));
    el.textContent = '';
    el.appendChild(root);

    function validName() { return !!st.name && NAME_RE.test(st.name) && st.name.length <= 20; }
    function dataFor(t) {
      var o = { lang: L(), name: validName() ? st.name : '', eventId: t === 'invite' ? eventId : '' };
      o.url = (function () { var p = BC.path(t, o); try { return YSD.share && YSD.share.url ? YSD.share.url(p) : p; } catch (e) { return p; } })();
      return o;
    }
    function messageFor(t) {
      var vars = {};
      if (t === 'invite') {
        var ev = BC.event(eventId);
        if (ev) {
          vars.event = pick(ev.title);
          try { vars.when = YSD.fmt.date(ev.start, { time: true }); } catch (e) { vars.when = ''; }
          var c = byId(BC.cities(), ev.city); vars.city = c ? pick(c.name) : ev.city;
          vars.demoEvent = ev.demo !== false;
        }
      }
      return stripLink(fill(groupChatText(t, vars), vars));
    }
    function summary(t, o) {
      var bits = [templateLabel(t)];
      if (o.name) bits.push(o.name);
      if (t === 'invite') { var ev = BC.event(eventId); if (ev) bits.push(pick(ev.title)); }
      return bits.join(', ');
    }
    function renderAll() {
      var seq = ++st.seq;
      return Promise.all(list.map(function (t) {
        var o = dataFor(t);
        return BC.render(t, o, { size: opts.size || 'portrait' }).then(function (cv) {
          if (seq !== st.seq) return;
          cv.className = 'mq__canvas';
          cv.setAttribute('aria-hidden', 'true');
          var fr = cards[t].querySelector('.mq__frame');
          fr.textContent = ''; fr.appendChild(cv); fr.setAttribute('data-state', 'idle');
          cards[t].setAttribute('aria-label', M('labels.preview', { summary: summary(t, o) }));
          st.canvases[t] = cv; st.urls[t] = o.url; st.blobs[t] = null;
          YSD.cards.toBlob(cv).then(function (b) { if (seq === st.seq) st.blobs[t] = b; }, function () {});
        }, function (err) { if (YSD.log) YSD.log('maker quick: render failed', t, err); });
      })).then(function () { emit('maker-render', { template: 'quick', size: opts.size || 'portrait' }); });
    }
    function select(t, scroll) {
      if (list.indexOf(t) < 0) return;
      st.template = t;
      list.forEach(function (x) { cards[x].setAttribute('aria-pressed', String(x === t)); });
      if (scroll) { try { cards[t].scrollIntoView({ block: 'nearest', inline: 'center', behavior: reduced() ? 'auto' : 'smooth' }); } catch (e) {} }
    }
    function reduced() { try { return YSD.ui && YSD.ui.motion ? YSD.ui.motion.paused() : w.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
    function sticker() { try { if (YSD.stickers && YSD.stickers.act) YSD.stickers.act('share-card', { ref: st.template, delay: 1200 }); } catch (e) {} }
    function doSend() {
      if (st.name && !validName()) { nameErr(true); nameIn.focus(); return; }
      var t = st.template, cv = st.canvases[t], blob = st.blobs[t], url = st.urls[t], msg = messageFor(t), title = templateLabel(t);
      if (!cv) return;
      var file = null, can = false, fname = 'young-dems-' + t + '.png';
      try { file = blob && typeof w.File === 'function' ? new w.File([blob], fname, { type: 'image/png' }) : null; } catch (e) { file = null; }
      try { can = !!(file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })); } catch (e) { can = false; }
      var done = function (res) {
        if (res === 'shared') { toast(M('toast.ready')); sticker(); if (YSD.ui && YSD.ui.confetti && !/^psa-/.test(t)) YSD.ui.confetti(send); }
        else if (res === 'downloaded') { toast(M('toast.saved')); sticker(); }
        else if (res === 'copied') { toast(YSD.t && YSD.t('toast.textCopied') || M('toast.copied')); sticker(); }
        else if (res === 'failed') toast(M('toast.failed'), 'error');
        track('card_made', { template: t, size: opts.size || 'portrait', quick: true });
        emit('maker-share', { template: t, result: res, quick: true });
      };
      if (can) { YSD.cards.share(cv, { title: title, text: msg, url: url, filename: fname }).then(done); return; }
      (YSD.share && YSD.share.native ? YSD.share.native({ title: title, text: msg, url: url }) : Promise.resolve('failed')).then(done);
    }
    function nameErr(on) {
      var err = d.getElementById(errId);
      if (on) { nameIn.setAttribute('aria-invalid', 'true'); err.textContent = M('errors.firstNameChars'); }
      else { nameIn.removeAttribute('aria-invalid'); err.textContent = ''; }
    }
    var sheetMaker = null;
    function customize() {
      var t = st.template;
      if (typeof opts.onCustomize === 'function') { opts.onCustomize(t); return; }
      var dlg = d.getElementById(id + '-sheet');
      if (!dlg) {
        dlg = h('dialog', { id: id + '-sheet', cls: 'sheet mq__sheet', 'aria-labelledby': id + '-sheet-title' });
        var body = h('div', { cls: 'sheet__body' });
        dlg.appendChild(h('div', { cls: 'sheet__head' }, [
          h('h2', { cls: 'sheet__title', id: id + '-sheet-title', text: M('labels.customizeTitle') }),
          h('button', { type: 'button', cls: 'btn btn--icon btn--quiet sheet__close', 'data-sheet-close': '', 'aria-label': (YSD.t && YSD.t('a11y.close')) || 'Close', text: '×' })
        ]));
        dlg.appendChild(body);
        d.body.appendChild(dlg);
        sheetMaker = mount(body, { templates: list.concat(list.indexOf('join') < 0 ? ['join'] : []), template: t, eventId: eventId });
      } else if (sheetMaker) sheetMaker.set({ template: t });
      if (sheetMaker && st.name && validName()) { var ni = dlg.querySelector('input[name="firstName"]'); if (ni && !ni.value) { ni.value = st.name; ni.dispatchEvent(new Event('input', { bubbles: true })); } }
      if (YSD.ui && YSD.ui.sheet) YSD.ui.sheet.open(dlg, { opener: custom }); else if (dlg.showModal) dlg.showModal();
    }
    var timer = 0;
    root.addEventListener('click', function (e) {
      var c = e.target.closest ? e.target.closest('[data-mq],[data-mq-send],[data-mq-customize]') : null;
      if (!c) return;
      if (c.hasAttribute('data-mq')) { select(c.getAttribute('data-mq'), true); return; }
      if (c.hasAttribute('data-mq-send')) { doSend(); return; }
      if (c.hasAttribute('data-mq-customize')) customize();
    });
    nameIn.addEventListener('input', function () {
      st.name = String(nameIn.value || '').trim();
      if (!st.name || validName()) nameErr(false);
      clearTimeout(timer); timer = setTimeout(renderAll, 220);
    });
    // swiping a card to the middle selects it (only when the row scrolls; on wide screens all three show)
    var stimer = 0;
    function onScroll() {
      clearTimeout(stimer);
      stimer = setTimeout(function () {
        if (row.scrollWidth <= row.clientWidth + 4) return;
        var rc = row.getBoundingClientRect(), mid = rc.left + rc.width / 2, best = null, bd = 1e9;
        list.forEach(function (t) { var r = cards[t].getBoundingClientRect(), dd = Math.abs(r.left + r.width / 2 - mid); if (dd < bd) { bd = dd; best = t; } });
        if (best && best !== st.template) select(best, false);
      }, 120);
    }
    row.addEventListener('scroll', onScroll, { passive: true });
    var onJoin = function () { renderAll(); };
    d.addEventListener('ysd:joined', onJoin);
    renderAll();
    return {
      el: root, state: st, select: function (t) { select(t, true); }, canvas: function () { return st.canvases[st.template] || null; }, render: renderAll,
      destroy: function () { row.removeEventListener('scroll', onScroll); d.removeEventListener('ysd:joined', onJoin); clearTimeout(timer); el.textContent = ''; }
    };
  }

  YSD.maker = { version: 2, mount: mount, mountQuick: mountQuick };
})(window, document);
