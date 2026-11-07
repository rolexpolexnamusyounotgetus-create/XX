#!/usr/bin/env python3
"""Adversarial verification of the props workstream (research/model_props.md "Verification log").

Independent re-derivation with its own code: own parse of the compact extract (data/raw/odds/bfo_props_full.csv), own
power / multiplicative de-vig, own date + fuzzy-name join to backtest_dev.json (checked against market.json's BFO
matchup ids), own outcome coding, own winner stack (market + ML v2, no intercept, w >= 0, forward-chained), own
joint-linear pool (grid search over its single weight), own 7-bin / method-given-winner scoring and own event-cluster
bootstrap (2,000 resamples of cards, paired). Comparator inputs taken from the builder's caches: S2 / S2+ml2win cells,
W_ml2, the hazard and market.json's props joint (out/props_cache/cells.pkl, checked against ml2's own stored outputs),
and the debut METHOD model's walk-forward cells (out/props_cache/debut.pkl, tools/debut.py's verified model).

    nice -n 5 python3 tools/props_verify.py        # about 1 minute; writes data/derived/props_verify.json

Never reads a 2026 row (asserted). 2024-25 rows are only re-scored (the builder's single look already happened);
nothing here is selected on them.
"""
import csv, json, os, pickle, re, sys, unicodedata, datetime as dt
from collections import defaultdict, Counter
from difflib import SequenceMatcher
import numpy as np
from scipy.optimize import minimize

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VAULT = "2026-01-01"
DRAW_C = 0.01457                 # methodround.json meta.chosen.draw_c
SEED = 20261107
OUT = os.path.join(ROOT, "data", "derived", "props_verify.json")
R = {}


def J(p):
    return json.load(open(os.path.join(ROOT, p)))


# ============================================================ 1. own parse, de-vig, join
def norm_tokens(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z ]+", " ", s.replace("-", " "))
    return [t for t in s.split() if t not in ("jr", "sr", "ii", "iii", "de", "da", "dos", "do")]


def name_score(a, b):
    ta, tb = norm_tokens(a), norm_tokens(b)
    if not ta or not tb:
        return 0.0
    sa, sb = set(ta), set(tb)
    r = [len(sa & sb) / len(sa | sb), 0.6 * (ta[-1] == tb[-1]) + 0.4 * (ta[0] == tb[0]),
         SequenceMatcher(None, " ".join(ta), " ".join(tb)).ratio(),
         SequenceMatcher(None, " ".join(sorted(ta)), " ".join(sorted(tb))).ratio(),
         SequenceMatcher(None, "".join(ta), "".join(tb)).ratio(),
         0.75 * max(SequenceMatcher(None, x, y).ratio() for x in ta for y in tb)]
    return max(r)


def q_of(a):
    if a in ("", None):
        return None
    a = float(a)
    return 1.0 / (1 + a / 100.0 if a > 0 else 1 + 100.0 / (-a))


def devig(q, how):
    q = np.asarray(q, float)
    S = q.sum()
    if how == "mult" or S <= 1:
        return q / S
    lo, hi = 1.0, 40.0
    for _ in range(100):
        k = 0.5 * (lo + hi)
        lo, hi = (k, hi) if (q ** k).sum() > 1 else (lo, k)
    v = q ** (0.5 * (lo + hi))
    return v / v.sum()


def book_m6(r, t1, t2, how):
    """[A KO, A SUB, A DEC, B KO, B SUB, B DEC]; decision = 'dec', else UD + split/majority; draw leg ignored."""
    def dq(t):
        q = q_of(r["dec%d" % t])
        if q is not None:
            return q
        u, m = q_of(r["ud%d" % t]), q_of(r["sm%d" % t])
        return u + m if (u is not None and m is not None) else None
    q = [q_of(r["ko%d" % t1]), q_of(r["sub%d" % t1]), dq(t1), q_of(r["ko%d" % t2]), q_of(r["sub%d" % t2]), dq(t2)]
    if any(x is None or x <= 0 or x >= 1 for x in q) or not (0.95 <= sum(q) <= 1.8):
        return None
    return devig(q, how)


def match(mus_by_date, by_mu, date, a, b):
    d0 = dt.date.fromisoformat(date)
    c = []
    for dd in (0, -1, 1):
        for mu in mus_by_date.get((d0 + dt.timedelta(days=dd)).isoformat(), []):
            r0 = by_mu[mu][0]
            keep = min(name_score(a, r0["t1"]), name_score(b, r0["t2"]))
            swap = min(name_score(a, r0["t2"]), name_score(b, r0["t1"]))
            if max(keep, swap) >= 0.6:
                c.append((max(keep, swap), -abs(dd), mu, swap > keep))
    c.sort(reverse=True)
    return (c[0][2], c[0][3]) if c else (None, None)


def consensus(V, outlier=True):
    V = np.array(V)
    if outlier and len(V) >= 3:
        pdec = V[:, 2] + V[:, 5]
        k = np.abs(pdec - np.median(pdec)) <= 0.15
        V = V[k] if k.any() else V
    return V.mean(0)


rows_x = [r for r in csv.DictReader(open(os.path.join(ROOT, "data/raw/odds/bfo_props_full.csv")))]
R["extract"] = {"rows": len(rows_x), "max_date": max(r["date"] for r in rows_x),
                "rows_2026": sum(r["date"] >= VAULT for r in rows_x),
                "price_cells_abs_lt_100": sum(1 for r in rows_x for k, v in r.items()
                                              if k not in ("mu", "date", "event", "book", "t1", "t2") and v != ""
                                              and abs(float(v)) < 100)}
assert R["extract"]["rows_2026"] == 0
by_mu = defaultdict(list)
for r in rows_x:
    by_mu[r["mu"]].append(r)
mus_by_date = defaultdict(list)
for mu, rr in by_mu.items():
    mus_by_date[rr[0]["date"]].append(mu)

bt = J("data/derived/backtest_dev.json")["fights"]
mk = J("data/derived/market.json")["fights"]
fights = [f for f in bt if "2021-01-01" <= f["date"] < VAULT]
assert all(f["date"] < VAULT for f in fights)
MAP = {"KO": 0, "DOC": 0, "SUB": 1, "UD": 2, "SD": 2, "MD": 2}
recs = []
for f in fights:
    res = f["result"]
    side = {"A": 0, "B": 1}.get(res["winner"], -1)
    meth = MAP.get(res["method"], -1) if side >= 0 else -1
    if res["method"] == "DRAW":
        side = -2
    mu, sw = match(mus_by_date, by_mu, f["date"], f["A"]["name"], f["B"]["name"])
    books, ml = {}, []
    if mu:
        t1, t2 = (2, 1) if sw else (1, 2)
        for r in by_mu[mu]:
            p = book_m6(r, t1, t2, "power")
            if p is not None:
                books[r["book"]] = p
            q1, q2 = q_of(r["ml%d" % t1]), q_of(r["ml%d" % t2])
            if q1 and q2:
                ml.append(q1 / (q1 + q2))
    recs.append({"id": f["id"], "year": int(f["date"][:4]), "date": f["date"], "event": f["event"], "side": side,
                 "meth": meth, "mu": mu, "sw": sw, "books": books, "ml": float(np.mean(ml)) if ml else np.nan,
                 "mk_mu": str((mk.get(f["id"], {}).get("bfo") or {}).get("matchup") or ""),
                 "p_close": mk.get(f["id"], {}).get("p_power_close"),
                 "seg": None})
fw = J("data/derived/fightweek.json")["fights"]
for r in recs:
    r["seg"] = (fw.get(r["id"]) or {}).get("card_segment")
own = [r for r in recs if r["mu"]]
R["join"] = {"fights_2021_2025": len(recs), "own_matched": len(own),
             "same_mu_as_market_json": sum(r["mu"] == r["mk_mu"] for r in own),
             "different_mu (BFO duplicate listings)": sum(1 for r in own if r["mk_mu"] and r["mu"] != r["mk_mu"]),
             "market_json_mu_without_prop_rows": sum(1 for r in recs if not r["mu"] and r["mk_mu"])}

# ============================================================ 2. comparator cells, checks, own winner stack
C = pickle.load(open(os.path.join(ROOT, "out/props_cache/cells.pkl"), "rb"))
pos = {f: i for i, f in enumerate(C["ids"])}
ml2 = J("data/derived/ml2.json")["fights"]
ref = J("out/ml2_cache/method.json")["_pred_test"]
R["checks"] = {
    "W_ml2 vs ml2.json max_abs": float(max(abs(ml2[i]["ml2"] - C["pwin"][pos[i]]) for i in C["ids"]
                                           if i in ml2 and ml2[i].get("ml2") is not None)),
    "S2+ml2win 2024-25 cells vs ml2 cache max_abs": float(max(np.max(np.abs(np.asarray(v) - C["J"]["S2+ml2win"][pos[f]]))
                                                              for f, v in ref.items() if f in pos))}


def parts(yy):
    if yy < 0:
        return -1, -1
    if yy == 22:
        return -2, -1
    if yy in (20, 21):
        return yy - 20, 2
    return (0 if yy < 10 else 1), (yy % 10) // 5


mism = Counter()
for r in recs:
    s, m = parts(int(C["y"][pos[r["id"]]]))
    if (s, m) != (r["side"], r["meth"]) and not (s == -1 and r["meth"] == -1):
        mism[str(((s, m), (r["side"], r["meth"])))] += 1
R["checks"]["outcome coding mismatches vs the 23-cell y (DQ excluded both ways)"] = dict(mism)


def logit(p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


def sig(z):
    return 1 / (1 + np.exp(-z))


def fit_lr(Z, y, intercept=False):
    def f(b):
        z = Z @ b[:Z.shape[1]] + (b[-1] if intercept else 0)
        return np.mean(np.logaddexp(0, -z) * y + np.logaddexp(0, z) * (1 - y))
    k = Z.shape[1]
    return minimize(f, np.r_[np.full(k, 0.4), [0.0] if intercept else []], method="L-BFGS-B",
                    bounds=[(0, None)] * k + ([(None, None)] if intercept else [])).x


ids_all = [i for i in C["ids"] if C["date"][pos[i]] < VAULT]
yrs = np.array([int(C["year"][pos[i]]) for i in ids_all])
pc = np.array([mk.get(i, {}).get("p_power_close") if mk.get(i, {}).get("p_power_close") is not None else np.nan
               for i in ids_all])
pm = np.array([C["pwin"][pos[i]] for i in ids_all])
yw = np.array([{0: 1, 1: 0}.get(parts(int(C["y"][pos[i]]))[0], -1) for i in ids_all])
Z = np.c_[logit(np.nan_to_num(pc, nan=0.5)), logit(pm)]
has = ~np.isnan(pc)
Wc = pm.copy()
for Y in (2020, 2021, 2022, 2023, 2024):
    tr = has & (yw >= 0) & (yrs >= 2019) & (yrs < Y)
    b = fit_lr(Z[tr], yw[tr].astype(float))
    pr = ((yrs == Y) if Y < 2024 else (yrs >= 2024)) & has
    Wc[pr] = sig(Z[pr] @ b)
wb = pickle.load(open(os.path.join(ROOT, "out/props_cache/winner.pkl"), "rb"))
wbd = dict(zip(wb["ids"], wb["W_close"]))
R["checks"]["own W_close vs builder max_abs"] = float(max(abs(Wc[k] - wbd[i]) for k, i in enumerate(ids_all)))
tr = has & (yw >= 0) & (yrs >= 2019) & (yrs <= 2023)
R["checks"]["winner stack with a free intercept, unmirrored 2019-2023 [market, ml2, intercept]"] = \
    [round(float(x), 4) for x in fit_lr(Z[tr], yw[tr].astype(float), True)]
R["checks"]["A wins share 2019-2023 (decisive, with close)"] = round(float(yw[tr].mean()), 4)
Wcd = dict(zip(ids_all, Wc))


def cond_joint(Jc):
    M, W = np.zeros((2, 3)), np.zeros(2)
    for s, (bko, bsub, bdec) in enumerate(((0, 5, 20), (10, 15, 21))):
        v = np.array([Jc[bko:bko + 5].sum(), Jc[bsub:bsub + 5].sum(), Jc[bdec]])
        M[s], W[s] = v / v.sum(), v.sum()
    return M, W[0] / W.sum()


N = len(recs)
yr = np.array([r["year"] for r in recs])
side = np.array([r["side"] for r in recs])
meth = np.array([r["meth"] for r in recs])
ev = np.array([r["event"] for r in recs])
W = np.array([Wcd[r["id"]] for r in recs])
Ms2 = np.zeros((N, 2, 3))
Mb = np.zeros((N, 2, 3))
Mp = np.full((N, 2, 3), 1 / 3)
Wp = np.full(N, 0.5)
hasP = np.zeros(N, bool)
hasPM = np.zeros(N, bool)
nb = np.zeros(N, int)
for k, r in enumerate(recs):
    i = pos[r["id"]]
    p6 = C["P6"]["S2"][i]                      # methodround order [XKO, XSUB, XDEC, YDEC, YSUB, YKO]
    Ms2[k] = np.stack([p6[[0, 1, 2]] / p6[[0, 1, 2]].sum(), p6[[5, 4, 3]] / p6[[5, 4, 3]].sum()])
    PMK = C["PMK"][i]
    hasPM[k] = not np.isnan(PMK[0])
    Mb[k] = cond_joint(0.4 * C["J"]["S2+ml2win"][i] + 0.6 * PMK if hasPM[k] else C["J"]["S2+ml2win"][i])[0]
    if r["books"]:
        v = consensus(list(r["books"].values()))
        Mp[k] = np.stack([v[:3] / v[:3].sum(), v[3:] / v[3:].sum()])
        Wp[k] = v[:3].sum()
        hasP[k] = True
        nb[k] = len(r["books"])
Ws2 = np.array([C["pwin"][pos[r["id"]]] for r in recs])
tab = pickle.load(open(os.path.join(ROOT, "out/props_cache/table.pkl"), "rb"))["tab"]
dd, flips = [], 0
for k, r in enumerate(recs):
    t = tab.get(r["id"], {})
    if t.get("m6") is not None and hasP[k]:
        v = np.asarray(t["m6"], float)
        dd.append(np.abs(np.stack([v[:3] / v[:3].sum(), v[3:] / v[3:].sum()]) - Mp[k]).max())
        flips += abs(v[:3].sum() / v.sum() - Wp[k]) > 0.3
R["checks"]["own vs builder props method|winner"] = {"n": len(dd), "median_max_abs": round(float(np.median(dd)), 4),
                                                     "p99": round(float(np.percentile(dd, 99)), 4),
                                                     "orientation_disagreements": int(flips)}
R["coverage"] = {"with_own_method_props_by_year": {str(y): [int(((yr == y) & hasP).sum()), int((yr == y).sum())]
                                                   for y in range(2021, 2026)},
                 "missing_by_year": dict(Counter(map(str, yr[~hasP]))),
                 "decision_share_missing_vs_with": [round(float(((meth == 2) & ~hasP).sum() / ((side >= 0) & ~hasP).sum()), 3),
                                                    round(float(((meth == 2) & hasP).sum() / ((side >= 0) & hasP).sum()), 3)]}


# ============================================================ 3. pool, scoring, bootstrap
def jlin(w, Ma, Wa, Mb_, Wb_):
    out = np.zeros_like(Ma)
    for s in (0, 1):
        ca, cb = w * (Wa if s == 0 else 1 - Wa), (1 - w) * (Wb_ if s == 0 else 1 - Wb_)
        out[:, s] = (ca[:, None] * Ma[:, s] + cb[:, None] * Mb_[:, s]) / (ca + cb)[:, None]
    return out


def logpool(a, Ma, Mb_):
    s = a[0] * np.log(np.clip(Ma, 1e-6, 1)) + a[1] * np.log(np.clip(Mb_, 1e-6, 1))
    e = np.exp(s - s.max(-1, keepdims=True))
    return e / e.sum(-1, keepdims=True)


def mgw(M, ix):
    return -np.log(np.clip(M[ix, side[ix], meth[ix]], 1e-12, 1))


def bin7(M, ix):
    Wi, Mi, s, m = W[ix], M[ix], side[ix], meth[ix]
    dr = DRAW_C * (Wi * Mi[:, 0, 2] + (1 - Wi) * Mi[:, 1, 2])
    pw = np.where(s == 0, Wi, 1 - Wi)
    p = np.where(s == -2, dr, (1 - dr) * pw * Mi[np.arange(len(ix)), np.maximum(s, 0), np.maximum(m, 0)])
    return -np.log(np.clip(p, 1e-12, 1))


def method3(M, ix):
    Wi, Mi, s, m = W[ix], M[ix], side[ix], meth[ix]
    dr = DRAW_C * (Wi * Mi[:, 0, 2] + (1 - Wi) * Mi[:, 1, 2])
    marg = (1 - dr)[:, None] * (Wi[:, None] * Mi[:, 0] + (1 - Wi[:, None]) * Mi[:, 1])
    marg[:, 2] += dr
    return -np.log(np.clip(marg[np.arange(len(ix)), np.where(s == -2, 2, m)], 1e-12, 1))


def boot_diff(la, lb, events, B=2000, seed=SEED):
    ue = np.unique(events)
    eix = {e: np.flatnonzero(events == e) for e in ue}
    sa = np.array([la[eix[e]].sum() for e in ue])
    sb = np.array([lb[eix[e]].sum() for e in ue])
    c = np.array([len(eix[e]) for e in ue])
    rg = np.random.default_rng(seed)
    d = np.empty(B)
    for b in range(B):
        p = rg.integers(0, len(ue), len(ue))
        d[b] = (sa[p].sum() - sb[p].sum()) / c[p].sum()
    return [round(float(la.mean() - lb.mean()), 5)] + [round(float(x), 4) for x in np.percentile(d, [2.5, 97.5])]


def fit_w(ix, Ma, Wa, Mb_, Wb_):
    g = np.linspace(0, 1, 1001)
    return float(g[int(np.argmin([mgw(jlin(x, Ma, Wa, Mb_, Wb_), ix).mean() for x in g]))])


dec = side >= 0
sc7 = side != -1


def window(label, folds):
    Mpool, Mlog, Mtilt = (np.full_like(Ms2, np.nan) for _ in range(3))
    wts = {}
    for name, tr, te in folds:
        tri = np.flatnonzero(tr & hasP & dec)
        tem = te & hasP
        w = fit_w(tri, Ms2, Ws2, Mp, Wp)
        wts[name] = w
        Mpool[tem] = jlin(w, Ms2[tem], Ws2[tem], Mp[tem], Wp[tem])
        a = minimize(lambda a: mgw(logpool(a, Ms2, Mp), tri).mean(), [0.5, 0.5], method="L-BFGS-B", bounds=[(0, 5)] * 2).x
        Mlog[tem] = logpool(a, Ms2[tem], Mp[tem])

        def tilt(th, rows):            # free corner-specific tilts [A sub, A dec, B sub, B dec]
            P = jlin(th[0], Ms2[rows], Ws2[rows], Mp[rows], Wp[rows]).copy()
            P[:, 0] *= np.exp(np.r_[0, th[1], th[2]])
            P[:, 1] *= np.exp(np.r_[0, th[3], th[4]])
            return P / P.sum(-1, keepdims=True)
        th = minimize(lambda th: -np.mean(np.log(np.clip(tilt(th, tri)[np.arange(len(tri)), side[tri], meth[tri]], 1e-12, 1))),
                      [0.5, 0, 0, 0, 0], method="L-BFGS-B", bounds=[(0, 1)] + [(-2, 2)] * 4).x
        Mtilt[tem] = tilt(th, np.flatnonzero(tem))
    sc = np.zeros(N, bool)
    for _, _, te in folds:
        sc |= te
    ixm, ix7 = np.flatnonzero(sc & hasP & dec), np.flatnonzero(sc & hasP & sc7)
    pk = {"S2": Ms2, "props": Mp, "blend40/60": Mb, "pool_jlin": Mpool, "pool_log": Mlog}
    out = {"jlin_S2_weight": wts, "n_method_given_winner": len(ixm), "n_7bin": len(ix7),
           "means": {k: {"method_given_winner": round(float(mgw(M, ixm).mean()), 5), "bin7": round(float(bin7(M, ix7).mean()), 5),
                         "method3": round(float(method3(M, ix7).mean()), 5)} for k, M in pk.items()}, "paired": {}}
    for a, b in (("pool_jlin", "S2"), ("blend40/60", "S2"), ("props", "S2"), ("pool_jlin", "blend40/60"),
                 ("pool_jlin", "props"), ("pool_log", "pool_jlin")):
        out["paired"]["%s - %s" % (a, b)] = {"method_given_winner": boot_diff(mgw(pk[a], ixm), mgw(pk[b], ixm), ev[ixm]),
                                             "bin7": boot_diff(bin7(pk[a], ix7), bin7(pk[b], ix7), ev[ix7]),
                                             "method3": boot_diff(method3(pk[a], ix7), method3(pk[b], ix7), ev[ix7])}
    both = np.flatnonzero(sc & hasP & hasPM & dec)
    out["paired"]["pool_jlin - blend40/60, rows with both prop sources"] = {
        "n": len(both), "method_given_winner": boot_diff(mgw(Mpool, both), mgw(Mb, both), ev[both])}
    out["rows_with_own_props_but_no_market_json_props"] = int((sc & hasP & ~hasPM).sum())
    out["free_corner_tilts_minus_symmetric_pool (method|winner)"] = round(float(mgw(Mtilt, ixm).mean() - mgw(Mpool, ixm).mean()), 5)
    pdec = {}
    for k, M in pk.items():
        p = W[ix7] * M[ix7, 0, 2] + (1 - W[ix7]) * M[ix7, 1, 2]
        pdec[k] = round(float((DRAW_C * p + (1 - DRAW_C * p) * p).mean()), 4)
    pdec["observed"] = round(float(((meth[ix7] == 2) | (side[ix7] == -2)).mean()), 4)
    out["p_decision"] = pdec
    R[label] = out
    print(label, json.dumps(out["paired"]["pool_jlin - S2"]), json.dumps(out["paired"]["pool_jlin - blend40/60"]), flush=True)


window("cv_2022_2023", [(str(Y), (yr >= 2021) & (yr < Y), yr == Y) for Y in (2022, 2023)])
window("rescore_2024_2025 (fit 2021-2023; already looked at by the builder)", [("2024-25", (yr >= 2021) & (yr <= 2023), yr >= 2024)])

# ============================================================ 4. late / in-play price test, book count, winner gate
cell = lambda s, m: (0 if s == 0 else 3) + m      # noqa: E731
dr_, do_, per_book = [], [], defaultdict(lambda: [0, 0.0, 0.0])
for k, r in enumerate(recs):
    if side[k] < 0 or len(r["books"]) < 2:
        continue
    c = cell(side[k], meth[k])
    for b, p in r["books"].items():
        o = np.mean([q for bb, q in r["books"].items() if bb != b], 0)
        d = p - o
        dr_.append(d[c])
        do_.extend(np.delete(d, c).tolist())
        per_book[b][0] += 1
        per_book[b][1] += -np.log(p[c])
        per_book[b][2] += -np.log(o[c])
dr_, do_ = np.array(dr_), np.array(do_)
R["late_price_test"] = {"book_bouts": len(dr_), "sd_deviation_realised_cell": round(float(dr_.std()), 4),
                        "share_dev_gt_0.10": {"realised": round(float((dr_ > 0.10).mean()), 5), "non_realised": round(float((do_ > 0.10).mean()), 5)},
                        "share_dev_gt_0.15_realised": round(float((dr_ > 0.15).mean()), 5),
                        "per_book_sixway_ll_minus_other_books": {b: [n, round((lb - lo) / n, 4)] for b, (n, lb, lo) in sorted(per_book.items())}}
pcv = np.array([r["p_close"] if r["p_close"] is not None else np.nan for r in recs])
mlv = np.array([r["ml"] for r in recs])


def ll(p, y):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return round(float(np.mean(-(y * np.log(p) + (1 - y) * np.log(1 - p)))), 4)


for lo, hi in ((2021, 2023), (2024, 2025)):
    m = hasP & dec & ~np.isnan(pcv) & ~np.isnan(mlv) & (yr >= lo) & (yr <= hi)
    yA = (side[m] == 0).astype(float)
    R["late_price_test"]["winner_ll_%d_%d" % (lo, hi)] = {"n": int(m.sum()), "method_market_pA": ll(Wp[m], yA),
                                                          "same_books_moneyline": ll(mlv[m], yA), "consensus_close": ll(pcv[m], yA)}
R["book_count"] = {}
for lo, hi in ((2021, 2023), (2024, 2025)):
    for g, msk in (("1", nb == 1), ("3+", nb >= 3)):
        ix = np.flatnonzero(hasP & dec & (yr >= lo) & (yr <= hi) & msk)
        if len(ix) >= 10:
            R["book_count"]["%d-%d %s books" % (lo, hi, g)] = {"n": len(ix), "props_minus_S2_mgw": round(float(mgw(Mp, ix).mean() - mgw(Ms2, ix).mean()), 4)}
R["book_count"]["single_book_bouts_by_year"] = dict(Counter(map(str, yr[hasP & (nb == 1)])))
# winner gate: does the method market's own P(A) add to close + ML v2? forward-chained 2022-23 (props start 2021)
ok = hasP & dec & ~np.isnan(pcv)
y1 = (side == 0).astype(float)
Z2, Z3 = np.c_[logit(pcv), logit(Ws2)], np.c_[logit(pcv), logit(Ws2), logit(Wp)]
lz = lambda z, y: np.logaddexp(0, -z) * y + np.logaddexp(0, z) * (1 - y)   # noqa: E731
l2, l3 = [], []
for Y in (2022, 2023):
    tr, te = ok & (yr >= 2021) & (yr < Y), ok & (yr == Y)
    l2.append(lz(Z2[te] @ fit_lr(Z2[tr], y1[tr]), y1[te]))
    l3.append(lz(Z3[te] @ fit_lr(Z3[tr], y1[tr]), y1[te]))
l2, l3 = np.concatenate(l2), np.concatenate(l3)
R["winner_gate_props_pA"] = {"n": len(l2), "close+ml2": round(float(l2.mean()), 5), "+props_pA": round(float(l3.mean()), 5),
                             "diff": round(float(l3.mean() - l2.mean()), 5), "rule": "enters only if diff < -0.0005"}

# ============================================================ 5. round given a finish: S2 vs 'fight ends in round k'
def er_cons(mu, K):
    V = []
    for r in by_mu[mu]:
        q = [q_of(r["er%d" % k]) for k in range(1, K + 1)] + [q_of(r["godec"])]
        if any(x is None for x in q) or not (0.97 <= sum(q) <= 1.8):
            continue
        V.append(devig(q, "power"))
    return np.mean(V, 0) if V else None


rl = defaultdict(list)
K_of = {f["id"]: f["rounds"] for f in fights}
rnd_of = {f["id"]: f["result"]["round"] - 1 for f in fights}
for k, r in enumerate(recs):
    if r["year"] not in (2022, 2023) or meth[k] not in (0, 1) or not r["mu"]:
        continue
    K = K_of[r["id"]]
    e = er_cons(r["mu"], K)
    if e is None:
        continue
    Jc = C["J"]["S2+ml2win"][pos[r["id"]]]
    fin = np.array([Jc[j] + Jc[5 + j] + Jc[10 + j] + Jc[15 + j] for j in range(5)])[:K]
    fin, pe, rr = fin / fin.sum(), e[:K] / e[:K].sum(), rnd_of[r["id"]]
    rl["S2"].append(-np.log(fin[rr]))
    rl["props er"].append(-np.log(pe[rr]))
    rl["0.75 S2 + 0.25 props"].append(-np.log(0.75 * fin[rr] + 0.25 * pe[rr]))
R["round_given_finish_cv_2022_2023"] = {"n": len(rl["S2"]), **{k: round(float(np.mean(v)), 5) for k, v in rl.items()}}

# ============================================================ 6. debut bouts: debut METHOD model + own props
Dd = pickle.load(open(os.path.join(ROOT, "out/props_cache/debut.pkl"), "rb"))
nd = len(Dd["fid"])
Mpd, hasD = np.full((nd, 2, 3), np.nan), np.zeros(nd, bool)
for i, fid in enumerate(Dd["fid"]):
    f = fw[fid]
    assert f["date"] < VAULT
    mu, sw = match(mus_by_date, by_mu, f["date"], f["A"].replace("-", " "), f["B"].replace("-", " "))
    if not mu:
        continue
    t1, t2 = (2, 1) if sw else (1, 2)
    V = [p for p in (book_m6(r, t1, t2, "power") for r in by_mu[mu]) if p is not None]
    if V:
        v = consensus(V)
        Mpd[i] = np.stack([v[:3] / v[:3].sum(), v[3:] / v[3:].sum()])
        hasD[i] = True
dyr, dside, dmeth, dev_, Md = Dd["year"], Dd["side"], Dd["meth"], Dd["event"], Dd["Md"]


def dlog(a, i):
    s = a[0] * np.log(np.clip(Md[i], 1e-6, 1)) + a[1] * np.log(np.clip(Mpd[i], 1e-6, 1))
    e = np.exp(s - s.max(-1, keepdims=True))
    return e / e.sum(-1, keepdims=True)


def dmgw(M, i):
    return -np.log(np.clip(M[np.arange(len(i)), dside[i], dmeth[i]], 1e-12, 1))


R["debut"] = {"bouts": nd, "with_own_props": int(hasD.sum()), "with_builder_props": int(Dd["hasM"].sum()),
              "own_only": int((hasD & ~Dd["hasM"]).sum()), "builder_only": int((~hasD & Dd["hasM"]).sum())}
for label, folds in (("cv_2022_2023", [((dyr >= 2021) & (dyr < Y), dyr == Y) for Y in (2022, 2023)]),
                     ("rescore_2024_2025", [((dyr >= 2021) & (dyr <= 2023), dyr >= 2024)])):
    LP, LD, LO, EV = [], [], [], []
    for tr, te in folds:
        tri, tei = np.flatnonzero(tr & hasD), np.flatnonzero(te & hasD)
        a = minimize(lambda a: dmgw(dlog(a, tri), tri).mean(), [0.5, 0.5], method="L-BFGS-B", bounds=[(0, 5)] * 2).x
        LP.append(dmgw(dlog(a, tei), tei))
        LD.append(dmgw(Md[tei], tei))
        LO.append(dmgw(Mpd[tei], tei))
        EV.append(dev_[tei])
    LP, LD, LO, EV = map(np.concatenate, (LP, LD, LO, EV))
    R["debut"][label] = {"n": len(LP), "pool": round(float(LP.mean()), 5), "debut_alone": round(float(LD.mean()), 5),
                         "props_alone": round(float(LO.mean()), 5), "pool - debut": boot_diff(LP, LD, EV),
                         "pool - props": boot_diff(LP, LO, EV)}

R["meta"] = {"tool": "tools/props_verify.py", "built": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
             "format": "paired entries are [mean difference, CI 2.5%, CI 97.5%], event-cluster bootstrap 2,000 resamples"}
json.dump(R, open(OUT, "w"), indent=1, default=float)
print("wrote", OUT)
