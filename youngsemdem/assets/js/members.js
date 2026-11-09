/*!
 * Young Seminole Democrats: membership, referral codes and squads.  YSD.members
 *
 *   validate(profile)      -> { ok, errors: {field: code}, warnings: {field: code}, clean }
 *   join(profile)          -> member { id, refCode, referredBy, firstName, ..., joinedAt, demo }
 *                             (synchronous; stored locally at once). member.submitted (non-enumerable)
 *                             is a Promise<{ ok, mode, status?, reason? }> for the network submit.
 *                             Throws an Error with code 'YSD_INVALID' and .errors when invalid.
 *   current()              -> my member record, or null
 *   referredBy()           -> referral code that brought me (frozen at join), or the captured one
 *   squad(opts)            -> [{ id, name, firstName, joinedAt, demo, simulated, source }] people
 *                             who joined with my refCode: local + remote cache + (demo) simulated
 *   refreshSquad()         -> Promise<squad> (production: GET integrations.squadEndpoint?ref=CODE)
 *   onSquad(cb)            -> unsubscribe; cb(squad, added) when the squad grows
 *   submit(member)         -> Promise; the production seam (formEndpoint, else Action Network proxy)
 *   retry()                -> re-send an unsynced join (runs on load and on 'online')
 *   makeRefCode(profile)   -> a new readable code (always the random style when profile.age < 18)
 *   forget()               -> remove my member data, squad cache and captured ref from this browser
 *
 * Demo mode (YSD_CONFIG.demo): nothing leaves the browser; simulated squad members appear on a
 * fixed schedule after joining, each flagged { demo: true, simulated: true } so pages can label
 * them. Production: simulated members never appear.
 *
 * Store keys: 'member' (me), 'joins' (local join log), 'squad:remote' (cached server squad).
 * DOM events: ysd:joined, ysd:member-submitted, ysd:member-submit-failed, ysd:squad.
 */
(function (w) {
  'use strict';
  var YSD = w.YSD = w.YSD || {};
  function cfg(p, fb) { return typeof YSD.cfg === 'function' ? YSD.cfg(p, fb) : fb; }
  function emit(n, d) { if (typeof YSD.emit === 'function') YSD.emit(n, d); }
  function track(e, p) { try { if (typeof YSD.track === 'function') YSD.track(e, p); } catch (x) {} }
  function log() { if (typeof YSD.log === 'function') YSD.log.apply(null, arguments); }
  function isDemo() { return cfg('demo', true) !== false; }

  // Shared in-memory fallback (one object for every module) when assets/js/store.js is missing.
  var mem = YSD._mem = YSD._mem || {};
  function sget(k, fb) {
    try { if (YSD.store) return YSD.store.get(k, fb); } catch (e) {}
    return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : fb;
  }
  function sset(k, v) {
    try { if (YSD.store) { YSD.store.set(k, v); return; } } catch (e) {}
    mem[k] = v;
  }
  function sremove(k) {
    try { if (YSD.store) { YSD.store.remove(k); return; } } catch (e) {}
    delete mem[k];
  }
  function clone(v) { try { return JSON.parse(JSON.stringify(v)); } catch (e) { return v; } }
  function uid(p) {
    if (YSD.uid) return YSD.uid(p);
    return (p ? p + '_' : '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  // ------------------------------------------------------------------ referral codes
  // No vowels (codes cannot spell words) and no look-alikes (0/O, 1/I/L).
  var SAFE = 'BCDFGHJKMNPQRSTVWXZ23456789';
  function randChars(n) {
    var out = '', bytes = null;
    try {
      var c = w.crypto || w.msCrypto;
      if (c && c.getRandomValues) { bytes = new Uint8Array(n * 2); c.getRandomValues(bytes); }
    } catch (e) { bytes = null; }
    for (var i = 0; i < n; i++) {
      var r = bytes ? ((bytes[i * 2] << 8) | bytes[i * 2 + 1]) : Math.floor(Math.random() * 65536);
      out += SAFE.charAt(r % SAFE.length);
    }
    return out;
  }
  function asciiLetters(s) {
    s = String(s || '');
    try { s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {}
    return s.toUpperCase().replace(/[^A-Z]/g, '');
  }
  function knownCodes() {
    var out = {}, j = sget('joins', []);
    if (Array.isArray(j)) for (var i = 0; i < j.length; i++) if (j[i] && j[i].refCode) out[j[i].refCode] = 1;
    return out;
  }
  /** Known to be under 18 (age, or birthYear). Unknown age is not treated as a minor. */
  function isMinor(profile) {
    if (!profile) return false;
    var age = profile.age != null && profile.age !== '' ? parseInt(profile.age, 10) : NaN;
    if (isNaN(age) && profile.birthYear) age = new Date().getFullYear() - parseInt(profile.birthYear, 10);
    return !isNaN(age) && age < 18;
  }
  /**
   * Readable referral code, e.g. KIRA7QX ('name' style) or B7KQ2M ('random'). Members under 18
   * always get the random style, whatever members.refCodeStyle says, so a teen's first name never
   * appears in links they share.
   */
  function makeRefCode(profile) {
    var style = isMinor(profile) ? 'random' : cfg('members.refCodeStyle', 'name');
    var prefix = style === 'name' ? asciiLetters(profile && (profile.firstName || profile.name)).slice(0, +cfg('members.refNameMax', 5) || 5) : '';
    if (prefix.length < 2) prefix = '';
    var n = prefix ? Math.max(2, +cfg('members.refRandom', 3) || 3) : 6;
    var known = knownCodes(), code = '';
    for (var tries = 0; tries < 20; tries++) {
      code = prefix + randChars(n);
      if (!known[code]) break;
    }
    return code;
  }

  // ------------------------------------------------------------------ validation
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var RESERVED = { id: 1, refCode: 1, referredBy: 1, joinedAt: 1, updatedAt: 1, demo: 1, synced: 1, syncedAt: 1, _hp: 1, 'bot-field': 1, submitted: 1 };
  function str(v, max) { return String(v == null ? '' : v).replace(/^\s+|\s+$/g, '').slice(0, max || 200); }
  function normPhone(p) {
    var d = String(p || '').replace(/\D/g, '');
    if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1);
    return d.length === 10 ? '+1' + d : '';
  }
  /**
   * Check and normalise a join profile. Accepts firstName/lastName (or name, or
   * first_name/given_name), email, phone, zip, age or birthYear, interests [], emailOptIn,
   * smsOptIn, plus any other string/number/boolean fields (kept as-is, e.g. from the design's form).
   * Errors: firstName 'required'; email 'required' (when no phone) | 'invalid'; phone 'invalid';
   * zip 'invalid'; age 'too_young' | 'over_age_cap' (only with members.enforceAgeCap).
   * Warnings: age 'over_age_cap'; zip 'outside_county' (only when members.countyZips is set).
   */
  function validate(profile) {
    var p = profile || {}, errors = {}, warnings = {}, c = {};
    var first = str(p.firstName || p.first_name || p.given_name, 60);
    var last = str(p.lastName || p.last_name || p.family_name, 60);
    if (!first && p.name) {
      var parts = str(p.name, 120).split(/\s+/);
      first = parts.shift() || '';
      if (!last) last = parts.join(' ');
    }
    if (!first) errors.firstName = 'required';
    c.firstName = first;
    if (last) c.lastName = last;

    var email = str(p.email, 254).toLowerCase();
    var phoneRaw = str(p.phone, 40);
    var phone = normPhone(phoneRaw);
    if (email && !EMAIL_RE.test(email)) errors.email = 'invalid';
    if (phoneRaw && !phone) errors.phone = 'invalid';
    if (!email && !phoneRaw) errors.email = 'required';
    if (email) c.email = email;
    if (phone) c.phone = phone;

    var zip = str(p.zip || p.postal_code || p.zipCode, 10);
    if (zip) {
      if (!/^\d{5}(-\d{4})?$/.test(zip)) errors.zip = 'invalid';
      else {
        c.zip = zip;
        var zips = cfg('members.countyZips', []) || [];
        if (zips.length && zips.indexOf(zip.slice(0, 5)) < 0) warnings.zip = 'outside_county';
      }
    }

    var age = p.age != null && p.age !== '' ? parseInt(p.age, 10) : NaN;
    if (isNaN(age) && p.birthYear) age = new Date().getFullYear() - parseInt(p.birthYear, 10);
    if (!isNaN(age)) {
      c.age = age;
      var minAge = +cfg('org.minAge', 13) || 0, cap = +cfg('org.ageCap', 40) || 0;
      if (minAge && age < minAge) errors.age = 'too_young';
      else if (cap && age > cap) {
        if (cfg('members.enforceAgeCap', false)) errors.age = 'over_age_cap';
        else warnings.age = 'over_age_cap';
      }
    }

    if (Array.isArray(p.interests)) c.interests = p.interests.slice(0, 30).map(function (x) { return str(x, 60); }).filter(function (x) { return x; });
    if (p.emailOptIn !== undefined) c.emailOptIn = !!p.emailOptIn;
    if (p.smsOptIn !== undefined) c.smsOptIn = !!p.smsOptIn;

    var skip = { firstName: 1, first_name: 1, given_name: 1, lastName: 1, last_name: 1, family_name: 1, name: 1, email: 1, phone: 1,
      zip: 1, postal_code: 1, zipCode: 1, age: 1, birthYear: 1, interests: 1, emailOptIn: 1, smsOptIn: 1 };
    for (var k in p) {
      if (!Object.prototype.hasOwnProperty.call(p, k) || skip[k] || RESERVED[k]) continue;
      var v = p[k];
      if (typeof v === 'string') c[k] = str(v, 500);
      else if (typeof v === 'number' && isFinite(v)) c[k] = v;
      else if (typeof v === 'boolean') c[k] = v;
    }
    var ok = true;
    for (k in errors) { ok = false; break; }
    return { ok: ok, errors: errors, warnings: warnings, clean: c };
  }

  // ------------------------------------------------------------------ me
  function current() { var m = sget('member', null); return m && m.id ? m : null; }
  function pendingRef() {
    try { if (YSD.share && typeof YSD.share.ref === 'function') return YSD.share.ref(); } catch (e) {}
    var r = sget('ref', null);
    if (!r || !r.code) return null;
    var days = +cfg('share.attributionDays', 30) || 30;
    return r.ts && Date.now() - r.ts > days * 86400000 ? null : String(r.code).toUpperCase();
  }
  function referredBy() {
    var m = current();
    if (m) return m.referredBy || null;
    return pendingRef();
  }
  function currentPath() { try { return String(w.location.pathname || ''); } catch (e) { return ''; } }
  function withSubmitted(member, promise) {
    var out = clone(member);
    try { Object.defineProperty(out, 'submitted', { value: promise, enumerable: false }); } catch (e) {}
    return out;
  }

  /** Create or update my membership. See header for the return value. */
  function join(profile) {
    profile = profile || {};
    // Honeypot: a hidden field bots fill in. Pretend success, store nothing, send nothing.
    if (str(profile._hp) || str(profile['bot-field'])) {
      log('members: honeypot filled; ignoring join');
      var fake = { id: uid('m'), refCode: randChars(6), referredBy: null, firstName: str(profile.firstName, 60), joinedAt: Date.now(), demo: isDemo() };
      return withSubmitted(fake, Promise.resolve({ ok: true, mode: 'ignored' }));
    }
    var v = validate(profile);
    if (!v.ok) {
      var err = new Error('YSD.members.join: invalid profile');
      err.code = 'YSD_INVALID';
      err.errors = v.errors;
      err.warnings = v.warnings;
      throw err;
    }
    var existing = current(), now = Date.now(), k;
    var member = existing ? clone(existing) : {
      id: uid('m'),
      refCode: makeRefCode(v.clean),
      referredBy: pendingRef(),
      joinedAt: now
    };
    for (k in v.clean) member[k] = v.clean[k];
    member.updatedAt = now;
    member.demo = isDemo();
    member.synced = false;
    if (!existing) {
      var utm = {};
      try { utm = YSD.share && YSD.share.utm ? YSD.share.utm() : (sget('utm', {}) || {}); } catch (e) {}
      member.utm = utm;
      member.source = currentPath();
    }
    member.warnings = v.warnings;
    sset('member', member);
    if (!existing) {
      try {
        var entry = { id: member.id, refCode: member.refCode, referredBy: member.referredBy || null, firstName: member.firstName,
          lastInitial: member.lastName ? member.lastName.charAt(0).toUpperCase() : '', joinedAt: member.joinedAt, demo: member.demo };
        if (YSD.store) YSD.store.push('joins', entry, { max: 200 });
        else { var j = sget('joins', []); j.push(entry); sset('joins', j); }
      } catch (e) {}
      try { if (YSD.counters) YSD.counters.bump('members'); } catch (e) {}
      track('join', { referred: !!member.referredBy, demo: member.demo });
    } else track('join_update', {});
    emit('joined', { member: clone(member), isNew: !existing });
    var p = submit(member);
    scheduleSquad();
    return withSubmitted(current() || member, p);
  }

  // ------------------------------------------------------------------ submit seam
  function formPayload(m) {
    var keys = ['id', 'refCode', 'referredBy', 'firstName', 'lastName', 'email', 'phone', 'zip', 'age', 'interests',
      'emailOptIn', 'smsOptIn', 'joinedAt', 'source'];
    var out = {}, k;
    for (var i = 0; i < keys.length; i++) if (m[keys[i]] !== undefined && m[keys[i]] !== null) out[keys[i]] = m[keys[i]];
    for (k in m) {   // extra form fields the design added
      if (out[k] !== undefined || RESERVED[k] || k === 'warnings' || k === 'utm' || k === 'demo') continue;
      if (typeof m[k] !== 'object') out[k] = m[k];
    }
    var utm = m.utm || {};
    for (k in utm) if (/^utm_/.test(k)) out[k] = utm[k];
    return out;
  }
  function anPayload(m) {
    var person = { given_name: m.firstName || '' };
    if (m.lastName) person.family_name = m.lastName;
    if (m.email) person.email_addresses = [{ address: m.email, status: m.emailOptIn === false ? 'unsubscribed' : 'subscribed' }];
    // Mobile numbers are only subscribed with explicit SMS consent.
    if (m.phone) person.phone_numbers = [{ number: m.phone, status: m.smsOptIn ? 'subscribed' : 'unsubscribed' }];
    if (m.zip) person.postal_addresses = [{ postal_code: m.zip, region: cfg('org.stateCode', 'FL'), country: 'US' }];
    person.custom_fields = { ysd_ref_code: m.refCode, ysd_referred_by: m.referredBy || '' };
    var utm = m.utm || {};
    if (utm.utm_source) person.custom_fields.ysd_utm_source = utm.utm_source;
    if (utm.utm_campaign) person.custom_fields.ysd_utm_campaign = utm.utm_campaign;
    return { person: person, add_tags: (cfg('integrations.actionNetwork.tags', []) || []).slice() };
  }
  function encodeForm(obj) {
    var parts = [];
    for (var k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      var v = obj[k];
      if (Array.isArray(v)) v = v.join(', ');
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v == null ? '' : String(v)));
    }
    return parts.join('&');
  }
  function markSynced(mode, extra) {
    var m = current();
    if (!m) return;
    m.synced = true; m.syncedAt = Date.now(); m.syncMode = mode;
    if (extra && extra.refCode && /^[A-Za-z0-9_-]{2,32}$/.test(extra.refCode)) m.refCode = String(extra.refCode).toUpperCase();
    if (extra && extra.id) m.serverId = String(extra.id);
    if (mode !== 'demo' && !cfg('members.keepContactLocally', false)) { delete m.email; delete m.phone; delete m.zip; }
    sset('member', m);
  }

  var inflight = null;
  /**
   * Send the join to the configured backend. Resolves (never rejects) to
   *   { ok: true, mode: 'demo' }                         demo mode: nothing sent
   *   { ok: true, mode: 'form'|'actionnetwork', status } accepted (2xx)
   *   { ok: false, mode, status|reason }                 failed; kept unsynced and retried later
   *   { ok: false, mode: 'none', fallbackUrl }           nothing configured (links.actionNetwork, if any)
   * formEndpoint wins over integrations.actionNetwork.endpoint. A JSON response may return
   * { refCode, id } to replace the local refCode (server-side uniqueness).
   */
  function submit(member) {
    member = member || current();
    if (!member) return Promise.resolve({ ok: false, mode: 'none', reason: 'no-member' });
    if (isDemo()) { markSynced('demo'); return Promise.resolve({ ok: true, mode: 'demo' }); }
    var formEp = cfg('integrations.formEndpoint', ''), anEp = cfg('integrations.actionNetwork.endpoint', '');
    if (!formEp && !anEp) return Promise.resolve({ ok: false, mode: 'none', fallbackUrl: cfg('links.actionNetwork', '') || '' });
    var mode = formEp ? 'form' : 'actionnetwork';
    if (typeof w.fetch !== 'function') return Promise.resolve({ ok: false, mode: mode, reason: 'no-fetch' });
    if (inflight) return inflight;
    var body, headers = { Accept: 'application/json' };
    if (mode === 'form' && cfg('integrations.formEncoding', 'json') === 'form') {
      var f = formPayload(member);
      f['form-name'] = cfg('integrations.formName', 'join');
      body = encodeForm(f);
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else {
      body = JSON.stringify(mode === 'form' ? formPayload(member) : anPayload(member));
      headers['Content-Type'] = 'application/json';
    }
    inflight = w.fetch(mode === 'form' ? formEp : anEp, { method: 'POST', headers: headers, body: body, credentials: 'same-origin' })
      .then(function (res) {
        if (!res.ok) throw { status: res.status };
        var ct = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
        return (ct.indexOf('json') >= 0 ? res.json().then(null, function () { return {}; }) : Promise.resolve({})).then(function (j) {
          markSynced(mode, j || {});
          var r = { ok: true, mode: mode, status: res.status };
          emit('member-submitted', r);
          track('join_submitted', { mode: mode });
          return r;
        });
      })
      .then(null, function (err) {
        var r = { ok: false, mode: mode, status: err && err.status || 0, reason: err && err.status ? 'http' : 'network' };
        emit('member-submit-failed', r);
        log('members: submit failed', r);
        return r;
      })
      .then(function (r) { inflight = null; return r; });
    return inflight;
  }
  /** Re-send an unsynced production join. */
  function retry() {
    var m = current();
    if (!m || m.synced || isDemo()) return Promise.resolve(null);
    return submit(m);
  }

  // ------------------------------------------------------------------ squad
  // PLACEHOLDER demo names (first name + last initial), not real people.
  var SIM_NAMES = ['Maya R.', 'Jordan T.', 'Ari P.', 'Destiny W.', 'Luis M.', 'Priya S.', 'Marcus J.', 'Sofia G.',
    'Tyler B.', 'Jasmine L.', 'Eli K.', 'Camila D.', 'Noah F.', 'Zoe H.', 'Andre C.', 'Leah N.'];
  // Seconds after my join at which simulated friends "join".
  var SIM_SCHEDULE = [45, 160, 600, 2400, 7200, 21600, 64800, 172800, 345600, 604800];
  function seeded(seedStr) {
    var h = 2166136261;
    for (var i = 0; i < seedStr.length; i++) { h ^= seedStr.charCodeAt(i); h = Math.imul ? Math.imul(h, 16777619) >>> 0 : (h * 16777619) >>> 0; }
    return function () {   // mulberry32
      h = (h + 0x6D2B79F5) >>> 0;
      var t = h;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function simEnabled() { return isDemo() && cfg('features.demoSquadGrowth', true) !== false && cfg('features.squad', true) !== false; }
  function simulated(me, now) {
    if (!simEnabled() || !me || !me.refCode) return [];
    var max = Math.min(SIM_SCHEDULE.length, Math.max(0, +cfg('members.demoSquadMax', 6) || 0));
    var rnd = seeded(me.refCode + '|' + me.joinedAt);
    var names = SIM_NAMES.slice();
    for (var i = names.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)); var t = names[i]; names[i] = names[j]; names[j] = t; }
    var out = [];
    for (var n = 0; n < max; n++) {
      var at = me.joinedAt + Math.round(SIM_SCHEDULE[n] * (0.8 + rnd() * 0.4)) * 1000;
      if (at > now) break;
      out.push({ id: 'sim_' + me.refCode + '_' + n, name: names[n], firstName: names[n].split(' ')[0], joinedAt: at,
        referredBy: me.refCode, demo: true, simulated: true, source: 'demo' });
    }
    return out;
  }
  function nextSimAt(me, now) {
    if (!simEnabled() || !me) return null;
    var have = simulated(me, now).length;
    var max = Math.min(SIM_SCHEDULE.length, +cfg('members.demoSquadMax', 6) || 0);
    if (have >= max) return null;
    var lo = now, hi = me.joinedAt + SIM_SCHEDULE[have] * 1200 + 1000;
    if (simulated(me, hi).length <= have) return null;
    while (hi - lo > 500) { var mid = Math.floor((lo + hi) / 2); if (simulated(me, mid).length > have) hi = mid; else lo = mid; }
    return hi;
  }
  /** My squad, oldest first. opts = { now } (for tests/time travel). */
  function squad(opts) {
    var me = current();
    if (!me) return [];
    var now = opts && opts.now ? +opts.now : Date.now();
    var byId = {}, out = [], i;
    var joins = sget('joins', []);
    if (Array.isArray(joins)) {
      for (i = 0; i < joins.length; i++) {
        var j = joins[i];
        if (!j || j.id === me.id || !j.referredBy || String(j.referredBy).toUpperCase() !== me.refCode) continue;
        byId[j.id] = { id: j.id, name: j.firstName + (j.lastInitial ? ' ' + j.lastInitial + '.' : ''), firstName: j.firstName,
          joinedAt: j.joinedAt, referredBy: me.refCode, demo: !!j.demo, simulated: false, source: 'local' };
      }
    }
    var remote = sget('squad:remote', null);
    if (remote && remote.code === me.refCode && Array.isArray(remote.squad)) {
      for (i = 0; i < remote.squad.length; i++) {
        var r = remote.squad[i] || {};
        var rid = r.id ? String(r.id) : 'remote_' + i + '_' + (r.joinedAt || '');
        byId[rid] = { id: rid, name: str(r.name, 80), firstName: str(r.firstName || String(r.name || '').split(' ')[0], 60),
          joinedAt: typeof r.joinedAt === 'number' ? r.joinedAt : Date.parse(r.joinedAt) || 0, referredBy: me.refCode,
          demo: false, simulated: false, source: 'remote' };
      }
    }
    var sims = simulated(me, now);
    for (i = 0; i < sims.length; i++) byId[sims[i].id] = sims[i];
    for (var k in byId) out.push(byId[k]);
    out.sort(function (a, b) { return a.joinedAt - b.joinedAt; });
    return out;
  }

  var squadCbs = [], squadTimer = null, lastSquadIds = null;
  function notifySquad() {
    var list = squad();
    var ids = list.map(function (x) { return x.id; }), added = [];
    var prev = lastSquadIds || {};
    for (var i = 0; i < list.length; i++) if (!prev[list[i].id]) added.push(list[i]);
    lastSquadIds = {};
    for (i = 0; i < ids.length; i++) lastSquadIds[ids[i]] = 1;
    if (!added.length) return;
    for (i = 0; i < squadCbs.length; i++) { try { squadCbs[i](list, added); } catch (e) { log('squad listener error', e); } }
    emit('squad', { squad: list, added: added });
  }
  function onSquad(cb) {
    if (typeof cb !== 'function') return function () {};
    squadCbs.push(cb);
    return function () { var i = squadCbs.indexOf(cb); if (i >= 0) squadCbs.splice(i, 1); };
  }
  /** While the page is open, wake up when the next simulated member is due (within an hour). */
  function scheduleSquad() {
    if (squadTimer) { clearTimeout(squadTimer); squadTimer = null; }
    var me = current();
    if (!me) return;
    if (lastSquadIds === null) { lastSquadIds = {}; squad().forEach(function (x) { lastSquadIds[x.id] = 1; }); }
    var at = nextSimAt(me, Date.now());
    if (at === null) return;
    var delay = at - Date.now() + 50;
    if (delay > 3600000) return;
    squadTimer = setTimeout(function () { squadTimer = null; notifySquad(); scheduleSquad(); }, Math.max(0, delay));
  }
  /** Production: fetch my squad from integrations.squadEndpoint. Demo: resolves to squad(). */
  function refreshSquad() {
    var me = current(), ep = cfg('integrations.squadEndpoint', '');
    if (!me || isDemo() || !ep || typeof w.fetch !== 'function') { notifySquad(); return Promise.resolve(squad()); }
    var sep = ep.indexOf('?') >= 0 ? '&' : '?';
    return w.fetch(ep + sep + 'ref=' + encodeURIComponent(me.refCode), { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && Array.isArray(j.squad)) sset('squad:remote', { code: me.refCode, ts: Date.now(), squad: j.squad.slice(0, 500) });
        notifySquad();
        return squad();
      }, function () { return squad(); });
  }

  /** Remove my member record, local join log, squad cache and captured ref/utm from this browser. */
  function forget() {
    ['member', 'joins', 'squad:remote', 'ref', 'utm', 'utm:first'].forEach(sremove);
    if (squadTimer) { clearTimeout(squadTimer); squadTimer = null; }
    lastSquadIds = null;
    emit('forgot', {});
    track('forget', {});
  }

  YSD.members = {
    validate: validate,
    join: join,
    current: current,
    isMember: function () { return !!current(); },
    referredBy: referredBy,
    squad: squad,
    refreshSquad: refreshSquad,
    onSquad: onSquad,
    submit: submit,
    retry: retry,
    makeRefCode: makeRefCode,
    forget: forget,
    /** Share URL carrying my code (YSD.share.url wrapper; '' when share.js is missing). */
    shareUrl: function (path, params) { return YSD.share ? YSD.share.url(path, params) : ''; },
    _simSchedule: SIM_SCHEDULE
  };

  // Boot: squad wake-ups, production retry/refresh.
  try {
    setTimeout(function () {
      scheduleSquad();
      if (!isDemo()) { retry(); if (current()) refreshSquad(); }
    }, 0);
    if (w.addEventListener) w.addEventListener('online', function () { retry(); });
    if (YSD.store && YSD.store.on) {
      YSD.store.on('member', function (value, info) { if (info && info.source === 'remote') { lastSquadIds = null; scheduleSquad(); } });
    }
  } catch (e) {}
})(typeof window !== 'undefined' ? window : this);
