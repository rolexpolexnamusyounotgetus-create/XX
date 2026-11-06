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


def moneymma_contest_urls(sitemap_xml):
    """Pre-event contest-entry posts (they state the lock time in their free part): pre-2026 only."""
    out = []
    for u in re.findall(r"<url>(.*?)</url>", sitemap_xml, re.S):
        loc = re.search(r"<loc>(.*?)</loc>", u).group(1)
        lm = re.search(r"<lastmod>(.*?)</lastmod>", u)
        slug = loc.rsplit("/", 1)[-1]
        if "results" in slug or "draftkings" in slug or "year" in slug or "reminder" in slug:
            continue
        if not ("pick-em-contest" in slug or re.search(r"-pick(-em)?(-[0-9a-f]{3})?$", slug)):
            continue
        if not lm or lm.group(1) >= VAULT_FROM:
            continue                     # contest posts for 2026 cards: never fetched
        out.append(loc)
    return out


def cmd_fetch(args):
    os.makedirs(CACHE, exist_ok=True)
    rw = fetch(RW_SITEMAP, refresh=args.refresh_sitemaps)
    mm = fetch(MM_SITEMAP, refresh=args.refresh_sitemaps)
    urls = rotowire_urls(rw) + moneymma_urls(mm) + moneymma_contest_urls(mm)
    log("fetch: %d RotoWire picks articles, %d Money MMA results posts, %d contest posts (pre-2026 filters applied)" % (
        len(rotowire_urls(rw)), len(moneymma_urls(mm)), len(moneymma_contest_urls(mm))))
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


# ====================================================================== parsers
def norm_name(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii").lower()
    s = s.replace("'", "").replace("’", "")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(s.split())


def _date_published(h):
    m = re.search(r'"datePublished"\s*:\s*"([^"]+)"', h)
    return m.group(1) if m else None


def parse_rotowire(h):
    """-> dict(published, title, pickers, bouts=[{a, b, wc, picks: {picker: text}}]).
    Only the text of each cell is read: after the event RotoWire strikes through losing picks (<s>), which encodes
    the result, so every tag is dropped before the text is taken and strike marks are never used."""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(h, "lxml")
    title = (soup.find("h1").get_text(" ", strip=True) if soup.find("h1") else "")
    bouts, pickers_all = [], []
    for tb in soup.find_all("table"):
        rows = tb.find_all("tr")
        if not rows:
            continue
        head = [c.get_text(" ", strip=True) for c in rows[0].find_all(["th", "td"])]
        if not head or "MATCHUP" not in head[0].upper():
            continue
        # columns: MATCHUP, WEIGHT CLASS, then one per picker
        start = 2 if len(head) > 1 and "WEIGHT" in head[1].upper() else 1
        pickers = [re.sub(r"\s+", " ", x).strip().strip('"') or ("col%d" % j) for j, x in enumerate(head[start:])]
        pickers_all += pickers
        for r in rows[1:]:
            cells = r.find_all(["td", "th"])
            if not cells:
                continue
            mtxt = cells[0].get_text(" ", strip=True)
            if not re.search(r"\bvs\.?", mtxt):
                continue                     # record / percentage rows
            names = [a.get_text(" ", strip=True) for a in cells[0].find_all("a")]
            if len(names) != 2:              # names without player links: split the text on "vs."
                parts = re.split(r"\bvs\.?", mtxt)
                names = [re.sub(r"\(.*?\)", "", p) for p in parts[:2]]
            names = [re.sub(r"^\s*\(C\)\s*", "", re.sub(r"\([+-]?\d+\)|\(C\)", "", x)).strip() for x in names]
            if len(names) != 2 or not all(names):
                continue
            wc = cells[start - 1].get_text(" ", strip=True) if start == 2 and len(cells) > 1 else ""
            picks, struck = {}, {}
            for j, c in enumerate(cells[start:start + len(pickers)]):
                t = c.get_text(" ", strip=True)
                if t and t.upper() not in ("N/A", "-", "--"):
                    picks[pickers[j]] = t
                    # audit only (never a feature): RotoWire strikes through losing picks after the event
                    struck[pickers[j]] = bool(c.find(["s", "del", "strike"]) or "line-through" in str(c))
            bouts.append({"a": names[0], "b": names[1], "wc": wc, "picks": picks, "_struck": struck})
    # merge bouts split across several tables (one table per 3 pickers)
    merged = {}
    for b in bouts:
        k = (norm_name(b["a"]), norm_name(b["b"]))
        if k in merged:
            merged[k]["picks"].update(b["picks"])
            merged[k]["_struck"].update(b["_struck"])
        else:
            merged[k] = b
    return {"published": _date_published(h), "title": title, "pickers": sorted(set(pickers_all)),
            "bouts": list(merged.values())}


def side_of_pick(pick, a, b):
    """'A', 'B' or None: which full name the pick text (usually a surname) refers to."""
    p, na, nb = norm_name(pick), norm_name(a), norm_name(b)
    if not p:
        return None
    if p == na or p == nb:
        return "A" if p == na else "B"
    ta, tb, tp = set(na.split()), set(nb.split()), set(p.split())
    ia, ib = len(tp & ta), len(tp & tb)
    if ia != ib:
        return "A" if ia > ib else "B"
    # substrings (hyphenated or compound surnames, nicknames left in)
    sa, sb = p in na, p in nb
    if sa != sb:
        return "A" if sa else "B"
    import difflib
    ra = max(difflib.SequenceMatcher(None, p, x).ratio() for x in [na] + na.split())
    rb = max(difflib.SequenceMatcher(None, p, x).ratio() for x in [nb] + nb.split())
    if max(ra, rb) >= 0.8 and abs(ra - rb) >= 0.15:
        return "A" if ra > rb else "B"
    return None


def parse_moneymma(h):
    """-> dict(published, title, picks=[(name, pct)]) from the free part of a Money MMA pick'em results post."""
    m = re.search(r'<div class="available-content">(.*?)</article>', h, re.S)
    body = m.group(1) if m else h
    t = page_text(body)
    title = ""
    mt = re.search(r"<h1[^>]*>(.*?)</h1>", h, re.S)
    if mt:
        title = page_text(mt.group(1)).strip()
    picks = []
    seg = t
    i = t.find("Consensus Picks")
    if i >= 0:
        seg = t[i + len("Consensus Picks"):]
        j = seg.find("Consensus Overall Record")
        seg = seg[:j] if j >= 0 else seg[:600]
        for line in seg.split("\n"):
            mm = re.match(r"\s*(.+?)\s*[–—\-:]+\s*(\d{1,3})\s*%", line)
            if mm:
                picks.append((mm.group(1).strip(), int(mm.group(2)) / 100.0))
    return {"published": _date_published(h), "title": title, "picks": picks}


# ====================================================================== fights (ufcstats ids; 2026 dropped at parse)
def load_fights():
    import build_db as B
    fights, _ = B.parse_fights({})
    n_all = len(fights)
    fights = [f for f in fights if f.date.isoformat() < VAULT_FROM]       # hidden-data protocol
    out = []
    for f in fights:
        out.append({"fid": f.fid, "date": f.date.isoformat(), "event": f.event, "a": f.names[0], "b": f.names[1],
                    "winner": f.winner, "cat": f.cat, "method": f.method, "rnd": f.rnd, "division": f.division,
                    "title": bool(f.title), "sched": f.sched})
    return out, n_all - len(out)


def _name_score(x, y):
    """Similarity of two fighter names in [0, 1] (token overlap first, then character ratio)."""
    import difflib
    nx, ny = norm_name(x), norm_name(y)
    if not nx or not ny:
        return 0.0
    if nx == ny:
        return 1.0
    tx, ty = set(nx.split()), set(ny.split())
    if tx == ty:                          # "Zhang Weili" vs "Weili Zhang"
        return 0.99
    jac = len(tx & ty) / len(tx | ty)
    cr = difflib.SequenceMatcher(None, nx, ny).ratio()
    last = nx.split()[-1] == ny.split()[-1] or nx.split()[0] == ny.split()[-1] or nx.split()[-1] == ny.split()[0]
    return max(cr * 0.95, jac * 0.9 + (0.1 if last else 0.0))


def _pair_score(a, b, fa, fb):
    """Both names must match; one weak name is allowed when the other matches exactly and the weak pair shares a
    surname, a first name, or one name's tokens contain the other's ("Ian Garry" / "Ian Machado Garry", "Bobby
    Green" / "King Green"): the opponent and the date window pin the bout down."""
    sa, sb = _name_score(a, fa), _name_score(b, fb)
    lo, hi = min(sa, sb), max(sa, sb)
    if lo >= 0.8:
        return lo
    if hi >= 0.97:
        x, y = (a, fa) if sa < sb else (b, fb)
        tx, ty = set(norm_name(x).split()), set(norm_name(y).split())
        fx_, fy_ = norm_name(x).split()[0], norm_name(y).split()[0]
        first = fx_ == fy_ or (min(len(fx_), len(fy_)) >= 4 and (fx_.startswith(fy_) or fy_.startswith(fx_)))
        if tx and ty and (tx <= ty or ty <= tx or norm_name(x).split()[-1] == norm_name(y).split()[-1] or first):
            return 0.8     # married-name changes keep the first name ("Katlyn Chookagian" / "Katlyn Cerminara")
    return lo


class FightIndex:
    def __init__(self, fights):
        self.fights = fights
        self.by_date = {}
        for f in fights:
            self.by_date.setdefault(f["date"], []).append(f)
        self.dates = sorted(self.by_date)

    def window(self, d0, d1):
        return [f for d in self.dates if d0 <= d <= d1 for f in self.by_date[d]]

    def match_pair(self, a, b, d0, d1, thr=0.8):
        """Best fight in [d0, d1] whose two names match (a, b) in either order. -> (fight, swapped, score) or None."""
        best = None
        for f in self.window(d0, d1):
            s1 = _pair_score(a, b, f["a"], f["b"])
            s2 = _pair_score(a, b, f["b"], f["a"])
            s, sw = (s1, False) if s1 >= s2 else (s2, True)
            if s >= thr and (best is None or s > best[2]):
                best = (f, sw, s)
        return best

    def match_one(self, name, d0, d1, thr=0.86):
        """Unique fight in [d0, d1] with a fighter matching `name`. -> (fight, side, score) or None."""
        cands = []
        for f in self.window(d0, d1):
            for side in ("A", "B"):
                s = _name_score(name, f["a"] if side == "A" else f["b"])
                if s >= thr:
                    cands.append((s, f, side))
        if not cands:
            return None
        cands.sort(key=lambda c: -c[0])
        if len(cands) > 1 and cands[1][0] >= cands[0][0] - 0.02 and cands[1][1]["fid"] != cands[0][1]["fid"]:
            return None                    # ambiguous
        return cands[0][1], cands[0][2], cands[0][0]


# ====================================================================== build: parse + match -> crowd.json
def _iso_day(ts):
    return ts[:10] if ts else None


def _days(a, b):
    return (dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days


def build_rows(fights=None, verbose=True):
    """Parse every cached source page and match it to ufcstats fight ids. Returns (rows, report)."""
    import glob
    if fights is None:
        fights, n_drop = load_fights()
    else:
        n_drop = 0
    fx = FightIndex(fights)
    rep = {"fights_parsed_2026_dropped": n_drop, "rotowire": {}, "moneymma": {}}
    rows = {}
    vault = []
    # ---- RotoWire panels
    st = dict(articles=0, articles_no_table=0, bouts=0, matched=0, unmatched=[], pre_event=0, same_day=0,
              post_event=0, picks=0, picks_unresolved=0, no_date=0)
    for fn in sorted(glob.glob(os.path.join(CACHE, "rotowire", "mma_article_*.html"))):
        h = open(fn, encoding="utf-8", errors="replace").read()
        P = parse_rotowire(h)
        st["articles"] += 1
        if not P["bouts"]:
            st["articles_no_table"] += 1
            continue
        pub = _iso_day(P["published"])
        if not pub:
            st["no_date"] += 1
            continue
        for b in P["bouts"]:
            st["bouts"] += 1
            m = fx.match_pair(b["a"], b["b"], pub, (dt.date.fromisoformat(pub) + dt.timedelta(days=10)).isoformat())
            if not m:
                # an article published after the event (never used) or a name the matcher cannot place
                late = fx.match_pair(b["a"], b["b"], (dt.date.fromisoformat(pub) - dt.timedelta(days=10)).isoformat(), pub)
                if late:
                    st["post_event"] += 1
                else:
                    st["unmatched"].append([os.path.basename(fn)[:70], b["a"], b["b"], pub])
                if pub >= VAULT_FROM:
                    vault.append({"src": "rotowire", "file": os.path.basename(fn), "bout": b})
                continue
            f, sw, score = m
            na = nb = 0
            for pk, txt in b["picks"].items():
                s = side_of_pick(txt, b["a"], b["b"])
                st["picks"] += 1
                if s is None:
                    st["picks_unresolved"] += 1
                    continue
                if sw:
                    s = "B" if s == "A" else "A"
                na += s == "A"
                nb += s == "B"
                if f["winner"] in ("A", "B"):     # audit: were the picks shown the picks that were scored?
                    aud = st.setdefault("strike_audit", {"cells": 0, "struck": 0, "consistent": 0})
                    aud["cells"] += 1
                    aud["struck"] += int(b["_struck"].get(pk, False))
                    aud["consistent"] += int(b["_struck"].get(pk, False) == (s != f["winner"]))
            if na + nb == 0:
                continue
            gap = _days(pub, f["date"])
            frozen = "pre_event" if gap >= 1 else "same_day"
            st[frozen] += 1
            st["matched"] += 1
            r = rows.setdefault(f["fid"], {"date": f["date"], "event": f["event"], "a": f["a"], "b": f["b"]})
            r["rw"] = {"n_a": na, "n_b": nb, "n": na + nb, "share_a": round(na / (na + nb), 4), "published": P["published"],
                       "days_before": gap, "frozen": frozen, "match_score": round(score, 3),
                       "article": os.path.basename(fn)[12:-5]}
    st["n_unmatched"] = len(st["unmatched"])
    rep["rotowire"] = st
    # ---- Money MMA pick'em consensus
    sm = dict(posts=0, posts_no_picks=0, picks=0, matched=0, unmatched=[], ambiguous_or_missing=0, no_date=0)
    for fn in sorted(glob.glob(os.path.join(CACHE, "moneymma", "p_*pick-em-results*.html"))):
        h = open(fn, encoding="utf-8", errors="replace").read()
        P = parse_moneymma(h)
        sm["posts"] += 1
        if not P["picks"]:
            sm["posts_no_picks"] += 1
            continue
        pub = _iso_day(P["published"])
        if not pub:
            sm["no_date"] += 1
            continue
        if pub >= VAULT_FROM:
            vault.append({"src": "moneymma", "file": os.path.basename(fn), "picks": P["picks"], "published": pub})
            continue
        d0 = (dt.date.fromisoformat(pub) - dt.timedelta(days=9)).isoformat()
        # the event is the latest card on or before the post date that contains the named fighters
        for name, pct in P["picks"]:
            sm["picks"] += 1
            m = fx.match_one(name, d0, pub)
            if not m:
                sm["unmatched"].append([os.path.basename(fn)[2:-5], name, pub])
                continue
            f, side, score = m
            r = rows.setdefault(f["fid"], {"date": f["date"], "event": f["event"], "a": f["a"], "b": f["b"]})
            r["mm"] = {"pick": side, "pct_pick": pct, "share_a": round(pct if side == "A" else 1 - pct, 4),
                       "published": P["published"], "days_after": _days(f["date"], pub), "match_score": round(score, 3),
                       "post": os.path.basename(fn)[2:-5]}
            sm["matched"] += 1
    sm["n_unmatched"] = len(sm["unmatched"])
    rep["moneymma"] = sm
    if vault:
        os.makedirs(VAULT_DIR, exist_ok=True)
        with open(os.path.join(VAULT_DIR, "crowd_vault.json"), "w") as fh:
            json.dump(vault, fh)
    rep["vault_rows_written_outside_repo"] = len(vault)
    if verbose:
        log("RotoWire: %d articles, %d bouts, %d matched (%d pre-event, %d same day), %d after the event, %d unmatched; "
            "%d picks, %d unresolved" % (st["articles"], st["bouts"], st["matched"], st["pre_event"], st["same_day"],
                                         st["post_event"], st["n_unmatched"], st["picks"], st["picks_unresolved"]))
        log("Money MMA: %d posts (%d without a consensus block), %d picks, %d matched, %d unmatched" % (
            sm["posts"], sm["posts_no_picks"], sm["picks"], sm["matched"], sm["n_unmatched"]))
    return rows, rep


# ====================================================================== evaluation
STACK_CACHE = os.path.join(ROOT, "out", "ml2_cache", "stack.pkl")
EVAL_OUT = os.path.join(ROOT, "out", "crowd_cache")
CROWD_COLS = ("rw", "mm", "crowd")
# the CV-chosen ML v2 stacks (research/model_ml2.md section 6) and the page variants, by regime
BASE_SETS = {
    "line": {"market+ml2": ["market", "ml2"], "page: market+ml2lr": ["market", "ml2lr"]},
    "noline": {"ml2+mkt_rating+feat_lr": ["ml2", "mkt_rating", "feat_lr"], "page: ml2lr+mkt_rating": ["ml2lr", "mkt_rating"]},
    "open": {"open+ml2": ["open", "ml2"], "page: open+ml2lr": ["open", "ml2lr"]},
}
RW_PRIOR = 0.5                     # pseudo-picks per side when a panel share becomes a probability
MM_CLIP = 0.03


def crowd_probs(r):
    """Per-fight crowd inputs as P(A): rw (panel share, shrunk), mm (contest consensus share), crowd (mean logit)."""
    out = {}
    if r.get("rw") and r["rw"].get("frozen") == "pre_event":
        w = r["rw"]
        out["rw"] = (w["n_a"] + RW_PRIOR) / (w["n"] + 2 * RW_PRIOR)
    if r.get("mm"):
        out["mm"] = min(max(r["mm"]["share_a"], MM_CLIP), 1 - MM_CLIP)
    zs = [math.log(p / (1 - p)) for p in out.values()]
    if zs:
        z = sum(zs) / len(zs)
        out["crowd"] = 1 / (1 + math.exp(-z))
    return out


def _np():
    import numpy as np
    import pandas as pd
    return np, pd


def attach_crowd(D, crowd_fights):
    np, pd = _np()
    for c in CROWD_COLS:
        D[c] = np.nan
    D["rw_n"] = 0
    idx = {f: i for i, f in enumerate(D["fid"])}
    for fid, r in crowd_fights.items():
        if fid in idx:
            p = crowd_probs(r)
            for c, v in p.items():
                D.iat[idx[fid], D.columns.get_loc(c)] = v
            if "rw" in p:
                D.iat[idx[fid], D.columns.get_loc("rw_n")] = r["rw"]["n"]
    return D


def fit_slope(z, y, w=None):
    """One-parameter calibration p = sigmoid(b z), no intercept (symmetric). Returns b."""
    np, _ = _np()
    from scipy.optimize import minimize_scalar
    w = np.ones(len(z)) if w is None else w
    f = lambda b: float(np.sum(w * (np.logaddexp(0, b * z) - y * b * z)))
    return float(minimize_scalar(f, bounds=(0.0, 10.0), method="bounded").x)


def logit_np(p, c=1e-6):
    np, _ = _np()
    p = np.clip(np.asarray(p, float), c, 1 - c)
    return np.log(p / (1 - p))


def run_eval(args):
    import pickle
    np, pd = _np()
    sys.argv = [sys.argv[0]]
    import ml2 as M2
    os.makedirs(EVAL_OUT, exist_ok=True)
    doc = json.load(open(OUT_JSON))
    CF = doc["fights"]
    S = pickle.load(open(STACK_CACHE, "rb"))
    D = S["D"].copy()
    assert str(D["date"].max()) < VAULT_FROM and int(D["year"].max()) <= 2025, "2026 rows in the stack table"
    D = attach_crowd(D, CF)
    y = D["y"].to_numpy(float)
    yr = D["year"].to_numpy()
    ev = D["event"].to_numpy()
    has = {"line": D["market"].notna().to_numpy(), "open": D["open"].notna().to_numpy(), "noline": np.ones(len(D), bool)}
    cov = {c: D[c].notna().to_numpy() for c in CROWD_COLS}
    R = {"coverage": {}, "alone": {}, "stack": {}, "debut": {}, "freeze": {}, "swap": {}}
    for c in CROWD_COLS:
        R["coverage"][c] = {str(Y): int((cov[c] & (yr == Y)).sum()) for Y in range(2019, 2026)}
        R["coverage"][c]["of_rows"] = {str(Y): int((yr == Y).sum()) for Y in range(2019, 2026)}
    log("coverage in the ML v2 stack table (backtest fights 2019-2025, %d rows): %s" % (
        len(D), {c: int(cov[c].sum()) for c in CROWD_COLS}))

    # ---------------- test 1: the crowd alone vs Elo / ML v2 / open / close on the same fights
    R["alone"] = test_alone(D, CF, M2, np)
    # ---------------- test 2: the crowd as an expert in the no-line, open and close stacks
    R["stack"] = test_stack(D, M2, np, has, cov)
    # ---------------- test 4: debut bouts (outside the backtest universe)
    R["debut"] = test_debut(CF, M2, np)
    # ---------------- freeze / leak checks and symmetry
    R["freeze"] = freeze_checks(CF, D, np)
    R["swap"] = swap_test(D, M2, np, has)
    R["meta"] = {"tool": TOOL_VERSION, "run": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                 "stack_table": "out/ml2_cache/stack.pkl (tools/ml2.py stage stack; OOF 2019-2023, static/rolling 2024-25)",
                 "rule": "an input enters a stack only if forward-chained CV 2021-2023 improves by more than %g (ml2 SEL_MIN)"
                         % M2.SEL_MIN, "bootstrap": "2,000 event-cluster resamples, paired (tools/ml2.py compare)"}
    json.dump(R, open(os.path.join(EVAL_OUT, "eval.json"), "w"), indent=1, default=float)
    doc["eval"] = R
    json.dump(doc, open(OUT_JSON, "w"), indent=1)
    log("eval written to %s and %s" % (os.path.join(EVAL_OUT, "eval.json"), OUT_JSON))
    return R


def _forward_slope(z_all, y_all, yr_all, train_mask, years):
    """b fit on rows of years < Y (train_mask), for each Y; returns {Y: b}."""
    np, _ = _np()
    out = {}
    for Y in years:
        m = train_mask & (yr_all < Y)
        out[Y] = fit_slope(z_all[m], y_all[m]) if m.sum() >= 15 else None
    return out


def test_alone(D, CF, M2, np):
    """Crowd alone, calibrated by one no-intercept slope fit forward (years before the scored year; 2024-25 uses
    <= 2023), against Elo, ML v2 (OOF / static), the open and the close on the same backtest fights."""
    allrows = []                                  # every covered decisive fight (all universes) for the slope
    for fid, r in CF.items():
        if r.get("winner") not in ("A", "B"):
            continue
        p = crowd_probs(r)
        for c in CROWD_COLS:
            if c in p:
                allrows.append((c, int(r["date"][:4]), math.log(p[c] / (1 - p[c])), 1.0 if r["winner"] == "A" else 0.0))
    out = {}
    yr = D["year"].to_numpy()
    y = D["y"].to_numpy(float)
    for c in CROWD_COLS:
        rr = [x for x in allrows if x[0] == c]
        if not rr:
            continue
        zA = np.array([x[2] for x in rr]); yA = np.array([x[3] for x in rr]); yrA = np.array([x[1] for x in rr])
        slopes = _forward_slope(zA, yA, yrA, np.ones(len(rr), bool), range(2017, 2026))
        b24 = fit_slope(zA[yrA <= 2023], yA[yrA <= 2023]) if (yrA <= 2023).sum() >= 15 else None
        zc = logit_np(D[c].to_numpy(float))
        pc = np.full(len(D), np.nan)
        for Y in range(2019, 2024):
            m = (yr == Y) & D[c].notna().to_numpy()
            if slopes.get(Y) is not None:
                pc[m] = 1 / (1 + np.exp(-slopes[Y] * zc[m]))
        m = (yr >= 2024) & D[c].notna().to_numpy()
        if b24 is not None:
            pc[m] = 1 / (1 + np.exp(-b24 * zc[m]))
        D["p_" + c] = pc
        res = {"slope_by_year": {str(k): (round(v, 3) if v is not None else None) for k, v in slopes.items()},
               "slope_fit_le_2023": round(b24, 3) if b24 is not None else None}
        for per, lo, hi in (("2019-2023 (forward)", 2019, 2023), ("2024-2025 (one look)", 2024, 2025)):
            m = (~np.isnan(pc)) & (yr >= lo) & (yr <= hi) & D["market"].notna().to_numpy() & D["open"].notna().to_numpy()
            if m.sum() < 10:
                continue
            g = D["event"].to_numpy()[m]
            row = {"n": int(m.sum()), "events": int(len(set(g)))}
            for k, col in (("crowd", None), ("elo", "elo"), ("ml2", "ml2_static"), ("ml2lr", "ml2lr_static"),
                           ("open", "open"), ("close", "market")):
                p = pc[m] if col is None else D[col].to_numpy(float)[m]
                row[k] = round(M2.ll(p, y[m]), 5)
                row[k + "_acc"] = round(float(np.mean(np.where(np.abs(p - 0.5) < 1e-9, 0.5, (p > 0.5) == (y[m] > 0.5)))), 4)
            for k, col in (("elo", "elo"), ("ml2", "ml2_static"), ("open", "open"), ("close", "market")):
                row["crowd - " + k] = M2.compare(pc[m], D[col].to_numpy(float)[m], y[m], g)
            # raw majority-pick accuracy (ties = half) and the share of unanimous / split panels
            raw = D[c].to_numpy(float)[m]
            row["majority_pick_acc"] = round(float(np.mean(np.where(raw == 0.5, 0.5, (raw > 0.5) == (y[m] > 0.5)))), 4)
            row["close_fav_agrees_with_crowd"] = round(float(np.mean((raw > 0.5) == (D["market"].to_numpy(float)[m] > 0.5))), 4)
            res[per] = row
            log("alone %-6s %-22s n %3d | crowd %.4f elo %.4f ml2 %.4f open %.4f close %.4f | crowd-close %+.4f %s" % (
                c, per, row["n"], row["crowd"], row["elo"], row["ml2"], row["open"], row["close"],
                row["crowd - close"]["diff"], row["crowd - close"]["diff_ci"]))
        out[c] = res
    return out


def _stack_fit_signed(Z, y, w, k_signed):
    """ml2.stack_fit with the last k_signed weights unconstrained in sign (a negative crowd weight = fade the public
    given the other experts); same objective, L2 and start."""
    np, _ = _np()
    from scipy.optimize import minimize
    n, k = Z.shape
    w = w / w.sum()

    def f(b):
        q = Z @ b
        p = 1 / (1 + np.exp(-q))
        return np.sum(w * (np.logaddexp(0, q) - y * q)) + 1e-4 * b @ b, Z.T @ (w * (p - y)) + 2e-4 * b
    r = minimize(f, np.full(k, 0.3), jac=True, method="L-BFGS-B",
                 bounds=[(0, None)] * (k - k_signed) + [(None, None)] * k_signed)
    return r.x


class _SignedM2:
    """Wraps tools/ml2.py so stack_predict fits the crowd column with a free sign (everything else unchanged)."""
    def __init__(self, M2):
        self.M2 = M2
        self.SEL_MIN, self.ll, self.compare = M2.SEL_MIN, M2.ll, M2.compare

    def stack_predict(self, D, cols, scheme, h, fit_until_year, pred_mask, rows_ok):
        M2 = self.M2
        np, _ = _np()
        cc = [M2.col_for(c, scheme if scheme == "roll" else "static") for c in cols]
        tr = rows_ok & (D["year"] <= fit_until_year).to_numpy() & (D["year"] >= 2019).to_numpy()
        Z = M2.zmat(D, cc)
        ks = sum(1 for c in cols if c in CROWD_COLS)
        b = _stack_fit_signed(Z[tr], D["y"].to_numpy(float)[tr], M2.rec_w(D["year"].to_numpy()[tr], fit_until_year + 1, h), ks)
        return M2.sig(Z[pred_mask] @ b), b


def _cv_set(D, M2, np, cols, rows_ok, y, yr):
    """ml2's forward-chained stack CV (2021-2023, recency half-life chosen with the SEL_MIN penalty). Returns
    (cv by h, chosen h, OOF predictions for 2021-2023 under the chosen h)."""
    cvs, oof = {}, {}
    for h in (None, 3.0, 1.5):
        tot = nn = 0.0
        arr = np.full(len(D), np.nan)
        for Y in (2021, 2022, 2023):
            m = rows_ok & (yr == Y)
            p, _ = M2.stack_predict(D, cols, "static", h, Y - 1, m, rows_ok)
            arr[m] = p
            tot += M2.ll(p, y[m]) * m.sum()
            nn += m.sum()
        cvs[str(h)] = round(tot / nn, 6)
        oof[str(h)] = arr
    hb = min(cvs, key=lambda k: cvs[k] + (0 if k == "None" else M2.SEL_MIN))
    return cvs, (None if hb == "None" else float(hb)), oof[hb]


def test_stack(D, M2, np, has, cov):
    y = D["y"].to_numpy(float)
    yr = D["year"].to_numpy()
    ev = D["event"].to_numpy()
    close = D["market"].to_numpy(float)
    va = (yr >= 2024) & (yr <= 2025)
    cvy = (yr >= 2021) & (yr <= 2023)
    out = {}
    for regime, sets in BASE_SETS.items():
        rows_ok = has[regime]
        for bname, bcols in sets.items():
            key = "%s|%s" % (regime, bname)
            res = {"base_cols": bcols, "cands": {}}
            cvb, hb, oofb = _cv_set(D, M2, np, bcols, rows_ok, y, yr)
            pst_b, wb = M2.stack_predict(D, bcols, "static", hb, 2023, rows_ok & va, rows_ok)
            res["base"] = {"cv_by_h": cvb, "h": hb, "cv": cvb[str(hb)], "w_le_2023": dict(zip(bcols, np.round(wb, 4).tolist()))}
            pb_full = np.full(len(D), np.nan)
            pb_full[rows_ok & va] = pst_b
            prb = np.full(len(D), np.nan)
            for Y in (2024, 2025):
                m = rows_ok & (yr == Y)
                prb[m], _ = M2.stack_predict(D, bcols, "roll", hb, Y - 1, m, rows_ok)
            for c, MM in [(c, M2) for c in CROWD_COLS] + [(c + " (signed)", _SignedM2(M2)) for c in CROWD_COLS]:
                cols = bcols + [c.split()[0]]
                cvc, hc, oofc = _cv_set(D, MM, np, cols, rows_ok, y, yr)
                gain = cvc[str(hc)] - cvb[str(hb)]
                m_cv = rows_ok & cvy
                m_cvc = m_cv & cov[c.split()[0]]
                r = {"cv_by_h": cvc, "h": hc, "cv": cvc[str(hc)], "cv_gain": round(gain, 6),
                     "passes_gate": bool(gain < -M2.SEL_MIN),
                     "cv_paired_all": M2.compare(oofc[m_cv], oofb[m_cv], y[m_cv], ev[m_cv]),
                     "cv_paired_covered": (M2.compare(oofc[m_cvc], oofb[m_cvc], y[m_cvc], ev[m_cvc])
                                           if m_cvc.sum() >= 10 else None),
                     "n_cv_covered": int(m_cvc.sum())}
                # the one 2024-25 look (static: fit <= 2023; rolling: experts' rolling columns, stack refit each January)
                pst, w = MM.stack_predict(D, cols, "static", hc, 2023, rows_ok & va, rows_ok)
                r["w_le_2023"] = dict(zip(cols, np.round(w, 4).tolist()))
                pc_full = np.full(len(D), np.nan)
                pc_full[rows_ok & va] = pst
                prc = np.full(len(D), np.nan)
                for Y in (2024, 2025):
                    m = rows_ok & (yr == Y)
                    prc[m], _ = MM.stack_predict(D, cols, "roll", hc, Y - 1, m, rows_ok)
                mv = rows_ok & va
                mvc = mv & cov[c.split()[0]]
                r["valid_static_all"] = M2.compare(pc_full[mv], pb_full[mv], y[mv], ev[mv])
                r["valid_roll_all"] = M2.compare(prc[mv], prb[mv], y[mv], ev[mv])
                r["valid_static_covered"] = (M2.compare(pc_full[mvc], pb_full[mvc], y[mvc], ev[mvc])
                                             if mvc.sum() >= 10 else None)
                r["n_valid_covered"] = int(mvc.sum())
                mk = mv & has["line"]
                r["valid_static_vs_close"] = M2.compare(pc_full[mk], close[mk], y[mk], ev[mk])
                res["cands"][c] = r
                log("stack %-32s +%-5s CV %.5f vs %.5f (gain %+.5f, h %s, %s) | covered CV %s | 2024-25 static %+.5f %s "
                    "covered %s | w %s" % (
                        key, c, r["cv"], res["base"]["cv"], gain, hc, "PASS" if r["passes_gate"] else "fail",
                        ("%+.4f %s (n %d)" % (r["cv_paired_covered"]["diff"], r["cv_paired_covered"]["diff_ci"],
                                              r["n_cv_covered"])) if r["cv_paired_covered"] else "-",
                        r["valid_static_all"]["diff"], r["valid_static_all"]["diff_ci"],
                        ("%+.4f %s (n %d)" % (r["valid_static_covered"]["diff"], r["valid_static_covered"]["diff_ci"],
                                              r["n_valid_covered"])) if r["valid_static_covered"] else "-",
                        r["w_le_2023"]))
            best = min(res["cands"], key=lambda k: res["cands"][k]["cv"])
            res["best_crowd_variant_by_cv"] = best
            res["adopted"] = best if res["cands"][best]["passes_gate"] else None
            out[key] = res
    return out


def prior_counts(fights):
    """Prior UFC appearances per fighter name before each fight (name-keyed; ufcstats names are unique enough)."""
    # counts are updated after each card, so bouts on the same night never count each other
    seen, out, by_date = {}, {}, {}
    for f in fights:
        by_date.setdefault(f["date"], []).append(f)
    for d in sorted(by_date):
        for f in by_date[d]:
            out[f["fid"]] = (seen.get(norm_name(f["a"]), 0), seen.get(norm_name(f["b"]), 0))
        for f in by_date[d]:
            for k in (norm_name(f["a"]), norm_name(f["b"])):
                seen[k] = seen.get(k, 0) + 1
    return out


def cmd_build(args):
    fights, n_drop = load_fights()
    rows, rep = build_rows(fights)
    fmap = {f["fid"]: f for f in fights}
    pc = prior_counts(fights)
    bt = json.load(open(os.path.join(DERIVED, "backtest_dev.json")))
    bt_ids = {f["id"] for f in bt["fights"] if f["date"] < VAULT_FROM}
    out = {}
    for fid, r in sorted(rows.items(), key=lambda kv: (kv[1]["date"], kv[0])):
        if r["date"] >= VAULT_FROM:          # cannot happen (dropped at parse); belt and braces
            continue
        f = fmap[fid]
        r["winner"] = f["winner"]
        r["cat"] = f["cat"]
        r["division"] = f["division"]
        r["title"] = f["title"]
        r["prior_ufc"] = list(pc[fid])
        r["debut_bout"] = min(pc[fid]) == 0
        r["in_backtest"] = fid in bt_ids
        out[fid] = r
    # coverage / match rates
    cov = {}
    for src in ("rw", "mm"):
        yrs = {}
        for r in out.values():
            if src in r and (src != "rw" or r["rw"]["frozen"] == "pre_event"):
                y = r["date"][:4]
                yrs[y] = yrs.get(y, 0) + 1
        cov[src] = dict(sorted(yrs.items()))
    n_by_year = {}
    for f in fights:
        if f["date"] >= "2015-01-01":
            n_by_year[f["date"][:4]] = n_by_year.get(f["date"][:4], 0) + 1
    st, sm = rep["rotowire"], rep["moneymma"]
    meta = {
        "built": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "tool": TOOL_VERSION,
        "orientation": "A = first ufcstats name (backtest order); share_a = share of the panel / contest entrants "
                       "picking A; P(A) inputs: rw = (n_a + 0.5) / (n + 1), mm = clip(share_a, 0.03, 0.97), crowd = "
                       "mean of the available logits",
        "sources": {
            "rw": "RotoWire staff / expert picks (rotowire.com/mma/article/...): 3-8 RotoWire MMA writers pick every "
                  "main-card bout of each UFC pay-per-view; 2016 and 2019-2025 here. robots.txt allows every agent; "
                  "llms.txt invites LLM use",
            "mm": "Money MMA pick'em contest consensus (moneymma.substack.com, free part of each results post): the "
                  "fighter most contest entrants picked and their share, for the contest's five main-card bouts; "
                  "Feb 2022-Dec 2025. robots.txt allows every agent",
        },
        "not_used": {
            "tapology.com": "the brief's primary source; robots.txt disallows the whole site for anthropic-ai, "
                            "Claude-Web and ClaudeBot, so it was not fetched under any User-Agent (also 403 for "
                            "another agent on Nov 6, data/predictions/cards_upcoming.json)",
            "robots.txt names Anthropic agents": "mmajunkie.usatoday.com, mmafighting.com, mmamania.com, "
                                                 "cagesidepress.com, espn.com, betmma.tips, bleacherreport.com, "
                                                 "openml.org /api/ (fighters' predictions set)",
            "refused or unusable": "bloodyelbow.com (403 to our User-Agent), sherdog.com staff pick'em (picks are an "
                                   "image), verdictmma.com (picks load from /api/, disallowed), mmasucka.com (no "
                                   "parseable staff-pick table found)",
        },
        "freeze": {
            "rw": "JSON-LD datePublished must be at least one calendar day before the event (%d bouts); published "
                  "on the event day = 'same_day', kept in the file but never fit or scored (%d bouts). Articles are "
                  "re-saved after the event to strike through losing picks and add records; only cell text is read, "
                  "and the strike marks agree with the results on %d of %d pick cells (the picks shown are the "
                  "picks that were scored)" % (st["pre_event"], st["same_day"],
                                                st.get("strike_audit", {}).get("consistent", 0),
                                                st.get("strike_audit", {}).get("cells", 0)),
            "mm": "contest entries are made in a contest post published before the card; the results post (1-9 days "
                  "after) reports them. The lock rule sits behind the paywall and was not read: frozen by design, "
                  "not verified per bout. Leak check in eval.freeze (consensus less accurate than the close)",
        },
        "match": {"rw_bouts": st["bouts"], "rw_matched": st["matched"], "rw_unmatched": st["unmatched"],
                  "rw_match_rate": round(st["matched"] / max(1, st["bouts"]), 4),
                  "rw_picks": st["picks"], "rw_picks_unresolved": st["picks_unresolved"],
                  "mm_picks": sm["picks"], "mm_matched": sm["matched"], "mm_unmatched": sm["unmatched"],
                  "mm_match_rate": round(sm["matched"] / max(1, sm["picks"]), 4),
                  "rw_articles": st["articles"], "mm_posts": sm["posts"]},
        "coverage_by_year": cov, "ufc_bouts_by_year": dict(sorted(n_by_year.items())),
        "coverage_backtest": {src: sum(1 for r in out.values() if src in r and r["in_backtest"]
                                       and (src != "rw" or r["rw"]["frozen"] == "pre_event")) for src in ("rw", "mm")},
        "protocol": "fights dated 2026-01-01 or later dropped at parse (%d); no 2026 source page fetched; %d 2026 "
                    "rows written outside the repo" % (n_drop, rep["vault_rows_written_outside_repo"]),
        "method_round_shares": "none: neither permitted source publishes method or round shares in its free part "
                               "(Tapology does, and is off limits), so test 3 could not be run",
    }
    doc = {"meta": meta, "fights": out}
    old = json.load(open(OUT_JSON)) if os.path.exists(OUT_JSON) else {}
    if old.get("eval"):
        doc["eval_stale"] = "eval from an earlier build was dropped; rerun `tools/crowd.py eval`"
    json.dump(doc, open(OUT_JSON, "w"), indent=1)
    log("crowd.json: %d fights (rw %d pre-event, mm %d), match rates rw %.3f mm %.3f; written %s" % (
        len(out), st["pre_event"], sm["matched"], meta["match"]["rw_match_rate"], meta["match"]["mm_match_rate"],
        OUT_JSON))
    log("coverage by year: %s" % cov)
    return doc


def test_debut(CF, M2, np):
    """Bouts with a debutant (outside the backtest universe): crowd vs the closing line (nlbair BFO closing range,
    multiplicative no-vig), and close + crowd vs close with the weight fit forward on every covered fight."""
    import csv
    close = {}
    with open(os.path.join(ROOT, "data", "raw", "odds", "nlbair_odds.csv")) as fh:
        for r in csv.DictReader(fh):
            if r["event_date"] >= VAULT_FROM:       # dropped at parse
                continue
            try:
                p = float(r["f1_close_prob_novig"])
            except ValueError:
                continue
            close[r["fight_id"]] = (norm_name(r["f1_name"]), p)
    rows = []
    for fid, r in CF.items():
        if r.get("winner") not in ("A", "B") or fid not in close:
            continue
        n1, p = close[fid]
        if n1 == norm_name(r["b"]) and n1 != norm_name(r["a"]):
            p = 1 - p
        elif n1 != norm_name(r["a"]) and _name_score(n1, r["a"]) < _name_score(n1, r["b"]):
            p = 1 - p
        q = crowd_probs(r)
        rows.append(dict(fid=fid, year=int(r["date"][:4]), event=r["event"], y=1.0 if r["winner"] == "A" else 0.0,
                         close=min(max(p, 0.01), 0.99), debut=r["debut_bout"], **{c: q.get(c) for c in CROWD_COLS}))
    out = {"n_covered_with_close": len(rows), "n_debut": sum(1 for r in rows if r["debut"])}
    for c in CROWD_COLS:
        R = [r for r in rows if r[c] is not None]
        if not R:
            continue
        yrs = np.array([r["year"] for r in R]); y = np.array([r["y"] for r in R])
        zc = logit_np([r[c] for r in R]); zm = logit_np([r["close"] for r in R])
        deb = np.array([r["debut"] for r in R]); ev = np.array([r["event"] for r in R])
        pc = np.full(len(R), np.nan); ps = np.full(len(R), np.nan)
        for Y in sorted(set(yrs)):
            tr = yrs < Y if Y <= 2023 else yrs <= 2023
            if tr.sum() < 15:
                continue
            b = fit_slope(zc[tr], y[tr])
            w = M2.stack_fit(np.c_[zm[tr], zc[tr]], y[tr])
            m = yrs == Y
            pc[m] = 1 / (1 + np.exp(-b * zc[m]))
            ps[m] = 1 / (1 + np.exp(-(np.c_[zm[m], zc[m]] @ w)))
        res = {}
        for per, lo, hi in (("pre-2024 (forward)", 2017, 2023), ("2024-2025 (one look)", 2024, 2025)):
            for seg, sm in (("debut bouts", deb), ("other bouts", ~deb)):
                m = sm & (yrs >= lo) & (yrs <= hi) & ~np.isnan(pc)
                if m.sum() < 8:
                    res["%s | %s" % (per, seg)] = {"n": int(m.sum())}
                    continue
                pcl = 1 / (1 + np.exp(-zm[m]))
                res["%s | %s" % (per, seg)] = {
                    "n": int(m.sum()), "crowd": round(M2.ll(pc[m], y[m]), 5), "close": round(M2.ll(pcl, y[m]), 5),
                    "close+crowd": round(M2.ll(ps[m], y[m]), 5),
                    "crowd - close": M2.compare(pc[m], pcl, y[m], ev[m]),
                    "close+crowd - close": M2.compare(ps[m], pcl, y[m], ev[m])}
                q = res["%s | %s" % (per, seg)]
                log("debut %-5s %-20s %-12s n %3d crowd %.4f close %.4f close+crowd %.4f (%+.4f %s)" % (
                    c, per, seg, q["n"], q["crowd"], q["close"], q["close+crowd"], q["close+crowd - close"]["diff"],
                    q["close+crowd - close"]["diff_ci"]))
        out[c] = res
    return out


def freeze_checks(CF, D, np):
    out = {}
    rw_days = [r["rw"]["days_before"] for r in CF.values() if r.get("rw")]
    mm_days = [r["mm"]["days_after"] for r in CF.values() if r.get("mm")]
    hist = lambda v: {str(k): v.count(k) for k in sorted(set(v))}
    out["rw_days_published_before_event"] = hist(rw_days)
    out["mm_results_post_days_after_event"] = hist(mm_days)
    # leak check (pre-2024 only): if shares had been taken after the fights they would beat the close by a mile
    for c in ("rw", "mm"):
        m = D[c].notna().to_numpy() & D["market"].notna().to_numpy() & (D["year"].to_numpy() <= 2023)
        if m.sum() < 10:
            continue
        raw = D[c].to_numpy(float)[m]; y = D["y"].to_numpy(float)[m]; pm = D["market"].to_numpy(float)[m]
        out["leak_check_" + c] = {
            "n": int(m.sum()),
            "crowd_majority_acc": round(float(np.mean(np.where(np.abs(raw - 0.5) < 1e-9, 0.5, (raw > 0.5) == (y > 0.5)))), 4),
            "close_favourite_acc": round(float(np.mean((pm > 0.5) == (y > 0.5))), 4),
            "agree_with_close_favourite": round(float(np.mean((raw > 0.5) == (pm > 0.5))), 4)}
    return out


def swap_test(D, M2, np, has):
    """Corner symmetry: swap A and B on a random half of the rows (every expert p -> 1 - p, y -> 1 - y), refit the
    stacks and check the predictions flip exactly; also check crowd_probs on a swapped record."""
    rng = np.random.default_rng(11)
    sw = rng.random(len(D)) < 0.5
    D2 = D.copy()
    pcols = ["market", "market_mult", "open", "mkt_rating", "ml", "ml_roll", "ml_stack", "elo_sig", "elo", "engine",
             "feat_lr", "feat_lr_roll", "ml2_static", "ml2lr_static", "ml2_roll", "ml2lr_roll", "ml2s_static",
             "ml2s_roll"] + list(CROWD_COLS)
    for c in pcols:
        if c in D2:
            v = D2[c].to_numpy(float).copy()
            v[sw] = 1 - v[sw]
            D2[c] = v
    D2["y"] = np.where(sw, 1 - D["y"].to_numpy(float), D["y"].to_numpy(float))
    yr = D["year"].to_numpy()
    out = {}
    for regime, cols in (("line", ["market", "ml2", "crowd"]), ("noline", ["ml2", "mkt_rating", "feat_lr", "crowd"]),
                         ("open", ["open", "ml2", "crowd"])):
        m = has[regime] & (yr >= 2024)
        p1, w1 = M2.stack_predict(D, cols, "static", 1.5, 2023, m, has[regime])
        p2, w2 = M2.stack_predict(D2, cols, "static", 1.5, 2023, m, has[regime])
        flip = np.where(sw[m], 1 - p2, p2)
        out[regime] = {"max_abs_dp": float(np.max(np.abs(flip - p1))), "max_abs_dw": float(np.max(np.abs(w1 - w2)))}
    rec = {"rw": {"n_a": 4, "n_b": 2, "n": 6, "frozen": "pre_event"}, "mm": {"share_a": 0.71}}
    rsw = {"rw": {"n_a": 2, "n_b": 4, "n": 6, "frozen": "pre_event"}, "mm": {"share_a": 0.29}}
    a, b = crowd_probs(rec), crowd_probs(rsw)
    out["crowd_probs_max_abs(p + p_swapped - 1)"] = max(abs(a[k] + b[k] - 1) for k in a)
    worst = max(v for k, v in [(k, max(d["max_abs_dp"], d["max_abs_dw"])) for k, d in out.items() if isinstance(d, dict)])
    assert worst < 1e-5 and out["crowd_probs_max_abs(p + p_swapped - 1)"] < 1e-12, "corner symmetry broken: %s" % out
    log("swap test: %s" % out)
    return out


# ====================================================================== forward capture (upcoming cards)
def cmd_capture(args):
    """Capture the RotoWire panel for an upcoming card into data/predictions/crowd/ (write-once, like the ledger).
    Money MMA publishes its consensus only after the card, so there is nothing of it to capture before the fights."""
    ev = args.event.strip()
    num = re.search(r"UFC\s*(\d{3})", ev, re.I)
    today = dt.datetime.now(dt.timezone.utc).date().isoformat()
    if args.date < today and not args.vault:
        raise SystemExit("capture is for upcoming cards; %s is in the past (2026 history belongs to the vault: "
                         "pass --vault to write it outside the repo)" % args.date)
    sm = fetch(RW_SITEMAP, refresh=True)
    key = ("ufc-%s" % num.group(1)) if num else re.sub(r"[^a-z0-9]+", "-", ev.lower()).strip("-")
    urls = [u for u in re.findall(r"<loc>(.*?)</loc>", sm) if re.search(r"staff-picks|expert-picks", u) and key in u]
    rec = {"event": ev, "date": args.date, "captured_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
           "tool": TOOL_VERSION, "source": "rotowire", "url": None, "published": None, "bouts": [],
           "note": "panel share for A = picks for A / picks; P(A) input to a stack = (n_a + 0.5) / (n + 1)"}
    if urls:
        u = sorted(urls, key=lambda x: int(x.rsplit("-", 1)[1]))[-1]
        P = parse_rotowire(fetch(u, refresh=True))
        rec["url"], rec["published"] = u, P["published"]
        card = {}
        try:
            cu = json.load(open(os.path.join(ROOT, "data", "predictions", "cards_upcoming.json")))
            for e in cu.get("events", []):
                for b in e.get("bouts", []):
                    a_, b_ = b.get("a") or {}, b.get("b") or {}
                    # the ledger's bout_id: "<date>:<slug A>__<slug B>" (data/predictions/README.md)
                    card[(e.get("date"), norm_name(a_.get("name", "")), norm_name(b_.get("name", "")))] = "%s:%s__%s" % (
                        e.get("date"), a_.get("slug") or "null", b_.get("slug") or "null")
        except Exception:
            pass
        for b in P["bouts"]:
            na = sum(1 for t in b["picks"].values() if side_of_pick(t, b["a"], b["b"]) == "A")
            nb = sum(1 for t in b["picks"].values() if side_of_pick(t, b["a"], b["b"]) == "B")
            bid = None
            for (d, ka, kb), v in card.items():
                if d == args.date and (_pair_score(b["a"], b["b"], ka, kb) >= 0.8 or _pair_score(b["a"], b["b"], kb, ka) >= 0.8):
                    bid = v
            rec["bouts"].append({"a": b["a"], "b": b["b"], "bout_id": bid, "n_a": na, "n_b": nb,
                                 "share_a": round(na / (na + nb), 4) if na + nb else None,
                                 "p_a_input": round((na + RW_PRIOR) / (na + nb + 2 * RW_PRIOR), 4) if na + nb else None,
                                 "picks": b["picks"]})
    else:
        rec["note"] += "; no RotoWire panel article for this card yet (RotoWire covers pay-per-views only)"
    outdir = VAULT_DIR if args.vault else os.path.join(ROOT, "data", "predictions", "crowd")
    os.makedirs(outdir, exist_ok=True)
    slug = re.sub(r"[^a-z0-9]+", "-", ev.lower()).strip("-")
    stamp = rec["captured_utc"][:16].replace(":", "").replace("-", "")
    path = os.path.join(outdir, "%s_%s_%s.json" % (args.date, slug, stamp))
    if os.path.exists(path):
        raise SystemExit("exists (write-once): %s" % path)
    json.dump(rec, open(path, "w"), indent=1)
    log("captured %d bouts from %s -> %s" % (len(rec["bouts"]), rec["url"], path))


# ====================================================================== licensed import (e.g. Tapology with permission)
def import_csv(path):
    """Read a consensus export obtained with the source's permission. CSV columns: fight_id (ufcstats), share_a
    (0-1, share picking the first ufcstats name), frozen_utc (when the shares were taken), event_start_utc,
    optional ko_a, sub_a, dec_a, ko_b, sub_b, dec_b method shares. Rows with frozen_utc >= event_start_utc or a date
    >= 2026-01-01 are dropped. Nothing in this tool fetches such a file."""
    import csv
    out = {}
    for r in csv.DictReader(open(path)):
        if r.get("frozen_utc", "") >= r.get("event_start_utc", "~") or r.get("event_start_utc", "") >= VAULT_FROM:
            continue
        out[r["fight_id"]] = {k: (float(v) if re.match(r"^-?[0-9.]+$", v or "") else v) for k, v in r.items()}
    return out


# ====================================================================== selftest
def cmd_selftest(args):
    ok = []
    # 1. parser fixture (RotoWire layout with a struck losing pick)
    fx = ('<script type="application/ld+json">{"datePublished": "2025-11-12T20:15:00-08:00"}</script><h1>x</h1>'
          '<table><tr><th>MATCHUP</th><th>WEIGHT CLASS</th><th>JON</th><th>JAKE</th></tr>'
          '<tr><td><a>Jack Della Maddalena</a> (+220) vs.<br><a>Islam Makhachev</a> (-270)</td><td>Welterweight</td>'
          '<td><s>Della Maddalena</s></td><td>Makhachev</td></tr>'
          '<tr><td>UFC 322 RECORD</td><td></td><td>4-1</td><td>3-2</td></tr></table>')
    P = parse_rotowire(fx)
    b = P["bouts"][0]
    assert P["published"].startswith("2025-11-12") and b["a"] == "Jack Della Maddalena" and b["b"] == "Islam Makhachev"
    assert side_of_pick(b["picks"]["JON"], b["a"], b["b"]) == "A" and side_of_pick(b["picks"]["JAKE"], b["a"], b["b"]) == "B"
    ok.append("rotowire parser + pick sides (strike marks dropped from the text)")
    # 2. Money MMA fixture
    mm = ('<h1>UFC 306 Pick ‘Em Results</h1><div class="available-content"><p>Consensus Picks</p>'
          '<p>Sean O’Malley – 71% </p><p>Daniel Zellhuber - 74%</p><p>Consensus Overall Record in 2024: 79-46</p>'
          '</article>')
    Q = parse_moneymma(mm)
    assert Q["picks"] == [("Sean O’Malley", 0.71), ("Daniel Zellhuber", 0.74)], Q
    ok.append("moneymma parser")
    # 3. name matching
    assert _pair_score("Ian Garry", "Neil Magny", "Ian Machado Garry", "Neil Magny") >= 0.8
    assert _pair_score("Zhang Weili", "Valentina Shevchenko", "Weili Zhang", "Valentina Shevchenko") >= 0.8
    assert _pair_score("Jon Jones", "Stipe Miocic", "Ciryl Gane", "Stipe Miocic") < 0.8
    ok.append("name matching (aliases accepted, a different opponent rejected)")
    # 4. corner symmetry of the inputs
    a = crowd_probs({"rw": {"n_a": 5, "n_b": 1, "n": 6, "frozen": "pre_event"}, "mm": {"share_a": 0.64}})
    bb = crowd_probs({"rw": {"n_a": 1, "n_b": 5, "n": 6, "frozen": "pre_event"}, "mm": {"share_a": 0.36}})
    assert all(abs(a[k] + bb[k] - 1) < 1e-12 for k in a)
    assert "rw" not in crowd_probs({"rw": {"n_a": 5, "n_b": 1, "n": 6, "frozen": "same_day"}})
    ok.append("crowd_probs symmetric; same-day panels excluded")
    # 5. refused hosts never fetched (checked before any network call)
    try:
        _robots_ok("https://www.tapology.com/fightcenter")
        raise AssertionError("tapology not refused")
    except SystemExit:
        ok.append("tapology refused before any request")
    # 6. vault guard on the fight list and on crowd.json
    fights, n_drop = load_fights()
    assert max(f["date"] for f in fights) < VAULT_FROM and n_drop > 0
    if os.path.exists(OUT_JSON):
        d = json.load(open(OUT_JSON))
        assert all(r["date"] < VAULT_FROM for r in d["fights"].values())
    ok.append("no fight dated 2026+ in the parse or in crowd.json (%d dropped at parse)" % n_drop)
    for o in ok:
        log("ok:", o)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sp = ap.add_subparsers(dest="cmd", required=True)
    f = sp.add_parser("fetch")
    f.add_argument("--refresh-sitemaps", action="store_true")
    sp.add_parser("build")
    sp.add_parser("eval")
    c = sp.add_parser("capture")
    c.add_argument("--event", required=True)
    c.add_argument("--date", required=True, help="event date YYYY-MM-DD")
    c.add_argument("--vault", action="store_true", help="write outside the repo (past 2026 cards)")
    sp.add_parser("selftest")
    args = ap.parse_args()
    {"fetch": cmd_fetch, "build": cmd_build, "eval": run_eval, "capture": cmd_capture, "selftest": cmd_selftest}[args.cmd](args)


if __name__ == "__main__":
    main()
