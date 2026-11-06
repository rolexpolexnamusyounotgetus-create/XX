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


def _glm_terms(eta, Y, E, wc):
    """Loss, gradient wrt eta and Fisher weight per row and task, all already weighted by wc."""
    G = np.empty_like(eta)
    H = np.empty_like(eta)
    pz = ~IS_BIN
    ep = E[:, pz] * np.exp(np.clip(eta[:, pz], -30, 20))
    L = (wc[:, pz] * (ep - Y[:, pz] * eta[:, pz])).sum()
    G[:, pz] = ep - Y[:, pz]
    H[:, pz] = ep
    eb = eta[:, IS_BIN]
    sb = 1.0 / (1.0 + np.exp(-eb))
    L += (wc[:, IS_BIN] * (E[:, IS_BIN] * np.logaddexp(0, eb) - Y[:, IS_BIN] * eb)).sum()
    G[:, IS_BIN] = E[:, IS_BIN] * sb - Y[:, IS_BIN]
    H[:, IS_BIN] = E[:, IS_BIN] * sb * (1 - sb)
    return L, G * wc, H * wc


class Fit:
    """One MAP fit on the rows dated before T (ordinal day), decay-weighted, by alternating block Newton.

    Blocks: (1) every task's loadings W_t, V_t and intercepts (a weighted GLM per task given the fighters),
    (2) every fighter's [a_i, d_i] (a 2K x 2K Newton step per fighter; stat rows involve one fighter's offense
    and the other's defense, the win head adds Gauss-Newton cross terms), (3) the win head (logistic Newton).
    Each block step is backtracked on the full objective, so the MAP objective decreases monotonically."""

    def __init__(self, D, T_day, hp, cw, warm=None, max_sweeps=60, tol=1e-7, verbose=False):
        self.D, self.T, self.hp, self.cw = D, T_day, hp, cw
        self.K = K = hp["K"]
        lam_hl = math.log(2) / hp["hl"]
        ri = np.nonzero(D.r_day < T_day)[0]
        self.ri = ri
        self.w = np.exp(-lam_hl * (T_day - D.r_day[ri]))
        self.x, self.y = D.r_x[ri], D.r_y[ri]
        self.div, self.era, self.five = D.r_div[ri], D.r_era[ri], D.r_five[ri]
        self.Yr, self.Er = D.Y[ri], D.E[ri]
        self.wc = self.w[:, None] * cw[None, :]
        n = len(ri)
        F = D.F
        self.Sx = sparse.csr_matrix((np.ones(n), (self.x, np.arange(n))), shape=(F, n))
        self.Sy = sparse.csr_matrix((np.ones(n), (self.y, np.arange(n))), shape=(F, n))
        fi = np.nonzero((D.f_day < T_day) & ~np.isnan(D.f_win))[0]
        self.fw = np.exp(-lam_hl * (T_day - D.f_day[fi])) * hp["win_w"]
        self.fa, self.fb, self.fy = D.f_a[fi], D.f_b[fi], D.f_win[fi]
        m = len(fi)
        self.Sa = sparse.csr_matrix((np.ones(m), (self.fa, np.arange(m))), shape=(F, m))
        self.Sb = sparse.csr_matrix((np.ones(m), (self.fb, np.arange(m))), shape=(F, m))
        self.active = np.zeros(F, bool)
        self.active[self.x] = True
        self.active[self.y] = True
        # per-row context design for the intercept block
        self.Zc = np.zeros((n, D.NDIV + 2))
        self.Zc[np.arange(n), self.div] = 1.0
        self.Zc[:, D.NDIV] = self.era
        self.Zc[:, D.NDIV + 1] = self.five
        self.P = self.init() if warm is None else {k: v.copy() for k, v in warm.items()}
        if warm is not None and warm["A"].shape[1] != K:
            raise ValueError("warm start with a different K")
        self.history = []
        self.run(max_sweeps, tol, verbose)

    # ---------------------------------------------------------------- pieces
    def init(self):
        D, K = self.D, self.K
        rng = np.random.default_rng(SEED)
        P = {"A": rng.normal(0, 0.1, (D.F, K)), "D": rng.normal(0, 0.1, (D.F, K)),
             "W": rng.normal(0, 0.1, (NT, K)), "V": rng.normal(0, 0.1, (NT, K)),
             "C": np.zeros((NT, D.NDIV + 2)), "ua": np.zeros(K), "ud": np.zeros(K), "M": np.zeros((K, K))}
        num = (self.w[:, None] * self.Yr).sum(0)
        den = (self.w[:, None] * self.Er).sum(0)
        r = num / np.maximum(den, 1e-9)
        base = np.where(IS_BIN, np.log(np.clip(r, 1e-6, 1 - 1e-6) / np.clip(1 - r, 1e-6, 1)),
                        np.log(np.maximum(r, 1e-6)))
        P["C"][:, :D.NDIV] = base[:, None]
        return P

    def eta(self, P):
        return self.Zc @ P["C"].T + P["A"][self.x] @ P["W"].T + P["D"][self.y] @ P["V"].T

    def win_s(self, P):
        Aa, Ab, Da, Db = P["A"][self.fa], P["A"][self.fb], P["D"][self.fa], P["D"][self.fb]
        return ((Aa - Ab) @ P["ua"] + (Da - Db) @ P["ud"] + ((Aa @ P["M"]) * Db).sum(1)
                - ((Ab @ P["M"]) * Da).sum(1))

    def loss(self, P):
        lam, lh = self.hp["lam"], self.hp.get("lam_head", 1.0)
        L, _, _ = _glm_terms(self.eta(P), self.Yr, self.Er, self.wc)
        s = self.win_s(P)
        L += (self.fw * (np.logaddexp(0, s) - self.fy * s)).sum()
        L += 0.5 * lam * ((P["A"] ** 2).sum() + (P["D"] ** 2).sum() + (P["W"] ** 2).sum() + (P["V"] ** 2).sum())
        L += 0.5 * lh * ((P["ua"] ** 2).sum() + (P["ud"] ** 2).sum() + (P["M"] ** 2).sum())
        L += 0.5e-4 * (P["C"] ** 2).sum()
        return L

    def _accept(self, P, new, L0, keys):
        """Backtracking: take the step if it lowers the objective, else halve it (up to 6 times)."""
        step = 1.0
        for _ in range(7):
            trial = dict(P)
            for k in keys:
                trial[k] = P[k] + step * (new[k] - P[k])
            L1 = self.loss(trial)
            if L1 <= L0:
                return trial, L1
            step *= 0.5
        return P, L0

    def step_loadings(self, P, L0):
        lam, K, D = self.hp["lam"], self.K, self.D
        AX, DY = P["A"][self.x], P["D"][self.y]
        Z = np.hstack([AX, DY, self.Zc])
        _, G, H = _glm_terms(self.eta(P), self.Yr, self.Er, self.wc)
        p = Z.shape[1]
        reg = np.r_[np.full(2 * K, lam), np.full(D.NDIV + 2, 1e-4)]
        new = {"W": P["W"].copy(), "V": P["V"].copy(), "C": P["C"].copy()}
        for t in range(NT):
            th = np.r_[P["W"][t], P["V"][t], P["C"][t]]
            g = Z.T @ G[:, t] + reg * th
            Hm = (Z * H[:, t:t + 1]).T @ Z + np.diag(reg)
            try:
                d = np.linalg.solve(Hm, g)
            except np.linalg.LinAlgError:
                d = np.linalg.lstsq(Hm, g, rcond=None)[0]
            th = th - d
            new["W"][t], new["V"][t], new["C"][t] = th[:K], th[K:2 * K], th[2 * K:]
        return self._accept(P, new, L0, ("W", "V", "C"))

    def step_fighters(self, P, L0):
        lam, K, F = self.hp["lam"], self.K, self.D.F
        _, G, H = _glm_terms(self.eta(P), self.Yr, self.Er, self.wc)
        W, V = P["W"], P["V"]
        g = np.zeros((F, 2 * K))
        g[:, :K] = self.Sx @ (G @ W)
        g[:, K:] = self.Sy @ (G @ V)
        Hb = np.zeros((F, 2 * K, 2 * K))
        RA = np.einsum("nt,tk,tl->nkl", H, W, W, optimize=True).reshape(len(H), K * K)
        RD = np.einsum("nt,tk,tl->nkl", H, V, V, optimize=True).reshape(len(H), K * K)
        Hb[:, :K, :K] = (self.Sx @ RA).reshape(F, K, K)
        Hb[:, K:, K:] = (self.Sy @ RD).reshape(F, K, K)
        # win head (Gauss-Newton)
        Aa, Ab, Da, Db = P["A"][self.fa], P["A"][self.fb], P["D"][self.fa], P["D"][self.fb]
        M = P["M"]
        s = self.win_s(P)
        sg = 1 / (1 + np.exp(-s))
        gs = self.fw * (sg - self.fy)
        q = self.fw * sg * (1 - sg)
        ja = np.hstack([P["ua"][None, :] + Db @ M.T, P["ud"][None, :] - Ab @ M])
        jb = np.hstack([-P["ua"][None, :] - Da @ M.T, -P["ud"][None, :] + Aa @ M])
        g += self.Sa @ (gs[:, None] * ja) + self.Sb @ (gs[:, None] * jb)
        Oa = (q[:, None, None] * ja[:, :, None] * ja[:, None, :]).reshape(len(q), -1)
        Ob = (q[:, None, None] * jb[:, :, None] * jb[:, None, :]).reshape(len(q), -1)
        Hb += (self.Sa @ Oa + self.Sb @ Ob).reshape(F, 2 * K, 2 * K)
        X = np.hstack([P["A"], P["D"]])
        g += lam * X
        Hb += lam * np.eye(2 * K)[None]
        d = np.linalg.solve(Hb, g[:, :, None])[:, :, 0]
        d[~self.active] = 0.0
        Xn = X - d
        new = {"A": Xn[:, :K], "D": Xn[:, K:]}
        return self._accept(P, new, L0, ("A", "D"))

    def win_design(self, P):
        Aa, Ab, Da, Db = P["A"][self.fa], P["A"][self.fb], P["D"][self.fa], P["D"][self.fb]
        inter = (Aa[:, :, None] * Db[:, None, :] - Ab[:, :, None] * Da[:, None, :]).reshape(len(Aa), -1)
        return np.hstack([Aa - Ab, Da - Db, inter])

    def step_head(self, P, L0):
        K, lh = self.K, self.hp.get("lam_head", 1.0)
        Phi = self.win_design(P)
        th = np.r_[P["ua"], P["ud"], P["M"].ravel()]
        s = Phi @ th
        sg = 1 / (1 + np.exp(-s))
        g = Phi.T @ (self.fw * (sg - self.fy)) + lh * th
        Hm = (Phi * (self.fw * sg * (1 - sg))[:, None]).T @ Phi + lh * np.eye(len(th))
        th = th - np.linalg.solve(Hm, g)
        new = {"ua": th[:K], "ud": th[K:2 * K], "M": th[2 * K:].reshape(K, K)}
        return self._accept(P, new, L0, ("ua", "ud", "M"))

    def run(self, max_sweeps, tol, verbose):
        P = self.P
        L = self.loss(P)
        self.L_start = L
        t0 = time.time()
        for it in range(max_sweeps):
            Lprev = L
            P, L = self.step_loadings(P, L)
            P, L = self.step_fighters(P, L)
            P, L = self.step_head(P, L)
            self.history.append(L)
            if verbose:
                print("  sweep %d  L=%.4f  (%.1fs)" % (it, L, time.time() - t0))
            if Lprev - L < tol * abs(L):
                break
        self.P, self.L, self.sweeps = P, L, it + 1

    # ---------------------------------------------------------------- predictions
    def emb(self, idx):
        return np.hstack([self.P["A"][idx], self.P["D"][idx]])
