#!/usr/bin/env node
/**
 * tools/bench_compare.js: head-to-head metrics for our pages and competitor homepages.
 *
 * Loads each URL once, cold, in Playwright Chromium as a phone (390x844, touch, 2x pixels, Chrome
 * for Android user agent, light scheme, service workers blocked) and records:
 *   weight      transfer bytes and request count, by type (document, script, css, image, font,
 *               media, xhr, other), third-party requests and hosts
 *   speed       DOMContentLoaded, load, FCP, LCP and CLS (PerformanceObserver, CLS as the largest
 *               session window of shifts at or after first contentful paint), time until the first call
 *               to action is visible (the CTA poller starts at DOMContentLoaded so it never forces a
 *               layout of the unstyled page)
 *   first screen  distinct calls to action whose centre is visible in the first 390x844 screen,
 *               and how much of that screen a fixed overlay (pop-up, cookie banner) covers
 *   mobile      tap targets under 44x44 CSS px (whole page, links inside sentences exempt),
 *               horizontal overflow at 390 px
 *   a11y        <img> without alt, axe-core WCAG 2.x A/AA violations (colour contrast separately)
 *   features    Open Graph tags, dark mode (does prefers-color-scheme: dark change the background),
 *               language toggle (and Spanish), video, share affordances (Web Share, copy link,
 *               share intents, "Send it to the group chat" / "Mándalo al grupo"), sign-up form field count
 * A site that times out, answers 401/403/429/503 or shows a bot check is marked blocked or timeout
 * and listed separately; the run carries on.
 *
 * Our pages are served from --root by the same local server as tools/shoot.js (with _headers, so
 * the production CSP applies) and gzipped like a real host, so transfer bytes compare fairly with
 * competitors' compressed responses. Competitors come from tools/bench_targets.json. Note: our pages load
 * from 127.0.0.1 and competitors over the internet, so compare timings with --throttle 4g (adds the
 * same latency and bandwidth cap to both); bytes, requests and the checks are fair either way.
 *
 * Usage:
 *   node tools/bench_compare.js [--local index.html,join.html | all | none] [--group right,brands | all | none]
 *        [--urls URL,page.html,...] [--only text,text] [--targets FILE] [--out DIR] [--timeout MS]
 *        [--throttle none|4g|slow4g] [--concurrency N] [--no-axe] [--axe-file FILE] [--no-shots]
 *        [--root DIR] [--json] [--quiet]
 *
 *   --local        our pages, relative to --root (default index.html if it exists; "all" = every
 *                  root-level page; "none")
 *   --group        competitor groups from the targets file (default all; "none" for ours only)
 *   --urls         extra URLs; anything not starting with http(s):// is a page under --root
 *   --only         keep targets whose name or URL contains one of these strings
 *   --targets      targets file (default tools/bench_targets.json)
 *   --out          output folder (default tools/.cache/bench): bench.json, bench.md, screens/*.png
 *   --timeout      ms to wait for DOMContentLoaded (default 45000); each site gets this plus 75 s
 *                  in total before it is cut off and marked timeout
 *   --throttle     none (default); 4g = 170 ms RTT, 9 Mbps down, 9 Mbps up (WebPageTest 4G);
 *                  slow4g = 150 ms RTT, 1.6 Mbps down, 750 kbps up, 4x CPU (Lighthouse's mobile
 *                  values, applied as plain DevTools throttling)
 *   --concurrency  sites measured at once (default 2)
 *   --no-axe       skip axe-core; --axe-file uses a local axe.min.js
 *   --no-shots     no first-screen screenshots
 *
 * axe-core: require('axe-core') from node_modules or the global npm folder, else the copy cached in
 * tools/.cache/ by tools/check_site.js, else downloaded from cdnjs (axe-core 4.10.2) and its version
 * checked in the browser before use. Without any of them the axe columns read "skipped".
 * Exit codes: 0 finished (blocked sites included), 2 bad arguments or a crash.
 *
 * Module (for tests): require('./bench_compare') exports { run, parseArgs, loadTargets, scoreOf,
 *   toMarkdown, CTA_PATTERN, SKIP_PATTERN, AXE_VERSION, THROTTLE }.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const shoot = require('./shoot.js');

const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(__dirname, '.cache');
const DEFAULT_OUT = path.join(CACHE_DIR, 'bench');
const DEFAULT_TARGETS = path.join(__dirname, 'bench_targets.json');
const AXE_VERSION = '4.10.2';
const AXE_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/' + AXE_VERSION + '/axe.min.js';
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const VIEWPORT = { width: 390, height: 844 };
const THROTTLE = {
  none: null,
  '4g': { latency: 170, down: 9000, up: 9000, cpu: 1 },
  slow4g: { latency: 150, down: 1638.4, up: 750, cpu: 4 }
};

// Calls to action: an interactive element whose name contains one of these (English and Spanish).
const CTA_WORDS = [
  'join', 'sign up', 'signup', 'sign-up', 'register', 'donate', 'contribute', 'chip in', 'give', 'volunteer',
  'rsvp', 'get involved', 'take action', 'act now', 'pledge', 'subscribe', 'shop', 'buy', 'order', 'add to bag',
  'add to cart', 'get started', 'start', 'try', 'download', 'get the app', 'become a member', 'apply', 'book',
  'tickets', 'reserve', 'claim', 'enroll', 'create', 'host', 'find a chapter', 'find your', 'vote', 'make a plan',
  'únete', 'unete', 'inscríbete', 'inscribete', 'regístrate', 'registrate', 'dona', 'donar', 'donación', 'contribuye',
  'voluntari\\p{L}*', 'participa', 'compra', 'comprar', 'suscríbete', 'suscribete', 'empieza', 'vota', 'reserva'
];
const CTA_PATTERN = '(?<![\\p{L}\\p{N}])(?:' + CTA_WORDS.map((w) => w.replace(/ /g, '\\s+')).join('|') + ')(?![\\p{L}\\p{N}])';
const SKIP_PATTERN = '(?<![\\p{L}])(?:cookies?|accept|reject|decline|preferences|privacy|skip to|menu|close|search|log\\s?in|sign\\s?in|previous|pause|mute|unmute|terms)(?![\\p{L}])';

const firstLine = (e) => String((e && e.message) || e).split('\n')[0].replace(/^[a-zA-Z.]+: /, '').slice(0, 240);
// Timers used in races are unref'd so a finished run never waits for them to expire.
const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); if (t.unref) t.unref(); });

// ------------------------------------------------------------------------------------------
// Arguments and targets
// ------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const o = {
    root: ROOT, local: null, groups: null, urls: [], only: [], targets: DEFAULT_TARGETS, out: DEFAULT_OUT,
    timeout: 45000, throttle: 'none', concurrency: 2, axe: true, axeFile: '', shots: true, json: false, quiet: false, help: false
  };
  const args = [];
  for (const a of argv) {
    const m = /^(--[a-z-]+)=(.*)$/.exec(a);
    if (m) args.push(m[1], m[2]); else args.push(a);
  }
  const list = (v) => v.split(',').map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const val = () => { if (i + 1 >= args.length) throw new Error(a + ' needs a value'); return args[++i]; };
    if (a === '--root') o.root = path.resolve(val());
    else if (a === '--local') o.local = list(val());
    else if (a === '--group' || a === '--groups') o.groups = list(val().toLowerCase());
    else if (a === '--urls' || a === '--url') o.urls = o.urls.concat(list(val()));
    else if (a === '--only') o.only = list(val().toLowerCase());
    else if (a === '--targets') o.targets = path.resolve(val());
    else if (a === '--out') o.out = path.resolve(val());
    else if (a === '--timeout') o.timeout = Math.max(2000, parseInt(val(), 10) || 45000);
    else if (a === '--throttle') {
      o.throttle = val().toLowerCase();
      if (!(o.throttle in THROTTLE)) throw new Error('--throttle must be one of ' + Object.keys(THROTTLE).join(', '));
    } else if (a === '--concurrency') o.concurrency = Math.max(1, Math.min(6, parseInt(val(), 10) || 2));
    else if (a === '--no-axe') o.axe = false;
    else if (a === '--axe-file') o.axeFile = path.resolve(val());
    else if (a === '--no-shots') o.shots = false;
    else if (a === '--json') o.json = true;
    else if (a === '--quiet') o.quiet = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error('unknown argument ' + a);
  }
  return o;
}

/** Read the targets file: {group: [{name, url, note?} | "url"]}; non-array keys are metadata. */
function loadTargets(file) {
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const groups = {};
  for (const [k, v] of Object.entries(json)) {
    if (!Array.isArray(v)) continue;
    groups[k] = v.map((t) => (typeof t === 'string' ? { name: hostOf(t), url: t } : { name: t.name || hostOf(t.url), url: t.url, note: t.note || '' }))
      .filter((t) => /^https?:\/\//i.test(t.url || ''));
  }
  return groups;
}

function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return String(u); } }
function siteOf(host) { const p = String(host).split('.'); return p.slice(-2).join('.'); }
function slugOf(s) { return String(s).toLowerCase().replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'site'; }

/** Build the list of {name, group, url, local} to measure. */
function buildTargets(opts, base) {
  const out = [];
  let local = opts.local;
  if (!local) local = fs.existsSync(path.join(opts.root, 'index.html')) ? ['index.html'] : [];
  else if (local.length === 1 && local[0].toLowerCase() === 'all') local = shoot.listPages(opts.root);
  else if (local.length === 1 && local[0].toLowerCase() === 'none') local = [];
  const localUrl = (p) => base + '/' + p.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
  for (const p of local) out.push({ name: p + ' (ours)', group: 'ours', url: localUrl(p), local: true, page: p });
  let groups = {};
  const wanted = opts.groups || ['all'];
  if (!(wanted.length === 1 && wanted[0] === 'none')) {
    groups = loadTargets(opts.targets);
    const names = wanted.indexOf('all') >= 0 ? Object.keys(groups) : wanted;
    for (const g of names) {
      if (!groups[g]) throw new Error('no group "' + g + '" in ' + opts.targets + ' (has: ' + Object.keys(groups).join(', ') + ')');
      for (const t of groups[g]) out.push({ name: t.name, group: g, url: t.url, note: t.note || '' });
    }
  }
  for (const u of opts.urls) {
    if (/^https?:\/\//i.test(u)) out.push({ name: hostOf(u), group: 'custom', url: u });
    else out.push({ name: u + ' (ours)', group: 'ours', url: localUrl(u), local: true, page: u });
  }
  const filtered = opts.only.length ? out.filter((t) => opts.only.some((s) => (t.name + ' ' + t.url).toLowerCase().indexOf(s) >= 0)) : out;
  const seen = new Set();
  return filtered.filter((t) => (seen.has(t.url) ? false : seen.add(t.url)));
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
  const globalRoot = path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules');
  const paths = [opts.root, ROOT, process.cwd(), globalRoot].concat((process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean));
  try {
    const p = require.resolve('axe-core/axe.min.js', { paths });
    return { status: 'ready', source: 'node_modules (' + p + ')', code: fs.readFileSync(p, 'utf8') };
  } catch (e) { /* not installed */ }
  const cached = path.join(CACHE_DIR, 'axe-core-' + AXE_VERSION + '.min.js');
  try {
    const code = fs.readFileSync(cached, 'utf8');
    if (code.indexOf('axe.version="' + AXE_VERSION + '"') >= 0) return { status: 'ready', source: 'cache (tools/.cache)', code };
  } catch (e) { /* no cache */ }
  let ctx;
  try {
    ctx = await browser.newContext();
    const page = await ctx.newPage();
    const res = await page.goto(AXE_CDN, { timeout: 20000 });
    const code = res && res.ok() ? await res.text() : '';
    if (code.length < 100000) return { status: 'skipped', note: 'axe-core not installed and cdnjs answered ' + (res ? res.status() : 'nothing') + ' for ' + AXE_CDN };
    await page.goto('about:blank');
    const version = await page.evaluate(wrapAxe(code) + '; window.axe && window.axe.version');
    if (version !== AXE_VERSION) return { status: 'skipped', note: 'cdnjs file reports axe version ' + version + ', expected ' + AXE_VERSION };
    try { fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(cached, code); } catch (e) { /* read-only is fine */ }
    return { status: 'ready', source: 'cdnjs (' + AXE_CDN + ')', code };
  } catch (e) {
    return { status: 'skipped', note: 'axe-core not installed and cdnjs unreachable (' + firstLine(e) + ')' };
  } finally {
    if (ctx) await ctx.close().catch(() => {});
  }
}

/** Evaluate axe with define/module/exports hidden, so AMD loaders on the page don't capture it. */
function wrapAxe(code) { return '(function (define, module, exports) {\n' + code + '\n}).call(window)'; }

async function runAxe(page, code) {
  await page.evaluate(wrapAxe(code));
  return Promise.race([
    page.evaluate(async (tags) => {
      const r = await window.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
      const byImpact = { critical: 0, serious: 0, moderate: 0, minor: 0 };
      let nodes = 0, contrast = 0;
      const rules = r.violations.map((v) => {
        nodes += v.nodes.length;
        byImpact[v.impact || 'minor'] = (byImpact[v.impact || 'minor'] || 0) + v.nodes.length;
        if (v.id === 'color-contrast') contrast += v.nodes.length;
        return { id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help };
      }).sort((a, b) => b.nodes - a.nodes);
      return { status: 'ran', version: window.axe.version, rules: rules.length, nodes, seriousNodes: byImpact.critical + byImpact.serious, byImpact, contrast, top: rules.slice(0, 8) };
    }, AXE_TAGS),
    sleep(40000).then(() => ({ status: 'timeout', note: 'axe took more than 40 s' }))
  ]);
}

// ------------------------------------------------------------------------------------------
// In-page code (serialized into the page; must be self-contained)
// ------------------------------------------------------------------------------------------

/** Calls to action that are rendered (and, with viewportOnly, visible on the first screen). */
function findCtas(cfg, viewportOnly, limit) {
  const ctaRe = new RegExp(cfg.cta, 'iu');
  const skipRe = new RegExp(cfg.skip, 'iu');
  const vw = window.innerWidth, vh = window.innerHeight;
  const out = [];
  if (!document.body) return out;
  const els = document.body.querySelectorAll('a[href],button,[role="button"],input[type="submit"],input[type="button"]');
  for (const el of els) {
    const raw = (el.tagName === 'INPUT' ? el.value || '' : (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '')).replace(/\s+/g, ' ').trim();
    if (!raw || raw.length > 60 || !ctaRe.test(raw) || skipRe.test(raw)) continue;
    if (el.closest('[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],[aria-label*="cookie" i]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (viewportOnly && (cx < 0 || cx > vw || cy < 0 || cy > vh)) continue;
    if (getComputedStyle(el).visibility !== 'visible') continue;
    let op = 1;
    for (let n = el; n && n.nodeType === 1 && op >= 0.1; n = n.parentElement) op *= parseFloat(getComputedStyle(n).opacity) || 0;
    if (op < 0.1) continue;
    if (viewportOnly) {
      const hit = document.elementFromPoint(cx, cy);
      if (!hit || !(hit === el || el.contains(hit) || hit.contains(el))) continue;
    }
    out.push({ name: raw, tag: el.tagName.toLowerCase(), href: (el.getAttribute('href') || '').slice(0, 120) });
    if (limit && out.length >= limit) break;
  }
  return out;
}

/** Init script: LCP and CLS observers, first-CTA poller, Web Share / clipboard access probes. */
function benchInit(cfg) {
  try { if (window.top !== window) return; } catch (e) { return; }
  if (window.__bench) return;
  const B = window.__bench = { lcp: null, lcpEl: '', shifts: [], firstCta: null, firstCtaText: '', webShare: false, clipboard: false };
  const describe = (el) => {
    if (!el || !el.tagName) return '';
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    else if (typeof el.className === 'string' && el.className.trim()) s += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
    return s.slice(0, 80);
  };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) { B.lcp = e.renderTime || e.loadTime || e.startTime; B.lcpEl = describe(e.element); }
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch (e) { /* unsupported */ }
  try {
    new PerformanceObserver((list) => {
      // Every shift counts: the bench sends no input while measuring, and Chromium's phone
      // emulation marks shifts in the first ~500 ms as hadRecentInput, which would hide them.
      for (const e of list.getEntries()) B.shifts.push([e.startTime, e.value]);
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (e) { /* unsupported */ }
  try {
    const proto = Navigator.prototype;
    for (const k of ['share', 'canShare']) {
      const d = Object.getOwnPropertyDescriptor(proto, k);
      if (d && typeof d.value === 'function') {
        const orig = d.value;
        Object.defineProperty(proto, k, { configurable: true, enumerable: d.enumerable, get() { B.webShare = true; return orig; }, set() {} });
      } else if (!d) {
        // Desktop Linux Chromium has no Web Share; record feature detection without adding the API.
        Object.defineProperty(proto, k, { configurable: true, enumerable: false, get() { B.webShare = true; return undefined; } });
      }
    }
    const cd = Object.getOwnPropertyDescriptor(proto, 'clipboard');
    if (cd && cd.get) {
      const g = cd.get;
      Object.defineProperty(proto, 'clipboard', { configurable: true, enumerable: cd.enumerable, get() { B.clipboard = true; return g.call(this); } });
    }
  } catch (e) { /* leave navigator alone */ }
  // The CTA poller waits for DOMContentLoaded: polling before the render-blocking stylesheets arrive forces a
  // layout of the unstyled page (body's default 8 px margin), which then "shifts" when CSS lands and the bench
  // reported CLS 0.57-0.75 for pages that measure 0 without it (review right-wing-bench-artifacts). The time to
  // first CTA is still counted from navigation start (performance.now()).
  const t0 = performance.now();
  const tick = () => {
    if (B.firstCta != null) return;
    try {
      const c = window.__benchFindCtas(cfg, true, 1);
      if (c.length) { B.firstCta = performance.now(); B.firstCtaText = c[0].name; return; }
    } catch (e) { /* DOM not ready */ }
    const age = performance.now() - t0;
    if (age < 90000) setTimeout(tick, age < 10000 ? 50 : 250);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 0), { once: true });
  else setTimeout(tick, 0);
}

/** Does this look like a bot check rather than the site? */
function challengeInfo() {
  const title = document.title || '';
  const text = document.body ? (document.body.innerText || '').slice(0, 4000) : '';
  const words = text.split(/\s+/).filter(Boolean).length;
  const frames = Array.from(document.querySelectorAll('iframe')).map((f) => f.src || '').join(' ');
  const titleHit = /just a moment|attention required|checking your browser|access denied|verify(?:ing)? (?:that )?you are (?:a )?human|are you a robot|pardon our interruption|security check|request unsuccessful|bot (?:check|detection)|one more step|please wait while we verify/i.test(title);
  const textHit = /checking if the site connection is secure|checking your browser before|verify you are (?:a )?human|enable javascript and cookies to continue|press (?:&|and) hold|access to this page has been denied|you have been blocked|unusual traffic from your/i.test(text);
  const frameHit = words < 80 && /challenges\.cloudflare\.com|captcha-delivery\.com|px-captcha|geo\.captcha/i.test(frames);
  const domHit = !!document.querySelector('#challenge-form,#cf-challenge-running,#px-captcha,.cf-browser-verification');
  return { title: title.slice(0, 120), words, challenge: titleHit || textHit || frameHit || domHit };
}

/** Background luminance at a few points, for the dark-mode check. */
function bgSample() {
  const parse = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = (c) => {
    if (!c) return null;
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return Math.round((0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)) * 1000) / 1000;
  };
  const html = document.documentElement;
  const scheme = getComputedStyle(html).colorScheme || 'normal';
  const canvas = () => (window.matchMedia('(prefers-color-scheme: dark)').matches && /dark/.test(scheme) ? { r: 18, g: 18, b: 18, a: 1 } : { r: 255, g: 255, b: 255, a: 1 });
  const effective = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.5) return c;
    }
    return canvas();
  };
  const vw = window.innerWidth, vh = window.innerHeight;
  const pts = [[vw / 2, 8], [vw / 2, vh * 0.3], [vw / 2, vh * 0.6], [24, vh * 0.9]];
  return {
    points: pts.map(([x, y]) => lum(effective(document.elementFromPoint(x, y) || document.body))),
    body: lum(effective(document.body || html)),
    text: lum(parse(getComputedStyle(document.body || html).color)),
    scheme
  };
}

/** Everything else, read once after the page settles (light scheme, scrolled to the top). */
function collect(a, findCtas) {
  const B = window.__bench || {};
  const doc = document, vw = window.innerWidth;
  const out = {};
  const text = (el) => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || el.value || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => {
    if (!el.getClientRects().length) return false;
    if (getComputedStyle(el).visibility !== 'visible') return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };

  // Timing
  const nav = performance.getEntriesByType('navigation')[0];
  const fcpE = performance.getEntriesByName('first-contentful-paint')[0];
  const fcp = fcpE ? fcpE.startTime : null;
  let cls = 0, cur = 0, wStart = -1, last = -1;
  // Shifts before first contentful paint move nothing anyone saw, so they don't count (Lighthouse and the CLS
  // definition only score what the visitor can see). Without an FCP entry every shift counts, as before.
  const seenShifts = (B.shifts || []).filter(([t]) => fcp == null || t >= fcp);
  for (const [t, v] of seenShifts.slice().sort((x, y) => x[0] - y[0])) {
    if (wStart < 0 || t - last > 1000 || t - wStart > 5000) { cur = 0; wStart = t; }
    cur += v; last = t;
    if (cur > cls) cls = cur;
  }
  out.timing = {
    dcl: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
    load: nav && nav.loadEventEnd ? Math.round(nav.loadEventEnd) : null,
    fcp: fcp == null ? null : Math.round(fcp),
    lcp: B.lcp == null ? null : Math.round(B.lcp),
    lcpElement: B.lcpEl || '',
    cls: Math.round(cls * 1000) / 1000,
    firstCta: B.firstCta == null ? null : Math.round(Math.max(B.firstCta, fcp || 0)),
    firstCtaText: B.firstCtaText || ''
  };

  // Calls to action on the first screen (distinct by text)
  const seen = new Set(), distinct = [];
  for (const c of findCtas(a.cfg, true, 0)) {
    const k = c.name.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, '').replace(/\s+/g, ' ').trim();
    if (k && !seen.has(k)) { seen.add(k); distinct.push(c.name); }
  }
  out.cta = { aboveFold: distinct.length, list: distinct.slice(0, 12) };

  // Tap targets under 44x44 (whole page)
  const tq = 'a[href],button,input:not([type="hidden"]),select,textarea,summary,[role="button"],[role="link"],[role="checkbox"],[role="switch"],[role="tab"],[role="menuitem"],[role="radio"]';
  let total = 0;
  const small = [];
  for (const el of doc.querySelectorAll(tq)) {
    if (el.disabled || !el.getClientRects().length) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility !== 'visible') continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1 || r.right <= 0 || r.left >= vw) continue;
    if (el.labels && Array.prototype.some.call(el.labels, (l) => { const lr = l.getBoundingClientRect(); return lr.width >= 44 && lr.height >= 44; })) { total++; continue; }
    total++;
    if (r.width >= 44 && r.height >= 44) continue;
    if (el.tagName === 'A' && cs.display === 'inline' && el.parentElement) {
      const rest = (el.parentElement.textContent || '').replace(el.textContent || '', '').trim();
      if (rest.length > 0) continue;                                   // link inside a sentence
    }
    small.push({ name: text(el).slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) });
  }
  out.tapTargets = { under44: small.length, total, examples: small.slice(0, 6) };

  // Overlays on the first screen: sample a grid and find fixed-position layers on top
  const vh = window.innerHeight;
  const layers = new Map();
  let covered = 0, points = 0;
  for (let gy = 0; gy < 10; gy++) {
    for (let gx = 0; gx < 6; gx++) {
      points++;
      const hit = doc.elementFromPoint((gx + 0.5) * vw / 6, (gy + 0.5) * vh / 10);
      // The largest fixed-position element in the chain (wrappers can be fixed but zero-sized);
      // the walk crosses shadow roots, where consent and pop-up widgets often live.
      let layer = null, area = 0, lr = null;
      for (let n = hit; n && n.nodeType === 1 && n !== doc.body && n !== doc.documentElement;
        n = n.parentElement || (n.getRootNode && n.getRootNode().host) || null) {
        if (getComputedStyle(n).position !== 'fixed') continue;
        const rr = n.getBoundingClientRect();
        if (rr.width * rr.height > area) { area = rr.width * rr.height; layer = n; lr = rr; }
      }
      if (!layer || lr.height < vh * 0.15) continue;                             // none, or a slim header or bottom bar
      covered++;
      layers.set(layer, (layers.get(layer) || 0) + 1);
    }
  }
  let topLayer = null, topCount = 0;
  layers.forEach((n, el) => { if (n > topCount) { topCount = n; topLayer = el; } });
  const describe = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    else if (typeof el.className === 'string' && el.className.trim()) s += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
    return s.slice(0, 60);
  };
  let kind = '';
  if (topLayer) {
    const sig = (topLayer.id + ' ' + (typeof topLayer.className === 'string' ? topLayer.className : '') + ' ' + (topLayer.getAttribute('aria-label') || '') + ' ' + (topLayer.textContent || '').slice(0, 400)).toLowerCase();
    kind = /cookie|consent|onetrust|cmp|gdpr|privacy/.test(sig) ? 'cookie banner'
      : (topLayer.matches('dialog,[role="dialog"],[role="alertdialog"],[aria-modal="true"]') || topLayer.querySelector('iframe,[role="dialog"],[aria-modal="true"]') || /modal|popup|pop-up|klaviyo|attentive|newsletter|subscribe|sign up|signup|email|% off|discount/.test(sig)) ? 'pop-up'
      : 'fixed layer';
  }
  out.overlay = { coverage: Math.round(covered / points * 100) / 100, top: topLayer ? describe(topLayer) : '', kind };

  // Horizontal overflow
  const sw = Math.max(doc.documentElement.scrollWidth, doc.body ? doc.body.scrollWidth : 0);
  const ox = [getComputedStyle(doc.documentElement).overflowX, doc.body ? getComputedStyle(doc.body).overflowX : ''];
  out.overflow = {
    overflows: sw > a.width + 1 || sw > vw + 1, scrollWidth: sw, innerWidth: vw,
    clippedByCss: ox.some((v) => v === 'hidden' || v === 'clip'), viewportMeta: !!doc.querySelector('meta[name="viewport"]')
  };

  // Images
  const imgs = Array.from(doc.images);
  const noAlt = imgs.filter((i) => !i.hasAttribute('alt'));
  out.images = { total: imgs.length, withoutAlt: noAlt.length, examples: noAlt.slice(0, 3).map((i) => (i.currentSrc || i.getAttribute('src') || '').slice(0, 100)) };

  // Open Graph and Twitter
  const meta = (k) => { const m = doc.querySelector('meta[property="' + k + '"],meta[name="' + k + '"]'); return m ? (m.getAttribute('content') || '').trim() : ''; };
  const og = { title: meta('og:title'), description: meta('og:description'), image: meta('og:image'), url: meta('og:url'), type: meta('og:type'), twitterCard: meta('twitter:card') };
  og.count = ['title', 'description', 'image', 'url', 'type'].filter((k) => og[k]).length;
  og.ok = !!(og.title && og.image);
  out.og = og;

  // Language toggle
  const ev = [];
  const htmlLang = doc.documentElement.getAttribute('lang') || '';
  const alternates = Array.from(doc.querySelectorAll('link[rel~="alternate"][hreflang]')).map((l) => l.getAttribute('hreflang'));
  doc.querySelectorAll('a[hreflang]').forEach((el) => { if (ev.length < 20) ev.push('a[hreflang=' + el.getAttribute('hreflang') + ']'); });
  const langWord = /^(?:es|en|esp|eng|español|espanol|english|en español|en espanol|in english|idioma|idiomas|language|languages|lang|translate|traducir|en\s*[/|·]\s*es|es\s*[/|·]\s*en)$/iu;
  for (const el of doc.querySelectorAll('a[href],button,[role="button"],[role="menuitem"],[role="option"],[role="switch"],option,summary')) {
    const t = text(el);
    if (t && t.length <= 30 && (langWord.test(t) || /espa[ñn]ol/i.test(t))) ev.push(el.tagName.toLowerCase() + ': ' + t);
    if (ev.length > 20) break;
  }
  for (const el of doc.querySelectorAll('a[href]')) {
    const h = el.getAttribute('href') || '';
    if (/^(?:https?:\/\/[^/]+)?\/es(?:[-_][a-z]{2})?\/?(?:$|[?#])|[?&](?:lang|hl|locale)=es\b|^https?:\/\/es\./i.test(h)) { ev.push('link to Spanish: ' + h.slice(0, 80)); break; }
  }
  const widget = Array.from(doc.scripts).map((s) => s.src || '').find((s) => /weglot|gtranslate|translate\.google|translate_a\/element|localizejs|transifex|conveythis|bablic|langify|smartling|lokalise/i.test(s));
  if (widget) ev.push('translation widget: ' + widget.slice(0, 80));
  if (doc.querySelector('[class*="weglot" i],[id*="weglot" i],.goog-te-combo,#google_translate_element,[class*="lang-switch" i],[class*="language-switch" i],[class*="language-selector" i],[class*="lang-select" i],[class*="locale-switch" i],[data-lang-toggle],[data-ysd-lang]')) ev.push('language switcher element');
  const evidence = Array.from(new Set(ev));
  out.lang = {
    toggle: evidence.length > 0,
    spanish: evidence.some((e) => /=es|\bes\b|espa[ñn]ol|spanish|\/es\b/i.test(e)) || alternates.some((h) => /^es/i.test(h || '')),
    evidence: evidence.slice(0, 6), htmlLang, alternates: alternates.slice(0, 10)
  };

  // Video
  const vids = Array.from(doc.querySelectorAll('video'));
  const embedRe = /youtube(?:-nocookie)?\.com\/embed|youtu\.be\/|player\.vimeo\.com|tiktok\.com\/embed|wistia\.(?:com|net)|jwplayer|jwpcdn|players\.brightcove|vidyard|loom\.com\/embed|facebook\.com\/plugins\/video|instagram\.com\/(?:p|reel)\/|streamable\.com|cloudflarestream\.com|videodelivery\.net|stream\.mux\.com|mediadelivery\.net/i;
  const embeds = Array.from(doc.querySelectorAll('iframe')).filter((f) => embedRe.test(f.src || f.getAttribute('data-src') || ''));
  out.video = { videos: vids.length, autoplay: vids.filter((v) => v.autoplay || (!v.paused && v.currentTime > 0)).length, embeds: embeds.length, present: vids.length + embeds.length > 0 };

  // Share affordances
  const intentRe = /(?:twitter\.com|x\.com)\/intent\/|facebook\.com\/sharer|facebook\.com\/dialog\/(?:share|feed)|linkedin\.com\/(?:sharing|shareArticle)|wa\.me\/\?|api\.whatsapp\.com\/send|whatsapp:\/\/send|t\.me\/share|telegram\.me\/share|reddit\.com\/submit|pinterest\.com\/pin\/create|bsky\.app\/intent|threads\.(?:net|com)\/intent|^sms:.*body=|^mailto:.*[?&]body=/i;
  const intents = Array.from(doc.querySelectorAll('a[href]')).filter((el) => intentRe.test(el.getAttribute('href') || ''));
  const shareRe = /(?<![\p{L}])(?:share|compartir|comparte|copy link|copy url|copiar (?:el )?enlace|copiar link|group chat|grupo|m\u00e1ndalo|mandalo|send it to)(?![\p{L}])/iu;
  const shareBtns = Array.from(doc.querySelectorAll('a[href],button,[role="button"]')).filter((el) => { const t = text(el); return t && t.length <= 40 && shareRe.test(t); });
  const copyBtns = shareBtns.filter((el) => /copy|copiar/i.test(text(el)));
  out.share = {
    present: intents.length > 0 || shareBtns.length > 0 || !!B.webShare,
    webShareApi: !!B.webShare, clipboardApi: !!B.clipboard, copyLink: copyBtns.length > 0,
    intentLinks: intents.length, buttons: shareBtns.length,
    evidence: shareBtns.slice(0, 4).map(text).concat(intents.slice(0, 3).map((el) => (el.getAttribute('href') || '').slice(0, 60)))
  };

  // Sign-up form: the container of an email or phone field (not search, not log-in)
  const fieldSel = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="image"]):not([type="reset"]):not([type="search"]),select,textarea';
  const contactSel = 'input[type="email"],input[autocomplete~="email"],input[name*="email" i],input[id*="email" i],input[type="tel"],input[autocomplete~="tel"]';
  const containers = [];
  for (const inp of doc.querySelectorAll(contactSel)) {
    if (inp.type === 'hidden') continue;
    let c = inp.form || null;
    if (!c) {
      for (let n = inp.parentElement, d = 0; n && d < 6; d++, n = n.parentElement) {
        if (n.querySelector('button,input[type="submit"],[role="button"]')) { c = n; break; }
      }
    }
    c = c || inp.parentElement;
    if (!c || c.matches('[role="search"]') || c.querySelector('input[type="search"],input[type="password"]')) continue;
    if (containers.indexOf(c) < 0) containers.push(c);
  }
  const forms = containers.map((c) => {
    const all = Array.from(c.querySelectorAll(fieldSel));
    const isBox = (f) => /^(checkbox|radio)$/i.test(f.type || '');
    const shown = all.filter(visible);
    return {
      visible: visible(c) && shown.length > 0,
      fields: shown.filter((f) => !isBox(f)).length,
      fieldsAll: all.filter((f) => !isBox(f)).length,
      checkboxes: shown.filter(isBox).length,
      names: (shown.length ? shown : all).filter((f) => !isBox(f)).map((f) => f.getAttribute('autocomplete') || f.name || f.id || f.type || f.tagName.toLowerCase()).slice(0, 10),
      phone: !!c.querySelector('input[type="tel"],input[autocomplete~="tel"],input[name*="phone" i]')
    };
  });
  const best = forms.find((f) => f.visible) || forms[0] || null;
  out.signup = {
    forms: forms.length,
    fields: best ? (best.visible ? best.fields : best.fieldsAll) : null,
    visible: best ? best.visible : false,
    checkboxes: best ? best.checkboxes : 0,
    names: best ? best.names : [],
    phone: forms.some((f) => f.phone)
  };

  // Dark-mode CSS present at all (same-origin or CORS stylesheets only)
  let darkRules = 0, unreadable = 0;
  const walk = (rules) => {
    for (const r of rules) {
      if (r.media && /prefers-color-scheme:\s*dark/i.test(r.media.mediaText || r.conditionText || '')) darkRules++;
      if (r.cssRules) walk(r.cssRules);
    }
  };
  for (const s of Array.from(doc.styleSheets)) {
    if (s.media && /prefers-color-scheme:\s*dark/i.test(s.media.mediaText || '')) darkRules++;
    try { walk(s.cssRules); } catch (e) { unreadable++; }
  }
  out.darkCss = { rules: darkRules, unreadableSheets: unreadable, colorSchemeMeta: meta('color-scheme') };
  return out;
}

// ------------------------------------------------------------------------------------------
// Scoring and output
// ------------------------------------------------------------------------------------------

/**
 * A 0-100 heuristic so the table has an order. Weights (see docs/infra/harness.md): weight 15,
 * LCP 15, CLS 10, first CTA 10, CTA focus 5, tap targets 5, overflow 5, axe 15, alt text 5,
 * features 15 (OG 3, dark 3, language 3, share 3, short sign-up form 3). If axe was skipped the
 * rest is scaled to 100. Returns null for sites that were not measured.
 */
function scoreOf(r) {
  if (!r || r.status !== 'ok') return null;
  const lin = (v, good, bad) => (v == null ? 0 : Math.max(0, Math.min(1, (bad - v) / (bad - good))));
  const p = {};
  const mb = (r.bytes && r.bytes.total || 0) / 1e6;
  p.weight = 15 * (mb <= 0.5 ? 1 : Math.max(0, 1 - Math.log10(mb / 0.5) / Math.log10(20)));
  p.lcp = 15 * lin(r.timing.lcp, 2500, 4000);
  p.cls = 10 * lin(r.timing.cls, 0.1, 0.25);
  p.cta = 10 * lin(r.timing.firstCta, 1500, 5000);
  const n = r.cta.aboveFold;
  p.focus = 5 * (n >= 1 && n <= 2 ? 1 : n === 3 ? 0.8 : n >= 4 && n <= 5 ? 0.4 : 0);
  p.taps = 5 * (r.tapTargets.total ? Math.max(0, 1 - 2 * r.tapTargets.under44 / r.tapTargets.total) : 1);
  p.overflow = r.overflow.overflows ? 0 : 5;
  p.axe = r.axe && r.axe.status === 'ran' ? 15 * Math.max(0, 1 - r.axe.seriousNodes / 40) : null;
  p.alt = 5 * Math.max(0, 1 - r.images.withoutAlt / 5);
  const f = r.signup.fields;
  p.features = (r.og.ok ? (r.og.description ? 3 : 2) : r.og.count ? 1 : 0) +
    (r.darkMode === 'yes' ? 3 : 0) + (r.lang.toggle ? 3 : 0) + (r.share.present ? 3 : 0) +
    (f == null || f === 0 ? 0 : f <= 4 ? 3 : 1.5);
  let total = 0;
  for (const k of Object.keys(p)) if (p[k] != null) total += p[k];
  if (p.axe == null) total = total * 100 / 85;
  for (const k of Object.keys(p)) if (p[k] != null) p[k] = Math.round(p[k] * 10) / 10;
  return { total: Math.round(total), parts: p };
}

const cell = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\s+/g, ' ');
const sec = (ms) => (ms == null ? 'n/a' : (ms / 1000).toFixed(1));
const kb = (b) => (b == null ? '' : Math.round(b / 1024));
const mbText = (b) => { const mb = (b || 0) / 1e6; return mb < 0.1 ? mb.toFixed(3) : mb.toFixed(2); };

function amPm(d) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const h = d.getHours() % 12 || 12;
  return `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}, ${h}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'am' : 'pm'}`;
}

function toMarkdown(report) {
  const ok = report.results.filter((r) => r.status === 'ok').sort((a, b) => (b.score ? b.score.total : -1) - (a.score ? a.score.total : -1));
  const bad = report.results.filter((r) => r.status !== 'ok');
  const L = [];
  L.push('# Head-to-head bench', '');
  L.push(`Generated ${amPm(new Date(report.generatedAt))} with \`node tools/bench_compare.js\`. Chromium ${report.chromium}, phone ${report.viewport.width}x${report.viewport.height} (2x), cold cache, throttle: ${report.throttle}. axe: ${report.axe.status === 'ready' ? 'axe-core ' + (report.axe.version || AXE_VERSION) + ', WCAG 2.x A/AA rules' : 'skipped (' + report.axe.note + ')'}.`, '');
  if (report.throttle === 'none') L.push('Our pages load from 127.0.0.1 and competitors over the internet, so timings flatter our pages. Rerun with `--throttle 4g` for timing claims. Bytes, requests and checks are comparable as is.', '');
  L.push('Score is a 0-100 heuristic for ordering (weights in docs/infra/harness.md). Read the raw columns.', '');
  L.push('| # | Site | Group | Score | MB | Req | DCL s | LCP s | CLS | 1st CTA s | CTAs on 1st screen | Taps <44 | Overflow 390 | Img no alt | axe serious (contrast) | Overlay on 1st screen | OG | Dark | Lang | Video | Share | Sign-up fields |');
  L.push('|---|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|---|---|---|---|---|---|--:|');
  ok.forEach((r, i) => {
    const axe = r.axe && r.axe.status === 'ran' ? `${r.axe.seriousNodes} (${r.axe.contrast})` : (r.axe ? r.axe.status : 'skipped');
    const lang = r.lang.toggle ? (r.lang.spanish ? 'yes, ES' : 'yes') : 'no';
    const video = r.video.present ? (r.video.autoplay ? 'autoplay' : 'yes') : 'no';
    const share = r.share.present ? [r.share.webShareApi ? 'Web Share' : '', r.share.copyLink ? 'copy' : '', r.share.intentLinks ? r.share.intentLinks + ' intents' : '', r.share.buttons && !r.share.copyLink ? 'button' : ''].filter(Boolean).join(', ') || 'yes' : 'no';
    const form = r.signup.fields == null ? 'none' : r.signup.fields + (r.signup.visible ? '' : ' (hidden)') + (r.signup.phone ? ', phone' : '');
    L.push('| ' + [i + 1, cell(r.name), r.group, r.score ? r.score.total : '', mbText(r.bytes.total), r.requests.total,
      sec(r.timing.dcl), sec(r.timing.lcp), r.timing.cls == null ? 'n/a' : r.timing.cls.toFixed(2), sec(r.timing.firstCta), r.cta.aboveFold,
      `${r.tapTargets.under44}/${r.tapTargets.total}`, r.overflow.overflows ? `yes (${r.overflow.scrollWidth}px)` : 'no', r.images.withoutAlt,
      axe, r.overlay && r.overlay.coverage >= 0.1 ? Math.round(r.overlay.coverage * 100) + '% ' + r.overlay.kind : 'no', r.og.ok ? 'yes' : (r.og.count ? 'partial' : 'no'), r.darkMode, lang, video, cell(share), form].join(' | ') + ' |');
  });
  if (!ok.length) L.push('| | (no site was measured) | | | | | | | | | | | | | | | | | | | | |');
  if (bad.length) {
    L.push('', '## Not measured', '', '| Site | Group | Status | Reason | URL |', '|---|---|---|---|---|');
    for (const r of bad) L.push(`| ${cell(r.name)} | ${r.group} | ${r.status} | ${cell(r.reason)} | ${cell(r.url)} |`);
  }
  if (ok.length) {
    const T = ['document', 'script', 'css', 'image', 'font', 'media', 'xhr', 'other'];
    L.push('', '## Weight by type', '', 'KB transferred / requests, from navigation to load plus network quiet (at most 5 s).', '');
    L.push('| Site | Total | HTML | JS | CSS | Images | Fonts | Media | XHR/fetch | Other | 3rd-party req (hosts) |');
    L.push('|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|');
    for (const r of ok) {
      L.push('| ' + [cell(r.name), `${kb(r.bytes.total)} / ${r.requests.total}`].concat(T.map((t) => `${kb(r.bytes.byType[t] || 0)} / ${r.requests.byType[t] || 0}`), `${r.requests.thirdParty} (${r.requests.thirdPartyHosts})`).join(' | ') + ' |');
    }
    L.push('', '## First screen at 390 px', '', '| Site | First CTA seen | Calls to action on the first screen | LCP element |', '|---|---|---|---|');
    for (const r of ok) L.push(`| ${cell(r.name)} | ${cell(r.timing.firstCtaText ? '"' + r.timing.firstCtaText + '" at ' + sec(r.timing.firstCta) + ' s' : 'none')} | ${cell(r.cta.list.map((s) => '"' + s + '"').join(', ') || 'none')} | ${cell(r.timing.lcpElement || 'n/a')} |`);
  }
  L.push('', '## Definitions', '');
  L.push('- **CTA**: a visible link or button whose text contains an action word (join, sign up, donate, volunteer, RSVP, shop, buy, get started, vote, and Spanish equivalents; full list in `CTA_WORDS` in the tool). Cookie and consent buttons are ignored. "1st CTA s" is when the first one became visible and unobstructed, never earlier than first paint.');
  L.push('- **Taps <44**: visible interactive elements smaller than 44x44 CSS px over all rendered targets on the page; links inside sentences are exempt.');
  L.push('- **Overlay on 1st screen**: share of a 6x10 grid of points on the first screen covered by a fixed-position layer taller than 15% of the screen (pop-ups, cookie banners, app banners), read about a second after load; later pop-ups are missed. CTAs under an overlay do not count as visible.');
  L.push('- **Dark**: yes if emulating prefers-color-scheme: dark makes the background darker; always-dark if it is already dark; no otherwise.');
  L.push('- **Lang**: a language switcher, hreflang link, link to a Spanish version, or translation widget in the page. ES means Spanish was found.');
  L.push('- **Share**: share or copy-link buttons, share-intent links (X, Facebook, WhatsApp, SMS and so on), or the page reading `navigator.share`.');
  L.push('- **Sign-up fields**: text, email, phone and select fields in the first visible form with an email or phone field (checkboxes not counted); "hidden" when that form is not on screen.');
  return L.join('\n') + '\n';
}

// ------------------------------------------------------------------------------------------
// Measuring one site
// ------------------------------------------------------------------------------------------

const TYPE = { document: 'document', script: 'script', stylesheet: 'css', image: 'image', font: 'font', media: 'media', xhr: 'xhr', fetch: 'xhr', eventsource: 'xhr' };

function emptyResult(t) {
  return {
    name: t.name, group: t.group, url: t.url, note: t.note || undefined, finalUrl: '', status: 'error', reason: '', httpStatus: 0, title: '',
    bytes: { total: 0, byType: {} }, requests: { total: 0, byType: {}, failed: 0, unfinished: 0, thirdParty: 0, thirdPartyHosts: 0 },
    jsErrors: 0, notes: []
  };
}

async function measureOne(browser, t, opts, axe, holder) {
  const r = emptyResult(t);
  const started = Date.now();
  const ctx = await browser.newContext({
    viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: shoot.browserUserAgent(browser, true),
    colorScheme: 'light', serviceWorkers: 'block', locale: 'en-US', timezoneId: 'America/New_York'
  });
  holder.ctx = ctx;
  const cfg = { cta: CTA_PATTERN, skip: SKIP_PATTERN };
  await ctx.addInitScript({ content: `window.__benchFindCtas = ${findCtas.toString()};\n(${benchInit.toString()})(${JSON.stringify(cfg)});` });
  const net = { measuring: true, pending: [], hosts: new Set(), mainSite: siteOf(hostOf(t.url)) };
  const add = (obj, k, v) => { obj[k] = (obj[k] || 0) + v; };
  ctx.on('request', (req) => {
    if (!net.measuring || !/^https?:/i.test(req.url())) return;
    const type = TYPE[req.resourceType()] || 'other';
    r.requests.total++;
    add(r.requests.byType, type, 1);
    const h = hostOf(req.url());
    if (siteOf(h) !== net.mainSite) { r.requests.thirdParty++; net.hosts.add(h); }
  });
  ctx.on('requestfinished', (req) => {
    if (!net.measuring || !/^https?:/i.test(req.url())) return;
    const type = TYPE[req.resourceType()] || 'other';
    net.pending.push(req.sizes().then((s) => {
      const b = Math.max(0, s.responseBodySize || 0) + Math.max(0, s.responseHeadersSize || 0);
      r.bytes.total += b;
      add(r.bytes.byType, type, b);
    }, () => {}));
  });
  ctx.on('requestfailed', (req) => { if (net.measuring) r.requests.failed++; });
  const page = await ctx.newPage();
  page.on('pageerror', () => { r.jsErrors++; });
  const th = THROTTLE[opts.throttle];
  let cdp = null;
  if (th) {
    cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: th.latency, downloadThroughput: th.down * 1024 / 8, uploadThroughput: th.up * 1024 / 8 });
    if (th.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: th.cpu });
  }

  let resp = null;
  try {
    resp = await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: opts.timeout });
  } catch (e) {
    const msg = firstLine(e);
    r.reason = msg;
    r.status = /timeout/i.test(msg) ? 'timeout' : /ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY|ERR_BLOCKED|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_HTTP2_PROTOCOL_ERROR/i.test(msg) ? 'blocked' : 'error';
    if (/ERR_TUNNEL_CONNECTION_FAILED/.test(msg)) r.reason += ' (a proxy refused the connection: the host is not allowed, or its name does not resolve)';
    net.measuring = false;
    r.seconds = Math.round((Date.now() - started) / 100) / 10;
    return r;
  }
  r.httpStatus = resp ? resp.status() : 0;
  const left = Math.max(5000, opts.timeout - (Date.now() - started));
  const loaded = await page.waitForLoadState('load', { timeout: left }).then(() => true, () => false);
  if (!loaded) r.notes.push('load event did not fire in time; measured what had loaded');
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(800);
  net.measuring = false;
  await Promise.race([Promise.all(net.pending), sleep(10000)]);
  r.requests.thirdPartyHosts = net.hosts.size;
  r.windowMs = Date.now() - started;
  if (cdp) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => {});
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }).catch(() => {});
  }

  r.finalUrl = page.url();
  const ch = await page.evaluate(challengeInfo).catch(() => ({ title: '', words: 0, challenge: false }));
  r.title = ch.title;
  if (r.httpStatus >= 400) {
    r.status = ch.challenge || [401, 403, 405, 406, 429, 503].indexOf(r.httpStatus) >= 0 ? 'blocked' : 'error';
    r.reason = 'HTTP ' + r.httpStatus + (ch.challenge ? ', bot check "' + ch.title + '"' : '');
  } else if (ch.challenge) {
    r.status = 'blocked';
    r.reason = 'bot check: "' + ch.title + '"';
  } else r.status = 'ok';

  if (opts.shots) {
    const dir = path.join(opts.out, 'screens');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, slugOf(t.group + '-' + t.name) + (r.status === 'ok' ? '' : '-' + r.status) + '.png');
    await page.screenshot({ path: file, timeout: 15000 }).then(() => { r.screenshot = path.relative(opts.out, file); }, () => {});
  }
  if (r.status !== 'ok') { r.seconds = Math.round((Date.now() - started) / 100) / 10; return r; }

  const args = { cfg, width: VIEWPORT.width };
  Object.assign(r, await page.evaluate(`(${collect.toString()})(${JSON.stringify(args)}, ${findCtas.toString()})`));
  const light = await page.evaluate(bgSample).catch(() => null);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(400);
  const dark = await page.evaluate(bgSample).catch(() => null);
  await page.emulateMedia({ colorScheme: 'light' });
  r.darkMode = darkVerdict(light, dark);
  r.darkSample = { light, dark };

  if (axe && axe.code) {
    try { r.axe = await runAxe(page, axe.code); } catch (e) { r.axe = { status: 'error', note: firstLine(e) }; }
  } else r.axe = { status: 'skipped' };
  r.score = scoreOf(r);
  r.seconds = Math.round((Date.now() - started) / 100) / 10;
  return r;
}

function darkVerdict(light, dark) {
  if (!light || !dark) return 'unknown';
  const darker = (a, b) => a != null && b != null && a - b > 0.25;
  const changed = light.points.some((v, i) => darker(v, dark.points[i])) || darker(light.body, dark.body) || (dark.text != null && light.text != null && dark.text - light.text > 0.3);
  if (changed) return 'yes';
  const pts = light.points.filter((v) => v != null).sort((a, b) => a - b);
  const median = pts.length ? pts[Math.floor(pts.length / 2)] : 1;
  return light.body != null && light.body < 0.15 && median < 0.15 ? 'always-dark' : 'no';
}

// ------------------------------------------------------------------------------------------
// Runner
// ------------------------------------------------------------------------------------------

async function run(opts) {
  const started = Date.now();
  fs.mkdirSync(opts.out, { recursive: true });
  const { chromium } = shoot.loadPlaywright();
  const srv = await shoot.startServer(opts.root, { headers: true, gzip: true }); // compressed like a real host, so MB compares fairly
  const report = {
    tool: 'tools/bench_compare.js', generatedAt: new Date().toISOString(), chromium: '', viewport: VIEWPORT, throttle: opts.throttle,
    local: srv.base + ' (local server for ' + opts.root + (srv.headersEmulated ? ', _headers applied' : '') + ')',
    axe: { status: 'skipped' }, results: [], notes: [], seconds: 0
  };
  let browser = null;
  try {
    const targets = buildTargets(opts, srv.base);
    if (!targets.length) report.notes.push('nothing to measure (no local pages and no targets)');
    browser = await chromium.launch();
    report.chromium = browser.version();
    const axe = targets.length ? await loadAxe(opts, browser) : { status: 'skipped', note: 'nothing to measure' };
    report.axe = { status: axe.status, source: axe.source, note: axe.note };
    if (axe.status !== 'ready') report.notes.push('axe-core skipped: ' + axe.note);
    const results = new Array(targets.length);
    let next = 0;
    const budget = opts.timeout + 75000;
    await Promise.all(Array.from({ length: Math.min(opts.concurrency, targets.length) }, async () => {
      while (next < targets.length) {
        const i = next++;
        const t = targets[i];
        const holder = {};
        let res;
        try {
          res = await Promise.race([
            measureOne(browser, t, opts, axe, holder),
            sleep(budget).then(() => { const x = emptyResult(t); x.status = 'timeout'; x.reason = 'no result within ' + Math.round(budget / 1000) + ' s'; return x; })
          ]);
        } catch (e) {
          res = emptyResult(t);
          res.reason = firstLine(e);
        }
        if (holder.ctx) await holder.ctx.close().catch(() => {});
        results[i] = res;
        if (!opts.quiet && !opts.json) process.stderr.write(`  ${res.status.padEnd(7)} ${t.name}${res.status === 'ok' ? ' (score ' + res.score.total + ', ' + mbText(res.bytes.total) + ' MB)' : ': ' + res.reason}\n`);
      }
    }));
    report.results = results;
    const v = results.map((x) => x.axe && x.axe.version).find(Boolean);
    if (v) report.axe.version = v;
  } finally {
    if (browser) await browser.close().catch(() => {});
    await srv.close();
  }
  report.seconds = Math.round((Date.now() - started) / 100) / 10;
  fs.writeFileSync(path.join(opts.out, 'bench.json'), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(opts.out, 'bench.md'), toMarkdown(report));
  return report;
}

async function main(argv) {
  let opts;
  try { opts = parseArgs(argv); } catch (e) { process.stderr.write('bench_compare: ' + e.message + '\n'); return 2; }
  if (opts.help) {
    process.stdout.write(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#!.*\n/, '') + '*/\n');
    return 0;
  }
  let report;
  try { report = await run(opts); } catch (e) {
    process.stderr.write('bench_compare: crashed: ' + (e && e.stack ? e.stack : e) + '\n');
    return 2;
  }
  if (opts.json) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  else {
    const md = toMarkdown(report).split('\n## ')[0];
    const rel = (p) => { const x = path.relative(process.cwd(), p); return x && !x.startsWith('..') ? x : p; };
    process.stdout.write(md + '\n' + report.notes.map((n) => 'note: ' + n + '\n').join('') +
      `Measured ${report.results.filter((x) => x.status === 'ok').length} of ${report.results.length} in ${report.seconds}s. Full report: ${rel(path.join(opts.out, 'bench.md'))} and bench.json\n`);
  }
  return 0;
}

module.exports = { run, parseArgs, loadTargets, buildTargets, scoreOf, toMarkdown, darkVerdict, CTA_PATTERN, SKIP_PATTERN, CTA_WORDS, AXE_VERSION, THROTTLE };

if (require.main === module) main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
