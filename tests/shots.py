"""Render the 3D dev pages to PNGs for eyeballing rig poses and the live flow.

  python3 tests/shots.py poses                 -> tests/poses.png   (3x3 grid of rig poses from dev3d.html)
  python3 tests/shots.py live kd               -> tests/live.png    (time-lapse of a fight with an early knockdown)
  python3 tests/shots.py live ko "[13,15,17]"  -> capture at chosen seconds of animation time

Live modes: kd (early knockdown), td (early takedown), ko (first-round KO), dec (goes to the cards).
Needs Playwright; set CHROME=/path/to/chrome to use a system Chrome.
"""
import os, sys
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ARGS = ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
mode = sys.argv[1] if len(sys.argv) > 1 else "poses"

with sync_playwright() as p:
    kw = {"args": ARGS}
    if os.environ.get("CHROME"):
        kw["executable_path"] = os.environ["CHROME"]
    b = p.chromium.launch(**kw)
    pg = b.new_page(viewport={"width": 1800, "height": 1500})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    if mode == "poses":
        pg.goto("file://" + os.path.join(HERE, "dev3d.html"))
        out = os.path.join(HERE, "poses.png")
    else:
        which = sys.argv[2] if len(sys.argv) > 2 else "kd"
        if len(sys.argv) > 3:
            pg.add_init_script("window.TIMES = " + sys.argv[3] + ";")
        pg.goto("file://" + os.path.join(HERE, "dev3d_live.html") + "#" + which)
        out = os.path.join(HERE, "live.png")
    pg.wait_for_function("window.DONE === true", timeout=400000)
    pg.screenshot(path=out)
    if mode != "poses":
        print("\n".join(pg.evaluate("window.CAPS")))
        print("\n".join(pg.evaluate("window.LOG")[:40]))
    print("saved", out, "| errors:", errs[:5] or "none")
    b.close()
