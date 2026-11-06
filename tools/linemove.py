#!/usr/bin/env python3
"""Line timing and movement (task key: linemove): per-bout betting-line trajectories, what the model knows before the
market moves, stacks matched to the capture time of the forward ledger, and movement beyond the close.

Run from the project root (stages cache into out/linemove_cache/, so each can be re-run alone):

    nice -n 5 python3 tools/linemove.py build    # trajectories 2012-2025 (every 2026+ row dropped at parse)
    nice -n 5 python3 tools/linemove.py timing   # matchup creation dates, open lead, sampling test, volatility profile
    nice -n 5 python3 tools/linemove.py q1       # how much of the move is predictable; closing-line value of model bets
    nice -n 5 python3 tools/linemove.py stacks   # snapshot stacks, cross-feeding costs, synthetic T-k lines (CV <= 2023)
    nice -n 5 python3 tools/linemove.py beyond   # movement / dispersion beyond the close (winner, method)
    nice -n 5 python3 tools/linemove.py valid    # the CV-chosen configurations scored ONCE on 2024-01-01..2025-12-31
    nice -n 5 python3 tools/linemove.py export   # data/derived/linemove.json
    nice -n 5 python3 tools/linemove.py vault    # 2026 trajectories -> the auditors' vault dir (no outcome is read)
    nice -n 5 python3 tools/linemove.py all      # build .. export

Data. BestFightOdds (BFO) fighter pages carry, for every bout and each side, a 10-point "sparkline" of BFO's mean odds
(the data-sparkline attribute already parsed into data/raw/odds/bfo_fighter_lines.csv by tools/market.py): point 0
is the opening line (one book's first price; it equals the parsed opener in every bout), point 9 is the mean of the
books' closing odds, points 1-8 are the mean odds in between. The page gives no timestamps. BFO's per-book
line-history endpoint is obfuscated and was NOT used (a request to it was refused as circumvention); the Wayback
Machine and Common Crawl are not reachable from this box. The `timing` stage therefore estimates when each matchup
opened from BFO's sequential matchup ids (anchored on Wikipedia short-notice replacements, data/derived/fightweek.json)
and tests whether the sparkline is sampled uniformly in time.

Protocol (docs/BACKLOG.md): rows dated 2026-01-01 or later are dropped while the CSVs are parsed (the `vault` command
alone reads them, writes them to the vault directory outside the repo, and never reads an outcome). Every choice is
made by time-ordered / forward-chained CV on fights before 2024-01-01 (stack gate: forward-chained 2021-2023, fit on
2019..Y-1, the 0.0005 rule of tools/ml2.py); 2024-01-01..2025-12-31 is scored once by `valid`. Stacks are tools/ml2.py's
stack_fit (non-negative logit weights, no intercept); scoring is symmetric; the corner-swap check is asserted.
Intervals: 2,000 event-cluster bootstrap resamples (cards), paired for differences (tools/ml2.py compare()).

De-vig conventions (research/model_market.md): power de-vig of mean decimal odds for close-trained stacks and for
every BFO-mean snapshot (points 1-9); multiplicative for the single-book opener (point 0), as the open-trained stacks.
"""
import os

for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "1")
import argparse
import csv
import datetime as dt
import json
import math
import pickle
import re
import sys
import time
from collections import Counter, defaultdict

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.dirname(HERE)
DERIVED = os.path.join(ROOT, "data", "derived")
ODDS = os.path.join(ROOT, "data", "raw", "odds")
CACHE = os.path.join(ROOT, "out", "linemove_cache")
ML2_CACHE = os.path.join(ROOT, "out", "ml2_cache")
OUT_JSON = os.path.join(DERIVED, "linemove.json")
VAULT_DIR = os.environ.get("LINEMOVE_VAULT", "/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/"
                                              "scratchpad/vault")
VAULT_S = "2026-01-01"
VAULT = dt.date(2026, 1, 1)
os.makedirs(CACHE, exist_ok=True)

import market as MK  # noqa: E402  (parsers, de-vig, matching; read-only use)
import ml2  # noqa: E402  (stack_fit, rec_w, logit, sig, ll, ll_vec, compare, boot, metrics, SEL_MIN)

STAGES = {}
NPTS = 10                  # sparkline points: 0 = opener (one book), 1..8 = BFO mean in between, 9 = mean close
SEL_MIN = ml2.SEL_MIN      # 0.0005: a variant must beat the simpler one by more than this in CV
CV_YEARS = (2021, 2022, 2023)
PCLIP = 0.01


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def wjson(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(obj, fh, indent=1, default=lambda o: float(o) if isinstance(o, np.floating) else int(o)
                  if isinstance(o, np.integer) else str(o))
    os.replace(tmp, path)


def lg(p):
    p = np.clip(np.asarray(p, float), 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


def sg(z):
    return 1.0 / (1.0 + np.exp(-np.asarray(z, float)))


def devig_pair(dA, dB, method):
    if not dA or not dB or dA <= 1 or dB <= 1:
        return None
    return MK.devig(dA, dB, method)


# ====================================================================== parse (2026 rows dropped here)
def _int(x):
    try:
        return int(x)
    except (TypeError, ValueError):
        return None


def load_bfo_matchups_dev():
    """tools/market.py load_bfo_matchups(), with every CSV row dated 2026-01-01 or later skipped while parsing
    (exchange rows on 2026 pages encode results). Undated rows (BFO's Future Events pages) are kept; they can only be
    matched to fights before 2026."""
    mus = {}
    n_drop = Counter()
    for r in MK.read_csv(os.path.join(ODDS, "bfo_event_lines.csv")):
        if r["date"] and r["date"] >= VAULT_S:
            n_drop["event_lines"] += 1
            continue
        mu = int(r["mu"])
        m = mus.setdefault(mu, {"mu": mu, "date": r["date"], "n1": r["t1_name"], "n2": r["t2_name"],
                                "t1_url": r["t1_url"], "t2_url": r["t2_url"], "event": r["event_slug"],
                                "books": {}, "pages": []})
        a1, a2 = _int(r["a1"]), _int(r["a2"])
        if r["book"] and a1 and a2:
            m["books"][r["book"]] = (a1, a2)
    for r in MK.read_csv(os.path.join(ODDS, "bfo_fighter_lines.csv")):
        if r["date"] and r["date"] >= VAULT_S:
            n_drop["fighter_lines"] += 1
            continue
        mu, t = _int(r["mu"]), _int(r["owner_team"])
        if mu is None or t not in (1, 2):
            continue
        m = mus.get(mu)
        ev_slug = (r["event_url"] or "").replace("/events/", "")
        undated = (not r["date"]) or bool(re.match(r"(future-events|potential-fights|unconfirmed)", ev_slug))
        if m is None:
            own, opp = (r["owner_name"], r["opp_name"])
            m = mus[mu] = {"mu": mu, "date": r["date"], "n1": own if t == 1 else opp, "n2": opp if t == 1 else own,
                           "t1_url": r["owner_url"] if t == 1 else r["opp_url"],
                           "t2_url": r["opp_url"] if t == 1 else r["owner_url"],
                           "event": ev_slug, "books": {}, "pages": [], "undated": undated}
            if undated:
                m["date"] = None
        o = {"open": (_int(r["open1"]), _int(r["open2"])), "lo": (_int(r["lo1"]), _int(r["lo2"])),
             "hi": (_int(r["hi1"]), _int(r["hi2"]))}
        if t == 2:
            o = {k: (v[1], v[0]) for k, v in o.items()}
        m["pages"].append(o)
        if r["spark"]:
            m["spark%d" % t] = [float(x) for x in r["spark"].split(";") if x]
    return mus, dict(n_drop)


def fighter_names():
    nm = {}
    for r in csv.DictReader(open(os.path.join(ROOT, "data", "raw", "ufc_fighter_details.csv"))):
        nm[r["URL"].rstrip("/").split("/")[-1]] = (r["FIRST"] + " " + r["LAST"]).strip()
    return nm


def load_ml2_table():
    S = pickle.load(open(os.path.join(ML2_CACHE, "table.pkl"), "rb"))
    T = S["df"]
    assert T["date"].max() < VAULT, "ml2 table holds 2026 rows"
    F = pickle.load(open(os.path.join(ML2_CACHE, "fit.pkl"), "rb"))
    assert list(F["fid"]) == list(T["fid"]), "fit.pkl rows are not aligned with table.pkl"
    return T, F


# ====================================================================== stage: build
def stage_build(a):
    T, F = load_ml2_table()
    T = T.reset_index(drop=True)
    nm = fighter_names()
    keep = (T["date"] >= dt.date(2012, 1, 1)).to_numpy()
    fights = [{"id": r.fid, "date": str(r.date), "A": {"name": nm.get(r.a, r.a)}, "B": {"name": nm.get(r.b, r.b)}}
              for r in T[keep].itertuples()]
    mus, n_drop = load_bfo_matchups_dev()
    log("BFO matchups (dev rows only): %d; rows dropped at parse (dated >= %s): %s" % (len(mus), VAULT_S, n_drop))
    MK.load_bfo_matchups = lambda: mus      # assemble() matches against the filtered matchups only
    recs, diag = MK.assemble(fights)
    log("matching: %s" % diag)
    mk = json.load(open(os.path.join(DERIVED, "market.json")))["fights"]
    z_oof = F["preds"]["lr|oof"]
    z_st = F["preds"]["lr|static"]
    z_ro = F["preds"]["lr|roll"]
    b_oof = F["preds"]["blend|oof"]
    b_st = F["preds"]["blend|static"]
    b_ro = F["preds"]["blend|roll"]
    rows = []
    stats = Counter()
    for k in np.flatnonzero(keep):
        r = T.iloc[k]
        fid = r.fid
        rec = recs.get(fid, {})
        yr = int(r.year)
        ml2lr = z_st[k] if yr >= 2024 else z_oof[k]
        ml2b = b_st[k] if yr >= 2024 else b_oof[k]
        row = {"fid": fid, "date": str(r.date), "year": yr, "event": r.event, "y": float(r.y), "nA": int(r.nA),
               "nB": int(r.nB), "evalrow": bool(r.evalrow), "five": int(r.five), "lbs": float(r.lbs),
               "women": int(r.women), "method": r.method, "rnd": int(r.rnd) if r.rnd == r.rnd else None,
               "ml2lr": float(ml2lr) if ml2lr == ml2lr else None, "ml2": float(ml2b) if ml2b == ml2b else None,
               "ml2lr_roll": float(z_ro[k]) if yr >= 2024 and z_ro[k] == z_ro[k] else None,
               "ml2_roll": float(b_ro[k]) if yr >= 2024 and b_ro[k] == b_ro[k] else None,
               "mr": float(r.mr_p) if r.mr_p == r.mr_p else None,
               "whr": float(r.r_whr_rounds) if r.r_whr_rounds == r.r_whr_rounds else None}
        mu = rec.get("bfo_mu")
        row["mu"] = mu
        if mu is not None:
            m = mus[mu]
            sw = rec["bfo_swap"]
            s1, s2 = m.get("spark1"), m.get("spark2")
            sA, sB = (s2, s1) if sw else (s1, s2)
            row["bfo_date"] = m.get("date")
            row["n_spark"] = [len(sA) if sA else 0, len(sB) if sB else 0]
            if sA and sB and len(sA) == len(sB) == NPTS:
                stats["spark10"] += 1
                pm = [devig_pair(x, y_, "mult") for x, y_ in zip(sA, sB)]
                pp = [devig_pair(x, y_, "power") for x, y_ in zip(sA, sB)]
                row["snap_mult"] = pm
                row["snap_pow"] = pp
                row["snap_ovr"] = [1 / x + 1 / y_ for x, y_ in zip(sA, sB)]
                o = rec.get("bfo_open")
                if o and o[0]:
                    row["open_check"] = abs(sA[0] - MK.am_to_dec(o[0]))
            rng = rec.get("bfo_range")
            if rng and all(v is not None for t in rng for v in t):
                row["range_spread"] = MK.range_spread(rng)
                (loA, loB), (hiA, hiB) = rng
                row["range"] = [[loA, hiA], [loB, hiB]]
            bk = rec.get("bfo_books") or {}
            pb = {}
            for name, (x, y_) in bk.items():
                if name in MK.EXCHANGES or not x or not y_:
                    continue
                dA, dB = MK.am_to_dec(x), MK.am_to_dec(y_)
                if dA and dB and 0.98 <= 1 / dA + 1 / dB <= 1.25:
                    pb[name] = MK.devig(dA, dB, "mult")
            if pb:
                med = float(np.median(list(pb.values())))
                pb = {kk: v for kk, v in pb.items() if abs(v - med) <= 0.15}
                row["books_p"] = {kk: round(v, 5) for kk, v in sorted(pb.items())}
        mrow = mk.get(fid)
        if mrow:
            row["close_pow"] = mrow.get("p_power_close")
            row["close_mult"] = mrow.get("p_novig_close")
            row["open_mult"] = mrow.get("p_novig_open")
            row["close_src"] = mrow.get("src")
            row["mkt_rating"] = mrow.get("p_market_rating")
        rows.append(row)
    D = pd.DataFrame(rows)
    # consistency checks against market.json (dev fights): sparkline end point vs the consensus close
    chk = {}
    m = D["snap_pow"].notna() & D["close_pow"].notna()
    if m.any():
        s9 = np.array([v[9] for v in D.loc[m, "snap_pow"]])
        cl = D.loc[m, "close_pow"].to_numpy(float)
        s0 = np.array([v[0] for v in D.loc[m, "snap_mult"]])
        op = D.loc[m, "open_mult"].to_numpy(float)
        okop = ~np.isnan(op)
        chk = {"n": int(m.sum()), "mean_abs(spark9_pow - market close_pow)": round(float(np.mean(np.abs(s9 - cl))), 5),
               "share |diff| < 0.01": round(float(np.mean(np.abs(s9 - cl) < 0.01)), 4),
               "share |diff| > 0.05": round(float(np.mean(np.abs(s9 - cl) > 0.05)), 4),
               "mean_abs(spark0_mult - market open_mult)": round(float(np.mean(np.abs(s0[okop] - op[okop]))), 5),
               "share opener identical (< 0.005)": round(float(np.mean(np.abs(s0[okop] - op[okop]) < 0.005)), 4)}
    oc = D["open_check"].dropna()
    chk["spark0 == parsed opener (decimal, |diff| < 0.01)"] = round(float(np.mean(oc < 0.01)), 4) if len(oc) else None
    cov = {}
    for yr, g in D.groupby("year"):
        cov[int(yr)] = {"fights": int(len(g)), "eval_rows": int(g["evalrow"].sum()),
                        "matched": int(g["mu"].notna().sum()), "trajectory": int(g["snap_pow"].notna().sum()),
                        "trajectory_eval_rows": int((g["snap_pow"].notna() & g["evalrow"]).sum()),
                        "per_book": int(g["books_p"].notna().sum()) if "books_p" in g else 0}
    log("coverage by year: %s" % json.dumps(cov))
    log("checks: %s" % chk)
    pickle.dump({"D": D, "diag": diag, "checks": chk, "coverage": cov, "dropped_at_parse": n_drop},
                open(os.path.join(CACHE, "traj.pkl"), "wb"))
    # the matchup-id table for the timing stage (dated dev matchups only)
    ids = sorted((mu, mm["date"]) for mu, mm in mus.items() if mm.get("date") and not mm.get("undated"))
    pickle.dump(ids, open(os.path.join(CACHE, "mu_dates.pkl"), "wb"))


STAGES["build"] = stage_build


def load_traj():
    return pickle.load(open(os.path.join(CACHE, "traj.pkl"), "rb"))


def snaps(D, kind="pow"):
    """n x 10 matrix of P(A) at each sparkline point (NaN where absent); point 0 always multiplicative."""
    out = np.full((len(D), NPTS), np.nan)
    for i, (pm, pp) in enumerate(zip(D["snap_mult"], D["snap_pow"])):
        if isinstance(pp, list):
            v = pp if kind == "pow" else pm
            out[i] = [np.nan if x is None else x for x in v]
            out[i, 0] = pm[0] if pm[0] is not None else np.nan
    return out


# ====================================================================== stage: timing
TAU_EDGES = [0.0, 0.5, 1.0, 2.0, 4.0, 7.0, 14.0, 28.0, 56.0, 1e9]   # days before the close


def creation_model(D, mu_dates):
    """Estimate when BFO created each matchup (= when its first line appeared) from its sequential id.
    Upper bound: a matchup cannot be created after the event of any later-created matchup (suffix minimum of event
    dates over larger ids). Anchors: Wikipedia short-notice replacements (data/derived/fightweek.json short_notice =
    days between the announcement and the event; the bout's matchup exists from about then). An increasing isotonic
    fit of anchor creation date on id, capped by the upper bound. No outcome is used."""
    from sklearn.isotonic import IsotonicRegression
    ids = np.array([m for m, _ in mu_dates], float)
    dord = np.array([dt.date.fromisoformat(d).toordinal() for _, d in mu_dates], float)
    o = np.argsort(ids)
    ids, dord = ids[o], dord[o]
    suf = np.minimum.accumulate(dord[::-1])[::-1]
    fw = json.load(open(os.path.join(DERIVED, "fightweek.json")))["fights"]
    anc = []
    for r in D.itertuples():
        if r.mu != r.mu or r.mu is None:
            continue
        v = fw.get(r.fid)
        if not v:
            continue
        sn = [x for x in (v["short_notice"]["A"], v["short_notice"]["B"]) if isinstance(x, (int, float)) and x >= 0]
        if not sn or min(sn) > 90:
            continue
        E = dt.date.fromisoformat(r.date).toordinal()
        anc.append((float(r.mu), E - min(sn), min(sn), E, r.event))
    A = np.array([x[:4] for x in anc], float)
    ub = lambda mu: np.interp(mu, ids, suf)          # step-like; interp between neighbouring ids is fine at this density
    iso = IsotonicRegression(increasing=True, out_of_bounds="clip").fit(A[:, 0], A[:, 1])

    def est(mu, E):
        c = np.minimum(iso.predict(np.asarray(mu, float)), ub(np.asarray(mu, float)))
        return np.maximum(np.asarray(E, float) - c, 0.0)
    # cross-validated accuracy of the lead estimate on the anchors (5 folds by card)
    ev = np.array([x[4] for x in anc])
    uev = np.unique(ev)
    rng = np.random.default_rng(11)
    fold_of = dict(zip(uev, rng.integers(0, 5, len(uev))))
    f = np.array([fold_of[e] for e in ev])
    pred = np.zeros(len(A))
    for k in range(5):
        tr, te = f != k, f == k
        ik = IsotonicRegression(increasing=True, out_of_bounds="clip").fit(A[tr, 0], A[tr, 1])
        c = np.minimum(ik.predict(A[te, 0]), ub(A[te, 0]))
        pred[te] = np.maximum(A[te, 3] - c, 0)
    lb_only = np.maximum(A[:, 3] - ub(A[:, 0]), 0)
    truth = A[:, 2]
    cvr = {"anchors": int(len(A)), "notice_days_median": float(np.median(truth)),
           "cv_mae_days_isotonic_capped": round(float(np.mean(np.abs(pred - truth))), 2),
           "cv_median_abs_err_days": round(float(np.median(np.abs(pred - truth))), 2),
           "mae_days_upper_bound_only": round(float(np.mean(np.abs(lb_only - truth))), 2),
           "corr_pred_truth": round(float(np.corrcoef(pred, truth)[0, 1]), 3),
           "by_notice": {}}
    for lo, hi in ((0, 8), (8, 15), (15, 29), (29, 91)):
        m = (truth >= lo) & (truth < hi)
        if m.sum():
            cvr["by_notice"]["%d-%d d" % (lo, hi - 1)] = {"n": int(m.sum()), "pred_median": round(float(np.median(pred[m])), 1),
                                                          "truth_median": round(float(np.median(truth[m])), 1)}
    return est, cvr


def step_matrix(L):
    """Overlap (days) of each sparkline step j -> j+1 (j = 1..8) with each tau bin, under time-uniform sampling:
    point j sits at tau_j = (9 - j) / 9 * L days before the close."""
    nb = len(TAU_EDGES) - 1
    out = np.zeros((len(L), 8, nb))
    for j in range(1, 9):
        t_hi = (9 - j) / 9.0 * L
        t_lo = (9 - j - 1) / 9.0 * L
        for b in range(nb):
            lo, hi = TAU_EDGES[b], TAU_EDGES[b + 1]
            out[:, j - 1, b] = np.clip(np.minimum(t_hi, hi) - np.maximum(t_lo, lo), 0, None)
    return out


def fit_var_time(dz2, X, w=None):
    """Gaussian ML fit of piecewise-constant variance rates s_b (per day) with dz ~ N(0, X @ s + v0): v0 is a
    per-step floor (book churn / rounding), s_b >= 0."""
    from scipy.optimize import minimize
    nb = X.shape[-1]
    Xf = X.reshape(-1, nb)
    d2 = dz2.reshape(-1)
    w = np.ones_like(d2) if w is None else w.reshape(-1)

    def f(th):
        s = np.exp(th[:nb])
        v0 = np.exp(th[nb])
        v = Xf @ s + v0
        return 0.5 * np.sum(w * (np.log(v) + d2 / v))
    th0 = np.r_[np.full(nb, np.log(1e-3)), np.log(1e-4)]
    r = minimize(f, th0, method="L-BFGS-B")
    return np.exp(r.x[:nb]), float(np.exp(r.x[nb])), float(r.fun)


def var_ll(dz2, v):
    return float(np.mean(-0.5 * (np.log(2 * np.pi * v) + dz2 / v)))


def stage_timing(a):
    S = load_traj()
    D = S["D"]
    mu_dates = pickle.load(open(os.path.join(CACHE, "mu_dates.pkl"), "rb"))
    est, cvr = creation_model(D, mu_dates)
    log("lead estimator (anchors, 5-fold by card): %s" % cvr)
    E = np.array([dt.date.fromisoformat(d).toordinal() for d in D["date"]], float)
    mu = D["mu"].to_numpy(float)
    L = np.full(len(D), np.nan)
    ok = ~np.isnan(mu)
    L[ok] = est(mu[ok], E[ok])
    D["lead_days"] = L
    P = snaps(D, "pow")
    Z = lg(P)
    yr = D["year"].to_numpy()
    use = (~np.isnan(Z).any(1)) & (L > 0.5) & D["evalrow"].to_numpy(bool)
    dz2 = np.diff(Z[:, 1:], axis=1) ** 2          # steps 1->2 .. 8->9
    X = step_matrix(np.where(use, L, 1.0))
    # sampling test: time-uniform variance model vs index-only (8 free step variances), forward-chained by year
    res = {"bins_days": TAU_EDGES, "years": {}}
    tot = {"time": [], "index": [], "n": 0}
    for Y in range(2016, 2024):
        tr = use & (yr < Y) & (yr >= 2012)
        te = use & (yr == Y)
        if tr.sum() < 100 or te.sum() < 30:
            continue
        s, v0, _ = fit_var_time(dz2[tr], X[tr])
        vt = X[te] @ s + v0
        ci = dz2[tr].mean(0)
        vi = np.broadcast_to(ci, dz2[te].shape)
        lt, li = var_ll(dz2[te], vt), var_ll(dz2[te], vi)
        res["years"][int(Y)] = {"n": int(te.sum()), "ll_time": round(lt, 4), "ll_index": round(li, 4)}
        tot["time"].append(lt * te.sum())
        tot["index"].append(li * te.sum())
        tot["n"] += int(te.sum())
    res["forward_chained_mean_ll"] = {"time_uniform": round(sum(tot["time"]) / tot["n"], 4),
                                      "index_only": round(sum(tot["index"]) / tot["n"], 4), "n": tot["n"]}
    log("sampling test (Gaussian ll per step, higher is better): %s" % res["forward_chained_mean_ll"])
    # the volatility profile used downstream: fit on every pre-2024 row
    fit = use & (yr < 2024)
    s, v0, _ = fit_var_time(dz2[fit], X[fit])
    res["profile_fit"] = {"rows": int(fit.sum()), "rate_per_day_by_bin": [round(float(x), 6) for x in s],
                          "step_floor_var": round(v0, 6)}
    # cumulative information I(tau): variance of the logit move from tau days out to the close
    res["I_days"] = {str(t): round(float(info(t, s)), 5) for t in (0.25, 0.5, 1, 2, 3, 4, 7, 14, 28, 56)}
    # where each sparkline point sits (median over evaluation rows with a trajectory) and the share of the
    # point-1 -> close variance still to come
    tau = np.array([[(9 - j) / 9.0 * l for j in range(NPTS)] for l in np.where(use, L, np.nan)])
    I1 = np.array([info(t, s) for t in tau[use, 1]])
    res["snap_tau_days_median"] = [round(float(np.nanmedian(tau[use, j])), 2) for j in range(NPTS)]
    res["lead_days_quantiles"] = {q: round(float(np.nanpercentile(L[use], q)), 1) for q in (10, 25, 50, 75, 90)}
    res["share_of_move_variance_in_last_24h_median"] = round(float(np.median(info(1.0, s) / I1)), 3)
    res["share_of_move_variance_in_last_72h_median"] = round(float(np.median(info(3.0, s) / I1)), 3)
    # observed check of the profile: empirical var of (close - point j) vs model I(tau_j) + floor
    emp = {}
    for j in (1, 4, 6, 7, 8):
        m = fit
        d = (Z[m, 9] - Z[m, j]) ** 2
        mod = np.array([info(t, s) for t in tau[m, j]]) + v0 * (9 - j)
        emp[j] = {"emp_mean_sq": round(float(d.mean()), 5), "model": round(float(mod.mean()), 5)}
    res["check_close_minus_point"] = emp
    log("profile: %s" % res["profile_fit"])
    log("I(tau): %s; snapshot tau median %s; lead q %s; last-24h share %s, 72h %s" % (
        res["I_days"], res["snap_tau_days_median"], res["lead_days_quantiles"],
        res["share_of_move_variance_in_last_24h_median"], res["share_of_move_variance_in_last_72h_median"]))
    log("check: %s" % emp)
    res["lead_estimator"] = cvr
    pickle.dump({"lead_days": L, "s": s, "v0": v0, "res": res}, open(os.path.join(CACHE, "timing.pkl"), "wb"))


def info(tau, s):
    """I(tau) = integral_0^tau sigma^2(u) du with piecewise-constant rates s on TAU_EDGES."""
    tot = 0.0
    for b in range(len(TAU_EDGES) - 1):
        lo, hi = TAU_EDGES[b], TAU_EDGES[b + 1]
        if tau <= lo:
            break
        tot += s[b] * (min(tau, hi) - lo)
    return tot


STAGES["timing"] = stage_timing


# ====================================================================== shared: the stack table (dev evaluation rows)
def stack_table():
    """tools/ml2.py's expert table (out/ml2_cache/stack.pkl: 2,809 decisive dev evaluation fights 2019-2025, ML v2
    logistic OOF for 2019-2023 and static/rolling for 2024-2025) joined to the trajectories on the fight id."""
    S = pickle.load(open(os.path.join(ML2_CACHE, "stack.pkl"), "rb"))
    E = S["D"].copy().reset_index(drop=True)
    assert (pd.to_datetime(E["date"]) < pd.Timestamp(VAULT_S)).all()
    tr = load_traj()["D"].set_index("fid")
    tm = pickle.load(open(os.path.join(CACHE, "timing.pkl"), "rb"))
    lead = pd.Series(tm["lead_days"], index=load_traj()["D"]["fid"])
    P = np.full((len(E), NPTS), np.nan)
    for i, f in enumerate(E["fid"]):
        if f in tr.index:
            pp, pm = tr.at[f, "snap_pow"], tr.at[f, "snap_mult"]
            if isinstance(pp, list):
                P[i] = [np.nan if x is None else x for x in pp]
                P[i, 0] = pm[0]
    E["lead_days"] = [lead.get(f, np.nan) for f in E["fid"]]
    for c in ("range_spread", "books_p", "mu"):
        E[c] = [tr.at[f, c] if (f in tr.index and c in tr.columns) else None for f in E["fid"]]
    E["full"] = ~np.isnan(P).any(1) & E["market"].notna().to_numpy() & E["open"].notna().to_numpy()
    return E, P, tm


def zcol(p):
    return np.nan_to_num(ml2.logit(np.clip(np.asarray(p, float), PCLIP, 1 - PCLIP), 1e-6))


def fit_w(Z, y, yrs, until, h):
    return ml2.stack_fit(Z, y, ml2.rec_w(yrs, until + 1, h))


def cv_stack(Z, y, yrs, rows, h_grid=(None, 3.0, 1.5), Zfeed=None):
    """Forward-chained CV 2021-2023 (fit on 2019..Y-1 rows, predict Y) for each half-life; returns
    (cv by h, chosen h with the 0.0005 preference for no recency weighting, OOF predictions for the chosen h).
    Zfeed: an alternative design used only at prediction time (cross-feeding)."""
    Zf = Z if Zfeed is None else Zfeed
    out, oof = {}, {}
    for h in h_grid:
        tot = nn = 0.0
        pr = np.full(len(y), np.nan)
        for Y in CV_YEARS:
            tr = rows & (yrs >= 2019) & (yrs <= Y - 1)
            te = rows & (yrs == Y)
            b = fit_w(Z[tr], y[tr], yrs[tr], Y - 1, h)
            pr[te] = sg(Zf[te] @ b)
            tot += ml2.ll(pr[te], y[te]) * te.sum()
            nn += te.sum()
        out[str(h)] = round(tot / nn, 5)
        oof[str(h)] = pr
    hb = min(out, key=lambda k: out[k] + (0 if k == "None" else SEL_MIN))
    return out, (None if hb == "None" else float(hb)), oof[hb]


def cv_fixed_h(Z, y, yrs, rows, h, Zfeed=None):
    r, _, pr = cv_stack(Z, y, yrs, rows, (h,), Zfeed)
    return r[str(h)], pr


def cv_groups(E):
    return E["event"].to_numpy()


# ====================================================================== stage: stacks
def bridge_line(Z, tau, s, v0, target, rng, draws=1):
    """Synthetic line at `target` days before the close for each row: the Gaussian-martingale (Brownian-bridge)
    interpolation between the two sparkline points that bracket it in time, in information time I(tau) from the
    fitted volatility profile, plus the bridge noise sqrt(w (1 - w) (I_a - I_b)). NaN when the line did not exist yet
    (target earlier than the opener). Returns draws x n."""
    n = len(Z)
    out = np.full((draws, n), np.nan)
    Ia = np.array([[info(t, s) for t in row] for row in tau])   # n x 10
    for i in range(n):
        if np.isnan(tau[i]).any() or np.isnan(Z[i]).any():
            continue
        if tau[i, 0] < target:          # not posted yet
            continue
        js = [j for j in range(NPTS) if tau[i, j] >= target]
        a_ = max(js)
        if a_ == NPTS - 1:
            out[:, i] = Z[i, a_]
            continue
        b_ = a_ + 1
        ia, ib, it = Ia[i, a_] + v0 * (NPTS - 1 - a_), Ia[i, b_] + v0 * (NPTS - 1 - b_), info(target, s)
        it = it + v0 * max(0.0, (target - tau[i, b_]) / max(tau[i, a_] - tau[i, b_], 1e-9))
        den = max(ia - ib, 1e-9)
        w = float(np.clip((ia - it) / den, 0, 1))
        sd = math.sqrt(max(w * (1 - w) * den, 0.0))
        out[:, i] = Z[i, a_] + w * (Z[i, b_] - Z[i, a_]) + sd * rng.standard_normal(draws)
    return out


def stage_stacks(a):
    E, P, tm = stack_table()
    y = E["y"].to_numpy(float)
    yrs = E["year"].to_numpy()
    full = E["full"].to_numpy(bool)
    pre = full & (yrs <= 2023)
    cvr = full & np.isin(yrs, CV_YEARS)
    R = {"rows": {"dev_eval_rows": int(len(E)), "full_trajectory": int(full.sum()), "pre2024_full": int(pre.sum()),
                  "cv_years_full": int(cvr.sum())}}
    Zml = zcol(E["ml2lr_static"])
    Zb = zcol(E["ml2_static"])
    Zmr = zcol(E["mkt_rating"])
    ZS = np.column_stack([zcol(P[:, j]) for j in range(NPTS)])
    Zclose = zcol(E["market"])
    # 0. raw lines by snapshot (no stack), pre-2024 and the CV years
    raw = {}
    for j in range(NPTS):
        raw[j] = {"ll_2019_2023": round(ml2.ll(P[pre, j], y[pre]), 5), "ll_cv_years": round(ml2.ll(P[cvr, j], y[cvr]), 5)}
    raw["close_market_json"] = {"ll_2019_2023": round(ml2.ll(E["market"].to_numpy(float)[pre], y[pre]), 5),
                                "ll_cv_years": round(ml2.ll(E["market"].to_numpy(float)[cvr], y[cvr]), 5)}
    raw["ml2lr"] = {"ll_2019_2023": round(ml2.ll(sg(Zml[pre]), y[pre]), 5), "ll_cv_years": round(ml2.ll(sg(Zml[cvr]), y[cvr]), 5)}
    R["raw_lines"] = raw
    log("raw lines LL (2019-2023 | CV years): " + " ".join("%s %.4f|%.4f" % (k, v["ll_2019_2023"], v["ll_cv_years"]) for k, v in raw.items()))
    # 1. per-snapshot stacks: line_j + ML v2 logistic (the page model), +/- market rating, +/- the opener
    per = {}
    chosen = {}
    for j in range(NPTS):
        for name, cols in (("line+ml2lr", [ZS[:, j], Zml]), ("line+ml2lr+mr", [ZS[:, j], Zml, Zmr]),
                           ("line+ml2", [ZS[:, j], Zb]), ("line+open+ml2lr", [ZS[:, j], ZS[:, 0], Zml])):
            if name == "line+open+ml2lr" and j == 0:
                continue
            Z = np.column_stack(cols)
            cv, h, oof = cv_stack(Z, y, yrs, full)
            b = fit_w(Z[pre], y[pre], yrs[pre], 2023, h)
            per["%d|%s" % (j, name)] = {"cv_by_h": cv, "h": h, "cv": cv[str(h)], "weights_fit_le_2023": np.round(b, 4).tolist()}
        base = per["%d|line+ml2lr" % j]
        chosen[j] = {"h": base["h"], "w": base["weights_fit_le_2023"]}
        log("snap %d: line+ml2lr CV %.5f (h %s) w %s | +mr %.5f | ml2 blend %.5f | +open %s" % (
            j, base["cv"], base["h"], base["weights_fit_le_2023"], per["%d|line+ml2lr+mr" % j]["cv"],
            per["%d|line+ml2" % j]["cv"], per.get("%d|line+open+ml2lr" % j, {}).get("cv")))
    R["per_snapshot"] = per
    # the close itself (market.json power close) as a check against ml2's 'page: market+ml2lr' (CV 0.61624 on its rows)
    Zc = np.column_stack([Zclose, Zml])
    cvc, hc, oofc = cv_stack(Zc, y, yrs, full)
    R["close_stack"] = {"cv_by_h": cvc, "h": hc}
    log("close (market.json) + ml2lr on full-trajectory rows: %s" % cvc)
    # 2. cross-feeding: stack trained on snapshot i (its chosen h), fed snapshot j at prediction (CV years)
    XF = np.full((NPTS, NPTS), np.nan)
    oof_ij = {}
    for i in range(NPTS):
        Zi = np.column_stack([ZS[:, i], Zml])
        for j in range(NPTS):
            Zj = np.column_stack([ZS[:, j], Zml])
            v, pr = cv_fixed_h(Zi, y, yrs, full, chosen[i]["h"], Zfeed=Zj)
            XF[i, j] = v
            oof_ij[(i, j)] = pr
    R["cross_feed_cv"] = {"rows_trained_on_snapshot_i_cols_fed_snapshot_j": np.round(XF, 5).tolist()}
    log("cross-feed CV LL (row = trained on i, col = fed j):\n" + "\n".join(
        "  %d: " % i + " ".join("%.4f" % v for v in XF[i]) for i in range(NPTS)))
    # paired CIs for the key cross-feeds (CV years): fed j = 8 and fed the close (9)
    g = cv_groups(E)
    pairs = {}
    for fedj in (4, 6, 7, 8, 9):
        m = cvr
        for i in (0, 4, 6, 7, 8, 9):
            if i == fedj:
                continue
            pairs["trained %d vs trained %d, fed %d" % (i, fedj, fedj)] = ml2.compare(
                oof_ij[(i, fedj)][m], oof_ij[(fedj, fedj)][m], y[m], g[m], a.boot)
    R["cross_feed_paired"] = pairs
    for k, v in pairs.items():
        log("  %-36s %+.5f %s" % (k, v["diff"], v["diff_ci"]))
    pickle.dump({"R": R, "oof_ij": oof_ij, "chosen": chosen}, open(os.path.join(CACHE, "stacks_part1.pkl"), "wb"))
    # 3. maturity-adaptive "any-time" stack: rows stacked over snapshots 1..9; logit = (a0 + a1 m) Z_line +
    #    (b0 + b1 m) Z_ml with m = (9 - j) / 9 (sparkline position; no timing needed); no intercept (symmetric)
    def anytime_design(js, m_of):
        rows, Zs, ys, ws, yy, jj = [], [], [], [], [], []
        for j in js:
            m = m_of(j)
            Zs.append(np.column_stack([ZS[:, j], m * ZS[:, j], Zml, m * Zml]))
            ys.append(y)
            yy.append(yrs)
            jj.append(np.full(len(y), j))
        return np.vstack(Zs), np.concatenate(ys), np.concatenate(yy), np.concatenate(jj)
    from scipy.optimize import minimize

    def lr_fit(Z, yv, wv):
        wv = wv / wv.sum()

        def f(b):
            q = Z @ b
            return np.sum(wv * (np.logaddexp(0, q) - yv * q)) + 1e-4 * b @ b, Z.T @ (wv * (sg(q) - yv)) + 2e-4 * b
        return minimize(f, np.zeros(Z.shape[1]), jac=True, method="L-BFGS-B").x
    js = list(range(1, NPTS))
    Za, ya, yra, ja = anytime_design(js, lambda j: (9 - j) / 9.0)
    fulla = np.tile(full, len(js))
    any_cv = {}
    for j in js:
        tot = nn = 0.0
        for Y in CV_YEARS:
            tr = fulla & (yra >= 2019) & (yra <= Y - 1)
            te = full & (yrs == Y)
            b = lr_fit(Za[tr], ya[tr], np.ones(tr.sum()))
            Zj = np.column_stack([ZS[:, j], (9 - j) / 9.0 * ZS[:, j], Zml, (9 - j) / 9.0 * Zml])
            pr = sg(Zj[te] @ b)
            tot += ml2.ll(pr, y[te]) * te.sum()
            nn += te.sum()
        any_cv[j] = round(tot / nn, 5)
    ball = lr_fit(Za[fulla & (yra <= 2023)], ya[fulla & (yra <= 2023)], np.ones((fulla & (yra <= 2023)).sum()))
    R["anytime_stack"] = {"cv_by_snapshot": any_cv, "coef_fit_le_2023": np.round(ball, 4).tolist(),
                          "design": "logit = (a0 + a1 m) z_line + (b0 + b1 m) z_ml2lr, m = (9 - j) / 9"}
    log("any-time stack CV by snapshot: %s; coef %s" % (any_cv, np.round(ball, 3)))
    # 4. synthetic T-k lines (Brownian bridge between bracketing points, information time from the timing stage)
    s, v0 = tm["s"], tm["v0"]
    L = E["lead_days"].to_numpy(float)
    tau = np.array([[(9 - j) / 9.0 * l for j in range(NPTS)] for l in L])
    rng = np.random.default_rng(20261106)
    syn = {}
    DRAWS = 8
    # validation of the bridge on a real point: synthesize point 6 from points 4 and 8 only, then compare the stack
    # trained on the synthetic point-6 lines with the stack trained on the real ones, both fed the real point 6
    Zv = ZS.copy()
    tau_v = tau.copy()
    def bridge_between(a_, b_, j, draws):
        o = np.full((draws, len(E)), np.nan)
        for i in range(len(E)):
            if np.isnan(tau[i]).any() or np.isnan(ZS[i]).any():
                continue
            ia = info(tau[i, a_], s) + v0 * (9 - a_)
            ib = info(tau[i, b_], s) + v0 * (9 - b_)
            it = info(tau[i, j], s) + v0 * (9 - j)
            den = max(ia - ib, 1e-9)
            w = float(np.clip((ia - it) / den, 0, 1))
            o[:, i] = ZS[i, a_] + w * (ZS[i, b_] - ZS[i, a_]) + math.sqrt(w * (1 - w) * den) * rng.standard_normal(draws)
        return o
    val = {}
    for (a_, b_, j) in ((4, 8, 6), (6, 9, 8), (5, 9, 7)):
        o = bridge_between(a_, b_, j, DRAWS)
        okr = full & ~np.isnan(o[0])
        Zst = np.vstack([np.column_stack([o[d], Zml]) for d in range(DRAWS)])
        yst, yrst, okst = np.tile(y, DRAWS), np.tile(yrs, DRAWS), np.tile(okr, DRAWS)
        Zreal = np.column_stack([ZS[:, j], Zml])
        tot_s = tot_r = nn = 0.0
        prs = np.full(len(y), np.nan)
        prr = np.full(len(y), np.nan)
        for Y in CV_YEARS:
            tr = okst & (yrst >= 2019) & (yrst <= Y - 1)
            te = okr & (yrs == Y)
            bs = fit_w(Zst[tr], yst[tr], yrst[tr], Y - 1, chosen[j]["h"])
            trr = okr & (yrs >= 2019) & (yrs <= Y - 1)
            br = fit_w(Zreal[trr], y[trr], yrs[trr], Y - 1, chosen[j]["h"])
            prs[te] = sg(Zreal[te] @ bs)
            prr[te] = sg(Zreal[te] @ br)
        m = okr & np.isin(yrs, CV_YEARS)
        bs_all = fit_w(Zst[okst & (yrst <= 2023)], yst[okst & (yrst <= 2023)], yrst[okst & (yrst <= 2023)], 2023, chosen[j]["h"])
        val["point %d from %d and %d" % (j, a_, b_)] = {
            "weights_synthetic": np.round(bs_all, 4).tolist(), "weights_real": chosen[j]["w"],
            "var(real - point a)": round(float(np.var(ZS[okr, j] - ZS[okr, a_])), 5),
            "var(synthetic - point a)": round(float(np.var(o[0][okr] - ZS[okr, a_])), 5),
            "corr(real, synthetic) of (z - z_a)": round(float(np.corrcoef(ZS[okr, j] - ZS[okr, a_], o[0][okr] - ZS[okr, a_])[0, 1]), 3),
            "fed real point: synthetic-trained vs real-trained": ml2.compare(prs[m], prr[m], y[m], g[m], a.boot)}
        log("bridge check %s: %s" % ("point %d from %d and %d" % (j, a_, b_), val["point %d from %d and %d" % (j, a_, b_)]))
    R["bridge_validation"] = val
    for k_days, label in ((0.25, "T-6h"), (1.0, "T-24h"), (3.0, "T-72h"), (7.0, "T-7d")):
        o = bridge_line(ZS, tau, s, v0, k_days, rng, DRAWS)
        okr = full & ~np.isnan(o[0])
        Zst = np.vstack([np.column_stack([o[d], Zml]) for d in range(DRAWS)])
        yst, yrst, okst = np.tile(y, DRAWS), np.tile(yrs, DRAWS), np.tile(okr, DRAWS)
        cvh = {}
        for h in (None, 3.0, 1.5):
            tot = nn = 0.0
            for Y in CV_YEARS:
                tr = okst & (yrst >= 2019) & (yrst <= Y - 1)
                te = okst & (yrst == Y)
                b = fit_w(Zst[tr], yst[tr], yrst[tr], Y - 1, h)
                pr = sg(Zst[te] @ b)
                tot += ml2.ll(pr, yst[te]) * te.sum()
                nn += te.sum()
            cvh[str(h)] = round(tot / nn, 5)
        hb = min(cvh, key=lambda k: cvh[k] + (0 if k == "None" else SEL_MIN))
        h = None if hb == "None" else float(hb)
        b = fit_w(Zst[okst & (yrst <= 2023)], yst[okst & (yrst <= 2023)], yrst[okst & (yrst <= 2023)], 2023, h)
        # how the snapshot-trained stacks do when fed this synthetic line (CV years, mean over draws)
        fedcv = {}
        for i in (0, 6, 7, 8, 9):
            tot = nn = 0.0
            for Y in CV_YEARS:
                trr = full & (yrs >= 2019) & (yrs <= Y - 1)
                Zi = np.column_stack([ZS[:, i], Zml])
                bi = fit_w(Zi[trr], y[trr], yrs[trr], Y - 1, chosen[i]["h"])
                te = okst & (yrst == Y)
                pr = sg(Zst[te] @ bi)
                tot += ml2.ll(pr, yst[te]) * te.sum()
                nn += te.sum()
            fedcv["trained on snapshot %d" % i] = round(tot / nn, 5)
        raw_ll = round(float(np.mean([ml2.ll(sg(o[d][okr & np.isin(yrs, CV_YEARS)]), y[okr & np.isin(yrs, CV_YEARS)])
                                      for d in range(DRAWS)])), 5)
        syn[label] = {"days": k_days, "rows": int(okr.sum()), "cv_by_h": cvh, "h": h, "weights_fit_le_2023": np.round(b, 4).tolist(),
                      "raw_line_ll_cv_years": raw_ll, "snapshot_stacks_fed_this_line_cv": fedcv}
        log("synthetic %s: rows %d CV %s (h %s) w %s raw %.5f | fed: %s" % (label, okr.sum(), cvh, h, np.round(b, 3), raw_ll, fedcv))
    R["synthetic_tk"] = syn
    p1 = pickle.load(open(os.path.join(CACHE, "stacks_part1.pkl"), "rb"))
    pickle.dump({"R": R, "oof_ij": p1["oof_ij"], "chosen": chosen}, open(os.path.join(CACHE, "stacks.pkl"), "wb"))
    wjson(os.path.join(CACHE, "stacks.json"), R)


STAGES["stacks"] = stage_stacks


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("stage", choices=list(STAGES) + ["all"])
    ap.add_argument("--boot", type=int, default=2000)
    a = ap.parse_args()
    order = [s for s in STAGES if s not in ("vault",)] if a.stage == "all" else [a.stage]
    for s in order:
        log("== stage %s" % s)
        STAGES[s](a)


if __name__ == "__main__":
    main()
