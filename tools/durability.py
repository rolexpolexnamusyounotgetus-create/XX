#!/usr/bin/env python3
"""Durability and power (engine v5 component): knockdown chin and power fit on walk-forward features.

Run from the project root (about 1-2 minutes):

    python3 tools/durability.py            # fit, evaluate, write outputs
    python3 tools/durability.py --quick    # skip the hyperparameter grid (use the stored choices)

Model (one row per attacker -> defender direction of every UFC fight with round stats):

    KD_ad ~ Poisson(E_ad * p_ad),  E_ad = standing head strikes landed by a on d (ufcstats midpoint estimate)
    log p_ad = log L(t) + div + ctx + f_chin(x_d) + f_pow(x_a) + log u_d + log v_a

    L(t)   trailing league KD per standing head strike over the 365 days before the fight (walk-forward level)
    div    division effect; ctx: five-round and title indicators
    x_d    defender features frozen before the fight: age (linear spline), years in the UFC, UFC fights,
           career sig head strikes absorbed, KO/TKO losses and knockdowns absorbed (recent vs old), layoff,
           weight move (up / down, in classes and pounds), height and reach relative to the division,
           last fight a KO loss, short turnaround after a KO loss
    x_a    attacker features: age spline, weight move, height, reach advantage, experience
    u_d    defender chin multiplier, v_a attacker power multiplier: Gamma(alpha, alpha) fighter effects whose
           posterior means are updated walk-forward: u = (alpha + KD absorbed) / (alpha + expected KD absorbed)
           over his earlier fights (expected under the rest of the model), optionally time-decayed

Fixed effects are fit with the walk-forward fighter effects as offsets, iterating fit -> walk -> fit. Hyper-
parameters (alpha, decay, windows, spline knots) are chosen by Poisson deviance on 2019-2023 with the model
fit on 2008-2018; coefficients are then refit on 2008-2023 and reported on 2024-01-01 onward (never used for
fitting or tuning). A final live fit on everything gives the roster's posterior chin and power multipliers.

A second model, KO/TKO loss per fight (logistic, pre-fight features only), uses the same feature set plus the
pre-fight expected knockdown rate and an Elo control.

Outputs: data/derived/durability.json (coefficients, held-out metrics, engine parameters, roster multipliers,
walk-forward multipliers for every backtest entry) and research/model_durability.md (written by hand from the
printed results and the JSON).
"""
import argparse
import bisect
import datetime as dt
import json
import math
import os
import sys
import time
from collections import Counter, defaultdict

import numpy as np
import pandas as pd
from scipy import special, stats as sst

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_db as B  # noqa: E402  (reuse the verified parsers, people resolution and Elo)

ROOT = B.ROOT
OUT_JSON = os.path.join(ROOT, "data", "derived", "durability.json")
KI = B.KI
LBS = B.LBS
NON_DIV = B.NON_DIV
MEN_ORDER = ["Flyweight", "Bantamweight", "Featherweight", "Lightweight", "Welterweight", "Middleweight",
             "Light Heavyweight", "Heavyweight"]
WOMEN_ORDER = ["Women's Strawweight", "Women's Flyweight", "Women's Bantamweight", "Women's Featherweight"]
CLASS_RANK = {d: i for i, d in enumerate(MEN_ORDER)}
CLASS_RANK.update({d: i for i, d in enumerate(WOMEN_ORDER)})

FIT_FROM = "2008-01-01"
TUNE_FIT = ("2008-01-01", "2018-12-31")
TUNE_EVAL = ("2019-01-01", "2023-12-31")
TEST_FROM = "2024-01-01"
ELO_K, ELO_BOOST = 44, 1.5      # data/derived/elo_report.json (tuned 2019-2023)
HL_RATE = 730.0                 # half-life for the decayed exposure rates (same as build_db S sums)


# ------------------------------------------------------------------ helpers
def stand_head(v):
    """Standing head strikes landed (ufcstats has no head x position cross-tab): midpoint of the bounds."""
    h, g = v[KI["h_lnd"]], v[KI["g_lnd"]]
    dc = v[KI["d_lnd"]] + v[KI["c_lnd"]]
    return 0.5 * (max(h - g, 0.0) + min(h, dc))


def new_state():
    return {"n": 0, "first": None, "last": None, "hist": [], "ev": [], "cum_oh": 0.0, "cum_osh": 0.0,
            "cum_min": 0.0, "cum_okd": 0.0, "cum_kd": 0.0, "cum_h": 0.0, "cum_sh": 0.0,
            "dec": np.zeros(7), "dec_t": None, "last_ko_loss_day": None, "last_res": None}


# decayed exposure sums: 0 min, 1 standing head landed, 2 standing head absorbed, 3 kd, 4 okd, 5 h_lnd, 6 oh_lnd
def decay_state(stt, day):
    if stt["dec_t"] is not None and day > stt["dec_t"]:
        stt["dec"] *= 0.5 ** ((day - stt["dec_t"]) / HL_RATE)
    stt["dec_t"] = day if stt["dec_t"] is None else max(stt["dec_t"], day)


def side_features(stt, P, f, s):
    T = P.get("tott") or {}
    dob = T.get("dob")
    day = f.day
    n = stt["n"]
    x = {"age": (f.date - dob).days / 365.25 if dob else np.nan,
         "n_prior": n,
         "yrs_ufc": (day - stt["first"]) / 365.25 if n else 0.0,
         "layoff": float(day - stt["last"]) if n else np.nan,
         "cum_oh": stt["cum_oh"], "cum_osh": stt["cum_osh"], "cum_min": stt["cum_min"],
         "cum_okd": stt["cum_okd"], "cum_kd": stt["cum_kd"], "cum_h": stt["cum_h"], "cum_sh": stt["cum_sh"],
         "height": T.get("height_in"), "reach": T.get("reach_in"), "stance": T.get("stance"),
         "last_ko_loss": 1.0 if stt["last_res"] == "ko_l" else 0.0,
         "days_since_ko_loss": float(day - stt["last_ko_loss_day"]) if stt["last_ko_loss_day"] is not None else np.nan}
    for w in (365, 730, 1095):
        kdr = kdo = kor = koo = 0.0
        for (d0, okd, kol) in stt["ev"]:
            if day - d0 <= w:
                kdr += okd
                kor += kol
            else:
                kdo += okd
                koo += kol
        x["okd_r%d" % w], x["okd_o%d" % w] = kdr, kdo
        x["kol_r%d" % w], x["kol_o%d" % w] = kor, koo
    home = B.mode_recent(stt["hist"], day) if stt["hist"] else None
    x["home"] = home
    x["home_lbs"] = LBS.get(home) if home else None
    dcopy = stt["dec"].copy()
    if stt["dec_t"] is not None and day > stt["dec_t"]:
        dcopy *= 0.5 ** ((day - stt["dec_t"]) / HL_RATE)
    for i, k in enumerate(["dmin", "dsh", "dosh", "dkd", "dokd", "dh", "doh"]):
        x[k] = dcopy[i]
    return x


def build_table(verbose=True):
    log = {}
    t0 = time.time()
    fights, _ = B.parse_fights(log)
    people = B.build_people(fights, log)
    B.build_vectors(fights, log)
    _, elo_pre, _ = B.run_elo(fights, ELO_K, ELO_BOOST, store=True)
    state = defaultdict(new_state)
    rows, frows = [], []
    for f in fights:
        a, b = f.persons
        if a == b:
            continue
        sa, sb = state[a], state[b]
        feats = [side_features(sa, people[a], f, 0), side_features(sb, people[b], f, 1)]
        elo = elo_pre.get(f.fid, (1500.0, 1500.0))
        fl = LBS.get(f.division)
        ko_loser = None
        if f.method == "KO" and f.winner in ("A", "B"):
            ko_loser = 1 if f.winner == "A" else 0
        amb = a.startswith("amb:") or b.startswith("amb:") or a.startswith("name:") or b.startswith("name:")
        base = {"fid": f.fid, "date": f.date.isoformat(), "day": f.day, "year": f.date.year,
                "division": f.division, "fight_lbs": fl, "sched": f.sched or 0, "title": int(bool(f.title)),
                "method": f.method, "winner": f.winner, "rnd": f.rnd, "fight_s": f.fight_s, "has_stats": int(bool(f.stats)),
                "amb": int(amb)}
        for att in (0, 1):
            d = 1 - att
            r = dict(base)
            r["att"], r["def"] = (a, b)[att], (a, b)[d]
            r["att_slug"], r["def_slug"] = people[r["att"]].get("slug"), people[r["def"]].get("slug")
            r["side_def"] = "AB"[d]
            if f.stats:
                va = f.stats["v"][att]
                r["y"] = va[KI["kd"]]
                r["E"] = stand_head(va)
                r["H"] = va[KI["h_lnd"]]
                r["Bl"] = va[KI["b_lnd"]]
                r["min"] = f.stats["min"]
            else:
                r["y"] = r["E"] = r["H"] = r["Bl"] = r["min"] = np.nan
            r["ko_loss"] = int(ko_loser == d)
            r["elo_a"], r["elo_d"] = elo[att], elo[d]
            for k, v in feats[d].items():
                r["d_" + k] = v
            for k, v in feats[att].items():
                r["a_" + k] = v
            rows.append(r)
        # apply the fight
        for s, p, stt in ((0, a, sa), (1, b, sb)):
            decay_state(stt, f.day)
            okd = kol = 0.0
            lost = f.winner == ("B" if s == 0 else "A")
            if f.stats:
                v, vo = f.stats["v"][s], f.stats["v"][1 - s]
                okd = v[KI["okd"]]
                stt["cum_oh"] += v[KI["oh_lnd"]]
                stt["cum_osh"] += stand_head(vo)
                stt["cum_min"] += f.stats["min"]
                stt["cum_okd"] += okd
                stt["cum_kd"] += v[KI["kd"]]
                stt["cum_h"] += v[KI["h_lnd"]]
                stt["cum_sh"] += stand_head(v)
                stt["dec"] += np.array([f.stats["min"], stand_head(v), stand_head(vo), v[KI["kd"]], okd,
                                        v[KI["h_lnd"]], v[KI["oh_lnd"]]])
            if lost and f.method == "KO":
                kol = 1.0
                stt["last_ko_loss_day"] = f.day
            stt["last_res"] = "ko_l" if kol else ("l" if lost else "o")
            stt["ev"].append((f.day, okd, kol))
            if stt["first"] is None:
                stt["first"] = f.day
            stt["last"] = f.day
            stt["n"] += 1
            stt["hist"].append((f.day, f.division))
    df = pd.DataFrame(rows)
    # snapshot state for the live roster
    snap_day = fights[-1].day
    if verbose:
        print("table: %d directed rows from %d fights in %.1fs" % (len(df), len(fights), time.time() - t0))
    return df, state, people, fights, snap_day


# ------------------------------------------------------------------ derived columns
def add_columns(df, knots=(27.0, 31.0, 35.0), win=730):
    X = df
    # weight move vs the pre-fight home division (catch / open weight bouts: unknown -> 0 with a flag)
    for p in ("d", "a"):
        home = X[p + "_home"]
        fl = X["fight_lbs"]
        hl = X[p + "_home_lbs"]
        known = fl.notna() & hl.notna()
        mv = np.where(known, fl - hl.fillna(0), 0.0)
        X[p + "_mv_lbs"] = mv
        X[p + "_up_lbs"] = np.clip(mv, 0, None)
        X[p + "_dn_lbs"] = np.clip(-mv, 0, None)
        rk_f = X["division"].map(CLASS_RANK)
        rk_h = home.map(CLASS_RANK)
        same_sex = X["division"].str.startswith("Women") == home.fillna("").str.startswith("Women")
        cls = np.where(rk_f.notna() & rk_h.notna() & same_sex, rk_f - rk_h, 0.0)
        X[p + "_mv_cls"] = cls
        X[p + "_up_cls"] = np.clip(cls, 0, None)
        X[p + "_dn_cls"] = np.clip(-cls, 0, None)
        X[p + "_up_pct"] = np.where(known, 100 * np.log(np.where(known, fl, 1) / np.where(known, hl, 1)), 0.0).clip(0, None)
        X[p + "_dn_pct"] = np.where(known, -100 * np.log(np.where(known, fl, 1) / np.where(known, hl, 1)), 0.0).clip(0, None)
        X[p + "_catch"] = (~known & (X[p + "_n_prior"] > 0)).astype(float)
        X[p + "_debut"] = (X[p + "_n_prior"] == 0).astype(float)
        age = X[p + "_age"]
        X[p + "_age_na"] = age.isna().astype(float)
        a = age.fillna(30.0)
        X[p + "_age_c"] = a - 30.0
        for k in knots:
            X[p + "_age_h%d" % int(k)] = np.clip(a - k, 0, None)
        X[p + "_yrs"] = X[p + "_yrs_ufc"]
        X[p + "_lognp"] = np.log1p(X[p + "_n_prior"])
        X[p + "_cumoh100"] = X[p + "_cum_oh"] / 100.0
        X[p + "_okd_r"] = X[p + "_okd_r%d" % win]
        X[p + "_okd_o"] = X[p + "_okd_o%d" % win]
        X[p + "_kol_r"] = X[p + "_kol_r%d" % win]
        X[p + "_kol_o"] = X[p + "_kol_o%d" % win]
        lay = X[p + "_layoff"]
        X[p + "_lay_short"] = ((lay < 120) & lay.notna()).astype(float)
        X[p + "_lay_12_24"] = ((lay >= 365) & (lay < 730)).astype(float)
        X[p + "_lay_24p"] = (lay >= 730).astype(float)
        X[p + "_ko_short"] = (X[p + "_last_ko_loss"] * ((lay < 180) & lay.notna())).astype(float)
    # height / reach relative to the fight division (means over fighters in the division, all years; static)
    hmean = pd.concat([X[["division", "d_height"]].rename(columns={"d_height": "h"})]).groupby("division").h.mean()
    rmean = pd.concat([X[["division", "d_reach"]].rename(columns={"d_reach": "r"})]).groupby("division").r.mean()
    for p in ("d", "a"):
        h = X[p + "_height"].astype(float)
        r = X[p + "_reach"].astype(float)
        X[p + "_ht_rel"] = (h - X["division"].map(hmean)).fillna(0.0)
        ape = (r - h)
        X[p + "_ape"] = ape.fillna(ape.mean() if ape.notna().any() else 0.0) - (ape.mean() if ape.notna().any() else 0.0)
        X[p + "_ape"] = X[p + "_ape"].fillna(0.0)
        X[p + "_reach_na"] = r.isna().astype(float)
    ra = X["a_reach"].astype(float).fillna(X["a_height"].astype(float) + 1.5)
    rd = X["d_reach"].astype(float).fillna(X["d_height"].astype(float) + 1.5)
    X["reach_adv"] = (ra - rd).fillna(0.0)
    X["ht_adv"] = (X["a_height"].astype(float) - X["d_height"].astype(float)).fillna(0.0)
    X["five"] = (X["sched"] == 5).astype(float)
    X["elo_diff"] = (X["elo_a"] - X["elo_d"]) / 400.0 * math.log(10)
    X["women"] = X["division"].str.startswith("Women").astype(float)
    return X


def trailing_level(df, window=365, min_kd=30):
    """League KD per standing head strike over [day - window, day) from rows with stats (walk-forward)."""
    s = df[df.has_stats == 1].groupby("day").agg(kd=("y", "sum"), E=("E", "sum")).sort_index()
    days = s.index.to_numpy()
    ckd = np.concatenate([[0.0], np.cumsum(s.kd.to_numpy())])
    cE = np.concatenate([[0.0], np.cumsum(s.E.to_numpy())])
    out = {}
    for day in np.unique(df.day.to_numpy()):
        hi = bisect.bisect_left(days, day)              # strictly before the fight day
        w = window
        while True:
            lo = bisect.bisect_left(days, day - w)
            kd, E = ckd[hi] - ckd[lo], cE[hi] - cE[lo]
            if kd >= min_kd or w > 20 * 365:
                break
            w *= 2
        out[day] = kd / E if E > 0 else np.nan
    lv = df.day.map(out)
    return lv.fillna(lv.dropna().iloc[0] if lv.notna().any() else 0.01)


# ------------------------------------------------------------------ Poisson GLM (Newton, with offsets)
def pois_fit(X, y, off, w=None, ridge=1e-6, iters=60, beta0=None):
    n, k = X.shape
    w = np.ones(n) if w is None else w
    b = np.zeros(k) if beta0 is None else beta0.copy()
    if beta0 is None:
        b[0] = math.log(max(y.sum(), 1e-9) / np.exp(off).sum())
    R = ridge * np.eye(k)
    R[0, 0] = 0.0
    for _ in range(iters):
        eta = X @ b + off
        mu = np.exp(np.clip(eta, -30, 10))
        g = X.T @ (w * (y - mu)) - R @ b
        H = X.T @ (X * (w * mu)[:, None]) + R
        step = np.linalg.solve(H, g)
        b += step
        if np.max(np.abs(step)) < 1e-8:
            break
    eta = X @ b + off
    mu = np.exp(eta)
    H = X.T @ (X * (w * mu)[:, None]) + R
    cov = np.linalg.inv(H)
    return b, cov, mu


def cluster_cov(X, y, mu, cov, groups):
    """Sandwich covariance clustered by group (fighter)."""
    sc = X * (y - mu)[:, None]
    g = pd.Series(np.arange(len(y))).groupby(groups).indices
    meat = np.zeros((X.shape[1], X.shape[1]))
    for idx in g.values():
        s = sc[idx].sum(0)
        meat += np.outer(s, s)
    G = len(g)
    adj = G / max(G - 1, 1)
    return adj * cov @ meat @ cov


def pois_dev(y, mu):
    mu = np.maximum(mu, 1e-12)
    t = np.where(y > 0, y * np.log(np.where(y > 0, y, 1) / mu), 0.0)
    return 2 * (t - (y - mu))


# ------------------------------------------------------------------ walk-forward fighter effects
def eb_walk(df, base_mu, alpha_c, alpha_p, hl_c=None, hl_p=None, use_c=True, use_p=True, final_state=False):
    """Walk the rows in fight order. base_mu = E * p without fighter effects.

    Returns chin multiplier of the defender and power multiplier of the attacker as of before each fight,
    plus their posterior shapes / rates. Both directions of a fight are predicted before either updates."""
    n = len(df)
    chin = np.ones(n)
    powm = np.ones(n)
    cshape = np.zeros(n)
    crate = np.zeros(n)
    pshape = np.zeros(n)
    prate = np.zeros(n)
    Yc, Mc, Tc = defaultdict(float), defaultdict(float), {}
    Yp, Mp, Tp = defaultdict(float), defaultdict(float), {}
    fid = df.fid.to_numpy()
    day = df.day.to_numpy()
    att = df["att"].to_numpy()
    de = df["def"].to_numpy()
    y = df.y.to_numpy()
    ok = df.has_stats.to_numpy() == 1
    lam_c = math.log(2) / hl_c if hl_c else 0.0
    lam_p = math.log(2) / hl_p if hl_p else 0.0

    def get(Y, M, T, p, d, lam):
        if lam and p in T and d > T[p]:
            f = math.exp(-lam * (d - T[p]))
            Y[p] *= f
            M[p] *= f
            T[p] = d
        elif p not in T:
            T[p] = d
        return Y[p], M[p]

    i = 0
    while i < n:
        j = i
        while j < n and fid[j] == fid[i]:
            j += 1
        for r in range(i, j):
            yc, mc = get(Yc, Mc, Tc, de[r], day[r], lam_c)
            yp, mp = get(Yp, Mp, Tp, att[r], day[r], lam_p)
            cshape[r], crate[r] = alpha_c + yc, alpha_c + mc
            pshape[r], prate[r] = alpha_p + yp, alpha_p + mp
            chin[r] = cshape[r] / crate[r] if use_c else 1.0
            powm[r] = pshape[r] / prate[r] if use_p else 1.0
        for r in range(i, j):
            if not ok[r] or not np.isfinite(base_mu[r]):
                continue
            Yc[de[r]] += y[r]
            Mc[de[r]] += base_mu[r] * powm[r]
            Yp[att[r]] += y[r]
            Mp[att[r]] += base_mu[r] * chin[r]
        i = j
    out = {"chin": chin, "pow": powm, "cshape": cshape, "crate": crate, "pshape": pshape, "prate": prate}
    if final_state:
        out["state"] = {"Yc": dict(Yc), "Mc": dict(Mc), "Tc": dict(Tc), "Yp": dict(Yp), "Mp": dict(Mp), "Tp": dict(Tp)}
    return out


# ------------------------------------------------------------------ model specification
DEFAULT_SPEC = {"level": 730, "knots": [30.0], "win": 730, "alpha_c": 4.0, "alpha_p": 3.0, "hl_c": None, "hl_p": None}


def prepare(df, spec):
    X = add_columns(df.copy(), knots=tuple(spec["knots"]), win=spec["win"])
    X["lv"] = trailing_level(X, spec["level"])
    X["use"] = (X.has_stats == 1) & (X.E > 0) & (X.amb == 0)
    for d in sorted(X.division.dropna().unique()):
        X["div_" + d] = (X.division == d).astype(float)
    return X


def blocks(spec, X=None):
    kn = [int(k) for k in spec["knots"]]
    divs = sorted(d for d in LBS if d not in ("Lightweight", "Open Weight"))
    if X is not None:
        divs = [d for d in divs if ("div_" + d) in X.columns]
    return {
        "div": ["div_" + d for d in divs],
        "ctx": ["five", "title"],
        "age_d": ["d_age_c"] + ["d_age_h%d" % k for k in kn] + ["d_age_na"],
        "age_a": ["a_age_c"] + ["a_age_h%d" % k for k in kn],
        "dmg": ["d_yrs", "d_lognp", "d_cumoh100", "d_okd_r", "d_okd_o", "d_kol_r", "d_kol_o", "d_debut"],
        "lay": ["d_lay_short", "d_lay_12_24", "d_lay_24p", "d_last_ko_loss", "d_ko_short"],
        "move": ["d_up_cls", "d_dn_cls", "a_up_cls", "a_dn_cls"],
        "move_lbs": ["d_up_lbs", "d_dn_lbs", "a_up_lbs", "a_dn_lbs"],
        "body": ["d_ht_rel", "d_ape", "a_ht_rel", "a_ape", "reach_adv"],
        "aexp": ["a_yrs", "a_lognp", "a_debut"],
    }


def final_cols(spec, X=None):
    b = blocks(spec, X)
    return b["div"] + b["ctx"] + b["age_d"] + b["age_a"] + b["dmg"] + b["lay"]


def fit_kd(X, cols, fit_mask, spec, eb=True, use_level=True, extra_off=None, iters=4, ridge=1e-4,
           use_c=True, use_p=True, final_state=False):
    """Fit fixed effects with walk-forward fighter effects as offsets; returns a dict with everything."""
    D = np.column_stack([np.ones(len(X))] + [X[c].to_numpy(float) for c in cols])
    y = X.y.fillna(0).to_numpy(float)
    E = X.E.fillna(0).to_numpy(float)
    logE = np.log(np.where(E > 0, E, 1.0))
    lv = np.log(X.lv.to_numpy(float)) if use_level else np.zeros(len(X))
    xo = np.zeros(len(X)) if extra_off is None else extra_off
    offf = np.zeros(len(X))
    b, w = None, None
    for _ in range(iters if eb else 1):
        b, cov, _ = pois_fit(D[fit_mask], y[fit_mask], (logE + lv + xo + offf)[fit_mask], beta0=b, ridge=ridge)
        if not eb:
            break
        base = np.exp(D @ b + logE + lv + xo) * (E > 0) * X.use.to_numpy()
        w = eb_walk(X, base, spec["alpha_c"], spec["alpha_p"], spec.get("hl_c"), spec.get("hl_p"), use_c, use_p,
                    final_state=final_state)
        offf = np.log(w["chin"]) + np.log(w["pow"])
    if eb:
        b, cov, _ = pois_fit(D[fit_mask], y[fit_mask], (logE + lv + xo + offf)[fit_mask], beta0=b, ridge=ridge)
    lin = D @ b
    mu = np.exp(lin + logE + lv + xo + offf)
    return {"cols": cols, "b": b, "cov": cov, "D": D, "y": y, "E": E, "mu": mu, "lin": lin, "off_fe": offf,
            "lv": lv, "xo": xo, "walk": w, "fit": fit_mask}


def window(X, lo, hi=None):
    m = X.use & (X.date >= lo)
    if hi:
        m &= X.date <= hi
    return m.to_numpy()


def dev_of(r, mask):
    return float(pois_dev(r["y"][mask], r["mu"][mask]).sum())


def tune(df, verbose=True):
    """Staged grid on 2019-2023 (fit 2008-2018). Returns the chosen spec and the grid."""
    grid = []
    best = dict(DEFAULT_SPEC)
    cache = {}

    def score(spec):
        key = (spec["level"], tuple(spec["knots"]), spec["win"])
        if key not in cache:
            cache[key] = prepare(df, spec)
        X = cache[key]
        fm, em = window(X, *TUNE_FIT), window(X, *TUNE_EVAL)
        r = fit_kd(X, final_cols(spec, X), fm, spec)
        d = dev_of(r, em)
        grid.append({"spec": {k: spec[k] for k in ("level", "knots", "win", "alpha_c", "alpha_p", "hl_c", "hl_p")},
                     "dev_2019_2023": round(d, 2)})
        if verbose:
            print("  tune %-70s dev %.1f" % (grid[-1]["spec"], d))
        return d

    def stage(key, values):
        nonlocal best
        scores = []
        for v in values:
            s = dict(best)
            s[key] = v
            scores.append((score(s), v))
        best[key] = min(scores, key=lambda t: t[0])[1]

    stage("level", [180, 365, 730])
    stage("knots", [[30.0], [27.0, 31.0, 35.0], [28.0, 32.0, 36.0]])
    stage("win", [365, 730, 1095])
    stage("alpha_c", [2.0, 3.0, 4.0, 6.0, 10.0])
    stage("alpha_p", [2.0, 2.5, 3.0, 4.0, 6.0])
    stage("hl_c", [None, 1825, 2920])
    stage("hl_p", [None, 1825, 2920])
    return best, grid
