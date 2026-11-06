// Head close-up likeness comparison: renders a fighter's avatar head under neutral studio light at the
// same framing as a reference photo and writes side-by-side PNGs (photo | render) per view.
//
//   node tests/likeness_compare.js <slug> [options]
//     --photo <file>        reference photo (default: the ESPN headshot in assets/reference/<slug>/)
//     --box x0,y0,x1,y1     crown-to-chin, ear-to-ear box in the photo, as fractions of its width/height
//                           (default: estimated from the cut-out's alpha silhouette, else the centre)
//     --view front|3q|profile|all   (default all: front, 3/4 and profile renders; only the matching view
//                           is paired with the photo, the others are rendered alone at the same framing)
//     --side 1|-1           3/4 and profile: 1 shows his left side, -1 his right (default -1, his right)
//     --yaw <deg>           fine yaw offset for the render; --size <px> tile size (default 560)
//     --out <dir>           output folder (default out/likeness/)
//     --likeness 0          render without the likeness sheet (base data-derived face), for A/B checks
//
// The sheet may list photos to compare: data/likeness/<slug>.json "compare": [{ "photo": "file",
// "view": "front", "side": -1, "box": [x0,y0,x1,y1] }, ...]; with no --photo those are used.
// Needs Playwright (node) and Chromium; WebGL runs on SwiftShader, so each render takes a few seconds.
"use strict";
const fs = require("fs"), path = require("path"), http = require("http");
const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
if (!args.length || args[0].startsWith("--")) { console.error("usage: node tests/likeness_compare.js <slug> [--photo f] [--box x0,y0,x1,y1] [--view v] [--side s] [--out dir]"); process.exit(1); }
const slug = args[0];
function opt(name, d) { const i = args.indexOf("--" + name); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; }
const OUT = path.resolve(ROOT, opt("out", "out/likeness"));
const SIZE = +opt("size", 560);
const VIEW = opt("view", "all"), SIDE = +opt("side", -1), YAW = +opt("yaw", 0);
fs.mkdirSync(OUT, { recursive: true });

const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".gz": "application/gzip", ".bin": "application/octet-stream" };
function serve() {
  return new Promise((res, rej) => {
    const srv = http.createServer((req, resp) => {
      const u = decodeURIComponent(req.url.split("?")[0]); let f = path.join(ROOT, u);
      if (!f.startsWith(ROOT)) { resp.writeHead(403); return resp.end(); }
      fs.stat(f, (e, st) => {
        if (e) { resp.writeHead(404); return resp.end(); }
        if (st.isDirectory()) { // directory listing for tests/fightassets_shim.js
          const items = fs.readdirSync(f).map(n => `<a href="${encodeURIComponent(n)}">${n}</a>`).join("\n");
          resp.writeHead(200, { "Content-Type": "text/html" }); return resp.end(items);
        }
        resp.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(resp);
      });
    });
    let port = 8100 + Math.floor(Math.random() * 90);
    srv.on("error", () => { port++; if (port > 8199) rej(new Error("no free port")); else srv.listen(port, "127.0.0.1"); });
    srv.listen(port, "127.0.0.1", () => res({ srv, port }));
  });
}

function pngSize(buf) { return buf.readUInt32BE(16) + "x" + buf.readUInt32BE(20); }

(async () => {
  const { chromium } = require("playwright");
  const sheetPath = path.join(ROOT, "data/likeness", slug + ".json");
  const sheet = fs.existsSync(sheetPath) ? JSON.parse(fs.readFileSync(sheetPath, "utf8")) : {};
  const refDir = path.join(ROOT, "assets/reference", slug);
  let pairs = [];
  if (opt("photo")) pairs.push({ photo: opt("photo"), view: VIEW === "all" ? "front" : VIEW, side: SIDE, box: opt("box") ? opt("box").split(",").map(Number) : null });
  else if (Array.isArray(sheet.compare) && sheet.compare.length) pairs = sheet.compare.map(c => Object.assign({ side: -1, view: "front" }, c));
  else if (fs.existsSync(refDir)) {
    const hs = fs.readdirSync(refDir).find(n => /headshot/i.test(n) && /\.png$/i.test(n));
    if (hs) pairs.push({ photo: hs, view: "front", side: -1, box: null });
  }
  const views = VIEW === "all" ? ["front", "3q", "profile"] : [VIEW];
  const { srv, port } = await serve();
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
  page.on("pageerror", e => console.error("page error:", e.message));
  const lk = opt("likeness", "1") === "0" ? "&likeness=0" : "";
  await page.goto(`http://127.0.0.1:${port}/tests/dev_avatar.html?w=${SIZE}&h=${SIZE}&slugs=${slug}${lk}`, { timeout: 300000 });
  const ok = await page.evaluate(() => window.DEV.ready);
  if (!ok) { console.error("avatar did not build"); process.exit(2); }
  await page.evaluate(() => DEV.studio(true));
  const BOX = [0.3, 0.17, 0.7, 0.83];   // where the head box sits in every tile
  const written = [];
  for (const view of views) {
    const pair = pairs.find(p => p.view === view) || null;
    const side = pair ? pair.side : SIDE;
    await page.evaluate(([v, s, b, y]) => DEV.headShot(0, v, s, b, y), [view, side, BOX, YAW]);
    const render = await page.locator("#c").screenshot({ type: "png" });
    let photoTile = null, note = "";
    if (pair) {
      const pf = path.isAbsolute(pair.photo) ? pair.photo : (fs.existsSync(path.join(refDir, pair.photo)) ? path.join(refDir, pair.photo) : path.join(ROOT, pair.photo));
      const data = "data:image/" + (/\.png$/i.test(pf) ? "png" : (/\.webp$/i.test(pf) ? "webp" : "jpeg")) + ";base64," + fs.readFileSync(pf).toString("base64");
      // crop the photo so its face box lands on BOX; estimate the box from the cut-out's alpha if none is given
      photoTile = await page.evaluate(async ([src, box, B, S]) => {
        const img = new Image(); img.src = src; await img.decode();
        const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const x = c.getContext("2d"); x.drawImage(img, 0, 0);
        let bx = box, how = "given";
        if (!bx) {
          const d = x.getImageData(0, 0, c.width, c.height).data, W = c.width, H = c.height; let crown = -1, maxW = 0, cxs = 0, cn = 0;
          for (let yy = 0; yy < H && crown < 0; yy++) { let n = 0; for (let xx = 0; xx < W; xx++) if (d[(yy * W + xx) * 4 + 3] > 128) n++; if (n > 3) crown = yy; }
          if (crown >= 0 && d[3] < 128) {
            for (let yy = crown; yy < Math.min(H, crown + H * 0.4); yy++) { let l = -1, r = -1; for (let xx = 0; xx < W; xx++) if (d[(yy * W + xx) * 4 + 3] > 128) { if (l < 0) l = xx; r = xx; } if (r - l > maxW) maxW = r - l; if (l >= 0) { cxs += (l + r) / 2; cn++; } }
            const cx = cxs / cn, chin = crown + maxW * 1.22;
            bx = [(cx - maxW / 2) / W, crown / H, (cx + maxW / 2) / W, chin / H]; how = "alpha silhouette";
          } else { bx = [0.3, 0.12, 0.7, 0.62]; how = "default centre"; }
        }
        const bw = (bx[2] - bx[0]) * img.width, bh = (bx[3] - bx[1]) * img.height, side = bh / (B[3] - B[1]);
        const ccx = (bx[0] + bx[2]) / 2 * img.width, ccy = (bx[1] + bx[3]) / 2 * img.height;
        const sx = ccx - side * (B[0] + B[2]) / 2, sy = ccy - side * (B[1] + B[3]) / 2;
        const o = document.createElement("canvas"); o.width = o.height = S; const ox = o.getContext("2d"); ox.fillStyle = "#6b6f75"; ox.fillRect(0, 0, S, S);
        ox.drawImage(img, sx, sy, side, side, 0, 0, S, S);
        ox.strokeStyle = "rgba(255,220,0,0.55)"; ox.lineWidth = 1; ox.strokeRect(B[0] * S, B[1] * S, (B[2] - B[0]) * S, (B[3] - B[1]) * S);
        return { url: o.toDataURL("image/png"), box: bx.map(v => +v.toFixed(3)), how };
      }, [data, pair.box, BOX, SIZE]);
      note = `${path.basename(pf)}  box ${photoTile.box.join(",")} (${photoTile.how})`;
    }
    // compose side by side in the page (photo | render) with captions
    const renderUrl = "data:image/png;base64," + render.toString("base64");
    const out = await page.evaluate(async ([pu, ru, S, label, note, B]) => {
      async function load(u) { const i = new Image(); i.src = u; await i.decode(); return i; }
      const W2 = pu ? S * 2 : S, c = document.createElement("canvas"); c.width = W2; c.height = S + 34; const x = c.getContext("2d");
      x.fillStyle = "#1b1d20"; x.fillRect(0, 0, W2, S + 34);
      if (pu) x.drawImage(await load(pu), 0, 0);
      const r = await load(ru); x.drawImage(r, pu ? S : 0, 0);
      x.strokeStyle = "rgba(255,220,0,0.55)"; x.strokeRect((pu ? S : 0) + B[0] * S, B[1] * S, (B[2] - B[0]) * S, (B[3] - B[1]) * S);
      x.fillStyle = "#e6e6e6"; x.font = "13px sans-serif"; x.fillText(label, 8, S + 14); x.fillStyle = "#9aa"; x.fillText(note, 8, S + 29);
      return c.toDataURL("image/png");
    }, [photoTile && photoTile.url, renderUrl, SIZE, `${slug} - ${view}${view !== "front" ? (side > 0 ? " (his left)" : " (his right)") : ""} - photo | avatar (neutral studio light)`, note || "no paired photo for this view", BOX]);
    const file = path.join(OUT, `${slug}_${view}.png`);
    const buf = Buffer.from(out.split(",")[1], "base64"); fs.writeFileSync(file, buf);
    written.push(file + " (" + pngSize(buf) + ")");
  }
  await browser.close(); srv.close();
  console.log(written.join("\n"));
})().catch(e => { console.error(e); process.exit(1); });
