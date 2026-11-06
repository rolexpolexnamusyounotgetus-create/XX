#!/usr/bin/env python3
"""Fight-week context for every UFC fight 2012-2026, and a walk-forward check of its value beyond Elo.

Run from the project root:

    python3 tools/fightweek.py fetch-wiki      # Wikipedia event articles (cached, <= 1 request/second)
    python3 tools/fightweek.py fetch-geo       # Open-Meteo geocoding for every venue city (cached)
    python3 tools/fightweek.py fetch-sherdog   # Sherdog fighter pages for nationality gaps (cached)
    python3 tools/fightweek.py build           # parse caches -> data/derived/fightweek.json (no network)
    python3 tools/fightweek.py eval            # walk-forward check (train 2012-2023, validate 2024-2025)
    python3 tools/fightweek.py all             # build + eval (no network)

Sources (all cached raw under data/raw/web_cache/<site>/, gitignored):
  * en.wikipedia.org article HTML (/wiki/<title>): "List of UFC events" (venue, city, attendance) and each
    event article (infobox, Background / bout-change prose, results table, notes). robots.txt disallows
    /w/ and /api/ (the action and REST APIs) for generic agents, so the tool reads the allowed /wiki/
    article pages instead.
  * geocoding-api.open-meteo.com (no robots.txt): city latitude, longitude, elevation, IANA time zone.
    api.open-meteo.com disallows everything in robots.txt and is not used.
  * data/raw/wikidata_mma_people.csv (Wikidata CC0, already in the repo): country for sport, citizenship,
    birth country, Sherdog id. query.wikidata.org disallows /sparql in robots.txt, so it is not re-queried.
  * www.sherdog.com fighter pages (robots.txt allows all): nationality, birthplace, association.
    Pages already cached by tools/preufc.py (data/raw/sherdog_cache/) are read first.
  Tapology's robots.txt bars AI agents and ufc.com refuses the generic agent; neither is used.

Walk-forward safety: every feature is known before the fight starts (weigh-in results, bout changes,
venue, crowd policy, nationality). Nothing from the fight itself or later (results, bonuses, attendance
counts, post-fight news) enters a feature. Nationality and gym are a current snapshot of slow-moving
attributes (see research/data_fightweek.md).
"""
import argparse
import datetime as dt
import difflib
import html as htmlmod
import json
import math
import os
import re
import sys
import time
import unicodedata
import urllib.parse
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
RAW = os.path.join(ROOT, "data", "raw")
CACHE = os.path.join(RAW, "web_cache")
WIKI_DIR = os.path.join(CACHE, "wikipedia")
GEO_DIR = os.path.join(CACHE, "open-meteo")
SD_DIR = os.path.join(CACHE, "sherdog")
SD_OLD = os.path.join(RAW, "sherdog_cache")
DERIVED = os.path.join(ROOT, "data", "derived")
OUT = os.path.join(DERIVED, "fightweek.json")
OUT_NAT = os.path.join(DERIVED, "nationality.json")
UA = "FightLabSim/1.0 (private research)"
CA = "/root/.ccr/ca-bundle.crt"
SINCE = dt.date(2012, 1, 1)


def log(*a):
    print(*a, flush=True)


# ------------------------------------------------------------------ polite fetcher (one per site)
class Fetcher:
    def __init__(self, min_gap=1.1, offline=False):
        import requests
        self.s = requests.Session()
        self.s.headers.update({"User-Agent": UA})
        self.verify = CA if os.path.exists(CA) else True
        self.min_gap = min_gap
        self.last = 0.0
        self.n = 0
        self.offline = offline

    def get(self, url, path, accept="text/html"):
        if os.path.exists(path) and os.path.getsize(path) > 0:
            with open(path, encoding="utf-8", errors="replace") as fh:
                return fh.read()
        if self.offline:
            return None
        for attempt in range(4):
            wait = self.min_gap - (time.time() - self.last)
            if wait > 0:
                time.sleep(wait)
            self.last = time.time()
            self.n += 1
            try:
                r = self.s.get(url, timeout=60, verify=self.verify, headers={"Accept": accept})
            except Exception as e:  # network hiccup: back off and retry
                log("  fetch error", url, e)
                time.sleep(3 * (attempt + 1))
                continue
            if r.status_code == 200:
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, "w", encoding="utf-8") as fh:
                    fh.write(r.text)
                return r.text
            if r.status_code == 404:
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, "w", encoding="utf-8") as fh:
                    fh.write("<!-- 404 -->")
                return "<!-- 404 -->"
            log("  HTTP", r.status_code, url)
            time.sleep(10 * (attempt + 1) if r.status_code in (429, 500, 502, 503, 504) else 3)
        return None


# ------------------------------------------------------------------ text helpers
def fold(s):
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()


def norm(s):
    s = fold(s).lower().replace("'", "").replace("’", "")
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def wiki_path(title):
    return os.path.join(WIKI_DIR, title.replace("/", "%2F")[:200] + ".html")


def title_of(href):
    t = href.split("/wiki/", 1)[-1].split("#")[0]
    return urllib.parse.unquote(t)


# ------------------------------------------------------------------ ufcstats side
def load_ufcstats():
    """Events and bouts 2012+ from the raw ufcstats CSVs (one copy per fight URL)."""
    import pandas as pd
    ev = pd.read_csv(os.path.join(RAW, "ufc_event_details.csv"))
    ev["EVENT"] = ev["EVENT"].str.strip()
    ev["date"] = pd.to_datetime(ev["DATE"].str.strip(), format="%B %d, %Y").dt.date
    res = pd.read_csv(os.path.join(RAW, "ufc_fight_results.csv"))
    for c in res.columns:
        if res[c].dtype == object:
            res[c] = res[c].str.strip()
    res["idx"] = range(len(res))
    known = set(ev["EVENT"])
    res["known"] = res["EVENT"].isin(known)
    res = (res.sort_values(["known", "idx"], ascending=[False, True])
              .drop_duplicates("URL", keep="first").sort_values("idx"))
    events = {}
    for e in ev.itertuples(index=False):
        if e.date >= SINCE:
            events[e.EVENT] = {"event": e.EVENT, "date": e.date, "location": e.LOCATION.strip(),
                               "ufcstats_event_id": e.URL.rstrip("/").rsplit("/", 1)[-1], "bouts": []}
    for r in res.itertuples(index=False):
        if r.EVENT not in events:
            continue
        names = [x.strip() for x in r.BOUT.split(" vs. ")]
        if len(names) != 2:
            continue
        events[r.EVENT]["bouts"].append({
            "fid": r.URL.rstrip("/").rsplit("/", 1)[-1], "A": names[0], "B": names[1],
            "wc": r.WEIGHTCLASS, "outcome": r.OUTCOME, "idx": int(r.idx)})
    return events


# ------------------------------------------------------------------ Wikipedia: list of events
def parse_table_rows(table):
    """Rows of a wikitable as lists of cell elements, with rowspan/colspan expanded."""
    grid = []
    pending = {}  # col -> (cell, rows_left)
    for tr in table.find_all("tr"):
        cells = tr.find_all(["td", "th"], recursive=False)
        row = []
        col = 0
        ci = 0
        while ci < len(cells) or col in pending:
            if col in pending:
                cell, left = pending[col]
                row.append(cell)
                if left <= 1:
                    del pending[col]
                else:
                    pending[col] = (cell, left - 1)
                col += 1
                continue
            cell = cells[ci]
            ci += 1
            span = int(re.sub(r"\D", "", cell.get("colspan", "1")) or 1)
            rs = int(re.sub(r"\D", "", cell.get("rowspan", "1")) or 1)
            for _ in range(span):
                row.append(cell)
                if rs > 1:
                    pending[col] = (cell, rs - 1)
                col += 1
        grid.append(row)
    return grid


def parse_event_list(html):
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "lxml")
    out = []
    for t in soup.find_all("table", class_="wikitable"):
        grid = parse_table_rows(t)
        if not grid:
            continue
        head = [c.get_text(" ", strip=True) for c in grid[0]]
        if "Event" not in head or "Date" not in head:
            continue
        ix = {h: i for i, h in enumerate(head)}
        for row in grid[1:]:
            if len(row) < len(head):
                continue
            ecell = row[ix["Event"]]
            a = ecell.find("a")
            name = ecell.get_text(" ", strip=True)
            dtxt = row[ix["Date"]].get_text(" ", strip=True)
            try:
                d = dt.datetime.strptime(re.sub(r"\s+", " ", dtxt), "%b %d, %Y").date()
            except ValueError:
                continue
            venue_cell = row[ix["Venue"]] if "Venue" in ix else None
            loc_cell = row[ix["Location"]] if "Location" in ix else None
            att = row[ix["Attendance"]].get_text(" ", strip=True) if "Attendance" in ix else None
            out.append({
                "name": re.sub(r"\s+", " ", name),
                "date": d.isoformat(),
                "href": a.get("href") if a else None,
                "venue": venue_cell.get_text(" ", strip=True) if venue_cell else None,
                "venue_href": (venue_cell.find("a") or {}).get("href") if venue_cell else None,
                "location": re.sub(r"\s+,", ",", loc_cell.get_text(" ", strip=True)) if loc_cell else None,
                "attendance": att,
                "past": "Attendance" in ix,
            })
    return out


def name_sim(a, b):
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


def match_events(events, wl):
    """ufcstats event name -> Wikipedia list row (same date, or +-1 day with a similar name)."""
    byd = defaultdict(list)
    for w in wl:
        byd[w["date"]].append(w)
    out, how = {}, Counter()
    for name, e in events.items():
        d = e["date"]
        best = None
        for off in (0, -1, 1):
            cands = byd.get((d + dt.timedelta(days=off)).isoformat(), [])
            for w in cands:
                s = event_name_sim(name, w["name"])
                if off != 0 and s < 0.8:
                    continue
                key = (off == 0, s)
                if best is None or key > best[0]:
                    best = (key, w)
        if best:
            out[name] = best[1]
            how["same date" if best[0][0] else "+-1 day"] += 1
        else:
            how["unmatched"] += 1
    return out, how


def event_name_sim(a, b):
    """Names like 'UFC Fight Night: X vs. Y' / 'UFC on ESPN: X vs. Y'; the headliners decide."""
    def core(s):
        s = s.split(":", 1)[-1] if ":" in s else s
        return norm(s)
    na, nb = norm(a), norm(b)
    if na == nb:
        return 1.0
    ma, mb = re.match(r"ufc (\d+)\b", na), re.match(r"ufc (\d+)\b", nb)
    if ma and mb:
        return 1.0 if ma.group(1) == mb.group(1) else 0.0
    return max(difflib.SequenceMatcher(None, core(a), core(b)).ratio(), 0.9 * name_sim(core(a), core(b)))


def cmd_fetch_wiki(args):
    fx = Fetcher(min_gap=1.1, offline=args.offline)
    lst = fx.get("https://en.wikipedia.org/wiki/List_of_UFC_events", wiki_path("List_of_UFC_events"))
    wl = parse_event_list(lst)
    events = load_ufcstats()
    m, how = match_events(events, wl)
    log("wiki list rows %d; ufcstats events %d; matched %s" % (len(wl), len(events), dict(how)))
    todo = []
    for name, e in sorted(events.items(), key=lambda kv: kv[1]["date"]):
        w = m.get(name)
        if not w or not w.get("href"):
            continue
        todo.append(title_of(w["href"]))
    todo = list(dict.fromkeys(todo))
    log("event articles to fetch: %d (cached: %d)" % (
        len(todo), sum(1 for t in todo if os.path.exists(wiki_path(t)))))
    t0 = time.time()
    for i, t in enumerate(todo):
        fx.get("https://en.wikipedia.org/wiki/" + urllib.parse.quote(t.replace(" ", "_"), safe=":_.,()'!-"),
               wiki_path(t))
        if (i + 1) % 50 == 0:
            log("  %d/%d, %d requests, %.0f s" % (i + 1, len(todo), fx.n, time.time() - t0))
    log("done: %d requests" % fx.n)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["fetch-wiki", "fetch-geo", "fetch-sherdog", "build", "eval", "all"])
    ap.add_argument("--offline", action="store_true")
    args = ap.parse_args()
    if args.cmd == "fetch-wiki":
        cmd_fetch_wiki(args)
    elif args.cmd == "fetch-geo":
        cmd_fetch_geo(args)
    elif args.cmd == "fetch-sherdog":
        cmd_fetch_sherdog(args)
    elif args.cmd == "build":
        cmd_build(args)
    elif args.cmd == "eval":
        cmd_eval(args)
    else:
        cmd_build(args)
        cmd_eval(args)


if __name__ == "__main__":
    main()
