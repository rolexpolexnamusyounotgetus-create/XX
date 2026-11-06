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
import os
for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "1")          # small dense solves: threads only add contention
import argparse
import bisect
import datetime as dt
import json
import math
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
        fl = pd.to_numeric(X["fight_lbs"], errors="coerce").astype(float)
        hl = pd.to_numeric(X[p + "_home_lbs"], errors="coerce").astype(float)
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
        age = pd.to_numeric(X[p + "_age"], errors="coerce").astype(float)
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
    X["ht_adv"] = (X["a_height"].astype(float) - X["d_height"].astype(float)).fillna(0.0).clip(-12, 12)
    X["reach_adv"] = X["reach_adv"].clip(-12, 12)
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

    Returns the defender's chin multiplier and the attacker's power multiplier as of before each fight (Gamma
    posterior means), plus the posterior shapes and rates. Both directions of a fight are predicted before
    either is used to update."""
    n = len(df)
    fid = df.fid.tolist()
    day = df.day.tolist()
    att = df["att"].tolist()
    de = df["def"].tolist()
    y = df.y.fillna(0).tolist()
    ok = ((df.has_stats.to_numpy() == 1) & np.isfinite(base_mu)).tolist()
    bm = np.nan_to_num(base_mu).tolist()
    lam_c = math.log(2) / hl_c if hl_c else 0.0
    lam_p = math.log(2) / hl_p if hl_p else 0.0
    cs, cr, ps, pr = [0.0] * n, [0.0] * n, [0.0] * n, [0.0] * n
    chin, powm = [1.0] * n, [1.0] * n
    Yc, Mc, Tc, Yp, Mp, Tp = {}, {}, {}, {}, {}, {}

    def get(Y, M, T, p, d, lam):
        if p not in T:
            T[p] = d
            Y[p] = 0.0
            M[p] = 0.0
            return 0.0, 0.0
        if lam and d > T[p]:
            f = math.exp(-lam * (d - T[p]))
            Y[p] *= f
            M[p] *= f
            T[p] = d
        return Y[p], M[p]

    i = 0
    while i < n:
        j = i + 1
        while j < n and fid[j] == fid[i]:
            j += 1
        for r in range(i, j):
            yc, mc = get(Yc, Mc, Tc, de[r], day[r], lam_c)
            yp, mp = get(Yp, Mp, Tp, att[r], day[r], lam_p)
            cs[r], cr[r] = alpha_c + yc, alpha_c + mc
            ps[r], pr[r] = alpha_p + yp, alpha_p + mp
            if use_c:
                chin[r] = cs[r] / cr[r]
            if use_p:
                powm[r] = ps[r] / pr[r]
        for r in range(i, j):
            if not ok[r]:
                continue
            Yc[de[r]] += y[r]
            Mc[de[r]] += bm[r] * powm[r]
            Yp[att[r]] += y[r]
            Mp[att[r]] += bm[r] * chin[r]
        i = j
    out = {"chin": np.array(chin), "pow": np.array(powm), "cshape": np.array(cs), "crate": np.array(cr),
           "pshape": np.array(ps), "prate": np.array(pr)}
    if final_state:
        out["state"] = {"Yc": Yc, "Mc": Mc, "Tc": Tc, "Yp": Yp, "Mp": Mp, "Tp": Tp}
    return out


# ------------------------------------------------------------------ model specification
DEFAULT_SPEC = {"level": 730, "knots": [30.0], "win": 730, "alpha_c": 4.0, "alpha_p": 3.0, "hl_c": None, "hl_p": None,
                "dmg": "full", "aexp": False}
DMG_VARIANTS = {
    "full": ["d_yrs", "d_lognp", "d_cumoh100", "d_okd_r", "d_okd_o", "d_kol_r", "d_kol_o", "d_debut"],
    "no_okd": ["d_yrs", "d_lognp", "d_cumoh100", "d_kol_r", "d_kol_o", "d_debut"],      # KD history only via u_d
    "no_okd_cumoh": ["d_yrs", "d_lognp", "d_kol_r", "d_kol_o", "d_debut"],
}


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
        "dmg": DMG_VARIANTS[spec.get("dmg", "full")],
        "dmg_full": DMG_VARIANTS["full"],
        "lay": ["d_lay_short", "d_lay_12_24", "d_lay_24p", "d_last_ko_loss", "d_ko_short"],
        "move": ["d_up_cls", "d_dn_cls", "a_up_cls", "a_dn_cls"],
        "move_lbs": ["d_up_lbs", "d_dn_lbs", "a_up_lbs", "a_dn_lbs"],
        "body": ["d_ht_rel", "d_ape", "ht_adv", "reach_adv"],
        "aexp": ["a_yrs", "a_lognp", "a_debut"],
    }


def final_cols(spec, X=None):
    b = blocks(spec, X)
    return b["div"] + b["ctx"] + b["age_d"] + b["age_a"] + b["dmg"] + b["lay"] + (b["aexp"] if spec.get("aexp") else [])


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
        grid.append({"spec": {k: spec[k] for k in ("level", "knots", "win", "alpha_c", "alpha_p", "hl_c", "hl_p", "dmg", "aexp")},
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
    stage("dmg", ["full", "no_okd", "no_okd_cumoh"])
    stage("aexp", [False, True])
    stage("alpha_c", [2.0, 3.0, 4.0, 6.0, 10.0])
    stage("alpha_p", [2.0, 2.5, 3.0, 4.0, 6.0])
    stage("hl_c", [None, 1825, 2920])
    stage("hl_p", [None, 1825, 2920])
    # validation diagnostics for the chosen spec: calibration slopes of the fighter effects on 2019-2023
    X = prepare(df, best)
    r = fit_kd(X, final_cols(best, X), window(X, *TUNE_FIT), best)
    diag = {"eb_slopes_2019_2023": ebslope(X, r, window(X, *TUNE_EVAL)), "dev_2019_2023": round(dev_of(r, window(X, *TUNE_EVAL)), 2)}
    return best, grid, diag


# ------------------------------------------------------------------ evaluation helpers
def v3_offset(X, train_mask):
    """The v3 engine's hand-set structure (src/params3.js as of Nov 6): shrunk decayed power and chin ratios
    (k = 230 head strikes), chin age past 34 (+0.04/yr), power age past 34 (-0.03/yr), 1.04^KO losses capped
    at 1.15, size 0.05 / 0.03 per 10 lb moved up."""
    tr = X[train_mask]
    pdiv = (tr.groupby("division").y.sum() / tr.groupby("division").H.sum())
    p = X.division.map(pdiv).fillna(tr.y.sum() / tr.H.sum()).to_numpy(float)
    k = 230.0
    pw = ((X.a_dkd.to_numpy(float) + k * p) / (X.a_dh.to_numpy(float) + k)) / p
    ch = ((X.d_dokd.to_numpy(float) + k * p) / (X.d_doh.to_numpy(float) + k)) / p
    agec = np.exp(0.04 * np.clip(X.d_age.fillna(30).to_numpy(float) - 34, 0, None))
    agep = np.exp(-0.03 * np.clip(X.a_age.fillna(30).to_numpy(float) - 34, 0, None))
    kol = (X.d_kol_r + X.d_kol_o).to_numpy(float)
    koc = np.minimum(1.15, 1.04 ** kol)
    sc = np.exp(0.05 * X.d_up_lbs.to_numpy(float) / 10)
    sp = np.exp(-0.03 * X.a_up_lbs.to_numpy(float) / 10)
    return np.log(pw * ch * agec * agep * koc * sc * sp)


def fight_diff(X, mask, d1, d0):
    """Mean and cluster (fight) SE of a deviance difference, as totals and per fight-side."""
    f = X.fid.to_numpy()[mask]
    diff = pd.Series(d1 - d0).groupby(f).sum()
    n = len(diff)
    return {"total": float(diff.sum()), "se_total": float(diff.std(ddof=1) * math.sqrt(n)), "fights": int(n)}


def linear_combo(r, names, weights):
    idx = [(["const"] + r["cols"]).index(n) for n in names]
    w = np.array(weights, float)
    est = float(w @ r["b"][idx])
    cov = r.get("cov_cl", r["cov"])
    se = float(math.sqrt(w @ cov[np.ix_(idx, idx)] @ w))
    return est, se


def coef_table(r, X, groups):
    r["cov_cl"] = cluster_cov(r["D"][r["fit"]], r["y"][r["fit"]], r["mu"][r["fit"]], r["cov"],
                              groups[r["fit"]])
    se = np.sqrt(np.diag(r["cov"]))
    sec = np.sqrt(np.diag(r["cov_cl"]))
    out = []
    for nm, b, s, sc in zip(["const"] + r["cols"], r["b"], se, sec):
        out.append({"term": nm, "coef": round(float(b), 5), "se": round(float(s), 5), "se_cluster": round(float(sc), 5),
                    "mult": round(math.exp(b), 4)})
    return out


def calib(X, mask, mus, by, labels=None):
    rows = []
    g = by[mask]
    y = X.y.to_numpy(float)[mask]
    for lev in (labels or sorted(pd.unique(g))):
        m = g == lev
        if m.sum() == 0:
            continue
        row = {"group": str(lev), "rows": int(m.sum()), "kd": int(y[m].sum())}
        for nm, mu in mus.items():
            e = float(mu[mask][m].sum())
            row["exp_" + nm] = round(e, 1)
            row["oe_" + nm] = round(float(y[m].sum()) / e, 3) if e > 0 else None
        rows.append(row)
    return rows


def nb_dispersion(y, mu):
    """MLE of the gamma heterogeneity variance v = 1/k in y ~ NB(mean mu, var mu + v mu^2), mu fixed."""
    def nll(lv):
        v = math.exp(lv)
        k = 1.0 / v
        return -np.sum(special.gammaln(y + k) - special.gammaln(k) - special.gammaln(y + 1)
                       + k * np.log(k / (k + mu)) + y * np.log(mu / (k + mu)))
    from scipy.optimize import minimize_scalar
    res = minimize_scalar(nll, bounds=(-8, 3), method="bounded")
    v = math.exp(res.x)
    # curvature SE on log v
    h = 1e-3
    d2 = (nll(res.x + h) - 2 * nll(res.x) + nll(res.x - h)) / h ** 2
    se_lv = 1 / math.sqrt(d2) if d2 > 0 else float("nan")
    return v, se_lv, float(nll(res.x)), float(nll(-30))


def logit_fit(Xm, y, ridge=1e-4, iters=100):
    k = Xm.shape[1]
    b = np.zeros(k)
    R = ridge * np.eye(k)
    R[0, 0] = 0
    for _ in range(iters):
        p = 1 / (1 + np.exp(-(Xm @ b)))
        g = Xm.T @ (y - p) - R @ b
        H = Xm.T @ (Xm * (p * (1 - p))[:, None]) + R
        st = np.linalg.solve(H, g)
        b += st
        if np.max(np.abs(st)) < 1e-9:
            break
    p = 1 / (1 + np.exp(-(Xm @ b)))
    H = Xm.T @ (Xm * (p * (1 - p))[:, None]) + R
    return b, np.linalg.inv(H), p


def logloss(y, p):
    p = np.clip(p, 1e-9, 1 - 1e-9)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


# ------------------------------------------------------------------ analyses
def ladder(X, spec):
    """Fit every model on 2008-2023 and score Poisson deviance on 2024+ (never used for fitting or tuning)."""
    bl = blocks(spec, X)
    fm = window(X, FIT_FROM, "2023-12-31")
    tm = window(X, TEST_FROM)
    elig = (X.d_n_prior > 0).to_numpy() & (X.a_n_prior > 0).to_numpy()
    v3o = v3_offset(X, fm)
    claim = ["d_age_h30", "a_age_h30"]
    if "d_age_h30" not in X.columns:
        X["d_age_h30"] = np.clip(X.d_age.fillna(30) - 30, 0, None)
        X["a_age_h30"] = np.clip(X.a_age.fillna(30) - 30, 0, None)
    specs = [
        ("M0 constant KD per standing head strike", [], dict(eb=False, use_level=False)),
        ("M0L constant + trailing league level", [], dict(eb=False)),
        ("M1 + division, 5-round, title", bl["div"] + bl["ctx"], dict(eb=False)),
        ("C30 M1 + years past 30 (claim form)", bl["div"] + bl["ctx"] + claim, dict(eb=False)),
        ("M2 + age splines (defender, attacker)", bl["div"] + bl["ctx"] + bl["age_d"] + bl["age_a"], dict(eb=False)),
        ("M3 + damage history and layoff", final_cols(spec, X), dict(eb=False)),
        ("V3 engine v3 hand-set structure", bl["div"], dict(eb=False, extra_off=v3o)),
        ("E1 M1 + fighter chin effect only", bl["div"] + bl["ctx"], dict(eb=True, use_p=False)),
        ("E2 M1 + fighter power effect only", bl["div"] + bl["ctx"], dict(eb=True, use_c=False)),
        ("E3 M1 + chin and power effects", bl["div"] + bl["ctx"], dict(eb=True)),
        ("F  final: M3 + chin and power effects", final_cols(spec, X), dict(eb=True)),
        ("F+move final + weight move (classes)", final_cols(spec, X) + bl["move"], dict(eb=True)),
        ("F+lbs final + weight move (pounds)", final_cols(spec, X) + bl["move_lbs"], dict(eb=True)),
        ("F+body final + height, ape index, reach advantage", final_cols(spec, X) + bl["body"], dict(eb=True)),
        ("Ffull final with the full damage block (prior KDs absorbed as covariates)",
         [c for c in final_cols(spec, X) if c not in bl["dmg"]] + bl["dmg_full"], dict(eb=True)),
        ("Fnokd final without prior-KD covariates (KD history only through u_d)",
         [c for c in final_cols(spec, X) if c not in bl["dmg"]] + DMG_VARIANTS["no_okd"], dict(eb=True)),
    ]
    res, rows = {}, []
    for name, cols, kw in specs:
        r = fit_kd(X, cols, fm, spec, **kw)
        res[name.split()[0]] = r
    base0 = pois_dev(res["M0"]["y"], res["M0"]["mu"])
    baseL = pois_dev(res["M0L"]["y"], res["M0L"]["mu"])
    for name, cols, kw in specs:
        key = name.split()[0]
        r = res[key]
        dv = pois_dev(r["y"], r["mu"])
        ll = r["y"] * np.log(np.maximum(r["mu"], 1e-12)) - r["mu"] - special.gammaln(r["y"] + 1)
        row = {"model": name, "k": len(cols) + 1, "dev_test": round(float(dv[tm].sum()), 2),
               "loglik_test": round(float(ll[tm].sum()), 2), "kd_obs": int(r["y"][tm].sum()),
               "kd_exp": round(float(r["mu"][tm].sum()), 1),
               "dev_train": round(float(dv[fm].sum()), 2)}
        d0 = fight_diff(X, tm, dv[tm], base0[tm])
        dL = fight_diff(X, tm, dv[tm], baseL[tm])
        row["vs_M0"] = {k: round(v, 2) if isinstance(v, float) else v for k, v in d0.items()}
        row["vs_M0L"] = {k: round(v, 2) if isinstance(v, float) else v for k, v in dL.items()}
        te = tm & elig
        row["dev_test_eligible"] = round(float(dv[te].sum()), 2)
        row["vs_M0L_eligible"] = round(float(dv[te].sum() - baseL[te].sum()), 2)
        rows.append(row)
    return res, rows, {"rows_test": int(tm.sum()), "fights_test": int(X.fid[tm].nunique()),
                       "rows_fit": int(fm.sum()), "rows_test_eligible": int((tm & elig).sum())}


def age_slopes(r, prefix, knots):
    """Per-year slopes of the linear age spline by segment (log scale), with SEs."""
    names = [prefix + "_age_c"] + [prefix + "_age_h%d" % int(k) for k in knots]
    cuts = [None] + list(knots)
    out = []
    for i in range(len(names)):
        est, se = linear_combo(r, names[:i + 1], [1.0] * (i + 1))
        lo = cuts[i]
        hi = knots[i] if i < len(knots) else None
        out.append({"from": lo, "to": hi, "slope": round(est, 5), "se": round(se, 5),
                    "pct_per_year": round(100 * (math.exp(est) - 1), 2)})
    return out


def overdispersion(X, r, mask, spec):
    """Fight-level heterogeneity of the KD rate beyond the model (relative to walk-forward predictions and
    to leave-one-out full-history fighter effects), and the share of it that both directions of a fight share."""
    y, mu = r["y"][mask], r["mu"][mask]
    v, se_lv, nll, nll0 = nb_dispersion(y, mu)
    out = {"walk_forward": {"var": round(v, 4), "se_log_var": round(se_lv, 4), "lognormal_sd": round(math.sqrt(math.log1p(v)), 4),
                            "lr_vs_poisson": round(2 * (nll0 - nll), 2)}}
    # leave-one-out fighter effects from the full history (closer to pure fight-night form)
    w = r["walk"]
    base = np.exp(r["lin"] + np.log(np.where(r["E"] > 0, r["E"], 1)) + r["lv"] + r["xo"]) * (r["E"] > 0) * X.use.to_numpy()
    yy = r["y"] * X.use.to_numpy()
    de, at = X["def"].to_numpy(), X["att"].to_numpy()
    Yc = pd.Series(yy).groupby(de).sum()
    Yp = pd.Series(yy).groupby(at).sum()
    chin_loo = np.ones(len(X))
    pow_loo = np.ones(len(X))
    for _ in range(6):     # alternate: chin given power, power given chin
        Mc = pd.Series(base * pow_loo).groupby(de).sum()
        chin_loo = ((spec["alpha_c"] + Yc.reindex(de).to_numpy() - yy) /
                    (spec["alpha_c"] + Mc.reindex(de).to_numpy() - base * pow_loo))
        Mp = pd.Series(base * chin_loo).groupby(at).sum()
        pow_loo = ((spec["alpha_p"] + Yp.reindex(at).to_numpy() - yy) /
                   (spec["alpha_p"] + Mp.reindex(at).to_numpy() - base * chin_loo))
    mu_loo = base * chin_loo * pow_loo
    # rescale to the same total as the data in the mask (LOO slightly biases the level)
    s = y.sum() / mu_loo[mask].sum()
    v2, se2, nll2, nll20 = nb_dispersion(y, mu_loo[mask] * s)
    out["leave_one_out"] = {"var": round(v2, 4), "se_log_var": round(se2, 4), "lognormal_sd": round(math.sqrt(math.log1p(v2)), 4),
                            "lr_vs_poisson": round(2 * (nll20 - nll2), 2), "level_rescale": round(float(s), 4)}
    # shared component: cov(y_ab, y_ba) = mu_ab mu_ba var(shared)
    for tag, m_all in (("walk_forward", r["mu"]), ("leave_one_out", mu_loo * s)):
        d = pd.DataFrame({"fid": X.fid.to_numpy()[mask], "y": y, "mu": m_all[mask]})
        g = d.groupby("fid")
        pairs = g.filter(lambda t: len(t) == 2)
        a = pairs.groupby("fid").nth(0)
        b = pairs.groupby("fid").nth(1)
        a = a.set_index("fid") if "fid" in a.columns else a
        b = b.set_index("fid") if "fid" in b.columns else b
        num = float(((a.y.to_numpy() - a.mu.to_numpy()) * (b.y.to_numpy() - b.mu.to_numpy())).sum())
        den = float((a.mu.to_numpy() * b.mu.to_numpy()).sum())
        prod = (a.y.to_numpy() - a.mu.to_numpy()) * (b.y.to_numpy() - b.mu.to_numpy())
        se = float(prod.std(ddof=1) * math.sqrt(len(prod)) / den)
        vs = num / den
        vt = out[tag]["var"]
        out[tag]["shared_var"] = round(vs, 4)
        out[tag]["shared_var_se"] = round(se, 4)
        out[tag]["shared_lognormal_sd"] = round(math.sqrt(math.log1p(max(vs, 0))), 4)
        vd = max((1 + vt) / (1 + max(vs, 0)) - 1, 0)
        out[tag]["direction_var"] = round(vd, 4)
        out[tag]["direction_lognormal_sd"] = round(math.sqrt(math.log1p(vd)), 4)
    return out



def pairwise(X, res, mask, pairs):
    out = []
    for a, b in pairs:
        da = pois_dev(res[a]["y"], res[a]["mu"])[mask]
        db = pois_dev(res[b]["y"], res[b]["mu"])[mask]
        d = fight_diff(X, mask, da, db)
        out.append({"model": a, "vs": b, "dev_diff": round(d["total"], 2), "se": round(d["se_total"], 2)})
    return out


def ebslope(X, r, mask):
    """Calibration slopes of the walk-forward fighter effects: free coefficients on log chin and log power."""
    w = r["walk"]
    Z = np.column_stack([np.ones(len(X)), np.log(w["chin"]), np.log(w["pow"])])
    off = r["lin"] + np.log(np.where(r["E"] > 0, r["E"], 1)) + r["lv"] + r["xo"]
    b, cov, _ = pois_fit(Z[mask], r["y"][mask], off[mask])
    se = np.sqrt(np.diag(cov))
    return {"intercept": round(float(b[0]), 4), "chin_slope": round(float(b[1]), 4), "chin_se": round(float(se[1]), 4),
            "pow_slope": round(float(b[2]), 4), "pow_se": round(float(se[2]), 4)}


def within_fighter(X, r, mask, zcols):
    """Fixed-effects (conditional) Poisson on the defender: only within-fighter changes identify the terms.
    Offsets hold the rest of the final model (level, division, context, attacker terms, attacker power)."""
    D = r["D"]
    names = ["const"] + r["cols"]
    keep = [i for i, n in enumerate(names) if not n.startswith("d_")]
    off = (D[:, keep] @ r["b"][keep] + np.log(np.where(r["E"] > 0, r["E"], 1)) + r["lv"] + r["xo"]
           + np.log(r["walk"]["pow"]))
    Z = np.column_stack([X[c].to_numpy(float) for c in zcols])
    m = mask.copy()
    grp = X["def"].to_numpy()
    y = r["y"]
    Ytot = pd.Series(y[m]).groupby(grp[m]).sum()
    good = set(Ytot[Ytot > 0].index)
    m &= np.array([g in good for g in grp])
    Zm, ym, om, gm = Z[m], y[m], off[m], grp[m]
    codes, uniq = pd.factorize(gm)
    G = len(uniq)
    g = np.zeros(Z.shape[1])
    for _ in range(100):
        eta = om + Zm @ g
        mu = np.exp(eta)
        S = np.bincount(codes, mu, G)
        Yg = np.bincount(codes, ym, G)
        pi = mu / S[codes]
        resid = ym - Yg[codes] * pi
        score = Zm.T @ resid
        # conditional information: sum_i Y_i [ sum_j pi z z' - (sum_j pi z)(sum_j pi z)' ]
        zbar = np.vstack([np.bincount(codes, pi * Zm[:, k], G) for k in range(Zm.shape[1])]).T
        H = (Zm * (Yg[codes] * pi)[:, None]).T @ Zm - (zbar * Yg[:, None]).T @ zbar
        st = np.linalg.solve(H, score)
        g += st
        if np.max(np.abs(st)) < 1e-9:
            break
    cov = np.linalg.inv(H)
    sc = Zm * resid[:, None]
    sg = np.vstack([np.bincount(codes, sc[:, k], G) for k in range(Zm.shape[1])]).T
    meat = sg.T @ sg
    covc = cov @ meat @ cov * G / (G - 1)
    return {"terms": [{"term": c, "coef": round(float(b), 5), "se": round(float(s), 5), "se_cluster": round(float(sc_), 5)}
                      for c, b, s, sc_ in zip(zcols, g, np.sqrt(np.diag(cov)), np.sqrt(np.diag(covc)))],
            "fighters": int(G), "rows": int(m.sum()), "kd": int(ym.sum()),
            "cov_cluster": covc.tolist()}


def claim_age(X, mask_all):
    """Replicate research/volkanovski.md's league Poisson fit (KDs absorbed, offset log head strikes absorbed,
    defender and attacker years past 30, all divisions) and its variants."""
    out = {}
    m = mask_all & (X.H.fillna(0).to_numpy() > 0)
    y = X.y.fillna(0).to_numpy(float)
    dh = np.clip(X.d_age.to_numpy(float) - 30, 0, None)
    ah = np.clip(X.a_age.to_numpy(float) - 30, 0, None)
    ok = m & np.isfinite(dh) & np.isfinite(ah)
    for tag, expo in (("all_head", X.H.to_numpy(float)), ("standing_head", X.E.to_numpy(float))):
        okk = ok & (expo > 0)
        Z = np.column_stack([np.ones(okk.sum()), dh[okk], ah[okk]])
        b, cov, _ = pois_fit(Z, y[okk], np.log(expo[okk]))
        se = np.sqrt(np.diag(cov))
        out[tag] = {"baseline": round(math.exp(b[0]), 5), "defender_past30": round(float(b[1]), 4),
                    "defender_se": round(float(se[1]), 4), "attacker_past30": round(float(b[2]), 4),
                    "attacker_se": round(float(se[2]), 4), "rows": int(okk.sum())}
    return out


def win_size_check(X, fit_mask):
    """Win probability ~ Elo logit + class moves (one row per fight, both orientations averaged by symmetry):
    replicates research/matchup_market.md's 'no size tax after Elo control' with the same and richer controls."""
    one = X[fit_mask & (X.side_def == "B").to_numpy()].copy()     # row = A attacking B; outcome A wins
    one = one[one.winner.isin(["A", "B"])]
    y = (one.winner == "A").to_numpy(float)
    elo = one.elo_diff.to_numpy(float)
    mvA, mvB = one.a_mv_cls.to_numpy(float), one.d_mv_cls.to_numpy(float)
    lbsA, lbsB = one.a_mv_lbs.to_numpy(float), one.d_mv_lbs.to_numpy(float)
    ageA, ageB = one.a_age.fillna(30).to_numpy(float), one.d_age.fillna(30).to_numpy(float)
    res = {}
    # symmetric design: differences only, no intercept beyond a corner term
    Z1 = np.column_stack([np.ones(len(y)), elo, mvA - mvB])
    b, cov, _ = logit_fit(Z1, y)
    se = np.sqrt(np.diag(cov))
    res["elo_plus_class_move"] = {"elo": round(float(b[1]), 4), "class_move_up": round(float(b[2]), 4),
                                  "se": round(float(se[2]), 4), "fights": int(len(y))}
    sel = (np.abs(mvA - mvB) == 1)
    Z2 = Z1[sel]
    b2, cov2, _ = logit_fit(Z2, y[sel])
    res["one_class_apart_only"] = {"class_move_up": round(float(b2[2]), 4), "se": round(float(np.sqrt(cov2[2, 2])), 4),
                                   "fights": int(sel.sum())}
    Z3 = np.column_stack([Z1, ageA - ageB, np.clip(ageA - 34, 0, None) - np.clip(ageB - 34, 0, None),
                          (one.a_kol_r + one.a_kol_o - one.d_kol_r - one.d_kol_o).to_numpy(float)])
    b3, cov3, _ = logit_fit(Z3, y)
    se3 = np.sqrt(np.diag(cov3))
    res["elo_move_age_kolosses"] = {"class_move_up": round(float(b3[2]), 4), "se": round(float(se3[2]), 4),
                                    "age_diff": round(float(b3[3]), 4), "age_diff_se": round(float(se3[3]), 4),
                                    "past34_diff": round(float(b3[4]), 4), "past34_se": round(float(se3[4]), 4),
                                    "ko_losses_diff": round(float(b3[5]), 4), "ko_losses_se": round(float(se3[5]), 4)}
    Z4 = np.column_stack([np.ones(len(y)), elo, lbsA - lbsB])
    b4, cov4, _ = logit_fit(Z4, y)
    res["elo_plus_lbs_move_per10"] = {"per_10lb_up": round(float(10 * b4[2]), 4), "se": round(float(10 * np.sqrt(cov4[2, 2])), 4)}
    return res


def exposure_rate(X, fit_mask, k=15.0):
    """Pre-fight expected standing head strikes landed per minute by a on d (decayed sums, shrunk to league)."""
    tr = X[fit_mask]
    L = float(tr.E.sum() / tr["min"].sum())
    ra = (X.a_dsh.to_numpy(float) + k * L) / (X.a_dmin.to_numpy(float) + k)
    rd = (X.d_dosh.to_numpy(float) + k * L) / (X.d_dmin.to_numpy(float) + k)
    return 0.5 * (np.log(ra) + np.log(rd)) - math.log(L), L


def ko_model(X, r_final, spec, fm_dates=(FIT_FROM, "2023-12-31")):
    """KO/TKO loss per fight (logistic; pre-fight features only). Rows: each defender of each fight with stats."""
    base = (X.has_stats == 1) & (X.amb == 0)
    fm = (base & (X.date >= fm_dates[0]) & (X.date <= fm_dates[1])).to_numpy()
    tm = (base & (X.date >= TEST_FROM)).to_numpy()
    y = X.ko_loss.to_numpy(float)
    bl = blocks(spec, X)
    lexp, Lsh = exposure_rate(X, (X.use & (X.date >= fm_dates[0]) & (X.date <= fm_dates[1])).to_numpy())
    w = r_final["walk"]
    comp = r_final["lin"] + r_final["lv"] + np.log(w["chin"]) + np.log(w["pow"])     # log KD per standing head strike
    comp = comp - np.nanmean(comp[fm])
    X = X.assign(k_comp=comp, k_lexp=lexp, k_lsched=np.log(np.where(X.sched > 0, X.sched * 5.0, 15.0)) - math.log(15),
                 k_lchin=np.log(w["chin"]), k_lpow=np.log(w["pow"]), k_lv=np.log(X.lv) - np.log(X.lv[fm].mean()))
    specs = [
        ("K0 constant", []),
        ("K1 division + scheduled length", bl["div"] + ["k_lsched"]),
        ("K2 K1 + Elo difference", bl["div"] + ["k_lsched", "elo_diff"]),
        ("K3 K2 + trailing KD level", bl["div"] + ["k_lsched", "elo_diff", "k_lv"]),
        ("K4 composite: predicted KD rate + exposure + Elo", ["k_comp", "k_lexp", "k_lsched", "elo_diff"]),
        ("K5 direct: K3 + age, damage, layoff, fighter effects", bl["div"] + ["k_lsched", "elo_diff", "k_lv", "k_lexp"]
         + bl["age_d"] + bl["age_a"] + bl["dmg"] + bl["lay"] + ["k_lchin", "k_lpow"]),
        ("K6 K5 + weight move", bl["div"] + ["k_lsched", "elo_diff", "k_lv", "k_lexp"] + bl["age_d"] + bl["age_a"]
         + bl["dmg"] + bl["lay"] + ["k_lchin", "k_lpow"] + bl["move"]),
        ("K7 K4 + direct damage and move terms", ["k_comp", "k_lexp", "k_lsched", "elo_diff", "d_kol_r", "d_kol_o",
                                                 "d_okd_r", "d_okd_o"] + bl["move"]),
    ]
    out, preds = [], {}
    for name, cols in specs:
        Z = np.column_stack([np.ones(len(X))] + [X[c].to_numpy(float) for c in cols])
        b, cov, _ = logit_fit(Z[fm], y[fm])
        p = 1 / (1 + np.exp(-(Z @ b)))
        preds[name.split()[0]] = p
        se = np.sqrt(np.diag(cov))
        out.append({"model": name, "coef": [{"term": t, "coef": round(float(bb), 5), "se": round(float(ss), 5)}
                                            for t, bb, ss in zip(["const"] + cols, b, se)],
                    "logloss_test": round(float(logloss(y[tm], p[tm]).mean()), 5),
                    "logloss_train": round(float(logloss(y[fm], p[fm]).mean()), 5),
                    "ko_rate_test": round(float(y[tm].mean()), 4), "pred_rate_test": round(float(p[tm].mean()), 4)})
    l0 = logloss(y[tm], preds["K0"][tm])
    l2 = logloss(y[tm], preds["K2"][tm])
    for row in out:
        k = row["model"].split()[0]
        lk = logloss(y[tm], preds[k][tm])
        for tag, ref in (("vs_K0", l0), ("vs_K2", l2)):
            d = fight_diff(X, tm, lk, ref)
            row[tag] = {"total": round(d["total"], 2), "se": round(d["se_total"], 2), "per_row": round(d["total"] / tm.sum(), 5)}
    # calibration of the best direct model by predicted decile on the test set
    best = min(out, key=lambda r: r["logloss_test"])["model"].split()[0]
    p = preds[best][tm]
    q = pd.qcut(p, 10, labels=False, duplicates="drop")
    cal = pd.DataFrame({"q": q, "p": p, "y": y[tm]}).groupby("q").agg(n=("y", "size"), pred=("p", "mean"), obs=("y", "mean"))
    return out, {"rows_fit": int(fm.sum()), "rows_test": int(tm.sum()), "best": best,
                 "test_calibration_deciles": [{"n": int(a.n), "pred": round(float(a.pred), 4), "obs": round(float(a.obs), 4)}
                                              for a in cal.itertuples()],
                 "league_standing_head_per_min": round(Lsh, 4)}, preds


# ------------------------------------------------------------------ fighter-level outputs
def ref_profile(X, fit_mask, knots):
    """Reference fighter for the covariate multipliers: age 30, median experience, no knockdowns or KO losses
    absorbed, 4-12 month layoff, at home."""
    nd = X[fit_mask & (X.d_n_prior > 0).to_numpy()]
    ref = {"d_age_c": 0.0, "d_age_na": 0.0, "a_age_c": 0.0,
           "d_yrs": float(nd.d_yrs.median()), "d_lognp": float(nd.d_lognp.median()),
           "d_cumoh100": float(nd.d_cumoh100.median()), "d_debut": 0.0}
    for k in knots:
        ref["d_age_h%d" % int(k)] = 0.0
        ref["a_age_h%d" % int(k)] = 0.0
    for c in ("d_okd_r", "d_okd_o", "d_kol_r", "d_kol_o", "d_lay_short", "d_lay_12_24", "d_lay_24p",
              "d_last_ko_loss", "d_ko_short", "d_up_cls", "d_dn_cls", "a_up_cls", "a_dn_cls"):
        ref[c] = 0.0
    return ref


def split_lin(r, X, ref):
    names = ["const"] + r["cols"]
    D, b = r["D"], r["b"]
    idd = [i for i, n in enumerate(names) if n.startswith("d_")]
    ida = [i for i, n in enumerate(names) if n.startswith("a_")]
    refd = np.array([ref.get(names[i], 0.0) for i in idd])
    refa = np.array([ref.get(names[i], 0.0) for i in ida])
    lin_d = D[:, idd] @ b[idd] - refd @ b[idd]
    lin_a = D[:, ida] @ b[ida] - refa @ b[ida]
    lin_ctx = r["lin"] - lin_d - lin_a
    return lin_d, lin_a, lin_ctx, idd, ida


class _F:
    pass


def now_features(stt, P, date, division, spec):
    f = _F()
    f.date, f.day, f.division = date, date.toordinal(), division
    x = side_features(stt, P, f, 0)
    row = {}
    for k, v in x.items():
        row["d_" + k] = v
        row["a_" + k] = v
    one = pd.DataFrame([dict(row, division=division, fight_lbs=LBS.get(division), sched=5, title=0,
                             elo_a=1500.0, elo_d=1500.0, has_stats=1, y=0.0, E=1.0, H=1.0, amb=0)])
    one = add_columns(one, knots=tuple(spec["knots"]), win=spec["win"])
    for c in ("d_lay_short", "d_lay_12_24", "d_lay_24p", "d_ko_short", "a_lay_short", "a_lay_12_24", "a_lay_24p"):
        one[c] = 0.0       # the roster numbers assume a normal 4-12 month layoff; the engine applies the real one
    return one.iloc[0], x


def gamma_q(shape, rate, qs=(0.05, 0.5, 0.95)):
    return [float(sst.gamma.ppf(q, shape, scale=1.0 / rate)) for q in qs]


def roster_outputs(X, r_live, spec, state, people, snap_date, ref, roster_slugs, n_draw=4000, seed=7):
    st = r_live["walk"]["state"]
    names = ["const"] + r_live["cols"]
    idd = [i for i, n in enumerate(names) if n.startswith("d_")]
    ida = [i for i, n in enumerate(names) if n.startswith("a_")]
    cov = r_live.get("cov_cl", r_live["cov"])
    rng = np.random.default_rng(seed)
    draws = rng.multivariate_normal(r_live["b"], cov, size=n_draw)
    slug2p = {P.get("slug"): p for p, P in people.items() if P.get("slug")}
    out = {}
    ac, ap = spec["alpha_c"], spec["alpha_p"]
    for slug in roster_slugs:
        p = slug2p.get(slug)
        if p is None or p not in state:
            continue
        stt = state[p]
        P = people[p]
        home = B.mode_recent(stt["hist"], snap_date.toordinal()) if stt["hist"] else None
        if home is None or home in NON_DIV:
            home = "Lightweight"
        row, x = now_features(stt, P, snap_date, home, spec)
        xd = np.array([row[names[i]] if names[i] in row else 0.0 for i in idd], float) - \
            np.array([ref.get(names[i], 0.0) for i in idd])
        xa = np.array([row[names[i]] if names[i] in row else 0.0 for i in ida], float) - \
            np.array([ref.get(names[i], 0.0) for i in ida])
        lc = float(xd @ r_live["b"][idd])
        lp = float(xa @ r_live["b"][ida])
        lcd = draws[:, idd] @ xd
        lpd = draws[:, ida] @ xa
        yc, mc = st["Yc"].get(p, 0.0), st["Mc"].get(p, 0.0)
        yp, mp = st["Yp"].get(p, 0.0), st["Mp"].get(p, 0.0)
        cs, cr, ps, pr = ac + yc, ac + mc, ap + yp, ap + mp
        u = rng.gamma(cs, 1.0 / cr, n_draw)
        v = rng.gamma(ps, 1.0 / pr, n_draw)
        tc = np.exp(lcd) * u
        tp = np.exp(lpd) * v

        def q(a):
            return [round(float(t), 4) for t in np.quantile(a, [0.05, 0.5, 0.95])]
        out[slug] = {
            "name": P.get("name"), "age": round(x["age"], 2) if np.isfinite(x["age"]) else None, "home": home,
            "ufc_fights": int(x["n_prior"]), "kd_absorbed": round(yc, 2), "kd_absorbed_expected": round(mc, 3),
            "kd_scored": round(yp, 2), "kd_scored_expected": round(mp, 3),
            "ko_losses_recent": int(x["kol_r%d" % spec["win"]]), "ko_losses_old": int(x["kol_o%d" % spec["win"]]),
            "kd_absorbed_recent": int(x["okd_r%d" % spec["win"]]),
            "cum_head_absorbed": int(x["cum_oh"]), "years_in_ufc": round(x["yrs_ufc"], 2),
            "chin_re": round(cs / cr, 4), "chin_re_q": [round(t, 4) for t in gamma_q(cs, cr)],
            "chin_re_shape_rate": [round(cs, 4), round(cr, 4)],
            "pow_re": round(ps / pr, 4), "pow_re_q": [round(t, 4) for t in gamma_q(ps, pr)],
            "pow_re_shape_rate": [round(ps, 4), round(pr, 4)],
            "chin_cov": round(math.exp(lc), 4), "pow_cov": round(math.exp(lp), 4),
            "chin_total_q": q(tc), "pow_total_q": q(tp),
            "chin_total": round(float(np.mean(tc)), 4), "pow_total": round(float(np.mean(tp)), 4),
        }
    return out


def matchup(r_live, spec, roster, ref, a_slug, b_slug, division, level_now, five=1, title=0, n_draw=4000, seed=11,
            people=None, state=None, snap_date=None, move_fit=None):
    """KD probability per landed standing head strike in each direction for a hypothetical fight."""
    names = ["const"] + r_live["cols"]
    b = r_live["b"]
    ctx = b[0] + (b[names.index("div_" + division)] if ("div_" + division) in names else 0.0) \
        + five * b[names.index("five")] + title * b[names.index("title")]
    out = {"division": division, "five": five, "title": title, "level_now": round(level_now, 6)}
    rng = np.random.default_rng(seed)
    for att, de in ((a_slug, b_slug), (b_slug, a_slug)):
        A, Dd = roster[att], roster[de]
        u = rng.gamma(*[Dd["chin_re_shape_rate"][0], 1.0 / Dd["chin_re_shape_rate"][1]], n_draw)
        v = rng.gamma(*[A["pow_re_shape_rate"][0], 1.0 / A["pow_re_shape_rate"][1]], n_draw)
        p_mean = level_now * math.exp(ctx) * Dd["chin_cov"] * A["pow_cov"] * Dd["chin_re"] * A["pow_re"]
        pd_ = level_now * math.exp(ctx) * Dd["chin_cov"] * A["pow_cov"] * u * v
        out[att + "->" + de] = {"p_per_standing_head": round(p_mean, 6),
                                "p_q": [round(float(t), 6) for t in np.quantile(pd_, [0.05, 0.5, 0.95])],
                                "kd_per_100": round(100 * p_mean, 3)}
    return out


def backtest_multipliers(X, r_pre, ref):
    lin_d, lin_a, lin_ctx, _, _ = split_lin(r_pre, X, ref)
    w = r_pre["walk"]
    p = np.exp(r_pre["lin"] + r_pre["lv"]) * w["chin"] * w["pow"]
    bt = json.load(open(os.path.join(ROOT, "data", "derived", "backtest.json")))
    ids = {e["id"] for e in bt["fights"]}
    out = {}
    fid = X.fid.to_numpy()
    sd = X.side_def.to_numpy()
    for i in np.where(np.isin(fid, list(ids)))[0]:
        e = out.setdefault(fid[i], {"A": {}, "B": {}, "p": {}})
        d = sd[i]
        a = "A" if d == "B" else "B"
        e[d]["chin_re"] = round(float(w["chin"][i]), 4)
        e[d]["chin_cov"] = round(float(math.exp(lin_d[i])), 4)
        e[a]["pow_re"] = round(float(w["pow"][i]), 4)
        e[a]["pow_cov"] = round(float(math.exp(lin_a[i])), 4)
        e["p"][a] = round(float(p[i]), 6)          # KD per standing head strike landed by a
    return out


def kd_level_series(X):
    s = X[X.use].copy()
    s["half"] = s.year.astype(str) + np.where(pd.to_datetime(s.date).dt.month <= 6, "H1", "H2")
    g = s.groupby("half").agg(kd=("y", "sum"), E=("E", "sum"), fights=("fid", "nunique"))
    g = g[g.index >= "2016"]
    return [{"period": k, "fights": int(r.fights), "kd": int(r.kd), "kd_per_1000_standing_head": round(1000 * r.kd / r.E, 2)}
            for k, r in g.iterrows()]


def calib_all(X, res, tm):
    mus = {k: res[k]["mu"] for k in ("M0L", "M1", "V3", "F")}
    w = res["F"]["walk"]
    da = pd.cut(X.d_age, [0, 27, 30, 33, 36, 99], labels=["<27", "27-30", "30-33", "33-36", "36+"]).astype(str).to_numpy()
    aa = pd.cut(X.a_age, [0, 27, 30, 33, 36, 99], labels=["<27", "27-30", "30-33", "33-36", "36+"]).astype(str).to_numpy()
    mv = np.where(X.d_mv_cls < 0, "down", np.where(X.d_mv_cls > 0, "up", np.where(X.d_debut > 0, "debut", "same")))
    amv = np.where(X.a_mv_cls < 0, "down", np.where(X.a_mv_cls > 0, "up", np.where(X.a_debut > 0, "debut", "same")))
    kol = (X.d_kol_r + X.d_kol_o).clip(upper=2).astype(int).astype(str).replace({"2": "2+"}).to_numpy()
    okd = (X.d_okd_r + X.d_okd_o).clip(upper=3).astype(int).astype(str).replace({"3": "3+"}).to_numpy()
    ct = np.full(len(X), "", dtype=object)
    pt = np.full(len(X), "", dtype=object)
    qc = np.quantile(w["chin"][tm], [1 / 3, 2 / 3])
    qp = np.quantile(w["pow"][tm], [1 / 3, 2 / 3])
    ct[:] = np.where(w["chin"] < qc[0], "low (good chin)", np.where(w["chin"] < qc[1], "mid", "high (weak chin)"))
    pt[:] = np.where(w["pow"] < qp[0], "low power", np.where(w["pow"] < qp[1], "mid", "high power"))
    sex = np.where(X.women > 0, "women", "men")
    yr = X.year.astype(str).to_numpy()
    return {
        "defender_age": calib(X, tm, mus, da, ["<27", "27-30", "30-33", "33-36", "36+", "nan"]),
        "attacker_age": calib(X, tm, mus, aa, ["<27", "27-30", "30-33", "33-36", "36+", "nan"]),
        "defender_weight_move": calib(X, tm, mus, mv, ["down", "same", "up", "debut"]),
        "attacker_weight_move": calib(X, tm, mus, amv, ["down", "same", "up", "debut"]),
        "defender_prior_ko_losses": calib(X, tm, mus, kol, ["0", "1", "2+"]),
        "defender_prior_kd_absorbed": calib(X, tm, mus, okd, ["0", "1", "2", "3+"]),
        "defender_chin_effect_tercile": calib(X, tm, mus, ct, ["low (good chin)", "mid", "high (weak chin)"]),
        "attacker_power_effect_tercile": calib(X, tm, mus, pt, ["low power", "mid", "high power"]),
        "sex": calib(X, tm, mus, sex, ["men", "women"]),
        "year": calib(X, tm, mus, yr),
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--quick", action="store_true", help="skip the tuning grid; use DEFAULT_SPEC")
    args = ap.parse_args()
    t0 = time.time()
    df, state, people, fights, snap_day = build_table()
    snap_date = dt.date.fromordinal(snap_day)

    if args.quick:
        spec, grid, tune_diag = dict(DEFAULT_SPEC), [], {}
    else:
        print("tuning on 2019-2023 (fit 2008-2018) ...")
        spec, grid, tune_diag = tune(df)
    print("spec:", spec)
    X = prepare(df, spec)
    groups = X["def"].to_numpy()

    print("held-out ladder (fit 2008-2023, score 2024+) ...")
    res, ladder_rows, info = ladder(X, spec)
    tm = window(X, TEST_FROM)
    fm = window(X, FIT_FROM, "2023-12-31")
    for r in ladder_rows:
        print("  %-58s dev %.1f  vs M0L %+.1f (se %.1f)  KD obs %d exp %.1f" % (
            r["model"], r["dev_test"], r["vs_M0L"]["total"], r["vs_M0L"]["se_total"], r["kd_obs"], r["kd_exp"]))
    pw = pairwise(X, res, tm, [("F", "V3"), ("F", "E3"), ("F", "M3"), ("E3", "V3"), ("F+move", "F"), ("F+lbs", "F"),
                              ("F+body", "F"), ("C30", "M1"), ("M2", "C30"), ("Ffull", "F"), ("Fnokd", "F")])
    coefs = {k: coef_table(res[k], X, groups) for k in ("F", "F+move", "F+lbs", "F+body", "M3", "C30", "Ffull", "Fnokd")}
    slopes = {"defender": age_slopes(res["F"], "d", spec["knots"]), "attacker": age_slopes(res["F"], "a", spec["knots"])}
    slopes_m2 = {"defender": age_slopes(res["M2"], "d", spec["knots"]), "attacker": age_slopes(res["M2"], "a", spec["knots"])}
    slopes_m3 = {"defender": age_slopes(res["M3"], "d", spec["knots"]), "attacker": age_slopes(res["M3"], "a", spec["knots"])}
    eb_cal = {"train": ebslope(X, res["F"], fm), "test": ebslope(X, res["F"], tm),
              "test_Ffull": ebslope(X, res["Ffull"], tm), "test_Fnokd": ebslope(X, res["Fnokd"], tm)}
    od = overdispersion(X, res["F"], fm, spec)
    cal = calib_all(X, res, tm)

    print("within-fighter, claims, size checks ...")
    if "d_age_h30" not in X.columns:
        X["d_age_h30"] = np.clip(X.d_age.fillna(30) - 30, 0, None)
    all08 = window(X, FIT_FROM)
    # within-fighter terms: only exogenous time-varying features (counts of earlier KDs / KO losses are lagged
    # outcomes and are mechanically biased under fighter fixed effects). Age and years in the UFC are collinear
    # within a fighter, so "age" here is all within-career change. Careers that end with a KO put KDs at the end
    # of careers, which biases the age slope up; the second variant drops each fighter's final UFC fight.
    zc = ["d_age_c", "d_age_h30", "d_lay_short", "d_lay_12_24", "d_lay_24p"]
    zc2 = zc + ["d_cumoh100"]
    last_day = X.groupby("def").day.transform("max").to_numpy()
    not_last = X.day.to_numpy() < last_day
    wf = {"pre2024_age": within_fighter(X, res["F"], fm, zc),
          "pre2024_age_wear": within_fighter(X, res["F"], fm, zc2),
          "pre2024_age_drop_final_fight": within_fighter(X, res["F"], fm & not_last, zc)}
    claims = {"replication_2010_on_all_data": claim_age(X, window(X, "2010-01-01")),
              "replication_2008_2023": claim_age(X, fm)}
    wins = win_size_check(X, ((X.has_stats == 1) & (X.amb == 0) & (X.date >= FIT_FROM)).to_numpy())

    print("KO/TKO loss per fight ...")
    ko_rows, ko_info, _ = ko_model(X, res["F"], spec)
    for r in ko_rows:
        print("  %-55s test log loss %.5f  vs K0 %+.2f (se %.2f)  vs K2 %+.2f (se %.2f)" % (
            r["model"], r["logloss_test"], r["vs_K0"]["total"], r["vs_K0"]["se"], r["vs_K2"]["total"], r["vs_K2"]["se"]))

    print("live fit on everything and roster multipliers ...")
    r_live = fit_kd(X, final_cols(spec, X), all08, spec, final_state=True)
    coef_live = coef_table(r_live, X, groups)
    slopes_live = {"defender": age_slopes(r_live, "d", spec["knots"]), "attacker": age_slopes(r_live, "a", spec["knots"])}
    r_live_move = fit_kd(X, final_cols(spec, X) + blocks(spec, X)["move"], all08, spec)
    coef_live_move = coef_table(r_live_move, X, groups)
    wf["all_2008_on_age"] = within_fighter(X, r_live, all08, zc)
    wf["all_2008_on_age_drop_final_fight"] = within_fighter(X, r_live, all08 & not_last, zc)
    ref = ref_profile(X, fm, spec["knots"])
    roster_slugs = list(json.load(open(os.path.join(ROOT, "data", "derived", "fighters.json")))["fighters"].keys())
    roster = roster_outputs(X, r_live, spec, state, people, snap_date, ref, roster_slugs)
    # level now: trailing league rate at the snapshot, and the recent 365-day rate
    s = X[X.use & (X.day > snap_day - spec["level"])]
    level_now = float(s.y.sum() / s.E.sum())
    s365 = X[X.use & (X.day > snap_day - 365)]
    level_365 = float(s365.y.sum() / s365.E.sum())
    # normalization so that multiplying the engine's division p0 by chin_total x pow_total keeps the average
    lin_d, lin_a, lin_ctx, _, _ = split_lin(r_live, X, ref)
    wl = r_live["walk"]
    rec = window(X, TEST_FROM)
    Ew = X.E.to_numpy(float)
    norm_chin = float(np.sum(Ew[rec] * np.exp(lin_d[rec]) * wl["chin"][rec]) / Ew[rec].sum())
    norm_pow = float(np.sum(Ew[rec] * np.exp(lin_a[rec]) * wl["pow"][rec]) / Ew[rec].sum())
    norm_joint = float(np.sum(Ew[rec] * np.exp(lin_d[rec] + lin_a[rec]) * wl["chin"][rec] * wl["pow"][rec]) / Ew[rec].sum())
    mu_live = {}
    for lv_name, lv_val in (("trailing_730", level_now), ("trailing_365", level_365)):
        mu_live[lv_name] = matchup(r_live, spec, roster, ref, "alexander-volkanovski", "justin-gaethje", "Lightweight",
                                   lv_val)
    bt_mult = backtest_multipliers(X, res["F"], ref)
    series = kd_level_series(X)

    names_live = ["const"] + r_live["cols"]
    out = {
        "meta": {
            "tool": "tools/durability.py", "built": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
            "snapshot": snap_date.isoformat(), "spec": spec, "fit_from": FIT_FROM, "tune_fit": TUNE_FIT,
            "tune_eval": TUNE_EVAL, "test_from": TEST_FROM, "info": info,
            "model": "KD_ad ~ Poisson(E_ad p_ad); log p_ad = log L730(t) + const + division + 5-round + title + f(defender) "
                     "+ g(attacker) + log u_d + log v_a; E = standing head strikes landed by a (midpoint of the ufcstats "
                     "bounds); u, v = Gamma(alpha, alpha) fighter chin / power effects with walk-forward posterior means "
                     "(alpha + KD) / (alpha + expected KD) over earlier fights",
            "exposure": "standing head landed = (max(HEAD - GROUND, 0) + min(HEAD, DISTANCE + CLINCH)) / 2 per fight",
            "reference_profile": ref,
        },
        "tuning_grid": grid, "tuning_diagnostics": tune_diag,
        "ladder_test": ladder_rows, "pairwise_test": pw,
        "coef_pre2024": coefs, "coef_live": coef_live, "coef_live_with_move": coef_live_move,
        "age_slopes_pre2024": slopes, "age_slopes_live": slopes_live,
        "age_slopes_no_fighter_effects": {"M2_age_only": slopes_m2, "M3_covariates": slopes_m3},
        "fighter_effect_calibration_slopes": eb_cal,
        "overdispersion_train": od,
        "calibration_test": cal,
        "within_fighter": {k: {kk: vv for kk, vv in v.items() if kk != "cov_cluster"} for k, v in wf.items()},
        "claims": {"age_league_poisson": claims, "win_size": wins},
        "ko_loss_model": {"models": ko_rows, "info": ko_info},
        "engine": {
            "level_now_trailing_730": round(level_now, 6), "level_now_trailing_365": round(level_365, 6),
            "terms_live": {n: round(float(b), 5) for n, b in zip(names_live, r_live["b"])},
            "norm_chin": round(norm_chin, 4), "norm_pow": round(norm_pow, 4), "norm_joint": round(norm_joint, 4),
            "alpha_chin": spec["alpha_c"], "alpha_pow": spec["alpha_p"],
        },
        "kd_level_series": series,
        "matchup_volkanovski_gaethje": mu_live,
        "roster": roster,
        "backtest": bt_mult,
    }
    with open(OUT_JSON, "w") as fh:
        json.dump(out, fh, separators=(",", ":"), default=lambda o: None if (isinstance(o, float) and not np.isfinite(o)) else o)
    print("wrote %s (%.1f MB) in %.0fs" % (OUT_JSON, os.path.getsize(OUT_JSON) / 1e6, time.time() - t0))
    for s_ in ("alexander-volkanovski", "justin-gaethje"):
        r = roster.get(s_)
        print(" ", s_, {k: r[k] for k in ("age", "kd_absorbed", "kd_absorbed_expected", "chin_re", "chin_re_q", "chin_cov",
                                         "chin_total_q", "kd_scored", "kd_scored_expected", "pow_re", "pow_re_q", "pow_cov",
                                         "pow_total_q")})
    print(" ", json.dumps(mu_live))


if __name__ == "__main__":
    main()
