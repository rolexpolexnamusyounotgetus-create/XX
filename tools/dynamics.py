#!/usr/bin/env python3
"""
dynamics.py - v6 FIGHT DYNAMICS fits from round-level UFC stats.

Five studies, all walk-forward (fit on fights 2019-01-01..2023-12-31, report on 2024-01-01..2025-12-31;
2010-2018 used only as a labeled robustness extension; fights from 2026-01-01 are the sealed vault of the
hidden-data protocol in docs/BACKLOG.md and are never evaluated here):

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

Also: walk-forward form decomposition (profile vs fight-night form), round-by-round targets for the v6 check,
and an engine check (the same statistics on engine-simulated fights from tools/dynamics_engine.js).

Inputs:  data/raw/*.csv (via tools/baserates.load_data and tools/build_db people resolution),
         data/derived/backtest.json (engine pace fields, for the kPace check)
Outputs: data/derived/dynamics.json; progress printed; the report is research/model_dynamics.md

Usage:   python3 tools/dynamics.py                 (about 15 minutes on an idle 4-core machine)
         python3 tools/dynamics.py --quick         (no jackknife, no simulation check: about 8 minutes)
         python3 tools/dynamics.py --parts 2,5     (a subset; every run merges into the existing JSON
                                                    unless --fresh; --parts J reruns only the judges' labels)
         node tools/dynamics_engine.js /tmp/eng_tr.csv --sims 12 --from 2019-01-01 --to 2023-12-31 [--engine-dir src]
         python3 tools/dynamics.py --parts none --engine-csv /tmp/eng_tr.csv --engine-period train --engine-key K
         (engine checks against 2019-2023 real fights are for tuning; --engine-period test, the default and the
          2024-2025 window, is for version selection only)

Verification (Nov 6): tools/dynamics_audit.py re-derives the headline numbers with independent code; the
fixes it led to (published judges' round scores instead of an inferred label that looked ahead, held-out
refits, skip-round knockdown contrasts, train-window engine checks, the vault-free backtest file) are logged
at the end of research/model_dynamics.md.
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
TEST = ("2024-01-01", "2025-12-31")
VAULT_FROM = "2026-01-01"   # docs/BACKLOG.md hidden-data protocol: never evaluated here
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
    S = S.merge(F[["fid", "DATE", "division", "title", "five", "ko_target", "METHOD", "det", "REFEREE"]],
                on="fid", how="left")
    S["R"] = np.where(S.five, 5, 3)
    S = S.sort_values(["DATE", "fid", "idx", "rnd"]).reset_index(drop=True)
    # standing head landed (ufcstats does not cross head x position): midpoint of the bounds, as baserates
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
    S = add_cum(S)
    S["year"] = S.DATE.dt.year
    S["period"] = np.select([(S.DATE >= TRAIN[0]) & (S.DATE <= TRAIN[1]),
                             (S.DATE >= TEST[0]) & (S.DATE <= TEST[1]),
                             S.DATE >= VAULT_FROM,
                             (S.DATE >= EXT[0]) & (S.DATE <= EXT[1])], ["train", "test", "vault", "ext"], "old")
    slug = {k: v.get("slug") for k, v in people.items()}
    S["slug"] = S.pid.map(slug)
    dob = {k: (v.get("tott") or {}).get("dob") for k, v in people.items()}
    S["dob"] = pd.to_datetime(S.pid.map(dob))
    S["age"] = (S.DATE - S.dob).dt.days / 365.25
    return F, S, notes


CUM_SRC = {
    "c_att": "sig_a", "c_tot": "tot_a", "c_lnd": "sig_l", "c_hl": "head_l", "c_tda": "td_a", "c_tdl": "td_l",
    "c_ctrl": "ctrl", "c_kd": "kd", "c_sub": "sub",
    "c_oatt": "o_sig_a", "c_ohl": "o_head_l", "c_osl": "o_sig_l", "c_osh": "o_sh_l", "c_obl": "o_body_l",
    "c_oll": "o_leg_l", "c_ogl": "o_ground_l", "c_okd": "o_kd", "c_otdl": "o_td_l", "c_otda": "o_td_a",
    "c_octrl": "o_ctrl", "c_osub": "o_sub", "c_otot": "o_tot_l",
}
LAG_SRC = {"l_sigl": "sig_l", "l_osigl": "o_sig_l", "l_att": "sig_a", "l_oatt": "o_sig_a", "l_kd": "kd",
           "l_okd": "o_kd", "l_hl": "head_l", "l_ohl": "o_head_l", "l_tdl": "td_l", "l_otdl": "o_td_l",
           "l_ctrl": "ctrl", "l_octrl": "o_ctrl", "l_tda": "td_a", "l_sub": "sub",
           "l_osub": "o_sub", "l_bl": "body_l", "l_ll": "leg_l", "l_obl": "o_body_l", "l_oll": "o_leg_l"}


def add_cum(S):
    """Cumulative state before each round (same fight, same fighter) and previous-round values.
    Rows must be sorted by fight, fighter, round. Columns missing from S are skipped."""
    g = S.groupby(["fid", "idx"], sort=False)
    for c, src in CUM_SRC.items():
        if src in S:
            S[c] = g[src].cumsum() - S[src]
    S["c_min"] = g["mins"].cumsum() - S["mins"]
    for c, src in LAG_SRC.items():
        if src in S:
            S[c] = g[src].shift(1)
    return S


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


JR_ROWS = os.path.join(ROOT, "data", "derived", "judgerounds_rows.json")
JR_OK = ("agree", "agree_partial_panel", "totals_agree_names_differ")


def true_judge_labels(S):
    """Published per-round judges' scores (tools/judgerounds.py, MMA Decisions-derived, development file: no
    fight from 2026). Returns lab[(fid, idx, rnd)] = share of the three judges who gave round rnd to fighter idx
    (10-10 rounds count half), for fights whose cards are complete, agree with ufcstats and cover every round.

    Added by the Nov 6 verification: the inferred label of judge_labels() spreads each card's total over the
    rounds with a round-winner model fit on the stats of ALL rounds of the fight, so the label of round r-1 is
    partly a function of rounds r..R (the outcome being modeled and later rounds) and of the final result. It
    agrees with the published scores on 92% of rounds, but the test-period output coefficient moved from +0.009
    (published) to +0.034 (inferred) and the accuracy coefficient was attenuated by half."""
    J = json.load(open(JR_ROWS))
    R = pd.DataFrame(J["rounds"]["rows"], columns=J["rounds"]["cols"])
    R = R[R.complete & R.ufc_check.isin(JR_OK) & (R.nJ == 3) & (R.date < VAULT_FROM)]
    cover = R.groupby("fid").rnd.agg(["size", "max"])
    keep = set(cover[cover["size"] == cover["max"]].index)
    R = R[R.fid.isin(keep)]
    fk = dict(zip(S.fid.map(bd.url_id), S.fid))
    lab = {}
    for r in R.itertuples(index=False):
        f = fk.get(r.fid)
        if f is None:
            continue
        pA = (r.nA + 0.5 * r.nE) / r.nJ
        lab[(f, 0, int(r.rnd))] = pA
        lab[(f, 1, int(r.rnd))] = 1 - pA
    return lab


def fit_round_logit(S, F, period):
    """Round-winner logistic on clean sweeps (all cards 30-27 / 50-45) from the given period only."""
    d = F[F.cat.isin(["U-DEC"]) & (F.end_round == F.sched) & (F.end_sec == 300) &
          (F.DATE >= period[0]) & (F.DATE <= period[1])].copy()
    d["cards"] = d.det.map(br.parse_cards)
    d = d[d.cards.map(len) == 3]
    d = d[[len(c) == 3 and card_rounds_lost(c, int(R)) == [0, 0, 0] for c, R in zip(d.cards, d.sched)]]
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

    def fit(self, b0=None, la0=math.log(0.5), fixed_la=None):
        p0 = np.concatenate([np.zeros(len(self.xcols)) if b0 is None else b0, [la0]])
        if fixed_la is not None:
            fb = lambda b: self.negll(np.r_[b, fixed_la])
            gb = lambda b: self.grad(np.r_[b, fixed_la])[:-1]
            r = optimize.minimize(fb, p0[:-1], jac=gb, method="L-BFGS-B", options={"maxiter": 5000, "gtol": 1e-8})
            self.par = np.r_[r.x, fixed_la]
            self.ll = -r.fun
            k = len(r.x); H = np.zeros((k, k)); h = 1e-5
            for j in range(k):
                e = np.zeros(k); e[j] = h
                H[:, j] = (gb(r.x + e) - gb(r.x - e)) / (2 * h)
            Hinv = np.linalg.pinv((H + H.T) / 2)
            gb_obs, _ = self.grad_obs(self.par)
            C = self.c.max() + 1
            sc = np.column_stack([np.bincount(self.c, gb_obs[:, j], C) for j in range(k)])
            cov = Hinv @ (sc.T @ sc) @ Hinv
            self.cov = np.zeros((k + 1, k + 1)); self.cov[:k, :k] = cov
            return self
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
                 osh=("o_sh_l", "sum"), td_a=("td_a", "sum"), ctrl=("ctrl", "sum"), octrl=("o_ctrl", "sum"),
                 osig_a=("o_sig_a", "sum"), osig_l=("o_sig_l", "sum"))
            .reset_index().sort_values(["DATE", "fid", "idx"]))
    cols = ["mins", "sig_a", "sig_l", "kd", "okd", "sh", "osh", "td_a", "ctrl", "octrl", "osig_a", "osig_l"]
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
    S["H10"] = S.c_hl / 10                      # head sig strikes he landed on the opponent in earlier rounds, per 10
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
    "lostJ": "share of judges who gave the previous round to the opponent: published per-round scores (decisions only)",
    "lostJinf": "legacy inferred version of lostJ from card totals and all-round stats (looks ahead; comparison only)",
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
    # replication: the same model refit on the test period alone (a check, never used for selection)
    mt0 = DynRE(te, "y", "v", ["partial"], fixed_cells=m0.cells).fit(m0.p)
    mt1 = DynRE(te, "y", "v", xcols, fixed_cells=m0.cells).fit(m1.p)
    test_refit = {"gamma": mt1.gamma(), "var_components_null": mt0.var_components()}
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
        "test_refit": test_refit,
        "secs": time.time() - t0,
    }
    print(f"  [{label or name}] train n={m1.n_obs} test dLL/obs={out['heldout_one_step']['dll_per_obs']:+.4f} "
          f"MSE -{out['heldout_one_step']['mse_reduction_pct']:.2f}%  ({out['secs']:.0f}s)", flush=True)
    return out, m0, m1


def form_decomposition(S, jack=0):
    """Fight-night form vs profile: the dynamic-RE null for output and accuracy with the walk-forward pre-fight
    expectation as a covariate (attacker's rate x defender's allowed rate, shrunk: 40 minutes / 150 attempts).
    The residual fighter-in-fight effect is what the engine's form draws must supply (an upper bound: profile
    noise stays in it); its correlation between the two fighters is the shared fight pace."""
    d0 = S.copy()
    tr0 = d0[d0.period == "train"]
    L = tr0.sig_a.sum() / tr0.mins.sum()
    La = tr0.sig_l.sum() / tr0.sig_a.sum()
    H = person_history(d0, 0.0088)
    H["attpm"] = (H.h_sig_a + 40 * L) / (H.h_mins + 40)
    H["oattpm"] = (H.h_osig_a + 40 * L) / (H.h_mins + 40)
    H["acc"] = (H.h_sig_l + 150 * La) / (H.h_sig_a + 150)
    H["oacc"] = (H.h_osig_l + 150 * La) / (H.h_osig_a + 150)
    O = H[["fid", "idx", "oattpm", "oacc"]].copy(); O["idx"] = 1 - O.idx
    d0 = d0.merge(H[["fid", "idx", "attpm", "acc", "h_n"]], on=["fid", "idx"], how="left")
    d0 = d0.merge(O.rename(columns={"oattpm": "opp_allow_att", "oacc": "opp_allow_acc"}), on=["fid", "idx"], how="left")
    d0["x_out_att"] = np.log(d0.attpm / L)
    d0["x_out_def"] = np.log(d0.opp_allow_att / L)
    lg = math.log(La / (1 - La))
    d0["x_acc_att"] = np.log(d0.acc / (1 - d0.acc)) - lg
    d0["x_acc_def"] = np.log(d0.opp_allow_acc / (1 - d0.opp_allow_acc)) - lg
    out = {"league_att_pm": L, "league_acc": La}
    for name, xs in (("out", ["x_out_att", "x_out_def"]), ("acc", ["x_acc_att", "x_acc_def"])):
        d = prep_outcome(d0, name)
        tr = d[d.period == "train"]
        te = d[d.period == "test"]
        m0 = DynRE(tr, "y", "v", ["partial"]).fit()
        m1 = DynRE(tr, "y", "v", ["partial"] + xs, fixed_cells=m0.cells).fit(m0.p)
        p0 = m0.predictive(DynRE(te, "y", "v", ["partial"], fixed_cells=m0.cells))
        p1 = m1.predictive(DynRE(te, "y", "v", ["partial"] + xs, fixed_cells=m0.cells))
        vc = m1.var_components()
        sa, rho = vc["sd_fighter_fight"], vc["corr_fighters"]
        mt = DynRE(te, "y", "v", ["partial"] + xs, fixed_cells=m0.cells).fit(m1.p)
        vt = mt.var_components()
        out[name + "_test_refit"] = {"with_profile": vt, "gamma": mt.gamma(),
                                     "form_sd_individual": math.sqrt(max(vt["sd_fighter_fight"] ** 2 * (1 - vt["corr_fighters"]), 0)),
                                     "form_sd_shared_fight": math.sqrt(max(vt["sd_fighter_fight"] ** 2 * vt["corr_fighters"], 0))}
        out[name] = {"null": m0.var_components(), "with_profile": vc, "gamma": m1.gamma(),
                     "form_sd_individual": math.sqrt(max(sa ** 2 * (1 - rho), 0)),
                     "form_sd_shared_fight": math.sqrt(max(sa ** 2 * rho, 0)) if rho > 0 else 0.0,
                     "heldout_one_step_profile_vs_null_dll": (p1["ll"] - p0["ll"]) / max(p1["n"], 1)}
        print(f"  [form {name}] {vc}", flush=True)
    return out


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
    # backtest_dev.json: the development copy without 2026 fights (hidden-data protocol); the pace fields are
    # walk-forward (tools/build_db.py builds them from fights before each one)
    bt = json.load(open(os.path.join(ROOT, "data", "derived", "backtest_dev.json")))
    rows = []
    for f in bt["fights"]:
        if f["date"] >= VAULT_FROM:
            continue
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


# ================================================================================================
# part 3: judges' consensus labels
# ================================================================================================
def part3_judges(F, S, xbase, jack=0):
    """lostJ = share of the three judges who gave the previous round to the opponent, from the PUBLISHED
    per-round scores (true_judge_labels). The earlier inferred label (judge_labels) is kept as lostJinf on the
    same fights for comparison only: it looks ahead (see true_judge_labels)."""
    coef, cse, nclean = fit_round_logit(S, F, TRAIN)
    lab_inf, sure, nk = judge_labels(F, S, coef)
    lab = true_judge_labels(S)
    d = S.copy()
    key_prev = list(zip(d.fid, d.idx, d.rnd - 1))
    d["lostJ"] = [1 - lab[k] if k in lab else np.nan for k in key_prev]
    d["lostJinf"] = [1 - lab_inf[k] if k in lab_inf else np.nan for k in key_prev]
    labeled = set(f for f, _, _ in lab.keys()) & set(f for f, _, _ in lab_inf.keys())
    D = d[d.fid.isin(labeled)].copy()
    D.loc[D.rnd == 1, ["lostJ", "lostJinf"]] = 0.0
    D = D[D.lostJ.notna() & D.lostJinf.notna()]
    # agreement of the labels on rounds 1..R-1 (previous-round labels)
    a = D[D.rnd >= 2]
    agree = float(((a.lostJ > 0.5) == (a.lost > 0.5)).mean())
    res = {"label_source": "published per-round judges' scores (data/derived/judgerounds_rows.json: complete cards that "
                           "agree with ufcstats, all rounds covered); lostJinf = the earlier inferred label (looks ahead)",
           "round_logit_train": {"coef": coef, "se": cse, "n_clean_fights": nclean},
           "n_decisions_labeled_inferred": nk, "n_fights_in_sample": int(D.fid.nunique()),
           "n_fights_by_period": D.groupby("period").fid.nunique().to_dict(),
           "share_fights_all_cards_sweep": float(np.mean([v for f, v in sure.items() if f in labeled])),
           "agreement_lostJ_vs_lost_sig": agree,
           "agreement_lostJinf_vs_lostJ": float(((a.lostJinf > 0.5) == (a.lostJ > 0.5)).mean()),
           "corr_lostJinf_vs_lostJ": float(np.corrcoef(a.lostJinf, a.lostJ)[0, 1]), "models": {}}
    xs = [x for x in xbase if x not in ("lost", "behind2_final", "partial")]
    for name in ("out", "acc"):
        for lab_name, xc in (("judges", xs + ["lostJ"]), ("sig_diff", xs + ["lost"]), ("both", xs + ["lostJ", "lost"]),
                             ("judges_inferred_legacy", xs + ["lostJinf"])):
            dd = prep_outcome(D, name)
            tr = dd[dd.period == "train"]; te = dd[dd.period == "test"]
            m = DynRE(tr, "y", "v", xc).fit()
            g = m.gamma()
            if jack and lab_name in ("judges", "sig_diff") and name == "out":
                def ffit(df):
                    mm = DynRE(df, "y", "v", xc, fixed_cells=m.cells).fit(m.p)
                    return {k: v["est"] for k, v in mm.gamma().items()}
                _, jse = grouped_jackknife(ffit, tr, G=jack)
                for k in g:
                    g[k]["se_jack"] = jse[k]
            mt = DynRE(te, "y", "v", xc, fixed_cells=m.cells)
            # test-period refit for a direct replication of the label effect
            mtest = DynRE(te, "y", "v", xc).fit(m.p)
            res["models"][f"{name}_{lab_name}"] = {
                "gamma": {k: g[k] for k in g if k in ("lostJ", "lostJinf", "lost", "D10", "K_lag", "Ks_lag")},
                "test_refit": {k: v for k, v in mtest.gamma().items() if k in ("lostJ", "lostJinf", "lost")},
                "n_train": m.n_obs, "n_test": mt.n_obs}
            print(f"  [judges {name} {lab_name}] " + ", ".join(f"{k} {v['est']:+.3f}"
                                                            for k, v in g.items() if k in ("lostJ", "lostJinf", "lost")), flush=True)
    # takedown attempts with the judges' label
    dd = D[D.rsec >= 30].copy()
    cells = sorted(dd.cell.unique())
    for c in cells:
        dd["c" + c] = (dd.cell == c).astype(float)
    cc = ["c" + c for c in cells]
    for lab_name, xc in (("judges", xs + ["lostJ"]), ("sig_diff", xs + ["lost"]),
                         ("judges_inferred_legacy", xs + ["lostJinf"])):
        tr = dd[dd.period == "train"]; te = dd[dd.period == "test"]
        m = FrailPois(tr, "td_a", "mins", cc + xc).fit()
        mte = FrailPois(te, "td_a", "mins", cc + xc).fit()
        co = m.coef()
        keys = ("lostJ", "lostJinf", "lost")
        res["models"][f"tda_{lab_name}"] = {"gamma": {k: co[k] for k in keys if k in co},
                                            "test_refit": {k: mte.coef()[k] for k in keys if k in co}}
    return res


# ================================================================================================
# part 4: knockdown momentum (descriptive diff-in-diff next to the model coefficients)
# ================================================================================================
def part4_descriptive(S):
    d = S[S.full].copy().sort_values(["fid", "idx", "rnd"])
    d["y"] = np.log((d.sig_a + 0.5) / 5)
    d["acc_l"] = np.log((d.sig_l + 0.5) / (d.sig_a - d.sig_l + 0.5))
    d["tda"] = d.td_a
    g = d.groupby(["fid", "idx"])
    for c in ("y", "acc_l", "tda"):
        d["d_" + c] = d[c] - g[c].shift(1)
    d = d[(d.rnd >= 2) & d["d_y"].notna()]
    grp = np.select([(d.l_okd >= 1) & (d.l_kd == 0), (d.l_kd >= 1) & (d.l_okd == 0), (d.l_kd == 0) & (d.l_okd == 0)],
                    ["dropped_prev_round", "scored_kd_prev_round", "no_kd_prev_round"], "both")
    d["grp"] = grp
    out = {}
    for per in ("train", "test"):
        x = d[d.period == per]
        rows = {}
        ctrl = x[x.grp == "no_kd_prev_round"]
        cm = ctrl.groupby("cell")[["d_y", "d_acc_l", "d_tda"]].mean()
        for gname in ("dropped_prev_round", "scored_kd_prev_round", "no_kd_prev_round"):
            z = x[x.grp == gname]
            adj = z[["d_y", "d_acc_l", "d_tda"]].to_numpy() - cm.reindex(z.cell).to_numpy()
            rows[gname] = {"n": int(len(z)),
                           "d_log_output_vs_control": float(np.nanmean(adj[:, 0])),
                           "se": float(np.nanstd(adj[:, 0]) / math.sqrt(max(len(z), 1))),
                           "d_logit_acc_vs_control": float(np.nanmean(adj[:, 1])),
                           "d_td_att_vs_control": float(np.nanmean(adj[:, 2]))}
        out[per] = rows
    out["skip_round"] = {"+".join(p): kd_skip_round(S, p) for p in (("train",), ("ext", "train"), ("test",))}
    return out


def kd_skip_round(S, periods):
    """Added by the Nov 6 verification. Output of the knockdown scorer / the dropped man in round r+1 compared
    with round r-1 (the round BEFORE the knockdown round), against fighter-fights with no knockdown in r-1 and r
    (same format and round). Rounds r-1 and r full; r+1 at least 60 s at its per-minute rate, any events (no
    selection on what happens after the knockdown round). The dynamic RE coefficients Ks_lag / K_lag are relative
    to an expectation that already contains the knockdown round's own output (the scorer's spike, the dropped
    man's dip); an engine multiplier on the baseline rate should match this skip-round contrast instead."""
    x = S[S.period.isin(list(periods))].copy()
    x["y"] = np.log((x.sig_a + 0.5) / x.mins)
    key = ["fid", "idx"]
    P = {c: x.pivot_table(index=key, columns="rnd", values=c) for c in ("y", "kd", "o_kd", "rsec")}
    Rr = x.groupby(key).R.first()
    rows = []
    for r in (2, 3, 4):
        if r + 1 not in P["y"].columns:
            continue
        q = lambda c, rr: P[c][rr]
        ok = (q("rsec", r - 1) >= 300) & (q("rsec", r) >= 300) & (q("rsec", r + 1) >= 60)
        ok &= (q("kd", r - 1) == 0) & (q("o_kd", r - 1) == 0)
        for lab, sel in (("scorer", ok & (q("kd", r) >= 1) & (q("o_kd", r) == 0)),
                         ("dropped", ok & (q("o_kd", r) >= 1) & (q("kd", r) == 0)),
                         ("control", ok & (q("kd", r) == 0) & (q("o_kd", r) == 0))):
            for i in sel[sel].index:
                rows.append((lab, f"{Rr[i]}_{r}", P["y"].loc[i, r] - P["y"].loc[i, r - 1],
                             P["y"].loc[i, r + 1] - P["y"].loc[i, r], P["y"].loc[i, r + 1] - P["y"].loc[i, r - 1]))
    D = pd.DataFrame(rows, columns=["grp", "cell", "kd_round_vs_before", "after_vs_kd_round", "after_vs_before"])
    cols = ["kd_round_vs_before", "after_vs_kd_round", "after_vs_before"]
    cm = D[D.grp == "control"].groupby("cell")[cols].mean()
    res = {"n_control": int((D.grp == "control").sum())}
    for lab in ("scorer", "dropped"):
        z = D[D.grp == lab]
        adj = z[cols].to_numpy() - cm.reindex(z.cell).to_numpy()
        res[lab] = {"n": int(len(z))}
        for j, c in enumerate(cols):
            res[lab][c] = {"est": float(np.nanmean(adj[:, j])), "se": float(np.nanstd(adj[:, j]) / math.sqrt(max(len(z), 1)))}
    return res


# ================================================================================================
# part 5: finish hazard vs accumulated damage
# ================================================================================================
def damage_bin(D):
    return pd.cut(D, [-0.1, 0.5, 20, 40, 60, 1e9], labels=["0 (R1)", "1-20", "21-40", "41-60", "61+"])


def part5(S, F):
    d = S.copy().sort_values(["fid", "idx", "rnd"])
    tr0 = d[d.period == "train"]
    p0 = tr0.o_kd.sum() / tr0.o_sh_l.sum()
    H = person_history(d, p0)
    d = d.merge(H[["fid", "idx", "chin_idx", "pow_idx"]], on=["fid", "idx"], how="left")
    O = H[["fid", "idx", "pow_idx"]].copy(); O["idx"] = 1 - O.idx
    d = d.merge(O.rename(columns={"pow_idx": "opow"}), on=["fid", "idx"], how="left")
    dv = tr0.groupby("division").apply(lambda x: x.o_kd.sum() / max(x.o_sh_l.sum(), 1), include_groups=False)
    d["ldiv"] = np.log(d.division.map(dv).fillna(p0) / p0)
    d["lchin"] = np.log(d.chin_idx.fillna(1.0)); d["lpow"] = np.log(d.opow.fillna(1.0))
    d = d.sort_values(["fid", "idx", "rnd"]).reset_index(drop=True)
    cells = sorted(d.cell.unique())
    for c in cells:
        d["c" + c] = (d.cell == c).astype(float)
    cc = ["c" + c for c in cells]
    pre = ["ldiv", "lchin", "lpow"]
    tr, te = d[d.period == "train"], d[d.period == "test"]
    res = {"p0_kd_per_standing_head_train": float(p0)}
    # ---- (a) knockdowns per landed standing head strike absorbed
    specs = {"null": cc + pre, "damage": cc + pre + ["D10", "K_lag", "K_early"],
             "fatigue": cc + pre + ["A100", "oA100"],
             "full": cc + pre + ["D10", "K_lag", "K_early", "A100", "oA100"]}
    kd = {}
    fitted = {}
    for nm, X in specs.items():
        m = FrailPois(tr, "o_kd", "o_sh_l", X).fit()
        mt = FrailPois(te, "o_kd", "o_sh_l", X)
        llt, pred, mu = m.score_other(mt)
        fitted[nm] = (m, mt, pred)
        co = m.coef()
        kd[nm] = {"coef": {k: v for k, v in co.items()}, "train_ll": m.ll, "test_ll": llt, "n_train": m.n,
                  "kd_train": float(tr.o_kd.sum()), "kd_test": float(te.o_kd.sum())}
        print(f"  [kd {nm}] test ll {llt:.1f} frailty {co['frailty_var']['est']:.2f}", flush=True)
    # no-frailty comparison (Poisson, alpha fixed tiny) for the damage spec
    for nm in ("null", "damage"):
        X = specs[nm]
        m = FrailPois(tr, "o_kd", "o_sh_l", X).fit(fixed_la=math.log(1e-6))
        llt, _, _ = m.score_other(FrailPois(te, "o_kd", "o_sh_l", X))
        kd[nm + "_nofrailty"] = {"coef": {k: v for k, v in m.coef().items() if k != "frailty_var"},
                                 "train_ll": m.ll, "test_ll": llt}
    # round profile of the per-strike hazard (structural, given frailty), null spec
    co = kd["null"]["coef"]
    prof = {}
    for R in (3, 5):
        b = co[f"c{R}_1"]["est"]
        prof[str(R)] = [math.exp(co[f"c{R}_{r}"]["est"] - b) for r in range(1, R + 1)]
    kd["round_profile_given_frailty"] = prof
    m_nf = FrailPois(tr, "o_kd", "o_sh_l", specs["null"]).fit(fixed_la=math.log(1e-6))
    co2 = m_nf.coef()
    kd["round_profile_marginal"] = {str(R): [math.exp(co2[f"c{R}_{r}"]["est"] - co2[f"c{R}_1"]["est"])
                                             for r in range(1, R + 1)] for R in (3, 5)}
    # calibration on test by prior damage and by round (sequential predictive means, damage spec)
    m, mt, pred = fitted["damage"]
    z = mt.d.assign(pred=pred)
    z["Dbin"] = damage_bin(z.c_ohl)
    cal = z.groupby("Dbin", observed=True).agg(obs=("o_kd", "sum"), pred=("pred", "sum"), sh=("o_sh_l", "sum"),
                                               n=("o_kd", "size"))
    m0_, mt0_, pred0 = fitted["null"]
    z0 = mt0_.d.assign(pred=pred0); z0["Dbin"] = damage_bin(z0.c_ohl)
    cal0 = z0.groupby("Dbin", observed=True).pred.sum()
    kd["test_calibration_by_prior_damage"] = {
        str(k): {"obs": float(r.obs), "pred_damage_model": float(r.pred), "pred_null_model": float(cal0[k]),
                 "kd_per_100_standing_head_obs": 100 * float(r.obs / r.sh), "rounds": int(r.n)}
        for k, r in cal.iterrows()}
    calr = z.groupby("cell").agg(obs=("o_kd", "sum"), pred=("pred", "sum"), sh=("o_sh_l", "sum"))
    kd["test_calibration_by_round"] = {k: {"obs": float(r.obs), "pred": float(r.pred),
                                           "per100_obs": 100 * float(r.obs / r.sh)} for k, r in calr.iterrows()}
    # do the two directions share a fight-level volatility? correlation of per-fighter-fight Pearson residuals
    mnf = FrailPois(tr, "o_kd", "o_sh_l", specs["null"]).fit(fixed_la=math.log(1e-6))
    q = mnf.d.assign(mu=np.exp(mnf.lE + mnf.X @ mnf.par[:-1]))
    agg = q.groupby(["fid", "idx"]).agg(y=("o_kd", "sum"), mu=("mu", "sum")).reset_index()
    agg["r"] = (agg.y - agg.mu) / np.sqrt(agg.mu)
    pv = agg.pivot(index="fid", columns="idx", values="r").dropna()
    pva = agg.pivot(index="fid", columns="idx", values="y").dropna()
    kd["direction_residual_corr"] = {"pearson": float(np.corrcoef(pv[0], pv[1])[0, 1]), "n_fights": int(len(pv))}
    kd["shared_volatility_check"] = vol_check(d, mnf)
    # round profile with the 2010-2023 window (more five-round fights; still before the test period)
    ext = d[d.period.isin(["ext", "train"])]
    me = FrailPois(ext, "o_kd", "o_sh_l", specs["null"]).fit()
    coe = me.coef()
    kd["round_profile_given_frailty_2010_2023"] = {
        str(R): [math.exp(coe[f"c{R}_{r}"]["est"] - coe[f"c{R}_1"]["est"]) for r in range(1, R + 1)] for R in (3, 5)}
    kd["round_profile_se_log_2010_2023"] = {str(R): [coe[f"c{R}_{r}"]["se"] for r in range(1, R + 1)] for R in (3, 5)}
    kd["frailty_2010_2023"] = coe["frailty_var"]
    # pooled rounds 4-5 of five-round fights (sparse): refit with a merged cell
    for lab, dd in (("train", tr), ("2010_2023", ext)):
        z = dd.copy(); z["c5_4"] = z["c5_4"] + z["c5_5"]
        Xp = [c for c in specs["null"] if c != "c5_5"]
        mp = FrailPois(z, "o_kd", "o_sh_l", Xp).fit()
        cp = mp.coef()
        kd[f"five_round_profile_r45_pooled_{lab}"] = [math.exp(cp[f"c5_{r}"]["est"] - cp["c5_1"]["est"]) for r in (1, 2, 3, 4)]
    # per-round decline in the 3-round format: KD-only vs all KO/TKO, and the R1 rate level
    kd["r1_rate_per_standing_head_given_frailty_3rd"] = math.exp(co["c3_1"]["est"])
    res["kd_hazard"] = kd
    # ---- (b) knockdown -> finish conversion, per knockdown (geometric within the round)
    import statsmodels.api as sm
    k_rows = []
    kr = d[d.o_kd >= 1]
    for r in kr.itertuples(index=False):
        n = int(r.o_kd)
        fin = int(r.fin_ko_against)
        for j in range(n):
            k_rows.append({"y": int(fin and j == n - 1), "D10": r.D10, "kd_index": r.c_okd + j,
                           "rnd0": r.rnd - 1, "five": float(r.R == 5), "lpow": r.lpow, "lchin": r.lchin,
                           "ldiv": r.ldiv, "period": r.period, "fid": r.fid, "first_in_round": float(j == 0),
                           "A100": r.A100, "oA100": r.oA100})
    K = pd.DataFrame(k_rows)
    conv = {}
    Xs = {"null": ["rnd0", "five", "ldiv"], "damage": ["rnd0", "five", "ldiv", "D10", "kd_index"],
          "full": ["rnd0", "five", "ldiv", "D10", "kd_index", "lpow", "lchin", "oA100"]}
    for nm, X in Xs.items():
        a = K[K.period == "train"]; b = K[K.period == "test"]
        mm = sm.Logit(a.y, sm.add_constant(a[X])).fit(disp=0, cov_type="cluster",
                                                      cov_kwds={"groups": pd.factorize(a.fid)[0]})
        pb = mm.predict(sm.add_constant(b[X]))
        llt = float((b.y * np.log(pb) + (1 - b.y) * np.log(1 - pb)).sum())
        conv[nm] = {"coef": {k: {"est": float(mm.params[k]), "se": float(mm.bse[k])} for k in ["const"] + X},
                    "test_ll": llt, "n_train": int(len(a)), "n_test": int(len(b)),
                    "rate_train": float(a.y.mean()), "rate_test": float(b.y.mean()),
                    "pred_test_mean": float(pb.mean())}
    K["Dbin"] = damage_bin(K.D10 * 10)
    conv["empirical_by_prior_damage"] = {per: {str(k): {"rate": float(g.y.mean()), "n": int(len(g))}
                                               for k, g in K[K.period == per].groupby("Dbin", observed=True)}
                                         for per in ("train", "test")}
    conv["empirical_by_kd_index"] = {per: {str(int(k)): {"rate": float(g.y.mean()), "n": int(len(g))}
                                           for k, g in K[K.period == per].groupby(K.kd_index.clip(upper=3))}
                                     for per in ("train", "test")}
    conv["empirical_by_round"] = {per: {f"{int(f5) and 5 or 3}_{int(r0) + 1}": {"rate": float(g.y.mean()), "n": int(len(g))}
                                        for (f5, r0), g in K[K.period == per].groupby(["five", "rnd0"])}
                                  for per in ("train", "test")}
    res["kd_conversion"] = conv
    # ---- (c) non-knockdown stoppages (standing TKO, ground TKO), joint frailty with the knockdown process
    d["ko_ground"] = d.ko_pos.eq("ground")
    d["st_y"] = ((d.fin_ko_against == 1) & (d.o_kd == 0) & ~d.ko_ground).astype(float)
    d["gt_y"] = ((d.fin_ko_against == 1) & (d.o_kd == 0) & d.ko_ground).astype(float)
    base = ["rnd0", "five"]
    d["rnd0"] = d.rnd - 1; d["five"] = (d.R == 5).astype(float); d["K_prior"] = d.c_okd
    stack = []
    for typ, ycol, ecol in (("kd", "o_kd", "o_sh_l"), ("st", "st_y", "o_sh_l"), ("gt", "gt_y", "o_ground_l")):
        z = d[["g", "fid", "period", ycol, ecol] + cc + pre + ["D10", "K_prior", "rnd0", "five"]].copy()
        z = z.rename(columns={ycol: "yy", ecol: "EE"})
        z["typ"] = typ
        stack.append(z)
    Z = pd.concat(stack, ignore_index=True)
    xcols = []
    for typ in ("kd", "st", "gt"):
        ind = (Z.typ == typ).astype(float)
        if typ == "kd":
            for c in cc:
                Z[f"{typ}:{c}"] = ind * Z[c]; xcols.append(f"{typ}:{c}")
        else:
            Z[f"{typ}:const"] = ind; xcols.append(f"{typ}:const")
            for c in ("rnd0", "five"):
                Z[f"{typ}:{c}"] = ind * Z[c]; xcols.append(f"{typ}:{c}")
        for c in pre + ["D10", "K_prior"]:
            Z[f"{typ}:{c}"] = ind * Z[c]; xcols.append(f"{typ}:{c}")
    Z = Z.sort_values(["g", "typ"]).reset_index(drop=True)
    jt = {}
    for lab, fl in (("joint_frailty", None), ("no_frailty", math.log(1e-6))):
        a = Z[Z.period == "train"]; b = Z[Z.period == "test"]
        m = FrailPois(a, "yy", "EE", xcols).fit(fixed_la=fl)
        llt, _, _ = m.score_other(FrailPois(b, "yy", "EE", xcols))
        co = m.coef()
        jt[lab] = {"coef": {k: v for k, v in co.items() if not (k.startswith("kd:c"))}, "test_ll": llt}
    jt["events_train"] = {"st": float(d.loc[d.period == "train", "st_y"].sum()),
                          "gt": float(d.loc[d.period == "train", "gt_y"].sum()),
                          "kd": float(d.loc[d.period == "train", "o_kd"].sum())}
    jt["events_test"] = {"st": float(d.loc[d.period == "test", "st_y"].sum()),
                         "gt": float(d.loc[d.period == "test", "gt_y"].sum())}
    jt["rate_per_standing_head_st_train"] = float(d.loc[d.period == "train", "st_y"].sum() /
                                                  d.loc[d.period == "train", "o_sh_l"].sum())
    jt["rate_per_ground_strike_gt_train"] = float(d.loc[d.period == "train", "gt_y"].sum() /
                                                  d.loc[d.period == "train", "o_ground_l"].sum())
    res["non_kd_stoppage"] = jt
    # ---- (d) empirical finish hazard tables
    tab = {}
    for per in ("train", "test"):
        x = d[d.period == per]
        t = {}
        for (R, r), g in x.groupby(["R", "rnd"]):
            t[f"{R}_{r}"] = {"rounds": int(len(g)), "p_stopped_by_strikes": float(g.fin_ko_against.mean()),
                             "p_kd_absorbed": float((g.o_kd >= 1).mean()),
                             "stoppages_per_100_head_absorbed": 100 * float(g.fin_ko_against.sum() /
                                                                            max(g.o_head_l.sum(), 1))}
        xb = x[x.rnd >= 2].copy()
        xb["Dbin"] = damage_bin(xb.c_ohl)
        byd = {}
        for k, g in xb.groupby("Dbin", observed=True):
            byd[str(k)] = {"rounds": int(len(g)), "p_stopped_by_strikes": float(g.fin_ko_against.mean()),
                           "stoppages_per_100_head_absorbed": 100 * float(g.fin_ko_against.sum() / max(g.o_head_l.sum(), 1)),
                           "kd_per_100_standing_head": 100 * float(g.o_kd.sum() / max(g.o_sh_l.sum(), 1)),
                           "head_absorbed_per_min": float(g.o_head_l.sum() / g.mins.sum())}
        tab[per] = {"by_round": t, "by_prior_damage_rounds2plus": byd}
    res["hazard_tables"] = tab
    return res



def targets(S):
    """Empirical round-by-round targets for the v6 check (simulated vs real fights): per format and round,
    over all fighter-rounds started (partial final rounds included at their real length)."""
    out = {}
    for per in ("train", "test"):
        x = S[S.period == per]
        t = {}
        for (R, r), g in x.groupby(["R", "rnd"]):
            m = g.mins.sum()
            t[f"{R}_{r}"] = {
                "fighter_rounds": int(len(g)), "share_full": float(g.full.mean()),
                "sig_att_pm": float(g.sig_a.sum() / m), "sig_lnd_pm": float(g.sig_l.sum() / m),
                "sig_acc": float(g.sig_l.sum() / max(g.sig_a.sum(), 1)),
                "head_share_landed": float(g.head_l.sum() / max(g.sig_l.sum(), 1)),
                "leg_share_landed": float(g.leg_l.sum() / max(g.sig_l.sum(), 1)),
                "td_att_per15": float(15 * g.td_a.sum() / m), "td_acc": float(g.td_l.sum() / max(g.td_a.sum(), 1)),
                "ctrl_share": float(g.ctrl.sum() / g.rsec.sum()),
                "kd_per100_standing_head": float(100 * g.kd.sum() / max(g.sh_l.sum(), 1)),
                "p_round_ends_ko_tko": float(g.fin_ko_against.sum() / (len(g) / 2)),
                "p_round_ends_sub": float(g.fin_sub_against.sum() / (len(g) / 2)),
                "n_rounds": int(len(g) // 2), "n_ko_tko": int(g.fin_ko_against.sum()), "n_sub": int(g.fin_sub_against.sum()),
                "n_kd": int(g.kd.sum()),
            }
        out[per] = t
    return out


def round_corr(S):
    """Correlation of a fighter's log sig attempts per minute between rounds of the same fight (full rounds),
    and of the two fighters within a round: the shape the engine's form / pace / round noise must produce."""
    x = S[S.full & S.period.isin(["train"])].copy()
    x["y"] = np.log((x.sig_a + 0.5) / 5)
    w = x.pivot_table(index=["fid", "idx"], columns="rnd", values="y")
    out = {"own_r1_r2": float(w[[1, 2]].dropna().corr().iloc[0, 1]),
           "own_r1_r3": float(w[[1, 3]].dropna().corr().iloc[0, 1]),
           "own_r2_r3": float(w[[2, 3]].dropna().corr().iloc[0, 1])}
    b = x.pivot_table(index=["fid", "rnd"], columns="idx", values="y").dropna()
    out["fighters_same_round"] = float(b.corr().iloc[0, 1])
    return out


# ================================================================================================
# engine check: the same dynamics statistics on engine-simulated fights (tools/dynamics_engine.js)
# ================================================================================================
ENG_RENAME = {"sig_att": "sig_a", "sig_lnd": "sig_l", "h_att": "head_a", "h_lnd": "head_l", "d_att": "dist_a",
              "d_lnd": "dist_l", "c_att": "clinch_a", "c_lnd": "clinch_l", "g_att": "ground_a", "g_lnd": "ground_l",
              "td_att": "td_a", "td_lnd": "td_l", "sub_att": "sub", "sh_lnd": "sh_l", "b_lnd": "body_l",
              "l_lnd": "leg_l"}


def engine_panel(csv, max_sims=None):
    E = pd.read_csv(csv)
    if max_sims is not None:
        E = E[E.sim < max_sims]
    E["fkey"] = E.fid.astype(str)
    E["fid"] = E.fkey + ":" + E.sim.astype(str)
    E = E.rename(columns=ENG_RENAME)
    E["rsec"] = E.rsec.clip(lower=1)
    E["mins"] = E.rsec / 60
    E["full"] = E.rsec >= 299.5
    E["tot_a"] = E.sig_a; E["tot_l"] = E.sig_l
    oc = ["sig_a", "sig_l", "head_l", "sh_l", "body_l", "leg_l", "ground_l", "kd", "td_l", "td_a", "ctrl", "sub",
          "tot_l", "dist_a"]
    O = E[["fid", "rnd", "idx"] + oc].copy(); O["idx"] = 1 - O.idx
    E = E.merge(O.rename(columns={c: "o_" + c for c in oc}), on=["fid", "rnd", "idx"], how="left")
    E = E.sort_values(["fid", "idx", "rnd"]).reset_index(drop=True)
    E["last"] = E.rnd == E.groupby("fid").rnd.transform("max")
    opp_side = np.where(E.idx == 0, "B", "A")
    strikes = E.method.isin(["KO", "TKO", "GNP", "LEG"])
    E["fin_ko_against"] = (E["last"] & (E.winner == opp_side) & strikes & (E.fin_round == E.rnd)).astype(int)
    E["fin_sub_against"] = (E["last"] & (E.winner == opp_side) & E.method.eq("SUB") & (E.fin_round == E.rnd)).astype(int)
    E = add_cum(E)
    E["period"] = "test"
    E["division"] = E.division.astype(str)
    return add_covariates(E)


def late_ratio_simple(S):
    full = S[S.full].copy()
    full["la"] = np.log((full.sig_a + 0.5) / 5)
    cm = full.groupby("cell").la.mean()
    full["la_c"] = full.la - full.cell.map(cm)
    full = full.sort_values(["fid", "idx", "rnd"])
    first = full.groupby(["fid", "idx"]).head(1).set_index(["fid", "idx"])
    late = full[full.rnd >= 2].groupby(["fid", "idx"]).agg(alate=("la_c", "mean"), T=("rnd", "max"), n=("rnd", "size"))
    FF = first[["la_c"]].join(late, how="inner")
    FF = FF[FF.n == FF["T"] - 1]
    FF["LR"] = FF.alate - FF.la_c
    return FF.reset_index()


def engine_check(S, csv, label, real_period="test"):
    """real_period: the window of the real fights the engine sims are compared with. Use "train" (sims from
    `node tools/dynamics_engine.js <csv> --from 2019-01-01 --to 2023-12-31`) for anything that tunes the engine;
    "test" (2024-2025) is for version selection only (hidden-data protocol)."""
    t0 = time.time()
    E = engine_panel(csv)
    keys = set(E.fkey.unique())
    real = S[(S.period == real_period) & S.fid.map(bd.url_id).isin(keys)].copy()
    res = {"engine_csv": csv, "label": label, "real_period": real_period, "n_engine_fights": int(E.fid.nunique()),
           "n_matchups": int(len(keys)), "n_real_fights": int(real.fid.nunique())}
    Es = E[E.sim < 8].copy()
    # 1-2: output and accuracy dynamics
    dyn = {}
    for name in ("out", "acc"):
        row = {}
        for lab, d0 in (("engine", Es), ("real", real)):
            d = prep_outcome(d0, name)
            m0 = DynRE(d, "y", "v", ["partial"]).fit()
            m1 = DynRE(d, "y", "v", STATE_X, fixed_cells=m0.cells).fit(m0.p)
            cells0 = {k[5:]: v for k, v in m0.est().items() if k.startswith("cell:")}
            curve = {str(R): [math.exp(cells0[f"{R}_{r}"] - cells0[f"{R}_1"]) for r in range(1, R + 1)
                              if f"{R}_{r}" in cells0] for R in (3, 5) if f"{R}_1" in cells0}
            row[lab] = {"var_components_null": m0.var_components(), "round_curve": curve,
                        "gamma": {k: v for k, v in m1.gamma().items()}}
        dyn[name] = row
        print(f"  [engine check {name}] done ({time.time() - t0:.0f}s)", flush=True)
    res["dynre"] = dyn
    # 3: knockdown hazard per standing head strike absorbed (cells only; frailty includes matchup spread)
    kd = {}
    for lab, d0 in (("engine", E), ("real", real)):
        d = d0.sort_values(["fid", "idx", "rnd"]).copy()
        cells = sorted(d.cell.unique())
        for c in cells:
            d["c" + c] = (d.cell == c).astype(float)
        cc = ["c" + c for c in cells]
        row = {}
        for nm, X in (("null", cc), ("damage", cc + ["D10", "K_lag", "K_early"]), ("fatigue", cc + ["A100", "oA100"])):
            m = FrailPois(d, "o_kd", "o_sh_l", X).fit()
            co = m.coef()
            row[nm] = {k: v for k, v in co.items() if not k.startswith("c") or k in ("D10",)}
            if nm == "null":
                row["round_profile"] = {str(R): [math.exp(co[f"c{R}_{r}"]["est"] - co[f"c{R}_1"]["est"])
                                                 for r in range(1, R + 1)] for R in (3, 5) if f"c{R}_1" in co}
                row["r1_rate_3rd"] = math.exp(co["c3_1"]["est"]) if "c3_1" in co else None
        # do the two directions of one fight share KD volatility? (Pearson residual correlation vs no-frailty fit)
        mnf = FrailPois(d, "o_kd", "o_sh_l", cc).fit(fixed_la=math.log(1e-6))
        q = mnf.d.assign(mu=np.exp(mnf.lE + mnf.X @ mnf.par[:-1]))
        agg = q.groupby(["fid", "idx"]).agg(y=("o_kd", "sum"), mu=("mu", "sum")).reset_index()
        agg["r"] = (agg.y - agg.mu) / np.sqrt(agg.mu)
        pv = agg.pivot(index="fid", columns="idx", values="r").dropna()
        row["direction_residual_corr"] = float(np.corrcoef(pv[0], pv[1])[0, 1])
        row["direction_residual_n"] = int(len(pv))
        d["Dbin"] = damage_bin(d.c_ohl)
        b = d[d.rnd >= 2].groupby("Dbin", observed=True)
        row["by_prior_damage"] = {str(k): {"kd_per100_sh": 100 * float(g.o_kd.sum() / max(g.o_sh_l.sum(), 1)),
                                           "p_stopped": float(g.fin_ko_against.mean()),
                                           "head_absorbed_pm": float(g.o_head_l.sum() / g.mins.sum()),
                                           "rounds": int(len(g))} for k, g in b}
        kd[lab] = row
    res["kd_hazard"] = kd
    print(f"  [engine check kd] done ({time.time() - t0:.0f}s)", flush=True)
    # 4: targets by round
    tg = {}
    for lab, d in (("engine", E), ("real", real)):
        t = {}
        for (R, r), g in d.groupby(["R", "rnd"]):
            m = g.mins.sum()
            t[f"{R}_{r}"] = {"fighter_rounds": int(len(g)), "sig_att_pm": float(g.sig_a.sum() / m),
                             "sig_lnd_pm": float(g.sig_l.sum() / m), "sig_acc": float(g.sig_l.sum() / max(g.sig_a.sum(), 1)),
                             "td_att_per15": float(15 * g.td_a.sum() / m), "ctrl_share": float(g.ctrl.sum() / g.rsec.sum()),
                             "kd_per100_standing_head": float(100 * g.kd.sum() / max(g.sh_l.sum(), 1)),
                             "p_round_ends_ko_tko": float(g.fin_ko_against.sum() / (len(g) / 2)),
                             "p_round_ends_sub": float(g.fin_sub_against.sum() / (len(g) / 2)),
                             "n_rounds": int(len(g) // 2), "n_ko_tko": int(g.fin_ko_against.sum()), "n_kd": int(g.kd.sum())}
        tg[lab] = t
    res["targets_by_round"] = tg
    # 5: late-round ratio: total variance and the persistent (matchup) share in the engine
    FE = late_ratio_simple(E)
    FE["mkey"] = FE.fid.str.split(":").str[0] + ":" + FE.idx.astype(str)
    g = FE.groupby("mkey").LR
    within = float(g.var().mean()); nbar = float(g.size().mean())
    between = float(g.mean().var() - within / nbar)
    FR = late_ratio_simple(real)
    res["late_ratio"] = {"engine_total_var": float(FE.LR.var()), "engine_between_matchup_var": between,
                         "engine_within_matchup_var": within, "real_total_var": float(FR.LR.var()),
                         "engine_mean": float(FE.LR.mean()), "real_mean": float(FR.LR.mean())}
    # 6: round correlations
    rc = {}
    for lab, d in (("engine", Es), ("real", real)):
        x = d[d.full].copy(); x["y"] = np.log((x.sig_a + 0.5) / 5)
        w = x.pivot_table(index=["fid", "idx"], columns="rnd", values="y")
        bq = x.pivot_table(index=["fid", "rnd"], columns="idx", values="y").dropna()
        rc[lab] = {"own_r1_r2": float(w[[1, 2]].dropna().corr().iloc[0, 1]),
                   "own_r1_r3": float(w[[1, 3]].dropna().corr().iloc[0, 1]) if 3 in w else None,
                   "fighters_same_round": float(bq.corr().iloc[0, 1])}
    res["round_correlations"] = rc
    res["secs"] = time.time() - t0
    return res

# ================================================================================================
# main
# ================================================================================================
def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true", help="skip jackknife and simulation checks")
    ap.add_argument("--jack", type=int, default=10)
    ap.add_argument("--parts", default="1,2,3,4,5")
    ap.add_argument("--engine-csv", default=None, help="CSV from tools/dynamics_engine.js: adds the engine check")
    ap.add_argument("--engine-label", default="engine3 (src/)")
    ap.add_argument("--engine-key", default="engine_check", help="JSON key for the engine check")
    ap.add_argument("--engine-period", default="test", choices=["train", "test"],
                    help="real-fight window for the engine check (train for tuning, test for selection only)")
    ap.add_argument("--fresh", action="store_true", help="drop keys of the existing JSON that this run does not write")
    a = ap.parse_args(argv)
    jack = 0 if a.quick else a.jack
    parts = set(a.parts.split(","))
    t0 = time.time()
    F, S, notes = build_panel()
    S = add_covariates(S)
    print(f"panel: {S.fid.nunique()} fights, {len(S)} fighter-rounds ({time.time() - t0:.0f}s)", flush=True)
    per = S.groupby("period").fid.nunique().to_dict()
    J = {"meta": {"tool": "tools/dynamics.py", "built": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                  "snapshot": str(S.DATE.max().date()), "train": TRAIN, "test": TEST, "ext": EXT,
                  "fights_by_period": per, "formats": [FMT3, FMT5], "notes": notes, "covariates": XDOC,
                  "jackknife_groups": jack}}
    if parts & {"1", "3", "4"}:
        print("part 1/3/4: dynamic RE models", flush=True)
        mods = {}
        for name in ("out", "dist", "acc", "hacc"):
            o, m0, m1 = fit_dynre_outcome(S, name, STATE_X, jack=jack if name in ("out", "dist") else 0)
            mods[name] = o
            if name == "out":
                m0_out = m0
        mods["tda"] = fit_tda(S, STATE_X)
        J["state_models"] = mods
        J["comparison_estimators_out"] = comparison_estimators(S)
        J["form_decomposition"] = form_decomposition(S)
        if not a.quick:
            print("  simulation check of the estimator (null model, own-output fatigue proxy)", flush=True)
            J["simulation_check"] = sim_check(S, m0_out, reps=2, gam_true=(0.0, -0.15))
        J["kd_momentum_descriptive"] = part4_descriptive(S)
        save(J, parts | {"partial"})
    if "3" in parts or "J" in parts:          # J: the judges'-label models alone
        print("part 3: judges' labels", flush=True)
        J["adaptation_judges"] = part3_judges(F, S, STATE_X, jack=jack)
        save(J, parts | {"partial"})
    if "2" in parts:
        print("part 2: per-fighter late-round ratios", flush=True)
        J["fighter_late_ratio"] = part2(S)
        save(J, parts | {"partial"})
    J["targets_by_round"] = targets(S)
    J["round_correlations_train"] = round_corr(S)
    if "5" in parts:
        print("part 5: finish hazard", flush=True)
        J["finish_hazard"] = part5(S, F)
    if a.engine_csv:
        print("engine check", flush=True)
        J[a.engine_key] = engine_check(S, a.engine_csv, a.engine_label, a.engine_period)
    J["meta"]["secs"] = time.time() - t0
    save(J, parts, fresh=a.fresh)
    print(f"wrote {OUT_JSON} ({time.time() - t0:.0f}s)")


def save(J, parts, fresh=False):
    """Merge into the existing JSON (keys this run did not compute, e.g. earlier engine checks, are kept; meta is
    merged so hand-written provenance survives). --fresh starts from an empty file."""
    old = {}
    if os.path.exists(OUT_JSON) and not fresh:
        old = json.load(open(OUT_JSON))
    new = r6(J, 6)
    if "meta" in new and isinstance(old.get("meta"), dict):
        meta = old["meta"]; meta.update(new["meta"]); new["meta"] = meta
    old.update(new)
    tmp = OUT_JSON + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(old, fh, indent=1)
    os.replace(tmp, OUT_JSON)




def vol_check(d, mnf, reps=30, seed=5):
    """Expected correlation of the two directions' per-fight Pearson residuals (knockdowns absorbed vs the
    no-frailty expectation) under (i) independent frailty per direction (gamma, variance 1.0) and (ii) the
    engine v3 structure: lognormal power and chin form per direction (sd 0.45 each) times a lognormal
    volatility shared by both directions (sd 0.60). Uses the real exposures and expectations."""
    q = mnf.d.assign(mu=np.exp(mnf.lE + mnf.X @ mnf.par[:-1]))
    agg = q.groupby(["fid", "idx"]).agg(y=("o_kd", "sum"), mu=("mu", "sum")).reset_index()
    pv = agg.pivot(index="fid", columns="idx", values="mu").dropna()
    yv = agg.pivot(index="fid", columns="idx", values="y").reindex(pv.index)
    mu = pv.to_numpy()
    obs_r = (yv.to_numpy() - mu) / np.sqrt(mu)
    obs = float(np.corrcoef(obs_r[:, 0], obs_r[:, 1])[0, 1])
    rng = np.random.default_rng(seed)
    n = len(mu)
    out = {"observed": obs, "n_fights": int(n)}
    sims = {"independent_gamma_var1": [], "engine_pow_chin_vol": [], "shared_only_gamma_var1": []}
    for _ in range(reps):
        th = rng.gamma(1.0, 1.0, (n, 2))
        sims["independent_gamma_var1"].append(th)
        z = rng.normal(size=(n, 2, 2)); v = rng.normal(size=(n, 1))
        lt = 0.45 * z[:, :, 0] + 0.45 * z[:, :, 1] + 0.6 * v
        t2 = np.exp(lt); t2 /= t2.mean()
        sims["engine_pow_chin_vol"].append(t2)
        s = rng.gamma(1.0, 1.0, (n, 1)) * np.ones((1, 2))
        sims["shared_only_gamma_var1"].append(s)
    for k, lst in sims.items():
        cs = []
        for th in lst:
            y = rng.poisson(mu * th)
            r = (y - mu) / np.sqrt(mu)
            cs.append(np.corrcoef(r[:, 0], r[:, 1])[0, 1])
        out[k] = {"mean": float(np.mean(cs)), "sd": float(np.std(cs))}
    return out


if __name__ == "__main__":
    main()
