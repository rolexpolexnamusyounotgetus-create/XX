#!/usr/bin/env node
/*
 * Shared UI tests (round 1, G-CORE): assets/js/ui.js behaviours other groups build on.
 *
 *   node tests/infra/ui.test.js
 *
 * Covers: the language toggle keeping query and place (journeys-04), queued toasts with priority
 * (journeys-14), toasts and confetti above an open modal <dialog> (genz-brand-08), same-page jumps that move
 * focus and open closed <details> (journeys-19), the sticker reveal (genz-brand-10), the "who sent this"
 * landing (journeys-18), the Spanish 404 on the local server (journeys-26) and the brand files (genz-brand-20).
 * Fixture: tests/infra/fixtures/ui.html and ui-es.html, served with the production _headers (CSP) and over
 * file://. Needs Node 22 and Playwright with Chromium. Exits 1 on any failure.
 * Also callable from core.test.js: require('./ui.test.js').run() -> {passed, failed, failures}.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const FIX = 'tests/infra/fixtures/ui.html';
const FIX_ES = 'tests/infra/fixtures/ui-es.html';

async function run() {
  let passed = 0, failed = 0;
  const failures = [];
  const ok = (cond, name, detail) => {
    if (cond) { passed++; return true; }
    failed++; failures.push(name + (detail !== undefined ? '  ->  ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''));
    return false;
  };
  const eq = (a, b, name) => ok(a === b, name, { got: a, want: b });
  async function section(name, fn) {
    const before = failed;
    try { await fn(); } catch (e) { failed++; failures.push(name + ' threw: ' + (e && e.stack || e)); }
    console.log((failed === before ? 'ok   ' : 'FAIL ') + name);
  }

  const { chromium } = require('playwright');
  const cs = require(path.join(ROOT, 'tools', 'check_site.js'));
  const rules = cs.parseHeadersFile(fs.readFileSync(path.join(ROOT, '_headers'), 'utf8'));
  const server = cs.createServer(ROOT, { headers: rules });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const errors = [];
  async function open(url, opts) {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 390, height: 844 } }, opts || {}));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(url + ': ' + e));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(url + ': ' + m.text()); });
    await page.goto(url);
    await page.waitForFunction(() => document.documentElement.getAttribute('data-ui') === 'ready');
    return { ctx, page };
  }

  try {
    await section('lang toggle keeps the query (minus utm, click ids, ref when from is there) and the place (journeys-04)', async () => {
      const { ctx, page } = await open(base + '/' + FIX + '?series=trivia&ref=KIRA7QX&from=Kira&e=trivia-county-edition&utm_source=share&fbclid=x');
      const href0 = await page.getAttribute('#lang', 'href');
      const u0 = new URL(href0);
      eq(u0.pathname, '/es/' + FIX, 'Spanish twin path');
      eq(u0.searchParams.get('series'), 'trivia', 'filter kept');
      eq(u0.searchParams.get('e'), 'trivia-county-edition', 'event kept');
      eq(u0.searchParams.get('from'), 'Kira', 'from kept (the invite landing survives)');
      eq(u0.searchParams.get('ref'), null, 'ref dropped when from is present (captured on arrival)');
      eq(u0.searchParams.get('utm_source'), null, 'utm dropped');
      eq(u0.searchParams.get('fbclid'), null, 'click id dropped');
      eq(u0.hash, '', 'no hash at the top of the page');
      // Scroll into section two: the link points at it when it's followed.
      await page.evaluate(() => { document.getElementById('two').scrollIntoView({ behavior: 'instant' }); });
      await page.waitForTimeout(150);
      await page.dispatchEvent('#lang', 'pointerdown');
      eq(new URL(await page.getAttribute('#lang', 'href')).hash, '#two', 'reading section two: #two');
      // A hash whose target is on screen wins; hashchange recomputes.
      await page.evaluate(() => { location.hash = 'one'; });
      await page.waitForTimeout(1200); // the browser's smooth scroll to the anchor
      await page.dispatchEvent('#lang', 'pointerdown');
      eq(new URL(await page.getAttribute('#lang', 'href')).hash, '#one', 'hashchange: #one (on screen)');
      await ctx.close();
      const r2 = await open(base + '/' + FIX + '?ref=AB12CD');
      eq(new URL(await r2.page.getAttribute('#lang', 'href')).searchParams.get('ref'), 'AB12CD', 'a ref-only invite keeps ref, so its landing survives');
      const bare = await r2.page.evaluate(() => YSD.ui.langHref('es', { bare: true }));
      ok(!/[?#]/.test(bare), 'langHref(lang, {bare}) has no query or hash', bare);
      await r2.ctx.close();
      const r3 = await open(base + '/es/offline.html?kind=social');
      const back = new URL(await r3.page.getAttribute('[data-lang-link]', 'href'));
      eq(back.pathname, '/offline.html', 'ES -> EN path');
      eq(back.searchParams.get('kind'), 'social', 'ES -> EN keeps the query');
      await r3.ctx.close();
      // file://
      const r4 = await open('file://' + path.join(ROOT, FIX) + '?series=walk#two');
      const fh = await r4.page.getAttribute('#lang', 'href');
      ok(fh.startsWith('file://') && fh.includes('/es/' + FIX + '?series=walk'), 'file:// keeps the query', fh);
      await r4.ctx.close();
    });

    await section('toasts queue with priority; nothing replaces "Link copied" (journeys-14)', async () => {
      const { ctx, page } = await open(base + '/' + FIX);
      const seen = await page.evaluate(async () => {
        const out = [];
        document.addEventListener('ysd:toast', (e) => out.push(e.detail.text));
        YSD.ui.toast('New sticker: Card Maker.', { priority: 'low' });
        YSD.ui.toast('Link copied. Paste it anywhere.', { priority: 'high' });
        await Promise.resolve(); await new Promise((r) => setTimeout(r, 0));
        const now = YSD.ui.toast.pending();
        const visible = document.querySelector('.toast-region .toast').textContent;
        YSD.ui.toast('Link copied. Paste it anywhere.', { priority: 'high' }); // dedupe
        const afterDup = YSD.ui.toast.pending().length;
        await new Promise((r) => setTimeout(r, 2800)); // min readable time 2.2 s + fade
        const later = document.querySelector('.toast-region .toast') && document.querySelector('.toast-region .toast').textContent;
        return { out, now, visible, afterDup, later };
      });
      eq(seen.visible, 'Link copied. Paste it anywhere.', 'the high-priority copy result shows at once');
      eq(JSON.stringify(seen.now), JSON.stringify(['Link copied. Paste it anywhere.', 'New sticker: Card Maker.']), 'the sticker note waits behind it');
      eq(seen.afterDup, 2, 'the same words are not queued twice');
      eq(seen.later, 'New sticker: Card Maker.', 'the sticker note follows once the copy has been readable');
      ok(seen.out.indexOf('Link copied. Paste it anywhere.') === 0, 'announced in order', seen.out);
      const rep = await page.evaluate(() => {
        YSD.ui.toast.clear();
        YSD.ui.toast('Fact one', { tone: 'info', replace: true });
        return new Promise((r) => setTimeout(() => {
          YSD.ui.toast('Fact two', { tone: 'info', replace: true });
          r({ visible: document.querySelector('.toast-region .toast').textContent, pending: YSD.ui.toast.pending() });
        }, 10));
      });
      eq(rep.visible, 'Fact two', 'replace: true swaps sticker facts at once');
      eq(rep.pending.length, 1, 'and queues nothing');
      await ctx.close();
    });

    await section('toasts and confetti show above an open modal <dialog> (genz-brand-08)', async () => {
      const { ctx, page } = await open(base + '/' + FIX);
      await page.click('#open-sheet');
      await page.waitForTimeout(450);
      const r = await page.evaluate(async () => {
        YSD.ui.toast.clear();
        YSD.ui.toast('Seat saved. See you there.');
        await new Promise((res) => setTimeout(res, 200));
        const t = document.querySelector('dialog[open] [data-toast-region] .toast');
        if (t) { t.style.pointerEvents = 'auto'; t.parentNode.style.pointerEvents = 'auto'; } // toasts ignore taps; hit-test them anyway
        const rect = t ? t.getBoundingClientRect() : null;
        const hit = rect ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) : null;
        const fired = YSD.ui.confetti(document.getElementById('in-sheet'));
        const box = document.querySelector('.confetti');
        return { inDialog: !!t, role: t && t.parentNode.getAttribute('role'), hitIsToast: !!(hit && hit.closest && hit.closest('.toast')),
          onScreen: rect ? rect.top >= 0 && rect.bottom <= innerHeight : false, fired,
          popover: !!(box && box.matches(':popover-open')), calm: YSD.ui.confetti(document.getElementById('calm-btn')) };
      });
      ok(r.inDialog && r.role === 'status', 'the toast mounts in a role=status region inside the open dialog', r);
      ok(r.hitIsToast, 'nothing covers the toast (hit test lands on it)', r);
      ok(r.onScreen, 'the toast is on screen', r);
      ok(r.fired && r.popover, 'confetti draws in the top layer (manual popover) above the dialog', r);
      eq(r.calm, false, 'still no confetti in calm content');
      await ctx.close();
    });

    await section('same-page jumps move focus; closed <details> open (journeys-19)', async () => {
      const { ctx, page } = await open(base + '/' + FIX);
      await page.click('#to-two');
      await page.waitForTimeout(100);
      eq(await page.evaluate(() => document.activeElement && document.activeElement.id), 'two-title', 'focus on the section heading');
      await page.click('#to-inside');
      await page.waitForTimeout(100);
      const r = await page.evaluate(() => ({ open: document.getElementById('faq').open, focus: document.activeElement && document.activeElement.id }));
      ok(r.open && r.focus === 'inside', 'the details opened and its heading has focus', r);
      await ctx.close();
      const r2 = await open(base + '/' + FIX + '#inside');
      eq(await r2.page.evaluate(() => document.getElementById('faq').open), true, 'arriving with #inside opens the details');
      const j = await r2.page.evaluate(() => { const el = YSD.ui.jump('#one'); return el && el.tagName; });
      eq(j, 'H2', 'YSD.ui.jump focuses the first heading of a section');
      await r2.ctx.close();
    });

    await section('sticker reveal: centred, focus in and back, Escape closes, queued, civic falls back (genz-brand-10)', async () => {
      const { ctx, page } = await open(base + '/' + FIX);
      await page.focus('#calm-btn');
      await page.evaluate(() => {
        window.__r = [];
        YSD.ui.reveal({ sticker: 'manatee', title: 'Squad of Three', body: 'It is on your member card now.', actions: [{ label: 'See your stickers', href: '#two', primary: true }] }).then((x) => window.__r.push(x));
        YSD.ui.reveal({ sticker: 'bike', title: 'City Hopper' }).then((x) => window.__r.push(x));
      });
      await page.waitForTimeout(200);
      const a = await page.evaluate(() => {
        const d = document.querySelector('dialog.unlock[open]');
        const r = d && d.querySelector('.unlock__card').getBoundingClientRect();
        return { open: !!d, modal: d && d.matches(':modal'), svg: !!(d && d.querySelector('.unlock__art svg')), title: d && d.querySelector('.unlock__title').textContent,
          focus: document.activeElement && document.activeElement.textContent, centred: r ? Math.abs((r.left + r.right) / 2 - innerWidth / 2) < 2 : false,
          labelled: d && document.getElementById(d.getAttribute('aria-labelledby')).textContent, anim: d && d.hasAttribute('data-anim') };
      });
      ok(a.open && a.modal && a.svg, 'a modal dialog with the sticker art', a);
      eq(a.title, 'Squad of Three', 'title');
      eq(a.labelled, 'Squad of Three', 'aria-labelledby names it');
      eq(a.focus, 'See your stickers', 'focus moves to the first action');
      ok(a.centred, 'centred', a);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
      const b = await page.evaluate(() => ({ second: document.querySelector('dialog.unlock[open] .unlock__title') && document.querySelector('dialog.unlock[open] .unlock__title').textContent, results: window.__r.slice() }));
      eq(b.second, 'City Hopper', 'the queued reveal follows');
      eq(b.results[0], 'dismiss', 'Escape resolves "dismiss"');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
      eq(await page.evaluate(() => document.activeElement && document.activeElement.id), 'calm-btn', 'focus returns to where it was');
      const civic = await page.evaluate(() => YSD.ui.reveal({ sticker: 'envelope', title: 'Mail ballot', civic: true }));
      eq(civic, 'toast', 'civic steps get a plain toast, never the moment');
      await ctx.close();
      const rm = await open(base + '/' + FIX, { reducedMotion: 'reduce' });
      await rm.page.evaluate(() => { YSD.ui.reveal({ sticker: 'manatee', title: 'Squad of Three' }); });
      await rm.page.waitForTimeout(100);
      const still = await rm.page.evaluate(() => ({ anim: document.querySelector('dialog.unlock').hasAttribute('data-anim'), running: document.getAnimations().filter((x) => x.playState === 'running').length }));
      ok(!still.anim && still.running === 0, 'static under reduced motion', still);
      await rm.ctx.close();
    });

    await section('"who sent this" landing on any page opened from a shared link (journeys-18)', async () => {
      const { ctx, page } = await open(base + '/' + FIX + '?ref=KIRA7QX&from=Kira');
      const r = await page.evaluate(() => {
        const b = document.querySelector('[data-landing-banner]');
        return b && { text: b.querySelector('.landing__text').textContent, join: !!b.querySelector('.landing__join'), first: document.querySelector('main').firstElementChild === b };
      });
      ok(r && r.text === 'Kira sent you this' && r.join && r.first, 'slim line at the top of <main> with Join free', r);
      await page.click('.landing__close');
      eq(await page.evaluate(() => document.querySelector('[data-landing-banner]').hidden), true, 'dismiss hides it');
      eq(await page.evaluate(() => document.activeElement && document.activeElement.tagName), 'H1', 'focus goes to the page heading');
      await page.reload();
      await page.waitForFunction(() => document.documentElement.getAttribute('data-ui') === 'ready');
      eq(await page.evaluate(() => !!document.querySelector('[data-landing-banner]')), false, 'stays dismissed (invite:seen key)');
      await ctx.close();
      const anon = await open(base + '/' + FIX + '?ref=B7KQ2M');
      eq(await anon.page.evaluate(() => document.querySelector('.landing__text') && document.querySelector('.landing__text').textContent), 'A friend sent you this', 'ref only (every under-18 link): no name');
      await anon.ctx.close();
      const es = await open(base + '/' + FIX_ES + '?from=Kira');
      eq(await es.page.evaluate(() => document.querySelector('.landing__text') && document.querySelector('.landing__text').textContent), 'Kira te mandó esto', 'Spanish');
      await es.ctx.close();
      const xss = await open(base + '/' + FIX + '?from=' + encodeURIComponent('<img src=x onerror=alert(1)>Jo'));
      const x = await xss.page.evaluate(() => ({ text: document.querySelector('.landing__text').textContent, img: !!document.querySelector('.landing img') }));
      ok(!x.img && !/[<>=]/.test(x.text), 'from is cleaned and rendered as text', x);
      await xss.ctx.close();
      const custom = await open(base + '/' + FIX + '?from=Kira');
      const none = await custom.page.evaluate(() => {
        document.querySelector('[data-landing-banner]').remove();
        document.body.setAttribute('data-landing', 'custom');
        return YSD.ui.landing();
      });
      eq(none, null, 'body[data-landing="custom"] opts out');
      await custom.ctx.close();
    });

    await section('local server: missing /es/* paths get the Spanish 404 (journeys-26)', async () => {
      const get = (p) => new Promise((r) => http.get(base + p, (res) => { let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => r({ status: res.statusCode, body: d })); }));
      const es = await get('/es/events/nada.html');
      eq(es.status, 404, '404 status');
      ok(/<html[^>]*lang="es"/.test(es.body), 'es/404.html served for /es/*');
      const en = await get('/events/nada.html');
      ok(/<html[^>]*lang="en"/.test(en.body), '404.html for everything else');
    });

    await section('brand: partials, icons and SVG files match YSD.cards.brand (genz-brand-20)', async () => {
      let out = '';
      try { out = execFileSync(process.execPath, [path.join(ROOT, 'tools', 'make_brand.js'), '--check'], { encoding: 'utf8' }); ok(true, 'make_brand --check'); }
      catch (e) { ok(false, 'make_brand --check', String(e.stdout || '') + String(e.stderr || '')); }
      void out;
      for (const f of ['assets/icons/favicon.svg', 'assets/icons/icon-192.png', 'assets/icons/icon-512.png', 'assets/icons/icon-maskable-512.png', 'assets/icons/icon-mono-512.png', 'assets/icons/apple-touch-icon.png', 'assets/img/og/default.png'])
        ok(fs.existsSync(path.join(ROOT, f)), f + ' exists');
      const { ctx, page } = await open(base + '/' + FIX);
      const drawn = await page.evaluate(() => {
        const c = document.createElement('canvas'); c.width = 400; c.height = 120;
        const g = c.getContext('2d');
        const wd = YSD.cards.brand.lockup(g, 4, 4, 100);
        const px = g.getImageData(40, 54, 1, 1).data; // inside the ticket body
        return { wd, px: Array.from(px) };
      });
      ok(drawn.wd > 300 && drawn.wd < 400, 'lockup width', drawn.wd);
      ok(drawn.px[3] > 0, 'canvas mark drew pixels', drawn.px);
      await ctx.close();
    });

    ok(errors.length === 0, 'no console errors or page errors', errors);
  } finally {
    await browser.close();
    server.close();
  }
  return { passed, failed, failures };
}

module.exports = { run };

if (require.main === module) {
  const t0 = Date.now();
  run().then((r) => {
    if (r.failures.length) { console.log('\nFailures:'); r.failures.forEach((f) => console.log('  - ' + f)); }
    console.log(`\nui.test.js: ${r.passed} passed, ${r.failed} failed (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    process.exit(r.failed ? 1 : 0);
  }, (e) => { console.error(e); process.exit(1); });
}
