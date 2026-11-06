#!/usr/bin/env python3
"""Hierarchical Bayesian dynamic skill model (task key: bayes).

Every UFC fighter carries an 11-dimensional latent skill vector that moves as a Gaussian random walk between fights:

    r    overall skill (logit units; drives round and fight results)
    so   striking offence        sd   striking defence      (sig strikes landed per minute, log scale)
    to   takedown offence        tdd  takedown / grappling defence (takedowns per 15 min; also control)
    co   top control (control time per minute, log scale, against tdd)
    su   submission threat       sdf  submission defence    (sub attempts per 15 min, log scale)
    pw   power                   ch   chin / durability     (knockdowns per landed head strike, log scale)
    ca   cardio / pace           (round-to-round trend of own output, log scale per round)

Model (one fight, A vs B; z = [x_A, x_B, u, e_A, e_B]):
    time update  x <- x + drift(age, gap) + N(0, diag(q_fight + q_year * gap)); debut x ~ N(mu0(age, pre-UFC), Sigma0)
    rounds       soft round wins (judges' cards / round-stat model, ratings.py encoder) ~ Bernoulli(sigmoid(eta)),
                 eta = (r_A - r_B) + sum_j beta_j Delta_j  (Delta_j = antisymmetric stat-skill matchups)
    strikes      sig landed by A in round j ~ NegBin(mins_j m_j exp(L_str + so_A - sd_B + u + e_A + ca_A (j - 1)), k)
                 (u = shared fight pace, e = own fight-night form: rounds are conditionally independent)
    takedowns    NegBin(mins/15 exp(L_td + to_A - tdd_B)); control (30 s units) NegBin(2 mins exp(L_ctl + co_A - tdd_B))
    subs         NegBin(mins/15 exp(L_sub + su_A - sdf_B)); knockdowns NegBin((head_A + 1) exp(L_kd + pw_A - ch_B))
    method       given the winner W over L: multinomial {KO, SUB, DEC} with logits
                 off_div + a + a5*five + b (pw_W - ch_L) + c eta_W + d (so_W - sd_L)    (KO; SUB analogous with su/sdf, to/tdd)
    round        finishing round from walk-forward shapes by format and method; draws at the walk-forward draw share
    L_*          walk-forward exponentially weighted division baselines (data only, pre-fight values)

Inference: assumed-density filtering. Each fight is a Laplace (Newton) update of the joint Gaussian over z, both
fighters' marginals are kept (an online EP / extended Kalman approximation of the posterior). Hyperparameters are
empirical Bayes: an EM M-step on per-fighter RTS-smoothed states (newcomer prior mean regressed on age and the
pre-UFC record, full population covariance Sigma0, process noise and age drift of the stat dimensions, pace and
form variances, NB dispersions), GLMs for the result link and the method model, and a coordinate search of the
result-side scalars on one-step-ahead (prequential) winner log loss. Everything is refit every Jan 1 on data before
it (walk-forward); between refits the filter updates after every fight day.

Prediction: P(A wins) = sigmoid(m / sqrt(1 + pi v / 8)) with m, v the mean and variance of the linear predictor
beta' Delta under the pre-fight posterior (variance-aware link, chosen by forward-chained CV), method x round cells in
methodround's layout, expected stat lines, and per-fighter skill means and sds (simulator inputs).

Run from the project root (stages cache into out/bayes_cache/):

    nice -n 5 python3 tools/bayes.py data          # data arrays + walk-forward baselines (2026+ dropped at parse)
    nice -n 5 python3 tools/bayes.py fit --years 2019-2025 --jobs 2   # yearly walk-forward refits + predictions
    nice -n 5 python3 tools/bayes.py cv            # forward-chained CV choices (pre-2024 only)
    nice -n 5 python3 tools/bayes.py eval          # standalone / method / stats / uncertainty on 2019-2023
    nice -n 5 python3 tools/bayes.py stack         # forward-chained 2021-2023 stack gate (ml2's stack code)
    nice -n 5 python3 tools/bayes.py confirm       # the ONE scoring of 2024-2025 (after every choice is frozen)
    nice -n 5 python3 tools/bayes.py swap          # corner-swap test (P(A,B) + P(B,A) = 1)
    nice -n 5 python3 tools/bayes.py export        # data/derived/bayes.json

Hidden-data protocol (docs/BACKLOG.md): build_db.parse_fights is wrapped so every fight dated 2026-01-01 or later
is dropped right after parsing. Choices use data before 2024-01-01 only; 2024-2025 is scored once by `confirm`.
"""
import os

for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "1")
import argparse
import copy
import datetime as dt
import json
import math
import pickle
import sys
import time
from collections import defaultdict

import numpy as np
from scipy.optimize import minimize
from scipy.special import expit, gammaln

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.dirname(HERE)
DERIVED = os.path.join(ROOT, "data", "derived")
CACHE = os.environ.get("BAYES_CACHE", os.path.join(ROOT, "out", "bayes_cache"))
OUT_JSON = os.path.join(DERIVED, "bayes.json")
VAULT = dt.date(2026, 1, 1)
YEAR = 365.25
os.makedirs(CACHE, exist_ok=True)

import build_db as B  # noqa: E402

_parse_orig = B.parse_fights


def _parse_dev_only(log):
    """build_db.parse_fights with every fight dated on or after VAULT removed right after parsing."""
    fights, ex = _parse_orig(log)
    return [f for f in fights if f.date < VAULT], ex


B.parse_fights = _parse_dev_only
import ratings as RT  # noqa: E402  (data loaders, round model / encoder, pre-UFC snapshots)


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def jan1(y):
    return dt.date(y, 1, 1).toordinal()


# ====================================================================== layout
DIMS = ["r", "so", "sd", "to", "tdd", "co", "su", "sdf", "pw", "ch", "ca"]
DIM_LABEL = {"r": "overall skill (logit)", "so": "striking offence", "sd": "striking defence",
             "to": "takedown offence", "tdd": "takedown / grappling defence", "co": "top control",
             "su": "submission threat", "sdf": "submission defence", "pw": "power (KD per head strike)",
             "ch": "chin / durability", "ca": "cardio (output trend per round)"}
K = len(DIMS)
DI = {d: j for j, d in enumerate(DIMS)}
NZ = 2 * K + 3
IU, IEA, IEB = 2 * K, 2 * K + 1, 2 * K + 2
NR = 21                      # observation rows per fight
R_ENC, R_STR, R_TD, R_CTL, R_SUB, R_KD, R_KO, R_SB = 0, 1, 11, 13, 15, 17, 19, 20
STATS = ["str", "td", "ctl", "sub", "kd"]
# matchup features (A minus B, antisymmetric) used by the result link and the win GLM
FEATS = ["r", "str", "td", "ctl", "sub", "ko", "ca"]
NF = len(FEATS)
DIV_GROUP = {"Catch Weight": "ALL", "Open Weight": "ALL"}


def zi(side, dim):
    return side * K + DI[dim]


def feat_rows():
    """T (NF x NZ): Delta features as linear maps of z."""
    T = np.zeros((NF, NZ))
    for s, sg in ((0, 1.0), (1, -1.0)):
        T[0, zi(s, "r")] += sg
        for f, (o, d) in (("str", ("so", "sd")), ("td", ("to", "tdd")), ("ctl", ("co", "tdd")), ("sub", ("su", "sdf")),
                          ("ko", ("pw", "ch"))):
            j = FEATS.index(f)
            T[j, zi(s, o)] += sg      # own offence
            T[j, zi(s, d)] += sg      # own defence (the opponent's offence against it enters with the other side)
        T[FEATS.index("ca"), zi(s, "ca")] += sg
    return T


TFEAT = feat_rows()


# ====================================================================== data
def build_data():
    D = RT.load_data()
    RT.prepare(D, log=lambda *a: log(*a))
    assert dt.date.fromordinal(int(D.day.max())) < VAULT
    n = D.n
    X = {"n": n, "n_players": D.n_players}
    X["ia"], X["ib"] = D.ia.astype(int), D.ib.astype(int)
    X["day"] = D.day.astype(int)
    X["year"] = D.year.astype(int)
    X["fid"] = list(D.fid)
    X["event"] = list(D.event)
    X["slug"] = list(D.slug)
    X["name"] = list(D.name)
    X["dob"] = D.dob
    X["age"] = np.stack([D.age_a, D.age_b], 1)
    divs = sorted(set(DIV_GROUP.get(d, d) for d in D.division)) + (["ALL"] if "ALL" not in DIV_GROUP.values() else [])
    divs = sorted(set(divs) | {"ALL"})
    X["divs"] = divs
    X["div"] = np.array([divs.index(DIV_GROUP.get(d, d)) for d in D.division])
    X["division"] = list(D.division)
    X["women"] = np.array([d.startswith("Women") for d in D.division])
    X["sched"] = np.clip(D.sched.astype(int), 1, 5)
    X["five"] = (X["sched"] == 5).astype(float)
    X["rnd"] = D.rnd.astype(int)
    # outcome: cat code 0 none/NC, 1 KO (incl. doctor), 2 SUB, 3 DEC, 4 DRAW, 5 DQ
    code = {"KO": 1, "SUB": 2, "UD": 3, "SD": 3, "D": 4, "DQ": 5, "NC": 0}
    X["cat"] = np.array([code[c] for c in D.cat])
    X["win"] = np.array([1.0 if w == "A" else (0.0 if w == "B" else np.nan) for w in D.winner])
    # rounds
    rm = np.zeros((n, 5))
    rs = np.zeros((n, 2, 5))
    has = np.zeros(n, bool)
    tot = {k: np.zeros((n, 2)) for k in ("td", "ctl", "sub", "kd", "head", "sig")}
    mins = np.zeros(n)
    for i in range(n):
        rr = D.rounds[i]
        if not rr:
            continue
        for k, (a, b) in rr.items():
            if k < 1 or k > 5:
                continue
            rm[i, k - 1] = a["mins"]
            for s, g in ((0, a), (1, b)):
                rs[i, s, k - 1] = g["sig_l"]
                tot["td"][i, s] += g["td_l"]
                tot["ctl"][i, s] += g["ctrl"]
                tot["sub"][i, s] += g["sub"]
                tot["kd"][i, s] += g["kd"]
                tot["head"][i, s] += g["head_l"]
                tot["sig"][i, s] += g["sig_l"]
        mins[i] = rm[i].sum()
        has[i] = mins[i] > 0.05
    for s in (0, 1):     # a KO win without a recorded knockdown counts as one (as ratings.py dims)
        won = (X["cat"] == 1) & (X["win"] == (1.0 if s == 0 else 0.0))
        tot["kd"][:, s] += (won & (tot["kd"][:, s] == 0)).astype(float)
    X["rmins"], X["rsig"], X["has"], X["mins"] = rm, rs, has, mins
    for k, v in tot.items():
        X[k] = v
    X["ctl"] = np.minimum(X["ctl"], mins[:, None] * 60.0)
    # ratings.py round-outcome components (encoder "rounds"; judges' cards via the pre-2019 round model)
    for k in ("ry_played", "rw_played", "ry_fin", "rw_fin", "ry_rem", "rw_rem"):
        X[k] = getattr(D, k).copy()
    X["obs"] = D.obs.copy()
    X["round_fit"] = D.round_fit
    # pre-UFC snapshots (strict walk-forward), applied to debuts on/after ratings.PRE_FROM only (survivor-free)
    X["pre"] = np.nan_to_num(D.pre, nan=0.0)
    X["pre_ok"] = np.isfinite(D.pre[:, :, 0]) & (D.day[:, None] >= RT.PRE_FROM)
    X["pre_keys"] = list(RT.PRE_KEYS)
    # evaluation universe (backtest.json: both men with a prior UFC fight, decisive, 2019-2025)
    ev = np.zeros(n, bool)
    ev[D.idx_tune] = True
    ev[D.idx_test] = True
    X["evalrow"] = ev
    X["nprior"] = np.stack([D.nprior_a, D.nprior_b], 1)
    amb = np.array([D.pids[a].startswith("amb:") or D.pids[b].startswith("amb:") for a, b in zip(D.ia, D.ib)])
    X["trainrow"] = (X["nprior"].min(1) >= 1) & np.isin(X["cat"], [1, 2, 3, 5]) & ~amb
    baselines(X)
    return X


def baselines(X, rho=0.997, rho_g=0.999):
    """Walk-forward division baselines (pre-fight values, updated after each fight day), all data-only:
    L_str/L_td/L_ctl/L_sub/L_kd (log rate), round multipliers by format, method offsets, round shapes, draw share."""
    n = X["n"]
    nd = len(X["divs"])
    ALL = X["divs"].index("ALL")
    prior = {"str": (3.6, 20.0), "td": (1.3, 20.0), "ctl": (0.33, 20.0), "sub": (0.5, 20.0), "kd": (0.010, 300.0)}
    S = {k: np.zeros((nd, 2)) for k in STATS}
    L = {k: np.zeros(n) for k in STATS}
    rmult_s = {f: np.zeros((5, 2)) for f in (3, 5)}
    rmult = np.ones((n, 5))
    meth = np.zeros((nd, 3))          # KO, SUB, DEC counts (EW)
    moff = np.zeros((n, 2))
    shape_s = {(f, m): np.zeros(5) for f in (3, 5) for m in (1, 2)}
    shape = np.zeros((n, 2, 5))
    draw_s = np.zeros(2)
    pdraw = np.zeros(n)
    days = X["day"]
    order = np.argsort(days, kind="stable")
    uniq, starts = np.unique(days[order], return_index=True)
    bounds = list(starts) + [n]
    fmt = np.where(X["sched"] == 5, 5, 3)
    for b in range(len(uniq)):
        idx = order[bounds[b]:bounds[b + 1]]
        for i in idx:                     # pre-fight values
            dv = X["div"][i]
            for k in STATS:
                pr, c = prior[k]
                ca, ea = S[k][ALL]
                r_all = (ca + c * pr) / (ea + c)
                cd, ed = S[k][dv]
                L[k][i] = math.log((cd + c * r_all) / (ed + c))
            f = fmt[i]
            base = rmult_s[f]
            r1 = (base[0, 0] + 20 * 3.6) / (base[0, 1] + 20)
            for j in range(5):
                rmult[i, j] = ((base[j, 0] + 20 * 3.6) / (base[j, 1] + 20)) / r1
            ma = meth[ALL] + np.array([12.0, 6.0, 12.0])
            md = meth[dv] + 10.0 * ma / ma.sum()
            moff[i] = [math.log(md[0] / md[2]), math.log(md[1] / md[2])]
            for m in (1, 2):
                sh = shape_s[(f, m)][:f] + 1.0
                shape[i, m - 1, :f] = sh / sh.sum()
            pdraw[i] = (draw_s[0] + 1.0) / (draw_s[1] + 100.0)
        for i in idx:                     # updates after the day (both sides symmetric)
            dv = X["div"][i]
            if X["has"][i]:
                mins = X["mins"][i]
                obs = {"str": (X["sig"][i].sum(), 2 * mins), "td": (X["td"][i].sum(), 2 * mins / 15.0),
                       "ctl": (X["ctl"][i].sum() / 30.0, 2 * mins * 2.0), "sub": (X["sub"][i].sum(), 2 * mins / 15.0),
                       "kd": (X["kd"][i].sum(), X["head"][i].sum() + 2.0)}
                for k, (c_, e_) in obs.items():
                    for g in (dv, ALL):
                        S[k][g] = S[k][g] * rho + np.array([c_, e_])
                f = fmt[i]
                for j in range(5):
                    if X["rmins"][i, j] > 0.05:
                        rmult_s[f][j] = rmult_s[f][j] * rho_g + np.array([X["rsig"][i, :, j].sum(), 2 * X["rmins"][i, j]])
            c = X["cat"][i]
            if c in (1, 2, 3):
                for g in (dv, ALL):
                    meth[g] *= rho
                    meth[g][c - 1] += 1.0
                if c in (1, 2):
                    f = fmt[i]
                    shape_s[(f, c)] *= rho_g
                    shape_s[(f, c)][min(X["rnd"][i], f) - 1] += 1.0
            if c in (1, 2, 3, 4):
                draw_s *= rho_g
                draw_s += np.array([1.0 if c == 4 else 0.0, 1.0])
    for k in STATS:
        X["L_" + k] = L[k]
    X["rmult"] = rmult
    X["moff"] = moff
    X["shape"] = shape
    X["pdraw"] = pdraw


def load_data():
    p = os.path.join(CACHE, "data.pkl")
    if not os.path.exists(p):
        X = build_data()
        pickle.dump(X, open(p, "wb"))
    return pickle.load(open(p, "rb"))


def stage_data(args):
    p = os.path.join(CACHE, "data.pkl")
    if os.path.exists(p):
        os.remove(p)
    X = load_data()
    log("data: %d fights (%s .. %s), %d players, %d with round stats; eval rows %d" % (
        X["n"], dt.date.fromordinal(int(X["day"].min())), dt.date.fromordinal(int(X["day"].max())),
        X["n_players"], X["has"].sum(), X["evalrow"].sum()))


def swap_data(X):
    """Corner-swapped copy of the data (A <-> B everywhere)."""
    Y = dict(X)
    Y["ia"], Y["ib"] = X["ib"], X["ia"]
    for k in ("age", "rsig", "td", "ctl", "sub", "kd", "head", "sig", "pre", "pre_ok", "nprior"):
        Y[k] = X[k][:, ::-1].copy() if X[k].ndim == 2 else X[k][:, ::-1, ...].copy()
    Y["win"] = np.where(np.isnan(X["win"]), np.nan, 1.0 - X["win"])
    Y["ry_played"] = X["rw_played"] - X["ry_played"]
    Y["ry_fin"] = X["rw_fin"] - X["ry_fin"]
    Y["ry_rem"] = X["rw_rem"] - X["ry_rem"]
    return Y


# ====================================================================== hyperparameters
def default_hyper():
    H = {
        "mu0": np.zeros(K), "Sigma0": np.diag([0.8, 0.08, 0.06, 0.4, 0.3, 0.4, 0.3, 0.2, 0.15, 0.12, 0.01]),
        "r_new": {"c0": -0.2, "c_age": -0.06, "c_pre": np.zeros(7)},
        "qf": np.array([0.015, 0.004, 0.004, 0.02, 0.02, 0.02, 0.02, 0.02, 0.01, 0.01, 0.0005]),
        "qy": np.array([0.027, 0.01, 0.01, 0.05, 0.05, 0.05, 0.05, 0.05, 0.02, 0.02, 0.001]),
        "drift_a": np.zeros(K), "drift_b": np.zeros(K),
        "dy": 0.012, "ay": 25.0, "do": 0.02, "ao": 29.0, "lay": 0.05,
        "sig_u": 0.30, "sig_e": 0.25,
        "k": {"str": 6.0, "td": 2.0, "ctl": 1.5, "sub": 1.2, "kd": 3.0},
        "w_round": 0.8, "w_fround": 1.5, "w_rem": 0.4, "w_stat": 1.0, "w_meth": 1.0,
        "beta_up": np.zeros(NF),            # result link used in the update: eta = Delta_r + sum beta_up[j] Delta_j
        "win": {"beta": np.r_[1.1, np.zeros(NF - 1)], "varaware": True},
        "meth": {"ko": np.array([0.0, 0.0, 0.5, 0.3, 0.0]), "sub": np.array([0.0, 0.0, 0.5, 0.3, 0.0])},
        "link": "glm",
    }
    H["beta_up"][0] = 1.0
    return H


# ====================================================================== filter
def age_G(a, dy, do, ay, ao):
    a = np.where(np.isnan(a), ao, a)
    return -dy * np.maximum(0.0, ay - a) ** 2 / 2.0 - do * np.maximum(0.0, a - ao) ** 2 / 2.0


def static_design(X):
    """Per-fight observation rows that do not depend on hyperparameters: G (n, NR, NZ), offsets, targets, masks,
    row kinds. Row 0 (result link) and rows 19-20 (method) are filled per run."""
    n = X["n"]
    G = np.zeros((n, NR, NZ))
    off = np.zeros((n, NR))
    y = np.zeros((n, NR))
    m = np.zeros((n, NR))
    for s in (0, 1):
        o = 1 - s
        a = lambda d: zi(s, d)
        b = lambda d: zi(o, d)
        for j in range(5):
            r = R_STR + 5 * s + j
            G[:, r, a("so")] = 1
            G[:, r, b("sd")] = -1
            G[:, r, IU] = 1
            G[:, r, IEA + s] = 1
            G[:, r, a("ca")] = j
            ok = X["rmins"][:, j] > 0.05
            off[:, r] = np.where(ok, np.log(np.maximum(X["rmins"][:, j], 1e-3)) + X["L_str"] + np.log(X["rmult"][:, j]), 0)
            y[:, r] = X["rsig"][:, s, j]
            m[:, r] = ok
        mins = np.maximum(X["mins"], 1e-3)
        for r0, (o_, d_), lexp, lk, yy in ((R_TD, ("to", "tdd"), np.log(mins / 15.0), "L_td", X["td"][:, s]),
                                           (R_CTL, ("co", "tdd"), np.log(mins * 2.0), "L_ctl", X["ctl"][:, s] / 30.0),
                                           (R_SUB, ("su", "sdf"), np.log(mins / 15.0), "L_sub", X["sub"][:, s]),
                                           (R_KD, ("pw", "ch"), np.log(X["head"][:, s] + 1.0), "L_kd", X["kd"][:, s])):
            r = r0 + s
            G[:, r, a(o_)] = 1
            G[:, r, b(d_)] = -1
            off[:, r] = lexp + X[lk]
            y[:, r] = yy
            m[:, r] = X["has"]
    return {"G": G, "off": off, "y": y, "m": m}


def kvec(H):
    k = np.zeros(NR)
    k[R_STR:R_STR + 10] = H["k"]["str"]
    k[R_TD:R_TD + 2] = H["k"]["td"]
    k[R_CTL:R_CTL + 2] = H["k"]["ctl"]
    k[R_SUB:R_SUB + 2] = H["k"]["sub"]
    k[R_KD:R_KD + 2] = H["k"]["kd"]
    return k


def link_row(H):
    """eta (result link used in the update) as a row over z."""
    return H["beta_up"] @ TFEAT


def meth_rows(H, winner_side):
    """Method logits' linear part for winner side w: rows (2, NZ) and constants (2,) without the division offset."""
    w, l = winner_side, 1 - winner_side
    eta = link_row(H) * (1.0 if w == 0 else -1.0)
    R = np.zeros((2, NZ))
    cko, csb = H["meth"]["ko"], H["meth"]["sub"]       # [a, a5, b, c, d]
    R[0, zi(w, "pw")] += cko[2]
    R[0, zi(l, "ch")] -= cko[2]
    R[0] += cko[3] * eta
    R[0, zi(w, "so")] += cko[4]
    R[0, zi(l, "sd")] -= cko[4]
    R[1, zi(w, "su")] += csb[2]
    R[1, zi(l, "sdf")] -= csb[2]
    R[1] += csb[3] * eta
    R[1, zi(w, "to")] += csb[4]
    R[1, zi(l, "tdd")] -= csb[4]
    return R


def lik(eta, y, w, k, both=True):
    """Per-row log-likelihood derivatives. Returns d1 (nb, NR), W (nb, NR, NR) and the log-likelihood (nb,)."""
    nb = eta.shape[0]
    d1 = np.zeros_like(eta)
    d2 = np.zeros_like(eta)
    ll = np.zeros(nb)
    # result link (soft Bernoulli)
    e0 = eta[:, R_ENC]
    s = expit(e0)
    d1[:, R_ENC] = w[:, R_ENC] * (y[:, R_ENC] - s)
    d2[:, R_ENC] = -w[:, R_ENC] * s * (1 - s)
    ll += w[:, R_ENC] * (y[:, R_ENC] * np.log(s + 1e-12) + (1 - y[:, R_ENC]) * np.log(1 - s + 1e-12))
    # negative binomial rows
    sl = slice(R_STR, R_KD + 2)
    e = np.clip(eta[:, sl], -30, 15)
    mu = np.exp(e)
    kk = k[sl][None, :]
    yy = y[:, sl]
    ww = w[:, sl]
    d1[:, sl] = ww * kk * (yy - mu) / (kk + mu)
    d2[:, sl] = -ww * (yy + kk) * kk * mu / (kk + mu) ** 2
    if both:
        ll += np.sum(ww * (gammaln(yy + kk) - gammaln(kk) - gammaln(yy + 1) + kk * np.log(kk / (kk + mu))
                           + yy * (e - np.log(kk + mu))), 1)
    # method multinomial (KO, SUB vs DEC)
    eko = np.clip(eta[:, R_KO], -30, 30)
    esb = np.clip(eta[:, R_SB], -30, 30)
    mx = np.maximum(0, np.maximum(eko, esb))
    den = np.exp(-mx) + np.exp(eko - mx) + np.exp(esb - mx)
    pko = np.exp(eko - mx) / den
    psb = np.exp(esb - mx) / den
    wm = w[:, R_KO]
    oko, osb = y[:, R_KO], y[:, R_SB]
    d1[:, R_KO] = wm * (oko - pko)
    d1[:, R_SB] = wm * (osb - psb)
    W = np.zeros((nb, NR, NR))
    ar = np.arange(NR)
    W[:, ar, ar] = d2
    W[:, R_KO, R_KO] = -wm * pko * (1 - pko)
    W[:, R_SB, R_SB] = -wm * psb * (1 - psb)
    W[:, R_KO, R_SB] = W[:, R_SB, R_KO] = wm * pko * psb
    pdec = 1 - pko - psb
    ll += wm * (oko * np.log(pko + 1e-12) + osb * np.log(psb + 1e-12) + (1 - oko - osb) * np.log(pdec + 1e-12))
    return d1, W, ll


def day_batches(X, until_day):
    """Fight indices grouped by day (walk-forward order); a fighter appearing twice on a day (1990s tournaments)
    splits the day into sequential sub-batches."""
    days = X["day"]
    n = X["n"]
    out = []
    i = 0
    while i < n and days[i] < until_day:
        j = i
        while j < n and days[j] == days[i]:
            j += 1
        idx = list(range(i, j))
        while idx:
            seen, cur, rest = set(), [], []
            for f in idx:
                a, b = X["ia"][f], X["ib"][f]
                if a in seen or b in seen:
                    rest.append(f)
                else:
                    seen.update((a, b))
                    cur.append(f)
            out.append(np.array(cur))
            idx = rest
        i = j
    return out


_SD = {}


def run_filter(X, H, until_day, store=False, newton_iter=4, key="main"):
    """Walk-forward filter over every fight with day < until_day. Returns per-fight pre-fight states (m0, P0),
    posterior states (m1, P1) when store, the method / result rows used, and posterior fight effects."""
    if key not in _SD:
        _SD[key] = static_design(X)
    SD = _SD[key]
    n = X["n"]
    npl = X["n_players"]
    M = np.zeros((npl, K))
    P = np.zeros((npl, K, K))
    last = np.full(npl, -1)
    kv = kvec(H)
    lrow = link_row(H)
    mrows = [meth_rows(H, 0), meth_rows(H, 1)]
    ws = np.ones(NR)
    ws[R_STR:R_KD + 2] = H["w_stat"]
    # result-row targets and weights (ratings.py "rounds" encoder with this run's weights)
    wsum = X["rw_played"] + H["w_fround"] * X["rw_fin"] + H["w_rem"] * X["rw_rem"]
    ysum = X["ry_played"] + H["w_fround"] * X["ry_fin"] + H["w_rem"] * X["ry_rem"]
    yenc = np.where(wsum > 0, ysum / np.maximum(wsum, 1e-12), 0.5)
    wenc = np.where(X["obs"], H["w_round"] * wsum, 0.0)
    Sig0 = H["Sigma0"]
    qf, qy = H["qf"], H["qy"]
    rn = H["r_new"]
    out = {"m0": np.full((n, 2, K), np.nan), "P0": np.full((n, 2, K, K), np.nan), "new": np.zeros((n, 2), bool),
           "gap": np.zeros((n, 2)), "done": np.zeros(n, bool), "zu": np.zeros((n, 3)), "vu": np.zeros((n, 3)),
           "ll": np.zeros(n)}
    if store:
        out["m1"] = np.full((n, 2, K), np.nan)
        out["P1"] = np.full((n, 2, K, K), np.nan)
        out["eta1"] = np.zeros((n, NR))
        out["eta0"] = np.zeros((n, NR))
        out["v0"] = np.zeros((n, NR))
    eyeK = np.eye(K)
    for idx in day_batches(X, until_day):
        nb = len(idx)
        d = X["day"][idx[0]]
        pl = np.stack([X["ia"][idx], X["ib"][idx]], 1)            # (nb, 2)
        m0 = M[pl].copy()                                          # (nb, 2, K)
        P0 = P[pl].copy()
        new = last[pl] < 0
        gap = np.where(new, 0.0, (d - last[pl]) / YEAR)
        age = X["age"][idx]                                        # (nb, 2)
        # time update for returning fighters
        old = ~new
        if old.any():
            a1 = age
            dr = age_G(a1, H["dy"], H["do"], H["ay"], H["ao"]) - age_G(a1 - gap, H["dy"], H["do"], H["ay"], H["ao"])
            dr = np.where(np.isnan(a1), 0.0, dr)
            dr -= H["lay"] * np.maximum(0.0, np.minimum(gap, 4.0) - 0.75)
            amid = np.where(np.isnan(a1), 30.0, a1 - gap / 2.0)
            g6 = np.minimum(gap, 6.0)
            drift = g6[..., None] * (H["drift_a"][None, None, :] + H["drift_b"][None, None, :] * (amid[..., None] - 30.0))
            drift[..., 0] = dr
            m0 = np.where(old[..., None], m0 + drift, m0)
            Q = qf[None, None, :] + qy[None, None, :] * g6[..., None]
            P0 = np.where(old[..., None, None], P0 + Q[..., None] * eyeK, P0)
        if new.any():
            aa = np.clip(np.where(np.isnan(age), 29.0, age), 20.0, 42.0)
            pre = X["pre"][idx]                                    # (nb, 2, 7)
            pok = X["pre_ok"][idx]
            rmean = rn["c0"] + rn["c_age"] * (aa - 29.0) + np.where(pok, pre @ rn["c_pre"], 0.0)
            mnew = np.broadcast_to(H["mu0"], (nb, 2, K)).copy()
            mnew[..., 0] = rmean
            m0 = np.where(new[..., None], mnew, m0)
            P0 = np.where(new[..., None, None], Sig0[None, None], P0)
        out["m0"][idx] = m0
        out["P0"][idx] = P0
        out["new"][idx] = new
        out["gap"][idx] = gap
        # Laplace update of z = [x_A, x_B, u, e_A, e_B]
        G = SD["G"][idx]
        off = SD["off"][idx].copy()
        yy = SD["y"][idx].copy()
        ww = SD["m"][idx] * ws[None, :]
        G[:, R_ENC] = lrow[None, :]
        yy[:, R_ENC] = yenc[idx]
        ww[:, R_ENC] = wenc[idx]
        cat = X["cat"][idx]
        win = X["win"][idx]
        dec = np.isin(cat, (1, 2, 3)) & ~np.isnan(win)
        for s in (0, 1):
            sel = dec & (win == (1.0 if s == 0 else 0.0))
            if sel.any():
                G[sel, R_KO:R_SB + 1] = mrows[s][None]
        five = X["five"][idx]
        moff = X["moff"][idx]
        cko, csb = H["meth"]["ko"], H["meth"]["sub"]
        off[:, R_KO] = moff[:, 0] + cko[0] + cko[1] * five
        off[:, R_SB] = moff[:, 1] + csb[0] + csb[1] * five
        yy[:, R_KO] = (cat == 1).astype(float)
        yy[:, R_SB] = (cat == 2).astype(float)
        ww[:, R_KO] = ww[:, R_SB] = np.where(dec, H["w_meth"], 0.0)
        M0 = np.zeros((nb, NZ))
        M0[:, :K] = m0[:, 0]
        M0[:, K:2 * K] = m0[:, 1]
        L0 = np.zeros((nb, NZ, NZ))
        L0[:, :K, :K] = np.linalg.inv(P0[:, 0])
        L0[:, K:2 * K, K:2 * K] = np.linalg.inv(P0[:, 1])
        L0[:, IU, IU] = 1.0 / H["sig_u"] ** 2
        L0[:, IEA, IEA] = L0[:, IEB, IEB] = 1.0 / H["sig_e"] ** 2
        Z = M0.copy()
        Gt = np.transpose(G, (0, 2, 1))
        if store:                      # prior predictive mean / variance of every row's linear predictor
            P0z = np.linalg.inv(L0)
            out["eta0"][idx] = (G @ M0[..., None])[..., 0] + off
            out["v0"][idx] = np.einsum("fod,fde,foe->fo", G, P0z, G)
        for it in range(newton_iter):
            eta = (G @ Z[..., None])[..., 0] + off
            d1, W, ll = lik(eta, yy, ww, kv, both=(it == newton_iter - 1))
            grad = -(L0 @ (Z - M0)[..., None])[..., 0] + (Gt @ d1[..., None])[..., 0]
            Hs = -L0 + Gt @ (W @ G)
            Z = Z - np.linalg.solve(Hs, grad[..., None])[..., 0]
        eta = (G @ Z[..., None])[..., 0] + off
        _, W, _ = lik(eta, yy, ww, kv, both=False)
        Hs = -L0 + Gt @ (W @ G)
        C = np.linalg.inv(-Hs)
        C = 0.5 * (C + np.transpose(C, (0, 2, 1)))
        m1 = np.stack([Z[:, :K], Z[:, K:2 * K]], 1)
        P1 = np.stack([C[:, :K, :K], C[:, K:2 * K, K:2 * K]], 1)
        M[pl] = m1
        P[pl] = P1
        last[pl] = d
        out["done"][idx] = True
        out["zu"][idx] = Z[:, IU:]
        out["vu"][idx] = np.stack([C[:, IU, IU], C[:, IEA, IEA], C[:, IEB, IEB]], 1)
        out["ll"][idx] = ll
        if store:
            out["m1"][idx] = m1
            out["P1"][idx] = P1
            out["eta1"][idx] = eta
    out["state"] = {"M": M, "P": P, "last": last}
    return out


# ====================================================================== predictions from pre-fight states
def feat_moments(R, idx):
    """Mean (n, NF) and covariance (n, NF, NF) of the Delta features under the pre-fight posterior."""
    m0, P0 = R["m0"][idx], R["P0"][idx]
    TA, TB = TFEAT[:, :K], TFEAT[:, K:2 * K]
    mu = m0[:, 0] @ TA.T + m0[:, 1] @ TB.T
    S = TA[None] @ P0[:, 0] @ TA.T[None] + TB[None] @ P0[:, 1] @ TB.T[None]
    return mu, S


def win_prob(beta, mu, S, varaware=True):
    m = mu @ beta
    if not varaware:
        return expit(m), m, np.zeros_like(m)
    v = np.einsum("j,fjk,k->f", beta, S, beta)
    return expit(m / np.sqrt(1.0 + math.pi * v / 8.0)), m, v


def fit_win_glm(mu, S, y, varaware=True, l2=1.0, beta0=None, free=None):
    """No-intercept logistic of the result on Delta features (mirror-symmetric by construction), with the
    variance-aware link when varaware. free: mask of fitted coefficients (others fixed at 0)."""
    free = np.ones(NF, bool) if free is None else free
    b0 = (beta0 if beta0 is not None else np.r_[1.0, np.zeros(NF - 1)])[free]

    def f(b):
        beta = np.zeros(NF)
        beta[free] = b
        p, _, _ = win_prob(beta, mu, S, varaware)
        p = np.clip(p, 1e-9, 1 - 1e-9)
        return -np.sum(y * np.log(p) + (1 - y) * np.log(1 - p)) + l2 * np.sum(b[1:] ** 2 if free[0] else b ** 2)
    r = minimize(f, b0, method="L-BFGS-B")
    beta = np.zeros(NF)
    beta[free] = r.x
    return beta


def meth_design(R, idx, H, X, winner_side):
    """Method GLM features for winner side w (plug-in pre-fight means): KO [1, five, pw_W - ch_L, eta_W, so_W - sd_L],
    SUB [1, five, su_W - sdf_L, eta_W, to_W - tdd_L], and the division offsets."""
    m0 = R["m0"][idx]
    w, l = winner_side, 1 - winner_side
    mw, ml = m0[:, w], m0[:, l]
    z = np.concatenate([m0[:, 0], m0[:, 1], np.zeros((len(idx), 3))], 1)
    eta = z @ link_row(H) * (1.0 if w == 0 else -1.0)
    five = X["five"][idx]
    one = np.ones(len(idx))
    Fko = np.stack([one, five, mw[:, DI["pw"]] - ml[:, DI["ch"]], eta, mw[:, DI["so"]] - ml[:, DI["sd"]]], 1)
    Fsb = np.stack([one, five, mw[:, DI["su"]] - ml[:, DI["sdf"]], eta, mw[:, DI["to"]] - ml[:, DI["tdd"]]], 1)
    return Fko, Fsb, X["moff"][idx]


def meth_probs(cko, csb, Fko, Fsb, moff):
    eko = moff[:, 0] + Fko @ cko
    esb = moff[:, 1] + Fsb @ csb
    mx = np.maximum(0, np.maximum(eko, esb))
    den = np.exp(-mx) + np.exp(eko - mx) + np.exp(esb - mx)
    return np.stack([np.exp(eko - mx) / den, np.exp(esb - mx) / den, np.exp(-mx) / den], 1)


def fit_meth_glm(R, X, H, idx, l2=2.0):
    cat = X["cat"][idx]
    win = X["win"][idx]
    ws = np.where(win == 1.0, 0, 1)
    F = [meth_design(R, idx, H, X, s) for s in (0, 1)]
    Fko = np.where(ws[:, None] == 0, F[0][0], F[1][0])
    Fsb = np.where(ws[:, None] == 0, F[0][1], F[1][1])
    moff = F[0][2]
    o = np.stack([cat == 1, cat == 2, cat == 3], 1).astype(float)

    def f(c):
        p = meth_probs(c[:5], c[5:], Fko, Fsb, moff)
        return -np.sum(o * np.log(p + 1e-12)) + l2 * (np.sum(c[2:5] ** 2) + np.sum(c[7:] ** 2))
    c0 = np.r_[H["meth"]["ko"], H["meth"]["sub"]]
    r = minimize(f, c0, method="L-BFGS-B")
    return {"ko": r.x[:5], "sub": r.x[5:]}


def cells(X, R, H, idx):
    """Method x round cells in methodround's layout (23 = A KO r1..5, A SUB r1..5, B KO r1..5, B SUB r1..5, A DEC,
    B DEC, DRAW) and P(A wins)."""
    mu, S = feat_moments(R, idx)
    pA, m, v = win_prob(H["win"]["beta"], mu, S, H["win"]["varaware"])
    out = np.zeros((len(idx), 23))
    pd_ = X["pdraw"][idx]
    shape = X["shape"][idx]                      # (n, 2, 5): KO, SUB round shapes
    for s, pw in ((0, pA), (1, 1 - pA)):
        Fko, Fsb, moff = meth_design(R, idx, H, X, s)
        pm = meth_probs(H["meth"]["ko"], H["meth"]["sub"], Fko, Fsb, moff)
        base = (1 - pd_) * pw
        out[:, 10 * s:10 * s + 5] = (base * pm[:, 0])[:, None] * shape[:, 0]
        out[:, 10 * s + 5:10 * s + 10] = (base * pm[:, 1])[:, None] * shape[:, 1]
        out[:, 20 + s] = base * pm[:, 2]
    out[:, 22] = pd_
    return out, pA, m, v


def stat_pred(X, R, H, idx):
    """Expected per-fight stat totals given the actual minutes (and head strikes for KD), with the log-normal
    correction for skill, pace and form uncertainty; also the log-mean and its variance (for PIT / coverage)."""
    m0, P0 = R["m0"][idx], R["P0"][idx]
    out = {}
    for s in (0, 1):
        o = 1 - s
        for st, (od, dd) in (("str", ("so", "sd")), ("td", ("to", "tdd")), ("ctl", ("co", "tdd")),
                             ("sub", ("su", "sdf")), ("kd", ("pw", "ch"))):
            mean = m0[:, s, DI[od]] - m0[:, o, DI[dd]]
            var = P0[:, s, DI[od], DI[od]] + P0[:, o, DI[dd], DI[dd]]
            if st == "str":
                # sum over rounds: exp(L + skill + log mins_j + log mult_j + ca_s * j)
                ca_m, ca_v = m0[:, s, DI["ca"]], P0[:, s, DI["ca"], DI["ca"]]
                tot = 0.0
                for j in range(5):
                    ex = X["rmins"][idx, j] * X["rmult"][idx, j]
                    lv = var + ca_v * j * j + H["sig_u"] ** 2 + H["sig_e"] ** 2
                    tot = tot + ex * np.exp(X["L_str"][idx] + mean + ca_m * j + 0.5 * lv)
                out["str_%d" % s] = tot
                out["str_lv_%d" % s] = var + H["sig_u"] ** 2 + H["sig_e"] ** 2
            else:
                lexp = {"td": np.log(np.maximum(X["mins"][idx], 1e-3) / 15.0), "ctl": np.log(np.maximum(X["mins"][idx], 1e-3) * 2.0),
                        "sub": np.log(np.maximum(X["mins"][idx], 1e-3) / 15.0), "kd": np.log(X["head"][idx, s] + 1.0)}[st]
                out["%s_%d" % (st, s)] = np.exp(lexp + X["L_" + st][idx] + mean + 0.5 * var)
                out["%s_lv_%d" % (st, s)] = var
    return out


# ====================================================================== empirical Bayes: EM on smoothed states
def sequences(X):
    seq = defaultdict(list)
    for i in range(X["n"]):
        seq[X["ia"][i]].append((i, 0))
        seq[X["ib"][i]].append((i, 1))
    return seq


def smooth(X, R, seq, until_day):
    """Per-fighter RTS smoother over the filter's (ADF) prior / posterior states. Returns lists of debut states
    (fight, side, ms, Ps) and consecutive increments (fight_prev, fight_next, side_next, ms_prev, ms_next, Ps_prev,
    Ps_next, cross)."""
    deb, inc = [], []
    for p, lst in seq.items():
        lst = [(i, s) for i, s in lst if X["day"][i] < until_day and R["done"][i]]
        if not lst:
            continue
        T = len(lst)
        m1 = np.array([R["m1"][i, s] for i, s in lst])
        P1 = np.array([R["P1"][i, s] for i, s in lst])
        m0 = np.array([R["m0"][i, s] for i, s in lst])
        P0 = np.array([R["P0"][i, s] for i, s in lst])
        ms, Ps = m1.copy(), P1.copy()
        cross = [None] * T
        for t in range(T - 2, -1, -1):
            J = P1[t] @ np.linalg.inv(P0[t + 1])
            ms[t] = m1[t] + J @ (ms[t + 1] - m0[t + 1])
            Ps[t] = P1[t] + J @ (Ps[t + 1] - P0[t + 1]) @ J.T
            cross[t + 1] = Ps[t + 1] @ J.T          # Cov(x_{t+1}, x_t | all)
        deb.append((lst[0][0], lst[0][1], ms[0], Ps[0]))
        for t in range(T - 1):
            inc.append((lst[t][0], lst[t + 1][0], lst[t + 1][1], ms[t], ms[t + 1], Ps[t], Ps[t + 1], cross[t + 1]))
    return deb, inc


def nb_k_ml(y, mu, w=None, grid=None):
    grid = grid if grid is not None else np.exp(np.linspace(np.log(0.3), np.log(60), 60))
    w = np.ones_like(y) if w is None else w
    best, bk = -np.inf, grid[0]
    for k in grid:
        ll = np.sum(w * (gammaln(y + k) - gammaln(k) - gammaln(y + 1) + k * np.log(k / (k + mu)) + y * np.log(mu / (k + mu))))
        if ll > best:
            best, bk = ll, k
    return float(bk)


def em_update(X, R, H, Y, seq, years_back=12, shrink_off=0.0):
    """One EM M-step on states smoothed with data before Jan 1 of Y. Updates (in a copy of H): the newcomer prior
    (mean regressed on age and pre-UFC record for r; global mean for the stat dims; full covariance Sigma0), process
    noise (q_fight, q_year) and age drift of the stat dimensions, pace / form sds, NB dispersions."""
    H = copy.deepcopy(H)
    lo, hi = jan1(Y - years_back), jan1(Y)
    deb, inc = smooth(X, R, seq, hi)
    # --- newcomer prior
    D0 = [(i, s, m, P) for i, s, m, P in deb if X["day"][i] >= lo]
    ms = np.array([d[2] for d in D0])
    Ps = np.array([d[3] for d in D0])
    ii = np.array([d[0] for d in D0])
    ss = np.array([d[1] for d in D0])
    age = X["age"][ii, ss]
    aa = np.clip(np.where(np.isnan(age), 29.0, age), 20.0, 42.0) - 29.0
    pok = X["pre_ok"][ii, ss]
    pre = X["pre"][ii, ss] * pok[:, None]
    F = np.c_[np.ones(len(ii)), aa, pre]
    lam = np.r_[0.0, 0.0, np.full(7, 2.0)]
    coef = np.linalg.solve(F.T @ F + np.diag(lam), F.T @ ms[:, 0])
    H["r_new"] = {"c0": float(coef[0]), "c_age": float(coef[1]), "c_pre": coef[2:]}
    mu = ms.mean(0)
    mu[0] = 0.0
    H["mu0"] = mu
    res = ms - mu[None]
    res[:, 0] = ms[:, 0] - F @ coef
    S0 = (res.T @ res + Ps.sum(0)) / len(ms)
    if shrink_off:
        S0 = (1 - shrink_off) * S0 + shrink_off * np.diag(np.diag(S0))
    H["Sigma0"] = 0.5 * (S0 + S0.T)
    # --- increments: drift and process noise of the stat dimensions (r keeps its tuned age curve and noise)
    I0 = [t for t in inc if X["day"][t[1]] >= lo]
    gap = np.array([(X["day"][t[1]] - X["day"][t[0]]) / YEAR for t in I0])
    g6 = np.minimum(gap, 6.0)
    an = np.array([X["age"][t[1], t[2]] for t in I0])
    amid = np.where(np.isnan(an), 30.0, an - gap / 2.0) - 30.0
    dm = np.array([t[4] - t[3] for t in I0])
    A = np.c_[g6, g6 * amid]
    da, db = H["drift_a"].copy(), H["drift_b"].copy()
    qf, qy = H["qf"].copy(), H["qy"].copy()
    for k in range(1, K):
        c = np.linalg.lstsq(A, dm[:, k], rcond=None)[0]
        da[k], db[k] = c
        res = dm[:, k] - A @ c
        e2 = res ** 2 + np.array([t[5][k, k] + t[6][k, k] - 2 * t[7][k, k] for t in I0])
        Bm = np.c_[np.ones(len(g6)), g6]
        from scipy.optimize import nnls
        cq = nnls(Bm, e2)[0]
        qf[k], qy[k] = max(cq[0], 1e-6), max(cq[1], 1e-6)
    H["drift_a"], H["drift_b"], H["qf"], H["qy"] = da, db, qf, qy
    # --- pace and form
    sel = (X["day"] >= lo) & (X["day"] < hi) & X["has"] & R["done"]
    H["sig_u"] = float(np.sqrt(np.mean(R["zu"][sel, 0] ** 2 + R["vu"][sel, 0])))
    H["sig_e"] = float(np.sqrt(np.mean(np.r_[R["zu"][sel, 1] ** 2 + R["vu"][sel, 1], R["zu"][sel, 2] ** 2 + R["vu"][sel, 2]])))
    # --- NB dispersions: one-step-ahead predictive ML. The pre-fight predictive of a count is NB(lambda, k) mixed
    # over lambda = exp(eta), eta ~ N(eta0, v0) (skills, pace, form); moment-matched to NB(mu, k_eff) with
    # mu = exp(eta0 + v0 / 2) and 1 / k_eff = e^v0 / k + e^v0 - 1.
    H["k"] = nb_dispersions(R, sel)
    return H


NB_ROWS = {"str": list(range(R_STR, R_STR + 10)), "td": [R_TD, R_TD + 1], "ctl": [R_CTL, R_CTL + 1],
           "sub": [R_SUB, R_SUB + 1], "kd": [R_KD, R_KD + 1]}


def nb_pred_ll(y, eta0, v0, k):
    v0 = np.minimum(v0, 5.0)
    mu = np.exp(np.clip(eta0 + v0 / 2.0, -30, 15))
    ke = 1.0 / (np.exp(v0) / k + np.exp(v0) - 1.0)
    return gammaln(y + ke) - gammaln(ke) - gammaln(y + 1) + ke * np.log(ke / (ke + mu)) + y * np.log(mu / (ke + mu))


def nb_dispersions(R, sel, grid=None):
    SD = _SD["main"]
    grid = grid if grid is not None else np.exp(np.linspace(np.log(0.3), np.log(200), 70))
    out = {}
    for st, rr in NB_ROWS.items():
        ys, e0, v0 = [], [], []
        for r in rr:
            ok = sel & (SD["m"][:, r] > 0)
            ys.append(SD["y"][ok, r])
            e0.append(R["eta0"][ok, r])
            v0.append(R["v0"][ok, r])
        y, e, v = np.concatenate(ys), np.concatenate(e0), np.concatenate(v0)
        lls = [np.sum(nb_pred_ll(y, e, v, k)) for k in grid]
        out[st] = float(grid[int(np.argmax(lls))])
    return out


# ====================================================================== fitting one year
def win_rows(X, Y, back=7):
    return np.flatnonzero(X["trainrow"] & (X["year"] >= Y - back) & (X["year"] < Y))


def meth_rows_idx(X, Y, back=10):
    return np.flatnonzero(np.isin(X["cat"], (1, 2, 3)) & ~np.isnan(X["win"]) & (X["year"] >= Y - back) & (X["year"] < Y))


def glm_step(X, R, H, Y):
    """Refit the result link (win GLM) and the method GLM on pre-fight states of the window before Y."""
    H = copy.deepcopy(H)
    idx = win_rows(X, Y)
    mu, S = feat_moments(R, idx)
    y = X["win"][idx]
    beta = fit_win_glm(mu, S, y, varaware=H["win"]["varaware"], beta0=H["win"]["beta"])
    H["win"]["beta"] = beta
    if H["link"] == "glm" and beta[0] > 0.05:
        bu = np.clip(beta / beta[0], -1.0, 2.0)
        bu[0] = 1.0
        H["beta_up"] = bu
    elif H["link"] == "r_only":
        H["beta_up"] = np.r_[1.0, np.zeros(NF - 1)]
    H["meth"] = fit_meth_glm(R, X, H, meth_rows_idx(X, Y))
    p, _, _ = win_prob(beta, mu, S, H["win"]["varaware"])
    return H, float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


CD_PARAMS = [("qy_r", "mul", 1.5), ("qf_r", "mul", 1.6), ("w_round", "mul", 1.25), ("w_fround", "add", 0.3),
             ("w_rem", "add", 0.15), ("do", "add", 0.006), ("lay", "add", 0.03), ("v0_r", "mul", 1.3)]


def get_p(H, name):
    return {"qy_r": lambda: H["qy"][0], "qf_r": lambda: H["qf"][0], "v0_r": lambda: H["Sigma0"][0, 0]}.get(name, lambda: H[name])()


def set_p(H, name, v):
    H = copy.deepcopy(H)
    if name == "qy_r":
        H["qy"][0] = v
    elif name == "qf_r":
        H["qf"][0] = v
    elif name == "v0_r":
        s = math.sqrt(max(v, 1e-4) / H["Sigma0"][0, 0])
        H["Sigma0"][0, :] *= s
        H["Sigma0"][:, 0] *= s
    else:
        H[name] = v
    return H


def objective(X, H, Y):
    R = run_filter(X, H, jan1(Y))
    H2, ll = glm_step(X, R, H, Y)
    return ll, H2


def coord_search(X, H, Y, sweeps=2, logf=log, params=None):
    params = params or CD_PARAMS
    best, Hb = objective(X, H, Y)
    H = Hb
    logf("  CD start %.5f" % best)
    for sw in range(sweeps):
        improved = False
        for name, kind, step in params:
            v0 = get_p(H, name)
            for direction in (1, -1):
                v = v0 * step ** direction if kind == "mul" else v0 + direction * step
                if kind == "add" and v < 0:
                    continue
                ll, H2 = objective(X, set_p(H, name, v), Y)
                if ll < best - 1e-5:
                    best, H = ll, H2
                    improved = True
                    logf("  CD %s %.4g -> %.4g: %.5f" % (name, v0, v, ll))
                    break
        if not improved:
            break
    return H, best


STAT_GROUPS = {"str": (["so", "sd"], "str"), "td": (["to", "tdd"], "td"), "ctl": (["co"], "ctl"),
               "sub": (["su", "sdf"], "sub"), "kd": (["pw", "ch"], "kd"), "ca": (["ca"], "str")}


def stat_pred_ll(X, R, H, Y, back=7):
    """Mean one-step-ahead predictive log-likelihood per stat (moment-matched NB) on the window before Y, and the
    dispersions that maximise it. Their sum over fights is the marginal likelihood of the stats (prequential)."""
    sel = (X["year"] >= Y - back) & (X["year"] < Y) & X["has"] & R["done"]
    SD = _SD["main"]
    ks = nb_dispersions(R, sel)
    out = {}
    for st, rr in NB_ROWS.items():
        tot, nn = 0.0, 0
        for r in rr:
            ok = sel & (SD["m"][:, r] > 0)
            tot += np.sum(nb_pred_ll(SD["y"][ok, r], R["eta0"][ok, r], R["v0"][ok, r], ks[st]))
            nn += ok.sum()
        out[st] = tot / max(nn, 1)
    return out, ks


def scale_group(H, dims, s0=1.0, sq=1.0):
    H = copy.deepcopy(H)
    ix = [DI[d] for d in dims]
    f = np.ones(K)
    f[ix] = math.sqrt(s0)
    H["Sigma0"] = H["Sigma0"] * np.outer(f, f)
    H["qf"][ix] *= sq
    H["qy"][ix] *= sq
    return H


def stat_search(X, H, Y, sweeps=2, logf=log):
    """Type-II ML of the stat side: per skill group, the prior-variance and process-noise scales (and, for strikes,
    the pace and form sds) that maximise the group's one-step predictive likelihood; dispersions re-estimated each
    trial."""
    R = run_filter(X, H, jan1(Y), store=True)
    cur, ks = stat_pred_ll(X, R, H, Y)
    H = copy.deepcopy(H)
    H["k"] = ks
    for sw in range(sweeps):
        moved = False
        for g, (dims, st) in STAT_GROUPS.items():
            trials = [("s0", 1.5), ("s0", 1 / 1.5), ("sq", 1.6), ("sq", 1 / 1.6)]
            if g == "str":
                trials += [("sig_u", 1.2), ("sig_u", 1 / 1.2), ("sig_e", 1.2), ("sig_e", 1 / 1.2)]
            done = set()
            for kind, f in trials:
                if kind in done:
                    continue
                if kind in ("s0", "sq"):
                    H2 = scale_group(H, dims, **{kind: f})
                else:
                    H2 = copy.deepcopy(H)
                    H2[kind] *= f
                R2 = run_filter(X, H2, jan1(Y), store=True)
                ll2, ks2 = stat_pred_ll(X, R2, H2, Y)
                if ll2[st] > cur[st] + 1e-5:
                    logf("  stat %s %s x%.2f: %s %.5f -> %.5f" % (g, kind, f, st, cur[st], ll2[st]))
                    H2["k"] = ks2
                    H, cur = H2, ll2
                    done.add(kind)
                    moved = True
        if not moved:
            break
    return H, cur


def fit_year(X, Y, H0, em_iters=2, sweeps=2, stat_sweeps=2, logf=log):
    """Hyperparameters for predicting year Y from data before Jan 1 of Y."""
    seq = sequences(X)
    H = copy.deepcopy(H0)
    t0 = time.time()
    for it in range(em_iters):
        R = run_filter(X, H, jan1(Y), store=True)
        H = em_update(X, R, H, Y, seq)
        R = run_filter(X, H, jan1(Y))
        H, ll = glm_step(X, R, H, Y)
        logf("  %d EM %d: win LL %.5f  k %s  sig_u %.3f sig_e %.3f  beta %s" % (
            Y, it, ll, {k: round(v, 2) for k, v in H["k"].items()}, H["sig_u"], H["sig_e"], np.round(H["win"]["beta"], 3)))
    H, sll = stat_search(X, H, Y, sweeps=stat_sweeps, logf=logf)
    logf("  %d stat predictive LL %s" % (Y, {k: round(v, 4) for k, v in sll.items()}))
    H, best = coord_search(X, H, Y, sweeps=sweeps, logf=logf)
    R = run_filter(X, H, jan1(Y), store=True)
    sll, ks = stat_pred_ll(X, R, H, Y)
    H["k"] = ks
    R = run_filter(X, H, jan1(Y))
    H, ll = glm_step(X, R, H, Y)
    H["stat_ll"] = sll
    logf("  %d final win LL %.5f (%.0f s)" % (Y, ll, time.time() - t0))
    H["fit_through"] = str(dt.date(Y - 1, 12, 31))
    H["train_win_ll"] = ll
    return H


def predict_year(X, H, Y, years=None):
    """Run the filter with H through Dec 31 of the last predicted year and record predictions for those years."""
    years = years or [Y]
    R = run_filter(X, H, jan1(max(years) + 1))
    idx = np.flatnonzero(np.isin(X["year"], years) & R["done"])
    C, pA, m, v = cells(X, R, H, idx)
    st = stat_pred(X, R, H, idx)
    sd = np.sqrt(np.einsum("fskk->fsk", R["P0"][idx]))
    pl = win_prob(H["win"]["beta"], *feat_moments(R, idx), varaware=False)[0]
    return {"idx": idx, "cells": C, "pA": pA, "pA_plugin": pl, "m": m, "v": v, "stats": st,
            "m0": R["m0"][idx], "sd0": sd, "new": R["new"][idx]}
