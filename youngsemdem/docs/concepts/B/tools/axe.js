const { chromium } = require('playwright');
const axePath = '/tmp/claude-0/-home-user-XX/1b1d734e-7ece-5247-bd39-6725f8e29b5b/scratchpad/ysd/tools/node_modules/axe-core/axe.min.js';
(async () => {
  const b = await chromium.launch();
  for (const scheme of ['light', 'dark']) for (const vp of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    const p = await b.newPage({ viewport: vp, colorScheme: scheme });
    await p.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'networkidle' });
    await p.evaluate(() => document.querySelectorAll('.rise').forEach(e => e.classList.add('in')));
    await p.waitForTimeout(1200); await p.addScriptTag({ path: axePath });
    const r = await p.evaluate(async () => { const res = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } }); return res.violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, ex: v.nodes.slice(0, 3).map(n => n.target.join(' ') + ' :: ' + (n.failureSummary || '').split('\n')[1]) })) });
    console.log(scheme, vp.width, JSON.stringify(r, null, 1));
    await p.close();
  }
  await b.close();
})();
