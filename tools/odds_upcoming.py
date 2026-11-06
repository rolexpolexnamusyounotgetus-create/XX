#!/usr/bin/env python3
"""Upcoming UFC odds for the forward test: per-book moneylines, no-vig probabilities, consensus, props.

Every run writes a NEW timestamped snapshot (never overwrites an earlier one) and rebuilds the
open-vs-close timeline from all snapshots on disk:

  data/predictions/odds_snapshot_<YYYYMMDD-HHMM>.json   one capture of every bout in the window (UTC stamp)
  data/derived/odds_upcoming.json                       per-bout timeline: market open, first capture, last
                                                         pre-lock capture (market at prediction time), last
                                                         pre-start capture (closing proxy), archived close,
                                                         Pinnacle open -> last

Usage (from the project root). Run it in fight week, again at T-2h before each card's lock (the
earliest start_utc in cards_upcoming.json), and about 10 h after the card for the archived closes:

  python3 -I tools/odds_upcoming.py snapshot                 # fetch all sources, write a snapshot + timeline
  python3 -I tools/odds_upcoming.py snapshot --until 2026-12-20 --history none --no-fight-detail   # lighter
  python3 -I tools/odds_upcoming.py snapshot --replay 20261106-1015   # rebuild from cached raw pages, no network
  python3 -I tools/odds_upcoming.py timeline                 # rebuild data/derived/odds_upcoming.json only
  python3 -I tools/odds_upcoming.py show [STAMP]             # print one snapshot as a table
  python3 -I tools/odds_upcoming.py plan                     # recommended capture times per event

Per bout: every book's line oriented to (a, b) with multiplicative / Shin / power no-vig P(a); sanity and
outlier filters; consensus (headline = logit-mean of per-book Shin over sportsbooks), sharp-book,
Pinnacle and exchange views; the ledger-format market block (mean of BestFightOdds' books, multiplicative
no-vig, as data/predictions/README.md defines the benchmark); the market open (per-book openers); the
7-way method-of-victory market and P(goes the distance) from BFO props. Method notes and caveats:
research/data_odds_upcoming.md.

Bout universe: data/predictions/cards_upcoming.json when it exists (A/B order kept); otherwise the cards
are gathered from Wikipedia event pages plus any in-window bout an odds site lists.

Sources (all public pages; generic User-Agent; robots.txt checked at run time; <= 1 request/second
overall; raw responses cached gzip'd under data/raw/web_cache/<site>/<stamp>/):
  bestfightodds   event pages: moneylines for the US books BFO lists + Polymarket/Kalshi, and props
                  (method of victory, goes the distance, rounds totals). robots: all but /cnadm/.
  fightodds       fightodds.io public GraphQL API (the site's own persisted queries): ~24 books incl.
                  Pinnacle, Circa, Bookmaker, BetOnline and exchanges; per-book open/best/worst;
                  full timestamped line history for the --history books (default Pinnacle).
  actionnetwork   /ufc/odds page data (next card only; query strings are disallowed by robots.txt):
                  DK, FanDuel, BetMGM, bet365, Polymarket, AN's own opener; scheduled start per bout.
  covers          /sport/mma/ufc/odds (oddsshark.com/ufc/odds now redirects here). Low trust: several
                  columns carry other markets, so every line must pass the sanity and outlier checks.
  wikipedia       List_of_UFC_events + event pages (/wiki/ only; /w/ and /api/ are disallowed).

Downloaded content is untrusted data: parsed with json/regex only, never executed.
"""

import argparse
import datetime as dt
import glob
import gzip
import html as htmlmod
import json
import math
import os
import random
import re
import ssl
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRED_DIR = os.path.join(ROOT, 'data', 'predictions')
CARDS_JSON = os.path.join(PRED_DIR, 'cards_upcoming.json')
CACHE_ROOT = os.path.join(ROOT, 'data', 'raw', 'web_cache')
FIGHTERS_JSON = os.path.join(ROOT, 'data', 'derived', 'fighters.json')
TIMELINE_JSON = os.path.join(ROOT, 'data', 'derived', 'odds_upcoming.json')
UA = 'FightLabSim/1.0 (private research)'
CA_BUNDLE = '/root/.ccr/ca-bundle.crt'
VERSION = 1

BFO = 'https://www.bestfightodds.com'
FO_SITE = 'https://fightodds.io'
FO_API = 'https://api.fightodds.io/gql'
AN_URL = 'https://www.actionnetwork.com/ufc/odds'
COVERS_URL = 'https://www.covers.com/sport/mma/ufc/odds'
WIKI = 'https://en.wikipedia.org'

# ----------------------------------------------------------------------------------------------
# book identities and classes
# ----------------------------------------------------------------------------------------------

BOOK_ALIASES = {
    'betway': 'Betway', 'draftkings': 'DraftKings', 'dk nj': 'DraftKings', 'draft-kings': 'DraftKings',
    'fanduel': 'FanDuel', 'fanduel nj': 'FanDuel', 'betmgm': 'BetMGM', 'betmgm nj': 'BetMGM',
    'bet365': 'bet365', 'bet365 nj': 'bet365', 'caesars': 'Caesars', 'caesars-odds': 'Caesars',
    'betrivers': 'BetRivers', 'unibet': 'Unibet', 'hardrockbet': 'HardRock', 'hard-rock': 'HardRock',
    'hard rock': 'HardRock', 'betfanatics-sportsbook': 'Fanatics', 'fanatics': 'Fanatics',
    'thescore': 'theScore', 'pinnacle': 'Pinnacle', 'circa': 'Circa', 'bookmaker': 'Bookmaker',
    'betonline': 'BetOnline', 'bet105': 'Bet105', 'bovada': 'Bovada', 'mybookie': 'MyBookie',
    'betus': 'BetUS', 'youwager': 'YouWager', 'betanything': 'BetAnything', 'cloudbet': 'Cloudbet',
    'polymarket': 'Polymarket', 'kalshi': 'Kalshi', 'sxbet': 'SXBet', 'prophetx': 'ProphetX',
    '4casters': '4casters', '4cx': '4Cx', 'novig': 'Novig', 'betfair': 'Betfair',
    'polymarket us': 'PolymarketUS', 'polymarketus': 'PolymarketUS',
}
# Low-margin books that take sharp action (MMA market makers); used for p_sharp.
SHARP = {'Pinnacle', 'Circa', 'Bookmaker', 'BetOnline', 'Bet105'}
# Exchanges and prediction markets: kept, reported separately, never in the sportsbook consensus.
# Polymarket = the international book (fightodds, Action Network); PolymarketUS = the US app (BFO's column).
# Kalshi on fightodds is the raw ask; BFO's Kalshi column adds Kalshi's taker fee (0.07 p (1-p)).
EXCHANGE = {'Polymarket', 'PolymarketUS', 'Kalshi', 'SXBet', 'ProphetX', '4casters', '4Cx', 'Novig', 'Betfair'}
# Source priority when the same book is seen on several sites (first = preferred).
SRC_PRIORITY = ['fightodds', 'bestfightodds', 'actionnetwork', 'covers']

# Sanity limits for one two-way line: overround (sum of implied - 1).
OVR_MIN, OVR_MAX = -0.01, 0.15   # exchanges may quote near 0
OVR_MIN_BOOK = 0.01              # a sportsbook moneyline under 1% margin is a parse error or stale (Circa ~3%)
OVR_MAX_EXCH = 0.20          # illiquid exchange quotes can be wide; still bounded
OUTLIER_LOGIT = 0.60         # drop a book whose no-vig logit is this far from the cross-book median
LOW_TRUST = {'covers'}       # columns can carry other markets or stale lines: tighter band, no best price
OUTLIER_LOGIT_LOW = 0.25     # band for low-trust sources around the trusted books' median
ARB_MIN = -0.002             # best-price overround below this is flagged as an arbitrage (stale line?)


def canon_book(name):
    k = re.sub(r'\s+', ' ', str(name or '').strip()).lower()
    return BOOK_ALIASES.get(k, str(name).strip())


def book_class(book):
    if book in EXCHANGE:
        return 'exchange'
    if book in SHARP:
        return 'sharp'
    return 'retail'


# ----------------------------------------------------------------------------------------------
# odds math
# ----------------------------------------------------------------------------------------------

def parse_am(s):
    if s is None:
        return None
    if isinstance(s, (int, float)):
        v = int(s)
        return v if abs(v) >= 100 else None
    s = htmlmod.unescape(str(s)).strip().replace('−', '-').replace('–', '-')
    if s.upper() in ('EV', 'EVEN'):
        return 100
    m = re.fullmatch(r'([+-]?\d+)', s)
    if not m:
        return None
    v = int(m.group(1))
    return v if abs(v) >= 100 else None


def am_to_dec(a):
    if a is None:
        return None
    a = float(a)
    if -100 < a < 100:
        return None
    return 1 + a / 100.0 if a > 0 else 1 + 100.0 / abs(a)


def dec_to_am(d):
    if d is None or d <= 1:
        return None
    return int(round((d - 1) * 100)) if d >= 2 else int(round(-100 / (d - 1)))


def logit(p):
    p = min(max(p, 1e-6), 1 - 1e-6)
    return math.log(p / (1 - p))


def sigmoid(x):
    return 1 / (1 + math.exp(-x))


def _bisect(f, lo, hi, target=1.0, n=80):
    """f decreasing on [lo, hi]; returns x with f(x) ~ target."""
    for _ in range(n):
        mid = (lo + hi) / 2
        if f(mid) > target:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def devig_n(q, method):
    """Implied probabilities q (list, sum S >= ~1) -> no-vig probabilities summing to 1.

    mult  : p_i = q_i / S (proportional / multiplicative)
    shin  : Shin (1993) insider model, z solved so that sum p_i = 1 (Jullien & Salanie 1994 form):
            p_i = (sqrt(z^2 + 4 (1 - z) q_i^2 / S) - z) / (2 (1 - z))
    power : p_i = q_i^k with k solved so that sum p_i = 1
    Returns (p list, parameter) where parameter is S - 1 (mult), z (shin) or k (power).
    """
    S = sum(q)
    if method == 'mult' or S <= 1.0:
        return [x / S for x in q], S - 1
    if method == 'shin':
        def pi(qi, z):
            return (math.sqrt(z * z + 4 * (1 - z) * qi * qi / S) - z) / (2 * (1 - z))
        z = _bisect(lambda z: sum(pi(x, z) for x in q), 0.0, 0.999)
        p = [pi(x, z) for x in q]
        s = sum(p)
        return [x / s for x in p], z
    if method == 'power':
        if any(x >= 1 for x in q):
            return [x / S for x in q], 1.0
        k = _bisect(lambda k: sum(x ** k for x in q), 1.0, 50.0)
        p = [x ** k for x in q]
        s = sum(p)
        return [x / s for x in p], k
    raise ValueError(method)


def line_stats(aA, aB):
    """American pair (A, B) -> implied, overround and no-vig P(A) by mult / shin / power."""
    dA, dB = am_to_dec(aA), am_to_dec(aB)
    if not dA or not dB:
        return None
    q = [1 / dA, 1 / dB]
    out = {'ovr': round(sum(q) - 1, 5)}
    for m in ('mult', 'shin', 'power'):
        p, par = devig_n(q, m)
        out['p_' + m] = round(p[0], 5)
        if m == 'shin':
            out['shin_z'] = round(par, 5)
    return out


# ----------------------------------------------------------------------------------------------
# names
# ----------------------------------------------------------------------------------------------

DROP_TOK = {'jr', 'sr', 'ii', 'iii', 'iv', 'de', 'da', 'dos', 'do', 'das', 'del', 'la', 'le', 'e'}


def fold(s):
    s = unicodedata.normalize('NFKD', htmlmod.unescape(str(s or ''))).encode('ascii', 'ignore').decode().lower()
    s = re.sub(r"[\.\'`’]", '', s)
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def norm_name(s):
    return ' '.join(t for t in fold(s).split() if t not in DROP_TOK)


def slugify(s):
    return '-'.join(fold(s).split())


def name_sim(a, b):
    """Similarity in [0, 1], robust to token order, middle names, transliteration and joined tokens."""
    import difflib
    a, b = norm_name(a), norm_name(b)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    ta, tb = a.split(), b.split()
    if sorted(ta) == sorted(tb):
        return 0.98
    if a.replace(' ', '') == b.replace(' ', '') or ''.join(sorted(ta)) == ''.join(sorted(tb)):
        return 0.97
    if len(ta) <= 4 and len(tb) <= 4:   # joined given names in another order: "Ko Seok-hyeon" / "Seokhyeon Ko"
        import itertools
        ja = {''.join(p) for p in itertools.permutations(ta)}
        if any(''.join(p) in ja for p in itertools.permutations(tb)):
            return 0.96
    sa, sb = set(ta), set(tb)
    short, long_ = (sa, sb) if len(sa) <= len(sb) else (sb, sa)
    if len(short) >= 2 and short <= long_:
        return 0.93

    def tok_eq(x, y):
        return x == y or (len(x) > 3 and len(y) > 3 and difflib.SequenceMatcher(None, x, y).ratio() >= 0.8)
    seq = difflib.SequenceMatcher(None, ' '.join(sorted(ta)), ' '.join(sorted(tb))).ratio()
    seq = max(seq, difflib.SequenceMatcher(None, a, b).ratio())
    hits = sum(1 for x in ta if any(tok_eq(x, y) for y in tb))
    cover = hits / max(1, min(len(ta), len(tb)))
    last = any(tok_eq(ta[-1], y) for y in tb) or any(tok_eq(tb[-1], x) for x in ta)
    if cover >= 1:
        return max(seq, 0.9)
    s = max(seq, 0.6 * seq + 0.4 * cover * (1.0 if last else 0.0))
    if last and len(ta[-1]) > 3:
        s = max(s, 0.75)
    return s


def best_sim(names, other):
    """max similarity between any of a fighter's names (str or list of aliases) and another name."""
    if isinstance(names, str):
        names = [names]
    return max((name_sim(n, other) for n in names if n), default=0.0)


def pair_score(a1, a2, b1, b2):
    """(score, swapped) for matching bout (a1 vs a2) to (b1 vs b2) in either orientation.
    a1/a2 may be lists of aliases (card name first)."""
    s_st = (best_sim(a1, b1), best_sim(a2, b2))
    s_sw = (best_sim(a1, b2), best_sim(a2, b1))

    def val(s):
        lo, hi = min(s), max(s)
        if lo >= 0.72:
            return lo + 0.01 * hi
        if hi >= 0.92 and lo >= 0.55:   # one name differs a lot (nickname / short form), other is solid
            return 0.70 + 0.01 * lo
        return 0.0
    v_st, v_sw = val(s_st), val(s_sw)
    return (v_sw, True) if v_sw > v_st else (v_st, False)


# ----------------------------------------------------------------------------------------------
# robots.txt and a polite cached fetcher
# ----------------------------------------------------------------------------------------------

class Robots:
    """Google-style robots.txt (longest match, * and $ wildcards) for user-agent '*'."""

    def __init__(self, text):
        self.rules = []
        groups, cur, in_rules = [], None, False
        for raw in (text or '').splitlines():
            line = raw.split('#', 1)[0].strip()
            if ':' not in line:
                continue
            k, v = [x.strip() for x in line.split(':', 1)]
            k = k.lower()
            if k == 'user-agent':
                if cur is None or in_rules:
                    cur = {'agents': [], 'rules': []}
                    groups.append(cur)
                    in_rules = False
                cur['agents'].append(v.lower())
            elif k in ('allow', 'disallow') and cur is not None:
                in_rules = True
                if v:
                    cur['rules'].append((k == 'allow', v))
        mine = [g for g in groups if any(a.startswith('fightlabsim') for a in g['agents'])]
        star = [g for g in groups if '*' in g['agents']]
        for g in (mine or star):
            self.rules += g['rules']

    @staticmethod
    def _rx(pat):
        end = pat.endswith('$')
        body = re.escape(pat[:-1] if end else pat).replace(r'\*', '.*')
        return re.compile('^' + body + ('$' if end else ''))

    def allowed(self, path):
        best = None
        for allow, pat in self.rules:
            if self._rx(pat).match(path):
                key = (len(pat), allow)
                if best is None or key > best[0]:
                    best = (key, allow)
        return True if best is None else best[1]


class Fetcher:
    def __init__(self, stamp, replay=False, delay=1.25):
        self.stamp = stamp
        self.replay = replay
        self.delay = delay
        self.last = 0.0
        self.n_net = 0
        self.robots = {}
        self.log = []
        self.ctx = (ssl.create_default_context(cafile=CA_BUNDLE) if os.path.exists(CA_BUNDLE)
                    else ssl.create_default_context())

    def path(self, site, name):
        return os.path.join(CACHE_ROOT, site, self.stamp, re.sub(r'[^A-Za-z0-9_.-]+', '_', name) + '.gz')

    def _wait(self):
        w = self.delay + random.random() * 0.25 - (time.time() - self.last)
        if w > 0:
            time.sleep(w)
        self.last = time.time()

    def _robots_ok(self, url):
        u = urllib.parse.urlsplit(url)
        host = u.netloc
        if host not in self.robots:
            txt = ''
            try:
                self._wait()
                req = urllib.request.Request(f'{u.scheme}://{host}/robots.txt', headers={'User-Agent': UA})
                with urllib.request.urlopen(req, timeout=30, context=self.ctx) as r:
                    self.n_net += 1
                    ctype = r.headers.get('Content-Type', '')
                    body = r.read().decode('utf-8', 'replace')
                    # an HTML page served at /robots.txt (SPA fallback) carries no rules
                    txt = '' if ('html' in ctype or body.lstrip().startswith('<')) else body
            except urllib.error.HTTPError as e:
                self.n_net += 1
                txt = '' if 400 <= e.code < 500 else 'User-agent: *\nDisallow: /'   # 4xx = allow, 5xx = deny
            except Exception:
                txt = 'User-agent: *\nDisallow: /'
            self.robots[host] = Robots(txt)
        path = u.path + (('?' + u.query) if u.query else '')
        return self.robots[host].allowed(path or '/')

    def _read_cache(self, fp):
        if os.path.exists(fp):
            with gzip.open(fp, 'rt', encoding='utf-8', errors='replace') as fh:
                return fh.read()
        return None

    def get(self, site, name, url, data=None, headers=None):
        """GET (or POST when data is given). Returns (text, fetched_utc) or (None, None)."""
        fp = self.path(site, name)
        u = urllib.parse.urlsplit(url)
        url = urllib.parse.urlunsplit((u.scheme, u.netloc, urllib.parse.quote(u.path, safe="/:_.-()%,!~*'@"),
                                       u.query, u.fragment))
        if self.replay:
            txt = self._read_cache(fp)
            ts = None
            if txt is not None:
                ts = dt.datetime.fromtimestamp(os.path.getmtime(fp), dt.timezone.utc).isoformat(timespec='seconds')
            return txt, ts
        if not self._robots_ok(url):
            self.log.append(f'robots.txt disallows {url}; skipped')
            return None, None
        hdr = {'User-Agent': UA, 'Accept-Encoding': 'gzip', 'Accept-Language': 'en-US,en;q=0.9',
               'Accept': 'text/html,application/json;q=0.9,*/*;q=0.8'}
        hdr.update(headers or {})
        for attempt in range(3):
            self._wait()
            req = urllib.request.Request(url, data=data, headers=hdr, method='POST' if data else 'GET')
            try:
                with urllib.request.urlopen(req, timeout=60, context=self.ctx) as r:
                    raw = r.read()
                    if r.headers.get('Content-Encoding') == 'gzip':
                        raw = gzip.decompress(raw)
                    txt = raw.decode('utf-8', errors='replace')
                self.n_net += 1
                os.makedirs(os.path.dirname(fp), exist_ok=True)
                with gzip.open(fp, 'wt', encoding='utf-8') as fh:
                    fh.write(txt)
                return txt, dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
            except urllib.error.HTTPError as e:
                self.n_net += 1
                self.log.append(f'HTTP {e.code} on {url}')
                if e.code in (401, 403, 404, 407, 410, 451):
                    return None, None       # blocked or gone: stop politely, no retries
                time.sleep(5 * (attempt + 1))
            except Exception as e:  # network hiccup
                self.log.append(f'error on {url}: {e}')
                time.sleep(5 * (attempt + 1))
        return None, None


# ----------------------------------------------------------------------------------------------
# small parsing helpers
# ----------------------------------------------------------------------------------------------

MONTHS = {m: i for i, m in enumerate(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep',
                                      'oct', 'nov', 'dec'], 1)}


def text_of(x):
    x = re.sub(r'<sup.*?</sup>', '', x, flags=re.S)
    return re.sub(r'\s+', ' ', htmlmod.unescape(re.sub(r'<[^>]+>', ' ', x))).strip()


def parse_month_day(s, year):
    m = re.search(r'([A-Z][a-z]{2})[a-z]*\.? (\d{1,2})', s or '')
    if not m or m.group(1).lower() not in MONTHS:
        return None
    return dt.date(year, MONTHS[m.group(1).lower()], int(m.group(2)))


def parse_long_date(s):
    m = re.search(r'([A-Z][a-z]{2})[a-z]*\.? (\d{1,2}),? (\d{4})', s or '')
    if not m or m.group(1).lower() not in MONTHS:
        return None
    return dt.date(int(m.group(3)), MONTHS[m.group(1).lower()], int(m.group(2)))


# ----------------------------------------------------------------------------------------------
# source: Wikipedia (cards)
# ----------------------------------------------------------------------------------------------

def wiki_events(F, since, until):
    txt, ts = F.get('wikipedia', 'List_of_UFC_events', WIKI + '/wiki/List_of_UFC_events')
    if not txt:
        return [], None
    i = txt.find('id="Scheduled_events"')
    if i < 0:
        return [], ts
    seg = txt[i:]
    seg = seg[:seg.find('</table>')]
    out = []
    for r in re.findall(r'<tr[^>]*>(.*?)</tr>', seg, re.S):
        cells = re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', r, re.S)
        if len(cells) < 4:
            continue
        m = re.search(r'href="(?:https://en\.wikipedia\.org)?(/wiki/[^"#]+)"', cells[0])
        d = parse_long_date(text_of(cells[1]))
        if not m or not d or not (since <= d <= until):
            continue
        out.append({'name': text_of(cells[0]), 'date': d.isoformat(), 'venue': text_of(cells[2]),
                    'location': re.sub(r'\s+,', ',', text_of(cells[3])), 'wiki': WIKI + m.group(1)})
    out.sort(key=lambda e: e['date'])
    return out, ts


def wiki_card(F, ev):
    name = urllib.parse.unquote(ev['wiki'].rsplit('/wiki/', 1)[1])
    txt, ts = F.get('wikipedia', name, ev['wiki'])
    bouts = []
    if not txt:
        return bouts, ts
    seg_name = None
    order = 0
    for t in re.findall(r'<table[^>]*class="[^"]*toccolours[^"]*"[^>]*>(.*?)</table>', txt, re.S):
        for r in re.findall(r'<tr[^>]*>(.*?)</tr>', t, re.S):
            cells = [text_of(c) for c in re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', r, re.S)]
            if len(cells) == 1 and cells[0]:
                seg_name = re.sub(r'\s*\(.*\)$', '', cells[0]).strip()
                continue
            if len(cells) >= 4 and cells[2].lower().startswith('vs') and cells[0] != 'Weight class':
                order += 1
                a = re.sub(r'\s*\((c|ic)\)\s*$', '', cells[1]).strip()
                b = re.sub(r'\s*\((c|ic)\)\s*$', '', cells[3]).strip()
                title = '(c)' in cells[1] or '(c)' in cells[3] or '(ic)' in cells[1] or '(ic)' in cells[3]
                bouts.append({'A': a, 'B': b, 'weight_class': cells[0], 'segment': seg_name, 'order': order,
                              'title_fight': title, 'card_src': 'wikipedia:card'})
    i = txt.find('id="Announced_bouts"')
    if i > 0:
        seg = txt[i:]
        j = re.search(r'<h2|id="See_also"|id="References"', seg[30:])
        seg = seg[:30 + j.start()] if j else seg[:20000]
        for li in re.findall(r'<li[^>]*>(.*?)</li>', seg, re.S):
            s = text_of(li)
            m = re.match(r"(.+?) [Bb]out: (.+?) vs\.? (.+?)$", s)
            if not m:
                continue
            a, b = m.group(2).strip(), re.sub(r'\s*\[.*$', '', m.group(3)).strip()
            if re.fullmatch(r'TB[AD]', b, re.I) or re.fullmatch(r'TB[AD]', a, re.I):
                continue
            if any(pair_score(x['A'], x['B'], a, b)[0] >= 0.8 for x in bouts):
                continue
            order += 1
            bouts.append({'A': a, 'B': b, 'weight_class': m.group(1).strip(), 'segment': 'Announced',
                          'order': order, 'title_fight': False, 'card_src': 'wikipedia:announced'})
    return bouts, ts


# ----------------------------------------------------------------------------------------------
# source: BestFightOdds
# ----------------------------------------------------------------------------------------------

BFO_PROPS = {  # prop type id -> key (team-specific ids get _A/_B appended later)
    1: 'decision', 6: 'draw', 8: 'ko', 9: 'sub', 10: 'itd', 11: 'dec', 13: 'r1', 14: 'r2', 15: 'r3',
    16: 'r4', 17: 'r5', 18: 'udec', 19: 'sdec', 22: 'ends_r1', 23: 'ends_r2', 24: 'ends_r3',
    25: 'ends_r4', 26: 'ends_r5', 32: 'over_1.5', 33: 'over_2.5', 34: 'over_3.5', 35: 'over_4.5',
    187: 'any_ko', 188: 'any_sub',
}


def bfo_event_list(F):
    txt, ts = F.get('bestfightodds', 'home', BFO + '/')
    out = []
    if not txt:
        return out, ts
    year = dt.date.today().year
    for m in re.finditer(r'<div class="table-header"><a href="(/events/([a-z0-9-]+)-(\d+))"><h1>([^<]*)</h1></a>'
                         r'(?:<span class="table-header-date">([^<]*)</span>)?', txt):
        url, slug, eid, title, dtext = m.groups()
        d = None
        if dtext:
            d = parse_month_day(dtext, year)
            if d and (d - dt.date.today()).days < -60:   # header has no year: roll into next year
                d = dt.date(year + 1, d.month, d.day)
        out.append({'url': BFO + url, 'slug': slug, 'event_id': int(eid), 'title': htmlmod.unescape(title),
                    'date': d.isoformat() if d else None})
    return out, ts


def bfo_parse_event(html):
    """-> {title, date, books{id:name}, matchups[{mu, t1_name, t2_name, t1_url, t2_url, lines{book:[a1,a2]},
    props[{pid, team, labels[yes,no], books{book:[yes,no]}}]}]}"""
    title = text_of((re.findall(r'<title>([^<]*)', html) or [''])[0])
    date = parse_long_date(title)
    starts = [x.start() for x in re.finditer(r'<table class="odds-table"', html)]
    if not starts:
        return {'title': title, 'date': date.isoformat() if date else None, 'books': {}, 'matchups': []}
    t = html[starts[-1]:]
    t = t[:t.find('</table>')]
    books = {}
    for bid, name in re.findall(r'<th scope="col" data-b="(\d+)"[^>]*>(?:<a[^>]*>|<span[^>]*>)([^<]+)', t):
        books[int(bid)] = canon_book(htmlmod.unescape(name))
        # BFO's "Polymarket" column is the Polymarket US app (CFTC venue, its own order book; the header's
        # disclosure says so), not the international Polymarket that fightodds and Action Network carry.
        # Verified Nov 6, 2026 against the gamma-api.polymarket.com and Kalshi APIs: fightodds' Polymarket
        # equals the international book's asks; BFO's column does not. Keep them apart.
        if books[int(bid)] == 'Polymarket':
            th = re.search(r'<th scope="col" data-b="' + bid + r'".*?</th>', t, re.S)
            if th and 'Polymarket US' in th.group(0):
                books[int(bid)] = 'PolymarketUS'
    mus, order = {}, []
    props = defaultdict(dict)    # (mu, pid, team) -> {'labels':[..], 'books':{book:[yes,no]}}
    for attrs, row in re.findall(r'<tr([^>]*)>(.*?)</tr>', t, re.S):
        if '<th scope="row"' not in row:
            continue
        if 'class="pr"' in attrs:
            th = text_of(re.search(r'<th[^>]*>(.*?)</th>', row, re.S).group(1))
            for li, val in re.findall(r'data-li="\[([\d,]+)\]"><span[^>]*>([^<]+)</span>', row):
                parts = [int(x) for x in li.split(',')]
                if len(parts) != 5:
                    continue
                bid, side, mu, pid, team = parts
                a = parse_am(val)
                rec = props[(mu, pid, team)]
                rec.setdefault('labels', [None, None])
                if side in (1, 2):
                    rec['labels'][side - 1] = rec['labels'][side - 1] or th
                    if a is not None:
                        rec.setdefault('books', {}).setdefault(books.get(bid, str(bid)), [None, None])[side - 1] = a
            continue
        fm = re.search(r'href="(/fighters/[^"]+)"><span class="t-b-fcc">([^<]+)</span>', row)
        mu_m = re.search(r'data-li="\[(\d),(\d+)\]"', row)
        if not fm or not mu_m:
            continue
        team, mu = int(mu_m.group(1)), int(mu_m.group(2))
        if mu not in mus:
            mus[mu] = {'mu': mu, 'lines': {}}
            order.append(mu)
        rec = mus[mu]
        rec[f't{team}_url'] = fm.group(1)
        rec[f't{team}_name'] = htmlmod.unescape(fm.group(2)).strip()
        for bid, tm, mu2, val in re.findall(r'data-li="\[(\d+),(\d),(\d+)\]"><span[^>]*>([^<]+)</span>', row):
            if int(mu2) != mu:
                continue
            a = parse_am(val)
            if a is None:
                continue
            rec['lines'].setdefault(books.get(int(bid), bid), [None, None])[int(tm) - 1] = a
    for (mu, pid, team), rec in props.items():
        if mu in mus and rec.get('books'):
            mus[mu].setdefault('props', []).append({'pid': pid, 'team': team, 'labels': rec['labels'],
                                                    'books': rec['books']})
    return {'title': title, 'date': date.isoformat() if date else None, 'books': books,
            'matchups': [mus[m] for m in order]}


def previous_snapshot(before=None):
    """Latest snapshot on disk taken before `before` (ISO 'YYYY-MM-DDTHH:MM:SSZ'), or None."""
    ps = sorted(glob.glob(os.path.join(PRED_DIR, 'odds_snapshot_*.json')))
    best = None
    for p in ps:
        try:
            with open(p) as fh:
                s = json.load(fh)
        except (OSError, ValueError):
            continue
        if before and s['meta']['snapshot_utc'] >= before:
            continue
        if best is None or s['meta']['snapshot_utc'] > best['meta']['snapshot_utc']:
            best = s
    return best


def fetch_bfo(F, since, until, prev=None):
    evs, ts_home = bfo_event_list(F)
    # BFO's home page drops an event once it has happened: re-read the pages earlier snapshots used, so a
    # run after the card still finds the archived closing lines
    known = {e['event_id'] for e in evs}
    for e in ((prev or {}).get('meta', {}).get('sources', {}).get('bestfightodds', {}).get('event_pages') or []):
        if e.get('event_id') not in known and e.get('date'):
            evs.append({'url': f"{BFO}/events/{e['slug']}-{e['event_id']}", 'slug': e['slug'],
                        'event_id': e['event_id'], 'title': e.get('title'), 'date': e['date']})
            known.add(e['event_id'])
    picked = [e for e in evs if re.match(r'(noche-)?ufc', e['slug']) and not e['slug'].startswith('ufc-bjj')
              and e['date'] and since - dt.timedelta(days=1) <= dt.date.fromisoformat(e['date'])
              <= until + dt.timedelta(days=1)]
    picked += [e for e in evs if e['slug'].startswith('future-events')]
    out = []
    for e in picked:
        txt, ts = F.get('bestfightodds', f"event_{e['slug']}-{e['event_id']}", e['url'])
        if not txt:
            continue
        p = bfo_parse_event(txt)
        for m in p['matchups']:
            if not m.get('t1_name') or not m.get('t2_name'):
                continue
            out.append({'src': 'bestfightodds', 'src_id': f"{e['event_id']}:{m['mu']}", 'event_title': e['title'],
                        'date': p['date'] or e['date'], 'n1': m['t1_name'], 'n2': m['t2_name'],
                        'lines': {bk: {'ml': v} for bk, v in m['lines'].items()}, 'props': m.get('props', []),
                        'fetched': ts, 'future_page': e['slug'].startswith('future-events'),
                        'url': e['url']})
    return out, {'events': [{k: e[k] for k in ('slug', 'event_id', 'date', 'title')} for e in picked],
                 'home_fetched': ts_home}


# ----------------------------------------------------------------------------------------------
# source: fightodds.io (public GraphQL API used by the site; persisted query texts from its bundle)
# ----------------------------------------------------------------------------------------------

FO_QUERY_NAMES = ['EventsPromotionQuery', 'EventOfferTableQrQuery', 'FightOfferTableRefetchQuery', 'OddsChartQrQuery']


def _js_unescape(t):
    return re.sub(r'\\(n|t|"|\'|\\)', lambda m: {'n': '\n', 't': '\t'}.get(m.group(1), m.group(1)), t)


def fo_queries(F):
    home, _ = F.get('fightodds', 'home', FO_SITE + '/')
    if not home:
        return None
    m = re.search(r'src="(/app\.[a-z0-9]+\.js)"', home)
    if not m:
        return None
    qcache = os.path.join(CACHE_ROOT, 'fightodds', 'queries_' + re.sub(r'[^a-z0-9]', '', m.group(1)) + '.json')
    if os.path.exists(qcache):        # the bundle (6 MB) is fetched once per site deploy, not per run
        with open(qcache) as fh:
            q = json.load(fh)
        if q.get('_names') == FO_QUERY_NAMES:     # parsed with the current query list
            return q
    js, _ = F.get('fightodds', 'bundle', FO_SITE + m.group(1))
    if not js:
        return None
    q = {}
    for name in FO_QUERY_NAMES:
        mm = re.search(r'"(query ' + name + r'\(.*?)"', js, re.S)
        if mm:
            try:
                q[name] = json.loads('"' + mm.group(1) + '"')
            except ValueError:
                pass
        if name not in q:      # some query texts sit in single-quoted JS strings
            mm = re.search(r"text:'(query " + name + r"\(.*?)',metadata", js, re.S)
            if mm:
                q[name] = _js_unescape(mm.group(1))
    if q:
        q['_names'] = FO_QUERY_NAMES
        os.makedirs(os.path.dirname(qcache), exist_ok=True)
        with open(qcache, 'w') as fh:
            json.dump(q, fh)
    return q


def fo_post(F, name, query, variables):
    body = json.dumps({'query': query, 'variables': variables}).encode()
    txt, ts = F.get('fightodds', name, FO_API, data=body, headers={
        'Content-Type': 'application/json', 'Accept': 'application/json',
        'Origin': FO_SITE, 'Referer': FO_SITE + '/'})
    if not txt:
        return None, ts
    try:
        d = json.loads(txt)
    except ValueError:
        return None, ts
    if d.get('errors'):
        F.log.append(f'fightodds {name}: {d["errors"]}')
    return d.get('data'), ts


def fo_history(F, q, slug, book, oids):
    """Timestamped line history of one book on one fight (both sides merged): [[t, a1, a2], ...]."""
    if not q.get('OddsChartQrQuery') and not F.replay:
        return None
    ser = []
    for side, oid in enumerate(oids):
        if not oid:
            return None
        d, _ = fo_post(F, f'hist_{slug}_{book}_{side + 1}', q.get('OddsChartQrQuery', ''), {'outcomeId': oid})
        if not d or not d.get('odds'):
            return None
        for e in d['odds']['edges']:
            n = e['node']
            a = parse_am(n.get('odds'))
            t = _iso(n.get('timestamp'))
            if a and t:
                ser.append((t, side, a))
    ser.sort(key=lambda x: x[0])
    out, cur, i = [], [None, None], 0
    while i < len(ser):       # updates of both sides within 2 minutes are one book move
        t0 = ser[i][0]
        while i < len(ser) and (ser[i][0] - t0).total_seconds() <= 120:
            cur[ser[i][1]] = ser[i][2]
            i += 1
        if cur[0] and cur[1] and (not out or out[-1][1:] != cur):
            out.append([zstr(t0), cur[0], cur[1]])
    return out


def fetch_fightodds(F, since, until, detail=True, history=()):
    q = {} if F.replay else fo_queries(F)
    if F.replay:   # query texts are only needed to post; replay reads cached answers by name
        q = {n: '' for n in FO_QUERY_NAMES}
    if not q or 'EventOfferTableQrQuery' not in q:
        return [], {'error': 'could not read the site bundle / query texts'}
    data, ts = fo_post(F, 'events', q.get('EventsPromotionQuery', ''),
                       {'promotionSlug': 'ufc', 'dateGte': since.isoformat(), 'first': 20, 'orderBy': 'date'})
    if not data:
        return [], {'error': 'events query failed'}
    events = []
    for e in data['promotion']['events']['edges']:
        n = e['node']
        if n.get('date') and since <= dt.date.fromisoformat(n['date']) <= until:
            events.append({k: n.get(k) for k in ('pk', 'name', 'slug', 'date', 'venue', 'city')})
    out = []
    for ev in events:
        d, ts = fo_post(F, f"event_{ev['pk']}", q['EventOfferTableQrQuery'], {'eventPk': ev['pk'], 'isCancelled': False})
        if not d or not d.get('eventOfferTable'):
            continue
        for e in d['eventOfferTable']['fightOffers']['edges']:
            n = e['node']
            if n.get('isCancelled'):
                continue
            f1, f2 = n['fighter1'], n['fighter2']
            lines = {}
            for o in n['straightOffers']['edges']:
                o = o['node']
                o1, o2 = o.get('outcome1') or {}, o.get('outcome2') or {}
                a1, a2 = parse_am(o1.get('odds')), parse_am(o2.get('odds'))
                if a1 and a2:
                    lines[canon_book(o['sportsbook']['shortName'])] = {'ml': [a1, a2]}
            rec = {'src': 'fightodds', 'src_id': n['slug'], 'event_title': ev['name'], 'date': ev['date'],
                   'n1': f'{f1["firstName"]} {f1["lastName"]}'.strip(),
                   'n2': f'{f2["firstName"]} {f2["lastName"]}'.strip(),
                   'lines': lines, 'fetched': ts, 'url': f"{FO_SITE}/fights/{n['slug']}/odds"}
            if detail and lines:
                dd, ts2 = fo_post(F, f"fight_{n['slug']}", q.get('FightOfferTableRefetchQuery', ''),
                                  {'fightSlug': n['slug']})
                fot = (dd or {}).get('fightOfferTable')
                if fot:
                    lines2 = {}
                    for o in fot['straightOffers']['edges']:
                        o = o['node']
                        o1, o2 = o.get('outcome1') or {}, o.get('outcome2') or {}
                        a1, a2 = parse_am(o1.get('odds')), parse_am(o2.get('odds'))
                        if not (a1 and a2):
                            continue
                        x = {'ml': [a1, a2], 'oid': [o1.get('id'), o2.get('id')]}
                        op = [parse_am(o1.get('oddsOpen')), parse_am(o2.get('oddsOpen'))]
                        if op[0] and op[1]:
                            x['open'] = op
                        bw = [[parse_am(o1.get('oddsBest')), parse_am(o1.get('oddsWorst'))],
                              [parse_am(o2.get('oddsBest')), parse_am(o2.get('oddsWorst'))]]
                        if all(v for pr in bw for v in pr):
                            x['best_worst'] = bw
                        lines2[canon_book(o['sportsbook']['shortName'])] = x
                    if lines2:
                        rec['lines'] = lines2
                        rec['fetched'] = ts2
                    hist = {}
                    for bk in history:
                        if bk in lines2:
                            h = fo_history(F, q, n['slug'], bk, lines2[bk]['oid'])
                            if h:
                                hist[bk] = h
                    if hist:
                        rec['history'] = hist
            out.append(rec)
    return out, {'events': events}


# ----------------------------------------------------------------------------------------------
# source: Action Network (next card only)
# ----------------------------------------------------------------------------------------------

def fetch_actionnetwork(F):
    txt, ts = F.get('actionnetwork', 'ufc_odds', AN_URL)
    if not txt:
        return [], {'error': 'no page'}
    m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', txt, re.S)
    if not m:
        return [], {'error': 'no __NEXT_DATA__'}
    pp = json.loads(m.group(1))['props']['pageProps']
    books = pp.get('allBooks', {})
    out = []
    for c in (pp.get('scoreboardResponse') or {}).get('competitions', []):
        comp = c.get('competitors') or []
        if len(comp) != 2:
            continue
        by_c = {x['id']: i for i, x in enumerate(comp)}
        by_p = {x.get('player_id'): i for i, x in enumerate(comp)}
        lines, an_open, an_cons = {}, None, None
        for bid, mk in (c.get('markets') or {}).items():
            ml = (mk.get('event') or {}).get('moneyline') or []
            if len(ml) != 2:
                continue
            pair = [None, None]
            for o in ml:
                i = by_c.get(o.get('competitor_id'), by_p.get(o.get('player_id')))
                if i is not None:
                    pair[i] = parse_am(o.get('odds'))
            if not (pair[0] and pair[1]):
                continue
            nm = (books.get(str(bid)) or {}).get('display_name') or str(bid)
            if nm == 'Open':
                an_open = pair
            elif nm == 'Consensus':
                an_cons = pair
            else:
                lines[canon_book(nm)] = {'ml': pair}
        meta = c.get('meta') or {}
        out.append({'src': 'actionnetwork', 'src_id': str(c.get('id')), 'event_title': meta.get('title'),
                    'date': (c.get('start_time') or '')[:10], 'start_utc': c.get('start_time'),
                    'status': c.get('status'), 'weight_class': meta.get('type_display_text'),
                    'n1': comp[0]['player']['full_name'], 'n2': comp[1]['player']['full_name'],
                    'lines': lines, 'an_open': an_open, 'an_consensus': an_cons, 'fetched': ts, 'url': AN_URL})
    return out, {}


# ----------------------------------------------------------------------------------------------
# source: Covers (OddsShark redirect target); low trust
# ----------------------------------------------------------------------------------------------

def fetch_covers(F):
    txt, ts = F.get('covers', 'ufc_odds', COVERS_URL)
    if not txt:
        return [], {'error': 'no page'}
    out = []
    for card in txt.split('covers-CoversMatchups-mma-fightCard')[1:]:
        tm = re.search(r'<h2>([^<]*)</h2>', card)
        title = text_of(tm.group(1)) if tm else ''
        ym = re.search(r'(20\d\d)\s*$', title)
        year = int(ym.group(1)) if ym else dt.date.today().year
        dm = re.search(r'(Mon|Tue|Wed|Thu|Fri|Sat|Sun), ([A-Z][a-z]{2}) (\d{1,2})', card)
        d = parse_month_day(f'{dm.group(2)} {dm.group(3)}', year) if dm else None
        t = card[card.find('<table class="covers-mma-table"'):]
        t = t[:t.find('</table>')]
        head = re.search(r'<tr>(.*?)</tr>', t, re.S)
        if not head:
            continue
        cols = []
        for th in re.findall(r'<th[^>]*>(.*?)</th>', head.group(1), re.S):
            sl = re.search(r'slug=([a-z0-9-]+)', th)
            cols.append(sl.group(1) if sl else text_of(th))
        pairs = []
        for chunk in re.split(r'<tr style="height: ?20px;?"[^>]*>\s*</tr>', t)[1:]:   # one bout per spacer
            rows = []
            for r in re.findall(r'<tr class="[^"]*">(.*?)</tr>', chunk, re.S):
                th = re.search(r'<th[^>]*>.*?<span>(.*?)</span>', r, re.S)
                if th:
                    rows.append((text_of(th.group(1)), [text_of(x) for x in re.findall(r'<td[^>]*>(.*?)</td>', r, re.S)]))
            if len(rows) == 2:
                pairs.append(rows)
        for k, ((n1, c1), (n2, c2)) in enumerate(pairs):
            lines = {}
            for j, col in enumerate(cols[1:]):       # cols[0] = Fighters (the row's <th>); tds[0] = Open
                if col in ('Open', 'Fighters'):
                    continue
                a1 = parse_am(c1[j]) if j < len(c1) else None
                a2 = parse_am(c2[j]) if j < len(c2) else None
                if a1 and a2:
                    lines[canon_book(col)] = {'ml': [a1, a2]}
            out.append({'src': 'covers', 'src_id': f'{slugify(title)}:{k}', 'event_title': title,
                        'date': d.isoformat() if d else None, 'n1': n1, 'n2': n2, 'lines': lines,
                        'fetched': ts, 'url': COVERS_URL})
    return out, {}


# ----------------------------------------------------------------------------------------------
# bout universe
# ----------------------------------------------------------------------------------------------

def load_cards_upcoming():
    """Flexible reader for data/predictions/cards_upcoming.json -> (events, bouts) or (None, None)."""
    if not os.path.exists(CARDS_JSON):
        return None, None
    try:
        with open(CARDS_JSON) as fh:
            d = json.load(fh)
    except (OSError, ValueError):
        return None, None

    def nm(x):
        if isinstance(x, dict):
            return x.get('name') or x.get('full_name') or x.get('fighter')
        return x if isinstance(x, str) else None

    def pair_of(b):
        for ka, kb in (('A', 'B'), ('a', 'b'), ('fighter_a', 'fighter_b'), ('fighter1', 'fighter2'),
                       ('f1', 'f2'), ('red', 'blue'), ('A_name', 'B_name'), ('fighter_1', 'fighter_2')):
            if ka in b and kb in b and nm(b[ka]) and nm(b[kb]):
                return b[ka], b[kb]
        fs = b.get('fighters')
        if isinstance(fs, list) and len(fs) == 2 and nm(fs[0]) and nm(fs[1]):
            return fs[0], fs[1]
        return None

    evs = d.get('events') if isinstance(d, dict) else d
    if isinstance(d, dict) and not evs and isinstance(d.get('cards'), list):
        evs = d['cards']
    if not isinstance(evs, list):
        return None, None
    events, bouts = [], []
    for e in evs:
        if not isinstance(e, dict):
            continue
        date = str(e.get('date') or e.get('event_date') or '')[:10]
        ev = {'name': e.get('name') or e.get('event') or e.get('title'), 'date': date,
              'venue': e.get('venue'), 'location': e.get('location') or e.get('city'),
              'wiki': e.get('wiki') or e.get('url'), 'alt_names': e.get('alt_names') or [],
              'start_utc': e.get('start_utc') if isinstance(e.get('start_utc'), dict) else None,
              'event_status': e.get('event_status')}
        rem = []
        for r in e.get('removed') or []:
            p = pair_of(r) if isinstance(r, dict) else None
            if p:
                rem.append({'A': nm(p[0]), 'B': nm(p[1]), 'reason': r.get('reason'), 'date': r.get('date')})
        ev['removed'] = rem
        events.append(ev)
        for i, b in enumerate(e.get('bouts') or e.get('fights') or []):
            p = pair_of(b) if isinstance(b, dict) else None
            if not p:
                continue
            A, B = p

            def alts(x):
                return [nm(x)] + [n for n in (x.get('alt_names') or []) if n] if isinstance(x, dict) else [nm(x)]
            bouts.append({'event': ev['name'], 'date': date, 'A': nm(A), 'B': nm(B),
                          'A_alts': alts(A), 'B_alts': alts(B),
                          'rounds': b.get('rounds'), 'status': b.get('status'), 'belt': b.get('belt'),
                          'A_slug': A.get('slug') if isinstance(A, dict) else b.get('A_slug'),
                          'B_slug': B.get('slug') if isinstance(B, dict) else b.get('B_slug'),
                          'weight_class': b.get('weight_class') or b.get('division'),
                          'segment': b.get('segment') or b.get('card'), 'order': b.get('order', i + 1),
                          'title_fight': bool(b.get('title_fight') or b.get('title') is True),
                          'bout_id': b.get('id') or b.get('bout_id'), 'card_src': 'cards_upcoming.json'})
    global CARD_AS_OF
    CARD_AS_OF = d.get('as_of') if isinstance(d, dict) else None
    return (events, bouts) if bouts else (None, None)


CARD_AS_OF = None


class FighterIndex:
    def __init__(self):
        self.rows = []
        try:
            with open(FIGHTERS_JSON) as fh:
                fs = json.load(fh)['fighters']
            for slug, f in fs.items():
                self.rows.append((slug, f.get('name') or slug, f.get('id'), f.get('division'), f.get('last_fight')))
        except (OSError, ValueError, KeyError):
            pass
        self.by_last = defaultdict(list)
        for r in self.rows:
            toks = norm_name(r[1]).split()
            if toks:
                self.by_last[toks[-1]].append(r)
                self.by_last[toks[0]].append(r)

    def find(self, name, weight_class=None):
        toks = norm_name(name).split()
        if not toks or not self.rows:
            return None
        cands = {}
        for t in set(toks):
            for r in self.by_last.get(t, []):
                cands[r[0]] = r
        best = None
        for r in cands.values():
            s = name_sim(name, r[1])
            if weight_class and r[3] and fold(r[3]) == fold(weight_class):
                s += 0.02
            if best is None or s > best[0]:
                best = (s, r)
        if best and best[0] >= 0.9:
            s, r = best
            return {'slug': r[0], 'ufcstats_id': r[2], 'db_name': r[1], 'match': round(min(s, 1.0), 3)}
        return None


def norm_wc(s):
    s = fold(s or '').replace('womens', 'women s').replace('lightheavyweight', 'light heavyweight')
    return s.title().replace('Women S', "Women's") if s else None


def event_start_estimate(ev):
    """Conservative (early) start of the first bout in UTC when no per-bout time is known."""
    d = dt.date.fromisoformat(ev['date'])
    loc = fold(ev.get('location') or '') + ' ' + fold(ev.get('venue') or '')
    if re.search(r'australia|sydney|perth|melbourne|japan|tokyo|china|shanghai|macau|singapore|korea|seoul|'
                 r'new zealand|auckland|philippines|manila', loc):
        return dt.datetime.combine(d - dt.timedelta(days=1), dt.time(22, 0), dt.timezone.utc)
    if re.search(r'abu dhabi|uae|qatar|doha|rayyan|saudi|riyadh|jeddah|kuwait|baku|azerbaijan|bahrain', loc):
        return dt.datetime.combine(d, dt.time(12, 0), dt.timezone.utc)
    if re.search(r'england|london|manchester|uk|france|paris|germany|hamburg|spain|madrid|poland|'
                 r'netherlands|sweden|stockholm|czech|prague|italy|ireland|dublin|scotland', loc):
        return dt.datetime.combine(d, dt.time(15, 0), dt.timezone.utc)
    if re.search(r'u s|united states|nevada|las vegas|new york|texas|california|florida|canada|mexico|'
                 r'brazil|rio|sao paulo|nashville|newark|apex', loc):
        return dt.datetime.combine(d, dt.time(20, 0), dt.timezone.utc)
    return dt.datetime.combine(d, dt.time(0, 0), dt.timezone.utc)


def build_universe(wiki_evs, wiki_cards, cards_file, src_bouts, fo_events, since, until):
    """Canonical events and bouts. Returns (events, bouts, card_source)."""
    if cards_file[0]:
        events, bouts = cards_file
        card_source = 'data/predictions/cards_upcoming.json'
        events = [e for e in events if e.get('date') and since <= dt.date.fromisoformat(e['date']) <= until]
        keep = {e['date'] for e in events}
        bouts = [b for b in bouts if b['date'] in keep]
    else:
        card_source = 'gathered: Wikipedia event pages + bouts listed by the odds sites'
        events = [dict(e) for e in wiki_evs]
        bouts = []
        for e in events:
            for b in wiki_cards.get(e['wiki'], []):
                bouts.append(dict(b, event=e['name'], date=e['date']))
        # events known to fightodds but missing on Wikipedia
        for fe in fo_events:
            if not any(abs((dt.date.fromisoformat(e['date']) - dt.date.fromisoformat(fe['date'])).days) <= 1
                       for e in events):
                events.append({'name': fe['name'], 'date': fe['date'], 'venue': fe.get('venue'),
                               'location': fe.get('city'), 'wiki': None})
        events.sort(key=lambda e: e['date'])
    for e in events:
        fe = [x for x in fo_events if abs((dt.date.fromisoformat(x['date']) -
                                           dt.date.fromisoformat(e['date'])).days) <= 1]
        if fe:
            e['fightodds_pk'] = fe[0]['pk']
            e.setdefault('location', fe[0].get('city'))
            if not e.get('location'):
                e['location'] = fe[0].get('city')
    for b in bouts:
        b['weight_class'] = norm_wc(b.get('weight_class'))
    return events, bouts, card_source


def event_for_date(events, d, lo=-1, hi=2):
    """Canonical event whose date is within [lo, hi] days of source date d (BFO/AN use UTC dates)."""
    if not d:
        return None
    d = dt.date.fromisoformat(d)
    best = None
    for e in events:
        g = (d - dt.date.fromisoformat(e['date'])).days
        if lo <= g <= hi and (best is None or abs(g) < best[0]):
            best = (abs(g), e)
    return best[1] if best else None


def events_near_date(events, d, lo=-1, hi=2):
    """Dates of every canonical event within [lo, hi] days of source date d. All of them are candidates:
    BFO splits a card into pages by UTC date, so a main-card page can sit one day after its event and on
    the day of a following event; the name match, not the nearest date, decides."""
    if not d:
        return set()
    d = dt.date.fromisoformat(d)
    return {e['date'] for e in events if lo <= (d - dt.date.fromisoformat(e['date'])).days <= hi}


def match_sources(events, bouts, src_bouts, add_missing):
    """Attach source bouts to canonical bouts (one source bout per canonical bout per source; the best
    match wins, other claimants are kept as duplicates). Unmatched in-window source bouts are added as
    new canonical bouts when add_missing (no cards file), else reported.
    A listing that matches one of the event's removed pairings (cards_upcoming.json `removed`) at least as
    well as the current bout is a stale listing of the old pairing (e.g. 'X vs old opponent' with a
    similar surname) and is never attached to the current bout."""
    for b in bouts:
        b.setdefault('src', {})
        b.setdefault('dups', [])
    removed_by_date = {e['date']: e.get('removed') or [] for e in events}
    unmatched = []
    for src in SRC_PRIORITY:
        cands = []
        for i, sb in enumerate([x for x in src_bouts if x['src'] == src]):
            near = events_near_date(events, sb.get('date')) if not sb.get('future_page') else None
            for j, b in enumerate(bouts):
                if near is not None and b['date'] not in near:
                    continue
                s, sw = pair_score(b.get('A_alts') or b['A'], b.get('B_alts') or b['B'], sb['n1'], sb['n2'])
                need = 0.9 if sb.get('future_page') else 0.6
                if s >= need and any(pair_score(r['A'], r['B'], sb['n1'], sb['n2'])[0] >= s
                                     for r in removed_by_date.get(b['date'], [])):
                    continue
                if s >= need:
                    nl = len(sb.get('lines') or {})
                    cands.append((s, nl, j, id(sb), sw, sb))
        cands.sort(key=lambda x: (-x[0], -x[1]))
        taken_sb = set()
        for s, nl, j, sid, sw, sb in cands:
            if sid in taken_sb:
                continue
            b = bouts[j]
            cur = b['src'].get(src)
            if cur is None:
                b['src'][src] = dict(sb, swapped=sw, match=round(s, 3))
                taken_sb.add(sid)
            else:
                # a second listing of the same bout on this source (BFO keeps stale duplicates):
                # keep the listing with more books; the other is recorded, not used
                if nl > len(cur.get('lines') or {}) and not sb.get('future_page'):
                    b['dups'].append({k: cur[k] for k in ('src', 'src_id', 'n1', 'n2')})
                    b['src'][src] = dict(sb, swapped=sw, match=round(s, 3))
                else:
                    b['dups'].append({k: sb[k] for k in ('src', 'src_id', 'n1', 'n2')})
                taken_sb.add(sid)
        for sb in [x for x in src_bouts if x['src'] == src]:
            if id(sb) in taken_sb or sb.get('future_page'):
                continue
            near = events_near_date(events, sb.get('date'))
            ev = None
            for e in events:   # report against the event whose removed list explains it, else the nearest
                if e['date'] in near and any(pair_score(r['A'], r['B'], sb['n1'], sb['n2'])[0] >= 0.7
                                             for r in e.get('removed') or []):
                    ev = e
                    break
            ev = ev or event_for_date(events, sb.get('date'))
            if ev is None:
                continue
            if add_missing and sb.get('lines'):
                nb = {'event': ev['name'], 'date': ev['date'], 'A': sb['n1'], 'B': sb['n2'],
                      'weight_class': norm_wc(sb.get('weight_class')), 'segment': None, 'order': 99,
                      'title_fight': False, 'card_src': f'odds-site:{src}', 'src': {}, 'dups': []}
                nb['src'][src] = dict(sb, swapped=False, match=1.0)
                bouts.append(nb)
            else:
                u = {k: sb.get(k) for k in ('src', 'src_id', 'event_title', 'date', 'n1', 'n2')}
                u['n_books'] = len(sb.get('lines') or {})
                for r in ev.get('removed') or []:
                    if pair_score(r['A'], r['B'], sb['n1'], sb['n2'])[0] >= 0.7:
                        u['note'] = f"removed per cards_upcoming.json: {r.get('reason') or ''}".strip()
                        break
                else:
                    u['note'] = 'not on the card file: new bout or a site-side stale listing; check before predicting'
                unmatched.append(u)
    return unmatched


# ----------------------------------------------------------------------------------------------
# per-bout assembly: lines, consensus, open, props
# ----------------------------------------------------------------------------------------------

def orient(pair, swapped):
    if pair is None:
        return None
    return [pair[1], pair[0]] if swapped else [pair[0], pair[1]]


def lmean(ps):
    return sigmoid(sum(logit(p) for p in ps) / len(ps)) if ps else None


def trimmed_lmean(ps):
    if len(ps) >= 5:
        ps = sorted(ps)[1:-1]
    return lmean(ps)


def median(xs):
    xs = sorted(xs)
    n = len(xs)
    if not n:
        return None
    return xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2


def r4(x):
    return None if x is None else round(x, 4)


def assemble_lines(b):
    """All observations (one per source x book), oriented to (A, B), with sanity flags."""
    obs = []
    for src, sb in b['src'].items():
        sw = sb['swapped']
        for book, x in (sb.get('lines') or {}).items():
            ml = orient(x.get('ml'), sw)
            st = line_stats(*ml) if ml else None
            if not st:
                continue
            cls = book_class(book)
            o = {'src': src, 'book': book, 'class': cls, 'ml': ml, 't': sb.get('fetched'), **st}
            if x.get('open'):
                o['open'] = orient(x['open'], sw)
            if x.get('best_worst'):
                o['best_worst'] = orient(x['best_worst'], sw)
            lo, hi = (OVR_MIN, OVR_MAX_EXCH) if cls == 'exchange' else (OVR_MIN_BOOK, OVR_MAX)
            if not (lo <= st['ovr'] <= hi):
                o['ok'] = False
                o['flag'] = f"overround {st['ovr']:+.3f} outside [{lo}, {hi}]"
            else:
                o['ok'] = True
            obs.append(o)
    # cross-book outlier check on the sane lines (median over unique books)
    med = median([o['p_mult'] for o in obs if o['ok']])
    if med is not None and len({o['book'] for o in obs if o['ok']}) >= 4:
        for o in obs:
            if o['ok'] and abs(logit(o['p_mult']) - logit(med)) > OUTLIER_LOGIT:
                o['ok'] = False
                o['flag'] = f"outlier: no-vig {o['p_mult']:.3f} vs cross-book median {med:.3f}"
    # low-trust sources must sit close to the trusted sources' median (or are dropped when none exist)
    tmed = median([o['p_mult'] for o in obs if o['ok'] and o['src'] not in LOW_TRUST])
    for o in obs:
        if o['ok'] and o['src'] in LOW_TRUST:
            if tmed is None:
                o['ok'] = False
                o['flag'] = 'low-trust source with no trusted line to check against'
            elif abs(logit(o['p_mult']) - logit(tmed)) > OUTLIER_LOGIT_LOW:
                o['ok'] = False
                o['flag'] = f"low-trust outlier: no-vig {o['p_mult']:.3f} vs trusted median {tmed:.3f}"
    return obs


def choose_books(obs):
    """One line per book: the preferred source among sane observations. Flags cross-source disagreement."""
    by = defaultdict(list)
    for o in obs:
        if o['ok']:
            by[o['book']].append(o)
    books = {}
    for bk, lst in by.items():
        lst.sort(key=lambda o: SRC_PRIORITY.index(o['src']))
        pick = dict(lst[0])
        if len(lst) > 1:
            spread = max(o['p_mult'] for o in lst) - min(o['p_mult'] for o in lst)
            pick['n_src'] = len(lst)
            if spread > 0.03:
                pick['src_disagree'] = round(spread, 4)
        books[bk] = pick
    return books


def consensus(books):
    sb = {k: v for k, v in books.items() if v['class'] != 'exchange'}
    ex = {k: v for k, v in books.items() if v['class'] == 'exchange'}
    sh = {k: v for k, v in books.items() if v['class'] == 'sharp'}
    out = {'n_books': len(sb), 'n_sharp': len(sh), 'n_exchange': len(ex)}
    if sb:
        for m in ('mult', 'shin', 'power'):
            ps = [v['p_' + m] for v in sb.values()]
            out[f'p_{m}_lmean'] = r4(trimmed_lmean(ps))
            out[f'p_{m}_median'] = r4(median(ps))
        # BFO-style: mean of the books' decimal odds per side, then devig (= market.json close estimator)
        dA = sum(am_to_dec(v['ml'][0]) for v in sb.values()) / len(sb)
        dB = sum(am_to_dec(v['ml'][1]) for v in sb.values()) / len(sb)
        for m in ('mult', 'shin', 'power'):
            out[f'p_meandec_{m}'] = r4(devig_n([1 / dA, 1 / dB], m)[0][0])
        ps = [v['p_shin'] for v in sb.values()]
        mu = sum(ps) / len(ps)
        out['sd_books'] = r4(math.sqrt(sum((p - mu) ** 2 for p in ps) / len(ps)))
        out['range_books'] = [r4(min(ps)), r4(max(ps))]
        out['mean_overround'] = r4(sum(v['ovr'] for v in sb.values()) / len(sb))
        tr = {k: v for k, v in sb.items() if v['src'] not in LOW_TRUST} or sb
        bA = max(tr.values(), key=lambda v: am_to_dec(v['ml'][0]))
        bB = max(tr.values(), key=lambda v: am_to_dec(v['ml'][1]))
        out['best'] = {'A': [bA['ml'][0], bA['book']], 'B': [bB['ml'][1], bB['book']]}
        ovr_best = 1 / am_to_dec(bA['ml'][0]) + 1 / am_to_dec(bB['ml'][1]) - 1
        out['best_overround'] = round(ovr_best, 5)
        out['arb'] = ovr_best < ARB_MIN
        out['p_consensus'] = out['p_shin_lmean']
    if sh:
        out['p_sharp_shin'] = r4(lmean([v['p_shin'] for v in sh.values()]))
        out['sharp_books'] = sorted(sh)
    if 'Pinnacle' in books:
        out['p_pinnacle_shin'] = books['Pinnacle']['p_shin']
    if ex:
        out['p_exchange_mult'] = r4(lmean([v['p_mult'] for v in ex.values()]))
        out['exchanges'] = sorted(ex)
    return out


def opening(obs, b):
    """Market open: fightodds per-book openers (sportsbooks, sane) and Action Network's opener."""
    out = {}
    per = {}
    for o in obs:
        if o['src'] != 'fightodds' or 'open' not in o or o['class'] == 'exchange':
            continue
        st = line_stats(*o['open'])
        if st and OVR_MIN <= st['ovr'] <= OVR_MAX:
            per[o['book']] = {'ml': o['open'], 'p_shin': st['p_shin'], 'p_mult': st['p_mult']}
    if per:
        med = median([v['p_mult'] for v in per.values()])
        per = {k: v for k, v in per.items() if abs(logit(v['p_mult']) - logit(med)) <= 1.0}
    if per:
        out['books'] = {k: v['ml'] for k, v in sorted(per.items())}
        out['n_books'] = len(per)
        out['p_shin_lmean'] = r4(trimmed_lmean([v['p_shin'] for v in per.values()]))
        out['p_mult_lmean'] = r4(trimmed_lmean([v['p_mult'] for v in per.values()]))
        out['p_open'] = out['p_shin_lmean']
    an = b['src'].get('actionnetwork')
    if an and an.get('an_open'):
        op = orient(an['an_open'], an['swapped'])
        st = line_stats(*op)
        if st and OVR_MIN <= st['ovr'] <= OVR_MAX:
            out['actionnetwork_open'] = {'ml': op, 'p_shin': st['p_shin']}
    return out


def _devig_pair(yes, no):
    st = line_stats(yes, no)
    if not st or not (OVR_MIN <= st['ovr'] <= 0.30):
        return None
    return st['p_shin'], st['p_mult']


def props_summary(b):
    """BFO props -> raw per-book prices (oriented A/B) and no-vig summaries."""
    sb = b['src'].get('bestfightodds')
    if not sb or not sb.get('props'):
        return None
    sw = sb['swapped']
    raw = {}
    for p in sb['props']:
        key = BFO_PROPS.get(p['pid'])
        if not key:
            continue
        if p['team'] in (1, 2):
            side = 'A' if (p['team'] == 1) != sw else 'B'
            key = f'{key}_{side}'
        raw[key] = {bk: v for bk, v in p['books'].items() if v[0] is not None or v[1] is not None}
    raw = {k: v for k, v in raw.items() if v}
    out = {'raw': raw}
    # two-way props: P(yes) per book (both sides offered), consensus = median of Shin no-vig
    two = {}
    for key in ['decision', 'itd_A', 'itd_B', 'dec_A', 'dec_B', 'over_1.5', 'over_2.5', 'over_3.5', 'over_4.5']:
        per = {}
        for bk, (yes, no) in (raw.get(key) or {}).items():
            if yes and no:
                r = _devig_pair(yes, no)
                if r:
                    per[bk] = r[0]
        if per:
            two[key] = {'p': r4(median(list(per.values()))), 'n': len(per), 'books': {k: r4(v) for k, v in per.items()}}
    if two:
        out['two_way'] = two
    # method-of-victory market: per book, the 6 (or 7 with draw) mutually exclusive outcomes
    keys6 = ['ko_A', 'sub_A', 'dec_A', 'ko_B', 'sub_B', 'dec_B']
    per_book = {}
    bks = set()
    for k in keys6:
        bks |= set(raw.get(k, {}))
    for bk in sorted(bks):
        prices = [(raw.get(k, {}).get(bk) or [None])[0] for k in keys6]
        if not all(prices):
            continue
        q = [1 / am_to_dec(a) for a in prices]
        draw = (raw.get('draw', {}).get(bk) or [None])[0]
        if draw:
            q.append(1 / am_to_dec(draw))
        S = sum(q)
        if not (1.0 <= S <= 1.6):
            continue
        p_sh, z = devig_n(q, 'shin')
        p_mu, _ = devig_n(q, 'mult')
        per_book[bk] = {'ovr': round(S - 1, 4), 'shin': [round(x, 4) for x in p_sh],
                        'mult': [round(x, 4) for x in p_mu], 'has_draw': bool(draw)}
    if per_book:
        med = [median([v['shin'][i] for v in per_book.values()]) for i in range(6)]
        dr = [v['shin'][6] for v in per_book.values() if v['has_draw']]
        d = median(dr) if dr else None
        tot = sum(med) + (d or 0)
        pm = {'a_ko': med[0], 'a_sub': med[1], 'a_dec': med[2], 'b_ko': med[3], 'b_sub': med[4],
              'b_dec': med[5], 'draw': d}
        pm = {k: (r4(v / tot) if v is not None else None) for k, v in pm.items()}
        out['method'] = {
            'p_method': pm,          # ledger keys (data/predictions/README.md), sums to 1
            'p_a_from_method': r4(pm['a_ko'] + pm['a_sub'] + pm['a_dec']),
            'p_decision_from_method': r4(pm['a_dec'] + pm['b_dec']),
            'p_ko': r4(pm['a_ko'] + pm['b_ko']), 'p_sub': r4(pm['a_sub'] + pm['b_sub']),
            'n_books': len(per_book), 'n_books_with_draw': len(dr),
            'order': keys6 + ['draw'], 'books': per_book}
    # goes the distance: two-way prop when offered, else the method market's decision share
    if two.get('decision'):
        out['p_distance'] = two['decision']['p']
        out['p_distance_src'] = f"'Fight goes to decision' two-way prop, median Shin over {two['decision']['n']} books"
    elif out.get('method'):
        out['p_distance'] = out['method']['p_decision_from_method']
        out['p_distance_src'] = 'method market: a_dec + b_dec'
    return out


def ledger_market(b, books, obs):
    """Market block in the forward-test ledger format: BFO mean of the sportsbooks' lines (exchanges out),
    as the ledger README defines the closing benchmark; falls back to all books when BFO has none."""
    bfo = {o['book']: o for o in obs if o['src'] == 'bestfightodds' and o['ok'] and o['class'] != 'exchange'}
    use, src = bfo, 'bestfightodds'
    if not use:
        use = {k: v for k, v in books.items() if v['class'] != 'exchange'}
        src = 'all-books consensus (no BFO lines)'
    if not use:
        return None
    dA = sum(am_to_dec(v['ml'][0]) for v in use.values()) / len(use)
    dB = sum(am_to_dec(v['ml'][1]) for v in use.values()) / len(use)
    ts = sorted({v['t'] for v in use.values() if v.get('t')})
    return {'source': src, 'captured_utc': ts[-1] if ts else None, 'odds_a': dec_to_am(dA), 'odds_b': dec_to_am(dB),
            'p_a_novig': r4(devig_n([1 / dA, 1 / dB], 'mult')[0][0]),
            'p_a_novig_shin': r4(devig_n([1 / dA, 1 / dB], 'shin')[0][0]),
            'n_books': len(use), 'books': sorted(use)}


def _iso(x):
    """'2026-11-07T22:00Z' / '...000Z' -> aware datetime."""
    if not x:
        return None
    x = x.replace('Z', '+00:00')
    if re.search(r'T\d\d:\d\d\+', x):
        x = x.replace('+', ':00+', 1)
    try:
        return dt.datetime.fromisoformat(x)
    except ValueError:
        return None


def zstr(t):
    return t.astimezone(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ') if t else None


def event_lock(ev, an_starts):
    """Earliest start of the event: cards_upcoming.json start_utc, else Action Network, else estimate."""
    st = [t for t in (_iso(v) for v in (ev.get('start_utc') or {}).values()) if t]
    if st:
        return min(st), 'cards_upcoming.json'
    if an_starts:
        return min(an_starts), 'actionnetwork'
    return event_start_estimate(ev), 'estimate'


def build_bouts(bouts, events, fidx, snap_time, have_cards):
    ev_by_date = {e['date']: e for e in events}
    an_by_date = defaultdict(list)
    for b in bouts:
        an = b['src'].get('actionnetwork')
        if an and _iso(an.get('start_utc')):
            an_by_date[b['date']].append(_iso(an['start_utc']))
    for e in events:
        lock, lsrc = event_lock(e, an_by_date.get(e['date']))
        e['lock_utc'], e['lock_src'] = zstr(lock), lsrc
    out = []
    for b in bouts:
        ev = ev_by_date.get(b['date'], {'date': b['date']})
        obs = assemble_lines(b)
        books = choose_books(obs)
        cons = consensus(books)
        op = opening(obs, b)
        an = b['src'].get('actionnetwork')
        an_start = _iso(an.get('start_utc')) if an else None
        seg_start = _iso((ev.get('start_utc') or {}).get(b.get('segment') or ''))
        lock = _iso(ev.get('lock_utc'))
        if seg_start:
            start, start_src = seg_start, f"cards_upcoming.json start_utc.{b.get('segment')}"
        elif an_start:
            start, start_src = an_start, 'actionnetwork (scheduled)'
        else:
            start, start_src = lock, f"event lock ({ev.get('lock_src')})"
        # phase and pre_lock use the LATEST fetch time of this bout's lines, not the run's start: a run takes
        # ~4 minutes, so a line read after the lock must never count as "market at prediction time"
        seen = [t for t in (_iso(x.get('fetched')) for x in b['src'].values()) if t]
        t_obs = max(seen + [snap_time])
        phase = ('pre_start' if t_obs < start else 'post_start') if start else 'unknown'
        rec = {}
        slugs = {}
        for side in ('A', 'B'):
            given = b.get(f'{side}_slug')
            hit = fidx.find(b[side], b.get('weight_class'))
            sl = given if (have_cards or given) else (hit or {}).get('slug')
            slugs[side] = sl
            rec[side] = {'name': b[side], 'slug': sl}
            if hit and hit['slug'] == sl:
                rec[side]['ufcstats_id'] = hit['ufcstats_id']
            elif hit and have_cards and not given and hit['match'] >= 0.95:
                rec[side]['roster_match_suggestion'] = hit['slug']
        bid = f"{b['date']}:{slugs['A'] or slugify(b['A'])}__{slugs['B'] or slugify(b['B'])}"
        rec = {
            'bout_id': bid,
            'event': b.get('event'), 'date': b['date'], 'segment': b.get('segment'), 'order': b.get('order'),
            'weight_class': b.get('weight_class') or norm_wc((an or {}).get('weight_class')),
            'rounds': b.get('rounds'), 'title': bool(b.get('title_fight')), 'status': b.get('status'),
            'card_src': b.get('card_src'),
            'start_utc': zstr(start), 'start_src': start_src, 'start_utc_actionnetwork': zstr(an_start),
            'phase': phase, 'pre_lock': bool(lock and t_obs < lock),
            'A': rec['A'], 'B': rec['B'],
        }
        if b.get('belt'):
            rec['belt'] = b['belt']
        rec['source_names'] = {s: ([x['n2'], x['n1']] if x['swapped'] else [x['n1'], x['n2']])
                               for s, x in b['src'].items()}
        rec['source_ids'] = {s: x['src_id'] for s, x in b['src'].items()}
        rec['fetched_utc'] = {s: x.get('fetched') for s, x in b['src'].items()}
        if b.get('dups'):
            rec['duplicates_ignored'] = b['dups']
        lm = ledger_market(b, books, obs)
        if lm:
            rec['market'] = lm
        rec['consensus'] = cons
        if op:
            rec['open'] = op
        bk_out = {}
        for bk, v in sorted(books.items()):
            e = {'src': v['src'], 'cls': v['class'][0], 'ml': v['ml'], 'p_mult': r4(v['p_mult']),
                 'p_shin': r4(v['p_shin']), 'ovr': r4(v['ovr'])}
            if 'open' in v and v['class'] != 'exchange':
                st = line_stats(*v['open'])
                if st and OVR_MIN <= st['ovr'] <= OVR_MAX:
                    e['open'] = v['open']
            if 'best_worst' in v:
                e['bw'] = v['best_worst']
            if 'src_disagree' in v:
                e['src_disagree'] = v['src_disagree']
            bk_out[bk] = e
        rec['books'] = bk_out
        rej = [{k: o[k] for k in ('src', 'book', 'ml', 'flag')} for o in obs if not o['ok']]
        if rej:
            rec['rejected_lines'] = rej
        alt = [[o['src'], o['book'], o['ml']] for o in obs
               if o['ok'] and books.get(o['book'], {}).get('src') != o['src']]
        if alt:
            rec['other_source_lines'] = alt
        if an and an.get('an_consensus'):
            rec['actionnetwork_consensus'] = orient(an['an_consensus'], an['swapped'])
        fo = b['src'].get('fightodds')
        if fo and fo.get('history'):
            hist = {}
            for bk, ser in fo['history'].items():
                pts = []
                for t, a1, a2 in ser:
                    aA, aB = orient([a1, a2], fo['swapped'])
                    st = line_stats(aA, aB)
                    if st and OVR_MIN <= st['ovr'] <= OVR_MAX:
                        pts.append([t, aA, aB, r4(st['p_shin'])])
                if pts:
                    hist[bk] = pts
            if hist:
                rec['history'] = hist
        pr = props_summary(b)
        if pr:
            rec['props'] = pr
        out.append(rec)
    out.sort(key=lambda r: (r['date'], r['order'] if isinstance(r['order'], int) else 99))
    return out


# ----------------------------------------------------------------------------------------------
# snapshot
# ----------------------------------------------------------------------------------------------

def dump_compact(doc, fh, line_keys=('bouts', 'unmatched_source_bouts')):
    """Readable header, one record per line for the big lists (small files, line-level git diffs)."""
    keys = list(doc)
    fh.write('{\n')
    for i, k in enumerate(keys):
        v = doc[k]
        if k in line_keys and isinstance(v, list):
            fh.write(f' {json.dumps(k)}: [\n')
            for j, x in enumerate(v):
                fh.write('  ' + json.dumps(x, ensure_ascii=False, separators=(',', ':')) +
                         (',' if j < len(v) - 1 else '') + '\n')
            fh.write(' ]')
        else:
            fh.write(f' {json.dumps(k)}: ' + json.dumps(v, ensure_ascii=False, indent=1).replace('\n', '\n '))
        fh.write(',\n' if i < len(keys) - 1 else '\n')
    fh.write('}\n')


def new_snapshot_path(stamp):
    os.makedirs(PRED_DIR, exist_ok=True)
    base = os.path.join(PRED_DIR, f'odds_snapshot_{stamp}')
    p = base + '.json'
    k = 2
    while os.path.exists(p):
        p = f'{base}_{k}.json'
        k += 1
    return p


METHODS_DOC = {
    'orientation': 'every pair is [A, B] in card order (cards_upcoming.json order when that file exists, '
                   'else Wikipedia order); p_* = probability that A wins; P(B) = 1 - P(A)',
    'p_mult': 'multiplicative (proportional) margin removal: p_A = (1/dA) / (1/dA + 1/dB)',
    'p_shin': 'Shin (1993) model, z (insider share) solved so the probabilities sum to 1; '
              'p_i = (sqrt(z^2 + 4(1-z) q_i^2 / S) - z) / (2(1-z)), q_i = 1/d_i, S = sum q_i',
    'p_power': 'power method p_i = q_i^k, k solved so the probabilities sum to 1 (best on the 2019-2023 '
               'tune period in tools/market.py)',
    'p_consensus': 'headline: logit-mean of the per-book Shin no-vig P(A) over unique sportsbooks '
                   '(exchanges excluded; min and max trimmed when 5+ books)',
    'p_meandec_mult': 'mean of the books\' decimal odds per side, then multiplicative devig: the same '
                      'estimator as the historical close in data/derived/market.json (comparable benchmark)',
    'p_sharp_shin': 'logit-mean of Shin no-vig over the sharp/low-margin books present '
                    '(Pinnacle, Circa, Bookmaker, BetOnline, Bet105)',
    'p_exchange_mult': 'logit-mean of multiplicative no-vig over exchanges / prediction markets '
                       '(Polymarket = international book, PolymarketUS = BFO\'s Polymarket US column, Kalshi, '
                       'SXBet, ProphetX, 4casters, 4Cx)',
    'one_line_per_book': 'a book seen on several sites counts once; preferred source order '
                         'fightodds > bestfightodds > actionnetwork > covers; other copies are kept in '
                         'other_source_lines',
    'sanity': f'a line is rejected when its overround is outside [{OVR_MIN_BOOK}, {OVR_MAX}] for sportsbooks '
              f'([{OVR_MIN}, {OVR_MAX_EXCH}] for exchanges) or, with 4+ books, its no-vig logit is more than '
              f'{OUTLIER_LOGIT} from the cross-book median; low-trust sources ({sorted(LOW_TRUST)}) must sit within '
              f'{OUTLIER_LOGIT_LOW} logit of the trusted books\' median and never set the best price; rejected '
              f'lines are kept in rejected_lines',
    'open': 'market open: logit-mean of Shin no-vig over fightodds.io per-book opening lines (sportsbooks '
            'only; exchange openers are illiquid placeholders and are ignored); plus Action Network\'s opener',
    'props': 'bestfightodds props: two_way = median over books of Shin no-vig P(yes) when both sides are '
             'offered; method = per-book Shin devig of the 6-way (7 with draw) method market '
             '[ko_A, sub_A, dec_A, ko_B, sub_B, dec_B], median across books, renormalised',
    'phase': 'pre_start when the latest fetch of the bout\'s lines came before the bout\'s start (its card '
             'segment\'s start_utc in cards_upcoming.json, else Action Network\'s schedule, else the event lock); '
             'pre_lock likewise against the event lock (earliest start_utc). post_start lines are the books\' '
             'archived closing lines (or in-play) and are never used as a pre-fight forecast',
}


def cmd_snapshot(a):
    now = dt.datetime.now(dt.timezone.utc)
    stamp = a.replay or now.strftime('%Y%m%d-%H%M')
    orig_meta = None
    if a.replay:
        # snapshot time = when the replayed capture started (earliest cached response of that stamp)
        cached = glob.glob(os.path.join(CACHE_ROOT, '*', a.replay, '*.gz'))
        if not cached:
            raise SystemExit(f'no cached pages under data/raw/web_cache/*/{a.replay}/')
        now = dt.datetime.fromtimestamp(min(os.path.getmtime(x) for x in cached), dt.timezone.utc)
        orig = os.path.join(PRED_DIR, f'odds_snapshot_{a.replay}.json')
        if os.path.exists(orig):   # keep the original capture's start time and window, so a replay is exact
            try:
                with open(orig) as fh:
                    orig_meta = json.load(fh)['meta']
                now = _iso(orig_meta['snapshot_utc']) or now
            except (OSError, ValueError, KeyError):
                orig_meta = None
    win = (orig_meta or {}).get('window') or [None, None]
    since = dt.date.fromisoformat(a.since or win[0]) if (a.since or win[0]) else (now.date() - dt.timedelta(days=1))
    until = dt.date.fromisoformat(a.until or win[1]) if (a.until or win[1]) else (now.date() + dt.timedelta(days=45))
    F = Fetcher(stamp, replay=bool(a.replay), delay=a.delay)
    sources = {}
    src_bouts = []
    warnings = []

    def run(name, fn):
        t0 = time.time()
        n0 = F.n_net
        try:
            res, meta = fn()
            sources[name] = {'ok': bool(res), 'n_bouts': len(res), 'n_requests': F.n_net - n0,
                             'seconds': round(time.time() - t0, 1), **{k: v for k, v in meta.items() if k != 'events'}}
            return res, meta
        except Exception as e:     # one broken site must not kill the snapshot
            sources[name] = {'ok': False, 'error': f'{type(e).__name__}: {e}'}
            warnings.append(f'{name} failed: {type(e).__name__}: {e}')
            return [], {}

    print(f'[{stamp}] window {since} .. {until}', flush=True)
    wiki_evs, wiki_cards = [], {}
    cards_file = load_cards_upcoming()
    prev = previous_snapshot(before=zstr(now))
    if not a.skip_wiki:
        def _wiki():
            evs, ts = wiki_events(F, since, until)
            for e in evs:
                wiki_evs.append(e)
                wiki_cards[e['wiki']], _ = wiki_card(F, e)
            return [b for e in evs for b in wiki_cards[e['wiki']]], {'fetched': ts, 'n_events': len(evs)}
        run('wikipedia', _wiki)
        print(f'  wikipedia: {sources.get("wikipedia")}', flush=True)
    sel = set(a.sources.split(','))
    fo_meta = {}
    if 'fightodds' in sel:
        hist = [canon_book(x) for x in a.history.split(',') if x and x.lower() != 'none']
        r, fo_meta = run('fightodds', lambda: fetch_fightodds(F, since, until, detail=not a.no_fight_detail,
                                                              history=hist))
        src_bouts += r
        if fo_meta.get('events'):
            sources['fightodds']['event_list'] = fo_meta['events']
        print(f'  fightodds: {sources["fightodds"]}', flush=True)
    if 'bestfightodds' in sel:
        r, bmeta = run('bestfightodds', lambda: fetch_bfo(F, since, until, prev))
        src_bouts += r
        sources['bestfightodds']['event_pages'] = bmeta.get('events')
        print(f'  bestfightodds: {sources["bestfightodds"]["n_bouts"]} bouts', flush=True)
    if 'actionnetwork' in sel:
        r, _ = run('actionnetwork', lambda: fetch_actionnetwork(F))
        src_bouts += r
        print(f'  actionnetwork: {sources["actionnetwork"]}', flush=True)
    if 'covers' in sel:
        r, _ = run('covers', lambda: fetch_covers(F))
        src_bouts += r
        print(f'  covers: {sources["covers"]}', flush=True)

    events, bouts, card_source = build_universe(wiki_evs, wiki_cards, cards_file, src_bouts,
                                                fo_meta.get('events', []), since, until)
    if prev:   # an event that already happened drops off Wikipedia's scheduled list (and maybe the cards file)
        have = {e['date'] for e in events}
        for e in prev.get('events', []):
            if e['date'] in have or not (since <= dt.date.fromisoformat(e['date']) <= until):
                continue
            events.append({k: v for k, v in e.items() if k not in ('n_bouts', 'n_bouts_with_odds')})
            for r in prev['bouts']:
                if r['date'] == e['date']:
                    bouts.append({'event': r['event'], 'date': r['date'], 'A': r['A']['name'], 'B': r['B']['name'],
                                  'A_slug': r['A'].get('slug'), 'B_slug': r['B'].get('slug'),
                                  'weight_class': r.get('weight_class'), 'segment': r.get('segment'),
                                  'order': r.get('order'), 'rounds': r.get('rounds'), 'status': r.get('status'),
                                  'title_fight': r.get('title'), 'card_src': f"previous snapshot {prev['meta']['stamp']}"})
            warnings.append(f"{e['name']} ({e['date']}) is no longer on the card sources; bouts carried over "
                            f"from snapshot {prev['meta']['stamp']}")
        events.sort(key=lambda e: e['date'])
    if not events:
        warnings.append('no events in the window (Wikipedia and fightodds both empty?)')
    unmatched = match_sources(events, bouts, src_bouts, add_missing=not cards_file[0])
    fidx = FighterIndex()
    recs = build_bouts(bouts, events, fidx, now, have_cards=bool(cards_file[0]))
    for e in events:
        e['n_bouts'] = sum(1 for r in recs if r['date'] == e['date'])
        e['n_bouts_with_odds'] = sum(1 for r in recs if r['date'] == e['date'] and r['consensus'].get('n_books'))
    warnings += F.log
    snap = {
        'meta': {
            'snapshot_utc': now.isoformat(timespec='seconds').replace('+00:00', 'Z'), 'stamp': stamp,
            'tool': 'tools/odds_upcoming.py', 'version': VERSION, 'replayed_from_cache': bool(a.replay),
            'window': [since.isoformat(), until.isoformat()], 'card_source': card_source,
            'card_as_of': CARD_AS_OF if cards_file[0] else None,
            'n_events': len(events), 'n_bouts': len(recs),
            'n_bouts_with_odds': sum(1 for r in recs if r['consensus'].get('n_books')),
            'sources': sources, 'raw_cache': f'data/raw/web_cache/<site>/{stamp}/',
            'n_requests': F.n_net, 'methods': METHODS_DOC,
            'book_classes': {'sharp': sorted(SHARP), 'exchange': sorted(EXCHANGE),
                             'retail': 'every other sportsbook'},
            'use': 'forward-test benchmark only: these lines are known before the fight, so they may be '
                   'compared with or blended into a forecast committed at the same time; never a training '
                   'feature for 2026 fights (hidden-data protocol, docs/BACKLOG.md)',
        },
        'events': events,
        'bouts': recs,
        'unmatched_source_bouts': unmatched,
        'warnings': warnings,
    }
    if orig_meta:   # a rebuild describes the same capture: keep its live request counts and timings
        snap['meta']['rebuilt_from_cache_utc'] = zstr(dt.datetime.now(dt.timezone.utc))
        snap['meta']['n_requests'] = orig_meta.get('n_requests', snap['meta']['n_requests'])
        for k, v in (orig_meta.get('sources') or {}).items():
            if k in sources:
                for f in ('n_requests', 'seconds'):
                    if f in v:
                        sources[k][f] = v[f]
    p = new_snapshot_path(stamp)
    with open(p, 'x') as fh:        # 'x': never overwrite an earlier snapshot
        dump_compact(snap, fh)
    print(f'wrote {os.path.relpath(p, ROOT)}: {len(events)} events, {len(recs)} bouts, '
          f'{snap["meta"]["n_bouts_with_odds"]} with odds, {F.n_net} requests, {len(unmatched)} unmatched',
          flush=True)
    cmd_timeline(a)
    return p


# ----------------------------------------------------------------------------------------------
# timeline across snapshots (opening vs closing)
# ----------------------------------------------------------------------------------------------

def load_snapshots():
    out = []
    for p in sorted(glob.glob(os.path.join(PRED_DIR, 'odds_snapshot_*.json'))):
        try:
            with open(p) as fh:
                s = json.load(fh)
            s['_path'] = os.path.relpath(p, ROOT)
            out.append(s)
        except (OSError, ValueError):
            continue
    out.sort(key=lambda s: s['meta']['snapshot_utc'])
    return out


def _cap(r, s, flip=False):
    c = r.get('consensus') or {}
    m = r.get('market') or {}
    pr = r.get('props') or {}

    def f(x):
        return None if x is None else (round(1 - x, 4) if flip else x)
    cap = {'snapshot': s['meta']['stamp'], 't': s['meta']['snapshot_utc'], 'phase': r.get('phase'),
           'pre_lock': r.get('pre_lock'),
           'p_consensus': f(c.get('p_consensus')), 'p_meandec_mult': f(c.get('p_meandec_mult')),
           'p_sharp_shin': f(c.get('p_sharp_shin')), 'p_pinnacle_shin': f(c.get('p_pinnacle_shin')),
           'p_exchange_mult': f(c.get('p_exchange_mult')), 'n_books': c.get('n_books'),
           'bfo_p_a_novig': f(m.get('p_a_novig')) if m.get('source') == 'bestfightodds' else None,
           'bfo_odds': ([m.get('odds_b'), m.get('odds_a')] if flip else [m.get('odds_a'), m.get('odds_b')])
           if m.get('source') == 'bestfightodds' else None,
           'p_distance': pr.get('p_distance')}
    pm = (pr.get('method') or {}).get('p_method')
    if pm:
        if flip:
            pm = {'a_ko': pm['b_ko'], 'a_sub': pm['b_sub'], 'a_dec': pm['b_dec'], 'b_ko': pm['a_ko'],
                  'b_sub': pm['a_sub'], 'b_dec': pm['a_dec'], 'draw': pm.get('draw')}
        cap['p_method'] = pm
    return cap


def cmd_timeline(a=None):
    """Rebuild data/derived/odds_upcoming.json from every snapshot on disk (orientation of the first
    capture is kept; later captures with a/b swapped are flipped)."""
    snaps = load_snapshots()
    bouts = {}
    for s in snaps:
        for r in s['bouts']:
            pk = (r['date'], tuple(sorted([r['A'].get('slug') or slugify(r['A']['name']),
                                           r['B'].get('slug') or slugify(r['B']['name'])])))
            hit, flip = None, False
            if pk in bouts:
                hit = pk
                flip = (bouts[pk]['A_key'] != (r['A'].get('slug') or slugify(r['A']['name'])))
            else:   # names or slugs changed between snapshots: fuzzy fallback on the same date
                for k2, t in bouts.items():
                    if t['date'] != r['date']:
                        continue
                    sc, sw = pair_score(t['A'], t['B'], r['A']['name'], r['B']['name'])
                    if sc >= 0.85:
                        hit, flip = k2, sw
                        break
            if hit is None:
                hit = pk
                bouts[pk] = {'bout_id': r.get('bout_id'), 'event': r['event'], 'date': r['date'],
                             'A': r['A']['name'], 'B': r['B']['name'], 'A_slug': r['A'].get('slug'),
                             'B_slug': r['B'].get('slug'), 'weight_class': r.get('weight_class'),
                             'rounds': r.get('rounds'), 'title': r.get('title'),
                             'A_key': r['A'].get('slug') or slugify(r['A']['name']), 'captures': []}
            t = bouts[hit]
            t['last_seen'] = s['meta']['stamp']
            t['status'] = r.get('status')
            t['start_utc'] = r.get('start_utc')
            t['start_src'] = r.get('start_src')
            op = r.get('open') or {}
            if op.get('p_open') is not None:
                mo = {'p_open': round(1 - op['p_open'], 4) if flip else op['p_open'], 'n_books': op['n_books'],
                      'snapshot': s['meta']['stamp']}
                t['market_open'] = mo
                t.setdefault('market_open_first_read', mo)
            if op.get('actionnetwork_open'):
                x = op['actionnetwork_open']
                t['actionnetwork_open'] = {'ml': x['ml'][::-1] if flip else x['ml'],
                                           'p_shin': round(1 - x['p_shin'], 4) if flip else x['p_shin']}
            for bk, pts in (r.get('history') or {}).items():
                if flip:
                    pts = [[x[0], x[2], x[1], round(1 - x[3], 4)] for x in pts]
                pre = [x for x in pts if not t.get('start_utc') or _iso(x[0]) < _iso(t['start_utc'])]
                if pre:
                    t.setdefault('book_history', {})[bk] = {
                        'open': pre[0], 'last_pre_start': pre[-1], 'n_moves': len(pre) - 1,
                        'read_in': s['meta']['stamp'], 'format': '[t_utc, odds_a, odds_b, p_a_shin]'}
            if (r.get('consensus') or {}).get('n_books'):
                t['captures'].append(_cap(r, s, flip))
    out = []
    for t in bouts.values():
        t.pop('A_key', None)
        caps = t['captures']
        pre = [c for c in caps if c['phase'] == 'pre_start']
        post = [c for c in caps if c['phase'] == 'post_start']
        lock = [c for c in caps if c.get('pre_lock')]
        if pre:
            t['first_capture'] = pre[0]
            t['last_pre_start'] = dict(pre[-1])
            st, lt = _iso(t.get('start_utc')), _iso(pre[-1]['t'])
            if st and lt:
                t['last_pre_start']['hours_before_start'] = round((st - lt).total_seconds() / 3600, 1)
        if lock:
            t['last_pre_lock'] = lock[-1]
        if post:
            t['archived_close'] = post[0]
        mo = (t.get('market_open') or {}).get('p_open')
        lp = (t.get('last_pre_start') or {}).get('p_consensus')
        if mo is not None and lp is not None:
            t['move_open_to_last_pts'] = round(lp - mo, 4)
            t['move_open_to_last_logit'] = round(logit(lp) - logit(mo), 4)
        t['n_captures'] = len(caps)
        out.append(t)
    out.sort(key=lambda t: (t['date'], t.get('bout_id') or ''))
    doc = {
        'meta': {
            'built': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
            'tool': 'tools/odds_upcoming.py timeline',
            'snapshots': [s['_path'] for s in snaps],
            'orientation': 'a/b as in the first snapshot that listed the bout (cards_upcoming.json order); '
                           'p_* = probability that A wins; captures taken with a/b swapped are flipped',
            'market_open': 'fightodds.io per-book opening lines (sportsbooks only), Shin no-vig, logit-mean '
                           '(latest read; market_open_first_read keeps the first)',
            'first_capture': 'first pre-start snapshot that had lines for the bout',
            'last_pre_lock': 'last snapshot before the event lock (earliest start_utc of the card): the market '
                             'at prediction time, comparable with a prediction file committed before the lock',
            'last_pre_start': 'last snapshot before the bout started: the closing-line proxy '
                              '(hours_before_start says how close to the bell it was)',
            'archived_close': 'first snapshot after the bout\'s start: the books\' archived closing lines as '
                              'BFO/fightodds keep them (exchanges may be in-play/settled; p_consensus, '
                              'p_meandec_mult and bfo_p_a_novig exclude exchanges)',
            'bfo_p_a_novig': 'mean of BestFightOdds\' sportsbook lines, multiplicative no-vig: the ledger\'s '
                             'closing benchmark (data/predictions/README.md)',
            'use': 'forward-test benchmark; never a training feature for 2026 fights',
        },
        'bouts': out,
    }
    os.makedirs(os.path.dirname(TIMELINE_JSON), exist_ok=True)
    with open(TIMELINE_JSON, 'w') as fh:
        json.dump(doc, fh, indent=1, ensure_ascii=False)
        fh.write('\n')
    print(f'timeline: {len(out)} bouts from {len(snaps)} snapshots -> {os.path.relpath(TIMELINE_JSON, ROOT)}')


def cmd_show(a):
    snaps = load_snapshots()
    if not snaps:
        print('no snapshots')
        return
    s = snaps[-1]
    if a.stamp:
        s = next((x for x in snaps if x['meta']['stamp'] == a.stamp), s)
    print(f"{s['_path']}  ({s['meta']['snapshot_utc']}, cards: {s['meta']['card_source']})")
    cur = None
    for r in s['bouts']:
        if r['event'] != cur:
            cur = r['event']
            print(f"\n== {r['date']} {cur}")
        c = r['consensus']
        p = c.get('p_consensus')
        pm = (r.get('props') or {}).get('p_distance')
        op = (r.get('open') or {}).get('p_open')
        fmt = lambda x: f'{x:.3f}' if x is not None else '  -  '
        print(f"  {r['A']['name'][:24]:>24} vs {r['B']['name'][:24]:<24} pA {fmt(p)} (open {fmt(op)}, "
              f"sharp {fmt(c.get('p_sharp_shin'))}, exch {fmt(c.get('p_exchange_mult'))}) "
              f"books {c.get('n_books', 0):>2}  P(dist) {fmt(pm)}  {r.get('status') or ''}")


def cmd_plan(a):
    """Recommended capture times (UTC) for the events in the latest snapshot."""
    snaps = load_snapshots()
    if not snaps:
        print('no snapshots yet: run `snapshot` first')
        return
    s = snaps[-1]
    now = dt.datetime.now(dt.timezone.utc)
    print(f"from {s['_path']} (now {zstr(now)}):")
    for e in s['events']:
        lock = _iso(e.get('lock_utc'))
        if not lock:
            continue
        plan = [('T-24h (day-before line)', lock - dt.timedelta(hours=24)),
                ('T-2h (prediction-time market, before the ledger lock)', lock - dt.timedelta(hours=2)),
                ('T+10h (archived closing lines, after the card)', lock + dt.timedelta(hours=10))]
        print(f"  {e['date']} {e['name']} lock {e['lock_utc']} ({e.get('lock_src')}), "
              f"{e.get('n_bouts_with_odds', 0)}/{e.get('n_bouts', 0)} bouts with odds")
        for lab, t in plan:
            print(f"     {'done/past' if t < now else 'due     '} {zstr(t)}  {lab}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    s = sub.add_parser('snapshot')
    s.add_argument('--since', help='first event date (default: yesterday)')
    s.add_argument('--until', help='last event date (default: today + 45 days)')
    s.add_argument('--sources', default='fightodds,bestfightodds,actionnetwork,covers')
    s.add_argument('--no-fight-detail', action='store_true',
                   help='skip the per-fight fightodds query (per-book open/best/worst)')
    s.add_argument('--history', default='Pinnacle',
                   help="books whose full timestamped line history is read from fightodds (2 requests per "
                        "bout per book; 'none' to skip)")
    s.add_argument('--skip-wiki', action='store_true')
    s.add_argument('--replay', metavar='STAMP', help='rebuild from data/raw/web_cache/*/STAMP without network')
    s.add_argument('--delay', type=float, default=1.25, help='seconds between requests (>= 1.0)')
    t = sub.add_parser('timeline')
    w = sub.add_parser('show')
    w.add_argument('stamp', nargs='?')
    sub.add_parser('plan')
    a = ap.parse_args()
    if a.cmd == 'snapshot':
        a.delay = max(1.0, a.delay)
        cmd_snapshot(a)
    elif a.cmd == 'timeline':
        cmd_timeline(a)
    elif a.cmd == 'show':
        cmd_show(a)
    elif a.cmd == 'plan':
        cmd_plan(a)


if __name__ == '__main__':
    main()
