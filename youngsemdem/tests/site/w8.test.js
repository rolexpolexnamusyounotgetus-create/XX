#!/usr/bin/env node
/**
 * tests/site/w8.test.js: acceptance tests for the W8 tools (BRIEF 10.4, W8 row).
 *
 *   node tests/site/w8.test.js              (Node 22, Python 3, Playwright + Chromium; about 2 minutes)
 *   node tests/site/w8.test.js qa voice     (only tests whose name contains "qa" or "voice")
 *   W8_STRICT_DATA=1 node tests/site/w8.test.js data   (also fail while data/*.js still has voice errors)
 *
 * Covers tools/make_es.js, tools/make_og.js (+ tools/og.html, assets/js/cards-og.js), tools/qa.js,
 * tools/voice_lint.js (+ tools/voice_rules.json) against the fixtures in tests/site/fixtures/, each
 * copied to a temp folder first. Exits 1 when any test fails.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SITE = path.resolve(__dirname, '..', '..');
const FIX = path.join(__dirname, 'fixtures');
const TOOLS = path.join(SITE, 'tools');
const temps = [];
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function sh(args, opts) {
  const r = spawnSync(process.execPath, args, Object.assign({ encoding: 'utf8', timeout: 600000, cwd: SITE, maxBuffer: 64 * 1024 * 1024 }, opts || {}));
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '' };
}
const tool = (name, args) => sh([path.join(TOOLS, name)].concat(args || []));
function tmp(tag) { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ysd-w8-' + tag + '-')); temps.push(d); return d; }
function copyFixture(name) { const d = tmp(name); fs.cpSync(path.join(FIX, name), d, { recursive: true }); return d; }
function copyFromSite(dest, files) {
  for (const f of files) {
    const src = path.join(SITE, f);
    if (!fs.existsSync(src)) continue;
    fs.mkdirSync(path.dirname(path.join(dest, f)), { recursive: true });
    fs.cpSync(src, path.join(dest, f), { recursive: true });
  }
}
const read = (p) => fs.readFileSync(p, 'utf8');

// ============================================================================================
// make_es.js
// ============================================================================================

test('make_es: writes es/ twins from data-t keys, idempotent, hreflang both ways', () => {
  const d = copyFixture('i18n');
  const r = tool('make_es.js', ['--root', d, 'index.html', 'events.html']);
  assert.strictEqual(r.code, 0, r.out);
  const es = read(path.join(d, 'es', 'index.html'));
  const en = read(path.join(d, 'index.html'));
  assert.ok(/<html lang="es"/.test(es), 'lang="es"');
  assert.ok(es.includes('<h1 data-t="home:hero.title">La política local es un trabajo en equipo.</h1>'), 'h1 translated');
  assert.ok(es.includes('content="Planes gratis y respuestas claras sobre cómo votar en el condado de Seminole."'), 'meta description translated');
  assert.ok(es.includes('alt="Tres amigos al atardecer, vistos de espaldas."'), 'alt translated');
  assert.ok(es.includes('placeholder="tu@ejemplo.com"'), 'placeholder translated');
  assert.ok(es.includes('aria-label="Cerrar"'), 'aria-label translated');
  assert.ok(es.includes('al 407-585-8683.'), '{soePhone} token filled from config');
  assert.ok(es.includes('src="../assets/img/photo.jpg"') && es.includes('srcset="../assets/img/photo.jpg 320w, https://images.unsplash.com/photo-1?w=640 640w"'), 'asset paths get ../, absolute URLs untouched');
  assert.ok(es.includes('<script src="../assets/js/config.js">'), 'script path');
  assert.ok(es.includes('href="join.html"') && es.includes('href="events.html#list"'), 'page links stay on Spanish siblings');
  assert.ok(es.includes('href="../styleguide.html"'), 'pages without a twin get ../');
  assert.ok(es.includes('<a href="../index.html" hreflang="en" lang="en" data-t="lang.switch">English</a>'), 'language link points back at English');
  assert.ok(es.includes('content="../assets/img/og/es/home.png"'), 'og:image moves to og/es/');
  assert.ok(es.includes('"kicker":"DE 14 A 39 AÑOS"') && es.includes('"title":"La política local es un trabajo en equipo."') && es.includes('"lang":"es"'), 'ysd:og text from keys');
  assert.ok(es.includes('content="es_US"'), 'og:locale swapped');
  assert.ok(/<!-- @header-es -->[\s\S]*Eventos[\s\S]*<!-- \/@header-es -->/.test(es), 'header marker swapped and synced');
  assert.ok(es.includes('<!-- @head -->') && es.includes('href="../assets/css/page.css"'), 'shared head partial synced at es/ depth');
  for (const [h, href] of [['en', '../index.html'], ['es', 'index.html'], ['x-default', '../index.html']]) assert.ok(es.includes('hreflang="' + h + '" href="' + href + '"'), 'es hreflang ' + h);
  for (const [h, href] of [['en', 'index.html'], ['es', 'es/index.html'], ['x-default', 'index.html']]) assert.ok(en.includes('<link rel="alternate" hreflang="' + h + '" href="' + href + '">'), 'en hreflang ' + h);
  const ev = read(path.join(d, 'es', 'events.html'));
  assert.ok(ev.includes('"kicker":"ESTE MES"') && ev.includes('"title":"Lo que viene en Seminole"'), 'ysd:og es object + keys');
  assert.ok(ev.includes('href="events/trivia-county-edition.html"'), 'generated subpage link stays Spanish');
  const snap = fs.readdirSync(path.join(d, 'es')).map((f) => read(path.join(d, 'es', f))).join('\n') + read(path.join(d, 'index.html'));
  const r2 = tool('make_es.js', ['--root', d, 'index.html', 'events.html']);
  assert.strictEqual(r2.code, 0, r2.out);
  assert.ok(!/wrote /.test(r2.out), 'second run writes nothing: ' + r2.out);
  assert.strictEqual(fs.readdirSync(path.join(d, 'es')).map((f) => read(path.join(d, 'es', f))).join('\n') + read(path.join(d, 'index.html')), snap, 'byte-identical');
  const c = tool('make_es.js', ['--root', d, '--check', 'index.html', 'events.html']);
  assert.strictEqual(c.code, 0, c.out);
});

test('make_es --check: fails on one untranslated node, a missing Spanish value, and a stale twin', () => {
  const d = copyFixture('i18n');
  assert.strictEqual(tool('make_es.js', ['--root', d, 'untranslated.html']).code, 0, 'writing still succeeds');
  const r = tool('make_es.js', ['--root', d, '--check', '--json', 'untranslated.html']);
  assert.strictEqual(r.code, 1, r.out);
  const rep = JSON.parse(r.stdout);
  const un = rep.pages[0].issues.filter((i) => i.kind === 'untranslated-text');
  assert.strictEqual(un.length, 1, JSON.stringify(rep.pages[0].issues));
  const lineNow = read(path.join(d, 'untranslated.html')).split('\n').findIndex((l) => /Bring a friend/.test(l)) + 1;
  assert.ok(/Bring a friend, it's free/.test(un[0].text) && un[0].line === lineNow, 'names the node and its line (' + un[0].line + ' vs ' + lineNow + ')');
  // a key with no Spanish value
  const s = path.join(d, 'data', 'pages', 'home.js');
  fs.writeFileSync(s, read(s).replace("es: 'Estás invitado'", "es: ''"));
  const r2 = tool('make_es.js', ['--root', d, '--check', '--json', 'events.html']);
  assert.strictEqual(r2.code, 1, r2.out);
  assert.ok(JSON.parse(r2.stdout).pages[0].issues.some((i) => i.kind === 'missing-es' && i.key === 'events:hero.title'), 'missing-es reported');
  // a stale twin
  fs.writeFileSync(s, read(s).replace("es: ''", "es: 'Estás invitado'"));
  assert.strictEqual(tool('make_es.js', ['--root', d, 'events.html']).code, 0);
  fs.writeFileSync(path.join(d, 'events.html'), read(path.join(d, 'events.html')).replace('</main>', '  <p data-t="cta.join">Join free</p>\n  </main>'));
  const r3 = tool('make_es.js', ['--root', d, '--check', '--json', 'events.html']);
  assert.strictEqual(r3.code, 1, r3.out);
  assert.ok(JSON.parse(r3.stdout).pages[0].issues.some((i) => i.kind === 'es-stale'), 'es-stale reported');
});

test('make_es --check: attributes, meta and ysd:og text need keys too', () => {
  const d = copyFixture('i18n');
  fs.writeFileSync(path.join(d, 'attrs.html'), '<!doctype html><html lang="en"><head><title data-t="seo.home.title">x</title>' +
    '<meta name="description" content="Plain English description.">' +
    '<meta name="ysd:og" content=\'{"template":"og-page","title":"A card title in English"}\'></head><body>' +
    '<img src="a.jpg" alt="A photo of friends"><input placeholder="Your name"><button aria-label="Open the menu" title="Menu">≡</button>' +
    '<p translate="no">Young Dems</p><p>Sanford · 2026</p><p lang="es">Hola</p></body></html>');
  const r = tool('make_es.js', ['--root', d, '--check', '--json', 'attrs.html']);
  const kinds = JSON.parse(r.stdout).pages[0].issues.map((i) => i.kind + ':' + (i.text.match(/<\w+ ([\w:-]+)|ysd:og "(\w+)"/) || []).slice(1).filter(Boolean)[0]);
  for (const k of ['untranslated-attr:description', 'untranslated-attr:alt', 'untranslated-attr:placeholder', 'untranslated-attr:aria-label', 'untranslated-attr:title', 'untranslated-og:title']) assert.ok(kinds.indexOf(k) >= 0, k + ' in ' + kinds.join(', '));
  assert.ok(!kinds.some((k) => /untranslated-text/.test(k)), 'translate="no", names and lang="es" need no key: ' + kinds.join(', '));
});

test('make_es: unit helpers (neutral text, URLs, base href on 404)', () => {
  const es = require(path.join(TOOLS, 'make_es.js'));
  assert.ok(es.isNeutral('Sanford · Lake Mary · 2026'));
  assert.ok(es.isNeutral('voteseminole.gov'));
  assert.ok(es.isNeutral('DEMO'));
  assert.ok(!es.isNeutral('Join free'));
  assert.ok(!es.isNeutral('Seminole County'), 'condado de Seminole in Spanish');
  assert.strictEqual(es.prettyPath('index.html'), '/');
  assert.strictEqual(es.prettyPath('es/events.html'), '/es/events');
  const d = copyFixture('i18n');
  fs.writeFileSync(path.join(d, '404.html'), '<!doctype html><html lang="en"><head><base href="/"><title data-t="seo.home.title">x</title></head><body><a href="index.html" data-t="cta.join">Join free</a><img src="assets/x.png" alt=""></body></html>');
  assert.strictEqual(tool('make_es.js', ['--root', d, '404.html']).code, 0);
  const out = read(path.join(d, 'es', '404.html'));
  assert.ok(out.includes('<base href="/es/">') && out.includes('href="index.html"') && out.includes('src="../assets/x.png"'), out);
  assert.ok(!/hreflang/.test(out), '404 gets no hreflang');
});

// ============================================================================================
// make_og.js
// ============================================================================================

function ogSite() {
  const d = copyFixture('i18n');
  copyFromSite(d, ['tools/og.html', 'assets/js/cards.js', 'assets/js/cards-og.js', 'assets/fonts/bricolage-800-wdth.woff2', 'assets/fonts/atkinson-next-var.woff2', 'tools/check_site.js', 'tools/make_es.js', 'tools/read_config.js']);
  assert.strictEqual(tool('make_es.js', ['--root', d, 'index.html', 'events.html']).code, 0);
  return d;
}

test('make_og: 1200 x 630 PNGs under 150 KB from ysd:og, EN and ES, idempotent', () => {
  const og = require(path.join(TOOLS, 'make_og.js'));
  const d = ogSite();
  const r = tool('make_og.js', ['--root', d, '--json']);
  assert.strictEqual(r.code, 0, r.out);
  const rep = JSON.parse(r.stdout);
  const outs = rep.images.map((i) => i.out).sort();
  assert.deepStrictEqual(outs, ['assets/img/og/es/events.png', 'assets/img/og/es/home.png', 'assets/img/og/events.png', 'assets/img/og/home.png']);
  for (const o of outs) {
    const buf = fs.readFileSync(path.join(d, o));
    assert.deepStrictEqual(og.pngSize(buf), { width: 1200, height: 630 }, o);
    assert.ok(buf.length < 150 * 1024, o + ' is ' + buf.length + ' bytes');
    // brand check: og-page default is flat ultraviolet behind the type; the band at the bottom is ink
    const img = og.decodePNG(buf);
    const px = (x, y) => Array.from(img.data.slice((y * 1200 + x) * 4, (y * 1200 + x) * 4 + 3));
    assert.deepStrictEqual(px(20, 300), [0x6A, 0x2B, 0xFF], o + ' violet background');
    assert.deepStrictEqual(px(20, 620), [0x17, 0x0B, 0x33], o + ' ink band');
  }
  assert.notDeepStrictEqual(fs.readFileSync(path.join(d, 'assets/img/og/home.png')), fs.readFileSync(path.join(d, 'assets/img/og/es/home.png')), 'Spanish card differs');
  const r2 = tool('make_og.js', ['--root', d, '--json']);
  assert.strictEqual(r2.code, 0, r2.out);
  assert.strictEqual(JSON.parse(r2.stdout).written.length, 0, 'second run writes nothing');
  const c = tool('make_og.js', ['--root', d, '--check']);
  assert.strictEqual(c.code, 0, c.out);
});

test('make_og: every template renders; bad og:image paths and missing files fail', () => {
  const og = require(path.join(TOOLS, 'make_og.js'));
  const d = ogSite();
  const r = tool('make_og.js', ['--root', d, '--samples', '--json']);
  assert.strictEqual(r.code, 0, r.out);
  const rep = JSON.parse(r.stdout);
  assert.strictEqual(rep.images.length, og.SAMPLES.length);
  for (const i of rep.images) {
    const buf = fs.readFileSync(path.join(d, i.out));
    assert.deepStrictEqual(og.pngSize(buf), { width: 1200, height: 630 }, i.out);
    assert.ok(buf.length < 150 * 1024, i.out + ' ' + buf.length);
  }
  assert.deepStrictEqual(Array.from(new Set(rep.images.map((i) => i.template))).sort(), ['og-event', 'og-page', 'og-quiz']);
  fs.writeFileSync(path.join(d, 'bad.html'), '<!doctype html><html lang="en"><head><meta property="og:image" content="assets/css/x.png"><meta name="ysd:og" content=\'{"template":"og-page","title":"x"}\'></head><body></body></html>');
  const b = tool('make_og.js', ['--root', d, '--pages', 'bad.html']);
  assert.strictEqual(b.code, 1, b.out);
  assert.ok(/only writes there/.test(b.out), b.out);
  fs.unlinkSync(path.join(d, 'bad.html'));
  assert.strictEqual(tool('make_og.js', ['--root', d]).code, 0);
  fs.unlinkSync(path.join(d, 'assets/img/og/events.png'));
  const c = tool('make_og.js', ['--root', d, '--check']);
  assert.strictEqual(c.code, 1, c.out);
  assert.ok(/events\.png does not exist/.test(c.out), c.out);
});

test('make_og --absolutize: og:image and hreflang become absolute from site.url', () => {
  const d = ogSite();
  assert.strictEqual(tool('make_og.js', ['--root', d]).code, 0, 'render first');
  const none = tool('make_og.js', ['--root', d, '--absolutize']);
  assert.strictEqual(none.code, 2, 'refuses without site.url: ' + none.out);
  const r = tool('make_og.js', ['--root', d, '--absolutize', '--site', 'https://youngdems.example']);
  assert.strictEqual(r.code, 0, r.out);
  const en = read(path.join(d, 'index.html')), es = read(path.join(d, 'es', 'index.html'));
  assert.ok(en.includes('content="https://youngdems.example/assets/img/og/home.png"'), 'en og:image');
  assert.ok(es.includes('content="https://youngdems.example/assets/img/og/es/home.png"'), 'es og:image');
  assert.ok(en.includes('hreflang="es" href="https://youngdems.example/es/"') && es.includes('hreflang="en" href="https://youngdems.example/"'), 'hreflang pretty and absolute');
  const again = tool('make_og.js', ['--root', d, '--absolutize', '--site', 'https://youngdems.example']);
  assert.ok(/nothing to absolutize/.test(again.out), again.out);
  assert.strictEqual(tool('make_og.js', ['--root', d, '--check']).code, 0, 'images still found from absolute og:image');
});

test('make_og: PNG codec round-trips', () => {
  const og = require(path.join(TOOLS, 'make_og.js'));
  const w = 7, h = 5, data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = (i * 37) & 255; data[i * 4 + 1] = (i * 11) & 255; data[i * 4 + 2] = 200; data[i * 4 + 3] = 255; }
  const back = og.decodePNG(og.encodePNG({ width: w, height: h, data }));
  assert.deepStrictEqual(Array.from(back.data), Array.from(data), 'palette path is exact for few colours');
  data[3] = 128;
  const back2 = og.decodePNG(og.encodePNG({ width: w, height: h, data }));
  assert.deepStrictEqual(Array.from(back2.data), Array.from(data), 'RGBA path is exact');
});

// ============================================================================================
// qa.js
// ============================================================================================

let qaReport = null;
function qaRun() {
  if (qaReport) return qaReport;
  const d = copyFixture('qa');
  copyFromSite(d, ['assets/js/config.js', 'assets/js/store.js', 'assets/js/share.js']);
  const out = path.join(d, 'qa_report.json');
  const r = tool('qa.js', ['--root', d, '--all', '--targets', path.join(d, 'targets.json'), '--concurrency', '4', '--out', out, '--quiet']);
  qaReport = { code: r.code, out: r.out, report: JSON.parse(read(out)) };
  return qaReport;
}
function row(page, id) {
  const p = qaRun().report.pages.find((x) => x.page === page);
  assert.ok(p, 'page ' + page + ' in report');
  return p.rows[id];
}
function details(r) { return r.details.map((d) => (d.at ? '[' + d.at + '] ' : '') + (d.sel || '') + ' ' + d.text).join('\n'); }

test('qa: the good page and its Spanish twin pass every GATE; exit 1 because defects exist', () => {
  const q = qaRun();
  assert.strictEqual(q.code, 1, 'exit 1 on GATE failures\n' + q.out.slice(-3000));
  for (const p of ['good.html', 'es/good.html']) {
    const pg = q.report.pages.find((x) => x.page === p);
    assert.deepStrictEqual(pg.gatesFailed, [], p + ': ' + pg.gatesFailed.join(', ') + '\n' + JSON.stringify(Object.values(pg.rows).filter((r) => r.score === 0), null, 1));
    assert.strictEqual(pg.points, pg.possible, p + ' scores every measured item 2');
  }
  assert.strictEqual(row('good.html', 'B9').score, 2, 'position target from --targets');
  assert.ok(/page height \d+ px/.test(q.report.pages.find((x) => x.page === 'good.html').rows.height.result));
  assert.ok(/Summary/.test(q.out) && /good\.html\s+16\/16/.test(q.out), 'prints a scored table');
});

test('qa: catches 11 px text', () => {
  const r = row('defect-small-text.html', 'B31');
  assert.strictEqual(r.score, 0); assert.ok(/11 px text/.test(details(r)), details(r));
  assert.strictEqual(row('defect-small-text.html', 'N4').score, 0);
});
test('qa: catches a 40 px target', () => {
  const r = row('defect-small-target.html', 'B31');
  assert.strictEqual(r.score, 0); assert.ok(/40 x 40 px target/.test(details(r)), details(r));
});
test('qa: catches a 335 px block overflowing at 320 (and not at 390)', () => {
  const r = row('defect-overflow.html', 'B31');
  assert.strictEqual(r.score, 0);
  assert.ok(/\[320-light\]\s+page is \d+ px wide at 320 px, widest: .*x-wide \(335 px\)/.test(details(r)), details(r));
  assert.ok(!/390-/.test(details(r)), 'no overflow at 390');
});
test('qa: catches text on a gradient below 4.5:1 by pixel sampling', () => {
  const r = row('defect-gradient.html', 'B8');
  assert.strictEqual(r.score, 0);
  const m = /pixel-sampled ([\d.]+):1 \(need 4\.5\) gradient/.exec(details(r));
  assert.ok(m && +m[1] < 4.5, details(r));
  assert.strictEqual(row('defect-gradient.html', 'N5').score, 0, 'N5: text straight on a gradient');
});
test('qa: catches an animation running under reduced motion', () => {
  const r = row('defect-animation.html', 'N4');
  assert.strictEqual(r.score, 0); assert.ok(/running under reduced motion: x-spin/.test(details(r)), details(r));
  assert.strictEqual(row('defect-animation.html', 'B27').score, 0);
  assert.strictEqual(row('defect-animation.html', 'B28').score, 0, 'looping with no Pause control');
});
test('qa: catches an unlabeled demo count', () => {
  const r = row('defect-demo-count.html', 'B30');
  assert.strictEqual(r.score, 0); assert.ok(/unlabeled count: "48 going"/.test(details(r)), details(r));
  assert.strictEqual(row('good.html', 'B30').score, 2, '"23 going (DEMO)" passes');
});
test('qa: catches share links with localhost / the origin when site.url is set', () => {
  const r = row('defect-share-localhost.html', 'N10');
  assert.strictEqual(r.score, 0);
  assert.ok(/localhost:8000/.test(details(r)) && /127\.0\.0\.1:\d+\/events\.html/.test(details(r)), details(r));
  assert.ok(/qa\.invalid/.test(row('good.html', 'N10').result), 'good share uses site.url');
});
test('qa: catches a request to a non-allowlisted host', () => {
  const r = row('defect-outside-host.html', 'B3');
  assert.strictEqual(r.score, 0); assert.ok(/example\.com/.test(r.result), r.result);
});
test('qa: pixel sampling runs on a marker swipe and a sticker button, after colours settle (sampled.html)', () => {
  const pg = qaRun().report.pages.find((x) => x.page === 'sampled.html');
  assert.deepStrictEqual(pg.gatesFailed, [], JSON.stringify(Object.values(pg.rows).filter((r) => r.score === 0), null, 1));
  const r = row('sampled.html', 'B8');
  const m = /(\d+) pixel-sampled \(1 marker\)/.exec(r.result);
  assert.ok(m && +m[1] >= 2 && !/not sampled/.test(r.result), r.result);
  const sampled = pg.v['390-light'].samples.sampled;
  assert.ok(sampled.some((x) => /^marker span\.x-hi::after/.test(x.why) && /group project/.test(x.text) && x.ratio >= 3), 'marker sampled: ' + JSON.stringify(sampled));
  assert.ok(sampled.some((x) => /^over svg/.test(x.why) && /Sun sticker/.test(x.text) && x.uniform), 'caption over the sticker button sampled: ' + JSON.stringify(sampled));
  assert.strictEqual(pg.v['390-light'].samples.skipped.length, 0, 'nothing skipped');
  assert.strictEqual(row('sampled.html', 'N5').score, 2, 'a marker and a caption on one flat sticker fill pass N5');
  // the same page measured without letting colours settle reads the fade-in and the lagging card halfway
  const d = copyFixture('qa');
  copyFromSite(d, ['assets/js/config.js', 'assets/js/store.js', 'assets/js/share.js']);
  const out = path.join(d, 'nosettle.json');
  tool('qa.js', ['--root', d, '--pages', 'sampled.html', '--no-settle', '--widths', '390', '--no-perf', '--no-share', '--no-axe', '--out', out, '--quiet']);
  const raw = JSON.parse(read(out)).pages[0].rows.B8;
  assert.strictEqual(raw.score, 0, 'without settling: ' + raw.result);
  assert.ok(/x-fade|x-theme/.test(details(raw)), details(raw));
});
test('qa: catches low contrast over a marker swipe; N5 still allows the marker', () => {
  const r = row('defect-marker.html', 'B8');
  assert.strictEqual(r.score, 0);
  assert.ok(/pixel-sampled ([\d.]+):1 \(need 3\) marker span\.x-hi::after \(\d+% of the glyph pixels sit on it\): your people/.test(details(r)), details(r));
  assert.strictEqual(row('defect-marker.html', 'N5').score, 2);
});
test('qa: B37 flags a source-file path that JS writes into the page', () => {
  const r = row('defect-source-path.html', 'B37');
  assert.strictEqual(r.score, 0);
  assert.ok(/\+3\.5 s\].*source path "data\/civic\.js" in rendered text/.test(details(r)), details(r));
  assert.strictEqual(row('good.html', 'B37').score, 2);
});
test('qa: B20 reads the invite landing with words apart', () => {
  const r = row('states.html', 'B20');
  assert.strictEqual(r.score, 2, r.result);
  assert.ok(/landing shows "Kira invited you to Trivia night/.test(r.result), r.result);
});
test('qa: English rendered by JS on a Spanish page fails N8; proper names and DEMO are allowed', () => {
  const r = row('es/defect-english.html', 'N8');
  assert.strictEqual(r.score, 0);
  assert.ok(/English left \(rendered by JS\): "Join free and bring a friend tonight"/.test(details(r)), details(r));
  assert.ok(!/My Voter Record|DEMO/.test(details(r)), 'allowlisted names stay: ' + details(r));
  assert.strictEqual(row('es/good.html', 'N8').score, 2);
});
test('qa: scenarios measure post-interaction states (overflow, text size, targets, contrast)', () => {
  const r = row('defect-scenario.html', 'B31');
  assert.strictEqual(r.score, 0);
  assert.ok(/\[390-light@panel, 390-dark@panel\].*11 px text/.test(details(r)) && /@panel.*30 x 30 px target/.test(details(r)), details(r));
  assert.ok(!/\[390-light\]|\[320-/.test(details(r)), 'only in the opened state');
  assert.strictEqual(row('defect-scenario.html', 'SC').score, 0);
  const ok = qaRun().report.pages.find((x) => x.page === 'states.html');
  assert.strictEqual(row('states.html', 'SC').score, 2, row('states.html', 'SC').result);
  assert.deepStrictEqual(ok.scenarios.map((x) => x.id + ':' + x.status), ['panel:ok', 'not-built:skipped']);
  assert.ok(ok.v['390-dark@panel'] && ok.v['390-dark@panel'].texts > 0, 'measured in dark too');
  assert.strictEqual(row('good.html', 'SC').score, 'n/a');
});
test('qa: a bottom bar hidden until scroll and under 25% passes B6; one covering 35% fails', () => {
  const ok = row('states.html', 'B6');
  assert.strictEqual(ok.score, 2, ok.result + details(ok));
  assert.ok(/bottom bar hidden until scroll \(\d+% of the screen after\)/.test(ok.result), ok.result);
  const bad = row('defect-sticky-bar.html', 'B6');
  assert.strictEqual(bad.score, 0);
  assert.ok(/bottom bar div\.x-bar covers 3\d% of the screen after a scroll \(max 25%\)/.test(details(bad)), details(bad));
});
test('qa: each defect page fails only where its defect is', () => {
  const expect = {
    'defect-small-text.html': ['B31', 'N4'], 'defect-small-target.html': ['B31', 'N4'], 'defect-overflow.html': ['B31', 'N4'],
    'defect-gradient.html': ['B8', 'N4', 'N5'], 'defect-animation.html': ['N4'], 'defect-demo-count.html': ['B30', 'N3'],
    'defect-share-localhost.html': ['N10'], 'defect-outside-host.html': [],
    'defect-marker.html': ['B8', 'N4'], 'defect-sticky-bar.html': ['B6'], 'defect-scenario.html': ['B31', 'N4'], 'defect-source-path.html': [],
    'es/defect-english.html': ['N8'], 'sampled.html': [], 'states.html': []
  };
  for (const [p, gates] of Object.entries(expect)) {
    const pg = qaRun().report.pages.find((x) => x.page === p);
    assert.deepStrictEqual(pg.gatesFailed.slice().sort(), gates.slice().sort(), p);
  }
});
test('qa: unit helpers (contrast matches BRIEF 3.2, English detector)', () => {
  const qa = require(path.join(TOOLS, 'qa.js'));
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  for (const [a, b, want] of [['#170B33', '#FFF6EA', 17.33], ['#FFFFFF', '#6A2BFF', 6.17], ['#C8F03C', '#6A2BFF', 4.70], ['#FFF6EA', '#2236C9', 8.04], ['#574D70', '#FFF6EA', 7.27]]) {
    assert.ok(Math.abs(qa.ratio(hex(a), hex(b)) - want) < 0.02, a + ' on ' + b + ' = ' + qa.ratio(hex(a), hex(b)));
  }
  assert.ok(qa.englishLeft('Join free and bring a friend'));
  assert.ok(qa.englishLeft('Menu'));
  assert.ok(qa.englishLeft('Next question') && qa.englishLeft('Copied') && qa.englishLeft('Your result is ready'), 'JS-rendered UI words');
  assert.ok(!qa.englishLeft('Únete gratis y trae a alguien'));
  assert.ok(!qa.englishLeft('Young Democrats of Seminole County · DEMO'));
  assert.ok(!qa.englishLeft('Sanford, Lake Mary y Oviedo'));
  assert.ok(!qa.englishLeft('Busca tu registro en My Voter Record') && !qa.englishLeft('Rock the Vote'), 'EN_ALLOW names');
  assert.ok(qa.englishLeft('Join the crew') && !qa.englishLeft('Join the crew', ['Join the crew']), 'extra allowlist (--es-allow, targets esAllow)');
  assert.ok(!qa.englishLeft('TEXAS es grande'), 'allowlisted words match whole words only');
  assert.deepStrictEqual(qa.sourcePaths('Loaded from data/civic.js, see assets/img/ and home.css'), ['data/civic.js', 'assets/img/', 'home.css']);
  assert.deepStrictEqual(qa.sourcePaths('See the .js file'), ['.js']);
  assert.deepStrictEqual(qa.sourcePaths('voteseminole.gov/vote.html · 127.0.0.1:8000/join.html · https://x.org/a.js · Node.js · a@b.com'), []);
  // targets: wildcard keys and es/ twins; scenarios for the post-interaction states the checkers asked for
  const T = { '*': { budgetKB: 500 }, 'events/*.html': { scenarios: ['x'] }, 'join.html': { maxHeight: 1 } };
  assert.deepStrictEqual(qa.targetsFor(T, 'es/events/trivia.html').scenarios, ['x']);
  assert.strictEqual(qa.targetsFor(T, 'es/join.html').maxHeight, 1);
  assert.ok(!qa.targetsFor(T, 'events.html').scenarios);
  const ids = (p) => (qa.targetsFor(qa.DEFAULT_TARGETS, p).scenarios || []).map((x) => x.id);
  assert.deepStrictEqual(ids('quiz.html'), ['quiz-done', 'maker']);
  assert.deepStrictEqual(ids('es/events.html'), ['rsvp']);
  assert.deepStrictEqual(ids('events/trivia-county-edition.html'), ['rsvp']);
  assert.deepStrictEqual(ids('join.html'), ['joined']);
  assert.ok(qa.targetsFor(qa.DEFAULT_TARGETS, 'index.html').scenarios[0].optional, 'home maker scenario waits for its hook');
  assert.ok(/transition: none !important/.test(qa.SETTLE_CSS));
});

// ============================================================================================
// voice_lint.js
// ============================================================================================

function voiceRun(files) {
  const r = tool('voice_lint.js', ['--root', path.join(FIX, 'voice'), '--json'].concat(files));
  return { code: r.code, report: JSON.parse(r.stdout) };
}
function expectations(file) {
  const html = read(path.join(FIX, 'voice', file));
  const out = [];
  html.split('\n').forEach((l, i) => { const m = /data-expect="([\w-]+)"/.exec(l); if (m && !/^\s*<!--/.test(l)) out.push({ line: i + 1, rule: m[1] }); });
  return out;
}

test('voice_lint: flags every banned term in the English fixture, on its line', () => {
  const { code, report } = voiceRun(['banned.html']);
  assert.strictEqual(code, 1);
  for (const e of expectations('banned.html')) {
    assert.ok(report.issues.some((i) => i.rule === e.rule && Math.abs(i.line - e.line) <= 1), 'line ' + e.line + ' ' + e.rule + ' in ' + JSON.stringify(report.issues.filter((i) => Math.abs(i.line - e.line) <= 1).map((i) => i.rule)));
  }
});
test('voice_lint: flags every banned term in the Spanish fixture', () => {
  const { report } = voiceRun(['es/banned.html']);
  for (const e of expectations('es/banned.html')) assert.ok(report.issues.some((i) => i.rule === e.rule && i.line === e.line), e.rule + ' line ' + e.line);
});
test('voice_lint: every rule in voice_rules.json fires somewhere in the fixtures', () => {
  const { report } = voiceRun(['banned.html', 'es/banned.html', 'data/banned.js']);
  const rules = JSON.parse(read(path.join(TOOLS, 'voice_rules.json'))).rules.map((r) => r.id);
  const optional = new Set(['fossil-maybe', 'fake-urgency-maybe', 'lecture-maybe', 'era-word', 'time-format-maybe', 'promise-maybe', 'leftovers-data']);
  const fired = new Set(report.issues.map((i) => i.rule));
  const missing = rules.filter((r) => !fired.has(r) && !optional.has(r));
  assert.deepStrictEqual(missing, [], 'rules with no fixture hit');
});
test('voice_lint: data files are linted by en/es leaf; word lists, notes, source URLs and sources[].name are skipped', () => {
  const { report } = voiceRun(['data/banned.js']);
  const where = report.issues.map((i) => i.where + ':' + i.rule);
  for (const w of ['banned.items.0.title.en:chat-labels', 'banned.items.0.title.es:chat-labels', 'banned.items.1.title.en:ages-40-and-under', 'banned.items.1.title.es:ages-40-and-under-es',
    'banned.items.2.body.en:mail-ballot-overclaim', 'banned.items.2.body.es:mail-ballot-overclaim-es', 'banned.items.3.body.en:game-costume', 'banned.items.4.body.en:exclamations',
    'banned.debrief.body.en:serious-exclamation', 'banned.debrief.body.es:serious-exclamation',
    'banned.facts.0.sources.0.label.en:chat-labels', 'banned.labels.sources.en:chat-labels']) assert.ok(where.indexOf(w) >= 0, w + ' in ' + where.join(', '));
  assert.ok(!report.issues.some((i) => /\.never\.|\.note|\.source(\.|$)/.test(i.where)), 'skips never, note and source');
  assert.ok(!report.issues.some((i) => /\.sources\.\d+\.name\./.test(i.where)), 'skips sources[].name (proper titles): ' + where.join(', '));
});
test('voice_lint: the approved lines from BRIEF 2.7 pass', () => {
  const { code, report } = voiceRun(['clean.html']);
  assert.strictEqual(report.errors, 0, JSON.stringify(report.issues, null, 1));
  assert.strictEqual(report.warnings, 0, JSON.stringify(report.issues, null, 1));
  assert.strictEqual(code, 0);
});
test('voice_lint: real data/*.js (reports what owners still need to fix)', () => {
  const r = tool('voice_lint.js', ['--json'].concat(fs.readdirSync(path.join(SITE, 'data')).filter((f) => /\.js$/.test(f)).map((f) => 'data/' + f)));
  const rep = JSON.parse(r.stdout);
  const by = {};
  for (const i of rep.issues.filter((x) => x.severity === 'error')) { const k = i.file + ' ' + i.rule; by[k] = (by[k] || 0) + 1; }
  console.log('     data/*.js voice errors left for owners: ' + (Object.keys(by).length ? Object.entries(by).map(([k, n]) => k + ' x' + n).join('; ') : 'none'));
  if (process.env.W8_STRICT_DATA) assert.strictEqual(rep.errors, 0, 'data/*.js still has voice errors');
});

test('W8 tools carry no assistant or LLM endpoint', () => {
  const bad = new RegExp(['api\\.' + 'open' + 'ai', 'api\\.anth' + 'ropic', 'generativelanguage\\.goo', '@anth' + 'ropic-ai'].join('|'), 'i');
  for (const f of ['tools/make_es.js', 'tools/make_og.js', 'tools/qa.js', 'tools/voice_lint.js', 'tools/og.html', 'assets/js/cards-og.js']) assert.ok(!bad.test(read(path.join(SITE, f))), f);
});

// ============================================================================================
// runner
// ============================================================================================

(async () => {
  const only = process.argv.slice(2);
  let pass = 0, fail = 0;
  const t0 = Date.now();
  for (const t of tests) {
    if (only.length && !only.some((o) => t.name.indexOf(o) >= 0)) continue;
    const s = Date.now();
    try { await t.fn(); pass++; console.log(`ok   ${t.name} (${((Date.now() - s) / 1000).toFixed(1)} s)`); }
    catch (e) { fail++; console.log(`FAIL ${t.name}\n     ${String(e && e.stack ? e.stack : e).split('\n').slice(0, 8).join('\n     ')}`); }
  }
  for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} }
  console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  process.exitCode = fail ? 1 : 0;
})();
