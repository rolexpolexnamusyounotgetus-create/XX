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
        y0 = min(f.date.year for f in fights if f.stats)
        for y in range(max(y0, 1997), snap.year + 1):
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
