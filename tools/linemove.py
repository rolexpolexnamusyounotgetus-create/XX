#!/usr/bin/env python3
"""Line timing and movement (task key: linemove): per-bout betting-line trajectories, what the model knows before the
market moves, stacks matched to the capture time of the forward ledger, and movement beyond the close.

Run from the project root (stages cache into out/linemove_cache/, so each can be re-run alone):

    nice -n 5 python3 tools/linemove.py build    # trajectories 2012-2025 (every 2026+ row dropped at parse)
    nice -n 5 python3 tools/linemove.py timing   # matchup creation dates, open lead, sampling test, volatility profile
    nice -n 5 python3 tools/linemove.py q1       # how much of the move is predictable; closing-line value of model bets
    nice -n 5 python3 tools/linemove.py stacks   # snapshot stacks, cross-feeding costs, synthetic T-k lines (CV <= 2023)
    nice -n 5 python3 tools/linemove.py beyond   # movement / dispersion beyond the close (winner, method)
    nice -n 5 python3 tools/linemove.py prereg   # write the pre-registration (PREREG) into data/derived/linemove.json
    nice -n 5 python3 tools/linemove.py valid    # PREREG's configurations scored ONCE on 2024-01-01..2025-12-31
    nice -n 5 python3 tools/linemove.py addendum # second run, pre-2024: fwd-4.1 as run, share of the open->close gain,
                                                 # per-book closes, production weights, test vectors
    nice -n 5 python3 tools/linemove.py prereg2  # write PREREG_ADDENDUM
    nice -n 5 python3 tools/linemove.py valid_addendum   # PREREG_ADDENDUM's secondaries scored once on 2024-2025
    nice -n 5 python3 tools/linemove.py export   # data/derived/linemove.json
    nice -n 5 python3 tools/linemove.py vault    # 2026 trajectories -> the auditors' vault dir (no outcome is read)
    nice -n 5 python3 tools/linemove.py all      # build timing q1 stacks beyond addendum export (the two 2024-2025
                                                 # looks are separate commands and are not re-run by `all`)

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


# ====================================================================== stage: q1 (is the move predictable?)
def traj_matrix(D):
    """z (power, point 0 multiplicative) and decimal odds per point for side A and B (from mult p and overround)."""
    P = snaps(D, "pow")
    Pm = snaps(D, "mult")
    ovr = np.full((len(D), NPTS), np.nan)
    for i, v in enumerate(D["snap_ovr"]):
        if isinstance(v, list):
            ovr[i] = v
    decA = 1.0 / (Pm * ovr)
    decB = 1.0 / ((1 - Pm) * ovr)
    return P, Pm, decA, decB


def ols0(X, y):
    """No-intercept least squares (antisymmetric targets and features keep the fit corner-symmetric)."""
    b, *_ = np.linalg.lstsq(X, y, rcond=None)
    return b


def stage_q1(a):
    D = load_traj()["D"]
    P, Pm, decA, decB = traj_matrix(D)
    yrs = D["year"].to_numpy()
    ok = (~np.isnan(P).any(1)) & D["evalrow"].to_numpy(bool) & D["ml2lr"].notna().to_numpy() & (yrs <= 2023)
    z = lg(P)
    zml = lg(D["ml2lr"].to_numpy(float))
    zmr = np.nan_to_num(lg(D["mr"].astype(float).to_numpy()), nan=0.0)
    zwhr = np.nan_to_num(lg(D["whr"].astype(float).to_numpy()), nan=0.0)
    hasmr = D["mr"].notna().to_numpy()
    y = D["y"].to_numpy(float)
    g = D["event"].to_numpy()
    R = {"rows": int(ok.sum()), "rows_by_year": {int(k): int(v) for k, v in Counter(yrs[ok]).items()}}
    models = {}
    for s in (0, 1, 4, 8):
        tgt = z[:, 9] - z[:, s]
        feats = {"d_ml2lr": zml - z[:, s], "d_mr": np.where(hasmr, zmr - z[:, s], 0.0), "d_whr": zwhr - z[:, s],
                 "z_line": z[:, s]}
        if s >= 1:
            feats["momentum (z_s - z_open)"] = z[:, s] - z[:, 0]
        specs = {"M1 model gap": ["d_ml2lr"], "M2 + market rating + WHR gaps": ["d_ml2lr", "d_mr", "d_whr"],
                 "M3 + line level (+ momentum)": list(feats)}
        out = {}
        for name, cols in specs.items():
            X = np.column_stack([feats[c] for c in cols])
            sse = ss0 = 0.0
            per = {}
            for Y in range(2017, 2024):
                tr = ok & (yrs < Y)
                te = ok & (yrs == Y)
                if tr.sum() < 150 or te.sum() < 30:
                    continue
                b = ols0(X[tr], tgt[tr])
                e = tgt[te] - X[te] @ b
                sse_y, ss0_y = float(e @ e), float(tgt[te] @ tgt[te])
                per[int(Y)] = round(1 - sse_y / ss0_y, 4)
                if Y >= 2019:
                    sse += sse_y
                    ss0 += ss0_y
            b_all = ols0(X[ok], tgt[ok])
            out[name] = {"oos_r2_2019_2023": round(1 - sse / ss0, 4), "oos_r2_by_year": per,
                         "coef_fit_le_2023": dict(zip(cols, np.round(b_all, 4).tolist()))}
        sd_move = float(np.std(tgt[ok & (yrs >= 2019)]))
        corr = float(np.corrcoef(tgt[ok], feats["d_ml2lr"][ok])[0, 1])
        models["from point %d" % s] = {"sd_logit_move_to_close": round(sd_move, 4), "corr(move, model gap)": round(corr, 4),
                                       "models": out}
        log("point %d -> close: sd %.4f corr %.3f | %s" % (s, sd_move, corr, {k: (v["oos_r2_2019_2023"], v["coef_fit_le_2023"])
                                                                         for k, v in out.items()}))
    R["move_regression"] = models
    # closing-line value (CLV) of betting the side ML v2 favours over the line at point s, at that point's price
    # (point 0: the opener, one book; points 1-8: BFO's mean odds, not the best price). CLV = p_close(side) * dec_s - 1
    # with p_close the power no-vig close; ROI = 1[side won] * dec_s - 1.
    pc = P[:, 9]
    clv = {}
    for s in (0, 1, 4, 8):
        e = sg(zml) - P[:, s]
        for t in (0.0, 0.03, 0.05, 0.10):
            for per_name, msk in (("2019-2023", ok & (yrs >= 2019)), ("2015-2018", ok & (yrs < 2019) & (yrs >= 2015))):
                side_A = e > t
                side_B = e < -t
                m = msk & (side_A | side_B)
                if m.sum() < 20:
                    continue
                dec = np.where(side_A, decA[:, s], decB[:, s])
                pcs = np.where(side_A, pc, 1 - pc)
                won = np.where(side_A, y, 1 - y)
                c_ = pcs * dec - 1
                r_ = won * dec - 1
                both = 0.5 * ((pc * decA[:, s] - 1) + ((1 - pc) * decB[:, s] - 1))     # no-skill benchmark: both sides
                bs = ml2.boot(g[m], [c_[m], r_[m], c_[m] - both[m]], a.boot, 7)
                q = lambda k: [round(float(np.percentile(bs[:, k], 2.5)), 4), round(float(np.percentile(bs[:, k], 97.5)), 4)]
                clv["point %d | edge > %.2f | %s" % (s, t, per_name)] = {
                    "bets": int(m.sum()), "share_of_fights": round(float(m.sum() / msk.sum()), 3),
                    "mean_clv": round(float(c_[m].mean()), 4), "clv_ci": q(0),
                    "clv_minus_both_sides": round(float((c_[m] - both[m]).mean()), 4), "clv_minus_both_sides_ci": q(2),
                    "roi": round(float(r_[m].mean()), 4), "roi_ci": q(1),
                    "share_line_moved_toward_model": round(float(np.mean(np.sign(z[m, 9] - z[m, s]) == np.sign(zml[m] - z[m, s]))), 3)}
    R["clv"] = clv
    for k, v in clv.items():
        if "2019-2023" in k:
            log("CLV %-38s bets %4d clv %+.4f %s | vs both sides %+.4f %s | roi %+.4f %s | moved toward %.3f" % (
                k, v["bets"], v["mean_clv"], v["clv_ci"], v["clv_minus_both_sides"], v["clv_minus_both_sides_ci"],
                v["roi"], v["roi_ci"], v["share_line_moved_toward_model"]))
    wjson(os.path.join(CACHE, "q1.json"), R)


STAGES["q1"] = stage_q1


# ====================================================================== stage: beyond (movement beyond the close) + consensus gate
def lr_fit(Z, yv, wv=None, l2=1e-4):
    """No-intercept logistic regression with free signs (ridge l2 as in ml2.stack_fit); mirrored-data symmetric."""
    from scipy.optimize import minimize
    wv = np.ones(len(yv)) if wv is None else wv
    wv = wv / wv.sum()

    def f(b):
        q = Z @ b
        return np.sum(wv * (np.logaddexp(0, q) - yv * q)) + l2 * b @ b, Z.T @ (wv * (sg(q) - yv)) + 2 * l2 * b
    return minimize(f, np.zeros(Z.shape[1]), jac=True, method="L-BFGS-B").x


def cv_lr(Z, y, yrs, rows, years=CV_YEARS, start=2019, fitter=None):
    fitter = fitter or (lambda Zt, yt, yrt, Y: lr_fit(Zt, yt))
    pr = np.full(len(y), np.nan)
    for Y in years:
        tr = rows & (yrs >= start) & (yrs <= Y - 1)
        te = rows & (yrs == Y)
        b = fitter(Z[tr], y[tr], yrs[tr], Y)
        pr[te] = sg(Z[te] @ b)
    m = rows & np.isin(yrs, years)
    return round(ml2.ll(pr[m], y[m]), 5), pr


def books_sd(E):
    out = np.full(len(E), np.nan)
    nb = np.zeros(len(E))
    for i, b in enumerate(E["books_p"]):
        if isinstance(b, dict) and len(b) >= 3:
            v = lg(np.array(list(b.values())))
            out[i] = float(np.std(v))
            nb[i] = len(b)
    return out, nb


def stage_beyond(a):
    E, P, tm = stack_table()
    y = E["y"].to_numpy(float)
    yrs = E["year"].to_numpy()
    full = E["full"].to_numpy(bool)
    g = cv_groups(E)
    ZS = np.column_stack([zcol(P[:, j]) for j in range(NPTS)])
    Zml = zcol(E["ml2lr_static"])
    Zc = zcol(E["market"])
    R = {}
    # ---- winner: movement and dispersion beyond the close (forward-chained 2021-2023, fit 2019..Y-1)
    rs = np.array([v if v == v and v is not None else np.nan for v in E["range_spread"]], float)
    bsd, nb = books_sd(E)
    rs0 = np.nan_to_num(rs, nan=np.nanmedian(rs))
    mv = np.abs(ZS[:, 9] - ZS[:, 1])
    late = np.abs(ZS[:, 9] - ZS[:, 8])
    base = np.column_stack([Zc, Zml])
    variants = {
        "B0 close + ml2lr (free signs)": base,
        "B1 + opener": np.column_stack([base, ZS[:, 0]]),
        "B2 + point 8 (late steam)": np.column_stack([base, ZS[:, 8]]),
        "B3 + point 1 (first consensus)": np.column_stack([base, ZS[:, 1]]),
        "B4 + points 1 and 8": np.column_stack([base, ZS[:, 1], ZS[:, 8]]),
        "B5 + range spread x (close, ml2lr)": np.column_stack([base, rs0 * Zc, rs0 * Zml]),
        "B6 + |open-close move| x (close, ml2lr)": np.column_stack([base, mv * Zc, mv * Zml]),
        "B7 + |late move| x (close, ml2lr)": np.column_stack([base, late * Zc, late * Zml]),
    }
    rows = full
    win = {}
    pr0 = None
    for name, Z in variants.items():
        v, pr = cv_lr(Z, y, yrs, rows)
        if pr0 is None:
            pr0 = pr
        m = rows & np.isin(yrs, CV_YEARS)
        b = lr_fit(Z[rows & (yrs <= 2023)], y[rows & (yrs <= 2023)])
        win[name] = {"cv": v, "coef_fit_le_2023": np.round(b, 4).tolist(),
                     "vs_B0": ml2.compare(pr[m], pr0[m], y[m], g[m], a.boot)}
        log("winner %-42s CV %.5f vs B0 %+.5f %s coef %s" % (name, v, win[name]["vs_B0"]["diff"],
                                                             win[name]["vs_B0"]["diff_ci"], np.round(b, 3)))
    # per-book dispersion exists from 2021 only: CV 2022-2023 trained on 2021..Y-1
    okb = rows & ~np.isnan(bsd)
    bsd0 = np.nan_to_num(bsd)
    v0_, p0b = cv_lr(base, y, yrs, okb, years=(2022, 2023), start=2021)
    v1_, p1b = cv_lr(np.column_stack([base, bsd0 * Zc, bsd0 * Zml]), y, yrs, okb, years=(2022, 2023), start=2021)
    mb = okb & np.isin(yrs, (2022, 2023))
    win["B8 + per-book sd x (close, ml2lr) [2021+; CV 2022-23]"] = {"cv": v1_, "cv_B0_same_rows": v0_,
                                                                   "vs_B0": ml2.compare(p1b[mb], p0b[mb], y[mb], g[mb], a.boot)}
    log("winner B8 per-book sd: CV %.5f vs B0 %.5f" % (v1_, v0_))
    # gate = tools/ml2.py's rule (CV point estimate better by more than 0.0005); the stricter variant that also needs
    # the paired CI to exclude 0 is reported alongside (it was coded first; the brief names the ml2 rule)
    passed = [k for k, v in win.items() if k != "B0 close + ml2lr (free signs)" and v["vs_B0"]["diff"] < -SEL_MIN]
    strict = [k for k in passed if win[k]["vs_B0"]["diff_ci"][1] < 0]
    R["winner_beyond_close"] = {"variants": win, "passed_gate_ml2_rule (CV diff < -0.0005)": passed,
                                "passed_strict_variant (also CI < 0)": strict,
                                "note": "B1-B7 are 7 variants tried at once; a pass is the best of 7 and is confirmed "
                                        "or not by the single 2024-2025 look"}
    # ---- method: does movement / dispersion predict a decision beyond the decision prop? (props 2021+)
    tr_ = load_traj()["D"].set_index("fid")
    mk = json.load(open(os.path.join(DERIVED, "market.json")))["fights"]
    Dall = load_traj()["D"]
    Pa = snaps(Dall, "pow")
    za = lg(Pa)
    dec_y = np.array([1.0 if m_ in ("UD", "SD", "MD", "DRAW") else (0.0 if m_ in ("KO", "SUB", "DOC", "DQ") else np.nan)
                      for m_ in Dall["method"]])
    pdec = np.array([mk.get(f, {}).get("p_dec") if mk.get(f, {}).get("p_dec") is not None else np.nan for f in Dall["fid"]], float)
    yA = Dall["year"].to_numpy()
    rsA = np.array([v if isinstance(v, float) and v == v else np.nan for v in Dall.get("range_spread", pd.Series([np.nan] * len(Dall)))], float)
    okm = (~np.isnan(pdec)) & (~np.isnan(dec_y)) & (~np.isnan(za).any(1)) & Dall["evalrow"].to_numpy(bool) & (yA <= 2023)
    zp = lg(np.clip(pdec, 0.02, 0.98))
    fav = np.abs(za[:, 9])
    feats = {"|late move|": np.abs(za[:, 9] - za[:, 8]), "|open-close move|": np.abs(za[:, 9] - za[:, 1]),
             "steam to favourite": np.sign(za[:, 9]) * (za[:, 9] - za[:, 1]), "range spread": np.nan_to_num(rsA, nan=np.nanmedian(rsA))}
    from scipy.optimize import minimize

    def lr_int(X, yv):
        def f(b):
            q = X @ b
            return np.sum(np.logaddexp(0, q) - yv * q) / len(yv) + 1e-4 * b[1:] @ b[1:], X.T @ (sg(q) - yv) / len(yv) + np.r_[0, 2e-4 * b[1:]]
        return minimize(f, np.zeros(X.shape[1]), jac=True, method="L-BFGS-B").x
    meth = {}
    base_m = np.column_stack([np.ones(len(zp)), zp, fav])
    gA = Dall["event"].to_numpy()
    prs = {}
    for name, extra in [("D0 prop + |close logit|", None)] + [("D + " + k, v) for k, v in feats.items()]:
        X = base_m if extra is None else np.column_stack([base_m, extra])
        pr = np.full(len(zp), np.nan)
        for Y in (2022, 2023):
            trm = okm & (yA >= 2021) & (yA <= Y - 1)
            te = okm & (yA == Y)
            b = lr_int(X[trm], dec_y[trm])
            pr[te] = sg(X[te] @ b)
        prs[name] = pr
        m = okm & np.isin(yA, (2022, 2023))
        meth[name] = {"cv_2022_2023": round(ml2.ll(pr[m], dec_y[m]), 5), "n": int(m.sum())}
    m = okm & np.isin(yA, (2022, 2023))
    raw_prop = round(ml2.ll(pdec[m], dec_y[m]), 5)
    for k in meth:
        if k != "D0 prop + |close logit|":
            meth[k]["vs_D0"] = ml2.compare(prs[k][m], prs["D0 prop + |close logit|"][m], dec_y[m], gA[m], a.boot)
    meth["raw decision prop (no refit)"] = {"cv_2022_2023": raw_prop}
    R["decision_beyond_props"] = meth
    log("decision: %s" % {k: (v["cv_2022_2023"], v.get("vs_D0", {}).get("diff"), v.get("vs_D0", {}).get("diff_ci")) for k, v in meth.items()})
    # ---- consensus stack: which training snapshots, and the gate vs the incumbent open-trained stack
    fed = list(range(4, NPTS))          # a T-25h..T-8h consensus capture sits in here under either sampling reading
    sets = {"S8": [8], "S678": [6, 7, 8], "S4-8": [4, 5, 6, 7, 8], "S1-9": list(range(1, NPTS)), "S9 (close-trained)": [9]}
    cons = {}
    oofs = {}
    for name, js in sets.items():
        res_h = {}
        for h in (None, 3.0, 1.5):
            per_fed = {}
            pr_fed = {}
            for j in fed:
                pr = np.full(len(y), np.nan)
                for Y in CV_YEARS:
                    trm = full & (yrs >= 2019) & (yrs <= Y - 1)
                    Zt = np.vstack([np.column_stack([ZS[trm, k], Zml[trm]]) for k in js])
                    yt = np.tile(y[trm], len(js))
                    yrt = np.tile(yrs[trm], len(js))
                    b = fit_w(Zt, yt, yrt, Y - 1, h)
                    te = full & (yrs == Y)
                    pr[te] = sg(np.column_stack([ZS[te, j], Zml[te]]) @ b)
                mm = full & np.isin(yrs, CV_YEARS)
                per_fed[j] = round(ml2.ll(pr[mm], y[mm]), 5)
                pr_fed[j] = pr
            res_h[str(h)] = {"by_fed": per_fed, "mean_fed_4_9": round(float(np.mean(list(per_fed.values()))), 5)}
            oofs[(name, str(h))] = pr_fed
        hb = min(res_h, key=lambda k: res_h[k]["mean_fed_4_9"] + (0 if k == "None" else SEL_MIN))
        trm = full & (yrs <= 2023)
        Zt = np.vstack([np.column_stack([ZS[trm, k], Zml[trm]]) for k in js])
        b = fit_w(Zt, np.tile(y[trm], len(js)), np.tile(yrs[trm], len(js)), 2023, None if hb == "None" else float(hb))
        cons[name] = {"by_h": res_h, "h": None if hb == "None" else float(hb), "weights_fit_le_2023": np.round(b, 4).tolist()}
        log("consensus %-20s h %s mean fed 4-9 %.5f by fed %s w %s" % (name, hb, res_h[hb]["mean_fed_4_9"], res_h[hb]["by_fed"], np.round(b, 4)))
    # incumbent: the open-trained stack (snapshot 0 = the opener, multiplicative), fed each consensus point
    inc = {}
    for j in fed:
        pr = np.full(len(y), np.nan)
        for Y in CV_YEARS:
            trm = full & (yrs >= 2019) & (yrs <= Y - 1)
            b = fit_w(np.column_stack([ZS[trm, 0], Zml[trm]]), y[trm], yrs[trm], Y - 1, None)
            te = full & (yrs == Y)
            pr[te] = sg(np.column_stack([ZS[te, j], Zml[te]]) @ b)
        inc[j] = pr
    mm = full & np.isin(yrs, CV_YEARS)
    best = min((k for k in cons if not k.startswith("S9")), key=lambda k: cons[k]["by_h"][str(cons[k]["h"])]["mean_fed_4_9"])
    pb = oofs[(best, str(cons[best]["h"]))]
    gate = {}
    stack_new = np.concatenate([pb[j][mm] for j in fed])
    stack_inc = np.concatenate([inc[j][mm] for j in fed])
    yy = np.tile(y[mm], len(fed))
    gg = np.tile(g[mm], len(fed))
    gate["pooled over fed points 4-9 (each fight counted once per point)"] = ml2.compare(stack_new, stack_inc, yy, gg, a.boot)
    for j in fed:
        gate["fed point %d" % j] = ml2.compare(pb[j][mm], inc[j][mm], y[mm], g[mm], a.boot)
    # the close-trained stack (ml2's line regime) fed the consensus points, against the chosen consensus stack
    pc9 = oofs[("S9 (close-trained)", str(cons["S9 (close-trained)"]["h"]))]
    for j in fed:
        gate["close-trained minus chosen, fed point %d" % j] = ml2.compare(pc9[j][mm], pb[j][mm], y[mm], g[mm], a.boot)
    d = gate["pooled over fed points 4-9 (each fight counted once per point)"]
    passed_c = bool(d["diff"] < -SEL_MIN)
    R["consensus_stack"] = {"sets": cons, "chosen_set": best, "gate_vs_open_trained": gate,
                            "rule": "chosen set = lowest mean CV log loss over fed points 4-9 (h by the 0.0005 rule); "
                                    "gate (tools/ml2.py rule): pooled CV log loss better than the open-trained stack "
                                    "by more than 0.0005",
                            "gate_passed": passed_c,
                            "strict_variant_passed (also CI < 0)": bool(passed_c and d["diff_ci"][1] < 0)}
    for k, v in gate.items():
        log("gate %-62s %+.5f %s" % (k, v["diff"], v["diff_ci"]))
    log("consensus chosen %s; gate passed %s; winner beyond close passed: %s" % (best, passed_c, passed))
    # symmetry: power / multiplicative de-vig are corner-symmetric and the stacks have no intercept
    sw = []
    for (dA, dB) in ((1.5, 2.8), (1.08, 9.0), (2.0, 1.9), (3.4, 1.33)):
        for mth in ("mult", "power"):
            sw.append(abs(MK.devig(dA, dB, mth) + MK.devig(dB, dA, mth) - 1))
    bch = np.array(cons[best]["weights_fit_le_2023"])
    Zt = np.column_stack([ZS[full, 8], Zml[full]])
    sw.append(float(np.max(np.abs(sg(Zt @ bch) + sg(-Zt @ bch) - 1))))
    R["symmetry_max_abs"] = float(max(sw))
    assert R["symmetry_max_abs"] < 1e-12, R["symmetry_max_abs"]
    pickle.dump({"R": R}, open(os.path.join(CACHE, "beyond.pkl"), "wb"))
    wjson(os.path.join(CACHE, "beyond.json"), R)


STAGES["beyond"] = stage_beyond


# ====================================================================== pre-registration of the single 2024-2025 look
PREREG = {
    "written": "2026-11-06 ~22:25 UTC, after the pre-2024 CV stages (timing, q1, stacks, beyond) and before any "
               "2024-2025 number of this tool was computed; committed to git before `valid` runs",
    "window": "2024-01-01..2025-12-31, decisive dev evaluation fights with a full 10-point trajectory, a close and an open",
    "primary": "consensus stack (sparkline points 4-8 pooled + ML v2 logistic, weights fit on 2019-2023, no recency "
               "weighting) minus the open-trained stack (opener + ML v2 logistic, fit 2019-2023), both fed the real BFO "
               "mean line at points 4..9, pooled (each fight once per point); paired log loss, 2,000 card resamples. "
               "Expected about -0.0012 (CV 2021-2023: -0.00124 [-0.0033, +0.0009]).",
    "secondaries": [
        "the same difference per fed point 4..9, and with January refits (rolling, ML v2 monthly-rolling logistic)",
        "close-trained stack (point 9 + ML v2 logistic) minus the consensus stack, fed points 4..9",
        "the full cross-feed matrix (trained on 0 / consensus / 9, fed 0..9)",
        "raw log loss of every sparkline point and of market.json's close",
        "winner beyond the close: B3 (close + ML v2 logistic + point 1, free signs, fit 2019-2023) minus B0 (close + ML v2 "
        "logistic) -- the only beyond-close variant that passed the ml2 0.0005 rule (best of 7)",
        "Q1: out-of-sample R^2 of the move to the close (coefficients fit <= 2023) from points 0, 1, 4, 8; CLV and ROI "
        "of betting ML v2's side at points 0, 1, 4, 8 for edge thresholds 0, 0.03, 0.05, 0.10",
        "synthetic T-24h line (Brownian bridge, profile fit <= 2023): consensus vs open-trained stack (descriptive)",
    ],
    "not_scored": "the decision-prop variants (none passed), B1, B2, B4-B8 (failed the gate)",
    "failure": "primary CI upper bound above +0.0005 counts as 'not confirmed'; a CI entirely above 0 counts as "
               "'contradicted' (the open-trained stack stays primary for consensus lines)",
}


def stage_prereg(a):
    os.makedirs(DERIVED, exist_ok=True)
    doc = json.load(open(OUT_JSON)) if os.path.exists(OUT_JSON) else {}
    doc["prereg"] = PREREG
    wjson(OUT_JSON, doc)
    log("pre-registration written to %s" % OUT_JSON)


STAGES["prereg"] = stage_prereg


# ====================================================================== stage: valid (2024-2025, scored once)
def pooled_fit(ZS, Zml, y, yrs, rows, js, until, h=None, start=2019):
    trm = rows & (yrs >= start) & (yrs <= until)
    Zt = np.vstack([np.column_stack([ZS[trm, k], Zml[trm]]) for k in js])
    return fit_w(Zt, np.tile(y[trm], len(js)), np.tile(yrs[trm], len(js)), until, h)


def stage_valid(a):
    E, P, tm = stack_table()
    y = E["y"].to_numpy(float)
    yrs = E["year"].to_numpy()
    full = E["full"].to_numpy(bool)
    g = cv_groups(E)
    va = full & (yrs >= 2024) & (yrs <= 2025)
    ZS = np.column_stack([zcol(P[:, j]) for j in range(NPTS)])
    Zst = zcol(E["ml2lr_static"])
    Zro = zcol(E["ml2lr_roll"])
    Zc = zcol(E["market"])
    BY = pickle.load(open(os.path.join(CACHE, "beyond.pkl"), "rb"))["R"]
    chosen_set = BY["consensus_stack"]["chosen_set"]
    SETS = {"S8": [8], "S678": [6, 7, 8], "S4-8": [4, 5, 6, 7, 8], "S1-9": list(range(1, NPTS))}
    cjs = SETS[chosen_set]
    V = {"prereg": PREREG, "n": int(va.sum()), "cards": int(len(set(g[va]))), "chosen_consensus_set": chosen_set}
    log("2024-2025 look: %d fights on %d cards; consensus set %s" % (va.sum(), len(set(g[va])), chosen_set))
    # A. raw lines
    V["raw_lines"] = {str(j): round(ml2.ll(P[va, j], y[va]), 5) for j in range(NPTS)}
    V["raw_lines"]["close_market_json"] = round(ml2.ll(E["market"].to_numpy(float)[va], y[va]), 5)
    V["raw_lines"]["ml2lr_static"] = round(ml2.ll(sg(Zst[va]), y[va]), 5)
    log("raw: %s" % V["raw_lines"])
    # B. stacks: static (fit 2019-2023) and rolling (refit each January; ML v2 monthly-rolling logistic in 2024-2025)
    def stack_preds(js, feed_j, scheme):
        out = np.full(len(y), np.nan)
        if scheme == "static":
            b = pooled_fit(ZS, Zst, y, yrs, full, js, 2023)
            out[va] = sg(np.column_stack([ZS[va, feed_j], Zst[va]]) @ b)
            return out, b
        Zr = np.where(yrs >= 2024, Zro, Zst)
        for Y in (2024, 2025):
            b = pooled_fit(ZS, Zr, y, yrs, full, js, Y - 1)
            te = va & (yrs == Y)
            out[te] = sg(np.column_stack([ZS[te, feed_j], Zr[te]]) @ b)
        return out, b
    trained = {"open-trained (point 0)": [0], "consensus (%s)" % chosen_set: cjs, "close-trained (point 9)": [9]}
    XF = {}
    PR = {}
    W = {}
    for sch in ("static", "roll"):
        for tname, js in trained.items():
            row = {}
            for j in range(NPTS):
                pr, b = stack_preds(js, j, sch)
                PR[(sch, tname, j)] = pr
                row[str(j)] = round(ml2.ll(pr[va], y[va]), 5)
                W[(sch, tname)] = np.round(b, 4).tolist()
            XF["%s | %s" % (sch, tname)] = row
            log("%-6s %-26s fed 0..9: %s  w %s" % (sch, tname, " ".join("%.4f" % row[str(j)] for j in range(NPTS)), W[(sch, tname)]))
    V["cross_feed"] = XF
    V["weights"] = {"%s | %s" % k: v for k, v in W.items()}
    cons = "consensus (%s)" % chosen_set
    fed = list(range(4, NPTS))
    pr_res = {}
    for sch in ("static", "roll"):
        a_ = np.concatenate([PR[(sch, cons, j)][va] for j in fed])
        b_ = np.concatenate([PR[(sch, "open-trained (point 0)", j)][va] for j in fed])
        c_ = np.concatenate([PR[(sch, "close-trained (point 9)", j)][va] for j in fed])
        yy = np.tile(y[va], len(fed))
        gg = np.tile(g[va], len(fed))
        pr_res["%s | PRIMARY consensus minus open-trained, pooled fed 4-9" % sch] = ml2.compare(a_, b_, yy, gg, a.boot)
        pr_res["%s | close-trained minus consensus, pooled fed 4-9" % sch] = ml2.compare(c_, a_, yy, gg, a.boot)
        for j in fed + [0]:
            pr_res["%s | consensus minus open-trained, fed %d" % (sch, j)] = ml2.compare(
                PR[(sch, cons, j)][va], PR[(sch, "open-trained (point 0)", j)][va], y[va], g[va], a.boot)
            pr_res["%s | close-trained minus consensus, fed %d" % (sch, j)] = ml2.compare(
                PR[(sch, "close-trained (point 9)", j)][va], PR[(sch, cons, j)][va], y[va], g[va], a.boot)
        for j in (8, 9):
            pr_res["%s | consensus fed %d minus the raw line at %d" % (sch, j, j)] = ml2.compare(
                PR[(sch, cons, j)][va], P[va, j], y[va], g[va], a.boot)
            pr_res["%s | consensus fed %d minus market.json close" % (sch, j)] = ml2.compare(
                PR[(sch, cons, j)][va], E["market"].to_numpy(float)[va], y[va], g[va], a.boot)
    V["paired"] = pr_res
    for k, v in pr_res.items():
        log("  %-62s a %.5f b %.5f diff %+.5f %s" % (k, v["a"], v["b"], v["diff"], v["diff_ci"]))
    prim = pr_res["static | PRIMARY consensus minus open-trained, pooled fed 4-9"]
    V["primary_verdict"] = ("confirmed" if prim["diff_ci"][1] < 0 else
                            ("contradicted" if prim["diff_ci"][0] > 0 else
                             ("not confirmed (CI upper > +0.0005)" if prim["diff_ci"][1] > 0.0005 else "not confirmed")))
    log("PRIMARY: %+.5f %s -> %s" % (prim["diff"], prim["diff_ci"], V["primary_verdict"]))
    # by year
    V["by_year"] = {}
    for Y in (2024, 2025):
        m = va & (yrs == Y)
        V["by_year"][str(Y)] = {"n": int(m.sum()), "close": round(ml2.ll(E["market"].to_numpy(float)[m], y[m]), 5),
                                "point8_raw": round(ml2.ll(P[m, 8], y[m]), 5),
                                "consensus_fed8": round(ml2.ll(PR[("static", cons, 8)][m], y[m]), 5),
                                "open_trained_fed8": round(ml2.ll(PR[("static", "open-trained (point 0)", 8)][m], y[m]), 5),
                                "close_trained_fed9": round(ml2.ll(PR[("static", "close-trained (point 9)", 9)][m], y[m]), 5)}
    log("by year: %s" % V["by_year"])
    # C. winner beyond the close: B3 vs B0 (free signs, fit 2019-2023)
    tr = full & (yrs <= 2023) & (yrs >= 2019)
    X0 = np.column_stack([Zc, Zst])
    X3 = np.column_stack([Zc, Zst, ZS[:, 1]])
    b0 = lr_fit(X0[tr], y[tr])
    b3 = lr_fit(X3[tr], y[tr])
    V["beyond_close_B3_vs_B0"] = {"B0_coef": np.round(b0, 4).tolist(), "B3_coef": np.round(b3, 4).tolist(),
                                  "cmp": ml2.compare(sg(X3[va] @ b3), sg(X0[va] @ b0), y[va], g[va], a.boot)}
    log("B3 vs B0: %s" % V["beyond_close_B3_vs_B0"]["cmp"])
    # D. Q1 on 2024-2025 with coefficients fit <= 2023
    D = load_traj()["D"]
    Pt, Pm, decA, decB = traj_matrix(D)
    yrt = D["year"].to_numpy()
    okt = (~np.isnan(Pt).any(1)) & D["evalrow"].to_numpy(bool) & D["ml2lr"].notna().to_numpy()
    zt = lg(Pt)
    zml = lg(D["ml2lr"].to_numpy(float))
    zmr = np.nan_to_num(lg(D["mr"].astype(float).to_numpy()), nan=0.0)
    hasmr = D["mr"].notna().to_numpy()
    zwhr = np.nan_to_num(lg(D["whr"].astype(float).to_numpy()), nan=0.0)
    yt = D["y"].to_numpy(float)
    gt = D["event"].to_numpy()
    q1 = {}
    trq = okt & (yrt <= 2023)
    teq = okt & (yrt >= 2024) & (yrt <= 2025)
    for s_ in (0, 1, 4, 8):
        tgt = zt[:, 9] - zt[:, s_]
        feats = {"d_ml2lr": zml - zt[:, s_], "d_mr": np.where(hasmr, zmr - zt[:, s_], 0.0), "d_whr": zwhr - zt[:, s_],
                 "z_line": zt[:, s_]}
        if s_ >= 1:
            feats["momentum (z_s - z_open)"] = zt[:, s_] - zt[:, 0]
        out = {}
        for name, cols in {"M1 model gap": ["d_ml2lr"], "M2 + market rating + WHR gaps": ["d_ml2lr", "d_mr", "d_whr"],
                           "M3 + line level (+ momentum)": list(feats)}.items():
            X = np.column_stack([feats[c] for c in cols])
            b = ols0(X[trq], tgt[trq])
            e = tgt[teq] - X[teq] @ b
            out[name] = round(1 - float(e @ e) / float(tgt[teq] @ tgt[teq]), 4)
        q1["from point %d" % s_] = {"oos_r2": out, "corr(move, model gap)": round(float(np.corrcoef(tgt[teq], feats["d_ml2lr"][teq])[0, 1]), 4)}
    pc = Pt[:, 9]
    clv = {}
    for s_ in (0, 1, 4, 8):
        e_ = sg(zml) - Pt[:, s_]
        for t in (0.0, 0.03, 0.05, 0.10):
            sA, sB = e_ > t, e_ < -t
            m = teq & (sA | sB)
            dec = np.where(sA, decA[:, s_], decB[:, s_])
            pcs = np.where(sA, pc, 1 - pc)
            won = np.where(sA, yt, 1 - yt)
            c_ = pcs * dec - 1
            r_ = won * dec - 1
            both = 0.5 * ((pc * decA[:, s_] - 1) + ((1 - pc) * decB[:, s_] - 1))
            bs = ml2.boot(gt[m], [c_[m], r_[m], c_[m] - both[m]], a.boot, 7)
            q = lambda k: [round(float(np.percentile(bs[:, k], 2.5)), 4), round(float(np.percentile(bs[:, k], 97.5)), 4)]
            clv["point %d | edge > %.2f" % (s_, t)] = {"bets": int(m.sum()), "mean_clv": round(float(c_[m].mean()), 4), "clv_ci": q(0),
                                                       "clv_minus_both_sides": round(float((c_[m] - both[m]).mean()), 4),
                                                       "clv_minus_both_sides_ci": q(2), "roi": round(float(r_[m].mean()), 4), "roi_ci": q(1)}
    V["q1"] = {"rows": int(teq.sum()), "move_regression": q1, "clv": clv}
    log("Q1 2024-25: %s" % q1)
    for k, v in clv.items():
        log("  CLV %-22s bets %4d clv %+.4f %s vs both %+.4f %s roi %+.4f %s" % (k, v["bets"], v["mean_clv"], v["clv_ci"],
            v["clv_minus_both_sides"], v["clv_minus_both_sides_ci"], v["roi"], v["roi_ci"]))
    # E. synthetic T-24h line (descriptive)
    s_prof, v0 = tm["s"], tm["v0"]
    L = E["lead_days"].to_numpy(float)
    tau = np.array([[(9 - j) / 9.0 * l for j in range(NPTS)] for l in L])
    rng = np.random.default_rng(20261106)
    o = bridge_line(ZS, tau, s_prof, v0, 1.0, rng, 8)
    okr = va & ~np.isnan(o[0])
    bc = pooled_fit(ZS, Zst, y, yrs, full, cjs, 2023)
    bo = pooled_fit(ZS, Zst, y, yrs, full, [0], 2023)
    lc = [ml2.ll(sg(np.column_stack([o[d][okr], Zst[okr]]) @ bc), y[okr]) for d in range(8)]
    lo = [ml2.ll(sg(np.column_stack([o[d][okr], Zst[okr]]) @ bo), y[okr]) for d in range(8)]
    V["synthetic_T24h"] = {"rows": int(okr.sum()), "consensus": round(float(np.mean(lc)), 5),
                           "open_trained": round(float(np.mean(lo)), 5), "diff": round(float(np.mean(lc) - np.mean(lo)), 5)}
    log("synthetic T-24h: %s" % V["synthetic_T24h"])
    V["scored_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    wjson(os.path.join(CACHE, "valid.json"), V)
    pickle.dump({"V": V, "PR": PR}, open(os.path.join(CACHE, "valid.pkl"), "wb"))


STAGES["valid"] = stage_valid


# ====================================================================== stage: addendum (pre-2024 CV, second run)
# The first run was stopped by a container restart after `valid`. This stage adds, on pre-2024 data only:
#  (a) the forward ledger's incumbent AS RUN (fwd-4.1: open-trained weights fed the MULTIPLICATIVE de-vig of the
#      consensus line, data/predictions/README.md) against the consensus stack (fed the power de-vig, market.py's
#      convention for mean odds);
#  (b) how much of the market's open -> close log-loss gain the model already knows (share recovered by the
#      open-trained stack), and the consensus stack fed point j against the raw close;
#  (c) per-book closes (seven US books, 2021+) against the consensus close (descriptive; no sharp book is listed);
#  (d) production weights (2019-2025, ml2's production procedure: OOF 2019-2023 + monthly-rolling 2024-2025 ML v2
#      logistic; deployment, never scored) and test vectors.
def snaps_E(E, kind):
    tr = load_traj()["D"].set_index("fid")
    out = np.full((len(E), NPTS), np.nan)
    for i, f in enumerate(E["fid"]):
        if f in tr.index:
            v = tr.at[f, "snap_" + kind]
            if isinstance(v, list):
                out[i] = [np.nan if x is None else x for x in v]
    return out


def oof_trained(ZS_fit, Zml, y, yrs, rows, js, Zfeed, h=None, years=CV_YEARS):
    """Forward-chained OOF (fit 2019..Y-1 on the pooled training points js of ZS_fit, predict year Y from Zfeed =
    [line, ml] columns)."""
    pr = np.full(len(y), np.nan)
    for Y in years:
        b = pooled_fit(ZS_fit, Zml, y, yrs, rows, js, Y - 1, h)
        te = rows & (yrs == Y)
        pr[te] = sg(Zfeed[te] @ b)
    return pr


def share_recovered(l_open, l_model, l_close, g, nboot):
    bs = ml2.boot(g, [l_open, l_model, l_close], nboot, 7)
    r = (bs[:, 0] - bs[:, 1]) / (bs[:, 0] - bs[:, 2])
    pt = (l_open.mean() - l_model.mean()) / (l_open.mean() - l_close.mean())
    return {"n": int(len(l_open)), "ll_open_raw": round(float(l_open.mean()), 5), "ll_model": round(float(l_model.mean()), 5),
            "ll_close_raw": round(float(l_close.mean()), 5), "share": round(float(pt), 3),
            "share_ci": [round(float(np.percentile(r, 2.5)), 3), round(float(np.percentile(r, 97.5)), 3)]}


def per_book(E, rows, y, g, nboot):
    mm = E["market_mult"].to_numpy(float)
    books = sorted({k for b in E["books_p"] if isinstance(b, dict) for k in b})
    out = {}
    for bk in books:
        pb = np.array([b.get(bk, np.nan) if isinstance(b, dict) else np.nan for b in E["books_p"]], float)
        m = rows & ~np.isnan(pb) & ~np.isnan(mm)
        if m.sum() < 100:
            continue
        out[bk] = ml2.compare(np.clip(pb[m], 1e-4, 1 - 1e-4), mm[m], y[m], g[m], nboot)
    pmean = np.array([np.mean(list(b.values())) if isinstance(b, dict) and len(b) >= 3 else np.nan for b in E["books_p"]])
    m = rows & ~np.isnan(pmean) & ~np.isnan(mm)
    out["mean of the US books (>= 3 books)"] = ml2.compare(pmean[m], mm[m], y[m], g[m], nboot)
    return out


def stage_addendum(a):
    E, P, tm = stack_table()
    Pm = snaps_E(E, "mult")
    y = E["y"].to_numpy(float)
    yrs = E["year"].to_numpy()
    full = E["full"].to_numpy(bool)
    g = cv_groups(E)
    cvr = full & np.isin(yrs, CV_YEARS)
    ZS = np.column_stack([zcol(P[:, j]) for j in range(NPTS)])        # power (point 0 multiplicative)
    ZM = np.column_stack([zcol(Pm[:, j]) for j in range(NPTS)])       # multiplicative at every point
    Zml = zcol(E["ml2lr_static"])
    BY = pickle.load(open(os.path.join(CACHE, "beyond.pkl"), "rb"))["R"]
    cset = BY["consensus_stack"]["chosen_set"]
    cjs = {"S8": [8], "S678": [6, 7, 8], "S4-8": [4, 5, 6, 7, 8], "S1-9": list(range(1, NPTS))}[cset]
    R = {"consensus_set": cset}
    fed = list(range(4, NPTS))
    # (a) incumbent as run: open-trained (point 0, multiplicative) fed the multiplicative consensus
    pc = {j: oof_trained(ZS, Zml, y, yrs, full, cjs, np.column_stack([ZS[:, j], Zml])) for j in range(NPTS)}
    pim = {j: oof_trained(ZS, Zml, y, yrs, full, [0], np.column_stack([ZM[:, j], Zml])) for j in range(NPTS)}
    pip = {j: oof_trained(ZS, Zml, y, yrs, full, [0], np.column_stack([ZS[:, j], Zml])) for j in range(NPTS)}
    inc = {}
    cat = lambda d: np.concatenate([d[j][cvr] for j in fed])
    yy, gg = np.tile(y[cvr], len(fed)), np.tile(g[cvr], len(fed))
    inc["consensus minus open-trained fed MULT (fwd-4.1 as run), pooled fed 4-9"] = ml2.compare(cat(pc), cat(pim), yy, gg, a.boot)
    inc["open-trained fed MULT minus open-trained fed POWER, pooled fed 4-9"] = ml2.compare(cat(pim), cat(pip), yy, gg, a.boot)
    for j in fed:
        inc["consensus minus open-trained fed MULT, fed %d" % j] = ml2.compare(pc[j][cvr], pim[j][cvr], y[cvr], g[cvr], a.boot)
    R["incumbent_as_run"] = inc
    for k, v in inc.items():
        log("CV %-70s a %.5f b %.5f %+.5f %s" % (k, v["a"], v["b"], v["diff"], v["diff_ci"]))
    # (b) share of the open -> close gain the model already knows; consensus stack at j vs the raw close
    close = E["market"].to_numpy(float)
    lo, lc = ml2.ll_vec(P[cvr, 0], y[cvr]), ml2.ll_vec(close[cvr], y[cvr])
    sh = {"open-trained stack (opener + ML v2 logistic)": share_recovered(lo, ml2.ll_vec(pip[0][cvr], y[cvr]), lc, g[cvr], a.boot),
          "ML v2 logistic alone": share_recovered(lo, ml2.ll_vec(sg(Zml[cvr]), y[cvr]), lc, g[cvr], a.boot)}
    for j in (1, 4, 8):
        sh["raw consensus point %d" % j] = share_recovered(lo, ml2.ll_vec(P[cvr, j], y[cvr]), lc, g[cvr], a.boot)
        sh["consensus stack fed point %d" % j] = share_recovered(lo, ml2.ll_vec(pc[j][cvr], y[cvr]), lc, g[cvr], a.boot)
    R["share_of_open_to_close_gain"] = sh
    vs_close = {}
    for j in (0, 1, 4, 6, 8, 9):
        src = pip[0] if j == 0 else pc[j]
        vs_close["%s fed point %d minus the close" % ("open-trained" if j == 0 else "consensus", j)] = ml2.compare(
            src[cvr], close[cvr], y[cvr], g[cvr], a.boot)
    R["stack_minus_close"] = vs_close
    for k, v in list(sh.items()) + list(vs_close.items()):
        log("CV %-50s %s" % (k, {kk: v[kk] for kk in v if kk in ("share", "share_ci", "diff", "diff_ci", "a", "b")}))
    # (c) per-book closes vs the consensus (multiplicative both), 2021-2023
    rb = full & (yrs >= 2021) & (yrs <= 2023)
    R["per_book_2021_2023"] = per_book(E, rb, y, g, a.boot)
    for k, v in R["per_book_2021_2023"].items():
        log("book %-36s n %4d ll %.5f vs consensus %.5f %+.5f %s" % (k, v["n"], v["a"], v["b"], v["diff"], v["diff_ci"]))
    # (d) production weights (deployment: fit 2019-2025 like ml2's page stacks; never scored) + the <= 2023 weights
    Zprod = np.where(yrs >= 2024, zcol(E["ml2lr_roll"]), Zml)
    W = {}
    for name, js, Zl in (("open_trained", [0], ZS), ("consensus", cjs, ZS), ("close_trained", [9], ZS)):
        W[name] = {"training_points": js, "inputs": ["line", "ml2lr"],
                   "line_devig": "multiplicative (single-book opener)" if js == [0] else "power de-vig of BFO mean decimal odds",
                   "weights_fit_2019_2023": np.round(pooled_fit(Zl, Zml, y, yrs, full, js, 2023), 6).tolist(),
                   "weights_production_2019_2025": np.round(pooled_fit(Zl, Zprod, y, yrs, full, js, 2025), 6).tolist(),
                   "recency_half_life_years": None, "pclip": PCLIP, "intercept": False}
        log("weights %-14s <=2023 %s production %s" % (name, W[name]["weights_fit_2019_2023"], W[name]["weights_production_2019_2025"]))
    R["weights"] = W
    # test vectors (corner swap exact by construction: no intercept, odd in both inputs)
    vec = []
    for pl, pm_ in ((0.5, 0.5), (0.62, 0.55), (0.8, 0.6), (0.3, 0.45), (0.95, 0.9), (0.05, 0.2), (0.71, 0.33), (0.004, 0.999)):
        zl, zm = zcol([pl])[0], zcol([pm_])[0]
        row = {"line": pl, "ml2lr": pm_}
        for name in W:
            for k_ in ("weights_fit_2019_2023", "weights_production_2019_2025"):
                b = np.array(W[name][k_])
                p = float(sg(b[0] * zl + b[1] * zm))
                ps = float(sg(b[0] * -zl + b[1] * -zm))
                assert abs(p + ps - 1) < 1e-12
                row["%s|%s" % (name, k_)] = p
        vec.append(row)
    R["test_vectors"] = vec
    pickle.dump({"R": R, "pc": pc, "pim": pim, "pip": pip}, open(os.path.join(CACHE, "addendum.pkl"), "wb"))
    wjson(os.path.join(CACHE, "addendum.json"), R)


STAGES["addendum"] = stage_addendum


PREREG_ADDENDUM = {
    "written": "2026-11-06 ~22:36 UTC by the second run, after the pre-2024 `addendum` stage and BEFORE this run read "
               "any 2024-2025 number: out/linemove_cache/valid.json (written 22:24 UTC by the first run under PREREG) "
               "has not been opened by this run; committed to git before `valid_addendum` runs",
    "why": "the forward ledger's incumbent (fwd-4.1 ml2_stack_open) feeds the MULTIPLICATIVE de-vig of the consensus "
           "line to open-trained weights; PREREG's primary fed both stacks the power de-vig. The as-run incumbent is "
           "the comparison the routing decision needs",
    "secondaries": [
        "consensus stack (S4-8, fit 2019-2023) minus fwd-4.1 as run (open-trained, fit 2019-2023, fed the "
        "multiplicative de-vig of BFO mean odds at points 4..9), pooled fed 4-9 and per point; also with January "
        "refits (ML v2 monthly-rolling logistic). CV 2021-2023: -0.00152 [-0.0035, +0.0005]",
        "share of the opener -> close log-loss gain recovered by the open-trained stack (opener + ML v2 logistic); "
        "CV 2021-2023: 0.716 [0.283, 1.755] (descriptive)",
        "consensus stack fed point j minus the close (market.json power close), j = 1, 4, 8, 9; CV 2021-2023 "
        "-0.0016 / -0.0022 / -0.0032 / -0.0022, all CIs include 0 (descriptive)",
        "per-book closes vs the consensus close (multiplicative both), seven US books (descriptive)",
    ],
    "routing_recommendation_fixed_before_the_look": {
        "single-book opener (BFO's first price)": "open-trained stack, multiplicative de-vig (unchanged)",
        "consensus line (mean over books) captured at any time before the lock": "consensus stack, power de-vig "
            "(replaces fwd-4.1's open-trained weights fed the multiplicative consensus)",
        "true closing line (backtests, results pages)": "close-trained stack, power de-vig (unchanged; the consensus "
            "stack ties it on the close in CV, -0.00003)",
        "contingency": "if the as-run secondary (static, pooled 4-9) has a CI entirely above 0 on 2024-2025, the "
                       "recommendation reverts to fwd-4.1's routing; otherwise it stands as a CV-chosen change, "
                       "confirmed only if the CI upper bound is below 0",
    },
}


def stage_prereg2(a):
    doc = json.load(open(OUT_JSON)) if os.path.exists(OUT_JSON) else {}
    doc["prereg_addendum"] = PREREG_ADDENDUM
    wjson(OUT_JSON, doc)
    log("addendum pre-registration written to %s" % OUT_JSON)


STAGES["prereg2"] = stage_prereg2


def stage_valid_addendum(a):
    """The PREREG_ADDENDUM secondaries on 2024-01-01..2025-12-31 (scored once, after the pre-registration commit)."""
    E, P, tm = stack_table()
    Pm = snaps_E(E, "mult")
    y = E["y"].to_numpy(float)
    yrs = E["year"].to_numpy()
    full = E["full"].to_numpy(bool)
    g = cv_groups(E)
    va = full & (yrs >= 2024) & (yrs <= 2025)
    ZS = np.column_stack([zcol(P[:, j]) for j in range(NPTS)])
    ZM = np.column_stack([zcol(Pm[:, j]) for j in range(NPTS)])
    Zst = zcol(E["ml2lr_static"])
    Zr = np.where(yrs >= 2024, zcol(E["ml2lr_roll"]), Zst)
    AD = pickle.load(open(os.path.join(CACHE, "addendum.pkl"), "rb"))["R"]
    cjs = {"S8": [8], "S678": [6, 7, 8], "S4-8": [4, 5, 6, 7, 8], "S1-9": list(range(1, NPTS))}[AD["consensus_set"]]
    fed = list(range(4, NPTS))
    V = {"prereg_addendum": PREREG_ADDENDUM, "n": int(va.sum()), "cards": int(len(set(g[va])))}

    def preds(js, Zline_feed, scheme, j):
        out = np.full(len(y), np.nan)
        if scheme == "static":
            b = pooled_fit(ZS, Zst, y, yrs, full, js, 2023)
            out[va] = sg(np.column_stack([Zline_feed[va, j], Zst[va]]) @ b)
            return out
        for Y in (2024, 2025):
            b = pooled_fit(ZS, Zr, y, yrs, full, js, Y - 1)
            te = va & (yrs == Y)
            out[te] = sg(np.column_stack([Zline_feed[te, j], Zr[te]]) @ b)
        return out
    PC, PIM, PIP = {}, {}, {}
    res = {}
    yy, gg = np.tile(y[va], len(fed)), np.tile(g[va], len(fed))
    for sch in ("static", "roll"):
        for j in range(NPTS):
            PC[(sch, j)] = preds(cjs, ZS, sch, j)
            PIM[(sch, j)] = preds([0], ZM, sch, j)
            PIP[(sch, j)] = preds([0], ZS, sch, j)
        cat = lambda d: np.concatenate([d[(sch, j)][va] for j in fed])
        res["%s | consensus minus fwd-4.1 as run (open-trained fed MULT), pooled fed 4-9" % sch] = ml2.compare(
            cat(PC), cat(PIM), yy, gg, a.boot)
        res["%s | open-trained fed MULT minus fed POWER, pooled fed 4-9" % sch] = ml2.compare(cat(PIM), cat(PIP), yy, gg, a.boot)
        for j in fed:
            res["%s | consensus minus fwd-4.1 as run, fed %d" % (sch, j)] = ml2.compare(
                PC[(sch, j)][va], PIM[(sch, j)][va], y[va], g[va], a.boot)
    V["incumbent_as_run"] = res
    prim = res["static | consensus minus fwd-4.1 as run (open-trained fed MULT), pooled fed 4-9"]
    V["as_run_verdict"] = ("confirmed" if prim["diff_ci"][1] < 0 else
                           ("contradicted" if prim["diff_ci"][0] > 0 else "not confirmed"))
    close = E["market"].to_numpy(float)
    lo, lc = ml2.ll_vec(P[va, 0], y[va]), ml2.ll_vec(close[va], y[va])
    V["share_of_open_to_close_gain"] = {
        "open-trained stack (static)": share_recovered(lo, ml2.ll_vec(PIP[("static", 0)][va], y[va]), lc, g[va], a.boot),
        "ML v2 logistic alone (static)": share_recovered(lo, ml2.ll_vec(sg(Zst[va]), y[va]), lc, g[va], a.boot)}
    for j in (1, 4, 8):
        V["share_of_open_to_close_gain"]["raw consensus point %d" % j] = share_recovered(lo, ml2.ll_vec(P[va, j], y[va]), lc, g[va], a.boot)
        V["share_of_open_to_close_gain"]["consensus stack fed point %d (static)" % j] = share_recovered(
            lo, ml2.ll_vec(PC[("static", j)][va], y[va]), lc, g[va], a.boot)
    V["stack_minus_close"] = {"consensus (static) fed point %d minus the close" % j: ml2.compare(
        PC[("static", j)][va], close[va], y[va], g[va], a.boot) for j in (1, 4, 8, 9)}
    V["stack_minus_close"]["open-trained (static) fed point 0 minus the close"] = ml2.compare(
        PIP[("static", 0)][va], close[va], y[va], g[va], a.boot)
    V["per_book"] = per_book(E, va, y, g, a.boot)
    V["scored_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    wjson(os.path.join(CACHE, "valid_addendum.json"), V)
    pickle.dump({"V": V, "PC": PC, "PIM": PIM, "PIP": PIP}, open(os.path.join(CACHE, "valid_addendum.pkl"), "wb"))
    for k, v in res.items():
        log("  %-78s a %.5f b %.5f %+.5f %s" % (k, v["a"], v["b"], v["diff"], v["diff_ci"]))
    log("as-run verdict: %s" % V["as_run_verdict"])
    for k, v in V["share_of_open_to_close_gain"].items():
        log("  share %-48s %s %s" % (k, v["share"], v["share_ci"]))
    for k, v in list(V["stack_minus_close"].items()) + list(V["per_book"].items()):
        log("  %-56s n %d a %.5f b %.5f %+.5f %s" % (k, v["n"], v["a"], v["b"], v["diff"], v["diff_ci"]))


STAGES["valid_addendum"] = stage_valid_addendum


# ====================================================================== stage: export (data/derived/linemove.json)
ROUTING = {
    "decision": "keep fwd-4.1's routing; do not add a capture-time switch",
    "table": [
        {"capture": "single-book opener (BFO's first price)", "stack": "open_trained", "line_devig": "multiplicative"},
        {"capture": "consensus line (mean over books) captured any time before the lock, T-24h included",
         "stack": "open_trained", "line_devig": "multiplicative (as fwd-4.1); feeding the power de-vig is a tie in CV "
                                                "(+0.0003 [-0.0006, +0.0011] for multiplicative)"},
        {"capture": "true closing line (backtests, results pages)", "stack": "close_trained", "line_devig": "power"},
        {"capture": "no line", "stack": "the no-line stack (unchanged)", "line_devig": None},
    ],
    "why": [
        "Training on a consensus snapshot passed the pre-2024 gate (consensus minus open-trained, both fed points 4-9: "
        "-0.0012 [-0.0033, +0.0009]; against fwd-4.1 as run: -0.0015 [-0.0035, +0.0005]) but the pre-registered "
        "2024-2025 primary was contradicted: +0.0041 [+0.0017, +0.0066]; as run +0.0028 [-0.0001, +0.0059]. Under "
        "PREREG's failure rule the open-trained stack stays primary for consensus lines, and under docs/V6_V10_PLAN.md "
        "6.3 the change also fails 'not worse' (CI upper > +0.002)",
        "Among consensus snapshots the training point barely matters (cross-feed spread <= 0.0005 in CV; T-6h..T-7d "
        "synthetic lines give the same weights within 0.02). The stacks differ mainly in the ML v2 weight (open-trained "
        "0.58, consensus 0.39, close-trained 0.33), and 2024-2025 rewards ML v2 weight whatever line is fed (open-trained "
        "beats close-trained even on the close there). That is a drift / calibration question for the calib "
        "workstream, not a line-timing one",
    ],
    "not_actionable": "on 2024-2025 the open-trained stack fed the POWER de-vig beat it fed the multiplicative de-vig, "
                      "+0.0014 [+0.0001, +0.0025] for multiplicative; CV says tie (+0.0003), so nothing changes "
                      "(selection on 2024-2025 is not allowed); a candidate secondary column for the forward ledger",
}


def _r(v, k=5):
    return None if v is None or (isinstance(v, float) and v != v) else round(float(v), k)


def stage_export(a):
    S = load_traj()
    tmg = pickle.load(open(os.path.join(CACHE, "timing.pkl"), "rb"))
    q1 = json.load(open(os.path.join(CACHE, "q1.json")))
    st = json.load(open(os.path.join(CACHE, "stacks.json")))
    by = json.load(open(os.path.join(CACHE, "beyond.json")))
    ad = json.load(open(os.path.join(CACHE, "addendum.json")))
    va = json.load(open(os.path.join(CACHE, "valid.json")))
    vad = json.load(open(os.path.join(CACHE, "valid_addendum.json")))
    adp = pickle.load(open(os.path.join(CACHE, "addendum.pkl"), "rb"))
    vap = pickle.load(open(os.path.join(CACHE, "valid_addendum.pkl"), "rb"))
    E, P, _ = stack_table()
    Pm = snaps_E(E, "mult")
    yrs = E["year"].to_numpy()
    full = E["full"].to_numpy(bool)
    fights = {}
    for i in np.flatnonzero(full):
        Y = int(yrs[i])
        r = {"date": str(E["date"].iloc[i])[:10], "set": "valid" if Y >= 2024 else ("oof" if Y >= 2021 else "train"),
             "traj": [_r(x, 4) for x in P[i]], "traj_mult": [_r(x, 4) for x in Pm[i]]}
        if Y >= 2024:
            r["p_cons8_static"] = _r(vap["PC"][("static", 8)][i], 5)
            r["p_cons8_roll"] = _r(vap["PC"][("roll", 8)][i], 5)
            r["p_open_fed8mult_static"] = _r(vap["PIM"][("static", 8)][i], 5)
            r["p_open_fed8mult_roll"] = _r(vap["PIM"][("roll", 8)][i], 5)
        elif Y >= 2021:
            r["p_cons8_oof"] = _r(adp["pc"][8][i], 5)
            r["p_open_fed8mult_oof"] = _r(adp["pim"][8][i], 5)
        fights[E["fid"].iloc[i]] = r
    assert all(v["date"] < VAULT_S for v in fights.values())
    tres = dict(tmg["res"])
    doc = json.load(open(OUT_JSON)) if os.path.exists(OUT_JSON) else {}
    out = {
        "meta": {"built": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "tool": "tools/linemove.py",
                 "report": "research/model_linemove.md",
                 "source": "data/raw/odds/bfo_fighter_lines.csv (BFO fighter-page sparklines, parsed by tools/market.py), "
                           "data/raw/odds/bfo_event_lines.csv (per-book closes, 2021+), data/derived/market.json, "
                           "out/ml2_cache (ML v2 table, fits and stack table)",
                 "sparkline": "10 points per bout and side, index-only (BFO's chart uses pointStart 1, no time axis): "
                              "point 0 = the opener (one book's first price, multiplicative de-vig), points 1-8 = BFO "
                              "mean odds in between, point 9 = mean of the books' closing odds (power de-vig of mean "
                              "decimal odds, research/model_market.md)",
                 "protocol": "rows dated >= 2026-01-01 dropped at parse; every choice by forward-chained CV <= 2023 "
                             "(stack gate 2021-2023, fit 2019..Y-1, tools/ml2.py's 0.0005 rule); 2024-2025 scored once "
                             "per pre-registration (prereg, prereg_addendum); 2,000 card-cluster bootstrap resamples, "
                             "paired; no intercepts, corner swap asserted",
                 "orientation": "A = the first ufcstats name; p = P(A wins)"},
        "prereg": doc.get("prereg", PREREG), "prereg_addendum": doc.get("prereg_addendum", PREREG_ADDENDUM),
        "data": {"coverage_by_year": S["coverage"], "checks": S["checks"], "matching": S["diag"],
                 "rows_dropped_at_parse_2026": S["dropped_at_parse"]},
        "timing": tres, "q1": q1, "stacks": st, "beyond": by, "addendum": ad,
        "validation_2024_2025": {"first_look": {k: v for k, v in va.items() if k != "prereg"},
                                 "addendum_look": {k: v for k, v in vad.items() if k != "prereg_addendum"}},
        "routing": ROUTING,
        "weights": ad["weights"],
        "test_vectors": ad["test_vectors"],
        "fights": fights,
    }
    if "verification" in doc:           # keep the verifier's block (tools/linemove.py verify) across re-exports
        out["verification"] = doc["verification"]
    tmp = OUT_JSON + ".tmp"
    with open(tmp, "w") as fh:          # compact: the per-fight block dominates the size
        json.dump(out, fh, separators=(",", ":"), default=float)
    os.replace(tmp, OUT_JSON)
    log("wrote %s (%d fights, %.0f KB)" % (OUT_JSON, len(fights), os.path.getsize(OUT_JSON) / 1024))


STAGES["export"] = stage_export


# ====================================================================== stage: vault (2026 trajectories, outside the repo)
def load_bfo_matchups_vault():
    """The 2026 rows only (dated >= 2026-01-01); exchange books dropped (their 2026 prices can encode results)."""
    mus = {}
    for r in MK.read_csv(os.path.join(ODDS, "bfo_event_lines.csv")):
        if not (r["date"] and r["date"] >= VAULT_S):
            continue
        mu = int(r["mu"])
        m = mus.setdefault(mu, {"mu": mu, "date": r["date"], "n1": r["t1_name"], "n2": r["t2_name"], "t1_url": r["t1_url"],
                                "t2_url": r["t2_url"], "event": r["event_slug"], "books": {}, "pages": []})
        a1, a2 = _int(r["a1"]), _int(r["a2"])
        if r["book"] and a1 and a2 and r["book"] not in MK.EXCHANGES:
            m["books"][r["book"]] = (a1, a2)
    for r in MK.read_csv(os.path.join(ODDS, "bfo_fighter_lines.csv")):
        if not (r["date"] and r["date"] >= VAULT_S):
            continue
        mu, t = _int(r["mu"]), _int(r["owner_team"])
        if mu is None or t not in (1, 2):
            continue
        m = mus.get(mu)
        if m is None:
            own, opp = r["owner_name"], r["opp_name"]
            m = mus[mu] = {"mu": mu, "date": r["date"], "n1": own if t == 1 else opp, "n2": opp if t == 1 else own,
                           "t1_url": r["owner_url"] if t == 1 else r["opp_url"],
                           "t2_url": r["opp_url"] if t == 1 else r["owner_url"],
                           "event": (r["event_url"] or "").replace("/events/", ""), "books": {}, "pages": []}
        o = {"open": (_int(r["open1"]), _int(r["open2"])), "lo": (_int(r["lo1"]), _int(r["lo2"])),
             "hi": (_int(r["hi1"]), _int(r["hi2"]))}
        if t == 2:
            o = {k: (v[1], v[0]) for k, v in o.items()}
        m["pages"].append(o)
        if r["spark"]:
            m["spark%d" % t] = [float(x) for x in r["spark"].split(";") if x]
    return mus


def stage_vault(a):
    """2026 trajectories for the auditors: written ONLY to VAULT_DIR (outside the repo); only id, date and names are read
    from the vault fight list (no result or stat field), and nothing here is scored or read back by any stage."""
    bt = json.load(open(os.path.join(VAULT_DIR, "backtest_vault.json")))
    fights = [{"id": f["id"], "date": f["date"], "A": {"name": f["A"]["name"]}, "B": {"name": f["B"]["name"]}}
              for f in bt["fights"] if f["date"] >= VAULT_S]
    del bt
    mus = load_bfo_matchups_vault()
    MK.load_bfo_matchups = lambda: mus
    recs, diag = MK.assemble(fights)
    out = {}
    for f in fights:
        rec = recs.get(f["id"], {})
        mu = rec.get("bfo_mu")
        row = {"date": f["date"], "A": f["A"]["name"], "B": f["B"]["name"], "mu": mu}
        if mu is not None:
            m = mus[mu]
            sw = rec["bfo_swap"]
            s1, s2 = m.get("spark1"), m.get("spark2")
            sA, sB = (s2, s1) if sw else (s1, s2)
            if sA and sB and len(sA) == len(sB) == NPTS:
                row["traj_mult"] = [_r(devig_pair(x, y_, "mult"), 6) for x, y_ in zip(sA, sB)]
                row["traj"] = [_r(devig_pair(x, y_, "power"), 6) for x, y_ in zip(sA, sB)]
                row["traj"][0] = row["traj_mult"][0]
                row["overround"] = [_r(1 / x + 1 / y_, 5) for x, y_ in zip(sA, sB)]
            bk = {}
            for name, (x, y_) in (rec.get("bfo_books") or {}).items():
                if name in MK.EXCHANGES or not x or not y_:
                    continue
                dA, dB = MK.am_to_dec(x), MK.am_to_dec(y_)
                if dA and dB and 0.98 <= 1 / dA + 1 / dB <= 1.25:
                    bk[name] = _r(MK.devig(dA, dB, "mult"), 6)
            if bk:
                row["books_p_mult"] = bk
        out[f["id"]] = row
    os.makedirs(VAULT_DIR, exist_ok=True)
    path = os.path.join(VAULT_DIR, "linemove_vault.json")
    wjson(path, {"meta": {"built": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "tool": "tools/linemove.py vault",
                          "what": "BFO sparkline trajectories (traj: point 0 multiplicative, 1-9 power de-vig; traj_mult) "
                                  "and per-book closes for the 2026 vault fights; same orientation as backtest_vault.json "
                                  "(A first); exchange books dropped; open only at the v6/v10 audits",
                          "matching": diag, "n": len(out), "with_trajectory": sum("traj" in v for v in out.values())},
                 "fights": out})
    log("wrote %s: %d vault fights, %d with a trajectory (outside the repo)" % (
        path, len(out), sum("traj" in v for v in out.values())))


STAGES["vault"] = stage_vault


# ====================================================================== stage: tables (research/model_linemove.md)
def stage_tables(a):
    """Print every table of research/model_linemove.md from data/derived/linemove.json (no computation)."""
    D = json.load(open(OUT_JSON))
    f5 = lambda v: "%.4f" % v if isinstance(v, (int, float)) else str(v)
    dci = lambda c: "%+.4f [%+.4f, %+.4f]" % (c["diff"], c["diff_ci"][0], c["diff_ci"][1])
    sci = lambda s: "%.2f [%.2f, %.2f]" % (s["share"], s["share_ci"][0], s["share_ci"][1])

    def table(title, head, rows):
        print("\n### %s\n" % title)
        print("| " + " | ".join(head) + " |")
        print("|" + "---|" * len(head))
        for r in rows:
            print("| " + " | ".join(str(x) for x in r) + " |")
    cov = D["data"]["coverage_by_year"]
    table("T1 coverage (decisive dev evaluation fights)", ["year", "eval fights", "with a 10-point trajectory", "per-book closes"],
          [[y, c["eval_rows"], c["trajectory_eval_rows"], c["per_book"]] for y, c in cov.items() if int(y) >= 2015])
    ch = D["data"]["checks"]
    tm = D["timing"]
    table("T2 sparkline checks and timing", ["item", "value"], [
        ["point 9 vs market.json power close, mean abs diff (n %d)" % ch["n"], ch["mean_abs(spark9_pow - market close_pow)"]],
        ["point 0 identical to the parsed opener", ch["share opener identical (< 0.005)"]],
        ["sampling test, Gaussian ll per step: time-uniform vs index-only (forward-chained 2016-2023, n %d)" %
         tm["forward_chained_mean_ll"]["n"], "%s vs %s" % (tm["forward_chained_mean_ll"]["time_uniform"],
                                                          tm["forward_chained_mean_ll"]["index_only"])],
        ["matchup lead (days from BFO's first line to the event), quartiles", "%s / %s / %s" % (
            tm["lead_days_quantiles"]["25"], tm["lead_days_quantiles"]["50"], tm["lead_days_quantiles"]["75"])],
        ["lead estimator CV MAE / median abs error (days; %d short-notice anchors)" % tm["lead_estimator"]["anchors"],
         "%s / %s" % (tm["lead_estimator"]["cv_mae_days_isotonic_capped"], tm["lead_estimator"]["cv_median_abs_err_days"])]])
    q, qv = D["q1"]["move_regression"], D["validation_2024_2025"]["first_look"]["q1"]["move_regression"]
    rows = []
    for s in (0, 1, 4, 8):
        k = "from point %d" % s
        m, mv = q[k]["models"], qv[k]["oos_r2"]
        rows.append([s, q[k]["sd_logit_move_to_close"], q[k]["corr(move, model gap)"], qv[k]["corr(move, model gap)"],
                     m["M1 model gap"]["oos_r2_2019_2023"], mv["M1 model gap"],
                     m["M2 + market rating + WHR gaps"]["oos_r2_2019_2023"], mv["M2 + market rating + WHR gaps"],
                     m["M3 + line level (+ momentum)"]["oos_r2_2019_2023"], mv["M3 + line level (+ momentum)"]])
    table("T3 how much of the move to the close is predictable (logit move; out-of-sample R^2, no intercept)",
          ["from point", "sd of move (2019-23)", "corr(move, ML v2 gap) CV", "2024-25", "R2 M1 gap CV", "2024-25",
           "R2 M2 +ratings CV", "2024-25", "R2 M3 +level CV", "2024-25"], rows)
    cl, clv = D["q1"]["clv"], D["validation_2024_2025"]["first_look"]["q1"]["clv"]
    rows = []
    for s in (0, 1, 4, 8):
        for t in (0.0, 0.03, 0.10):
            c = cl["point %d | edge > %.2f | 2019-2023" % (s, t)]
            o = cl.get("point %d | edge > %.2f | 2015-2018" % (s, t))
            v = clv["point %d | edge > %.2f" % (s, t)]
            fmt = lambda x, ci: "%+.3f [%+.3f, %+.3f]" % (x, ci[0], ci[1])
            rows.append([s, t, c["bets"], fmt(c["clv_minus_both_sides"], c["clv_minus_both_sides_ci"]),
                         fmt(c["roi"], c["roi_ci"]), fmt(o["roi"], o["roi_ci"]) if o else "-",
                         fmt(v["clv_minus_both_sides"], v["clv_minus_both_sides_ci"]), fmt(v["roi"], v["roi_ci"])])
    table("T4 betting ML v2's side at point s, at that point's price (point 0: one book's opener; 1-8: BFO mean odds)",
          ["point", "edge >", "bets 2019-23", "CLV minus both sides 2019-23", "ROI 2019-23", "ROI 2015-18",
           "CLV minus both sides 2024-25", "ROI 2024-25"], rows)
    sh, shv = D["addendum"]["share_of_open_to_close_gain"], D["validation_2024_2025"]["addendum_look"]["share_of_open_to_close_gain"]
    keys = [("open-trained stack (opener + ML v2 logistic)", "open-trained stack (static)"),
            ("ML v2 logistic alone", "ML v2 logistic alone (static)")] + \
           [("raw consensus point %d" % j, "raw consensus point %d" % j) for j in (1, 4, 8)] + \
           [("consensus stack fed point %d" % j, "consensus stack fed point %d (static)" % j) for j in (1, 4, 8)]
    table("T5 share of the opener -> close log-loss gain already in each forecast (1 = as good as the close)",
          ["forecast", "CV 2021-23", "2024-25"], [[k, sci(sh[k]), sci(shv[kv])] for k, kv in keys])
    rl, rlv = D["stacks"]["raw_lines"], D["validation_2024_2025"]["first_look"]["raw_lines"]
    table("T6 raw lines, log loss (decisive fights with a full trajectory)", ["line", "2019-23", "CV years 2021-23", "2024-25"],
          [[k, rl[k]["ll_2019_2023"], rl[k]["ll_cv_years"], rlv.get({"ml2lr": "ml2lr_static"}.get(k, k), "")] for k in rl])
    xf = D["stacks"]["cross_feed_cv"]["rows_trained_on_snapshot_i_cols_fed_snapshot_j"]
    table("T7 cross-feeding, CV 2021-23 log loss (row: training point of a line + ML v2 logistic stack; column: line fed)",
          ["trained on \\ fed"] + [str(j) for j in range(NPTS)], [[i] + ["%.4f" % v for v in xf[i]] for i in range(NPTS)])
    xv = D["validation_2024_2025"]["first_look"]["cross_feed"]
    table("T7b the same on 2024-25 (fit 2019-2023, static)", ["trained on \\ fed"] + [str(j) for j in range(NPTS)],
          [[k.split(" | ")[1]] + ["%.4f" % xv[k][str(j)] for j in range(NPTS)] for k in xv if k.startswith("static")])
    cs = D["beyond"]["consensus_stack"]
    table("T8 consensus training sets (CV 2021-23, mean log loss over fed points 4-9; h by the 0.0005 rule)",
          ["set", "h", "mean fed 4-9", "weights (line, ML v2 lr) fit 2019-23"],
          [[k, v["h"], v["by_h"][str(v["h"])]["mean_fed_4_9"], v["weights_fit_le_2023"]] for k, v in cs["sets"].items()])
    gate = cs["gate_vs_open_trained"]
    inc = D["addendum"]["incumbent_as_run"]
    v1 = D["validation_2024_2025"]["first_look"]["paired"]
    v2 = D["validation_2024_2025"]["addendum_look"]["incumbent_as_run"]
    table("T9 the routing comparison (paired log-loss differences, 2,000 card resamples)", ["comparison", "CV 2021-23", "2024-25 (static)", "2024-25 (January refit)"], [
        ["PRIMARY: consensus minus open-trained, both fed power, pooled fed 4-9",
         dci(gate["pooled over fed points 4-9 (each fight counted once per point)"]),
         dci(v1["static | PRIMARY consensus minus open-trained, pooled fed 4-9"]), dci(v1["roll | PRIMARY consensus minus open-trained, pooled fed 4-9"])],
        ["consensus minus fwd-4.1 as run (open-trained fed multiplicative), pooled 4-9",
         dci(inc["consensus minus open-trained fed MULT (fwd-4.1 as run), pooled fed 4-9"]),
         dci(v2["static | consensus minus fwd-4.1 as run (open-trained fed MULT), pooled fed 4-9"]),
         dci(v2["roll | consensus minus fwd-4.1 as run (open-trained fed MULT), pooled fed 4-9"])],
        ["open-trained fed multiplicative minus fed power, pooled 4-9",
         dci(inc["open-trained fed MULT minus open-trained fed POWER, pooled fed 4-9"]),
         dci(v2["static | open-trained fed MULT minus fed POWER, pooled fed 4-9"]),
         dci(v2["roll | open-trained fed MULT minus fed POWER, pooled fed 4-9"])],
        ["close-trained minus consensus, fed point 8", dci(gate["close-trained minus chosen, fed point 8"]),
         dci(v1["static | close-trained minus consensus, fed 8"]), dci(v1["roll | close-trained minus consensus, fed 8"])],
        ["close-trained minus consensus, fed the close (point 9)", dci(gate["close-trained minus chosen, fed point 9"]),
         dci(v1["static | close-trained minus consensus, fed 9"]), dci(v1["roll | close-trained minus consensus, fed 9"])],
        ["consensus minus open-trained, fed the opener (point 0)", "%+.4f (T7: point-4-trained minus open-trained)" % (xf[4][0] - xf[0][0]),
         dci(v1["static | consensus minus open-trained, fed 0"]), dci(v1["roll | consensus minus open-trained, fed 0"])],
    ])
    print("\nverdicts: PREREG primary %s; addendum as-run %s" % (
        D["validation_2024_2025"]["first_look"]["primary_verdict"], D["validation_2024_2025"]["addendum_look"]["as_run_verdict"]))
    syn = D["stacks"]["synthetic_tk"]
    table("T10 synthetic T-k lines (Brownian bridge between bracketing sparkline points, time-uniform reading; CV 2021-23)",
          ["k", "rows", "stack trained on T-k: CV", "weights fit 2019-23", "raw line", "open-trained fed T-k", "point-8-trained fed T-k"],
          [[k, v["rows"], v["cv_by_h"][str(v["h"])], v["weights_fit_le_2023"], v["raw_line_ll_cv_years"],
            v["snapshot_stacks_fed_this_line_cv"]["trained on snapshot 0"], v["snapshot_stacks_fed_this_line_cv"]["trained on snapshot 8"]]
           for k, v in syn.items()])
    w = D["beyond"]["winner_beyond_close"]["variants"]
    table("T11 winner beyond the close (free signs, no intercept; CV 2021-23 fit 2019..Y-1; B8 CV 2022-23)",
          ["variant", "CV log loss", "vs B0"], [[k, v["cv"], dci(v["vs_B0"])] for k, v in w.items()])
    b3 = D["validation_2024_2025"]["first_look"]["beyond_close_B3_vs_B0"]["cmp"]
    print("\nB3 minus B0 on 2024-25: %s (n %d)" % (dci(b3), b3["n"]))
    dm = D["beyond"]["decision_beyond_props"]
    table("T12 goes-to-decision beyond the decision prop (logistic with intercept; CV 2022-23, fit 2021..Y-1)",
          ["variant", "CV log loss", "vs D0"], [[k, v["cv_2022_2023"], dci(v["vs_D0"]) if "vs_D0" in v else ""] for k, v in dm.items()])
    pb, pbv = D["addendum"]["per_book_2021_2023"], D["validation_2024_2025"]["addendum_look"]["per_book"]
    table("T13 per-book closes minus the consensus close (multiplicative both)", ["book", "n 2021-23", "2021-23", "n 2024-25", "2024-25"],
          [[k, pb[k]["n"], dci(pb[k]), pbv[k]["n"] if k in pbv else "", dci(pbv[k]) if k in pbv else ""] for k in pb])
    W = D["weights"]
    table("T14 stack weights (logit p = w_line logit(line) + w_ml logit(ML v2 logistic); inputs clipped to [0.01, 0.99])",
          ["stack", "training points", "line de-vig", "fit 2019-2023 (validation)", "production 2019-2025"],
          [[k, v["training_points"], v["line_devig"], v["weights_fit_2019_2023"], v["weights_production_2019_2025"]] for k, v in W.items()])
    smc, smv = D["addendum"]["stack_minus_close"], D["validation_2024_2025"]["addendum_look"]["stack_minus_close"]
    table("T15 stacks minus the raw close", ["stack", "CV 2021-23", "2024-25"], [
        ["open-trained fed the opener", dci(smc["open-trained fed point 0 minus the close"]), dci(smv["open-trained (static) fed point 0 minus the close"])]] +
        [["consensus fed point %d" % j, dci(smc["consensus fed point %d minus the close" % j]),
          dci(smv["consensus (static) fed point %d minus the close" % j])] for j in (1, 4, 8, 9)])
    VF = D.get("verification")
    if not VF:
        return
    ci3 = lambda v: "%+.3f [%+.3f, %+.3f]" % tuple(v)
    qb = VF["q1_level_baseline"]
    table("V1 (verifier) Q1 baseline: OOS R^2 of the move to the close, CV 2019-23 / 2024-25",
          ["from point", "line level only", "ML v2 gap only (M1)", "level + ML v2", "corr(move, gap) <= 2023 / 2019-23"],
          [[k.split()[-1]] + ["%.3f / %.3f" % (qb[k][m]["oos_r2_cv_2019_2023"], qb[k][m]["r2_2024_2025"])
                              for m in ("level only", "ML v2 gap only (M1)", "level + ML v2")] +
           ["%.3f / %.3f" % (qb[k]["corr(move, gap) pooled <= 2023"], qb[k]["corr(move, gap) 2019-2023"])] for k in qb])
    cn = VF["clv_neutrality"]
    table("V2 (verifier) CLV neutrality: T4's measure vs a de-vig-consistent fair CLV, ML v2's side and the favourite rule",
          ["period", "point", "ML v2 side fav. share", "ML v2 T4", "favourite T4", "ML v2 fair CLV", "favourite fair CLV",
           "ROI ML v2", "ROI favourite", "ROI ML v2 minus fav."],
          [[k, v["ML v2 side is the favourite (share of bets)"], ci3(v["ML v2 side | T4 CLV minus both sides"]),
            ci3(v["favourite | T4 CLV minus both sides"]), ci3(v["ML v2 side | fair CLV (mult both ends)"]),
            ci3(v["favourite | fair CLV (mult both ends)"]), ci3(v["ML v2 side | ROI"]), ci3(v["favourite | ROI"]),
            ci3(v["ROI ML v2 side minus favourite (paired)"])] for k, v in cn.items()])
    fi = VF["free_intercept"]
    table("V3 (verifier) free-intercept check, CV 2021-23, stacks fed point 8 (A wins %.3f)" % fi["A wins (share), CV years"],
          ["stack", "intercept by CV year", "with intercept minus without"],
          [[k, v["intercept_by_cv_year"], dci(v["with intercept minus without (CV, fed 8)"])] for k, v in fi.items() if isinstance(v, dict)])
    mr = VF["missing_rows"]
    table("V4 (verifier) decisive evaluation fights without a full trajectory (excluded from every arm)",
          ["period", "missing / of", "A wins missing / present", "ML v2 LL missing / present", "missing with a close"],
          [[k, "%d / %d" % (v["missing"], v["of"]), "%.3f / %.3f" % (v["A_win_missing"], v["A_win_present"]),
            "%.4f / %.4f" % (v["ml2lr_ll_missing"], v["ml2lr_ll_present"]), v["missing_with_a_market_close"]] for k, v in mr.items()])


STAGES["tables"] = stage_tables


# ====================================================================== stage: verify (adversarial verifier, Nov 6 2026)
def stage_verify(a):
    """Verifier checks added after both 2024-2025 looks; nothing here selects anything. Writes linemove.json
    "verification" (and out/linemove_cache/verify.json):
    (1) Q1 baseline: out-of-sample R^2 of the move from the line level alone (mean reversion of a noisy snapshot)
        against level + ML v2 (the same span as level + gap);
    (2) T4's "CLV minus both sides" is not neutral: the close is power-de-vigged while the bet price carries its vig
        proportionally, so a favourite rule scores about +0.03 at every consensus point. Reported next to a
        de-vig-consistent fair CLV (multiplicative at point s and at the close) for ML v2's side and the favourite
        rule, and the favourite's ROI as the ROI baseline;
    (3) free-intercept check on the stacks (CV 2021-23): what an intercept, i.e. the ufcstats corner order, would add;
    (4) the decisive evaluation fights without a full trajectory (excluded from every arm)."""
    D = load_traj()["D"]
    P, Pm, decA, decB = traj_matrix(D)
    yrs = D["year"].to_numpy()
    okall = (~np.isnan(P).any(1)) & D["evalrow"].to_numpy(bool) & D["ml2lr"].notna().to_numpy()
    ok = okall & (yrs <= 2023)
    va = okall & (yrs >= 2024) & (yrs <= 2025)
    z, zml = lg(P), lg(D["ml2lr"].to_numpy(float))
    y, g = D["y"].to_numpy(float), D["event"].to_numpy()
    R = {"note": "verifier stage; descriptive (2024-2025 Q1 rows were already a pre-registered secondary)"}
    q = {}
    for s in (0, 1, 4, 8):
        tgt = z[:, 9] - z[:, s]
        out = {}
        for name, X in (("level only", z[:, [s]]), ("ML v2 gap only (M1)", (zml - z[:, s])[:, None]),
                        ("level + ML v2", np.column_stack([z[:, s], zml]))):
            sse = ss0 = 0.0
            for Y in range(2019, 2024):
                tr, te = ok & (yrs < Y), ok & (yrs == Y)
                e = tgt[te] - X[te] @ ols0(X[tr], tgt[tr])
                sse, ss0 = sse + e @ e, ss0 + tgt[te] @ tgt[te]
            e = tgt[va] - X[va] @ ols0(X[ok], tgt[ok])
            out[name] = {"oos_r2_cv_2019_2023": round(1 - sse / ss0, 4), "r2_2024_2025": round(1 - float(e @ e) / float(tgt[va] @ tgt[va]), 4)}
        m19 = ok & (yrs >= 2019)
        out["corr(move, gap) pooled <= 2023"] = round(float(np.corrcoef(tgt[ok], (zml - z[:, s])[ok])[0, 1]), 4)
        out["corr(move, gap) 2019-2023"] = round(float(np.corrcoef(tgt[m19], (zml - z[:, s])[m19])[0, 1]), 4)
        q["from point %d" % s] = out
    R["q1_level_baseline"] = q
    pc = P[:, 9]
    clv = {}
    for per, msk in (("2019-2023", ok & (yrs >= 2019)), ("2024-2025", va)):
        for s in (0, 1, 4, 8):
            e = sg(zml) - P[:, s]
            both = 0.5 * ((pc * decA[:, s] - 1) + ((1 - pc) * decB[:, s] - 1))
            row = {"ML v2 side is the favourite (share of bets)": round(float(np.mean((e > 0)[msk] == (z[msk, s] > 0))), 3)}
            arrs, names = [], []
            for rule, sA in (("ML v2 side", e > 0), ("favourite", z[:, s] > 0)):
                t4 = np.where(sA, pc * decA[:, s] - 1, (1 - pc) * decB[:, s] - 1) - both
                fair = np.where(sA, Pm[:, 9] / Pm[:, s], (1 - Pm[:, 9]) / (1 - Pm[:, s])) - 1
                roi = np.where(sA, y * decA[:, s] - 1, (1 - y) * decB[:, s] - 1)
                arrs += [t4[msk], fair[msk], roi[msk]]
                names += ["%s | %s" % (rule, k) for k in ("T4 CLV minus both sides", "fair CLV (mult both ends)", "ROI")]
            arrs.append(arrs[2] - arrs[5])
            names.append("ROI ML v2 side minus favourite (paired)")
            bs = ml2.boot(g[msk], arrs, a.boot, 7)
            for k, (nm, v) in enumerate(zip(names, arrs)):
                row[nm] = [round(float(v.mean()), 4), round(float(np.percentile(bs[:, k], 2.5)), 4), round(float(np.percentile(bs[:, k], 97.5)), 4)]
            clv["%s | point %d" % (per, s)] = row
    R["clv_neutrality"] = clv
    # (3) free intercept (CV 2021-2023; fit 2019..Y-1; stacks fed point 8)
    E, PS, _ = stack_table()
    yE, yrE, full, gE = E["y"].to_numpy(float), E["year"].to_numpy(), E["full"].to_numpy(bool), cv_groups(E)
    ZS = np.column_stack([zcol(PS[:, j]) for j in range(NPTS)])
    Zml = zcol(E["ml2lr_static"])
    cvr = full & np.isin(yrE, CV_YEARS)
    fi = {"A wins (share), CV years": round(float(yE[cvr].mean()), 4)}
    for name, js in (("open_trained", [0]), ("consensus", [4, 5, 6, 7, 8]), ("close_trained", [9])):
        p0, p1, icp = np.full(len(yE), np.nan), np.full(len(yE), np.nan), {}
        for Y in CV_YEARS:
            trm = full & (yrE >= 2019) & (yrE <= Y - 1)
            Zt = np.vstack([np.column_stack([ZS[trm, k], Zml[trm]]) for k in js])
            yt = np.tile(yE[trm], len(js))
            b0 = ml2.stack_fit(Zt, yt)
            b1 = lr_fit(np.column_stack([np.ones(len(yt)), Zt]), yt)
            te = full & (yrE == Y)
            Zf = np.column_stack([ZS[te, 8], Zml[te]])
            p0[te], p1[te] = sg(Zf @ b0), sg(np.column_stack([np.ones(te.sum()), Zf]) @ b1)
            icp[Y] = round(float(b1[0]), 4)
        fi[name] = {"intercept_by_cv_year": icp, "with intercept minus without (CV, fed 8)": ml2.compare(p1[cvr], p0[cvr], yE[cvr], gE[cvr], a.boot)}
    R["free_intercept"] = fi
    # (4) who is missing from the scored universe
    zE = zcol(E["ml2lr_static"])
    miss = {}
    for per, msk in (("2019-2023", yrE <= 2023), ("2024-2025", yrE >= 2024)):
        mi, ha = msk & ~full, msk & full
        miss[per] = {"missing": int(mi.sum()), "of": int(msk.sum()), "A_win_missing": round(float(yE[mi].mean()), 3),
                     "A_win_present": round(float(yE[ha].mean()), 3),
                     "ml2lr_ll_missing": round(ml2.ll(sg(zE[mi]), yE[mi]), 4), "ml2lr_ll_present": round(ml2.ll(sg(zE[ha]), yE[ha]), 4),
                     "missing_with_a_market_close": int((mi & E["market"].notna().to_numpy()).sum())}
    R["missing_rows"] = miss
    wjson(os.path.join(CACHE, "verify.json"), R)
    doc = json.load(open(OUT_JSON))
    doc["verification"] = R
    tmp = OUT_JSON + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(doc, fh, separators=(",", ":"), default=float)
    os.replace(tmp, OUT_JSON)
    log(json.dumps(R, indent=1, default=float))


STAGES["verify"] = stage_verify


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("stage", choices=list(STAGES) + ["all"])
    ap.add_argument("--boot", type=int, default=2000)
    a = ap.parse_args()
    order = ["build", "timing", "q1", "stacks", "beyond", "addendum", "export"] if a.stage == "all" else [a.stage]
    for s in order:
        log("== stage %s" % s)
        STAGES[s](a)


if __name__ == "__main__":
    main()
