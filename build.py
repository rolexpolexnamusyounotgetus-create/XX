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
    "/*__AVATAR__*/": ["src/avatar3d.js"],
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


# pieces another workstream may not have written yet: missing ones build as empty with a warning
OPTIONAL = {"src/avatar3d.js": "", "src/director3.js": "", "data/derived/calibration.json": "null", "data/scenarios.json": "{}"}

# optional block: scouting files and likeness sheets by slug, inlined only when the page asks for them
SCOUTING_MARKER = "/*__SCOUTING_JSON__*/"
SCOUTING_DIRS = (("data/scouting", "scouting"), ("data/likeness", "likeness"))


def read(rel):
    path = os.path.join(ROOT, rel)
    if not os.path.exists(path) and rel in OPTIONAL:
        print("warning: " + rel + " is missing; building without it", file=sys.stderr)
        return OPTIONAL[rel]
    with open(path, encoding="utf-8") as f:
        return f.read()


def safe_json(rel):
    data = json.loads(read(rel))
    text = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
    # "</" inside a script block would end it; "<\/" is the same JSON string
    return text.replace("</", "<\\/")


def scouting_json():
    out = {}
    for rel, key in SCOUTING_DIRS:
        out[key] = {}
        d = os.path.join(ROOT, rel)
        if not os.path.isdir(d):
            continue
        for name in sorted(os.listdir(d)):
            if not name.endswith(".json") or name.startswith("."):
                continue
            try:
                with open(os.path.join(d, name), encoding="utf-8") as f:
                    out[key][name[:-5]] = json.load(f)
            except ValueError as e:
                print("warning: skipping " + rel + "/" + name + " (" + str(e) + ")", file=sys.stderr)
    text = json.dumps(out, separators=(",", ":"), ensure_ascii=False)
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
    return "window.FightAssets = " + json.dumps(out, separators=(",", ":")) + ";\n" + scouting_js()


def scouting_js():
    """Appearance blocks from data/scouting/*.json, for the avatar builder's defaults (a few KB)."""
    out = {}
    d = os.path.join(ROOT, "data", "scouting")
    if os.path.isdir(d):
        for name in sorted(os.listdir(d)):
            if not name.endswith(".json"):
                continue
            try:
                with open(os.path.join(d, name), encoding="utf-8") as f:
                    app = json.load(f).get("appearance")
            except (ValueError, OSError):
                continue
            if isinstance(app, dict):
                out[name[:-5]] = {k: v for k, v in app.items() if k != "sources"}
    return "window.FightScouting = " + json.dumps(out, separators=(",", ":"), ensure_ascii=False).replace("</", "<\\/") + ";"


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

    if page.count(SCOUTING_MARKER) == 1:
        page = page.replace(SCOUTING_MARKER, scouting_json())

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
