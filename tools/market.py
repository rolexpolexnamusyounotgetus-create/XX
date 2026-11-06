#!/usr/bin/env python3
"""Historical UFC betting odds: assemble, match to ufcstats fights, evaluate the market.

Engine v9 component (docs/ROADMAP.md): benchmark the engine against the betting market and give the
stacking/recalibration layer a market input.

Sources (all public, credited in the output meta and in research/model_market.md):
  1. nlbair/ufc-data v0.1.1 (CC BY 4.0, Zenodo 10.5281/zenodo.23458636): BestFightOdds opening line
     and closing range (low/high across books) for every UFC fight 2013-02-16 .. 2026-10-10, keyed by
     the ufcstats fight id.
  2. Ultimate UFC Dataset (mdabbert / shortlikeafox, CC BY 4.0): one moneyline per fighter, 2010 ..
     2026-03-28; used as an independent cross-check.
  3. BestFightOdds.com, fetched politely by this tool (robots.txt allows everything but /cnadm/;
     one request every 2-3 s, gzip, cached): event pages (per-book closing lines for the US books BFO
     lists today, which covers events from about 2021 on) and fighter pages (opening line, closing
     range and BFO's mean-odds series per side; its last point is the mean of the books' closing
     decimal odds).

Usage (from the project root):
  python3 -I tools/market.py fetch --cache DIR       # sources + BFO pages -> data/raw/odds/*.csv
  python3 -I tools/market.py build                   # match + evaluate -> data/derived/market.json

Downloaded pages are untrusted data: they are parsed with regular expressions only, never executed.
"""

import argparse
import datetime as dt
import gzip
import json
import math
import os
import random
import re
import ssl
import subprocess
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ODDS_DIR = os.path.join(ROOT, 'data', 'raw', 'odds')
BACKTEST = os.path.join(ROOT, 'data', 'derived', 'backtest.json')
OUT_JSON = os.path.join(ROOT, 'data', 'derived', 'market.json')
BFO = 'https://www.bestfightodds.com'
UA = ('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) '
      'Chrome/124.0 Safari/537.36')
NLBAIR_GIT = 'https://github.com/nlbair/ufc-data.git'
UUD_GIT = 'https://github.com/shortlikeafox/ultimate_ufc_dataset.git'

# Books BFO lists on event pages (data-b ids). Prediction markets are kept but never enter the
# sportsbook consensus.
EXCHANGES = {'Polymarket', 'Kalshi'}


# ----------------------------------------------------------------------------------------------
# small helpers
# ----------------------------------------------------------------------------------------------

def am_to_dec(a):
    """American moneyline -> decimal odds."""
    if a is None:
        return None
    a = float(a)
    if a == 0 or (-100 < a < 100):
        return None
    return 1 + a / 100.0 if a > 0 else 1 + 100.0 / abs(a)


def dec_to_am(d):
    if d is None or d <= 1:
        return None
    return round((d - 1) * 100) if d >= 2 else round(-100 / (d - 1))


def parse_am(s):
    if s is None:
        return None
    s = str(s).strip().replace('−', '-')
    if s.upper() in ('EV', 'EVEN'):
        return 100
    m = re.fullmatch(r'([+-]?\d+)', s)
    if not m:
        return None
    v = int(m.group(1))
    return v if abs(v) >= 100 else None


def norm_name(s):
    s = unicodedata.normalize('NFKD', str(s)).encode('ascii', 'ignore').decode().lower()
    s = re.sub(r"[\.\'`]", '', s)
    s = re.sub(r'[^a-z0-9]+', ' ', s)
    toks = [t for t in s.split() if t not in ('jr', 'sr', 'ii', 'iii', 'iv', 'de', 'da', 'dos', 'do')]
    return ' '.join(toks)


def name_sim(a, b):
    """Similarity in [0, 1] robust to token order, middle names and small spelling differences."""
    import difflib
    a, b = norm_name(a), norm_name(b)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    ta, tb = a.split(), b.split()
    if sorted(ta) == sorted(tb):
        return 0.98
    seq = difflib.SequenceMatcher(None, a, b).ratio()
    # token overlap with fuzzy token equality
    def tok_eq(x, y):
        return x == y or (len(x) > 3 and len(y) > 3 and difflib.SequenceMatcher(None, x, y).ratio() >= 0.8)
    hits = sum(1 for x in ta if any(tok_eq(x, y) for y in tb))
    cover = hits / max(1, min(len(ta), len(tb)))
    last = 1.0 if tok_eq(ta[-1], tb[-1]) else 0.0
    return max(seq, 0.55 * cover + 0.35 * last + 0.10 * seq if cover >= 1 else 0.6 * seq + 0.4 * cover * last)


def write_csv(path, rows, cols):
    import csv
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', newline='', encoding='utf-8') as fh:
        w = csv.writer(fh)
        w.writerow(cols)
        for r in rows:
            w.writerow(['' if r.get(c) is None else r.get(c) for c in cols])


def read_csv(path):
    import csv
    with open(path, newline='', encoding='utf-8') as fh:
        return list(csv.DictReader(fh))


# ----------------------------------------------------------------------------------------------
# polite fetcher with an on-disk cache
# ----------------------------------------------------------------------------------------------

class Fetcher:
    def __init__(self, cache, delay=2.0, jitter=1.0, refresh=False):
        self.cache = cache
        self.delay = delay
        self.jitter = jitter
        self.refresh = refresh
        self.last = 0.0
        self.n_net = 0
        ca = '/root/.ccr/ca-bundle.crt'
        self.ctx = ssl.create_default_context(cafile=ca) if os.path.exists(ca) else ssl.create_default_context()
        os.makedirs(cache, exist_ok=True)

    def path_for(self, url):
        p = re.sub(r'^https?://[^/]+/', '', url).strip('/') or 'index'
        p = re.sub(r'[^A-Za-z0-9_.-]+', '_', p)
        return os.path.join(self.cache, p + '.html.gz')

    def get(self, url, max_age_days=None):
        fp = self.path_for(url)
        if os.path.exists(fp) and not self.refresh:
            age = (time.time() - os.path.getmtime(fp)) / 86400
            if max_age_days is None or age <= max_age_days:
                with gzip.open(fp, 'rt', encoding='utf-8', errors='replace') as fh:
                    return fh.read()
        for attempt in range(5):
            wait = self.delay + random.random() * self.jitter - (time.time() - self.last)
            if wait > 0:
                time.sleep(wait)
            self.last = time.time()
            req = urllib.request.Request(url, headers={
                'User-Agent': UA, 'Accept-Encoding': 'gzip',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9'})
            try:
                with urllib.request.urlopen(req, timeout=60, context=self.ctx) as r:
                    raw = r.read()
                    if r.headers.get('Content-Encoding') == 'gzip':
                        raw = gzip.decompress(raw)
                    txt = raw.decode('utf-8', errors='replace')
                self.n_net += 1
                with gzip.open(fp, 'wt', encoding='utf-8') as fh:
                    fh.write(txt)
                return txt
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    return None
                if e.code in (403, 407):
                    raise SystemExit(f'blocked ({e.code}) on {url}; stopping politely')
                time.sleep(10 * (attempt + 1) ** 2)
            except Exception as e:  # network hiccup
                print(f'  retry {attempt + 1} {url}: {e}', file=sys.stderr)
                time.sleep(10 * (attempt + 1) ** 2)
        return None


# ----------------------------------------------------------------------------------------------
# BestFightOdds parsers (regex only)
# ----------------------------------------------------------------------------------------------

MONTHS = {m: i for i, m in enumerate(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep',
                                      'oct', 'nov', 'dec'], 1)}


def parse_sitemap_events(xml):
    out = []
    for loc, lastmod in re.findall(r'<loc>([^<]*)</loc><lastmod>([^<]*)</lastmod>', xml):
        m = re.search(r'/events/([a-z0-9-]+)-(\d+)$', loc)
        if not m:
            continue
        out.append({'url': loc, 'slug': m.group(1), 'event_id': int(m.group(2)), 'lastmod': lastmod[:10]})
    return out


def is_ufc_mma_event(slug):
    if not re.match(r'(noche-)?ufc', slug):
        return False
    return not re.match(r'ufc-bjj', slug)


def parse_event_page(html):
    """-> {title, date, books{id: name}, matchups[{mu, t1_url, t1_name, t2_url, t2_name, lines{book:[a1,a2]}}]}"""
    title = (re.findall(r'<title>([^<]*)', html) or [''])[0]
    date = None
    m = re.search(r'([A-Z][a-z]{2})[a-z]* (\d{1,2}), (\d{4}) \|', title)
    if m and m.group(1).lower() in MONTHS:
        date = dt.date(int(m.group(3)), MONTHS[m.group(1).lower()], int(m.group(2))).isoformat()
    starts = [x.start() for x in re.finditer(r'<table class="odds-table"', html)]
    if not starts:
        return {'title': title, 'date': date, 'books': {}, 'matchups': []}
    t = html[starts[-1]:]
    t = t[:t.find('</table>')]
    books = {}
    for bid, name in re.findall(r'<th scope="col" data-b="(\d+)"[^>]*>(?:<a[^>]*>|<span[^>]*>)([^<]+)', t):
        books[int(bid)] = name.strip()
    matchups = {}
    order = []
    for row in re.findall(r'<tr[^>]*>(.*?)</tr>', t, re.S):
        if '<th scope="row"' not in row:
            continue
        fm = re.search(r'href="(/fighters/[^"]+)"><span class="t-b-fcc">([^<]+)</span>', row)
        if not fm:
            continue  # prop rows have no fighter link
        cells = re.findall(r'data-li="\[(\d+),(\d),(\d+)\]"><span[^>]*>([^<]+)</span>', row)
        mu_m = re.search(r'data-li="\[(\d),(\d+)\]"', row)  # mean-chart button: [team, matchup]
        if not mu_m:
            continue
        team, mu = int(mu_m.group(1)), int(mu_m.group(2))
        if mu not in matchups:
            matchups[mu] = {'mu': mu, 'lines': {}}
            order.append(mu)
        rec = matchups[mu]
        rec[f't{team}_url'] = fm.group(1)
        rec[f't{team}_name'] = unescape(fm.group(2))
        for bid, tm, mu2, val in cells:
            if int(mu2) != mu:
                continue
            a = parse_am(val)
            if a is None:
                continue
            rec['lines'].setdefault(books.get(int(bid), bid), [None, None])[int(tm) - 1] = a
    return {'title': title, 'date': date, 'books': books, 'matchups': [matchups[m] for m in order]}


def unescape(s):
    import html as _h
    return _h.unescape(s).strip()


def parse_fighter_page(html):
    """-> list of {mu, owner_team, owner_url, opp_url, owner_name, opp_name, event_url, event_name,
    date_text, open1, lo1, hi1, open2, lo2, hi2 (1 = owner), spark (owner's mean decimal series)}"""
    i = html.find('<table class="team-stats-table"')
    if i < 0:
        return []
    t = html[i:html.find('</table>', i)]
    rows = re.findall(r'<tr([^>]*)>(.*?)</tr>', t, re.S)
    out = []
    cur_event = (None, None, None)
    k = 0
    while k < len(rows):
        attrs, body = rows[k]
        if 'event-header' in attrs:
            em = re.search(r'<a href="(/events/[^"]+)">([^<]*)</a>\s*([^<]*)</td>', body)
            if em:
                cur_event = (em.group(1), unescape(em.group(2)), em.group(3).strip())
            k += 1
            continue
        if 'main-row' in attrs and k + 1 < len(rows):
            body2 = rows[k + 1][1]
            f1 = re.search(r'href="(/fighters/[^"]+)">([^<]+)</a>', body)
            f2 = re.search(r'href="(/fighters/[^"]+)">([^<]+)</a>', body2)
            v1 = [parse_am(x) for x in re.findall(r'<span id="oID\d+">([^<]*)</span>', body)]
            v2 = [parse_am(x) for x in re.findall(r'<span id="oID\d+">([^<]*)</span>', body2)]
            sp = re.search(r'data-sparkline="([^"]*)" data-li="\[(\d+),(\d)\]"', body)
            mu = team = None
            spark = []
            if sp:
                spark = [float(x) for x in sp.group(1).split(',') if x.strip()]
                mu, team = int(sp.group(2)), int(sp.group(3))
            else:
                lm = re.search(r'data-li="\[(\d+),(\d)\]"', body)
                if lm:
                    mu, team = int(lm.group(1)), int(lm.group(2))
            # cells may be missing (n/a): pad to open, lo, hi
            def pad(v):
                return (v + [None, None, None])[:3]
            o1, l1, h1 = pad(v1)
            o2, l2, h2 = pad(v2)
            out.append({'mu': mu, 'owner_team': team,
                        'owner_url': f1.group(1) if f1 else None, 'owner_name': unescape(f1.group(2)) if f1 else None,
                        'opp_url': f2.group(1) if f2 else None, 'opp_name': unescape(f2.group(2)) if f2 else None,
                        'event_url': cur_event[0], 'event_name': cur_event[1], 'date_text': cur_event[2],
                        'open1': o1, 'lo1': l1, 'hi1': h1, 'open2': o2, 'lo2': l2, 'hi2': h2,
                        'spark': spark})
            k += 2
            continue
        k += 1
    return out


def parse_date_text(s):
    m = re.match(r'([A-Z][a-z]{2})[a-z]* (\d{1,2})(?:st|nd|rd|th)? (\d{4})', s or '')
    if not m or m.group(1).lower() not in MONTHS:
        return None
    return dt.date(int(m.group(3)), MONTHS[m.group(1).lower()], int(m.group(2))).isoformat()
