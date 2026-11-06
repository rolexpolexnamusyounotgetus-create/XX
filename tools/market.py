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


# ----------------------------------------------------------------------------------------------
# ufcstats side: backtest fights
# ----------------------------------------------------------------------------------------------

def load_backtest():
    with open(BACKTEST) as fh:
        bt = json.load(fh)
    return bt['fights']


def match_matchups(fights, cands, day_tol=2, min_sim=0.72):
    """Assign candidate odds rows to ufcstats fights.

    fights: [{id, date, A_name, B_name}]; cands: [{key, date, n1, n2, ...}] (n1/n2 in any order).
    Returns {fight_id: (cand_key, swapped, score, day_gap)}. One candidate may serve only one fight;
    a fight takes the candidate with the best (score, -day_gap).
    """
    by_day = defaultdict(list)
    for c in cands:
        if c.get('date'):
            by_day[c['date']].append(c)
    out = {}
    used = {}
    for f in fights:
        d0 = dt.date.fromisoformat(f['date'])
        best = None
        for g in range(-day_tol, day_tol + 1):
            day = (d0 + dt.timedelta(days=g)).isoformat()
            for c in by_day.get(day, []):
                s_straight = min(name_sim(f['A_name'], c['n1']), name_sim(f['B_name'], c['n2']))
                s_swap = min(name_sim(f['A_name'], c['n2']), name_sim(f['B_name'], c['n1']))
                sw = s_swap > s_straight
                s = max(s_straight, s_swap)
                key = (s, -abs(g))
                if s >= min_sim and (best is None or key > best[0]):
                    best = (key, c['key'], sw, s, g)
        if best:
            out[f['id']] = (best[1], best[2], round(best[3], 3), best[4])
    # resolve candidates claimed by more than one fight: keep the best claim
    claims = defaultdict(list)
    for fid, (ck, sw, s, g) in out.items():
        claims[ck].append((s, -abs(g), fid))
    for ck, lst in claims.items():
        if len(lst) > 1:
            lst.sort(reverse=True)
            for _, _, fid in lst[1:]:
                out.pop(fid, None)
    return out


# ----------------------------------------------------------------------------------------------
# fetch: public datasets + BestFightOdds
# ----------------------------------------------------------------------------------------------

NLB_COLS = ['fight_id', 'event_date', 'event_name', 'f1_name', 'f2_name', 'winner', 'has_odds',
            'f1_open', 'f2_open', 'f1_close_low', 'f1_close_high', 'f2_close_low', 'f2_close_high',
            'f1_open_prob_novig', 'f1_close_prob_novig', 'bfo_event', 'bfo_date']
UUD_COLS = ['date', 'R_fighter', 'B_fighter', 'R_odds', 'B_odds', 'Winner', 'weight_class', 'title_bout']


def git_shallow(url, dest):
    if os.path.isdir(os.path.join(dest, '.git')):
        return
    subprocess.run(['git', 'clone', '-q', '--depth', '1', url, dest], check=True)


def fetch_sources(cache):
    import pandas as pd
    src = os.path.join(cache, 'src')
    os.makedirs(src, exist_ok=True)
    nl = os.path.join(src, 'nlbair_ufc-data')
    uu = os.path.join(src, 'ultimate_ufc_dataset')
    git_shallow(NLBAIR_GIT, nl)
    git_shallow(UUD_GIT, uu)
    rev = {}
    for name, d in (('nlbair', nl), ('uud', uu)):
        rev[name] = subprocess.run(['git', '-C', d, 'log', '-1', '--format=%H %ci'], capture_output=True,
                                   text=True).stdout.strip()
    w = pd.read_csv(os.path.join(nl, 'data', 'ufc_all_fights_wide.csv'), low_memory=False)
    x = pd.read_csv(os.path.join(nl, 'data', 'id_crosswalk_all.csv'), low_memory=False)
    w = w[NLB_COLS].merge(x[['fight_id', 'bfo_profile_url', 'bfo_owner_id', 'f1_id', 'f2_id']], on='fight_id', how='left')
    os.makedirs(ODDS_DIR, exist_ok=True)
    w.to_csv(os.path.join(ODDS_DIR, 'nlbair_odds.csv'), index=False)
    u = pd.read_csv(os.path.join(uu, 'ufc-master.csv'), low_memory=False)
    u[UUD_COLS].to_csv(os.path.join(ODDS_DIR, 'uud_odds.csv'), index=False)
    with open(os.path.join(ODDS_DIR, 'sources.json'), 'w') as fh:
        json.dump({'nlbair': {'repo': NLBAIR_GIT, 'commit': rev['nlbair'], 'license': 'CC BY 4.0',
                              'doi': '10.5281/zenodo.23458636', 'rows': int(len(w))},
                   'uud': {'repo': UUD_GIT, 'commit': rev['uud'], 'license': 'CC BY 4.0 (Kaggle mdabbert/ultimate-ufc-dataset)',
                           'rows': int(len(u))},
                   'fetched': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')}, fh, indent=1)
    print(f'sources: nlbair {len(w)} rows, uud {len(u)} rows')


def fetch_bfo(cache, since, until, delay):
    F = Fetcher(os.path.join(cache, 'bfo'), delay=delay)
    fights = [{'id': f['id'], 'date': f['date'], 'A_name': f['A']['name'], 'B_name': f['B']['name']}
              for f in load_backtest()]
    sm = F.get(BFO + '/sitemap-events.xml', max_age_days=3)
    events = [e for e in parse_sitemap_events(sm) if is_ufc_mma_event(e['slug'])
              and since <= e['lastmod'] <= until]
    events.sort(key=lambda e: e['lastmod'])
    print(f'BFO: {len(events)} UFC event pages {since}..{until}', flush=True)
    ev_rows, mus = [], {}
    for i, e in enumerate(events):
        html = F.get(e['url'])
        if not html:
            continue
        p = parse_event_page(html)
        for m in p['matchups']:
            if not m.get('t1_url') or not m.get('t2_url'):
                continue
            mus[m['mu']] = {'key': m['mu'], 'date': p['date'] or e['lastmod'], 'n1': m['t1_name'], 'n2': m['t2_name'],
                            't1_url': m['t1_url'], 't2_url': m['t2_url'], 'event_id': e['event_id']}
            base = {'mu': m['mu'], 'event_id': e['event_id'], 'event_slug': e['slug'], 'date': p['date'] or e['lastmod'],
                    't1_name': m['t1_name'], 't2_name': m['t2_name'], 't1_url': m['t1_url'], 't2_url': m['t2_url']}
            if not m['lines']:
                ev_rows.append(dict(base, book='', a1=None, a2=None))
            for book, (a1, a2) in m['lines'].items():
                ev_rows.append(dict(base, book=book, a1=a1, a2=a2))
        if (i + 1) % 25 == 0:
            print(f'  events {i + 1}/{len(events)} (net {F.n_net})', flush=True)
    write_csv(os.path.join(ODDS_DIR, 'bfo_event_lines.csv'), ev_rows,
              ['mu', 'event_id', 'event_slug', 'date', 't1_name', 't2_name', 't1_url', 't2_url', 'book', 'a1', 'a2'])
    mt = match_matchups(fights, list(mus.values()))
    print(f'BFO events: {len(mus)} matchups, {len(mt)} of {len(fights)} backtest fights matched', flush=True)
    # fighter pages: both sides of every matched matchup, plus nlbair's owner page for the rest
    urls = []
    for fid, (mu, sw, s, g) in mt.items():
        urls += [mus[mu]['t1_url'], mus[mu]['t2_url']]
    nl_path = os.path.join(ODDS_DIR, 'nlbair_odds.csv')
    if os.path.exists(nl_path):
        for r in read_csv(nl_path):
            if r['fight_id'] in {f['id'] for f in fights} and r['fight_id'] not in mt and r.get('bfo_profile_url'):
                urls.append(re.sub(r'^https?://[^/]+', '', r['bfo_profile_url']))
    seen, todo = set(), []
    for u in urls:
        if u and u not in seen:
            seen.add(u)
            todo.append(u)
    print(f'BFO: {len(todo)} fighter pages', flush=True)
    f_rows = []
    for i, u in enumerate(todo):
        html = F.get(BFO + u)
        if not html:
            continue
        for r in parse_fighter_page(html):
            r['page'] = u
            r['date'] = parse_date_text(r['date_text'])
            r['spark'] = ';'.join(f'{x:.6g}' for x in r['spark'])
            f_rows.append(r)
        if (i + 1) % 100 == 0:
            print(f'  fighters {i + 1}/{len(todo)} (net {F.n_net})', flush=True)
    write_csv(os.path.join(ODDS_DIR, 'bfo_fighter_lines.csv'), f_rows,
              ['page', 'mu', 'owner_team', 'owner_url', 'owner_name', 'opp_url', 'opp_name', 'event_url', 'event_name',
               'date', 'open1', 'lo1', 'hi1', 'open2', 'lo2', 'hi2', 'spark'])
    print(f'BFO done: {len(ev_rows)} event-line rows, {len(f_rows)} fighter-line rows, {F.n_net} requests', flush=True)


# ----------------------------------------------------------------------------------------------
# no-vig methods for a two-way market (decimal odds d1, d2) -> probability of side 1
# ----------------------------------------------------------------------------------------------

def _bisect(f, lo, hi, n=60):
    """f decreasing; returns x with f(x) ~ 1."""
    for _ in range(n):
        mid = (lo + hi) / 2
        if f(mid) > 1:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def devig(d1, d2, method='mult'):
    q1, q2 = 1.0 / d1, 1.0 / d2
    S = q1 + q2
    if method == 'mult' or abs(S - 1) < 1e-9:
        return q1 / S
    if method == 'add':
        return min(max(q1 - (S - 1) / 2, 1e-4), 1 - 1e-4)
    if method == 'power':  # p_i = q_i^k, sum 1
        k = _bisect(lambda k: q1 ** k + q2 ** k, 0.05, 20.0)
        return q1 ** k / (q1 ** k + q2 ** k)
    if method == 'shin':
        if S <= 1:
            return q1 / S
        def pi(q, z):
            return (math.sqrt(z * z + 4 * (1 - z) * q * q / S) - z) / (2 * (1 - z))
        z = _bisect(lambda z: pi(q1, z) + pi(q2, z), 0.0, 0.99)
        a, b = pi(q1, z), pi(q2, z)
        return a / (a + b)
    if method == 'odds_ratio':  # p/(1-p) = (q/(1-q)) / c
        def pp(q, c):
            return q / (c - c * q + q)
        if S <= 1 or q1 >= 1 or q2 >= 1:
            return q1 / S
        c = _bisect(lambda c: pp(q1, c) + pp(q2, c), 1e-3, 50.0)
        a, b = pp(q1, c), pp(q2, c)
        return a / (a + b)
    raise ValueError(method)


DEVIG_METHODS = ['mult', 'add', 'power', 'shin', 'odds_ratio']


# ----------------------------------------------------------------------------------------------
# assembly: one market record per backtest fight
# ----------------------------------------------------------------------------------------------

def _int(x):
    try:
        return int(float(x))
    except (TypeError, ValueError):
        return None


def load_bfo_matchups():
    """Merge event-page lines and fighter-page lines into BFO matchup records (team order)."""
    mus = {}
    p_ev = os.path.join(ODDS_DIR, 'bfo_event_lines.csv')
    p_fl = os.path.join(ODDS_DIR, 'bfo_fighter_lines.csv')
    if os.path.exists(p_ev):
        for r in read_csv(p_ev):
            mu = int(r['mu'])
            m = mus.setdefault(mu, {'mu': mu, 'date': r['date'], 'n1': r['t1_name'], 'n2': r['t2_name'],
                                    't1_url': r['t1_url'], 't2_url': r['t2_url'], 'event': r['event_slug'],
                                    'books': {}, 'pages': []})
            a1, a2 = _int(r['a1']), _int(r['a2'])
            if r['book'] and a1 and a2:
                m['books'][r['book']] = (a1, a2)
    if os.path.exists(p_fl):
        for r in read_csv(p_fl):
            mu, t = _int(r['mu']), _int(r['owner_team'])
            if mu is None or t not in (1, 2):
                continue
            m = mus.get(mu)
            if m is None:
                own, opp = (r['owner_name'], r['opp_name'])
                m = mus[mu] = {'mu': mu, 'date': r['date'], 'n1': own if t == 1 else opp,
                               'n2': opp if t == 1 else own,
                               't1_url': r['owner_url'] if t == 1 else r['opp_url'],
                               't2_url': r['opp_url'] if t == 1 else r['owner_url'],
                               'event': (r['event_url'] or '').replace('/events/', ''), 'books': {}, 'pages': []}
            o = {'open': (_int(r['open1']), _int(r['open2'])), 'lo': (_int(r['lo1']), _int(r['lo2'])),
                 'hi': (_int(r['hi1']), _int(r['hi2']))}
            if t == 2:
                o = {k: (v[1], v[0]) for k, v in o.items()}
            m['pages'].append(o)
            if r['spark']:
                m[f'spark{t}'] = [float(x) for x in r['spark'].split(';') if x]
    return mus


def _first(vals):
    for v in vals:
        if v is not None and v[0] is not None and v[1] is not None:
            return v
    return None


def bfo_summary(m):
    """open (team order), closing range, BFO mean close (decimal, both teams), per-book closes."""
    out = {'books': {k: v for k, v in m['books'].items()}}
    out['open'] = _first([p['open'] for p in m['pages']])
    lo = _first([p['lo'] for p in m['pages']])
    hi = _first([p['hi'] for p in m['pages']])
    out['range'] = (lo, hi) if lo and hi else None
    s1, s2 = m.get('spark1'), m.get('spark2')
    out['mean_close'] = (s1[-1], s2[-1]) if s1 and s2 else None
    out['mean_open'] = (s1[0], s2[0]) if s1 and s2 else None
    # consistency of the two fighter pages (same matchup read twice)
    if len(m['pages']) >= 2:
        a, b = m['pages'][0], m['pages'][1]
        out['pages_agree'] = a == b
    return out


def range_mid_dec(lo, hi):
    """decimal-odds midpoint of the closing range for each side (as nlbair computes it)."""
    return tuple((am_to_dec(lo[i]) + am_to_dec(hi[i])) / 2 for i in (0, 1))


def book_consensus(books):
    """Sportsbook closes (exchanges excluded) -> (mean decimal per side, n, mean of per-book no-vig p1)."""
    sb = {k: v for k, v in books.items() if k not in EXCHANGES and v[0] and v[1]}
    if len(sb) < 1:
        return None
    d = [(am_to_dec(a), am_to_dec(b)) for a, b in sb.values()]
    d = [x for x in d if x[0] and x[1]]
    if not d:
        return None
    md = (sum(x[0] for x in d) / len(d), sum(x[1] for x in d) / len(d))
    pnv = sum(devig(x[0], x[1]) for x in d) / len(d)
    best = (max(x[0] for x in d), max(x[1] for x in d))
    return {'mean_dec': md, 'n': len(d), 'p_avg_novig': pnv, 'best_dec': best, 'books': sorted(sb)}


def assemble(fights):
    """-> {fight_id: record} with every representation found, oriented to the backtest's A/B."""
    import pandas as pd
    recs = {f['id']: {} for f in fights}
    fl = [{'id': f['id'], 'date': f['date'], 'A_name': f['A']['name'], 'B_name': f['B']['name']} for f in fights]
    diag = {}
    # 1. nlbair (keyed by ufcstats fight id; f1 = ufcstats first name = A)
    nl = pd.read_csv(os.path.join(ODDS_DIR, 'nlbair_odds.csv'), low_memory=False).set_index('fight_id')
    n_nl = 0
    for f in fights:
        if f['id'] not in nl.index:
            continue
        q = nl.loc[f['id']]
        if not bool(q.has_odds):
            continue
        assert norm_name(q.f1_name) == norm_name(f['A']['name']) or name_sim(q.f1_name, f['A']['name']) > 0.7
        r = recs[f['id']]
        r['nl_open'] = (_int(q.f1_open), _int(q.f2_open))
        r['nl_range'] = ((_int(q.f1_close_low), _int(q.f2_close_low)), (_int(q.f1_close_high), _int(q.f2_close_high)))
        r['nl_bfo_url'] = q.bfo_profile_url if isinstance(q.bfo_profile_url, str) else None
        n_nl += 1
    diag['nlbair_matched'] = n_nl
    # 2. Ultimate UFC Dataset (single-book closing line), matched on date and names
    u = pd.read_csv(os.path.join(ODDS_DIR, 'uud_odds.csv'), low_memory=False)
    cands = [{'key': i, 'date': row.date, 'n1': row.R_fighter, 'n2': row.B_fighter}
             for i, row in u.iterrows() if row.date >= '2018-12-20']
    mt = match_matchups(fl, cands)
    n_u = 0
    for fid, (k, sw, sc, g) in mt.items():
        a1, a2 = u.loc[k, 'R_odds'], u.loc[k, 'B_odds']
        if pd.isna(a1) or pd.isna(a2):
            continue
        a1, a2 = int(a1), int(a2)
        recs[fid]['uud_close'] = (a2, a1) if sw else (a1, a2)
        n_u += 1
    diag['uud_matched'] = n_u
    # 3. BestFightOdds scrape
    mus = load_bfo_matchups()
    diag['bfo_matchups'] = len(mus)
    if mus:
        cands = [{'key': mu, 'date': m['date'], 'n1': m['n1'], 'n2': m['n2']} for mu, m in mus.items()
                 if m.get('date') and m.get('n1') and m.get('n2')]
        mt = match_matchups(fl, cands)
        diag['bfo_matched'] = len(mt)
        agree = Counter()
        for fid, (mu, sw, sc, g) in mt.items():
            b = bfo_summary(mus[mu])
            def orient(t):
                return (t[1], t[0]) if (t and sw) else t
            r = recs[fid]
            r['bfo_mu'] = mu
            r['bfo_event'] = mus[mu].get('event')
            r['bfo_open'] = orient(b['open'])
            if b['range']:
                r['bfo_range'] = (orient(b['range'][0]), orient(b['range'][1]))
            r['bfo_mean_close'] = orient(b['mean_close'])
            r['bfo_mean_open'] = orient(b['mean_open'])
            r['bfo_books'] = {k: orient(v) for k, v in b['books'].items()}
            if 'pages_agree' in b:
                agree[b['pages_agree']] += 1
        diag['bfo_two_pages_agree'] = dict(agree)
    return recs, diag


def choose(rec):
    """Pick the representation used for open / close and compute probabilities for side A."""
    out = {}
    op = rec.get('bfo_open') or rec.get('nl_open')
    if op and op[0] and op[1]:
        d = (am_to_dec(op[0]), am_to_dec(op[1]))
        if d[0] and d[1]:
            out['open'] = list(op)
            out['open_dec'] = d
    cons = book_consensus(rec.get('bfo_books') or {})
    rng = rec.get('bfo_range') or rec.get('nl_range')
    if rec.get('bfo_mean_close'):
        out['close_dec'] = rec['bfo_mean_close']
        out['book'] = 'BFO mean of books' + (f" ({cons['n']} US books)" if cons else '')
        out['src'] = 'bfo_mean'
    elif cons and cons['n'] >= 2:
        out['close_dec'] = cons['mean_dec']
        out['book'] = f"BFO per-book mean ({cons['n']} US books)"
        out['src'] = 'bfo_books'
    elif rng and all(rng[0]) and all(rng[1]):
        out['close_dec'] = range_mid_dec(rng[0], rng[1])
        out['book'] = 'BFO closing-range midpoint'
        out['src'] = 'range_mid'
    elif rec.get('uud_close'):
        u = rec['uud_close']
        out['close_dec'] = (am_to_dec(u[0]), am_to_dec(u[1]))
        out['book'] = 'single book close (Ultimate UFC Dataset)'
        out['src'] = 'uud'
    if out.get('close_dec') and not (out['close_dec'][0] and out['close_dec'][1]):
        out.pop('close_dec')
    if out.get('close_dec'):
        d = out['close_dec']
        out['close'] = [dec_to_am(d[0]), dec_to_am(d[1])]
    out['cons'] = cons
    out['range'] = rng
    return out


# ----------------------------------------------------------------------------------------------
# evaluation
# ----------------------------------------------------------------------------------------------

def _np():
    import numpy as np
    return np


def logit(p):
    np = _np()
    p = np.clip(np.asarray(p, float), 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


def sigmoid(x):
    np = _np()
    return 1 / (1 + np.exp(-np.asarray(x, float)))


def loss_arrays(p, y):
    np = _np()
    p = np.clip(np.asarray(p, float), 1e-6, 1 - 1e-6)
    y = np.asarray(y, float)
    ll = -(y * np.log(p) + (1 - y) * np.log(1 - p))
    br = (p - y) ** 2
    acc = np.where(np.abs(p - 0.5) < 1e-12, 0.5, ((p > 0.5) == (y == 1)).astype(float))
    return ll, br, acc


def ece(p, y, width=0.05):
    np = _np()
    p = np.asarray(p, float)
    y = np.asarray(y, float)
    pf = np.maximum(p, 1 - p)
    yf = np.where(p >= 0.5, y, 1 - y)
    bins = np.minimum(((pf - 0.5) / width).astype(int), int(0.5 / width) - 1)
    tot = 0.0
    for b in np.unique(bins):
        k = bins == b
        tot += k.sum() * abs(pf[k].mean() - yf[k].mean())
    return tot / len(p)


def metrics(p, y):
    np = _np()
    ll, br, acc = loss_arrays(p, y)
    return {'n': int(len(ll)), 'log_loss': round(float(ll.mean()), 4), 'brier': round(float(br.mean()), 4),
            'accuracy': round(float(acc.mean()), 4), 'ece': round(float(ece(p, y)), 4)}


def wilson(k, n, z=1.96):
    if n == 0:
        return (None, None)
    ph = k / n
    den = 1 + z * z / n
    c = (ph + z * z / (2 * n)) / den
    h = z * math.sqrt(ph * (1 - ph) / n + z * z / (4 * n * n)) / den
    return (round(c - h, 4), round(c + h, 4))


def calib_table(p, y, edges=(0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 1.0001)):
    np = _np()
    p = np.asarray(p, float)
    y = np.asarray(y, float)
    pf = np.maximum(p, 1 - p)
    yf = np.where(p >= 0.5, y, 1 - y)
    rows = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        k = (pf >= lo) & (pf < hi)
        n = int(k.sum())
        if n == 0:
            continue
        w = float(yf[k].sum())
        rows.append({'lo': lo, 'hi': round(min(hi, 1.0), 2), 'n': n, 'pred': round(float(pf[k].mean()), 4),
                     'obs': round(w / n, 4), 'ci95': wilson(w, n)})
    return rows


def logreg(X, y, l2=0.0, iters=50):
    """Newton logistic regression; returns (beta, se)."""
    np = _np()
    X = np.asarray(X, float)
    y = np.asarray(y, float)
    b = np.zeros(X.shape[1])
    for _ in range(iters):
        p = sigmoid(X @ b)
        W = p * (1 - p)
        H = X.T @ (X * W[:, None]) + l2 * np.eye(len(b))
        g = X.T @ (y - p) - l2 * b
        step = np.linalg.solve(H, g)
        b = b + step
        if np.max(np.abs(step)) < 1e-10:
            break
    p = sigmoid(X @ b)
    H = X.T @ (X * (p * (1 - p))[:, None])
    se = np.sqrt(np.diag(np.linalg.inv(H)))
    return b, se


def boot_event(groups, arrays, B=2000, seed=7):
    """Cluster bootstrap by event. arrays: {name: per-fight values}; returns {name: (lo, hi)} of means
    and the resampled means matrix for paired differences."""
    np = _np()
    rng = np.random.default_rng(seed)
    uniq, inv = np.unique(np.asarray(groups), return_inverse=True)
    E = len(uniq)
    cnt = np.bincount(inv, minlength=E).astype(float)
    sums = {k: np.bincount(inv, weights=np.asarray(v, float), minlength=E) for k, v in arrays.items()}
    draws = rng.integers(0, E, size=(B, E))
    W = np.zeros((B, E))
    for i in range(B):
        W[i] = np.bincount(draws[i], minlength=E)
    n_tot = W @ cnt
    return {k: (W @ s) / n_tot for k, s in sums.items()}


def ci(v, digits=4):
    np = _np()
    return [round(float(np.percentile(v, 2.5)), digits), round(float(np.percentile(v, 97.5)), digits)]



# ----------------------------------------------------------------------------------------------
# build: assemble + evaluate + write market.json
# ----------------------------------------------------------------------------------------------

TUNE = ('2019-01-01', '2023-12-31')
TEST = ('2024-01-01', '2099-12-31')


def period_of(d):
    return 'tune' if d <= TUNE[1] else 'test'


def cmd_build(a):
    np = _np()
    fights = load_backtest()
    recs, diag = assemble(fights)
    R = []
    for f in fights:
        rec = recs[f['id']]
        c = choose(rec)
        w = f['result']['winner']
        row = {'id': f['id'], 'date': f['date'], 'event': f['event'], 'period': period_of(f['date']),
               'y': 1.0 if w == 'A' else (0.0 if w == 'B' else None), 'winner': w,
               'division': f['division'], 'title': bool(f.get('title')), 'rounds': f['rounds'],
               'elo': 1 / (1 + 10 ** ((f['B']['elo'] - f['A']['elo']) / 400)), 'rec': rec, 'c': c}
        if c.get('open_dec'):
            row['p_open'] = devig(*c['open_dec'])
            row['over_open'] = 1 / c['open_dec'][0] + 1 / c['open_dec'][1]
        if c.get('close_dec'):
            for m in DEVIG_METHODS:
                row['p_close_' + m] = devig(*c['close_dec'], method=m)
            row['over_close'] = 1 / c['close_dec'][0] + 1 / c['close_dec'][1]
            row['src'] = c['src']
        # alternative closing representations for the comparison
        if rec.get('bfo_mean_close'):
            row['p_bfo_mean'] = devig(*rec['bfo_mean_close'])
        rng = rec.get('bfo_range') or rec.get('nl_range')
        if rng and all(rng[0]) and all(rng[1]):
            row['p_range_mid'] = devig(*range_mid_dec(rng[0], rng[1]))
        if rec.get('uud_close'):
            u = rec['uud_close']
            d = (am_to_dec(u[0]), am_to_dec(u[1]))
            if d[0] and d[1]:
                row['p_uud'] = devig(*d)
        cons = c.get('cons')
        if cons and cons['n'] >= 2:
            row['p_books_mean'] = devig(*cons['mean_dec'])
            row['p_books_avgnv'] = cons['p_avg_novig']
            row['n_books'] = cons['n']
            row['best_dec'] = cons['best_dec']
        R.append(row)
    res = {'diag': diag}

    # ---------------- coverage ----------------
    cov = {'n_backtest': len(R)}
    by_year = defaultdict(Counter)
    for r in R:
        yr = r['date'][:4]
        by_year[yr]['fights'] += 1
        by_year[yr]['open'] += 'p_open' in r
        by_year[yr]['close'] += 'p_close_mult' in r
        by_year[yr]['both'] += ('p_open' in r and 'p_close_mult' in r)
        by_year[yr]['per_book_close'] += 'p_books_mean' in r
        if 'src' in r:
            by_year[yr]['src_' + r['src']] += 1
    cov['by_year'] = {k: dict(v) for k, v in sorted(by_year.items())}
    for per in ('tune', 'test'):
        g = [r for r in R if r['period'] == per]
        cov[per] = {'fights': len(g), 'open': sum('p_open' in r for r in g),
                    'close': sum('p_close_mult' in r for r in g),
                    'per_book_close': sum('p_books_mean' in r for r in g),
                    'close_share': round(sum('p_close_mult' in r for r in g) / len(g), 4)}
    cov['close_src'] = dict(Counter(r.get('src', 'none') for r in R))
    cov['missing_close'] = [{'id': r['id'], 'date': r['date'], 'event': r['event']} for r in R if 'p_close_mult' not in r]
    res['coverage'] = cov

    dec = [r for r in R if r['y'] is not None]
    def sub(per, keys):
        return [r for r in dec if r['period'] == per and all(k in r for k in keys)]

    # ---------------- headline: elo vs open vs close (common subset) ----------------
    head = {}
    for per in ('tune', 'test'):
        g = sub(per, ['p_open', 'p_close_mult'])
        y = np.array([r['y'] for r in g])
        mods = {'elo': [r['elo'] for r in g], 'open': [r['p_open'] for r in g], 'close': [r['p_close_mult'] for r in g]}
        out = {k: metrics(v, y) for k, v in mods.items()}
        arrs = {}
        for k, v in mods.items():
            ll, br, acc = loss_arrays(v, y)
            arrs[k + '_ll'], arrs[k + '_br'], arrs[k + '_acc'] = ll, br, acc
        bs = boot_event([r['event'] for r in g], arrs, B=a.boot)
        for k in mods:
            out[k]['log_loss_ci95'] = ci(bs[k + '_ll'])
            out[k]['brier_ci95'] = ci(bs[k + '_br'])
            out[k]['accuracy_ci95'] = ci(bs[k + '_acc'])
        out['diff'] = {
            'close_minus_elo_ll': [round(float(np.mean(arrs['close_ll'] - arrs['elo_ll'])), 4), ci(bs['close_ll'] - bs['elo_ll'])],
            'close_minus_open_ll': [round(float(np.mean(arrs['close_ll'] - arrs['open_ll'])), 4), ci(bs['close_ll'] - bs['open_ll'])],
            'open_minus_elo_ll': [round(float(np.mean(arrs['open_ll'] - arrs['elo_ll'])), 4), ci(bs['open_ll'] - bs['elo_ll'])],
        }
        head[per] = out
    # every fight with a close (not only those with an open too)
    for per in ('tune', 'test'):
        g = sub(per, ['p_close_mult'])
        head[per]['close_all'] = metrics([r['p_close_mult'] for r in g], [r['y'] for r in g])
        head[per]['elo_on_close_all'] = metrics([r['elo'] for r in g], [r['y'] for r in g])
    res['headline'] = head

    # ---------------- no-vig method (choose on tune) ----------------
    dv = {}
    for per in ('tune', 'test'):
        g = sub(per, ['p_close_mult', 'p_open'])
        y = [r['y'] for r in g]
        dv[per] = {m: metrics([r['p_close_' + m] for r in g], y) for m in DEVIG_METHODS}
        # opening line too
        dv[per]['open'] = {}
        for m in DEVIG_METHODS:
            dv[per]['open'][m] = metrics([devig(*r['c']['open_dec'], method=m) for r in g], y)
    best = min(DEVIG_METHODS, key=lambda m: dv['tune'][m]['log_loss'])
    dv['chosen_on_tune'] = best
    res['devig'] = dv

    # ---------------- closing representations (common subsets) ----------------
    reps = {}
    for per in ('tune', 'test'):
        reps[per] = {}
        for pair in (('p_bfo_mean', 'p_range_mid'), ('p_bfo_mean', 'p_uud'), ('p_range_mid', 'p_uud'),
                     ('p_bfo_mean', 'p_books_avgnv'), ('p_books_mean', 'p_books_avgnv')):
            g = sub(per, list(pair))
            if len(g) < 30:
                continue
            y = [r['y'] for r in g]
            reps[per]['|'.join(pair)] = {k: metrics([r[k] for r in g], y) for k in pair}
            reps[per]['|'.join(pair)]['mean_abs_diff'] = round(float(np.mean([abs(r[pair[0]] - r[pair[1]]) for r in g])), 4)
    res['close_representations'] = reps

    # ---------------- calibration + favourite-longshot bias ----------------
    cal = {}
    for per in ('tune', 'test', 'all'):
        g = [r for r in dec if 'p_close_mult' in r and (per == 'all' or r['period'] == per)]
        p = np.array([r['p_close_mult'] for r in g])
        y = np.array([r['y'] for r in g])
        pf = np.maximum(p, 1 - p)
        yf = np.where(p >= 0.5, y, 1 - y)
        b1, se1 = logreg(logit(p)[:, None], y)                       # symmetric slope
        X = np.column_stack([np.ones(len(pf)), logit(pf)])
        b2, se2 = logreg(X, yf)                                      # favourite intercept + slope
        cal[per] = {'n': int(len(p)), 'table': calib_table(p, y),
                    'slope_only': {'b': round(float(b1[0]), 4), 'se': round(float(se1[0]), 4)},
                    'fav_intercept_slope': {'a': round(float(b2[0]), 4), 'a_se': round(float(se2[0]), 4),
                                            'b': round(float(b2[1]), 4), 'b_se': round(float(se2[1]), 4)},
                    'fav_win_rate': round(float(yf.mean()), 4), 'fav_implied': round(float(pf.mean()), 4)}
        # open line calibration too
        go = [r for r in g if 'p_open' in r]
        po = np.array([r['p_open'] for r in go])
        yo = np.array([r['y'] for r in go])
        bo, so = logreg(logit(po)[:, None], yo)
        cal[per]['open_slope_only'] = {'b': round(float(bo[0]), 4), 'se': round(float(so[0]), 4), 'n': int(len(po))}
        # flat-stake ROI by implied-probability band, at the mean closing odds and at the best book
        roi = []
        bands = [(0.0, 0.2), (0.2, 0.3), (0.3, 0.4), (0.4, 0.5), (0.5, 0.6), (0.6, 0.7), (0.7, 0.8), (0.8, 1.0)]
        sides = []
        for r in g:
            d = r['c']['close_dec']
            for side, (pp, dd, yy) in enumerate(((r['p_close_mult'], d[0], r['y']), (1 - r['p_close_mult'], d[1], 1 - r['y']))):
                bd = r['best_dec'][side] if r.get('best_dec') else None
                sides.append((pp, dd, yy, bd))
        for lo, hi in bands:
            k = [x for x in sides if lo <= x[0] < hi]
            if not k:
                continue
            ret = [x[2] * x[1] - 1 for x in k]
            kb = [x for x in k if x[3]]
            rb = [x[2] * x[3] - 1 for x in kb]
            se = float(np.std(ret, ddof=1) / math.sqrt(len(ret))) if len(ret) > 1 else None
            roi.append({'band': [lo, hi], 'n_sides': len(k), 'implied': round(float(np.mean([x[0] for x in k])), 4),
                        'won': round(float(np.mean([x[2] for x in k])), 4),
                        'roi_mean_odds': round(float(np.mean(ret)), 4), 'roi_se': round(se, 4) if se else None,
                        'n_best': len(kb), 'roi_best_book': round(float(np.mean(rb)), 4) if rb else None})
        cal[per]['roi_by_band'] = roi
        cal[per]['overround_close_median'] = round(float(np.median([r['over_close'] for r in g])), 4)
        if go:
            cal[per]['overround_open_median'] = round(float(np.median([r['over_open'] for r in go])), 4)
    res['calibration'] = cal

    # ---------------- recalibration and stacking: fit on tune, score on test ----------------
    st = {}
    gt = sub('tune', ['p_close_mult', 'p_open'])
    gs = sub('test', ['p_close_mult', 'p_open'])
    yt = np.array([r['y'] for r in gt])
    ys = np.array([r['y'] for r in gs])
    def feats(g, keys):
        cols = []
        for k in keys:
            cols.append(logit([r[k] for r in g]))
        return np.column_stack(cols)
    variants = {
        'close_mult': (['p_close_mult'], None),
        'close_slope': (['p_close_mult'], 'fit'),
        'close_' + best: (['p_close_' + best], None),
        'close_' + best + '_slope': (['p_close_' + best], 'fit'),
        'close+open': (['p_close_mult', 'p_open'], 'fit'),
        'close+elo': (['p_close_mult', 'elo'], 'fit'),
        'close+open+elo': (['p_close_mult', 'p_open', 'elo'], 'fit'),
        'open_mult': (['p_open'], None),
        'open+elo': (['p_open', 'elo'], 'fit'),
        'elo': (['elo'], None),
    }
    test_ll = {}
    for name, (keys, mode) in variants.items():
        Xt, Xs = feats(gt, keys), feats(gs, keys)
        if mode == 'fit':
            b, se = logreg(Xt, yt)
            pt, ps = sigmoid(Xt @ b), sigmoid(Xs @ b)
            coef = {k: [round(float(bb), 4), round(float(ss), 4)] for k, bb, ss in zip(keys, b, se)}
        else:
            pt, ps = sigmoid(Xt[:, 0]), sigmoid(Xs[:, 0])
            coef = None
        st[name] = {'coef_logit_[b,se]': coef, 'tune': metrics(pt, yt), 'test': metrics(ps, ys)}
        test_ll[name] = loss_arrays(ps, ys)[0]
    # favourite intercept + slope recalibration (symmetric in the corner labels)
    def fav_form(g):
        p = np.array([r['p_close_mult'] for r in g])
        return p, np.where(p >= 0.5, 1.0, -1.0)
    pt, sgt = fav_form(gt)
    ps, sgs = fav_form(gs)
    yft = np.where(sgt > 0, yt, 1 - yt)
    bfa, sfa = logreg(np.column_stack([np.ones(len(pt)), logit(np.maximum(pt, 1 - pt))]), yft)
    def apply_fav(p, b):
        pf = sigmoid(b[0] + b[1] * logit(np.maximum(p, 1 - p)))
        return np.where(p >= 0.5, pf, 1 - pf)
    st['close_fav_a_b'] = {'coef_logit_[b,se]': {'a': [round(float(bfa[0]), 4), round(float(sfa[0]), 4)],
                                                  'b': [round(float(bfa[1]), 4), round(float(sfa[1]), 4)]},
                           'tune': metrics(apply_fav(pt, bfa), yt), 'test': metrics(apply_fav(ps, bfa), ys)}
    test_ll['close_fav_a_b'] = loss_arrays(apply_fav(ps, bfa), ys)[0]
    bs = boot_event([r['event'] for r in gs], test_ll, B=a.boot)
    for name in st:
        st[name]['test_ll_minus_close_mult'] = [round(float(np.mean(test_ll[name] - test_ll['close_mult'])), 4),
                                                ci(bs[name] - bs['close_mult'])]
    st['n'] = {'tune': len(gt), 'test': len(gs)}
    res['stacking'] = st

    # ---------------- by year and by segment ----------------
    yrs = {}
    for yr in sorted({r['date'][:4] for r in dec}):
        g = [r for r in dec if r['date'][:4] == yr and 'p_close_mult' in r]
        go = [r for r in g if 'p_open' in r]
        yrs[yr] = {'close': metrics([r['p_close_mult'] for r in g], [r['y'] for r in g]),
                   'open': metrics([r['p_open'] for r in go], [r['y'] for r in go]),
                   'elo': metrics([r['elo'] for r in g], [r['y'] for r in g])}
    res['by_year'] = yrs
    seg = {}
    for name, fn in (('title', lambda r: r['title']), ('five_round', lambda r: r['rounds'] == 5),
                     ('womens', lambda r: r['division'].startswith("Women")),
                     ('heavyweight', lambda r: r['division'] == 'Heavyweight')):
        for per in ('tune', 'test'):
            g = [r for r in dec if r['period'] == per and 'p_close_mult' in r and fn(r)]
            if len(g) >= 20:
                seg[f'{name}_{per}'] = metrics([r['p_close_mult'] for r in g], [r['y'] for r in g])
    res['segments'] = seg

    # ---------------- line movement ----------------
    mv = {}
    for per in ('tune', 'test'):
        g = sub(per, ['p_open', 'p_close_mult'])
        dlt = np.array([r['p_close_mult'] - r['p_open'] for r in g])
        flips = sum(1 for r in g if (r['p_open'] - 0.5) * (r['p_close_mult'] - 0.5) < 0)
        mv[per] = {'mean_abs_move': round(float(np.mean(np.abs(dlt))), 4),
                   'median_abs_move': round(float(np.median(np.abs(dlt))), 4),
                   'share_move_gt_5pts': round(float(np.mean(np.abs(dlt) > 0.05)), 4),
                   'favourite_flips': flips, 'n': len(g)}
    res['line_movement'] = mv

    # ---------------- data checks ----------------
    chk = {}
    pairs = []
    for r in R:
        rec = r['rec']
        if rec.get('bfo_open') and rec.get('nl_open'):
            pairs.append(rec['bfo_open'] == rec['nl_open'])
    chk['bfo_open_equals_nlbair_open'] = [sum(pairs), len(pairs)]
    pairs = []
    for r in R:
        rec = r['rec']
        if rec.get('bfo_range') and rec.get('nl_range'):
            pairs.append(tuple(rec['bfo_range']) == tuple(rec['nl_range']))
    chk['bfo_range_equals_nlbair_range'] = [sum(pairs), len(pairs)]
    dd = [abs(r['p_bfo_mean'] - r['p_books_mean']) for r in R if 'p_bfo_mean' in r and 'p_books_mean' in r]
    if dd:
        chk['bfo_mean_vs_event_page_books_mean_abs_diff'] = {'n': len(dd), 'mean': round(float(np.mean(dd)), 4),
                                                             'p95': round(float(np.percentile(dd, 95)), 4),
                                                             'share_lt_0.005': round(float(np.mean(np.array(dd) < 0.005)), 4)}
    du = [abs(r['p_uud'] - r['p_close_mult']) for r in R if 'p_uud' in r and 'p_close_mult' in r]
    chk['uud_vs_close_abs_diff'] = {'n': len(du), 'mean': round(float(np.mean(du)), 4),
                                    'p95': round(float(np.percentile(du, 95)), 4)}
    res['checks'] = chk

    # ---------------- method props (event pages, if cached) ----------------
    if getattr(a, 'props', None):
        res['method_market'] = method_market(a, fights, recs)

    write_market_json(R, res, best)
    print_summary(res)


def write_market_json(R, res, best):
    fights = {}
    for r in R:
        c = r['c']
        rec = r['rec']
        if 'p_close_mult' not in r and 'p_open' not in r:
            continue
        e = {}
        if c.get('open'):
            e['open'] = c['open']
            e['p_novig_open'] = round(r['p_open'], 4)
        if c.get('close'):
            e['close'] = c['close']
            e['close_dec'] = [round(c['close_dec'][0], 4), round(c['close_dec'][1], 4)]
            e['p_novig_close'] = round(r['p_close_mult'], 4)
            if best != 'mult':
                e['p_' + best + '_close'] = round(r['p_close_' + best], 4)
            e['overround'] = round(r['over_close'], 4)
            e['book'] = c['book']
            e['src'] = c['src']
        if c.get('range') and all(c['range'][0]) and all(c['range'][1]):
            e['close_range'] = [[c['range'][0][0], c['range'][1][0]], [c['range'][0][1], c['range'][1][1]]]
        if rec.get('bfo_books'):
            e['books'] = {k: list(v) for k, v in sorted(rec['bfo_books'].items())}
        if rec.get('uud_close'):
            e['uud_close'] = list(rec['uud_close'])
        if rec.get('bfo_mu'):
            e['bfo'] = {'matchup': rec['bfo_mu'], 'event': rec.get('bfo_event')}
        fights[r['id']] = e
    meta = {
        'built': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
        'tool': 'tools/market.py',
        'orientation': 'every pair is [A, B] in backtest.json order (A = first ufcstats name); p_* = probability that A wins',
        'open': 'first line BFO lists for the fight (one book, often weeks out; may not have been bettable in size)',
        'close': 'consensus closing line: BFO mean of the books\' closing decimal odds (last point of BFO\'s mean-odds '
                 'series) when both fighter pages were read; else the mean of the per-book closes on the event page; '
                 'else the decimal midpoint of the closing range (nlbair); else one book\'s close (Ultimate UFC Dataset)',
        'p_novig': 'multiplicative (proportional) margin removal: p_A = (1/dA) / (1/dA + 1/dB)',
        'devig_best_on_tune': best,
        'books': 'per-book closing lines from BFO event pages; covers only the US books BFO lists today (about 2021 on); '
                 'Polymarket/Kalshi are listed when present but never enter the consensus',
        'walk_forward': 'closing lines are known only minutes before the fight; they are a benchmark and a stacking input '
                        'for live use, never a feature of a model scored on the same fight before the line closes',
        'sources': [
            'BestFightOdds.com (opening lines, closing ranges, mean-odds series, per-book closes), fetched by tools/market.py',
            'nlbair/ufc-data v0.1.1 (CC BY 4.0, doi:10.5281/zenodo.23458636): BFO opening line and closing range per ufcstats fight id',
            'Ultimate UFC Dataset (mdabbert / shortlikeafox, CC BY 4.0): one closing moneyline per fighter',
        ],
        'periods': {'tune': list(TUNE), 'test': list(TEST)},
    }
    out = {'meta': meta, 'coverage': res['coverage'], 'eval': {k: v for k, v in res.items() if k not in ('coverage',)},
           'fights': fights}
    with open(OUT_JSON, 'w') as fh:
        json.dump(out, fh, separators=(',', ':'))
    print(f'wrote {OUT_JSON}: {len(fights)} fights, {os.path.getsize(OUT_JSON) / 1e6:.2f} MB')


def print_summary(res):
    cov = res['coverage']
    print('diag', res['diag'])
    print('coverage', {k: cov[k] for k in ('tune', 'test', 'close_src')})
    for per in ('tune', 'test'):
        h = res['headline'][per]
        print(per, {k: (h[k]['n'], h[k]['log_loss'], h[k]['log_loss_ci95'], h[k]['brier'], h[k]['accuracy'], h[k]['ece'])
                    for k in ('elo', 'open', 'close')})
        print('   diffs', h['diff'])
    print('devig tune', {m: res['devig']['tune'][m]['log_loss'] for m in DEVIG_METHODS}, 'chosen', res['devig']['chosen_on_tune'])
    print('devig test', {m: res['devig']['test'][m]['log_loss'] for m in DEVIG_METHODS})
    for per in ('tune', 'test', 'all'):
        c = res['calibration'][per]
        print('calib', per, c['slope_only'], c['fav_intercept_slope'], 'fav won', c['fav_win_rate'], 'implied', c['fav_implied'])
    for k, v in res['stacking'].items():
        if k == 'n':
            continue
        print(f"  stack {k:28s} tune {v['tune']['log_loss']} test {v['test']['log_loss']} d {v['test_ll_minus_close_mult']} {v['coef_logit_[b,se]']}")
    print('checks', res['checks'])


def cmd_fetch(a):
    if not a.skip_sources:
        fetch_sources(a.cache)
    if not a.skip_bfo:
        fetch_bfo(a.cache, a.since, a.until, a.delay)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    f = sub.add_parser('fetch')
    f.add_argument('--cache', default=os.path.expanduser('~/.cache/xx-market'))
    f.add_argument('--since', default='2018-12-25')
    f.add_argument('--until', default='2026-11-02')
    f.add_argument('--delay', type=float, default=2.0, help='seconds between BFO requests (plus 0-1 s jitter)')
    f.add_argument('--skip-sources', action='store_true')
    f.add_argument('--skip-bfo', action='store_true')
    f.set_defaults(func=cmd_fetch)
    b = sub.add_parser('build')
    b.add_argument('--boot', type=int, default=2000, help='bootstrap resamples (by event)')
    b.set_defaults(func=cmd_build)
    a = ap.parse_args()
    a.func(a)


if __name__ == '__main__':
    main()
