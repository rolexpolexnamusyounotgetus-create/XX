/*! YDSC · assets/js/membercard.js (W5). Member card, sticker book, weekly streak, squad meter and
 * Seminole Rewind (BRIEF 5.1, 5.5, 5.6). Classic script, no AI, no network.
 *
 * CONTRACT (Join W6 and Home W1 mount the card; W2, W4 and the quiz page log organizing actions):
 *   Load after the core stack and data/slices/growth.js (or data/levels.js + data/sharekit.js);
 *   assets/js/cards-brand.js + assets/js/maker.js for "Save my card" and "My 2026"; assets/css/maker.css.
 *
 *   YSD.memberCard.mount(el, { city })   renders the card (or a join prompt for non-members) and keeps it
 *                                        current. Returns { el, refresh(), destroy() }.
 *   YSD.memberCard.data()                -> { name, city, colorway, since, stickers[], supporter } for the card template
 *                                        supporter: true when the member's age is over org.ageCap (39). People 40 and
 *                                        up join the email list as SUPPORTERS, not members (lead, Nov 9, 2026): the
 *                                        card says "Supporter" / "Simpatizante" (sharekit cards.membercard.supporter*).
 *   YSD.stickers.act(action, { ref, series, city, lang })  logs an ORGANIZING action (join, rsvp, attend,
 *                                        bring-friend, post-clip, share-card, quiz, volunteer-shift) and
 *                                        collects every sticker whose rule it completes. Civic actions
 *                                        (data/levels.js kind 'civic') are ignored: they earn nothing.
 *                                        Returns the ids collected now.
 *   YSD.stickers.collect(id, action, ref) collect one sticker directly (once). -> entry | null
 *   YSD.stickers.list()                  -> [{ id, action, ref?, ts }]      .has(id)  .book()  .reset()
 *   YSD.streak.weeks()                   -> ['2026-11-09', ...] Mondays (New York) with an organizing action
 *   YSD.streak.current() / .total()      in-a-row (grace and rest weeks applied) / total active weeks
 *   YSD.membercard.rulesPanel(el, opts)  the public, pre-join "How stickers work" (rules, 15 locked stickers, DEMO
 *                                        perk ladder, voting never earns anything); see rulesPanel() below for opts.
 *                                        YSD.membercard is an alias of YSD.memberCard.
 *   The member card's link block (journeys-07): "Send it to the group chat", "Copy my link" (copies only the link,
 *   "Link copied" as a priority toast), Text it, WhatsApp, and for adults "Show my first name on my link"
 *   (YSD.members.setShareName). The link is YSD.share.url('join.html'), so from=<FirstName> rides along for adults.
 *   Sticker unlocks use YSD.ui.reveal when ui.js has it (else a low-priority toast); act(action, { delay }) waits.
 *   YSD.squadMeter.mount(el)             "Friends who joined with your link: n of 3" from
 *                                        YSD.members.squad() filtered to simulated !== true.
 *   YSD.rewind.available() / .data() / .open(opener)   "My 2026" (from Thu, Dec 17, 2026, 7 am New York,
 *                                        or ?preview=rewind): a sheet with the rewind maker.
 * Automatic hooks: ysd:joined -> join; YSD.members.onSquad -> bring-friend (real members only);
 * ysd:card-share (shared/downloaded) -> share-card; ysd:clip-added -> post-clip; YSD.rsvp.on (W2, when
 * loaded) or ysd:rsvp with status 'in' -> rsvp; ysd:attend { ref, series, city, lang } -> attend.
 * Storage (YSD.store): 'stickers', 'stickers:log', 'streak' (BRIEF 7.6). Nothing is ever sent.
 */
(function (w, d) {
  'use strict';
  var YSD = w.YSD = w.YSD || {};
  var TZ = 'America/New_York';

  function D() { return w.YSD_DATA || {}; }
  function lv() { return D().levels || {}; }
  function kit() { return D().sharekit || {}; }
  function L() { return YSD.lang === 'es' ? 'es' : 'en'; }
  function pick(o) { return !o ? '' : typeof o === 'string' ? o : (o[L()] != null ? o[L()] : (o.en || '')); }
  function fill(s, v) { return String(s == null ? '' : s).replace(/\{(\w+)\}/g, function (m, k) { return v && v[k] != null ? String(v[k]) : m; }); }
  function lab(k, v) { return fill(pick((lv().labels || {})[k]), v); }
  function cp(k, v) { return fill(pick((lv().copy || {})[k]), v); }
  function C(path, v) { var o = kit().cards, p = path.split('.'); for (var i = 0; i < p.length && o; i++) o = o[p[i]]; return fill(pick(o), v); }
  function MK(path, v) { var o = kit().maker, p = path.split('.'); for (var i = 0; i < p.length && o; i++) o = o[p[i]]; return fill(pick(o), v); }
  function get(k, fb) { try { return YSD.store ? YSD.store.get(k, fb) : fb; } catch (e) { return fb; } }
  function set(k, v) { try { if (YSD.store) YSD.store.set(k, v); } catch (e) {} return v; }
  function emit(n, det) { try { if (YSD.emit) YSD.emit(n, det); } catch (e) {} }
  function byId(a, id) { for (var i = 0; i < (a || []).length; i++) if (a[i] && a[i].id === id) return a[i]; return null; }
  function h(tag, attrs, kids) {
    var el = d.createElement(tag);
    for (var k in attrs || {}) {
      var v = attrs[k]; if (v == null || v === false) continue;
      if (k === 'text') el.textContent = v; else if (k === 'cls') el.className = v;
      else if (k === 'style') for (var s in v) el.style.setProperty(s, v[s]);
      else el.setAttribute(k, v === true ? '' : v);
    }
    (kids || []).forEach(function (c) { if (c) el.appendChild(typeof c === 'string' ? d.createTextNode(c) : c); });
    return el;
  }

  // ---------------------------------------------------------------- weeks (New York)
  function nyYmd(t) {
    var p = {};
    try { new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(new Date(t)).forEach(function (x) { p[x.type] = x.value; }); } catch (e) {}
    return p;
  }
  var WD = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  /** Monday of the New York week containing time t, as 'YYYY-MM-DD'. */
  function weekOf(t) {
    var p = nyYmd(t == null ? Date.now() : t);
    var day = Date.UTC(+p.year, +p.month - 1, +p.day) - (WD[p.weekday] || 0) * 864e5;
    return new Date(day).toISOString().slice(0, 10);
  }
  function addWeeks(ymd, n) { return new Date(Date.parse(ymd + 'T00:00:00Z') + n * 7 * 864e5).toISOString().slice(0, 10); }

  // ---------------------------------------------------------------- sticker book
  function book() { return lv().stickers || []; }
  /** The art id to draw for a sticker: its own piece, or the older fallback when this page's stickers data lacks it. */
  function artFor(s) {
    if (!s) return '';
    var has = YSD.ui && YSD.ui.sticker ? function (id) { return !!YSD.ui.sticker(id); } : function () { return true; };
    return has(s.art) ? s.art : (s.artFallback && has(s.artFallback) ? s.artFallback : s.art);
  }
  /**
   * Announce a new sticker (genz-brand-10): the YSD.ui.reveal collectible moment when ui.js has it, else a
   * low-priority toast that waits behind "Link copied" (journeys-14). meta.delay (ms) lets the moment that earned it
   * land first (the quiz result, a share result).
   */
  function announce(ids, meta) {
    if (!ids.length || meta.quiet === true) return;
    var go = function () {
      ids.forEach(function (id) {
        var s = byId(book(), id); if (!s) return;
        var name = pick(s.name);
        if (YSD.ui && typeof YSD.ui.reveal === 'function') {
          YSD.ui.reveal({
            sticker: artFor(s), title: name, ring: s.ring || 'celery',
            body: lab('onYourCard', { desc: pick(s.desc), sticker: name }) || pick(s.desc),
            actions: [{ label: lab('rulesYours') || 'See your stickers', href: cardHref(), primary: true }]
          });
        } else if (YSD.ui && YSD.ui.toast) YSD.ui.toast(cp('stickerCollected', { sticker: name }), { priority: 'low' });
      });
    };
    if (meta.delay) setTimeout(go, +meta.delay); else go();
  }
  function cardHref() {
    var es = YSD.lang === 'es' ? 'es/' : '';
    var here = String(w.location.pathname || '');
    if (/\/join\.html$/.test(here)) return '#card';
    return (YSD.root || '') + es + 'join.html#card';
  }
  function actionDef(id) { return byId(lv().actions, id); }
  function list() { var v = get('stickers', []); return Array.isArray(v) ? v : []; }
  function log() { var v = get('stickers:log', []); return Array.isArray(v) ? v : []; }
  function has(id) { return list().some(function (s) { return s.id === id; }); }
  function markWeek(t) {
    var s = get('streak', null) || { weeks: [] }, wk = weekOf(t);
    if (!Array.isArray(s.weeks)) s.weeks = [];
    if (s.weeks.indexOf(wk) < 0) { s.weeks.push(wk); s.weeks.sort(); set('streak', s); }
  }
  function collect(id, action, ref) {
    if (!id || has(id) || !byId(book(), id)) return null;
    var e = { id: id, action: action || '', ts: Date.now() };
    if (ref) e.ref = String(ref);
    set('stickers', list().concat([e]));
    emit('sticker', e);
    try { if (YSD.track) YSD.track('sticker_collected', { id: id }); } catch (x) {}
    return e;
  }
  function count(action, filter) { return log().filter(function (e) { return e.action === action && (!filter || filter(e)); }).length; }
  function ruleMet(r) {
    if (!r) return false;
    if (r.type === 'count') return count(r.action) >= (r.min || 1);
    if (r.type === 'attend-series') return count('attend', function (e) { return e.series === r.series; }) >= (r.min || 1);
    if (r.type === 'attend-language') return count('attend', function (e) { return e.lang === r.lang; }) >= (r.min || 1);
    if (r.type === 'attend-distinct') { var seen = {}; log().forEach(function (e) { if (e.action === 'attend' && e[r.field || 'city']) seen[e[r.field || 'city']] = 1; }); return Object.keys(seen).length >= (r.min || 1); }
    if (r.type === 'active-weeks') return total() >= (r.min || 1);
    return false;
  }
  function evaluate(action) {
    var got = [];
    book().forEach(function (s) {
      if (has(s.id)) return;
      var r = s.rule || {};
      if (r.type !== 'active-weeks' && r.action && r.action !== action && !(action === 'attend' && /^attend/.test(r.type))) return;
      if (r.type && /^attend/.test(r.type) && action !== 'attend') return;
      if (ruleMet(r) && collect(s.id, action)) got.push(s.id);
    });
    return got;
  }
  function act(action, meta) {
    var def = actionDef(action);
    if (!def || def.kind !== 'organizing' || def.collectible === false) return [];
    meta = meta || {};
    var entries = log();
    if (meta.ref && entries.some(function (e) { return e.action === action && e.ref === String(meta.ref); })) return [];
    var e = { action: action, ts: Date.now() };
    ['ref', 'series', 'city', 'lang'].forEach(function (k) { if (meta[k]) e[k] = String(meta[k]); });
    entries.push(e);
    if (entries.length > 400) entries = entries.slice(-400);
    set('stickers:log', entries);
    markWeek(e.ts);
    var got = evaluate(action);
    announce(got, meta);
    return got;
  }
  YSD.stickers = {
    act: act, collect: collect, list: list, has: has,
    book: function () { var mine = list(); return book().map(function (s) { return { sticker: s, got: byId(mine, s.id) }; }); },
    reset: function () { set('stickers', []); set('stickers:log', []); set('streak', { weeks: [] }); emit('sticker', { reset: true }); }
  };

  // ---------------------------------------------------------------- streak
  function weeks() { var s = get('streak', null); return s && Array.isArray(s.weeks) ? s.weeks.slice().sort() : []; }
  function total() { return weeks().length; }
  function current() {
    var S = lv().streaks || {}, grace = S.graceWeeks == null ? 2 : S.graceWeeks, rest = {};
    (S.restWeeks || []).forEach(function (r) { rest[r.weekOf] = 1; });
    var have = {}; weeks().forEach(function (wk) { have[wk] = 1; });
    var wk = weekOf(), n = 0, quiet = 0, first = true, guard = 0;
    while (guard++ < 260) {
      if (have[wk]) { n++; quiet = 0; }
      else if (rest[wk] || first) { /* rest week, or this week still in progress */ }
      else { quiet++; if (quiet > grace) break; }
      first = false;
      wk = addWeeks(wk, -1);
      if (!Object.keys(have).length) break;
      if (wk < weeks()[0]) break;
    }
    return n;
  }
  YSD.streak = { weeks: weeks, total: total, current: current, weekOf: weekOf };

  // ---------------------------------------------------------------- squad meter
  function realSquad() {
    try { return (YSD.members && YSD.members.squad ? YSD.members.squad() : []).filter(function (m) { return m && m.simulated !== true; }); } catch (e) { return []; }
  }
  function meter(el) {
    el = typeof el === 'string' ? d.querySelector(el) : el;
    if (!el) return null;
    function paint() {
      var n = realSquad().length, shown = Math.min(n, 3);
      el.textContent = '';
      var box = h('div', { cls: 'meter', 'data-squad-meter': '', 'data-count': String(n) });
      box.appendChild(h('p', { cls: 'meter__label', text: meterText(n) }));
      var dots = h('ol', { cls: 'meter__dots', 'aria-hidden': 'true' });
      for (var i = 0; i < 3; i++) dots.appendChild(h('li', { cls: 'meter__dot', 'data-state': i < shown ? 'done' : 'empty' }));
      box.appendChild(dots);
      if (YSD.cfg && YSD.cfg('demo', true) !== false && meterHint()) box.appendChild(h('p', { cls: 'meter__hint', text: meterHint() }));
      el.appendChild(box);
    }
    paint();
    var off = YSD.members && YSD.members.onSquad ? YSD.members.onSquad(paint) : null;
    d.addEventListener('ysd:joined', paint);
    return { el: el, refresh: paint, destroy: function () { if (typeof off === 'function') off(); d.removeEventListener('ysd:joined', paint); } };
  }
  function meterText(n) {
    var m = (kit().meter || {});
    return fill(pick(n >= 3 && m.full ? m.full : m.text), { n: n });
  }
  function meterHint() { var m = (kit().meter || {}), who = me(); return fill(pick(m.demoHint) || '', { name: who && who.firstName ? String(who.firstName).trim().slice(0, 20) : '' }); }
  YSD.squadMeter = { mount: meter, count: function () { return realSquad().length; } };

  // ---------------------------------------------------------------- member card
  function me() { try { return YSD.members && YSD.members.current ? YSD.members.current() : null; } catch (e) { return null; } }
  /** 40 and up: on the list as a supporter, not a member (membership is 14 to 39, org.ageCap). */
  function isSupporter(m) {
    if (!m) return false;
    var age = m.age != null && m.age !== '' ? parseInt(m.age, 10) : NaN;
    var cap = +(YSD.cfg ? YSD.cfg('org.ageCap', 39) : 39) || 39;
    if (!isNaN(age)) return age > cap;
    return !!(m.warnings && m.warnings.age === 'over_age_cap');
  }
  function draftCity() { var dr = get('maker:draft', null); return dr && dr.city ? dr.city : ''; }
  function cityObj(id) { return byId(kit().cities, id); }
  function data(opts) {
    opts = opts || {};
    var m = me() || {}, city = opts.city || m.city || draftCity() || 'seminole', c = cityObj(city);
    return { name: m.firstName || '', city: city, colorway: c ? c.colorway : 'violet', since: m.joinedAt ? new Date(m.joinedAt).toISOString() : new Date().toISOString(), stickers: list().map(function (s) { return s.id; }), supporter: isSupporter(m) };
  }
  var MARK = '<svg class="brand__mark" viewBox="0 9 64 46" aria-hidden="true" focusable="false"><g transform="rotate(-8 32 32)"><path d="M9 15H55Q59 15 59 19V27A5 5 0 0 0 59 37V45Q59 49 55 49H9Q5 49 5 45V37A5 5 0 0 0 5 27V19Q5 15 9 15Z" fill="#C8F03C" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M15.9 20.3h2.2v2.6h-2.2ZM15.9 25.5h2.2v2.6h-2.2ZM15.9 30.7h2.2v2.6h-2.2ZM15.9 35.9h2.2v2.6h-2.2ZM15.9 41.1h2.2v2.6h-2.2ZM27.3 42.5V35.8L21 21.5H27.2L29.9 32.7H30.1L32.7 21.5H38.4L32.4 35.8V42.5ZM39.6 42.5V21.5H45.5Q47.8 21.5 49.7 22.7Q51.6 24 52.7 26.3Q53.8 28.7 53.8 32.1Q53.8 34.8 53.2 36.7Q52.7 38.6 51.7 39.7Q50.7 40.9 49.7 41.5Q48.6 42.1 47.6 42.3Q46.6 42.5 45.9 42.5ZM44.5 38.6H45.7Q46.8 38.6 47.5 37.9Q48.2 37.2 48.5 35.7Q48.9 34.2 48.9 32Q48.9 30.3 48.7 29Q48.5 27.8 48.1 27Q47.7 26.2 47.1 25.8Q46.4 25.4 45.5 25.4H44.5Z" fill="#170B33"/></g></svg>';
  function brandEl() {
    var b = h('span', { cls: 'brand membercard__brand' });
    b.innerHTML = MARK; // trusted: static markup from the header partial
    b.insertAdjacentHTML('beforeend', '<svg class="brand__word" viewBox="-10 -800 4974 1020" aria-hidden="true" focusable="false"><use href="#ysd-word"/></svg>'); // the header partial's wordmark path
    b.appendChild(h('span', { cls: 'u-visually-hidden', translate: 'no', text: 'Young Dems' }));
    return b;
  }
  function stickerEl(s, got) {
    var art = YSD.ui && YSD.ui.sticker ? YSD.ui.sticker(artFor(s)) : null;
    var fig = h('li', { cls: 'stickerbook__item', 'data-state': got ? 'got' : 'empty', style: { '--ring': 'var(--' + (s.ring || 'celery') + ')' } });
    var pic = h('span', { cls: 'stickerbook__art', 'aria-hidden': 'true' });
    if (art && art.svg) pic.innerHTML = art.svg; // trusted: our own data file
    fig.appendChild(pic);
    var when = '';
    if (got) { try { when = YSD.fmt && YSD.fmt.date ? YSD.fmt.date(new Date(got.ts).toISOString(), { time: false }) : ''; } catch (e) {} }
    fig.appendChild(h('span', { cls: 'stickerbook__name', text: pick(s.name) }));
    fig.appendChild(h('span', { cls: 'stickerbook__meta', text: got ? lab('got', { date: when }) : pick(s.unlock) }));
    if (s.perk) fig.appendChild(h('span', { cls: 'stickerbook__perk' }, [h('span', { cls: 'tag tag--demo', text: lab('perkDemo') }), ' ', h('span', { text: pick(s.perk) })]));
    return fig;
  }
  /** My invite link: join.html with my ref, plus from=<FirstName> for adults who allow it (share.js, journeys-08). */
  function linkUrl() { try { return YSD.share.url((YSD.lang === 'es' ? 'es/' : '') + 'join.html'); } catch (e) { return ''; } }
  function shareText(sup) { return String(MK(sup ? 'messages.join' : 'messages.membercard') || '').replace(/\s*\{(?:url|link)\}\s*$/, ''); }
  function shareBlock(m, link, sup) {
    var text = shareText(sup), links = YSD.share && YSD.share.links ? YSD.share.links(text, link) : null;
    var wrap = h('div', { cls: 'membercard__share' });
    wrap.appendChild(h('div', { cls: 'btn-row membercard__share-main' }, [
      h('button', { type: 'button', cls: 'btn btn--primary', 'data-mc-share': '', text: (YSD.t && YSD.t('cta.shareGroup')) || MK('actions.share') }),
      h('button', { type: 'button', cls: 'btn btn--ghost', 'data-mc-copy': '', text: lab('copyMyLink') || MK('actions.copy') })
    ]));
    if (links) wrap.appendChild(h('div', { cls: 'btn-row membercard__share-more' }, [
      h('a', { cls: 'btn btn--quiet btn--sm', href: links.sms, 'data-mc-sms': '', text: MK('actions.sms') }),
      h('a', { cls: 'btn btn--quiet btn--sm', href: links.whatsapp, target: '_blank', rel: 'noopener', 'data-mc-wa': '', text: MK('actions.whatsapp') })
    ]));
    // "Show my first name on my link": adults only (share.js never adds it for minors or unknown ages)
    var adult = false, minor = false, on = false;
    try { var a = parseInt(m.age, 10); adult = !isNaN(a) && a >= 18 && !!m.firstName; minor = !isNaN(a) && a < 18; on = YSD.members && YSD.members.shareName ? YSD.members.shareName() : false; } catch (e) {}
    if (adult && YSD.members && YSD.members.setShareName) {
      var sw = h('label', { cls: 'switch membercard__showname' }, [
        h('input', { type: 'checkbox', role: 'switch', 'data-mc-showname': '', checked: on ? true : null, 'aria-describedby': 'mc-showname-hint' }),
        h('span', { cls: 'switch__track', 'aria-hidden': 'true' }),
        h('span', { text: lab('showName') })
      ]);
      wrap.appendChild(sw);
      wrap.appendChild(h('p', { cls: 'membercard__hint', id: 'mc-showname-hint', text: on ? lab('showNameOn', { name: m.firstName }) : lab('showNameOff') }));
    } else if (minor) wrap.appendChild(h('p', { cls: 'membercard__hint', text: lab('teenLink') }));
    return wrap;
  }
  function mountCard(el, opts) {
    el = typeof el === 'string' ? d.querySelector(el) : el;
    if (!el) return null;
    opts = opts || {};
    var api = { el: el, refresh: paint, destroy: destroy };
    function paint() {
      var m = me(), dd = data(opts), mine = list(), c = byId(kit().colorways, dd.colorway) || { bg: '#6A2BFF', fg: '#FFF6EA' };
      var sup = !!dd.supporter;   // 40+: "Supporter" / "Simpatizante", never "Member"
      el.textContent = '';
      var root = h('div', { cls: 'membercard', 'data-membercard': '', 'data-member': m ? (sup ? 'supporter' : 'yes') : 'no', style: { '--mc-bg': c.bg, '--mc-fg': c.fg } });
      // the card itself
      var card = h('div', { cls: 'membercard__card' });
      var head = h('div', { cls: 'membercard__head' }, [
        brandEl(),
        h('span', { cls: 'membercard__kicker', text: C(sup ? 'membercard.supporterKicker' : 'membercard.kicker') })
      ]);
      card.appendChild(head);
      var body = h('div', { cls: 'membercard__body' });
      body.appendChild(h('p', { cls: 'membercard__name', text: dd.name || C('membercard.friend') }));
      var cityName = cityObj(dd.city) ? pick(cityObj(dd.city).name) : '';
      var since = '';
      try { since = new Intl.DateTimeFormat(L() === 'es' ? 'es-US' : 'en-US', { month: 'short', year: 'numeric', timeZone: TZ }).format(new Date(dd.since)); } catch (e) {}
      body.appendChild(h('p', { cls: 'membercard__meta', text: [cityName, C(sup ? 'membercard.supporterSince' : 'membercard.since', { month: since })].filter(Boolean).join(' · ') }));
      var link = linkUrl();
      if (m && link) body.appendChild(h('p', { cls: 'membercard__link' }, [h('code', { translate: 'no', text: YSD.ui && YSD.ui.prettyLink ? YSD.ui.prettyLink(link) : link })]));
      if (YSD.cfg && YSD.cfg('demo', true) !== false) body.appendChild(h('p', { cls: 'membercard__demo' }, [h('span', { cls: 'tag tag--demo', text: C(sup ? 'membercard.supporterWatermark' : 'membercard.watermark') })]));
      card.appendChild(body);
      root.appendChild(card);
      // the invite link, with something to do with it (journeys-07): copy only the link, or send it
      if (m && link) root.appendChild(shareBlock(m, link, sup));
      // weeks + streak (current shown only at 2+; never a countdown)
      var tot = total(), cur = current();
      var wk = h('dl', { cls: 'membercard__weeks' }, [
        h('div', {}, [h('dt', { text: lab('activeWeeks') }), h('dd', { text: String(tot) })]),
        cur >= 2 ? h('div', {}, [h('dt', { text: lab('streak') }), h('dd', { text: String(cur) })]) : null
      ]);
      root.appendChild(wk);
      // squad meter
      var mt = h('div', { cls: 'membercard__meter' });
      root.appendChild(mt);
      meter(mt);
      // sticker book
      var bk = book(), sb = h('section', { cls: 'stickerbook', 'aria-label': lab('heading') });
      sb.appendChild(h('div', { cls: 'stickerbook__head' }, [
        h('h3', { cls: 'stickerbook__title', text: lab('heading') }),
        h('p', { cls: 'stickerbook__count', text: lab('collected', { n: mine.length, total: bk.length }) })
      ]));
      if (!mine.length) sb.appendChild(h('p', { cls: 'stickerbook__empty', text: cp('noStickersYet') }));
      var ul = h('ul', { cls: 'stickerbook__grid' });
      bk.forEach(function (s) { ul.appendChild(stickerEl(s, byId(mine, s.id))); });
      sb.appendChild(ul);
      sb.appendChild(h('p', { cls: 'stickerbook__note', text: lab('civicNote') }));
      root.appendChild(sb);
      // actions
      var acts = h('div', { cls: 'btn-row membercard__actions' });
      if (m && YSD.maker && YSD.brandCards) {
        var save = h('button', { type: 'button', cls: 'btn btn--primary', 'data-membercard-save': '', text: MK(sup ? 'templates.supportercard' : 'templates.membercard') + ' · ' + MK('actions.save') });
        acts.appendChild(save);
      }
      if (YSD.rewind && YSD.rewind.available() && m) acts.appendChild(h('button', { type: 'button', cls: 'btn btn--violet', 'data-rewind-open': '', text: MK('templates.rewind') }));
      if (YSD.cfg && YSD.cfg('demo', true) !== false && mine.length) acts.appendChild(h('button', { type: 'button', cls: 'btn btn--quiet btn--sm', 'data-stickers-reset': '', text: lab('resetDemo') }));
      if (acts.children.length) root.appendChild(acts);
      el.appendChild(root);
    }
    function onClick(e) {
      var t = e.target.closest ? e.target.closest('[data-membercard-save],[data-rewind-open],[data-stickers-reset],[data-mc-copy],[data-mc-share],[data-mc-sms],[data-mc-wa]') : null;
      if (!t || !el.contains(t)) return;
      if (t.hasAttribute('data-mc-copy')) {
        var u = linkUrl();
        (YSD.share && YSD.share.copy ? YSD.share.copy(u) : Promise.resolve(false)).then(function (ok) {
          if (YSD.ui) YSD.ui.toast(ok ? (YSD.t && YSD.t('toast.linkCopied')) || MK('toast.copied') : MK('toast.failed'), { priority: 'high', tone: ok ? null : 'error' });
        });
        return;
      }
      if (t.hasAttribute('data-mc-share')) {
        var sup2 = !!data(opts).supporter, url = linkUrl(), text = shareText(sup2);
        (YSD.share && YSD.share.native ? YSD.share.native({ title: 'Young Dems', text: text, url: url }) : Promise.resolve('failed')).then(function (res) {
          if (!YSD.ui) return;
          if (res === 'copied') YSD.ui.toast(YSD.t && YSD.t('toast.textCopied') || MK('toast.copied'), { priority: 'high' });
          else if (res === 'shared') YSD.ui.toast(MK('toast.ready'), { priority: 'high' });
          else if (res === 'failed') YSD.ui.toast(MK('toast.failed'), { priority: 'high', tone: 'error' });
        });
        return;
      }
      if (t.hasAttribute('data-mc-sms') || t.hasAttribute('data-mc-wa')) return; // plain links (hrefs set on paint)
      if (t.hasAttribute('data-stickers-reset')) { YSD.stickers.reset(); paint(); return; }
      if (t.hasAttribute('data-rewind-open')) { YSD.rewind.open(t); return; }
      if (t.hasAttribute('data-membercard-save')) {
        var dd = data(opts);
        YSD.brandCards.render('membercard', Object.assign({ lang: L() }, dd), { size: 'portrait' }).then(function (cv) {
          return YSD.cards.download(cv, dd.supporter ? 'young-dems-supporter-card.png' : 'young-dems-member-card.png');
        }).then(function (res) {
          if (res === 'downloaded') { act('share-card', { ref: 'membercard' }); if (YSD.ui) YSD.ui.toast(MK('toast.saved')); }
        });
      }
    }
    function onChange() { paint(); }
    function onToggle(e) {
      var t = e.target;
      if (!t || !t.hasAttribute || !t.hasAttribute('data-mc-showname') || !el.contains(t)) return;
      try { if (YSD.members && YSD.members.setShareName) YSD.members.setShareName(!!t.checked); } catch (x) {}
      var focusBack = true;
      paint();
      var again = el.querySelector('[data-mc-showname]'); if (focusBack && again) again.focus();
    }
    function destroy() { el.removeEventListener('click', onClick); el.removeEventListener('change', onToggle); d.removeEventListener('ysd:sticker', onChange); d.removeEventListener('ysd:joined', onChange); el.textContent = ''; }
    el.addEventListener('click', onClick);
    el.addEventListener('change', onToggle);
    d.addEventListener('ysd:sticker', onChange);
    d.addEventListener('ysd:joined', onChange);
    paint();
    return api;
  }
  // ---------------------------------------------------------------- public rules panel (right-wing-rewards-hidden)
  /**
   * YSD.membercard.rulesPanel(container, opts) -> { el, refresh(), destroy() }
   * The pre-join "How stickers work": every rule in plain words, all 15 stickers (locked until collected, each with
   * its public rule), the DEMO perk ladder for organizing only, and "Voting steps never earn stickers or anything
   * else" always visible. Works for visitors and members (collected ones show in colour). Needs the growth slice
   * (or data/levels.js) and data/stickers.js. opts: { heading: 'h2'|'h3' (default 'h2'), id (default
   * 'how-stickers-work'), max (show only the first N stickers, e.g. 3 on home, plus a link to the rest), href (that
   * link, default join.html#how-stickers-work), cta: false (hide "Start your book: join free"), eyebrow: false }.
   */
  function rulesPanel(el, opts) {
    el = typeof el === 'string' ? d.querySelector(el) : el;
    if (!el) return null;
    opts = opts || {};
    var hid = (opts.id || 'how-stickers-work') + '-title';
    function paint() {
      var mine = list(), bk = book(), max = +opts.max || bk.length, es = YSD.lang === 'es' ? 'es/' : '';
      var joinHref = (YSD.root || '') + es + 'join.html#join-form';
      el.textContent = '';
      var sec = h('section', { cls: 'rules', id: opts.id || 'how-stickers-work', 'aria-labelledby': hid, 'data-rules': max < bk.length ? 'teaser' : 'full' });
      var head = h('div', { cls: 'rules__head' });
      if (opts.eyebrow !== false) head.appendChild(h('p', { cls: 'eyebrow rules__eyebrow', text: lab('rulesEyebrow') }));
      head.appendChild(h(opts.heading === 'h3' ? 'h3' : 'h2', { cls: 'rules__title', id: hid, text: lab('rulesTitle') }));
      head.appendChild(h('p', { cls: 'rules__sub', text: lab('rulesSub') }));
      sec.appendChild(head);
      var ul = h('ul', { cls: 'rules__grid' });
      bk.slice(0, max).forEach(function (s) {
        var got = byId(mine, s.id), art = YSD.ui && YSD.ui.sticker ? YSD.ui.sticker(artFor(s)) : null;
        var pic = h('span', { cls: 'rules__art', 'aria-hidden': 'true' });
        if (art && art.svg) pic.innerHTML = art.svg; // trusted: our own data file
        ul.appendChild(h('li', { cls: 'rules__item', 'data-state': got ? 'got' : 'locked', style: { '--ring': 'var(--' + (s.ring || 'celery') + ')' } }, [
          pic,
          h('span', { cls: 'rules__name', text: pick(s.name) }),
          h('span', { cls: 'rules__rule', text: pick(s.unlock) }),
          h('span', { cls: 'rules__state', text: got ? lab('got', { date: '' }).replace(/\s+$/, '') : lab('rulesLocked') }),
          s.perk ? h('span', { cls: 'rules__perk' }, [h('span', { cls: 'tag tag--demo', text: lab('perkDemo') }), ' ', h('span', { text: pick(s.perk) })]) : null
        ]));
      });
      sec.appendChild(ul);
      sec.appendChild(h('p', { cls: 'rules__civic', text: lab('civicNote') }));
      if (max < bk.length) {
        sec.appendChild(h('p', { cls: 'rules__more' }, [h('a', { cls: 'link', href: opts.href || ((YSD.root || '') + es + 'join.html#how-stickers-work'), text: lab('rulesAll') })]));
      } else {
        var perks = bk.filter(function (s) { return s.perk; });
        if (perks.length) {
          var pl = h('ul', { cls: 'rules__perklist' });
          perks.forEach(function (s) { pl.appendChild(h('li', {}, [h('b', { text: pick(s.name) }), h('span', { text: pick(s.perk) })])); });
          sec.appendChild(h('div', { cls: 'rules__perks' }, [h('h3', { cls: 'rules__perks-title', text: lab('rulesPerks') }), pl, h('p', { cls: 'rules__note', text: lab('rulesPerksNote') })]));
        }
        var fair = h('ul', { cls: 'rules__fair-list' });
        (lv().rules || []).forEach(function (r) { fair.appendChild(h('li', { text: pick(r) })); });
        sec.appendChild(h('details', { cls: 'rules__fair' }, [h('summary', { text: lab('rulesFair') }), fair]));
      }
      if (opts.cta !== false && !me()) sec.appendChild(h('p', { cls: 'rules__cta' }, [h('a', { cls: 'btn btn--primary', href: joinHref, text: lab('rulesCta') })]));
      el.appendChild(sec);
    }
    paint();
    d.addEventListener('ysd:sticker', paint);
    d.addEventListener('ysd:joined', paint);
    return { el: el, refresh: paint, destroy: function () { d.removeEventListener('ysd:sticker', paint); d.removeEventListener('ysd:joined', paint); el.textContent = ''; } };
  }
  YSD.memberCard = { mount: mountCard, data: data, rulesPanel: rulesPanel };
  YSD.membercard = YSD.memberCard;   // the contract spelling in the round-1 plan

  // ---------------------------------------------------------------- Seminole Rewind
  function rewindData() {
    return {
      counts: { rsvps: count('rsvp'), cards: count('share-card'), friends: realSquad().length, stickers: list().length },
      stickers: list().map(function (s) { return s.id; })
    };
  }
  function rewindAvailable() { return !!(YSD.brandCards && YSD.brandCards.available('rewind')); }
  function rewindOpen(opener) {
    if (!rewindAvailable() || !YSD.maker) return null;
    var dlg = d.getElementById('ysd-rewind');
    if (!dlg) {
      dlg = h('dialog', { id: 'ysd-rewind', cls: 'sheet', 'aria-labelledby': 'ysd-rewind-title' });
      var inner = h('div', { cls: 'sheet__body' });
      dlg.appendChild(h('div', { cls: 'sheet__head' }, [
        h('h2', { cls: 'sheet__title', id: 'ysd-rewind-title', text: C('rewind.title') }),
        h('button', { type: 'button', cls: 'btn btn--icon btn--quiet sheet__close', 'data-sheet-close': '', 'aria-label': (YSD.t && YSD.t('a11y.close')) || 'Close', text: '×' })
      ]));
      dlg.appendChild(inner);
      d.body.appendChild(dlg);
      YSD.maker.mount(inner, { templates: ['rewind'], template: 'rewind', compact: true, nameOptional: true });
    }
    if (YSD.ui && YSD.ui.sheet) YSD.ui.sheet.open(dlg, { opener: opener }); else if (dlg.showModal) dlg.showModal();
    return dlg;
  }
  YSD.rewind = { available: rewindAvailable, data: rewindData, open: rewindOpen };

  // ---------------------------------------------------------------- automatic hooks
  d.addEventListener('ysd:joined', function () { act('join', { ref: 'join', delay: 2200 }); });   // after the join success lands
  d.addEventListener('ysd:card-share', function (e) { var r = e.detail && e.detail.result; if (r === 'shared' || r === 'downloaded') act('share-card'); });
  d.addEventListener('ysd:clip-added', function (e) { var c = e.detail && (e.detail.clip || e.detail); act('post-clip', { ref: c && c.id ? c.id : 'clip-' + Date.now() }); });
  d.addEventListener('ysd:rsvp', function (e) { var x = e.detail || {}; if (x.status === 'in' && x.eventId) act('rsvp', { ref: x.eventId }); });
  d.addEventListener('ysd:attend', function (e) { var x = e.detail || {}; act('attend', { ref: x.ref || x.eventId, series: x.series, city: x.city, lang: x.lang }); });
  function hookSquad() {
    if (!YSD.members || !YSD.members.onSquad) return;
    var sync = function () { realSquad().forEach(function (m) { act('bring-friend', { ref: m.id }); }); };
    YSD.members.onSquad(sync); sync();
  }
  function hookRsvp() {
    if (YSD.rsvp && typeof YSD.rsvp.on === 'function') {
      YSD.rsvp.on(function (a, b) {
        var x = a && typeof a === 'object' ? a : { eventId: a, status: b && b.status ? b.status : b };
        if (x && x.status === 'in' && x.eventId) act('rsvp', { ref: x.eventId });
      });
    }
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', function () { hookSquad(); hookRsvp(); });
  else { hookSquad(); hookRsvp(); }
})(window, document);
