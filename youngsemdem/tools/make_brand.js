#!/usr/bin/env node
/**
 * tools/make_brand.js: build every brand asset from one source (round 1, genz-brand-20).
 *
 * The Saved Seat mark is an admit-one ticket stub (celery, night outline, notched ends, a perforation) with YD
 * lettered in from Bricolage Grotesque 800, tilted -8deg like a sticker: the site is the friend who already saved
 * you a seat, and the ticket is that seat. The wordmark is "Young Dems" in the same face, tracked tight, with the
 * Y's right arm raised like a hand going up and a marker swoosh under "Dems" (the hero's marker swipe). Both
 * read in one colour, the mark at 16 px. No flag, stars, donkey or Native imagery (BRIEF 3.7, ruling 00).
 *
 * Source of truth: YSD.cards.brand.paths in assets/js/cards.js (canvas cards draw from it too). This tool writes:
 *   assets/img/brand/mark.svg, mark-mono.svg, wordmark.svg, wordmark-cream.svg, lockup.svg, lockup-cream.svg
 *   assets/img/brand/explore-a-seat-bubble.svg, explore-b-ticket.svg, explore-c-celery-y.svg (the three directions
 *     explored; B was picked: strongest at 16 px, one colour, and it is literally the saved seat)
 *   assets/icons/favicon.svg (switches its outline for dark tabs), icon-192.png, icon-512.png,
 *     icon-maskable-512.png, icon-mono-512.png (Android themed icons), apple-touch-icon.png (180)
 *   assets/img/og/default.png and es/default.png (1200 x 630, F0's default link previews, type-only, DEMO band)
 * The header partials carry the same paths inline (no web-font wait, no layout shift); --check verifies them.
 *
 * Usage: node tools/make_brand.js [--check] [--no-png] [--root DIR]
 *   --check   exit 1 when a partial or an SVG file is out of step with cards.js (PNGs are not compared)
 *   --no-png  write the SVG files only (no browser)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const args = process.argv.slice(2);
const ROOT = args.includes('--root') ? path.resolve(args[args.indexOf('--root') + 1]) : path.resolve(__dirname, '..');
const CHECK = args.includes('--check');
const NO_PNG = args.includes('--no-png');

function brandPaths() {
  const win = { console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, Math, JSON, Promise };
  win.window = win;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js/cards.js'), 'utf8'), vm.createContext(win), { filename: 'cards.js' });
  if (!win.YSD || !win.YSD.cards || !win.YSD.cards.brand) throw new Error('assets/js/cards.js has no YSD.cards.brand');
  return win.YSD.cards.brand.paths;
}
const B = brandPaths();
const M = B.mark, W = B.word, C = { violet: '#6A2BFF', celery: '#C8F03C', night: '#170B33', cream: '#FFF6EA', pink: '#FF7AC6', white: '#FFFFFF' };
const ROT = `rotate(${M.rotate} ${M.cx} ${M.cy})`;
const NS = 'xmlns="http://www.w3.org/2000/svg"';

function mark(o) {
  o = o || {};
  const vb = o.viewBox || M.viewBox;
  return `<svg ${NS} viewBox="${vb}"${o.size ? ` width="${o.size}" height="${o.size}"` : ''}>${o.title ? `<title>${o.title}</title>` : ''}`
    + (o.style ? `<style>${o.style}</style>` : '')
    + `<g transform="${ROT}"><path${o.ticketClass ? ` class="${o.ticketClass}"` : ''} d="${M.ticket}" fill="${o.body || C.celery}" stroke="${o.edge || C.night}" stroke-width="${o.edgeWidth || 3}" stroke-linejoin="round"/>`
    + `<path d="${M.perf}${M.letters}" fill="${o.ink || C.night}"/></g></svg>`;
}
function markMono(fill, title) {
  return `<svg ${NS} viewBox="${M.viewBox}">${title ? `<title>${title}</title>` : ''}<path transform="${ROT}" fill-rule="evenodd" fill="${fill}" d="${M.ticket}${M.perf}${M.letters}"/></svg>`;
}
function wordmark(fill, swoosh, title) {
  return `<svg ${NS} viewBox="${W.viewBox}">${title ? `<title>${title}</title>` : ''}<path d="${W.swoosh}" fill="none" stroke="${swoosh}" stroke-width="${W.swooshWidth}" stroke-linecap="round"/><path d="${W.d}" fill="${fill}"/></svg>`;
}
function lockup(fill, swoosh, edge, title) {
  // mark box 1000 units tall next to the wordmark at half that height, like YSD.cards.brand.lockup
  const s = 1000 / 64, ww = W.width * (500 / W.height), w = Math.round(1020 + ww + 40);
  return `<svg ${NS} viewBox="0 0 ${w} 1000">${title ? `<title>${title}</title>` : ''}`
    + `<g transform="scale(${s})"><g transform="${ROT}"><path d="${M.ticket}" fill="${C.celery}" stroke="${edge}" stroke-width="3" stroke-linejoin="round"/><path d="${M.perf}${M.letters}" fill="${C.night}"/></g></g>`
    + `<g transform="translate(1020 270) scale(${500 / W.height}) translate(${-W.x} ${-W.y})"><path d="${W.swoosh}" fill="none" stroke="${swoosh}" stroke-width="${W.swooshWidth}" stroke-linecap="round"/><path d="${W.d}" fill="${fill}"/></g></svg>`;
}
// The two directions that were explored and not picked, kept for the record (and the style guide).
const EXPLORE_A = `<svg ${NS} viewBox="0 0 64 64"><title>Explored: a folding chair in a speech bubble (not picked: reads as an L at 16 px)</title><path d="M14 4H50Q60 4 60 14V40Q60 50 50 50H28L13 61L16 50H14Q4 50 4 40V14Q4 4 14 4Z" fill="${C.violet}" stroke="${C.night}" stroke-width="3" stroke-linejoin="round"/><g fill="${C.celery}"><path d="M20 12h7v22h-7z" transform="rotate(-8 23.5 23)"/><path d="M21 31H45a3 3 0 0 1 0 6H21z"/><path d="M24 35l5 0 13 9-5 0z"/><path d="M40 35l5 0-12 9-5 0z"/></g><circle cx="44" cy="20" r="5.5" fill="${C.pink}" stroke="${C.night}" stroke-width="2"/></svg>`;
const EXPLORE_C = `<svg ${NS} viewBox="0 0 64 64"><title>Explored: a celery-stalk Y (not picked: reads as a slingshot or a fork when small)</title><path d="M28 60V38L14 16h9l9 15 9-15h9L36 38v22z" fill="${C.celery}" stroke="${C.night}" stroke-width="3" stroke-linejoin="round"/><g fill="#3F9A2C" stroke="${C.night}" stroke-width="2.5"><circle cx="13" cy="12" r="6"/><circle cx="20" cy="8" r="5"/><circle cx="44" cy="8" r="5"/><circle cx="51" cy="12" r="6"/></g><rect x="25" y="42" width="14" height="6" rx="2" fill="${C.violet}" stroke="${C.night}" stroke-width="2.5"/></svg>`;

const FILES = {
  'assets/img/brand/mark.svg': mark({ title: 'Young Dems' }),
  'assets/img/brand/mark-mono.svg': markMono(C.night, 'Young Dems'),
  'assets/img/brand/wordmark.svg': wordmark(C.night, C.celery, 'Young Dems'),
  'assets/img/brand/wordmark-cream.svg': wordmark(C.cream, C.pink, 'Young Dems'),
  'assets/img/brand/lockup.svg': lockup(C.night, C.celery, C.night, 'Young Dems'),
  'assets/img/brand/lockup-cream.svg': lockup(C.cream, C.pink, C.night, 'Young Dems'),
  'assets/img/brand/explore-a-seat-bubble.svg': EXPLORE_A,
  'assets/img/brand/explore-b-ticket.svg': mark({ title: 'Picked: the Saved Seat ticket' }),
  'assets/img/brand/explore-c-celery-y.svg': EXPLORE_C,
  // Tabs: a light outline on dark browser chrome (SVG favicons honour prefers-color-scheme).
  'assets/icons/favicon.svg': mark({ ticketClass: 't', style: '@media (prefers-color-scheme:dark){.t{stroke:#FFF6EA}}' })
};

// ------------------------------------------------------------------ check the partials
function checkPartials() {
  const problems = [];
  for (const f of ['partials/header.html', 'partials/header-es.html']) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    if (!s.includes(`d="${M.ticket}"`)) problems.push(f + ': brand__mark ticket path differs from YSD.cards.brand.paths.mark.ticket');
    if (!s.includes(`d="${M.perf}${M.letters}"`)) problems.push(f + ': brand__mark letters differ from cards.js');
    if (!s.includes(`id="ysd-word" d="${W.d}"`)) problems.push(f + ': #ysd-word wordmark path differs from cards.js');
    if (!s.includes(`id="ysd-swoosh" class="brand__swoosh" d="${W.swoosh}"`)) problems.push(f + ': #ysd-swoosh differs from cards.js');
    if (!s.includes(`viewBox="${W.viewBox}"`)) problems.push(f + ': wordmark viewBox differs from cards.js');
  }
  for (const f of ['partials/footer.html', 'partials/footer-es.html']) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    if (!s.includes('href="#ysd-word"') || !s.includes(`viewBox="${W.viewBox}"`)) problems.push(f + ': footer wordmark should <use href="#ysd-word"> with the cards.js viewBox');
  }
  return problems;
}

// ------------------------------------------------------------------ PNGs (Playwright)
function iconHtml(size, kind) {
  // kind: any (violet rounded tile), maskable (full-bleed violet, ticket inside the 80% safe zone),
  // apple (full-bleed violet; iOS rounds it), mono (white silhouette on transparent, Android themed icons)
  const tile = kind === 'any' ? `border-radius:${Math.round(size * 0.22)}px;` : '';
  const bg = kind === 'mono' ? 'transparent' : C.violet;
  const scale = kind === 'maskable' ? 0.62 : kind === 'mono' ? 0.86 : 0.78;
  const art = kind === 'mono' ? markMono(C.white)
    : `<svg ${NS} viewBox="0 0 64 64" style="filter:drop-shadow(${size / 80}px 0 0 #fff) drop-shadow(-${size / 80}px 0 0 #fff) drop-shadow(0 ${size / 80}px 0 #fff) drop-shadow(0 -${size / 80}px 0 #fff) drop-shadow(${size / 40}px ${size / 40}px 0 ${C.night})"><g transform="${ROT}"><path d="${M.ticket}" fill="${C.celery}" stroke="${C.night}" stroke-width="3" stroke-linejoin="round"/><path d="${M.perf}${M.letters}" fill="${C.night}"/></g></svg>`;
  return `<!doctype html><html><head><style>html,body{margin:0;background:transparent}div{width:${size}px;height:${size}px;display:grid;place-items:center;background:${bg};${tile}}svg{width:${Math.round(size * scale)}px;height:${Math.round(size * scale)}px;overflow:visible}</style></head><body><div>${art}</div></body></html>`;
}
const OG_COPY = {
  en: { lang: 'en', pill: 'Young Democrats of Seminole County · Ages 14 to 39', l1: 'Local politics', pre: 'is a ', hi: 'group project.', paid: 'Paid for by [committee name and address placeholder]', size: 118 },
  es: { lang: 'es', pill: 'Young Democrats of Seminole County · De 14 a 39 años', l1: 'La política local', pre: 'es un trabajo ', hi: 'en equipo.', paid: 'Pagado por [nombre y dirección del comité: pendiente]', size: 90 }
};
function ogHtml(stickers, L) {
  L = L || OG_COPY.en;
  const st = (id, x, y, s, r) => `<span class="st" style="left:${x}px;top:${y}px;width:${s}px;height:${s}px;rotate:${r}deg">${stickers[id] || ''}</span>`;
  return `<!doctype html><html lang="${L.lang}"><head><meta charset="utf-8"><link rel="stylesheet" href="../../assets/css/tokens.css"><style>
  html,body{margin:0}body{width:1200px;height:630px;overflow:hidden;background:${C.violet};font-family:var(--font-body);color:${C.cream};position:relative}
  .pill{position:absolute;left:64px;top:56px;padding:12px 22px;border:3px solid ${C.night};border-radius:999px;background:${C.celery};color:${C.night};font:700 21px/1 var(--font-body);letter-spacing:.08em;text-transform:uppercase;box-shadow:5px 5px 0 ${C.night};rotate:-1.5deg}
  h1{position:absolute;left:60px;top:132px;margin:0;font:800 ${L.size}px/.9 var(--font-display-76);font-stretch:76%;letter-spacing:-.025em;color:${C.cream}}
  h1 span{display:block;white-space:nowrap}h1 .hi{color:${C.celery}}h1 .mk{position:relative;display:inline-block;isolation:isolate}
  h1 .mk::after{content:"";position:absolute;z-index:-1;left:-.03em;right:-.04em;bottom:-.17em;height:.085em;border-radius:999px;background:${C.pink};rotate:-1deg}
  .big{position:absolute;right:34px;top:150px;width:286px;height:286px;filter:drop-shadow(6px 0 0 #fff) drop-shadow(-6px 0 0 #fff) drop-shadow(0 6px 0 #fff) drop-shadow(0 -6px 0 #fff) drop-shadow(12px 12px 0 ${C.night})}
  .big svg{width:100%;height:100%;overflow:visible}
  .st{position:absolute;display:block;filter:drop-shadow(4px 0 0 #fff) drop-shadow(-4px 0 0 #fff) drop-shadow(0 4px 0 #fff) drop-shadow(0 -4px 0 #fff) drop-shadow(0 8px 10px rgba(23,11,51,.35))}.st svg{width:100%;height:100%}
  .lock{position:absolute;left:64px;top:430px;height:74px}.lock svg{height:100%;width:auto;overflow:visible}
  .band{position:absolute;left:0;right:0;bottom:0;height:66px;background:${C.night};display:flex;align-items:center;justify-content:space-between;padding:0 56px;font:700 21px/1 var(--font-body);color:${C.cream}}
  .demo{padding:9px 18px;border-radius:999px;background:#FF8B3D;color:${C.night};letter-spacing:.06em}
  </style></head><body>
  <p class="pill" translate="no">${L.pill}</p>
  <h1><span>${L.l1}</span><span class="hi">${L.pre}<span class="mk">${L.hi}</span></span></h1>
  <div class="big">${mark({ viewBox: '0 0 64 64' })}</div>
  ${st('lake', 862, 400, 124, -8)}${st('manatee', 1030, 420, 112, 9)}
  <div class="lock">${lockup(C.cream, C.pink, C.night)}</div>
  <div class="band"><span>${L.paid}</span><span class="demo">DEMO</span></div>
  </body></html>`;
}
async function renderPngs() {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) { console.warn('make_brand: Playwright not found; PNGs skipped'); return []; }
  const cs = require('./check_site.js');
  const server = cs.createServer(ROOT, {});
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const cacheDir = path.join(ROOT, 'tools', '.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const browser = await chromium.launch();
  const out = [];
  try {
    const icons = [['assets/icons/icon-192.png', 192, 'any'], ['assets/icons/icon-512.png', 512, 'any'], ['assets/icons/icon-maskable-512.png', 512, 'maskable'],
      ['assets/icons/icon-mono-512.png', 512, 'mono'], ['assets/icons/apple-touch-icon.png', 180, 'apple']];
    for (const [file, size, kind] of icons) {
      const page = await browser.newPage({ viewport: { width: size, height: size } });
      await page.setContent(iconHtml(size, kind));
      await page.screenshot({ path: path.join(ROOT, file), omitBackground: kind === 'any' || kind === 'mono', clip: { x: 0, y: 0, width: size, height: size } });
      await page.close();
      out.push(file);
    }
    // default OG: served over http so the brand fonts load
    const win = { console: { log() {} } }; win.window = win;
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'data/stickers.js'), 'utf8'), vm.createContext(win));
    const stickers = {};
    for (const s of (win.YSD_DATA && win.YSD_DATA.stickers && win.YSD_DATA.stickers.items) || []) stickers[s.id] = s.svg;
    for (const [lang, file] of [['en', 'assets/img/og/default.png'], ['es', 'assets/img/og/es/default.png']]) {
      fs.writeFileSync(path.join(cacheDir, 'brand-og.html'), ogHtml(stickers, OG_COPY[lang]));
      const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
      await page.goto(base + '/tools/.cache/brand-og.html', { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      fs.mkdirSync(path.dirname(path.join(ROOT, file)), { recursive: true });
      await page.screenshot({ path: path.join(ROOT, file) });
      await page.close();
      out.push(file);
    }
  } finally {
    await browser.close();
    server.close();
  }
  return out;
}

async function main() {
  const problems = checkPartials();
  const stale = [];
  for (const [rel, body] of Object.entries(FILES)) {
    const abs = path.join(ROOT, rel), want = body + '\n';
    const have = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
    if (have === want) continue;
    if (CHECK) { stale.push(rel); continue; }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, want);
    console.log('wrote ' + rel);
  }
  if (CHECK) {
    for (const s of stale) problems.push(s + ' is out of date (node tools/make_brand.js)');
    if (problems.length) { problems.forEach((p) => console.error('make_brand: ' + p)); process.exit(1); }
    console.log('make_brand: partials and brand files match YSD.cards.brand.paths');
    return;
  }
  if (problems.length) problems.forEach((p) => console.warn('make_brand: ' + p));
  if (!NO_PNG) (await renderPngs()).forEach((f) => console.log('wrote ' + f));
}
main().catch((e) => { console.error(e); process.exit(2); });
