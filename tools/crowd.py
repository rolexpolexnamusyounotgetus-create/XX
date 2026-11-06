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
            picks = {}
            for j, c in enumerate(cells[start:start + len(pickers)]):
                t = c.get_text(" ", strip=True)
                if t and t.upper() not in ("N/A", "-", "--"):
                    picks[pickers[j]] = t
            bouts.append({"a": names[0], "b": names[1], "wc": wc, "picks": picks})
    # merge bouts split across several tables (one table per 3 pickers)
    merged = {}
    for b in bouts:
        k = (norm_name(b["a"]), norm_name(b["b"]))
        if k in merged:
            merged[k]["picks"].update(b["picks"])
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
            s1 = min(_name_score(a, f["a"]), _name_score(b, f["b"]))
            s2 = min(_name_score(a, f["b"]), _name_score(b, f["a"]))
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
