#!/usr/bin/env node
/**
 * tools/check_site.js: headless quality check for every root-level *.html page.
 *
 * Serves the site from a built-in static server on 127.0.0.1 (pretty URLs, Range requests, and
 * the response headers from _headers, so the production Content-Security-Policy is enforced),
 * opens each page at 390x844 (mobile, touch) and 1440x900 (desktop) in Playwright Chromium, and
 * reports:
 *   errors:   console errors, uncaught page errors, failed same-origin requests (status >= 400 or
 *             network failure), horizontal overflow (document scrollWidth wider than the viewport),
 *             <img> without alt, missing <title>, missing <html lang>, missing meta viewport,
 *             broken internal links and #anchors, duplicate ids, links/buttons without an
 *             accessible name, invalid manifest, axe-core violations with impact serious/critical
 *   warnings: missing meta description / canonical / og:title / og:image / og:description /
 *             twitter:card, heading level jumps, tap targets under 24x24 CSS px (WCAG 2.2
 *             SC 2.5.8 with its inline and spacing exceptions), placeholder href="#",
 *             script order (config.js, then store.js), missing manifest icons, missing favicon,
 *             failed cross-origin loads, axe-core moderate/minor violations
 * --strict turns every warning into an error and also fails pages that are noindex (the demo's
 * X-Robots-Tag), for the launch check.
 *
 * axe-core is used when it can be loaded: from node_modules (require.resolve('axe-core')), from
 * the cache tools/.cache/, or downloaded once from cdnjs; otherwise axe is skipped with a note.
 *
 * Usage:
 *   node tools/check_site.js [--root DIR] [--pages a.html,b.html] [--out FILE] [--strict]
 *        [--no-axe] [--axe-file FILE] [--no-headers] [--sw] [--base URL] [--json] [--quiet]
 *        [--viewports 390x844,1440x900] [--timeout MS]
 * Writes tools/check_report.json (or --out). Exit codes: 0 no errors, 1 errors found, 2 crashed.
 * With no root-level pages yet it prints a note, writes an empty report and exits 0.
 *
 * Module (for tests): require('./check_site') exports { run, parseHeadersFile, headersFor,
 *   createServer, parseArgs, rootPages }.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const AXE_VERSION = '4.10.2';
const AXE_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/' + AXE_VERSION + '/axe.min.js';
const CACHE_DIR = path.join(__dirname, '.cache');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg',
  '.vtt': 'text/vtt; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.ics': 'text/calendar; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.pdf': 'application/pdf'
};

// ------------------------------------------------------------------------------------------
// _headers emulation (Netlify / Cloudflare Pages syntax)
// ------------------------------------------------------------------------------------------

function patternToRegExp(pattern) {
  if (/^https?:\/\//i.test(pattern)) return null;          // host-specific rules: not emulated
  let src = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*') src += '.*';
    else if (ch === ':' && /[A-Za-z_]/.test(pattern[i + 1] || '') && (i === 0 || pattern[i - 1] === '/')) {
      let j = i + 1;
      while (j < pattern.length && /[A-Za-z0-9_]/.test(pattern[j])) j++;
      src += '[^/]+';
      i = j - 1;
    } else src += ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + src + '$');
}

/** Parse a _headers file into [{pattern, re, set: [[name, value]], detach: [name]}]. */
function parseHeadersFile(text) {
  const rules = [];
  let cur = null;
  String(text || '').split(/\r?\n/).forEach((line) => {
    if (!line.trim() || /^\s*#/.test(line)) return;
    if (!/^\s/.test(line)) {
      cur = { pattern: line.trim(), re: patternToRegExp(line.trim()), set: [], detach: [] };
      rules.push(cur);
      return;
    }
    if (!cur) return;
    const t = line.trim();
    if (t.startsWith('!')) { cur.detach.push(t.slice(1).trim().toLowerCase()); return; }
    const idx = t.indexOf(':');
    if (idx > 0) cur.set.push([t.slice(0, idx).trim(), t.slice(idx + 1).trim()]);
  });
  return rules;
}

/** Headers for a request path: all matching rules, repeated names joined with ", ". */
function headersFor(rules, pathname) {
  const out = {};
  for (const r of rules || []) {
    if (!r.re || !r.re.test(pathname)) continue;
    for (const d of r.detach) delete out[d];
    for (const [name, value] of r.set) {
      const k = name.toLowerCase();
      out[k] = out[k] ? out[k] + ', ' + value : value;
    }
  }
  return out;
}

/** Local-server adjustments: plain http on 127.0.0.1 must not upgrade or pin to https. */
function localizeHeaders(h) {
  const out = Object.assign({}, h);
  delete out['strict-transport-security'];
  for (const k of ['content-security-policy', 'content-security-policy-report-only']) {
    if (!out[k]) continue;
    out[k] = out[k].split(';').map((s) => s.trim())
      .filter((s) => s && !/^(upgrade-insecure-requests|block-all-mixed-content)$/i.test(s)).join('; ');
  }
  return out;
}

// ------------------------------------------------------------------------------------------
// Static server
// ------------------------------------------------------------------------------------------

function resolveFile(root, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch (e) { return null; }
  if (rel.indexOf('\0') >= 0) return null;
  const abs = path.resolve(root, '.' + rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } };
  const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } };
  if (rel.endsWith('/')) return isFile(path.join(abs, 'index.html')) ? path.join(abs, 'index.html') : null;
  if (isFile(abs)) return abs;
  if (!path.extname(abs) && isFile(abs + '.html')) return abs + '.html';
  if (isDir(abs) && isFile(path.join(abs, 'index.html'))) return path.join(abs, 'index.html');
  return null;
}

/** Static file server for root. opts.headers: parsed _headers rules (or null). */
function createServer(root, opts) {
  root = path.resolve(root);
  opts = opts || {};
  return http.createServer((req, res) => {
    let pathname = '/';
    try { pathname = new URL(req.url, 'http://x').pathname; } catch (e) {}
    const extra = opts.headers ? localizeHeaders(headersFor(opts.headers, pathname)) : {};
    const file = resolveFile(root, pathname);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      return res.end('method not allowed');
    }
    if (!file) {
      const nf = path.join(root, '404.html');
      const body = fs.existsSync(nf) ? fs.readFileSync(nf) : Buffer.from('Not found');
      res.writeHead(404, Object.assign({ 'Content-Type': fs.existsSync(nf) ? MIME['.html'] : 'text/plain' }, extra));
      return res.end(req.method === 'HEAD' ? undefined : body);
    }
    const stat = fs.statSync(file);
    const headers = Object.assign({
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache'
    }, extra);
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && (range[1] || range[2])) {
      let start = range[1] ? parseInt(range[1], 10) : stat.size - parseInt(range[2], 10);
      let end = range[1] && range[2] ? parseInt(range[2], 10) : stat.size - 1;
      if (start < 0) start = 0;
      if (end >= stat.size) end = stat.size - 1;
      if (start > end || start >= stat.size) {
        res.writeHead(416, { 'Content-Range': 'bytes */' + stat.size });
        return res.end();
      }
      res.writeHead(206, Object.assign(headers, { 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 }));
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, Object.assign(headers, { 'Content-Length': stat.size }));
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

// ------------------------------------------------------------------------------------------
// Arguments
// ------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const o = {
    root: ROOT, pages: [], out: path.join(__dirname, 'check_report.json'), axe: true, axeFile: '',
    strict: false, json: false, base: '', headers: true, sw: false, quiet: false, timeout: 20000,
    viewports: [{ name: 'mobile', width: 390, height: 844, mobile: true }, { name: 'desktop', width: 1440, height: 900, mobile: false }]
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) throw new Error(a + ' needs a value'); return argv[++i]; };
    if (a === '--root') o.root = path.resolve(val());
    else if (a === '--pages') o.pages = val().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--out') o.out = path.resolve(val());
    else if (a === '--no-axe') o.axe = false;
    else if (a === '--axe-file') o.axeFile = path.resolve(val());
    else if (a === '--strict') o.strict = true;
    else if (a === '--json') o.json = true;
    else if (a === '--base') o.base = val().replace(/\/+$/, '');
    else if (a === '--no-headers') o.headers = false;
    else if (a === '--sw') o.sw = true;
    else if (a === '--quiet') o.quiet = true;
    else if (a === '--timeout') o.timeout = parseInt(val(), 10) || 20000;
    else if (a === '--viewports') {
      o.viewports = val().split(',').map((s) => {
        const m = /^(\d+)x(\d+)$/.exec(s.trim());
        if (!m) throw new Error('bad viewport ' + s + ' (use 390x844)');
        const w = +m[1];
        return { name: w < 768 ? 'mobile-' + w : 'desktop-' + w, width: w, height: +m[2], mobile: w < 768 };
      });
    } else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error('unknown argument ' + a);
  }
  return o;
}

function rootPages(root) {
  try {
    return fs.readdirSync(root).filter((f) => /\.html?$/i.test(f) && fs.statSync(path.join(root, f)).isFile()).sort();
  } catch (e) { return []; }
}

// ------------------------------------------------------------------------------------------
// axe-core
// ------------------------------------------------------------------------------------------

async function loadAxe(opts, browser) {
  if (!opts.axe) return { status: 'skipped', note: 'disabled with --no-axe' };
  if (opts.axeFile) {
    try { return { status: 'ready', source: opts.axeFile, code: fs.readFileSync(opts.axeFile, 'utf8') }; } catch (e) {
      return { status: 'skipped', note: 'could not read --axe-file ' + opts.axeFile };
    }
  }
  const paths = [opts.root, ROOT, process.cwd()].concat((process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean));
  try {
    const p = require.resolve('axe-core/axe.min.js', { paths });
    let version = '';
    try { version = JSON.parse(fs.readFileSync(path.join(path.dirname(p), 'package.json'), 'utf8')).version; } catch (e) {}
    return { status: 'ready', source: 'node_modules (' + p + ')', version, code: fs.readFileSync(p, 'utf8') };
  } catch (e) { /* not installed */ }
  const cached = path.join(CACHE_DIR, 'axe-core-' + AXE_VERSION + '.min.js');
  if (fs.existsSync(cached)) return { status: 'ready', source: 'cache (' + path.relative(process.cwd(), cached) + ')', version: AXE_VERSION, code: fs.readFileSync(cached, 'utf8') };
  let ctx;
  try {
    ctx = await browser.newContext();
    const page = await ctx.newPage();
    const res = await page.goto(AXE_CDN, { timeout: 15000 });
    const code = res && res.ok() ? await res.text() : '';
    if (code.length > 100000 && code.indexOf('axe') >= 0) {
      try { fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(cached, code); } catch (e) {}
      return { status: 'ready', source: 'cdnjs (' + AXE_CDN + ')', version: AXE_VERSION, code };
    }
    return { status: 'skipped', note: 'axe-core not in node_modules and cdnjs answered ' + (res ? res.status() : 'nothing') };
  } catch (e) {
    return { status: 'skipped', note: 'axe-core not in node_modules and cdnjs unreachable (' + String(e.message).split('\n')[0] + ')' };
  } finally {
    if (ctx) await ctx.close().catch(() => {});
  }
}

// ------------------------------------------------------------------------------------------
// In-page inspection (runs inside the browser; must be self-contained)
// ------------------------------------------------------------------------------------------

function inspectPage(vpWidth) {
  const doc = document;
  const out = {};
  function sel(el) {
    if (!el || el.nodeType !== 1) return '';
    const parts = [];
    let cur = el;
    for (let depth = 0; cur && cur.nodeType === 1 && depth < 4; depth++) {
      let s = cur.tagName.toLowerCase();
      if (cur.id) { parts.unshift(s + '#' + cur.id); break; }
      const cls = (cur.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
      if (cls.length) s += '.' + cls.join('.');
      const parent = cur.parentElement;
      if (parent) {
        const same = Array.prototype.filter.call(parent.children, (c) => c.tagName === cur.tagName);
        if (same.length > 1) s += ':nth-of-type(' + (same.indexOf(cur) + 1) + ')';
      }
      parts.unshift(s);
      cur = parent;
    }
    return parts.join(' > ');
  }
  function visible(el) {
    if (!el.getClientRects().length) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
    return !el.closest('[aria-hidden="true"]');
  }
  function visuallyHidden(el, r) {
    const cs = getComputedStyle(el);
    if (r.width <= 1 && r.height <= 1) return true;
    if (cs.clip && cs.clip !== 'auto' && /rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)/.test(cs.clip)) return true;
    if (cs.clipPath && /inset\(50%\)/.test(cs.clipPath)) return true;
    return false;
  }
  function textOf(node) {
    if (node.nodeType === 3) return node.nodeValue;
    if (node.nodeType !== 1) return '';
    const el = node;
    if (el.getAttribute('aria-hidden') === 'true') return '';
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return '';
    const al = el.getAttribute('aria-label');
    if (al && al.trim()) return ' ' + al + ' ';
    const tag = el.tagName.toLowerCase();
    if (tag === 'img' || (tag === 'input' && el.type === 'image') || tag === 'area') return ' ' + (el.getAttribute('alt') || '') + ' ';
    if (tag === 'svg') {
      const t = el.querySelector('title');
      return t ? ' ' + t.textContent + ' ' : '';
    }
    let s = '';
    const before = getComputedStyle(el, '::before').content;
    if (before && /^["'].+["']$/.test(before)) s += before.slice(1, -1);
    for (const c of el.childNodes) s += textOf(c);
    const after = getComputedStyle(el, '::after').content;
    if (after && /^["'].+["']$/.test(after)) s += after.slice(1, -1);
    return s;
  }
  function accName(el) {
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const t = lb.split(/\s+/).map((id) => doc.getElementById(id)).filter(Boolean).map((n) => n.textContent).join(' ').trim();
      if (t) return t;
    }
    const al = el.getAttribute('aria-label');
    if (al && al.trim()) return al.trim();
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') {
      if (el.type === 'submit') return el.value || 'Submit';
      if (el.type === 'reset') return el.value || 'Reset';
      if (el.type === 'button') return el.value || '';
      if (el.type === 'image') return el.getAttribute('alt') || el.value || '';
    }
    const t = textOf(el).replace(/\s+/g, ' ').trim();
    if (t) return t;
    if (el.labels && el.labels.length) {
      const l = Array.prototype.map.call(el.labels, (x) => x.textContent).join(' ').trim();
      if (l) return l;
    }
    const title = el.getAttribute('title');
    return title && title.trim() ? title.trim() : '';
  }
  const meta = (q) => { const m = doc.querySelector(q); return m ? (m.getAttribute('content') || '').trim() : null; };
  out.title = (doc.title || '').trim();
  out.lang = (doc.documentElement.getAttribute('lang') || '').trim();
  out.viewport = meta('meta[name="viewport"]');
  out.description = meta('meta[name="description"]');
  out.ogTitle = meta('meta[property="og:title"]');
  out.ogImage = meta('meta[property="og:image"]');
  out.ogDescription = meta('meta[property="og:description"]');
  out.twitterCard = meta('meta[name="twitter:card"]');
  out.robots = meta('meta[name="robots"]');
  const canon = doc.querySelector('link[rel~="canonical"]');
  out.canonical = canon ? (canon.getAttribute('href') || '').trim() : null;
  const man = doc.querySelector('link[rel~="manifest"]');
  out.manifest = man ? man.href : null;

  // Horizontal overflow
  const sw = Math.max(doc.documentElement.scrollWidth, doc.body ? doc.body.scrollWidth : 0);
  out.scrollWidth = sw;
  out.innerWidth = window.innerWidth;
  out.overflowers = [];
  if (sw > vpWidth + 1 || sw > window.innerWidth + 1) {
    const limit = Math.min(vpWidth, window.innerWidth) + 1;
    const all = doc.body ? doc.body.querySelectorAll('*') : [];
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (r.right <= limit || r.width === 0) continue;
      const pos = getComputedStyle(el).position;
      if (pos === 'fixed') continue;
      const p = el.parentElement;
      const pr = p ? p.getBoundingClientRect() : null;
      if (p && p !== doc.body && pr && pr.right > limit) continue;
      out.overflowers.push({ sel: sel(el), right: Math.round(r.right), width: Math.round(r.width) });
      if (out.overflowers.length >= 200) break;
    }
    out.overflowers.sort((a, b) => b.right - a.right);
    out.overflowers = out.overflowers.slice(0, 5);
  }

  // Images without alt
  out.imgsNoAlt = Array.prototype.map.call(doc.querySelectorAll('img:not([alt])'), (el) => ({ sel: sel(el), src: (el.getAttribute('src') || '').slice(0, 120) }));

  // Ids
  const counts = {};
  doc.querySelectorAll('[id]').forEach((el) => { counts[el.id] = (counts[el.id] || 0) + 1; });
  out.dupIds = Object.keys(counts).filter((k) => counts[k] > 1).map((k) => ({ id: k, count: counts[k] }));
  out.ids = Object.keys(counts).concat(Array.prototype.map.call(doc.querySelectorAll('a[name]'), (a) => a.getAttribute('name')));

  // Headings
  out.headings = [];
  doc.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]').forEach((el) => {
    if (getComputedStyle(el).display === 'none') return;
    const lvl = /^h[1-6]$/i.test(el.tagName) ? +el.tagName[1] : (+el.getAttribute('aria-level') || 2);
    out.headings.push({ level: lvl, text: (el.textContent || '').trim().slice(0, 60), sel: sel(el) });
  });

  // Accessible names
  out.unnamed = [];
  const named = 'a[href],area[href],button,[role="button"],[role="link"],input[type="button"],input[type="submit"],input[type="reset"],input[type="image"],summary';
  doc.querySelectorAll(named).forEach((el) => {
    if (el.tagName.toLowerCase() !== 'area' && !visible(el)) return;
    if (!accName(el)) out.unnamed.push({ sel: sel(el), html: el.outerHTML.slice(0, 140) });
  });

  // Tap targets (WCAG 2.2 SC 2.5.8, minimum 24x24 CSS px, with inline and spacing exceptions)
  const tq = 'a[href],button,input:not([type="hidden"]),select,textarea,summary,[role="button"],[role="link"],[role="checkbox"],[role="switch"],[role="tab"],[role="menuitem"],[role="radio"],[tabindex]:not([tabindex="-1"])';
  const targets = [];
  doc.querySelectorAll(tq).forEach((el) => {
    if (!visible(el) || el.disabled) return;
    const r = el.getBoundingClientRect();
    if (visuallyHidden(el, r)) return;
    targets.push({ el, r });
  });
  out.smallTargets = [];
  const small = targets.filter((t) => t.r.width < 24 || t.r.height < 24);
  for (const t of small) {
    const el = t.el;
    const cs = getComputedStyle(el);
    if (el.tagName === 'A' && cs.display === 'inline' && el.parentElement) {
      const parentText = (el.parentElement.textContent || '').replace(el.textContent || '', '').trim();
      if (parentText.length > 0) continue;                       // inline exception
    }
    if (el.labels && Array.prototype.some.call(el.labels, (l) => { const lr = l.getBoundingClientRect(); return lr.width >= 24 && lr.height >= 24; })) continue;
    const cx = t.r.left + t.r.width / 2, cy = t.r.top + t.r.height / 2;
    let clash = false;
    for (const o of targets) {
      if (o === t || o.el.contains(el) || el.contains(o.el)) continue;
      const dx = Math.max(o.r.left - cx, 0, cx - o.r.right), dy = Math.max(o.r.top - cy, 0, cy - o.r.bottom);
      if (Math.sqrt(dx * dx + dy * dy) < 12) { clash = true; break; }
      if (small.indexOf(o) >= 0) {
        const ox = o.r.left + o.r.width / 2, oy = o.r.top + o.r.height / 2;
        if (Math.hypot(ox - cx, oy - cy) < 24) { clash = true; break; }
      }
    }
    if (!clash) continue;                                         // spacing exception
    out.smallTargets.push({ sel: sel(el), w: Math.round(t.r.width), h: Math.round(t.r.height), name: accName(el).slice(0, 40) });
    if (out.smallTargets.length >= 20) break;
  }

  // Links
  out.links = [];
  doc.querySelectorAll('a[href],area[href]').forEach((el) => {
    out.links.push({ raw: el.getAttribute('href'), abs: el.href, sel: sel(el) });
  });

  // Scripts
  out.scripts = Array.prototype.map.call(doc.querySelectorAll('script[src]'), (s) => s.getAttribute('src'));
  return out;
}

// ------------------------------------------------------------------------------------------
// Runner
// ------------------------------------------------------------------------------------------

function issueSink() {
  const map = new Map();
  return {
    add(severity, check, message, viewport, detail) {
      const key = severity + '|' + check + '|' + message;
      const cur = map.get(key);
      if (cur) {
        if (viewport && cur.viewports.indexOf(viewport) < 0) cur.viewports.push(viewport);
        return;
      }
      map.set(key, { severity, check, message, viewports: viewport ? [viewport] : [], detail: detail || null });
    },
    list() { return Array.from(map.values()); }
  };
}

async function headStatus(url, cache, request) {
  const key = url.split('#')[0];
  if (cache.has(key)) return cache.get(key);
  let status = 0, body = '';
  try {
    if (request) {
      const r = await request.get(key, { timeout: 10000 });
      status = r.status();
      if ((r.headers()['content-type'] || '').indexOf('text/html') >= 0) body = await r.text();
    } else {
      const r = await new Promise((resolve, reject) => {
        http.get(key, (res) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (c) => { if (data.length < 2e6) data += c; });
          res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', data }));
        }).on('error', reject);
      });
      status = r.status;
      if (r.type.indexOf('text/html') >= 0) body = r.data;
    }
  } catch (e) { status = 0; }
  const ids = new Set();
  if (body) {
    const re = /\s(?:id|name)\s*=\s*["']([^"']+)["']/gi;
    let m;
    while ((m = re.exec(body))) ids.add(m[1]);
  }
  const res = { status, ids };
  cache.set(key, res);
  return res;
}

function sameOrigin(u, origin) {
  try { return new URL(u).origin === origin; } catch (e) { return false; }
}

async function checkOne(browser, pageName, url, vp, opts, axe, state) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: !!vp.mobile, hasTouch: !!vp.mobile, deviceScaleFactor: vp.mobile ? 2 : 1,
    serviceWorkers: opts.sw ? 'allow' : 'block'
  });
  const page = await ctx.newPage();
  const origin = new URL(url).origin;
  const consoleErrors = [], pageErrors = [], failed = [], external = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const loc = m.location() || {};
    consoleErrors.push({ text: m.text(), url: loc.url || '' });
  });
  page.on('pageerror', (e) => pageErrors.push(String((e && e.message) || e)));
  page.on('requestfailed', (r) => {
    const f = r.failure();
    const err = f ? f.errorText : 'failed';
    if (/ERR_ABORTED/.test(err)) return;
    if (sameOrigin(r.url(), origin)) failed.push({ url: r.url(), why: err });
    else external.push({ url: r.url(), why: err });
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && sameOrigin(r.url(), origin)) failed.push({ url: r.url(), why: 'HTTP ' + r.status() });
  });
  const result = { info: null, mainStatus: 0, robotsHeader: '', axe: null };
  try {
    const resp = await page.goto(url, { waitUntil: 'load', timeout: opts.timeout });
    result.mainStatus = resp ? resp.status() : 0;
    result.robotsHeader = resp ? (resp.headers()['x-robots-tag'] || '') : '';
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(200);
    result.info = await page.evaluate(inspectPage, vp.width);
    if (axe && axe.code) {
      try {
        await page.evaluate(axe.code);
        result.axe = await page.evaluate(async () => {
          const r = await window.axe.run(document, { resultTypes: ['violations'] });
          return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl, count: v.nodes.length, targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) }));
        });
      } catch (e) {
        result.axeError = String(e.message).split('\n')[0];
      }
    }
  } catch (e) {
    result.loadError = String(e.message).split('\n')[0];
  }
  await ctx.close().catch(() => {});
  Object.assign(result, { consoleErrors, pageErrors, failed, external });
  state.results.push({ page: pageName, url, vp, result });
}

function evaluateIssues(entry, all, opts, sink, linkJobs) {
  const { vp, result, url } = entry;
  const v = vp.name;
  if (result.loadError) { sink.add('error', 'load', 'page did not load: ' + result.loadError, v); return; }
  if (result.mainStatus >= 400) sink.add('error', 'load', 'page answered HTTP ' + result.mainStatus, v);
  const info = result.info;
  const origin = new URL(url).origin;

  for (const c of result.consoleErrors) {
    if (/^Failed to load resource/.test(c.text)) {
      if (c.url && !sameOrigin(c.url, origin)) sink.add('warning', 'external-resource', 'external resource failed: ' + c.url, v);
      continue;                                                     // same-origin ones: see failed-request
    }
    sink.add('error', 'console-error', c.text.slice(0, 300), v);
  }
  for (const e of result.pageErrors) sink.add('error', 'page-error', e.slice(0, 300), v);
  for (const f of result.failed) {
    const p = new URL(f.url).pathname;
    if (p === '/favicon.ico') sink.add('warning', 'favicon', 'no /favicon.ico (browsers request it; add one or a <link rel="icon">)', v);
    else sink.add('error', 'failed-request', f.why + ': ' + p, v);
  }
  for (const f of result.external) sink.add('warning', 'external-resource', 'external request failed (' + f.why + '): ' + f.url.slice(0, 160), v);
  if (result.axeError) sink.add('warning', 'axe', 'axe-core could not run: ' + result.axeError, v);
  if (!info) return;

  if (!info.title) sink.add('error', 'title', 'missing or empty <title>', v);
  if (!info.lang) sink.add('error', 'lang', 'missing lang attribute on <html>', v);
  if (!info.viewport) sink.add('error', 'viewport', 'missing <meta name="viewport" content="width=device-width, initial-scale=1">', v);
  if (!info.description) sink.add('warning', 'meta-description', 'missing <meta name="description">', v);
  if (!info.canonical) sink.add('warning', 'canonical', 'missing <link rel="canonical">', v);
  else if (!/^https?:\/\//i.test(info.canonical)) sink.add('warning', 'canonical', 'canonical should be an absolute URL: ' + info.canonical, v);
  if (!info.ogTitle) sink.add('warning', 'og:title', 'missing <meta property="og:title">', v);
  if (!info.ogImage) sink.add('warning', 'og:image', 'missing <meta property="og:image">', v);
  else if (!/^https?:\/\//i.test(info.ogImage)) sink.add('warning', 'og:image', 'og:image should be an absolute URL: ' + info.ogImage, v);
  if (!info.ogDescription) sink.add('warning', 'og:description', 'missing <meta property="og:description">', v);
  if (!info.twitterCard) sink.add('warning', 'twitter:card', 'missing <meta name="twitter:card">', v);
  const noindex = /noindex/i.test(result.robotsHeader || '') || /noindex/i.test(info.robots || '');
  if (noindex) entry.noindex = true;

  if (info.scrollWidth > vp.width + 1 || info.scrollWidth > info.innerWidth + 1) {
    const who = info.overflowers.map((o) => o.sel + ' (right edge ' + o.right + 'px)').join('; ');
    sink.add('error', 'overflow', `horizontal overflow at ${vp.width}px: page is ${info.scrollWidth}px wide` + (who ? ' -- widest: ' + who : ''), v, info.overflowers);
  }
  for (const im of info.imgsNoAlt) sink.add('error', 'img-alt', '<img> without alt: ' + im.sel + (im.src ? ' (' + im.src + ')' : ''), v);
  for (const d of info.dupIds) sink.add('error', 'duplicate-id', `id "${d.id}" is used ${d.count} times`, v);
  let prev = 0;
  info.headings.forEach((h, i) => {
    if (i === 0 && h.level !== 1) sink.add('warning', 'heading-order', `first heading is h${h.level}, not h1 ("${h.text}")`, v);
    if (prev && h.level > prev + 1) sink.add('warning', 'heading-order', `heading jumps from h${prev} to h${h.level}: ${h.sel} ("${h.text}")`, v);
    prev = h.level;
  });
  if (info.headings.length && !info.headings.some((h) => h.level === 1)) sink.add('warning', 'heading-order', 'no h1 on the page', v);
  for (const u of info.unnamed) sink.add('error', 'accessible-name', 'no accessible name: ' + u.sel + ' ' + u.html, v);
  for (const t of info.smallTargets) sink.add('warning', 'tap-target', `tap target ${t.w}x${t.h}px is under 24x24: ${t.sel}` + (t.name ? ` ("${t.name}")` : ''), v);

  // Script order: config.js first, store.js second, among the site's own modules.
  const mods = info.scripts.map((s) => { const m = /(?:^|\/)assets\/js\/([A-Za-z0-9_.-]+)\.js(?:[?#]|$)/.exec(s || ''); return m ? m[1] : null; }).filter(Boolean);
  const own = mods.filter((m) => m !== 'config.local');
  if (own.length) {
    if (own.indexOf('config') < 0 && own.some((m) => m !== 'sw-register')) sink.add('warning', 'script-order', 'page loads assets/js modules without assets/js/config.js', v);
    else if (own.indexOf('config') > 0) sink.add('warning', 'script-order', 'assets/js/config.js must be the first site script (found: ' + own.join(', ') + ')', v);
    if (own.indexOf('store') >= 0 && own.indexOf('store') !== own.indexOf('config') + 1) sink.add('warning', 'script-order', 'assets/js/store.js must come right after config.js (found: ' + own.join(', ') + ')', v);
  }

  if (result.axe) {
    for (const a of result.axe) {
      const sev = a.impact === 'critical' || a.impact === 'serious' ? 'error' : 'warning';
      sink.add(sev, 'axe:' + a.id, `${a.help} (${a.impact}, ${a.count} element${a.count === 1 ? '' : 's'}: ${a.targets.join(', ')})`, v, { helpUrl: a.helpUrl });
    }
  }

  // Links: queue for validation once every page has been inspected.
  for (const l of info.links) {
    const raw = (l.raw || '').trim();
    if (raw === '#') { sink.add('warning', 'link', 'placeholder href="#": ' + l.sel + ' (use a <button> for actions)', v); continue; }
    if (/^javascript:/i.test(raw)) { sink.add('warning', 'link', 'javascript: link: ' + l.sel, v); continue; }
    if (!/^https?:/i.test(l.abs || '')) continue;
    if (!sameOrigin(l.abs, origin)) continue;
    linkJobs.push({ sink, v, from: url, raw, abs: l.abs, sel: l.sel, ids: info.ids });
  }
  if (info.manifest && sameOrigin(info.manifest, origin)) linkJobs.manifests.add(info.manifest);
}

async function validateLinks(jobs, idsByUrl, request) {
  const cache = new Map();
  for (const j of jobs) {
    const u = new URL(j.abs);
    const hash = decodeURIComponent(u.hash.replace(/^#/, ''));
    u.hash = '';
    const target = u.href;
    const fromNoHash = j.from.split('#')[0];
    let ids = null;
    if (target === fromNoHash || target.split('?')[0] === fromNoHash.split('?')[0]) ids = new Set(j.ids);
    else {
      const st = await headStatus(target, cache, request);
      if (!st.status || st.status >= 400) {
        j.sink.add('error', 'broken-link', `broken link (${st.status || 'no response'}): ${j.raw} at ${j.sel}`, j.v);
        continue;
      }
      ids = idsByUrl.get(target.split('?')[0]) || st.ids;
    }
    if (hash && hash !== 'top' && ids && !ids.has(hash)) {
      j.sink.add('error', 'broken-anchor', `no element with id "${hash}" for link ${j.raw} at ${j.sel}`, j.v);
    }
  }
}

async function checkManifests(manifests, request, sinkFor) {
  const cache = new Map();
  for (const m of manifests) {
    const sink = sinkFor(m);
    let text = '', status = 0;
    try {
      if (request) { const r = await request.get(m); status = r.status(); text = await r.text(); }
      else {
        const r = await new Promise((resolve, reject) => {
          http.get(m, (res) => { let d = ''; res.setEncoding('utf8'); res.on('data', (c) => { d += c; }); res.on('end', () => resolve({ status: res.statusCode, d })); }).on('error', reject);
        });
        status = r.status; text = r.d;
      }
    } catch (e) { status = 0; }
    if (status >= 400 || !status) { sink.forEach((s) => s.add('error', 'manifest', 'manifest not found: ' + m, null)); continue; }
    let json;
    try { json = JSON.parse(text); } catch (e) { sink.forEach((s) => s.add('error', 'manifest', 'manifest is not valid JSON: ' + m, null)); continue; }
    for (const k of ['name', 'start_url', 'icons']) if (!json[k]) sink.forEach((s) => s.add('warning', 'manifest', 'manifest has no "' + k + '"', null));
    for (const icon of json.icons || []) {
      const iu = new URL(icon.src, m).href;
      const st = await headStatus(iu, cache, request);
      if (!st.status || st.status >= 400) sink.forEach((s) => s.add('warning', 'manifest-icon', 'manifest icon missing: ' + new URL(iu).pathname + ' (' + (icon.sizes || '?') + ')', null));
    }
  }
}

async function run(opts) {
  const started = Date.now();
  const report = {
    tool: 'tools/check_site.js', generatedAt: new Date().toISOString(), root: opts.root, target: '',
    viewports: opts.viewports.map((v) => ({ name: v.name, width: v.width, height: v.height })),
    strict: !!opts.strict, headersEmulated: false, axe: { status: 'skipped', note: '' }, notes: [],
    summary: { pages: 0, errors: 0, warnings: 0, byCheck: {} }, pages: []
  };
  const all = rootPages(opts.root);
  const pages = opts.pages.length ? opts.pages : all;
  const missing = pages.filter((p) => !fs.existsSync(path.join(opts.root, p)));
  if (!pages.length) {
    report.notes.push('no root-level *.html pages in ' + opts.root + ' yet; nothing to check');
    return finish(report, opts, started);
  }

  let server = null, base = opts.base;
  let headerRules = null;
  if (!base) {
    const hf = path.join(opts.root, '_headers');
    if (opts.headers && fs.existsSync(hf)) { headerRules = parseHeadersFile(fs.readFileSync(hf, 'utf8')); report.headersEmulated = true; }
    else if (opts.headers) report.notes.push('no _headers file: production headers (CSP) not emulated');
    server = createServer(opts.root, { headers: headerRules });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = 'http://127.0.0.1:' + server.address().port;
    report.target = base + ' (local server for ' + opts.root + ')';
  } else report.target = base;

  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) {
    if (server) server.close();
    throw new Error('Playwright is not installed (npm i -g playwright, or npm i -D playwright)');
  }
  const browser = await chromium.launch();
  let request = null;
  try {
    const axe = await loadAxe(opts, browser);
    report.axe = axe.status === 'ready' ? { status: 'ran', source: axe.source, version: axe.version || '' } : { status: 'skipped', note: axe.note };
    if (opts.base) request = (await browser.newContext()).request;

    const state = { results: [] };
    const jobs = [];
    for (const p of pages) {
      if (missing.indexOf(p) >= 0) continue;
      const url = base + '/' + p.split('/').map(encodeURIComponent).join('/');
      for (const vp of opts.viewports) jobs.push({ p, url, vp });
    }
    let next = 0;
    const workers = Array.from({ length: Math.min(3, jobs.length) }, async () => {
      while (next < jobs.length) {
        const j = jobs[next++];
        await checkOne(browser, j.p, j.url, j.vp, opts, axe.status === 'ready' ? axe : null, state);
      }
    });
    await Promise.all(workers);

    const sinks = new Map();
    const idsByUrl = new Map();
    for (const p of pages) sinks.set(p, issueSink());
    for (const p of missing) sinks.get(p).add('error', 'load', 'file not found: ' + p, null);
    state.results.sort((a, b) => pages.indexOf(a.page) - pages.indexOf(b.page) || opts.viewports.indexOf(a.vp) - opts.viewports.indexOf(b.vp));
    for (const r of state.results) if (r.result.info) idsByUrl.set(r.url.split('?')[0], new Set(r.result.info.ids));
    const linkJobs = [];
    linkJobs.manifests = new Set();
    const noindexPages = new Set();
    for (const r of state.results) {
      evaluateIssues(r, state.results, opts, sinks.get(r.page), linkJobs);
      if (r.noindex) noindexPages.add(r.page);
    }
    await validateLinks(linkJobs, idsByUrl, request);
    const manifestSinks = (m) => {
      const out = [];
      for (const r of state.results) if (r.result.info && r.result.info.manifest === m) out.push(sinks.get(r.page));
      return Array.from(new Set(out));
    };
    await checkManifests(linkJobs.manifests, request, manifestSinks);

    if (noindexPages.size) {
      const msg = 'pages are noindex (X-Robots-Tag or meta robots): expected for the demo; remove before launch';
      report.notes.push(msg + ': ' + Array.from(noindexPages).join(', '));
      if (opts.strict) for (const p of noindexPages) sinks.get(p).add('error', 'noindex', 'page is noindex (launch check)', null);
    }
    if (report.axe.status === 'skipped') report.notes.push('axe-core skipped: ' + report.axe.note);

    for (const p of pages) {
      let issues = sinks.get(p).list();
      if (opts.strict) issues = issues.map((i) => (i.severity === 'warning' ? Object.assign({}, i, { severity: 'error', promoted: true }) : i));
      const errors = issues.filter((i) => i.severity === 'error').length;
      const warnings = issues.length - errors;
      report.pages.push({ page: p, url: base + '/' + p, errors, warnings, issues });
    }
  } finally {
    await browser.close().catch(() => {});
    if (server) server.close();
  }
  return finish(report, opts, started);
}

function finish(report, opts, started) {
  const s = report.summary;
  s.pages = report.pages.length;
  for (const p of report.pages) {
    s.errors += p.errors;
    s.warnings += p.warnings;
    for (const i of p.issues) s.byCheck[i.check] = (s.byCheck[i.check] || 0) + 1;
  }
  s.seconds = Math.round((Date.now() - started) / 100) / 10;
  try {
    fs.mkdirSync(path.dirname(opts.out), { recursive: true });
    fs.writeFileSync(opts.out, JSON.stringify(report, null, 2) + '\n');
  } catch (e) {
    report.notes.push('could not write report: ' + e.message);
  }
  return report;
}

function printReport(report, opts) {
  const lines = [];
  const vps = report.viewports.map((v) => v.width + 'x' + v.height).join(' and ');
  const axe = report.axe.status === 'ran' ? 'axe-core ' + (report.axe.version || '') + ' from ' + report.axe.source.split(' (')[0] : 'axe skipped';
  if (report.pages.length) lines.push(`check_site: ${report.pages.length} page${report.pages.length === 1 ? '' : 's'} at ${vps}; ${report.target}; _headers ${report.headersEmulated ? 'applied' : 'not applied'}; ${axe}`);
  for (const p of report.pages) {
    if (opts.quiet && !p.errors) continue;
    lines.push(`${p.page}: ${p.errors} error${p.errors === 1 ? '' : 's'}, ${p.warnings} warning${p.warnings === 1 ? '' : 's'}`);
    const shown = p.issues.filter((i) => !opts.quiet || i.severity === 'error');
    for (const i of shown.slice(0, 40)) {
      lines.push(`  ${i.severity === 'error' ? 'ERROR' : 'warn '} ${i.check.padEnd(17)} ${i.message}${i.viewports.length && i.viewports.length < report.viewports.length ? ' [' + i.viewports.join(',') + ']' : ''}`);
    }
    if (shown.length > 40) lines.push(`  ... ${shown.length - 40} more in the report`);
  }
  for (const n of report.notes) lines.push('note: ' + n);
  const s = report.summary;
  let rel = path.relative(process.cwd(), opts.out);
  if (!rel || rel.startsWith('..')) rel = opts.out;
  const n = (k, word) => k + ' ' + word + (k === 1 ? '' : 's');
  lines.push(`SUMMARY: ${n(s.pages, 'page')} x ${n(report.viewports.length, 'viewport')}: ${n(s.errors, 'error')}, ${n(s.warnings, 'warning')} (${s.seconds}s). Report: ${rel}`);
  return lines.join('\n');
}

async function main(argv) {
  let opts;
  try { opts = parseArgs(argv); } catch (e) { process.stderr.write('check_site: ' + e.message + '\n'); return 2; }
  if (opts.help) {
    process.stdout.write(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#!.*\n/, '') + '*/\n');
    return 0;
  }
  let report;
  try { report = await run(opts); } catch (e) {
    process.stderr.write('check_site: crashed: ' + (e && e.stack ? e.stack : e) + '\n');
    return 2;
  }
  if (opts.json) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  else process.stdout.write(printReport(report, opts) + '\n');
  return report.summary.errors > 0 ? 1 : 0;
}

module.exports = { run, parseArgs, parseHeadersFile, headersFor, localizeHeaders, createServer, rootPages, printReport, AXE_VERSION };

if (require.main === module) main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
