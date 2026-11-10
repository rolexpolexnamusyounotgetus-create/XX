const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage(); const errs = []; const out = {};
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()) });
  await p.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'networkidle' });
  await p.evaluate(() => localStorage.clear()); await p.reload({ waitUntil: 'networkidle' });
  await p.waitForFunction(() => window.__coverReady === true);
  // RSVP flow
  await p.click('#ev-tacos .rsvp-open');
  await p.click('#rsvp-tacos button[type=submit]');
  out.rsvpEmptyErr = await p.textContent('#rsvp-tacos .err');
  await p.fill('#n-tacos', 'Jordan'); await p.check('#p-tacos');
  await p.click('#rsvp-tacos button[type=submit]');
  out.rsvpCount = await p.textContent('#ev-tacos [data-count]');
  out.rsvpOk = (await p.textContent('#ev-tacos .ok')).slice(0, 60);
  const [dl1] = await Promise.all([p.waitForEvent('download'), p.click('#ev-tacos [data-a=cal]')]);
  out.icsName = dl1.suggestedFilename(); const icsPath = await dl1.path(); out.ics = require('fs').readFileSync(icsPath, 'utf8').split('\r\n').filter(l => /DTSTART|SUMMARY|LOCATION/.test(l));
  // cover generator
  await p.fill('#cName', 'Dani'); await p.selectOption('#cCity', 'Sanford'); await p.check('input[name=cause][value="clean lakes"]', { force: true }); await p.check('input[name=color][value=blue]', { force: true });
  await p.waitForTimeout(200);
  out.ref = await p.textContent('#refLink');
  const [dl2] = await Promise.all([p.waitForEvent('download'), p.click('#dlBtn')]);
  out.coverFile = dl2.suggestedFilename(); out.coverBytes = require('fs').statSync(await dl2.path()).size;
  require('fs').copyFileSync(await dl2.path(), require('os').tmpdir()+'/ydsc-cover-test.png');
  await p.click('#shareBtn'); await p.waitForTimeout(300); out.shareToast = await p.textContent('#toast');
  await p.click('#copyBtn'); await p.waitForTimeout(200); out.clip = await p.evaluate(() => navigator.clipboard.readText()).catch(e => 'ERR ' + e.message);
  // reel: play clip
  await p.click('.clip .play'); await p.waitForTimeout(800); out.videoPlaying = await p.evaluate(() => { const v = document.querySelector('.clip video'); return v ? { paused: v.paused, t: v.currentTime, rs: v.readyState } : null });
  // post a clip
  await p.click('#postOpen'); await p.fill('#pLink', 'https://example.com/x'); await p.click('#postPanel button[type=submit]'); out.postErr1 = await p.textContent('#postErr');
  await p.fill('#pLink', 'https://www.tiktok.com/@demo/video/123'); await p.click('#postPanel button[type=submit]'); out.postErr2 = await p.textContent('#postErr');
  for (const n of ['c1', 'c2', 'c3']) await p.check(`#postPanel input[name=${n}]`);
  await p.fill('#pCap', 'Why I showed up'); await p.click('#postPanel button[type=submit]');
  out.pending = await p.$$eval('.clip--pending', e => e.map(x => x.textContent.trim().slice(0, 80)));
  out.panelHidden = await p.$eval('#postPanel', e => e.hidden);
  // join
  await p.click('#joinForm button[type=submit]'); out.joinErr1 = await p.textContent('#joinErr');
  await p.fill('#jName', 'Sam'); await p.fill('#jEmail', 'sam.example.com'); await p.click('#joinForm button[type=submit]'); out.joinErr2 = await p.textContent('#joinErr');
  await p.fill('#jEmail', 'sam@example.com'); await p.check('#joinForm input[value=member]', { force: true }); await p.click('#joinForm button[type=submit]');
  out.joinOk = (await p.textContent('#joinOk')).slice(0, 140);
  // letter
  await p.fill('#lEmail', 'a@b.co'); await p.click('#letterForm button[type=submit]'); out.letterOk = (await p.textContent('#letterOk')).slice(0, 60);
  // remind
  const [dl3] = await Promise.all([p.waitForEvent('download'), p.click('#remindBtn')]); out.remind = dl3.suggestedFilename();
  // marquee pause
  await p.click('#marqPause'); out.marqPaused = await p.$eval('#marquee', e => e.classList.contains('paused'));
  // lang
  await p.click('#langBtn'); out.langH = await p.textContent('.coverline p'); out.lang = await p.evaluate(() => document.documentElement.lang);
  await p.click('#langBtn'); out.langBack = await p.textContent('.coverline p');
  // menu + theme (mobile)
  await p.click('#menuBtn'); out.menuOpen = await p.$eval('#mnav', e => !e.hidden); await p.click('#themeBtnM'); out.theme = await p.evaluate(() => document.documentElement.dataset.theme);
  out.days = await p.textContent('#daysLeft');
  out.errs = errs;
  console.log(JSON.stringify(out, null, 1)); await b.close();
})();
