const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  for (const vp of [{width:390,height:844},{width:1440,height:900}]) {
  const p = await b.newPage({ viewport: vp });
  let first=0, total=0; const hosts=new Set(); let phase='first';
  p.on('response', async r => { try { const h=new URL(r.url()).host; hosts.add(h); const buf=await r.body().catch(()=>null); const n=buf?buf.length:0; total+=n; if(phase==='first') first+=n; } catch(e){} });
  await p.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
  const firstView=first; phase='rest';
  const H = await p.evaluate(() => document.documentElement.scrollHeight);
  for (let y=0;y<H;y+=500){ await p.evaluate(yy=>scrollTo(0,yy),y); await p.waitForTimeout(120); }
  await p.waitForLoadState('networkidle'); await p.waitForTimeout(800);
  const html = (await p.content()).length;
  console.log(vp.width, JSON.stringify({firstViewKB:Math.round(firstView/1024), fullScrollKB:Math.round(total/1024), hosts:[...hosts], htmlKB:Math.round(html/1024)}));
  await p.close(); }
  await b.close();
})();
