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
    """Implied P(side t wins by decision): the 'wins by decision' price, else unanimous + split/majority. Empty
    cells count as missing (Nov 7 fix; the 2021-2025 extract has no bout-book where this differs, so every scored
    number is unchanged)."""
    q = q_of(d.get("dec%d" % t))
    if q is not None:
        return q
    u, m = q_of(d.get("ud%d" % t)), q_of(d.get("sm%d" % t))
    return u + m if (u is not None and m is not None) else None


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
    'best' (mr > wr > er: the most specific family quoted). rep_m 'm6_mr': the mean of m6 and the six-way implied by
    the method-by-round family (mr) where both are quoted."""
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
        if rep_m == "m6_mr" and rec.get("mr") is not None:
            f = np.asarray(rec["mr"], float)
            mr6 = np.array([f[:K].sum(), f[K:2 * K].sum(), f[4 * K], f[2 * K:3 * K].sum(), f[3 * K:4 * K].sum(),
                            f[4 * K + 1]])
            v = 0.5 * (v / v.sum() + mr6 / mr6.sum())
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


def _softmax_last(s):
    import numpy as np
    s = s - s.max(-1, keepdims=True)
    e = np.exp(s)
    return e / e.sum(-1, keepdims=True)


NB_REF = math.log(4.0)            # book-count weighting is centred on 4 books


def method_weights(par, n_exp, p_idx, lognb):
    """Per-row log-linear weights (n x n_exp): alpha_j, plus alpha_nb x (log books - log 4) on the props expert."""
    import numpy as np
    n = len(lognb)
    Wt = np.tile(np.asarray(par["alpha"], float), (n, 1))
    if par.get("alpha_nb") and p_idx is not None:
        Wt[:, p_idx] = np.maximum(0.0, Wt[:, p_idx] + par["alpha_nb"] * (lognb - NB_REF))
    return Wt


def pool_method(mode, Ms, par, ext):
    """Pool of method | winner experts (each n x 2 x 3; sides A, B; KO, SUB, DEC). Corner-symmetric: no term depends
    on the corner, only on each side's own conditionals (and, for 'jlin', each source's own P(that side wins)).
      log : log p ∝ sum_j w_j log M_j
      lin : p = sum_j w_j M_j, w on the simplex
      jlin: p(side) ∝ sum_j w_j W_j(side) M_j(side), W_j = source j's own winner probability (the structure of the
            current 40/60 blend of joints, methodround.json a_market)
    then the debias tilt p ∝ p exp(beta), beta = [0, b_sub, b_dec] shared by both sides. alpha_nb (optional) moves
    the props expert's weight with its book count: w_P x exp(alpha_nb (log books - log 4)) for lin / jlin,
    w_P + alpha_nb (log books - log 4) for log."""
    import numpy as np
    beta = np.asarray(par.get("beta") or [0.0, 0.0, 0.0], float)
    if mode == "log":
        Wt = method_weights(par, len(Ms), ext.get("p_idx"), ext["lognb"])
        s = sum(Wt[:, j][:, None, None] * np.log(np.clip(M, 1e-6, 1)) for j, M in enumerate(Ms))
        return _softmax_last(s + beta[None, None, :])
    n = len(ext["lognb"])
    Wt = np.tile(np.asarray(par["w"], float), (n, 1))
    if par.get("alpha_nb") and ext.get("p_idx") is not None:
        Wt[:, ext["p_idx"]] *= np.exp(par["alpha_nb"] * (ext["lognb"] - NB_REF))
        Wt /= Wt.sum(1, keepdims=True)
    if mode == "lin":
        P = sum(Wt[:, j][:, None, None] * M for j, M in enumerate(Ms))
    else:
        P = np.zeros_like(Ms[0])
        for s_ in (0, 1):
            c = [Wt[:, j] * (W if s_ == 0 else 1 - W) for j, W in enumerate(ext["Wsrc"])]
            tot = sum(c)
            P[:, s_] = sum(c_[:, None] * M[:, s_] for c_, M in zip(c, Ms)) / tot[:, None]
    if np.any(beta):
        P = P * np.exp(beta)[None, None, :]
        P = P / P.sum(-1, keepdims=True)
    return P


def pool_round(mode, Rs, par, K):
    """Pool of round | side, method shapes (n x 2 x 2 x 5), rounds past K masked.
      log: log p ∝ sum_j gamma_j log R_j + delta_K (optional round biases by format, delta[K][0] = 0)
      lin: p = sum_j w_j R_j"""
    import numpy as np
    K = np.asarray(K)
    mask = np.arange(R5)[None, :] >= K[:, None]
    if mode == "lin":
        P = sum(w_ * R for w_, R in zip(par["w"], Rs))
    else:
        s = sum(g * np.log(np.clip(R, 1e-6, 1)) for g, R in zip(par["gamma"], Rs))
        if par.get("delta"):
            for k_ in (3, 5):
                m = K == k_
                s[m] = s[m] + np.asarray(par["delta"][str(k_)] if str(k_) in par["delta"] else par["delta"][k_])[None, None, :]
        s = np.where(mask[:, None, None, :], -1e9, s)
        P = np.exp(s - s.max(-1, keepdims=True))
    P = np.where(mask[:, None, None, :], 0.0, P)
    return P / P.sum(-1, keepdims=True)


def _simplex(th):
    import numpy as np
    e = np.exp(np.r_[0.0, th])
    return e / e.sum()


def fit_method(mode, Ms, side, meth, ext, bias=(), nb=False):
    """MLE on method given the actual winner. Returns the parameter dict for pool_method."""
    import numpy as np
    from scipy.optimize import minimize
    n_exp = len(Ms)
    ix = np.arange(len(side))
    nw = n_exp if mode == "log" else n_exp - 1

    def unpack(th):
        par = {"alpha": [float(x) for x in th[:nw]]} if mode == "log" else {"w": [float(x) for x in _simplex(th[:nw])]}
        par["beta"] = [0.0, 0.0, 0.0]
        for j, nm in enumerate(bias):
            par["beta"][1 if nm == "sub" else 2] = float(th[nw + j])
        if nb:
            par["alpha_nb"] = float(th[-1])
        return par

    def f(th):
        P = pool_method(mode, Ms, unpack(th), ext)
        return float(np.mean(-np.log(np.clip(P[ix, side, meth], 1e-12, 1))))
    th0 = np.r_[np.full(nw, 1.0 / n_exp) if mode == "log" else np.zeros(nw), np.zeros(len(bias)), [0.0] if nb else []]
    bounds = ([(0, 5)] * nw if mode == "log" else [(-8, 8)] * nw) + [(-3, 3)] * len(bias) + ([(-2, 2)] if nb else [])
    r = minimize(f, th0, method="L-BFGS-B", bounds=bounds)
    return unpack(r.x)


def fit_round(mode, Rs, side, meth, rnd, K, with_delta=False):
    import numpy as np
    from scipy.optimize import minimize
    n_exp = len(Rs)
    ix = np.arange(len(side))
    m2 = np.minimum(meth, 1)

    def unpack(th):
        if mode == "lin":
            return {"w": [float(x) for x in _simplex(th)]}
        par = {"gamma": [float(x) for x in th[:n_exp]], "delta": None}
        if with_delta:          # 3-round bouts only: 5-round finishes are too few per fold (CV dry run: overfit)
            par["delta"] = {"3": [0.0, float(th[n_exp]), float(th[n_exp + 1]), 0.0, 0.0], "5": [0.0] * 5}
        return par

    def f(th):
        P = pool_round(mode, Rs, unpack(th), K)
        return float(np.mean(-np.log(np.clip(P[ix, side, m2, rnd], 1e-12, 1))))
    if mode == "lin":
        r = minimize(f, np.zeros(n_exp - 1), method="L-BFGS-B", bounds=[(-8, 8)] * (n_exp - 1))
    else:
        nd = 2 if with_delta else 0
        r = minimize(f, np.r_[np.full(n_exp, 1.0 / n_exp), np.zeros(nd)], method="L-BFGS-B",
                     bounds=[(0, 5)] * n_exp + [(-3, 3)] * nd)
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
    A["n_books_m6"] = np.array([(r.get("n_books") or {}).get("m6", 0) for r in recs])
    A["Wp"] = np.array([sum(r["m6"][:3]) / sum(r["m6"]) if r.get("m6") else 0.5 for r in recs])
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
    """A pool configuration: method experts, mode (log / lin / jlin), debias terms and book-count weighting; round
    experts, mode (log / lin) and format biases; the props representations (rep_m, rep_r)."""

    def __init__(self, name, m_exp=("S2",), m_bias=(), r_exp=("S2",), r_delta=False, rep_m="m6", rep_r="er",
                 m_mode="log", r_mode="log", m_nb=False):
        self.name, self.m_exp, self.m_bias, self.r_exp = name, tuple(m_exp), tuple(m_bias), tuple(r_exp)
        self.r_delta, self.rep_m, self.rep_r = r_delta, rep_m, rep_r
        self.m_mode, self.r_mode, self.m_nb = m_mode, r_mode, m_nb

    def as_dict(self):
        return {"name": self.name, "m_exp": list(self.m_exp), "m_bias": list(self.m_bias), "m_mode": self.m_mode,
                "m_nb": self.m_nb, "r_exp": list(self.r_exp), "r_delta": self.r_delta, "r_mode": self.r_mode,
                "rep_m": self.rep_m, "rep_r": self.rep_r}

    @staticmethod
    def from_dict(d):
        return Spec(d["name"], d["m_exp"], d["m_bias"], d["r_exp"], d["r_delta"], d["rep_m"], d["rep_r"],
                    d.get("m_mode", "log"), d.get("r_mode", "log"), d.get("m_nb", False))

    def _mfit(self):
        return len(self.m_exp) > 1 or bool(self.m_bias) or self.m_nb

    def _rfit(self):
        return len(self.r_exp) > 1 or self.r_delta

    def _ext(self, A, rows):
        import numpy as np
        W = {"S2": A["W_ml2"], "SM": A["W_ml2"], "S": A["W_ml2"], "B46": A["W_ml2"], "P": A["Wp"]}
        return {"lognb": np.log(np.maximum(A["n_books_m6"][rows], 1)),
                "p_idx": self.m_exp.index("P") if "P" in self.m_exp else None,
                "Wsrc": [W[e][rows] for e in self.m_exp]}

    def fit(self, A, tr):
        par = {"m": {"alpha": [1.0] * len(self.m_exp), "beta": [0.0, 0.0, 0.0]} if self.m_mode == "log"
               else {"w": [1.0 / len(self.m_exp)] * len(self.m_exp)},
               "r": {"gamma": [1.0] * len(self.r_exp), "delta": None} if self.r_mode == "log"
               else {"w": [1.0 / len(self.r_exp)] * len(self.r_exp)}}
        mm = tr & (A["side"] >= 0)
        if "P" in self.m_exp:
            mm = mm & A["hasM"]
        if self._mfit():
            par["m"] = fit_method(self.m_mode, [A["M"][e][mm] for e in self.m_exp], A["side"][mm], A["meth"][mm],
                                  self._ext(A, mm), self.m_bias, self.m_nb)
        rr = tr & (A["rnd"] >= 0)
        if "P" in self.r_exp:
            rr = rr & A["hasR"]
        if self._rfit():
            par["r"] = fit_round(self.r_mode, [A["R"][e][rr] for e in self.r_exp], A["side"][rr], A["meth"][rr],
                                 A["rnd"][rr], A["K"][rr], self.r_delta)
        par["n_fit_method"], par["n_fit_round"] = int(mm.sum()), int(rr.sum())
        return par

    def predict(self, A, rows, par):
        """method | winner and round shapes for `rows`; a part whose props are absent falls back to S2 (degrade)."""
        import numpy as np
        M = A["M"]["S2"][rows].copy()
        R = A["R"]["S2"][rows].copy()
        okm = np.ones(rows.sum(), bool) if "P" not in self.m_exp else A["hasM"][rows]
        if okm.any():
            sub = rows.copy()
            sub[rows] = okm
            Ms = [A["M"][e][sub] for e in self.m_exp]
            M[okm] = pool_method(self.m_mode, Ms, par["m"], self._ext(A, sub)) if self._mfit() else Ms[0]
        okr = np.ones(rows.sum(), bool) if "P" not in self.r_exp else A["hasR"][rows]
        if okr.any():
            sub = rows.copy()
            sub[rows] = okr
            Rs = [A["R"][e][sub] for e in self.r_exp]
            R[okr] = pool_round(self.r_mode, Rs, par["r"], A["K"][sub]) if self._rfit() else Rs[0]
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


def gate_round_marginal(A, spec, folds, rows):
    """V6_V10_PLAN Cycle 2 gate metric: methodround's round given a finish (unsided, P(round r | finish) from the
    composed joint with W_close), on the same CV rows."""
    import numpy as np
    M, R, _ = predict_folds(A, spec, folds)
    P = compose(A["W_close"][rows], M[rows], R[rows], A["K"][rows], A["draw_c"])
    return float(np.nanmean(losses(P, A["y"][rows])["round_given_fin"]))


def select_stages(A_of, start, stages, metric_fn, rows_fn, log_name, gate_fn=None, gate_tol=None):
    """Staged forward selection: each stage builds alternatives from the current choice; the best alternative
    replaces the current choice only if its CV loss is lower by more than SEL_MIN (0.0005, tools/ml2.py's rule) and,
    when gate_fn is given, its gate metric is not worse than the current choice's by more than gate_tol."""
    table = []

    def run(spec):
        A = A_of(spec)
        rows = rows_fn(A)
        loss, _, pars = metric_fn(A, spec, fwd_folds(A), rows)
        return loss, int(rows.sum()), pars

    gates = {}

    def gate(spec):
        if gate_fn is None:
            return None
        if spec.name not in gates:
            A = A_of(spec)
            gates[spec.name] = gate_fn(A, spec, fwd_folds(A), rows_fn(A))
        return gates[spec.name]
    l0, n0, p0 = run(start)
    cur = (start, l0)
    table.append({"stage": 0, "spec": start.name, "cv": round(l0, 5), "n": n0, "params_by_fold": p0,
                  "decision": "start"})
    log("%s %-40s CV %.5f n=%d start" % (log_name, start.name, l0, n0))
    for k, build in enumerate(stages, 1):
        alts = build(cur[0])
        res = []
        for spec in alts:
            loss, n, pars = run(spec)
            g, g0 = gate(spec), gate(cur[0])
            ok = g is None or g <= g0 + gate_tol
            res.append((loss, spec, ok))
            row = {"stage": k, "spec": spec.name, "cv": round(loss, 5), "n": n, "params_by_fold": pars,
                   "vs_current": round(loss - cur[1], 5)}
            if g is not None:
                row["gate"] = {"value": round(g, 5), "current": round(g0, 5), "diff": round(g - g0, 5), "pass": bool(ok)}
            table.append(row)
            log("%s %-40s CV %.5f n=%d (vs current %+.5f)%s" % (log_name, spec.name, loss, n, loss - cur[1],
                "" if g is None else " gate %+.5f %s" % (g - g0, "pass" if ok else "FAIL")))
        res = [r for r in res if r[2]]
        if not res:
            table.append({"stage": k, "decision": "kept %s (no alternative passes the gate)" % cur[0].name})
            log("%s stage %d: kept %s (gate)" % (log_name, k, cur[0].name))
            continue
        lb, sb, _ = min(res, key=lambda x: x[0])
        if lb < cur[1] - SEL_MIN:
            table.append({"stage": k, "decision": "accepted %s (%.5f < %.5f - %.4f)" % (sb.name, lb, cur[1], SEL_MIN)})
            log("%s stage %d: accepted %s" % (log_name, k, sb.name))
            cur = (sb, lb)
        else:
            table.append({"stage": k, "decision": "kept %s (best alternative %s %.5f)" % (cur[0].name, sb.name, lb)})
            log("%s stage %d: kept %s" % (log_name, k, cur[0].name))
    return cur[0], table


def _clone(spec, name, **kw):
    d = spec.as_dict()
    d.update(kw)
    d["name"] = name
    return Spec.from_dict(d)


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
    hasR_all = assemble(rep_r="er")["hasR"] & assemble(rep_r="wr")["hasR"] & assemble(rep_r="best")["hasR"]
    rows_r = lambda A: fold_years(A) & (A["rnd"] >= 0) & hasR_all & A["hasM"]               # noqa: E731
    # --- method given the winner
    m_stages = [
        lambda c: [Spec("S2+P log", m_exp=("S2", "P")),
                   Spec("S2+P log [m6_gd]", m_exp=("S2", "P"), rep_m="m6_gd"),
                   Spec("S2+P log [m6_mr]", m_exp=("S2", "P"), rep_m="m6_mr"),
                   Spec("S2+P jlin [m6_mr]", m_exp=("S2", "P"), m_mode="jlin", rep_m="m6_mr"),
                   Spec("S2+P lin", m_exp=("S2", "P"), m_mode="lin"),
                   Spec("S2+P jlin", m_exp=("S2", "P"), m_mode="jlin")],
        lambda c: [_clone(c, c.name + " | dec", m_bias=["dec"]), _clone(c, c.name + " | dec, sub", m_bias=["dec", "sub"])]
        if "P" in c.m_exp else [],
        lambda c: [_clone(c, c.name + " | books", m_nb=True)] if "P" in c.m_exp else [],
        lambda c: [_clone(c, c.name.replace("S2+", "S2+SM+", 1), m_exp=["S2", "SM"] + [e for e in c.m_exp if e != "S2"])]
        if "P" in c.m_exp else []]
    best_m, tab_m = select_stages(A_of, Spec("S2"), m_stages, cv_loss_method, rows_m, "method")
    # comparators (not candidates): props alone, the current 40/60 blend's conditionals
    comp = {}
    for spec in (Spec("P", m_exp=("P",), r_exp=("P",)), Spec("B46", m_exp=("B46",), r_exp=("B46",))):
        A = A_of(spec)
        comp[spec.name] = {"method_given_winner": round(cv_loss_method(A, spec, fwd_folds(A), rows_m(A))[0], 5),
                           "round_given_fin": round(cv_loss_round(A, spec, fwd_folds(A), rows_r(A))[0], 5)}
    # --- round given a finish (method part fixed at the chosen spec)
    r_start = _clone(best_m, "S2 shapes", r_exp=["S2"], r_mode="log", r_delta=False, rep_r="er")
    r_stages = [
        lambda c: [_clone(c, "S2+P[%s] %s" % (rep, md), r_exp=["S2", "P"], rep_r=rep, r_mode=md)
                   for rep in ("er", "wr", "best") for md in ("log", "lin")],
        lambda c: [_clone(c, c.name + " | delta", r_delta=True)] if c.r_mode == "log" and "P" in c.r_exp else []]
    best, tab_r = select_stages(A_of, r_start, r_stages, cv_loss_round, rows_r, "round ",
                                gate_fn=gate_round_marginal, gate_tol=0.002)
    best = _clone(best, "pool: %s / %s" % (best_m.name, best.name))
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
    # corner symmetry of the chosen pool: swapping A and B in every input mirrors the joint exactly
    res["corner_swap_max_abs"] = swap_check(A, best, res["params_fit_2021_2023"], tr)
    assert res["corner_swap_max_abs"] < 1e-12, res["corner_swap_max_abs"]
    json.dump(res, open(os.path.join(CACHE, "cv.json"), "w"), indent=1, default=float)
    log("cv: written out/props_cache/cv.json (%.0f s)" % (time.time() - t0))


def swap_assembly(A):
    """The same fights with A and B swapped in every input (experts' sides, winners, props' own winner)."""
    B = dict(A)
    B["M"] = {k: v[:, ::-1] for k, v in A["M"].items()}
    B["R"] = {k: v[:, ::-1] for k, v in A["R"].items()}
    for k in ("W_close", "W_ml2", "Wp"):
        B[k] = 1 - A[k]
    return B


def swap_check(A, spec, par, rows):
    import numpy as np
    M, R = spec.predict(A, rows, par)
    P = compose(A["W_close"][rows], M, R, A["K"][rows], A["draw_c"])
    B = swap_assembly(A)
    Ms, Rs = spec.predict(B, rows, par)
    Ps = compose(B["W_close"][rows], Ms, Rs, B["K"][rows], B["draw_c"])
    return float(np.max(np.abs(mirror(Ps) - P)))


def joints_cache(A, spec, folds, wname):
    import numpy as np
    M, R, _ = predict_folds(A, spec, folds)
    return compose(A[wname], np.nan_to_num(M, nan=1 / 3), np.nan_to_num(R, nan=0.2), A["K"], A["draw_c"])


# ====================================================================== debut bouts: the debut method model + props
def debut_assembly():
    """Debut bouts (a side with 0 prior UFC bouts; tools/debut.py's universe, disjoint from the backtest universe):
    the debut METHOD model's P(KO / SUB / DEC | winner) per side, annual forward-chained for 2021-2025 exactly as
    tools/debut.py runs it (fit on decisive debut bouts 2012..Y-1, frozen CV choices), fed the line where there is
    one (the adopted ledger setup: close, else the debut winner model's out-of-sample probability); props matched by
    date and names to the BFO extract."""
    import numpy as np
    import debut as DB
    import market as MK
    fp = os.path.join(CACHE, "debut.pkl")
    if os.path.exists(fp):
        return pickle.load(open(fp, "rb"))
    df, _ = DB.load_frame()
    dec, RA, RB = DB.prep(df)
    assert (dec["date"].astype(str) < VAULT_S).all()
    C = DB.frozen_choices()
    ch, lam = C["chosen"], C["method"]["chosen_lam"]
    fights, _, _, _ = DB.load_universe_strict()
    pclose = dec["p_close"].to_numpy(float)
    pw_deb = DB.method_winner_input(dec, RA, RB, ch, dec["elo_p"].to_numpy(float), 2025)
    pw = np.where(np.isnan(pclose), pw_deb, pclose)
    yrs = [2021, 2022, 2023, 2024, 2025]
    PA, PB, yk, okm = DB.method_eval(dec, RA, RB, pw, fights, yrs, lam)
    yr = dec["year"].to_numpy()
    keep = np.isin(yr, yrs) & okm & ~np.isnan(PA[:, 0])
    by_mu = load_extract()
    by_date = defaultdict(list)
    for mu, rows in by_mu.items():
        r0 = next(iter(rows.values()))
        by_date[r0["date"]].append((mu, r0["t1"], r0["t2"], rows))
    D = {"fid": [], "year": [], "event": [], "K": [], "side": [], "meth": [], "W": [], "pw": [], "Md": [], "rec": []}
    for i in np.flatnonzero(keep):
        d0 = dt.date.fromisoformat(str(dec["date"].iloc[i])[:10])
        a, b = dec["nameA"].iloc[i], dec["nameB"].iloc[i]
        best = None
        for dd in (0, 1, -1, 2, -2):
            for mu, t1, t2, rows in by_date.get((d0 + dt.timedelta(days=dd)).isoformat(), []):
                sk = min(MK.name_sim(a, t1), MK.name_sim(b, t2))
                ss = min(MK.name_sim(a, t2), MK.name_sim(b, t1))
                s_ = max(sk, ss)
                if s_ >= 0.8 and (best is None or s_ > best[0]):
                    best = (s_, rows, ss > sk)
            if best:
                break
        K = 5 if int(dec["rounds"].iloc[i]) == 5 else 3
        rec = {}
        if best:
            rec = consensus({bk: book_families(r, K, best[2]) for bk, r in best[1].items()}, K)
        D["fid"].append(dec["fid"].iloc[i])
        D["year"].append(int(yr[i]))
        D["event"].append(dec["event"].iloc[i])
        D["K"].append(K)
        D["side"].append(0 if dec["y"].iloc[i] == 1.0 else 1)
        D["meth"].append(int(yk[i]))
        D["W"].append(float(pclose[i]) if not np.isnan(pclose[i]) else float(pw[i]))
        D["pw"].append(float(pw[i]))
        D["Md"].append(np.stack([PA[i], PB[i]]))
        D["rec"].append(rec)
    out = {k: (np.array(v) if k not in ("rec", "Md") else v) for k, v in D.items()}
    out["Md"] = np.array(D["Md"])
    n = len(out["fid"])
    Mp = np.full((n, 2, 3), np.nan)
    for i, rec in enumerate(out["rec"]):
        if rec.get("m6") is not None:
            Mp[i] = props_cond(rec, int(out["K"][i]))[0]
    out["Mp"] = Mp
    out["hasM"] = ~np.isnan(Mp[:, 0, 0])
    out["Wp"] = np.array([sum(r["m6"][:3]) / sum(r["m6"]) if r.get("m6") else 0.5 for r in out["rec"]])
    out["nb"] = np.array([(r.get("n_books") or {}).get("m6", 0) for r in out["rec"]])
    out["lam"], out["chosen"] = lam, ch
    pickle.dump(out, open(fp, "wb"))
    return out


def debut_pool_predict(D, mode, par, rows, exps=("D", "P")):
    import numpy as np
    Ms = {"D": D["Md"], "P": D["Mp"]}
    Ws = {"D": D["pw"], "P": D["Wp"]}
    ext = {"lognb": np.log(np.maximum(D["nb"][rows], 1)), "p_idx": list(exps).index("P") if "P" in exps else None,
           "Wsrc": [Ws[e][rows] for e in exps]}
    return pool_method(mode, [Ms[e][rows] for e in exps], par, ext)


def debut_fit(D, mode, rows, exps=("D", "P"), bias=()):
    import numpy as np
    Ms = {"D": D["Md"], "P": D["Mp"]}
    Ws = {"D": D["pw"], "P": D["Wp"]}
    ext = {"lognb": np.log(np.maximum(D["nb"][rows], 1)), "p_idx": list(exps).index("P") if "P" in exps else None,
           "Wsrc": [Ws[e][rows] for e in exps]}
    return fit_method(mode, [Ms[e][rows] for e in exps], D["side"][rows], D["meth"][rows], ext, bias)


def debut_scores(D, M, rows):
    """method given the winner, method3 (marginal with W) and who x how (6 cells with W) per bout."""
    import numpy as np
    ix = np.flatnonzero(rows)
    s, m, W = D["side"][ix], D["meth"][ix], D["W"][ix]
    Mi = M[ix] if len(M) == len(D["side"]) else M
    mgw = -np.log(np.clip(Mi[np.arange(len(ix)), s, m], 1e-12, 1))
    marg = W[:, None] * Mi[:, 0] + (1 - W[:, None]) * Mi[:, 1]
    m3 = -np.log(np.clip(marg[np.arange(len(ix)), m], 1e-12, 1))
    ws = np.where(s == 0, W, 1 - W)
    wh = -np.log(np.clip(ws * Mi[np.arange(len(ix)), s, m], 1e-12, 1))
    return {"method_given_winner": mgw, "method3": m3, "whohow6": wh}


@stage("debut")
def stage_debut(args):
    """Forward-chained CV 2022-2023 (fit on 2021..Y-1) of the debut-bout pool; same 0.0005 rule."""
    import numpy as np
    D = debut_assembly()
    yr = D["year"]
    rows_all = np.isin(yr, CV_YEARS) & D["hasM"]
    res = {"n_bouts": {str(y): int((yr == y).sum()) for y in sorted(set(yr.tolist()))},
           "with_props": {str(y): int(((yr == y) & D["hasM"]).sum()) for y in sorted(set(yr.tolist()))}}
    cands = [("debut alone", None, ("D",)), ("props alone", None, ("P",)), ("D+P log", "log", ("D", "P")),
             ("D+P lin", "lin", ("D", "P")), ("D+P jlin", "jlin", ("D", "P"))]
    preds, cvl = {}, {}
    for name, mode, exps in cands:
        M = np.full_like(D["Md"], np.nan)
        pars = []
        for Y in CV_YEARS:
            tr = (yr >= 2021) & (yr < Y) & D["hasM"]
            te = (yr == Y) & D["hasM"]
            if mode is None:
                M[te] = (D["Md"] if exps == ("D",) else D["Mp"])[te]
                continue
            par = debut_fit(D, mode, tr, exps)
            M[te] = debut_pool_predict(D, mode, par, te, exps)
            pars.append(par)
        preds[name] = M
        sc = debut_scores(D, M, rows_all)
        cvl[name] = {k: round(float(v.mean()), 5) for k, v in sc.items()}
        cvl[name]["params_by_fold"] = pars
        log("debut CV %-14s n=%d %s" % (name, rows_all.sum(), {k: v for k, v in cvl[name].items() if k != "params_by_fold"}))
    best = min(("D+P log", "D+P lin", "D+P jlin"), key=lambda k: cvl[k]["method_given_winner"])
    chosen = best if cvl[best]["method_given_winner"] < cvl["debut alone"]["method_given_winner"] - SEL_MIN else "debut alone"
    ev = D["event"][rows_all]
    paired = {}
    import methodround as MR
    L = {k: debut_scores(D, preds[k], rows_all) for k in preds}
    bt, st = MR.cluster_bootstrap(L, ev, B=args.boot)
    for k in preds:
        if k != "debut alone":
            paired[k + " - debut alone"] = MR.paired_diff(L[k], L["debut alone"], st, ["method_given_winner", "method3", "whohow6"])
    res.update({"cv": cvl, "paired": paired, "chosen": chosen, "n_cv": int(rows_all.sum())})
    mode = {"D+P log": "log", "D+P lin": "lin", "D+P jlin": "jlin"}.get(chosen)
    if mode:
        res["params_fit_2021_2023"] = debut_fit(D, mode, (yr >= 2021) & (yr <= 2023) & D["hasM"])
        res["mode"] = mode
    json.dump(res, open(os.path.join(CACHE, "debut_cv.json"), "w"), indent=1, default=float)
    log("debut CV: chosen %s; written out/props_cache/debut_cv.json" % chosen)


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
    dcv = json.load(open(os.path.join(CACHE, "debut_cv.json")))
    pr["debut_bouts"] = {"universe": "tools/debut.py debut bouts (a side with 0 prior UFC bouts), decisive, with method "
                                     "props, 2024-01-01..2025-12-31",
                         "frozen": {"chosen": dcv["chosen"], "mode": dcv.get("mode"),
                                    "params": dcv.get("params_fit_2021_2023")},
                         "experts": "debut METHOD model (annual walk-forward as tools/debut.py runs it, fed the close "
                                    "where there is one) and the props' method | winner",
                         "primary": "method given the winner, pool minus debut model alone (paired, event clusters)",
                         "secondaries": ["method3 with W = the close (ledger p_a)", "who x how (6 cells)",
                                         "pool minus props alone"],
                         "cv_estimate": dcv["paired"].get(dcv["chosen"] + " - debut alone")}
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
    best = Spec.from_dict(ch)
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
    # debut bouts (secondary universe, pre-registered in prereg.debut_bouts)
    import methodround as MR
    Dd = debut_assembly()
    fr = pr["debut_bouts"]["frozen"]
    te = (Dd["year"] >= 2024) & (Dd["year"] <= 2025) & Dd["hasM"]
    Md = {"debut alone": Dd["Md"][te], "props alone": Dd["Mp"][te]}
    if fr.get("mode"):
        Md["pool (chosen)"] = debut_pool_predict(Dd, fr["mode"], fr["params"], te)
    Ld = {k: debut_scores(Dd, M, te) for k, M in Md.items()}
    bt, st = MR.cluster_bootstrap(Ld, Dd["event"][te], B=args.boot)
    out["debut_bouts"] = {"n": int(te.sum()), "means": bt, "paired": {
        k + " - debut alone": MR.paired_diff(Ld[k], Ld["debut alone"], st, ["method_given_winner", "method3", "whohow6"])
        for k in Ld if k != "debut alone"}}
    if "pool (chosen)" in Ld:
        out["debut_bouts"]["paired"]["pool (chosen) - props alone"] = MR.paired_diff(
            Ld["pool (chosen)"], Ld["props alone"], st, ["method_given_winner", "method3", "whohow6"])
    out["debut_pool_2024_25"] = {Dd["fid"][i]: {"A": [round(float(x), 5) for x in M[0]], "B": [round(float(x), 5) for x in M[1]]}
                                 for i, M in zip(np.flatnonzero(te), Md.get("pool (chosen)", Md["debut alone"]))}
    json.dump(out, open(os.path.join(CACHE, "valid.json"), "w"), indent=1, default=float)
    t = out["tables"]["W_close | fights with method props"]
    log("valid (ONE look) n=%d: pool - S2 %s" % (t["n"], {k: t["paired_vs_S2 (cycle-1 cells)"]["pool (chosen)"][k]["diff"]
                                                          for k in ("bin7", "method_given_winner", "round_given_fin")}))


# ====================================================================== capture: forward prop snapshots (upcoming cards)
def _bfo_home_events(html, today):
    """Event links on BFO's home page (UFC cards only), with the header date (no year: rolled forward)."""
    import html as H
    out = []
    for m in re.finditer(r'<div class="table-header"><a href="(/events/([a-z0-9-]+)-(\d+))"><h1>([^<]*)</h1></a>'
                         r'(?:<span class="table-header-date">([^<]*)</span>)?', html):
        url, slug, eid, title, dtext = m.groups()
        if not re.match(r"(noche-)?ufc", slug) or slug.startswith("ufc-bjj"):
            continue
        d = None
        mm = re.search(r"([A-Za-z]{3})[a-z]*\s+(\d{1,2})", dtext or "")
        if mm:
            mon = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].index(
                mm.group(1).lower()) + 1
            d = dt.date(today.year, mon, int(mm.group(2)))
            if (d - today).days < -60:
                d = dt.date(today.year + 1, mon, int(mm.group(2)))
        out.append({"url": BFO + url, "slug": slug + "-" + eid, "title": H.unescape(title),
                    "date": d.isoformat() if d else None})
    return out


@stage("capture")
def stage_capture(args):
    """Forward capture for upcoming cards: BFO event pages fetched now (FightLabSim/1.0, robots.txt checked, >= 2 s
    apart), every book's prop prices, the de-vigged families per book and the consensus, oriented to the bout's
    a/b order in data/predictions/cards_upcoming.json when the bout is listed there (else page order). Writes a NEW
    data/predictions/props_snapshot_<YYYYMMDD-HHMM>.json (UTC stamp; never overwrites) with the fetch time of every
    page. --replay STAMP rebuilds a snapshot from its cached raw pages (data/raw/props_cache/capture/STAMP/)."""
    import market as MK
    now = dt.datetime.now(dt.timezone.utc)
    stamp = args.replay or now.strftime("%Y%m%d-%H%M")
    out_path = os.path.join(PRED_DIR, "props_snapshot_%s.json" % stamp)
    if os.path.exists(out_path) and not args.replay:
        raise SystemExit("%s exists; snapshots are never overwritten" % out_path)
    F = Fetcher(os.path.join(RAWC, "capture"), delay=args.delay)
    today = now.date()
    until = dt.date.fromisoformat(args.until) if args.until else today + dt.timedelta(days=14)
    home, ts_home = F.get(BFO + "/", stamp)
    if not home:
        raise SystemExit("BFO home page unavailable")
    evs = [e for e in _bfo_home_events(home, today) if e["date"] and today - dt.timedelta(days=1)
           <= dt.date.fromisoformat(e["date"]) <= until]
    cards = {}
    cpath = os.path.join(PRED_DIR, "cards_upcoming.json")
    if os.path.exists(cpath):
        for ev in json.load(open(cpath)).get("events", []):
            for b in ev.get("bouts", []):
                cards.setdefault(ev["date"], []).append(dict(b, event=ev["name"]))
    snap = {"meta": {"snapshot_utc": now.strftime("%Y-%m-%dT%H:%M:%SZ") if not args.replay else None, "stamp": stamp,
                     "tool": "tools/props.py capture", "source": "bestfightodds.com event pages (closing-style "
                     "current prices per book; exchanges dropped)", "user_agent": UA, "home_fetched_utc": ts_home,
                     "window": [today.isoformat(), until.isoformat()], "devig": "power per family per book, "
                     "arithmetic mean over books, 0.15 outlier rule (tools/props.py book_families / consensus; "
                     "src/ml/propspool.js mirrors it)", "events": []}, "bouts": []}
    for e in evs:
        html, ts = F.get(e["url"], stamp)
        if not html:
            continue
        snap["meta"]["events"].append({"slug": e["slug"], "title": e["title"], "date": e["date"], "fetched_utc": ts})
        mus, props = MK.parse_event_props_full(html)
        for mu, m in mus.items():
            books = {}
            for (mu2, bk), d in props.items():
                if mu2 != mu or bk in EXCHANGES:
                    continue
                row = {k: (v[0] if v[0] is not None else "") for k, v in d.items()}
                for k in TWO_WAY:
                    if k in d:
                        row[k + "_no"] = d[k][1] if d[k][1] is not None else ""
                ml = m["lines"].get(bk) or [None, None]
                row["ml1"], row["ml2"] = (ml[0] if ml[0] is not None else ""), (ml[1] if ml[1] is not None else "")
                books[bk] = row
            t1, t2 = m.get("t1_name", ""), m.get("t2_name", "")
            # orient to the card's a/b when the bout is listed
            match, sw = None, False
            d0 = dt.date.fromisoformat(e["date"])
            for dd in (0, 1, -1):
                for b in cards.get((d0 + dt.timedelta(days=dd)).isoformat(), []):
                    sk = min(MK.name_sim(b["a"]["name"], t1), MK.name_sim(b["b"]["name"], t2))
                    ss = min(MK.name_sim(b["a"]["name"], t2), MK.name_sim(b["b"]["name"], t1))
                    if max(sk, ss) >= 0.8 and (match is None or max(sk, ss) > match[0]):
                        match, sw = (max(sk, ss), b, (d0 + dt.timedelta(days=dd)).isoformat()), ss > sk
                if match:
                    break
            K5 = any(r.get(k) not in (None, "") for r in books.values() for k in ("er4", "wr41", "wr42", "kor41"))
            K = int(match[1].get("rounds") or (5 if K5 else 3)) if match else (5 if K5 else 3)
            fams = {bk: book_families(r, K, sw) for bk, r in books.items()}
            cons = consensus(fams, K) if books else {}
            rec = {"event_slug": e["slug"], "mu": mu, "page_t1": t1, "page_t2": t2, "fetched_utc": ts, "rounds": K,
                   "swap": sw, "books": books, "consensus": cons,
                   "families_present": sorted(k for k in ("m6", "gd", "er", "wr", "mr", "itd", "ou") if k in cons)}
            if match:
                b = match[1]
                rec.update({"bout_id": "%s:%s__%s" % (match[2], b["a"].get("slug") or b["a"]["name"].lower().replace(" ", "-"),
                                                    b["b"].get("slug") or b["b"]["name"].lower().replace(" ", "-")),
                            "a": b["a"]["name"], "b": b["b"]["name"], "segment": b.get("segment"),
                            "order": b.get("order"), "event": b.get("event")})
            else:
                rec.update({"a": t1, "b": t2, "bout_id": None, "segment": None})
            snap["bouts"].append(rec)
    json.dump(snap, open(out_path, "w"), indent=1, default=float)
    n_m6 = sum(1 for b in snap["bouts"] if "m6" in b["consensus"])
    log("capture: %d bouts on %d events (%d with method props, %d matched to cards_upcoming) -> %s"
        % (len(snap["bouts"]), len(snap["meta"]["events"]), n_m6, sum(1 for b in snap["bouts"] if b["bout_id"]), out_path))


# ====================================================================== export
def _r(x, k=4):
    import numpy as np
    if isinstance(x, (list, tuple, np.ndarray)):
        return [_r(v, k) for v in x]
    if isinstance(x, dict):
        return {kk: _r(v, k) for kk, v in x.items()}
    if isinstance(x, (float, np.floating)):
        return round(float(x), k)
    if isinstance(x, (np.integer,)):
        return int(x)
    return x


def _sha(path):
    import hashlib
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        h.update(fh.read())
    return h.hexdigest()[:16]


def _strip_boot(t):
    """Keep means, CIs and paired differences; drop nothing else (the tables are small)."""
    return t


@stage("export")
def stage_export(args):
    import numpy as np
    cvr = json.load(open(os.path.join(CACHE, "cv.json")))
    dcv = json.load(open(os.path.join(CACHE, "debut_cv.json")))
    pr = json.load(open(PREREG)) if os.path.exists(PREREG) else None
    vfile = os.path.join(CACHE, "valid.json")
    val = json.load(open(vfile)) if os.path.exists(vfile) and os.path.exists(VALID_DONE) else None
    cells = pickle.load(open(os.path.join(CACHE, "cells.pkl"), "rb"))
    win = pickle.load(open(os.path.join(CACHE, "winner.pkl"), "rb"))
    ch = Spec.from_dict(cvr["selection"]["chosen"])
    A = assemble(ch.rep_m, ch.rep_r)
    # production parameters: the same spec refit on every development year with props (2021-2025), the
    # pre-registered deployment procedure (never scored on 2024-25)
    prod = ch.fit(A, (A["year"] >= 2021) & (A["year"] <= 2025))
    Dd = debut_assembly()
    dprod = debut_fit(Dd, dcv["mode"], (Dd["year"] >= 2021) & (Dd["year"] <= 2025) & Dd["hasM"]) if dcv.get("mode") else None
    mk_meta = jload("market.json").get("meta", {})
    out = {
        "meta": {"tool": "tools/props.py", "built": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
                 "protocol": "every 2026+ row dropped at parse; choices by forward-chained CV %s (fit 2021..Y-1) on "
                             "fights before 2024; 2024-25 scored once (valid); corner-symmetric pool (swap asserted); "
                             "event-cluster bootstrap 2,000 resamples, paired" % (CV_YEARS,),
                 "sources": {"bfo_event_pages": len(event_list()), "extract": "data/raw/odds/bfo_props_full.csv",
                             "extract_sha16": _sha(EXTRACT), "market_json_built": mk_meta.get("built"),
                             "ml2_json_built": jload("ml2.json")["meta"].get("built"),
                             "methodround_json_built": jload("methodround.json")["meta"].get("built"),
                             "user_agent": UA, "robots": "bestfightodds.com/robots.txt allows all but /cnadm/"},
                 "reproduction": {"S2+ml2win cells vs ml2 method.json 2024-25 max |diff|": cells["repro_max_abs_vs_ml2"],
                                  "W_ml2 vs ml2.json max |diff|": win["ml2_json_max_abs"],
                                  "close stack weights [market, ml2] by fit year": win["weights"]},
                 "families": {"m6": "method six-way [A KO, A SUB, A DEC, B KO, B SUB, B DEC] (draw leg in the de-vig "
                                    "when quoted)", "gd": "goes to decision (two-way)",
                              "er": "fight ends in round k + decision", "wr": "fighter wins in round k + decisions",
                              "mr": "fighter wins by KO / SUB in round k + decisions", "itd": "inside the distance",
                              "ou": "over k.5 rounds"},
                 "devig": "power within each family per book (multiplicative when a book's family sums to <= 1); "
                          "arithmetic mean over books; a book is dropped when its key scalar is > 0.15 from the "
                          "median book (>= 3 books); legs >= 1 or implausible overrounds (OVER_MAX) are rejected",
                 "timestamps": "historical props are BFO's closing prices (no per-book history; its line-history "
                               "endpoint is obfuscated and not used). `capture` stamps forward snapshots."},
        "coverage": cvr["coverage"], "consistency": cvr["consistency"], "families_tune_2021_2023": cvr["families_tune_2021_2023"],
        "cv": {"selection": cvr["selection"], "tables": cvr["cv_tables"], "corner_swap_max_abs": cvr["corner_swap_max_abs"]},
        "debut_cv": dcv, "prereg": pr, "valid": None,
        "model": {"spec": ch.as_dict(), "params": cvr["params_fit_2021_2023"], "params_production": prod,
                  "draw_c": A["draw_c"], "nb_ref_books": 4, "devig": "power", "outlier_max_dev": 0.15,
                  "over_max": OVER_MAX,
                  "degrade": "no method props -> S2 method | winner; no round props or round part not pooled -> S2 "
                             "round shapes; no props at all -> the model package unchanged (identity)",
                  "debut": {"mode": dcv.get("mode"), "params": dcv.get("params_fit_2021_2023"),
                            "params_production": dprod, "experts": ["debut method model", "props"]}},
        "fights": {}, "test_vectors": [],
    }
    if val:
        out["valid"] = {k: v for k, v in val.items() if k not in ("pool_cells_2024_25", "debut_pool_2024_25", "prereg")}
    # per-fight props (2021-2025) and pool cells (forward-chained 2022-2023; fit 2021-2023 for 2024-2025)
    folds = fwd_folds(A)
    M, R, _ = predict_folds(A, ch, folds)
    te = (A["year"] >= 2024) & (A["year"] <= 2025)
    if te.any():
        m2, r2 = ch.predict(A, te, cvr["params_fit_2021_2023"])
        M[te], R[te] = m2, r2
    ok = ~np.isnan(M[:, 0, 0])
    P = compose(A["W_close"], np.nan_to_num(M, nan=1 / 3), np.nan_to_num(R, nan=0.2), A["K"], A["draw_c"])
    for i, fid in enumerate(A["ids"]):
        rec = A["recs"][i]
        e = {"date": str(A["date"][i]), "K": int(A["K"][i]), "seg": rec.get("seg"),
             "set": "fit-only" if A["year"][i] == 2021 else ("cv" if A["year"][i] <= 2023 else "valid")}
        if rec.get("has"):
            e["props"] = {k: _r(rec[k]) for k in ("m6", "m6_draw", "gd", "er", "wr", "mr", "itd", "ou", "ml")
                          if rec.get(k) is not None}
            e["props"]["n_books"] = rec.get("n_books")
        if ok[i]:
            e["pool"] = _r(P[i], 5)
        out["fights"][fid] = e
    # test vectors for src/ml/propspool.js: raw book prices -> families -> pooled conditionals -> 23 cells
    by_mu = load_extract()
    rng = np.random.default_rng(5)
    cand = [i for i in np.flatnonzero(A["hasM"]) if A["recs"][i].get("mu") in by_mu]
    for i in rng.choice(cand, size=min(30, len(cand)), replace=False):
        rec = A["recs"][i]
        K = int(A["K"][i])
        books = {bk: {k: v for k, v in r.items() if k in EXTRACT_KEYS or k.endswith("_no") or k in ("ml1", "ml2")}
                 for bk, r in by_mu[rec["mu"]].items()}
        rows = np.zeros(len(A["ids"]), bool)
        rows[i] = True
        for par, tag in ((prod, "production"), (cvr["params_fit_2021_2023"], "fit_2021_2023")):
            m, r = ch.predict(A, rows, par)
            cell = compose(A["W_close"][rows], m, r, A["K"][rows], A["draw_c"])[0]
            out["test_vectors"].append({
                "fid": A["ids"][i], "params": tag, "K": K, "swap": bool(rec["sw"]), "books": books,
                "pA": float(A["W_close"][i]), "pModel": float(A["W_ml2"][i]),
                "model": {"M": A["M"]["S2"][i].tolist(), "R": A["R"]["S2"][i].tolist()},
                "expect": {"m6": rec.get("m6"), "m6_draw": rec.get("m6_draw"), "gd": rec.get("gd"), "er": rec.get("er"),
                           "wr": rec.get("wr"), "mr": rec.get("mr"), "n_books": rec.get("n_books"),
                           "M": m[0].tolist(), "R": r[0].tolist(), "cells": cell.tolist()}})
    json.dump(out, open(OUT_JSON, "w"), separators=(",", ":"), default=float)
    log("export: %s (%.0f KB; valid %s)" % (OUT_JSON, os.path.getsize(OUT_JSON) / 1024, "included" if val else "not run"))


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
