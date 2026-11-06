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
# hidden-data protocol (docs/BACKLOG.md): 2026+ is the sealed vault. Factors are still written for those snapshots
# (pure pre-fight outputs) but no 2026 fight is ever scored here.
VAULT_FROM = "2026-01-01"
HL_EXTRA = [3650]          # diagnostic only: beyond the task grid, never eligible for selection
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
        self.s_test = (self.s_date >= TEST_FROM) & (self.s_date < VAULT_FROM)
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
    def pred_adj(self, name, so, sd, sc, unit=False):
        f = self.fam[name]
        lin = sc + so + sd[self.opp]
        if f["kind"] == "count":
            return (1.0 if unit else f["E"]) * f["Lb"] * np.exp(lin)
        return f["Lb"] + lin

    def pred_raw(self, name, R, unit=False):
        """unit=True: the rate per unit of exposure (counts), independent of this fight's exposure."""
        f = self.fam[name]
        off, de = FAMILIES[name][1]
        o = self.opp
        E = 1.0 if unit else f["E"]
        if name in ("accH", "accB", "accL"):
            t = "HBL".index(name[-1])
            return f["Lb"] + R["accSh"][:, t] + R["accAgSh"][o, t]
        if name == "tdAcc":
            return logit(R["tdAcc"]) + logit(R["tdAccAg"][o]) - f["Lb"]
        if name == "topSkill":
            return E * f["Lb"] * R["topSkill"] * R["escWeak"][o]
        return E * f["Lb"] * (R[off] / f["Lb"]) * (R[de][o] / f["Lb"])

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


def boot_delta_twoway(D, dv_a, dv_b, mask, nb=2000, seed=13):
    """Uncertainty of sum(dev_a - dev_b) that allows for fighter-level dependence (verification pass): a fighter
    appears in several 2024-25 fights and the fight-cluster bootstrap treats those fights as independent.
    Returns (delta, dyadic lo, dyadic hi, pigeonhole lo, pigeonhole hi, se fight-cluster, se dyadic).
    dyadic: normal interval with the dyadic-robust variance of the sum (Fafchamps-Gubert / Aronow-Samii-Assenova):
      V = sum over pairs of fights that share a fighter (and each fight with itself) of e_f e_f', e_f = D_f - mean,
      computed as sum_q (sum of e over fighter q's fights)^2 - sum_f e_f^2.
    pigeonhole: Poisson(1) weight per person, side weight w_X * w_Y (Owen 2007); conservative here (it counts
      each fight's own variance about three times), reported as an upper bound only."""
    diff = np.where(mask, dv_a - dv_b, 0.0)
    has = mask[0::2] | mask[1::2]
    Df = (diff[0::2] + diff[1::2])[has]
    A, Bp = D.s_person[0::2][has], D.s_person[1::2][has]
    e = Df - Df.mean()
    Sq = np.bincount(A, e, D.NP) + np.bincount(Bp, e, D.NP)
    V = float(np.sum(Sq ** 2) - np.sum(e ** 2))
    Vf = float(np.sum(e ** 2))
    if V <= 0:
        V = Vf
    tot = float(Df.sum())
    se_d = math.sqrt(V)
    m = diff != 0
    dX, dY, dd = D.s_person[m], D.s_opp[m], diff[m]
    rng = np.random.default_rng(seed)
    bs = np.empty(nb)
    for b in range(nb):
        w = rng.poisson(1.0, D.NP).astype(float)
        bs[b] = np.sum(w[dX] * w[dY] * dd)
    return (tot, tot - 1.96 * se_d, tot + 1.96 * se_d, float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5)),
            math.sqrt(Vf), se_d)


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
        grid = RAW_K_GRID[kname][3:5] if len(hls) == 1 else RAW_K_GRID[kname]
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
    test = dec & (date >= TEST_FROM) & (date < VAULT_FROM)
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


def subgroups(D, dv_a, dv_b, mask):
    """Held-out deviance gain (a - b) by the attacker's prior UFC fights and by year, as % of a's deviance."""
    n_prior = np.array([e[t]["n"] for e in D.entries for t in ("A", "B")])
    yr = np.array([e["date"][:4] for e in D.entries for _ in (0, 1)])
    out = {}
    for lab, g in (("prior_fights_1_3", (n_prior <= 3)), ("prior_fights_4_8", (n_prior >= 4) & (n_prior <= 8)),
                   ("prior_fights_9_plus", n_prior >= 9), ("2024", yr == "2024"), ("2025", yr == "2025")):
        m = mask & g
        a, b = dv_a[m].sum(), dv_b[m].sum()
        out[lab] = {"n": int(m.sum()), "gain_pct": rnd(100 * (a - b) / max(a, 1e-9), 3)}
    return out


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


def side_factors(name, o, d, c, R, L, cal, lam=1.0):
    """Adjustment factors relative to the engine's raw rates R (same sides): multiplicative for rates,
    odds multipliers for probabilities. cal: calibration-neutral term (count: multiplier per side,
    binomial: logit shift per side) so the engine's global scales tuned on raw rates stay valid."""
    kind, (fo, fd) = FAMILIES[name][0], FAMILIES[name][1]
    if name in ("accH", "accB", "accL"):
        t = "HBL".index(name[-1])
        return {"acc_" + str(t): np.exp(lam * (c / 2 + o - R["accSh"][:, t]) + cal),
                "accAg_" + str(t): np.exp(lam * (c / 2 + d - R["accAgSh"][:, t]) + cal)}
    base = family_base(name, L)
    if name == "tdAcc":
        lo = logit(R["tdAcc"])
        ld = logit(R["tdAccAg"])
        return {fo: np.exp(lam * (base + c / 2 + o - lo) + cal), fd: np.exp(lam * (base + c / 2 + d - ld) + cal)}
    return {fo: (base * np.exp(c / 2 + o) / R[fo]) ** lam * cal, fd: (base * np.exp(c / 2 + d) / R[fd]) ** lam * cal}


FACTOR_FIELDS = ["dAtt", "dAttAg", "cAtt", "cAttAg", "gAtt", "gAttAg", "tdAtt", "tdAttAg", "tdAcc", "tdAccAg",
                 "ctrl", "octrl", "topSkill", "escWeak", "sub", "subAg", "pow", "chin"]


def pack_factors(F, j):
    out = {k: rnd(F[k][j], 3) for k in FACTOR_FIELDS}
    out["acc"] = [rnd(F["acc_%d" % t][j], 3) for t in range(3)]
    out["accAg"] = [rnd(F["accAg_%d" % t][j], 3) for t in range(3)]
    return out


def factors_at_division(roster_entry, recipe, S, P, p):
    """One roster fighter's factors for a bout in the division whose priors are P (verification pass). Uses the
    stored division-free effects roster_entry['eff'] and recipe = results['roster_recipe']['families']; S = his
    fighters.json S. Same formula as the backtest snapshot factors (built at the bout division)."""
    L = LTable([0], {0: P}, p)
    R = fighter_rates(np.array([S], dtype=float), L, p)
    F = {}
    for nm, (eo, ed) in roster_entry["eff"].items():
        rc = recipe[nm]
        F.update(side_factors(nm, np.array([eo]), np.array([ed]), 0.0, R, L, rc["kappa"], rc["lambda"]))
    return pack_factors(F, 0)


LAM_GRID = [round(0.1 * i, 1) for i in range(11)]


def blend(kind, pa, pe, lam):
    """Geometric blend for counts (log scale), linear on the logit for probabilities."""
    if kind == "count":
        pos = (pa > 0) & (pe > 0)
        out = lam * pa + (1 - lam) * pe
        out[pos] = np.exp(lam * np.log(pa[pos]) + (1 - lam) * np.log(pe[pos]))
        return out
    return lam * pa + (1 - lam) * pe


def avg_preds(kind, preds):
    """Equal-weight average of several adjusted predictions: geometric for counts, on the logit for
    probabilities (the same as averaging the log factors)."""
    if len(preds) == 1:
        return preds[0]
    if kind == "count":
        P = np.array(preds)
        pos = np.all(P > 0, axis=0)
        out = P.mean(0)
        out[pos] = np.exp(np.log(P[:, pos]).mean(0))
        return out
    return np.mean(preds, axis=0)


def avg_terms(terms):
    return tuple(np.mean([t[i] for t in terms], axis=0) for i in range(2))


def multi_factors(name, CA, R, L, cal, lam):
    """Factors for an equal-weight average over configs: exp(lam * mean log F_h) times the calibration term."""
    kind = FAMILIES[name][0]
    logs = None
    for so, sd, sc in CA:
        Fh = side_factors(name, so, sd, sc, R, L, 1.0 if kind == "count" else 0.0, 1.0)
        lf = {k: np.log(v) for k, v in Fh.items()}
        logs = lf if logs is None else {k: logs[k] + lf[k] for k in logs}
    n = len(CA)
    if kind == "count":
        return {k: np.exp(lam * v / n) * cal for k, v in logs.items()}
    return {k: np.exp(lam * v / n + cal) for k, v in logs.items()}


def adj_terms(ev, so, sd, sc):
    return sc / 2 + so, sc / 2 + sd[ev.opp]


def raw_terms(ev, name, R):
    f, o = ev.fam[name], ev.opp
    fo, fd = FAMILIES[name][1]
    if name.startswith("acc"):
        t = "HBL".index(name[-1])
        return R["accSh"][:, t], R["accAgSh"][o, t]
    if name == "tdAcc":
        return logit(R["tdAcc"]) - f["Lb"], logit(R["tdAccAg"][o]) - f["Lb"]
    if name == "topSkill":
        return np.log(R["topSkill"]), np.log(R["escWeak"][o])
    return np.log(R[fo] / f["Lb"]), np.log(R[fd][o] / f["Lb"])


def comb_fit(ev, name, terms, mask=None):
    """Fit log mu = log(E L) + c0 + a * offense + b * defense (or the logit analogue) on 2019-2023 sides
    (or on `mask`): a = b = 1 is the engine's pure log-linear / log5 combination. Returns a, b, c0 with standard
    errors (quasi-likelihood)."""
    f = ev.fam[name]
    m = f["tune"] if mask is None else mask
    X = np.column_stack([np.ones(m.sum()), terms[0][m], terms[1][m]])
    y = f["y"][m]
    if f["kind"] == "count":
        off = np.log(np.maximum(f["E"][m] * f["Lb"][m], 1e-12))
        bta = np.array([math.log(max(y.sum(), 1e-9) / np.exp(off).sum()), 1.0, 1.0])
        for _ in range(60):
            mu = np.exp(X @ bta + off)
            H = (X.T * mu) @ X
            st = np.linalg.solve(H, X.T @ (y - mu))
            bta += st
            if np.abs(st).max() < 1e-10:
                break
        mu = np.exp(X @ bta + off)
        phi = float(np.sum((y - mu) ** 2 / mu) / max(len(y) - 3, 1))
        cov = np.linalg.inv((X.T * mu) @ X) * phi
    else:
        n = f["E"][m]
        off = f["Lb"][m]
        bta = np.array([0.0, 1.0, 1.0])
        for _ in range(60):
            pp = sigm(X @ bta + off)
            W = n * pp * (1 - pp) + 1e-12
            st = np.linalg.solve((X.T * W) @ X, X.T @ (y - n * pp))
            bta += st
            if np.abs(st).max() < 1e-10:
                break
        pp = sigm(X @ bta + off)
        W = n * pp * (1 - pp) + 1e-12
        phi = float(np.sum((y - n * pp) ** 2 / W) / max(len(y) - 3, 1))
        cov = np.linalg.inv((X.T * W) @ X) * phi
    se = np.sqrt(np.diag(cov))
    return {"a": rnd(bta[1], 4), "a_se": rnd(se[1], 3), "b": rnd(bta[2], 4), "b_se": rnd(se[2], 3),
            "c0": rnd(bta[0], 4), "dispersion": rnd(phi, 3)}


# factor fields per family (acc / accAg entries are (list name, target index))
FAMILY_FIELDS = {"dAtt": ["dAtt", "dAttAg"], "cAtt": ["cAtt", "cAttAg"], "gAtt": ["gAtt", "gAttAg"],
                 "accH": [("acc", 0), ("accAg", 0)], "accB": [("acc", 1), ("accAg", 1)], "accL": [("acc", 2), ("accAg", 2)],
                 "kd": ["pow", "chin"], "tdAtt": ["tdAtt", "tdAttAg"], "tdAcc": ["tdAcc", "tdAccAg"],
                 "ctrl": ["ctrl", "octrl"], "topSkill": ["topSkill", "escWeak"], "sub": ["sub", "subAg"]}


def gate_factors(F, off):
    """Copy of one side's factor dict with the families in `off` set to 1 (not applied)."""
    G = {k: (list(v) if isinstance(v, list) else v) for k, v in F.items()}
    for fam in off:
        for fld in FAMILY_FIELDS[fam]:
            if isinstance(fld, tuple):
                G[fld[0]][fld[1]] = 1.0
            else:
                G[fld] = 1.0
    return G


def snaps_sha(snaps):
    import hashlib
    return hashlib.sha256(json.dumps(snaps, sort_keys=True).encode()).hexdigest()[:16]


# ------------------------------------------------------------------ engine-level check (Monte Carlo, engine v3)
def _bucket7(res):
    w, m = res["winner"], res["method"]
    if w not in ("A", "B"):
        return 3 if m == "DRAW" else None
    kind = 0 if m in ("KO", "DOC") else (1 if m == "SUB" else (2 if m in ("UD", "SD", "MD") else None))
    if kind is None:
        return None
    return kind if w == "A" else 6 - kind


def engine_eval(args):
    """Simulate every pre-vault backtest fight (2019-2025) with engine v3 in four configurations (same seeds): plain,
    plain x oppadj factors, ML stat-line rates (the v4 core), ML x oppadj^beta. Scores winner / 7-bin / finish log
    loss by period and folds the result into args.out. 2026 (vault) is never simulated."""
    out = json.load(open(args.out))
    snaps = out["snapshots"]
    bt = json.load(open(os.path.join(OUT, "backtest.json")))
    keys = bt["meta"]["keys"]
    scratch = args.engine_dir or os.path.join(ROOT, "out", "oppadj_engine")
    os.makedirs(scratch, exist_ok=True)
    # ML rates: out-of-fold (cv<year>) for 2019-2023, dev model (trained 2010-2023) for 2024-25
    ml_path = os.path.join(OUT, "mlrates_oof.json")
    mo = json.load(open(ml_path)) if os.path.exists(ml_path) else {"fights": {}, "meta": {"targets": []}}
    tg = mo["meta"]["targets"]
    BASE_KEY = {"kd_h": "kd_per_h"}
    om = out["results"].get("over_mlrates", {}).get("families", {})
    # pre-declared rule: beta = clip(beta fit on 2019-2023, 0, 1); topSkill has no ML counterpart
    ml_beta = {nm: float(min(1.0, max(0.0, om[nm]["beta_tune"]))) if nm in om else 0.0 for nm in FAMILIES}
    off = []
    block = "engine_backtest"
    if args.engine_gated:
        rec = out["results"]["recommendation"]
        off = [nm for nm, v in rec["families"].items() if v["engine_path_lambda"] == 0]
        ml_beta = {nm: float(rec["families"][nm]["ml_path_beta"]) for nm in FAMILIES}
        snaps = {fid: {t: gate_factors(v[t], off) for t in ("A", "B")} for fid, v in snaps.items()}
        block = "engine_backtest_recommended"

    def prior_for(py, div):
        allp = py.get("ALL", {})
        d = py.get(div) or allp
        o = dict(allp)
        o.update({k: v for k, v in d.items() if v is not None})
        return o

    periods = {"tune_2019_2023": (TUNE[0], "2024-01-01", args.engine_sims_tune),
               "test_2024_2025": (TEST_FROM, VAULT_FROM, args.engine_sims_test)}
    want = [x.strip() for x in args.engine_periods.split(",") if x.strip()]
    periods = {k: v for k, v in periods.items() if k.split("_")[0] in want}
    strip = ("pace3", "pace3_w", "kd_absorbed")
    CFG = ("plain", "adj", "ml", "ml_adj")
    import hashlib
    import shutil
    # freeze the engine sources for the whole run (other work may edit src/ meanwhile)
    frz = os.path.join(scratch, "engine_src")
    if args.engine_src:
        frz = args.engine_src           # reuse an existing frozen copy (e.g. the one an earlier run recorded)
    else:
        os.makedirs(os.path.join(frz, "ml"), exist_ok=True)
        for rel in ("engine3.js", "params3.js", os.path.join("ml", "mlrates.js")):
            shutil.copyfile(os.path.join(ROOT, "src", rel), os.path.join(frz, rel))
    env = dict(os.environ, OPPADJ_ENGINE_DIR=frz)
    sha = lambda rel: hashlib.sha256(open(os.path.join(frz, rel), "rb").read()).hexdigest()[:16]
    pv = subprocess.run(["node", "-e", "process.stdout.write(String(require(%s).version))"
                         % json.dumps(os.path.join(frz, "params3.js"))], capture_output=True, text=True).stdout
    res_all = {"ml_beta_used": {k: rnd(v, 4) for k, v in ml_beta.items()}, "families_off": off,
               "factors_sha16": snaps_sha(out["snapshots"]), "params3_version": pv,
               "engine3_sha16": sha("engine3.js"), "params3_sha16": sha("params3.js"),
               "mlrates_js_sha16": sha(os.path.join("ml", "mlrates.js"))}
    all_rec = {}
    for per, (lo, hi, N) in periods.items():
        fights = []
        for e in bt["fights"]:
            if not (lo <= e["date"] < hi) or e["id"] not in snaps:
                continue
            assert e["date"] < VAULT_FROM
            f = {k: e[k] for k in ("id", "date", "division", "rounds", "title") if k in e}
            f["prior_division"] = e.get("prior_division")
            for t in ("A", "B"):
                sd = {k: v for k, v in e[t].items() if k not in strip}
                sd["oppadj"] = snaps[e["id"]][t]
                f[t] = sd
            me = mo["fights"].get(e["id"])
            if me and "A" in me and "B" in me and tg:
                P = prior_for(bt["priors_asof"][e["date"][:4]], f["prior_division"] or f["division"])
                f["ml"] = {"A": me["A"], "B": me["B"]}
                f["ml_base"] = [float(P.get(BASE_KEY.get(t, t), 0.0) or 0.0) for t in tg]
            else:
                f["ml"] = None
            fights.append(f)
        inp = os.path.join(scratch, "in_%s.json" % per)
        with open(inp, "w") as fh:
            json.dump({"keys": keys, "priors": bt["priors_asof"], "ml_beta": ml_beta, "fights": fights}, fh)
        t1 = time.time()
        procs = []
        for part in range(args.procs):
            o_ = os.path.join(scratch, "out_%s_%d.json" % (per, part))
            procs.append((o_, subprocess.Popen(["node", os.path.join(HERE, "oppadj_engine.js"), inp, o_, str(N),
                                                str(part), str(args.procs)], env=env)))
        rows = {}
        for o_, pr in procs:
            if pr.wait() != 0:
                raise SystemExit("oppadj_engine.js failed")
            rows.update(json.load(open(o_))["rows"])
        print("engine check %s: %d fights x %d sims/orientation in %.0f s" % (per, len(rows), N, time.time() - t1))
        eps = 0.5 / N
        rec = []
        ent = {e["id"]: e for e in bt["fights"]}
        for fid, rr in rows.items():
            e = ent[fid]
            r = {"id": fid, "w": e["result"]["winner"], "b": _bucket7(e["result"]),
                 "both_n": e["A"]["n"] > 0 and e["B"]["n"] > 0,
                 "elo": 1 / (1 + 10 ** ((e["B"]["elo"] - e["A"]["elo"]) / 400))}
            for k in CFG:
                s_ = rr.get(k)
                if not s_ or "err" in s_:
                    continue
                pa = s_["pA"] / max(1e-9, s_["pA"] + s_["pB"])
                bins = np.array(s_["bins"]) * (1 - 7 * eps) + eps
                r[k] = (pa, bins)
            rec.append(r)

        def score(sub, cfgs):
            sub = [x for x in sub if all(c in x for c in cfgs)]
            dec = [x for x in sub if x["w"] in ("A", "B")]
            b7 = [x for x in sub if x["b"] is not None]
            o2 = {"n_decisive": len(dec), "n_bucketed": len(b7)}
            yv = np.array([1.0 if x["w"] == "A" else 0.0 for x in dec])
            lls = {}
            for k in cfgs:
                pa = np.clip(np.array([x[k][0] for x in dec]), 1e-4, 1 - 1e-4)
                ll = -(yv * np.log(pa) + (1 - yv) * np.log(1 - pa))
                l7 = np.array([-math.log(x[k][1][x["b"]]) for x in b7])
                fin = np.clip(np.array([x[k][1][[0, 1, 5, 6]].sum() for x in b7]), 1e-4, 1 - 1e-4)
                yf = np.array([1.0 if x["b"] in (0, 1, 5, 6) else 0.0 for x in b7])
                lf = -(yf * np.log(fin) + (1 - yf) * np.log(1 - fin))
                lls[k] = (ll, l7, lf)
                o2[k] = {"winner_log_loss": rnd(ll.mean(), 5), "brier": rnd(((pa - yv) ** 2).mean(), 5),
                         "accuracy": rnd(((pa > 0.5) == (yv > 0.5)).mean(), 4),
                         "outcome7_log_loss": rnd(l7.mean(), 5), "finish_log_loss": rnd(lf.mean(), 5),
                         "mean_abs_logit_A": rnd(float(np.abs(np.log(pa / (1 - pa))).mean()), 4)}
            pe = np.clip(np.array([x["elo"] for x in dec]), 1e-4, 1 - 1e-4)
            o2["elo_winner_log_loss"] = rnd(float((-(yv * np.log(pe) + (1 - yv) * np.log(1 - pe))).mean()), 5)
            for a_, b_ in (("adj", "plain"), ("ml", "plain"), ("ml_adj", "ml"), ("ml_adj", "plain")):
                if a_ not in cfgs or b_ not in cfgs:
                    continue
                for j, nm in enumerate(("winner_log_loss", "outcome7_log_loss", "finish_log_loss")):
                    m, lo_, hi_ = boot_ll(lls[a_][j], lls[b_][j], args.boot)
                    o2["%s_minus_%s_%s_95" % (a_, b_, nm)] = [rnd(m, 5), rnd(lo_, 5), rnd(hi_, 5)]
            return o2

        all_rec[per] = rec
        res_all[per] = {"sims_per_orientation": N,
                        "all_fights_plain_vs_adj": score(rec, ("plain", "adj")),
                        "ml_available_all_four": score(rec, CFG),
                        "ml_available_both_have_ufc_history": score([x for x in rec if x["both_n"]], CFG)}
        a_ = res_all[per]["ml_available_all_four"]
        print("  %s (n=%d) winner ll plain %.4f adj %.4f ml %.4f ml_adj %.4f | elo %.4f"
              % (per, a_["n_decisive"], a_["plain"]["winner_log_loss"], a_["adj"]["winner_log_loss"],
                 a_["ml"]["winner_log_loss"], a_["ml_adj"]["winner_log_loss"], a_["elo_winner_log_loss"]))
        for kk in ("adj_minus_plain_winner_log_loss_95", "ml_minus_plain_winner_log_loss_95",
                   "ml_adj_minus_ml_winner_log_loss_95", "ml_adj_minus_ml_outcome7_log_loss_95"):
            print("    %s %s" % (kk, a_[kk]))
    if len(all_rec) == 2:
        pooled = [x for v in all_rec.values() for x in v]
        res_all["pooled_2019_2025"] = {"ml_available_all_four": score(pooled, CFG),
                                       "all_fights_plain_vs_adj": score(pooled, ("plain", "adj"))}
        a_ = res_all["pooled_2019_2025"]["ml_available_all_four"]
        print("  pooled (n=%d) winner ll plain %.4f adj %.4f ml %.4f ml_adj %.4f | adj-plain %s | ml_adj-ml %s"
              % (a_["n_decisive"], a_["plain"]["winner_log_loss"], a_["adj"]["winner_log_loss"], a_["ml"]["winner_log_loss"],
                 a_["ml_adj"]["winner_log_loss"], a_["adj_minus_plain_winner_log_loss_95"],
                 a_["ml_adj_minus_ml_winner_log_loss_95"]))
    res_all["note"] = ("engine v3 (frozen copy of src/engine3.js, params3.js, ml/mlrates.js at the start of the run; "
                       "hashes above) via tools/oppadj_engine.js; "
                       "plain = engine raw shrunk rates; adj = the same rates times this file's snapshot factors; "
                       "ml = mlrates out-of-fold / dev rates through src/ml/mlrates.js applyToMatchup; ml_adj = ML "
                       "targets x (F_off,X F_def,Y)^beta (ml_beta_used); same seeds for every configuration, both "
                       "corner orders averaged; winner log loss on decisive fights; 7-bin = [A KO, A SUB, A DEC, "
                       "DRAW, B DEC, B SUB, B KO]; 2026+ never simulated")
    # Volkanovski vs Gaethje (live profiles, roster factors, 5 x 5 title fight at lightweight), plain vs adjusted
    if args.engine_gated and "recommendation" in out["results"]:
        fj = json.load(open(os.path.join(OUT, "fighters.json")))
        offr = [nm for nm, v in out["results"]["recommendation"]["families"].items() if v["engine_path_lambda"] == 0]
        vg = {"id": "volk_gaethje", "date": "2026-11-06", "division": "Lightweight", "prior_division": "Lightweight",
              "rounds": 5, "title": True, "ml": None, "hypothetical": True}
        # factors at the bout division (verification pass): roster factors are relative to each fighter's own
        # division, but this bout is simulated at Lightweight with Lightweight priors (Volkanovski's home is
        # Featherweight); the backtest factors were built and validated at the bout division
        recipe = out["results"].get("roster_recipe", {}).get("families")
        Plw = dict(fj["priors"]["ALL"])
        Plw.update({k: v for k, v in fj["priors"]["Lightweight"].items() if v is not None})
        p_eng = engine_params()
        for t, slug in (("A", "alexander-volkanovski"), ("B", "justin-gaethje")):
            pr = dict(fj["fighters"][slug])
            if recipe and "eff" in out["roster"][slug]:
                fac = factors_at_division(out["roster"][slug], recipe, fj["fighters"][slug]["S"], Plw, p_eng)
            else:
                fac = out["roster"][slug]
            pr["oppadj"] = gate_factors(fac, offr)
            vg[t] = pr
        inp = os.path.join(scratch, "in_vg.json")
        with open(inp, "w") as fh:
            json.dump({"keys": fj["meta"]["keys"], "priors": {"2026": fj["priors"]}, "ml_beta": ml_beta, "fights": [vg]}, fh)
        o_ = os.path.join(scratch, "out_vg.json")
        subprocess.run(["node", os.path.join(HERE, "oppadj_engine.js"), inp, o_, str(args.engine_sims_vg), "0", "1"],
                       check=True, env=env)
        rr = json.load(open(o_))["rows"]["volk_gaethje"]
        res_all["volk_gaethje"] = {"sims_per_orientation": args.engine_sims_vg, "families_off": offr,
                                   "plain": rr["plain"], "adj": rr["adj"],
                                   "factors": {"A": vg["A"]["oppadj"], "B": vg["B"]["oppadj"]},
                                   "note": "A = Volkanovski, B = Gaethje; pA = P(Volkanovski wins); bins as above; "
                                           "fighters.json profiles and live priors; recommended factor set"}
        print("  Volk-Gaethje: plain pA %.4f pB %.4f | adj pA %.4f pB %.4f"
              % (rr["plain"]["pA"], rr["plain"]["pB"], rr["adj"]["pA"], rr["adj"]["pB"]))
    # keep the stored results of periods not re-run in this call (same factors and engine copy only)
    old_blk = out["results"].get(block) or {}
    same = all(old_blk.get(k) == res_all.get(k) for k in ("factors_sha16", "engine3_sha16", "params3_sha16", "mlrates_js_sha16"))
    if same:
        for k, v in old_blk.items():
            if k not in res_all:
                res_all[k] = v
    out["results"][block] = res_all
    n = B.write_json(args.out, out)
    print("updated %s (%s)" % (args.out, B.human(n)))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--procs", type=int, default=max(1, (os.cpu_count() or 2)))
    ap.add_argument("--quick", action="store_true", help="small grid (two half-lives, every other k)")
    ap.add_argument("--smoke", action="store_true", help="tiny grid to exercise the pipeline (one half-life)")
    ap.add_argument("--boot", type=int, default=2000)
    ap.add_argument("--out", default=os.path.join(OUT, "oppadj.json"))
    ap.add_argument("--cache", default="", help="pickle path for the grid results (written after the search)")
    ap.add_argument("--reuse", action="store_true", help="load the grid from --cache instead of searching")
    ap.add_argument("--engine-eval", action="store_true",
                    help="only run the engine v3 Monte Carlo check with the factors already in --out")
    ap.add_argument("--engine-sims-test", type=int, default=1000)
    ap.add_argument("--engine-sims-tune", type=int, default=300)
    ap.add_argument("--engine-dir", default="", help="scratch directory for the engine check (default out/oppadj_engine)")
    ap.add_argument("--engine-src", default="", help="use this frozen copy of engine3.js / params3.js / ml/mlrates.js "
                                                     "instead of copying src/ (hashes are recorded either way)")
    ap.add_argument("--engine-gated", action="store_true",
                    help="engine check with the recommended factor set (families off, ML-path betas) only")
    ap.add_argument("--engine-sims-vg", type=int, default=10000)
    ap.add_argument("--engine-periods", default="tune,test", help="comma list of tune, test (empty: Volk-Gaethje only)")
    args = ap.parse_args()
    if args.engine_eval:
        engine_eval(args)
        return
    t0 = time.time()
    p = engine_params()
    D = Data(p)
    D.sides_by_date = _sides_by_date(D)
    ev = Evaluator(D, p)
    hls = [1460] if args.smoke else ([730, 1460] if args.quick else HL_GRID)
    kg = {n: (g[2:4] if args.smoke else (g[::2] if args.quick else g)) for n, (_, _, _, g, _) in FAMILIES.items()}

    # ---- baselines: league-only and the engine's raw shrunk rates (backtest S, half-life 730, params3 k)
    res = {"families": {}}
    eng_sc, null_sc = {}, {}
    for name in FAMILIES:
        null_sc[name] = ev.score(name, ev.null_pred(name))
        eng_sc[name] = ev.score(name, ev.pred_raw(name, ev.engine_R))
    print("baselines done %.0f s" % (time.time() - t0))

    G = {}
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

    cache = args.cache
    if args.reuse and os.path.exists(cache):
        import pickle
        with open(cache, "rb") as fh:
            pk = pickle.load(fh)
        raw, Gc, hls_c, kg_c = pk[:4]
        assert hls_c == hls and kg_c == kg, "cache grid differs from the requested grid"
        # the cached side arrays follow the backtest entries of the run that wrote the cache; map them onto
        # today's entries by fight id (backtest.json lost its 2026 vault entries after the first build). Fits for
        # 2019-2025 dates use rows before each date only, so they do not depend on which later entries exist.
        ids_c = pk[4] if len(pk) > 4 else None
        if ids_c is None and os.path.exists(args.out):
            ids_c = list(json.load(open(args.out))["snapshots"].keys())
        n_c = len(next(iter(Gc.values()))[0])
        ids_now = [e["id"] for e in D.entries]
        if n_c != 2 * len(ids_now) or (ids_c is not None and list(ids_c) != ids_now):
            assert ids_c is not None and 2 * len(ids_c) == n_c, "cannot map the cached grid onto today's backtest"
            pos = {fid: i for i, fid in enumerate(ids_c)}
            sel = np.array([2 * pos[fid] + s for fid in ids_now for s in (0, 1)], dtype=int)
            Gc = {k: (v[0][sel], v[1][sel], v[2][sel], v[3]) for k, v in Gc.items()}
            print("cached grid mapped by fight id: %d -> %d sides" % (n_c, len(sel)))
        G.update(Gc)
        Ss = {hl: (D.s_S if hl == 730 else D.side_sums(hl)) for hl in hls}
        print("reused grid cache %s (%d fits)" % (cache, len(G)))
    else:
        # ---- raw shrunk rates re-tuned (half-life and separate offense/defense k), same engine formulas
        raw, Ss = raw_scan(D, ev, p, hls)
        print("raw scan done %.0f s" % (time.time() - t0))

        # ---- opponent-adjusted (full) and division/era-normalized without opponents (nosos)
        # stage A: diagonal k (k_off = k_def) at every half-life, plus the no-opponent ablation (one pass each)
        jobs = []
        for name in FAMILIES:
            for hl in hls:
                for k in kg[name]:
                    jobs.append((name, hl, k, k, "full"))
                    jobs.append((name, hl, k, k, "nosos"))
        print("stage A: %d walk-forward fits on %d processes" % (len(jobs), args.procs))
        G.update(run_grid(D, p, jobs, args.procs))
        print("stage A done %.0f s" % (time.time() - t0))

        # stage B: local search over (k_off, k_def) at each family's best stage-A half-life: evaluate the 8
        # neighbours of the incumbent in grid-index space, move to the best, stop when nothing improves on tune
        best_hl, cur = {}, {}
        for name in FAMILIES:
            diag = {(hl, k, k): adj_score(name, (hl, k, k)) for hl in hls for k in kg[name]}
            c0 = min(diag, key=lambda c: diag[c]["tune"])
            best_hl[name] = c0[0]
            g = kg[name]
            cur[name] = (g.index(c0[1]), g.index(c0[2]))
        active = set(FAMILIES)
        step = 0
        while active and step < 8:
            step += 1
            jobs = []
            for name in sorted(active):
                g = kg[name]
                i0, j0 = cur[name]
                for di in (-1, 0, 1):
                    for dj in (-1, 0, 1):
                        i, j = i0 + di, j0 + dj
                        if 0 <= i < len(g) and 0 <= j < len(g):
                            key = (name, best_hl[name], g[i], g[j], "full")
                            if key not in G:
                                jobs.append(key)
            if jobs:
                G.update(run_grid(D, p, jobs, args.procs))
            for name in sorted(active):
                g = kg[name]
                i0, j0 = cur[name]
                cands = [(i0 + di, j0 + dj) for di in (-1, 0, 1) for dj in (-1, 0, 1)
                         if 0 <= i0 + di < len(g) and 0 <= j0 + dj < len(g)]
                sc_ = {ij: adj_score(name, (best_hl[name], g[ij[0]], g[ij[1]]))["tune"] for ij in cands}
                nb = min(sc_, key=sc_.get)
                if nb == (i0, j0):
                    active.discard(name)
                else:
                    cur[name] = nb
            print("stage B step %d: %d fits, %d families still moving (%.0f s)"
                  % (step, len(jobs), len(active), time.time() - t0))
        # stage C: the best (k_off, k_def) at every other half-life (half-life scan at the chosen k ratio)
        jobs = []
        for name in FAMILIES:
            g = kg[name]
            ko, kd = g[cur[name][0]], g[cur[name][1]]
            for hl in hls:
                if (name, hl, ko, kd, "full") not in G:
                    jobs.append((name, hl, ko, kd, "full"))
        print("stage C: %d fits" % len(jobs))
        G.update(run_grid(D, p, jobs, args.procs))
        print("grid done %.0f s" % (time.time() - t0))
        if cache:
            import pickle
            with open(cache, "wb") as fh:
                pickle.dump((raw, G, hls, kg, [e["id"] for e in D.entries]), fh)

    chosen = {}
    for name, (kind, fields, kname, _, label) in FAMILIES.items():
        full_sc = {(hl, ko, kd): adj_score(name, (hl, ko, kd)) for (n_, hl, ko, kd, m_) in G
                   if n_ == name and m_ == "full"}
        nosos_sc = {(hl, ko, kd): adj_score(name, (hl, ko, kd), "nosos")
                    for hl in hls for ko, kd in kgrid_pairs(kg[name])}
        bf, bfs = select(full_sc)
        bn, bns = select(nosos_sc)
        br, brs = select(raw[name])
        arrs = lambda c: tuple(a.astype(float) for a in G[(name,) + c + ("full",)][:3])
        per_hl = {hl: min((c for c in full_sc if c[0] == hl), key=lambda c: full_sc[c]["tune"]) for hl in hls}
        pa_single = ev.pred_adj(name, *arrs(bf))
        pa_avg = avg_preds(kind, [ev.pred_adj(name, *arrs(c)) for c in per_hl.values()])
        s_avg = ev.score(name, pa_avg)
        s_avg.pop("dev")
        single_sc = bfs
        if len(hls) > 1 and s_avg["tune"] < bfs["tune"]:
            cfgs, pa, bfs = list(per_hl.values()), pa_avg, s_avg
        else:
            cfgs, pa = [bf], pa_single
        CA = [arrs(c) for c in cfgs]
        pe = ev.pred_raw(name, ev.engine_R)
        dv_full = ev.score(name, pa)
        dv_eng = ev.score(name, pe)
        Rr = fighter_rates(Ss[br[0]], D.sL, p, k={kname: {fields[0]: br[1], fields[1]: br[2]}})
        dv_raw = ev.score(name, ev.pred_raw(name, Rr))
        so1 = G[(name, bn[0], bn[1], bn[1], "nosos")][0].astype(float)
        sd1 = G[(name, bn[0], bn[2], bn[2], "nosos")][1].astype(float)
        sc1 = G[(name, bn[0], bn[1], bn[1], "nosos")][2].astype(float)
        dv_nos = ev.score(name, ev.pred_adj(name, so1, sd1, sc1))
        # like-for-like baselines (verification pass): when the adjusted model averages over half-lives, the raw
        # re-tuned and no-opp baselines get the same option (each half-life at its own best k on 2019-2023, used
        # only if the average beats their single best configuration on 2019-2023). Without this the "opponent
        # part" of the gain also contains the averaging.
        raw_hl = {hl: min((c for c in raw[name] if c[0] == hl), key=lambda c: raw[name][c]["tune"]) for hl in hls}
        pr_avg = avg_preds(kind, [ev.pred_raw(name, fighter_rates(Ss[c[0]], D.sL, p, k={kname: {fields[0]: c[1], fields[1]: c[2]}}))
                                  for c in raw_hl.values()])
        s_rawavg = ev.score(name, pr_avg)
        nos_hl = {hl: min((c for c in nosos_sc if c[0] == hl), key=lambda c: nosos_sc[c]["tune"]) for hl in hls}
        nos_arrs = lambda c: (G[(name, c[0], c[1], c[1], "nosos")][0].astype(float),
                              G[(name, c[0], c[2], c[2], "nosos")][1].astype(float),
                              G[(name, c[0], c[1], c[1], "nosos")][2].astype(float))
        s_nosavg = ev.score(name, avg_preds(kind, [ev.pred_adj(name, *nos_arrs(c)) for c in nos_hl.values()]))
        raw_avg_used = len(hls) > 1 and s_rawavg["tune"] < brs["tune"]
        nos_avg_used = len(hls) > 1 and s_nosavg["tune"] < bns["tune"]
        dv_raw_l = s_rawavg if raw_avg_used else dv_raw
        dv_nos_l = s_nosavg if nos_avg_used else dv_nos
        dv_single = ev.score(name, pa_single)
        # blend weight on 2019-2023: factor^lambda (lambda 0 = engine raw, 1 = fully opponent-adjusted)
        lam_sc = {lam: ev.score(name, blend(kind, pa, pe, lam)) for lam in LAM_GRID}
        lam = min(lam_sc, key=lambda l_: lam_sc[l_]["tune"])
        dv_fin = lam_sc[lam]
        te = ev.fam[name]["test"]
        boots = {"vs_engine_raw": boot_delta(D, dv_eng["dev"], dv_full["dev"], te, args.boot),
                 "vs_raw_tuned": boot_delta(D, dv_raw["dev"], dv_full["dev"], te, args.boot),
                 "vs_nosos_tuned": boot_delta(D, dv_nos["dev"], dv_full["dev"], te, args.boot),
                 "final_vs_engine_raw": boot_delta(D, dv_eng["dev"], dv_fin["dev"], te, args.boot),
                 "vs_raw_tuned_same_averaging": boot_delta(D, dv_raw_l["dev"], dv_full["dev"], te, args.boot),
                 "vs_nosos_tuned_same_averaging": boot_delta(D, dv_nos_l["dev"], dv_full["dev"], te, args.boot),
                 "single_config_vs_raw_tuned_single": boot_delta(D, dv_raw["dev"], dv_single["dev"], te, args.boot)}
        base_for = {"vs_engine_raw": dv_eng["test"], "vs_raw_tuned": brs["test"], "vs_nosos_tuned": bns["test"],
                    "final_vs_engine_raw": dv_eng["test"], "vs_raw_tuned_same_averaging": dv_raw_l["test"],
                    "vs_nosos_tuned_same_averaging": dv_nos_l["test"], "single_config_vs_raw_tuned_single": brs["test"]}
        boots2 = {"final_vs_engine_raw": boot_delta_twoway(D, dv_eng["dev"], dv_fin["dev"], te, args.boot),
                  "vs_raw_tuned_same_averaging": boot_delta_twoway(D, dv_raw_l["dev"], dv_full["dev"], te, args.boot),
                  "vs_nosos_tuned_same_averaging": boot_delta_twoway(D, dv_nos_l["dev"], dv_full["dev"], te, args.boot)}
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
        cal_of = lambda sc_: sc_.get("scale", sc_.get("shift"))
        res["families"][name] = {
            "label": label, "kind": kind, "engine_fields": list(fields), "engine_k_param": kname,
            "engine_k_value": p[kname],
            "n_tune_sides": int(ev.fam[name]["tune"].sum()), "n_test_sides": n_te,
            "chosen": {"half_life_days": bf[0], "k_offense": bf[1], "k_defense": bf[2],
                       "k_unit": {"count": "exposure units (see k_unit_note)", "binom": "attempts"}[kind],
                       "blend_lambda": lam,
                       "half_life_average": len(cfgs) > 1,
                       "configs": [{"half_life_days": c[0], "k_offense": c[1], "k_defense": c[2]} for c in cfgs]},
            "single_vs_average_tune": {"single_best": {"tune": rnd(single_sc["tune"], 6), "test": rnd(single_sc["test"], 6),
                                                       "half_life_days": bf[0], "k_offense": bf[1], "k_defense": bf[2]},
                                       "average_over_half_lives": {"tune": rnd(s_avg["tune"], 6),
                                                                   "test": rnd(s_avg["test"], 6)}},
            "deviance": {
                "league_only": {"tune": rnd(null_sc[name]["tune"], 6), "test": rnd(null_sc[name]["test"], 6)},
                "engine_raw": {"tune": rnd(eng_sc[name]["tune"], 6), "test": rnd(eng_sc[name]["test"], 6),
                               "cal": rnd(cal_of(eng_sc[name]), 4),
                               "test_obs_over_pred_uncal": rnd(eng_sc[name]["test_obs_over_pred_uncal"], 4)},
                "raw_tuned": {"tune": rnd(brs["tune"], 6), "test": rnd(brs["test"], 6),
                              "half_life_days": br[0], "k_offense": br[1], "k_defense": br[2],
                              "k_unit": "engine parameter units (%s)" % kname},
                "nosos_tuned": {"tune": rnd(bns["tune"], 6), "test": rnd(bns["test"], 6),
                                "half_life_days": bn[0], "k_offense": bn[1], "k_defense": bn[2]},
                "opp_adjusted": {"tune": rnd(bfs["tune"], 6), "test": rnd(bfs["test"], 6),
                                 "cal": rnd(cal_of(bfs), 4),
                                 "test_obs_over_pred_uncal": rnd(bfs["test_obs_over_pred_uncal"], 4)},
                "final_blend": {"tune": rnd(dv_fin["tune"], 6), "test": rnd(dv_fin["test"], 6),
                                "lambda": lam, "cal": rnd(cal_of(dv_fin), 4)},
            },
            "lambda_scan": {str(l_): [rnd(v["tune"], 6), rnd(v["test"], 6)] for l_, v in lam_sc.items()},
            "test_delta_bootstrap_95": {k: {"delta": rnd(v[0], 5), "lo": rnd(v[1], 5), "hi": rnd(v[2], 5),
                                            "n_fights": v[3],
                                            "pct_of_baseline": rnd(100 * v[0] / max(base_for[k], 1e-9), 3)}
                                        for k, v in boots.items()},
            "test_delta_fighter_dependence_95": {k: {"delta": rnd(v[0], 5),
                                                     "dyadic_lo": rnd(v[1], 5), "dyadic_hi": rnd(v[2], 5),
                                                     "dyadic_pct_lo": rnd(100 * v[1] / max(base_for[k], 1e-9), 3),
                                                     "dyadic_pct_hi": rnd(100 * v[2] / max(base_for[k], 1e-9), 3),
                                                     "pigeonhole_pct_lo": rnd(100 * v[3] / max(base_for[k], 1e-9), 3),
                                                     "pigeonhole_pct_hi": rnd(100 * v[4] / max(base_for[k], 1e-9), 3),
                                                     "se_fight_iid": rnd(v[5], 4), "se_dyadic": rnd(v[6], 4)}
                                                 for k, v in boots2.items()},
            "like_for_like_baselines": {
                "note": ("raw re-tuned and no-opp baselines with the same half-life-averaging option as the adjusted "
                         "model (verification pass); *_same_averaging bootstrap keys compare against these"),
                "raw_tuned_average_used": bool(raw_avg_used), "nosos_average_used": bool(nos_avg_used),
                "raw_tuned_average": {"tune": rnd(s_rawavg["tune"], 6), "test": rnd(s_rawavg["test"], 6),
                                      "configs": [list(c) for c in raw_hl.values()]},
                "nosos_average": {"tune": rnd(s_nosavg["tune"], 6), "test": rnd(s_nosavg["test"], 6),
                                  "configs": [list(c) for c in nos_hl.values()]},
                "opp_adjusted_single_config": {"tune": rnd(dv_single["tune"], 6), "test": rnd(dv_single["test"], 6)}},
            "test_best_config_for_reference": {"half_life_days": test_best_cfg[0], "k_offense": test_best_cfg[1],
                                               "k_defense": test_best_cfg[2],
                                               "test": rnd(full_sc[test_best_cfg]["test"], 6)},
            "half_life_scan": hl_scan,
            "k_scan_at_chosen_half_life": k_scan,
            "half_life_scan_at_chosen_k": hl_at_k,
            "final_vs_engine_by_group": subgroups(D, dv_eng["dev"], dv_fin["dev"], te),
            "combination_exponents_tune": {
                "opp_adjusted": comb_fit(ev, name, avg_terms([adj_terms(ev, *a) for a in CA])),
                "engine_raw": comb_fit(ev, name, raw_terms(ev, name, ev.engine_R)),
                "raw_tuned": comb_fit(ev, name, raw_terms(ev, name, Rr))},
            # diagnostic (verification pass): the tune-period fit is circular for models whose k was tuned on the
            # same sides at exponent 1; the 2024-25 fit is not used for anything
            "combination_exponents_test_diagnostic": {
                "opp_adjusted": comb_fit(ev, name, avg_terms([adj_terms(ev, *a) for a in CA]), te),
                "engine_raw": comb_fit(ev, name, raw_terms(ev, name, ev.engine_R), te),
                "raw_tuned": comb_fit(ev, name, raw_terms(ev, name, Rr), te)},
        }
        chosen[name] = {"cfgs": cfgs, "CA": CA, "cal_adj": cal_of(bfs),
                        "cal_eng": cal_of(eng_sc[name]), "raw_cfg": br, "R_raw": Rr, "cal_raw": cal_of(brs),
                        "lam": lam, "cal_fin": cal_of(dv_fin)}
        dl = res["families"][name]["test_delta_bootstrap_95"]
        print("%-9s hl %4d k %s/%s avg %d lam %.1f | test dev engine %.0f raw-tuned %.0f nosos %.0f adj %.0f final %.0f | "
              "adj vs engine %.1f%% [%.0f, %.0f]; final %.1f%%"
              % (name, bf[0], bf[1], bf[2], len(cfgs) > 1, lam, eng_sc[name]["test"], brs["test"], bns["test"], bfs["test"],
                 dv_fin["test"], dl["vs_engine_raw"]["pct_of_baseline"], dl["vs_engine_raw"]["lo"],
                 dl["vs_engine_raw"]["hi"], dl["final_vs_engine_raw"]["pct_of_baseline"]))

    def predict(name, which, unit=False):
        """Calibrated per-side prediction: mu (counts) or logit (binomials). which: engine, raw_tuned,
        full (lambda 1) or final (blend)."""
        ch = chosen[name]
        kind = FAMILIES[name][0]
        if which == "engine":
            pr, cal = ev.pred_raw(name, ev.engine_R, unit), ch["cal_eng"]
        elif which == "raw_tuned":
            pr, cal = ev.pred_raw(name, ch["R_raw"], unit), ch["cal_raw"]
        elif which == "full":
            pr, cal = avg_preds(kind, [ev.pred_adj(name, *a, unit=unit) for a in ch["CA"]]), ch["cal_adj"]
        else:
            pr = blend(kind, avg_preds(kind, [ev.pred_adj(name, *a, unit=unit) for a in ch["CA"]]),
                       ev.pred_raw(name, ev.engine_R, unit), ch["lam"])
            cal = ch["cal_fin"]
        return pr * cal if kind == "count" else pr + cal

    def parts_for(which, unit=False):
        sh = np.column_stack([predict(n_, which) - ev.fam[n_]["Lb"] for n_ in ("accH", "accB", "accL")])
        out = {"sh": sh, "kdf": predict("kd", which, True) / ev.fam["kd"]["Lb"], "td_z": predict("tdAcc", which)}
        for n_ in ("dAtt", "cAtt", "gAtt", "tdAtt", "ctrl"):
            out[n_] = predict(n_, which, unit)
        out["mu_d"], out["mu_c"], out["mu_g"], out["mu_tdatt"] = out["dAtt"], out["cAtt"], out["gAtt"], out["tdAtt"]
        return out

    # ---- held-out adjustment slope: how much of the predicted change (final vs engine raw) is real on 2024-25.
    # counts: log mu = log mu_eng + a0 + beta * log(mu_fin / mu_eng); binomials: the same on the logit.
    # beta = 1: the adjustment is right-sized; 0: it carries no information; a0 absorbs any level drift.
    # Also obs / pred by quintile of the predicted change (sides where the factors say the raw rate is inflated
    # should come in below the raw prediction).
    def adj_slope(name):
        f = ev.fam[name]
        kind = FAMILIES[name][0]
        te = f["test"]
        pe, pf = predict(name, "engine")[te], predict(name, "final")[te]
        y, n = f["y"][te], f["E"][te]
        if kind == "count":
            ok = (pe > 0) & (pf > 0)
            y, n, pe, pf = y[ok], n[ok], pe[ok], pf[ok]
            x = np.log(pf / pe)
            off = np.log(pe)
        else:
            x = pf - pe
            off = pe
        X = np.column_stack([np.ones(len(y)), x])
        bta = np.zeros(2)
        for _ in range(80):
            if kind == "count":
                mu = np.exp(X @ bta + off)
                W, r = mu, y - mu
            else:
                pp = sigm(X @ bta + off)
                W, r = n * pp * (1 - pp) + 1e-12, y - n * pp
            st = np.linalg.solve((X.T * W) @ X, X.T @ r)
            bta += st
            if np.abs(st).max() < 1e-10:
                break
        if kind == "count":
            mu = np.exp(X @ bta + off)
            phi = float(np.sum((y - mu) ** 2 / np.maximum(mu, 1e-12)) / max(len(y) - 2, 1))
            cov = np.linalg.inv((X.T * mu) @ X) * phi
        else:
            pp = sigm(X @ bta + off)
            W = n * pp * (1 - pp) + 1e-12
            phi = float(np.sum((y - n * pp) ** 2 / W) / max(len(y) - 2, 1))
            cov = np.linalg.inv((X.T * W) @ X) * phi
        qs = np.quantile(x, [0.2, 0.4, 0.6, 0.8])
        b_ = np.searchsorted(qs, x)
        tab = []
        for g in range(5):
            m = b_ == g
            if kind == "count":
                obs, e_, f_ = y[m].sum(), pe[m].sum(), pf[m].sum()
                tab.append({"pred_change": rnd(float(np.exp(np.median(x[m]))), 3), "n": int(m.sum()),
                            "obs_over_engine": rnd(obs / max(e_, 1e-12), 3), "obs_over_final": rnd(obs / max(f_, 1e-12), 3)})
            else:
                obs = y[m].sum() / max(n[m].sum(), 1e-12)
                e_ = (n[m] * sigm(pe[m])).sum() / max(n[m].sum(), 1e-12)
                f_ = (n[m] * sigm(pf[m])).sum() / max(n[m].sum(), 1e-12)
                tab.append({"pred_change_odds": rnd(float(np.exp(np.median(x[m]))), 3), "n": int(m.sum()),
                            "obs_rate": rnd(obs, 4), "engine_rate": rnd(e_, 4), "final_rate": rnd(f_, 4)})
        return {"beta": rnd(bta[1], 4), "beta_se": rnd(float(math.sqrt(cov[1, 1])), 3), "a0": rnd(bta[0], 4),
                "dispersion": rnd(phi, 3), "n_test_sides": int(len(y)), "sd_change": rnd(float(x.std()), 4),
                "quintiles": tab}

    for name in FAMILIES:
        res["families"][name]["heldout_adjustment_slope"] = adj_slope(name)
        hs = res["families"][name]["heldout_adjustment_slope"]
        print("slope %-9s beta %.3f (se %.3f) sd change %.3f" % (name, hs["beta"], hs["beta_se"], hs["sd_change"]))

    # ---- incremental value over the ML stat-line model (tools/mlrates.py, the v4 rate core): does the opponent
    # adjustment carry information the learned per-matchup rates miss? Baseline: the ML rate (out-of-fold for
    # 2019-2023, dev model trained 2010-2023 for 2024-25) with one level term fit on 2019-2023; challenger adds
    # x = log(final / engine raw) (logit difference for probabilities) with its coefficient fit on 2019-2023.
    ml_path = os.path.join(OUT, "mlrates_oof.json")
    if os.path.exists(ml_path):
        mo = json.load(open(ml_path))
        tg = mo["meta"]["targets"]
        MLMAP = {"dAtt": "d_att", "cAtt": "c_att", "gAtt": "g_att", "tdAtt": "td_att", "ctrl": "ctrl", "sub": "sub_att",
                 "accH": "acc_h", "accB": "acc_b", "accL": "acc_l", "tdAcc": "td_acc", "kd": "kd_h"}
        Vs_ = D.V[D.s_row]
        mins_ = Vs_[:, KI["min"]]
        ml_res = {}
        for name, t in MLMAP.items():
            jt = tg.index(t)
            mlr = np.array([mo["fights"][e["id"]][sd][jt] if e["id"] in mo["fights"] else np.nan
                            for e in D.entries for sd in ("A", "B")], dtype=float)
            f = ev.fam[name]
            kind = FAMILIES[name][0]
            pe, pf = predict(name, "engine"), predict(name, "final")
            y = f["y"]
            if kind == "count":
                n_ = f["E"] if name == "kd" else mins_
                off = np.log(np.maximum(n_ * mlr, 1e-12))
                x = np.log(np.maximum(pf, 1e-12) / np.maximum(pe, 1e-12))
                okm = np.isfinite(mlr) & (mlr > 0) & (pe > 0) & (pf > 0) & (n_ > 0)
            else:
                n_ = f["E"]
                off = logit(np.clip(mlr, 1e-6, 1 - 1e-6))
                x = pf - pe
                okm = np.isfinite(mlr)
            tu, te = f["tune"] & okm, f["test"] & okm

            def fitp(cols, m):
                X = np.column_stack([np.ones(m.sum())] + [c[m] for c in cols])
                b = np.zeros(X.shape[1])
                for _ in range(80):
                    if kind == "count":
                        mu = np.exp(X @ b + off[m])
                        W, r = mu, y[m] - mu
                    else:
                        pp = sigm(X @ b + off[m])
                        W, r = n_[m] * pp * (1 - pp) + 1e-12, y[m] - n_[m] * pp
                    st = np.linalg.solve((X.T * W) @ X + 1e-9 * np.eye(X.shape[1]), X.T @ r)
                    b += st
                    if np.abs(st).max() < 1e-10:
                        break
                return b

            def devs(b, cols):
                X = np.column_stack([np.ones(len(y))] + list(cols))
                z = X @ b + off
                if kind == "count":
                    return pois_dev(y, np.exp(z))
                return binom_dev(y, n_, z)

            b0 = fitp([], tu)
            b1 = fitp([x], tu)
            d0, d1 = devs(b0, []), devs(b1, [x])
            bt_ = boot_delta(D, d0, d1, te, args.boot)
            bte = fitp([x], te)
            ml_res[name] = {"n_tune": int(tu.sum()), "n_test": int(te.sum()), "beta_tune": rnd(b1[1], 4),
                            "beta_test_diagnostic": rnd(bte[1], 4),
                            "test_dev_ml": rnd(d0[te].sum(), 6), "test_dev_ml_plus_oppadj": rnd(d1[te].sum(), 6),
                            "test_gain_95": [rnd(bt_[0], 5), rnd(bt_[1], 5), rnd(bt_[2], 5)],
                            "test_gain_pct": rnd(100 * bt_[0] / max(d0[te].sum(), 1e-9), 3)}
            print("over ML %-6s beta tune %.3f (test %.3f) | test dev ML %.0f -> %.0f, gain %.1f [%.1f, %.1f]"
                  % (name, b1[1], bte[1], d0[te].sum(), d1[te].sum(), bt_[0], bt_[1], bt_[2]))
        res["over_mlrates"] = {"note": ("baseline = ML rate x exposure (fight minutes for counts, landed head strikes for "
                                        "kd, attempts for probabilities) with a level fit on 2019-2023; + oppadj adds "
                                        "x = log(final/engine raw) with coefficient fit on 2019-2023; gain = test "
                                        "deviance reduction 2024-25, 95% fight-cluster bootstrap"),
                               "families": ml_res}

    # ---- diagnostic beyond the task grid: half-life 3650 at the chosen k (never eligible for selection)
    if not args.smoke:
        jobs = []
        for name in FAMILIES:
            c = res["families"][name]["chosen"]
            for hx in HL_EXTRA:
                jobs.append((name, hx, c["k_offense"], c["k_defense"], "full"))
        GX = run_grid(D, p, jobs, args.procs)
        SX = {hx: D.side_sums(hx) for hx in HL_EXTRA}
        for name, (kind, fields, kname, _, _) in FAMILIES.items():
            fam = res["families"][name]
            c = fam["chosen"]
            rt = fam["deviance"]["raw_tuned"]
            out_x = {}
            for hx in HL_EXTRA:
                so, sd, sc = (a.astype(float) for a in GX[(name, hx, c["k_offense"], c["k_defense"], "full")][:3])
                sa = ev.score(name, ev.pred_adj(name, so, sd, sc))
                Rx = fighter_rates(SX[hx], D.sL, p, k={kname: {fields[0]: rt["k_offense"], fields[1]: rt["k_defense"]}})
                sr = ev.score(name, ev.pred_raw(name, Rx))
                out_x[str(hx)] = {"opp_adjusted_tune": rnd(sa["tune"], 6), "opp_adjusted_test": rnd(sa["test"], 6),
                                  "raw_tuned_k_tune": rnd(sr["tune"], 6), "raw_tuned_k_test": rnd(sr["test"], 6)}
            fam["half_life_extra_diagnostic"] = out_x
        print("extra half-life diagnostic done %.0f s" % (time.time() - t0))

    # ---- composites: per-fight strikes / KD / TD conditional on the fight's time in each position
    Vs = D.V[D.s_row]
    actual = {"sig_att": Vs[:, KI["d_att"]] + Vs[:, KI["c_att"]] + Vs[:, KI["g_att"]],
              "sig_lnd": Vs[:, KI["d_lnd"]] + Vs[:, KI["c_lnd"]] + Vs[:, KI["g_lnd"]],
              "h_lnd": Vs[:, KI["h_lnd"]], "kd": Vs[:, KI["kd"]], "td_lnd": Vs[:, KI["td_lnd"]]}
    okc = Vs[:, KI["min"]] >= 0.5
    WHICH = ("engine", "raw_tuned", "full", "final")
    comp = {w: composites(D, ev, p, parts_for(w)) for w in WHICH}
    res["composites"] = {}
    for k in actual:
        y = actual[k]
        row, dvs, aes = {}, {}, {}
        tu, te = okc & D.s_tune, okc & D.s_test
        for w in WHICH:
            mu = comp[w][k]
            s = y[tu].sum() / mu[tu].sum()          # one level constant per composite, fit on tune
            dvs[w] = pois_dev(y, mu * s)
            aes[w] = np.abs(y - mu * s)
            row[w] = {"test_dev": rnd(dvs[w][te].sum(), 6), "test_mae": rnd(aes[w][te].mean(), 4),
                      "test_rmse": rnd(np.sqrt(((y[te] - mu[te] * s) ** 2).mean()), 4), "tune_scale": rnd(s, 4)}
        for w in ("full", "final"):
            bd = boot_delta(D, dvs["engine"], dvs[w], te, args.boot)
            br_ = boot_delta(D, dvs["raw_tuned"], dvs[w], te, args.boot)
            bm = boot_delta(D, aes["engine"], aes[w], te, args.boot)
            row[w]["vs_engine_dev_95"] = [rnd(bd[0], 5), rnd(bd[1], 5), rnd(bd[2], 5)]
            row[w]["vs_raw_tuned_dev_95"] = [rnd(br_[0], 5), rnd(br_[1], 5), rnd(br_[2], 5)]
            row[w]["vs_engine_mae_per_side_95"] = [rnd(bm[0] / te.sum(), 4), rnd(bm[1] / te.sum(), 4),
                                                   rnd(bm[2] / te.sum(), 4)]
        row["n_test_sides"] = int(te.sum())
        row["final_vs_engine_by_group"] = subgroups(D, dvs["engine"], dvs["final"], te)
        res["composites"][k] = row
        print("composite %-7s test dev engine %.0f raw-tuned %.0f full %.0f final %.0f | MAE %.2f / %.2f / %.2f / %.2f"
              % (k, row["engine"]["test_dev"], row["raw_tuned"]["test_dev"], row["full"]["test_dev"],
                 row["final"]["test_dev"], row["engine"]["test_mae"], row["raw_tuned"]["test_mae"],
                 row["full"]["test_mae"], row["final"]["test_mae"]))

    # ---- winner proxy: pre-fight expected output differences only (symmetric, no intercept)
    feats = {w: winner_features(D, ev, p, parts_for(w, unit=True)) for w in WHICH}
    wp = winner_proxy(D, {"engine": feats["engine"], "raw_tuned": feats["raw_tuned"], "full": feats["full"],
                          "final": feats["final"], "elo": feats["final"], "engine+elo": feats["engine"],
                          "final+elo": feats["final"]})
    res["winner_proxy"] = {k: {kk: vv for kk, vv in v.items() if kk != "_ll"} for k, v in wp.items()}
    for a_, b_ in (("engine", "final"), ("engine", "full"), ("raw_tuned", "final"), ("engine+elo", "final+elo"),
                   ("elo", "final+elo")):
        m, lo, hi = boot_ll(wp[a_]["_ll"], wp[b_]["_ll"], args.boot)
        res["winner_proxy"]["delta_%s_minus_%s" % (a_, b_)] = [rnd(m, 4), rnd(lo, 4), rnd(hi, 4)]
    for k, v in res["winner_proxy"].items():
        print("winner proxy", k, v if not isinstance(v, dict) else
              "ll %.4f brier %.4f acc %.3f" % (v["log_loss"], v["brier"], v["accuracy"]))

    # ---- per-snapshot factors (relative to the engine's raw rates from the same backtest S)
    def cal_term(ch, kind):
        return math.sqrt(ch["cal_fin"] / ch["cal_eng"]) if kind == "count" else (ch["cal_fin"] - ch["cal_eng"]) / 2

    F = {}
    for name, ch in chosen.items():
        kind = FAMILIES[name][0]
        F.update(multi_factors(name, ch["CA"], ev.engine_R, D.sL, cal_term(ch, kind), ch["lam"]))
    # ---- recommendation (version selection on 2024-25 is allowed by the protocol; hyperparameters stay tune-only):
    # engine path: lambda chosen on 2019-2023, set to 0 for a family whose final factors did not beat the engine's raw
    # rates on 2024-25 per-fight deviance; ML path: beta = clip(beta fit on 2019-2023, 0, 1), 0 where the stacked
    # 2024-25 deviance did not improve on the ML rate alone (topSkill: no ML counterpart, engine path only)
    om_ = res.get("over_mlrates", {}).get("families", {})
    recf = {}
    for name in FAMILIES:
        fam = res["families"][name]
        gain = fam["test_delta_bootstrap_95"]["final_vs_engine_raw"]["delta"]
        lam_ = fam["chosen"]["blend_lambda"] if gain > 0 else 0.0
        if name in om_:
            mb = float(min(1.0, max(0.0, om_[name]["beta_tune"]))) if om_[name]["test_gain_95"][0] > 0 else 0.0
        else:
            mb = 0.0
        recf[name] = {"engine_path_lambda": lam_, "ml_path_beta": rnd(mb, 3),
                      "fields": [f if isinstance(f, str) else "%s[%d]" % f for f in FAMILY_FIELDS[name]],
                      "validated_gain_vs_engine_pct": fam["test_delta_bootstrap_95"]["final_vs_engine_raw"]["pct_of_baseline"],
                      "validated_gain_over_ml_pct": om_[name]["test_gain_pct"] if name in om_ else None}
    res["recommendation"] = {
        "families": recf,
        "rule": ("engine path: apply the snapshot / roster factors of families with engine_path_lambda > 0 (the factors "
                 "already include their lambda); set the others to 1. ML path (src/ml/mlrates.js targets): multiply each "
                 "ML target by (F_off,X * F_def,Y)^ml_path_beta (odds for probabilities); topSkill/escWeak multiply the "
                 "engine's R directly in both paths")}

    snaps = {}
    for i, e in enumerate(D.entries):
        snaps[e["id"]] = {"A": pack_factors(F, 2 * i), "B": pack_factors(F, 2 * i + 1)}
    # self-check: the engine form with these factors reproduces the blended held-out predictions
    chk = {}
    for name in ("dAtt", "accH", "kd", "tdAcc", "topSkill"):
        kind, (fo, fd) = FAMILIES[name][:2]
        R2 = {k: (v.copy() if isinstance(v, np.ndarray) else v) for k, v in ev.engine_R.items()}
        if name.startswith("acc"):
            t = "HBL".index(name[-1])
            R2["accSh"][:, t] += np.log(F["acc_%d" % t])
            R2["accAgSh"][:, t] += np.log(F["accAg_%d" % t])
        elif name == "tdAcc":
            R2["tdAcc"] = sigm(logit(R2["tdAcc"]) + np.log(F["tdAcc"]))
            R2["tdAccAg"] = sigm(logit(R2["tdAccAg"]) + np.log(F["tdAccAg"]))
        else:
            R2[fo] = R2[fo] * F[fo]
            R2[fd] = R2[fd] * F[fd]
        ch = chosen[name]
        via = ev.pred_raw(name, R2)
        via = via * ch["cal_eng"] if kind == "count" else via + ch["cal_eng"]
        tgt = predict(name, "final")
        ok = ev.fam[name]["ok"]
        chk[name] = rnd(float(np.max(np.abs(np.log(via[ok] / tgt[ok])) if kind == "count"
                                     else np.abs(via[ok] - tgt[ok]))), 3)
    res["factor_selfcheck_max_abs_log_error"] = chk
    print("factor self-check (max |log| error, rounding only):", chk)
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
    has = pidx >= 0
    FR, sched, EFF = {}, {}, {}
    for name, ch in chosen.items():
        kind = FAMILIES[name][0]
        y, E, Lb = family_arrays(name, D.V, D.L, p)
        f = walk_count if kind == "count" else walk_binom
        CR = []
        for hl, ko, kd in ch["cfgs"]:
            _, _, _, _, (o_all, d_all, c_all) = f(D, y, E, Lb, hl, ko, kd, "full", extra_T=T_snap)
            CR.append((np.where(has, o_all[np.maximum(pidx, 0)], 0.0), np.where(has, d_all[np.maximum(pidx, 0)], 0.0),
                       np.full(len(slugs), c_all)))
        FR.update(multi_factors(name, CR, Rr, Lr, cal_term(ch, kind), ch["lam"]))
        # division-free effects (verification pass): mean over configs of c/2 + o and c/2 + d. The factor for a bout
        # in any division D is side_factors(name, eff_o, eff_d, 0, R_D, L_D, kappa, lambda) with R_D, L_D the
        # engine's raw rates and league table at D's priors (factors_at_division below), which is how the
        # backtest factors were built (bout division) and validated.
        EFF[name] = (np.mean([cr[2] / 2 + cr[0] for cr in CR], axis=0), np.mean([cr[2] / 2 + cr[1] for cr in CR], axis=0))
        # schedule diagnostic (last config's fit): exposure-weighted mean opponent defense effect he faced
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
        r_["eff"] = {nm: [rnd(EFF[nm][0][j], 5), rnd(EFF[nm][1][j], 5)] for nm in EFF}
        roster[s] = r_
    res["roster_recipe"] = {
        "note": ("factors for a bout in division D (verification pass): F = side_factors(family, eff[0], eff[1], c=0, "
                 "R_D, L_D, kappa, lambda), i.e. counts F_off = (Lbar_D exp(eff_off) / R_D.off)^lambda * kappa, "
                 "probabilities F = exp(lambda (eff - shift_D) + kappa'); R_D, L_D = engine fighterRates / league at D's "
                 "priors. roster[slug] factors use the fighter's own division; for a cross-division bout use "
                 "tools/oppadj.py factors_at_division (the backtest factors are built at the bout division)."),
        "families": {nm: {"lambda": chosen[nm]["lam"], "kappa": rnd(cal_term(chosen[nm], FAMILIES[nm][0]), 6)}
                     for nm in chosen}}

    # ---- k in engine units (league-wide, latest priors) for the recommendation
    Lall = league(D.live_priors["ALL"], p)
    unit_div = {"dAtt": Lall["dist"], "gAtt": Lall["top"], "tdAtt": Lall["stand"], "sub": Lall["ground"]}
    for name, fam in res["families"].items():
        u = unit_div.get(name, 1.0)
        fam["chosen"]["k_offense_engine_units"] = rnd(fam["chosen"]["k_offense"] / u, 3)
        fam["chosen"]["k_defense_engine_units"] = rnd(fam["chosen"]["k_defense"] / u, 3)
        fam["chosen"]["calibration_neutral_term"] = rnd(
            math.sqrt(chosen[name]["cal_fin"] / chosen[name]["cal_eng"]) if fam["kind"] == "count"
            else (chosen[name]["cal_fin"] - chosen[name]["cal_eng"]) / 2, 4)

    meta = {
        "built": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "snapshot": D.snapshot.isoformat(), "tool": "tools/oppadj.py", "report": "research/model_oppadj.md",
        "tune": "%s..%s" % TUNE, "test_from": TEST_FROM, "test_until_excl": VAULT_FROM,
        "vault_note": "2026+ fights are the sealed vault (docs/BACKLOG.md hidden-data protocol): never scored here; their snapshot factors are pre-fight outputs only",
        "grid": "smoke" if args.smoke else ("quick" if args.quick else "full"),
        "half_life_grid": hls,
        "engine_params_used": {k: p[k] for k in ("kPM", "kAcc", "kTdPM", "kTdAcc", "kKD", "kCtrlTD", "kTgt",
                                                 "ctrlGroundShare")},
        "params3_version": p.get("version"),
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
    # backtest.json lost its 2026 (vault) entries after the first build of this file. Their pre-fight factors from
    # that build are kept when every common snapshot is identical (same fits, same data): they are pre-fight
    # outputs only, never scored here, and the vault audit needs them.
    if os.path.exists(args.out):
        try:
            old_s = json.load(open(args.out)).get("snapshots", {})
            extra = [k for k in old_s if k not in snaps]
            if extra and all(old_s.get(k) == v for k, v in snaps.items()):
                merged = {k: (snaps[k] if k in snaps else old_s[k]) for k in old_s}
                merged.update({k: v for k, v in snaps.items() if k not in merged})
                snaps = merged
                meta["snapshots_carried_over"] = ("%d snapshot entries (2026 vault fights, pre-fight factors only) carried "
                                                  "over from the earlier build; every other snapshot is identical" % len(extra))
                meta["n_snapshots"] = len(snaps)
        except (OSError, ValueError):
            pass
    out = {"meta": meta, "results": res, "snapshots": snaps, "roster": roster}
    meta["factors_sha16"] = snaps_sha(snaps)
    if os.path.exists(args.out):
        try:
            old = json.load(open(args.out))
            for blk in ("engine_backtest", "engine_backtest_recommended"):
                ob = old.get("results", {}).get(blk)
                if ob and ob.get("factors_sha16") == meta["factors_sha16"]:
                    res[blk] = ob
        except (OSError, ValueError):
            pass
    n = B.write_json(args.out, out)
    print("wrote %s (%s) in %.0f s" % (args.out, B.human(n), time.time() - t0))


if __name__ == "__main__":
    main()
