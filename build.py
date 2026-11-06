"""Inline src/ into one self-contained page: volk-gaethje-simulator.html.

The page loads three.js r128 from cdnjs and inlines everything else, which is what the
claude.ai artifact host allows. Run:  python3 build.py
"""
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "src")

PARTS = {
    "/*__ENGINE__*/": "engine2.js",
    "/*__RIG__*/": "rig3d.js",
    "/*__ARENA__*/": "arena3d.js",
    "/*__DIRECTOR__*/": "director.js",
    "/*__SHOW__*/": "show3d.js",
    "/*__APP__*/": "app.js",
}

page = open(os.path.join(SRC, "page.src.html"), encoding="utf-8").read()
for marker, name in PARTS.items():
    code = open(os.path.join(SRC, name), encoding="utf-8").read()
    if "</script" in code.lower():
        raise SystemExit(name + " contains a closing script tag; it would break the inline build")
    if page.count(marker) != 1:
        raise SystemExit("placeholder " + marker + " must appear exactly once in page.src.html")
    page = page.replace(marker, code)

out = os.path.join(ROOT, "volk-gaethje-simulator.html")
open(out, "w", encoding="utf-8").write(page)
print("built", out, len(page), "bytes")
