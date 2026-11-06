#!/usr/bin/env python3
"""Pre-UFC record enrichment from Sherdog, and a walk-forward test of whether it helps predict newcomers.

Run from the project root:

    python3 tools/preufc.py crawl     # resolve + fetch Sherdog pages (cached, <= 1 request/second)
    python3 tools/preufc.py build     # parse the cache -> data/derived/preufc.json (records + snapshots)
    python3 tools/preufc.py eval      # held-out test on newcomer fights, adds predictions to preufc.json
    python3 tools/preufc.py all       # build + eval (no network)

Targets: every roster fighter in data/derived/fighters.json plus every fighter who had 0-3 prior UFC
fights in a UFC bout on or after 2019-01-01 (this covers every backtest side with n < 4, and the UFC
debuts that backtest.json leaves out). `--extra-since YYYY-MM-DD` widens the newcomer window.

Resolution of a ufcstats person to a Sherdog page:
  1. graph links: a verified Sherdog page links every opponent; an opponent row that matches one of the
     page owner's ufcstats bouts (date within 3 days, similar name) gives that opponent's Sherdog URL;
  2. otherwise Sherdog's fight finder (name, then first+last, then last name, then nickname), candidates
     ranked by name / nickname / weight and fetched until one verifies.
  A page verifies when its pro history contains the person's ufcstats bouts (date within 3 days and an
  opponent with a similar name): at least min(2, n_ufc) of them and at least half.

Raw HTML is cached under data/raw/sherdog_cache/ (gitignored) and never re-fetched.
Walk-forward rule: a snapshot for a UFC bout counts only Sherdog pro fights dated before that bout's date
(and not the same event), so every feature is known before the fight.
"""
import argparse
import datetime as dt
import difflib
import json
import math
import os
import re
import ssl
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
CACHE = os.path.join(ROOT, "data", "raw", "sherdog_cache")
DERIVED = os.path.join(ROOT, "data", "derived")
RESOLVE = os.path.join(CACHE, "resolve.json")
UA = "FightLabSim/1.0"
BASE = "https://www.sherdog.com"
MIN_GAP = 1.1                      # seconds between requests (<= 1 request/second)
CA = "/root/.ccr/ca-bundle.crt"


# ------------------------------------------------------------------ text helpers
def ascii_fold(s):
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()


def norm(s):
    s = ascii_fold(s).lower().replace("&#039;", "'").replace("&apos;", "'")
    s = re.sub(r"[^a-z0-9 ]+", " ", s.replace("'", ""))
    return re.sub(r"\s+", " ", s).strip()


def toks(s):
    return set(t for t in norm(s).split() if len(t) >= 2)


def name_sim(a, b):
    """0..1 similarity between two person names (order-insensitive, tolerant of middle names)."""
    na, nb = norm(a), norm(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    ta, tb = set(na.split()), set(nb.split())
    jac = len(ta & tb) / max(1, min(len(ta), len(tb)))
    r1 = difflib.SequenceMatcher(None, na, nb).ratio()
    r2 = difflib.SequenceMatcher(None, " ".join(sorted(ta)), " ".join(sorted(tb))).ratio()
    return max(jac * 0.95, r1, r2)


# ------------------------------------------------------------------ polite fetcher
class Fetcher:
    def __init__(self, offline=False):
        self.last = 0.0
        self.n = 0
        self.offline = offline
        self.ctx = ssl.create_default_context(cafile=CA) if os.path.exists(CA) else ssl.create_default_context()

    def get(self, url, path):
        if os.path.exists(path) and os.path.getsize(path) > 0:
            with open(path, encoding="utf-8", errors="replace") as fh:
                return fh.read()
        if self.offline:
            return None
        for attempt in range(4):
            wait = MIN_GAP - (time.time() - self.last)
            if wait > 0:
                time.sleep(wait)
            self.last = time.time()
            self.n += 1
            try:
                req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
                with urllib.request.urlopen(req, context=self.ctx, timeout=30) as r:
                    html = r.read().decode("utf-8", errors="replace")
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, "w", encoding="utf-8") as fh:
                    fh.write(html)
                return html
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    with open(path, "w", encoding="utf-8") as fh:
                        fh.write("<!-- 404 -->")
                    return "<!-- 404 -->"
                time.sleep(5 * (attempt + 1) if e.code in (429, 500, 502, 503, 504) else 2)
            except Exception:
                time.sleep(3 * (attempt + 1))
        return None


def fighter_path(href):
    return os.path.join(CACHE, "fighter", href.rsplit("/", 1)[-1] + ".html")


def search_path(q):
    return os.path.join(CACHE, "search", re.sub(r"[^A-Za-z0-9]+", "_", ascii_fold(q)).strip("_")[:120] + ".html")


# ------------------------------------------------------------------ Sherdog parsing
MONTHS = {m: i for i, m in enumerate(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct",
                                      "Nov", "Dec"], 1)}


def parse_sd_date(s):
    m = re.search(r"([A-Z][a-z]{2})\s*/\s*(\d{1,2})\s*/\s*(\d{4})", s or "")
    if not m or m.group(1) not in MONTHS:
        return None
    try:
        return dt.date(int(m.group(3)), MONTHS[m.group(1)], int(m.group(2)))
    except ValueError:
        return None


def parse_search(html):
    from bs4 import BeautifulSoup
    out = []
    if not html:
        return out
    soup = BeautifulSoup(html, "lxml")
    tab = soup.find("table", class_="fightfinder_result")
    if not tab:
        return out
    for tr in tab.find_all("tr"):
        a = tr.find("a", href=re.compile(r"^/fighter/"))
        if not a:
            continue
        tds = tr.find_all("td")
        txt = [td.get_text(" ", strip=True) for td in tds]
        nick = txt[2].strip('"') if len(txt) > 2 else ""
        lbs = None
        if len(txt) > 4:
            m = re.search(r"(\d+)\s*lbs", txt[4])
            lbs = int(m.group(1)) if m else None
        out.append({"href": a["href"], "name": a.get_text(strip=True), "nick": nick, "lbs": lbs,
                    "assoc": txt[5] if len(txt) > 5 else ""})
    return out


def method_class(m):
    m0 = (m or "").lower()
    if m0.startswith(("ko", "tko")) or "ko" in m0.split(" ")[0]:
        return "ko"
    if m0.startswith("submission") or m0.startswith("technical submission"):
        return "sub"
    if m0.startswith("decision") or m0.startswith("technical decision"):
        return "dec"
    if m0.startswith("dq") or "disqualification" in m0:
        return "dq"
    if m0.startswith("no contest") or m0.startswith("nc"):
        return "nc"
    if m0.startswith("draw"):
        return "dec"
    return "other"


def parse_fighter(html):
    """Bio + fight-history sections of one Sherdog fighter page."""
    from bs4 import BeautifulSoup
    if not html or html.startswith("<!-- 404"):
        return None
    soup = BeautifulSoup(html, "lxml")
    fn = soup.find("span", class_="fn")
    if not fn:
        return None
    bio = {"name": fn.get_text(strip=True)}
    nk = soup.find("span", class_="nickname")
    bio["nick"] = nk.get_text(strip=True).strip('"') if nk else None
    bd = soup.find("span", itemprop="birthDate")
    d = None
    if bd:
        try:
            d = dt.datetime.strptime(bd.get_text(strip=True), "%b %d, %Y").date()
        except ValueError:
            d = None
    bio["dob"] = d.isoformat() if d else None
    na = soup.find("strong", itemprop="nationality")
    bio["nationality"] = na.get_text(strip=True) if na else None
    loc = soup.find("span", class_="locality")
    bio["locality"] = loc.get_text(strip=True) if loc else None
    w = soup.find("b", itemprop="weight")
    m = re.search(r"(\d+)", w.get_text()) if w else None
    bio["lbs"] = int(m.group(1)) if m else None
    h = soup.find("b", itemprop="height")
    bio["height"] = h.get_text(strip=True) if h else None
    asc = soup.find("a", class_="association")
    bio["association"] = asc.get_text(strip=True) if asc else None
    cls = soup.find("div", class_="association-class")
    bio["class"] = None
    if cls:
        a = cls.find("a", href=re.compile(r"weightclass="))
        bio["class"] = a.get_text(strip=True) if a else None
    sections = {}
    for title_div in soup.find_all("div", class_="slanted_title"):
        t = title_div.find("div")
        title = t.get_text(" ", strip=True).upper() if t else ""
        if not title.startswith("FIGHT HISTORY"):
            continue
        kind = title.replace("FIGHT HISTORY", "").strip(" -").lower() or "pro"
        sec = title_div.find_parent("section")
        tab = sec.find("table", class_="fighter") if sec else None
        if tab is None:
            continue
        rows = []
        for tr in tab.find_all("tr"):
            if "table_head" in (tr.get("class") or []):
                continue
            tds = tr.find_all("td")
            if len(tds) < 6:
                continue
            res = tds[0].get_text(strip=True).lower()
            oa = tds[1].find("a")
            ea = tds[2].find("a")
            date = parse_sd_date(tds[2].get_text(" ", strip=True))
            meth_b = tds[3].find("b")
            method = meth_b.get_text(" ", strip=True) if meth_b else tds[3].get_text(" ", strip=True)
            ref = tds[3].find("a", href=re.compile(r"^/referee/"))
            rd = tds[4].get_text(strip=True)
            rows.append({
                "res": {"win": "W", "loss": "L", "draw": "D", "nc": "NC"}.get(res, res.upper()[:3]),
                "opp": oa.get_text(strip=True) if oa else tds[1].get_text(strip=True),
                "opp_href": oa["href"] if oa and oa.get("href", "").startswith("/fighter/") else None,
                "event": ea.get_text(" ", strip=True) if ea else tds[2].get_text(" ", strip=True),
                "event_href": ea["href"] if ea else None,
                "date": date.isoformat() if date else None,
                "method": method, "mclass": method_class(method),
                "ref": ref.get_text(strip=True) if ref else None,
                "rd": int(rd) if rd.isdigit() else None,
                "time": tds[5].get_text(strip=True),
            })
        sections[kind] = sections.get(kind, []) + rows
    return {"bio": bio, "sections": sections}


# ------------------------------------------------------------------ ufcstats side
def load_ufc():
    """Fights (date order) with persons, people dict, and per-person UFC bout lists."""
    import build_db as B
    log = {}
    fights, _ = B.parse_fights(log)
    people = B.build_people(fights, log)
    bouts = defaultdict(list)            # person -> [(date, opp_person, opp_name, fight)]
    for f in fights:
        a, b = f.persons
        if a == b:
            continue
        bouts[a].append((f.date, b, f.names[1], f))
        bouts[b].append((f.date, a, f.names[0], f))
    return fights, people, bouts


def targets(fights, people, newcomer_since, extra_since=None):
    roster = json.load(open(os.path.join(DERIVED, "fighters.json")))["fighters"]
    slug2p = {P["slug"]: p for p, P in people.items()}
    T = set(slug2p[s] for s in roster if s in slug2p)
    since = dt.date.fromisoformat(extra_since or newcomer_since)
    N = Counter()
    for f in fights:
        for p in f.persons:
            if f.date >= since and N[p] <= 3:
                T.add(p)
        for p in f.persons:
            N[p] += 1
    return sorted(p for p in T if not p.startswith(("amb:", "name:")))


def verify(parsed, ub):
    """How many of the person's ufcstats bouts appear in the Sherdog pro history."""
    if not parsed:
        return 0, []
    rows = [r for k, v in parsed["sections"].items() if "amateur" not in k for r in v]
    matched = []
    used = set()
    for (d, q, oname, f) in ub:
        best = None
        for i, r in enumerate(rows):
            if i in used or not r["date"]:
                continue
            rd = dt.date.fromisoformat(r["date"])
            if abs((rd - d).days) > 3:
                continue
            s = name_sim(oname, r["opp"])
            if s >= 0.72 and (best is None or s > best[0]):
                best = (s, i)
        if best:
            used.add(best[1])
            matched.append((f.fid, best[1], q))
    return len(matched), matched


def is_verified(k, n):
    return k >= min(2, n) and k >= 0.5 * n


# ------------------------------------------------------------------ crawl
def crawl(args):
    fights, people, bouts = load_ufc()
    T = targets(fights, people, args.since, args.extra_since)
    if args.limit:
        T = T[:args.limit]
    res = json.load(open(RESOLVE)) if os.path.exists(RESOLVE) else {}
    fx = Fetcher(offline=args.offline)
    links = defaultdict(Counter)        # person -> Counter(sherdog href) from verified opponent pages
    parsed_cache = {}

    def page(href):
        if href not in parsed_cache:
            parsed_cache[href] = parse_fighter(fx.get(BASE + href, fighter_path(href)))
        return parsed_cache[href]

    def harvest(p, href, matched):
        P = page(href)
        rows = [r for k, v in P["sections"].items() if "amateur" not in k for r in v]
        for fid, i, q in matched:
            h = rows[i]["opp_href"]
            if h and not q.startswith(("amb:", "name:")):
                links[q][h] += 1

    # harvest links from pages already resolved in earlier runs
    for p, r in res.items():
        if r.get("href") and r.get("status") == "ok":
            k, matched = verify(page(r["href"]), bouts[p])
            harvest(p, r["href"], matched)

    def try_href(p, href, how):
        P = page(href)
        k, matched = verify(P, bouts[p])
        n = len(bouts[p])
        if is_verified(k, n):
            res[p] = {"href": href, "status": "ok", "how": how, "matched": k, "n_ufc": n,
                      "name": people[p]["name"], "slug": people[p]["slug"]}
            harvest(p, href, matched)
            return True
        return False

    def search_resolve(p):
        P = people[p]
        name = P["name"]
        T_ = P.get("tott") or {}
        lbs = T_.get("lbs")
        nick = P.get("nick")
        tk = norm(name).split()
        queries = [name]
        if len(tk) > 2:
            queries.append(tk[0] + " " + tk[-1])
        if len(tk) >= 2:
            queries.append(tk[-1])
        if nick:
            queries.append(nick)
        tried = set()
        for q in queries:
            html = fx.get(BASE + "/stats/fightfinder?" + urllib.parse.urlencode({"SearchTxt": q}),
                          search_path(q))
            cands = parse_search(html)
            scored = []
            for c in cands:
                if c["href"] in tried:
                    continue
                s = name_sim(name, c["name"])
                if q == nick:
                    s = max(s, 0.6 if norm(c["nick"]) == norm(nick) else 0)
                if nick and c["nick"] and norm(c["nick"]) == norm(nick):
                    s += 0.25
                if lbs and c["lbs"]:
                    s -= min(0.3, abs(c["lbs"] - lbs) / 100.0)
                scored.append((s, c["href"]))
            scored.sort(reverse=True)
            for s, href in scored[:4]:
                if s < 0.55:
                    break
                tried.add(href)
                if try_href(p, href, "search:" + q):
                    return True
        res[p] = {"href": None, "status": "unresolved", "n_ufc": len(bouts[p]), "name": name,
                  "slug": P["slug"], "tried": sorted(tried)}
        return False

    pending = [p for p in T if res.get(p, {}).get("status") != "ok"
               and not (res.get(p, {}).get("status") == "unresolved" and not args.retry)]
    pending.sort(key=lambda p: -len(bouts[p]))
    print("targets %d; already resolved %d; pending %d" % (len(T), sum(1 for p in T if res.get(p, {}).get("status") == "ok"),
                                                           len(pending)), flush=True)
    t0 = time.time()
    done = 0
    while pending:
        # cheap first: anyone with a graph link
        linked = [p for p in pending if links[p]]
        if linked:
            p = linked[0]
            ok = False
            for href, _ in links[p].most_common(2):
                if try_href(p, href, "link"):
                    ok = True
                    break
            if not ok:
                search_resolve(p)
        else:
            p = pending[0]
            search_resolve(p)
        pending.remove(p)
        done += 1
        if done % 25 == 0:
            json.dump(res, open(RESOLVE, "w"), indent=0)
            okn = sum(1 for p in T if res.get(p, {}).get("status") == "ok")
            print("%5d done, %d ok, %d requests, %.0f s, %d pending" % (done, okn, fx.n, time.time() - t0,
                                                                        len(pending)), flush=True)
    json.dump(res, open(RESOLVE, "w"), indent=0)
    okn = sum(1 for p in T if res.get(p, {}).get("status") == "ok")
    print("finished: %d targets, %d resolved, %d requests, %.0f s" % (len(T), okn, fx.n, time.time() - t0))


# ------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("cmd", choices=["crawl", "build", "eval", "all"])
    ap.add_argument("--since", default="2019-01-01", help="newcomer window start (bouts with <= 3 prior UFC fights)")
    ap.add_argument("--extra-since", default=None, help="widen the newcomer window (e.g. 2015-01-01)")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--retry", action="store_true", help="retry unresolved targets")
    args = ap.parse_args()
    if args.cmd == "crawl":
        crawl(args)
    elif args.cmd in ("build", "all"):
        build(args)
        if args.cmd == "all":
            evaluate(args)
    elif args.cmd == "eval":
        evaluate(args)


if __name__ == "__main__":
    main()
