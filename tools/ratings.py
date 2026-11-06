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
import argparse
import datetime as dt
import json
import math
import os
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


def age_G(a, dy, do):
    """Integral of the drift rate g(a) = dy*(AY-a)+ - do*(a-AO)+ (rating units per year of age)."""
    if a != a:          # nan: unknown age -> no drift
        return 0.0
    return -dy * max(0.0, AY - a) ** 2 / 2.0 - do * max(0.0, a - AO) ** 2 / 2.0


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
                if (dy or do) and gap > 0 and dob[p] == dob[p]:
                    r[p] += age_G(age, dy, do) - age_G(age - gap, dy, do)
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
                    if (dy or do) and D.dob[p] == D.dob[p]:
                        mu[p] += age_G(age, dy, do) - age_G(age - gap / YEAR, dy, do)
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
    return out, rec, {"mu": mu, "phi": phi, "sig": sig, "last": last}


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
                if (dy or do) and gap > 0 and D.dob[p] == D.dob[p]:
                    mu[p] += age_G(age, dy, do) - age_G(age - gap, dy, do)
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
    return out, rec, {"mu": mu, "var": var, "last": last}


# =====================================================================================================
# Whole-History Rating / Bayesian Bradley-Terry with Gaussian random-walk skill (walk-forward)
# =====================================================================================================
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
        lastn = {}
        for n in range(2 * K):
            p = node_p[n]
            if p in lastn:
                prev[n] = lastn[p]
            lastn[p] = n
        self.prev = prev
        e = np.where(prev >= 0)[0]
        self.e_n = e
        self.e_p = prev[e]
        dt_y = (node_day[e] - node_day[self.e_p]) / YEAR
        self.e_c = 1.0 / (w2 * dt_y + vf + 1e-9)
        self.e_d = np.array([age_G(node_age[n], dy, do) - age_G(node_age[m], dy, do)
                             for n, m in zip(e, self.e_p)]) if (dy or do) else np.zeros(len(e))
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

    def _system(self, N):
        """Gradient and sparse Hessian of the negative log posterior on nodes [0, N)."""
        x = self.x
        g = np.zeros(N)
        fN = np.searchsorted(self.f_n, N)
        f = self.f_n[:fN]
        g[f] += (x[f] - self.f_m[:fN]) * self.f_c
        eN = np.searchsorted(self.e_n, N)
        en, ep, ec, ed = self.e_n[:eN], self.e_p[:eN], self.e_c[:eN], self.e_d[:eN]
        r = ec * (x[en] - x[ep] - ed)
        np.add.at(g, en, r)
        np.add.at(g, ep, -r)
        K = N // 2
        za = np.arange(0, 2 * K, 2)
        zb = za + 1
        z = x[za] - x[zb]
        p = expit(z)
        wk = self.w[:K]
        rr = wk * (p - self.y[:K])
        g[za] += rr
        g[zb] -= rr
        h = wk * p * (1 - p)
        rows = np.concatenate([f, en, ep, en, ep, za, zb, za, zb])
        cols = np.concatenate([f, en, ep, ep, en, za, zb, zb, za])
        data = np.concatenate([np.full(fN, self.f_c), ec, ec, -ec, -ec, h, h, -h, -h])
        H = sp.csc_matrix((data, (rows, cols)), shape=(N, N))
        return g, H

    def solve(self, N, tol=1e-5, max_it=30):
        if N == 0:
            return
        for it in range(max_it):
            g, H = self._system(N)
            lu = spla.splu(H, permc_spec="MMD_AT_PLUS_A", diag_pivot_thresh=0.0,
                           options={"SymmetricMode": True})
            step = lu.solve(-g)
            mx = np.max(np.abs(step))
            if mx > 2.0:              # damping for the cold start
                step *= 2.0 / mx
            self.x[:N] += step
            self.lu, self.luN = lu, N
            if mx < tol:
                break

    def variances(self, nodes):
        nodes = np.asarray(nodes, int)
        if len(nodes) == 0:
            return np.zeros(0)
        N = self.luN
        E = np.zeros((N, len(nodes)))
        E[nodes, np.arange(len(nodes))] = 1.0
        X = self.lu.solve(E)
        return X[nodes, np.arange(len(nodes))]

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
        for dday in days:
            # add all fights before dday
            while fi < D.n and order_day[fi] < dday:
                if fi in node_of_fight:
                    na, nb = node_of_fight[fi]
                    lastnode[D.ia[fi]] = na
                    lastnode[D.ib[fi]] = nb
                fi += 1
            N = int(np.searchsorted(self.node_day, dday))      # nodes strictly before dday
            # warm start the nodes added since the previous solve
            self.solve(N)
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
                        m = self.x[n] + (age_G(age, dy, do) - age_G(self.node_age[n], dy, do)
                                         if (dy or do) else 0.0)
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
            m = self.x[n] + (age_G(age, dy, do) - age_G(self.node_age[n], dy, do) if (dy or do) else 0.0)
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
                    pred[i, s_, j] = pr
                    lls += float(-(k * math.log(pr + 1e-12) + (ex - k) * math.log(1 - pr + 1e-12))
                                 + (k * math.log(k / ex + 1e-12) + (ex - k) * math.log(1 - k / ex + 1e-12)))
                else:
                    if ex <= 0:
                        continue
                    mu = math.exp(eta) * ex
                    pred[i, s_, j] = mu / ex
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


def attach_preufc(D):
    """D.pre[i, side] = (shrunk non-UFC win share - 0.7, log1p(non-UFC fights) - 2, net Elo / 400 - 3.75 in
    logits, Contender Series win) as of the bout, from preufc.json snapshots; nan when not crawled."""
    D.pre = np.full((D.n, 2, 4), np.nan)
    D.pre_cov = 0
    if not os.path.exists(PREUFC):
        return
    try:
        J = json.load(open(PREUFC))
    except Exception:
        return
    cols = J["meta"]["snapshot_columns"]
    ci = {c: k for k, c in enumerate(cols)}
    slug2p = {s: k for k, s in enumerate(D.slug)}
    hit = 0
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
            w, n = row[ci["w"]] or 0, row[ci["n"]] or 0
            net = row[ci["net_elo"]]
            D.pre[i, side] = ((w + 1.4) / (n + 2.0) - 0.7, math.log1p(n) - 2.0,
                              ((net if net is not None else 1500.0) - 1500.0) * LN10_400,
                              1.0 if (row[ci["dwcs_w"]] or 0) > 0 else 0.0)
            hit += 1
    D.pre_cov = hit


def newcomer_i(D, P, i, side, age):
    m = newcomer(age, P)
    if P.get("pre_on"):
        f = D.pre[i, side]
        if f[0] == f[0]:
            m += P.get("pre_wp", 0.0) * f[0] + P.get("pre_n", 0.0) * f[1] + P.get("pre_net", 0.0) * f[2] \
                + P.get("pre_dwcs", 0.0) * f[3]
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


def _refine(v, cands):
    if isinstance(v, bool) or isinstance(v, str):
        return cands
    if v == 0:
        return cands
    out = sorted({round(v * f, 6) for f in (0.6, 0.8, 0.9, 1.1, 1.25, 1.6)})
    return out


def coord_descent(kind, P0, grid, pool, passes=3, objective="tune", log=print, min_gain=2e-5):
    """Coordinate descent over parameter grids; objective = mean log loss on 2019-2023 ('tune') or on
    2019-2021 ('in_tr', for the time-ordered check). Data stream stops at 2024-01-01 in every trial."""
    best = dict(P0)
    r0 = _eval((kind, best)) if pool is None else pool.map(_eval, [(kind, best)])[0]
    best_r = r0
    hist = [{"params": dict(best), **r0}]
    for ps in range(passes):
        improved = False
        for name, cands in grid:
            cs = cands if ps == 0 else _refine(best.get(name, 0), cands)
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
