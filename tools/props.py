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


# ====================================================================== winner: the fixed winner models
@stage("winner")
def stage_winner(args):
    """W_ml2 = the ML v2 blend that S2+ml2win uses (annual OOF 2019-2023, fit through 2023 for 2024-25).
    W_close = cycle 1's close-regime stack, market (power de-vig consensus close) + ML v2, no intercept,
    non-negative logit weights (tools/ml2.py stack_fit, h = none as ml2 chose), forward-chained: year Y fit on
    2019..Y-1, 2024-2025 fit on 2019-2023. Fights without a close keep W_ml2."""
    import numpy as np
    import ml2
    c = pickle.load(open(os.path.join(CACHE, "cells.pkl"), "rb"))
    mk = jload("market.json")["fights"]
    ids, yr = c["ids"], c["year"]
    pml2 = np.asarray(c["pwin"], float)
    m2 = ml2.dev_only(jload("ml2.json")["fights"])
    chk = [abs(m2[i]["ml2"] - p) for i, p in zip(ids, pml2) if i in m2 and m2[i].get("ml2") is not None]
    pc = np.array([mk.get(i, {}).get("p_power_close", np.nan) if mk.get(i, {}).get("p_power_close") is not None
                   else np.nan for i in ids], float)
    ywin = winner_of(c["y"])
    Z = np.c_[ml2.logit(np.clip(np.nan_to_num(pc, nan=0.5), 0.01, 0.99), 1e-6), ml2.logit(np.clip(pml2, 0.01, 0.99), 1e-6)]
    has = ~np.isnan(pc)
    W = pml2.copy()
    wts = {}
    for Y in (2020, 2021, 2022, 2023, 2024):
        tr = has & (ywin >= 0) & (yr >= 2019) & (yr < Y)
        b = ml2.stack_fit(Z[tr], ywin[tr].astype(float))
        pr = (yr == Y) if Y < 2024 else (yr >= 2024)
        W[pr & has] = ml2.sig(Z[pr & has] @ b)
        wts[str(Y) if Y < 2024 else "2024-25"] = [round(float(x), 4) for x in b]
    sym = float(np.max(np.abs(ml2.sig(-Z[has] @ np.array(wts["2024-25"])) - (1 - ml2.sig(Z[has] @ np.array(wts["2024-25"]))))))
    out = {"ids": ids, "W_ml2": pml2, "W_close": W, "p_close": pc, "weights": wts, "ml2_json_max_abs": max(chk),
           "corner_swap_max": sym}
    pickle.dump(out, open(os.path.join(CACHE, "winner.pkl"), "wb"))
    ok = (ywin >= 0) & has
    for name, P in (("W_ml2", pml2), ("W_close", W), ("close", np.nan_to_num(pc, nan=0.5))):
        for lo, hi in ((2021, 2023), (2024, 2025)):
            m = ok & (yr >= lo) & (yr <= hi)
            if lo == 2024:
                continue          # never printed here: 2024-25 is scored once by `valid`
            log("winner %-8s %d-%d n=%d log loss %.5f" % (name, lo, hi, m.sum(), ml2.ll(P[m], ywin[m])))
    log("winner: stack weights [market, ml2] by fit year %s; ml2.json match %.1e; swap %.1e" % (wts, max(chk), sym))


# ====================================================================== pool machinery
R5 = 5
I_XKO, I_XSUB, I_YKO, I_YSUB, I_XDEC, I_YDEC, I_DRAW = 0, 5, 10, 15, 20, 21, 22
NC = 23
CLS = ("KO", "SUB", "DEC")


def winner_of(y):
    import numpy as np
    y = np.asarray(y)
    w = np.full(len(y), -1)
    w[((y >= I_XKO) & (y < I_XSUB + R5)) | (y == I_XDEC)] = 1
    w[((y >= I_YKO) & (y < I_YSUB + R5)) | (y == I_YDEC)] = 0
    return w                       # 1 = A won, 0 = B won, -1 = draw / excluded


def outcome_parts(y):
    """-> side (0 = A, 1 = B, -1), method (0 KO, 1 SUB, 2 DEC, -1), round index (0-based, -1 if no finish)."""
    import numpy as np
    y = np.asarray(y)
    side = np.full(len(y), -1)
    meth = np.full(len(y), -1)
    rnd = np.full(len(y), -1)
    for base, s, m in ((I_XKO, 0, 0), (I_XSUB, 0, 1), (I_YKO, 1, 0), (I_YSUB, 1, 1)):
        k = (y >= base) & (y < base + R5)
        side[k], meth[k], rnd[k] = s, m, y[k] - base
    side[y == I_XDEC], meth[y == I_XDEC] = 0, 2
    side[y == I_YDEC], meth[y == I_YDEC] = 1, 2
    return side, meth, rnd


def cond_from_p6(P6):
    """6-class [XKO, XSUB, XDEC, YDEC, YSUB, YKO] -> method | winner, n x 2 (side A, B) x 3 (KO, SUB, DEC)."""
    import numpy as np
    A = P6[:, [0, 1, 2]]
    B = P6[:, [5, 4, 3]]
    M = np.stack([A / A.sum(1, keepdims=True), B / B.sum(1, keepdims=True)], 1)
    return M


def cond_from_joint(J):
    """23-cell joint -> (method | winner n x 2 x 3, round | side, method n x 2 x 2 x 5)."""
    import numpy as np
    n = len(J)
    M = np.zeros((n, 2, 3))
    R = np.zeros((n, 2, 2, R5))
    for s, (bko, bsub, bdec) in enumerate(((I_XKO, I_XSUB, I_XDEC), (I_YKO, I_YSUB, I_YDEC))):
        ko, sub = J[:, bko:bko + R5], J[:, bsub:bsub + R5]
        tot = ko.sum(1) + sub.sum(1) + J[:, bdec]
        M[:, s] = np.c_[ko.sum(1), sub.sum(1), J[:, bdec]] / np.maximum(tot, 1e-12)[:, None]
        R[:, s, 0] = ko / np.maximum(ko.sum(1, keepdims=True), 1e-12)
        R[:, s, 1] = sub / np.maximum(sub.sum(1, keepdims=True), 1e-12)
    return M, R


def round_shapes_from_H(H):
    import numpy as np
    _, R = cond_from_joint(H)
    return R


def props_cond(rec, K, rep_m="m6", rep_r="er"):
    """Props-implied method | winner (2 x 3) and round | side, method (2 x 2 x 5), or None where the family is absent.
    rep_m: 'm6' (method six-way) or 'm6_gd' (m6 with its decision cells rescaled so that P(decision) = the mean of m6
    and goes-to-decision). rep_r: 'er' (fight ends in round k: unsided), 'wr' (fighter wins in round k: per side),
    'best' (mr > wr > er: the most specific family quoted)."""
    import numpy as np
    M = R = None
    m6 = rec.get("m6")
    if m6 is not None:
        v = np.asarray(m6, float)
        if rep_m == "m6_gd" and rec.get("gd") is not None:
            pd_m6 = v[2] + v[5]
            tgt = 0.5 * (pd_m6 + rec["gd"])
            v = v.copy()
            v[[2, 5]] *= tgt / pd_m6
            v[[0, 1, 3, 4]] *= (1 - tgt) / (1 - pd_m6)
        A, B = v[:3], v[3:][[0, 1, 2]]
        M = np.stack([A / A.sum(), B / B.sum()])
    order = {"er": ("er",), "wr": ("wr",), "best": ("mr", "wr", "er")}[rep_r]
    for fam in order:
        f = rec.get(fam)
        if f is None:
            continue
        f = np.asarray(f, float)
        R = np.zeros((2, 2, R5))
        if fam == "er":
            sh = f[:K] / f[:K].sum()
            R[:, :, :K] = sh
        elif fam == "wr":
            for s in (0, 1):
                sh = f[s * K:(s + 1) * K]
                R[s, :, :K] = sh / sh.sum()
        else:  # mr: [A KO r, A SUB r, B KO r, B SUB r, A dec, B dec]
            for s in (0, 1):
                for m in (0, 1):
                    sh = f[(2 * s + m) * K:(2 * s + m + 1) * K]
                    R[s, m, :K] = sh / sh.sum()
        break
    return M, R


def compose(W, M, R, K, draw_c):
    """Winner W = P(A) (n), method | winner M (n x 2 x 3), round | side, method R (n x 2 x 2 x 5), rounds K (n) ->
    23-cell joint. The draw takes draw_c of the decision mass; every non-draw cell is scaled by (1 - draw), so the
    joint's P(A) / (P(A) + P(B)) equals W exactly (the winner stays bit-identical across packages)."""
    import numpy as np
    n = len(W)
    P = np.zeros((n, NC))
    Wm = np.c_[W, 1 - W]
    D = Wm[:, 0] * M[:, 0, 2] + Wm[:, 1] * M[:, 1, 2]
    draw = draw_c * D
    nd = 1 - draw
    for s, (bko, bsub, bdec) in enumerate(((I_XKO, I_XSUB, I_XDEC), (I_YKO, I_YSUB, I_YDEC))):
        ws = (nd * Wm[:, s])[:, None]
        P[:, bko:bko + R5] = ws * M[:, s, [0]] * R[:, s, 0]
        P[:, bsub:bsub + R5] = ws * M[:, s, [1]] * R[:, s, 1]
        P[:, bdec] = ws[:, 0] * M[:, s, 2]
    P[:, I_DRAW] = draw
    kk = np.asarray(K) == 3
    P[kk, 3:5] = P[kk, 8:10] = P[kk, 13:15] = P[kk, 18:20] = 0.0
    return P / P.sum(1, keepdims=True)


def mirror(P):
    import numpy as np
    Q = np.empty_like(P)
    Q[:, I_XKO:I_XKO + R5], Q[:, I_YKO:I_YKO + R5] = P[:, I_YKO:I_YKO + R5], P[:, I_XKO:I_XKO + R5]
    Q[:, I_XSUB:I_XSUB + R5], Q[:, I_YSUB:I_YSUB + R5] = P[:, I_YSUB:I_YSUB + R5], P[:, I_XSUB:I_XSUB + R5]
    Q[:, I_XDEC], Q[:, I_YDEC], Q[:, I_DRAW] = P[:, I_YDEC], P[:, I_XDEC], P[:, I_DRAW]
    return Q


def pool_method(Ms, alpha, beta):
    """Log-linear pool of method | winner experts: log p ∝ sum_j alpha_j log M_j + beta (beta = [0, b_sub, b_dec],
    shared by both sides, so the pool is corner-symmetric)."""
    import numpy as np
    s = sum(a * np.log(np.clip(M, 1e-6, 1)) for a, M in zip(alpha, Ms)) + np.asarray(beta)[None, None, :]
    s -= s.max(-1, keepdims=True)
    e = np.exp(s)
    return e / e.sum(-1, keepdims=True)


def pool_round(Rs, gamma, delta, K):
    """Log-linear pool of round | side, method shapes: log p ∝ sum_j gamma_j log R_j + delta_K (round biases by
    format, delta[K][0] = 0), rounds past K masked."""
    import numpy as np
    K = np.asarray(K)
    s = sum(g * np.log(np.clip(R, 1e-6, 1)) for g, R in zip(gamma, Rs))
    if delta is not None:
        for k_ in (3, 5):
            m = K == k_
            s[m] = s[m] + np.asarray(delta[k_])[None, None, :]
    mask = np.arange(R5)[None, :] >= K[:, None]
    s = np.where(mask[:, None, None, :], -1e9, s)
    s -= s.max(-1, keepdims=True)
    e = np.exp(s)
    e = np.where(mask[:, None, None, :], 0.0, e)
    return e / e.sum(-1, keepdims=True)


def fit_method_pool(Ms, side, meth, n_exp, bias=("dec",)):
    """MLE of (alpha >= 0, beta) on method given the actual winner. bias: subset of ('sub', 'dec')."""
    import numpy as np
    from scipy.optimize import minimize
    ix = np.arange(len(side))
    L = [np.log(np.clip(M[ix, side], 1e-6, 1)) for M in Ms]   # n x 3 for the winner's side
    nb = len(bias)

    def unpack(th):
        a = th[:n_exp]
        b = np.zeros(3)
        for j, nm in enumerate(bias):
            b[1 if nm == "sub" else 2] = th[n_exp + j]
        return a, b

    def f(th):
        a, b = unpack(th)
        s = sum(a_ * l for a_, l in zip(a, L)) + b
        s -= s.max(1, keepdims=True)
        lse = np.log(np.exp(s).sum(1))
        return float(np.mean(lse - s[ix, meth]))
    th0 = np.r_[np.full(n_exp, 1.0 / n_exp), np.zeros(nb)]
    r = minimize(f, th0, method="L-BFGS-B", bounds=[(0, 5)] * n_exp + [(-3, 3)] * nb)
    a, b = unpack(r.x)
    return a, b


def fit_round_pool(Rs, side, meth, rnd, K, n_exp, with_delta=False):
    import numpy as np
    from scipy.optimize import minimize
    ix = np.arange(len(side))
    L = [np.log(np.clip(R[ix, side, meth], 1e-6, 1)) for R in Rs]   # n x 5
    K = np.asarray(K)
    mask = np.arange(R5)[None, :] >= K[:, None]

    def unpack(th):
        g = th[:n_exp]
        if not with_delta:
            return g, None
        d3 = np.r_[0.0, th[n_exp:n_exp + 2], 0.0, 0.0]
        d5 = np.r_[0.0, th[n_exp + 2:n_exp + 6]]
        return g, {3: d3, 5: d5}

    def f(th):
        g, d = unpack(th)
        s = sum(g_ * l for g_, l in zip(g, L))
        if d is not None:
            s = s + np.where((K == 3)[:, None], d[3][None, :], d[5][None, :])
        s = np.where(mask, -1e9, s)
        s -= s.max(1, keepdims=True)
        lse = np.log(np.where(mask, 0, np.exp(s)).sum(1))
        return float(np.mean(lse - s[ix, rnd]))
    nd = 6 if with_delta else 0
    th0 = np.r_[np.full(n_exp, 1.0 / n_exp), np.zeros(nd)]
    r = minimize(f, th0, method="L-BFGS-B", bounds=[(0, 5)] * n_exp + [(-3, 3)] * nd)
    return unpack(r.x)


# ====================================================================== assembly for CV / valid / export
METRICS = ["joint", "method3", "finish", "bin7", "method_round", "round_given_fin", "ko_vs_sub", "method_given_winner",
           "winner"]
A_MARKET = 0.6                    # methodround.json meta.chosen.a_market: the current 40/60 blend (chosen 2021-2023)
_ASM = {}


def assemble(rep_m="m6", rep_r="er"):
    """Rows: every backtest fight 2021-2025 in the method table. Experts: method | winner (n x 2 x 3) and round |
    side, method (n x 2 x 2 x 5) for S2, SM, S, the props (nan where absent) and the current 40/60 blend."""
    import numpy as np
    key = (rep_m, rep_r)
    if key in _ASM:
        return _ASM[key]
    c = pickle.load(open(os.path.join(CACHE, "cells.pkl"), "rb"))
    w = pickle.load(open(os.path.join(CACHE, "winner.pkl"), "rb"))
    tab = pickle.load(open(os.path.join(CACHE, "table.pkl"), "rb"))["tab"]
    assert list(w["ids"]) == list(c["ids"])
    keep = (c["year"] >= 2021) & np.array([d < VAULT_S for d in c["date"]])
    ids = c["ids"][keep]
    n = len(ids)
    K = np.where(c["rounds"][keep] == 5, 5, 3)
    A = {"ids": ids, "year": c["year"][keep], "date": c["date"][keep], "event": c["event"][keep], "K": K,
         "y": c["y"][keep], "W_close": w["W_close"][keep], "W_ml2": w["W_ml2"][keep], "draw_c": c["draw_c"]}
    A["side"], A["meth"], A["rnd"] = outcome_parts(A["y"])
    Rh = round_shapes_from_H(c["H"][keep])
    A["M"] = {k: cond_from_p6(c["P6"][k][keep]) for k in ("S2", "SM", "S")}
    A["R"] = {"S2": Rh}
    J = {k: v[keep] for k, v in c["J"].items()}
    PMK = c["PMK"][keep]
    hp = ~np.isnan(PMK[:, 0])
    B46 = J["S2+ml2win"].copy()
    B46[hp] = (1 - A_MARKET) * J["S2+ml2win"][hp] + A_MARKET * PMK[hp]
    A["J_pub"] = {"S2+ml2win": J["S2+ml2win"], "props (market.json)": np.where(hp[:, None], PMK, np.nan),
                  "40/60 blend (current)": B46}
    A["has_pmk"] = hp
    Mb, Rb = cond_from_joint(B46)
    A["M"]["B46"], A["R"]["B46"] = Mb, Rb
    Mp = np.full((n, 2, 3), np.nan)
    Rp = np.full((n, 2, 2, R5), np.nan)
    seg, nb, recs = [], [], []
    for i, fid in enumerate(ids):
        rec = tab.get(fid, {})
        recs.append(rec)
        seg.append(rec.get("seg", "unknown"))
        nb.append(max((rec.get("n_books") or {}).values() or [0]))
        if rec.get("has"):
            m, r = props_cond(rec, int(K[i]), rep_m, rep_r)
            if m is not None:
                Mp[i] = m
            if r is not None:
                Rp[i] = r
    A["M"]["P"], A["R"]["P"] = Mp, Rp
    A["hasM"] = ~np.isnan(Mp[:, 0, 0])
    A["hasR"] = ~np.isnan(Rp[:, 0, 0, 0])
    A["seg"], A["n_books"], A["recs"] = np.array(seg), np.array(nb), recs
    # props-alone joint (own winner from m6): m6 (+ the model's draw share) spread by the props' round shapes,
    # S2's shapes where no round family is quoted
    Pj = np.full((n, NC), np.nan)
    for i in np.flatnonzero(A["hasM"]):
        m6 = np.asarray(recs[i]["m6"], float)
        pa = m6[:3].sum() / m6.sum()
        Rr = Rp[i:i + 1] if A["hasR"][i] else Rh[i:i + 1]
        Pj[i] = compose(np.array([pa]), Mp[i:i + 1], Rr, K[i:i + 1], A["draw_c"])[0]
    A["J_pub"]["props alone (this extract)"] = Pj
    _ASM[key] = A
    return A


def losses(P, y):
    import methodround as MR
    import numpy as np
    return MR.per_fight_losses(np.asarray(P, float), np.asarray(y), None)


class Spec:
    """A pool configuration: method experts + biases, round experts + format biases, props representations."""

    def __init__(self, name, m_exp=("S2",), m_bias=(), r_exp=("S2",), r_delta=False, rep_m="m6", rep_r="er"):
        self.name, self.m_exp, self.m_bias, self.r_exp = name, tuple(m_exp), tuple(m_bias), tuple(r_exp)
        self.r_delta, self.rep_m, self.rep_r = r_delta, rep_m, rep_r

    def as_dict(self):
        return {"name": self.name, "m_exp": list(self.m_exp), "m_bias": list(self.m_bias), "r_exp": list(self.r_exp),
                "r_delta": self.r_delta, "rep_m": self.rep_m, "rep_r": self.rep_r}

    def fixed(self):
        """Specs without fitted parameters (a single expert taken as is)."""
        return len(self.m_exp) == 1 and not self.m_bias and len(self.r_exp) == 1 and not self.r_delta

    def fit(self, A, tr):
        import numpy as np
        par = {"alpha": [1.0] * len(self.m_exp), "beta": [0.0, 0.0, 0.0], "gamma": [1.0] * len(self.r_exp),
               "delta": None}
        mm = tr & (A["side"] >= 0)
        if "P" in self.m_exp:
            mm = mm & A["hasM"]
        if len(self.m_exp) > 1 or self.m_bias:
            a, b = fit_method_pool([A["M"][e][mm] for e in self.m_exp], A["side"][mm], A["meth"][mm],
                                   len(self.m_exp), self.m_bias)
            par["alpha"], par["beta"] = [float(x) for x in a], [float(x) for x in b]
        rr = tr & (A["rnd"] >= 0)
        if "P" in self.r_exp:
            rr = rr & A["hasR"]
        if len(self.r_exp) > 1 or self.r_delta:
            g, d = fit_round_pool([A["R"][e][rr] for e in self.r_exp], A["side"][rr], A["meth"][rr], A["rnd"][rr],
                                  A["K"][rr], len(self.r_exp), self.r_delta)
            par["gamma"] = [float(x) for x in g]
            par["delta"] = None if d is None else {k: [float(x) for x in v] for k, v in d.items()}
        par["n_fit_method"], par["n_fit_round"] = int(mm.sum()), int(rr.sum())
        return par

    def predict(self, A, rows, par):
        """method | winner and round shapes for `rows`; a part whose props are absent falls back to S2 (degrade)."""
        import numpy as np
        M = A["M"]["S2"][rows].copy()
        R = A["R"]["S2"][rows].copy()
        okm = np.ones(rows.sum(), bool) if "P" not in self.m_exp else A["hasM"][rows]
        if okm.any():
            Ms = [A["M"][e][rows][okm] for e in self.m_exp]
            M[okm] = pool_method(Ms, par["alpha"], par["beta"]) if (len(Ms) > 1 or self.m_bias) else Ms[0]
        okr = np.ones(rows.sum(), bool) if "P" not in self.r_exp else A["hasR"][rows]
        if okr.any():
            Rs = [A["R"][e][rows][okr] for e in self.r_exp]
            R[okr] = pool_round(Rs, par["gamma"], par["delta"], A["K"][rows][okr]) \
                if (len(Rs) > 1 or self.r_delta) else Rs[0]
        return M, R


def predict_folds(A, spec, folds):
    """folds: list of (fit_mask, pred_mask). Returns M, R filled on the predicted rows and the fitted params."""
    import numpy as np
    n = len(A["ids"])
    M = np.full((n, 2, 3), np.nan)
    R = np.full((n, 2, 2, R5), np.nan)
    pars = []
    for tr, pr in folds:
        par = spec.fit(A, tr)
        m, r = spec.predict(A, pr, par)
        M[pr], R[pr] = m, r
        pars.append(par)
    return M, R, pars


def fwd_folds(A, years=CV_YEARS, first=2021):
    return [((A["year"] >= first) & (A["year"] < Y), A["year"] == Y) for Y in years]


def loyo_folds(A, years=PROP_YEARS):
    return [((A["year"] != Y) & (A["year"] >= years[0]) & (A["year"] <= years[-1]), A["year"] == Y) for Y in years]


def score_table(A, mask, joints, ref, B=2000, seed=11):
    """Mean losses with event-cluster CIs on `mask`, paired differences against `ref`."""
    import methodround as MR
    import numpy as np
    L = {k: losses(P[mask], A["y"][mask]) for k, P in joints.items()}
    bt, st = MR.cluster_bootstrap(L, A["event"][mask], B=B, seed=seed)
    out = {"n": int(mask.sum()), "means": bt, "paired_vs_" + ref: {}}
    for k in joints:
        if k != ref:
            out["paired_vs_" + ref][k] = MR.paired_diff(L[k], L[ref], st, METRICS)
    return out, L, st


def p_decision(P):
    return P[:, I_XDEC] + P[:, I_YDEC] + P[:, I_DRAW]


# ====================================================================== reports: coverage, consistency, families
def coverage_report():
    import numpy as np
    T = pickle.load(open(os.path.join(CACHE, "table.pkl"), "rb"))
    tab, allb = T["tab"], T["allb"]
    out = {"backtest": {}, "all_bouts": {}, "orientation_flags": len(T["orient_flags"])}
    rows = [r for r in tab.values() if r["year"] >= 2021]
    for grp in ("year", "seg"):
        g = defaultdict(list)
        for r in rows:
            g[str(r[grp])].append(r)
        out["backtest"][grp] = {k: {"n": len(v), "m6": round(np.mean(["m6" in r for r in v]), 3),
                                    "gd": round(np.mean(["gd" in r for r in v]), 3),
                                    "er": round(np.mean(["er" in r for r in v]), 3),
                                    "wr": round(np.mean(["wr" in r for r in v]), 3),
                                    "mr": round(np.mean(["mr" in r for r in v]), 3),
                                    "itd": round(np.mean(["itd" in r for r in v]), 3),
                                    "ou": round(np.mean(["ou" in r for r in v]), 3),
                                    "mean_books_m6": round(float(np.mean([r["n_books"].get("m6", 0) for r in v
                                                                          if "m6" in r] or [0])), 2)}
                                for k, v in sorted(g.items())}
    g = defaultdict(list)
    for r in allb:
        g[(r["seg"], "debut" if r["debut"] else "backtest")].append(r)
    out["all_bouts"]["by_segment"] = {"%s|%s" % k: {"n": len(v), "matched": round(np.mean([r["matched"] for r in v]), 3),
                                                   "m6": round(np.mean([r["m6"] for r in v]), 3),
                                                   "round": round(np.mean([r["round"] for r in v]), 3)}
                                      for k, v in sorted(g.items())}
    g = defaultdict(list)
    for r in allb:
        g[r["seg"]].append(r)
    out["all_bouts"]["segment_totals"] = {k: {"n": len(v), "m6": round(np.mean([r["m6"] for r in v]), 3),
                                              "round": round(np.mean([r["round"] for r in v]), 3)}
                                          for k, v in sorted(g.items())}
    return out


def pdec_of(rec, fam):
    if fam == "m6" and rec.get("m6") is not None:
        v = rec["m6"]
        dr = rec.get("m6_draw") or 0.0
        return (v[2] + v[5] + dr) / (sum(v) + dr)
    if fam == "gd":
        return rec.get("gd")
    if fam == "er" and rec.get("er") is not None:
        return rec["er"][-1]
    if fam == "wr" and rec.get("wr") is not None:
        return rec["wr"][-1] + rec["wr"][-2]
    return None


def consistency_report():
    """Outcome-free agreement between prop families on the same bouts (all development rows 2021-2025)."""
    import numpy as np
    tab = pickle.load(open(os.path.join(CACHE, "table.pkl"), "rb"))["tab"]
    rows = [r for r in tab.values() if r.get("has")]
    out = {}
    pairs = [("m6", "gd"), ("m6", "er"), ("m6", "wr"), ("gd", "er"), ("er", "wr")]
    for a, b in pairs:
        v = [(pdec_of(r, a), pdec_of(r, b)) for r in rows]
        v = np.array([x for x in v if x[0] is not None and x[1] is not None])
        if len(v):
            out["p_decision %s vs %s" % (a, b)] = {"n": len(v), "mean_abs_diff": round(float(np.mean(np.abs(v[:, 0] - v[:, 1]))), 4),
                                                   "mean_diff": round(float(np.mean(v[:, 0] - v[:, 1])), 4),
                                                   "corr": round(float(np.corrcoef(v.T)[0, 1]), 4)}
    # P(A wins): method six-way vs the page moneyline (same books) and vs fighter-wins-in-round
    v = np.array([(sum(r["m6"][:3]) / sum(r["m6"]), r["ml"]) for r in rows if r.get("m6") and r.get("ml") is not None])
    out["p_A m6 vs moneyline"] = {"n": len(v), "mean_abs_diff": round(float(np.mean(np.abs(v[:, 0] - v[:, 1]))), 4),
                                  "corr": round(float(np.corrcoef(v.T)[0, 1]), 4)}
    v = np.array([(sum(r["m6"][:3]) / sum(r["m6"]), (sum(r["wr"][:r["K"]]) + r["wr"][2 * r["K"]]) / sum(r["wr"]))
                  for r in rows if r.get("m6") and r.get("wr")])
    if len(v):
        out["p_A m6 vs wr"] = {"n": len(v), "mean_abs_diff": round(float(np.mean(np.abs(v[:, 0] - v[:, 1]))), 4),
                               "corr": round(float(np.corrcoef(v.T)[0, 1]), 4)}
    # inside the distance: m6 (KO + SUB) vs the two-way ITD market
    v = []
    for r in rows:
        if r.get("m6") and r.get("itd"):
            s6 = sum(r["m6"]) + (r.get("m6_draw") or 0)
            for j, idx in ((0, (0, 1)), (1, (3, 4))):
                if r["itd"][j] is not None:
                    v.append(((r["m6"][idx[0]] + r["m6"][idx[1]]) / s6, r["itd"][j]))
    v = np.array(v)
    if len(v):
        out["p_inside_distance m6 vs itd"] = {"n": len(v), "mean_abs_diff": round(float(np.mean(np.abs(v[:, 0] - v[:, 1]))), 4),
                                              "mean_diff": round(float(np.mean(v[:, 0] - v[:, 1])), 4),
                                              "corr": round(float(np.corrcoef(v.T)[0, 1]), 4)}
    # finishing-round shape: fight ends in round k vs fighter wins in round k (summed over sides)
    d = []
    for r in rows:
        if r.get("er") and r.get("wr"):
            K = r["K"]
            a = np.asarray(r["er"][:K]) / sum(r["er"][:K])
            w = np.asarray(r["wr"][:K]) + np.asarray(r["wr"][K:2 * K])
            d.append(np.abs(a - w / w.sum()).sum())
    if d:
        out["round_shape er vs wr (L1)"] = {"n": len(d), "mean": round(float(np.mean(d)), 4),
                                            "p90": round(float(np.percentile(d, 90)), 4)}
    # over/under k.5 rounds vs the round props' bounds: P(over 1.5) lies in [1 - er1 - er2, 1 - er1]
    ok = tot = 0
    for r in rows:
        if r.get("er") and (r.get("ou") or {}).get("15") is not None:
            lo, hi = 1 - r["er"][0] - r["er"][1], 1 - r["er"][0]
            tot += 1
            ok += lo - 0.02 <= r["ou"]["15"] <= hi + 0.02
    if tot:
        out["over_1.5 within the er bounds (+-0.02)"] = {"n": tot, "share": round(ok / tot, 4)}
    return out


def family_scores(lo=2021, hi=2023):
    """Outcome-based comparison of the families on the tuning years only (2021-2023)."""
    import ml2
    import numpy as np
    A = assemble()
    out = {}
    m = (A["year"] >= lo) & (A["year"] <= hi) & (A["y"] >= 0)
    rec = A["recs"]
    isdec = np.isin(A["y"], [I_XDEC, I_YDEC, I_DRAW])
    fams = ["m6", "gd", "er", "wr"]
    P = {f: np.array([pdec_of(rec[i], f) if rec[i] else None for i in range(len(rec))], dtype=float) for f in fams}
    com = m & np.all([~np.isnan(P[f]) for f in fams], axis=0)
    S2d = A["M"]["S2"]
    pd_s2 = A["W_close"] * S2d[:, 0, 2] + (1 - A["W_close"]) * S2d[:, 1, 2]
    res = {"n": int(com.sum()), "observed": round(float(isdec[com].mean()), 4)}
    for f in fams + ["avg"]:
        p = np.mean([P[g] for g in fams], axis=0) if f == "avg" else P[f]
        res[f] = {"pred_mean": round(float(p[com].mean()), 4), "log_loss": round(ml2.ll(p[com], isdec[com]), 5)}
    res["S2 (W_close)"] = {"pred_mean": round(float(pd_s2[com].mean()), 4), "log_loss": round(ml2.ll(pd_s2[com], isdec[com]), 5)}
    out["p_decision"] = res
    # round given finish, per family
    fin = m & (A["rnd"] >= 0)
    ix = np.arange(len(A["ids"]))
    res = {}
    reps = {}
    for rep in ("er", "wr", "best"):
        B = assemble(rep_r=rep)
        reps[rep] = B["R"]["P"][ix, np.maximum(A["side"], 0), np.maximum(A["meth"], 0) % 2, np.maximum(A["rnd"], 0)]
    reps["S2"] = A["R"]["S2"][ix, np.maximum(A["side"], 0), np.maximum(A["meth"], 0) % 2, np.maximum(A["rnd"], 0)]
    com = fin & np.all([~np.isnan(v) for v in reps.values()], axis=0)
    res["n"] = int(com.sum())
    for k, v in reps.items():
        res[k] = round(float(np.mean(-np.log(np.clip(v[com], 1e-6, 1)))), 5)
    out["round_given_finish"] = res
    return out


# ====================================================================== cv: forward-chained 2022-2023
def cv_loss_method(A, spec, folds, rows):
    import numpy as np
    M, _, pars = predict_folds(A, spec, folds)
    ix = np.flatnonzero(rows)
    l = -np.log(np.clip(M[ix, A["side"][ix], A["meth"][ix]], 1e-9, 1))
    return float(l.mean()), l, pars


def cv_loss_round(A, spec, folds, rows):
    import numpy as np
    _, R, pars = predict_folds(A, spec, folds)
    ix = np.flatnonzero(rows)
    l = -np.log(np.clip(R[ix, A["side"][ix], A["meth"][ix], A["rnd"][ix]], 1e-9, 1))
    return float(l.mean()), l, pars


def select_sequence(A_of, seq, metric_fn, rows_fn, log_name):
    """Nested selection: each candidate is compared with the current choice; it replaces it only if the CV loss
    improves by more than SEL_MIN (0.0005)."""
    table, cur = [], None
    for spec, parent in seq:
        A = A_of(spec)
        folds = fwd_folds(A)
        rows = rows_fn(A)
        loss, _, pars = metric_fn(A, spec, folds, rows)
        row = {"spec": spec.name, "cv": round(loss, 5), "n": int(rows.sum()), "params_by_fold": pars}
        if cur is None:
            cur = (spec, loss)
            row["decision"] = "start"
        elif parent is None or parent == cur[0].name:
            if loss < cur[1] - SEL_MIN:
                row["decision"] = "accepted (%.5f < %.5f - %.4f)" % (loss, cur[1], SEL_MIN)
                cur = (spec, loss)
            else:
                row["decision"] = "rejected"
        else:
            row["decision"] = "skipped (parent %s not chosen)" % parent
        table.append(row)
        log("%s %-36s CV %.5f n=%d -> %s" % (log_name, spec.name, loss, rows.sum(), row["decision"]))
    return cur[0], table


@stage("cv")
def stage_cv(args):
    import numpy as np
    t0 = time.time()
    res = {"built": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
           "protocol": "forward-chained folds %s (fit on 2021..Y-1); LOYO 2021-2023 secondary; 0.0005 rule" % (CV_YEARS,)}
    res["coverage"] = coverage_report()
    res["consistency"] = consistency_report()
    res["families_tune_2021_2023"] = family_scores()
    log("cv: coverage / consistency / families done (%.0f s)" % (time.time() - t0))
    A_of = lambda s: assemble(s.rep_m, s.rep_r)          # noqa: E731
    fold_years = lambda A: np.isin(A["year"], CV_YEARS)  # noqa: E731
    rows_m = lambda A: fold_years(A) & (A["side"] >= 0) & A["hasM"]                         # noqa: E731
    rows_r = lambda A: fold_years(A) & (A["rnd"] >= 0) & A["hasR"] & A["hasM"]              # noqa: E731
    # --- method given the winner
    seq_m = [(Spec("S2"), None),
             (Spec("S2+P", m_exp=("S2", "P")), "S2"),
             (Spec("S2+P | dec", m_exp=("S2", "P"), m_bias=("dec",)), "S2+P"),
             (Spec("S2+P | dec, sub", m_exp=("S2", "P"), m_bias=("dec", "sub")), "S2+P | dec"),
             (Spec("S2+SM+P | dec", m_exp=("S2", "SM", "P"), m_bias=("dec",)), "S2+P | dec"),
             (Spec("S2+P | dec [m6_gd]", m_exp=("S2", "P"), m_bias=("dec",), rep_m="m6_gd"), "S2+P | dec")]
    best_m, tab_m = select_sequence(A_of, seq_m, cv_loss_method, rows_m, "method")
    # comparators (not candidates): props alone, the current 40/60 blend's conditionals
    comp = {}
    for spec in (Spec("P", m_exp=("P",), r_exp=("P",)), Spec("B46", m_exp=("B46",), r_exp=("B46",))):
        A = A_of(spec)
        comp[spec.name] = {"method_given_winner": round(cv_loss_method(A, spec, fwd_folds(A), rows_m(A))[0], 5),
                           "round_given_fin": round(cv_loss_round(A, spec, fwd_folds(A), rows_r(A))[0], 5)}
    # --- round given a finish (method part fixed at the chosen spec)
    mk = dict(m_exp=best_m.m_exp, m_bias=best_m.m_bias, rep_m=best_m.rep_m)
    seq_r = [(Spec("S2 shapes", **mk), None),
             (Spec("S2+P[er]", r_exp=("S2", "P"), rep_r="er", **mk), "S2 shapes"),
             (Spec("S2+P[wr]", r_exp=("S2", "P"), rep_r="wr", **mk), "S2+P[er]"),
             (Spec("S2+P[best]", r_exp=("S2", "P"), rep_r="best", **mk), "S2+P[er]"),
             (Spec("S2+P[er] | delta", r_exp=("S2", "P"), rep_r="er", r_delta=True, **mk), "S2+P[er]")]
    best, tab_r = select_sequence(A_of, seq_r, cv_loss_round, rows_r, "round ")
    best.name = "pool: %s / %s" % (best_m.name, best.name)
    res["selection"] = {"method": tab_m, "round": tab_r, "comparators": comp, "chosen": best.as_dict()}
    log("cv: chosen %s (%.0f s)" % (best.as_dict(), time.time() - t0))
    # --- the package table on the CV folds: every package composed with the same winner (W_close)
    A = A_of(best)
    folds = fwd_folds(A)
    pk = {"S2 (cycle-1 cells)": Spec("S2"), "props alone": Spec("P", m_exp=("P",), r_exp=("P",)),
          "40/60 blend (current)": Spec("B46", m_exp=("B46",), r_exp=("B46",)), "pool (chosen)": best}
    res["cv_tables"] = {}
    for wname in ("W_close", "W_ml2"):
        joints = {}
        for k, s in pk.items():
            Ak = A_of(s)
            M, R, _ = predict_folds(Ak, s, folds)
            joints[k] = compose(Ak[wname], np.nan_to_num(M, nan=1 / 3), np.nan_to_num(R, nan=0.2), Ak["K"], Ak["draw_c"])
        fy = fold_years(A)
        for setname, msk in (("fights with method props", fy & A["hasM"] & (A["y"] >= 0)),
                             ("all fights (degrade: S2 where props are missing)", fy & (A["y"] >= 0))):
            tabl, _, _ = score_table(A, msk, joints, "S2 (cycle-1 cells)", B=args.boot)
            tabl["p_decision"] = {k: {"pred": round(float(p_decision(P[msk]).mean()), 4)} for k, P in joints.items()}
            tabl["p_decision"]["observed"] = round(float(np.isin(A["y"][msk], [I_XDEC, I_YDEC, I_DRAW]).mean()), 4)
            res["cv_tables"]["%s | %s" % (wname, setname)] = tabl
        # pool vs the current blend, paired
    jp = {k: A["J_pub"][k] for k in A["J_pub"]}
    msk = fold_years(A) & A["hasM"] & A["has_pmk"] & (A["y"] >= 0)
    tabl, _, _ = score_table(A, msk, dict(jp, **{"pool (W_close)": joints_cache(A, best, folds, "W_close")}),
                             "40/60 blend (current)", B=args.boot)
    res["cv_tables"]["as published (own winners) | fights with props in market.json too"] = tabl
    # --- LOYO 2021-2023 (secondary)
    lo = {}
    for k, s in pk.items():
        Ak = A_of(s)
        M, R, _ = predict_folds(Ak, s, loyo_folds(Ak))
        lo[k] = compose(Ak["W_close"], np.nan_to_num(M, nan=1 / 3), np.nan_to_num(R, nan=0.2), Ak["K"], Ak["draw_c"])
    msk = (A["year"] >= 2021) & (A["year"] <= 2023) & A["hasM"] & (A["y"] >= 0)
    tabl, _, _ = score_table(A, msk, lo, "S2 (cycle-1 cells)", B=args.boot)
    res["cv_tables"]["LOYO 2021-2023 | W_close | fights with method props"] = tabl
    # --- final parameters for the 2024-25 look and for production-before-2024: fit on 2021-2023
    tr = (A["year"] >= 2021) & (A["year"] <= 2023)
    res["params_fit_2021_2023"] = best.fit(A, tr)
    # corner symmetry of the chosen pool: swapping A and B mirrors the joint exactly
    rows = tr & A["hasM"]
    M, R = best.predict(A, rows, res["params_fit_2021_2023"])
    P = compose(A["W_close"][rows], M, R, A["K"][rows], A["draw_c"])
    Ms, Rs = M[:, ::-1], R[:, ::-1]
    Ps = compose(1 - A["W_close"][rows], Ms, Rs, A["K"][rows], A["draw_c"])
    res["corner_swap_max_abs"] = float(np.max(np.abs(mirror(Ps) - P)))
    assert res["corner_swap_max_abs"] < 1e-12
    json.dump(res, open(os.path.join(CACHE, "cv.json"), "w"), indent=1, default=float)
    log("cv: written out/props_cache/cv.json (%.0f s)" % (time.time() - t0))


def joints_cache(A, spec, folds, wname):
    import numpy as np
    M, R, _ = predict_folds(A, spec, folds)
    return compose(A[wname], np.nan_to_num(M, nan=1 / 3), np.nan_to_num(R, nan=0.2), A["K"], A["draw_c"])


# ====================================================================== pre-registration and the single 2024-25 look
PREREG = os.path.join(CACHE, "prereg.json")
VALID_DONE = os.path.join(CACHE, "valid.done")


@stage("prereg")
def stage_prereg(args):
    cvr = json.load(open(os.path.join(CACHE, "cv.json")))
    if os.path.exists(VALID_DONE):
        raise SystemExit("the 2024-25 look has already run; the pre-registration is frozen")
    tb = cvr["cv_tables"]["W_close | fights with method props"]
    pv = tb["paired_vs_S2 (cycle-1 cells)"]
    pr = {
        "written_utc": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "frozen_from": {"cv_built": cvr["built"], "chosen": cvr["selection"]["chosen"],
                        "params": cvr["params_fit_2021_2023"]},
        "scored_object": "the chosen pool (spec and parameters above, fit on 2021-2023 fights with props) for "
                         "P(method | winner) and P(round | side, method), composed with the winner model W_close "
                         "(cycle 1's close stack, market + ML v2, fit 2019-2023); where a prop family is missing the "
                         "part falls back to S2 (the degrade rule)",
        "window": [TEST_FROM, TEST_TO],
        "primary": {"metric": "7-bin log loss", "set": "2024-25 fights with method props (close+props regime)",
                    "comparison": "pool minus S2 cycle-1 cells, same winner (W_close): the difference is method given "
                                  "the winner plus the draw cell",
                    "cv_estimate": pv.get("pool (chosen)", {}).get("bin7"),
                    "expected_effect": "about the CV estimate; V6_V10_PLAN Cycle 2 expects -0.005 to -0.015",
                    "mde_note": "V6_V10_PLAN section 2: MDE for a method-given-winner change about 0.015 on 2024-25"},
        "secondaries": ["method given the winner", "round given a finish", "method3", "finish vs decision",
                        "who x how x when (joint)", "the same against props alone and against the current 40/60 "
                        "blend (conditionals with the same winner, and as published with their own winners)",
                        "W_ml2 instead of W_close", "all fights (degrade)", "P(decision) mean predicted vs observed "
                        "(target: within 2 points)", "card segment (descriptive)"],
        "failure": ["primary: pool worse than S2 with a CI excluding 0",
                    "method given the winner worse than the current 40/60 blend's conditionals by more than +0.003 "
                    "(V6_V10_PLAN 6.3 not-worse bound for method)",
                    "round given a finish worse than S2 by more than +0.002 (V6_V10_PLAN Cycle 2 gate)",
                    "P(decision) more than 2 points from observed"],
        "decision_rule": "This is cycle-2 research (no version look). The look confirms or not; it never changes the "
                         "spec or the parameters. Adoption into predict()/the ledger follows the CV gate; the v7 "
                         "version look is the official test.",
        "confirmation_look_note": "2024-25 was already used for the S2 / props / 40/60 comparisons in model_ml2 and "
                                  "model_methodround: the S2 and 40/60 numbers there are known, the pool's are not.",
    }
    json.dump(pr, open(PREREG, "w"), indent=1, default=float)
    log("prereg written: %s" % PREREG)


@stage("valid")
def stage_valid(args):
    import numpy as np
    if os.path.exists(VALID_DONE):
        raise SystemExit("valid has already run (%s): 2024-25 is scored once" % VALID_DONE)
    if not os.path.exists(PREREG):
        raise SystemExit("run `prereg` first (and commit it) before the single look")
    pr = json.load(open(PREREG))
    ch = pr["frozen_from"]["chosen"]
    best = Spec(ch["name"], ch["m_exp"], ch["m_bias"], ch["r_exp"], ch["r_delta"], ch["rep_m"], ch["rep_r"])
    par = pr["frozen_from"]["params"]
    A_of = lambda s: assemble(s.rep_m, s.rep_r)          # noqa: E731
    A = A_of(best)
    test = (A["year"] >= 2024) & (A["year"] <= 2025) & np.array([d <= TEST_TO for d in A["date"]])
    open(VALID_DONE, "w").write(dt.datetime.now(dt.timezone.utc).isoformat() + "\n")
    pk = {"S2 (cycle-1 cells)": Spec("S2"), "props alone": Spec("P", m_exp=("P",), r_exp=("P",)),
          "40/60 blend (current)": Spec("B46", m_exp=("B46",), r_exp=("B46",)), "pool (chosen)": best}
    trn = (A["year"] >= 2021) & (A["year"] <= 2023)
    out = {"built": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(), "prereg": pr, "tables": {}}
    joints_w = {}
    for wname in ("W_close", "W_ml2"):
        joints = {}
        for k, s in pk.items():
            Ak = A_of(s)
            p = par if k == "pool (chosen)" else s.fit(Ak, trn)
            M, R = s.predict(Ak, test, p)
            Mf = np.full((len(Ak["ids"]), 2, 3), 1 / 3)
            Rf = np.full((len(Ak["ids"]), 2, 2, R5), 0.2)
            Mf[test], Rf[test] = M, R
            joints[k] = compose(Ak[wname], Mf, Rf, Ak["K"], Ak["draw_c"])
        joints_w[wname] = joints
        for setname, msk in (("fights with method props", test & A["hasM"] & (A["y"] >= 0)),
                             ("all fights (degrade: S2 where props are missing)", test & (A["y"] >= 0))):
            tabl, _, _ = score_table(A, msk, joints, "S2 (cycle-1 cells)", B=args.boot)
            tabl["paired_pool_vs_blend"] = score_table(A, msk, {"pool (chosen)": joints["pool (chosen)"],
                                                                "40/60 blend (current)": joints["40/60 blend (current)"]},
                                                       "40/60 blend (current)", B=args.boot)[0]["paired_vs_40/60 blend (current)"]
            tabl["paired_pool_vs_props"] = score_table(A, msk, {"pool (chosen)": joints["pool (chosen)"],
                                                                "props alone": joints["props alone"]},
                                                       "props alone", B=args.boot)[0]["paired_vs_props alone"]
            tabl["p_decision"] = {k: round(float(p_decision(P[msk]).mean()), 4) for k, P in joints.items()}
            tabl["p_decision"]["observed"] = round(float(np.isin(A["y"][msk], [I_XDEC, I_YDEC, I_DRAW]).mean()), 4)
            out["tables"]["%s | %s" % (wname, setname)] = tabl
    msk = test & A["hasM"] & A["has_pmk"] & (A["y"] >= 0)
    tabl, _, _ = score_table(A, msk, dict(A["J_pub"], **{"pool (W_close)": joints_w["W_close"]["pool (chosen)"]}),
                             "40/60 blend (current)", B=args.boot)
    out["tables"]["as published (own winners) | fights with props in market.json too"] = tabl
    # card segment (descriptive): pool minus S2, W_close, fights with props
    out["by_segment"] = {}
    for sg in ("main", "prelim", "early", "unknown"):
        m = test & A["hasM"] & (A["y"] >= 0) & (A["seg"] == sg)
        if m.sum() >= 30:
            t_, _, _ = score_table(A, m, {k: joints_w["W_close"][k] for k in ("S2 (cycle-1 cells)", "pool (chosen)")},
                                   "S2 (cycle-1 cells)", B=args.boot)
            out["by_segment"][sg] = {"n": int(m.sum()), "pool_minus_S2": {
                k: t_["paired_vs_S2 (cycle-1 cells)"]["pool (chosen)"][k] for k in ("bin7", "method_given_winner",
                                                                                   "round_given_fin", "joint")}}
    out["pool_cells_2024_25"] = {A["ids"][i]: [round(float(x), 5) for x in joints_w["W_close"]["pool (chosen)"][i]]
                                 for i in np.flatnonzero(test)}
    json.dump(out, open(os.path.join(CACHE, "valid.json"), "w"), indent=1, default=float)
    t = out["tables"]["W_close | fights with method props"]
    log("valid (ONE look) n=%d: pool - S2 %s" % (t["n"], {k: t["paired_vs_S2 (cycle-1 cells)"]["pool (chosen)"][k]["diff"]
                                                          for k in ("bin7", "method_given_winner", "round_given_fin")}))


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
