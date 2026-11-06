#!/usr/bin/env python3
"""Debut path: a dedicated model for UFC bouts with a debutant (task key: debut).

Run from the project root:

    python3 tools/debut.py crawl        # resolve 2012-2014 debutants + one-hop opponents (Sherdog, >= 2 s/request)
    python3 tools/debut.py build        # universe + features -> out/debut_cache/frame.pkl (no network)
    python3 tools/debut.py cv           # forward-chained CV <= 2023: every choice (winner, method, line stack)
    python3 tools/debut.py holdout      # score 2024-2025 ONCE with the frozen CV choices
    python3 tools/debut.py export       # data/derived/debut.json (production coefficients, refit <= 2025)
    python3 tools/debut.py features --name "First Last" --date YYYY-MM-DD [--sherdog URL]   # live debutant entry

Universe: every UFC bout 2012-01-01..2025-12-31 (ufcstats) in which at least one man has 0 prior UFC bouts.
Bouts dated 2026-01-01 or later are dropped at parse and never fit or scored (hidden-data protocol,
docs/BACKLOG.md). Report: research/model_debut.md.

Sherdog (robots.txt: User-agent * Allow /): User-Agent "FightLabSim/1.0", one request every >= 2 s, pages
cached under data/raw/debut_cache/ (gitignored); tools/preufc.py's cache (data/raw/sherdog_cache/) is read, never
written. Compact extracts only are committed (data/derived/debut.json).
"""
import argparse
import datetime as dt
import json
import math
import os
import pickle
import re
import sys
import time
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import preufc as PU  # noqa: E402

DCACHE = os.path.join(ROOT, "data", "raw", "debut_cache")
PCACHE = PU.CACHE                                  # tools/preufc.py cache: read-only here
DERIVED = os.path.join(ROOT, "data", "derived")
OUTC = os.path.join(ROOT, "out", "debut_cache")
DRESOLVE = os.path.join(DCACHE, "resolve.json")
STATE = os.path.join(DCACHE, "crawl_state.json")
UNIVERSE_FROM = dt.date(2012, 1, 1)
VAULT_FROM = dt.date(2026, 1, 1)
TEST_FROM = dt.date(2024, 1, 1)
OPP_K = 5                                          # one-hop crawl: opponents of each debutant's last K pre-UFC fights
MIN_GAP = 2.0
UA = "FightLabSim/1.0"


# ------------------------------------------------------------------ cache plumbing (preufc's cache read-only)
def _fname(href):
    return href.rsplit("/", 1)[-1] + ".html"


def fighter_path(href):
    p = os.path.join(PCACHE, "fighter", _fname(href))
    if os.path.exists(p) and os.path.getsize(p) > 0:
        return p
    return os.path.join(DCACHE, "fighter", _fname(href))


def search_path(q):
    name = re.sub(r"[^A-Za-z0-9]+", "_", PU.ascii_fold(q)).strip("_")[:120] + ".html"
    p = os.path.join(PCACHE, "search", name)
    if os.path.exists(p) and os.path.getsize(p) > 0:
        return p
    return os.path.join(DCACHE, "search", name)


def cached(href):
    p = fighter_path(href)
    return os.path.exists(p) and os.path.getsize(p) > 0


def patch_preufc():
    """Point tools/preufc.py's crawler at this tool's cache and rate limit (preufc's own files untouched)."""
    PU.fighter_path = fighter_path
    PU.search_path = search_path
    PU.RESOLVE = DRESOLVE
    PU.MIN_GAP = MIN_GAP
    PU.UA = UA


# ------------------------------------------------------------------ universe
def load_universe():
    """ufcstats fights (date order), people, bouts; the debut universe (2012..2025, a side with 0 prior UFC bouts)."""
    fights, people, bouts = PU.load_ufc()
    fights = [f for f in fights if f.date < VAULT_FROM]          # vault dropped at parse
    bouts = {p: [t for t in ub if t[0] < VAULT_FROM] for p, ub in bouts.items()}
    N = Counter()
    uni = []
    for f in fights:
        a, b = f.persons
        if a != b and f.date >= UNIVERSE_FROM and (N[a] == 0 or N[b] == 0):
            uni.append((f, N[a], N[b]))
        for p in f.persons:
            N[p] += 1
    return fights, people, bouts, uni


def debutants_of(uni):
    out = {}
    for f, na, nb in uni:
        for p, n in zip(f.persons, (na, nb)):
            if n == 0 and not p.startswith(("amb:", "name:")):
                out[p] = f.date
    return out


# ------------------------------------------------------------------ crawl
def crawl(args):
    os.makedirs(os.path.join(DCACHE, "fighter"), exist_ok=True)
    os.makedirs(os.path.join(DCACHE, "search"), exist_ok=True)
    patch_preufc()
    fights, people, bouts, uni = load_universe()
    deb = debutants_of(uni)
    if not os.path.exists(DRESOLVE):                            # seed with preufc's resolutions (read-only copy)
        json.dump(json.load(open(os.path.join(PCACHE, "resolve.json"))), open(DRESOLVE, "w"), indent=0)
    res = json.load(open(DRESOLVE))
    log = open(os.path.join(DCACHE, "crawl.log"), "a")

    def say(*a):
        s = time.strftime("%H:%M:%S ") + " ".join(str(x) for x in a)
        print(s, flush=True)
        log.write(s + "\n")
        log.flush()

    # ---- phase A: resolve every debutant of the universe (preufc's resolver; targets = debutants)
    pend = [p for p in deb if res.get(p, {}).get("status") != "ok"]
    say("phase A: %d debutants, %d unresolved" % (len(deb), len(pend)))
    if pend and not args.skip_resolve:
        real_targets = PU.targets
        PU.targets = lambda *a, **k: sorted(deb)
        try:
            ns = argparse.Namespace(since="2012-01-01", extra_since=None, limit=None, offline=args.offline, retry=True)
            PU.crawl(ns)
        finally:
            PU.targets = real_targets
        res = json.load(open(DRESOLVE))
        say("phase A done: %d of %d debutants resolved" % (sum(res.get(p, {}).get("status") == "ok" for p in deb),
                                                          len(deb)))
    # ---- phase B: one-hop opponents, by rank (last pre-UFC fight first), uniform policy for every debutant
    fx = PU.Fetcher(offline=args.offline)
    ranks = defaultdict(list)                       # rank -> [href]
    seen = set()
    for p, d0 in sorted(deb.items(), key=lambda kv: kv[1]):
        r = res.get(p, {})
        if r.get("status") != "ok":
            continue
        P = PU.parse_fighter(fx.get(PU.BASE + r["href"], fighter_path(r["href"])))
        if not P:
            continue
        rows = [x for x in PU.row_list(P) if x["date"] and x["date"] < d0.isoformat()
                and PU.promotion(x["event"]) != "UFC"]
        for k, x in enumerate(reversed(rows[-OPP_K:])):
            h = x["opp_href"]
            if h and h not in seen:
                seen.add(h)
                ranks[k].append(h)
    todo = [(k, h) for k in sorted(ranks) for h in ranks[k] if not cached(h)]
    say("phase B: %d opponent pages over ranks %s; %d not cached" % (
        len(seen), {k: len(v) for k, v in sorted(ranks.items())}, len(todo)))
    t0, n0 = time.time(), fx.n
    done_rank = -1
    for j, (k, h) in enumerate(todo):
        if args.max_requests and fx.n - n0 >= args.max_requests:
            say("max requests reached")
            break
        fx.get(PU.BASE + h, fighter_path(h))
        if j + 1 == len(todo) or todo[j + 1][0] != k:
            done_rank = k
            say("rank %d complete" % k)
        if (j + 1) % 100 == 0:
            el = time.time() - t0
            say("%d/%d opponent pages, %d requests, %.0f s, eta %.0f min" % (
                j + 1, len(todo), fx.n - n0, el, el / (j + 1) * (len(todo) - j - 1) / 60))
            json.dump({"ranks_total": {k: len(v) for k, v in ranks.items()}, "done": j + 1, "todo": len(todo),
                       "last_rank_complete": done_rank, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
                      open(STATE, "w"))
    complete = [k for k in sorted(ranks) if all(cached(h) for h in ranks[k])]
    json.dump({"ranks_total": {k: len(v) for k, v in ranks.items()}, "ranks_complete": complete,
               "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}, open(STATE, "w"))
    say("phase B finished; complete ranks %s; %d requests" % (complete, fx.n - n0))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("crawl")
    c.add_argument("--offline", action="store_true")
    c.add_argument("--skip-resolve", action="store_true")
    c.add_argument("--max-requests", type=int, default=0)
    args = ap.parse_args()
    if args.cmd == "crawl":
        crawl(args)


if __name__ == "__main__":
    main()
