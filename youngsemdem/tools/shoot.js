#!/usr/bin/env node
/**
 * tools/shoot.js: full-page screenshots of the site, plus one contact sheet per width.
 *
 * Serves the site from a local http server on 127.0.0.1 (the server tools/check_site.js uses, with
 * the _headers file applied, so the production Content-Security-Policy is enforced just as on the
 * host), opens every root-level *.html page (or the --pages list) in Playwright Chromium at each
 * width and colour scheme, scrolls through the page so lazy images load, waits for web fonts, images
 * and the network to settle, and saves a full-page PNG. Then it lays the shots out as labelled
 * thumbnails, one contact sheet per width (contact-390.png, contact-1440.png, each with a clickable
 * .html twin), so a reviewer can see the whole site at a glance.
 *
 * Usage:
 *   node tools/shoot.js [--pages index.html,join.html] [--out DIR] [--widths 390,1440]
 *        [--themes light,dark] [--scale 1] [--root DIR] [--crop PX] [--timeout MS]
 *        [--concurrency N] [--no-headers] [--no-sheet] [--json] [--quiet]
 *
 *   --pages        comma list of pages relative to --root (default: every root-level *.html,
 *                  index.html first)
 *   --out          output folder (default tools/.cache/shots, which git ignores)
 *   --widths       comma list of widths or WIDTHxHEIGHT (default 390,1440, meaning 390x844 and
 *                  1440x900). Widths under 768 are emulated as a phone (touch, mobile viewport).
 *   --themes       light, dark, or light,dark (default): emulates prefers-color-scheme
 *   --scale        device pixel ratio (default 1; 2 gives retina-sharp shots with 4x the pixels)
 *   --crop         contact-sheet thumbnails show the top PX CSS pixels of each page (default: three
 *                  screens of that width); 0 shows whole pages. The PNG files are never cropped.
 *   --root         site folder to serve (default: the folder above tools/)
 *   --timeout      per-page load timeout in ms (default 30000)
 *   --concurrency  pages shot in parallel (default 3)
 *   --no-headers   do not apply _headers (no CSP)
 *   --no-sheet     skip the contact sheets
 *   --json         print the manifest as JSON instead of the summary
 *
 * Files: <out>/<page>-<width>-<theme>.png (page path with "/" as "__", ".html" dropped),
 * <out>/contact-<width>.png and contact-<width>.html, and <out>/shots.json (a manifest with every
 * shot's size, image and font status, console errors and any failure).
 * Exit codes: 0 every shot taken, 1 some shots failed, 2 bad arguments or a crash.
 * With no pages at all it writes an empty manifest, prints a note and exits 0.
 *
 * Module (for tests and tools/bench_compare.js): require('./shoot') exports { run, parseArgs,
 *   parseWidths, startServer, listPages, pngSize, fileSlug, loadPlaywright, browserUserAgent }.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUT = path.join(__dirname, '.cache', 'shots');
const DEFAULT_HEIGHTS = { 390: 844, 1440: 900 };

// ------------------------------------------------------------------------------------------
// Helpers shared with tools/bench_compare.js
// ------------------------------------------------------------------------------------------

/** "390,1440x900" -> [{width, height, mobile, label}] */
function parseWidths(spec) {
  const out = [];
  for (const raw of String(spec || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d{3,4})(?:x(\d{3,5}))?$/i.exec(raw);
    if (!m) throw new Error('bad width "' + raw + '" (use 390 or 390x844)');
    const width = +m[1];
    if (width < 200 || width > 3840) throw new Error('width ' + width + ' is out of range (200 to 3840)');
    const height = m[2] ? +m[2] : (DEFAULT_HEIGHTS[width] || (width < 768 ? 844 : 900));
    if (out.some((w) => w.width === width)) throw new Error('width ' + width + ' given twice');
    out.push({ width, height, mobile: width < 768, label: width + 'x' + height });
  }
  if (!out.length) throw new Error('--widths needs at least one width');
  return out;
}

/** Root-level *.html pages, index.html first, then alphabetical. */
function listPages(root) {
  let files = [];
  try {
    files = fs.readdirSync(root).filter((f) => /\.html?$/i.test(f) && fs.statSync(path.join(root, f)).isFile());
  } catch (e) { return []; }
  return files.sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b)));
}

/** "events/index.html" -> "events__index" (safe for file names). */
function fileSlug(page) {
  return String(page).replace(/\.html?$/i, '').replace(/[\\/]+/g, '__').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'page';
}

/** Width and height of a PNG buffer (from the IHDR chunk), or null. */
function pngSize(buf) {
  if (!buf || buf.length < 24) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(12) !== 0x49484452) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function loadPlaywright() {
  try { return require('playwright'); } catch (e) {
    throw new Error('Playwright is not installed (npm i -g playwright, then npx playwright install chromium)');
  }
}

/** A user agent without "HeadlessChrome", phone or desktop, for the running Chromium version. */
function browserUserAgent(browser, mobile) {
  const v = (browser && browser.version && browser.version()) || '131.0.0.0';
  return mobile
    ? `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Mobile Safari/537.36`
    : `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.vtt': 'text/vtt; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8'
};

/** Minimal static server, used only if tools/check_site.js cannot be loaded. */
function basicServer(root) {
  return http.createServer((req, res) => {
    let rel = '/';
    try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) {}
    let abs = path.resolve(root, '.' + rel);
    if (abs !== root && !abs.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    try { if (fs.statSync(abs).isDirectory()) abs = path.join(abs, 'index.html'); } catch (e) {}
    if (!path.extname(abs) && fs.existsSync(abs + '.html')) abs += '.html';
    fs.readFile(abs, (err, body) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(body);
    });
  });
}

/**
 * Serve root on 127.0.0.1 like production: tools/check_site.js's server (pretty URLs, Range
 * requests, 404.html) with the _headers rules applied unless opts.headers === false. opts.gzip: gzip text
 * responses like a real host (bench_compare.js uses it so byte counts compare with live sites).
 * Resolves to {base, headersEmulated, close()}.
 */
function startServer(root, opts) {
  opts = opts || {};
  root = path.resolve(root);
  let cs = null;
  try { cs = require('./check_site.js'); } catch (e) { cs = null; }
  let rules = null;
  const hf = path.join(root, '_headers');
  if (opts.headers !== false && cs && cs.parseHeadersFile && fs.existsSync(hf)) {
    try { rules = cs.parseHeadersFile(fs.readFileSync(hf, 'utf8')); } catch (e) { rules = null; }
  }
  const server = cs && cs.createServer ? cs.createServer(root, { headers: rules, gzip: !!opts.gzip }) : basicServer(root);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({
        base: 'http://127.0.0.1:' + server.address().port,
        headersEmulated: !!rules,
        server: cs && cs.createServer ? 'tools/check_site.js' : 'basic',
        close: () => new Promise((r) => {
          if (server.closeAllConnections) server.closeAllConnections();
          server.close(() => r());
        })
      });
    });
  });
}

const firstLine = (e) => String((e && e.message) || e).split('\n')[0].slice(0, 300);
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ------------------------------------------------------------------------------------------
// Arguments
// ------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const o = {
    root: ROOT, pages: [], out: DEFAULT_OUT, widths: parseWidths('390,1440'), themes: ['light', 'dark'],
    scale: 1, crop: null, timeout: 30000, concurrency: 3, headers: true, sheet: true, json: false, quiet: false, help: false
  };
  const args = [];
  for (const a of argv) {
    const m = /^(--[a-z-]+)=(.*)$/.exec(a);
    if (m) args.push(m[1], m[2]); else args.push(a);
  }
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const val = () => { if (i + 1 >= args.length) throw new Error(a + ' needs a value'); return args[++i]; };
    if (a === '--root') o.root = path.resolve(val());
    else if (a === '--pages') o.pages = val().split(',').map((s) => s.trim().replace(/^\/+/, '')).filter(Boolean);
    else if (a === '--out') o.out = path.resolve(val());
    else if (a === '--widths' || a === '--width') o.widths = parseWidths(val());
    else if (a === '--themes' || a === '--theme') {
      const v = val().toLowerCase();
      o.themes = v === 'both' || v === 'all' ? ['light', 'dark'] : v.split(',').map((s) => s.trim()).filter(Boolean);
      for (const t of o.themes) if (t !== 'light' && t !== 'dark') throw new Error('bad theme "' + t + '" (use light, dark or light,dark)');
      o.themes = Array.from(new Set(o.themes));
      if (!o.themes.length) throw new Error('--themes needs light, dark or both');
    } else if (a === '--scale') {
      o.scale = parseFloat(val());
      if (!(o.scale > 0 && o.scale <= 4)) throw new Error('--scale must be between 0 and 4');
    } else if (a === '--crop') {
      o.crop = parseInt(val(), 10);
      if (!(o.crop >= 0)) throw new Error('--crop must be 0 or more');
    } else if (a === '--timeout') o.timeout = Math.max(1000, parseInt(val(), 10) || 30000);
    else if (a === '--concurrency') o.concurrency = Math.max(1, Math.min(8, parseInt(val(), 10) || 3));
    else if (a === '--no-headers') o.headers = false;
    else if (a === '--no-sheet') o.sheet = false;
    else if (a === '--json') o.json = true;
    else if (a === '--quiet') o.quiet = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error('unknown argument ' + a);
  }
  return o;
}

// ------------------------------------------------------------------------------------------
// Shooting
// ------------------------------------------------------------------------------------------

/** Scroll through the page (lazy images, reveal-on-scroll), then wait for images, fonts, network. */
async function settle(page) {
  await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
    let y = 0;
    for (let i = 0; i < 80; i++) {
      const max = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0) - window.innerHeight;
      if (y >= max) break;
      y = Math.min(y + step, max);
      window.scrollTo({ top: y, left: 0, behavior: 'instant' });
      await sleep(70);
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    await sleep(60);
  }).catch(() => {});
  const images = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const imgs = Array.from(document.images);
    const waitOne = (img) => (img.complete ? Promise.resolve() : new Promise((r) => {
      img.addEventListener('load', r, { once: true });
      img.addEventListener('error', r, { once: true });
    })).then(() => (img.decode ? img.decode().catch(() => {}) : null));
    await Promise.race([Promise.all(imgs.map(waitOne)), sleep(10000)]);
    const withSrc = imgs.filter((i) => i.currentSrc || i.getAttribute('src'));
    return {
      total: imgs.length,
      loaded: withSrc.filter((i) => i.complete && i.naturalWidth > 0).length,
      broken: withSrc.filter((i) => i.complete && i.naturalWidth === 0).length,
      pending: withSrc.filter((i) => !i.complete).length
    };
  }).catch(() => null);
  const fonts = await page.evaluate(async () => {
    if (!document.fonts) return 'unsupported';
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 8000))]);
    return document.fonts.status;
  }).catch(() => 'unknown');
  await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(150);
  return { images, fonts };
}

async function shootOne(browser, job, opts) {
  const { name, url, vp, theme, file } = job;
  const rec = { page: name, width: vp.width, height: vp.height, theme, file: path.basename(file), ok: false, status: 0 };
  if (job.missing) { rec.error = 'file not found: ' + name; return rec; }
  const started = Date.now();
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: opts.scale,
    isMobile: vp.mobile, hasTouch: vp.mobile, colorScheme: theme, serviceWorkers: 'block'
  });
  const errors = [];
  try {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('page error: ' + firstLine(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
    const resp = await page.goto(url, { waitUntil: 'load', timeout: opts.timeout });
    rec.status = resp ? resp.status() : 0;
    Object.assign(rec, await settle(page));
    await page.screenshot({ path: file, fullPage: true, animations: 'disabled', timeout: opts.timeout });
    const size = pngSize(fs.readFileSync(file));
    if (size) { rec.pngWidth = size.width; rec.pngHeight = size.height; }
    rec.ok = !!size && rec.status > 0 && rec.status < 400;
    if (!rec.ok) rec.error = size ? 'HTTP ' + rec.status : 'screenshot was not a PNG';
  } catch (e) {
    rec.error = firstLine(e);
  } finally {
    await ctx.close().catch(() => {});
  }
  rec.consoleErrors = errors.length;
  if (errors.length) rec.errors = errors.slice(0, 5);
  rec.ms = Date.now() - started;
  return rec;
}

// ------------------------------------------------------------------------------------------
// Contact sheets
// ------------------------------------------------------------------------------------------

function amPm(d) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const h = d.getHours() % 12 || 12;
  return `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}, ${h}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'am' : 'pm'}`;
}

/** Contact-sheet HTML for one width. Thumbnails reference the PNGs next to it (same folder). */
function sheetHtml(o) {
  const thumbW = o.vp.mobile ? 220 : 440;
  const ratio = thumbW / o.vp.width;
  const crop = o.crop == null ? o.vp.height * 3 : o.crop;
  const cardW = o.themes.length * thumbW + (o.themes.length - 1) * 12 + 24;
  const cols = Math.max(1, Math.min(o.pages.length || 1, Math.floor(1960 / (cardW + 20)) || 1));
  const sheetW = cols * cardW + (cols - 1) * 20 + 48;
  const cards = o.pages.map((p) => {
    const figs = o.themes.map((t) => {
      const r = p.shots[t];
      if (!r || !r.ok || !r.pngHeight) {
        const why = r ? (r.error || 'failed') : 'not taken';
        return `<figure><figcaption>${t}</figcaption><div class="thumb failed" style="width:${thumbW}px;height:${Math.round(o.vp.height * ratio)}px">${escapeHtml(why)}</div></figure>`;
      }
      const cssH = r.pngHeight / (r.pngWidth / o.vp.width);                 // page height in CSS px
      const shown = crop > 0 ? Math.min(cssH, crop) : cssH;
      const cut = shown < cssH;
      const note = (cut ? `top ${Math.round(shown)} of ${Math.round(cssH)} px` : `${Math.round(cssH)} px tall`) +
        (r.consoleErrors ? ` · <b>${r.consoleErrors} console error${r.consoleErrors === 1 ? '' : 's'}</b>` : '');
      return `<figure><figcaption>${t}</figcaption><a href="${encodeURI(r.file)}"><div class="thumb${cut ? ' cut' : ''}" style="width:${thumbW}px;height:${Math.round(shown * ratio)}px"><img src="${encodeURI(r.file)}" width="${thumbW}" alt="${escapeHtml(p.name + ', ' + t)}"></div></a><small>${note}</small></figure>`;
    }).join('');
    return `<section class="card"><h2>${escapeHtml(p.name)}</h2><div class="row">${figs}</div></section>`;
  }).join('\n');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(o.title)}</title>
<meta name="viewport" content="width=${sheetW}">
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 24px; width: ${sheetW - 48}px; background: #ececef; color: #18181b; font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  header { margin: 0 0 20px; }
  header h1 { font-size: 22px; margin: 0 0 4px; }
  header p { margin: 0; color: #52525b; }
  .grid { display: flex; flex-wrap: wrap; gap: 20px; align-items: flex-start; }
  .card { width: ${cardW - 24}px; background: #fff; border-radius: 12px; padding: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.12); }
  .card h2 { font-size: 15px; margin: 0 0 8px; word-break: break-all; }
  .row { display: flex; gap: 12px; }
  figure { margin: 0; }
  figcaption { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: #52525b; margin-bottom: 4px; }
  .thumb { overflow: hidden; border: 1px solid #d4d4d8; border-radius: 6px; background: #fafafa; position: relative; }
  .thumb img { display: block; width: 100%; height: auto; }
  .thumb.cut::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 28px; background: linear-gradient(rgba(255,255,255,0), rgba(255,255,255,.95)); }
  .thumb.failed { display: flex; align-items: center; justify-content: center; text-align: center; padding: 12px; box-sizing: border-box; color: #b91c1c; font-weight: 600; background: #fef2f2; border-color: #fca5a5; }
  small { display: block; margin-top: 4px; color: #71717a; font-size: 11px; }
  small b { color: #b91c1c; }
  a { color: inherit; }
</style></head>
<body>
<header><h1>${escapeHtml(o.title)}</h1><p>${escapeHtml(o.subtitle)}</p></header>
<div class="grid">
${cards || '<p>No pages.</p>'}
</div>
</body></html>
`;
  return { html, sheetW };
}

async function renderSheet(browser, htmlFile, pngFile, sheetW) {
  const ctx = await browser.newContext({ viewport: { width: sheetW, height: 800 }, deviceScaleFactor: 1, colorScheme: 'light' });
  try {
    const page = await ctx.newPage();
    await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'load', timeout: 60000 });
    await page.evaluate(() => Promise.all(Array.from(document.images).map((i) => (i.decode ? i.decode().catch(() => {}) : null))));
    await page.screenshot({ path: pngFile, fullPage: true, timeout: 60000 });
  } finally {
    await ctx.close().catch(() => {});
  }
  return pngSize(fs.readFileSync(pngFile));
}

// ------------------------------------------------------------------------------------------
// Runner
// ------------------------------------------------------------------------------------------

async function run(opts) {
  const started = Date.now();
  const manifest = {
    tool: 'tools/shoot.js', generatedAt: new Date().toISOString(), root: opts.root, out: opts.out, target: '',
    widths: opts.widths.map((w) => ({ width: w.width, height: w.height, mobile: w.mobile })),
    themes: opts.themes, scale: opts.scale, headersEmulated: false, pages: [], shots: [], sheets: [], notes: [],
    summary: { pages: 0, shots: 0, ok: 0, failed: 0, seconds: 0 }
  };
  const pages = opts.pages.length ? opts.pages : listPages(opts.root);
  manifest.pages = pages;
  fs.mkdirSync(opts.out, { recursive: true });
  const finish = () => {
    manifest.summary.pages = pages.length;
    manifest.summary.shots = manifest.shots.length;
    manifest.summary.ok = manifest.shots.filter((s) => s.ok).length;
    manifest.summary.failed = manifest.summary.shots - manifest.summary.ok;
    manifest.summary.seconds = Math.round((Date.now() - started) / 100) / 10;
    fs.writeFileSync(path.join(opts.out, 'shots.json'), JSON.stringify(manifest, null, 2) + '\n');
    return manifest;
  };
  if (!pages.length) {
    manifest.notes.push('no root-level *.html pages in ' + opts.root + '; nothing to shoot');
    return finish();
  }

  const { chromium } = loadPlaywright();
  const srv = await startServer(opts.root, { headers: opts.headers });
  manifest.target = srv.base + ' (local server for ' + opts.root + ')';
  manifest.headersEmulated = srv.headersEmulated;
  if (opts.headers && !srv.headersEmulated) manifest.notes.push('no _headers file applied: production headers (CSP) not emulated');
  const browser = await chromium.launch();
  try {
    const jobs = [];
    for (const name of pages) {
      const missing = !fs.existsSync(path.join(opts.root, name));
      const url = srv.base + '/' + name.split('/').map(encodeURIComponent).join('/');
      for (const vp of opts.widths) {
        for (const theme of opts.themes) {
          jobs.push({ name, url, vp, theme, missing, file: path.join(opts.out, `${fileSlug(name)}-${vp.width}-${theme}.png`) });
        }
      }
    }
    const results = new Array(jobs.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(opts.concurrency, jobs.length) }, async () => {
      while (next < jobs.length) {
        const i = next++;
        results[i] = await shootOne(browser, jobs[i], opts);
        if (!opts.quiet && !opts.json) {
          const r = results[i];
          process.stderr.write(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.page} ${r.width} ${r.theme}${r.ok ? '' : ': ' + r.error}\n`);
        }
      }
    }));
    manifest.shots = results;

    if (opts.sheet) {
      const when = amPm(new Date());
      for (const vp of opts.widths) {
        const byPage = pages.map((name) => {
          const shots = {};
          for (const r of results) if (r.page === name && r.width === vp.width) shots[r.theme] = r;
          return { name, shots };
        });
        const title = `Contact sheet: ${vp.width} x ${vp.height}`;
        const subtitle = `${pages.length} page${pages.length === 1 ? '' : 's'} from ${path.basename(opts.root)}, ` +
          `${opts.themes.join(' and ')}, scale ${opts.scale}, ${when}. Click a thumbnail for the full-page PNG.`;
        const { html, sheetW } = sheetHtml({ title, subtitle, vp, themes: opts.themes, pages: byPage, crop: opts.crop });
        const htmlFile = path.join(opts.out, `contact-${vp.width}.html`);
        const pngFile = path.join(opts.out, `contact-${vp.width}.png`);
        fs.writeFileSync(htmlFile, html);
        try {
          const size = await renderSheet(browser, htmlFile, pngFile, sheetW);
          manifest.sheets.push({ width: vp.width, png: path.basename(pngFile), html: path.basename(htmlFile), pngWidth: size && size.width, pngHeight: size && size.height });
        } catch (e) {
          manifest.sheets.push({ width: vp.width, html: path.basename(htmlFile), error: firstLine(e) });
          manifest.notes.push('contact sheet ' + vp.width + ' failed: ' + firstLine(e));
        }
      }
    }
  } finally {
    await browser.close().catch(() => {});
    await srv.close();
  }
  return finish();
}

function summary(m, opts) {
  const lines = [];
  const rel = (p) => { const r = path.relative(process.cwd(), p); return r && !r.startsWith('..') ? r : p; };
  const s = m.summary;
  if (s.pages) {
    lines.push(`shoot: ${s.ok} of ${s.shots} shots (${s.pages} page${s.pages === 1 ? '' : 's'} x ${m.widths.map((w) => w.width + 'x' + w.height).join(', ')} x ${m.themes.join('/')}, scale ${m.scale}) in ${s.seconds}s; _headers ${m.headersEmulated ? 'applied' : 'not applied'}`);
    for (const r of m.shots.filter((x) => !x.ok)) lines.push(`  FAILED ${r.page} ${r.width} ${r.theme}: ${r.error}`);
    for (const sh of m.sheets) if (sh.png && !sh.error) lines.push(`  contact sheet ${sh.width}: ${rel(path.join(m.out, sh.png))} (${sh.pngWidth}x${sh.pngHeight})`);
  }
  for (const n of m.notes) lines.push('note: ' + n);
  lines.push('Output: ' + rel(m.out) + path.sep + ' (manifest: shots.json)');
  return lines.join('\n');
}

async function main(argv) {
  let opts;
  try { opts = parseArgs(argv); } catch (e) { process.stderr.write('shoot: ' + e.message + '\n'); return 2; }
  if (opts.help) {
    process.stdout.write(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#!.*\n/, '') + '*/\n');
    return 0;
  }
  let m;
  try { m = await run(opts); } catch (e) {
    process.stderr.write('shoot: crashed: ' + (e && e.stack ? e.stack : e) + '\n');
    return 2;
  }
  process.stdout.write((opts.json ? JSON.stringify(m, null, 2) : summary(m, opts)) + '\n');
  return m.summary.failed > 0 ? 1 : 0;
}

module.exports = { run, parseArgs, parseWidths, startServer, listPages, pngSize, fileSlug, loadPlaywright, browserUserAgent, sheetHtml };

if (require.main === module) main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
