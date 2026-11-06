#!/usr/bin/env python3
"""Adversarial verification of the debut path (research/model_debut.md, "Verification log").

Independent of tools/debut.py's model code: own UFC-row rule, node keys, availability rule, MAP fit (trust-region
Newton-CG with own gradient / Hessian-vector product) and one-fighter rating; own no-intercept logistic (Newton), greedy
and NESTED block selection, stacker, multinomial method model and card bootstrap. Shared layers: the build_db / preufc
ufcstats parse and identity, preufc.parse_fighter (Sherdog HTML), preufc.promotion, the cache path lookup, and
tools/debut.py's frame for the raw per-side columns (Elo, UFC record, flags, pre-UFC rates). 2026+ rows are dropped
right after parsing; nothing here reads a 2026 result.

    nice -n 5 python3 tools/debut_verify.py net                        # rebuild the network rating; compare to the frame
    nice -n 5 python3 tools/debut_verify.py cv --net builder --nested  # CV, nested selection, stack gate, the look
    nice -n 5 python3 tools/debut_verify.py cv --net mine --nested     # the same on the verifier's own network columns
    nice -n 5 python3 tools/debut_verify.py method                     # method model, as built and as adopted
    nice -n 5 python3 tools/debut_verify.py checks                     # universe, duplicate-row leak, page resolution,
                                                                       # replacement vs close, free intercept, drop-1
Outputs: out/debut_cache/verify/ (gitignored). `method` and `checks` need `cv --net builder` first; `cv --net mine`
needs `net` first.
"""
import os
import sys

for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "1")
import argparse
import csv
import datetime as dt
import json
import math
import pickle
import time
from collections import Counter, defaultdict

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
OUT = os.path.join(ROOT, "out", "debut_cache", "verify")
FRAME = os.path.join(ROOT, "out", "debut_cache", "frame.pkl")
VAULT = dt.date(2026, 1, 1)
G0 = dt.date(2012, 1, 1)
CV = [2019, 2020, 2021, 2022, 2023]


def ufc_dev():
    """ufcstats fights / people / bouts with every 2026+ fight dropped right after parsing."""
    import build_db as B
    import preufc as PU
    if not getattr(B.parse_fights, "_vf", False):
        orig = B.parse_fights

        def dev(log):
            fs, ex = orig(log)
            return [f for f in fs if f.date < VAULT], ex
        dev._vf = True
        B.parse_fights = dev
    fights, people, bouts = PU.load_ufc()
    assert max(f.date for f in fights) < VAULT
    return fights, people, bouts


def load_frame():
    F = pickle.load(open(FRAME, "rb"))["df"]
    assert F.date.max() < VAULT
    return F.sort_values(["date", "fid"]).reset_index(drop=True)


# ------------------------------------------------------------------ net: the verifier's own network rating
SCORE = {"W": 1.0, "L": 0.0, "D": 0.5}


def build_pages(bouts):
    import preufc as PU
    import debut as DB                      # cache path lookup only
    res = json.load(open(os.path.join(ROOT, "data", "raw", "debut_cache", "resolve.json")))
    fx = PU.Fetcher(offline=True)
    pages = {}
    for p, r in res.items():
        if r.get("status") != "ok" or p not in bouts:
            continue
        P = PU.parse_fighter(fx.get(PU.BASE + r["href"], DB.fighter_path(r["href"])))
        if not P:
            continue
        udates = sorted(t[0] for t in bouts[p])
        pro, am = [], []
        for sec, rows in P["sections"].items():
            for x in rows:
                if not x.get("date"):
                    continue
                d = dt.date.fromisoformat(x["date"])
                if "amateur" in sec:
                    am.append((d, x["res"]))
                    continue
                if "exhibition" in sec:
                    continue
                promo = PU.promotion(x["event"])
                is_ufc = promo == "UFC" or any(abs((d - u).days) <= 3 for u in udates)      # own rule: date match
                pro.append({"d": d, "opp": PU.sid(x["opp_href"]), "res": x["res"], "promo": promo, "ufc": is_ufc,
                            "opp_name": x["opp"], "event": x["event"]})
        pages[p] = {"sid": PU.sid(r["href"]), "pro": pro, "am": am, "href": r["href"]}
    return pages


def cmd_net(args):
    import scipy.sparse as sp
    from scipy.optimize import minimize
    t0 = time.time()
    fights, people, bouts = ufc_dev()
    first = {p: min(t[0] for t in ub) for p, ub in bouts.items() if ub}
    pages = build_pages(bouts)

    def node(p):
        return pages[p]["sid"] if p in pages else "u:" + p
    glob = []
    for f in fights:
        a, b = f.persons
        y = {"A": 1.0, "B": 0.0, "D": 0.5}.get(f.winner)
        if a != b and y is not None:
            glob.append((f.date, node(a), node(b), y, "UFC", f.date))
    reg = {}
    for p, pg in pages.items():
        d0 = first[p]
        if d0 < G0:
            continue                        # survivor pages (pre-2012 debutants): never used
        for x in pg["pro"]:
            if x["ufc"] or x["opp"] is None or x["res"] not in SCORE:
                continue
            k = (x["d"], min(pg["sid"], x["opp"]), max(pg["sid"], x["opp"]))
            reg[k] = reg[k][:5] + (min(reg[k][5], d0),) if k in reg else (x["d"], pg["sid"], x["opp"], SCORE[x["res"]],
                                                                          x["promo"], d0)
    glob += list(reg.values())
    print("pages %d; global bouts %d (UFC %d) (%.0f s)" % (len(pages), len(glob), sum(g[4] == "UFC" for g in glob),
                                                          time.time() - t0), flush=True)

    def fit(C, h, lu=1.0, lg=0.5):
        Bc = [g for g in glob if g[0] < C and g[5] < C]
        ids, gid = {}, {}
        ia = np.array([ids.setdefault(g[1], len(ids)) for g in Bc])
        ib = np.array([ids.setdefault(g[2], len(ids)) for g in Bc])
        ig = np.array([gid.setdefault(g[4], len(gid)) for g in Bc])
        y = np.array([g[3] for g in Bc])
        w = np.array([2.0 ** (-((C - g[0]).days / 365.25) / h) for g in Bc])
        n, m = len(ids), len(gid)
        E = sp.csr_matrix((np.r_[w, w], (np.r_[ia, ib], np.r_[ig, ig])), shape=(n, m))
        Pm = sp.diags(1 / np.asarray(E.sum(1)).ravel()) @ E
        k = np.arange(len(ia))
        Dm = sp.csr_matrix((np.r_[np.ones(len(ia)), -np.ones(len(ib))], (np.r_[k, k], np.r_[ia, ib])), shape=(len(ia), n))

        def fg(x):
            th, mu = x[:n], x[n:]
            z = Dm @ th
            r = th - Pm @ mu
            s = w * (1 / (1 + np.exp(-z)) - y)
            return (np.sum(w * (np.logaddexp(0, z) - y * z)) + 0.5 * lu * r @ r + 0.5 * lg * mu @ mu,
                    np.r_[Dm.T @ s + lu * r, -lu * (Pm.T @ r) + lg * mu])

        def hp(x, v):
            pz = 1 / (1 + np.exp(-(Dm @ x[:n])))
            q = w * pz * (1 - pz)
            rv = v[:n] - Pm @ v[n:]
            return np.r_[Dm.T @ (q * (Dm @ v[:n])) + lu * rv, -lu * (Pm.T @ rv) + lg * v[n:]]
        r = minimize(fg, np.zeros(n + m), jac=True, hessp=hp, method="trust-ncg", options={"gtol": 1e-6, "maxiter": 200})
        inv = {v: k_ for k_, v in ids.items()}
        return {"th": {inv[i]: r.x[i] for i in range(n)}, "mu": {k_: r.x[n + j] for k_, j in gid.items()}, "n": len(Bc),
                "ok": bool(r.success)}

    def own_rows(p, D):
        out = []
        for (d, q, on, f) in bouts.get(p, []):
            y = {"A": 1.0, "B": 0.0, "D": 0.5}.get(f.winner)
            if d < D and y is not None:
                out.append((d, node(q), y if f.persons[0] == p else 1 - y, "UFC"))
        if p in pages and G0 <= first[p] <= D:
            for x in pages[p]["pro"]:
                if x["d"] < D and not x["ufc"] and x["opp"] is not None and x["res"] in SCORE:
                    out.append((x["d"], x["opp"], SCORE[x["res"]], x["promo"]))
        return out

    def rate1(rows, D, F, h, lam=1.0):
        if not rows:
            return 0.0, 1 / math.sqrt(lam), 0.0, float("nan")
        th, mu = F["th"], F["mu"]
        o = np.array([th.get(r[1], mu.get(r[3], 0.0)) for r in rows])
        yy = np.array([r[2] for r in rows])
        ww = np.array([2.0 ** (-((D - r[0]).days / 365.25) / h) for r in rows])
        m0 = float((ww * np.array([mu.get(r[3], 0.0) for r in rows])).sum() / ww.sum())
        t = m0
        for _ in range(50):
            p = 1 / (1 + np.exp(-(t - o)))
            H = lam + np.sum(ww * p * (1 - p))
            st = (lam * (t - m0) + np.sum(ww * (p - yy))) / H
            t -= st
            if abs(st) < 1e-9:
                break
        return t, 1 / math.sqrt(H), m0, float((ww * o).sum() / ww.sum())

    Fr = load_frame()
    person = {f.fid: f.persons for f in fights}
    out = {}
    for h in (2.0, 4.0):
        fits = {}
        for Y in sorted(set(Fr.year)):
            C = dt.date(Y, 1, 1)
            fits[C] = fit(C, h)
            print("h %s fit %s: %d bouts, converged %s" % (h, C, fits[C]["n"], fits[C]["ok"]), flush=True)
        for _, r in Fr.iterrows():
            Fc = fits[dt.date(r.date.year, 1, 1)]
            for tag, p in zip("AB", person[r.fid]):
                th, sd, m, sos = rate1(own_rows(p, r.date), r.date, Fc, h)
                out.setdefault(r.fid, {}).update({"g%s_th_%s" % (h, tag): th, "g%s_sd_%s" % (h, tag): sd,
                                                  "g%s_m_%s" % (h, tag): m, "g%s_sos_%s" % (h, tag): sos})
    for _, r in Fr.iterrows():
        for tag, p in zip("AB", person[r.fid]):
            if p in pages and G0 <= first[p] <= r.date:
                am = [x for x in pages[p]["am"] if x[0] < r.date]
                w_, l_ = sum(x[1] == "W" for x in am), sum(x[1] == "L" for x in am)
                out[r.fid]["am_n_" + tag] = len(am)
                out[r.fid]["am_wpct_" + tag] = math.log((w_ + 1.0) / (l_ + 1.0))
    os.makedirs(OUT, exist_ok=True)
    pickle.dump(out, open(os.path.join(OUT, "mynet.pkl"), "wb"))
    print("\nverifier's network columns vs the builder's frame (both corners, 1,443 bouts):")
    for c in ["g4.0_th", "g4.0_m", "g4.0_sd", "g4.0_sos", "g2.0_m", "am_wpct"]:
        for t in "AB":
            a = Fr[c + "_" + t].to_numpy(float)
            b = np.array([out[f].get(c + "_" + t, np.nan) for f in Fr.fid])
            ok = np.isfinite(a) & np.isfinite(b)
            print("  %-9s %s corr %.4f  p99 |diff| %.3f" % (c, t, np.corrcoef(a[ok], b[ok])[0, 1],
                                                           np.percentile(np.abs(a[ok] - b[ok]), 99)))
    print("done (%.0f s)" % (time.time() - t0))


# ------------------------------------------------------------------ cv: winner model, nested selection, stack gate, look
BL = {"core": ["elo", "debut"], "ufc": ["logn", "uwin", "ufin", "ufinl"], "bio": ["age", "lay", "wcmove"],
      "gnet2": ["g2.0_th", "g2.0_sos", "g2.0_sd"], "gnet4": ["g4.0_th", "g4.0_sos", "g4.0_sd"],
      "promo2": ["g2.0_m"], "promo4": ["g4.0_m"], "extra": ["am_n", "am_wpct", "pre_tuf", "short", "repl", "miss"]}
FADE = {"am_n", "am_wpct", "pre_tuf"}
EXCL = [{"gnet2", "gnet4"}, {"promo2", "promo4"}]
CS, TAUS = [0.003, 0.01, 0.03, 0.1, 0.3, 1.0], [2.0, 8.0]
FROZEN = (["core", "extra", "gnet4", "promo2", "ufc"], 1.0, 2.0)       # the builder's pre-registered choice


class Data:
    def __init__(self, net="builder"):
        F = load_frame()
        pre = json.load(open(os.path.join(ROOT, "data", "derived", "preufc.json")))["predictions"]
        F["p_seeded"] = [pre[f]["p_seeded_elo"] if f in pre else np.nan for f in F.fid]
        if net == "mine":
            M = pickle.load(open(os.path.join(OUT, "mynet.pkl"), "rb"))
            for c in sorted({k for v in M.values() for k in v}):
                F[c] = [M[f].get(c, np.nan) for f in F.fid]
        d = F[F.winner.isin(["A", "B"])].reset_index(drop=True)
        self.d = d
        self.y = (d.winner == "A").to_numpy(float)
        self.yr = d.year.to_numpy()
        self.ev = (d.event + "|" + d.date.astype(str)).to_numpy()
        self.S = {"A": self.side("A"), "B": self.side("B")}
        self.refs = {"elo": d.elo_p.to_numpy(float), "seeded": d.p_seeded.to_numpy(float),
                     "close": d.p_close.to_numpy(float), "open": d.p_open.to_numpy(float)}

    def col(self, k):
        return self.d[k].to_numpy(float) if k in self.d else np.full(len(self.d), np.nan)

    def side(self, t):
        nU = self.d["n" + t].to_numpy(float)
        pav = np.nan_to_num(self.col("pav_" + t))
        c = lambda k: self.col("%s_%s" % (k, t))  # noqa: E731
        S = {"elo": c("elo"), "debut": (nU == 0).astype(float), "logn": c("logn"), "uwin": c("uwin"), "ufin": c("ufin"),
             "ufinl": c("ufinl"), "am_n": np.where(pav > 0, np.log1p(c("am_n")), np.nan),
             "am_wpct": np.where(pav > 0, c("am_wpct"), np.nan), "pre_tuf": np.where(pav > 0, c("pre_tuf"), np.nan),
             "short": np.where(np.isfinite(c("short")) & (c("short") <= 21), 1.0, 0.0), "repl": np.nan_to_num(c("repl")),
             "miss": np.nan_to_num(c("miss")), "age": c("age"), "wcmove": np.nan_to_num(c("wcmove")), "_n": nU}
        S["lay"] = np.where(np.isnan(c("layoff")), c("pre_layoff"), c("layoff"))
        for h in ("2.0", "4.0"):
            for k in ("th", "sos", "sd", "m"):
                S["g%s_%s" % (h, k)] = c("g%s_%s" % (h, k))
        return S

    def design(self, cols, tau, idx, stats=None, swap=False):
        SA, SB = (self.S["B"], self.S["A"]) if swap else (self.S["A"], self.S["B"])
        XA = np.column_stack([SA[k][idx] for k in cols])
        XB = np.column_stack([SB[k][idx] for k in cols])
        if stats is None:
            mu = np.nanmean(np.r_[XA, XB], axis=0)
            mu = np.where(np.isnan(mu), 0, mu)
        else:
            mu = stats[0]
        XA, XB = np.nan_to_num(XA - mu), np.nan_to_num(XB - mu)
        fa, fb = np.exp(-SA["_n"][idx] / tau), np.exp(-SB["_n"][idx] / tau)
        for j, k in enumerate(cols):
            if k in FADE:
                XA[:, j] *= fa
                XB[:, j] *= fb
        Dm = XA - XB
        sd = np.where(Dm.std(axis=0) < 1e-9, 1, Dm.std(axis=0)) if stats is None else stats[1]
        return Dm / sd, (mu, sd)

    def fitpred(self, cols, C, tau, tr, te, swap=False):
        X, st = self.design(cols, tau, tr)
        w = logit_fit(X, self.y[tr], C)
        Xt, _ = self.design(cols, tau, te, st, swap)
        return 1 / (1 + np.exp(-(Xt @ w)))

    def oof(self, cols, C, tau, years):
        p = np.full(len(self.d), np.nan)
        for Y in years:
            te = np.where(self.yr == Y)[0]
            p[te] = self.fitpred(cols, C, tau, np.where((self.yr < Y) & (self.yr >= 2012))[0], te)
        return p

    def best_cfg(self, blocks, years):
        cols = sum((BL[b] for b in blocks), [])
        m = np.isin(self.yr, years)
        best = None
        for C in CS:
            for tau in (TAUS if any(c in FADE for c in cols) else [8.0]):
                p = self.oof(cols, C, tau, years)
                v = ll(p[m], self.y[m]).mean()
                if best is None or v < best[0]:
                    best = (v, C, tau, p)
        return best

    def greedy(self, years):
        ch, cur = ["core"], self.best_cfg(["core"], years)
        while True:
            cands = [(self.best_cfg(ch + [b], years), b) for b in BL
                     if b not in ch and not any(b in e and (e & set(ch)) for e in EXCL)]
            if not cands:
                break
            r, b = min(cands, key=lambda t: t[0][0])
            if cur[0] - r[0] <= 0.0005:                  # ml2's rule
                break
            ch.append(b)
            cur = r
        return ch, cur


def logit_fit(X, y, C):
    """min 0.5 |w|^2 + C sum logloss, no intercept (Newton)."""
    w = np.zeros(X.shape[1])
    for _ in range(100):
        p = 1 / (1 + np.exp(-(X @ w)))
        st = np.linalg.solve(np.eye(len(w)) + C * (X.T * (p * (1 - p))) @ X, w + C * X.T @ (p - y))
        w -= st
        if np.max(np.abs(st)) < 1e-10:
            break
    return w


def ll(p, y):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


def zl(p):
    p = np.clip(p, 0.01, 0.99)
    return np.log(p / (1 - p))


def boot(groups, v, B=2000, seed=11):
    """Card-cluster bootstrap of a mean (ratio of sums over resampled cards)."""
    ug, inv = np.unique(groups, return_inverse=True)
    S, N = np.bincount(inv, v), np.bincount(inv).astype(float)
    rng = np.random.default_rng(seed)
    bs = [S[i].sum() / N[i].sum() for i in rng.integers(0, len(ug), (B, len(ug)))]
    return "%+.4f [%+.4f, %+.4f] n %d" % (np.mean(v), np.percentile(bs, 2.5), np.percentile(bs, 97.5), len(v))


def stacker(Z, y):
    from scipy.optimize import minimize

    def f(b):
        q = Z @ b
        return (np.mean(np.logaddexp(0, q) - y * q) + 1e-4 * b @ b,
                Z.T @ (1 / (1 + np.exp(-q)) - y) / len(y) + 2e-4 * b)
    return minimize(f, np.full(Z.shape[1], 0.3), jac=True, method="L-BFGS-B", bounds=[(0, None)] * Z.shape[1]).x


def report(D, name, pdeb):
    y, yr, ev = D.y, D.yr, D.ev
    cvm = np.isin(yr, CV)
    print("== %s" % name)
    for per, pm in (("CV 2019-23", cvm), ("2024-25", yr >= 2024)):
        for k in ("seeded", "elo", "open", "close"):
            m = pm & np.isfinite(D.refs[k]) & np.isfinite(pdeb)
            print("  %s vs %-6s %s (model %.5f ref %.5f)" % (per, k, boot(ev[m], ll(pdeb[m], y[m]) - ll(D.refs[k][m], y[m])),
                                                          ll(pdeb[m], y[m]).mean(), ll(D.refs[k][m], y[m]).mean()))
    P = dict(D.refs, debut=pdeb)
    for reg, need, sets, raw in (("close", ["close", "debut", "seeded"], [["close"], ["close", "debut"]], "close"),
                                 ("open", ["open", "debut", "seeded"], [["open"], ["open", "debut"]], "open"),
                                 ("noline", ["debut", "seeded", "elo"], [["debut"], ["debut", "seeded"]], "seeded")):
        ok = np.all([np.isfinite(P[k]) for k in need], axis=0)
        gate = ok & np.isin(yr, [2021, 2022, 2023])
        pp = {}
        for cs in sets:
            q = np.full(len(y), np.nan)
            Z = np.column_stack([zl(P[c]) for c in cs])
            for Y in (2021, 2022, 2023):
                tr, te = ok & (yr >= 2019) & (yr < Y), ok & (yr == Y)
                q[te] = 1 / (1 + np.exp(-(Z[te] @ stacker(Z[tr], y[tr]))))
            pp["+".join(cs)] = q
        L = lambda p: ll(p[gate], y[gate]).mean()  # noqa: E731
        s1, s2 = L(pp["+".join(sets[0])]), L(pp["+".join(sets[1])])
        if reg == "noline":
            print("  stack gate 2021-23 noline n %d: raw seeded %.5f, raw debut %.5f, stack debut %.5f, stack debut+seeded"
                  " %.5f" % (gate.sum(), L(P["seeded"]), L(P["debut"]), s1, s2))
        else:
            base = min(L(P[raw]), s1)
            print("  stack gate 2021-23 %s n %d: raw line %.5f, stack line %.5f, stack line+debut %.5f -> %+.5f (%s); "
                  "stack vs raw line %s" % (reg, gate.sum(), L(P[raw]), s1, s2, s2 - base,
                                            "enters" if s2 < base - 0.0005 else "rejected",
                                            boot(ev[gate], ll(pp["+".join(sets[1])][gate], y[gate]) - ll(P[raw][gate], y[gate]))))
    for line in ("open", "close"):                     # the look: frozen structure, weights on 2019..Y-1 OOF rows
        ok = np.isfinite(P[line]) & np.isfinite(pdeb) & (yr >= 2019)
        Z = np.column_stack([zl(P[line]), zl(pdeb)])
        q = np.full(len(y), np.nan)
        for Y in (2024, 2025):
            tr, te = ok & (yr < Y), ok & (yr == Y)
            q[te] = 1 / (1 + np.exp(-(Z[te] @ stacker(Z[tr], y[tr]))))
        m = ok & (yr >= 2024)
        print("  2024-25 stack [%s, debut] vs %s %s" % (line, line, boot(ev[m], ll(q[m], y[m]) - ll(P[line][m], y[m]))))


def cmd_cv(args):
    D = Data(args.net)
    y, yr = D.y, D.yr
    cvm = np.isin(yr, CV)
    cols = sum((BL[b] for b in FROZEN[0]), [])
    p_fz = D.oof(cols, FROZEN[1], FROZEN[2], CV + [2024, 2025])
    print("[%s] frozen config: CV 2019-23 %.5f (builder 0.61430); 2024-25 %.5f (builder 0.6402)" % (
        args.net, ll(p_fz[cvm], y[cvm]).mean(), ll(p_fz[yr >= 2024], y[yr >= 2024]).mean()))
    tr = np.where(yr < 2024)[0]
    sw = D.fitpred(cols, 1.0, 2.0, tr, tr) + D.fitpred(cols, 1.0, 2.0, tr, tr, swap=True) - 1
    print("swap test (fit 2012-2023): max |p + p_swapped - 1| = %.2e" % np.max(np.abs(sw)))
    ch, cur = D.greedy(CV)
    print("[%s] greedy on pooled 2019-23: %s C %g tau %g -> %.5f" % (args.net, ch, cur[1], cur[2], cur[0]))
    p_nest = np.full(len(y), np.nan)
    if args.nested:
        for Y in CV + [2024]:
            chY, curY = D.greedy(list(range(2015, Y)))      # selection sees only years before the scored year
            cY = sum((BL[b] for b in chY), [])
            for T in ([Y] if Y < 2024 else [2024, 2025]):
                te = np.where(yr == T)[0]
                p_nest[te] = D.fitpred(cY, curY[1], curY[2], np.where((yr < T) & (yr >= 2012))[0], te)
            print("  nested pick for %s (inner CV 2015-%d): %s C %g tau %g" % (Y, Y - 1, chY, curY[1], curY[2]), flush=True)
        print("[%s] nested OOF: 2019-23 %.5f (non-nested %.5f); 2024-25 %.5f" % (
            args.net, ll(p_nest[cvm], y[cvm]).mean(), ll(cur[3][cvm], y[cvm]).mean(), ll(p_nest[yr >= 2024], y[yr >= 2024]).mean()))
    report(D, "frozen config (builder's choice), verifier's code", p_fz)
    if args.nested:
        report(D, "nested selection", p_nest)
        m = (yr >= 2019) & np.isfinite(D.refs["seeded"])
        print("pooled 2019-25 vs seeded: frozen %s; nested %s" % (
            boot(D.ev[m], ll(p_fz[m], y[m]) - ll(D.refs["seeded"][m], y[m]), seed=4),
            boot(D.ev[m], ll(p_nest[m], y[m]) - ll(D.refs["seeded"][m], y[m]), seed=4)))
    os.makedirs(OUT, exist_ok=True)
    pickle.dump({"fid": D.d.fid.tolist(), "p_fz": p_fz, "p_nest": p_nest}, open(os.path.join(OUT, "cv_%s.pkl" % args.net), "wb"))


# ------------------------------------------------------------------ method: P(KO/SUB/DEC | winner)
LBS = {"Flyweight": 125, "Bantamweight": 135, "Featherweight": 145, "Lightweight": 155, "Welterweight": 170,
       "Middleweight": 185, "Light Heavyweight": 205, "Heavyweight": 265, "Women's Strawweight": 115,
       "Women's Flyweight": 125, "Women's Bantamweight": 135, "Women's Featherweight": 145}
K3 = ["ko", "sub", "dec"]


def cmd_method(args):
    from scipy.optimize import minimize
    fights, _, _ = ufc_dev()
    D = Data("builder")
    d, y, yr, ev = D.d, D.y, D.yr, D.ev
    yk = np.array([K3.index(c) if c in K3 else -1 for c in d.cat])
    ok = yk >= 0
    cvp = pickle.load(open(os.path.join(OUT, "cv_builder.pkl"), "rb"))
    assert cvp["fid"] == d.fid.tolist()
    p_deb = np.asarray(cvp["p_fz"])
    p_seed = np.where(np.isnan(D.refs["seeded"]), D.refs["elo"], D.refs["seeded"])
    p_led = np.where(np.isfinite(D.refs["close"]), D.refs["close"], np.where(np.isfinite(D.refs["open"]), D.refs["open"], p_seed))
    pw_tr = np.where(np.isfinite(p_deb), p_deb, D.refs["elo"])

    def prof(t):
        n = d["n" + t].to_numpy(float)
        fade = np.exp(-n / 4.0) * np.nan_to_num(D.col("pav_" + t))
        fill = lambda k, v: np.where(np.isnan(D.col(k + "_" + t)), v, D.col(k + "_" + t))  # noqa: E731
        z = lambda k: np.nan_to_num(D.col(k + "_" + t))  # noqa: E731
        return dict(ko=fill("pre_ko", .3) * fade, sub=fill("pre_sub", .15) * fade, kol=fill("pre_kol", .15) * fade,
                    subl=fill("pre_subl", .08) * fade, uko=(z("uko_w") + .3) / (n + 2), usub=(z("usub_w") + .2) / (n + 2),
                    ukol=(z("uko_l") + .2) / (n + 2), usubl=(z("usub_l") + .1) / (n + 2), deb=(n == 0).astype(float))
    PA_, PB_ = prof("A"), prof("B")
    five = (d.rounds.to_numpy(float) >= 5).astype(float)
    lbs = np.array([LBS.get(x, 160) / 100 for x in d.division])
    wom = np.array([str(x).startswith("Women") for x in d.division], float)

    def X(W, L, pw):
        return np.column_stack([W["ko"], W["sub"], W["uko"], W["usub"], L["kol"], L["subl"], L["ukol"], L["usubl"],
                                np.abs(zl(pw)), five, lbs, wom, W["deb"], L["deb"]])
    off = np.zeros((len(d), 3))
    for Y in sorted(set(yr)):
        cnt = defaultdict(Counter)
        for f in fights:
            if Y - 5 <= f.date.year < Y and f.cat in K3:
                cnt[f.division][f.cat] += 1
                cnt["*"][f.cat] += 1
        tot = cnt["*"]
        nt = sum(tot.values())
        bt = {dv: np.array([(cc[k] + 20 * tot[k] / nt) / (sum(cc.values()) + 20) for k in K3]) for dv, cc in cnt.items()}
        s = yr == Y
        off[s] = np.log(np.array([bt.get(x, bt["*"]) for x in d.division[s]]))

    def mn_fit(Xm, O, t, lam):
        mu, sd = Xm.mean(0), Xm.std(0)
        sd[sd < 1e-9] = 1
        Z = (Xm - mu) / sd
        n, k = Z.shape
        Y1 = np.eye(3)[t]

        def f(w):
            W = np.vstack([w.reshape(2, k + 1), np.zeros(k + 1)])
            E = O + W[:, 0] + Z @ W[:, 1:].T
            E -= E.max(1, keepdims=True)
            P = np.exp(E)
            P /= P.sum(1, keepdims=True)
            R = (P - Y1)[:, :2] / n
            G = np.column_stack([R.sum(0), R.T @ Z])
            G[:, 1:] += lam / n * W[:2, 1:]
            return -np.sum(Y1 * np.log(P + 1e-300)) / n + 0.5 * lam / n * np.sum(W[:2, 1:] ** 2), G.ravel()
        w = minimize(f, np.zeros(2 * (k + 1)), jac=True, method="BFGS", options={"gtol": 1e-8}).x
        return mu, sd, np.vstack([w.reshape(2, k + 1), np.zeros(k + 1)])

    def mn_pred(m, Xm, O):
        mu, sd, W = m
        E = O + W[:, 0] + ((Xm - mu) / sd) @ W[:, 1:].T
        E -= E.max(1, keepdims=True)
        P = np.exp(E)
        return P / P.sum(1, keepdims=True)

    def run(years, pw_train, pw_test, pw_marg, pw_base, lam, label):
        winA = y == 1
        PA = np.full((len(d), 3), np.nan)
        PB = PA.copy()
        for Y in years:
            tr, te = ok & (yr < Y), yr == Y
            Xw = np.where(winA[:, None], X(PA_, PB_, pw_train), X(PB_, PA_, pw_train))
            m = mn_fit(Xw[tr], off[tr], yk[tr], lam)
            PA[te] = mn_pred(m, X(PA_, PB_, pw_test)[te], off[te])
            PB[te] = mn_pred(m, X(PB_, PA_, pw_test)[te], off[te])
        msk = np.isin(yr, years) & ok
        i, kk, base = np.arange(len(d)), np.maximum(yk, 0), np.exp(off)
        lg = -np.log(np.where(winA[:, None], PA, PB)[i, kk]) + np.log(base[i, kk])
        l3 = -np.log((pw_marg[:, None] * PA + (1 - pw_marg[:, None]) * PB)[i, kk]) + np.log(base[i, kk])
        l6 = (-np.log(np.where(winA, pw_marg * PA[i, kk], (1 - pw_marg) * PB[i, kk]))
              + np.log(np.where(winA, pw_base, 1 - pw_base) * base[i, kk]))
        print("%-60s method|winner %s | method3 %s | who x how %s" % (label, boot(ev[msk], lg[msk], seed=5),
                                                                       boot(ev[msk], l3[msk], seed=5), boot(ev[msk], l6[msk], seed=5)))
    for lam in (10.0, 30.0, 100.0):
        run(CV, pw_tr, pw_tr, pw_tr, p_seed, lam, "CV 2019-23 lam %g, debut-model winner (as built)" % lam)
    run(CV, pw_tr, p_led, p_led, p_led, 30.0, "CV 2019-23 lam 30, ledger winner fed (close>open>seeded)")
    run([2024, 2025], pw_tr, pw_tr, pw_tr, p_seed, 30.0, "2024-25 lam 30, debut-model winner (as built)")
    run([2024, 2025], pw_tr, p_led, p_led, p_led, 30.0, "2024-25 lam 30, ledger winner fed (adopted path)")


# ------------------------------------------------------------------ checks
def cmd_checks(args):
    from scipy.optimize import minimize
    # 1. universe from the raw CSVs (name identity), 2026 dropped at read
    ev_d = {r["EVENT"].strip(): dt.datetime.strptime(r["DATE"].strip(), "%B %d, %Y").date()
            for r in csv.DictReader(open(os.path.join(ROOT, "data", "raw", "ufc_event_details.csv")))}
    rows = []
    for r in csv.DictReader(open(os.path.join(ROOT, "data", "raw", "ufc_fight_results.csv"))):
        d0 = ev_d.get(r["EVENT"].strip())
        if d0 is not None and d0 < VAULT:
            a, b = [x.strip() for x in r["BOUT"].split(" vs. ")]
            rows.append((d0, r["URL"].strip().rsplit("/", 1)[-1], a, b))
    rows.sort(key=lambda x: x[0])
    seen, mine = Counter(), set()
    for d0, fid, a, b in rows:
        if d0 >= G0 and (seen[a] == 0 or seen[b] == 0):
            mine.add(fid)
        seen[a] += 1
        seen[b] += 1
    Fr = load_frame()
    theirs = set(Fr.fid)
    print("1. universe from raw CSVs (name identity): %d bouts; only mine %d, only the builder's %d %s" % (
        len(mine), len(mine - theirs), len(theirs - mine),
        [(str(r.date), r.nameA, r.nameB) for _, r in Fr[Fr.fid.isin(theirs - mine)].iterrows()]))
    # 2. duplicate-row leak, on the BUILDER's row flags (tools/debut.py _parse_rows: preufc.verify match or promotion
    #    "UFC"; the verifier's own pages flag any row within 3 days as UFC, so they are immune by construction)
    #    + 3. page resolution
    import debut as DB
    import preufc as PU
    fights, people, bouts = ufc_dev()
    pages = build_pages(bouts)
    res = json.load(open(DB.DRESOLVE))
    fx = PU.Fetcher(offline=True)
    near, full_res = [], 0
    deb = set(Fr.person_A[Fr.nA == 0]) | set(Fr.person_B[Fr.nB == 0])
    for p, pg in pages.items():
        ud = [t[0] for t in bouts[p]]
        rows, _, _, _ = DB._parse_rows(PU.parse_fighter(fx.get(PU.BASE + res[p]["href"], DB.fighter_path(res[p]["href"]))),
                                       bouts[p])
        for x in rows:
            if x["_ufc"] or not x["_d"]:
                continue
            for u in ud:
                if abs((u - x["_d"]).days) <= 3:
                    near.append((p, str(u), x["date"], x["opp"], x["event"]))
        if p in deb and all(any(abs((x["d"] - u).days) <= 3 for x in pg["pro"]) for u in ud):
            full_res += 1
    print("2. builder's non-UFC page rows within 3 days of one of the man's UFC bouts (a shifted copy of a UFC result): "
          "%d %s" % (len(near), near[:5]))
    print("3. debutants whose page lists every one of their UFC bouts (date match): %d of %d" % (full_res, len(deb)))
    # 4. replacement vs the close
    d = Fr[Fr.winner.isin(["A", "B"])].copy()
    d["y"] = (d.winner == "A").astype(float)
    one = (d.repl_A.fillna(0) + d.repl_B.fillna(0)) == 1
    for nm, m in (("2012-2023", d.year < 2024), ("2024-2025", d.year >= 2024)):
        s = d[m & one]
        ra = s.repl_A.fillna(0) == 1
        yy = np.where(ra, s.y, 1 - s.y)
        pc = np.where(ra, s.p_close, 1 - s.p_close)
        print("4. %s: %d bouts with one replacement; he won %.3f; the close gave him %.3f" % (nm, len(s), yy.mean(), np.nanmean(pc)))
    # 5. free intercept on the frozen OOF (corner order the model cannot use)
    D = Data("builder")
    cvp = pickle.load(open(os.path.join(OUT, "cv_builder.pkl"), "rb"))
    p = np.asarray(cvp["p_fz"])
    rng = np.random.default_rng(1)
    for nm, m in (("CV 2019-23", np.isin(D.yr, CV)), ("2024-25", D.yr >= 2024)):
        z, yy, g = zl(p[m]), D.y[m], D.ev[m]
        fit = lambda zz, y_: minimize(lambda w: np.sum(np.logaddexp(0, w[0] + w[1] * zz) - y_ * (w[0] + w[1] * zz)),  # noqa
                                      [0, 1], method="BFGS").x
        w = fit(z, yy)
        ug = np.unique(g)
        idx = {u: np.where(g == u)[0] for u in ug}
        bs = []
        for _ in range(500):
            ii = np.concatenate([idx[u] for u in rng.choice(ug, len(ug))])
            bs.append(fit(z[ii], yy[ii])[0])
        print("5. %s: A wins %.3f; free intercept %+.3f [%+.3f, %+.3f] (unused by the no-intercept model)" % (
            nm, yy.mean(), w[0], *np.percentile(bs, [2.5, 97.5])))
    # 6. drop one column from the frozen model (CV 2019-23)
    cols = sum((BL[b] for b in FROZEN[0]), [])
    m = np.isin(D.yr, CV)
    base = ll(D.oof(cols, 1.0, 2.0, CV)[m], D.y[m]).mean()
    out = sorted(((ll(D.oof([c for c in cols if c != k], 1.0, 2.0, CV)[m], D.y[m]).mean() - base, k) for k in cols),
                 reverse=True)
    print("6. drop-one CV 2019-23 log loss change: " + ", ".join("%s %+.4f" % (k, v) for v, k in out))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("net")
    c = sub.add_parser("cv")
    c.add_argument("--net", choices=["builder", "mine"], default="builder")
    c.add_argument("--nested", action="store_true")
    sub.add_parser("method")
    sub.add_parser("checks")
    args = ap.parse_args()
    {"net": cmd_net, "cv": cmd_cv, "method": cmd_method, "checks": cmd_checks}[args.cmd](args)


if __name__ == "__main__":
    main()
