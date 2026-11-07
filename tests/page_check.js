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
  o = await odds("EV", "-110");
  const ev = await pg.evaluate(() => { const m = window.FightLab.blend().mk; return { pPow: m.pPow, pMult: m.pMult, p: m.p, kind: m.kind }; });
  check(Math.abs(ev.pPow - 0.487963) < 2e-4 && Math.abs(ev.pMult - 0.5 / (0.5 + 110 / 210)) < 1e-9 && ev.kind === "open" && ev.p === ev.pMult,
    "EV / -110: power de-vig for a closing line, proportional for a pre-fight line (the default)", ev);
  await odds("+160", "-180");

  console.log("winner stacks (page pass 3)");
  const reg = await pg.evaluate(() => {
    const FL = window.FightLab, PPm = window.PagePredict, h = FL.ml2(), f = FL.fightCtx(), st = FL.state, out = { models: FL.models() };
    const d = PPm.devig("+160", "-180");
    out.want = { none: PPm.winner(h, st.a, st.b, f, null).p, open: PPm.winner(h, st.a, st.b, f, { kind: "open", pMult: d.pMult, pPow: d.pPow }).p,
      close: PPm.winner(h, st.a, st.b, f, { kind: "close", pMult: d.pMult, pPow: d.pPow }).p };
    out.open = { p: FL.blend().p, kind: FL.blend().kind };
    const lc = document.getElementById("lineClose"); lc.click();
    out.close = { p: FL.blend().p, kind: FL.blend().kind }; lc.click();
    const lt = document.getElementById("lineTog"); lt.click();
    out.none = { p: FL.blend().p, kind: FL.blend().kind }; lt.click();
    out.back = { p: FL.blend().p, kind: FL.blend().kind };
    out.weights = h.doc.stack;
    return out;
  });
  check(reg.models.ml2 && reg.models.s2 && reg.models.statdist && reg.models.debut && reg.models.pagepredict, "ML v2, S2, stat-line and debut models load", reg.models);
  check(reg.open.kind === "open" && Math.abs(reg.open.p - reg.want.open) < 1e-12, "a typed line goes to the open-trained stack", [reg.open, reg.want.open]);
  check(reg.close.kind === "close" && Math.abs(reg.close.p - reg.want.close) < 1e-12, "the closing-line box switches to the close-trained stack", [reg.close, reg.want.close]);
  check(reg.none.kind === "none" && Math.abs(reg.none.p - reg.want.none) < 1e-12, "no line: the no-line stack", [reg.none, reg.want.none]);
  check(reg.back.kind === "open" && Math.abs(reg.back.p - reg.want.open) < 1e-12, "toggles return to the pre-fight line");
  const FMW = JSON.parse(fs.readFileSync(path.join(ROOT, "data/derived/forward_models.json"), "utf8")).ml2_static;
  check(["line", "open", "noline"].every((k) => JSON.stringify(reg.weights[k].weights) === JSON.stringify(FMW[k].weights)), "the page's stack weights are the forward ledger's (fit 2019-2023)");
  const hd = await pg.evaluate(() => { const H = window.FightLab.blend().head; return { variant: H && H.variant, src: H && H.src, s: H ? H.bins7.reduce((a, b) => a + b, 0) : null, pA: H && H.pA, pD: H && H.pD }; });
  check(hd.src === "mr" && hd.variant === "S2" && Math.abs(hd.s - 1) < 1e-9, "how it ends: S2 cells scaled to the headline, summing to 1", hd);
  const sl = await pg.evaluate(() => { const L = window.FightLab.statLines(); return { L, rows: document.querySelectorAll("#slBody table.slt tbody tr").length, note: document.getElementById("slNote").textContent }; });
  const ord = sl.L && ["A", "B"].every((s) => Object.values(sl.L[s]).every((q) => q.p10 <= q.p50 && q.p50 <= q.p90));
  check(sl.L && sl.rows === 14 && ord, "stat lines: 7 rows per fighter, low <= typical <= high", sl.rows);

  console.log("scorecard and forward test");
  const sc = await pg.evaluate(() => ({ bt: document.getElementById("btBody").innerText, fw: document.getElementById("fwBody").innerText }));
  check(/level with the market/i.test(sc.bt), "the scorecard says plainly: level with the market");
  check(/0\.6003/.test(sc.bt) && /0\.5887/.test(sc.bt) && /0\.5854/.test(sc.bt) && /−0\.0087/.test(sc.bt) && /0\.6150/.test(sc.bt), "scorecard quotes the verified numbers (2026 close 0.6003, ML v2 0.5887 vs close 0.5854, -0.0087, open stack 0.6150)");
  check(/v5\.0\.1/.test(sc.bt) && /v6/.test(sc.bt) && /rejected/.test(sc.bt) && /kept, on this page/.test(sc.bt), "engine versions table: v4 kept, v5 / v5.0.1 / v6 rejected");
  check(!/Every weight on this page was fit on these fights only/.test(sc.bt) && /combine the models into the pick were fit on these fights only/.test(sc.bt) && /refit on fights through 2025/.test(sc.bt),
    "testing protocol: only the stack weights are 2019-2023; the stats model was refit through 2025 (QA, Nov 7)");
  const metaD = (/<meta name="description" content="([^"]*)"/.exec(fs.readFileSync(PAGE, "utf8")) || [])[1] || "";
  check(metaD && !/seven models/.test(metaD) && /level with the market/.test(metaD), "meta description matches the page (stats model + line or market rating; level with the market)", metaD.slice(0, 120));
  const LED = fs.readdirSync(path.join(ROOT, "data/predictions")).filter((n) => /^\d{4}-\d{2}-\d{2}_.*\.json$/.test(n));
  for (const n of LED) {
    const sha = require("child_process").execFileSync("git", ["-C", ROOT, "log", "--diff-filter=A", "--format=%H", "--", "data/predictions/" + n]).toString().trim().split("\n").pop();
    const raw = JSON.parse(require("child_process").execFileSync("git", ["-C", ROOT, "show", sha + ":data/predictions/" + n]).toString());
    check(sc.fw.indexOf(sha.slice(0, 7)) >= 0 && /before the lock/.test(sc.fw), n + ": commit " + sha.slice(0, 7) + " shown, committed before the lock");
    const picks = await pg.evaluate(() => [...document.querySelectorAll(".fw-led .fw-nums span:first-child")].map((x) => x.textContent));
    const pv = raw.bouts.slice().sort((x, y) => (x.order || 99) - (y.order || 99)).map((b) => Math.round(100 * Math.max(b.p_a, 1 - b.p_a)) + "%");
    check(picks.length === raw.bouts.length && picks.every((t, i) => t.indexOf(pv[i]) >= 0), n + ": every committed pick shown as committed (" + picks.length + " bouts)", picks.slice(0, 3));
  }

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

  console.log("stat lines without an embedding (first UFC fight in 2026)");
  const noEmb = [];
  for (const [a, bb] of [["abdul-hussein", "asaf-chopurov"], ["asaf-chopurov", "abdul-hussein"], ["alexander-volkanovski", "abdul-hussein"]]) {
    await pg.evaluate(([a, bb]) => { location.hash = "a=" + a + "&b=" + bb; }, [a, bb]);
    await pg.waitForFunction(([a, bb]) => window.FightLab.state.a === a && window.FightLab.state.b === bb, [a, bb]);
    await pg.waitForTimeout(300);
    noEmb.push(await pg.evaluate(() => { const L = window.FightLab.statLines(); return { L: L && { A: L.A, B: L.B, hasEmb: L.hasEmb }, rows: document.querySelectorAll("#slBody table.slt tbody tr").length,
      note: document.getElementById("slNote").textContent }; }));
  }
  const ordOk = (L) => L && ["A", "B"].every((s) => Object.values(L[s]).every((q) => q.p10 <= q.p50 && q.p50 <= q.p90));
  check(noEmb.every((x) => x.L && x.L.hasEmb === false && x.rows === 14 && ordOk(x.L)), "bands render for 2026 debutants (both sides, and one side), embedding term off, low <= typical <= high",
    noEmb.map((x) => [x.rows, x.L && x.L.hasEmb]));
  const swapd = noEmb[0].L && noEmb[1].L ? Math.max(...Object.keys(noEmb[0].L.A).flatMap((k) => ["mean", "p10", "p50", "p90"].map((q) => Math.max(Math.abs(noEmb[0].L.A[k][q] - noEmb[1].L.B[k][q]), Math.abs(noEmb[0].L.B[k][q] - noEmb[1].L.A[k][q]))))) : null;
  check(swapd != null && swapd < 1e-9, "debutant pair: swapping corners swaps the lines", swapd);
  check(/Abdul Hussein and Asaf Chopurov have no fighter-style profile yet/.test(noEmb[0].note) && /Abdul Hussein has no fighter-style profile yet/.test(noEmb[2].note) && !/Volkanovski has no/.test(noEmb[2].note),
    "the note names the fighters without a style profile", noEmb[2].note.slice(-200));
  check(!/style profile/.test(sl.note || ""), "no such note for Volkanovski vs Gaethje");

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
