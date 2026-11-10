#!/usr/bin/env node
/**
 * tests/infra/harness.test.js: tests for the review harness, tools/shoot.js and
 * tools/bench_compare.js (plus tools/bench_targets.json and the npm scripts).
 *
 *   node tests/infra/harness.test.js            (Node 22 and Playwright with Chromium)
 *   node tests/infra/harness.test.js shoot      (only tests whose name contains "shoot")
 *
 * Uses the tooling fixtures in tests/infra/fixtures/ (site-good, site-bad, site-empty) and writes
 * its own small pages to a temp folder. Every network target is local: a hanging server, a 403
 * server and a fake bot check stand in for blocked competitor sites. Exits 1 when any test fails.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const SITE = path.resolve(__dirname, '..', '..');
const FIX = path.join(__dirname, 'fixtures');
const TOOLS = path.join(SITE, 'tools');
const shoot = require(path.join(TOOLS, 'shoot.js'));
const bench = require(path.join(TOOLS, 'bench_compare.js'));

const temps = [];
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function tmp(tag) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ysd-harness-' + tag + '-'));
  temps.push(d);
  return d;
}
function sh(args, opts) {
  const r = spawnSync(process.execPath, args, Object.assign({ encoding: 'utf8', timeout: 240000, cwd: SITE }, opts || {}));
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '' };
}
const read = (p) => fs.readFileSync(p, 'utf8');
const readJson = (p) => JSON.parse(read(p));

/** First pixel of a Playwright PNG (8-bit RGB or RGBA). Row 0, pixel 0 is unfiltered by every PNG filter. */
function firstPixel(buf) {
  const colorType = buf[25];
  const idat = [];
  for (let i = 8; i < buf.length;) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('ascii', i + 4, i + 8);
    if (type === 'IDAT') idat.push(buf.slice(i + 8, i + 8 + len));
    i += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  return Array.from(raw.slice(1, 1 + (colorType === 6 ? 4 : 3))).slice(0, 3);
}

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    url: 'http://127.0.0.1:' + server.address().port + '/',
    close: () => new Promise((r) => { if (server.closeAllConnections) server.closeAllConnections(); server.close(() => r()); })
  })));
}

// ============================================================================================
// Fixture pages written for these tests
// ============================================================================================

function writeShootFixture(dir) {
  fs.copyFileSync(path.join(FIX, 'site-good', 'pic.svg'), path.join(dir, 'pic.svg'));
  fs.writeFileSync(path.join(dir, 'dark.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dark fixture</title>
<style>
  html, body { margin: 0; background: #ffffff; color: #111111; }
  @media (prefers-color-scheme: dark) { html, body { background: #111111; color: #eeeeee; } }
  .spacer { height: 3000px; }
</style></head>
<body><h1>Theme fixture</h1><div class="spacer"></div>
<img src="pic.svg" alt="Lazy square" width="100" height="100" loading="lazy">
</body></html>
`);
}

function writeBenchFixture(dir) {
  fs.copyFileSync(path.join(FIX, 'site-good', 'pic.svg'), path.join(dir, 'pic.svg'));
  fs.writeFileSync(path.join(dir, 'shift.js'), `setTimeout(function () {
  var d = document.createElement('div'); d.style.height = '120px'; d.textContent = 'late banner';
  document.body.insertBefore(d, document.body.firstChild);
}, 300);
`);
  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bench fixture</title>
<meta property="og:title" content="Bench fixture"><meta property="og:description" content="A test page.">
<meta property="og:image" content="https://example.org/card.png">
<style>
  body { margin: 0; padding: 0 16px; background: #ffffff; color: #111111; font: 16px/1.4 system-ui, sans-serif; }
  @media (prefers-color-scheme: dark) { body { background: #111111; color: #eeeeee; } }
  .cta { display: inline-block; min-height: 44px; min-width: 44px; padding: 12px 16px; background: #0a58ca; color: #fff; border: 0; }
  .tiny { width: 20px; height: 20px; padding: 0; }
  .wide { width: 600px; height: 10px; background: #ccc; }
  .ghost { opacity: 0; }
</style></head>
<body>
<header><a href="index.html?lang=es" hreflang="es" class="cta">Español</a></header>
<div id="cookie-banner"><button type="button" class="cta">Accept all</button> <a class="cta" href="#c">Join the cookie club</a></div>
<h1>Bench fixture</h1>
<a class="cta" href="join.html">Join us</a> <button class="cta" type="button">Donate</button> <a class="cta" href="join.html#again">Join us</a>
<a class="cta ghost" href="v.html">Volunteer</a>
<button class="tiny" type="button" aria-label="Tiny one">x</button><button class="tiny" type="button" aria-label="Tiny two">y</button>
<img src="pic.svg" width="40" height="40">
<video src="clip.mp4" muted playsinline width="160" height="90"></video>
<button class="cta" type="button">Copy link</button> <a class="cta" href="https://wa.me/?text=hi">WhatsApp</a>
<form action="join.html"><input type="text" name="first" aria-label="First name"><input type="email" name="email" aria-label="Email">
<input type="text" name="zip" aria-label="ZIP"><label><input type="checkbox" name="ok"> Texts OK</label><button class="cta" type="submit">Sign up</button></form>
<div class="wide"></div>
<div style="height: 2400px"></div>
<a class="cta" href="s.html">Subscribe</a>
<script src="shift.js"></script>
</body></html>
`);
}

// ============================================================================================
// Static checks
// ============================================================================================

test('package.json: shoot and bench npm scripts', () => {
  const pkg = readJson(path.join(SITE, 'package.json'));
  assert.strictEqual(pkg.scripts.shoot, 'node tools/shoot.js');
  assert.strictEqual(pkg.scripts.bench, 'node tools/bench_compare.js');
  assert.ok(!pkg.dependencies || !Object.keys(pkg.dependencies).length, 'still no dependencies');
});

test('harness files parse and have no assistant or LLM references', () => {
  const files = ['tools/shoot.js', 'tools/bench_compare.js', 'tests/infra/harness.test.js'];
  for (const f of files) {
    const r = sh(['--check', path.join(SITE, f)]);
    assert.strictEqual(r.code, 0, f + ': ' + r.out);
  }
  const bad = /api\.anthropic\.com|api\.openai\.com|generativelanguage\.googleapis|\/api\/(ask|chat|assistant|llm)\b|@anthropic-ai\/sdk|openai/i;
  for (const f of ['tools/shoot.js', 'tools/bench_compare.js', 'tools/bench_targets.json', 'docs/infra/harness.md']) {
    if (fs.existsSync(path.join(SITE, f))) assert.ok(!bad.test(read(path.join(SITE, f))), f);
  }
});

test('bench_targets.json: right and brands groups with verified homepages', () => {
  const json = readJson(path.join(TOOLS, 'bench_targets.json'));
  assert.match(json.verified, /^\d{4}-\d{2}-\d{2}$/);
  const groups = bench.loadTargets(path.join(TOOLS, 'bench_targets.json'));
  assert.deepStrictEqual(Object.keys(groups).sort(), ['brands', 'right']);
  const hosts = (g) => groups[g].map((t) => new URL(t.url).hostname.replace(/^www\./, ''));
  for (const h of ['tpusa.com', 'prageru.com', 'yrnf.com', 'florida.gop', 'seminolegop.org', 'crnc.org']) assert.ok(hosts('right').includes(h), 'right has ' + h);
  for (const h of ['rarebeauty.com', 'rhodeskin.com', 'fentybeauty.com', 'glossier.com', 'elfcosmetics.com', 'starface.world',
    'drinkpoppi.com', 'liquiddeath.com', 'partiful.com', 'skims.com', 'duolingo.com']) assert.ok(hosts('brands').includes(h), 'brands has ' + h);
  const all = groups.right.concat(groups.brands);
  for (const t of all) {
    assert.match(t.url, /^https:\/\/[a-z0-9.-]+\/$/, 'https homepage: ' + t.url);
    assert.ok(t.name && t.name.length > 1, 'named: ' + t.url);
  }
  assert.strictEqual(new Set(all.map((t) => t.url)).size, all.length, 'no duplicates');
  assert.ok(!hosts('right').includes('yri.org') && !hosts('brands').includes('poppi.com'), 'domain-for-sale pages are not targets');
});

// ============================================================================================
// tools/shoot.js
// ============================================================================================

test('shoot: arguments and helpers', () => {
  const d = shoot.parseArgs([]);
  assert.deepStrictEqual(d.widths.map((w) => [w.width, w.height, w.mobile]), [[390, 844, true], [1440, 900, false]]);
  assert.deepStrictEqual(d.themes, ['light', 'dark']);
  assert.strictEqual(d.scale, 1);
  assert.ok(d.out.endsWith(path.join('tools', '.cache', 'shots')));
  const o = shoot.parseArgs(['--pages', 'index.html, events/index.html', '--widths=390,1440x1000,768', '--themes', 'dark', '--scale', '2', '--out', 'x']);
  assert.deepStrictEqual(o.pages, ['index.html', 'events/index.html']);
  assert.deepStrictEqual(o.widths.map((w) => w.label), ['390x844', '1440x1000', '768x900']);
  assert.deepStrictEqual(o.themes, ['dark']);
  assert.strictEqual(o.scale, 2);
  assert.strictEqual(o.out, path.resolve('x'));
  assert.deepStrictEqual(shoot.parseArgs(['--themes', 'both']).themes, ['light', 'dark']);
  for (const bad of [['--widths', 'wide'], ['--widths', '390,390'], ['--themes', 'sepia'], ['--scale', '0'], ['--scale', '9'], ['--bogus'], ['--out']]) {
    assert.throws(() => shoot.parseArgs(bad), Error, bad.join(' '));
  }
  assert.strictEqual(shoot.fileSlug('events/index.html'), 'events__index');
  assert.strictEqual(shoot.fileSlug('a b?.html'), 'a-b');
  assert.deepStrictEqual(shoot.listPages(path.join(FIX, 'site-good')), ['index.html', 'about.html'], 'index first');
  assert.deepStrictEqual(shoot.listPages(path.join(FIX, 'site-empty')), []);
  assert.strictEqual(shoot.pngSize(Buffer.from('not a png at all, really not')), null);
});

test('shoot: site-good at 390 and 1440, light and dark, with contact sheets', () => {
  const out = tmp('shoot-good');
  const r = sh([path.join(TOOLS, 'shoot.js'), '--root', path.join(FIX, 'site-good'), '--out', out, '--quiet']);
  assert.strictEqual(r.code, 0, r.out);
  const m = readJson(path.join(out, 'shots.json'));
  assert.strictEqual(m.summary.shots, 8);
  assert.strictEqual(m.summary.ok, 8, JSON.stringify(m.shots.filter((s) => !s.ok)));
  assert.strictEqual(m.headersEmulated, true, '_headers applied (strict CSP fixture)');
  for (const page of ['index', 'about']) {
    for (const [w, h] of [[390, 844], [1440, 900]]) {
      for (const theme of ['light', 'dark']) {
        const f = path.join(out, `${page}-${w}-${theme}.png`);
        const size = shoot.pngSize(fs.readFileSync(f));
        assert.ok(size, f + ' is a PNG');
        assert.strictEqual(size.width, w, f + ' width');
        assert.ok(size.height >= h, f + ' is full page (' + size.height + ')');
      }
    }
  }
  for (const w of [390, 1440]) {
    const png = shoot.pngSize(fs.readFileSync(path.join(out, `contact-${w}.png`)));
    assert.ok(png && png.width > 800 && png.height > 300, 'contact sheet ' + w + ' ' + JSON.stringify(png));
    const html = read(path.join(out, `contact-${w}.html`));
    assert.ok(html.includes('index.html') && html.includes('about.html'), 'page names on the sheet');
    assert.ok(html.includes(`src="index-${w}-light.png"`) && html.includes(`src="about-${w}-dark.png"`), 'thumbnails link the shots');
  }
  assert.match(r.out, /8 of 8 shots/);
});

test('shoot: dark scheme, lazy images, --scale 2 and --pages', async () => {
  const root = tmp('shoot-theme');
  writeShootFixture(root);
  const out = tmp('shoot-theme-out');
  const opts = shoot.parseArgs(['--root', root, '--out', out, '--pages', 'dark.html', '--widths', '390', '--scale', '2', '--quiet', '--no-sheet']);
  const m = await shoot.run(opts);
  assert.strictEqual(m.summary.ok, 2, JSON.stringify(m.shots));
  const light = fs.readFileSync(path.join(out, 'dark-390-light.png'));
  const dark = fs.readFileSync(path.join(out, 'dark-390-dark.png'));
  assert.strictEqual(shoot.pngSize(light).width, 780, 'scale 2 doubles the pixels');
  assert.ok(shoot.pngSize(light).height >= 2 * 3000, 'full page at scale 2');
  assert.deepStrictEqual(firstPixel(light), [255, 255, 255], 'light background');
  assert.deepStrictEqual(firstPixel(dark), [17, 17, 17], 'prefers-color-scheme: dark background');
  for (const s of m.shots) {
    assert.deepStrictEqual(s.images, { total: 1, loaded: 1, broken: 0, pending: 0 }, 'lazy image below the fold loaded (' + s.theme + ')');
    assert.strictEqual(s.fonts, 'loaded');
  }
  assert.ok(!fs.existsSync(path.join(out, 'contact-390.png')), '--no-sheet');
});

test('shoot: a broken page is still shot; a missing page fails with exit 1', () => {
  const out = tmp('shoot-bad');
  const r = sh([path.join(TOOLS, 'shoot.js'), '--root', path.join(FIX, 'site-bad'), '--out', out, '--pages', 'index.html,missing.html', '--widths', '390', '--themes', 'light', '--quiet']);
  assert.strictEqual(r.code, 1, r.out);
  const m = readJson(path.join(out, 'shots.json'));
  const ok = m.shots.find((s) => s.page === 'index.html');
  const missing = m.shots.find((s) => s.page === 'missing.html');
  assert.ok(ok.ok, 'site-bad index shot despite its errors');
  assert.ok(ok.consoleErrors > 0, 'console errors recorded (missing CSS, CSP-blocked inline script)');
  assert.ok(!missing.ok && /file not found/.test(missing.error));
  assert.match(read(path.join(out, 'contact-390.html')), /file not found: missing\.html/, 'failure shown on the sheet');
  assert.match(r.out, /FAILED missing\.html/);
});

test('shoot: an empty site writes an empty manifest and exits 0; bad arguments exit 2', () => {
  const out = tmp('shoot-empty');
  const r = sh([path.join(TOOLS, 'shoot.js'), '--root', path.join(FIX, 'site-empty'), '--out', out]);
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /no root-level \*\.html pages/);
  assert.strictEqual(readJson(path.join(out, 'shots.json')).summary.shots, 0);
  assert.strictEqual(sh([path.join(TOOLS, 'shoot.js'), '--widths', 'huge']).code, 2);
  const help = sh([path.join(TOOLS, 'shoot.js'), '--help']);
  assert.strictEqual(help.code, 0);
  assert.match(help.out, /contact sheet/);
});

// ============================================================================================
// tools/bench_compare.js
// ============================================================================================

test('bench: arguments, targets and the CTA vocabulary', () => {
  const d = bench.parseArgs([]);
  assert.strictEqual(d.throttle, 'none');
  assert.strictEqual(d.timeout, 45000);
  assert.ok(d.out.endsWith(path.join('tools', '.cache', 'bench')));
  assert.throws(() => bench.parseArgs(['--throttle', '5g']));
  assert.throws(() => bench.parseArgs(['--nope']));
  const o = bench.parseArgs(['--root', path.join(FIX, 'site-good'), '--group', 'none', '--local', 'all', '--urls', 'https://example.org/,about.html']);
  const t = bench.buildTargets(o, 'http://127.0.0.1:9');
  assert.deepStrictEqual(t.map((x) => [x.group, x.url]), [
    ['ours', 'http://127.0.0.1:9/index.html'], ['ours', 'http://127.0.0.1:9/about.html'], ['custom', 'https://example.org/']
  ], 'about.html given twice is measured once');
  const right = bench.buildTargets(bench.parseArgs(['--root', path.join(FIX, 'site-empty'), '--group', 'right', '--only', 'tpusa,florida']), 'http://x');
  assert.deepStrictEqual(right.map((x) => x.url), ['https://tpusa.com/', 'https://florida.gop/']);
  assert.throws(() => bench.buildTargets(bench.parseArgs(['--group', 'left']), 'http://x'), /no group "left"/);
  const cta = new RegExp(bench.CTA_PATTERN, 'iu');
  const skip = new RegExp(bench.SKIP_PATTERN, 'iu');
  for (const s of ['Join us', 'JOIN', 'Sign up', 'Donate $5', 'RSVP', 'Get started', 'Únete', 'Hazte voluntaria', 'Shop now', 'Register to vote']) assert.ok(cta.test(s), 'CTA: ' + s);
  for (const s of ['Facebook', 'Country', 'Restart', 'About us', 'Our team', 'Joiner']) assert.ok(!cta.test(s), 'not a CTA: ' + s);
  for (const s of ['Accept cookies', 'Sign in', 'Menu', 'Close']) assert.ok(skip.test(s), 'skipped: ' + s);
});

test('bench: score, dark verdict and markdown escaping', () => {
  const base = {
    status: 'ok', name: 'A | B', group: 'ours', url: 'http://x/', bytes: { total: 300000, byType: { document: 300000 } },
    requests: { total: 5, byType: { document: 5 }, thirdParty: 0, thirdPartyHosts: 0 },
    timing: { dcl: 300, lcp: 900, cls: 0, firstCta: 800, firstCtaText: 'Join', lcpElement: 'h1' },
    cta: { aboveFold: 1, list: ['Join'] }, tapTargets: { under44: 0, total: 10 }, overflow: { overflows: false },
    images: { withoutAlt: 0 }, axe: { status: 'ran', seriousNodes: 0, contrast: 0 },
    og: { ok: true, description: 'd', count: 3 }, darkMode: 'yes', lang: { toggle: true, spanish: true },
    share: { present: true, webShareApi: true, copyLink: true, intentLinks: 0, buttons: 1 }, signup: { fields: 3, visible: true },
    video: { present: false }
  };
  assert.strictEqual(bench.scoreOf(base).total, 100, 'a perfect page scores 100');
  const heavy = JSON.parse(JSON.stringify(base));
  Object.assign(heavy, { bytes: { total: 19e6, byType: {} }, timing: Object.assign({}, base.timing, { lcp: 5200, cls: 0.4, firstCta: null }), darkMode: 'no' });
  heavy.overflow.overflows = true;
  heavy.cta.aboveFold = 9;
  const hs = bench.scoreOf(heavy);
  assert.ok(hs.total < 40, 'heavy page scores low: ' + hs.total);
  assert.strictEqual(hs.parts.weight, 0);
  assert.strictEqual(hs.parts.overflow, 0);
  const noAxe = JSON.parse(JSON.stringify(base));
  noAxe.axe = { status: 'skipped' };
  assert.strictEqual(bench.scoreOf(noAxe).total, 100, 'skipped axe rescales');
  assert.strictEqual(bench.scoreOf({ status: 'blocked' }), null);
  assert.strictEqual(bench.darkVerdict({ points: [1, 1, 1, 1], body: 1, text: 0 }, { points: [0.01, 0.01, 1, 1], body: 0.01, text: 0.9 }), 'yes');
  assert.strictEqual(bench.darkVerdict({ points: [1, 1, 1, 1], body: 1, text: 0 }, { points: [1, 1, 1, 1], body: 1, text: 0 }), 'no');
  assert.strictEqual(bench.darkVerdict({ points: [0.01, 0.02, 0.01, 0.01], body: 0.01, text: 1 }, { points: [0.01, 0.02, 0.01, 0.01], body: 0.01, text: 1 }), 'always-dark');
  base.score = bench.scoreOf(base);
  const md = bench.toMarkdown({
    generatedAt: new Date().toISOString(), chromium: '1', viewport: { width: 390, height: 844 }, throttle: 'none',
    axe: { status: 'ready', version: '4.10.2' }, results: [base, { name: 'Slow', group: 'right', status: 'timeout', reason: 'no answer', url: 'https://slow.example/' }]
  });
  assert.ok(md.includes('A \\| B'), 'pipes escaped');
  assert.match(md, /\| 1 \| A \\\| B \| ours \| 100 \|/);
  assert.match(md, /## Not measured[\s\S]*\| Slow \| right \| timeout \| no answer \|/);
  assert.match(md, /timings flatter our pages/);
});

test('bench: fixture pages head to head, with timeout, 403 and bot-check targets', async () => {
  const root = tmp('bench-root');
  writeBenchFixture(root);
  const good = await shoot.startServer(path.join(FIX, 'site-good'));
  const hang = await listen(() => { /* never answers */ });
  const denied = await listen((req, res) => { res.writeHead(403, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Access denied</title><p>Access denied</p>'); });
  const check = await listen((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><html><head><title>Just a moment...</title></head><body>Checking your browser before accessing the site.</body></html>'); });
  const out = tmp('bench-out');
  let report;
  try {
    const opts = bench.parseArgs(['--root', root, '--group', 'none', '--local', 'index.html', '--out', out, '--timeout', '5000', '--concurrency', '3', '--quiet',
      '--urls', [good.base + '/index.html', hang.url, denied.url, check.url].join(',')]);
    report = await bench.run(opts);
  } finally {
    await Promise.all([good.close(), hang.close(), denied.close(), check.close()]);
  }
  const by = (u) => report.results.find((r) => r.url === u || r.url.startsWith(u));
  const rich = report.results.find((r) => r.group === 'ours');
  const plain = by(good.base + '/index.html');
  assert.strictEqual(rich.status, 'ok', rich.reason);
  assert.strictEqual(plain.status, 'ok', plain.reason);
  assert.strictEqual(by(hang.url).status, 'timeout');
  assert.strictEqual(by(denied.url).status, 'blocked');
  assert.match(by(denied.url).reason, /HTTP 403/);
  assert.strictEqual(by(check.url).status, 'blocked');
  assert.match(by(check.url).reason, /bot check/);

  // Weight and timing
  assert.ok(rich.bytes.total > 2000, 'bytes ' + rich.bytes.total);
  assert.strictEqual(rich.requests.byType.document, 1);
  assert.ok(rich.requests.byType.script >= 1 && rich.requests.byType.image >= 1, JSON.stringify(rich.requests.byType));
  assert.ok(rich.bytes.byType.document > 1000);
  for (const k of ['dcl', 'load', 'fcp', 'lcp', 'firstCta']) assert.ok(Number.isFinite(rich.timing[k]) && rich.timing[k] >= 0, k + ' ' + rich.timing[k]);
  assert.ok(rich.timing.cls > 0, 'the late banner shifted the layout: ' + rich.timing.cls);
  assert.ok(rich.timing.firstCta >= rich.timing.fcp, 'first CTA never before first paint');
  // First screen: Join us (twice), Donate, Sign up; not the cookie banner, the invisible or the far-down one
  assert.deepStrictEqual(rich.cta.list.slice().sort(), ['Donate', 'Join us', 'Sign up'], JSON.stringify(rich.cta));
  assert.strictEqual(rich.cta.aboveFold, 3);
  // Mobile checks
  assert.ok(rich.tapTargets.under44 >= 4, 'tiny buttons, inputs and checkbox: ' + JSON.stringify(rich.tapTargets));
  assert.ok(rich.tapTargets.examples.some((e) => e.name === 'Tiny one' && e.w === 20));
  assert.strictEqual(rich.overflow.overflows, true);
  assert.ok(rich.overflow.scrollWidth >= 600);
  assert.strictEqual(rich.images.withoutAlt, 1);
  // Features
  assert.ok(rich.og.ok && rich.og.count === 3);
  assert.strictEqual(rich.darkMode, 'yes');
  assert.ok(rich.lang.toggle && rich.lang.spanish, JSON.stringify(rich.lang));
  assert.ok(rich.video.present && rich.video.videos === 1);
  assert.ok(rich.share.present && rich.share.copyLink && rich.share.intentLinks === 1, JSON.stringify(rich.share));
  assert.strictEqual(rich.signup.fields, 3, JSON.stringify(rich.signup));
  assert.strictEqual(rich.signup.checkboxes, 1);
  assert.ok(rich.screenshot && fs.existsSync(path.join(out, rich.screenshot)), 'first-screen screenshot');
  if (report.axe.status === 'ready') {
    assert.strictEqual(rich.axe.status, 'ran', JSON.stringify(rich.axe));
    assert.strictEqual(rich.axe.version, bench.AXE_VERSION);
    assert.ok(Number.isInteger(rich.axe.seriousNodes) && Number.isInteger(rich.axe.contrast));
  } else assert.strictEqual(rich.axe.status, 'skipped');
  assert.ok(rich.score.total >= 0 && rich.score.total <= 100);

  // The plain good fixture: none of the features
  assert.strictEqual(plain.darkMode, 'no');
  assert.strictEqual(plain.overflow.overflows, false);
  assert.strictEqual(plain.images.withoutAlt, 0);
  assert.strictEqual(plain.lang.toggle, false);
  assert.strictEqual(plain.video.present, false);
  assert.strictEqual(plain.share.present, false);
  assert.strictEqual(plain.signup.fields, null);
  assert.strictEqual(plain.cta.aboveFold, 0);
  assert.strictEqual(plain.timing.firstCta, null);
  assert.strictEqual(plain.og.ok, true);

  // Files
  const json = readJson(path.join(out, 'bench.json'));
  assert.strictEqual(json.results.length, 5);
  const md = read(path.join(out, 'bench.md'));
  assert.match(md, /\| # \| Site \| Group \| Score \| MB \| Req \| DCL s \| LCP s \| CLS \|/);
  assert.match(md, /index\.html \(ours\)/);
  assert.match(md, /## Not measured/);
  assert.match(md, /\| timeout \|/);
  assert.match(md, /## Weight by type/);
});

test('bench: nothing to measure still writes a report', () => {
  const out = tmp('bench-empty');
  const r = sh([path.join(TOOLS, 'bench_compare.js'), '--root', path.join(FIX, 'site-empty'), '--group', 'none', '--out', out, '--quiet']);
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /nothing to measure/);
  assert.strictEqual(readJson(path.join(out, 'bench.json')).results.length, 0);
  assert.strictEqual(sh([path.join(TOOLS, 'bench_compare.js'), '--throttle', 'warp']).code, 2);
});

// ============================================================================================
// Runner
// ============================================================================================

(async () => {
  const filters = process.argv.slice(2).map((s) => s.toLowerCase());
  const chosen = filters.length ? tests.filter((t) => filters.some((f) => t.name.toLowerCase().includes(f))) : tests;
  let failed = 0;
  const t0 = Date.now();
  for (const t of chosen) {
    const s = Date.now();
    try {
      await t.fn();
      console.log(`ok   ${t.name} (${((Date.now() - s) / 1000).toFixed(1)}s)`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${t.name}\n     ${String(e && e.stack ? e.stack : e).split('\n').slice(0, 4).join('\n     ')}`);
    }
  }
  for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* ignore */ } }
  console.log(`\n${chosen.length - failed} of ${chosen.length} passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exitCode = failed ? 1 : 0;
})();
