#!/usr/bin/env python3
"""Mixture-of-experts stacker: the final win-probability layer (task key: moe).

Run from the project root (Python 3.13 + numpy/pandas/scipy/scikit-learn/lightgbm):

    python3 tools/moe.py prep         # walk-forward table 2010-2025 (2026+ dropped), priors_asof, Glicko,
                                      # layoffs, career counters -> out/moe_cache/prep.pkl + engine inputs
    node tools/moe_engine_bt.js       # engine expert: FightEngine.summarize on every backtest_dev fight,
                                      # both corner orders -> data/derived/moe_engine_bt.json
    python3 tools/moe.py experts      # internal experts (feature LR, feature GBM, Glicko) with strictly
                                      # out-of-fold predictions for 2019-2023 and <=2023-trained predictions
                                      # for 2024-2025 -> out/moe_cache/experts.pkl
    python3 tools/moe.py fit          # stackers (a) constrained logit-linear, (b) softmax-gated, (c) GBM
                                      # meta-learner + calibration; evaluation on 2024-2025; export
                                      # data/derived/moe.json (model + report numbers)
    python3 tools/moe.py all          # prep + experts + fit (the engine step must have been run)

Protocol (docs/BACKLOG.md): fights dated 2026-01-01 or later are dropped before anything is computed.
Train/tune = 2019-2023 (expert models also see 2010-2018 history as training data), validation =
2024-01-01..2025-12-31 for selection and reporting only. Every model is corner-symmetric: experts enter
as logits (antisymmetric under a corner swap), gating features are symmetric functions of the two sides,
nothing has an intercept, and GBMs are trained on mirrored rows and averaged over both orientations.

research/model_moe.md has the method, results and the page-integration recipe; src/ml/moe.js is the
dependency-free evaluator of the exported model.
"""
import argparse
import datetime as dt
import hashlib
import json
import math
import os
import pickle
import sys
import time
import warnings
from collections import Counter, defaultdict

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.dirname(HERE)
DERIVED = os.path.join(ROOT, "data", "derived")
CACHE = os.environ.get("MOE_CACHE", os.path.join(ROOT, "out", "moe_cache"))
VAULT_FROM = dt.date(2026, 1, 1)
HIST_FROM = dt.date(2010, 1, 1)          # snapshot entries used as expert-training history
TRAIN = ("2019-01-01", "2023-12-31")
VALID = ("2024-01-01", "2025-12-31")
ELO_K, ELO_BOOST = 44, 1.5               # data/derived/elo_report.json (chosen on 2019-2023)

DIVS = ["Flyweight", "Bantamweight", "Featherweight", "Lightweight", "Welterweight", "Middleweight",
        "Light Heavyweight", "Heavyweight", "Women's Strawweight", "Women's Flyweight",
        "Women's Bantamweight", "Women's Featherweight"]
DIV_GROUPS = {  # coarse groups for gating (few fights per division)
    "Flyweight": "light", "Bantamweight": "light", "Featherweight": "light",
    "Lightweight": "middle", "Welterweight": "middle", "Middleweight": "middle",
    "Light Heavyweight": "heavy", "Heavyweight": "heavy",
    "Women's Strawweight": "women", "Women's Flyweight": "women", "Women's Bantamweight": "women",
    "Women's Featherweight": "women"}


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def wjson(path, obj, indent=None):
    tmp = path + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(obj, fh, indent=indent, separators=None if indent else (",", ":"), allow_nan=False)
    os.replace(tmp, path)


# ====================================================================== prep
def glicko_pass(fights, rd0=200.0, c_day=1.6, rd_min=40.0, q=math.log(10) / 400, store=False):
    """Glicko-1, one rating period per fight. RD grows with inactivity: RD^2 + c_day^2 * days."""
    R = defaultdict(lambda: 1500.0)
    RD = {}
    last = {}
    pre = {}
    preds = []
    nf = Counter()
    for f in fights:
        a, b = f.persons
        if a == b:
            continue
        rds = []
        for p in (a, b):
            if p not in RD:
                r = rd0
            else:
                r = min(350.0, math.sqrt(RD[p] ** 2 + c_day ** 2 * max(0, f.day - last[p])))
            rds.append(r)
        ra, rb = R[a], R[b]
        # expected score of A including both uncertainties (Glicko's g of combined RD)
        gab = 1 / math.sqrt(1 + 3 * q * q * (rds[0] ** 2 + rds[1] ** 2) / math.pi ** 2)
        ea = 1 / (1 + 10 ** (-gab * (ra - rb) / 400))
        if store:
            pre[f.fid] = (ra, rb, rds[0], rds[1])
        if f.winner in ("A", "B") and nf[a] >= 1 and nf[b] >= 1:
            preds.append((f.date.year, ea, 1.0 if f.winner == "A" else 0.0))
        if f.winner in ("A", "B", "D"):
            s = {"A": 1.0, "B": 0.0, "D": 0.5}[f.winner]
            new = []
            for i, (p, r_self, r_opp, rd_self, rd_opp, sc) in enumerate(
                    ((a, ra, rb, rds[0], rds[1], s), (b, rb, ra, rds[1], rds[0], 1 - s))):
                g = 1 / math.sqrt(1 + 3 * q * q * rd_opp ** 2 / math.pi ** 2)
                e = 1 / (1 + 10 ** (-g * (r_self - r_opp) / 400))
                d2 = 1 / (q * q * g * g * e * (1 - e))
                denom = 1 / rd_self ** 2 + 1 / d2
                new.append((p, r_self + q / denom * g * (sc - e), max(rd_min, math.sqrt(1 / denom))))
            for p, r, rd in new:
                R[p], RD[p] = r, rd
        else:
            for p, rd in ((a, rds[0]), (b, rds[1])):
                RD[p] = rd
        last[a] = last[b] = f.day
        nf[a] += 1
        nf[b] += 1
    return R, RD, last, pre, preds


def ll_rows(rows):
    p = np.clip(np.array([r[1] for r in rows]), 1e-6, 1 - 1e-6)
    y = np.array([r[2] for r in rows])
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def cmd_prep(args):
    import build_db as B
    t0 = time.time()
    os.makedirs(CACHE, exist_ok=True)
    lg = {}
    fights, _ = B.parse_fights(lg)
    n_all = len(fights)
    fights = [f for f in fights if f.date < VAULT_FROM]          # hidden-data protocol: drop 2026+
    log("parsed %d fights, kept %d dated before %s (last %s)" % (n_all, len(fights), VAULT_FROM, fights[-1].date))
    people = B.build_people(fights, lg)
    B.build_vectors(fights, lg)
    _, elo_pre, _ = B.run_elo(fights, ELO_K, ELO_BOOST, store=True)

    # Glicko: tune (rd0, c_day) on 2012-2023 decisive fights (2024+ untouched)
    best = None
    for rd0 in (150, 200, 250, 300):
        for c in (0.8, 1.2, 1.6, 2.4, 3.2):
            *_, preds = glicko_pass(fights, rd0, c)
            ll = ll_rows([r for r in preds if 2012 <= r[0] <= 2023])
            if best is None or ll < best[0]:
                best = (ll, rd0, c)
    log("glicko tuned on 2012-2023: rd0=%s c_day=%s log loss %.4f" % (best[1], best[2], best[0]))
    gR, gRD, glast, gpre, gpreds = glicko_pass(fights, best[1], best[2], store=True)

    # career counters per person, walk-forward (state before each fight)
    cnt = defaultdict(lambda: {"last": None, "min": 0.0, "n": 0, "w": 0, "l": 0, "streak": 0, "res": [],
                               "n5": 0, "title": 0, "fin_w": 0, "fin_l": 0, "opp_elo": []})
    extra = {}
    for f in fights:
        a, b = f.persons
        if a == b:
            continue
        rec = {}
        for tag, p, opp in (("A", a, b), ("B", b, a)):
            c = cnt[p]
            rec[tag] = {"layoff": (f.day - c["last"]) if c["last"] is not None else None,
                        "cmin": c["min"], "cn": c["n"], "w": c["w"], "l": c["l"], "streak": c["streak"],
                        "last3": float(np.mean(c["res"][-3:])) if c["res"] else 0.5, "n5": c["n5"],
                        "titles": c["title"], "fin_w": c["fin_w"], "fin_l": c["fin_l"],
                        "opp_elo": float(np.mean(c["opp_elo"][-5:])) if c["opp_elo"] else None}
        extra[f.fid] = rec
        mins = (f.fight_s or 0) / 60.0
        for s, p in ((0, a), (1, b)):
            c = cnt[p]
            c["last"] = f.day
            c["min"] += mins
            c["n"] += 1
            if f.sched == 5:
                c["n5"] += 1
            if f.title:
                c["title"] += 1
            c["opp_elo"].append(elo_pre[f.fid][1 - s])
            won = f.winner == ("A" if s == 0 else "B")
            lost = f.winner == ("B" if s == 0 else "A")
            if won:
                c["w"] += 1
                c["streak"] = c["streak"] + 1 if c["streak"] > 0 else 1
                c["res"].append(1.0)
                if f.cat in ("ko", "sub"):
                    c["fin_w"] += 1
            elif lost:
                c["l"] += 1
                c["streak"] = c["streak"] - 1 if c["streak"] < 0 else -1
                c["res"].append(0.0)
                if f.cat in ("ko", "sub"):
                    c["fin_l"] += 1
            else:
                c["res"].append(0.5)

    # snapshot entries from 2010 (same format as backtest.json) for expert training history
    B.BACKTEST_FROM = HIST_FROM
    state, entries = B.walk(fights, people, elo_pre, 730.0)
    entries = [e for e in entries if e["date"] < VAULT_FROM.isoformat()]
    for e in entries:
        g = gpre[e["id"]]
        x = extra[e["id"]]
        for i, t in enumerate(("A", "B")):
            e[t]["glicko"] = g[i]
            e[t]["glicko_rd"] = g[2 + i]
            e[t].update(x[t])
    log("entries %d (%s..%s)" % (len(entries), entries[0]["date"], entries[-1]["date"]))

    # priors_asof for the engine expert (fights in the 5 years before Jan 1 of the entry's year)
    priors_asof = {}
    for y in range(2010, 2026):
        priors_asof[str(y)] = B.build_priors(fights, dt.date(y - 5, 1, 1), dt.date(y, 1, 1))
    wjson(os.path.join(CACHE, "priors_asof.json"), priors_asof)

    # roster table for live use: Glicko and counters as of the end of 2025 data (+ the live snapshot below)
    keys = B.KEYS
    with open(os.path.join(CACHE, "prep.pkl"), "wb") as fh:
        pickle.dump({"entries": entries, "keys": keys, "priors_asof": priors_asof,
                     "glicko": {"rd0": best[1], "c_day": best[2], "tune_ll": best[0]},
                     "built": dt.datetime.now(dt.timezone.utc).isoformat()}, fh)
    log("prep done in %.0fs -> %s" % (time.time() - t0, CACHE))


# ====================================================================== features (internal experts)
SIDE_NUM = ["age", "height_in", "reach_in", "n", "ko_losses", "kd_absorbed", "elo", "glicko", "glicko_rd",
            "cmin", "w", "l", "streak", "last3", "n5", "titles", "fin_w", "fin_l", "opp_elo", "layoff"]
RATE_DEFS = [  # name, numerator keys, prior-strength minutes
    ("slpm", ["d_lnd", "c_lnd", "g_lnd"], 20), ("sapm", ["od_lnd", "oc_lnd", "og_lnd"], 20),
    ("satt", ["d_att", "c_att", "g_att"], 20), ("oatt", ["od_att", "oc_att", "og_att"], 20),
    ("head", ["h_lnd"], 20), ("ohead", ["oh_lnd"], 20), ("body", ["b_lnd"], 20), ("leg", ["l_lnd"], 20),
    ("dist", ["d_lnd"], 20), ("clin", ["c_lnd"], 20), ("grnd", ["g_lnd"], 20), ("ogrnd", ["og_lnd"], 20),
    ("kd", ["kd"], 45), ("okd", ["okd"], 45), ("tdl", ["td_lnd"], 30), ("tda", ["td_att"], 30),
    ("otdl", ["otd_lnd"], 30), ("ctrl", ["ctrl"], 30), ("octrl", ["octrl"], 30), ("sub", ["sub_att"], 45),
    ("osub", ["osub_att"], 45), ("rev", ["rev"], 45)]
ACC_DEFS = [  # name, landed keys, attempted keys, prior attempts, invert (defence)
    ("acc", ["d_lnd", "c_lnd", "g_lnd"], ["d_att", "c_att", "g_att"], 80, False),
    ("dfn", ["od_lnd", "oc_lnd", "og_lnd"], ["od_att", "oc_att", "og_att"], 80, True),
    ("hacc", ["h_lnd"], ["h_att"], 60, False), ("hdfn", ["oh_lnd"], ["oh_att"], 60, True),
    ("tdacc", ["td_lnd"], ["td_att"], 8, False), ("tddef", ["otd_lnd"], ["otd_att"], 8, True)]
REC_DEFS = ["ko_w", "sub_w", "dec_w", "ko_l", "sub_l", "dec_l"]


def side_features(e, t, keys, priors_asof):
    s = e[t]
    S = dict(zip(keys, s["S"]))
    div = e.get("prior_division") or e["division"]
    yr = e["date"][:4]
    PA = priors_asof.get(yr) or priors_asof[max(priors_asof)]
    P = PA.get(div) or PA["ALL"]
    out = {}
    for k in SIDE_NUM:
        v = s.get(k)
        out[k] = float(v) if v is not None else np.nan
    out["layoff"] = math.log1p(min(out["layoff"], 2000.0)) if np.isfinite(out["layoff"]) else np.nan
    out["cmin"] = math.log1p(out["cmin"])
    out["n_log"] = math.log1p(out["n"])
    m = S["min"]
    out["dmin"] = math.log1p(m)
    out["dn"] = S["n"]
    for name, ks, k0 in RATE_DEFS:
        num = sum(S[k] for k in ks)
        pr = sum(P.get(k, 0.0) for k in ks)
        out[name] = (num + k0 * pr) / (m + k0)
    for name, ls, as_, k0, inv in ACC_DEFS:
        lnd, att = sum(S[k] for k in ls), sum(S[k] for k in as_)
        pl, pa = sum(P.get(k, 0.0) for k in ls), sum(P.get(k, 0.0) for k in as_)
        pr = pl / pa if pa > 0 else 0.4
        a = (lnd + k0 * pr) / (att + k0)
        out[name] = 1 - a if inv else a
    nf = S["n"]
    wins = S["ko_w"] + S["sub_w"] + S["dec_w"]
    out["winr"] = (wins + 1.0) / (nf + 2.0)
    for k in REC_DEFS:
        out[k + "_r"] = (S[k] + 0.25) / (nf + 1.5)
    out["wl_c"] = (out["w"] + 1.0) / (out["w"] + out["l"] + 2.0)
    out["fin_wr"] = (out["fin_w"] + 0.5) / (out["w"] + out["l"] + 2.0)
    out["fin_lr"] = (out["fin_l"] + 0.5) / (out["w"] + out["l"] + 2.0)
    out["diff_sl"] = out["slpm"] - out["sapm"]
    st = s.get("stance") or ""
    out["southpaw"] = 1.0 if st == "Southpaw" else 0.0
    out["switch"] = 1.0 if st == "Switch" else 0.0
    return out


def build_table(entries, keys, priors_asof):
    """Rows for decisive fights: side features A, B, context, label y = 1 if A won."""
    rows = []
    for e in entries:
        w = e["result"]["winner"]
        fa = side_features(e, "A", keys, priors_asof)
        fb = side_features(e, "B", keys, priors_asof)
        rows.append({"id": e["id"], "date": e["date"], "division": e["division"],
                     "prior_division": e.get("prior_division"), "rounds": e["rounds"] or 3,
                     "title": bool(e["title"]), "y": 1.0 if w == "A" else (0.0 if w == "B" else np.nan),
                     "A": fa, "B": fb})
    return rows


FEAT_NAMES = None


def mats(rows):
    """Side matrices XA, XB (same column order) and symmetric context C."""
    global FEAT_NAMES
    if FEAT_NAMES is None:
        FEAT_NAMES = list(rows[0]["A"].keys())
    XA = np.array([[r["A"][k] for k in FEAT_NAMES] for r in rows], dtype=float)
    XB = np.array([[r["B"][k] for k in FEAT_NAMES] for r in rows], dtype=float)
    C = np.array([[1.0 if r["rounds"] == 5 else 0.0, 1.0 if r["title"] else 0.0,
                   1.0 if "Women" in (r["prior_division"] or r["division"]) else 0.0,
                   float(DIVS.index(r["prior_division"] or r["division"])) if (r["prior_division"] or r["division"]) in DIVS else -1.0]
                  for r in rows])
    return XA, XB, C


def logit(p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


def sigm(z):
    return 1 / (1 + np.exp(-z))


def ll(p, y):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


class SymLR:
    """L2 logistic regression on antisymmetric differences (A - B), no intercept: exactly corner-symmetric."""
    def __init__(self, C=0.05):
        self.C = C

    def _d(self, XA, XB):
        D = XA - XB
        D = np.where(np.isfinite(D), D, 0.0)
        return D

    def fit(self, XA, XB, y):
        from sklearn.linear_model import LogisticRegression
        D = self._d(XA, XB)
        self.sd = D.std(0) + 1e-9          # scale only (no centring: keeps the antisymmetry)
        Z = D / self.sd
        Z = np.vstack([Z, -Z])
        yy = np.concatenate([y, 1 - y])
        self.m = LogisticRegression(C=self.C, fit_intercept=False, max_iter=2000).fit(Z, yy)
        self.coef = self.m.coef_[0] / self.sd
        return self

    def predict(self, XA, XB):
        return sigm(self._d(XA, XB) @ self.coef)


class SymGBM:
    """LightGBM on mirrored rows (side A, side B, differences, symmetric context), averaged over both orders."""
    def __init__(self, params=None, rounds=300):
        self.params = dict(objective="binary", learning_rate=0.03, num_leaves=15, min_data_in_leaf=60,
                           feature_fraction=0.6, bagging_fraction=0.8, bagging_freq=1, lambda_l2=5.0,
                           verbose=-1, num_threads=2, seed=7)
        if params:
            self.params.update(params)
        self.rounds = rounds

    @staticmethod
    def _x(XA, XB, C):
        return np.hstack([XA, XB, XA - XB, C])

    def fit(self, XA, XB, C, y, valid=None):
        import lightgbm as lgb
        X = np.vstack([self._x(XA, XB, C), self._x(XB, XA, C)])
        yy = np.concatenate([y, 1 - y])
        ds = lgb.Dataset(X, yy)
        if valid is not None:
            vA, vB, vC, vy = valid
            Xv = np.vstack([self._x(vA, vB, vC), self._x(vB, vA, vC)])
            dv = lgb.Dataset(Xv, np.concatenate([vy, 1 - vy]), reference=ds)
            ev = {}
            self.m = lgb.train(self.params, ds, self.rounds, valid_sets=[dv],
                               callbacks=[lgb.record_evaluation(ev)])
            self.curve = ev["valid_0"]["binary_logloss"]
        else:
            self.m = lgb.train(self.params, ds, self.rounds)
        return self

    def predict(self, XA, XB, C, rounds=None):
        p1 = self.m.predict(self._x(XA, XB, C), num_iteration=rounds)
        p2 = self.m.predict(self._x(XB, XA, C), num_iteration=rounds)
        return 0.5 * (p1 + 1 - p2)


def elo_p(XA, XB):
    i = FEAT_NAMES.index("elo")
    return 1 / (1 + 10 ** (-(XA[:, i] - XB[:, i]) / 400))


def glicko_p(rows):
    q = math.log(10) / 400
    out = []
    for r in rows:
        a, b = r["A"], r["B"]
        g = 1 / math.sqrt(1 + 3 * q * q * (a["glicko_rd"] ** 2 + b["glicko_rd"] ** 2) / math.pi ** 2)
        out.append(1 / (1 + 10 ** (-g * (a["glicko"] - b["glicko"]) / 400)))
    return np.array(out)


def cmd_experts(args):
    t0 = time.time()
    with open(os.path.join(CACHE, "prep.pkl"), "rb") as fh:
        prep = pickle.load(fh)
    entries = [e for e in prep["entries"] if e["date"] < VAULT_FROM.isoformat()]
    rows = build_table(entries, prep["keys"], prep["priors_asof"])
    XA, XB, C = mats(rows)
    y = np.array([r["y"] for r in rows])
    dates = np.array([r["date"] for r in rows])
    yr = np.array([int(d[:4]) for d in dates])
    dec = np.isfinite(y)
    log("table: %d rows, %d decisive, %d features per side" % (len(rows), dec.sum(), XA.shape[1]))

    # ---- hyper-parameters chosen on 2016-2018 (train < 2016 .. validate year by year), never on 2019+
    def inner_eval(make, years=(2016, 2017, 2018)):
        tot, n = 0.0, 0
        for Y in years:
            tr = dec & (yr < Y)
            va = dec & (yr == Y)
            p = make(tr, va)
            tot += ll(p, y[va]) * va.sum()
            n += va.sum()
        return tot / n

    lr_grid = {}
    for Cv in (0.003, 0.01, 0.03, 0.1, 0.3):
        lr_grid[Cv] = inner_eval(lambda tr, va: SymLR(Cv).fit(XA[tr], XB[tr], y[tr]).predict(XA[va], XB[va]))
    C_best = min(lr_grid, key=lr_grid.get)
    log("LR C grid (2016-2018 inner):", {k: round(v, 4) for k, v in lr_grid.items()}, "->", C_best)

    # GBM: rounds and leaves on the same inner years (one fit per year with a validation curve)
    gbm_grid = {}
    for leaves, mdl in ((7, 80), (15, 60), (31, 100)):
        curves = []
        wts = []
        for Y in (2016, 2017, 2018):
            tr = dec & (yr < Y)
            va = dec & (yr == Y)
            g = SymGBM({"num_leaves": leaves, "min_data_in_leaf": mdl}, rounds=800 if not args.quick else 300)
            g.fit(XA[tr], XB[tr], C[tr], y[tr], valid=(XA[va], XB[va], C[va], y[va]))
            curves.append(np.array(g.curve))
            wts.append(va.sum())
        curve = np.average(np.vstack(curves), axis=0, weights=wts)
        r = int(np.argmin(curve)) + 1
        gbm_grid[leaves] = (float(curve[r - 1]), r, mdl)
    leaves = min(gbm_grid, key=lambda k: gbm_grid[k][0])
    g_ll, g_rounds, g_mdl = gbm_grid[leaves]
    g_rounds = max(100, g_rounds)
    log("GBM grid (2016-2018 inner; mirrored-curve min):", gbm_grid, "->", leaves, g_rounds)

    # ---- strictly out-of-fold predictions: expanding window by year for 2019-2023, <=2023 model for 2024-25
    pred = {k: np.full(len(rows), np.nan) for k in ("feat_lr", "feat_gbm")}
    folds = [(Y, yr == Y) for Y in range(2019, 2024)] + [(2024, (yr == 2024) | (yr == 2025))]
    lr_coefs = {}
    for Y, te in folds:
        tr = dec & (yr < Y)
        lr = SymLR(C_best).fit(XA[tr], XB[tr], y[tr])
        pred["feat_lr"][te] = lr.predict(XA[te], XB[te])
        lr_coefs[Y] = lr.coef.tolist()
        g = SymGBM({"num_leaves": leaves, "min_data_in_leaf": g_mdl}, rounds=g_rounds).fit(XA[tr], XB[tr], C[tr], y[tr])
        pred["feat_gbm"][te] = g.predict(XA[te], XB[te], C[te])
        log("fold %d: train %d -> predict %d" % (Y, tr.sum(), te.sum()))
    pred["elo"] = elo_p(XA, XB)
    pred["glicko"] = glicko_p(rows)

    keep = dates >= TRAIN[0]
    out = {"ids": [r["id"] for r, k in zip(rows, keep) if k], "dates": dates[keep].tolist(), "y": y[keep],
           "pred": {k: v[keep] for k, v in pred.items()}, "rows": [r for r, k in zip(rows, keep) if k],
           "feat_names": FEAT_NAMES, "lr_C": C_best, "lr_grid": lr_grid, "gbm": {"leaves": leaves, "rounds": g_rounds,
           "min_data_in_leaf": g_mdl, "grid": {str(k): v for k, v in gbm_grid.items()}},
           "lr_coefs": lr_coefs, "glicko": prep["glicko"]}
    # production fits on everything before 2026 (for live use / export)
    tr = dec
    lr_all = SymLR(C_best).fit(XA[tr], XB[tr], y[tr])
    out["lr_all"] = {"coef": lr_all.coef.tolist(), "names": FEAT_NAMES}
    with open(os.path.join(CACHE, "experts.pkl"), "wb") as fh:
        pickle.dump(out, fh)
    m = keep & dec
    for k, v in pred.items():
        for lab, sel in (("2019-23", m & (yr <= 2023)), ("2024-25", m & (yr >= 2024))):
            print("  %-9s %s  n=%4d  log loss %.4f" % (k, lab, sel.sum(), ll(v[sel], y[sel])))
    log("experts done in %.0fs" % (time.time() - t0))


# ====================================================================== main
def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("cmd", choices=["prep", "experts", "fit", "all"])
    ap.add_argument("--quick", action="store_true")
    args = ap.parse_args()
    warnings.filterwarnings("ignore")
    if args.cmd in ("prep", "all"):
        cmd_prep(args)
    if args.cmd in ("experts", "all"):
        cmd_experts(args)
    if args.cmd in ("fit", "all"):
        cmd_fit(args)


if __name__ == "__main__":
    main()
