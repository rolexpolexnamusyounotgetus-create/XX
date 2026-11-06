"""Headless functional check of the built page.

Wraps the page in the artifact host's skeleton, swaps the three.js CDN URL for the local copy,
fast-forwards the live fight (software WebGL is slow, so rendering is skipped while it runs),
then prints the HUD state and any console errors.

Needs: pip install playwright && playwright install chromium   (or set CHROME=/path/to/chrome)
Run from the project root:  python3 tests/func_check.py
"""
import json, os, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(ROOT, "volk-gaethje-simulator.html"), encoding="utf-8").read()
src = src.replace("https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js", "vendor/three.min.js")
wrapped = ("<!doctype html><html><head><meta charset='utf-8'>"
           "<meta name='viewport' content='width=device-width, initial-scale=1, viewport-fit=cover'>"
           "<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}"
           "body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>"
           "</head><body>" + src + "</body></html>")
preview = os.path.join(ROOT, "preview.html")
open(preview, "w", encoding="utf-8").write(wrapped)

ARGS = ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
FAST_FORWARD = """() => { const s = window.VGSim.show; const r = s.arena.render.bind(s.arena);
  s.arena.render = function () {}; for (let i = 0; i < 1500; i++) s.frame(1 / 30);
  s.arena.render = r; s.frame(1 / 30); }"""

with sync_playwright() as p:
    kw = {"args": ARGS}
    if os.environ.get("CHROME"):
        kw["executable_path"] = os.environ["CHROME"]
    b = p.chromium.launch(**kw)
    pg = b.new_page(viewport={"width": 1280, "height": 900})
    errs = []
    pg.on("console", lambda m: errs.append(m.type + ": " + m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    pg.goto("file://" + preview)
    time.sleep(3)
    pg.evaluate(FAST_FORWARD)
    time.sleep(0.5)
    info = pg.evaluate("""() => ({
      tally: document.getElementById('runStatus').textContent,
      volk: document.getElementById('pV').textContent, gaethje: document.getElementById('pG').textContent,
      clock: document.getElementById('bugClock').textContent,
      landed: [document.getElementById('landA').textContent, document.getElementById('landB').textContent],
      playByPlay: [...document.querySelectorAll('#pbp li')].map(li => li.textContent).slice(0, 5),
      blend: document.getElementById('blendOut').textContent,
      pageWidth: document.documentElement.scrollWidth
    })""")
    print(json.dumps(info, indent=1))
    print("errors:", errs[:10] or "none")
    b.close()
