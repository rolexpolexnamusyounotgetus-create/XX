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
                row[k + "_acc"] = round(float(np.mean((p > 0.5) == (y[m] > 0.5)) + 0.5 * np.mean(p == 0.5)), 4)
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
            for c in CROWD_COLS:
                cols = bcols + [c]
                cvc, hc, oofc = _cv_set(D, M2, np, cols, rows_ok, y, yr)
                gain = cvc[str(hc)] - cvb[str(hb)]
                m_cv = rows_ok & cvy
                m_cvc = m_cv & cov[c]
                r = {"cv_by_h": cvc, "h": hc, "cv": cvc[str(hc)], "cv_gain": round(gain, 6),
                     "passes_gate": bool(gain < -M2.SEL_MIN),
                     "cv_paired_all": M2.compare(oofc[m_cv], oofb[m_cv], y[m_cv], ev[m_cv]),
                     "cv_paired_covered": (M2.compare(oofc[m_cvc], oofb[m_cvc], y[m_cvc], ev[m_cvc])
                                           if m_cvc.sum() >= 10 else None),
                     "n_cv_covered": int(m_cvc.sum())}
                # the one 2024-25 look (static: fit <= 2023; rolling: experts' rolling columns, stack refit each January)
                pst, w = M2.stack_predict(D, cols, "static", hc, 2023, rows_ok & va, rows_ok)
                r["w_le_2023"] = dict(zip(cols, np.round(w, 4).tolist()))
                pc_full = np.full(len(D), np.nan)
                pc_full[rows_ok & va] = pst
                prc = np.full(len(D), np.nan)
                for Y in (2024, 2025):
                    m = rows_ok & (yr == Y)
                    prc[m], _ = M2.stack_predict(D, cols, "roll", hc, Y - 1, m, rows_ok)
                mv = rows_ok & va
                mvc = mv & cov[c]
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
