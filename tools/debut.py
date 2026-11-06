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
import os

for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):   # shared box: no BLAS oversubscription
    os.environ.setdefault(_v, "1")
import argparse
import datetime as dt
import json
import math
import pickle
import re
import sys
import time
import warnings

warnings.filterwarnings("ignore")
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


# ------------------------------------------------------------------ build: pages, network, features
def _parse_rows(P, ub):
    """preufc.build's row preparation for one parsed page: pro rows (oldest first) with date, promotion, ufcstats
    fight id of matched UFC bouts, UFC flag and opponent Sherdog id; plus exhibition and amateur rows."""
    rows = PU.row_list(P)
    matched = []
    if ub:
        _, matched = PU.verify({"sections": {"pro": rows}}, ub)
    fidrow = {i: fid for fid, i, q in matched}
    for i, row in enumerate(rows):
        row["_d"] = dt.date.fromisoformat(row["date"]) if row["date"] else None
        row["_promo"] = PU.promotion(row["event"])
        row["_fid"] = fidrow.get(i)
        row["_ufc"] = row["_fid"] is not None or row["_promo"] == "UFC"
        row["_sid"] = PU.sid(row["opp_href"])
    ex, am = [], []
    for k, v in P["sections"].items():
        for x in v:
            if "exhibition" in k:
                ex.append(x)
            elif "amateur" in k:
                am.append(x)
    for x in ex + am:
        x["_d"] = dt.date.fromisoformat(x["date"]) if x["date"] else None
    return rows, ex, am, matched


SC = {"W": 1.0, "L": 0.0, "D": 0.5}
DIV_LBS = {"Flyweight": 125, "Bantamweight": 135, "Featherweight": 145, "Lightweight": 155, "Welterweight": 170,
           "Middleweight": 185, "Light Heavyweight": 205, "Heavyweight": 265, "Women's Strawweight": 115,
           "Women's Flyweight": 125, "Women's Bantamweight": 135, "Women's Featherweight": 145}


class GlobalNet:
    """Strict walk-forward global rating over every known pro MMA bout: all UFC bouts (ufcstats) plus the non-UFC
    rows of the Sherdog pages available at the cutoff. Bradley-Terry in logit units, fit by MAP at each Jan 1 cutoff C
    on bouts dated before C, with exponential time decay (half-life h years) and promotion-level priors:
        theta_i ~ N(m_i, 1/lam_u),  m_i = sum_g c_ig mu_g / sum_g c_ig  (c_ig: decayed count of i's bouts in g),
        mu_g ~ N(0, 1/lam_g).
    A page is available at C if it belongs to a UFC debutant whose first UFC bout is in [2012-01-01, C) (a complete
    set, crawled) or to a one-hop opponent crawled because of such a debutant (availability = that debutant's debut
    date). Roster pages of earlier debutants are never used (survivor selection); their bouts enter only through
    UFC records and other pages. Ratings for a bout at D are then computed by rate(): a one-fighter MAP over the
    fighter's own rows before D with opponents' ratings looked up in the fit at C = Jan 1 of D's year (opponents with
    their own page get a rating from their rows before the fight date; unseen opponents get their promotion's mu)."""

    def __init__(self, bouts, half_life=4.0, lam_u=1.0, lam_g=0.5):
        # bouts: list of (date, a, b, score, promo, avail_date)
        self.bouts = bouts
        self.h, self.lam_u, self.lam_g = half_life, lam_u, lam_g
        self.fits = {}

    def fit(self, C):
        import numpy as np
        from scipy.optimize import minimize
        B = [t for t in self.bouts if t[0] < C and t[5] < C]
        ids, gids = {}, {}
        A_, B_, Y_, W_, G_ = [], [], [], [], []
        for d, a, b, sc, g, av in B:
            A_.append(ids.setdefault(a, len(ids)))
            B_.append(ids.setdefault(b, len(ids)))
            G_.append(gids.setdefault(g, len(gids)))
            Y_.append(sc)
            W_.append(0.5 ** (((C - d).days / 365.25) / self.h))
        A_, B_, Y_, W_, G_ = map(np.array, (A_, B_, Y_, W_, G_))
        nf, ng = len(ids), len(gids)
        # decayed promotion exposure of each fighter: c_ig over both corners
        rows = np.concatenate([A_, B_])
        cols = np.concatenate([G_, G_])
        vals = np.concatenate([W_, W_])
        import scipy.sparse as sp
        Cm = sp.csr_matrix((vals, (rows, cols)), shape=(nf, ng))
        tot = np.asarray(Cm.sum(axis=1)).ravel()
        Pm = sp.diags(1.0 / np.maximum(tot, 1e-12)) @ Cm              # nf x ng row-normalised
        lu, lg = self.lam_u, self.lam_g

        def f(x):
            th, mu = x[:nf], x[nf:]
            z = th[A_] - th[B_]
            p = 1 / (1 + np.exp(-z))
            L = np.sum(W_ * (np.logaddexp(0, z) - Y_ * z))
            gz = W_ * (p - Y_)
            g_th = np.bincount(A_, gz, nf) - np.bincount(B_, gz, nf)
            m = Pm @ mu
            r = th - m
            L += 0.5 * lu * r @ r + 0.5 * lg * mu @ mu
            g_th += lu * r
            g_mu = -lu * (Pm.T @ r) + lg * mu
            return L, np.concatenate([g_th, g_mu])
        res = minimize(f, np.zeros(nf + ng), jac=True, method="L-BFGS-B", options={"maxiter": 500})
        th, mu = res.x[:nf], res.x[nf:]
        self.fits[C] = {"theta": {k: float(th[i]) for k, i in ids.items()},
                        "mu": {k: float(mu[i]) for k, i in gids.items()}, "n_bouts": len(B), "nf": nf, "ng": ng,
                        "nit": res.nit}
        return self.fits[C]

    def cut(self, D):
        C = dt.date(D.year, 1, 1)
        if C not in self.fits:
            self.fit(C)
        return self.fits[C]

    def rate(self, rows, D, F, opp_rating=None, prior=None, lam=None):
        """One-fighter MAP over rows [(date, opp_key, score, promo)] dated before D; returns (theta, sd, m, sos).
        Opponent rating: opp_rating(opp_key, date) if given and not None, else the fit's theta, else mu of the
        row's promotion. Prior mean: `prior` if given, else the decayed mean of mu over the fighter's rows."""
        lam = self.lam_u if lam is None else lam
        mu = F["mu"]
        th = F["theta"]
        xs, ys, ws, ps = [], [], [], []
        for d, o, sc, g in rows:
            if d is None or d >= D or sc is None:
                continue
            w = 0.5 ** (((D - d).days / 365.25) / self.h)
            ro = opp_rating(o, d) if opp_rating else None
            if ro is None:
                ro = th.get(o)
            if ro is None:
                ro = mu.get(g, 0.0)
            xs.append(ro)
            ys.append(sc)
            ws.append(w)
            ps.append(mu.get(g, 0.0))
        if prior is None:
            m = (sum(w * p for w, p in zip(ws, ps)) / sum(ws)) if ws else 0.0
        else:
            m = prior
        t = m
        for _ in range(30):                                          # Newton on a 1-D concave objective
            g_, h_ = lam * (t - m), lam
            for ro, y, w in zip(xs, ys, ws):
                p = 1 / (1 + math.exp(-(t - ro)))
                g_ += w * (p - y)
                h_ += w * p * (1 - p)
            step = g_ / h_
            t -= step
            if abs(step) < 1e-7:
                break
        sos = (sum(w * r for w, r in zip(ws, xs)) / sum(ws)) if ws else None
        return t, 1 / math.sqrt(h_ if xs else lam), m, sos


def load_universe_strict():
    """load_universe with build_db.parse_fights wrapped so every 2026+ fight is dropped right after parsing."""
    import build_db as B
    if not getattr(B.parse_fights, "_debut_wrapped", False):
        orig = B.parse_fights

        def dev_only(log):
            fs, ex = orig(log)
            return [f for f in fs if f.date < VAULT_FROM], ex
        dev_only._debut_wrapped = True
        B.parse_fights = dev_only
    return load_universe()


def build(args):
    import numpy as np
    import pandas as pd
    t0 = time.time()
    os.makedirs(OUTC, exist_ok=True)
    fights, people, bouts, uni = load_universe_strict()
    assert max(f.date for f in fights) < VAULT_FROM
    deb = debutants_of(uni)
    res = json.load(open(DRESOLVE)) if os.path.exists(DRESOLVE) else json.load(open(os.path.join(PCACHE, "resolve.json")))
    fx = PU.Fetcher(offline=True)
    first_ufc = {p: min(d for d, *_ in ub) for p, ub in bouts.items() if ub}
    st = json.load(open(STATE)) if os.path.exists(STATE) else {}
    done = st.get("ranks_complete")
    if args.opp_k is not None:
        opp_k = args.opp_k
    else:                                          # uniform policy: only ranks complete for every debutant
        opp_k = 0
        while done is not None and opp_k in done:
            opp_k += 1
    print("one-hop opponent ranks used: %d (crawl state: %s)" % (opp_k, done), flush=True)
    # ---- pages of resolved persons
    rowsby, exby, amby, bio = {}, {}, {}, {}
    href2p = {}
    for p, r in res.items():
        if r.get("status") != "ok" or p not in people or p not in bouts:
            continue
        P = PU.parse_fighter(fx.get(PU.BASE + r["href"], fighter_path(r["href"])))
        if not P:
            continue
        rows, ex, am, matched = _parse_rows(P, bouts[p])
        rowsby[p], exby[p], amby[p], bio[p] = rows, ex, am, P["bio"]
        href2p[PU.sid(r["href"])] = p
        for fid, i, q in matched:
            h = rows[i]["opp_href"]
            if h and not q.startswith(("amb:", "name:")):
                href2p.setdefault(PU.sid(h), q)
    p2sid = {p: s for s, p in href2p.items()}
    print("pages: %d resolved persons parsed; %d of %d debutants have a page (%.0f s)" % (
        len(rowsby), sum(p in rowsby for p in deb), len(deb), time.time() - t0), flush=True)
    # ---- one-hop opponent pages (crawled for the last OPP_K pre-UFC fights of each debutant)
    opp_av = {}                                    # sid -> earliest debut date of a debutant that lists him
    opp_rank = {}                                  # (debutant person, sid) -> rank (0 = last pre-UFC fight)
    for p, d0 in deb.items():
        if p not in rowsby:
            continue
        pre = [x for x in rowsby[p] if x["_d"] and x["_d"] < d0 and not x["_ufc"]]
        for k, x in enumerate(reversed(pre[-opp_k:] if opp_k else [])):
            s = x["_sid"]
            if s is None:
                continue
            opp_rank[(p, s)] = min(k, opp_rank.get((p, s), k))
            if s not in opp_av or d0 < opp_av[s]:
                opp_av[s] = d0
    opp_rows = {}
    for s in opp_av:
        if s in href2p and href2p[s] in rowsby:
            continue
        opp_rows[s] = None                         # filled below from the page index ("<Name>-<sid>.html")
    idx = {}
    for base in (PCACHE, DCACHE):
        dd = os.path.join(base, "fighter")
        if os.path.isdir(dd):
            for fn in os.listdir(dd):
                m = re.search(r"-(\d+)\.html$", fn)
                if m:
                    idx.setdefault(int(m.group(1)), os.path.join(dd, fn))
    n_opp_pages = 0
    for s in list(opp_rows):
        fp = idx.get(s)
        if not fp or os.path.getsize(fp) == 0:
            continue
        P = PU.parse_fighter(open(fp, encoding="utf-8", errors="replace").read())
        if not P:
            continue
        rows, _, _, _ = _parse_rows(P, None)
        opp_rows[s] = rows
        n_opp_pages += 1
    print("one-hop: %d opponent ids, %d with a cached page (%.0f s)" % (len(opp_av), n_opp_pages, time.time() - t0),
          flush=True)
    # ---- promotion quality (feeder share, graduates' first-3 results), graduates from 2012 (complete set)
    import bisect
    grad_from = UNIVERSE_FROM
    grads, gradres = defaultdict(list), defaultdict(list)
    for p, rows in rowsby.items():
        d0 = first_ufc.get(p)
        if d0 is None or d0 < grad_from:
            continue
        promos = set(r["_promo"] for r in rows if not r["_ufc"] and r["_d"] and r["_d"] < d0)
        ub = sorted(bouts[p], key=lambda t: t[0])[:3]
        for pr in promos:
            grads[pr].append(d0)
            for (d, q, on, f) in ub:
                if f.winner in ("A", "B"):
                    gradres[pr].append((d, 1 if (f.winner == "A") == (f.persons[0] == p) else 0))
    for pr in grads:
        grads[pr].sort()
        gradres[pr].sort()
    grad_dates = {pr: [d for d, _ in v] for pr, v in gradres.items()}
    grad_cumw = {pr: list(np.cumsum([w for _, w in v])) for pr, v in gradres.items()}
    all_deb = sorted(first_ufc[p] for p in rowsby if first_ufc.get(p) and first_ufc[p] >= grad_from)

    def promo_q(pr, D):
        G = bisect.bisect_left(all_deb, D)
        g = bisect.bisect_left(grads.get(pr, []), D)
        k = bisect.bisect_left(grad_dates.get(pr, []), D)
        wins = grad_cumw[pr][k - 1] if k > 0 else 0
        return {"feed": math.log1p(1000.0 * g / max(G, 1)), "grad": (wins + 5.0) / (k + 10.0), "n_grad": g, "n_res": k}
    resd = {p: res[p] for p in rowsby}
    strict = PU.StrictNetwork(rowsby, resd, first_ufc, grad_from, dt.date(2026, 1, 1))
    print("strict network (preufc's, graduates from 2012): %d fights (%.0f s)" % (strict.n_fights, time.time() - t0),
          flush=True)
    # ---- global network bouts
    def key_of_person(p):
        s = p2sid.get(p)
        return s if s is not None else "u:" + p
    gb = {}
    for f in fights:                                               # every UFC bout, always available
        a, b = f.persons
        sc = {"A": 1.0, "B": 0.0, "D": 0.5}.get(f.winner)
        if a == b or sc is None:
            continue
        ka, kb = key_of_person(a), key_of_person(b)
        gb[("U", f.fid)] = (f.date, ka, kb, sc, "UFC", f.date)
    page_av = {}
    for p, rows in rowsby.items():
        d0 = first_ufc.get(p)
        if d0 is not None and d0 >= grad_from:
            page_av[p2sid.get(p)] = d0
    for s, av in opp_av.items():
        if s not in page_av or av < page_av[s]:
            page_av[s] = av if s not in page_av else min(av, page_av[s])
    def add_rows(me, rows, av):
        for r in rows:
            if not r["_d"] or r["_sid"] is None or r["_ufc"]:
                continue
            sc = SC.get(r["res"])
            if sc is None:
                continue
            a, b = me, r["_sid"]
            k = (r["date"], min(a, b), max(a, b))
            old = gb.get(k)
            if old is not None:
                if av < old[5]:
                    gb[k] = old[:5] + (av,)
                continue
            gb[k] = (r["_d"], a, b, sc, r["_promo"], av)
    for p, rows in rowsby.items():
        s = p2sid.get(p)
        if s is not None and s in page_av:
            add_rows(s, rows, page_av[s])
    for s, rows in opp_rows.items():
        if rows and s in page_av:
            add_rows(s, rows, page_av[s])
    gbl = sorted(gb.values(), key=lambda t: t[0])
    print("global network: %d bouts (%d UFC), %d pages with availability (%.0f s)" % (
        len(gbl), sum(1 for t in gbl if t[4] == "UFC"), len(page_av), time.time() - t0), flush=True)
    pickle.dump({"gbl": gbl}, open(os.path.join(OUTC, "gnet_bouts.pkl"), "wb"))

    # ---- UFC-side walk-forward features (preufc's), plain Elo (elo_report's K/boost), fight week, lines
    rep = json.load(open(os.path.join(DERIVED, "elo_report.json")))
    E = PU.EloRunner(fights, rep["chosen"]["K"], rep["chosen"]["boost"])
    elo_pre = E.run()
    ufc = PU.ufc_walk(fights, people)
    fw = json.load(open(os.path.join(DERIVED, "fightweek.json")))["fights"]
    lines = universe_lines([f for f, _, _ in uni])
    print("ufc walk, Elo, fight week, lines (%d of %d bouts with a close) (%.0f s)" % (
        sum(1 for v in lines.values() if v.get("close") is not None), len(uni), time.time() - t0), flush=True)

    # ---- per-side rows
    def own_rows(p, D):
        """[(date, opp_key, score, promo)] before D: UFC bouts (ufcstats) + non-UFC page rows when the page is
        available at D (the fighter is a 2012+ debutant whose debut is before or at D, i.e. his own page)."""
        out = []
        for (d, q, on, f) in bouts.get(p, []):
            if d >= D:
                continue
            sc = {"A": 1.0, "B": 0.0, "D": 0.5}.get(f.winner)
            if sc is None:
                continue
            if f.persons[1] == p:
                sc = 1.0 - sc
            out.append((d, key_of_person(q), sc, "UFC"))
        d0 = first_ufc.get(p)
        if p in rowsby and d0 is not None and d0 >= grad_from and d0 <= D:
            for r in rowsby[p]:
                if r["_d"] and r["_d"] < D and not r["_ufc"] and r["_sid"] is not None and SC.get(r["res"]) is not None:
                    out.append((r["_d"], r["_sid"], SC[r["res"]], r["_promo"]))
        return out

    nets = {}
    for hl in args.half_lives:
        nets[hl] = GlobalNet(gbl, half_life=hl)
    recs = []
    for f, na, nb in uni:
        a, b = f.persons
        D = f.date
        r = {"fid": f.fid, "date": D, "year": D.year, "event": f.event, "winner": f.winner, "cat": f.cat,
             "rnd": f.rnd, "method": f.method, "division": f.division, "rounds": f.sched, "title": bool(f.title),
             "wc": f.wc, "nA": na, "nB": nb, "slugA": people[a]["slug"], "slugB": people[b]["slug"],
             "nameA": f.names[0], "nameB": f.names[1], "elo_p": elo_pre[f.fid][2]}
        L = lines.get(f.fid, {})
        r["p_close"], r["p_open"] = L.get("close"), L.get("open")
        fwr = fw.get(f.fid)
        ua, ub_ = ufc[f.fid]
        for tag, p, u, n in (("A", a, ua, na), ("B", b, ub_, nb)):
            bs = PU.base_side(u, elo_pre[f.fid][0 if tag == "A" else 1])
            for k, v in bs.items():
                r[k + "_" + tag] = v
            for k in ("ko_w", "sub_w", "ko_l", "sub_l", "w", "l"):
                r["u" + k + "_" + tag] = u[k]
            r["debut_" + tag] = 1.0 if n == 0 else 0.0
            # pre-UFC snapshot (preufc's features, strict network, graduates from 2012)
            snap = None
            if p in rowsby:
                tt = people[p].get("tott") or {}
                dob = tt.get("dob")
                if dob is None and bio[p].get("dob"):
                    dob = dt.date.fromisoformat(bio[p]["dob"])
                snap = PU.snapshot_feats(rowsby[p], D, dob, exby[p], None, promo_q)
                snap.update(strict.feats(p, p2sid.get(p), rowsby[p], D))
                am = [x for x in amby[p] if x["_d"] and x["_d"] < D]
                snap["am_n"] = len(am)
                snap["am_w"] = sum(1 for x in am if x["res"] == "W")
                snap["am_l"] = sum(1 for x in am if x["res"] == "L")
            r["page_" + tag] = 1.0 if snap is not None else 0.0
            sp = PU.side_pre(snap, n) if snap is not None else None
            for k in PU.PRE_KEYS + ["pre_layoff"]:
                r[k + "_" + tag] = (sp or {}).get(k, float("nan"))
            if snap is not None:
                r["am_n_" + tag] = snap["am_n"]
                r["am_wpct_" + tag] = math.log((snap["am_w"] + 1.0) / (snap["am_l"] + 1.0))
                r["exh_n_" + tag] = snap["exh_n"]
                r["exh_wpct_" + tag] = (snap["exh_w"] + 0.5) / (snap["exh_n"] + 1.0) - 0.5 if snap["exh_n"] else 0.0
                r["dwcs_n_" + tag] = snap["dwcs_n"]
                r["pro_n_" + tag] = snap["n"]
                r["lay_sd_" + tag] = snap["layoff_days"]
                r["n2y_" + tag] = snap["n_2y"]
                r["lstreak_" + tag] = snap["lstreak_all"]
                r["sd_ko_w_" + tag], r["sd_sub_w_" + tag] = snap["ko_w"], snap["sub_w"]
                r["sd_ko_l_" + tag], r["sd_sub_l_" + tag] = snap["ko_l"], snap["sub_l"]
                r["sd_dec_w_" + tag], r["sd_dec_l_" + tag] = snap["dec_w"], snap["dec_l"]
                r["sd_w_" + tag], r["sd_l_" + tag] = snap["w"], snap["l"]
            # one-hop opponent records (debutant's last OPP_K pre-UFC opponents with a crawled page)
            if n == 0 and p in rowsby:
                pre = [x for x in rowsby[p] if x["_d"] and x["_d"] < D and not x["_ufc"]]
                stats = []
                for k, x in enumerate(reversed(pre[-opp_k:] if opp_k else [])):
                    orows = opp_rows.get(x["_sid"]) if x["_sid"] is not None else None
                    if orows is None and x["_sid"] in href2p and href2p[x["_sid"]] in rowsby:
                        orows = rowsby[href2p[x["_sid"]]]
                    if orows is None:
                        stats.append((k, None))
                        continue
                    ob = [y for y in orows if y["_d"] and y["_d"] < x["_d"]]
                    w_ = sum(1 for y in ob if y["res"] == "W")
                    l_ = sum(1 for y in ob if y["res"] == "L")
                    later_ufc = None
                    stats.append((k, (w_, l_, len(ob), x["res"])))
                r["opp1h_" + tag] = stats
            # fight week (tools/fightweek.py, keyed by ufcstats id; sides by slug)
            if fwr:
                side = "A" if fwr.get("A") == people[p]["slug"] else ("B" if fwr.get("B") == people[p]["slug"] else None)
                if side:
                    sn = (fwr.get("short_notice") or {}).get(side)
                    r["repl_" + tag] = 1.0 if (fwr.get("replacement") or {}).get(side) else 0.0
                    r["short_" + tag] = float(sn) if sn is not None else None
                    oc = (fwr.get("opp_change") or {}).get(side)
                    r["oppchg_" + tag] = 1.0 if oc is not None else 0.0
                    r["miss_" + tag] = 1.0 if (fwr.get("missed") or {}).get(side) else 0.0
                    r["home_" + tag] = 1.0 if (fwr.get("home") or {}).get(side) else 0.0
                    tk = (fwr.get("travel_km") or {}).get(side)
                    r["travel_" + tag] = tk
            # page availability (a pre-UFC block counts only for pages known at D: 2012+ debutants), age fallback,
            # weight-class move vs the previous UFC bout (veterans; debutants 0), previous UFC bout count
            d0 = first_ufc.get(p)
            r["pav_" + tag] = 1.0 if (p in rowsby and d0 is not None and d0 >= grad_from and d0 <= D) else 0.0
            if not (r["age_" + tag] == r["age_" + tag]) and p in bio and bio[p].get("dob"):
                r["age_" + tag] = (D - dt.date.fromisoformat(bio[p]["dob"])).days / 365.25
            prev = [t for t in bouts.get(p, []) if t[0] < D]
            if prev and f.division in DIV_LBS:
                pd_ = max(prev, key=lambda t: t[0])[3].division
                r["wcmove_" + tag] = (float(np.sign(DIV_LBS[f.division] - DIV_LBS[pd_]))
                                      if pd_ in DIV_LBS else 0.0)
            else:
                r["wcmove_" + tag] = 0.0
            r["own_rows_" + tag] = own_rows(p, D)
            r["key_" + tag] = key_of_person(p)
            r["person_" + tag] = p
        if fwr:
            r["catch"] = 1.0 if (fwr.get("catchweight") or {}).get("is") else 0.0
        recs.append(r)
    print("rows %d (%.0f s)" % (len(recs), time.time() - t0), flush=True)

    # ---- global ratings per side, each half-life
    def opp_rating_fn(net, F, p, D):
        cache = {}

        def fn(o, d):
            if o in cache.get(d, {}):
                return cache[d][o]
            # an opponent's own page counts only if it was crawled for this debutant (rank < opp_k) or for a
            # debutant who debuted before D: never because a later debutant fought him
            ok = isinstance(o, int) and ((p, o) in opp_rank or opp_av.get(o, VAULT_FROM) < D)
            rows = opp_rows.get(o) if ok else None
            val = None
            if rows:
                rr = [(y["_d"], y["_sid"], SC.get(y["res"]), y["_promo"]) for y in rows
                      if y["_d"] and y["_d"] < d and y["_sid"] is not None and not y["_ufc"]]
                if rr:
                    val = net.rate(rr, d, F)[0]
            cache.setdefault(d, {})[o] = val
            return val
        return fn
    for hl, net in nets.items():
        tg = time.time()
        for r in recs:
            F = net.cut(r["date"])
            for tag in ("A", "B"):
                rows = r["own_rows_" + tag]
                fn = opp_rating_fn(net, F, r["person_" + tag], r["date"]) if r["debut_" + tag] else None
                th, sd, m, sos = net.rate(rows, r["date"], F, opp_rating=fn)
                r["g%s_th_%s" % (hl, tag)] = th
                r["g%s_sd_%s" % (hl, tag)] = sd
                r["g%s_m_%s" % (hl, tag)] = m
                r["g%s_sos_%s" % (hl, tag)] = sos if sos is not None else float("nan")
        print("global net h=%s: %d cutoffs fit (%.0f s); bouts per fit %s" % (
            hl, len(net.fits), time.time() - tg, [v["n_bouts"] for k, v in sorted(net.fits.items())][-3:]), flush=True)
    for r in recs:
        for tag in ("A", "B"):
            r.pop("own_rows_" + tag, None)
    df = pd.DataFrame(recs)
    df["y"] = (df["winner"] == "A").astype(float)
    df["decisive"] = df["winner"].isin(["A", "B"])
    meta = {"built": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(), "n": len(df),
            "half_lives": args.half_lives, "opp_pages": n_opp_pages, "opp_ids": len(opp_av),
            "pages": len(rowsby), "global_bouts": len(gbl), "strict_fights": strict.n_fights,
            "crawl_state": json.load(open(STATE)) if os.path.exists(STATE) else None,
            "net_fits": {str(hl): {str(C): {k: v for k, v in F.items() if k in ("n_bouts", "nf", "ng", "nit")}
                                   for C, F in net.fits.items()} for hl, net in nets.items()}}
    pickle.dump({"df": df, "meta": meta}, open(os.path.join(OUTC, "frame.pkl"), "wb"))
    print("wrote out/debut_cache/frame.pkl: %d rows, %d columns (%.0f s)" % (len(df), df.shape[1], time.time() - t0))


def universe_lines(ufs):
    """Closing (power de-vig) and opening (multiplicative de-vig) probabilities for corner A, tools/market.py's
    assembly and outcome-blind source choice applied to the debut bouts (market.json covers backtest bouts only)."""
    import market as MK
    fl = [{"id": f.fid, "date": f.date.isoformat(), "A": {"name": f.names[0]}, "B": {"name": f.names[1]}} for f in ufs]
    recs, diag = MK.assemble(fl)
    out = {}
    for f in ufs:
        c = MK.choose(recs[f.fid])
        o = {}
        if c.get("close_dec"):
            o["close"] = MK.devig(*c["close_dec"], method="power")
            o["close_src"] = c.get("src")
        if c.get("open_dec"):
            o["open"] = MK.devig(*c["open_dec"])
        out[f.fid] = o
    return out



# ------------------------------------------------------------------ modelling (forward-chained CV <= 2023)
CV_YEARS = [2019, 2020, 2021, 2022, 2023]          # scored CV years (fit on every earlier year from 2012)
STACK_YEARS = [2021, 2022, 2023]                   # stack gate (ml2's forward-chained 2021-2023 CV)
SEL_MIN = 0.0005                                   # ml2's rule: a block / expert enters only if CV improves by more
CS = [0.003, 0.01, 0.03, 0.1, 0.3, 1.0]
TAUS = [2.0, 8.0]
PCLIP = 0.01
BLOCKS = {
    "core": ["elo", "debut"],
    "ufc": ["logn", "uwin", "ufin", "ufinl"],
    "bio": ["age", "lay", "wcmove"],
    "pre": ["pre_wpct", "pre_logn", "pre_fin", "pre_finl", "pre_streak", "pre_feed", "pre_grad", "pre_oppufc",
            "pre_netelo", "pre_dwcs", "pre_agedeb"],
    "gnet2": ["g2.0_th", "g2.0_sos", "g2.0_sd"],
    "gnet4": ["g4.0_th", "g4.0_sos", "g4.0_sd"],
    "extra": ["am_n", "am_wpct", "pre_tuf", "short", "repl", "miss"],
    "opp1h": ["o1_wp", "o1_logn", "o1_good"],
}
FADED = set(BLOCKS["pre"]) | {"am_n", "am_wpct", "pre_tuf"}     # pre-UFC information fades with UFC experience
EXCLUSIVE = [{"gnet2", "gnet4"}]


def load_frame():
    import pandas as pd  # noqa: F401
    F = pickle.load(open(os.path.join(OUTC, "frame.pkl"), "rb"))
    df = F["df"]
    assert (df["date"] < VAULT_FROM).all()
    df = df.sort_values(["date", "fid"]).reset_index(drop=True)
    return df, F["meta"]


def side_raw(df, tag):
    """Raw per-side columns (NaN = unknown) used by every block."""
    import numpy as np
    n = len(df)
    g = lambda k: df[k + "_" + tag].to_numpy(float) if (k + "_" + tag) in df else np.full(n, np.nan)  # noqa: E731
    out = {}
    for k in ("elo", "debut", "logn", "uwin", "ufin", "ufinl", "age", "wcmove"):
        out[k] = g(k)
    out["wcmove"] = np.nan_to_num(out["wcmove"])
    lay = g("layoff")
    out["lay"] = np.where(np.isnan(lay), g("pre_layoff"), lay)
    pav = g("pav") if ("pav_" + tag) in df else g("debut")
    pav = np.nan_to_num(pav)
    for k in BLOCKS["pre"] + ["pre_tuf"]:
        v = g(k)
        out[k] = np.where(pav > 0, v, np.nan)
    am = g("am_n")
    out["am_n"] = np.where(pav > 0, np.log1p(am), np.nan)
    out["am_wpct"] = np.where(pav > 0, g("am_wpct"), np.nan)
    sh = g("short")
    out["short"] = np.where(np.isnan(sh), 0.0, (sh <= 21).astype(float))
    out["repl"] = np.nan_to_num(g("repl"))
    out["miss"] = np.nan_to_num(g("miss"))
    for h in ("2.0", "4.0"):
        for k in ("th", "sos", "sd"):
            out["g%s_%s" % (h, k)] = g("g%s_%s" % (h, k))
    # one-hop opponents (debutants only): mean pre-fight win share, mean log fights, share with a winning record
    wp, ln, gd = np.full(n, np.nan), np.full(n, np.nan), np.full(n, np.nan)
    col = "opp1h_" + tag
    if col in df:
        for i, st in enumerate(df[col].tolist()):
            if not isinstance(st, list):
                continue
            v = [s for _, s in st if s is not None]
            if v:
                wp[i] = sum((w + 1.0) / (w + l + 2.0) for w, l, nn, _ in v) / len(v)
                ln[i] = sum(math.log1p(nn) for w, l, nn, _ in v) / len(v)
                gd[i] = sum(1.0 for w, l, nn, _ in v if w > l) / len(v)
    out["o1_wp"], out["o1_logn"], out["o1_good"] = wp, ln, gd
    out["_n"] = g("n") if ("n_" + tag) in df else df["n" + tag].to_numpy(float)
    return out


class DebutLR:
    """Symmetric no-intercept logistic on side differences (preufc.DiffModel's construction): side columns are centred
    at the training mean (unknown -> the mean, i.e. 0), pre-UFC columns faded by exp(-n_UFC / tau), the difference
    A - B scaled by its training sd. P(A | A, B) = 1 - P(B | B, A) exactly."""

    def __init__(self, cols, C=0.1, tau=8.0):
        self.cols, self.C, self.tau = list(cols), C, tau

    def _sides(self, RA, RB):
        import numpy as np
        XA = np.vstack([RA[k] for k in self.cols]).T
        XB = np.vstack([RB[k] for k in self.cols]).T
        return XA, XB

    def design(self, RA, RB, fit=False):
        import numpy as np
        XA, XB = self._sides(RA, RB)
        if fit:
            mu = np.nanmean(np.vstack([XA, XB]), axis=0)
            self.mu = np.where(np.isnan(mu), 0.0, mu)
        XA = np.nan_to_num(XA - self.mu)
        XB = np.nan_to_num(XB - self.mu)
        fa = np.exp(-RA["_n"] / self.tau)
        fb = np.exp(-RB["_n"] / self.tau)
        for j, k in enumerate(self.cols):
            if k in FADED:
                XA[:, j] *= fa
                XB[:, j] *= fb
        D = XA - XB
        if fit:
            sd = D.std(axis=0)
            self.sd = np.where(sd < 1e-9, 1.0, sd)
        return D / self.sd

    def fit(self, RA, RB, y):
        from sklearn.linear_model import LogisticRegression
        D = self.design(RA, RB, fit=True)
        self.m = LogisticRegression(C=self.C, fit_intercept=False, max_iter=5000).fit(D, y)
        self.coef = self.m.coef_[0]
        return self

    def predict(self, RA, RB):
        import numpy as np
        z = self.design(RA, RB) @ self.coef
        return 1.0 / (1.0 + np.exp(-z))

    def export(self):
        return {"cols": self.cols, "C": self.C, "tau": self.tau, "mu": [float(x) for x in self.mu],
                "sd": [float(x) for x in self.sd], "coef": [float(x) for x in self.coef],
                "faded": [k for k in self.cols if k in FADED]}


def take(R, m):
    return {k: v[m] for k, v in R.items()}


def ll_vec(p, y):
    import numpy as np
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


def boot_ci(groups, vals, B=2000, seed=7):
    """Event-cluster bootstrap (resample cards) of the mean of each column of vals (n x k): [mean, lo, hi] per col."""
    import numpy as np
    vals = np.asarray(vals, float)
    if vals.ndim == 1:
        vals = vals[:, None]
    g = np.asarray(groups)
    ug, inv = np.unique(g, return_inverse=True)
    S = np.zeros((len(ug), vals.shape[1]))
    np.add.at(S, inv, vals)
    cnt = np.bincount(inv, minlength=len(ug)).astype(float)
    rng = np.random.default_rng(seed)
    out = []
    draws = rng.integers(0, len(ug), size=(B, len(ug)))
    for b in range(B):
        d = draws[b]
        out.append(S[d].sum(axis=0) / cnt[d].sum())
    out = np.array(out)
    mean = vals.mean(axis=0)
    lo, hi = np.percentile(out, [2.5, 97.5], axis=0)
    return [[round(float(mean[j]), 5), round(float(lo[j]), 5), round(float(hi[j]), 5)] for j in range(vals.shape[1])]


def paired(groups, a, b, y, B=2000):
    """Mean log-loss difference a - b with a paired event-cluster CI and P(a better)."""
    import numpy as np
    d = ll_vec(a, y) - ll_vec(b, y)
    m, lo, hi = boot_ci(groups, d, B)[0]
    return {"diff": m, "ci": [lo, hi], "n": int(len(y))}


def stack_fit(Z, y, w=None):
    """tools/ml2.py stack_fit (copied): non-negative logit weights, no intercept; Z = n x k expert logits."""
    import numpy as np
    from scipy.optimize import minimize
    n, k = Z.shape
    w = np.ones(n) if w is None else w
    w = w / w.sum()

    def f(b):
        q = Z @ b
        p = 1 / (1 + np.exp(-q))
        return np.sum(w * (np.logaddexp(0, q) - y * q)) + 1e-4 * b @ b, Z.T @ (w * (p - y)) + 2e-4 * b
    r = minimize(f, np.full(k, 0.3), jac=True, method="L-BFGS-B", bounds=[(0, None)] * k)
    return r.x


def zlogit(p):
    import numpy as np
    p = np.clip(np.asarray(p, float), PCLIP, 1 - PCLIP)
    return np.log(p / (1 - p))


def prep(df):
    """Decisive rows, both sides' raw columns, swapped copies, the walk-forward reference predictions."""
    import numpy as np
    pre = json.load(open(os.path.join(DERIVED, "preufc.json")))["predictions"]
    df = df.copy()
    df["p_seeded"] = [pre[f]["p_seeded_elo"] if f in pre else np.nan for f in df["fid"]]
    df["p_preufc_elo"] = [pre[f]["p_elo"] if f in pre else np.nan for f in df["fid"]]
    dec = df[df["decisive"]].reset_index(drop=True)
    RA, RB = side_raw(dec, "A"), side_raw(dec, "B")
    return dec, RA, RB


def cfg_cols(blocks):
    cols = []
    for b in blocks:
        cols += BLOCKS[b]
    return cols


def oof(dec, RA, RB, cols, C, tau, years, train_from=2012):
    """Annual forward-chained predictions for `years` (fit on decisive rows with train_from <= year < Y)."""
    import numpy as np
    y = dec["y"].to_numpy(float)
    yr = dec["year"].to_numpy()
    p = np.full(len(dec), np.nan)
    for Y in years:
        tr = (yr < Y) & (yr >= train_from)
        te = yr == Y
        if te.sum() == 0:
            continue
        m = DebutLR(cols, C, tau).fit(take(RA, tr), take(RB, tr), y[tr])
        p[te] = m.predict(take(RA, te), take(RB, te))
    return p


def cv_ll(dec, RA, RB, blocks, years=CV_YEARS):
    """Best (C, tau) for a block set by pooled forward-chained CV log loss over `years`."""
    import numpy as np
    y = dec["y"].to_numpy(float)
    mask = dec["year"].isin(years).to_numpy()
    cols = cfg_cols(blocks)
    taus = TAUS if any(c in FADED for c in cols) else [8.0]
    best = None
    grid = {}
    for C in CS:
        for tau in taus:
            p = oof(dec, RA, RB, cols, C, tau, years)
            v = float(np.mean(ll_vec(p[mask], y[mask])))
            grid["C=%g tau=%g" % (C, tau)] = round(v, 5)
            if best is None or v < best[0]:
                best = (v, C, tau, p)
    return {"ll": round(best[0], 5), "C": best[1], "tau": best[2], "p": best[3], "grid": grid}


def select_blocks(dec, RA, RB, log=print):
    """Greedy forward block selection from 'core' by pooled CV log loss 2019-2023; a block enters only if it improves
    the CV loss by more than SEL_MIN (ml2's 0.0005 rule)."""
    chosen = ["core"]
    cur = cv_ll(dec, RA, RB, chosen)
    steps = [{"step": 0, "blocks": list(chosen), "ll": cur["ll"], "C": cur["C"], "tau": cur["tau"], "tried": {}}]
    log("CV core: %.5f (C %g)" % (cur["ll"], cur["C"]))
    cand = [b for b in BLOCKS if b != "core"]
    while True:
        tried = {}
        best = None
        for b in cand:
            if b in chosen or any(b in ex and (ex & set(chosen)) for ex in EXCLUSIVE):
                continue
            r = cv_ll(dec, RA, RB, chosen + [b])
            tried[b] = {"ll": r["ll"], "C": r["C"], "tau": r["tau"]}
            log("   + %-6s %.5f (C %g, tau %g)" % (b, r["ll"], r["C"], r["tau"]))
            if best is None or r["ll"] < best[1]["ll"]:
                best = (b, r)
        if best is None:
            break
        gain = cur["ll"] - best[1]["ll"]
        steps[-1]["tried"] = tried
        if gain <= SEL_MIN:
            log("stop: best addition %s gains %.5f <= %.4f" % (best[0], gain, SEL_MIN))
            break
        chosen.append(best[0])
        cur = best[1]
        steps.append({"step": len(steps), "blocks": list(chosen), "ll": cur["ll"], "C": cur["C"], "tau": cur["tau"],
                      "tried": {}})
        log("add %s -> %.5f" % (best[0], cur["ll"]))
    return chosen, cur, steps


# ---- method: P(KO / SUB / DEC | winner side), multinomial with walk-forward division base-rate offsets
MCLS = ["ko", "sub", "dec"]
MFEAT = ["w_ko", "w_sub", "w_uko", "w_usub", "l_kol", "l_subl", "l_ukol", "l_usubl", "mis", "five", "lbs",
         "women", "w_debut", "l_debut"]


def division_rates(fights, Y, span=5):
    """KO / SUB / DEC shares by division (and overall) among decisive UFC bouts in [Y - span, Y)."""
    cnt = defaultdict(Counter)
    for f in fights:
        if Y - span <= f.date.year < Y and f.cat in MCLS:
            cnt[f.division][f.cat] += 1
            cnt["_all"][f.cat] += 1
    out = {}
    for d, c in cnt.items():
        n = sum(c.values())
        a = cnt["_all"]
        na = sum(a.values())
        out[d] = [(c[k] + 20.0 * a[k] / na) / (n + 20.0) for k in MCLS]
    return out


def method_rows(dec, RA, RB, p_win):
    """Two rows per decisive bout (A as winner, B as winner): features from the winner's finishing profile and the
    loser's finished-loss profile; plus which row really happened."""
    import numpy as np
    n = len(dec)

    def side(R, tag):
        f = lambda k: np.nan_to_num(dec[k + "_" + tag].to_numpy(float)) if (k + "_" + tag) in dec else np.zeros(n)  # noqa
        pav = np.nan_to_num(dec["pav_" + tag].to_numpy(float)) if ("pav_" + tag) in dec else dec["debut_" + tag].to_numpy(float)
        fade = np.exp(-R["_n"] / 4.0) * pav
        nU = R["_n"]
        return {"ko": np.nan_to_num(dec["pre_ko_" + tag].to_numpy(float), nan=0.3) * fade,
                "sub": np.nan_to_num(dec["pre_sub_" + tag].to_numpy(float), nan=0.15) * fade,
                "kol": np.nan_to_num(dec["pre_kol_" + tag].to_numpy(float), nan=0.15) * fade,
                "subl": np.nan_to_num(dec["pre_subl_" + tag].to_numpy(float), nan=0.08) * fade,
                "uko": (f("uko_w") + 0.3) / (nU + 2.0), "usub": (f("usub_w") + 0.2) / (nU + 2.0),
                "ukol": (f("uko_l") + 0.2) / (nU + 2.0), "usubl": (f("usub_l") + 0.1) / (nU + 2.0),
                "debut": dec["debut_" + tag].to_numpy(float)}
    SA, SB = side(RA, "A"), side(RB, "B")
    mis = np.abs(zlogit(p_win))
    five = (dec["rounds"].to_numpy(float) >= 5).astype(float)
    lbs = np.array([DIV_LBS.get(d, 160) / 100.0 for d in dec["division"]])
    women = np.array([1.0 if str(d).startswith("Women") else 0.0 for d in dec["division"]])

    def mk(W, L):
        return np.vstack([W["ko"], W["sub"], W["uko"], W["usub"], L["kol"], L["subl"], L["ukol"], L["usubl"], mis,
                          five, lbs, women, W["debut"], L["debut"]]).T
    return mk(SA, SB), mk(SB, SA)


class MethodMN:
    """Multinomial logit P(m | winner) = softmax(log base_m + a_m + x . b_m), DEC the reference (a, b = 0); L2."""

    def __init__(self, lam=1.0):
        self.lam = lam

    def fit(self, X, off, yk):
        import numpy as np
        from scipy.optimize import minimize
        self.mu = X.mean(axis=0)
        self.sd = np.where(X.std(axis=0) < 1e-9, 1.0, X.std(axis=0))
        Z = (X - self.mu) / self.sd
        n, k = Z.shape
        Y = np.zeros((n, 3))
        Y[np.arange(n), yk] = 1

        def f(w):
            W = w.reshape(2, k + 1)
            eta = off.copy()
            eta[:, 0] += W[0, 0] + Z @ W[0, 1:]
            eta[:, 1] += W[1, 0] + Z @ W[1, 1:]
            eta -= eta.max(axis=1, keepdims=True)
            P = np.exp(eta)
            P /= P.sum(axis=1, keepdims=True)
            L = -np.sum(Y * np.log(np.clip(P, 1e-12, 1))) / n + 0.5 * self.lam / n * np.sum(W[:, 1:] ** 2)
            G = np.zeros((2, k + 1))
            R = (P - Y) / n
            for c in range(2):
                G[c, 0] = R[:, c].sum()
                G[c, 1:] = Z.T @ R[:, c] + self.lam / n * W[c, 1:]
            return L, G.ravel()
        r = minimize(f, np.zeros(2 * (k + 1)), jac=True, method="L-BFGS-B")
        self.W = r.x.reshape(2, k + 1)
        return self

    def predict(self, X, off):
        import numpy as np
        Z = (X - self.mu) / self.sd
        eta = off.copy()
        eta[:, 0] += self.W[0, 0] + Z @ self.W[0, 1:]
        eta[:, 1] += self.W[1, 0] + Z @ self.W[1, 1:]
        eta -= eta.max(axis=1, keepdims=True)
        P = np.exp(eta)
        return P / P.sum(axis=1, keepdims=True)

    def export(self):
        return {"classes": MCLS, "features": MFEAT, "lam": self.lam, "mu": self.mu.tolist(), "sd": self.sd.tolist(),
                "W": self.W.tolist(), "form": "P(m | winner) = softmax_m(log base_m(division) + W[m,0] + z . W[m,1:]), "
                "z = (x - mu) / sd, DEC reference (0)"}


def method_eval(dec, RA, RB, pw, fights, years, lam, base_only=False):
    """Annual forward-chained method predictions for `years`: method3 marginal and who x how (6 classes)."""
    import numpy as np
    yr = dec["year"].to_numpy()
    cat = dec["cat"].to_numpy()
    ok = np.isin(cat, MCLS)
    yk = np.array([MCLS.index(c) if c in MCLS else -1 for c in cat])
    XA, XB = method_rows(dec, RA, RB, pw)
    win_a = dec["y"].to_numpy() == 1.0
    PA = np.full((len(dec), 3), np.nan)
    PB = np.full((len(dec), 3), np.nan)
    for Y in years:
        te = yr == Y
        if not te.any():
            continue
        br = division_rates(fights, Y)
        off = np.log(np.array([br.get(d, br["_all"]) for d in dec["division"]]))
        if base_only:
            PA[te] = np.exp(off[te])
            PB[te] = np.exp(off[te])
            continue
        tr = (yr < Y) & ok
        Xw = np.where(win_a[:, None], XA, XB)
        m = MethodMN(lam).fit(Xw[tr], off[tr], yk[tr])
        PA[te] = m.predict(XA[te], off[te])
        PB[te] = m.predict(XB[te], off[te])
    return PA, PB, yk, ok


def method_scores(PA, PB, pw, yk, win_a, mask):
    import numpy as np
    pm = pw[:, None] * PA + (1 - pw[:, None]) * PB                 # marginal KO / SUB / DEC
    l3 = -np.log(np.clip(pm[np.arange(len(yk)), np.maximum(yk, 0)], 1e-12, 1))
    pj = np.where(win_a, pw * PA[np.arange(len(yk)), np.maximum(yk, 0)],
                  (1 - pw) * PB[np.arange(len(yk)), np.maximum(yk, 0)])
    l6 = -np.log(np.clip(pj, 1e-12, 1))
    pg = np.where(win_a[:, None], PA, PB)[np.arange(len(yk)), np.maximum(yk, 0)]
    lg = -np.log(np.clip(pg, 1e-12, 1))
    return {"method3": l3[mask], "whohow6": l6[mask], "method_given_winner": lg[mask]}


def cv(args):
    import numpy as np
    t0 = time.time()
    df, meta = load_frame()
    dec, RA, RB = prep(df)
    y = dec["y"].to_numpy(float)
    yr = dec["year"].to_numpy()
    ev = dec["event"].to_numpy()
    # symmetry: the swapped table must give exactly 1 - p
    blocks_all = [b for b in BLOCKS if b != "gnet2"]
    m = DebutLR(cfg_cols(blocks_all), 0.1, 8.0).fit(RA, RB, y)
    sym = float(np.max(np.abs(m.predict(RA, RB) + m.predict(RB, RA) - 1.0)))
    print("rows: %d decisive debut bouts 2012-2025 (%d in CV years, %d in 2024-25 untouched); swap test max |p+p'-1| %.2e"
          % (len(dec), int(dec["year"].isin(CV_YEARS).sum()), int((yr >= 2024).sum()), sym), flush=True)
    chosen, best, steps = select_blocks(dec, RA, RB)
    cvm = dec["year"].isin(CV_YEARS).to_numpy()
    p_deb = best["p"]
    # reference models on the CV rows
    refs = {"elo": dec["elo_p"].to_numpy(float), "seeded_elo": dec["p_seeded"].to_numpy(float),
            "close": dec["p_close"].to_numpy(float), "open": dec["p_open"].to_numpy(float)}
    full = cv_ll(dec, RA, RB, blocks_all)
    res = {"rows": {"decisive": int(len(dec)), "cv": int(cvm.sum()), "by_year": {int(k): int(v) for k, v in
                                                                                  Counter(yr.tolist()).items()}},
           "swap_test_max_abs": sym, "steps": steps, "chosen": {"blocks": chosen, "C": best["C"], "tau": best["tau"],
                                                                 "cv_ll": best["ll"]},
           "all_blocks": {"blocks": blocks_all, "cv_ll": full["ll"], "C": full["C"], "tau": full["tau"]}}
    # standalone comparisons on CV rows where each reference exists
    comp = {}
    for k, p in refs.items():
        mm = cvm & ~np.isnan(p)
        comp["debut vs " + k] = dict(paired(ev[mm], p_deb[mm], p[mm], y[mm]),
                                     ll_debut=round(float(ll_vec(p_deb[mm], y[mm]).mean()), 5),
                                     ll_ref=round(float(ll_vec(p[mm], y[mm]).mean()), 5))
        print("CV 2019-23 %-22s n %4d  debut %.5f  ref %.5f  diff %+.5f [%+.5f, %+.5f]" % (
            "debut vs " + k, mm.sum(), comp["debut vs " + k]["ll_debut"], comp["debut vs " + k]["ll_ref"],
            comp["debut vs " + k]["diff"], *comp["debut vs " + k]["ci"]), flush=True)
    res["cv_compare"] = comp
    # ---- stacks: forward-chained 2021-2023 on the CV OOF rows (fit on 2019..Y-1), ml2's stack_fit
    P = dict(refs, debut=p_deb)
    regimes = {"noline": [["seeded_elo"], ["debut"], ["debut", "seeded_elo"], ["debut", "elo"]],
               "close": [["close"], ["close", "debut"], ["close", "debut", "seeded_elo"]],
               "open": [["open"], ["open", "debut"], ["open", "debut", "seeded_elo"]]}
    raw = {"noline": ["debut", "seeded_elo"], "close": ["close"], "open": ["open"]}
    st = {}
    for reg, sets in regimes.items():
        need = {"noline": ["debut", "seeded_elo", "elo"], "close": ["close", "debut", "seeded_elo"],
                "open": ["open", "debut", "seeded_elo"]}[reg]
        ok = np.ones(len(dec), bool)
        for k in need:
            ok &= ~np.isnan(P[k])
        gate = ok & np.isin(yr, STACK_YEARS)
        out = {"n": int(gate.sum())}
        for r_ in raw[reg]:
            out["raw " + r_] = round(float(ll_vec(P[r_][gate], y[gate]).mean()), 5)
        preds = {}
        for cols in sets:
            pp = np.full(len(dec), np.nan)
            ws = {}
            for Y in STACK_YEARS:
                tr = ok & (yr >= 2019) & (yr < Y)
                te = ok & (yr == Y)
                Z = np.vstack([zlogit(P[c]) for c in cols]).T
                b = stack_fit(Z[tr], y[tr])
                pp[te] = 1 / (1 + np.exp(-(Z[te] @ b)))
                ws[Y] = [round(float(x), 4) for x in b]
            key = "+".join(cols)
            preds[key] = pp
            out["stack " + key] = {"ll": round(float(ll_vec(pp[gate], y[gate]).mean()), 5), "w": ws}
        st[reg] = out
        st[reg]["_preds"] = preds
        st[reg]["_gate"] = gate
        print("stack gate 2021-23 %-6s n %d: %s" % (reg, gate.sum(), {k: (v["ll"] if isinstance(v, dict) else v)
                                                                       for k, v in out.items() if k != "n" and not k.startswith("_")}), flush=True)
    # decisions (0.0005 rule; simpler wins ties)
    dec_out = {}
    nl = st["noline"]
    cands = [("raw debut", nl["raw debut"], 0), ("stack debut", nl["stack debut"]["ll"], 1),
             ("stack debut+seeded_elo", nl["stack debut+seeded_elo"]["ll"], 2),
             ("stack debut+elo", nl["stack debut+elo"]["ll"], 2)]
    bestc = cands[0]
    for c in cands[1:]:
        if c[1] < bestc[1] - SEL_MIN:
            bestc = c
    dec_out["noline"] = bestc[0]
    g = nl["_gate"]
    dec_out["noline_vs_seeded_elo_gate"] = paired(ev[g], nl["_preds"]["debut"][g] if bestc[0] != "raw debut"
                                                  else p_deb[g], P["seeded_elo"][g], y[g])
    for reg in ("close", "open"):
        o = st[reg]
        base = min(o["raw " + reg], o["stack " + reg]["ll"])
        add = o["stack %s+debut" % reg]["ll"]
        dec_out[reg] = {"debut_enters": bool(add < base - SEL_MIN), "gain_vs_best_line_only": round(add - base, 5)}
        g = o["_gate"]
        dec_out[reg]["paired_stack_vs_raw_line"] = paired(ev[g], o["_preds"]["%s+debut" % reg][g], P[reg][g], y[g])
    res["stacks"] = {k: {kk: vv for kk, vv in v.items() if not kk.startswith("_")} for k, v in st.items()}
    res["stack_decisions"] = dec_out
    print("decisions:", json.dumps(dec_out), flush=True)
    # ---- method: lam by CV 2019-2023, vs division base rates; winner prob = the chosen debut model's OOF
    fights, people, bouts, uni = load_universe_strict()
    win_a = y == 1.0
    mres = {}
    pw_s = np.where(np.isnan(P["seeded_elo"]), P["elo"], P["seeded_elo"])
    PA0, PB0, yk, okm = method_eval(dec, RA, RB, p_deb, fights, CV_YEARS, 1.0, base_only=True)
    mm = cvm & okm
    s_base = method_scores(PA0, PB0, pw_s, yk, win_a, mm)
    best_lam = None
    for lam in (1.0, 10.0, 30.0, 100.0, 300.0):
        PA, PB, _, _ = method_eval(dec, RA, RB, p_deb, fights, CV_YEARS, lam)
        s = method_scores(PA, PB, p_deb, yk, win_a, mm)
        mres["lam=%g" % lam] = {k: round(float(v.mean()), 5) for k, v in s.items()}
        print("method CV lam %g: %s | base %s" % (lam, mres["lam=%g" % lam],
                                                  {k: round(float(v.mean()), 5) for k, v in s_base.items()}), flush=True)
        if best_lam is None or s["method3"].mean() < best_lam[1]:
            best_lam = (lam, s["method3"].mean(), s)
    s = best_lam[2]
    s_bw = method_scores(PA0, PB0, p_deb, yk, win_a, mm)          # base-rate method with the debut winner prob
    mres["chosen_lam"] = best_lam[0]
    mres["base_rates"] = {k: round(float(v.mean()), 5) for k, v in s_base.items()}
    mres["paired"] = {
        "method3 vs division base": paired_vals(ev[mm], s["method3"], s_base["method3"]),
        "method_given_winner vs division base": paired_vals(ev[mm], s["method_given_winner"],
                                                             s_base["method_given_winner"]),
        "whohow6 (debut winner + method) vs fallback (seeded Elo x base)": paired_vals(ev[mm], s["whohow6"],
                                                                                       s_base["whohow6"]),
        "whohow6 method part only (same debut winner)": paired_vals(ev[mm], s["whohow6"], s_bw["whohow6"])}
    mres["n"] = int(mm.sum())
    res["method"] = mres
    print("method paired:", json.dumps(mres["paired"]), flush=True)
    res["built"] = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    res["frame_meta"] = {k: meta[k] for k in ("built", "n", "half_lives", "opp_pages", "opp_ids", "pages",
                                               "global_bouts") if k in meta}
    pickle.dump({"res": res, "oof": {"fid": dec["fid"].tolist(), "p_debut": p_deb.tolist()}},
                open(os.path.join(OUTC, "cv.pkl"), "wb"))
    json.dump(res, open(os.path.join(OUTC, "cv.json"), "w"), indent=1, default=float)
    print("wrote out/debut_cache/cv.json (%.0f s)" % (time.time() - t0))


def paired_vals(groups, a, b, B=2000):
    m, lo, hi = boot_ci(groups, a - b, B)[0]
    return {"diff": m, "ci": [lo, hi], "n": int(len(a)), "a": round(float(a.mean()), 5), "b": round(float(b.mean()), 5)}


# ------------------------------------------------------------------ 2024-2025: one look with the frozen CV choices
HOLD_YEARS = [2024, 2025]


def frozen_choices():
    C = json.load(open(os.path.join(OUTC, "cv.json")))
    return C


def walk_preds(dec, RA, RB, ch, years):
    """Annual walk-forward debut-model predictions (fit on every decisive debut bout 2012..Y-1)."""
    return oof(dec, RA, RB, cfg_cols(ch["blocks"]), ch["C"], ch["tau"], years)


def holdout(args):
    import numpy as np
    t0 = time.time()
    flag = os.path.join(OUTC, "holdout.done")
    if os.path.exists(flag) and not args.force_rescore_same_choices:
        raise SystemExit("2024-25 already scored once (%s); the look is spent" % flag)
    C = frozen_choices()
    ch = C["chosen"]
    df, meta = load_frame()
    dec, RA, RB = prep(df)
    y = dec["y"].to_numpy(float)
    yr = dec["year"].to_numpy()
    ev = dec["event"].to_numpy()
    # winner: CV years (for stack history) + 2024 + 2025, all annual forward-chained
    p_deb = walk_preds(dec, RA, RB, ch, CV_YEARS + HOLD_YEARS)
    m_st = DebutLR(cfg_cols(ch["blocks"]), ch["C"], ch["tau"]).fit(take(RA, yr < 2024), take(RB, yr < 2024),
                                                                    y[yr < 2024])
    p_static = np.full(len(dec), np.nan)
    hm = np.isin(yr, HOLD_YEARS)
    p_static[hm] = m_st.predict(take(RA, hm), take(RB, hm))
    P = {"debut": p_deb, "debut_static": p_static, "elo": dec["elo_p"].to_numpy(float),
         "seeded_elo": dec["p_seeded"].to_numpy(float), "close": dec["p_close"].to_numpy(float),
         "open": dec["p_open"].to_numpy(float)}
    # current fallback (tools/forward_ledger.py): the line when there is one, else Elo seeded from the pre-UFC record
    P["fallback"] = np.where(np.isnan(P["close"]), P["seeded_elo"], P["close"])
    out = {"n": int(hm.sum()), "by_year": {Y: int((yr == Y).sum()) for Y in HOLD_YEARS}, "standalone": {}, "paired": {}}
    for k, p in P.items():
        mm = hm & ~np.isnan(p)
        out["standalone"][k] = {"n": int(mm.sum()), "ll": boot_ci(ev[mm], ll_vec(p[mm], y[mm]))[0],
                                "acc": round(float(np.mean(np.where(p[mm] == 0.5, 0.5, (p[mm] > 0.5) == (y[mm] == 1)))), 4),
                                "brier": round(float(np.mean((p[mm] - y[mm]) ** 2)), 5)}
    for a, b in [("debut", "seeded_elo"), ("debut", "elo"), ("debut", "close"), ("debut", "open"),
                 ("debut", "fallback"), ("debut_static", "seeded_elo"), ("seeded_elo", "elo")]:
        mm = hm & ~np.isnan(P[a]) & ~np.isnan(P[b])
        out["paired"]["%s vs %s" % (a, b)] = paired(ev[mm], P[a][mm], P[b][mm], y[mm])
    # stacks with the CV-frozen structure: weights fit on 2019..Y-1 out-of-sample rows (annual), predict Y
    sd = C["stack_decisions"]
    stk = {}
    for reg, cols in (("noline", ["debut", "seeded_elo"]), ("close", ["close", "debut"]), ("open", ["open", "debut"]),
                      ("close_only", ["close"]), ("open_only", ["open"])):
        ok = np.ones(len(dec), bool)
        for c in cols + (["seeded_elo"] if reg == "noline" else []):
            ok &= ~np.isnan(P[c])
        pp = np.full(len(dec), np.nan)
        ws = {}
        Z = np.vstack([zlogit(P[c]) for c in cols]).T
        for Y in HOLD_YEARS:
            tr = ok & (yr >= 2019) & (yr < Y)
            te = ok & (yr == Y)
            b = stack_fit(Z[tr], y[tr])
            pp[te] = 1 / (1 + np.exp(-(Z[te] @ b)))
            ws[Y] = [round(float(x), 4) for x in b]
        P["stack_" + reg] = pp
        stk[reg] = {"cols": cols, "weights": ws}
    for a, b in [("stack_close", "close"), ("stack_close", "stack_close_only"), ("stack_open", "open"),
                 ("stack_open", "stack_open_only"), ("stack_noline", "seeded_elo"), ("stack_noline", "debut")]:
        mm = hm & ~np.isnan(P[a]) & ~np.isnan(P[b])
        out["paired"]["%s vs %s" % (a, b)] = paired(ev[mm], P[a][mm], P[b][mm], y[mm])
    out["stacks"] = stk
    out["stack_decisions_frozen"] = sd
    # the production prediction by regime, as frozen by CV: no line -> CV's no-line choice; line -> stack if debut
    # entered in CV, else the line alone
    nl = sd["noline"]
    p_nl = P["debut"] if nl == "raw debut" else (P["stack_noline"] if "seeded" in nl else P["debut"])
    p_cl = np.where(np.isnan(P["close"]), p_nl, P["stack_close"] if sd["close"]["debut_enters"] else P["close"])
    P["path_noline"], P["path_close"] = p_nl, p_cl
    for a, b in [("path_noline", "seeded_elo"), ("path_close", "fallback")]:
        mm = hm & ~np.isnan(P[a]) & ~np.isnan(P[b])
        out["paired"]["%s vs %s" % (a, b)] = paired(ev[mm], P[a][mm], P[b][mm], y[mm])
    # calibration (both corner orders pooled): no-intercept slope of y on logit p
    cal = {}
    for k in ("debut", "seeded_elo", "elo", "close"):
        mm = hm & ~np.isnan(P[k])
        cal[k] = calib_slope(P[k][mm], y[mm], ev[mm])
    out["calibration_slope"] = cal
    # method (frozen lam; annual forward-chained; winner prob = the debut model)
    fights, people, bouts, uni = load_universe_strict()
    lam = C["method"]["chosen_lam"]
    win_a = y == 1.0
    PA, PB, yk, okm = method_eval(dec, RA, RB, p_deb, fights, HOLD_YEARS, lam)
    PA0, PB0, _, _ = method_eval(dec, RA, RB, p_deb, fights, HOLD_YEARS, lam, base_only=True)
    mm = hm & okm
    pw_fb = np.where(np.isnan(P["seeded_elo"]), P["elo"], P["seeded_elo"])
    s = method_scores(PA, PB, p_deb, yk, win_a, mm)
    s0 = method_scores(PA0, PB0, pw_fb, yk, win_a, mm)
    s0d = method_scores(PA0, PB0, p_deb, yk, win_a, mm)
    out["method"] = {"n": int(mm.sum()), "lam": lam,
                     "method3": paired_vals(ev[mm], s["method3"], s0["method3"]),
                     "method_given_winner": paired_vals(ev[mm], s["method_given_winner"], s0["method_given_winner"]),
                     "whohow6 vs fallback (seeded Elo x division base)": paired_vals(ev[mm], s["whohow6"], s0["whohow6"]),
                     "whohow6 method part only": paired_vals(ev[mm], s["whohow6"], s0d["whohow6"])}
    out["built"] = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    out["frozen_from"] = {"cv_built": C["built"], "chosen": ch, "method_lam": lam}
    preds = {}
    for i in np.where(np.isin(yr, CV_YEARS + HOLD_YEARS))[0]:
        f = dec["fid"].iloc[i]
        r = {"date": dec["date"].iloc[i].isoformat(), "set": "valid" if yr[i] >= 2024 else "oof",
             "nA": int(dec["nA"].iloc[i]), "nB": int(dec["nB"].iloc[i])}
        for k in ("debut", "seeded_elo", "elo", "close", "open", "stack_close", "stack_noline"):
            v = P[k][i]
            r[k] = None if v != v else round(float(v), 5)
        if yr[i] >= 2024 and okm[i]:
            r["method_A"] = [round(float(x), 4) for x in PA[i]]
            r["method_B"] = [round(float(x), 4) for x in PB[i]]
        preds[f] = r
    pickle.dump({"out": out, "preds": preds}, open(os.path.join(OUTC, "holdout.pkl"), "wb"))
    json.dump(out, open(os.path.join(OUTC, "holdout.json"), "w"), indent=1, default=float)
    open(flag, "w").write(out["built"] + "\n")
    print(json.dumps(out, indent=1, default=float)[:6000])
    print("wrote out/debut_cache/holdout.json (%.0f s)" % (time.time() - t0))


def calib_slope(p, y, groups, B=1000):
    """Mirrored no-intercept logistic slope of y on logit(p), with an event-cluster bootstrap CI."""
    import numpy as np
    from scipy.optimize import minimize_scalar
    z = zlogit(p)
    Zm = np.r_[z, -z]
    Ym = np.r_[y, 1 - y]
    Gm = np.r_[groups, groups]

    def slope(idx):
        zz, yy = Zm[idx], Ym[idx]
        return minimize_scalar(lambda b: np.sum(np.logaddexp(0, b * zz) - yy * b * zz), bounds=(0.01, 5),
                               method="bounded").x
    s0 = slope(np.arange(len(Zm)))
    ug = np.unique(groups)
    pos = {g: np.where(Gm == g)[0] for g in ug}
    rng = np.random.default_rng(3)
    bs = []
    for _ in range(B):
        d = rng.choice(ug, len(ug))
        bs.append(slope(np.concatenate([pos[g] for g in d])))
    lo, hi = np.percentile(bs, [2.5, 97.5])
    return [round(float(s0), 3), round(float(lo), 3), round(float(hi), 3)]

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("crawl")
    c.add_argument("--offline", action="store_true")
    c.add_argument("--skip-resolve", action="store_true")
    c.add_argument("--max-requests", type=int, default=0)
    b = sub.add_parser("build")
    b.add_argument("--half-lives", type=float, nargs="+", default=[2.0, 4.0])
    b.add_argument("--opp-k", type=int, default=None, help="one-hop ranks to use (default: complete ranks)")
    sub.add_parser("cv")
    h = sub.add_parser("holdout")
    h.add_argument("--force-rescore-same-choices", action="store_true",
                   help="recompute the spent look with the same frozen choices (bug fixes only; logged)")
    args = ap.parse_args()
    if args.cmd == "holdout":
        holdout(args)
        return
    if args.cmd == "cv":
        cv(args)
        return
    if args.cmd == "crawl":
        crawl(args)
    elif args.cmd == "build":
        build(args)


if __name__ == "__main__":
    main()
