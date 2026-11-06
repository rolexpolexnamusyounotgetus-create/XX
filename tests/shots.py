"""Render the 3D dev pages to PNGs for eyeballing rig poses and the live flow.

  python3 tests/shots.py poses                 -> tests/poses.png   (3x3 grid of rig poses from dev3d.html)
  python3 tests/shots.py live kd               -> tests/live.png    (time-lapse of a fight with an early knockdown)
  python3 tests/shots.py live ko "[13,15,17]"  -> capture at chosen seconds of animation time

  python3 tests/shots.py tops                  -> fails (exit 1) when a female avatar has no top
  python3 tests/shots.py tops zhang-weili tatiana-suarez   (any pair; defaults to Zhang vs Suarez)

Live modes: kd (early knockdown), td (early takedown), ko (first-round KO), dec (goes to the cards).
"tops" loads the built page (volk-gaethje-simulator.html) with a women's pair, waits for both skinned avatars and
checks each female avatar (FightAvatar cfg.female) for a visible garment mesh named top / bra / sports top / shirt /
rash guard (or avatar.looks.top set). Name the garment mesh that way in src/avatar3d.js so this check can see it.
Needs Playwright; set CHROME=/path/to/chrome to use a system Chrome.
"""
import os, re, sys
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
    if mode == "tops":
        root = os.path.dirname(HERE)
        a = sys.argv[2] if len(sys.argv) > 2 else "zhang-weili"
        bb = sys.argv[3] if len(sys.argv) > 3 else "tatiana-suarez"
        src = open(os.path.join(root, "volk-gaethje-simulator.html"), encoding="utf-8").read()
        src = src.replace("https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js", "../vendor/three.min.js")
        src = re.sub(r"https://cdn\.jsdelivr\.net/npm/three@0\.128\.0/examples/js/", "../vendor/three-r128-examples/", src)
        page = os.path.join(HERE, "_tops_preview.html")
        with open(page, "w", encoding="utf-8") as f:
            f.write("<!doctype html><html><head><meta charset='utf-8'><style>[hidden]{display:none!important}</style></head><body>" + src + "</body></html>")
        pg.set_viewport_size({"width": 1280, "height": 900})
        pg.goto("file://" + page + "#" + a + "-vs-" + bb)
        pg.wait_for_function("window.VGSim && VGSim.show && VGSim.show.A && VGSim.show.A.avatar && VGSim.show.B.avatar", timeout=400000)
        res = pg.evaluate("""() => { const s = window.VGSim.show, out = [];
          for (const k of ['A', 'B']) { const av = s[k].avatar, names = [];
            av.group.traverse(o => { if (o.isMesh && o.visible) names.push(o.name || ''); });
            const top = names.some(n => /(^|[^a-z])(top|bra|sports.?top|shirt|rash)/i.test(n)) || !!(av.looks && av.looks.top);
            out.push({ side: k, slug: av.app && av.app.slug, female: !!(av.cfg && av.cfg.female), top: top, meshes: names }); }
          return out; }""")
        bad = [r for r in res if r["female"] and not r["top"]]
        for r in res:
            print(r["side"], r["slug"], "female" if r["female"] else "male", "top: yes" if r["top"] else "top: NO", "| meshes:", ", ".join(r["meshes"]))
        print("errors:", errs[:5] or "none")
        b.close()
        os.remove(page)
        if bad:
            print("FAIL: female avatar without a top:", ", ".join(str(r["slug"]) for r in bad))
            sys.exit(1)
        print("ok: every female avatar wears a top")
        sys.exit(0)
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
