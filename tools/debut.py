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
    args = ap.parse_args()
    if args.cmd == "crawl":
        crawl(args)
    elif args.cmd == "build":
        build(args)


if __name__ == "__main__":
    main()
