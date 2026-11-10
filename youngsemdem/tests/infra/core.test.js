#!/usr/bin/env node
/*
 * Core infrastructure tests: config, store/db/counters, share, cal, cards, members, track.
 *
 *   node tests/infra/core.test.js            all tests (Node sandbox + headless Chromium)
 *   node tests/infra/core.test.js --node     Node sandbox tests only (no browser)
 *
 * Needs Node 22; the browser part needs Playwright (require('playwright')) with Chromium.
 * Serves the site from a throwaway local HTTP server and also loads it over file://.
 * Exits 1 on any failure.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const vm = require('vm');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const CORE = [
  'assets/js/config.js', 'assets/js/store.js', 'data/counters.js', 'assets/js/track.js',
  'assets/js/share.js', 'assets/js/cal.js', 'assets/js/cards.js', 'assets/js/members.js'
];
const OWNED = CORE.concat([]);
const NODE_ONLY = process.argv.includes('--node');

let passed = 0, failed = 0;
const failures = [];
function ok(cond, name, detail) {
  if (cond) { passed++; return true; }
  failed++;
  failures.push(name + (detail !== undefined ? '  ->  ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''));
  return false;
}
function eq(a, b, name) { return ok(a === b, name, { got: a, want: b }); }
async function section(name, fn) {
  const before = failed;
  try { await fn(); } catch (e) { failed++; failures.push(name + ' threw: ' + (e && e.stack || e)); }
  console.log((failed === before ? 'ok   ' : 'FAIL ') + name);
}

// ------------------------------------------------------------------ Node sandbox
function sandbox(opts) {
  opts = opts || {};
  const href = opts.href || 'https://example.test/index.html';
  const u = new URL(href);
  const win = {
    console: opts.quiet === false ? console : { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, Date, Math, JSON, URL, Blob, Promise, Uint8Array, TextEncoder,
    location: { search: u.search, href: u.href, pathname: u.pathname, hostname: u.hostname, protocol: u.protocol, origin: u.origin },
    ...(opts.globals || {})
  };
  win.window = win;
  if (opts.preConfig) win.YSD_CONFIG = opts.preConfig;
  const ctx = vm.createContext(win);
  for (const f of (opts.files || CORE)) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  return win;
}

function unfold(t) { return t.replace(/\r\n[ \t]/g, ''); }

async function nodeTests() {
  await section('node: modules load with no DOM, storage, navigator or IndexedDB', async () => {
    const w = sandbox();
    for (const m of ['store', 'db', 'counters', 'share', 'cal', 'cards', 'members', 'track']) ok(!!w.YSD[m], 'YSD.' + m + ' exists');
    eq(typeof w.YSD.track, 'function', 'YSD.track is a function');
    eq(w.YSD.store.backend, 'memory', 'store falls back to memory');
    eq(await w.YSD.db.ready(), 'memory', 'db falls back to memory');
    w.YSD.counters.stopLive();
  });

  await section('node: config schema', async () => {
    const w = sandbox();
    const c = w.YSD_CONFIG;
    eq(c.demo, true, 'demo is true');
    // Org identity (name, handle, ages) is the lead's call and changes with sign-off, so check the
    // shape here, not the values (config.js now points at YDSC: youngsemdems, ages 14 to 39).
    ok(Number.isInteger(c.org.ageCap) && c.org.ageCap >= 18 && c.org.ageCap <= 40, 'org.ageCap is an age cap', c.org.ageCap);
    ok(Number.isInteger(c.org.minAge) && c.org.minAge >= 13 && c.org.minAge < c.org.ageCap, 'org.minAge >= 13 (COPPA) and below the cap', c.org.minAge);
    ok(/^[a-z0-9_.]{3,30}$/i.test(c.org.handle), 'org.handle is a bare handle (no @)', c.org.handle);
    for (const k of ['name', 'short', 'handle', 'county', 'tagline']) ok(typeof c.org[k] === 'string' && c.org[k], 'org.' + k);
    eq(c.site.url, '', "site.url '' (use location)");
    ok(Array.isArray(c.site.locales), 'site.locales array');
    for (const k of ['register', 'checkRegistration', 'countyElections', 'voteByMail', 'pollingPlace', 'earlyVoting']) ok(/^https:\/\//.test(c.links.vote[k]), 'links.vote.' + k + ' is https');
    for (const k of ['actionNetwork', 'mobilize']) eq(c.links[k], '', 'links.' + k + ' empty placeholder');
    ok(c.links.actblue === '' || /^https:\/\/secure\.actblue\.com\/donate\/[\w-]+$/.test(c.links.actblue), "links.actblue is '' or an ActBlue form URL", c.links.actblue);
    ok('formEndpoint' in c.integrations && 'videoUploadEndpoint' in c.integrations && 'analytics' in c.integrations, 'integrations keys');
    ok(typeof c.legal.paidFor === 'string' && /PLACEHOLDER/.test(c.legal.paidFor), 'legal.paidFor placeholder');
    ok('privacyEmail' in c.legal, 'legal.privacyEmail');
    ok(/^#[0-9a-f]{6}$/i.test(c.theme.brand), 'theme fallback hex');
    ok(c.features && typeof c.features === 'object', 'features flags');
    ok(!('askEndpoint' in c.integrations) && !('ask' in c.features), 'no assistant config keys');
    const w2 = sandbox({ preConfig: { demo: false, site: { url: 'https://ysd.example' }, org: { tagline: 'T' } } });
    eq(w2.YSD_CONFIG.demo, false, 'pre-set YSD_CONFIG overrides demo');
    eq(w2.YSD_CONFIG.org.name, c.org.name, 'deep merge keeps defaults');
    eq(w2.YSD_CONFIG.org.tagline, 'T', 'deep merge applies override');
    eq(w2.YSD.cfg('a.b.c', 'fb'), 'fb', 'cfg fallback');
    w.YSD.counters.stopLive(); w2.YSD.counters.stopLive();
  });

  await section('node: YSD.fill fills {link}, {url} and other placeholders', async () => {
    const w = sandbox();
    const f = w.YSD.fill;
    eq(typeof f, 'function', 'YSD.fill exists');
    eq(f('Join me: {link}', { link: 'https://a.example/?ref=X' }), 'Join me: https://a.example/?ref=X', '{link} filled');
    eq(f('Set yours: {url}', { link: 'L' }), 'Set yours: L', '{url} gets vars.link');
    eq(f('{link} / {url}', { url: 'U' }), 'U / U', '{link} falls back to vars.url');
    eq(f('{link}', { link: 'L', url: 'U' }), 'L', 'vars.link wins over vars.url');
    eq(f('{name} got {n} XP. {link}', { name: 'Maya', n: 0, link: 'L' }), 'Maya got 0 XP. L', 'other keys filled (0 kept)');
    eq(f('Hi {name} from {city}', { name: 'Ana' }), 'Hi Ana from {city}', 'missing value left as-is');
    eq(f('{constructor} {toString}', {}), '{constructor} {toString}', 'prototype keys ignored');
    eq(f(null, { link: 'L' }), '', 'null template gives an empty string');
    eq(f('Plain {link}'), 'Plain {link}', 'no vars leaves the template unchanged');
    w.YSD.counters.stopLive();
  });

  await section('node: store API (memory backend)', async () => {
    const w = sandbox();
    const s = w.YSD.store;
    const seen = [];
    const off = s.on('k', (v, info) => seen.push([v, info.source]));
    s.set('k', { a: 1 });
    eq(s.get('k').a, 1, 'get after set');
    eq(s.get('missing', 'fb'), 'fb', 'get fallback');
    eq(s.update('n', (v) => (v || 0) + 2), 2, 'update returns next');
    eq(s.update('n', (v) => v + 3), 5, 'update reads previous');
    s.push('list', { x: 1 }); s.push('list', { x: 2 });
    eq(s.list('list').length, 2, 'push/list');
    ok(!!s.list('list')[0].id && !!s.list('list')[0].ts, 'push adds id and ts');
    s.remove('k');
    eq(s.get('k', null), null, 'remove');
    eq(seen.length, 2, 'on fired for set and remove');
    eq(seen[0][1], 'local', 'listener source local');
    off(); s.set('k', 1);
    eq(seen.length, 2, 'unsubscribe works');
    // adapter
    const saved = [];
    await s.useAdapter({ load: () => Promise.resolve({ fromServer: 7 }), save: (k, v) => { saved.push([k, v]); }, match: (k) => k !== 'local-only' });
    eq(s.get('fromServer'), 7, 'adapter load hydrates');
    s.set('synced', 1); s.set('local-only', 1);
    eq(saved.length, 1, 'adapter mirrors matching keys only');
    w.YSD.counters.stopLive();
  });

  await section('node: db memory fallback', async () => {
    const w = sandbox();
    const db = w.YSD.db;
    await db.put('b', 'one', { v: 1 });
    await db.put('b', 'two', new Blob(['hello']));
    eq((await db.get('b', 'one')).v, 1, 'get value');
    eq((await db.all('b')).length, 2, 'all');
    await db.del('b', 'one');
    eq(await db.get('b', 'one'), null, 'del');
    w.YSD.counters.stopLive();
  });

  await section('node: counters seeded from demo baselines', async () => {
    const w = sandbox();
    const c = w.YSD.counters;
    const base = c.get('members');
    ok(base >= 214, 'members baseline >= data base', base);
    const got = [];
    c.on('members', (v) => got.push(v));
    eq(c.bump('members'), base + 1, 'bump default 1');
    eq(c.bump('members', 5), base + 6, 'bump n');
    eq(got.length, 2, 'on fires on bump');
    eq(c.get('nonexistent'), 0, 'unknown counter is 0');
    eq(c.format(12500), '12.5K', 'compact format');
    const p = sandbox({ preConfig: { demo: false } });
    eq(p.YSD.counters.get('members'), 0, 'demo baselines never show in production');
    w.YSD.counters.stopLive(); p.YSD.counters.stopLive();
  });

  await section('node: cal ICS is RFC 5545-shaped', async () => {
    const w = sandbox();
    const cal = w.YSD.cal;
    const ev = {
      id: 'debrief-2026', title: 'Debrief, pizza; and "what\'s next" \\ planning',
      start: '2026-11-14T10:00:00-05:00', end: '2026-11-14T12:30:00-05:00',
      location: 'Library', address: '150 N Palmetto Ave, Sanford, FL',
      description: 'Line one\nLine two: ' + 'émoji 🎉 long text '.repeat(12), url: 'https://example.org/e?a=1,b=2', alarm: 60
    };
    const t = cal.text(ev, { now: Date.UTC(2026, 10, 9, 17, 0, 0) });
    ok(t.endsWith('\r\n'), 'ends with CRLF');
    ok(!/[^\r]\n/.test(t), 'every LF is part of CRLF');
    const lines = t.split('\r\n').slice(0, -1);
    const dec = new TextDecoder('utf-8', { fatal: true });
    let maxOct = 0, splitOk = true;
    for (const l of lines) {
      const b = Buffer.from(l, 'utf8');
      maxOct = Math.max(maxOct, b.length);
      try { dec.decode(b); } catch (e) { splitOk = false; }
    }
    ok(maxOct <= 75, 'physical lines <= 75 octets', maxOct);
    ok(splitOk, 'folding never splits a UTF-8 sequence');
    ok(lines.some((l) => l.startsWith(' ')), 'long lines are folded');
    const u = unfold(t);
    for (const need of ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:', 'BEGIN:VTIMEZONE', 'TZID:America/New_York', 'BEGIN:DAYLIGHT',
      'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'END:VTIMEZONE', 'BEGIN:VEVENT',
      'UID:debrief-2026@', 'DTSTAMP:20261109T170000Z', 'DTSTART;TZID=America/New_York:20261114T100000',
      'DTEND;TZID=America/New_York:20261114T123000', 'TRIGGER:-PT60M', 'END:VEVENT', 'END:VCALENDAR']) ok(u.includes(need), 'ics has ' + need);
    ok(u.includes('SUMMARY:Debrief\\, pizza\\; and "what\'s next" \\\\ planning'), 'TEXT escaping of , ; \\');
    ok(u.includes('LOCATION:Library\\, 150 N Palmetto Ave\\, Sanford\\, FL'), 'location + address');
    ok(/DESCRIPTION:Line one\\nLine two/.test(u), 'newline escaped as \\n');
    ok(u.includes('URL:https://example.org/e?a=1,b=2'), 'URL not TEXT-escaped');
    eq(u.split('\r\n').indexOf('BEGIN:VTIMEZONE') < u.split('\r\n').indexOf('BEGIN:VEVENT'), true, 'VTIMEZONE before VEVENT');
    // UTC and no-offset inputs land on New York wall time
    ok(unfold(cal.text({ title: 'x', start: '2026-07-04T22:00:00Z' })).includes('DTSTART;TZID=America/New_York:20260704T180000'), 'Z input -> EDT wall time');
    ok(unfold(cal.text({ title: 'x', start: '2026-12-01T19:00' })).includes('DTSTART;TZID=America/New_York:20261201T190000'), 'no-offset input = NY wall time');
    ok(unfold(cal.text({ title: 'x', start: '2026-12-01T19:00' })).includes('DTEND;TZID=America/New_York:20261201T210000'), 'default 120 min duration');
    const allDay = unfold(cal.text({ title: 'Early voting', start: '2026-10-24', end: '2026-11-01' }));
    ok(allDay.includes('DTSTART;VALUE=DATE:20261024') && allDay.includes('DTEND;VALUE=DATE:20261102'), 'all-day end inclusive -> exclusive DTEND');
    ok(!allDay.includes('BEGIN:VTIMEZONE'), 'all-day only file has no VTIMEZONE');
    const multi = unfold(cal.text([ev, { id: 'b', title: 'B', start: '2026-11-20T18:00:00-05:00' }]));
    eq((multi.match(/BEGIN:VEVENT/g) || []).length, 2, 'multi-event file');
    eq((multi.match(/BEGIN:VTIMEZONE/g) || []).length, 1, 'one VTIMEZONE for many events');
    const a = unfold(cal.text({ title: 'Same', start: '2026-11-20T18:00:00-05:00' })).match(/UID:(.*)/)[1];
    const b = unfold(cal.text({ title: 'Same', start: '2026-11-20T18:00:00-05:00' })).match(/UID:(.*)/)[1];
    eq(a, b, 'UID stable without id');
    let threw = false; try { cal.text({ title: 'bad', start: 'next tuesday' }); } catch (e) { threw = e.name === 'TypeError'; }
    ok(threw, 'invalid start throws TypeError');
    ok(cal.ics(ev) instanceof Blob, 'ics() returns a Blob');
    eq(cal.ics(ev).type, 'text/calendar;charset=utf-8', 'Blob type');
    eq(cal.google({ title: 'bad', start: 'nope' }), '', 'google() empty for invalid event');
    w.YSD.counters.stopLive();
  });

  await section('node: America/New_York offsets match Intl for 2026-2030', async () => {
    const w = sandbox();
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' });
    let bad = 0, first = null;
    for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2031, 0, 1); t += 3600000) {
      const name = fmt.formatToParts(new Date(t)).find((p) => p.type === 'timeZoneName').value; // GMT-4 / GMT-5
      const want = name === 'GMT-4' ? -240 : -300;
      if (w.YSD.cal._nyOffset(t) !== want) { bad++; if (!first) first = new Date(t).toISOString(); }
    }
    eq(bad, 0, 'offset mismatches (first: ' + first + ')');
    w.YSD.counters.stopLive();
  });

  await section('node: Google and Outlook links', async () => {
    const w = sandbox();
    const ev = { title: 'Meet & greet', start: '2026-11-14T10:00:00-05:00', end: '2026-11-14T12:00:00-05:00', location: 'Sanford', description: 'Hi', url: 'https://x.test/e' };
    const g = new URL(w.YSD.cal.google(ev));
    eq(g.origin + g.pathname, 'https://calendar.google.com/calendar/render', 'google base');
    eq(g.searchParams.get('action'), 'TEMPLATE', 'google action');
    eq(g.searchParams.get('text'), 'Meet & greet', 'google text encoded');
    eq(g.searchParams.get('dates'), '20261114T150000Z/20261114T170000Z', 'google UTC dates');
    eq(g.searchParams.get('details'), 'Hi\n\nhttps://x.test/e', 'google details carry url');
    eq(g.searchParams.get('ctz'), 'America/New_York', 'google ctz');
    const o = new URL(w.YSD.cal.outlook(ev));
    eq(o.origin + o.pathname, 'https://outlook.live.com/calendar/0/deeplink/compose', 'outlook base');
    eq(o.searchParams.get('rru'), 'addevent', 'outlook rru');
    eq(o.searchParams.get('startdt'), '2026-11-14T15:00:00Z', 'outlook startdt UTC');
    eq(o.searchParams.get('enddt'), '2026-11-14T17:00:00Z', 'outlook enddt UTC');
    eq(o.searchParams.get('subject'), 'Meet & greet', 'outlook subject');
    ok(w.YSD.cal.outlook(ev, { office: true }).startsWith('https://outlook.office.com/'), 'office365 host');
    const ad = new URL(w.YSD.cal.google({ title: 'x', start: '2026-11-03' }));
    eq(ad.searchParams.get('dates'), '20261103/20261104', 'google all-day dates');
    w.YSD.counters.stopLive();
  });

  await section('node: share captureRef / url / links / actblue', async () => {
    const w = sandbox({ href: 'https://ysd.example/events.html?ref=fr1end&utm_source=tiktok&utm_campaign=fall&x=1' });
    const sh = w.YSD.share;
    eq(sh.ref(), 'FR1END', 'ref captured and upper-cased');
    eq(sh.utm().utm_source, 'tiktok', 'utm captured');
    eq(w.YSD.store.get('utm:first').utm_campaign, 'fall', 'first-touch utm stored');
    eq(w.YSD.members.referredBy(), 'FR1END', 'referredBy before join = captured ref');
    const u = new URL(sh.url('join.html'));
    eq(u.origin + u.pathname, 'https://ysd.example/join.html', 'url resolves against site root');
    eq(u.searchParams.get('utm_source'), 'share', 'default utm_source');
    eq(u.searchParams.get('ref'), null, 'no ref before I have a code');
    const cur = new URL(sh.url());
    eq(cur.pathname, '/events.html', 'url() = current page');
    eq(cur.searchParams.get('x'), '1', 'current page keeps its own params');
    ok(!cur.href.includes('fr1end') && !cur.href.includes('FR1END'), 'current page drops the incoming ref');
    const me = w.YSD.members.join({ firstName: 'Kira', email: 'kira@example.com' });
    const u2 = new URL(sh.url('/join.html', { utm_medium: 'sms', foo: null }));
    eq(u2.searchParams.get('ref'), me.refCode, 'url carries my refCode');
    eq(u2.searchParams.get('utm_medium'), 'sms', 'params override utm');
    eq(new URL(sh.url('join.html', { ref: false, utm: false })).search, '', 'ref:false utm:false');
    const L = sh.links('Join us!', 'https://ysd.example/?ref=K');
    for (const k of ['sms', 'whatsapp', 'x', 'threads', 'bluesky', 'facebook', 'email', 'telegram']) ok(typeof L[k] === 'string' && L[k].length > 10, 'links.' + k);
    ok(L.x.startsWith('https://x.com/intent/tweet?text=Join%20us!&url=https%3A%2F%2Fysd.example%2F%3Fref%3DK'), 'x intent', L.x);
    ok(L.x.includes('&hashtags=YoungDemsSeminole'), 'x hashtags');
    eq(L.bluesky, 'https://bsky.app/intent/compose?text=Join%20us!%20https%3A%2F%2Fysd.example%2F%3Fref%3DK', 'bluesky intent');
    ok(L.threads.startsWith('https://www.threads.com/intent/post?text='), 'threads intent');
    ok(L.sms.startsWith('sms:?&body='), 'sms body');
    ok(L.email.startsWith('mailto:?subject=') && L.email.includes('&body=Join%20us!%20'), 'mailto');
    eq(L.facebook, 'https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fysd.example%2F%3Fref%3DK', 'facebook sharer');
    eq(L.telegram, 'https://t.me/share/url?url=https%3A%2F%2Fysd.example%2F%3Fref%3DK&text=Join%20us!', 'telegram');
    const w0 = sandbox({ href: 'https://ysd.example/?ref=PAL22', preConfig: { links: { actblue: '' } } });
    eq(w0.YSD.share.actblue(25), '', "actblue '' when not configured");
    w0.YSD.counters.stopLive();
    const w2 = sandbox({ href: 'https://ysd.example/?ref=PAL22&utm_source=ig', preConfig: { links: { actblue: 'https://secure.actblue.com/donate/example-form' } } });
    const ab = new URL(w2.YSD.share.actblue(10, { recurring: false }));
    eq(ab.searchParams.get('amount'), '10', 'actblue amount');
    eq(ab.searchParams.get('refcode'), 'ref_PAL22', 'actblue refcode = referrer');
    eq(ab.searchParams.get('refcode2'), 'utm_ig', 'actblue refcode2 = utm_source');
    eq(ab.searchParams.get('recurring'), null, 'false extra removed');
    const ab2 = new URL(w2.YSD.share.actblue(0, { refcode: 'my code!' }));
    eq(ab2.searchParams.get('refcode'), 'my_code_', 'refcode sanitised');
    eq(ab2.searchParams.get('amount'), null, 'no amount for 0');
    // self-referral is ignored
    const w3 = sandbox({ href: 'https://ysd.example/' });
    const m3 = w3.YSD.members.join({ firstName: 'Ana', phone: '(407) 555-0100' });
    w3.location.search = '?ref=' + m3.refCode.toLowerCase();
    w3.YSD.share.captureRef();
    eq(w3.YSD.share.ref(), null, 'own code is not captured as a referral');
    [w, w2, w3].forEach((x) => x.YSD.counters.stopLive());
  });

  await section('node: members validate / join / refCode / squad', async () => {
    // Simulated squad growth and live counters are OFF by default (BRIEF 0: no fake social proof);
    // this section opts in to test the simulation itself, and checks the default below.
    const wOff = sandbox();
    const mOff = wOff.YSD.members.join({ firstName: 'Kira', email: 'off@example.com', age: 22 });
    eq(wOff.YSD.members.squad({ now: mOff.joinedAt + 86400e3 }).length, 0, 'default config: no simulated squad');
    wOff.YSD.counters.stopLive();
    const w = sandbox({ preConfig: { features: { demoSquadGrowth: true, demoLiveCounters: true } } });
    const M = w.YSD.members;
    const v0 = M.validate({});
    ok(!v0.ok && v0.errors.firstName === 'required' && v0.errors.email === 'required', 'empty profile errors', v0.errors);
    eq(M.validate({ firstName: 'A', email: 'nope' }).errors.email, 'invalid', 'bad email');
    eq(M.validate({ firstName: 'A', phone: '123' }).errors.phone, 'invalid', 'bad phone');
    eq(M.validate({ firstName: 'A', phone: '1 (407) 555-0100' }).clean.phone, '+14075550100', 'phone normalised');
    eq(M.validate({ firstName: 'A', email: 'a@b.co', zip: '3274' }).errors.zip, 'invalid', 'bad zip');
    eq(M.validate({ firstName: 'A', email: 'a@b.co', age: 12 }).errors.age, 'too_young', 'under minAge');
    const old = M.validate({ firstName: 'A', email: 'a@b.co', age: 41 });
    ok(old.ok && old.warnings.age === 'over_age_cap', 'over cap warns, not errors');
    eq(M.validate({ name: 'Jo Ann Smith', email: 'j@x.io' }).clean.lastName, 'Ann Smith', 'name split');
    eq(M.validate({ firstName: 'A', email: 'a@b.co', favoriteIssue: 'housing', nested: { x: 1 } }).clean.favoriteIssue, 'housing', 'extra fields kept');
    let threw = null; try { M.join({ firstName: '' }); } catch (e) { threw = e; }
    ok(threw && threw.code === 'YSD_INVALID' && threw.errors.firstName === 'required', 'join throws YSD_INVALID');
    eq(M.current(), null, 'no member before join');
    const me = M.join({ firstName: 'Kíra', lastName: 'Q', email: 'KIRA@Example.com', zip: '32746' });
    ok(/^KIRA[BCDFGHJKMNPQRSTVWXZ2-9]{3}$/.test(me.refCode), 'readable name refCode', me.refCode);
    eq(me.email, 'kira@example.com', 'email lower-cased');
    ok(me.submitted && typeof me.submitted.then === 'function', 'submitted promise');
    ok(!Object.keys(me).includes('submitted'), 'submitted is non-enumerable');
    const sub = await me.submitted;
    ok(sub.ok && sub.mode === 'demo', 'demo submit sends nothing', sub);
    eq(M.current().id, me.id, 'current()');
    const again = M.join({ firstName: 'Kira', email: 'k2@example.com' });
    eq(again.id, me.id, 're-join keeps id'); eq(again.refCode, me.refCode, 're-join keeps refCode');
    for (let i = 0; i < 50; i++) {
      const c = M.makeRefCode({});
      if (!/^[BCDFGHJKMNPQRSTVWXZ2-9]{6}$/.test(c)) { ok(false, 'random refCode format', c); break; }
    }
    // members under 18 get the random style even with refCodeStyle 'name' (no teen first names in links)
    eq(w.YSD_CONFIG.members.refCodeStyle, 'name', "refCodeStyle is 'name' for the teen checks");
    for (let i = 0; i < 50; i++) {
      const t = M.makeRefCode({ firstName: 'Kira', age: 16 });
      if (!/^[BCDFGHJKMNPQRSTVWXZ2-9]{6}$/.test(t)) { ok(false, 'under-18 refCode is random style', t); break; }
    }
    ok(/^[BCDFGHJKMNPQRSTVWXZ2-9]{6}$/.test(M.makeRefCode({ firstName: 'Kira', age: '17' })), 'string age 17 is random style too');
    ok(/^KIRA[BCDFGHJKMNPQRSTVWXZ2-9]{3}$/.test(M.makeRefCode({ firstName: 'Kira', age: 18 })), '18 keeps the name style');
    ok(/^KIRA[BCDFGHJKMNPQRSTVWXZ2-9]{3}$/.test(M.makeRefCode({ firstName: 'Kira' })), 'unknown age keeps the name style');
    const tw = sandbox();
    const teen = tw.YSD.members.join({ firstName: 'Kira', email: 'teen@example.com', age: 15 });
    ok(/^[BCDFGHJKMNPQRSTVWXZ2-9]{6}$/.test(teen.refCode), 'teen join (age 15) gets a random refCode', teen.refCode);
    const tw2 = sandbox();
    const teen2 = tw2.YSD.members.join({ firstName: 'Kira', email: 'teen2@example.com', birthYear: new Date().getFullYear() - 16 });
    ok(/^[BCDFGHJKMNPQRSTVWXZ2-9]{6}$/.test(teen2.refCode), 'teen join (birthYear) gets a random refCode', teen2.refCode);
    const tw3 = sandbox({ preConfig: { members: { refCodeStyle: 'name' } } });
    const adult = tw3.YSD.members.join({ firstName: 'Kira', email: 'adult@example.com', age: 22 });
    ok(/^KIRA[BCDFGHJKMNPQRSTVWXZ2-9]{3}$/.test(adult.refCode), 'adult join keeps the name style', adult.refCode);
    [tw, tw2, tw3].forEach((x) => x.YSD.counters.stopLive());
    // squad: simulated growth, flagged demo
    const j = M.current().joinedAt;
    eq(M.squad({ now: j }).length, 0, 'no squad at join time');
    const s3h = M.squad({ now: j + 3 * 3600e3 });
    ok(s3h.length >= 4 && s3h.length <= 6, 'simulated squad after 3h', s3h.length);
    ok(s3h.every((x) => x.demo === true && x.simulated === true), 'simulated members flagged demo');
    ok(M.squad({ now: j + 30 * 86400e3 }).length === 6, 'capped at members.demoSquadMax');
    eq(JSON.stringify(M.squad({ now: j + 3 * 3600e3 })), JSON.stringify(s3h), 'deterministic');
    // a local join referred by my code shows up as a real (non-simulated) squad member
    w.YSD.store.push('joins', { id: 'm_friend', refCode: 'FRNDXYZ', referredBy: me.refCode, firstName: 'Dev', lastInitial: 'P', joinedAt: j + 1000, demo: true });
    ok(M.squad({ now: j + 2000 }).some((x) => x.id === 'm_friend' && !x.simulated && x.name === 'Dev P.'), 'local referred join in squad');
    // honeypot
    const before = w.YSD.store.list('joins').length;
    const hp = M.join({ firstName: 'Bot', email: 'b@b.co', _hp: 'x' });
    eq((await hp.submitted).mode, 'ignored', 'honeypot ignored');
    eq(w.YSD.store.list('joins').length, before, 'honeypot stores nothing');
    M.forget();
    eq(M.current(), null, 'forget()');
    const pz = sandbox({ preConfig: { features: { demoSquadGrowth: false } } });
    const pm = pz.YSD.members.join({ firstName: 'Lee', email: 'l@x.io' });
    eq(pz.YSD.members.squad({ now: pm.joinedAt + 86400e3 }).length, 0, 'demoSquadGrowth flag off');
    w.YSD.counters.stopLive(); pz.YSD.counters.stopLive();
  });

  // Round 1, journeys-08: adult members' links carry from=<FirstName>; never a minor's, never someone else's.
  await section('node: share.url adds from= for adult members only (journeys-08)', async () => {
    const w = sandbox({ href: 'https://ysd.example/quiz.html?ref=KIRA7QX&from=Kira&e=trivia' });
    const sh = w.YSD.share, M = w.YSD.members;
    const anon = new URL(sh.url());
    eq(anon.searchParams.get('from'), null, "no member: the sender's from is not passed on");
    eq(anon.searchParams.get('e'), 'trivia', 'own query kept (e)');
    const sam = M.join({ firstName: 'Sam', email: 'sam@example.com', age: 22 });
    const u = new URL(sh.url('join.html'));
    eq(u.searchParams.get('ref'), sam.refCode, 'adult: ref');
    eq(u.searchParams.get('from'), 'Sam', 'adult: from=Sam added automatically');
    eq(new URL(sh.url()).searchParams.get('from'), 'Sam', "current page: my from replaces Kira's");
    eq(new URL(sh.url('join.html', { from: false })).searchParams.get('from'), null, 'from:false turns it off');
    eq(new URL(sh.url('join.html', { ref: false })).searchParams.get('from'), null, 'no code (plain link): no from');
    eq(new URL(sh.url('join.html', { ref: 'OTHER1' })).searchParams.get('from'), null, "someone else's code: no automatic from");
    eq(sh.from(), 'Sam', 'share.from()');
    eq(M.shareName(), true, 'shareName() on by default for adults');
    eq(M.setShareName(false), false, 'setShareName(false)');
    eq(new URL(sh.url('join.html')).searchParams.get('from'), null, 'switched off: no from');
    eq(M.shareParams().from, '', 'shareParams().from empty when off');
    M.setShareName(true);
    eq(M.shareParams().ref, sam.refCode, 'shareParams().ref');
    eq(M.shareParams().from, 'Sam', 'shareParams().from');
    w.YSD.counters.stopLive();

    const t = sandbox({ href: 'https://ysd.example/join.html' });
    const teen = t.YSD.members.join({ firstName: 'Ana', email: 'ana@example.com', age: 16 });
    const tu = new URL(t.YSD.share.url('join.html'));
    eq(tu.searchParams.get('ref'), teen.refCode, 'minor: ref (random style)');
    ok(!/ANA/.test(teen.refCode), 'minor: code has no name', teen.refCode);
    eq(tu.searchParams.get('from'), null, 'minor: never from');
    eq(new URL(t.YSD.share.url('join.html', { from: 'Ana' })).searchParams.get('from'), null, 'minor: explicit from on my link is dropped too');
    t.YSD.members.setShareName(true);
    eq(t.YSD.members.shareName(), false, 'minor: shareName() stays false');
    t.YSD.counters.stopLive();

    const x = sandbox({ href: 'https://ysd.example/join.html' });
    x.YSD.members.join({ firstName: 'Lee', email: 'lee@example.com' });
    eq(new URL(x.YSD.share.url('join.html')).searchParams.get('from'), null, 'unknown age: no from');
    const xs = sandbox({ href: 'https://ysd.example/join.html' });
    xs.YSD.members.join({ firstName: '<img src=x onerror=1>Jo', email: 'jo@example.com', age: 30 });
    eq(new URL(xs.YSD.share.url('a.html')).searchParams.get('from'), 'img srcx onerrorJo', 'from is cleaned to letters, spaces, hyphens and apostrophes');
    eq(new URL(x.YSD.share.url('a.html', { ref: false, from: 'Dani' })).searchParams.get('from'), 'Dani', 'explicit from on a plain link (RSVP +1 without membership) is kept');
    x.YSD.counters.stopLive(); xs.YSD.counters.stopLive();
  });

  // Round 1, journeys-06: "Not Sam? Start over" keeps the join log and credits the next join to the right link.
  await section('node: members.reset archives, clears per-person state, re-captures ref (journeys-06)', async () => {
    // Sam arrived through Kira's link, joined, then opens his own link on the same device.
    const w = sandbox({ href: 'https://ysd.example/join.html?ref=KIRA7QX' });
    const M = w.YSD.members, S = w.YSD.store;
    const sam = M.join({ firstName: 'Sam', email: 'sam@example.com', age: 22 });
    eq(sam.referredBy, 'KIRA7QX', 'Sam credited to Kira');
    S.set('stickers', [{ id: 'doors-open' }]); S.set('streak', { weeks: ['2026-11-09'] }); S.set('stickers:log', [{ action: 'join' }]);
    S.set('rsvp:trivia', { status: 'going' }); S.set('rsvp:queue', [{ id: 'q1' }]); S.set('rsvp:last', { firstName: 'Sam', contact: 'sam@example.com' });
    S.set('quiz:show-up', { type: 'x' });
    w.location.search = '?ref=' + sam.refCode; w.location.href = 'https://ysd.example/join.html?ref=' + sam.refCode;
    w.YSD.share.captureRef();
    eq(w.YSD.share.ref(), 'KIRA7QX', "while Sam is the member his own code is ignored");
    const events = [];
    const entry = M.reset();
    ok(entry && entry.id === sam.id && entry.archivedAt > 0, 'reset() returns the archived entry', entry);
    eq(M.current(), null, 'member cleared');
    const joins = S.get('joins');
    ok(Array.isArray(joins) && joins.some((j) => j.id === sam.id && j.archivedAt), 'Sam stays in the join log (archived)', joins);
    ok(!joins.find((j) => j.id === sam.id).email, 'archive keeps no contact details');
    eq(S.get('stickers', null), null, 'stickers cleared'); eq(S.get('streak', null), null, 'streak cleared');
    eq(S.get('stickers:log', null), null, 'sticker log cleared'); eq(S.get('rsvp:trivia', null), null, 'RSVP records cleared');
    eq(S.get('rsvp:last', null), null, 'RSVP prefill cleared');
    ok(Array.isArray(S.get('rsvp:queue', null)), 'unsent RSVP queue kept');
    ok(S.get('quiz:show-up', null) !== null, 'keys outside the list are kept');
    eq(w.YSD.share.ref(), sam.refCode, "ref re-captured from the URL: Sam's link now counts");
    const ana = M.join({ firstName: 'Ana', email: 'ana@example.com', age: 20 });
    eq(ana.referredBy, sam.refCode, "Ana is credited to Sam, not to Kira's old arrival ref");
    // Back to Sam: his meter now shows Ana.
    eq(M.archived().length, 1, 'archived(): Sam is listed');
    const back = M.resume(sam.id);
    ok(back && back.id === sam.id && back.refCode === sam.refCode && !back.email, 'resume(): Sam is back, without contact details', back);
    const sq = M.squad();
    ok(sq.length === 1 && sq[0].firstName === 'Ana' && sq[0].simulated === false, "Sam's squad counts Ana (a real local join, not simulated)", sq);
    ok(M.archived().some((a) => a.firstName === 'Ana'), 'Ana archived when Sam resumed');
    eq(new URL(w.YSD.share.url('join.html')).searchParams.get('from'), 'Sam', 'resumed adult keeps from=');
    eq(M.reset({ keep: ['stickers'] }) && true, true, 'reset again');
    eq(M.reset(), null, 'reset() with no member returns null');
    // forget() still wipes everything (privacy "Forget me").
    const f = sandbox({ href: 'https://ysd.example/join.html?ref=KIRA7QX' });
    f.YSD.members.join({ firstName: 'Lu', email: 'lu@example.com', age: 19 });
    f.YSD.members.forget();
    eq(f.YSD.store.get('joins', null), null, 'forget() still removes the join log');
    w.YSD.counters.stopLive(); f.YSD.counters.stopLive();
    void events;
  });

  await section('node: production submit seam (formEndpoint, Action Network, failure)', async () => {
    const calls = [];
    function fakeFetch(status, json) {
      return (url, init) => {
        calls.push({ url, init });
        return Promise.resolve({ ok: status < 300, status, headers: { get: () => 'application/json' }, json: () => Promise.resolve(json || {}) });
      };
    }
    const w = sandbox({ preConfig: { demo: false, integrations: { formEndpoint: '/api/join' } }, globals: { fetch: fakeFetch(200, { refCode: 'SRV123' }) } });
    const me = w.YSD.members.join({ firstName: 'Kira', email: 'kira@example.com', smsOptIn: true });
    const r = await me.submitted;
    ok(r.ok && r.mode === 'form' && r.status === 200, 'form submit ok', r);
    eq(calls[0].url, '/api/join', 'posted to formEndpoint');
    const body = JSON.parse(calls[0].init.body);
    eq(body.email, 'kira@example.com', 'payload has email');
    ok(body.refCode && body.id, 'payload has id and refCode');
    eq(w.YSD.members.current().refCode, 'SRV123', 'server refCode replaces local');
    eq(w.YSD.members.current().email, undefined, 'contact dropped locally after production submit');
    eq(w.YSD.members.current().synced, true, 'marked synced');

    calls.length = 0;
    const w2 = sandbox({ preConfig: { demo: false, integrations: { formEndpoint: '/f', formEncoding: 'form', formName: 'join' } }, globals: { fetch: fakeFetch(200) } });
    await w2.YSD.members.join({ firstName: 'Ana', email: 'a@x.io', interests: ['vote', 'events'] }).submitted;
    ok(/^.*form-name=join/.test(calls[0].init.body) && calls[0].init.headers['Content-Type'] === 'application/x-www-form-urlencoded', 'urlencoded form submit');

    calls.length = 0;
    const w3 = sandbox({ preConfig: { demo: false, integrations: { actionNetwork: { endpoint: '/api/an' } } }, globals: { fetch: fakeFetch(201) } });
    await w3.YSD.members.join({ firstName: 'Ana', lastName: 'B', email: 'a@x.io', phone: '4075550100', zip: '32771' }).submitted;
    const an = JSON.parse(calls[0].init.body);
    eq(calls[0].url, '/api/an', 'posted to Action Network proxy');
    eq(an.person.given_name, 'Ana', 'AN given_name');
    eq(an.person.email_addresses[0].address, 'a@x.io', 'AN email');
    eq(an.person.phone_numbers[0].status, 'unsubscribed', 'AN phone not subscribed without SMS consent');
    eq(an.person.postal_addresses[0].postal_code, '32771', 'AN zip');
    ok(an.person.custom_fields.ysd_ref_code && Array.isArray(an.add_tags), 'AN custom field + tags');
    ok(!/OSDI|api[_-]?key/i.test(calls[0].init.body + JSON.stringify(calls[0].init.headers)), 'no API key from the browser');

    const w4 = sandbox({ preConfig: { demo: false, integrations: { formEndpoint: '/f' } }, globals: { fetch: fakeFetch(500) } });
    const r4 = await w4.YSD.members.join({ firstName: 'Z', email: 'z@x.io' }).submitted;
    ok(!r4.ok && r4.status === 500, 'failed submit reported', r4);
    eq(w4.YSD.members.current().synced, false, 'failed submit stays unsynced for retry');
    eq(w4.YSD.members.current().email, 'z@x.io', 'contact kept until synced');

    const w5 = sandbox({ preConfig: { demo: false } });
    const r5 = await w5.YSD.members.join({ firstName: 'Z', email: 'z@x.io' }).submitted;
    eq(r5.mode, 'none', 'nothing configured -> mode none');
    [w, w2, w3, w4, w5].forEach((x) => x.YSD.counters.stopLive());
  });

  await section('node: track shim', async () => {
    const w = sandbox();
    eq(w.YSD.track('join', { email: 'a@b.c', template: 'joined', n: 2, obj: {} }), false, 'demo: not sent');
    const h = w.YSD.track.history();
    const last = h[h.length - 1];
    eq(last.event, 'join', 'history records');
    ok(!('email' in last.props) && last.props.template === 'joined' && last.props.n === 2 && !('obj' in last.props), 'PII and objects dropped', last.props);
    const beacons = [];
    const nav = { sendBeacon: (u, b) => { beacons.push([u, b]); return true; } };
    const p = sandbox({ preConfig: { demo: false, integrations: { analytics: { provider: 'custom', endpoint: '/collect' } } }, globals: { navigator: nav } });
    eq(p.YSD.track('share', { result: 'copied' }), true, 'custom provider sends');
    eq(beacons[beacons.length - 1][0], '/collect', 'beacon endpoint');
    const body = JSON.parse(await beacons[beacons.length - 1][1].text());
    eq(body.event, 'share', 'beacon body event');
    const dntNav = { doNotTrack: '1', sendBeacon: () => { throw new Error('should not send'); } };
    const d = sandbox({ preConfig: { demo: false, integrations: { analytics: { provider: 'custom', endpoint: '/collect' } } }, globals: { navigator: dntNav } });
    eq(d.YSD.track('x'), false, 'Do Not Track respected');
    // queue stub: calls before track.js loads are replayed
    const q = sandbox({ files: ['assets/js/config.js', 'assets/js/store.js', 'assets/js/share.js', 'assets/js/track.js'], href: 'https://ysd.example/?ref=EARLY1' });
    ok(q.YSD.track.history().some((x) => x.event === 'ref_captured' && x.props.ref === 'EARLY1'), 'early calls replayed');
    [w, p, d, q].forEach((x) => x.YSD.counters && x.YSD.counters.stopLive());
  });

  await section('node: each module tolerates missing optional modules', async () => {
    for (const f of CORE) {
      let err = null;
      try { const w = sandbox({ files: [f] }); if (w.YSD && w.YSD.counters) w.YSD.counters.stopLive(); } catch (e) { err = e; }
      ok(!err, f + ' loads alone', err && err.message);
    }
    const w = sandbox({ files: ['assets/js/share.js', 'assets/js/members.js', 'assets/js/cal.js'], href: 'https://ysd.example/?ref=ABC' });
    eq(w.YSD.share.ref(), 'ABC', 'share works without store/config');
    const m = w.YSD.members.join({ firstName: 'Kai', email: 'k@x.io' });
    ok(m.refCode && w.YSD.share.url('x.html').includes('ref=' + m.refCode), 'members + share without store');
    ok(w.YSD.cal.text({ title: 't', start: '2026-11-14T10:00:00-05:00' }).includes('BEGIN:VEVENT'), 'cal without config');
  });

  await section('node: no assistant / LLM code in core files', async () => {
    for (const f of OWNED) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      ok(!/askEndpoint|\/api\/ask|anthropic|openai|claude/i.test(src.replace(/NO chat assistant[^\n]*\n[^\n]*/i, '')), f + ' has no assistant/LLM references');
    }
  });
}

// ------------------------------------------------------------------ browser
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
function testPage(scripts, extraHead) {
  return '<!doctype html><html><head><meta charset="utf-8"><title>core test</title>' + (extraHead || '') + '</head><body><main id="app"></main>' +
    scripts.map((s) => '<script src="' + s + '"></script>').join('') + '</body></html>';
}
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      if (u.pathname === '/__core_test__.html') {
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(testPage(CORE.map((f) => '/' + f), '<style>:root{--ysd-card-brand:#00ff00;--ysd-accent:#0000ff}</style>'));
        return;
      }
      const file = path.join(ROOT, decodeURIComponent(u.pathname));
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

async function browserTests() {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) { ok(false, 'playwright is installed', e.message); return; }
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ysd-core-'));
  try {
    function watch(page, sink) {
      page.on('pageerror', (e) => sink.push('pageerror: ' + e.message));
      page.on('console', (m) => { if (m.type() === 'error') sink.push('console.error: ' + m.text()); });
    }

    await section('browser(http): ref capture, store, db, counters, cross-tab', async () => {
      const ctx = await browser.newContext({ acceptDownloads: true });
      const errs = [], external = [];
      const page = await ctx.newPage();
      watch(page, errs);
      page.on('request', (r) => { if (!r.url().startsWith(base) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url()); });
      await page.goto(base + '/__core_test__.html?ref=fr1end&utm_source=tiktok&utm_campaign=fall');
      const r = await page.evaluate(async () => {
        const Y = window.YSD, out = {};
        out.ref = Y.share.ref(); out.utm = Y.share.utm();
        out.backend = Y.store.backend;
        out.root = Y.root;
        Y.store.set('a', { b: [1, 2] }); out.a = Y.store.get('a');
        out.raw = localStorage.getItem('ysd:a');
        out.dbBackend = await Y.db.ready();
        await Y.db.put('clips', 'c1', new Blob(['x'.repeat(2048)], { type: 'video/mp4' }));
        await Y.db.put('clips', 'c2', { meta: true });
        const got = await Y.db.get('clips', 'c1');
        out.blobSize = got && got.size; out.blobType = got && got.type;
        out.all = (await Y.db.all('clips')).length;
        await Y.db.del('clips', 'c2');
        out.afterDel = (await Y.db.all('clips')).length;
        out.missing = await Y.db.get('clips', 'nope');
        const seen = [];
        Y.counters.on('rsvps', (v) => seen.push(v));
        const b0 = Y.counters.get('rsvps');
        Y.counters.bump('rsvps');
        out.counter = [b0, Y.counters.get('rsvps'), seen.length];
        let evt = null;
        document.addEventListener('ysd:counter', (e) => { evt = e.detail; }, { once: true });
        Y.counters.bump('pledges', 2);
        out.counterEvt = evt;
        return out;
      });
      eq(r.ref, 'FR1END', 'ref captured from URL');
      eq(r.utm.utm_campaign, 'fall', 'utm captured');
      eq(r.backend, 'localStorage', 'localStorage backend');
      eq(r.root, base + '/', 'YSD.root from config.js src');
      eq(r.raw, '{"b":[1,2]}', 'keys namespaced ysd:');
      eq(r.dbBackend, 'indexeddb', 'IndexedDB backend');
      eq(r.blobSize, 2048, 'Blob round-trips through IndexedDB'); eq(r.blobType, 'video/mp4', 'Blob type kept');
      eq(r.all, 2, 'db.all'); eq(r.afterDel, 1, 'db.del'); eq(r.missing, null, 'db.get missing -> null');
      eq(r.counter[1], r.counter[0] + 1, 'counter bump'); eq(r.counter[2], 1, 'counter on() fired');
      ok(r.counterEvt && r.counterEvt.name === 'pledges', 'ysd:counter DOM event');

      // cross-tab: page2 listens, page1 writes
      const page2 = await ctx.newPage();
      watch(page2, errs);
      await page2.goto(base + '/__core_test__.html');
      await page2.evaluate(() => { window.__got = []; window.YSD.store.on('xt', (v, info) => window.__got.push([v, info.source])); window.YSD.counters.on('shares', (v) => window.__got.push(['shares', v])); });
      await page.evaluate(() => { window.YSD.store.set('xt', 42); window.YSD.counters.bump('shares'); });
      await page2.waitForFunction(() => window.__got.length >= 2, null, { timeout: 5000 });
      const got = await page2.evaluate(() => window.__got);
      ok(got.some((g) => g[0] === 42 && g[1] === 'remote'), 'store.on fires for other-tab writes', got);
      ok(got.some((g) => g[0] === 'shares'), 'counters.on fires for other-tab bumps', got);
      eq(await page2.evaluate(() => window.YSD.share.ref()), 'FR1END', 'captured ref visible in other tab');
      ok(errs.length === 0, 'no page errors', errs);
      ok(external.length === 0, 'demo makes no external requests', external);
      await ctx.close();
    });

    await section('browser(http): members, share fallbacks, clipboard, cal download', async () => {
      const ctx = await browser.newContext({ acceptDownloads: true });
      await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
      const errs = [];
      const page = await ctx.newPage();
      watch(page, errs);
      await page.goto(base + '/__core_test__.html?ref=pal99');
      const r = await page.evaluate(async () => {
        const Y = window.YSD, out = {};
        let joinedEvt = null;
        document.addEventListener('ysd:joined', (e) => { joinedEvt = e.detail; });
        const c0 = Y.counters.get('members');
        const me = Y.members.join({ firstName: 'Kira', email: 'kira@example.com', zip: '32746' });
        out.me = me; out.sub = await me.submitted;
        out.joinedEvt = !!(joinedEvt && joinedEvt.isNew);
        out.members = [c0, Y.counters.get('members')];
        out.referredBy = Y.members.referredBy();
        out.url = Y.share.url('join.html');
        // native(): force the no-Web-Share path -> clipboard
        const saved = navigator.share;
        try { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); } catch (e) {}
        out.native = await Y.share.native({ title: 'T', text: 'Join me', url: out.url });
        out.clip = await navigator.clipboard.readText();
        // stubbed Web Share: success and cancel
        Object.defineProperty(navigator, 'share', { value: () => Promise.resolve(), configurable: true });
        Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
        out.shared = await Y.share.native({ text: 'x', url: out.url });
        Object.defineProperty(navigator, 'share', { value: () => Promise.reject(new DOMException('closed', 'AbortError')), configurable: true });
        out.cancelled = await Y.share.native({ text: 'x', url: out.url });
        Object.defineProperty(navigator, 'share', { value: () => Promise.reject(new DOMException('no gesture', 'NotAllowedError')), configurable: true });
        out.notAllowed = await Y.share.native({ text: 'fallback text', url: out.url });
        Object.defineProperty(navigator, 'share', { value: saved, configurable: true });
        out.copyOk = await Y.share.copy('plain copy');
        out.clip2 = await navigator.clipboard.readText();
        return out;
      });
      ok(/^KIRA[BCDFGHJKMNPQRSTVWXZ2-9]{3}$/.test(r.me.refCode), 'refCode', r.me.refCode);
      eq(r.me.referredBy, 'PAL99', 'referral attributed at join');
      eq(r.referredBy, 'PAL99', 'referredBy()');
      ok(r.sub.ok && r.sub.mode === 'demo', 'demo submit');
      ok(r.joinedEvt, 'ysd:joined event');
      eq(r.members[1], r.members[0] + 1, 'members counter bumped');
      ok(r.url.startsWith(base + '/join.html?') && r.url.includes('ref=' + r.me.refCode) && r.url.includes('utm_source=share'), 'share url', r.url);
      eq(r.native, 'copied', 'native() without Web Share copies');
      eq(r.clip, 'Join me ' + r.url, 'clipboard has text + url');
      eq(r.shared, 'shared', 'Web Share success');
      eq(r.cancelled, 'cancelled', 'Web Share AbortError -> cancelled');
      eq(r.notAllowed, 'copied', 'Web Share NotAllowedError -> copy fallback');
      ok(r.copyOk && r.clip2 === 'plain copy', 'copy()');

      const [dl] = await Promise.all([
        page.waitForEvent('download', { timeout: 5000 }),
        page.evaluate(() => window.YSD.cal.download({ id: 'ev1', title: 'Post-election debrief', start: '2026-11-14T10:00:00-05:00', location: 'Sanford' }))
      ]);
      eq(dl.suggestedFilename(), 'post-election-debrief.ics', 'ics filename');
      const icsText = fs.readFileSync(await dl.path(), 'utf8');
      ok(icsText.startsWith('BEGIN:VCALENDAR\r\n') && icsText.includes('DTSTART;TZID=America/New_York:20261114T100000\r\n'), 'downloaded ics content');
      ok(errs.length === 0, 'no page errors', errs);
      await ctx.close();
    });

    await section('browser(http): cards render, theme vars, toBlob, share/download', async () => {
      const ctx = await browser.newContext({ acceptDownloads: true });
      const errs = [];
      const page = await ctx.newPage();
      watch(page, errs);
      await page.goto(base + '/__core_test__.html');
      const r = await page.evaluate(async () => {
        const Y = window.YSD, out = {};
        out.list = Y.cards.list();
        const c = await Y.cards.render('joined', { name: 'Kira Q.', refCode: 'KIRA7QX', url: 'https://ysd.example/?ref=KIRA7QX' });
        out.story = [c.width, c.height, c.tagName];
        const px = c.getContext('2d').getImageData(2, 2, 1, 1).data;
        out.px = [px[0], px[1], px[2]];
        const sq = await Y.cards.render('pledge', { pledge: 'I will vote in every election, local ones too.', name: 'Kira', count: 12345 }, { size: 'square' });
        out.square = [sq.width, sq.height];
        const blob = await Y.cards.toBlob(sq);
        out.blob = [blob.type, blob.size];
        out.theme = Y.cards.theme();
        Y.cards.register('custom', (ctx, data, env) => new Promise((res) => {
          ctx.fillStyle = env.theme.pop; ctx.fillRect(0, 0, env.width, env.height); res();
        }), { size: 'square' });
        const cu = await Y.cards.render('custom', {}, { width: 600, height: 315, theme: { pop: '#ff0000' } });
        const p2 = cu.getContext('2d').getImageData(10, 10, 1, 1).data;
        out.custom = [cu.width, cu.height, p2[0], p2[1], p2[2]];
        try { await Y.cards.render('nope'); out.unknown = 'resolved'; } catch (e) { out.unknown = 'rejected'; }
        // DEMO mark: drawn by the engine unless the template (meta.demoMark) or the call (opts.demoMark) says it draws its own
        out.envMark = [];
        Y.cards.register('w-plain', (ctx, data, env) => { out.envMark.push('plain:' + env.demoMark); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, env.width, env.height); }, { size: 'square' });
        Y.cards.register('w-own', (ctx, data, env) => { out.envMark.push('own:' + env.demoMark); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, env.width, env.height); }, { size: 'square', demoMark: false });
        const dark = (cv) => { const s = cv.width / 1080, x = Math.round(cv.width - 200 * s), y = Math.round(cv.height - 110 * s); const d = cv.getContext('2d').getImageData(x, y, Math.round(180 * s), Math.round(100 * s)).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 600) n++; return n; };
        out.marks = [
          dark(await Y.cards.render('w-plain', {})),
          dark(await Y.cards.render('w-plain', {}, { demoMark: false })),
          dark(await Y.cards.render('w-own', {})),
          dark(await Y.cards.render('w-own', {}, { demoMark: true }))
        ];
        // helpers
        const t = document.createElement('canvas').getContext('2d');
        t.font = '40px sans-serif';
        const wr = Y.cards.wrapText(t, 'one two three four five six seven eight nine ten', 0, 0, 200, 48, { maxLines: 2, draw: false });
        out.wrap = [wr.lines.length, wr.truncated, wr.lines[1].slice(-1)];
        const fit = Y.cards.fitText(t, 'Hello world', 300, { max: 200, min: 10 });
        t.font = fit.font;
        out.fit = [fit.size, t.measureText('Hello world').width <= 300, fit.size > 10];
        const img = await Y.cards.loadImage('data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="red"/></svg>'));
        out.img = img.naturalWidth;
        out.fonts = await Y.cards.waitForFonts(['700 20px sans-serif'], 1000);
        window.__card = sq;
        return out;
      });
      ok(r.list.includes('joined') && r.list.includes('pledge'), 'built-in templates registered');
      eq(r.story.join('x'), '1080x1920xCANVAS', 'story preset 1080x1920 HTMLCanvasElement');
      ok(r.px[1] > 200 && r.px[0] < 40 && r.px[2] < 60, '--ysd-card-brand drives the card colour', r.px);
      eq(r.square.join('x'), '1080x1080', 'square preset');
      ok(r.blob[0] === 'image/png' && r.blob[1] > 5000, 'toBlob PNG', r.blob);
      eq(r.theme.brand, '#00ff00', 'theme reads --ysd-card-brand');
      eq(r.theme.accent, '#0000ff', 'theme falls back to --ysd-accent');
      eq(String(r.theme.pop).toUpperCase(), '#C8F03C', 'theme falls back to config hex (config.theme.pop)');
      eq(r.custom.join(','), '600,315,255,0,0', 'custom template, size and theme override');
      eq(r.unknown, 'rejected', 'unknown template rejects');
      ok(r.marks[0] > 200, 'engine DEMO mark drawn by default', r.marks);
      eq(r.marks[1], 0, 'render(..., {demoMark: false}): no engine DEMO mark');
      eq(r.marks[2], 0, 'register(..., {demoMark: false}): a template with its own mark gets no second one');
      ok(r.marks[3] > 200, 'opts.demoMark: true overrides the template', r.marks);
      eq(r.envMark.join(','), 'plain:true,plain:false,own:false,own:true', 'env.demoMark tells the template whether the engine draws the mark');
      ok(r.wrap[0] === 2 && r.wrap[1] === true && r.wrap[2] === '…', 'wrapText maxLines + ellipsis', r.wrap);
      ok(r.fit[1] && r.fit[2], 'fitText fits width', r.fit);
      eq(r.img, 4, 'loadImage (data: URL)');
      eq(r.fonts, true, 'waitForFonts resolves');

      // share(): no file sharing -> download
      const [dl] = await Promise.all([
        page.waitForEvent('download', { timeout: 5000 }),
        page.evaluate(() => { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); return window.YSD.cards.share(window.__card, { filename: 'my-pledge.png' }).then((x) => (window.__res = x)); })
      ]);
      eq(dl.suggestedFilename(), 'my-pledge.png', 'card download filename');
      eq(await page.evaluate(() => window.__res), 'downloaded', "share() -> 'downloaded'");
      const viaShare = await page.evaluate(async () => {
        let got = null;
        Object.defineProperty(navigator, 'share', { value: (d) => { got = d; return Promise.resolve(); }, configurable: true });
        Object.defineProperty(navigator, 'canShare', { value: (d) => !!(d && d.files), configurable: true });
        const res = await window.YSD.cards.share(window.__card, { title: 'Pledge', text: 'I pledged', url: 'https://ysd.example/p' });
        return { res, files: got && got.files.length, type: got && got.files[0].type, text: got && got.text };
      });
      eq(viaShare.res, 'shared', 'share() with Web Share files');
      ok(viaShare.files === 1 && viaShare.type === 'image/png' && viaShare.text === 'I pledged https://ysd.example/p', 'shared file + text with url', viaShare);
      ok(errs.length === 0, 'no page errors', errs);
      await ctx.close();
    });

    await section('browser(http): simulated squad growth + live counters (fake clock)', async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const errs = [];
      watch(page, errs);
      await page.clock.install({ time: new Date('2026-11-09T12:00:00-05:00') });
      await page.goto(base + '/__core_test__.html');
      await page.evaluate(() => {
        // opt in: both simulations are off by default (BRIEF 0)
        window.YSD_CONFIG.features.demoSquadGrowth = true;
        window.YSD_CONFIG.features.demoLiveCounters = true;
        if (window.YSD.counters.startLive) window.YSD.counters.startLive();
        window.__events = [];
        document.addEventListener('ysd:squad', (e) => window.__events.push(e.detail.added.length));
        window.__cb = 0;
        window.YSD.members.onSquad(() => { window.__cb++; });
        window.YSD.members.join({ firstName: 'Kira', email: 'k@x.io' });
        window.__c0 = Object.values(window.YSD.counters.all()).reduce((a, b) => a + b, 0);
      });
      await page.clock.runFor(4 * 60 * 1000);
      const r = await page.evaluate(() => ({
        squad: window.YSD.members.squad(), events: window.__events, cb: window.__cb,
        c1: Object.values(window.YSD.counters.all()).reduce((a, b) => a + b, 0)
      }));
      ok(r.squad.length >= 1 && r.squad.length <= 3, 'squad grows while the page is open', r.squad.length);
      ok(r.squad.every((x) => x.demo && x.simulated), 'simulated members flagged');
      ok(r.events.length >= 1 && r.cb >= 1, 'ysd:squad event + onSquad callback', r);
      ok(r.c1 > (await page.evaluate(() => window.__c0)), 'demo live counter ticks advance');
      ok(errs.length === 0, 'no page errors', errs);
      await ctx.close();
    });

    await section('browser: private window (storage and IndexedDB blocked)', async () => {
      const ctx = await browser.newContext();
      await ctx.addInitScript(() => {
        const deny = () => { throw new DOMException('The operation is insecure.', 'SecurityError'); };
        Object.defineProperty(window, 'localStorage', { get: deny, configurable: true });
        Object.defineProperty(window, 'sessionStorage', { get: deny, configurable: true });
        Object.defineProperty(window, 'indexedDB', { get: () => undefined, configurable: true });
      });
      const errs = [];
      const page = await ctx.newPage();
      watch(page, errs);
      await page.goto(base + '/__core_test__.html?ref=abc&debug=1');
      const r = await page.evaluate(async () => {
        const Y = window.YSD;
        Y.store.set('x', 1);
        await Y.db.put('b', 'i', new Blob(['z']));
        const me = Y.members.join({ firstName: 'Pat', email: 'p@x.io' });
        const c = await Y.cards.render('joined', { name: 'Pat', refCode: me.refCode });
        return { backend: Y.store.backend, x: Y.store.get('x'), db: await Y.db.ready(), blob: (await Y.db.get('b', 'i')).size,
          ref: me.referredBy, card: c.width, url: Y.share.url('a.html') };
      });
      eq(r.backend, 'memory', 'store memory fallback'); eq(r.x, 1, 'store works');
      eq(r.db, 'memory', 'db memory fallback'); eq(r.blob, 1, 'db works');
      eq(r.ref, 'ABC', 'referral works in memory'); eq(r.card, 1080, 'cards work');
      ok(errs.length === 0, 'no page errors', errs);
      await ctx.close();

      // quota exceeded: writes still readable, ysd:storage-full fires once
      const ctx2 = await browser.newContext();
      await ctx2.addInitScript(() => {
        const orig = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k, v) { if (String(k).indexOf('ysd:big') === 0) throw new DOMException('full', 'QuotaExceededError'); return orig.call(this, k, v); };
      });
      const p2 = await ctx2.newPage();
      const errs2 = [];
      watch(p2, errs2);
      await p2.goto(base + '/__core_test__.html');
      const q = await p2.evaluate(() => {
        let full = 0;
        document.addEventListener('ysd:storage-full', () => full++);
        window.YSD.store.set('big1', 'a'); window.YSD.store.set('big2', 'b');
        return { v: window.YSD.store.get('big2'), full, backend: window.YSD.store.backend };
      });
      ok(q.v === 'b' && q.full === 1 && q.backend === 'localStorage', 'quota overflow kept in memory + one event', q);
      ok(errs2.length === 0, 'no page errors (quota)', errs2);
      await ctx2.close();
    });

    await section('browser: debug logging via ?debug=1', async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const logs = [];
      page.on('console', (m) => logs.push(m.text()));
      await page.goto(base + '/__core_test__.html?debug=1');
      await page.evaluate(() => window.YSD.track('debug_check', { a: 1 }));
      ok(logs.some((l) => l.includes('[ysd] track') && l.includes('debug_check')), 'track logs with ?debug=1', logs);
      const page2 = await ctx.newPage();
      const logs2 = [];
      page2.on('console', (m) => logs2.push(m.text()));
      await page2.goto(base + '/__core_test__.html?debug=0');
      await page2.evaluate(() => window.YSD.track('quiet_check'));
      ok(!logs2.some((l) => l.includes('quiet_check')), 'silent without debug');
      await ctx.close();
    });

    await section('browser(file://): everything works without a server', async () => {
      const html = testPage(CORE.map((f) => pathToFileURL(path.join(ROOT, f)).href));
      const file = path.join(tmp, 'core-file-test.html');
      fs.writeFileSync(file, html);
      const ctx = await browser.newContext({ acceptDownloads: true });
      const errs = [];
      const page = await ctx.newPage();
      watch(page, errs);
      await page.goto(pathToFileURL(file).href + '?ref=filepal');
      const r = await page.evaluate(async () => {
        const Y = window.YSD;
        const me = Y.members.join({ firstName: 'Fi', email: 'f@x.io' });
        const c = await Y.cards.render('pledge', { pledge: 'Vote', name: 'Fi' }, { size: 'square' });
        const blob = await Y.cards.toBlob(c);
        return { root: Y.root, url: Y.share.url('join.html'), ref: me.referredBy, store: Y.store.backend, db: await Y.db.ready(), blob: blob.size,
          ics: Y.cal.text({ title: 't', start: '2026-11-14T10:00:00-05:00' }).length > 100 };
      });
      const rootUrl = pathToFileURL(ROOT).href + '/';
      eq(r.root, rootUrl, 'YSD.root on file://');
      ok(r.url.startsWith(rootUrl + 'join.html?'), 'share url on file:// resolves against site root', r.url);
      eq(r.ref, 'FILEPAL', 'ref capture on file://');
      ok(r.blob > 1000 && r.ics, 'cards + cal on file://');
      ok(errs.length === 0, 'no page errors (file://)', errs);
      console.log('      file:// backends: store=' + r.store + ' db=' + r.db);
      await ctx.close();
    });
  } finally {
    await browser.close();
    srv.close();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }
}

(async () => {
  const t0 = Date.now();
  await nodeTests();
  if (!NODE_ONLY) await browserTests();
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log('  - ' + f);
  }
  console.log('\ncore.test.js: ' + passed + ' passed, ' + failed + ' failed (' + secs + 's)');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
