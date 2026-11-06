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

Usage (from the project root; about 1.5 hours of polite fetching the first time, seconds after that):
  python3 -I tools/market.py fetch --cache DIR    # git sources + BFO event and fighter pages -> data/raw/odds/*.csv
  python3 -I tools/market.py props --cache DIR    # method / decision / round props from cached event pages
  python3 -I tools/market.py build --props        # match, clean, evaluate -> data/derived/market.json (+ vault rows outside the repo)
  python3 -I tools/market.py tables               # markdown tables for research/model_market.md

Outputs: data/raw/odds/{nlbair_odds,uud_odds,bfo_event_lines,bfo_fighter_lines,bfo_event_props}.csv + sources.json
(compact extracts, committed), data/derived/market.json (fights keyed by backtest id, coverage, eval, ratings).

Hidden-data protocol (docs/BACKLOG.md): every evaluation uses fights before 2026-01-01 only (tune 2019-2023, test =
validation 2024-2025). Fights from 2026-01-01 (the vault) are matched to odds without looking at results, written to
<--vault-dir>/market_vault.json outside the repository for the milestone auditor, and left out of market.json's
per-fight table and of every score. The live `ratings` snapshot alone runs over all fights through the snapshot (live
use only, never for scoring 2026 fights).

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
BACKTEST = os.path.join(ROOT, 'data', 'derived', 'backtest.json')   # every fight: matching and the live snapshot only
VAULT_FROM = '2026-01-01'   # hidden-data protocol: fights on or after this date are never scored here
VAULT_DIR = '/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vault'  # = tools/make_vault.py
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


# BFO keeps earlier names where ufcstats has the current one (only needed when nlbair's crosswalk has no row)
NAME_ALIASES = {'tecia torres': 'tecia pennington', 'brianna van buren': 'brianna fortino',
                'joanne calderwood': 'joanne wood', 'katlyn chookagian': 'katlyn cerminara'}


def norm_name(s):
    s = unicodedata.normalize('NFKD', str(s)).encode('ascii', 'ignore').decode().lower()
    s = NAME_ALIASES.get(s.strip(), s)
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
    fl_cols = ['page', 'mu', 'owner_team', 'owner_url', 'owner_name', 'opp_url', 'opp_name', 'event_url', 'event_name',
               'date', 'open1', 'lo1', 'hi1', 'open2', 'lo2', 'hi2', 'spark']

    def read_pages(pages):
        for i, u in enumerate(pages):
            html = F.get(BFO + u)
            if not html:
                continue
            for r in parse_fighter_page(html):
                r['page'] = u
                r['date'] = parse_date_text(r['date_text'])
                r['spark'] = ';'.join(f'{x:.6g}' for x in r['spark'])
                f_rows.append(r)
            if (i + 1) % 100 == 0:
                print(f'  fighters {i + 1}/{len(pages)} (net {F.n_net})', flush=True)
    read_pages(todo)
    write_csv(os.path.join(ODDS_DIR, 'bfo_fighter_lines.csv'), f_rows, fl_cols)
    # second round: matchups found through the nlbair crosswalk or BFO's other spellings may lack the partner's page
    recs, _ = assemble(load_backtest())
    allmus = load_bfo_matchups()
    extra = []
    for r in recs.values():
        m = allmus.get(r.get('bfo_mu'))
        for t in (1, 2):
            u = m and m.get(f't{t}_url')
            if u and u not in seen and not m.get(f'spark{t}'):
                seen.add(u)
                extra.append(u)
    print(f'BFO: {len(extra)} more fighter pages (second round)', flush=True)
    read_pages(extra)
    write_csv(os.path.join(ODDS_DIR, 'bfo_fighter_lines.csv'), f_rows, fl_cols)
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
            ev_slug = (r['event_url'] or '').replace('/events/', '')
            undated = (not r['date']) or bool(re.match(r'(future-events|potential-fights|unconfirmed)', ev_slug))
            if m is None:
                own, opp = (r['owner_name'], r['opp_name'])
                m = mus[mu] = {'mu': mu, 'date': r['date'], 'n1': own if t == 1 else opp,
                               'n2': opp if t == 1 else own,
                               't1_url': r['owner_url'] if t == 1 else r['opp_url'],
                               't2_url': r['opp_url'] if t == 1 else r['owner_url'],
                               'event': ev_slug, 'books': {}, 'pages': [], 'undated': undated}
                if undated:
                    m['date'] = None
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


def book_consensus(books, max_dev=0.15):
    """Sportsbook closes (exchanges excluded) -> robust consensus.
    A book's line is dropped when its overround is implausible (outside 0.98-1.25) or its no-vig p is more than
    `max_dev` from the median book (stale or in-play prices). Returns the mean decimal odds of the kept books,
    their mean no-vig p, the best price per side, and counts."""
    d = []
    for k, (a, b) in books.items():
        if k in EXCHANGES or not a or not b:
            continue
        x = (am_to_dec(a), am_to_dec(b))
        if not x[0] or not x[1] or not (0.98 <= 1 / x[0] + 1 / x[1] <= 1.25):
            continue
        d.append((k, x, devig(*x)))
    if not d:
        return None
    ps = sorted(t[2] for t in d)
    med = ps[len(ps) // 2] if len(ps) % 2 else (ps[len(ps) // 2 - 1] + ps[len(ps) // 2]) / 2
    keep = [t for t in d if abs(t[2] - med) <= max_dev]
    md = (sum(t[1][0] for t in keep) / len(keep), sum(t[1][1] for t in keep) / len(keep))
    return {'mean_dec': md, 'n': len(keep), 'n_dropped': len(d) - len(keep), 'p_avg_novig': sum(t[2] for t in keep) / len(keep),
            'p_median_novig': med, 'best_dec': (max(t[1][0] for t in keep), max(t[1][1] for t in keep)),
            'books': sorted(t[0] for t in keep)}


def range_spread(rng):
    """largest implied-probability gap between the low and high closing price of either side."""
    (lo, hi) = rng
    return max(abs(1 / am_to_dec(lo[i]) - 1 / am_to_dec(hi[i])) for i in (0, 1))


def sane_pair(d, lo=0.98, hi=1.2):
    return bool(d and d[0] and d[1] and d[0] > 1 and d[1] > 1 and lo <= 1 / d[0] + 1 / d[1] <= hi)


MAX_RANGE_SPREAD = 0.20  # a wider closing range carries a stale or in-play price (see the report)


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
        if r['nl_bfo_url'] and isinstance(q.bfo_owner_id, str):
            r['nl_bfo_path'] = re.sub(r'^https?://[^/]+', '', r['nl_bfo_url'])
            r['nl_owner_is_A'] = q.bfo_owner_id == q.f1_id
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
        # pass 0: nlbair's crosswalk names the BFO page of one fighter (and which ufcstats fighter owns it), so
        # BFO's own spellings (Bobby Green for King Green, Ronaldo Souza for Jacare, ...) cannot break the match
        by_url = defaultdict(list)
        for mu, m in mus.items():
            for t in (1, 2):
                if m.get(f't{t}_url'):
                    by_url[m[f't{t}_url']].append((mu, t))
        mt = {}
        taken = set()
        for f in fl:
            r = recs[f['id']]
            path = r.get('nl_bfo_path')
            if not path:
                continue
            d0 = dt.date.fromisoformat(f['date'])
            best = None
            for mu, t in by_url.get(path, []):
                m = mus[mu]
                if mu in taken or not m.get('date') or m.get('undated'):
                    continue
                g = (dt.date.fromisoformat(m['date']) - d0).days
                if abs(g) > 3:
                    continue
                opp_name = m[f'n{3 - t}']
                opp_ufc = f['B_name'] if r['nl_owner_is_A'] else f['A_name']
                sc = name_sim(opp_name, opp_ufc)
                if best is None or (sc, -abs(g)) > best[0]:
                    best = ((sc, -abs(g)), mu, t, sc, g)
            if best and best[3] >= 0.3:
                mu, t = best[1], best[2]
                sw = (t == 1) != r['nl_owner_is_A']
                mt[f['id']] = (mu, sw, round(best[3], 3), best[4])
                taken.add(mu)
        diag['bfo_matched_pass0_crosswalk'] = len(mt)
        rest = [f for f in fl if f['id'] not in mt]
        mt1 = match_matchups(rest, [c for c in cands if c['key'] not in taken])
        mt.update(mt1)
        diag['bfo_matched_pass1_names'] = len(mt1)
        # pass 2: rescheduled fights (BFO keeps the original date): same two names, within 10 days, stricter names
        used = {v[0] for v in mt.values()}
        rest = [f for f in fl if f['id'] not in mt]
        mt2 = match_matchups(rest, [c for c in cands if c['key'] not in used], day_tol=10, min_sim=0.9)
        mt.update(mt2)
        diag['bfo_matched_pass2_rescheduled'] = len(mt2)
        # pass 3: matchups BFO left on its undated Future Events / Potential Fights pages; place each in time by
        # the dates of the dated matchups with the nearest ids (ids grow as BFO creates matchups)
        dated = sorted((mu, m['date']) for mu, m in mus.items() if m.get('date') and not m.get('undated'))
        ids = [d[0] for d in dated]
        import bisect
        def est_date(mu):
            k = bisect.bisect_left(ids, mu)
            near = [dt.date.fromisoformat(d[1]) for d in dated[max(0, k - 12):k + 12]]
            near.sort()
            return near[len(near) // 2] if near else None
        used = {v[0] for v in mt.values()}
        und = [(mu, m) for mu, m in mus.items() if m.get('undated') and mu not in used and m.get('n1') and m.get('n2')]
        mt3 = {}
        for f in fl:
            if f['id'] in mt:
                continue
            d0 = dt.date.fromisoformat(f['date'])
            best = None
            for mu, m in und:
                e = est_date(mu)
                if e is None or not (-45 <= (d0 - e).days <= 730):
                    continue
                s1 = min(name_sim(f['A_name'], m['n1']), name_sim(f['B_name'], m['n2']))
                s2 = min(name_sim(f['A_name'], m['n2']), name_sim(f['B_name'], m['n1']))
                sc = max(s1, s2)
                if sc >= 0.85 and (best is None or (sc, -abs((d0 - e).days)) > best[0]):
                    best = ((sc, -abs((d0 - e).days)), mu, s2 > s1, sc)
            if best and best[1] not in {v[0] for v in mt3.values()}:
                mt3[f['id']] = (best[1], best[2], round(best[3], 3), None)
        mt.update(mt3)
        diag['bfo_matched_pass3_undated'] = len(mt3)
        diag['bfo_matched'] = len(mt)
        agree = Counter()
        for fid, (mu, sw, sc, g) in mt.items():
            b = bfo_summary(mus[mu])
            def orient(t):
                return (t[1], t[0]) if (t and sw) else t
            r = recs[fid]
            r['bfo_mu'] = mu
            r['bfo_swap'] = sw
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
    """Pick the representation used for open / close and compute probabilities for side A.

    Close precedence (outcome-blind rules): robust per-book consensus with >= 3 US books; BFO mean of books when
    the closing range is not contaminated; per-book consensus with 1-2 books; decimal midpoint of a clean closing
    range; one book's close (Ultimate UFC Dataset) when sane; otherwise no close."""
    out = {}
    for src in ('bfo_open', 'nl_open'):
        op = rec.get(src)
        if op and op[0] and op[1]:
            d = (am_to_dec(op[0]), am_to_dec(op[1]))
            if sane_pair(d, 0.98, 1.35):
                out['open'] = list(op)
                out['open_dec'] = d
                break
    cons = book_consensus(rec.get('bfo_books') or {})
    rng = rec.get('bfo_range') or rec.get('nl_range')
    if rng and not (all(rng[0]) and all(rng[1])):
        rng = None
    spread = range_spread(rng) if rng else None
    clean_rng = spread is not None and spread <= MAX_RANGE_SPREAD
    mean = rec.get('bfo_mean_close')
    u = rec.get('uud_close')
    ud = (am_to_dec(u[0]), am_to_dec(u[1])) if u else None
    if cons and cons['n'] >= 3:
        out['close_dec'], out['src'] = cons['mean_dec'], 'bfo_books'
        out['book'] = f"mean of {cons['n']} US books (BFO event page)"
    elif sane_pair(mean) and (rng is None or clean_rng):
        out['close_dec'], out['src'] = mean, 'bfo_mean'
        out['book'] = 'BFO mean of books'
    elif cons:
        out['close_dec'], out['src'] = cons['mean_dec'], 'bfo_books'
        out['book'] = f"mean of {cons['n']} US book(s) (BFO event page)"
    elif clean_rng:
        out['close_dec'], out['src'] = range_mid_dec(rng[0], rng[1]), 'range_mid'
        out['book'] = 'BFO closing-range midpoint'
    elif sane_pair(ud, 0.99, 1.15):
        out['close_dec'], out['src'] = ud, 'uud'
        out['book'] = 'single book close (Ultimate UFC Dataset)'
    elif rng or mean or u:
        out['close_flag'] = 'contaminated'  # in-play/stale prices and no clean fallback
    if out.get('close_dec'):
        d = out['close_dec']
        out['close'] = [dec_to_am(d[0]), dec_to_am(d[1])]
    out['cons'] = cons
    out['range'] = rng
    out['spread'] = spread
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
TEST = ('2024-01-01', '2025-12-31')   # validation years; 2026+ is the sealed vault (VAULT_FROM)


def period_of(d):
    if d >= VAULT_FROM:
        return 'vault'
    return 'tune' if d <= TUNE[1] else 'test'


def make_row(f, rec):
    """One market row per fight. Vault fights (2026+) get no result fields at all."""
    c = choose(rec)
    per = period_of(f['date'])
    w = f['result']['winner'] if per != 'vault' else None
    row = {'id': f['id'], 'date': f['date'], 'event': f['event'], 'period': per,
           'y': 1.0 if w == 'A' else (0.0 if w == 'B' else None), 'winner': w,
           'division': f['division'], 'title': bool(f.get('title')), 'rounds': f['rounds'],
           'elo': 1 / (1 + 10 ** ((f['B']['elo'] - f['A']['elo']) / 400)), 'rec': rec, 'c': c}
    return row, c


def cmd_build(a):
    np = _np()
    fights_all = load_backtest()
    # matching is outcome-blind (dates, names, prices), so it runs over every fight; scoring uses dev fights only
    recs, diag = assemble(fights_all)
    fights = [f for f in fights_all if f['date'] < VAULT_FROM]
    vault = [f for f in fights_all if f['date'] >= VAULT_FROM]
    R, V = [], []
    for f in fights_all:
        rec = recs[f['id']]
        row, c = make_row(f, rec)
        if c.get('open_dec'):
            row['p_open'] = devig(*c['open_dec'])
            row['over_open'] = 1 / c['open_dec'][0] + 1 / c['open_dec'][1]
        if c.get('close_dec'):
            for m in DEVIG_METHODS:
                row['p_close_' + m] = devig(*c['close_dec'], method=m)
            row['over_close'] = 1 / c['close_dec'][0] + 1 / c['close_dec'][1]
            row['src'] = c['src']
        # alternative closing representations for the comparison
        clean = c.get('spread') is None or c['spread'] <= MAX_RANGE_SPREAD
        if sane_pair(rec.get('bfo_mean_close')) and clean:
            row['p_bfo_mean'] = devig(*rec['bfo_mean_close'])
        if c.get('range') and clean:
            row['p_range_mid'] = devig(*range_mid_dec(c['range'][0], c['range'][1]))
        if rec.get('uud_close'):
            u = rec['uud_close']
            d = (am_to_dec(u[0]), am_to_dec(u[1]))
            if sane_pair(d, 0.99, 1.15):
                row['p_uud'] = devig(*d)
        row['spread'] = c.get('spread')
        row['close_flag'] = c.get('close_flag')
        if c.get('range'):
            row['p_range_raw'] = devig(*range_mid_dec(c['range'][0], c['range'][1]))
        cons = c.get('cons')
        if cons and cons['n'] >= 2:
            row['p_books_mean'] = devig(*cons['mean_dec'])
            row['p_books_avgnv'] = cons['p_avg_novig']
            row['p_books_median'] = cons['p_median_novig']
            row['n_books'] = cons['n']
            row['best_dec'] = cons['best_dec']
            row['n_books_dropped'] = cons['n_dropped']
        (V if row['period'] == 'vault' else R).append(row)
    assert all(r['date'] < VAULT_FROM for r in R) and all(r['y'] is None for r in V)
    res = {'diag': diag}

    # ---------------- coverage ----------------
    cov = {'n_backtest': len(R), 'scope': f'dev fights (before {VAULT_FROM}); {len(V)} vault fights are exported '
                                        f'outside the repo and never scored', 'n_vault_exported': len(V)}
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

    # ---------------- cleaning: stale / in-play prices in the closing range ----------------
    cl = {'rule': f'closing range spread (implied-probability gap between low and high price of a side) > {MAX_RANGE_SPREAD} '
                  'marks the range and BFO mean as contaminated; per-book lines more than 0.15 from the median book are dropped',
          'contaminated_no_close': {per: sum(1 for r in R if r['period'] == per and r.get('close_flag')) for per in ('tune', 'test')},
          'books_dropped': sum(r.get('n_books_dropped', 0) for r in R),
          'fights_with_dropped_book': sum(1 for r in R if r.get('n_books_dropped')), 'leak_test': {}}
    for per in ('tune', 'test'):
        for lo, hi in ((0, 0.05), (0.05, 0.1), (0.1, 0.2), (0.2, 1.01)):
            g = [r for r in dec if r['period'] == per and r.get('spread') is not None and lo <= r['spread'] < hi
                 and 'p_uud' in r and 'p_open' in r]
            if not g:
                continue
            y = [r['y'] for r in g]
            cl['leak_test'][f'{per}_{lo}-{hi}'] = {
                'n': len(g), 'll_range_mid_raw': metrics([r['p_range_raw'] for r in g], y)['log_loss'],
                'll_single_book_uud': metrics([r['p_uud'] for r in g], y)['log_loss'],
                'll_open': metrics([r['p_open'] for r in g], y)['log_loss'],
                'll_chosen_close': metrics([r['p_close_mult'] for r in g if 'p_close_mult' in r],
                                           [r['y'] for r in g if 'p_close_mult' in r])['log_loss'] if any('p_close_mult' in r for r in g) else None}
    res['cleaning'] = cl

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
                     ('p_bfo_mean', 'p_books_mean'), ('p_books_mean', 'p_books_avgnv'), ('p_books_mean', 'p_books_median'),
                     ('p_books_mean', 'p_uud'), ('p_books_mean', 'p_range_mid')):
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

    # ---------------- market rating (walk-forward prior for fights with no line) ----------------
    mr, mr_pred, mr_cur, mr_adj = market_rating(R, fights, boot=min(a.boot, 1000), V=V, fights_all=fights_all)
    res['market_rating'] = mr
    for r in R + V:
        if r['id'] in mr_pred:
            r['p_mrating'] = mr_pred[r['id']]
        if r['id'] in mr_adj:
            r['p_mrating_adj'] = mr_adj[r['id']]
    res['_ratings'] = mr_cur

    # ---------------- recalibration and stacking: fit on tune, score on test ----------------
    st = {}
    gt = sub('tune', ['p_close_mult', 'p_open', 'p_mrating', 'p_mrating_adj'])
    gs = sub('test', ['p_close_mult', 'p_open', 'p_mrating', 'p_mrating_adj'])
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
        'market_rating': (['p_mrating'], None),
        'market_rating_adj': (['p_mrating_adj'], None),
        'market_rating_adj+elo': (['p_mrating_adj', 'elo'], 'fit'),
        'market_rating_slope': (['p_mrating'], 'fit'),
        'market_rating+elo': (['p_mrating', 'elo'], 'fit'),
        'close+market_rating': (['p_close_mult', 'p_mrating'], 'fit'),
        'open+market_rating': (['p_open', 'p_mrating'], 'fit'),
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

    # ---------------- per book (and prediction markets) vs the consensus on the same fights ----------------
    pb = {}
    for per in ('tune', 'test'):
        acc = defaultdict(lambda: {'p': [], 'c': [], 'y': [], 'ev': []})
        for r in dec:
            if r['period'] != per or 'p_close_mult' not in r:
                continue
            for bk, (a1, a2) in (r['rec'].get('bfo_books') or {}).items():
                d = (am_to_dec(a1), am_to_dec(a2))
                if not sane_pair(d, 0.95, 1.25):
                    continue
                acc[bk]['p'].append(devig(*d))
                acc[bk]['c'].append(r['p_close_mult'])
                acc[bk]['y'].append(r['y'])
                acc[bk]['ev'].append(r['event'])
        pb[per] = {}
        for bk, v in sorted(acc.items()):
            if len(v['y']) < 50:
                continue
            lb, lc = loss_arrays(v['p'], v['y'])[0], loss_arrays(v['c'], v['y'])[0]
            bs = boot_event(v['ev'], {'b': lb, 'c': lc}, B=min(a.boot, 1000))
            pb[per][bk] = {'n': len(v['y']), 'll_book': round(float(lb.mean()), 4), 'll_consensus': round(float(lc.mean()), 4),
                           'diff_ci95': ci(bs['b'] - bs['c'])}
    res['per_book'] = pb

    # ---------------- soft-label scoring: the close as a low-noise target for model selection ----------------
    sl = {}
    for per in ('tune', 'test'):
        g = sub(per, ['p_close_power', 'p_open', 'p_mrating', 'p_mrating_adj'])
        y = np.array([r['y'] for r in g])
        t = np.array([r['p_close_power'] for r in g])
        mods = {'elo': np.array([r['elo'] for r in g]), 'market_rating': np.array([r['p_mrating'] for r in g]),
                'market_rating_adj': np.array([r['p_mrating_adj'] for r in g]), 'open': np.array([r['p_open'] for r in g])}
        def xent(p_, lab):
            p_ = np.clip(p_, 1e-6, 1 - 1e-6)
            return -(lab * np.log(p_) + (1 - lab) * np.log(1 - p_))
        arr = {}
        for k, v in mods.items():
            arr[k + '_hard'] = xent(v, y)
            arr[k + '_soft'] = xent(v, t)
        bs = boot_event([r['event'] for r in g], arr, B=min(a.boot, 1000))
        pairs = {}
        for m1, m2 in (('market_rating', 'elo'), ('market_rating_adj', 'market_rating'), ('open', 'market_rating_adj')):
            dh = bs[m1 + '_hard'] - bs[m2 + '_hard']
            ds = bs[m1 + '_soft'] - bs[m2 + '_soft']
            pairs[f'{m1} - {m2}'] = {
                'hard_diff': round(float(np.mean(arr[m1 + '_hard'] - arr[m2 + '_hard'])), 4), 'hard_se': round(float(np.std(dh)), 4),
                'soft_diff': round(float(np.mean(arr[m1 + '_soft'] - arr[m2 + '_soft'])), 4), 'soft_se': round(float(np.std(ds)), 4),
                'se_ratio_hard_over_soft': round(float(np.std(dh) / np.std(ds)), 2)}
        sl[per] = {'n': len(g), 'pairs': pairs, 'soft_label': 'p_close (power no-vig)'}
    res['soft_label_scoring'] = sl

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

    # ---------------- does anything beat the close? ----------------
    res['residual_features'] = residual_features(R, {f['id']: f for f in fights}, boot=min(a.boot, 1000))

    # ---------------- method props (event pages, if cached) ----------------
    if getattr(a, 'props', None):
        res['method_market'] = method_market(a, fights_all, recs)  # scores tune/test only; vault rows only exported

    write_market_json(R, res, best)
    if not getattr(a, 'no_vault_export', False):
        write_vault_json(V, res, best, a.vault_dir)
    print_summary(res)


def residual_features(R, fights_by_id, boot=1000):
    """Does anything known before the fight predict the result beyond the closing line?
    logit P(A) = b0 logit(p_close) + sum_k b_k x_k (A-minus-B features, no intercept, so the corner label
    cannot matter). One feature at a time and all together; fit on tune, scored on test."""
    np = _np()
    def feats(f):
        A, B = f['A'], f['B']
        def g(s, k, d=None):
            v = s.get(k)
            return d if v is None else v
        def moved(s):
            return 1.0 if (s.get('home') and s['home'] != f['division'] and f['division'] not in ('Catch Weight', 'Open Weight')) else 0.0
        return {
            'age': (g(A, 'age', 30) - g(B, 'age', 30)) / 5,
            'reach_in': (g(A, 'reach_in', 0) or 0) - (g(B, 'reach_in', 0) or 0) if A.get('reach_in') and B.get('reach_in') else 0.0,
            'height_in': (g(A, 'height_in', 0) - g(B, 'height_in', 0)) if A.get('height_in') and B.get('height_in') else 0.0,
            'log_ufc_fights': math.log1p(g(A, 'n', 0)) - math.log1p(g(B, 'n', 0)),
            'ko_losses': g(A, 'ko_losses', 0) - g(B, 'ko_losses', 0),
            'kd_absorbed': g(A, 'kd_absorbed', 0) - g(B, 'kd_absorbed', 0),
            'elo_logit': (g(A, 'elo', 1500) - g(B, 'elo', 1500)) * math.log(10) / 400,
            'weight_move': moved(A) - moved(B),
            'southpaw': (1.0 if A.get('stance') == 'Southpaw' else 0.0) - (1.0 if B.get('stance') == 'Southpaw' else 0.0),
        }
    rows = []
    for r in R:
        if r['y'] is None or 'p_close_mult' not in r:
            continue
        rows.append((r, feats(fights_by_id[r['id']])))
    names = list(rows[0][1].keys())
    out = {'features': names, 'single': {}, 'all': {}}
    def mat(per, keys):
        g = [(r, x) for r, x in rows if r['period'] == per]
        X = np.column_stack([logit([r['p_close_mult'] for r, _ in g])] + [[x[k] for _, x in g] for k in keys])
        y = np.array([r['y'] for r, _ in g])
        return X, y, [r['event'] for r, _ in g]
    Xt0, yt, _ = mat('tune', [])
    Xs0, ys, ev_s = mat('test', [])
    b0, _ = logreg(Xt0, yt)
    base_test = loss_arrays(sigmoid(Xs0 @ b0), ys)[0]
    for k in names + ['ALL']:
        keys = names if k == 'ALL' else [k]
        Xt, yt, _ = mat('tune', keys)
        Xs, ys, ev_s = mat('test', keys)
        b, se = logreg(Xt, yt)
        bt_, st_ = logreg(Xs, ys)  # refit on test, only to see whether a sign persists (not used for scoring)
        lt = loss_arrays(sigmoid(Xs @ b), ys)[0]
        bs = boot_event(ev_s, {'m': lt, 'b': base_test}, B=boot)
        entry = {'tune_coef': {kk: [round(float(bb), 4), round(float(ss), 4)] for kk, bb, ss in zip(['close'] + keys, b, se)},
                 'test_refit_coef': {kk: [round(float(bb), 4), round(float(ss), 4)] for kk, bb, ss in zip(['close'] + keys, bt_, st_)},
                 'test_ll_minus_close_slope': [round(float(np.mean(lt - base_test)), 4), ci(bs['m'] - bs['b'])]}
        (out['all'] if k == 'ALL' else out['single']).update({k: entry} if k != 'ALL' else entry)
    out['n'] = {'tune': int(len(yt)), 'test': int(len(ys))}
    return out


# ----------------------------------------------------------------------------------------------
# market rating: a walk-forward Kalman filter on closing lines (and results)
# ----------------------------------------------------------------------------------------------

def rating_stream(R, fights):
    """Chronological stream of UFC fights 2013+ with ufcstats fighter ids, closing p (fighter 1) and result.
    Backtest fights use this tool's chosen close; the rest use nlbair's (range midpoint, multiplicative).
    R: market rows (dev and vault) for the closes; fights: backtest fights after nlbair's window. Scoring runs
    the filter with until=TEST[1], so no 2026 line or result can reach a scored prediction."""
    import pandas as pd
    nl = pd.read_csv(os.path.join(ODDS_DIR, 'nlbair_odds.csv'), low_memory=False)
    with open(os.path.join(ROOT, 'data', 'derived', 'fighters.json')) as fh:
        slug_id = {k: v.get('id') for k, v in json.load(fh)['fighters'].items()}
    mine = {r['id']: r for r in R}
    stream, have = [], set()
    for q in nl.itertuples():
        pc = mine[q.fight_id]['p_close_mult'] if (q.fight_id in mine and 'p_close_mult' in mine[q.fight_id]) else (
            q.f1_close_prob_novig if q.has_odds and not pd.isna(q.f1_close_prob_novig) else None)
        y = {1.0: 1.0, 2.0: 0.0, 0.0: 0.5}.get(q.winner)
        stream.append({'id': q.fight_id, 'date': q.event_date, 'i': q.f1_id, 'j': q.f2_id, 'p': pc, 'y': y})
        have.add(q.fight_id)
    for f in fights:  # backtest fights after nlbair's window
        if f['id'] in have:
            continue
        i, j = slug_id.get(f['A']['slug']), slug_id.get(f['B']['slug'])
        if not i or not j:
            continue
        r = mine[f['id']]
        y = {'A': 1.0, 'B': 0.0, 'D': 0.5}.get(f['result']['winner'])
        stream.append({'id': f['id'], 'date': f['date'], 'i': i, 'j': j, 'p': r.get('p_close_mult'), 'y': y})
    stream.sort(key=lambda x: (x['date'], x['id']))
    return stream, slug_id


def run_rating(stream, sig_m=0.35, tau=0.35, v0=0.6, mu0=0.0, kappa=0.5, until=None, keep=None):
    """-> (pre-fight predictions {fight_id: p_i}, state {fighter_id: [mu, var, last_date, n]})."""
    mu, var, last, n = {}, {}, {}, {}
    pred = {}
    for e in stream:
        if until and e['date'] > until:
            break
        d = dt.date.fromisoformat(e['date'])
        for k in (e['i'], e['j']):
            if k not in mu:
                mu[k], var[k], n[k] = mu0, v0, 0
            else:
                gap = (d - last[k]).days / 365.25
                var[k] = min(var[k] + tau * tau * max(gap, 0), v0 * 2)
            last[k] = d
        i, j = e['i'], e['j']
        m = mu[i] - mu[j]
        s2 = var[i] + var[j]
        if keep is None or e['id'] in keep:
            pred[e['id']] = 1 / (1 + math.exp(-m / math.sqrt(1 + math.pi * s2 / 8)))
        if e['p'] is not None:
            z = math.log(min(max(e['p'], 0.02), 0.98) / (1 - min(max(e['p'], 0.02), 0.98)))
            S = s2 + sig_m * sig_m
            r = z - m
            ki, kj = var[i] / S, var[j] / S
            mu[i] += ki * r
            mu[j] -= kj * r
            var[i] *= (1 - ki)
            var[j] *= (1 - kj)
        if e['y'] is not None and kappa > 0:
            m2 = mu[i] - mu[j]
            p2 = 1 / (1 + math.exp(-m2))
            g, h = e['y'] - p2, p2 * (1 - p2)
            den = 1 + kappa * h * (var[i] + var[j])
            mu[i] += kappa * var[i] * g / den
            mu[j] -= kappa * var[j] * g / den
            var[i] *= 1 - kappa * var[i] * h / den
            var[j] *= 1 - kappa * var[j] * h / den
        n[i] += 1
        n[j] += 1
    return pred, {k: [mu[k], var[k], last[k].isoformat(), n[k]] for k in mu}


def market_rating(R, fights, boot=1000, V=(), fights_all=None):
    """R: dev rows (scored); V: vault rows (exported only). Scored predictions come from a filter run that stops at
    TEST[1]; the live snapshot and the vault rows' predictions come from a second run over every fight."""
    np = _np()
    V = list(V)
    stream, slug_id = rating_stream(list(R) + V, fights_all or fights)
    dec = [r for r in R if r['y'] is not None]
    keep = {r['id'] for r in R}
    tune_ids = [r for r in dec if r['period'] == 'tune']
    grid = []
    for sig_m in (0.35, 0.5, 0.75):
        for tau in (0.35, 0.5, 0.75):
            for v0 in (1.0, 1.5):
                for kappa in (0.0, 1.0, 1.5, 2.0):
                    pred, _ = run_rating(stream, sig_m, tau, v0, 0.0, kappa, until=TUNE[1], keep=keep)
                    g = [r for r in tune_ids if r['id'] in pred]
                    ll = float(np.mean(loss_arrays([pred[r['id']] for r in g], [r['y'] for r in g])[0]))
                    grid.append(((sig_m, tau, v0, kappa), ll))
    grid.sort(key=lambda x: x[1])
    (sig_m, tau, v0, kappa), ll_t = grid[0]
    pred, _ = run_rating(stream, sig_m, tau, v0, 0.0, kappa, until=TEST[1], keep=keep)     # scored: data to 2025-12-31
    pred_v, state = run_rating(stream, sig_m, tau, v0, 0.0, kappa, keep={r['id'] for r in V})  # live snapshot + vault rows
    sd = [e for e in stream if e['date'] <= TEST[1]]
    out = {'params': {'sig_m': sig_m, 'tau_per_year': tau, 'v0': v0, 'mu0': 0.0, 'kappa_result': kappa},
           'grid_best5': [[list(k), round(v, 4)] for k, v in grid[:5]],
           'stream': {'fights': len(sd), 'with_close': sum(1 for e in sd if e['p'] is not None),
                      'from': sd[0]['date'], 'to': sd[-1]['date']},
           'live_snapshot_stream_to': stream[-1]['date']}
    for per in ('tune', 'test'):
        g = [r for r in dec if r['period'] == per and r['id'] in pred and 'p_close_mult' in r and 'p_open' in r]
        y = np.array([r['y'] for r in g])
        mods = {'market_rating': [pred[r['id']] for r in g], 'elo': [r['elo'] for r in g],
                'open': [r['p_open'] for r in g], 'close': [r['p_close_mult'] for r in g]}
        out[per] = {k: metrics(v, y) for k, v in mods.items()}
        arr = {k: loss_arrays(v, y)[0] for k, v in mods.items()}
        bs = boot_event([r['event'] for r in g], arr, B=boot)
        out[per]['rating_minus_elo_ll'] = [round(float(np.mean(arr['market_rating'] - arr['elo'])), 4), ci(bs['market_rating'] - bs['elo'])]
        out[per]['rating_minus_open_ll'] = [round(float(np.mean(arr['market_rating'] - arr['open'])), 4), ci(bs['market_rating'] - bs['open'])]
        zc = logit([r['p_close_mult'] for r in g])
        zp = logit([pred[r['id']] for r in g])
        zo = logit([r['p_open'] for r in g])
        out[per]['predicts_close_logit'] = {'rmse_rating': round(float(np.sqrt(np.mean((zp - zc) ** 2))), 4),
                                            'rmse_open': round(float(np.sqrt(np.mean((zo - zc) ** 2))), 4),
                                            'corr_rating': round(float(np.corrcoef(zp, zc)[0, 1]), 4),
                                            'corr_open': round(float(np.corrcoef(zo, zc)[0, 1]), 4)}
    # what the closing line adds beyond the rating: weight-class moves and age (for cross-division hypotheticals)
    with open(BACKTEST) as fh:
        pri = json.load(fh)['priors_asof']
    fb = {f['id']: f for f in (fights_all or fights)}
    def lbs(yr, dv):
        return (pri.get(yr, {}).get(dv) or {}).get('lbs')
    def mv(f, side):
        s_ = f[side]
        if f['division'] in ('Catch Weight', 'Open Weight') or not s_.get('home'):
            return 0, 0
        a_, b_ = lbs(f['date'][:4], f['division']), lbs(f['date'][:4], s_['home'])
        if not a_ or not b_ or a_ == b_:
            return 0, 0
        return (1, 0) if a_ > b_ else (0, 1)
    adj = {}
    for r in V:
        if r['id'] in pred_v:
            pred[r['id']] = pred_v[r['id']]   # exported only; every score below filters on tune/test
    for per in ('tune', 'test', 'vault'):
        g = [r for r in (V if per == 'vault' else R) if r['period'] == per and r['id'] in pred
             and (per == 'vault' or 'p_close_mult' in r)]
        X, z, yy = [], [], []
        for r in g:
            f = fb[r['id']]
            ua, da = mv(f, 'A')
            ub, db = mv(f, 'B')
            X.append([ua - ub, da - db, ((f['A'].get('age') or 30) - (f['B'].get('age') or 30)) / 5])
            z.append(float(logit([r['p_close_mult']])[0] - logit([pred[r['id']]])[0]) if 'p_close_mult' in r else float('nan'))
            yy.append(r['y'])
        adj[per] = (np.array(X), np.array(z), [r['id'] for r in g], yy)
    Xt, zt, _, _ = adj['tune']
    bt_, *_ = np.linalg.lstsq(Xt, zt, rcond=None)
    res_t = zt - Xt @ bt_
    cov = np.linalg.inv(Xt.T @ Xt) * float(np.var(res_t))
    Xs, zs, ids_s, ys_ = adj['test']
    bs_, *_ = np.linalg.lstsq(Xs, zs, rcond=None)
    rm0 = float(np.sqrt(np.mean(zs ** 2)))
    rm1 = float(np.sqrt(np.mean((zs - Xs @ bt_) ** 2)))
    names = ['moved_up', 'moved_down', 'age_per_5y']
    # outcome log loss of the adjusted rating on test (decisive fights)
    pr0, pr1, yv = [], [], []
    for x, i, y in zip(Xs, ids_s, ys_):
        if y is None:
            continue
        l0 = float(logit([pred[i]])[0])
        pr0.append(pred[i])
        pr1.append(1 / (1 + math.exp(-(l0 + float(x @ bt_)))))
        yv.append(y)
    pred_adj = {}
    for per in ('tune', 'test', 'vault'):
        X_, _, ids_, _ = adj[per]
        if not len(ids_):
            continue
        for x, i in zip(X_, ids_):
            pred_adj[i] = 1 / (1 + math.exp(-(float(logit([pred[i]])[0]) + float(x @ bt_))))
    out['close_minus_rating'] = {
        'what': 'OLS of logit(p_close) - logit(p_rating) on A-minus-B features, no intercept; fit on tune',
        'coef_tune': {k: [round(float(b), 4), round(float(math.sqrt(cov[i, i])), 4)] for i, (k, b) in enumerate(zip(names, bt_))},
        'coef_test_refit': {k: round(float(b), 4) for k, b in zip(names, bs_)},
        'n_movers_tune': int(np.sum(np.abs(Xt[:, 0]) + np.abs(Xt[:, 1]) > 0)),
        'test_rmse_close_logit': {'rating': round(rm0, 4), 'rating+adj': round(rm1, 4)},
        'test_ll': {'rating': metrics(pr0, yv)['log_loss'], 'rating+adj': metrics(pr1, yv)['log_loss'], 'n': len(yv)}}

    # current ratings (variance drifted to the snapshot) keyed by fighters.json slug
    snap = dt.date.fromisoformat(stream[-1]['date'])
    id_slug = {v: k for k, v in slug_id.items() if v}
    cur = {}
    for fid, (m, v, ld, nn) in state.items():
        if fid not in id_slug:
            continue
        gap = (snap - dt.date.fromisoformat(ld)).days / 365.25
        cur[id_slug[fid]] = [round(m, 4), round(math.sqrt(min(v + tau * tau * gap, 2 * v0)), 4), ld, nn]
    out['n_rated_roster'] = len(cur)
    out['adj_coef'] = {k: round(float(b), 4) for k, b in zip(names, bt_)}
    return out, pred, cur, pred_adj


def encode_rows(R, res, best):
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
        bk = {k: list(v) for k, v in sorted((rec.get('bfo_books') or {}).items()) if k not in EXCHANGES}
        if bk:
            e['books'] = bk
        if rec.get('uud_close'):
            e['uud_close'] = list(rec['uud_close'])
        if rec.get('bfo_mu'):
            e['bfo'] = {'matchup': rec['bfo_mu'], 'event': rec.get('bfo_event')}
        if 'p_mrating' in r:
            e['p_market_rating'] = round(r['p_mrating'], 4)
        if 'p_mrating_adj' in r:
            e['p_market_rating_adj'] = round(r['p_mrating_adj'], 4)
        mm = (res.get('method_market') or {}).get('per_fight', {}).get(r['id'])
        if mm:
            e['method6'] = mm['method6']
            e['method_books'] = mm['n_books']
            if 'p_dec' in mm:
                e['p_dec'] = mm['p_dec']
            if 'round_dist' in mm:
                e['round_dist'] = mm['round_dist']
        fights[r['id']] = e
    return fights


def write_vault_json(V, res, best, vault_dir):
    """Vault fights (2026+): the same per-fight fields as market.json, written outside the repository for the
    milestone auditor. Nothing here is scored, and the build never reads this file back."""
    if not vault_dir:
        return
    os.makedirs(vault_dir, exist_ok=True)
    path = os.path.join(vault_dir, 'market_vault.json')
    out = {'meta': {'built': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'), 'tool': 'tools/market.py',
                    'what': f'market.json per-fight fields for the vault fights (from {VAULT_FROM}); same orientation and '
                            'fields as data/derived/market.json; open only at the v6/v10 audits',
                    'devig_best_on_tune': best},
           'fights': encode_rows(V, res, best)}
    with open(path, 'w') as fh:
        json.dump(out, fh, separators=(',', ':'))
    print(f'wrote {path}: {len(out["fights"])} vault fights (outside the repo)')


def write_market_json(R, res, best):
    fights = encode_rows(R, res, best)
    meta = {
        'built': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
        'tool': 'tools/market.py',
        'orientation': 'every pair is [A, B] in backtest.json order (A = first ufcstats name); p_* = probability that A wins',
        'open': 'first line BFO lists for the fight (one book, often weeks out; may not have been bettable in size)',
        'close': 'consensus closing line (decimal odds [A, B] = mean over books, then American): (1) mean of >= 3 US '
                 'sportsbooks\' closes on the BFO event page after dropping any book whose no-vig p is > 0.15 from the median '
                 'book; (2) BFO\'s mean-odds series end point (mean of the books BFO tracked, read from both fighter pages) '
                 'when the closing range is clean (spread <= 0.20); (3) 1-2 US books; (4) decimal midpoint of a clean closing '
                 'range (nlbair); (5) one book\'s close (Ultimate UFC Dataset) when its overround is 0.99-1.15. `src` says which',
        'close_range': '[[A low, A high], [B low, B high]] closing range across books (BFO), American',
        'cleaning': 'a closing range wider than 0.20 in implied probability holds a stale or in-play price that leaks the '
                    'result; such ranges and BFO means are not used (eval.cleaning)',
        'p_novig': 'multiplicative (proportional) margin removal: p_A = (1/dA) / (1/dA + 1/dB)',
        'devig_best_on_tune': best,
        'books': 'per-book closing lines [A, B] (American) from BFO event pages; covers only the US books BFO lists today '
                 '(about 2021 on)',
        'exchanges': 'Kalshi and Polymarket prices on BFO past-event pages (2026 only) are left out of market.json and the '
                     'consensus: the first build found Kalshi\'s recorded last price was captured after the result. They stay '
                     'in data/raw/odds/bfo_event_lines.csv; those 2026 rows encode results, so dev agents must not read them',
        'walk_forward': 'closing lines are known only minutes before the fight; they are a benchmark and a stacking input '
                        'for live use, never a feature of a model scored on the same fight before the line closes',
        'sources': [
            'BestFightOdds.com (opening lines, closing ranges, mean-odds series, per-book closes), fetched by tools/market.py',
            'nlbair/ufc-data v0.1.1 (CC BY 4.0, doi:10.5281/zenodo.23458636): BFO opening line and closing range per ufcstats fight id',
            'Ultimate UFC Dataset (mdabbert / shortlikeafox, CC BY 4.0): one closing moneyline per fighter',
        ],
        'periods': {'tune': list(TUNE), 'test': list(TEST), 'vault_from': VAULT_FROM},
        'scope': f'per-fight rows and every score cover dev fights only (before {VAULT_FROM}); vault rows go to '
                 'market_vault.json outside the repo. `ratings` alone is fit through the snapshot (live use only)',
    }
    ev = {k: v for k, v in res.items() if k not in ('coverage', '_ratings')}
    meta['p_market_rating'] = ('walk-forward pre-fight probability from the market rating (Kalman filter on earlier closing '
                               'lines and results; eval.market_rating has the equations and parameters); usable before any line exists')
    meta['ratings'] = ('current market ratings by fighters.json slug: [mu (log-odds), sd, last fight date, fights seen]; '
                       'fit on every fight through the snapshot (2026 included): live use only, never for scoring 2026 fights')
    meta['p_market_rating_adj'] = ('p_market_rating plus the tune-fit offsets the closing line adds beyond the rating: '
                                   'logit += c_up (up_A - up_B) + c_down (down_A - down_B) + c_age (age_A - age_B) / 5; '
                                   'coefficients in eval.market_rating.adj_coef')
    if 'method_market' in ev:
        ev['method_market'] = {k: v for k, v in ev['method_market'].items() if k != 'per_fight'}
        meta['method6'] = ('market method-of-victory distribution [A_KO, A_SUB, A_DEC, B_KO, B_SUB, B_DEC]: per book the six '
                           '"wins by TKO/KO / submission / decision" closing prices (decision = UD + split/majority when '
                           'missing), power-normalised to sum 1, averaged over US books; KO includes doctor stoppages')
        meta['p_dec'] = 'P(fight goes to decision): two-way "goes to decision" prop, multiplicative no-vig, averaged over books'
        meta['round_dist'] = ('P(fight ends in round 1..K, decision), from "fight ends in round k" and "goes to decision" '
                              'yes prices, power-normalised, averaged over books')
    out = {'meta': meta, 'coverage': res['coverage'], 'eval': ev, 'ratings': res.get('_ratings', {}), 'fights': fights}
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
    rf = res['residual_features']
    for k, v in list(rf['single'].items()) + [('ALL', rf['all'])]:
        print(f"  resid {k:16s} tune {v['tune_coef']} | test refit {v['test_refit_coef']} | dLL {v['test_ll_minus_close_slope']}")
    mr = res['market_rating']
    print('mrating params', mr['params'], mr['grid_best5'][:3])
    for per in ('tune', 'test'):
        print('mrating', per, {k: (mr[per][k]['log_loss'], mr[per][k]['accuracy']) for k in ('market_rating', 'elo', 'open', 'close')},
              mr[per]['rating_minus_elo_ll'], mr[per]['rating_minus_open_ll'], mr[per]['predicts_close_logit'])
    mm = res.get('method_market')
    if mm and 'eval' in mm:
        for per, v in mm['eval'].items():
            print('method', per, {k: v[k] for k in v if k.startswith('ll6') or k in ('n', 'mean_books')})
            print('   godec', per, v['goes_to_decision']['market'], v['goes_to_decision']['base_rate'])
            if 'round_of_finish' in v:
                print('   rounds', per, v['round_of_finish'])



# ----------------------------------------------------------------------------------------------
# props: method-of-victory and round markets from cached event pages
# ----------------------------------------------------------------------------------------------

# data-li on prop cells: [book, side (1 yes / 2 no), matchup, prop type, team (0 = whole fight)]
PROP_COLS = {(8, 1): 'ko1', (8, 2): 'ko2', (9, 1): 'sub1', (9, 2): 'sub2', (11, 1): 'dec1', (11, 2): 'dec2',
             (18, 1): 'ud1', (18, 2): 'ud2', (19, 1): 'sm1', (19, 2): 'sm2', (6, 0): 'draw',
             (22, 0): 'r1', (23, 0): 'r2', (24, 0): 'r3', (25, 0): 'r4', (26, 0): 'r5'}


def parse_event_props(html):
    """-> {(mu, book): {col: american}} for the props in PROP_COLS (yes side) plus goes-to-decision yes/no."""
    starts = [x.start() for x in re.finditer(r'<table class="odds-table"', html)]
    if not starts:
        return {}
    t = html[starts[-1]:]
    t = t[:t.find('</table>')]
    books = {int(b): n.strip() for b, n in
             re.findall(r'<th scope="col" data-b="(\d+)"[^>]*>(?:<a[^>]*>|<span[^>]*>)([^<]+)', t)}
    out = defaultdict(dict)
    for bid, side, mu, ptype, team, val in re.findall(
            r'data-li="\[(\d+),(\d),(\d+),(\d+),(\d+)\]"><span[^>]*>([^<]+)</span>', t):
        side, ptype, team = int(side), int(ptype), int(team)
        a = parse_am(val)
        if a is None:
            continue
        key = (int(mu), books.get(int(bid), bid))
        if ptype == 1 and team == 0:
            out[key]['godec_yes' if side == 1 else 'godec_no'] = a
        elif side == 1 and (ptype, team) in PROP_COLS:
            out[key][PROP_COLS[(ptype, team)]] = a
    return out


# Full prop families (added Nov 6, 2026 for tools/props.py; parse_event_props above is unchanged). BFO prop type id
# -> short key; team-specific ids (team 1 / 2 on the page) get the team number appended by the caller.
# yes/no: two-way props carry both sides; one-sided props carry the yes price only.
PROP_TYPES_FULL = {
    1: 'godec', 6: 'draw', 8: 'ko', 9: 'sub', 10: 'itd', 11: 'dec', 18: 'ud', 19: 'sm',
    13: 'wr1', 14: 'wr2', 15: 'wr3', 16: 'wr4', 17: 'wr5',                  # fighter wins in round k
    22: 'er1', 23: 'er2', 24: 'er3', 25: 'er4', 26: 'er5',                  # fight ends in round k
    32: 'ou15', 33: 'ou25', 34: 'ou35', 35: 'ou45',                         # over (yes) / under (no) k.5 rounds
    174: 'kor1', 179: 'kor2', 180: 'kor3', 181: 'kor4', 182: 'kor5',        # fighter wins by KO/TKO in round k
    175: 'subr1', 183: 'subr2', 184: 'subr3', 185: 'subr4', 186: 'subr5',   # fighter wins by submission in round k
    187: 'anyko', 188: 'anysub',
}


def parse_event_props_full(html):
    """-> (matchups, props). matchups: {mu: {'t1_name', 't2_name', 'lines': {book: [a1, a2]}}} in page order;
    props: {(mu, book): {key: [yes, no]}} with key = PROP_TYPES_FULL[type] (+ team digit for team props).
    American odds as ints; None where a side is not quoted. Exchanges are kept here (the caller drops them)."""
    starts = [x.start() for x in re.finditer(r'<table class="odds-table"', html)]
    if not starts:
        return {}, {}
    t = html[starts[-1]:]
    t = t[:t.find('</table>')]
    books = {int(b): n.strip() for b, n in
             re.findall(r'<th scope="col" data-b="(\d+)"[^>]*>(?:<a[^>]*>|<span[^>]*>)([^<]+)', t)}
    mus = {}
    props = defaultdict(dict)
    for attrs, row in re.findall(r'<tr([^>]*)>(.*?)</tr>', t, re.S):
        if '<th scope="row"' not in row:
            continue
        if 'class="pr"' in attrs:
            for bid, side, mu, ptype, team, val in re.findall(
                    r'data-li="\[(\d+),(\d),(\d+),(\d+),(\d+)\]"><span[^>]*>([^<]+)</span>', row):
                ptype, team, side = int(ptype), int(team), int(side)
                key = PROP_TYPES_FULL.get(ptype)
                a = parse_am(val)
                if key is None or a is None or side not in (1, 2):
                    continue
                if team in (1, 2):
                    key += str(team)
                rec = props[(int(mu), books.get(int(bid), bid))].setdefault(key, [None, None])
                rec[side - 1] = a
            continue
        fm = re.search(r'href="(/fighters/[^"]+)"><span class="t-b-fcc">([^<]+)</span>', row)
        mu_m = re.search(r'data-li="\[(\d),(\d+)\]"', row)
        if not fm or not mu_m:
            continue
        team, mu = int(mu_m.group(1)), int(mu_m.group(2))
        rec = mus.setdefault(mu, {'lines': {}})
        rec[f't{team}_name'] = unescape(fm.group(2)).strip()
        rec[f't{team}_url'] = fm.group(1)
        for bid, tm, mu2, val in re.findall(r'data-li="\[(\d+),(\d),(\d+)\]"><span[^>]*>([^<]+)</span>', row):
            a = parse_am(val)
            if int(mu2) == mu and a is not None:
                rec['lines'].setdefault(books.get(int(bid), bid), [None, None])[int(tm) - 1] = a
    return mus, dict(props)


PROP_FIELDS = ['ko1', 'sub1', 'dec1', 'ud1', 'sm1', 'ko2', 'sub2', 'dec2', 'ud2', 'sm2', 'draw', 'godec_yes',
               'godec_no', 'r1', 'r2', 'r3', 'r4', 'r5']


def _norm(q, method):
    """normalise a list of implied probabilities (mutually exclusive, exhaustive outcomes) to sum 1."""
    S = sum(q)
    if method == 'mult' or S <= 1:
        return [x / S for x in q]
    k = _bisect(lambda k: sum(x ** k for x in q), 0.05, 20.0)
    v = [x ** k for x in q]
    t = sum(v)
    return [x / t for x in v]


METHOD_CLASSES = ['A_KO', 'A_SUB', 'A_DEC', 'B_KO', 'B_SUB', 'B_DEC']


def method_class(f):
    w, m = f['result']['winner'], f['result']['method']
    if w not in ('A', 'B'):
        return None
    k = {'KO': 'KO', 'DOC': 'KO', 'SUB': 'SUB', 'UD': 'DEC', 'SD': 'DEC', 'MD': 'DEC'}.get(m)
    return f'{w}_{k}' if k else None


def method_market(a, fights, recs):
    """6-way method-of-victory, goes-to-decision and round-of-finish markets vs walk-forward base rates."""
    np = _np()
    path = os.path.join(ODDS_DIR, 'bfo_event_props.csv')
    if not os.path.exists(path):
        return {'note': 'run `tools/market.py props` first'}
    with open(BACKTEST) as fh:
        pri = json.load(fh)['priors_asof']
    props = defaultdict(dict)
    for r in read_csv(path):
        props[int(r['mu'])][r['book']] = {k: _int(r[k]) for k in PROP_FIELDS}
    out = {'classes': METHOD_CLASSES}
    rows = []
    for f in fights:
        rec = recs[f['id']]
        mu = rec.get('bfo_mu')
        if not mu or mu not in props:
            continue
        sw = rec.get('bfo_swap', False)
        books = props[mu]
        # per book six-way method distribution (team order -> A/B order)
        six = {'mult': [], 'power': []}
        for bk, d in books.items():
            def dec_of(t):
                if d.get(f'dec{t}'):
                    return 1 / am_to_dec(d[f'dec{t}'])
                if d.get(f'ud{t}') and d.get(f'sm{t}'):
                    return 1 / am_to_dec(d[f'ud{t}']) + 1 / am_to_dec(d[f'sm{t}'])
                return None
            q = []
            for t in (1, 2):
                q += [1 / am_to_dec(d[f'ko{t}']) if d.get(f'ko{t}') else None,
                      1 / am_to_dec(d[f'sub{t}']) if d.get(f'sub{t}') else None, dec_of(t)]
            if any(x is None for x in q):
                continue
            if sw:
                q = q[3:] + q[:3]
            for m in six:
                six[m].append(_norm(q, m))
        # goes to decision (two-way), round of finish (K rounds + decision)
        gd = [devig(am_to_dec(d['godec_yes']), am_to_dec(d['godec_no'])) for d in books.values()
              if d.get('godec_yes') and d.get('godec_no')]
        K = f['rounds']
        rd = {'mult': [], 'power': []}
        for d in books.values():
            if all(d.get(f'r{k}') for k in range(1, K + 1)) and d.get('godec_yes'):
                q = [1 / am_to_dec(d[f'r{k}']) for k in range(1, K + 1)] + [1 / am_to_dec(d['godec_yes'])]
                for m in rd:
                    rd[m].append(_norm(q, m))
        per_ = period_of(f['date'])
        row = {'id': f['id'], 'date': f['date'], 'event': f['event'], 'period': per_,
               'cls': method_class(f) if per_ != 'vault' else None, 'K': K,
               'res': f['result'] if per_ != 'vault' else {}}
        if six['mult']:
            for m in six:
                row['six_' + m] = list(np.mean(six[m], axis=0))
            row['n_books_method'] = len(six['mult'])
        if gd:
            row['p_dec'] = float(np.mean(gd))
            row['n_books_dec'] = len(gd)
        if rd['mult']:
            for m in rd:
                row['rd_' + m] = list(np.mean(rd[m], axis=0))
        # walk-forward base rates: division finish split from priors_asof[year]
        dv = f.get('prior_division') or f['division']
        P = pri[f['date'][:4]].get(dv) or pri[f['date'][:4]]['ALL']
        fin = (P if K == 3 else pri[f['date'][:4]]['ALL'])['fin3' if K == 3 else 'fin5']
        ko, sb, de = sum(fin['KO']), sum(fin['SUB']), fin['DEC']
        tot = ko + sb + de
        row['base_share'] = [ko / tot, sb / tot, de / tot]
        rr = [fin['KO'][k] + fin['SUB'][k] for k in range(K)] + [de]
        row['base_round'] = [x / sum(rr) for x in rr]
        rows.append(row)
    # attach market moneyline (multiplicative close) for the baseline
    ml = {}
    for f in fights:
        c = choose(recs[f['id']])
        if c.get('close_dec'):
            ml[f['id']] = devig(*c['close_dec'])
    res = {}
    for per in ('tune', 'test'):
        g = [r for r in rows if r['period'] == per and r['cls'] and 'six_mult' in r and r['id'] in ml]
        if not g:
            continue
        idx = np.array([METHOD_CLASSES.index(r['cls']) for r in g])
        def ll6(P):
            P = np.clip(np.asarray(P), 1e-6, 1)
            return float(np.mean(-np.log(P[np.arange(len(P)), idx])))
        base = []
        base_only = []
        for r in g:
            pa = ml[r['id']]
            sh = r['base_share']
            base.append([pa * x for x in sh] + [(1 - pa) * x for x in sh])
            base_only.append([0.5 * x for x in sh] * 2)
        mk = {m: [r['six_' + m] for r in g] for m in ('mult', 'power')}
        # moneyline-consistent market: rescale A's three and B's three to the closing moneyline
        mlc = []
        for r in g:
            v = r['six_power']
            pa = ml[r['id']]
            sa, sb_ = sum(v[:3]), sum(v[3:])
            mlc.append([x * pa / sa for x in v[:3]] + [x * (1 - pa) / sb_ for x in v[3:]])
        res[per] = {'n': len(g), 'll6_market_mult': round(ll6(mk['mult']), 4), 'll6_market_power': round(ll6(mk['power']), 4),
                    'll6_market_power_ml_rescaled': round(ll6(mlc), 4),
                    'll6_moneyline_x_base_rates': round(ll6(base), 4), 'll6_base_rates_only': round(ll6(base_only), 4),
                    'll6_uniform': round(math.log(6), 4),
                    'mean_books': round(float(np.mean([r['n_books_method'] for r in g])), 2)}
        # cluster bootstrap on the market - baseline difference
        P1 = np.clip(np.asarray(mk['power']), 1e-6, 1)[np.arange(len(g)), idx]
        P0 = np.clip(np.asarray(base), 1e-6, 1)[np.arange(len(g)), idx]
        bs = boot_event([r['event'] for r in g], {'m': -np.log(P1), 'b': -np.log(P0)}, B=a.boot)
        res[per]['ll6_market_minus_baseline_ci95'] = ci(bs['m'] - bs['b'])
        # calibration of the method shares: predicted vs observed totals
        Pm = np.asarray(mk['power'])
        obs = np.bincount(idx, minlength=6) / len(g)
        res[per]['class_pred_vs_obs'] = {c: [round(float(Pm[:, i].mean()), 4), round(float(obs[i]), 4)]
                                         for i, c in enumerate(METHOD_CLASSES)}
        fin_pred = Pm[:, [0, 1, 3, 4]].sum(axis=1)
        fin_obs = np.isin(idx, [0, 1, 3, 4]).astype(float)
        res[per]['finish_calibration'] = calib_bins_generic(fin_pred, fin_obs)
        # goes-to-decision two-way market (fights with a decisive or draw result, excluding NC)
        gd = [r for r in rows if r['period'] == per and 'p_dec' in r and r['res']['winner'] in ('A', 'B', 'D')]
        yd = np.array([1.0 if r['res']['method'] in ('UD', 'SD', 'MD', 'DRAW') else 0.0 for r in gd])
        pdm = np.array([r['p_dec'] for r in gd])
        pdb = np.array([r['base_share'][2] for r in gd])
        res[per]['goes_to_decision'] = {'market': metrics(pdm, yd), 'base_rate': metrics(pdb, yd),
                                        'pred_mean': round(float(pdm.mean()), 4), 'obs_mean': round(float(yd.mean()), 4),
                                        'calibration': calib_bins_generic(pdm, yd)}
        # round of finish (K rounds + decision)
        gr = [r for r in rows if r['period'] == per and 'rd_power' in r and r['res']['winner'] in ('A', 'B', 'D')
              and r['res']['method'] not in ('DQ', 'NC', 'CNC')]
        if gr:
            def rcls(r):
                return r['K'] if r['res']['method'] in ('UD', 'SD', 'MD', 'DRAW') else r['res']['round'] - 1
            ri = [rcls(r) for r in gr]
            def llr(key):
                return round(float(np.mean([-math.log(max(r[key][i], 1e-6)) for r, i in zip(gr, ri)])), 4)
            res[per]['round_of_finish'] = {'n': len(gr), 'll_market_mult': llr('rd_mult'), 'll_market_power': llr('rd_power'),
                                           'll_base_rates': llr('base_round')}
    out['eval'] = res
    out['per_fight'] = {r['id']: {'method6': [round(x, 4) for x in r['six_power']], 'n_books': r['n_books_method'],
                                  **({'p_dec': round(r['p_dec'], 4)} if 'p_dec' in r else {}),
                                  **({'round_dist': [round(x, 4) for x in r['rd_power']]} if 'rd_power' in r else {})}
                        for r in rows if 'six_power' in r}
    out['coverage'] = {per: sum(1 for r in rows if r['period'] == per and 'six_mult' in r) for per in ('tune', 'test')}
    return out


def calib_bins_generic(p, y, edges=(0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1.0001)):
    np = _np()
    p = np.asarray(p, float)
    y = np.asarray(y, float)
    out = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        k = (p >= lo) & (p < hi)
        n = int(k.sum())
        if n:
            out.append({'lo': lo, 'hi': round(min(hi, 1), 2), 'n': n, 'pred': round(float(p[k].mean()), 4),
                        'obs': round(float(y[k].mean()), 4), 'ci95': wilson(float(y[k].sum()), n)})
    return out


# ----------------------------------------------------------------------------------------------
# tables: markdown for the report, rendered from market.json (no hand-copied numbers)
# ----------------------------------------------------------------------------------------------

def _f(x, d=3):
    return '' if x is None else (f'{x:.{d}f}' if isinstance(x, float) else str(x))


def _ci(v, d=3):
    return f'[{v[0]:.{d}f}, {v[1]:.{d}f}]'


def cmd_tables(a):
    with open(OUT_JSON) as fh:
        M = json.load(fh)
    E, C = M['eval'], M['coverage']
    L = []
    L.append('### Coverage by year (backtest fights)\n')
    L.append('| Year | Fights | Open | Close | Close share | Per-book closes | Close source |')
    L.append('|---|---|---|---|---|---|---|')
    for yr, v in C['by_year'].items():
        src = ', '.join(f"{k[4:]} {n}" for k, n in sorted(v.items()) if k.startswith('src_'))
        L.append(f"| {yr} | {v['fights']} | {v.get('open', 0)} | {v.get('close', 0)} | {v.get('close', 0) / v['fights']:.1%} | {v.get('per_book_close', 0)} | {src} |")
    for per in ('tune', 'test'):
        v = C[per]
        L.append(f"| **{per}** | {v['fights']} | {v['open']} | {v['close']} | {v['close_share']:.1%} | {v['per_book_close']} | |")
    L.append('\n### Headline: decisive fights with both an opening and a closing line\n')
    L.append('| Period | Model | n | Log loss [95% CI] | Brier [95% CI] | Accuracy [95% CI] | ECE |')
    L.append('|---|---|---|---|---|---|---|')
    for per in ('tune', 'test'):
        h = E['headline'][per]
        for k, lab in (('elo', 'Elo (K 44)'), ('open', 'Opening line'), ('close', 'Closing line')):
            m = h[k]
            L.append(f"| {per} | {lab} | {m['n']} | {m['log_loss']:.4f} {_ci(m['log_loss_ci95'], 4)} | {m['brier']:.4f} {_ci(m['brier_ci95'], 4)} | "
                     f"{m['accuracy']:.3f} {_ci(m['accuracy_ci95'])} | {m['ece']:.4f} |")
        mr = E['market_rating'][per]['market_rating']
        L.append(f"| {per} | Market rating (no line needed) | {mr['n']} | {mr['log_loss']:.4f} | {mr['brier']:.4f} | {mr['accuracy']:.3f} | {mr['ece']:.4f} |")
        ma = E['stacking']['market_rating_adj'][per]
        L.append(f"| {per} | Market rating + age and weight-move offsets | {ma['n']} | {ma['log_loss']:.4f} | {ma['brier']:.4f} | {ma['accuracy']:.3f} | {ma['ece']:.4f} |")
    L.append('\n| Period | Close - Elo (LL) | Close - Open (LL) | Open - Elo (LL) | Rating - Elo (LL) | Rating - Open (LL) |')
    L.append('|---|---|---|---|---|---|')
    for per in ('tune', 'test'):
        d = E['headline'][per]['diff']
        r = E['market_rating'][per]
        L.append(f"| {per} | {d['close_minus_elo_ll'][0]:+.4f} {_ci(d['close_minus_elo_ll'][1], 4)} | {d['close_minus_open_ll'][0]:+.4f} {_ci(d['close_minus_open_ll'][1], 4)} | "
                 f"{d['open_minus_elo_ll'][0]:+.4f} {_ci(d['open_minus_elo_ll'][1], 4)} | {r['rating_minus_elo_ll'][0]:+.4f} {_ci(r['rating_minus_elo_ll'][1], 4)} | "
                 f"{r['rating_minus_open_ll'][0]:+.4f} {_ci(r['rating_minus_open_ll'][1], 4)} |")
    mr = E['market_rating']
    L.append('\n### Market rating\n')
    L.append(f"Parameters (chosen on tune): {mr['params']}. Stream: {mr['stream']}. Best five grid points: {mr['grid_best5']}.\n")
    L.append('| Period | Predicting the close (logit RMSE / corr): rating | opening line |')
    L.append('|---|---|---|')
    for per in ('tune', 'test'):
        q = mr[per]['predicts_close_logit']
        L.append(f"| {per} | {q['rmse_rating']:.3f} / {q['corr_rating']:.3f} | {q['rmse_open']:.3f} / {q['corr_open']:.3f} |")
    cm = mr['close_minus_rating']
    L.append(f"\nWhat the close adds beyond the rating ({cm['what']}): tune coef [b, se] {cm['coef_tune']}; test refit {cm['coef_test_refit']}; "
             f"movers in tune {cm['n_movers_tune']}; test logit RMSE vs close {cm['test_rmse_close_logit']}; test outcome LL {cm['test_ll']}.\n")
    L.append('\n### No-vig method (closing and opening lines; same fights as the headline)\n')
    L.append('| Method | Close LL tune | Close LL test | Open LL tune | Open LL test |')
    L.append('|---|---|---|---|---|')
    for m in DEVIG_METHODS:
        L.append(f"| {m} | {E['devig']['tune'][m]['log_loss']:.4f} | {E['devig']['test'][m]['log_loss']:.4f} | "
                 f"{E['devig']['tune']['open'][m]['log_loss']:.4f} | {E['devig']['test']['open'][m]['log_loss']:.4f} |")
    L.append(f"\nChosen on tune: **{E['devig']['chosen_on_tune']}**.\n")
    L.append('### Closing-line representations (pairwise, common fights, multiplicative no-vig)\n')
    L.append('| Period | Pair | n | LL first | LL second | Mean abs diff in p |')
    L.append('|---|---|---|---|---|---|')
    for per in ('tune', 'test'):
        for pair, v in E['close_representations'][per].items():
            a1, a2 = pair.split('|')
            L.append(f"| {per} | {a1[2:]} vs {a2[2:]} | {v[a1]['n']} | {v[a1]['log_loss']:.4f} | {v[a2]['log_loss']:.4f} | {v['mean_abs_diff']:.4f} |")
    L.append('\n### Calibration of the closing line (favourite side)\n')
    for per in ('tune', 'test'):
        c = E['calibration'][per]
        L.append(f"**{per}** (n {c['n']}): favourites won {c['fav_win_rate']:.3f} vs implied {c['fav_implied']:.3f}; slope-only "
                 f"b = {c['slope_only']['b']:.3f} (se {c['slope_only']['se']:.3f}); favourite intercept+slope a = {c['fav_intercept_slope']['a']:+.3f} "
                 f"(se {c['fav_intercept_slope']['a_se']:.3f}), b = {c['fav_intercept_slope']['b']:.3f} (se {c['fav_intercept_slope']['b_se']:.3f}); "
                 f"opening-line slope b = {c['open_slope_only']['b']:.3f} (se {c['open_slope_only']['se']:.3f}); median overround close "
                 f"{c['overround_close_median']:.4f}, open {c.get('overround_open_median', float('nan')):.4f}.\n")
        L.append('| Favourite p | n | Mean implied | Won | 95% CI |')
        L.append('|---|---|---|---|---|')
        for b in c['table']:
            L.append(f"| {b['lo']:.2f}-{b['hi']:.2f} | {b['n']} | {b['pred']:.3f} | {b['obs']:.3f} | [{b['ci95'][0]:.3f}, {b['ci95'][1]:.3f}] |")
        L.append('')
    L.append('### Favourite-longshot bias: flat-stake ROI by implied probability (both sides of every fight)\n')
    L.append('| Period | Implied band | Sides | Mean implied | Won | ROI at mean close (se) | ROI at best US book (n) |')
    L.append('|---|---|---|---|---|---|---|')
    for per in ('tune', 'test', 'all'):
        for b in E['calibration'][per]['roi_by_band']:
            rb = f"{b['roi_best_book']:+.3f} ({b['n_best']})" if b['roi_best_book'] is not None else ''
            L.append(f"| {per} | {b['band'][0]:.1f}-{b['band'][1]:.1f} | {b['n_sides']} | {b['implied']:.3f} | {b['won']:.3f} | "
                     f"{b['roi_mean_odds']:+.3f} ({b['roi_se']:.3f}) | {rb} |")
    L.append('\n### Recalibration and stacking (fit on 2019-2023, scored on 2024-2025)\n')
    L.append('| Variant | Coefficients on logit scale [b, se] | LL tune | LL test | Test LL - close (95% CI) |')
    L.append('|---|---|---|---|---|')
    for k, v in E['stacking'].items():
        if k == 'n':
            continue
        co = '' if not v['coef_logit_[b,se]'] else '; '.join(f"{kk} {vv[0]:+.3f} ({vv[1]:.3f})" for kk, vv in v['coef_logit_[b,se]'].items())
        d = v['test_ll_minus_close_mult']
        L.append(f"| {k} | {co} | {v['tune']['log_loss']:.4f} | {v['test']['log_loss']:.4f} | {d[0]:+.4f} {_ci(d[1], 4)} |")
    L.append(f"\nn: {E['stacking']['n']}\n")
    L.append('### Does anything known before the fight beat the close? (one feature at a time, plus all)\n')
    L.append('| Feature (A minus B) | Tune coef (se) | Test refit coef (se) | Test LL change vs close+slope (95% CI) |')
    L.append('|---|---|---|---|')
    rf = E['residual_features']
    for k, v in list(rf['single'].items()) + [('ALL nine', rf['all'])]:
        if k == 'ALL nine':
            L.append(f"| all nine | see json | see json | {v['test_ll_minus_close_slope'][0]:+.4f} {_ci(v['test_ll_minus_close_slope'][1], 4)} |")
        else:
            t, s_ = v['tune_coef'][k], v['test_refit_coef'][k]
            L.append(f"| {k} | {t[0]:+.4f} ({t[1]:.4f}) | {s_[0]:+.4f} ({s_[1]:.4f}) | {v['test_ll_minus_close_slope'][0]:+.4f} {_ci(v['test_ll_minus_close_slope'][1], 4)} |")
    L.append('\n### Each book (and prediction market) vs the consensus close on the same fights\n')
    L.append('| Period | Book | n | LL book | LL consensus | Book - consensus (95% CI) |')
    L.append('|---|---|---|---|---|---|')
    for per, v in E.get('per_book', {}).items():
        for bk, w in v.items():
            L.append(f"| {per} | {bk} | {w['n']} | {w['ll_book']:.4f} | {w['ll_consensus']:.4f} | {_ci(w['diff_ci95'], 4)} |")
    sl = E.get('soft_label_scoring')
    if sl:
        L.append('\n### Soft-label scoring: model differences scored on outcomes (hard) vs on the closing line (soft)\n')
        L.append('| Period | Pair | Hard diff (se) | Soft diff (se) | se ratio hard/soft |')
        L.append('|---|---|---|---|---|')
        for per, v in sl.items():
            for k, w in v['pairs'].items():
                L.append(f"| {per} (n {v['n']}) | {k} | {w['hard_diff']:+.4f} ({w['hard_se']:.4f}) | {w['soft_diff']:+.4f} ({w['soft_se']:.4f}) | {w['se_ratio_hard_over_soft']} |")
    L.append('\n### By year (closing line, all decisive fights with a close)\n')
    L.append('| Year | n | Close LL | Close acc | Open LL | Elo LL |')
    L.append('|---|---|---|---|---|---|')
    for yr, v in E['by_year'].items():
        L.append(f"| {yr} | {v['close']['n']} | {v['close']['log_loss']:.4f} | {v['close']['accuracy']:.3f} | {v['open']['log_loss']:.4f} | {v['elo']['log_loss']:.4f} |")
    L.append('\n### Segments (closing line)\n')
    L.append('| Segment | n | LL | Brier | Acc |')
    L.append('|---|---|---|---|---|')
    for k, v in E['segments'].items():
        L.append(f"| {k} | {v['n']} | {v['log_loss']:.4f} | {v['brier']:.4f} | {v['accuracy']:.3f} |")
    L.append('\n### Line movement (no-vig, open to close)\n')
    L.append('| Period | n | Mean abs move | Median abs move | Share moving > 5 pts | Favourite flips |')
    L.append('|---|---|---|---|---|---|')
    for per, v in E['line_movement'].items():
        L.append(f"| {per} | {v['n']} | {v['mean_abs_move']:.4f} | {v['median_abs_move']:.4f} | {v['share_move_gt_5pts']:.3f} | {v['favourite_flips']} |")
    mm = E.get('method_market')
    if mm and 'eval' in mm:
        L.append('\n### Method-of-victory and round markets (per-book closes, 2021 on)\n')
        L.append('| Period | n | 6-way LL market (power) | market (mult) | market rescaled to moneyline | moneyline x division base rates | base rates only | uniform | Market - baseline (95% CI) | Books |')
        L.append('|---|---|---|---|---|---|---|---|---|---|')
        for per, v in mm['eval'].items():
            L.append(f"| {per} | {v['n']} | {v['ll6_market_power']:.4f} | {v['ll6_market_mult']:.4f} | {v['ll6_market_power_ml_rescaled']:.4f} | "
                     f"{v['ll6_moneyline_x_base_rates']:.4f} | {v['ll6_base_rates_only']:.4f} | {v['ll6_uniform']:.4f} | "
                     f"{_ci(v['ll6_market_minus_baseline_ci95'], 4)} | {v['mean_books']} |")
        for per, v in mm['eval'].items():
            g = v['goes_to_decision']
            L.append(f"\n**{per} goes to decision**: market LL {g['market']['log_loss']:.4f} / Brier {g['market']['brier']:.4f} vs base rate "
                     f"LL {g['base_rate']['log_loss']:.4f} / Brier {g['base_rate']['brier']:.4f} (n {g['market']['n']}; predicted {g['pred_mean']:.3f}, observed {g['obs_mean']:.3f}).")
            if 'round_of_finish' in v:
                r = v['round_of_finish']
                L.append(f"**{per} round of finish** (rounds 1..K + decision, n {r['n']}): market LL {r['ll_market_power']:.4f} (mult {r['ll_market_mult']:.4f}) vs base rates {r['ll_base_rates']:.4f}.")
            L.append('\n| Class | Predicted share | Observed share |')
            L.append('|---|---|---|')
            for c, (pp, oo) in v['class_pred_vs_obs'].items():
                L.append(f'| {c} | {pp:.3f} | {oo:.3f} |')
    cl = E.get('cleaning')
    if cl:
        L.append('\n### Cleaning: stale or in-play prices in the closing range\n')
        L.append(f"Rule: {cl['rule']}. Fights left with no close: {cl['contaminated_no_close']}; books dropped {cl['books_dropped']} "
                 f"in {cl['fights_with_dropped_book']} fights.\n")
        L.append('| Period, range spread | n | LL raw range midpoint | LL single-book close (UUD) | LL open | LL chosen close |')
        L.append('|---|---|---|---|---|---|')
        for k, v in cl['leak_test'].items():
            L.append(f"| {k} | {v['n']} | {v['ll_range_mid_raw']:.4f} | {v['ll_single_book_uud']:.4f} | {v['ll_open']:.4f} | {_f(v['ll_chosen_close'], 4)} |")
    L.append('\n### Data checks\n')
    for k, v in E['checks'].items():
        L.append(f'- {k}: {v}')
    L.append(f"- diag: {E['diag']}")
    k = 0
    for i, line in enumerate(L):
        if line.lstrip('\n').startswith('### '):
            k += 1
            L[i] = line.replace('### ', f'### 4.{k} ', 1)
    print('\n'.join(L))


def cmd_props(a):
    F = Fetcher(os.path.join(a.cache, 'bfo'))
    ev = read_csv(os.path.join(ODDS_DIR, 'bfo_event_lines.csv'))
    seen = {}
    for r in ev:
        seen[r['event_slug'] + '-' + r['event_id']] = r['date']
    rows = []
    for slug, date in sorted(seen.items(), key=lambda x: x[1]):
        fp = F.path_for(f'{BFO}/events/{slug}')
        if not os.path.exists(fp):
            continue
        with gzip.open(fp, 'rt', encoding='utf-8', errors='replace') as fh:
            html = fh.read()
        for (mu, book), d in parse_event_props(html).items():
            if book in EXCHANGES:
                continue
            rows.append(dict(d, mu=mu, book=book, date=date, event=slug))
    write_csv(os.path.join(ODDS_DIR, 'bfo_event_props.csv'), rows, ['mu', 'date', 'event', 'book'] + PROP_FIELDS)
    print(f'props: {len(rows)} matchup-book rows from {len(seen)} events')


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
    b.add_argument('--props', action='store_true', help='also evaluate the method/round prop markets')
    b.add_argument('--vault-dir', default=VAULT_DIR, help='where market_vault.json goes (outside the repo)')
    b.add_argument('--no-vault-export', action='store_true')
    b.set_defaults(func=cmd_build)
    t = sub.add_parser('tables')
    t.set_defaults(func=cmd_tables)
    pr = sub.add_parser('props')
    pr.add_argument('--cache', default=os.path.expanduser('~/.cache/xx-market'))
    pr.set_defaults(func=cmd_props)
    a = ap.parse_args()
    a.func(a)


if __name__ == '__main__':
    main()
