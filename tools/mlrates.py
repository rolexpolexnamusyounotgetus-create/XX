#!/usr/bin/env python3
"""Learned matchup stat-line model (mlrates): per-fight expected rates for the fight engine.

For every UFC fight-side since 2010 (attacker X vs defender Y) this builds pre-fight features of both men
from walk-forward decayed sums (the same S sums the engine reads), and learns the attacker's realised
per-minute rates in that fight:

  counts (Poisson, minutes as exposure):   d_att c_att g_att (position), h_att b_att l_att (target),
                                           td_att, sub_att, rev, ctrl (seconds; quasi-Poisson)
  probabilities (binomial):                acc_h acc_b acc_l (target), acc_d acc_c acc_g (position),
                                           td_acc (td_lnd / td_att), kd_h (kd / h_lnd)

Models: a ridge GLM with interactions (numpy IRLS), LightGBM (Poisson / cross-entropy with offsets), and a
small multi-task MLP (torch), all with the league rate of the fight's division (walk-forward priors) as the
offset, compared on the 2024-2025 validation fights against (a) engine v3's own static log-linear
expectation (src/engine3.js matchup(), recalibrated per stat on training rows) and (b) the league average.
The chosen model is exported as data/derived/mlrates.json with a dependency-free evaluator in
src/ml/mlrates.js (features + model + adapter that rewrites an engine matchup's rates).

Hidden-data protocol: every fight dated 2026-01-01 or later is dropped right after parsing; training rows
are 2010-2023 (time-ordered CV inside), 2024-2025 is validation (model selection only). The production
export is refit on 2010-2025 with the selected hyperparameters; data/derived/mlrates_dev.json is the
2010-2023 fit used for every validation number and for honest engine backtests.

    python3 tools/mlrates.py build     # dataset (about 1 minute)
    python3 tools/mlrates.py engine    # engine v3 static expectations for every row (node)
    python3 tools/mlrates.py fit       # CV + validation + export
    python3 tools/mlrates.py sim       # simulator with ML rates vs plain engine on validation fights
    python3 tools/mlrates.py all
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import pickle
import subprocess
import sys
import time
from collections import Counter, defaultdict

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import build_db as B  # noqa: E402

OUT = os.path.join(ROOT, "data", "derived")
CACHE = os.environ.get("MLRATES_CACHE", os.path.join(ROOT, "out", "mlrates_cache"))
CUTOFF = dt.date(2026, 1, 1)          # hidden-data protocol: nothing on or after this date is read
TRAIN_FROM = dt.date(2010, 1, 1)
VAL_FROM = dt.date(2024, 1, 1)
HALF_LIFE = 730.0                    # same as fighters.json / backtest S sums
PRIOR_WINDOW = 5                     # years of fights before Jan 1 of the fight's year (backtest priors_asof)
KEYS = B.KEYS
KI = B.KI

# ------------------------------------------------------------------ feature constants (exported with the model)
FC = {
    "gs": 0.84,       # share of control time on the ground (engine ctrlGroundShare)
    "kPM": 40.0,      # per-minute prior strength (minutes)
    "kAcc": 150.0,    # accuracy prior strength (attempts)
    "kTdPM": 45.0,    # takedown attempts per minute prior strength (minutes)
    "kTdAcc": 12.0,   # takedown accuracy prior strength (attempts)
    "kKD": 230.0,     # KD per landed head strike prior strength (landed head strikes)
    "kCtrlTD": 4.0,   # control per takedown prior strength (takedowns)
    "kRev": 40.0,     # reversals prior strength (minutes)
    "kFin": 3.0,      # finish rate per fight prior strength (fights)
    "bot": 0.12,      # bottom-man ground strike rate relative to the top man (engine gBotRel)
}

# targets: (name, kind, numerator key, exposure) ; exposure "min" = fight minutes, else a key (trials)
TARGETS = [
    ("d_att", "pois", "d_att", "min"), ("c_att", "pois", "c_att", "min"), ("g_att", "pois", "g_att", "min"),
    ("h_att", "pois", "h_att", "min"), ("b_att", "pois", "b_att", "min"), ("l_att", "pois", "l_att", "min"),
    ("td_att", "pois", "td_att", "min"), ("sub_att", "pois", "sub_att", "min"), ("rev", "pois", "rev", "min"),
    ("ctrl", "pois", "ctrl", "min"),
    ("acc_h", "binom", "h_lnd", "h_att"), ("acc_b", "binom", "b_lnd", "b_att"), ("acc_l", "binom", "l_lnd", "l_att"),
    ("acc_d", "binom", "d_lnd", "d_att"), ("acc_c", "binom", "c_lnd", "c_att"), ("acc_g", "binom", "g_lnd", "g_att"),
    ("td_acc", "binom", "td_lnd", "td_att"), ("kd_h", "binom", "kd", "h_lnd"),
]
TNAMES = [t[0] for t in TARGETS]
# league base value of each target in a priors object (per fighter-minute, or a probability)
BASE_KEY = {"d_att": "d_att", "c_att": "c_att", "g_att": "g_att", "h_att": "h_att", "b_att": "b_att",
            "l_att": "l_att", "td_att": "td_att", "sub_att": "sub_att", "rev": "rev", "ctrl": "ctrl",
            "acc_h": "acc_h", "acc_b": "acc_b", "acc_l": "acc_l", "acc_d": "acc_d", "acc_c": "acc_c",
            "acc_g": "acc_g", "td_acc": "td_acc", "kd_h": "kd_per_h"}

DIV_LBS = dict(B.LBS)
WOMEN = {"Women's Strawweight", "Women's Flyweight", "Women's Bantamweight", "Women's Featherweight"}


def log(*a):
    print(*a, flush=True)


# ------------------------------------------------------------------ small math (mirrored in src/ml/mlrates.js)
def shr(ev, ex, prior, k):
    return (ev + k * prior) / (max(0.0, ex) + k)


def lr(a, b):
    return math.log(max(a, 1e-9) / max(b, 1e-9))


def lgt(p):
    p = min(max(p, 1e-6), 1 - 1e-6)
    return math.log(p / (1 - p))


def pget(P, k, d=0.0):
    v = P.get(k)
    return d if v is None else float(v)


# ------------------------------------------------------------------ fighter block
OFF_NAMES = ["d", "c", "g", "h", "b", "l", "t", "ah", "ab", "al", "ad", "ac", "ag", "kd", "tda", "tdp", "ctrl",
             "cpt", "sub", "subm", "rev", "fko", "fsub"]
EV_NAMES = ["min", "n", "hatt", "tda"]


def league(P):
    gs = FC["gs"]
    cf = pget(P, "ctrl") / 60.0
    Lg = 2 * cf * gs
    Lc = 2 * cf * (1 - gs)
    Ld = 1 - Lg - Lc
    return {"Lg": Lg, "Lc": Lc, "Ld": Ld, "Ls": 1 - Lg, "Lt": cf * gs,
            "dAtt": pget(P, "d_att") / Ld, "gAtt": pget(P, "g_att") / max(cf * gs, 1e-6),
            "tdAtt": pget(P, "td_att") / (1 - Lg), "sub": pget(P, "sub_att") / max(Lg, 1e-6),
            "rev": pget(P, "rev") / max(cf * gs, 1e-6)}


def fighter_block(s, P, L):
    """s: dict of decayed sums. Returns (off, dfn, ev): offense log-ratios, defense (allowed) log-ratios,
    evidence. Rates are shrunk toward the division prior P exactly like engine3 fighterRates (simplified)."""
    gs = FC["gs"]
    kPM, kAcc = FC["kPM"], FC["kAcc"]
    mn = max(0.0, s["min"])
    topMin = s["ctrl"] / 60.0 * gs
    botMin = s["octrl"] / 60.0 * gs
    grMin = topMin + botMin
    clMin = (s["ctrl"] + s["octrl"]) / 60.0 * (1 - gs)
    distMin = max(0.25 * mn, mn - grMin - clMin)
    standMin = max(0.3 * mn, mn - grMin)
    nf = max(0.0, s["n"])
    pko = pget(P, "ko_w") / max(pget(P, "n"), 1e-9)
    psub = pget(P, "sub_w") / max(pget(P, "n"), 1e-9)

    def side(o):
        g = lambda k: s[o + k]
        r = []
        r.append(lr(shr(g("d_att"), distMin, L["dAtt"], kPM * L["Ld"]), L["dAtt"]))
        r.append(lr(shr(g("c_att"), mn, pget(P, "c_att"), kPM), pget(P, "c_att")))
        r.append(lr(shr(g("g_att"), botMin if o else topMin, L["gAtt"], kPM * L["Lt"]), L["gAtt"]))
        for k in ("h", "b", "l", "t"):
            r.append(lr(shr(g(k + "_att"), mn, pget(P, k + "_att"), kPM), pget(P, k + "_att")))
        for k in ("h", "b", "l", "d", "c", "g"):
            pa = pget(P, "acc_" + k, 0.5)
            r.append(lgt(shr(g(k + "_lnd"), g(k + "_att"), pa, kAcc)) - lgt(pa))
        kdp = pget(P, "kd_per_h", 0.01)
        r.append(lr(shr(g("kd"), g("h_lnd"), kdp, FC["kKD"]), kdp))
        r.append(lr(shr(g("td_att"), standMin, L["tdAtt"], FC["kTdPM"] * L["Ls"]), L["tdAtt"]))
        ta = pget(P, "td_acc", 0.35)
        r.append(lgt(shr(g("td_lnd"), g("td_att"), ta, FC["kTdAcc"])) - lgt(ta))
        r.append(lr(shr(g("ctrl"), mn, pget(P, "ctrl"), kPM), pget(P, "ctrl")))
        cpt = pget(P, "ctrl_per_td", 100.0)
        r.append(lr(shr(g("ctrl"), g("td_lnd"), cpt, FC["kCtrlTD"]), cpt))
        r.append(lr(shr(g("sub_att"), grMin, L["sub"], kPM * L["Lg"]), L["sub"]))
        r.append(lr(shr(g("sub_att"), mn, pget(P, "sub_att"), kPM), pget(P, "sub_att")))
        r.append(lr(shr(g("rev"), topMin if o else botMin, L["rev"], FC["kRev"] * L["Lt"]), L["rev"]))
        if o:
            r.append(lr(shr(s["ko_l"], nf, pko, FC["kFin"]), pko))
            r.append(lr(shr(s["sub_l"], nf, psub, FC["kFin"]), psub))
        else:
            r.append(lr(shr(s["ko_w"], nf, pko, FC["kFin"]), pko))
            r.append(lr(shr(s["sub_w"], nf, psub, FC["kFin"]), psub))
        return r

    off = side("")
    dfn = side("o")
    ev = [math.log1p(mn), math.log1p(nf), math.log1p(s["h_att"] + s["oh_att"]), math.log1p(s["td_att"] + s["otd_att"])]
    return off, dfn, ev


def sums_dict(S, keys=KEYS):
    o = {k: 0.0 for k in KEYS}
    if S is None:
        return o
    if isinstance(S, dict):
        for k, v in S.items():
            o[k] = float(v or 0.0)
    else:
        for k, v in zip(keys, S):
            o[k] = float(v or 0.0)
    return o


COMBOS = ["d", "c", "g", "h", "b", "l", "t", "ah", "ab", "al", "ad", "ac", "ag", "kd", "tda", "tdp", "ctrl",
          "sub", "subm", "rev"]
CTX_NAMES = ["r5", "title", "women", "lbs", "year", "ageX", "ageY", "age_na", "reach_d", "height_d", "reach_na",
             "southX", "southY", "switchX", "switchY", "oppst", "eloX", "eloY", "nX", "nY", "debutX", "debutY",
             "upX", "upY", "kolX", "kolY", "layX", "layY", "layX_na", "layY_na"]
EXP_NAMES = ["e_dist", "e_grX", "e_grY", "e_cl", "e_d", "e_c", "e_g", "e_h", "e_b", "e_l", "e_tda", "e_ctrl",
             "e_sub", "e_rev"]


def feature_names():
    names = []
    for pre in ("xo_", "xd_", "yo_", "yd_"):
        names += [pre + n for n in OFF_NAMES]
    names += ["xe_" + n for n in EV_NAMES] + ["ye_" + n for n in EV_NAMES]
    names += ["c_" + n for n in COMBOS]
    names += EXP_NAMES
    names += CTX_NAMES
    return names


FNAMES = feature_names()
FI = {n: i for i, n in enumerate(FNAMES)}


def stance_code(st):
    st = (st or "").lower()
    return 1 if st.startswith("south") else (2 if st.startswith("switch") else (0 if st.startswith("ortho") else -1))


def features(X, Y, ctx, P):
    """X, Y: side dicts {S (dict), age, n, elo, ko_losses, home, height_in, reach_in, stance, layoff}.
    ctx: {rounds, title, division (fight division), year}. P: priors of the shrinkage division.
    Returns (feature list, base dict of league values for the offsets)."""
    L = league(P)
    xo, xd, xe = fighter_block(X["S"], P, L)
    yo, yd, ye = fighter_block(Y["S"], P, L)
    f = xo + xd + yo + yd + xe + ye
    io = {n: i for i, n in enumerate(OFF_NAMES)}
    combo = [xo[io[n]] + yd[io[n]] for n in COMBOS]
    f += combo
    cm = dict(zip(COMBOS, combo))
    gs = FC["gs"]
    Pc = pget(P, "ctrl")
    ctrlX = Pc * math.exp(cm["ctrl"])
    ctrlY = Pc * math.exp(yo[io["ctrl"]] + xd[io["ctrl"]])
    grX = min(0.7, ctrlX / 60.0 * gs)
    grY = min(0.7, ctrlY / 60.0 * gs)
    clT = (ctrlX + ctrlY) / 60.0 * (1 - gs)
    dist = max(0.12, 1 - grX - grY - clT)
    stand = max(0.2, 1 - grX - grY)
    f += [math.log(dist), math.log(grX + 1e-3), math.log(grY + 1e-3), math.log(clT + 1e-3),
          math.log(L["dAtt"]) + cm["d"] + math.log(dist),
          math.log(pget(P, "c_att")) + cm["c"],
          math.log(L["gAtt"]) + cm["g"] + math.log(grX + FC["bot"] * grY + 1e-3),
          math.log(pget(P, "h_att")) + cm["h"],
          math.log(pget(P, "b_att")) + cm["b"],
          math.log(pget(P, "l_att")) + cm["l"],
          math.log(L["tdAtt"]) + cm["tda"] + math.log(stand),
          math.log(ctrlX),
          math.log(L["sub"]) + cm["sub"] + math.log(grX + grY + 1e-3),
          math.log(L["rev"]) + cm["rev"] + math.log(grY + 1e-3)]
    # context
    div = ctx["division"]
    lbs_f = DIV_LBS.get(div) or pget(P, "lbs", 155.0) or 155.0
    women = 1.0 if (div in WOMEN or (ctx.get("prior_division") in WOMEN)) else 0.0
    ax, ay = X.get("age"), Y.get("age")
    age_na = 1.0 if (ax is None or ay is None) else 0.0
    rx, ry, hx, hy = X.get("reach_in"), Y.get("reach_in"), X.get("height_in"), Y.get("height_in")
    reach_na = 1.0 if (rx is None or ry is None) else 0.0
    sx, sy = stance_code(X.get("stance")), stance_code(Y.get("stance"))
    oppst = 1.0 if ((sx == 0 and sy == 1) or (sx == 1 and sy == 0)) else 0.0

    def up(side):
        h = side.get("home")
        hl = DIV_LBS.get(h) if h else None
        return min(3.0, max(-3.0, (lbs_f - hl) / 10.0)) if (hl and lbs_f) else 0.0

    def lay(side):
        v = side.get("layoff")
        return (math.log1p(v / 30.4), 0.0) if v is not None else (0.0, 1.0)

    lx, lxn = lay(X)
    ly, lyn = lay(Y)
    f += [1.0 if ctx["rounds"] == 5 else 0.0, 1.0 if ctx.get("title") else 0.0, women,
          math.log(lbs_f / 155.0), (ctx["year"] - 2018) / 10.0,
          (ax - 30.0) / 5.0 if ax is not None else 0.0, (ay - 30.0) / 5.0 if ay is not None else 0.0, age_na,
          (rx - ry) / 3.0 if not reach_na else 0.0,
          (hx - hy) / 3.0 if (hx is not None and hy is not None) else 0.0, reach_na,
          1.0 if sx == 1 else 0.0, 1.0 if sy == 1 else 0.0, 1.0 if sx == 2 else 0.0, 1.0 if sy == 2 else 0.0, oppst,
          ((X.get("elo") or 1500.0) - 1500.0) / 100.0, ((Y.get("elo") or 1500.0) - 1500.0) / 100.0,
          math.log1p(X.get("n") or 0), math.log1p(Y.get("n") or 0),
          1.0 if not X.get("n") else 0.0, 1.0 if not Y.get("n") else 0.0,
          up(X), up(Y), min(5, X.get("ko_losses") or 0), min(5, Y.get("ko_losses") or 0),
          lx, ly, lxn, lyn]
    base = {}
    for t in TNAMES:
        base[t] = pget(P, BASE_KEY[t], 0.0)
    return f, base


# ------------------------------------------------------------------ dataset from raw data
def build_dataset():
    t0 = time.time()
    lg = {}
    fights, _ = B.parse_fights(lg)
    n_all = len(fights)
    fights = [f for f in fights if f.date < CUTOFF]
    log("parsed %d fights; kept %d before %s (hidden-data protocol)" % (n_all, len(fights), CUTOFF))
    people = B.build_people(fights, lg)
    B.build_vectors(fights, lg)
    rep = json.load(open(os.path.join(OUT, "elo_report.json")))
    K, boost = rep["chosen"]["K"], rep["chosen"]["boost"]
    _, elo_pre, _ = B.run_elo(fights, K, boost, store=True)
    years = list(range(TRAIN_FROM.year - 2, CUTOFF.year + 1))
    priors = {str(y): B.build_priors(fights, dt.date(y - PRIOR_WINDOW, 1, 1), dt.date(y, 1, 1)) for y in years}
    log("priors by year %s-%s; elo K=%s boost=%s" % (years[0], years[-1], K, boost))

    lam = math.log(2) / HALF_LIFE
    state = defaultdict(lambda: {"S": np.zeros(B.NK), "t": None, "n": 0, "kol": 0, "kd_abs": 0.0, "hist": [],
                                 "last": None})
    rows = []
    for f in fights:
        a, b = f.persons
        if a == b:
            continue
        sa, sb = state[a], state[b]
        for stt in (sa, sb):
            if stt["t"] is not None and f.day > stt["t"]:
                stt["S"] *= math.exp(-lam * (f.day - stt["t"]))
            stt["t"] = f.day if stt["t"] is None else max(stt["t"], f.day)
        if (f.date >= dt.date(TRAIN_FROM.year - 2, 1, 1) and f.stats and f.stats["min"] > 0
                and not a.startswith("amb:") and not b.startswith("amb:")):
            sides = []
            for p, stt, elo in ((a, sa, elo_pre[f.fid][0]), (b, sb, elo_pre[f.fid][1])):
                P_ = people[p]
                T = P_["tott"] or {}
                dob = T.get("dob")
                sides.append({
                    "slug": P_.get("slug"), "S": stt["S"].copy(), "n": stt["n"], "ko_losses": stt["kol"],
                    "age": (f.date - dob).days / 365.25 if dob else None, "elo": float(elo),
                    "home": B.mode_recent(stt["hist"], f.day) if stt["hist"] else None,
                    "height_in": T.get("height_in"), "reach_in": T.get("reach_in"), "stance": T.get("stance"),
                    "layoff": (f.day - stt["last"]) if stt["last"] is not None else None,
                })
            pdiv = f.division
            if f.division in B.NON_DIV:
                homes = [s["home"] for s in sides if B.LBS.get(s["home"])]
                pdiv = max(homes, key=lambda d: B.LBS[d]) if homes else "ALL"
            rows.append({"id": f.fid, "date": f.date.isoformat(), "year": f.date.year, "division": f.division,
                         "prior_division": pdiv, "rounds": f.sched, "title": bool(f.title), "sides": sides,
                         "v": [f.stats["v"][0].copy(), f.stats["v"][1].copy()], "minutes": float(f.stats["min"]),
                         "winner": f.winner, "method": f.method, "rnd": f.rnd, "time_s": f.time_s,
                         "fight_s": f.fight_s})
        for s, p, stt in ((0, a, sa), (1, b, sb)):
            if f.stats:
                stt["S"] += f.stats["v"][s]
            stt["n"] += 1
            stt["hist"].append((f.day, f.division))
            stt["last"] = f.day
            lost = f.winner == ("B" if s == 0 else "A")
            if lost and f.method == "KO":
                stt["kol"] += 1
    log("fight rows with stats since %d: %d (%.1fs)" % (TRAIN_FROM.year - 2, len(rows), time.time() - t0))
    return rows, priors


def side_profile(sd):
    return {"S": sums_dict(sd["S"]), "age": sd["age"], "n": sd["n"], "elo": sd["elo"], "ko_losses": sd["ko_losses"],
            "home": sd["home"], "height_in": sd["height_in"], "reach_in": sd["reach_in"], "stance": sd["stance"],
            "layoff": sd["layoff"]}


def prior_for(priors_y, div):
    allp = priors_y.get("ALL", {})
    d = priors_y.get(div) or allp
    out = dict(allp)
    out.update({k: v for k, v in d.items() if v is not None})
    return out


def make_matrix(rows, priors):
    """Two rows per fight (each side attacking). Returns dict of arrays."""
    F, Y, E, BASE, meta = [], [], [], [], []
    for ri, r in enumerate(rows):
        P = prior_for(priors[str(r["year"])], r["prior_division"])
        ctx = {"rounds": r["rounds"], "title": r["title"], "division": r["division"],
               "prior_division": r["prior_division"], "year": r["year"]}
        prof = [side_profile(r["sides"][0]), side_profile(r["sides"][1])]
        for s in (0, 1):
            f, base = features(prof[s], prof[1 - s], ctx, P)
            v = r["v"][s]
            y, e = [], []
            for name, kind, num, ex in TARGETS:
                y.append(v[KI[num]])
                e.append(r["minutes"] if ex == "min" else v[KI[ex]])
            F.append(f)
            Y.append(y)
            E.append(e)
            BASE.append([base[t] for t in TNAMES])
            meta.append((ri, s, r["year"], r["date"], prof[0]["n"] > 0 and prof[1]["n"] > 0))
    return {"X": np.array(F, dtype=np.float64), "Y": np.array(Y, dtype=np.float64),
            "E": np.array(E, dtype=np.float64), "BASE": np.array(BASE, dtype=np.float64),
            "row": np.array([m[0] for m in meta]), "side": np.array([m[1] for m in meta]),
            "year": np.array([m[2] for m in meta]), "date": np.array([m[3] for m in meta]),
            "both_prior": np.array([m[4] for m in meta])}


def cmd_build(args):
    os.makedirs(CACHE, exist_ok=True)
    rows, priors = build_dataset()
    t0 = time.time()
    M = make_matrix(rows, priors)
    log("matrix %s x %d features (%.1fs)" % (M["X"].shape[0], M["X"].shape[1], time.time() - t0))
    with open(os.path.join(CACHE, "dataset.pkl"), "wb") as fh:
        pickle.dump({"rows": rows, "priors": priors, "M": M, "fnames": FNAMES}, fh, protocol=4)
    log("wrote %s" % os.path.join(CACHE, "dataset.pkl"))


def load_dataset():
    with open(os.path.join(CACHE, "dataset.pkl"), "rb") as fh:
        return pickle.load(fh)


# ------------------------------------------------------------------ engine v3 static expectations (node)
def side_json(sd):
    return {"S": [B.rnd(x, 6) for x in sd["S"]], "age": sd["age"], "ko_losses": sd["ko_losses"], "home": sd["home"],
            "n": sd["n"], "elo": sd["elo"], "height_in": sd["height_in"], "reach_in": sd["reach_in"],
            "stance": sd["stance"], "layoff": sd["layoff"]}


def fight_json(r):
    return {"id": r["id"], "year": r["year"], "date": r["date"], "division": r["division"],
            "prior_division": r["prior_division"], "rounds": r["rounds"], "title": r["title"],
            "A": side_json(r["sides"][0]), "B": side_json(r["sides"][1])}


def priors_json(priors):
    return {y: {d: {k: v for k, v in P.items() if not isinstance(v, (dict, list))} for d, P in py.items()}
            for y, py in priors.items()}


def cmd_engine(args):
    d = load_dataset()
    rows = d["rows"]
    inp = os.path.join(CACHE, "engine_in.json")
    outp = os.path.join(CACHE, "engine_out.json")
    with open(inp, "w") as fh:
        json.dump({"priors": priors_json(d["priors"]), "fights": [fight_json(r) for r in rows]}, fh)
    t0 = time.time()
    subprocess.run(["node", os.path.join(HERE, "mlrates_engine.js"), "expect", inp, outp], check=True)
    eo = json.load(open(outp))
    E = np.full((len(d["M"]["row"]), len(TNAMES)), np.nan)
    for k, (ri, s) in enumerate(zip(d["M"]["row"], d["M"]["side"])):
        rr = eo["rows"][ri]
        if rr is not None:
            E[k] = [rr[s][t] for t in TNAMES]
    np.save(os.path.join(CACHE, "engine_expect.npy"), E)
    with open(os.path.join(CACHE, "engine_meta.json"), "w") as fh:
        json.dump({"params_version": eo["params_version"], "engine_version": eo["engine_version"]}, fh)
    log("engine expectations saved (%.1fs), params %s, NaN rows %d"
        % (time.time() - t0, eo["params_version"], int(np.isnan(E).any(axis=1).sum())))


# ------------------------------------------------------------------ deviances and links
def logit_np(p):
    p = np.clip(p, 1e-9, 1 - 1e-9)
    return np.log(p / (1 - p))


def sigm_np(z):
    return 1.0 / (1.0 + np.exp(-z))


def pois_dev(y, mu):
    mu = np.maximum(mu, 1e-12)
    t = np.where(y > 0, y * np.log(np.maximum(y, 1e-12) / mu), 0.0)
    return 2.0 * (t - (y - mu))


def binom_dev(y, n, p):
    p = np.clip(p, 1e-9, 1 - 1e-9)
    a = np.where(y > 0, y * np.log(np.maximum(y, 1e-12) / np.maximum(n * p, 1e-12)), 0.0)
    b = np.where(n - y > 0, (n - y) * np.log(np.maximum(n - y, 1e-12) / np.maximum(n * (1 - p), 1e-12)), 0.0)
    return 2.0 * (a + b)


def target_dev(t, y, e, eta):
    """Deviance per row for target index t, linear predictor eta (log rate per exposure unit, or logit)."""
    if TARGETS[t][1] == "pois":
        return pois_dev(y, e * np.exp(eta))
    return binom_dev(y, e, sigm_np(eta))


def link(t, v):
    return np.log(np.maximum(v, 1e-9)) if TARGETS[t][1] == "pois" else logit_np(v)


def inv_link(t, eta):
    return np.exp(eta) if TARGETS[t][1] == "pois" else sigm_np(eta)


# ------------------------------------------------------------------ ridge GLM with interactions (IRLS)
def glm_design(X, mean, sd, pairs):
    Z = (X - mean) / sd
    cols = [Z]
    if len(pairs):
        cols.append(Z[:, pairs[:, 0]] * Z[:, pairs[:, 1]])
    return np.hstack(cols)


def glm_fit(Z, y, e, off, kind, lam, w_extra=None, iters=30, init=None, tol=1e-6):
    """Ridge-penalised GLM by IRLS. Poisson: E[y] = e exp(off + b0 + Z b); binomial: y ~ Bin(e, sigm(off + b0 + Z b)).
    The intercept b0 is unpenalised. Returns (b0, b)."""
    n, p = Z.shape
    A = np.hstack([np.ones((n, 1)), Z])
    beta = np.zeros(p + 1) if init is None else np.concatenate([[init[0]], init[1]])
    pen = np.full(p + 1, lam)
    pen[0] = 0.0
    for _ in range(iters):
        eta = off + A @ beta
        if kind == "pois":
            mu = e * np.exp(np.clip(eta, -30, 30))
            W = mu
            z = (eta - off) + (y - mu) / np.maximum(mu, 1e-12)
        else:
            pr = sigm_np(eta)
            W = e * pr * (1 - pr)
            z = (eta - off) + (y - e * pr) / np.maximum(W, 1e-12)
        if w_extra is not None:
            W = W * w_extra
        AW = A * W[:, None]
        H = A.T @ AW + np.diag(pen)
        new = np.linalg.solve(H, AW.T @ z)
        if np.max(np.abs(new - beta)) < tol:
            beta = new
            break
        beta = new
    return beta[0], beta[1:]


def glm_predict(model, X, off):
    Z = glm_design(X, model["mean"], model["sd"], model["pairs"])
    return off + model["b0"] + Z @ model["b"]


# ------------------------------------------------------------------ multi-task MLP (torch)
def mlp_train(Xtr, Ytr, Etr, OFFtr, Xva=None, Yva=None, Eva=None, OFFva=None, hidden=(96, 48), drop=0.15,
              wd=1e-3, lr=2e-3, epochs=200, seed=0, task_w=None, patience=20, fixed_epochs=None, threads=2):
    import torch
    torch.set_num_threads(threads)
    torch.manual_seed(seed)
    np.random.seed(seed)
    kinds = [k for _, k, _, _ in TARGETS]
    pois_mask = torch.tensor([k == "pois" for k in kinds])
    mean = Xtr.mean(0)
    sd = Xtr.std(0) + 1e-6

    def T(a):
        return torch.tensor(a, dtype=torch.float32)

    xtr, ytr, etr, otr = T((Xtr - mean) / sd), T(Ytr), T(Etr), T(OFFtr)
    tw = T(task_w if task_w is not None else np.ones(len(kinds)))
    layers, d_in = [], Xtr.shape[1]
    for h in hidden:
        layers += [torch.nn.Linear(d_in, h), torch.nn.GELU(approximate="tanh"), torch.nn.Dropout(drop)]
        d_in = h
    head = torch.nn.Linear(d_in, len(kinds))
    torch.nn.init.zeros_(head.weight)
    torch.nn.init.zeros_(head.bias)
    net = torch.nn.Sequential(*layers, head)
    opt = torch.optim.AdamW(net.parameters(), lr=lr, weight_decay=wd)

    def loss_fn(out, y, e, o):
        eta = torch.clamp(o + out, -30, 30)
        valid = (e > 0).float()
        # Poisson NLL with exposure (per row), binomial NLL; both up to constants
        pl = e * torch.exp(eta) - y * eta
        bl = e * torch.nn.functional.softplus(eta) - y * eta
        l = torch.where(pois_mask[None, :], pl, bl) * valid
        return (l.sum(0) * tw).sum() / y.shape[0]

    have_val = Xva is not None
    if have_val:
        xva, yva, eva, ova = T((Xva - mean) / sd), T(Yva), T(Eva), T(OFFva)
    best, best_state, bad, n = float("inf"), None, 0, xtr.shape[0]
    n_ep = fixed_epochs or epochs
    hist = []
    for ep in range(n_ep):
        net.train()
        perm = torch.randperm(n)
        for i in range(0, n, 256):
            idx = perm[i:i + 256]
            opt.zero_grad()
            l = loss_fn(net(xtr[idx]), ytr[idx], etr[idx], otr[idx])
            l.backward()
            opt.step()
        if have_val and fixed_epochs is None:
            net.eval()
            with torch.no_grad():
                vl = float(loss_fn(net(xva), yva, eva, ova))
            hist.append(vl)
            if vl < best - 1e-5:
                best, bad = vl, 0
                best_state = ([p.detach().clone() for p in net.parameters()], ep + 1)
            else:
                bad += 1
                if bad >= patience:
                    break
    if best_state is not None:
        with torch.no_grad():
            for p, b in zip(net.parameters(), best_state[0]):
                p.copy_(b)
    net.eval()
    lin = [m for m in net if isinstance(m, torch.nn.Linear)]
    return {"mean": mean, "sd": sd, "W": [m.weight.detach().numpy().astype(np.float64) for m in lin],
            "b": [m.bias.detach().numpy().astype(np.float64) for m in lin],
            "epochs": best_state[1] if best_state is not None else n_ep, "act": "gelu_tanh"}


def gelu_np(x):
    """tanh-approximate GELU (torch GELU(approximate="tanh")); the JS evaluator uses the same formula."""
    return 0.5 * x * (1.0 + np.tanh(0.7978845608028654 * (x + 0.044715 * x ** 3)))


def mlp_predict(model, X):
    h = (X - model["mean"]) / model["sd"]
    nl = len(model["W"])
    for k in range(nl):
        h = h @ model["W"][k].T + model["b"][k]
        if k < nl - 1:
            h = gelu_np(h)
    return h            # add the offsets


# ------------------------------------------------------------------ LightGBM
GBM_PARAMS = dict(learning_rate=0.06, num_leaves=7, min_data_in_leaf=50, feature_fraction=0.7, bagging_fraction=0.8,
                  bagging_freq=1, lambda_l2=5.0, max_bin=63, verbose=-1, num_threads=2, seed=7,
                  min_sum_hessian_in_leaf=1e-3)


def gbm_fit(t, X, y, e, off, rounds, Xv=None, yv=None, ev=None, offv=None, patience=50, params=None):
    import lightgbm as lgb
    kind = TARGETS[t][1]
    p = dict(GBM_PARAMS, **(params or {}))
    p["objective"] = "poisson" if kind == "pois" else "cross_entropy"
    if kind == "pois":
        p["poisson_max_delta_step"] = 0.7
    d = lgb.Dataset(X, y / e, weight=e, init_score=off, free_raw_data=True)
    if Xv is not None:
        dv = lgb.Dataset(Xv, yv / ev, weight=ev, init_score=offv, reference=d)
        bst = lgb.train(p, d, rounds, valid_sets=[dv], callbacks=[lgb.early_stopping(patience, verbose=False)])
        return bst, bst.best_iteration
    bst = lgb.train(p, d, rounds)
    return bst, rounds


def gbm_trees(bst, n_iter=None):
    """Compact export: per tree {f, t, l, r, v}; child < 0 means leaf ~idx."""
    dm = bst.dump_model(num_iteration=n_iter)
    out = []
    for ti in dm["tree_info"]:
        F, Tt, Lc, Rc, V = [], [], [], [], []

        def walk(node):
            if "leaf_index" in node or "split_index" not in node:
                V.append(node.get("leaf_value", 0.0))
                return ~(len(V) - 1)
            k = len(F)
            F.append(int(node["split_feature"]))
            Tt.append(float(node["threshold"]))
            Lc.append(0)
            Rc.append(0)
            assert node.get("decision_type", "<=") == "<="
            Lc[k] = walk(node["left_child"])
            Rc[k] = walk(node["right_child"])
            return k

        root = ti["tree_structure"]
        if "split_index" not in root:
            V.append(root.get("leaf_value", 0.0))
        else:
            walk(root)
        out.append({"f": F, "t": Tt, "l": Lc, "r": Rc, "v": V})
    return out


def trees_eta(trees, X):
    s = np.zeros(X.shape[0])
    for T in trees:
        if not T["f"]:
            s += T["v"][0]
            continue
        f = np.array(T["f"])
        th = np.array(T["t"])
        L = np.array(T["l"])
        R = np.array(T["r"])
        V = np.array(T["v"])
        node = np.zeros(X.shape[0], dtype=np.int64)
        active = node >= 0
        while active.any():
            idx = np.where(active)[0]
            nd = node[idx]
            go_left = X[idx, f[nd]] <= th[nd]
            node[idx] = np.where(go_left, L[nd], R[nd])
            active = node >= 0
        s += V[~node]
    return s


# ------------------------------------------------------------------ export helpers
def sig(x, d=6):
    if isinstance(x, (list, tuple)):
        return [sig(v, d) for v in x]
    if isinstance(x, np.ndarray):
        return sig(x.tolist(), d)
    if isinstance(x, (int, np.integer)):
        return int(x)
    x = float(x)
    if x == 0 or not math.isfinite(x):
        return 0
    y = float("%.*g" % (d, x))
    return int(y) if y.is_integer() and abs(y) < 1e15 else y


def export_glm(g):
    return {"b0": sig(g["b0"], 8), "b": sig(g["b"], 7), "pairs": [[int(a), int(b)] for a, b in g["pairs"]]}


def export_mlp(net):
    return {"mean": sig(net["mean"], 8), "sd": sig(net["sd"], 8), "W": [sig(w, 6) for w in net["W"]],
            "b": [sig(b, 6) for b in net["b"]], "act": net["act"]}


def export_trees(trees):
    return [{"f": T["f"], "t": [float(repr(x)) for x in T["t"]], "l": T["l"], "r": T["r"], "v": sig(T["v"], 8)}
            for T in trees]


def load_mlp(d):
    return {"mean": np.array(d["mean"], float), "sd": np.array(d["sd"], float), "W": [np.array(w, float) for w in d["W"]],
            "b": [np.array(b, float) for b in d["b"]], "act": d["act"]}


def model_eta(J, X, BASEv):
    """Evaluate an exported model JSON (dict) on feature rows X with league bases BASEv -> eta per target (and the
    per-component deltas). Mirrors src/ml/mlrates.js etaSide()."""
    nt = len(J["targets"])
    off = np.column_stack([link(t, BASEv[:, t]) for t in range(nt)])
    comp = {}
    if J.get("glm"):
        mean = np.array(J["glm_mean"], float)
        sd = np.array(J["glm_sd"], float)
        g = np.zeros_like(off)
        for t in range(nt):
            G = J["glm"][t]
            if G is None:
                continue
            pairs = np.array(G["pairs"], dtype=int).reshape(-1, 2)
            Z = glm_design(X, mean, sd, pairs)
            g[:, t] = G["b0"] + Z @ np.array(G["b"], float)
        comp["glm"] = g
    if J.get("gbm"):
        g = np.zeros_like(off)
        for t in range(nt):
            if J["gbm"][t]:
                g[:, t] = trees_eta(J["gbm"][t], X)
        comp["gbm"] = g
    if J.get("mlp"):
        g = np.zeros_like(off)
        for net in J["mlp"]:
            g += mlp_predict(load_mlp(net), X) / len(J["mlp"])
        comp["mlp"] = g
    eta = off.copy()
    for t in range(nt):
        w = J["stack"][t]
        for k in ("glm", "gbm", "mlp"):
            if w.get(k) and k in comp:
                eta[:, t] += w[k] * comp[k][:, t]
    return eta, off, comp


# ------------------------------------------------------------------ fit pipeline
OOF_YEARS = [2020, 2021, 2022, 2023]          # time-ordered CV folds inside the training period
ES_SPLIT = (2017, (2018, 2019))               # round / epoch selection: train <= 2017, stop on 2018-2019
GLM_LAMS = [10.0, 50.0, 250.0, 1250.0]
GLM_TOP = 12                                   # interactions among the top-k GBM features of each target
MLP_CFG = dict(hidden=(96, 48), drop=0.15, wd=1e-3, lr=2e-3)
MLP_SEEDS = 2


def recal_const(t, y, e, mu):
    if TARGETS[t][1] == "pois":
        return math.log(max(y.sum(), 1e-9) / max((mu * e).sum(), 1e-9))
    z = logit_np(mu)
    c = 0.0
    for _ in range(40):
        p = sigm_np(z + c)
        c += (y - e * p).sum() / max((e * p * (1 - p)).sum(), 1e-9)
    return c


def boot_ci(diff_rows, rows_fight, reps=1000, seed=11):
    """Cluster (fight) bootstrap of the mean of per-row values. Returns (mean, lo, hi)."""
    rng = np.random.default_rng(seed)
    uf, inv = np.unique(rows_fight, return_inverse=True)
    sums = np.bincount(inv, weights=diff_rows)
    cnt = np.bincount(inv)
    nf = len(uf)
    st = []
    for _ in range(reps):
        k = rng.integers(0, nf, nf)
        st.append(sums[k].sum() / cnt[k].sum())
    st = np.array(st)
    return float(diff_rows.mean()), float(np.percentile(st, 2.5)), float(np.percentile(st, 97.5))


def calib_table(t, y, e, eta, nb=10):
    """Deciles of predicted rate/probability: predicted vs observed (sum y / sum e), and the calibration slope
    (GLM of y on eta with eta as the only covariate plus intercept)."""
    mu = inv_link(t, eta)
    ok = e > 0
    y, e, eta, mu = y[ok], e[ok], eta[ok], mu[ok]
    q = np.quantile(mu, np.linspace(0, 1, nb + 1))
    bins = []
    for k in range(nb):
        m = (mu >= q[k]) & ((mu < q[k + 1]) if k < nb - 1 else (mu <= q[k + 1]))
        if m.sum() == 0:
            continue
        bins.append({"pred": sig((mu[m] * e[m]).sum() / e[m].sum(), 4), "obs": sig(y[m].sum() / e[m].sum(), 4),
                     "n": int(m.sum())})
    # slope: fit y ~ e * g^-1(a + b * eta)
    Z = (eta - eta.mean())[:, None]
    b0, b = glm_fit(Z, y, e, np.full(len(y), eta.mean()), TARGETS[t][1], 1e-6, iters=25)
    return {"bins": bins, "slope": sig(b[0], 4), "intercept_shift": sig(b0, 4)}


def cmd_fit(args):
    import lightgbm  # noqa: F401
    t_start = time.time()
    d = load_dataset()
    M = d["M"]
    X, Y, EX, BASE = M["X"], M["Y"], M["E"], M["BASE"]
    ENG = np.load(os.path.join(CACHE, "engine_expect.npy"))
    eng_meta = json.load(open(os.path.join(CACHE, "engine_meta.json")))
    yr, bp = M["year"], M["both_prior"]
    fight = M["row"]
    nt = len(TNAMES)
    OFF = np.column_stack([link(t, BASE[:, t]) for t in range(nt)])
    trainM = (yr >= TRAIN_FROM.year) & (yr < VAL_FROM.year)
    valM = (yr >= VAL_FROM.year) & (yr < CUTOFF.year)
    assert not (yr >= CUTOFF.year).any()
    report = {"targets": TNAMES, "n_train_rows": int(trainM.sum()), "n_val_rows": int(valM.sum()),
              "n_val_rows_both_prior": int((valM & bp).sum()), "engine": eng_meta}
    log("rows: train %d, validation %d (both with a prior UFC fight: %d)" % (trainM.sum(), valM.sum(), (valM & bp).sum()))
    quick = args.quick
    global OOF_YEARS, MLP_SEEDS
    if quick:                                     # smoke test of every code path (numbers meaningless)
        OOF_YEARS, MLP_SEEDS = [2023], 1

    # ---------------- 1) round selection for GBM (train <= 2017, early stop on 2018-2019)
    es_tr = (yr >= TRAIN_FROM.year) & (yr <= ES_SPLIT[0])
    es_va = (yr >= ES_SPLIT[1][0]) & (yr <= ES_SPLIT[1][1])
    rounds, imp = [], []
    for t in range(nt):
        e = EX[:, t]
        a, b = es_tr & (e > 0), es_va & (e > 0)
        bst, it = gbm_fit(t, X[a], Y[a, t], e[a], OFF[a, t], 30 if quick else 1500, X[b], Y[b, t], e[b], OFF[b, t])
        it = max(it, 20)
        rounds.append(it)
        gain = bst.feature_importance("gain", iteration=it)
        imp.append(gain / max(gain.sum(), 1e-12))
        log("  gbm rounds %-8s %4d  (%.0fs)" % (TNAMES[t], it, time.time() - t_start))
    report["gbm_rounds_es"] = dict(zip(TNAMES, rounds))
    pairs_t = []
    for t in range(nt):
        top = np.argsort(-imp[t])[:GLM_TOP]
        pairs_t.append(np.array([(int(top[i]), int(top[j])) for i in range(len(top)) for j in range(i + 1, len(top))]))

    # ---------------- 2) MLP epochs (same split)
    tw = np.ones(nt)
    for t in range(nt):
        e = EX[es_tr, t]
        ok = e > 0
        tw[t] = 1.0 / max(target_dev(t, Y[es_tr, t][ok], e[ok], OFF[es_tr, t][ok]).mean(), 1e-6)
    tw = tw / tw.mean()
    ep_list = []
    for s in range(MLP_SEEDS):
        net = mlp_train(X[es_tr], Y[es_tr], EX[es_tr], OFF[es_tr], X[es_va], Y[es_va], EX[es_va], OFF[es_va],
                        seed=100 + s, task_w=tw, epochs=3 if quick else 150, **MLP_CFG)
        ep_list.append(net["epochs"])
    mlp_epochs = int(round(np.mean(ep_list)))
    report["mlp_epochs_es"] = ep_list
    log("  mlp epochs %s -> %d (%.0fs)" % (ep_list, mlp_epochs, time.time() - t_start))

    # ---------------- 2b) GLM ridge strength per target (same split)
    lam_t = []
    mean_es = X[es_tr].mean(0)
    sd_es = X[es_tr].std(0) + 1e-6
    for t in range(nt):
        e = EX[:, t]
        a, b = es_tr & (e > 0), es_va & (e > 0)
        Za = glm_design(X[a], mean_es, sd_es, pairs_t[t])
        Zb = glm_design(X[b], mean_es, sd_es, pairs_t[t])
        devs, init = [], None
        for lam in sorted(GLM_LAMS, reverse=True):
            b0, bb = glm_fit(Za, Y[a, t], e[a], OFF[a, t], TARGETS[t][1], lam, iters=15, init=init)
            init = (b0, bb)
            devs.append((target_dev(t, Y[b, t], e[b], OFF[b, t] + b0 + Zb @ bb).mean(), lam))
        lam_t.append(min(devs)[1])
    report["glm_lambda"] = dict(zip(TNAMES, lam_t))
    log("  glm lambdas %s (%.0fs)" % (lam_t, time.time() - t_start))

    # ---------------- 3) time-ordered CV: out-of-fold predictions for 2020-2023
    oof = {k: np.full((len(yr), nt), np.nan) for k in ("glm", "gbm", "mlp")}
    for b in OOF_YEARS:
        trm = (yr >= TRAIN_FROM.year) & (yr < b)
        tem = yr == b
        mean = X[trm].mean(0)
        sd = X[trm].std(0) + 1e-6
        for t in range(nt):
            e = EX[:, t]
            a = trm & (e > 0)
            Za = glm_design(X[a], mean, sd, pairs_t[t])
            Zt = glm_design(X[tem], mean, sd, pairs_t[t])
            b0, bb = glm_fit(Za, Y[a, t], e[a], OFF[a, t], TARGETS[t][1], lam_t[t], iters=15)
            oof["glm"][tem, t] = b0 + Zt @ bb
            bst, _ = gbm_fit(t, X[a], Y[a, t], e[a], OFF[a, t], rounds[t])
            oof["gbm"][tem, t] = bst.predict(X[tem], raw_score=True)
        acc = np.zeros((tem.sum(), nt))
        for s in range(MLP_SEEDS):
            net = mlp_train(X[trm], Y[trm], EX[trm], OFF[trm], seed=200 + s, task_w=tw, fixed_epochs=mlp_epochs,
                            **MLP_CFG)
            acc += mlp_predict(net, X[tem]) / MLP_SEEDS
        oof["mlp"][tem] = acc
        log("  fold %d done (%.0fs)" % (b, time.time() - t_start))
    oofM = np.isin(yr, OOF_YEARS)

    # ---------------- 4) stacking weights on the out-of-fold predictions (no intercept; deltas over the offset)
    from scipy.optimize import minimize
    stack, cv_table = [], {}
    for t in range(nt):
        e = EX[:, t]
        m = oofM & (e > 0)
        y_, e_, o_ = Y[m, t], e[m], OFF[m, t]
        Dm = np.column_stack([oof[k][m, t] for k in ("glm", "gbm", "mlp")])

        def f(w):
            return target_dev(t, y_, e_, o_ + Dm @ w).mean()

        best = minimize(f, np.array([0.34, 0.33, 0.33]), method="L-BFGS-B", bounds=[(0, 1.5)] * 3)
        w = best.x
        stack.append({"glm": float(w[0]), "gbm": float(w[1]), "mlp": float(w[2])})
        cv_table[TNAMES[t]] = {"league": float(target_dev(t, y_, e_, o_).mean()),
                               "engine": float(target_dev(t, y_, e_, link(t, ENG[m, t])).mean()),
                               "glm": float(f(np.array([1, 0, 0]))), "gbm": float(f(np.array([0, 1, 0]))),
                               "mlp": float(f(np.array([0, 0, 1]))), "stack": float(best.fun),
                               "weights": [round(float(x), 3) for x in w]}
        log("  cv %-8s league %.4f engine %.4f glm %.4f gbm %.4f mlp %.4f stack %.4f  w=%s"
            % (TNAMES[t], cv_table[TNAMES[t]]["league"], cv_table[TNAMES[t]]["engine"], cv_table[TNAMES[t]]["glm"],
               cv_table[TNAMES[t]]["gbm"], cv_table[TNAMES[t]]["mlp"], best.fun, np.round(w, 2)))
    report["cv_oof_2020_2023"] = cv_table

    # ---------------- 5) fit on a period, export JSON; dev = 2010-2023, prod = 2010-2025
    def fit_period(mask, label, scale_rounds):
        mean = X[mask].mean(0)
        sd = X[mask].std(0) + 1e-6
        glm, gbm = [], []
        for t in range(nt):
            e = EX[:, t]
            a = mask & (e > 0)
            Za = glm_design(X[a], mean, sd, pairs_t[t])
            b0, bb = glm_fit(Za, Y[a, t], e[a], OFF[a, t], TARGETS[t][1], lam_t[t], iters=20)
            glm.append({"b0": b0, "b": bb, "pairs": pairs_t[t]})
            nr = int(round(rounds[t] * scale_rounds))
            bst, _ = gbm_fit(t, X[a], Y[a, t], e[a], OFF[a, t], nr)
            gbm.append(gbm_trees(bst))
        nets = []
        for s in range(MLP_SEEDS + 1):
            nets.append(mlp_train(X[mask], Y[mask], EX[mask], OFF[mask], seed=300 + s, task_w=tw,
                                  fixed_epochs=mlp_epochs, **MLP_CFG))
        J = {"meta": {"name": "mlrates", "label": label, "built": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
                      "train_years": [int(yr[mask].min()), int(yr[mask].max())], "n_rows": int(mask.sum()),
                      "half_life_days": HALF_LIFE, "prior_window_years": PRIOR_WINDOW,
                      "offset": "league rate of the shrinkage division (priors of the fight year's 5-year window, or "
                                "the live priors at prediction time): log rate per minute / logit",
                      "symmetry": "no corner input: each side is predicted as attacker vs defender",
                      "source": "tools/mlrates.py"},
             "fc": FC, "fnames": FNAMES, "targets": TNAMES, "kinds": [k for _, k, _, _ in TARGETS],
             "base_keys": [BASE_KEY[t] for t in TNAMES],
             "glm_mean": sig(mean, 10), "glm_sd": sig(sd, 10),
             "glm": [export_glm(g) for g in glm], "gbm": [export_trees(tr) for tr in gbm],
             "mlp": [export_mlp(n) for n in nets], "stack": [{k: round(v, 4) for k, v in w.items()} for w in stack]}
        log("  fit %s done (%.0fs)" % (label, time.time() - t_start))
        return J

    J_dev = fit_period(trainM, "dev: trained 2010-2023 (validation numbers and honest engine backtests)", 1.1)
    J_dev = json.loads(json.dumps(J_dev))           # exactly what the file holds
    eta_val, off_val, comp_val = model_eta(J_dev, X[valM], BASE[valM])

    # ---------------- 6) validation 2024-2025
    vf = fight[valM]
    vbp = bp[valM]
    val_tab = {}
    eng_cal_c = []
    for t in range(nt):
        e_all = EX[:, t]
        a = trainM & (e_all > 0)
        eng_cal_c.append(recal_const(t, Y[a, t], e_all[a], ENG[a, t]))
    for subset, msk in (("both_prior", vbp), ("all", np.ones(len(vbp), bool))):
        tab = {}
        for t in range(nt):
            y = Y[valM, t]
            e = EX[valM, t]
            m = msk & (e > 0)
            preds = {"league": off_val[:, t], "engine": link(t, ENG[valM, t]),
                     "engine_cal": link(t, ENG[valM, t]) + eng_cal_c[t],
                     "glm": off_val[:, t] + comp_val["glm"][:, t], "gbm": off_val[:, t] + comp_val["gbm"][:, t],
                     "mlp": off_val[:, t] + comp_val["mlp"][:, t], "stack": eta_val[:, t]}
            dv = {k: target_dev(t, y[m], e[m], v[m]) for k, v in preds.items()}
            row = {k: float(v.mean()) for k, v in dv.items()}
            row["n"] = int(m.sum())
            row["skill_vs_league"] = {k: float(1 - row[k] / row["league"]) for k in preds}
            if subset == "both_prior":
                for ref in ("engine", "league"):
                    mu, lo, hi = boot_ci(dv["stack"] - dv[ref], vf[m])
                    row["stack_minus_" + ref] = {"mean": mu, "lo": lo, "hi": hi}
                mu, lo, hi = boot_ci(dv["stack"] - dv["engine_cal"], vf[m])
                row["stack_minus_engine_cal"] = {"mean": mu, "lo": lo, "hi": hi}
                row["calibration_stack"] = calib_table(t, y[m], e[m], eta_val[m, t])
                row["calibration_engine"] = calib_table(t, y[m], e[m], preds["engine"][m])
            tab[TNAMES[t]] = row
        val_tab[subset] = tab
    report["validation_2024_2025"] = val_tab
    report["engine_recal_consts"] = dict(zip(TNAMES, [float(c) for c in eng_cal_c]))
    log("validation (both with a prior UFC fight), mean deviance per fight-side:")
    log("  %-8s %9s %9s %9s %9s %9s %9s %9s   stack-engine [95%% CI]" % ("target", "league", "engine", "eng_cal",
                                                                         "glm", "gbm", "mlp", "stack"))
    for tn in TNAMES:
        r = val_tab["both_prior"][tn]
        ci = r["stack_minus_engine"]
        log("  %-8s %9.4f %9.4f %9.4f %9.4f %9.4f %9.4f %9.4f   %+.4f [%+.4f, %+.4f]"
            % (tn, r["league"], r["engine"], r["engine_cal"], r["glm"], r["gbm"], r["mlp"], r["stack"],
               ci["mean"], ci["lo"], ci["hi"]))

    # ---------------- 7) stat lines at the actual fight length (MAE per fight-side)
    def stat_lines(etaM, idx):
        R = {tn: inv_link(t, etaM[:, t]) for t, tn in enumerate(TNAMES)}
        mins = EX[idx, 0]
        sig_att = (R["d_att"] + R["c_att"] + R["g_att"]) * mins
        sig_lnd = (R["d_att"] * R["acc_d"] + R["c_att"] * R["acc_c"] + R["g_att"] * R["acc_g"]) * mins
        head_l = R["h_att"] * R["acc_h"] * mins
        return {"sig_att": sig_att, "sig_lnd": sig_lnd, "td_att": R["td_att"] * mins,
                "td_lnd": R["td_att"] * R["td_acc"] * mins, "ctrl": R["ctrl"] * mins, "kd": head_l * R["kd_h"],
                "sub_att": R["sub_att"] * mins}

    vidx = np.where(valM)[0]
    actual = {"sig_att": Y[vidx, 0] + Y[vidx, 1] + Y[vidx, 2],
              "sig_lnd": Y[vidx, TNAMES.index("acc_d")] + Y[vidx, TNAMES.index("acc_c")] + Y[vidx, TNAMES.index("acc_g")],
              "td_att": Y[vidx, TNAMES.index("td_att")], "td_lnd": Y[vidx, TNAMES.index("td_acc")],
              "ctrl": Y[vidx, TNAMES.index("ctrl")], "kd": Y[vidx, TNAMES.index("kd_h")],
              "sub_att": Y[vidx, TNAMES.index("sub_att")]}
    eng_eta = np.column_stack([link(t, ENG[valM, t]) for t in range(nt)])
    eng_cal_eta = eng_eta + np.array(eng_cal_c)[None, :]
    lines = {"stack": stat_lines(eta_val, vidx), "engine": stat_lines(eng_eta, vidx),
             "engine_cal": stat_lines(eng_cal_eta, vidx), "league": stat_lines(off_val, vidx)}
    sl = {}
    for k in actual:
        sl[k] = {}
        for src in lines:
            err = np.abs(lines[src][k] - actual[k])[vbp]
            sl[k][src] = float(err.mean())
        dif = (np.abs(lines["stack"][k] - actual[k]) - np.abs(lines["engine"][k] - actual[k]))[vbp]
        mu, lo, hi = boot_ci(dif, vf[vbp])
        sl[k]["stack_minus_engine"] = {"mean": mu, "lo": lo, "hi": hi}
    report["stat_line_mae_2024_2025"] = sl
    log("stat-line MAE per fight-side at the actual fight length (both prior):")
    for k, v in sl.items():
        log("  %-8s league %.3f engine %.3f eng_cal %.3f ML %.3f  (ML-engine %+.3f [%+.3f, %+.3f])"
            % (k, v["league"], v["engine"], v["engine_cal"], v["stack"], v["stack_minus_engine"]["mean"],
               v["stack_minus_engine"]["lo"], v["stack_minus_engine"]["hi"]))

    # ---------------- 8) production fit 2010-2025, exports, fixtures
    J_prod = fit_period(trainM | valM, "production: trained 2010-2025 (2026+ never read)", 1.15)
    J_prod = json.loads(json.dumps(J_prod))
    for J in (J_dev, J_prod):
        J["meta"]["validation"] = {tn: {"engine": sig(val_tab["both_prior"][tn]["engine"], 5),
                                        "ml": sig(val_tab["both_prior"][tn]["stack"], 5),
                                        "league": sig(val_tab["both_prior"][tn]["league"], 5)} for tn in TNAMES}
    pd_ = os.path.join(OUT, "mlrates.json")
    dd_ = os.path.join(OUT, "mlrates_dev.json")
    for path, J in ((pd_, J_prod), (dd_, J_dev)):
        with open(path, "w") as fh:
            json.dump(J, fh, separators=(",", ":"))
        log("wrote %s (%.0f KB)" % (path, os.path.getsize(path) / 1e3))
    write_fixtures(d, J_prod)
    report["seconds"] = round(time.time() - t_start, 1)
    with open(os.path.join(CACHE, "fit_report.json"), "w") as fh:
        json.dump(report, fh, indent=1)
    with open(os.path.join(CACHE, "fit_state.pkl"), "wb") as fh:
        pickle.dump({"stack": stack, "rounds": rounds, "lam": lam_t, "epochs": mlp_epochs, "pairs": pairs_t,
                     "eng_cal": eng_cal_c, "tw": tw}, fh)
    log("fit done in %.0fs" % (time.time() - t_start))


def write_fixtures(d, J, n=60):
    """Fixture for tests/test_mlrates.js: raw side profiles + context + priors -> Python features and etas."""
    rows = d["rows"]
    pri = d["priors"]
    rng = np.random.default_rng(5)
    cand = [i for i, r in enumerate(rows) if r["year"] >= 2021]
    pick = sorted(rng.choice(cand, n, replace=False).tolist())
    # include a catch-weight bout and a debutant if present
    for i, r in enumerate(rows):
        if r["year"] >= 2015 and r["division"] in B.NON_DIV and i not in pick:
            pick.append(i)
            break
    for i, r in enumerate(rows):
        if r["year"] >= 2020 and r["sides"][0]["n"] == 0 and i not in pick:
            pick.append(i)
            break
    fx = []
    years_needed = set()
    for i in pick:
        r = rows[i]
        P = prior_for(pri[str(r["year"])], r["prior_division"])
        ctx = {"rounds": r["rounds"], "title": r["title"], "division": r["division"],
               "prior_division": r["prior_division"], "year": r["year"]}
        fj = fight_json(r)
        prof = []
        for tag in ("A", "B"):
            sd = dict(fj[tag])
            sd["S"] = np.array(sd["S"], float)
            prof.append(side_profile(sd))
        fa, base = features(prof[0], prof[1], ctx, P)
        fb, _ = features(prof[1], prof[0], ctx, P)
        Xf = np.array([fa, fb])
        Bv = np.array([[base[t] for t in TNAMES]] * 2)
        eta, _, _ = model_eta(J, Xf, Bv)
        years_needed.add(str(r["year"]))
        fx.append({"id": r["id"], "fight": fj, "featA": fa, "featB": fb,
                   "etaA": eta[0].tolist(), "etaB": eta[1].tolist()})
    out = {"note": "built by tools/mlrates.py fit; checked by tests/test_mlrates.js", "model": "data/derived/mlrates.json",
           "priors": priors_json({y: pri[y] for y in sorted(years_needed)}), "fixtures": fx}
    os.makedirs(os.path.join(ROOT, "tests", "fixtures"), exist_ok=True)
    path = os.path.join(ROOT, "tests", "fixtures", "mlrates_fixtures.json")
    with open(path, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    log("wrote %s (%d fights)" % (path, len(fx)))


# ------------------------------------------------------------------ simulator: plain engine vs ML rates (validation)
def bucket_of(r):
    w, m = r["winner"], r["method"]
    if w not in ("A", "B"):
        return 3 if m == "DRAW" else None
    kind = 0 if m in ("KO", "DOC") else (1 if m == "SUB" else (2 if m in ("UD", "SD", "MD") else None))
    if kind is None:
        return None
    return kind if w == "A" else 6 - kind


def cmd_sim(args):
    d = load_dataset()
    rows = [r for r in d["rows"] if VAL_FROM.year <= r["year"] < CUTOFF.year
            and r["sides"][0]["n"] > 0 and r["sides"][1]["n"] > 0]
    if args.quick:
        rows = rows[:40]
    N = args.nsim
    J = json.load(open(os.path.join(OUT, "mlrates_dev.json")))     # trained 2010-2023 only
    years = sorted({str(r["year"]) for r in rows})
    fights = [fight_json(r) for r in rows]
    nproc = max(1, min(2, args.procs))
    chunks = [list(range(k, len(fights), nproc)) for k in range(nproc)]
    procs, outs = [], []
    t0 = time.time()
    for ci, idx in enumerate(chunks):
        inp = os.path.join(CACHE, "sim_in_%d.json" % ci)
        outp = os.path.join(CACHE, "sim_out_%d.json" % ci)
        with open(inp, "w") as fh:
            json.dump({"priors": priors_json({y: d["priors"][y] for y in years}), "model": J,
                       "fights": [fights[i] for i in idx]}, fh)
        procs.append(subprocess.Popen(["node", os.path.join(HERE, "mlrates_engine.js"), "sim", inp, outp, str(N),
                                       str(1000 + ci)]))
        outs.append((idx, outp))
    for p in procs:
        if p.wait() != 0:
            raise SystemExit("sim worker failed")
    res = [None] * len(fights)
    params_version = None
    for idx, outp in outs:
        o = json.load(open(outp))
        params_version = o["params_version"]
        for i, rr in zip(idx, o["rows"]):
            res[i] = rr
    log("simulated %d validation fights x %d (x2 configs) in %.0fs" % (len(fights), N, time.time() - t0))

    eps = 0.5 / N

    def ll_win(p, y):
        p = min(max(p, 1e-4), 1 - 1e-4)
        return -(y * math.log(p) + (1 - y) * math.log(1 - p))

    recs = []
    for r, rr in zip(rows, res):
        b = bucket_of(r)
        rec = {"id": r["id"], "fight": r["id"], "bucket": b, "winner": r["winner"]}
        for k in ("plain", "ml"):
            s = rr[k]
            pA = s["pA"] / max(1e-9, s["pA"] + s["pB"])
            bins = np.array(s["bins"]) * (1 - 7 * eps) + eps
            rec[k] = {"pA": pA, "bins": bins.tolist()}
            if r["winner"] in ("A", "B"):
                y = 1.0 if r["winner"] == "A" else 0.0
                # symmetric scoring: both orientations (identical for a corner-symmetric model; kept explicit)
                rec[k]["ll"] = 0.5 * (ll_win(pA, y) + ll_win(1 - pA, 1 - y))
                rec[k]["brier"] = (pA - y) ** 2
                rec[k]["acc"] = 1.0 if (pA > 0.5) == (y > 0.5) else (0.5 if pA == 0.5 else 0.0)
            if b is not None:
                rec[k]["ll7"] = -math.log(bins[b])
            # simulated per-minute stat rates vs the fight's actual per-minute rates
            mins = r["minutes"]
            v = r["v"]
            for tag, si, avg in (("A", 0, s["avgA"]), ("B", 1, s["avgB"])):
                act_sl = (v[si][KI["d_lnd"]] + v[si][KI["c_lnd"]] + v[si][KI["g_lnd"]]) / mins
                act_td = v[si][KI["td_lnd"]] / mins
                act_ct = v[si][KI["ctrl"]] / mins
                rec[k]["sl_err_" + tag] = abs(avg["sig_lnd"] / s["avgMin"] - act_sl)
                rec[k]["td_err_" + tag] = abs(avg["td_lnd"] / s["avgMin"] - act_td)
                rec[k]["ct_err_" + tag] = abs(avg["ctrl"] / s["avgMin"] - act_ct)
        eA, eB = r["sides"][0]["elo"], r["sides"][1]["elo"]
        rec["elo_pA"] = 1 / (1 + 10 ** ((eB - eA) / 400))
        recs.append(rec)

    dec = [x for x in recs if x["winner"] in ("A", "B")]
    b7 = [x for x in recs if x["bucket"] is not None]
    fid = np.array([x["fight"] for x in dec])
    out = {"n_fights": len(recs), "n_decisive": len(dec), "n_bucketed": len(b7), "nsim": N,
           "params_version": params_version, "model": "data/derived/mlrates_dev.json (trained 2010-2023)"}
    for k in ("plain", "ml"):
        out[k] = {"winner_log_loss": float(np.mean([x[k]["ll"] for x in dec])),
                  "brier": float(np.mean([x[k]["brier"] for x in dec])),
                  "accuracy": float(np.mean([x[k]["acc"] for x in dec])),
                  "outcome7_log_loss": float(np.mean([x[k]["ll7"] for x in b7])),
                  "sig_lnd_per_min_mae": float(np.mean([0.5 * (x[k]["sl_err_A"] + x[k]["sl_err_B"]) for x in recs])),
                  "td_lnd_per_min_mae": float(np.mean([0.5 * (x[k]["td_err_A"] + x[k]["td_err_B"]) for x in recs])),
                  "ctrl_s_per_min_mae": float(np.mean([0.5 * (x[k]["ct_err_A"] + x[k]["ct_err_B"]) for x in recs]))}
    yv = np.array([1.0 if x["winner"] == "A" else 0.0 for x in dec])
    pe = np.clip(np.array([x["elo_pA"] for x in dec]), 1e-4, 1 - 1e-4)
    out["elo_winner_log_loss"] = float(np.mean(-(yv * np.log(pe) + (1 - yv) * np.log(1 - pe))))
    dll = np.array([x["ml"]["ll"] - x["plain"]["ll"] for x in dec])
    mu, lo, hi = boot_ci(dll, fid)
    out["ml_minus_plain_winner_ll"] = {"mean": mu, "lo": lo, "hi": hi}
    d7 = np.array([x["ml"]["ll7"] - x["plain"]["ll7"] for x in b7])
    mu, lo, hi = boot_ci(d7, np.array([x["fight"] for x in b7]))
    out["ml_minus_plain_outcome7_ll"] = {"mean": mu, "lo": lo, "hi": hi}
    for key, nm in (("sl", "sig_lnd_per_min"), ("td", "td_lnd_per_min"), ("ct", "ctrl_s_per_min")):
        dd = np.array([0.5 * (x["ml"][key + "_err_A"] + x["ml"][key + "_err_B"] - x["plain"][key + "_err_A"]
                              - x["plain"][key + "_err_B"]) for x in recs])
        mu, lo, hi = boot_ci(dd, np.array([x["fight"] for x in recs]))
        out["ml_minus_plain_" + nm + "_mae"] = {"mean": mu, "lo": lo, "hi": hi}
    # calibration of the ML-sim winner probability (deciles of the A-oriented and mirrored predictions)
    for k in ("plain", "ml"):
        p = np.array([x[k]["pA"] for x in dec])
        pp = np.concatenate([p, 1 - p])
        yy = np.concatenate([yv, 1 - yv])
        q = np.linspace(0, 1, 11)
        out[k]["calibration_mirrored"] = [{"lo": float(q[i]), "hi": float(q[i + 1]),
                                           "n": int(((pp >= q[i]) & (pp < q[i + 1] if i < 9 else pp <= 1)).sum()),
                                           "pred": float(pp[(pp >= q[i]) & ((pp < q[i + 1]) if i < 9 else (pp <= 1))].mean())
                                           if ((pp >= q[i]) & ((pp < q[i + 1]) if i < 9 else (pp <= 1))).any() else None,
                                           "obs": float(yy[(pp >= q[i]) & ((pp < q[i + 1]) if i < 9 else (pp <= 1))].mean())
                                           if ((pp >= q[i]) & ((pp < q[i + 1]) if i < 9 else (pp <= 1))).any() else None}
                                          for i in range(10)]
    path = os.path.join(CACHE, "sim_report.json")
    with open(path, "w") as fh:
        json.dump(out, fh, indent=1)
    log(json.dumps({k: v for k, v in out.items() if k not in ("plain", "ml")}, indent=1))
    for k in ("plain", "ml"):
        log(k, json.dumps({kk: vv for kk, vv in out[k].items() if kk != "calibration_mirrored"}))


# ------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("cmd", choices=["build", "engine", "fit", "sim", "all"])
    ap.add_argument("--quick", action="store_true")
    args = ap.parse_args()
    if args.cmd in ("build", "all"):
        cmd_build(args)
    if args.cmd in ("engine", "all"):
        cmd_engine(args)
    if args.cmd in ("fit", "all"):
        cmd_fit(args)
    if args.cmd in ("sim", "all"):
        cmd_sim(args)


if __name__ == "__main__":
    main()
