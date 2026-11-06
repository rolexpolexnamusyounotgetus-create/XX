#!/usr/bin/env python3
"""Calibration and drift (task key: calib): how calibration slopes drift year to year, which recalibration (if any)
survives time-ordered CV before 2024, and a tested recalibration function for the forward package and predict().

    nice -n 5 python3 tools/calib.py table      # per-fight predictions 2010-2025 (2026 dropped at parse)
    nice -n 5 python3 tools/calib.py drift      # (1) year-by-year calibration slopes 2012-2023 per model family
    nice -n 5 python3 tools/calib.py cv         # (2) rolling-origin CV of recalibration schemes, <= 2023 only
    nice -n 5 python3 tools/calib.py prereg     # freeze the chosen scheme per head BEFORE 2024-25 is read
    nice -n 5 python3 tools/calib.py confirm    # (3) score the pre-registered choice once on 2024-2025
    nice -n 5 python3 tools/calib.py rule       # (4) the pre-registered production drift rule: replay + simulation
    nice -n 5 python3 tools/calib.py export     # data/derived/calib.json (+ JS test vectors for src/ml/calib.js)
    nice -n 5 python3 tools/calib.py all        # everything in order
    node tests/test_calib.js                    # JS evaluator / fitter vs the Python vectors, corner symmetry

Protocol (docs/BACKLOG.md "Evaluation rule" and "Hidden-data protocol"; the task brief):
  * Every fight dated 2026-01-01 or later is dropped at parse: the inputs are tools/ml2.py's verified caches
    (its table is built from build_db.parse_fights wrapped to drop 2026+, asserted again here) and nlbair rows
    with event_date < 2026-01-01. Nothing here reads, fits or scores a 2026 fight.
  * Every choice (scheme, half-life, window, prior, segments, whether anything is adopted) is made by time-ordered
    CV on fights before 2024: hyper-parameters on the rolling origins 2016-2020, the adoption gate on the
    forward-chained years 2021-2023 with ml2's 0.0005 rule. The drift and cv stages assert that no row dated 2024+
    enters a fit or a score.
  * 2024-01-01..2025-12-31 is scored once, by the confirm stage, only for what the prereg stage froze.
  * Corner symmetry: every recalibration is an odd function of the logit with corner-symmetric segment flags and no
    intercept; a swap test is asserted at every fit stage. Event-cluster bootstrap CIs, 2,000 resamples of cards,
    paired for differences.
"""
import os

for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):   # the box is shared and busy
    os.environ.setdefault(_v, "1")
import argparse
import datetime as dt
import hashlib
import json
import math
import pickle
import sys
import time
import warnings

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")
HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
ROOT = os.path.dirname(HERE)
DERIVED = os.path.join(ROOT, "data", "derived")
ML2_CACHE = os.environ.get("ML2_CACHE", os.path.join(ROOT, "out", "ml2_cache"))
CACHE = os.environ.get("CALIB_CACHE", os.path.join(ROOT, "out", "calib_cache"))
OUT_JSON = os.path.join(DERIVED, "calib.json")
PREREG_JSON = os.path.join(DERIVED, "calib_prereg.json")
VAULT_S = "2026-01-01"
VALID_FROM = 2024                 # 2024-2025: confirm stage only
TOOL = "tools/calib.py 1.0 (2026-11-06)"
SEL_MIN = 0.0005                  # ml2's selection rule
PCLIP = 0.01                      # expert probabilities clipped before logits in the stacks (= tools/ml2.py / moe)
os.makedirs(CACHE, exist_ok=True)


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def sig(z):
    return 1.0 / (1.0 + np.exp(-np.asarray(z, float)))


def logit(p, c=1e-6):
    p = np.clip(np.asarray(p, float), c, 1 - c)
    return np.log(p / (1 - p))


def ll_vec(p, y):
    p = np.clip(np.asarray(p, float), 1e-6, 1 - 1e-6)
    y = np.asarray(y, float)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


def ll(p, y):
    return float(np.mean(ll_vec(p, y)))


def r5(x):
    return None if x is None or not np.isfinite(x) else round(float(x), 5)


def sha16(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()[:16]


# ====================================================================== the recalibration core (shared with JS)
# A recalibration maps the raw logit z of P(A wins) to z' = theta . phi(z, s), where every column of phi is odd in z
# (z, z|z|, z * flag) and the flags are corner-symmetric fight properties, so p'(B, A) = 1 - p'(A, B) exactly and
# there is no intercept. Kinds:
#   none         z' = z
#   temperature  z' = a z                          (symmetric beta calibration: a = b, c = 0)
#   odd          z' = a z + b z |z|                (lets big favourites stretch differently from pick'ems)
#   segment      z' = (a + sum_k d_k s_k) z        (s_k in {0,1}: women, heavy, newcomer, five, bigfav)
SEGMENTS = ("women", "heavy", "newcomer", "debut", "five", "bigfav")
BIGFAV_P = 0.75                   # bigfav flag: the raw (pre-recalibration) favourite is at 75% or more


def seg_flags(women, lbs, n_min, five, p_raw):
    """Corner-symmetric segment flags for one fight. heavy = men 205 lb and up; newcomer = the less experienced man has
    1-2 prior UFC fights; debut = one man has none (never set in the backtest universe, which excludes debut bouts);
    five = scheduled five rounds; bigfav = the raw (pre-recalibration) favourite is at 75% or more."""
    w = 1.0 if women else 0.0
    n = None if n_min is None else float(n_min)
    return {"women": w, "heavy": 1.0 if (not women and lbs is not None and lbs >= 205) else 0.0,
            "newcomer": 1.0 if (n is not None and 1 <= n <= 2) else 0.0, "debut": 1.0 if n == 0 else 0.0,
            "five": 1.0 if five else 0.0, "bigfav": 1.0 if max(p_raw, 1 - p_raw) >= BIGFAV_P else 0.0}


def seg_matrix(D, p_raw):
    """n x len(SEGMENTS) flag matrix for table rows (bigfav from the raw prediction p_raw; NaN p -> 0)."""
    nm = D["n_min"].to_numpy(float)
    pr = np.nan_to_num(np.asarray(p_raw, float), nan=0.5)
    cols = {"women": D["women"].to_numpy(float),
            "heavy": ((D["women"].to_numpy(float) == 0) & (D["lbs"].to_numpy(float) >= 205)).astype(float),
            "newcomer": ((nm >= 1) & (nm <= 2)).astype(float), "debut": (nm == 0).astype(float),
            "five": D["five"].to_numpy(float), "bigfav": (np.maximum(pr, 1 - pr) >= BIGFAV_P).astype(float)}
    return np.c_[tuple(cols[s] for s in SEGMENTS)]


def design(kind, z, S=None, segs=SEGMENTS):
    """phi(z, s) as an n x k matrix. S: n x len(SEGMENTS) flags (segment kind only)."""
    z = np.asarray(z, float)
    if kind == "temperature":
        return z[:, None]
    if kind == "odd":
        return np.c_[z, z * np.abs(z)]
    if kind == "segment":
        cols = [z] + [z * S[:, SEGMENTS.index(s)] for s in segs]
        return np.c_[tuple(cols)]
    raise ValueError(kind)


def prior_of(kind, sd_a, sd_b, segs=SEGMENTS):
    """Gaussian prior (mean, precision) per parameter: a ~ N(1, sd_a^2); b, d_k ~ N(0, sd_b^2). sd None = flat."""
    prec = lambda sd: 0.0 if sd is None else 1.0 / (sd * sd)
    if kind == "temperature":
        return np.array([1.0]), np.array([prec(sd_a)])
    if kind == "odd":
        return np.array([1.0, 0.0]), np.array([prec(sd_a), prec(sd_b)])
    if kind == "segment":
        k = len(segs)
        return np.r_[1.0, np.zeros(k)], np.r_[prec(sd_a), np.full(k, prec(sd_b))]
    raise ValueError(kind)


def fit_glm(X, y, w, m0, prec, iters=50):
    """MAP of a no-intercept logistic: minimise sum w_i [log(1 + e^{x_i.t}) - y_i x_i.t] + 0.5 sum prec_j (t_j - m0_j)^2
    by Newton with step halving. w are per-fight weights (1 = one fight), so prec is in fight units."""
    X = np.asarray(X, float)
    y = np.asarray(y, float)
    w = np.asarray(w, float)
    t = np.array(m0, float)
    P = np.diag(prec)

    def obj(t):
        q = X @ t
        return float(np.sum(w * (np.logaddexp(0, q) - y * q)) + 0.5 * np.sum(prec * (t - m0) ** 2))
    f = obj(t)
    for _ in range(iters):
        q = X @ t
        p = sig(q)
        g = X.T @ (w * (p - y)) + prec * (t - m0)
        H = (X * (w * p * (1 - p))[:, None]).T @ X + P + 1e-9 * np.eye(len(t))
        step = np.linalg.solve(H, g)
        s = 1.0
        while s > 1e-6:
            tn = t - s * step
            fn = obj(tn)
            if fn <= f + 1e-12:
                break
            s *= 0.5
        if abs(f - fn) < 1e-11 and np.max(np.abs(tn - t)) < 1e-9:
            t, f = tn, fn
            break
        t, f = tn, fn
    return t


def window_weights(ages_years, half_life=None, max_age=None):
    """Weights for history rows aged `ages_years` (> 0) at the fit date: 0.5^(age / half_life), 0 beyond max_age."""
    a = np.asarray(ages_years, float)
    w = np.ones(len(a)) if not half_life else 0.5 ** (a / half_life)
    if max_age is not None:
        w = np.where(a <= max_age, w, 0.0)
    return w


def fit_spec(kind, z, y, ages_years, S=None, half_life=None, max_age=None, last_n=None, sd_a=None, sd_b=0.25,
             segs=SEGMENTS, min_n=60):
    """Fit a recalibration on history rows (raw out-of-sample logits z, outcomes y, ages in years at the fit date).
    Returns a spec dict usable by apply_spec (JSON-serialisable). Falls back to 'none' with fewer than min_n rows."""
    if kind == "none":
        return {"type": "none"}
    z = np.asarray(z, float)
    y = np.asarray(y, float)
    a = np.asarray(ages_years, float)
    keep = a > 0
    if last_n:
        order = np.argsort(a, kind="stable")
        keep = np.zeros(len(a), bool)
        keep[order[:last_n]] = True
        keep &= a > 0
    w = window_weights(a, half_life, max_age) * keep
    if (w > 0).sum() < min_n:
        return {"type": "none", "reason": "fewer than %d history rows" % min_n}
    X = design(kind, z, S, segs)
    m0, prec = prior_of(kind, sd_a, sd_b, segs)
    th = fit_glm(X[w > 0], y[w > 0], w[w > 0], m0, prec)
    spec = {"type": kind, "a": float(th[0]), "n_eff": float(w.sum())}
    if kind == "odd":
        spec["b"] = float(th[1])
    if kind == "segment":
        spec["d"] = {s: float(th[1 + i]) for i, s in enumerate(segs)}
    return spec


def apply_spec(spec, p, flags=None):
    """Recalibrated P(A) for raw P(A) p (scalar or array). flags: dict or n x len(SEGMENTS) array (segment kind)."""
    t = spec.get("type", "none") if spec else "none"
    scalar = np.ndim(p) == 0
    pa = np.atleast_1d(np.asarray(p, float))
    if t == "none":
        out = pa
    else:
        z = logit(pa, 1e-12)
        if t == "temperature":
            zz = spec["a"] * z
        elif t == "odd":
            zz = spec["a"] * z + spec["b"] * z * np.abs(z)
        elif t == "segment":
            if isinstance(flags, dict):
                F = np.array([[flags.get(s, 0.0) for s in SEGMENTS]] * len(pa))
            else:
                F = np.atleast_2d(np.asarray(flags, float))
            mult = spec["a"] + sum(spec["d"].get(s, 0.0) * F[:, i] for i, s in enumerate(SEGMENTS))
            zz = mult * z
        else:
            raise ValueError(t)
        out = sig(zz)
    return float(out[0]) if scalar else out


def calib_slope(p, y):
    """Mirrored calibration slope (no intercept by mirroring): y ~ b * logit(p) on both orientations. 1 = calibrated,
    > 1 underconfident. Same as tools/ml.py calib_slope's slope (its mirrored intercept is 0 by construction)."""
    z = logit(p)
    return float(fit_glm(z[:, None], y, np.ones(len(z)), np.array([1.0]), np.array([0.0]))[0])


# ====================================================================== bootstrap (event clusters)
class Boot:
    """2,000 resamples of event clusters (cards). Same draws for every statistic on the same row set."""
    def __init__(self, groups, n=2000, seed=7):
        self.g = pd.Series(list(groups)).astype("category").cat.codes.to_numpy()
        self.G = int(self.g.max()) + 1
        rng = np.random.default_rng(seed)
        self.W = np.stack([np.bincount(rng.integers(0, self.G, self.G), minlength=self.G) for _ in range(n)]).astype(float)

    def means(self, arrays):
        A = np.vstack([np.asarray(a, float) for a in arrays]).T
        S = np.zeros((self.G, A.shape[1]))
        np.add.at(S, self.g, A)
        C = np.bincount(self.g, minlength=self.G).astype(float)
        return (self.W @ S) / (self.W @ C)[:, None]

    def slope_ci(self, p, y, n=400):
        """Percentile CI of the mirrored slope over the first n resamples (refit per resample)."""
        z = logit(p)
        out = []
        for b in range(min(n, len(self.W))):
            w = self.W[b][self.g]
            out.append(float(fit_glm(z[:, None], y, w, np.array([1.0]), np.array([0.0]))[0]))
        return [round(float(np.percentile(out, 2.5)), 3), round(float(np.percentile(out, 97.5)), 3)]


def ci(v):
    return [round(float(np.percentile(v, 2.5)), 4), round(float(np.percentile(v, 97.5)), 4)]


def paired(pa, pb, y, groups, n=2000, seed=7):
    la, lb = ll_vec(pa, y), ll_vec(pb, y)
    B = Boot(groups, n, seed)
    bs = B.means([la, lb, la - lb])
    return {"n": int(len(y)), "a": r5(la.mean()), "b": r5(lb.mean()), "diff": r5((la - lb).mean()),
            "diff_ci": ci(bs[:, 2]), "p_a_better": round(float(np.mean(bs[:, 2] < 0)), 3)}


# ====================================================================== stage: table
FAMILIES = {   # column -> what it is (all P(A wins | decisive), walk-forward or out of fold)
    "elo": "walk-forward Elo (tools/ml.py, 400 scale)",
    "elo_sig": "strike-share margin Elo (tools/ml.py)",
    "whr": "round-level WHR (tools/ratings.py tuned parameters, rerun by tools/ml2.py)",
    "glicko2": "Glicko-2 (tools/ratings.py)",
    "elo_full": "Elo-full (tools/ratings.py)",
    "trueskill": "TrueSkill with method outcomes (tools/ratings.py)",
    "mkt_rating": "Kalman market rating on earlier closing lines (tools/market.py, rebuilt by tools/ml2.py from 2013)",
    "ml1": "ML v1 logistic (tools/ml.py's 80 base terms, annual expanding refit 2012-2023; static fit < 2024 after)",
    "ml2lr": "ML v2 logistic (tools/ml2.py, annual expanding refit 2012-2023; static fit < 2024 after)",
    "ml2": "ML v2 blend LR + LightGBM + XGBoost (tools/ml2.py OOF 2019-2023; static after)",
    "close": "closing line: market.json power de-vig consensus for dev fights 2019+, nlbair (BFO) no-vig close before",
    "open": "opening line: market.json multiplicative no-vig for dev fights 2019+, nlbair (BFO) no-vig open before",
}


def stage_table(args):
    T = pickle.load(open(os.path.join(ML2_CACHE, "table.pkl"), "rb"))["df"]
    F = pickle.load(open(os.path.join(ML2_CACHE, "fit.pkl"), "rb"))
    assert list(F["fid"]) == T["fid"].tolist(), "ml2 fit.pkl rows differ from table.pkl"
    assert str(T["date"].max()) < VAULT_S, "ml2 table holds a fight dated 2026 or later"
    mk = json.load(open(os.path.join(DERIVED, "market.json")))["fights"]
    nl = pd.read_csv(os.path.join(ROOT, "data", "raw", "odds", "nlbair_odds.csv"), low_memory=False)
    nl = nl[nl["event_date"] < VAULT_S].drop_duplicates("fight_id").set_index("fight_id")   # vault dropped at parse
    keep = T["y"].notna().to_numpy() & ~T["amb"].astype(bool).to_numpy()
    D = pd.DataFrame({"fid": T["fid"], "date": T["date"].astype(str), "year": T["year"].astype(int),
                      "event": T["event"].astype(str), "y": T["y"], "nA": T["nA"], "nB": T["nB"],
                      "women": T["women"].astype(float), "lbs": T["lbs"].astype(float), "five": T["five"].astype(float),
                      "title": T["title"].astype(float), "division": T["division"], "evalrow": T["evalrow"].astype(bool)})
    D["n_min"] = np.minimum(D["nA"], D["nB"])
    D["elo"] = 1 / (1 + 10 ** (-(T["A_elo"] - T["B_elo"]).to_numpy() / 400))
    D["elo_sig"] = 1 / (1 + 10 ** (-(T["A_elo_sig"] - T["B_elo_sig"]).to_numpy() / 400))
    for c, src in (("whr", "r_whr_rounds"), ("glicko2", "r_glicko2"), ("elo_full", "r_elo_full"),
                   ("trueskill", "r_trueskill_mov")):
        D[c] = T[src].to_numpy(float)
    D["mkt_rating"] = T["mr_p"].to_numpy(float)
    pr = F["preds"]
    yr = D["year"].to_numpy()
    va = yr >= VALID_FROM
    for c, key in (("ml1", "lr_base"), ("ml2lr", "lr"), ("ml2", "blend")):
        oof = np.asarray(pr[key + "|oof"], float)
        st = np.asarray(pr[key + "|static"], float)
        ro = np.asarray(pr[key + "|roll"], float)
        D[c] = np.where(va, st, oof)
        D[c + "_roll"] = np.where(va, ro, np.nan)
    close, opn, src = [], [], []
    for f in D["fid"]:
        m = mk.get(f, {})
        if m.get("p_power_close") is not None:
            close.append(m["p_power_close"])
            opn.append(m.get("p_novig_open"))
            src.append("market.json")
        elif f in nl.index and bool(nl.at[f, "has_odds"]):
            close.append(nl.at[f, "f1_close_prob_novig"])
            opn.append(nl.at[f, "f1_open_prob_novig"])
            src.append("nlbair")
        else:
            close.append(np.nan)
            opn.append(np.nan)
            src.append(None)
    D["close"] = pd.to_numeric(pd.Series(close), errors="coerce").to_numpy()
    D["open"] = pd.to_numeric(pd.Series(opn), errors="coerce").to_numpy()
    D["line_src"] = src
    D = D[keep].reset_index(drop=True)
    assert D["date"].max() < VAULT_S
    # corner symmetry of the inputs: every family is a function of A-minus-B quantities; the swap test for the
    # recalibrations is asserted in the cv stage. Here: no column may be constant 0.5 or exceed (0, 1).
    for c in FAMILIES:
        v = D[c].to_numpy(float)
        v = v[np.isfinite(v)]
        assert ((v > 0) & (v < 1)).all(), c
    pickle.dump(D, open(os.path.join(CACHE, "table.pkl"), "wb"))
    cov = D.groupby("year").apply(lambda g: {c: int(g[c].notna().sum()) for c in FAMILIES} | {"n": len(g),
                                  "eval": int(g["evalrow"].sum())}).to_dict()
    json.dump({str(k): v for k, v in cov.items()}, open(os.path.join(CACHE, "table_coverage.json"), "w"), indent=1)
    log("table: %d decisive fights %s..%s (%d backtest-universe rows); coverage by year in %s" % (
        len(D), D["date"].min(), D["date"].max(), int(D["evalrow"].sum()), os.path.join(CACHE, "table_coverage.json")))
    for y0 in sorted(cov):
        log("  %d %s" % (y0, cov[y0]))


def load_table():
    return pickle.load(open(os.path.join(CACHE, "table.pkl"), "rb"))


def train_only(D):
    """Rows the drift / cv stages may touch: dated before 2024-01-01 (asserted by callers)."""
    return D[D["year"] < VALID_FROM].reset_index(drop=True)


# ====================================================================== stacks (tools/ml2.py's stack code)
HEAD_STACKS = {   # head -> (regime, ml2 STACKS name, inputs, ml2's CV-chosen half-life)
    "noline": ("noline", "page: ml2lr+mkt_rating", ["ml2lr", "mkt_rating"], 1.5),
    "open": ("open", "page: open+ml2lr", ["open", "ml2lr"], None),
    "line": ("line", "page: market+ml2lr", ["close", "ml2lr"], None),
}
_ML2 = None


def ml2mod():
    """tools/ml2.py, imported lazily (its import wraps build_db.parse_fights to drop 2026+)."""
    global _ML2
    if _ML2 is None:
        import ml2 as _m
        _ML2 = _m
    return _ML2


def zcols(D, cols):
    """Stack design: logit(clip(p, 0.01, 0.99)), absent inputs enter as 0 (= tools/ml2.py zmat)."""
    return np.c_[[np.nan_to_num(logit(np.clip(D[c].to_numpy(float), PCLIP, 1 - PCLIP), 1e-6)) for c in cols]].T


def head_rows(D, head):
    """Rows a head can predict: backtest universe, its inputs present (absent mkt_rating enters as 0 like ml2)."""
    ok = D["evalrow"].to_numpy() & D["ml2lr"].notna().to_numpy()
    if head == "open":
        ok &= D["open"].notna().to_numpy()
    if head == "line":
        ok &= D["close"].notna().to_numpy()
    if head in ("noline",):
        ok &= D["year"].to_numpy() >= 2013          # the market rating starts in 2013
    return ok


def stack_annual(D, cols, h, rows_ok, years, hist_from=2013):
    """Forward-chained annual stack: year Y predicted by weights fit on rows_ok & hist_from <= year <= Y-1 with ml2's
    calendar-year recency weights 0.5^((Y - year) / h). Returns (P, {Y: weights})."""
    M2 = ml2mod()
    Z = zcols(D, cols)
    y = D["y"].to_numpy(float)
    yr = D["year"].to_numpy()
    P = np.full(len(D), np.nan)
    W = {}
    for Y in years:
        tr = rows_ok & (yr >= hist_from) & (yr <= Y - 1)
        if tr.sum() < 100:
            continue
        b = M2.stack_fit(Z[tr], y[tr], M2.rec_w(yr[tr], Y, h))
        m = rows_ok & (yr == Y)
        P[m] = sig(Z[m] @ b)
        W[Y] = b
    return P, W


def card_dates(D, rows):
    return sorted(set(D.loc[rows, "date"]))


def ages(dates, at):
    """Age in years of ISO dates relative to ISO date `at`."""
    a = np.array([dt.date.fromisoformat(d).toordinal() for d in dates], float)
    return (dt.date.fromisoformat(at).toordinal() - a) / 365.25


def stack_percard(D, cols, h, rows_ok, years, hist_from=2013):
    """Stack refit before every card on all rows_ok fights dated strictly before the card, recency by exact age."""
    M2 = ml2mod()
    Z = zcols(D, cols)
    y = D["y"].to_numpy(float)
    yr = D["year"].to_numpy()
    dord = np.array([dt.date.fromisoformat(d).toordinal() for d in D["date"]], float)
    P = np.full(len(D), np.nan)
    tgt = rows_ok & np.isin(yr, list(years))
    for d in card_dates(D, tgt):
        do = dt.date.fromisoformat(d).toordinal()
        tr = rows_ok & (yr >= hist_from) & (dord < do)
        m = tgt & (D["date"].to_numpy() == d)
        if tr.sum() < 100:
            continue
        a = (do - dord[tr]) / 365.25
        b = M2.stack_fit(Z[tr], y[tr], window_weights(a, h))
        P[m] = sig(Z[m] @ b)
    return P


# ====================================================================== stage: drift
def year_stats(p, y, g, boot_n=400):
    B = Boot(g, max(boot_n, 1), seed=11)
    return {"n": int(len(y)), "log_loss": r5(ll(p, y)), "slope": round(calib_slope(p, y), 3),
            "slope_ci": B.slope_ci(p, y, boot_n)}


def trailing_temperature(D, col, rows, years, lookback):
    """Rolling origin: year Y's predictions rescaled by the mirrored slope fit on the same column's out-of-sample
    predictions in years Y-lookback..Y-1 (all known before Y). Returns rescaled P and {Y: a}."""
    p = D[col].to_numpy(float)
    y = D["y"].to_numpy(float)
    yr = D["year"].to_numpy()
    out = np.full(len(D), np.nan)
    A = {}
    for Y in years:
        h = rows & (yr >= Y - lookback) & (yr <= Y - 1) & np.isfinite(p)
        m = rows & (yr == Y) & np.isfinite(p)
        if h.sum() < 150 or not m.any():
            continue
        a = calib_slope(p[h], y[h])
        A[Y] = round(a, 3)
        out[m] = sig(a * logit(p[m]))
    return out, A


def stage_drift(args):
    D0 = load_table()
    D = train_only(D0)
    assert D["year"].max() <= 2023 and D["date"].max() < "2024-01-01"
    y = D["y"].to_numpy(float)
    yr = D["year"].to_numpy()
    ev = D["evalrow"].to_numpy()
    # stacks, forward-chained annual on the long history (fit 2013..Y-1, predict Y)
    years = list(range(2014, 2024))
    for head, (_, _, cols, h) in HEAD_STACKS.items():
        D["stack_" + head], _ = stack_annual(D, cols, h, head_rows(D, head), years)
    fams = list(FAMILIES) + ["stack_" + k for k in HEAD_STACKS]
    R = {"universe": "backtest universe (both men had a prior UFC fight), decisive, 2012-2023", "by_year": {},
         "pooled": {}, "trailing": {}, "notes": {}}
    for c in fams:
        p = D[c].to_numpy(float)
        R["by_year"][c] = {}
        for Y in range(2010, 2024):
            m = ev & (yr == Y) & np.isfinite(p)
            if m.sum() < 120:
                continue
            R["by_year"][c][str(Y)] = year_stats(p[m], y[m], D["event"].to_numpy()[m], args.boot_slope)
        m = ev & (yr >= 2012) & np.isfinite(p)
        R["pooled"][c] = {"n": int(m.sum()), "slope": round(calib_slope(p[m], y[m]), 3), "log_loss": r5(ll(p[m], y[m]))}
        sl = [v["slope"] for v in R["by_year"][c].values()]
        log("%-14s %s" % (c, " ".join("%s:%.2f" % (k[2:], v["slope"]) for k, v in R["by_year"][c].items())))
    # persistence: does last year's (or the last two years') miscalibration predict this year's?
    pers = {}
    for c in fams:
        s = {int(k): v["slope"] for k, v in R["by_year"][c].items()}
        ys = sorted(s)
        pairs = [(math.log(s[Y - 1]), math.log(s[Y])) for Y in ys if Y - 1 in s]
        if len(pairs) >= 6:
            a, b = np.array(pairs).T
            pers[c] = {"n_pairs": len(pairs), "corr_log_slope_lag1": round(float(np.corrcoef(a, b)[0, 1]), 3),
                       "sd_log_slope": round(float(np.std(np.log(list(s.values())))), 3)}
    R["persistence"] = pers
    # sampling noise of a one-year slope: median CI half-width in log units vs the observed spread
    for c in fams:
        hw = [math.log(v["slope_ci"][1] / v["slope_ci"][0]) / 2 / 1.96 for v in R["by_year"][c].values()
              if v["slope_ci"][0] > 0]
        if c in pers and hw:
            pers[c]["median_sampling_sd_log_slope"] = round(float(np.median(hw)), 3)
            ex = pers[c]["sd_log_slope"] ** 2 - float(np.median(hw)) ** 2
            pers[c]["excess_sd_log_slope"] = round(math.sqrt(ex), 3) if ex > 0 else 0.0
    # co-movement across families: correlation of yearly log slopes, 2014-2023 (years every family covers)
    common = [c for c in fams if all(str(Y) in R["by_year"][c] for Y in range(2014, 2024))]
    Mx = np.array([[math.log(R["by_year"][c][str(Y)]["slope"]) for Y in range(2014, 2024)] for c in common])
    Mc = Mx - Mx.mean(1, keepdims=True)
    u, sv, vt = np.linalg.svd(Mc, full_matrices=False)
    R["comovement"] = {"families": common, "years": list(range(2014, 2024)),
                       "pc1_share": round(float(sv[0] ** 2 / np.sum(sv ** 2)), 3),
                       "pc1_year_scores": [round(float(x), 3) for x in vt[0] * sv[0]],
                       "mean_log_slope_by_year": {str(Y): round(float(Mx[:, i].mean()), 3) for i, Y in
                                                  enumerate(range(2014, 2024))}}
    # rolling-origin trailing temperature per family (does exploiting last year's slope help this year?)
    tyears = list(range(2014, 2024))
    for c in fams:
        rows = ev & np.isfinite(D[c].to_numpy(float))
        R["trailing"][c] = {}
        for lb in (1, 2, 4):
            pt, A = trailing_temperature(D, c, rows, tyears, lb)
            m = rows & np.isfinite(pt)
            if m.sum() < 300:
                continue
            for lab, mm in (("2014-2023", m), ("2016-2020", m & (yr >= 2016) & (yr <= 2020)),
                            ("2021-2023", m & (yr >= 2021))):
                if mm.sum() < 200:
                    continue
                cmp_ = paired(pt[mm], D[c].to_numpy(float)[mm], y[mm], D["event"].to_numpy()[mm], args.boot)
                R["trailing"][c].setdefault("lookback_%d" % lb, {})[lab] = cmp_
            R["trailing"][c]["lookback_%d" % lb]["a_by_year"] = A
        t = R["trailing"][c].get("lookback_1", {}).get("2014-2023")
        if t:
            log("%-14s trailing-1y temperature vs raw 2014-2023 %+.5f %s" % (c, t["diff"], t["diff_ci"]))
    R["notes"] = {
        "ratings_tuned_2019_2023": "the rating systems' scale parameters (and the market rating's) were tuned by their "
                                   "own tools on 2019-2023, so their 2019-2023 slopes are near 1 partly by construction; "
                                   "2012-2018 is the cleaner view of their drift",
        "ml_oof": "ML v1/v2 2012-2023 rows are annual expanding refits (out of fold); ML v2's blocks, penalty and "
                  "rating parameters were chosen on CV years 2016-2023, a mild optimism that does not touch 2024+",
        "stacks": "stack_<head> = tools/ml2.py's page stacks refit each year on 2013..Y-1 (long history), ml2's "
                  "half-lives (no line 1.5 y; open / line none)",
        "line_source": "close/open before 2019 (and non-dev fights) come from nlbair (BFO no-vig); 2019+ dev fights "
                       "from market.json (power de-vig consensus close, multiplicative no-vig open)"}
    json.dump(R, open(os.path.join(CACHE, "drift.json"), "w"), indent=1)
    log("comovement: PC1 share %.2f; mean log slope by year %s" % (R["comovement"]["pc1_share"],
                                                                    R["comovement"]["mean_log_slope_by_year"]))
    for c, v in pers.items():
        log("persistence %-14s %s" % (c, v))


# ====================================================================== stage: cv (rolling origin, <= 2023)
H_GRID = [None, 8.0, 4.0, 3.0, 2.0, 1.5, 1.0, 0.75, 0.5]
HEADS = ("noline", "open", "line", "ml2lr")
INNER = (2016, 2020)               # hyper-parameters chosen on these rolling origins
GATE = (2021, 2023)                # adoption gate: forward-chained years (ml2's stack gate), 0.0005 rule
INCUMBENT = {"noline": "ml2 page stack ml2lr + mkt_rating, h 1.5, fit 2019..Y-1 (tools/ml2.py stage_stack)",
             "open": "ml2 page stack open + ml2lr, no recency, fit 2019..Y-1",
             "line": "ml2 page stack close + ml2lr, no recency, fit 2019..Y-1",
             "ml2lr": "ML v2 logistic as published (annual expanding refit), no recalibration"}


def scheme_grid():
    G = []
    for h in H_GRID:
        G.append(("recency", {"h": h}))
    for h in H_GRID:
        G.append(("percard", {"h": h}))
    for hl in (0.5, 1.0, 2.0, 4.0, 8.0):
        for sd in (None, 0.3, 0.15, 0.08):
            G.append(("temp", {"half_life": hl, "sd_a": sd}))
    for n in (200, 400, 800):
        for sd in (None, 0.15):
            G.append(("temp", {"last_n": n, "sd_a": sd}))
    for lb in (1.0, 2.0, 4.0):
        G.append(("temp_annual", {"max_age": lb}))
    for hl in (1.0, 2.0, 4.0, 8.0):
        for sd_b in (0.05, 0.15):
            for sd_a in (None, 0.15):
                G.append(("odd", {"half_life": hl, "sd_a": sd_a, "sd_b": sd_b}))
    allseg = tuple(SEGMENTS)
    for hl in (2.0, 8.0, None):
        for sd_b in (0.05, 0.1, 0.2):
            for sd_a in (0.15, None):
                G.append(("segment", {"segs": allseg, "half_life": hl, "sd_a": sd_a, "sd_b": sd_b}))
    for sg in ("women", "heavy", "newcomer", "five", "bigfav"):
        for hl in (8.0, None):
            for sd_b in (0.1, 0.2):
                G.append(("segment", {"segs": (sg,), "half_life": hl, "sd_a": 0.15, "sd_b": sd_b}))
    return G


def cfg_label(fam, cfg):
    return fam + "|" + ",".join("%s=%s" % (k, ("+".join(v) if isinstance(v, tuple) else v)) for k, v in sorted(cfg.items()))


class Pipe:
    """Per-head base predictions and scheme predictions on one table (any orientation)."""
    def __init__(self, D, universe="backtest"):
        self.D = D
        self.y = D["y"].to_numpy(float)
        self.yr = D["year"].to_numpy()
        self.dates = D["date"].to_numpy()
        self.dord = np.array([dt.date.fromisoformat(d).toordinal() for d in self.dates], float)
        self.universe = universe
        self.base = {}

    def rows(self, head):
        if head == "ml2lr":
            ok = self.D["ml2lr"].notna().to_numpy()
        else:
            ok = head_rows(self.D, head) if self.universe == "backtest" else self._rows_all(head)
        return ok & (self.D["evalrow"].to_numpy() if self.universe == "backtest" else True)

    def _rows_all(self, head):
        ok = self.D["ml2lr"].notna().to_numpy() & (self.yr >= 2013)
        if head == "open":
            ok &= self.D["open"].notna().to_numpy()
        if head == "line":
            ok &= self.D["close"].notna().to_numpy()
        return ok

    def cols(self, head):
        return ["ml2lr"] if head == "ml2lr" else HEAD_STACKS[head][2]

    def h0(self, head):
        return None if head == "ml2lr" else HEAD_STACKS[head][3]

    def base_long(self, head, years):
        """Out-of-sample base predictions: the head's stack refit each year on 2013..Y-1 with ml2's half-life (the
        ML v2 logistic as published for the ml2lr head)."""
        key = (head, tuple(years))
        if key not in self.base:
            if head == "ml2lr":
                P = self.D["ml2lr"].to_numpy(float).copy()
                P[~self.rows(head)] = np.nan
            else:
                P, _ = stack_annual(self.D, self.cols(head), self.h0(head), self.rows(head), years, 2013)
            self.base[key] = P
        return self.base[key]

    def incumbent(self, head, years):
        if head == "ml2lr":
            return self.base_long(head, years)
        P, _ = stack_annual(self.D, self.cols(head), self.h0(head), self.rows(head), years, 2019)
        return P

    def recal(self, base, rows, years, kind, cfg, S, annual=False):
        """Walk-forward recalibration of `base` (out-of-sample logits) refit before every card (or every Jan 1) on all
        rows with a finite base prediction dated strictly before it."""
        out = np.full(len(base), np.nan)
        z = logit(base)
        fin = rows & np.isfinite(base)
        tgt = fin & np.isin(self.yr, list(years))
        keys = sorted(set(self.dates[tgt])) if not annual else ["%d-01-01" % Y for Y in years]
        kw = dict(cfg)
        segs = kw.pop("segs", SEGMENTS)
        for d in keys:
            do = dt.date.fromisoformat(d).toordinal()
            h = fin & (self.dord < do)
            m = tgt & ((self.dates == d) if not annual else (self.yr == int(d[:4])))
            if not m.any():
                continue
            a = (do - self.dord[h]) / 365.25
            spec = fit_spec(kind, z[h], self.y[h], a, S[h] if S is not None else None, segs=segs, **kw)
            out[m] = apply_spec(spec, base[m], S[m] if S is not None else None)
        return out

    def scheme(self, head, fam, cfg, years):
        rows = self.rows(head)
        yrs_base = list(range(2014, max(years) + 1))
        if fam == "recency":
            P, _ = stack_annual(self.D, self.cols(head), cfg["h"], rows, years, 2013) if head != "ml2lr" else \
                stack_annual(self.D, ["ml2lr"], cfg["h"], rows, years, 2012)
            return P
        if fam == "percard":
            return stack_percard(self.D, self.cols(head), cfg["h"], rows, years, 2013 if head != "ml2lr" else 2012)
        base = self.base_long(head, yrs_base)
        S = seg_matrix(self.D, base)
        if fam == "temp":
            return self.recal(base, rows, years, "temperature", cfg, S)
        if fam == "temp_annual":
            return self.recal(base, rows, years, "temperature", {"max_age": cfg["max_age"]}, S, annual=True)
        if fam == "odd":
            return self.recal(base, rows, years, "odd", cfg, S)
        if fam == "segment":
            return self.recal(base, rows, years, "segment", cfg, S)
        raise ValueError(fam)


def swapped_table(D):
    """The same fights with corners swapped: every P(A) -> 1 - P(A), y -> 1 - y; fight-level flags unchanged."""
    E = D.copy()
    for c in list(FAMILIES) + [c + "_roll" for c in ("ml1", "ml2lr", "ml2")]:
        if c in E:
            E[c] = 1.0 - E[c]
    E["y"] = 1.0 - E["y"]
    E["nA"], E["nB"] = D["nB"].to_numpy(), D["nA"].to_numpy()
    return E


def stage_cv(args):
    D0 = load_table()
    D = train_only(D0)
    assert D["year"].max() <= 2023 and D["date"].max() < "2024-01-01"
    pipe = Pipe(D, args.universe)
    years = list(range(INNER[0], GATE[1] + 1))
    y, yr, ev = pipe.y, pipe.yr, D["event"].to_numpy()
    G = scheme_grid()
    R = {"universe": args.universe, "inner": list(INNER), "gate": list(GATE), "sel_min": SEL_MIN, "heads": {},
         "grid_size": len(G), "decision_rule": DECISION_RULE}
    allpreds = {}
    # end-to-end corner-swap test on a subset of schemes (fits see the swapped outcomes too)
    E = swapped_table(D)
    pipe_s = Pipe(E, args.universe)
    sw = {}
    for head in HEADS:
        for fam, cfg in (("recency", {"h": 1.5}), ("percard", {"h": 1.0}), ("temp", {"half_life": 2.0, "sd_a": None}),
                         ("odd", {"half_life": 4.0, "sd_a": None, "sd_b": 0.15}),
                         ("segment", {"segs": tuple(SEGMENTS), "half_life": 8.0, "sd_a": 0.15, "sd_b": 0.1})):
            p1 = pipe.scheme(head, fam, cfg, [2021])
            p2 = pipe_s.scheme(head, fam, cfg, [2021])
            m = np.isfinite(p1)
            sw["%s|%s" % (head, fam)] = float(np.max(np.abs(p1[m] + p2[m] - 1)))
    worst = max(sw.values())
    log("corner-swap test (scheme on swapped corners, 2021): max |p + p_swapped - 1| = %.2e" % worst)
    assert worst < 1e-9, sw
    R["swap_test"] = {"max_abs": worst, "by_scheme": sw}
    for head in HEADS:
        rows = pipe.rows(head)
        inc = pipe.incumbent(head, [2021, 2022, 2023])
        mg = rows & (yr >= GATE[0]) & (yr <= GATE[1])
        mi = rows & (yr >= INNER[0]) & (yr <= INNER[1])
        base = pipe.base_long(head, list(range(2014, 2024)))
        H = {"rows_inner": int(mi.sum()), "rows_gate": int(mg.sum()), "incumbent": INCUMBENT[head],
             "incumbent_gate_ll": r5(ll(inc[mg], y[mg])), "incumbent_gate_slope": round(calib_slope(inc[mg], y[mg]), 3),
             "base_long_inner_ll": r5(ll(base[mi], y[mi])), "base_long_gate_ll": r5(ll(base[mg], y[mg])),
             "configs": {}, "families": {}}
        log("%s: incumbent gate %.5f (slope %.3f); long base inner %.5f gate %.5f" % (
            head, H["incumbent_gate_ll"], H["incumbent_gate_slope"], H["base_long_inner_ll"], H["base_long_gate_ll"]))
        for fam, cfg in G:
            if head == "ml2lr" and fam in ("recency", "percard") and cfg["h"] is None:
                pass
            lab = cfg_label(fam, cfg)
            P = pipe.scheme(head, fam, cfg, years)
            ok_i, ok_g = mi & np.isfinite(P), mg & np.isfinite(P)
            # rows a scheme cannot cover (too little history) keep the base / incumbent prediction
            Pi = np.where(np.isfinite(P), P, base)
            Pg = np.where(np.isfinite(P), P, inc)
            H["configs"][lab] = {"family": fam, "cfg": {k: (list(v) if isinstance(v, tuple) else v) for k, v in cfg.items()},
                                 "inner_ll": r5(ll(Pi[mi], y[mi])), "gate_ll": r5(ll(Pg[mg], y[mg])),
                                 "cover_inner": int(ok_i.sum()), "cover_gate": int(ok_g.sum())}
            allpreds[(head, lab)] = np.where(np.isfinite(P), P, np.nan)
        # per family: inner-chosen config, its gate result vs the incumbent; the gate-best config (ml2-style)
        for fam in dict.fromkeys(f for f, _ in G):
            labs = [l for l, v in H["configs"].items() if v["family"] == fam]
            li = min(labs, key=lambda l: H["configs"][l]["inner_ll"])
            lg = min(labs, key=lambda l: H["configs"][l]["gate_ll"])
            Pg = np.where(np.isfinite(allpreds[(head, li)]), allpreds[(head, li)], inc)
            cmp_inc = paired(Pg[mg], inc[mg], y[mg], ev[mg], args.boot)
            Pgb = np.where(np.isfinite(allpreds[(head, lg)]), allpreds[(head, lg)], inc)
            cmp_best = paired(Pgb[mg], inc[mg], y[mg], ev[mg], args.boot)
            passed = cmp_inc["diff"] < -SEL_MIN and cmp_best["diff"] < -SEL_MIN
            H["families"][fam] = {"inner_choice": li, "inner_choice_inner_ll": H["configs"][li]["inner_ll"],
                                  "inner_choice_vs_incumbent_gate": cmp_inc,
                                  "inner_choice_gate_slope": round(calib_slope(Pg[mg], y[mg]), 3),
                                  "gate_best": lg, "gate_best_vs_incumbent": cmp_best, "passes": bool(passed)}
            log("  %-12s inner choice %-70s gate %+.5f %s | gate-best %+.5f | %s" % (
                fam, li, cmp_inc["diff"], cmp_inc["diff_ci"], cmp_best["diff"], "PASS" if passed else "fail"))
        fams_pass = [f for f, v in H["families"].items() if v["passes"]]
        if fams_pass:
            best = min(fams_pass, key=lambda f: H["families"][f]["inner_choice_vs_incumbent_gate"]["a"])
            H["chosen"] = {"family": best, "config": H["families"][best]["inner_choice"]}
        else:
            H["chosen"] = {"family": "none", "config": "none (keep the incumbent)"}
        # by-year view of the incumbent, the long base and every family's inner choice (calibration slope and ll)
        by = {}
        for Y in range(INNER[0], GATE[1] + 1):
            m = rows & (yr == Y)
            rowY = {"n": int(m.sum()), "base_long": [r5(ll(base[m], y[m])), round(calib_slope(base[m], y[m]), 3)]}
            if Y >= GATE[0]:
                rowY["incumbent"] = [r5(ll(inc[m], y[m])), round(calib_slope(inc[m], y[m]), 3)]
            for fam, v in H["families"].items():
                P = allpreds[(head, v["inner_choice"])]
                Pm = np.where(np.isfinite(P[m]), P[m], base[m])
                rowY[fam] = [r5(ll(Pm, y[m])), round(calib_slope(Pm, y[m]), 3)]
            by[str(Y)] = rowY
        H["by_year"] = by
        R["heads"][head] = H
        log("%s: chosen %s" % (head, H["chosen"]))
    json.dump(R, open(os.path.join(CACHE, "cv_%s.json" % args.universe), "w"), indent=1, default=float)
    pickle.dump(allpreds, open(os.path.join(CACHE, "cv_preds_%s.pkl" % args.universe), "wb"))


DECISION_RULE = (
    "Per head and scheme family, the hyper-parameters are chosen by pooled log loss over the rolling origins "
    "2016-2020 (each year predicted only from earlier fights, per-card refits where the scheme refits per card). "
    "A family passes the gate only if BOTH (a) its 2016-2020 choice and (b) its best configuration on the "
    "forward-chained years 2021-2023 beat the incumbent (ml2's own stack fit 2019..Y-1 with its CV half-life; the "
    "ML v2 logistic as published) by more than 0.0005 pooled log loss on 2021-2023 (ml2's selection rule). Among "
    "passing families the one whose 2016-2020 choice scores best on 2021-2023 is adopted; if none passes, the head "
    "keeps the incumbent (no recalibration). Fixed before any cv output was read; 2024-2025 never enters.")


STAGES = {"table": stage_table, "drift": stage_drift, "cv": stage_cv}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("stage", choices=list(STAGES) + ["all"])
    ap.add_argument("--boot", type=int, default=2000)
    ap.add_argument("--boot-slope", type=int, default=400, help="resamples for slope CIs (each refits)")
    ap.add_argument("--universe", default="backtest", choices=["backtest", "all"],
                    help="backtest = both men had a prior UFC fight (the scored universe); all = every decisive fight")
    args = ap.parse_args()
    stages = [s for s in STAGES if s not in ("confirm",)] if args.stage == "all" else [args.stage]
    for s in stages:
        t0 = time.time()
        log("== %s" % s)
        STAGES[s](args)
        log("== %s done in %.0f s" % (s, time.time() - t0))


if __name__ == "__main__":
    main()
