#!/usr/bin/env python3
"""tools/sync_partials.py: copy shared HTML snippets (partials/*.html) into every page.

No build step and no server includes: pages keep the real markup, and this script refreshes it.
In each page, the text between

    <!-- @name -->  ...  <!-- /@name -->

is replaced with the contents of partials/name.html. Markers stay in place, so the script can run
again at any time (the result is identical when nothing changed). See partials/README.md.

Pages: every *.html under the site root, recursively, except the folders in EXCLUDE_DIRS and
hidden folders. Partials may contain markers of other partials (expanded recursively).

Per page, inside inserted content:
  - {{root}} becomes the relative path from the page to the site root ("" at the root, "../"
    one level down), so partial links work on file:// and in sub-folders.
  - aria-current="page" is set on links (<a href>) that point at the page being written and
    removed from all others. Only links inside <nav> elements are considered when the partial has
    any <nav>; otherwise every link in the partial. A link with data-no-current is left alone.

Usage:
    python3 tools/sync_partials.py              update pages in place
    python3 tools/sync_partials.py --check      exit 1 if any page is out of date (no writes)
    options: --root DIR, --partials DIR, --diff (show a unified diff), --quiet, [page.html ...]

Exit codes: 0 ok, 1 drift found with --check, 2 errors (unclosed or mismatched markers, bad args).
"""
from __future__ import annotations

import argparse
import difflib
import os
import posixpath
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXCLUDE_DIRS = {"tools", "tests", "docs", "partials", "node_modules", "netlify", "functions",
                "vendor", "dist", "build"}
NAME = r"[A-Za-z0-9][A-Za-z0-9_-]*"
OPEN_RE = re.compile(r"<!--\s*@(" + NAME + r")\s*-->")
ANY_CLOSE_RE = re.compile(r"<!--\s*/@(" + NAME + r")\s*-->")
A_TAG_RE = re.compile(r"<a\b[^>]*>", re.IGNORECASE | re.DOTALL)
NAV_RE = re.compile(r"(<nav\b[^>]*>)(.*?)(</nav\s*>)", re.IGNORECASE | re.DOTALL)
HREF_RE = re.compile(r"""\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))""", re.IGNORECASE)
ARIA_CUR_RE = re.compile(r"""\s+aria-current\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)""", re.IGNORECASE)
SCHEME_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]*:")


class MarkerError(Exception):
    pass


def find_pages(root: Path, only: list[str] | None = None) -> list[Path]:
    if only:
        return [Path(p).resolve() for p in only]
    pages = []
    for dirpath, dirnames, filenames in os.walk(root):
        rel = Path(dirpath).relative_to(root)
        dirnames[:] = sorted(d for d in dirnames
                             if not d.startswith(".") and not (rel == Path(".") and d in EXCLUDE_DIRS)
                             and d != "node_modules")
        for f in sorted(filenames):
            if f.lower().endswith(".html"):
                pages.append(Path(dirpath) / f)
    return pages


def load_partials(pdir: Path) -> dict[str, str]:
    parts = {}
    if not pdir.is_dir():
        return parts
    for f in sorted(pdir.glob("*.html")):
        name = f.stem
        if not re.fullmatch(NAME, name):
            continue
        text = f.read_text(encoding="utf-8").replace("\r\n", "\n")
        parts[name] = text.strip("\n")
    return parts


def page_rel(page: Path, root: Path) -> str:
    return page.resolve().relative_to(root.resolve()).as_posix()


def root_prefix(rel: str) -> str:
    depth = rel.count("/")
    return "../" * depth


def normalize_target(href: str, page_rel_path: str, root: Path) -> str | None:
    """Resolve an href to a site-relative file path, or None if external/unknown."""
    href = href.strip()
    if not href or href.startswith("#") or href.startswith("//") or SCHEME_RE.match(href):
        return None
    href = href.split("#", 1)[0].split("?", 1)[0]
    if href == "":
        return None
    if href.startswith("/"):
        target = href.lstrip("/")
    else:
        base = posixpath.dirname(page_rel_path)
        target = posixpath.normpath(posixpath.join(base, href)) if base else posixpath.normpath(href)
        if href.endswith("/") and not target.endswith("/"):
            target += "/"
    if target in (".", "./", ""):
        target = "index.html"
    elif target.endswith("/"):
        target = target + "index.html"
    elif not posixpath.splitext(target)[1]:
        # Pretty URL (/about -> about.html), or a folder (/events -> events/index.html).
        if (root / (target + ".html")).exists() or not (root / target).is_dir():
            target = target + ".html"
        else:
            target = target + "/index.html"
    if target.startswith("../"):
        return None
    return target


def mark_links(fragment: str, page_rel_path: str, root: Path) -> str:
    def fix_tag(m: re.Match) -> str:
        tag = m.group(0)
        if re.search(r"\sdata-no-current\b", tag, re.IGNORECASE):
            return tag
        hm = HREF_RE.search(tag)
        if not hm:
            return tag
        href = next(g for g in hm.groups() if g is not None)
        clean = ARIA_CUR_RE.sub("", tag)
        if normalize_target(href, page_rel_path, root) == page_rel_path:
            end = "/>" if clean.endswith("/>") else ">"
            clean = clean[: -len(end)].rstrip() + ' aria-current="page"' + end
        return clean

    if NAV_RE.search(fragment):
        return NAV_RE.sub(lambda n: n.group(1) + A_TAG_RE.sub(fix_tag, n.group(2)) + n.group(3), fragment)
    return A_TAG_RE.sub(fix_tag, fragment)


def expand(text: str, partials: dict[str, str], ctx: dict, stack: tuple = ()) -> str:
    """Replace every marker pair in text. Raises MarkerError on unclosed or mismatched markers."""
    out = []
    pos = 0
    while True:
        m = OPEN_RE.search(text, pos)
        if not m:
            stray = ANY_CLOSE_RE.search(text, pos)
            if stray:
                raise MarkerError(f"closing marker <!-- /@{stray.group(1)} --> without an opening marker "
                                  f"(line {text.count(chr(10), 0, stray.start()) + 1})")
            out.append(text[pos:])
            break
        name = m.group(1)
        close_re = re.compile(r"<!--\s*/@" + re.escape(name) + r"\s*-->")
        c = close_re.search(text, m.end())
        if not c:
            raise MarkerError(f"<!-- @{name} --> is not closed (line {text.count(chr(10), 0, m.start()) + 1})")
        inner_open = OPEN_RE.search(text, m.end(), c.start())
        if inner_open and inner_open.group(1) == name:
            raise MarkerError(f"<!-- @{name} --> is opened twice before it is closed")
        out.append(text[pos:m.end()])
        if name not in partials:
            ctx["unknown"].add(name)
            out.append(text[m.end():c.end()])
            pos = c.end()
            continue
        if name in stack:
            raise MarkerError("partials include each other in a loop: " + " -> ".join(stack + (name,)))
        body = expand(partials[name], partials, ctx, stack + (name,))
        if not stack:
            body = body.replace("{{root}}", ctx["prefix"])
            body = mark_links(body, ctx["rel"], ctx["root"])
        line_start = text.rfind("\n", 0, m.start()) + 1
        lead = text[line_start:m.start()]
        own_line = lead.strip() == "" and text[m.end():m.end() + 1] in ("\n", "\r")
        if own_line:
            indented = "\n".join((lead + ln) if ln.strip() else "" for ln in body.split("\n"))
            out.append("\n" + indented + "\n" + lead)
        else:
            out.append(body)
        out.append(text[c.start():c.end()])
        ctx["used"].add(name)
        pos = c.end()
    return "".join(out)


def sync_text(text: str, rel: str, root: Path, partials: dict[str, str]) -> tuple[str, dict]:
    crlf = "\r\n" in text
    src = text.replace("\r\n", "\n")
    ctx = {"rel": rel, "root": root, "prefix": root_prefix(rel), "unknown": set(), "used": set()}
    new = expand(src, partials, ctx)
    if crlf:
        new = new.replace("\n", "\r\n")
    return new, ctx


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Sync partials/*.html into pages between <!-- @name --> markers.")
    ap.add_argument("pages", nargs="*", help="only these pages (default: every page under --root)")
    ap.add_argument("--root", default=str(ROOT), help="site root (default: the folder above tools/)")
    ap.add_argument("--partials", default=None, help="partials folder (default: <root>/partials)")
    ap.add_argument("--check", action="store_true", help="report drift and exit 1; write nothing")
    ap.add_argument("--diff", action="store_true", help="print a unified diff for each changed page")
    ap.add_argument("--quiet", action="store_true", help="only print problems and the summary")
    args = ap.parse_args(argv)

    root = Path(args.root).resolve()
    if not root.is_dir():
        print(f"sync_partials: root {root} is not a folder", file=sys.stderr)
        return 2
    pdir = Path(args.partials).resolve() if args.partials else root / "partials"
    partials = load_partials(pdir)
    pages = find_pages(root, args.pages or None)
    if not partials:
        print(f"sync_partials: no partials in {pdir} yet; nothing to do.")
        return 0
    if not pages:
        print(f"sync_partials: no pages under {root} yet; nothing to do.")
        return 0

    changed, errors, unknown, used = [], [], {}, set()
    for page in pages:
        try:
            rel = page_rel(page, root)
        except ValueError:
            errors.append(f"{page}: not under the site root {root}")
            continue
        if not page.exists():
            errors.append(f"{rel}: file not found")
            continue
        raw = page.read_bytes().decode("utf-8")
        try:
            new, ctx = sync_text(raw, rel, root, partials)
        except MarkerError as e:
            errors.append(f"{rel}: {e}")
            continue
        for n in ctx["unknown"]:
            unknown.setdefault(n, []).append(rel)
        used |= ctx["used"]
        if new != raw:
            changed.append(rel)
            if args.diff:
                sys.stdout.writelines(difflib.unified_diff(raw.splitlines(True), new.splitlines(True),
                                                           f"a/{rel}", f"b/{rel}"))
            if not args.check:
                with open(page, "w", encoding="utf-8", newline="") as fh:
                    fh.write(new)
            if not args.quiet:
                print(("drift: " if args.check else "updated: ") + rel)

    for name, where in sorted(unknown.items()):
        print(f"warning: no partials/{name}.html for marker @{name} in: {', '.join(where)}", file=sys.stderr)
    for e in errors:
        print("error: " + e, file=sys.stderr)
    unused = sorted(set(partials) - used)
    verb = "out of date" if args.check else "updated"
    print(f"sync_partials: {len(pages)} pages, {len(partials)} partials, {len(changed)} {verb}, "
          f"{len(errors)} errors" + (f", unused partials: {', '.join(unused)}" if unused and not args.quiet else ""))
    if errors:
        return 2
    if args.check and changed:
        print("sync_partials: run `python3 tools/sync_partials.py` to update.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
