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
    out["streak6"] = float(max(-6, min(6, out["streak"]))) if np.isfinite(out["streak"]) else 0.0
    return out


# The page-computable LR (exported in moe.json 'feat', evaluated by MoE.featLR in src/ml/moe.js) uses only
# what a fighters.json profile carries: no Glicko, opponent Elo or title count; streak capped at +-6 (the
# profile's 'recent' list holds the last 6 fights).
PAGE_DROP = {"glicko", "glicko_rd", "opp_elo", "titles", "streak"}


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
                           verbose=-1, num_threads=1, seed=7)
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


def cmd_experts_lr_page(args):
    """Adds the page-computable feature LR ('feat_lr') to experts.pkl (the full-feature LR is kept as
    'feat_lr_full'): same protocol (C chosen on 2016-2018, expanding-window OOF 2019-2023, <=2023 model for
    2024-2025, production fit on everything before 2026)."""
    global FEAT_NAMES
    t0 = time.time()
    with open(os.path.join(CACHE, "prep.pkl"), "rb") as fh:
        prep = pickle.load(fh)
    with open(os.path.join(CACHE, "experts.pkl"), "rb") as fh:
        E = pickle.load(fh)
    entries = [e for e in prep["entries"] if e["date"] < VAULT_FROM.isoformat()]
    rows = build_table(entries, prep["keys"], prep["priors_asof"])
    FEAT_NAMES = None
    XA, XB, C = mats(rows)
    names = [n for n in FEAT_NAMES if n not in PAGE_DROP]
    cols = [FEAT_NAMES.index(n) for n in names]
    XA, XB = XA[:, cols], XB[:, cols]
    y = np.array([r["y"] for r in rows])
    dates = np.array([r["date"] for r in rows])
    yr = years_of(dates)
    dec = np.isfinite(y)
    grid = {}
    for Cv in (0.003, 0.01, 0.03, 0.1):
        tot, n = 0.0, 0
        for Y in (2016, 2017, 2018):
            tr, va = dec & (yr < Y), dec & (yr == Y)
            p = SymLR(Cv).fit(XA[tr], XB[tr], y[tr]).predict(XA[va], XB[va])
            tot += ll(p, y[va]) * va.sum()
            n += va.sum()
        grid[Cv] = tot / n
    Cb = min(grid, key=grid.get)
    log("page LR C grid (2016-2018 inner):", {k: round(v, 4) for k, v in grid.items()}, "->", Cb)
    pred = np.full(len(rows), np.nan)
    pred_s = np.full(len(rows), np.nan)
    for Y, te in [(Y, yr == Y) for Y in range(2019, 2026)]:
        tr = dec & (yr < Y)
        m_ = SymLR(Cb).fit(XA[tr], XB[tr], y[tr])
        pred[te] = m_.predict(XA[te], XB[te])
        if Y == 2024:
            st_ = (yr == 2024) | (yr == 2025)
            pred_s[st_] = m_.predict(XA[st_], XB[st_])
    pred_s[np.isnan(pred_s)] = pred[np.isnan(pred_s)]
    lr_all = SymLR(Cb).fit(XA[dec], XB[dec], y[dec])
    lr_val = SymLR(Cb).fit(XA[dec & (yr < 2024)], XB[dec & (yr < 2024)], y[dec & (yr < 2024)])
    keep = dates >= TRAIN[0]
    ids_new = [r["id"] for r, k in zip(rows, keep) if k]
    assert ids_new == E["ids"], "row order changed; rerun experts"
    if "feat_lr_full" not in E["pred"]:
        E["pred"]["feat_lr_full"] = E["pred"]["feat_lr"]
        E["pred_static"]["feat_lr_full"] = E["pred_static"]["feat_lr"]
    E["pred"]["feat_lr"] = pred[keep]
    E["pred_static"]["feat_lr"] = pred_s[keep]
    # sides of the kept rows for the JS test (raw side records) and the production coefficients
    E["lr_page"] = {"names": names, "C": Cb, "grid": grid, "coef": lr_all.coef.tolist(), "coef_valid": lr_val.coef.tolist()}
    # priors for live use: division rates from fights in 2021-01-01..2025-12-31 (= priors_asof["2026"])
    import build_db as B
    lg = {}
    fights, _ = B.parse_fights(lg)
    fights = [f for f in fights if f.date < VAULT_FROM]
    people = B.build_people(fights, lg)
    B.build_vectors(fights, lg)
    E["priors_2026"] = B.build_priors(fights, dt.date(2021, 1, 1), dt.date(2026, 1, 1))
    with open(os.path.join(CACHE, "experts.pkl"), "wb") as fh:
        pickle.dump(E, fh)
    m = keep & dec
    yk = y
    for lab, sel in (("2019-23", m & (yr <= 2023)), ("2024-25", m & (yr >= 2024))):
        print("  feat_lr(page) %s n=%d log loss %.4f (static %.4f)" % (lab, sel.sum(), ll(pred[sel], yk[sel]),
                                                                      ll(pred_s[sel], yk[sel])))
    log("page LR done in %.0fs" % (time.time() - t0))


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
    # one thread: on this shared 4-core box OpenMP threads oversubscribe badly (2 threads ran >10x slower)
    for leaves, mdl in ((7, 80), (15, 60)):
        curves = []
        wts = []
        for Y in (2016, 2017, 2018):
            tr = dec & (yr < Y)
            va = dec & (yr == Y)
            g = SymGBM({"num_leaves": leaves, "min_data_in_leaf": mdl, "learning_rate": 0.04},
                       rounds=600 if not args.quick else 300)
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
    # rolling: every year Y in 2019-2025 is predicted by a model trained on fights before Jan 1 of Y;
    # static: 2024-2025 both predicted by the <=2023 model (the protocol's validation number)
    pred = {k: np.full(len(rows), np.nan) for k in ("feat_lr", "feat_gbm")}
    pred_static = {k: np.full(len(rows), np.nan) for k in ("feat_lr", "feat_gbm")}
    folds = [(Y, yr == Y) for Y in range(2019, 2026)]
    lr_coefs = {}
    for Y, te in folds:
        tr = dec & (yr < Y)
        lr = SymLR(C_best).fit(XA[tr], XB[tr], y[tr])
        lr_coefs[Y] = lr.coef.tolist()
        g = SymGBM({"num_leaves": leaves, "min_data_in_leaf": g_mdl, "learning_rate": 0.04},
                   rounds=g_rounds).fit(XA[tr], XB[tr], C[tr], y[tr])
        pred["feat_lr"][te] = lr.predict(XA[te], XB[te])
        pred["feat_gbm"][te] = g.predict(XA[te], XB[te], C[te])
        if Y == 2024:
            st_ = (yr == 2024) | (yr == 2025)
            pred_static["feat_lr"][st_] = lr.predict(XA[st_], XB[st_])
            pred_static["feat_gbm"][st_] = g.predict(XA[st_], XB[st_], C[st_])
        log("fold %d: train %d -> predict %d" % (Y, tr.sum(), te.sum()))
    for k in pred_static:
        m_ = np.isnan(pred_static[k])
        pred_static[k][m_] = pred[k][m_]
    pred["elo"] = elo_p(XA, XB)
    pred["glicko"] = glicko_p(rows)

    keep = dates >= TRAIN[0]
    pred_static["elo"], pred_static["glicko"] = pred["elo"], pred["glicko"]
    out = {"ids": [r["id"] for r, k in zip(rows, keep) if k], "dates": dates[keep].tolist(), "y": y[keep],
           "pred": {k: v[keep] for k, v in pred.items()}, "rows": [r for r, k in zip(rows, keep) if k],
           "pred_static": {k: v[keep] for k, v in pred_static.items()},
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
            print("  %-9s %s  n=%4d  log loss %.4f (static %.4f)" % (k, lab, sel.sum(), ll(v[sel], y[sel]),
                                                                     ll(pred_static[k][sel], y[sel])))
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
    is their contract; see research/model_moe.md for the recipe to plug a new one in). Returns (rolling, static,
    notes): rolling uses an annual-refit variant for 2024-2025 when the tool publishes one."""
    out, out_s, notes = {}, {}, {}
    d = load_json("ml.json")
    if d and isinstance(d.get("fights"), dict):
        T = d["fights"]
        def col(k, fb=None):
            v = []
            for i in ids:
                e = T.get(i) or {}
                x = e.get(k)
                if x is None and fb:
                    x = e.get(fb)
                v.append(np.nan if x is None else float(x))
            return np.array(v)
        # 'lr' = the tools/ml.py page winner model (without its Platt slope): out-of-fold 2019-2023 from annual
        # expanding refits, 2024+ from the 2010-2023 fit; 'lr_refit' = January refits (2025 trained through 2024)
        out_s["ml"], out["ml"] = col("lr"), col("lr_refit", "lr")
        out_s["elo_sig"] = out["elo_sig"] = col("elo_sig")
        out_s["ml_gbm"], out["ml_gbm"] = col("gbm"), col("gbm_refit", "gbm")
        out_s["ml_blend"], out["ml_blend"] = col("ml"), col("ml_refit", "ml")
        notes["ml"] = "ml.json: lr (page winner model) as 'ml', elo_sig, gbm as 'ml_gbm', ml blend as 'ml_blend'; coverage %.3f" % float(
            np.isfinite(out_s["ml"]).mean())
    mk = load_json("market.json")
    if mk and isinstance(mk.get("fights"), dict):
        v = np.array([(mk["fights"].get(i) or {}).get("p_market_rating") or np.nan for i in ids], dtype=float)
        if np.isfinite(v).mean() > 0.5:
            out["mkt_rating"] = out_s["mkt_rating"] = v
            notes["mkt_rating"] = "market.json p_market_rating (walk-forward Kalman rating from earlier closing lines); coverage %.3f" % float(
                np.isfinite(v).mean())
    for key, files in (("ratings", ["ratings.json"]), ("methodround", ["methodround.json"]),
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
                out[key] = out_s[key] = arr
    return out, out_s, notes


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
                           verbose=-1, num_threads=1, seed=11)
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
            self.x, self.y = np.round(grid, 4), np.round(np.maximum.accumulate(c), 6)
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
            return {"type": "isotonic", "x": [float(v) for v in self.x], "y": [float(v) for v in self.y]}
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
    be evaluated with any subset present (the page may lack the market line or the engine). hp 'h' = recency
    half-life in years for the training weights (None = equal weights)."""
    def __init__(self, method, experts, drops, hp=None):
        self.method, self.experts, self.drops, self.hp = method, list(experts), drops, dict(hp or {})
        self.groups = make_drops(self.experts)[2]

    def presence(self, M):
        """Gate inputs for the gated model: one 0/1 column per optional expert group (is it present?), so the
        softmax weights and the scale can depend on which experts the page has."""
        cols = [M[:, [self.experts.index(e) for e in g]].all(1).astype(float) for g in self.groups]
        return np.column_stack(cols) if cols else np.zeros((len(M), 0))

    def _aug(self, L, M, G, y, w):
        Ls, Ms, Gs, ys, ws = [], [], [], [], []
        for d in self.drops:
            keep = np.array([e not in d for e in self.experts])
            Mm = M & keep[None, :]
            ok = Mm.any(1)
            Ls.append(L[ok]); Ms.append(Mm[ok]); Gs.append(G[ok]); ys.append(y[ok]); ws.append(w[ok])
        return np.vstack(Ls), np.vstack(Ms), np.vstack(Gs), np.concatenate(ys), np.concatenate(ws)

    def weights(self, yrs):
        h = self.hp.get("h")
        if not h:
            return np.ones(len(yrs))
        w = 0.5 ** ((yrs.max() - yrs) / float(h))
        return w * len(w) / w.sum()

    def fit(self, L, M, G, y, yrs):
        w = self.weights(yrs)
        self.lin = {}
        self._tr = (L, M, y, w)
        if self.method == "linear":
            for d in self.drops:                     # one weight vector per availability pattern
                self._fit_pat(frozenset(e for e in self.experts if e not in d))
        elif self.method == "gated":
            La, Ma, Ga, ya, wa = self._aug(L, M, G, y, w)
            self.g = GatedStack(self.hp.get("lam", 1e-2)).fit(La, Ma, np.hstack([Ga, self.presence(Ma)]), ya, wa)
        elif self.method in ("gbm", "gbm_res"):
            La, Ma, Ga, ya, wa = self._aug(L, M, G, y, w)
            base = None
            if self.method == "gbm_res":
                for d in self.drops:
                    self._fit_pat(frozenset(e for e in self.experts if e not in d))
                base = self._lin_logit(La, Ma)
            self.b = GBMStack(self.hp.get("leaves", 4), self.hp.get("rounds", 200), self.hp.get("lr", 0.03),
                              self.hp.get("mdl", 80)).fit(La, Ma, Ga[:, 1:], ya, base=base, w=wa)
        self._tr = None
        return self

    def _fit_pat(self, pat):
        L, M, y, w = self._tr
        idx = [self.experts.index(e) for e in self.experts if e in pat]
        ok = M[:, idx].all(1)
        self.lin[pat] = (idx, LinStack().fit(L[ok][:, idx], y[ok], w[ok]))

    def _lin_logit(self, Lq, Mq):
        z = np.zeros(len(Lq))
        for i in range(len(Lq)):
            pat = frozenset(e for e, m in zip(self.experts, Mq[i]) if m)
            if pat not in self.lin:
                if self._tr is None:
                    raise KeyError("pattern %s not fitted" % sorted(pat))
                self._fit_pat(pat)
            idx, m = self.lin[pat]
            z[i] = Lq[i, idx] @ m.w
        return z

    def logit(self, L, M, G):
        if self.method == "linear":
            return self._lin_logit(L, M)
        if self.method == "gated":
            return self.g.logit(L, M, np.hstack([G, self.presence(M)]))
        base = self._lin_logit(L, M) if self.method == "gbm_res" else None
        return self.b.logit(L, M, G[:, 1:], base=base)


# experts the page may lack, in groups that come and go together (the market line; the market rating, which
# needs earlier closing lines for both fighters; the engine; the tools/ml.py page model and its strike-share Elo)
OPTIONAL_GROUPS = [["market"], ["mkt_rating"], ["engine"], ["ml", "elo_sig"]]


def make_drops(experts):
    """All availability patterns the stacker is trained for: every subset of the optional groups present in the
    expert list. REGIMES splits them by whether the market line is there."""
    groups = [[e for e in g if e in experts] for g in OPTIONAL_GROUPS]
    groups = [g for g in groups if g]
    drops = []
    for mask in range(1 << len(groups)):
        drops.append(set(e for j, g in enumerate(groups) if mask >> j & 1 for e in g))
    drops.sort(key=len)
    regimes = {"market": [j for j, d in enumerate(drops) if "market" not in d],
               "nomarket": [j for j, d in enumerate(drops) if "market" in d or "market" not in experts]}
    return drops, regimes, groups


DROPS, REGIMES, _ = make_drops(["market", "engine"])
CANDS = [("linear", {}), ("linear", {"h": 3.0}), ("linear", {"h": 1.5}),
         ("gated", {"lam": 0.01}), ("gated", {"lam": 0.03}), ("gated", {"lam": 0.1}), ("gated", {"lam": 0.03, "h": 1.5}),
         ("gbm", {"leaves": 3, "rounds": 150}), ("gbm_res", {"leaves": 3, "rounds": 50}),
         ("gbm_res", {"leaves": 3, "rounds": 50, "h": 1.5})]


def hp_key(m, hp):
    return "%s %s" % (m, json.dumps(hp, sort_keys=True))


def drop_mask(M, experts, d):
    keep = np.array([e not in d for e in experts])
    return M & keep[None, :]


def pat_key(experts, d):
    return "+".join(e for e in experts if e not in d)


class Composite:
    """Per-regime stackers: one model when the market line is present, another when it is not."""
    def __init__(self, experts, parts, cals):
        self.experts, self.parts, self.cals = experts, parts, cals   # parts/cals keyed by regime

    def predict(self, L, M, G):
        out = np.full(len(L), np.nan)
        mi = self.experts.index("market")
        for reg, has in (("market", True), ("nomarket", False)):
            sel = M[:, mi] == has
            if sel.any():
                out[sel] = self.cals[reg](sigm(self.parts[reg].logit(L[sel], M[sel], G[sel])))
        return out


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

    # ---- experts: P = rolling (each year predicted by expert models trained before it), Ps = static
    # (2024-2025 from the <=2023 expert models). Identical for 2019-2024.
    P = {k: E["pred"][k][sel] for k in E["pred"]}
    Ps = {k: E["pred_static"][k][sel] for k in E["pred_static"]}
    eng = load_json("moe_engine_bt.json")
    P["engine"] = np.array([(lambda e: e["pA"] / max(1e-9, e["pA"] + e["pB"]) if e and "pA" in e else np.nan)
                            (eng["fights"].get(i)) for i in ids])
    mk = load_json("market.json")
    mf = mk["fights"] if mk else {}
    P["market"] = np.array([(mf.get(i) or {}).get("p_power_close") or (mf.get(i) or {}).get("p_novig_close") or np.nan
                            for i in ids], dtype=float)
    P["market_open"] = np.array([(mf.get(i) or {}).get("p_novig_open") or np.nan for i in ids], dtype=float)
    ext, ext_s, ext_notes = external_experts(ids)
    P.update(ext)
    Ps.update(ext_s)
    for k in P:
        if k not in Ps:
            Ps[k] = P[k]
    log("external experts:", ext_notes or "none found")

    pre = load_json("preufc.json")
    snaps = set()
    if pre:
        for slug, f in pre.get("fighters", {}).items():
            for s_ in f.get("snapshots") or []:
                if s_ and len(s_) > 3 and s_[3]:
                    snaps.add((slug, s_[1]))
    G = gating_matrix(rows, None)
    for r in rows:
        r["puA"], r["puB"] = (r["slugA"], r["id"]) in snaps, (r["slugB"], r["id"]) in snaps
    G[:, GATE_NAMES.index("preufc")] = [0.5 * r["puA"] + 0.5 * r["puB"] for r in rows]
    G2 = np.array([gate_vector(gate_inputs(r, None)) for r in rows])
    assert np.allclose(G, G2, atol=1e-9), "gate_vector twin disagrees with gating_matrix"
    dec = np.isfinite(y)
    TR = dec & (dates >= TRAIN[0]) & (dates <= TRAIN[1])
    VA = dec & (dates >= VALID[0]) & (dates <= VALID[1])
    mu, sd = G[TR].mean(0), G[TR].std(0) + 1e-9
    Gs = np.hstack([np.ones((len(G), 1)), (G - mu) / sd])

    singles = {}
    for k in P:
        okr, oks = np.isfinite(P[k]), np.isfinite(Ps[k])
        singles[k] = {"train": metrics(P[k][TR & okr], y[TR & okr]), "valid": metrics(Ps[k][VA & oks], y[VA & oks]),
                      "valid_rolling": metrics(P[k][VA & okr], y[VA & okr]), "coverage_valid": float(oks[VA].mean())}
        log("single %-12s train ll %.4f (n=%d)  valid static %.4f rolling %.4f (n=%d)" % (
            k, singles[k]["train"]["log_loss"], singles[k]["train"]["n"], singles[k]["valid"]["log_loss"],
            singles[k]["valid_rolling"]["log_loss"], singles[k]["valid"]["n"]))

    SETS = {"page": [k for k in ["market", "mkt_rating", "engine", "ml", "feat_lr", "elo_sig", "elo"] if k in P],
            "full": [k for k in ["market", "mkt_rating", "engine", "ml", "ml_gbm", "ml_blend", "ratings", "feat_lr",
                                 "feat_lr_full", "feat_gbm", "elo_sig", "elo", "glicko"] if k in P]}
    if args.quick:
        SETS.pop("full")

    def LM(PP, experts):
        L = np.column_stack([logit(np.clip(PP[k], PCLIP, 1 - PCLIP)) for k in experts])
        M = np.column_stack([np.isfinite(PP[k]) for k in experts])
        return np.where(M, L, 0.0), M

    def oof_fold(m, hp, experts, L, M, Y):
        """Stacker trained on 2019..Y-1, logits for year Y under every drop pattern."""
        tr = dec & (yr >= 2019) & (yr < Y)
        te = np.where(dec & (yr == Y))[0]
        st = Stacker(m, experts, DROPS, hp).fit(L[tr], M[tr], Gs[tr], y[tr], yr[tr])
        out = {}
        for j, d in enumerate(DROPS):
            Md = drop_mask(M[te], experts, d)
            ok = Md.any(1)
            out[j] = (te[ok], st.logit(L[te][ok], Md[ok], Gs[te][ok]))
        return out

    def regime_score(oofs, reg, years):
        tot = []
        for j in REGIMES[reg]:
            idx = np.concatenate([oofs[Y][j][0] for Y in years])
            z = np.concatenate([oofs[Y][j][1] for Y in years])
            tot.append(_nll(z, y[idx], 1.0) / len(idx))
        return float(np.mean(tot))

    def pick_cal(oofs, reg, years):
        """Calibration kind chosen nested: fit on the OOF logits of all CV years but the last, scored on the last."""
        zs = {Y: np.concatenate([oofs[Y][j][1] for j in REGIMES[reg]]) for Y in years}
        ys = {Y: np.concatenate([y[oofs[Y][j][0]] for j in REGIMES[reg]]) for Y in years}
        fit_y, last = years[:-1], years[-1]
        zf, yf = np.concatenate([zs[Y] for Y in fit_y]), np.concatenate([ys[Y] for Y in fit_y])
        sc = {k: ll(Calib(k).fit(zf, yf)(sigm(zs[last])), ys[last]) for k in ("none", "temperature", "isotonic")}
        return min(sc, key=sc.get), sc

    def fit_cal(oofs, reg, years, kind):
        z = np.concatenate([oofs[Y][j][1] for Y in years for j in REGIMES[reg]])
        yy = np.concatenate([y[oofs[Y][j][0]] for Y in years for j in REGIMES[reg]])
        return Calib(kind).fit(z, yy)

    CVY = (2021, 2022, 2023)
    results = {}
    for set_name, experts in SETS.items():
        DROPS, REGIMES, groups = make_drops(experts)
        log("=== expert set %s: %s (%d availability patterns)" % (set_name, experts, len(DROPS)))
        L, M = LM(P, experts)                     # rolling
        Ls, _ = LM(Ps, experts)                   # static (differs from L only in 2025 rows)
        oofs = {}
        for m, hp in CANDS:
            oofs[hp_key(m, hp)] = {Y: oof_fold(m, hp, experts, L, M, Y) for Y in CVY}
        cv = {reg: {k: regime_score(o, reg, CVY) for k, o in oofs.items()} for reg in REGIMES}
        for reg in REGIMES:
            for k, v in sorted(cv[reg].items(), key=lambda kv: kv[1])[:6]:
                log("  cv %-9s %-48s %.4f" % (reg, k, v))
        res = {"experts": experts, "cv": cv, "regimes": {}, "drops": [sorted(d) for d in DROPS], "groups": groups}
        for reg in REGIMES:
            best = {}
            for m, hp in CANDS:
                k = hp_key(m, hp)
                if m not in best or cv[reg][k] < cv[reg][hp_key(m, best[m])]:
                    best[m] = hp
            R = {"best_hp": {m: hp for m, hp in best.items()}, "methods": {}}
            for m, hp in best.items():
                k = hp_key(m, hp)
                o = oofs[k]
                kind, cal_sc = pick_cal(o, reg, CVY)
                # static validation: stacker on 2019-2023, calibration on OOF 2021-2023, experts static for 2024-25
                st = Stacker(m, experts, DROPS, hp).fit(L[TR], M[TR], Gs[TR], y[TR], yr[TR])
                cal = fit_cal(o, reg, CVY, kind)
                out = {"hp": hp, "calibration": kind, "calibration_cv": cal_sc, "cv": cv[reg][k], "patterns": {},
                       "_model": st, "_cal": cal}
                o24 = {2024: oof_fold(m, hp, experts, L, M, 2024)}     # = static stacker on 2024 rows
                st25 = Stacker(m, experts, DROPS, hp).fit(L[dec & (yr >= 2019) & (yr < 2025)], M[dec & (yr >= 2019) & (yr < 2025)],
                                                          Gs[dec & (yr >= 2019) & (yr < 2025)], y[dec & (yr >= 2019) & (yr < 2025)],
                                                          yr[dec & (yr >= 2019) & (yr < 2025)])
                cal25 = fit_cal({**o, **o24}, reg, CVY + (2024,), kind)
                for j in REGIMES[reg]:
                    d = DROPS[j]
                    key = pat_key(experts, d)
                    Md = drop_mask(M, experts, d)
                    ok = VA & Md.any(1)
                    idx = np.where(ok)[0]
                    zs_ = st.logit(Ls[ok], Md[ok], Gs[ok])
                    p_s = cal(sigm(zs_))
                    # rolling: 2024 from the 2019-2023 stacker (+ OOF 2021-2023 calibration), 2025 from 2019-2024
                    p_r = np.empty(len(idx))
                    i24, i25 = yr[idx] == 2024, yr[idx] == 2025
                    p_r[i24] = cal(sigm(st.logit(L[idx[i24]], Md[idx[i24]], Gs[idx[i24]])))
                    p_r[i25] = cal25(sigm(st25.logit(L[idx[i25]], Md[idx[i25]], Gs[idx[i25]])))
                    out["patterns"][key] = {"static": metrics(p_s, y[idx]), "static_raw": metrics(sigm(zs_), y[idx]),
                                            "rolling": metrics(p_r, y[idx]), "_idx": idx, "_ps": p_s, "_pr": p_r}
                    log("  valid %-9s %-8s %-46s static %.4f (raw %.4f, cal %s)  rolling %.4f" % (
                        reg, m, key, out["patterns"][key]["static"]["log_loss"],
                        out["patterns"][key]["static_raw"]["log_loss"], kind, out["patterns"][key]["rolling"]["log_loss"]))
                R["methods"][m] = out
            # parsimony: the simplest family wins unless a more complex one beats it by > 0.0005 CV log loss
            order = ["linear", "gated", "gbm_res", "gbm"]
            ch = "linear"
            for m in order[1:]:
                if m in R["methods"] and R["methods"][m]["cv"] < R["methods"][ch]["cv"] - 0.0005:
                    ch = m
            R["chosen"] = ch
            log("  chosen for %s regime: %s %s" % (reg, R["chosen"], R["methods"][R["chosen"]]["hp"]))
            res["regimes"][reg] = R
        res["_oofs"] = oofs
        results[set_name] = res
    with open(os.path.join(CACHE, "fit.pkl"), "wb") as fh:
        pickle.dump({"results": results, "P": P, "Ps": Ps, "y": y, "dates": dates, "ids": ids, "rows": rows, "G": G,
                     "Gs": Gs, "mu": mu, "sd": sd, "singles": singles, "SETS": SETS, "ext_notes": ext_notes,
                     "TR": TR, "VA": VA}, fh)
    log("fit done in %.0fs" % (time.time() - t0))
    report_and_export(args)


def segment_masks(rows, P, idx):
    """Symmetric segments over the rows idx (validation)."""
    segs = {}
    nmin = np.array([min(rows[i]["A"]["n"], rows[i]["B"]["n"]) for i in idx])
    segs["newcomer bout (a side with <=2 prior UFC fights)"] = nmin <= 2
    segs["middle experience (both 3-7)"] = (nmin >= 3) & (nmin <= 7)
    segs["veterans (both >=8 prior UFC fights)"] = nmin >= 8
    grp = np.array([DIV_GROUPS.get(rows[i]["prior_division"] or rows[i]["division"], "middle") for i in idx])
    for g, lab in (("light", "men 125-145"), ("middle", "men 155-185"), ("heavy", "men 205-265"), ("women", "women")):
        segs["division group: %s" % lab] = grp == g
    div = np.array([rows[i]["prior_division"] or rows[i]["division"] for i in idx])
    for d in DIVS:
        if (div == d).sum() >= 40:
            segs["division: %s" % d] = div == d
    pm = P["market"][idx]
    fav = np.maximum(pm, 1 - pm)
    segs["pick'em (market favourite < 60%)"] = np.isfinite(pm) & (fav < 0.60)
    segs["moderate favourite (60-75%)"] = np.isfinite(pm) & (fav >= 0.60) & (fav < 0.75)
    segs["heavy favourite (>= 75%)"] = np.isfinite(pm) & (fav >= 0.75)
    r5 = np.array([rows[i]["rounds"] == 5 for i in idx])
    segs["5-round fights"] = r5
    segs["3-round fights"] = ~r5
    pu = np.array([rows[i]["puA"] or rows[i]["puB"] for i in idx])
    segs["pre-UFC record known for a side (preufc.json)"] = pu
    return segs


def export_model(st, cal, experts, mu, sd, P_clip=PCLIP):
    m = {"method": st.method, "experts": experts, "pclip": P_clip, "hp": st.hp,
         "gate": {"names": GATE_NAMES, "mu": [float(v) for v in mu], "sd": [float(v) for v in sd]},
         "calibration": cal.export()}
    if st.method == "gated":
        m["V"] = [[float(v) for v in row] for row in st.g.V]
        m["u"] = [float(v) for v in st.g.u]
        m["presence_groups"] = st.groups          # extra gate inputs after the standardised features
    if st.method in ("linear", "gbm_res"):
        m["linear"] = {"+".join(e for e in experts if e in pat): {experts[i]: float(w) for i, w in zip(idx, lm.w)}
                       for pat, (idx, lm) in st.lin.items()}
    if st.method in ("gbm", "gbm_res"):
        m["trees"] = export_trees(st.b.m)
    return m


def export_composite(comp, mu, sd):
    return {"method": "switch", "on": "market", "experts": comp.experts, "pclip": PCLIP,
            "optional_groups": make_drops(comp.experts)[2],
            "gate": {"names": GATE_NAMES, "mu": [float(v) for v in mu], "sd": [float(v) for v in sd]},
            "present": export_model(comp.parts["market"], comp.cals["market"], comp.experts, mu, sd),
            "absent": export_model(comp.parts["nomarket"], comp.cals["nomarket"], comp.experts, mu, sd)}


def export_trees(booster):
    """LightGBM trees as compact arrays: per node [feature, threshold, left, right, default_left, nan_missing]
    (children < 0 are leaves: leaf index = -child - 1) and leaf values. NaN follows default_left when the
    split's missing_type is NaN, else it is treated as 0 (LightGBM semantics)."""
    d = booster.dump_model()
    out = []
    for t in d["tree_info"]:
        nodes, leaves = [], []

        def walk(n):
            if "split_feature" not in n:
                leaves.append(float(n["leaf_value"]))
                return -len(leaves)
            i = len(nodes)
            nodes.append(None)
            left = walk(n["left_child"])
            right = walk(n["right_child"])
            nodes[i] = [int(n["split_feature"]), float(n["threshold"]), left, right,
                        1 if n.get("default_left") else 0, 1 if n.get("missing_type") == "NaN" else 0]
            return i
        root = walk(t["tree_structure"])
        out.append({"nodes": nodes, "leaves": leaves, "root": root})
    return out


def report_and_export(args):
    with open(os.path.join(CACHE, "fit.pkl"), "rb") as fh:
        F = pickle.load(fh)
    R, P, Ps, y, rows, Gs, G = F["results"], F["P"], F["Ps"], F["y"], F["rows"], F["Gs"], F["G"]
    dates, TR, VA, singles = F["dates"], F["TR"], F["VA"], F["singles"]
    yr = years_of(dates)
    dec = np.isfinite(y)
    clusters = np.array([r["date"] for r in rows])
    rep = {"singles": singles, "sets": {}, "ext_notes": F["ext_notes"]}
    for sname, res in R.items():
        S = {"experts": res["experts"], "cv": res["cv"], "regimes": {}}
        for reg, RR in res["regimes"].items():
            SR = {"chosen": RR["chosen"], "methods": {}}
            for m, out in RR["methods"].items():
                mo = {"hp": out["hp"], "calibration": out["calibration"], "calibration_cv": out["calibration_cv"],
                      "cv": out["cv"], "patterns": {}}
                for key, pr in out["patterns"].items():
                    idx = pr["_idx"]
                    d = {"static": pr["static"], "static_raw": pr["static_raw"], "rolling": pr["rolling"]}
                    for sch, p, PP in (("static", pr["_ps"], Ps), ("rolling", pr["_pr"], P)):
                        d["ci_" + sch] = boot_ci(p, y[idx], clusters[idx], B=1000)
                        if reg == "market":
                            okm = np.isfinite(P["market"][idx])
                            d["vs_market_" + sch] = boot_ci(p[okm], y[idx][okm], clusters[idx][okm], ref=P["market"][idx][okm], B=1000)
                        cands = [e for e in key.split("+") if e != "market" and np.isfinite(PP[e][idx]).all()]
                        best = min(cands, key=lambda e: ll(PP[e][idx], y[idx]))
                        d["vs_best_single_" + sch] = dict(boot_ci(p, y[idx], clusters[idx], ref=PP[best][idx], B=1000), expert=best)
                    mo["patterns"][key] = d
                SR["methods"][m] = mo
            S["regimes"][reg] = SR
        rep["sets"][sname] = S

    # ---- exported model: page set, per regime the method with the lowest forward-chained CV (2021-2023)
    page = R["page"]
    experts = page["experts"]
    DROPS, REGIMES, groups = make_drops(experts)
    chosen = {reg: page["regimes"][reg]["chosen"] for reg in REGIMES}
    rep["chosen"] = {"set": "page", "experts": experts,
                     "market": {"method": chosen["market"], "hp": page["regimes"]["market"]["methods"][chosen["market"]]["hp"]},
                     "nomarket": {"method": chosen["nomarket"], "hp": page["regimes"]["nomarket"]["methods"][chosen["nomarket"]]["hp"]},
                     "rule": "per regime (market line present / absent) the stacker family + hyper-parameters with the lowest "
                             "forward-chained CV log loss (validation years 2021-2023, train from 2019); calibration kind chosen "
                             "nested inside the CV; 2024-2025 never used for a choice"}
    log("chosen for export: %s" % rep["chosen"])
    L = np.column_stack([logit(np.clip(P[k], PCLIP, 1 - PCLIP)) for k in experts])
    M = np.column_stack([np.isfinite(P[k]) for k in experts])
    L = np.where(M, L, 0.0)
    Lst = np.column_stack([logit(np.clip(Ps[k], PCLIP, 1 - PCLIP)) for k in experts])
    Lst = np.where(M, Lst, 0.0)
    comp_val = Composite(experts, {reg: page["regimes"][reg]["methods"][chosen[reg]]["_model"] for reg in REGIMES},
                         {reg: page["regimes"][reg]["methods"][chosen[reg]]["_cal"] for reg in REGIMES})

    # ---- segments (static scheme = protocol number; rolling as a second column)
    mpat = "+".join(experts)
    npat = "+".join(e for e in experts if e != "market")
    pm_ = page["regimes"]["market"]["methods"][chosen["market"]]["patterns"][mpat]
    pn_ = page["regimes"]["nomarket"]["methods"][chosen["nomarket"]]["patterns"][npat]
    common = np.array(sorted(set(pm_["_idx"]) & set(pn_["_idx"])))
    common = common[np.isfinite(P["market"][common])]          # segment tables: rows with a market line
    maps = {k: dict(zip(src["_idx"], src[f])) for k, src, f in (("ms", pm_, "_ps"), ("mr", pm_, "_pr"),
                                                                 ("ns", pn_, "_ps"), ("nr", pn_, "_pr"))}
    full_maps = {}
    if "full" in R:
        fe = R["full"]["experts"]
        for reg, key in (("market", "+".join(fe)), ("nomarket", "+".join(e for e in fe if e != "market"))):
            ch = R["full"]["regimes"][reg]["chosen"]
            src = R["full"]["regimes"][reg]["methods"][ch]["patterns"][key]
            full_maps[reg] = dict(zip(src["_idx"], src["_ps"]))
    segs = {}
    SM = segment_masks(rows, P, common)
    mlk = "ml" if "ml" in experts else "feat_lr"
    for sgn, mask in SM.items():
        ii = common[mask]
        if len(ii) < 25:
            continue
        yy, cl = y[ii], clusters[ii]
        g = lambda k: np.array([maps[k][i] for i in ii])
        e = {"n": int(len(ii)), "moe_market": ll(g("ms"), yy), "moe_market_rolling": ll(g("mr"), yy),
             "moe_nomarket": ll(g("ns"), yy), "moe_nomarket_rolling": ll(g("nr"), yy)}
        for reg, fm in full_maps.items():
            if all(i in fm for i in ii):
                e["full_" + reg] = ll(np.array([fm[i] for i in ii]), yy)
        for k in ("market", "mkt_rating", "engine", "ml", "feat_lr", "elo_sig", "elo", "feat_gbm", "feat_lr_full"):
            if k in Ps and np.isfinite(Ps[k][ii]).all():
                e[k] = ll(Ps[k][ii], yy)
        e["d_moe_vs_market"] = boot_ci(g("ms"), yy, cl, ref=P["market"][ii], B=1000)
        best = min((k for k in ("mkt_rating", "engine", "ml", "feat_lr", "elo_sig", "elo") if k in e), key=lambda k: e[k])
        e["d_nomarket_vs_best_single"] = dict(boot_ci(g("ns"), yy, cl, ref=Ps[best][ii], B=1000), expert=best)
        e["d_nomarket_vs_ml"] = boot_ci(g("ns"), yy, cl, ref=Ps[mlk][ii], B=1000)
        segs[sgn] = e
    rep["segments"] = segs
    rep["calibration_valid"] = {"moe_market": calib_table(np.array([maps["ms"][i] for i in common]), y[common]),
                                "moe_nomarket": calib_table(np.array([maps["ns"][i] for i in common]), y[common]),
                                "market": calib_table(P["market"][common], y[common]),
                                mlk: calib_table(Ps[mlk][common], y[common])}
    rep["by_year"] = {}
    for Y in (2024, 2025):
        s_ = yr[common] == Y
        ii = common[s_]
        rep["by_year"][str(Y)] = {"n": int(len(ii)), "market": ll(P["market"][ii], y[ii]),
                                  "moe_market_static": ll(np.array([maps["ms"][i] for i in ii]), y[ii]),
                                  "moe_market_rolling": ll(np.array([maps["mr"][i] for i in ii]), y[ii]),
                                  "moe_nomarket_static": ll(np.array([maps["ns"][i] for i in ii]), y[ii]),
                                  "moe_nomarket_rolling": ll(np.array([maps["nr"][i] for i in ii]), y[ii]),
                                  mlk + "_static": ll(Ps[mlk][ii], y[ii]), mlk + "_rolling": ll(P[mlk][ii], y[ii]),
                                  "feat_lr_static": ll(Ps["feat_lr"][ii], y[ii]),
                                  "mkt_rating": ll(P["mkt_rating"][ii][np.isfinite(P["mkt_rating"][ii])],
                                                   y[ii][np.isfinite(P["mkt_rating"][ii])]) if "mkt_rating" in P else None,
                                  "engine": ll(P["engine"][ii], y[ii]), "elo": ll(P["elo"][ii], y[ii])}

    # gated-model trust by segment (the (b) family, page set): mean softmax weights and scale on validation rows
    gm = page["regimes"]["market"]["methods"].get("gated")
    if gm:
        st = gm["_model"]
        gw = {}
        for label, Mx in (("with_market", M), ("no_market", drop_mask(M, experts, {"market"}))):
            _ = st.logit(Lst[common], Mx[common], Gs[common])
            PI, s_ = st.g.last_pi, st.g.last_s
            for sgn, mask in SM.items():
                if mask.sum() >= 25:
                    gw.setdefault(sgn, {})[label] = {"weights": {e: round(float(PI[mask, j].mean()), 4)
                                                                 for j, e in enumerate(experts) if Mx[common][mask][:, j].any()},
                                                     "scale": round(float(s_[mask].mean()), 4)}
        rep["gate_weights_valid"] = gw
        rep["gate_coefficients"] = {"experts": experts, "gate": ["bias"] + GATE_NAMES + ["has:" + "+".join(g) for g in st.groups],
                                    "V": [[round(float(v), 4) for v in row] for row in st.g.V],
                                    "u": [round(float(v), 4) for v in st.g.u]}

    # ---- production refit on 2019-2025 (same hyper-parameters), calibration on forward-chained OOF 2021-2025
    ALL = TR | VA
    parts, cals = {}, {}
    for reg in REGIMES:
        m = chosen[reg]
        hp = page["regimes"][reg]["methods"][m]["hp"]
        zz, yy = [], []
        for Y in (2021, 2022, 2023, 2024, 2025):
            tr = ALL & (yr < Y)
            te = ALL & (yr == Y)
            s_ = Stacker(m, experts, DROPS, hp).fit(L[tr], M[tr], Gs[tr], y[tr], yr[tr])
            for j in REGIMES[reg]:
                Md = drop_mask(M[te], experts, DROPS[j])
                ok = Md.any(1)
                zz.append(s_.logit(L[te][ok], Md[ok], Gs[te][ok]))
                yy.append(y[te][ok])
        cals[reg] = Calib(page["regimes"][reg]["methods"][m]["calibration"]).fit(np.concatenate(zz), np.concatenate(yy))
        parts[reg] = Stacker(m, experts, DROPS, hp).fit(L[ALL], M[ALL], Gs[ALL], y[ALL], yr[ALL])
    comp_prod = Composite(experts, parts, cals)
    model_prod = export_composite(comp_prod, F["mu"], F["sd"])
    model_val = export_composite(comp_val, F["mu"], F["sd"])
    alts = {}
    for m2, o2 in page["regimes"]["nomarket"]["methods"].items():
        if m2 in ("linear", "gated"):
            alts[m2 + "_validated"] = export_model(o2["_model"], o2["_cal"], experts, F["mu"], F["sd"])

    # ---- test vectors: Python predictions the JS evaluator must reproduce (validation rows, every availability
    # pattern, both corner orders)
    rng = np.random.default_rng(5)
    tv = []
    pick = rng.choice(np.where(VA)[0], size=min(60, VA.sum()), replace=False)
    for j, i in enumerate(pick):
        d = DROPS[j % len(DROPS)]
        ex = {e: (None if (e in d or not np.isfinite(P[e][i])) else float(P[e][i])) for e in experts}
        gate = gate_inputs(rows[i], None)
        for sign in (1, -1):
            exs = {e: (None if v is None else (v if sign == 1 else 1 - v)) for e, v in ex.items()}
            gs = gate if sign == 1 else swap_gate(gate)
            gv = gate_vector(gs)
            tv.append({"experts": exs, "gate": gs,
                       "p_prod": float(predict_py(comp_prod, exs, gv, experts, F["mu"], F["sd"])),
                       "p_valid": float(predict_py(comp_val, exs, gv, experts, F["mu"], F["sd"]))})

    # ---- built-in ML expert (page-computable feature LR) + its test vectors
    feat = None
    with open(os.path.join(CACHE, "experts.pkl"), "rb") as fh:
        EX = pickle.load(fh)
    if "lr_page" in EX:
        lp = EX["lr_page"]
        need = sorted({k for _, ks, _ in RATE_DEFS for k in ks} | {k for _, a, b, _, _ in ACC_DEFS for k in a + b})

        def psub(PA):
            return {d: {k: PA[d].get(k, 0.0) for k in need} for d in PA if isinstance(PA[d], dict)}
        with open(os.path.join(CACHE, "prep.pkl"), "rb") as fh:
            prep = pickle.load(fh)
        feat = {"names": lp["names"], "coef": lp["coef"], "coef_valid": lp["coef_valid"], "C": lp["C"],
                "keys": prep["keys"], "rate_defs": [list(d) for d in RATE_DEFS], "acc_defs": [list(d) for d in ACC_DEFS],
                "priors": psub(EX["priors_2026"]), "half_life_days": 730,
                "notes": "symmetric L2 logistic regression on side-feature differences, no intercept; 'coef' fit on "
                         "decisive UFC fights 2010-2025, 'coef_valid' on 2010-2023 (produced the static 2024-2025 numbers); "
                         "priors = division rates from fights 2021-2025"}
        ent = {e["id"]: e for e in prep["entries"]}
        ftv = []
        rng2 = np.random.default_rng(9)
        for i in rng2.choice(np.where(VA)[0], size=min(40, VA.sum()), replace=False):
            e = ent[rows[i]["id"]]
            sides = [{k: e[t].get(k) for k in ("S", "age", "height_in", "reach_in", "n", "ko_losses", "kd_absorbed",
                                                "elo", "cmin", "w", "l", "streak", "last3", "n5", "fin_w", "fin_l",
                                                "layoff", "stance", "home")} for t in ("A", "B")]
            div = e.get("prior_division") or e["division"]
            PA = prep["priors_asof"][e["date"][:4]]
            ftv.append({"A": sides[0], "B": sides[1], "division": div,
                        "priors": psub({div: PA.get(div) or PA["ALL"], "ALL": PA["ALL"]}), "p_valid": float(Ps["feat_lr"][i])})
        feat["test_vectors"] = ftv

    doc = {
        "meta": {"tool": "tools/moe.py", "built": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
                 "train": TRAIN, "valid": VALID, "vault_excluded_from": VAULT_FROM.isoformat(),
                 "orientation": "every probability is P(first-named fighter A wins); the model is exactly symmetric "
                                "(swap A/B -> 1 - p)",
                 "experts": {
                     "market": "de-vigged closing moneyline P(A) (power method; MoE.devig(oddsA, oddsB)); optional",
                     "mkt_rating": "market rating P(A): MoE.ratingProb(muA, sdA, muB, sdB) with data/derived/market.json "
                                   "meta.ratings[slug] = [mu, sd, ...]; leave out when either fighter has no rating",
                     "engine": "FightEngine.summarize pA / (pA + pB) (draws removed); leave out if the engine is not run",
                     "ml": "tools/ml.py page model: page_model.winner P(A) WITHOUT its Platt slope (matches ml.json "
                           "fights[*].lr); leave out (with elo_sig) when ml.json is not loaded",
                     "feat_lr": "built-in feature LR: MoE.featLR(doc.feat, sideA, sideB, ctx) on fighters.json profiles",
                     "elo_sig": "strike-share Elo P(A) = 1 / (1 + 10^((B - A) / 400)) with ml.json roster[slug].elo_sig",
                     "elo": "MoE.eloProb(eloA, eloB) with fighters.json elo"},
                 "gate_inputs": {"nA/nB": "prior UFC fights", "cminA/cminB": "career UFC minutes",
                                 "eloA/eloB": "Elo", "rounds": "3 or 5", "division": "fight division",
                                 "layoffA/layoffB": "days since the fighter's previous UFC fight (null -> 365)",
                                 "ageA/ageB": "age in years at the fight date (null -> 30)",
                                 "preufcA/preufcB": "true when data/derived/preufc.json has the fighter's pre-UFC record"},
                 "engine_bt": "data/derived/moe_engine_bt.json (engine %s, params sha %s, %s sims per corner order)" % (
                     (load_json("moe_engine_bt.json") or {}).get("meta", {}).get("engine_version"),
                     (load_json("moe_engine_bt.json") or {}).get("meta", {}).get("params3_sha256_16"),
                     (load_json("moe_engine_bt.json") or {}).get("meta", {}).get("sims_per_orientation")),
                 "notes": "model = production composite refit on 2019-2025 with the hyper-parameters chosen by forward-chained "
                          "CV inside 2019-2023 (method 'switch': 'present' when a market line is given, else 'absent'); "
                          "model_validated = the 2019-2023 fit that produced the static 2024-2025 report."},
        "model": model_prod, "model_validated": model_val, "alternatives": alts, "feat": feat,
        "report": strip_private(rep), "test_vectors": tv}
    wjson(os.path.join(DERIVED, "moe.json"), doc)
    with open(os.path.join(CACHE, "report.json"), "w") as fh:
        json.dump(strip_private(rep), fh, indent=1)
    log("wrote data/derived/moe.json (%.0f kB)" % (os.path.getsize(os.path.join(DERIVED, "moe.json")) / 1024))


def strip_private(o):
    if isinstance(o, dict):
        return {str(k): strip_private(v) for k, v in o.items() if not str(k).startswith("_")}
    if isinstance(o, (list, tuple)):
        return [strip_private(v) for v in o]
    if isinstance(o, np.ndarray):
        return [strip_private(v) for v in o.tolist()]
    if isinstance(o, np.generic):
        o = o.item()
    if isinstance(o, float) and not math.isfinite(o):
        return None
    return o


def gate_inputs(r, g=None):
    a, b = r["A"], r["B"]

    def lay(x):
        return None if not np.isfinite(x) else float(math.expm1(x))
    return {"nA": int(a["n"]), "nB": int(b["n"]), "cminA": float(math.expm1(a["cmin"])), "cminB": float(math.expm1(b["cmin"])),
            "eloA": float(a["elo"]), "eloB": float(b["elo"]), "rounds": int(r["rounds"]),
            "division": r["prior_division"] or r["division"], "layoffA": lay(a["layoff"]), "layoffB": lay(b["layoff"]),
            "ageA": None if not np.isfinite(a["age"]) else float(a["age"]),
            "ageB": None if not np.isfinite(b["age"]) else float(b["age"]),
            "preufcA": bool(r.get("puA", False)), "preufcB": bool(r.get("puB", False))}


def swap_gate(g):
    s = dict(g)
    for a, b in (("nA", "nB"), ("cminA", "cminB"), ("eloA", "eloB"), ("layoffA", "layoffB"), ("ageA", "ageB"),
                 ("preufcA", "preufcB")):
        s[a], s[b] = g[b], g[a]
    return s


def gate_vector(gi):
    """Python twin of MoE.gateVector in src/ml/moe.js (raw gating features from the page inputs)."""
    def lay(x):
        return math.log1p(min(x, 2000.0)) if x is not None else math.log1p(365)
    grp = DIV_GROUPS.get(gi["division"], "middle")
    ages = [gi["ageA"] if gi["ageA"] is not None else 30.0, gi["ageB"] if gi["ageB"] is not None else 30.0]
    return np.array([math.log1p(min(gi["nA"], gi["nB"])), math.log1p(max(gi["nA"], gi["nB"])),
                     min(math.log1p(gi["cminA"]), math.log1p(gi["cminB"])), abs(gi["eloA"] - gi["eloB"]) / 100.0,
                     1.0 if gi["rounds"] == 5 else 0.0, 1.0 if grp == "women" else 0.0,
                     1.0 if grp == "light" else 0.0, 1.0 if grp == "heavy" else 0.0,
                     max(lay(gi["layoffA"]), lay(gi["layoffB"])), (ages[0] + ages[1]) / 2 - 30.0,
                     abs(ages[0] - ages[1]), 0.5 * bool(gi["preufcA"]) + 0.5 * bool(gi["preufcB"])])


def predict_py(comp, ex, g_raw, experts, mu, sd):
    L = np.array([[logit(np.clip(ex[e], PCLIP, 1 - PCLIP)) if ex[e] is not None else 0.0 for e in experts]])
    M = np.array([[ex[e] is not None for e in experts]])
    Gs = np.hstack([[1.0], (g_raw - mu) / sd])[None, :]
    return comp.predict(L, M, Gs)[0]


# ====================================================================== main
def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("cmd", choices=["prep", "experts", "lrpage", "fit", "report", "all"])
    ap.add_argument("--quick", action="store_true")
    args = ap.parse_args()
    warnings.filterwarnings("ignore")
    if args.cmd in ("prep", "all"):
        cmd_prep(args)
    if args.cmd in ("experts", "all"):
        cmd_experts(args)
    if args.cmd in ("lrpage", "experts", "all"):
        cmd_experts_lr_page(args)
    if args.cmd in ("fit", "all"):
        cmd_fit(args)
    if args.cmd == "report":
        report_and_export(args)


if __name__ == "__main__":
    main()
