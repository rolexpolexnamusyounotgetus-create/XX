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
    "ZAF": ("ZA", "South Africa", [], "Africa/Johannesburg", "AF"),
    "NGA": ("NG", "Nigeria", [], "Africa/Lagos", "AF"),
    "CMR": ("CM", "Cameroon", [], "Africa/Douala", "AF"),
    "COD": ("CD", "DR Congo", ["democratic republic of the congo", "congo kinshasa", "dr congo", "drc"],
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
}


def geocode(fx, city, admin, iso3):
    """Best Open-Meteo geocoder hit for a city in a country (admin region as a tiebreak)."""
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


def sherdog_page_paths(href_or_id):
    """Cached Sherdog page locations: preufc's cache first, then this tool's."""
    if re.match(r"^\d+$", str(href_or_id)):
        return [os.path.join(SD_DIR, "fighter", "id-%s.html" % href_or_id)]
    tail = href_or_id.rsplit("/", 1)[-1]
    return [os.path.join(SD_OLD, "fighter", tail + ".html"), os.path.join(SD_DIR, "fighter", tail + ".html")]


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


def load_sherdog_bios(offline=True, fights=None, people=None):
    """person id -> Sherdog bio (nationality, birthplace, association, iso3) from the caches only."""
    if fights is None:
        fights, people = load_people_fights()
    T = target_persons(fights)
    items = load_wikidata()
    sdx = sherdog_index()
    wd = match_wikidata(people, list(T), items, sdx)
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
        b = parse_sherdog_bio(html) if html else None
        if b:
            b["iso3"] = country_code(b["nationality"])
            b["src"] = src
            out[pid] = b
    return out


def locality_parts(pl):
    parts = [p.strip() for p in pl.split(",") if p.strip()]
    return parts[0], (parts[1] if len(parts) > 1 else None)


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
