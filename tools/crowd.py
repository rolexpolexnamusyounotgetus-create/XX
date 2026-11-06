#!/usr/bin/env python3
"""Crowd and expert consensus picks as a winner / method signal (task key: crowd).

Run from the project root, niced (the box is shared):

    nice -n 5 python3 tools/crowd.py fetch            # cache source pages (>= 2 s between requests)
    nice -n 5 python3 tools/crowd.py build            # parse + match to ufcstats fight ids -> data/derived/crowd.json
    nice -n 5 python3 tools/crowd.py eval             # CV gates on pre-2024 data, then the one 2024-25 look
    nice -n 5 python3 tools/crowd.py capture --event "UFC 334"   # forward capture for an upcoming card
    python3 tools/crowd.py selftest                   # swap test, parser fixtures, vault guard

SOURCES (what the brief asked for and what was used; research/model_crowd.md "Sources"):
  * Tapology community predictions (the brief's primary source) are NOT fetched. tapology.com/robots.txt disallows
    the whole site for anthropic-ai, Claude-Web and ClaudeBot. This tool is run by Claude, so a custom User-Agent
    would only hide who is asking; the site owner's opt-out is respected. `import-csv` reads a licensed or
    permission-granted export instead, if Kira ever has one (format in import_csv's docstring).
  * Also declined for the same reason (robots.txt names Anthropic agents) or because the site refused us (403):
    MMA Junkie, MMA Fighting, MMA Mania, Cageside Press, ESPN, BetMMA.tips, Bleacher Report, Bloody Elbow (403),
    OpenML's copy of the fighters'-predictions set (/api/ disallowed). Sherdog's staff pick'em is an image.
  * USED 1 - RotoWire staff / expert picks (rotowire.com; robots.txt allows every agent and its llms.txt invites
    LLM use): 3-8 RotoWire MMA writers pick every main-card bout of each UFC pay-per-view, 2016 and 2019 on.
    Signal: share of the panel picking fighter A. Frozen: the article's JSON-LD datePublished must be before the
    event's date (articles are re-saved after the event to add the panel's records; the picks are not changed -
    spot-checked against the records rows, see `audit_rotowire`).
  * USED 2 - Money MMA pick'em contest consensus (moneymma.substack.com; robots.txt allows every agent): for each
    UFC card since Feb 2022 the free part of the results post lists, for the contest's five bouts, the fighter the
    majority of contest entrants picked and the share who picked him. Frozen: entries are made in a contest post
    published before the event; the results post (after the event) reports the entries. The lock rule itself is
    behind the paywall and was not read; the leak check is that the consensus is less accurate than the close.

PROTOCOL (docs/BACKLOG.md, docs/V6_V10_PLAN.md): fights dated 2026-01-01 or later are dropped at parse; source
pages are only fetched for events before 2026 (sitemap lastmod / event number filters), and any 2026 row that still
appears goes only to the scratchpad vault file. Every choice is made by forward-chained CV on data before 2024; the
2024-2025 window is scored once at the end. Probabilities are corner-symmetric: a pick share s for A becomes
1 - s for B, the stack has no intercept and is fit on logits that flip sign with the corners (asserted).
Scraping: User-Agent "FightLabSim/1.0", robots.txt checked, >= 2 s between requests, raw pages cached under
data/raw/crowd_cache/ (gitignored), compact extracts committed.
"""
import os

for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "1")
import argparse
import datetime as dt
import hashlib
import html as htmlmod
import json
import math
import re
import sys
import time
import unicodedata
import urllib.request
import urllib.robotparser

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
ROOT = os.path.dirname(HERE)
DERIVED = os.path.join(ROOT, "data", "derived")
CACHE = os.path.join(ROOT, "data", "raw", "crowd_cache")
OUT_JSON = os.path.join(DERIVED, "crowd.json")
VAULT_FROM = "2026-01-01"
VAULT_DIR = os.environ.get("CROWD_VAULT_DIR", "/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/"
                           "scratchpad/vault")
UA = "FightLabSim/1.0"
MIN_GAP = 2.2                      # seconds between requests to one host
TOOL_VERSION = "crowd 1.0 (2026-11-06)"

RW_SITEMAP = "https://www.rotowire.com/mma_articles.xml"
MM_SITEMAP = "https://moneymma.substack.com/sitemap.xml"
RW_LAST_EVENT_NUM = 323            # UFC 323 (2025-12-06) is the last pay-per-view before the vault
ALLOWED_HOSTS = {"www.rotowire.com", "moneymma.substack.com"}
REFUSED_HOSTS = {"www.tapology.com", "tapology.com"}    # robots.txt disallows Anthropic agents: never fetched


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


# ====================================================================== polite fetcher
_last = {}
_robots = {}


def _robots_ok(url):
    from urllib.parse import urlparse
    u = urlparse(url)
    host = u.netloc
    if host in REFUSED_HOSTS:
        raise SystemExit("refusing %s: robots.txt disallows Anthropic agents on this site" % host)
    if host not in ALLOWED_HOSTS:
        raise SystemExit("host %s is not on the audited allow-list %s" % (host, sorted(ALLOWED_HOSTS)))
    if host not in _robots:
        rp = urllib.robotparser.RobotFileParser()
        rp.set_url("https://%s/robots.txt" % host)
        txt = _get_raw("https://%s/robots.txt" % host).decode("utf-8", "replace")
        rp.parse(txt.splitlines())
        # the Anthropic agent names must not be disallowed either (a custom UA must not dodge an opt-out)
        names = ("anthropic-ai", "ClaudeBot", "Claude-Web", "Claude-User", UA)
        _robots[host] = (rp, {n: rp.can_fetch(n, url) for n in names})
    rp, _ = _robots[host]
    for n in ("anthropic-ai", "ClaudeBot", "Claude-Web", "Claude-User", UA):
        if not rp.can_fetch(n, url):
            raise SystemExit("robots.txt on %s disallows %s for %s" % (host, n, url))
    return True


def _get_raw(url, timeout=40):
    from urllib.parse import urlparse
    host = urlparse(url).netloc
    wait = MIN_GAP - (time.time() - _last.get(host, 0))
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = r.read()
    finally:
        _last[host] = time.time()
    return data


def cache_path(url):
    from urllib.parse import urlparse
    u = urlparse(url)
    sub = {"www.rotowire.com": "rotowire", "moneymma.substack.com": "moneymma"}.get(u.netloc, "other")
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", u.path.strip("/"))[:150] or "index"
    return os.path.join(CACHE, sub, name + ".html")


def fetch(url, refresh=False):
    p = cache_path(url)
    if os.path.exists(p) and not refresh:
        return open(p, "rb").read().decode("utf-8", "replace")
    _robots_ok(url)
    data = _get_raw(url)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "wb") as fh:
        fh.write(data)
    return data.decode("utf-8", "replace")


def page_text(h):
    t = re.sub(r"<script.*?</script>|<style.*?</style>", "", h, flags=re.S)
    t = re.sub(r"<(br|/p|/li|/h\d|/tr|/div|/td|/th)[^>]*>", "\n", t)
    t = re.sub(r"<[^>]+>", " ", t)
    t = htmlmod.unescape(t).replace("\xa0", " ")
    t = re.sub(r"[ \t]+", " ", t)
    return re.sub(r"\n\s*\n+", "\n", t)


# ====================================================================== source lists (pre-2026 only)
def rotowire_urls(sitemap_xml):
    out = []
    for u in re.findall(r"<url>(.*?)</url>", sitemap_xml, re.S):
        loc = re.search(r"<loc>(.*?)</loc>", u).group(1)
        if not re.search(r"staff-picks|expert-picks", loc):
            continue
        m = re.search(r"ufc-(\d{3})", loc)
        if m and int(m.group(1)) > RW_LAST_EVENT_NUM:
            continue                     # 2026 pay-per-views: never fetched
        if not m and "freedom-250" in loc:
            continue                     # UFC Freedom 250 (2026)
        out.append(loc)
    return out


def moneymma_urls(sitemap_xml):
    out = []
    for u in re.findall(r"<url>(.*?)</url>", sitemap_xml, re.S):
        loc = re.search(r"<loc>(.*?)</loc>", u).group(1)
        lm = re.search(r"<lastmod>(.*?)</lastmod>", u)
        if "pick-em-results" not in loc:
            continue
        if lm and lm.group(1) >= VAULT_FROM:
            continue                     # results posts for 2026 cards (lastmod >= publish date): never fetched
        out.append(loc)
    return out


def cmd_fetch(args):
    os.makedirs(CACHE, exist_ok=True)
    rw = fetch(RW_SITEMAP, refresh=args.refresh_sitemaps)
    mm = fetch(MM_SITEMAP, refresh=args.refresh_sitemaps)
    urls = rotowire_urls(rw) + moneymma_urls(mm)
    log("fetch: %d RotoWire picks articles, %d Money MMA results posts (pre-2026 filters applied)" % (
        len(rotowire_urls(rw)), len(moneymma_urls(mm))))
    n_new = 0
    for k, u in enumerate(urls):
        if os.path.exists(cache_path(u)):
            continue
        try:
            fetch(u)
            n_new += 1
        except Exception as ex:          # keep going; a missing page is reported by build
            log("  failed %s: %s" % (u, ex))
        if n_new and n_new % 20 == 0:
            log("  %d/%d fetched" % (k + 1, len(urls)))
    log("fetch done: %d new pages, cache %s" % (n_new, CACHE))


# ====================================================================== main (fetch-only until the rest lands)
if __name__ == "__main__" and len(sys.argv) > 1 and sys.argv[1] == "fetch":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd")
    ap.add_argument("--refresh-sitemaps", action="store_true")
    cmd_fetch(ap.parse_args())
