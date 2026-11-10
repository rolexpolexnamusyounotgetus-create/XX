#!/usr/bin/env python3
"""tools/fetch_fonts.py: download the site's three self-hosted WOFF2 files (BRIEF §3.3).

The fonts come from the Google Fonts CSS API (css2), asked for with a current Chrome user agent so
the API answers with WOFF2. For each family the script keeps only the `/* latin */` block (Latin
covers Spanish: ñ á é í ó ú ü ¿ ¡ are all in U+0000-00FF), downloads that file into assets/fonts/
under a stable name, fetches the family's SIL Open Font License text from the google/fonts
repository, and writes assets/fonts/fonts.json: every CSS URL, file URL, size, SHA-256 and licence.
Pages then make zero requests to Google: assets/css/tokens.css points @font-face at these files.

    python3 tools/fetch_fonts.py            # download (overwrites) and write fonts.json
    python3 tools/fetch_fonts.py --check    # verify the files on disk match fonts.json (no network)
    python3 tools/fetch_fonts.py --dry-run  # print the CSS URLs it would request

Files (BRIEF §3.3):
    bricolage-800-wdth.woff2   Bricolage Grotesque, wght 800 only, wdth axis 75-100 (no opsz)
    atkinson-next-var.woff2    Atkinson Hyperlegible Next, wght axis 400-800
    caveat-brush.woff2         Caveat Brush 400, subset with the API's text= parameter to the
                               characters the word stickers and sign-offs can use (EN + ES)

Exit codes: 0 ok, 1 --check found drift, 2 network or input error.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
import string
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "fonts"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/124.0.0.0 Safari/537.36")
API = "https://fonts.googleapis.com/css2"
OFL_URL = "https://openfontlicense.org/open-font-license-official-text/"

# Letters, digits, the punctuation a handwritten note uses, and the Spanish letters and marks. Brush glyphs are
# heavy (about 650 bytes each), so symbols like # $ % @ are left out: 58 KB instead of 63 KB for full ASCII.
HAND_TEXT = "".join(sorted(set(string.ascii_letters + string.digits + " .,!?'’-:¿¡áéíóúüñÁÉÍÓÚÜÑ&+()")))

FONTS = [
    {
        "file": "bricolage-800-wdth.woff2",
        "family": "Bricolage Grotesque",
        "role": "display",
        "query": "Bricolage Grotesque:wdth,wght@75..100,800",
        "axes": "wdth 75-100, wght 800 only (no opsz)",
        "subset": "latin",
        "repo": "ofl/bricolagegrotesque",
        "specimen": "https://fonts.google.com/specimen/Bricolage+Grotesque",
        "preload": True,
    },
    {
        "file": "atkinson-next-var.woff2",
        "family": "Atkinson Hyperlegible Next",
        "role": "body",
        "query": "Atkinson Hyperlegible Next:wght@400..800",
        "axes": "wght 400-800",
        "subset": "latin",
        "repo": "ofl/atkinsonhyperlegiblenext",
        "specimen": "https://fonts.google.com/specimen/Atkinson+Hyperlegible+Next",
        "preload": True,
    },
    {
        "file": "caveat-brush.woff2",
        "family": "Caveat Brush",
        "role": "hand (decorative only, not preloaded, font-display: optional)",
        "query": "Caveat Brush",
        "axes": "static 400",
        "subset": "text",
        "text": HAND_TEXT,
        "repo": "ofl/caveatbrush",
        "specimen": "https://fonts.google.com/specimen/Caveat+Brush",
        "preload": False,
    },
]

BLOCK_RE = re.compile(r"/\*\s*([\w-]+)\s*\*/\s*@font-face\s*\{([^}]*)\}", re.S)
SRC_RE = re.compile(r"url\((https://[^)]+)\)\s*format\('woff2'\)")


def css_url(font: dict) -> str:
    params = [("family", font["query"]), ("display", "swap")]
    if font.get("text"):
        params.append(("text", font["text"]))
    return API + "?" + urllib.parse.urlencode(params, quote_via=urllib.parse.quote)


def get(url: str, binary: bool = False):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/css,*/*;q=0.1"})
    with urllib.request.urlopen(req, timeout=40) as r:
        data = r.read()
    return data if binary else data.decode("utf-8")


def pick_src(css: str, font: dict) -> str:
    if font["subset"] == "text":
        m = SRC_RE.search(css)
        if not m:
            raise SystemExit(f"no woff2 src in the CSS for {font['family']}")
        return m.group(1)
    for name, body in BLOCK_RE.findall(css):
        if name == font["subset"]:
            m = SRC_RE.search(body)
            if m:
                return m.group(1)
    raise SystemExit(f"no /* {font['subset']} */ block in the CSS for {font['family']}")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fetch(dry: bool) -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "licenses").mkdir(exist_ok=True)
    records = []
    for font in FONTS:
        url = css_url(font)
        if dry:
            print(url)
            continue
        css = get(url)
        src = pick_src(css, font)
        data = get(src, binary=True)
        if data[:4] != b"wOF2":
            raise SystemExit(f"{font['file']}: the download is not WOFF2")
        (OUT / font["file"]).write_bytes(data)
        lic_url = f"https://raw.githubusercontent.com/google/fonts/main/{font['repo']}/OFL.txt"
        lic = get(lic_url)
        lic_file = f"licenses/{Path(font['repo']).name}-OFL.txt"
        (OUT / lic_file).write_text(lic, encoding="utf-8")
        copyright_line = next((ln.strip() for ln in lic.splitlines() if ln.strip().lower().startswith("copyright")), "")
        records.append({
            "file": font["file"],
            "family": font["family"],
            "role": font["role"],
            "axes": font["axes"],
            "subset": font["subset"] if font["subset"] != "text" else "text= (" + str(len(font["text"])) + " characters: letters, digits, note punctuation, Spanish letters, ¡ ¿)",
            "preload": font["preload"],
            "bytes": len(data),
            "sha256": sha256(data),
            "cssUrl": url,
            "srcUrl": src,
            "license": "SIL Open Font License 1.1",
            "licenseFile": lic_file,
            "licenseSource": lic_url,
            "licenseText": OFL_URL,
            "copyright": copyright_line,
            "specimen": font["specimen"],
        })
        print(f"{font['file']:28} {len(data):>7} bytes  {font['family']}")
    if dry:
        return 0
    manifest = {
        "tool": "tools/fetch_fonts.py",
        "fetched": dt.date.today().isoformat(),
        "userAgent": UA,
        "note": "Self-hosted copies of Google Fonts files (all SIL OFL 1.1). Re-run the tool to refresh; "
                "assets/css/tokens.css holds the @font-face rules and the measured fallback metrics.",
        "criticalPathBytes": sum(r["bytes"] for r in records if r["preload"]),
        "files": records,
    }
    (OUT / "fonts.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"critical path (preloaded): {manifest['criticalPathBytes']} bytes")
    return 0


def check() -> int:
    man_path = OUT / "fonts.json"
    if not man_path.exists():
        print("assets/fonts/fonts.json is missing: run python3 tools/fetch_fonts.py")
        return 1
    man = json.loads(man_path.read_text(encoding="utf-8"))
    bad = 0
    for rec in man.get("files", []):
        p = OUT / rec["file"]
        if not p.exists():
            print(f"missing {rec['file']}")
            bad += 1
            continue
        data = p.read_bytes()
        if sha256(data) != rec["sha256"] or len(data) != rec["bytes"]:
            print(f"changed {rec['file']} (expected {rec['bytes']} bytes, sha256 {rec['sha256'][:12]}…)")
            bad += 1
        if not (OUT / rec["licenseFile"]).exists():
            print(f"missing licence file {rec['licenseFile']}")
            bad += 1
    crit = sum(r["bytes"] for r in man.get("files", []) if r.get("preload"))
    status = "ok" if crit <= 80 * 1024 else "OVER BUDGET"
    print(f"{len(man.get('files', []))} fonts, critical path {crit} bytes ({crit / 1024:.1f} KB, budget 80 KB: {status})")
    if crit > 80 * 1024:
        bad += 1
    return 1 if bad else 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--check", action="store_true", help="verify files against fonts.json (no network)")
    ap.add_argument("--dry-run", action="store_true", help="print the CSS URLs and stop")
    a = ap.parse_args(argv)
    try:
        return check() if a.check else fetch(a.dry_run)
    except SystemExit as e:
        if isinstance(e.code, str):
            print("error:", e.code, file=sys.stderr)
            return 2
        raise
    except OSError as e:
        print("network error:", e, file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
