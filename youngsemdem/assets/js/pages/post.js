/*!
 * assets/js/pages/post.js (W4): the "post a clip" flow and the "Pending review" cards.    YSD.post
 * Used by post.html (as a page) and clips.html (inside the post sheet). BRIEF §6 "Posting".
 *
 *   YSD.post.mount(form, { mode: 'page' | 'sheet', tag, onDone(record) })  -> { reset(), setTag(tag) }
 *     form = <form data-post-form> with the markup in post.html (fields carry data-post-* hooks).
 *     Upload: YSD.clips.validate(file) then YSD.clips.add(file, {caption, tags}). Link: TikTok,
 *     Instagram or YouTube only, saved locally under YSD.store 'clips:links' as
 *     {id, source:'local', link, host, caption, tags, status:'pending', minors, guardian, captions, consents, createdAt, demo}.
 *     Errors go through YSD.ui.form.errors (aria-invalid, aria-describedby, focused summary).
 *     YSD.counters.bump('clips') after a clip or link is saved.
 *   YSD.post.pending(section)  renders this browser's own clips (uploads from IndexedDB + links) as
 *     "Pending review · only you can see this" cards with Remove; re-renders on clip changes and on
 *     ysd:forgot. Returns a Promise of the item count.
 *   YSD.post.hasPending()      sync: true when this browser has stored clips or links.
 *   YSD.post.checkLink(url)    -> {ok, code: 'empty'|'url'|'host'|null, host, url}
 * Nothing leaves the browser in demo. No AI. Untrusted text goes in with textContent.
 */
(function (w) {
  'use strict';
  var YSD = w.YSD = w.YSD || {};
  var d = w.document;
  var LINK_KEY = 'clips:links';
  var HOSTS = ['tiktok.com', 'instagram.com', 'youtube.com', 'youtu.be'];

  function t(key, vars) { return typeof YSD.t === 'function' ? YSD.t(key, vars) : ''; }
  function p(key, vars) { return t('clips:' + key, vars); }
  function lang() { return YSD.lang || 'en'; }
  function legal() { var L = (w.YSD_DATA || {}).legal; return (L && L.snippets) || {}; }
  function pick(o) { return o ? (o[lang()] || o.en || '') : ''; }
  function $(sel, root) { return (root || d).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || d).querySelectorAll(sel)); }
  function store() { return YSD.store || { get: function (k, f) { return f; }, set: function () {}, update: function () {}, on: function () { return function () {}; } }; }
  function toast(text, tone) { if (YSD.ui && YSD.ui.toast && text) YSD.ui.toast(text, tone ? { tone: tone } : undefined); }
  function el(tag, attrs, kids) {
    var n = d.createElement(tag);
    for (var k in attrs || {}) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'text') n.textContent = String(v); else if (k === 'class') n.className = v; else n.setAttribute(k, v === true ? '' : String(v));
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? d.createTextNode(c) : c); });
    return n;
  }
  function limits() { return YSD.clips && YSD.clips.limits ? YSD.clips.limits() : { captionMax: 300, tagsMax: 8, maxDuration: 180, maxBytes: 157286400 }; }

  // ------------------------------------------------------------------ links
  function checkLink(raw) {
    var s = String(raw || '').trim();
    if (!s) return { ok: false, code: 'empty' };
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
    var u;
    try { u = new URL(s); } catch (e) { return { ok: false, code: 'url' }; }
    if (!/^https?:$/.test(u.protocol) || !/\./.test(u.hostname)) return { ok: false, code: 'url' };
    var host = u.hostname.toLowerCase().replace(/\.$/, '');
    var match = null;
    for (var i = 0; i < HOSTS.length; i++) if (host === HOSTS[i] || host.slice(-(HOSTS[i].length + 1)) === '.' + HOSTS[i]) { match = HOSTS[i]; break; }
    if (!match) return { ok: false, code: 'host', host: host };
    return { ok: true, code: null, host: match === 'youtu.be' ? 'youtube.com' : match, url: u.href };
  }
  function links() { var a = store().get(LINK_KEY, []); return Array.isArray(a) ? a : []; }
  function hasPending() {
    if (links().length) return true;
    var l = store().get('clips:local', []);
    return Array.isArray(l) && l.length > 0;
  }

  // ------------------------------------------------------------------ the form
  function parseTags(s) {
    var out = [];
    String(s || '').split(/[,\n]|\s+(?=#)/).forEach(function (x) {
      x = x.replace(/^[\s#]+/, '').trim().toLowerCase().replace(/\s+/g, '-');
      if (x && out.indexOf(x) < 0) out.push(x);
    });
    return out;
  }
  function memberAge() {
    try {
      var m = YSD.members && YSD.members.current && YSD.members.current();
      if (!m) return NaN;
      var a = m.age != null && m.age !== '' ? parseInt(m.age, 10) : NaN;
      if (isNaN(a) && m.birthYear) a = new Date().getFullYear() - parseInt(m.birthYear, 10);
      return a;
    } catch (e) { return NaN; }
  }
  function clipMessage(code, res) {
    var L = limits(), vars = {};
    if (code === 'size') vars = { max: YSD.clips.format.bytes(L.maxBytes), size: res && res.size ? YSD.clips.format.bytes(res.size) : '' };
    if (code === 'duration') vars = { max: Math.round(L.maxDuration / 60) + (lang() === 'es' ? ' minutos' : ' minutes'), duration: res && res.meta && res.meta.duration ? YSD.clips.format.duration(res.meta.duration) : '' };
    return t('error.clip.' + code, vars) || (YSD.clips && YSD.clips.messages && YSD.clips.messages[code]) || t('error.generic');
  }

  // Legal copy comes from data/legal.js (via the page slice) so it never drifts: the minors question,
  // the guardian contact field and the three upload consents (all unchecked).
  function buildLegal(form, uid) {
    var S = legal(), mi = S.minorsInClip || {};
    var minBox = $('[data-post-minors]', form);
    if (minBox && !minBox.children.length) {
      minBox.appendChild(el('legend', { text: pick(mi.question) }));
      ['yes', 'no'].forEach(function (v) {
        minBox.appendChild(el('label', { class: 'choice' }, [el('input', { type: 'radio', name: 'minors', value: v }), el('span', { text: pick(mi[v]) })]));
      });
      minBox.appendChild(el('p', { class: 'field__error', hidden: true }));
    }
    var gBox = $('[data-post-guardian]', form);
    if (gBox && !gBox.children.length) {
      var gid = uid + '-guardian';
      gBox.appendChild(el('label', { class: 'field__label', for: gid, text: pick(mi.guardianContact) }));
      gBox.appendChild(el('p', { class: 'field__hint', id: gid + '-hint', text: pick(mi.guardianNote) }));
      gBox.appendChild(el('input', { id: gid, name: 'guardian', type: 'text', autocomplete: 'off', 'aria-describedby': gid + '-hint' }));
      gBox.appendChild(el('p', { class: 'field__error', hidden: true }));
    }
    var cBox = $('[data-post-consents]', form);
    if (cBox && !cBox.querySelector('input')) {
      (S.uploadConsent || []).forEach(function (c) {
        var id = uid + '-consent-' + c.id;
        cBox.appendChild(el('div', { class: 'field' }, [
          el('div', { class: 'x-checkrow' }, [el('input', { id: id, name: 'consent-' + c.id, type: 'checkbox', 'data-post-consent': true }), el('label', { class: 'field__label', for: id, text: pick(c.label) })]),
          el('p', { class: 'field__error', hidden: true })
        ]));
      });
    }
  }

  function mount(form, opts) {
    if (!form || form.__ysdPost) return form && form.__ysdPost;
    opts = opts || {};
    buildLegal(form, form.getAttribute('data-post-form') || 'post');
    var mode = opts.mode || 'page';
    var fileIn = $('[name="file"]', form), linkIn = $('[name="link"]', form), cap = $('[name="caption"]', form);
    var tagsIn = $('[name="tags"]', form), ageIn = $('[name="age"]', form), guard = $('[name="guardian"]', form);
    var countEl = $('[data-post-count]', form), chosen = $('[data-post-chosen]', form), submit = $('[type="submit"]', form);
    var ageBox = $('[data-post-age]', form), guardBox = $('[data-post-guardian]', form), promptBox = $('[data-post-prompt]', form);
    var L = limits();
    var currentTag = '';

    function howMode() { var r = $('[name="how"]:checked', form); return r ? r.value : 'upload'; }
    function syncHow() {
      var m = howMode();
      $$('[data-post-when]', form).forEach(function (b) { b.hidden = b.getAttribute('data-post-when') !== m; });
    }
    function ageNow() {
      var a = memberAge();
      if (!isNaN(a)) return a;
      var v = ageIn ? String(ageIn.value || '').trim() : '';
      return /^\d{1,3}$/.test(v) ? parseInt(v, 10) : NaN;
    }
    function minorsYes() { var r = $('[name="minors"]:checked', form); return r ? r.value === 'yes' : false; }
    function needGuardian() { var a = ageNow(); return minorsYes() || (!isNaN(a) && a < 18); }
    function syncGuardian() { if (guardBox) guardBox.hidden = !needGuardian(); }
    function syncCount() {
      if (!countEl || !cap) return;
      var n = cap.value.length;
      countEl.textContent = p('post.count', { n: n, max: L.captionMax });
      countEl.setAttribute('data-state', n > L.captionMax ? 'over' : n > L.captionMax - 30 ? 'near' : 'ok');
    }
    function setTag(tag) {
      currentTag = String(tag || '').replace(/^#/, '');
      if (tagsIn && currentTag) {
        var have = parseTags(tagsIn.value);
        if (have.indexOf(currentTag) < 0) tagsIn.value = ['#' + currentTag].concat(have.map(function (x) { return '#' + x; })).join(', ');
      }
      showPrompt();
    }
    function showPrompt() {
      if (!promptBox) return;
      var pr = YSD.reel && YSD.reel.prompt ? YSD.reel.prompt() : null;
      if (!pr || pr.rest || !pr.tag || (currentTag && currentTag !== pr.tag && parseTags(tagsIn && tagsIn.value).indexOf(pr.tag) < 0 && currentTag)) { promptBox.hidden = true; return; }
      var title = $('[data-post-prompt-title]', promptBox), tagLine = $('[data-post-prompt-tag]', promptBox), use = $('[data-post-use-prompt]', promptBox);
      if (title) title.textContent = pick(pr.title);
      var using = currentTag === pr.tag;
      if (tagLine) { tagLine.textContent = p('prompt.tag', { tag: pr.tag }); tagLine.hidden = !using; }
      if (!use) {
        use = el('button', { class: 'btn btn--sm x-post__use', type: 'button', 'data-post-use-prompt': true, text: p('post.usePrompt') });
        promptBox.appendChild(use);
      }
      if (!use.__wired) {
        use.__wired = true;
        use.addEventListener('click', function () { setTag(pr.tag); var tl = $('[data-post-prompt-tag]', promptBox); if (tl) { tl.setAttribute('tabindex', '-1'); tl.focus(); } });
      }
      use.hidden = using;
      promptBox.hidden = false;
    }

    if (ageBox && !isNaN(memberAge())) ageBox.hidden = true;
    $$('[name="how"]', form).forEach(function (r) { r.addEventListener('change', function () { syncHow(); if (YSD.ui && YSD.ui.form) clearField(r.value === 'upload' ? linkIn : fileIn); }); });
    $$('[name="minors"]', form).forEach(function (r) { r.addEventListener('change', syncGuardian); });
    if (ageIn) ageIn.addEventListener('input', syncGuardian);
    if (cap) cap.addEventListener('input', syncCount);
    if (fileIn) fileIn.addEventListener('change', function () {
      var f = fileIn.files && fileIn.files[0];
      if (!chosen) return;
      if (!f) { chosen.hidden = true; return; }
      var v = YSD.clips ? YSD.clips.validate(f) : { ok: true };
      if (!v.ok) { chosen.hidden = true; showErrors({ file: v.code }, { file: clipMessage(v.code, v) }); return; }
      clearField(fileIn);
      chosen.textContent = p('post.fileChosen', { name: f.name, duration: YSD.clips.format.bytes(f.size) });
      chosen.hidden = false;
      if (YSD.clips.check) YSD.clips.check(f).then(function (r) {
        if (fileIn.files[0] !== f) return;
        if (r && r.ok && r.meta && r.meta.duration) chosen.textContent = p('post.fileChosen', { name: f.name, duration: YSD.clips.format.duration(r.meta.duration) });
        else if (r && !r.ok) { chosen.hidden = true; showErrors({ file: r.code }, { file: clipMessage(r.code, r) }); }
      });
    });

    function clearField(c) {
      if (!c) return;
      c.removeAttribute('aria-invalid');
      var f = c.closest('.field'), err = f && $('.field__error', f);
      if (err) { err.textContent = ''; err.hidden = true; }
    }
    function showErrors(errs, msgs) {
      if (YSD.ui && YSD.ui.form) YSD.ui.form.errors(form, errs, { messages: msgs });
    }

    function validate() {
      var errs = {}, msgs = {}, m = howMode();
      if (m === 'upload') {
        var f = fileIn && fileIn.files && fileIn.files[0];
        if (!f) { errs.file = 'empty'; msgs.file = p('post.err.empty'); }
        else { var v = YSD.clips.validate(f); if (!v.ok) { errs.file = v.code; msgs.file = clipMessage(v.code, v); } }
      } else {
        var c = checkLink(linkIn && linkIn.value);
        if (!c.ok) { errs.link = c.code; msgs.link = p(c.code === 'host' ? 'post.err.host' : c.code === 'url' ? 'post.err.url' : 'post.err.empty'); }
      }
      var capBox = $('[name="hasCaptions"]', form);
      if (capBox && !capBox.checked) { errs.hasCaptions = 'required'; msgs.hasCaptions = p('post.err.captions'); }
      if (cap && cap.value.length > L.captionMax) { errs.caption = 'long'; msgs.caption = p('post.err.caption'); }
      if (tagsIn && parseTags(tagsIn.value).length > L.tagsMax) { errs.tags = 'many'; msgs.tags = p('post.err.tags'); }
      var a = ageNow();
      if (ageIn && ageBox && !ageBox.hidden && isNaN(a)) { errs.age = 'required'; msgs.age = p('post.err.age'); }
      if (!$('[name="minors"]:checked', form)) { errs.minors = 'required'; msgs.minors = p('post.err.minors'); }
      if (needGuardian() && guard && !String(guard.value || '').trim()) { errs.guardian = 'required'; msgs.guardian = p('post.err.guardian'); }
      $$('[data-post-consent]', form).forEach(function (b) { if (!b.checked) { errs[b.name] = 'required'; msgs[b.name] = t('error.consent.required'); } });
      return { errs: errs, msgs: msgs, age: a };
    }

    function reset() {
      form.reset();
      if (chosen) chosen.hidden = true;
      if (YSD.ui && YSD.ui.form) YSD.ui.form.clear(form);
      syncHow(); syncGuardian(); syncCount();
      if (currentTag) setTag(currentTag);
    }

    var busy = false;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (busy) return;
      var r = validate();
      if (!isNaN(r.age) && r.age < 14) {
        // Under 14: store nothing, keep nothing they typed (legal teen safety rules).
        form.reset(); syncHow(); syncGuardian(); syncCount();
        showErrors({ age: 'too_young' }, { age: p('post.tooYoung') });
        return;
      }
      if (Object.keys(r.errs).length) { showErrors(r.errs, r.msgs); return; }
      if (YSD.ui && YSD.ui.form) YSD.ui.form.clear(form);
      var caption = cap ? cap.value.trim() : '', tags = tagsIn ? parseTags(tagsIn.value).slice(0, L.tagsMax) : [];
      var consents = $$('[data-post-consent]', form).map(function (b) { return b.name.replace(/^consent-/, ''); });
      var minors = minorsYes() ? 'yes' : 'no', guardian = needGuardian();
      busy = true;
      if (submit) { submit.setAttribute('data-state', 'loading'); submit.setAttribute('aria-disabled', 'true'); }
      var job;
      if (howMode() === 'upload') {
        job = YSD.clips.add(fileIn.files[0], {
          caption: caption, tags: tags,
          // moderation answers ride on the record (review journeys-01): captions box, minors, guardian, consents
          captionsConfirmed: true, containsMinors: minors, guardianRequired: guardian,
          guardianContact: guard ? String(guard.value || '').trim() : '',
          consents: consents
        }).then(function (clip) { return { kind: 'upload', id: clip.id, clip: clip }; });
      } else {
        var c = checkLink(linkIn.value);
        var rec = { id: 'link-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), source: 'local', link: c.url, host: c.host,
          caption: caption.slice(0, L.captionMax), tags: tags, status: 'pending', minors: minors, guardian: guardian, captions: true,
          consents: consents, createdAt: new Date().toISOString(), demo: !(YSD.cfg && YSD.cfg('demo', true) === false) };
        store().update(LINK_KEY, function (a) { a = Array.isArray(a) ? a : []; a.unshift(rec); return a.slice(0, 50); }, []);
        job = Promise.resolve({ kind: 'link', id: rec.id, record: rec });
      }
      job.then(function (res) {
        try { if (YSD.counters && YSD.counters.bump) YSD.counters.bump('clips'); } catch (x) {}
        busy = false;
        if (submit) { submit.removeAttribute('data-state'); submit.removeAttribute('aria-disabled'); }
        reset();
        toast(pick(legal().uploadPending) || t('success.clip.body'));
        if (typeof opts.onDone === 'function') opts.onDone(res);
      }, function (err) {
        busy = false;
        if (submit) { submit.removeAttribute('data-state'); submit.removeAttribute('aria-disabled'); }
        var code = err && err.code || 'upload-failed';
        if (code === 'demo') return; // demo mode never uploads: the clip is saved locally
        showErrors({ file: code }, { file: clipMessage(code, err && err.result) });
      });
    });

    syncHow(); syncGuardian(); syncCount();
    var q = '';
    try { q = new URL(w.location.href).searchParams.get('tag') || ''; } catch (e) {}
    setTag(opts.tag || q.replace(/[^a-z0-9-]/gi, '').toLowerCase());
    var api = { reset: reset, setTag: setTag, form: form };
    form.__ysdPost = api;
    return api;
  }

  // ------------------------------------------------------------------ pending cards
  function pending(section, opts) {
    if (!section) return Promise.resolve(0);
    opts = opts || {};
    var listEl = $('[data-post-pending-list]', section) || section;
    function render() {
      var up = YSD.clips && YSD.clips.list ? YSD.clips.list({ mine: true, includeUnavailable: true, sort: 'new' }) : Promise.resolve([]);
      return up.then(function (clips) {
        var items = clips.map(function (c) { return { kind: 'upload', id: c.id, caption: c.caption, tags: c.tags, poster: c.poster, createdAt: c.createdAt, persisted: c.persisted }; })
          .concat(links().map(function (r) { return { kind: 'link', id: r.id, caption: r.caption, tags: r.tags || [], host: r.host, createdAt: r.createdAt, persisted: true }; }));
        items.sort(function (a, b) { return String(b.createdAt || '').localeCompare(String(a.createdAt || '')); });
        listEl.textContent = '';
        items.forEach(function (it) { listEl.appendChild(card(it)); });
        section.hidden = !items.length;
        return items.length;
      });
    }
    function card(it) {
      var thumb;
      if (it.kind === 'upload' && it.poster) thumb = el('img', { class: 'x-pending__thumb', src: it.poster, alt: '', width: 72, height: 128 });
      else thumb = el('span', { class: 'x-pending__thumb x-pending__thumb--link', 'aria-hidden': 'true', text: it.kind === 'link' ? (it.host || '').charAt(0).toUpperCase() : '+' });
      var body = el('div', { class: 'x-pending__body' }, [
        el('p', { class: 'tag tag--new x-pending__tag', text: p('pending.tag') }),
        el('p', { class: 'x-pending__caption', text: it.caption || p('pending.noCaption') })
      ]);
      if (it.kind === 'link') body.appendChild(el('p', { class: 'x-pending__meta', text: p('pending.link', { host: it.host || '' }) }));
      if (it.tags && it.tags.length) body.appendChild(el('p', { class: 'x-pending__meta', translate: 'no', text: it.tags.map(function (x) { return '#' + x; }).join(' ') }));
      body.appendChild(el('p', { class: 'x-pending__meta', text: it.persisted === false ? p('pending.notSaved') : p('pending.body') }));
      var rm = el('button', { class: 'btn btn--sm x-pending__remove', type: 'button', 'aria-label': p('pending.removeLabel'), 'data-pending-remove': it.id }, [t('cta.remove') || 'Remove']);
      rm.addEventListener('click', function () { remove(it); });
      body.appendChild(rm);
      return el('article', { class: 'x-pending', 'data-pending-id': it.id }, [thumb, body]);
    }
    function remove(it) {
      var done = it.kind === 'upload' ? YSD.clips.remove(it.id) : Promise.resolve(store().update(LINK_KEY, function (a) { return (Array.isArray(a) ? a : []).filter(function (r) { return r.id !== it.id; }); }, []));
      done.then(function () { return render(); }).then(function (n) {
        toast(p('pending.removed'));
        var h = $('[data-post-pending-heading]', section) || (opts.focusAfter && $(opts.focusAfter));
        if (n && h) { h.setAttribute('tabindex', '-1'); h.focus(); }
        else if (opts.focusAfter) {
          // the list is gone: send focus somewhere visible so it never falls back to <body>
          var f = typeof opts.focusAfter === 'string' ? $(opts.focusAfter) : opts.focusAfter;
          if (f) { if (!f.matches('a[href], button, input, select, textarea, [tabindex]')) f.setAttribute('tabindex', '-1'); f.focus(); }
        }
      });
    }
    if (!section.__ysdPending) {
      section.__ysdPending = true;
      d.addEventListener('ysd:clips-changed', function () { render(); });
      d.addEventListener('ysd:forgot', function () { try { store().remove(LINK_KEY); } catch (e) {} render(); });
      try { store().on(LINK_KEY, function () { render(); }); } catch (e) {}
    }
    return render();
  }

  YSD.post = { mount: mount, pending: pending, hasPending: hasPending, checkLink: checkLink, parseTags: parseTags, LINK_KEY: LINK_KEY };

  // post.html: wire the page form and its own pending list.
  function boot() {
    if (!d.body || !d.body.classList.contains('p-post')) return;
    var form = $('[data-post-form]'), done = $('[data-post-done]'), section = $('[data-post-pending]');
    pending(section, { focusAfter: '#post-form-title' });
    mount(form, {
      mode: 'page',
      onDone: function () {
        form.hidden = true;
        if (done) {
          done.hidden = false;
          var h = $('[data-post-done-title]', done);
          if (h) { h.setAttribute('tabindex', '-1'); h.focus(); }
        }
        pending(section, { focusAfter: '#post-form-title' });
      }
    });
    var again = $('[data-post-again]');
    if (again) again.addEventListener('click', function () {
      if (done) done.hidden = true;
      form.hidden = false;
      var first = $('[name="how"]:checked', form) || $('input, textarea', form);
      if (first) first.focus();
    });
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', boot); else boot();
})(window);
