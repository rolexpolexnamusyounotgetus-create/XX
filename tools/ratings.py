#!/usr/bin/env python3
"""Advanced walk-forward fighter ratings: Elo variants, Glicko-2, TrueSkill, Whole-History Rating,
round-level ratings and dimensional (striking / grappling) ratings, tuned on 2019-2023 and scored once
on 2024+.

Run from the project root:

    python3 tools/ratings.py              # full run: tune every system, score 2024+, write outputs (~25 min)
    python3 tools/ratings.py --quick      # smaller tuning grids (smoke test)
    python3 tools/ratings.py --jobs 4     # parallel workers for the tuning grids (default: all cores)

Writes:
    data/derived/ratings.json    systems, tuned parameters, tuning and held-out metrics with bootstrap CIs,
                                 calibration, pre-fight ratings + probabilities for every backtest fight
                                 (keyed by ufcstats fight id), current roster ratings with uncertainty
                                 (keyed by slug)
    research/model_ratings.md    is written by hand from the numbers this script prints and stores

Discipline: every rating is updated strictly in date order (bout order inside a card); a fight's
prediction uses only fights on earlier days. Tuning runs stop the data stream at 2024-01-01, so the
2024+ fights are never seen while parameters are chosen; the final run with the chosen parameters is
the only pass that reaches 2024+. Winner metrics exclude draws and no-contests. All predictors are
symmetric (P(A) = 1 - P(B) when the corners are swapped), because ufcstats' first-listed fighter wins
57% of the time and that ordering must not leak into the ratings.

Data: tools/build_db.py loaders (fights, people, aliases) + data/raw/ufc_fight_stats.csv round rows.
"""
import os
for _v in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS"):   # one BLAS thread per process:
    os.environ.setdefault(_v, "1")                                         # the workers already run in parallel
import argparse
import datetime as dt
import json
import math
import sys
import time
from collections import defaultdict
from multiprocessing import Pool

import numpy as np
import scipy.sparse as sp
import scipy.sparse.linalg as spla
from scipy.special import expit, log_ndtr, ndtr

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_db as B  # noqa: E402

ROOT = B.ROOT
OUT_JSON = os.path.join(ROOT, "data", "derived", "ratings.json")
BACKTEST = os.path.join(ROOT, "data", "derived", "backtest.json")
FIGHTERS = os.path.join(ROOT, "data", "derived", "fighters.json")

TUNE_FROM = dt.date(2019, 1, 1).toordinal()
TEST_FROM = dt.date(2024, 1, 1).toordinal()
INNER_SPLIT = dt.date(2022, 1, 1).toordinal()      # time-ordered check inside the tuning window
YEAR = 365.25
LN10_400 = math.log(10) / 400.0                    # Elo points -> logits
SQ2PI = math.sqrt(2 * math.pi)

# round-stat features used by the judge model (A minus B per round)
RF = ["head_l", "body_l", "leg_l", "kd", "td_l", "ctrl_min", "sub"]


# =====================================================================================================
# data
# =====================================================================================================
class Data:
    """Every UFC bout since 1994 as flat arrays, in walk-forward order."""


def _xy(s):
    try:
        a, b = s.split(" of ")
        return float(a), float(b)
    except Exception:
        return 0.0, 0.0


def load_rounds(fights):
    """Per-round stats per side from ufc_fight_stats.csv, keyed by fight id: {fid: {rnd: [sideA, sideB]}}.

    Each side: dict with head_l body_l leg_l sig_l sig_a dist_l clinch_l ground_l kd td_l td_a ctrl sub rev
    tot_l and mins (scheduled length, the last round = finish time)."""
    st = B.load("ufc_fight_stats.csv")
    st = st[st["ROUND"] != ""]
    key = defaultdict(list)
    for f in fights:
        key[(f.event, f.bout)].append(f)
    fmap = {k: v[0] for k, v in key.items() if len(v) == 1}
    out = defaultdict(dict)
    for r in st.itertuples(index=False):
        f = fmap.get((r.EVENT, r.BOUT))
        if f is None:
            continue
        side = 0 if r.FIGHTER == f.names[0] else (1 if r.FIGHTER == f.names[1] else -1)
        if side < 0:
            continue
        try:
            rnd = int(str(r.ROUND).split()[-1])
        except ValueError:
            continue
        if rnd > f.rnd:
            continue
        if rnd < f.rnd:
            mins = float(f.lengths[rnd - 1]) if f.lengths and rnd - 1 < len(f.lengths) else 5.0
        else:
            if f.time_s is None:
                continue
            mins = f.time_s / 60.0
        g = {}
        g["head_l"], _ = _xy(r.HEAD)
        g["body_l"], _ = _xy(r.BODY)
        g["leg_l"], _ = _xy(r.LEG)
        g["sig_l"], g["sig_a"] = _xy(r._5)            # SIG.STR.
        g["dist_l"], _ = _xy(r.DISTANCE)
        g["clinch_l"], _ = _xy(r.CLINCH)
        g["ground_l"], _ = _xy(r.GROUND)
        g["tot_l"], _ = _xy(r._7)                     # TOTAL STR.
        g["td_l"], g["td_a"] = _xy(r.TD)
        for k, col in (("kd", r.KD), ("sub", r._10), ("rev", r._11)):
            try:
                g[k] = float(col)
            except (TypeError, ValueError):
                g[k] = 0.0
        c = str(r.CTRL)
        try:
            m, s = c.split(":")
            g["ctrl"] = float(m) * 60 + float(s)
        except ValueError:
            g["ctrl"] = 0.0
        g["mins"] = mins
        out[f.fid].setdefault(rnd, [None, None])[side] = g
    # keep only complete rounds (both sides present)
    clean = {}
    for fid, rr in out.items():
        rr = {k: v for k, v in rr.items() if v[0] is not None and v[1] is not None}
        if rr:
            clean[fid] = rr
    return clean


def load_data():
    log = {}
    fights, _ = B.parse_fights(log)
    people = B.build_people(fights, log)
    rounds = load_rounds(fights)
    fights = [f for f in fights if f.persons[0] != f.persons[1]]
    D = Data()
    D.fights = fights
    D.people = people
    pid = {}
    for f in fights:
        for p in f.persons:
            if p not in pid:
                pid[p] = len(pid)
    D.pid = pid
    D.pids = list(pid)
    D.n_players = len(pid)
    n = len(fights)
    D.n = n
    D.fid = [f.fid for f in fights]
    D.fidx = {f.fid: i for i, f in enumerate(fights)}
    D.ia = np.array([pid[f.persons[0]] for f in fights])
    D.ib = np.array([pid[f.persons[1]] for f in fights])
    D.day = np.array([f.day for f in fights])
    D.year = np.array([f.date.year for f in fights])
    D.winner = [f.winner for f in fights]
    D.method = [f.method for f in fights]
    D.rnd = np.array([f.rnd for f in fights])
    D.sched = np.array([f.sched or 3 for f in fights])
    D.event = [f.event for f in fights]
    D.division = [f.division for f in fights]
    D.title = np.array([bool(f.title) for f in fights])
    D.cards = [f.cards for f in fights]
    D.time_s = [f.time_s for f in fights]
    dob = np.full(D.n_players, np.nan)
    for p, i in pid.items():
        T = (people.get(p) or {}).get("tott") or {}
        if T.get("dob"):
            dob[i] = T["dob"].toordinal()
    D.dob = dob
    D.age_a = (D.day - dob[D.ia]) / YEAR
    D.age_b = (D.day - dob[D.ib]) / YEAR
    D.slug = [(people.get(p) or {}).get("slug") or p for p in D.pids]
    D.name = [(people.get(p) or {}).get("name") or p for p in D.pids]
    D.rounds = [rounds.get(f.fid) for f in fights]
    # outcome codes: y in {1, 0, 0.5}; obs False for no-contests
    D.y = np.array([{"A": 1.0, "B": 0.0, "D": 0.5}.get(w, np.nan) for w in D.winner])
    D.obs = ~np.isnan(D.y)
    # evaluation sets come from backtest.json (both men with a prior UFC fight, 2019+, no ambiguous names)
    bt = json.load(open(BACKTEST))
    D.bt_ids = [e["id"] for e in bt["fights"]]
    D.bt_idx = np.array([D.fidx[i] for i in D.bt_ids])
    for e in bt["fights"]:   # sanity: same corner order as the backtest
        i = D.fidx[e["id"]]
        assert D.slug[D.ia[i]] == e["A"]["slug"] and D.slug[D.ib[i]] == e["B"]["slug"], e["id"]
    dec = np.array([D.winner[i] in ("A", "B") for i in D.bt_idx])
    bi = D.bt_idx[dec]
    D.idx_tune = bi[(D.day[bi] >= TUNE_FROM) & (D.day[bi] < TEST_FROM)]
    D.idx_test = bi[D.day[bi] >= TEST_FROM]
    D.idx_in_tr = D.idx_tune[D.day[D.idx_tune] < INNER_SPLIT]
    D.idx_in_va = D.idx_tune[D.day[D.idx_tune] >= INNER_SPLIT]
    D.snapshot = fights[-1].date
    # per-fight method category
    cat = []
    for i in range(n):
        m, w = D.method[i], D.winner[i]
        if w not in ("A", "B"):
            cat.append("D" if w == "D" else "NC")
        elif m in ("KO", "DOC"):
            cat.append("KO")
        elif m == "SUB":
            cat.append("SUB")
        elif m == "UD":
            cat.append("UD")
        elif m in ("SD", "MD"):
            cat.append("SD")
        else:
            cat.append("DQ")
    D.cat = cat
    return D


# =====================================================================================================
# metrics
# =====================================================================================================
def ll_vec(p, y):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


def metrics(p, y):
    p = np.asarray(p, float)
    y = np.asarray(y, float)
    ok = ~np.isnan(p)
    p, y = p[ok], y[ok]
    if len(p) == 0:
        return {"n": 0}
    return {"n": int(len(p)), "log_loss": float(ll_vec(p, y).mean()), "brier": float(((p - y) ** 2).mean()),
            "accuracy": float(((p > 0.5) == (y > 0.5)).mean() - 0.5 * (p == 0.5).mean())}


def score(D, P, idx):
    """log loss of predictions P (full-length array) on index set idx."""
    p = P[idx]
    y = D.y[idx]
    if np.isnan(p).any():
        return 9.0
    return float(ll_vec(p, y).mean())


def calibration(p, y, nb=10):
    """Calibration in favourite orientation (p >= 0.5 side) plus ECE and logistic recalibration fits."""
    p = np.asarray(p, float)
    y = np.asarray(y, float)
    pf = np.where(p >= 0.5, p, 1 - p)
    yf = np.where(p >= 0.5, y, 1 - y)
    bins = []
    edges = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.9, 1.0001]
    ece = 0.0
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (pf >= lo) & (pf < hi)
        if m.sum():
            bins.append({"lo": lo, "hi": min(hi, 1.0), "n": int(m.sum()), "pred": round(float(pf[m].mean()), 4),
                         "obs": round(float(yf[m].mean()), 4)})
            ece += m.sum() / len(p) * abs(pf[m].mean() - yf[m].mean())
    z = np.log(np.clip(p, 1e-6, 1 - 1e-6) / np.clip(1 - p, 1e-6, 1))
    slope = _logit_fit(z[:, None], y)[0][0]
    (s2, b2) = _logit_fit(np.c_[z, np.ones_like(z)], y)[0]
    return {"bins_favourite": bins, "ece": round(float(ece), 4),
            "slope_no_intercept": round(float(slope), 4),
            "slope_with_intercept": round(float(s2), 4), "intercept_A_side": round(float(b2), 4)}


def _logit_fit(X, y, w=None, l2=1e-6, iters=50):
    X = np.asarray(X, float)
    y = np.asarray(y, float)
    w = np.ones(len(y)) if w is None else np.asarray(w, float)
    beta = np.zeros(X.shape[1])
    for _ in range(iters):
        z = X @ beta
        p = expit(z)
        g = X.T @ (w * (p - y)) + l2 * beta
        H = (X * (w * p * (1 - p))[:, None]).T @ X + l2 * np.eye(X.shape[1])
        step = np.linalg.solve(H, g)
        beta -= step
        if np.max(np.abs(step)) < 1e-9:
            break
    return beta, H


def bootstrap(D, preds, idx, base=None, B_=2000, seed=7):
    """Event-clustered bootstrap of log loss / Brier / accuracy for each system on idx; paired deltas vs base."""
    rng = np.random.default_rng(seed)
    ev = np.array([D.event[i] for i in idx])
    uniq, inv = np.unique(ev, return_inverse=True)
    groups = [np.where(inv == g)[0] for g in range(len(uniq))]
    y = D.y[idx]
    res = {}
    samples = []
    for _ in range(B_):
        pick = rng.integers(0, len(groups), len(groups))
        samples.append(np.concatenate([groups[g] for g in pick]))
    for name, P in preds.items():
        p = P[idx]
        ll = ll_vec(p, y)
        br = (p - y) ** 2
        ac = ((p > 0.5) == (y > 0.5)).astype(float)
        bl = ll_vec(preds[base][idx], y) if base else None
        stats = {"log_loss": [], "brier": [], "accuracy": [], "d_log_loss": []}
        for s in samples:
            stats["log_loss"].append(ll[s].mean())
            stats["brier"].append(br[s].mean())
            stats["accuracy"].append(ac[s].mean())
            if base:
                stats["d_log_loss"].append(ll[s].mean() - bl[s].mean())
        r = {}
        for k, v in stats.items():
            if v:
                r[k + "_ci95"] = [round(float(np.percentile(v, 2.5)), 5), round(float(np.percentile(v, 97.5)), 5)]
        if base:
            r["d_log_loss_vs_" + base] = round(float(ll.mean() - bl.mean()), 5)
            r["p_better_than_" + base] = round(float(np.mean(np.array(stats["d_log_loss"]) < 0)), 4)
        res[name] = r
    return res


# =====================================================================================================
# age curve, newcomer prior, outcome encoders
# =====================================================================================================
AY, AO = 27.0, 31.0        # knots of the age drift: improving before AY, declining after AO


def age_G(a, dy, do, ay=AY, ao=AO):
    """Integral of the drift rate g(a) = dy*(ay-a)+ - do*(a-ao)+ (rating units per year of age)."""
    if a != a:          # nan: unknown age -> no drift
        return 0.0
    return -dy * max(0.0, ay - a) ** 2 / 2.0 - do * max(0.0, a - ao) ** 2 / 2.0


def drift(P, age, gap_y, n_so_far):
    """Deterministic skill change between a fighter's previous fight and the next one (rating units):
    age curve (improvement before ay, accelerating decline after ao), early-career learning
    dl * exp(-(n - 1) / nl) on entering fight n + 1, and a layoff term -lay * (min(gap, 4) - 0.75)+."""
    d = 0.0
    dy, do = P.get("dy", 0.0), P.get("do", 0.0)
    if (dy or do) and age == age and gap_y > 0:
        ay, ao = P.get("ay", AY), P.get("ao", AO)
        d += age_G(age, dy, do, ay, ao) - age_G(age - gap_y, dy, do, ay, ao)
    dl = P.get("dl", 0.0)
    if dl and n_so_far >= 1:
        d += dl * math.exp(-(n_so_far - 1) / P.get("nl", 4.0))
    lay = P.get("lay", 0.0)
    if lay and gap_y > 0.75:
        d -= lay * (min(gap_y, 4.0) - 0.75)
    return d


def newcomer(age, P):
    if age != age:
        age = 29.0
    return P.get("mu_new", 0.0) + P.get("age_new", 0.0) * (min(max(age, 20.0), 42.0) - 29.0)


def encode(D, P):
    """Outcome encoding -> (y, w) per fight, both for the A side. Encoders:

    binary  : win 1 / loss 0 / draw 0.5, weight 1
    mov     : winner score by method (finish 1, UD y_ud, SD/MD y_sd, DQ y_dq), weight w_fin for finishes
              (x w_r1 more in round 1), 1 for decisions
    rounds  : every round a game: judge-consensus round winners (posterior over each card given the round
              stats), stats-only for rounds of finished fights; the finishing round goes to the finisher
              with weight w_fround, every unplayed round adds w_rem to the finisher; y = weighted round share,
              w = w_round * total round weight
    hybrid  : lam * mov + (1 - lam) * rounds (weights mixed the same way)
    """
    enc = P.get("enc", "binary")
    n = D.n
    y = D.y.copy()
    w = np.where(D.obs, 1.0, 0.0)
    if enc == "binary":
        return np.nan_to_num(y, nan=0.5), w
    ym, wm = y.copy(), w.copy()
    for i in range(n):
        c = D.cat[i]
        if c in ("NC", "D"):
            continue
        a_won = D.winner[i] == "A"
        if c in ("KO", "SUB"):
            s, ww = 1.0, P.get("w_fin", 1.0) * (P.get("w_r1", 1.0) if D.rnd[i] == 1 else 1.0)
        elif c == "UD":
            s, ww = P.get("y_ud", 1.0), 1.0
        elif c == "SD":
            s, ww = P.get("y_sd", 1.0), 1.0
        else:
            s, ww = P.get("y_dq", 0.75), 1.0
        ym[i] = s if a_won else 1.0 - s
        wm[i] = ww
    ym = np.nan_to_num(ym, nan=0.5)
    if enc == "mov":
        return ym, wm
    yr, wr = D.round_y, D.round_w
    # finishing round / remaining rounds weights are parameters: rebuild from components
    w_fr, w_rem = P.get("w_fround", 1.0), P.get("w_rem", 0.0)
    wsum = D.rw_played + w_fr * D.rw_fin + w_rem * D.rw_rem
    ysum = D.ry_played + w_fr * D.ry_fin + w_rem * D.ry_rem
    with np.errstate(invalid="ignore", divide="ignore"):
        yr = np.where(wsum > 0, ysum / np.maximum(wsum, 1e-12), 0.5)
    wr = P.get("w_round", 0.3) * wsum
    wr = np.where(D.obs, wr, 0.0)
    if enc == "rounds":
        return yr, wr
    lam = P.get("lam", 0.5)
    wh = lam * wm + (1 - lam) * wr
    yh = np.where(wh > 0, (lam * wm * ym + (1 - lam) * wr * yr) / np.maximum(wh, 1e-12), 0.5)
    return yh, wh


# =====================================================================================================
# round model: judge consensus round winners
# =====================================================================================================
def round_features(rr):
    """rr = {rnd: [A, B]} -> (rounds sorted, X diff matrix A-B over RF)."""
    ks = sorted(rr)
    X = np.zeros((len(ks), len(RF)))
    for j, k in enumerate(ks):
        a, b = rr[k]
        X[j] = [a["head_l"] - b["head_l"], a["body_l"] - b["body_l"], a["leg_l"] - b["leg_l"], a["kd"] - b["kd"],
                a["td_l"] - b["td_l"], (a["ctrl"] - b["ctrl"]) / 60.0, a["sub"] - b["sub"]]
    return ks, X


def _subsets(R):
    return np.array([[(m >> i) & 1 for i in range(R)] for m in range(2 ** R)], float)


SUBS = {R: _subsets(R) for R in range(1, 6)}


def fit_round_model(D, before_day):
    """EM fit of P(A wins round | stat diffs) on decision cards (10-9-only) of fights before before_day."""
    rows, groups = [], []
    for i in range(D.n):
        if D.day[i] >= before_day or D.cat[i] not in ("UD", "SD") or not D.cards[i] or not D.rounds[i]:
            continue
        ks, X = round_features(D.rounds[i])
        R = int(D.sched[i])
        if len(ks) != R or ks != list(range(1, R + 1)) or R > 5:
            continue
        for a, b in D.cards[i]:
            if a + b != 19 * R or abs(a - b) > R:
                continue
            k = (a - b + R) // 2
            groups.append((len(rows), R, k))
            rows.append(X)
    start = 0
    G = defaultdict(list)
    for (_, R, k), X in zip(groups, rows):
        G[(R, k)].append(start)
        start += R
    Xall = np.vstack(rows)
    beta = np.zeros(len(RF))
    for it in range(80):
        p = expit(np.clip(Xall @ beta, -30, 30))
        post = np.empty_like(p)
        for (R, k), starts in G.items():
            Z = SUBS[R][SUBS[R].sum(1) == k]
            ix = np.array(starts)[:, None] + np.arange(R)[None, :]
            Pm = p[ix]
            L = np.log(Pm + 1e-12) @ Z.T + np.log(1 - Pm + 1e-12) @ (1 - Z).T
            L -= L.max(1, keepdims=True)
            W = np.exp(L)
            W /= W.sum(1, keepdims=True)
            post[ix] = W @ Z
        new, _ = _logit_fit(Xall, post, l2=1e-4)
        if np.max(np.abs(new - beta)) < 1e-7:
            beta = new
            break
        beta = new
    return beta, len(groups), Xall.shape[0]


def build_round_outcomes(D, beta, q108=0.045):
    """Soft round outcomes per fight (A side): components so the encoder can re-weight finishing and
    unplayed rounds without recomputing posteriors.

    ry_played / rw_played : sum of y / count over rounds that were fought to their end (plus the final round
                            of a decision), from the judges' posterior when cards exist, else the stat model
    ry_fin / rw_fin       : the finishing round (1 for the finisher)
    ry_rem / rw_rem       : unplayed scheduled rounds after a finish (all to the finisher)"""
    n = D.n
    ryp, rwp = np.zeros(n), np.zeros(n)
    ryf, rwf = np.zeros(n), np.zeros(n)
    ryr, rwr = np.zeros(n), np.zeros(n)
    agree = []
    for i in range(n):
        if not D.obs[i]:
            continue
        c, R = D.cat[i], int(D.sched[i])
        rr = D.rounds[i]
        a_won = D.winner[i] == "A"
        if not rr:
            # no round stats (early UFC): the whole fight as one round-game won by the winner
            if c == "D":
                ryp[i], rwp[i] = 0.5, 1.0
            else:
                ryp[i], rwp[i] = (1.0 if a_won else 0.0), 1.0
            continue
        ks, X = round_features(rr)
        p = expit(np.clip(X @ beta, -30, 30))
        finished = c in ("KO", "SUB", "DQ")
        if finished:
            last = D.rnd[i]
            full = [j for j, k in enumerate(ks) if k < last]
            ryp[i] = p[full].sum()
            rwp[i] = len(full)
            ryf[i], rwf[i] = (1.0 if a_won else 0.0), 1.0
            rem = max(0, R - last)
            ryr[i], rwr[i] = (rem if a_won else 0.0), rem
            continue
        post = None
        if c in ("UD", "SD") and D.cards[i] and len(ks) == R and R <= 5:
            post = card_posterior(p, D.cards[i], q108)
        if post is not None:
            ryp[i], rwp[i] = post.sum(), len(post)
            agree.append(((post.sum() > R / 2) == a_won))
        else:
            ryp[i], rwp[i] = p.sum(), len(p)
    D.ry_played, D.rw_played = ryp, rwp
    D.ry_fin, D.rw_fin = ryf, rwf
    D.ry_rem, D.rw_rem = ryr, rwr
    D.round_y = np.where(rwp + rwf > 0, (ryp + ryf) / np.maximum(rwp + rwf, 1e-12), 0.5)
    D.round_w = rwp + rwf
    return float(np.mean(agree)) if agree else None


_COMBOS = {}


def _combos(R):
    """All per-round outcomes for R rounds: rows of (A_pts, B_pts, A_won, is_108)."""
    if R not in _COMBOS:
        opts = [(10, 9, 1, 0), (9, 10, 0, 0), (10, 8, 1, 1), (8, 10, 0, 1)]
        rows = []
        for m in range(4 ** R):
            t = m
            c = []
            for _ in range(R):
                c.append(opts[t % 4])
                t //= 4
            rows.append(c)
        arr = np.array(rows, float)          # (4^R, R, 4)
        _COMBOS[R] = arr
    return _COMBOS[R]


def card_posterior(p, cards, q108):
    """Average over judges of P(A won round r | stat-model prior p_r, the judge's card total)."""
    R = len(p)
    C = _combos(R)
    won = C[:, :, 2]
    is8 = C[:, :, 3]
    lp = (np.log(np.where(won == 1, p, 1 - p) + 1e-12) + np.log(np.where(is8 == 1, q108, 1 - q108))).sum(1)
    ta, tb = C[:, :, 0].sum(1), C[:, :, 1].sum(1)
    posts = []
    for a, b in cards:
        m = (ta == a) & (tb == b)
        if not m.any():
            continue
        L = lp[m]
        W = np.exp(L - L.max())
        W /= W.sum()
        posts.append(W @ won[m])
    if not posts:
        return None
    return np.mean(posts, axis=0)


# =====================================================================================================
# Elo family (logit units)
# =====================================================================================================
def run_elo(D, P, until=None, record=False):
    """Elo with fight-count / layoff K schedule, newcomer prior by age, age drift, outcome encoder."""
    until = until or 10 ** 9
    y, w = encode(D, P)
    K = P["K"]
    kb, kn, kl = P.get("kb", 0.0), P.get("kn", 3.0), P.get("kl", 0.0)
    boost, boost_n = P.get("boost", 1.0), P.get("boost_n", 0)
    dy, do = P.get("dy", 0.0), P.get("do", 0.0)
    kap = P.get("kappa", 1.0)
    r = {}
    nf = defaultdict(int)
    last = {}
    out = np.full(D.n, np.nan)
    rec = np.full((D.n, 4), np.nan) if record else None
    day, ia, ib, aa, ab, obs = D.day, D.ia, D.ib, D.age_a, D.age_b, D.obs
    dob = D.dob
    for i in range(D.n):
        d = day[i]
        if d >= until:
            break
        a, b = ia[i], ib[i]
        rs = []
        ks = []
        for sd_, p, age in ((0, a, aa[i]), (1, b, ab[i])):
            if p not in r:
                r[p] = newcomer_i(D, P, i, sd_, age)
                gap = 0.0
            else:
                gap = (d - last[p]) / YEAR
                r[p] += drift(P, age, gap, nf[p])
            k = K * (1.0 + kb * math.exp(-nf[p] / kn)) * (1.0 + kl * min(gap, 3.0))
            if nf[p] < boost_n:
                k *= boost
            rs.append(r[p])
            ks.append(k)
        diff = rs[0] - rs[1]
        out[i] = 1.0 / (1.0 + math.exp(-kap * diff))
        if record:
            rec[i] = (rs[0], np.nan, rs[1], np.nan)
        if obs[i]:
            e = 1.0 / (1.0 + math.exp(-diff))
            g = w[i] * (y[i] - e)
            r[a] += ks[0] * g
            r[b] -= ks[1] * g
        nf[a] += 1
        nf[b] += 1
        last[a] = d
        last[b] = d
    state = {"r": r, "n": nf, "last": last}
    return out, rec, state


# =====================================================================================================
# Glicko-2 (continuous-time RD inflation, weighted games)
# =====================================================================================================
def run_glicko2(D, P, until=None, record=False):
    until = until or 10 ** 9
    y, w = encode(D, P)
    phi0, sig0, tau, T = P["phi0"], P["sig0"], P["tau"], P["T"]
    dy, do = P.get("dy", 0.0), P.get("do", 0.0)
    kap = P.get("kappa", 1.0)
    phimin = P.get("phimin", 0.0)
    mu, phi, sig, last = {}, {}, {}, {}
    nfc = defaultdict(int)
    out = np.full(D.n, np.nan)
    rec = np.full((D.n, 4), np.nan) if record else None
    pi2 = math.pi ** 2
    tau2 = tau * tau
    for i in range(D.n):
        d = D.day[i]
        if d >= until:
            break
        a, b = D.ia[i], D.ib[i]
        for sd_, p, age in ((0, a, D.age_a[i]), (1, b, D.age_b[i])):
            if p not in mu:
                mu[p], phi[p], sig[p] = newcomer_i(D, P, i, sd_, age), phi0, sig0
            else:
                gap = (d - last[p])
                if gap > 0:
                    phi[p] = min(phi0, math.sqrt(phi[p] ** 2 + sig[p] ** 2 * gap / T))
                mu[p] += drift(P, age, gap / YEAR, nfc[p])
        ma, mb, pa, pb = mu[a], mu[b], phi[a], phi[b]
        gc = 1.0 / math.sqrt(1.0 + 3.0 * (pa * pa + pb * pb) / pi2)
        out[i] = 1.0 / (1.0 + math.exp(-kap * gc * (ma - mb)))
        if record:
            rec[i] = (ma, pa, mb, pb)
        if D.obs[i]:
            for p, q, s in ((a, b, y[i]), (b, a, 1.0 - y[i])):
                m, ph, sg = mu[p], phi[p], sig[p]
                g = 1.0 / math.sqrt(1.0 + 3.0 * phi_q2(phi, q) / pi2)
                E = 1.0 / (1.0 + math.exp(-g * (m - mu[q])))
                ww = w[i]
                v = 1.0 / (ww * g * g * E * (1 - E) + 1e-12)
                delta = v * ww * g * (s - E)
                # volatility (Illinois)
                A = math.log(sg * sg)
                ph2 = ph * ph

                def f(x):
                    ex = math.exp(x)
                    return ex * (delta * delta - ph2 - v - ex) / (2 * (ph2 + v + ex) ** 2) - (x - A) / tau2

                if delta * delta > ph2 + v:
                    Bv = math.log(delta * delta - ph2 - v)
                else:
                    k = 1
                    while f(A - k * tau) < 0 and k < 50:
                        k += 1
                    Bv = A - k * tau
                fa, fb = f(A), f(Bv)
                Aa = A
                for _ in range(30):
                    if abs(Bv - Aa) < 1e-6:
                        break
                    C = Aa + (Aa - Bv) * fa / (fb - fa)
                    fc = f(C)
                    if fc * fb <= 0:
                        Aa, fa = Bv, fb
                    else:
                        fa /= 2
                    Bv, fb = C, fc
                sg2 = math.exp(Aa / 2)
                # phi was already inflated for the elapsed time before the fight, so no extra period here
                phn = 1.0 / math.sqrt(1.0 / ph2 + 1.0 / v)
                phn = max(phn, phimin)
                newmu = m + phn * phn * ww * g * (s - E)
                if p == a:
                    na = (newmu, phn, sg2)
                else:
                    nb = (newmu, phn, sg2)
            mu[a], phi[a], sig[a] = na
            mu[b], phi[b], sig[b] = nb
        last[a] = d
        last[b] = d
        nfc[a] += 1
        nfc[b] += 1
    return out, rec, {"mu": mu, "phi": phi, "sig": sig, "last": last, "n": nfc}


def phi_q2(phi, q):
    return phi[q] ** 2


# =====================================================================================================
# TrueSkill-like Gaussian (probit) ratings; binary or ordinal (method-aware) outcome
# =====================================================================================================
def _vw_interval(lo, hi, m, c):
    """Moment-matching factors for N(m, c^2) truncated to (lo, hi): returns (v, w) in standardised units."""
    al = (lo - m) / c if lo > -1e9 else -1e9
    be = (hi - m) / c if hi < 1e9 else 1e9
    Z = ndtr(be) - ndtr(al)
    pa = math.exp(-al * al / 2) / SQ2PI if al > -1e8 else 0.0
    pb = math.exp(-be * be / 2) / SQ2PI if be < 1e8 else 0.0
    if Z < 1e-12:
        # far tail: use the asymptotic one-sided form
        if be >= 1e8:
            t = -al
            v = -t if t < -30 else math.exp(-t * t / 2) / SQ2PI / max(ndtr(t), 1e-300)
            return v, max(1e-6, min(1.0, v * (v + t)))
        Z = 1e-12
    v = (pa - pb) / Z
    aa = al * pa if al > -1e8 else 0.0
    bb = be * pb if be < 1e8 else 0.0
    w = v * v + (aa - bb) / Z
    return v, min(max(w, 1e-9), 1.0 - 1e-9)


def run_trueskill(D, P, until=None, record=False):
    until = until or 10 ** 9
    beta2 = 1.0
    s0, tau_y, gam = P["s0"], P["tau_y"], P.get("gam", 0.0)
    dy, do = P.get("dy", 0.0), P.get("do", 0.0)
    kap = P.get("kappa", 1.0)
    ordinal = P.get("ordinal", False)
    th_fin, th_ud, th_sd = P.get("th_fin", 0.0), P.get("th_ud", 0.0), P.get("th_sd", 1e10)
    th_d = P.get("th_draw", 0.1)
    w_fin = P.get("w_fin", 1.0)
    mu, var, last = {}, {}, {}
    nfc = defaultdict(int)
    out = np.full(D.n, np.nan)
    rec = np.full((D.n, 4), np.nan) if record else None
    for i in range(D.n):
        d = D.day[i]
        if d >= until:
            break
        a, b = D.ia[i], D.ib[i]
        for sd_, p, age in ((0, a, D.age_a[i]), (1, b, D.age_b[i])):
            if p not in mu:
                mu[p], var[p] = newcomer_i(D, P, i, sd_, age), s0 * s0
            else:
                gap = (d - last[p]) / YEAR
                var[p] = min(s0 * s0, var[p] + tau_y * tau_y * gap + gam * gam)
                mu[p] += drift(P, age, gap, nfc[p])
        ma, mb, va, vb = mu[a], mu[b], var[a], var[b]
        c2 = 2 * beta2 + va + vb
        c = math.sqrt(c2)
        out[i] = float(ndtr(kap * (ma - mb) / c))
        if record:
            rec[i] = (ma, math.sqrt(va), mb, math.sqrt(vb))
        if D.obs[i]:
            cat, aw = D.cat[i], D.winner[i] == "A"
            if cat == "D":
                lo, hi = -th_d, th_d
            elif not ordinal:
                lo, hi = (0.0, 1e10) if aw else (-1e10, 0.0)
            else:
                if cat in ("KO", "SUB"):
                    l0, h0 = th_fin, 1e10
                elif cat == "UD":
                    l0, h0 = th_ud, 1e10
                elif cat == "SD":
                    l0, h0 = 0.0, th_sd
                else:
                    l0, h0 = 0.0, 1e10
                lo, hi = (l0, h0) if aw else (-h0, -l0)
            v, wv = _vw_interval(lo, hi, ma - mb, c)
            ww = w_fin if (ordinal and cat in ("KO", "SUB")) else 1.0
            mu[a] = ma + ww * va / c * v
            mu[b] = mb - ww * vb / c * v
            var[a] = va * max(1e-4, 1 - ww * va / c2 * wv)
            var[b] = vb * max(1e-4, 1 - ww * vb / c2 * wv)
        last[a] = d
        last[b] = d
        nfc[a] += 1
        nfc[b] += 1
    return out, rec, {"mu": mu, "var": var, "last": last, "n": nfc}


# =====================================================================================================
# Whole-History Rating / Bayesian Bradley-Terry with Gaussian random-walk skill (walk-forward)
# =====================================================================================================
WHR_WINDOW = 6.0         # years of free nodes in the per-day re-solve (older nodes held fixed)
WHR_FULL_EVERY = 8       # full re-solve over the whole history every n-th fight day
WHR_SOLVER = "pcg"       # "pcg" (fast, chain-block variances) or "lu" (exact variances, sparse factorisation)

try:
    from sksparse.cholmod import cho_factor as CHOLMOD   # optional (scikit-sparse >= 0.5), faster than SuperLU
except Exception:
    CHOLMOD = None


class _CholWrap:
    def __init__(self, F):
        self.F = F

    def solve(self, b):
        return self.F.solve(b)


class WHR:
    """Time-varying Bradley-Terry: each fighter has a skill node at every fight; consecutive nodes follow a
    Gaussian random walk x' ~ N(x + drift(age), w2 * years + vf); the first node has the newcomer prior
    N(mu_new + age_new * (age - 29), s0^2). Observations: weighted (fractional) logistic likelihood of the
    encoder's (y, w). MAP by global sparse Newton over all nodes; walk-forward by fight day: before each day
    the posterior is re-solved on all earlier fights (warm-started), so opponents' strengths are re-estimated
    retroactively, and the day's fights are predicted from each fighter's last node, its posterior variance
    (diagonal of the inverse Hessian) and the random-walk variance accrued since."""

    def __init__(self, D, P):
        self.D, self.P = D, P
        y, w = encode(D, P)
        obs = np.where(D.obs & (w > 0))[0]
        self.fobs = obs
        K = len(obs)
        self.K = K
        self.nn = 2 * K
        self.y = y[obs]
        self.w = w[obs]
        self.fight_day = D.day[obs]
        node_p = np.empty(2 * K, int)
        node_p[0::2] = D.ia[obs]
        node_p[1::2] = D.ib[obs]
        node_age = np.empty(2 * K)
        node_age[0::2] = D.age_a[obs]
        node_age[1::2] = D.age_b[obs]
        node_day = np.repeat(D.day[obs], 2)
        self.node_p, self.node_age, self.node_day = node_p, node_age, node_day
        w2, vf, s0 = P["w2"], P.get("vf", 0.0), P["s0"]
        dy, do = P.get("dy", 0.0), P.get("do", 0.0)
        prev = np.full(2 * K, -1)
        pos = np.zeros(2 * K, int)          # number of the fighter's earlier (observed) fights
        lastn = {}
        for n in range(2 * K):
            p = node_p[n]
            if p in lastn:
                prev[n] = lastn[p]
                pos[n] = pos[lastn[p]] + 1
            lastn[p] = n
        self.prev = prev
        self.pos = pos
        e = np.where(prev >= 0)[0]
        self.e_n = e
        self.e_p = prev[e]
        dt_y = (node_day[e] - node_day[self.e_p]) / YEAR
        self.e_c = 1.0 / (w2 * dt_y + vf + 1e-9)
        self.c_of = np.zeros(2 * K)
        self.c_of[e] = self.e_c
        self.e_d = np.array([drift(P, node_age[n], (node_day[n] - node_day[m]) / YEAR, pos[n])
                             for n, m in zip(e, self.e_p)])
        f = np.where(prev < 0)[0]
        self.f_n = f
        self.f_m = np.array([newcomer_i(D, P, obs[n // 2], n % 2, node_age[n]) for n in f])
        self.f_mean = dict(zip(f, self.f_m))
        self.f_c = 1.0 / (s0 * s0)
        # initial values: newcomer mean propagated along the chain with the drift
        x = np.zeros(2 * K)
        x[f] = self.f_m
        dmap = dict(zip(e, self.e_d))
        for n in range(2 * K):
            if prev[n] >= 0:
                x[n] = x[prev[n]] + dmap[n]
        self.x = x
        self.lu = None

    def _system(self, N, lo=0):
        """Gradient and sparse Hessian of the negative log posterior over the free nodes [lo, N); nodes before
        lo are held at their current values (they enter only through the random-walk edges into the window)."""
        x = self.x
        M = N - lo
        g = np.zeros(M)
        f0, f1 = np.searchsorted(self.f_n, lo), np.searchsorted(self.f_n, N)
        f = self.f_n[f0:f1]
        g[f - lo] += (x[f] - self.f_m[f0:f1]) * self.f_c
        e0, e1 = np.searchsorted(self.e_n, lo), np.searchsorted(self.e_n, N)
        en, ep, ec, ed = self.e_n[e0:e1], self.e_p[e0:e1], self.e_c[e0:e1], self.e_d[e0:e1]
        r = ec * (x[en] - x[ep] - ed)
        np.add.at(g, en - lo, r)
        inside = ep >= lo
        np.add.at(g, ep[inside] - lo, -r[inside])
        k0, k1 = lo // 2, N // 2
        za = np.arange(2 * k0, 2 * k1, 2)
        zb = za + 1
        z = x[za] - x[zb]
        p = expit(z)
        wk = self.w[k0:k1]
        rr = wk * (p - self.y[k0:k1])
        g[za - lo] += rr
        g[zb - lo] -= rr
        h = wk * p * (1 - p)
        eni, epi, eci = en[inside] - lo, ep[inside] - lo, ec[inside]
        enb, ecb = en[~inside] - lo, ec[~inside]
        fl = f - lo
        al, bl = za - lo, zb - lo
        rows = np.concatenate([fl, enb, eni, epi, eni, epi, al, bl, al, bl])
        cols = np.concatenate([fl, enb, eni, epi, epi, eni, al, bl, bl, al])
        data = np.concatenate([np.full(len(fl), self.f_c), ecb, eci, eci, -eci, -eci, h, h, -h, -h])
        H = sp.csc_matrix((data, (rows, cols)), shape=(M, M))
        return g, H

    def _factor(self, H):
        if CHOLMOD is not None:
            return _CholWrap(CHOLMOD(H))
        return spla.splu(H, permc_spec="MMD_AT_PLUS_A", diag_pivot_thresh=0.0, options={"SymmetricMode": True})

    def solve(self, N, lo=0, tol=1e-5, max_it=30):
        if N - lo <= 0:
            return
        if self.P.get("solver", WHR_SOLVER) == "pcg":
            return self._solve_pcg(N, lo, tol, max_it)
        for it in range(max_it):
            g, H = self._system(N, lo)
            lu = self._factor(H)
            step = lu.solve(-g)
            mx = np.max(np.abs(step))
            if mx > 2.0:              # damping for the cold start
                step *= 2.0 / mx
            self.x[lo:N] += step
            self.lu, self.luN, self.lulo = lu, N, lo
            if mx < tol:
                break

    # ---- preconditioned conjugate gradients with the fighters' chain (tridiagonal) blocks as preconditioner
    def _tridiag(self, H, N, lo):
        """Permutation putting each fighter's nodes next to each other, and the banded form of H restricted to
        the chain edges (block-diagonal over fighters, tridiagonal inside a block)."""
        loc = np.arange(lo, N)
        perm = np.lexsort((loc, self.node_p[lo:N]))           # local indices sorted by fighter, then time
        Hc = H.tocsr()
        dg = Hc.diagonal()[perm]
        nodes = perm + lo
        same = self.node_p[nodes[1:]] == self.node_p[nodes[:-1]]
        off = np.zeros(len(perm) - 1)
        if same.any():
            off[same] = -self.c_of[nodes[1:][same]]      # chain edge (prev -> node) precision
        ab = np.zeros((3, len(perm)))
        ab[0, 1:] = off
        ab[1] = dg
        ab[2, :-1] = off
        return perm, ab, Hc

    def _solve_pcg(self, N, lo, tol, max_it):
        from scipy.linalg import solve_banded
        for it in range(max_it):
            g, H = self._system(N, lo)
            perm, ab, Hc = self._tridiag(H, N, lo)
            inv = np.empty_like(perm)
            inv[perm] = np.arange(len(perm))

            def Minv(r):
                z = solve_banded((1, 1), ab, r[perm], check_finite=False)
                return z[inv]

            b = -g
            x = Minv(b)                 # block-Jacobi start
            r = b - Hc @ x
            z = Minv(r)
            pdir = z.copy()
            rz = r @ z
            bn = np.linalg.norm(b) + 1e-12
            for k in range(300):
                Ap = Hc @ pdir
                alpha = rz / (pdir @ Ap)
                x += alpha * pdir
                r -= alpha * Ap
                if np.linalg.norm(r) < 1e-7 * bn + 1e-10:
                    break
                z = Minv(r)
                rz2 = r @ z
                pdir = z + (rz2 / rz) * pdir
                rz = rz2
            mx = np.max(np.abs(x))
            if mx > 2.0:
                x *= 2.0 / mx
            self.x[lo:N] += x
            self.tri, self.luN, self.lulo = (perm, inv, ab), N, lo
            if mx < tol:
                break

    def _exact_factor(self, N, lo, force=False):
        """With CHOLMOD available, factor the window Hessian at the solution so variances are exact (opponents'
        uncertainty included); otherwise the pcg chain-block approximation is used."""
        self.exact = None
        if CHOLMOD is not None and self.P.get("solver", WHR_SOLVER) == "pcg" and (
                force or self.P.get("var", "block") == "exact"):
            _, H = self._system(N, lo)
            self.exact = (_CholWrap(CHOLMOD(H)), N, lo)

    def variances(self, nodes):
        """Posterior variance of nodes inside the last solved window: exact diagonal of the inverse Hessian with
        a factorisation, or (pcg) the fighter's own chain block (opponents treated as known, as in Coulom's
        WHR). Nodes outside the window (comebacks after more than the window length) get the newcomer variance."""
        nodes = np.asarray(nodes, int)
        if len(nodes) == 0:
            return np.zeros(0)
        lo, N = self.lulo, self.luN
        ex = getattr(self, "exact", None)
        if ex is not None:
            lo, N = ex[2], ex[1]
        out = np.full(len(nodes), self.P["s0"] ** 2)
        ins = (nodes >= lo) & (nodes < N)
        if ins.any():
            loc = nodes[ins] - lo
            E = np.zeros((N - lo, len(loc)))
            if ex is not None:
                E[loc, np.arange(len(loc))] = 1.0
                X = ex[0].solve(E)
                out[ins] = X[loc, np.arange(len(loc))]
            elif self.P.get("solver", WHR_SOLVER) == "pcg":
                from scipy.linalg import solve_banded
                perm, inv, ab = self.tri
                E[inv[loc], np.arange(len(loc))] = 1.0
                X = solve_banded((1, 1), ab, E, check_finite=False)
                out[ins] = X[inv[loc], np.arange(len(loc))]
            else:
                E[loc, np.arange(len(loc))] = 1.0
                X = self.lu.solve(E)
                out[ins] = X[loc, np.arange(len(loc))]
        return out

    def run(self, eval_days, until=None, record=False):
        """Walk forward over fights; returns (p array over all D fights, rec)."""
        D, P = self.D, self.P
        until = until or 10 ** 9
        w2, vf, s0 = P["w2"], P.get("vf", 0.0), P["s0"]
        dy, do = P.get("dy", 0.0), P.get("do", 0.0)
        kap = P.get("kappa", 1.0)
        out = np.full(D.n, np.nan)
        rec = np.full((D.n, 4), np.nan) if record else None
        days = sorted(d for d in set(eval_days) if d < until)
        # fight index ranges by day (all fights, including NCs)
        order_day = D.day
        lastnode = {}             # player -> last node index (among nodes already in the prefix)
        node_of_fight = {}        # D fight index -> (node a, node b)
        for k, i in enumerate(self.fobs):
            node_of_fight[i] = (2 * k, 2 * k + 1)
        fi = 0                    # next D fight to add to lastnode
        nsolve = 0
        for dday in days:
            # add all fights before dday
            while fi < D.n and order_day[fi] < dday:
                if fi in node_of_fight:
                    na, nb = node_of_fight[fi]
                    lastnode[D.ia[fi]] = na
                    lastnode[D.ib[fi]] = nb
                fi += 1
            N = int(np.searchsorted(self.node_day, dday))      # nodes strictly before dday
            win = P.get("win_years", WHR_WINDOW)
            nsolve += 1
            if win and nsolve % WHR_FULL_EVERY != 1:
                lo = int(np.searchsorted(self.node_day, dday - win * YEAR))
                lo -= lo % 2
            else:
                lo = 0
            self.solve(N, lo)
            self._exact_factor(N, lo)
            # predict the day's fights
            j = fi
            todo = []
            while j < D.n and order_day[j] == dday:
                todo.append(j)
                j += 1
            need = sorted({lastnode[p] for i in todo for p in (D.ia[i], D.ib[i]) if p in lastnode})
            V = dict(zip(need, self.variances(need))) if need else {}
            for i in todo:
                ms, vs = [], []
                for p, age in ((D.ia[i], D.age_a[i]), (D.ib[i], D.age_b[i])):
                    if p in lastnode:
                        n = lastnode[p]
                        gap = (dday - self.node_day[n]) / YEAR
                        m = self.x[n] + drift(P, age, gap, self.pos[n] + 1)
                        v = V[n] + w2 * gap + vf
                    else:
                        m, v = newcomer_i(D, P, i, len(ms), age), s0 * s0
                    ms.append(m)
                    vs.append(v)
                md, vd = ms[0] - ms[1], vs[0] + vs[1]
                out[i] = expit(kap * md / math.sqrt(1.0 + math.pi * kap * kap * vd / 8.0))
                if record:
                    rec[i] = (ms[0], math.sqrt(vs[0]), ms[1], math.sqrt(vs[1]))
            # initialise the new nodes of this day's fights from the predictive means
            for i in todo:
                if i in node_of_fight:
                    na, nb = node_of_fight[i]
                    for n in (na, nb):
                        pv = self.prev[n]
                        self.x[n] = (self.x[pv] if pv >= 0 else self.f_mean[n])
        return out, rec

    def final_state(self, players, ref_day):
        """Full-data posterior: mean and sd of every listed player's skill at ref_day."""
        self.solve(self.nn)
        self._exact_factor(self.nn, 0, force=True)
        D, P = self.D, self.P
        w2, vf = P["w2"], P.get("vf", 0.0)
        dy, do = P.get("dy", 0.0), P.get("do", 0.0)
        last = {}
        for n in range(self.nn):
            last[self.node_p[n]] = n
        out = {}
        nodes = [last[p] for p in players if p in last]
        V = {}
        for c in range(0, len(nodes), 300):
            chunk = nodes[c:c + 300]
            V.update(zip(chunk, self.variances(chunk)))
        for p in players:
            if p not in last:
                continue
            n = last[p]
            gap = (ref_day - self.node_day[n]) / YEAR
            age = (ref_day - D.dob[p]) / YEAR if D.dob[p] == D.dob[p] else float("nan")
            m = self.x[n] + drift(P, age, gap, self.pos[n] + 1)
            out[p] = (float(m), float(math.sqrt(V[n] + w2 * gap + vf)), float(self.x[n]), float(math.sqrt(V[n])))
        return out


def run_whr(D, P, until=None, record=False, eval_idx=None):
    model = WHR(D, P)
    if eval_idx is None:
        eval_idx = D.bt_idx
    days = D.day[eval_idx]
    p, rec = model.run(days, until=until, record=record)
    return p, rec, model


# =====================================================================================================
# Dimensional ratings: offence / defence per skill, Kalman (EKF) updates from per-fight stats
# =====================================================================================================
# dim: (label, kind) with kind nb = negative-binomial count with exposure, bin = binomial accuracy,
# qp = quasi-Poisson amount with exposure
DIMS = {
    "str": ("sig strikes landed per minute (striking offence vs striking defence)", "nb"),
    "acc": ("sig strike accuracy (precision vs evasion)", "bin"),
    "pwr": ("knockdowns per landed head strike, KO wins without a KD count as one (power vs chin)", "nb"),
    "td": ("takedowns landed per 15 minutes (takedown offence vs takedown defence)", "nb"),
    "ctl": ("control minutes per minute (top control vs escapes)", "qp"),
    "sub": ("submission attempts per 15 minutes (submission threat vs submission defence)", "nb"),
}
DIM_DEFAULT = {"str": {"q": 0.02, "v0": 0.06, "k": 6.0}, "acc": {"q": 0.01, "v0": 0.03, "k": 3.0},
               "pwr": {"q": 0.02, "v0": 0.15, "k": 3.0}, "td": {"q": 0.05, "v0": 0.4, "k": 1.5},
               "ctl": {"q": 0.05, "v0": 0.4, "k": 2.0}, "sub": {"q": 0.05, "v0": 0.3, "k": 1.0}}
DIV_GROUP = {"Catch Weight": "ALL", "Open Weight": "ALL"}


def dim_obs(D):
    """Per fight, per direction (A on B, B on A): (count, exposure) per dim; None when no round stats."""
    n = D.n
    obs = {k: np.full((n, 2, 2), np.nan) for k in DIMS}
    for i in range(n):
        rr = D.rounds[i]
        if not rr:
            continue
        tot = [defaultdict(float), defaultdict(float)]
        mins = 0.0
        for k in rr:
            a, b = rr[k]
            mins += a["mins"]
            for s, g in ((0, a), (1, b)):
                for key in ("sig_l", "sig_a", "head_l", "kd", "td_l", "ctrl", "sub"):
                    tot[s][key] += g[key]
        if mins <= 0.05:
            continue
        for s in (0, 1):
            t = tot[s]
            won_ko = D.cat[i] == "KO" and D.winner[i] == ("A" if s == 0 else "B")
            kd = t["kd"] + (1.0 if won_ko and t["kd"] == 0 else 0.0)
            obs["str"][i, s] = (t["sig_l"], mins)
            obs["acc"][i, s] = (t["sig_l"], t["sig_a"])
            obs["pwr"][i, s] = (kd, t["head_l"] + 1.0)
            obs["td"][i, s] = (t["td_l"], mins / 15.0)
            obs["ctl"][i, s] = (min(t["ctrl"] / 60.0, mins), mins)
            obs["sub"][i, s] = (t["sub"], mins / 15.0)
    return obs


def _nb_ll(k, mu, size):
    from scipy.special import gammaln
    return (gammaln(k + size) - gammaln(size) - gammaln(k + 1) + size * np.log(size / (size + mu))
            + k * np.log(mu / (size + mu) + 1e-300))


def run_dims(D, DP, until=None, record=True, dims=None):
    """Kalman filter per dim. State per fighter: offence (mean, var) and defence (mean, var), relative to a
    walk-forward division baseline (exponentially weighted league rate, about 3-year memory).
    Returns per-fight pre-fight states (n, 2 sides, n_dims, 4: off m, off v, def m, def v), the predicted
    rates for the 2 directions and per-dim predictive log-likelihood of the stats on each fight."""
    until = until or 10 ** 9
    dims = dims or list(DIMS)
    obs = D.dim_obs
    nd = len(dims)
    st = {}                     # (player, dim) -> [om, ov, dm, dv, last_day]
    base = defaultdict(lambda: [0.0, 0.0])   # (div, dim) -> EW sums (count, exposure)
    rho = 0.997                 # per-fight decay of the league baseline (about 300 fights of memory)
    pre = np.full((D.n, 2, nd, 4), np.nan) if record else None
    pll = np.full((D.n, nd), np.nan)
    pred = np.full((D.n, 2, nd), np.nan)
    prior_rate = {"str": 3.5, "acc": 0.45, "pwr": 0.01, "td": 1.3, "ctl": 0.2, "sub": 0.5}
    for i in range(D.n):
        d = D.day[i]
        if d >= until:
            break
        div = DIV_GROUP.get(D.division[i], D.division[i])
        a, b = D.ia[i], D.ib[i]
        for j, dim in enumerate(dims):
            prm = DP[dim]
            q, v0, size = prm["q"], prm["v0"], prm["k"]
            kind = DIMS[dim][1]
            S = []
            for p in (a, b):
                s = st.get((p, dim))
                if s is None:
                    s = [0.0, v0, 0.0, v0, d]
                    st[(p, dim)] = s
                else:
                    gap = (d - s[4]) / YEAR
                    s[1] = min(v0, s[1] + q * gap)
                    s[3] = min(v0, s[3] + q * gap)
                    s[4] = d
                S.append(s)
            if record:
                pre[i, 0, j] = S[0][:4]
                pre[i, 1, j] = S[1][:4]
            bc, be = base[(div, dim)]
            if kind == "bin":
                bl = math.log((bc + 50 * prior_rate[dim]) / (be - bc + 50 * (1 - prior_rate[dim])))
            else:
                bl = math.log((bc + 20 * prior_rate[dim]) / (be + 20))
            # pre-fight expected rate in natural units for both directions (A on B, B on A), stats or not
            for s_, (att, dfn) in enumerate(((S[0], S[1]), (S[1], S[0]))):
                e_ = bl + att[0] - dfn[2]
                pred[i, s_, j] = 1.0 / (1.0 + math.exp(-e_)) if kind == "bin" else math.exp(e_)
            o = obs[dim][i]
            if np.isnan(o[0, 0]):
                continue
            lls = 0.0
            for s_, (att, dfn) in enumerate(((S[0], S[1]), (S[1], S[0]))):
                k, ex = o[s_]
                eta = bl + att[0] - dfn[2]
                sv = att[1] + dfn[3]
                if kind == "bin":
                    if ex <= 0:
                        continue
                    pr = 1.0 / (1.0 + math.exp(-eta))
                    mu = ex * pr
                    sc = (k - mu) / size          # size = overdispersion factor phi for accuracy
                    info = ex * pr * (1 - pr) / size
                    lls += float(-(k * math.log(pr + 1e-12) + (ex - k) * math.log(1 - pr + 1e-12))
                                 + (k * math.log(k / ex + 1e-12) + (ex - k) * math.log(1 - k / ex + 1e-12)))
                else:
                    if ex <= 0:
                        continue
                    mu = math.exp(eta) * ex
                    if kind == "nb":
                        sc = (k - mu) * size / (size + mu)
                        info = mu * size / (size + mu)
                        lls += float(-_nb_ll(k, mu, size))
                    else:
                        sc = (k - mu) / size
                        info = mu / size
                        lls += float((mu - k * math.log(mu + 1e-12)) / size)
                den = 1.0 + info * sv
                att[0] += att[1] * sc / den
                dfn[2] -= dfn[3] * sc / den
                att[1] -= att[1] * att[1] * info / den
                dfn[3] -= dfn[3] * dfn[3] * info / den
                att[1] = max(att[1], 1e-5)
                dfn[3] = max(dfn[3], 1e-5)
            pll[i, j] = lls
            # update the baseline after the fight
            for s_ in (0, 1):
                k, ex = o[s_]
                base[(div, dim)][0] = base[(div, dim)][0] * rho + k
                base[(div, dim)][1] = base[(div, dim)][1] * rho + ex
    rates = {}
    for (div, dim), (bc, be) in base.items():
        if DIMS[dim][1] == "bin":
            rates.setdefault(div, {})[dim] = (bc + 50 * prior_rate[dim]) / (be + 50)
        else:
            rates.setdefault(div, {})[dim] = (bc + 20 * prior_rate[dim]) / (be + 20)
    st["_base"] = rates
    return pre, pred, pll, st


def dim_features(pre, dims):
    """Antisymmetric matchup features from pre-fight dim states: expected log-rate advantage per dim
    ((off_A - def_B) - (off_B - def_A))."""
    om = pre[:, :, :, 0]
    dm = pre[:, :, :, 2]
    adv = (om[:, 0] - dm[:, 1]) - (om[:, 1] - dm[:, 0])
    return adv


# =====================================================================================================
# pre-UFC records (tools/preufc.py output, Sherdog, walk-forward per UFC bout) for newcomer priors
# =====================================================================================================
PREUFC = os.path.join(ROOT, "data", "derived", "preufc.json")
# Coverage guard. preufc.json crawled the roster plus every fighter with 0-3 prior UFC bouts in a UFC bout on or after
# 2015-01-01, so EVERY UFC debut from 2015 on has a snapshot (1,373 of 1,373 checked on Nov 6, 2026), whatever that
# fighter did afterwards. Debuts before 2015 were crawled only when the fighter was still around in 2015 or is on the
# current roster (survivors), so a term that is non-zero only for crawled fighters would leak future survival (an
# earlier partial crawl "improved" 2019-2023 log loss by 0.019 that way). The pre-UFC prior is therefore applied only to
# debuts on or after PRE_FROM, where its presence is outcome-independent; older debuts keep the age-only prior.
PRE_ON = True
PRE_FROM = dt.date(2015, 1, 1).toordinal()
PRE_FEATS = ["win share (shrunk) - 0.8", "log1p(non-UFC pro fights) - 2.4", "Sherdog-network Elo: (net_elo - 1600)/100",
             "Contender Series win - 0.28", "feeder promotion graduates' UFC win rate: (promo_grad - 0.5) x 10",
             "log1p(non-UFC wins over opponents with UFC experience)", "feeder promotion volume: promo_feed - 2.5"]
PRE_KEYS = ["pre_wp", "pre_n", "pre_net", "pre_dwcs", "pre_grad", "pre_oppufc", "pre_feed"]


def attach_preufc(D):
    """D.pre[i, side] = the PRE_FEATS vector (centred near the 2015+ debut means) as of the bout, from preufc.json
    walk-forward snapshots (Sherdog fights strictly before the bout date); nan when not crawled."""
    D.pre = np.full((D.n, 2, len(PRE_KEYS)), np.nan)
    D.pre_cov = 0
    if not os.path.exists(PREUFC):
        return
    try:
        J = json.load(open(PREUFC))
    except Exception:
        return
    cols = J["meta"]["snapshot_columns"]
    if isinstance(cols, str):
        import ast
        cols = ast.literal_eval(cols)
    ci = {c: k for k, c in enumerate(cols)}
    slug2p = {s: k for k, s in enumerate(D.slug)}
    hit = 0

    def g(row, c, default=0.0):
        v = row[ci[c]] if c in ci else None
        return default if v is None else v
    for slug, rec in J.get("fighters", {}).items():
        p = slug2p.get(slug)
        if p is None or not rec.get("snapshots"):
            continue
        for row in rec["snapshots"]:
            i = D.fidx.get(row[ci["fid"]])
            if i is None:
                continue
            side = 0 if D.ia[i] == p else (1 if D.ib[i] == p else -1)
            if side < 0:
                continue
            w, n = g(row, "w"), g(row, "n")
            D.pre[i, side] = ((w + 1.4) / (n + 2.0) - 0.8, math.log1p(n) - 2.4,
                              (g(row, "net_elo", 1600.0) - 1600.0) / 100.0,
                              (1.0 if g(row, "dwcs_w") > 0 else 0.0) - 0.28,
                              (g(row, "promo_grad", 0.5) - 0.5) * 10.0,
                              math.log1p(g(row, "opp_ufc_w")),
                              g(row, "promo_feed", 2.5) - 2.5)
            hit += 1
    D.pre_cov = hit


def newcomer_i(D, P, i, side, age):
    m = newcomer(age, P)
    if P.get("pre_on") and D.day[i] >= PRE_FROM:
        f = D.pre[i, side]
        if f[0] == f[0]:
            m += sum(P.get(k, 0.0) * f[j] for j, k in enumerate(PRE_KEYS))
    return m


# =====================================================================================================
# preparation
# =====================================================================================================
def prepare(D, log=print):
    attach_preufc(D)
    log("pre-UFC snapshots attached: %d fighter-bouts" % D.pre_cov)
    beta, ncards, nrows = fit_round_model(D, TUNE_FROM)
    D.round_beta = beta
    agree = build_round_outcomes(D, beta)
    log("round model (EM on %d pre-2019 10-9 cards, %d card-rounds): %s; consensus round share picks the "
        "decision winner in %.1f%% of decisions" % (ncards, nrows, dict(zip(RF, np.round(beta, 3))),
                                                    100 * (agree or 0)))
    D.round_fit = {"n_cards": ncards, "n_card_rounds": nrows, "coef": dict(zip(RF, [float(b) for b in beta])),
                   "decision_winner_agreement": agree}
    D.dim_obs = dim_obs(D)
    # prior UFC fights per side (for the pre-2019 training rows of the second-stage models)
    seen = defaultdict(int)
    npa, npb = np.zeros(D.n, int), np.zeros(D.n, int)
    for i in range(D.n):
        npa[i], npb[i] = seen[D.ia[i]], seen[D.ib[i]]
        seen[D.ia[i]] += 1
        seen[D.ib[i]] += 1
    D.nprior_a, D.nprior_b = npa, npb
    elig = (npa >= 1) & (npb >= 1) & np.array([w in ("A", "B") for w in D.winner])
    elig &= np.array([not (D.pids[a].startswith("amb:") or D.pids[b].startswith("amb:"))
                      for a, b in zip(D.ia, D.ib)])
    D.idx_pre = np.where(elig & (D.day >= dt.date(2008, 1, 1).toordinal()) & (D.day < TUNE_FROM))[0]


# =====================================================================================================
# tuning
# =====================================================================================================
RUNNERS = {"elo": run_elo, "glicko2": run_glicko2, "trueskill": run_trueskill}
_G = {}


def run_system(D, kind, P, until=None, record=False, eval_idx=None):
    if kind == "whr":
        p, rec, model = run_whr(D, P, until=until, record=record, eval_idx=eval_idx)
        return p, rec, model
    return RUNNERS[kind](D, P, until=until, record=record)


def _eval(args):
    kind, P = args
    D = _G["D"]
    try:
        p, _, _ = run_system(D, kind, P, until=TEST_FROM, eval_idx=D.idx_tune)
    except Exception as e:      # a bad parameter combination scores as a failure, not a crash
        return {"tune": 9.0, "in_tr": 9.0, "in_va": 9.0, "err": repr(e)}
    return {"tune": score(D, p, D.idx_tune), "in_tr": score(D, p, D.idx_in_tr),
            "in_va": score(D, p, D.idx_in_va)}


def _refine(v, cands, coarse=False):
    if isinstance(v, bool) or isinstance(v, str):
        return cands
    if v == 0:
        return [] if coarse else cands
    fs = (0.75, 1.33) if coarse else (0.6, 0.8, 0.9, 1.1, 1.25, 1.6)
    return sorted({round(v * f, 6) for f in fs})


def coord_descent(kind, P0, grid, pool, passes=3, objective="tune", log=print, min_gain=2e-5, coarse=False):
    """Coordinate descent over parameter grids; objective = mean log loss on 2019-2023 ('tune') or on
    2019-2021 ('in_tr', for the time-ordered check). Data stream stops at 2024-01-01 in every trial."""
    best = dict(P0)
    r0 = _eval((kind, best)) if pool is None else pool.map(_eval, [(kind, best)])[0]
    best_r = r0
    hist = [{"params": dict(best), **r0}]
    for ps in range(passes):
        improved = False
        for name, cands in grid:
            cs = cands if ps == 0 else _refine(best.get(name, 0), cands, coarse)
            trials = [dict(best, **{name: c}) for c in cs if c != best.get(name)]
            if not trials:
                continue
            res = pool.map(_eval, [(kind, t) for t in trials]) if pool else [_eval((kind, t)) for t in trials]
            for t, r in zip(trials, res):
                hist.append({"params": {name: t[name]}, **r})
                if r[objective] < best_r[objective] - min_gain:
                    best, best_r, improved = t, r, True
            log("    %-10s pass %d  %-9s -> %-10s %s %.5f (2019-21 %.5f, 2022-23 %.5f)"
                % (kind, ps + 1, name, best.get(name), objective, best_r[objective], best_r["in_tr"],
                   best_r["in_va"]))
        if not improved:
            break
    return best, best_r, hist


# =====================================================================================================
# second-stage models (dimensional winner model, stacking): time-ordered CV inside 2019-2023
# =====================================================================================================
def logit(p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


def fit_lr(X, y, l2):
    beta, _ = _logit_fit(X, y, l2=l2)
    return beta


def fit_lr_nonneg(X, y, l2):
    """No-intercept logistic regression with non-negative weights (stacking: no system enters with a
    negative weight, which only ever exploits the difference of two correlated ratings)."""
    from scipy.optimize import minimize

    def f(b):
        z = X @ b
        p = expit(z)
        ll = -np.sum(y * np.log(p + 1e-12) + (1 - y) * np.log(1 - p + 1e-12)) + 0.5 * l2 * b @ b
        g = X.T @ (p - y) + l2 * b
        return ll, g
    r = minimize(f, np.full(X.shape[1], 1.0 / X.shape[1]), jac=True, method="L-BFGS-B",
                 bounds=[(0, None)] * X.shape[1])
    return r.x


def cv_lr(D, X, l2, idx, nonneg=False, X_extra=None, y_extra=None, years=range(2020, 2024)):
    """Expanding-window CV by year inside idx (2019-2023): train on years < y (plus optional always-earlier rows
    X_extra / y_extra, e.g. 2008-2018), predict year y. Returns pooled out-of-fold log loss and the OOF vector."""
    yrs = D.year[idx]
    y = D.y[idx]
    oof = np.full(len(idx), np.nan)
    for yr in years:
        tr, va = yrs < yr, yrs == yr
        Xt, yt = X[tr], y[tr]
        if X_extra is not None:
            Xt, yt = np.vstack([X_extra, Xt]), np.concatenate([y_extra, yt])
        if len(yt) < 50 or va.sum() == 0:
            continue
        b = fit_lr_nonneg(Xt, yt, l2) if nonneg else fit_lr(Xt, yt, l2)
        oof[va] = expit(X[va] @ b)
    m = ~np.isnan(oof)
    return float(ll_vec(oof[m], y[m]).mean()), oof


def dims_tune(D, quick, log=print):
    """Per-dim process noise / prior variance / dispersion by one-step-ahead predictive likelihood of the
    stat itself on 2019-2023 fights (data stream cut at 2024-01-01)."""
    DP = {k: dict(v) for k, v in DIM_DEFAULT.items()}
    grids = {"q": [0.001, 0.0025, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2], "v0": [0.01, 0.02, 0.05, 0.1, 0.2, 0.4, 0.8],
             "k": [0.5, 1, 2, 4, 8, 16, 32]}
    tune_mask = (D.day >= TUNE_FROM) & (D.day < TEST_FROM)
    hist = {}
    for j, dim in enumerate(DIMS):
        def obj(prm):
            _, _, pll, _ = run_dims(D, {dim: prm}, until=TEST_FROM, record=False, dims=[dim])
            v = pll[tune_mask, 0]
            return float(np.nanmean(v))
        best = DP[dim]
        bs = obj(best)
        for ps in range(1 if quick else 2):
            for name in ("k", "q", "v0"):
                cands = grids[name] if ps == 0 else _refine(best[name], grids[name])
                for c in cands:
                    if c == best[name]:
                        continue
                    t = dict(best, **{name: c})
                    s = obj(t)
                    if s < bs - 1e-5:
                        best, bs = t, s
        DP[dim] = best
        hist[dim] = {"params": best, "pred_nll_per_fight_2019_2023": bs}
        log("    dim %-4s q=%.4f v0=%.3f k=%.2f  predictive NLL %.4f" % (dim, best["q"], best["v0"], best["k"], bs))
    return DP, hist


# =====================================================================================================
# system specifications
# =====================================================================================================
def specs(quick):
    LN = LN10_400
    shared = [("mu_new", [-0.3, -0.2, -0.1, 0.0]), ("age_new", [-0.04, -0.02, 0.0, 0.02]),
              ("dy", [0.0, 0.02, 0.05, 0.1]), ("do", [0.0, 0.01, 0.02, 0.04, 0.08]),
              ("ay", [25.0, 27.0, 29.0, 31.0]), ("ao", [29.0, 31.0, 33.0, 35.0]),
              ("dl", [0.0, 0.03, 0.06, 0.1, 0.15]), ("nl", [2.0, 4.0, 8.0]), ("lay", [0.0, 0.05, 0.1, 0.2]),
              ("kappa", [0.8, 0.9, 1.0, 1.1, 1.2])]
    pre = [("pre_net", [0.0, 0.1, 0.2, 0.35, 0.5]), ("pre_wp", [0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0]),
           ("pre_n", [-0.1, 0.0, 0.1, 0.2]), ("pre_dwcs", [-0.1, 0.0, 0.1, 0.2]), ("pre_grad", [0.0, 0.03, 0.06, 0.1]),
           ("pre_oppufc", [0.0, 0.05, 0.1, 0.2]), ("pre_feed", [-0.05, 0.0, 0.03, 0.06, 0.1])]
    if PRE_ON:
        shared = shared[:2] + pre + shared[2:]
    mov = [("y_ud", [0.8, 0.9, 1.0]), ("y_sd", [0.5, 0.6, 0.7, 0.85, 1.0]), ("w_fin", [1.0, 1.2, 1.5, 2.0]),
           ("w_r1", [1.0, 1.2, 1.5])]
    rnd = [("w_fround", [0.5, 1.0, 2.0, 3.0, 5.0]), ("w_rem", [0.0, 0.25, 0.5, 1.0]),
           ("kappa", [1.0, 1.5, 2.0, 2.5, 3.0, 4.0])]
    S = []
    S.append({"name": "elo_ref", "kind": "elo", "family": "Elo",
              "label": "Elo K=44 (x1.5 for the first 5 UFC fights): the project's existing baseline",
              "P": {"K": 44 * LN, "boost": 1.5, "boost_n": 5}, "grid": None})
    S.append({"name": "elo_k", "kind": "elo", "family": "Elo",
              "label": "Elo, K schedule tuned (newcomer boost decaying with fights, layoff boost)",
              "P": {"K": 44 * LN, "kb": 0.5, "kn": 3.0},
              "grid": [("K", [0.15, 0.2, 0.25, 0.3, 0.35, 0.45]), ("kb", [0.0, 0.25, 0.5, 1.0, 1.5]),
                       ("kn", [1.0, 2.0, 4.0, 8.0]), ("kl", [0.0, 0.1, 0.25, 0.5])]})
    S.append({"name": "elo_full", "kind": "elo", "family": "Elo",
              "label": "Elo + margin of victory (method/round/decision type) + newcomer prior by age + skill "
                       "trajectory (age curve, early-career learning, layoff)",
              "P": {"K": 44 * LN, "kb": 0.5, "kn": 3.0, "enc": "mov", "pre_on": PRE_ON},
              "from": "elo_k",
              "grid": [("K", [0.15, 0.2, 0.25, 0.3, 0.35]), ("kb", [0.0, 0.25, 0.5, 1.0]),
                       ("kn", [1.0, 2.0, 4.0, 8.0]), ("kl", [0.0, 0.1, 0.25])] + mov + shared})
    S.append({"name": "elo_rounds", "kind": "elo", "family": "Round-level",
              "label": "Round-level Elo: every round a game (judge-consensus round winners, stat model "
                       "elsewhere), finishing round weighted, unplayed rounds to the finisher",
              "P": {"K": 0.06, "enc": "rounds", "w_round": 1.0, "w_fround": 2.0, "w_rem": 0.5, "kappa": 2.5,
                    "kb": 0.5, "kn": 3.0, "pre_on": PRE_ON},
              "grid": [("K", [0.01, 0.015, 0.02, 0.03, 0.045, 0.06, 0.08]), ("kb", [0.0, 0.5, 1.0]),
                       ("kn", [1.0, 3.0, 8.0])] + rnd + [g for g in shared if g[0] != "kappa"]})
    S.append({"name": "glicko2", "kind": "glicko2", "family": "Glicko-2",
              "label": "Glicko-2: rating deviation inflating with inactivity, volatility, newcomer prior, age "
                       "drift, margin-weighted games",
              "P": {"phi0": 1.2, "sig0": 0.06, "tau": 0.3, "T": 60.0, "enc": "mov", "pre_on": PRE_ON},
              "grid": [("phi0", [0.6, 0.9, 1.2, 1.6, 2.0]), ("sig0", [0.02, 0.04, 0.06, 0.1, 0.15]),
                       ("tau", [0.1, 0.3, 0.6, 1.0]), ("T", [20.0, 40.0, 60.0, 120.0, 240.0])] + mov + shared})
    S.append({"name": "trueskill", "kind": "trueskill", "family": "TrueSkill",
              "label": "TrueSkill-like Gaussian (probit) ratings, binary outcome, skill variance growing with "
                       "time and per fight",
              "P": {"s0": 1.0, "tau_y": 0.3, "gam": 0.1, "pre_on": PRE_ON},
              "grid": [("s0", [0.5, 0.8, 1.0, 1.3, 1.7]), ("tau_y", [0.05, 0.1, 0.2, 0.3, 0.5]),
                       ("gam", [0.0, 0.1, 0.2, 0.3])] + [(k, [round(1.5 * v, 4) for v in vals])
                                                         if k in ("mu_new", "age_new", "dy", "do", "dl", "lay")
                                                         or k.startswith("pre_")
                                                         else (k, vals)
                                                         for k, vals in shared]})
    S.append({"name": "trueskill_mov", "kind": "trueskill", "family": "TrueSkill",
              "label": "TrueSkill with method-aware (ordinal) outcomes: finishes and unanimous decisions "
                       "truncate the performance gap further out, split decisions to a band near zero",
              "P": {"s0": 1.0, "tau_y": 0.3, "gam": 0.1, "ordinal": True, "th_fin": 0.3, "th_ud": 0.2,
                    "th_sd": 1.0, "pre_on": PRE_ON},
              "from": "trueskill",
              "grid": [("th_fin", [0.0, 0.2, 0.4, 0.7, 1.0]), ("th_ud", [0.0, 0.1, 0.2, 0.4, 0.6]),
                       ("th_sd", [0.3, 0.6, 1.0, 2.0, 1e10]), ("w_fin", [0.8, 1.0, 1.25, 1.5]),
                       ("s0", [0.5, 0.8, 1.0, 1.3]), ("tau_y", [0.05, 0.1, 0.2, 0.3]),
                       ("gam", [0.0, 0.1, 0.2, 0.3]), ("kappa", [0.8, 0.9, 1.0, 1.1, 1.2])]})
    whr_core = [("w2", [0.02, 0.05, 0.1, 0.2]), ("vf", [0.0, 0.02, 0.05]), ("s0", [0.5, 0.8, 1.1, 1.5])]
    S.append({"name": "whr", "kind": "whr", "family": "WHR",
              "label": "Whole-History Rating (Bayesian Bradley-Terry, Gaussian random-walk skill, history re-solved "
                       "before every fight day), binary outcomes",
              "P": {"w2": 0.05, "vf": 0.02, "s0": 0.8, "pre_on": PRE_ON}, "from_shared": "elo_full", "coarse": True,
              "grid": whr_core + [("kappa", [0.9, 1.0, 1.1, 1.2]), ("do", [0.01, 0.02, 0.04]),
                                  ("dl", [0.0, 0.05, 0.1]), ("mu_new", [-0.3, -0.15, 0.0])]
              + ([("pre_net", [0.1, 0.2, 0.35, 0.5]), ("pre_wp", [2.0, 3.0, 4.0, 5.0])] if PRE_ON else [])})
    S.append({"name": "whr_mov", "kind": "whr", "family": "WHR",
              "label": "WHR with margin of victory (fractional / weighted outcomes by method)",
              "P": {"enc": "mov", "pre_on": PRE_ON}, "from": "whr", "from_mov": "elo_full", "coarse": True,
              "grid": [("y_sd", [0.6, 0.75, 0.9, 1.0]), ("w_fin", [1.0, 1.3, 1.6]), ("y_ud", [0.85, 1.0]),
                       ("kappa", [0.9, 1.0, 1.1, 1.2]), ("w2", [0.02, 0.05, 0.1])]})
    S.append({"name": "whr_rounds", "kind": "whr", "family": "Round-level",
              "label": "Round-level WHR: every round a game (judge-consensus winners), finishing and unplayed "
                       "rounds to the finisher",
              "P": {"enc": "rounds", "w_round": 0.3, "kappa": 2.0, "pre_on": PRE_ON}, "from": "whr",
              "from_rounds": "elo_rounds", "coarse": True,
              "grid": [("w_round", [0.15, 0.25, 0.4, 0.6]), ("kappa", [1.5, 2.0, 2.5, 3.0, 4.0]),
                       ("w2", [0.01, 0.02, 0.05, 0.1]), ("s0", [0.3, 0.5, 0.8]), ("w_fround", [1.0, 2.0, 3.0]),
                       ("w_rem", [0.0, 0.5, 1.0])]})
    if quick:
        for s in S:
            if s["grid"]:
                s["grid"] = s["grid"][:4]
    return S


# =====================================================================================================
# analysis: market benchmark, residual signal beyond the rating, experience buckets, matchups
# =====================================================================================================
MARKET = os.path.join(ROOT, "data", "derived", "market.json")


def market_probs(D):
    """Closing-line probability for A (power de-vig, else proportional) from tools/market.py output."""
    p = np.full(D.n, np.nan)
    if not os.path.exists(MARKET):
        return p
    try:
        M = json.load(open(MARKET))["fights"]
    except Exception:
        return p
    for fid, e in M.items():
        i = D.fidx.get(fid)
        if i is None:
            continue
        v = e.get("p_power_close", e.get("p_novig_close"))
        if v is not None:
            p[i] = v
    return p


def residual_features(D):
    """Antisymmetric A-minus-B pre-fight features for residual checks (all known before the fight)."""
    prof = {}
    for i in range(D.n):
        pass
    age = np.nan_to_num(D.age_a - D.age_b)
    ht = np.zeros(D.n)
    rc = np.zeros(D.n)
    for p, i in D.pid.items():
        pass
    H = {}
    Rr = {}
    for p, k in D.pid.items():
        T = (D.people.get(p) or {}).get("tott") or {}
        H[k], Rr[k] = T.get("height_in"), T.get("reach_in")
    for i in range(D.n):
        ha, hb = H.get(D.ia[i]), H.get(D.ib[i])
        ra, rb = Rr.get(D.ia[i]), Rr.get(D.ib[i])
        ht[i] = (ha - hb) if (ha and hb) else 0.0
        rc[i] = (ra - rb) if (ra and rb) else 0.0
    exp_ = np.log1p(D.nprior_a) - np.log1p(D.nprior_b)
    # layoff (years since last UFC fight, capped at 3)
    last = {}
    lay = np.zeros(D.n)
    for i in range(D.n):
        la = min(3.0, (D.day[i] - last[D.ia[i]]) / YEAR) if D.ia[i] in last else 0.0
        lb = min(3.0, (D.day[i] - last[D.ib[i]]) / YEAR) if D.ib[i] in last else 0.0
        lay[i] = la - lb
        last[D.ia[i]] = D.day[i]
        last[D.ib[i]] = D.day[i]
    old = np.nan_to_num(np.maximum(D.age_a - 34, 0) - np.maximum(D.age_b - 34, 0))
    return {"age_gap_years": age, "years_past_34_gap": old, "reach_gap_in": rc, "height_gap_in": ht,
            "log_ufc_fights_gap": exp_, "layoff_gap_years": lay}


def analysis(D, preds, best, it, ix, no_test, log):
    out = {}
    y = D.y
    zb = logit(preds[best])
    # residual signal beyond the best rating: one feature at a time, fit on 2019-2023
    feats = residual_features(D)
    res = {}
    for k, f in feats.items():
        X = np.c_[zb, f]
        b, Hh = _logit_fit(X[it], y[it], l2=1e-6)
        se = np.sqrt(np.diag(np.linalg.inv(Hh)))
        r = {"coef_rating": round(float(b[0]), 4), "coef": round(float(b[1]), 4), "se": round(float(se[1]), 4)}
        if not no_test:
            p1 = expit(X[ix] @ b)
            b0, _ = _logit_fit(zb[it][:, None], y[it])
            p0 = expit(zb[ix] * b0[0])
            r["test_dll_vs_rating_rescaled"] = round(float(ll_vec(p1, y[ix]).mean() - ll_vec(p0, y[ix]).mean()), 5)
        res[k] = r
    out["residual_beyond_best"] = res
    log("residual signal beyond %s (2019-2023 fit; coef per unit A-minus-B, se): %s"
        % (best, {k: (v["coef"], v["se"]) for k, v in res.items()}))
    # experience buckets
    if not no_test:
        mn = np.minimum(D.nprior_a, D.nprior_b)
        buckets = [(1, 2), (3, 5), (6, 10), (11, 99)]
        eb = {}
        for lo_, hi_ in buckets:
            m = ix[(mn[ix] >= lo_) & (mn[ix] <= hi_)]
            eb["%d-%d" % (lo_, hi_)] = {"n": int(len(m)),
                                        best: round(float(ll_vec(preds[best][m], y[m]).mean()), 5),
                                        "elo_ref": round(float(ll_vec(preds["elo_ref"][m], y[m]).mean()), 5)}
        out["test_by_min_prior_fights"] = eb
        log("2024+ log loss by the less experienced man's prior UFC fights: %s" % eb)
    # market benchmark (closing line, known only minutes before the bout: a benchmark, not a feature)
    pm = market_probs(D)
    if not np.isnan(pm[it]).all():
        mt = it[~np.isnan(pm[it])]
        zm = logit(pm)
        bm, _ = _logit_fit(np.c_[zm, zb][mt], y[mt], l2=1e-6)
        mk = {"tune_n": int(len(mt)), "tune_market": metrics(pm[mt], y[mt]), "stack_coef_market_rating": [
            round(float(bm[0]), 4), round(float(bm[1]), 4)]}
        if not no_test:
            mx = ix[~np.isnan(pm[ix])]
            mk["test_n"] = int(len(mx))
            mk["test_market"] = metrics(pm[mx], y[mx])
            mk["test_best_same_fights"] = metrics(preds[best][mx], y[mx])
            mk["test_market_plus_best"] = metrics(expit(np.c_[zm, zb][mx] @ bm), y[mx])
            mk["corr_logit_market_best"] = round(float(np.corrcoef(zm[mx], zb[mx])[0, 1]), 4)
            log("market close 2024+ (n=%d): LL %.5f; %s on the same fights %.5f; market+%s stack %.5f"
                % (len(mx), mk["test_market"]["log_loss"], best, mk["test_best_same_fights"]["log_loss"], best,
                   mk["test_market_plus_best"]["log_loss"]))
        out["market_benchmark"] = mk
    return out


def matchup_probs(roster, sys_params, a, b, stack=None, dims_coef=None, baselines=None):
    """P(a beats b) from each system's current roster ratings (uncertainty included where the system has it)."""
    A, Bb = roster.get(a), roster.get(b)
    if not A or not Bb:
        return None
    out = {}
    for name, P in sys_params.items():
        ra, rb = A.get(name), Bb.get(name)
        if not ra or not rb or ra.get("mu") is None or rb.get("mu") is None:
            continue
        kind = P["_kind"]
        kap = P.get("kappa", 1.0)
        d = ra["mu"] - rb["mu"]
        if kind == "elo":
            p = expit(kap * d)
        elif kind == "glicko2":
            g = 1.0 / math.sqrt(1.0 + 3.0 * (ra["sd"] ** 2 + rb["sd"] ** 2) / math.pi ** 2)
            p = expit(kap * g * d)
        elif kind == "trueskill":
            p = float(ndtr(kap * d / math.sqrt(2.0 + ra["sd"] ** 2 + rb["sd"] ** 2)))
        else:
            vd = ra["sd"] ** 2 + rb["sd"] ** 2
            p = expit(kap * d / math.sqrt(1.0 + math.pi * kap * kap * vd / 8.0))
        out[name] = round(float(p), 4)
    if dims_coef and A.get("dims") and Bb.get("dims"):
        base = (baselines or {}).get(A.get("division")) or (baselines or {}).get(Bb.get("division")) or {}
        z, ok = 0.0, True
        for feat, c in dims_coef.items():
            kind_, dim = feat.split("_", 1)
            da, db = A["dims"].get(dim), Bb["dims"].get(dim)
            if not da or not db:
                ok = False
                continue
            ea, eb = da["off"] - db["def"], db["off"] - da["def"]
            if kind_ == "adv":
                z += c * (ea - eb)
            else:
                b0 = base.get(dim)
                if b0 is None:
                    ok = False
                    continue
                if DIMS[dim][1] == "bin":
                    l0 = math.log(b0 / (1 - b0))
                    z += c * (expit(l0 + ea) - expit(l0 + eb))
                else:
                    z += c * b0 * (math.exp(ea) - math.exp(eb))
        if ok:
            out["dims"] = round(float(expit(z)), 4)
    if stack and all(m in out for m in stack[0]):
        z = sum(w * float(logit(np.array([out[m]]))[0]) for m, w in zip(stack[0], stack[1]))
        out["stack"] = round(float(expit(z)), 4)
    return out


# =====================================================================================================
# final runs, outputs
# =====================================================================================================
SHARED_KEYS = ("mu_new", "age_new", "dy", "do", "ay", "ao", "dl", "nl", "lay", "pre_on") + tuple(PRE_KEYS)
MOV_KEYS = ("y_ud", "y_sd", "y_dq", "w_fin", "w_r1")


def r5(x, d=4):
    if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))):
        return None
    return round(float(x), d)


def roster_states(D, finals, DP, dim_state, ref_day):
    """Current ratings (as of ref_day) of every fighter in fighters.json, keyed by slug."""
    prof = json.load(open(FIGHTERS))["fighters"]
    slug2p = {s: k for k, s in enumerate(D.slug)}
    players = [slug2p[s] for s in prof if s in slug2p]
    out = {}
    whr_states = {}
    for name, F in finals.items():
        if F["kind"] == "whr":
            whr_states[name] = F["model"].final_state(players, ref_day)
    for s in prof:
        p = slug2p.get(s)
        if p is None:
            continue
        age = (ref_day - D.dob[p]) / YEAR if D.dob[p] == D.dob[p] else float("nan")
        row = {"name": D.name[p], "division": prof[s].get("division"), "last_fight": prof[s].get("last_fight"),
               "age": r5(age, 2)}
        for name, F in finals.items():
            P, st, kind = F["P"], F["state"], F["kind"]
            dy, do = P.get("dy", 0.0), P.get("do", 0.0)
            if kind == "elo":
                if p not in st["r"]:
                    continue
                gap = (ref_day - st["last"][p]) / YEAR
                m = st["r"][p] + drift(P, age, gap, st["n"][p])
                row[name] = {"mu": r5(m), "n": int(st["n"][p])}
            elif kind == "glicko2":
                if p not in st["mu"]:
                    continue
                gap = ref_day - st["last"][p]
                m = st["mu"][p] + drift(P, age, gap / YEAR, st["n"][p])
                ph = min(P["phi0"], math.sqrt(st["phi"][p] ** 2 + st["sig"][p] ** 2 * gap / P["T"]))
                row[name] = {"mu": r5(m), "sd": r5(ph), "vol": r5(st["sig"][p], 5),
                             "elo_scale": r5(1500 + 173.7178 * m, 1)}
            elif kind == "trueskill":
                if p not in st["mu"]:
                    continue
                gap = (ref_day - st["last"][p]) / YEAR
                m = st["mu"][p] + drift(P, age, gap, st["n"][p])
                v = min(P["s0"] ** 2, st["var"][p] + P["tau_y"] ** 2 * gap + P.get("gam", 0.0) ** 2)
                row[name] = {"mu": r5(m), "sd": r5(math.sqrt(v))}
            elif kind == "whr":
                w = whr_states[name].get(p)
                if w:
                    row[name] = {"mu": r5(w[0]), "sd": r5(w[1]), "mu_last_fight": r5(w[2]), "sd_last_fight": r5(w[3])}
        dims = {}
        for dim in DIMS:
            stt = dim_state.get((p, dim))
            if stt is None:
                continue
            gap = (ref_day - stt[4]) / YEAR
            q, v0 = DP[dim]["q"], DP[dim]["v0"]
            dims[dim] = {"off": r5(stt[0]), "off_sd": r5(math.sqrt(min(v0, stt[1] + q * gap))),
                         "def": r5(stt[2]), "def_sd": r5(math.sqrt(min(v0, stt[3] + q * gap)))}
        if dims:
            row["dims"] = dims
        out[s] = row
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--quick", action="store_true", help="small tuning grids (smoke test)")
    ap.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    ap.add_argument("--skip-whr", action="store_true", help="leave the WHR systems out (fast run)")
    ap.add_argument("--out", default=OUT_JSON)
    ap.add_argument("--no-test", action="store_true", help="smoke run: never compute or print 2024+ metrics")
    ap.add_argument("--no-tune", action="store_true", help="smoke run: default parameters, no grid search")
    ap.add_argument("--ckpt", default=None, help="checkpoint file: each system's tuning result is saved as soon as "
                                                  "it finishes and reused on a restart when its start point and grid "
                                                  "are unchanged")
    args = ap.parse_args()
    t0 = time.time()
    logs = []

    def log(s):
        print(s, flush=True)
        logs.append(s)

    D = load_data()
    log("loaded %d bouts, %d fighters; tuning fights %d (2019-2023), held-out fights %d (2024+)"
        % (D.n, D.n_players, len(D.idx_tune), len(D.idx_test)))
    prepare(D, log)
    _G["D"] = D
    pool = Pool(args.jobs) if args.jobs > 1 else None
    S = specs(args.quick)
    if args.skip_whr:
        S = [s for s in S if s["kind"] != "whr"]
    tuned, tune_res, hists, inner = {}, {}, {}, {}
    ck = {}
    if args.ckpt and os.path.exists(args.ckpt):
        try:
            ck = json.load(open(args.ckpt))
        except Exception:
            ck = {}

    def ck_save():
        if args.ckpt:
            tmp = args.ckpt + ".tmp"
            with open(tmp, "w") as fh:
                json.dump(ck, fh)
            os.replace(tmp, args.ckpt)

    def sig(P0, grid):
        return json.dumps({"P0": P0, "grid": grid, "quick": args.quick, "no_tune": args.no_tune}, sort_keys=True,
                          default=str)
    for s in S:
        P0 = dict(s["P"])
        if s.get("from") in tuned:
            base = dict(tuned[s["from"]])
            base.update({k: v for k, v in P0.items() if k not in base or k in ("enc", "ordinal", "pre_on")})
            P0 = base
        if s.get("from_shared") in tuned:
            P0.update({k: v for k, v in tuned[s["from_shared"]].items() if k in SHARED_KEYS})
        if s.get("from_mov") in tuned:
            P0.update({k: v for k, v in tuned[s["from_mov"]].items() if k in MOV_KEYS})
        if s.get("from_rounds") in tuned:
            P0.update({k: v for k, v in tuned[s["from_rounds"]].items() if k in ("w_fround", "w_rem")})
        if s.get("from_whr") in tuned:
            P0.update({k: v for k, v in tuned[s["from_whr"]].items() if k in SHARED_KEYS + ("w2", "vf", "s0")})
        if s["kind"] == "trueskill" and s["name"] == "trueskill":
            pass
        ts = time.time()
        key = sig(P0, s["grid"])
        c = ck.get(s["name"])
        if c and c.get("sig") == key:
            tuned[s["name"]], tune_res[s["name"]], hists[s["name"]] = c["best"], c["r"], c["hist"]
            if c.get("inner"):
                inner[s["name"]] = c["inner"]
            log("  -> %s restored from checkpoint: tune log loss %.5f" % (s["name"], c["r"]["tune"]))
            continue
        log("tuning %s (%s)" % (s["name"], s["label"]))
        if s["grid"] and not args.no_tune:
            passes = 1 if args.quick else (2 if s["kind"] == "whr" else 3)
            best, r, h = coord_descent(s["kind"], P0, s["grid"], pool, passes=passes, log=log,
                                       coarse=s.get("coarse", False))
        else:
            best, r, h = P0, _eval((s["kind"], P0)), []
        tuned[s["name"]], tune_res[s["name"]], hists[s["name"]] = best, r, h
        log("  -> %s tune log loss %.5f (2019-21 %.5f, 2022-23 %.5f) [%.0fs]"
            % (s["name"], r["tune"], r["in_tr"], r["in_va"], time.time() - ts))
        # time-ordered check: choose on 2019-2021 only, score the choice on 2022-2023
        if s["grid"] and s["kind"] != "whr" and not args.quick and not args.no_tune:
            b2, r2, _ = coord_descent(s["kind"], P0, s["grid"], pool, passes=2, objective="in_tr",
                                      log=lambda *_: None)
            inner[s["name"]] = {"chosen_on_2019_2021": {k: r5(v, 5) if isinstance(v, float) else v
                                                        for k, v in b2.items()},
                                "score_2022_2023": r2["in_va"], "score_2019_2021": r2["in_tr"]}
            log("  time-ordered check: tuned on 2019-21 only -> 2022-23 log loss %.5f" % r2["in_va"])
        ck[s["name"]] = {"sig": key, "best": best, "r": r, "hist": h, "inner": inner.get(s["name"])}
        ck_save()
    # dimensional ratings
    log("tuning dimensional ratings (predictive likelihood of each stat, 2019-2023)")
    if args.no_tune:
        DP, dim_hist = {k: dict(v) for k, v in DIM_DEFAULT.items()}, {}
    elif ck.get("_dims", {}).get("quick") == args.quick:
        DP, dim_hist = ck["_dims"]["DP"], ck["_dims"]["hist"]
        log("  dims restored from checkpoint")
    else:
        DP, dim_hist = dims_tune(D, args.quick, log)
        ck["_dims"] = {"quick": args.quick, "DP": DP, "hist": dim_hist}
        ck_save()
    if pool:
        pool.close()

    # ------------------------------------------------------------------ final walk-forward runs (2019-2026)
    log("final runs with the tuned parameters (the only pass that reaches 2024+)")
    finals, preds, recs = {}, {}, {}
    for s in S:
        P = tuned[s["name"]]
        ts = time.time()
        p, rec, st = run_system(D, s["kind"], P, record=True, eval_idx=D.bt_idx)
        F = {"kind": s["kind"], "P": P, "state": st if s["kind"] != "whr" else None,
             "model": st if s["kind"] == "whr" else None}
        finals[s["name"]] = F
        preds[s["name"]] = p
        recs[s["name"]] = rec
        log("  %s done [%.0fs]" % (s["name"], time.time() - ts))
    dpre, dpred, dpll, dstate = run_dims(D, DP, record=True)
    adv = dim_features(dpre, list(DIMS))                      # (n, n_dims)

    # dimensional winner model: logistic (no intercept) on per-dim matchup advantages; L2 by time-ordered CV
    it, ix = D.idx_tune, D.idx_test
    ytr = D.y[it]
    best_l2, best_cv = None, 9
    Xd = np.nan_to_num(adv)
    cv_table = {}
    # expected-rate differentials in natural units keep the attacker-vs-defender interaction that the log
    # advantages lose ((off_A - def_B) - (off_B - def_A) is just net skill A minus net skill B)
    Xr = np.nan_to_num(dpred[:, 0, :] - dpred[:, 1, :])
    rsd = Xr[it].std(0) + 1e-9
    Xr = Xr / rsd
    asd = Xd[it].std(0) + 1e-9
    Xa = Xd / asd
    feature_sets = {"log_adv": Xa, "rate_diff": Xr, "both": np.c_[Xa, Xr]}
    dims_oof, best_fs = None, None
    ip = D.idx_pre               # 2008-2018 decisive bouts (both men with a prior UFC fight): always-earlier rows
    for fs, Xf in feature_sets.items():
        for l2 in (0.3, 1.0, 3.0, 10.0, 30.0, 100.0, 300.0):
            cvll, oof = cv_lr(D, Xf[it], l2, it, X_extra=Xf[ip], y_extra=D.y[ip], years=range(2019, 2024))
            cv_table["%s|%g" % (fs, l2)] = cvll
            if cvll < best_cv:
                best_l2, best_cv, dims_oof, best_fs = l2, cvll, oof, fs
    Xd = feature_sets[best_fs]
    bd = fit_lr(np.vstack([Xd[ip], Xd[it]]), np.concatenate([D.y[ip], ytr]), best_l2)
    p_dims = expit(Xd @ bd)
    preds["dims"] = p_dims.copy()
    preds["dims"][it] = dims_oof          # 2019-2023: out-of-fold (expanding window by year); 2024+: full fit
    fnames = {"log_adv": ["adv_" + d for d in DIMS], "rate_diff": ["rate_" + d for d in DIMS],
              "both": ["adv_" + d for d in DIMS] + ["rate_" + d for d in DIMS]}[best_fs]
    log("dims winner model: features %s, CV(2019-23, trained on 2008+ earlier years) log loss %.5f at l2=%g; "
        "standardized coefficients %s"
        % (best_fs, best_cv, best_l2, dict(zip(fnames, np.round(bd, 3)))))
    scale = {"adv_" + d: float(asd[j]) for j, d in enumerate(DIMS)}
    scale.update({"rate_" + d: float(rsd[j]) for j, d in enumerate(DIMS)})
    dims_model = {"features": best_fs, "l2": best_l2, "cv_log_loss": best_cv, "cv_table": cv_table,
                  "coef_standardized": dict(zip(fnames, [float(b) for b in bd])),
                  "feature_sd_2019_2023": {k: scale[k] for k in fnames},
                  "coef": {k: float(b) / scale[k] for k, b in zip(fnames, bd)}}
    tune_res["dims"] = {"tune": score(D, preds["dims"], it), "cv": best_cv,
                        "tune_in_sample": score(D, p_dims, it)}

    # ------------------------------------------------------------------ stacking (time-ordered CV, 2019-2023)
    singles = [s["name"] for s in S if s["name"] != "elo_ref"] + ["dims"]
    Z = {k: logit(preds[k]) for k in singles}
    chosen, cur = [], 9.0
    stack_path = []
    while True:
        best_add = None
        for k in singles:
            if k in chosen:
                continue
            X = np.c_[[Z[c][it] for c in chosen + [k]]].T
            cvll, _ = cv_lr(D, X, 1.0, it, nonneg=True)
            if cvll < cur - 1e-4 and (best_add is None or cvll < best_add[1]):
                best_add = (k, cvll)
        if not best_add:
            break
        chosen.append(best_add[0])
        cur = best_add[1]
        stack_path.append({"add": best_add[0], "cv_log_loss": cur})
    Xs = np.c_[[Z[c] for c in chosen]].T
    bs = fit_lr_nonneg(Xs[it], ytr, 1.0)
    preds["stack"] = expit(Xs @ bs)
    _, stack_oof = cv_lr(D, Xs[it], 1.0, it, nonneg=True)
    stack_in = preds["stack"][it].copy()
    preds["stack"][it] = np.where(np.isnan(stack_oof), stack_in, stack_oof)   # 2019: in-sample (no earlier fold)
    tune_res["stack"] = {"tune": score(D, preds["stack"], it), "cv": cur}
    log("stack: %s weights %s, CV(2020-23) log loss %.5f" % (chosen, np.round(bs, 3), cur))

    # ------------------------------------------------------------------ held-out evaluation (once)
    names = [s["name"] for s in S] + ["dims", "stack"]
    yte = D.y[ix]
    tune_m = {k: metrics(preds[k][it], ytr) for k in names}
    if args.no_test:
        ix = it          # smoke run: every "test" figure below is computed on the tuning window instead
        yte = ytr
        log("--no-test: 2024+ metrics are NOT computed; the test columns below repeat the tuning window")
    test = {k: metrics(preds[k][ix], yte) for k in names}
    boot = bootstrap(D, {k: preds[k] for k in names}, ix, base="elo_ref", B_=200 if args.no_test else 2000)
    calib = {k: calibration(preds[k][ix], yte) for k in names}
    # rank single systems on the same fights: 2020-2023 (prequential predictions for the rating systems,
    # expanding-window out-of-fold predictions for the dims model)
    m20 = D.year[it] >= 2020
    rank_score = {k: float(ll_vec(preds[k][it][m20], ytr[m20]).mean()) for k in names if k not in ("stack", "dims")}
    okd = ~np.isnan(dims_oof) & m20
    rank_score["dims"] = float(ll_vec(dims_oof[okd], ytr[okd]).mean())
    singles_rank = sorted(rank_score, key=lambda k: rank_score[k])
    best = singles_rank[0]
    log("held-out 2024+ (n=%d):" % len(ix))
    for k in names:
        log("  %-14s tune %.5f | test LL %.5f %s Brier %.5f acc %.3f ECE %.3f slope %.2f | dLL vs ref %+.5f (P<0 %.2f)"
            % (k, tune_m[k]["log_loss"], test[k]["log_loss"], boot[k]["log_loss_ci95"], test[k]["brier"],
               test[k]["accuracy"], calib[k]["ece"], calib[k]["slope_no_intercept"],
               boot[k].get("d_log_loss_vs_elo_ref", 0), boot[k].get("p_better_than_elo_ref", 0)))
    log("best single system by tuning-window score: %s" % best)
    extra = analysis(D, preds, best, it, ix if not args.no_test else it, args.no_test, log)

    # ------------------------------------------------------------------ outputs
    snap_day = D.day[-1]
    roster = roster_states(D, finals, DP, dstate, snap_day)
    pred_out = {}
    for i in D.bt_idx:
        fid = D.fid[i]
        split = "test" if D.day[i] >= TEST_FROM else "tune"
        e = {"date": D.fights[i].date.isoformat(), "A": D.slug[D.ia[i]], "B": D.slug[D.ib[i]],
             "y": None if np.isnan(D.y[i]) else float(D.y[i]), "split": split,
             "p": {k: r5(preds[k][i]) for k in names}}
        rr = {}
        for k in [s["name"] for s in S]:
            if recs[k] is not None:
                v = recs[k][i]
                rr[k] = [r5(v[0]), r5(v[1]), r5(v[2]), r5(v[3])]
        e["r"] = rr
        e["dims"] = {side: {dim: [r5(dpre[i, si, j, 0], 3), r5(dpre[i, si, j, 2], 3)] for j, dim in enumerate(DIMS)}
                     for si, side in enumerate(("A", "B"))}
        pred_out[fid] = e
    sys_out = {}
    for s in S:
        k = s["name"]
        sys_out[k] = {"kind": s["kind"], "family": s["family"], "label": s["label"],
                      "params": {a: (r5(b, 6) if isinstance(b, float) else b) for a, b in tuned[k].items()},
                      "tune_2019_2023": tune_m[k], "inner_2019_2021": tune_res[k]["in_tr"],
                      "inner_2022_2023": tune_res[k]["in_va"], "time_ordered_check": inner.get(k),
                      "test_2024_plus": test[k], "bootstrap": boot[k], "calibration": calib[k],
                      "trials": len(hists[k])}
    for k, lab in (("dims", "Dimensional ratings (striking volume/accuracy/power, takedowns, control, submissions; "
                             "offence and defence per fighter, Kalman updates) -> logistic winner model"),
                   ("stack", "Logistic stack of the rating systems (forward selection by time-ordered CV)")):
        sys_out[k] = {"kind": k, "family": "Dimensional" if k == "dims" else "Ensemble", "label": lab,
                      "tune_2019_2023": tune_m[k], "cv_2020_2023": tune_res[k]["cv"],
                      "test_2024_plus": test[k], "bootstrap": boot[k], "calibration": calib[k]}
    sys_out["dims"]["model"] = dims_model
    sys_out["dims"]["dim_params"] = DP
    sys_out["dims"]["dim_tuning"] = dim_hist
    sys_out["stack"]["members"] = chosen
    sys_out["stack"]["weights"] = [float(b) for b in bs]
    sys_out["stack"]["path"] = stack_path
    sys_params = {k: dict(tuned[k], _kind=finals[k]["kind"]) for k in finals}
    match = {}
    for a, b in (("alexander-volkanovski", "justin-gaethje"),):
        mp = matchup_probs(roster, sys_params, a, b, stack=(chosen, [float(v) for v in bs]),
                           dims_coef=dims_model["coef"],
                           baselines={d: dict(r) for d, r in dstate["_base"].items()})
        if mp:
            match["%s__%s" % (a, b)] = mp
            log("current ratings, P(%s beats %s): %s" % (a, b, mp))
    out = {
        "meta": {
            "built": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
            "snapshot": D.snapshot.isoformat(), "tool": "tools/ratings.py", "quick": args.quick,
            "n_bouts": D.n, "n_tune": len(it), "n_test": len(ix),
            "protocol": "walk-forward over every UFC bout since 1994 in date order (bout order inside a card); "
                        "parameters chosen by coordinate descent on 2019-2023 log loss with the data stream cut at "
                        "2024-01-01; second-stage models by expanding-window CV by year inside 2019-2023; 2024+ "
                        "scored once with the chosen settings; draws and no-contests excluded from winner metrics; "
                        "event-clustered bootstrap (2000 resamples) for CIs",
            "units": "all ratings in log-odds (logit) units except TrueSkill (probit units, performance noise "
                     "beta = 1); P(A) = sigmoid(kappa * (mu_A - mu_B)) for Elo; Glicko-2 and WHR shrink the "
                     "difference by the combined uncertainty",
            "round_model": D.round_fit, "preufc_coverage_fighter_bouts": int(D.pre_cov),
            "best_single_by_tuning": best, "ranking_by_tuning": singles_rank,
            "ranking_scores_2020_2023": {k: r5(v, 5) for k, v in rank_score.items()},
            "stack_cv_2020_2023": r5(cur, 5),
            "log": logs,
            "runtime_s": round(time.time() - t0),
        },
        "systems": sys_out,
        "analysis": extra,
        "dim_baselines": {"note": "league rate per division at the snapshot (exponentially weighted, ~300-fight "
                                  "memory); a fighter's expected rate vs an average opponent = baseline * exp(off), "
                                  "allowed vs an average attacker = baseline * exp(-def); acc is a probability "
                                  "on the logit scale",
                          "rates": {d: {k: r5(v, 5) for k, v in r.items()} for d, r in dstate["_base"].items()}},
        "matchups": match,
        "predictions": pred_out,
        "roster": roster,
    }
    with open(args.out, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    log("wrote %s (%.1f MB) in %.0fs" % (args.out, os.path.getsize(args.out) / 1e6, time.time() - t0))


# =====================================================================================================
# report tables (python3 tools/ratings.py tables) printed from ratings.json
# =====================================================================================================
def _f(x, d=4):
    return "" if x is None else ("%.*f" % (d, x))


def tables(path=OUT_JSON, top=10):
    J = json.load(open(path))
    S, M = J["systems"], J["meta"]
    rk = M.get("ranking_scores_2020_2023", {})
    order = [k for k in ["elo_ref", "elo_k", "elo_full", "glicko2", "trueskill", "trueskill_mov", "whr", "whr_mov",
                         "elo_rounds", "whr_rounds", "dims", "stack", "ratings_plus"] if k in S]
    print("### Results (decisive fights; tune = 2019-2023 prequential, rank = 2020-2023, test = 2024+ held out)\n")
    print("| System | Family | Tune LL | Rank LL 2020-23 | Test LL [95% CI] | Test Brier | Test acc | ECE | "
          "Slope | dLL vs elo_ref [95% CI] | P(better) |")
    print("|---|---|---|---|---|---|---|---|---|---|---|")
    for k in order:
        s = S[k]
        t, b, c = s["test_2024_plus"], s["bootstrap"], s["calibration"]
        tune = s["tune_2019_2023"]["log_loss"]
        rkk = rk.get(k, s.get("cv_2020_2023"))
        if k in ("stack", "ratings_plus"):
            rkk = s.get("cv_2020_2023")
        d = b.get("d_log_loss_vs_elo_ref")
        print("| %s | %s | %s | %s | %s [%s, %s] | %s | %.1f%% | %s | %s | %s [%s, %s] | %s |" % (
            k, s["family"], _f(tune), _f(rkk), _f(t["log_loss"]), _f(b["log_loss_ci95"][0]),
            _f(b["log_loss_ci95"][1]), _f(t["brier"]), 100 * t["accuracy"], _f(c["ece"], 3),
            _f(c["slope_no_intercept"], 2), ("%+.4f" % d) if d is not None else "",
            ("%+.4f" % b["d_log_loss_ci95"][0]) if "d_log_loss_ci95" in b else "",
            ("%+.4f" % b["d_log_loss_ci95"][1]) if "d_log_loss_ci95" in b else "",
            _f(b.get("p_better_than_elo_ref"), 2)))
    print("\nTest n = %d, tune n = %d. Best single system by the 2020-2023 rank score: **%s**.\n"
          % (M["n_test"], M["n_tune"], M["best_single_by_tuning"]))
    print("### Time-ordered check (parameters chosen on 2019-2021 only, scored on 2022-2023)\n")
    print("| System | 2022-23 LL, tuned on 2019-23 (in-window) | 2022-23 LL, tuned on 2019-21 only |")
    print("|---|---|---|")
    for k in order:
        s = S[k]
        if s.get("time_ordered_check"):
            print("| %s | %s | %s |" % (k, _f(s["inner_2022_2023"]), _f(s["time_ordered_check"]["score_2022_2023"])))
    print("\n### Calibration on 2024+ (favourite orientation)\n")
    best = M["best_single_by_tuning"]
    for k in dict.fromkeys(["elo_ref", best, "stack"]):
        c = S[k]["calibration"]
        print("**%s**: ECE %s, slope (no intercept) %s, with intercept slope %s / A-side intercept %s\n"
              % (k, _f(c["ece"], 3), _f(c["slope_no_intercept"], 3), _f(c["slope_with_intercept"], 3),
                 _f(c["intercept_A_side"], 3)))
        print("| Favourite p | n | Mean predicted | Observed |")
        print("|---|---|---|---|")
        for bb in c["bins_favourite"]:
            print("| %.2f-%.2f | %d | %.3f | %.3f |" % (bb["lo"], bb["hi"], bb["n"], bb["pred"], bb["obs"]))
        print()
    print("### Tuned parameters\n")
    for k in order:
        if "params" in S[k]:
            print("- **%s**: %s" % (k, ", ".join("%s=%s" % (a, b) for a, b in S[k]["params"].items())))
    if "dims" in S:
        print("- **dims** per-dimension (q per year, v0, dispersion): %s" % {d: (v["q"], v["v0"], v["k"])
                                                                         for d, v in S["dims"]["dim_params"].items()})
        print("- **dims** winner model: l2=%s, coefficients %s" % (S["dims"]["model"]["l2"],
              {k: round(v, 3) for k, v in S["dims"]["model"]["coef"].items()}))
    if "stack" in S:
        print("- **stack**: members %s, weights %s" % (S["stack"]["members"], [round(w, 3) for w in S["stack"]["weights"]]))
    A = J.get("analysis", {})
    if A.get("residual_beyond_best"):
        print("\n### Residual signal beyond %s (fit on 2019-2023; one feature at a time)\n" % best)
        print("| Feature (A minus B) | Coef | SE | z | Test dLL vs rescaled rating |")
        print("|---|---|---|---|---|")
        for k, v in A["residual_beyond_best"].items():
            print("| %s | %+.4f | %.4f | %+.1f | %s |" % (k, v["coef"], v["se"], v["coef"] / v["se"],
                                                       ("%+.5f" % v["test_dll_vs_rating_rescaled"])
                                                       if "test_dll_vs_rating_rescaled" in v else ""))
    if A.get("test_by_min_prior_fights"):
        print("\n### 2024+ log loss by the less experienced fighter's prior UFC fights\n")
        print("| Prior fights | n | %s | elo_ref |" % best)
        print("|---|---|---|---|")
        for k, v in A["test_by_min_prior_fights"].items():
            print("| %s | %d | %s | %s |" % (k, v["n"], _f(v[best]), _f(v["elo_ref"])))
    mk = A.get("market_benchmark")
    if mk and "test_market" in mk:
        print("\n### Market benchmark (closing line; known only minutes before the bout)\n")
        print("| On the same 2024+ fights (n=%d) | Log loss | Brier | Accuracy |" % mk["test_n"])
        print("|---|---|---|---|")
        for lab, key in (("Market close (power de-vig)", "test_market"), (best, "test_best_same_fights"),
                         ("Market + %s (weights fit on 2019-2023)" % best, "test_market_plus_best")):
            m = mk[key]
            print("| %s | %s | %s | %.1f%% |" % (lab, _f(m["log_loss"]), _f(m["brier"]), 100 * m["accuracy"]))
        print("\nStack weights (market logit, rating logit): %s; correlation of logits on test %s."
              % (mk["stack_coef_market_rating"], mk.get("corr_logit_market_best")))
    R = J["roster"]
    key = next((k for k in M.get("ranking_by_tuning", []) if any(k in r for r in R.values())), "elo_full")
    print("\n### Current ratings: top %d per division (%s, the best-ranked rating system; ordered by mean - 1 sd)\n"
          % (top, key))
    snap = dt.date.fromisoformat(M["snapshot"])
    divs = defaultdict(list)
    for slug, r in R.items():
        if key in r and r.get("division") and r.get("last_fight"):
            if (snap - dt.date.fromisoformat(r["last_fight"])).days <= 730:
                v = r[key]
                divs[r["division"]].append((v["mu"] - v.get("sd", 0), slug, r))
    for dv in B.DIVISIONS:
        if dv not in divs:
            continue
        rows = sorted(divs[dv], reverse=True)[:top]
        print("**%s** (%s; active in the last 2 years): " % (dv, key) + "; ".join(
            "%s %.2f +/- %.2f" % (r["name"], r[key]["mu"], r[key].get("sd", 0)) for _, _, r in rows) + "\n")
    if J.get("matchups"):
        print("### Matchups from current ratings\n")
        for k, v in J["matchups"].items():
            print("- %s: %s" % (k.replace("__", " vs "), v))


# =====================================================================================================
# ablations on the tuning window (python3 tools/ratings.py ablate): one ingredient off at a time
# =====================================================================================================
ABLATIONS = {
    "age curve off": {"dy": 0.0, "do": 0.0},
    "age decline off": {"do": 0.0},
    "early-career learning off": {"dl": 0.0},
    "layoff drift off": {"lay": 0.0},
    "newcomer prior flat (mu_new = age_new = 0)": {"mu_new": 0.0, "age_new": 0.0},
    "pre-UFC record off": {"pre_on": False},
    "margin of victory off (binary outcomes)": {"enc": "binary"},
    "all trajectory terms off (age, learning, layoff)": {"dy": 0.0, "do": 0.0, "dl": 0.0, "lay": 0.0},
}


def ablate(path=OUT_JSON, systems=("elo_full", "glicko2", "trueskill_mov", "whr_mov", "whr_rounds")):
    J = json.load(open(path))
    D = load_data()
    prepare(D, log=lambda *a: None)
    out = {}
    print("| System | Ablation | Tune LL (2019-2023) | Change |")
    print("|---|---|---|---|")
    for name in systems:
        sd = J["systems"].get(name)
        if not sd:
            continue
        P = dict(sd["params"])
        kind = sd["kind"]
        base = score(D, run_system(D, kind, P, until=TEST_FROM, eval_idx=D.idx_tune)[0], D.idx_tune)
        print("| %s | (tuned) | %.5f | |" % (name, base))
        out[name] = {"tuned": base}
        for lab, ch in ABLATIONS.items():
            if lab.startswith("margin") and P.get("enc") not in ("mov", "hybrid"):
                continue
            Q = dict(P, **ch)
            if Q == P:
                continue
            v = score(D, run_system(D, kind, Q, until=TEST_FROM, eval_idx=D.idx_tune)[0], D.idx_tune)
            out[name][lab] = v
            print("| %s | %s | %.5f | %+.5f |" % (name, lab, v, v - base))
    return out


# =====================================================================================================
# ratings_plus (python3 tools/ratings.py plus): rating logits + pre-fight covariates, specified before any
# 2024+ result was seen: forward selection by expanding-window CV on 2019-2023 over every single system's logit
# and six A-minus-B covariates (age gap, years past 34, reach, height, log UFC fights, layoff), no intercept,
# L2 = 1, stop when the CV gain is below 1e-4; fit on 2019-2023, score 2024+ once; results added to ratings.json
# =====================================================================================================
def plus(path=OUT_JSON):
    J = json.load(open(path))
    D = load_data()
    prepare(D, log=lambda *a: None)
    S = J["systems"]
    names = [k for k in S if k not in ("stack", "ratings_plus", "elo_ref")]
    P = {k: np.full(D.n, np.nan) for k in names}
    for fid, e in J["predictions"].items():
        i = D.fidx[fid]
        for k in names:
            v = e["p"].get(k)
            if v is not None:
                P[k][i] = v
    feats = residual_features(D)
    cands = {"logit_" + k: logit(P[k]) for k in names}
    sd = {}
    it, ix = D.idx_tune, D.idx_test
    for k, f in feats.items():
        s_ = f[it].std() + 1e-9
        sd[k] = float(s_)
        cands[k] = f / s_
    chosen, cur, path_ = [], 9.0, []
    while True:
        best = None
        for k in cands:
            if k in chosen:
                continue
            X = np.c_[[cands[c][it] for c in chosen + [k]]].T
            cv, _ = cv_lr(D, X, 1.0, it)
            if cv < cur - 1e-4 and (best is None or cv < best[1]):
                best = (k, cv)
        if not best:
            break
        chosen.append(best[0])
        cur = best[1]
        path_.append({"add": best[0], "cv_log_loss": round(cur, 5)})
        print("  + %-22s CV(2020-23) %.5f" % best)
    X = np.c_[[cands[c] for c in chosen]].T
    b = fit_lr(X[it], D.y[it], 1.0)
    p = expit(X @ b)
    y = D.y
    res = {"kind": "ratings_plus", "family": "Ratings + covariates",
           "label": "Rating logits + pre-fight covariates (age gap, years past 34, reach, height, experience, "
                    "layoff), forward selection by time-ordered CV; specified before the 2024+ results were seen",
           "members": chosen, "weights": [float(v) for v in b], "covariate_sd_2019_2023": sd, "path": path_,
           "cv_2020_2023": cur, "tune_2019_2023": metrics(p[it], y[it]), "test_2024_plus": metrics(p[ix], y[ix])}
    preds = {"ratings_plus": p, "elo_ref": np.full(D.n, np.nan)}
    for fid, e in J["predictions"].items():
        preds["elo_ref"][D.fidx[fid]] = e["p"]["elo_ref"]
    bt = bootstrap(D, preds, ix, base="elo_ref")
    res["bootstrap"] = bt["ratings_plus"]
    res["calibration"] = calibration(p[ix], y[ix])
    best_single = J["meta"]["best_single_by_tuning"]
    pb = np.full(D.n, np.nan)
    for fid, e in J["predictions"].items():
        pb[D.fidx[fid]] = e["p"].get(best_single, np.nan)
    pst = np.full(D.n, np.nan)
    for fid, e in J["predictions"].items():
        pst[D.fidx[fid]] = e["p"].get("stack", np.nan)
    b2 = bootstrap(D, {"ratings_plus": p, "stack": pst}, ix, base="stack")
    res["d_log_loss_vs_stack"] = b2["ratings_plus"].get("d_log_loss_vs_stack")
    res["d_log_loss_vs_stack_ci95"] = b2["ratings_plus"].get("d_log_loss_ci95")
    S["ratings_plus"] = res
    for fid, e in J["predictions"].items():
        e["p"]["ratings_plus"] = r5(p[D.fidx[fid]])
    J["meta"]["ratings_plus_added"] = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    with open(path, "w") as fh:
        json.dump(J, fh, separators=(",", ":"))
    t = res["test_2024_plus"]
    print("ratings_plus: members %s; CV %.5f; test LL %.5f %s Brier %.5f acc %.3f; vs stack %+.5f %s"
          % (chosen, cur, t["log_loss"], res["bootstrap"]["log_loss_ci95"], t["brier"], t["accuracy"],
             res["d_log_loss_vs_stack"] or 0, res["d_log_loss_vs_stack_ci95"]))


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "tables":
        tables(sys.argv[2] if len(sys.argv) > 2 else OUT_JSON)
    elif len(sys.argv) > 1 and sys.argv[1] == "plus":
        plus(sys.argv[2] if len(sys.argv) > 2 else OUT_JSON)
    elif len(sys.argv) > 1 and sys.argv[1] == "ablate":
        ablate(sys.argv[2] if len(sys.argv) > 2 else OUT_JSON)
    else:
        main()
