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
