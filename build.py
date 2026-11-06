"""Inline src/ and data/ into one self-contained page.

    python3 build.py                 # writes volk-gaethje-simulator.html (the published page)
    python3 build.py out/test.html   # writes somewhere else (handy for parallel work and tests)

The page loads three.js from a pinned CDN URL and inlines everything else: the engine and its
calibrated parameters (one script, so the tally Web Worker can be built from its text), the 3D rig,
arena, director, show and app scripts, and JSON blocks for the fighter roster, calibration results,
scenario presets and overrides. Embedded binary assets (assets/embed/*) become data: URIs on
window.FightAssets. That is what the claude.ai artifact host allows.
"""
import base64
import json
import mimetypes
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))

# placeholder -> list of source files concatenated in order
SCRIPTS = {
    "/*__ENGINE__*/": ["src/params3.js", "src/engine3.js"],
    "/*__RIG__*/": ["src/rig3d.js"],
    "/*__ARENA__*/": ["src/arena3d.js"],
    "/*__DIRECTOR__*/": ["src/director3.js"],
    "/*__SHOW__*/": ["src/show3d.js"],
    "/*__APP__*/": ["src/app.js"],
}

# placeholder -> JSON file (minified and made safe inside <script type="application/json">)
JSON_BLOCKS = {
    "/*__FIGHTERS_JSON__*/": "data/derived/fighters.json",
    "/*__CALIB_JSON__*/": "data/derived/calibration.json",
    "/*__SCENARIOS_JSON__*/": "data/scenarios.json",
    "/*__OVERRIDES_JSON__*/": "data/overrides.json",
}

ASSETS_MARKER = "/*__ASSETS__*/"
ASSETS_DIR = os.path.join(ROOT, "assets", "embed")
MAX_BYTES = 15 * 1024 * 1024


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


def safe_json(rel):
    data = json.loads(read(rel))
    text = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
    # "</" inside a script block would end it; "<\/" is the same JSON string
    return text.replace("</", "<\\/")


def assets_js():
    out = {}
    if os.path.isdir(ASSETS_DIR):
        for name in sorted(os.listdir(ASSETS_DIR)):
            path = os.path.join(ASSETS_DIR, name)
            if not os.path.isfile(path) or name.startswith("."):
                continue
            mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
            if name.endswith(".glb"):
                mime = "model/gltf-binary"
            with open(path, "rb") as f:
                out[name] = "data:" + mime + ";base64," + base64.b64encode(f.read()).decode("ascii")
    return "window.FightAssets = " + json.dumps(out, separators=(",", ":")) + ";"


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "volk-gaethje-simulator.html")
    page = read("src/page.src.html")

    for marker, files in SCRIPTS.items():
        code = "\n".join(read(f) for f in files)
        if "</script" in code.lower():
            raise SystemExit(", ".join(files) + " contains a closing script tag; it would break the inline build")
        if page.count(marker) != 1:
            raise SystemExit("placeholder " + marker + " must appear exactly once in page.src.html")
        page = page.replace(marker, code)

    for marker, rel in JSON_BLOCKS.items():
        if page.count(marker) != 1:
            raise SystemExit("placeholder " + marker + " must appear exactly once in page.src.html")
        page = page.replace(marker, safe_json(rel))

    if ASSETS_MARKER in page:
        page = page.replace(ASSETS_MARKER, assets_js())

    size = len(page.encode("utf-8"))
    if size > MAX_BYTES:
        raise SystemExit("built page is %d bytes, over the %d byte budget" % (size, MAX_BYTES))
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        f.write(page)
    print("built", out, size, "bytes")


if __name__ == "__main__":
    main()
