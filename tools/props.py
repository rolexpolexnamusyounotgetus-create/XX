#!/usr/bin/env python3
"""Market props for how and when (task key: props; docs/V6_V10_PLAN.md Cycle 2 research).

Historical method / goes-the-distance / round props per bout from BestFightOdds (BFO) per-book closing prop lines,
de-vigged per prop family, checked for consistency across families, and pooled log-linearly with the method/round
model (S2 cells; SM as a candidate expert) for P(method | winner) and P(round | finish), with a decision-share debias.
The winner is never touched: every scored package takes P(A wins) from the same winner model.

Run from the project root (stages cache into out/props_cache/, so each can be re-run alone):

    nice -n 5 python3 tools/props.py fetch      # polite BFO fetch of the 2021-2025 event pages (cache only)
    nice -n 5 python3 tools/props.py extract    # cached pages -> data/raw/odds/bfo_props_full.csv (2026+ dropped)
    nice -n 5 python3 tools/props.py table      # match to backtest fights, de-vig per family, consistency, coverage
    nice -n 5 python3 tools/props.py cells      # S / S2 / SM / S2+ml2win joint cells per fold (ml2's method stage)
    nice -n 5 python3 tools/props.py winner     # fixed winner models: ML v2 and the close stack (forward-chained)
    nice -n 5 python3 tools/props.py cv         # forward-chained CV 2022-2023 (fit on 2021..Y-1): pool weights, debias
    nice -n 5 python3 tools/props.py prereg     # write the pre-registration into out/props_cache/prereg.json
    nice -n 5 python3 tools/props.py valid      # PREREG scored ONCE on 2024-01-01..2025-12-31 (refuses a second run)
    nice -n 5 python3 tools/props.py export     # data/derived/props.json (+ JS pool parameters and test vectors)
    python3 tools/props.py capture [--until YYYY-MM-DD]   # forward capture: timestamped prop snapshot, upcoming cards

Protocol (docs/BACKLOG.md). Every row dated 2026-01-01 or later is dropped at parse (the extract never writes one;
build_db.parse_fights is wrapped through tools/ml2.py). Every choice (which experts enter the pool, the debias, the
de-vig) is made by forward-chained CV on fights before 2024-01-01 (props exist from 2021: fit 2021 -> score 2022,
fit 2021-2022 -> score 2023; leave-one-year-out 2021-2023 as a secondary check), with the 0.0005 rule of tools/ml2.py
for adding an expert or a term. 2024-01-01..2025-12-31 is scored once by `valid` (a guard file refuses a second run).
The pool is corner-symmetric: every term is a function of the winner's own side (no A/B term, no intercept other
than the class biases shared by both sides); the corner swap is asserted. Intervals: 2,000 event-cluster bootstrap
resamples (cards), paired for differences.

Scraping: User-Agent "FightLabSim/1.0", robots.txt checked, >= 2 s between requests (plus jitter), raw pages cached
under data/raw/props_cache/ (gitignored); only the compact extract is committed. BFO's robots.txt allows everything
but /cnadm/. No logins, no paywalls. BFO's per-book line-history endpoint is obfuscated and is not used
(tools/linemove.py: a request to it was refused as circumvention), so historical props are closing prices only;
the `capture` stage records timestamps for the forward ledger.
"""
import os

for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "1")
import argparse
import csv
import datetime as dt
import gzip
import json
import math
import pickle
import random
import re
import ssl
import sys
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.dirname(HERE)
DERIVED = os.path.join(ROOT, "data", "derived")
ODDS = os.path.join(ROOT, "data", "raw", "odds")
RAWC = os.path.join(ROOT, "data", "raw", "props_cache")
CACHE = os.path.join(ROOT, "out", "props_cache")
PRED_DIR = os.path.join(ROOT, "data", "predictions")
OUT_JSON = os.path.join(DERIVED, "props.json")
EXTRACT = os.path.join(ODDS, "bfo_props_full.csv")
VAULT_S = "2026-01-01"
VAULT = dt.date(2026, 1, 1)
UA = "FightLabSim/1.0"
BFO = "https://www.bestfightodds.com"
EXCHANGES = {"Polymarket", "PolymarketUS", "Polymarket US", "Kalshi", "SXBet", "ProphetX", "Novig", "Betfair"}
CV_YEARS = (2022, 2023)          # forward-chained folds: fit on 2021..Y-1 (props start 2021)
PROP_YEARS = (2021, 2022, 2023)  # LOYO secondary check
TEST_FROM, TEST_TO = "2024-01-01", "2025-12-31"
SEL_MIN = 0.0005                 # tools/ml2.py's rule: a term enters only if CV improves by more than this
os.makedirs(CACHE, exist_ok=True)
os.makedirs(RAWC, exist_ok=True)

STAGES = {}


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def stage(name):
    def deco(fn):
        STAGES[name] = fn
        return fn
    return deco


# ====================================================================== polite fetcher (FightLabSim/1.0)
class Fetcher:
    """GET with robots.txt check, >= delay s between requests (+ jitter), gzip cache. Never sends credentials."""

    def __init__(self, cache, delay=2.5, jitter=1.0, refresh=False):
        self.cache, self.delay, self.jitter, self.refresh = cache, max(2.0, delay), jitter, refresh
        self.last = 0.0
        self.n_net = 0
        ca = "/root/.ccr/ca-bundle.crt"
        self.ctx = ssl.create_default_context(cafile=ca) if os.path.exists(ca) else ssl.create_default_context()
        self._robots = {}
        os.makedirs(cache, exist_ok=True)

    def path_for(self, url, stamp=None):
        p = re.sub(r"^https?://[^/]+/", "", url).strip("/") or "index"
        p = re.sub(r"[^A-Za-z0-9_.-]+", "_", p)
        d = os.path.join(self.cache, stamp) if stamp else self.cache
        os.makedirs(d, exist_ok=True)
        return os.path.join(d, p + ".html.gz")

    def _raw_get(self, url):
        wait = self.delay + random.random() * self.jitter - (time.time() - self.last)
        if wait > 0:
            time.sleep(wait)
        self.last = time.time()
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip",
                                                   "Accept": "text/html,application/xhtml+xml,*/*;q=0.8"})
        with urllib.request.urlopen(req, timeout=60, context=self.ctx) as r:
            raw = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
        self.n_net += 1
        return raw.decode("utf-8", errors="replace")

    def allowed(self, url):
        host = re.match(r"^(https?://[^/]+)", url).group(1)
        if host not in self._robots:
            try:
                txt = self._raw_get(host + "/robots.txt")
            except Exception:
                txt = ""
            dis, active = [], False
            for line in txt.splitlines():
                line = line.split("#")[0].strip()
                if not line:
                    continue
                k, _, v = line.partition(":")
                k, v = k.strip().lower(), v.strip()
                if k == "user-agent":
                    active = v == "*" or "fightlabsim" in v.lower()
                elif k == "disallow" and active and v:
                    dis.append(v)
            self._robots[host] = dis
        path = re.sub(r"^https?://[^/]+", "", url) or "/"
        return not any(path.startswith(d) for d in self._robots[host])

    def get(self, url, stamp=None):
        """-> (text or None, fetched_utc ISO). Cached pages return their cache mtime as the fetch time."""
        fp = self.path_for(url, stamp)
        if os.path.exists(fp) and not self.refresh:
            with gzip.open(fp, "rt", encoding="utf-8", errors="replace") as fh:
                ts = dt.datetime.fromtimestamp(os.path.getmtime(fp), dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                return fh.read(), ts
        if not self.allowed(url):
            log("robots.txt disallows %s; skipped" % url)
            return None, None
        for attempt in range(4):
            try:
                txt = self._raw_get(url)
                with gzip.open(fp, "wt", encoding="utf-8") as fh:
                    fh.write(txt)
                return txt, dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    return None, None
                if e.code in (403, 407, 429):
                    raise SystemExit("blocked (%d) on %s; stopping politely" % (e.code, url))
                time.sleep(10 * (attempt + 1) ** 2)
            except Exception as e:  # network hiccup
                log("  retry %d %s: %s" % (attempt + 1, url, e))
                time.sleep(10 * (attempt + 1) ** 2)
        return None, None


def event_list():
    """BFO event pages (slug-id) of 2021-01-01..2025-12-31 UFC cards: the pages tools/market.py found props on."""
    seen = {}
    with open(os.path.join(ODDS, "bfo_event_props.csv")) as fh:
        for r in csv.DictReader(fh):
            if r["date"] < VAULT_S:
                seen[r["event"]] = r["date"]
    return sorted(seen.items(), key=lambda x: (x[1], x[0]))


@stage("fetch")
def stage_fetch(args):
    F = Fetcher(os.path.join(RAWC, "bfo"), delay=args.delay)
    evs = event_list()
    t0 = time.time()
    n_ok = 0
    for k, (slug, date) in enumerate(evs):
        txt, _ = F.get("%s/events/%s" % (BFO, slug))
        n_ok += txt is not None
        if (k + 1) % 20 == 0:
            log("fetch %d/%d pages (%d from the network, %.0f s)" % (k + 1, len(evs), F.n_net, time.time() - t0))
    log("fetch done: %d/%d pages, %d network requests" % (n_ok, len(evs), F.n_net))


