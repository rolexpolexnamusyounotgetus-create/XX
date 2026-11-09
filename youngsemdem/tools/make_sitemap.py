#!/usr/bin/env python3
"""tools/make_sitemap.py: write sitemap.xml for the site.

Base URL (first found wins): --base, then the SITE_URL environment variable, then
YSD_CONFIG.site.url from assets/js/config.js (read through `node tools/read_config.js`, so
config.local.js overrides count too). With no base URL it stops with exit code 2: a sitemap needs
absolute URLs, and the demo has no real domain yet.

Pages: every *.html under the root, like tools/sync_partials.py (skips tools/, tests/, docs/,
partials/, netlify/, functions/, hidden folders), minus 404.html, offline.html, any page whose
filename starts with "_" and any page with <meta name="robots" content="...noindex...">.

URL for each page: its <link rel="canonical"> when that is an absolute URL on the base origin;
otherwise built from the path. --style pretty (default) drops ".html" (index.html -> folder URL):
Cloudflare Pages redirects .html URLs to the extensionless ones, and Netlify and GitHub Pages
serve both. --style html keeps the file names.

<lastmod> is the file's last git commit date, or its modification time if it is not committed
(--no-lastmod leaves it out).

Usage:
    python3 tools/make_sitemap.py --base https://example.org [--style pretty|html]
           [--root DIR] [--out FILE] [--robots] [--no-lastmod] [--print]
    --robots   also add or replace the "Sitemap: <base>/sitemap.xml" line in robots.txt
    --print    print the XML instead of writing it
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parent.parent
EXCLUDE_DIRS = {"tools", "tests", "docs", "partials", "node_modules", "netlify", "functions",
                "vendor", "dist", "build"}
SKIP_FILES = {"404.html", "offline.html"}
NOINDEX_RE = re.compile(r"""<meta\b(?=[^>]*\bname\s*=\s*["']?robots["']?)(?=[^>]*\bcontent\s*=\s*["'][^"']*noindex)[^>]*>""",
                        re.IGNORECASE)
CANON_RE = re.compile(r"""<link\b(?=[^>]*\brel\s*=\s*["']?canonical["']?)[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>""",
                      re.IGNORECASE)


def find_pages(root: Path) -> list[Path]:
    pages = []
    for dirpath, dirnames, filenames in os.walk(root):
        rel = Path(dirpath).relative_to(root)
        dirnames[:] = sorted(d for d in dirnames
                             if not d.startswith(".") and d != "node_modules"
                             and not (rel == Path(".") and d in EXCLUDE_DIRS))
        for f in sorted(filenames):
            if f.lower().endswith(".html"):
                pages.append(Path(dirpath) / f)
    return pages


def config_url(root: Path) -> str:
    script = Path(__file__).resolve().parent / "read_config.js"
    try:
        out = subprocess.run(["node", str(script), "--root", str(root), "site.url"],
                             capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.SubprocessError):
        return ""
    if out.returncode != 0:
        return ""
    try:
        val = json.loads(out.stdout.strip() or "null")
    except ValueError:
        return ""
    return val if isinstance(val, str) else ""


def lastmod(path: Path, root: Path) -> str:
    try:
        out = subprocess.run(["git", "log", "-1", "--format=%cI", "--", str(path)], cwd=str(root),
                             capture_output=True, text=True, timeout=10)
        stamp = out.stdout.strip()
        if out.returncode == 0 and stamp:
            # A file with uncommitted edits is newer than its last commit.
            dirty = subprocess.run(["git", "status", "--porcelain", "--", str(path)], cwd=str(root),
                                   capture_output=True, text=True, timeout=10).stdout.strip()
            if not dirty:
                return stamp[:10]
    except (OSError, subprocess.SubprocessError):
        pass
    return dt.datetime.fromtimestamp(path.stat().st_mtime, dt.timezone.utc).strftime("%Y-%m-%d")


def page_url(base: str, rel: str, style: str) -> str:
    if style == "pretty":
        if rel == "index.html":
            path = ""
        elif rel.endswith("/index.html"):
            path = rel[: -len("index.html")]
        else:
            path = rel[: -len(".html")]
    else:
        path = "" if rel == "index.html" else rel
    return base + "/" + path


def build(root: Path, base: str, style: str, with_lastmod: bool) -> tuple[str, list[dict], list[str]]:
    entries, skipped = [], []
    base_origin = urlparse(base)
    for page in find_pages(root):
        rel = page.relative_to(root).as_posix()
        name = page.name
        if name in SKIP_FILES or name.startswith("_"):
            skipped.append(f"{rel} (special page)")
            continue
        text = page.read_text(encoding="utf-8", errors="replace")
        if NOINDEX_RE.search(text):
            skipped.append(f"{rel} (noindex)")
            continue
        loc = page_url(base, rel, style)
        cm = CANON_RE.search(text)
        if cm:
            c = urlparse(cm.group(1))
            if c.scheme in ("http", "https") and c.netloc == base_origin.netloc:
                loc = cm.group(1)
        entry = {"loc": loc, "file": rel}
        if with_lastmod:
            entry["lastmod"] = lastmod(page, root)
        entries.append(entry)
    entries.sort(key=lambda e: (e["loc"] != base + "/", e["loc"]))
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for e in entries:
        lines.append("  <url>")
        lines.append(f"    <loc>{escape(e['loc'])}</loc>")
        if "lastmod" in e:
            lines.append(f"    <lastmod>{e['lastmod']}</lastmod>")
        lines.append("  </url>")
    lines.append("</urlset>")
    return "\n".join(lines) + "\n", entries, skipped


def update_robots(robots: Path, sitemap_url: str) -> bool:
    text = robots.read_text(encoding="utf-8") if robots.exists() else "User-agent: *\nDisallow:\n"
    line = f"Sitemap: {sitemap_url}"
    if re.search(r"(?im)^sitemap:.*$", text):
        new = re.sub(r"(?im)^sitemap:.*$", line, text, count=1)
    else:
        new = text.rstrip("\n") + "\n\n" + line + "\n"
    if new != text:
        robots.write_text(new, encoding="utf-8")
        return True
    return False


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Write sitemap.xml from the site's pages.")
    ap.add_argument("--base", default="", help="absolute site URL, e.g. https://example.org")
    ap.add_argument("--root", default=str(ROOT), help="site root (default: the folder above tools/)")
    ap.add_argument("--out", default="", help="output file (default: <root>/sitemap.xml)")
    ap.add_argument("--style", choices=("pretty", "html"), default="pretty", help="URL style (default pretty)")
    ap.add_argument("--robots", action="store_true", help="add/replace the Sitemap line in robots.txt")
    ap.add_argument("--no-lastmod", action="store_true", help="leave out <lastmod>")
    ap.add_argument("--print", action="store_true", help="print the XML instead of writing it")
    args = ap.parse_args(argv)

    root = Path(args.root).resolve()
    if not root.is_dir():
        print(f"make_sitemap: root {root} is not a folder", file=sys.stderr)
        return 2
    base = (args.base or os.environ.get("SITE_URL", "") or config_url(root)).strip()
    if not base:
        print("make_sitemap: no base URL. Set site.url in assets/js/config.js, or pass "
              "--base https://<domain> (the demo has no real domain yet).", file=sys.stderr)
        return 2
    p = urlparse(base)
    if p.scheme not in ("http", "https") or not p.netloc:
        print(f"make_sitemap: base URL must be absolute (https://...), got {base!r}", file=sys.stderr)
        return 2
    base = f"{p.scheme}://{p.netloc}{p.path.rstrip('/')}"

    xml, entries, skipped = build(root, base, args.style, not args.no_lastmod)
    if args.print:
        sys.stdout.write(xml)
        return 0
    out = Path(args.out).resolve() if args.out else root / "sitemap.xml"
    out.write_text(xml, encoding="utf-8")
    print(f"make_sitemap: {len(entries)} URLs -> {out}" + (f" (skipped: {', '.join(skipped)})" if skipped else ""))
    if not entries:
        print("make_sitemap: no pages yet; wrote an empty urlset.")
    if args.robots:
        robots = root / "robots.txt"
        changed = update_robots(robots, base + "/" + out.name if out.parent == root else base + "/sitemap.xml")
        print(f"make_sitemap: robots.txt {'updated' if changed else 'already up to date'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
