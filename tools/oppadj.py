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

for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "1")
import numpy as np  # noqa: E402

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
    return 1.0 / (1.0 + np.exp(-np.clip(z, -35.0, 35.0)))


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


def walk_count(D, y, E, Lb, hl, ko, kd, mode="full", tol=5e-5, maxit=400, extra_T=None):
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


def walk_binom(D, y, n, b, hl, ko, kd, mode="full", tol=5e-5, maxit=400, extra_T=None):
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
                st = np.clip(G / H, -1.0, 1.0)
                a += st
                if np.abs(st).max() < tol:
                    break
            for it2 in range(1, 60):
                eta = ba + c + g[Ya]
                pp = sigm(eta)
                pr = sigm(bd + c + g)
                G = Yd - np.bincount(Ya, wn * pp, NP) + kd * (sigm(bd + c) - pr)
                H = np.bincount(Ya, wn * pp * (1 - pp), NP) + kd * pr * (1 - pr)
                st = np.clip(G / H, -1.0, 1.0)
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
                sta = np.clip(G / H, -1.0, 1.0)
                a = a + sta
                pp = sigm(base + a[Xa] + g[Ya])
                pr = sigm(bd + c + g)
                G = Yd - np.bincount(Ya, wn * pp, NP) + kd * (sigm(bd + c) - pr)
                H = np.bincount(Ya, wn * pp * (1 - pp), NP) + kd * pr * (1 - pr)
                stg = np.clip(G / H, -1.0, 1.0)
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


# ------------------------------------------------------------------ analysis driver
def kgrid_pairs(grid):
    return [(a, b) for a in grid for b in grid]


def rnd(x, sig=4):
    return B.rnd(x, sig)


def select(scores):
    """scores: {config: score dict}; minimum tune deviance."""
    best = min(scores, key=lambda c: scores[c]["tune"])
    return best, scores[best]


def raw_scan(D, ev, p, hls):
    """Engine-form raw shrunk rates at other half-lives and prior strengths (separate offense / defense k):
    a diagonal k scan at every half-life, then the full offense x defense grid at the best half-life.
    Returns {family: {(hl, ko, kd): score}} and the S arrays per hl."""
    out = {name: {} for name in FAMILIES}
    Ss = {hl: (D.s_S if hl == 730 else D.side_sums(hl)) for hl in hls}

    def run(name, hl, ko, kd):
        kind, (fo, fd), kname = FAMILIES[name][:3]
        R = fighter_rates(Ss[hl], D.sL, p, k={kname: {fo: ko, fd: kd}})
        sc = ev.score(name, ev.pred_raw(name, R))
        sc.pop("dev")
        out[name][(hl, ko, kd)] = sc

    for name, (kind, fields, kname, _, _) in FAMILIES.items():
        grid = RAW_K_GRID[kname]
        for hl in hls:
            for k in grid:
                run(name, hl, k, k)
        hb = min(out[name], key=lambda c: out[name][c]["tune"])[0]
        for ko, kd in kgrid_pairs(grid):
            if (hb, ko, kd) not in out[name]:
                run(name, hb, ko, kd)
        _, ko, kd = min(out[name], key=lambda c: out[name][c]["tune"])
        for hl in hls:
            if (hl, ko, kd) not in out[name]:
                run(name, hl, ko, kd)
    return out, Ss


def composites(D, ev, p, parts):
    """Per-side composite predictions conditional on the fight's actual time in each position.
    parts: dict with, per side, calibrated mu_d, mu_c, mu_g, acc shifts sh (n x 3), kd factor, mu_tdatt,
    td logit. Returns dict of predicted sig_att, sig_lnd, h_lnd, kd, td_lnd."""
    L = D.sL
    n = len(D.s_row)
    mixD = ev.engine_R["mixD"]
    cm = np.tile(np.array(p["clinchMix"]), (n, 1))
    gm = np.tile(np.array(p["groundTopMix"]), (n, 1))
    mus = [parts["mu_d"], parts["mu_c"], parts["mu_g"]]
    mixes = [mixD, cm, gm]
    lnd = np.zeros((n, 3))
    for t in range(3):
        for q in range(3):
            lnd[:, t] += mus[q] * mixes[q][:, t] * sigm(L.accA[:, t] + L.accB[:, q] + parts["sh"][:, t])
    out = {"sig_att": mus[0] + mus[1] + mus[2], "sig_lnd": lnd.sum(1), "h_lnd": lnd[:, 0]}
    out["kd"] = lnd[:, 0] * L.P_kd_per_h * parts["kdf"]
    out["td_lnd"] = parts["mu_tdatt"] * sigm(parts["td_z"])
    return out


def winner_features(D, ev, p, rates):
    """Pre-fight expected per-minute output for each side with league position shares (no actual-fight
    information): landed/min, KD per 15, TD landed per 15, control share. rates: per-side calibrated
    rates per exposure unit (dAtt, cAtt, gAtt, tdAtt, ctrl) and shifts (sh, kdf, td_z)."""
    L = D.sL
    n = len(D.s_row)
    gs = p["ctrlGroundShare"]
    top = np.clip(rates["ctrl"] / 60 * gs, 0, 0.8)
    att = [rates["dAtt"] * L.dist, rates["cAtt"], rates["gAtt"] * top]
    mixD = ev.engine_R["mixD"]
    cm = np.tile(np.array(p["clinchMix"]), (n, 1))
    gm = np.tile(np.array(p["groundTopMix"]), (n, 1))
    mixes = [mixD, cm, gm]
    lnd = np.zeros((n, 3))
    for t in range(3):
        for q in range(3):
            lnd[:, t] += att[q] * mixes[q][:, t] * sigm(L.accA[:, t] + L.accB[:, q] + rates["sh"][:, t])
    slpm = lnd.sum(1)
    kd15 = 15 * lnd[:, 0] * L.P_kd_per_h * rates["kdf"]
    td15 = 15 * rates["tdAtt"] * L.stand * sigm(rates["td_z"])
    ctrl = rates["ctrl"] / 60
    return np.column_stack([slpm, kd15, td15, ctrl])


def logit_fit(X, y, l2=1e-4):
    b = np.zeros(X.shape[1])
    for _ in range(100):
        pp = sigm(X @ b)
        H = X.T @ (X * (pp * (1 - pp))[:, None]) + l2 * np.eye(X.shape[1])
        st = np.linalg.solve(H, X.T @ (y - pp) - l2 * b)
        b += st
        if np.abs(st).max() < 1e-10:
            break
    return b


def winner_proxy(D, feats):
    """Symmetric winner model on differences (A - B) of pre-fight features, no intercept, mirrored rows.
    feats: {name: n_sides x m}. Fit on 2019-2023, score 2024+. Returns log loss / Brier / accuracy."""
    ent = D.entries
    win = np.array([e["result"]["winner"] for e in ent])
    dec = np.isin(win, ["A", "B"])
    yA = (win == "A").astype(float)
    date = np.array([e["date"] for e in ent])
    tune = dec & (date >= TUNE[0]) & (date <= TUNE[1])
    test = dec & (date >= TEST_FROM)
    elo = np.array([[e["A"]["elo"], e["B"]["elo"]] for e in ent], dtype=float)
    res = {}
    for name, F in feats.items():
        diff = F[0::2] - F[1::2]
        if name.endswith("+elo") or name == "elo":
            ed = (elo[:, 0] - elo[:, 1]) / 400 * math.log(10)
            diff = ed[:, None] if name == "elo" else np.column_stack([diff, ed])
        sd = diff[tune].std(0) + 1e-12
        Z = diff / sd
        Xtr = np.vstack([Z[tune], -Z[tune]])
        ytr = np.r_[yA[tune], 1 - yA[tune]]
        bcoef = logit_fit(Xtr, ytr)
        pt = sigm(Z[test] @ bcoef)
        yt = yA[test]
        pt = np.clip(pt, 1e-6, 1 - 1e-6)
        ll = -(yt * np.log(pt) + (1 - yt) * np.log(1 - pt))
        res[name] = {"n_test": int(test.sum()), "log_loss": float(ll.mean()),
                     "brier": float(((pt - yt) ** 2).mean()), "accuracy": float(((pt > 0.5) == (yt > 0.5)).mean()),
                     "coef_per_sd": [rnd(x) for x in bcoef], "_ll": ll}
    return res


def boot_ll(a, b, nb=2000, seed=11):
    rng = np.random.default_rng(seed)
    d = a - b
    idx = rng.integers(0, len(d), size=(nb, len(d)))
    bs = d[idx].mean(1)
    return float(d.mean()), float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5))


def family_base(name, L):
    """The engine-side league baseline each family's rate is expressed against (per row of L)."""
    return {"dAtt": L.dAtt, "cAtt": L.P_c_att, "gAtt": L.gAtt, "tdAtt": L.tdAtt, "ctrl": L.P_ctrl,
            "topSkill": np.ones(L.n), "sub": L.sub, "kd": L.P_kd_per_h, "tdAcc": logit(L.P_td_acc)}.get(name)


def side_factors(name, o, d, c, R, L, cal):
    """Adjustment factors relative to the engine's raw rates R (same sides): multiplicative for rates,
    odds multipliers for probabilities. cal: calibration-neutral term (count: multiplier per side,
    binomial: logit shift per side) so the engine's global scales tuned on raw rates stay valid."""
    kind, (fo, fd) = FAMILIES[name][0], FAMILIES[name][1]
    if name in ("accH", "accB", "accL"):
        t = "HBL".index(name[-1])
        return {"acc_" + str(t): np.exp(c / 2 + o - R["accSh"][:, t] + cal),
                "accAg_" + str(t): np.exp(c / 2 + d - R["accAgSh"][:, t] + cal)}
    base = family_base(name, L)
    if name == "tdAcc":
        lo = logit(R["tdAcc"])
        ld = logit(R["tdAccAg"])
        return {fo: np.exp(base + c / 2 + o + cal - lo), fd: np.exp(base + c / 2 + d + cal - ld)}
    return {fo: base * np.exp(c / 2 + o) * cal / R[fo], fd: base * np.exp(c / 2 + d) * cal / R[fd]}


FACTOR_FIELDS = ["dAtt", "dAttAg", "cAtt", "cAttAg", "gAtt", "gAttAg", "tdAtt", "tdAttAg", "tdAcc", "tdAccAg",
                 "ctrl", "octrl", "topSkill", "escWeak", "sub", "subAg", "pow", "chin"]


def pack_factors(F, j):
    out = {k: rnd(F[k][j], 3) for k in FACTOR_FIELDS}
    out["acc"] = [rnd(F["acc_%d" % t][j], 3) for t in range(3)]
    out["accAg"] = [rnd(F["accAg_%d" % t][j], 3) for t in range(3)]
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--procs", type=int, default=max(1, (os.cpu_count() or 2)))
    ap.add_argument("--quick", action="store_true", help="small grid (two half-lives, every other k)")
    ap.add_argument("--boot", type=int, default=2000)
    ap.add_argument("--out", default=os.path.join(OUT, "oppadj.json"))
    args = ap.parse_args()
    t0 = time.time()
    p = engine_params()
    D = Data(p)
    D.sides_by_date = _sides_by_date(D)
    ev = Evaluator(D, p)
    hls = [730, 1460] if args.quick else HL_GRID
    kg = {n: (g[::2] if args.quick else g) for n, (_, _, _, g, _) in FAMILIES.items()}

    # ---- baselines: league-only and the engine's raw shrunk rates (backtest S, half-life 730, params3 k)
    res = {"families": {}}
    eng_sc, null_sc = {}, {}
    for name in FAMILIES:
        null_sc[name] = ev.score(name, ev.null_pred(name))
        eng_sc[name] = ev.score(name, ev.pred_raw(name, ev.engine_R))
    print("baselines done %.0f s" % (time.time() - t0))

    # ---- raw shrunk rates re-tuned (half-life and separate offense/defense k), same engine formulas
    raw, Ss = raw_scan(D, ev, p, hls)
    print("raw scan done %.0f s" % (time.time() - t0))

    # ---- opponent-adjusted (full) and division/era-normalized without opponents (nosos)
    # stage A: diagonal k (k_off = k_def) at every half-life, plus the no-opponent ablation (one pass each)
    G = {}
    jobs = []
    for name in FAMILIES:
        for hl in hls:
            for k in kg[name]:
                jobs.append((name, hl, k, k, "full"))
                jobs.append((name, hl, k, k, "nosos"))
    print("stage A: %d walk-forward fits on %d processes" % (len(jobs), args.procs))
    G.update(run_grid(D, p, jobs, args.procs))
    print("stage A done %.0f s" % (time.time() - t0))

    def adj_score(name, cfg, mode="full"):
        hl, ko, kd = cfg
        if mode == "full":
            so, sd, sc, _ = G[(name, hl, ko, kd, "full")]
        else:
            so = G[(name, hl, ko, ko, "nosos")][0]
            sd = G[(name, hl, kd, kd, "nosos")][1]
            sc = G[(name, hl, ko, ko, "nosos")][2]
        s_ = ev.score(name, ev.pred_adj(name, so.astype(float), sd.astype(float), sc.astype(float)))
        s_.pop("dev")
        return s_

    # stage B: full offense x defense k grid at each family's best stage-A half-life
    best_hl = {}
    jobs = []
    for name in FAMILIES:
        diag = {(hl, k, k): adj_score(name, (hl, k, k)) for hl in hls for k in kg[name]}
        best_hl[name] = min(diag, key=lambda c: diag[c]["tune"])[0]
        for ko, kd in kgrid_pairs(kg[name]):
            if ko != kd:
                jobs.append((name, best_hl[name], ko, kd, "full"))
    print("stage B: %d fits" % len(jobs))
    G.update(run_grid(D, p, jobs, args.procs))
    print("stage B done %.0f s" % (time.time() - t0))
    # stage C: the best (k_off, k_def) at every other half-life (half-life scan at the chosen k ratio)
    jobs = []
    for name in FAMILIES:
        cand = {c: adj_score(name, c) for c in [(best_hl[name], a, b) for a, b in kgrid_pairs(kg[name])]}
        _, ko, kd = min(cand, key=lambda c: cand[c]["tune"])
        for hl in hls:
            if (name, hl, ko, kd, "full") not in G:
                jobs.append((name, hl, ko, kd, "full"))
    print("stage C: %d fits" % len(jobs))
    G.update(run_grid(D, p, jobs, args.procs))
    print("grid done %.0f s" % (time.time() - t0))

    chosen = {}
    for name, (kind, fields, kname, _, label) in FAMILIES.items():
        full_sc = {(hl, ko, kd): adj_score(name, (hl, ko, kd)) for (n_, hl, ko, kd, m_) in G
                   if n_ == name and m_ == "full"}
        nosos_sc = {(hl, ko, kd): adj_score(name, (hl, ko, kd), "nosos")
                    for hl in hls for ko, kd in kgrid_pairs(kg[name])}
        bf, bfs = select(full_sc)
        bn, bns = select(nosos_sc)
        br, brs = select(raw[name])
        # held-out deviance arrays for the bootstrap
        so, sd, sc, _ = G[(name,) + bf + ("full",)]
        so, sd, sc = so.astype(float), sd.astype(float), sc.astype(float)
        dv_full = ev.score(name, ev.pred_adj(name, so, sd, sc))
        dv_eng = ev.score(name, ev.pred_raw(name, ev.engine_R))
        Rr = fighter_rates(Ss[br[0]], D.sL, p, k={kname: {fields[0]: br[1], fields[1]: br[2]}})
        dv_raw = ev.score(name, ev.pred_raw(name, Rr))
        so1 = G[(name, bn[0], bn[1], bn[1], "nosos")][0].astype(float)
        sd1 = G[(name, bn[0], bn[2], bn[2], "nosos")][1].astype(float)
        sc1 = G[(name, bn[0], bn[1], bn[1], "nosos")][2].astype(float)
        dv_nos = ev.score(name, ev.pred_adj(name, so1, sd1, sc1))
        te = ev.fam[name]["test"]
        boots = {"vs_engine_raw": boot_delta(D, dv_eng["dev"], dv_full["dev"], te, args.boot),
                 "vs_raw_tuned": boot_delta(D, dv_raw["dev"], dv_full["dev"], te, args.boot),
                 "vs_nosos_tuned": boot_delta(D, dv_nos["dev"], dv_full["dev"], te, args.boot)}
        hl_scan = {}
        for hl in hls:
            c_ = min((k for k in full_sc if k[0] == hl), key=lambda k: full_sc[k]["tune"])
            r_ = min((k for k in raw[name] if k[0] == hl), key=lambda k: raw[name][k]["tune"])
            hl_scan[str(hl)] = {"full_best_k": [c_[1], c_[2]], "full_tune": rnd(full_sc[c_]["tune"], 6),
                                "full_test": rnd(full_sc[c_]["test"], 6),
                                "raw_best_k": [r_[1], r_[2]], "raw_tune": rnd(raw[name][r_]["tune"], 6),
                                "raw_test": rnd(raw[name][r_]["test"], 6)}
        k_scan = {"%s,%s" % (k[1], k[2]): [rnd(v["tune"], 6), rnd(v["test"], 6)]
                  for k, v in full_sc.items() if k[0] == bf[0]}
        hl_at_k = {str(k[0]): [rnd(v["tune"], 6), rnd(v["test"], 6)] for k, v in full_sc.items()
                   if k[1] == bf[1] and k[2] == bf[2]}
        test_best_cfg = min(full_sc, key=lambda c: full_sc[c]["test"])
        n_te = int(te.sum())
        res["families"][name] = {
            "label": label, "kind": kind, "engine_fields": list(fields), "engine_k_param": kname,
            "engine_k_value": p[kname],
            "n_tune_sides": int(ev.fam[name]["tune"].sum()), "n_test_sides": n_te,
            "chosen": {"half_life_days": bf[0], "k_offense": bf[1], "k_defense": bf[2],
                       "k_unit": {"count": "exposure units (see k_unit_note)", "binom": "attempts"}[kind]},
            "deviance": {
                "league_only": {"tune": rnd(null_sc[name]["tune"], 6), "test": rnd(null_sc[name]["test"], 6)},
                "engine_raw": {"tune": rnd(eng_sc[name]["tune"], 6), "test": rnd(eng_sc[name]["test"], 6),
                               "cal": rnd(eng_sc[name].get("scale", eng_sc[name].get("shift")), 4),
                               "test_obs_over_pred_uncal": rnd(eng_sc[name]["test_obs_over_pred_uncal"], 4)},
                "raw_tuned": {"tune": rnd(brs["tune"], 6), "test": rnd(brs["test"], 6),
                              "half_life_days": br[0], "k_offense": br[1], "k_defense": br[2],
                              "k_unit": "engine parameter units (%s)" % kname},
                "nosos_tuned": {"tune": rnd(bns["tune"], 6), "test": rnd(bns["test"], 6),
                                "half_life_days": bn[0], "k_offense": bn[1], "k_defense": bn[2]},
                "opp_adjusted": {"tune": rnd(bfs["tune"], 6), "test": rnd(bfs["test"], 6),
                                 "cal": rnd(bfs.get("scale", bfs.get("shift")), 4),
                                 "test_obs_over_pred_uncal": rnd(bfs["test_obs_over_pred_uncal"], 4)},
            },
            "test_delta_bootstrap_95": {k: {"delta": rnd(v[0], 5), "lo": rnd(v[1], 5), "hi": rnd(v[2], 5),
                                            "n_fights": v[3],
                                            "pct_of_baseline": rnd(100 * v[0] / max(
                                                {"vs_engine_raw": eng_sc[name]["test"], "vs_raw_tuned": brs["test"],
                                                 "vs_nosos_tuned": bns["test"]}[k], 1e-9), 3)}
                                        for k, v in boots.items()},
            "test_best_config_for_reference": {"half_life_days": test_best_cfg[0], "k_offense": test_best_cfg[1],
                                               "k_defense": test_best_cfg[2],
                                               "test": rnd(full_sc[test_best_cfg]["test"], 6)},
            "half_life_scan": hl_scan,
            "k_scan_at_chosen_half_life": k_scan,
            "half_life_scan_at_chosen_k": hl_at_k,
        }
        chosen[name] = {"cfg": bf, "so": so, "sd": sd, "sc": sc, "cal_adj": bfs.get("scale", bfs.get("shift")),
                        "cal_eng": eng_sc[name].get("scale", eng_sc[name].get("shift")),
                        "raw_cfg": br, "R_raw": Rr, "cal_raw": brs.get("scale", brs.get("shift"))}
        dl = res["families"][name]["test_delta_bootstrap_95"]["vs_engine_raw"]
        print("%-9s hl %4d k %s/%s | test dev engine %.0f raw-tuned %.0f nosos %.0f adj %.0f | "
              "adj vs engine %.1f%% [%.0f, %.0f]"
              % (name, bf[0], bf[1], bf[2], eng_sc[name]["test"], brs["test"], bns["test"], bfs["test"],
                 dl["pct_of_baseline"], dl["lo"], dl["hi"]))

    # ---- composites: per-fight strikes / KD / TD conditional on the fight's time in each position
    def parts_for(which):
        o_ = ev.opp
        P = {}
        for name in ("dAtt", "cAtt", "gAtt", "tdAtt"):
            f = ev.fam[name]
            if which == "adj":
                ch = chosen[name]
                P[name] = ev.pred_adj(name, ch["so"], ch["sd"], ch["sc"]) * ch["cal_adj"]
            else:
                R_ = ev.engine_R if which == "engine" else chosen[name]["R_raw"]
                cal = chosen[name]["cal_eng"] if which == "engine" else chosen[name]["cal_raw"]
                P[name] = ev.pred_raw(name, R_) * cal
        sh = np.zeros((len(o_), 3))
        for t, name in enumerate(("accH", "accB", "accL")):
            f = ev.fam[name]
            if which == "adj":
                ch = chosen[name]
                sh[:, t] = ev.pred_adj(name, ch["so"], ch["sd"], ch["sc"]) - f["Lb"] + ch["cal_adj"]
            else:
                R_ = ev.engine_R if which == "engine" else chosen[name]["R_raw"]
                cal = chosen[name]["cal_eng"] if which == "engine" else chosen[name]["cal_raw"]
                sh[:, t] = ev.pred_raw(name, R_) - f["Lb"] + cal
        fk = ev.fam["kd"]
        if which == "adj":
            ch = chosen["kd"]
            kdf = np.exp(ch["sc"] + ch["so"] + ch["sd"][o_]) * ch["cal_adj"]
            ch = chosen["tdAcc"]
            tdz = ev.pred_adj("tdAcc", ch["so"], ch["sd"], ch["sc"]) + ch["cal_adj"]
        else:
            R_ = ev.engine_R if which == "engine" else chosen["kd"]["R_raw"]
            cal = chosen["kd"]["cal_eng"] if which == "engine" else chosen["kd"]["cal_raw"]
            kdf = R_["pow"] / fk["Lb"] * R_["chin"][o_] / fk["Lb"] * cal
            R_ = ev.engine_R if which == "engine" else chosen["tdAcc"]["R_raw"]
            cal = chosen["tdAcc"]["cal_eng"] if which == "engine" else chosen["tdAcc"]["cal_raw"]
            tdz = ev.pred_raw("tdAcc", R_) + cal
        return {"mu_d": P["dAtt"], "mu_c": P["cAtt"], "mu_g": P["gAtt"], "sh": sh, "kdf": kdf,
                "mu_tdatt": P["tdAtt"], "td_z": tdz}

    Vs = D.V[D.s_row]
    actual = {"sig_att": Vs[:, KI["d_att"]] + Vs[:, KI["c_att"]] + Vs[:, KI["g_att"]],
              "sig_lnd": Vs[:, KI["d_lnd"]] + Vs[:, KI["c_lnd"]] + Vs[:, KI["g_lnd"]],
              "h_lnd": Vs[:, KI["h_lnd"]], "kd": Vs[:, KI["kd"]], "td_lnd": Vs[:, KI["td_lnd"]]}
    okc = Vs[:, KI["min"]] >= 0.5
    comp = {w: composites(D, ev, p, parts_for(w)) for w in ("engine", "raw_tuned", "adj")}
    res["composites"] = {}
    for k in actual:
        y = actual[k]
        row = {}
        dvs = {}
        for w in comp:
            mu = comp[w][k]
            tu, te = okc & D.s_tune, okc & D.s_test
            s = y[tu].sum() / mu[tu].sum()          # one level constant per composite, fit on tune
            dv = pois_dev(y, mu * s)
            dvs[w] = dv
            row[w] = {"test_dev": rnd(dv[te].sum(), 6), "test_mae": rnd(np.abs(y[te] - mu[te] * s).mean(), 4),
                      "test_rmse": rnd(np.sqrt(((y[te] - mu[te] * s) ** 2).mean()), 4), "tune_scale": rnd(s, 4)}
        te = okc & D.s_test
        bd = boot_delta(D, dvs["engine"], dvs["adj"], te, args.boot)
        br_ = boot_delta(D, dvs["raw_tuned"], dvs["adj"], te, args.boot)
        # MAE bootstrap (by fight)
        ae_e = np.abs(y - comp["engine"][k] * row["engine"]["tune_scale"])
        ae_a = np.abs(y - comp["adj"][k] * row["adj"]["tune_scale"])
        bm = boot_delta(D, ae_e, ae_a, te, args.boot)
        row["adj_vs_engine_dev_95"] = [rnd(bd[0], 5), rnd(bd[1], 5), rnd(bd[2], 5)]
        row["adj_vs_raw_tuned_dev_95"] = [rnd(br_[0], 5), rnd(br_[1], 5), rnd(br_[2], 5)]
        row["adj_vs_engine_mae_per_side_95"] = [rnd(bm[0] / te.sum(), 4), rnd(bm[1] / te.sum(), 4),
                                                rnd(bm[2] / te.sum(), 4)]
        row["n_test_sides"] = int(te.sum())
        res["composites"][k] = row
        print("composite %-7s test dev engine %.0f raw-tuned %.0f adj %.0f | MAE %.2f / %.2f / %.2f"
              % (k, row["engine"]["test_dev"], row["raw_tuned"]["test_dev"], row["adj"]["test_dev"],
                 row["engine"]["test_mae"], row["raw_tuned"]["test_mae"], row["adj"]["test_mae"]))

    # ---- winner proxy: pre-fight expected output differences only (symmetric, no intercept)
    def rates_for(which):
        P = parts_for(which)
        out = {"sh": P["sh"], "kdf": P["kdf"], "td_z": P["td_z"]}
        for name in ("dAtt", "cAtt", "gAtt", "tdAtt", "ctrl"):
            f = ev.fam[name]
            if which == "adj":
                ch = chosen[name]
                mu = ev.pred_adj(name, ch["so"], ch["sd"], ch["sc"]) * ch["cal_adj"]
            else:
                R_ = ev.engine_R if which == "engine" else chosen[name]["R_raw"]
                cal = chosen[name]["cal_eng"] if which == "engine" else chosen[name]["cal_raw"]
                mu = ev.pred_raw(name, R_) * cal
            out[name] = mu / np.maximum(f["E"], 1e-9)
            bad = f["E"] <= 1e-9          # rate when this fight had no exposure: recompute from the linear form
            if bad.any():
                if which == "adj":
                    ch = chosen[name]
                    out[name][bad] = (f["Lb"] * np.exp(ch["sc"] + ch["so"] + ch["sd"][ev.opp]) * ch["cal_adj"])[bad]
                else:
                    E1 = dict(f)
                    tmp = ev.fam[name]["E"].copy()
                    ev.fam[name]["E"] = np.ones_like(tmp)
                    R_ = ev.engine_R if which == "engine" else chosen[name]["R_raw"]
                    cal = chosen[name]["cal_eng"] if which == "engine" else chosen[name]["cal_raw"]
                    out[name][bad] = (ev.pred_raw(name, R_) * cal)[bad]
                    ev.fam[name]["E"] = tmp
        return out

    feats = {w: winner_features(D, ev, p, rates_for(w)) for w in ("engine", "raw_tuned", "adj")}
    wp = winner_proxy(D, {"engine": feats["engine"], "raw_tuned": feats["raw_tuned"], "adj": feats["adj"],
                          "elo": feats["adj"], "engine+elo": feats["engine"], "adj+elo": feats["adj"]})
    res["winner_proxy"] = {k: {kk: vv for kk, vv in v.items() if kk != "_ll"} for k, v in wp.items()}
    for a_, b_ in (("engine", "adj"), ("raw_tuned", "adj"), ("engine+elo", "adj+elo"), ("elo", "adj+elo")):
        m, lo, hi = boot_ll(wp[a_]["_ll"], wp[b_]["_ll"], args.boot)
        res["winner_proxy"]["delta_%s_minus_%s" % (a_, b_)] = [rnd(m, 4), rnd(lo, 4), rnd(hi, 4)]
    for k, v in res["winner_proxy"].items():
        print("winner proxy", k, v if not isinstance(v, dict) else
              "ll %.4f brier %.4f acc %.3f" % (v["log_loss"], v["brier"], v["accuracy"]))

    # ---- per-snapshot factors (relative to the engine's raw rates from the same backtest S)
    F = {}
    for name, ch in chosen.items():
        kind = FAMILIES[name][0]
        if kind == "count":
            cal = math.sqrt(ch["cal_adj"] / ch["cal_eng"])
        else:
            cal = (ch["cal_adj"] - ch["cal_eng"]) / 2
        F.update(side_factors(name, ch["so"], ch["sd"], ch["sc"], ev.engine_R, D.sL, cal))
    snaps = {}
    for i, e in enumerate(D.entries):
        snaps[e["id"]] = {"A": pack_factors(F, 2 * i), "B": pack_factors(F, 2 * i + 1)}
    # factor spread summary (2024+ sides)
    spread = {}
    for k in sorted(F):
        lf = np.log(F[k][D.s_test])
        spread[k] = {"sd_log": rnd(lf.std(), 3), "p05": rnd(np.exp(np.percentile(lf, 5)), 3),
                     "p50": rnd(np.exp(np.percentile(lf, 50)), 3), "p95": rnd(np.exp(np.percentile(lf, 95)), 3)}
    res["factor_spread_test_sides"] = spread

    # ---- roster factors: fit at the snapshot (every fight through it) and the engine's live raw rates
    fj = json.load(open(os.path.join(OUT, "fighters.json")))
    assert fj["meta"]["keys"] == KEYS
    slugs = sorted(fj["fighters"])
    inv = {s: i for i, s in D.pslug.items()}
    divs = []
    for s in slugs:
        dv = fj["fighters"][s].get("division")
        divs.append(("live", dv) if ("live", dv) in D.priors_by_key else ("live", "ALL"))
    Lr = LTable(divs, D.priors_by_key, p)
    Sr = np.array([fj["fighters"][s]["S"] for s in slugs], dtype=float)
    Rr = fighter_rates(Sr, Lr, p)
    T_snap = float(D.snapshot.toordinal() + 1)
    pidx = np.array([inv.get(s, -1) for s in slugs])
    FR = {}
    sched = {}
    for name, ch in chosen.items():
        kind = FAMILIES[name][0]
        hl, ko, kd = ch["cfg"]
        y, E, Lb = family_arrays(name, D.V, D.L, p)
        f = walk_count if kind == "count" else walk_binom
        _, _, _, _, (o_all, d_all, c_all) = f(D, y, E, Lb, hl, ko, kd, "full", extra_T=T_snap)
        has = pidx >= 0
        o_r = np.where(has, o_all[np.maximum(pidx, 0)], 0.0)
        d_r = np.where(has, d_all[np.maximum(pidx, 0)], 0.0)
        cal = math.sqrt(ch["cal_adj"] / ch["cal_eng"]) if kind == "count" else (ch["cal_adj"] - ch["cal_eng"]) / 2
        FR.update(side_factors(name, o_r, d_r, np.full(len(slugs), c_all), Rr, Lr, cal))
        # schedule diagnostic: exposure-weighted mean opponent defense effect he faced (decayed)
        w = np.exp(-math.log(2) / hl * (T_snap - D.day))
        if kind == "count":
            wt = w * E * Lb
            num = np.bincount(D.X, wt * np.exp(d_all[D.Y]), D.NP)
        else:
            wt = w * E
            num = np.bincount(D.X, wt * d_all[D.Y], D.NP)
        den = np.bincount(D.X, wt, D.NP)
        sc_ = np.where(den > 0, num / np.maximum(den, 1e-300), 1.0 if kind == "count" else 0.0)
        if kind == "binom":
            sc_ = np.exp(sc_)
        sched[name] = np.where(has, sc_[np.maximum(pidx, 0)], 1.0)
    roster = {}
    for j, s in enumerate(slugs):
        r_ = pack_factors(FR, j)
        r_["sched"] = {k: rnd(sched[k][j], 3) for k in ("dAtt", "accH", "kd", "tdAtt", "tdAcc", "ctrl")}
        roster[s] = r_

    # ---- k in engine units (league-wide, latest priors) for the recommendation
    Lall = league(D.live_priors["ALL"], p)
    unit_div = {"dAtt": Lall["dist"], "gAtt": Lall["top"], "tdAtt": Lall["stand"], "sub": Lall["ground"]}
    for name, fam in res["families"].items():
        u = unit_div.get(name, 1.0)
        fam["chosen"]["k_offense_engine_units"] = rnd(fam["chosen"]["k_offense"] / u, 3)
        fam["chosen"]["k_defense_engine_units"] = rnd(fam["chosen"]["k_defense"] / u, 3)
        fam["chosen"]["calibration_neutral_term"] = rnd(
            math.sqrt(chosen[name]["cal_adj"] / chosen[name]["cal_eng"]) if fam["kind"] == "count"
            else (chosen[name]["cal_adj"] - chosen[name]["cal_eng"]) / 2, 4)

    meta = {
        "built": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "snapshot": D.snapshot.isoformat(), "tool": "tools/oppadj.py", "report": "research/model_oppadj.md",
        "tune": "%s..%s" % TUNE, "test_from": TEST_FROM, "grid": "quick" if args.quick else "full",
        "half_life_grid": hls,
        "engine_params_used": {k: p[k] for k in ("kPM", "kAcc", "kTdPM", "kTdAcc", "kKD", "kCtrlTD", "kTgt",
                                                 "ctrlGroundShare")},
        "model": ("counts: E[y] = E * L * exp(c + o_X + d_Y); probabilities: logit p = b + c + a_X + g_Y; "
                  "fit walk-forward on every UFC fight with stats since %s before each prediction date, "
                  "weights 0.5^(days/half_life), conjugate pseudo-data priors of k exposure units at the "
                  "fighter's own baseline (exactly the engine's shr() when opponent effects are zero)"
                  % MODEL_FROM.isoformat()),
        "k_unit_note": ("count k are exposure units of each family: dAtt distance minutes, cAtt and ctrl fight "
                        "minutes, gAtt top minutes, tdAtt standing minutes, sub ground minutes, kd landed head "
                        "strikes, topSkill takedowns landed; binomial k are attempts. *_engine_units divide by "
                        "the league position share the engine multiplies its k by (kPM * L.dist etc.)"),
        "factors": ("per side, relative to src/engine3.js fighterRates on the same S (backtest S for snapshots, "
                    "fighters.json S with live priors of his division for the roster), params3 k values above. "
                    "Rates (dAtt dAttAg cAtt cAttAg gAtt gAttAg tdAtt tdAttAg ctrl octrl topSkill escWeak sub "
                    "subAg pow chin) multiply R.<field>; tdAcc / tdAccAg multiply the odds of R.tdAcc / "
                    "R.tdAccAg; acc / accAg (head, body, leg) multiply accuracy odds: R.accSh[t] += log(acc[t]), "
                    "R.accAgSh[t] += log(accAg[t]). Factors include half the fitted level c per side and a "
                    "calibration-neutral term so the engine's global scales tuned on raw rates stay valid. "
                    "Task names: att_adj = dAtt (cAtt, gAtt), def_adj = accAg (and dAttAg), acc_adj = acc, "
                    "kdpow_adj = pow, chin_adj = chin, td_adj = tdAtt and tdAcc, tddef_adj = tdAccAg."),
        "sched": ("roster only: exposure-weighted mean of what his opponents allowed relative to average "
                  "(> 1 = he faced leaky opponents, his raw numbers are inflated): dAtt attempts allowed, accH "
                  "head-accuracy odds allowed, kd opponents' chin (KD per head landed allowed), tdAtt "
                  "takedown attempts allowed, tdAcc takedown-success odds allowed, ctrl control allowed"),
        "n_snapshots": len(snaps), "n_roster": len(roster),
        "runtime_s": round(time.time() - t0, 1),
    }
    out = {"meta": meta, "results": res, "snapshots": snaps, "roster": roster}
    n = B.write_json(args.out, out)
    print("wrote %s (%s) in %.0f s" % (args.out, B.human(n), time.time() - t0))


if __name__ == "__main__":
    main()
