#!/usr/bin/env python3
"""Fighter embeddings: time-aware offense / defense latent vectors learned by a multi-task factorisation.

    python3 tools/embed.py                  # everything: CV on 2019-2023, walk-forward 2019-2025, downstream
                                            # tests, roster fit, outputs (about 15-20 minutes on 2 cores)
    python3 tools/embed.py --quick          # small grid, quarterly refits (smoke test, a few minutes)
    python3 tools/embed.py --skip-cv        # reuse the hyperparameters stored in data/derived/embed.json

Model (one fit = one date T, every UFC fight with round stats from 2005-01-01 to the day before T):

  every fighter i has an offense vector a_i and a defense vector d_i (K dims each). For each directed
  observation "X against Y in fight f" and each task t,

      eta_t = mu_t[division] + beta_t * era + gamma_t * five_round + W_t . a_X + V_t . d_Y

  with a log link for counts (Poisson with exposure: minutes for strike attempts by position and target,
  non-significant attempts, takedown attempts, control minutes, submission attempts, reversals, KO/TKO and
  submission finish hazards; landed head strikes for knockdowns) and a logit link for proportions
  (accuracy at distance / clinch / ground and to head / body / leg, takedown accuracy). Every task's
  log-likelihood is divided by its overdispersion phi_t (Pearson, estimated once on pre-2019 fights),
  i.e. a quasi-likelihood. The result head is antisymmetric (no intercept, so it cannot learn corners):

      logit P(X beats Y) = u_a.(a_X - a_Y) + u_d.(d_X - d_Y) + a_X' M d_Y - a_Y' M d_X

  Every observation is weighted 0.5 ^ ((T - date) / half_life) (decay-weighted refit: the temporal prior),
  fighters and loadings carry L2 priors of the same strength lambda (a nuclear-norm-like penalty on the
  fighter x task matrix), and fits are MAP by L-BFGS with analytic gradients, warm-started from the
  previous refit and Procrustes-aligned to it so the axes keep their meaning through time.

Walk-forward: refits at every distinct event date (default) or every month / quarter; a fight dated d uses
the refit of the latest refit date <= d, which saw only fights strictly before that date. Hyperparameters
(K, lambda, half-life, win weight) are chosen by time-ordered CV on 2019-2023 quarters; 2024-2025 is the
validation period. Fights dated 2026-01-01 or later are dropped on load (hidden-data protocol) and never
read; the roster embeddings are the fit at 2026-01-01.

Writes data/derived/embed.json (model, per-snapshot embeddings keyed by backtest id and side, roster
embeddings keyed by slug, interpretation, nearest neighbours, validation numbers), data/derived/
embed_model.json (compact browser model for src/ml/embed.js) and research/model_embed.md.
"""
from __future__ import annotations

import os

for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "2")

import argparse
import datetime as dt
import json
import math
import sys
import time
from collections import defaultdict

import numpy as np
from scipy import sparse
from scipy.optimize import minimize

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import build_db as B  # noqa: E402

DER = os.path.join(ROOT, "data", "derived")
OUT_JSON = os.path.join(DER, "embed.json")
OUT_MODEL = os.path.join(DER, "embed_model.json")
OUT_MD = os.path.join(ROOT, "research", "model_embed.md")
BACKTEST_DEV = os.path.join(DER, "backtest_dev.json")

DATA_FROM = dt.date(2005, 1, 1)          # training rows start here (older fights have ~0 weight anyway)
HIDDEN_FROM = dt.date(2026, 1, 1)        # hidden-data protocol: nothing on or after this date is loaded
TRAIN = (dt.date(2019, 1, 1), dt.date(2024, 1, 1))
VALID = (dt.date(2024, 1, 1), dt.date(2026, 1, 1))
SEED = 20261106

KI = B.KI

# ------------------------------------------------------------------------------------------------ tasks
# (name, kind, label): kind "pm" = Poisson per fight minute, "bin" = binomial, "kd" = Poisson per landed head
# strike, "hz" = finish hazard per fight minute (Poisson with a 0/1 count).
TASKS = [
    ("d_att", "pm", "distance sig. attempts / min"),
    ("c_att", "pm", "clinch sig. attempts / min"),
    ("g_att", "pm", "ground sig. attempts / min"),
    ("h_att", "pm", "head sig. attempts / min"),
    ("b_att", "pm", "body sig. attempts / min"),
    ("l_att", "pm", "leg sig. attempts / min"),
    ("ns_att", "pm", "non-significant attempts / min"),
    ("d_acc", "bin", "distance accuracy"),
    ("c_acc", "bin", "clinch accuracy"),
    ("g_acc", "bin", "ground accuracy"),
    ("h_acc", "bin", "head accuracy"),
    ("b_acc", "bin", "body accuracy"),
    ("l_acc", "bin", "leg accuracy"),
    ("kd", "kd", "knockdowns per landed head strike"),
    ("td_att", "pm", "takedown attempts / min"),
    ("td_acc", "bin", "takedown accuracy"),
    ("ctrl", "pm", "control minutes / min"),
    ("sub_att", "pm", "submission attempts / min"),
    ("rev", "pm", "reversals / min"),
    ("ko_fin", "hz", "KO/TKO finish hazard / min"),
    ("sub_fin", "hz", "submission finish hazard / min"),
]
TN = [t[0] for t in TASKS]
TK = [t[1] for t in TASKS]
TI = {t: i for i, t in enumerate(TN)}
NT = len(TASKS)
IS_BIN = np.array([k == "bin" for k in TK])


# ------------------------------------------------------------------------------------------------ data
class Data:
    """All directed observations (2 per stat fight) and per-fight result rows, 2005-01-01 .. 2025-12-31."""


def load_data(verbose=True):
    t0 = time.time()
    log = {}
    fights, _ = B.parse_fights(log)
    people = B.build_people(fights, log)
    B.build_vectors(fights, log)
    fights = [f for f in fights if DATA_FROM <= f.date < HIDDEN_FROM and f.persons and f.persons[0] != f.persons[1]]
    assert all(f.date < HIDDEN_FROM for f in fights)
    persons = sorted({p for f in fights for p in f.persons})
    pidx = {p: i for i, p in enumerate(persons)}
    divs = sorted({f.division for f in fights})
    didx = {d: i for i, d in enumerate(divs)}

    D = Data()
    D.people, D.persons, D.pidx, D.divs, D.didx = people, persons, pidx, divs, didx
    D.slug = [people[p]["slug"] for p in persons]
    D.slug_idx = {s: i for i, s in enumerate(D.slug)}
    rows = []                      # directed rows
    frows = []                     # fight rows
    for f in fights:
        if not f.stats:
            continue
        a, b = pidx[f.persons[0]], pidx[f.persons[1]]
        m = float(f.stats["min"])
        if m <= 0:
            continue
        fi = len(frows)
        frows.append((f.fid, f.day, a, b, didx[f.division], 1.0 if f.sched == 5 else 0.0,
                      {"A": 1.0, "B": 0.0}.get(f.winner, np.nan), f))
        for s, (x, y) in enumerate(((a, b), (b, a))):
            v = f.stats["v"][s]
            won = f.winner == ("A" if s == 0 else "B")
            yv = np.zeros(NT)
            ev = np.zeros(NT)
            sig_att = v[KI["d_att"]] + v[KI["c_att"]] + v[KI["g_att"]]
            for t, kind, _ in TASKS:
                i = TI[t]
                if kind == "pm":
                    if t == "ns_att":
                        yv[i] = max(0.0, v[KI["t_att"]] - sig_att)
                    elif t == "ctrl":
                        yv[i] = v[KI["ctrl"]] / 60.0
                    else:
                        yv[i] = v[KI[t]]
                    ev[i] = m
                elif kind == "bin":
                    p = t.split("_")[0]
                    yv[i] = v[KI[p + "_lnd"]]
                    ev[i] = v[KI[p + "_att"]]
                elif kind == "kd":
                    yv[i] = v[KI["kd"]]
                    ev[i] = v[KI["h_lnd"]]
                elif kind == "hz":
                    yv[i] = 1.0 if (won and f.cat == ("ko" if t == "ko_fin" else "sub")) else 0.0
                    ev[i] = m
            yv = np.minimum(yv, np.where(IS_BIN, ev, np.inf))     # guard landed > attempted typos
            rows.append((fi, f.day, x, y, didx[f.division], 1.0 if f.sched == 5 else 0.0, yv, ev, s))
    D.r_fight = np.array([r[0] for r in rows])
    D.r_day = np.array([r[1] for r in rows])
    D.r_x = np.array([r[2] for r in rows])
    D.r_y = np.array([r[3] for r in rows])
    D.r_div = np.array([r[4] for r in rows])
    D.r_five = np.array([r[5] for r in rows])
    D.r_era = (D.r_day - dt.date(2015, 1, 1).toordinal()) / 3652.5
    D.Y = np.array([r[6] for r in rows])
    D.E = np.array([r[7] for r in rows])
    D.r_side = np.array([r[8] for r in rows])
    D.f_id = [r[0] for r in frows]
    D.f_day = np.array([r[1] for r in frows])
    D.f_a = np.array([r[2] for r in frows])
    D.f_b = np.array([r[3] for r in frows])
    D.f_div = np.array([r[4] for r in frows])
    D.f_five = np.array([r[5] for r in frows])
    D.f_win = np.array([r[6] for r in frows])
    D.f_obj = [r[7] for r in frows]
    D.fid_idx = {fid: i for i, fid in enumerate(D.f_id)}
    D.F, D.NDIV = len(persons), len(divs)
    # first stat-fight day per fighter (eligibility of a fight for evaluation: both had a prior stat fight)
    first = np.full(D.F, 10 ** 9)
    np.minimum.at(first, D.r_x, D.r_day)
    D.first_day = first
    if verbose:
        print("data: %d stat fights, %d directed rows, %d fighters, %d divisions (%.1fs); last fight %s"
              % (len(frows), len(rows), D.F, D.NDIV, time.time() - t0, dt.date.fromordinal(int(D.f_day.max()))))
    return D


# ------------------------------------------------------------------------------------------------ model
class Model:
    """Parameter layout and the MAP objective."""

    def __init__(self, F, NDIV, K):
        self.F, self.NDIV, self.K = F, NDIV, K
        shapes = [("A", (F, K)), ("D", (F, K)), ("W", (NT, K)), ("V", (NT, K)), ("mu", (NT, NDIV)),
                  ("be", (NT,)), ("g5", (NT,)), ("ua", (K,)), ("ud", (K,)), ("M", (K, K))]
        self.sl = {}
        o = 0
        for name, shp in shapes:
            n = int(np.prod(shp))
            self.sl[name] = (o, o + n, shp)
            o += n
        self.n = o

    def unpack(self, th):
        return {k: th[a:b].reshape(s) for k, (a, b, s) in self.sl.items()}

    def pack(self, P):
        th = np.zeros(self.n)
        for k, (a, b, s) in self.sl.items():
            th[a:b] = np.asarray(P[k]).ravel()
        return th


def eta_rows(P, x, y, div, era, five):
    return (P["mu"][:, div].T + np.outer(era, P["be"]) + np.outer(five, P["g5"])
            + P["A"][x] @ P["W"].T + P["D"][y] @ P["V"].T)


def win_logit(P, a, b):
    Aa, Ab, Da, Db = P["A"][a], P["A"][b], P["D"][a], P["D"][b]
    return ((Aa - Ab) @ P["ua"] + (Da - Db) @ P["ud"]
            + np.einsum("nk,kl,nl->n", Aa, P["M"], Db) - np.einsum("nk,kl,nl->n", Ab, P["M"], Da))


def task_mean(eta, E):
    """Expected count (Poisson tasks) or expected successes (binomial tasks)."""
    out = np.empty_like(eta)
    out[:, ~IS_BIN] = E[:, ~IS_BIN] * np.exp(np.clip(eta[:, ~IS_BIN], -30, 20))
    out[:, IS_BIN] = E[:, IS_BIN] / (1.0 + np.exp(-eta[:, IS_BIN]))
    return out


def deviance(Y, E, eta):
    """Unit deviance per row and task (Poisson / binomial); zero where the exposure is zero."""
    mu = task_mean(eta, E)
    dev = np.zeros_like(eta)
    with np.errstate(divide="ignore", invalid="ignore"):
        pz = ~IS_BIN
        yp, mp = Y[:, pz], mu[:, pz]
        dev[:, pz] = 2 * (np.where(yp > 0, yp * np.log(yp / mp), 0.0) - (yp - mp))
        yb, mb, nb = Y[:, IS_BIN], mu[:, IS_BIN], E[:, IS_BIN]
        t1 = np.where(yb > 0, yb * np.log(yb / mb), 0.0)
        t2 = np.where(nb - yb > 0, (nb - yb) * np.log((nb - yb) / np.maximum(nb - mb, 1e-12)), 0.0)
        dev[:, IS_BIN] = 2 * (t1 + t2)
    dev[E <= 0] = 0.0
    return dev


class Fit:
    """One MAP fit on the rows before date T, weighted by decay."""

    def __init__(self, D, T_day, hp, cw, warm=None, maxiter=3000, rows_from=None):
        self.D, self.T, self.hp = D, T_day, hp
        K = hp["K"]
        self.mod = Model(D.F, D.NDIV, K)
        lam_hl = math.log(2) / hp["hl"]
        rm = D.r_day < T_day
        if rows_from is not None:
            rm &= D.r_day >= rows_from
        self.ri = np.nonzero(rm)[0]
        self.w = np.exp(-lam_hl * (T_day - D.r_day[self.ri]))
        fm = (D.f_day < T_day) & ~np.isnan(D.f_win)
        self.fi = np.nonzero(fm)[0]
        self.fw = np.exp(-lam_hl * (T_day - D.f_day[self.fi])) * hp["win_w"]
        ri = self.ri
        self.x, self.y = D.r_x[ri], D.r_y[ri]
        self.div, self.era, self.five = D.r_div[ri], D.r_era[ri], D.r_five[ri]
        self.Yr, self.Er = D.Y[ri], D.E[ri]
        self.cw = cw                                     # per-task weight = 1 / dispersion
        n = len(ri)
        self.Sx = sparse.csr_matrix((np.ones(n), (self.x, np.arange(n))), shape=(D.F, n))
        self.Sy = sparse.csr_matrix((np.ones(n), (self.y, np.arange(n))), shape=(D.F, n))
        self.Sd = sparse.csr_matrix((np.ones(n), (self.div, np.arange(n))), shape=(D.NDIV, n))
        fa, fb = D.f_a[self.fi], D.f_b[self.fi]
        m = len(fa)
        self.fa, self.fb, self.fy = fa, fb, D.f_win[self.fi]
        self.Sa = sparse.csr_matrix((np.ones(m), (fa, np.arange(m))), shape=(D.F, m))
        self.Sb = sparse.csr_matrix((np.ones(m), (fb, np.arange(m))), shape=(D.F, m))
        # fighters that never appear before T keep their prior (zero) and are excluded from the optimisation
        self.active = np.zeros(D.F, bool)
        self.active[self.x] = True
        self.active[self.y] = True
        th0 = warm.copy() if warm is not None else self.init()
        self.theta = self.optimise(th0, maxiter)
        self.P = self.mod.unpack(self.theta)

    def init(self):
        rng = np.random.default_rng(SEED)
        P = {k: np.zeros(s) for k, (_, _, s) in self.mod.sl.items()}
        K = self.hp["K"]
        P["A"] = rng.normal(0, 0.05, (self.D.F, K))
        P["D"] = rng.normal(0, 0.05, (self.D.F, K))
        P["W"] = rng.normal(0, 0.05, (NT, K))
        P["V"] = rng.normal(0, 0.05, (NT, K))
        # intercepts at the weighted league rate of each task
        w = self.w[:, None]
        num = (w * self.Yr).sum(0)
        den = (w * self.Er).sum(0)
        r = num / np.maximum(den, 1e-9)
        base = np.where(IS_BIN, np.log(np.clip(r, 1e-6, 1 - 1e-6) / np.clip(1 - r, 1e-6, 1)),
                        np.log(np.maximum(r, 1e-6)))
        P["mu"] = np.repeat(base[:, None], self.D.NDIV, axis=1)
        return self.mod.pack(P)

    def objective(self, th):
        mod, hp = self.mod, self.hp
        P = mod.unpack(th)
        lam, lamw = hp["lam"], hp["lam"]
        AX = P["A"][self.x]
        DY = P["D"][self.y]
        eta = (P["mu"][:, self.div].T + np.outer(self.era, P["be"]) + np.outer(self.five, P["g5"])
               + AX @ P["W"].T + DY @ P["V"].T)
        E, Y = self.Er, self.Yr
        # losses
        G = np.empty_like(eta)
        L = 0.0
        pz = ~IS_BIN
        ep = np.exp(np.clip(eta[:, pz], -30, 20))
        lp = E[:, pz] * ep - Y[:, pz] * eta[:, pz]
        G[:, pz] = E[:, pz] * ep - Y[:, pz]
        eb = eta[:, IS_BIN]
        sp = np.logaddexp(0, eb)
        lb = E[:, IS_BIN] * sp - Y[:, IS_BIN] * eb
        G[:, IS_BIN] = E[:, IS_BIN] / (1 + np.exp(-eb)) - Y[:, IS_BIN]
        wc = self.w[:, None] * self.cw[None, :]
        L += (wc[:, pz] * lp).sum() + (wc[:, IS_BIN] * lb).sum()
        G *= wc
        g = {}
        g["W"] = G.T @ AX
        g["V"] = G.T @ DY
        g["A"] = self.Sx @ (G @ P["W"])
        g["D"] = self.Sy @ (G @ P["V"])
        g["mu"] = (self.Sd @ G).T
        g["be"] = G.T @ self.era
        g["g5"] = G.T @ self.five
        # win head
        Aa, Ab, Da, Db = P["A"][self.fa], P["A"][self.fb], P["D"][self.fa], P["D"][self.fb]
        MDb, MDa = Db @ P["M"].T, Da @ P["M"].T
        s = (Aa - Ab) @ P["ua"] + (Da - Db) @ P["ud"] + (Aa * MDb).sum(1) - (Ab * MDa).sum(1)
        L += (self.fw * (np.logaddexp(0, s) - self.fy * s)).sum()
        gs = self.fw * (1 / (1 + np.exp(-s)) - self.fy)
        g["ua"] = (Aa - Ab).T @ gs
        g["ud"] = (Da - Db).T @ gs
        g["M"] = (Aa * gs[:, None]).T @ Db - (Ab * gs[:, None]).T @ Da
        gA_a = gs[:, None] * (P["ua"][None, :] + MDb)
        gA_b = gs[:, None] * (-P["ua"][None, :] - MDa)
        MtAa, MtAb = Aa @ P["M"], Ab @ P["M"]
        gD_a = gs[:, None] * (P["ud"][None, :] - MtAb)
        gD_b = gs[:, None] * (-P["ud"][None, :] + MtAa)
        g["A"] = g["A"] + self.Sa @ gA_a + self.Sb @ gA_b
        g["D"] = g["D"] + self.Sa @ gD_a + self.Sb @ gD_b
        # priors
        L += 0.5 * lam * ((P["A"] ** 2).sum() + (P["D"] ** 2).sum())
        g["A"] = g["A"] + lam * P["A"]
        g["D"] = g["D"] + lam * P["D"]
        L += 0.5 * lamw * ((P["W"] ** 2).sum() + (P["V"] ** 2).sum())
        g["W"] = g["W"] + lamw * P["W"]
        g["V"] = g["V"] + lamw * P["V"]
        lh = hp.get("lam_head", 1.0)
        L += 0.5 * lh * ((P["ua"] ** 2).sum() + (P["ud"] ** 2).sum() + (P["M"] ** 2).sum())
        g["ua"] = g["ua"] + lh * P["ua"]
        g["ud"] = g["ud"] + lh * P["ud"]
        g["M"] = g["M"] + lh * P["M"]
        r = 1e-4
        L += 0.5 * r * ((P["mu"] ** 2).sum() + (P["be"] ** 2).sum() + (P["g5"] ** 2).sum())
        g["mu"] = g["mu"] + r * P["mu"]
        g["be"] = g["be"] + r * P["be"]
        g["g5"] = g["g5"] + r * P["g5"]
        inact = ~self.active
        g["A"][inact] = 0.0
        g["D"][inact] = 0.0
        return L, self.mod.pack(g)

    def optimise(self, th0, maxiter):
        res = minimize(self.objective, th0, jac=True, method="L-BFGS-B",
                       options={"maxiter": maxiter, "maxcor": 20, "ftol": 1e-10, "gtol": 1e-5})
        self.nit, self.nfev, self.fun = res.nit, res.nfev, res.fun
        return res.x
