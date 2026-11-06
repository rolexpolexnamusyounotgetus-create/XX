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


def load_sherdog_bios(offline=True, fights=None, people=None):
    """person id -> Sherdog bio (nationality, birthplace, association, iso3) from the caches only."""
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
        b = parse_sherdog_bio(html) if html else None
        if b:
            b["iso3"] = country_code(b["nationality"])
            b["src"] = src
            out[pid] = b
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
        k = self.key(text)
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
                        if len(gap_after) > 160:
                            continue
                        subj_here.extend(g[2] for g in group)
                    else:
                        pron = re.search(r"\b(he|she|both fighters|both|the pair|they|the former|the latter)\b",
                                         k[:tm.start()])
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
            weights = [(m.start(), wnum(m.group(1))) for m in W_RE.finditer(k)]
            overs = [(m.start(), wnum(m.group(1))) for m in OVER_RE.finditer(k)] + \
                    [(m.start(), wnum(m.group(1))) for m in BY_RE.finditer(k)]
            weights = [(p, w) for p, w in weights if w and 100 <= w <= 300]
            overs = [(p, o) for p, o in overs if o is not None and 0 < o < 30]
            respectively = "respectively" in k
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
                rec = out.get(key) or {"lbs_over": None, "weighed": None, "text": [], "negated": False}
                if negated and not wmap.get(si) and not omap.get(si):
                    rec["negated"] = True
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
    # explicit dates
    for m in re.finditer(r"\b(?:on |by |as of )?(%s) (\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{4}))?\b" % MON_RE, k):
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
                      r"(?:expected|scheduled|slated|set|booked|linked|rumou?red|planned|announced|targeted|due|"
                      r"supposed|tabbed to face|paired|pencil(?:l)?ed)\b|\bbout between\b|\bmatch-?up between\b|"
                      r"\bpairing (?:between|of)\b|\bcontest between\b|\bfight between\b|\brematch between\b|"
                      r"\btrilogy (?:bout|fight) between\b|\bwas expected\b|\bwere expected\b", re.I)
REPL_RE = re.compile(r"replaced by|replacement|replacing|replace |stepped in|stepping in|step in|stepped up|"
                     r"filled in|fill in|took (?:the|his|her|their) (?:bout|fight|place|spot)|in (?:his|her) place|"
                     r"instead face|instead faced|instead fought|instead meet|will now face|now faces?|"
                     r"new opponent|was tabbed|was named as|was brought in|short notice|in turn|"
                     r"faced [^.]{0,60} instead|will face [^.]{0,60} instead|instead|was announced as|"
                     r"took on|was rebooked|was re-?booked|was moved to face|was paired with|opponent change|"
                     r"subsequently|was rescheduled to face|was then expected to face|was then scheduled",
                     re.I)
WITHDRAW_RE = re.compile(r"\b(?:however|but|pulled out|withdr|forced|removed|out of the|injur|due to|scrapped|"
                         r"cancel|replaced|ruled out|was pulled|sidelined|illness|visa|suspend|tested positive)\b", re.I)


def parse_bout_changes(card, paras, event_date):
    """Per (fid, side): {"role": "replacement"|"opp_change", "days": int|None, "basis": str,
    "short_notice_phrase": bool, "other": original opponent / replaced fighter text, "text": paragraph}."""
    sched_members = defaultdict(set)      # fighter idx -> paragraphs where he is in the original booking
    para_info = []
    for pi, para in enumerate(paras):
        txt = para["text"]
        if para.get("sec") == "note":
            continue
        sents = split_sentences(txt)
        s0 = None
        for si, s in enumerate(sents):
            if SCHED_RE.search(s):
                s0 = si
                break
        if s0 is None:
            para_info.append(None)
            continue
        s0txt = sents[s0]
        sm = SCHED_RE.search(s0txt)
        head = s0txt
        wm = WITHDRAW_RE.search(s0txt, sm.end() if sm else 0)
        if wm:
            head = s0txt[:wm.start()]
        hm, _ = card.mentions(head, prefer=txt)
        members = set(x[2] for x in hm)
        for i in members:
            sched_members[i].add(pi)
        para_info.append({"sents": sents, "s0": s0, "members": members, "head": head})
    out = {}
    bouts = defaultdict(list)
    for i, x in enumerate(card.f):
        bouts[x["fid"]].append(i)
    for fid, (ia, ib) in bouts.items():
        for pi, info in enumerate(para_info):
            if info is None:
                continue
            txt = paras[pi]["text"]
            sents = info["sents"]
            ms_all, k_all = card.mentions(txt, prefer=txt)
            names_here = set(x[2] for x in ms_all)
            if ia not in names_here and ib not in names_here:
                continue
            if not REPL_RE.search(txt):
                continue
            mem = info["members"]
            if ia in mem and ib in mem:
                continue       # the final pairing was the original booking in this paragraph
            if ia not in names_here or ib not in names_here:
                # one side mentioned only: count it if the paragraph books him with someone else, and the
                # other side is the replacement named in another paragraph ("In turn, ... will face X")
                continue
            for stay, new in ((ia, ib), (ib, ia)):
                if stay in mem and new not in mem:
                    roles = ((stay, "opp_change"), (new, "opp_change" if sched_members.get(new) - {pi} else "replacement"))
                    break
            else:
                if ia not in mem and ib not in mem:
                    roles = ((ia, "replacement" if not (sched_members.get(ia, set()) - {pi}) else "opp_change"),
                             (ib, "replacement" if not (sched_members.get(ib, set()) - {pi}) else "opp_change"))
                else:
                    continue
            # notice: sentence where the later side first appears after the booking sentence
            for who, role in roles:
                first_s = None
                for si in range(info["s0"], len(sents)):
                    mm, _ = card.mentions(sents[si], prefer=txt)
                    if any(x[2] == who for x in mm) and (si > info["s0"] or who not in mem):
                        first_s = si
                        break
                if role == "opp_change":
                    # when did his opponent change: the sentence naming the new opponent
                    other = ib if who == ia else ia
                    for si in range(info["s0"], len(sents)):
                        mm, _ = card.mentions(sents[si], prefer=txt)
                        if any(x[2] == other for x in mm):
                            first_s = si
                            break
                if first_s is None:
                    first_s = info["s0"]
                days, basis, rel = None, None, None
                for si in range(first_s, info["s0"] - 1, -1):
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
                rep_sent = sents[first_s]
                snp = bool(re.search(r"short notice|late notice|last[- ]minute|late replacement", rep_sent, re.I)) or \
                    bool(re.search(r"short notice|late notice|last[- ]minute", txt, re.I) and role == "replacement")
                fx = card.f[who]
                key = (fx["fid"], fx["side"])
                prev = out.get(key)
                rec = {"role": role, "days": days, "basis": basis, "short_notice_phrase": snp,
                       "booked_vs": clean_text(info["head"])[:200], "text": txt[:600]}
                # keep the strongest evidence: a replacement beats an opponent change; dated beats undated
                if prev is None or (prev["role"] == "opp_change" and role == "replacement") or \
                        (prev["role"] == role and prev["days"] is None and days is not None):
                    out[key] = rec
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
    covid = dt.date(2020, 3, 14) <= event_date <= dt.date(2021, 4, 23)
    if att.startswith(("none", "0", "no ", "n/a")) and covid:
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
    if re.match(r"ufc on (fox|abc|fx|fuel|espn|espn\+)", n) or "fight night" in n or "ufc on" in n:
        return "fight_night"
    return "other"


def locality_parts(pl):
    parts = [p.strip() for p in pl.split(",") if p.strip()]
    return parts[0], (parts[1] if len(parts) > 1 else None)


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
