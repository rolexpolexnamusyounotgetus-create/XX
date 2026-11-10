const { chromium } = require('playwright');
const path = require('path');
const OUT = process.argv[2] || '.';
const URL = process.argv[3] || 'http://127.0.0.1:8765/index.html';
const theme = process.argv[4] || 'light';
(async () => {
  const b = await chromium.launch();
  const res = {};
  for (const [name, vp, dsf] of [['mobile', { width: 390, height: 844 }, 2], ['desktop', { width: 1440, height: 900 }, 1]]) {
    const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: dsf, colorScheme: theme, hasTouch: name === 'mobile', isMobile: name === 'mobile' });
    const p = await ctx.newPage();
    const errs = [];
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
    p.on('requestfailed', r => errs.push('REQFAIL ' + r.url() + ' ' + (r.failure() || {}).errorText));
    await p.goto(URL, { waitUntil: 'networkidle', timeout: 90000 });
    await p.evaluate(() => document.fonts.ready);
    // scroll through to trigger lazy images + reveals
    const H = await p.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < H; y += Math.floor(vp.height * 0.6)) { await p.evaluate(yy => window.scrollTo(0, yy), y); await p.waitForTimeout(160); }
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.waitForFunction(() => Array.from(document.images).filter(i=>i.offsetParent).every(i => i.complete && i.naturalWidth > 0), null, { timeout: 60000 }).catch(() => errs.push('IMG TIMEOUT'));
    await p.waitForFunction(() => window.__coverReady === true, null, { timeout: 20000 }).catch(() => errs.push('COVER NOT READY'));
    await p.evaluate(() => document.querySelectorAll('.rise').forEach(e => e.classList.add('in')));
    await p.waitForTimeout(1200);
    const m = await p.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, height: document.documentElement.scrollHeight,
      fonts: ['Fraunces', 'Bricolage Grotesque', 'Figtree'].map(f => f + ':' + document.fonts.check('700 20px "' + f + '"')),
      wide: Array.from(document.querySelectorAll('body *')).filter(e => { const r = e.getBoundingClientRect(); return r.right > document.documentElement.clientWidth + 1 && !e.closest('.strip,.events,.clips,.marquee,.foot-mast,.burst,.polaroid'); }).slice(0, 8).map(e => e.tagName + '.' + e.className + ' r=' + Math.round(e.getBoundingClientRect().right)),
      broken: Array.from(document.images).filter(i => !i.naturalWidth && i.offsetParent).map(i => i.src)
    }));
    res[name] = { ...m, errs };
    const fname = path.join(OUT, `shot-${name}${theme === 'dark' ? '-dark' : ''}.png`);
    const total = await p.evaluate(() => document.documentElement.scrollHeight);
    const CH = Math.floor(7000 / dsf);
    const parts = [];
    for (let y = 0, i = 0; y < total; y += CH, i++) {
      const f = path.join(OUT, `_chunk_${name}_${i}.png`);
      await p.screenshot({ path: f, fullPage: true, clip: { x: 0, y, width: vp.width, height: Math.min(CH, total - y) } });
      parts.push(f);
    }
    require('child_process').execFileSync('python3', ['-c', `import sys\nfrom PIL import Image\nims=[Image.open(f) for f in sys.argv[2:]]\nW=ims[0].width;H=sum(i.height for i in ims)\nout=Image.new('RGB',(W,H))\ny=0\nfor i in ims:\n  out.paste(i,(0,y)); y+=i.height\nout.save(sys.argv[1],optimize=True)`, fname, ...parts]);
    parts.forEach(f => require('fs').unlinkSync(f));
    await ctx.close();
  }
  console.log(JSON.stringify(res, null, 1));
  await b.close();
})();
