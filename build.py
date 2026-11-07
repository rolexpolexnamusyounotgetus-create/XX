"""Inline src/ and data/ into one self-contained page.

    python3 build.py                 # writes volk-gaethje-simulator.html (the published page)
    python3 build.py out/test.html   # writes somewhere else (handy for parallel work and tests)

The page loads three.js from a pinned CDN URL and inlines everything else: the engine and its
calibrated parameters (one script, so the tally Web Worker can be built from its text), the 3D rig,
arena, director, show and app scripts, and JSON blocks for the fighter roster, calibration results,
scenario presets and overrides (the roster, scouting files and likeness sheets ship gzip + base64 and the page inflates
them before it starts). Embedded binary assets (assets/embed/*) become data: URIs on
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
    # engine v4: the learned stat-line adapter travels in the engine script, so the tally Web Worker built from this
    # script's text has MLRates too (the page posts the model JSON to the worker; FightEngine.loadMLRates)
    # v5.0.1 (v5 review): the page must run the same model as the Node production path; tests/test_page_parity.js checks it.
    # An engine whose params switch on embed / blend_anchor needs src/ml/embed.js / src/ml/blend.js here (ahead of engine3.js),
    # and durability / preufc / embed need their rosters loaded by src/app.js; otherwise switch them off for the page.
    "/*__ENGINE__*/": ["src/params3.js", "src/ml/mlrates.js", "src/styles_sos.js", "src/engine3.js"],
    "/*__RIG__*/": ["src/rig3d.js"],
    "/*__AVATAR__*/": ["src/avatar3d.js"],
    "/*__ARENA__*/": ["src/arena3d.js"],
    "/*__DIRECTOR__*/": ["src/director3.js"],
    "/*__SHOW__*/": ["src/show3d.js"],
    "/*__APP__*/": ["src/app.js"],
    # verified browser models (page pass 3, Nov 7, 2026): the ML v2 winner model and its three stacks (src/ml/ml2.js with
    # forward_models.json's fit-2019-2023 weights), the page recipe (src/ml/pagepredict.js), method x round S / S2
    # (tools/methodround_model.js), the distributional stat lines (statdist + the embedding it reads), the debut method
    # model, and moe.js for its de-vig helpers only (its stack no longer decides anything on the page)
    "/*__ML__*/": ["src/ml/moe.js", "src/ml/ml2.js", "src/ml/pagepredict.js", "tools/methodround_model.js",
                   "src/ml/statdist.js", "src/ml/embed.js", "src/ml/debut.js"],
    # broadcast sound (FightAudio); optional until the 3D workstream lands it
    "/*__AUDIO__*/": ["src/audio.js"],
}

# placeholder -> JSON file (minified and made safe inside <script type="application/json">)
JSON_BLOCKS = {
    "/*__CALIB_JSON__*/": "data/derived/calibration.json",
    "/*__SCENARIOS_JSON__*/": "data/scenarios.json",
    "/*__OVERRIDES_JSON__*/": "data/overrides.json",
}

ASSETS_MARKER = "/*__ASSETS__*/"
ASSETS_DIR = os.path.join(ROOT, "assets", "embed")
MAX_BYTES = 15 * 1024 * 1024


# pieces another workstream may not have written yet: missing ones build as empty with a warning
OPTIONAL = {"src/avatar3d.js": "", "src/director3.js": "", "data/derived/calibration.json": "null", "data/scenarios.json": "{}",
            "src/audio.js": "", "src/ml/moe.js": "", "src/ml/mlrates.js": "", "src/ml/mlpage.js": "",
            "tools/methodround_model.js": "", "src/ml/statdist.js": "", "src/ml/embed.js": "", "src/ml/debut.js": ""}

# the fighter roster: gzip + base64 (about a quarter of the plain JSON); the page inflates it before anything else runs.
# The plain placeholder still works for older page sources.
FIGHTERS_GZ_MARKER = "/*__FIGHTERS_GZ__*/"
FIGHTERS_JSON_MARKER = "/*__FIGHTERS_JSON__*/"
FIGHTERS_FILE = "data/derived/fighters.json"

# optional block: scouting files and likeness sheets by slug, inlined only when the page asks for them
# (gzip + base64 under SCOUTING_GZ_MARKER, plain JSON under SCOUTING_MARKER for older page sources)
SCOUTING_MARKER = "/*__SCOUTING_JSON__*/"
SCOUTING_GZ_MARKER = "/*__SCOUTING_GZ__*/"
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


def scouting_data():
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
    return out


def scouting_json():
    text = json.dumps(scouting_data(), separators=(",", ":"), ensure_ascii=False)
    return text.replace("</", "<\\/")


# ------------------------------------------------------------------ model blocks (derived at build time)
# Each returns a JSON-serialisable object, or None when its source is missing (the page then shows the
# model as unavailable). Only what the browser evaluators read is kept, so the page stays small.

def load_json(rel):
    path = os.path.join(ROOT, rel)
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except ValueError as e:
        print("warning: " + rel + " is not valid JSON (" + str(e) + ")", file=sys.stderr)
        return None


def mlrates_block():
    return load_json("data/derived/mlrates.json")


def methodround_block():
    d = load_json("data/derived/methodround.json")
    if not d or "js_model" not in d:
        return None
    jm = dict(d["js_model"])
    jm.pop("source", None)          # the evaluator's own source text; the page inlines tools/methodround_model.js
    return jm


def g(o, *path):
    for p in path:
        if not isinstance(o, dict) or p not in o:
            return None
        o = o[p]
    return o


def versions_block():
    return load_json("data/derived/version_history.json")


def forward_block():
    """Upcoming cards, the latest odds snapshot, committed ledger files and results (data/predictions/)."""
    base = "data/predictions"
    cards = load_json(base + "/cards_upcoming.json")
    if not cards:
        return None
    d = os.path.join(ROOT, base)
    names = sorted(os.listdir(d)) if os.path.isdir(d) else []
    snaps = [n for n in names if n.startswith("odds_snapshot_") and n.endswith(".json")]
    odds = {}
    snap_meta = None
    if snaps:
        o = load_json(base + "/" + snaps[-1]) or {}
        snap_meta = {"file": snaps[-1], "utc": g(o, "meta", "snapshot_utc")}
        for b in o.get("bouts") or []:
            c = b.get("consensus") or {}
            m = b.get("market") or {}
            odds[b.get("bout_id")] = {"p": c.get("p_consensus"), "n": c.get("n_books"),
                                      "oa": m.get("odds_a"), "ob": m.get("odds_b"),
                                      "a": g(b, "A", "slug"), "an": g(b, "A", "name")}
    ledger = {}
    for n in names:
        if len(n) > 11 and n[:4].isdigit() and n[4] == "-" and n.endswith(".json"):
            f = load_json(base + "/" + n) or {}
            for b in f.get("bouts") or []:
                ledger[b.get("bout_id")] = {"p_a": b.get("p_a"), "file": n, "model": g(f, "model", "version")}
    res = {}
    rj = load_json(base + "/results.json")
    for r in (rj or {}).get("results") or []:
        res[r.get("bout_id")] = {k: r.get(k) for k in ("outcome", "winner", "method", "round", "time", "closing_odds")}

    def slugify(s):
        import re
        import unicodedata
        s = unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode().lower()
        return re.sub(r"[^a-z0-9]+", "-", s).strip("-")

    events = []
    for ev in cards.get("events") or []:
        bouts = []
        for b in ev.get("bouts") or []:
            a, bb = b.get("a") or {}, b.get("b") or {}
            bid = ev["date"] + ":" + (a.get("slug") or slugify(a.get("name"))) + "__" + (bb.get("slug") or slugify(bb.get("name")))
            ob = odds.get(bid)
            mk = None
            if ob and ob.get("p") is not None:
                p, oa, obb = ob["p"], ob.get("oa"), ob.get("ob")
                # the snapshot is oriented like the card; flip if its A is the card's B
                if ob.get("a") and a.get("slug") and ob["a"] != a.get("slug"):
                    p, oa, obb = 1 - p, obb, oa
                mk = {"p": p, "n": ob.get("n"), "oa": oa, "ob": obb}
            bouts.append({"id": bid, "order": b.get("order"), "seg": b.get("segment"), "wc": b.get("weight_class"),
                          "rounds": b.get("rounds"), "title": bool(b.get("title")), "status": b.get("status"),
                          "a": {"name": a.get("name"), "slug": a.get("slug")}, "b": {"name": bb.get("name"), "slug": bb.get("slug")},
                          "mkt": mk, "ledger": ledger.get(bid), "result": res.get(bid)})
        events.append({"name": ev.get("name"), "date": ev.get("date"), "loc": ev.get("location"),
                       "status": ev.get("event_status"), "bouts": bouts})
    return {"as_of": cards.get("as_of"), "odds": snap_meta, "n_ledger": len(ledger), "n_results": len(res), "events": events}


DERIVED = {
    "/*__MOE_JSON__*/": moe_block,
    "/*__MKT_JSON__*/": market_block,
    "/*__BENCH_JSON__*/": bench_block,
    "/*__VERSIONS_JSON__*/": versions_block,
    "/*__FORWARD_JSON__*/": forward_block,
}


def no_nan(o):
    """NaN / Infinity are not JSON; the browser's JSON.parse would reject the whole block."""
    if isinstance(o, float):
        return o if o == o and o not in (float("inf"), float("-inf")) else None
    if isinstance(o, dict):
        return {k: no_nan(v) for k, v in o.items()}
    if isinstance(o, list):
        return [no_nan(v) for v in o]
    return o


# the three big model files ship gzip-compressed and base64-encoded (about half the bytes); the page inflates them
# with the browser's DecompressionStream, like the avatar assets
DERIVED_GZ = {
    "/*__MLRATES_GZ__*/": mlrates_block,
    "/*__MLPAGE_GZ__*/": mlpage_block,
    "/*__MR_GZ__*/": methodround_block,
}


def gz_b64(data):
    import gzip
    raw = json.dumps(data, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")
    return base64.b64encode(gzip.compress(raw, 9, mtime=0)).decode("ascii")


def derived_gz(fn):
    try:
        data = no_nan(fn())
    except Exception as e:
        print("warning: " + fn.__name__ + " failed (" + repr(e) + "); building without it", file=sys.stderr)
        data = None
    if data is None:
        return ""
    return gz_b64(data)


def derived_json(fn):
    try:
        data = no_nan(fn())
    except Exception as e:  # a broken report must not break the page build
        print("warning: " + fn.__name__ + " failed (" + repr(e) + "); building without it", file=sys.stderr)
        data = None
    text = json.dumps(data, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
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

    # the roster: exactly one of the two placeholders
    n_gz, n_js = page.count(FIGHTERS_GZ_MARKER), page.count(FIGHTERS_JSON_MARKER)
    if n_gz + n_js != 1:
        raise SystemExit("page.src.html needs exactly one roster placeholder (" + FIGHTERS_GZ_MARKER + " or " + FIGHTERS_JSON_MARKER + ")")
    if n_gz:
        page = page.replace(FIGHTERS_GZ_MARKER, gz_b64(json.loads(read(FIGHTERS_FILE))))
    else:
        page = page.replace(FIGHTERS_JSON_MARKER, safe_json(FIGHTERS_FILE))

    for marker, rel in JSON_BLOCKS.items():
        if page.count(marker) != 1:
            raise SystemExit("placeholder " + marker + " must appear exactly once in page.src.html")
        page = page.replace(marker, safe_json(rel))

    for marker, fn in DERIVED.items():
        if page.count(marker) == 1:
            page = page.replace(marker, derived_json(fn))
    for marker, fn in DERIVED_GZ.items():
        if page.count(marker) == 1:
            page = page.replace(marker, derived_gz(fn))

    if page.count(SCOUTING_GZ_MARKER) == 1:
        page = page.replace(SCOUTING_GZ_MARKER, gz_b64(scouting_data()))
    elif page.count(SCOUTING_MARKER) == 1:
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
