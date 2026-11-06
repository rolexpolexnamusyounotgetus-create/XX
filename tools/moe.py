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
    for Y, te in [(Y, yr == Y) for Y in range(2019, 2024)] + [(2024, (yr == 2024) | (yr == 2025))]:
        tr = dec & (yr < Y)
        pred[te] = SymLR(Cb).fit(XA[tr], XB[tr], y[tr]).predict(XA[te], XB[te])
    lr_all = SymLR(Cb).fit(XA[dec], XB[dec], y[dec])
    lr_val = SymLR(Cb).fit(XA[dec & (yr < 2024)], XB[dec & (yr < 2024)], y[dec & (yr < 2024)])
    keep = dates >= TRAIN[0]
    ids_new = [r["id"] for r, k in zip(rows, keep) if k]
    assert ids_new == E["ids"], "row order changed; rerun experts"
    if "feat_lr_full" not in E["pred"]:
        E["pred"]["feat_lr_full"] = E["pred"]["feat_lr"]
    E["pred"]["feat_lr"] = pred[keep]
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
        print("  feat_lr(page) %s n=%d log loss %.4f" % (lab, sel.sum(), ll(pred[sel], yk[sel])))
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
    for r in rows:
        r["puA"], r["puB"] = (r["slugA"], r["id"]) in snaps, (r["slugB"], r["id"]) in snaps
    G[:, GATE_NAMES.index("preufc")] = [0.5 * r["puA"] + 0.5 * r["puB"] for r in rows]
    # the page computes the gate vector from raw inputs (src/ml/moe.js gateVector): check the twin agrees
    G2 = np.array([gate_vector(gate_inputs(r, None)) for r in rows])
    assert np.allclose(G, G2, atol=1e-9), "gate_vector twin disagrees with gating_matrix"
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
    return segs


def export_model(st, cal, experts, mu, sd, P_clip=PCLIP):
    m = {"method": st.method, "experts": experts, "pclip": P_clip,
         "gate": {"names": GATE_NAMES, "mu": [float(v) for v in mu], "sd": [float(v) for v in sd]},
         "calibration": cal.export()}
    if st.method == "gated":
        m["V"] = [[float(v) for v in row] for row in st.g.V]
        m["u"] = [float(v) for v in st.g.u]
    if st.method in ("linear", "gbm_res"):
        m["linear"] = {"+".join(e for e in experts if e in pat): {experts[i]: float(w) for i, w in zip(idx, lm.w)}
                       for pat, (idx, lm) in st.lin.items()}
    if st.method in ("gbm", "gbm_res"):
        m["trees"] = export_trees(st.b.m)
    return m


def export_trees(booster):
    """LightGBM trees as compact arrays: per tree [feature, threshold, left, right, default_left] per node
    (children < 0 are leaves: leaf index = -child - 1) and leaf values. Missing values (NaN) follow
    default_left as LightGBM does for missing_type NaN."""
    d = booster.dump_model()
    out = []
    for t in d["tree_info"]:
        nodes, leaves = [], []

        def walk(n):
            if "leaf_index" in n or "leaf_value" in n and "split_feature" not in n:
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
    R, P, y, rows, Gs, G = F["results"], F["P"], F["y"], F["rows"], F["Gs"], F["G"]
    dates, TR, VA, singles = F["dates"], F["TR"], F["VA"], F["singles"]
    clusters = np.array([r["date"] for r in rows])
    rep = {"singles": singles, "sets": {}, "ext_notes": F["ext_notes"]}
    va_idx = np.where(VA)[0]
    for sname, res in R.items():
        S = {"experts": res["experts"], "cv": res["cv"], "methods": {}}
        for m, out in res["methods"].items():
            mo = {"hp": out["hp"], "calibration": out["calibration"], "calibration_cv": out["calibration_cv"],
                  "patterns": {}}
            for key, pr in out["patterns"].items():
                idx, p = pr["_idx"], pr["_p"]
                ci = boot_ci(p, y[idx], clusters[idx])
                d = {"raw": pr["raw"], "cal": pr["cal"], "cal_all": pr["cal_all"], "ci": ci}
                if "market" in key.split("+"):
                    okm = np.isfinite(P["market"][idx])
                    d["vs_market"] = boot_ci(p[okm], y[idx][okm], clusters[idx][okm], ref=P["market"][idx][okm])
                else:
                    # vs the best single non-market expert of the set on the validation rows
                    cands = [e for e in key.split("+") if np.isfinite(P[e][idx]).all()]
                    best = min(cands, key=lambda e: ll(P[e][idx], y[idx])) if cands else None
                    if best:
                        d["vs_best_single"] = dict(boot_ci(p, y[idx], clusters[idx], ref=P[best][idx]), expert=best)
                mo["patterns"][key] = d
            S["methods"][m] = mo
        rep["sets"][sname] = S

    # ---- choose the exported model: page set, best forward-chained CV score (2021-2023), never 2024+
    page = R["page"]
    best_m = min(page["methods"], key=lambda m: page["cv"]["%s %s" % (m, page["methods"][m]["hp"])])
    rep["chosen"] = {"set": "page", "method": best_m, "rule": "lowest forward-chained CV log loss (val years "
                     "2021-2023, mean over the four availability patterns); 2024-2025 not used for the choice"}
    log("chosen for export: page/%s" % best_m)
    experts = page["experts"]
    out = page["methods"][best_m]

    # ---- segments for the chosen model (with and without market) vs single experts
    segs = {}
    key_full = "+".join(experts)
    key_nm = "+".join(e for e in experts if e != "market")
    pf, idx_f = out["patterns"][key_full]["_p"], out["patterns"][key_full]["_idx"]
    pn, idx_n = out["patterns"][key_nm]["_p"], out["patterns"][key_nm]["_idx"]
    full_alt = {}
    for m2, o2 in R["full"]["methods"].items():
        kf = "+".join(R["full"]["experts"])
        full_alt[m2] = o2["patterns"][kf]
    best_full = min(full_alt, key=lambda m2: R["full"]["cv"]["%s %s" % (m2, R["full"]["methods"][m2]["hp"])])
    pfa_map = dict(zip(full_alt[best_full]["_idx"], full_alt[best_full]["_p"]))
    common = np.array(sorted(set(idx_f) & set(idx_n)))
    pf_map, pn_map = dict(zip(idx_f, pf)), dict(zip(idx_n, pn))
    SM = segment_masks(rows, P, common)
    for sgn, mask in SM.items():
        ii = common[mask]
        if len(ii) < 25:
            continue
        yy = y[ii]
        cl = clusters[ii]
        e = {"n": int(len(ii))}
        e["moe_market"] = ll(np.array([pf_map[i] for i in ii]), yy)
        e["moe_full_market"] = ll(np.array([pfa_map.get(i, np.nan) for i in ii]), yy) if all(i in pfa_map for i in ii) else None
        e["moe_nomarket"] = ll(np.array([pn_map[i] for i in ii]), yy)
        for k in ("market", "engine", experts[2], "elo", "feat_gbm", "glicko"):
            if k in P and np.isfinite(P[k][ii]).all():
                e[k] = ll(P[k][ii], yy)
        e["d_moe_vs_market"] = boot_ci(np.array([pf_map[i] for i in ii]), yy, cl, ref=P["market"][ii], B=1000)
        nm_single = min((k for k in ("engine", experts[2], "elo") if k in e), key=lambda k: e[k])
        e["d_nomarket_vs_best_single"] = dict(boot_ci(np.array([pn_map[i] for i in ii]), yy, cl, ref=P[nm_single][ii], B=1000),
                                              expert=nm_single)
        segs[sgn] = e
    rep["segments"] = segs
    rep["calibration_valid"] = {
        "moe_market": calib_table(np.array([pf_map[i] for i in common]), y[common]),
        "moe_nomarket": calib_table(np.array([pn_map[i] for i in common]), y[common]),
        "market": calib_table(P["market"][common], y[common])}

    # gate weights on validation rows (how much each expert is trusted, by segment)
    st = out["_model"]
    L = np.column_stack([logit(np.clip(P[k], PCLIP, 1 - PCLIP)) for k in experts])
    M = np.column_stack([np.isfinite(P[k]) for k in experts])
    L = np.where(M, L, 0.0)
    if best_m == "gated":
        _ = st.g.logit(L[common], M[common], Gs[common])
        PI, s = st.g.last_pi, st.g.last_s
        gw = {}
        for sgn, mask in SM.items():
            if mask.sum() >= 25:
                gw[sgn] = {"weights": {e: round(float(PI[mask, j].mean()), 4) for j, e in enumerate(experts)},
                           "scale": round(float(s[mask].mean()), 4)}
        Mn = M.copy()
        Mn[:, experts.index("market")] = False
        _ = st.g.logit(L[common], Mn[common], Gs[common])
        PI2, s2 = st.g.last_pi, st.g.last_s
        for sgn, mask in SM.items():
            if mask.sum() >= 25:
                gw[sgn]["no_market"] = {"weights": {e: round(float(PI2[mask, j].mean()), 4) for j, e in enumerate(experts)
                                                    if e != "market"}, "scale": round(float(s2[mask].mean()), 4)}
        rep["gate_weights_valid"] = gw

    # ---- production refit on 2019-2025 (same hyper-parameters); calibration on forward-chained OOF 2021-2025
    ALL = TR | VA
    yr = years_of(dates)
    hp = out["hp"]
    oof = []
    for Y in (2021, 2022, 2023, 2024, 2025):
        tr = ALL & (yr < Y)
        te = ALL & (yr == Y)
        s_ = Stacker(best_m, experts, F["DROPS"], hp).fit(L[tr], M[tr], Gs[tr], y[tr])
        for d in F["DROPS"]:
            keep = np.array([e not in d for e in experts])
            Md = M[te] & keep[None, :]
            ok = Md.any(1)
            oof.append((s_.logit(L[te][ok], Md[ok], Gs[te][ok]), y[te][ok]))
    zc = np.concatenate([a for a, _ in oof])
    yc = np.concatenate([b for _, b in oof])
    cal_prod = Calib(out["calibration"]).fit(zc, yc)
    st_prod = Stacker(best_m, experts, F["DROPS"], hp).fit(L[ALL], M[ALL], Gs[ALL], y[ALL])
    model_prod = export_model(st_prod, cal_prod, experts, F["mu"], F["sd"])
    model_val = export_model(st, out["_cal"], experts, F["mu"], F["sd"])

    # alternative exports (all three families, page set) so the page can switch
    alts = {}
    for m2, o2 in page["methods"].items():
        if m2 != best_m and m2 in ("linear", "gated"):
            alts[m2] = export_model(o2["_model"], o2["_cal"], experts, F["mu"], F["sd"])

    # ---- test vectors: Python predictions the JS evaluator must reproduce (validation rows, all patterns,
    # both corner orders)
    rng = np.random.default_rng(5)
    tv = []
    pick = rng.choice(np.where(VA)[0], size=min(60, VA.sum()), replace=False)
    for j, i in enumerate(pick):
        d = F["DROPS"][j % len(F["DROPS"])]
        ex = {e: (None if (e in d or not np.isfinite(P[e][i])) else float(P[e][i])) for e in experts}
        gate = gate_inputs(rows[i], G[i])
        for sign in (1, -1):
            exs = {e: (None if v is None else (v if sign == 1 else 1 - v)) for e, v in ex.items()}
            gs = gate if sign == 1 else swap_gate(gate)
            gv = gate_vector(gs)
            tv.append({"experts": exs, "gate": gs,
                       "p_prod": float(predict_py(model_prod, st_prod, cal_prod, exs, gv, experts, F["mu"], F["sd"])),
                       "p_valid": float(predict_py(model_val, st, out["_cal"], exs, gv, experts, F["mu"], F["sd"]))})
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
                         "decisive UFC fights 2010-2025, 'coef_valid' on 2010-2023 (produced the 2024-2025 numbers); "
                         "priors = division rates from fights 2021-2025"}
        ent = {e["id"]: e for e in prep["entries"]}
        ftv = []
        rng2 = np.random.default_rng(9)
        for i in rng2.choice(np.where(VA)[0], size=min(40, VA.sum()), replace=False):
            e = ent[rows[i]["id"]]
            sides = []
            for t in ("A", "B"):
                s = e[t]
                sides.append({k: s.get(k) for k in ("S", "age", "height_in", "reach_in", "n", "ko_losses", "kd_absorbed",
                                                     "elo", "cmin", "w", "l", "streak", "last3", "n5", "fin_w", "fin_l",
                                                     "layoff", "stance", "home")})
            div = e.get("prior_division") or e["division"]
            PA = prep["priors_asof"][e["date"][:4]]
            ftv.append({"A": sides[0], "B": sides[1], "division": div, "priors": psub({div: PA.get(div) or PA["ALL"],
                        "ALL": PA["ALL"]}), "p_valid": float(P["feat_lr"][i])})
        feat["test_vectors"] = ftv

    doc = {
        "feat": feat,
        "meta": {"tool": "tools/moe.py", "built": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
                 "train": TRAIN, "valid": VALID, "vault_excluded_from": VAULT_FROM.isoformat(),
                 "orientation": "every probability is P(first-named fighter A wins); the model is exactly symmetric "
                                "(swap A/B -> 1 - p)",
                 "experts": {
                     "market": "de-vigged closing moneyline (power method) P(A); optional",
                     "engine": "FightEngine.summarize pA / (pA + pB) (draws removed)",
                     "ml": "ML expert P(A) (tools/ml.py page model when present, else the feature LR in moe.json 'feat')",
                     "feat_lr": "feature logistic regression (moe.json 'feat'; computable from fighters.json profiles)",
                     "elo": "1 / (1 + 10^((eloB - eloA) / 400)) with fighters.json elo"},
                 "gate_inputs": {"nA/nB": "prior UFC fights", "cminA/cminB": "career UFC minutes",
                                 "eloA/eloB": "Elo", "rounds": "3 or 5", "division": "fight division",
                                 "layoffA/layoffB": "days since the fighter's previous UFC fight (null = debut-like, 365)",
                                 "ageA/ageB": "age in years at the fight date (null = 30)",
                                 "preufcA/preufcB": "true when tools/preufc.py has the fighter's pre-UFC record"},
                 "notes": "Production model refit on 2019-2025 with the hyper-parameters chosen by forward-chained CV "
                          "inside 2019-2023; model_validated is the 2019-2023 fit that produced the 2024-2025 report."},
        "model": model_prod, "model_validated": model_val, "alternatives": alts,
        "report": strip_private(rep), "test_vectors": tv}
    wjson(os.path.join(DERIVED, "moe.json"), doc)
    with open(os.path.join(CACHE, "report.json"), "w") as fh:
        json.dump(strip_private(rep), fh, indent=1, default=float)
    log("wrote data/derived/moe.json")


def strip_private(o):
    if isinstance(o, dict):
        return {k: strip_private(v) for k, v in o.items() if not str(k).startswith("_")}
    if isinstance(o, (list, tuple)):
        return [strip_private(v) for v in o]
    if isinstance(o, np.ndarray):
        return [strip_private(v) for v in o.tolist()]
    if isinstance(o, np.generic):
        o = o.item()
    if isinstance(o, float) and not math.isfinite(o):
        return None
    return o


def gate_inputs(r, g):
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


def predict_py(model, st, cal, ex, g_raw, experts, mu, sd):
    L = np.array([[logit(np.clip(ex[e], PCLIP, 1 - PCLIP)) if ex[e] is not None else 0.0 for e in experts]])
    M = np.array([[ex[e] is not None for e in experts]])
    Gs = np.hstack([[1.0], (g_raw - mu) / sd])[None, :]
    z = st.logit(L, M, Gs)
    return cal(sigm(z))[0]


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
