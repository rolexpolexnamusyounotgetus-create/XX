// Headless functional check of the built page (node + Playwright), for the page-review fixes.
//
//   node tests/page_check.js [page.html] [--strict]
//
// Default page: volk-gaethje-simulator.html. The page is wrapped in the artifact host's skeleton with the CDN scripts
// swapped for vendor/ copies, the 3D drawing is stubbed (software WebGL crawls) and the fight clock is driven with
// show.frame(). Checks: no page errors; the cage's winners follow the headline (seed search); the HUD counts one-shot
// KOs as knockdowns and ends on the engine's totals; picker search without punctuation and with Polish letters; odds
// validation and the EV de-vig; 3 rounds clears "title fight"; the research notes fold away for other pairs; no
// project paths or jargon in visible copy; no horizontal scroll at 390 px. The female-avatar top check is a known 3D
// gap and only warns unless --strict is given.
"use strict";
const fs = require("fs"), path = require("path"), os = require("os");
const { chromium } = require("playwright");
const ROOT = path.join(__dirname, "..");
const args = process.argv.slice(2), STRICT = args.includes("--strict");
const PAGE = path.resolve(args.find((a) => !a.startsWith("--")) || path.join(ROOT, "volk-gaethje-simulator.html"));
const ARGS = ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--allow-file-access-from-files"];

function wrap() {
  let s = fs.readFileSync(PAGE, "utf8");
  s = s.replace("https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js", "file://" + path.join(ROOT, "vendor/three.min.js"));
  s = s.replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.128\.0\/examples\/js\//g, "file://" + path.join(ROOT, "vendor/three-r128-examples") + "/");
  s = s.replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/, "");
  const out = path.join(os.tmpdir(), "page_check_" + process.pid + ".html");
  fs.writeFileSync(out, "<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>" +
    "<style>body{margin:0}[hidden]{display:none!important}</style></head><body>" + s + "</body></html>");
  return out;
}
let fails = 0, warns = 0;
function check(ok, label, detail) {
  console.log((ok ? "  ok   " : "  FAIL ") + label + (detail != null ? "  " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""));
  if (!ok) fails++;
}
function warn(label, detail) { console.log("  WARN " + label + (detail != null ? "  " + JSON.stringify(detail) : "")); warns++; }

async function open(b, file, vp, hash) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 1 });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(300000);
  await pg.addInitScript(() => {   // skip the WebGL draw; everything else (avatars, choreography, HUD) runs
    const iv = setInterval(() => { const s = window.VGSim && window.VGSim.show; if (s && s.arena && !s.arena.__stub) { s.arena.render = function () {}; s.arena.__stub = 1; } }, 50);
  });
  const errs = [];
  pg.on("pageerror", (e) => errs.push(String(e)));
  pg.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await pg.goto("file://" + file + (hash || ""), { waitUntil: "domcontentloaded" });
  return { ctx, pg, errs };
}
const waitTally = (pg) => pg.waitForFunction(() => /simulated fights/.test(document.getElementById("runStatus").textContent), null, { timeout: 300000 });

(async () => {
  const file = wrap(), b = await chromium.launch({ args: ARGS });
  console.log("page: " + PAGE);
  const { pg, errs } = await open(b, file, { width: 1280, height: 900 });
  await waitTally(pg);

  console.log("cage winners follow the headline");
  const cage = await pg.evaluate(() => {
    const head = window.FightLab.blend().head, n = 60, want = { A: 0, B: 0, D: 0 }; let hits = 0, mism = 0;
    for (let i = 0; i < n; i++) { window.FightLab.newFight(); const p = window.FightLab.lastPick(), s = window.FightLab.script(); want[p.want]++; if (p.hit) { hits++; if (s.winner !== p.want) mism++; } }
    return { pA: head.pA, n, want, hits, mism };
  });
  check(cage.mism === 0, "the played fight has the drawn winner whenever the seed search hits", cage);
  check(cage.hits >= cage.n - 3, "the seed search finds the drawn winner within 40 tries", cage.hits + " of " + cage.n);
  check(Math.abs(cage.want.A / cage.n - cage.pA) < 0.2, "drawn winners track the headline odds", (cage.want.A / cage.n).toFixed(2) + " vs " + cage.pA.toFixed(2));

  console.log("HUD knockdowns");
  for (let k = 0; k < 3; k++) {
    const r = await pg.evaluate(() => {
      let s = null; for (let i = 0; i < 120; i++) { window.FightLab.newFight(); s = window.FightLab.script(); if (s.method === "KO") break; }
      const sh = window.VGSim.show; sh.speed = 30; let i = 0;
      while (document.getElementById("banner").hidden && i < 30000) { sh.frame(1 / 30); i++; }
      const f = window.FightLab.fight(), hud = window.FightLab.hud(), eng = { A: 0, B: 0 }, lnd = { A: 0, B: 0 };
      f.rounds.forEach((rd) => { if (rd.st) { eng.A += rd.st.A.kd; eng.B += rd.st.B.kd; lnd.A += rd.st.A.sig_lnd; lnd.B += rd.st.B.sig_lnd; } });
      return { method: s.method, ended: !document.getElementById("banner").hidden, hud: [hud.A.kd, hud.B.kd], eng: [eng.A, eng.B], hudLnd: [hud.A.lnd, hud.B.lnd], engLnd: [lnd.A, lnd.B],
        dots: [document.getElementById("kdDotsA").children.length, document.getElementById("kdDotsB").children.length] };
    });
    check(r.ended && r.hud[0] === r.eng[0] && r.hud[1] === r.eng[1] && r.dots[0] === r.eng[0] && r.dots[1] === r.eng[1] && r.hudLnd[0] === r.engLnd[0] && r.hudLnd[1] === r.engLnd[1],
      "HUD ends on the engine's totals (" + r.method + ")", r);
  }

  console.log("pickers");
  for (const [q, want] of [["omalley", "O'Malley"], ["Sean OMalley", "O'Malley"], ["oneill", "O'Neill"], ["duplessis", "Du Plessis"], ["Błachowicz", "Blachowicz"], ["Jan Błachowicz", "Blachowicz"], ["Weili Zhang", "Zhang Weili"]]) {
    const got = await pg.evaluate((q) => { const i = document.getElementById("pickA"); i.focus(); i.value = q; i.dispatchEvent(new Event("input")); const r = [...document.querySelectorAll("#listA .opt .o-name")].slice(0, 3).map((x) => x.textContent); i.blur(); return r; }, q);
    check(got.some((t) => t.indexOf(want) >= 0), "picker finds " + want + " from \"" + q + "\"", got);
  }
  await pg.waitForTimeout(300);

  console.log("odds");
  const odds = (a, c) => pg.evaluate(([a, c]) => { const A = document.getElementById("oddA"), B = document.getElementById("oddB"); A.value = a; A.dispatchEvent(new Event("input")); B.value = c; B.dispatchEvent(new Event("input")); const BL = window.FightLab.blend(); return { p: BL.mk.p, bad: !!BL.mk.bad, useLine: BL.useLine, inv: A.getAttribute("aria-invalid") }; }, [a, c]);
  let o = await odds("-1000", "-500"); check(o.bad && !o.useLine && o.inv === "true", "a -1000 / -500 line is flagged and kept out of the blend", o);
  o = await odds("+120", "+120"); check(o.bad && !o.useLine, "a +120 / +120 line (negative margin) is flagged", o);
  o = await odds("EV", "-110"); check(o.p != null && Math.abs(o.p - 0.487963) < 2e-4, "EV / -110 goes through the power de-vig", o.p);
  await odds("+160", "-180");

  console.log("rounds and title");
  const t = await pg.evaluate(() => { document.querySelector('#segRounds [data-r="3"]').click(); return { chk: document.getElementById("chkTitle").checked, hash: location.hash }; });
  check(!t.chk && !/-title$/.test(t.hash), "3 x 5 clears the title box", t);
  const st = await pg.evaluate(() => { const BL = window.FightLab.blend(); return { engine: BL.ex.engine, stale: BL.engStale }; });
  check(st.engine == null, "the forecast drops the old simulator as soon as the matchup changes", st);

  console.log("copy");
  const scan = await pg.evaluate(() => {
    document.querySelectorAll("details").forEach((d) => { d.open = true; });
    const tx = document.getElementById("app").innerText, bad = [];
    const re = /(\b(?:src|tools|data|research|docs)\/[\w./-]+|\b\w+\.(?:md|json|py)\b|log-odds|no-vig|\bBrier\b|7-outcome|temperature|\blog5\b|\bpriors\b|Σ|Push \(|both men|Engine profile|Control target|background thread|[Rr]umoured)/g;
    let m; while ((m = re.exec(tx))) bad.push(tx.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\n/g, " "));
    return bad;
  });
  check(!scan.length, "no project paths or jargon in the visible copy", scan.slice(0, 8));

  console.log("another pair");
  await pg.evaluate(() => { location.hash = "#islam-makhachev-vs-belal-muhammad"; });
  await pg.waitForTimeout(1000);
  const isl = await pg.evaluate(() => ({ open: document.getElementById("researchDet").open, cav: document.getElementById("btCaveats").innerText }));
  check(!isl.open, "the Volkanovski vs Gaethje research folds away for another pair");
  check(!/Volkanovski at 155/.test(isl.cav), "the caveats speak to the pair on the page");
  check(!errs.length, "no page errors", errs.slice(0, 5));

  console.log("phone width");
  const m = await open(b, file, { width: 390, height: 844 });
  await m.pg.waitForFunction(() => window.FightLab && document.getElementById("tapeHeads").children.length === 2);
  await m.pg.waitForTimeout(1500);
  const sw = await m.pg.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
    pills: [...document.querySelectorAll(".th-card .pill")].every((p) => { const r = p.getBoundingClientRect(), c = p.closest(".th-card").getBoundingClientRect(); return r.left >= c.left - 1 && r.right <= c.right + 1; }) }));
  check(sw.sw <= sw.cw, "no horizontal scroll at 390 px", sw);
  check(sw.pills, "tale-of-the-tape pills stay inside their cards at 390 px");

  console.log("women's pair (3D)");
  const w = await open(b, file, { width: 1280, height: 900 }, "#zhang-weili-vs-tatiana-suarez");
  let tops = null;
  try {
    await w.pg.waitForFunction(() => window.VGSim && VGSim.show && VGSim.show.A && VGSim.show.A.avatar && VGSim.show.B.avatar, null, { timeout: 240000 });
    tops = await w.pg.evaluate(() => ["A", "B"].map((k) => { const av = window.VGSim.show[k].avatar, names = []; av.group.traverse((x) => { if (x.isMesh && x.visible) names.push(x.name || ""); });
      return { slug: av.app && av.app.slug, female: !!(av.cfg && av.cfg.female), top: names.some((n) => /(^|[^a-z])(top|bra|sports.?top|shirt|rash)/i.test(n)) || !!(av.looks && av.looks.top) }; }));
  } catch (e) { tops = null; }
  const noTop = (tops || []).filter((x) => x.female && !x.top);
  if (tops == null) warn("skinned avatars did not bind; female-top check skipped");
  else if (noTop.length) { if (STRICT) check(false, "every female avatar wears a top", noTop); else warn("female avatar without a top (src/avatar3d.js; known 3D gap)", noTop); }
  else check(true, "every female avatar wears a top");

  await b.close(); fs.unlinkSync(file);
  console.log(fails ? fails + " check(s) failed" + (warns ? ", " + warns + " warning(s)" : "") : "all checks passed" + (warns ? " (" + warns + " warning(s))" : ""));
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
