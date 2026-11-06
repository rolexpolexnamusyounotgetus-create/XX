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
