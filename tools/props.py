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


# ====================================================================== extract: cached pages -> compact CSV
EXTRACT_KEYS = (["ko1", "sub1", "dec1", "ud1", "sm1", "itd1", "ko2", "sub2", "dec2", "ud2", "sm2", "itd2", "draw",
                 "godec"] + ["er%d" % k for k in range(1, 6)] + ["wr%d%d" % (k, t) for k in range(1, 6) for t in (1, 2)]
                + ["kor%d%d" % (k, t) for k in range(1, 6) for t in (1, 2)]
                + ["subr%d%d" % (k, t) for k in range(1, 6) for t in (1, 2)] + ["ou15", "ou25", "ou35", "ou45"])
TWO_WAY = {"godec", "itd1", "itd2", "dec1", "dec2", "ou15", "ou25", "ou35", "ou45"}


@stage("extract")
def stage_extract(args):
    import market as MK
    F = Fetcher(os.path.join(RAWC, "bfo"))
    rows, n_pages, n_2026 = [], 0, 0
    for slug, date in event_list():
        fp = F.path_for("%s/events/%s" % (BFO, slug))
        if not os.path.exists(fp):
            continue
        if date >= VAULT_S:          # hidden-data protocol (event_list already stops at 2025-12-31)
            n_2026 += 1
            continue
        n_pages += 1
        with gzip.open(fp, "rt", encoding="utf-8", errors="replace") as fh:
            html = fh.read()
        mus, props = MK.parse_event_props_full(html)
        for (mu, book), d in props.items():
            if book in EXCHANGES or mu not in mus:
                continue
            m = mus[mu]
            ml = m["lines"].get(book) or [None, None]
            r = {"mu": mu, "date": date, "event": slug, "book": book, "t1": m.get("t1_name", ""),
                 "t2": m.get("t2_name", ""), "ml1": ml[0], "ml2": ml[1]}
            for k in EXTRACT_KEYS:
                v = d.get(k)
                if v is None:
                    continue
                if k in TWO_WAY:
                    r[k] = v[0]
                    r[k + "_no"] = v[1]
                else:
                    r[k] = v[0]
            rows.append(r)
    cols = ["mu", "date", "event", "book", "t1", "t2", "ml1", "ml2"]
    for k in EXTRACT_KEYS:
        cols.append(k)
        if k in TWO_WAY:
            cols.append(k + "_no")
    with open(EXTRACT, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        for r in rows:
            w.writerow({c: ("" if r.get(c) is None else r[c]) for c in cols})
    assert all(r["date"] < VAULT_S for r in rows)
    log("extract: %d matchup-book rows from %d pages -> %s (2026+ pages skipped: %d)" % (len(rows), n_pages,
                                                                                        EXTRACT, n_2026))


# ====================================================================== de-vig per prop family
def am_dec(a):
    a = float(a)
    return 1 + a / 100.0 if a > 0 else 1 + 100.0 / (-a)


def q_of(a):
    return None if a is None or a == "" else 1.0 / am_dec(a)


def power_devig(q):
    """Power de-vig of a mutually exclusive, exhaustive family: p_i = q_i^k with sum 1 (multiplicative if the book's
    family sums to <= 1). Returns (p, overround)."""
    S = sum(q)
    if S <= 1:
        return [x / S for x in q], S
    lo, hi = 1.0, 30.0
    for _ in range(80):
        k = 0.5 * (lo + hi)
        if sum(x ** k for x in q) > 1:
            lo = k
        else:
            hi = k
    k = 0.5 * (lo + hi)
    v = [x ** k for x in q]
    t = sum(v)
    return [x / t for x in v], S


def mult_devig(q):
    S = sum(q)
    return [x / S for x in q], S


DEVIG = {"power": power_devig, "mult": mult_devig}
OVER_MAX = {"m6": 1.6, "gd": 1.25, "er": 1.8, "wr": 2.2, "mr": 2.6, "itd": 1.25, "ou": 1.25}


def _dec_q(d, t):
    if d.get("dec%d" % t) is not None:
        return q_of(d["dec%d" % t])
    if d.get("ud%d" % t) is not None and d.get("sm%d" % t) is not None:
        return q_of(d["ud%d" % t]) + q_of(d["sm%d" % t])
    return None


def book_families(d, K, sw, how="power"):
    """One book's prop prices for one bout -> de-vigged families oriented to the backtest's A/B (sw: page team 1 is
    B). Families: m6 [A KO, A SUB, A DEC, B KO, B SUB, B DEC] (+ draw if quoted), gd P(decision), er [ends r1..K,
    decision], wr [A wins r1..K, B wins r1..K, A dec, B dec], mr [A KO r1..K, A SUB r1..K, B KO r1..K, B SUB r1..K,
    A dec, B dec], itd [P(A wins inside the distance), P(B ...)], ou {x.5: P(over)}. A family is kept only when
    every leg is quoted, every leg is < 1 and its overround is plausible (OVER_MAX)."""
    dv = DEVIG[how]
    out = {}
    t1, t2 = (2, 1) if sw else (1, 2)          # t1 = page team of A
    g = lambda k: q_of(d.get(k))                # noqa: E731
    draw = g("draw")

    def keep(fam, q, extra_draw=True):
        if any(x is None or x <= 0 or x >= 1 for x in q):
            return None
        qq = q + ([draw] if (extra_draw and draw is not None and 0 < draw < 0.2) else [])
        p, S = dv(qq)
        if not (0.97 <= S <= OVER_MAX[fam]):
            return None
        return p, S
    # method six-way
    q = [g("ko%d" % t1), g("sub%d" % t1), _dec_q(d, t1), g("ko%d" % t2), g("sub%d" % t2), _dec_q(d, t2)]
    r = keep("m6", q)
    if r:
        p, S = r
        out["m6"] = p[:6]
        out["m6_draw"] = p[6] if len(p) > 6 else None
        out["m6_over"] = S
    # goes to decision (two-way)
    if d.get("godec") is not None and d.get("godec_no") is not None:
        r = keep("gd", [g("godec"), q_of(d["godec_no"])], extra_draw=False)
        if r:
            out["gd"] = r[0][0]
    # fight ends in round k (+ decision)
    if d.get("godec") is not None and all(d.get("er%d" % k) is not None for k in range(1, K + 1)):
        r = keep("er", [g("er%d" % k) for k in range(1, K + 1)] + [g("godec")], extra_draw=False)
        if r:
            out["er"] = r[0]
    # fighter wins in round k (+ each side's decision)
    if all(d.get("wr%d%d" % (k, t)) is not None for k in range(1, K + 1) for t in (1, 2)):
        q = [g("wr%d%d" % (k, t1)) for k in range(1, K + 1)] + [g("wr%d%d" % (k, t2)) for k in range(1, K + 1)] \
            + [_dec_q(d, t1), _dec_q(d, t2)]
        r = keep("wr", q)
        if r:
            out["wr"] = r[0][:2 * K + 2]
    # fighter wins by method in round k (+ decisions)
    if all(d.get("%s%d%d" % (m, k, t)) is not None for m in ("kor", "subr") for k in range(1, K + 1) for t in (1, 2)):
        q = ([g("kor%d%d" % (k, t1)) for k in range(1, K + 1)] + [g("subr%d%d" % (k, t1)) for k in range(1, K + 1)]
             + [g("kor%d%d" % (k, t2)) for k in range(1, K + 1)] + [g("subr%d%d" % (k, t2)) for k in range(1, K + 1)]
             + [_dec_q(d, t1), _dec_q(d, t2)])
        r = keep("mr", q)
        if r:
            out["mr"] = r[0][:4 * K + 2]
    # inside the distance, per side (two-way)
    itd = []
    for t in (t1, t2):
        if d.get("itd%d" % t) is not None and d.get("itd%d_no" % t) is not None:
            r = keep("itd", [g("itd%d" % t), q_of(d["itd%d_no" % t])], extra_draw=False)
            itd.append(r[0][0] if r else None)
        else:
            itd.append(None)
    if any(x is not None for x in itd):
        out["itd"] = itd
    ou = {}
    for x in ("15", "25", "35", "45"):
        if d.get("ou" + x) is not None and d.get("ou%s_no" % x) is not None:
            r = keep("ou", [g("ou" + x), q_of(d["ou%s_no" % x])], extra_draw=False)
            if r:
                ou[x] = r[0][0]
    if ou:
        out["ou"] = ou
    # the book's moneyline (two-way, power), oriented
    if d.get("ml1") not in (None, "") and d.get("ml2") not in (None, ""):
        q = [q_of(d["ml1"]), q_of(d["ml2"])]
        if sw:
            q = q[::-1]
        if 0.98 <= sum(q) <= 1.25:
            out["ml"] = power_devig(q)[0][0]
    return out


def _median(v):
    v = sorted(v)
    n = len(v)
    return v[n // 2] if n % 2 else 0.5 * (v[n // 2 - 1] + v[n // 2])


def consensus(fams_by_book, K, max_dev=0.15):
    """Average the books' de-vigged families (arithmetic mean). Outcome-blind outlier rule: with >= 3 books, a book's
    family is dropped when its key scalar (P(decision) for m6 / gd / er / wr / mr, P(A) for ml) is more than max_dev
    from the median book (stale or in-play prices)."""
    out, nb, dropped = {}, {}, 0
    key = {"m6": lambda p: p[2] + p[5], "gd": lambda p: p, "er": lambda p: p[-1], "wr": lambda p: p[-1] + p[-2],
           "mr": lambda p: p[-1] + p[-2], "ml": lambda p: p}
    for fam in ("m6", "gd", "er", "wr", "mr", "ml"):
        vals = [(b, f[fam]) for b, f in fams_by_book.items() if fam in f]
        if not vals:
            continue
        if len(vals) >= 3:
            med = _median([key[fam](v) for _, v in vals])
            kept = [(b, v) for b, v in vals if abs(key[fam](v) - med) <= max_dev]
            dropped += len(vals) - len(kept)
            vals = kept or vals
        if fam in ("gd", "ml"):
            out[fam] = sum(v for _, v in vals) / len(vals)
        else:
            L = len(vals[0][1])
            out[fam] = [sum(v[i] for _, v in vals) / len(vals) for i in range(L)]
        nb[fam] = len(vals)
    for fam in ("itd",):
        for j in (0, 1):
            vals = [f[fam][j] for f in fams_by_book.values() if fam in f and f[fam][j] is not None]
            if vals:
                out.setdefault("itd", [None, None])[j] = sum(vals) / len(vals)
    ou = defaultdict(list)
    for f in fams_by_book.values():
        for x, v in f.get("ou", {}).items():
            ou[x].append(v)
    if ou:
        out["ou"] = {x: sum(v) / len(v) for x, v in ou.items()}
    out["n_books"] = nb
    out["n_dropped"] = dropped
    return out


# ====================================================================== table: match, de-vig, consistency, coverage
def load_extract():
    by_mu = defaultdict(dict)
    with open(EXTRACT) as fh:
        for r in csv.DictReader(fh):
            if r["date"] >= VAULT_S:          # protocol: never read a 2026 row
                continue
            d = {k: (int(float(v)) if v not in ("", None) and k not in ("date", "event", "book", "t1", "t2") else v)
                 for k, v in r.items()}
            by_mu[int(r["mu"])][r["book"]] = d
    return by_mu


def jload(name):
    return json.load(open(os.path.join(DERIVED, name)))


def dev_fights():
    bt = jload("backtest_dev.json")
    return [f for f in bt["fights"] if f["date"] < VAULT_S]


SEG_MAP = {"main card": "main", "main": "main", "preliminary card": "prelim", "prelims": "prelim",
           "early prelims": "early", "early preliminary card": "early"}


def seg_of(fw):
    if not fw:
        return "unknown"
    s = (fw.get("card_segment") or "").strip().lower()
    for k, v in SEG_MAP.items():
        if s.startswith(k):
            return v
    if "early" in s:
        return "early"
    if "prelim" in s:
        return "prelim"
    if "main" in s:
        return "main"
    return "unknown"


@stage("table")
def stage_table(args):
    import market as MK
    fights = dev_fights()
    mk = jload("market.json")["fights"]
    fw = jload("fightweek.json")["fights"]
    by_mu = load_extract()
    mu_of = {fid: v["bfo"]["matchup"] for fid, v in mk.items() if (v.get("bfo") or {}).get("matchup")}
    tab, orient_flags = {}, []
    for f in fights:
        mu = mu_of.get(f["id"])
        rows = by_mu.get(mu) if mu else None
        seg = seg_of(fw.get(f["id"]))
        rec = {"id": f["id"], "date": f["date"], "year": int(f["date"][:4]), "event": f["event"], "K": f["rounds"],
               "seg": seg, "bout_order": (fw.get(f["id"]) or {}).get("bout_order"), "title": bool(f.get("title")),
               "mu": mu, "has": False}
        if rows:
            r0 = next(iter(rows.values()))
            a, b = f["A"]["name"], f["B"]["name"]
            s_keep = MK.name_sim(a, r0["t1"]) + MK.name_sim(b, r0["t2"])
            s_swap = MK.name_sim(a, r0["t2"]) + MK.name_sim(b, r0["t1"])
            sw = s_swap > s_keep
            fams = {bk: book_families(r, f["rounds"], sw) for bk, r in rows.items()}
            cons = consensus(fams, f["rounds"])
            rec.update(cons)
            rec["sw"] = sw
            rec["has"] = any(k in cons for k in ("m6", "gd", "er", "wr", "mr"))
            rec["books"] = sorted(rows)
            pc = mk.get(f["id"], {}).get("p_power_close")
            if pc is not None and "ml" in cons:
                rec["close"] = pc
                if abs(cons["ml"] - pc) > 0.25 and abs(1 - cons["ml"] - pc) < 0.10:
                    orient_flags.append(f["id"])
        tab[f["id"]] = rec
    # all bouts on the 2021-2025 cards (debut bouts included): coverage by card position via fightweek.json
    mus_by_date = defaultdict(list)
    for mu, rows in by_mu.items():
        r0 = next(iter(rows.values()))
        mus_by_date[r0["date"]].append((mu, r0["t1"], r0["t2"], rows))
    allb = []
    for fid, v in fw.items():
        if not ("2021-01-01" <= v["date"] < VAULT_S):
            continue
        na, nb = v["A"].replace("-", " "), v["B"].replace("-", " ")
        best = None
        d0 = dt.date.fromisoformat(v["date"])
        for dd in (0, 1, -1, 2, -2):
            for mu, t1, t2, rows in mus_by_date.get((d0 + dt.timedelta(days=dd)).isoformat(), []):
                s = max(min(MK.name_sim(na, t1), MK.name_sim(nb, t2)), min(MK.name_sim(na, t2), MK.name_sim(nb, t1)))
                if s >= 0.8 and (best is None or s > best[0]):
                    best = (s, mu, rows)
            if best:
                break
        has_m6 = has_rd = False
        if best:
            K = 5 if (v.get("title") or (v.get("bout_order") == 1 and "Fight Night" in v.get("event", ""))) else 3
            for bk, r in best[2].items():
                ff = book_families(r, K, False)
                has_m6 = has_m6 or "m6" in ff
                has_rd = has_rd or "er" in ff or "wr" in ff
        allb.append({"id": fid, "year": int(v["date"][:4]), "seg": seg_of(v), "debut": fid not in tab,
                     "matched": bool(best), "m6": has_m6, "round": has_rd})
    pickle.dump({"tab": tab, "allb": allb, "orient_flags": orient_flags}, open(os.path.join(CACHE, "table.pkl"), "wb"))
    n = Counter((r["year"], "m6" in r, "er" in r or "wr" in r) for r in tab.values())
    log("table: %d dev fights; props by (year, m6, round): %s; orientation flags %d" % (len(tab), sorted(n.items()),
                                                                                      len(orient_flags)))


# ====================================================================== cells: S / S2 / SM / S2+ml2win per fold
@stage("cells")
def stage_cells(args):
    """tools/ml2.py's method stage, re-run to keep every fold's cells (ml2 stores only the 2024-25 ones): validation
    years 2020-2023 are out-of-fold (fit on 2012..Y-1, hazard on 2008..Y-1), 2024-2025 come from the fit through
    2023. Same hyperparameters as ml2.json `method` (S2 C6) and methodround.json `meta.chosen` (S, SM, hazard,
    draw share). Importing ml2 first wraps build_db.parse_fights so every 2026+ fight is dropped at parse."""
    import numpy as np
    import pandas as pd
    import ml2
    import methodround as MR
    t0 = time.time()
    S = ml2.load_table()
    T2 = S["df"]
    F = pickle.load(open(os.path.join(ml2.CACHE, "fit.pkl"), "rb"))
    C = json.load(open(os.path.join(ml2.CACHE, "cv.json")))
    D = MR.prepare(False)
    T, FX, FY, y = D["T"], D["FX"], D["FY"], D["y"]
    assert T["date"].max() < VAULT, "a 2026 fight reached the method table"
    log("cells: methodround table %d rows (%.0f s)" % (len(T), time.time() - t0))
    ch = jload("methodround.json")["meta"]["chosen"]
    c6_s2 = jload("ml2.json")["method"]["chosen_C6_S2"]
    draw_c = ch["draw_c"]
    nX, nY, pwin, okz = ml2.method_new_cols(T, T2, F, C["lr"]["tau"], C["pre_means"])
    FX2, FY2 = pd.concat([FX, nX], axis=1), pd.concat([FY, nY], axis=1)
    stat, new = D["stat_cols"], list(nX.columns)
    folds = list(MR.VALID_YEARS) + [2024]
    H = np.zeros((len(T), MR.NC_))
    for v in folds:
        tr = ((T["year"] < v) & (T["year"] >= MR.HAZ_START)).to_numpy()
        va = (T["year"] == v).to_numpy() if v < 2024 else (T["year"] >= 2024).to_numpy()
        hz = MR.HazardModel(MR.HAZ_COLS, C=ch["C_haz"], C_dec=MR.C_DEC).fit(T[tr], FX[tr], FY[tr], y[tr])
        H[va] = hz.predict(T[va], FX[va], FY[va])
    log("cells: hazard folds done (%.0f s)" % (time.time() - t0))

    def run6(cols, Cc, start, fxx, fyy, win_cols=None, C_win=None):
        P6 = np.full((len(T), 6), np.nan)
        for v in folds:
            tr = ((T["year"] < v) & (T["year"] >= start)).to_numpy()
            va = (T["year"] == v).to_numpy() if v < 2024 else (T["year"] >= 2024).to_numpy()
            m = MR.C6Logit(cols, C=Cc, hl_years=MR.HL_YEARS).fit(T[tr], fxx[tr], fyy[tr], y[tr])
            P6[va] = m.predict6(T[va], fxx[va], fyy[va])
            if win_cols:
                w = MR.WinLogit(win_cols, C=C_win, hl_years=MR.HL_YEARS).fit(T[tr], fxx[tr], fyy[tr], y[tr])
                P6[va] = MR.reweight_winner(P6[va], w.predict_pa(fxx[va], fyy[va]))
        return P6
    P6 = {}
    P6["S"] = run6(stat, ch["C6_S"], 2012, FX, FY)
    log("cells: S done (%.0f s)" % (time.time() - t0))
    P6["S2"] = run6(stat + new, c6_s2, 2012, FX2, FY2)
    log("cells: S2 done (%.0f s)" % (time.time() - t0))
    P6["SM"] = run6(stat + MR.MARKET_COLS, ch["C6_SM"], 2013, FX, FY, stat + MR.MARKET_COLS, ch["C_win"])
    log("cells: SM done (%.0f s)" % (time.time() - t0))
    P6["S2+ml2win"] = MR.reweight_winner(P6["S2"], pwin)
    keep = (T["year"] >= 2019).to_numpy()
    J = {k: MR.joint_from_c6(v, H, draw_c)[keep] for k, v in P6.items()}
    out = {"ids": T["id"].to_numpy()[keep], "date": T["date"].astype(str).to_numpy()[keep],
           "year": T["year"].to_numpy()[keep], "event": T["event"].to_numpy()[keep],
           "rounds": T["rounds"].to_numpy()[keep], "y": y[keep], "P6": {k: v[keep] for k, v in P6.items()},
           "H": H[keep], "J": J, "pwin": pwin[keep], "PMK": D["PMK"][keep], "pm": D["pm"].to_numpy()[keep],
           "draw_c": draw_c, "C6_S2": c6_s2, "chosen": ch}
    # reproduction check against ml2's stored 2024-25 cells of the chosen variant (S2+ml2win)
    ref = json.load(open(os.path.join(ml2.CACHE, "method.json"))).get("_pred_test", {})
    pos = {f: i for i, f in enumerate(out["ids"])}
    diffs = [np.max(np.abs(np.asarray(v) - J["S2+ml2win"][pos[f]])) for f, v in ref.items() if f in pos]
    out["repro_max_abs_vs_ml2"] = float(max(diffs)) if diffs else None
    pickle.dump(out, open(os.path.join(CACHE, "cells.pkl"), "wb"))
    vm = np.isin(T["year"].to_numpy(), MR.VALID_YEARS)
    s_ = MR.summarize_losses(MR.losses_on(MR.joint_from_c6(P6["S2+ml2win"], H, draw_c)[vm], D, vm))
    log("cells: S2+ml2win CV 2020-23 joint %.5f method3 %.5f bin7 %.5f (ml2.json: 2.1407 / 0.9595 / 1.6064); "
        "repro vs ml2 2024-25 cells max |diff| %s (%.0f s)" % (s_["joint"], s_["method3"], s_["bin7"],
                                                              out["repro_max_abs_vs_ml2"], time.time() - t0))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("stage", choices=sorted(STAGES) + ["all"])
    ap.add_argument("--delay", type=float, default=2.5, help="seconds between BFO requests (>= 2)")
    ap.add_argument("--boot", type=int, default=2000)
    ap.add_argument("--until", default=None, help="capture: last card date (default today + 14 days)")
    ap.add_argument("--replay", default=None, help="capture: rebuild a snapshot from its cached raw pages")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    order = ["extract", "table", "cells", "winner", "cv", "export"]
    for st in (order if args.stage == "all" else [args.stage]):
        STAGES[st](args)


if __name__ == "__main__":
    main()
