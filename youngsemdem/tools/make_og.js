#!/usr/bin/env node
/**
 * tools/make_og.js: renders each page's link-preview image (1200 x 630 PNG, type only, under 150 KB)
 * from its <meta name="ysd:og"> with the og-* templates in assets/js/cards-og.js (BRIEF 5.8, 7.8).
 *
 *   node tools/make_og.js                         # every page that has ysd:og (EN, es/, events/, quiz/...)
 *   node tools/make_og.js --pages index.html,es/index.html
 *   node tools/make_og.js --check                 # render nothing; check files, sizes and meta (exit 1 on problems)
 *   node tools/make_og.js --samples               # every template in sample colours -> tools/.cache/og-samples/
 *   node tools/make_og.js --absolutize            # launch: og:image, twitter:image and hreflang -> absolute URLs
 *                                                 #   from config site.url (or --site https://...)
 *
 * The page declares its image:
 *   <meta property="og:image" content="assets/img/og/events.png">
 *   <meta name="ysd:og" content='{"template":"og-page","kicker":"THIS MONTH","title":"Free hangouts all over Seminole"}'>
 * The PNG is written where og:image points (it must be under assets/img/og/; es/ pages point at
 * assets/img/og/es/, which make_es.js sets up). With no og:image meta it falls back to
 * assets/img/og/[es/]<page>.png and warns. "keys": {"title": "seo.events.ogTitle"} in the JSON are
 * resolved from data/strings.js or data/pages/*.js in the page's language. Files are only rewritten
 * when the bytes change, so a second run changes nothing.
 *
 * Options: --root DIR  --pages a,b  --check  --samples  --absolutize  --site URL  --json  --quiet  --timeout MS
 * Exit codes: 0 ok, 1 problems found, 2 bad input or crash.
 * Module: require('./tools/make_og') exports { run, collect, pngSize, absolutizeHtml, MAX_BYTES }.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const es = require('./make_es');

const ROOT = path.resolve(__dirname, '..');
const P = path.posix;
const MAX_BYTES = 150 * 1024;
const WIDTH = 1200, HEIGHT = 630;
const SKIP_DIRS = new Set(['tools', 'tests', 'docs', 'partials', 'netlify', 'functions', 'vendor', 'dist', 'build', 'node_modules']);
const TEMPLATES = ['og-page', 'og-event', 'og-quiz'];

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
  return out;
}

/** {width, height} from a PNG's IHDR, or null. */
function pngSize(buf) {
  if (!buf || buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47 || buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// ------------------------------------------------------------------------------------------
// PNG codec (no dependencies): decode for pixel checks, palette re-encode to keep cards small
// ------------------------------------------------------------------------------------------

const zlib = require('zlib');
let CRC_TABLE = null;
function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Decode an 8-bit, non-interlaced PNG to {width, height, data: RGBA Uint8Array}. */
function decodePNG(buf) {
  if (!pngSize(buf)) throw new Error('not a PNG');
  let off = 8, width = 0, height = 0, depth = 0, ct = 0, interlace = 0, plte = null, trns = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8), d = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { width = d.readUInt32BE(0); height = d.readUInt32BE(4); depth = d[8]; ct = d[9]; interlace = d[12]; }
    else if (type === 'PLTE') plte = d;
    else if (type === 'tRNS') trns = d;
    else if (type === 'IDAT') idat.push(d);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8 || interlace) throw new Error('only 8-bit non-interlaced PNGs are supported');
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct];
  if (!ch) throw new Error('unsupported PNG colour type ' + ct);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * ch, px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[dst + x - ch] : 0, b = y ? px[dst - stride + x] : 0, c = x >= ch && y ? px[dst - stride + x - ch] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[dst + x] = v & 255;
    }
  }
  const out = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i++, j += 4) {
    if (ct === 6) { out[j] = px[i * 4]; out[j + 1] = px[i * 4 + 1]; out[j + 2] = px[i * 4 + 2]; out[j + 3] = px[i * 4 + 3]; }
    else if (ct === 2) { out[j] = px[i * 3]; out[j + 1] = px[i * 3 + 1]; out[j + 2] = px[i * 3 + 2]; out[j + 3] = 255; }
    else if (ct === 3) { const k = px[i]; out[j] = plte[k * 3]; out[j + 1] = plte[k * 3 + 1]; out[j + 2] = plte[k * 3 + 2]; out[j + 3] = trns && k < trns.length ? trns[k] : 255; }
    else if (ct === 0) { out[j] = out[j + 1] = out[j + 2] = px[i]; out[j + 3] = 255; }
    else { out[j] = out[j + 1] = out[j + 2] = px[i * 2]; out[j + 3] = px[i * 2 + 1]; }
  }
  return { width, height, data: out };
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Median-cut palette (at most `max` colours) for opaque RGBA pixels. Returns {palette, index}. */
function quantize(data, max) {
  const n = data.length / 4, hist = new Map();
  for (let i = 0; i < n; i++) { const k = (data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2]; hist.set(k, (hist.get(k) || 0) + 1); }
  const colors = Array.from(hist, ([k, c]) => [(k >> 16) & 255, (k >> 8) & 255, k & 255, c]).sort((a, b) => b[3] - a[3]);
  if (colors.length <= max) {
    const palette = colors.map((c) => [c[0], c[1], c[2]]);
    const pos = new Map(colors.map((c, i) => [(c[0] << 16) | (c[1] << 8) | c[2], i]));
    const index = new Uint8Array(n);
    for (let i = 0; i < n; i++) index[i] = pos.get((data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2]);
    return { palette, index, exact: true };
  }
  // Keep every colour that covers a real area exactly (flat brand fills, even small ones like a
  // button), then median-cut the anti-aliasing in between into the slots that are left.
  const reserved = colors.filter((c) => c[3] >= Math.max(40, n * 0.0002)).slice(0, Math.floor(max * 0.4));
  const rest = colors.slice(reserved.length);
  let boxes = rest.length ? [rest] : [];
  const range = (b) => { const r = [255, 255, 255, 0, 0, 0]; for (const c of b) for (let q = 0; q < 3; q++) { if (c[q] < r[q]) r[q] = c[q]; if (c[q] > r[q + 3]) r[q + 3] = c[q]; } return r; };
  while (boxes.length && boxes.length < max - reserved.length) {
    let best = -1, bestScore = 0, axis = 0;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.length < 2) continue;
      const r = range(b), sp = [r[3] - r[0], r[4] - r[1], r[5] - r[2]], ax = sp.indexOf(Math.max.apply(null, sp));
      let wsum = 0; for (const c of b) wsum += c[3];
      const score = sp[ax] * sp[ax] * Math.log2(2 + wsum);
      if (score > bestScore) { bestScore = score; best = i; axis = ax; }
    }
    if (best < 0) break;
    const b = boxes[best].sort((x, y) => x[axis] - y[axis]);
    let total = 0; for (const c of b) total += c[3];
    let acc = 0, cut = 1;
    for (let i = 0; i < b.length - 1; i++) { acc += b[i][3]; if (acc >= total / 2) { cut = i + 1; break; } }
    boxes.splice(best, 1, b.slice(0, cut), b.slice(cut));
  }
  const palette = reserved.map((c) => [c[0], c[1], c[2]]).concat(boxes.map((b) => { let r = 0, g = 0, bl = 0, w = 0; for (const c of b) { r += c[0] * c[3]; g += c[1] * c[3]; bl += c[2] * c[3]; w += c[3]; } return [Math.round(r / w), Math.round(g / w), Math.round(bl / w)]; }));
  const lut = new Map();
  for (const [k] of hist) {
    const r = (k >> 16) & 255, g = (k >> 8) & 255, b = k & 255;
    let bi = 0, bd = Infinity;
    for (let p = 0; p < palette.length; p++) { const dr = r - palette[p][0], dg = g - palette[p][1], db = b - palette[p][2], d = dr * dr * 3 + dg * dg * 4 + db * db * 2; if (d < bd) { bd = d; bi = p; } }
    lut.set(k, bi);
  }
  const index = new Uint8Array(n);
  for (let i = 0; i < n; i++) index[i] = lut.get((data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2]);
  return { palette, index, exact: hist.size <= max };
}

/** Encode RGBA as an indexed PNG (opaque images) or truecolour+alpha. */
function encodePNG(img, opts) {
  opts = opts || {};
  const { width, height, data } = img;
  let opaque = true;
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) { opaque = false; break; }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  let raw, extra = [];
  if (opaque && opts.palette !== false) {
    const q = quantize(data, opts.colors || 256);
    ihdr[9] = 3;
    const plte = Buffer.alloc(q.palette.length * 3);
    q.palette.forEach((c, i) => { plte[i * 3] = c[0]; plte[i * 3 + 1] = c[1]; plte[i * 3 + 2] = c[2]; });
    extra.push(chunk('PLTE', plte));
    raw = Buffer.alloc((width + 1) * height);
    for (let y = 0; y < height; y++) { raw[y * (width + 1)] = 0; Buffer.from(q.index.buffer, y * width, width).copy(raw, y * (width + 1) + 1); }
  } else {
    ihdr[9] = 6;
    const stride = width * 4;
    raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y++) {
      raw[y * (stride + 1)] = 1; // Sub filter
      for (let x = 0; x < stride; x++) raw[y * (stride + 1) + 1 + x] = (data[y * stride + x] - (x >= 4 ? data[y * stride + x - 4] : 0)) & 255;
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9, memLevel: 9 });
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr)].concat(extra, [chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]));
}

/** Smaller PNG for flat, type-only art: 256-colour palette when that is smaller than the input. */
function optimizePNG(buf) {
  try {
    const img = decodePNG(buf);
    const out = encodePNG(img, { palette: true });
    return out.length < buf.length ? out : buf;
  } catch (e) { return buf; }
}

function headInfo(html) {
  const toks = es.annotate(html, es.tokenize(html));
  const info = { lang: 'en', og: null, ogRaw: null, ogImage: null, ogImageAlt: null, ogW: null, ogH: null, base: null, twitterCard: null };
  for (const t of toks) {
    if (t.type !== 'start') continue;
    if (t.name === 'html') info.lang = (es.attrVal(t, 'lang') || 'en').toLowerCase().slice(0, 2);
    if (t.name === 'base' && !t.partial) info.base = es.attrVal(t, 'href');
    if (t.name !== 'meta') continue;
    const key = (es.attrVal(t, 'property') || es.attrVal(t, 'name') || '').toLowerCase();
    const c = es.attrVal(t, 'content');
    if (key === 'ysd:og') { info.ogRaw = c; try { info.og = JSON.parse(c); } catch (e) { info.og = { __error: e.message }; } }
    else if (key === 'og:image' && info.ogImage == null) info.ogImage = c;
    else if (key === 'og:image:alt') info.ogImageAlt = c;
    else if (key === 'og:image:width') info.ogW = c;
    else if (key === 'og:image:height') info.ogH = c;
    else if (key === 'twitter:card') info.twitterCard = c;
  }
  return info;
}

/** Root-relative output path for a page's og:image, or {error}. */
function outPath(pageRel, info, site) {
  const dir = info.base && info.base.startsWith('/') ? info.base.replace(/^\//, '') : (P.dirname(pageRel) === '.' ? '' : P.dirname(pageRel) + '/');
  let target = null;
  const v = info.ogImage;
  if (v) {
    const s = v.trim().split(/[?#]/)[0];
    if (/^https?:\/\//i.test(s)) {
      if (site && s.startsWith(site + '/')) target = s.slice(site.length + 1);
      else { const m = /^https?:\/\/[^/]+\/(.*)$/.exec(s); target = m ? m[1] : null; }
    } else if (s.startsWith('/')) target = s.slice(1);
    else target = P.normalize(P.join(dir || '.', s));
  }
  let fallback = false;
  if (!target) {
    fallback = true;
    const stem = pageRel.replace(/^es\//, '').replace(/\.html$/i, '').replace(/(^|\/)index$/, '$1home').replace(/\/$/, '');
    target = 'assets/img/og/' + (pageRel.startsWith('es/') ? 'es/' : '') + (stem || 'home') + '.png';
  }
  if (!target.startsWith('assets/img/og/') || !/\.png$/i.test(target) || target.indexOf('..') >= 0) return { error: 'og:image "' + v + '" is not a PNG under assets/img/og/; make_og only writes there' };
  return { target, fallback };
}

function collect(root, opts) {
  opts = opts || {};
  const loaded = es.loadData(root);
  const ctx = { data: loaded.data, conf: loaded.conf };
  const site = String(es.cfg(loaded.conf, 'site.url', '') || '').replace(/\/+$/, '');
  const pages = opts.pages && opts.pages.length ? opts.pages : walkPages(root);
  const jobs = [], problems = [], notes = loaded.notes.slice();
  for (const rel of pages) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) { problems.push({ page: rel, severity: 'error', text: 'not found' }); continue; }
    const info = headInfo(fs.readFileSync(file, 'utf8'));
    if (!info.og) { if (opts.pages && opts.pages.length) problems.push({ page: rel, severity: 'warning', text: 'no <meta name="ysd:og">; it keeps the default image' }); continue; }
    if (info.og.__error) { problems.push({ page: rel, severity: 'error', text: 'ysd:og is not valid JSON: ' + info.og.__error }); continue; }
    const data = Object.assign({}, info.og);
    const template = data.template || 'og-page';
    delete data.template;
    if (TEMPLATES.indexOf(template) < 0) { problems.push({ page: rel, severity: 'error', text: 'unknown template "' + template + '" (use ' + TEMPLATES.join(', ') + ')' }); continue; }
    const lang = data.lang || info.lang || 'en';
    data.lang = lang === 'es' ? 'es' : 'en';
    if (data.keys && typeof data.keys === 'object') {
      for (const f of Object.keys(data.keys)) {
        const r = es.valueFor(ctx, data.keys[f], data.lang);
        if (!r.error || r.error === 'unfilled') data[f] = r.text;
        else problems.push({ page: rel, severity: 'error', text: 'ysd:og key ' + data.keys[f] + ' (' + f + '): ' + r.error });
      }
    }
    if (data.lang === 'en') delete data.es;
    else if (data.es && typeof data.es === 'object') Object.assign(data, data.es);
    delete data.keys; delete data.es;
    const o = outPath(rel, info, site);
    if (o.error) { problems.push({ page: rel, severity: 'error', text: o.error }); continue; }
    if (o.fallback) problems.push({ page: rel, severity: 'warning', text: 'no og:image meta; writing ' + o.target + ' (add <meta property="og:image" content="...">)' });
    if (/(^|\/)default\.png$/.test(o.target)) { problems.push({ page: rel, severity: 'warning', text: 'og:image points at ' + o.target + ' (F0\'s default); give the page its own image path. Skipped.' }); continue; }
    if (!data.title) problems.push({ page: rel, severity: 'error', text: 'ysd:og has no title' });
    if (!info.ogImageAlt) problems.push({ page: rel, severity: 'warning', text: 'no og:image:alt' });
    if ((info.ogW && info.ogW !== String(WIDTH)) || (info.ogH && info.ogH !== String(HEIGHT))) problems.push({ page: rel, severity: 'error', text: 'og:image:width/height say ' + info.ogW + 'x' + info.ogH + ', images are ' + WIDTH + 'x' + HEIGHT });
    jobs.push({ page: rel, template, data, out: o.target });
  }
  // two pages writing one file with different content is a mistake
  const byOut = {};
  for (const j of jobs) {
    const k = JSON.stringify([j.template, j.data]);
    if (byOut[j.out] && byOut[j.out].k !== k) problems.push({ page: j.page, severity: 'error', text: j.out + ' is also the image of ' + byOut[j.out].page + ' with different text' });
    else byOut[j.out] = { k, page: j.page };
  }
  return { jobs, problems, notes, site, conf: loaded.conf };
}

const SAMPLES = [
  { name: 'page-violet', template: 'og-page', data: { kicker: 'This month', title: 'Free hangouts all over Seminole', accent: 'all over Seminole', sub: 'Trivia, a voter workshop and a Riverwalk cleanup.' } },
  { name: 'page-celery-es', template: 'og-page', data: { lang: 'es', color: 'celery', kicker: 'De 14 a 39 años', title: 'La política local es un trabajo en equipo', accent: 'trabajo en equipo', sticker: 'heart' } },
  { name: 'page-lake-serious', template: 'og-page', data: { color: 'lake', kicker: 'Heads-up', title: 'Asked for a mail ballot before Nov 3? That request ends Dec 31.', sticker: 'envelope' } },
  { name: 'event-sky', template: 'og-event', data: { title: 'Trivia night: Seminole County edition', start: '2026-11-19T19:00:00-05:00', place: 'Casselberry', color: 'sky', sticker: 'sun' } },
  { name: 'event-bubblegum-es', template: 'og-event', data: { lang: 'es', title: 'Taller para votar en español', start: '2026-12-05T10:30:00-05:00', place: 'Sanford', color: 'bubblegum' } },
  { name: 'event-violet', template: 'og-event', data: { title: 'Riverwalk cleanup and coffee', start: '2026-11-21T09:00:00-05:00', place: 'Sanford Riverwalk', color: 'violet' } },
  { name: 'quiz-violet', template: 'og-quiz', data: { kicker: 'How do you show up?', title: 'The Connector', sub: 'You turn one invite into five.' } },
  { name: 'quiz-tangerine-es', template: 'og-quiz', data: { lang: 'es', color: 'tangerine', kicker: '¿Cómo participas?', title: 'La Conectora', sub: 'Conviertes una invitación en cinco.' } }
];

async function render(root, jobs, opts) {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) { throw new Error('Playwright is not installed (require("playwright") failed)'); }
  const { createServer } = require('./check_site');
  const srv = createServer(root, {});
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch();
  const results = [];
  const notes = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e && e.message || e)));
    const ogPage = fs.existsSync(path.join(root, 'tools', 'og.html')) ? 'tools/og.html' : null;
    if (!ogPage) throw new Error('tools/og.html is missing under ' + root);
    await page.goto(base + ogPage, { waitUntil: 'load', timeout: opts.timeout || 30000 });
    if (fs.existsSync(path.join(root, 'data', 'stickers.js'))) await page.addScriptTag({ url: base + 'data/stickers.js' }).catch(() => notes.push('data/stickers.js did not load; drawn stickers used'));
    const ready = await page.evaluate(async () => {
      const specs = ['800 100px "Bricolage Grotesque"', '400 30px "Atkinson Hyperlegible Next"', '800 30px "Atkinson Hyperlegible Next"'];
      try { await Promise.all(specs.map((s) => document.fonts.load(s))); await document.fonts.ready; } catch (e) { /* reported below */ }
      if (window.YSD_CONFIG) { window.YSD_CONFIG.cards = window.YSD_CONFIG.cards || {}; window.YSD_CONFIG.cards.demoWatermark = false; }
      return { engine: !!(window.YSD && YSD.cards && YSD.cards.render), og: !!(window.YSD && YSD.cardsOg), fonts: specs.map((s) => document.fonts.check(s)) };
    });
    if (!ready.engine) throw new Error('assets/js/cards.js did not load in tools/og.html');
    if (!ready.og) throw new Error('assets/js/cards-og.js did not register its templates' + (errs.length ? ': ' + errs[0] : ''));
    if (ready.fonts.some((x) => !x)) notes.push('brand fonts did not load (assets/fonts/*.woff2); images use fallback fonts');
    for (const j of jobs) {
      try {
        const b64 = await page.evaluate(async ({ template, data }) => {
          const c = await YSD.cards.render(template, data, { width: 1200, height: 630 });
          return c.toDataURL('image/png').split(',')[1];
        }, { template: j.template, data: j.data });
        results.push(Object.assign({}, j, { png: opts.raw ? Buffer.from(b64, 'base64') : optimizePNG(Buffer.from(b64, 'base64')) }));
      } catch (e) {
        results.push(Object.assign({}, j, { error: String(e && e.message || e).split('\n')[0] }));
      }
    }
  } finally {
    await browser.close().catch(() => {});
    srv.close();
  }
  return { results, notes };
}

// ------------------------------------------------------------------------------------------
// --absolutize
// ------------------------------------------------------------------------------------------

/** Rewrite relative og:image / twitter:image / hreflang hrefs in one page to absolute URLs. */
function absolutizeHtml(html, pageRel, site) {
  const toks = es.annotate(html, es.tokenize(html));
  let dir = P.dirname(pageRel) === '.' ? '' : P.dirname(pageRel);
  for (const t of toks) if (t.type === 'start' && t.name === 'base' && !t.partial) { const h = es.attrVal(t, 'href'); if (h && h.startsWith('/')) dir = h.replace(/^\/|\/$/g, ''); }
  const edits = [];
  const abs = (u, pretty) => {
    const s = String(u || '').trim();
    if (!s || /^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith('//') || s.startsWith('#')) return null;
    const m = /^([^?#]*)([?#].*)?$/.exec(s);
    let target = s.startsWith('/') ? m[1].slice(1) : P.normalize(P.join(dir || '.', m[1]));
    if (target === '.') target = '';
    return site + (pretty ? es.prettyPath(target || 'index.html') : '/' + target) + (m[2] || '');
  };
  for (const t of toks) {
    if (t.type !== 'start' || t.partial) continue;
    let a = null, nv = null;
    if (t.name === 'meta') {
      const key = (es.attrVal(t, 'property') || es.attrVal(t, 'name') || '').toLowerCase();
      if (['og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image'].indexOf(key) >= 0) { a = es.attr(t, 'content'); nv = a && abs(a.value, false); }
    } else if (t.name === 'link' && es.attr(t, 'hreflang')) { a = es.attr(t, 'href'); nv = a && abs(a.value, true); }
    if (a && nv && a.vStart >= 0) edits.push({ start: a.vStart, end: a.vEnd, text: es.escapeAttr(nv, a.quote || '"') });
  }
  edits.sort((x, y) => y.start - x.start);
  let out = html;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return { html: out, changed: edits.length };
}

// ------------------------------------------------------------------------------------------
// CLI
// ------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const o = { root: ROOT, pages: [], check: false, samples: false, absolutize: false, site: '', json: false, quiet: false, timeout: 30000, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) throw new Error(a + ' needs a value'); return argv[++i]; };
    if (a === '--root') o.root = path.resolve(val());
    else if (a === '--pages') o.pages = o.pages.concat(val().split(',').map((s) => s.trim()).filter(Boolean));
    else if (a === '--check') o.check = true;
    else if (a === '--samples') o.samples = true;
    else if (a === '--absolutize') o.absolutize = true;
    else if (a === '--site') o.site = val().replace(/\/+$/, '');
    else if (a === '--json') o.json = true;
    else if (a === '--quiet') o.quiet = true;
    else if (a === '--raw') o.raw = true;
    else if (a === '--timeout') o.timeout = parseInt(val(), 10) || 30000;
    else if (a === '-h' || a === '--help') o.help = true;
    else if (a.startsWith('--')) throw new Error('unknown option ' + a);
    else o.pages.push(a);
  }
  return o;
}

async function run(opts) {
  const root = opts.root;
  const report = { tool: 'tools/make_og.js', mode: opts.absolutize ? 'absolutize' : opts.samples ? 'samples' : opts.check ? 'check' : 'write', root, images: [], problems: [], notes: [], written: [], errors: 0, warnings: 0 };
  const fin = () => { for (const p of report.problems) { if (p.severity === 'error') report.errors++; else report.warnings++; } return report; };

  if (opts.absolutize) {
    const conf = es.loadData(root).conf;
    const site = (opts.site || String(es.cfg(conf, 'site.url', '') || '')).replace(/\/+$/, '');
    if (!/^https?:\/\/[^/]+/.test(site)) { report.problems.push({ severity: 'error', text: 'site.url is not set in assets/js/config.js (or pass --site https://...); nothing to absolutize against', fatal: true }); return fin(); }
    report.site = site;
    for (const rel of opts.pages.length ? opts.pages : walkPages(root)) {
      const file = path.join(root, rel);
      const html = fs.readFileSync(file, 'utf8');
      const r = absolutizeHtml(html, rel, site);
      if (r.html !== html) {
        if (opts.check) report.problems.push({ page: rel, severity: 'error', text: r.changed + ' relative og:image/hreflang URL(s); run node tools/make_og.js --absolutize' });
        else { fs.writeFileSync(file, r.html); report.written.push(rel); }
      }
    }
    return fin();
  }

  if (opts.samples) {
    const out = path.join(root, 'tools', '.cache', 'og-samples');
    fs.mkdirSync(out, { recursive: true });
    const r = await render(root, SAMPLES.map((s) => ({ page: '(sample)', template: s.template, data: s.data, out: path.relative(root, path.join(out, s.name + '.png')) })), opts);
    report.notes.push(...r.notes);
    for (const x of r.results) {
      const img = { page: x.page, template: x.template, out: x.out, bytes: x.png ? x.png.length : 0, status: x.error ? 'error' : 'written' };
      if (x.error) report.problems.push({ page: x.out, severity: 'error', text: x.error });
      else fs.writeFileSync(path.join(root, x.out), x.png);
      report.images.push(img);
    }
    return fin();
  }

  const c = collect(root, { pages: opts.pages });
  report.notes.push(...c.notes);
  report.problems.push(...c.problems);
  if (!c.jobs.length) { report.notes.push('no page declares <meta name="ysd:og"> yet; nothing to render'); return fin(); }

  if (opts.check) {
    for (const j of c.jobs) {
      const file = path.join(root, j.out);
      const img = { page: j.page, template: j.template, out: j.out, bytes: 0, status: 'ok' };
      if (!fs.existsSync(file)) { img.status = 'missing'; report.problems.push({ page: j.page, severity: 'error', text: j.out + ' does not exist: run node tools/make_og.js --pages ' + j.page }); }
      else {
        const buf = fs.readFileSync(file);
        img.bytes = buf.length;
        const sz = pngSize(buf);
        if (!sz) { img.status = 'bad'; report.problems.push({ page: j.page, severity: 'error', text: j.out + ' is not a PNG' }); }
        else if (sz.width !== WIDTH || sz.height !== HEIGHT) { img.status = 'bad'; report.problems.push({ page: j.page, severity: 'error', text: j.out + ' is ' + sz.width + 'x' + sz.height + ', not 1200x630' }); }
        if (buf.length > MAX_BYTES) { img.status = 'bad'; report.problems.push({ page: j.page, severity: 'error', text: j.out + ' is ' + Math.round(buf.length / 1024) + ' KB (max 150 KB)' }); }
      }
      report.images.push(img);
    }
    return fin();
  }

  const r = await render(root, c.jobs, opts);
  report.notes.push(...r.notes);
  for (const x of r.results) {
    const img = { page: x.page, template: x.template, out: x.out, bytes: x.png ? x.png.length : 0, status: 'error' };
    report.images.push(img);
    if (x.error) { report.problems.push({ page: x.page, severity: 'error', text: 'render failed: ' + x.error }); continue; }
    const sz = pngSize(x.png);
    if (!sz || sz.width !== WIDTH || sz.height !== HEIGHT) { report.problems.push({ page: x.page, severity: 'error', text: 'rendered ' + (sz ? sz.width + 'x' + sz.height : 'no PNG') }); continue; }
    if (x.png.length > MAX_BYTES) { report.problems.push({ page: x.page, severity: 'error', text: x.out + ' would be ' + Math.round(x.png.length / 1024) + ' KB (max 150 KB); shorten the text or use a flatter colour' }); continue; }
    const file = path.join(root, x.out);
    const old = fs.existsSync(file) ? fs.readFileSync(file) : null;
    if (old && old.equals(x.png)) { img.status = 'unchanged'; continue; }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, x.png);
    img.status = 'written';
    report.written.push(x.out);
  }
  return fin();
}

function printReport(report, opts) {
  const L = [];
  for (const n of report.notes) L.push('note: ' + n);
  for (const i of report.images) L.push(`${i.status === 'error' || i.status === 'missing' || i.status === 'bad' ? 'FAIL' : 'ok  '} ${i.out}  ${(i.bytes / 1024).toFixed(1)} KB  ${i.template}  (${i.page})  ${i.status}`);
  for (const p of report.problems) if (!opts.quiet || p.severity === 'error') L.push(`${p.severity === 'error' ? 'error' : 'warn '} ${p.page ? p.page + ': ' : ''}${p.text}`);
  if (report.mode === 'absolutize') L.push(report.written.length ? 'absolutized ' + report.written.join(', ') : 'nothing to absolutize');
  L.push(`make_og: ${report.images.length} images, ${report.written.length} written, ${report.errors} errors, ${report.warnings} warnings (${report.mode})`);
  return L.join('\n');
}

async function main(argv) {
  let opts;
  try { opts = parseArgs(argv); } catch (e) { console.error('make_og: ' + e.message); return 2; }
  if (opts.help) {
    console.log('Usage: node tools/make_og.js [--pages a.html,es/a.html] [--check] [--samples] [--absolutize [--site URL]] [--root DIR] [--json] [--quiet]');
    return 0;
  }
  let report;
  try { report = await run(opts); } catch (e) { console.error('make_og crashed: ' + (e && e.stack || e)); return 2; }
  if (opts.json) console.log(JSON.stringify(report, null, 2));
  else console.log(printReport(report, opts));
  if (report.problems.some((p) => p.fatal)) return 2;
  return report.errors ? 1 : 0;
}

if (require.main === module) main(process.argv.slice(2)).then((c) => { process.exitCode = c; });

module.exports = { run, main, parseArgs, collect, render, pngSize, decodePNG, encodePNG, optimizePNG, quantize, absolutizeHtml, walkPages, headInfo, outPath, SAMPLES, MAX_BYTES, TEMPLATES };
