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

Inference (a Kalman / EP approximation; NumPyro SVI is not installed and would be far slower walk-forward):
    filter   assumed-density filtering: each fight day is a Laplace (Newton) update of the joint Gaussian over z, both
             fighters' marginals kept (an online EP / extended Kalman step);
    refit    expectation propagation over the whole history before a cut day (TrueSkill-through-time style): each fight
             is a factor whose per-fighter Gaussian messages are re-estimated from the cavity (all other information
             about both fighters, through forward-backward passes over every fighter chain) x likelihood; parallel
             damped updates until the skill means move < 0.002. EP refits run on a CV-chosen schedule (none / every
             Jan 1 / quarter / month); between refits the filter updates after every fight day.
    hyper    empirical Bayes, refit every Jan 1 on data before it: an EM M-step on per-fighter RTS-smoothed states
             (newcomer prior mean regressed on age and the pre-UFC record, full population covariance Sigma0, process
             noise and age drift of the stat dimensions, pace and form variances, NB dispersions), type-II ML of the
             stat-side variance scales on one-step predictive likelihood, GLMs for the result link and the method
             model, and a coordinate search of the result-side scalars on one-step-ahead winner log loss. Option "+g":
             the prediction link alone refit on EP-refit pre-fight states of the training window.

Prediction: P(A wins) = sigmoid(m / sqrt(1 + pi v / 8)) with m, v the mean and variance of the linear predictor
beta' Delta under the pre-fight posterior (variance-aware link; plug-in sigmoid(m) is the alternative, chosen by CV),
method x round cells in methodround's layout, expected stat lines, and per-fighter skill means and sds (simulator inputs).

Run from the project root (stages cache into out/bayes_cache/; nice -n 5, at most 2 worker processes):

    python3 tools/bayes.py data                              # data arrays + walk-forward baselines (2026+ dropped)
    python3 tools/bayes.py fit --years 2019-2025 --variant main      # yearly EB refits (also --variant nostats)
    python3 tools/bayes.py predict --variant main,nostats --jobs 2   # OOF 2019-2023, static 2024-25, roll 2025, per
                                                                     #   EP schedule (--schedules none,year,...,year+g)
    python3 tools/bayes.py cv          # choices on 2019-2023 OOF only (schedule, link, variant; 0.0005 rule)
    python3 tools/bayes.py eval        # standalone / ratings comparison / uncertainty / method x round / stats, 2019-23
    python3 tools/bayes.py stack       # forward-chained 2021-2023 stack gate (ml2's stack code and rule)
    python3 tools/bayes.py swap        # corner-swap test (P(A,B) + P(B,A) = 1, mirrored cells and stats)
    python3 tools/bayes.py confirm     # the ONE scoring of 2024-2025 (after every choice is frozen)
    python3 tools/bayes.py fit --years 2026-2026 && python3 tools/bayes.py export   # production roster -> bayes.json

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


def day_batches(X, until_day, from_day=None):
    """Fight indices grouped by day (walk-forward order); a fighter appearing twice on a day (1990s tournaments)
    splits the day into sequential sub-batches. Fights are sorted by day (asserted in build_data)."""
    days = X["day"]
    n = X["n"]
    out = []
    i = 0 if from_day is None else int(np.searchsorted(days, from_day, "left"))
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


def run_aux(X, H):
    """Per-run constants of the observation model: NB dispersions, result-link and method rows, stat weights, and the
    result-row targets / weights (ratings.py "rounds" encoder with this run's weights)."""
    A = {"kv": kvec(H), "lrow": link_row(H), "mrows": [meth_rows(H, 0), meth_rows(H, 1)]}
    ws = np.ones(NR)
    ws[R_STR:R_KD + 2] = H["w_stat"]
    A["ws"] = ws
    wsum = X["rw_played"] + H["w_fround"] * X["rw_fin"] + H["w_rem"] * X["rw_rem"]
    ysum = X["ry_played"] + H["w_fround"] * X["ry_fin"] + H["w_rem"] * X["ry_rem"]
    A["yenc"] = np.where(wsum > 0, ysum / np.maximum(wsum, 1e-12), 0.5)
    A["wenc"] = np.where(X["obs"], H["w_round"] * wsum, 0.0)
    return A


def fight_design(X, H, SD, A, idx):
    """Observation rows (G, offsets, targets, weights) of fights idx under hyperparameters H."""
    G = SD["G"][idx]
    off = SD["off"][idx].copy()
    yy = SD["y"][idx].copy()
    ww = SD["m"][idx] * A["ws"][None, :]
    G[:, R_ENC] = A["lrow"][None, :]
    yy[:, R_ENC] = A["yenc"][idx]
    ww[:, R_ENC] = A["wenc"][idx]
    cat = X["cat"][idx]
    win = X["win"][idx]
    dec = np.isin(cat, (1, 2, 3)) & ~np.isnan(win)
    for s in (0, 1):
        sel = dec & (win == (1.0 if s == 0 else 0.0))
        if sel.any():
            G[sel, R_KO:R_SB + 1] = A["mrows"][s][None]
    five = X["five"][idx]
    moff = X["moff"][idx]
    cko, csb = H["meth"]["ko"], H["meth"]["sub"]
    off[:, R_KO] = moff[:, 0] + cko[0] + cko[1] * five
    off[:, R_SB] = moff[:, 1] + csb[0] + csb[1] * five
    yy[:, R_KO] = (cat == 1).astype(float)
    yy[:, R_SB] = (cat == 2).astype(float)
    ww[:, R_KO] = ww[:, R_SB] = np.where(dec, H["w_meth"], 0.0)
    return G, off, yy, ww


def prior_z(H, mA, LA, mB, LB):
    """Joint prior mean and precision of z = [x_A, x_B, u, e_A, e_B] (independent blocks)."""
    nb = len(mA)
    M0 = np.zeros((nb, NZ))
    M0[:, :K] = mA
    M0[:, K:2 * K] = mB
    L0 = np.zeros((nb, NZ, NZ))
    L0[:, :K, :K] = LA
    L0[:, K:2 * K, K:2 * K] = LB
    L0[:, IU, IU] = 1.0 / H["sig_u"] ** 2
    L0[:, IEA, IEA] = L0[:, IEB, IEB] = 1.0 / H["sig_e"] ** 2
    return M0, L0


def laplace(G, off, yy, ww, kv, M0, L0, newton_iter=4):
    """Laplace approximation of p(z | rows) for a batch of fights: Newton mode Z, covariance C, log-likelihood at the
    last iterate and the linear predictors at the mode."""
    Z = M0.copy()
    Gt = np.transpose(G, (0, 2, 1))
    ll = None
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
    return Z, C, ll, eta


def run_filter(X, H, until_day, store=False, newton_iter=4, key="main", init=None, from_day=None):
    """Walk-forward filter over every fight with from_day <= day < until_day (from the start when from_day is None),
    starting from the per-fighter state `init` ({M, P, last}, e.g. an EP snapshot) when given. Returns per-fight
    pre-fight states (m0, P0), posterior states (m1, P1) when store, and posterior fight effects."""
    if key not in _SD:
        _SD[key] = static_design(X)
    SD = _SD[key]
    n = X["n"]
    npl = X["n_players"]
    if init is None:
        M = np.zeros((npl, K))
        P = np.zeros((npl, K, K))
        last = np.full(npl, -1)
    else:
        M, P, last = init["M"].copy(), init["P"].copy(), init["last"].copy()
    AX = run_aux(X, H)
    kv = AX["kv"]
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
    for idx in day_batches(X, until_day, from_day):
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
        G, off, yy, ww = fight_design(X, H, SD, AX, idx)
        M0, L0 = prior_z(H, m0[:, 0], np.linalg.inv(P0[:, 0]), m0[:, 1], np.linalg.inv(P0[:, 1]))
        if store:                      # prior predictive mean / variance of every row's linear predictor
            P0z = np.linalg.inv(L0)
            out["eta0"][idx] = (G @ M0[..., None])[..., 0] + off
            out["v0"][idx] = np.einsum("fod,fde,foe->fo", G, P0z, G)
        Z, C, ll, eta = laplace(G, off, yy, ww, kv, M0, L0, newton_iter)
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


# ====================================================================== EP smoothing refit (TrueSkill-through-time style)
def chain_steps(X, cut_day):
    """Fighter chains over fights with day < cut_day. Node = 2 f + s (fight f, side s). Returns nf (number of fights
    before the cut), steps (per career position t: node ids and their predecessor nodes, -1 at debut) and each fighter's
    last node."""
    nf = int(np.searchsorted(X["day"], cut_day, "left"))
    seq = defaultdict(list)
    for f in range(nf):
        seq[int(X["ia"][f])].append(2 * f)
        seq[int(X["ib"][f])].append(2 * f + 1)
    T = max(len(v) for v in seq.values())
    steps = []
    for t in range(T):
        cur = [(v[t], v[t - 1] if t else -1) for v in seq.values() if len(v) > t]
        steps.append((np.array([c[0] for c in cur]), np.array([c[1] for c in cur])))
    lastn = {p: v[-1] for p, v in seq.items()}
    return nf, steps, lastn


def node_params(X, H, nodes, prev):
    """Transition (drift c, diagonal noise Q) into each node from its predecessor, and the newcomer prior mean for
    debut nodes; the same formulas as run_filter's time update."""
    f, s = nodes // 2, nodes % 2
    new = prev < 0
    age = X["age"][f, s]
    gap = np.where(new, 0.0, (X["day"][f] - X["day"][np.maximum(prev, 0) // 2]) / YEAR)
    dr = age_G(age, H["dy"], H["do"], H["ay"], H["ao"]) - age_G(age - gap, H["dy"], H["do"], H["ay"], H["ao"])
    dr = np.where(np.isnan(age), 0.0, dr)
    dr -= H["lay"] * np.maximum(0.0, np.minimum(gap, 4.0) - 0.75)
    amid = np.where(np.isnan(age), 30.0, age - gap / 2.0)
    g6 = np.minimum(gap, 6.0)
    c = g6[:, None] * (H["drift_a"][None, :] + H["drift_b"][None, :] * (amid[:, None] - 30.0))
    c[:, 0] = dr
    Q = H["qf"][None, :] + H["qy"][None, :] * g6[:, None]
    aa = np.clip(np.where(np.isnan(age), 29.0, age), 20.0, 42.0)
    rn = H["r_new"]
    rmean = rn["c0"] + rn["c_age"] * (aa - 29.0) + np.where(X["pre_ok"][f, s], X["pre"][f, s] @ rn["c_pre"], 0.0)
    mnew = np.broadcast_to(H["mu0"], (len(nodes), K)).copy()
    mnew[:, 0] = rmean
    return c, Q, mnew


def chain_pass(H, steps, NP, Ls, es):
    """Forward (moment form) and backward (information form) passes over every fighter chain given the site messages
    (Ls, es) in natural parameters. Returns the cavity (prior x backward message, i.e. everything except the node's own
    site) in natural parameters for every node."""
    nn = len(Ls)
    aL = np.zeros((nn, K, K))
    ae = np.zeros((nn, K))
    fm = np.zeros((nn, K))
    fP = np.zeros((nn, K, K))
    for t, (nodes, prev) in enumerate(steps):
        c, Q, mnew = NP[t]
        if t == 0:
            am = mnew
            aP = np.broadcast_to(H["Sigma0"], (len(nodes), K, K))
        else:
            am = fm[prev] + c
            aP = fP[prev] + Q[:, :, None] * np.eye(K)[None]
        Li = np.linalg.inv(aP)
        Li = 0.5 * (Li + np.transpose(Li, (0, 2, 1)))
        aL[nodes] = Li
        ae[nodes] = (Li @ am[..., None])[..., 0]
        Pf = np.linalg.inv(Li + Ls[nodes])
        Pf = 0.5 * (Pf + np.transpose(Pf, (0, 2, 1)))
        fP[nodes] = Pf
        fm[nodes] = (Pf @ (ae[nodes] + es[nodes])[..., None])[..., 0]
    bL = np.zeros((nn, K, K))
    be = np.zeros((nn, K))
    eye = np.eye(K)[None]
    for t in range(len(steps) - 1, 0, -1):
        nodes, prev = steps[t]
        c, Q, _ = NP[t]
        Lc = bL[nodes] + Ls[nodes]
        ec = be[nodes] + es[nodes]
        Ai = np.linalg.inv(eye + Lc * Q[:, None, :])          # (I + Lc diag(Q))^-1
        Lp = Ai @ Lc
        bL[prev] = 0.5 * (Lp + np.transpose(Lp, (0, 2, 1)))
        be[prev] = (Ai @ (ec - (Lc @ c[..., None])[..., 0])[..., None])[..., 0]
    return aL + bL, ae + be


def ep_snapshot(X, H, cut_day, init_sites=None, iters=25, damp=0.8, tol=2e-3, logf=None, newton_iter=3, key="main"):
    """Expectation propagation over every fight before cut_day: each fight is a factor on both fighters' states at that
    fight (Laplace moments of the cavity x likelihood, projected to per-fighter Gaussian messages); fighter chains carry
    the random-walk dynamics. Parallel updates with damping, started from the ADF (filter) sites or from `init_sites`
    (warm start; missing nodes get ADF sites from a filter pass). Returns the per-fighter state at the cut (the smoothed
    posterior at each fighter's last fight; run_filter's time update moves it to the next fight), the sites and a log."""
    if key not in _SD:
        _SD[key] = static_design(X)
    SD = _SD[key]
    nf, steps, lastn = chain_steps(X, cut_day)
    nn = 2 * nf
    NP = [node_params(X, H, nodes, prev) for nodes, prev in steps]
    Ls = np.zeros((nn, K, K))
    es = np.zeros((nn, K))
    have = np.zeros(nn, bool)
    if init_sites is not None:
        m = min(len(init_sites["L"]), nn)
        Ls[:m], es[:m], have[:m] = init_sites["L"][:m], init_sites["e"][:m], True
    if not have.all():                         # ADF sites (posterior / prior at each node) for the rest
        lo = int(np.argmin(have)) // 2
        R = run_filter(X, H, cut_day, store=True, key=key)
        f = np.arange(lo, nf)
        for s in (0, 1):
            P0i = np.linalg.inv(R["P0"][f, s])
            P1i = np.linalg.inv(R["P1"][f, s])
            Ls[2 * f + s] = P1i - P0i
            es[2 * f + s] = (P1i @ R["m1"][f, s][..., None])[..., 0] - (P0i @ R["m0"][f, s][..., None])[..., 0]
    AX = run_aux(X, H)
    fids = np.arange(nf)
    G, off, yy, ww = fight_design(X, H, SD, AX, fids)
    hist = []
    prev_mean = None
    for it in range(iters):
        Lc, ec = chain_pass(H, steps, NP, Ls, es)
        Lm = Lc + Ls
        mean = np.linalg.solve(Lm, (ec + es)[..., None])[..., 0]
        if prev_mean is not None:
            dmax = float(np.max(np.abs(mean[:, 0] - prev_mean[:, 0])))
            hist.append(dmax)
            if logf:
                logf("    EP iter %d: max |d r| %.4f" % (it, dmax))
            if dmax < tol:
                break
        prev_mean = mean
        LA, LB = Lc[0::2], Lc[1::2]
        mA = np.linalg.solve(LA, ec[0::2][..., None])[..., 0]
        mB = np.linalg.solve(LB, ec[1::2][..., None])[..., 0]
        M0, L0 = prior_z(H, mA, LA, mB, LB)
        Z, C, _, _ = laplace(G, off, yy, ww, AX["kv"], M0, L0, newton_iter)
        for s, Lcav, ecav in ((0, LA, ec[0::2]), (1, LB, ec[1::2])):
            blk = slice(s * K, (s + 1) * K)
            Pi = np.linalg.inv(C[:, blk, blk])
            Pi = 0.5 * (Pi + np.transpose(Pi, (0, 2, 1)))
            Ln = Pi - Lcav
            en = (Pi @ Z[:, blk][..., None])[..., 0] - ecav
            Ls[s::2] = (1 - damp) * Ls[s::2] + damp * Ln
            es[s::2] = (1 - damp) * es[s::2] + damp * en
    Lc, ec = chain_pass(H, steps, NP, Ls, es)
    Lm = Lc + Ls
    Pm = np.linalg.inv(Lm)
    Pm = 0.5 * (Pm + np.transpose(Pm, (0, 2, 1)))
    mm = (Pm @ (ec + es)[..., None])[..., 0]
    npl = X["n_players"]
    M = np.zeros((npl, K))
    P = np.zeros((npl, K, K))
    last = np.full(npl, -1)
    for p, nd in lastn.items():
        M[p], P[p], last[p] = mm[nd], Pm[nd], X["day"][nd // 2]
    return {"M": M, "P": P, "last": last, "sites": {"L": Ls, "e": es}, "iters": hist, "nf": nf,
            "smoothed_mean": mm, "smoothed_P": Pm}


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


SCHEDULES = ("none", "year", "quarter", "month")      # EP refit cadence, simplest first
_MONTHS = {"year": (1,), "quarter": (1, 4, 7, 10), "month": tuple(range(1, 13))}


def adf_sites(R, f_lo, f_hi):
    """Site messages implied by filter updates (posterior / prior at each node) for fights f_lo..f_hi-1."""
    f = np.arange(f_lo, f_hi)
    L = np.zeros((2 * len(f), K, K))
    e = np.zeros((2 * len(f), K))
    for s in (0, 1):
        P0i = np.linalg.inv(R["P0"][f, s])
        P1i = np.linalg.inv(R["P1"][f, s])
        L[s::2] = P1i - P0i
        e[s::2] = (P1i @ R["m1"][f, s][..., None])[..., 0] - (P0i @ R["m0"][f, s][..., None])[..., 0]
    return L, e


def run_schedule(X, H, years, schedule, logf=None, key="main"):
    """Pre-fight states for every fight in `years`: an EP smoothing refit of all earlier fights at each cut of the
    schedule (Jan 1 / quarter starts / month starts), ADF filter updates after every fight day in between. 'none' is the
    plain filter from 1994. Hyperparameters H are fixed (fit on data before the first predicted year)."""
    if schedule == "none":
        return run_filter(X, H, jan1(max(years) + 1), key=key)
    n = X["n"]
    R = {"done": np.zeros(n, bool), "m0": np.full((n, 2, K), np.nan), "P0": np.full((n, 2, K, K), np.nan),
         "new": np.zeros((n, 2), bool), "gap": np.zeros((n, 2)), "ep_iters": []}
    cuts = [dt.date(Y, m, 1).toordinal() for Y in sorted(years) for m in _MONTHS[schedule]] + [jan1(max(years) + 1)]
    sites = None
    for a, b in zip(cuts[:-1], cuts[1:]):
        S = ep_snapshot(X, H, a, init_sites=sites, key=key)
        R["ep_iters"].append(len(S["iters"]))
        Rr = run_filter(X, H, b, init=S, from_day=a, store=True, key=key)
        m = Rr["done"]
        for k in ("m0", "P0", "new", "gap"):
            R[k][m] = Rr[k][m]
        R["done"] |= m
        f_lo, f_hi = S["nf"], int(np.searchsorted(X["day"], b, "left"))
        Lx, ex = adf_sites(Rr, f_lo, f_hi)
        sites = {"L": np.concatenate([S["sites"]["L"], Lx]), "e": np.concatenate([S["sites"]["e"], ex])}
        if logf:
            logf("    cut %s: EP iters %d, %d fights filtered" % (dt.date.fromordinal(a), len(S["iters"]) + 1, m.sum()))
    return R


def predict_year(X, H, Y, years=None, schedule="none", logf=None, key="main"):
    """States for the predicted years (filter, or EP refits on a schedule + filter) and the predictions."""
    years = years or [Y]
    R = run_schedule(X, H, years, schedule, logf=logf, key=key)
    idx = np.flatnonzero(np.isin(X["year"], years) & R["done"])
    C, pA, m, v = cells(X, R, H, idx)
    st = stat_pred(X, R, H, idx)
    sd = np.sqrt(np.einsum("fskk->fsk", R["P0"][idx]))
    pl = win_prob(H["win"]["beta"], *feat_moments(R, idx), varaware=False)[0]
    return {"idx": idx, "cells": C, "pA": pA, "pA_plugin": pl, "m": m, "v": v, "stats": st,
            "m0": R["m0"][idx], "sd0": sd, "new": R["new"][idx]}


# ====================================================================== stages
VARIANTS = {
    # the model as specified: stat skills feed the result link (beta_up from the win GLM)
    "main": {},
    # results update only r; stat skills still enter the win GLM
    "r_only": {"link": "r_only"},
    # ablation: a pure dynamic Bradley-Terry on the round encoder (no stats, no method likelihood)
    "nostats": {"w_stat": 0.0, "w_meth": 0.0, "link": "r_only"},
}


def variant_hyper(name):
    H = default_hyper()
    H.update(copy.deepcopy(VARIANTS[name]))
    return H


def year_path(variant, Y):
    return os.path.join(CACHE, "fit_%s_%d.pkl" % (variant, Y))


def stage_fit(args):
    """Warm-started chain of yearly refits: hyperparameters for year Y use data before Jan 1 of Y only; predictions
    for Y come from the filter run with them (states updated after every fight day)."""
    X = load_data()
    y0, y1 = [int(v) for v in args.years.split("-")]
    v = args.variant
    H = variant_hyper(v)
    prev = year_path(v, y0 - 1)
    if os.path.exists(prev):
        H = pickle.load(open(prev, "rb"))["H"]
    for Y in range(y0, y1 + 1):
        p = year_path(v, Y)
        if os.path.exists(p) and not args.force:
            H = pickle.load(open(p, "rb"))["H"]
            log("%s %d cached" % (v, Y))
            continue
        cold = Y == y0 and not os.path.exists(prev)
        if v == "nostats":
            H = fit_year_nostats(X, Y, H, sweeps=3 if cold else 2)
        else:
            H = fit_year(X, Y, H, em_iters=2 if cold else 1, sweeps=3 if cold else 2, stat_sweeps=2 if cold else 1)
        P = predict_year(X, H, Y)
        pickle.dump({"H": H, "P": P, "variant": v, "year": Y}, open(p, "wb"))
        if Y >= 2024:          # validation years: scored once by `confirm`, never printed here
            log("%s %d: predictions stored (validation year, not scored here)" % (v, Y))
            continue
        ev = X["evalrow"][P["idx"]]
        yv = X["win"][P["idx"]][ev]
        pa = P["pA"][ev]
        log("%s %d: eval fights %d, winner LL %.5f (plug-in %.5f)" % (
            v, Y, ev.sum(), -np.mean(yv * np.log(pa) + (1 - yv) * np.log(1 - pa)),
            -np.mean(yv * np.log(P["pA_plugin"][ev]) + (1 - yv) * np.log(1 - P["pA_plugin"][ev]))))
    if args.static_from:
        Ys = int(args.static_from)
        H = pickle.load(open(year_path(v, Ys), "rb"))["H"]
        P = predict_year(X, H, Ys, years=list(range(Ys, y1 + 1)))
        pickle.dump({"H": H, "P": P, "variant": v, "years": list(range(Ys, y1 + 1))},
                    open(os.path.join(CACHE, "fit_%s_static%d.pkl" % (v, Ys)), "wb"))
        log("%s static fit through %d-12-31 predicted %s" % (v, Ys - 1, list(range(Ys, y1 + 1))))


def pred_path(variant, schedule, part):
    return os.path.join(CACHE, "pred_%s_%s_%s.pkl" % (variant, schedule, part))


def refit_win_on_ep(X, H, Y, back=7):
    """The prediction link (win GLM beta) refit on pre-fight states from yearly EP refits + filter over the training
    window Y-back..Y-1 (the update model, beta_up and the method GLM, is unchanged). Uses data before Jan 1 of Y only."""
    R = run_schedule(X, H, list(range(Y - back, Y)), "year")
    idx = win_rows(X, Y, back)
    idx = idx[R["done"][idx]]
    mu, S = feat_moments(R, idx)
    H2 = copy.deepcopy(H)
    H2["win"]["beta"] = fit_win_glm(mu, S, X["win"][idx], varaware=H["win"]["varaware"], beta0=H["win"]["beta"])
    H2["win_glm_states"] = "EP yearly refits + filter, %d-%d" % (Y - back, Y - 1)
    return H2


def config_H(X, variant, schedule, Y):
    """Hyperparameters for predicting year Y (fit on data before Jan 1 of Y) with the schedule's options applied:
    "+q<f>" multiplies the r-dimension process noise (per fight and per year) by f, "+w<f>" the round-encoder weight
    by f; "+g" refits the prediction link
    on EP-refit states of the training window. Returns the EP schedule and H."""
    sched, *opts = schedule.split("+")
    H = pickle.load(open(year_path(variant, Y), "rb"))["H"]
    for o in opts:
        if o.startswith("q"):
            H = copy.deepcopy(H)
            H["qf"][0] *= float(o[1:])
            H["qy"][0] *= float(o[1:])
        elif o.startswith("w"):               # "+w<f>": round-encoder weight x f
            H = copy.deepcopy(H)
            H["w_round"] *= float(o[1:])
    if "g" in opts:
        H = refit_win_on_ep(X, H, Y)
    return sched, H


def _predict_job(job):
    variant, schedule, part = job
    p = pred_path(variant, schedule, part)
    if os.path.exists(p):
        return p
    X = load_data()
    t0 = time.time()
    Y = {"static": 2024, "roll2025": 2025}.get(part) or int(part[3:])
    sched, H = config_H(X, variant, schedule, Y)
    years = [2024, 2025] if part == "static" else [Y]
    # oofY: hyperparameters fit on data before Jan 1 of Y; static: 2024-2025 from the fit before 2024-01-01;
    # roll2025: 2025 from the fit before 2025-01-01
    P = predict_year(X, H, Y, years=years, schedule=sched)
    P["H"] = H
    pickle.dump(P, open(p, "wb"))
    log("predict %s %s %s done (%.0f s)" % (variant, schedule, part, time.time() - t0))
    return p


def stage_predict(args):
    """Walk-forward predictions per (variant, EP schedule): oof2019..oof2023 (yearly hyperparameter refits), static
    (2024-2025 from the fit before 2024) and roll2025 (2025 from the fit before 2025). Validation parts are stored,
    never scored here."""
    variants = args.variant.split(",")
    scheds = args.schedules.split(",")
    parts = [p for p in args.parts.split(",")]
    jobs = [(v, s, p) for v in variants for s in scheds for p in parts]
    if args.jobs > 1:
        import multiprocessing as mp
        with mp.get_context("fork").Pool(args.jobs) as pool:
            for r in pool.imap_unordered(_predict_job, jobs):
                pass
    else:
        for j in jobs:
            _predict_job(j)


def load_preds(X, variant, schedule, scheme="static"):
    """Per-fight predictions aligned to X: 2019-2023 OOF plus 2024-2025 static (or 'roll': 2024 static, 2025 roll)."""
    n = X["n"]
    G = {"pA": np.full(n, np.nan), "pA_plugin": np.full(n, np.nan), "m": np.full(n, np.nan), "v": np.full(n, np.nan),
         "cells": np.full((n, 23), np.nan), "m0": np.full((n, 2, K), np.nan), "sd0": np.full((n, 2, K), np.nan),
         "new": np.zeros((n, 2), bool), "stats": defaultdict(lambda: np.full(n, np.nan)), "H": {},
         "part": np.array([""] * n, dtype=object)}
    parts = ["oof%d" % Y for Y in range(2019, 2024)]
    if scheme in ("static", "roll"):
        parts.append("static")
    if scheme == "roll":
        parts.append("roll2025")
    for part in parts:
        p = pred_path(variant, schedule, part)
        if not os.path.exists(p):
            continue
        P = pickle.load(open(p, "rb"))
        idx = P["idx"]
        if part == "static" and scheme == "roll":
            idx = idx[X["year"][idx] == 2024]
        sel = np.isin(P["idx"], idx)
        for k in ("pA", "pA_plugin", "m", "v"):
            G[k][idx] = P[k][sel]
        G["cells"][idx] = P["cells"][sel]
        G["m0"][idx] = P["m0"][sel]
        G["sd0"][idx] = P["sd0"][sel]
        G["new"][idx] = P["new"][sel]
        for k, v in P["stats"].items():
            G["stats"][k][idx] = v[sel]
        G["part"][idx] = part
        for Y in set(X["year"][idx].tolist()):
            G["H"][Y] = P["H"]
    return G


def fit_year_nostats(X, Y, H0, sweeps=2, logf=log):
    seq = sequences(X)
    H = copy.deepcopy(H0)
    R = run_filter(X, H, jan1(Y), store=True)
    H = em_update(X, R, H, Y, seq)
    H, best = coord_search(X, H, Y, sweeps=sweeps, logf=logf)
    R = run_filter(X, H, jan1(Y))
    H, ll = glm_step(X, R, H, Y)
    H["fit_through"] = str(dt.date(Y - 1, 12, 31))
    H["train_win_ll"] = ll
    logf("  %d nostats final win LL %.5f" % (Y, ll))
    return H


# ====================================================================== evaluation helpers
def ll_vec(p, y):
    p = np.clip(np.asarray(p, float), 1e-6, 1 - 1e-6)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


def boot(groups, arrays, n=2000, seed=7):
    """Event-cluster bootstrap of per-fight means (same scheme as tools/ml2.py: resample cards)."""
    rng = np.random.default_rng(seed)
    _, g = np.unique(np.asarray(groups), return_inverse=True)
    Gn = g.max() + 1
    A = np.vstack([np.asarray(a, float) for a in arrays]).T
    S = np.zeros((Gn, A.shape[1]))
    np.add.at(S, g, A)
    C = np.bincount(g, minlength=Gn).astype(float)
    out = np.empty((n, A.shape[1]))
    for b in range(n):
        w = np.bincount(rng.integers(0, Gn, Gn), minlength=Gn).astype(float)
        out[b] = (w @ S) / (w @ C)
    return out


def ci(v, d=4):
    return [round(float(np.percentile(v, 2.5)), d), round(float(np.percentile(v, 97.5)), d)]


def paired(la, lb, groups, n=2000):
    la, lb = np.asarray(la, float), np.asarray(lb, float)
    bs = boot(groups, [la, lb, la - lb], n)
    return {"n": int(len(la)), "a": round(float(la.mean()), 5), "b": round(float(lb.mean()), 5),
            "diff": round(float((la - lb).mean()), 5), "diff_ci": ci(bs[:, 2]), "a_ci": ci(bs[:, 0])}


def calib_slope(p, y):
    z = np.log(np.clip(p, 1e-6, 1 - 1e-6) / (1 - np.clip(p, 1e-6, 1 - 1e-6)))
    z, yy = np.r_[z, -z], np.r_[y, 1 - y]
    f = lambda b: np.sum(np.logaddexp(0, b[0] * z) - yy * b[0] * z)
    return float(minimize(f, [1.0], method="L-BFGS-B").x[0])


def win_metrics(p, y, groups=None):
    p = np.asarray(p, float)
    out = {"n": int(len(y)), "log_loss": round(float(ll_vec(p, y).mean()), 5),
           "brier": round(float(np.mean((p - y) ** 2)), 5),
           "accuracy": round(float(np.mean(np.where(np.abs(p - 0.5) < 1e-12, 0.5, (p > 0.5) == (y > 0.5)))), 4),
           "calib_slope": round(calib_slope(p, y), 3)}
    if groups is not None:
        out["log_loss_ci"] = ci(boot(groups, [ll_vec(p, y)])[:, 0])
    return out


def gather(X, variant, years, static=None):
    """Per-fight predictions (aligned to X) from the cached yearly fits (or one static fit for `static` years)."""
    n = X["n"]
    G = {"pA": np.full(n, np.nan), "pA_plugin": np.full(n, np.nan), "m": np.full(n, np.nan), "v": np.full(n, np.nan),
         "cells": np.full((n, 23), np.nan), "m0": np.full((n, 2, K), np.nan), "sd0": np.full((n, 2, K), np.nan),
         "new": np.zeros((n, 2), bool), "stats": defaultdict(lambda: np.full(n, np.nan)), "fit": {}}
    packs = []
    for Y in years:
        if static and Y >= static:
            continue
        packs.append(pickle.load(open(year_path(variant, Y), "rb")))
    if static:
        packs.append(pickle.load(open(os.path.join(CACHE, "fit_%s_static%d.pkl" % (variant, static)), "rb")))
    for pk in packs:
        P = pk["P"]
        keep = np.isin(X["year"][P["idx"]], years)
        idx = P["idx"][keep]
        for k in ("pA", "pA_plugin", "m", "v"):
            G[k][idx] = P[k][keep]
        G["cells"][idx] = P["cells"][keep]
        G["m0"][idx] = P["m0"][keep]
        G["sd0"][idx] = P["sd0"][keep]
        G["new"][idx] = P["new"][keep]
        for k, v in P["stats"].items():
            G["stats"][k][idx] = v[keep]
        G["fit"][str(pk.get("year", pk.get("years")))] = pk["H"].get("fit_through")
    return G


def comparators(X):
    """Other models' pre-fight P(A) on the backtest fights: ratings.json systems, ml2 stack table columns."""
    n = X["n"]
    pos = {f: i for i, f in enumerate(X["fid"])}
    C = {}
    rj = json.load(open(os.path.join(DERIVED, "ratings.json")))["predictions"]
    for sysn in ("whr_rounds", "glicko2", "elo_full", "trueskill_mov", "dims", "stack"):
        a = np.full(n, np.nan)
        for f, r in rj.items():
            if f in pos and str(r.get("date", "")) < "2026-01-01" and r["p"].get(sysn) is not None:
                a[pos[f]] = r["p"][sysn]
        C[sysn] = a
    S = pickle.load(open(os.path.join(ROOT, "out", "ml2_cache", "stack.pkl"), "rb"))
    D = S["D"]
    for c in ("ml2_static", "ml2lr_static", "ml2_roll", "ml2lr_roll", "market", "open", "mkt_rating", "elo"):
        a = np.full(n, np.nan)
        for f, v in zip(D["fid"], D[c]):
            if f in pos:
                a[pos[f]] = v
        C[c] = a
    return C


def outcome_cell(X):
    y = np.full(X["n"], -1)
    for i in range(X["n"]):
        c, w, r = X["cat"][i], X["win"][i], min(max(X["rnd"][i], 1), 5)
        if c == 4:
            y[i] = 22
        elif c == 3:
            y[i] = 20 if w == 1 else 21
        elif c in (1, 2):
            y[i] = (0 if w == 1 else 10) + (0 if c == 1 else 5) + r - 1
    return y


def methodround_cells(X, variant="S"):
    n = X["n"]
    pos = {f: i for i, f in enumerate(X["fid"])}
    Cm = np.full((n, 23), np.nan)
    mj = json.load(open(os.path.join(DERIVED, "methodround.json")))["fights"]
    for f, r in mj.items():
        if f not in pos or str(r.get("date", "")) >= "2026-01-01" or r.get(variant) is None:
            continue
        v = r[variant]
        R = int(r["rounds"])
        i = pos[f]
        row = np.zeros(23)
        row[0:R], row[5:5 + R], row[10:10 + R], row[15:15 + R] = v[0:R], v[R:2 * R], v[2 * R:3 * R], v[3 * R:4 * R]
        row[20], row[21], row[22] = v[4 * R], v[4 * R + 1], v[4 * R + 2]
        Cm[i] = row
    return Cm


def rescale_winner(Cl, pA):
    """Keep a joint's method-given-winner shares and draw mass, take P(A wins | not a draw) from pA."""
    C = Cl.copy()
    a = C[:, list(range(0, 10)) + [20]].sum(1)
    b = C[:, list(range(10, 20)) + [21]].sum(1)
    tot = a + b
    fa = tot * pA / np.maximum(a, 1e-12)
    fb = tot * (1 - pA) / np.maximum(b, 1e-12)
    C[:, list(range(0, 10)) + [20]] *= fa[:, None]
    C[:, list(range(10, 20)) + [21]] *= fb[:, None]
    return C


def mlrates_stats(X):
    """mlrates out-of-fold per-minute rates turned into expected per-fight counts given the actual minutes
    (KD given the actual head strikes landed)."""
    n = X["n"]
    pos = {f: i for i, f in enumerate(X["fid"])}
    J = json.load(open(os.path.join(DERIVED, "mlrates_oof.json")))
    T = J["meta"]["targets"]
    ti = {t: k for k, t in enumerate(T)}
    out = {k: np.full((n, 2), np.nan) for k in ("str", "td", "ctl", "sub", "kd")}
    src = np.array([""] * n, dtype=object)
    for f, r in J["fights"].items():
        if f not in pos or str(r.get("date", "")) >= "2026-01-01":
            continue
        i = pos[f]
        src[i] = r.get("src", "")
        for s, side in ((0, "A"), (1, "B")):
            v = r[side]
            g = lambda t: v[ti[t]]
            mins = X["mins"][i]
            sig_pm = g("d_att") * g("acc_d") + g("c_att") * g("acc_c") + g("g_att") * g("acc_g")
            out["str"][i, s] = sig_pm * mins
            out["td"][i, s] = g("td_att") * g("td_acc") * mins
            out["sub"][i, s] = g("sub_att") * mins
            out["ctl"][i, s] = g("ctrl") * mins / 30.0
            out["kd"][i, s] = g("kd_h") * X["head"][i, s]
    return out, src


def pois_dev(y, mu):
    mu = np.maximum(mu, 1e-9)
    return 2 * (np.where(y > 0, y * np.log(np.maximum(y, 1e-12) / mu), 0.0) - (y - mu))


def stat_actual(X, st):
    return {"str": X["sig"], "td": X["td"], "ctl": X["ctl"] / 30.0, "sub": X["sub"], "kd": X["kd"]}[st]


def nb_cdf(y, mu, k):
    from scipy.stats import nbinom
    return nbinom.cdf(y, k, k / (k + mu))


def stat_pit(X, G, H_by_year, rows, st, rng):
    """Randomised PIT and central-80% coverage of the per-fight predictive (moment-matched NB with skill, pace and
    form uncertainty) for one stat. For control (continuous 30 s units) the count is rounded."""
    pits, cov = [], []
    for s in (0, 1):
        mu = G["stats"]["%s_%d" % (st, s)][rows]
        lv = G["stats"]["%s_lv_%d" % (st, s)][rows]
        k = np.array([H_by_year[X["year"][i]]["k"][st] for i in rows])
        if st == "str":
            k = k * 3.0      # fight total over ~3 rounds: round-level NB noise averages out (rough)
        ke = 1.0 / (np.exp(np.minimum(lv, 5)) / k + np.exp(np.minimum(lv, 5)) - 1.0)
        y = np.round(stat_actual(X, st)[rows, s])
        F1 = nb_cdf(y, mu, ke)
        F0 = np.where(y > 0, nb_cdf(y - 1, mu, ke), 0.0)
        u = F0 + rng.random(len(y)) * (F1 - F0)
        pits.append(u)
        cov.append((u > 0.1) & (u < 0.9))
    u = np.concatenate(pits)
    hist = np.histogram(u, bins=10, range=(0, 1))[0] / len(u)
    return {"coverage_80": round(float(np.mean(np.concatenate(cov))), 4), "pit_deciles": np.round(hist, 4).tolist()}


SEL_MIN = 0.0005      # tools/ml2.py's rule: a more complex choice must beat the simpler one by more than this in CV


def eval_rows(X, G, C, years, need=("whr_rounds", "glicko2", "ml2_static")):
    rows = np.flatnonzero(X["evalrow"] & np.isin(X["year"], years) & ~np.isnan(G["pA"]))
    ok = np.all([~np.isnan(C[c][rows]) for c in need], 0)
    return rows[ok]


def config():
    p = os.path.join(CACHE, "cv.json")
    if not os.path.exists(p):
        return {"variant": "main", "schedule": "none", "varaware": True}
    return json.load(open(p))["chosen"]


def pick(G, varaware):
    return G["pA"] if varaware else G["pA_plugin"]


def stage_cv(args):
    """Choices on 2019-2023 walk-forward OOF only (each year's hyperparameters fit before Jan 1 of that year):
    the EP refit schedule (stepwise from the plain filter; a more frequent refit must win by > SEL_MIN), the link
    (plug-in vs variance-aware; the variance-aware link must win by > SEL_MIN), and the variant (the stat-free
    dynamic Bradley-Terry 'nostats' vs the full model 'main'; main must win by > SEL_MIN)."""
    X = load_data()
    C = comparators(X)
    years = list(range(2019, 2024))
    out = {"window": "2019-2023 OOF", "rule": "stepwise, simpler choice kept unless the next beats it by > %g" % SEL_MIN,
           "table": {}, "by_year": {}}
    preds = {}
    import glob
    for v in ("nostats", "main"):
        found = sorted(os.path.basename(q)[len("pred_%s_" % v):-len("_oof2019.pkl")]
                       for q in glob.glob(pred_path(v, "*", "oof2019")))
        for sc in found:
            if not all(os.path.exists(pred_path(v, sc, "oof%d" % Y)) for Y in years):
                continue
            preds[(v, sc)] = load_preds(X, v, sc, scheme="oof")
    base = preds[("main", "none")] if ("main", "none") in preds else next(iter(preds.values()))
    rows = eval_rows(X, base, C, years)
    for G in preds.values():
        rows = rows[~np.isnan(G["pA"][rows])]
    y = X["win"][rows]
    grp = np.array(X["event"])[rows]
    yr = X["year"][rows]
    out["n"] = int(len(rows))
    LL = {}
    for (v, sc), G in preds.items():
        for va in (False, True):
            k = "%s|%s|%s" % (v, sc, "varaware" if va else "plugin")
            lv = ll_vec(pick(G, va)[rows], y)
            LL[k] = float(lv.mean())
            out["table"][k] = {"ll": round(LL[k], 5), "acc": round(float(np.mean((pick(G, va)[rows] > 0.5) == (y > 0.5))), 4),
                               "slope": round(calib_slope(pick(G, va)[rows], y), 3)}
            out["by_year"][k] = {int(Y): round(float(lv[yr == Y].mean()), 5) for Y in years}
            log("cv %-34s LL %.5f acc %.4f slope %.3f  by year %s" % (k, LL[k], out["table"][k]["acc"], out["table"][k]["slope"],
                                                                     out["by_year"][k]))
    for c in ("whr_rounds", "glicko2", "ml2lr_static", "ml2_static"):
        lv = ll_vec(C[c][rows], y)
        out["table"][c] = {"ll": round(float(lv.mean()), 5)}
        out["by_year"][c] = {int(Y): round(float(lv[yr == Y].mean()), 5) for Y in years}
        log("cv %-34s LL %.5f by year %s" % (c, lv.mean(), out["by_year"][c]))
    steps = []

    def stepwise(cands):
        cur = cands[0]
        for c in cands[1:]:
            if c in LL and LL[c] < LL[cur] - SEL_MIN:
                steps.append("%s -> %s (%.5f -> %.5f)" % (cur, c, LL[cur], LL[c]))
                cur = c
            elif c in LL:
                steps.append("%s kept over %s (%.5f vs %.5f)" % (cur, c, LL[cur], LL[c]))
        return cur
    best = {}
    for v in ("nostats", "main"):
        for va in ("plugin", "varaware"):
            b0 = stepwise(["%s|%s|%s" % (v, sc, va) for sc in SCHEDULES if (v, sc) in preds])
            sc0 = b0.split("|")[1]
            b1 = stepwise([b0, "%s|%s+g|%s" % (v, sc0, va)]) if (v, sc0 + "+g") in preds else b0
            # r process-noise multipliers on top of the chosen schedule: the best one must beat it by > SEL_MIN
            sc1 = b1.split("|")[1]
            qs = ["%s|%s|%s" % (v, k[1], va) for k in preds if k[0] == v and k[1].startswith(sc1 + "+")
                  and k[1][len(sc1) + 1] in "qw"]
            best[(v, va)] = stepwise([b1, min(qs, key=lambda c: LL[c])]) if qs else b1
    for v in ("nostats", "main"):
        best[v] = stepwise([best[(v, "plugin")], best[(v, "varaware")]])
    final = stepwise([best["nostats"], best["main"]])
    v, sc, lk = final.split("|")
    out["steps"] = steps
    out["chosen"] = {"variant": v, "schedule": sc, "varaware": lk == "varaware", "key": final, "cv_ll": round(LL[final], 5)}
    Gc = preds[(v, sc)]
    pc = pick(Gc, lk == "varaware")[rows]
    out["paired_chosen_vs"] = {}
    for k2, p2 in (("whr_rounds", C["whr_rounds"][rows]), ("glicko2", C["glicko2"][rows]),
                   ("ml2lr_static (OOF)", C["ml2lr_static"][rows]),
                   ("main|none|" + lk, pick(preds[("main", "none")], lk == "varaware")[rows] if ("main", "none") in preds else None),
                   ("nostats|" + sc + "|" + lk, pick(preds[("nostats", sc)], lk == "varaware")[rows] if ("nostats", sc) in preds else None)):
        if p2 is None:
            continue
        out["paired_chosen_vs"][k2] = paired(ll_vec(pc, y), ll_vec(p2, y), grp)
        log("chosen - %-26s %+.5f %s" % (k2, out["paired_chosen_vs"][k2]["diff"], out["paired_chosen_vs"][k2]["diff_ci"]))
    for st in steps:
        log("  step: " + st)
    log("CHOSEN %s (CV LL %.5f)" % (final, LL[final]))
    json.dump(out, open(os.path.join(CACHE, "cv.json"), "w"), indent=1, default=float)


def evaluate(X, G, C, years, varaware, label, extra_models=None):
    """Standalone winner metrics, paired differences, uncertainty, method x round and stat lines on `years`."""
    E = {"window": label}
    rows = eval_rows(X, G, C, years)
    y = X["win"][rows]
    grp = np.array(X["event"])[rows]
    pb = pick(G, varaware)
    log("eval rows %d (%s)" % (len(rows), label))
    models = {"bayes": pb, "bayes (plug-in link)" if varaware else "bayes (variance-aware link)": pick(G, not varaware),
              "whr_rounds": C["whr_rounds"], "glicko2": C["glicko2"], "elo_full": C["elo_full"],
              "trueskill_mov": C["trueskill_mov"], "dims": C["dims"], "ratings_stack": C["stack"],
              "ml2 blend": C["ml2_static"],
              "ml2 logistic": C["ml2lr_static"], "elo": C["elo"]}
    models.update(extra_models or {})
    E["standalone"] = {k: win_metrics(a[rows], y, grp) for k, a in models.items() if not np.isnan(a[rows]).any()}
    for k, v in E["standalone"].items():
        log("%-28s LL %.5f %s acc %.3f slope %.2f" % (k, v["log_loss"], v["log_loss_ci"], v["accuracy"], v["calib_slope"]))
    lb = ll_vec(pb[rows], y)
    E["paired_bayes_minus"] = {}
    for k, a in models.items():
        if k == "bayes" or np.isnan(a[rows]).any():
            continue
        E["paired_bayes_minus"][k] = paired(lb, ll_vec(a[rows], y), grp)
        log("bayes - %-26s %+.5f %s" % (k, E["paired_bayes_minus"][k]["diff"], E["paired_bayes_minus"][k]["diff_ci"]))
    mk = ~np.isnan(C["market"][rows])
    E["bayes_minus_close"] = paired(lb[mk], ll_vec(C["market"][rows][mk], y[mk]), grp[mk])
    E["close"] = win_metrics(C["market"][rows][mk], y[mk], grp[mk])
    log("bayes - close %+.5f %s (n %d)" % (E["bayes_minus_close"]["diff"], E["bayes_minus_close"]["diff_ci"], mk.sum()))
    E["by_year"] = {}
    for Y in years:
        m = X["year"][rows] == Y
        E["by_year"][Y] = {k: round(float(ll_vec(a[rows][m], y[m]).mean()), 5) for k, a in models.items()
                           if not np.isnan(a[rows][m]).any()}
        E["by_year"][Y]["n"] = int(m.sum())
    log("by year %s" % json.dumps({Y: {k: E["by_year"][Y].get(k) for k in ("n", "bayes", "whr_rounds", "glicko2", "ml2 logistic")}
                                   for Y in years}))
    Gu = dict(G)
    Gu["pA"] = pb
    E["uncertainty"] = uncertainty_table(Gu, C, rows, y, grp, X)
    E["method"] = method_eval(X, G, C, years)
    E["stats"] = stats_eval(X, G, years)
    E["segments"] = {}
    npr = X["nprior"][rows].min(1)
    for name, m in (("newcomer bout (min prior UFC fights 1-2)", npr <= 2), ("3-7", (npr >= 3) & (npr <= 7)), ("8+", npr >= 8)):
        E["segments"][name] = {"n": int(m.sum()), "bayes": round(float(lb[m].mean()), 5),
                               "whr_rounds": round(float(ll_vec(C["whr_rounds"][rows][m], y[m]).mean()), 5),
                               "glicko2": round(float(ll_vec(C["glicko2"][rows][m], y[m]).mean()), 5),
                               "ml2 logistic": round(float(ll_vec(C["ml2lr_static"][rows][m], y[m]).mean()), 5),
                               "bayes - whr_rounds": paired(lb[m], ll_vec(C["whr_rounds"][rows][m], y[m]), grp[m])}
    log("segments %s" % json.dumps({k: {a: b for a, b in v.items() if a != "bayes - whr_rounds"} for k, v in E["segments"].items()}))
    return E


def stage_eval(args):
    """Every number here is on 2019-2023 (walk-forward out-of-sample: each year's hyperparameters fit on earlier
    years, states filtered fight by fight, EP refits on the CV-chosen schedule). 2024-2025 is scored once, by
    `confirm`."""
    X = load_data()
    cfg = config()
    G = load_preds(X, cfg["variant"], cfg["schedule"], scheme="oof")
    C = comparators(X)
    extra = {}
    for v in ("main", "nostats"):
        for sc in SCHEDULES + ("year+g",):
            if (v, sc) != (cfg["variant"], cfg["schedule"]) and os.path.exists(pred_path(v, sc, "oof2023")):
                extra["bayes %s/%s" % (v, sc)] = pick(load_preds(X, v, sc, scheme="oof"), cfg["varaware"])
    E = evaluate(X, G, C, list(range(2019, 2024)), cfg["varaware"], "2019-2023 OOF (yearly refits)", extra)
    E["config"] = cfg
    json.dump(E, open(os.path.join(CACHE, "eval.json"), "w"), indent=1, default=float)


def uncertainty_table(G, C, rows, y, grp, X, nb=3):
    sdv = np.sqrt(G["v"][rows])
    edges = np.quantile(sdv, np.linspace(0, 1, nb + 1))
    out = {"what": "fights split into terciles of the posterior sd of the result logit (beta' Delta); log loss, "
                   "accuracy and mirrored calibration slope of the variance-aware and plug-in predictions",
           "bins": []}
    pa, pp, pw = G["pA"][rows], G["pA_plugin"][rows], C["whr_rounds"][rows]
    for b in range(nb):
        m = (sdv >= edges[b]) & ((sdv <= edges[b + 1]) if b == nb - 1 else (sdv < edges[b + 1]))
        r = {"sd_range": [round(float(edges[b]), 3), round(float(edges[b + 1]), 3)], "n": int(m.sum()),
             "mean_abs_edge": round(float(np.mean(np.abs(pa[m] - 0.5))), 4),
             "accuracy": round(float(np.mean((pa[m] > 0.5) == (y[m] > 0.5))), 4),
             "ll_varaware": round(float(ll_vec(pa[m], y[m]).mean()), 5),
             "ll_plugin": round(float(ll_vec(pp[m], y[m]).mean()), 5),
             "slope_varaware": round(calib_slope(pa[m], y[m]), 3), "slope_plugin": round(calib_slope(pp[m], y[m]), 3),
             "whr_rounds_ll": round(float(ll_vec(pw[m], y[m]).mean()), 5),
             "whr_rounds_accuracy": round(float(np.mean((pw[m] > 0.5) == (y[m] > 0.5))), 4),
             "share_newcomer_bouts": round(float(np.mean(X["nprior"][rows][m].min(1) <= 2)), 3),
             "varaware_minus_plugin": paired(ll_vec(pa[m], y[m]), ll_vec(pp[m], y[m]), grp[m], 1000)}
        out["bins"].append(r)
        log("unc bin %d sd %s n %d edge %.3f acc %.3f LL va %.4f pl %.4f slope va %.2f pl %.2f | whr LL %.4f acc %.3f" % (
            b, r["sd_range"], r["n"], r["mean_abs_edge"], r["accuracy"], r["ll_varaware"], r["ll_plugin"],
            r["slope_varaware"], r["slope_plugin"], r["whr_rounds_ll"], r["whr_rounds_accuracy"]))
    # accuracy at matched confidence: logistic of "correct" on |logit p| and the posterior sd
    z = np.abs(np.log(pa / (1 - pa)))
    corr = ((pa > 0.5) == (y > 0.5)).astype(float)
    Xd = np.c_[np.ones(len(z)), z, sdv]
    f = lambda b: np.sum(np.logaddexp(0, Xd @ b) - corr * (Xd @ b))
    bb = minimize(f, np.zeros(3), method="BFGS")
    se = np.sqrt(np.diag(bb.hess_inv))
    out["correct_on_edge_and_sd"] = {"coef": np.round(bb.x, 4).tolist(), "se": np.round(se, 4).tolist(),
                                     "terms": ["1", "|logit p| (variance-aware)", "posterior sd of the logit"]}
    log("P(correct) ~ |logit p| + sd: %s se %s" % (np.round(bb.x, 3), np.round(se, 3)))
    return out


def method_eval(X, G, C, years):
    import methodround as MRm
    yc = outcome_cell(X)
    S = methodround_cells(X, "S")
    bt = set(e["id"] for e in json.load(open(os.path.join(DERIVED, "backtest_dev.json")))["fights"])
    rows = np.flatnonzero(np.array([f in bt for f in X["fid"]]) & np.isin(X["year"], years) & (yc >= 0)
                          & ~np.isnan(G["cells"][:, 0]) & ~np.isnan(S[:, 0]))
    grp = np.array(X["event"])[rows]
    y = yc[rows]
    out = {"n": int(len(rows))}
    arms = {"bayes": G["cells"][rows], "S (methodround, OOF)": S[rows]}
    ml2w = C["ml2_static"][rows]
    okw = ~np.isnan(ml2w)
    arms["bayes + ml2 winner"] = np.where(okw[:, None], rescale_winner(G["cells"][rows], np.nan_to_num(ml2w, nan=0.5)), G["cells"][rows])
    arms["S + ml2 winner"] = np.where(okw[:, None], rescale_winner(S[rows], np.nan_to_num(ml2w, nan=0.5)), S[rows])
    L = {k: MRm.per_fight_losses(v, y, None) for k, v in arms.items()}
    metr = ["joint", "method3", "bin7", "method_round", "round_given_fin", "ko_vs_sub", "winner", "method_given_winner"]
    out["means"] = {k: {m: round(float(np.nanmean(L[k][m])), 5) for m in metr} for k in arms}
    out["paired"] = {}
    for a, b in (("bayes", "S (methodround, OOF)"), ("bayes + ml2 winner", "S + ml2 winner")):
        for m in metr:
            ok = ~np.isnan(L[a][m]) & ~np.isnan(L[b][m])
            out["paired"]["%s - %s | %s" % (a, b, m)] = paired(L[a][m][ok], L[b][m][ok], grp[ok], 2000)
    for k, v in out["means"].items():
        log("method %-24s %s" % (k, v))
    for k, v in out["paired"].items():
        if any(m in k for m in ("| bin7", "| method3", "| method_given_winner", "| joint")):
            log("  %-70s %+.5f %s" % (k, v["diff"], v["diff_ci"]))
    return out


def stats_eval(X, G, years):
    MLR, src = mlrates_stats(X)
    bt = set(e["id"] for e in json.load(open(os.path.join(DERIVED, "backtest_dev.json")))["fights"])
    rows = np.flatnonzero(np.array([f in bt for f in X["fid"]]) & np.isin(X["year"], years) & X["has"]
                          & ~np.isnan(G["stats"]["str_0"]) & ~np.isnan(MLR["str"][:, 0]))
    grp = np.array(X["event"])[rows]
    H_by_year = G["H"]
    rng = np.random.default_rng(11)
    out = {"n_fights": int(len(rows)), "what": "Poisson deviance per fighter-fight of expected counts given the "
           "actual minutes (KD given actual head strikes landed); baseline = division baseline rate only", "stats": {}}
    for st in ("str", "td", "ctl", "sub", "kd"):
        yv = stat_actual(X, st)[rows]
        mb = np.stack([G["stats"]["%s_0" % st][rows], G["stats"]["%s_1" % st][rows]], 1)
        mm = MLR[st][rows]
        if st == "str":
            base = np.stack([sum(X["rmins"][rows, j] * X["rmult"][rows, j] for j in range(5)) * np.exp(X["L_str"][rows])] * 2, 1)
        elif st == "kd":
            base = (X["head"][rows] + 1.0) * np.exp(X["L_kd"][rows])[:, None]
        else:
            ex = {"td": X["mins"][rows] / 15.0, "ctl": X["mins"][rows] * 2.0, "sub": X["mins"][rows] / 15.0}[st]
            base = np.stack([ex * np.exp(X["L_" + st][rows])] * 2, 1)
        db, dm, d0 = pois_dev(yv, mb).sum(1), pois_dev(yv, mm).sum(1), pois_dev(yv, base).sum(1)
        r = {"bayes": round(float(db.mean() / 2), 4), "mlrates_oof": round(float(dm.mean() / 2), 4),
             "baseline": round(float(d0.mean() / 2), 4),
             "bayes - mlrates": paired(db / 2, dm / 2, grp), "bayes - baseline": paired(db / 2, d0 / 2, grp),
             "mean_actual": round(float(yv.mean()), 3), "mean_bayes": round(float(mb.mean()), 3),
             "mean_mlrates": round(float(mm.mean()), 3)}
        r["calibration"] = stat_pit(X, G, H_by_year, rows, st, rng)
        out["stats"][st] = r
        log("stat %-4s dev bayes %.4f mlrates %.4f base %.4f | b-m %+.4f %s | mean act %.3f b %.3f m %.3f | cov80 %.3f" % (
            st, r["bayes"], r["mlrates_oof"], r["baseline"], r["bayes - mlrates"]["diff"], r["bayes - mlrates"]["diff_ci"],
            r["mean_actual"], r["mean_bayes"], r["mean_mlrates"], r["calibration"]["coverage_80"]))
    return out


# ====================================================================== stack gate (ml2's forward-chained 2021-2023 stack CV)
STACK_SETS = {
    "line": [("market+ml2", ["market", "ml2"]), ("page: market+ml2lr", ["market", "ml2lr"]),
             ("market+whr", ["market", "whr"]), ("market+bayes", ["market", "bayes"])],
    "noline": [("ml2+mkt_rating+feat_lr", ["ml2", "mkt_rating", "feat_lr"]), ("page: ml2lr+mkt_rating", ["ml2lr", "mkt_rating"]),
               ("ratings: whr+glicko2", ["whr", "glicko2"]), ("whr alone", ["whr"]), ("bayes alone", ["bayes"])],
    "open": [("open+ml2", ["open", "ml2"]), ("page: open+ml2lr", ["open", "ml2lr"])],
}
GATE_PAIRS = {   # base set -> base + bayes (enters if the forward-chained CV gain beats SEL_MIN)
    "line": ["market+ml2", "page: market+ml2lr", "market+whr"],
    "noline": ["ml2+mkt_rating+feat_lr", "page: ml2lr+mkt_rating", "ratings: whr+glicko2", "whr alone"],
    "open": ["open+ml2", "page: open+ml2lr"],
}


def M2():
    """tools/ml2.py for its stack code (stack_fit, zmat, rec_w, stack_predict, ll, compare); the bayes and ratings
    columns are routed through ml2.col_for like ml2's own experts ("<name>_static" / "<name>_roll")."""
    import ml2 as m2
    if not getattr(m2, "_bayes_patched", False):
        orig = m2.col_for

        def col_for(c, scheme):
            if c in ("bayes", "whr", "glicko2"):
                return c + "_" + scheme
            return orig(c, scheme)
        m2.col_for = col_for
        m2._bayes_patched = True
    return m2


def expert_D(X, cfg):
    """ml2's 2019-2025 expert table (out/ml2_cache/stack.pkl) plus bayes (OOF 2019-2023; 2024-2025 'static' = fit
    before 2024, 'roll' = 2025 from the fit before 2025) and the ratings.py systems (sequential, same in both)."""
    D = pickle.load(open(os.path.join(ROOT, "out", "ml2_cache", "stack.pkl"), "rb"))["D"].copy()
    pos = {f: i for i, f in enumerate(X["fid"])}
    ii = np.array([pos.get(f, -1) for f in D["fid"]])
    assert (ii >= 0).all(), "ml2 table fight missing from bayes data"
    assert np.all(X["win"][ii] == D["y"].to_numpy()), "label mismatch with ml2's table"
    C = comparators(X)
    for sch in ("static", "roll"):
        G = load_preds(X, cfg["variant"], cfg["schedule"], scheme=sch)
        D["bayes_" + sch] = pick(G, cfg["varaware"])[ii]
        D["whr_" + sch] = C["whr_rounds"][ii]
        D["glicko2_" + sch] = C["glicko2"][ii]
    return D


def stack_cv_one(m2, D, cols, rows_ok, y, yr):
    cvs, preds = {}, {}
    for h in (None, 3.0, 1.5):
        tot = nn = 0.0
        pr = np.full(len(D), np.nan)
        for Y in (2021, 2022, 2023):
            m = rows_ok & (yr == Y)
            p, _ = m2.stack_predict(D, cols, "static", h, Y - 1, m, rows_ok)
            pr[m] = p
            tot += m2.ll(p, y[m]) * m.sum()
            nn += m.sum()
        cvs[str(h)] = round(tot / nn, 5)
        preds[str(h)] = pr
    hbest = min(cvs, key=lambda k: cvs[k] + (0 if k == "None" else SEL_MIN))
    return cvs, hbest, preds[hbest]


def rows_regime(D):
    return {"line": D["market"].notna().to_numpy() & D["bayes_static"].notna().to_numpy(),
            "noline": D["bayes_static"].notna().to_numpy(),
            "open": D["open"].notna().to_numpy() & D["bayes_static"].notna().to_numpy()}


def stage_stack(args):
    """Forward-chained 2021-2023 stack CV (fit on 2019..Y-1 OOF rows, predict Y; recency half-life by the same CV with
    ml2's SEL_MIN preference for no weighting). bayes enters a stack only if base + bayes beats base by > SEL_MIN."""
    X = load_data()
    cfg = config()
    m2 = M2()
    D = expert_D(X, cfg)
    y, yr = D["y"].to_numpy(float), D["year"].to_numpy()
    ev = D["event"].to_numpy()
    RO = rows_regime(D)
    R = {"config": cfg, "sets": {}, "gate": {}, "paired_cv_years": {}}
    P = {}
    for regime, sets in STACK_SETS.items():
        allsets = list(sets) + [(nm + " + bayes", cols + ["bayes"]) for nm, cols in sets if nm in GATE_PAIRS[regime]]
        for nm, cols in allsets:
            cvs, hb, pr = stack_cv_one(m2, D, cols, RO[regime], y, yr)
            h = None if hb == "None" else float(hb)
            _, b = m2.stack_predict(D, cols, "static", h, 2023, np.zeros(len(D), bool), RO[regime])
            R["sets"]["%s|%s" % (regime, nm)] = {"cols": cols, "cv_by_h": cvs, "chosen_h": h, "cv": cvs[hb],
                                                 "weights_fit_2019_2023": dict(zip(cols, np.round(b, 4).tolist()))}
            P["%s|%s" % (regime, nm)] = pr
            log("stack CV %-6s %-34s CV %.5f (h %s) w<=2023 %s" % (regime, nm, cvs[hb], h, np.round(b, 3)))
        for base in GATE_PAIRS[regime]:
            kb, kn = "%s|%s" % (regime, base), "%s|%s + bayes" % (regime, base)
            gain = R["sets"][kn]["cv"] - R["sets"][kb]["cv"]
            m = RO[regime] & (yr >= 2021) & (yr <= 2023)
            pc = paired(ll_vec(P[kn][m], y[m]), ll_vec(P[kb][m], y[m]), ev[m])
            R["gate"][kn] = {"cv_base": R["sets"][kb]["cv"], "cv_plus": R["sets"][kn]["cv"], "gain": round(gain, 5),
                             "enters": bool(gain < -SEL_MIN), "bayes_weight": R["sets"][kn]["weights_fit_2019_2023"]["bayes"],
                             "paired_cv_years": pc}
            log("GATE %-44s gain %+.5f %s -> %s (w %.3f)" % (kn, gain, pc["diff_ci"], "ENTERS" if gain < -SEL_MIN else "rejected",
                                                            R["gate"][kn]["bayes_weight"]))
    # bayes vs whr as the rating input (same partners): which rating carries more in the stack?
    for regime, a_, b_ in (("noline", "bayes alone", "whr alone"), ("line", "market+bayes", "market+whr")):
        m = RO[regime] & (yr >= 2021) & (yr <= 2023)
        ka, kb = "%s|%s" % (regime, a_), "%s|%s" % (regime, b_)
        R["paired_cv_years"][ka + " vs " + kb] = paired(ll_vec(P[ka][m], y[m]), ll_vec(P[kb][m], y[m]), ev[m])
        log("CV years %-40s %s" % (ka + " vs " + kb, R["paired_cv_years"][ka + " vs " + kb]))
    json.dump(R, open(os.path.join(CACHE, "stack.json"), "w"), indent=1, default=float)


# ====================================================================== swap test
def stage_swap(args):
    """Corner symmetry: rerun the chosen configuration (2019 hyperparameters, EP refits + filter through 2019) on the
    corner-swapped data; P(A wins) must mirror, the method x round cells must swap sides, the stat lines must swap."""
    X = load_data()
    cfg = config()
    sched, H = config_H(X, cfg["variant"], cfg["schedule"], 2019)
    Y = swap_data(X)
    P1 = predict_year(X, H, 2019, schedule=sched, key="main")
    P2 = predict_year(Y, H, 2019, schedule=sched, key="swap")
    assert np.array_equal(P1["idx"], P2["idx"])
    sw = np.r_[np.arange(10, 20), np.arange(0, 10), 21, 20, 22]
    out = {"n": int(len(P1["idx"])), "config": cfg,
           "max|pA + pA_swapped - 1|": float(np.max(np.abs(P1["pA"] + P2["pA"] - 1))),
           "max|plugin pA + swapped - 1|": float(np.max(np.abs(P1["pA_plugin"] + P2["pA_plugin"] - 1))),
           "max|cells - swapped cells mirrored|": float(np.max(np.abs(P1["cells"] - P2["cells"][:, sw]))),
           "max|stat A - stat B swapped|": float(max(np.nanmax(np.abs(P1["stats"]["%s_0" % k] - P2["stats"]["%s_1" % k]))
                                                     for k in STATS)),
           "max|skill A - skill B swapped|": float(np.nanmax(np.abs(P1["m0"][:, 0] - P2["m0"][:, 1])))}
    log("swap test: %s" % out)
    json.dump(out, open(os.path.join(CACHE, "swaptest.json"), "w"), indent=1)
    assert out["max|pA + pA_swapped - 1|"] < 1e-6 and out["max|cells - swapped cells mirrored|"] < 1e-6, "corner symmetry violated"


# ====================================================================== confirm: the one 2024-2025 look
def stage_confirm(args):
    """Scores 2024-01-01..2025-12-31 ONCE with every choice frozen by `cv` and `stack` (pre-2024 only). Refuses to run
    again unless --force (a forced rerun is recorded in the output). Nothing is tuned on these numbers."""
    p = os.path.join(CACHE, "confirm.json")
    if os.path.exists(p) and not args.force:
        log("confirm.json exists: the 2024-2025 look was already taken (use --force to recompute; it is recorded)")
        return
    X = load_data()
    cfg = config()
    stk = json.load(open(os.path.join(CACHE, "stack.json")))
    C = comparators(X)
    years = [2024, 2025]
    out = {"window": "2024-01-01..2025-12-31, scored once", "config": cfg, "forced_rerun": bool(os.path.exists(p)),
           "computed": dt.datetime.utcnow().isoformat(timespec="seconds") + "Z"}
    Gs = load_preds(X, cfg["variant"], cfg["schedule"], scheme="static")
    Gr = load_preds(X, cfg["variant"], cfg["schedule"], scheme="roll")
    extra = {"bayes (roll: 2025 from the fit before 2025)": pick(Gr, cfg["varaware"])}
    if cfg["schedule"] != "none" and os.path.exists(pred_path(cfg["variant"], "none", "static")):
        extra["bayes filter only (no EP refits)"] = pick(load_preds(X, cfg["variant"], "none", scheme="static"), cfg["varaware"])
    if os.path.exists(pred_path("nostats", cfg["schedule"], "static")):
        extra["bayes nostats (same schedule)"] = pick(load_preds(X, "nostats", cfg["schedule"], scheme="static"), cfg["varaware"])
    out["static"] = evaluate(X, Gs, C, years, cfg["varaware"], "2024-2025, hyperparameters fit before 2024 (static)", extra)
    # stacks: the gate pairs, static (weights fit on 2019-2023 with the CV-chosen h) and rolling (refit each January)
    m2 = M2()
    D = expert_D(X, cfg)
    y, yr = D["y"].to_numpy(float), D["year"].to_numpy()
    ev = D["event"].to_numpy()
    RO = rows_regime(D)
    out["stacks"] = {}
    for kn, g in stk["gate"].items():
        regime = kn.split("|")[0]
        kb = kn[:-len(" + bayes")]
        res = {"enters_by_cv": g["enters"], "cv_gain": g["gain"]}
        va = RO[regime] & (yr >= 2024) & (yr <= 2025)
        for sch in ("static", "roll"):
            pp = {}
            for k in (kb, kn):
                cols, h = stk["sets"][k]["cols"], stk["sets"][k]["chosen_h"]
                if sch == "static":
                    pr, _ = m2.stack_predict(D, cols, "static", h, 2023, va, RO[regime])
                else:
                    pr = np.full(len(D), np.nan)
                    for Y in (2024, 2025):
                        m = RO[regime] & (yr == Y)
                        pr[m], _ = m2.stack_predict(D, cols, "roll", h, Y - 1, m, RO[regime])
                    pr = pr[va]
                pp[k] = pr
            res[sch] = paired(ll_vec(pp[kn], y[va]), ll_vec(pp[kb], y[va]), ev[va])
            mk = D["market"].notna().to_numpy()[va]
            res[sch + " plus vs close"] = paired(ll_vec(pp[kn][mk], y[va][mk]), ll_vec(D["market"].to_numpy(float)[va][mk], y[va][mk]),
                                                 ev[va][mk])
            res[sch + " base vs close"] = paired(ll_vec(pp[kb][mk], y[va][mk]), ll_vec(D["market"].to_numpy(float)[va][mk], y[va][mk]),
                                                 ev[va][mk])
        out["stacks"][kn] = res
        log("2024-25 %-44s (CV %s) static %+.5f %s | roll %+.5f %s" % (
            kn, "enters" if g["enters"] else "rejected", res["static"]["diff"], res["static"]["diff_ci"],
            res["roll"]["diff"], res["roll"]["diff_ci"]))
    json.dump(out, open(p, "w"), indent=1, default=float)


# ====================================================================== export
def virtual_pair(X, H, S, pa, pb, day, five=True, div="Lightweight"):
    """Pre-fight moments for a hypothetical fight between fighters pa and pb on `day` (time update from the snapshot S,
    ages from date of birth), with P(A wins) and method x round cells."""
    m0 = np.zeros((1, 2, K))
    P0 = np.zeros((1, 2, K, K))
    ages = []
    for s, p in ((0, pa), (1, pb)):
        i = np.flatnonzero((X["ia"] == p) | (X["ib"] == p))[-1]
        side = 0 if X["ia"][i] == p else 1
        gap = (day - S["last"][p]) / YEAR
        age = X["age"][i, side] + (day - X["day"][i]) / YEAR
        ages.append(age)
        dr = age_G(np.array([age]), H["dy"], H["do"], H["ay"], H["ao"]) - age_G(np.array([age - gap]), H["dy"], H["do"], H["ay"], H["ao"])
        dr -= H["lay"] * max(0.0, min(gap, 4.0) - 0.75)
        g6 = min(gap, 6.0)
        drift = g6 * (H["drift_a"] + H["drift_b"] * (age - gap / 2.0 - 30.0))
        drift[0] = dr[0]
        m0[0, s] = S["M"][p] + drift
        P0[0, s] = S["P"][p] + np.diag(H["qf"] + H["qy"] * g6)
    R = {"m0": m0, "P0": P0}
    mu, Sg = feat_moments(R, np.array([0]))
    pA, m, v = win_prob(H["win"]["beta"], mu, Sg, H["win"]["varaware"])
    return {"pA": float(pA[0]), "logit_mean": float(m[0]), "logit_sd": float(np.sqrt(v[0])), "ages": ages,
            "m0": m0[0], "sd0": np.sqrt(np.einsum("skk->sk", P0[0]))}


def stage_export(args):
    """data/derived/bayes.json: config, CV, 2019-2023 evaluation, stack gate, the 2024-2025 confirmation, swap test,
    per-fight predictions (2019-2025 backtest fights) and the production roster (hyperparameters fit on data before
    2026-01-01, EP smoothing over every fight through 2025-12-31): skill means and sds per fighter, usable as simulator
    inputs."""
    X = load_data()
    cfg = config()
    rd = lambda a, d=4: None if a is None or not np.isfinite(a) else round(float(a), d)
    J = {"meta": {"tool": "tools/bayes.py", "built": dt.datetime.utcnow().isoformat(timespec="seconds") + "Z",
                  "data_through": str(dt.date.fromordinal(int(X["day"].max()))),
                  "protocol": "fights dated 2026-01-01 or later dropped at parse; hyperparameters refit each Jan 1 on "
                              "earlier fights (empirical Bayes); every choice by 2019-2023 OOF / forward-chained "
                              "2021-2023 stack CV; 2024-2025 scored once by `confirm`",
                  "dims": DIMS, "dim_label": DIM_LABEL, "config": cfg,
                  "cells": "A KO r1..5, A SUB r1..5, B KO r1..5, B SUB r1..5, A DEC, B DEC, DRAW (A = first ufcstats name)"}}
    for nm in ("cv", "eval", "stack", "confirm", "swaptest"):
        pth = os.path.join(CACHE, nm + ".json")
        J[nm] = json.load(open(pth)) if os.path.exists(pth) else None
    Gs = load_preds(X, cfg["variant"], cfg["schedule"], scheme="static")
    Gr = load_preds(X, cfg["variant"], cfg["schedule"], scheme="roll")
    bt = set(e["id"] for e in json.load(open(os.path.join(DERIVED, "backtest_dev.json")))["fights"])
    F = {}
    for i in np.flatnonzero(~np.isnan(Gs["pA"]) & np.isin(X["year"], list(range(2019, 2026)))):
        f = X["fid"][i]
        if f not in bt:
            continue
        r = {"date": str(dt.date.fromordinal(int(X["day"][i]))), "set": "oof" if X["year"][i] <= 2023 else "valid",
             "p": rd(pick(Gs, cfg["varaware"])[i]), "p_roll": rd(pick(Gr, cfg["varaware"])[i]),
             "p_plugin": rd(Gs["pA_plugin"][i]), "logit_sd": rd(math.sqrt(max(Gs["v"][i], 0.0))),
             "fit_through": Gs["H"][int(X["year"][i])].get("fit_through"),
             "cells": [rd(c) for c in Gs["cells"][i]],
             "skill_A": [rd(c, 3) for c in Gs["m0"][i, 0]], "skill_B": [rd(c, 3) for c in Gs["m0"][i, 1]],
             "skill_sd_A": [rd(c, 3) for c in Gs["sd0"][i, 0]], "skill_sd_B": [rd(c, 3) for c in Gs["sd0"][i, 1]]}
        F[f] = r
    J["fights"] = F
    # production roster
    Yp = 2026 if os.path.exists(year_path(cfg["variant"], 2026)) else 2025
    sched, H = config_H(X, cfg["variant"], cfg["schedule"], Yp)
    S = ep_snapshot(X, H, jan1(2026)) if sched != "none" else run_filter(X, H, jan1(2026))["state"]
    roster = {}
    lastdiv = {}
    for i in range(X["n"]):
        for s, p in ((0, X["ia"][i]), (1, X["ib"][i])):
            lastdiv[p] = i
    for p, i in lastdiv.items():
        side = 0 if X["ia"][i] == p else 1
        if X["day"][i] < jan1(2019):
            continue
        sd = np.sqrt(np.diag(S["P"][p]))
        Lb = {k: float(X["L_" + k][i]) for k in STATS}
        mm = S["M"][p]
        roster[X["slug"][p]] = {
            "name": X["name"][p],
            "last_fight": str(dt.date.fromordinal(int(X["day"][i]))), "division": X["division"][i],
            "mean": {d: rd(mm[j], 3) for j, d in enumerate(DIMS)}, "sd": {d: rd(sd[j], 3) for j, d in enumerate(DIMS)},
            "rates_vs_average": {"sig_landed_pm": rd(math.exp(Lb["str"] + mm[DI["so"]]), 3),
                                 "sig_absorbed_pm": rd(math.exp(Lb["str"] - mm[DI["sd"]]), 3),
                                 "td_per15": rd(math.exp(Lb["td"] + mm[DI["to"]]), 3),
                                 "td_allowed_per15": rd(math.exp(Lb["td"] - mm[DI["tdd"]]), 3),
                                 "ctl_sec_pm": rd(30 * math.exp(Lb["ctl"] + mm[DI["co"]]), 2),
                                 "sub_att_per15": rd(math.exp(Lb["sub"] + mm[DI["su"]]), 3),
                                 "kd_per_head_landed": rd(math.exp(Lb["kd"] + mm[DI["pw"]]), 4),
                                 "kd_per_head_absorbed": rd(math.exp(Lb["kd"] - mm[DI["ch"]]), 4),
                                 "output_trend_per_round": rd(math.exp(mm[DI["ca"]]), 4)}}
    J["roster"] = roster
    J["roster_meta"] = {"hyperparameters_fit_through": H.get("fit_through"), "states_through": "2025-12-31",
                        "fighters": len(roster), "note": "fighters with a UFC fight in 2019-2025; rates are vs an average "
                        "opponent at the division baseline of the fighter's last fight (exp(L + skill)); skills are log "
                        "multipliers (r in logit units)"}
    # the project's matchup
    try:
        pa, pb = X["slug"].index("alexander-volkanovski"), X["slug"].index("justin-gaethje")
        V = virtual_pair(X, H, S, pa, pb, jan1(2026))
        J["matchup"] = {"alexander-volkanovski__justin-gaethje": {"pA": rd(V["pA"]), "logit_mean": rd(V["logit_mean"]),
                        "logit_sd": rd(V["logit_sd"]), "as_of": "2026-01-01 (states through 2025-12-31)"}}
    except (ValueError, KeyError, TypeError, IndexError) as e:
        J["matchup"] = {"error": str(e)}
    with open(OUT_JSON, "w") as fh:
        json.dump(J, fh, separators=(",", ":"), default=float)
    log("wrote %s: %d fights, %d roster fighters" % (OUT_JSON, len(F), len(roster)))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("stage")
    ap.add_argument("--years", default="2019-2023")
    ap.add_argument("--variant", default="main")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--static-from", default=None)
    ap.add_argument("--schedules", default="none,year,quarter,month")
    ap.add_argument("--parts", default="oof2019,oof2020,oof2021,oof2022,oof2023,static,roll2025")
    ap.add_argument("--jobs", type=int, default=1)
    args = ap.parse_args()
    STAGES[args.stage](args)


STAGES = {"data": stage_data, "fit": stage_fit, "predict": stage_predict, "cv": stage_cv, "eval": stage_eval,
          "stack": stage_stack, "swap": stage_swap, "confirm": stage_confirm, "export": stage_export}

if __name__ == "__main__":
    main()
