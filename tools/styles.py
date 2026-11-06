#!/usr/bin/env python3
"""Styles and matchups (engine v7 component): style vectors, archetypes, and walk-forward tests of
style interactions on the backtest.

    python3 tools/styles.py                 # from the project root, about a minute
    python3 tools/styles.py --boot 2000     # paired-bootstrap replicates for the held-out deltas

Reads   data/derived/backtest.json (walk-forward snapshots), data/derived/fighters.json (live roster),
        data/raw/*.csv through tools/build_db.py (per-fight stat vectors by position, for the rate
        models), data/scouting/*.json (archetypes and tags, ~82 fighters).
Writes  data/derived/styles.json and research/model_styles.md.

Walk-forward discipline: every feature of a backtest fight is built from that side's frozen
pre-fight sums `S` and the priors_asof table of the fight's year (fights before Jan 1 of that year).
Standardisation constants, clusters, penalties and coefficients are all fit on 2019-2023 fights only;
2024-01-01 onward is reported, never tuned on.

Needs numpy and pandas (no scipy).
"""
import argparse
import datetime as dt
import glob
import json
import math
import os
import sys
from collections import Counter, defaultdict

for _v in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "1")     # small dense fits: threaded BLAS only adds contention
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
DER = os.path.join(ROOT, "data", "derived")
OUT_JSON = os.path.join(DER, "styles.json")
OUT_MD = os.path.join(ROOT, "research", "model_styles.md")

TUNE = ("2019-01-01", "2024-01-01")
TEST_FROM = "2024-01-01"
SEED = 20261106

# --------------------------------------------------------------------------------------------- shrinkage
# Pseudo-exposure of the division prior blended into every rate (minutes for per-minute rates, attempts
# for proportions, landed head strikes for knockdown rates). Tuned lightly on 2019-2023 (see report).
K_MIN = 20.0        # per-minute rates
K_ATT = 60.0        # strike accuracy / defense / attempt shares (attempts)
K_TD = 8.0          # takedown accuracy / defense (attempts)
K_HEAD = 250.0      # knockdowns per landed head strike
K_CTRLTD = 3.0      # control seconds per takedown landed (takedowns)


def logit(p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


def sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))


def shr_rate(x, mins, prior_rate, k=K_MIN):
    """events per minute shrunk toward the prior rate with k pseudo-minutes"""
    return (x + k * prior_rate) / (mins + k)


def shr_prop(num, den, p0, k):
    return (num + k * p0) / (den + k)


class Side:
    """Feature extractor for one pre-fight snapshot (S sums) against a division prior."""

    def __init__(self, keys):
        self.KI = {k: i for i, k in enumerate(keys)}

    def g(self, S, k):
        return S[self.KI[k]]

    def features(self, S, P, meta):
        g = lambda k: S[self.KI[k]]
        m = g("min")
        f = {}
        # --- league reference values from the prior (per fighter-minute and proportions)
        p_sig_att = P["d_att"] + P["c_att"] + P["g_att"]
        p_sig_lnd = P["d_lnd"] + P["c_lnd"] + P["g_lnd"]
        sig_att = g("d_att") + g("c_att") + g("g_att")
        sig_lnd = g("d_lnd") + g("c_lnd") + g("g_lnd")
        osig_att = g("od_att") + g("oc_att") + g("og_att")
        osig_lnd = g("od_lnd") + g("oc_lnd") + g("og_lnd")
        # --- volume / pace (attempts per minute vs division)
        vol = shr_rate(sig_att, m, p_sig_att)
        f["vol"] = math.log(vol / p_sig_att)
        f["slpm"] = math.log(shr_rate(sig_lnd, m, p_sig_lnd) / p_sig_lnd)
        f["sapm"] = math.log(shr_rate(osig_lnd, m, p_sig_lnd) / p_sig_lnd)
        f["net"] = (shr_rate(sig_lnd, m, p_sig_lnd) - shr_rate(osig_lnd, m, p_sig_lnd)) / p_sig_lnd
        # --- pressure / counter proxy: own distance attempts vs opponents' distance attempts against him
        kd_ = K_MIN * P["d_att"]
        f["press"] = math.log((g("d_att") + kd_) / (g("od_att") + kd_))
        # opponents' distance output against him relative to league (does he suppress or invite output?)
        f["opp_vol"] = math.log(shr_rate(g("od_att"), m, P["d_att"]) / P["d_att"])
        # --- accuracy and defense (distance strikes, the standing exchange), log-odds vs league
        a0 = P["acc_d"]
        f["acc"] = float(logit(shr_prop(g("d_lnd"), g("d_att"), a0, K_ATT)) - logit(a0))
        f["dfn"] = float(logit(1 - shr_prop(g("od_lnd"), g("od_att"), a0, K_ATT)) - logit(1 - a0))
        f["acc_sig"] = float(logit(shr_prop(sig_lnd, sig_att, P["acc_sig"], K_ATT)) - logit(P["acc_sig"]))
        # --- position mix of his significant attempts (log-odds vs league share)
        for pos in ("d", "c", "g"):
            p0 = P[pos + "_att"] / p_sig_att
            f["sh_" + pos] = float(logit(shr_prop(g(pos + "_att"), sig_att, p0, K_ATT)) - logit(p0))
        # --- target mix of his significant attempts
        tg_att = g("h_att") + g("b_att") + g("l_att")
        p_tg = P["h_att"] + P["b_att"] + P["l_att"]
        for t in ("h", "b", "l"):
            p0 = P[t + "_att"] / p_tg
            f["sh_" + t] = float(logit(shr_prop(g(t + "_att"), tg_att, p0, K_ATT)) - logit(p0))
        # target mix of what he absorbs (are his opponents kicking him?)
        otg_att = g("oh_att") + g("ob_att") + g("ol_att")
        p0 = P["l_att"] / p_tg
        f["osh_l"] = float(logit(shr_prop(g("ol_att"), otg_att, p0, K_ATT)) - logit(p0))
        # --- grappling
        f["td_int"] = math.log(shr_rate(g("td_att"), m, P["td_att"]) / P["td_att"])
        t0 = P["td_acc"]
        f["td_acc"] = float(logit(shr_prop(g("td_lnd"), g("td_att"), t0, K_TD)) - logit(t0))
        f["td_def"] = float(logit(1 - shr_prop(g("otd_lnd"), g("otd_att"), t0, K_TD)) - logit(1 - t0))
        f["otd_int"] = math.log(shr_rate(g("otd_att"), m, P["otd_att"]) / P["otd_att"])
        f["ctrl"] = math.log(shr_rate(g("ctrl"), m, P["ctrl"]) / P["ctrl"])
        f["octrl"] = math.log(shr_rate(g("octrl"), m, P["octrl"]) / P["octrl"])
        c0 = P["ctrl_per_td"]
        f["ctrl_td"] = math.log(((g("ctrl") + K_CTRLTD * c0) / (g("td_lnd") + K_CTRLTD)) / c0)
        # bottom escape: control conceded per takedown absorbed (high = stuck underneath)
        f["octrl_td"] = math.log(((g("octrl") + K_CTRLTD * c0) / (g("otd_lnd") + K_CTRLTD)) / c0)
        f["sub_int"] = math.log(shr_rate(g("sub_att"), m, P["sub_att"]) / P["sub_att"])
        f["osub_int"] = math.log(shr_rate(g("osub_att"), m, P["osub_att"]) / P["osub_att"])
        # --- exposure-correct position rates: standing minutes = minutes minus control time either way
        p_stand = max(1.0 - (P["ctrl"] + P["octrl"]) / 60.0, 0.3)       # league standing share of a minute
        st = max(m - (g("ctrl") + g("octrl")) / 60.0, 0.3 * m)
        f["st_share"] = math.log(((st + K_MIN * p_stand) / (m + K_MIN)) / p_stand)
        f["d_rate"] = math.log(shr_rate(g("d_att"), st, P["d_att"] / p_stand) / (P["d_att"] / p_stand))
        f["od_rate"] = math.log(shr_rate(g("od_att"), st, P["d_att"] / p_stand) / (P["d_att"] / p_stand))
        f["td_rate"] = math.log(shr_rate(g("td_att"), st, P["td_att"] / p_stand) / (P["td_att"] / p_stand))
        f["otd_rate"] = math.log(shr_rate(g("otd_att"), st, P["otd_att"] / p_stand) / (P["otd_att"] / p_stand))
        top = g("ctrl") / 60.0
        p_top = P["ctrl"] / 60.0
        f["g_rate"] = math.log(shr_rate(g("g_att"), top, P["g_att"] / p_top, k=5.0) / (P["g_att"] / p_top))
        f["c_rate"] = math.log(shr_rate(g("c_att"), m, P["c_att"]) / P["c_att"])
        f["oc_rate"] = math.log(shr_rate(g("oc_att"), m, P["oc_att"]) / P["oc_att"])
        # --- power and chin (knockdowns per landed head strike)
        k0 = P["kd_per_h"]
        f["kd_pow"] = math.log(shr_prop(g("kd"), g("h_lnd"), k0, K_HEAD) / k0)
        f["chin"] = math.log(shr_prop(g("okd"), g("oh_lnd"), k0, K_HEAD) / k0)     # >0 = easier to drop
        # --- finishing record (decayed): finish rate of wins, loss-by-finish rate
        nf = g("n") + 1.0
        f["fin_w"] = (g("ko_w") + g("sub_w") + 0.5 * 0.5) / (g("ko_w") + g("sub_w") + g("dec_w") + 0.5)
        f["winp"] = (g("ko_w") + g("sub_w") + g("dec_w") + 1.0) / (nf + 1.0)
        f["ko_l"] = (g("ko_l") + 0.2) / nf
        f["sub_l"] = (g("sub_l") + 0.1) / nf
        # --- exposure and physicals
        f["mins"] = m
        f["n"] = meta.get("n") or 0
        f["lexp"] = math.log1p(f["n"])
        f["age"] = meta.get("age")
        f["reach"] = meta.get("reach_in")
        f["height"] = meta.get("height_in")
        st = (meta.get("stance") or "").lower()
        f["southpaw"] = 1.0 if st == "southpaw" else 0.0
        f["switch"] = 1.0 if st == "switch" else 0.0
        f["orthodox"] = 1.0 if st == "orthodox" else 0.0
        f["elo"] = meta.get("elo")
        f["ko_losses"] = meta.get("ko_losses") or 0
        # late-round output ratio (cardio) from the pace curve, shrunk toward 1
        pace, pw = meta.get("pace") or [], meta.get("pace_w") or []
        num = den = 0.0
        for r in (2, 3):
            if r < len(pace) and pace[r] is not None and pw[r]:
                num += math.log(max(pace[r], 0.2)) * pw[r]
                den += pw[r]
        f["late"] = num / (den + 30.0)
        return f


# the style vector used for clustering: how he fights, not how well
STYLE_DIMS = ["vol", "press", "sh_d", "sh_c", "sh_g", "sh_h", "sh_b", "sh_l", "td_int", "ctrl", "sub_int",
              "kd_pow", "acc", "dfn", "opp_vol"]
# skill / main-effect features for the baseline (antisymmetric differences)
MAIN_DIMS = ["slpm", "sapm", "acc", "dfn", "vol", "press", "td_int", "td_acc", "td_def", "ctrl", "octrl",
             "sub_int", "osub_int", "kd_pow", "chin", "sh_d", "sh_c", "sh_g", "sh_h", "sh_b", "sh_l",
             "ctrl_td", "octrl_td", "winp", "fin_w", "ko_l", "sub_l", "lexp", "late"]


# --------------------------------------------------------------------------------------------- loading
def load_backtest():
    with open(os.path.join(DER, "backtest.json")) as fh:
        bt = json.load(fh)
    return bt


def per_fight_vectors():
    """per-fight stat vectors (own and opponent's, by position and target) keyed by (fight id, side)"""
    import build_db as B
    log = {}
    fights, _ = B.parse_fights(log)
    B.build_vectors(fights, log)
    out = {}
    for f in fights:
        if f.stats:
            out[(f.fid, 0)] = f.stats["v"][0]
            out[(f.fid, 1)] = f.stats["v"][1]
    return out, B.KEYS


def build_table(bt, vec=None):
    """one row per backtest fight with both sides' features, outcome, context and actual stats"""
    keys = bt["meta"]["keys"]
    ex = Side(keys)
    PA = bt["priors_asof"]
    rows = []
    for e in bt["fights"]:
        div = e.get("prior_division") or e["division"]
        P = PA[e["date"][:4]].get(div) or PA[e["date"][:4]]["ALL"]
        if P.get("fallback"):
            P = PA[e["date"][:4]][P["fallback"]] if P["fallback"] in PA[e["date"][:4]] else P
        r = {"id": e["id"], "date": e["date"], "div": e["division"], "pdiv": div, "rounds": e["rounds"],
             "title": bool(e["title"]), "winner": e["result"]["winner"], "method": e["result"]["method"],
             "round": e["result"]["round"], "fight_s": e["result"]["fight_s"],
             "slugA": e["A"]["slug"], "slugB": e["B"]["slug"], "nameA": e["A"]["name"], "nameB": e["B"]["name"]}
        for t in ("A", "B"):
            r[t] = ex.features(e[t]["S"], P, e[t])
        r["prior"] = P
        if vec is not None:
            r["vA"] = vec.get((e["id"], 0))
            r["vB"] = vec.get((e["id"], 1))
        rows.append(r)
    return rows


# --------------------------------------------------------------------------------------------- models
def fit_logit(X, y, lam=0.0, w=None, pen=None, iters=60, beta0=None):
    """L2-penalised logistic regression without intercept by Newton's method.
    pen: per-coefficient penalty multipliers (0 = unpenalised). Returns beta, covariance (inverse Hessian)."""
    n, p = X.shape
    w = np.ones(n) if w is None else w
    pen = np.ones(p) if pen is None else np.asarray(pen, float)
    b = np.zeros(p) if beta0 is None else beta0.copy()
    for _ in range(iters):
        z = X @ b
        mu = sigmoid(z)
        g = X.T @ (w * (y - mu)) - lam * pen * b
        H = (X * (w * mu * (1 - mu))[:, None]).T @ X + lam * np.diag(pen)
        step = np.linalg.solve(H + 1e-9 * np.eye(p), g)
        b += step
        if np.max(np.abs(step)) < 1e-9:
            break
    z = X @ b
    mu = sigmoid(z)
    H = (X * (w * mu * (1 - mu))[:, None]).T @ X + lam * np.diag(pen)
    return b, np.linalg.inv(H + 1e-9 * np.eye(p))


def logloss_vec(p, y):
    p = np.clip(p, 1e-9, 1 - 1e-9)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


def metrics(p, y):
    ll = logloss_vec(p, y)
    return {"n": int(len(y)), "log_loss": float(ll.mean()), "brier": float(np.mean((p - y) ** 2)),
            "accuracy": float(np.mean((p > 0.5) == (y > 0.5)))}


def fit_glm(X, y, family, offset=None, n_trials=None, lam=1e-4, iters=50):
    """IRLS for Poisson (log link) or Binomial (logit link, y successes of n_trials) with an intercept
    in column 0 of X (unpenalised) and a small ridge on the rest. Returns beta, cov (unscaled), dispersion."""
    n, p = X.shape
    off = np.zeros(n) if offset is None else offset
    b = np.zeros(p)
    if family == "poisson":
        b[0] = math.log(max(y.sum(), 1e-9) / max(np.exp(off).sum(), 1e-9))
    pen = np.full(p, lam)
    pen[0] = 0.0
    for _ in range(iters):
        eta = X @ b + off
        if family == "poisson":
            mu = np.exp(np.clip(eta, -30, 30))
            W, g = mu, X.T @ (y - mu)
        else:
            pr = sigmoid(eta)
            mu = n_trials * pr
            W, g = n_trials * pr * (1 - pr), X.T @ (y - mu)
        g = g - pen * b
        H = (X * W[:, None]).T @ X + np.diag(pen)
        step = np.linalg.solve(H + 1e-10 * np.eye(p), g)
        b += step
        if np.max(np.abs(step)) < 1e-10:
            break
    eta = X @ b + off
    if family == "poisson":
        mu = np.exp(eta)
        var = mu
    else:
        pr = sigmoid(eta)
        mu = n_trials * pr
        var = n_trials * pr * (1 - pr)
    W = var
    H = (X * W[:, None]).T @ X + np.diag(pen)
    cov = np.linalg.inv(H + 1e-10 * np.eye(p))
    ok = var > 1e-9
    disp = float(np.sum((y[ok] - mu[ok]) ** 2 / var[ok]) / max(ok.sum() - p, 1))
    return b, cov, disp


def glm_dev(X, b, y, family, offset=None, n_trials=None):
    """per-row deviance contributions (Poisson or Binomial)"""
    off = np.zeros(len(y)) if offset is None else offset
    eta = X @ b + off
    if family == "poisson":
        mu = np.exp(eta)
        with np.errstate(divide="ignore", invalid="ignore"):
            t = np.where(y > 0, y * np.log(y / mu), 0.0)
        return 2 * (t - (y - mu))
    pr = np.clip(sigmoid(eta), 1e-9, 1 - 1e-9)
    n = n_trials
    with np.errstate(divide="ignore", invalid="ignore"):
        t1 = np.where(y > 0, y * np.log(y / (n * pr)), 0.0)
        t2 = np.where(n - y > 0, (n - y) * np.log((n - y) / (n * (1 - pr))), 0.0)
    return 2 * (t1 + t2)


# --------------------------------------------------------------------------------------------- tables
def zconsts(rows, feats, tune_mask):
    mu, sd = {}, {}
    for k in feats:
        v = np.array([r[t][k] if r[t][k] is not None else np.nan for r, m in zip(rows, tune_mask) if m
                      for t in "AB"], float)
        mu[k] = float(np.nanmean(v))
        sd[k] = float(np.nanstd(v)) or 1.0
    return mu, sd


OUT_KEYS = ["min", "d_att", "d_lnd", "c_att", "c_lnd", "g_att", "g_lnd", "h_att", "h_lnd", "b_att", "b_lnd",
            "l_att", "l_lnd", "kd", "td_att", "td_lnd", "ctrl", "sub_att", "rev", "octrl"]


def build_sides(rows, keys, mu, sd):
    """fight-side frame: X = attacker (this side), Y = opponent; o_* = what X actually did in the fight"""
    import pandas as pd
    KI = {k: i for i, k in enumerate(keys)}
    feats = list(mu)
    recs = []
    for i, r in enumerate(rows):
        if r.get("vA") is None or r.get("vB") is None:
            continue
        for X, Y, vX in (("A", "B", r["vA"]), ("B", "A", r["vB"])):
            d = {"fi": i, "date": r["date"], "tune": r["date"] < TEST_FROM, "side": X}
            for k in feats:
                d["x_" + k] = r[X][k]
                d["y_" + k] = r[Y][k]
            for k in OUT_KEYS:
                d["o_" + k] = vX[KI[k]]
            P = r["prior"]
            d["p_acc_d"], d["p_td_acc"], d["p_kd"] = P["acc_d"], P["td_acc"], P["kd_per_h"]
            recs.append(d)
    D = pd.DataFrame(recs)
    add = {}
    for k in feats:
        add["zx_" + k] = ((D["x_" + k] - mu[k]) / sd[k]).fillna(0.0)
        add["zy_" + k] = ((D["y_" + k] - mu[k]) / sd[k]).fillna(0.0)
    D = pd.concat([D, pd.DataFrame(add)], axis=1)
    D["st_min"] = np.maximum(D.o_min - (D.o_ctrl + D.o_octrl) / 60.0, 0.15 * D.o_min)
    D["top_min"] = D.o_ctrl / 60.0
    D["open"] = (((D.x_southpaw == 1) & (D.y_orthodox == 1)) | ((D.x_orthodox == 1) & (D.y_southpaw == 1))).astype(float)
    D["x_sp_vs_orth"] = ((D.x_southpaw == 1) & (D.y_orthodox == 1)).astype(float)
    D["x_orth_vs_sp"] = ((D.x_orthodox == 1) & (D.y_southpaw == 1)).astype(float)
    D["x_sw"], D["y_sw"] = D.x_switch, D.y_switch
    D["reach_d"] = ((D.x_reach - D.y_reach) / sd["reach"]).fillna(0.0)
    D["height_d"] = ((D.x_height - D.y_height) / sd["height"]).fillna(0.0)
    D["age_d"] = ((D.x_age - D.y_age) / sd["age"]).fillna(0.0)
    D["kick_x"] = (D.zx_sh_l + D.zx_sh_b) / math.sqrt(2)
    D["kick_y"] = (D.zy_sh_l + D.zy_sh_b) / math.sqrt(2)
    D["neg_zy_dfn"] = -D.zy_dfn
    D["neg_zy_td_def"] = -D.zy_td_def
    D["tot_tg"] = D.o_h_att + D.o_b_att + D.o_l_att
    return D.copy()


# --------------------------------------------------------------------------------------------- rate models
# Each spec: outcome count y for attacker X, exposure (offset), the engine-style main effects (X's own rate
# and what Y allows, both log-ratios to the division prior: coefficient 1 = the engine's log-linear / log5
# combination) and the pre-registered style candidates. A candidate is a column name or a (u, v) product.
def rate_specs(D):
    lg = np.log
    return {
        "dist_att": dict(desc="distance significant attempts per standing minute", fam="poisson", y="o_d_att",
                         off=lg(D.st_min), base=["zx_d_rate", "zy_od_rate"],
                         cand=["zy_kd_pow", "zy_td_int", "zy_press", "zx_press", "kick_y", "kick_x", "open",
                               "x_sp_vs_orth", "x_orth_vs_sp", "reach_d", "height_d", ("zx_press", "zy_press"),
                               ("zx_vol", "zy_dfn"), ("zx_press", "zy_kd_pow"), ("zx_d_rate", "zy_od_rate"),
                               "zy_vol", "zy_acc"]),
        "dist_acc": dict(desc="distance accuracy (landed of attempted), log5 baseline", fam="binomial",
                         y="o_d_lnd", n="o_d_att", off=lambda D: logit(D.p_acc_d), base=["zx_acc", "neg_zy_dfn"],
                         cand=[("zx_acc", "zy_dfn"), ("zx_press", "zy_dfn"), ("zx_vol", "zy_dfn"), "zy_press",
                               "zx_press", "zy_vol", "kick_x", "kick_y", "open", "x_sp_vs_orth", "x_orth_vs_sp",
                               "reach_d", "height_d", ("zx_acc", "zy_press"), "zy_td_int", "zy_kd_pow"]),
        "leg_share": dict(desc="leg share of significant attempts", fam="binomial", y="o_l_att", n="tot_tg",
                          off=None, base=["zx_sh_l", "zy_osh_l"],
                          cand=["zy_td_int", "zy_press", "zy_kd_pow", "open", "x_sp_vs_orth", "x_orth_vs_sp",
                                "reach_d", "height_d", ("zx_sh_l", "zy_osh_l"), "y_sw", "zy_sh_l"]),
        "body_share": dict(desc="body share of significant attempts", fam="binomial", y="o_b_att", n="tot_tg",
                           off=None, base=["zx_sh_b"],
                           cand=["open", "x_sp_vs_orth", "x_orth_vs_sp", "y_sw", "zy_td_int", "zy_press",
                                 "reach_d", "height_d"]),
        "td_att": dict(desc="takedown attempts per standing minute", fam="poisson", y="o_td_att",
                       off=lg(D.st_min), base=["zx_td_rate", "zy_otd_rate"],
                       cand=["zy_td_def", ("zx_td_int", "zy_td_def"), "kick_y", "zy_net", "zx_net", "zy_sub_int",
                             "zy_kd_pow", "zy_td_int", ("zx_td_int", "zy_td_int"), "zy_press", "zy_vol", "open",
                             "reach_d", "height_d", ("zx_td_rate", "zy_otd_rate")]),
        "td_acc": dict(desc="takedown success (landed of attempted), log5 baseline", fam="binomial", y="o_td_lnd",
                       n="o_td_att", off=lambda D: logit(D.p_td_acc), base=["zx_td_acc", "neg_zy_td_def"],
                       cand=[("zx_td_acc", "zy_td_def"), "kick_y", "zy_press", "zy_vol", "zx_sh_c", "zy_sh_c",
                             "zy_ctrl", "zy_td_int", ("zx_td_int", "zy_td_int"), "open", "reach_d", "height_d",
                             "zx_td_int", "zy_sub_int", "zy_kd_pow"]),
        "ctrl": dict(desc="control seconds per minute (quasi-Poisson)", fam="poisson", y="o_ctrl", off=lg(D.o_min),
                     base=["zx_ctrl", "zy_octrl"],
                     cand=[("zx_ctrl", "zy_octrl"), "zy_td_int", "zy_ctrl", ("zx_ctrl", "zy_ctrl"), "zy_sub_int",
                           "zy_octrl_td", ("zx_ctrl_td", "zy_octrl_td"), "zy_td_def", "kick_y", "zy_net",
                           "reach_d", "height_d"]),
        "kd": dict(desc="knockdowns per landed head strike", fam="poisson", y="o_kd",
                   off=lambda D: np.log(np.maximum(D.o_h_lnd, 0.5)) + np.log(D.p_kd), base=["zx_kd_pow", "zy_chin"],
                   cand=[("zx_kd_pow", "zy_chin"), "zy_press", "zx_press", "zy_vol", "zy_dfn", "zx_acc", "open",
                         "x_sp_vs_orth", "x_orth_vs_sp", "reach_d", "height_d", ("zx_kd_pow", "zy_press"),
                         ("zx_kd_pow", "zy_vol"), "zy_td_int"]),
        "sub_att": dict(desc="submission attempts per minute", fam="poisson", y="o_sub_att", off=lg(D.o_min),
                        base=["zx_sub_int", "zy_osub_int"],
                        cand=[("zx_sub_int", "zy_osub_int"), "zy_octrl", "zy_ctrl", "zy_td_int",
                              ("zx_sub_int", "zy_td_int"), ("zx_sub_int", "zy_ctrl"), "zy_sub_int", "height_d"]),
        "clinch_att": dict(desc="clinch significant attempts per minute", fam="poisson", y="o_c_att",
                           off=lg(D.o_min), base=["zx_c_rate", "zy_oc_rate"],
                           cand=[("zx_sh_c", "zy_sh_c"), "zy_td_int", "zx_td_int", "reach_d", "height_d", "kick_y",
                                 "zy_press", "zy_vol", "zy_kd_pow"]),
        "gnp_att": dict(desc="ground significant attempts per own control minute", fam="poisson", y="o_g_att",
                        off=lambda D: np.log(D.top_min + 0.25), base=["zx_g_rate"],
                        cand=["zy_sub_int", "zy_osub_int", "zy_octrl_td", "zy_td_int", "height_d", "reach_d",
                              "zy_kd_pow"]),
    }


def _col(D, c):
    if isinstance(c, tuple):
        return (D[c[0]] * D[c[1]]).to_numpy(float)
    return D[c].to_numpy(float)


def cname(c):
    return c if isinstance(c, str) else c[0] + "*" + c[1]


def rate_tests(D, n_boot=1000, seed=SEED, z_screen=3.0):
    """Fit every rate spec on 2019-2023 sides, test each candidate: tune z (quasi-likelihood), leave-one-
    year-out CV deviance change inside 2019-2023, held-out 2024+ deviance change with a fight-level
    bootstrap CI, and a test-only refit z (diagnostic, never used for selection)."""
    specs = rate_specs(D)
    fi = D.fi.to_numpy()
    tune = D.tune.to_numpy()
    yr = D.date.str[:4].astype(int).to_numpy()
    rng = np.random.default_rng(seed)
    out = {}
    for name, m in specs.items():
        y = D[m["y"]].to_numpy(float)
        n = D[m["n"]].to_numpy(float) if m.get("n") else None
        off = m["off"](D) if callable(m["off"]) else (np.zeros(len(D)) if m["off"] is None else m["off"])
        off = np.asarray(off, float)
        ok = np.isfinite(off) & np.isfinite(y)
        if n is not None:
            ok &= n > 0
        tr, te = tune & ok, (~tune) & ok
        nn = lambda mask: None if n is None else n[mask]
        Xb = np.column_stack([np.ones(len(D))] + [_col(D, c) for c in m["base"]])
        b0, cov0, disp0 = fit_glm(Xb[tr], y[tr], m["fam"], off[tr], nn(tr))
        dev0 = fit_dev = glm_dev(Xb[te], b0, y[te], m["fam"], off[te], nn(te))
        bn, _, _ = fit_glm(Xb[tr][:, :1], y[tr], m["fam"], off[tr], nn(tr))
        devn = glm_dev(Xb[te][:, :1], bn, y[te], m["fam"], off[te], nn(te))
        # leave-one-year-out CV deviance of the baseline inside the tuning years
        def loyo(X):
            tot = 0.0
            for Y in range(2019, 2024):
                a, v = tr & (yr != Y), tr & (yr == Y)
                b, _, _ = fit_glm(X[a], y[a], m["fam"], off[a], nn(a))
                tot += glm_dev(X[v], b, y[v], m["fam"], off[v], nn(v)).sum()
            return tot
        cv0 = loyo(Xb)
        ufi = np.unique(fi[te])
        boots = [rng.integers(0, len(ufi), len(ufi)) for _ in range(n_boot)]
        res = {"desc": m["desc"], "family": m["fam"], "n_tune": int(tr.sum()), "n_test": int(te.sum()),
               "base_terms": [cname(c) for c in m["base"]],
               "base_coef": [float(v) for v in b0], "base_se": [float(v) for v in np.sqrt(np.diag(cov0) * disp0)],
               "dispersion": disp0, "test_dev_null": float(devn.sum()), "test_dev_base": float(dev0.sum()),
               "candidates": []}
        for c in m["cand"]:
            x = _col(D, c)
            s = x[tr].std() or 1.0
            X = np.column_stack([Xb, x / s])
            b, cov, disp = fit_glm(X[tr], y[tr], m["fam"], off[tr], nn(tr))
            z = b[-1] / math.sqrt(cov[-1, -1] * disp)
            cv = loyo(X) - cv0
            dd = glm_dev(X[te], b, y[te], m["fam"], off[te], nn(te)) - dev0
            per_f = np.bincount(np.searchsorted(ufi, fi[te]), weights=dd, minlength=len(ufi))
            bs = np.array([per_f[bi].sum() for bi in boots])
            bt_, covt, dispt = fit_glm(X[te], y[te], m["fam"], off[te], nn(te))
            zt = bt_[-1] / math.sqrt(covt[-1, -1] * dispt)
            passed_screen = abs(z) >= z_screen and cv < 0
            res["candidates"].append({
                "term": cname(c), "sd": float(s), "coef_per_sd": float(b[-1]), "coef_raw": float(b[-1] / s),
                "se_per_sd": float(math.sqrt(cov[-1, -1] * disp)), "z_tune": float(z), "cv_dev_change": float(cv),
                "test_dev_change": float(dd.sum()), "test_dev_ci": [float(np.percentile(bs, 2.5)),
                                                                     float(np.percentile(bs, 97.5))],
                "test_dev_change_pct": float(dd.sum() / dev0.sum() * 100), "z_test_only": float(zt),
                "screen": bool(passed_screen),
                "verdict": ("survives" if passed_screen and np.percentile(bs, 97.5) < 0 else
                            "supported" if passed_screen and dd.sum() < 0 and np.sign(zt) == np.sign(z) else
                            "fails held-out" if passed_screen else "not screened in"),
            })
        out[name] = res
    return out


# --------------------------------------------------------------------------------------------- archetypes
GROUPS = {"vol": "output", "press": "output", "opp_vol": "output", "sh_d": "position", "sh_c": "position",
          "sh_g": "position", "sh_h": "target", "sh_b": "target", "sh_l": "target", "td_int": "grappling",
          "ctrl": "grappling", "sub_int": "grappling", "kd_pow": "power", "acc": "power", "dfn": "power"}


def dim_weights():
    cnt = Counter(GROUPS[d] for d in STYLE_DIMS)
    return np.array([1.0 / math.sqrt(cnt[GROUPS[d]]) for d in STYLE_DIMS])


def kmeans(X, k, seed=SEED, n_init=20, iters=300):
    rng = np.random.default_rng(seed)
    best = None
    for _ in range(n_init):
        c = [X[rng.integers(len(X))]]
        for _ in range(k - 1):
            d2 = np.min(((X[:, None, :] - np.array(c)[None]) ** 2).sum(-1), 1)
            c.append(X[rng.choice(len(X), p=d2 / d2.sum())])
        c = np.array(c)
        for _ in range(iters):
            lab = ((X[:, None, :] - c[None]) ** 2).sum(-1).argmin(1)
            nc = np.array([X[lab == j].mean(0) if (lab == j).any() else c[j] for j in range(k)])
            if np.allclose(nc, c):
                break
            c = nc
        inert = float(((X - c[lab]) ** 2).sum())
        if best is None or inert < best[0]:
            best = (inert, c, lab)
    return best


def ari(a, b):
    a, b = np.asarray(a), np.asarray(b)
    ct = np.zeros((a.max() + 1, b.max() + 1))
    np.add.at(ct, (a, b), 1)
    c2 = lambda x: x * (x - 1) / 2.0
    s, sa, sb, n = c2(ct).sum(), c2(ct.sum(1)).sum(), c2(ct.sum(0)).sum(), c2(ct.sum())
    e = sa * sb / n
    return float((s - e) / ((sa + sb) / 2 - e))


def silhouette(X, lab, max_n=1500, seed=SEED):
    rng = np.random.default_rng(seed)
    idx = rng.choice(len(X), min(len(X), max_n), replace=False)
    X, lab = X[idx], lab[idx]
    D = np.sqrt(((X[:, None, :] - X[None]) ** 2).sum(-1))
    s = []
    for i in range(len(X)):
        same = lab == lab[i]
        a = D[i, same].sum() / max(same.sum() - 1, 1)
        b = min(D[i, lab == j].mean() for j in np.unique(lab) if j != lab[i])
        s.append((b - a) / max(a, b))
    return float(np.mean(s))


def soft_membership(Zw, cent, temp):
    d2 = ((Zw[:, None, :] - cent[None]) ** 2).sum(-1)
    l = -d2 / temp
    l -= l.max(1, keepdims=True)
    p = np.exp(l)
    return p / p.sum(1, keepdims=True)


def name_cluster(c):
    """plain-language archetype name from a centroid (dict of z-scores on STYLE_DIMS)"""
    grap = (c["td_int"] + c["ctrl"]) / 2
    kick = (c["sh_l"] + c["sh_b"]) / 2
    if grap > 0.5 and c["sh_c"] > 0.4:
        return "clinch-control wrestle-boxer"
    if grap > 0.8 and c["sh_g"] > 0.6:
        return "wrestler / top-control grappler"
    if c["press"] < -0.8:
        return "counter striker"
    if c["kd_pow"] > 0.7:
        return "power puncher"
    if c["sh_d"] > 1.2 and c["vol"] > 0.9:
        return "high-volume distance boxer"
    if kick > 0.6 and c["sh_d"] > 0.5:
        return "rangy kickboxer"
    if c["vol"] > 0.6 and c["press"] > 0.4:
        return "pressure volume striker"
    if kick > 0.4 and c["sh_c"] > 0.4:
        return "clinch / body-kick all-rounder"
    return "balanced all-rounder"


# --------------------------------------------------------------------------------------------- winner level
BASE_WIN = ["elo", "age", "reach"] + MAIN_DIMS


class WinData:
    """decisive backtest fights as antisymmetric design pieces (A minus B; no intercept, so the corner
    order cannot leak: flipping A and B flips every feature and the label)."""

    def __init__(self, rows, mu, sd, memb=None):
        keep = [i for i, r in enumerate(rows) if r["winner"] in ("A", "B")]
        self.keep = np.array(keep)
        self.rows = [rows[i] for i in keep]
        self.y = np.array([1.0 if r["winner"] == "A" else 0.0 for r in self.rows])
        self.yr = np.array([int(r["date"][:4]) for r in self.rows])
        self.tune = self.yr < int(TEST_FROM[:4])
        self.test = ~self.tune
        self.r5 = np.array([1.0 if r["rounds"] == 5 else 0.0 for r in self.rows])
        self.mu, self.sd = mu, sd
        self.Z = {}
        for k in mu:
            a = np.array([r["A"][k] if r["A"][k] is not None else np.nan for r in self.rows], float)
            b = np.array([r["B"][k] if r["B"][k] is not None else np.nan for r in self.rows], float)
            self.Z[k] = (np.nan_to_num((a - mu[k]) / sd[k]), np.nan_to_num((b - mu[k]) / sd[k]))
        self.raw = {k: (np.array([r["A"][k] or 0.0 for r in self.rows], float),
                        np.array([r["B"][k] or 0.0 for r in self.rows], float))
                    for k in ("southpaw", "switch", "orthodox")}
        if memb is not None:
            self.M = (memb[0][keep], memb[1][keep])

    def zd(self, k):
        return self.Z[k][0] - self.Z[k][1]

    def pair(self, u):
        if isinstance(u, str):
            return self.Z[u]
        if isinstance(u, tuple) and u[0] == "neg":
            a, b = self.pair(u[1])
            return -a, -b
        if isinstance(u, tuple) and u[0] == "mix":
            a = sum(self.Z[k][0] for k in u[1]) / math.sqrt(len(u[1]))
            b = sum(self.Z[k][1] for k in u[1]) / math.sqrt(len(u[1]))
            return a, b
        return u

    def cross(self, u, v):
        uA, uB = self.pair(u)
        vA, vB = self.pair(v)
        return uA * vB - uB * vA

    def ctx(self, k):
        return (self.Z[k][0] + self.Z[k][1]) / 2.0

    def ind(self, k, lo=None, hi=None):
        a, b = self.Z[k]
        fa = np.ones_like(a, bool)
        fb = np.ones_like(b, bool)
        if lo is not None:
            fa &= a > lo
            fb &= b > lo
        if hi is not None:
            fa &= a < hi
            fb &= b < hi
        return fa.astype(float), fb.astype(float)

    def base(self, terms=None):
        X = np.column_stack([self.zd(c) for c in (terms or BASE_WIN)])
        return X / X[self.tune].std(0)


def winner_candidates(W):
    kick = ("mix", ["sh_l", "sh_b"])
    sp, sw, orth = W.raw["southpaw"], W.raw["switch"], W.raw["orthodox"]
    stance_main = [sp[0] - sp[1], sw[0] - sw[1]]
    open_sp = ((sp[0] == 1) & (orth[1] == 1)).astype(float) - ((sp[1] == 1) & (orth[0] == 1)).astype(float)
    open_st = (((sp[0] == 1) & (orth[1] == 1)) | ((sp[1] == 1) & (orth[0] == 1))).astype(float)
    kA, kB = W.pair(kick)

    def indx(fa, fb):          # type indicator: A is type 1 and B type 2, minus the reverse
        (a1, b1), (a2, b2) = fa, fb
        return a1 * b2 - b1 * a2

    wrestler = tuple(x * y for x, y in zip(W.ind("td_int", lo=1.0), W.ind("ctrl", lo=0.5)))
    kicker = (((kA > 1.0)).astype(float), ((kB > 1.0)).astype(float))
    C = {
        # continuous crosses: A's u against B's v, antisymmetrised
        "wrestling vs low takedown defense": ("cross", [W.cross("td_int", ("neg", "td_def"))], []),
        "takedown accuracy vs low takedown defense": ("cross", [W.cross("td_acc", ("neg", "td_def"))], []),
        "control vs stuck-on-bottom": ("cross", [W.cross("ctrl", "octrl_td")], []),
        "control vs time on bottom": ("cross", [W.cross("ctrl", "octrl")], []),
        "submission threat vs time on bottom": ("cross", [W.cross("sub_int", "octrl")], []),
        "submission threat vs submission exposure": ("cross", [W.cross("sub_int", "osub_int")], []),
        "kicker vs wrestler": ("cross", [W.cross(kick, "td_int")], []),
        "pressure vs striking defense": ("cross", [W.cross("press", "dfn")], []),
        "pressure vs counter accuracy": ("cross", [W.cross("press", "acc")], []),
        "pressure vs volume": ("cross", [W.cross("press", "vol")], []),
        "volume vs power": ("cross", [W.cross("vol", "kd_pow")], []),
        "power vs chin": ("cross", [W.cross("kd_pow", "chin")], []),
        "clinch fighter vs distance fighter": ("cross", [W.cross("sh_c", "sh_d")], []),
        "ground-and-pound vs time on bottom": ("cross", [W.cross("g_rate", "octrl")], []),
        "leg kicker vs opponent who gets leg-kicked": ("cross", [W.cross("sh_l", "osh_l")], []),
        "volume vs poor cardio": ("cross", [W.cross("vol", ("neg", "late"))], []),
        # skill differential weighted by the fight's expected context
        "striking edge x distance context": ("context", [W.zd("net") * W.ctx("sh_d")], []),
        "striking edge x low-wrestling context": ("context", [W.zd("net") * -W.ctx("td_int")], []),
        "grappling edge x wrestling context": ("context", [(W.zd("ctrl") - W.zd("octrl")) * W.ctx("td_int")], []),
        "reach edge x distance context": ("context", [W.zd("reach") * W.ctx("sh_d")], []),
        "reach x own distance share": ("context", [W.Z["reach"][0] * W.Z["sh_d"][0] -
                                                    W.Z["reach"][1] * W.Z["sh_d"][1]], []),
        "age gap x five rounds": ("context", [W.zd("age") * W.r5], []),
        "cardio edge x five rounds": ("context", [W.zd("late") * W.r5], []),
        # stance
        "stance main effects (southpaw, switch)": ("stance", stance_main, []),
        "southpaw vs orthodox (open-stance edge)": ("stance", [open_sp], stance_main),
        "kicker x open stance": ("stance", [(kA - kB) * open_st], []),
        # type indicators (z thresholds on the 2019-2023 side distribution)
        "wrestler type vs weak takedown defense": ("type", [indx(wrestler, W.ind("td_def", hi=-0.5))], []),
        "kicker type vs wrestler type": ("type", [indx(kicker, W.ind("td_int", lo=1.0))], []),
        "pressure type vs counter type": ("type", [indx(W.ind("press", lo=1.0), W.ind("press", hi=-1.0))], []),
        "power type vs volume type": ("type", [indx(W.ind("kd_pow", lo=1.0), W.ind("vol", lo=1.0))], []),
        "submission type vs wrestler type": ("type", [indx(W.ind("sub_int", lo=1.0), W.ind("td_int", lo=1.0))], []),
    }
    if hasattr(W, "M"):
        mA, mB = W.M
        K = mA.shape[1]
        mains = [mA[:, j] - mB[:, j] for j in range(K - 1)]
        pairs = [mA[:, i] * mB[:, j] - mA[:, j] * mB[:, i] for i in range(K) for j in range(i + 1, K)]
        C["archetype main effects"] = ("archetype", mains, [])
        C["archetype x archetype matrix"] = ("archetype", pairs, mains)
    return C


def _loyo_logit(X, y, yr, tune, pen):
    p = np.zeros(len(y))
    for Y in sorted(set(yr[tune])):
        a, v = tune & (yr != Y), tune & (yr == Y)
        b, _ = fit_logit(X[a], y[a], 1.0, pen=pen)
        p[v] = sigmoid(X[v] @ b)
    return p


def choose_lam(X, y, yr, tune, grid=(1, 3, 10, 20, 30, 50, 100, 300)):
    scores = {}
    for lam in grid:
        p = _loyo_logit(X, y, yr, tune, np.full(X.shape[1], float(lam)))
        scores[lam] = float(logloss_vec(p[tune], y[tune]).mean())
    best = min(scores, key=scores.get)
    return best, scores


def winner_tests(W, n_boot=2000, seed=SEED, lam_int=1.0, base_terms=None):
    y, yr, tune, test = W.y, W.yr, W.tune, W.test
    base_terms = base_terms or BASE_WIN
    Xb = W.base(base_terms)
    lam, lam_scores = choose_lam(Xb, y, yr, tune)
    pen_b = np.full(Xb.shape[1], float(lam))
    rng = np.random.default_rng(seed)
    nT = int(test.sum())
    boots = rng.integers(0, nT, (n_boot, nT))

    def evaluate(Xref, pen_ref, Xadd, lam_add):
        X = np.column_stack([Xref] + Xadd) if Xadd else Xref
        pen = np.concatenate([pen_ref, np.full(len(Xadd), lam_add)]) if Xadd else pen_ref
        b, cov = fit_logit(X[tune], y[tune], 1.0, pen=pen)
        p_cv = _loyo_logit(X, y, yr, tune, pen)
        p_te = sigmoid(X[test] @ b)
        return X, pen, b, cov, p_cv, p_te

    _, _, b0, _, pcv0, pte0 = evaluate(Xb, pen_b, [], 0)
    ll_cv0 = logloss_vec(pcv0[tune], y[tune])
    ll_te0 = logloss_vec(pte0, y[test])
    elo_X = Xb[:, :1]
    be, _ = fit_logit(elo_X[tune], y[tune], 1.0, pen=np.array([1.0]))
    out = {"baseline": {"terms": base_terms, "lam": lam, "lam_cv": lam_scores,
                        "coef": dict(zip(base_terms, [float(v) for v in b0])),
                        "cv_tune": metrics(pcv0[tune], y[tune]), "test": metrics(pte0, y[test])},
           "elo_only": {"test": metrics(sigmoid(elo_X[test] @ be), y[test])},
           "candidates": {}}
    cands = winner_candidates(W)
    for name, (kind, add, given) in cands.items():
        def std(cols):
            return [c / (c[tune].std() or 1.0) for c in cols]
        add_s, giv_s = std(add), std(given)
        if giv_s:
            Xr, pr, _, _, pcv_r, pte_r = evaluate(Xb, pen_b, giv_s, lam_int)
        else:
            Xr, pr, pcv_r, pte_r = Xb, pen_b, pcv0, pte0
        la = lam_int
        if len(add_s) > 3:      # a block (archetype matrix): pick its ridge by LOYO CV inside 2019-2023
            best = None
            for g in (3, 10, 30, 100, 300):
                _, _, _, _, pc, _ = evaluate(Xr, pr, add_s, g)
                s = logloss_vec(pc[tune], y[tune]).mean()
                if best is None or s < best[0]:
                    best = (s, g)
            la = best[1]
        X, pen, b, cov, pcv, pte = evaluate(Xr, pr, add_s, la)
        k = len(add_s)
        bz = b[-k:]
        z = bz / np.sqrt(np.diag(cov)[-k:])
        # tune-period penalised deviance gain (LR-style) for the block
        llr = logloss_vec(sigmoid(Xr[tune] @ fit_logit(Xr[tune], y[tune], 1.0, pen=pr)[0]), y[tune]).sum()
        llf = logloss_vec(sigmoid(X[tune] @ b), y[tune]).sum()
        lr = 2 * (llr - llf)
        dcv = float((logloss_vec(pcv[tune], y[tune]) - logloss_vec(pcv_r[tune], y[tune])).mean())
        d = logloss_vec(pte, y[test]) - logloss_vec(pte_r, y[test])
        bd = d[boots].mean(1)
        # diagnostic only: refit on 2024+ to see whether the sign holds there
        bt, covt = fit_logit(X[test], y[test], 1.0, pen=pen)
        zt = bt[-k:] / np.sqrt(np.diag(covt)[-k:])
        if k == 1:
            screen = abs(z[0]) >= 2.0 and dcv < 0
        else:
            from math import erf
            # chi-square(k) tail by Wilson-Hilferty
            wh = ((lr / k) ** (1 / 3) - (1 - 2 / (9 * k))) / math.sqrt(2 / (9 * k)) if lr > 0 else -9
            p_lr = 0.5 * math.erfc(wh / math.sqrt(2))
            screen = p_lr < 0.05 and dcv < 0
        hi = float(np.percentile(bd, 97.5))
        verdict = ("survives" if screen and hi < 0 else
                   "supported" if screen and d.mean() < 0 else
                   "fails held-out" if screen else "not screened in")
        nz = float(np.mean(np.any(np.column_stack(add) != 0, axis=1)))
        out["candidates"][name] = {
            "kind": kind, "k": k, "ridge": la, "coef": [float(v) for v in bz], "z_tune": [float(v) for v in z],
            "lr_tune": float(lr), "cv_dll": dcv, "test_dll": float(d.mean()),
            "test_dll_ci": [float(np.percentile(bd, 2.5)), hi], "z_test_only": [float(v) for v in zt],
            "share_nonzero": nz, "screen": bool(screen), "verdict": verdict}
    return out, Xb, pen_b


def fit_archetypes(rows, mu, sd, k_final=8, k_grid=range(4, 13), seed=SEED, min_minutes=25.0):
    """k-means on the weighted style z-vector of 2019-2023 snapshots (latest snapshot per fighter and year
    with at least `min_minutes` decayed minutes, so shrinkage does not pile everyone at the centre)."""
    Wt = dim_weights()
    seen = {}
    for r in rows:
        if r["date"] >= TEST_FROM:
            continue
        for t in "AB":
            f = r[t]
            if f["mins"] < min_minutes:
                continue
            seen[(r["slug" + t], r["date"][:4])] = (r["date"], r["name" + t], f)
    keys_ = sorted(seen)
    Z = np.array([[(seen[k][2][d] - mu[d]) / sd[d] for d in STYLE_DIMS] for k in keys_]) * Wt
    rng = np.random.default_rng(seed)
    table = []
    for k in k_grid:
        inert, c, lab = kmeans(Z, k, seed=seed, n_init=10)
        aris = []
        for b in range(10):
            idx = rng.choice(len(Z), len(Z))
            _, cb, _ = kmeans(Z[idx], k, seed=seed + b + 1, n_init=4)
            aris.append(ari(lab, ((Z[:, None, :] - cb[None]) ** 2).sum(-1).argmin(1)))
        table.append({"k": k, "inertia": inert, "silhouette": silhouette(Z, lab), "boot_ari_mean": float(np.mean(aris)),
                      "boot_ari_min": float(np.min(aris)), "sizes": np.bincount(lab).tolist()})
    inert, cent, lab = kmeans(Z, k_final, seed=seed, n_init=30)
    # order clusters by grappling then output for a stable presentation
    cz = cent / Wt
    order = np.argsort(-(cz[:, STYLE_DIMS.index("td_int")] + cz[:, STYLE_DIMS.index("ctrl")]))
    cent, cz = cent[order], cz[order]
    remap = {int(o): i for i, o in enumerate(order)}
    lab = np.array([remap[int(l)] for l in lab])
    # soft membership: isotropic Gaussian around each centroid, variance = mean within-cluster variance
    temp = float(2.0 * np.mean(((Z - cent[lab]) ** 2).sum(1)) / Z.shape[1])
    names, used = [], Counter()
    for j in range(k_final):
        nm = name_cluster(dict(zip(STYLE_DIMS, cz[j])))
        used[nm] += 1
        names.append(nm if used[nm] == 1 else nm + " (%d)" % used[nm])
    examples = []
    for j in range(k_final):
        ex = [(seen[keys_[i]][2]["mins"], seen[keys_[i]][1]) for i in np.where(lab == j)[0]]
        ex = [n for _, n in sorted(ex, reverse=True)]
        uniq = []
        for n in ex:
            if n not in uniq:
                uniq.append(n)
        examples.append(uniq[:10])
    return {"k": k_final, "weights": Wt.tolist(), "centroids_z": cz.tolist(), "centroids_w": cent.tolist(),
            "temp": temp, "names": names, "examples": examples, "sizes": np.bincount(lab).tolist(),
            "n_fit": len(Z), "selection": table, "min_minutes": min_minutes}


def memberships(rows, mu, sd, arch):
    Wt = np.array(arch["weights"])
    cent = np.array(arch["centroids_w"])
    out = []
    for t in "AB":
        Z = np.array([[(r[t][d] - mu[d]) / sd[d] for d in STYLE_DIMS] for r in rows]) * Wt
        out.append(soft_membership(Z, cent, arch["temp"]))
    return out


# --------------------------------------------------------------------------------------------- transmission
# judging weights per landed / event from the EM round-winner fit (docs/BACKLOG.md, baserates.json)
JW = {"h": 0.179, "b": 0.133, "l": 0.105, "kd": 2.42, "td": 0.286, "ctrl_min": 0.46, "sub": 0.85}


def predict_rates(D, terms_extra, n_rows):
    """Fit every rate model on 2019-2023 sides with its base terms plus `terms_extra[model]` and return the
    per-minute expected stats of each side (X) as arrays indexed by D row; used to build an expected
    scorecard (a minimal mechanistic stand-in for the engine)."""
    specs = rate_specs(D)
    tune = D.tune.to_numpy()
    eta = {}
    for name, m in specs.items():
        y = D[m["y"]].to_numpy(float)
        n = D[m["n"]].to_numpy(float) if m.get("n") else None
        off = m["off"](D) if callable(m["off"]) else (np.zeros(len(D)) if m["off"] is None else m["off"])
        off = np.asarray(off, float)
        ok = np.isfinite(off) & np.isfinite(y)
        if n is not None:
            ok &= n > 0
        tr = tune & ok
        terms = list(m["base"]) + list(terms_extra.get(name, []))
        cols = [np.ones(len(D))]
        for c in terms:
            x = _col(D, c)
            cols.append(x / (x[tr].std() or 1.0))
        X = np.column_stack(cols)
        b, _, _ = fit_glm(X[tr], y[tr], m["fam"], off[tr], None if n is None else n[tr])
        eta[name] = X @ b
    return eta


def expected_scorecard(D, eta, rows):
    """per-minute expected impact of each side from the predicted rates (no actual fight stats used)"""
    fi = D.fi.to_numpy()
    side = D.side.to_numpy()
    acc_c = np.array([rows[i]["prior"]["acc_c"] for i in fi])
    acc_g = np.array([rows[i]["prior"]["acc_g"] for i in fi])
    acc_h = np.array([rows[i]["prior"]["acc_h"] for i in fi])
    acc_b = np.array([rows[i]["prior"]["acc_b"] for i in fi])
    acc_l = np.array([rows[i]["prior"]["acc_l"] for i in fi])
    ctrl = np.exp(eta["ctrl"])                                  # control seconds per minute
    # opponent's control: the other row of the same fight
    key = {(f, s_): j for j, (f, s_) in enumerate(zip(fi, side))}
    opp = np.array([key[(f, "B" if s_ == "A" else "A")] for f, s_ in zip(fi, side)])
    st_frac = np.clip(1.0 - (ctrl + ctrl[opp]) / 60.0, 0.2, 1.0)
    d_att = np.exp(eta["dist_att"]) * st_frac
    acc = sigmoid(eta["dist_acc"] + logit(D.p_acc_d.to_numpy()))
    c_lnd = np.exp(eta["clinch_att"]) * acc_c
    g_lnd = np.exp(eta["gnp_att"]) * (ctrl / 60.0 + 0.025) * acc_g
    sig = d_att * acc + c_lnd + g_lnd
    ls, bs = sigmoid(eta["leg_share"]), sigmoid(eta["body_share"])
    hs = np.clip(1.0 - ls - bs, 0.2, 1.0)
    w = np.column_stack([hs * acc_h, bs * acc_b, ls * acc_l])
    w = w / w.sum(1, keepdims=True)
    h, b, l = sig * w[:, 0], sig * w[:, 1], sig * w[:, 2]
    # eta excludes every offset (exposures are actual-fight quantities): rebuild expectations from
    # predicted exposures only. KD per landed head strike = prior rate x exp(eta).
    kd = np.exp(eta["kd"]) * D.p_kd.to_numpy() * h
    td = np.exp(eta["td_att"]) * st_frac * sigmoid(eta["td_acc"] + logit(D.p_td_acc.to_numpy()))
    sub = np.exp(eta["sub_att"])
    imp = (JW["h"] * h + JW["b"] * b + JW["l"] * l + JW["kd"] * kd + JW["td"] * td
           + JW["ctrl_min"] * ctrl / 60.0 + JW["sub"] * sub)
    return imp, {"h": h, "b": b, "l": l, "kd": kd, "td": td, "ctrl": ctrl, "sub": sub, "st_frac": st_frac}


def transmission_test(D, rows, W, Xb, pen_b, variants, n_boot=2000, seed=SEED):
    """Does a set of rate modifiers, applied mechanistically, improve held-out winner prediction?
    Each variant's expected-scorecard differential (A minus B) is added to the winner baseline."""
    fi = D.fi.to_numpy()
    side = D.side.to_numpy()
    idx = {(f, s_): j for j, (f, s_) in enumerate(zip(fi, side))}
    y, yr, tune, test = W.y, W.yr, W.tune, W.test
    rng = np.random.default_rng(seed)
    nT = int(test.sum())
    boots = rng.integers(0, nT, (n_boot, nT))
    feats, detail = {}, {}
    for vname, extra in variants.items():
        eta = predict_rates(D, extra, len(rows))
        imp, parts = expected_scorecard(D, eta, rows)
        dA = np.array([imp[idx[(i, "A")]] - imp[idx[(i, "B")]] for i in W.keep]) * 15.0
        feats[vname] = dA
        detail[vname] = parts
    out = {"variants": {}, "note": "impact = expected judging impact per 15 minutes (EM round-winner weights) "
                                   "from predicted rates only; added to the winner baseline as one feature"}
    ref = None
    for vname, f in feats.items():
        fs = f / f[tune].std()
        # alone with Elo, and on top of the full baseline
        res = {}
        for label, Xr, pr in (("elo_plus_impact", Xb[:, :1], np.array([1.0])), ("baseline_plus_impact", Xb, pen_b)):
            X = np.column_stack([Xr, fs])
            b, cov = fit_logit(X[tune], y[tune], 1.0, pen=np.append(pr, 1.0))
            p = sigmoid(X[test] @ b)
            res[label] = {"test": metrics(p, y[test]), "coef": float(b[-1]),
                          "z": float(b[-1] / math.sqrt(cov[-1, -1])), "_ll": logloss_vec(p, y[test]),
                          "_p": p}
        out["variants"][vname] = res
    base_name = list(feats)[0]
    for vname in list(feats)[1:]:
        for label in ("elo_plus_impact", "baseline_plus_impact"):
            d = out["variants"][vname][label]["_ll"] - out["variants"][base_name][label]["_ll"]
            bd = d[boots].mean(1)
            dp = np.abs(out["variants"][vname][label]["_p"] - out["variants"][base_name][label]["_p"])
            out["variants"][vname][label]["vs_" + base_name] = {
                "test_dll": float(d.mean()), "ci": [float(np.percentile(bd, 2.5)), float(np.percentile(bd, 97.5))],
                "median_abs_dp": float(np.median(dp)), "p90_abs_dp": float(np.percentile(dp, 90)),
                "max_abs_dp": float(dp.max())}
    for v in out["variants"].values():
        for lab in v.values():
            lab.pop("_ll", None)
            lab.pop("_p", None)
    # how much the modifiers move the expected stats (median absolute relative change, test fights)
    shifts = {}
    for vname in list(feats)[1:]:
        shifts[vname] = {k: float(np.median(np.abs(detail[vname][k] / np.maximum(detail[base_name][k], 1e-9) - 1)))
                         for k in ("h", "b", "l", "kd", "td", "ctrl")}
    out["median_abs_rel_shift"] = shifts
    return out


# --------------------------------------------------------------------------------------------- engine sets
RELATIVE_TERMS = {"open", "x_sp_vs_orth", "x_orth_vs_sp", "reach_d", "height_d", "age_d", "y_sw", "kick_y"}


def is_matchup(term):
    """a matchup term involves the opponent's style or the pair's relative physicals / stances; terms built
    only from the attacker's own style are decomposition corrections, not matchups"""
    return "zy_" in term or term in RELATIVE_TERMS


def _spec_data(D, m):
    y = D[m["y"]].to_numpy(float)
    n = D[m["n"]].to_numpy(float) if m.get("n") else None
    off = m["off"](D) if callable(m["off"]) else (np.zeros(len(D)) if m["off"] is None else m["off"])
    off = np.asarray(off, float)
    ok = np.isfinite(off) & np.isfinite(y)
    if n is not None:
        ok &= n > 0
    return y, n, off, ok


def _term_from_name(t):
    return tuple(t.split("*")) if "*" in t else t


def recommend_sets(D, rate_res):
    """Per rate model: start from held-out survivors, then add held-out-supported matchup terms in order of
    tune z, keeping each only if it lowers the 2019-2023 leave-one-year-out CV deviance given the terms
    already in (this resolves collinear pairs such as reach vs height on tune data alone)."""
    specs = rate_specs(D)
    tune = D.tune.to_numpy()
    yr = D.date.str[:4].astype(int).to_numpy()
    sets = {}
    for name, res in rate_res.items():
        m = specs[name]
        y, n, off, ok = _spec_data(D, m)
        tr = tune & ok
        nn = lambda mask: None if n is None else n[mask]
        cands = [c for c in res["candidates"] if c["verdict"] in ("survives", "supported") and is_matchup(c["term"])]
        cands.sort(key=lambda c: (c["verdict"] != "survives", -abs(c["z_tune"])))

        def cvdev(terms):
            cols = [np.ones(len(D))] + [_col(D, c) for c in m["base"]]
            for t in terms:
                x = _col(D, _term_from_name(t))
                cols.append(x / (x[tr].std() or 1.0))
            X = np.column_stack(cols)
            tot = 0.0
            for Y in range(2019, 2024):
                a, v = tr & (yr != Y), tr & (yr == Y)
                b, _, _ = fit_glm(X[a], y[a], m["fam"], off[a], nn(a))
                tot += glm_dev(X[v], b, y[v], m["fam"], off[v], nn(v)).sum()
            return tot
        chosen, tier, cur = [], {}, cvdev([])
        for c in cands:
            if c["verdict"] == "survives":
                chosen.append(c["term"])
                tier[c["term"]] = 1
                cur = cvdev(chosen)
                continue
            d = cvdev(chosen + [c["term"]])
            if d < cur:
                chosen.append(c["term"])
                tier[c["term"]] = 2
                cur = d
        if chosen:
            sets[name] = {"terms": chosen, "tier": tier}
    return sets


def joint_rate_eval(D, sets, sd_feat, n_boot=1000, seed=SEED):
    """joint fit of each model's recommended terms on 2019-2023; held-out deviance change vs the base"""
    specs = rate_specs(D)
    tune = D.tune.to_numpy()
    fi = D.fi.to_numpy()
    rng = np.random.default_rng(seed)
    out = {}
    for name, st in sets.items():
        m = specs[name]
        y, n, off, ok = _spec_data(D, m)
        tr, te = tune & ok, (~tune) & ok
        nn = lambda mask: None if n is None else n[mask]
        base_cols = [np.ones(len(D))] + [_col(D, c) for c in m["base"]]
        Xb = np.column_stack(base_cols)
        b0, _, _ = fit_glm(Xb[tr], y[tr], m["fam"], off[tr], nn(tr))
        dev0 = glm_dev(Xb[te], b0, y[te], m["fam"], off[te], nn(te))
        cols, scales = list(base_cols), []
        for t in st["terms"]:
            x = _col(D, _term_from_name(t))
            s = x[tr].std() or 1.0
            scales.append(s)
            cols.append(x / s)
        X = np.column_stack(cols)
        b, cov, disp = fit_glm(X[tr], y[tr], m["fam"], off[tr], nn(tr))
        dev = glm_dev(X[te], b, y[te], m["fam"], off[te], nn(te))
        dd = dev - dev0
        ufi = np.unique(fi[te])
        per_f = np.bincount(np.searchsorted(ufi, fi[te]), weights=dd, minlength=len(ufi))
        bs = np.array([per_f[rng.integers(0, len(ufi), len(ufi))].sum() for _ in range(n_boot)])
        kb = len(m["base"]) + 1
        terms = []
        for j, t in enumerate(st["terms"]):
            coef_sd = float(b[kb + j])
            terms.append({"term": t, "tier": st["tier"][t], "coef_per_term_sd": coef_sd,
                          "term_sd": float(scales[j]), "coef_per_unit": coef_sd / scales[j],
                          "z_tune": float(b[kb + j] / math.sqrt(cov[kb + j, kb + j] * disp)),
                          "mult_at_plus1sd": float(math.exp(coef_sd))})
        shift = X[:, kb:] @ b[kb:]                     # the modifier part of the linear predictor
        q = np.percentile(shift[~tune], [5, 25, 50, 75, 95])
        out[name] = {"desc": m["desc"], "family": m["fam"], "base_terms": [cname(c) for c in m["base"]],
                     "base_coef_joint": [float(v) for v in b[:kb]], "terms": terms,
                     "shift_pct_2024": {"p5": float(q[0]), "p25": float(q[1]), "p50": float(q[2]), "p75": float(q[3]),
                                        "p95": float(q[4]), "abs_median": float(np.median(np.abs(shift[~tune])))},
                     "test_dev_change": float(dd.sum()), "test_dev_change_pct": float(dd.sum() / dev0.sum() * 100),
                     "test_dev_ci": [float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5))]}
    return out


# --------------------------------------------------------------------------------------------- mismatch subset
def mismatch_eval(W, preds, arch_memb=None, q=2 / 3.0):
    """held-out log loss on style-mismatch fights: style distance between the two weighted style vectors
    above the 2019-2023 two-thirds quantile (threshold fixed on tune fights)"""
    Wt = dim_weights()
    zA = np.column_stack([W.Z[d][0] for d in STYLE_DIMS]) * Wt
    zB = np.column_stack([W.Z[d][1] for d in STYLE_DIMS]) * Wt
    dist = np.sqrt(((zA - zB) ** 2).sum(1))
    thr = float(np.quantile(dist[W.tune], q))
    mm = W.test & (dist > thr)
    out = {"threshold": thr, "n_test_mismatch": int(mm.sum()), "n_test": int(W.test.sum()), "models": {}}
    sub = mm[W.test]
    for k, p in preds.items():
        out["models"][k] = {"mismatch": metrics(p[sub], W.y[mm]), "other": metrics(p[~sub], W.y[W.test & ~mm])}
    if arch_memb is not None:
        mA, mB = arch_memb
        la, lb = mA.argmax(1), mB.argmax(1)
        diff = W.test & (la != lb) & (mA.max(1) > 0.5) & (mB.max(1) > 0.5)
        out["n_test_diff_archetype_confident"] = int(diff.sum())
        sub2 = diff[W.test]
        for k, p in preds.items():
            out["models"][k]["diff_archetype"] = metrics(p[sub2], W.y[diff])
    return out


# --------------------------------------------------------------------------------------------- live roster
def live_features(fj):
    """style/skill features for every roster fighter as of the snapshot (live priors: for display and for
    the engine's live matchups only; never for backtests)"""
    keys = fj["meta"]["keys"]
    ex = Side(keys)
    snap = dt.date.fromisoformat(fj["meta"]["snapshot"])
    out = {}
    for slug, p in fj["fighters"].items():
        div = p.get("division")
        P = fj["priors"].get(div) or fj["priors"]["ALL"]
        if P.get("fallback"):
            P = fj["priors"].get(P["fallback"], fj["priors"]["ALL"])
        age = None
        if p.get("dob"):
            age = (snap - dt.date.fromisoformat(p["dob"])).days / 365.25
        meta = {"n": p.get("n_fights"), "age": age, "reach_in": p.get("reach_in"), "height_in": p.get("height_in"),
                "stance": p.get("stance"), "elo": p.get("elo"), "ko_losses": p.get("ko_losses"),
                "pace": p.get("pace"), "pace_w": p.get("pace_w")}
        try:
            out[slug] = (p, ex.features(p["S"], P, meta))
        except (ZeroDivisionError, ValueError, TypeError):
            continue
    return out


# --------------------------------------------------------------------------------------------- scouting
TAG_FEATURES = {      # scouting tag -> (data feature, expected sign)
    "pressure": ("press", +1), "counter": ("press", -1), "volume": ("vol", +1), "power": ("kd_pow", +1),
    "leg-kicks": ("sh_l", +1), "calf-kicks": ("sh_l", +1), "body-work": ("sh_b", +1), "clinch": ("sh_c", +1),
    "top-control": ("ctrl", +1), "ground-and-pound": ("g_rate", +1), "submissions": ("sub_int", +1),
    "back-takes": ("sub_int", +1), "chain-wrestling": ("td_int", +1), "cage-wrestling": ("td_int", +1),
    "takedown-defense": ("td_def", +1), "rangy": ("reach_rel", +1), "chin-concern": ("chin", +1),
    "durable": ("chin", -1), "head-movement": ("dfn", +1), "cardio": ("late", +1), "late-surge": ("late", +1),
    "fades-late": ("late", -1), "elbows": ("sh_c", +1), "knees": ("sh_c", +1), "jab": ("sh_h", +1),
}


def auc(pos, neg):
    pos, neg = np.asarray(pos, float), np.asarray(neg, float)
    if len(pos) == 0 or len(neg) == 0:
        return None
    allv = np.concatenate([pos, neg])
    ranks = np.argsort(np.argsort(allv)) + 1.0
    # average ties
    order = np.argsort(allv)
    sv = allv[order]
    i = 0
    while i < len(sv):
        j = i
        while j + 1 < len(sv) and sv[j + 1] == sv[i]:
            j += 1
        if j > i:
            ranks[order[i:j + 1]] = (i + j) / 2.0 + 1.0
        i = j + 1
    rp = ranks[:len(pos)].sum()
    return float((rp - len(pos) * (len(pos) + 1) / 2.0) / (len(pos) * len(neg)))


SCOUT_TO_ARCH = {   # scouting archetype -> broad family for the cross-tab
    "wrestler": "grappling", "chain wrestler (sambo/dagestani)": "grappling", "grappler/BJJ": "grappling",
    "wrestle-boxer": "grappling", "pressure striker": "pressure", "volume striker": "volume",
    "power puncher": "power", "counter striker": "counter", "kickboxer": "kicking", "muay thai": "kicking",
    "karate/point fighter": "kicking", "boxer": "boxing", "all-rounder": "all-round"}


def scouting_validation(live, mu, sd, arch):
    files = sorted(glob.glob(os.path.join(ROOT, "data", "scouting", "*.json")))
    recs = []
    reach_res = None
    # reach relative to height (ape index) among roster fighters, for the "rangy" tag
    ape = [f["reach"] - f["height"] for _, f in live.values() if f["reach"] and f["height"]]
    ape_mu, ape_sd = float(np.mean(ape)), float(np.std(ape))
    Wt = np.array(arch["weights"])
    cent = np.array(arch["centroids_w"])
    for fp in files:
        with open(fp) as fh:
            sc = json.load(fh)
        slug = sc.get("slug")
        if slug not in live:
            continue
        p, f = live[slug]
        z = {k: (f[k] - mu[k]) / sd[k] for k in mu if f.get(k) is not None}
        z["reach_rel"] = ((f["reach"] - f["height"]) - ape_mu) / ape_sd if f["reach"] and f["height"] else 0.0
        zw = np.array([z[d] for d in STYLE_DIMS]) * Wt
        memb = soft_membership(zw[None], cent, arch["temp"])[0]
        st = sc.get("style", {})
        recs.append({"slug": slug, "name": sc.get("name"), "archetype": st.get("archetype"),
                     "stance": st.get("stance"), "tags": set(st.get("tags", [])), "z": z, "memb": memb,
                     "data_stance": (p.get("stance") or "").lower(), "mins": f["mins"]})
    tags = {}
    for tag, (feat, sign) in TAG_FEATURES.items():
        pos = [sign * r["z"][feat] for r in recs if tag in r["tags"]]
        neg = [sign * r["z"][feat] for r in recs if tag not in r["tags"]]
        if len(pos) >= 3:
            tags[tag] = {"feature": feat, "sign": sign, "n_tagged": len(pos), "auc": auc(pos, neg)}
    # which data features best separate each tag (descriptive: what the scouts' word means in the data)
    alltags = Counter(t for r in recs for t in r["tags"])
    best = {}
    for tag, n_t in alltags.items():
        if n_t < 4:
            continue
        sc_ = []
        for feat in list(mu) + ["reach_rel"]:
            if feat in ("mins", "n", "elo", "southpaw", "switch", "orthodox", "ko_losses"):
                continue
            pos = [r["z"].get(feat, 0.0) for r in recs if tag in r["tags"]]
            neg = [r["z"].get(feat, 0.0) for r in recs if tag not in r["tags"]]
            a = auc(pos, neg)
            if a is not None:
                sc_.append((abs(a - 0.5), feat, a))
        sc_.sort(reverse=True)
        best[tag] = {"n": n_t, "top": [{"feature": f, "auc": a} for _, f, a in sc_[:3]]}
    # archetype cross-tab: data archetype (max membership) vs scouting family
    ct = defaultdict(Counter)
    for r in recs:
        ct[SCOUT_TO_ARCH.get(r["archetype"], r["archetype"])][arch["names"][int(np.argmax(r["memb"]))]] += 1
    stance_agree = Counter((r["stance"], r["data_stance"]) for r in recs)
    return {"n_fighters": len(recs), "tag_auc": tags, "tag_best_features": best,
            "crosstab": {k: dict(v) for k, v in ct.items()},
            "stance_pairs": {"%s|%s" % k: v for k, v in stance_agree.items()},
            "fighters": [{"slug": r["slug"], "scouting_archetype": r["archetype"],
                          "data_archetype": arch["names"][int(np.argmax(r["memb"]))],
                          "membership": round(float(np.max(r["memb"])), 3)} for r in recs]}


# --------------------------------------------------------------------------------------------- engine helper
def term_value(term, fx, fy, mu, sd):
    """value of a modifier term for attacker X (features fx) against defender Y (fy), in the units the
    coefficients `coef_per_unit` use"""
    def z(f, k):
        v = f.get(k)
        return 0.0 if v is None else (v - mu[k]) / sd[k]
    if "*" in term:
        a, b = term.split("*")
        return term_value(a, fx, fy, mu, sd) * term_value(b, fx, fy, mu, sd)
    if term.startswith("zx_"):
        return z(fx, term[3:])
    if term.startswith("zy_"):
        return z(fy, term[3:])
    if term == "kick_y":
        return (z(fy, "sh_l") + z(fy, "sh_b")) / math.sqrt(2)
    if term == "kick_x":
        return (z(fx, "sh_l") + z(fx, "sh_b")) / math.sqrt(2)
    if term in ("reach_d", "height_d", "age_d"):
        k = term[:-2]
        if fx.get(k) is None or fy.get(k) is None:
            return 0.0
        return (fx[k] - fy[k]) / sd[k]
    sx = "southpaw" if fx.get("southpaw") else "switch" if fx.get("switch") else "orthodox" if fx.get("orthodox") else ""
    sy = "southpaw" if fy.get("southpaw") else "switch" if fy.get("switch") else "orthodox" if fy.get("orthodox") else ""
    if term == "open":
        return float({sx, sy} == {"southpaw", "orthodox"})
    if term == "x_orth_vs_sp":
        return float(sx == "orthodox" and sy == "southpaw")
    if term == "x_sp_vs_orth":
        return float(sx == "southpaw" and sy == "orthodox")
    if term == "y_sw":
        return float(sy == "switch")
    raise KeyError(term)


def matchup_modifiers(fx, fy, mu, sd, joint):
    """per-rate modifiers for X attacking Y: multipliers for Poisson rates, log-odds shifts for shares"""
    out = {}
    for name, j in joint.items():
        s = sum(t["coef_per_unit"] * term_value(t["term"], fx, fy, mu, sd) for t in j["terms"])
        out[name] = {"log_shift": s, "mult": math.exp(s)} if j["family"] == "poisson" else {"logit_shift": s}
    return out


# --------------------------------------------------------------------------------------------- main
def rnd(x, d=4):
    if isinstance(x, float):
        return float(("%." + str(d) + "g") % x) if x != 0 else 0.0
    if isinstance(x, dict):
        return {k: rnd(v, d) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [rnd(v, d) for v in x]
    if isinstance(x, (np.floating,)):
        return rnd(float(x), d)
    if isinstance(x, (np.integer,)):
        return int(x)
    if isinstance(x, np.ndarray):
        return rnd(x.tolist(), d)
    return x


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--boot", type=int, default=2000, help="bootstrap replicates for held-out CIs (2000)")
    ap.add_argument("--k", type=int, default=8, help="number of archetypes (8)")
    ap.add_argument("--no-report", action="store_true")
    args = ap.parse_args()
    t0 = dt.datetime.now()
    print("loading backtest and per-fight vectors ...")
    bt = load_backtest()
    vec, keys = per_fight_vectors()
    rows = build_table(bt, vec)
    feats = sorted(rows[0]["A"].keys())
    tune_mask = np.array([r["date"] < TEST_FROM for r in rows])
    mu, sd = zconsts(rows, feats, tune_mask)
    print("fights %d (tune %d, test %d)" % (len(rows), tune_mask.sum(), (~tune_mask).sum()))

    print("archetypes ...")
    arch = fit_archetypes(rows, mu, sd, k_final=args.k)
    memb = memberships(rows, mu, sd, arch)

    print("winner-level interaction tests ...")
    W = WinData(rows, mu, sd, memb)
    win, Xb, pen_b = winner_tests(W, n_boot=args.boot)
    win_elo, _, _ = winner_tests(W, n_boot=args.boot, base_terms=["elo"])
    # every tune-screened winner-level term at once (the honest "add what looked good" model)
    cands = winner_candidates(W)
    screened = [k for k, c in win["candidates"].items() if c["screen"]]
    comb = {"terms": screened}
    if screened:
        add = []
        for k in screened:
            add += [c / (c[W.tune].std() or 1.0) for c in cands[k][1]]
        X = np.column_stack([Xb] + add)
        pen = np.concatenate([pen_b, np.full(len(add), 1.0)])
        b, _ = fit_logit(X[W.tune], W.y[W.tune], 1.0, pen=pen)
        p_comb = sigmoid(X[W.test] @ b)
        comb["test"] = metrics(p_comb, W.y[W.test])
    b0, _ = fit_logit(Xb[W.tune], W.y[W.tune], 1.0, pen=pen_b)
    p_base = sigmoid(Xb[W.test] @ b0)
    be, _ = fit_logit(Xb[W.tune][:, :1], W.y[W.tune], 1.0, pen=np.array([1.0]))
    p_elo = sigmoid(Xb[W.test][:, :1] @ be)

    print("rate-level tests ...")
    D = build_sides(rows, keys, mu, sd)
    rates = rate_tests(D, n_boot=args.boot)
    sets = recommend_sets(D, rates)
    tier1 = {k: {"terms": [t for t in v["terms"] if v["tier"][t] == 1],
                 "tier": {t: 1 for t in v["terms"] if v["tier"][t] == 1}} for k, v in sets.items()}
    tier1 = {k: v for k, v in tier1.items() if v["terms"]}
    joint_all = joint_rate_eval(D, sets, sd, n_boot=args.boot)
    # a rate block is on by default only if its joint held-out deviance CI excludes zero
    joint = {k: v for k, v in joint_all.items() if v["test_dev_ci"][1] < 0}
    optional = {k: v for k, v in joint_all.items() if k not in joint}
    joint1 = joint_rate_eval(D, tier1, sd, n_boot=args.boot)
    # the clean variant: every matchup term that passed the tune-only screen, no held-out confirmation
    screened_sets = {}
    for k, v in rates.items():
        ts = [c["term"] for c in v["candidates"] if c["screen"] and is_matchup(c["term"])]
        if ts:
            screened_sets[k] = {"terms": ts, "tier": {t: 0 for t in ts}}
    joint_scr = joint_rate_eval(D, screened_sets, sd, n_boot=args.boot)

    print("transmission test ...")
    tt = lambda dd: {k: [_term_from_name(t) for t in v["terms"]] for k, v in dd.items()}
    variants = {"none": {}, "tune_screened": tt(screened_sets), "tier1": tt(tier1),
                "default_on": {k: [_term_from_name(t) for t in sets[k]["terms"]] for k in joint},
                "all_recommended": tt(sets)}
    trans = transmission_test(D, rows, W, Xb, pen_b, variants, n_boot=args.boot)
    # predictions for the mismatch table
    preds = {"elo": p_elo, "skill_baseline": p_base}
    if screened:
        preds["skill_baseline+screened_interactions"] = p_comb
    fi = D.fi.to_numpy()
    side = D.side.to_numpy()
    idx = {(f, s_): j for j, (f, s_) in enumerate(zip(fi, side))}
    for vname, extra in variants.items():
        eta = predict_rates(D, extra, len(rows))
        imp, _ = expected_scorecard(D, eta, rows)
        dA = np.array([imp[idx[(i, "A")]] - imp[idx[(i, "B")]] for i in W.keep]) * 15.0
        fs = dA / dA[W.tune].std()
        X = np.column_stack([Xb[:, :1], fs])
        b, _ = fit_logit(X[W.tune], W.y[W.tune], 1.0, pen=np.array([1.0, 1.0]))
        preds["elo+scorecard(%s)" % vname] = sigmoid(X[W.test] @ b)
    mism = mismatch_eval(W, preds, arch_memb=W.M)

    print("live roster and scouting ...")
    fj = json.load(open(os.path.join(DER, "fighters.json")))
    live = live_features(fj)
    scout = scouting_validation(live, mu, sd, arch)
    Wt = np.array(arch["weights"])
    cent = np.array(arch["centroids_w"])
    roster = {}
    keep_feats = STYLE_DIMS + ["td_def", "td_acc", "octrl", "octrl_td", "osh_l", "chin", "g_rate", "sub_int",
                               "d_rate", "od_rate", "td_rate", "otd_rate"]
    keep_feats = list(dict.fromkeys(keep_feats))
    for slug, (p, f) in live.items():
        zw = np.array([(f[d] - mu[d]) / sd[d] for d in STYLE_DIMS]) * Wt
        m_ = soft_membership(zw[None], cent, arch["temp"])[0]
        roster[slug] = {"archetype": arch["names"][int(np.argmax(m_))], "membership": rnd(m_.tolist(), 3),
                        "z": {k: rnd((f[k] - mu[k]) / sd[k], 3) for k in keep_feats},
                        "kick": rnd(((f["sh_l"] - mu["sh_l"]) / sd["sh_l"] + (f["sh_b"] - mu["sh_b"]) / sd["sh_b"])
                                    / math.sqrt(2), 3),
                        "stance": p.get("stance"), "mins_decayed": rnd(f["mins"], 3)}
    examples = {}
    pairs = [("alexander-volkanovski", "justin-gaethje"), ("islam-makhachev", "alexander-volkanovski"),
             ("alex-pereira", "magomed-ankalaev"), ("merab-dvalishvili", "sean-o-malley"),
             ("khamzat-chimaev", "dricus-du-plessis"), ("ilia-topuria", "max-holloway")]
    for a, b in pairs:
        if a in live and b in live:
            fa, fb = live[a][1], live[b][1]
            examples["%s vs %s" % (a, b)] = {
                "archetypes": [roster[a]["archetype"], roster[b]["archetype"]],
                a: rnd(matchup_modifiers(fa, fb, mu, sd, joint_all), 3),
                b: rnd(matchup_modifiers(fb, fa, mu, sd, joint_all), 3)}
    J = {
        "meta": {"built": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
                 "snapshot": bt["meta"]["snapshot"], "tune": list(TUNE), "test_from": TEST_FROM,
                 "n_fights": len(rows), "n_decisive": int(len(W.y)), "n_test_decisive": int(W.test.sum()),
                 "shrinkage": {"K_MIN": K_MIN, "K_ATT": K_ATT, "K_TD": K_TD, "K_HEAD": K_HEAD, "K_CTRLTD": K_CTRLTD},
                 "style_dims": STYLE_DIMS, "main_dims": BASE_WIN, "bootstrap": args.boot,
                 "notes": "features are log rate ratios or log-odds differences vs the division prior of the fight "
                          "year (backtest: priors_asof; live roster: fighters.json priors); z = (feature - mu) / sd "
                          "with mu, sd from 2019-2023 backtest sides. Winner models are antisymmetric with no "
                          "intercept. Rate models: one row per fight side, X attacking Y."},
        "zscore": {"mu": rnd(mu, 6), "sd": rnd(sd, 6)},
        "archetypes": rnd(arch, 4),
        "winner_level": {"skill_baseline": rnd(win["baseline"]), "elo_only": rnd(win["elo_only"]),
                         "candidates": rnd(win["candidates"]), "screened_combined": rnd(comb),
                         "on_top_of_elo_only": {"baseline": rnd(win_elo["baseline"]),
                                                "candidates": rnd(win_elo["candidates"])}},
        "rate_level": rnd(rates),
        "engine_modifiers": {"default_on": rnd(joint, 5), "optional_off": rnd(optional, 5),
                             "tier1_only": rnd(joint1, 5), "tune_screened": rnd(joint_scr, 5),
                             "selection": {k: v for k, v in sets.items()}},
        "transmission": rnd(trans),
        "mismatch": rnd(mism),
        "scouting": rnd(scout),
        "examples": examples,
        "roster": roster,
    }
    with open(OUT_JSON, "w") as fh:
        json.dump(J, fh, separators=(",", ":"))
    print("wrote %s (%.0f KB)" % (OUT_JSON, os.path.getsize(OUT_JSON) / 1024))
    if not args.no_report:
        with open(OUT_MD, "w") as fh:
            fh.write(render_report(J))
        print("wrote %s" % OUT_MD)
    print("done in %.0f s" % (dt.datetime.now() - t0).total_seconds())
    return J


def render_report(J):
    return "# placeholder\n"


if __name__ == "__main__":
    main()
