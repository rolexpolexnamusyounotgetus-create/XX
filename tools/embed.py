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
    os.environ.setdefault(_v, "1")

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
    all_fights = [f for f in fights if f.date < HIDDEN_FROM]          # hidden-data protocol
    fights = [f for f in all_fights if DATA_FROM <= f.date and f.persons and f.persons[0] != f.persons[1]]
    assert all(f.date < HIDDEN_FROM for f in fights)
    persons = sorted({p for f in fights for p in f.persons})
    pidx = {p: i for i, p in enumerate(persons)}
    divs = sorted({f.division for f in fights})
    didx = {d: i for i, d in enumerate(divs)}

    D = Data()
    D.all_fights = all_fights
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


IS_NB = np.array([k in ("pm", "kd") for k in TK])          # negative binomial counts
IS_PO = np.array([k == "hz" for k in TK])                  # Poisson (finish hazards)


def _glm_terms(eta, Y, E, wc, knb):
    """Loss, gradient wrt eta and Fisher weight per row and task, already multiplied by the row weights wc.

    NB2 counts: mean mu = E exp(eta), shape k (var = mu + mu^2 / k); binomial proportions (wc carries the
    beta-binomial row weight 1 / (1 + (n - 1) rho)); Poisson hazards."""
    G = np.zeros_like(eta)
    H = np.zeros_like(eta)
    L = 0.0
    # negative binomial
    e = eta[:, IS_NB]
    Ee, Ye, k = E[:, IS_NB], Y[:, IS_NB], knb[None, IS_NB]
    mu = Ee * np.exp(np.clip(e, -30, 20))
    ok = Ee > 0
    lmk = np.log(mu + k)
    L += (wc[:, IS_NB] * np.where(ok, (Ye + k) * lmk - Ye * e, 0.0)).sum()
    G[:, IS_NB] = np.where(ok, k * (mu - Ye) / (mu + k), 0.0)
    H[:, IS_NB] = np.where(ok, k * mu / (mu + k), 0.0)
    # Poisson
    e = eta[:, IS_PO]
    mu = E[:, IS_PO] * np.exp(np.clip(e, -30, 20))
    L += (wc[:, IS_PO] * (mu - Y[:, IS_PO] * e)).sum()
    G[:, IS_PO] = mu - Y[:, IS_PO]
    H[:, IS_PO] = mu
    # binomial
    eb = eta[:, IS_BIN]
    sb = 1.0 / (1.0 + np.exp(-eb))
    L += (wc[:, IS_BIN] * (E[:, IS_BIN] * np.logaddexp(0, eb) - Y[:, IS_BIN] * eb)).sum()
    G[:, IS_BIN] = E[:, IS_BIN] * sb - Y[:, IS_BIN]
    H[:, IS_BIN] = E[:, IS_BIN] * sb * (1 - sb)
    return L, G * wc, H * wc


def noise_weights(D, idx, noise):
    """Row x task weights: the beta-binomial factor for proportions, 1 elsewhere."""
    w = np.ones((len(idx), NT))
    n = D.E[idx][:, IS_BIN]
    w[:, IS_BIN] = 1.0 / (1.0 + np.maximum(n - 1, 0) * noise["rho"][None, IS_BIN])
    return w


class Fit:
    """One MAP fit on the rows dated before T (ordinal day), decay-weighted, by alternating block Newton.

    Blocks: (1) every task's loadings W_t, V_t and intercepts (a weighted GLM per task given the fighters),
    (2) every fighter's [a_i, d_i] (a 2K x 2K Newton step per fighter; stat rows involve one fighter's offense
    and the other's defense, the win head adds Gauss-Newton cross terms), (3) the win head (logistic Newton).
    Each block step is backtracked on the full objective, so the MAP objective decreases monotonically."""

    def __init__(self, D, T_day, hp, noise, warm=None, max_sweeps=40, tol=2e-6, verbose=False):
        self.D, self.T, self.hp, self.noise = D, T_day, hp, noise
        self.knb = noise["k"]
        self.K = K = hp["K"]
        lam_hl = math.log(2) / hp["hl"]
        win = hp.get("window", 4.0) * hp["hl"]          # rows older than `window` half-lives weigh < 1/16
        ri = np.nonzero((D.r_day < T_day) & (D.r_day >= T_day - win))[0]
        self.ri = ri
        self.w = np.exp(-lam_hl * (T_day - D.r_day[ri]))
        self.x, self.y = D.r_x[ri], D.r_y[ri]
        self.div, self.era, self.five = D.r_div[ri], D.r_era[ri], D.r_five[ri]
        self.Yr, self.Er = D.Y[ri], D.E[ri]
        self.wc = self.w[:, None] * noise_weights(D, ri, noise)
        n = len(ri)
        F = D.F
        self.Sx = sparse.csr_matrix((np.ones(n), (self.x, np.arange(n))), shape=(F, n))
        self.Sy = sparse.csr_matrix((np.ones(n), (self.y, np.arange(n))), shape=(F, n))
        fi = np.nonzero((D.f_day < T_day) & (D.f_day >= T_day - win) & ~np.isnan(D.f_win))[0]
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
        self._cP, self._ceta, self._parts = None, None, (None, None)
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
        if self._cP is P:
            return self._ceta
        e = self.Zc @ P["C"].T + P["A"][self.x] @ P["W"].T + P["D"][self.y] @ P["V"].T
        self._cP, self._ceta = P, e
        return e

    def win_s(self, P):
        Aa, Ab, Da, Db = P["A"][self.fa], P["A"][self.fb], P["D"][self.fa], P["D"][self.fb]
        return ((Aa - Ab) @ P["ua"] + (Da - Db) @ P["ud"] + ((Aa @ P["M"]) * Db).sum(1)
                - ((Ab @ P["M"]) * Da).sum(1))

    def loss_stat(self, P):
        return _glm_terms(self.eta(P), self.Yr, self.Er, self.wc, self.knb)[0]

    def loss_win(self, P):
        s = self.win_s(P)
        return (self.fw * (np.logaddexp(0, s) - self.fy * s)).sum()

    def prior(self, P):
        lam, lh = self.hp["lam"], self.hp.get("lam_head", 1.0)
        ld = lam * self.hp.get("lam_d", 1.0)
        return (0.5 * lam * ((P["A"] ** 2).sum() + (P["W"] ** 2).sum())
                + 0.5 * ld * ((P["D"] ** 2).sum() + (P["V"] ** 2).sum())
                + 0.5 * lh * ((P["ua"] ** 2).sum() + (P["ud"] ** 2).sum() + (P["M"] ** 2).sum())
                + 0.5e-4 * (P["C"] ** 2).sum())

    def loss(self, P, parts=None):
        """Full objective. parts = (stat, win) already known for P's unchanged components (None = compute)."""
        ls = self.loss_stat(P) if parts is None or parts[0] is None else parts[0]
        lw = self.loss_win(P) if parts is None or parts[1] is None else parts[1]
        self._parts = (ls, lw)
        return ls + lw + self.prior(P)

    def _accept(self, P, new, L0, keys, stat_same=False, win_same=False):
        """Backtracking: take the step if it lowers the objective, else halve it (up to 6 times)."""
        step = 1.0
        parts0 = self._parts
        for _ in range(7):
            trial = dict(P)
            for k in keys:
                trial[k] = P[k] + step * (new[k] - P[k])
            L1 = self.loss(trial, (parts0[0] if stat_same else None, parts0[1] if win_same else None))
            if L1 <= L0:
                return trial, L1
            step *= 0.5
        self._parts = parts0
        return P, L0

    def step_loadings(self, P, L0):
        lam, K, D = self.hp["lam"], self.K, self.D
        AX, DY = P["A"][self.x], P["D"][self.y]
        Z = np.hstack([AX, DY, self.Zc])
        _, G, H = _glm_terms(self.eta(P), self.Yr, self.Er, self.wc, self.knb)
        p = Z.shape[1]
        ld = lam * self.hp.get("lam_d", 1.0)
        reg = np.r_[np.full(K, lam), np.full(K, ld), np.full(D.NDIV + 2, 1e-4)]
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
        return self._accept(P, new, L0, ("W", "V", "C"), win_same=True)

    def step_fighters(self, P, L0):
        lam, K, F = self.hp["lam"], self.K, self.D.F
        _, G, H = _glm_terms(self.eta(P), self.Yr, self.Er, self.wc, self.knb)
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
        regv = np.r_[np.full(K, lam), np.full(K, lam * self.hp.get("lam_d", 1.0))]
        g += regv * X
        Hb += np.diag(regv)[None]
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
        return self._accept(P, new, L0, ("ua", "ud", "M"), stat_same=True)

    @staticmethod
    def _balance_mat(Ga, Gw):
        """S minimising tr(S'GaS) + tr(S^-1 Gw S^-1) (symmetric S): the L2-balanced factor scaling."""
        k = len(Ga)
        ea, Ua = np.linalg.eigh(Ga + 1e-9 * np.eye(k))
        ea = np.maximum(ea, 1e-9)
        Gh = (Ua * np.sqrt(ea)) @ Ua.T
        Gih = (Ua / np.sqrt(ea)) @ Ua.T
        em, Um = np.linalg.eigh(Gh @ Gw @ Gh)
        mid = (Um * np.sqrt(np.maximum(em, 1e-12))) @ Um.T
        X = Gih @ mid @ Gih
        ex, Ux = np.linalg.eigh((X + X.T) / 2)
        ex = np.maximum(ex, 1e-12)
        return (Ux * np.sqrt(ex)) @ Ux.T, (Ux / np.sqrt(ex)) @ Ux.T

    def rebalance(self, P, L0):
        """Rescale (A, W) and (D, V) to the L2-balanced point; predictions are unchanged, the prior shrinks."""
        S, Si = self._balance_mat(P["A"].T @ P["A"], P["W"].T @ P["W"])
        Q, Qi = self._balance_mat(P["D"].T @ P["D"], P["V"].T @ P["V"])
        new = dict(P)
        new["A"], new["W"] = P["A"] @ S, P["W"] @ Si
        new["D"], new["V"] = P["D"] @ Q, P["V"] @ Qi
        new["ua"], new["ud"] = Si @ P["ua"], Qi @ P["ud"]
        new["M"] = Si @ P["M"] @ Qi
        L1 = self.loss(new, self._parts)        # predictions unchanged: only the prior moves
        if L1 < L0:
            self._cP = new                         # same linear predictors as P (up to rounding)
            return new, L1
        return P, L0

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
            P, L = self.rebalance(P, L)
            self.history.append(L)
            if verbose:
                print("  sweep %d  L=%.4f  (%.1fs)" % (it, L, time.time() - t0))
            if Lprev - L < tol * abs(L):
                break
        self.P, self.L, self.sweeps = P, L, it + 1

    # ---------------------------------------------------------------- predictions
    def emb(self, idx):
        return np.hstack([self.P["A"][idx], self.P["D"][idx]])


# ------------------------------------------------------------------------------------------------ helpers
def ctx_design(D, idx):
    Z = np.zeros((len(idx), D.NDIV + 2))
    Z[np.arange(len(idx)), D.r_div[idx]] = 1.0
    Z[:, D.NDIV] = D.r_era[idx]
    Z[:, D.NDIV + 1] = D.r_five[idx]
    return Z


def predict_rows(P, D, idx, ex=None, ey=None):
    """Linear predictors for directed rows idx; ex / ey override the (offense, defense) embeddings used."""
    K = P["A"].shape[1]
    ax = P["A"][D.r_x[idx]] if ex is None else ex[:, :K]
    dy = P["D"][D.r_y[idx]] if ey is None else ey[:, K:]
    return ctx_design(D, idx) @ P["C"].T + ax @ P["W"].T + dy @ P["V"].T


def win_logit_emb(P, ea, eb):
    K = P["A"].shape[1]
    Aa, Da, Ab, Db = ea[:, :K], ea[:, K:], eb[:, :K], eb[:, K:]
    return ((Aa - Ab) @ P["ua"] + (Da - Db) @ P["ud"] + ((Aa @ P["M"]) * Db).sum(1) - ((Ab @ P["M"]) * Da).sum(1))


def estimate_noise(D, P, idx):
    """Moment estimates of NB shape k (counts) and beta-binomial rho (proportions) from rows idx predicted
    by parameters P (held-out rows, so the estimate includes fight-to-fight form, not just sampling)."""
    eta = predict_rows(P, D, idx)
    Y, E = D.Y[idx], D.E[idx]
    mu = task_mean(eta, E)
    k = np.full(NT, np.inf)
    rho = np.zeros(NT)
    for t in range(NT):
        ok = E[:, t] > 0
        y, m, n = Y[ok, t], mu[ok, t], E[ok, t]
        if IS_BIN[t]:
            p = m / n
            v = n * p * (1 - p)
            rho[t] = max(1e-4, ((y - m) ** 2 - v).sum() / max((v * (n - 1)).sum(), 1e-9))
        elif IS_NB[t]:
            ex = ((y - m) ** 2 - m).sum()
            k[t] = (m ** 2).sum() / ex if ex > 0 else 1e3
            k[t] = float(np.clip(k[t], 0.3, 1e3))
    return {"k": k, "rho": rho}


def heldout_rows(D, T0, T1):
    """Directed rows / fights dated in [T0, T1) whose two fighters both had a stat fight before T0."""
    m = (D.r_day >= T0) & (D.r_day < T1) & (D.first_day[D.r_x] < T0) & (D.first_day[D.r_y] < T0)
    fm = ((D.f_day >= T0) & (D.f_day < T1) & (D.first_day[D.f_a] < T0) & (D.first_day[D.f_b] < T0)
          & ~np.isnan(D.f_win))
    return np.nonzero(m)[0], np.nonzero(fm)[0]


def eval_block(D, P, idx, fidx):
    eta = predict_rows(P, D, idx)
    dev = deviance(D.Y[idx], D.E[idx], eta).sum(0)
    ea = np.hstack([P["A"][D.f_a[fidx]], P["D"][D.f_a[fidx]]])
    eb = np.hstack([P["A"][D.f_b[fidx]], P["D"][D.f_b[fidx]]])
    s = win_logit_emb(P, ea, eb)
    y = D.f_win[fidx]
    return dev, (np.logaddexp(0, s) - y * s), s


# ------------------------------------------------------------------------------------------------ walk-forward
def procrustes(Xn, Xp, w):
    """Orthogonal R minimising sum_i w_i |Xn_i R - Xp_i|^2."""
    U, _, Vt = np.linalg.svd((Xn * w[:, None]).T @ Xp)
    return U @ Vt


def align(P, Pref, w):
    """Rotate P's offense and defense spaces onto Pref's (an equivalent solution: same predictions, same prior)."""
    if Pref is None:
        return P
    RA = procrustes(P["A"], Pref["A"], w)
    RD = procrustes(P["D"], Pref["D"], w)
    Q = dict(P)
    Q["A"], Q["W"], Q["ua"] = P["A"] @ RA, P["W"] @ RA, RA.T @ P["ua"]
    Q["D"], Q["V"], Q["ud"] = P["D"] @ RD, P["V"] @ RD, RD.T @ P["ud"]
    Q["M"] = RA.T @ P["M"] @ RD
    return Q


def exposure(D, T_day, hl):
    """Decay-weighted fight count per fighter as of T (alignment weights, confidence)."""
    w = np.exp(-math.log(2) / hl * (T_day - D.r_day))
    w[D.r_day >= T_day] = 0.0
    return np.bincount(D.r_x, weights=w, minlength=D.F)


def refit_dates(start, end, every):
    """Refit days from start (inclusive) to end (exclusive): 'month', 'quarter', 'half' or 'year'."""
    step = {"month": 1, "quarter": 3, "half": 6, "year": 12}[every]
    out = []
    y, m = start.year, start.month
    while dt.date(y, m, 1) < end:
        out.append(dt.date(y, m, 1).toordinal())
        m += step
        while m > 12:
            m -= 12
            y += 1
    return out


def walk_forward(D, hp, noise, dates, until_day, keep=False, sweeps_cold=30, sweeps_warm=10, tol=1e-6,
                 baseline=None, verbose=True, log_prefix=""):
    """Refit at each date (warm-started, aligned to the previous refit); score the rows of each block.

    Returns per-task deviance totals, the matching intercept-only totals (from `baseline`, a dict keyed by
    block start), the win log-loss terms, and (keep=True) the aligned parameters of every refit."""
    P_prev = None
    dev_tot = np.zeros(NT)
    base_tot = np.zeros(NT)
    win_ll, win_s, win_f = [], [], []
    fits = []
    t0 = time.time()
    for j, T in enumerate(dates):
        T1 = dates[j + 1] if j + 1 < len(dates) else until_day
        f = Fit(D, T, hp, noise, warm=P_prev, max_sweeps=sweeps_cold if P_prev is None else sweeps_warm, tol=tol)
        P = align(f.P, P_prev, exposure(D, T, hp["hl"])) if P_prev is not None else f.P
        P_prev = P
        if keep:
            fits.append({"T": T, "A": P["A"].copy(), "D": P["D"].copy(), "P": {k: v.copy() for k, v in P.items()
                                                                              if k not in ("A", "D")},
                         "sweeps": f.sweeps})
        if T1 > T:
            idx, fidx = heldout_rows(D, T, T1)
            if len(idx):
                dev, ll, s = eval_block(D, P, idx, fidx)
                dev_tot += dev
                if baseline is not None:
                    base_tot += baseline[T]
                win_ll.extend(ll.tolist())
                win_s.extend(s.tolist())
                win_f.extend(fidx.tolist())
        if verbose:
            print("%s refit %s: %d sweeps, %.0fs elapsed" % (log_prefix, dt.date.fromordinal(T), f.sweeps,
                                                             time.time() - t0), flush=True)
    return {"dev": dev_tot, "base": base_tot, "win_ll": np.array(win_ll), "win_s": np.array(win_s),
            "win_f": np.array(win_f, dtype=int), "fits": fits}


def baseline_dev(D, noise, dates, until_day, hl=730.0):
    """Intercept-only (division x era x 5-round) deviance per block: the yardstick for relative deviance."""
    out = {}
    P_prev = None
    for j, T in enumerate(dates):
        T1 = dates[j + 1] if j + 1 < len(dates) else until_day
        f = Fit(D, T, {"K": 1, "lam": 1e8, "hl": hl, "win_w": 0.0, "lam_head": 1e8}, noise, warm=P_prev,
                max_sweeps=8)
        P_prev = f.P
        idx, fidx = heldout_rows(D, T, T1)
        out[T] = deviance(D.Y[idx], D.E[idx], predict_rows(f.P, D, idx)).sum(0) if len(idx) else np.zeros(NT)
    return out


# ------------------------------------------------------------------------------------------------ stat predictions
STATS = ["sig_att", "sig_lnd", "h_lnd", "b_lnd", "l_lnd", "kd", "td_att", "td_lnd", "ctrl", "sub_att"]


def sig(x):
    return 1.0 / (1.0 + np.exp(-x))


def stat_rates(eta):
    """Per-minute expected stat line of the attacker from the task linear predictors (rows x NT).
    ctrl in seconds per minute; kd per minute via head landed x knockdowns per landed head strike."""
    e = lambda t: np.exp(eta[:, TI[t]])
    p = lambda t: sig(eta[:, TI[t]])
    out = {}
    out["sig_att"] = e("d_att") + e("c_att") + e("g_att")
    out["sig_lnd"] = e("d_att") * p("d_acc") + e("c_att") * p("c_acc") + e("g_att") * p("g_acc")
    out["h_lnd"] = e("h_att") * p("h_acc")
    out["b_lnd"] = e("b_att") * p("b_acc")
    out["l_lnd"] = e("l_att") * p("l_acc")
    out["kd"] = out["h_lnd"] * e("kd")
    out["td_att"] = e("td_att")
    out["td_lnd"] = e("td_att") * p("td_acc")
    out["ctrl"] = 60.0 * e("ctrl")
    out["sub_att"] = e("sub_att")
    out["ko_haz"] = e("ko_fin")
    out["sub_haz"] = e("sub_fin")
    return out


def eta_pair(P, divs, era, five, ex, ey):
    """Linear predictors for attacker embeddings ex against defender embeddings ey (rows x 2K each)."""
    K = P["A"].shape[1]
    NDIV = P["C"].shape[1] - 2
    Z = np.zeros((len(ex), NDIV + 2))
    Z[np.arange(len(ex)), divs] = 1.0
    Z[:, NDIV] = era
    Z[:, NDIV + 1] = five
    return Z @ P["C"].T + ex[:, :K] @ P["W"].T + ey[:, K:] @ P["V"].T


# ------------------------------------------------------------------------------------------------ snapshots 2010+
SNAP_FROM = dt.date(2010, 1, 1)


def snapshot_table(D, verbose=True):
    """Walk-forward pre-fight snapshots (build_db.walk) for every eligible fight 2010-01-01..2025-12-31, the
    same construction as backtest_dev.json (which starts in 2019), plus priors_asof for 2010..2025."""
    t0 = time.time()
    elo = json.load(open(os.path.join(DER, "elo_report.json")))["chosen"]
    fights = D.all_fights
    _, pre, _ = B.run_elo(fights, elo["K"], elo["boost"], store=True)
    old = B.BACKTEST_FROM
    B.BACKTEST_FROM = SNAP_FROM
    try:
        _, entries = B.walk(fights, D.people, pre, 730.0)
    finally:
        B.BACKTEST_FROM = old
    priors = {str(y): B.build_priors(fights, dt.date(y - 5, 1, 1), dt.date(y, 1, 1)) for y in range(2010, 2026)}
    entries = [e for e in entries if e["date"] < HIDDEN_FROM.isoformat()]
    if verbose:
        print("snapshots: %d entries %s..%s (%.0fs)" % (len(entries), entries[0]["date"], entries[-1]["date"],
                                                       time.time() - t0))
    return entries, priors


K_MIN, K_ATT, K_TD, K_HEAD, K_FIGHT = 20.0, 60.0, 8.0, 250.0, 3.0


def side_feats(sd, pri):
    """Baseline per-side features from the frozen decayed sums S, shrunk toward the division prior."""
    S = dict(zip(B.KEYS, sd["S"]))
    m = S["min"]
    r = lambda k: (S[k] + K_MIN * pri[k]) / (m + K_MIN)
    def acc(lnd, att, pk, k=K_ATT):
        return (S[lnd] + k * pk) / (S[att] + k)
    sl = lambda: S["d_lnd"] + S["c_lnd"] + S["g_lnd"]
    sa = lambda: S["d_att"] + S["c_att"] + S["g_att"]
    osl = S["od_lnd"] + S["oc_lnd"] + S["og_lnd"]
    osa = S["od_att"] + S["oc_att"] + S["og_att"]
    p_sl = pri["d_lnd"] + pri["c_lnd"] + pri["g_lnd"]
    p_sa = pri["d_att"] + pri["c_att"] + pri["g_att"]
    f = {}
    f["slpm"] = (sl() + K_MIN * p_sl) / (m + K_MIN)
    f["sapm"] = (osl + K_MIN * p_sl) / (m + K_MIN)
    f["satt"] = (sa() + K_MIN * p_sa) / (m + K_MIN)
    f["osatt"] = (osa + K_MIN * p_sa) / (m + K_MIN)
    f["acc"] = (sl() + K_ATT * pri["acc_sig"]) / (sa() + K_ATT)
    f["oacc"] = (osl + K_ATT * pri["acc_sig"]) / (osa + K_ATT)
    for z in ("h", "b", "l", "d", "c", "g"):
        f[z + "_lpm"] = r(z + "_lnd")
        f["o" + z + "_lpm"] = r("o" + z + "_lnd")
        f[z + "_apm"] = r(z + "_att")
        f["o" + z + "_apm"] = r("o" + z + "_att")
    f["td_apm"] = r("td_att")
    f["otd_apm"] = r("otd_att")
    f["td_acc"] = acc("td_lnd", "td_att", pri["td_acc"], K_TD)
    f["otd_acc"] = acc("otd_lnd", "otd_att", pri["td_acc"], K_TD)
    f["td_lpm"] = r("td_lnd")
    f["otd_lpm"] = r("otd_lnd")
    f["ctrl"] = r("ctrl")
    f["octrl"] = r("octrl")
    f["sub"] = r("sub_att")
    f["osub"] = r("osub_att")
    f["pow"] = (S["kd"] + K_HEAD * pri["kd_per_h"]) / (S["h_lnd"] + K_HEAD)
    f["chin"] = (S["okd"] + K_HEAD * pri["kd_per_h"]) / (S["oh_lnd"] + K_HEAD)
    n = S["n"]
    wins = S["ko_w"] + S["sub_w"] + S["dec_w"]
    losses = S["ko_l"] + S["sub_l"] + S["dec_l"]
    f["winr"] = (wins + K_FIGHT * 0.5) / (wins + losses + K_FIGHT)
    f["kow"] = (S["ko_w"] + 0.15 * K_FIGHT) / (n + K_FIGHT)
    f["kol"] = (S["ko_l"] + 0.15 * K_FIGHT) / (n + K_FIGHT)
    f["subw"] = (S["sub_w"] + 0.08 * K_FIGHT) / (n + K_FIGHT)
    f["subl"] = (S["sub_l"] + 0.08 * K_FIGHT) / (n + K_FIGHT)
    f["mins_s"] = math.log1p(m)
    f["elo"] = sd["elo"] / 100.0
    f["age"] = sd["age"] if sd.get("age") is not None else np.nan
    f["reach"] = sd["reach_in"] if sd.get("reach_in") else np.nan
    f["height"] = sd["height_in"] if sd.get("height_in") else np.nan
    f["n_ufc"] = math.log1p(sd["n"])
    f["ko_losses"] = sd["ko_losses"]
    return f


BASE_FEATS = None


def prior_for(priors, e):
    py = priors[e["date"][:4]]
    g = e.get("prior_division") or e["division"]
    return py.get(g) or py["ALL"]


def emb_lookup(fits, D):
    """day, slug -> embedding (2K) of the latest refit dated on or before day, and its exposure."""
    Ts = np.array([f["T"] for f in fits])
    def get(day, slug):
        j = int(np.searchsorted(Ts, day, side="right")) - 1
        if j < 0:
            return None
        i = D.slug_idx.get(slug)
        fit = fits[j]
        if i is None:
            return np.zeros(2 * fit["A"].shape[1]), fit, 0.0
        return np.r_[fit["A"][i], fit["D"][i]], fit, fit["expo"][i]
    return get


def build_table(entries, priors, fits, D):
    """One row per snapshot fight: baseline features per side, embeddings, embedding-model outputs, outcomes."""
    get = emb_lookup(fits, D)
    rows = []
    for e in entries:
        day = dt.date.fromisoformat(e["date"]).toordinal()
        ga, gb = get(day, e["A"]["slug"]), get(day, e["B"]["slug"])
        if ga is None or gb is None:
            continue
        pri = prior_for(priors, e)
        div = D.didx.get(e["division"], D.didx.get(e.get("prior_division"), D.didx["Lightweight"]))
        rows.append((e, day, div, pri, side_feats(e["A"], pri), side_feats(e["B"], pri), ga, gb))
    T = {}
    T["entries"] = [r[0] for r in rows]
    T["id"] = [r[0]["id"] for r in rows]
    T["day"] = np.array([r[1] for r in rows])
    T["year"] = np.array([int(r[0]["date"][:4]) for r in rows])
    T["div"] = np.array([r[2] for r in rows])
    T["five"] = np.array([1.0 if r[0]["rounds"] == 5 else 0.0 for r in rows])
    T["title"] = np.array([1.0 if r[0].get("title") else 0.0 for r in rows])
    T["women"] = np.array([1.0 if "Women" in (r[0].get("prior_division") or r[0]["division"]) else 0.0 for r in rows])
    T["era"] = (T["day"] - dt.date(2015, 1, 1).toordinal()) / 3652.5
    names = sorted(rows[0][4])
    T["fnames"] = names
    T["FA"] = np.array([[r[4][k] for k in names] for r in rows], dtype=float)
    T["FB"] = np.array([[r[5][k] for k in names] for r in rows], dtype=float)
    T["prior"] = [r[3] for r in rows]
    T["EA"] = np.array([r[6][0] for r in rows])
    T["EB"] = np.array([r[7][0] for r in rows])
    T["XA"] = np.array([r[6][2] for r in rows])
    T["XB"] = np.array([r[7][2] for r in rows])
    # embedding-model outputs with the parameters of each fight's refit
    n = len(rows)
    T["s_win"] = np.zeros(n)
    T["eta_ab"] = np.zeros((n, NT))
    T["eta_ba"] = np.zeros((n, NT))
    fit_of = np.array([id(r[6][1]) for r in rows])
    for fid_ in np.unique(fit_of):
        ii = np.nonzero(fit_of == fid_)[0]
        P = rows[ii[0]][6][1]["P"]
        Pf = dict(P)
        Pf["A"] = np.zeros((1, P["W"].shape[1]))
        ea, eb = T["EA"][ii], T["EB"][ii]
        T["s_win"][ii] = win_logit_emb(Pf, ea, eb)
        T["eta_ab"][ii] = eta_pair(Pf, T["div"][ii], T["era"][ii], T["five"][ii], ea, eb)
        T["eta_ba"][ii] = eta_pair(Pf, T["div"][ii], T["era"][ii], T["five"][ii], eb, ea)
    T["winner"] = np.array([{"A": 1.0, "B": 0.0}.get(r[0]["result"]["winner"], np.nan) for r in rows])
    # actual stat lines
    act = []
    for r in rows:
        a = r[0].get("actual")
        if not a or not a.get("minutes"):
            act.append(None)
            continue
        act.append(a)
    T["actual"] = act
    return T


def boot_ci(delta, n_boot=2000, seed=SEED):
    """Mean and 95% paired-bootstrap interval of per-fight deltas."""
    rng = np.random.default_rng(seed)
    d = np.asarray(delta)
    bs = d[rng.integers(0, len(d), (n_boot, len(d)))].mean(1)
    return float(d.mean()), float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5))


def logloss(p, y):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


def calib_table(p, y, nb=10):
    """Symmetric reliability table: every fight in both orientations, deciles of predicted probability."""
    pp = np.r_[p, 1 - p]
    yy = np.r_[y, 1 - y]
    edges = np.quantile(pp, np.linspace(0, 1, nb + 1))
    out = []
    for i in range(nb):
        m = (pp >= edges[i]) & (pp <= edges[i + 1] if i == nb - 1 else pp < edges[i + 1])
        if m.sum():
            out.append({"p": round(float(pp[m].mean()), 4), "obs": round(float(yy[m].mean()), 4), "n": int(m.sum())})
    ece = sum(abs(r["p"] - r["obs"]) * r["n"] for r in out) / max(1, sum(r["n"] for r in out))
    return out, round(ece, 4)


# ------------------------------------------------------------------------------------------------ downstream: winner
def winner_features(T, kind):
    """Antisymmetric (A minus B) feature matrix for the winner models. kind: 'base' or 'emb' (base + embedding)."""
    X = T["FA"] - T["FB"]
    names = ["d_" + k for k in T["fnames"]]
    if kind == "emb":
        ra = stat_rates(T["eta_ab"])
        rb = stat_rates(T["eta_ba"])
        extra = [T["EA"] - T["EB"], T["s_win"][:, None]]
        en = ["emb_o%d" % k for k in range(T["EA"].shape[1] // 2)] + ["emb_d%d" % k for k in range(T["EA"].shape[1] // 2)]
        names = names + ["demb_" + x for x in en] + ["emb_win_logit"]
        for k in ("sig_lnd", "sig_att", "td_lnd", "ctrl", "kd", "ko_haz", "sub_haz", "sub_att"):
            extra.append((np.log(ra[k] + 1e-6) - np.log(rb[k] + 1e-6))[:, None])
            names.append("emb_pred_%s_logdiff" % k)
        X = np.hstack([X] + extra)
    return X, names


def _lgb():
    import lightgbm as lgb
    return lgb


def fit_lr(X, y, C):
    from sklearn.linear_model import LogisticRegression
    Xm = np.vstack([X, -X])
    ym = np.r_[y, 1 - y]
    sd = Xm.std(0) + 1e-9
    m = LogisticRegression(C=C, fit_intercept=False, max_iter=2000)
    m.fit(Xm / sd, ym)
    return lambda Z: m.predict_proba(np.nan_to_num(Z) / sd)[:, 1] if False else 1 / (1 + np.exp(-(np.nan_to_num(Z) / sd) @ m.coef_[0])), (m.coef_[0] / sd)


GBM_PARAMS = {"objective": "binary", "learning_rate": 0.03, "num_leaves": 7, "min_data_in_leaf": 60,
              "feature_fraction": 0.7, "bagging_fraction": 0.8, "bagging_freq": 1, "lambda_l2": 5.0,
              "verbose": -1, "num_threads": 1, "seed": SEED}


def fit_gbm_winner(X, y, ctx, n_iter):
    lgb = _lgb()
    Xm = np.vstack([np.hstack([X, ctx]), np.hstack([-X, ctx])])
    ym = np.r_[y, 1 - y]
    b = lgb.train(GBM_PARAMS, lgb.Dataset(Xm, ym), num_boost_round=n_iter)
    def pred(Z, c):
        p1 = b.predict(np.hstack([Z, c]))
        p2 = b.predict(np.hstack([-Z, c]))
        return 0.5 * (p1 + 1 - p2)
    return pred, b


def gbm_iters_winner(X, y, ctx, years, val_years):
    """Boosting rounds by time-ordered CV: expanding window, each validation year scored by the earlier years."""
    lgb = _lgb()
    best = []
    for vy in val_years:
        tr, va = years < vy, years == vy
        Xm = np.vstack([np.hstack([X[tr], ctx[tr]]), np.hstack([-X[tr], ctx[tr]])])
        ym = np.r_[y[tr], 1 - y[tr]]
        Xv = np.vstack([np.hstack([X[va], ctx[va]]), np.hstack([-X[va], ctx[va]])])
        yv = np.r_[y[va], 1 - y[va]]
        b = lgb.train(GBM_PARAMS, lgb.Dataset(Xm, ym), num_boost_round=1500,
                      valid_sets=[lgb.Dataset(Xv, yv)], callbacks=[lgb.early_stopping(100, verbose=False)])
        best.append(b.best_iteration)
    return int(np.median(best)), best


def eval_winner(T, verbose=True):
    y = T["winner"]
    ok = ~np.isnan(y)
    yrs = T["year"]
    tr = ok & (yrs <= 2023)
    va = ok & (yrs >= 2024) & (yrs <= 2025)
    ctx = np.c_[T["five"], T["title"], T["women"]]
    cv_years = [2019, 2020, 2021, 2022, 2023]
    res = {"n_train": int(tr.sum()), "n_valid": int(va.sum()), "models": {}}
    preds = {}
    # Elo and the embedding head need no fitting
    elo_logit = (T["FA"][:, T["fnames"].index("elo")] - T["FB"][:, T["fnames"].index("elo")]) * 100 * math.log(10) / 400
    preds["elo"] = 1 / (1 + np.exp(-elo_logit))
    preds["emb_head"] = 1 / (1 + np.exp(-T["s_win"]))
    for kind in ("base", "emb"):
        X, names = winner_features(T, kind)
        Xf = np.nan_to_num(X)
        # LR: C by time-ordered CV
        best = None
        for C in (0.003, 0.01, 0.03, 0.1, 0.3, 1.0):
            ll = []
            for vy in cv_years:
                a, b = tr & (yrs < vy), tr & (yrs == vy)
                f, _ = fit_lr(Xf[a], y[a], C)
                ll.append(logloss(f(Xf[b]), y[b]))
            m = float(np.mean(np.concatenate(ll)))
            if best is None or m < best[1]:
                best = (C, m)
        f, coef = fit_lr(Xf[tr], y[tr], best[0])
        preds["lr_" + kind] = f(Xf)
        res["models"]["lr_" + kind] = {"C": best[0], "cv_logloss_2019_2023": round(best[1], 5),
                                       "n_features": X.shape[1]}
        if kind == "emb":
            res["lr_emb_coef"] = {n_: round(float(c), 5) for n_, c in zip(names, coef)}
        # GBM
        n_iter, per = gbm_iters_winner(X[tr], y[tr], ctx[tr], yrs[tr], cv_years)
        oof = []
        for vy in cv_years:
            a, b = tr & (yrs < vy), tr & (yrs == vy)
            g, _ = fit_gbm_winner(X[a], y[a], ctx[a], n_iter)
            oof.append(logloss(g(X[b], ctx[b]), y[b]))
        g, _ = fit_gbm_winner(X[tr], y[tr], ctx[tr], n_iter)
        preds["gbm_" + kind] = g(X, ctx)
        res["models"]["gbm_" + kind] = {"n_iter": n_iter, "cv_iters": per,
                                        "cv_logloss_2019_2023": round(float(np.mean(np.concatenate(oof))), 5)}
    for k, p in preds.items():
        ll = logloss(p[va], y[va])
        acc = float(np.mean((p[va] > 0.5) == (y[va] == 1)))
        brier = float(np.mean((p[va] - y[va]) ** 2))
        cal, ece = calib_table(p[va], y[va])
        res["models"].setdefault(k, {}).update({"valid_logloss": round(float(ll.mean()), 5),
                                                "valid_brier": round(brier, 5), "valid_acc": round(acc, 4),
                                                "valid_ece": ece, "valid_calibration": cal})
    pairs = [("lr_emb", "lr_base"), ("gbm_emb", "gbm_base"), ("lr_emb", "elo"), ("emb_head", "elo"),
             ("gbm_emb", "lr_base")]
    res["deltas"] = {}
    for a_, b_ in pairs:
        d = logloss(preds[a_][va], y[va]) - logloss(preds[b_][va], y[va])
        mu, lo, hi = boot_ci(d)
        res["deltas"]["%s - %s" % (a_, b_)] = {"mean": round(mu, 5), "ci95": [round(lo, 5), round(hi, 5)]}
    if verbose:
        for k, v in res["models"].items():
            print("  winner %-9s valid logloss %.4f acc %.3f ece %.3f  cv %s" % (
                k, v["valid_logloss"], v["valid_acc"], v["valid_ece"], v.get("cv_logloss_2019_2023")))
        for k, v in res["deltas"].items():
            print("  delta %-22s %+.4f [%+.4f, %+.4f]" % (k, v["mean"], v["ci95"][0], v["ci95"][1]))
    return res, preds
