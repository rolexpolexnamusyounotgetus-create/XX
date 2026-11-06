#!/usr/bin/env python3
"""
officials_engine.py - engine tables for the officials component (roadmap v8; engine flag params.components.officials).

Walk-forward and train-only by construction: every input row is dated before --max-date (default 2024-01-01, the
end of the hidden-data protocol's train years); rows on or after it are dropped right after parsing, before any
statistic is computed. Each table "Y" is fit only on the --window years before Y (default 5: table 2019 = rows
2014-2018, ..., table 2024 = rows 2019-2023 = the production table for v5). Engine backtests of a fight dated in
year Y use table Y, so no fight ever sees its own (or a later) result.

JUDGES (data/derived/judgerounds_rows.json, MMA Decisions judge-by-round scores joined to ufcstats round counts).
Round r, judge j, differentials A - B:
    V = b_head dHead + b_body dBody + b_leg dLeg          (landed significant strikes by target)
    K = b_kd dKD                                          (knockdowns)
    G = b_td dTD + b_ctrl dCtrlMin + b_sub dSubAtt + b_rev dRev
    eta_jr = exp(n_j) * (exp(v_j) V + exp(k_j) K + exp(g_j) G + u_r) + e_jr,   u_r ~ N(0, sigma_u^2) shared by the
             panel, e_jr ~ Logistic(0, 1) own noise; judge j gives A the round when eta_jr > 0. A share sharedFight of
             var(u) is drawn once per fight (the panel's view persists across rounds): profile likelihood over the
             fights of the window with the round model held at its fit.
    10-8 (given the judge's winner W, features oriented to W, eps_r ~ N(0, sigma_e^2) shared by the panel):
    P(10-8) = sigmoid(c_year + c_j + th_V V_W + th_K K_W + th_G G_W + eps_r);   10-10 with a fixed small rate.
Judge effects (n sharpness, v volume, k knockdown, g grappling, c 10-8 propensity) are Gaussian random effects
shrunk to the league (MAP; JAX gradients, L-BFGS). Their sds tau = multiplier x base, the multiplier chosen by the
held-out panel log likelihood of each train year 2019..2023 under the table fit before it. The shared terms are
integrated by Gauss-Hermite quadrature, so the three verdicts in a round are dependent (agreement in near-even
rounds). No intercept and antisymmetric features: the model is symmetric in the corners by construction.

REFEREES (data/raw ufcstats snapshot, REFEREE column). Penalized GLMMs with a referee random intercept and fixed
effects for year, round, format and division group, per fighter-round:
    kdf   P(the knockdown scorer wins by KO/TKO in that round | >= 1 KD)           binomial (logit)   -> refO odds
    stko  standing KO/TKO without a KD per landed distance + clinch sig strike    Poisson (offset)   -> stko rate
    gnp   ground KO/TKO without a KD per landed ground sig strike                 Poisson (offset)   -> gnp rate
tau per unit chosen by held-out deviance on 2019..2023 (fit on the window before each year).

OUTPUTS
  data/derived/officials_engine.json  {meta, tuning, tables: {"2019".."2024": {league, judges, pool, referees,
                                       ref_pool, ref_league}}, aliases}   (load with FightEngine.loadOfficials)
  data/derived/officials_bt.json      per ufcstats fight id dated 2019-01-01..max-date: referee, the judges (when
                                       the fight went to a decision and the cards name them) and the event's judge
                                       pool (judges who scored any decision at that event), for leak-free backtests

Usage: python3 tools/officials_engine.py [--max-date 2024-01-01] [--window 5] [--quick]
Needs numpy, pandas, scipy, jax.
"""
import argparse
import json
import math
import re
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import baserates as br  # noqa: E402

DER = ROOT / "data" / "derived"
RAW = ROOT / "data" / "raw"
CLEAN = {"agree", "agree_partial_panel", "totals_agree_names_differ"}
FEATS = ["head_l", "body_l", "leg_l", "kd", "td_l", "ctrl", "sub", "rev"]
TAU0 = np.array([0.15, 0.15, 0.25, 0.20])        # base sds of (n, v, k, g): EB values fit before 2019 (officials.py)
GH_N = 24


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def name_key(s):
    return re.sub(r"[^a-z]", "", str(s).lower())


# ================================================================================================ judges: data
def load_judge_rows(max_date):
    d = json.loads((DER / "judgerounds_rows.json").read_text())
    R = pd.DataFrame(d["rounds"]["rows"], columns=d["rounds"]["cols"])
    S = pd.DataFrame(d["scores"]["rows"], columns=d["scores"]["cols"])
    R["ri"] = np.arange(len(R))
    keep = R.date < max_date                     # hidden-data protocol: drop everything on/after max_date first
    R = R[keep].copy()
    S = S[S.ri.isin(set(R.ri))].copy()
    R["yr"] = R.date.str[:4].astype(int)
    R["clean"] = R.complete & R.has_stats & R.ufc_check.isin(CLEAN)
    for f in FEATS:
        R["d_" + f] = R["A_" + f].astype(float) - R["B_" + f].astype(float)
    R["d_ctrl"] = R["d_ctrl"] / 60.0             # control in minutes
    S = S.merge(R[["ri", "yr", "ded_A", "ded_B", "clean", "date", "fid"]], on="ri", how="left")
    a = np.where(S.A_raw.notna(), S.A_raw, np.where(S.ded_A.notna(), S.A + S.ded_A.fillna(0), S.A))
    b = np.where(S.B_raw.notna(), S.B_raw, np.where(S.ded_B.notna(), S.B + S.ded_B.fillna(0), S.B))
    S["a"], S["b"] = a.astype(float), b.astype(float)
    S["s"] = np.sign(S.a - S.b).astype(int)
    S["wide"] = (np.abs(S.a - S.b) >= 2).astype(int)
    S["key"] = [("m%d" % int(j)) if j == j and j is not None else None for j in S.jid]
    return R, S


def judge_names():
    jr = json.loads((DER / "judgerounds.json").read_text())
    names, aliases = {}, {}
    for jid, j in jr["judges"].items():
        k = "m%s" % jid
        names[k] = j["name"]
        aliases[name_key(j["name"])] = k
        for nm in (j.get("ufcstats_names") or {}):
            aliases.setdefault(name_key(nm), k)
    return jr, names, aliases


class Window:
    """Arrays for the rounds of a year range (clean rows), with judge indices for a given judge list."""

    def __init__(self, R, S, y0, y1, jlist=None):
        Rw = R[(R.yr >= y0) & (R.yr < y1) & R.clean]
        Sw = S[S.ri.isin(set(Rw.ri))]
        if jlist is None:
            jlist = sorted(k for k in Sw.key.dropna().unique())
        self.jlist = jlist
        jix = {k: i for i, k in enumerate(jlist)}
        NJ = len(jlist)
        pos = {ri: i for i, ri in enumerate(Rw.ri.to_numpy())}
        n = len(Rw)
        self.X = np.stack([Rw["d_" + f].to_numpy(float) for f in FEATS], 1)
        self.J = np.full((n, 3), NJ, int)
        self.s = np.zeros((n, 3))
        self.w = np.zeros((n, 3))
        self.m = np.zeros((n, 3))          # judge present with a winner (not 10-10)
        self.even = np.zeros((n, 3))
        cnt = np.zeros(n, int)
        for ri, k, s, w in zip(Sw.ri.to_numpy(), Sw.key.to_numpy(), Sw.s.to_numpy(), Sw.wide.to_numpy()):
            i = pos[ri]
            c = cnt[i]
            if c >= 3:
                continue
            cnt[i] += 1
            self.J[i, c] = jix.get(k, NJ) if k is not None else NJ
            if s == 0:
                self.even[i, c] = 1
            else:
                self.s[i, c] = s
                self.w[i, c] = w
                self.m[i, c] = 1
        self.yr = Rw.yr.to_numpy()
        self.fid = Rw.fid.to_numpy()
        self.n = n
        self.NJ = NJ
        self.n_jr = int(self.m.sum())
        self.n_even = int(self.even.sum())


# ================================================================================================ judges: model
_JAX = {}


def jax_fns():
    if _JAX:
        return _JAX
    import jax
    import jax.numpy as jnp
    jax.config.update("jax_enable_x64", True)
    xq, wq = np.polynomial.hermite.hermgauss(GH_N)
    lwq = jnp.asarray(np.log(wq / math.sqrt(math.pi)))
    xq = jnp.asarray(xq * math.sqrt(2.0))

    def win_terms(theta, X, J, NJ):
        beta = theta[:8]
        re = jnp.concatenate([theta[9:9 + 4 * NJ].reshape(4, NJ), jnp.zeros((4, 1))], 1)
        V = X[:, :3] @ beta[:3]
        K = X[:, 3] * beta[3]
        G = X[:, 4:] @ beta[4:]
        n, v, k, g = re[0][J], re[1][J], re[2][J], re[3][J]
        base = jnp.exp(v) * V[:, None] + jnp.exp(k) * K[:, None] + jnp.exp(g) * G[:, None]
        return base, jnp.exp(n), jnp.exp(theta[8])

    def win_round_ll(theta, X, J, s, m, NJ):
        base, sc, sig = win_terms(theta, X, J, NJ)
        u = sig * xq
        eta = sc[:, :, None] * (base[:, :, None] + u[None, None, :])
        ll = jax.nn.log_sigmoid(s[:, :, None] * eta) * m[:, :, None]
        return jax.scipy.special.logsumexp(ll.sum(1) + lwq[None, :], axis=1)

    def win_obj(theta, X, J, s, m, NJ, itau2):
        re = theta[9:9 + 4 * NJ].reshape(4, NJ)
        pen = 0.5 * jnp.sum(re * re * itau2[:, None]) + 0.5 * 1e-4 * jnp.sum(theta[:8] ** 2)
        return -jnp.sum(win_round_ll(theta, X, J, s, m, NJ)) + pen

    def w_round_ll(phi, Vw, Kw, Gw, J, yidx, y, m, NY, NJ):
        cy = phi[:NY]
        th = phi[NY:NY + 3]
        se = jnp.exp(phi[NY + 3])
        cj = jnp.concatenate([phi[NY + 4:NY + 4 + NJ], jnp.zeros(1)])
        lin = cy[yidx][:, None] + cj[J] + th[0] * Vw + th[1] * Kw + th[2] * Gw
        e = se * xq
        z = lin[:, :, None] + e[None, None, :]
        ll = (y[:, :, None] * jax.nn.log_sigmoid(z) + (1 - y[:, :, None]) * jax.nn.log_sigmoid(-z)) * m[:, :, None]
        return jax.scipy.special.logsumexp(ll.sum(1) + lwq[None, :], axis=1)

    def w_obj(phi, Vw, Kw, Gw, J, yidx, y, m, NY, NJ, itau2c):
        cj = phi[NY + 4:NY + 4 + NJ]
        return -jnp.sum(w_round_ll(phi, Vw, Kw, Gw, J, yidx, y, m, NY, NJ)) + 0.5 * itau2c * jnp.sum(cj * cj) + \
            0.5 * 1e-4 * jnp.sum(phi[NY:NY + 3] ** 2)

    _JAX.update(jax=jax, jnp=jnp, win_round_ll=jax.jit(win_round_ll, static_argnums=(5,)),
                win_vg=jax.jit(jax.value_and_grad(win_obj), static_argnums=(5,)),
                w_round_ll=jax.jit(w_round_ll, static_argnums=(8, 9)),
                w_vg=jax.jit(jax.value_and_grad(w_obj), static_argnums=(8, 9)))
    return _JAX


def lbfgs(vg, x0, args, maxiter=3000):
    from scipy.optimize import minimize
    jnp = _JAX["jnp"]
    ja = [jnp.asarray(a) if isinstance(a, np.ndarray) else a for a in args]

    def f(x):
        v, g = vg(jnp.asarray(x), *ja)
        return float(v), np.asarray(g, dtype=float)
    r = minimize(f, x0, jac=True, method="L-BFGS-B", options={"maxiter": maxiter, "maxcor": 30, "gtol": 1e-6})
    return r.x, r


def fit_winner(W, mult, init=None):
    F = jax_fns()
    NJ = W.NJ
    tau = TAU0 * mult
    on = tau > 0
    itau2 = np.where(on, 1.0 / np.maximum(tau, 1e-9) ** 2, 1e8)     # tau = 0 pins the effect at 0
    x0 = np.zeros(9 + 4 * NJ)
    x0[:8] = [0.18, 0.13, 0.10, 2.4, 0.3, 0.5, 0.85, 0.3]
    x0[8] = math.log(1.0)
    if init is not None:
        x0[:9] = init[:9]
    x, r = lbfgs(F["win_vg"], x0, (W.X, W.J, W.s, W.m, NJ, itau2))
    return {"theta": x, "nll": float(r.fun), "ok": bool(r.success), "mult": mult, "jlist": W.jlist, "NJ": NJ}


def oriented(W, theta):
    beta = theta[:8]
    V = W.X[:, :3] @ beta[:3]
    K = W.X[:, 3] * beta[3]
    G = W.X[:, 4:] @ beta[4:]
    return W.s * V[:, None], W.s * K[:, None], W.s * G[:, None]


def fit_108(W, theta, tau_c, years):
    F = jax_fns()
    NJ = W.NJ
    yix = {y: i for i, y in enumerate(years)}
    yidx = np.array([yix[y] for y in W.yr])
    Vw, Kw, Gw = oriented(W, theta)
    NY = len(years)
    phi0 = np.zeros(NY + 4 + NJ)
    phi0[:NY] = -4.0
    phi0[NY:NY + 3] = [0.1, 0.3, 0.1]
    phi0[NY + 3] = math.log(0.8)
    itau2c = 1.0 / tau_c ** 2 if tau_c > 0 else 1e8
    x, r = lbfgs(F["w_vg"], phi0, (Vw, Kw, Gw, W.J, yidx, W.w, W.m, NY, NJ, itau2c))
    return {"phi": x, "years": years, "tau_c": tau_c, "nll": float(r.fun), "ok": bool(r.success)}


def remap_re(vals, jlist_from, jlist_to):
    ix = {k: i for i, k in enumerate(jlist_from)}
    return np.array([vals[ix[k]] if k in ix else 0.0 for k in jlist_to])


def score_winner(fit, Wt):
    """Held-out panel log likelihood (sum over rounds) of the verdicts in Wt under fit (judges unseen -> 0)."""
    F = jax_fns()
    NJ, th = fit["NJ"], fit["theta"]
    re = th[9:].reshape(4, NJ)
    re_t = np.stack([remap_re(re[g], fit["jlist"], Wt.jlist) for g in range(4)])
    th_t = np.concatenate([th[:9], re_t.ravel()])
    ll = F["win_round_ll"](F["jnp"].asarray(th_t), Wt.X, Wt.J, Wt.s, Wt.m, Wt.NJ)
    return float(np.sum(np.asarray(ll)))


def c_now(f108, rule):
    cy = f108["phi"][:len(f108["years"])]
    if rule == "last":
        return float(cy[-1])
    if rule == "avg2":
        return float(np.mean(cy[-2:]))
    return float(np.mean(cy))


def score_108(fit, f108, Wt, rule):
    F = jax_fns()
    NY, NJ = len(f108["years"]), fit["NJ"]
    phi = f108["phi"]
    cj = remap_re(phi[NY + 4:NY + 4 + NJ], fit["jlist"], Wt.jlist)
    phi_t = np.concatenate([[c_now(f108, rule)], phi[NY:NY + 4], cj])
    Vw, Kw, Gw = oriented(Wt, fit["theta"])
    ll = F["w_round_ll"](F["jnp"].asarray(phi_t), Vw, Kw, Gw, Wt.J, np.zeros(Wt.n, int), Wt.w, Wt.m, 1, Wt.NJ)
    return float(np.sum(np.asarray(ll)))


def unanimity_check(fit, W, band=0.5):
    """Model vs data: share of 3-judge rounds that are unanimous, overall and for near-even rounds (|league mean
    logit| < band, in units of the league index V + K + G)."""
    th = fit["theta"]
    beta, sig = th[:8], math.exp(th[8])
    x = W.X[:, :3] @ beta[:3] + W.X[:, 3] * beta[3] + W.X[:, 4:] @ beta[4:]
    full = (W.m.sum(1) == 3)
    obs_un = (np.abs(W.s.sum(1)) == 3)
    xq, wq = np.polynomial.hermite.hermgauss(GH_N)
    u = xq * math.sqrt(2) * sig
    p = 1 / (1 + np.exp(-(x[:, None] + u[None, :])))
    pun = ((p ** 3 + (1 - p) ** 3) * (wq / math.sqrt(math.pi))[None, :]).sum(1)
    near = full & (np.abs(x) < band)
    p_ind = 1 / (1 + np.exp(-x))
    return {"rounds": int(full.sum()), "obs_unanimous": float(obs_un[full].mean()), "model_unanimous": float(pun[full].mean()),
            "near_even_rounds": int(near.sum()), "near_obs_unanimous": float(obs_un[near].mean()) if near.any() else None,
            "near_model_unanimous": float(pun[near].mean()) if near.any() else None,
            "near_independent_judges": float((p_ind[near] ** 3 + (1 - p_ind[near]) ** 3).mean()) if near.any() else None}


def fit_shared_fight(fit, W, grid=None, Q=16):
    """Share rho of the panel's shared variance that is drawn once per fight (persists across its rounds): profile
    likelihood over rho with the round model fixed at fit, u_r = w_f + e_r, w ~ N(0, rho s^2), e ~ N(0, (1 - rho) s^2)."""
    th = fit["theta"]
    NJ = fit["NJ"]
    beta, sig = th[:8], math.exp(th[8])
    re = np.concatenate([th[9:].reshape(4, NJ), np.zeros((4, 1))], 1)
    V = W.X[:, :3] @ beta[:3]
    K = W.X[:, 3] * beta[3]
    Gx = W.X[:, 4:] @ beta[4:]
    n, v, k, g = (re[i][W.J] for i in range(4))
    base = np.exp(v) * V[:, None] + np.exp(k) * K[:, None] + np.exp(g) * Gx[:, None]
    sc = np.exp(n)
    xq, wq = np.polynomial.hermite.hermgauss(Q)
    xq, lw = xq * math.sqrt(2), np.log(wq / math.sqrt(math.pi))
    _, finv = np.unique(W.fid, return_inverse=True)
    out = {}
    for rho in (grid if grid is not None else [0.0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.6]):
        sw, se = sig * math.sqrt(rho), sig * math.sqrt(1 - rho)
        u = sw * xq[:, None] + se * xq[None, :]
        eta = sc[:, :, None, None] * (base[:, :, None, None] + u[None, None])
        ll = -np.logaddexp(0, -W.s[:, :, None, None] * eta) * W.m[:, :, None, None]
        lr = ll.sum(1)
        lr = np.logaddexp.reduce(lr + lw[None, None, :], axis=2)
        lf = np.zeros((finv.max() + 1, Q))
        np.add.at(lf, finv, lr)
        out[rho] = float(np.logaddexp.reduce(lf + lw[None, :], axis=1).sum())
    best = max(out, key=out.get)
    return best, out


# ================================================================================================ referees
def load_ref_data(max_date):
    F, S, notes, _ = br.load_data(RAW, "2008-01-01")
    F = F[F.DATE < pd.Timestamp(max_date)].copy()    # hidden-data protocol: nothing on/after max_date
    S = S[S.fid.isin(set(F.fid))].copy()
    F["yr"] = F.DATE.dt.year
    F["ref"] = F.REFEREE.fillna("").str.strip()
    F["fidk"] = F.fid.str.extract(r"fight-details/([0-9a-f]+)")[0]
    S = S.merge(F[["fid", "yr", "ref", "division", "five"]], on="fid", how="left")
    return F, S


DIVG = {"Flyweight": "light", "Bantamweight": "light", "Featherweight": "mid", "Lightweight": "mid",
        "Welterweight": "mid", "Middleweight": "heavy", "Light Heavyweight": "heavy", "Heavyweight": "heavy"}


def ref_units(S):
    S = S.copy()
    S["dg"] = S.division.map(lambda d: "women" if str(d).startswith("Women") else DIVG.get(d, "mid"))
    kofin = (S.cat == "KO/TKO") & (S.ko_kind == "strikes") & (S.winner == S.idx) & (S.rnd == S.end_round)
    U = {}
    k = S[S.kd >= 1]
    U["kdf"] = dict(df=k, y=kofin[S.kd >= 1].astype(float).to_numpy(), off=None, fam="binomial",
                    extra={"kd2": (k.kd >= 2).astype(float).to_numpy(), "okd": (k.o_kd >= 1).astype(float).to_numpy()})
    st = S[(S.kd == 0) & ((S.dist_l + S.clinch_l) > 0)]
    y = (kofin & S.ko_pos.isin(["distance", "clinch"]))[st.index].astype(float).to_numpy()
    U["stko"] = dict(df=st, y=y, off=np.log((st.dist_l + st.clinch_l).to_numpy(float)), fam="poisson", extra={})
    gr = S[(S.kd == 0) & (S.ground_l > 0)]
    y = (kofin & (S.ko_pos == "ground"))[gr.index].astype(float).to_numpy()
    U["gnp"] = dict(df=gr, y=y, off=np.log(gr.ground_l.to_numpy(float)), fam="poisson", extra={})
    return U


def ref_design(u, idx, yc):
    df = u["df"].iloc[idx] if idx is not None else u["df"]
    cols = [np.ones(len(df)), (df.yr.to_numpy() - yc) / 5.0, (df.rnd.to_numpy() - 2.0) / 2.0, df.five.astype(float).to_numpy()]
    for g in ["light", "heavy", "women"]:
        cols.append((df.dg == g).astype(float).to_numpy())
    for v in u["extra"].values():
        cols.append(v[idx] if idx is not None else v)
    return np.stack(cols, 1)


def glmm_fit(y, X, g, G, fam, off, tau, iters=60):
    """Penalized GLMM by Newton: random intercept per group (sd tau; tau=0 -> fixed effects only)."""
    p = X.shape[1]
    th = np.zeros(p + G)
    if fam == "binomial":
        th[0] = math.log(max(y.mean(), 1e-3) / max(1 - y.mean(), 1e-3))
    else:
        th[0] = math.log(max(y.sum(), 0.5) / np.exp(off).sum())
    lam = np.concatenate([np.full(p, 1e-4), np.full(G, 1.0 / tau ** 2 if tau > 0 else 1e8)])
    has = g >= 0
    for _ in range(iters):
        eta = X @ th[:p] + np.where(has, th[p + np.maximum(g, 0)], 0.0) + (off if off is not None else 0.0)
        if fam == "binomial":
            mu = 1 / (1 + np.exp(-eta))
            w = mu * (1 - mu)
        else:
            mu = np.exp(eta)
            w = mu
        r = y - mu
        grad = np.concatenate([X.T @ r, np.bincount(g[has], weights=r[has], minlength=G)]) - lam * th
        H = np.zeros((p + G, p + G))
        H[:p, :p] = (X * w[:, None]).T @ X
        Zw = np.zeros((G, p))
        np.add.at(Zw, g[has], X[has] * w[has, None])
        H[p:, :p] = Zw
        H[:p, p:] = Zw.T
        H[p:, p:] = np.diag(np.bincount(g[has], weights=w[has], minlength=G))
        H += np.diag(lam)
        step = np.linalg.solve(H, grad)
        th += step
        if np.max(np.abs(step)) < 1e-7:
            break
    return th[:p], th[p:]


def glmm_loss(y, X, g, b, re, fam, off):
    eta = X @ b + np.where(g >= 0, re[np.maximum(g, 0)], 0.0) + (off if off is not None else 0.0)
    if fam == "binomial":
        mu = np.clip(1 / (1 + np.exp(-eta)), 1e-9, 1 - 1e-9)
        return float(-(y * np.log(mu) + (1 - y) * np.log(1 - mu)).sum())
    mu = np.exp(eta)
    return float((mu - y * eta).sum())            # Poisson negative log likelihood (up to a constant)


def ref_fit_window(u, y0, y1, tau, refs=None):
    df = u["df"]
    idx = np.where((df.yr.to_numpy() >= y0) & (df.yr.to_numpy() < y1))[0]
    names = df.ref.to_numpy()[idx]
    if refs is None:
        refs = sorted(set(n for n in names if n))
    rix = {r: i for i, r in enumerate(refs)}
    g = np.array([rix.get(n, -1) if n else -1 for n in names])
    X = ref_design(u, idx, y1 - 1)
    off = u["off"][idx] if u["off"] is not None else None
    b, re = glmm_fit(u["y"][idx], X, g, len(refs), u["fam"], off, tau)
    return {"b": b, "re": re, "refs": refs, "yc": y1 - 1}


def ref_score_year(u, fit, y):
    df = u["df"]
    idx = np.where(df.yr.to_numpy() == y)[0]
    rix = {r: i for i, r in enumerate(fit["refs"])}
    g = np.array([rix.get(n, -1) for n in df.ref.to_numpy()[idx]])
    X = ref_design(u, idx, fit["yc"])
    X[:, 1] = 1.0 / 5.0      # predict year y with the window's last-year level + one year of trend
    off = u["off"][idx] if u["off"] is not None else None
    return glmm_loss(u["y"][idx], X, g, fit["b"], fit["re"], u["fam"], off), len(idx)


# ================================================================================================ main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-date", default="2024-01-01")
    ap.add_argument("--window", type=int, default=5)
    ap.add_argument("--first-table", type=int, default=2019)
    ap.add_argument("--quick", action="store_true", help="smaller tuning grids (smoke test)")
    ap.add_argument("--out", default=str(DER / "officials_engine.json"))
    ap.add_argument("--bt-out", default=str(DER / "officials_bt.json"))
    a = ap.parse_args()
    assert a.max_date <= "2024-01-01" or "--allow" in sys.argv, "train-only tool: --max-date must not pass 2024-01-01"
    ylast = int(a.max_date[:4])                 # table years first_table .. ylast (ylast = production table)
    tune_years = list(range(a.first_table, ylast))
    t0 = time.time()

    # ---------------------------------------------------------------- judges
    R, S = load_judge_rows(a.max_date)
    jr, names, aliases = judge_names()
    log(f"judge rows: {len(R)} rounds, {len(S)} judge-rounds before {a.max_date}; clean {int(R.clean.sum())}")
    mults = [0.0, 0.5, 1.0] if a.quick else [0.0, 0.25, 0.5, 1.0, 2.0]
    tau_cs = [0.0, 0.4] if a.quick else [0.0, 0.2, 0.4, 0.8]
    rules = ["last", "avg2", "all"]
    tune = {"winner": {str(m): {} for m in mults}, "ten8": {}, "n_rounds": {}, "n_judge_rounds": {}}
    fits = {}
    for Y in tune_years + [ylast]:
        W = Window(R, S, Y - a.window, Y)
        log(f"table {Y}: window {Y - a.window}-{Y - 1}: {W.n} rounds, {W.n_jr} judge-rounds, {W.NJ} judges")
        fits[Y] = {}
        init = None
        for mlt in mults:
            f = fit_winner(W, mlt, init)
            init = f["theta"]
            fits[Y][mlt] = f
        if Y in tune_years:
            Wt = Window(R, S, Y, Y + 1)
            tune["n_rounds"][str(Y)] = Wt.n
            tune["n_judge_rounds"][str(Y)] = Wt.n_jr
            for mlt in mults:
                tune["winner"][str(mlt)][str(Y)] = score_winner(fits[Y][mlt], Wt)
            log("  held-out winner ll " + ", ".join(f"{m}: {tune['winner'][str(m)][str(Y)]:.1f}" for m in mults))
    tot = {m: sum(tune["winner"][str(m)].values()) for m in mults}
    best_m = max(mults, key=lambda m: tot[m])
    nrt = sum(tune["n_rounds"].values())
    tune["winner_total"] = {str(m): tot[m] for m in mults}
    tune["winner_per_round_vs_league"] = {str(m): (tot[m] - tot[0.0]) / nrt for m in mults}
    tune["best_mult"] = best_m
    log(f"best judge-effect multiplier {best_m} (held-out ll per round vs league: {tune['winner_per_round_vs_league']})")

    # 10-8: tau_c and the c_now rule, tuned the same way (on the best winner fit)
    f108s = {}
    for Y in tune_years + [ylast]:
        W = Window(R, S, Y - a.window, Y)
        years = sorted(set(W.yr.tolist()))
        f108s[Y] = {tc: fit_108(W, fits[Y][best_m]["theta"], tc, years) for tc in tau_cs}
        if Y in tune_years:
            Wt = Window(R, S, Y, Y + 1)
            for tc in tau_cs:
                for rule in rules:
                    tune["ten8"].setdefault(f"{tc}|{rule}", {})[str(Y)] = score_108(fits[Y][best_m], f108s[Y][tc], Wt, rule)
    t8 = {k: sum(v.values()) for k, v in tune["ten8"].items()}
    best_t8 = max(t8, key=t8.get)
    best_tc, best_rule = float(best_t8.split("|")[0]), best_t8.split("|")[1]
    tune["ten8_total"] = t8
    tune["best_tau_c"], tune["best_rule"] = best_tc, best_rule
    log(f"10-8: best tau_c {best_tc}, rule {best_rule}; totals {t8}")

    # ---------------------------------------------------------------- referees
    Fr, Sr = load_ref_data(a.max_date)
    U = ref_units(Sr)
    rtaus = [0.0, 0.2, 0.4] if a.quick else [0.0, 0.1, 0.2, 0.3, 0.45, 0.6, 0.8]
    rtune = {}
    for un, u in U.items():
        rtune[un] = {}
        for tau in rtaus:
            L, N = 0.0, 0
            for Y in tune_years:
                f = ref_fit_window(u, Y - a.window, Y, tau)
                l, n = ref_score_year(u, f, Y)
                L += l
                N += n
            rtune[un][str(tau)] = L / max(1, N)
        log(f"referee unit {un}: n={len(u['y'])} events={int(u['y'].sum())} held-out loss by tau {rtune[un]}")
    ref_tau = {un: float(min(rtune[un], key=rtune[un].get)) for un in U}
    log(f"referee taus {ref_tau}")

    # ---------------------------------------------------------------- tables
    tables = {}
    for Y in tune_years + [ylast]:
        W = Window(R, S, Y - a.window, Y)
        fw = fits[Y][best_m]
        th = fw["theta"]
        NJ = fw["NJ"]
        re = th[9:].reshape(4, NJ)
        f8 = f108s[Y][best_tc]
        NY = len(f8["years"])
        ph = f8["phi"]
        cj = ph[NY + 4:NY + 4 + NJ]
        # judge activity in the window (all rows, not only clean ones) and the recent pool (last 2 window years)
        Sw = S[(S.yr >= Y - a.window) & (S.yr < Y)]
        nr = Sw.key.value_counts()
        recent = S[(S.yr >= Y - 2) & (S.yr < Y)]
        tot_recent = len(recent)
        rc = recent.key.value_counts()
        judges = {}
        for i, k in enumerate(fw["jlist"]):
            judges[k] = [names.get(k, k), round(float(re[0, i]), 4), round(float(re[1, i]), 4), round(float(re[2, i]), 4),
                         round(float(re[3, i]), 4), round(float(cj[i]), 4), int(nr.get(k, 0))]
        pool = [[k, round(int(c) / tot_recent, 5)] for k, c in rc.items() if k is not None and int(c) >= 15]
        other = 1.0 - sum(p for _, p in pool)
        pool.append(["_other", round(max(0.0, other), 5)])
        n_even = int((Sw.s == 0).sum())
        league = {"beta": dict(zip(["head", "body", "leg", "kd", "td", "ctrlMin", "sub", "rev"], [round(float(x), 5) for x in th[:8]])),
                  "sigmaU": round(math.exp(th[8]), 5),
                  "ten8": {"c0": round(c_now(f8, best_rule), 4), "thV": round(float(ph[NY]), 5), "thK": round(float(ph[NY + 1]), 5),
                           "thG": round(float(ph[NY + 2]), 5), "sigmaE": round(math.exp(ph[NY + 3]), 4),
                           "c_by_year": {str(y): round(float(c), 4) for y, c in zip(f8["years"], ph[:NY])}},
                  "p1010": round(n_even / max(1, len(Sw)), 5),
                  "tau": {"n": float(TAU0[0] * best_m), "v": float(TAU0[1] * best_m), "k": float(TAU0[2] * best_m),
                          "g": float(TAU0[3] * best_m), "c": best_tc},
                  "window": [Y - a.window, Y - 1], "rounds": W.n, "judge_rounds": W.n_jr,
                  "unanimity": unanimity_check(fw, W)}
        rho, rho_ll = fit_shared_fight(fw, W)
        league["sharedFight"] = rho
        league["sharedFight_ll"] = {str(k): round(v, 2) for k, v in rho_ll.items()}
        # referees
        refs, rleague = {}, {}
        for un, u in U.items():
            f = ref_fit_window(u, Y - a.window, Y, ref_tau[un])
            for r, v in zip(f["refs"], f["re"]):
                refs.setdefault(r, {})[un] = round(float(v), 4)
            rleague[un] = {"intercept": round(float(f["b"][0]), 4), "tau": ref_tau[un]}
        Fw = Fr[(Fr.yr >= Y - a.window) & (Fr.yr < Y)]
        nf = Fw.ref.value_counts()
        Frec = Fr[(Fr.yr >= Y - 2) & (Fr.yr < Y)]
        rcount = Frec.ref.value_counts()
        ref_tab = {r: [round(math.exp(d.get("kdf", 0.0)), 4), round(math.exp(d.get("stko", 0.0)), 4),
                       round(math.exp(d.get("gnp", 0.0)), 4), int(nf.get(r, 0))] for r, d in refs.items() if r}
        ref_pool = [[r, round(int(c) / len(Frec), 5)] for r, c in rcount.items() if r and int(c) >= 10]
        ref_pool.append(["_other", round(max(0.0, 1 - sum(p for _, p in ref_pool)), 5)])
        tables[str(Y)] = {"league": league, "judge_cols": ["name", "n", "v", "k", "g", "c", "rounds_in_window"], "judges": judges,
                          "pool": pool, "referee_cols": ["kdf_odds", "stko_rate", "gnp_rate", "fights_in_window"],
                          "referees": ref_tab, "ref_pool": ref_pool, "ref_league": rleague}
        L = tables[str(Y)]["league"]
        log(f"table {Y}: beta {L['beta']} sigmaU {L['sigmaU']} sharedFight {L['sharedFight']} 10-8 c0 {L['ten8']['c0']} p1010 {L['p1010']}; "
            f"unanimity {L['unanimity']}")

    meta = {"tool": "tools/officials_engine.py", "built": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "max_date": a.max_date, "window_years": a.window,
            "rule": "table Y is fit only on rows dated in [Y - window, Y); every row on/after max_date is dropped at load. "
                    "Backtests of a fight in year Y use table Y; table " + str(ylast) + " is the production table.",
            "judge_model": __doc__.split("JUDGES")[1].split("REFEREES")[0].strip(),
            "sources": "data/derived/judgerounds_rows.json + judgerounds.json (tools/judgerounds.py: MMA Decisions via "
                       "nlbair/ufc-data CC BY 4.0 and martindavies-code/ufc-judging-analysis); data/raw ufcstats snapshot",
            "tau0": dict(zip(["n", "v", "k", "g"], TAU0.tolist())), "secs": round(time.time() - t0, 1)}
    out = {"meta": meta, "tuning": {"judges": tune, "referees": rtune, "referee_tau": ref_tau}, "tables": tables, "aliases": aliases}
    Path(a.out).write_text(json.dumps(out, separators=(",", ":")))
    log(f"wrote {a.out}")

    # ---------------------------------------------------------------- backtest-keyed officials
    bt = {}
    Fb = Fr[(Fr.DATE >= pd.Timestamp("2019-01-01"))].copy()
    jfights = jr["fights"]
    ev_pool = defaultdict(Counter)
    fight_j = {}
    for _, f in Fb.iterrows():
        fk = f.fidk
        ks = None
        if fk in jfights and jfights[fk].get("judges"):
            ks = ["m%s" % j["id"] for j in jfights[fk]["judges"] if j.get("id") is not None]
        elif f["cat"] in ("U-DEC", "S-DEC", "M-DEC", "DRAW"):
            cards = br.parse_cards(f.det)
            ks = [aliases.get(name_key(nm)) for nm, _, _ in cards]
            ks = [k for k in ks if k]
        if ks:
            fight_j[fk] = ks
            for k in ks:
                ev_pool[f.EVENT][k] += 1
    for _, f in Fb.iterrows():
        fk = f.fidk
        ks = fight_j.get(fk)
        pool = [[k, c] for k, c in ev_pool[f.EVENT].most_common()]
        bt[fk] = {"date": f.DATE.strftime("%Y-%m-%d"), "event": f.EVENT, "referee": f.ref or None,
                  "judges": ks if ks and len(ks) == 3 else None, "judge_pool": pool or None}
    Path(a.bt_out).write_text(json.dumps({"meta": {"tool": "tools/officials_engine.py", "max_date": a.max_date,
                                                   "note": "judges = the decision's three judges (MMA Decisions ids 'm<id>'; "
                                                           "null when the fight did not go to a decision or the cards do not "
                                                           "name three judges); judge_pool = judges who scored any decision at "
                                                           "the same event, with counts (sample three when judges is null)"},
                                          "fights": bt}, separators=(",", ":")))
    log(f"wrote {a.bt_out}: {len(bt)} fights, {sum(1 for v in bt.values() if v['judges'])} with three judges, "
        f"{sum(1 for v in bt.values() if v['judge_pool'])} with an event pool; {time.time() - t0:.0f} s")


if __name__ == "__main__":
    main()
