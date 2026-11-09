#!/usr/bin/env node
/**
 * tests/infra/tooling.test.js: tests for the tooling and deployment layer.
 *
 *   node tests/infra/tooling.test.js            (Node 22; Playwright for the browser parts)
 *   node tests/infra/tooling.test.js sw csp     (only tests whose name contains "sw" or "csp")
 *
 * Covers tools/sync_partials.py, tools/make_sitemap.py, tools/credits.py, tools/check_site.js,
 * tools/csp.js, tools/read_config.js, sw.js, assets/js/sw-register.js and the static deploy files
 * (_headers, _redirects, netlify.toml, robots.txt, manifest.webmanifest, package.json,
 * .gitignore). Fixture sites live in tests/infra/fixtures/; anything that writes runs on a temp copy.
 * Exits 1 when any test fails.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');

const SITE = path.resolve(__dirname, '..', '..');
const FIX = path.join(__dirname, 'fixtures');
const TOOLS = path.join(SITE, 'tools');
const temps = [];
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function sh(cmd, args, opts) {
  const r = spawnSync(cmd, args, Object.assign({ encoding: 'utf8', timeout: 240000, cwd: SITE }, opts || {}));
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '', stderr: r.stderr || '' };
}
function tmp(tag) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ysd-tooling-' + tag + '-'));
  temps.push(d);
  return d;
}
function copyFixture(name) {
  const d = tmp(name);
  fs.cpSync(path.join(FIX, name), d, { recursive: true });
  return d;
}
const read = (p) => fs.readFileSync(p, 'utf8');
const py = (script, args, opts) => sh('python3', [path.join(TOOLS, script)].concat(args || []), opts);
const node = (script, args, opts) => sh(process.execPath, [path.join(TOOLS, script)].concat(args || []), opts);

// ============================================================================================
// Static deploy files
// ============================================================================================

test('package.json: scripts and no dependencies', () => {
  const pkg = JSON.parse(read(path.join(SITE, 'package.json')));
  for (const s of ['check', 'sync', 'sitemap', 'credits', 'test']) assert.ok(pkg.scripts && pkg.scripts[s], 'script ' + s);
  assert.ok(!pkg.dependencies || !Object.keys(pkg.dependencies).length, 'no dependencies');
  assert.ok(!pkg.devDependencies || !Object.keys(pkg.devDependencies).length, 'no devDependencies');
  assert.strictEqual(pkg.private, true);
});

test('.gitignore covers generated and local files', () => {
  const gi = read(path.join(SITE, '.gitignore'));
  for (const line of ['node_modules/', 'tools/check_report.json', 'tools/.cache/', '.dev.vars', '.env']) {
    assert.ok(gi.split(/\r?\n/).includes(line), '.gitignore has ' + line);
  }
});

test('manifest.webmanifest: valid, relative scope, placeholder icons under assets/icons/', () => {
  const m = JSON.parse(read(path.join(SITE, 'manifest.webmanifest')));
  for (const k of ['name', 'short_name', 'start_url', 'scope', 'display', 'theme_color', 'background_color', 'icons']) assert.ok(m[k], k);
  assert.strictEqual(m.start_url, './');
  assert.strictEqual(m.scope, './');
  assert.match(m.theme_color, /^#[0-9a-f]{6}$/i);
  assert.match(m.background_color, /^#[0-9a-f]{6}$/i);
  const sizes = m.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'));
  assert.ok(m.icons.some((i) => /maskable/.test(i.purpose || '')), 'a maskable icon');
  for (const i of m.icons) assert.match(i.src, /^assets\/icons\/[a-z0-9-]+\.png$/);
  // Name, description and colours follow assets/js/config.js (tools/manifest.js keeps them in step).
  const { readConfig } = require(path.join(TOOLS, 'read_config.js'));
  const c = readConfig(SITE, { local: false });
  assert.strictEqual(m.name, c.org.name);
  assert.ok([c.org.nickname, c.org.short].includes(m.short_name));
  assert.ok(m.short_name.length <= 12, 'short_name fits under a home-screen icon');
  assert.strictEqual(m.description, c.site.description);
  assert.strictEqual(m.theme_color, c.theme.brand);
  assert.strictEqual(m.background_color, c.theme.bg);
  const r = node('manifest.js', ['--check']);
  assert.strictEqual(r.code, 0, r.out);
  const { buildManifest } = require(path.join(TOOLS, 'manifest.js'));
  const b = buildManifest({ icons: [1], name: 'old' }, { org: { name: 'New', short: 'NW' }, theme: { brand: 'red' } });
  assert.deepStrictEqual(b, { icons: [1], name: 'New', short_name: 'NW' }, 'keeps other keys, ignores non-hex colours');
});

test('robots.txt: crawlable (demo uses noindex), internal folders disallowed', () => {
  const r = read(path.join(SITE, 'robots.txt'));
  assert.match(r, /^User-agent: \*$/m);
  for (const d of ['/api/', '/tools/', '/tests/', '/docs/', '/partials/']) assert.ok(r.includes('Disallow: ' + d), d);
  assert.ok(!/^Disallow: \/\s*$/m.test(r), 'does not disallow everything');
});

test('_headers: security headers, CSP sources, no overlapping duplicates, host limits', () => {
  const { parseHeadersFile, headersFor } = require(path.join(TOOLS, 'check_site.js'));
  const text = read(path.join(SITE, '_headers'));
  const rules = parseHeadersFile(text);
  assert.ok(rules.length <= 100, 'Cloudflare: at most 100 rules');
  for (const line of text.split('\n')) assert.ok(line.length <= 2000, 'Cloudflare: line under 2000 chars');
  for (const line of text.split('\n')) assert.ok(!/^\s+#/.test(line), 'no indented comments: ' + line);
  const h = headersFor(rules, '/index.html');
  const csp = h['content-security-policy'];
  assert.ok(csp, 'CSP on pages');
  const dir = {};
  csp.split(';').forEach((d) => { const p = d.trim().split(/\s+/); if (p[0]) dir[p[0]] = p.slice(1); });
  assert.deepStrictEqual(dir['default-src'], ["'self'"]);
  assert.ok(dir['style-src'].includes('https://fonts.googleapis.com'));
  assert.ok(dir['font-src'].includes('https://fonts.gstatic.com'));
  for (const d of ['img-src', 'media-src']) {
    assert.ok(dir[d].includes('blob:') && dir[d].includes('data:'), d + ' allows blob: and data:');
  }
  assert.ok(dir['img-src'].includes('https://images.unsplash.com'));
  assert.ok(dir['connect-src'].includes("'self'"));
  assert.deepStrictEqual(dir['object-src'], ["'none'"]);
  assert.ok(dir['frame-ancestors'] && dir['base-uri']);
  assert.ok(!dir['script-src'].includes("'unsafe-inline'"), 'no inline scripts');
  assert.strictEqual(h['x-content-type-options'], 'nosniff');
  assert.ok(h['referrer-policy'] && h['permissions-policy'] && h['strict-transport-security']);
  // Each header comes from a single rule for any path (both hosts comma-join repeats).
  const paths = ['/', '/index.html', '/about', '/assets/js/store.js', '/assets/css/site.css', '/data/counters.js',
    '/assets/video/a.mp4', '/assets/img/a.jpg', '/assets/icons/icon-192.png', '/assets/fonts/x.woff2', '/sw.js',
    '/manifest.webmanifest', '/tools/x.js', '/tests/infra/x.html', '/docs/BRIEF.md'];
  for (const p of paths) {
    const seen = {};
    for (const r of rules) {
      if (!r.re || !r.re.test(p)) continue;
      for (const [name] of r.set) {
        const k = name.toLowerCase();
        if (k === 'x-robots-tag') continue;
        assert.ok(!seen[k], `${p}: ${k} set by two rules (${seen[k]} and ${r.pattern})`);
        seen[k] = r.pattern;
      }
    }
  }
  assert.match(headersFor(rules, '/assets/js/store.js')['cache-control'], /max-age=0/);
  assert.match(headersFor(rules, '/assets/video/a.mp4')['cache-control'], /max-age=604800/);
  assert.match(headersFor(rules, '/tools/check_site.js')['x-robots-tag'], /nofollow/);
});

test('_headers parser: splats, placeholders, detach, comma-join; local server strips https-only parts', () => {
  const { parseHeadersFile, headersFor, localizeHeaders } = require(path.join(TOOLS, 'check_site.js'));
  const rules = parseHeadersFile('# c\n/*\n  A: 1\n  X: base\n/blog/:slug/*\n  B: 2\n  ! X\n/a/*\n  A: 3\nhttps://x.example/*\n  C: 4\n');
  assert.deepStrictEqual(headersFor(rules, '/blog/post/img.png'), { a: '1', b: '2' });
  assert.deepStrictEqual(headersFor(rules, '/a/b'), { a: '1, 3', x: 'base' });
  assert.strictEqual(headersFor(rules, '/blog/').b, undefined);
  const loc = localizeHeaders({ 'content-security-policy': "default-src 'self'; upgrade-insecure-requests; block-all-mixed-content", 'strict-transport-security': 'max-age=1' });
  assert.strictEqual(loc['content-security-policy'], "default-src 'self'");
  assert.ok(!('strict-transport-security' in loc));
});

test('csp.js: _headers matches config; endpoints and providers add hosts', () => {
  const r = node('csp.js', ['--check']);
  assert.strictEqual(r.code, 0, r.out);
  const { buildPolicy, serialize, syncHeaders } = require(path.join(TOOLS, 'csp.js'));
  const prod = {
    site: { url: 'https://ysd.example' },
    integrations: {
      formEndpoint: 'https://formspree.io/f/abc', squadEndpoint: '/api/squad', countersEndpoint: 'https://ysd.example/api/c',
      videoUploadEndpoint: '/api/video-upload',
      analytics: { provider: 'plausible', plausibleSrc: 'https://plausible.io/js/script.js' }
    }
  };
  const p = buildPolicy(prod);
  assert.ok(p['connect-src'].includes('https://formspree.io'));
  assert.ok(!p['connect-src'].includes('https://ysd.example'), 'same-origin endpoint not listed');
  for (const hst of ['https://*.mux.com', 'https://storage.googleapis.com', 'https://*.videodelivery.net', 'https://*.cloudflarestream.com']) {
    assert.ok(p['connect-src'].includes(hst), 'video host ' + hst);
  }
  assert.ok(p['script-src'].includes('https://plausible.io') && p['connect-src'].includes('https://plausible.io'));
  const mux = buildPolicy(prod, { video: 'mux' });
  assert.ok(!mux['connect-src'].includes('https://*.videodelivery.net'));
  const cf = buildPolicy({ integrations: { analytics: { provider: 'cloudflare' } } });
  assert.ok(cf['script-src'].includes('https://static.cloudflareinsights.com'));
  assert.ok(cf['connect-src'].includes('https://cloudflareinsights.com'));
  const ts = buildPolicy({ integrations: { turnstileSiteKey: '0x4AAA' } });
  assert.ok(ts['script-src'].includes('https://challenges.cloudflare.com') && ts['frame-src'].includes('https://challenges.cloudflare.com'));
  const extra = buildPolicy({}, { add: ['frame-src https://secure.actblue.com'] });
  assert.ok(extra['frame-src'].includes('https://secure.actblue.com'));
  const self = buildPolicy({ csp: { remove: { 'style-src': ['https://fonts.googleapis.com'] } } }, { remove: ['font-src https://fonts.gstatic.com', 'img-src https://images.unsplash.com'] });
  assert.ok(!self['style-src'].includes('https://fonts.googleapis.com') && !self['font-src'].includes('https://fonts.gstatic.com') && !self['img-src'].includes('https://images.unsplash.com'));
  assert.ok(self['style-src'].includes("'self'"), 'other sources kept');
  assert.throws(() => buildPolicy({ integrations: { videoUploadEndpoint: '/x' } }, { video: 'vimeo' }));
  const s = serialize(buildPolicy({}));
  assert.ok(s.startsWith("default-src 'self'; script-src 'self';") && s.endsWith('upgrade-insecure-requests'));
  const synced = syncHeaders('/*\n  X-A: 1\n  Content-Security-Policy: old\n  X-B: 2\n', s);
  assert.ok(synced.changed && synced.text === '/*\n  X-A: 1\n  Content-Security-Policy: ' + s + '\n  X-B: 2\n');
  // CLI write/check on a copy.
  const d = tmp('csp');
  fs.mkdirSync(path.join(d, 'assets', 'js'), { recursive: true });
  fs.copyFileSync(path.join(SITE, 'assets', 'js', 'config.js'), path.join(d, 'assets', 'js', 'config.js'));
  fs.writeFileSync(path.join(d, '_headers'), '/*\n  Content-Security-Policy: stale\n');
  assert.strictEqual(node('csp.js', ['--root', d, '--check']).code, 1);
  assert.strictEqual(node('csp.js', ['--root', d, '--write']).code, 0);
  assert.strictEqual(node('csp.js', ['--root', d, '--check']).code, 0);
  assert.ok(read(path.join(d, '_headers')).includes(s));
});

test('read_config.js: evaluates config.js, overrides deep-merge, CLI prints values', () => {
  const { readConfig, cfg } = require(path.join(TOOLS, 'read_config.js'));
  const c = readConfig(SITE, { local: false });
  assert.strictEqual(typeof c.demo, 'boolean');
  assert.ok(cfg(c, 'org.handle') && typeof cfg(c, 'org.handle') === 'string');
  assert.strictEqual(cfg(c, 'no.such.key', 'fb'), 'fb');
  const o = readConfig(SITE, { local: false, override: { demo: false, site: { url: 'https://x.example' } } });
  assert.strictEqual(o.demo, false);
  assert.strictEqual(o.site.url, 'https://x.example');
  assert.strictEqual(o.site.lang, c.site.lang, 'deep merge keeps siblings');
  assert.strictEqual(readConfig(tmp('noconfig')), null);
  const r = node('read_config.js', ['--no-local', 'org.handle']);
  assert.strictEqual(r.code, 0);
  assert.strictEqual(JSON.parse(r.stdout), cfg(c, 'org.handle'));
});

test('_redirects: portable syntax; /go/ short links match config.js links.vote', () => {
  const { readConfig } = require(path.join(TOOLS, 'read_config.js'));
  const vote = readConfig(SITE, { local: false }).links.vote;
  const map = {
    '/go/register': 'register', '/go/check': 'checkRegistration', '/go/vote-by-mail': 'voteByMail',
    '/go/polling-place': 'pollingPlace', '/go/early-voting': 'earlyVoting', '/go/my-voter-record': 'myVoterRecord',
    '/go/elections': 'upcomingElections', '/go/soe': 'countyElections'
  };
  const lines = read(path.join(SITE, '_redirects')).split(/\r?\n/).filter((l) => l.trim() && !/^\s*#/.test(l));
  assert.ok(lines.length > 0);
  const seen = {};
  for (const l of lines) {
    const f = l.trim().split(/\s+/);
    assert.strictEqual(f.length, 3, 'explicit status code (hosts differ on the default): ' + l);
    assert.ok(!/!/.test(f[2] || ''), 'no force flags: ' + l);
    const status = f[2] ? +f[2] : 302;
    assert.ok([200, 301, 302, 303, 307, 308].includes(status), 'status supported by both hosts: ' + l);
    if (status === 200) assert.ok(f[1].startsWith('/'), 'rewrites must be relative: ' + l);
    seen[f[0]] = f[1];
  }
  for (const [from, key] of Object.entries(map)) {
    assert.ok(vote[key], 'config links.vote.' + key);
    assert.strictEqual(seen[from], vote[key], from + ' matches config links.vote.' + key);
  }
});

test('netlify.toml: publish ".", functions dir, forced /api/* rewrite, no [[headers]]', () => {
  const r = sh('python3', ['-c', 'import tomllib,json,sys; print(json.dumps(tomllib.load(open(sys.argv[1],"rb"))))', path.join(SITE, 'netlify.toml')]);
  assert.strictEqual(r.code, 0, r.out);
  const t = JSON.parse(r.stdout);
  assert.strictEqual(t.build.publish, '.');
  assert.strictEqual(t.build.functions, 'netlify/functions');
  assert.ok(!('headers' in t), 'headers live in _headers only');
  const api = t.redirects.find((x) => x.from === '/api/*');
  assert.ok(api && api.to === '/.netlify/functions/:splat' && api.status === 200 && api.force === true);
  for (const dir of ['/tools/*', '/tests/*', '/partials/*', '/netlify/*', '/functions/*']) {
    const x = t.redirects.find((y) => y.from === dir);
    assert.ok(x && x.status === 404 && x.force === true, 'hides ' + dir);
  }
  assert.ok(t.redirects.indexOf(api) === 0, '/api/* rule comes first');
});

test('no chat assistant or LLM endpoint in tooling and deploy files', () => {
  const files = ['_headers', '_redirects', 'netlify.toml', 'robots.txt', 'manifest.webmanifest', 'sw.js',
    'assets/js/sw-register.js', 'package.json'].concat(fs.readdirSync(TOOLS).filter((f) => /\.(js|py)$/.test(f)).map((f) => 'tools/' + f));
  const bad = /api\.anthropic\.com|api\.openai\.com|generativelanguage\.googleapis|\/api\/(ask|chat|assistant|llm)\b|@anthropic-ai\/sdk|openai/i;
  for (const f of files) assert.ok(!bad.test(read(path.join(SITE, f))), f + ' has no assistant/LLM reference');
});

test('sw.js and sw-register.js parse', () => {
  for (const f of ['sw.js', 'assets/js/sw-register.js', 'tools/check_site.js', 'tools/csp.js', 'tools/read_config.js', 'tools/manifest.js']) {
    const r = sh(process.execPath, ['--check', path.join(SITE, f)]);
    assert.strictEqual(r.code, 0, f + ': ' + r.out);
  }
  for (const f of ['sync_partials.py', 'make_sitemap.py', 'credits.py']) {
    const r = sh('python3', ['-m', 'py_compile', path.join(TOOLS, f)]);
    assert.strictEqual(r.code, 0, f + ': ' + r.out);
  }
});

// ============================================================================================
// sync_partials.py
// ============================================================================================

test('sync_partials: check finds drift, sync fills markers, aria-current, {{root}}, idempotent', () => {
  const d = copyFixture('partials-site');
  const before = {
    tests: read(path.join(d, 'tests', 'ignored.html')),
    docs: read(path.join(d, 'docs', 'ignored.html'))
  };
  let r = py('sync_partials.py', ['--root', d, '--check']);
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, /drift: index\.html/);
  assert.match(r.out, /drift: events\/index\.html/);
  assert.match(r.out, /warning: no partials\/missing-partial\.html/);
  assert.strictEqual(read(path.join(d, 'index.html')).includes('stale header markup'), true, '--check writes nothing');

  r = py('sync_partials.py', ['--root', d]);
  assert.strictEqual(r.code, 0, r.out);
  const home = read(path.join(d, 'index.html'));
  assert.ok(!home.includes('stale header markup'));
  assert.ok(home.includes('<header class="site-header">'));
  assert.ok(home.includes('  <!-- @header -->\n  <header class="site-header">\n'), 'indented to the marker');
  assert.ok(home.includes('    <!-- @nav -->\n    <nav aria-label="Main">'), 'nested partial expanded');
  assert.ok(home.includes('<a href="index.html" aria-current="page">Home</a>'));
  assert.ok(home.includes('<a href="index.html" data-no-current>Site name</a>'), 'data-no-current untouched');
  assert.ok(home.includes('<a href="about.html">About</a>'));
  assert.ok(home.includes('<!--@footer--><footer>'), 'inline marker gets raw content');
  assert.ok(home.includes('left alone: there is no partials/missing-partial.html'));
  const about = read(path.join(d, 'about.html'));
  assert.ok(about.includes('<a href="about.html" aria-current="page">About</a>'));
  assert.ok(about.includes('<a href="index.html">Home</a>'));
  assert.ok(/<footer>[\s\S]*<a href="about.html" aria-current="page">About<\/a>/.test(about), 'partial without <nav>: all links considered');
  const ev = read(path.join(d, 'events', 'index.html'));
  assert.ok(ev.includes('<a href="../events/" aria-current="page">Events</a>'));
  assert.ok(ev.includes('<a href="../index.html">Home</a>'));
  assert.ok(!ev.includes('{{root}}'));
  assert.strictEqual(read(path.join(d, 'tests', 'ignored.html')), before.tests, 'tests/ skipped');
  assert.strictEqual(read(path.join(d, 'docs', 'ignored.html')), before.docs, 'docs/ skipped');

  const snapshot = home + about + ev;
  r = py('sync_partials.py', ['--root', d]);
  assert.strictEqual(r.code, 0);
  assert.match(r.out, /0 updated/);
  assert.strictEqual(read(path.join(d, 'index.html')) + read(path.join(d, 'about.html')) + read(path.join(d, 'events', 'index.html')), snapshot, 'idempotent');
  assert.strictEqual(py('sync_partials.py', ['--root', d, '--check']).code, 0);

  // A partial edit is drift again; a page edit between markers is overwritten.
  fs.writeFileSync(path.join(d, 'partials', 'footer.html'), '<footer>New footer</footer>\n');
  assert.strictEqual(py('sync_partials.py', ['--root', d, '--check']).code, 1);
  py('sync_partials.py', ['--root', d]);
  assert.ok(read(path.join(d, 'about.html')).includes('<!--@footer--><footer>New footer</footer><!--/@footer-->'));
});

test('sync_partials: {{site}} and {{path}} build absolute canonical URLs', () => {
  const d = copyFixture('partials-site');
  let r = py('sync_partials.py', ['--root', d, '--site', 'https://example.org/']);
  assert.strictEqual(r.code, 0, r.out);
  assert.ok(read(path.join(d, 'index.html')).includes('<link rel="canonical" href="https://example.org/">'));
  assert.ok(read(path.join(d, 'about.html')).includes('<link rel="canonical" href="https://example.org/about">'));
  assert.ok(read(path.join(d, 'events', 'index.html')).includes('<meta property="og:url" content="https://example.org/events/">'));
  assert.strictEqual(py('sync_partials.py', ['--root', d, '--site', 'https://example.org', '--check']).code, 0);
  assert.strictEqual(py('sync_partials.py', ['--root', d, '--site', 'https://new.example', '--check']).code, 1, 'domain change is drift');
  // No --site, no SITE_URL and no config.js: relative URLs plus a warning.
  r = py('sync_partials.py', ['--root', d], { env: Object.assign({}, process.env, { SITE_URL: '' }) });
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /\{\{site\}\} is empty/);
  assert.ok(read(path.join(d, 'about.html')).includes('<link rel="canonical" href="/about">'));
  // The make_sitemap canonical rule picks the synced canonical up.
  py('sync_partials.py', ['--root', d, '--site', 'https://example.org']);
  r = py('make_sitemap.py', ['--root', d, '--base', 'https://example.org', '--print', '--no-lastmod']);
  assert.ok(r.stdout.includes('<loc>https://example.org/about</loc>'));
});

test('sync_partials: CRLF pages keep CRLF; only listed pages are synced', () => {
  const d = copyFixture('partials-site');
  const p = path.join(d, 'about.html');
  fs.writeFileSync(p, read(p).replace(/\n/g, '\r\n'));
  const r = py('sync_partials.py', ['--root', d, path.join(d, 'about.html')]);
  assert.strictEqual(r.code, 0, r.out);
  const t = read(p);
  assert.ok(t.includes('\r\n') && !/[^\r]\n/.test(t), 'CRLF preserved');
  assert.ok(read(path.join(d, 'index.html')).includes('stale header markup'), 'index.html not touched');
});

test('sync_partials: marker errors exit 2 and leave the page alone; empty roots are fine', () => {
  const d = copyFixture('partials-site');
  const bad = '<html><body>\n<!-- @header -->\nno close\n</body></html>\n';
  fs.writeFileSync(path.join(d, 'broken.html'), bad);
  let r = py('sync_partials.py', ['--root', d]);
  assert.strictEqual(r.code, 2, r.out);
  assert.match(r.out, /broken\.html: <!-- @header --> is not closed/);
  assert.strictEqual(read(path.join(d, 'broken.html')), bad);
  fs.writeFileSync(path.join(d, 'broken.html'), '<p>x</p>\n<!-- /@footer -->\n');
  r = py('sync_partials.py', ['--root', d]);
  assert.strictEqual(r.code, 2);
  assert.match(r.out, /without an opening marker/);
  fs.writeFileSync(path.join(d, 'broken.html'), '<!-- @loop --><!-- /@loop -->\n');
  fs.writeFileSync(path.join(d, 'partials', 'loop.html'), '<div><!-- @loop --><!-- /@loop --></div>\n');
  r = py('sync_partials.py', ['--root', d, path.join(d, 'broken.html')]);
  assert.strictEqual(r.code, 2);
  assert.match(r.out, /loop/);

  const empty = tmp('nopartials');
  fs.writeFileSync(path.join(empty, 'index.html'), '<p>hi</p>');
  r = py('sync_partials.py', ['--root', empty, '--check']);
  assert.strictEqual(r.code, 0);
  assert.match(r.out, /no partials/);
  const nopages = tmp('nopages');
  fs.mkdirSync(path.join(nopages, 'partials'));
  fs.writeFileSync(path.join(nopages, 'partials', 'nav.html'), '<nav></nav>');
  r = py('sync_partials.py', ['--root', nopages, '--check']);
  assert.strictEqual(r.code, 0);
  assert.match(r.out, /no pages/);
});

// ============================================================================================
// make_sitemap.py
// ============================================================================================

test('make_sitemap: pretty and html URLs, exclusions, canonical, robots line, missing base', () => {
  const d = copyFixture('partials-site');
  fs.writeFileSync(path.join(d, '404.html'), '<title>404</title>');
  fs.writeFileSync(path.join(d, 'offline.html'), '<title>Offline</title>');
  fs.writeFileSync(path.join(d, 'secret.html'), '<meta name="robots" content="noindex, nofollow"><title>x</title>');
  fs.writeFileSync(path.join(d, 'join.html'), '<link rel="canonical" href="https://example.org/join-us"><title>Join</title>');
  fs.writeFileSync(path.join(d, 'robots.txt'), 'User-agent: *\nDisallow: /tools/\n');
  let r = py('make_sitemap.py', ['--root', d, '--base', 'https://example.org/']);
  assert.strictEqual(r.code, 0, r.out);
  const xml = read(path.join(d, 'sitemap.xml'));
  const locs = Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g)).map((m) => m[1]);
  assert.deepStrictEqual(locs, ['https://example.org/', 'https://example.org/about', 'https://example.org/events/', 'https://example.org/join-us']);
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.strictEqual((xml.match(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/g) || []).length, 4);
  const parsed = sh('python3', ['-c', 'import sys,xml.etree.ElementTree as E; print(len(E.parse(sys.argv[1]).getroot()))', path.join(d, 'sitemap.xml')]);
  assert.strictEqual(parsed.stdout.trim(), '4', 'well-formed XML');

  r = py('make_sitemap.py', ['--root', d, '--base', 'https://example.org', '--style', 'html', '--no-lastmod', '--print']);
  assert.ok(r.stdout.includes('<loc>https://example.org/about.html</loc>') && r.stdout.includes('<loc>https://example.org/events/index.html</loc>'));
  assert.ok(!r.stdout.includes('<lastmod>'));

  r = py('make_sitemap.py', ['--root', d, '--base', 'https://example.org', '--robots']);
  assert.strictEqual(r.code, 0);
  py('make_sitemap.py', ['--root', d, '--base', 'https://example.org', '--robots']);
  const robots = read(path.join(d, 'robots.txt'));
  assert.strictEqual((robots.match(/^Sitemap: https:\/\/example\.org\/sitemap\.xml$/gm) || []).length, 1, 'one Sitemap line');

  r = py('make_sitemap.py', ['--root', d], { env: Object.assign({}, process.env, { SITE_URL: '' }) });
  assert.strictEqual(r.code, 2);
  assert.match(r.out, /no base URL/);
  assert.strictEqual(py('make_sitemap.py', ['--root', d, '--base', 'example.org']).code, 2, 'relative base rejected');
});

test('make_sitemap: reads site.url from config.js (with config.local.js override)', () => {
  const d = copyFixture('partials-site');
  fs.mkdirSync(path.join(d, 'assets', 'js'), { recursive: true });
  fs.copyFileSync(path.join(SITE, 'assets', 'js', 'config.js'), path.join(d, 'assets', 'js', 'config.js'));
  fs.writeFileSync(path.join(d, 'assets', 'js', 'config.local.js'), "window.YSD_CONFIG = { site: { url: 'https://ysd.example' } };\n");
  const r = py('make_sitemap.py', ['--root', d, '--print'], { env: Object.assign({}, process.env, { SITE_URL: '' }) });
  assert.strictEqual(r.code, 0, r.out);
  assert.ok(r.stdout.includes('<loc>https://ysd.example/</loc>'));
});

// ============================================================================================
// credits.py
// ============================================================================================

test('credits: finds remote media, credits next to them, fonts, usage lines; --check', () => {
  const d = tmp('credits');
  fs.mkdirSync(path.join(d, 'data'));
  fs.mkdirSync(path.join(d, 'assets', 'css'), { recursive: true });
  fs.mkdirSync(path.join(d, 'tests'));
  fs.writeFileSync(path.join(d, 'index.html'), [
    '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;800&family=Space+Grotesk&display=swap" rel="stylesheet">',
    '<img src="https://images.unsplash.com/photo-123-abc?w=800&q=80" data-credit="Jane Doe" alt="">',
    '<a href="https://unsplash.com/@janedoe">profile link is not media</a>',
    '<img src="https://example.org/placeholder.png" alt="">'
  ].join('\n'));
  fs.writeFileSync(path.join(d, 'assets', 'css', 'site.css'), '.hero {\n  /* credit: John Roe */\n  background: url(https://images.unsplash.com/photo-456-def?fm=jpg);\n}\n');
  fs.writeFileSync(path.join(d, 'data', 'media.js'), [
    'window.YSD_DATA = { media: [',
    '  { url: "https://images.unsplash.com/photo-789-ghi", photographer: "Ann Lee", page: "https://unsplash.com/photos/x-789", license: "Unsplash License" },',
    '  { url: "https://media.test-cdn.org/clips/rally.mp4", note: "no credit here" }',
    '] };'
  ].join('\n'));
  fs.writeFileSync(path.join(d, 'tests', 'x.js'), 'const u = "https://images.unsplash.com/photo-999-test";');
  let r = py('credits.py', ['--root', d]);
  assert.strictEqual(r.code, 0, r.out);
  const md = read(path.join(d, 'CREDITS.md'));
  assert.ok(md.includes('[photo-123-abc](https://images.unsplash.com/photo-123-abc)') && md.includes('Jane Doe') && md.includes('`index.html:2`'));
  assert.ok(md.includes('photo-456-def') && md.includes('John Roe') && md.includes('`assets/css/site.css:3`'));
  assert.ok(md.includes('[Ann Lee](https://unsplash.com/photos/x-789)') && md.includes('`data/media.js:2`'));
  assert.ok(md.includes('rally.mp4') && /## Missing credits \(1\)[\s\S]*rally\.mp4/.test(md));
  assert.ok(/\| Inter \| Google Fonts \| `index.html:1` \|/.test(md) && md.includes('| Space Grotesk |'));
  assert.ok(!md.includes('photo-999-test'), 'tests/ skipped');
  assert.ok(!md.includes('placeholder.png'), 'example.org skipped');
  assert.ok(!md.includes('unsplash.com/@janedoe'), 'profile links are not media');
  assert.strictEqual(py('credits.py', ['--root', d, '--check']).code, 0);
  fs.appendFileSync(path.join(d, 'index.html'), '\n<video src="https://media.test-cdn.org/clips/new.webm"></video>');
  r = py('credits.py', ['--root', d, '--check']);
  assert.strictEqual(r.code, 1, r.out);
});

test('credits: real site data files record a photographer for every Unsplash photo', () => {
  const r = py('credits.py', ['--json']);
  assert.strictEqual(r.code, 0, r.out);
  const data = JSON.parse(r.stdout);
  const fromClips = data.assets.filter((a) => a.used.some((u) => u.startsWith('data/clips.js:')));
  if (!fs.existsSync(path.join(SITE, 'data', 'clips.js'))) return;
  assert.ok(fromClips.length > 0, 'data/clips.js photos found');
  for (const a of fromClips) assert.ok(a.credit.credit && a.credit.page, 'credit for ' + a.url);
});

// ============================================================================================
// check_site.js
// ============================================================================================

function checkSite(root, extra) {
  const out = path.join(tmp('report'), 'report.json');
  const r = node('check_site.js', ['--root', root, '--out', out].concat(extra || []));
  const report = fs.existsSync(out) ? JSON.parse(read(out)) : null;
  return Object.assign(r, { report });
}

test('check_site: good fixture passes with _headers CSP applied', () => {
  const r = checkSite(path.join(FIX, 'site-good'));
  assert.strictEqual(r.code, 0, r.out);
  assert.ok(r.report.headersEmulated);
  assert.strictEqual(r.report.summary.pages, 2);
  assert.strictEqual(r.report.summary.errors, 0, r.out);
  assert.strictEqual(r.report.summary.warnings, 0, r.out);
  assert.match(r.out, /SUMMARY: 2 pages x 2 viewports: 0 errors, 0 warnings/);
  assert.ok(['ran', 'skipped'].includes(r.report.axe.status));
  if (r.report.axe.status === 'skipped') assert.ok(r.report.notes.some((n) => /axe-core skipped/.test(n)));
});

test('check_site: bad fixture reports every problem and exits 1', () => {
  const r = checkSite(path.join(FIX, 'site-bad'));
  assert.strictEqual(r.code, 1, r.out);
  const by = r.report.summary.byCheck;
  for (const c of ['console-error', 'page-error', 'failed-request', 'title', 'lang', 'viewport', 'overflow', 'img-alt',
    'duplicate-id', 'heading-order', 'accessible-name', 'tap-target', 'broken-link', 'broken-anchor', 'link',
    'meta-description', 'canonical', 'og:title', 'og:image', 'og:description', 'twitter:card']) {
    assert.ok(by[c] > 0, 'reports ' + c + '\n' + r.out);
  }
  const issues = r.report.pages[0].issues;
  const msg = (re) => issues.some((i) => re.test(i.message));
  assert.ok(msg(/Content Security Policy/), 'CSP violation from _headers is a console error');
  assert.ok(msg(/fixture console error/) && msg(/fixture page error/));
  assert.ok(msg(/missing\.css/));
  assert.ok(msg(/broken link \(404\): nope\.html/));
  assert.ok(msg(/"missing-anchor"/) && msg(/"nowhere"/));
  assert.ok(!msg(/"somewhere"/), 'valid cross-page anchor is not reported');
  const overflow = issues.filter((i) => i.check === 'overflow');
  assert.ok(overflow.some((i) => i.viewports.includes('mobile')) && overflow.some((i) => i.viewports.includes('desktop')));
  assert.ok(issues.find((i) => i.check === 'overflow' && /div\.wide/.test(i.message)), 'names the wide element');
  assert.ok(issues.filter((i) => i.check === 'tap-target').length >= 2);
  if (r.report.axe.status === 'ran') assert.ok(by['axe:image-alt'] > 0, 'axe found the missing alt');
});

test('check_site: no pages yet is not an error; --strict fails noindex pages', () => {
  const r = checkSite(path.join(FIX, 'site-empty'));
  assert.strictEqual(r.code, 0, r.out);
  assert.strictEqual(r.report.summary.pages, 0);
  assert.ok(r.report.notes.some((n) => /no root-level \*\.html pages/.test(n)));

  const d = copyFixture('site-good');
  fs.appendFileSync(path.join(d, '_headers'), '  X-Robots-Tag: noindex\n');
  const loose = checkSite(d, ['--no-axe']);
  assert.strictEqual(loose.code, 0, loose.out);
  assert.ok(loose.report.notes.some((n) => /noindex/.test(n)));
  const strict = checkSite(d, ['--no-axe', '--strict']);
  assert.strictEqual(strict.code, 1, strict.out);
  assert.ok(strict.report.summary.byCheck.noindex === 2);
  const one = checkSite(d, ['--no-axe', '--pages', 'about.html', '--viewports', '390x844']);
  assert.strictEqual(one.report.summary.pages, 1);
  assert.strictEqual(one.report.viewports.length, 1);
});

test('check_site: the real site root runs (pages may not exist yet)', () => {
  const r = checkSite(SITE, ['--no-axe']);
  assert.ok(r.code === 0 || r.code === 1, r.out);
  assert.ok(r.report && typeof r.report.summary.errors === 'number');
});

// ============================================================================================
// sw.js + assets/js/sw-register.js (browser)
// ============================================================================================

function swServer() {
  const overlays = new Map();
  let offline = false;
  const types = { '.js': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8', '.css': 'text/css' };
  const server = http.createServer((req, res) => {
    if (offline) { req.socket.destroy(); return; }
    const p = new URL(req.url, 'http://x').pathname;
    if (overlays.has(p)) {
      const o = overlays.get(p);
      if (!o) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': o.type, 'Cache-Control': 'no-cache' });
      return res.end(o.body);
    }
    const file = path.join(SITE, decodeURIComponent(p));
    if (!file.startsWith(SITE + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
  return { server, overlays, setOffline(v) { offline = v; } };
}

const html = (body) => ({ type: 'text/html; charset=utf-8', body });
const waitControlled = (page) => page.evaluate(() => navigator.serviceWorker.ready.then(() => new Promise((res) => {
  if (navigator.serviceWorker.controller) return res(true);
  navigator.serviceWorker.addEventListener('controllerchange', () => res(true));
  setTimeout(() => res(!!navigator.serviceWorker.controller), 5000);
})));

test('sw: registers, network-first pages, offline fallbacks, SWR assets, never caches /api/', async () => {
  const { chromium } = require('playwright');
  const s = swServer();
  await new Promise((r) => s.server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + s.server.address().port;
  const tpl = read(path.join(FIX, 'sw', 'page.html'));
  s.overlays.set('/__swtest.html', html(tpl.split('__VERSION__').join('VERSION_A')));
  s.overlays.set('/__swtest_demo.html', html(read(path.join(FIX, 'sw', 'demo.html'))));
  s.overlays.set('/__swasset.js', { type: 'text/javascript', body: 'A' });
  s.overlays.set('/api/ping', { type: 'text/plain', body: 'pong' });
  s.overlays.set('/offline.html', null);
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.goto(base + '/__swtest.html');
    await page.waitForFunction(() => window.YSD && YSD.sw && YSD.sw.status === 'registered', null, { timeout: 10000 });
    assert.ok(await waitControlled(page), 'page controlled by the worker');
    const version = await page.evaluate(() => new Promise((res) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = (e) => res(e.data.version);
      navigator.serviceWorker.controller.postMessage({ type: 'VERSION' }, [ch.port2]);
    }));
    assert.match(version, /^ysd-v\d+$/);

    await page.reload();
    assert.strictEqual(await page.textContent('#v'), 'VERSION_A');
    const keys = () => page.evaluate(async () => {
      const out = [];
      for (const n of await caches.keys()) for (const k of await (await caches.open(n)).keys()) out.push(n + ' ' + new URL(k.url).pathname + new URL(k.url).search);
      return out;
    });
    assert.ok((await keys()).some((k) => /-pages \/__swtest\.html$/.test(k)), 'page cached');

    s.overlays.set('/__swtest.html', html(tpl.split('__VERSION__').join('VERSION_B')));
    await page.reload();
    assert.strictEqual(await page.textContent('#v'), 'VERSION_B', 'network first');
    await page.goto(base + '/__swtest.html?ref=KIRA7QX&utm_source=share');
    assert.ok(!(await keys()).some((k) => k.includes('?')), 'page keys drop ?query');

    const fetchText = (u) => page.evaluate((x) => fetch(x).then((r) => r.text(), () => 'NETWORK-ERROR'), u);
    assert.strictEqual(await fetchText('/__swasset.js'), 'A');
    s.overlays.set('/__swasset.js', { type: 'text/javascript', body: 'B' });
    assert.strictEqual(await fetchText('/__swasset.js'), 'A', 'stale copy first');
    let fresh = '';
    for (let i = 0; i < 40 && fresh !== 'B'; i++) { await page.waitForTimeout(100); fresh = await fetchText('/__swasset.js'); }
    assert.strictEqual(fresh, 'B', 'revalidated in the background');

    assert.strictEqual(await fetchText('/api/ping'), 'pong');
    assert.ok(!(await keys()).some((k) => k.includes('/api/')), '/api/ never cached');

    s.setOffline(true);
    await page.reload();
    assert.strictEqual(await page.textContent('#v'), 'VERSION_B', 'offline: cached page');
    await page.goto(base + '/__swtest.html?ref=OTHER');
    assert.strictEqual(await page.textContent('#v'), 'VERSION_B', 'offline: query ignored');
    const resp = await page.goto(base + '/never-visited.html');
    assert.strictEqual(resp.status(), 503);
    assert.strictEqual(await page.getAttribute('body', 'data-ysd-offline'), 'builtin', 'built-in offline page when offline.html is missing');
    await page.goto(base + '/__swtest.html');
    assert.strictEqual(await fetchText('/api/ping'), 'NETWORK-ERROR', 'offline /api/ is not served from cache');
    assert.strictEqual(await fetchText('/__swasset.js'), 'B', 'offline: cached asset');
    s.setOffline(false);

    // Demo defaults: the worker stays off and the earlier registration is removed.
    await page.goto(base + '/__swtest_demo.html');
    await page.waitForFunction(() => window.YSD && YSD.sw && YSD.sw.status === 'disabled', null, { timeout: 5000 });
    assert.strictEqual(await page.evaluate(() => YSD.sw.reason), 'demo');
    await page.waitForFunction(() => navigator.serviceWorker.getRegistrations().then((r) => r.length === 0), null, { timeout: 5000, polling: 200 });
    assert.deepStrictEqual(await page.evaluate(() => caches.keys().then((k) => k.filter((n) => n.startsWith('ysd-')))), [], 'caches cleared');
    assert.deepStrictEqual(pageErrors, []);
    await ctx.close();

    // offline.html is used when it exists.
    s.overlays.set('/offline.html', html('<!doctype html><html lang="en"><title>Offline</title><p id="off">OFFLINE_PAGE</p></html>'));
    const ctx2 = await browser.newContext();
    const p2 = await ctx2.newPage();
    await p2.goto(base + '/__swtest.html');
    await p2.waitForFunction(() => window.YSD && YSD.sw && YSD.sw.status === 'registered', null, { timeout: 10000 });
    assert.ok(await waitControlled(p2));
    s.setOffline(true);
    await p2.goto(base + '/never-visited-2.html');
    assert.strictEqual(await p2.textContent('#off'), 'OFFLINE_PAGE');
    s.setOffline(false);
    await ctx2.close();

    // file:// never registers.
    const ctx3 = await browser.newContext();
    const p3 = await ctx3.newPage();
    await p3.goto('file://' + path.join(FIX, 'sw', 'file.html'));
    await p3.waitForFunction(() => window.YSD && YSD.sw && YSD.sw.status !== 'idle', null, { timeout: 5000 });
    assert.strictEqual(await p3.evaluate(() => YSD.sw.status), 'file');
    await ctx3.close();
  } finally {
    s.setOffline(false);
    await browser.close();
    s.server.close();
  }
});

// ============================================================================================

(async () => {
  const filters = process.argv.slice(2);
  const chosen = filters.length ? tests.filter((t) => filters.some((f) => t.name.includes(f))) : tests;
  let pass = 0, fail = 0;
  const started = Date.now();
  for (const t of chosen) {
    const t0 = Date.now();
    try {
      await t.fn();
      pass++;
      console.log(`ok   ${t.name} (${Date.now() - t0} ms)`);
    } catch (e) {
      fail++;
      console.log(`FAIL ${t.name}\n     ${String(e && e.stack ? e.stack : e).split('\n').slice(0, 6).join('\n     ')}`);
    }
  }
  for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} }
  console.log(`tooling.test.js: ${pass} passed, ${fail} failed (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  process.exitCode = fail ? 1 : 0;
})();
