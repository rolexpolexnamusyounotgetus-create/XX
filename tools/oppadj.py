#!/usr/bin/env python3
"""Opponent (strength-of-schedule) adjustment for the fight engine (roadmap v4).

For every stat the engine shrinks (attempt rates by position, accuracy by target, knockdown power and chin,
takedown attempts and success, control, control per takedown, submission threat), fit a walk-forward
two-way model over every earlier UFC fight with round stats:

  counts (Poisson with exposure E, baseline rate L of the fight's division and year):
      E[y_i] = E_i * L_i * exp(c + o_X + d_Y)
  probabilities (binomial logit, baseline b_i = the league's expected logit for that fight's position mix):
      logit P(landed) = b_i + c + a_X + g_Y

X = the man doing it, Y = his opponent. o / a = offense effect, d / g = what Y allows (defense; > 0 = leaky).
Every observation is weighted by 0.5 ^ (days before the prediction date / half-life). Each effect has a
conjugate pseudo-data prior: k exposure units (minutes, attempts, landed head strikes, takedowns) at the
league rate for that fighter's own division mix, so with opponent effects frozen at zero and a single
division the estimate is exactly the engine's shr() rate. With them free, the fixed point is the engine's
shr() with every past opponent's exposure re-weighted by how leaky or tight that opponent was
(iterative proportional fitting / block-coordinate MAP; one global level c per fit).

For every backtest snapshot (pre-fight) and every roster fighter it writes adjustment factors relative to
the raw shrunk rates the engine computes from the same S sums (src/engine3.js fighterRates, k values read
from src/params3.js), plus the half-life and shrinkage strengths per stat chosen on 2019-2023 and the
held-out 2024+ per-fight deviance against the raw rates.

Run from the project root (about 10-20 minutes on 4 cores; --quick for a small grid):

    python3 tools/oppadj.py
    python3 tools/oppadj.py --quick

Writes data/derived/oppadj.json; research/model_oppadj.md is the report. Walk-forward: every number used
for a fight comes from fights on earlier dates; hyperparameters are chosen on 2019-2023 fights only.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import subprocess
import sys
import time
from collections import defaultdict

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import build_db as B  # noqa: E402

OUT = os.path.join(ROOT, "data", "derived")
KEYS = B.KEYS
KI = B.KI
NK = B.NK
TUNE = ("2019-01-01", "2023-12-31")
TEST_FROM = "2024-01-01"
HL_GRID = [365, 730, 1095, 1460, 2190]
# ufcstats has no control time before 1999, so model rows start in 2001; rows before 2004 take the 2004
# priors (window 1999-2003). Both are long before the first prediction date (2019).
MODEL_FROM = dt.date(2001, 1, 1)
PRIOR_YEAR0 = 2004


# ------------------------------------------------------------------ engine parameters (single source: params3.js)
def engine_params():
    js = ("const p=require(%s);process.stdout.write(JSON.stringify(p))"
          % json.dumps(os.path.join(ROOT, "src", "params3.js")))
    out = subprocess.run(["node", "-e", js], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


# ------------------------------------------------------------------ small math
def logit(p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


def sigm(z):
    return 1.0 / (1.0 + np.exp(-z))


def shr(ev, ex, prior, k):
    return (ev + k * prior) / (np.maximum(0.0, ex) + k)


# ------------------------------------------------------------------ engine replica: league() and fighterRates()
def league(P, p):
    """Python copy of engine3.js league(P, p) for one prior dict (scalars)."""
    L = {}
    gs = p["ctrlGroundShare"]
    cf = P["ctrl"] / 60.0
    L["ground"] = 2 * cf * gs
    L["clinch"] = 2 * cf * (1 - gs)
    L["dist"] = 1 - L["ground"] - L["clinch"]
    L["stand"] = 1 - L["ground"]
    L["top"] = cf * gs
    L["dAtt"] = P["d_att"] / L["dist"]
    L["gAtt"] = P["g_att"] / L["top"]
    L["tdAtt"] = P["td_att"] / L["stand"]
    L["sub"] = P["sub_att"] / L["ground"]
    L["rev"] = P["rev"] / L["top"]
    cm, gm = p["clinchMix"], p["groundTopMix"]
    tA = [P["h_att"], P["b_att"], P["l_att"]]
    dm = [max(0.02 * P["d_att"], tA[t] - P["c_att"] * cm[t] - P["g_att"] * gm[t]) for t in range(3)]
    s = sum(dm)
    dm = [x / s for x in dm]
    L["mixD"] = dm
    att = [P["d_att"], P["c_att"], P["g_att"]]
    mix = [dm, cm, gm]
    tm = [P["acc_h"], P["acc_b"], P["acc_l"]]
    pm = [P["acc_d"], P["acc_c"], P["acc_g"]]
    lg = lambda x: float(logit(x))
    sg = lambda z: 1.0 / (1.0 + math.exp(-z))
    a = [lg(tm[0]), lg(tm[1]), lg(tm[2])]
    b = [0.0, lg(pm[1]) - lg(pm[0]), lg(pm[2]) - lg(pm[0])]
    for _ in range(80):
        for t in range(3):
            num = den = 0.0
            for q in range(3):
                w = att[q] * mix[q][t]
                num += w * sg(a[t] + b[q])
                den += w
            a[t] += lg(tm[t]) - lg(num / den)
        for q in range(3):
            num = den = 0.0
            for t in range(3):
                w = att[q] * mix[q][t]
                num += w * sg(a[t] + b[q])
                den += w
            b[q] += lg(pm[q]) - lg(num / den)
    L["accA"] = a
    L["accB"] = b
    ground_head = P["g_lnd"] * gm[0]
    L["kd0"] = P["kd_per_h"] * P["h_lnd"] / max(0.2 * P["h_lnd"], P["h_lnd"] - ground_head)
    return L


LFIELDS = ["dist", "stand", "top", "ground", "dAtt", "gAtt", "tdAtt", "sub", "kd0"]
PFIELDS = ["c_att", "ctrl", "td_acc", "ctrl_per_td", "kd_per_h", "d_att", "g_att", "td_att", "sub_att"]


class LTable:
    """Per-row arrays of league quantities, built from a list of prior keys (one per row)."""

    def __init__(self, keys, priors_by_key, p):
        uniq = sorted(set(keys))
        Ls = {k: league(priors_by_key[k], p) for k in uniq}
        idx = {k: i for i, k in enumerate(uniq)}
        ii = np.array([idx[k] for k in keys], dtype=int)
        for f in LFIELDS:
            setattr(self, f, np.array([Ls[k][f] for k in uniq])[ii])
        for f in PFIELDS:
            setattr(self, "P_" + f, np.array([priors_by_key[k][f] for k in uniq], dtype=float)[ii])
        self.mixD = np.array([Ls[k]["mixD"] for k in uniq])[ii]          # n x 3
        self.accA = np.array([Ls[k]["accA"] for k in uniq])[ii]
        self.accB = np.array([Ls[k]["accB"] for k in uniq])[ii]
        self.n = len(keys)


def col(S, k):
    return S[:, KI[k]]


def dist_mix(S, pre, L, p):
    """engine3.js distMix on arrays: distance target mix shrunk to the league mix (n x 3)."""
    cm, gm = p["clinchMix"], p["groundTopMix"]
    dA, cA, gA = col(S, pre + "d_att"), col(S, pre + "c_att"), col(S, pre + "g_att")
    c = np.zeros((len(S), 3))
    for t, nm in enumerate("hbl"):
        c[:, t] = np.maximum(0.02 * dA, col(S, pre + nm + "_att") - cA * cm[t] - gA * gm[t])
    tot = c.sum(1)
    return (c + p["kTgt"] * L.mixD) / (tot + p["kTgt"])[:, None]


def exp_acc(L, w, mixes, t):
    """engine3.js expAcc: expected accuracy for target t given position weights w (n x 3) and mixes."""
    num = np.zeros(L.n)
    den = np.zeros(L.n)
    for q in range(3):
        x = w[:, q] * mixes[q][:, t]
        num += x * sigm(L.accA[:, t] + L.accB[:, q])
        den += x
    return np.where(den > 0, num / np.maximum(den, 1e-300), sigm(L.accA[:, t]))


def fighter_rates(S, L, p, k=None):
    """Vectorized engine3.js fighterRates (the fields opponent adjustment touches). S: n x NK sums.
    k: optional overrides of the prior strengths (kPM, kAcc, kTdPM, kTdAcc, kKD, kCtrlTD), each a scalar
    or a dict per output field for scans."""
    k = dict(k or {})

    def K(name, field):
        v = k.get(name, p[name])
        return v.get(field, p[name]) if isinstance(v, dict) else v

    gs = p["ctrlGroundShare"]
    mn = np.maximum(0.0, col(S, "min"))
    topMin = col(S, "ctrl") / 60 * gs
    botMin = col(S, "octrl") / 60 * gs
    grMin = topMin + botMin
    clMin = (col(S, "ctrl") + col(S, "octrl")) / 60 * (1 - gs)
    distMin = np.maximum(0.25 * mn, mn - grMin - clMin)
    standMin = np.maximum(0.3 * mn, mn - grMin)
    R = {}
    R["dAtt"] = shr(col(S, "d_att"), distMin, L.dAtt, K("kPM", "dAtt") * L.dist)
    R["dAttAg"] = shr(col(S, "od_att"), distMin, L.dAtt, K("kPM", "dAttAg") * L.dist)
    R["cAtt"] = shr(col(S, "c_att"), mn, L.P_c_att, K("kPM", "cAtt"))
    R["cAttAg"] = shr(col(S, "oc_att"), mn, L.P_c_att, K("kPM", "cAttAg"))
    R["gAtt"] = shr(col(S, "g_att"), topMin, L.gAtt, K("kPM", "gAtt") * L.top)
    R["gAttAg"] = shr(col(S, "og_att"), botMin, L.gAtt, K("kPM", "gAttAg") * L.top)
    R["tdAtt"] = shr(col(S, "td_att"), standMin, L.tdAtt, K("kTdPM", "tdAtt") * L.stand)
    R["tdAttAg"] = shr(col(S, "otd_att"), standMin, L.tdAtt, K("kTdPM", "tdAttAg") * L.stand)
    R["tdAcc"] = np.clip(shr(col(S, "td_lnd"), col(S, "td_att"), L.P_td_acc, K("kTdAcc", "tdAcc")), 0.03, 0.95)
    R["tdAccAg"] = np.clip(shr(col(S, "otd_lnd"), col(S, "otd_att"), L.P_td_acc, K("kTdAcc", "tdAccAg")), 0.03, 0.95)
    R["ctrl"] = shr(col(S, "ctrl"), mn, L.P_ctrl, K("kPM", "ctrl"))
    R["octrl"] = shr(col(S, "octrl"), mn, L.P_ctrl, K("kPM", "octrl"))
    cpt = L.P_ctrl_per_td
    R["topSkill"] = shr(col(S, "ctrl"), col(S, "td_lnd"), cpt, K("kCtrlTD", "topSkill")) / cpt
    R["escWeak"] = shr(col(S, "octrl"), col(S, "otd_lnd"), cpt, K("kCtrlTD", "escWeak")) / cpt
    R["sub"] = shr(col(S, "sub_att"), grMin, L.sub, K("kPM", "sub") * L.ground)
    R["subAg"] = shr(col(S, "osub_att"), grMin, L.sub, K("kPM", "subAg") * L.ground)
    R["pow"] = shr(col(S, "kd"), col(S, "h_lnd"), L.P_kd_per_h, K("kKD", "pow"))
    R["chin"] = shr(col(S, "okd"), col(S, "oh_lnd"), L.P_kd_per_h, K("kKD", "chin"))
    R["mixD"] = dist_mix(S, "", L, p)
    R["mixDAg"] = dist_mix(S, "o", L, p)
    eps = 1e-6
    cm = np.tile(np.array(p["clinchMix"]), (len(S), 1))
    gm = np.tile(np.array(p["groundTopMix"]), (len(S), 1))
    wX = np.column_stack([col(S, "d_att") + eps * L.P_d_att, col(S, "c_att") + eps * L.P_c_att,
                          col(S, "g_att") + eps * L.P_g_att])
    wO = np.column_stack([col(S, "od_att") + eps * L.P_d_att, col(S, "oc_att") + eps * L.P_c_att,
                          col(S, "og_att") + eps * L.P_g_att])
    R["accSh"] = np.zeros((len(S), 3))
    R["accAgSh"] = np.zeros((len(S), 3))
    R["eX"] = np.zeros((len(S), 3))
    R["eO"] = np.zeros((len(S), 3))
    for t, nm in enumerate("hbl"):
        eX = exp_acc(L, wX, [R["mixD"], cm, gm], t)
        eO = exp_acc(L, wO, [R["mixDAg"], cm, gm], t)
        aX = shr(col(S, nm + "_lnd"), col(S, nm + "_att"), eX, K("kAcc", "acc" + nm.upper()))
        aO = shr(col(S, "o" + nm + "_lnd"), col(S, "o" + nm + "_att"), eO, K("kAcc", "accAg" + nm.upper()))
        R["accSh"][:, t] = logit(aX) - logit(eX)
        R["accAgSh"][:, t] = logit(aO) - logit(eO)
        R["eX"][:, t] = eX
        R["eO"][:, t] = eO
    R["distMin"], R["standMin"], R["topMin"], R["botMin"], R["grMin"] = distMin, standMin, topMin, botMin, grMin
    return R


# ------------------------------------------------------------------ data
class Data:
    """Directed fight-side rows (X attacks Y) for every UFC fight with round stats, in date order, plus the
    backtest snapshots mapped onto them."""

    def __init__(self, p, priors_window=5, verbose=True):
        t0 = time.time()
        log = {}
        fights, _ = B.parse_fights(log)
        people = B.build_people(fights, log)
        B.build_vectors(fights, log)
        self.p = p
        self.people = people
        bt = json.load(open(os.path.join(OUT, "backtest.json")))
        self.bt = bt
        assert bt["meta"]["keys"] == KEYS, "backtest keys differ from build_db.KEYS"
        snap = fights[-1].date
        self.snapshot = snap
        # walk-forward division priors per year: fights in [Jan 1 of Y - window, Jan 1 of Y). The backtest's
        # own priors_asof for 2019+; the same rule for older years (used only as baselines of training rows).
        pri = {}
        for y in range(PRIOR_YEAR0, snap.year + 1):
            if str(y) in bt["priors_asof"]:
                pri[y] = bt["priors_asof"][str(y)]
            else:
                pri[y] = B.build_priors(fights, dt.date(y - priors_window, 1, 1), dt.date(y, 1, 1))
        self.live_priors = json.load(open(os.path.join(OUT, "priors.json")))["priors"]
        self.priors_by_key = {}
        for y, groups in pri.items():
            for g, P in groups.items():
                self.priors_by_key[(y, g)] = P
        for g, P in self.live_priors.items():
            self.priors_by_key[("live", g)] = P
        ymin = min(pri)

        # persons -> integer ids; a person's division history for the catch-weight prior division
        pid = {}
        hist = defaultdict(list)
        bt_by_id = {e["id"]: e for e in bt["fights"]}
        rows = []                       # (day, X, Y, fid, side, prior_key, vector)
        for f in fights:
            a, b = f.persons
            if a == b:
                continue
            homes = (B.mode_recent(hist[a], f.day) if hist[a] else None,
                     B.mode_recent(hist[b], f.day) if hist[b] else None)
            if f.stats and not (a.startswith("amb:") or b.startswith("amb:")):
                if f.date < MODEL_FROM:
                    hist[a].append((f.day, f.division))
                    hist[b].append((f.day, f.division))
                    continue
                yr = max(ymin, f.date.year)
                e = bt_by_id.get(f.fid)
                if e is not None:
                    g = e.get("prior_division") or e["division"]
                elif f.division in B.NON_DIV:
                    hs = [h for h in homes if B.LBS.get(h)]
                    g = max(hs, key=lambda d: B.LBS[d]) if hs else "ALL"
                else:
                    g = f.division
                if (yr, g) not in self.priors_by_key:
                    g = "ALL"
                for s in (0, 1):
                    X, Y = f.persons[s], f.persons[1 - s]
                    for q in (X, Y):
                        if q not in pid:
                            pid[q] = len(pid)
                    rows.append((f.day, pid[X], pid[Y], f.fid, s, (yr, g), f.stats["v"][s]))
            hist[a].append((f.day, f.division))
            hist[b].append((f.day, f.division))
        rows.sort(key=lambda r: (r[0], r[3], r[4]))
        self.pid = pid
        self.pslug = {}
        for q, i in pid.items():
            self.pslug[i] = people[q].get("slug") if q in people else q
        self.NP = len(pid)
        self.day = np.array([r[0] for r in rows], dtype=float)
        self.X = np.array([r[1] for r in rows], dtype=int)
        self.Y = np.array([r[2] for r in rows], dtype=int)
        self.fid = [r[3] for r in rows]
        self.side = np.array([r[4] for r in rows], dtype=int)
        self.V = np.array([r[6] for r in rows], dtype=float)
        self.keys = [r[5] for r in rows]
        self.L = LTable(self.keys, self.priors_by_key, p)
        self.nrow = len(rows)
        self.row_of = {(r[3], r[4]): i for i, r in enumerate(rows)}

        # backtest entries that have stats (both rows present); test rows in entry order
        ent = []
        for e in bt["fights"]:
            if (e["id"], 0) in self.row_of and (e["id"], 1) in self.row_of:
                ent.append(e)
        self.entries = ent
        self.n_bt_all = len(bt["fights"])
        # side arrays (2 per entry: A then B); the row where that side attacks
        self.s_row = np.array([self.row_of[(e["id"], s)] for e in ent for s in (0, 1)], dtype=int)
        self.s_day = self.day[self.s_row]
        self.s_person = self.X[self.s_row]
        self.s_opp = self.Y[self.s_row]
        self.s_S = np.array([e[t]["S"] for e in ent for t in ("A", "B")], dtype=float)
        # check the person mapping against the backtest slugs
        bad = sum(1 for i, e in enumerate(ent) for s, t in enumerate("AB")
                  if self.pslug.get(self.s_person[2 * i + s]) != e[t]["slug"])
        self.s_date = np.array([e["date"] for e in ent for _ in (0, 1)])
        self.s_tune = (self.s_date >= TUNE[0]) & (self.s_date <= TUNE[1])
        self.s_test = self.s_date >= TEST_FROM
        self.s_key = [self.keys[r] for r in self.s_row]
        self.sL = LTable(self.s_key, self.priors_by_key, p)
        # prediction dates: unique backtest dates (fits use rows strictly before)
        self.dates = np.unique(self.s_day)
        self.cut = np.searchsorted(self.day, self.dates, side="left")
        self.s_date_idx = np.searchsorted(self.dates, self.s_day)
        if verbose:
            print("rows %d (fights with stats %d), persons %d, backtest entries with stats %d of %d, "
                  "slug mismatches %d, prediction dates %d, %.1f s"
                  % (self.nrow, self.nrow // 2, self.NP, len(ent), self.n_bt_all, bad, len(self.dates),
                     time.time() - t0))

    # decayed sums S for each backtest side at half-life hl, from rows strictly before the fight
    def side_sums(self, hl, people=None, days=None):
        people = self.s_person if people is None else people
        days = self.s_day if days is None else days
        by_p = defaultdict(list)
        for i in range(self.nrow):
            by_p[self.X[i]].append(i)
        out = np.zeros((len(people), NK))
        lam = math.log(2) / hl
        for j, (q, T) in enumerate(zip(people, days)):
            ii = by_p.get(q)
            if not ii:
                continue
            ii = np.array(ii)
            ii = ii[self.day[ii] < T]
            if len(ii):
                out[j] = np.exp(-lam * (T - self.day[ii])) @ self.V[ii]
        return out


# ------------------------------------------------------------------ stat families
# name: kind, engine fields (offense, defense), engine k parameter, k grid (exposure units), short label
FAMILIES = {
    "dAtt":     ("count", ("dAtt", "dAttAg"), "kPM", [1.5, 3, 6, 12, 25, 50, 100], "distance strike attempts per distance minute"),
    "cAtt":     ("count", ("cAtt", "cAttAg"), "kPM", [2.5, 5, 10, 20, 40, 80, 160], "clinch strike attempts per fight minute"),
    "gAtt":     ("count", ("gAtt", "gAttAg"), "kPM", [0.4, 0.75, 1.5, 3, 6, 12, 24], "ground strike attempts per top minute"),
    "accH":     ("binom", ("accH", "accAgH"), "kAcc", [20, 40, 80, 150, 300, 600, 1200], "head accuracy"),
    "accB":     ("binom", ("accB", "accAgB"), "kAcc", [20, 40, 80, 150, 300, 600, 1200], "body accuracy"),
    "accL":     ("binom", ("accL", "accAgL"), "kAcc", [20, 40, 80, 150, 300, 600, 1200], "leg accuracy"),
    "kd":       ("count", ("pow", "chin"), "kKD", [60, 120, 230, 460, 920, 1840, 3680], "knockdowns per landed head strike"),
    "tdAtt":    ("count", ("tdAtt", "tdAttAg"), "kTdPM", [2, 4, 8, 16, 33, 66, 130], "takedown attempts per standing minute"),
    "tdAcc":    ("binom", ("tdAcc", "tdAccAg"), "kTdAcc", [1.5, 3, 6, 12, 24, 48, 96], "takedown success"),
    "ctrl":     ("count", ("ctrl", "octrl"), "kPM", [2.5, 5, 10, 20, 40, 80, 160], "control seconds per fight minute"),
    "topSkill": ("count", ("topSkill", "escWeak"), "kCtrlTD", [0.5, 1, 2, 4, 8, 16, 32], "control seconds per takedown landed"),
    "sub":      ("count", ("sub", "subAg"), "kPM", [0.75, 1.5, 3, 6, 11, 22, 45], "submission attempts per ground minute"),
}
# minimum exposure for a held-out row to be scored (tiny exposures with events give unbounded deviance)
EVAL_MIN = {"dAtt": 0.5, "cAtt": 0.5, "gAtt": 0.25, "kd": 1, "tdAtt": 0.5, "ctrl": 0.5, "topSkill": 1, "sub": 0.5}


def row_exposures(V, p):
    gs = p["ctrlGroundShare"]
    mn = V[:, KI["min"]]
    c, oc = V[:, KI["ctrl"]], V[:, KI["octrl"]]
    return {"min": mn,
            "distMin": np.maximum(0.25 * mn, mn - (c + oc) / 60),
            "standMin": np.maximum(0.3 * mn, mn - (c + oc) / 60 * gs),
            "topMin": c / 60 * gs, "botMin": oc / 60 * gs, "grMin": (c + oc) / 60 * gs}


def row_acc_baseline(V, L, p):
    """Expected accuracy by target for each row given its own position attempts (engine expAcc), n x 3."""
    eps = 1e-6
    n = len(V)
    cm = np.tile(np.array(p["clinchMix"]), (n, 1))
    gm = np.tile(np.array(p["groundTopMix"]), (n, 1))
    w = np.column_stack([V[:, KI["d_att"]] + eps * L.P_d_att, V[:, KI["c_att"]] + eps * L.P_c_att,
                         V[:, KI["g_att"]] + eps * L.P_g_att])
    md = dist_mix(V, "", L, p)
    return np.column_stack([exp_acc(L, w, [md, cm, gm], t) for t in range(3)])


def family_arrays(name, V, L, p):
    """(y, E, Lb) for counts or (y, n, b) for binomials, one entry per row, offense perspective."""
    ex = row_exposures(V, p)
    g = lambda k: V[:, KI[k]]
    if name == "dAtt":
        return g("d_att"), ex["distMin"], L.dAtt
    if name == "cAtt":
        return g("c_att"), ex["min"], L.P_c_att
    if name == "gAtt":
        return g("g_att"), ex["topMin"], L.gAtt
    if name == "tdAtt":
        return g("td_att"), ex["standMin"], L.tdAtt
    if name == "ctrl":
        return g("ctrl"), ex["min"], L.P_ctrl
    if name == "topSkill":
        return g("ctrl"), g("td_lnd"), L.P_ctrl_per_td
    if name == "sub":
        return g("sub_att"), ex["grMin"], L.sub
    if name == "kd":
        return g("kd"), g("h_lnd"), L.P_kd_per_h
    if name == "tdAcc":
        return g("td_lnd"), g("td_att"), logit(L.P_td_acc)
    if name in ("accH", "accB", "accL"):
        t = "HBL".index(name[-1])
        nm = "hbl"[t]
        e = row_acc_baseline(V, L, p)[:, t]
        return g(nm + "_lnd"), g(nm + "_att"), logit(e)
    raise KeyError(name)


# ------------------------------------------------------------------ walk-forward solvers
def _sides_by_date(D):
    out = [[] for _ in D.dates]
    for j, di in enumerate(D.s_date_idx):
        out[di].append(j)
    return [np.array(x, dtype=int) for x in out]


def walk_count(D, y, E, Lb, hl, ko, kd, mode="full", tol=2e-5, maxit=400, extra_T=None):
    """Walk-forward Poisson-gamma two-way fit. Returns per backtest side: offense o, defense d, level c
    (from the fit on that fight's date using earlier rows only). mode: 'full' (opponent-adjusted),
    'nosos' (division/era baselines and level, opponents treated as average). extra_T: also fit at this
    day (rows with day < extra_T) and return the full (o, d, c) person arrays."""
    X, Y, day, NP = D.X, D.Y, D.day, D.NP
    EL = E * Lb
    o = np.zeros(NP)
    d = np.zeros(NP)
    ns = len(D.s_row)
    so, sd, sc = np.zeros(ns), np.zeros(ns), np.zeros(ns)
    lam = math.log(2) / hl
    sbd = D.sides_by_date
    its = []
    dates = list(D.dates)
    cuts = list(D.cut)
    if extra_T is not None:
        dates.append(extra_T)
        cuts.append(int(np.searchsorted(day, extra_T, side="left")))
    final = None
    for di, (T, na) in enumerate(zip(dates, cuts)):
        w = np.exp(-lam * (T - day[:na]))
        Xa, Ya = X[:na], Y[:na]
        wy, wEL, wE = w * y[:na], w * EL[:na], w * E[:na]
        Yo, Yd = np.bincount(Xa, wy, NP), np.bincount(Ya, wy, NP)
        WEo, WEd = np.bincount(Xa, wE, NP), np.bincount(Ya, wE, NP)
        WELo, WELd = np.bincount(Xa, wEL, NP), np.bincount(Ya, wEL, NP)
        sEL = wEL.sum()
        Lg = sEL / max(wE.sum(), 1e-300)
        Lbo = np.where(WEo > 0, WELo / np.maximum(WEo, 1e-300), Lg)
        Lbd = np.where(WEd > 0, WELd / np.maximum(WEd, 1e-300), Lg)
        c = math.log(max(wy.sum(), 1e-300) / max(sEL, 1e-300))
        ec = math.exp(c)
        ao, ad = ko * Lbo * ec, kd * Lbd * ec
        if mode == "nosos":
            o = np.log((Yo + ao) / (WELo * ec + ao))
            d = np.log((Yd + ad) / (WELd * ec + ad))
            it = 1
        else:
            wELc = wEL * ec
            for it in range(1, maxit + 1):
                Do = np.bincount(Xa, wELc * np.exp(d[Ya]), NP)
                o_new = np.log((Yo + ao) / (Do + ao))
                Dd = np.bincount(Ya, wELc * np.exp(o_new[Xa]), NP)
                d_new = np.log((Yd + ad) / (Dd + ad))
                # common shift along the o+delta / d-delta ridge (only the priors pin it): exact 1-D optimum
                A, Dsum = ao.sum(), ad.sum()
                Ao, Bd = (ao * np.exp(o_new)).sum(), (ad * np.exp(d_new)).sum()
                q = (A - Dsum)
                ed = (q + math.sqrt(q * q + 4 * Ao * Bd)) / (2 * Ao)
                sh = math.log(ed)
                o_new += sh
                d_new -= sh
                delta = max(np.abs(o_new - o).max(), np.abs(d_new - d).max())
                o, d = o_new, d_new
                if delta < tol:
                    break
        its.append(it)
        if di < len(D.dates):
            js = sbd[di]
            so[js], sd[js], sc[js] = o[D.s_person[js]], d[D.s_person[js]], c
        else:
            final = (o.copy(), d.copy(), c)
    return so, sd, sc, np.array(its), final


def walk_binom(D, y, n, b, hl, ko, kd, mode="full", tol=2e-5, maxit=400, extra_T=None):
    """Walk-forward binomial-logit two-way fit with pseudo-attempt priors (k attempts at the fighter's own
    baseline). Same outputs as walk_count (a, g, c)."""
    X, Y, day, NP = D.X, D.Y, D.day, D.NP
    a = np.zeros(NP)
    g = np.zeros(NP)
    ns = len(D.s_row)
    sa, sg, sc = np.zeros(ns), np.zeros(ns), np.zeros(ns)
    lam = math.log(2) / hl
    sbd = D.sides_by_date
    its = []
    dates = list(D.dates)
    cuts = list(D.cut)
    if extra_T is not None:
        dates.append(extra_T)
        cuts.append(int(np.searchsorted(day, extra_T, side="left")))
    final = None
    pb = sigm(b)
    c = 0.0
    for di, (T, na) in enumerate(zip(dates, cuts)):
        w = np.exp(-lam * (T - day[:na]))
        Xa, Ya, ba = X[:na], Y[:na], b[:na]
        wy, wn = w * y[:na], w * n[:na]
        Yo, Yd = np.bincount(Xa, wy, NP), np.bincount(Ya, wy, NP)
        No, Nd = np.bincount(Xa, wn, NP), np.bincount(Ya, wn, NP)
        eg = (wn * pb[:na]).sum() / max(wn.sum(), 1e-300)
        bo = logit(np.where(No > 0, np.bincount(Xa, wn * pb[:na], NP) / np.maximum(No, 1e-300), eg))
        bd = logit(np.where(Nd > 0, np.bincount(Ya, wn * pb[:na], NP) / np.maximum(Nd, 1e-300), eg))
        # level c: sum of expected = sum of observed at baseline (1-D Newton)
        sy = wy.sum()
        for _ in range(30):
            pp = sigm(ba + c)
            step = (sy - (wn * pp).sum()) / max((wn * pp * (1 - pp)).sum(), 1e-300)
            c += step
            if abs(step) < 1e-10:
                break
        if mode == "nosos":
            a = np.zeros(NP)
            g = np.zeros(NP)
            for it in range(1, 60):
                eta = ba + c + a[Xa]
                pp = sigm(eta)
                pr = sigm(bo + c + a)
                G = Yo - np.bincount(Xa, wn * pp, NP) + ko * (sigm(bo + c) - pr)
                H = np.bincount(Xa, wn * pp * (1 - pp), NP) + ko * pr * (1 - pr)
                st = G / H
                a += st
                if np.abs(st).max() < tol:
                    break
            for it2 in range(1, 60):
                eta = ba + c + g[Ya]
                pp = sigm(eta)
                pr = sigm(bd + c + g)
                G = Yd - np.bincount(Ya, wn * pp, NP) + kd * (sigm(bd + c) - pr)
                H = np.bincount(Ya, wn * pp * (1 - pp), NP) + kd * pr * (1 - pr)
                st = G / H
                g += st
                if np.abs(st).max() < tol:
                    break
            it = max(it, it2)
        else:
            base = ba + c
            for it in range(1, maxit + 1):
                pp = sigm(base + a[Xa] + g[Ya])
                pr = sigm(bo + c + a)
                G = Yo - np.bincount(Xa, wn * pp, NP) + ko * (sigm(bo + c) - pr)
                H = np.bincount(Xa, wn * pp * (1 - pp), NP) + ko * pr * (1 - pr)
                sta = G / H
                a = a + sta
                pp = sigm(base + a[Xa] + g[Ya])
                pr = sigm(bd + c + g)
                G = Yd - np.bincount(Ya, wn * pp, NP) + kd * (sigm(bd + c) - pr)
                H = np.bincount(Ya, wn * pp * (1 - pp), NP) + kd * pr * (1 - pr)
                stg = G / H
                g = g + stg
                if max(np.abs(sta).max(), np.abs(stg).max()) < tol:
                    break
        its.append(it)
        if di < len(D.dates):
            js = sbd[di]
            sa[js], sg[js], sc[js] = a[D.s_person[js]], g[D.s_person[js]], c
        else:
            final = (a.copy(), g.copy(), c)
    return sa, sg, sc, np.array(its), final


# ------------------------------------------------------------------ evaluation
def pois_dev(y, mu):
    mu = np.maximum(mu, 1e-12)
    t = np.where(y > 0, y * np.log(np.maximum(y, 1e-12) / mu), 0.0)
    return 2 * (t - (y - mu))


@np.errstate(divide="ignore", invalid="ignore")
def binom_dev(y, n, z):
    p = np.clip(sigm(z), 1e-9, 1 - 1e-9)
    a = np.where(y > 0, y * np.log(np.maximum(y, 1e-12) / (n * p)), 0.0)
    m = n - y
    bb = np.where(m > 0, m * np.log(np.maximum(m, 1e-12) / (n * (1 - p))), 0.0)
    return 2 * (a + bb)


RAW_K_GRID = {"kPM": [2.5, 5, 10, 20, 40, 80, 160, 320], "kAcc": [20, 40, 80, 150, 300, 600, 1200, 2400],
              "kTdPM": [5, 10, 20, 45, 90, 180, 360], "kTdAcc": [1.5, 3, 6, 12, 24, 48, 96],
              "kKD": [60, 120, 230, 460, 920, 1840, 3680], "kCtrlTD": [0.5, 1, 2, 4, 8, 16, 32]}


class Evaluator:
    """Held-out per-fight scoring on backtest sides: each side's attacking row (what he did in the fight),
    predicted from his offense and his opponent's defense, both frozen before the fight."""

    def __init__(self, D, p):
        self.D, self.p = D, p
        self.opp = np.arange(len(D.s_row)) ^ 1
        Vs = D.V[D.s_row]
        self.fam = {}
        for name, (kind, fields, kname, kgrid, label) in FAMILIES.items():
            y, E, Lb = family_arrays(name, Vs, D.sL, p)
            if kind == "count":
                ok = E >= EVAL_MIN[name]
            else:
                ok = E >= 1
            self.fam[name] = {"y": y, "E": E, "Lb": Lb, "ok": ok, "kind": kind,
                              "tune": ok & D.s_tune, "test": ok & D.s_test}
        self.engine_R = fighter_rates(D.s_S, D.sL, p)

    # predictions on the natural scale: mu for counts, logit z for binomials
    def pred_adj(self, name, so, sd, sc):
        f = self.fam[name]
        lin = sc + so + sd[self.opp]
        if f["kind"] == "count":
            return f["E"] * f["Lb"] * np.exp(lin)
        return f["Lb"] + lin

    def pred_raw(self, name, R):
        f = self.fam[name]
        off, de = FAMILIES[name][1]
        o = self.opp
        if name in ("accH", "accB", "accL"):
            t = "HBL".index(name[-1])
            return f["Lb"] + R["accSh"][:, t] + R["accAgSh"][o, t]
        if name == "tdAcc":
            return logit(R["tdAcc"]) + logit(R["tdAccAg"][o]) - f["Lb"]
        if name == "topSkill":
            return f["E"] * f["Lb"] * R["topSkill"] * R["escWeak"][o]
        return f["E"] * f["Lb"] * (R[off] / f["Lb"]) * (R[de][o] / f["Lb"])

    def score(self, name, pred, calibrate=True):
        """Deviance on tune and test (sums), after an optional level calibration fit on tune only."""
        f = self.fam[name]
        y, E, tu, te = f["y"], f["E"], f["tune"], f["test"]
        if f["kind"] == "count":
            s = y[tu].sum() / max(pred[tu].sum(), 1e-12) if calibrate else 1.0
            dv = pois_dev(y, pred * s)
            return {"tune": float(dv[tu].sum()), "test": float(dv[te].sum()), "scale": float(s),
                    "test_obs_over_pred_uncal": float(y[te].sum() / max(pred[te].sum(), 1e-12)), "dev": dv}
        dlt = 0.0
        if calibrate:
            for _ in range(40):
                pp = sigm(pred[tu] + dlt)
                st = (y[tu].sum() - (E[tu] * pp).sum()) / max((E[tu] * pp * (1 - pp)).sum(), 1e-12)
                dlt += st
                if abs(st) < 1e-10:
                    break
        dv = binom_dev(y, E, pred + dlt)
        return {"tune": float(dv[tu].sum()), "test": float(dv[te].sum()), "shift": float(dlt),
                "test_obs_over_pred_uncal": float(y[te].sum() / max((E[te] * sigm(pred[te])).sum(), 1e-12)),
                "dev": dv}

    def null_pred(self, name):
        """League-only prediction (division-year baseline, no fighter information)."""
        f = self.fam[name]
        return f["E"] * f["Lb"] if f["kind"] == "count" else f["Lb"].copy()


def boot_delta(D, dv_a, dv_b, mask, nb=2000, seed=7):
    """Cluster bootstrap (by fight) of sum(dev_a - dev_b) over masked sides. Returns mean, 2.5%, 97.5%."""
    diff = np.where(mask, dv_a - dv_b, 0.0)
    per_fight = diff[0::2] + diff[1::2]
    has = (mask[0::2] | mask[1::2])
    pf = per_fight[has]
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(pf), size=(nb, len(pf)))
    bs = pf[idx].sum(1)
    return float(pf.sum()), float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5)), int(has.sum())


# ------------------------------------------------------------------ grid runner (forked workers share D)
_G = {}


def _job(args):
    name, hl, ko, kd, mode = args
    D, p = _G["D"], _G["p"]
    kind = FAMILIES[name][0]
    y, E, Lb = _G["arr"][name]
    f = walk_count if kind == "count" else walk_binom
    so, sd, sc, its, _ = f(D, y, E, Lb, hl, ko, kd, mode)
    return args, so.astype(np.float32), sd.astype(np.float32), sc.astype(np.float32), float(its.mean())


def run_grid(D, p, jobs, procs):
    import multiprocessing as mp
    _G["D"], _G["p"] = D, p
    _G["arr"] = {name: family_arrays(name, D.V, D.L, p) for name in FAMILIES}
    out = {}
    if procs <= 1:
        for j in jobs:
            r = _job(j)
            out[r[0]] = r[1:]
        return out
    ctx = mp.get_context("fork")
    with ctx.Pool(procs) as pool:
        for r in pool.imap_unordered(_job, jobs, chunksize=2):
            out[r[0]] = r[1:]
    return out
