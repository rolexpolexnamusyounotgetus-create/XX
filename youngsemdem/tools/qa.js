#!/usr/bin/env node
/**
 * tools/qa.js: measures every measurable BRIEF 6b check and every BRIEF 0 non-negotiable, per page,
 * at 320, 390 and 1440 px, in light and dark, and prints a scored table. Exit 1 on any GATE failure.
 *
 *   node tools/qa.js --pages index.html,es/index.html     # what page builders run
 *   node tools/qa.js --all                                 # every page (EN, es/, events/, quiz/...)
 *   node tools/qa.js --pages join.html --no-throttle --no-axe   # quicker local loop
 *
 * Passes per page (fresh browser context each, service workers blocked, _headers applied so the
 * production CSP is on, as with tools/check_site.js):
 *   390 light  first view: gzip-6 bytes of text, raw bytes of fonts and images, requests, outside
 *              hosts (and CSP-blocked attempts), fonts, video preloads; then every DOM check: text
 *              under 12 px, targets under 44 px, overflow, contrast (computed on flat fills, pixel-
 *              sampled on gradients, photos and overlaps), demo labels, live ticks, view counts,
 *              footer, banner, voice rules on rendered text, Spanish left/English left, stock-photo
 *              tags, skip link, zoom, status region, focusable focus rings, page height and element
 *              positions from the targets, full-bleed colour blocks; then 390 x 664 for the first
 *              screen (one primary + one secondary action, no overlay); then dark (contrast + axe).
 *   320        overflow, text size, targets, contrast (light and dark)
 *   1440       overflow, text size, targets, contrast, axe (light and dark), focus rings, press state
 *   reduced    prefers-reduced-motion: running animations and playing video must be 0
 *   4g         LCP, CLS, TBT with 170 ms RTT / 9 Mbps (tools/bench_compare.js '4g'); --no-throttle skips it
 *   share      site.url forced to https://qa.invalid: every share link, Web Share payload and copied
 *              text must not point at localhost, 127.0.0.1, the page's own origin or youngsemdems.com;
 *              plus the ?ref&from&e invite landing when the page has [data-invite-landing]
 *
 * Score per 6b item: 2 meets the threshold, 1 present but short of it, 0 failing, "review" when only a
 * person can judge it. N1..N10 are the non-negotiables, all GATEs except N7 (review).
 * Options: --root DIR  --pages a,b | page ...  --all  --widths 320,390,1440  --themes light,dark
 *          --no-axe  --no-throttle  --no-share  --targets FILE (JSON, merged over the defaults below)
 *          --allow-hosts a,b  --concurrency N  --out FILE  --json  --quiet  --timeout MS  --max-samples N
 * Writes tools/.cache/qa_report.json. Exit codes: 0 every GATE passes, 1 a GATE fails, 2 bad input or crash.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const es = require('./make_es');
const og = require('./make_og');
const voice = require('./voice_lint');

const ROOT = path.resolve(__dirname, '..');
const CACHE = path.join(__dirname, '.cache');
const AXE_VERSION = '4.10.2';
const QA_SITE = 'https://qa.invalid';
const THROTTLE_4G = { latency: 170, down: 9000, up: 9000 };
const SKIP_DIRS = new Set(['tools', 'tests', 'docs', 'partials', 'netlify', 'functions', 'vendor', 'dist', 'build', 'node_modules']);
// LLM endpoints that must never be called (built from parts so tooling tests that grep for them stay quiet).
const AI_HOSTS = [['api', 'open' + 'ai', 'com'], ['api', 'anth' + 'ropic', 'com'], ['generativelanguage', 'goo' + 'gleapis', 'com'], ['api', 'mistral', 'ai'], ['api', 'cohere', 'ai']].map((p) => p.join('.'));

/**
 * Per-page targets. Keys are page paths; es/<page> uses the English page's entry. '*' applies to
 * every page. positions: element tops at 390 px (selectors are tried in order; add data-qa hooks).
 */
const DEFAULT_TARGETS = {
  '*': { budgetKB: 500, maxRequests: 30 },
  'index.html': {
    home: true, budgetKB: 350, maxRequests: 30, maxHeight: 9500, bands: 3, peopleWithin: 844,
    positions: [
      { id: 'B9', label: 'Mail-ballot card top', selectors: ['[data-qa="mail-ballot"]', '.pin--deadline', '[data-pin="mail-ballot"]'], maxTop: 1000 },
      { id: 'B10', label: 'Reel top', selectors: ['[data-qa="reel"]', '[data-reel]', '.reel'], maxTop: 1688 }
    ]
  }
};

const GATES = new Set(['B1', 'B2', 'B6', 'B8', 'B30', 'B31', 'B33', 'N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N8', 'N9', 'N10']);
const CHECKS = [
  ['N1', 'No AI anywhere'], ['N2', 'Real name, honest labels'], ['N3', 'Brand safety, no fake proof'], ['N4', 'Mobile first, 320 to 1440, AA'],
  ['N5', 'No text on gradients or photos'], ['N6', 'Static, portable, fast'], ['N7', 'Viral moments end offline'], ['N8', 'Spanish twin, no English left'],
  ['N9', 'Footer: paid for, DEMO, not official'], ['N10', 'Share URLs never from origin'],
  ['B1', 'First-view weight'], ['B2', 'Speed (4G LCP, CLS, TBT)'], ['B3', 'Outside hosts and trackers'], ['B4', 'Fonts'], ['B5', 'Who and what in 8 words'],
  ['B6', 'First screen at 390 x 664'], ['B7', 'People photo in first 844 px'], ['B8', 'Colour blocks and contrast'], ['B9', 'Lead civic action position'],
  ['B10', 'Video band position'], ['B11', 'Finder in nav'], ['B12', 'Self-sort routes'], ['B13', 'Collectible'], ['B14', 'Weekly cadence'], ['B15', 'Toy that teaches'],
  ['B16', 'Share layer'], ['B17', 'Event pages'], ['B18', 'Next drop'], ['B19', 'Community wall'], ['B20', 'Closed loop (?ref landing)'], ['B21', 'Video basics'],
  ['B22', 'Clip action'], ['B23', 'Post path'], ['B24', 'Microcopy'], ['B25', 'Spanish parity'], ['B26', 'Voice lint'], ['B27', 'Press and reduced motion'],
  ['B28', 'Pause for long motion'], ['B29', 'Dark mode'], ['B30', 'Honest proof'], ['B31', 'Accessibility'], ['B32', 'Privacy'], ['B33', 'Brand safety'],
  ['B34', 'Community safety'], ['B35', 'Come back next week'], ['B36', 'Sign-up friction'], ['B37', 'Freshness'], ['B38', 'Local layer'], ['B39', 'Starter kit'],
  ['B40', 'Free sticker pack']
];
const REVIEW = { B5: 'Home, landing pages', B11: 'Quiz, nav', B12: 'Quiz', B13: 'Join, home', B14: 'Join, vote', B15: 'Home, 404', B17: 'Events (W2 flow tests)',
  B18: 'Home, events', B19: 'Clips', B22: 'Home, clips', B23: 'Clips, post (W4 flow tests)', B32: 'Forms', B34: 'All', B35: 'Home', B36: 'Join, home', B38: 'About, events',
  B39: 'Events', B40: 'Join', N7: 'All' };

// ------------------------------------------------------------------------------------------
// Small helpers
// ------------------------------------------------------------------------------------------

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
/** A timer that never keeps the process alive (for Promise.race timeouts). */
function later(ms, value) { return new Promise((r) => { const t = setTimeout(() => r(value), ms); if (t.unref) t.unref(); }); }
function firstLine(e) { return String(e && e.message || e).split('\n')[0]; }
function kb(n) { return Math.round(n / 102.4) / 10; }
function amPm(d) {
  let h = d.getHours(); const m = d.getMinutes(); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12;
  return h + (m ? ':' + String(m).padStart(2, '0') : '') + ' ' + ap;
}
function lum(c) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}
function ratio(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
function over(fg, bg) { const a = fg[3] == null ? 1 : fg[3]; return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a)]; }

function walkPages(root) {
  const out = [];
  (function walk(dir, rel) {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith('.')) continue;
      if (e.isDirectory()) { if (!(rel === '' && SKIP_DIRS.has(e.name)) && e.name !== 'node_modules') walk(path.join(dir, e.name), rel + e.name + '/'); }
      else if (/\.html$/i.test(e.name)) out.push(rel + e.name);
    }
  })(root, '');
  return out.sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b)));
}

function targetsFor(targets, page) {
  const base = page.replace(/^es\//, '');
  return Object.assign({}, targets['*'] || {}, targets[base] || {}, targets[page] || {});
}

async function loadAxe() {
  const globalRoot = path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules');
  const paths = [ROOT, process.cwd(), globalRoot].concat((process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean));
  try { const p = require.resolve('axe-core/axe.min.js', { paths }); return { status: 'ready', code: fs.readFileSync(p, 'utf8'), source: p }; } catch (e) { /* not installed */ }
  const cached = path.join(CACHE, 'axe-core-' + AXE_VERSION + '.min.js');
  try { const code = fs.readFileSync(cached, 'utf8'); if (code.length > 100000) return { status: 'ready', code, source: 'tools/.cache' }; } catch (e) { /* none */ }
  return { status: 'skipped', note: 'axe-core not found (node_modules or tools/.cache/axe-core-' + AXE_VERSION + '.min.js); run node tools/check_site.js once to cache it' };
}
function wrapAxe(code) { return '(function (define, module, exports) {\n' + code + '\n}).call(window)'; }
async function runAxe(page, code) {
  try {
    const has = await page.evaluate(() => !!window.axe);
    if (!has) await page.evaluate(wrapAxe(code));
    return await Promise.race([
      page.evaluate(async () => {
        const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] });
        return { status: 'ran', serious: r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help, targets: v.nodes.slice(0, 3).map((n) => String(n.target && n.target[0] || '')) })) };
      }),
      later(45000, { status: 'timeout', serious: [] })
    ]);
  } catch (e) { return { status: 'error', note: firstLine(e), serious: [] }; }
}

// ------------------------------------------------------------------------------------------
// In-page code (serialized; must be self-contained)
// ------------------------------------------------------------------------------------------

/** Init script for every QA context: CSP violations, LCP/CLS/long tasks, share interception. */
function qaInit(cfg) {
  try { if (window.top !== window) return; } catch (e) { return; }
  const Q = window.__qa = { csp: [], lcp: null, lcpEl: '', shifts: [], long: [], fcp: null, shares: [], copies: [] };
  document.addEventListener('securitypolicyviolation', (e) => { Q.csp.push({ uri: String(e.blockedURI || ''), dir: e.violatedDirective }); });
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { Q.lcp = e.renderTime || e.loadTime || e.startTime; Q.lcpEl = e.element ? e.element.tagName.toLowerCase() + (e.element.className && typeof e.element.className === 'string' ? '.' + e.element.className.trim().split(/\s+/)[0] : '') : ''; } }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch (e) {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) Q.shifts.push([e.startTime, e.value]); }).observe({ type: 'layout-shift', buffered: true }); } catch (e) {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) Q.long.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') Q.fcp = e.startTime; }).observe({ type: 'paint', buffered: true }); } catch (e) {}
  if (cfg && cfg.share) {
    window.YSD_CONFIG = Object.assign({}, window.YSD_CONFIG || {}, { site: Object.assign({}, (window.YSD_CONFIG || {}).site || {}, { url: cfg.site }) });
    try {
      Object.defineProperty(Navigator.prototype, 'share', { configurable: true, value: function (d) { Q.shares.push(JSON.stringify({ title: d && d.title, text: d && d.text, url: d && d.url })); return Promise.resolve(); } });
      Object.defineProperty(Navigator.prototype, 'canShare', { configurable: true, value: function () { return true; } });
    } catch (e) {}
    try {
      const clip = { writeText: (t) => { Q.copies.push(String(t)); return Promise.resolve(); }, write: () => Promise.resolve(), readText: () => Promise.resolve('') };
      Object.defineProperty(Navigator.prototype, 'clipboard', { configurable: true, get: () => clip });
      document.execCommand = function (cmd) { if (cmd === 'copy') { try { Q.copies.push(String(window.getSelection())); } catch (e) {} } return true; };
    } catch (e) {}
  }
}

/** Everything the DOM checks need, in one pass. o = { blocks, numbers, sampleMark, theme } */
function qaCollect(o) {
  const de = document.documentElement, body = document.body;
  // Layout viewport, not innerWidth: phone emulation zooms out (and widens innerWidth) when a page overflows.
  const W = de.clientWidth || window.innerWidth, H = de.clientHeight || window.innerHeight, SX = window.scrollX, SY = window.scrollY;
  const out = { vw: W, vh: H, scrollW: Math.max(de.scrollWidth, body ? body.scrollWidth : 0), docH: Math.max(de.scrollHeight, body ? body.scrollHeight : 0), lang: de.lang || '' };
  const csCache = new Map();
  const cs = (el) => { let s = csCache.get(el); if (!s) { s = getComputedStyle(el); csCache.set(el, s); } return s; };
  const desc = (el) => {
    if (!el || !el.tagName) return '';
    const part = (n) => { let s = n.tagName.toLowerCase(); if (n.id) s += '#' + n.id; else if (typeof n.className === 'string' && n.className.trim()) s += '.' + n.className.trim().split(/\s+/).slice(0, 2).join('.'); return s; };
    const parts = [part(el)];
    let p = el.parentElement;
    for (let i = 0; i < 2 && p && p !== body; i++, p = p.parentElement) parts.unshift(part(p));
    // name the landmark so "ul > li > a" reads as "footer … ul > li > a"
    const lm = el.closest('header, footer, nav, main, aside, dialog, [role="dialog"]');
    if (lm && lm !== el && !lm.contains(p) && parts[0].indexOf(lm.tagName.toLowerCase()) !== 0) parts.unshift(part(lm) + ' \u2026');
    return parts.join(' > ').replace(' \u2026 > ', ' \u2026 ').slice(0, 140);
  };
  const parseColor = (s) => {
    if (!s) return null;
    let m = /rgba?\(([^)]+)\)/.exec(s);
    if (m) { const p = m[1].split(/[\s,\/]+/).filter(Boolean).map((x) => x.endsWith('%') ? parseFloat(x) * 2.55 : parseFloat(x)); return [p[0], p[1], p[2], p.length > 3 ? (String(m[1]).split(/[\s,\/]+/).filter(Boolean)[3].endsWith('%') ? p[3] / 255 : p[3]) : 1]; }
    m = /color\(srgb ([^)]+)\)/.exec(s);
    if (m) { const p = m[1].split(/[\s\/]+/).filter(Boolean).map(parseFloat); return [p[0] * 255, p[1] * 255, p[2] * 255, p.length > 3 ? p[3] : 1]; }
    return null;
  };
  const opacityOf = (el) => { let op = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { op *= parseFloat(cs(n).opacity); if (op < 0.02) return 0; } return op; };
  const visible = (el) => {
    if (!el || !el.isConnected) return false;
    const s = cs(el);
    if (s.display === 'none' || s.visibility !== 'visible' || s.contentVisibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    return opacityOf(el) > 0.05;
  };
  const srOnly = (el) => {
    for (let n = el; n && n.nodeType === 1 && n !== body; n = n.parentElement) {
      const s = cs(n);
      if (s.clip === 'rect(0px, 0px, 0px, 0px)' || /inset\(50%\)/.test(s.clipPath)) return true;
      if (s.overflow === 'hidden' || s.overflowX === 'hidden') { const r = n.getBoundingClientRect(); if (r.width <= 2 && r.height <= 2) return true; }
    }
    return false;
  };
  const offscreen = (r) => r.right + SX <= 0 || r.left + SX >= out.scrollW + 50 || r.bottom + SY <= 0;
  const docRect = (r) => ({ x: Math.round(r.left + SX), y: Math.round(r.top + SY), w: Math.round(r.width), h: Math.round(r.height) });
  const nonsolidBg = (s) => {
    const bi = s.backgroundImage;
    if (!bi || bi === 'none') return null;
    if (/url\(/.test(bi)) return 'image';
    const cols = (bi.match(/rgba?\([^)]+\)|color\(srgb[^)]+\)/g) || []).map(parseColor);
    const size = s.backgroundSize || 'auto';
    const flat = cols.length && cols.every((c) => c && c[3] >= 0.99 && Math.abs(c[0] - cols[0][0]) < 1 && Math.abs(c[1] - cols[0][1]) < 1 && Math.abs(c[2] - cols[0][2]) < 1);
    if (flat && /^(auto|100% 100%|cover|auto auto)$/.test(size.trim())) return { flat: cols[0] };
    return flat ? 'partial fill' : 'gradient';
  };
  const darkCanvas = matchMedia('(prefers-color-scheme: dark)').matches && /dark/.test(cs(de).colorScheme || '');
  /** Background under el: {color} when flat, {nonsolid, at} otherwise. */
  const effBg = (el) => {
    const layers = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const s = cs(n);
      const ns = nonsolidBg(s);
      if (ns && !ns.flat) return { nonsolid: ns, at: desc(n), atEl: n };
      if (ns && ns.flat) { layers.push(ns.flat); break; }
      const c = parseColor(s.backgroundColor);
      if (c && c[3] > 0.001) { layers.push(c); if (c[3] >= 0.999) break; }
    }
    let base = darkCanvas ? [18, 18, 18] : [255, 255, 255];
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
    return { color: base };
    function over(f, b) { const a = f[3] == null ? 1 : f[3]; return [f[0] * a + b[0] * (1 - a), f[1] * a + b[1] * (1 - a), f[2] * a + b[2] * (1 - a)]; }
  };
  const lumOf = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratioOf = (a, b) => { const x = lumOf(a), y = lumOf(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

  // media rects (for text over photos, video, canvas, big SVG stickers)
  const media = [];
  for (const m of document.querySelectorAll('img, video, canvas, picture, iframe, svg')) {
    if (m.closest('button, a') && m.tagName.toLowerCase() === 'svg') continue;
    if (!visible(m)) continue;
    const r = m.getBoundingClientRect();
    if (r.width * r.height < 900) continue;
    media.push({ el: m, r });
  }

  // ---- text elements
  const texts = [];
  const seen = new Map();
  if (body) {
    const tw = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    while (tw.nextNode()) {
      const n = tw.currentNode;
      if (!n.nodeValue || !n.nodeValue.trim()) continue;
      const el = n.parentElement;
      if (!el || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|OPTION)$/.test(el.tagName) || el.closest('svg')) continue;
      let rec = seen.get(el);
      if (!rec) { rec = { el, nodes: [] }; seen.set(el, rec); }
      rec.nodes.push(n);
    }
  }
  let sampleId = 0;
  for (const [el, rec] of seen) {
    if (!visible(el) || srOnly(el)) continue;
    const range = document.createRange();
    let rr = null;
    for (const n of rec.nodes) {
      range.selectNodeContents(n);
      const b = range.getBoundingClientRect();
      if (b.width < 1 || b.height < 1) continue;
      rr = rr ? { left: Math.min(rr.left, b.left), top: Math.min(rr.top, b.top), right: Math.max(rr.right, b.right), bottom: Math.max(rr.bottom, b.bottom) } : { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
    }
    if (!rr) continue;
    rr.width = rr.right - rr.left; rr.height = rr.bottom - rr.top;
    if (offscreen(rr)) continue;
    const s = cs(el);
    const text = rec.nodes.map((n) => n.nodeValue).join(' ').replace(/\s+/g, ' ').trim();
    const fs = parseFloat(s.fontSize), fw = parseInt(s.fontWeight, 10) || 400;
    const color = parseColor(s.color) || [0, 0, 0, 1];
    const op = opacityOf(el);
    color[3] = (color[3] == null ? 1 : color[3]) * op;
    const t = { sel: desc(el), text: text.slice(0, 80), fs, fw, rect: docRect(rr), large: fs >= 24 || (fs >= 18.66 && fw >= 700) };
    t.disabled = !!el.closest(':disabled, [aria-disabled="true"]');
    t.logo = !!el.closest('.brand, [data-logo]');
    const bg = effBg(el);
    if (bg.color) { t.bg = bg.color; t.ratio = color[3] > 0.001 ? ratioOf(over2(color, bg.color), bg.color) : null; }
    else { t.nonsolid = bg.nonsolid; t.nonsolidAt = bg.at; }
    // overlaps with media that no solid panel separates
    for (const m of media) {
      if (m.el.contains(el) || el.contains(m.el)) continue;
      const ix = Math.max(0, Math.min(rr.right, m.r.right) - Math.max(rr.left, m.r.left)), iy = Math.max(0, Math.min(rr.bottom, m.r.bottom) - Math.max(rr.top, m.r.top));
      if (ix * iy < 0.15 * rr.width * rr.height) continue;
      let panel = false;
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
        if (n.contains(m.el)) break;
        const c = parseColor(cs(n).backgroundColor);
        if (c && c[3] >= 0.999) { panel = true; break; }
      }
      if (!panel) { t.overMedia = m.el.tagName.toLowerCase() + (m.el.className && typeof m.el.className === 'string' ? '.' + m.el.className.trim().split(/\s+/)[0] : ''); break; }
    }
    t.color = color;
    if ((t.nonsolid || t.overMedia) && o.sampleMark) { el.setAttribute('data-qa-sample', String(sampleId)); t.sample = sampleId++; }
    texts.push(t);
  }
  out.texts = texts;
  function over2(f, b) { const a = f[3] == null ? 1 : f[3]; return [f[0] * a + b[0] * (1 - a), f[1] * a + b[1] * (1 - a), f[2] * a + b[2] * (1 - a)]; }

  // ---- tap targets
  const TSEL = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="checkbox"], [role="radio"], [role="switch"], [role="menuitem"], [tabindex]:not([tabindex="-1"])';
  out.targets = [];
  for (const el of document.querySelectorAll(TSEL)) {
    if (el.closest('[inert]')) continue;
    const isBox = el.matches('input[type="checkbox"], input[type="radio"]');
    let r = el.getBoundingClientRect();
    let vis = visible(el) && !srOnly(el);
    if (isBox && el.labels && el.labels.length) {
      const boxes = [vis ? r : null].concat(Array.from(el.labels).filter((l) => visible(l)).map((l) => l.getBoundingClientRect())).filter(Boolean);
      if (!boxes.length) continue;
      const u = { left: Math.min.apply(null, boxes.map((b) => b.left)), top: Math.min.apply(null, boxes.map((b) => b.top)), right: Math.max.apply(null, boxes.map((b) => b.right)), bottom: Math.max.apply(null, boxes.map((b) => b.bottom)) };
      r = { left: u.left, top: u.top, right: u.right, bottom: u.bottom, width: u.right - u.left, height: u.bottom - u.top };
      vis = true;
    }
    if (!vis || offscreen(r)) continue;
    if (el.tagName === 'A' && cs(el).display === 'inline') {
      const p = el.closest('p, li, dd, td, figcaption, blockquote, label, small, span');
      if (p && p !== el) { const rest = (p.textContent || '').replace(el.textContent || '', '').replace(/[\s·|,.;:()\-–—]+/g, ''); if (rest.length > 1) continue; }
    }
    if (r.width + 0.5 < 44 || r.height + 0.5 < 44) out.targets.push({ sel: desc(el), w: Math.round(r.width), h: Math.round(r.height), text: (el.getAttribute('aria-label') || el.textContent || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 40) });
  }

  // ---- overflow offenders
  out.overflow = [];
  if (out.scrollW > W + 1) {
    const all = body ? body.querySelectorAll('*') : [];
    const scrollers = (el) => { for (let n = el.parentElement; n && n !== body; n = n.parentElement) { const s = cs(n); if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) return true; } return false; };
    const list = [];
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.right <= W + 1) continue;
      if (scrollers(el)) continue;
      list.push({ sel: desc(el), right: Math.round(r.right + SX), w: Math.round(r.width) });
    }
    list.sort((a, b) => b.right - a.right);
    out.overflow = list.slice(0, 6);
  }
  if (o.lite) return out;

  // ---- blocks of copy (for voice rules, English-left, demo counts, exclamations)
  out.blocks = [];
  const BLOCKS = 'p, li, h1, h2, h3, h4, h5, h6, dt, dd, td, th, figcaption, blockquote, summary, button, a, label, legend, caption, small, span, div, strong, em, b';
  const done = new Set();
  for (const el of document.querySelectorAll(BLOCKS)) {
    let direct = '';
    for (const c of el.childNodes) if (c.nodeType === 3) direct += c.nodeValue;
    if (!direct.trim() || el.closest('script, style, template, svg')) continue;
    const vis = visible(el);
    if (!vis && !srOnly(el)) continue;
    if (done.has(el)) continue;
    done.add(el);
    const langEl = el.closest('[lang]');
    out.blocks.push({
      sel: desc(el), text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 600), own: direct.replace(/\s+/g, ' ').trim(),
      lang: langEl ? langEl.getAttribute('lang').slice(0, 2).toLowerCase() : '',
      tn: !!el.closest('[translate="no"]'), serious: !!el.closest('.band--serious, [data-tone="serious"], [data-tone="calm"]'),
      letter: !!el.closest('.letter'), noEmoji: !!el.closest('.legal, .notice, .field__error, .form__summary, .letter, .band--serious'),
      screen: (() => { const s = el.closest('section, article, aside, header, footer, dialog, nav, form, main'); if (!s) return 'page'; if (!s.__qaId) s.__qaId = 's' + Math.random().toString(36).slice(2, 8); return s.__qaId; })(),
      footer: !!el.closest('footer, .site-footer'), demoScope: (() => { const p = el.parentElement; const pt = p && p !== body ? (p.textContent || '') : ''; if (pt.length < 200 && pt.indexOf('DEMO') >= 0) return true; const c = el.closest('article, li, figure, .invite, .story, .team-card, .stat, .pin, .ticket, .card, .tier, [data-demo-scope], [data-demo]'); return c ? (c.textContent || '').indexOf('DEMO') >= 0 : false; })(),
      real: !!el.closest('[data-real], .stat a[href], .tag--real'), countdown: !!el.closest('[data-countdown], time, [data-clock]'),
      visible: vis
    });
  }
  // attributes people read or hear
  out.attrs = [];
  for (const el of document.querySelectorAll('[alt], [aria-label], [placeholder], [title]')) {
    if (el.closest('head') || el.tagName === 'LINK') continue;
    for (const a of ['alt', 'aria-label', 'placeholder', 'title']) {
      const v = el.getAttribute(a);
      if (!v || !v.trim()) continue;
      const langEl = el.closest('[lang]');
      out.attrs.push({ sel: desc(el), attr: a, text: v.trim().slice(0, 300), lang: langEl ? langEl.getAttribute('lang').slice(0, 2).toLowerCase() : '', tn: !!el.closest('[translate="no"]') });
    }
  }
  // ---- demo honesty
  out.demoMode = !(window.YSD_CONFIG && window.YSD_CONFIG.demo === false);
  out.demoEls = [];
  for (const el of document.querySelectorAll('[data-demo]')) {
    if (!visible(el)) continue;
    const own = (el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '');
    const scope = el.closest('article, li, figure, .invite, .story, .team-card, .stat, .pin, .ticket, .card, .tier, [data-demo-scope]');
    const near = el.parentElement && el.parentElement !== body && (el.parentElement.textContent || '').length < 200 ? (el.parentElement.textContent || '') : '';
    const labelled = own.indexOf('DEMO') >= 0 || !!el.querySelector('.tag--demo') || near.indexOf('DEMO') >= 0 || (scope && (scope.textContent || '').indexOf('DEMO') >= 0);
    if (!labelled) out.demoEls.push({ sel: desc(el), text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60) });
  }
  const banner = document.querySelector('.demo-banner, [data-demo-banner]');
  out.banner = banner ? { visible: visible(banner), demo: (banner.textContent || '').indexOf('DEMO') >= 0 } : null;
  const footers = Array.from(document.querySelectorAll('footer, .site-footer')).filter((f) => !f.closest('article, dialog, blockquote, figure'));
  const footer = footers[footers.length - 1];
  out.footer = footer ? { text: (footer.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 3000), demoVisible: Array.from(footer.querySelectorAll('*')).some((n) => visible(n) && Array.from(n.childNodes).some((c) => c.nodeType === 3 && /\bDEMO\b/.test(c.nodeValue))) } : null;
  // numbers for the live-tick check
  if (o.numbers) {
    out.numbers = [];
    for (const b of out.blocks) if (/\d/.test(b.own) && !b.countdown) out.numbers.push(b.sel + '|' + b.own.replace(/[^\d]/g, ''));
  }
  // ---- page facts
  const vp = document.querySelector('meta[name="viewport"]');
  out.viewport = vp ? vp.getAttribute('content') || '' : '';
  const firstFocusable = body ? body.querySelector('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])') : null;
  out.skipLink = !!(firstFocusable && firstFocusable.tagName === 'A' && /^#/.test(firstFocusable.getAttribute('href') || '') && (firstFocusable.getAttribute('href').length > 1)) || !!document.querySelector('a.skip-link[href^="#"]');
  out.statusRegion = !!document.querySelector('[role="status"], output, [aria-live="polite"], [aria-live="assertive"]');
  out.h1 = Array.from(document.querySelectorAll('h1')).filter(visible).length;
  out.badInvalid = Array.from(document.querySelectorAll('[aria-invalid="true"]')).filter((el) => { const ids = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean); return !ids.length || ids.some((id) => !document.getElementById(id)); }).map(desc);
  out.shareButtons = document.querySelectorAll('[data-share]').length;
  out.moduleScripts = document.querySelectorAll('script[type="module"], link[rel="modulepreload"]').length;
  out.inlineScripts = Array.from(document.querySelectorAll('script:not([src])')).filter((s) => s.textContent.trim() && !/json/.test(s.type || '')).length;
  out.fontPreloads = document.querySelectorAll('link[rel="preload"][as="font"]').length;
  out.fontGate = [];
  for (const ss of Array.from(document.styleSheets)) {
    let rules = [];
    try { rules = Array.from(ss.cssRules || []); } catch (e) { continue; }
    const scan = (list) => { for (const r of list) { if (r.cssRules && !r.selectorText) scan(Array.from(r.cssRules)); else if (r.selectorText && r.style && (r.style.visibility === 'hidden' || r.style.opacity === '0') && /:not\(\.(?:ready|fonts?-?loaded|wf-active|loaded)\)|\.wf-loading|\.fonts?-loading/.test(r.selectorText)) out.fontGate.push(r.selectorText.slice(0, 80)); } };
    scan(rules);
  }
  // stock photos
  out.stock = [];
  for (const img of document.querySelectorAll('img')) {
    const src = img.currentSrc || img.getAttribute('src') || '';
    const isStock = /images\.unsplash\.com|unsplash\.com/.test(src + ' ' + (img.getAttribute('data-source') || ''));
    if (!isStock || !visible(img)) continue;
    let tagged = false;
    for (let n = img.parentElement, i = 0; n && i < 4 && n !== body; n = n.parentElement, i++) {
      if (Array.from(n.querySelectorAll('.tag--stock, [data-stock-tag]')).some(visible) || /stock photo|foto de archivo/i.test(n.textContent || '')) { tagged = true; break; }
    }
    out.stock.push({ sel: desc(img), tagged, credit: !!(img.getAttribute('data-photographer') && img.getAttribute('data-source')) });
  }
  // videos
  out.videos = Array.from(document.querySelectorAll('video')).map((v) => ({ sel: desc(v), poster: !!(v.getAttribute('poster') || v.getAttribute('data-poster')), muted: v.muted || v.hasAttribute('muted'), autoplay: v.hasAttribute('autoplay'), preload: v.getAttribute('preload') || '', playing: !v.paused }));
  // people photo near the top (B7)
  out.photos = [];
  for (const img of document.querySelectorAll('img')) {
    if (!visible(img)) continue;
    const r = img.getBoundingClientRect();
    if (r.width * r.height < 6000) continue;
    let tagged = false;
    for (let n = img.parentElement, i = 0; n && i < 4 && n !== body; n = n.parentElement, i++) if (Array.from(n.querySelectorAll('.tag--stock')).some(visible) || /stock photo|foto de archivo/i.test(n.textContent || '')) { tagged = true; break; }
    out.photos.push({ sel: desc(img), top: Math.round(r.top + SY), loaded: img.complete && img.naturalWidth > 0, tagged });
  }
  // full-bleed saturated blocks (B8)
  out.bands = [];
  const satur = (c) => { const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; const s = mx === mn ? 0 : l > 0.5 ? (mx - mn) / (2 - mx - mn) : (mx - mn) / (mx + mn); return { s, l }; };
  if (body) {
    const counted = [];
    for (const el of body.querySelectorAll('section, header, footer, div, aside, main > *')) {
      const r = el.getBoundingClientRect();
      if (r.width < W - 2 || r.height < 160 || !visible(el)) continue;
      const c = parseColor(cs(el).backgroundColor);
      if (!c || c[3] < 0.99) continue;
      const hs = satur(c);
      if (hs.s < 0.4 || hs.l < 0.2 || hs.l > 0.85) continue;
      if (counted.some((p) => p.contains(el) || el.contains(p))) continue;
      counted.push(el);
      out.bands.push({ sel: desc(el), color: 'rgb(' + c.slice(0, 3).map(Math.round).join(',') + ')', h: Math.round(r.height) });
    }
  }
  // long-running motion and a pause control (B28)
  out.longAnims = [];
  try {
    for (const a of document.getAnimations()) {
      if (a.playState !== 'running' || !a.effect) continue;
      const t = a.effect.getComputedTiming();
      if (t.iterations === Infinity || (t.endTime && t.endTime > 5000)) out.longAnims.push((a.animationName || a.constructor.name) + ' on ' + desc(a.effect.target));
    }
  } catch (e) {}
  out.pauseControl = Array.from(document.querySelectorAll('button, [role="button"], [data-motion-toggle]')).some((b) => visible(b) && (/(pause|pausar|motion|movimiento)/i.test((b.textContent || '') + ' ' + (b.getAttribute('aria-label') || '')) || b.hasAttribute('data-motion-toggle')));
  out.landing = (() => { const l = document.querySelector('[data-invite-landing]'); return l ? { visible: visible(l), text: (l.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120) } : null; })();
  out.rsvpId = (() => { const r = document.querySelector('[data-rsvp]'); return r ? r.getAttribute('data-rsvp') : ''; })();
  out.qa = (() => { const m = {}; for (const el of document.querySelectorAll('[data-qa]')) { const k = el.getAttribute('data-qa'); if (m[k]) continue; const r = el.getBoundingClientRect(); m[k] = { top: Math.round(r.top + SY), visible: visible(el) }; } return m; })();
  return out;
}

/** Tops of the first element matching each selector list. */
function qaPositions(lists) {
  return lists.map((sels) => {
    for (const s of sels) {
      let el = null;
      try { el = document.querySelector(s); } catch (e) { el = null; }
      if (el) { const r = el.getBoundingClientRect(); return { sel: s, top: Math.round(r.top + window.scrollY) }; }
    }
    return null;
  });
}

/** First screen at the current viewport: primary + secondary actions fully visible, overlays. */
function qaFirstScreen() {
  const W = document.documentElement.clientWidth || window.innerWidth, H = window.innerHeight;
  const vis = (el) => { const s = getComputedStyle(el); if (s.display === 'none' || s.visibility !== 'visible' || +s.opacity === 0) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const full = (el) => { const r = el.getBoundingClientRect(); if (r.left < -0.5 || r.top < -0.5 || r.right > W + 0.5 || r.bottom > H + 0.5) return false; const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!hit && (hit === el || el.contains(hit) || hit.contains(el)); };
  const half = (el) => { const r = el.getBoundingClientRect(); const vh = Math.max(0, Math.min(H, r.bottom) - Math.max(0, r.top)); return r.height > 0 && vh / r.height >= 0.5 && r.left >= -0.5 && r.right <= W + 0.5; };
  const label = (el) => (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const prim = Array.from(document.querySelectorAll('.btn--primary, [data-qa="primary"]')).filter(vis);
  const p = prim.find(full) || null;
  const pl = p ? label(p) : '';
  const sec = Array.from(document.querySelectorAll('[data-qa="secondary"], .btn:not(.btn--primary), .btn')).filter((el) => vis(el) && el !== p && !(p && (p.contains(el) || el.contains(p))) && label(el) !== pl);
  const s = sec.find(full) || null;
  const sHalf = s ? null : sec.find(half) || null;
  const overlays = [];
  for (const d of document.querySelectorAll('dialog[open], [role="dialog"], [aria-modal="true"]')) if (vis(d)) overlays.push('dialog ' + (d.className || d.id || ''));
  for (const el of document.querySelectorAll('body *')) {
    const st = getComputedStyle(el);
    if (st.position !== 'fixed' || !vis(el)) continue;
    if (el.closest('header, .site-header, .demo-banner, [role="status"], .toast-region')) continue;
    const r = el.getBoundingClientRect();
    const a = Math.max(0, Math.min(W, r.right) - Math.max(0, r.left)) * Math.max(0, Math.min(H, r.bottom) - Math.max(0, r.top));
    if (a > 0.25 * W * H) overlays.push('fixed ' + el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : ''));
  }
  return { primary: p ? label(p) : null, primaryCandidates: prim.length, secondary: s ? label(s) : null, secondaryHalf: sHalf ? label(sHalf) : null, overlays };
}

/** Running animations and playing videos (reduced-motion pass). */
function qaMotion() {
  const desc = (el) => { if (!el || !el.tagName) return ''; let s = el.tagName.toLowerCase(); if (el.id) s += '#' + el.id; else if (typeof el.className === 'string' && el.className.trim()) s += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.'); return s; };
  const anims = [];
  try {
    for (const a of document.getAnimations()) {
      if (a.playState !== 'running') continue;
      anims.push(((a.animationName || a.transitionProperty || a.constructor.name) + ' on ' + desc(a.effect && a.effect.target)).slice(0, 100));
    }
  } catch (e) {}
  const videos = Array.from(document.querySelectorAll('video')).filter((v) => !v.paused).map(desc);
  return { anims, videos };
}

/** All share payloads visible in the DOM: share-ish hrefs, data attributes. */
function qaShareLinks() {
  const out = [];
  const shareHost = /^(?:https?:\/\/)?(?:www\.)?(?:wa\.me|api\.whatsapp\.com|twitter\.com\/intent|x\.com\/intent|threads\.net\/intent|bsky\.app\/intent|(?:m\.)?facebook\.com\/sharer|t\.me\/share|telegram\.me\/share|reddit\.com\/submit|linkedin\.com\/sharing)/i;
  for (const a of document.querySelectorAll('a[href], [data-share-url], [data-url], [data-link]')) {
    const h = a.getAttribute('href') || '';
    let payload = '';
    if (/^(sms|mailto):/i.test(h) && /[?&](body|text)=/i.test(h)) payload = h;
    else if (shareHost.test(h)) payload = h;
    for (const k of ['data-share-url', 'data-url', 'data-link']) if (a.getAttribute(k)) payload += ' ' + a.getAttribute(k);
    if (!payload) continue;
    let dec = payload;
    try { dec = decodeURIComponent(payload.replace(/\+/g, ' ')); } catch (e) {}
    out.push({ where: (a.tagName.toLowerCase() + (a.className && typeof a.className === 'string' ? '.' + a.className.trim().split(/\s+/)[0] : '')), payload: dec.slice(0, 400) });
  }
  for (const i of document.querySelectorAll('input[readonly], textarea[readonly], [data-share-text]')) {
    const v = i.value || i.getAttribute('data-share-text') || '';
    if (/https?:\/\//.test(v)) out.push({ where: i.tagName.toLowerCase(), payload: v.slice(0, 400) });
  }
  return out;
}

/** Visible focus ring on the first few keyboard stops. */
function qaFocusState() {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const s = getComputedStyle(el);
  const ring = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 1.5) || (s.boxShadow && s.boxShadow !== 'none');
  return { sel: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : ''), ring };
}

// ------------------------------------------------------------------------------------------
// Pixel sampling (Node side, with make_og's PNG decoder)
// ------------------------------------------------------------------------------------------

async function sampleTexts(page, texts, max) {
  const out = [];
  const cands = texts.filter((t) => t.sample != null).slice(0, max);
  for (const t of cands) {
    try {
      const box = await page.evaluate((i) => {
        const el = document.querySelector('[data-qa-sample="' + i + '"]');
        if (!el) return null;
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        const range = document.createRange();
        let r = null;
        for (const n of el.childNodes) {
          if (n.nodeType !== 3 || !n.nodeValue.trim()) continue;
          range.selectNodeContents(n);
          const b = range.getBoundingClientRect();
          r = r ? { l: Math.min(r.l, b.left), t: Math.min(r.t, b.top), r: Math.max(r.r, b.right), b: Math.max(r.b, b.bottom) } : { l: b.left, t: b.top, r: b.right, b: b.bottom };
        }
        if (!r) return null;
        return { x: Math.max(0, Math.floor(r.l) - 2), y: Math.max(0, Math.floor(r.t) - 2), w: Math.min(window.innerWidth, Math.ceil(r.r) + 2) - Math.max(0, Math.floor(r.l) - 2), h: Math.min(window.innerHeight, Math.ceil(r.b) + 2) - Math.max(0, Math.floor(r.t) - 2) };
      }, t.sample);
      if (!box || box.w < 2 || box.h < 2) continue;
      const clip = { x: box.x, y: box.y, width: box.w, height: box.h };
      const a = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
      await page.evaluate((i) => {
        const el = document.querySelector('[data-qa-sample="' + i + '"]');
        el.setAttribute('data-qa-style', el.getAttribute('style') || '');
        for (const [k, v] of [['color', 'transparent'], ['-webkit-text-fill-color', 'transparent'], ['text-shadow', 'none'], ['-webkit-text-stroke', '0'], ['text-decoration-color', 'transparent'], ['caret-color', 'transparent']]) el.style.setProperty(k, v, 'important');
      }, t.sample);
      const b = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
      await page.evaluate((i) => { const el = document.querySelector('[data-qa-sample="' + i + '"]'); const s = el.getAttribute('data-qa-style'); if (s) el.setAttribute('style', s); else el.removeAttribute('style'); el.removeAttribute('data-qa-style'); }, t.sample);
      const A = og.decodePNG(a), B = og.decodePNG(b);
      const bgs = [];
      for (let i = 0; i < A.data.length; i += 4) {
        const d = Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]);
        if (d > 48) bgs.push([B.data[i], B.data[i + 1], B.data[i + 2]]);
      }
      if (bgs.length < 4) continue;
      const med = [0, 1, 2].map((c) => bgs.map((p) => p[c]).sort((x, y) => x - y)[bgs.length >> 1]);
      const fg = over(t.color, med);
      const rs = bgs.map((p) => ratio(fg, p)).sort((x, y) => x - y);
      const p10 = rs[Math.floor(rs.length * 0.1)];
      const far = bgs.filter((p) => Math.hypot(p[0] - med[0], p[1] - med[1], p[2] - med[2]) > 40).length / bgs.length;
      out.push({ sel: t.sel, text: t.text, ratio: Math.round(p10 * 100) / 100, need: t.large ? 3 : 4.5, uniform: far <= 0.08, spread: Math.round(far * 100), why: t.nonsolid ? (typeof t.nonsolid === 'string' ? t.nonsolid : 'background') + ' on ' + t.nonsolidAt : 'over ' + t.overMedia });
    } catch (e) { /* element moved or detached; skip */ }
  }
  await page.evaluate(() => { for (const el of document.querySelectorAll('[data-qa-sample]')) el.removeAttribute('data-qa-sample'); window.scrollTo(0, 0); }).catch(() => {});
  return { sampled: out, candidates: texts.filter((t) => t.sample != null).length };
}

// ------------------------------------------------------------------------------------------
// Passes
// ------------------------------------------------------------------------------------------

function isLocal(u, base) { try { const x = new URL(u); return x.origin === base.origin || /^(127\.0\.0\.1|localhost)$/.test(x.hostname); } catch (e) { return true; } }

async function newCtx(browser, w, opts, extra) {
  const mobile = w < 768;
  const ctx = await browser.newContext(Object.assign({
    viewport: { width: w, height: w === 390 ? 844 : w === 320 ? 640 : 900 }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile,
    colorScheme: 'light', serviceWorkers: 'block', locale: 'en-US', timezoneId: 'America/New_York', reducedMotion: 'no-preference'
  }, extra || {}));
  return ctx;
}

async function routeOutside(ctx, base, allow, rec) {
  await ctx.route('**/*', (route) => {
    const u = route.request().url();
    if (!/^https?:/i.test(u) || isLocal(u, base)) return route.continue();
    let host = '';
    try { host = new URL(u).hostname; } catch (e) { host = u; }
    if (allow.indexOf(host) >= 0) { rec.allowed.add(host); return route.continue(); }
    rec.blocked.add(host);
    return route.abort('blockedbyclient');
  });
}

async function goto(page, url, timeout) {
  const r = await page.goto(url, { waitUntil: 'load', timeout });
  await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
  return r;
}

/** 390 light: first view, every DOM check, first screen, dark. */
async function mainPass(browser, url, pageRel, opts, axe, R) {
  const base = new URL(url);
  const ctx = await newCtx(browser, 390, opts);
  const rec = { allowed: new Set(), blocked: new Set() };
  await ctx.addInitScript({ content: '(' + qaInit.toString() + ')(' + JSON.stringify({}) + ')' });
  await routeOutside(ctx, base, opts.allowHosts, rec);
  const net = { measuring: true, pending: [], requests: 0, bytes: 0, text: 0, raw: 0, items: [], fonts: [], video: [], json: [], ai: [] };
  ctx.on('request', (req) => {
    if (!net.measuring) return;
    const u = req.url();
    if (!/^https?:/i.test(u)) return;
    net.requests++;
    try { if (AI_HOSTS.indexOf(new URL(u).hostname) >= 0) net.ai.push(u); } catch (e) {}
    if (/\/api\/(?:ask|chat|assistant|llm|completion)/i.test(u)) net.ai.push(u);
  });
  ctx.on('requestfinished', (req) => {
    if (!net.measuring) return;
    const u = req.url();
    if (!/^https?:/i.test(u)) return;
    net.pending.push((async () => {
      const resp = await req.response().catch(() => null);
      if (!resp) return;
      let body = null;
      try { body = await resp.body(); } catch (e) { body = null; }
      const type = (resp.headers()['content-type'] || '').toLowerCase();
      const rt = req.resourceType();
      const isText = /text\/|javascript|json|xml|svg|manifest/.test(type) && !/font|image\/(?!svg)/.test(type);
      const n = body ? body.length : 0;
      const size = isText && body ? zlib.gzipSync(body, { level: 6 }).length : n;
      net.bytes += size;
      if (isText) net.text += size; else net.raw += size;
      const rel = isLocal(u, base) ? new URL(u).pathname : u;
      net.items.push({ url: rel, type: rt, bytes: size, raw: n });
      if (rt === 'font' || /font\/|woff/.test(type)) net.fonts.push({ url: rel, bytes: n });
      if (rt === 'media' || /video\//.test(type) || /\.(mp4|webm|mov|m4v)(\?|$)/i.test(u)) net.video.push(rel);
      if ((rt === 'fetch' || rt === 'xhr') && isLocal(u, base) && /\.json(\?|$)/i.test(u)) net.json.push(rel);
    })());
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(firstLine(e)));
  const t0 = Date.now();
  let resp;
  try { resp = await goto(page, url, opts.timeout); } catch (e) { await ctx.close(); throw e; }
  await sleep(600);
  net.measuring = false;
  await Promise.race([Promise.all(net.pending), later(8000)]);
  R.http = resp ? resp.status() : 0;
  R.net = { requests: net.requests, bytes: net.bytes, text: net.text, raw: net.raw, fonts: net.fonts, video: net.video, json: net.json.filter((u) => !/manifest/.test(u)), ai: net.ai, top: net.items.sort((a, b) => b.bytes - a.bytes).slice(0, 6) };
  R.hosts = { allowed: Array.from(rec.allowed), blocked: Array.from(rec.blocked) };
  R.pageErrors = errors;
  const before = await page.evaluate(qaCollect, { numbers: true, sampleMark: true });
  const csp = await page.evaluate(() => (window.__qa && window.__qa.csp) || []);
  R.hosts.csp = Array.from(new Set(csp.map((c) => { try { return new URL(c.uri).hostname; } catch (e) { return ''; } }).filter((h) => h && opts.allowHosts.indexOf(h) < 0)));
  R.v['390-light'] = slimVariant(before);
  R.v['390-light'].samples = await sampleTexts(page, before.texts, opts.maxSamples);
  R.dom = before;
  // positions and height
  const tg = targetsFor(opts.targets, pageRel);
  if (tg.positions) R.positions = (await page.evaluate(qaPositions, tg.positions.map((p) => p.selectors))).map((r, i) => Object.assign({ id: tg.positions[i].id, label: tg.positions[i].label, maxTop: tg.positions[i].maxTop }, r || { sel: null, top: null }));
  R.height = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0));
  // dark mode probe (B29) and dark checks
  const bgOf = () => getComputedStyle(document.body || document.documentElement).backgroundColor;
  const lightBg = await page.evaluate(bgOf);
  await page.emulateMedia({ colorScheme: 'dark' });
  await sleep(250);
  const darkBg = await page.evaluate(bgOf);
  const dark = await page.evaluate(qaCollect, { lite: true, sampleMark: true });
  R.v['390-dark'] = slimVariant(dark);
  R.v['390-dark'].samples = await sampleTexts(page, dark.texts, opts.maxSamples);
  if (axe.code && opts.axe) R.axe['390-dark'] = await runAxe(page, axe.code);
  await page.emulateMedia({ colorScheme: 'light' });
  const toggleBg = await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark'); const b = getComputedStyle(document.body || document.documentElement).backgroundColor; document.documentElement.removeAttribute('data-theme'); return b; });
  R.darkMode = { light: lightBg, dark: darkBg, toggle: toggleBg };
  await sleep(150);
  if (axe.code && opts.axe) R.axe['390-light'] = await runAxe(page, axe.code);
  // live ticks: compare numbers after a few seconds
  const waited = Date.now() - t0;
  if (waited < 3500) await sleep(3500 - waited);
  const after = await page.evaluate(qaCollect, { numbers: true, lite: false });
  const a0 = new Set(before.numbers || []);
  R.ticks = (after.numbers || []).filter((x) => !a0.has(x) && (before.numbers || []).some((y) => y.split('|')[0] === x.split('|')[0])).slice(0, 5);
  // first screen at 390 x 664
  await page.setViewportSize({ width: 390, height: 664 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);
  R.firstScreen = await page.evaluate(qaFirstScreen);
  await ctx.close();
}

/** 320 and 1440: layout checks in light and dark; 1440 also axe, focus rings and press state. */
async function widthPass(browser, url, w, opts, axe, R) {
  const ctx = await newCtx(browser, w, opts);
  const rec = { allowed: new Set(), blocked: new Set() };
  await ctx.addInitScript({ content: '(' + qaInit.toString() + ')({})' });
  await routeOutside(ctx, new URL(url), opts.allowHosts, rec);
  const page = await ctx.newPage();
  await goto(page, url, opts.timeout);
  await sleep(400);
  for (const theme of opts.themes) {
    await page.emulateMedia({ colorScheme: theme });
    await sleep(200);
    const d = await page.evaluate(qaCollect, { lite: true, sampleMark: true });
    const key = w + '-' + theme;
    R.v[key] = slimVariant(d);
    R.v[key].samples = await sampleTexts(page, d.texts, opts.maxSamples);
    if (w >= 1024 && axe.code && opts.axe) R.axe[key] = await runAxe(page, axe.code);
  }
  await page.emulateMedia({ colorScheme: 'light' });
  if (w >= 1024) {
    // focus rings on the first keyboard stops
    R.focus = [];
    await page.evaluate(() => { window.scrollTo(0, 0); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      const f = await page.evaluate(qaFocusState).catch(() => null);
      if (f) R.focus.push(f);
    }
    // press state on the first primary button (CSS :active forced through the DevTools protocol)
    try {
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
      const doc = await cdp.send('DOM.getDocument', { depth: -1 });
      const q = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '.btn--primary' });
      if (q.nodeId) {
        const read = () => page.evaluate(() => { const b = document.querySelector('.btn--primary'); const s = getComputedStyle(b); return [s.transform, s.boxShadow, s.backgroundColor, s.translate, s.top].join('|'); });
        const a = await read();
        await cdp.send('CSS.forcePseudoState', { nodeId: q.nodeId, forcedPseudoClasses: ['active'] });
        await sleep(300);
        const b = await read();
        await cdp.send('CSS.forcePseudoState', { nodeId: q.nodeId, forcedPseudoClasses: [] });
        R.press = { found: true, changes: a !== b };
      } else R.press = { found: false };
    } catch (e) { R.press = { found: false, note: firstLine(e) }; }
  }
  await ctx.close();
}

async function motionPass(browser, url, opts, R) {
  const ctx = await newCtx(browser, 390, opts, { reducedMotion: 'reduce' });
  await routeOutside(ctx, new URL(url), opts.allowHosts, { allowed: new Set(), blocked: new Set() });
  const page = await ctx.newPage();
  await goto(page, url, opts.timeout);
  await sleep(1500);
  const m1 = await page.evaluate(qaMotion);
  await sleep(700);
  const m2 = await page.evaluate(qaMotion);
  R.motion = { anims: m2.anims.filter((a) => m1.anims.indexOf(a) >= 0), videos: m2.videos };
  await ctx.close();
}

async function perfPass(browser, url, opts, R) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'light', serviceWorkers: 'block', locale: 'en-US', timezoneId: 'America/New_York' });
  await ctx.addInitScript({ content: '(' + qaInit.toString() + ')({})' });
  await routeOutside(ctx, new URL(url), opts.allowHosts, { allowed: new Set(), blocked: new Set() });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  if (opts.throttle) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: THROTTLE_4G.latency, downloadThroughput: THROTTLE_4G.down * 1024 / 8, uploadThroughput: THROTTLE_4G.up * 1024 / 8 });
  await page.goto(url, { waitUntil: 'load', timeout: opts.timeout * 2 });
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await sleep(1500);
  const q = await page.evaluate(() => window.__qa);
  // CLS: largest session window (1 s gap, 5 s cap)
  let cls = 0, cur = 0, start = -1, last = -1;
  for (const [t, v] of q.shifts) {
    if (start < 0 || t - last > 1000 || t - start > 5000) { start = t; cur = 0; }
    cur += v; last = t; cls = Math.max(cls, cur);
  }
  const fcp = q.fcp || 0;
  const tbt = q.long.filter(([t]) => t >= fcp).reduce((s, [, d]) => s + Math.max(0, d - 50), 0);
  R.perf = { throttle: opts.throttle ? '4g' : 'none', lcp: q.lcp ? Math.round(q.lcp) : null, lcpEl: q.lcpEl, cls: Math.round(cls * 1000) / 1000, tbt: Math.round(tbt), fcp: Math.round(fcp) };
  await ctx.close();
}

async function sharePass(browser, url, opts, R) {
  const base = new URL(url);
  const ctx = await newCtx(browser, 390, opts);
  await ctx.addInitScript({ content: '(' + qaInit.toString() + ')(' + JSON.stringify({ share: true, site: QA_SITE }) + ')' });
  await routeOutside(ctx, base, opts.allowHosts, { allowed: new Set(), blocked: new Set() });
  const page = await ctx.newPage();
  await goto(page, url, opts.timeout);
  await sleep(500);
  const found = [];
  const shareUrl = await page.evaluate(() => (window.YSD && YSD.share && typeof YSD.share.url === 'function') ? YSD.share.url() : null).catch(() => null);
  found.push(...(await page.evaluate(qaShareLinks)));
  const n = await page.evaluate(() => document.querySelectorAll('[data-share]').length);
  for (let i = 0; i < Math.min(n, 6); i++) {
    try {
      const h = await page.$$('[data-share]');
      if (!h[i] || !(await h[i].isVisible())) continue;
      await h[i].click({ timeout: 2000, noWaitAfter: true });
      await sleep(350);
      found.push(...(await page.evaluate(qaShareLinks)));
      await page.keyboard.press('Escape').catch(() => {});
    } catch (e) { /* not clickable */ }
  }
  const q = await page.evaluate(() => window.__qa || { shares: [], copies: [] });
  for (const s of q.shares) found.push({ where: 'navigator.share', payload: s });
  for (const c of q.copies) found.push({ where: 'clipboard', payload: c });
  const bad = [];
  const local = new RegExp('^(?:localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0|\\[::1\\]|' + base.hostname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '|(?:www\\.)?youngsemdems\\.com)(?::\\d+)?$', 'i');
  const urlsIn = (t) => (String(t).match(/(?:https?|file):\/\/[^\s"'<>)]*|\b(?:localhost|127\.0\.0\.1):\d+[^\s"'<>)]*/gi) || []);
  const hostOf = (u) => { if (/^file:/i.test(u)) return 'localhost'; try { return new URL(/^[a-z]+:\/\//i.test(u) ? u : 'http://' + u).host; } catch (e) { return ''; } };
  const seen = new Set();
  for (const f of found) {
    if (!urlsIn(f.payload).some((u) => local.test(hostOf(u)))) continue;
    const k = f.where + f.payload;
    if (seen.has(k)) continue;
    seen.add(k);
    bad.push(f);
  }
  R.share = { shareUrl, checked: found.length, bad: bad.slice(0, 6), siteUrl: QA_SITE };
  // invite landing (B20)
  if (R.dom && R.dom.landing) {
    const sep = url.indexOf('?') >= 0 ? '&' : '?';
    const e = R.dom.rsvpId ? '&e=' + encodeURIComponent(R.dom.rsvpId) : '';
    await goto(page, url + sep + 'ref=QATEST7&from=Kira' + e, opts.timeout);
    await sleep(500);
    const l = await page.evaluate(() => { const el = document.querySelector('[data-invite-landing]'); if (!el) return null; const s = getComputedStyle(el); return { visible: !el.hidden && s.display !== 'none' && el.getBoundingClientRect().height > 0, text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120) }; });
    const ref = await page.evaluate(() => (window.YSD && YSD.share && YSD.share.ref) ? YSD.share.ref() : null).catch(() => null);
    R.landing = { landing: l, ref };
  }
  await ctx.close();
}

function slimVariant(d) {
  const small = d.texts.filter((t) => t.fs < 11.95).map((t) => ({ sel: t.sel, text: t.text, fs: Math.round(t.fs * 10) / 10 }));
  const low = d.texts.filter((t) => t.ratio != null && !t.disabled && !t.logo && t.ratio < (t.large ? 3 : 4.5)).map((t) => ({ sel: t.sel, text: t.text, ratio: Math.round(t.ratio * 100) / 100, need: t.large ? 3 : 4.5 }));
  const ns = d.texts.filter((t) => t.nonsolid || t.overMedia).map((t) => ({ sel: t.sel, text: t.text, why: t.nonsolid ? (typeof t.nonsolid === 'string' ? t.nonsolid : 'background') + ' on ' + t.nonsolidAt : 'over ' + t.overMedia }));
  return { vw: d.vw, scrollW: d.scrollW, overflow: d.overflow, small, targets: d.targets, low, nonsolid: ns, texts: d.texts.length };
}

// ------------------------------------------------------------------------------------------
// Scoring
// ------------------------------------------------------------------------------------------

const EN_WORDS = new Set('the and you your with for this that what when where who are is was will from have has not but all can get how more see into just our we us its on in at of to be or an my me by up out now new here there their they them next first time day week join free about events event sign send share friend friends going read learn privacy policy home menu close open back skip content main vote voting check make bring save seat details see maybe'.split(' '));
const ES_WORDS = new Set('el la los las de del y que en un una para con por tu tus es son más se al lo como qué cuándo dónde nos te su sus este esta estos gratis únete votar evento eventos amigo amigos hoy semana política condado ya muy sin sobre también hay mira guarda lugar boleta correo inscríbete'.split(' '));
const EN_SINGLE = new Set(['join', 'join free', 'menu', 'close', 'home', 'events', 'vote', 'share', 'next', 'back', 'skip to content', 'search', 'submit', 'send', 'read more', 'learn more', 'about', 'privacy', "i'm in", 'maybe', "can't", 'details', 'copy link', 'save image', 'start', 'done', 'cancel', 'continue', 'see all', 'more', 'open menu', 'close menu', 'dismiss', 'got it']);
function englishLeft(text) {
  let t = String(text || '');
  t = t.replace(/https?:\/\/\S+|\S+@\S+\.\S+/g, ' ');
  for (const w of es.NEUTRAL.slice().sort((a, b) => b.length - a.length)) t = t.split(w).join(' ');
  const words = t.toLowerCase().match(/[\p{L}']+/gu) || [];
  if (!words.length) return false;
  const phrase = words.join(' ');
  if (words.length <= 3 && EN_SINGLE.has(phrase)) return true;
  let en = 0, esn = 0;
  for (const w of words) { if (EN_WORDS.has(w)) en++; if (ES_WORDS.has(w)) esn++; }
  return (en >= 2 && esn === 0) || (en >= 3 && en > esn * 3);
}

const DEMO_COUNT = /(?:^|[^\d$])(\d[\d,.]*\s*[kKmM]?\+?)\s*(?:people\s+)?(going|attending|members?|rsvps?|rsvp'd|joined|signed up|volunteers|views?|likes?|followers|shares|asistentes|van|vamos|miembros|inscritos|se unieron|voluntarios|vistas|reproducciones|seguidores|me gusta)\b/i;
const VIEW_COUNT = /\b\d[\d,.]*\s*[kKmM]?\s*(views|vistas|visualizaciones|reproducciones|plays)\b/i;

function score(pageRel, R, opts, rules) {
  const tg = targetsFor(opts.targets, pageRel);
  const isEs = pageRel.startsWith('es/');
  const rows = {};
  const set = (id, s, result, details) => { rows[id] = { id, gate: GATES.has(id), score: s, result, details: details || [] }; };
  const V = R.v || {};
  const variants = Object.keys(V);
  // Findings from every width and theme, merged by element: "at" lists where each one shows up.
  const all = (fn) => {
    const m = new Map();
    for (const k of variants) for (const x of (fn(V[k]) || [])) {
      const key = (x.sel || '') + '|' + (x.text || '');
      if (m.has(key)) m.get(key).at += ', ' + k; else m.set(key, Object.assign({}, x, { at: k }));
    }
    return Array.from(m.values());
  };
  const dom = R.dom || {};
  const raw = R.rawHtml || '';
  const head = og.headInfo(raw);

  // ---- voice rules on rendered text
  const pageLang = isEs ? 'es' : 'en';
  const vHits = [];
  const seenHit = new Set();
  const screens = {};
  for (const b of dom.blocks || []) {
    const lang = b.lang || pageLang;
    const hits = voice.lintText(b.text, { lang, scope: 'html', serious: b.serious, letter: b.letter, noEmoji: b.noEmoji, countBangs: false }, rules);
    for (const h of hits) { const k = h.rule + '|' + h.match + '|' + h.excerpt; if (!seenHit.has(k)) { seenHit.add(k); vHits.push(Object.assign({ sel: b.sel }, h)); } }
    const s = screens[b.screen] = screens[b.screen] || { bangs: 0, serious: false, sel: b.sel };
    s.bangs += (b.own.match(/!/g) || []).length;
    s.serious = s.serious || b.serious;
  }
  for (const a of dom.attrs || []) {
    for (const h of voice.lintText(a.text, { lang: a.lang || pageLang, scope: 'html', noEmoji: true }, rules)) { const k = h.rule + '|' + h.match + '|' + h.excerpt; if (!seenHit.has(k)) { seenHit.add(k); vHits.push(Object.assign({ sel: a.sel + ' [' + a.attr + ']' }, h)); } }
  }
  for (const k of Object.keys(screens)) {
    const s = screens[k];
    if (s.serious && s.bangs) vHits.push({ rule: 'serious-exclamation', severity: 'error', gate: 'B26', match: '!', excerpt: s.sel, sel: s.sel });
    else if (s.bangs > 1) vHits.push({ rule: 'exclamations', severity: 'error', gate: 'B26', match: s.bangs + ' x !', excerpt: s.sel, sel: s.sel });
  }
  const hitsFor = (pred) => vHits.filter(pred).map((h) => ({ sel: h.sel, text: h.rule + ': "' + h.match + '" ' + (h.excerpt || '') }));
  const errGate = (g) => vHits.filter((h) => h.gate === g && h.severity === 'error');

  // ---- N1 no AI
  const ai = hitsFor((h) => h.rule === 'ai-features').concat((R.net && R.net.ai || []).map((u) => ({ text: 'request to ' + u })));
  set('N1', ai.length ? 0 : 2, ai.length ? ai.length + ' AI feature(s) or LLM requests' : 'no assistant, chatbot or LLM request', ai);

  // ---- N2 names and ages
  const n2 = hitsFor((h) => h.gate === 'N2' && h.severity === 'error');
  set('N2', n2.length ? 0 : 2, n2.length ? n2.length + ' wrong name or age wording' : 'real name, ages 14 to 39', n2);

  // ---- B30 honest proof
  const demoOn = dom.demoMode !== false;
  const b30 = [];
  if (demoOn) {
    for (const d of dom.demoEls || []) b30.push({ sel: d.sel, text: '[data-demo] without a DEMO label: ' + d.text });
    for (const b of dom.blocks || []) {
      if (!b.visible || b.real || b.countdown) continue;
      const m = DEMO_COUNT.exec(b.own);
      if (m && !/DEMO/.test(b.text) && !b.demoScope) b30.push({ sel: b.sel, text: 'unlabeled count: "' + m[0].trim() + '"' });
    }
    if (!dom.banner) b30.push({ text: 'no .demo-banner on the page' });
    else if (!dom.banner.visible || !dom.banner.demo) b30.push({ text: 'demo banner hidden or missing the word DEMO' });
  }
  for (const b of dom.blocks || []) { const m = VIEW_COUNT.exec(b.own); if (m) b30.push({ sel: b.sel, text: 'view count: "' + m[0] + '"' }); }
  for (const t of R.ticks || []) b30.push({ text: 'number changed by itself: ' + t.split('|')[0] });
  for (const h of errGate('B30')) b30.push({ sel: h.sel, text: h.rule + ': "' + h.match + '"' });
  set('B30', b30.length ? 0 : 2, b30.length ? b30.length + ' honesty problem(s)' : (demoOn ? 'demo items labelled, no ticks, no view counts' : 'live mode: no demo labels needed'), b30);

  // ---- B33 brand safety
  const b33 = hitsFor((h) => h.gate === 'B33' && h.severity === 'error');
  for (const s of dom.stock || []) {
    if (!s.tagged) b33.push({ sel: s.sel, text: 'stock photo without a visible "Stock photo · not members" tag' });
    if (!s.credit) b33.push({ sel: s.sel, text: 'stock photo without data-photographer and data-source' });
  }
  set('B33', b33.length ? 0 : 2, b33.length ? b33.length + ' brand-safety problem(s)' : 'no Native words, candidates, alcohol; stock tagged', b33);
  set('N3', (b33.length || b30.length) ? 0 : 2, (b33.length || b30.length) ? 'see B30 and B33' : 'clean', b33.concat(b30).slice(0, 8));

  // ---- accessibility measures
  const small = all((v) => v.small);
  const targets = all((v) => v.targets);
  const ov320 = (V['320-light'] || V['320-dark']) ? (V['320-light'] || V['320-dark']).overflow : [];
  const overflowAny = variants.filter((k) => V[k].scrollW > V[k].vw + 1).map((k) => ({ at: k, text: 'page is ' + V[k].scrollW + ' px wide at ' + V[k].vw + ' px' + (V[k].overflow[0] ? ', widest: ' + V[k].overflow[0].sel + ' (' + V[k].overflow[0].w + ' px)' : '') }));
  const axeRuns = Object.keys(R.axe || {});
  const axeBad = [];
  for (const k of axeRuns) for (const v of ((R.axe[k] && R.axe[k].serious) || [])) axeBad.push({ at: k, text: v.impact + ' ' + v.id + ' (' + v.nodes + '): ' + v.help, sel: v.targets[0] });
  const zoomOk = !/user-scalable\s*=\s*(no|0)/i.test(dom.viewport || '') && !(/maximum-scale\s*=\s*([\d.]+)/i.test(dom.viewport || '') && parseFloat(/maximum-scale\s*=\s*([\d.]+)/i.exec(dom.viewport)[1]) < 2);
  const focusBad = (R.focus || []).filter((f) => !f.ring);
  const motionBad = R.motion ? R.motion.anims.map((a) => ({ text: 'running under reduced motion: ' + a })).concat(R.motion.videos.map((v) => ({ text: 'video playing under reduced motion: ' + v }))) : [];
  const b31hard = [];
  small.forEach((s) => b31hard.push({ at: s.at, sel: s.sel, text: s.fs + ' px text: ' + s.text }));
  targets.forEach((t) => b31hard.push({ at: t.at, sel: t.sel, text: t.w + ' x ' + t.h + ' px target: ' + t.text }));
  overflowAny.forEach((o) => b31hard.push(o));
  axeBad.forEach((a) => b31hard.push(a));
  if (!zoomOk) b31hard.push({ text: 'zoom disabled in meta viewport: ' + dom.viewport });
  if (!dom.skipLink) b31hard.push({ text: 'no skip link (first focusable should be <a href="#main">)' });
  (dom.badInvalid || []).forEach((s) => b31hard.push({ sel: s, text: 'aria-invalid without a valid aria-describedby' }));
  const b31soft = [];
  if (!dom.statusRegion) b31soft.push({ text: 'no role="status" region for announcements' });
  if (dom.h1 !== 1) b31soft.push({ text: dom.h1 + ' visible h1 elements (want 1)' });
  focusBad.forEach((f) => b31soft.push({ sel: f.sel, text: 'no visible focus ring' }));
  const axeNote = opts.axe ? (axeRuns.length ? axeRuns.length + ' axe runs' : 'axe unavailable') : 'axe skipped';
  set('B31', b31hard.length ? 0 : b31soft.length ? 1 : 2, b31hard.length ? b31hard.length + ' problem(s): ' + [small.length && small.length + ' small text', targets.length && targets.length + ' small targets', overflowAny.length && 'overflow', axeBad.length && axeBad.length + ' axe serious', !zoomOk && 'zoom off', !dom.skipLink && 'no skip link'].filter(Boolean).join(', ') : (b31soft.length ? b31soft.map((x) => x.text).join('; ') : 'text 12+, targets 44+, reflow, ' + axeNote), b31hard.concat(b31soft));

  // ---- contrast and N5 (pixel samples)
  const lows = all((v) => v.low);
  const samples = all((v) => (v.samples && v.samples.sampled || []).map((x) => Object.assign({}, x, { text: x.text, key: x.sel + '|' + x.ratio })));
  const lowSamples = samples.filter((s) => s.ratio < s.need);
  const nonUniform = samples.filter((s) => !s.uniform);
  const unsampled = variants.reduce((n, k) => n + Math.max(0, ((V[k].samples && V[k].samples.candidates) || 0) - ((V[k].samples && V[k].samples.sampled.length) || 0)), 0);
  const contrastBad = lows.map((l) => ({ at: l.at, sel: l.sel, text: l.ratio + ':1 (need ' + l.need + '): ' + l.text })).concat(lowSamples.map((s) => ({ at: s.at, sel: s.sel, text: 'pixel-sampled ' + s.ratio + ':1 (need ' + s.need + ') ' + s.why + ': ' + s.text })));
  const bands = (dom.bands || []).length;
  const b8 = contrastBad.slice();
  if (tg.bands && bands < tg.bands) b8.push({ text: bands + ' saturated full-bleed blocks at 390 (need ' + tg.bands + ')' });
  set('B8', b8.length ? 0 : 2, b8.length ? (contrastBad.length ? contrastBad.length + ' low-contrast text' : '') + (tg.bands && bands < tg.bands ? (contrastBad.length ? '; ' : '') + bands + '/' + tg.bands + ' colour blocks' : '') : 'every pair 4.5:1 (3:1 large), ' + samples.length + ' pixel-sampled' + (tg.bands ? ', ' + bands + ' colour blocks' : ''), b8);
  // N5: text straight on a gradient or image (computed style), or over a photo/sticker with no
  // solid panel between them when the pixels under the glyphs are not one flat colour. A partial
  // fill (a marker swipe under a few words) is allowed; its contrast is checked under B8.
  const n5 = all((v) => v.nonsolid).filter((x) => /^(gradient|image|background) on /.test(x.why)).map((x) => ({ at: x.at, sel: x.sel, text: 'text straight on a ' + x.why + ': ' + x.text }));
  for (const sm of nonUniform) if (/^over /.test(sm.why) && !n5.some((x) => x.sel === sm.sel)) n5.push({ at: sm.at, sel: sm.sel, text: 'text ' + sm.why + ' with no solid panel (' + sm.spread + '% of pixels vary): ' + sm.text });
  set('N5', n5.length ? 0 : 2, n5.length ? n5.length + ' text block(s) on gradients, photos or patterns' : 'text sits on flat fills' + (unsampled ? ' (' + unsampled + ' candidates not sampled; raise --max-samples)' : ''), n5);

  // ---- N4
  const n4sum = [];
  if (small.length) n4sum.push(small.length + ' text under 12 px');
  if (targets.length) n4sum.push(targets.length + ' targets under 44 px');
  if (overflowAny.length) n4sum.push('horizontal overflow at ' + overflowAny.map((o) => o.at).join(', '));
  if (axeBad.length) n4sum.push(axeBad.length + ' axe serious/critical');
  if (contrastBad.length) n4sum.push(contrastBad.length + ' contrast failures');
  if (motionBad.length) n4sum.push(motionBad.length + ' motion under reduced motion');
  const n4 = [].concat(small.slice(0, 2).map((x) => ({ at: x.at, sel: x.sel, text: x.fs + ' px text' })), targets.slice(0, 2).map((x) => ({ at: x.at, sel: x.sel, text: x.w + ' x ' + x.h + ' px target' })), overflowAny.slice(0, 2), axeBad.slice(0, 2), contrastBad.slice(0, 2), motionBad);
  set('N4', n4sum.length ? 0 : 2, n4sum.length ? n4sum.join('; ') : '320/390/1440 clean, reduced motion respected', n4);

  // ---- B1, B3, B4, N6
  const net = R.net || { bytes: 0, requests: 0, fonts: [], video: [], json: [] };
  const budget = (tg.budgetKB || 500) * 1024, maxReq = tg.maxRequests || 30;
  const b1ok = net.bytes <= budget && net.requests <= maxReq;
  set('B1', b1ok ? 2 : 0, kb(net.bytes) + ' KB / ' + (tg.budgetKB || 500) + ' KB, ' + net.requests + ' / ' + maxReq + ' requests', b1ok ? [] : (net.top || []).map((t) => ({ text: kb(t.bytes) + ' KB ' + t.url })));
  const hostsBad = (R.hosts.blocked || []).concat(R.hosts.csp || []);
  const allowedUsed = R.hosts.allowed || [];
  set('B3', hostsBad.length ? 0 : allowedUsed.length > 1 ? 1 : 2, hostsBad.length ? 'not allowlisted: ' + hostsBad.join(', ') : allowedUsed.length + ' outside host' + (allowedUsed.length === 1 ? '' : 's') + (allowedUsed.length ? ' (' + allowedUsed.join(', ') + ')' : ''), hostsBad.map((h) => ({ text: 'request to ' + h })));
  const bigFonts = (net.fonts || []).filter((f) => f.raw > 60 * 1024 || f.bytes > 60 * 1024);
  const fontTotal = (net.fonts || []).reduce((s, f) => s + f.bytes, 0);
  const b4 = [];
  bigFonts.forEach((f) => b4.push({ text: kb(f.bytes) + ' KB font on the critical path: ' + f.url }));
  (dom.fontGate || []).forEach((s) => b4.push({ text: 'font gate rule: ' + s }));
  const b4soft = [];
  if ((dom.fontPreloads || 0) > 2) b4soft.push({ text: dom.fontPreloads + ' font preloads (max 2)' });
  if (fontTotal > 80 * 1024) b4soft.push({ text: kb(fontTotal) + ' KB of fonts in the first view (max 80)' });
  set('B4', b4.length ? 0 : b4soft.length ? 1 : 2, (net.fonts || []).length + ' font files, ' + kb(fontTotal) + ' KB, ' + (dom.fontPreloads || 0) + ' preloads' + (b4.length ? ' (problem)' : ''), b4.concat(b4soft));
  const perf = R.perf;
  let b2s = 'review', b2r = 'not measured (--no-throttle)';
  const b2d = [];
  if (perf) {
    const ok = perf.lcp != null && perf.lcp <= 2500 && perf.cls <= 0.05 && perf.tbt <= 150;
    b2s = ok ? 2 : 0;
    b2r = 'LCP ' + (perf.lcp != null ? (perf.lcp / 1000).toFixed(2) + ' s' : 'n/a') + ', CLS ' + perf.cls + ', TBT ' + perf.tbt + ' ms (' + perf.throttle + ')';
    if (perf.lcp == null || perf.lcp > 2500) b2d.push({ text: 'LCP ' + (perf.lcp == null ? 'not reported' : (perf.lcp / 1000).toFixed(2) + ' s') + ' (max 2.5 s), element ' + perf.lcpEl });
    if (perf.cls > 0.05) b2d.push({ text: 'CLS ' + perf.cls + ' (max 0.05)' });
    if (perf.tbt > 150) b2d.push({ text: 'TBT ' + perf.tbt + ' ms (max 150)' });
    if (!opts.throttle) b2r += ', unthrottled: not a launch number';
  }
  set('B2', b2s, b2r, b2d);
  const n6 = [];
  if (!b1ok) n6.push({ text: 'first view ' + kb(net.bytes) + ' KB over ' + (tg.budgetKB || 500) + ' KB' });
  if (perf && b2s === 0) n6.push(...b2d);
  if (dom.moduleScripts) n6.push({ text: dom.moduleScripts + ' ES module script(s); classic scripts only' });
  if (dom.inlineScripts) n6.push({ text: dom.inlineScripts + ' inline <script> (CSP script-src self)' });
  (net.json || []).forEach((u) => n6.push({ text: 'fetches local data: ' + u }));
  set('N6', n6.length ? 0 : 2, n6.length ? n6.map((x) => x.text).slice(0, 2).join('; ') : 'classic scripts, no local fetches, within budget', n6);

  // ---- B6 first screen
  const fsr = R.firstScreen || {};
  const b6d = [];
  if (!fsr.primary) b6d.push({ text: 'no .btn--primary fully visible at 390 x 664 (' + (fsr.primaryCandidates || 0) + ' on the page)' });
  if (!fsr.secondary) b6d.push({ text: 'no second action fully visible at 390 x 664' + (fsr.secondaryHalf ? ' ("' + fsr.secondaryHalf + '" is cut off)' : '') });
  (fsr.overlays || []).forEach((o) => b6d.push({ text: 'overlay on first screen: ' + o }));
  set('B6', !b6d.length ? 2 : (fsr.primary && fsr.secondaryHalf && !(fsr.overlays || []).length) ? 1 : 0, fsr.primary ? '"' + fsr.primary + '"' + (fsr.secondary ? ' + "' + fsr.secondary + '"' : '') + ((fsr.overlays || []).length ? ', overlay' : '') : 'no primary action on the first screen', b6d);

  // ---- B7 people photo (home)
  if (tg.peopleWithin) {
    const ph = (dom.photos || []).filter((p) => p.top < tg.peopleWithin);
    const tagged = ph.filter((p) => p.tagged);
    set('B7', tagged.length ? 2 : ph.length ? 1 : 0, ph.length ? ph.length + ' photo(s) above ' + tg.peopleWithin + ' px' + (tagged.length ? ', stock-tagged' : ', not tagged') + (ph.some((p) => !p.loaded) ? ' (some did not load here)' : '') : 'no photo in the first ' + tg.peopleWithin + ' px', ph.map((p) => ({ sel: p.sel, text: 'top ' + p.top + ' px' })));
  }

  // ---- B9, B10, page height
  for (const p of R.positions || []) {
    if (p.top == null) set(p.id, 0, p.label + ': not found (add data-qa="' + (p.id === 'B9' ? 'mail-ballot' : 'reel') + '")');
    else set(p.id, p.top <= p.maxTop ? 2 : 0, p.label + ' at ' + p.top + ' px (max ' + p.maxTop + ')', [{ sel: p.sel, text: 'top ' + p.top }]);
  }
  if (tg.maxHeight) rows.height = { id: 'H', gate: false, score: R.height <= tg.maxHeight ? 2 : 0, result: 'page height ' + R.height + ' px at 390 (max ' + tg.maxHeight + ')', details: [] };

  // ---- B16 share layer (static tags), B25 / N8 Spanish
  const missingMeta = [];
  if (!/<meta[^>]+property=["']og:title["']/i.test(raw)) missingMeta.push('og:title');
  if (!/<meta[^>]+property=["']og:description["']/i.test(raw)) missingMeta.push('og:description');
  if (!head.ogImage) missingMeta.push('og:image');
  if (!head.ogImageAlt) missingMeta.push('og:image:alt');
  if (!head.twitterCard) missingMeta.push('twitter:card');
  const b16d = missingMeta.map((m) => ({ text: 'no static ' + m })).concat(dom.shareButtons ? [] : [{ text: 'no [data-share] button' }]);
  set('B16', !b16d.length ? 2 : (missingMeta.length < 5 || dom.shareButtons) ? 1 : 0, b16d.length ? b16d.map((x) => x.text).join(', ') : 'static OG + twitter tags, ' + dom.shareButtons + ' share button(s)', b16d);
  const needsTwin = !/(^|\/)styleguide\.html$/.test(pageRel) && !/data-es\s*=\s*["']?skip/i.test(raw.slice(0, 3000));
  const n8 = [];
  const hreflang = (raw.match(/<link[^>]+hreflang=["']([\w-]+)["']/gi) || []).map((s) => /hreflang=["']([\w-]+)["']/i.exec(s)[1].toLowerCase());
  const missingHl = ['en', 'es', 'x-default'].filter((l) => hreflang.indexOf(l) < 0);
  if (isEs) {
    if (!/^es/i.test(dom.lang || '')) n8.push({ text: '<html lang="' + dom.lang + '"> on a Spanish page' });
    for (const b of dom.blocks || []) {
      if (b.tn || (b.lang && b.lang !== 'es')) continue;
      if (englishLeft(b.own)) n8.push({ sel: b.sel, text: 'English left: "' + b.own.slice(0, 70) + '"' });
    }
    for (const a of dom.attrs || []) {
      if (a.tn || (a.lang && a.lang !== 'es')) continue;
      if (englishLeft(a.text)) n8.push({ sel: a.sel, text: 'English left in ' + a.attr + ': "' + a.text.slice(0, 60) + '"' });
    }
  } else if (needsTwin) {
    if (!fs.existsSync(path.join(opts.root, 'es', pageRel))) n8.push({ text: 'es/' + pageRel + ' does not exist: run node tools/make_es.js ' + pageRel });
    if (!/^en/i.test(dom.lang || '')) n8.push({ text: '<html lang="' + dom.lang + '">' });
  }
  const twinsOk = !n8.length;
  set('N8', n8.length ? 0 : 2, n8.length ? n8.length + ' Spanish problem(s)' : isEs ? 'no English left, lang="es"' : needsTwin ? 'es/' + pageRel + ' exists' : 'no twin needed', n8);
  const b25d = n8.slice();
  if (needsTwin && missingHl.length && !/(^|\/)(404|offline)\.html$/.test(pageRel)) b25d.push({ text: 'hreflang missing: ' + missingHl.join(', ') + ' (make_es.js writes them)' });
  set('B25', !twinsOk ? 0 : b25d.length ? 1 : 2, !twinsOk ? 'see N8' : b25d.length ? b25d.map((x) => x.text).join('; ') : 'twin, hreflang pair, lang', b25d);

  // ---- N9 footer and banner
  const n9 = [];
  const ft = dom.footer;
  if (!ft) n9.push({ text: 'no <footer>' });
  else {
    if (!(isEs ? /pagado por|pd\.? pol/i : /paid for by|pd\.? pol\.? adv/i).test(ft.text)) n9.push({ text: 'footer has no "' + (isEs ? 'Pagado por' : 'Paid for by') + '" line' });
    if (demoOn && !ft.demoVisible) n9.push({ text: 'footer has no visible DEMO label' });
    if (!(isEs ? /no es un sitio oficial|no es el sitio oficial/i : /not an official site|not the official site/i).test(ft.text)) n9.push({ text: 'footer has no not-official line' });
  }
  if (demoOn && (!dom.banner || !dom.banner.visible)) n9.push({ text: 'no visible demo banner' });
  set('N9', n9.length ? 0 : 2, n9.length ? n9.map((x) => x.text).join('; ') : 'paid-for line, DEMO, not-official line, banner', n9);

  // ---- N10 share URLs
  const sh = R.share;
  if (sh) {
    const n10 = sh.bad.map((b) => ({ text: b.where + ': ' + b.payload.slice(0, 140) }));
    set('N10', n10.length ? 0 : 2, n10.length ? n10.length + ' share link(s) built from the origin, localhost or a hard-coded domain' : sh.checked + ' share payload(s) use ' + QA_SITE + ' (site.url)', n10);
  } else set('N10', 'review', 'share pass skipped (--no-share)');

  // ---- B20 landing
  if (R.landing) {
    const l = R.landing.landing;
    const ok = l && l.visible && /Kira/.test(l.text) && R.landing.ref === 'QATEST7';
    set('B20', ok ? 2 : l && l.visible ? 1 : 0, ok ? 'landing shows "' + l.text.slice(0, 50) + '", ref captured' : !l ? 'no [data-invite-landing]' : !l.visible ? '?ref&from&e did not show the landing banner' : 'landing visible but ' + (/Kira/.test(l.text) ? 'ref not captured' : 'no sender name'), []);
  }

  // ---- B21 video
  const vids = (dom.videos || []);
  if (vids.length || (net.video || []).length) {
    const b21 = [];
    vids.forEach((v) => { if (!v.poster) b21.push({ sel: v.sel, text: 'no poster' }); if (!v.muted) b21.push({ sel: v.sel, text: 'not muted by default' }); if (v.preload === 'auto') b21.push({ sel: v.sel, text: 'preload="auto"' }); });
    (net.video || []).forEach((u) => b21.push({ text: 'video downloaded in the first view: ' + u }));
    (R.motion ? R.motion.videos : []).forEach((v) => b21.push({ text: 'plays under reduced motion: ' + v }));
    set('B21', b21.length ? 0 : 2, b21.length ? b21.length + ' video problem(s)' : vids.length + ' video(s): posters, muted, no preload, no reduced-motion autoplay', b21);
  }

  // ---- B24 / B26 voice, B37 freshness
  const b24 = errGate('B24');
  set('B24', b24.length ? 0 : 'review', b24.length ? b24.length + ' microcopy rule hit(s)' : 'no rule hits; personality needs a person', b24.map((h) => ({ sel: h.sel, text: h.rule + ': "' + h.match + '"' })));
  const b26e = errGate('B26'), b26w = vHits.filter((h) => h.gate === 'B26' && h.severity === 'warning');
  set('B26', b26e.length ? 0 : b26w.length ? 1 : 2, b26e.length ? b26e.length + ' error(s)' + (b26w.length ? ', ' + b26w.length + ' warning(s)' : '') : b26w.length ? b26w.length + ' warning(s)' : 'clean', b26e.concat(b26w).map((h) => ({ sel: h.sel, text: h.severity + ' ' + h.rule + ': "' + h.match + '" ' + (h.excerpt || '') })));
  const b37 = errGate('B37');
  set('B37', b37.length ? 0 : 2, b37.length ? b37.length + ' leftover(s)' : 'no leftovers or unfilled templates', b37.map((h) => ({ sel: h.sel, text: '"' + h.match + '" ' + (h.excerpt || '') })));

  // ---- B27, B28, B29
  if (R.motion) {
    const pressNote = R.press ? (R.press.found ? (R.press.changes ? 'primary button presses' : 'no :active change on .btn--primary') : 'no .btn--primary') : 'press not checked';
    set('B27', motionBad.length ? 0 : R.press && R.press.found && R.press.changes ? 2 : 1, (motionBad.length ? motionBad.length + ' running under reduced motion' : '0 running under reduced motion') + ', ' + pressNote, motionBad);
  }
  const long = dom.longAnims || [];
  set('B28', long.length && !dom.pauseControl ? 0 : long.length ? 2 : 'review', long.length ? long.length + ' long/looping animation(s)' + (dom.pauseControl ? ', Pause control present' : ', no Pause control') : 'no looping motion; kinetic H1 needs a person', long.map((a) => ({ text: a })));
  const dm = R.darkMode || {};
  const mediaDark = dm.light && dm.dark && dm.light !== dm.dark, toggleDark = dm.light && dm.toggle && dm.light !== dm.toggle;
  set('B29', mediaDark && toggleDark ? 2 : mediaDark || toggleDark ? 1 : 0, mediaDark && toggleDark ? 'media query and data-theme toggle (' + dm.light + ' / ' + dm.dark + ')' : mediaDark ? 'media query only, no [data-theme] toggle' : toggleDark ? 'toggle only, no media query' : 'no dark theme detected', []);

  // ---- review rows
  for (const id of Object.keys(REVIEW)) if (!rows[id]) set(id, 'review', 'review (' + REVIEW[id] + ')');
  for (const [id] of CHECKS) if (!rows[id]) set(id, 'n/a', 'not applicable to this page');
  return rows;
}

// ------------------------------------------------------------------------------------------
// Run
// ------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const o = { root: ROOT, pages: [], all: false, widths: [320, 390, 1440], themes: ['light', 'dark'], axe: true, throttle: true, share: true, perf: true,
    targetsFile: '', allowHosts: ['images.unsplash.com'], concurrency: 2, out: path.join(CACHE, 'qa_report.json'), json: false, quiet: false, timeout: 30000, maxSamples: 30, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) throw new Error(a + ' needs a value'); return argv[++i]; };
    if (a === '--root') o.root = path.resolve(val());
    else if (a === '--pages') o.pages = o.pages.concat(val().split(',').map((s) => s.trim()).filter(Boolean));
    else if (a === '--all') o.all = true;
    else if (a === '--widths') o.widths = val().split(',').map((s) => parseInt(s, 10)).filter(Boolean);
    else if (a === '--themes') o.themes = val().split(',').map((s) => s.trim()).filter((s) => s === 'light' || s === 'dark');
    else if (a === '--no-axe') o.axe = false;
    else if (a === '--no-throttle') o.throttle = false;
    else if (a === '--no-perf') o.perf = false;
    else if (a === '--no-share') o.share = false;
    else if (a === '--targets') o.targetsFile = path.resolve(val());
    else if (a === '--allow-hosts') o.allowHosts = val().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--concurrency') o.concurrency = Math.max(1, parseInt(val(), 10) || 2);
    else if (a === '--out') o.out = path.resolve(val());
    else if (a === '--json') o.json = true;
    else if (a === '--quiet') o.quiet = true;
    else if (a === '--timeout') o.timeout = parseInt(val(), 10) || 30000;
    else if (a === '--max-samples') o.maxSamples = Math.max(0, parseInt(val(), 10) || 0);
    else if (a === '-h' || a === '--help') o.help = true;
    else if (a.startsWith('--')) throw new Error('unknown option ' + a);
    else o.pages.push(a);
  }
  if (o.widths.indexOf(390) < 0) o.widths.push(390);
  if (!o.themes.length) o.themes = ['light'];
  return o;
}

async function checkPage(browser, base, pageRel, opts, axe, rules) {
  const url = base + encodeURI(pageRel);
  const R = { page: pageRel, url, v: {}, axe: {}, errors: [] };
  R.rawHtml = fs.readFileSync(path.join(opts.root, pageRel), 'utf8');
  const started = Date.now();
  try { await mainPass(browser, url, pageRel, opts, axe, R); } catch (e) { R.errors.push('main pass: ' + firstLine(e)); }
  for (const w of opts.widths.filter((x) => x !== 390)) { try { await widthPass(browser, url, w, opts, axe, R); } catch (e) { R.errors.push(w + ' pass: ' + firstLine(e)); } }
  try { await motionPass(browser, url, opts, R); } catch (e) { R.errors.push('reduced-motion pass: ' + firstLine(e)); }
  if (opts.perf) { try { await perfPass(browser, url, opts, R); } catch (e) { R.errors.push('4g pass: ' + firstLine(e)); } }
  if (opts.share) { try { await sharePass(browser, url, opts, R); } catch (e) { R.errors.push('share pass: ' + firstLine(e)); } }
  R.rows = score(pageRel, R, opts, rules);
  R.seconds = Math.round((Date.now() - started) / 100) / 10;
  const rows = Object.values(R.rows);
  R.gatesFailed = rows.filter((r) => r.gate && r.score === 0).map((r) => r.id);
  if (R.errors.length && !R.dom) R.gatesFailed.push('LOAD');
  const measured = rows.filter((r) => /^B/.test(r.id) && typeof r.score === 'number');
  R.points = measured.reduce((s, r) => s + r.score, 0);
  R.possible = measured.length * 2;
  R.reviewCount = rows.filter((r) => /^B/.test(r.id) && r.score === 'review').length;
  delete R.rawHtml;
  if (R.dom) R.dom = { lang: R.dom.lang, bands: R.dom.bands, photos: R.dom.photos, firstScreen: R.firstScreen };
  return R;
}

async function run(opts) {
  const root = opts.root;
  let targets = JSON.parse(JSON.stringify(DEFAULT_TARGETS));
  if (opts.targetsFile) {
    const t = JSON.parse(fs.readFileSync(opts.targetsFile, 'utf8'));
    for (const k of Object.keys(t)) targets[k] = Object.assign({}, targets[k] || {}, t[k]);
  }
  opts.targets = targets;
  let pages = opts.pages.slice();
  if (opts.all || !pages.length) pages = Array.from(new Set(pages.concat(walkPages(root))));
  pages = pages.map((p) => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, ''));
  const report = { tool: 'tools/qa.js', generatedAt: new Date().toISOString(), root, widths: opts.widths, themes: opts.themes, throttle: opts.throttle ? '4g' : 'none', axe: null, pages: [], notes: [] };
  const missing = pages.filter((p) => !fs.existsSync(path.join(root, p)));
  if (missing.length) { report.notes.push('not found: ' + missing.join(', ')); report.badInput = true; }
  pages = pages.filter((p) => fs.existsSync(path.join(root, p)));
  if (!pages.length) { report.notes.push('no pages to check yet'); return report; }
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) { throw new Error('Playwright is not installed (require("playwright") failed)'); }
  const { createServer, parseHeadersFile } = require('./check_site');
  let headers = null;
  try { if (fs.existsSync(path.join(root, '_headers'))) headers = parseHeadersFile(fs.readFileSync(path.join(root, '_headers'), 'utf8')); } catch (e) { report.notes.push('_headers not applied: ' + firstLine(e)); }
  const srv = createServer(root, { headers });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const axe = opts.axe ? await loadAxe() : { status: 'skipped', note: '--no-axe' };
  report.axe = { status: axe.status, note: axe.note || '', source: axe.source || '' };
  if (axe.status !== 'ready' && opts.axe) report.notes.push(axe.note);
  const rules = voice.loadRules();
  const browser = await chromium.launch();
  try {
    const queue = pages.slice();
    const results = {};
    const worker = async () => {
      while (queue.length) {
        const p = queue.shift();
        if (!opts.quiet && !opts.json) process.stderr.write('qa: ' + p + '\n');
        results[p] = await checkPage(browser, base, p, opts, axe, rules);
      }
    };
    await Promise.all(Array.from({ length: Math.min(opts.concurrency, pages.length) }, worker));
    report.pages = pages.map((p) => results[p]);
  } finally {
    await browser.close().catch(() => {});
    srv.close();
  }
  return report;
}

function printReport(report, opts) {
  const L = [];
  const when = new Date(report.generatedAt);
  L.push('qa.js · ' + when.toDateString() + ', ' + amPm(when) + ' · widths ' + report.widths.join('/') + ' · ' + report.themes.join('+') + ' · throttle ' + report.throttle + ' · axe ' + (report.axe ? report.axe.status : 'n/a'));
  for (const n of report.notes) L.push('note: ' + n);
  for (const p of report.pages) {
    L.push('');
    const gates = Object.values(p.rows).filter((r) => r.gate);
    const failed = p.gatesFailed;
    L.push(`${p.page}  ${failed.length ? 'FAIL ' + failed.length + ' GATE' + (failed.length > 1 ? 'S' : '') + ' (' + failed.join(', ') + ')' : 'all ' + gates.length + ' gates pass'}  ·  6b measured ${p.points}/${p.possible}  ·  ${p.reviewCount} for review  ·  ${p.seconds} s`);
    for (const e of p.errors) L.push('  error: ' + e);
    L.push('  ID   Gate Score   Check                               Result');
    const order = CHECKS.map((c) => c[0]).concat(['height']);
    for (const id of order) {
      const r = p.rows[id === 'height' ? 'height' : id];
      if (!r) continue;
      if (opts.quiet && (r.score === 'review' || r.score === 'n/a' || r.score === 2)) continue;
      const name = id === 'height' ? 'Page height' : (CHECKS.find((c) => c[0] === id) || [id, id])[1];
      const sc = typeof r.score === 'number' ? String(r.score) : r.score;
      const mark = r.gate && r.score === 0 ? '!' : ' ';
      L.push(`${mark} ${(id === 'height' ? 'H' : id).padEnd(4)} ${r.gate ? 'G' : ' '}    ${sc.padEnd(7)} ${name.padEnd(35)} ${r.result}`);
      if (typeof r.score === 'number' && r.score < 2) for (const d of r.details.slice(0, opts.quiet ? 3 : 5)) L.push(`              ${d.at ? '[' + d.at + '] ' : ''}${d.sel ? d.sel + ': ' : ''}${d.text}`);
    }
  }
  L.push('');
  L.push('Summary');
  L.push('  Page'.padEnd(34) + 'Gates   6b measured   Failed gates');
  for (const p of report.pages) {
    const g = Object.values(p.rows).filter((r) => r.gate);
    L.push('  ' + p.page.padEnd(32) + (String(g.length - p.gatesFailed.length) + '/' + g.length).padEnd(8) + (p.points + '/' + p.possible).padEnd(14) + (p.gatesFailed.join(', ') || '-'));
  }
  const bad = report.pages.filter((p) => p.gatesFailed.length).length;
  L.push(`qa: ${report.pages.length} pages, ${bad} with GATE failures`);
  return L.join('\n');
}

async function main(argv) {
  let opts;
  try { opts = parseArgs(argv); } catch (e) { console.error('qa: ' + e.message); return 2; }
  if (opts.help) {
    console.log('Usage: node tools/qa.js [--pages a.html,es/a.html | --all] [--widths 320,390,1440] [--themes light,dark] [--no-axe] [--no-throttle] [--no-perf] [--no-share] [--targets FILE] [--allow-hosts a,b] [--concurrency N] [--out FILE] [--json] [--quiet] [--max-samples N]');
    return 0;
  }
  let report;
  try { report = await run(opts); } catch (e) { console.error('qa crashed: ' + (e && e.stack || e)); return 2; }
  try { fs.mkdirSync(path.dirname(opts.out), { recursive: true }); fs.writeFileSync(opts.out, JSON.stringify(report, null, 2)); } catch (e) { /* read-only */ }
  if (opts.json) console.log(JSON.stringify(report, null, 2));
  else console.log(printReport(report, opts));
  if (report.badInput) return 2;
  return report.pages.some((p) => p.gatesFailed.length) ? 1 : 0;
}

if (require.main === module) main(process.argv.slice(2)).then((c) => { process.exitCode = c; });

module.exports = { run, main, parseArgs, score, englishLeft, ratio, lum, walkPages, DEFAULT_TARGETS, GATES, CHECKS, qaCollect, qaFirstScreen, QA_SITE };
