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
