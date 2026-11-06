#!/usr/bin/env python3
"""Crowd and expert consensus picks as a winner / method signal (task key: crowd).

Run from the project root, niced (the box is shared):

    nice -n 5 python3 tools/crowd.py fetch            # cache source pages (>= 2 s between requests)
    nice -n 5 python3 tools/crowd.py build            # parse + match to ufcstats fight ids -> data/derived/crowd.json
    nice -n 5 python3 tools/crowd.py eval --stage cv        # every choice: CV on pre-2024 data (2024-25 rows dropped)
    nice -n 5 python3 tools/crowd.py eval --stage confirm   # the one 2024-25 look, decisions frozen by the cv stage
    nice -n 5 python3 tools/crowd.py capture --event "UFC 334: Gane vs. Hokit" --date 2026-11-14 [--dry-run]
    nice -n 5 python3 tools/crowd.py capture --source moneymma --event "UFC 334: Gane vs. Hokit" --date 2026-11-14
    python3 tools/crowd.py selftest                         # parser fixtures, matching, symmetry, vault guard

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
    majority of contest entrants (about 50) picked and the share who picked him. Frozen: entries lock before the card
    (prize contest); the 2025 contest posts state the lock in their free part ("All picks must be submitted by 6:00 PM
    Eastern Sat, January 18th"; 3 am ET for Shanghai, 10 am ET for Abu Dhabi), checked per card against the main
    card's earliest start (parse_contest / lock_status). 2022-2024 rules are paywalled: those cards are kept on the
    contest's rules, with a strict sensitivity (mm_s / crowd_s) that keeps only cards with a pre-event contest post,
    and leak checks (crowd vs close disagreements).

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
TOOL_VERSION = "crowd 1.1 (2026-11-06)"

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


MONTHS = {m: i + 1 for i, m in enumerate(("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov",
                                            "dec"))}
# Earliest typical start of a card's MAIN CARD (the contest's five bouts are main-card bouts), Eastern time on the
# ufcstats event date, by venue region. Approximate (no historical start-time source is used); a stated lock later
# than this bound is treated as unsafe and the card is dropped. Only cards whose lock text is readable use it.
LOCK_BOUND_ET = {"americas_ppv": 22.0, "americas": 19.0, "europe": 13.0, "middle_east": 12.0, "asia": 5.0,
                 "oceania": 21.0}
REGION = {
    "americas": ("USA", "Canada", "Mexico", "Brazil", "Argentina", "Chile", "Uruguay", "Colombia", "Peru"),
    "europe": ("United Kingdom", "England", "Scotland", "Ireland", "France", "Germany", "Sweden", "Poland", "Netherlands",
               "Czech Republic", "Denmark", "Russia", "Spain", "Italy", "Croatia", "Switzerland", "Belgium", "Austria",
               "Norway", "Portugal", "Azerbaijan", "Kazakhstan"),
    "middle_east": ("United Arab Emirates", "Saudi Arabia", "Qatar", "Bahrain", "Israel"),
    "asia": ("China", "Singapore", "Japan", "South Korea", "Korea", "Macau", "Philippines", "Thailand", "India"),
    "oceania": ("Australia", "New Zealand"),
}


def parse_contest(h):
    """Money MMA contest-entry post (published before the card). -> dict(published, lock_text, lock_md (month, day),
    lock_h (hours ET, 24 h), paywalled). From 2025 the free part states 'All picks must be submitted by 6:00 PM
    Eastern Sat, January 18th'; 2022-2024 posts are cut by the paywall before the rules."""
    m = re.search(r'<div class="available-content">(.*?)</article>', h, re.S)
    t = page_text(m.group(1) if m else h)
    out = {"published": _date_published(h), "lock_text": None, "lock_md": None, "lock_h": None,
           "paywalled": bool(re.search(r"Continue reading this post|Claim my free post", t))}
    mm = re.search(r"submitted by\s+([0-9]{1,2})(?::([0-9]{2}))?\s*([ap])\.?\s*m\.?\s*(?:Eastern|ET|EST|EDT)[^,\n]*,?"
                   r"\s*([A-Za-z]{3,9})\.?\s+([0-9]{1,2})", t, re.I)
    if mm:
        hh = int(mm.group(1)) % 12 + (12 if mm.group(3).lower() == "p" else 0)
        out["lock_h"] = hh + int(mm.group(2) or 0) / 60.0
        mon = MONTHS.get(mm.group(4)[:3].lower())
        out["lock_md"] = (mon, int(mm.group(5))) if mon else None
        out["lock_text"] = mm.group(0)
    return out


def event_region(location, event_name):
    country = (location or "").split(",")[-1].strip()
    for reg, cs in REGION.items():
        if country in cs:
            if reg == "americas" and re.match(r"UFC \d+:", event_name or ""):
                return "americas_ppv"
            return reg
    return None


def lock_status(c, event_date, region):
    """'lock_verified' | 'lock_after_bound' (unsafe: drop) | 'lock_text_inconsistent' | 'paywalled'."""
    if not c or c["lock_h"] is None or not c["lock_md"]:
        return "paywalled"
    ed = dt.date.fromisoformat(event_date)
    try:
        ld = dt.date(ed.year, *c["lock_md"])
    except ValueError:
        return "lock_text_inconsistent"
    if not (0 <= (ed - ld).days <= 1):
        return "lock_text_inconsistent"            # stale copy-paste (e.g. UFC 312's post repeats UFC 311's date)
    if region is None:
        return "lock_text_inconsistent"
    return "lock_verified" if c["lock_h"] <= LOCK_BOUND_ET[region] + 1e-9 else "lock_after_bound"


def load_event_locations():
    import csv
    out = {}
    with open(os.path.join(ROOT, "data", "raw", "ufc_event_details.csv")) as fh:
        for r in csv.DictReader(fh):
            out[r["EVENT"].strip()] = r["LOCATION"].strip()
    return out


def map_contests(fights):
    """Contest-entry post -> ufcstats event (the first card 0-10 days after the post whose name matches the slug).
    Returns {event name: {slug, published, lock..., status}}."""
    import glob
    events = {}
    for f in fights:
        events.setdefault(f["event"], f["date"])
    locs = load_event_locations()
    out = {}
    for fn in sorted(glob.glob(os.path.join(CACHE, "moneymma", "p_*.html"))):
        slug = os.path.basename(fn)[2:-5]
        if "results" in slug:
            continue
        c = parse_contest(open(fn, encoding="utf-8", errors="replace").read())
        pub = _iso_day(c["published"])
        if not pub:
            continue
        num = re.match(r"ufc-(\d{3})-pick", slug)
        names = re.sub(r"^(ufc-fight-night-|noche-ufc-)", "", slug)
        names = re.sub(r"-pick.*$", "", names).split("-vs-")
        best = None
        for ev, d in events.items():
            gap = _days(pub, d)
            if not (0 <= gap <= 10):
                continue
            evn = norm_name(ev)
            if num:
                ok = re.match(r"ufc %s\b" % num.group(1), evn) is not None
            else:
                ok = len(names) == 2 and all(norm_name(x.replace("-", " ")).split()[-1] in evn.split() for x in names
                                             if x)
            if ok and (best is None or gap < best[1]):
                best = (ev, gap)
        if not best:
            continue
        ev = best[0]
        reg = event_region(locs.get(ev), ev)
        st = lock_status(c, events[ev], reg)
        rec = {"slug": slug, "published": c["published"], "days_before": best[1], "lock_text": c["lock_text"],
               "lock_h_et": c["lock_h"], "region": reg, "status": st}
        prev = out.get(ev)
        if prev is None or (prev["status"] != "lock_verified" and st == "lock_verified"):
            out[ev] = rec
    return out


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
    contests = map_contests(fights)
    rep["moneymma_contests"] = {"posts_mapped": len(contests),
                                "by_status": {k: sum(1 for c in contests.values() if c["status"] == k)
                                              for k in sorted(set(c["status"] for c in contests.values()))},
                                "cards": {ev: c for ev, c in sorted(contests.items(), key=lambda kv: kv[1]["published"])}}
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
            c = contests.get(f["event"])
            if c is None:
                frz = "by_design"                 # no contest post found for the card: frozen by the contest's rules
            elif c["status"] == "lock_verified":
                frz = "lock_verified"
            elif c["status"] == "lock_after_bound":
                frz = "lock_after_bound"          # dropped (never fit or scored)
            else:
                frz = "contest_pre_event"         # contest post published before the card; lock text paywalled/stale
            sm.setdefault("freeze", {})
            sm["freeze"][frz] = sm["freeze"].get(frz, 0) + 1
            r["mm"] = {"pick": side, "pct_pick": pct, "share_a": round(pct if side == "A" else 1 - pct, 4),
                       "published": P["published"], "days_after": _days(f["date"], pub), "match_score": round(score, 3),
                       "post": os.path.basename(fn)[2:-5], "freeze": frz,
                       "contest": ({k: c[k] for k in ("slug", "published", "lock_text", "lock_h_et", "region", "status")}
                                   if c else None)}
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
# Two stages, run in this order and never the other way round:
#   eval --stage cv       2024-25 rows are dropped from every table before anything is computed. Forward-chained CV
#                         (stack gate 2021-2023, method folds 2020-2023, stand-alone and debut checks on <= 2023)
#                         decides everything; the decisions are written to crowd.json["cv"]["decisions"] and committed.
#   eval --stage confirm  the single 2024-2025 look, with the settings and decisions frozen by the cv stage. It
#                         refuses to run when crowd.json already holds a confirm block (pass --again to reproduce it;
#                         nothing is selected on it either way).
STACK_CACHE = os.path.join(ROOT, "out", "ml2_cache", "stack.pkl")
EVAL_OUT = os.path.join(ROOT, "out", "crowd_cache")
CROWD_COLS = ("rw", "mm", "crowd")
STRICT_COLS = ("mm_s", "crowd_s")   # freeze sensitivity: Money MMA only on cards with a pre-event contest post
ALL_COLS = CROWD_COLS + STRICT_COLS
# the CV-chosen ML v2 stacks (research/model_ml2.md section 6) and the page variants, by regime
BASE_SETS = {
    "line": {"market+ml2": ["market", "ml2"], "page: market+ml2lr": ["market", "ml2lr"]},
    "noline": {"ml2+mkt_rating+feat_lr": ["ml2", "mkt_rating", "feat_lr"], "page: ml2lr+mkt_rating": ["ml2lr", "mkt_rating"]},
    "open": {"open+ml2": ["open", "ml2"], "page: open+ml2lr": ["open", "ml2lr"]},
}
RW_PRIOR = 0.5                     # pseudo-picks per side when a panel share becomes a probability
MM_CLIP = 0.03
CV_YEARS = (2021, 2022, 2023)      # forward-chained stack CV folds (fit on 2019..Y-1, score Y)
H_GRID = (None, 3.0, 1.5)          # recency half-lives, chosen per stack with the SEL_MIN penalty (ml2's rule)


def crowd_probs(r, strict=False):
    """Per-fight crowd inputs as P(A): rw (panel share, shrunk), mm (contest consensus share), crowd (mean logit).
    A RotoWire panel counts only when published at least a day before the card. A Money MMA row is dropped when its
    card's stated lock is later than the main card's earliest start (lock_after_bound); strict=True also drops cards
    with no pre-event contest post (freeze 'by_design')."""
    out = {}
    if r.get("rw") and r["rw"].get("frozen") == "pre_event":
        w = r["rw"]
        out["rw"] = (w["n_a"] + RW_PRIOR) / (w["n"] + 2 * RW_PRIOR)
    mm = r.get("mm")
    if mm:
        frz = mm.get("freeze", "by_design")
        keep = frz != "lock_after_bound" and (not strict or frz in ("lock_verified", "contest_pre_event"))
        if keep:
            out["mm"] = min(max(mm["share_a"], MM_CLIP), 1 - MM_CLIP)
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
    for c in ALL_COLS:
        D[c] = np.nan
    D["rw_n"] = 0
    idx = {f: i for i, f in enumerate(D["fid"])}
    for fid, r in crowd_fights.items():
        if fid in idx:
            p = crowd_probs(r)
            ps = crowd_probs(r, strict=True)
            for c, v in p.items():
                D.iat[idx[fid], D.columns.get_loc(c)] = v
            for c in ("mm", "crowd"):
                if c in ps:
                    D.iat[idx[fid], D.columns.get_loc(c + "_s")] = ps[c]
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


def _acc(p, y):
    np, _ = _np()
    return round(float(np.mean(np.where(np.abs(p - 0.5) < 1e-9, 0.5, (p > 0.5) == (y > 0.5)))), 4)


def _data_hash(CF):
    return hashlib.sha256(json.dumps(CF, sort_keys=True).encode()).hexdigest()[:16]


def run_eval(args):
    import pickle
    np, pd = _np()
    stage = args.stage
    sys.argv = [sys.argv[0]]
    import ml2 as M2
    os.makedirs(EVAL_OUT, exist_ok=True)
    doc = json.load(open(OUT_JSON))
    CF = doc["fights"]
    assert all(r["date"] < VAULT_FROM for r in CF.values()), "2026 rows in crowd.json"
    if stage == "confirm":
        if not doc.get("cv", {}).get("decisions"):
            raise SystemExit("run `eval --stage cv` first (the decisions must be frozen before the one look)")
        if doc["cv"]["meta"]["data_hash"] != _data_hash(CF):
            raise SystemExit("crowd.json changed since the cv stage: rerun the cv stage (and commit) first")
        if doc.get("confirm") and not args.again:
            raise SystemExit("crowd.json already holds the one 2024-25 look (%s); pass --again only to reproduce it"
                             % doc["confirm"]["meta"]["run"])
    S = pickle.load(open(STACK_CACHE, "rb"))
    D = S["D"].copy()
    assert str(D["date"].max()) < VAULT_FROM and int(D["year"].max()) <= 2025, "2026 rows in the stack table"
    if stage == "cv":
        D = D[D["year"] <= 2023].reset_index(drop=True)        # the validation years never enter the cv stage
        CFs = {k: r for k, r in CF.items() if r["date"] < "2024-01-01"}
    else:
        CFs = CF
    D = attach_crowd(D, CFs)
    yr = D["year"].to_numpy()
    has = {"line": D["market"].notna().to_numpy(), "open": D["open"].notna().to_numpy(), "noline": np.ones(len(D), bool)}
    cov = {c: D[c].notna().to_numpy() for c in ALL_COLS}
    years = range(2019, 2024) if stage == "cv" else range(2024, 2026)
    R = {"coverage": {c: {str(Y): int((cov[c] & (yr == Y)).sum()) for Y in years} for c in ALL_COLS}}
    R["coverage"]["rows"] = {str(Y): int((yr == Y).sum()) for Y in years}
    log("[%s] coverage in the ML v2 stack table (%d rows): %s" % (stage, len(D), {c: int(cov[c].sum()) for c in ALL_COLS}))
    R["alone"] = test_alone(D, CFs, M2, stage)
    R["stack"] = test_stack(D, M2, has, cov, stage)
    R["debut"] = test_debut(CFs, M2, stage)
    R["method"] = test_method(CFs, stage)
    meta = {"tool": TOOL_VERSION, "stage": stage, "run": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "data_hash": _data_hash(CF),
            "stack_table": "out/ml2_cache/stack.pkl (tools/ml2.py stage stack: ML v2 OOF 2019-2023, static/rolling 2024-25)",
            "rule": "an input enters a stack only if forward-chained CV 2021-2023 improves the stack's log loss on all of "
                    "the regime's rows by more than %g (ml2 SEL_MIN); Money MMA variants must also pass with the strict "
                    "freeze (mm_s / crowd_s)" % M2.SEL_MIN,
            "bootstrap": "2,000 event-cluster resamples, paired (tools/ml2.py compare; methodround cluster_bootstrap)"}
    R["meta"] = meta
    if stage == "cv":
        R["freeze"] = freeze_checks(CFs, D)
        R["swap"] = swap_test(D, M2, has)
        R["decisions"] = decide(R, M2.SEL_MIN)
        doc["cv"] = R
        doc.pop("eval", None)
        doc.pop("eval_stale", None)
        log("[cv] decisions: %s" % json.dumps(R["decisions"]["summary"]))
    else:
        R["decisions_applied"] = doc["cv"]["decisions"]["summary"]
        doc["confirm"] = R
    json.dump(R, open(os.path.join(EVAL_OUT, "eval_%s.json" % stage), "w"), indent=1, default=float)
    json.dump(doc, open(OUT_JSON, "w"), indent=1, default=float)
    log("[%s] written to %s and %s" % (stage, os.path.join(EVAL_OUT, "eval_%s.json" % stage), OUT_JSON))
    return R


def test_alone(D, CF, M2, stage):
    """Test 1: the crowd alone, calibrated by one no-intercept slope fit forward (on every covered decisive UFC bout of
    the years before the scored year; the 2024-25 look uses <= 2023), against Elo, ML v2 (OOF before 2024, static
    after), the open and the close, on the same backtest fights (those with both lines)."""
    np, _ = _np()
    allrows = []
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
    g_all = D["event"].to_numpy()
    both = D["market"].notna().to_numpy() & D["open"].notna().to_numpy()
    per = ("2019-2023 (forward)", 2019, 2023) if stage == "cv" else ("2024-2025 (one look)", 2024, 2025)
    for c in CROWD_COLS:
        rr = [x for x in allrows if x[0] == c]
        if not rr:
            continue
        zA = np.array([x[2] for x in rr]); yA = np.array([x[3] for x in rr]); yrA = np.array([x[1] for x in rr])
        slopes = {}
        for Y in range(per[1], per[2] + 1):
            m = yrA < min(Y, 2024)
            slopes[Y] = fit_slope(zA[m], yA[m]) if m.sum() >= 15 else None
        zc = logit_np(D[c].to_numpy(float))
        pc = np.full(len(D), np.nan)
        for Y, b in slopes.items():
            m = (yr == Y) & D[c].notna().to_numpy()
            if b is not None:
                pc[m] = 1 / (1 + np.exp(-b * zc[m]))
        res = {"slope_by_year": {str(k): (round(v, 3) if v is not None else None) for k, v in slopes.items()},
               "slope_rows": "all covered decisive UFC bouts of earlier years (crowd.json), not only backtest rows"}
        m = (~np.isnan(pc)) & (yr >= per[1]) & (yr <= per[2]) & both
        if m.sum() >= 10:
            g = g_all[m]
            row = {"n": int(m.sum()), "events": int(len(set(g)))}
            for k, col in (("crowd", None), ("elo", "elo"), ("elo_sig", "elo_sig"), ("ml2", "ml2_static"),
                           ("ml2lr", "ml2lr_static"), ("open", "open"), ("close", "market")):
                p = pc[m] if col is None else D[col].to_numpy(float)[m]
                row[k] = round(M2.ll(p, y[m]), 5)
                row[k + "_acc"] = _acc(p, y[m])
            for k, col in (("elo", "elo"), ("elo_sig", "elo_sig"), ("ml2", "ml2_static"), ("ml2lr", "ml2lr_static"),
                           ("open", "open"), ("close", "market")):
                row["crowd - " + k] = M2.compare(pc[m], D[col].to_numpy(float)[m], y[m], g)
            raw = D[c].to_numpy(float)[m]
            row["majority_pick_acc"] = _acc(raw, y[m])
            row["crowd_majority_agrees_with_close_fav"] = round(float(np.mean((raw > 0.5) == (D["market"].to_numpy(float)[m] > 0.5))), 4)
            res[per[0]] = row
            log("alone %-6s %-22s n %3d | crowd %.4f elo %.4f elo_sig %.4f ml2 %.4f open %.4f close %.4f | crowd-close "
                "%+.4f %s" % (c, per[0], row["n"], row["crowd"], row["elo"], row["elo_sig"], row["ml2"], row["open"],
                              row["close"], row["crowd - close"]["diff"], row["crowd - close"]["diff_ci"]))
        out[c] = res
    return out


def _stack_fit_signed(Z, y, w, k_signed):
    """ml2.stack_fit with the last k_signed weights free in sign (a negative crowd weight = fade the public given the
    other experts); same objective, L2 and start."""
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


def stack_predict(M2, D, cols, scheme, h, fit_until_year, pred_mask, rows_ok, signed=False):
    """tools/ml2.stack_predict (no intercept, logit inputs, absent = 0, recency half-life h), optionally with the
    crowd column's weight free in sign."""
    if not signed:
        return M2.stack_predict(D, cols, scheme, h, fit_until_year, pred_mask, rows_ok)
    np, _ = _np()
    cc = [M2.col_for(c, scheme if scheme == "roll" else "static") for c in cols]
    tr = rows_ok & (D["year"] <= fit_until_year).to_numpy() & (D["year"] >= 2019).to_numpy()
    Z = M2.zmat(D, cc)
    ks = sum(1 for c in cols if c in ALL_COLS)
    b = _stack_fit_signed(Z[tr], D["y"].to_numpy(float)[tr], M2.rec_w(D["year"].to_numpy()[tr], fit_until_year + 1, h), ks)
    return M2.sig(Z[pred_mask] @ b), b


def _cv_set(D, M2, cols, rows_ok, y, yr, signed=False):
    """ml2's forward-chained stack CV (fit 2019..Y-1, score Y, Y = 2021-2023), recency half-life chosen with the
    SEL_MIN penalty. Returns (cv by h, chosen h, OOF predictions for 2021-2023 under the chosen h)."""
    np, _ = _np()
    cvs, oof = {}, {}
    for h in H_GRID:
        tot = nn = 0.0
        arr = np.full(len(D), np.nan)
        for Y in CV_YEARS:
            m = rows_ok & (yr == Y)
            p, _ = stack_predict(M2, D, cols, "static", h, Y - 1, m, rows_ok, signed)
            arr[m] = p
            tot += M2.ll(p, y[m]) * m.sum()
            nn += m.sum()
        cvs[str(h)] = round(tot / nn, 6)
        oof[str(h)] = arr
    hb = min(cvs, key=lambda k: cvs[k] + (0 if k == "None" else M2.SEL_MIN))
    return cvs, (None if hb == "None" else float(hb)), oof[hb]


def _cands():
    out = []
    for c in ALL_COLS:
        for signed in (False, True):
            out.append((c + (" (signed)" if signed else ""), c, signed))
    return out


def test_stack(D, M2, has, cov, stage):
    """Test 2: each crowd column as an extra expert in the no-line, open and close stacks (and their page variants).
    cv stage: forward-chained CV 2021-2023 on all of the regime's rows (crowd absent = 0, as ml2 treats any absent
    expert), plus the paired difference on the covered rows. confirm stage: the same CV (recomputed, identical) for
    the half-lives, then the one 2024-25 look: static (fit <= 2023) and rolling (refit each January)."""
    np, _ = _np()
    y = D["y"].to_numpy(float)
    yr = D["year"].to_numpy()
    ev = D["event"].to_numpy()
    close = D["market"].to_numpy(float)
    cvy = np.isin(yr, CV_YEARS)
    va = yr >= 2024
    out = {}
    for regime, sets in BASE_SETS.items():
        rows_ok = has[regime]
        for bname, bcols in sets.items():
            key = "%s|%s" % (regime, bname)
            res = {"base_cols": bcols, "cands": {}}
            cvb, hb, oofb = _cv_set(D, M2, bcols, rows_ok, y, yr)
            res["base"] = {"cv_by_h": cvb, "h": hb, "cv": cvb[str(hb)]}
            if stage == "confirm":
                pb, wb = stack_predict(M2, D, bcols, "static", hb, 2023, rows_ok & va, rows_ok)
                res["base"]["w_le_2023"] = dict(zip(bcols, np.round(wb, 4).tolist()))
                pb_full = np.full(len(D), np.nan)
                pb_full[rows_ok & va] = pb
                prb = np.full(len(D), np.nan)
                for Y in (2024, 2025):
                    m = rows_ok & (yr == Y)
                    prb[m], _ = stack_predict(M2, D, bcols, "roll", hb, Y - 1, m, rows_ok)
                mk = rows_ok & va & has["line"]
                res["base"]["valid_static_vs_close"] = M2.compare(pb_full[mk], close[mk], y[mk], ev[mk])
            for name, c, signed in _cands():
                cols = bcols + [c]
                cvc, hc, oofc = _cv_set(D, M2, cols, rows_ok, y, yr, signed)
                gain = cvc[str(hc)] - cvb[str(hb)]
                m_cv = rows_ok & cvy
                m_cvc = m_cv & cov[c]
                _, w_cv = stack_predict(M2, D, cols, "static", hc, 2022, rows_ok & (yr == 2023), rows_ok, signed)
                r = {"col": c, "signed": signed, "cv_by_h": cvc, "h": hc, "cv": cvc[str(hc)], "cv_gain": round(gain, 6),
                     "passes_gate": bool(gain < -M2.SEL_MIN),
                     "w_fit_le_2022": dict(zip(cols, np.round(w_cv, 4).tolist())),
                     "cv_paired_all": M2.compare(oofc[m_cv], oofb[m_cv], y[m_cv], ev[m_cv]),
                     "cv_paired_covered": (M2.compare(oofc[m_cvc], oofb[m_cvc], y[m_cvc], ev[m_cvc])
                                           if m_cvc.sum() >= 10 else None),
                     "n_cv_covered": int(m_cvc.sum())}
                if stage == "confirm":
                    pst, w = stack_predict(M2, D, cols, "static", hc, 2023, rows_ok & va, rows_ok, signed)
                    r["w_le_2023"] = dict(zip(cols, np.round(w, 4).tolist()))
                    pc_full = np.full(len(D), np.nan)
                    pc_full[rows_ok & va] = pst
                    prc = np.full(len(D), np.nan)
                    for Y in (2024, 2025):
                        m = rows_ok & (yr == Y)
                        prc[m], _ = stack_predict(M2, D, cols, "roll", hc, Y - 1, m, rows_ok, signed)
                    mv = rows_ok & va
                    mvc = mv & cov[c]
                    r["valid_static_all"] = M2.compare(pc_full[mv], pb_full[mv], y[mv], ev[mv])
                    r["valid_roll_all"] = M2.compare(prc[mv], prb[mv], y[mv], ev[mv])
                    r["valid_static_covered"] = (M2.compare(pc_full[mvc], pb_full[mvc], y[mvc], ev[mvc])
                                                 if mvc.sum() >= 10 else None)
                    r["n_valid_covered"] = int(mvc.sum())
                    mk = mv & has["line"]
                    r["valid_static_vs_close"] = M2.compare(pc_full[mk], close[mk], y[mk], ev[mk])
                res["cands"][name] = r
                cp = r["cv_paired_covered"]
                log("stack %-32s +%-17s CV %.5f vs %.5f (gain %+.5f, h %s, %s) | covered %s%s" % (
                    key, name, r["cv"], res["base"]["cv"], gain, hc, "PASS" if r["passes_gate"] else "fail",
                    ("%+.4f %s (n %d)" % (cp["diff"], cp["diff_ci"], r["n_cv_covered"])) if cp else "-",
                    (" | 2024-25 static %+.5f %s" % (r["valid_static_all"]["diff"], r["valid_static_all"]["diff_ci"]))
                    if stage == "confirm" else ""))
            out[key] = res
    return out


def decide(R, sel_min):
    """Pre-registered adoption rule, applied to the cv stage only: per base stack, the primary candidate (rw, mm or
    crowd; non-negative or signed weight) with the lowest CV log loss is adopted only if it beats the base by more
    than SEL_MIN on all of the regime's rows; a Money MMA based candidate must also pass with the strict freeze.
    Method (test 3): S2c(+ml2win) is adopted only if its CV joint loss beats S2(+ml2win) by more than SEL_MIN."""
    dec = {"stack": {}, "method": {}, "summary": {}}
    for key, res in R["stack"].items():
        prim = {n: r for n, r in res["cands"].items() if r["col"] in CROWD_COLS}
        best = min(prim, key=lambda n: prim[n]["cv"])
        b = prim[best]
        ok = b["passes_gate"]
        strict_ok = None
        if ok and b["col"] in ("mm", "crowd"):
            sname = b["col"] + "_s" + (" (signed)" if b["signed"] else "")
            strict_ok = res["cands"][sname]["passes_gate"]
            ok = ok and strict_ok
        dec["stack"][key] = {"best_by_cv": best, "cv_gain": b["cv_gain"], "passes_gate": b["passes_gate"],
                             "strict_freeze_passes": strict_ok, "adopted": best if ok else None,
                             "n_passing_any_variant": sum(1 for r in res["cands"].values() if r["passes_gate"])}
        dec["summary"][key] = best if ok else None
    M = R.get("method") or {}
    if M.get("cv_gate"):
        # ml2's own method rule (tools/ml2.py stage_method): the variant with the lowest CV joint loss wins, and a
        # crowd variant must beat the best variant without the crowd by more than SEL_MIN. (A first draft compared
        # each crowd variant only with its own twin, which let S2c pass against S2 although S2 is not the production
        # variant and S2c is worse than S2+ml2win; corrected on the cv numbers, before the 2024-25 look.)
        cvj = {k: v["joint"] for k, v in M["all"]["means"].items()}
        best = min(cvj, key=cvj.get)
        best_plain = min((k for k in cvj if "S2c" not in k), key=cvj.get)
        adopt = "S2c" in best and cvj[best] < cvj[best_plain] - sel_min
        dec["method"] = {"cv_joint": cvj, "lowest": best, "best_without_crowd": best_plain,
                         "gain_vs_best_without_crowd": round(cvj[best] - cvj[best_plain], 5),
                         "twin_comparisons": M["cv_gate"], "adopted": best if adopt else None}
        dec["summary"]["method (S2 / S2+ml2win)"] = best if adopt else None
    dec["summary"]["adopted_anywhere"] = any(v for v in dec["summary"].values())
    return dec


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
            "mm": "the consensus is the share of contest entrants (about 50 per card) picking each fighter; entries "
                  "lock before the card and the results post (1-9 days after) reports them. Per card: "
                  "'lock_verified' = the card's contest post (free part, 2025 on) states a lock on the event day no "
                  "later than the main card's earliest start for the venue's region (LOCK_BOUND_ET: 3 am ET Shanghai, "
                  "10 am ET Abu Dhabi, 4-7 pm ET US Fight Nights, 6-6:30 pm ET US pay-per-views); 'contest_pre_event' "
                  "= a contest post was published before the card but its rules are paywalled (2022-2024) or stale; "
                  "'by_design' = no contest post found (kept on the contest's rules; dropped in the strict "
                  "sensitivity mm_s / crowd_s); 'lock_after_bound' = dropped. Counts: %s. Leak checks in cv.freeze"
                  % json.dumps(sm.get("freeze", {})),
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
        "method_round_shares": "none: RotoWire cells are fighter names only and Money MMA's free consensus block "
                               "gives winner shares only (its contest asks for the method, but the method consensus "
                               "is not published); Tapology publishes them and is off limits (robots.txt). Test 3 is "
                               "run on what exists: the crowd's winner consensus as an input to the method model S2",
        "moneymma_contests": rep.get("moneymma_contests"),
    }
    doc = {"meta": meta, "fights": out}
    old = json.load(open(OUT_JSON)) if os.path.exists(OUT_JSON) else {}
    if old.get("cv") and old["cv"]["meta"].get("data_hash") == _data_hash(out):
        for k in ("cv", "confirm"):           # same data: the frozen decisions (and the one look) stay valid
            if k in old:
                doc[k] = old[k]
    elif old.get("cv") or old.get("eval"):
        doc["eval_stale"] = "evaluation blocks from an earlier build were dropped (data changed); rerun the cv stage"
    json.dump(doc, open(OUT_JSON, "w"), indent=1)
    log("crowd.json: %d fights (rw %d pre-event, mm %d), match rates rw %.3f mm %.3f; written %s" % (
        len(out), st["pre_event"], sm["matched"], meta["match"]["rw_match_rate"], meta["match"]["mm_match_rate"],
        OUT_JSON))
    log("coverage by year: %s" % cov)
    return doc


def test_debut(CF, M2, stage):
    """Test 4: bouts with a debutant (outside the backtest universe; crowd.json covers every UFC bout the sources
    picked). Crowd vs the closing and opening lines (nlbair BFO, multiplicative no-vig), and line + crowd vs the line
    with the slope / stack weight fit forward on every covered decisive bout of earlier years (the 2024-25 look fits
    on <= 2023)."""
    import csv
    np, _ = _np()
    lines = {}
    with open(os.path.join(ROOT, "data", "raw", "odds", "nlbair_odds.csv")) as fh:
        for r in csv.DictReader(fh):
            if r["event_date"] >= VAULT_FROM:       # dropped at parse
                continue

            def fl(k):
                try:
                    return float(r[k])
                except (ValueError, KeyError):
                    return None
            lines[r["fight_id"]] = (norm_name(r["f1_name"]), fl("f1_close_prob_novig"), fl("f1_open_prob_novig"))
    rows = []
    for fid, r in CF.items():
        if r.get("winner") not in ("A", "B") or fid not in lines:
            continue
        n1, pc_, po_ = lines[fid]
        flip = (n1 == norm_name(r["b"]) and n1 != norm_name(r["a"])) or (
            n1 != norm_name(r["a"]) and _name_score(n1, r["a"]) < _name_score(n1, r["b"]))
        q = crowd_probs(r)
        rec = dict(fid=fid, year=int(r["date"][:4]), event=r["event"], y=1.0 if r["winner"] == "A" else 0.0,
                   debut=r["debut_bout"], **{c: q.get(c) for c in CROWD_COLS})
        for k, p in (("close", pc_), ("open", po_)):
            rec[k] = None if p is None else min(max(1 - p if flip else p, 0.01), 0.99)
        rows.append(rec)
    out = {"n_covered_with_line": len(rows), "n_debut": sum(1 for r in rows if r["debut"]),
           "debut_definition": "either side has no earlier UFC bout in ufcstats (counts updated after each card)"}
    per = ("pre-2024 (forward)", 2017, 2023) if stage == "cv" else ("2024-2025 (one look)", 2024, 2025)
    for c in CROWD_COLS:
        res = {}
        for line in ("close", "open"):
            R_ = [r for r in rows if r[c] is not None and r[line] is not None]
            if not R_:
                continue
            yrs = np.array([r["year"] for r in R_]); y = np.array([r["y"] for r in R_])
            zc = logit_np([r[c] for r in R_]); zm = logit_np([r[line] for r in R_])
            deb = np.array([r["debut"] for r in R_]); ev = np.array([r["event"] for r in R_])
            pc = np.full(len(R_), np.nan); ps = np.full(len(R_), np.nan)
            for Y in range(per[1], per[2] + 1):
                tr = yrs < min(Y, 2024)
                m = yrs == Y
                if tr.sum() < 15 or not m.any():
                    continue
                b = fit_slope(zc[tr], y[tr])
                w = _stack_fit_signed(np.c_[zm[tr], zc[tr]], y[tr], np.ones(int(tr.sum())), 1)
                pc[m] = 1 / (1 + np.exp(-b * zc[m]))
                ps[m] = 1 / (1 + np.exp(-(np.c_[zm[m], zc[m]] @ w)))
            for seg, sm in (("debut bouts", deb), ("other bouts", ~deb)):
                m = sm & (yrs >= per[1]) & (yrs <= per[2]) & ~np.isnan(pc) & ~np.isnan(ps)
                k = "%s | %s | %s" % (line, per[0], seg)
                if m.sum() < 8:
                    res[k] = {"n": int(m.sum())}
                    continue
                pl = 1 / (1 + np.exp(-zm[m]))
                res[k] = {"n": int(m.sum()), "events": int(len(set(ev[m]))), "crowd": round(M2.ll(pc[m], y[m]), 5),
                          line: round(M2.ll(pl, y[m]), 5), line + "+crowd": round(M2.ll(ps[m], y[m]), 5),
                          "crowd - " + line: M2.compare(pc[m], pl, y[m], ev[m]),
                          line + "+crowd - " + line: M2.compare(ps[m], pl, y[m], ev[m])}
                q = res[k]
                log("debut %-5s %-46s n %3d crowd %.4f %s %.4f %s+crowd %.4f (%+.4f %s)" % (
                    c, k, q["n"], q["crowd"], line, q[line], line, q[line + "+crowd"],
                    q[line + "+crowd - " + line]["diff"], q[line + "+crowd - " + line]["diff_ci"]))
        out[c] = res
    return out


def freeze_checks(CF, D):
    """Freeze evidence and leak checks (cv stage, <= 2023 only)."""
    np, _ = _np()
    out = {}
    rw_days = [r["rw"]["days_before"] for r in CF.values() if r.get("rw")]
    mm_days = [r["mm"]["days_after"] for r in CF.values() if r.get("mm")]
    hist = lambda v: {str(k): v.count(k) for k in sorted(set(v))}
    out["rw_days_published_before_event"] = hist(rw_days)
    out["mm_results_post_days_after_event"] = hist(mm_days)
    fr = [r["mm"].get("freeze", "by_design") for r in CF.values() if r.get("mm")]
    out["mm_freeze_categories"] = hist(fr)
    # leak checks: shares taken after the fights would beat the close; where crowd and close disagree the winner
    # would side with the crowd
    for c in ("rw", "mm"):
        m = D[c].notna().to_numpy() & D["market"].notna().to_numpy() & (D["year"].to_numpy() <= 2023)
        if m.sum() < 10:
            continue
        raw = D[c].to_numpy(float)[m]; y = D["y"].to_numpy(float)[m]; pm = D["market"].to_numpy(float)[m]
        dis = (np.abs(raw - 0.5) > 1e-9) & ((raw > 0.5) != (pm > 0.5))
        k = int(((raw > 0.5) == (y > 0.5))[dis].sum())
        n = int(dis.sum())
        from scipy.stats import beta
        lo, hi = (beta.ppf(0.025, k, n - k + 1) if k else 0.0), (beta.ppf(0.975, k + 1, n - k) if k < n else 1.0)
        out["leak_check_" + c] = {
            "n": int(m.sum()), "crowd_majority_acc": _acc(raw, y), "close_favourite_acc": _acc(pm, y),
            "agree_with_close_favourite": round(float(np.mean((raw > 0.5) == (pm > 0.5))), 4),
            "disagreements": n, "crowd_side_won": k,
            "crowd_side_win_rate": round(k / n, 4) if n else None,
            "crowd_side_win_rate_ci95": [round(float(lo), 3), round(float(hi), 3)]}
        log("leak check %s: %s" % (c, out["leak_check_" + c]))
    return out


def swap_test(D, M2, has):
    """Corner symmetry: swap A and B on a random half of the rows (every expert p -> 1 - p, y -> 1 - y), refit the
    stacks (non-negative and signed crowd weight) and check the predictions flip exactly; also crowd_probs."""
    np, _ = _np()
    rng = np.random.default_rng(11)
    sw = rng.random(len(D)) < 0.5
    D2 = D.copy()
    pcols = ["market", "market_mult", "open", "mkt_rating", "ml", "ml_roll", "ml_stack", "elo_sig", "elo", "engine",
             "feat_lr", "feat_lr_roll", "ml2_static", "ml2lr_static", "ml2_roll", "ml2lr_roll", "ml2s_static",
             "ml2s_roll"] + list(ALL_COLS)
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
        for signed in (False, True):
            m = has[regime] & (yr == 2023)
            p1, w1 = stack_predict(M2, D, cols, "static", 1.5, 2022, m, has[regime], signed)
            p2, w2 = stack_predict(M2, D2, cols, "static", 1.5, 2022, m, has[regime], signed)
            flip = np.where(sw[m], 1 - p2, p2)
            out[regime + (" signed" if signed else "")] = {"max_abs_dp": float(np.max(np.abs(flip - p1))),
                                                           "max_abs_dw": float(np.max(np.abs(w1 - w2)))}
    rec = {"rw": {"n_a": 4, "n_b": 2, "n": 6, "frozen": "pre_event"}, "mm": {"share_a": 0.71, "freeze": "by_design"}}
    rsw = {"rw": {"n_a": 2, "n_b": 4, "n": 6, "frozen": "pre_event"}, "mm": {"share_a": 0.29, "freeze": "by_design"}}
    a, b = crowd_probs(rec), crowd_probs(rsw)
    out["crowd_probs_max_abs(p + p_swapped - 1)"] = max(abs(a[k] + b[k] - 1) for k in a)
    worst = max(max(d["max_abs_dp"], d["max_abs_dw"]) for d in out.values() if isinstance(d, dict))
    assert worst < 1e-5 and out["crowd_probs_max_abs(p + p_swapped - 1)"] < 1e-12, "corner symmetry broken: %s" % out
    log("swap test: worst %.2e" % worst)
    return out


def test_method(CF, stage):
    """Test 3. No permitted source publishes method or round pick shares (RotoWire cells are names; Money MMA's
    contest asks for the method but its free consensus block gives winner shares only), so the crowd's method shares
    cannot enter the method/round model. What can be tested is whether the crowd's winner consensus carries method
    information: S2 (ml2's method/round model: methodround's 6-class logit + competing-risks round hazard, S2 columns,
    C6 = ml2's CV choice) plus three side-oriented crowd columns (crowd logit for X, its absolute value, a presence
    flag; zero where absent), against S2 itself, with and without the ML v2 winner (+ml2win). Same folds as ml2
    (expanding window, scored 2020-2023), same losses; the 2024-25 look fits on < 2024. With +ml2win the winner is
    fixed, so any change is method given the winner."""
    import pickle
    np, pd = _np()
    sys.argv = [sys.argv[0]]
    import ml2 as M2
    import methodround as MR
    S = M2.load_table()
    T2 = S["df"]
    F = pickle.load(open(os.path.join(M2.CACHE, "fit.pkl"), "rb"))
    C = json.load(open(os.path.join(M2.CACHE, "cv.json")))
    Dm = MR.prepare(False)
    T, FX, FY, y = Dm["T"], Dm["FX"], Dm["FY"], Dm["y"]
    assert str(T["date"].max()) < VAULT_FROM
    chosen = M2.jload("methodround.json")["meta"]["chosen"]
    draw_c = chosen["draw_c"]
    try:
        c6 = float(json.load(open(os.path.join(M2.CACHE, "method.json")))["chosen_C6_S2"])
    except Exception:
        c6 = 0.002
    nX, nY, pwin, okz = M2.method_new_cols(T, T2, F, C["lr"]["tau"], C["pre_means"])
    FX2 = pd.concat([FX, nX], axis=1)
    FY2 = pd.concat([FY, nY], axis=1)
    zc = np.zeros(len(T))
    okc = np.zeros(len(T))
    for i, f in enumerate(T["id"]):
        r = CF.get(f)
        if r is not None and str(T["date"].iloc[i]) < VAULT_FROM:
            p = crowd_probs(r).get("crowd")
            if p is not None:
                zc[i] = math.log(p / (1 - p))
                okc[i] = 1.0
    if stage == "cv":
        zc[(T["year"] >= 2024).to_numpy()] = 0.0
        okc[(T["year"] >= 2024).to_numpy()] = 0.0
    # orientation check: methodround's X side must be crowd.json's A (first ufcstats name)
    cm = okc > 0
    agree = float(np.mean((zc[cm] > 0) == (nX["n_z"].to_numpy()[cm] > 0)))
    assert agree > 0.6, "crowd / methodround orientation mismatch (agreement %.3f)" % agree
    FX2["n_zc"], FY2["n_zc"] = zc, -zc
    FX2["n_azc"] = FY2["n_azc"] = np.abs(zc)
    FX2["c_ok"] = FY2["c_ok"] = okc
    stat = Dm["stat_cols"]
    new = list(nX.columns)
    crowd_cols = ["n_zc", "n_azc", "c_ok"]
    yrs = T["year"].to_numpy()
    folds = list(MR.VALID_YEARS) if stage == "cv" else [2024]

    def vmask_of(v):
        return (yrs == v) if v < 2024 else (yrs >= 2024)
    H = np.full((len(T), MR.NC_), np.nan)
    for v in folds:
        tr = (yrs < v) & (yrs >= MR.HAZ_START)
        hz = MR.HazardModel(MR.HAZ_COLS, C=chosen["C_haz"], C_dec=MR.C_DEC).fit(T[tr], FX[tr], FY[tr], y[tr])
        H[vmask_of(v)] = hz.predict(T[vmask_of(v)], FX[vmask_of(v)], FY[vmask_of(v)])

    def run6(cols):
        P6 = np.full((len(T), 6), np.nan)
        for v in folds:
            tr = (yrs < v) & (yrs >= 2012)
            m = MR.C6Logit(cols, C=c6, hl_years=MR.HL_YEARS).fit(T[tr], FX2[tr], FY2[tr], y[tr])
            P6[vmask_of(v)] = m.predict6(T[vmask_of(v)], FX2[vmask_of(v)], FY2[vmask_of(v)])
        return P6
    P = {"S2": run6(stat + new), "S2c": run6(stat + new + crowd_cols)}
    P["S2+ml2win"] = MR.reweight_winner(P["S2"], pwin)
    P["S2c+ml2win"] = MR.reweight_winner(P["S2c"], pwin)
    J = {k: MR.joint_from_c6(v, H, draw_c) for k, v in P.items()}
    sc = np.isin(yrs, MR.VALID_YEARS) if stage == "cv" else (yrs >= 2024)
    sc = sc & (y >= 0)
    out = {"C6": c6, "folds": folds, "crowd_cols": crowd_cols, "orientation_agreement_with_ml2": round(agree, 3),
           "n": int(sc.sum()), "n_covered": int((sc & cm).sum())}
    metrics = ["joint", "method3", "bin7", "winner", "method_given_winner", "finish"]
    for seg, msk in (("all", sc), ("covered", sc & cm)):
        if msk.sum() < 20:
            continue
        L = {k: MR.losses_on(Jk[msk], Dm, msk) for k, Jk in J.items()}
        bt, st = MR.cluster_bootstrap(L, T["event"].to_numpy()[msk], B=2000)
        out[seg] = {"means": {k: {m: round(float(np.nanmean(L[k][m])), 5) for m in metrics if m in L[k]} for k in L},
                    "S2c - S2": MR.paired_diff(L["S2c"], L["S2"], st, metrics),
                    "S2c+ml2win - S2+ml2win": MR.paired_diff(L["S2c+ml2win"], L["S2+ml2win"], st, metrics)}
        for k in ("S2c - S2", "S2c+ml2win - S2+ml2win"):
            d = out[seg][k]
            log("method %-8s %-24s joint %+.5f %s method3 %+.5f %s bin7 %+.5f %s" % (
                seg, k, d["joint"]["diff"], d["joint"]["ci95"], d["method3"]["diff"], d["method3"]["ci95"],
                d["bin7"]["diff"], d["bin7"]["ci95"]))
    if stage == "cv":
        out["cv_gate"] = {}
        for k in ("S2c - S2", "S2c+ml2win - S2+ml2win"):
            d = out["all"][k]["joint"]["diff"]
            out["cv_gate"][k] = {"joint_gain": d, "passes_gate": bool(d < -M2.SEL_MIN),
                                 "method3_gain": out["all"][k]["method3"]["diff"], "bin7_gain": out["all"][k]["bin7"]["diff"]}
    return out


# ====================================================================== forward capture (upcoming cards)
FORWARD_START = "2026-11-07"       # first card of the forward ledger (data/predictions/); earlier 2026 cards = vault


def _slugify(name):
    return re.sub(r"[^a-z0-9]+", "-", norm_name(name)).strip("-")


def _upcoming_event(date, name):
    """The card in data/predictions/cards_upcoming.json on `date` (and matching `name` when several). -> (event, lock
    datetime UTC or None)."""
    try:
        cu = json.load(open(os.path.join(ROOT, "data", "predictions", "cards_upcoming.json")))
    except Exception:
        return None, None
    evs = [e for e in cu.get("events", []) if e.get("date") == date]
    if len(evs) > 1:
        evs = [e for e in evs if norm_name(name) in norm_name(e.get("name", "")) or
               norm_name(e.get("name", "")) in norm_name(name)] or evs
    if not evs:
        return None, None
    e = evs[0]
    ts = [dt.datetime.fromisoformat(v.replace("Z", "+00:00")) for v in (e.get("start_utc") or {}).values() if v]
    return e, (min(ts) if ts else None)


def _orient(src_a, src_b, n_a, n_b, ev, date):
    """Match a source bout to the card's bout; returns (bout_id, ledger a, ledger b, n for ledger a, n for ledger b)."""
    if ev:
        for b in ev.get("bouts", []):
            ca, cb = b["a"]["name"], b["b"]["name"]
            bid = "%s:%s__%s" % (date, b["a"].get("slug") or _slugify(ca), b["b"].get("slug") or _slugify(cb))
            if _pair_score(src_a, src_b, ca, cb) >= 0.8:
                return bid, ca, cb, n_a, n_b
            if _pair_score(src_a, src_b, cb, ca) >= 0.8:
                return bid, ca, cb, n_b, n_a
    return None, src_a, src_b, n_a, n_b


def cmd_capture(args):
    """Capture crowd shares for a card into data/predictions/crowd/ (write-once, like the ledger), oriented to the
    ledger's a / b (cards_upcoming.json) and keyed by its bout_id.
      --source rotowire (default): the RotoWire staff panel (pay-per-views; published 1-3 days before the card).
         A capture made before the card's earliest start_utc is a valid pre-lock input ("before_lock": true).
      --source moneymma: the Money MMA contest consensus. It is published only AFTER the card (the entries locked
         before it), so it is recorded for evaluation only ("use": "evaluation only") and is never a pre-lock input.
    Cards before the forward ledger's first card (FORWARD_START) are 2026 history: they go to the vault (--vault)."""
    ev_name = args.event.strip()
    now = dt.datetime.now(dt.timezone.utc)
    if args.date < FORWARD_START and not args.vault:
        raise SystemExit("%s is before the forward ledger (%s): 2026 history belongs to the vault (pass --vault to "
                         "write it outside the repo)" % (args.date, FORWARD_START))
    ev, lock = _upcoming_event(args.date, ev_name)
    rec = {"event": ev_name, "date": args.date, "captured_utc": now.isoformat(timespec="seconds"), "tool": TOOL_VERSION,
           "source": args.source, "url": None, "published": None, "card_lock_utc": lock.isoformat() if lock else None,
           "bouts": []}
    if args.source == "rotowire":
        rec["before_lock"] = bool(lock and now < lock)
        rec["use"] = "pre-lock stack input" if rec["before_lock"] else "evaluation only (captured after the card started)"
        rec["note"] = "share_a = panel picks for ledger a / picks; P(a) stack input = (n_a + 0.5) / (n + 1)"
        sm = fetch(RW_SITEMAP, refresh=True)
        num = re.search(r"UFC\s*(\d{3})", ev_name, re.I)
        key = ("ufc-%s" % num.group(1)) if num else _slugify(ev_name)
        urls = [u for u in re.findall(r"<loc>(.*?)</loc>", sm) if re.search(r"staff-picks|expert-picks", u) and key in u]
        if urls:
            u = sorted(urls, key=lambda x: int(re.search(r"-(\d+)$", x).group(1)) if re.search(r"-(\d+)$", x) else 0)[-1]
            P = parse_rotowire(fetch(u, refresh=True))
            rec["url"], rec["published"] = u, P["published"]
            for b in P["bouts"]:
                na = sum(1 for t in b["picks"].values() if side_of_pick(t, b["a"], b["b"]) == "A")
                nb = sum(1 for t in b["picks"].values() if side_of_pick(t, b["a"], b["b"]) == "B")
                bid, la, lb, ka, kb = _orient(b["a"], b["b"], na, nb, ev, args.date)
                rec["bouts"].append({"bout_id": bid, "a": la, "b": lb, "n_a": ka, "n_b": kb,
                                     "share_a": round(ka / (ka + kb), 4) if ka + kb else None,
                                     "p_a_input": round((ka + RW_PRIOR) / (ka + kb + 2 * RW_PRIOR), 4) if ka + kb else None,
                                     "picks": b["picks"]})
        else:
            rec["note"] += "; no RotoWire panel article for this card yet (RotoWire covers pay-per-views only)"
    else:
        rec["before_lock"] = False
        rec["use"] = "evaluation only: published after the card (entries locked before it, see 'contest')"
        sm = fetch(MM_SITEMAP, refresh=True)
        slug = args.mm_slug or ("ufc-%s" % re.search(r"UFC\s*(\d{3})", ev_name, re.I).group(1)
                                if re.search(r"UFC\s*(\d{3})", ev_name, re.I) else _slugify(ev_name))
        res = [u for u in re.findall(r"<loc>(.*?)</loc>", sm) if "pick-em-results" in u and slug in u]
        con = [u for u in re.findall(r"<loc>(.*?)</loc>", sm) if "pick" in u and "results" not in u and slug in u]
        if con:
            c = parse_contest(fetch(con[0], refresh=True))
            reg = None
            if ev:
                reg = event_region(ev.get("location", ""), ev_name)
            rec["contest"] = {"url": con[0], "published": c["published"], "lock_text": c["lock_text"],
                              "lock_h_et": c["lock_h"], "status": lock_status(c, args.date, reg)}
        if res:
            P = parse_moneymma(fetch(res[0], refresh=True))
            rec["url"], rec["published"] = res[0], P["published"]
            for name, pct in P["picks"]:
                bid, la, lb = None, name, None
                share = None
                if ev:
                    for b in ev.get("bouts", []):
                        for side, nm in (("a", b["a"]["name"]), ("b", b["b"]["name"])):
                            if _name_score(name, nm) >= 0.86:
                                bid = "%s:%s__%s" % (args.date, b["a"].get("slug") or _slugify(b["a"]["name"]),
                                                     b["b"].get("slug") or _slugify(b["b"]["name"]))
                                la, lb = b["a"]["name"], b["b"]["name"]
                                share = pct if side == "a" else 1 - pct
                rec["bouts"].append({"bout_id": bid, "a": la, "b": lb, "consensus_pick": name, "pct_pick": pct,
                                     "share_a": None if share is None else round(share, 4)})
        else:
            rec["note"] = "no Money MMA results post for this card yet (posted 1-2 days after the card)"
    if args.dry_run:
        print(json.dumps(rec, indent=1))
        return rec
    outdir = VAULT_DIR if args.vault else os.path.join(ROOT, "data", "predictions", "crowd")
    os.makedirs(outdir, exist_ok=True)
    stamp = rec["captured_utc"][:16].replace(":", "").replace("-", "")
    path = os.path.join(outdir, "%s_%s_%s_%s.json" % (args.date, _slugify(ev_name), args.source, stamp))
    if os.path.exists(path):
        raise SystemExit("exists (write-once): %s" % path)
    json.dump(rec, open(path, "w"), indent=1)
    log("captured %d bouts from %s -> %s (%s)" % (len(rec["bouts"]), rec["url"], path, rec["use"]))
    return rec


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
    cp = ('<script type="application/ld+json">{"datePublished": "2025-10-20T04:29:00+00:00"}</script>'
          '<div class="available-content"><p>Next up: UFC 321. All picks must be submitted by 10:00 AM Eastern Sat, '
          'Oct 25th. If you don’t predict ...</p></article>')
    c = parse_contest(cp)
    assert c["lock_md"] == (10, 25) and abs(c["lock_h"] - 10.0) < 1e-9, c
    assert lock_status(c, "2025-10-25", "middle_east") == "lock_verified"
    assert lock_status(c, "2025-10-25", "asia") == "lock_after_bound"          # 10 am ET is after an Asian card
    assert lock_status(c, "2025-11-08", "americas") == "lock_text_inconsistent"  # stale date in the post
    assert lock_status(parse_contest("<p>Continue reading this post for free</p>"), "2025-10-25", "europe") == "paywalled"
    assert event_region("Abu Dhabi, Abu Dhabi, United Arab Emirates", "UFC 321: Aspinall vs. Gane") == "middle_east"
    assert event_region("Las Vegas, Nevada, USA", "UFC 323: Dvalishvili vs. Yan 2") == "americas_ppv"
    mm_drop = {"mm": {"share_a": 0.7, "freeze": "lock_after_bound"}}
    mm_bd = {"mm": {"share_a": 0.7, "freeze": "by_design"}}
    assert "mm" not in crowd_probs(mm_drop) and "mm" in crowd_probs(mm_bd) and "mm" not in crowd_probs(mm_bd, strict=True)
    ok.append("contest lock parser, per-card lock check, freeze categories in crowd_probs")
    card = {"bouts": [{"a": {"name": "Islam Makhachev", "slug": "islam-makhachev"},
                       "b": {"name": "Jack Della Maddalena", "slug": "jack-della-maddalena"}}]}
    bid, la, lb, ka, kb = _orient("Jack Della Maddalena", "Islam Makhachev", 1, 5, card, "2025-11-15")
    assert bid == "2025-11-15:islam-makhachev__jack-della-maddalena" and la == "Islam Makhachev" and (ka, kb) == (5, 1)
    assert _orient("Jon Jones", "Stipe Miocic", 3, 2, card, "2025-11-15")[0] is None
    ok.append("forward capture orients panel counts to the ledger's a / b and uses its bout_id")
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
    e = sp.add_parser("eval")
    e.add_argument("--stage", choices=("cv", "confirm"), required=True)
    e.add_argument("--again", action="store_true", help="confirm only: reproduce an existing one-look block")
    c = sp.add_parser("capture")
    c.add_argument("--event", required=True)
    c.add_argument("--date", required=True, help="event date YYYY-MM-DD")
    c.add_argument("--source", choices=("rotowire", "moneymma"), default="rotowire")
    c.add_argument("--mm-slug", help="Money MMA post slug stem when it is not 'ufc-NNN' (e.g. ufc-vegas-124)")
    c.add_argument("--dry-run", action="store_true", help="print the record, write nothing")
    c.add_argument("--vault", action="store_true", help="write outside the repo (2026 cards before the ledger)")
    sp.add_parser("selftest")
    args = ap.parse_args()
    {"fetch": cmd_fetch, "build": cmd_build, "eval": run_eval, "capture": cmd_capture, "selftest": cmd_selftest}[args.cmd](args)


if __name__ == "__main__":
    main()
