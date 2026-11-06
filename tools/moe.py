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


# ====================================================================== stacking: inputs
PCLIP = 0.01                     # expert probabilities are clipped to [PCLIP, 1 - PCLIP] before the logit
GATE_NAMES = ["nmin", "nmax", "cmin_min", "elogap", "five", "women", "light", "heavy", "layoff_max",
              "age_mean", "age_gap", "preufc"]


def load_json(name):
    p = os.path.join(DERIVED, name)
    if not os.path.exists(p):
        return None
    try:
        with open(p) as fh:
            return json.load(fh)
    except Exception as ex:          # another agent may be mid-write
        log("could not read %s: %s" % (name, ex))
        return None


def ext_prob(v):
    """Pull P(A wins) out of an external per-fight record (layouts differ between tools)."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, dict):
        for k in ("p_oof", "oof", "p_stack_oof", "pA_oof", "p", "pA", "p_A", "p_win", "prob", "p_a"):
            x = v.get(k)
            if isinstance(x, (int, float)) and 0 <= x <= 1:
                return float(x)
    return None


def external_experts(ids):
    """Per-fight probabilities from other analysts' outputs when they exist (strictly out-of-fold for 2019-2023
    is their contract; see research/model_moe.md for the recipe to plug a new one in)."""
    out, notes = {}, {}
    for key, files in (("ml", ["ml.json"]), ("ratings", ["ratings.json"]), ("methodround", ["methodround.json"]),
                       ("oppadj", ["oppadj.json"])):
        for fn in files:
            d = load_json(fn)
            if not d:
                continue
            table = None
            for k in ("fights", "backtest", "predictions", "per_fight", "oof"):
                if isinstance(d.get(k), dict):
                    table = d[k]
                    break
            if table is None:
                notes[key] = "%s present but no per-fight table recognised" % fn
                continue
            arr = np.array([ext_prob(table.get(i)) if ext_prob(table.get(i)) is not None else np.nan for i in ids])
            cov = float(np.isfinite(arr).mean())
            notes[key] = "%s: coverage %.3f" % (fn, cov)
            if cov > 0.5:
                out[key] = arr
    return out, notes


def gating_matrix(rows, preufc):
    snaps = set()
    if preufc:
        for f in preufc.get("fighters", {}).values():
            for s in f.get("snapshots") or []:
                if s and len(s) > 3 and s[3]:            # n pro fights before the UFC bout > 0
                    snaps.add((f.get("ufc_id"), s[1]))
    G = []
    for r in rows:
        a, b = r["A"], r["B"]
        div = r["prior_division"] or r["division"]
        grp = DIV_GROUPS.get(div, "middle")
        lay = [x if np.isfinite(x) else math.log1p(365) for x in (a["layoff"], b["layoff"])]
        ages = [x if np.isfinite(x) else 30.0 for x in (a["age"], b["age"])]
        pu = 0.0
        if snaps:
            pu = 0.5 * ((r.get("uidA"), r["id"]) in snaps) + 0.5 * ((r.get("uidB"), r["id"]) in snaps)
        G.append([math.log1p(min(a["n"], b["n"])), math.log1p(max(a["n"], b["n"])), min(a["cmin"], b["cmin"]),
                  abs(a["elo"] - b["elo"]) / 100.0, 1.0 if r["rounds"] == 5 else 0.0,
                  1.0 if grp == "women" else 0.0, 1.0 if grp == "light" else 0.0, 1.0 if grp == "heavy" else 0.0,
                  max(lay), (ages[0] + ages[1]) / 2 - 30.0, abs(ages[0] - ages[1]), pu])
    return np.array(G, dtype=float)


# ====================================================================== stacking: models
def _nll(z, y, w):
    # stable log loss on logits
    return float(np.sum(w * (np.logaddexp(0, z) - y * z)))


class LinStack:
    """(a) p = sigmoid(sum_k w_k * logit(p_k)), w_k >= 0, no intercept (corner-symmetric by construction)."""
    def __init__(self, l2=0.0):
        self.l2 = l2

    def fit(self, L, y, w=None):
        from scipy.optimize import minimize
        w = np.ones(len(y)) if w is None else w
        K = L.shape[1]

        def f(b):
            z = L @ b
            r = sigm(z) - y
            return _nll(z, y, w) + self.l2 * np.sum(b ** 2), L.T @ (w * r) + 2 * self.l2 * b
        res = minimize(f, np.full(K, 1.0 / K), jac=True, method="L-BFGS-B", bounds=[(0, None)] * K)
        self.w = res.x
        return self

    def logit(self, L):
        return L @ self.w

    def predict(self, L):
        return sigm(self.logit(L))


class GatedStack:
    """(b) mixture of experts in logit space: z = exp(u.g) * sum_k pi_k(g) * logit(p_k), with
    pi = softmax(V g) over the experts that are present (mask). g is symmetric in the corners (bias first),
    logit(p_k) antisymmetric, so z is antisymmetric: no intercept, exactly corner-symmetric."""
    def __init__(self, lam=1.0, lam_u=None):
        self.lam = lam
        self.lam_u = lam if lam_u is None else lam_u

    def _fwd(self, th, L, M, G):
        K, D = L.shape[1], G.shape[1]
        V = th[:K * D].reshape(K, D)
        u = th[K * D:]
        A = G @ V.T
        A = np.where(M, A, -np.inf)
        A = A - A.max(1, keepdims=True)
        E = np.where(M, np.exp(A), 0.0)
        PI = E / E.sum(1, keepdims=True)
        Lm = np.where(M, L, 0.0)
        h = (PI * Lm).sum(1)
        s = np.exp(np.clip(G @ u, -5, 5))
        return V, u, PI, Lm, h, s

    def fit(self, L, M, G, y, w=None):
        from scipy.optimize import minimize
        w = np.ones(len(y)) if w is None else w
        K, D = L.shape[1], G.shape[1]
        n = w.sum()

        def f(th):
            V, u, PI, Lm, h, s = self._fwd(th, L, M, G)
            z = s * h
            r = w * (sigm(z) - y)
            gu = G.T @ (r * s * h)
            dA = (r * s)[:, None] * PI * (Lm - h[:, None])          # n x K
            gV = dA.T @ G                                          # K x D
            pen_V = V.copy()
            pen_V[:, 0] = 0.0                                      # bias column unpenalised
            pen_u = u.copy()
            pen_u[0] = 0.0
            loss = _nll(z, y, w) + n * (self.lam * np.sum(pen_V ** 2) + self.lam_u * np.sum(pen_u ** 2))
            grad = np.concatenate([(gV + 2 * n * self.lam * pen_V).ravel(), gu + 2 * n * self.lam_u * pen_u])
            return loss, grad
        th0 = np.zeros(K * D + D)
        res = minimize(f, th0, jac=True, method="L-BFGS-B", options={"maxiter": 3000})
        self.th, self.K, self.D = res.x, K, D
        self.V = res.x[:K * D].reshape(K, D)
        self.u = res.x[K * D:]
        return self

    def logit(self, L, M, G):
        _, _, PI, _, h, s = self._fwd(self.th, L, M, G)
        self.last_pi, self.last_s = PI, s
        return s * h

    def predict(self, L, M, G):
        return sigm(self.logit(L, M, G))


class GBMStack:
    """(c) LightGBM meta-learner on expert logits (NaN = absent) + gating features, mirrored rows, averaged
    over both corner orders; optional base margin from a linear stack (boost the residual)."""
    def __init__(self, leaves=4, rounds=200, lr=0.03, mdl=80):
        self.params = dict(objective="binary", learning_rate=lr, num_leaves=leaves, min_data_in_leaf=mdl,
                           feature_fraction=0.8, bagging_fraction=0.8, bagging_freq=1, lambda_l2=10.0,
                           verbose=-1, num_threads=2, seed=11)
        self.rounds = rounds

    @staticmethod
    def _x(L, M, G, sign=1.0):
        return np.hstack([np.where(M, sign * L, np.nan), G])

    def fit(self, L, M, G, y, base=None, w=None, valid=None):
        import lightgbm as lgb
        X = np.vstack([self._x(L, M, G), self._x(L, M, G, -1.0)])
        yy = np.concatenate([y, 1 - y])
        ww = None if w is None else np.concatenate([w, w])
        init = None if base is None else np.concatenate([base, -base])
        ds = lgb.Dataset(X, yy, weight=ww, init_score=init)
        if valid is not None:
            vL, vM, vG, vy, vb = valid
            Xv = np.vstack([self._x(vL, vM, vG), self._x(vL, vM, vG, -1.0)])
            dv = lgb.Dataset(Xv, np.concatenate([vy, 1 - vy]), reference=ds,
                             init_score=None if vb is None else np.concatenate([vb, -vb]))
            ev = {}
            self.m = lgb.train(self.params, ds, self.rounds, valid_sets=[dv], callbacks=[lgb.record_evaluation(ev)])
            self.curve = ev["valid_0"]["binary_logloss"]
        else:
            self.m = lgb.train(self.params, ds, self.rounds)
        return self

    def logit(self, L, M, G, base=None, rounds=None):
        f1 = self.m.predict(self._x(L, M, G), num_iteration=rounds, raw_score=True)
        f2 = self.m.predict(self._x(L, M, G, -1.0), num_iteration=rounds, raw_score=True)
        z = 0.5 * (f1 - f2)
        return z if base is None else z + base

    def predict(self, L, M, G, base=None, rounds=None):
        return sigm(self.logit(L, M, G, base, rounds))


# ---- symmetric calibration
class Calib:
    """none | temperature (symmetric beta calibration: a = b, c = 0) | isotonic fit on mirrored data,
    symmetrised c(p) = (c(p) + 1 - c(1 - p)) / 2."""
    def __init__(self, kind):
        self.kind = kind

    def fit(self, z, y):
        if self.kind == "temperature":
            from scipy.optimize import minimize_scalar
            self.a = minimize_scalar(lambda a: _nll(a * z, y, 1.0), bounds=(0.3, 3.0), method="bounded").x
        elif self.kind == "isotonic":
            from sklearn.isotonic import IsotonicRegression
            p = sigm(z)
            ir = IsotonicRegression(y_min=0.005, y_max=0.995, out_of_bounds="clip")
            ir.fit(np.concatenate([p, 1 - p]), np.concatenate([y, 1 - y]))
            grid = np.linspace(0, 1, 201)
            c = ir.predict(grid)
            c = 0.5 * (c + 1 - c[::-1])                       # exact symmetry on the grid
            self.x, self.y = grid, np.maximum.accumulate(c)
        return self

    def __call__(self, p):
        if self.kind == "none":
            return p
        if self.kind == "temperature":
            return sigm(self.a * logit(p))
        return np.interp(p, self.x, self.y)

    def export(self):
        if self.kind == "temperature":
            return {"type": "temperature", "a": float(self.a)}
        if self.kind == "isotonic":
            return {"type": "isotonic", "x": [round(float(v), 4) for v in self.x],
                    "y": [round(float(v), 6) for v in self.y]}
        return {"type": "none"}


# ====================================================================== metrics
def metrics(p, y):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    acc = np.where(np.abs(p - 0.5) < 1e-12, 0.5, ((p > 0.5) == (y > 0.5)).astype(float))
    # ECE on mirrored predictions (both corner orders), 10 equal-width bins
    pm, ym = np.concatenate([p, 1 - p]), np.concatenate([y, 1 - y])
    bins = np.minimum((pm * 10).astype(int), 9)
    ece = sum(abs(pm[bins == b].mean() - ym[bins == b].mean()) * (bins == b).mean() for b in range(10) if (bins == b).any())
    return {"n": int(len(y)), "log_loss": ll(p, y), "brier": float(np.mean((p - y) ** 2)),
            "accuracy": float(acc.mean()), "ece": float(ece)}


def calib_table(p, y, nb=10):
    pm, ym = np.concatenate([p, 1 - p]), np.concatenate([y, 1 - y])
    bins = np.minimum((pm * nb).astype(int), nb - 1)
    out = []
    for b in range(nb // 2, nb):                 # mirrored: the upper half carries all the information
        s = bins == b
        if s.sum():
            out.append({"lo": b / nb, "hi": (b + 1) / nb, "n": int(s.sum()), "pred": round(float(pm[s].mean()), 4),
                        "obs": round(float(ym[s].mean()), 4)})
    return out


def boot_ci(preds, y, clusters, ref=None, B=2000, seed=3):
    """Cluster (event-date) bootstrap of log loss; with ref, of the paired difference model - ref."""
    rng = np.random.default_rng(seed)
    uc, inv = np.unique(clusters, return_inverse=True)
    p = np.clip(preds, 1e-6, 1 - 1e-6)
    li = -(y * np.log(p) + (1 - y) * np.log(1 - p))
    if ref is not None:
        r = np.clip(ref, 1e-6, 1 - 1e-6)
        li = li + (y * np.log(r) + (1 - y) * np.log(1 - r))
    S = np.bincount(inv, weights=li, minlength=len(uc))
    N = np.bincount(inv, minlength=len(uc)).astype(float)
    vals = []
    for _ in range(B):
        k = rng.integers(0, len(uc), len(uc))
        c = np.bincount(k, minlength=len(uc))
        vals.append((c * S).sum() / (c * N).sum())
    lo, hi = np.percentile(vals, [2.5, 97.5])
    return {"est": float(li.mean()), "lo": float(lo), "hi": float(hi),
            "p_gt0": float(np.mean(np.array(vals) > 0)) if ref is not None else None}


# ====================================================================== fit + evaluate
def years_of(dates):
    return np.array([int(d[:4]) for d in dates])


class Stacker:
    """One stacking method over a fixed expert list, trained with expert-dropout augmentation so that it can
    be evaluated with any subset present (the page may lack the market line or the engine)."""
    def __init__(self, method, experts, drops, hp=None):
        self.method, self.experts, self.drops, self.hp = method, list(experts), drops, dict(hp or {})

    def _aug(self, L, M, G, y):
        Ls, Ms, Gs, ys = [], [], [], []
        for d in self.drops:
            keep = np.array([e not in d for e in self.experts])
            Mm = M & keep[None, :]
            ok = Mm.any(1)
            Ls.append(L[ok]); Ms.append(Mm[ok]); Gs.append(G[ok]); ys.append(y[ok])
        return np.vstack(Ls), np.vstack(Ms), np.vstack(Gs), np.concatenate(ys)

    def fit(self, L, M, G, y):
        if self.method == "linear":
            self.lin = {}
            for d in self.drops:                     # one weight vector per availability pattern
                pat = frozenset(e for e in self.experts if e not in d)
                self._fit_pat(pat, L, M, y)
        elif self.method == "gated":
            La, Ma, Ga, ya = self._aug(L, M, G, y)
            self.g = GatedStack(self.hp.get("lam", 1e-3)).fit(La, Ma, Ga, ya)
        elif self.method in ("gbm", "gbm_res"):
            La, Ma, Ga, ya = self._aug(L, M, G, y)
            base = None
            if self.method == "gbm_res":
                self.lin = {}
                base = self._lin_logit(La, Ma, L, M, y)
            self.b = GBMStack(self.hp.get("leaves", 4), self.hp.get("rounds", 200), self.hp.get("lr", 0.03),
                              self.hp.get("mdl", 80)).fit(La, Ma, Ga[:, 1:], ya, base=base)
        return self

    def _fit_pat(self, pat, L, M, y):
        idx = [self.experts.index(e) for e in self.experts if e in pat]
        ok = M[:, idx].all(1)
        self.lin[pat] = (idx, LinStack().fit(L[ok][:, idx], y[ok]))

    def _lin_logit(self, Lq, Mq, Ltr=None, Mtr=None, ytr=None):
        z = np.zeros(len(Lq))
        for i in range(len(Lq)):
            pat = frozenset(e for e, m in zip(self.experts, Mq[i]) if m)
            if pat not in self.lin:
                if Ltr is None:
                    raise KeyError("pattern %s not fitted" % sorted(pat))
                self._fit_pat(pat, Ltr, Mtr, ytr)
            idx, m = self.lin[pat]
            z[i] = Lq[i, idx] @ m.w
        return z

    def logit(self, L, M, G):
        if self.method == "linear":
            return self._lin_logit(L, M)
        if self.method == "gated":
            return self.g.logit(L, M, G)
        base = self._lin_logit(L, M) if self.method == "gbm_res" else None
        return self.b.logit(L, M, G[:, 1:], base=base)


def cmd_fit(args):
    t0 = time.time()
    with open(os.path.join(CACHE, "experts.pkl"), "rb") as fh:
        E = pickle.load(fh)
    global FEAT_NAMES
    FEAT_NAMES = E["feat_names"]
    bt = load_json("backtest_dev.json")
    btmap = {f["id"]: f for f in bt["fights"] if f["date"] < VAULT_FROM.isoformat()}
    sel = [i for i, fid in enumerate(E["ids"]) if fid in btmap]
    ids = [E["ids"][i] for i in sel]
    rows = [E["rows"][i] for i in sel]
    y = E["y"][sel]
    dates = np.array([E["dates"][i] for i in sel])
    yr = years_of(dates)
    for r in rows:
        f = btmap[r["id"]]
        r["slugA"], r["slugB"], r["event"] = f["A"]["slug"], f["B"]["slug"], f["event"]
    log("rows %d (backtest_dev %d)" % (len(rows), len(btmap)))

    # ---- experts
    P = {k: E["pred"][k][sel] for k in E["pred"]}
    eng = load_json("moe_engine_bt.json")
    P["engine"] = np.array([(lambda e: e["pA"] / max(1e-9, e["pA"] + e["pB"]) if e and "pA" in e else np.nan)
                            (eng["fights"].get(i)) for i in ids])
    mk = load_json("market.json")
    mf = mk["fights"] if mk else {}
    P["market"] = np.array([(mf.get(i) or {}).get("p_power_close") or (mf.get(i) or {}).get("p_novig_close") or np.nan
                            for i in ids], dtype=float)
    P["market_open"] = np.array([(mf.get(i) or {}).get("p_novig_open") or np.nan for i in ids], dtype=float)
    ext, ext_notes = external_experts(ids)
    P.update(ext)
    log("external experts:", ext_notes or "none found")

    pre = load_json("preufc.json")
    snaps = set()
    if pre:
        for slug, f in pre.get("fighters", {}).items():
            for s in f.get("snapshots") or []:
                if s and len(s) > 3 and s[3]:
                    snaps.add((slug, s[1]))
    G = gating_matrix(rows, None)
    G[:, GATE_NAMES.index("preufc")] = [0.5 * ((r["slugA"], r["id"]) in snaps) + 0.5 * ((r["slugB"], r["id"]) in snaps)
                                        for r in rows]
    dec = np.isfinite(y)
    TR = dec & (dates >= TRAIN[0]) & (dates <= TRAIN[1])
    VA = dec & (dates >= VALID[0]) & (dates <= VALID[1])
    mu, sd = G[TR].mean(0), G[TR].std(0) + 1e-9
    Gs = np.hstack([np.ones((len(G), 1)), (G - mu) / sd])

    singles = {}
    for k, v in P.items():
        ok = np.isfinite(v)
        singles[k] = {"train": metrics(v[TR & ok], y[TR & ok]), "valid": metrics(v[VA & ok], y[VA & ok]),
                      "coverage_valid": float(ok[VA].mean())}
        log("single %-12s train ll %.4f (n=%d)  valid ll %.4f (n=%d)" % (
            k, singles[k]["train"]["log_loss"], singles[k]["train"]["n"], singles[k]["valid"]["log_loss"],
            singles[k]["valid"]["n"]))

    ml_key = "ml" if "ml" in P else "feat_lr"
    SETS = {
        "page": ["market", "engine", ml_key, "elo"],
        "full": [k for k in ["market", "engine", "ml", "ratings", "feat_lr", "feat_gbm", "elo", "glicko"] if k in P],
    }
    DROPS = [set(), {"market"}, {"engine"}, {"market", "engine"}]

    def LM(experts, mask=None):
        L = np.column_stack([logit(np.clip(P[k], PCLIP, 1 - PCLIP)) for k in experts])
        M = np.column_stack([np.isfinite(P[k]) for k in experts])
        L = np.where(M, L, 0.0)
        return L, M

    def apply_drop(M, experts, d):
        keep = np.array([e not in d for e in experts])
        return M & keep[None, :]

    # ---- forward-chaining CV inside 2019-2023: hyper-parameters + out-of-fold stacker logits for calibration
    def cv(method, experts, hp, val_years=(2021, 2022, 2023), drops=DROPS):
        L, M = LM(experts)
        oof = {tuple(sorted(d)): np.full(len(y), np.nan) for d in drops}
        for Y in val_years:
            tr = dec & (yr < Y) & (yr >= 2019)
            te = dec & (yr == Y)
            st = Stacker(method, experts, drops, hp).fit(L[tr], M[tr], Gs[tr], y[tr])
            for d in drops:
                Md = apply_drop(M[te], experts, d)
                ok = Md.any(1)
                z = np.full(te.sum(), np.nan)
                z[ok] = st.logit(L[te][ok], Md[ok], Gs[te][ok])
                oof[tuple(sorted(d))][np.where(te)[0]] = z
        return oof

    def cv_score(oof, mask):
        tot = 0.0
        for d, z in oof.items():
            ok = mask & np.isfinite(z)
            tot += _nll(z[ok], y[ok], 1.0) / ok.sum()
        return tot / len(oof)

    cvmask = dec & (yr >= 2021) & (yr <= 2023)
    results = {}
    for set_name, experts in SETS.items():
        log("=== expert set %s: %s" % (set_name, experts))
        cand = {}
        cand[("linear", ())] = cv("linear", experts, {})
        for lam in ([1e-4, 1e-3, 1e-2] if not args.quick else [1e-3]):
            cand[("gated", (("lam", lam),))] = cv("gated", experts, {"lam": lam})
        for leaves, rounds in ([(3, 150), (3, 300), (7, 150)] if not args.quick else [(3, 150)]):
            cand[("gbm", (("leaves", leaves), ("rounds", rounds)))] = cv("gbm", experts, {"leaves": leaves, "rounds": rounds})
            cand[("gbm_res", (("leaves", leaves), ("rounds", rounds // 3)))] = cv(
                "gbm_res", experts, {"leaves": leaves, "rounds": rounds // 3})
        scores = {k: cv_score(v, cvmask) for k, v in cand.items()}
        for k, v in sorted(scores.items(), key=lambda kv: kv[1]):
            log("  cv %-8s %-28s %.4f" % (k[0], dict(k[1]), v))
        best_by_method = {}
        for (m, hp), s in scores.items():
            if m not in best_by_method or s < scores[(m, best_by_method[m])]:
                best_by_method[m] = hp
        L, M = LM(experts)
        res = {"experts": experts, "cv": {"%s %s" % (k[0], dict(k[1])): v for k, v in scores.items()}, "methods": {}}
        for m, hp in best_by_method.items():
            oof = cand[(m, hp)]
            # calibration chosen on the forward-chained out-of-fold logits (2021-2023), all drop patterns pooled
            zc = np.concatenate([oof[k][cvmask & np.isfinite(oof[k])] for k in oof])
            yc = np.concatenate([y[cvmask & np.isfinite(oof[k])] for k in oof])
            cal_scores = {}
            cals = {}
            for kind in ("none", "temperature", "isotonic"):
                # nested: fit on 2021-2022 OOF, score on 2023 OOF, to choose the kind without touching 2024+
                fit_m = np.concatenate([(yr[cvmask & np.isfinite(oof[k])] <= 2022) for k in oof])
                c = Calib(kind).fit(zc[fit_m], yc[fit_m])
                cal_scores[kind] = ll(c(sigm(zc[~fit_m])), yc[~fit_m])
                cals[kind] = Calib(kind).fit(zc, yc)
            kind = min(cal_scores, key=cal_scores.get)
            st = Stacker(m, experts, DROPS, dict(hp)).fit(L[TR], M[TR], Gs[TR], y[TR])
            out = {"hp": dict(hp), "calibration_cv": cal_scores, "calibration": kind, "patterns": {}}
            for d in DROPS:
                Md = apply_drop(M, experts, d)
                ok = VA & Md.any(1)
                z = st.logit(L[ok], Md[ok], Gs[ok])
                p_raw = sigm(z)
                p_cal = cals[kind](p_raw)
                key = "+".join(e for e in experts if e not in d)
                out["patterns"][key] = {"raw": metrics(p_raw, y[ok]), "cal": metrics(p_cal, y[ok]),
                                        "cal_all": {k2: metrics(cals[k2](p_raw), y[ok])["log_loss"] for k2 in cals}}
                out["patterns"][key]["_p"] = p_cal
                out["patterns"][key]["_idx"] = np.where(ok)[0]
                log("  valid %-8s %-40s raw %.4f cal(%s) %.4f  [none %.4f temp %.4f iso %.4f]" % (
                    m, key, out["patterns"][key]["raw"]["log_loss"], kind, out["patterns"][key]["cal"]["log_loss"],
                    *[out["patterns"][key]["cal_all"][k2] for k2 in ("none", "temperature", "isotonic")]))
            out["_model"], out["_cal"], out["_cals"] = st, cals[kind], cals
            res["methods"][m] = out
        results[set_name] = res
    with open(os.path.join(CACHE, "fit.pkl"), "wb") as fh:
        pickle.dump({"results": results, "P": P, "y": y, "dates": dates, "ids": ids, "rows": rows, "G": G, "Gs": Gs,
                     "mu": mu, "sd": sd, "singles": singles, "SETS": SETS, "DROPS": DROPS, "ext_notes": ext_notes,
                     "TR": TR, "VA": VA}, fh)
    log("fit done in %.0fs" % (time.time() - t0))
    report_and_export(args)


def report_and_export(args):
    pass


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
