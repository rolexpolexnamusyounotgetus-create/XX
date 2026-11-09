#!/usr/bin/env node
/*
 * Infra integration test: every module on ONE page, in the page builders' load order.
 *
 *   node tests/infra/integration.test.js
 *
 * Loads tests/infra/fixtures/integration.html (config, store, data/counters, share, cal, cards,
 * members, track, data/clips, clips, feed, sw-register) in headless Chromium (Playwright), served
 * by tools/check_site.js's static server WITH the production _headers applied, so the real
 * Content-Security-Policy is enforced. Then it drives each module contract from the page:
 *   - no console errors, page errors, CSP violations, failed same-origin requests or external
 *     requests (demo mode sends nothing)
 *   - every documented method exists with the right type (docs/infra/README.md cheat-sheet)
 *   - track.js replays calls queued before it loaded (share.js runs first)
 *   - a ?ref= link is captured; a joined member gets a refCode and keeps the referral; the share
 *     URL that member makes attributes a second visitor (another browser context) to them
 *   - an .ics validates: CRLF only, BEGIN/END pairs nest, folded lines <= 75 octets, round-trip
 *   - share cards render to a non-blank 1080x1920 canvas; CSS custom properties restyle them
 *   - demo clips list and their posters load; a member's own clip is added, listed and removed
 *   - YSD.feed.attach drives minimal markup: autoplay, keys, mute, double-tap like, reduced motion
 *   - the same stack also works from file://
 * Exits 1 on any failure.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE = 'tests/infra/fixtures/integration.html';
const { createServer, parseHeadersFile } = require(path.join(ROOT, 'tools', 'check_site.js'));

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
  const before = failed, t0 = Date.now();
  try { await fn(); } catch (e) { failed++; failures.push(name + ' threw: ' + (e && e.stack || e)); }
  console.log((failed === before ? 'ok   ' : 'FAIL ') + name + ' (' + (Date.now() - t0) + ' ms)');
}

// Documented public API (docs/infra/README.md). 'fn' = function, else the typeof value.
const API = {
  'YSD_CONFIG': 'object', 'YSD.cfg': 'fn', 'YSD.emit': 'fn', 'YSD.log': 'fn', 'YSD.root': 'string', 'YSD.debug': 'boolean', 'YSD.uid': 'fn',
  'YSD.store': ['get', 'set', 'update', 'remove', 'list', 'push', 'on', 'useAdapter', 'keys', 'clear'],
  'YSD.store.backend': 'string', 'YSD.store.persistent': 'boolean',
  'YSD.db': ['put', 'get', 'all', 'del', 'keys', 'clear', 'ready'], 'YSD.db.backend': 'string',
  'YSD.counters': ['get', 'bump', 'on', 'all', 'names', 'refresh', 'format', 'baseline', 'isDemo', 'startLive', 'stopLive', 'resetDemo'],
  'YSD.share': ['captureRef', 'ref', 'utm', 'myCode', 'normCode', 'root', 'url', 'native', 'copy', 'links', 'actblue'],
  'YSD.cal': ['text', 'ics', 'dataUrl', 'download', 'google', 'outlook', 'links'], 'YSD.cal.TZID': 'string',
  'YSD.cards': ['register', 'render', 'toBlob', 'share', 'download', 'theme', 'has', 'list', 'isTainted',
    'roundRect', 'wrapText', 'fitText', 'font', 'gradient', 'sticker', 'loadImage', 'cover', 'waitForFonts'],
  'YSD.cards.h': ['roundRect', 'wrapText', 'fitText', 'font', 'gradient', 'sticker', 'loadImage', 'cover', 'waitForFonts'],
  'YSD.cards.sizes': 'object',
  'YSD.members': ['validate', 'join', 'current', 'isMember', 'referredBy', 'squad', 'refreshSquad', 'onSquad', 'submit', 'retry', 'makeRefCode', 'forget', 'shareUrl'],
  'YSD.track': 'fn', 'YSD.track.pageview': 'fn', 'YSD.track.enabled': 'fn', 'YSD.track.history': 'fn', 'YSD.track.clean': 'fn',
  'YSD.clips': ['add', 'list', 'get', 'like', 'remove', 'validate', 'check', 'probe', 'unlike', 'toggleLike', 'liked', 'view', 'stats',
    'unhide', 'unhideAll', 'url', 'posterUrl', 'release', 'releaseAll', 'upload', 'retry', 'cancelUpload', 'status', 'uploadEnabled',
    'useSource', 'onChange', 'requestPersist', 'reset', 'limits', 'resolve', 'orientationOf'],
  'YSD.clips.messages': 'object', 'YSD.clips.format.bytes': 'fn', 'YSD.clips.format.duration': 'fn', 'YSD.clips.keys': 'object',
  'YSD.feed': ['attach', 'mount', 'template', 'injectFallbackStyles', 'instances', 'escape'], 'YSD.feed.defaults': 'object',
  'YSD.sw': ['enabled', 'register', 'unregister', 'update', 'applyUpdate'], 'YSD.sw.status': 'string'
};
function apiPaths() {
  const out = {};
  for (const [k, v] of Object.entries(API)) {
    if (Array.isArray(v)) v.forEach((m) => { out[k + '.' + m] = 'fn'; });
    else out[k] = v;
  }
  return out;
}

const EVENT = {
  id: 'itest-meetup-2026-11-14',
  title: 'Itest meetup at Lake Mary; coffee, signs, and \u00e9nergie \ud83c\udf89',
  start: '2026-11-14T10:00:00-05:00',
  end: '2026-11-14T12:00:00-05:00',
  location: 'Placeholder venue',
  address: '100 Placeholder St, Lake Mary, FL 32746',
  description: 'Line one with a comma, a semicolon; and a backslash \\.\nLine two is long enough to fold more than once: ' +
    'caf\u00e9 \u00fcber na\u00efve \u2014 \ud83d\uddf3\ufe0f '.repeat(6),
  url: 'https://example.org/events/itest'
};

/** Validate .ics text in Node. Returns a list of problems ([] = valid). */
function icsProblems(text) {
  const p = [];
  if (!text.endsWith('\r\n')) p.push('does not end with CRLF');
  if (/[^\r]\n/.test(text) || /\r(?!\n)/.test(text)) p.push('bare LF or CR found');
  const physical = text.split('\r\n').slice(0, -1);
  physical.forEach((l, i) => {
    const n = Buffer.byteLength(l, 'utf8');
    if (n > 75) p.push('line ' + (i + 1) + ' is ' + n + ' octets');
    if (/[\ud800-\udbff]$/.test(l)) p.push('line ' + (i + 1) + ' splits a surrogate pair');
  });
  if (Buffer.from(text, 'utf8').toString('utf8') !== text) p.push('not valid UTF-8');
  const logical = text.replace(/\r\n[ \t]/g, '').split('\r\n').slice(0, -1);
  const stack = [];
  logical.forEach((l) => {
    let m = /^BEGIN:(.+)$/.exec(l);
    if (m) { stack.push(m[1]); return; }
    m = /^END:(.+)$/.exec(l);
    if (m) { const top = stack.pop(); if (top !== m[1]) p.push('END:' + m[1] + ' closes ' + top); }
    else if (!/^[A-Z][A-Z0-9-]*[;:]/.test(l)) p.push('bad content line: ' + l.slice(0, 40));
  });
  if (stack.length) p.push('unclosed: ' + stack.join(','));
  if (logical[0] !== 'BEGIN:VCALENDAR' || logical[logical.length - 1] !== 'END:VCALENDAR') p.push('not wrapped in VCALENDAR');
  return p;
}
function icsProp(text, name) {
  const logical = text.replace(/\r\n[ \t]/g, '').split('\r\n');
  const line = logical.find((l) => l.startsWith(name + ':') || l.startsWith(name + ';'));
  return line ? line.slice(line.indexOf(':') + 1) : null;
}
function icsUnescape(v) { return String(v).replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1'); }

function watch(page, sink, base) {
  page.on('pageerror', (e) => sink.errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') sink.errors.push('console.error: ' + m.text()); });
  page.on('request', (r) => {
    const u = r.url();
    if (!(base && u.startsWith(base)) && !/^(data|blob|file):/.test(u)) sink.external.push(u);
  });
  page.on('requestfailed', (r) => {
    const u = r.url();
    // Media elements abort range requests when a feed pauses or unloads a clip; that is not a failure.
    if (/\.(mp4|webm)(\?|$)/.test(u) && /ERR_ABORTED/.test(String(r.failure() && r.failure().errorText))) return;
    if (!/favicon\.ico$/.test(u)) sink.failed.push(u + ' ' + (r.failure() && r.failure().errorText));
  });
  page.on('response', (r) => { if (r.status() >= 400 && !/favicon\.ico$/.test(r.url())) sink.failed.push(r.url() + ' ' + r.status()); });
}
function newSink() { return { errors: [], external: [], failed: [] }; }
async function cspProbe(ctx) {
  await ctx.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
  });
}
function checkSink(sink, label) {
  ok(sink.errors.length === 0, label + ': no console or page errors', sink.errors);
  ok(sink.failed.length === 0, label + ': no failed same-origin requests', sink.failed);
  ok(sink.external.length === 0, label + ': demo mode makes no external requests', sink.external);
}

async function main() {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) {
    ok(false, 'playwright is installed', e.message);
    return finish();
  }
  const headers = parseHeadersFile(fs.readFileSync(path.join(ROOT, '_headers'), 'utf8'));
  const srv = createServer(ROOT, { headers });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const pageUrl = base + '/' + FIXTURE;
  const browser = await chromium.launch();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ysd-integration-'));
  const state = {};

  try {
    // ------------------------------------------------------------------ main context
    const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 390, height: 844 } });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
    await cspProbe(ctx);
    const sink = newSink();
    const page = await ctx.newPage();
    watch(page, sink, base);

    await section('page loads every module with the production CSP', async () => {
      const res = await page.goto(pageUrl + '?ref=frnd42&utm_source=tiktok&utm_campaign=fall', { waitUntil: 'load' });
      eq(res.status(), 200, 'fixture served');
      const csp = res.headers()['content-security-policy'] || '';
      ok(/script-src 'self'/.test(csp), 'served with the _headers CSP', csp);
      await page.waitForFunction(() => window.YSD && window.YSD.sw && window.YSD.sw.status !== 'idle', null, { timeout: 5000 });
      const r = await page.evaluate(() => ({ root: YSD.root, csp: window.__csp.slice(), sw: YSD.sw.status, swWhy: YSD.sw.enabled() }));
      eq(r.root, base + '/', 'YSD.root is the site root, from a page two folders down');
      ok(r.csp.length === 0, 'no CSP violations on load', r.csp);
      eq(r.sw, 'disabled', 'service worker stays off in demo mode');
      eq(r.swWhy && r.swWhy.reason, 'demo', 'sw reason: demo');
    });

    await section('every documented method exists with the right shape', async () => {
      const paths = apiPaths();
      const types = await page.evaluate((list) => {
        const out = {};
        for (const p of list) {
          let cur = window;
          for (const part of p.split('.')) cur = cur == null ? undefined : cur[part];
          out[p] = typeof cur;
        }
        return out;
      }, Object.keys(paths));
      const bad = Object.keys(paths).filter((p) => types[p] !== (paths[p] === 'fn' ? 'function' : paths[p]));
      ok(bad.length === 0, Object.keys(paths).length + ' API paths present with the right type', bad.map((p) => p + ' is ' + types[p]));
      const r = await page.evaluate(async () => {
        const Y = window.YSD, out = {};
        const thenable = (x) => !!x && typeof x.then === 'function';
        const off1 = Y.store.on('itest:k', () => {}), off2 = Y.counters.on('itest', () => {});
        out.unsub = typeof off1 === 'function' && typeof off2 === 'function';
        off1(); off2();
        out.dbPromises = [Y.db.put('itest', 'a', 1), Y.db.get('itest', 'a'), Y.db.all('itest'), Y.db.del('itest', 'a'), Y.db.ready()].every(thenable);
        out.linkKeys = Object.keys(Y.share.links('t', 'https://example.org/')).sort();
        out.sizes = Y.cards.sizes;
        const v = Y.clips.validate({ name: 'notes.txt', type: 'text/plain', size: 10 });
        out.validate = { ok: v.ok, reasonType: typeof v.reason, code: v.code };
        out.renderThenable = thenable(Y.cards.render('nope-not-registered').catch(() => null));
        out.listThenable = thenable(Y.clips.list());
        out.trackReturns = Y.track('itest_shape', { a: 1 });
        out.cfg = [Y.cfg('org.timezone'), Y.cfg('no.such.path', 'fb')];
        out.limits = Y.clips.limits();
        out.pwa = Y.cfg('pwa');
        return out;
      });
      ok(r.unsub, 'store.on and counters.on return unsubscribe functions');
      ok(r.dbPromises, 'db.put/get/all/del/ready return Promises');
      eq(r.linkKeys.join(','), 'bluesky,email,facebook,sms,telegram,threads,whatsapp,x', 'share.links keys');
      ok(r.sizes.story.width === 1080 && r.sizes.story.height === 1920 && r.sizes.square.width === 1080 && r.sizes.square.height === 1080, 'card presets story 1080x1920, square 1080x1080', r.sizes);
      ok(r.validate.ok === false && r.validate.reasonType === 'string' && r.validate.code === 'type', 'clips.validate -> {ok:false, reason}', r.validate);
      ok(r.renderThenable && r.listThenable, 'cards.render and clips.list return Promises');
      eq(r.trackReturns, false, 'YSD.track sends nothing in demo mode');
      eq(r.cfg[0], 'America/New_York', 'YSD.cfg reads config'); eq(r.cfg[1], 'fb', 'YSD.cfg fallback');
      ok(r.limits.maxBytes === 157286400 && r.limits.maxDuration === 180, 'clips limits come from YSD_CONFIG.clips', r.limits);
      ok(r.pwa && r.pwa.serviceWorker === true && r.pwa.serviceWorkerInDemo === false && r.pwa.swUrl === 'sw.js', 'YSD_CONFIG.pwa block for sw-register', r.pwa);
    });

    await section('track.js replays calls queued before it loaded', async () => {
      const h = await page.evaluate(() => YSD.track.history());
      const refEv = h.find((x) => x.event === 'ref_captured');
      ok(!!refEv && refEv.props.ref === 'FRND42', 'ref_captured (sent by share.js before track.js loaded) is in history', h.map((x) => x.event));
      ok(h.some((x) => x.event === 'itest_shape'), 'direct track() call recorded');
    });

    await section('referral: ?ref= captured, member joins with a refCode, attribution kept', async () => {
      const r = await page.evaluate(async () => {
        const Y = window.YSD, out = {};
        out.ref = Y.share.ref(); out.utm = Y.share.utm();
        out.pendingReferredBy = Y.members.referredBy();
        let joined = null; document.addEventListener('ysd:joined', (e) => { joined = e.detail; }, { once: true });
        const c0 = Y.counters.get('members');
        const v = Y.members.validate({ firstName: 'Kira', email: 'kira@example.com', zip: '32746', age: 30 });
        out.valid = v.ok;
        const me = Y.members.join({ firstName: 'Kira', lastName: 'Demo', email: 'kira@example.com', zip: '32746', age: 30 });
        out.me = me; out.submitted = await me.submitted;
        out.joinedEvt = !!(joined && joined.isNew);
        out.members = [c0, Y.counters.get('members')];
        out.current = Y.members.current();
        out.referredBy = Y.members.referredBy();
        out.stored = Y.store.get('member');
        out.myCode = Y.share.myCode();
        out.shareUrl = Y.share.url('join.html');
        out.membersShareUrl = Y.members.shareUrl('join.html');
        out.pageUrl = Y.share.url('tests/infra/fixtures/integration.html', { utm_medium: 'sms' });
        out.actblue = Y.share.actblue(25);
        out.actblueMine = Y.share.actblue(10, { mine: true });
        out.squadNow = Y.members.squad().length;
        out.squadLater = Y.members.squad({ now: Date.now() + 3 * 3600e3 });
        out.trackJoin = Y.track.history().filter((x) => x.event === 'join').map((x) => x.props);
        return out;
      });
      eq(r.ref, 'FRND42', 'share.ref() captured ?ref= upper-cased');
      eq(r.utm.utm_source, 'tiktok', 'utm captured');
      eq(r.pendingReferredBy, 'FRND42', 'members.referredBy() before joining = captured ref');
      ok(r.valid, 'members.validate ok');
      ok(/^KIRA[BCDFGHJKMNPQRSTVWXZ2-9]{3}$/.test(r.me.refCode), 'joined member gets a readable refCode', r.me.refCode);
      ok(typeof r.me.id === 'string' && r.me.id.length > 4, 'member id');
      eq(r.me.referredBy, 'FRND42', 'member.referredBy = the ?ref= code');
      eq(r.me.utm && r.me.utm.utm_source, 'tiktok', 'member keeps first-visit utm');
      ok(r.submitted && r.submitted.ok === true && r.submitted.mode === 'demo', 'member.submitted resolves {ok, mode:demo}', r.submitted);
      ok(r.joinedEvt, 'ysd:joined fired with isNew');
      eq(r.members[1], r.members[0] + 1, 'join bumps the members counter');
      eq(r.current && r.current.refCode, r.me.refCode, 'members.current()');
      eq(r.stored && r.stored.refCode, r.me.refCode, "stored under store key 'member'");
      eq(r.referredBy, 'FRND42', 'referredBy frozen at join');
      eq(r.myCode, r.me.refCode, 'share.myCode() reads the member');
      const su = new URL(r.shareUrl);
      eq(su.origin + su.pathname, base + '/join.html', 'share.url resolves against YSD.root');
      eq(su.searchParams.get('ref'), r.me.refCode, 'share.url carries my refCode');
      eq(su.searchParams.get('utm_source'), 'share', 'share.url carries default utm');
      eq(r.membersShareUrl, r.shareUrl, 'members.shareUrl = share.url');
      const ab = new URL(r.actblue);
      ok(/actblue\.com$/.test(ab.hostname), 'actblue URL from config.links.actblue', r.actblue);
      eq(ab.searchParams.get('amount'), '25', 'actblue amount');
      eq(ab.searchParams.get('refcode'), 'ref_FRND42', 'actblue refcode credits the referrer');
      eq(ab.searchParams.get('refcode2'), 'utm_tiktok', 'actblue refcode2 = utm_source');
      eq(new URL(r.actblueMine).searchParams.get('refcode'), 'ref_' + r.me.refCode, 'actblue {mine:true} uses my code');
      eq(r.squadNow, 0, 'no squad right after joining');
      ok(r.squadLater.length >= 3 && r.squadLater.every((s) => s.demo === true && s.simulated === true && s.referredBy === r.me.refCode),
        'simulated demo squad appears over time, flagged demo+simulated', r.squadLater);
      ok(r.trackJoin.length === 1 && r.trackJoin[0].referred === 'true' && !('email' in r.trackJoin[0]), 'track join {referred} without personal data', r.trackJoin);
      state.me = r.me; state.pageUrl = r.pageUrl;
    });

    await section('referral: my share link attributes a second visitor (other browser)', async () => {
      const ctx2 = await browser.newContext();
      await cspProbe(ctx2);
      const sink2 = newSink();
      const p2 = await ctx2.newPage();
      watch(p2, sink2, base);
      const link = new URL(state.pageUrl);
      eq(link.origin + link.pathname, pageUrl, 'share.url built a link to the page');
      await p2.goto(state.pageUrl);
      const r = await p2.evaluate(() => {
        const Y = window.YSD;
        const before = Y.share.ref();
        const friend = Y.members.join({ firstName: 'Ana', phone: '(407) 555-0100' });
        return { before, friend, utm: Y.share.utm(), csp: window.__csp.slice() };
      });
      eq(r.before, state.me.refCode, 'visitor captured my refCode');
      eq(r.friend.referredBy, state.me.refCode, "friend's member record is referred by me");
      ok(r.friend.refCode && r.friend.refCode !== state.me.refCode, 'friend gets their own refCode');
      eq(r.utm.utm_medium, 'sms', 'friend carries the utm tags from my link');
      ok(r.csp.length === 0, 'no CSP violations (second context)', r.csp);
      checkSink(sink2, 'second context');
      await ctx2.close();

      // Back in the first browser: a link with my own code is not a referral; data survives a reload.
      await page.goto(pageUrl + '?ref=' + state.me.refCode.toLowerCase());
      const r2 = await page.evaluate(() => ({ ref: YSD.share.ref(), me: YSD.members.current(), by: YSD.members.referredBy() }));
      eq(r2.ref, 'FRND42', 'my own code is never captured as a referral');
      eq(r2.me && r2.me.refCode, state.me.refCode, 'member survives a reload');
      eq(r2.by, 'FRND42', 'referredBy survives a reload');
    });

    await section('store, db and counters work together on the page (and across tabs)', async () => {
      const page2 = await ctx.newPage();
      watch(page2, sink, base);
      await page2.goto(pageUrl);
      await page2.evaluate(() => {
        window.__got = [];
        YSD.store.on('itest:x', (v, info) => window.__got.push(['store', v, info.source]));
        YSD.counters.on('rsvps', (v) => window.__got.push(['rsvps', v]));
      });
      const r = await page.evaluate(async () => {
        const Y = window.YSD, out = {}, seen = [];
        const off = Y.store.on('itest:x', (v, info) => seen.push(info.source));
        Y.store.set('itest:x', { n: 1 });
        out.update = Y.store.update('itest:n', (v) => (v || 0) + 5);
        Y.store.push('itest:list', { a: 1 });
        out.list = Y.store.list('itest:list');
        out.raw = localStorage.getItem('ysd:itest:x');
        out.seen = seen.slice(); off();
        out.dbBackend = await Y.db.ready();
        await Y.db.put('itest', 'blob', new Blob(['x'.repeat(1000)], { type: 'video/mp4' }));
        const b = await Y.db.get('itest', 'blob');
        out.blob = b && [b.size, b.type];
        out.all = (await Y.db.all('itest')).length;
        await Y.db.del('itest', 'blob');
        out.gone = await Y.db.get('itest', 'blob');
        out.r0 = Y.counters.get('rsvps');
        out.r1 = Y.counters.bump('rsvps');
        out.fmt = Y.counters.format(12500);
        out.isDemo = Y.counters.isDemo('members');
        return out;
      });
      eq(r.raw, '{"n":1}', 'store keys are namespaced ysd:');
      eq(r.seen.join(), 'local', 'store.on fires for same-tab writes');
      eq(r.update, 5, 'store.update');
      ok(r.list.length === 1 && r.list[0].id && r.list[0].ts, 'store.push adds id and ts');
      eq(r.dbBackend, 'indexeddb', 'db uses IndexedDB');
      ok(r.blob && r.blob[0] === 1000 && r.blob[1] === 'video/mp4', 'db Blob round-trip', r.blob);
      eq(r.all, 1, 'db.all'); eq(r.gone, null, 'db.del');
      eq(r.r1, r.r0 + 1, 'counters.bump returns the new value');
      ok(r.r0 >= 168, 'counters seeded from data/counters.js baselines', r.r0);
      eq(r.fmt, '12.5K', 'counters.format');
      eq(r.isDemo, true, 'demo counters flagged demo');
      await page2.waitForFunction(() => window.__got.length >= 2, null, { timeout: 5000 });
      const got = await page2.evaluate(() => window.__got);
      ok(got.some((g) => g[0] === 'store' && g[2] === 'remote'), 'store.on fires for another tab', got);
      ok(got.some((g) => g[0] === 'rsvps' && g[1] === r.r1), 'counters.on fires for another tab', got);
      await page2.close();
    });

    await section('cal: .ics validates (CRLF, BEGIN/END, folding) and links/download work', async () => {
      const r = await page.evaluate(async (ev) => {
        const Y = window.YSD;
        const blob = Y.cal.ics(ev);
        return {
          type: blob.type, text: await blob.text(), google: Y.cal.google(ev), outlook: Y.cal.outlook(ev),
          office: Y.cal.outlook(ev, { office: true }), links: Object.keys(Y.cal.links(ev)).sort(),
          prodId: Y.cfg('cal.prodId'), uidDomain: Y.cfg('site.uidDomain') || location.hostname,
          allDay: Y.cal.text({ title: 'Day', start: '2026-12-31' })
        };
      }, EVENT);
      eq(r.type, 'text/calendar;charset=utf-8', 'ics() returns a text/calendar Blob');
      const probs = icsProblems(r.text);
      ok(probs.length === 0, 'ics: CRLF only, BEGIN/END pairs nest, every line <= 75 octets', probs);
      ok(r.text.split('\r\n').some((l) => l.startsWith(' ')), 'long lines are folded (continuation lines start with a space)');
      for (const need of ['VERSION', 'PRODID', 'UID', 'DTSTAMP', 'DTSTART', 'DTEND', 'SUMMARY', 'LOCATION', 'DESCRIPTION', 'URL']) ok(icsProp(r.text, need) !== null, 'ics has ' + need);
      eq(icsProp(r.text, 'PRODID'), r.prodId, 'PRODID comes from config cal.prodId');
      ok(/^DTSTART;TZID=America\/New_York:20261114T100000$/m.test(r.text.replace(/\r\n[ \t]/g, '')), 'DTSTART in New York wall time');
      ok(/BEGIN:VTIMEZONE/.test(r.text), 'VTIMEZONE included');
      eq(icsProp(r.text, 'UID'), 'itest-meetup-2026-11-14@' + r.uidDomain, 'UID = id@(site.uidDomain, else host) while site.url is empty');
      eq(icsUnescape(icsProp(r.text, 'SUMMARY')), EVENT.title, 'SUMMARY round-trips (escaping + UTF-8 folding)');
      eq(icsUnescape(icsProp(r.text, 'DESCRIPTION')), EVENT.description + '\n\n' + EVENT.url, 'DESCRIPTION round-trips with the url appended');
      ok(icsProblems(r.allDay).length === 0 && /DTSTART;VALUE=DATE:20261231/.test(r.allDay), 'all-day event validates');
      const g = new URL(r.google);
      eq(g.hostname, 'calendar.google.com', 'google() host');
      eq(g.searchParams.get('dates'), '20261114T150000Z/20261114T170000Z', 'google() UTC dates');
      const o = new URL(r.outlook);
      eq(o.hostname, 'outlook.live.com', 'outlook() host');
      eq(o.searchParams.get('startdt'), '2026-11-14T15:00:00Z', 'outlook() start');
      eq(new URL(r.office).hostname, 'outlook.office.com', 'outlook({office:true}) host');
      eq(r.links.join(), 'google,ics,office365,outlook', 'cal.links keys');
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), page.evaluate((ev) => YSD.cal.download(ev), EVENT)]);
      ok(/\.ics$/.test(dl.suggestedFilename()) && /^itest-meetup/.test(dl.suggestedFilename()), 'download() saves <slug>.ics', dl.suggestedFilename());
      const file = path.join(tmp, dl.suggestedFilename());
      await dl.saveAs(file);
      const saved = fs.readFileSync(file, 'utf8');
      ok(icsProblems(saved).length === 0 && icsProp(saved, 'UID') === icsProp(r.text, 'UID'), 'downloaded .ics validates and matches', icsProblems(saved));
    });

    await section('cards: share card renders to a non-blank 1080x1920 canvas', async () => {
      const r = await page.evaluate(async () => {
        const Y = window.YSD, out = {};
        const me = Y.members.current();
        let rendered = null; document.addEventListener('ysd:card-rendered', (e) => { rendered = e.detail; }, { once: true });
        const c = await Y.cards.render('joined', { name: me.firstName, refCode: me.refCode, url: Y.share.url('join.html') }, { size: 'story' });
        out.isCanvas = c instanceof HTMLCanvasElement;
        out.size = [c.width, c.height];
        out.evt = rendered && [rendered.name, rendered.width, rendered.height];
        const ctx = c.getContext('2d'), d = ctx.getImageData(0, 0, c.width, c.height).data;
        const colors = new Set();
        let opaque = 0, samples = 0;
        for (let y = 0; y < c.height; y += 16) for (let x = 0; x < c.width; x += 16) {
          const i = (y * c.width + x) * 4;
          samples++; if (d[i + 3] > 0) opaque++;
          colors.add((d[i] >> 3) + ',' + (d[i + 1] >> 3) + ',' + (d[i + 2] >> 3));
        }
        out.opaque = opaque / samples; out.colors = colors.size;
        const blob = await Y.cards.toBlob(c);
        out.blob = [blob.type, blob.size];
        window.__card = c;
        // Custom template + CSS custom properties: the design team restyles without touching the engine.
        document.documentElement.style.setProperty('--ysd-card-bg', '#123456');
        document.documentElement.style.setProperty('--ysd-pop', '#fedcba');
        Y.cards.register('itest', (cx, data, env) => {
          cx.fillStyle = env.theme.bg; cx.fillRect(0, 0, env.width, env.height);
          cx.fillStyle = env.theme.pop; cx.fillRect(0, 0, 40 * env.scale, 40 * env.scale);
          env.h.roundRect(cx, 100, 100, 300, 200, 24, { fill: env.theme.brand });
          cx.fillStyle = env.theme.fg; cx.font = env.h.font(64, 800, env.theme.fontDisplay);
          env.h.wrapText(cx, data.text, 100, 400, 800, 72, { maxLines: 3 });
        });
        out.has = Y.cards.has('itest') && Y.cards.list().indexOf('itest') >= 0;
        const sq = await Y.cards.render('itest', { text: 'Square card from a custom template' }, { width: 1080, height: 1080 });
        const sctx = sq.getContext('2d');
        out.sq = [sq.width, sq.height];
        out.bgPx = Array.from(sctx.getImageData(600, 900, 1, 1).data).slice(0, 3);
        out.popPx = Array.from(sctx.getImageData(10, 10, 1, 1).data).slice(0, 3);
        const preset = await Y.cards.render('pledge', { pledge: 'I will vote in every election.', name: me.firstName, count: Y.counters.get('pledges') }, { size: 'square' });
        out.preset = [preset.width, preset.height];
        document.documentElement.style.removeProperty('--ysd-card-bg');
        document.documentElement.style.removeProperty('--ysd-pop');
        out.cards0 = Y.counters.get('cards');
        return out;
      });
      ok(r.isCanvas, 'render() resolves to an HTMLCanvasElement');
      eq(r.size.join('x'), '1080x1920', 'story card is 1080x1920');
      ok(r.evt && r.evt[0] === 'joined' && r.evt[1] === 1080, 'ysd:card-rendered fired', r.evt);
      eq(r.opaque, 1, 'card is fully painted');
      ok(r.colors >= 30, 'card is not blank (many distinct colours)', r.colors);
      ok(r.blob[0] === 'image/png' && r.blob[1] > 20000, 'toBlob -> PNG', r.blob);
      ok(r.has, 'register() adds a template');
      eq(r.sq.join('x'), '1080x1080', 'render(name, data, {width, height})');
      eq(r.bgPx.join(), '18,52,86', '--ysd-card-bg CSS variable themes the card');
      eq(r.popPx.join(), '254,220,186', '--ysd-pop CSS variable is the fallback for --ysd-card-pop');
      eq(r.preset.join('x'), '1080x1080', "size: 'square' preset");
      // share(): Web Share with files when the browser has it, else a download.
      const dlP = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
      const res = await page.evaluate(() => YSD.cards.share(window.__card, { title: 'I joined', text: 'Join my squad', filename: 'itest-card.png' }));
      ok(res === 'shared' || res === 'downloaded', 'cards.share -> shared or downloaded', res);
      if (res === 'downloaded') { const dl = await dlP; eq(dl && dl.suggestedFilename(), 'itest-card.png', 'card download keeps the filename'); }
      eq(await page.evaluate(() => YSD.counters.get('cards')), r.cards0 + 1, 'card share bumps the cards counter');
      // share.native(): copy fallback where Web Share is missing.
      const s = await page.evaluate(async () => {
        const s0 = YSD.counters.get('shares');
        const url = YSD.share.url('join.html');
        const res = await YSD.share.native({ title: 'Join', text: 'Join me', url });
        let clip = null;
        try { clip = await navigator.clipboard.readText(); } catch (e) {}
        return { res, url, clip, s0, s1: YSD.counters.get('shares') };
      });
      ok(s.res === 'shared' || s.res === 'copied', 'share.native -> shared or copied', s.res);
      if (s.res === 'copied') eq(s.clip, 'Join me ' + s.url, 'copy fallback puts "text url" on the clipboard');
      eq(s.s1, s.s0 + 1, 'share bumps the shares counter');
    });

    await section('clips: demo clips list, posters load, own clip add/list/remove', async () => {
      const r = await page.evaluate(async () => {
        const Y = window.YSD, out = {};
        const all = await Y.clips.list({ sort: 'new' });
        out.count = all.length;
        out.demoFlags = all.every((c) => c.demo === true && c.source === 'demo');
        out.first = all[0] && { id: all[0].id, src: all[0].src, poster: all[0].poster, author: all[0].author, orientation: all[0].orientation };
        out.sorted = all.every((c, i) => i === 0 || Date.parse(all[i - 1].createdAt) >= Date.parse(c.createdAt));
        out.posters = await Promise.all(all.map((c) => new Promise((res) => {
          const img = new Image();
          img.onload = () => res([c.id, img.naturalWidth, img.naturalHeight]);
          img.onerror = () => res([c.id, 0, 0]);
          img.src = c.poster;
        })));
        const head = await fetch(all[0].src, { method: 'HEAD' });
        out.srcStatus = head.status;
        const one = await Y.clips.get('demo-first-time-voter');
        out.get = one && one.id;
        const l0 = one.likes;
        let likedEvt = null; document.addEventListener('ysd:clip-liked', (e) => { likedEvt = e.detail; }, { once: true });
        const st = Y.clips.like('demo-first-time-voter');
        out.like = [l0, st.likes, st.liked, Y.clips.liked('demo-first-time-voter'), !!likedEvt];
        out.top = (await Y.clips.list({ sort: 'top' })).map((c) => c.likes);
        // A member's own clip, through YSD.db and YSD.members.
        const blob = await (await fetch(Y.root + 'assets/video/first-time-voter.mp4')).blob();
        const file = new File([blob], 'my-clip.mp4', { type: 'video/mp4' });
        out.validOwn = Y.clips.validate(file).ok;
        let added = null; document.addEventListener('ysd:clip-added', (e) => { added = e.detail; }, { once: true });
        const clip = await Y.clips.add(file, { caption: '<b>first</b> clip', tags: '#Vote, seminole' });
        out.added = { mine: clip.mine, source: clip.source, src: String(clip.src).slice(0, 5), poster: String(clip.poster).slice(0, 5),
          author: clip.author, tags: clip.tags, caption: clip.caption, duration: clip.duration, orientation: clip.orientation, status: clip.status, evt: !!added };
        out.mine = (await Y.clips.list({ mine: true })).map((c) => c.id);
        out.inAll = (await Y.clips.list()).some((c) => c.id === clip.id);
        out.stored = !!(await Y.db.get('clips', clip.id));
        out.urlSame = (await Y.clips.url(clip.id)) === clip.src;
        await Y.clips.remove(clip.id);
        out.afterRemove = (await Y.clips.list({ mine: true })).length;
        out.storedAfter = await Y.db.get('clips', clip.id);
        out.track = Y.track.history().map((x) => x.event).filter((e) => /^clip_/.test(e));
        return out;
      });
      eq(r.count, 6, 'six demo clips list in demo mode');
      ok(r.demoFlags, 'demo clips are flagged demo');
      ok(r.sorted, "list({sort:'new'}) is newest first");
      ok(r.first.src.startsWith(base + '/assets/video/') && r.first.poster.startsWith(base + '/assets/video/'), 'clip src/poster resolve against the site root', r.first);
      ok(/^@demo\./.test(r.first.author.handle), 'demo creator handles are marked @demo.*', r.first.author);
      ok(r.posters.every((p) => p[1] === 720 && p[2] === 1280), 'every poster loads (720x1280)', r.posters);
      eq(r.srcStatus, 200, 'clip video file is served');
      eq(r.get, 'demo-first-time-voter', 'clips.get(id)');
      ok(r.like[1] === r.like[0] + 1 && r.like[2] && r.like[3] && r.like[4], 'clips.like -> +1, liked, ysd:clip-liked', r.like);
      ok(r.top.every((n, i) => i === 0 || r.top[i - 1] >= n), "list({sort:'top'}) by likes", r.top);
      ok(r.validOwn, 'validate(mp4 File) ok');
      const a = r.added;
      ok(a.mine && a.source === 'local' && a.src === 'blob:' && a.poster === 'blob:', 'own clip plays from blob: URLs', a);
      eq(a.author && a.author.name, 'Kira', 'own clip author comes from YSD.members.current()');
      eq(a.tags.join(), 'vote,seminole', 'tags normalised');
      eq(a.caption, '<b>first</b> clip', 'caption kept as plain text (pages must use textContent)');
      ok(a.duration > 8 && a.duration < 12 && a.orientation === 'vertical', 'probe read duration and orientation', a);
      eq(a.status, 'local', 'demo mode: clip stays local (no upload)');
      ok(a.evt, 'ysd:clip-added fired');
      eq(r.mine.length, 1, 'list({mine:true}) has my clip');
      ok(r.inAll && r.stored && r.urlSame, 'own clip in list(), stored in YSD.db, url() is the same object URL');
      eq(r.afterRemove, 0, 'remove(id) deletes it');
      eq(r.storedAfter, null, 'remove(id) deletes the stored file');
      ok(['clip_like', 'clip_add', 'clip_remove'].every((e) => r.track.indexOf(e) >= 0), 'clip events reach YSD.track', r.track);
    });

    await section('feed: attach() drives minimal markup (autoplay, keys, mute, double-tap like)', async () => {
      await page.evaluate(() => { window.scrollTo(0, 0); window.__feedEvents = []; ['change', 'play', 'like', 'mute'].forEach((n) => document.addEventListener('ysd:feed-' + n, (e) => window.__feedEvents.push([n, e.detail.index, e.detail.x, e.detail.y]))); });
      const r0 = await page.evaluate(() => {
        const f = window.__feed = YSD.feed.attach('#feed');
        const v = document.querySelector('#feed video');
        return { index: f.index, items: f.items().length, muted: f.muted, cMuted: document.getElementById('feed').getAttribute('data-feed-muted'),
          autoplay: document.getElementById('feed').getAttribute('data-feed-autoplay'), src: v.getAttribute('src'), poster: v.getAttribute('poster'), vMuted: v.muted,
          instances: YSD.feed.instances().length };
      });
      eq(r0.items, 2, 'feed found both [data-feed-item]s');
      eq(r0.muted, true, 'muted by default');
      eq(r0.cMuted, 'true', 'container data-feed-muted');
      eq(r0.autoplay, 'on', 'autoplay on (no reduced motion)');
      eq(r0.src, base + '/assets/video/mail-ballot-renew.mp4', 'data-src resolved against the site root (via YSD.clips.resolve)');
      eq(r0.poster, base + '/assets/video/mail-ballot-renew.jpg', 'data-poster resolved');
      ok(r0.vMuted, 'video muted');
      eq(r0.instances, 1, 'feed.instances()');
      await page.waitForFunction(() => window.__feed.index === 0 && document.querySelector('#feed [data-feed-item]').getAttribute('data-feed-state') === 'playing', null, { timeout: 8000 });
      ok(true, 'first item becomes active and plays');
      eq(await page.evaluate(() => document.querySelectorAll('#feed [data-feed-item]')[1].querySelector('video').getAttribute('src')), base + '/assets/video/sunrail-rally.mp4', 'next item preloaded');
      await page.keyboard.press('j');
      await page.waitForFunction(() => window.__feed.index === 1, null, { timeout: 5000 });
      ok(true, "'j' moves to the next clip");
      await page.waitForFunction(() => document.querySelectorAll('#feed [data-feed-item]')[1].getAttribute('data-feed-state') === 'playing', null, { timeout: 8000 });
      // Let the smooth scroll settle before tapping on the second clip.
      await page.waitForFunction(() => Math.abs(document.querySelectorAll('#feed [data-feed-item]')[1].getBoundingClientRect().top - document.getElementById('feed').getBoundingClientRect().top) < 2, null, { timeout: 5000 });
      eq(await page.evaluate(() => document.querySelectorAll('#feed [data-feed-item]')[0].querySelector('video').paused), true, 'the previous clip pauses');
      await page.keyboard.press('m');
      eq(await page.evaluate(() => [window.__feed.muted, document.getElementById('feed').getAttribute('data-feed-muted')].join()), 'false,false', "'m' unmutes");
      await page.keyboard.press('m');
      eq(await page.evaluate(() => window.__feed.muted), true, "'m' mutes again");
      const box = await page.evaluate(() => { const r = document.querySelectorAll('#feed [data-feed-item]')[1].querySelector('video').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      const before = await page.evaluate(() => YSD.clips.stats('demo-sunrail-rally'));
      await page.mouse.dblclick(box.x, box.y);
      await page.waitForFunction(() => YSD.clips.liked('demo-sunrail-rally'), null, { timeout: 3000 });
      const r1 = await page.evaluate(() => ({
        stats: YSD.clips.stats('demo-sunrail-rally'), events: window.__feedEvents,
        likeText: document.querySelectorAll('#feed [data-feed-likes]')[1].textContent,
        pressed: document.querySelectorAll('#feed [data-feed-like]')[1].getAttribute('aria-pressed'),
        fmt: YSD.counters.format(YSD.clips.stats('demo-sunrail-rally').likes)
      }));
      eq(r1.stats.likes, before.likes + 1, 'double-tap likes through YSD.clips');
      const likeEv = r1.events.find((e) => e[0] === 'like');
      ok(likeEv && likeEv[1] === 1 && typeof likeEv[2] === 'number' && typeof likeEv[3] === 'number', 'ysd:feed-like carries index and x/y for a heart burst', r1.events);
      eq(r1.likeText, r1.fmt, '[data-feed-likes] updated with counters.format');
      eq(r1.pressed, 'true', 'like button aria-pressed');
      ok(r1.events.some((e) => e[0] === 'change') && r1.events.some((e) => e[0] === 'mute'), 'ysd:feed-change and ysd:feed-mute fired', r1.events);
      await page.evaluate(() => window.__feed.destroy());
      eq(await page.evaluate(() => YSD.feed.instances().length), 0, 'destroy() detaches');
    });

    await section('no errors, CSP violations or external requests across the whole run', async () => {
      const r = await page.evaluate(() => ({ csp: window.__csp.slice(), hist: YSD.track.history(), enabled: YSD.track.enabled() }));
      ok(r.csp.length === 0, 'no CSP violations', r.csp);
      eq(r.enabled, false, 'analytics disabled in demo');
      ok(r.hist.every((h) => !('email' in h.props) && !('phone' in h.props) && !('name' in h.props)), 'no personal data in tracked props');
      const evs = new Set(r.hist.map((h) => h.event));
      ok(['card_render', 'card_share', 'share', 'calendar_add'].every((e) => evs.has(e)), 'core modules report to YSD.track (history is per page load)', [...evs]);
      checkSink(sink, 'main context');
    });
    await ctx.close();

    // ------------------------------------------------------------------ reduced motion
    await section('feed: prefers-reduced-motion turns autoplay off', async () => {
      const c = await browser.newContext({ reducedMotion: 'reduce' });
      const s = newSink();
      const p = await c.newPage();
      watch(p, s, base);
      await p.goto(pageUrl);
      await p.evaluate(() => { window.__feed = YSD.feed.attach('#feed'); });
      await p.waitForTimeout(1200);
      const r = await p.evaluate(() => ({ allowed: window.__feed.autoplayAllowed(), attr: document.getElementById('feed').getAttribute('data-feed-autoplay'),
        playing: Array.from(document.querySelectorAll('#feed video')).some((v) => !v.paused) }));
      eq(r.allowed, false, 'autoplayAllowed() false');
      eq(r.attr, 'off', 'data-feed-autoplay="off"');
      eq(r.playing, false, 'nothing plays by itself');
      checkSink(s, 'reduced motion');
      await c.close();
    });

    // ------------------------------------------------------------------ file://
    await section('file://: the same stack works without a server', async () => {
      const c = await browser.newContext();
      const s = newSink();
      const p = await c.newPage();
      watch(p, s, null);
      const fileUrl = pathToFileURL(path.join(ROOT, FIXTURE)).href;
      await p.goto(fileUrl + '?ref=filefr');
      await p.waitForFunction(() => window.YSD && YSD.sw && YSD.sw.status !== 'idle', null, { timeout: 5000 });
      const r = await p.evaluate(async () => {
        const Y = window.YSD, out = {};
        out.root = Y.root; out.sw = Y.sw.status;
        out.mods = ['store', 'db', 'counters', 'share', 'cal', 'cards', 'members', 'track', 'clips', 'feed'].filter((m) => !Y[m]);
        const me = Y.members.join({ firstName: 'Sam', email: 'sam@example.com' });
        out.me = [me.refCode, me.referredBy];
        out.url = Y.share.url('join.html');
        out.ics = Y.cal.text({ id: 'f1', title: 'File event', start: '2026-11-14T10:00:00-05:00' });
        const card = await Y.cards.render('joined', { name: 'Sam', refCode: me.refCode });
        out.card = [card.width, card.height, (await Y.cards.toBlob(card)).size];
        const clips = await Y.clips.list();
        out.clips = clips.length;
        out.poster = await new Promise((res) => { const i = new Image(); i.onload = () => res(i.naturalWidth); i.onerror = () => res(0); i.src = clips[0].poster; });
        window.__feed = Y.feed.attach('#feed');
        return out;
      });
      await p.waitForFunction(() => window.__feed.index === 0, null, { timeout: 5000 }).catch(() => null);
      r.feed = await p.evaluate(() => { const f = window.__feed; const out = [f.index, f.items().length, document.querySelector('#feed video').getAttribute('src')]; f.destroy(); return out; });
      const rootUrl = pathToFileURL(ROOT).href + '/';
      eq(r.root, rootUrl, 'YSD.root on file://');
      eq(r.sw, 'file', 'service worker skipped on file://');
      eq(r.mods.length, 0, 'all modules loaded', r.mods);
      ok(/^SAM[BCDFGHJKMNPQRSTVWXZ2-9]{3}$/.test(r.me[0]) && r.me[1] === 'FILEFR', 'join + ?ref= attribution on file://', r.me);
      ok(r.url.startsWith(rootUrl + 'join.html?') && r.url.includes('ref=' + r.me[0]), 'share.url on file://', r.url);
      ok(icsProblems(r.ics).length === 0, 'ics validates on file://', icsProblems(r.ics));
      ok(r.card[0] === 1080 && r.card[1] === 1920 && r.card[2] > 20000, 'card renders and exports on file://', r.card);
      eq(r.clips, 6, 'demo clips list on file://');
      eq(r.poster, 720, 'poster loads on file://');
      ok(r.feed[0] >= 0 && r.feed[1] === 2 && String(r.feed[2]).startsWith(rootUrl + 'assets/video/'), 'feed attaches on file://', r.feed);
      checkSink(s, 'file://');
      await c.close();
    });
  } finally {
    await browser.close();
    srv.close();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }
  finish();
}

function finish() {
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log('  - ' + f));
  }
  console.log('\nintegration.test.js: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

const T0 = Date.now();
main().catch((e) => { failed++; failures.push('crashed: ' + (e && e.stack || e)); finish(); })
  .finally(() => { if (process.env.YSD_TIMING) console.log((Date.now() - T0) + ' ms'); });
