#!/usr/bin/env python3
"""Fighter embeddings: time-aware offense / defense latent vectors learned by a multi-task factorisation.

    python3 tools/embed.py                       # everything (noise, CV on 2019-2023, walk, downstream, outputs)
    python3 tools/embed.py --stage walk --chunk 1 &  python3 tools/embed.py --stage walk --chunk 2
                                                 # the two halves of the walk-forward as parallel processes,
    python3 tools/embed.py --skip-cv             # then the downstream tests and outputs from the cache
    python3 tools/embed.py --quick               # yearly CV refits and a 2-config grid (smoke test)

Model (one fit = one date T, every UFC fight with round stats in the 4 half-lives before T, never on/after T):

  every fighter i has an offense vector a_i and a defense vector d_i (K = 8 dims each). For each directed
  observation "X against Y in fight f" and each of 21 tasks t,

      eta_t = c_t + c_t[division] + beta_t * era + gamma_t * five_round + W_t . a_X + V_t . d_Y

  Tasks: significant strike attempts per minute at distance / clinch / ground and to head / body / leg,
  non-significant attempts, takedown attempts, control minutes, submission attempts and reversals per minute
  (negative binomial, log link, exposure = fight minutes; NB shape k_t), accuracy at distance / clinch /
  ground and to head / body / leg and takedown accuracy (binomial, logit link, each row weighted by the
  beta-binomial factor 1 / (1 + (n - 1) rho_t)), knockdowns per landed head strike (NB) and KO/TKO and
  submission finish hazards per minute (Poisson). k_t and rho_t are moment estimates on held-out 2016 fights
  (pre-2019 data only). The result head is antisymmetric (no intercept, so it cannot learn the corner):

      logit P(X beats Y) = u_a.(a_X - a_Y) + u_d.(d_X - d_Y) + a_X' M d_Y - a_Y' M d_X

  Rows are weighted 0.5 ^ ((T - date) / half_life) (decay-weighted refit = the temporal prior). Fighters and
  loadings carry L2 priors of the same strength lambda (a nuclear-norm-like penalty on the fighter x task
  matrix), division intercepts shrink toward the task's global level. MAP by alternating block Newton
  (per-task GLM steps, a 2K x 2K Newton step per fighter, a logistic step for the head, an exact L2
  rebalancing of the factor scales), each step backtracked so the objective falls monotonically.

Walk-forward: a full refit at the start of every quarter (warm-started from the previous quarter and
Procrustes-aligned to it, so the axes keep their meaning), and after every event a light update: a
fighter-only Newton step for the fighters who just fought, loadings frozen. The embedding used for a fight
dated d has therefore seen every UFC fight before d and nothing from d on. Hyperparameters (lambda, half-life,
defense prior, win weight) are chosen by time-ordered CV on 2019-2023 (half-year refits); 2024-2025 is the
validation period. Fights dated 2026-01-01 or later are dropped on load (hidden-data protocol) and never read;
the roster embeddings are the fit at 2026-01-01.

Downstream tests (2010-2023 train, 2024-2025 validation, symmetric evaluation): a mirrored no-intercept
logistic winner model and a mirrored LightGBM, each with and without embedding features; per-stat Poisson
models of the stat line (GLM on log5 features, LightGBM), with and without embeddings.

Writes data/derived/embed.json (model, per-snapshot embeddings keyed by backtest id and side, 2010-2018
training snapshots keyed by fight id, roster embeddings keyed by slug, axes, nearest neighbours, CV and
validation numbers), data/derived/embed_model.json (compact browser model for src/ml/embed.js, with a check
block of Python outputs that tests/test_embed.js reproduces) and research/model_embed.md (written by hand
from the printed numbers).
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


DIV_RIDGE, SLOPE_RIDGE = 2.0, 1.0


def ctx_rows(div, era, five, NDIV):
    """Context design [1, one-hot division, era (decades from 2015), five-round flag] (rows x NDIV + 3)."""
    Z = np.zeros((len(div), NDIV + 3))
    Z[:, 0] = 1.0
    Z[np.arange(len(div)), 1 + np.asarray(div)] = 1.0
    Z[:, NDIV + 1] = era
    Z[:, NDIV + 2] = five
    return Z


def ctx_ridge(NDIV):
    """Ridge on the context coefficients: the global intercept is free, division offsets shrink toward it (so a
    small division with no events of a rare kind in the window cannot drive its rate to zero), slopes mildly."""
    return np.r_[1e-4, np.full(NDIV, DIV_RIDGE), SLOPE_RIDGE, SLOPE_RIDGE]


class Fit:
    """One MAP fit on the rows dated before T (ordinal day), decay-weighted, by alternating block Newton.

    Blocks: (1) every task's loadings W_t, V_t and intercepts (a weighted GLM per task given the fighters),
    (2) every fighter's [a_i, d_i] (a 2K x 2K Newton step per fighter; stat rows involve one fighter's offense
    and the other's defense, the win head adds Gauss-Newton cross terms), (3) the win head (logistic Newton).
    Each block step is backtracked on the full objective, so the MAP objective decreases monotonically."""

    def __init__(self, D, T_day, hp, noise, warm=None, max_sweeps=40, tol=2e-6, verbose=False, who=None,
                 light_iters=2):
        self.D, self.T, self.hp, self.noise = D, T_day, hp, noise
        self.knb = noise["k"]
        self.K = K = hp["K"]
        lam_hl = math.log(2) / hp["hl"]
        win = hp.get("window", 4.0) * hp["hl"]          # rows older than `window` half-lives weigh < 1/16
        rmask = (D.r_day < T_day) & (D.r_day >= T_day - win)
        fmask = (D.f_day < T_day) & (D.f_day >= T_day - win) & ~np.isnan(D.f_win)
        if who is not None:                   # light update: only rows that involve the fighters being updated
            wm = np.zeros(D.F, bool)
            wm[who] = True
            rmask &= wm[D.r_x] | wm[D.r_y]
            fmask &= wm[D.f_a] | wm[D.f_b]
        ri = np.nonzero(rmask)[0]
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
        fi = np.nonzero(fmask)[0]
        self.fw = np.exp(-lam_hl * (T_day - D.f_day[fi])) * hp["win_w"]
        self.fa, self.fb, self.fy = D.f_a[fi], D.f_b[fi], D.f_win[fi]
        m = len(fi)
        self.Sa = sparse.csr_matrix((np.ones(m), (self.fa, np.arange(m))), shape=(F, m))
        self.Sb = sparse.csr_matrix((np.ones(m), (self.fb, np.arange(m))), shape=(F, m))
        self.active = np.zeros(F, bool)
        self.active[self.x] = True
        self.active[self.y] = True
        # per-row context design for the intercept block: [global, division offsets, era, five-round]
        self.Zc = ctx_rows(self.div, self.era, self.five, D.NDIV)
        self.creg = ctx_ridge(D.NDIV)
        self.P = self.init() if warm is None else {k: v.copy() for k, v in warm.items()}
        if warm is not None and warm["A"].shape[1] != K:
            raise ValueError("warm start with a different K")
        self.history = []
        self._cP, self._ceta, self._parts = None, None, (None, None)
        if who is not None:
            self.active = wm
            P = self.P
            L = self.loss(P)
            for _ in range(light_iters):
                P, L = self.step_fighters(P, L)
            self.P, self.L, self.sweeps = P, L, 0
            return
        self.run(max_sweeps, tol, verbose)

    # ---------------------------------------------------------------- pieces
    def init(self):
        D, K = self.D, self.K
        rng = np.random.default_rng(SEED)
        P = {"A": rng.normal(0, 0.1, (D.F, K)), "D": rng.normal(0, 0.1, (D.F, K)),
             "W": rng.normal(0, 0.1, (NT, K)), "V": rng.normal(0, 0.1, (NT, K)),
             "C": np.zeros((NT, D.NDIV + 3)), "ua": np.zeros(K), "ud": np.zeros(K), "M": np.zeros((K, K))}
        num = (self.w[:, None] * self.Yr).sum(0)
        den = (self.w[:, None] * self.Er).sum(0)
        r = num / np.maximum(den, 1e-9)
        base = np.where(IS_BIN, np.log(np.clip(r, 1e-6, 1 - 1e-6) / np.clip(1 - r, 1e-6, 1)),
                        np.log(np.maximum(r, 1e-6)))
        P["C"][:, 0] = base
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
                + 0.5 * (self.creg[None, :] * P["C"] ** 2).sum())

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
        lam, K = self.hp["lam"], self.K
        AX, DY = P["A"][self.x], P["D"][self.y]
        Z = np.hstack([AX, DY, self.Zc])
        _, G, H = _glm_terms(self.eta(P), self.Yr, self.Er, self.wc, self.knb)
        ld = lam * self.hp.get("lam_d", 1.0)
        reg = np.r_[np.full(K, lam), np.full(K, ld), self.creg]
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
    return ctx_rows(D.r_div[idx], D.r_era[idx], D.r_five[idx], D.NDIV)


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
    K = P["W"].shape[1]
    NDIV = P["C"].shape[1] - 3
    Z = ctx_rows(divs, era, five, NDIV)
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


def prior_for(priors, e):
    py = priors[e["date"][:4]]
    g = e.get("prior_division") or e["division"]
    return py.get(g) or py["ALL"]


def walk_lookup(walk):
    """entry -> (embedding A, embedding B, refit parameters, exposure A, exposure B) from a production walk."""
    def get(e):
        v = walk["fight"].get(e["id"])
        if v is None:
            return None
        return v[1], v[2], walk["quarters"][v[0]]["P"], v[3], v[4]
    return get


def build_table(entries, priors, lookup, D):
    """One row per snapshot fight: baseline features per side, embeddings, embedding-model outputs, outcomes."""
    rows = []
    for e in entries:
        g = lookup(e)
        if g is None:
            continue
        day = dt.date.fromisoformat(e["date"]).toordinal()
        pri = prior_for(priors, e)
        div = D.didx.get(e["division"], D.didx.get(e.get("prior_division"), D.didx["Lightweight"]))
        rows.append((e, day, div, pri, side_feats(e["A"], pri), side_feats(e["B"], pri), g))
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
    T["EB"] = np.array([r[6][1] for r in rows])
    T["XA"] = np.array([r[6][3] for r in rows])
    T["XB"] = np.array([r[6][4] for r in rows])
    # embedding-model outputs with the parameters of each fight's refit
    n = len(rows)
    T["s_win"] = np.zeros(n)
    T["eta_ab"] = np.zeros((n, NT))
    T["eta_ba"] = np.zeros((n, NT))
    for k in ("off_ab", "def_ab", "off_ba", "def_ba"):
        T[k] = np.zeros((n, NT))
    fit_of = np.array([id(r[6][2]) for r in rows])
    for fid_ in np.unique(fit_of):
        ii = np.nonzero(fit_of == fid_)[0]
        P = dict(rows[ii[0]][6][2])
        P["A"] = np.zeros((1, P["W"].shape[1]))
        ea, eb = T["EA"][ii], T["EB"][ii]
        T["s_win"][ii] = win_logit_emb(P, ea, eb)
        T["eta_ab"][ii] = eta_pair(P, T["div"][ii], T["era"][ii], T["five"][ii], ea, eb)
        T["eta_ba"][ii] = eta_pair(P, T["div"][ii], T["era"][ii], T["five"][ii], eb, ea)
        K = P["W"].shape[1]
        T["off_ab"][ii], T["def_ab"][ii] = ea[:, :K] @ P["W"].T, eb[:, K:] @ P["V"].T
        T["off_ba"][ii], T["def_ba"][ii] = eb[:, :K] @ P["W"].T, ea[:, K:] @ P["V"].T
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


def task_rows(T, D):
    """Directed task rows for the fights in T: (T row, side, y [n x NT], exposure [n x NT])."""
    drow = {(D.f_id[D.r_fight[r]], int(D.r_side[r])): r for r in range(len(D.r_fight))}
    jj, side, rr = [], [], []
    for j, fid in enumerate(T["id"]):
        for sd_ in (0, 1):
            r = drow.get((fid, sd_))
            if r is not None:
                jj.append(j)
                side.append(sd_)
                rr.append(r)
    jj, side, rr = np.array(jj), np.array(side), np.array(rr)
    return jj, side, D.Y[rr], D.E[rr]


def calibrate_tasks(T, D, fit_years=(2010, 2023), verbose=True):
    """Per-task recalibration of the factor model's walk-forward predictions:
        eta' = context + c_t + s_off,t * (W_t . a_X) + s_def,t * (V_t . d_Y)
    fit by Poisson / binomial deviance on directed rows of fit_years (walk-forward predictions, so out of
    sample for every row), plus a no-intercept slope for the win head. Folded exactly into W, V, C and the
    head afterwards (apply_calibration), so the exported model keeps its form. Also reports the factor
    model's own 2024-2025 validation deviance per task: context-only vs raw vs calibrated."""
    jj, side, Y, E = task_rows(T, D)
    yrs = T["year"][jj]
    tr = (yrs >= fit_years[0]) & (yrs <= fit_years[1])
    va = (yrs >= 2024) & (yrs <= 2025)
    eta = np.where(side[:, None] == 0, T["eta_ab"][jj], T["eta_ba"][jj])
    off = np.where(side[:, None] == 0, T["off_ab"][jj], T["off_ba"][jj])
    dfn = np.where(side[:, None] == 0, T["def_ab"][jj], T["def_ba"][jj])
    ctx = eta - off - dfn
    cal = {"c": np.zeros(NT), "s_off": np.ones(NT), "s_def": np.ones(NT)}
    val = {}
    days = T["day"][jj]
    for t in range(NT):
        binom = bool(IS_BIN[t])
        y, n = Y[:, t], E[:, t]
        ok = n > 0
        m = tr & ok
        # fit with the context as an offset: Newton on (c, s_off, s_def)
        Z = np.c_[np.ones(len(y)), off[:, t], dfn[:, t]]
        b = np.array([0.0, 1.0, 1.0])
        for _ in range(60):
            e = ctx[m, t] + Z[m] @ b
            if binom:
                pr = 1 / (1 + np.exp(-e))
                g = Z[m].T @ (n[m] * pr - y[m])
                Hm = (Z[m] * (n[m] * pr * (1 - pr))[:, None]).T @ Z[m]
            else:
                mu = n[m] * np.exp(np.clip(e, -30, 20))
                g = Z[m].T @ (mu - y[m])
                Hm = (Z[m] * mu[:, None]).T @ Z[m]
            st = np.linalg.solve(Hm + 1e-6 * np.eye(3), g)
            b -= st
            if np.abs(st).max() < 1e-10:
                break
        cal["c"][t], cal["s_off"][t], cal["s_def"][t] = b
        # context-only baseline (offset + refit constant) for the factor model's own validation numbers
        c0 = _glm_newton(np.ones((int(m.sum()), 1)), y[m], n[m] * (np.exp(ctx[m, t]) if not binom else 1.0), False) \
            if not binom else None
        mv = va & ok
        e_raw = eta[mv, t]
        e_cal = ctx[mv, t] + Z[mv] @ b
        if binom:
            cb = _glm_newton_offset(ctx[m, t], y[m], n[m])
            e_ctx = ctx[mv, t] + cb
        else:
            e_ctx = ctx[mv, t] + c0[0]
        d_ctx, d_raw, d_cal = (_dev1(y[mv], n[mv], e_, binom) for e_ in (e_ctx, e_raw, e_cal))
        mu_, lo_, hi_ = boot_ci(d_cal - d_ctx, days[mv])
        base = d_ctx.mean()
        val[TN[t]] = {"ctx_dev": round(float(d_ctx.sum()), 2), "raw_dev": round(float(d_raw.sum()), 2),
                      "cal_dev": round(float(d_cal.sum()), 2), "rel_raw": round(float(d_raw.sum() / d_ctx.sum()), 4),
                      "rel_cal": round(float(d_cal.sum() / d_ctx.sum()), 4),
                      "cal_vs_ctx_ci95": [round(lo_ / base, 4), round(hi_ / base, 4)],
                      "c": round(float(b[0]), 4), "s_off": round(float(b[1]), 4), "s_def": round(float(b[2]), 4)}
        if verbose:
            print("  task %-7s valid rel. deviance vs context-only: raw %.4f calibrated %.4f [%+.4f, %+.4f] "
                  "(c %+.3f, s_off %.3f, s_def %.3f)" % (TN[t], val[TN[t]]["rel_raw"], val[TN[t]]["rel_cal"],
                                                         lo_ / base, hi_ / base, b[0], b[1], b[2]))
    # win head slope (mirrored, no intercept)
    y = T["winner"]
    okw = ~np.isnan(y) & (T["year"] >= fit_years[0]) & (T["year"] <= fit_years[1])
    z = T["s_win"][okw]
    yy = y[okw]
    sl = 1.0
    for _ in range(50):
        p_ = 1 / (1 + np.exp(-sl * z))
        g = ((p_ - yy) * z).sum()
        h = (p_ * (1 - p_) * z * z).sum()
        sl -= g / h
    cal["s_win"] = float(sl)
    vw = ~np.isnan(y) & (T["year"] >= 2024) & (T["year"] <= 2025)
    ll_raw = logloss(1 / (1 + np.exp(-T["s_win"][vw])), y[vw]).mean()
    ll_cal = logloss(1 / (1 + np.exp(-sl * T["s_win"][vw])), y[vw]).mean()
    val["win_head"] = {"slope": round(sl, 4), "valid_logloss_raw": round(float(ll_raw), 5),
                       "valid_logloss_cal": round(float(ll_cal), 5)}
    rr_ = np.array([val[t]["rel_raw"] for t in TN])
    rc_ = np.array([val[t]["rel_cal"] for t in TN])
    val["mean_rel_raw"], val["mean_rel_cal"] = round(float(rr_.mean()), 4), round(float(rc_.mean()), 4)
    if verbose:
        print("  factor model, 2024-25 mean relative deviance vs context-only: raw %.4f, calibrated %.4f; win head "
              "slope %.3f, valid log loss %.4f -> %.4f" % (rr_.mean(), rc_.mean(), sl, ll_raw, ll_cal))
    return cal, val


def _glm_newton_offset(off, y, n, iters=60):
    """Constant c for a logit binomial with offset: P = sigmoid(off + c)."""
    c = 0.0
    for _ in range(iters):
        pr = 1 / (1 + np.exp(-(off + c)))
        g = (n * pr - y).sum()
        h = (n * pr * (1 - pr)).sum() + 1e-9
        c -= g / h
    return c


def apply_calibration(walk, cal):
    """Fold the per-task calibration into every refit's parameters (and the final refit)."""
    for q in walk["quarters"] + [walk["final"]]:
        P = q["P"]
        P["W"] = P["W"] * cal["s_off"][:, None]
        P["V"] = P["V"] * cal["s_def"][:, None]
        P["C"] = P["C"].copy()
        P["C"][:, 0] = P["C"][:, 0] + cal["c"]
        P["ua"], P["ud"], P["M"] = P["ua"] * cal["s_win"], P["ud"] * cal["s_win"], P["M"] * cal["s_win"]


def boot_ci(delta, clusters=None, n_boot=2000, seed=SEED):
    """Mean and 95% paired-bootstrap interval of per-fight deltas, resampling whole clusters (event dates:
    fights on one card share judges, cage and conditions) when given."""
    rng = np.random.default_rng(seed)
    d = np.asarray(delta, float)
    if clusters is None:
        bs = d[rng.integers(0, len(d), (n_boot, len(d)))].mean(1)
    else:
        _, inv = np.unique(np.asarray(clusters), return_inverse=True)
        cs = np.bincount(inv, weights=d)
        cn = np.bincount(inv).astype(float)
        pick = rng.integers(0, len(cs), (n_boot, len(cs)))
        bs = cs[pick].sum(1) / cn[pick].sum(1)
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
    coef = m.coef_[0] / sd
    return (lambda Z: 1 / (1 + np.exp(-np.nan_to_num(Z) @ coef))), coef


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
        mu, lo, hi = boot_ci(d, T["day"][va])
        res["deltas"]["%s - %s" % (a_, b_)] = {"mean": round(mu, 5), "ci95": [round(lo, 5), round(hi, 5)]}
    if verbose:
        for k, v in res["models"].items():
            print("  winner %-9s valid logloss %.4f acc %.3f ece %.3f  cv %s" % (
                k, v["valid_logloss"], v["valid_acc"], v["valid_ece"], v.get("cv_logloss_2019_2023")))
        for k, v in res["deltas"].items():
            print("  delta %-22s %+.4f [%+.4f, %+.4f]" % (k, v["mean"], v["ci95"][0], v["ci95"][1]))
    return res, preds


def eval_ml_stack(T, verbose=True):
    """Incremental value over the ML agent's winner model (data/derived/ml.json, when present): mirrored
    no-intercept logistic stacks fit on its 2019-2023 out-of-fold rows, scored on 2024-2025. Only ids that are
    in backtest_dev.json are read, so no 2026 fight is touched even though ml.json lists them."""
    path = os.path.join(DER, "ml.json")
    if not os.path.exists(path):
        return None
    ml = json.load(open(path))["fights"]
    dev_ids = {e["id"] for e in json.load(open(BACKTEST_DEV))["fights"]}
    rowof = {fid: i for i, fid in enumerate(T["id"])}
    keep = [fid for fid in ml if fid in dev_ids and fid in rowof and ml[fid].get("y") is not None]
    ii = np.array([rowof[f] for f in keep])
    y = np.array([float(ml[f]["y"]) for f in keep])
    yrs = T["year"][ii]
    tr, va = yrs <= 2023, (yrs >= 2024) & (yrs <= 2025)
    lg = lambda p: np.log(np.clip(p, 1e-6, 1 - 1e-6) / (1 - np.clip(p, 1e-6, 1 - 1e-6)))
    Xe, en = winner_features(T, "emb")
    Xe = np.nan_to_num(Xe[ii])
    emb_cols = [j for j, n_ in enumerate(en) if n_.startswith("demb_") or n_.startswith("emb_")]
    out = {"n_train_oof": int(tr.sum()), "n_valid": int(va.sum()), "models": {}, "deltas": {}}
    preds = {}
    for base in ("ml", "ml_iso", "stack"):
        if any(base not in ml[f] for f in keep):
            continue
        zb = lg(np.array([ml[f][base] for f in keep]))[:, None]
        preds[base + "_raw"] = 1 / (1 + np.exp(-zb[:, 0]))
        f0, c0 = fit_lr(zb[tr], y[tr], 1e4)
        preds[base + "_recal"] = f0(zb)
        f1, c1 = fit_lr(np.hstack([zb, T["s_win"][ii][:, None]])[tr], y[tr], 1e4)
        preds[base + "+emb_head"] = f1(np.hstack([zb, T["s_win"][ii][:, None]]))
        Xf = np.hstack([zb, Xe[:, emb_cols]])
        best = None
        for C in (0.003, 0.01, 0.03, 0.1, 0.3):          # C by leave-one-year-out inside 2019-2023
            ll = []
            for vy in range(2019, 2024):
                a, b = tr & (yrs != vy), tr & (yrs == vy)
                f, _ = fit_lr(Xf[a], y[a], C)
                ll.append(logloss(f(Xf[b]), y[b]))
            m = float(np.mean(np.concatenate(ll)))
            if best is None or m < best[1]:
                best = (C, m)
        f2, c2 = fit_lr(Xf[tr], y[tr], best[0])
        preds[base + "+emb_all"] = f2(Xf)
        out["models"][base + "+emb_head"] = {"coef": [round(float(c), 4) for c in c1]}
        out["models"][base + "+emb_all"] = {"C": best[0], "loyo_logloss_2019_2023": round(best[1], 5)}
        for a_, b_ in (("+emb_head", "_recal"), ("+emb_all", "_recal"), ("_recal", "_raw")):
            d = logloss(preds[base + a_][va], y[va]) - logloss(preds[base + b_][va], y[va])
            mu, lo, hi = boot_ci(d, T["day"][ii][va])
            out["deltas"]["%s%s - %s%s" % (base, a_, base, b_)] = {"mean": round(mu, 5),
                                                                    "ci95": [round(lo, 5), round(hi, 5)]}
    for k, p in preds.items():
        cal, ece = calib_table(p[va], y[va])
        out["models"].setdefault(k, {}).update({"valid_logloss": round(float(logloss(p[va], y[va]).mean()), 5),
                                                "valid_acc": round(float(np.mean((p[va] > 0.5) == (y[va] == 1))), 4),
                                                "valid_ece": ece})
    if verbose:
        for k, v in out["models"].items():
            if "valid_logloss" in v:
                print("  ml-stack %-16s valid logloss %.4f acc %.3f ece %.3f" % (k, v["valid_logloss"], v["valid_acc"],
                                                                             v["valid_ece"]))
        for k, v in out["deltas"].items():
            print("  delta %-34s %+.4f [%+.4f, %+.4f]" % (k, v["mean"], v["ci95"][0], v["ci95"][1]))
    return out


MLR_MAP = {"d_att": "d_att", "c_att": "c_att", "g_att": "g_att", "h_att": "h_att", "b_att": "b_att", "l_att": "l_att",
           "td_att": "td_att", "sub_att": "sub_att", "rev": "rev", "ctrl": "ctrl", "acc_h": "h_acc",
           "acc_b": "b_acc", "acc_l": "l_acc", "acc_d": "d_acc", "acc_c": "c_acc", "acc_g": "g_acc",
           "td_acc": "td_acc", "kd_h": "kd"}


def _glm_newton(Z, y, n, binom, iters=50, ridge=1e-6):
    """Tiny GLM (log link Poisson with exposure n, or logit binomial with trials n) by Newton."""
    b = np.zeros(Z.shape[1])
    if not binom:
        b[0] = math.log(max(y.sum(), 1e-9) / max(n.sum(), 1e-9))
    for _ in range(iters):
        e = Z @ b
        if binom:
            pr = 1 / (1 + np.exp(-e))
            g = Z.T @ (n * pr - y) + ridge * b
            H = (Z * (n * pr * (1 - pr))[:, None]).T @ Z + ridge * np.eye(len(b))
        else:
            mu = n * np.exp(np.clip(e, -30, 20))
            g = Z.T @ (mu - y) + ridge * b
            H = (Z * mu[:, None]).T @ Z + ridge * np.eye(len(b))
        step = np.linalg.solve(H, g)
        b -= step
        if np.abs(step).max() < 1e-10:
            break
    return b


def _dev1(y, n, eta, binom):
    if binom:
        mu = n / (1 + np.exp(-eta))
        t1 = np.where(y > 0, y * np.log(np.maximum(y, 1e-12) / np.maximum(mu, 1e-12)), 0.0)
        t2 = np.where(n - y > 0, (n - y) * np.log(np.maximum(n - y, 1e-12) / np.maximum(n - mu, 1e-12)), 0.0)
        return 2 * (t1 + t2)
    mu = n * np.exp(np.clip(eta, -30, 20))
    return 2 * (np.where(y > 0, y * np.log(np.maximum(y, 1e-12) / np.maximum(mu, 1e-12)), 0.0) - (y - mu))


def eval_mlrates_stack(T, D, verbose=True):
    """Incremental value over the mlrates stat-line model (data/derived/mlrates_oof.json, when present): per
    target, link(mu) = b0 + b1 link(mlrates) [+ b2 link(embedding)] fit on its 2019-2023 out-of-fold rows and
    scored on 2024-2025 (its dev model, trained 2010-2023). Rows: both sides of every backtest_dev fight."""
    path = os.path.join(DER, "mlrates_oof.json")
    if not os.path.exists(path):
        return None
    mo = json.load(open(path))
    targets = mo["meta"]["targets"]
    fights = mo["fights"]
    dev_ids = {e["id"] for e in json.load(open(BACKTEST_DEV))["fights"]}
    rowof = {fid: i for i, fid in enumerate(T["id"])}
    # directed rows of D by (fight id, side)
    drow = {}
    for r in range(len(D.r_fight)):
        drow[(D.f_id[D.r_fight[r]], int(D.r_side[r]))] = r
    R = []
    for fid, v in fights.items():
        if fid not in dev_ids or fid not in rowof:
            continue
        j = rowof[fid]
        for side, tag in ((0, "A"), (1, "B")):
            r = drow.get((fid, side))
            if r is None:
                continue
            R.append((j, r, v[tag], T["eta_ab"][j] if side == 0 else T["eta_ba"][j]))
    jj = np.array([x[0] for x in R])
    rr = np.array([x[1] for x in R])
    ML = np.array([x[2] for x in R], float)
    ETA = np.array([x[3] for x in R])
    yrs = T["year"][jj]
    tr, va = yrs <= 2023, (yrs >= 2024) & (yrs <= 2025)
    days = T["day"][jj]
    out = {"n_rows_oof": int(tr.sum()), "n_rows_valid": int(va.sum()), "targets": {}}
    contrib = defaultdict(lambda: np.zeros(int(va.sum())))
    for ti_, tname in enumerate(targets):
        task = MLR_MAP[tname]
        t = TI[task]
        binom = bool(IS_BIN[t])
        y, n = D.Y[rr, t], D.E[rr, t]
        ok = n > 0
        if tname == "ctrl":
            lm = np.log(np.maximum(ML[:, ti_] / 60.0, 1e-6))
        elif binom:
            pm = np.clip(ML[:, ti_], 1e-6, 1 - 1e-6)
            lm = np.log(pm / (1 - pm))
        else:
            lm = np.log(np.maximum(ML[:, ti_], 1e-9))
        le = ETA[:, t]
        if tname == "kd_h":          # mlrates: binomial P(kd | landed head); embedding: Poisson rate per landed head
            pm = np.clip(ML[:, ti_], 1e-6, 1 - 1e-6)
            lm = np.log(pm)
            binom = False
        one = np.ones(len(y))
        Z1 = np.c_[one, lm]
        Z2 = np.c_[one, lm, le]
        m_tr = tr & ok
        b1 = _glm_newton(Z1[m_tr], y[m_tr], n[m_tr], binom)
        b2 = _glm_newton(Z2[m_tr], y[m_tr], n[m_tr], binom)
        d_raw = _dev1(y[va], n[va], lm[va], binom)
        d1 = _dev1(y[va], n[va], Z1[va] @ b1, binom)
        d2 = _dev1(y[va], n[va], Z2[va] @ b2, binom)
        d_emb = _dev1(y[va], n[va], le[va], binom)
        okv = ok[va]
        d_raw, d1, d2, d_emb = (np.where(okv, d, 0.0) for d in (d_raw, d1, d2, d_emb))
        mu, lo, hi = boot_ci(d2 - d1, days[va])
        base = d1.mean()
        rec = {"task": task, "raw_dev": round(float(d_raw.sum()), 2), "recal_dev": round(float(d1.sum()), 2),
               "plus_emb_dev": round(float(d2.sum()), 2), "emb_only_dev": round(float(d_emb.sum()), 2),
               "coef_recal": [round(float(x), 4) for x in b1], "coef_plus_emb": [round(float(x), 4) for x in b2],
               "rel_change": round(mu / base, 4), "ci95": [round(lo / base, 4), round(hi / base, 4)]}
        out["targets"][tname] = rec
        contrib["plus_emb - recal"] += (d2 - d1) / d1.sum() / len(targets)
        contrib["recal - raw"] += (d1 - d_raw) / d_raw.sum() / len(targets)
        contrib["emb_only - raw"] += (d_emb - d_raw) / d_raw.sum() / len(targets)
        if verbose:
            print("  mlrates %-7s raw %.1f recal %.1f +emb %.1f (emb alone %.1f) change %+.2f%% [%+.2f, %+.2f] b_emb %+.3f"
                  % (tname, d_raw.sum(), d1.sum(), d2.sum(), d_emb.sum(), 100 * mu / base, 100 * lo / base,
                     100 * hi / base, b2[2]))
    out["mean_rel_change"] = {}
    for k, c in contrib.items():
        mu, lo, hi = boot_ci(c, days[va])
        nn_ = len(c)
        out["mean_rel_change"][k] = {"mean": round(mu * nn_, 4), "ci95": [round(lo * nn_, 4), round(hi * nn_, 4)]}
        if verbose:
            print("  mlrates, mean relative deviance change %-18s %+.2f%% [%+.2f, %+.2f]" % (
                k, 100 * mu * nn_, 100 * lo * nn_, 100 * hi * nn_))
    return out


# ------------------------------------------------------------------------------------------------ downstream: stat lines
# stat -> (attacker feature, defender "allowed" feature, prior per fighter-minute or None)
STAT_LOG5 = {"sig_att": ("satt", "osatt"), "sig_lnd": ("slpm", "sapm"), "h_lnd": ("h_lpm", "oh_lpm"),
             "b_lnd": ("b_lpm", "ob_lpm"), "l_lnd": ("l_lpm", "ol_lpm"), "td_att": ("td_apm", "otd_apm"),
             "td_lnd": ("td_lpm", "otd_lpm"), "ctrl": ("ctrl", "octrl"), "sub_att": ("sub", "osub"),
             "kd": ("h_lpm", "oh_lpm")}


def prior_rate(pri, stat):
    g = lambda k: pri[k]
    return {"sig_att": g("d_att") + g("c_att") + g("g_att"), "sig_lnd": g("d_lnd") + g("c_lnd") + g("g_lnd"),
            "h_lnd": g("h_lnd"), "b_lnd": g("b_lnd"), "l_lnd": g("l_lnd"), "td_att": g("td_att"),
            "td_lnd": g("td_lnd"), "ctrl": g("ctrl"), "sub_att": g("sub_att"),
            "kd": g("h_lnd") * g("kd_per_h")}[stat]


def stat_rows(T):
    """Directed rows (attacker, defender) for every snapshot fight with an actual stat line."""
    out = {"i": [], "side": [], "y": [], "min": []}
    for i, a in enumerate(T["actual"]):
        if a is None:
            continue
        for side, (x, z) in enumerate((("A", "B"), ("B", "A"))):
            out["i"].append(i)
            out["side"].append(side)
            out["y"].append([float(a[x][k]) for k in STATS])
            out["min"].append(float(a["minutes"]))
    return {k: np.array(v) for k, v in out.items()}


def stat_design(T, R, stat, kind):
    """Feature matrix for one stat. kind: glm_base, gbm_base, glm_emb, gbm_emb."""
    i, side = R["i"], R["side"]
    FX = np.where(side[:, None] == 0, T["FA"][i], T["FB"][i])
    FY = np.where(side[:, None] == 0, T["FB"][i], T["FA"][i])
    fn = T["fnames"]
    ox, oy = STAT_LOG5[stat]
    pr = np.array([prior_rate(T["prior"][j], stat) for j in i])
    xo = FX[:, fn.index(ox)]
    ya = FY[:, fn.index(oy)]
    if stat == "kd":
        # knockdowns per minute = head landed per minute x knockdowns per landed head strike (power vs chin)
        xo = xo * FX[:, fn.index("pow")]
        ya = ya * FY[:, fn.index("chin")]
    log5 = np.log(xo + 1e-6) + np.log(ya + 1e-6) - np.log(pr + 1e-6)
    ctx = np.c_[T["five"][i], T["women"][i], T["era"][i]]
    cols = [log5[:, None], np.log(xo + 1e-6)[:, None], np.log(ya + 1e-6)[:, None], np.log(pr + 1e-6)[:, None], ctx]
    if kind.startswith("gbm"):
        cols += [np.nan_to_num(FX, nan=-1.0), np.nan_to_num(FY, nan=-1.0)]
    if kind.endswith("emb"):
        K = T["EA"].shape[1] // 2
        EX = np.where(side[:, None] == 0, T["EA"][i], T["EB"][i])
        EY = np.where(side[:, None] == 0, T["EB"][i], T["EA"][i])
        eta = np.where(side[:, None] == 0, T["eta_ab"][i], T["eta_ba"][i])
        rates = stat_rates(eta)
        cols += [np.log(rates[stat] + 1e-6)[:, None], EX[:, :K], EY[:, K:]]
        if kind.startswith("gbm"):
            cols += [np.log(rates[k] + 1e-6)[:, None] for k in STATS if k != stat]
    return np.hstack(cols)


def emb_direct_rate(T, R, stat):
    eta = np.where(R["side"][:, None] == 0, T["eta_ab"][R["i"]], T["eta_ba"][R["i"]])
    return stat_rates(eta)[stat]


def pois_dev(y, mu):
    mu = np.maximum(mu, 1e-9)
    return 2 * (np.where(y > 0, y * np.log(np.maximum(y, 1e-12) / mu), 0.0) - (y - mu))


STAT_GBM = {"objective": "poisson", "learning_rate": 0.04, "num_leaves": 15, "min_data_in_leaf": 80,
            "feature_fraction": 0.7, "bagging_fraction": 0.8, "bagging_freq": 1, "lambda_l2": 5.0,
            "verbose": -1, "num_threads": 1, "seed": SEED}


def eval_stats(T, verbose=True):
    from sklearn.linear_model import PoissonRegressor
    lgb = _lgb()
    R = stat_rows(T)
    yrs = T["year"][R["i"]]
    tr = yrs <= 2023
    va = (yrs >= 2024) & (yrs <= 2025)
    es_tr, es_va = tr & (yrs <= 2020), tr & (yrs >= 2021)
    fight = R["i"]
    res = {"n_train_rows": int(tr.sum()), "n_valid_rows": int(va.sum()), "stats": {}}
    all_dev = defaultdict(lambda: np.zeros(int(va.sum())))
    fv_all = fight[va]
    ufights, inv_all = np.unique(fv_all, return_inverse=True)
    contrib = defaultdict(lambda: np.zeros(len(ufights)))     # per-fight share of the mean relative change
    for si, stat in enumerate(STATS):
        y = R["y"][:, si]
        m = R["min"]
        rate = y / m
        out = {}
        preds = {}
        preds["emb_direct"] = emb_direct_rate(T, R, stat) * m
        # two-term log-linear blend an engine can apply: log rate = b0 + b1 log(log5 rate) + b2 log(embedding rate)
        Xb = np.c_[stat_design(T, R, stat, "glm_base")[:, 0], np.log(emb_direct_rate(T, R, stat) + 1e-6)]
        gb = PoissonRegressor(alpha=0.0, max_iter=1000)
        gb.fit(Xb[tr], rate[tr], sample_weight=m[tr])
        preds["blend"] = gb.predict(Xb) * m
        out["blend_coef"] = {"b0": round(float(gb.intercept_), 4), "b_log5": round(float(gb.coef_[0]), 4),
                             "b_emb": round(float(gb.coef_[1]), 4)}
        ge = PoissonRegressor(alpha=0.0, max_iter=1000)
        ge.fit(Xb[tr, 1:], rate[tr], sample_weight=m[tr])
        preds["emb_cal"] = ge.predict(Xb[:, 1:]) * m
        out["emb_cal_coef"] = {"b0": round(float(ge.intercept_), 4), "b_emb": round(float(ge.coef_[0]), 4)}
        for kind in ("glm_base", "glm_emb", "gbm_base", "gbm_emb"):
            X = stat_design(T, R, stat, kind)
            if kind.startswith("glm"):
                mu_, sd_ = X[tr].mean(0), X[tr].std(0) + 1e-9
                g = PoissonRegressor(alpha=1e-4, max_iter=1000)
                g.fit((X[tr] - mu_) / sd_, rate[tr], sample_weight=m[tr])
                preds[kind] = g.predict((X - mu_) / sd_) * m
            else:
                b = lgb.train(STAT_GBM, lgb.Dataset(X[es_tr], rate[es_tr], weight=m[es_tr]), num_boost_round=2000,
                              valid_sets=[lgb.Dataset(X[es_va], rate[es_va], weight=m[es_va])],
                              callbacks=[lgb.early_stopping(100, verbose=False)])
                n_it = max(50, b.best_iteration)
                b = lgb.train(STAT_GBM, lgb.Dataset(X[tr], rate[tr], weight=m[tr]), num_boost_round=n_it)
                preds[kind] = b.predict(X) * m
                out[kind + "_iters"] = n_it
        devs = {k: pois_dev(y[va], p[va]) for k, p in preds.items()}
        base = devs["glm_base"].sum()
        for k, d in devs.items():
            out[k] = {"dev": round(float(d.sum()), 2), "rel": round(float(d.sum() / base), 4)}
            all_dev[k] += d / max(base, 1e-9)
        # per-fight paired bootstrap (event clusters) for fixed model pairs; best_base is reported, not selected on
        best_base = min(("glm_base", "gbm_base"), key=lambda k: devs[k].sum())
        fv = fight[va]
        uf, inv = np.unique(fv, return_inverse=True)
        out["gain"] = {}
        for key, a_, b_ in (("gbm_emb - gbm_base", "gbm_emb", "gbm_base"), ("glm_emb - glm_base", "glm_emb", "glm_base"),
                            ("blend - glm_base", "blend", "glm_base")):
            dfight = np.bincount(inv, weights=devs[a_] - devs[b_])
            tot = np.bincount(inv, weights=devs[b_]).mean()
            mu, lo, hi = boot_ci(dfight, T["day"][uf])
            out["gain"][key] = {"rel_change": round(mu / tot, 4), "ci95": [round(lo / tot, 4), round(hi / tot, 4)]}
        for key, a_, b_ in (("gbm_emb - gbm_base", "gbm_emb", "gbm_base"), ("glm_emb - glm_base", "glm_emb", "glm_base"),
                            ("blend - glm_base", "blend", "glm_base"), ("emb_direct - glm_base", "emb_direct", "glm_base"),
                            ("emb_cal - glm_base", "emb_cal", "glm_base"),
                            ("gbm_emb - best_base", "gbm_emb", best_base)):
            contrib[key] += np.bincount(inv_all, weights=devs[a_] - devs[b_]) / devs[b_].sum() / len(STATS)
        res["stats"][stat] = out
        if verbose:
            g1, g2 = out["gain"]["gbm_emb - gbm_base"], out["gain"]["glm_emb - glm_base"]
            print("  stat %-8s rel dev vs glm_base: gbm_base %.4f | emb_direct %.4f emb_cal %.4f blend %.4f glm_emb %.4f "
                  "gbm_emb %.4f | gbm %+.2f%% [%+.2f, %+.2f] glm %+.2f%% [%+.2f, %+.2f]" % (
                      stat, out["gbm_base"]["rel"], out["emb_direct"]["rel"], out["emb_cal"]["rel"], out["blend"]["rel"],
                      out["glm_emb"]["rel"], out["gbm_emb"]["rel"], 100 * g1["rel_change"], 100 * g1["ci95"][0],
                      100 * g1["ci95"][1], 100 * g2["rel_change"], 100 * g2["ci95"][0], 100 * g2["ci95"][1]))
    res["mean_rel"] = {k: round(float(v.sum() / len(STATS)), 4) for k, v in all_dev.items()}
    res["mean_rel_change"] = {}
    for k, c in contrib.items():
        mu, lo, hi = boot_ci(c, T["day"][ufights])
        n = len(c)
        res["mean_rel_change"][k] = {"mean": round(mu * n, 4), "ci95": [round(lo * n, 4), round(hi * n, 4)]}
        if verbose:
            print("  stats, mean relative deviance change %-26s %+.2f%% [%+.2f, %+.2f]" % (
                k, 100 * mu * n, 100 * lo * n, 100 * hi * n))
    return res


# ------------------------------------------------------------------------------------------------ production walk
def production_walk(D, hp, noise, start, end, cold_sweeps=30, warm_sweeps=5, light_iters=3, verbose=True,
                    tag=""):
    """Quarterly full refits on [start, end) plus a light (fighter-only Newton) update after every event, so the
    embedding used for a fight dated d has seen every earlier fight. A final full refit at `end`.

    Returns {"quarters": [{T, P (loadings, intercepts, head), A, D}], "fight": {fid: [q, embA, embB, expoA,
    expoB]}, "final": {T, P, A, D}}; the quarters are Procrustes-chained to each other."""
    qdates = refit_dates(start, end, "quarter")
    days = sorted({f.day for f in D.all_fights if start.toordinal() <= f.day < end.toordinal()})
    by_day = defaultdict(list)
    for f in D.all_fights:
        if start.toordinal() <= f.day < end.toordinal() and f.persons and f.persons[0] != f.persons[1]:
            by_day[f.day].append(f)
    out = {"quarters": [], "fight": {}, "hp": hp}
    P_prev = None
    t0 = time.time()
    for qi, Tq in enumerate(qdates):
        Tn = qdates[qi + 1] if qi + 1 < len(qdates) else end.toordinal()
        f = Fit(D, Tq, hp, noise, warm=P_prev, max_sweeps=cold_sweeps if P_prev is None else warm_sweeps, tol=1e-6)
        P = align(f.P, P_prev, exposure(D, Tq, hp["hl"])) if P_prev is not None else f.P
        P_prev = P
        out["quarters"].append({"T": Tq, "P": {k: v.copy() for k, v in P.items() if k not in ("A", "D")},
                                "A": P["A"].copy(), "D": P["D"].copy(), "sweeps": f.sweeps})
        cur = P
        for d in [x for x in days if Tq <= x < Tn]:
            fl = by_day[d]
            expo = exposure(D, d, hp["hl"])
            for fo in fl:
                if fo.persons[0] not in D.pidx or fo.persons[1] not in D.pidx:
                    continue
                a, b = D.pidx[fo.persons[0]], D.pidx[fo.persons[1]]
                out["fight"][fo.fid] = [qi, np.r_[cur["A"][a], cur["D"][a]], np.r_[cur["A"][b], cur["D"][b]],
                                        float(expo[a]), float(expo[b])]
            who = sorted({D.pidx[p] for fo in fl if fo.stats for p in fo.persons if p in D.pidx})
            if who and d + 1 < Tn:
                lf = Fit(D, d + 1, hp, noise, warm=cur, who=np.array(who), light_iters=light_iters)
                cur = lf.P
        if verbose:
            print("%s quarter %s: %d sweeps, %d fights recorded, %.0fs" % (
                tag, dt.date.fromordinal(Tq), f.sweeps, len(out["fight"]), time.time() - t0), flush=True)
    f = Fit(D, end.toordinal(), hp, noise, warm=P_prev, max_sweeps=warm_sweeps * 2, tol=1e-6)
    P = align(f.P, P_prev, exposure(D, end.toordinal(), hp["hl"]))
    out["final"] = {"T": end.toordinal(), "P": {k: v.copy() for k, v in P.items() if k not in ("A", "D")},
                    "A": P["A"].copy(), "D": P["D"].copy(), "sweeps": f.sweeps}
    if verbose:
        print("%s final refit %s: %d sweeps, %.0fs" % (tag, end, f.sweeps, time.time() - t0), flush=True)
    return out


def lin_transform(W, Vv, ua, ud, M, SA, SD):
    """Loadings / head after the fighter-space change a' = a SA, d' = d SD (predictions unchanged)."""
    iA, iD = np.linalg.inv(SA), np.linalg.inv(SD)
    return W @ iA.T, Vv @ iD.T, iA @ ua, iD @ ud, iA @ M @ iD.T


def apply_walk(walk, SA, SD):
    """Apply a fighter-space change to every stored quarter, fight embedding and the final refit."""
    K = SA.shape[0]
    for q in walk["quarters"] + [walk["final"]]:
        q["A"], q["D"] = q["A"] @ SA, q["D"] @ SD
        P = q["P"]
        P["W"], P["V"], P["ua"], P["ud"], P["M"] = lin_transform(P["W"], P["V"], P["ua"], P["ud"], P["M"], SA, SD)
    for v in walk["fight"].values():
        for j in (1, 2):
            v[j] = np.r_[v[j][:K] @ SA, v[j][K:] @ SD]


def varimax(L, gamma=1.0, iters=200, tol=1e-8):
    p, k = L.shape
    R = np.eye(k)
    d = 0
    for _ in range(iters):
        Lr = L @ R
        u, s, vt = np.linalg.svd(L.T @ (Lr ** 3 - (gamma / p) * Lr @ np.diag((Lr ** 2).sum(0))))
        R = u @ vt
        d_new = s.sum()
        if d_new < d * (1 + tol):
            break
        d = d_new
    return R


def stitch_and_orient(w1, w2, D, hp, ref_date=dt.date(2019, 1, 1)):
    """Align chunk 2 onto chunk 1 at their shared date, then rotate everything to varimax axes of the loadings
    of the refit at ref_date (training data only), orient and scale each axis (unit sd over fighters with a
    decayed fight count >= 1 at ref_date). Returns the merged walk."""
    ref = w1["final"]
    first = w2["quarters"][0]
    assert ref["T"] == first["T"]
    wts = exposure(D, ref["T"], hp["hl"])
    RA = procrustes(first["A"], ref["A"], wts)
    RD = procrustes(first["D"], ref["D"], wts)
    apply_walk(w2, RA, RD)
    # chunk 2's fight records index its own quarter list; shift them to the merged list (w1 quarters first).
    # (Bug fixed Nov 6 2026 pm: without the shift every 2018-2025 fight was scored with the loadings of the
    # quarter eight years earlier. Not a look-ahead, but it degraded every downstream number.)
    off = len(w1["quarters"])
    w2 = dict(w2, fight={fid: [v[0] + off] + list(v[1:]) for fid, v in w2["fight"].items()})
    act = wts >= 1.0
    X1 = np.hstack([ref["A"], ref["D"]])[act]
    X2 = np.hstack([w2["quarters"][0]["A"], w2["quarters"][0]["D"]])[act]
    stitch = {"date": dt.date.fromordinal(ref["T"]).isoformat(), "n_fighters": int(act.sum()),
              "rel_rms_diff": round(float(np.sqrt(((X1 - X2) ** 2).mean()) / X1.std()), 4),
              "corr": round(float(np.corrcoef(X1.ravel(), X2.ravel())[0, 1]), 4)}
    merged = {"quarters": w1["quarters"] + w2["quarters"], "fight": {**w1["fight"], **w2["fight"]},
              "final": w2["final"], "hp": hp, "stitch": stitch}
    q = next(x for x in merged["quarters"] if x["T"] == ref_date.toordinal())
    GA = varimax(q["P"]["W"])
    GD = varimax(q["P"]["V"])
    apply_walk(merged, GA, GD)
    q = next(x for x in merged["quarters"] if x["T"] == ref_date.toordinal())
    W, Vv = q["P"]["W"], q["P"]["V"]
    # offense: largest loading positive; defense: largest loading negative (higher = opponents do less)
    sa = np.sign(W[np.abs(W).argmax(0), np.arange(W.shape[1])])
    sd = -np.sign(Vv[np.abs(Vv).argmax(0), np.arange(Vv.shape[1])])
    act = exposure(D, ref_date.toordinal(), hp["hl"]) >= 1.0
    scA = q["A"][act].std(0) + 1e-9
    scD = q["D"][act].std(0) + 1e-9
    # order the axes by how much they move predictions (loading norm x fighter sd); the L2 (nuclear-norm-like)
    # prior leaves some axes nearly unused: those keep the live axes' typical scale instead of being blown up
    # to unit sd (which would turn them into pure noise features)
    effA = np.sqrt((W ** 2).sum(0)) * scA
    effD = np.sqrt((Vv ** 2).sum(0)) * scD
    liveA, liveD = effA >= 0.05 * effA.max(), effD >= 0.05 * effD.max()
    scA = np.where(liveA, scA, np.median(scA[liveA]))
    scD = np.where(liveD, scD, np.median(scD[liveD]))
    oa = np.argsort(-effA)
    od = np.argsort(-effD)
    PA = np.eye(len(oa))[:, oa]
    PD = np.eye(len(od))[:, od]
    apply_walk(merged, np.diag(sa / scA) @ PA, np.diag(sd / scD) @ PD)
    merged["axis_effect"] = {"offense": np.round(effA[oa] / effA.max(), 4).tolist(),
                             "defense": np.round(effD[od] / effD.max(), 4).tolist()}
    return merged


# ------------------------------------------------------------------------------------------------ interpretation
TASK_SHORT = {"d_att": "distance volume", "c_att": "clinch volume", "g_att": "ground-strike volume",
              "h_att": "head-strike volume", "b_att": "body-strike volume", "l_att": "leg-kick volume",
              "ns_att": "non-sig. (grappling) strikes", "d_acc": "distance accuracy", "c_acc": "clinch accuracy",
              "g_acc": "ground accuracy", "h_acc": "head accuracy", "b_acc": "body accuracy",
              "l_acc": "leg accuracy", "kd": "knockdown power", "td_att": "takedown attempts",
              "td_acc": "takedown accuracy", "ctrl": "control time", "sub_att": "submission attempts",
              "rev": "reversals", "ko_fin": "KO/TKO finishing", "sub_fin": "submission finishing"}


def describe_axes(P, A, Dm, slugs, expo, names, min_expo=2.0, top=6):
    """Top task loadings and top fighters per axis. Offense loading = change in the attacker's log-rate (or
    logit) per unit of the axis; defense loading = change in what opponents achieve against him (axes are
    oriented so that positive defense = opponents do less of the dominant task)."""
    out = {"offense": [], "defense": []}
    ok = expo >= min_expo
    for side, L, X in (("offense", P["W"], A), ("defense", P["V"], Dm)):
        for k in range(L.shape[1]):
            order = np.argsort(-np.abs(L[:, k]))[:top]
            loads = [[TN[t], round(float(L[t, k]), 3)] for t in order]
            vals = np.where(ok, X[:, k], np.nan)
            hi = [slugs[i] for i in np.argsort(-np.nan_to_num(vals, nan=-1e9))[:8]]
            lo = [slugs[i] for i in np.argsort(np.nan_to_num(vals, nan=1e9))[:5]]
            out[side].append({"axis": "%s%d" % (side[0], k), "label": names.get("%s%d" % (side[0], k), ""),
                              "loadings": loads, "high": hi, "low": lo})
    return out


def auto_label(entry, side):
    """A readable default name from the two largest loadings (hand labels override in AXIS_LABELS)."""
    parts = []
    for t, v in entry["loadings"][:2]:
        word = TASK_SHORT[t]
        if side == "offense":
            parts.append(("+" if v > 0 else "-") + word)
        else:
            parts.append(("allows less " if v < 0 else "allows more ") + word)
    return " / ".join(parts)


def nn_metric(P, A, Dm, expo, min_expo=1.0):
    """Q (2K x 2K) such that sqrt(de' Q de) is the distance between two fighters' predicted-stat profiles: the
    21 offense effects W a and the 21 defense effects V d, each standardised by its sd over active fighters."""
    ok = expo >= min_expo
    so = (A[ok] @ P["W"].T).std(0) + 1e-9
    sd = (Dm[ok] @ P["V"].T).std(0) + 1e-9
    K = A.shape[1]
    Bm = np.zeros((2 * NT, 2 * K))
    Bm[:NT, :K] = P["W"] / so[:, None]
    Bm[NT:, K:] = P["V"] / sd[:, None]
    return Bm.T @ Bm, so, sd


def profile(P, e, so, sd):
    """Standardised predicted-stat profile of one fighter: offense effects then defense effects per task."""
    K = P["W"].shape[1]
    return np.r_[(P["W"] @ e[:K]) / so, (P["V"] @ e[K:]) / sd]


def neighbours(emb, slugs, expo, slug, k=10, min_expo=2.0, Q=None):
    i = slugs.index(slug)
    de = emb - emb[i]
    d = np.sqrt(np.maximum(((de @ Q) * de).sum(1), 0.0)) if Q is not None else np.sqrt((de ** 2).sum(1))
    d[i] = np.inf
    d[expo < min_expo] = np.inf
    order = np.argsort(d)[:k]
    return [[slugs[j], round(float(d[j]), 3)] for j in order]


def r4(x, nd=4):
    if isinstance(x, np.ndarray):
        return np.round(x, nd).tolist()
    return round(float(x), nd)


# ------------------------------------------------------------------------------------------------ outputs
AXIS_LABELS = {           # hand labels after reading the loadings and axis leaders (research/model_embed.md)
    "o0": "grappling offense: takedowns, control, submissions",
    "o1": "distance head-strike volume (striker, not a submitter)",
    "o2": "finishing striker: accuracy and KO power",
    "o3": "leg-kick volume",
    "o4": "body-strike volume",
    "o5": "clinch volume and dirty boxing",
    "o6": "top-position damage and finishing",
    "o7": "efficient close-range and leg striking (weak axis)",
    "d0": "anti-grappling: hard to take down, hold or submit",
    "d1": "denies distance striking (fights end up on the mat; more reversals against)",
    "d2": "hard to hit clean or finish",
    "d3": "keeps fights out of the clinch (eats more leg kicks)",
    "d4": "opponents rarely shoot on him",
    "d5": "denies body and leg kicks (weak axis)",
    "d6": "denies clinch accuracy (weak axis)",
    "d7": "denies leg-kick accuracy (weak axis)",
}
NN_MIN_EXPO = 2.0         # neighbours / axis leaders need a decayed fight count of at least this
CHECK_PAIRS = [("alexander-volkanovski", "justin-gaethje", "Lightweight", 5),
               ("islam-makhachev", "arman-tsarukyan", "Lightweight", 5),
               ("ilia-topuria", "charles-oliveira", "Lightweight", 5),
               ("dricus-du-plessis", "khamzat-chimaev", "Middleweight", 5),
               ("zhang-weili", "tatiana-suarez", "Women's Strawweight", 3)]


def py_eval_compact(m, ea, eb, division, era, five):
    """Python twin of src/ml/embed.js matchup() on the rounded compact model (for the Node test)."""
    K, NDIV = m["K"], len(m["divs"])
    C, W, V = np.array(m["C"]), np.array(m["W"]), np.array(m["V"])
    dv = m["divs"].index(division) if division in m["divs"] else m["divs"].index(m["default_division"])
    ea, eb = np.array(ea, float), np.array(eb, float)
    def eta(x, y):
        return (C[:, 0] + C[:, 1 + dv] + C[:, NDIV + 1] * era + C[:, NDIV + 2] * five
                + W @ x[:K] + V @ y[K:])
    ua, ud, M = np.array(m["ua"]), np.array(m["ud"]), np.array(m["M"])
    z = ua @ (ea[:K] - eb[:K]) + ud @ (ea[K:] - eb[K:]) + ea[:K] @ M @ eb[K:] - eb[:K] @ M @ ea[K:]
    eA, eB = eta(ea, eb), eta(eb, ea)
    rA = {k: float(v[0]) for k, v in stat_rates(eA[None, :]).items()}
    rB = {k: float(v[0]) for k, v in stat_rates(eB[None, :]).items()}
    return {"pA": float(1 / (1 + np.exp(-z))), "logit": float(z), "etaA": eA.tolist(), "etaB": eB.tolist(),
            "ratesA": rA, "ratesB": rB}


def write_outputs(D, noise, hp, cv, walk, T, win_res, win_preds, stat_res, secs, cache):
    fin = walk["final"]
    P, A, Dm = fin["P"], fin["A"], fin["D"]
    K = A.shape[1]
    expo = exposure(D, fin["T"], hp["hl"])
    emb = np.hstack([A, Dm])
    slugs = D.slug
    roster_slugs = set(json.load(open(os.path.join(DER, "fighters.json")))["fighters"])
    axes = describe_axes(P, A, Dm, slugs, expo, AXIS_LABELS, NN_MIN_EXPO)
    for side in ("offense", "defense"):
        for a in axes[side]:
            if not a["label"]:
                a["label"] = auto_label(a, side)
    Q, so, sdv = nn_metric(P, A, Dm, expo)
    nn, signature = {}, {}
    for sl in ("alexander-volkanovski", "justin-gaethje"):
        if sl in D.slug_idx:
            nn[sl] = neighbours(emb, slugs, expo, sl, 10, NN_MIN_EXPO, Q)
            pr = profile(P, emb[D.slug_idx[sl]], so, sdv)
            order = np.argsort(-np.abs(pr))[:8]
            signature[sl] = [[("off " if j < NT else "def ") + TN[j % NT], round(float(pr[j]), 2)] for j in order]
    roster = {}
    for i, sl in enumerate(slugs):
        if sl in roster_slugs and expo[i] > 0:
            roster[sl] = [r4(emb[i], 4), r4(expo[i], 3)]
    # per-snapshot embeddings: backtest_dev ids (2019-2025) and every earlier 2010-2018 fight (for training)
    dev_ids = [e["id"] for e in json.load(open(BACKTEST_DEV))["fights"]]
    rowof = {fid: i for i, fid in enumerate(T["id"])}
    snaps, train_snaps, missing = {}, {}, 0
    for fid in dev_ids:
        v = walk["fight"].get(fid)
        if v is None:
            missing += 1
            continue
        rec = {"A": r4(v[1]), "B": r4(v[2]), "xA": r4(v[3], 3), "xB": r4(v[4], 3), "q": int(v[0])}
        j = rowof.get(fid)
        if j is not None:
            rec["win_logit"] = r4(T["s_win"][j])
        snaps[fid] = rec
    for e in T["entries"]:
        if e["date"] < "2019-01-01":
            v = walk["fight"][e["id"]]
            train_snaps[e["id"]] = {"A": r4(v[1]), "B": r4(v[2]), "xA": r4(v[3], 3), "xB": r4(v[4], 3),
                                    "date": e["date"], "a": e["A"]["slug"], "b": e["B"]["slug"],
                                    "win_logit": r4(T["s_win"][rowof[e["id"]]])}
    quarters = [{"T": dt.date.fromordinal(q["T"]).isoformat(), "C": r4(q["P"]["C"]), "W": r4(q["P"]["W"]),
                 "V": r4(q["P"]["V"]), "ua": r4(q["P"]["ua"]), "ud": r4(q["P"]["ud"]), "M": r4(q["P"]["M"])}
                for q in walk["quarters"]]
    model = {"K": K, "tasks": [[t, k] for t, k, _ in TASKS], "task_labels": [lab for _, _, lab in TASKS],
             "divs": D.divs, "default_division": "Lightweight", "era_date": "2026-01-01",
             "C": r4(P["C"], 5), "W": r4(P["W"], 5), "V": r4(P["V"], 5), "ua": r4(P["ua"], 5), "ud": r4(P["ud"], 5),
             "M": r4(P["M"], 5), "noise": {"nb_k": {TN[i]: r4(noise["k"][i], 3) for i in range(NT) if IS_NB[i]},
                                           "bb_rho": {TN[i]: r4(noise["rho"][i], 4) for i in range(NT) if IS_BIN[i]}},
             "axes": {s: [[a["axis"], a["label"]] for a in axes[s]] for s in axes}, "nn_min_expo": NN_MIN_EXPO,
             "nn_Q": r4(Q, 6),
             "roster": roster}
    # check block on the rounded model (what the browser evaluates)
    era = (dt.date(2026, 1, 1).toordinal() - dt.date(2015, 1, 1).toordinal()) / 3652.5
    checks = []
    for a, b, div, rounds in CHECK_PAIRS:
        if a in roster and b in roster:
            checks.append({"a": a, "b": b, "division": div, "rounds": rounds,
                           "out": py_eval_compact(model, roster[a][0], roster[b][0], div, era, 1.0 if rounds == 5 else 0.0)})
    rng = np.random.default_rng(SEED)
    rs = sorted(roster)
    for _ in range(25):
        a, b = rng.choice(len(rs), 2, replace=False)
        div = D.divs[int(rng.integers(0, len(D.divs)))]
        rounds = int(rng.choice([3, 5]))
        checks.append({"a": rs[a], "b": rs[b], "division": div, "rounds": rounds,
                       "out": py_eval_compact(model, roster[rs[a]][0], roster[rs[b]][0], div, era,
                                              1.0 if rounds == 5 else 0.0)})
    model["check"] = checks
    meta = {"source": "tools/embed.py on data/raw via tools/build_db.py loaders; fights dated 2026-01-01 or later "
                      "are dropped on load (hidden-data protocol)",
            "built": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
            "last_fight_used": dt.date.fromordinal(int(D.f_day.max())).isoformat(),
            "hyperparameters": hp, "K": K, "dims": 2 * K,
            "noise": model["noise"], "tasks": [{"name": t, "kind": k, "label": lab} for t, k, lab in TASKS],
            "refits": "quarterly full refits 2010-01-01..2025-10-01 (warm-started, Procrustes-chained), a light "
                      "fighter-only Newton update after every event, final refit 2026-01-01 (roster)",
            "orientation": "axes rotated to varimax of the 2019-01-01 refit's loadings, offense axes signed so the "
                           "largest loading is positive, defense axes so that positive = opponents do less of the "
                           "dominant task; each axis scaled to unit sd over fighters with a decayed fight count >= 1 "
                           "at 2019-01-01 and ordered by its effect on predictions",
            "embedding_layout": "[o0..o%d, d0..d%d]; xA / xB = decayed fight count (half-life %g days) behind the "
                                "embedding (0 = no UFC stat fight: the vector is the division-average zero)"
                                % (K - 1, K - 1, hp["hl"]),
            "corner": "A / B as in backtest_dev.json (A = first-named); nothing in the model uses the order",
            "cv": [{"hp": c["hp"], "mean_rel_dev": round(c["mean_rel"], 4), "win_logloss": round(c["win_ll"], 4),
                    "score": round(cv_score(c), 4)} for c in cv],
            "stitch": walk.get("stitch"), "axis_effect": walk.get("axis_effect"),
            "calibration": walk.get("calibration"), "runtime_s": round(secs)}
    out = {"meta": meta, "model": {k: model[k] for k in ("K", "tasks", "divs", "C", "W", "V", "ua", "ud", "M")},
           "axes": axes, "neighbours": nn, "signature": signature,
           "validation": {"winner": win_res, "stats": stat_res},
           "roster": roster, "snapshots": snaps, "train_snapshots": train_snaps, "quarters": quarters,
           "missing_snapshots": missing}
    with open(OUT_JSON, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    with open(OUT_MODEL, "w") as fh:
        json.dump(model, fh, separators=(",", ":"))
    print("wrote %s (%.1f MB) and %s (%.0f KB); %d snapshots (%d missing), %d train snapshots, %d roster" % (
        OUT_JSON, os.path.getsize(OUT_JSON) / 1e6, OUT_MODEL, os.path.getsize(OUT_MODEL) / 1e3, len(snaps), missing,
        len(train_snaps), len(roster)))
    for side in ("offense", "defense"):
        for a in axes[side]:
            print("  %s %-60s %s | high: %s" % (a["axis"], a["label"][:60], a["loadings"][:4], ", ".join(a["high"][:5])))
    for sl, l in nn.items():
        print("  neighbours of %s: %s" % (sl, ", ".join("%s (%.2f)" % (x, d) for x, d in l)))
        print("  signature of %s: %s" % (sl, signature[sl]))
    _save({"T": T, "win_preds": win_preds, "walk_final": fin}, _pk(cache, "eval_state.pkl"))


# ------------------------------------------------------------------------------------------------ extras: integration
# Second pass (python3 tools/embed.py --stage extras): reads the cached walk / downstream table, adds
#   * integration tests on top of the current best inputs (ML logistic, the no-line stack, ratings, the closing line),
#   * by-segment results (newcomers, years, 5-rounders, women, favourite strength),
#   * the mlrates + embedding stat-line blend recipe (per target, embedding term kept only where time-ordered CV
#     inside 2019-2023 says it helps), with a browser check block,
#   * neighbours in three pools (profile distance, style cosine, same weight band, active men),
# and merges them into data/derived/embed.json and embed_model.json.

def _lg(p):
    p = np.clip(np.asarray(p, float), 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


def _slope(p, y):
    """Calibration slope: mirrored no-intercept logistic of y on logit p (1 = calibrated, > 1 underconfident)."""
    z = np.r_[_lg(p), -_lg(p)]
    yy = np.r_[y, 1 - y]
    s = 1.0
    for _ in range(60):
        q = 1 / (1 + np.exp(-s * z))
        g = ((q - yy) * z).sum()
        h = (q * (1 - q) * z * z).sum() + 1e-12
        s -= g / h
    return float(s)


def _min_n(T):
    """Prior UFC fights of the less experienced man (backtest entries need >= 1 for both)."""
    return np.array([min(e["A"]["n"], e["B"]["n"]) for e in T["entries"]], float)


def _segments_fight(T, idx, base_p):
    """Boolean masks (over the rows idx of T) for the fight-level segments used throughout."""
    mn = _min_n(T)[idx]
    yr = T["year"][idx]
    fav = np.abs(np.asarray(base_p) - 0.5)
    q1, q2 = np.quantile(fav, [1 / 3, 2 / 3])
    return {
        "min UFC fights 1-2 (newcomer)": mn <= 2,
        "min UFC fights 3-5": (mn >= 3) & (mn <= 5),
        "min UFC fights 6+": mn >= 6,
        "2024": yr == 2024,
        "2025": yr == 2025,
        "five-round": T["five"][idx] == 1,
        "three-round": T["five"][idx] == 0,
        "women": T["women"][idx] == 1,
        "men": T["women"][idx] == 0,
        "toss-ups (bottom third of |p - 0.5|)": fav <= q1,
        "middle third of |p - 0.5|": (fav > q1) & (fav <= q2),
        "clear favourites (top third of |p - 0.5|)": fav > q2,
    }


def _delta_rec(da, clusters):
    mu, lo, hi = boot_ci(da, clusters)
    return {"mean": round(mu, 5), "ci95": [round(lo, 5), round(hi, 5)]}


def _score_rec(p, y):
    cal, ece = calib_table(p, y)
    return {"n": int(len(y)), "logloss": round(float(logloss(p, y).mean()), 5),
            "brier": round(float(np.mean((p - y) ** 2)), 5), "acc": round(float(np.mean((p > 0.5) == (y == 1))), 4),
            "ece": ece, "slope": round(_slope(p, y), 3)}


def load_bases(T):
    """Per-fight win probabilities from the other verified components, read only for backtest_dev ids
    (2019-2025): ml.json (lr = the 0.6062 logistic, stack = elo + ml + market rating), market.json (power no-vig
    close, no-vig open, market rating), ratings.json (its second-stage stack). Orientation is checked against
    backtest_dev (A = first-named) on every row."""
    dev = {e["id"]: e for e in json.load(open(BACKTEST_DEV))["fights"] if e["date"] < HIDDEN_FROM.isoformat()}
    rowof = {fid: i for i, fid in enumerate(T["id"])}
    ml = json.load(open(os.path.join(DER, "ml.json")))["fights"]
    mk = json.load(open(os.path.join(DER, "market.json")))["fights"]
    rp = os.path.join(DER, "ratings.json")
    rt = json.load(open(rp))["predictions"] if os.path.exists(rp) else {}
    ids, cols = [], defaultdict(list)
    bad = 0
    for fid, e in dev.items():
        j = rowof.get(fid)
        if j is None or np.isnan(T["winner"][j]):
            continue
        m, k, r = ml.get(fid, {}), mk.get(fid, {}), rt.get(fid)
        if m.get("y") is not None and float(m["y"]) != T["winner"][j]:
            bad += 1
        if r is not None and (r["A"] != e["A"]["slug"] or r["B"] != e["B"]["slug"]):
            r = None
            bad += 1
        ids.append(j)
        cols["ml_lr"].append(m.get("lr", np.nan))
        cols["ml_stack"].append(m.get("stack", np.nan))
        cols["close"].append(k.get("p_power_close", np.nan))
        cols["open"].append(k.get("p_novig_open", np.nan))
        cols["mkt_rating"].append(k.get("p_market_rating", np.nan))
        cols["ratings"].append(r["p"].get("stack", np.nan) if r is not None else np.nan)
    assert bad == 0, "orientation mismatch in %d rows" % bad
    return np.array(ids), {c: np.array([np.nan if v is None else v for v in vals], float) for c, vals in cols.items()}


INTEG_SETS = [("ml_lr", ["ml_lr"]), ("ml_stack", ["ml_stack"]), ("no_line_best", ["ml_stack", "ratings"]),
              ("open", ["open"]), ("close", ["close"]), ("close+ml_stack", ["close", "ml_stack"])]


def eval_integration(T, verbose=True):
    """Does the embedding add to the current best inputs? For each base set: a mirrored no-intercept logistic
    on the logits (recalibrated base), the same plus the embedding head logit (+emb), and plus the head and its
    interaction with the smaller decayed fight count g = x_min / (1 + x_min) (+emb_x, so the stack can trust the
    head more when both men have data). Fit on 2019-2023 (all inputs present), C = 1e4 (no penalty); the
    variant to use is chosen by leave-one-year-out log loss inside 2019-2023; scored once on 2024-2025."""
    ids, B_ = load_bases(T)
    y = T["winner"][ids]
    yrs = T["year"][ids]
    days = T["day"][ids]
    ze = T["s_win"][ids]
    xm = np.minimum(T["XA"][ids], T["XB"][ids])
    g = xm / (1 + xm)
    out = {"sets": {}, "segments": {}, "n_rows": int(len(ids))}
    seg_store = {}
    for name, cols in INTEG_SETS:
        ok = np.all([~np.isnan(B_[c]) for c in cols], axis=0)
        tr, va = ok & (yrs <= 2023), ok & (yrs >= 2024) & (yrs <= 2025)
        Zb = np.c_[[_lg(B_[c]) for c in cols]].T
        designs = {"base": Zb, "+emb": np.c_[Zb, ze], "+emb_x": np.c_[Zb, ze, ze * g]}
        rec = {"inputs": cols, "n_train": int(tr.sum()), "n_valid": int(va.sum()), "variants": {}}
        preds = {}
        for vk, Z in designs.items():
            loyo = []
            for vy in range(2019, 2024):
                a, b = tr & (yrs != vy), tr & (yrs == vy)
                if b.sum() == 0 or a.sum() == 0:
                    continue
                f, _ = fit_lr(Z[a], y[a], 1e4)
                loyo.append(logloss(f(Z[b]), y[b]))
            f, coef = fit_lr(Z[tr], y[tr], 1e4)
            preds[vk] = f(Z)
            rec["variants"][vk] = dict(_score_rec(preds[vk][va], y[va]),
                                       loyo_2019_2023=round(float(np.mean(np.concatenate(loyo))), 5),
                                       coef=[round(float(c), 4) for c in coef])
        raw = np.mean([B_[c] for c in cols], axis=0) if len(cols) == 1 else None
        if raw is not None:
            rec["raw_valid"] = _score_rec(raw[va], y[va])
        pick = min(("+emb", "+emb_x"), key=lambda k: rec["variants"][k]["loyo_2019_2023"])
        rec["chosen_by_loyo"] = pick
        rec["deltas"] = {}
        for a_ in ("+emb", "+emb_x"):
            rec["deltas"][a_ + " - base"] = _delta_rec(logloss(preds[a_][va], y[va]) - logloss(preds["base"][va], y[va]),
                                                       days[va])
        rec["deltas"]["chosen - base"] = rec["deltas"][pick + " - base"]
        out["sets"][name] = rec
        seg_store[name] = (va, preds["base"], preds[pick])
        if verbose:
            v = rec["variants"]
            d = rec["deltas"]["chosen - base"]
            print("  integ %-15s n %d/%d  base %.4f  +emb %.4f  +emb_x %.4f  chosen %s %+.4f [%+.4f, %+.4f]" % (
                name, rec["n_train"], rec["n_valid"], v["base"]["logloss"], v["+emb"]["logloss"], v["+emb_x"]["logloss"],
                pick, d["mean"], d["ci95"][0], d["ci95"][1]), flush=True)
    # segments for each set: chosen embedding variant vs base, and the base's own log loss
    for name, (va, pb, pe) in seg_store.items():
        idx = ids[va]
        masks = _segments_fight(T, idx, pb[va])
        yy = y[va]
        dl = logloss(pe[va], yy) - logloss(pb[va], yy)
        out["segments"][name] = {}
        for sk, m in masks.items():
            if m.sum() < 20:
                continue
            out["segments"][name][sk] = dict(n=int(m.sum()), base_logloss=round(float(logloss(pb[va][m], yy[m]).mean()), 5),
                                             delta=_delta_rec(dl[m], days[va][m]))
    # the newcomer gap itself: each base vs the close on the same rows, by segment
    ok = ~np.isnan(B_["close"]) & ~np.isnan(B_["ml_lr"]) & ~np.isnan(B_["ml_stack"]) & (yrs >= 2024)
    idx = ids[ok]
    masks = _segments_fight(T, idx, B_["close"][ok])
    gap = {}
    for sk in ("min UFC fights 1-2 (newcomer)", "min UFC fights 3-5", "min UFC fights 6+"):
        m = masks[sk]
        gap[sk] = {"n": int(m.sum())}
        for c in ("close", "ml_lr", "ml_stack"):
            gap[sk][c] = round(float(logloss(B_[c][ok][m], y[ok][m]).mean()), 5)
        gap[sk]["emb_head"] = round(float(logloss(1 / (1 + np.exp(-ze[ok][m])), y[ok][m]).mean()), 5)
        gap[sk]["x_min_mean"] = round(float(xm[ok][m].mean()), 3)
    out["newcomer_gap_2024_25"] = gap
    if verbose:
        for sk, v in gap.items():
            print("  gap %-40s %s" % (sk, v))
    return out


def eval_winner_segments(T, win_preds, verbose=True):
    """By-segment validation deltas for the downstream winner models (embedding vs base, head vs Elo)."""
    y = T["winner"]
    va = ~np.isnan(y) & (T["year"] >= 2024) & (T["year"] <= 2025)
    idx = np.where(va)[0]
    masks = _segments_fight(T, idx, win_preds["lr_base"][va])
    out = {}
    for a_, b_ in (("lr_emb", "lr_base"), ("gbm_emb", "gbm_base"), ("emb_head", "elo")):
        dl = logloss(win_preds[a_][va], y[va]) - logloss(win_preds[b_][va], y[va])
        key = "%s - %s" % (a_, b_)
        out[key] = {}
        for sk, m in masks.items():
            if m.sum() < 20:
                continue
            out[key][sk] = dict(n=int(m.sum()), base_logloss=round(float(logloss(win_preds[b_][va][m], y[va][m]).mean()), 5),
                                delta=_delta_rec(dl[m], T["day"][va][m]))
        if verbose:
            s = out[key]
            print("  seg %-18s " % key + " | ".join("%s %+.4f" % (k.split(" (")[0][:14], v["delta"]["mean"])
                                                   for k, v in s.items()))
    return out


def _blend_link(tname, binom_task, ML):
    """mlrates output -> the link scale of the blend (and whether the blend is binomial)."""
    if tname == "ctrl":
        return np.log(np.maximum(ML / 60.0, 1e-6)), False
    if tname == "kd_h":
        return np.log(np.clip(ML, 1e-6, 1 - 1e-6)), False
    if binom_task:
        pm = np.clip(ML, 1e-6, 1 - 1e-6)
        return np.log(pm / (1 - pm)), True
    return np.log(np.maximum(ML, 1e-9)), False


def eval_mlrates_blend(T, D, verbose=True):
    """The stat-line integration recipe: per mlrates target, link(rate) = b0 + b1 link(mlrates) [+ b2 eta_emb].
    Fit on mlrates' 2019-2023 out-of-fold rows; whether to keep b2 is decided per target by leave-one-year-out
    deviance inside 2019-2023 (never by validation); scored once on 2024-2025 (mlrates' dev model, trained
    2010-2023). Reports all-target and CV-selected versions, per-target changes and segments by the attacker's
    and the fight's UFC experience."""
    mo = json.load(open(os.path.join(DER, "mlrates_oof.json")))
    targets = mo["meta"]["targets"]
    dev_ids = {e["id"] for e in json.load(open(BACKTEST_DEV))["fights"]}
    rowof = {fid: i for i, fid in enumerate(T["id"])}
    drow = {(D.f_id[D.r_fight[r]], int(D.r_side[r])): r for r in range(len(D.r_fight))}
    R = []
    for fid, v in mo["fights"].items():
        if fid not in dev_ids or fid not in rowof or v["date"] >= HIDDEN_FROM.isoformat():
            continue
        j = rowof[fid]
        for side, tag in ((0, "A"), (1, "B")):
            r = drow.get((fid, side))
            if r is not None:
                R.append((j, r, side, v[tag]))
    jj = np.array([x[0] for x in R])
    rr = np.array([x[1] for x in R])
    sd_ = np.array([x[2] for x in R])
    ML = np.array([x[3] for x in R], float)
    ETA = np.where(sd_[:, None] == 0, T["eta_ab"][jj], T["eta_ba"][jj])
    yrs = T["year"][jj]
    tr, va = yrs <= 2023, (yrs >= 2024) & (yrs <= 2025)
    days = T["day"][jj]
    n_att = np.array([T["entries"][j]["A" if s == 0 else "B"]["n"] for j, s in zip(jj, sd_)], float)
    n_min = _min_n(T)[jj]
    recipe, recipe_sel, per = {}, {}, {}
    dv = {"recal": [], "all": [], "sel": []}
    for ti_, tname in enumerate(targets):
        task = MLR_MAP[tname]
        t = TI[task]
        y, n = D.Y[rr, t], D.E[rr, t]
        ok = n > 0
        lm, binom = _blend_link(tname, bool(IS_BIN[t]), ML[:, ti_])
        le = ETA[:, t]
        one = np.ones(len(y))
        Z1, Z2 = np.c_[one, lm], np.c_[one, lm, le]
        m_tr = tr & ok
        # leave-one-year-out inside 2019-2023
        cv1 = cv2 = 0.0
        for vy in range(2019, 2024):
            a, b = m_tr & (yrs != vy), m_tr & (yrs == vy)
            if b.sum() == 0:
                continue
            b1 = _glm_newton(Z1[a], y[a], n[a], binom)
            b2 = _glm_newton(Z2[a], y[a], n[a], binom)
            cv1 += _dev1(y[b], n[b], Z1[b] @ b1, binom).sum()
            cv2 += _dev1(y[b], n[b], Z2[b] @ b2, binom).sum()
        keep = bool(cv2 < cv1)
        b1 = _glm_newton(Z1[m_tr], y[m_tr], n[m_tr], binom)
        b2 = _glm_newton(Z2[m_tr], y[m_tr], n[m_tr], binom)
        okv = ok[va]
        d1 = np.where(okv, _dev1(y[va], n[va], Z1[va] @ b1, binom), 0.0)
        d2 = np.where(okv, _dev1(y[va], n[va], Z2[va] @ b2, binom), 0.0)
        dv["recal"].append(d1)
        dv["all"].append(d2)
        dv["sel"].append(d2 if keep else d1)
        mu, lo, hi = boot_ci(d2 - d1, days[va])
        base = d1.mean()
        per[tname] = {"task": task, "cv_dev_recal": round(cv1, 2), "cv_dev_plus_emb": round(cv2, 2),
                      "cv_rel_change": round((cv2 - cv1) / cv1, 4), "keep_emb": keep,
                      "valid_rel_change": round(mu / base, 4), "ci95": [round(lo / base, 4), round(hi / base, 4)]}
        units = "seconds / min" if tname == "ctrl" else ("P(knockdown) per landed head strike" if tname == "kd_h"
                                                         else ("probability" if binom else "per minute"))
        recipe[tname] = {"task": task, "link": "logit" if binom else "log", "units": units,
                         "b": [round(float(x), 6) for x in b2]}
        recipe_sel[tname] = dict(recipe[tname], b=[round(float(x), 6) for x in (b2 if keep else np.r_[b1, 0.0])])
        if verbose:
            print("  blend %-7s cv %+.2f%% keep %-5s valid %+.2f%% [%+.2f, %+.2f]  b %s" % (
                tname, 100 * (cv2 - cv1) / cv1, keep, 100 * mu / base, 100 * lo / base, 100 * hi / base,
                recipe_sel[tname]["b"]), flush=True)
    NTg = len(targets)

    def mean_rel(mask, which):
        """Mean over targets of the relative deviance change (which vs recal) on the rows in mask, with an
        event-cluster bootstrap CI."""
        contrib = np.zeros(int(mask.sum()))
        for d1, dx in zip(dv["recal"], dv[which]):
            contrib += (dx[mask] - d1[mask]) / max(d1[mask].sum(), 1e-9) / NTg
        mu, lo, hi = boot_ci(contrib, days[va][mask])
        k = len(contrib)
        return {"n_rows": k, "mean": round(mu * k, 4), "ci95": [round(lo * k, 4), round(hi * k, 4)]}

    allm = np.ones(int(va.sum()), bool)
    na, nm = n_att[va], n_min[va]
    segs = {"all": allm, "attacker 1-2 UFC fights": na <= 2, "attacker 3-5": (na >= 3) & (na <= 5),
            "attacker 6+": na >= 6, "fight has a 1-2 fight newcomer": nm <= 2, "2024": yrs[va] == 2024,
            "2025": yrs[va] == 2025}
    out = {"n_rows_train": int(tr.sum()), "n_rows_valid": int(va.sum()), "per_target": per, "recipe": recipe,
           "recipe_cv_selected": recipe_sel,
           "n_targets_kept": int(sum(v["keep_emb"] for v in per.values())), "segments": {}}
    for sk, m in segs.items():
        out["segments"][sk] = {"all_targets": mean_rel(m, "all"), "cv_selected": mean_rel(m, "sel")}
        if verbose:
            a_, s_ = out["segments"][sk]["all_targets"], out["segments"][sk]["cv_selected"]
            print("  blend seg %-32s n %5d  all %+.2f%% [%+.2f, %+.2f]  selected %+.2f%% [%+.2f, %+.2f]" % (
                sk, a_["n_rows"], 100 * a_["mean"], 100 * a_["ci95"][0], 100 * a_["ci95"][1], 100 * s_["mean"],
                100 * s_["ci95"][0], 100 * s_["ci95"][1]), flush=True)
    # a few real validation rows for the browser check (inputs: mlrates side + embedding eta; output: blend)
    rng = np.random.default_rng(SEED)
    pick = rng.choice(np.where(va)[0], 12, replace=False)
    out["_check_rows"] = [{"ml": {tn: float(ML[i, k]) for k, tn in enumerate(targets)}, "eta": ETA[i].tolist()}
                          for i in pick]
    return out


def py_blend(recipe, task_index, ml, eta):
    """Python twin of src/ml/embed.js blendMLRates(): mlrates side (target -> rate) + embedding eta -> rates."""
    out = {}
    for tname, r in recipe.items():
        x = float(ml[tname])
        b0, b1, b2 = r["b"]
        if tname == "ctrl":
            z = math.log(max(x / 60.0, 1e-6))
        elif tname == "kd_h":
            z = math.log(min(max(x, 1e-6), 1 - 1e-6))
        elif r["link"] == "logit":
            p = min(max(x, 1e-6), 1 - 1e-6)
            z = math.log(p / (1 - p))
        else:
            z = math.log(max(x, 1e-9))
        e = b0 + b1 * z + b2 * float(eta[task_index[r["task"]]])
        if r["link"] == "logit":
            out[tname] = 1 / (1 + math.exp(-e))
        elif tname == "ctrl":
            out[tname] = 60.0 * math.exp(e)
        elif tname == "kd_h":
            out[tname] = min(math.exp(e), 0.5)
        else:
            out[tname] = math.exp(e)
    return out


STYLE_TASKS = ["d_att", "c_att", "g_att", "h_att", "b_att", "l_att", "ns_att", "td_att", "ctrl", "sub_att"]


def neighbours_v2(D, fin, hp, slugs_of_interest=("alexander-volkanovski", "justin-gaethje"), k=10):
    """Neighbours on the standardised predicted-stat profile (21 offense + 21 defense effects of a fighter's
    embedding on log-rates / logits, each standardised over active fighters), in four views:
      profile_distance          Euclidean distance on the full profile (style and quality together)
      style_cosine_quality_out  cosine after projecting out the profile direction of the linear win head
                                (the 'how good' direction), so dominance alone does not make two men similar
      attempts_cosine           cosine on the offense attempt profile only (what he tries to do: strike volume
                                by position and target, non-sig. strikes, takedown attempts, control, sub attempts)
      profile_distance_145_170  full-profile distance within the 145-170 lb divisions
    Pool: decayed fight count >= NN_MIN_EXPO at 2026-01-01, a fight in 2023-2025, men (both men here are men)."""
    P, A, Dm = fin["P"], fin["A"], fin["D"]
    expo = exposure(D, fin["T"], hp["hl"])
    emb = np.hstack([A, Dm])
    K = A.shape[1]
    Q, so, sdv = nn_metric(P, A, Dm, expo)
    prof = np.array([profile(P, emb[i], so, sdv) for i in range(len(emb))])
    Bm = np.zeros((2 * NT, 2 * K))
    Bm[:NT, :K] = P["W"] / so[:, None]
    Bm[NT:, K:] = P["V"] / sdv[:, None]
    qdir = Bm @ np.linalg.solve(Q + 1e-9 * np.eye(2 * K), np.r_[P["ua"], P["ud"]])
    qdir /= np.linalg.norm(qdir)
    prof_s = prof - np.outer(prof @ qdir, qdir)
    vol = [TI[t] for t in STYLE_TASKS]
    prof_o = prof[:, vol]
    last = np.full(D.F, -1)
    np.maximum.at(last, D.r_x, D.r_day)
    lastdiv = {}
    for r in np.argsort(D.r_day, kind="stable"):
        lastdiv[int(D.r_x[r])] = D.divs[int(D.r_div[r])]
    women = np.array([lastdiv.get(i, "").startswith("Women") for i in range(D.F)])
    active = last >= dt.date(2023, 1, 1).toordinal()
    band = np.array([lastdiv.get(i, "") in ("Featherweight", "Lightweight", "Welterweight") for i in range(D.F)])
    base = (expo >= NN_MIN_EXPO) & active & ~women
    qual = prof @ qdir
    out = {"pool": "decayed fight count >= %.1f at 2026-01-01, a fight in 2023-2025, men" % NN_MIN_EXPO,
           "views": {"profile_distance": "Euclidean distance on the 42-effect standardised profile (style + quality)",
                     "style_cosine_quality_out": "cosine after removing the profile direction of the linear win head",
                     "attempts_cosine": "cosine on the offense attempt effects only: " + ", ".join(STYLE_TASKS),
                     "profile_distance_145_170": "profile distance within Featherweight / Lightweight / Welterweight"},
           "quality_share_of_profile_variance": round(float((qual[base] ** 2).sum() / (prof[base] ** 2).sum()), 3)}

    def cosv(X, i):
        n = np.linalg.norm(X, axis=1) + 1e-12
        return X @ X[i] / (n * n[i])

    for sl in slugs_of_interest:
        i = D.slug_idx[sl]
        dist = np.linalg.norm(prof - prof[i], axis=1)
        rec = {}
        for key, m, score, asc in (("profile_distance", base, dist, True),
                                   ("style_cosine_quality_out", base, cosv(prof_s, i), False),
                                   ("attempts_cosine", base, cosv(prof_o, i), False),
                                   ("profile_distance_145_170", base & band, dist, True)):
            mm = m.copy()
            mm[i] = False
            cand = np.where(mm)[0]
            o = cand[np.argsort(score[cand] if asc else -score[cand], kind="stable")][:k]
            rec[key] = [[D.slug[j], round(float(score[j]), 3), lastdiv.get(int(j), "")] for j in o]
        rec["quality_score_sd_units"] = round(float(qual[i] / qual[base].std()), 2)
        rec["attempt_profile"] = {t: round(float(prof[i][TI[t]]), 2) for t in STYLE_TASKS}
        order = np.argsort(-np.abs(prof_s[i]))[:8]
        rec["style_signature_quality_out"] = [[("off " if j < NT else "def ") + TN[j % NT], round(float(prof_s[i][j]), 2)]
                                              for j in order]
        rec["expo"] = round(float(expo[i]), 3)
        out[sl] = rec
    out["_style_model"] = {"tasks": STYLE_TASKS, "so": [round(float(so[t]), 8) for t in vol]}
    return out


def py_style_neighbours(M, slug, k):
    """Python twin of src/ml/embed.js neighbours(slug, k, {mode: "style"}): cosine on the standardised offense
    attempt profile (W[tasks] . o / so) over roster fighters with expo >= nn_min_expo (no activity filter)."""
    ti = {t[0]: i for i, t in enumerate(M["tasks"])}
    W = np.array(M["W"])
    rows = [ti[t] for t in M["nn_style"]["tasks"]]
    so = np.array(M["nn_style"]["so"])
    K = M["K"]
    me = np.array(M["roster"][slug][0][:K])
    pm = W[rows] @ me / so
    nm = np.linalg.norm(pm) + 1e-12
    res = []
    for sl, (e, x) in M["roster"].items():
        if sl == slug or x < M["nn_min_expo"]:
            continue
        p = W[rows] @ np.array(e[:K]) / so
        res.append((sl, float(p @ pm / ((np.linalg.norm(p) + 1e-12) * nm))))
    res.sort(key=lambda r: (-r[1], r[0]))
    return [[a, b] for a, b in res[:k]]


def leak_check(D, cache, hp, verbose=True):
    """Empirical look-ahead test on the 2024-2025 snapshots (uncalibrated chunk-2 walk, quarter loadings of the
    fight): score each directed row of fight f with the attacker's pre-fight embedding (the one exported for f)
    and with his embedding at his next fight g (which has seen f). If the exported snapshots had seen f, the two
    would score alike; an honest walk-forward scores clearly worse before the fight than after it. Also checks
    that the exposure behind every 2024-25 snapshot equals the decayed count of strictly earlier stat fights."""
    w = _load(_pk(cache, "walk_2.pkl"))
    snaps = w["fight"]
    lo, hi = VALID[0].toordinal(), VALID[1].toordinal()
    nxt = {}           # (fighter, fight day) -> vector at his next recorded fight
    by_f = defaultdict(list)
    for fid, v in snaps.items():
        j = D.fid_idx.get(fid)
        if j is None:
            continue
        for x, e in ((int(D.f_a[j]), v[1]), (int(D.f_b[j]), v[2])):
            by_f[x].append((int(D.f_day[j]), e))
    for x, l in by_f.items():
        l.sort(key=lambda r: r[0])
        for (d0, _), (d1, e1) in zip(l, l[1:]):
            if d1 > d0:
                nxt[(x, d0)] = e1
    K = w["final"]["A"].shape[1]
    dev = {"ctx": np.zeros(NT), "pre": np.zeros(NT), "post": np.zeros(NT)}
    n_rows, bad_expo, n_expo = 0, 0, 0
    for r in range(len(D.r_fight)):
        day = int(D.r_day[r])
        if not (lo <= day < hi):
            continue
        fid = D.f_id[D.r_fight[r]]
        v = snaps.get(fid)
        if v is None:
            continue
        j = D.fid_idx[fid]
        x, y_ = int(D.r_x[r]), int(D.r_y[r])
        side = int(D.r_side[r])
        ex, ey = (v[1], v[2]) if side == 0 else (v[2], v[1])
        # exposure check: decayed count of strictly earlier stat fights at the fight day
        want = float((np.exp(-math.log(2) / hp["hl"] * (day - D.r_day)) * ((D.r_x == x) & (D.r_day < day))).sum())
        got = float(v[3] if side == 0 else v[4])
        n_expo += 1
        bad_expo += abs(want - got) > 1e-6
        post = nxt.get((x, day))
        if post is None:
            continue
        P = w["quarters"][int(v[0])]["P"]
        Z = ctx_rows([int(D.r_div[r])], [float(D.r_era[r])], [float(D.r_five[r])], D.NDIV)[0]
        ctx = P["C"] @ Z
        dfn = P["V"] @ ey[K:]
        e_pre = ctx + P["W"] @ ex[:K] + dfn
        e_post = ctx + P["W"] @ post[:K] + dfn
        for t in range(NT):
            yv, nv = D.Y[r, t], D.E[r, t]
            if nv <= 0:
                continue
            b = bool(IS_BIN[t])
            for key, e in (("ctx", ctx[t] + dfn[t]), ("pre", e_pre[t]), ("post", e_post[t])):
                dev[key][t] += float(_dev1(np.array([yv]), np.array([nv]), np.array([e]), b)[0])
        n_rows += 1
    rel_pre = dev["pre"] / dev["ctx"]
    rel_post = dev["post"] / dev["ctx"]
    out = {"n_rows": n_rows, "mean_rel_dev_pre": round(float(rel_pre.mean()), 4),
           "mean_rel_dev_post": round(float(rel_post.mean()), 4),
           "note": "relative to the defender-only predictor (attacker vector zero); pre = exported snapshot, post = "
                   "the attacker's vector at his next fight (has seen this fight)",
           "per_task_pre": {TN[t]: round(float(rel_pre[t]), 4) for t in range(NT)},
           "per_task_post": {TN[t]: round(float(rel_post[t]), 4) for t in range(NT)},
           "exposure_rows_checked": n_expo, "exposure_mismatches": int(bad_expo)}
    if verbose:
        print("  leak check: %d directed rows; mean rel. deviance vs attacker-zero: pre %.4f, post %.4f; exposure "
              "mismatches %d / %d" % (n_rows, rel_pre.mean(), rel_post.mean(), bad_expo, n_expo), flush=True)
    return out


def stage_extras(D, hp, cache, verbose=True):
    st = _load(_pk(cache, "eval_state.pkl"))
    T, win_preds, fin = st["T"], st["win_preds"], st["walk_final"]
    integ = eval_integration(T, verbose)
    wseg = eval_winner_segments(T, win_preds, verbose)
    blend = eval_mlrates_blend(T, D, verbose)
    nn2 = neighbours_v2(D, fin, hp)
    leak = leak_check(D, cache, hp, verbose)
    if verbose:
        for sl in ("alexander-volkanovski", "justin-gaethje"):
            for key in ("profile_distance", "style_cosine_quality_out", "attempts_cosine", "profile_distance_145_170"):
                print("  %s %s: %s" % (sl, key, ", ".join("%s (%.2f)" % (a, b) for a, b, _ in nn2[sl][key][:6])))
    # merge into the outputs
    J = json.load(open(OUT_JSON))
    M = json.load(open(OUT_MODEL))
    # guard (the chunk-2 quarter-index bug): each snapshot's refit must be the latest quarter before the fight
    qT = [dt.date.fromisoformat(q["T"]).toordinal() for q in J["quarters"]]
    dates = {e["id"]: dt.date.fromisoformat(e["date"]).toordinal() for e in json.load(open(BACKTEST_DEV))["fights"]}
    badq = sum(1 for fid, r in J["snapshots"].items()
               if not (qT[r["q"]] <= dates[fid] and (r["q"] + 1 >= len(qT) or dates[fid] < qT[r["q"] + 1])))
    assert badq == 0, "%d snapshots point at the wrong quarterly refit" % badq
    J["validation"]["integration"] = integ
    J["validation"]["winner_segments"] = wseg
    J["validation"]["leak_check"] = leak
    checks = blend.pop("_check_rows")
    J["validation"]["stats"]["mlrates_blend"] = blend
    style_model = nn2.pop("_style_model")
    J["neighbours_v2"] = nn2
    task_index = {t: i for i, t in enumerate(TN)}
    M["mlrates_blend"] = {"note": "link(rate) = b0 + b1 link(mlrates rate) + b2 eta_embedding[task], every target; fit "
                                  "on mlrates 2019-2023 out-of-fold rows; validated once on 2024-2025 (mean relative "
                                  "deviance change in research/model_embed.md). targets_cv_selected (b2 = 0 where "
                                  "leave-one-year-out CV inside 2019-2023 rejected the term) scored worse on validation.",
                          "targets": blend["recipe"], "targets_cv_selected": blend["recipe_cv_selected"]}
    M["blend_check"] = [{"ml": c["ml"], "eta": [round(float(x), 10) for x in c["eta"]],
                         "out": py_blend(blend["recipe"], task_index,
                                         c["ml"], [round(float(x), 10) for x in c["eta"]])} for c in checks]
    M["nn_style"] = style_model
    M["nn_style_check"] = {sl: py_style_neighbours(M, sl, 8) for sl in ("alexander-volkanovski", "justin-gaethje")}
    J["meta"]["extras_built"] = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    with open(OUT_JSON, "w") as fh:
        json.dump(J, fh, separators=(",", ":"))
    with open(OUT_MODEL, "w") as fh:
        json.dump(M, fh, separators=(",", ":"))
    print("merged extras into %s and %s" % (OUT_JSON, OUT_MODEL), flush=True)


# ------------------------------------------------------------------------------------------------ driver
CV_GRID = [dict(lam=30.0, hl=730.0), dict(lam=15.0, hl=730.0), dict(lam=60.0, hl=730.0), dict(lam=30.0, hl=1460.0),
           dict(lam=30.0, hl=730.0, lam_d=2.0), dict(lam=30.0, hl=730.0, win_w=4.0), dict(lam=30.0, hl=365.0)]
HP_BASE = dict(K=8, win_w=1.0, lam_head=10.0)
CHUNKS = {1: (dt.date(2010, 1, 1), dt.date(2018, 1, 1)), 2: (dt.date(2018, 1, 1), dt.date(2026, 1, 1))}


def cv_score(rec):
    """Selection score: mean relative deviance over the 21 tasks + win log loss / ln 2 (equal weight)."""
    return rec["mean_rel"] + rec["win_ll"] / math.log(2)


def _pk(cache, name):
    return os.path.join(cache, name)


def _load(path):
    import pickle
    with open(path, "rb") as fh:
        return pickle.load(fh)


def _save(obj, path):
    import pickle
    with open(path + ".tmp", "wb") as fh:
        pickle.dump(obj, fh)
    os.replace(path + ".tmp", path)


def stage_noise(D, cache):
    path = _pk(cache, "noise.pkl")
    if os.path.exists(path):
        return _load(path)
    noise = {"k": np.where(IS_NB, 5.0, np.inf), "rho": np.where(IS_BIN, 0.01, 0.0)}
    T0, T1 = dt.date(2016, 1, 1).toordinal(), dt.date(2017, 1, 1).toordinal()
    for _ in range(2):        # fit at 2016-01-01, moment-match on 2016 fights, refit with the estimate, repeat
        f = Fit(D, T0, dict(HP_BASE, lam=30.0, hl=730.0), noise, max_sweeps=15)
        idx, _ = heldout_rows(D, T0, T1)
        noise = estimate_noise(D, f.P, idx)
    _save(noise, path)
    return noise


def stage_cv(D, noise, cache, grid, quick=False):
    dates = refit_dates(TRAIN[0], TRAIN[1], "year" if quick else "half")
    until = TRAIN[1].toordinal()
    bpath = _pk(cache, "cv_base_%s.pkl" % ("q" if quick else "h"))
    base = _load(bpath) if os.path.exists(bpath) else baseline_dev(D, noise, dates, until)
    _save(base, bpath)
    rpath = _pk(cache, "cv_results.jsonl")
    done = {}
    if os.path.exists(rpath):
        for line in open(rpath):
            r = json.loads(line)
            done[r["key"]] = r
    out = []
    for g in grid:
        hp = dict(HP_BASE, **g)
        key = json.dumps(hp, sort_keys=True)
        if key in done:
            out.append(done[key])
            continue
        t = time.time()
        r = walk_forward(D, hp, noise, dates, until, baseline=base, verbose=False,
                         sweeps_warm=5 if quick else 10)
        rel = r["dev"] / r["base"]
        rec = {"key": key, "hp": hp, "mean_rel": float(rel.mean()), "rel": rel.round(4).tolist(),
               "win_ll": float(r["win_ll"].mean()), "n_win": int(len(r["win_ll"])), "secs": round(time.time() - t)}
        with open(rpath, "a") as fh:
            fh.write(json.dumps(rec) + "\n")
        print("CV %s mean_rel %.4f win_ll %.4f score %.4f (%ds)" % (key, rec["mean_rel"], rec["win_ll"],
                                                                   cv_score(rec), rec["secs"]), flush=True)
        out.append(rec)
    return out


def stage_walk(D, noise, hp, cache, chunk):
    path = _pk(cache, "walk_%d.pkl" % chunk)
    if os.path.exists(path):
        w = _load(path)
        if w["hp"] == hp:
            return w
    s, e = CHUNKS[chunk]
    w = production_walk(D, hp, noise, s, e, tag="chunk%d" % chunk)
    _save(w, path)
    return w


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--cache", default=os.path.join(os.environ.get("TMPDIR", "/tmp"), "embed_cache"),
                    help="directory for intermediate pickles (noise, CV, walks)")
    ap.add_argument("--quick", action="store_true", help="yearly CV refits, 2-config grid")
    ap.add_argument("--skip-cv", action="store_true", help="use the CV results already in the cache / embed.json")
    ap.add_argument("--stage", default="all", choices=["noise", "cv", "walk", "eval", "extras", "all"],
                    help="run up to this stage (walk with --chunk runs one chunk only, for two parallel processes)")
    ap.add_argument("--chunk", type=int, default=0, help="1 = 2010-2017, 2 = 2018-2025 (default both)")
    ap.add_argument("--reuse-eval", action="store_true", help="reuse the cached downstream results (re-export only)")
    args = ap.parse_args()
    os.makedirs(args.cache, exist_ok=True)
    t0 = time.time()
    D = load_data()
    noise = stage_noise(D, args.cache)
    print("noise: NB k %s | beta-binomial rho %s" % (
        {TN[i]: round(float(noise["k"][i]), 2) for i in range(NT) if IS_NB[i]},
        {TN[i]: round(float(noise["rho"][i]), 4) for i in range(NT) if IS_BIN[i]}), flush=True)
    if args.stage == "noise":
        return
    grid = CV_GRID[:2] if args.quick else CV_GRID
    if args.skip_cv:
        rpath = _pk(args.cache, "cv_results.jsonl")
        cv = [json.loads(line) for line in open(rpath)] if os.path.exists(rpath) else \
            [{"hp": json.load(open(OUT_JSON))["meta"]["hyperparameters"], "mean_rel": 0.0, "win_ll": 0.0}]
    else:
        cv = stage_cv(D, noise, args.cache, grid, args.quick)
    best = min(cv, key=cv_score)
    hp = best["hp"]
    print("chosen hyperparameters: %s (score %.4f)" % (hp, cv_score(best)), flush=True)
    if args.stage == "cv":
        return
    if args.stage == "extras":
        stage_extras(D, hp, args.cache)
        return
    chunks = [args.chunk] if args.chunk else [1, 2]
    walks = {c: stage_walk(D, noise, hp, args.cache, c) for c in chunks}
    if args.stage == "walk" or args.chunk:
        return
    walk = stitch_and_orient(walks[1], walks[2], D, hp)
    entries, priors = snapshot_table(D)
    T = build_table(entries, priors, walk_lookup(walk), D)
    print("downstream table: %d fights (%d train <= 2023, %d validation 2024-25)" % (
        len(T["id"]), int((T["year"] <= 2023).sum()), int((T["year"] >= 2024).sum())), flush=True)
    cal, cal_val = calibrate_tasks(T, D)
    apply_calibration(walk, cal)
    walk["calibration"] = {"per_task": {TN[t]: {"c": round(float(cal["c"][t]), 4), "s_off": round(float(cal["s_off"][t]), 4),
                                                "s_def": round(float(cal["s_def"][t]), 4)} for t in range(NT)},
                           "s_win": round(cal["s_win"], 4), "validation": cal_val}
    T = build_table(entries, priors, walk_lookup(walk), D)
    epath = _pk(args.cache, "eval.pkl")
    if args.reuse_eval and os.path.exists(epath):
        win_res, win_preds, stat_res = _load(epath)
    else:
        win_res, win_preds = eval_winner(T)
        win_res["ml_stack"] = eval_ml_stack(T)
        stat_res = eval_stats(T)
        stat_res["mlrates_stack"] = eval_mlrates_stack(T, D)
        _save((win_res, win_preds, stat_res), epath)
    write_outputs(D, noise, hp, cv, walk, T, win_res, win_preds, stat_res, time.time() - t0, args.cache)


if __name__ == "__main__":
    main()
