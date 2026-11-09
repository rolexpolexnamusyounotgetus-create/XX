#!/usr/bin/env python3
"""tools/credits.py: list every remote photo, video, audio and font the site uses, in CREDITS.md.

Scans the site's HTML, CSS, JS, JSON and SVG files (skipping tools/, tests/, docs/, netlify/,
functions/, node_modules/ and hidden folders) for remote media URLs:
  - images.unsplash.com (plus.unsplash.com, source.unsplash.com) photos,
  - Google Fonts (fonts.googleapis.com stylesheets, fonts.gstatic.com files),
  - Pexels, Pixabay, Wikimedia Commons, YouTube thumbnails, Giphy,
  - any other https URL whose path ends in an image, video, audio or font extension.
Each asset (one per URL without its ?query) is listed with every file:line that uses it, and with
any credit found next to it:
  - JS/JSON data: keys in the same object literal (photographer / author / artist / creator /
    credit, photographerHandle, page / source / link, license / licenseUrl), the way
    data/clips.js records its Unsplash photos;
  - HTML: data-credit / data-photographer / data-license / data-source on the same tag;
  - CSS: a /* credit: ... */ comment on the same or the previous line.
Font files (fonts.gstatic.com, or any .woff/.woff2/.ttf/.otf URL) are credited to their font family,
not to a photographer: the family comes from a `family` key in the same object (assets/fonts/fonts.json
records one per self-hosted file, with `license` and `copyright`), else from the URL. They are listed
under Fonts with that license and copyright, never under Missing credits.

Usage:
    python3 tools/credits.py            write CREDITS.md in the site root
    python3 tools/credits.py --check    exit 1 if CREDITS.md is out of date (ignores the date)
    options: --root DIR, --out FILE, --json (print the data as JSON instead)
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

ROOT = Path(__file__).resolve().parent.parent
EXCLUDE_DIRS = {"tools", "tests", "docs", "netlify", "functions", "node_modules", "vendor"}
EXTS = {".html", ".htm", ".css", ".js", ".mjs", ".json", ".webmanifest", ".svg"}
SKIP_FILES = {"CREDITS.md", "sw.js"}
URL_RE = re.compile(r"""https?://[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?::\d+)?(?:/[^\s"'`()<>\\{}|^]*)?""")
MEDIA_EXT = {
    "image": {".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".svg", ".bmp", ".heic"},
    "video": {".mp4", ".m4v", ".mov", ".webm", ".ogv", ".m3u8"},
    "audio": {".mp3", ".m4a", ".wav", ".ogg", ".aac", ".flac"},
    "font": {".woff", ".woff2", ".ttf", ".otf", ".eot"},
}
SKIP_HOSTS = {"example.com", "example.org", "example.net", "localhost"}
SOURCES = [
    (re.compile(r"^(images|plus|source)\.unsplash\.com$"), "Unsplash", "photo"),
    (re.compile(r"^fonts\.googleapis\.com$"), "Google Fonts", "font"),
    (re.compile(r"^fonts\.gstatic\.com$"), "Google Fonts", "font file"),
    (re.compile(r"^(images|videos)\.pexels\.com$"), "Pexels", "media"),
    (re.compile(r"^cdn\.pixabay\.com$"), "Pixabay", "media"),
    (re.compile(r"^upload\.wikimedia\.org$"), "Wikimedia Commons", "media"),
    (re.compile(r"^(i\.ytimg|img\.youtube)\.com$"), "YouTube", "thumbnail"),
    (re.compile(r"^media\d*\.giphy\.com$"), "Giphy", "gif"),
]
CREDIT_KEYS = ("photographer", "author", "artist", "creator", "credit", "attribution")
KV_RE = re.compile(r"""["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*:\s*(["'])((?:\\.|(?!\2).)*)\2""")
ATTR_RE = re.compile(r"""\b(data-(?:credit|photographer|author|license|source))\s*=\s*(["'])(.*?)\2""", re.IGNORECASE)
CSS_CREDIT_RE = re.compile(r"/\*\s*credit\s*:\s*(.*?)\s*\*/", re.IGNORECASE)


def iter_files(root: Path):
    for dirpath, dirnames, filenames in os.walk(root):
        rel = Path(dirpath).relative_to(root)
        dirnames[:] = sorted(d for d in dirnames
                             if not d.startswith(".") and d != "node_modules"
                             and not (rel == Path(".") and d in EXCLUDE_DIRS))
        for f in sorted(filenames):
            p = Path(dirpath) / f
            if p.suffix.lower() in EXTS and f not in SKIP_FILES:
                yield p


def classify(url: str):
    u = urlparse(url)
    host = (u.hostname or "").lower()
    if not host or host in SKIP_HOSTS or host.endswith(".example.com") or host.endswith(".example.org"):
        return None
    for rx, source, kind in SOURCES:
        if rx.match(host):
            if source == "Unsplash" and not u.path.strip("/"):
                return None
            if source == "Google Fonts" and kind == "font" and not u.path.startswith("/css"):
                return None
            if source == "Google Fonts" and kind == "font file" and not u.path.strip("/"):
                return None
            return source, kind
    ext = os.path.splitext(u.path.lower())[1]
    for kind, exts in MEDIA_EXT.items():
        if ext in exts:
            return host, kind
    return None


def enclosing_object(text: str, pos: int, limit: int = 4000) -> str:
    """The innermost {...} literal around pos (rough brace matching; good enough for data files)."""
    depth, start = 0, None
    for i in range(pos - 1, max(-1, pos - limit), -1):
        ch = text[i]
        if ch == "}":
            depth += 1
        elif ch == "{":
            if depth == 0:
                start = i
                break
            depth -= 1
    if start is None:
        return ""
    depth = 0
    for j in range(start, min(len(text), start + limit)):
        ch = text[j]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start:j + 1]
    return ""


def top_level_pairs(obj: str) -> dict:
    """key: string pairs at depth 1 of an object literal (nested objects/arrays ignored)."""
    out, depth, i = {}, 0, 0
    while i < len(obj):
        ch = obj[i]
        if ch in "{[":
            depth += 1
            i += 1
            continue
        if ch in "}]":
            depth -= 1
            i += 1
            continue
        if depth == 1:
            m = KV_RE.match(obj, i)
            if m:
                out.setdefault(m.group(1), m.group(3).replace('\\"', '"').replace("\\'", "'"))
                i = m.end()
                continue
        i += 1
    return out


def credit_near(path: Path, text: str, pos: int, line_no: int, lines: list[str]) -> dict:
    ext = path.suffix.lower()
    info = {}
    if ext in (".js", ".mjs", ".json", ".webmanifest"):
        pairs = top_level_pairs(enclosing_object(text, pos))
        for k in CREDIT_KEYS:
            if pairs.get(k):
                info["credit"] = pairs[k]
                break
        handle = pairs.get("photographerHandle") or pairs.get("authorHandle")
        if handle:
            info["handle"] = handle
        for k in ("page", "source", "link", "sourceUrl", "pageUrl"):
            v = pairs.get(k, "")
            if v.startswith("http") and v.split("?")[0] != text[pos:pos + len(v)].split("?")[0]:
                info["page"] = v
                break
        if pairs.get("license"):
            info["license"] = pairs["license"]
        if pairs.get("licenseUrl"):
            info["licenseUrl"] = pairs["licenseUrl"]
    elif ext in (".html", ".htm", ".svg"):
        lt = text.rfind("<", 0, pos)
        gt = text.find(">", pos)
        tag = text[lt:gt + 1] if lt >= 0 and gt >= 0 else ""
        for name, _q, val in ATTR_RE.findall(tag):
            key = name.lower().replace("data-", "")
            if key in ("credit", "photographer", "author"):
                info["credit"] = val
            elif key == "license":
                info["license"] = val
            elif key == "source":
                info["page"] = val
    elif ext == ".css":
        for ln in (lines[line_no - 1], lines[line_no - 2] if line_no >= 2 else ""):
            m = CSS_CREDIT_RE.search(ln)
            if m:
                info["credit"] = m.group(1)
                break
    return info


def font_meta(path: Path, text: str, pos: int) -> dict:
    """family / license / copyright / specimen recorded in the same JS or JSON object as a font URL."""
    if path.suffix.lower() not in (".js", ".mjs", ".json", ".webmanifest"):
        return {}
    pairs = top_level_pairs(enclosing_object(text, pos))
    return {k: pairs[k] for k in ("family", "license", "copyright", "specimen") if pairs.get(k)}


def family_from_url(url: str) -> str:
    """Best guess at a family name from a font file URL (fonts.gstatic.com/s/<family>/...), else ''."""
    parts = [p for p in urlparse(url).path.split("/") if p]
    if len(parts) >= 3 and parts[0] == "s":
        return parts[1]
    return ""


def google_families(url: str) -> list[str]:
    q = parse_qs(urlparse(url).query)
    fams = []
    for v in q.get("family", []):
        for part in v.split("|"):
            name = unquote(part.split(":")[0]).replace("+", " ").strip()
            if name:
                fams.append(name)
    return fams


def scan(root: Path) -> dict:
    assets: dict[str, dict] = {}
    fonts: dict[str, dict] = {}
    for path in iter_files(root):
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        rel = path.relative_to(root).as_posix()
        lines = text.split("\n")
        for m in URL_RE.finditer(text):
            url = m.group(0).rstrip(".,;:")
            kind = classify(url)
            if not kind:
                continue
            source, what = kind
            line_no = text.count("\n", 0, m.start()) + 1
            where = f"{rel}:{line_no}"
            if source == "Google Fonts" and what == "font":
                meta = font_meta(path, text, m.start())
                for fam in google_families(url) or ["(unnamed family)"]:
                    f = fonts.setdefault(fam, {"family": fam, "source": "Google Fonts", "urls": set(), "used": set(), "meta": {}})
                    f["urls"].add(url)
                    f["used"].add(where)
                    for k, v in meta.items():
                        if k != "family":
                            f["meta"].setdefault(k, v)
                continue
            if what in ("font file", "font"):
                # a font file belongs to its family (credited by license and copyright, not a photographer)
                meta = font_meta(path, text, m.start())
                fam = meta.get("family") or family_from_url(url) or "(unnamed family)"
                f = fonts.setdefault(fam, {"family": fam, "source": source if source == "Google Fonts" else source,
                                           "urls": set(), "used": set(), "meta": {}})
                f["urls"].add(url.split("?")[0].split("#")[0])
                f["used"].add(where)
                for k, v in meta.items():
                    if k != "family":
                        f["meta"].setdefault(k, v)
                continue
            key = url.split("?")[0].split("#")[0]
            a = assets.setdefault(key, {"url": key, "source": source, "kind": what, "variants": set(),
                                        "used": set(), "credit": {}})
            if url != key:
                a["variants"].add(url)
            a["used"].add(where)
            for k, v in credit_near(path, text, m.start(), line_no, lines).items():
                a["credit"].setdefault(k, v)

    def ordered_used(s):
        def k(w):
            f, _, n = w.rpartition(":")
            return (f, int(n))
        return sorted(s, key=k)

    asset_list = []
    for a in sorted(assets.values(), key=lambda x: (x["source"], x["url"])):
        asset_list.append({**a, "variants": sorted(a["variants"]), "used": ordered_used(a["used"])})
    font_list = [{**f, "urls": sorted(f["urls"]), "used": ordered_used(f["used"]), "meta": dict(sorted(f.get("meta", {}).items()))}
                 for f in sorted(fonts.values(), key=lambda x: x["family"].lower())]
    return {"assets": asset_list, "fonts": font_list}


def md_escape(s: str) -> str:
    return str(s).replace("|", "\\|").replace("\n", " ")


def short_name(url: str) -> str:
    p = urlparse(url)
    tail = p.path.rstrip("/").split("/")[-1] or p.hostname
    return tail if len(tail) <= 48 else tail[:45] + "..."


def render(data: dict, today: str) -> str:
    assets, fonts = data["assets"], data["fonts"]
    out = ["# Credits", "",
           f"Generated by `python3 tools/credits.py` on {today}. Do not edit this file by hand: re-run",
           "the script after adding or removing remote media (`--check` reports drift).", "",
           "It lists every remote photo, video, audio and font URL found in the site's HTML, CSS, JS and",
           "data files, with the credit recorded next to it and every place it is used. Before launch,",
           "self-host these files and keep the credits (DEPLOY.md, \"Self-host fonts and photos\").", ""]
    out += [f"## Photos and media ({len(assets)})", ""]
    if assets:
        out += ["| # | Asset | Source | Credit | License | Used in |", "|---|---|---|---|---|---|"]
        for i, a in enumerate(assets, 1):
            c = a["credit"]
            who = c.get("credit", "")
            if who and c.get("handle"):
                who += f" ({c['handle']})"
            if who and c.get("page"):
                who = f"[{who}]({c['page']})"
            elif c.get("page"):
                who = f"[source page]({c['page']})"
            who = who or "**missing**"
            lic = c.get("license", "")
            if lic and c.get("licenseUrl"):
                lic = f"[{lic}]({c['licenseUrl']})"
            used = ", ".join(f"`{u}`" for u in a["used"])
            out.append(f"| {i} | [{md_escape(short_name(a['url']))}]({a['url']}) | {md_escape(a['source'])} "
                       f"({a['kind']}) | {md_escape(who)} | {md_escape(lic) or '-'} | {used} |")
    else:
        out.append("None found.")
    out += ["", f"## Fonts ({len(fonts)})", ""]
    if fonts:
        out += ["| Family | Source | Credit | License | Used in |", "|---|---|---|---|---|"]
        for f in fonts:
            meta = f.get("meta", {})
            who = meta.get("copyright", "")
            if who and meta.get("specimen"):
                who = f"[{who}]({meta['specimen']})"
            out.append(f"| {md_escape(f['family'])} | {f['source']} | {md_escape(who) or '-'} | {md_escape(meta.get('license', '')) or '-'} | "
                       + ", ".join(f"`{u}`" for u in f["used"]) + " |")
        out += ["", "Each Google Fonts family has its own license (most use the SIL Open Font License); check",
                "the family's page on fonts.google.com before self-hosting."]
    else:
        out.append("None found.")
    missing = [a for a in assets if not a["credit"].get("credit") and not a["credit"].get("page")]
    out += ["", f"## Missing credits ({len(missing)})", ""]
    if missing:
        out.append("Record who made these (photographer and source page) next to the URL: object keys")
        out.append("`photographer` and `page` in data files, or `data-credit` on the HTML tag.")
        out.append("")
        out += [f"- {a['url']} ({', '.join(a['used'][:3])}{'...' if len(a['used']) > 3 else ''})" for a in missing]
    else:
        out.append("None.")
    if any(a["source"] == "Unsplash" for a in assets):
        out += ["", "## Licenses", "",
                "- Unsplash photos: [Unsplash License](https://unsplash.com/license). The license does not",
                "  require attribution; credits are kept here anyway. It does not allow selling photos without",
                "  significant modification or compiling them into a similar or competing service."]
    return "\n".join(out) + "\n"


def strip_date(md: str) -> str:
    return re.sub(r"^Generated by .* on \d{4}-\d{2}-\d{2}\.", "Generated", md, count=1, flags=re.M)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Write CREDITS.md listing remote media and where each is used.")
    ap.add_argument("--root", default=str(ROOT), help="site root (default: the folder above tools/)")
    ap.add_argument("--out", default="", help="output file (default: <root>/CREDITS.md)")
    ap.add_argument("--check", action="store_true", help="exit 1 if the file is out of date; write nothing")
    ap.add_argument("--json", action="store_true", help="print JSON instead of writing Markdown")
    args = ap.parse_args(argv)
    root = Path(args.root).resolve()
    if not root.is_dir():
        print(f"credits: root {root} is not a folder", file=sys.stderr)
        return 2
    data = scan(root)
    if args.json:
        print(json.dumps(data, indent=2))
        return 0
    out = Path(args.out).resolve() if args.out else root / "CREDITS.md"
    md = render(data, dt.date.today().isoformat())
    missing = sum(1 for a in data["assets"] if not a["credit"].get("credit") and not a["credit"].get("page"))
    summary = f"{len(data['assets'])} media, {len(data['fonts'])} font families, {missing} missing credits"
    if args.check:
        have = out.read_text(encoding="utf-8") if out.exists() else ""
        if strip_date(have) != strip_date(md):
            print(f"credits: {out.name} is out of date ({summary}); run `python3 tools/credits.py`.")
            return 1
        print(f"credits: {out.name} is up to date ({summary}).")
        return 0
    out.write_text(md, encoding="utf-8")
    print(f"credits: wrote {out} ({summary}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
