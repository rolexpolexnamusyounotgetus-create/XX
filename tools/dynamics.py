#!/usr/bin/env python3
"""
dynamics.py - v6 FIGHT DYNAMICS fits from round-level UFC stats.

Five studies, all walk-forward (fit on fights 2019-01-01..2023-12-31, report on 2024-01-01..snapshot;
2010-2018 used only as a labeled robustness extension, never the test period):

  1. state effects: output (sig attempts / min), accuracy, takedown attempts and control in round r as a
     function of what happened earlier in the same fight (head strikes and knockdowns absorbed, own output,
     control time both ways, takedowns), round number and 3- vs 5-round format;
  2. per-fighter late-round output ratios with hierarchical (empirical-Bayes) shrinkage, and a held-out test
     of whether past ratios predict future ones (vs the engine's current kPace rule);
  3. between-round adaptation: does losing round r (judges' consensus from the cards where known, or the
     sig-strike differential) change output, takedown attempts or accuracy in round r+1;
  4. momentum after knockdowns: next-round rates of the scorer and of the man who was dropped;
  5. finish hazard vs accumulated damage: knockdowns per landed standing head strike, knockdown-to-finish
     conversion and non-knockdown stoppages as functions of damage absorbed in earlier rounds, with a
     gamma frailty per fighter-fight (the engine's fight-night form draws play that role).

Estimators: the dynamic random-effects models use the z-transform likelihood (covariates that are
functions of earlier-round outcomes are predetermined; the process starts fresh in round 1, so there is no
initial-conditions problem). Naive within-fight fixed-effects fits are reported next to them to show the
mean-reversion bias they carry. A round-level simulator (null and fitted) checks that the fitted models
reproduce the held-out auxiliary statistics.

Inputs:  data/raw/*.csv (via tools/baserates.load_data and tools/build_db people resolution),
         data/derived/backtest.json (engine pace fields, for the kPace check)
Outputs: data/derived/dynamics.json; tables printed; the report is research/model_dynamics.md

Usage:   python3 tools/dynamics.py            (about 2-4 minutes)
         python3 tools/dynamics.py --quick    (skips bootstrap and simulation checks)
"""
import argparse
import datetime as dt
import json
import math
import os
import sys
import time
from collections import defaultdict

import numpy as np
import pandas as pd
from scipy import optimize, special, stats

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import baserates as br  # noqa: E402
import build_db as bd   # noqa: E402

OUT_JSON = os.path.join(ROOT, "data", "derived", "dynamics.json")
FMT3, FMT5 = br.FMT3, br.FMT5
TRAIN = ("2019-01-01", "2023-12-31")
EXT = ("2010-01-01", "2018-12-31")
TEST = ("2024-01-01", "2099-12-31")
RNG = np.random.default_rng(20261106)


# ================================================================================================
# panel
# ================================================================================================
def build_panel():
    """One row per fighter-round with outcomes, opponent outcomes, cumulative (earlier-round) state and
    lagged round results. Only 3x5 and 5x5 formats."""
    F, S, notes, data_max = br.load_data(os.path.join(ROOT, "data", "raw"), "2001-01-01")
    F = F[F.has_stats & F.fmt.isin([FMT3, FMT5])].copy()
    S = S[S.fid.isin(F.fid)].copy()
    # people ids (namesakes resolved by build_db)
    log = {}
    fights, _ = bd.parse_fights(log)
    bd.build_people(fights, log)
    pid = {}
    for f in fights:
        if f.persons:
            pid[(f.fid, 0)] = f.persons[0]
            pid[(f.fid, 1)] = f.persons[1]
    F["fkey"] = F.fid.map(bd.url_id)
    S["fkey"] = S.fid.map(bd.url_id)
    S["pid"] = [pid.get((k, i)) for k, i in zip(S.fkey, S.idx)]
    S["opid"] = [pid.get((k, 1 - i)) for k, i in zip(S.fkey, S.idx)]
    S = S.merge(F[["fid", "DATE", "division", "title", "five", "ko_target", "ko_pos", "METHOD", "det", "REFEREE"]],
                on="fid", how="left")
    S["R"] = np.where(S.five, 5, 3)
    S = S.sort_values(["DATE", "fid", "idx", "rnd"]).reset_index(drop=True)
    # standing head landed (ufcstats does not cross head x position): midpoint of the bounds, as baserates
    for p in ("", "o_"):
        pass
    lo = (S.head_l - S.ground_l).clip(lower=0)
    hi = np.minimum(S.head_l, S.dist_l + S.clinch_l)
    S["sh_l"] = (lo + hi) / 2
    O = S[["fid", "rnd", "idx", "sh_l", "head_a", "sig_a", "tot_a", "dist_a", "clinch_a", "ground_a", "body_a",
           "leg_a"]].copy()
    O["idx"] = 1 - O["idx"]
    O = O.rename(columns={c: "o_" + c for c in ["sh_l", "head_a", "sig_a", "tot_a", "dist_a", "clinch_a",
                                                "ground_a", "body_a", "leg_a"]})
    S = S.drop(columns=[c for c in ["o_sig_a", "o_tot_a"] if c in S.columns]).merge(O, on=["fid", "rnd", "idx"],
                                                                                   how="left")
    S["mins"] = S.rsec / 60.0
    S["full"] = S.rsec >= 300
    S["last"] = S.rnd == S.end_round
    # fight end, from the point of view of the row's fighter
    won = S.winner == S.idx
    lost = S.winner == (1 - S.idx)
    ko = S.cat.eq("KO/TKO")
    strikes = S.ko_kind.eq("strikes")
    S["fin_ko_against"] = (S["last"] & ko & strikes & lost).astype(int)    # stopped by strikes (KO/TKO/GNP)
    S["fin_ko_for"] = (S["last"] & ko & strikes & won).astype(int)
    S["fin_sub_against"] = (S["last"] & S.cat.eq("SUB") & lost).astype(int)
    S["fin_sub_for"] = (S["last"] & S.cat.eq("SUB") & won).astype(int)
    S["fin_other_against"] = (S["last"] & ko & ~strikes & lost).astype(int)  # doctor, corner, injury
    S["fin_ground"] = S.ko_pos.eq("ground") if "ko_pos" in S else False
    # cumulative state before the round (same fight, same fighter): sums over earlier rounds
    cum_src = {
        "c_att": "sig_a", "c_tot": "tot_a", "c_lnd": "sig_l", "c_hl": "head_l", "c_tda": "td_a", "c_tdl": "td_l",
        "c_ctrl": "ctrl", "c_kd": "kd", "c_sub": "sub",
        "c_oatt": "o_sig_a", "c_ohl": "o_head_l", "c_osl": "o_sig_l", "c_osh": "o_sh_l", "c_obl": "o_body_l",
        "c_oll": "o_leg_l", "c_ogl": "o_ground_l", "c_okd": "o_kd", "c_otdl": "o_td_l", "c_otda": "o_td_a",
        "c_octrl": "o_ctrl", "c_osub": "o_sub", "c_otot": "o_tot_l",
    }
    g = S.groupby(["fid", "idx"], sort=False)
    for c, src in cum_src.items():
        S[c] = g[src].cumsum() - S[src]
    S["c_min"] = g["mins"].cumsum() - S["mins"]
    # lagged (previous round) quantities
    lag_src = {"l_sigl": "sig_l", "l_osigl": "o_sig_l", "l_att": "sig_a", "l_oatt": "o_sig_a", "l_kd": "kd",
               "l_okd": "o_kd", "l_hl": "head_l", "l_ohl": "o_head_l", "l_tdl": "td_l", "l_otdl": "o_td_l",
               "l_ctrl": "ctrl", "l_octrl": "o_ctrl", "l_tda": "td_a", "l_acc_l": "sig_l", "l_sub": "sub",
               "l_osub": "o_sub", "l_bl": "body_l", "l_ll": "leg_l", "l_obl": "o_body_l", "l_oll": "o_leg_l"}
    for c, src in lag_src.items():
        S[c] = g[src].shift(1)
    S["year"] = S.DATE.dt.year
    S["period"] = np.select([(S.DATE >= TRAIN[0]) & (S.DATE <= TRAIN[1]), (S.DATE >= TEST[0]),
                             (S.DATE >= EXT[0]) & (S.DATE <= EXT[1])], ["train", "test", "ext"], "old")
    return F, S, notes


# ================================================================================================
# judges' round labels
# ================================================================================================
def card_rounds_lost(cards, R):
    """cards: list of (name, loser_total, winner_total). Returns per card k = rounds the FIGHT LOSER won,
    assuming no 10-10 rounds and no 10-8 against the fight winner; None where inconsistent."""
    out = []
    for _, lt, wt in cards:
        k = 10 * R - wt
        e = 9 * R + k - lt     # 10-8 rounds won by the fight winner
        out.append(k if (0 <= k <= R and 0 <= e <= R) else None)
    return out


def judge_labels(F, S, coef):
    """Soft label P(fighter lost round r on a judge's card), averaged over the three judges, for decisions that
    went the distance. Which round(s) the loser won on a card is inferred from round stats with the round
    logistic model (coef): P(subset A) proportional to prod_{r in A} odds_r(loser) over subsets of size k."""
    from itertools import combinations
    d = F[F.cat.isin(["U-DEC", "S-DEC", "M-DEC"]) & (F.end_round == F.sched) & (F.end_sec == 300)].copy()
    d["cards"] = d.det.map(br.parse_cards)
    d = d[d.cards.map(len) == 3]
    feats = list(coef.keys())
    s = S[S.fid.isin(d.fid)].copy()
    s["ctrl_min"] = s.ctrl / 60
    o = s.copy()
    lab = {}
    piv = {}
    for (fid, idx), x in s.groupby(["fid", "idx"]):
        piv[(fid, idx)] = x.sort_values("rnd")
    nk = 0
    sure = {}
    for r in d.itertuples(index=False):
        R = int(r.sched)
        W, L = int(r.winner), 1 - int(r.winner)
        if (r.fid, W) not in piv or (r.fid, L) not in piv:
            continue
        xw, xl = piv[(r.fid, W)], piv[(r.fid, L)]
        if len(xw) != R or len(xl) != R:
            continue
        diff = np.zeros(R)
        for f_, c_ in coef.items():
            col = f_
            diff += c_ * (xl[col].to_numpy() - xw[col].to_numpy())
        odds = np.exp(np.clip(diff, -30, 30))      # odds that the fight loser won each round
        ks = card_rounds_lost(r.cards, R)
        if any(k is None for k in ks):
            continue
        nk += 1
        pl = np.zeros(R)
        for k in ks:
            if k == 0:
                continue
            subs = list(combinations(range(R), k))
            w = np.array([np.prod(odds[list(A)]) for A in subs])
            w /= w.sum()
            for A, wa in zip(subs, w):
                pl[list(A)] += wa
        pl /= 3.0                      # share of judges who gave round r to the fight loser
        for rr in range(R):
            lab[(r.fid, L, rr + 1)] = pl[rr]          # P(fight loser WON round) -> loser lost round w.p. 1-pl
            lab[(r.fid, W, rr + 1)] = 1 - pl[rr]
        sure[r.fid] = all(k == 0 for k in ks)
    # lab[(fid, idx, rnd)] = expected share of judges that gave the round to fighter idx
    return lab, sure, nk


def fit_round_logit(S, F, period):
    """Round-winner logistic on clean sweeps (all cards 30-27 / 50-45) from the given period only."""
    d = F[F.cat.isin(["U-DEC"]) & (F.end_round == F.sched) & (F.end_sec == 300) &
          (F.DATE >= period[0]) & (F.DATE <= period[1])].copy()
    d["cards"] = d.det.map(br.parse_cards)
    d = d[d.cards.map(len) == 3]
    d = d[[all(card_rounds_lost(c, int(R)) == [0, 0, 0]) and len(c) == 3 for c, R in zip(d.cards, d.sched)]]
    feats = ["head_l", "body_l", "leg_l", "kd", "td_l", "ctrl_min", "sub"]
    s = S[S.fid.isin(d.fid)].copy()
    s["ctrl_min"] = s.ctrl / 60
    a = s.set_index(["fid", "rnd", "idx"])[feats]
    rows, ys = [], []
    for r in d.itertuples(index=False):
        W = int(r.winner)
        for rr in range(1, int(r.sched) + 1):
            try:
                xw = a.loc[(r.fid, rr, W)].to_numpy(float)
                xl = a.loc[(r.fid, rr, 1 - W)].to_numpy(float)
            except KeyError:
                continue
            rows.append(xw - xl); ys.append(1.0)
            rows.append(xl - xw); ys.append(0.0)
    X, y = np.array(rows), np.array(ys)
    beta, se, ll, _ = br.logit_fit(X, y, ridge=1e-3)
    return dict(zip(feats, beta)), dict(zip(feats, se)), len(d)



# ================================================================================================
# estimators
# ================================================================================================
class DynRE:
    """Dynamic bivariate random-effects Gaussian model for one round-level outcome of both fighters.

        y[f,i,r] = mu[cell(f,r)] + x[f,i,r]' gamma + a[f,i] + b[f,r] + e[f,i,r] + m[f,i,r]

    a: fighter-in-fight effect (sd sa, corr rho between the two fighters: shared fight pace),
    b: round shock shared by both (sd sb), e: AR(1) round noise per fighter (sd se, phi),
    m: measurement noise with known variance v (count / binomial noise).
    x may hold functions of earlier-round outcomes (predetermined). The z-transform y - x'gamma has a unit
    triangular Jacobian, so the Gaussian likelihood of z is the exact likelihood; (mu, gamma) are profiled
    out by GLS and the five variance parameters are found by ML."""

    def __init__(self, df, ycol, vcol, xcols, cellcol="cell", fixed_cells=None):
        df = df.sort_values(["fid", "idx", "rnd"])
        self.xcols = list(xcols)
        cells = sorted(df[cellcol].unique()) if fixed_cells is None else fixed_cells
        self.cells = cells
        ci = {c: k for k, c in enumerate(cells)}
        self.k = len(cells) + len(self.xcols)
        groups = defaultdict(list)
        for fid, x in df.groupby("fid", sort=False):
            rr = sorted(set(x.rnd[x.idx == 0]) & set(x.rnd[x.idx == 1]))
            if not rr:
                continue
            x = x[x.rnd.isin(rr)]
            T = len(rr)
            if x.rnd.max() - x.rnd.min() + 1 != T:      # need consecutive rounds starting anywhere
                continue
            groups[T].append(x)
        self.batches = {}
        for T, xs in groups.items():
            n = len(xs)
            Y = np.zeros((n, 2 * T)); V = np.zeros((n, 2 * T)); X = np.zeros((n, 2 * T, self.k))
            fids = []
            for q, x in enumerate(xs):
                x = x.sort_values(["idx", "rnd"])
                Y[q] = x[ycol].to_numpy(float)
                V[q] = x[vcol].to_numpy(float)
                cc = x[cellcol].map(ci).to_numpy()
                X[q, np.arange(2 * T), cc] = 1.0
                if self.xcols:
                    X[q, :, len(cells):] = x[self.xcols].to_numpy(float)
                fids.append(x.fid.iloc[0])
            self.batches[T] = (Y, V, X, fids)
        self.n_obs = sum(2 * T * len(b[3]) for T, b in self.batches.items())
        self.n_fights = sum(len(b[3]) for b in self.batches.values())

    @staticmethod
    def base_cov(T, th):
        sa, rho, sb, se, phi = th
        J = np.ones((T, T))
        Ka = np.kron(np.array([[1, rho], [rho, 1]]), J)
        Kb = np.kron(np.ones((2, 2)), np.eye(T))
        lag = np.abs(np.subtract.outer(np.arange(T), np.arange(T)))
        Ke = np.kron(np.eye(2), phi ** lag)
        return sa ** 2 * Ka + sb ** 2 * Kb + se ** 2 * Ke

    @staticmethod
    def unpack(p):
        return (math.exp(p[0]), math.tanh(p[1]), math.exp(p[2]), math.exp(p[3]), math.tanh(p[4]))

    def _accum(self, th, batches=None):
        batches = self.batches if batches is None else batches
        A = np.zeros((self.k, self.k)); c = np.zeros(self.k); ld = 0.0; yy = 0.0
        store = {}
        for T, (Y, V, X, _) in batches.items():
            Sg = self.base_cov(T, th)[None] + V[:, :, None] * np.eye(2 * T)[None]
            L = np.linalg.cholesky(Sg)
            Xs = np.linalg.solve(L, X)
            ys = np.linalg.solve(L, Y[:, :, None])[:, :, 0]
            A += np.einsum("nik,nil->kl", Xs, Xs)
            c += np.einsum("nik,ni->k", Xs, ys)
            ld += 2 * np.log(np.diagonal(L, axis1=1, axis2=2)).sum()
            yy += (ys ** 2).sum()
            store[T] = (Xs, ys)
        return A, c, ld, yy, store

    def negll(self, p):
        th = self.unpack(p)
        try:
            A, c, ld, yy, _ = self._accum(th)
            beta = np.linalg.solve(A + 1e-9 * np.eye(self.k), c)
        except np.linalg.LinAlgError:
            return 1e12
        q = yy - 2 * beta @ c + beta @ A @ beta
        return 0.5 * (ld + q + self.n_obs * math.log(2 * math.pi))

    def fit(self, p0=None):
        p0 = np.array([math.log(0.3), 0.5, math.log(0.1), math.log(0.3), 0.3]) if p0 is None else p0
        r = optimize.minimize(self.negll, p0, method="Nelder-Mead",
                              options={"maxiter": 4000, "xatol": 1e-5, "fatol": 1e-4})
        r = optimize.minimize(self.negll, r.x, method="L-BFGS-B")
        self.p = r.x
        self.th = self.unpack(r.x)
        A, c, ld, yy, store = self._accum(self.th)
        Ainv = np.linalg.inv(A)
        self.beta = Ainv @ c
        # cluster-robust (by fight) sandwich on the GLS scores
        M = np.zeros((self.k, self.k))
        for T, (Xs, ys) in store.items():
            res = ys - Xs @ self.beta
            sc = np.einsum("nik,ni->nk", Xs, res)
            M += sc.T @ sc
        self.cov_model = Ainv
        self.cov_rob = Ainv @ M @ Ainv
        self.ll = -self.negll(self.p)
        return self

    def coef(self):
        names = ["cell:" + c for c in self.cells] + self.xcols
        se = np.sqrt(np.diag(self.cov_rob))
        return {n: (float(b), float(s)) for n, b, s in zip(names, self.beta, se)}

    def gamma(self):
        k0 = len(self.cells)
        se = np.sqrt(np.diag(self.cov_rob))[k0:]
        return {n: {"est": float(b), "se": float(s)} for n, b, s in zip(self.xcols, self.beta[k0:], se)}

    def var_components(self):
        sa, rho, sb, se, phi = self.th
        return {"sd_fighter_fight": sa, "corr_fighters": rho, "sd_round_shared": sb, "sd_round_own": se,
                "ar1_round_own": phi}

    def predictive(self, other, beta=None, th=None):
        """One-step-ahead predictive log-likelihood and squared error on another DynRE dataset (same columns),
        with parameters fixed: for each fight, each round r >= 2 of both fighters given all earlier rounds
        (and the same round of the other fighter is NOT used). Returns sums and counts."""
        beta = self.beta if beta is None else beta
        th = self.th if th is None else th
        ll = 0.0; se2 = 0.0; n = 0; ll1 = 0.0; n1 = 0
        for T, (Y, V, X, _) in other.batches.items():
            Sg = self.base_cov(T, th)[None] + V[:, :, None] * np.eye(2 * T)[None]
            mu = X @ beta
            # order: idx0 rounds 0..T-1, idx1 rounds 0..T-1
            for r in range(T):
                past = [q for q in range(T) if q < r] + [T + q for q in range(T) if q < r]
                for i in (0, 1):
                    t = i * T + r
                    if past:
                        S_pp = Sg[:, past][:, :, past]
                        S_tp = Sg[:, t, past]
                        w = np.linalg.solve(S_pp, S_tp[:, :, None])[:, :, 0]
                        m = mu[:, t] + np.einsum("np,np->n", w, Y[:, past] - mu[:, past])
                        v = Sg[:, t, t] - np.einsum("np,np->n", w, S_tp)
                    else:
                        m = mu[:, t]; v = Sg[:, t, t]
                    lp = -0.5 * (np.log(2 * np.pi * v) + (Y[:, t] - m) ** 2 / v)
                    if r >= 1:
                        ll += lp.sum(); se2 += ((Y[:, t] - m) ** 2).sum(); n += len(m)
                    else:
                        ll1 += lp.sum(); n1 += len(m)
        return {"ll_r2plus": ll, "n_r2plus": n, "mse_r2plus": se2 / max(n, 1), "ll_r1": ll1, "n_r1": n1}


def logit(p):
    return np.log(p / (1 - p))



class FrailPois:
    """Poisson counts with a gamma frailty (mean 1, variance alpha) per group (fighter-fight):

        y[g,r] ~ Poisson(theta_g * E[g,r] * exp(x[g,r]' beta)),  theta_g ~ Gamma(1/alpha, alpha)

    Integrating theta gives the negative multinomial; covariates that are functions of earlier rounds are
    predetermined (the sequential factorization holds). Cluster-robust sandwich by fight."""

    def __init__(self, df, ycol, ecol, xcols, gcol="g", ccol="fid"):
        d = df[df[ecol] > 0].copy()
        self.xcols = list(xcols)
        self.y = d[ycol].to_numpy(float)
        self.lE = np.log(d[ecol].to_numpy(float))
        self.X = d[self.xcols].to_numpy(float)
        self.g = pd.factorize(d[gcol])[0]
        self.c = pd.factorize(d[ccol])[0]
        self.G = self.g.max() + 1
        self.Yg = np.bincount(self.g, self.y, self.G)
        self.const = (-special.gammaln(self.y + 1)).sum()
        self.n = len(d)
        self.d = d

    def _parts(self, b, la):
        a = math.exp(la)
        k = 1 / a
        mu = np.exp(np.clip(self.lE + self.X @ b, -50, 50))
        Mg = np.bincount(self.g, mu, self.G)
        return a, k, mu, Mg

    def negll(self, par):
        b, la = par[:-1], par[-1]
        a, k, mu, Mg = self._parts(b, la)
        ll = (special.gammaln(k + self.Yg) - special.gammaln(k)).sum() + self.const
        ll += (self.y * (self.lE + self.X @ b)).sum() + self.Yg.sum() * la
        ll -= ((k + self.Yg) * np.log1p(a * Mg)).sum()
        return -ll

    def grad_obs(self, par):
        """Per-observation contributions to the score (beta part) and per-group alpha part."""
        b, la = par[:-1], par[-1]
        a, k, mu, Mg = self._parts(b, la)
        fac = (k + self.Yg) * a / (1 + a * Mg)          # per group
        gb_obs = (self.y - fac[self.g] * mu)[:, None] * self.X
        # d/d log(alpha): chain d/da * a
        dk = -1 / a ** 2
        ga_grp = (dk * (special.digamma(k + self.Yg) - special.digamma(k)) + self.Yg / a
                  - dk * np.log1p(a * Mg) - (k + self.Yg) * Mg / (1 + a * Mg)) * a
        return gb_obs, ga_grp

    def grad(self, par):
        gb_obs, ga_grp = self.grad_obs(par)
        return -np.concatenate([gb_obs.sum(0), [ga_grp.sum()]])

    def fit(self, b0=None, la0=math.log(0.5)):
        p0 = np.concatenate([np.zeros(len(self.xcols)) if b0 is None else b0, [la0]])
        r = optimize.minimize(self.negll, p0, jac=self.grad, method="L-BFGS-B",
                              options={"maxiter": 5000, "gtol": 1e-8})
        self.par = r.x
        self.ll = -r.fun
        # numerical Hessian from the analytic gradient
        k = len(self.par); H = np.zeros((k, k)); h = 1e-5
        for j in range(k):
            e = np.zeros(k); e[j] = h
            H[:, j] = (self.grad(self.par + e) - self.grad(self.par - e)) / (2 * h)
        H = (H + H.T) / 2
        self.Hinv = np.linalg.inv(H)
        gb_obs, ga_grp = self.grad_obs(self.par)
        # cluster scores by fight
        C = self.c.max() + 1
        sc = np.zeros((C, k))
        for j in range(k - 1):
            sc[:, j] = np.bincount(self.c, gb_obs[:, j], C)
        gc = np.zeros(self.G); gc[:] = ga_grp
        grp_c = np.zeros(self.G, int); grp_c[self.g] = self.c
        sc[:, -1] = np.bincount(grp_c, gc, C)
        self.cov = self.Hinv @ (sc.T @ sc) @ self.Hinv
        return self

    def coef(self):
        se = np.sqrt(np.diag(self.cov))
        out = {n: {"est": float(b), "se": float(s)} for n, b, s in zip(self.xcols, self.par[:-1], se[:-1])}
        out["frailty_var"] = {"est": float(math.exp(self.par[-1])), "se_log": float(se[-1])}
        return out

    def score_other(self, other, par=None):
        """Held-out log-likelihood of another FrailPois dataset with fixed parameters, and the sequential
        predictive means E[y_r | earlier rounds of the same group] (posterior-updated frailty)."""
        par = self.par if par is None else par
        b, la = par[:-1], par[-1]
        a = math.exp(la); k = 1 / a
        mu = np.exp(other.lE + other.X @ b)
        Mg = np.bincount(other.g, mu, other.G)
        ll = (special.gammaln(k + other.Yg) - special.gammaln(k)).sum() + other.const
        ll += (other.y * (other.lE + other.X @ b)).sum() + other.Yg.sum() * la
        ll -= ((k + other.Yg) * np.log1p(a * Mg)).sum()
        # sequential predictive means (rows are in round order within group)
        d = other.d.assign(_mu=mu, _y=other.y, _g=other.g)
        cy = d.groupby("_g")["_y"].cumsum() - d["_y"]
        cm = d.groupby("_g")["_mu"].cumsum() - d["_mu"]
        pred = mu * (k + cy.to_numpy()) / (k + cm.to_numpy())
        return float(ll), pred, mu


def grouped_jackknife(fit_fn, df, key="fid", G=20, seed=7):
    """Delete-a-group jackknife over fights. fit_fn(df) -> dict name -> estimate. Returns name -> se."""
    ids = df[key].unique()
    rng = np.random.default_rng(seed)
    lab = dict(zip(ids, rng.integers(0, G, len(ids))))
    grp = df[key].map(lab).to_numpy()
    full = fit_fn(df)
    reps = []
    for gq in range(G):
        reps.append(fit_fn(df[grp != gq]))
    out = {}
    for n in full:
        v = np.array([r[n] for r in reps])
        out[n] = float(math.sqrt((G - 1) / G * ((v - v.mean()) ** 2).sum()))
    return full, out


# ================================================================================================
# per-person walk-forward history
# ================================================================================================
def person_history(S, p0_kd):
    """Pre-fight features per (fid, idx), built only from the person's earlier fights in the panel:
    career minutes, sig attempts / min, KD absorbed per standing head absorbed (chin index) and KD scored per
    standing head landed (power index), both shrunk toward p0_kd with 230 head strikes (engine kKD)."""
    FS = (S.groupby(["fid", "idx"], sort=False)
            .agg(pid=("pid", "first"), DATE=("DATE", "first"), mins=("mins", "sum"), sig_a=("sig_a", "sum"),
                 sig_l=("sig_l", "sum"), kd=("kd", "sum"), okd=("o_kd", "sum"), sh=("sh_l", "sum"),
                 osh=("o_sh_l", "sum"), td_a=("td_a", "sum"), ctrl=("ctrl", "sum"), octrl=("o_ctrl", "sum"))
            .reset_index().sort_values(["DATE", "fid", "idx"]))
    cols = ["mins", "sig_a", "sig_l", "kd", "okd", "sh", "osh", "td_a", "ctrl", "octrl"]
    g = FS.groupby("pid", sort=False)
    for c in cols:
        FS["h_" + c] = g[c].cumsum() - FS[c]
    FS["h_n"] = g.cumcount()
    k = 230.0
    FS["chin_idx"] = ((FS.h_okd + k * p0_kd) / (FS.h_osh + k)) / p0_kd
    FS["pow_idx"] = ((FS.h_kd + k * p0_kd) / (FS.h_sh + k)) / p0_kd
    FS["h_attpm"] = (FS.h_sig_a + 40 * 8.0) / (FS.h_mins + 40)
    return FS


if __name__ == "__main__" and "--panel-only" in sys.argv:
    t = time.time()
    F, S, notes = build_panel()
    print(time.time() - t, len(F), len(S))
