#!/usr/bin/env node
/**
 * assets/video/render_clips.js: frame renderer for the DEMO creator clips (build tool; no site page loads it).
 *
 *   node assets/video/render_clips.js JOB.json
 *
 * Called by assets/video/make_demo_clips.py, which writes JOB.json:
 *   { fps, tmp, photos: { key: { path, w, h } }, clips: [ { id, file, posterAt, shots: [...] } ] }
 * For each clip it opens a 720x1280 Chromium page (Playwright), loads assets/video/stage.js with the site's
 * own fonts (inlined as data: URLs) and the sticker art from data/stickers.js, then renders every frame
 * deterministically (STAGE.render(t)) and pipes the PNG frames into ffmpeg as a near-lossless master
 * (<tmp>/<file>.master.mp4). It also saves <tmp>/<file>.poster.png (the poster frame, without the DEMO
 * bug, because the page draws its own DEMO chip). make_demo_clips.py does the final size-capped encode.
 * Prints one JSON line per clip: {"id", "frames", "duration", "master", "poster"}.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const vm = require('vm');
const { chromium } = require('playwright');

const HERE = __dirname;
const SITE = path.resolve(HERE, '..', '..');

function fontData(file) {
  return 'data:font/woff2;base64,' + fs.readFileSync(path.join(SITE, 'assets/fonts', file)).toString('base64');
}
function stickers() {
  const win = {};
  vm.runInNewContext(fs.readFileSync(path.join(SITE, 'data/stickers.js'), 'utf8'), { window: win });
  const out = {};
  (win.YSD_DATA.stickers.items || []).forEach((s) => { out[s.id] = s.svg; });
  return out;
}

function stageHtml() {
  return '<!doctype html><html><head><meta charset="utf-8"><style>' +
    '@font-face{font-family:"Bricolage Grotesque";src:url(' + fontData('bricolage-800-wdth.woff2') + ') format("woff2");font-weight:100 900;font-stretch:75% 100%}' +
    '@font-face{font-family:"Atkinson Hyperlegible Next";src:url(' + fontData('atkinson-next-var.woff2') + ') format("woff2");font-weight:400 800}' +
    'html,body{margin:0;background:#000;width:720px;height:1280px;overflow:hidden}' +
    '#stage{position:absolute;inset:0;overflow:hidden}#flash{position:absolute;inset:0;background:#fff;opacity:0;z-index:60}' +
    '[hidden]{display:none!important}*{box-sizing:border-box}' +
    '</style></head><body><div id="stage"></div><div id="flash"></div></body></html>';
}

function encodeMaster(file, fps) {
  return spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '8', '-pix_fmt', 'yuv420p', '-an', file], { stdio: ['pipe', 'inherit', 'inherit'] });
}

(async () => {
  const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const fps = job.fps || 30;
  fs.mkdirSync(job.tmp, { recursive: true });
  const htmlFile = path.join(job.tmp, 'stage.html');
  fs.writeFileSync(htmlFile, stageHtml());
  const assets = { stickers: stickers(), photos: {} };
  Object.keys(job.photos).forEach((k) => { const p = job.photos[k]; assets.photos[k] = { src: 'file://' + p.path, w: p.w, h: p.h }; });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 720, height: 1280 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => { console.error('stage error:', e.message); process.exitCode = 1; });
  for (const clip of job.clips) {
    await page.goto('file://' + htmlFile);
    await page.addScriptTag({ path: path.join(HERE, 'stage.js') });
    const duration = await page.evaluate(([c, a]) => STAGE.build(c, a), [clip, assets]);
    await page.evaluate(() => Promise.all([document.fonts.ready].concat(Array.from(document.images).map((i) => i.decode().catch(() => null)))));
    if (job.preview) {
      // preview mode (make_demo_clips.py --preview): a few stills per clip, no encoding
      const shots = [];
      for (const t of job.preview.length ? job.preview : [0.5]) {
        if (t >= duration) continue;
        await page.evaluate((x) => STAGE.render(x), t);
        const f = path.join(job.tmp, clip.file + '-' + t.toFixed(2) + '.png');
        await page.screenshot({ path: f, type: 'png' });
        shots.push(f);
      }
      process.stdout.write(JSON.stringify({ id: clip.id, preview: shots }) + '\n');
      continue;
    }
    const frames = Math.round(duration * fps);
    const master = path.join(job.tmp, clip.file + '.master.mp4');
    const ff = encodeMaster(master, fps);
    const done = new Promise((res, rej) => ff.on('close', (code) => code === 0 ? res() : rej(new Error('ffmpeg ' + code))));
    for (let i = 0; i < frames; i++) {
      await page.evaluate((t) => STAGE.render(t), i / fps);
      const buf = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 720, height: 1280 } });
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    }
    ff.stdin.end();
    await done;
    await page.evaluate((t) => STAGE.render(t, { poster: true }), clip.posterAt || 0);
    const poster = path.join(job.tmp, clip.file + '.poster.png');
    await page.screenshot({ path: poster, type: 'png', clip: { x: 0, y: 0, width: 720, height: 1280 } });
    process.stdout.write(JSON.stringify({ id: clip.id, frames, duration: frames / fps, master, poster }) + '\n');
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
