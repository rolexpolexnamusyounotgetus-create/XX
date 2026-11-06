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
        if not pd.api.types.is_numeric_dtype(res[c]):
            res[c] = res[c].astype(str).str.strip()
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


# ------------------------------------------------------------------ countries
# ISO3: (ISO2, English name, aliases, representative IANA zone for a fighter whose base is unknown,
#        continent). The zone is the most populous one (USA: Chicago, a compromise between coasts;
#        Russia: Moscow, which also covers Dagestan and Chechnya; Brazil: Sao Paulo).
COUNTRIES = {
    "USA": ("US", "United States", ["usa", "u s", "us", "united states of america", "america", "puerto rico"],
            "America/Chicago", "NA"),
    "CAN": ("CA", "Canada", [], "America/Toronto", "NA"),
    "MEX": ("MX", "Mexico", [], "America/Mexico_City", "NA"),
    "BRA": ("BR", "Brazil", ["brasil"], "America/Sao_Paulo", "SA"),
    "ARG": ("AR", "Argentina", [], "America/Argentina/Buenos_Aires", "SA"),
    "CHL": ("CL", "Chile", [], "America/Santiago", "SA"),
    "URY": ("UY", "Uruguay", [], "America/Montevideo", "SA"),
    "PRY": ("PY", "Paraguay", [], "America/Asuncion", "SA"),
    "PER": ("PE", "Peru", [], "America/Lima", "SA"),
    "BOL": ("BO", "Bolivia", [], "America/La_Paz", "SA"),
    "ECU": ("EC", "Ecuador", [], "America/Guayaquil", "SA"),
    "COL": ("CO", "Colombia", [], "America/Bogota", "SA"),
    "VEN": ("VE", "Venezuela", [], "America/Caracas", "SA"),
    "GUY": ("GY", "Guyana", [], "America/Guyana", "SA"),
    "SUR": ("SR", "Suriname", [], "America/Paramaribo", "SA"),
    "PAN": ("PA", "Panama", [], "America/Panama", "NA"),
    "CRI": ("CR", "Costa Rica", [], "America/Costa_Rica", "NA"),
    "NIC": ("NI", "Nicaragua", [], "America/Managua", "NA"),
    "HND": ("HN", "Honduras", [], "America/Tegucigalpa", "NA"),
    "SLV": ("SV", "El Salvador", [], "America/El_Salvador", "NA"),
    "GTM": ("GT", "Guatemala", [], "America/Guatemala", "NA"),
    "CUB": ("CU", "Cuba", [], "America/Havana", "NA"),
    "DOM": ("DO", "Dominican Republic", [], "America/Santo_Domingo", "NA"),
    "HTI": ("HT", "Haiti", [], "America/Port-au-Prince", "NA"),
    "JAM": ("JM", "Jamaica", [], "America/Jamaica", "NA"),
    "TTO": ("TT", "Trinidad and Tobago", ["trinidad"], "America/Port_of_Spain", "NA"),
    "BHS": ("BS", "Bahamas", ["the bahamas"], "America/Nassau", "NA"),
    "GRD": ("GD", "Grenada", [], "America/Grenada", "NA"),
    "CUW": ("CW", "Curacao", [], "America/Curacao", "NA"),
    "BRB": ("BB", "Barbados", [], "America/Barbados", "NA"),
    "GBR": ("GB", "United Kingdom", ["uk", "great britain", "england", "scotland", "wales", "northern ireland",
                                     "britain"], "Europe/London", "EU"),
    "IRL": ("IE", "Ireland", ["republic of ireland"], "Europe/Dublin", "EU"),
    "FRA": ("FR", "France", [], "Europe/Paris", "EU"),
    "DEU": ("DE", "Germany", [], "Europe/Berlin", "EU"),
    "NLD": ("NL", "Netherlands", ["holland", "the netherlands"], "Europe/Amsterdam", "EU"),
    "BEL": ("BE", "Belgium", [], "Europe/Brussels", "EU"),
    "LUX": ("LU", "Luxembourg", [], "Europe/Luxembourg", "EU"),
    "CHE": ("CH", "Switzerland", [], "Europe/Zurich", "EU"),
    "AUT": ("AT", "Austria", [], "Europe/Vienna", "EU"),
    "LIE": ("LI", "Liechtenstein", [], "Europe/Vaduz", "EU"),
    "ITA": ("IT", "Italy", [], "Europe/Rome", "EU"),
    "ESP": ("ES", "Spain", [], "Europe/Madrid", "EU"),
    "PRT": ("PT", "Portugal", [], "Europe/Lisbon", "EU"),
    "DNK": ("DK", "Denmark", [], "Europe/Copenhagen", "EU"),
    "SWE": ("SE", "Sweden", [], "Europe/Stockholm", "EU"),
    "NOR": ("NO", "Norway", [], "Europe/Oslo", "EU"),
    "FIN": ("FI", "Finland", [], "Europe/Helsinki", "EU"),
    "ISL": ("IS", "Iceland", [], "Atlantic/Reykjavik", "EU"),
    "POL": ("PL", "Poland", [], "Europe/Warsaw", "EU"),
    "CZE": ("CZ", "Czech Republic", ["czechia"], "Europe/Prague", "EU"),
    "SVK": ("SK", "Slovakia", [], "Europe/Bratislava", "EU"),
    "HUN": ("HU", "Hungary", [], "Europe/Budapest", "EU"),
    "ROU": ("RO", "Romania", [], "Europe/Bucharest", "EU"),
    "BGR": ("BG", "Bulgaria", [], "Europe/Sofia", "EU"),
    "GRC": ("GR", "Greece", [], "Europe/Athens", "EU"),
    "CYP": ("CY", "Cyprus", [], "Asia/Nicosia", "EU"),
    "SVN": ("SI", "Slovenia", [], "Europe/Ljubljana", "EU"),
    "HRV": ("HR", "Croatia", [], "Europe/Zagreb", "EU"),
    "BIH": ("BA", "Bosnia and Herzegovina", ["bosnia", "bosnia herzegovina"], "Europe/Sarajevo", "EU"),
    "SRB": ("RS", "Serbia", [], "Europe/Belgrade", "EU"),
    "MNE": ("ME", "Montenegro", [], "Europe/Podgorica", "EU"),
    "MKD": ("MK", "North Macedonia", ["macedonia"], "Europe/Skopje", "EU"),
    "ALB": ("AL", "Albania", [], "Europe/Tirane", "EU"),
    "XKX": ("XK", "Kosovo", [], "Europe/Belgrade", "EU"),
    "MDA": ("MD", "Moldova", [], "Europe/Chisinau", "EU"),
    "UKR": ("UA", "Ukraine", [], "Europe/Kyiv", "EU"),
    "BLR": ("BY", "Belarus", [], "Europe/Minsk", "EU"),
    "LTU": ("LT", "Lithuania", [], "Europe/Vilnius", "EU"),
    "LVA": ("LV", "Latvia", [], "Europe/Riga", "EU"),
    "EST": ("EE", "Estonia", [], "Europe/Tallinn", "EU"),
    "RUS": ("RU", "Russia", ["russian federation"], "Europe/Moscow", "EU"),
    "GEO": ("GE", "Georgia", [], "Asia/Tbilisi", "AS"),
    "ARM": ("AM", "Armenia", [], "Asia/Yerevan", "AS"),
    "AZE": ("AZ", "Azerbaijan", [], "Asia/Baku", "AS"),
    "TUR": ("TR", "Turkey", ["turkiye"], "Europe/Istanbul", "AS"),
    "KAZ": ("KZ", "Kazakhstan", [], "Asia/Almaty", "AS"),
    "UZB": ("UZ", "Uzbekistan", [], "Asia/Tashkent", "AS"),
    "KGZ": ("KG", "Kyrgyzstan", [], "Asia/Bishkek", "AS"),
    "TJK": ("TJ", "Tajikistan", [], "Asia/Dushanbe", "AS"),
    "TKM": ("TM", "Turkmenistan", [], "Asia/Ashgabat", "AS"),
    "AFG": ("AF", "Afghanistan", [], "Asia/Kabul", "AS"),
    "IRN": ("IR", "Iran", [], "Asia/Tehran", "AS"),
    "IRQ": ("IQ", "Iraq", [], "Asia/Baghdad", "AS"),
    "SYR": ("SY", "Syria", [], "Asia/Damascus", "AS"),
    "LBN": ("LB", "Lebanon", [], "Asia/Beirut", "AS"),
    "JOR": ("JO", "Jordan", [], "Asia/Amman", "AS"),
    "ISR": ("IL", "Israel", [], "Asia/Jerusalem", "AS"),
    "PSE": ("PS", "Palestine", [], "Asia/Hebron", "AS"),
    "SAU": ("SA", "Saudi Arabia", [], "Asia/Riyadh", "AS"),
    "ARE": ("AE", "United Arab Emirates", ["uae"], "Asia/Dubai", "AS"),
    "QAT": ("QA", "Qatar", [], "Asia/Qatar", "AS"),
    "BHR": ("BH", "Bahrain", [], "Asia/Bahrain", "AS"),
    "KWT": ("KW", "Kuwait", [], "Asia/Kuwait", "AS"),
    "OMN": ("OM", "Oman", [], "Asia/Muscat", "AS"),
    "PAK": ("PK", "Pakistan", [], "Asia/Karachi", "AS"),
    "IND": ("IN", "India", [], "Asia/Kolkata", "AS"),
    "NPL": ("NP", "Nepal", [], "Asia/Kathmandu", "AS"),
    "LKA": ("LK", "Sri Lanka", [], "Asia/Colombo", "AS"),
    "BGD": ("BD", "Bangladesh", [], "Asia/Dhaka", "AS"),
    "MMR": ("MM", "Myanmar", ["burma"], "Asia/Yangon", "AS"),
    "THA": ("TH", "Thailand", [], "Asia/Bangkok", "AS"),
    "KHM": ("KH", "Cambodia", [], "Asia/Phnom_Penh", "AS"),
    "VNM": ("VN", "Vietnam", [], "Asia/Ho_Chi_Minh", "AS"),
    "MYS": ("MY", "Malaysia", [], "Asia/Kuala_Lumpur", "AS"),
    "SGP": ("SG", "Singapore", [], "Asia/Singapore", "AS"),
    "IDN": ("ID", "Indonesia", [], "Asia/Jakarta", "AS"),
    "PHL": ("PH", "Philippines", ["the philippines"], "Asia/Manila", "AS"),
    "CHN": ("CN", "China", ["people s republic of china", "peoples republic of china"], "Asia/Shanghai", "AS"),
    "HKG": ("HK", "Hong Kong", [], "Asia/Hong_Kong", "AS"),
    "MAC": ("MO", "Macau", ["macao"], "Asia/Macau", "AS"),
    "TWN": ("TW", "Taiwan", [], "Asia/Taipei", "AS"),
    "MNG": ("MN", "Mongolia", [], "Asia/Ulaanbaatar", "AS"),
    "KOR": ("KR", "South Korea", ["korea", "republic of korea", "korea south"], "Asia/Seoul", "AS"),
    "JPN": ("JP", "Japan", [], "Asia/Tokyo", "AS"),
    "AUS": ("AU", "Australia", [], "Australia/Sydney", "OC"),
    "NZL": ("NZ", "New Zealand", [], "Pacific/Auckland", "OC"),
    "FJI": ("FJ", "Fiji", [], "Pacific/Fiji", "OC"),
    "WSM": ("WS", "Samoa", [], "Pacific/Apia", "OC"),
    "TON": ("TO", "Tonga", [], "Pacific/Tongatapu", "OC"),
    "PNG": ("PG", "Papua New Guinea", [], "Pacific/Port_Moresby", "OC"),
    "VUT": ("VU", "Vanuatu", [], "Pacific/Efate", "OC"),
    "FSM": ("FM", "Micronesia", [], "Pacific/Pohnpei", "OC"),
    "GUM": ("GU", "Guam", [], "Pacific/Guam", "OC"),
    "MNP": ("MP", "Northern Mariana Islands", ["saipan"], "Pacific/Saipan", "OC"),
    "ZAF": ("ZA", "South Africa", [], "Africa/Johannesburg", "AF"),
    "NGA": ("NG", "Nigeria", [], "Africa/Lagos", "AF"),
    "CMR": ("CM", "Cameroon", [], "Africa/Douala", "AF"),
    "COD": ("CD", "DR Congo", ["democratic republic of the congo", "congo kinshasa", "dr congo", "drc",
                               "congo the democratic republic of the"],
            "Africa/Kinshasa", "AF"),
    "COG": ("CG", "Republic of the Congo", ["congo", "congo brazzaville"], "Africa/Brazzaville", "AF"),
    "AGO": ("AO", "Angola", [], "Africa/Luanda", "AF"),
    "CIV": ("CI", "Ivory Coast", ["cote d ivoire", "cote divoire"], "Africa/Abidjan", "AF"),
    "GHA": ("GH", "Ghana", [], "Africa/Accra", "AF"),
    "SEN": ("SN", "Senegal", [], "Africa/Dakar", "AF"),
    "GIN": ("GN", "Guinea", [], "Africa/Conakry", "AF"),
    "CPV": ("CV", "Cape Verde", ["cabo verde"], "Atlantic/Cape_Verde", "AF"),
    "MAR": ("MA", "Morocco", [], "Africa/Casablanca", "AF"),
    "DZA": ("DZ", "Algeria", [], "Africa/Algiers", "AF"),
    "TUN": ("TN", "Tunisia", [], "Africa/Tunis", "AF"),
    "LBY": ("LY", "Libya", [], "Africa/Tripoli", "AF"),
    "EGY": ("EG", "Egypt", [], "Africa/Cairo", "AF"),
    "ETH": ("ET", "Ethiopia", [], "Africa/Addis_Ababa", "AF"),
    "SOM": ("SO", "Somalia", [], "Africa/Mogadishu", "AF"),
    "KEN": ("KE", "Kenya", [], "Africa/Nairobi", "AF"),
    "UGA": ("UG", "Uganda", [], "Africa/Kampala", "AF"),
    "TZA": ("TZ", "Tanzania", [], "Africa/Dar_es_Salaam", "AF"),
    "RWA": ("RW", "Rwanda", [], "Africa/Kigali", "AF"),
    "ZMB": ("ZM", "Zambia", [], "Africa/Lusaka", "AF"),
    "ZWE": ("ZW", "Zimbabwe", [], "Africa/Harare", "AF"),
    "MOZ": ("MZ", "Mozambique", [], "Africa/Maputo", "AF"),
    "NAM": ("NA", "Namibia", [], "Africa/Windhoek", "AF"),
    "BWA": ("BW", "Botswana", [], "Africa/Gaborone", "AF"),
    "MUS": ("MU", "Mauritius", [], "Indian/Mauritius", "AF"),
    "GAB": ("GA", "Gabon", [], "Africa/Libreville", "AF"),
    "BEN": ("BJ", "Benin", [], "Africa/Porto-Novo", "AF"),
    "TGO": ("TG", "Togo", [], "Africa/Lome", "AF"),
    "SLE": ("SL", "Sierra Leone", [], "Africa/Freetown", "AF"),
    "LBR": ("LR", "Liberia", [], "Africa/Monrovia", "AF"),
    "MLI": ("ML", "Mali", [], "Africa/Bamako", "AF"),
    "SDN": ("SD", "Sudan", [], "Africa/Khartoum", "AF"),
}
# historical states -> successor used when nothing better is known
HISTORIC = {"SUN": "RUS", "YUG": "SRB", "SCG": "SRB", "CSK": "CZE", "DDR": "DEU"}


def _country_index():
    idx = {}
    for iso3, (iso2, name, aliases, tz, cont) in COUNTRIES.items():
        for k in [iso3.lower(), iso2.lower(), name] + aliases:
            idx[norm(k)] = iso3
    return idx


CIDX = _country_index()


def country_code(s):
    """Any country spelling (ufcstats, Sherdog, Wikidata ISO3) -> ISO3, or None."""
    if not s:
        return None
    if s in HISTORIC:
        return HISTORIC[s]
    if s in COUNTRIES:
        return s
    return CIDX.get(norm(s))


def split_location(loc):
    """'Las Vegas, Nevada, USA' -> ('Las Vegas', 'Nevada', 'USA')."""
    parts = [p.strip() for p in loc.split(",") if p.strip()]
    city = parts[0]
    country = parts[-1] if len(parts) > 1 else parts[0]
    admin = parts[1] if len(parts) > 2 else None
    if city == "Washington" and admin == "DC":
        admin = "District of Columbia"
    return city, admin, country


def geo_path(key):
    return os.path.join(GEO_DIR, re.sub(r"[^A-Za-z0-9]+", "_", fold(key)).strip("_")[:150] + ".json")


GEO_FIX = {  # city names the geocoder spells differently
    "New York City": "New York", "Kallang": "Singapore", "Saint Petersburg": "Saint Petersburg",
    "Fort Campbell": "Fort Campbell North", "Elmont": "Elmont", "St. Louis": "St Louis",
    "Quebec City": "Quebec",
}
GEO_ISO_FIX = {"Macau": "MAC"}      # ufcstats files Macau under China; the geocoder under MO


def geocode(fx, city, admin, iso3):
    """Best Open-Meteo geocoder hit for a city in a country (admin region as a tiebreak)."""
    iso3 = GEO_ISO_FIX.get(city, iso3)
    iso2 = COUNTRIES[iso3][0] if iso3 in COUNTRIES else None
    q = GEO_FIX.get(city, city)
    key = "%s__%s" % (q, iso2 or "XX")
    url = ("https://geocoding-api.open-meteo.com/v1/search?" +
           urllib.parse.urlencode({"name": q, "count": 20, "language": "en", "format": "json"} |
                                  ({"countryCode": iso2} if iso2 else {})))
    txt = fx.get(url, geo_path(key), accept="application/json")
    if not txt or txt.startswith("<!--"):
        return None
    try:
        res = json.loads(txt).get("results") or []
    except ValueError:
        return None
    if not res:
        return None

    def score(r):
        s = 0.0
        if admin and norm(r.get("admin1", "")) and (norm(admin) in norm(r.get("admin1", "")) or
                                                     norm(r.get("admin1", "")) in norm(admin)):
            s += 2
        if norm(r.get("name", "")) == norm(q):
            s += 1
        s += math.log10(1 + (r.get("population") or 0)) / 10
        return s
    best = max(res, key=score)
    return {"lat": best.get("latitude"), "lon": best.get("longitude"), "elevation_m": best.get("elevation"),
            "tz": best.get("timezone"), "geo_name": best.get("name"), "geo_admin1": best.get("admin1"),
            "population": best.get("population")}


def cmd_fetch_geo(args):
    fx = Fetcher(min_gap=1.1, offline=args.offline)
    events = load_ufcstats()
    locs = sorted(set(e["location"] for e in events.values()))
    bad = []
    for loc in locs:
        city, admin, country = split_location(loc)
        iso3 = country_code(country)
        g = geocode(fx, city, admin, iso3)
        if not g:
            bad.append(loc)
        else:
            log("%-45s %-8s %6s m  %s" % (loc[:45], iso3, g["elevation_m"], g["tz"]))
    # one reference city per country (the city of its representative time zone) for travel distances
    for iso3, row in COUNTRIES.items():
        g = country_ref(fx, iso3)
        if not g:
            log("  no reference point for", iso3, row[3])
    for k, (city, admin, iso3) in sorted(GYMS.items()):
        if not geocode(fx, city, admin, iso3):
            log("  no geocode for gym", k, city)
    # Sherdog birthplaces (for a fighter's home time zone), once the Sherdog pages are cached
    nat = load_sherdog_bios(offline=True)
    places = sorted(set((b["locality"], b["iso3"]) for b in nat.values() if b.get("locality") and b.get("iso3")))
    log("venue locations %d (%d failed); birthplaces to geocode %d" % (len(locs), len(bad), len(places)))
    for i, (pl, iso3) in enumerate(places):
        city, admin = locality_parts(pl)
        geocode(fx, city, admin, iso3)
        if (i + 1) % 100 == 0:
            log("  %d/%d birthplaces, %d requests" % (i + 1, len(places), fx.n))
    log("failed venues:", bad, "requests:", fx.n)


# ------------------------------------------------------------------ people and nationality
def load_people_fights():
    import build_db as B
    lg = {}
    fights, _ = B.parse_fights(lg)
    people = B.build_people(fights, lg)
    return fights, people


def load_wikidata():
    import csv
    items = {}
    for r in csv.DictReader(open(os.path.join(RAW, "wikidata_mma_people.csv"), encoding="utf-8")):
        it = items.setdefault(r["item"], {"names": set(), "ufc": set(), "sherdog": set(), "cc": Counter(),
                                          "bc": Counter(), "sc": Counter(), "dob": set(), "label": r["name"]})
        if r["name"]:
            it["names"].add(norm(r["name"]))
        for k in ("ufc", "sherdog"):
            if r[k]:
                it[k].add(r[k].strip())
        for k in ("cc", "bc", "sc"):
            if r[k]:
                it[k][r[k]] += 1
        if r["dob"]:
            it["dob"].add(r["dob"][:10])
    p = os.path.join(RAW, "wikidata_mma_altlabels.csv")
    if os.path.exists(p):
        for r in csv.DictReader(open(p, encoding="utf-8")):
            if r["item"] in items and r["alt"]:
                items[r["item"]]["names"].add(norm(r["alt"]))
    return items


def match_wikidata(people, pids, items, sd_href=None):
    """person id -> (wikidata item, how). Strong keys first (Sherdog id, UFC slug), then name + DOB."""
    by_sd, by_ufc, by_name, by_dob = defaultdict(set), defaultdict(set), defaultdict(set), defaultdict(set)
    for q, it in items.items():
        for s in it["sherdog"]:
            by_sd[s].add(q)
        for u in it["ufc"]:
            by_ufc[u.lower()].add(q)
        for n in it["names"]:
            by_name[n].add(q)
        for d in it["dob"]:
            by_dob[d].add(q)
    out = {}
    for pid in pids:
        P = people[pid]
        dob = (P.get("tott") or {}).get("dob")
        dob = dob.isoformat() if dob else None

        def dob_ok(q):
            ds = items[q]["dob"]
            if not dob or not ds:
                return True
            return any(abs((dt.date.fromisoformat(d) - dt.date.fromisoformat(dob)).days) <= 1 for d in ds
                       if re.match(r"\d{4}-\d\d-\d\d$", d))
        sdid = None
        if sd_href and sd_href.get(pid):
            m = re.search(r"-(\d+)$", sd_href[pid])
            sdid = m.group(1) if m else None
        cands, how = set(), None
        if sdid and by_sd.get(sdid):
            cands, how = set(by_sd[sdid]), "sherdog id"
        if not cands and by_ufc.get(P["slug"]):
            cands, how = {q for q in by_ufc[P["slug"]] if dob_ok(q)}, "ufc slug"
        if not cands:
            c = {q for q in by_name.get(norm(P["name"]), set()) if dob_ok(q)}
            if len(c) > 1 and dob:
                c = {q for q in c if items[q]["dob"] and dob_ok(q)}
            cands, how = c, "name"
        if not cands and dob:
            last = norm(P["name"]).split()[-1] if norm(P["name"]) else ""
            c = {q for q in by_dob.get(dob, set()) if last and any(last in n.split() for n in items[q]["names"])}
            cands, how = c, "dob + last name"
        if len(cands) == 1:
            out[pid] = (cands.pop(), how)
    return out


_SD_BY_ID = {}


def _sd_id_index():
    """Sherdog numeric id -> cached page path, over both caches (refreshed on demand)."""
    _SD_BY_ID.clear()
    for d in (os.path.join(SD_OLD, "fighter"), os.path.join(SD_DIR, "fighter")):
        if os.path.isdir(d):
            for fn in os.listdir(d):
                m = re.search(r"-(\d+)\.html$", fn)
                if m:
                    _SD_BY_ID.setdefault(m.group(1), os.path.join(d, fn))
    return _SD_BY_ID


def sherdog_page_paths(href_or_id):
    """Cached Sherdog page locations: preufc's cache first, then this tool's (last = where to write)."""
    sid = str(href_or_id) if re.match(r"^\d+$", str(href_or_id)) else None
    if sid is None:
        m = re.search(r"-(\d+)$", href_or_id)
        sid = m.group(1) if m else None
    paths = []
    if sid and sid in _SD_BY_ID:
        paths.append(_SD_BY_ID[sid])
    if re.match(r"^\d+$", str(href_or_id)):
        return paths + [os.path.join(SD_DIR, "fighter", "id-%s.html" % href_or_id)]
    tail = href_or_id.rsplit("/", 1)[-1]
    return paths + [os.path.join(SD_OLD, "fighter", tail + ".html"), os.path.join(SD_DIR, "fighter", tail + ".html")]


def read_cached(paths):
    for p in paths:
        if os.path.exists(p) and os.path.getsize(p) > 0:
            with open(p, encoding="utf-8", errors="replace") as fh:
                return fh.read()
    return None


def parse_sherdog_bio(html):
    if not html or html.startswith("<!-- 404"):
        return None
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "lxml")
    fn = soup.find("span", class_="fn")
    if not fn:
        return None
    na = soup.find("strong", itemprop="nationality")
    loc = soup.find("span", class_="locality")
    assoc = [a.get_text(strip=True) for a in soup.find_all("a", class_="association")]
    bd = soup.find("span", itemprop="birthDate")
    canon = soup.find("link", rel="canonical")
    return {"name": fn.get_text(strip=True), "nationality": na.get_text(strip=True) if na else None,
            "locality": loc.get_text(strip=True) if loc else None, "association": assoc,
            "dob_text": bd.get_text(strip=True) if bd else None,
            "href": canon.get("href") if canon else None}


def sherdog_index():
    """person id -> Sherdog href known from tools/preufc.py's resolver and this tool's own resolver."""
    out = {}
    for p in (os.path.join(SD_OLD, "resolve.json"), os.path.join(SD_DIR, "resolve.json")):
        if os.path.exists(p):
            try:
                for pid, r in json.load(open(p)).items():
                    if r.get("status") == "ok" and r.get("href"):
                        out[pid] = r["href"]
            except ValueError:
                pass
    return out


def target_persons(fights):
    T = {}
    for f in fights:
        if f.date >= SINCE:
            for p in f.persons:
                if not p.startswith(("amb:", "name:")):
                    T[p] = max(T.get(p, f.date), f.date)
    return T


def other_sherdog_rate(window=30.0):
    """Requests per second another crawler (tools/preufc.py) is making to Sherdog, from its cache writes."""
    now = time.time()
    n = 0
    for sub in ("fighter", "search"):
        d = os.path.join(SD_OLD, sub)
        if os.path.isdir(d):
            with os.scandir(d) as it:
                for e in it:
                    try:
                        if now - e.stat().st_mtime < window:
                            n += 1
                    except OSError:
                        pass
    return n / window


def cmd_fetch_sherdog(args):
    """Sherdog bio pages for every 2012+ UFC fighter: by the Sherdog id in Wikidata or preufc's resolver;
    otherwise by name search verified against the fighter's ufcstats bouts (tools/preufc.py logic)."""
    import preufc as PU
    fights, people = load_people_fights()
    T = target_persons(fights)
    items = load_wikidata()
    sdx = sherdog_index()
    wd = match_wikidata(people, list(T), items, sdx)
    fx = Fetcher(min_gap=1.1, offline=args.offline)
    _sd_id_index()

    def polite_get(url, path):
        if os.path.exists(path) and os.path.getsize(path) > 0:
            return open(path, encoding="utf-8", errors="replace").read()
        other = other_sherdog_rate()
        fx.min_gap = 1.0 / max(0.1, 0.95 - other)   # keep the combined rate to Sherdog under 1 request/s
        return fx.get(url, path)

    # oldest careers first: tools/preufc.py (if it is running) covers recent newcomers
    order = sorted(T, key=lambda p: T[p])
    need_search = []
    t0 = time.time()
    got = 0
    for i, pid in enumerate(order):
        if pid in sdx:
            if read_cached(sherdog_page_paths(sdx[pid])):
                continue
            polite_get(PU.BASE + sdx[pid], sherdog_page_paths(sdx[pid])[-1])
            got += 1
            continue
        q = wd.get(pid)
        sids = sorted(items[q[0]]["sherdog"]) if q else []
        if len(sids) == 1:
            path = sherdog_page_paths(sids[0])[0]
            polite_get("%s/fighter/x-%s" % (PU.BASE, sids[0]), path)
            got += 1
        else:
            need_search.append(pid)
        if (i + 1) % 100 == 0:
            log("  %d/%d persons, %d requests, %.0f s, %d left for search" % (
                i + 1, len(order), fx.n, time.time() - t0, len(need_search)))
    log("id pass done: %d requests; %d persons need a name search" % (fx.n, len(need_search)))
    if args.no_search:
        return
    # name search with verification (tools/preufc.py), caching into this tool's directory
    PU.CACHE = SD_DIR
    _, _, bouts = PU.load_ufc()
    res_path = os.path.join(SD_DIR, "resolve.json")
    res = json.load(open(res_path)) if os.path.exists(res_path) else {}
    pfx = PU.Fetcher(offline=args.offline)
    orig_get = pfx.get

    def pget(url, path):
        if not (os.path.exists(path) and os.path.getsize(path) > 0):
            alt = os.path.join(SD_OLD, os.path.relpath(path, SD_DIR))
            if os.path.exists(alt) and os.path.getsize(alt) > 0:
                return open(alt, encoding="utf-8", errors="replace").read()
            other = other_sherdog_rate()
            PU.MIN_GAP = 1.0 / max(0.1, 0.95 - other)
        return orig_get(url, path)
    pfx.get = pget
    for k, pid in enumerate(need_search):
        if pid in res or pid in sherdog_index():
            continue
        P = people[pid]
        name = P["name"]
        nick = P.get("nick")
        lbs = (P.get("tott") or {}).get("lbs")
        tk = PU.norm(name).split()
        queries = [name] + ([tk[0] + " " + tk[-1]] if len(tk) > 2 else []) + ([tk[-1]] if len(tk) >= 2 else [])
        tried, ok = set(), False
        for qtxt in queries:
            html = pfx.get(PU.BASE + "/stats/fightfinder?" + urllib.parse.urlencode({"SearchTxt": qtxt}),
                           PU.search_path(qtxt))
            scored = []
            for c in PU.parse_search(html):
                if c["href"] in tried:
                    continue
                s = PU.name_sim(name, c["name"])
                if nick and c["nick"] and PU.norm(c["nick"]) == PU.norm(nick):
                    s += 0.25
                if lbs and c["lbs"]:
                    s -= min(0.3, abs(c["lbs"] - lbs) / 100.0)
                scored.append((s, c["href"]))
            scored.sort(reverse=True)
            for s, href in scored[:3]:
                if s < 0.6:
                    break
                tried.add(href)
                parsed = PU.parse_fighter(pfx.get(PU.BASE + href, PU.fighter_path(href)))
                kk, _ = PU.verify(parsed, bouts[pid])
                if PU.is_verified(kk, len(bouts[pid])):
                    res[pid] = {"href": href, "status": "ok", "how": "search:" + qtxt, "matched": kk,
                                "n_ufc": len(bouts[pid]), "name": name, "slug": P["slug"]}
                    ok = True
                    break
            if ok:
                break
        if not ok:
            res[pid] = {"href": None, "status": "unresolved", "name": name, "slug": P["slug"],
                        "tried": sorted(tried)}
        if (k + 1) % 25 == 0:
            json.dump(res, open(res_path, "w"), indent=0)
            log("  search %d/%d, %d ok, %.0f s" % (k + 1, len(need_search),
                                                  sum(1 for r in res.values() if r["status"] == "ok"),
                                                  time.time() - t0))
    os.makedirs(SD_DIR, exist_ok=True)
    json.dump(res, open(res_path, "w"), indent=0)
    log("search pass done: %d resolved of %d" % (sum(1 for r in res.values() if r["status"] == "ok"), len(res)))


_BIO_MEMO = {}
_BIO_MEMO_PATH = os.path.join(SD_DIR, "_bios_memo.json")


def load_sherdog_bios(offline=True, fights=None, people=None):
    """person id -> Sherdog bio (nationality, birthplace, association, iso3) from the caches only."""
    if not _BIO_MEMO and os.path.exists(_BIO_MEMO_PATH):
        try:
            _BIO_MEMO.update(json.load(open(_BIO_MEMO_PATH, encoding="utf-8")))
        except ValueError:
            pass
    if fights is None:
        fights, people = load_people_fights()
    T = target_persons(fights)
    items = load_wikidata()
    sdx = sherdog_index()
    wd = match_wikidata(people, list(T), items, sdx)
    _sd_id_index()
    out = {}
    for pid in T:
        html = None
        src = None
        if pid in sdx:
            html = read_cached(sherdog_page_paths(sdx[pid]))
            src = sdx[pid]
        if html is None and pid in wd:
            sids = sorted(items[wd[pid][0]]["sherdog"])
            if len(sids) == 1:
                html = read_cached(sherdog_page_paths(sids[0]))
                src = "/fighter/x-" + sids[0]
        b = None
        if html:
            hk = "%s:%d" % (src, len(html))
            b = _BIO_MEMO.get(hk)
            if b is None:
                b = parse_sherdog_bio(html)
                _BIO_MEMO[hk] = b
        if b:
            b = dict(b)
            b["iso3"] = country_code(b["nationality"])
            b["src"] = src
            out[pid] = b
    try:
        os.makedirs(SD_DIR, exist_ok=True)
        with open(_BIO_MEMO_PATH, "w", encoding="utf-8") as fh:
            json.dump(_BIO_MEMO, fh, ensure_ascii=False)
    except OSError:
        pass
    return out


# ------------------------------------------------------------------ Wikipedia event article parsing
SKIP_SECTIONS = ("see also", "references", "external links", "bonus awards", "aftermath", "records",
                 "fighter payouts", "broadcast", "bout records", "notes and references", "further reading")
MONTHS_FULL = ["january", "february", "march", "april", "may", "june", "july", "august", "september",
               "october", "november", "december"]
MON_RE = "|".join(MONTHS_FULL)
NUMW = {"a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
        "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
        "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20,
        "several": None, "few": None, "couple": 2, "single": 1}
ABBREV = ["vs", "jr", "sr", "st", "dr", "mr", "mrs", "ms", "no", "mt", "ft", "u.s", "inc", "approx", "e.g", "i.e"]


def clean_text(s):
    s = re.sub(r"\[\s*(?:\d+|[a-z]{1,2}|edit|note \d+|citation needed|nb \d+)\s*\]", "", s)
    s = s.replace("\u00a0", " ").replace("\u2009", " ").replace("\u2013", "-").replace("\u2014", " - ")
    s = s.replace("\u2019", "'").replace("\u2018", "'").replace("\u201c", '"').replace("\u201d", '"')
    s = re.sub(r"\s+([.,;:!?)'])", r"\1", s)
    s = re.sub(r"([(])\s+", r"\1", s)
    s = re.sub(r"(\d)\s*\.\s+(\d)", r"\1.\2", s)       # "157. 5" artefacts
    return re.sub(r"\s+", " ", s).strip()


def split_sentences(p):
    t = p
    for a in ABBREV:
        t = re.sub(r"(?i)\b%s\.(?=\s)" % re.escape(a), lambda m: m.group(0)[:-1] + "\x00", t)
    t = re.sub(r"\b([A-Z])\.(?=\s*[A-Z])", "\\1\x00", t)          # initials: "T. J. Grant", "C. Vergara"
    parts = re.split(r'(?<=[.!?])\s+(?=["(]?[A-Z0-9])', t)
    return [x.replace("\x00", ".").strip() for x in parts if x.strip()]


def parse_event_article(html):
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "lxml")
    body = soup.find("div", class_="mw-parser-output")
    if body is None:
        return None
    canon = soup.find("link", rel="canonical")
    out = {"canonical": canon.get("href") if canon else None, "infobox": {}, "paras": [], "results": [],
           "notes": {}, "fulltext": ""}
    ib = body.find("table", class_="infobox")
    if ib:
        for tr in ib.find_all("tr"):
            th, td = tr.find("th"), tr.find("td")
            if th and td:
                out["infobox"][th.get_text(" ", strip=True)] = clean_text(td.get_text(" ", strip=True))
    secs = body.find_all("section", recursive=False) or [body]
    full = []
    for sec in secs:
        h = sec.find(class_="mw-heading") or sec.find(["h2", "h3"])
        title = clean_text(h.get_text(" ", strip=True)).replace("[edit]", "").strip() if h else "LEAD"
        tl = title.lower()
        # footnotes attached to the results table (efn notes) live in references wraps inside the section
        for d in sec.find_all("div", class_=re.compile("references|reflist")):
            for li in d.find_all("li"):
                if li.get("id"):
                    out["notes"][li["id"]] = clean_text(li.get_text(" ", strip=True).lstrip("^\u2191 "))
        if tl.startswith("results") or tl.startswith("fight card") or tl == "card":
            out["results"] += parse_results_table(sec)
        if any(tl.startswith(x) for x in SKIP_SECTIONS):
            continue
        for el in sec.find_all(["p", "li"]):
            if el.find_parent("table") is not None or el.find_parent(class_=re.compile("references|reflist|navbox")):
                continue
            if el.name == "li" and el.find_parent(["p"]):
                continue
            t = clean_text(el.get_text(" ", strip=True))
            if len(t) > 20:
                out["paras"].append({"sec": title, "text": t})
                full.append(t)
    # notes referenced from the results table are narrative too (catchweight, missed weight)
    for nid, t in out["notes"].items():
        if re.search(r"weigh|weight|catchweight|pound|lb|replac|notice", t, re.I) and len(t) > 15:
            out["paras"].append({"sec": "note", "text": t, "note_id": nid})
    out["fulltext"] = " ".join(full)
    return out


def parse_event_article_cached(path):
    """parse_event_article with a JSON memo next to the raw cache (keyed by size and mtime, parser version)."""
    st = os.stat(path)
    memo = os.path.join(WIKI_DIR, "_parsed", os.path.basename(path)[:-5] + ".json")
    key = "%d-%d-%s" % (st.st_size, int(st.st_mtime), PARSER_VERSION)
    if os.path.exists(memo):
        try:
            d = json.load(open(memo, encoding="utf-8"))
            if d.get("_key") == key:
                return d
        except ValueError:
            pass
    d = parse_event_article(open(path, encoding="utf-8").read())
    if d is not None:
        d["_key"] = key
        os.makedirs(os.path.dirname(memo), exist_ok=True)
        with open(memo, "w", encoding="utf-8") as fh:
            json.dump(d, fh, ensure_ascii=False)
    return d


PARSER_VERSION = "1"


def parse_results_table(sec):
    rows = []
    for t in sec.find_all("table"):
        seg = None
        for tr in t.find_all("tr"):
            cells = tr.find_all(["td", "th"])
            txt = [clean_text(c.get_text(" ", strip=True)) for c in cells]
            if len(cells) == 1:
                seg = txt[0]
                continue
            if len(txt) >= 4 and txt[2].lower() in ("def.", "vs.", "drew", "vs", "def"):
                notes = [a.get("href", "").lstrip("#") for a in tr.select("sup a") if a.get("href", "").startswith("#")]
                rows.append({"segment": seg, "wc": txt[0], "A": txt[1], "rel": txt[2], "B": txt[3],
                             "method": txt[4] if len(txt) > 4 else None,
                             "notes_txt": txt[7] if len(txt) > 7 else None, "note_ids": notes})
    return rows


# ufcstats single-token names -> how Wikipedia writes them (pattern, surname used alone)
NAME_ALIASES = {"Alatengheili": [("heili alateng", "alateng")], "Maheshate": [("hayisaer maheshate", "maheshate")],
                "Mizuki": [("mizuki inoue", "inoue")], "Rongzhu": [("zhu rong", "zhu"), ("rong zhu", "zhu")],
                "Sumudaerji": [("su mudaerji", "mudaerji"), ("su mudaerji", "su")],
                "Wulijiburen": [("wuliji buren", "buren"), ("wuliji buren", "wuliji")],
                "Aoriqileng": [("aoriqileng", "aoriqileng")], "Sulangrangbo": [("sulangrangbo", "sulangrangbo")],
                "Yizha": [("yizha", "yizha")]}


class Card:
    """Final bouts of one ufcstats event, with name matchers for the article text."""
    SUFFIX = {"jr", "sr", "ii", "iii", "iv", "junior"}

    def __init__(self, bouts):
        self.f = []          # (name, fid, side)
        for b in bouts:
            for side in ("A", "B"):
                self.f.append({"name": b[side], "fid": b["fid"], "side": side, "opp": b["B" if side == "A" else "A"]})
        lastc = Counter()
        for x in self.f:
            tk = [t for t in norm(x["name"].replace("-", " ")).split() if t]
            core = [t for t in tk if t not in self.SUFFIX] or tk
            x["tokens"] = core
            x["last"] = core[-1] if core else ""
            lastc[x["last"]] += 1
        for x in self.f:
            pats = set()
            tk = x["tokens"]
            if len(tk) >= 2:
                pats.add(" ".join(tk))
                pats.add(" ".join([tk[-1]] + tk[:-1]))         # family name first (Zhang Weili)
                for i in range(1, len(tk) - 1):
                    pats.add(" ".join(tk[i:]))                 # "rogerio de lima", "de lima"
                pats.add(tk[0] + " " + tk[-1])
            J = r"[\s.\-]+"
            for full, sur in NAME_ALIASES.get(x["name"], []):
                pats.add(full)
                x.setdefault("alias_last", set()).add(sur)
            x["full_re"] = re.compile(r"\b(?:%s)\b" % "|".join(
                J.join(re.escape(t) for t in p.split()) for p in sorted(pats, key=len, reverse=True))) if pats else None
            x["last_re"] = re.compile(r"\b%s\b" % re.escape(x["last"])) if x["last"] and len(x["last"]) >= 2 else None
            x["last_unique"] = lastc[x["last"]] == 1

    @staticmethod
    def key(t):
        """Accent-folded lower case; punctuation kept so numbers and phrases survive."""
        return fold(t).lower().replace("'", "")

    def mentions(self, text, prefer=None):
        """[(start, end, idx, kind)] fighter mentions in text (positions in the normalized text).
        Surname-only mentions count when the surname is unique on the card, or when that fighter's full name
        appears in `prefer` (the paragraph)."""
        mk = (text, prefer)
        memo = self.__dict__.setdefault("_memo", {})
        if mk not in memo:
            memo[mk] = self._mentions(text, prefer)
        return memo[mk]

    EVENT_NAME = re.compile(r"(?:ufc|fight night|the ultimate fighter|tuf|bellator|strikeforce|wec|pfl|invicta|"
                            r"lfa|cage warriors|ksw)\b[^.;\n]{0,45}?\bvs\.?\s+[\w.\-]+(?:\s+(?:\d+|[a-z][\w.\-]+))?")

    def _mentions(self, text, prefer=None):
        k = self.key(text)
        # mask event names ("UFC on ESPN: Santos vs. Hill") so headliners named there are not mentions
        k = self.EVENT_NAME.sub(lambda m: " " * len(m.group(0)), k)
        out = []
        taken = []
        for i, x in enumerate(self.f):
            if x["full_re"]:
                for m in x["full_re"].finditer(k):
                    out.append((m.start(), m.end(), i, "full"))
                    taken.append((m.start(), m.end()))
        pk = self.key(prefer) if prefer else k
        for i, x in enumerate(self.f):
            if not x["last_re"]:
                continue
            ok = x["last_unique"] or (x["full_re"] and x["full_re"].search(pk))
            if not ok:
                continue
            if not x["last_unique"]:
                # another fighter with this surname also named in full in the paragraph -> ambiguous
                rivals = [y for j, y in enumerate(self.f) if j != i and y["last"] == x["last"] and y["full_re"]
                          and y["full_re"].search(pk)]
                if rivals:
                    continue
            for m in x["last_re"].finditer(k):
                if any(a <= m.start() < b for a, b in taken):
                    continue
                out.append((m.start(), m.end(), i, "last"))
            for sur in x.get("alias_last", ()):
                for m in re.finditer(r"\b%s\b" % re.escape(sur), k):
                    if any(a <= m.start() < b for a, b in taken) or any(o[0] == m.start() for o in out):
                        continue
                    out.append((m.start(), m.end(), i, "last"))
            tk = x["tokens"]
            if len(tk) == 2 and len(tk[0]) >= 4 and re.search(r"\b%s[\s.\-]+%s\b" % (re.escape(tk[1]), re.escape(tk[0])), pk) \
                    and not any(tk[0] in y["tokens"] for j, y in enumerate(self.f) if j != i):
                for m in re.finditer(r"\b%s\b" % re.escape(tk[0]), k):
                    if any(a <= m.start() < b for a, b in taken) or any(o[0] == m.start() for o in out):
                        continue
                    out.append((m.start(), m.end(), i, "last"))
        out.sort()
        return out, k


WEIGH_TRIG = re.compile(
    r"(weighed in|weighing in|weighed at|weigh in at|came in (?:heavy|over|overweight|at)|coming in (?:at|heavy|over)|"
    r"tipped the scales|missed (?:the )?(?:required |contracted )?weight|missed (?:the |his |her )?[\w' -]{0,40}limit|"
    r"failed to make (?:the )?(?:required )?weight|failing to make (?:the )?(?:required )?weight|"
    r"did not make (?:the )?weight|missing weight|missed weight|failed to make the|"
    r"(?:pounds?|lbs?)\.? (?:\([^)]*\) )?over|overweight)", re.I)
NEG_TRIG = re.compile(r"(?:successfully|eventually|later|subsequently|then) (?:made|make|hit|cut)|made (?:the )?weight|"
                      r"second attempt[^.]{0,40}(?:made|within|on weight)|on weight|within the limit|"
                      r"made the (?:required |contracted )?(?:\w+ )?limit|on (?:his|her|their) second attempt", re.I)
NUM = r"(\d+(?:\.\d+)?(?:\s?\u00bd)?|\u00bd)"
W_RE = re.compile(r"(?:weighed in at|weighing in at|weighed at|weigh in at|came in at|coming in at|tipped the scales at|"
                  r"weighed in|weighing in|weighed)\s+(?:a\s+)?(\d{3}(?:\.\d+)?(?:\s?\u00bd)?)", re.I)
OVER_RE = re.compile(
    r"((?:\d+(?:\.\d+)?(?:\s?\u00bd)?|\u00bd|half(?: of)? a|a half|one and a half|two and a half|three and a half|"
    r"four and a half|five and a half|six and a half|seven and a half|eight and a half|nine and a half|"
    r"ten and a half|eleven and a half|twelve and a half|a|an|one|two|three|four|five|six|seven|eight|nine|ten|"
    r"eleven|twelve|thirteen|fourteen|fifteen)(?: and a half)?)[- ](?:full )?(?:pounds?|lbs?\.?|lb)\s*(?:\([^)]*\)\s*)?"
    r"(?:over|above|heavy|too heavy|more than)", re.I)
BY_RE = re.compile(r"missed (?:the )?weight by\s+((?:\d+(?:\.\d+)?|half a|a|one|two|three|four|five|six|seven|eight)"
                   r"(?: and a half)?)\s*(?:pounds?|lbs?)", re.I)


def wnum(s):
    s = s.lower().strip().replace("\u00bd", ".5").replace(" .5", ".5")
    if re.match(r"^\d+(\.\d+)?$", s):
        return float(s)
    if re.match(r"^\d+\.5$", s):
        return float(s)
    half = 0.5 if "half" in s else 0.0
    if s in ("half a", "half of a", "a half"):
        return 0.5
    w = s.replace("and a half", "").strip()
    if w in NUMW and NUMW[w] is not None:
        return NUMW[w] + half
    try:
        return float(w) + half
    except ValueError:
        return None


def parse_weighins(card, paras, event):
    """{(fid, side): {"lbs_over": x|None, "weighed": W|None, "text": sentence}} for fighters who missed weight."""
    out = {}
    for para in paras:
        txt = para["text"]
        if not re.search(r"weigh|weight|pound|lb", txt, re.I):
            continue
        if re.search(r"post-fight (?:drug )?test|tested positive|metabolites", txt, re.I) and not WEIGH_TRIG.search(txt):
            continue
        sents = split_sentences(txt)
        prev_subj = []
        for s in sents:
            ms, k = card.mentions(s, prefer=txt)
            trig = list(WEIGH_TRIG.finditer(k))
            subj_here = []
            if trig and not re.search(r"post-fight|in (?:his|her) (?:previous|last|next)|previously missed|"
                                      r"(?:second|third|fourth|fifth|sixth) time|history", k):
                for tm in trig:
                    before = [m for m in ms if m[1] <= tm.start()]
                    if before:
                        last = before[-1]
                        group = [last]
                        # "X and Y (both) missed weight", "X, Y and Z missed weight"
                        j = len(before) - 2
                        while j >= 0:
                            gap = k[before[j][1]:group[0][0]]
                            if re.fullmatch(r"\s*(?:,|and|, and)\s*(?:(?:former|undefeated|promotional newcomer|"
                                            r"newcomer|the)\s[\w' -]{0,60}?)?", gap):
                                group.insert(0, before[j])
                                j -= 1
                            else:
                                break
                        # the subject must not be the object of "surrender ... to X" / "opponent X"
                        gap_after = k[last[1]:tm.start()]
                        if re.search(r"\b(?:to|against|opponent|face|faced|facing)\s*$", k[max(0, last[0] - 30):last[0]]):
                            continue
                        if len(gap_after) > 160 or re.search(r"\b(?:but|after|when|because|while|since|before|"
                                                             r"although|though|whereas|however)\b", gap_after):
                            continue
                        subj_here.extend(g[2] for g in group)
                    else:
                        prons = list(re.finditer(r"\b(he|she|both fighters|both|the pair|they|the former|the latter)\b",
                                                 k[:tm.start()]))
                        pron = prons[-1] if prons else None
                        if pron and (tm.start() - pron.end() > 60 or re.search(
                                r"\b(?:but|after|when|because|while|since|before|although|though|however)\b",
                                k[pron.end():tm.start()])):
                            pron = None
                        if pron and prev_subj:
                            w = pron.group(1)
                            if w in ("he", "she") and len(prev_subj) == 1:
                                subj_here.extend(prev_subj)
                            elif w in ("both fighters", "both", "the pair", "they"):
                                subj_here.extend(prev_subj)
                            elif w == "the former":
                                subj_here.append(prev_subj[0])
                            elif w == "the latter":
                                subj_here.append(prev_subj[-1])
                        elif prev_subj and len(prev_subj) == 1 and re.match(r"^\s*(?:weighing|coming|missing)", k):
                            subj_here.extend(prev_subj)
            subj_here = list(dict.fromkeys(subj_here))
            # fines without a weigh-in verb: "X was fined 20 percent of his purse for missing weight"
            for m in re.finditer(r"(?:fined|forfeit\w*|surrender\w*)[^.]{0,80}(?:for (?:missing|failing to make|"
                                 r"not making) (?:the )?(?:required )?weight|weight miss)", k):
                before = [x for x in ms if x[1] <= m.start()]
                if before and not re.search(r"\b(?:to|opponent)\s*$", k[max(0, before[-1][0] - 15):before[-1][0]]):
                    subj_here.append(before[-1][2])
            for m in re.finditer(r"\bwith ([a-z' .-]{3,60}?) (?:being )?(?:fined|forfeiting|surrendering)", k):
                inside = [x for x in ms if m.start(1) <= x[0] < m.end(1)]
                subj_here.extend(x[2] for x in inside)
            subj_here = list(dict.fromkeys(subj_here))
            if not subj_here:
                if ms:
                    prev_subj = [ms[0][2]] if len(set(x[2] for x in ms)) == 1 else prev_subj
                continue
            negated = bool(NEG_TRIG.search(k)) and not re.search(r"no (?:further )?attempts?|made no|did not|"
                                                                  r"didn't|failed|elected|declined|chose not", k)
            explicit = bool(re.search(r"missed|missing|\bover\b|heavy|failed|failing|above|overweight|fined|"
                                      r"surrender|forfeit|did not make|didnt make|not make|catch ?weight", k))
            weights = [(m.start(), wnum(m.group(1))) for m in W_RE.finditer(k)]
            overs = [(m.start(), wnum(m.group(1))) for m in OVER_RE.finditer(k)] + \
                    [(m.start(), wnum(m.group(1))) for m in BY_RE.finditer(k)]
            weights = [(p, w) for p, w in weights if w and 100 <= w <= 300]
            overs = [(p, o) for p, o in overs if o is not None and 0 < o < 30]
            respectively = "respectively" in k
            if respectively and trig:
                t0 = trig[0].start()
                allw = [(m.start(), wnum(m.group(1))) for m in re.finditer(
                    r"(\d{3}(?:\.\d+)?(?:\s?\u00bd)?)\s*(?:pounds?|lbs?\.?|lb)\b", k) if m.start() >= t0]
                allw = [(p, w) for p, w in allw if w and 100 <= w <= 300]
                if len(allw) > len(weights):
                    weights = allw
                allo = [(m.start(), wnum(m.group(1))) for m in re.finditer(
                    r"(\d+(?:\.\d+)?|half a|a half|one|two|three|four|five|six|seven|eight|nine|ten)"
                    r"(?: and a half)?[- ](?:pounds?|lbs?\.?|lb)\b(?!\s*(?:\(|,)?\s*\d)", k) if m.start() >= t0]
                allo = [(p, o) for p, o in allo if o is not None and 0 < o < 30]
                if len(allo) > len(overs) and re.search(r"\bover\b", k):
                    overs = allo
            pos = {}
            for x in ms:
                pos.setdefault(x[2], x[0])

            def assign(vals):
                res = {}
                if not vals:
                    return res
                if respectively and len(vals) == len(subj_here) and len(subj_here) > 1:
                    for i, si in enumerate(subj_here):
                        res[si] = vals[i][1]
                    return res
                for p, v in vals:
                    owners = [si for si in subj_here if pos.get(si, -1) <= p]
                    if owners:
                        o = max(owners, key=lambda si: pos.get(si, -1))
                    elif len(subj_here) >= 1:
                        o = subj_here[0] if len(subj_here) == 1 or all(si not in pos for si in subj_here) else None
                        if o is None:
                            continue
                    res.setdefault(o, v)
                if len(subj_here) > 1 and len(vals) == 1 and re.search(r"\bboth\b", k):
                    for si in subj_here:
                        res.setdefault(si, vals[0][1])
                return res
            wmap, omap = assign(weights), assign(overs)
            for si in subj_here:
                fx = card.f[si]
                key = (fx["fid"], fx["side"])
                rec = out.get(key) or {"lbs_over": None, "weighed": None, "text": [], "negated": False,
                                       "explicit": False}
                if negated:
                    rec["negated"] = True
                rec["explicit"] = rec["explicit"] or explicit
                if omap.get(si) is not None and rec["lbs_over"] is None:
                    rec["lbs_over"] = omap[si]
                if wmap.get(si) is not None and rec["weighed"] is None:
                    rec["weighed"] = wmap[si]
                rec["text"].append(s[:300])
                out[key] = rec
            prev_subj = subj_here
    return out


CATCH_RE = re.compile(r"(\d{3})[- ](?:pound|lb)s?\.?[- ]catch ?weight|catch ?weight (?:bout )?(?:of|at) (\d{3})|"
                      r"catch ?weight \((\d{3}) ?(?:lb|pounds?)|catch ?weight (?:limit )?of (\d{3})", re.I)


def date_cues(s, event_date):
    """Days before the event implied by one sentence, as [(days, basis)], most specific first."""
    k = s.lower()
    out = []
    for m in re.finditer(r"(?:on|with|given|after|under|in)\s+(?:just |only |roughly |about |approximately |around |"
                         r"barely |nearly |just over |just under |little more than |a little over |"
                         r"less than |under |over |more than )?(?:(a|an|one|two|three|four|five|six|seven|eight|nine|"
                         r"ten|eleven|twelve|thirteen|fourteen|\d+|a couple of|a few|several)[- ])?"
                         r"(days?|weeks?|months?)'?(?:'s|s')?\s+notice", k):
        lead = k[m.start():m.end()]
        n = m.group(1)
        unit = m.group(2)
        val = NUMW.get(n, None) if n and not n.isdigit() else (int(n) if n else 1)
        if n in ("a couple of",):
            val = 2
        if n in ("a few", "several"):
            val = 3
        if val is None:
            val = 1
        days = val * (1 if unit.startswith("day") else 7 if unit.startswith("week") else 30)
        if "less than" in lead or "under" in lead or "barely" in lead:
            days = max(0, days - (1 if unit.startswith("day") else 2))
        if "over" in lead or "more than" in lead:
            days += 1 if unit.startswith("day") else 2
        out.append((days, "notice phrase"))
    for m in re.finditer(r"(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|"
                         r"\d+|a couple of|a few|several)[- ](days?|weeks?|months?)\s+(?:before|prior to|ahead of|"
                         r"out from|away from|from|until|out of)\s+(?:the\s+)?(?:event|fight|bout|card|contest|"
                         r"scheduled|matchup|show|weigh-ins)", k):
        n, unit = m.group(1), m.group(2)
        val = int(n) if n.isdigit() else (2 if n == "a couple of" else 3 if n in ("a few", "several") else NUMW.get(n, 1))
        days = val * (1 if unit.startswith("day") else 7 if unit.startswith("week") else 30)
        out.append((days, "before the event"))
    if re.search(r"day of the event|on fight night|fight day|hours before|on the night of the event|"
                 r"day of the fight|morning of the event|hours prior", k):
        out.append((0, "day of the event"))
    if re.search(r"day (?:of|before) the weigh-?ins|at the weigh-?ins|during the weigh-?ins|day before the event|"
                 r"on the eve of|eve of the event|the day before|weigh-?in day|day of weigh-?ins", k):
        out.append((1, "weigh-in day"))
    if re.search(r"fight week|the week of the event|week leading up to|days leading up|days before the event|"
                 r"days prior to the event|days out from|during the week of|earlier in the week|days ahead of",
                 k):
        out.append((4, "fight week"))
    # explicit dates (not the event's own original date: "originally planned to take place on April 18")
    for m in re.finditer(r"\b(?:on |by |as of )?(%s) (\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{4}))?\b" % MON_RE, k):
        if EVENT_DATE_CTX.search(k[max(0, m.start() - 60):m.start()]) or \
                re.match(r"\s*(?:,\s*\d{4}\s*)?,?\s*(?:at|in) (?:ufc|the ufc|bellator|the event|ufc fight night|the ultimate)",
                         k[m.end():m.end() + 30]):
            continue                      # the date of an event, not of the change
        d = _mkdate(event_date, MONTHS_FULL.index(m.group(1)) + 1, int(m.group(2)), m.group(3))
        if d is not None:
            out.append(((event_date - d).days, "dated"))
    for m in re.finditer(r"\b(\d{1,2}) (%s)(?: (\d{4}))?\b" % MON_RE, k):
        d = _mkdate(event_date, MONTHS_FULL.index(m.group(2)) + 1, int(m.group(1)), m.group(3))
        if d is not None:
            out.append(((event_date - d).days, "dated"))
    for m in re.finditer(r"\b(early|mid|late|the end of|end of|the beginning of|beginning of|the start of|"
                         r"start of|the middle of|middle of)[- ](%s)(?:,? (\d{4}))?\b" % MON_RE, k):
        day = {"early": 5, "mid": 15, "late": 25, "the end of": 28, "end of": 28, "the beginning of": 3,
               "beginning of": 3, "the start of": 3, "start of": 3, "the middle of": 15, "middle of": 15}[m.group(1)]
        d = _mkdate(event_date, MONTHS_FULL.index(m.group(2)) + 1, day, m.group(3))
        if d is not None:
            out.append(((event_date - d).days, "part of month"))
    if not any(b in ("dated", "part of month") for _, b in out):
        for m in re.finditer(r"\bin (%s)(?:,? (\d{4}))?\b" % MON_RE, k):
            d = _mkdate(event_date, MONTHS_FULL.index(m.group(1)) + 1, 15, m.group(2))
            if d is not None:
                out.append((max(0, (event_date - d).days), "month"))
    rel = re.search(r"\b(a|an|one|two|three|four|five|six|\d+) (days?|weeks?) later\b", k)
    out = [(d, b) for d, b in out if d is not None and 0 <= d <= 400]
    order = {"notice phrase": 0, "before the event": 1, "day of the event": 2, "weigh-in day": 3, "fight week": 4,
             "dated": 5, "part of month": 6, "month": 7}
    out.sort(key=lambda x: (order[x[1]], x[0]))
    return out, (rel.group(1), rel.group(2)) if rel else None


def _mkdate(event_date, month, day, year):
    try:
        if year:
            return dt.date(int(year), month, day)
        d = dt.date(event_date.year, month, min(day, 28) if month == 2 else day)
        if d > event_date:
            d = dt.date(event_date.year - 1, month, min(day, 28) if month == 2 else day)
        return d
    except ValueError:
        return None


SCHED_RE = re.compile(r"\b(?:was|were|had been|is|are|has been|have been)\s+(?:originally |initially |previously |"
                      r"briefly |tentatively |also |first |expected |once |reportedly |officially )?"
                      r"(?:expected|scheduled|slated|set|booked|linked|rumou?red|targeted|due|"
                      r"supposed|tabbed to face|paired|pencil(?:l)?ed)\b(?! to (?:take place|be held|occur|happen))|"
                      r"\bbout between\b|\bmatch-?up between\b|"
                      r"\bpairing (?:between|of)\b|\bcontest between\b|\bfight between\b|\brematch between\b|"
                      r"\btrilogy (?:bout|fight) between\b|"
                      r"\bscheduled (?:\w+ ){0,2}(?:bout|fight|match-?up|contest|rematch|clash) (?:against|with|vs)|"
                      r"\b(?:pulled out of|withdrew from|was removed from|was forced out of|exited) (?:a|his|her|their|the) "
                      r"(?:scheduled |planned |booked )?(?:\w+ ){0,2}(?:bout|fight|match-?up|contest|rematch) "
                      r"(?:against|with|vs)", re.I)
# a sentence that names a fighter as the one who stepped in
REPL_NEAR = re.compile(r"replaced by|replace(?:d|s)? (?:him|her|them)\b|as (?:a |his |her |the )?replacement|"
                       r"(?:would|will|to) replace|stepped in|stepping in|step in|stepped up|filled in|fill in|"
                       r"took (?:the|his|her|their) (?:bout|fight|place|spot)|in (?:his|her) place|instead|"
                       r"new opponent|was tabbed|was named as|was brought in|short notice|in turn|"
                       r"remain(?:ed)? on the card|will now face|now faces?|was rebooked|re-?booked|"
                       r"was moved to face|was paired with|was then (?:expected|scheduled|set|booked) to face|"
                       r"(?:will|would) face|to face|faced|took on|against", re.I)
REPL_RE = REPL_NEAR
WITHDRAW_RE = re.compile(r"\b(?:however|but|pulled out|withdr|forced|removed|out of the|injur|due to|scrapped|"
                         r"cancel|replaced|ruled out|was pulled|sidelined|illness|visa|suspend|tested positive)\b", re.I)
EVENT_DATE_CTX = re.compile(r"(?:take place|took place|be held|was held|held|happen|occur|planned|scheduled|"
                            r"set|moved|postponed|rescheduled|originally|event)\s+(?:\w+\s+){0,3}(?:on|for|to)\s*$", re.I)


def parse_bout_changes(card, paras, event_date):
    """Per (fid, side): {"role": "replacement"|"opp_change", "days": int|None, "basis": str,
    "short_notice_phrase": bool, "booked_vs": booking sentence, "text": paragraph}.

    Unit of analysis is a paragraph: its first booking sentence (s0) names who was booked. For a final bout
    (P, Q): P in the booking and Q named later -> P's opponent changed, Q stepped in (or also changed
    opponent if Q was booked against someone else on this card). Neither booked but both named later in
    replacement sentences -> both stepped in (a chain). Q may also be named in a separate paragraph
    ("The UFC announced that X would be replaced by Q")."""
    para_info = []
    for pi, para in enumerate(paras):
        txt = para["text"]
        if para.get("sec") in ("note", "LEAD", "Reported payout"):
            para_info.append(None)
            continue
        sents = split_sentences(txt)
        s0 = next((si for si, s_ in enumerate(sents) if SCHED_RE.search(s_)), None)
        if s0 is None:
            para_info.append({"sents": sents, "s0": None, "members": set(), "head": ""})
            continue
        s0txt = sents[s0]
        sm = SCHED_RE.search(s0txt)
        wm = WITHDRAW_RE.search(s0txt, sm.end())
        head = s0txt[:wm.start()] if wm else s0txt
        hm, _ = card.mentions(head, prefer=txt)
        members = set(x[2] for x in hm)
        # mentions before the booking sentence mean the paragraph is about something else
        pre = set()
        for si in range(s0):
            mm, _ = card.mentions(sents[si], prefer=txt)
            pre |= set(x[2] for x in mm)
        para_info.append({"sents": sents, "s0": s0, "members": members, "head": head, "pre": pre})

    def booked_elsewhere(i, partner, skip):
        """Is fighter i booked on this card against someone other than `partner` in another paragraph?"""
        for pj, inf in enumerate(para_info):
            if pj == skip or not inf or inf["s0"] is None:
                continue
            if i in inf["members"] and partner not in inf["members"]:
                return True
        return False

    def first_sentence(info, who, txt, start, after_s0=True):
        for si in range(start, len(info["sents"])):
            mm, _ = card.mentions(info["sents"][si], prefer=txt)
            if any(x[2] == who for x in mm):
                return si
        return None

    def notice(info, first_s, lo):
        sents = info["sents"]
        days, basis, rel = None, None, None
        for si in range(first_s, lo - 1, -1):
            cues, r = date_cues(sents[si], event_date)
            if r and rel is None and si == first_s:
                rel = r
            if cues:
                days, basis = cues[0]
                if rel and si < first_s and basis in ("dated", "part of month", "month"):
                    n = int(rel[0]) if rel[0].isdigit() else NUMW.get(rel[0], 1)
                    days = max(0, days - n * (7 if rel[1].startswith("week") else 1))
                    basis += " + relative"
                break
        return days, basis

    out = {}

    def put(who, role, days, basis, snp, head, txt):
        fx = card.f[who]
        key = (fx["fid"], fx["side"])
        prev = out.get(key)
        rec = {"role": role, "days": days, "basis": basis, "short_notice_phrase": snp,
               "booked_vs": clean_text(head)[:160], "text": txt[:600]}
        if prev is None or (prev["role"] == "opp_change" and role == "replacement") or \
                (prev["role"] == role and prev["days"] is None and days is not None):
            out[key] = rec

    bouts = defaultdict(list)
    for i, x in enumerate(card.f):
        bouts[x["fid"]].append(i)
    for fid, pair in bouts.items():
        if len(pair) != 2:
            continue
        ia, ib = pair
        handled = False
        for pi, info in enumerate(para_info):
            if not info or info["s0"] is None:
                continue
            txt = paras[pi]["text"]
            sents = info["sents"]
            ms_all, _ = card.mentions(txt, prefer=txt)
            names_here = set(x[2] for x in ms_all)
            if ia not in names_here and ib not in names_here:
                continue
            if (ia in info["pre"] or ib in info["pre"]) and not (ia in info["members"] or ib in info["members"]):
                continue
            if not (REPL_NEAR.search(txt) or WITHDRAW_RE.search(txt)):
                continue
            mem = info["members"]
            if ia in mem and ib in mem:
                continue       # the final pairing is the booking in this paragraph (maybe moved from elsewhere)
            fallback = None
            if ia not in names_here or ib not in names_here:
                # one side only: the other may appear under another name (marriage, transliteration):
                # "replaced by Veronica Macedo" for ufcstats "Veronica Hardy" -> same first name
                stay = ia if ia in names_here else ib
                new = ib if stay == ia else ia
                if stay not in mem:
                    continue
                rb = re.search(r"replaced by (?:(?:promotional |UFC |returning |fellow |former |the )?"
                               r"(?:newcomer |veteran |prospect )?)?([A-Z][\w'.-]+)(?: [A-Z][\w'.-]+)+", txt)
                if not rb or Card.key(rb.group(1)) != card.f[new]["tokens"][0]:
                    continue
                fallback = rb.group(0)
                roles = [(stay, "opp_change"), (new, "replacement")]
            elif (ia in mem) != (ib in mem):
                stay, new = (ia, ib) if ia in mem else (ib, ia)
                roles = [(stay, "opp_change"),
                         (new, "opp_change" if booked_elsewhere(new, stay, pi) else "replacement")]
            else:
                # neither booked here: both must be named in replacement sentences after the booking
                ok = True
                for who in (ia, ib):
                    fs = first_sentence(info, who, txt, info["s0"] + 1)
                    if fs is None or not re.search(r"replac|stepped|step in|instead|in turn|filled|took (?:his|her|the)",
                                                   sents[fs], re.I):
                        ok = False
                if not ok:
                    continue
                roles = [(w, "opp_change" if booked_elsewhere(w, ib if w == ia else ia, pi) else "replacement")
                         for w in (ia, ib)]
            for who, role in roles:
                if role == "opp_change" and who in mem:
                    other = ib if who == ia else ia
                    first_s = first_sentence(info, other, txt, info["s0"] + (1 if other in mem else 0))
                else:
                    first_s = first_sentence(info, who, txt, info["s0"] + (1 if who in mem else 0))
                if first_s is None and fallback:
                    first_s = next((si for si in range(info["s0"], len(sents)) if fallback in sents[si]), None)
                if first_s is None:
                    first_s = info["s0"]
                days, basis = notice(info, first_s, info["s0"])
                snp = bool(re.search(r"short notice|late notice|last[- ]minute|late replacement", sents[first_s], re.I)) or \
                    bool(re.search(r"short notice|late notice|last[- ]minute", txt, re.I) and role == "replacement")
                put(who, role, days, basis, snp, info["head"], txt)
            handled = True
        if handled:
            continue
        # cross-paragraph: P booked (with a withdrawal) in one paragraph that never names Q; Q named as the
        # replacement in another paragraph
        for stay, new in ((ia, ib), (ib, ia)):
            bp = [pi for pi, inf in enumerate(para_info) if inf and inf["s0"] is not None and stay in inf["members"]
                  and new not in set(x[2] for x in card.mentions(paras[pi]["text"], prefer=paras[pi]["text"])[0])
                  and WITHDRAW_RE.search(paras[pi]["text"])]
            if not bp or booked_elsewhere(new, stay, -1):
                continue
            for pj, inf in enumerate(para_info):
                if not inf or pj in bp:
                    continue
                txt = paras[pj]["text"]
                for si, sen in enumerate(inf["sents"]):
                    mm, kk = card.mentions(sen, prefer=txt)
                    hit = [x for x in mm if x[2] == new]
                    if not hit:
                        continue
                    if not re.search(r"replaced by|(?:would|will|to) replace|as (?:a |his |her |the )?replacement|"
                                     r"stepped in|step in|stepping in|in (?:his|her) place|took (?:his|her) place",
                                     kk):
                        continue
                    if any(x[2] == stay for x in mm) is False and not re.search(r"replaced by", kk):
                        pass
                    days, basis = notice(inf, si, 0)
                    snp = bool(re.search(r"short notice|late notice|last[- ]minute", txt, re.I))
                    head = para_info[bp[0]]["head"]
                    put(new, "replacement", days, basis, snp, head, txt)
                    put(stay, "opp_change", days, basis, False, head, txt)
                    break
                if (fid, card.f[new]["side"]) in out:
                    break
    return out


def crowd_status(info, event_date, venue, fulltext):
    """'none' (behind closed doors), 'limited', or 'full'. Known before the fight from the announced policy."""
    att = (info.get("Attendance") or "").lower()
    t = fulltext.lower()
    closed = bool(re.search(r"behind closed doors|without (?:any )?(?:fans|spectators|an audience|a live audience)|"
                            r"no fans|closed to (?:the )?(?:public|fans)|empty arena|fans were not permitted|"
                            r"no spectators|no audience|without a crowd|no crowd|absence of fans", t))
    limited = bool(re.search(r"limited (?:number of )?(?:fans|crowd|capacity|attendance|audience)|reduced capacity|"
                             r"capacity (?:was |of the arena was )?(?:limited|capped|reduced)|socially distanced|"
                             r"\d+ ?(?:percent|%) capacity|limited fans", t))
    covid = dt.date(2020, 3, 14) <= event_date <= dt.date(2021, 12, 31)
    if att.startswith(("none", "no ")) or "closed doors" in att or re.match(r"^0\b", att):
        return "none", "infobox attendance %r" % info.get("Attendance")
    if covid and closed and not limited:
        return "none", "article text"
    if covid and limited:
        return "limited", "article text"
    if covid and "apex" in (venue or "").lower():
        return "none", "COVID period at the UFC Apex"
    if covid and closed:
        return "none", "article text"
    return "full", "default"


def event_type(name, date):
    n = name.lower()
    if re.match(r"ufc \d+\b", n):
        return "numbered_ppv" if date.year <= 2025 else "numbered"
    if "ultimate fighter" in n or "tuf" in n:
        return "tuf_finale"
    if re.match(r"ufc on (fox|abc|fx|fuel|espn|espn\+)", n) or "fight night" in n or "ufc on" in n or \
            n.startswith(("noche ufc", "ufc macao", "ufc macau")):
        return "fight_night"
    return "special"


def card_segment(raw):
    """Wikipedia results heading -> main_card | prelims | early_prelims | single_card."""
    if not raw:
        return None
    t = raw.lower()
    if "early" in t:
        return "early_prelims"
    if "prelim" in t:
        return "prelims"
    if "main" in t:
        return "main_card"
    if "fight card" in t or t.startswith("card"):
        return "single_card"
    return None


def country_ref(fx, iso3):
    """Geocoded reference city for a country: the city named by its representative IANA zone."""
    if iso3 not in COUNTRIES:
        return None
    tz = COUNTRIES[iso3][3]
    city = tz.rsplit("/", 1)[-1].replace("_", " ")
    city = {"Kyiv": "Kyiv", "Port of Spain": "Port of Spain", "Port-au-Prince": "Port-au-Prince",
            "Ho Chi Minh": "Ho Chi Minh City", "Efate": "Port Vila", "Pohnpei": "Palikir", "Hebron": "Ramallah",
            "Tongatapu": "Nuku'alofa", "Guam": "Hagatna", "Macau": "Macau", "Hong Kong": "Hong Kong",
            "Fiji": "Suva", "Apia": "Apia", "Mauritius": "Port Louis", "Cape Verde": "Praia",
            "Bahrain": "Manama", "Kuwait": "Kuwait City", "Qatar": "Doha", "Curacao": "Willemstad",
            "Panama": "Panama City", "Costa Rica": "San Jose", "El Salvador": "San Salvador",
            "Guatemala": "Guatemala City", "Guyana": "Georgetown", "Jamaica": "Kingston",
            "Grenada": "Saint George's", "Barbados": "Bridgetown", "Singapore": "Singapore",
            "Montevideo": "Montevideo"}.get(city, city)
    city = {"XKX": "Pristina", "LIE": "Vaduz"}.get(iso3, city)
    return geocode(fx, city, None, iso3)


def locality_parts(pl):
    parts = [p.strip() for p in pl.split(",") if p.strip()]
    return parts[0], (parts[1] if len(parts) > 1 else None)


# ------------------------------------------------------------------ build
DIV_LBS = {"Strawweight": 115, "Flyweight": 125, "Bantamweight": 135, "Featherweight": 145, "Lightweight": 155,
           "Welterweight": 170, "Middleweight": 185, "Light Heavyweight": 205, "Heavyweight": 265}


DIV_RE = re.compile(r"(women'?s )?(strawweight|flyweight|bantamweight|featherweight|lightweight|welterweight|"
                    r"middleweight|light heavyweight|heavyweight)\b([^.]{0,40}?)\blimit", re.I)
STD_LBS = {115, 125, 135, 145, 155, 170, 185, 205, 265}


def miss_limit(texts, title, ufc_wc, wiki_wc, cw_lbs, opp_lbs):
    """Scale limit (lbs) a weight miss is measured against, and where it came from."""
    t = " ".join(texts or [])
    m = DIV_RE.search(t)
    if m:
        name = m.group(2).title().replace("Light Heavyweight", "Light Heavyweight")
        tail = m.group(3).lower()
        is_title = "title" in tail and "non-title" not in tail and "non title" not in tail
        if name in DIV_LBS:
            return DIV_LBS[name] + (0 if is_title else 1), "division named in the weigh-in text"
    if re.search(r"catch ?weight", t, re.I) and cw_lbs:
        return cw_lbs + (0 if title else 1), "agreed catchweight"
    lim = division_limit(ufc_wc) if "catch" not in ufc_wc.lower() else None
    if lim:
        return lim + (0 if title else 1), "ufcstats weight class"
    lim = division_limit(wiki_wc or "") if wiki_wc and "catch" not in wiki_wc.lower() else None
    if lim:
        return lim + 1, "Wikipedia weight class"
    m2 = re.search(r"limit of (\d{3})|(\d{3})[- ]?(?:pound|lb)s?\.? (?:\w+ )?limit", t)
    if m2:
        return int(m2.group(1) or m2.group(2)), "stated limit"
    if opp_lbs in STD_LBS:
        return opp_lbs + 1, "opponent's listed division"
    return None, None


ALT_FIX = {"New Orleans": 2.0}      # cities the geocoder returns without an elevation


def division_limit(wc):
    w = wc.lower()
    for name in sorted(DIV_LBS, key=len, reverse=True):
        if name.lower() in w:
            if name == "Heavyweight" and "light heavyweight" in w:
                continue
            return DIV_LBS[name]
    return None


def utc_offset_h(tz, day):
    from zoneinfo import ZoneInfo
    try:
        t = dt.datetime(day.year, day.month, day.day, 12, tzinfo=dt.timezone.utc).astimezone(ZoneInfo(tz))
        return t.utcoffset().total_seconds() / 3600.0
    except Exception:
        return None


def haversine_km(a, b):
    if not a or not b or a[0] is None or b[0] is None:
        return None
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371.0 * math.asin(min(1.0, math.sqrt(h)))


# Training camps (Sherdog "association", first listed) -> (city, region, ISO3). Hand-made from public gym
# locations for the camps with the most UFC fighters; used only for the travel / time-zone / altitude home
# point, never for nationality. Sherdog shows the current camp, so this is a snapshot (see the research note).
GYMS = {
    "american top team": ("Coconut Creek", "Florida", "USA"), "kill cliff fc": ("Deerfield Beach", "Florida", "USA"),
    "sanford mma": ("Deerfield Beach", "Florida", "USA"), "hard knocks 365": ("Coconut Creek", "Florida", "USA"),
    "blackzilians": ("Boca Raton", "Florida", "USA"), "jaco hybrid training center": ("Boca Raton", "Florida", "USA"),
    "mma masters": ("Miami", "Florida", "USA"), "xtreme couture": ("Las Vegas", "Nevada", "USA"),
    "syndicate mma": ("Las Vegas", "Nevada", "USA"), "one kick's gym": ("Las Vegas", "Nevada", "USA"),
    "one kicks gym": ("Las Vegas", "Nevada", "USA"), "ufc performance institute": ("Las Vegas", "Nevada", "USA"),
    "jackson-wink mma": ("Albuquerque", "New Mexico", "USA"), "jackson wink mma": ("Albuquerque", "New Mexico", "USA"),
    "jackson's mma": ("Albuquerque", "New Mexico", "USA"), "jacksons mma": ("Albuquerque", "New Mexico", "USA"),
    "team alpha male": ("Sacramento", "California", "USA"), "mma lab": ("Glendale", "Arizona", "USA"),
    "the mma lab": ("Glendale", "Arizona", "USA"), "fight ready": ("Scottsdale", "Arizona", "USA"),
    "factory x": ("Englewood", "Colorado", "USA"), "elevation fight team": ("Denver", "Colorado", "USA"),
    "grudge training center": ("Arvada", "Colorado", "USA"), "tristar gym": ("Montreal", "Quebec", "CAN"),
    "nova uniao": ("Rio de Janeiro", "Rio de Janeiro", "BRA"), "fortis mma": ("Dallas", "Texas", "USA"),
    "alliance mma": ("Chula Vista", "California", "USA"), "city kickboxing": ("Auckland", None, "NZL"),
    "american kickboxing academy": ("San Jose", "California", "USA"), "sbg ireland": ("Dublin", None, "IRL"),
    "chute boxe diego lima": ("Sao Paulo", "Sao Paulo", "BRA"), "allstars training center": ("Stockholm", None, "SWE"),
    "valle flow striking": ("Brick", "New Jersey", "USA"), "roufusport": ("Milwaukee", "Wisconsin", "USA"),
    "kings mma": ("Huntington Beach", "California", "USA"), "team tiger schulmann": ("Elmwood Park", "New Jersey", "USA"),
    "team oyama": ("Irvine", "California", "USA"), "serra-longo fight team": ("East Meadow", "New York", "USA"),
    "renzo gracie philly": ("Philadelphia", "Pennsylvania", "USA"), "the fighting nerds": ("Sao Paulo", "Sao Paulo", "BRA"),
    "team quest": ("Gresham", "Oregon", "USA"), "cesar gracie fight team": ("Pleasant Hill", "California", "USA"),
    "teixeira mma & fitness": ("Danbury", "Connecticut", "USA"), "team nogueira": ("Rio de Janeiro", "Rio de Janeiro", "BRA"),
    "team kaobon": ("Liverpool", "England", "GBR"), "reign mma": ("Mission Viejo", "California", "USA"),
    "khk mma": ("Manama", None, "BHR"), "glory mma & fitness": ("Saint Charles", "Missouri", "USA"),
    "entram gym": ("Tijuana", "Baja California", "MEX"), "eagles mma": ("Makhachkala", "Dagestan", "RUS"),
    "duneland vale tudo": ("Chesterton", "Indiana", "USA"), "bellmore kickboxing academy": ("Bellmore", "New York", "USA"),
    "ufc gym costa mesa": ("Costa Mesa", "California", "USA"), "tiger muay thai": ("Phuket", None, "THA"),
    "team lloyd irvin": ("Camp Springs", "Maryland", "USA"), "mma factory": ("Paris", None, "FRA"),
    "team lakay": ("Baguio", "Cordillera", "PHL"), "evolve mma": ("Singapore", None, "SGP"),
    "pitbull brothers": ("Natal", "Rio Grande do Norte", "BRA"), "kings mma huntington beach": ("Huntington Beach", "California", "USA"), "team sityodtong": ("Somerville", "Massachusetts", "USA"),
    "macaco gold team": ("Rio de Janeiro", "Rio de Janeiro", "BRA"), "grudge": ("Arvada", "Colorado", "USA"),
    "akhmat fight team": ("Grozny", "Chechnya", "RUS"), "berkut": ("Grozny", "Chechnya", "RUS"),
    "dagestan national team": ("Makhachkala", "Dagestan", "RUS"),
    "fight spirit team": ("Saint Petersburg", None, "RUS"), "next generation mma liverpool": ("Liverpool", "England", "GBR"),
    "london shootfighters": ("London", "England", "GBR"), "team renegade": ("Birmingham", "England", "GBR"),
    "xtreme couture mma": ("Las Vegas", "Nevada", "USA"), "drysdale jiu jitsu": ("Las Vegas", "Nevada", "USA"),
    "extreme couture": ("Las Vegas", "Nevada", "USA"),
    "longo and weidman mma": ("Garden City", "New York", "USA"), "longo & weidman mma": ("Garden City", "New York", "USA"),
    "4oz. fight club": ("Coconut Creek", "Florida", "USA"), "combat club": ("Coconut Creek", "Florida", "USA"),
}


def gym_point(gfx, assoc):
    """Geocoded camp location for a Sherdog association list (first mapped entry wins)."""
    for a in assoc or []:
        k = re.sub(r"\s+", " ", fold(a).lower().strip())
        if k in GYMS:
            city, admin, iso3 = GYMS[k]
            g = geocode(gfx, city, admin, iso3)
            if g:
                return dict(g, gym=a, iso3=iso3)
    return None


def build_nationality(people, pids, items, wd, bios, gfx):
    """slug-keyed nationality records and person id -> home (iso3, tz, lat, lon, elevation)."""
    recs, home = {}, {}
    for pid in pids:
        P = people[pid]
        q = wd.get(pid)
        it = items[q[0]] if q else None
        b = bios.get(pid)
        votes = []
        src = {}
        if it:
            sc = [country_code(c) for c, _ in it["sc"].most_common()]
            cc = [country_code(c) for c, _ in it["cc"].most_common()]
            bc = [country_code(c) for c, _ in it["bc"].most_common()]
            src["wikidata"] = {"item": q[0].rsplit("/", 1)[-1], "match": q[1], "sport_country": sc, "citizenship": cc,
                               "birth_country": bc}
        else:
            sc = cc = bc = []
        sd = b["iso3"] if b else None
        if b:
            src["sherdog"] = {"nationality": b.get("nationality"), "birthplace": b.get("locality"),
                              "association": b.get("association")[:3] if b.get("association") else [],
                              "page": b.get("src")}
        # primary: Wikidata country for sport > Sherdog nationality > single citizenship > citizenship that
        # matches birth country > birth country > first citizenship
        primary, how = None, None
        sc = [c for c in sc if c]
        cc = [c for c in cc if c]
        bc = [c for c in bc if c]
        if sc:
            primary, how = sc[0], "wikidata country for sport"
        elif sd:
            primary, how = sd, "sherdog nationality"
        elif len(set(cc)) == 1:
            primary, how = cc[0], "wikidata citizenship"
        elif cc and set(cc) & set(bc):
            primary, how = sorted(set(cc) & set(bc))[0], "wikidata citizenship = birth country"
        elif bc:
            primary, how = bc[0], "wikidata birth country"
        elif cc:
            primary, how = cc[0], "wikidata citizenship (first of several)"
        allc = sorted(set(sc) | set(cc) | set(bc) | ({sd} if sd else set()))
        # home point: Sherdog birthplace when it lies in the primary country, else the country reference city
        bp = None
        if b and b.get("locality") and b.get("iso3") and b["iso3"] == primary:
            city, admin = locality_parts(b["locality"])
            bp = geocode(gfx, city, admin, primary)
        ref = country_ref(gfx, primary) if primary else None
        gp = gym_point(gfx, (b or {}).get("association"))
        pt = gp or bp or ref
        home[pid] = {"iso3": primary, "countries": allc, "tz": (pt or {}).get("tz") or
                     (COUNTRIES[primary][3] if primary in COUNTRIES else None),
                     "lat": (pt or {}).get("lat"), "lon": (pt or {}).get("lon"),
                     "elev": (pt or {}).get("elevation_m") if (gp or bp) else None,
                     "basis": ("camp: " + gp["gym"]) if gp else "birthplace" if bp else
                     ("country reference city" if ref else None)}
        recs[P["slug"]] = {"name": P["name"], "ufcstats_id": pid, "iso3": primary, "how": how,
                           "countries": allc, "country_name": COUNTRIES[primary][1] if primary in COUNTRIES else None,
                           "home_point": {"basis": home[pid]["basis"], "tz": home[pid]["tz"],
                                          "lat": home[pid]["lat"], "lon": home[pid]["lon"],
                                          "elevation_m": home[pid]["elev"]},
                           "sources": src}
    return recs, home


def cmd_build(args):
    t0 = time.time()
    events = load_ufcstats()
    wl = parse_event_list(open(wiki_path("List_of_UFC_events"), encoding="utf-8").read())
    wmatch, how = match_events(events, wl)
    fights, people = load_people_fights()
    fmap = {f.fid: f for f in fights}
    pids = sorted(target_persons(fights))
    items = load_wikidata()
    sdx = sherdog_index()
    wd = match_wikidata(people, pids, items, sdx)
    bios = load_sherdog_bios(fights=fights, people=people)
    gfx = Fetcher(offline=True)
    nat, home = build_nationality(people, pids, items, wd, bios, gfx)
    log("people %d: wikidata %d, sherdog %d, nationality known %d (%.1f s)" % (
        len(pids), len(wd), len(bios), sum(1 for r in nat.values() if r["iso3"]), time.time() - t0))
    out = {}
    stats = Counter()
    ev_meta = {}
    for ename, ev in sorted(events.items(), key=lambda kv: kv[1]["date"]):
        w = wmatch.get(ename)
        art = None
        if w and w.get("href"):
            p = wiki_path(title_of(w["href"]))
            if os.path.exists(p):
                art = parse_event_article_cached(p)
        city, admin, country = split_location(ev["location"])
        iso3 = country_code(country)
        g = dict(geocode(gfx, city, admin, iso3) or {})
        if g.get("elevation_m") is None and city in ALT_FIX:
            g["elevation_m"] = ALT_FIX[city]
        venue_name = (art or {}).get("infobox", {}).get("Venue") or (w or {}).get("venue")
        apex = bool(venue_name and "apex" in venue_name.lower())
        crowd, crowd_basis = crowd_status((art or {}).get("infobox", {}), ev["date"], venue_name,
                                          (art or {}).get("fulltext", "")) if art else ("full", "no article")
        etype = event_type(ename, ev["date"])
        venue = {"name": venue_name, "city": city, "region": admin, "country": country, "iso3": iso3,
                 "lat": g.get("lat"), "lon": g.get("lon"), "altitude_m": g.get("elevation_m"), "tz": g.get("tz"),
                 "apex": apex}
        voff = utc_offset_h(g["tz"], ev["date"]) if g.get("tz") else None
        card = Card(ev["bouts"])
        paras = (art or {}).get("paras", [])
        wi = parse_weighins(card, paras, ev["date"]) if art else {}
        bc = parse_bout_changes(card, paras, ev["date"]) if art else {}
        # results table rows -> bout (card segment, wiki weight class, note text)
        seg_of = {}
        for r in (art or {}).get("results", []):
            ma, _ = card.mentions(r["A"])
            mb, _ = card.mentions(r["B"])
            fa = {card.f[x[2]]["fid"] for x in ma}
            fb = {card.f[x[2]]["fid"] for x in mb}
            both = fa & fb
            if len(both) == 1:
                fid = both.pop()
                seg_of[fid] = {"segment": r["segment"], "wc": r["wc"],
                               "notes": [art["notes"].get(n, "") for n in r["note_ids"] if art["notes"].get(n)]}
        para_fids = [set(card.f[m[2]]["fid"] for m in card.mentions(p["text"], prefer=p["text"])[0]) for p in paras]
        ev_meta[ename] = {"wiki": (art or {}).get("canonical") or ((w or {}).get("href")), "venue": venue,
                          "crowd": crowd, "crowd_basis": crowd_basis, "event_type": etype}
        stats["events"] += 1
        stats["events_with_article"] += bool(art)
        n_bouts = len(ev["bouts"])
        for bi, b in enumerate(sorted(ev["bouts"], key=lambda b: b["idx"])):
            fid = b["fid"]
            f = fmap.get(fid)
            if f is None:
                stats["bouts_not_in_build_db"] += 1
                continue
            pa, pb = f.persons
            title = ("Title" in b["wc"] and "Tournament" not in b["wc"])
            lim = division_limit(b["wc"])
            seg = seg_of.get(fid, {})
            text_all = " ".join(p["text"] for p, fs in zip(paras, para_fids) if fid in fs)
            cw_lbs = None
            for src in [seg.get("wc") or ""] + seg.get("notes", []) + [text_all]:
                mm = CATCH_RE.search(src)
                if mm:
                    cw_lbs = int(next(x for x in mm.groups() if x))
                    break
            booked_cw = "catch" in b["wc"].lower() or (seg.get("wc") or "").lower().startswith("catch")
            rec = {"date": ev["date"].isoformat(), "event": ename, "A": people[pa]["slug"] if pa in people else None,
                   "B": people[pb]["slug"] if pb in people else None, "division": f.division, "title": title,
                   "missed_weight": {}, "missed": {}, "weighed": {}, "short_notice": {}, "replacement": {},
                   "opp_change": {}, "home": {}, "home_any": {}, "nat": {}, "tz_shift_h": {}, "travel_km": {},
                   "home_elev_m": {}}
            notes = []
            anymiss = False
            for side, pid in (("A", pa), ("B", pb)):
                m = wi.get((fid, side))
                if m and m["negated"] and not (m["lbs_over"] and m["explicit"] and
                                               re.search(r"no (?:further )?attempt|made no", " ".join(m["text"]))):
                    m = None             # "missed on his first attempt but made weight" -> not a miss
                opp_pid = pb if side == "A" else pa
                limit, limit_basis = (miss_limit(m["text"], title, b["wc"], seg.get("wc"), cw_lbs,
                                                 ((people.get(opp_pid) or {}).get("tott") or {}).get("lbs"))
                                      if m else (None, None))
                if m and not m["explicit"] and m["lbs_over"] is None:
                    # only "weighed in at W": a miss only if W is over the limit
                    if not (m["weighed"] and limit and m["weighed"] > limit):
                        m = None
                if not art:
                    rec["missed"][side] = None
                    rec["missed_weight"][side] = None
                    rec["weighed"][side] = None
                elif m:
                    anymiss = True
                    over = m["lbs_over"]
                    if over is None and m["weighed"] is not None and limit:
                        over = round(m["weighed"] - limit, 2)
                        if over <= 0 or over > 25:
                            over = None
                    rec["missed"][side] = True
                    rec["missed_weight"][side] = over
                    rec["weighed"][side] = m["weighed"]
                    notes.append("%s missed weight%s%s" % (side, " by %g lb" % over if over is not None else "",
                                                           " (weighed %g)" % m["weighed"] if m["weighed"] else ""))
                    stats["missed"] += 1
                    stats["missed_with_lbs"] += over is not None
                else:
                    rec["missed"][side] = False
                    rec["missed_weight"][side] = 0.0
                    rec["weighed"][side] = None
                c = bc.get((fid, side))
                if c and c["role"] == "replacement":
                    rec["replacement"][side] = True
                    rec["short_notice"][side] = c["days"]
                    rec["opp_change"][side] = None
                    notes.append("%s late replacement (%s days, %s%s)" % (
                        side, c["days"] if c["days"] is not None else "?", c["basis"] or "no date",
                        ", 'short notice'" if c["short_notice_phrase"] else ""))
                    stats["replacement"] += 1
                    stats["replacement_days"] += c["days"] is not None
                elif c:
                    rec["replacement"][side] = False
                    rec["short_notice"][side] = None
                    rec["opp_change"][side] = c["days"] if c["days"] is not None else -1
                    notes.append("%s opponent changed (%s days, %s)" % (
                        side, c["days"] if c["days"] is not None else "?", c["basis"] or "no date"))
                    stats["opp_change"] += 1
                else:
                    rec["replacement"][side] = False if art else None
                    rec["short_notice"][side] = None
                    rec["opp_change"][side] = None
                h = home.get(pid, {})
                rec["nat"][side] = h.get("iso3")
                rec["home"][side] = (h["iso3"] == iso3) if h.get("iso3") and iso3 else None
                rec["home_any"][side] = (iso3 in h["countries"]) if h.get("countries") and iso3 else None
                hoff = utc_offset_h(h["tz"], ev["date"]) if h.get("tz") else None
                if hoff is not None and voff is not None:
                    d = abs(hoff - voff) % 24
                    rec["tz_shift_h"][side] = round(min(d, 24 - d), 2)
                else:
                    rec["tz_shift_h"][side] = None
                km = haversine_km((h.get("lat"), h.get("lon")), (g.get("lat"), g.get("lon")))
                rec["travel_km"][side] = round(km) if km is not None else None
                rec["home_elev_m"][side] = h.get("elev")
            # opponent change marker -1 means "changed, date unknown"
            rec["catchweight"] = {"is": bool(booked_cw or anymiss), "lbs": cw_lbs,
                                  "why": "weight miss" if anymiss else ("booked" if booked_cw else None)}
            rec["venue"] = {k: venue[k] for k in ("city", "country", "iso3", "altitude_m", "apex")}
            rec["no_crowd"] = crowd == "none"
            rec["crowd"] = crowd
            rec["event_type"] = etype
            rec["card_segment"] = card_segment(seg.get("segment"))
            rec["bout_order"] = bi + 1           # 1 = main event (ufcstats lists the card top-down)
            rec["n_bouts"] = n_bouts
            rec["notes"] = notes
            rec["sources"] = {"wiki": title_of(ev_meta[ename]["wiki"]) if ev_meta[ename]["wiki"] else None,
                              "ufcstats_event": ev["ufcstats_event_id"]}
            chg = {s: {k: v for k, v in bc[(fid, s)].items() if k in ("role", "days", "basis", "booked_vs",
                                                                       "short_notice_phrase")}
                   for s in ("A", "B") if (fid, s) in bc}
            if chg:
                rec["change_detail"] = chg
            mtxt = {s: wi[(fid, s)]["text"][0][:240] for s in ("A", "B") if (fid, s) in wi}
            if mtxt:
                rec["weighin_text"] = mtxt
            out[fid] = rec
            stats["bouts"] += 1
    meta = {
        "built": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "tool": "tools/fightweek.py build",
        "coverage": dict(stats),
        "event_match": dict(how),
        "people": {"n": len(pids), "wikidata": len(wd), "sherdog": len(bios),
                   "nationality": sum(1 for r in nat.values() if r["iso3"])},
        "fields": {
            "missed_weight": "lbs over the limit at the official weigh-in (0 = no miss reported on Wikipedia; null = "
                             "no article, or a miss whose size the article does not give)",
            "missed": "true if the Wikipedia event article reports the fighter missing weight",
            "weighed": "reported scale weight for a miss (lbs) when the article gives it",
            "catchweight": "is: booked at catchweight (ufcstats / Wikipedia weight class) or contested off-weight "
                           "after a miss; lbs: agreed limit when stated; why: booked | weight miss",
            "short_notice": "days of notice for a late replacement (who stepped in for a withdrawn fighter); null "
                            "when not a replacement or when the article gives no date",
            "replacement": "true if the fighter replaced a withdrawn fighter (not booked in this pairing originally)",
            "opp_change": "the fighter's booked opponent was replaced: days before the event when the new opponent "
                          "was set (-1 = changed, date unknown); null = no change found",
            "home": "fighter's primary nationality (see fighters[slug]) equals the venue country",
            "home_any": "venue country is any of the fighter's countries (sport country, citizenships, birth "
                        "country, Sherdog nationality)",
            "tz_shift_h": "hours between the venue's UTC offset and the fighter's home point (birthplace if in his "
                          "primary country, else the country's reference city) on the event date, wrapped to <= 12",
            "travel_km": "great-circle km from that home point to the venue city",
            "venue.altitude_m": "venue city elevation (Open-Meteo geocoder / GeoNames)",
            "no_crowd": "event held behind closed doors (COVID-19 period)",
            "crowd": "none | limited | full",
            "event_type": "numbered_ppv (UFC ### through 2025) | numbered (2026+, no PPV) | fight_night (incl. UFC on "
                          "FOX/FX/Fuel/ESPN/ABC, Noche UFC, UFC Macao) | tuf_finale | special (UFC Freedom 250)",
            "sources": "wiki = en.wikipedia.org/wiki/<title>; ufcstats_event = ufcstats event id",
            "card_segment": "Wikipedia results-table heading: main_card | prelims | early_prelims | single_card",
            "bout_order": "1 = main event, ufcstats card order",
        },
        "walk_forward": "all fields are known before the fight; nationality and home point are a current snapshot",
        "events": {k: {"date": events[k]["date"].isoformat(), **v} for k, v in ev_meta.items()},
    }
    os.makedirs(DERIVED, exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump({"meta": meta, "fights": out, "fighters": nat}, fh, ensure_ascii=False, separators=(",", ":"))
    log("wrote %s: %d fights, %s (%.1f s)" % (OUT, len(out), dict(stats), time.time() - t0))


# ------------------------------------------------------------------ walk-forward check
def fit_logit(X, y, l2=1e-4, iters=50):
    """No-intercept logistic regression on mirrored data; returns beta, covariance for the unique fights."""
    import numpy as np
    Xm = np.vstack([X, -X])
    ym = np.concatenate([y, 1 - y])
    b = np.zeros(X.shape[1])
    for _ in range(iters):
        z = Xm @ b
        p = 1 / (1 + np.exp(-z))
        g = Xm.T @ (ym - p) - l2 * b
        H = (Xm * (p * (1 - p))[:, None]).T @ Xm + l2 * np.eye(len(b))
        step = np.linalg.solve(H, g)
        b += step
        if np.max(np.abs(step)) < 1e-9:
            break
    z = Xm @ b
    p = 1 / (1 + np.exp(-z))
    H = (Xm * (p * (1 - p))[:, None]).T @ Xm
    cov = np.linalg.pinv(H) * 2.0        # mirrored rows double the information of the unique fights
    return b, cov


def cmd_eval(args):
    import numpy as np
    import build_db as B
    fw = json.load(open(OUT, encoding="utf-8"))
    F = fw["fights"]
    fights, people = load_people_fights()
    _, pre, _ = B.run_elo(fights, 44, boost=1.5, store=True)
    nprior = Counter()
    rows = []
    for f in fights:
        a, b = f.persons
        if f.fid in F and f.winner in ("A", "B") and not a.startswith("amb:") and not b.startswith("amb:") \
                and dt.date(2012, 1, 1) <= f.date <= dt.date(2025, 12, 31):
            rows.append((f, nprior[a], nprior[b]))
        nprior[a] += 1
        nprior[b] += 1
    LN = math.log(10) / 400.0

    def feats(f, na, nb):
        r = F[f.fid]
        ra, rb = pre[f.fid]
        g = lambda d, s, default=0.0: (d.get(s) if d.get(s) is not None else default)
        ma, mb = float(bool(r["missed"].get("A"))), float(bool(r["missed"].get("B")))
        la = min(10.0, g(r["missed_weight"], "A") or (1.5 if ma else 0.0))
        lb = min(10.0, g(r["missed_weight"], "B") or (1.5 if mb else 0.0))
        rpa, rpb = float(bool(r["replacement"].get("A"))), float(bool(r["replacement"].get("B")))
        sna = float(rpa and r["short_notice"].get("A") is not None and r["short_notice"]["A"] <= 14)
        snb = float(rpb and r["short_notice"].get("B") is not None and r["short_notice"]["B"] <= 14)
        oca, ocb = float(r["opp_change"].get("A") is not None), float(r["opp_change"].get("B") is not None)
        lca = float(r["opp_change"].get("A") is not None and 0 <= r["opp_change"]["A"] <= 14)
        lcb = float(r["opp_change"].get("B") is not None and 0 <= r["opp_change"]["B"] <= 14)
        ha, hb = float(bool(r["home"].get("A"))), float(bool(r["home"].get("B")))
        full = 1.0 if r["crowd"] == "full" and not r["venue"]["apex"] else 0.0
        tza, tzb = g(r["tz_shift_h"], "A"), g(r["tz_shift_h"], "B")
        alt = (r["venue"]["altitude_m"] or 0) / 1000.0
        hi = 1.0 if alt >= 1.0 else 0.0
        ea = 1.0 if (r["home_elev_m"].get("A") or 0) >= 1000 else 0.0
        eb = 1.0 if (r["home_elev_m"].get("B") or 0) >= 1000 else 0.0
        elo = (ra - rb) * LN
        return {
            "elo": elo, "debut": float(na == 0) - float(nb == 0),
            "missed": ma - mb, "missed_lbs": la - lb,
            "replacement": rpa - rpb, "repl_le14d": sna - snb,
            "opp_change": oca - ocb, "opp_change_le14d": lca - lcb,
            "home": ha - hb, "home_x_fullcrowd": (ha - hb) * full, "home_x_nocrowd_or_apex": (ha - hb) * (1 - full),
            "home_fullcrowd_outside_usa": (ha - hb) * full * float(r["venue"]["iso3"] != "USA"),
            "home_fullcrowd_in_usa": (ha - hb) * full * float(r["venue"]["iso3"] == "USA"),
            "tz_shift_per6h": (tza - tzb) / 6.0,
            "altitude_adapted_at_altitude": (ea - eb) * hi,
            "elo_x_nocrowd": elo * float(r["no_crowd"]), "elo_x_altitude_km": elo * alt,
            "elo_x_catchweight": elo * float(r["catchweight"]["is"]),
            "elo_x_any_replacement": elo * float(bool(rpa or rpb)),
        }
    data = [(f, feats(f, na, nb), 1.0 if f.winner == "A" else 0.0) for f, na, nb in rows]
    names = list(data[0][1].keys())
    X = np.array([[d[1][k] for k in names] for d in data])
    y = np.array([d[2] for d in data])
    yr = np.array([d[0].date.year for d in data])
    tr = yr <= 2023
    va = (yr >= 2024) & (yr <= 2025)
    log("decisive fights: train 2012-2023 %d, validate 2024-2025 %d" % (tr.sum(), va.sum()))

    def ll(p, yy):
        p = np.clip(p, 1e-9, 1 - 1e-9)
        return -(yy * np.log(p) + (1 - yy) * np.log(1 - p))

    def sym_pred(Xs, bta):
        # symmetric by construction (no intercept): p(A) = sigma(x.b), p(B) = 1 - p(A)
        return 1 / (1 + np.exp(-(Xs @ bta)))
    res = {"n_train": int(tr.sum()), "n_val": int(va.sum()), "models": {}, "single": {}}
    base = ["elo", "debut"]
    ib = [names.index(k) for k in base]
    b0, c0 = fit_logit(X[tr][:, ib], y[tr])
    p0 = sym_pred(X[va][:, ib], b0)
    l0 = ll(p0, y[va])
    rng = np.random.default_rng(20261106)
    boot_idx = rng.integers(0, va.sum(), size=(2000, va.sum()))
    res["models"]["base: elo + debut"] = {"coef": dict(zip(base, map(float, b0))),
                                          "val_logloss": float(l0.mean()),
                                          "val_brier": float(((p0 - y[va]) ** 2).mean())}

    def summarize(cols, label):
        ii = [names.index(k) for k in cols]
        bb, cc = fit_logit(X[tr][:, ii], y[tr])
        p1 = sym_pred(X[va][:, ii], bb)
        l1 = ll(p1, y[va])
        d = l1 - l0
        bd = d[boot_idx].mean(axis=1)
        se = np.sqrt(np.diag(cc))
        out = {"coef": {k: {"b": float(bb[j]), "se": float(se[j]), "ci95": [float(bb[j] - 1.96 * se[j]),
                                                                            float(bb[j] + 1.96 * se[j])],
                            "z": float(bb[j] / se[j]) if se[j] > 0 else None,
                            "nonzero_train": int((X[tr][:, ii[j]] != 0).sum())}
                        for j, k in enumerate(cols)},
               "val_logloss": float(l1.mean()), "val_brier": float(((p1 - y[va]) ** 2).mean()),
               "val_delta_logloss_vs_base": float(d.mean()),
               "val_delta_ci95": [float(np.percentile(bd, 2.5)), float(np.percentile(bd, 97.5))]}
        # replication on the validation years (estimate only; not used to choose anything)
        bv, cv = fit_logit(X[va][:, ii], y[va])
        sv = np.sqrt(np.diag(cv))
        out["val_refit"] = {k: {"b": float(bv[j]), "ci95": [float(bv[j] - 1.96 * sv[j]), float(bv[j] + 1.96 * sv[j])],
                                "nonzero_val": int((X[va][:, ii[j]] != 0).sum())}
                            for j, k in enumerate(cols) if k not in base}
        res["models" if label.startswith("full") else "single"][label] = out
        return out
    extra = [k for k in names if k not in base]
    for k in extra:
        summarize(base + [k], k)
    # opp_change is (almost) the mirror of replacement inside a bout (one side stepped in, the other kept his
    # slot), so the two are collinear: the multi-feature models carry the replacement family only
    curated = base + ["missed", "replacement", "repl_le14d", "home_x_fullcrowd", "home_x_nocrowd_or_apex"]
    full = summarize(curated, "full: elo + debut + missed + replacement + repl_le14d + home x crowd")
    summarize([k for k in names if not k.startswith("opp_change") and k not in ("home_fullcrowd_outside_usa",
                                                                                "home_fullcrowd_in_usa")],
              "full_all: every feature except opp_change")
    summarize(base + ["replacement", "repl_le14d"], "pair: replacement + repl_le14d")
    summarize(base + ["missed", "replacement", "repl_le14d"], "full_nohome: elo + debut + missed + replacement + repl_le14d")
    summarize(base + ["missed", "replacement", "repl_le14d", "home_fullcrowd_outside_usa"],
              "full_intl: elo + debut + missed + replacement + repl_le14d + home outside USA")
    # report
    log("\nbase (elo + debut): coef %s; val log loss %.4f, Brier %.4f" % (
        {k: round(v, 3) for k, v in res["models"]["base: elo + debut"]["coef"].items()}, l0.mean(),
        ((p0 - y[va]) ** 2).mean()))
    log("\n%-30s %8s %18s %7s %6s | %9s %22s | %s" % ("feature (Elo+debut+x)", "b", "95% CI (train)", "z", "n!=0",
                                                     "dLL val", "95% CI", "val refit b [CI]"))
    for k in extra:
        o = res["single"][k]
        c = o["coef"][k]
        vr = o["val_refit"][k]
        log("%-30s %8.3f [%7.3f, %7.3f] %7.2f %6d | %+9.5f [%+9.5f, %+9.5f] | %6.3f [%.2f, %.2f] n=%d" % (
            k, c["b"], c["ci95"][0], c["ci95"][1], c["z"] or 0, c["nonzero_train"], o["val_delta_logloss_vs_base"],
            o["val_delta_ci95"][0], o["val_delta_ci95"][1], vr["b"], vr["ci95"][0], vr["ci95"][1], vr["nonzero_val"]))
    for lab, o in list(res["models"].items())[1:]:
        log("\n%s: val log loss %.4f (base %.4f), delta %+.5f [%+.5f, %+.5f]" % (
            lab, o["val_logloss"], l0.mean(), o["val_delta_logloss_vs_base"], *o["val_delta_ci95"]))
        for k, c in o["coef"].items():
            log("   %-30s %8.3f [%7.3f, %7.3f]" % (k, c["b"], c["ci95"][0], c["ci95"][1]))
    # home advantage by period: fights with exactly one home fighter, full crowd, not the Apex
    jh, je = names.index("home_x_fullcrowd"), names.index("elo")
    per = {}
    for lo, hi in ((2012, 2015), (2016, 2019), (2020, 2023), (2024, 2025)):
        m = (yr >= lo) & (yr <= hi) & (X[:, jh] != 0)
        won = np.where(X[m, jh] > 0, y[m], 1 - y[m])
        ex = 1 / (1 + np.exp(-np.where(X[m, jh] > 0, X[m, je], -X[m, je]) * b0[0]))
        per["%d-%d" % (lo, hi)] = {"n": int(m.sum()), "home_win": float(won.mean()) if m.sum() else None,
                                   "elo_expected": float(ex.mean()) if m.sum() else None}
    res["home_by_period"] = per
    # home side by venue country group and period (which crowds carried the early home edge)
    vc = np.array([F[d[0].fid]["venue"]["iso3"] or "" for d in data])
    grp = {}
    for g_name, sel in (("Brazil", vc == "BRA"), ("USA", vc == "USA"), ("other", (vc != "BRA") & (vc != "USA"))):
        for lo, hi in ((2012, 2019), (2020, 2025)):
            m = sel & (yr >= lo) & (yr <= hi) & (X[:, jh] != 0)
            won = np.where(X[m, jh] > 0, y[m], 1 - y[m])
            ex = 1 / (1 + np.exp(-np.where(X[m, jh] > 0, X[m, je], -X[m, je]) * b0[0]))
            grp["%s %d-%d" % (g_name, lo, hi)] = {"n": int(m.sum()), "home_win": float(won.mean()) if m.sum() else None,
                                                  "elo_expected": float(ex.mean()) if m.sum() else None}
    res["home_by_country_period"] = grp
    log("home side by venue country: " + json.dumps(
        {k: {kk: (round(vv, 3) if isinstance(vv, float) else vv) for kk, vv in v.items()} for k, v in grp.items()}))
    log("\nhome side (one home fighter, full crowd): " + json.dumps(
        {k: {kk: (round(vv, 3) if isinstance(vv, float) else vv) for kk, vv in v.items()} for k, v in per.items()}))
    # weight-miss size buckets (train years)
    jm, jl = names.index("missed"), names.index("missed_lbs")
    mb = {}
    for lo, hi in ((0, 1.99), (2, 3.99), (4, 99)):
        m = tr & (np.abs(X[:, jm]) == 1) & (np.abs(X[:, jl]) >= lo) & (np.abs(X[:, jl]) <= hi)
        won = np.where(X[m, jm] > 0, y[m], 1 - y[m])
        ex = 1 / (1 + np.exp(-np.where(X[m, jm] > 0, X[m, je], -X[m, je]) * b0[0]))
        mb["%g-%g lb" % (lo, hi)] = {"n": int(m.sum()), "misser_win": float(won.mean()) if m.sum() else None,
                                     "elo_expected": float(ex.mean()) if m.sum() else None}
    res["missed_by_size_train"] = mb
    log("weight miss by size (train, one misser): " + json.dumps(
        {k: {kk: (round(vv, 3) if isinstance(vv, float) else vv) for kk, vv in v.items()} for k, v in mb.items()}))
    # descriptive base rates (train years): win rate of the side with the flag, symmetric
    desc = {}
    for k in ("missed", "replacement", "repl_le14d", "opp_change", "home", "home_x_fullcrowd"):
        j = names.index(k)
        m = tr & (X[:, j] != 0)
        won = np.where(X[m, j] > 0, y[m], 1 - y[m])
        elo_exp = 1 / (1 + np.exp(-np.where(X[m, j] > 0, X[m, names.index("elo")], -X[m, names.index("elo")])))
        desc[k] = {"n": int(m.sum()), "win_rate_flagged_side": float(won.mean()) if m.sum() else None,
                   "elo_expected": float(elo_exp.mean()) if m.sum() else None}
    res["descriptive_train"] = desc
    log("\ndescriptive (train years, flagged side): " + json.dumps({k: {kk: (round(vv, 3) if isinstance(vv, float) else vv)
                                                                          for kk, vv in v.items()} for k, v in desc.items()}))
    fw["meta"]["eval"] = res
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(fw, fh, ensure_ascii=False, separators=(",", ":"))
    log("eval stored in %s meta.eval" % OUT)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["fetch-wiki", "fetch-geo", "fetch-sherdog", "build", "eval", "all"])
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--no-search", action="store_true", help="fetch-sherdog: skip the name-search pass")
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
