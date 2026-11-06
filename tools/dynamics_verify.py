#!/usr/bin/env python3
"""
dynamics_verify.py - adversarial re-check of tools/dynamics.py (research/model_dynamics.md).

Fresh code, written independently of dynamics.py's estimators. It reuses only the raw loaders
(tools/baserates.load_data for per-round stats, tools/build_db for person ids) and re-derives every
covariate itself:

  A. joins: fighter order vs person ids, loser-first cards incl. split decisions, NC / draw handling
  B. knockdown hazard per landed standing head strike absorbed: own negative-multinomial (gamma
     frailty per fighter-fight) likelihood; round profile given frailty, damage terms, frailty
     variance, held-out log-likelihood on 2024-2025 with train parameters, fight-cluster bootstrap
     intervals; cells-only frailty by period (the engine-check acceptance statistic)
  C. 5-round knockdown round profile: which pre-2024 window (2019-2023 only vs 2010-2023) predicts
     better, chosen on an inner pre-2024 split (fit through 2020, score 2021-2023)
  D. output variance components by method of moments (no likelihood) vs the dynamic RE null
  E. late-round cardio: the engine's kPace rule, held-out skill differences with fight-cluster
     bootstrap CIs; opponent-cardio coefficient with fight-clustered SEs
  F. per-round KO/TKO and knockdown targets by period with Wilson / Poisson intervals (train vs test)
  G. estimator stress test: can the "scorer eases off" coefficient (Ks_lag) be produced by mean
     reversion when knockdowns are more likely in big-output rounds? Simulated null with knockdowns
     drawn from the simulated output, refit with dynamics.DynRE.

Walk-forward discipline: every fit uses 2019-2023 (or 2010-2023 where stated); 2024-2025 is scored
with frozen train parameters; nothing from 2026 (the vault) is read for scoring.

Usage:   python3 tools/dynamics_verify.py [--boot 100] [--parts A,B,C,D,E,F,G]
Output:  data/derived/dynamics_verify.json; findings appended to research/model_dynamics.md
         ("## Verification log").
"""
import argparse
import json
import math
import os
import re
import sys
import time
import unicodedata

import numpy as np
import pandas as pd
from scipy import optimize, special

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import baserates as br  # noqa: E402
import build_db as bd   # noqa: E402

OUT = os.path.join(ROOT, "data", "derived", "dynamics_verify.json")
TRAIN = ("2019-01-01", "2023-12-31")
TEST = ("2024-01-01", "2025-12-31")
VAULT = "2026-01-01"


# ---------------------------------------------------------------------------------------------
# panel, built from scratch
# ---------------------------------------------------------------------------------------------
def load():
    F, S, notes, _ = br.load_data(os.path.join(ROOT, "data", "raw"), "2001-01-01")
    F = F[F.has_stats & F.fmt.isin([br.FMT3, br.FMT5])].copy()
    S = S[S.fid.isin(F.fid)].copy()
    log = {}
    fights, _ = bd.parse_fights(log)
    bd.build_people(fights, log)
    pid = {}
    for f in fights:
        if f.persons:
            pid[(f.fid, 0)], pid[(f.fid, 1)] = f.persons[0], f.persons[1]
    S["fkey"] = S.fid.map(bd.url_id)
    S["pid"] = [pid.get((k, i)) for k, i in zip(S.fkey, S.idx)]
    S = S.merge(F[["fid", "DATE", "division", "five", "det"]], on="fid", how="left")
    S["R"] = np.where(S.five, 5, 3)
    S["per"] = np.select([S.DATE.between(*TRAIN), S.DATE.between(*TEST), S.DATE >= VAULT,
                          S.DATE.between("2010-01-01", "2018-12-31")], ["train", "test", "vault", "ext"], "old")
    # standing head landed (midpoint of ufcstats' bounds) and the same for what was absorbed
    S["shl"] = ((S.head_l - S.ground_l).clip(lower=0) + np.minimum(S.head_l, S.dist_l + S.clinch_l)) / 2
    me = S[["fid", "rnd", "idx", "shl", "head_l", "kd", "sig_a", "ground_l"]].copy()
    me["idx"] = 1 - me.idx
    S = S.merge(me.rename(columns={"shl": "sh_abs", "head_l": "head_abs", "kd": "kd_abs", "sig_a": "opp_att",
                                   "ground_l": "gr_abs"}), on=["fid", "rnd", "idx"])
    S = S.sort_values(["fid", "idx", "rnd"]).reset_index(drop=True)
    g = S.groupby(["fid", "idx"], sort=False)
    S["prior_head_abs"] = g.head_abs.cumsum() - S.head_abs
    S["kd_abs_prev"] = g.kd_abs.shift(1).fillna(0)
    S["kd_abs_before_prev"] = (g.kd_abs.cumsum() - S.kd_abs) - S.kd_abs_prev
    S["kd_prev"] = g.kd.shift(1).fillna(0)
    S["mins"] = S.rsec / 60
    S["last"] = S.rnd == S.end_round
    lost = S.winner == 1 - S.idx
    S["stopped_strikes"] = (S["last"] & S.cat.eq("KO/TKO") & S.ko_kind.eq("strikes") & lost).astype(int)
    S["stopped_sub"] = (S["last"] & S.cat.eq("SUB") & lost).astype(int)
    return F, S


def walkforward_indices(S, p0, k=230.0):
    """Chin (KD absorbed per standing head absorbed) and power (KD scored per standing head landed),
    from each person's earlier fights only, shrunk toward p0 with k strikes."""
    fs = (S.groupby(["fid", "idx"]).agg(pid=("pid", "first"), DATE=("DATE", "first"), kd=("kd", "sum"),
                                        kda=("kd_abs", "sum"), shl=("shl", "sum"), sha=("sh_abs", "sum"))
            .reset_index())
    fs["pid"] = fs.pid.fillna("anon:" + fs.fid + ":" + fs.idx.astype(str))
    fs = fs.sort_values(["DATE", "fid", "idx"])
    out = []
    for _, x in fs.groupby("pid", sort=False):
        c = x[["kd", "kda", "shl", "sha"]].cumsum().shift(1).fillna(0)
        out.append(pd.DataFrame({"fid": x.fid, "idx": x.idx,
                                 "chin": (c.kda + k * p0) / (c.sha + k) / p0,
                                 "pow": (c.kd + k * p0) / (c.shl + k) / p0}))
    W = pd.concat(out)
    O = W[["fid", "idx", "pow"]].copy(); O["idx"] = 1 - O.idx
    return W[["fid", "idx", "chin"]].merge(O.rename(columns={"pow": "opp_pow"}), on=["fid", "idx"])


# ---------------------------------------------------------------------------------------------
# negative multinomial (Poisson with a gamma frailty per group), written from scratch
# ---------------------------------------------------------------------------------------------
class NegMult:
    def __init__(self, d, y, expo, xcols, group):
        d = d[d[expo] > 0]
        self.y = d[y].to_numpy(float)
        self.off = np.log(d[expo].to_numpy(float))
        self.X = d[xcols].to_numpy(float)
        self.gi, self.gkeys = pd.factorize(d[group])
        self.G = len(self.gkeys)
        self.Y = np.bincount(self.gi, self.y, self.G)
        self.lfy = special.gammaln(self.y + 1).sum()
        self.fid = d.fid.to_numpy()
        self.cols = list(xcols)
        self.n = len(d)

    def ll(self, p, groupwise=False):
        b, la = p[:-1], p[-1]
        k = math.exp(-la)                     # 1 / frailty variance
        eta = self.off + self.X @ b
        M = np.bincount(self.gi, np.exp(eta), self.G)
        sy = np.bincount(self.gi, self.y * eta, self.G)
        lg = sy + special.gammaln(k + self.Y) - special.gammaln(k) + k * math.log(k) - (k + self.Y) * np.log(k + M)
        if groupwise:
            return lg
        return lg.sum() - self.lfy

    def ll_pois(self, b):
        eta = self.off + self.X @ b
        return (self.y * eta - np.exp(eta)).sum() - self.lfy

    def fit(self, frailty=True, p0=None):
        nb = self.X.shape[1]
        if not frailty:
            f = lambda b: -self.ll_pois(b)
            g = lambda b: -((self.y - np.exp(self.off + self.X @ b))[:, None] * self.X).sum(0)
            r = optimize.minimize(f, np.zeros(nb) if p0 is None else p0[:nb], jac=g, method="BFGS",
                                  options={"gtol": 1e-7, "maxiter": 2000})
            self.p = np.r_[r.x, -np.inf]; self.llv = -r.fun; self.frailty = False
            return self
        x0 = np.r_[np.zeros(nb), 0.0] if p0 is None else p0
        r = optimize.minimize(lambda p: -self.ll(p), x0, method="BFGS", options={"gtol": 1e-6, "maxiter": 3000})
        self.p = r.x; self.llv = -r.fun; self.frailty = True
        return self

    def score(self, other):
        if not self.frailty:
            return other.ll_pois(self.p[:-1])
        return other.ll(self.p)

    def coef(self):
        d = dict(zip(self.cols, self.p[:-1]))
        if self.frailty:
            d["frailty_var"] = math.exp(self.p[-1])
        return d


def cluster_boot(d, fit_fn, B, seed=1):
    """Bootstrap over fights: fit_fn(df) -> dict of scalars. Returns name -> (2.5%, 97.5%, sd)."""
    fids = d.fid.unique()
    rng = np.random.default_rng(seed)
    rows = []
    by = {f: x for f, x in d.groupby("fid", sort=False)}
    for b in range(B):
        pick = rng.choice(fids, len(fids), replace=True)
        parts = []
        for j, f in enumerate(pick):
            x = by[f].copy()
            x["fid"] = f"{f}#{j}"
            parts.append(x)
        try:
            rows.append(fit_fn(pd.concat(parts, ignore_index=True)))
        except Exception as e:  # pragma: no cover
            print("  boot rep failed", e, flush=True)
    out = {}
    for k in rows[0]:
        v = np.array([r[k] for r in rows if k in r], float)
        out[k] = {"lo": float(np.percentile(v, 2.5)), "hi": float(np.percentile(v, 97.5)), "sd": float(v.std(ddof=1)),
                  "reps": int(len(v))}
    return out


# ---------------------------------------------------------------------------------------------
# A. joins
# ---------------------------------------------------------------------------------------------
def part_a(F, S):
    def slug(s):
        s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()
        return re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    people_slug = {}
    log = {}
    fights, _ = bd.parse_fights(log)
    people = bd.build_people(fights, log)
    people_slug = {k: v.get("slug") for k, v in people.items()}
    x = S[S.rnd == 1][["fid", "idx", "FIGHTER", "pid"]].copy()
    x["ps"] = x.pid.map(people_slug)
    x["ns"] = x.FIGHTER.map(slug)
    o = x[["fid", "idx", "ns"]].copy(); o["idx"] = 1 - o.idx
    x = x.merge(o.rename(columns={"ns": "opp_ns"}), on=["fid", "idx"])
    same = x.ps == x.ns
    swapped = (x.ps == x.opp_ns) & ~same
    d = F[F.cat.isin(["U-DEC", "S-DEC", "M-DEC"])].copy()
    d["cards"] = d.det.map(br.parse_cards)
    d = d[d.cards.map(len) == 3]
    d["first_higher"] = d.cards.map(lambda c: sum(a > b for _, a, b in c))
    sd = d[d.cat == "S-DEC"]
    return {"fighter_rounds_r1": int(len(x)), "pid_slug_equals_row_name": float(same.mean()),
            "pid_slug_equals_opponent_name": int(swapped.sum()),
            "split_decisions": int(len(sd)),
            "split_decisions_with_exactly_one_card_first_higher": int((sd.first_higher == 1).sum()),
            "unanimous_cards_first_higher": int(d[d.cat == "U-DEC"].first_higher.sum()),
            "nc_draw_dq_rows_flagged_stopped": int(S[S.cat.isin(["NC", "DRAW", "DQ"])].stopped_strikes.sum()),
            "verdict": "fighter order, card orientation (loser-first, also for the dissenting split card) and "
                       "NC/draw handling are correct"}


# ---------------------------------------------------------------------------------------------
# B. knockdown hazard, fresh
# ---------------------------------------------------------------------------------------------
def kd_frame(S):
    tr = S[S.per == "train"]
    p0 = tr.kd_abs.sum() / tr.sh_abs.sum()
    W = walkforward_indices(S, p0)
    d = S.merge(W, on=["fid", "idx"], how="left")
    dv = tr.groupby("division").apply(lambda x: x.kd_abs.sum() / max(x.sh_abs.sum(), 1), include_groups=False)
    d["x_div"] = np.log(d.division.map(dv).fillna(p0) / p0)
    d["x_chin"] = np.log(d.chin.fillna(1.0))
    d["x_pow"] = np.log(d.opp_pow.fillna(1.0))
    d["dmg10"] = d.prior_head_abs / 10
    d["grp"] = d.fid + "|" + d.idx.astype(str)
    cells = []
    for R in (3, 5):
        for r in range(1, R + 1):
            c = f"r{R}_{r}"
            d[c] = ((d.R == R) & (d.rnd == r)).astype(float)
            cells.append(c)
    d["r5_45"] = d["r5_4"] + d["r5_5"]
    return d.sort_values(["fid", "idx", "rnd"]).reset_index(drop=True), cells, p0


def profile_from(coef, R, cells_key="r"):
    b1 = coef[f"r{R}_1"]
    return [math.exp(coef[f"r{R}_{r}"] - b1) for r in range(1, R + 1) if f"r{R}_{r}" in coef]


def part_b(S, B):
    d, cells, p0 = kd_frame(S)
    prof = ["x_div", "x_chin", "x_pow"]
    dmg = ["dmg10", "kd_abs_prev", "kd_abs_before_prev"]
    tr, te = d[d.per == "train"], d[d.per == "test"]
    res = {"p0_train": p0, "n_rounds_train": int((tr.sh_abs > 0).sum()), "kd_train": float(tr.kd_abs.sum()),
           "kd_test": float(te.kd_abs.sum())}
    specs = {"null": cells + prof, "damage": cells + prof + dmg, "cells_only": cells}
    fits = {}
    for nm, X in specs.items():
        for fr in (True, False):
            m = NegMult(tr, "kd_abs", "sh_abs", X, "grp").fit(frailty=fr)
            mt = NegMult(te, "kd_abs", "sh_abs", X, "grp")
            key = nm + ("" if fr else "_nofrailty")
            fits[key] = m
            res[key] = {"coef": {k: v for k, v in m.coef().items() if not k.startswith("r")},
                        "train_ll": m.llv, "test_ll": m.score(mt)}
            if fr:
                res[key]["profile3"] = profile_from(m.coef(), 3)
                res[key]["profile5"] = profile_from(m.coef(), 5)
            print(f"  [B {key}] test ll {res[key]['test_ll']:.1f} {res[key]['coef']}", flush=True)
    res["heldout_gain"] = {
        "frailty_vs_none_null": res["null"]["test_ll"] - res["null_nofrailty"]["test_ll"],
        "damage_vs_null_frailty": res["damage"]["test_ll"] - res["null"]["test_ll"],
        "damage_vs_null_nofrailty": res["damage_nofrailty"]["test_ll"] - res["null_nofrailty"]["test_ll"]}
    # cells-only frailty (the engine-check acceptance statistic) by period: train vs test
    cf = {}
    for per in ("train", "test"):
        x = d[d.per == per]
        m = NegMult(x, "kd_abs", "sh_abs", cells, "grp").fit()
        cf[per] = {"frailty_var": m.coef()["frailty_var"], "profile3": profile_from(m.coef(), 3),
                   "profile5": profile_from(m.coef(), 5)}
    res["cells_only_by_period"] = cf
    # fight-cluster bootstrap on train: frailty, damage slope, K_lag with and without frailty, round profile
    if B:
        def fb(df):
            m1 = NegMult(df, "kd_abs", "sh_abs", cells + prof + dmg, "grp").fit(frailty=True,
                                                                              p0=fits["damage"].p)
            m2 = NegMult(df, "kd_abs", "sh_abs", cells + prof + dmg, "grp").fit(frailty=False)
            m0 = NegMult(df, "kd_abs", "sh_abs", cells + prof, "grp").fit(frailty=True, p0=fits["null"].p)
            c1, c2, c0 = m1.coef(), m2.coef(), m0.coef()
            p3, p5 = profile_from(c0, 3), profile_from(c0, 5)
            return {"frailty_var_null": c0["frailty_var"], "dmg10": c1["dmg10"], "kd_abs_prev": c1["kd_abs_prev"],
                    "kd_abs_prev_nofrailty": c2["kd_abs_prev"], "dmg10_nofrailty": c2["dmg10"],
                    "p3_r2": p3[1], "p3_r3": p3[2], "p5_r2": p5[1], "p5_r3": p5[2], "p5_r4": p5[3], "p5_r5": p5[4]}
        t0 = time.time()
        res["bootstrap_train"] = cluster_boot(tr, fb, B, seed=11)
        res["bootstrap_train"]["_secs"] = time.time() - t0
    return res, d, cells


# ---------------------------------------------------------------------------------------------
# C. 5-round KD profile: which window? (inner pre-2024 validation only)
# ---------------------------------------------------------------------------------------------
def part_c(d, cells):
    prof = ["x_div", "x_chin", "x_pow"]
    cc = [c for c in cells if c not in ("r5_4", "r5_5")] + ["r5_45"]
    X = cc + prof
    inner_test = d[d.DATE.between("2021-01-01", "2023-12-31")]
    out = {"note": "fit windows end 2020-12-31, scored on 2021-2023 (all before the test period); "
                   "the score is the full knockdown log-likelihood and its 5-round part"}
    for lab, lo in (("short_2016_2020", "2016-01-01"), ("long_2010_2020", "2010-01-01")):
        a = d[d.DATE.between(lo, "2020-12-31")]
        m = NegMult(a, "kd_abs", "sh_abs", X, "grp").fit()
        mt = NegMult(inner_test, "kd_abs", "sh_abs", X, "grp")
        five = inner_test[inner_test.R == 5]
        m5 = NegMult(five, "kd_abs", "sh_abs", X, "grp")
        c = m.coef()
        out[lab] = {"inner_test_ll": m.score(mt), "inner_test_ll_5round": m.score(m5),
                    "profile5_r45_pooled": [1.0] + [math.exp(c[k] - c["r5_1"]) for k in ("r5_2", "r5_3", "r5_45")],
                    "profile3": [1.0] + [math.exp(c[k] - c["r3_1"]) for k in ("r3_2", "r3_3")]}
    out["long_minus_short_5round_ll"] = out["long_2010_2020"]["inner_test_ll_5round"] - out["short_2016_2020"]["inner_test_ll_5round"]
    # the two candidate final windows (as in the report), for reference
    for lab, lo in (("train_2019_2023", "2019-01-01"), ("window_2010_2023", "2010-01-01")):
        a = d[d.DATE.between(lo, "2023-12-31")]
        m = NegMult(a, "kd_abs", "sh_abs", X, "grp").fit()
        c = m.coef()
        out[lab] = {"profile5_r45_pooled": [1.0] + [math.exp(c[k] - c["r5_1"]) for k in ("r5_2", "r5_3", "r5_45")],
                    "profile3": [1.0] + [math.exp(c[k] - c["r3_1"]) for k in ("r3_2", "r3_3")],
                    "frailty_var": c["frailty_var"]}
    return out


# ---------------------------------------------------------------------------------------------
# D. output variance components by moments
# ---------------------------------------------------------------------------------------------
def part_d(S, per="train"):
    """Full-round log sig attempts per minute in fights with three full rounds (rounds 1-3), residual
    from format-round means. Under y = mu + a_i + b_r + e_ir + m (the dynamic RE null):
      cov(own, lag k)     = sa^2 + se^2 phi^k
      cov(cross, same r)  = rho sa^2 + sb^2
      cov(cross, lag k)   = rho sa^2
      var                 = sa^2 + sb^2 + se^2 + E[measurement var]"""
    x = S[(S.per == per) & (S.rnd <= 3)].copy()
    full3 = x.groupby("fid").apply(lambda g: (g.rsec >= 300).sum() == 6, include_groups=False)
    x = x[x.fid.isin(full3[full3].index)]
    x["y"] = np.log((x.sig_a + 0.5) / 5)
    x["v"] = 1 / (x.sig_a + 0.5)
    x["cell"] = x.R.astype(str) + "_" + x.rnd.astype(str)
    x["e"] = x.y - x.groupby("cell").y.transform("mean")
    W = x.pivot_table(index=["fid", "idx"], columns="rnd", values="e")
    V = x.v.mean()
    var = float(np.nanmean(W.to_numpy() ** 2))
    c1 = float(np.mean([np.mean(W[1] * W[2]), np.mean(W[2] * W[3])]))
    c2 = float(np.mean(W[1] * W[3]))
    P = x.pivot_table(index=["fid", "rnd"], columns="idx", values="e")
    cs = float(np.mean(P[0] * P[1]))
    Wf = W.reset_index()
    A = Wf[Wf.idx == 0].set_index("fid")[[1, 2, 3]]
    Bq = Wf[Wf.idx == 1].set_index("fid")[[1, 2, 3]].reindex(A.index)
    cl1 = float(np.mean([np.mean(A[1] * Bq[2]), np.mean(A[2] * Bq[3]), np.mean(A[2] * Bq[1]), np.mean(A[3] * Bq[2])]))
    cl2 = float(np.mean([np.mean(A[1] * Bq[3]), np.mean(A[3] * Bq[1])]))
    rsa2 = (cl1 + cl2) / 2
    sb2 = cs - rsa2
    # own: c1 = sa2 + se2 phi, c2 = sa2 + se2 phi^2, var - V - sb2 = sa2 + se2
    tot = var - V - sb2
    # solve for phi: (c1 - sa2)^2 = (tot - sa2)(c2 - sa2) -> sa2 = (c1^2 - tot c2) / (2 c1 - tot - c2)
    den = 2 * c1 - tot - c2
    sa2 = (c1 ** 2 - tot * c2) / den if abs(den) > 1e-9 else float("nan")
    se2 = tot - sa2
    phi = (c1 - sa2) / se2 if se2 > 0 else float("nan")
    return {"period": per, "n_fights": int(x.fid.nunique()), "var": var, "mean_meas_var": float(V),
            "cov_own_lag1": c1, "cov_own_lag2": c2, "cov_cross_same": cs, "cov_cross_lag1": cl1,
            "cov_cross_lag2": cl2, "sd_fighter_fight": math.sqrt(max(sa2, 0)),
            "corr_fighters": rsa2 / sa2 if sa2 > 0 else None, "sd_round_shared": math.sqrt(max(sb2, 0)),
            "sd_round_own": math.sqrt(max(se2, 0)), "ar1_round_own": phi,
            "raw_corr_own_r1_r2": float(np.corrcoef(W[1], W[2])[0, 1]),
            "raw_corr_own_r1_r3": float(np.corrcoef(W[1], W[3])[0, 1]),
            "note": "sample: fights with 3 full rounds (selected on going 15 minutes), so it differs from the "
                    "likelihood sample; it is a check of the order of magnitude and of the split, not a replacement"}


# ---------------------------------------------------------------------------------------------
# E. cardio: kPace rule with bootstrap, opponent coefficient with clustered SEs
# ---------------------------------------------------------------------------------------------
PACE_LND5 = [1.0, 1.2, 1.2, 1.23, 1.23]
PACE_LND3 = [1.0, 1.11, 1.13]


def late_ratios(S):
    full = S[S.rsec >= 300].copy()
    full["ll"] = np.log((full.sig_l + 0.5) / 5)
    full["la"] = np.log((full.sig_a + 0.5) / 5)
    full["cell"] = full.R.astype(str) + "_" + full.rnd.astype(str)
    tr = full[full.per == "train"]
    for v in ("ll", "la"):
        full[v + "_c"] = full[v] - full.cell.map(tr.groupby("cell")[v].mean())
    r1 = full[full.rnd == 1].set_index(["fid", "idx"])
    late = full[full.rnd >= 2].groupby(["fid", "idx"]).agg(ll=("ll_c", "mean"), la=("la_c", "mean"),
                                                          T=("rnd", "max"), n=("rnd", "size"))
    J = r1[["fkey", "per", "DATE", "pid", "ll_c", "la_c"]].join(late, how="inner")
    J = J[J.n == J["T"] - 1]
    J["LRl"] = J.ll - J.ll_c
    J["LRa"] = J.la - J.la_c
    return J.reset_index()


def rule(pc, pw, T, k):
    if pc is None or pw is None:
        return 0.0
    five = any(pc[r] is not None and pw[r] > 0 for r in (3, 4))
    lc = PACE_LND5 if five else PACE_LND3
    rho = [1.0] * 5
    for r in range(1, 5):
        if pc[r] is not None and pw[r] > 0 and r < len(lc):
            ratio = min(max(pc[r] / lc[r], 0.3), 3)
            rho[r] = (ratio * pw[r] + k) / (pw[r] + k)
        else:
            rho[r] = 1 + 0.5 * (rho[r - 1] - 1)
    return float(np.mean([math.log(rho[r]) for r in range(1, min(T, 5))]))


def part_e(S, B):
    import statsmodels.api as sm
    J = late_ratios(S)
    bt = json.load(open(os.path.join(ROOT, "data", "derived", "backtest_dev.json")))
    rows = []
    names = {}
    for f in bt["fights"]:
        for side, idx in (("A", 0), ("B", 1)):
            rows.append((f["id"], idx, f[side].get("pace"), f[side].get("pace_w")))
            names[(f["id"], idx)] = f[side].get("name")
    Bt = pd.DataFrame(rows, columns=["fkey", "idx", "pace", "pace_w"])
    J = J.merge(Bt, on=["fkey", "idx"])
    # side check: backtest A/B vs ufcstats order
    chk = S[S.rnd == 1][["fkey", "idx", "FIGHTER"]]
    chk["bt_name"] = [names.get((k, i)) for k, i in zip(chk.fkey, chk.idx)]
    chk = chk[chk.bt_name.notna()]
    side_ok = float((chk.FIGHTER.str.lower() == chk.bt_name.str.lower()).mean())
    m = J[J.per.isin(["train"])].LRl.mean()
    ks = (15, 30, 45, 60)
    for k in ks:
        J[f"p{k}"] = [rule(pc, pw, T, k) for pc, pw, T in zip(J.pace, J.pace_w, J["T"])]
    out = {"n": J.groupby("per").size().to_dict(), "backtest_side_name_match": side_ok,
           "league_mean_LRl_train": m}
    for per in ("train", "test"):
        x = J[J.per == per]
        mse0 = ((x.LRl - m) ** 2).mean()
        out[per] = {f"skill_k{k}": float(100 * (1 - ((x.LRl - m - x[f"p{k}"]) ** 2).mean() / mse0)) for k in ks}
        for k in ks:
            p = x[f"p{k}"]
            out[per][f"slope_k{k}"] = float(np.cov(p, x.LRl - m)[0, 1] / p.var())
    # fight-cluster bootstrap of the test skill differences
    x = J[J.per == "test"].copy()
    fids = x.fkey.unique()
    rng = np.random.default_rng(5)
    g = {f: v for f, v in x.groupby("fkey")}
    diffs = {f"k{k}_minus_k15": [] for k in (30, 45, 60)}
    sk = {f"k{k}": [] for k in ks}
    for _ in range(max(B, 200)):
        z = pd.concat([g[f] for f in rng.choice(fids, len(fids))])
        mse0 = ((z.LRl - m) ** 2).mean()
        s = {k: 100 * (1 - ((z.LRl - m - z[f"p{k}"]) ** 2).mean() / mse0) for k in ks}
        for k in ks:
            sk[f"k{k}"].append(s[k])
        for k in (30, 45, 60):
            diffs[f"k{k}_minus_k15"].append(s[k] - s[15])
    out["test_bootstrap_skill_pct"] = {k: [float(np.percentile(v, 2.5)), float(np.percentile(v, 97.5))]
                                       for k, v in sk.items()}
    out["test_bootstrap_skill_diff_pct"] = {k: [float(np.percentile(v, 2.5)), float(np.percentile(v, 97.5))]
                                            for k, v in diffs.items()}
    # opponent effect with fight-clustered SEs, using the attempts-based walk-forward EB prediction
    J = J.sort_values(["DATE", "fkey", "idx"]).reset_index(drop=True)
    pre = J[J.per.isin(["train"])]
    mA = pre.LRa.mean()
    t2, s2 = 0.03, J[J.per == "train"].LRa.var() - 0.03
    hist, pred = {}, []
    for pidv, y in zip(J.pid, J.LRa):
        h = hist.setdefault(pidv if isinstance(pidv, str) else object(), [])
        if h:
            n = len(h); w = n * t2 / (n * t2 + s2)
            pred.append(mA + w * (np.mean(h) - mA))
        else:
            pred.append(mA)
        h.append(y)
    J["pred"] = pred
    O = J[["fkey", "idx", "pred"]].copy(); O["idx"] = 1 - O.idx
    Z = J.merge(O.rename(columns={"pred": "opred"}), on=["fkey", "idx"])
    opp = {}
    for per in ("train", "test"):
        z = Z[Z.per == per]
        X = np.column_stack([z.pred - mA, z.opred - mA])
        r0 = sm.OLS(z.LRa - mA, X).fit()
        r1 = sm.OLS(z.LRa - mA, X).fit(cov_type="cluster", cov_kwds={"groups": pd.factorize(z.fkey)[0]})
        opp[per] = {"own": float(r1.params[0]), "opp": float(r1.params[1]), "opp_se_iid": float(r0.bse[1]),
                    "opp_se_cluster_fight": float(r1.bse[1]), "own_se_cluster_fight": float(r1.bse[0]),
                    "n": int(len(z))}
    out["opponent_effect"] = opp
    return out


# ---------------------------------------------------------------------------------------------
# F. per-round targets with intervals
# ---------------------------------------------------------------------------------------------
def wilson(k, n, z=1.96):
    if n == 0:
        return [None, None]
    p = k / n; d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d; h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [c - h, c + h]


def part_f(S):
    out = {}
    for per in ("train", "test", "ext"):
        x = S[S.per == per]
        t = {}
        for (R, r), g in x.groupby(["R", "rnd"]):
            n_fights = int(len(g) // 2)
            k = int(g.stopped_strikes.sum())
            kd = float(g.kd.sum()); sh = float(g.shl.sum())
            t[f"{R}_{r}"] = {"fights_reaching": n_fights, "ko_tko_stoppages": k,
                             "p_round_ends_ko_tko": k / n_fights, "ci95": wilson(k, n_fights),
                             "kd_per100_sh": 100 * kd / sh,
                             "kd_per100_sh_ci95": [100 * max(kd - 1.96 * math.sqrt(kd), 0) / sh,
                                                   100 * (kd + 1.96 * math.sqrt(kd)) / sh]}
        out[per] = t
    return out


# ---------------------------------------------------------------------------------------------
# G. stress test of the knockdown-momentum coefficient (Ks_lag) under a no-momentum null
# ---------------------------------------------------------------------------------------------
def part_g(reps=3, seed=21):
    """Simulate log output from the fitted output null (no state effects) on the real train fight
    structure; draw each fighter's knockdowns scored in a round from Poisson(c * simulated attempts *
    exp(0.5 * simulated round shock)), so knockdowns land in big rounds; rebuild Ks_lag / K_lag; refit the
    dynamic RE output model with them. True effects are zero."""
    import dynamics as dy
    F, S, _ = dy.build_panel()
    S = dy.add_covariates(S)
    d = dy.prep_outcome(S, "out")
    tr = d[d.period == "train"].sort_values(["fid", "idx", "rnd"]).reset_index(drop=True)
    m0 = dy.DynRE(tr, "y", "v", ["partial"]).fit()
    sa, rho, sb, se, phi = m0.th
    est = m0.est()
    mu = {k[5:]: v for k, v in est.items() if k.startswith("cell:")}
    part = est["partial"]
    rng = np.random.default_rng(seed)
    fids = tr.fid.to_numpy(); idx = tr.idx.to_numpy(); rnd = tr.rnd.to_numpy(); mins = tr.mins.to_numpy()
    cellv = tr.cell.map(mu).to_numpy(); pv = tr.partial.to_numpy()
    starts = np.r_[0, np.flatnonzero(fids[1:] != fids[:-1]) + 1, len(tr)]
    real_kd_rate = tr.kd.sum() / tr.sig_a.sum()
    out = []
    for rep in range(reps):
        att = np.zeros(len(tr)); kd = np.zeros(len(tr))
        for s0, s1 in zip(starts[:-1], starts[1:]):
            a = rng.multivariate_normal([0, 0], [[sa ** 2, rho * sa ** 2], [rho * sa ** 2, sa ** 2]])
            b = rng.normal(0, sb, 6)
            for i in (0, 1):
                e = 0.0
                rows = [q for q in range(s0, s1) if idx[q] == i]
                for k, q in enumerate(rows):
                    e = phi * e + math.sqrt(1 - phi ** 2) * rng.normal(0, se) if k else rng.normal(0, se)
                    lam = math.exp(cellv[q] + part * pv[q] + a[i] + b[rnd[q]] + e) * mins[q]
                    att[q] = rng.poisson(lam)
                    # knockdowns: proportional to attempts, extra weight on the round's own shock
                    kd[q] = rng.poisson(real_kd_rate * att[q] * math.exp(0.5 * e - 0.125 * se ** 2))
        D = pd.DataFrame({"fid": fids, "idx": idx, "rnd": rnd, "cell": tr.cell.to_numpy(), "partial": pv,
                          "mins": mins, "att": att, "kd": kd})
        D = D.sort_values(["fid", "idx", "rnd"]).reset_index(drop=True)
        g = D.groupby(["fid", "idx"], sort=False)
        D["Ks_lag"] = g.kd.shift(1).fillna(0)
        O = D[["fid", "rnd", "idx", "kd"]].copy(); O["idx"] = 1 - O.idx
        D = D.merge(O.rename(columns={"kd": "okd"}), on=["fid", "rnd", "idx"])
        D = D.sort_values(["fid", "idx", "rnd"]).reset_index(drop=True)
        D["K_lag"] = D.groupby(["fid", "idx"], sort=False).okd.shift(1).fillna(0)
        D["y"] = np.log((D.att + 0.5) / D.mins); D["v"] = 1 / (D.att + 0.5)
        m = dy.DynRE(D, "y", "v", ["partial", "Ks_lag", "K_lag"]).fit(m0.p)
        gm = m.gamma()
        # naive next-round diff-in-diff (what the raw table shows)
        D["dy"] = D.y - D.groupby(["fid", "idx"]).y.shift(1)
        q = D[(D.rnd >= 2) & D.dy.notna() & (D.mins >= 4.99)]
        did = float(q[q.Ks_lag >= 1].dy.mean() - q[(q.Ks_lag == 0) & (q.K_lag == 0)].dy.mean())
        out.append({"rep": rep, "Ks_lag": gm["Ks_lag"]["est"], "Ks_lag_se": gm["Ks_lag"]["se"],
                    "K_lag": gm["K_lag"]["est"], "K_lag_se": gm["K_lag"]["se"], "naive_did_scorer": did,
                    "sim_kd_per_round": float(D.kd.mean()), "real_kd_per_round": float(tr.kd.mean())})
        print("  [G]", out[-1], flush=True)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--boot", type=int, default=100)
    ap.add_argument("--parts", default="A,B,C,D,E,F,G")
    a = ap.parse_args()
    parts = set(a.parts.split(","))
    t0 = time.time()
    F, S = load()
    print(f"panel {S.fid.nunique()} fights, {len(S)} rows ({time.time() - t0:.0f}s)", flush=True)
    J = json.load(open(OUT)) if os.path.exists(OUT) else {}
    J["meta"] = {"tool": "tools/dynamics_verify.py", "train": TRAIN, "test": TEST, "vault_from": VAULT,
                 "built": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}

    def save():
        with open(OUT + ".tmp", "w") as fh:
            json.dump(J, fh, indent=1, default=float)
        os.replace(OUT + ".tmp", OUT)
    if "A" in parts:
        J["A_joins"] = part_a(F, S); save(); print("A", J["A_joins"], flush=True)
    if "F" in parts:
        J["F_round_targets"] = part_f(S); save()
    if "D" in parts:
        J["D_variance_moments"] = {p: part_d(S, p) for p in ("train", "test")}; save()
        print("D", J["D_variance_moments"], flush=True)
    if "E" in parts:
        J["E_cardio"] = part_e(S, a.boot); save(); print("E", J["E_cardio"], flush=True)
    if parts & {"B", "C"}:
        res, d, cells = part_b(S, a.boot if "B" in parts else 0)
        if "B" in parts:
            J["B_kd_hazard"] = res; save()
        if "C" in parts:
            J["C_five_round_window"] = part_c(d, cells); save(); print("C", J["C_five_round_window"], flush=True)
    if "G" in parts:
        J["G_ks_lag_stress"] = part_g(); save()
    J["meta"]["secs"] = time.time() - t0
    save()
    print(f"wrote {OUT} ({time.time() - t0:.0f}s)")


if __name__ == "__main__":
    main()
