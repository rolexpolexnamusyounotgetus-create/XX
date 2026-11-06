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
    people = bd.build_people(fights, log)
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
    slug = {k: v.get("slug") for k, v in people.items()}
    S["slug"] = S.pid.map(slug)
    dob = {k: (v.get("tott") or {}).get("dob") for k, v in people.items()}
    S["dob"] = pd.to_datetime(S.pid.map(dob))
    S["age"] = (S.DATE - S.dob).dt.days / 365.25
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
    out by GLS and the five variance parameters are found by ML. Rounds may be missing for either fighter
    (rows dropped by an exposure filter); fights are batched by their (fighter, round) pattern."""

    def __init__(self, df, ycol, vcol, xcols, cellcol="cell", fixed_cells=None):
        df = df.sort_values(["fid", "idx", "rnd"])
        self.xcols = list(xcols)
        cells = sorted(df[cellcol].unique()) if fixed_cells is None else list(fixed_cells)
        self.cells = cells
        ci = {c: k for k, c in enumerate(cells)}
        self.k = len(cells) + len(self.xcols)
        fid = df.fid.to_numpy(); idx = df.idx.to_numpy().astype(int); rnd = df.rnd.to_numpy().astype(int)
        Yall = df[ycol].to_numpy(float); Vall = df[vcol].to_numpy(float)
        Call = df[cellcol].map(ci).to_numpy()
        Xall = df[self.xcols].to_numpy(float) if self.xcols else np.zeros((len(df), 0))
        starts = np.r_[0, np.flatnonzero(fid[1:] != fid[:-1]) + 1, len(df)]
        groups = defaultdict(list)
        for s0, s1 in zip(starts[:-1], starts[1:]):
            pat = tuple(zip(idx[s0:s1], rnd[s0:s1]))
            groups[pat].append((s0, s1))
        self.batches = {}
        for pat, lst in groups.items():
            n, m = len(lst), len(pat)
            rows = np.concatenate([np.arange(s0, s1) for s0, s1 in lst])
            Y = Yall[rows].reshape(n, m); V = Vall[rows].reshape(n, m)
            X = np.zeros((n * m, self.k))
            X[np.arange(n * m), Call[rows]] = 1.0
            if self.xcols:
                X[:, len(cells):] = Xall[rows]
            self.batches[pat] = (Y, V, X.reshape(n, m, self.k), [fid[s0] for s0, _ in lst])
        self.n_obs = sum(len(p) * len(b[3]) for p, b in self.batches.items())
        self.n_fights = sum(len(b[3]) for b in self.batches.values())

    @staticmethod
    def base_cov(pat, th):
        sa, rho, sb, se, phi = th
        i = np.array([q[0] for q in pat]); r = np.array([q[1] for q in pat])
        same_i = i[:, None] == i[None, :]
        same_r = r[:, None] == r[None, :]
        lag = np.abs(r[:, None] - r[None, :])
        return (sa ** 2 * np.where(same_i, 1.0, rho) + sb ** 2 * same_r
                + se ** 2 * same_i * phi ** lag)

    @staticmethod
    def unpack(p):
        return (math.exp(p[0]), math.tanh(p[1]), math.exp(p[2]), math.exp(p[3]), math.tanh(p[4]))

    def _accum(self, th):
        A = np.zeros((self.k, self.k)); c = np.zeros(self.k); ld = 0.0; yy = 0.0
        store = {}
        for pat, (Y, V, X, _) in self.batches.items():
            m = len(pat)
            Sg = self.base_cov(pat, th)[None] + V[:, :, None] * np.eye(m)[None]
            L = np.linalg.cholesky(Sg)
            Xs = np.linalg.solve(L, X)
            ys = np.linalg.solve(L, Y[:, :, None])[:, :, 0]
            A += np.einsum("nik,nil->kl", Xs, Xs)
            c += np.einsum("nik,ni->k", Xs, ys)
            ld += 2 * np.log(np.diagonal(L, axis1=1, axis2=2)).sum()
            yy += (ys ** 2).sum()
            store[pat] = (Xs, ys)
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
        p0 = np.array([math.log(0.4), 1.0, math.log(0.3), math.log(0.3), 0.6]) if p0 is None else p0
        r = optimize.minimize(self.negll, p0, method="L-BFGS-B")
        r2 = optimize.minimize(self.negll, r.x, method="Nelder-Mead",
                               options={"maxiter": 600, "xatol": 1e-4, "fatol": 1e-3})
        self.p = r2.x if r2.fun < r.fun else r.x
        self.th = self.unpack(self.p)
        A, c, ld, yy, store = self._accum(self.th)
        Ainv = np.linalg.inv(A)
        self.beta = Ainv @ c
        M = np.zeros((self.k, self.k))
        for pat, (Xs, ys) in store.items():
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

    def est(self):
        names = ["cell:" + c for c in self.cells] + self.xcols
        return dict(zip(names, map(float, self.beta)))

    def gamma(self):
        k0 = len(self.cells)
        se = np.sqrt(np.diag(self.cov_rob))[k0:]
        return {n: {"est": float(b), "se": float(s)} for n, b, s in zip(self.xcols, self.beta[k0:], se)}

    def var_components(self):
        sa, rho, sb, se, phi = self.th
        return {"sd_fighter_fight": sa, "corr_fighters": rho, "sd_round_shared": sb, "sd_round_own": se,
                "ar1_round_own": phi}

    def predictive(self, other, beta=None, th=None):
        """One-step-ahead predictive log-likelihood and squared error on another DynRE dataset with fixed
        parameters: every observation in a round after the fight's first observed round, given all
        observations of both fighters in earlier rounds (the other fighter's same round is not used)."""
        beta = self.beta if beta is None else beta
        th = self.th if th is None else th
        ll = 0.0; se2 = 0.0; n = 0
        for pat, (Y, V, X, _) in other.batches.items():
            m = len(pat)
            Sg = self.base_cov(pat, th)[None] + V[:, :, None] * np.eye(m)[None]
            mu = X @ beta
            rr = np.array([q[1] for q in pat])
            for t in range(m):
                past = np.flatnonzero(rr < rr[t])
                if len(past) == 0:
                    continue
                S_pp = Sg[:, past][:, :, past]
                S_tp = Sg[:, t, past]
                w = np.linalg.solve(S_pp, S_tp[:, :, None])[:, :, 0]
                mm = mu[:, t] + np.einsum("np,np->n", w, Y[:, past] - mu[:, past])
                v = Sg[:, t, t] - np.einsum("np,np->n", w, S_tp)
                ll += (-0.5 * (np.log(2 * np.pi * v) + (Y[:, t] - mm) ** 2 / v)).sum()
                se2 += ((Y[:, t] - mm) ** 2).sum(); n += len(mm)
        return {"ll": float(ll), "n": int(n), "mse": float(se2 / max(n, 1))}


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
    FS["pid"] = FS["pid"].fillna("anon:" + FS.fid.astype(str) + ":" + FS.idx.astype(str))
    g = FS.groupby("pid", sort=False)
    for c in cols:
        FS["h_" + c] = g[c].cumsum() - FS[c]
    FS["h_n"] = g.cumcount()
    k = 230.0
    FS["chin_idx"] = ((FS.h_okd + k * p0_kd) / (FS.h_osh + k)) / p0_kd
    FS["pow_idx"] = ((FS.h_kd + k * p0_kd) / (FS.h_sh + k)) / p0_kd
    FS["h_attpm"] = (FS.h_sig_a + 40 * 8.0) / (FS.h_mins + 40)
    return FS


# ================================================================================================
# shared preparation
# ================================================================================================
def r6(x, d=4):
    if x is None:
        return None
    if isinstance(x, dict):
        return {k: r6(v, d) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [r6(v, d) for v in x]
    if isinstance(x, (np.integer,)):
        return int(x)
    if isinstance(x, (float, np.floating)):
        x = float(x)
        if math.isnan(x) or math.isinf(x):
            return None
        return round(x, d)
    return x


def add_covariates(S):
    S = S.copy()
    for c in [c for c in S.columns if c.startswith("l_")]:
        S[c] = S[c].fillna(0.0)
    S["cell"] = S.R.astype(str) + "_" + S.rnd.astype(str)
    S["partial"] = (~S.full).astype(float)
    S["D10"] = S.c_ohl / 10                     # head sig strikes absorbed in earlier rounds, per 10
    S["H10"] = S.c_hl / 10                      # head sig strikes landed on him in earlier rounds, per 10
    S["K_lag"] = S.l_okd                        # knockdowns absorbed in the previous round
    S["K_early"] = S.c_okd - S.l_okd            # knockdowns absorbed before the previous round
    S["Ks_lag"] = S.l_kd                        # knockdowns scored in the previous round
    S["Ks_early"] = S.c_kd - S.l_kd
    S["A100"] = S.c_att / 100                   # own sig attempts in earlier rounds, per 100 (fatigue proxy)
    S["oA100"] = S.c_oatt / 100
    S["octrl_m"] = S.c_octrl / 60               # minutes controlled by the opponent in earlier rounds
    S["ctrl_m"] = S.c_ctrl / 60                 # minutes in control in earlier rounds
    S["otdl"] = S.c_otdl                        # takedowns absorbed in earlier rounds
    S["tdl"] = S.c_tdl                          # takedowns landed in earlier rounds
    first = S.rnd == 1
    S["lost"] = np.where(first, 0.0, (S.l_sigl < S.l_osigl).astype(float) + 0.5 * (S.l_sigl == S.l_osigl))
    # rounds lost minus rounds won (sig landed) before this round; desperation entering the final round
    g = S.groupby(["fid", "idx"], sort=False)
    w = (S.sig_l > S.o_sig_l).astype(float) - (S.sig_l < S.o_sig_l).astype(float)
    S["_w"] = w
    S["net_prev"] = g["_w"].cumsum() - S["_w"]
    S = S.drop(columns="_w")
    S["final"] = (S.rnd == S.R).astype(float)
    S["behind2_final"] = ((S.net_prev <= -2) & (S.rnd == S.R)).astype(float)
    S["ahead2_final"] = ((S.net_prev >= 2) & (S.rnd == S.R)).astype(float)
    S["tfree"] = (S.rsec - S.ctrl - S.o_ctrl).clip(lower=0)
    S["g"] = S.fid.astype(str) + ":" + S.idx.astype(str)
    return S


OUTCOMES = {
    # name: (y, v, filter, description)
    "out": ("sig attempts per minute (log)", lambda d: np.log((d.sig_a + 0.5) / d.mins),
            lambda d: 1 / (d.sig_a + 0.5), lambda d: d.rsec >= 60),
    "dist": ("distance sig attempts per minute of non-control time (log)",
             lambda d: np.log((d.dist_a + 0.5) / (d.tfree / 60)), lambda d: 1 / (d.dist_a + 0.5),
             lambda d: d.tfree >= 60),
    "acc": ("sig accuracy (empirical logit)", lambda d: np.log((d.sig_l + 0.5) / (d.sig_a - d.sig_l + 0.5)),
            lambda d: 1 / (d.sig_l + 0.5) + 1 / (d.sig_a - d.sig_l + 0.5), lambda d: (d.sig_a >= 5) & (d.rsec >= 60)),
    "hacc": ("head sig accuracy (empirical logit)",
             lambda d: np.log((d.head_l + 0.5) / (d.head_a - d.head_l + 0.5)),
             lambda d: 1 / (d.head_l + 0.5) + 1 / (d.head_a - d.head_l + 0.5),
             lambda d: (d.head_a >= 5) & (d.rsec >= 60)),
}
STATE_X = ["partial", "D10", "K_lag", "K_early", "A100", "oA100", "octrl_m", "ctrl_m", "otdl", "tdl", "H10",
           "Ks_lag", "Ks_early", "lost", "behind2_final"]
XDOC = {
    "partial": "final round that ended early (rate in a short round incl. the finishing sequence)",
    "D10": "head sig strikes absorbed in earlier rounds, per 10",
    "K_lag": "knockdowns absorbed in the previous round",
    "K_early": "knockdowns absorbed before the previous round",
    "A100": "own sig attempts in earlier rounds, per 100 (fatigue proxy)",
    "oA100": "opponent's sig attempts in earlier rounds, per 100",
    "octrl_m": "minutes controlled by the opponent in earlier rounds",
    "ctrl_m": "minutes in control of the opponent in earlier rounds",
    "otdl": "takedowns absorbed in earlier rounds",
    "tdl": "takedowns landed in earlier rounds",
    "H10": "head sig strikes landed on the opponent in earlier rounds, per 10",
    "Ks_lag": "knockdowns scored in the previous round",
    "Ks_early": "knockdowns scored before the previous round",
    "lost": "lost the previous round on sig strikes landed (tie 0.5)",
    "behind2_final": "final scheduled round and down 2+ rounds on sig-landed rounds",
    "lostJ": "share of judges who gave the previous round to the opponent (decisions only)",
}


def prep_outcome(S, name):
    _, fy, fv, ff = OUTCOMES[name]
    d = S[ff(S)].copy()
    d["y"] = fy(d)
    d["v"] = fv(d)
    return d


# ================================================================================================
# part 1 + 3 + 4: dynamic RE models for output and accuracy, frailty Poisson for takedown attempts
# ================================================================================================
def fit_dynre_outcome(S, name, xcols, jack=0, label=""):
    d = prep_outcome(S, name)
    tr, te = d[d.period == "train"], d[d.period == "test"]
    t0 = time.time()
    m0 = DynRE(tr, "y", "v", ["partial"]).fit()
    m1 = DynRE(tr, "y", "v", xcols, fixed_cells=m0.cells).fit(m0.p)
    p0 = m0.predictive(DynRE(te, "y", "v", ["partial"], fixed_cells=m0.cells))
    p1 = m1.predictive(DynRE(te, "y", "v", xcols, fixed_cells=m0.cells))
    pt0 = m0.predictive(DynRE(tr, "y", "v", ["partial"], fixed_cells=m0.cells))
    pt1 = m1.predictive(DynRE(tr, "y", "v", xcols, fixed_cells=m0.cells))
    gam = m1.gamma()
    if jack:
        def ffit(df):
            mm = DynRE(df, "y", "v", xcols, fixed_cells=m0.cells).fit(m1.p)
            return {k: v["est"] for k, v in mm.gamma().items()}
        _, jse = grouped_jackknife(ffit, tr, G=jack)
        for k in gam:
            gam[k]["se_jack"] = jse[k]
    cells0 = {k[5:]: v for k, v in m0.est().items() if k.startswith("cell:")}
    curve = {}
    for R in (3, 5):
        base = cells0.get(f"{R}_1")
        if base is not None:
            curve[str(R)] = [math.exp(cells0[f"{R}_{r}"] - base) for r in range(1, R + 1) if f"{R}_{r}" in cells0]
    out = {
        "outcome": OUTCOMES[name][0], "n_obs_train": m1.n_obs, "n_fights_train": m1.n_fights,
        "n_obs_test": p1["n"] + 0, "gamma": gam, "var_components_null": m0.var_components(),
        "var_components_full": m1.var_components(), "cells_null": cells0,
        "round_curve_null_ratio_to_r1": curve,
        "partial_null": m0.gamma()["partial"],
        "heldout_one_step": {"null": p0, "full": p1,
                             "dll_per_obs": (p1["ll"] - p0["ll"]) / max(p1["n"], 1),
                             "mse_reduction_pct": 100 * (1 - p1["mse"] / p0["mse"])},
        "train_one_step": {"null": pt0, "full": pt1, "dll_per_obs": (pt1["ll"] - pt0["ll"]) / max(pt1["n"], 1)},
        "secs": time.time() - t0,
    }
    print(f"  [{label or name}] train n={m1.n_obs} test dLL/obs={out['heldout_one_step']['dll_per_obs']:+.4f} "
          f"MSE -{out['heldout_one_step']['mse_reduction_pct']:.2f}%  ({out['secs']:.0f}s)", flush=True)
    return out, m0, m1


def comparison_estimators(S):
    """Naive pooled OLS, lagged-DV OLS and within fighter-fight FE for log output on the cumulative state:
    the bracket that motivates the dynamic RE estimator (full rounds, r >= 2 for pooled / LDV)."""
    import statsmodels.api as sm
    d = S[S.period == "train"].copy()
    d["y"] = np.log((d.sig_a + 0.5) / d.mins)
    g = d.groupby(["fid", "idx"])
    d["ly"] = g.y.shift(1)
    d["y1"] = g.y.transform("first")
    O = d[["fid", "rnd", "idx", "ly", "y1"]].copy()
    O["idx"] = 1 - O.idx
    d = d.merge(O.rename(columns={"ly": "oly", "y1": "oy1"}), on=["fid", "rnd", "idx"], how="left")
    X = ["D10", "K_lag", "K_early", "A100", "octrl_m", "ctrl_m", "otdl", "tdl", "Ks_lag", "Ks_early", "H10"]
    res = {}
    e = d[(d.rnd >= 2) & d.full]
    cells = pd.get_dummies(e.cell).astype(float)
    for lab, extra in [("pooled_ols", []), ("lagged_dv_ols", ["ly", "y1", "oly", "oy1"])]:
        M = pd.concat([cells, e[X + extra]], axis=1)
        m = sm.OLS(e.y, M).fit(cov_type="cluster", cov_kwds={"groups": pd.factorize(e.fid)[0]})
        res[lab] = {k: {"est": float(m.params[k]), "se": float(m.bse[k])} for k in X}
    f = d[d.full].copy()
    f = f[f.groupby(["fid", "idx"]).rnd.transform("size") >= 2]
    grp = (f.fid.astype(str) + ":" + f.idx.astype(str)).to_numpy()
    Z = pd.concat([pd.get_dummies(f.cell).astype(float), f[X]], axis=1)
    Zd = Z - Z.groupby(grp).transform("mean")
    yd = f.y - f.y.groupby(grp).transform("mean")
    Zd = Zd.loc[:, Zd.std() > 1e-9].drop(columns=["3_1", "5_1"], errors="ignore")
    m = sm.OLS(yd, Zd).fit(cov_type="cluster", cov_kwds={"groups": pd.factorize(f.fid)[0]})
    res["fixed_effects"] = {k: {"est": float(m.params[k]), "se": float(m.bse[k])} for k in X}
    return res


def sim_check(S, m0, reps=2, gam_true=(0.0,), seed=11):
    """Simulate log output from the fitted null dynamic-RE model (no state effects), rebuild the
    own-output fatigue proxy from the simulated counts, and refit by dynamic RE and by within-fight FE."""
    d = prep_outcome(S, "out")
    d = d[d.period == "train"].sort_values(["fid", "idx", "rnd"])
    sa, rho, sb, se, phi = m0.th
    mu = {k[5:]: v for k, v in m0.est().items() if k.startswith("cell:")}
    part = m0.est()["partial"]
    rng = np.random.default_rng(seed)
    out = []
    fids = d.fid.to_numpy(); idx = d.idx.to_numpy(); rnd = d.rnd.to_numpy(); mins = d.mins.to_numpy()
    cellv = d.cell.map(mu).to_numpy(); pv = d.partial.to_numpy()
    starts = np.r_[0, np.flatnonzero(fids[1:] != fids[:-1]) + 1, len(d)]
    for gt in gam_true:
        for rep in range(reps):
            att = np.zeros(len(d)); cum = np.zeros(len(d))
            for s0, s1 in zip(starts[:-1], starts[1:]):
                a = rng.multivariate_normal([0, 0], [[sa ** 2, rho * sa ** 2], [rho * sa ** 2, sa ** 2]])
                b = rng.normal(0, sb, 6)
                for i in (0, 1):
                    rows = [q for q in range(s0, s1) if idx[q] == i]
                    e = 0.0; c = 0.0
                    for k, q in enumerate(rows):
                        e = phi * e + math.sqrt(1 - phi ** 2) * rng.normal(0, se) if k else rng.normal(0, se)
                        lam = math.exp(cellv[q] + part * pv[q] + a[i] + b[rnd[q]] + e + gt * c / 100) * mins[q]
                        att[q] = rng.poisson(lam); cum[q] = c; c += att[q]
            D = pd.DataFrame({"fid": fids, "idx": idx, "rnd": rnd, "cell": d.cell.to_numpy(), "partial": pv,
                              "mins": mins, "att": att, "A100": cum / 100})
            D["y"] = np.log((D.att + 0.5) / D.mins); D["v"] = 1 / (D.att + 0.5)
            m = DynRE(D, "y", "v", ["partial", "A100"]).fit(m0.p)
            f = D[D.groupby(["fid", "idx"]).rnd.transform("size") >= 2]
            grp = (f.fid.astype(str) + ":" + f.idx.astype(str)).to_numpy()
            Z = pd.concat([pd.get_dummies(f.cell).astype(float), f[["partial", "A100"]]], axis=1)
            Zd = Z - Z.groupby(grp).transform("mean"); yd = f.y - f.y.groupby(grp).transform("mean")
            Zd = Zd.loc[:, Zd.std() > 1e-9].drop(columns=["3_1", "5_1"], errors="ignore")
            bfe = np.linalg.lstsq(Zd.to_numpy(), yd.to_numpy(), rcond=None)[0]
            out.append({"gamma_true": gt, "rep": rep, "dynre": m.gamma()["A100"]["est"],
                        "fixed_effects": float(bfe[list(Zd.columns).index("A100")])})
            print("   sim", out[-1], flush=True)
    return out


def fit_tda(S, xcols):
    """Takedown attempts per round: Poisson with gamma frailty per fighter-fight, exposure = minutes."""
    d = S[S.rsec >= 30].copy()
    d = d.sort_values(["fid", "idx", "rnd"])
    cells = sorted(d.cell.unique())
    for c in cells:
        d["c" + c] = (d.cell == c).astype(float)
    cc = ["c" + c for c in cells]
    tr, te = d[d.period == "train"], d[d.period == "test"]
    m0 = FrailPois(tr, "td_a", "mins", cc + ["partial"]).fit()
    m1 = FrailPois(tr, "td_a", "mins", cc + xcols).fit()
    l0, _, _ = m0.score_other(FrailPois(te, "td_a", "mins", cc + ["partial"]))
    l1, _, _ = m1.score_other(FrailPois(te, "td_a", "mins", cc + xcols))
    co = m1.coef()
    return {"outcome": "takedown attempts per minute (Poisson, gamma frailty per fighter-fight)",
            "gamma": {k: v for k, v in co.items() if not k.startswith("c") or k in xcols},
            "cells_null": {k[1:]: v["est"] for k, v in m0.coef().items() if k.startswith("c") and k[1] in "35"},
            "frailty_var_null": m0.coef()["frailty_var"],
            "heldout_ll": {"null": l0, "full": l1, "dll_per_fighter_fight": (l1 - l0) / te.g.nunique()},
            "n_train": m1.n}


# ================================================================================================
# part 2: per-fighter late-round output ratios
# ================================================================================================
PACE_LND5 = [1.0, 1.2, 1.2, 1.23, 1.23]
PACE_LND3 = [1.0, 1.11, 1.13]


def late_ratio_table(S):
    full = S[S.full].copy()
    full["la"] = np.log((full.sig_a + 0.5) / 5)
    full["ll"] = np.log((full.sig_l + 0.5) / 5)
    tr = full[full.period == "train"]
    cm = {v: tr.groupby("cell")[v].mean() for v in ("la", "ll")}
    for v in ("la", "ll"):
        full[v + "_c"] = full[v] - full.cell.map(cm[v])
    full = full.sort_values(["fid", "idx", "rnd"])
    g = full.groupby(["fid", "idx"], sort=False)
    first = g.head(1).set_index(["fid", "idx"])
    late = full[full.rnd >= 2].groupby(["fid", "idx"]).agg(alate=("la_c", "mean"), llate=("ll_c", "mean"),
                                                           T=("rnd", "max"), nlate=("rnd", "size"))
    FF = first[["pid", "slug", "DATE", "R", "period", "la_c", "ll_c", "age", "division"]].join(late, how="inner")
    FF = FF[FF.nlate == FF["T"] - 1]           # consecutive full rounds from R1
    FF["LRa"] = FF.alate - FF.la_c
    FF["LRl"] = FF.llate - FF.ll_c
    FF = FF.reset_index().sort_values(["DATE", "fid", "idx"]).reset_index(drop=True)
    FF["pid"] = FF.pid.fillna("anon:" + FF.fid.astype(str) + ":" + FF.idx.astype(str))
    return FF, {v: {k: float(x) for k, x in cm[v].items()} for v in cm}


def tau2_mom(df, col):
    d = df.copy()
    m = d[col].mean()
    d["e"] = d[col] - m
    s = d.groupby("pid").e.agg(["sum", "count"])
    s2 = d.groupby("pid").e.apply(lambda x: (x ** 2).sum())
    cross = (s["sum"] ** 2 - s2) / 2
    npair = s["count"] * (s["count"] - 1) / 2
    t2 = cross.sum() / npair.sum()
    # bootstrap over people for an interval
    ids = s.index.to_numpy()
    rng = np.random.default_rng(3)
    bs = []
    cr, npr = cross.to_numpy(), npair.to_numpy()
    for _ in range(400):
        q = rng.integers(0, len(ids), len(ids))
        bs.append(cr[q].sum() / max(npr[q].sum(), 1))
    return float(t2), float(d[col].var()), float(m), int(npair.sum()), [float(np.percentile(bs, 2.5)),
                                                                     float(np.percentile(bs, 97.5))]


def eb_walk(FF, col, t2, s2, m, decay_days=None):
    """Walk-forward EB prediction of each fighter-fight's late ratio from the same person's earlier fights."""
    FF = FF.sort_values(["DATE", "fid", "idx"])
    preds = np.full(len(FF), m); nprev = np.zeros(len(FF))
    hist = defaultdict(list)
    for q, (pid, day, y) in enumerate(zip(FF.pid, FF.DATE, FF[col])):
        h = hist[pid]
        if h:
            if decay_days:
                w = np.array([0.5 ** ((day - d0).days / decay_days) for d0, _ in h])
            else:
                w = np.ones(len(h))
            ys = np.array([y0 for _, y0 in h])
            n_eff = w.sum()
            prec = n_eff * t2 / s2
            preds[q] = m + (prec / (1 + prec)) * ((w * ys).sum() / n_eff - m)
            nprev[q] = len(h)
        h.append((day, y))
    out = pd.Series(preds, index=FF.index), pd.Series(nprev, index=FF.index)
    return out


def skill(y, p, m):
    mse = float(((y - p) ** 2).mean()); mse0 = float(((y - m) ** 2).mean())
    v = float(np.var(p - m, ddof=1)) if len(p) > 2 else 0.0
    slope = float(np.cov(p - m, y - m)[0, 1] / v) if v > 1e-12 else None
    corr = float(np.corrcoef(p, y)[0, 1]) if v > 1e-12 else None
    return {"n": int(len(y)), "mse": mse, "mse_league": mse0, "skill_pct": 100 * (1 - mse / mse0),
            "slope": slope, "corr": corr}


def engine_pace_pred(pc, pw, T, kPace):
    if pc is None or pw is None:
        return 0.0
    five = any(pc[r] is not None and pw[r] > 0 for r in (3, 4))
    lc = PACE_LND5 if five else PACE_LND3
    rho = [1.0] * 5
    for r in range(1, 5):
        if pc[r] is not None and pw[r] > 0 and r < len(lc):
            ratio = min(max(pc[r] / lc[r], 0.3), 3)
            rho[r] = (ratio * pw[r] + kPace) / (pw[r] + kPace)
        else:
            rho[r] = 1 + 0.5 * (rho[r - 1] - 1)
    return float(np.mean([math.log(rho[r]) for r in range(1, min(T, 5))]))


def part2(S):
    FF, cellmeans = late_ratio_table(S)
    pre = FF[FF.period.isin(["ext", "train"])]
    res = {"definition": "LR = mean over full rounds 2..T of log(sig per min) minus round-1 log(sig per min), "
                         "each relative to the league (format, round) mean from 2019-2023; fighter-fights with at "
                         "least two full rounds; LRa = attempts, LRl = landed",
           "n_fighter_fights": FF.groupby("period").size().to_dict()}
    var = {}
    for col in ("LRa", "LRl"):
        t2, vt, m, npair, ci = tau2_mom(pre, col)
        t2tr, vtr, mtr, nptr, citr = tau2_mom(FF[FF.period == "train"], col)
        byT = FF[FF.period.isin(["ext", "train"])].groupby("T")[col].agg(["mean", "var", "size"])
        var[col] = {"tau2_pretest": t2, "tau2_ci95": ci, "tau_pretest": math.sqrt(max(t2, 0)), "total_var": vt,
                    "icc_one_fight": t2 / vt, "league_mean": m, "pairs": npair,
                    "tau2_train_only": t2tr, "tau2_train_ci95": citr,
                    "by_T": {int(k): {"mean": float(r["mean"]), "var": float(r["var"]), "n": int(r["size"])}
                             for k, r in byT.iterrows()}}
    res["variance"] = var
    # walk-forward held-out: grid of tau2 (choose on train), plus time decay variants
    grid = {}
    for col in ("LRa", "LRl"):
        m = var[col]["league_mean"]; s2 = var[col]["total_var"] - var[col]["tau2_pretest"]
        rows = []
        for t2 in (0.005, 0.01, 0.015, 0.02, 0.025, 0.03, 0.04, 0.05, 0.075, 0.1):
            for dec in (None, 1095):
                pred, n = eb_walk(FF, col, t2, s2, m, dec)
                row = {"tau2": t2, "decay_days": dec}
                for per in ("train", "test"):
                    sel = (FF.period == per) & (n >= 1)
                    row[per] = skill(FF.loc[sel, col], pred[sel], m)
                rows.append(row)
        best = max([r for r in rows if r["decay_days"] is None], key=lambda r: r["train"]["skill_pct"])
        bestd = max(rows, key=lambda r: r["train"]["skill_pct"])
        grid[col] = {"rows": rows, "chosen_on_train": best, "chosen_on_train_any_decay": bestd}
    res["eb_walkforward"] = grid
    # systematic predictors of the late ratio (walk-forward safe: age, prior output rate, division, format)
    import statsmodels.api as sm
    H = person_history(S, 0.0088)[["fid", "idx", "h_attpm", "h_n"]]
    X = FF.merge(H, on=["fid", "idx"], how="left")
    X["age_c"] = (X.age - 30).fillna(0) / 5
    X["lout"] = np.log(X.h_attpm / 8.0)
    X["heavy"] = X.division.isin(["Light Heavyweight", "Heavyweight"]).astype(float)
    X["women"] = X.division.astype(str).str.startswith("Women").astype(float)
    X["five"] = (X.R == 5).astype(float)
    cols = ["age_c", "lout", "heavy", "women", "five"]
    sysres = {}
    for col in ("LRa", "LRl"):
        trn = X[X.period == "train"]
        mm = sm.OLS(trn[col], sm.add_constant(trn[cols])).fit(cov_type="cluster",
                                                              cov_kwds={"groups": pd.factorize(trn.pid)[0]})
        tst = X[X.period == "test"]
        p = mm.predict(sm.add_constant(tst[cols]))
        sysres[col] = {"coef": {k: {"est": float(mm.params[k]), "se": float(mm.bse[k])} for k in ["const"] + cols},
                       "test": skill(tst[col], p, var[col]["league_mean"])}
    res["systematic"] = sysres
    # the engine's current rule (backtest.json pace / pace_w, landed per round, kPace) vs realized LR
    bt = json.load(open(os.path.join(ROOT, "data", "derived", "backtest.json")))
    rows = []
    for f in bt["fights"]:
        for side, idx in (("A", 0), ("B", 1)):
            x = f[side]
            rows.append((f["id"], idx, x.get("pace"), x.get("pace_w")))
    B = pd.DataFrame(rows, columns=["fkey", "idx", "pace", "pace_w"])
    FF["fkey"] = FF.fid.map(bd.url_id)
    J = FF.merge(B, on=["fkey", "idx"])
    eng = []
    for k in (5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240):
        J["ep"] = [engine_pace_pred(pc, pw, T, k) for pc, pw, T in zip(J.pace, J.pace_w, J["T"])]
        row = {"kPace": k}
        for per in ("train", "test"):
            d = J[J.period == per]
            for col in ("LRl", "LRa"):
                m = var[col]["league_mean"]
                row[f"{per}_{col}"] = skill(d[col], m + d.ep, m)
        eng.append(row)
    best = max(eng, key=lambda r: r["train_LRl"]["skill_pct"])
    res["engine_rule"] = {"rows": eng, "chosen_on_train": best, "n": J.groupby("period").size().to_dict()}
    # opponent's predicted ratio: does it move my realized late ratio?
    col = "LRa"
    m = var[col]["league_mean"]; s2 = var[col]["total_var"] - var[col]["tau2_pretest"]
    pred, n = eb_walk(FF, col, grid[col]["chosen_on_train"]["tau2"], s2, m)
    FF["pred"] = pred
    O = FF[["fid", "idx", "pred"]].copy(); O["idx"] = 1 - O.idx
    Z = FF.merge(O.rename(columns={"pred": "opred"}), on=["fid", "idx"])
    opp = {}
    for per in ("train", "test"):
        z = Z[Z.period == per]
        mm = sm.OLS(z[col] - m, np.column_stack([z.pred - m, z.opred - m])).fit()
        opp[per] = {"own": float(mm.params.iloc[0]), "own_se": float(mm.bse.iloc[0]),
                    "opp": float(mm.params.iloc[1]), "opp_se": float(mm.bse.iloc[1]), "n": int(len(z))}
    res["opponent_effect"] = opp
    # current cardio estimates for everyone (all fights to the snapshot), with EB shrinkage
    t2 = grid["LRa"]["chosen_on_train"]["tau2"]; s2 = var["LRa"]["total_var"] - var["LRa"]["tau2_pretest"]
    m = var["LRa"]["league_mean"]
    cur = FF.groupby("pid").agg(slug=("slug", "last"), n=("LRa", "size"), mean=("LRa", "mean"),
                                last=("DATE", "max"))
    cur["w"] = cur.n * t2 / (cur.n * t2 + s2)
    cur["lr_hat"] = cur.w * (cur["mean"] - m)          # relative to the league mean
    cur["cardio_ratio"] = np.exp(cur.lr_hat)
    cur["sd_post"] = np.sqrt(t2 * (1 - cur.w))
    active = cur[(cur["last"] >= "2024-01-01") & (cur.n >= 5) & cur.slug.notna()].sort_values("lr_hat")
    res["current"] = {
        "tau2_used": t2, "noise_var_used": s2,
        "faders": [{"slug": r.slug, "n": int(r.n), "late_ratio": float(r.cardio_ratio), "post_sd": float(r.sd_post)}
                   for r in active.head(12).itertuples()],
        "surgers": [{"slug": r.slug, "n": int(r.n), "late_ratio": float(r.cardio_ratio), "post_sd": float(r.sd_post)}
                    for r in active.tail(12).iloc[::-1].itertuples()],
        "named": {sl: {"n": int(r.n), "late_ratio": float(r.cardio_ratio), "raw_mean_lr": float(r["mean"] - m),
                       "weight": float(r.w)}
                  for sl in ("alexander-volkanovski", "justin-gaethje")
                  for _, r in cur[cur.slug == sl].iterrows()},
        "spread_active_sd": float(active.lr_hat.std()),
    }
    res["cardio_by_slug"] = {r.slug: [round(float(r.cardio_ratio), 4), int(r.n)]
                             for r in cur[cur.slug.notna() & (cur["last"] >= "2019-01-01")].itertuples()}
    res["cellmeans_log_rate"] = cellmeans
    return res
