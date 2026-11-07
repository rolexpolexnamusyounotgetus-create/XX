#!/usr/bin/env python3
"""Era drift and league-level tracking (task key: eradrift).

Run from the project root (stages cache into out/eradrift_cache/, each can be re-run alone):

    nice -n 5 python3 tools/eradrift.py league     # league fight table 2001-2025 (2026 dropped at parse) + card 10-8s
    nice -n 5 python3 tools/eradrift.py trackers   # walk-forward league trackers, rolling-origin CV 2012-2023
    nice -n 5 python3 tools/eradrift.py base       # S2 / S2 + ML v2 winner per annual fold 2014-2024 (tools/ml2 recipe)
    nice -n 5 python3 tools/eradrift.py method     # level-adjusted S2+ml2win: CV 2016-2023, nested gate 2021-2023
    nice -n 5 python3 tools/eradrift.py stat       # level-adjusted statlines layer: CV 2021-2023 (folds fit 2019..Y-1)
    nice -n 5 python3 tools/eradrift.py prereg     # freeze the choices (writes out/eradrift_cache/prereg.json)
    nice -n 5 python3 tools/eradrift.py holdout    # 2024-01-01..2025-12-31 scored ONCE (a lock file refuses a rerun)
    nice -n 5 python3 tools/eradrift.py export     # data/derived/eradrift.json (levels by date, current, offsets, vectors)
    python3 tools/eradrift.py summary              # print the report tables from the JSON (no refit)
    node tests/test_eradrift.js                    # JS evaluator src/ml/eradrift.js vs the export

What it does. Two kinds of walk-forward trackers, each fed only with fights dated strictly before the card it predicts:
  (1) LEAGUE LEVELS of the outcome mix (decision / KO / SUB shares, UD/SD/MD split, finish-round shape, 3- vs 5-round
      decision share) and of stat lines (KD per 100 head strikes landed, sig strikes landed / attempted per minute,
      TD attempts and control per minute, submission attempts, card-implied 10-8 share). Tracker families: static
      (expanding), calendar 5-year window (what methodround's priors use), exponentially weighted with a half-life, and a
      local-level Kalman filter (state: league era level + division effects shrunk to the league, card-level event
      noise as an extra state reset per card), optionally with documented structural breaks as variance interventions
      (announced before the fights they affect; dates and sources in BREAKS).
  (2) MODEL-LEVEL BIAS trackers: the same filters run on the production models' own out-of-fold residuals, giving
      walk-forward offsets that level-adjust (a) the method model S2 + ML v2 winner (decision-vs-finish, KO-vs-SUB and
      round-1 shape, P(A wins) untouched) and (b) the statlines layer's per-stat means.
Choices (tracker type, half-life, Kalman variances, scopes, whether a target is adjusted at all) are made by rolling-
origin / forward-chained CV inside 2012-2023; the method adjustment must also pass the stack-style gate (nested forward-
chained 2021-2023, the 0.0005 rule of tools/ml2.py). 2024-2025 is scored once after a committed pre-registration.

Hidden-data protocol (docs/BACKLOG.md). build_db.parse_fights is wrapped by tools/ml2.py at import, so every fight dated
2026-01-01 or later is dropped right after parsing; every keyed source (statlines_oof.json, the S2 fold predictions) is
read for dates < 2026-01-01 only. Nothing from 2026 is collected, so nothing is written to the vault.

Corner symmetry (Evaluation rule). No tracker reads the corner: league levels are fight- or fight-side-level, method
offsets act on decision-vs-finish, KO-vs-SUB and round shape identically for both winners, and P(A wins) is ML v2's.
`method` asserts adjust(mirror(cells)) == mirror(adjust(cells)).
"""
import os

for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "1")
import argparse
import datetime as dt
import hashlib
import json
import math
import pickle
import sys
import time
import warnings
from collections import defaultdict

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.dirname(HERE)
DERIVED = os.path.join(ROOT, "data", "derived")
CACHE = os.environ.get("ERA_CACHE", os.path.join(ROOT, "out", "eradrift_cache"))
OUT_JSON = os.path.join(DERIVED, "eradrift.json")
VAULT = dt.date(2026, 1, 1)
TEST_FROM = dt.date(2024, 1, 1)
LEAGUE_FROM = dt.date(2001, 1, 1)            # Unified Rules era (warm-up only; scoring starts 2012)
CV_YEARS = tuple(range(2012, 2024))          # rolling-origin years for the league trackers
SEL_MIN = 0.0005                             # tools/ml2.py SEL_MIN (the 0.0005 rule)
os.makedirs(CACHE, exist_ok=True)
warnings.filterwarnings("ignore")

import ml2 as M2  # noqa: E402  (wraps build_db.parse_fights: 2026+ dropped at parse)
import build_db as B  # noqa: E402

assert B.parse_fights is M2._parse_dev_only, "vault wrapper missing"
STAGES = {}


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def cpath(name):
    return os.path.join(CACHE, name)


def save(obj, name):
    tmp = cpath(name + ".tmp")
    with open(tmp, "wb") as fh:
        pickle.dump(obj, fh, protocol=4)
    os.replace(tmp, cpath(name))


def load(name):
    with open(cpath(name), "rb") as fh:
        return pickle.load(fh)


def jdump(obj, name):
    with open(cpath(name), "w") as fh:
        json.dump(obj, fh, indent=1, default=_jdef)


def jload_c(name):
    with open(cpath(name)) as fh:
        return json.load(fh)


def _jdef(o):
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return float(o)
    if isinstance(o, np.ndarray):
        return o.tolist()
    if isinstance(o, (dt.date,)):
        return o.isoformat()
    raise TypeError(type(o))


def sig(z):
    return 1.0 / (1.0 + np.exp(-z))


def logit(p, c=1e-6):
    p = np.clip(np.asarray(p, float), c, 1 - c)
    return np.log(p / (1 - p))


def r5(x, k=5):
    return None if x is None or (isinstance(x, float) and not math.isfinite(x)) else round(float(x), k)


# ====================================================================== structural breaks (sourced; see report)
# Each break: effective date (first fights affected), the date it was announced (must be before the effective date),
# the tracker targets it plausibly moves (fixed a priori from what changed, never from outcomes), and sources.
BREAKS = [
    {"key": "usada2015", "effective": "2015-07-01", "announced": "2015-02-18",
     "what": "UFC Anti-Doping Program run by USADA begins (year-round out-of-competition testing)",
     "targets": ["ko", "sub", "dec", "dec3", "dec5", "kd100", "slpm", "sapm", "tdpm", "ctrlpm", "subpm", "r1_fin3",
                 "r1_fin5"],
     "sources": ["https://www.usada.org/announcement/usada-reports-first-round-athlete-test-history-ufc-anti-doping-program/",
                 "https://abc7ny.com/post/ufc-announces-extensive-doping-tests-major-punishments/767415/"]},
    {"key": "rules2017", "effective": "2017-01-01", "announced": "2016-08-02",
     "what": "Unified Rules judging criteria rewrite (10-8 guidance: dominance, damage/impact, duration) effective "
             "Jan 1, 2017 in adopting commissions (ABC vote Aug 2016)",
     "targets": ["r108", "sd_dec", "md_dec"],
     "sources": ["https://bloodyelbow.com/2017/01/02/2017-unified-rules-10-8-judging-criteria-explained-hinds-bell-mma-interview",
                 "https://journals.sagepub.com/doi/10.3233/JSA-200478"]},
    {"key": "nofans2020", "effective": "2020-03-14", "announced": "2020-03-12",
     "what": "events without fans (last crowd UFC 248, Mar 7, 2020; Brasilia card Mar 14 held behind closed doors)",
     "targets": ["sd_dec", "md_dec", "r108", "dec", "dec3", "dec5"],
     "sources": ["https://cagesidepress.com/2021/03/15/ufc-261-to-return-to-full-capacity-crowd"]},
    {"key": "fans2021", "effective": "2021-04-24", "announced": "2021-03-16",
     "what": "full crowds return (UFC 261, Jacksonville; announced Mar 16, 2021)",
     "targets": ["sd_dec", "md_dec", "r108", "dec", "dec3", "dec5"],
     "sources": ["https://www.cbssports.com/mma/news/ufc-261-fight-card-kamaru-usman-vs-jorge-masvidal-2-headlines-as-fans-will-return-at-full-capacity/",
                 "https://cagesidepress.com/2021/03/15/ufc-261-to-return-to-full-capacity-crowd"]},
    {"key": "gloves2024", "effective": "2024-06-01", "announced": "2024-04-12",
     "what": "new UFC fight glove (redesign) from UFC 302",
     "targets": ["ko", "dec", "dec3", "dec5", "kd100", "slpm", "sapm", "r1_fin3", "r1_fin5"],
     "sources": ["https://www.sherdog.com/news/news/UFC-Releases-New-Glove-Design-Claiming-to-Reduce-Chance-of-Injury-and-Eye-Pokes-193322",
                 "https://en.wikipedia.org/wiki/UFC_302",
                 "https://www.cbssports.com/mma/news/ufc-unveils-new-glove-design-that-addresses-cut-and-illegal-grab-issues-but-eye-pokes-still-a-problem"]},
    {"key": "abcrules2024", "effective": "2024-11-01", "announced": "2024-07-23",
     "what": "ABC Unified Rules update: 12-6 elbows legal, 'grounded' redefined (effective Nov 1, 2024 where adopted)",
     "targets": ["ko", "kd100", "r1_fin3", "r1_fin5"],
     "sources": ["https://global.espn.com/mma/story/_/id/40627706/abc-votes-remove-12-6-elbow-ban-redefines-grounded-opponent",
                 "https://www.cbssports.com/mma/news/commission-removes-12-6-elbows-from-unified-mma-rules-updates-grounded-opponent-rule",
                 "https://combatsportslaw.com/2024/01/31/mma-rules-committee-votes-to-remove-12-6-elbow-as-foul-and-redefine-grounded-fighters/"]},
    {"key": "oldgloves2024", "effective": "2024-11-16", "announced": "2024-11-12",
     "what": "old glove design back from UFC 309 (Dana White: permanent once stock arrives)",
     "targets": ["ko", "dec", "dec3", "dec5", "kd100", "slpm", "sapm", "r1_fin3", "r1_fin5"],
     "sources": ["https://cagesidepress.com/2024/11/13/ufc-reverts-to-old-glove-design-for-ufc-309",
                 "https://global.espn.com/mma/story/_/id/42533757/how-fighter-frustrations-brought-back-old-ufc-gloves"]},
    {"key": "oldgloves2025", "effective": "2025-02-15", "announced": "2025-02-15",
     "what": "old gloves for every fighter from UFC Vegas 102 on (announced at the start of that broadcast)",
     "targets": ["ko", "dec", "dec3", "dec5", "kd100", "slpm", "sapm", "r1_fin3", "r1_fin5"],
     "sources": ["https://bloodyelbow.com/2025/02/15/what-a-fiasco-fans-react-as-major-permanent-change-is-announced-at-ufc-vegas-102",
                 "https://thescore.com/mma/news/3128638"]},
]
for _b in BREAKS:
    assert _b["announced"] <= _b["effective"], _b["key"]
BREAK_DAYS = {b["key"]: dt.date.fromisoformat(b["effective"]).toordinal() for b in BREAKS}


# ====================================================================== stage: league
DIVS = [d for d in B.DIVISIONS if d not in B.NON_DIV]
DIV_IX = {d: i for i, d in enumerate(DIVS)}
DIV_ALL = len(DIVS)                          # catch / open weight: league level only (division effect 0)


def stage_league(args):
    """Every UFC fight 2001-01-01..2025-12-31 with a known result and a 3- or 5-round format."""
    lg = {}
    fights, _ = B.parse_fights(lg)
    assert max(f.date for f in fights) < VAULT, "vault row"
    B.build_vectors(fights, lg)
    rows = []
    for f in fights:
        if f.date < LEAGUE_FROM or f.sched not in (3, 5):
            continue
        if f.method in ("KO", "DOC"):
            cls = "KO"
        elif f.method == "SUB":
            cls = "SUB"
        elif f.method in ("UD", "SD", "MD"):
            cls = "DEC"
        elif f.method == "DRAW":
            cls = "DRAW"
        else:
            cls = "OTHER"                    # DQ, NC, CNC, overturned: excluded from the outcome mix
        r = {"fid": f.fid, "date": f.date, "day": f.day, "year": f.date.year, "event": f.event,
             "division": f.division, "div": DIV_IX.get(f.division, DIV_ALL), "sched": f.sched, "title": bool(f.title),
             "cls": cls, "method": f.method, "rnd": int(f.rnd), "fight_s": f.fight_s}
        # card-implied 10-8 rounds (evalv.js definition: 19 x judged rounds - card sum; deductions count as 10-8s)
        r["n108"], r["jr"] = np.nan, np.nan
        if f.method in ("UD", "SD", "MD", "DRAW") and f.cards and len(f.cards) == 3:
            w = jr = 0
            for c in f.cards:
                rj = max(1, int(round((c[0] + c[1]) / 19.0)))
                w += max(0, 19 * rj - (c[0] + c[1]))
                jr += rj
            r["n108"], r["jr"] = float(w), float(jr)
        st = None
        if f.stats:
            v = f.stats["v"]
            mins = float(f.stats["min"])
            if mins > 0:
                st = {}
                for k in ("h_lnd", "b_lnd", "l_lnd", "h_att", "b_att", "l_att", "kd", "td_att", "td_lnd", "ctrl",
                          "sub_att"):
                    st[k] = float(v[0][B.KI[k]] + v[1][B.KI[k]])
                st["sig_lnd"] = st["h_lnd"] + st["b_lnd"] + st["l_lnd"]
                st["sig_att"] = st["h_att"] + st["b_att"] + st["l_att"]
                st["fmin"] = 2.0 * mins          # fighter-minutes
                st["min"] = mins
        for k in ("sig_lnd", "sig_att", "h_lnd", "kd", "td_att", "ctrl", "sub_att", "fmin"):
            r["s_" + k] = st[k] if st else np.nan
        rows.append(r)
    L = pd.DataFrame(rows).sort_values(["day", "event"]).reset_index(drop=True)
    assert L["date"].max() < VAULT
    save(L, "league.pkl")
    log("league: %d fights %s..%s (%d with stats, %d decisions with 3 cards); classes %s" % (
        len(L), L["date"].min(), L["date"].max(), L["s_fmin"].notna().sum(), L["jr"].notna().sum(),
        dict(L["cls"].value_counts())))


STAGES["league"] = stage_league


# ====================================================================== tracker targets
# kind "bin": y in {0,1} per observation; kind "cnt": count y with exposure E (rate per unit of E).
def target_frames(L):
    oc = L["cls"].isin(["KO", "SUB", "DEC", "DRAW"]).to_numpy()
    dec = L["cls"].isin(["DEC", "DRAW"]).to_numpy()
    fin = L["cls"].isin(["KO", "SUB"]).to_numpy()
    decs = L["method"].isin(["UD", "SD", "MD"]).to_numpy()
    s3, s5 = (L["sched"] == 3).to_numpy(), (L["sched"] == 5).to_numpy()
    stat = L["s_fmin"].notna().to_numpy()
    T = {}

    def binary(key, mask, y, label):
        T[key] = {"kind": "bin", "mask": mask, "y": y.astype(float), "E": np.ones(len(L)), "label": label}

    def count(key, mask, y, E, label, unit):
        T[key] = {"kind": "cnt", "mask": mask & np.isfinite(y) & np.isfinite(E) & (E > 0), "y": y, "E": E,
                  "label": label, "unit": unit}

    binary("dec", oc, dec, "decision (incl. draw) share of fights")
    binary("ko", oc, (L["cls"] == "KO").to_numpy(), "KO/TKO share of fights")
    binary("sub", oc, (L["cls"] == "SUB").to_numpy(), "submission share of fights")
    binary("dec3", oc & s3, dec, "decision share, 3-round bouts")
    binary("dec5", oc & s5, dec, "decision share, 5-round bouts")
    binary("sd_dec", decs, (L["method"] == "SD").to_numpy(), "split decisions / decisions")
    binary("md_dec", decs, (L["method"] == "MD").to_numpy(), "majority decisions / decisions")
    binary("r1_fin3", fin & s3, (L["rnd"] == 1).to_numpy(), "round-1 share of finishes, 3-round bouts")
    binary("r1_fin5", fin & s5, (L["rnd"] == 1).to_numpy(), "round-1 share of finishes, 5-round bouts")
    binary("late_fin3", fin & s3, (L["rnd"] >= 3).to_numpy(), "round-3 share of finishes, 3-round bouts")
    f = L["s_fmin"].to_numpy()
    count("kd100", stat, L["s_kd"].to_numpy(), L["s_h_lnd"].to_numpy(), "knockdowns per head strike landed", 100.0)
    count("slpm", stat, L["s_sig_lnd"].to_numpy(), f, "sig strikes landed per fighter-minute", 1.0)
    count("sapm", stat, L["s_sig_att"].to_numpy(), f, "sig strikes attempted per fighter-minute", 1.0)
    count("tdpm", stat, L["s_td_att"].to_numpy(), f, "takedown attempts per fighter-minute (x15 = per 15 min)", 15.0)
    count("ctrlpm", stat, L["s_ctrl"].to_numpy(), f, "control seconds per fighter-minute", 1.0)
    count("subpm", stat, L["s_sub_att"].to_numpy(), f, "submission attempts per fighter-minute (x15)", 15.0)
    count("r108", L["jr"].notna().to_numpy(), L["n108"].to_numpy(), L["jr"].to_numpy(),
          "card-implied 10-8 rounds per judged round", 100.0)
    return T


# ====================================================================== tracker engine
YEAR_D = 365.25


def date_groups(day):
    """Sorted unique days and, per observation, the index of its day."""
    u, inv = np.unique(day, return_inverse=True)
    return u, inv


def nb_shape(y, mu):
    """Method-of-moments NB2 shape k from Var = mu + mu^2 / k (pooled over observations)."""
    r = (y - mu) ** 2 - mu
    num = (mu ** 2).sum()
    den = max(r.sum(), 1e-9)
    return float(np.clip(num / den, 0.5, 1e6))


def ew_track(day, y, E, div, kind, h, n0, prior, h_div=None, k_div=None, breaks=(), phi=0.0):
    """Exponentially weighted walk-forward level (prediction for each observation from strictly earlier days).
    League rate: (S_y + n0 * prior * Ebar) / (S_E + n0 * Ebar), sums decayed with half-life h years (h=None: no decay).
    Division layer (optional): slow EW sums (half-life h_div) of division and league; the division's deviation
    logit/log(p_div_slow) - logit/log(p_league_slow), with p_div_slow shrunk to the league by k_div observations, is
    added to the fast league level. Breaks: at an effective day, the fast sums are multiplied by (1 - phi)."""
    u, inv = date_groups(day)
    nd = DIV_ALL + 1
    Ebar = float(np.mean(E[E > 0])) if (E > 0).any() else 1.0     # rows with E = 0 are snapshot queries
    Sy = SE = 0.0
    Dy, DE = np.zeros(nd), np.zeros(nd)
    Ly = LE = 0.0
    pred = np.empty(len(y))
    last = None
    lam = (math.log(2) / (h * YEAR_D)) if h else 0.0
    lamd = (math.log(2) / (h_div * YEAR_D)) if h_div else 0.0
    bdays = sorted(breaks)
    bi = 0
    order = np.argsort(inv, kind="stable")
    starts = np.searchsorted(inv[order], np.arange(len(u)))
    ends = np.append(starts[1:], len(order))
    for g, d in enumerate(u):
        if last is not None:
            dd = d - last
            a = math.exp(-lam * dd)
            Sy *= a
            SE *= a
            if k_div is not None:
                b = math.exp(-lamd * dd)
                Dy *= b
                DE *= b
                Ly *= b
                LE *= b
        while bi < len(bdays) and bdays[bi] <= d:
            Sy *= (1 - phi)
            SE *= (1 - phi)
            bi += 1
        idx = order[starts[g]:ends[g]]
        pL = (Sy + n0 * prior * Ebar) / (SE + n0 * Ebar)
        if k_div is not None:
            pLs = (Ly + n0 * prior * Ebar) / (LE + n0 * Ebar)
            dv = div[idx]
            pD = (Dy[dv] + k_div * pLs * Ebar) / (DE[dv] + k_div * Ebar)
            if kind == "bin":
                pred[idx] = sig(logit(pL) + logit(pD) - logit(pLs))
            else:
                pred[idx] = pL * pD / max(pLs, 1e-12)
            pred[idx[dv == DIV_ALL]] = pL
        else:
            pred[idx] = pL
        ys, Es = y[idx], E[idx]
        Sy += ys.sum()
        SE += Es.sum()
        if k_div is not None:
            np.add.at(Dy, div[idx], ys)
            np.add.at(DE, div[idx], Es)
            Ly += ys.sum()
            LE += Es.sum()
        last = d
    return pred


def win5_track(day, year, y, E, div, kind, n0, prior, k_div=None):
    """Calendar window: fights in [Jan 1 of Y-5, Jan 1 of Y) (methodround's PRIOR_WINDOW construction), division
    shrunk to the league by k_div observations."""
    pred = np.empty(len(y))
    Ebar = float(np.mean(E[E > 0]))
    years = np.unique(year)
    for Y in years:
        m = year == Y
        w = (year >= Y - 5) & (year < Y)
        sy, se = y[w].sum(), E[w].sum()
        pL = (sy + n0 * prior * Ebar) / (se + n0 * Ebar)
        if k_div is None:
            pred[m] = pL
            continue
        Dy = np.bincount(div[w], weights=y[w], minlength=DIV_ALL + 1)
        DE = np.bincount(div[w], weights=E[w], minlength=DIV_ALL + 1)
        pD = (Dy + k_div * pL * Ebar) / (DE + k_div * Ebar)
        dv = div[m]
        if kind == "bin":
            p = sig(logit(pL) + logit(pD[dv]) - logit(pL))
        else:
            p = pD[dv]
        p[dv == DIV_ALL] = pL
        pred[m] = p
    return pred


def kalman_track(day, event, y, E, div, kind, q, se, sd_div, q_div, m0, P0, k_nb=None, breaks=(), vb=0.0,
                 out_state=False):
    """Local-level state space on the link scale (logit for shares, log for rates):
         eta_i = e_t + d_div(i) + eps_card(i) + log E_i (rates);   e_t random walk, variance q per year;
         d_div ~ N(0, sd_div^2) at start, random walk q_div per year (division effects shrunk to the league);
         eps_card ~ N(0, se^2), a fresh state for every card (event-level noise; dropped after the card).
       Observations: Bernoulli (shares) or NB2 with shape k_nb (rates), assimilated one at a time by the exact
       Newton/Laplace step at the current mean (an EKF for GLMs). Breaks: at an effective day, Var(e) += vb.
       The prediction for an observation uses the state before its card's day (same-day cards never see each other)."""
    u, inv = date_groups(day)
    nd = DIV_ALL + 1
    ns = 1 + nd
    x = np.zeros(ns)
    x[0] = m0
    P = np.zeros((ns, ns))
    P[0, 0] = P0
    for j in range(DIV_ALL):
        P[1 + j, 1 + j] = sd_div ** 2
    # division "ALL" (catch / open weight) has no division effect
    pred = np.empty(len(y))
    order = np.argsort(inv, kind="stable")
    starts = np.searchsorted(inv[order], np.arange(len(u)))
    ends = np.append(starts[1:], len(order))
    bdays = sorted(breaks)
    bi = 0
    last = None
    states = []
    for g, d in enumerate(u):
        if last is not None:
            dy = (d - last) / YEAR_D
            P[0, 0] += q * dy
            if q_div > 0:
                for j in range(DIV_ALL):
                    P[1 + j, 1 + j] += q_div * dy
        while bi < len(bdays) and bdays[bi] <= d:
            P[0, 0] += vb
            bi += 1
        idx = order[starts[g]:ends[g]]
        dv = div[idx]
        eta = x[0] + np.where(dv < DIV_ALL, x[1 + np.minimum(dv, DIV_ALL - 1)], 0.0)
        pred[idx] = sig(eta) if kind == "bin" else np.exp(eta)
        if out_state:
            states.append((d, x[0], P[0, 0], x[1:1 + DIV_ALL].copy(), np.diag(P)[1:1 + DIV_ALL].copy()))
        # assimilate the day's cards; each card gets its own event-noise state
        evs = event[idx]
        for ev in np.unique(evs):
            ii = idx[evs == ev]
            if se > 0:
                xa = np.append(x, 0.0)
                Pa = np.zeros((ns + 1, ns + 1))
                Pa[:ns, :ns] = P
                Pa[ns, ns] = se ** 2
            else:
                xa, Pa = x.copy(), P.copy()
            for i in ii:
                if E[i] <= 0:                    # snapshot query row: predicted, never assimilated
                    continue
                a = np.zeros(len(xa))
                a[0] = 1.0
                if div[i] < DIV_ALL:
                    a[1 + div[i]] = 1.0
                if se > 0:
                    a[ns] = 1.0
                eta_i = float(a @ xa)
                if kind == "bin":
                    p = sig(eta_i)
                    gr, hh = y[i] - p, p * (1 - p)
                else:
                    mu = E[i] * math.exp(eta_i)
                    kk = k_nb if k_nb else 1e6
                    gr = (y[i] - mu) * kk / (kk + mu)
                    hh = mu * kk / (kk + mu)
                Pa_a = Pa @ a
                s = float(a @ Pa_a)
                den = 1.0 + hh * s
                xa = xa + (gr / den) * Pa_a
                Pa = Pa - (hh / den) * np.outer(Pa_a, Pa_a)
            x, P = xa[:ns].copy(), Pa[:ns, :ns].copy()
        last = d
    if out_state:
        return pred, states
    return pred


def score_obs(kind, y, E, p, k_nb=None):
    """Per-observation loss: Bernoulli NLL (shares) or NB2 negative log likelihood with a fixed shape (rates);
    Poisson deviance is also returned for rates."""
    if kind == "bin":
        p = np.clip(p, 1e-9, 1 - 1e-9)
        return -(y * np.log(p) + (1 - y) * np.log(1 - p)), None
    mu = np.maximum(E * p, 1e-12)
    k = k_nb if k_nb else 1e6
    from scipy.special import gammaln
    nll = -(gammaln(y + k) - gammaln(k) - gammaln(y + 1) + k * np.log(k / (k + mu)) + y * np.log(mu / (k + mu)))
    dev = 2 * (np.where(y > 0, y * np.log(np.maximum(y, 1e-12) / mu), 0.0) - (y - mu))
    return nll, dev


# ====================================================================== stage: trackers
def tracker_grid(kind):
    G = [("static", {}), ("win5", {})]
    for h in (0.25, 0.5, 1.0, 2.0, 3.0, 5.0):
        G.append(("ew", {"h": h}))
    qs = (0.002, 0.01, 0.03, 0.1, 0.3) if kind == "bin" else (0.0005, 0.002, 0.01, 0.03, 0.1)
    for q in qs:
        for se in (0.0, 0.1):
            G.append(("kal", {"q": q, "se": se}))
    return G


DIV_GRID = [None, (3.0, 30.0), (3.0, 150.0), (10.0, 30.0), (10.0, 150.0)]   # (h_div years, k_div observations)
KDIV_GRID = [(0.15, 0.0), (0.3, 0.0), (0.3, 0.002)]                         # (sd_div, q_div per year)


def run_tracker(fam, cfg, d, kind, prior, k_nb, dcfg, brk=(), vb=0.0, phi=0.0, out_state=False):
    day, yr, y, E, div, ev = d["day"], d["year"], d["y"], d["E"], d["div"], d["event"]
    if fam == "static":
        return ew_track(day, y, E, div, kind, None, 5.0, prior, *(dcfg or (None, None)))
    if fam == "win5":
        return win5_track(day, yr, y, E, div, kind, 5.0, prior, None if dcfg is None else dcfg[1])
    if fam == "ew":
        return ew_track(day, y, E, div, kind, cfg["h"], 5.0, prior, *(dcfg or (None, None)), breaks=brk, phi=phi)
    if fam == "kal":
        m0 = float(logit(prior)) if kind == "bin" else math.log(prior)
        sd_div, q_div = dcfg if dcfg else (1e-6, 0.0)
        return kalman_track(day, ev, y, E, div, kind, cfg["q"], cfg["se"], sd_div, q_div, m0, 1.0, k_nb=k_nb,
                            breaks=brk, vb=vb, out_state=out_state)
    raise ValueError(fam)


def cfg_name(fam, cfg, dcfg, extra=""):
    s = fam
    if cfg:
        s += "(" + ",".join("%s=%g" % (k, v) for k, v in sorted(cfg.items())) + ")"
    if dcfg:
        s += "+div(%g,%g)" % dcfg
    return s + extra


def target_data(L, T, key):
    t = T[key]
    m = t["mask"] & (L["date"] < VAULT).to_numpy()
    return {"day": L["day"].to_numpy()[m], "year": L["year"].to_numpy()[m], "y": t["y"][m], "E": t["E"][m],
            "div": L["div"].to_numpy()[m].astype(int), "event": L["event"].to_numpy()[m],
            "fid": L["fid"].to_numpy()[m], "sched": L["sched"].to_numpy()[m], "kind": t["kind"]}


def stage_trackers(args):
    """Rolling-origin CV of every tracker on 2012-2023 (one-step-ahead: each card predicted from earlier days).
    Selection per target: (i) pooled 2012-2023 loss; (ii) nested: year Y+1 scored with the config that was best on
    2012..Y (first nested year 2014). 2024-2025 predictions are computed (they are the deployment levels) but are
    NOT scored here."""
    L = load("league.pkl")
    T = target_frames(L)
    out = {"targets": {}, "years": list(CV_YEARS)}
    preds = {}
    for key, t in T.items():
        d = target_data(L, T, key)
        kind = d["kind"]
        pre = d["year"] < CV_YEARS[0]
        prior = float(d["y"][pre].sum() / d["E"][pre].sum())
        k_nb = None
        if kind == "cnt":
            mu = d["E"][pre] * prior
            k_nb = nb_shape(d["y"][pre], mu)
        cv = (d["year"] >= CV_YEARS[0]) & (d["year"] <= CV_YEARS[-1])
        res = {}
        P = {}
        grid = tracker_grid(kind)
        for fam, cfg in grid:
            dgrid = KDIV_GRID if fam == "kal" else DIV_GRID
            if fam == "kal":
                dgrid = [None] + KDIV_GRID
            for dcfg in dgrid:
                nm = cfg_name(fam, cfg, dcfg)
                p = run_tracker(fam, cfg, d, kind, prior, k_nb, dcfg)
                nll, dev = score_obs(kind, d["y"], d["E"], p, k_nb)
                P[nm] = p
                by = {int(Y): float(nll[cv & (d["year"] == Y)].mean()) for Y in CV_YEARS}
                res[nm] = {"fam": fam, "cfg": cfg, "dcfg": dcfg, "cv": float(nll[cv].mean()), "by_year": by,
                           "dev": None if dev is None else float(dev[cv].mean()), "n": int(cv.sum())}
        # breaks on top of the best EW and Kalman configs (variance intervention / partial reset)
        brk = [BREAK_DAYS[b["key"]] for b in BREAKS if key in b["targets"] and b["effective"] < "2024-01-01"]
        brk_all = [BREAK_DAYS[b["key"]] for b in BREAKS if key in b["targets"]]
        for fam in ("ew", "kal"):
            cand = [k for k in res if res[k]["fam"] == fam]
            best = min(cand, key=lambda k: res[k]["cv"])
            b0 = res[best]
            for v in ((0.5, 0.8) if fam == "ew" else (0.05, 0.2, 0.5)):
                nm = best + ("+brk(phi=%g)" % v if fam == "ew" else "+brk(vb=%g)" % v)
                p = run_tracker(fam, b0["cfg"], d, kind, prior, k_nb, b0["dcfg"], brk=brk_all,
                                vb=v if fam == "kal" else 0.0, phi=v if fam == "ew" else 0.0)
                nll, dev = score_obs(kind, d["y"], d["E"], p, k_nb)
                P[nm] = p
                by = {int(Y): float(nll[cv & (d["year"] == Y)].mean()) for Y in CV_YEARS}
                res[nm] = {"fam": fam, "cfg": b0["cfg"], "dcfg": b0["dcfg"], "brk": v, "n_brk_cv": len(brk),
                           "cv": float(nll[cv].mean()), "by_year": by,
                           "dev": None if dev is None else float(dev[cv].mean()), "n": int(cv.sum())}
        # nested rolling-origin: choose on 2012..Y, score Y+1
        names = list(res)
        nested = {}
        for Y1 in CV_YEARS[2:]:
            tr_years = [Y for Y in CV_YEARS if Y < Y1]
            def tot(nm):
                return sum(res[nm]["by_year"][Y] * (cv & (d["year"] == Y)).sum() for Y in tr_years)
            pick = min(names, key=tot)
            nested[int(Y1)] = {"pick": pick, "loss": res[pick]["by_year"][Y1], "n": int((cv & (d["year"] == Y1)).sum())}
        ny = [Y for Y in nested]
        w = np.array([nested[Y]["n"] for Y in ny], float)
        nest_loss = float(np.dot(w, [nested[Y]["loss"] for Y in ny]) / w.sum())
        best = min(names, key=lambda k: res[k]["cv"])
        # references with the same division layer: the best static+div and win5+div (methodround's 5-year calendar
        # window by division) on the pooled CV (optimistic for the references)
        refs = {}
        for fam in ("static", "win5"):
            refs[fam] = min([k for k in names if res[k]["fam"] == fam], key=lambda k: res[k]["cv"])
        fam_best = {}
        for k in names:
            f_ = res[k]["fam"] + ("+brk" if "brk" in res[k] else "")
            if f_ not in fam_best or res[k]["cv"] < res[fam_best[f_]]["cv"]:
                fam_best[f_] = k
        # paired event-cluster bootstrap of the chosen tracker vs the references (pooled 2012-2023)
        ci = {}
        nll_b, _ = score_obs(kind, d["y"], d["E"], P[best], k_nb)
        for ref in ("static", "win5"):
            nll_r, _ = score_obs(kind, d["y"], d["E"], P[refs[ref]], k_nb)
            ci[ref] = boot_diff(nll_b[cv] - nll_r[cv], d["event"][cv])
        # nested picks vs win5, per observation
        nl_n = np.full(len(d["y"]), np.nan)
        for Y1, rr in nested.items():
            m = cv & (d["year"] == Y1)
            nl_n[m], _ = score_obs(kind, d["y"][m], d["E"][m], P[rr["pick"]][m], k_nb)
        mN = np.isfinite(nl_n)
        nll_w, _ = score_obs(kind, d["y"], d["E"], P[refs["win5"]], k_nb)
        nll_s, _ = score_obs(kind, d["y"], d["E"], P[refs["static"]], k_nb)
        ci["nested_vs_win5"] = boot_diff(nl_n[mN] - nll_w[mN], d["event"][mN])
        ci["nested_vs_static"] = boot_diff(nl_n[mN] - nll_s[mN], d["event"][mN])
        nest_static, nest_win5 = float(nll_s[mN].mean()), float(nll_w[mN].mean())
        # year-level base-rate error: league prediction at the first card of each year vs the realised year level
        yerr = year_level_error(d, P, [best, refs["static"], refs["win5"]], prior)
        out["targets"][key] = {"label": t["label"], "kind": kind, "unit": t.get("unit", 1.0), "prior": prior,
                               "k_nb": k_nb, "n_cv": int(cv.sum()), "best": best, "refs": refs, "fam_best": fam_best,
                               "res": res, "nested": nested, "nested_loss": nest_loss, "nested_static": nest_static,
                               "nested_win5": nest_win5, "ci": ci, "year_err": yerr}
        preds[key] = {"fid": d["fid"], "day": d["day"], "best": P[best], "win5": P[refs["win5"]]}
        log("trackers: %-9s best %-36s cv %.5f | static %.5f win5 %.5f (%s) | nested %.5f vs win5 %+.5f [%+.5f, %+.5f]" % (
            key, best, res[best]["cv"], res[refs["static"]]["cv"], res[refs["win5"]]["cv"], refs["win5"], nest_loss,
            ci["nested_vs_win5"][0], ci["nested_vs_win5"][1], ci["nested_vs_win5"][2]))
    jdump(out, "trackers.json")
    save(preds, "tracker_preds.pkl")


STAGES["trackers"] = stage_trackers


def boot_diff(diff, clusters, B_=2000, seed=11):
    """Mean of per-observation differences with a 95% cluster (card) bootstrap CI."""
    diff = np.asarray(diff, float)
    cl = pd.factorize(np.asarray(clusters))[0]
    nc = cl.max() + 1
    s = np.bincount(cl, weights=diff, minlength=nc)
    n = np.bincount(cl, minlength=nc).astype(float)
    rng = np.random.default_rng(seed)
    bs = np.empty(B_)
    for b in range(B_):
        w = np.bincount(rng.integers(0, nc, nc), minlength=nc)
        bs[b] = (w * s).sum() / max((w * n).sum(), 1)
    return [float(diff.mean()), float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5))]


def year_level_error(d, P, names, prior):
    """|log(predicted league level at the first card of Y) - log(realised level in Y)| per CV year (league pooled:
    the mean of the year's per-observation predictions vs the realised mean)."""
    out = {}
    for nm in names:
        e = {}
        for Y in CV_YEARS:
            m = d["year"] == Y
            if not m.any():
                continue
            act = d["y"][m].sum() / d["E"][m].sum()
            prd = (P[nm][m] * d["E"][m]).sum() / d["E"][m].sum()
            e[int(Y)] = [float(prd), float(act)]
        out[nm] = e
    return out


# ====================================================================== stage: base (the production method model, annual folds)
BASE_FOLDS = tuple(range(2014, 2025))        # 2014-2015 warm the residual trackers; 2016-2023 CV; 2024 = 2024-25 static
M_CV = tuple(range(2016, 2024))
M_TUNE = (2016, 2017, 2018, 2019, 2020)
GATE_YEARS = (2021, 2022, 2023)


def fold_masks(T, v):
    yr = T["year"].to_numpy()
    return yr < v, ((yr == v) if v < 2024 else (yr >= 2024))


def stage_base(args):
    """methodround's walk-forward table (2026 dropped at parse) + ML v2's S2 columns; per annual fold the competing-risks
    hazard (round shapes), the S2 six-class logit (C = method.json chosen_C6_S2, recency half-life 8 y, trained 2012+)
    and S2 + ML v2 winner, exactly as tools/ml2.py's method stage and tools/finishing.py base build them, with the folds
    extended back to 2014. Reproduction check: CV 2020-2023 joint equals ml2's method.json to 2e-4."""
    import methodround as MR
    t0 = time.time()
    D = MR.prepare(False)
    T, FX, FY, y = D["T"], D["FX"], D["FY"], D["y"]
    assert T["date"].max() < VAULT, "vault row in the methodround table"
    S = M2.load_table()
    T2 = S["df"]
    assert T2["date"].max() < VAULT
    F = pickle.load(open(os.path.join(M2.CACHE, "fit.pkl"), "rb"))
    C = json.load(open(os.path.join(M2.CACHE, "cv.json")))
    chosen = json.load(open(os.path.join(DERIVED, "methodround.json")))["meta"]["chosen"]
    m2 = json.load(open(os.path.join(M2.CACHE, "method.json")))
    nX, nY, pwin, okz = M2.method_new_cols(T, T2, F, C["lr"]["tau"], C["pre_means"])
    FX2 = pd.concat([FX, nX], axis=1)
    FY2 = pd.concat([FY, nY], axis=1)
    cols_s2 = D["stat_cols"] + list(nX.columns)
    C6 = m2["chosen_C6_S2"]
    H = np.full((len(T), MR.NC_), np.nan)
    P6 = np.full((len(T), 6), np.nan)
    vint = np.full(len(T), -1)
    for v in BASE_FOLDS:
        tr, va = fold_masks(T, v)
        hm = tr & (T["year"] >= MR.HAZ_START).to_numpy()
        hz = MR.HazardModel(MR.HAZ_COLS, C=chosen["C_haz"], C_dec=MR.C_DEC).fit(T[hm], FX[hm], FY[hm], y[hm])
        H[va] = hz.predict(T[va], FX[va], FY[va])
        m6 = tr & (T["year"] >= 2012).to_numpy()
        m = MR.C6Logit(cols_s2, C=C6, hl_years=MR.HL_YEARS).fit(T[m6], FX2[m6], FY2[m6], y[m6])
        P6[va] = m.predict6(T[va], FX2[va], FY2[va])
        vint[va] = v
        log("base: fold %d (%d six-class train rows, %d predicted)" % (v, m6.sum(), va.sum()))
    P6w = MR.reweight_winner(np.nan_to_num(P6, nan=1 / 6), pwin)
    keep = ["id", "date", "year", "event", "division", "prior_div", "rounds", "title", "winner", "method", "cls", "rnd",
            "A_slug", "B_slug"]
    base = {"T": T[keep].copy(), "y": y, "H": H, "P6_S2": P6, "P6w": P6w, "pwin": pwin, "okz": okz, "vint": vint,
            "draw_c": chosen["draw_c"]}
    vm = T["year"].isin([2020, 2021, 2022, 2023]).to_numpy()
    J = MR.joint_from_c6(P6w[vm], H[vm], chosen["draw_c"])
    s = MR.summarize_losses(MR.per_fight_losses(J, y[vm], T[vm]))
    ref = m2["cv"]["S2+ml2win"]
    log("base: S2+ml2win CV 2020-23 joint %.5f (ml2 %.5f) bin7 %.5f (ml2 %.5f)" % (s["joint"], ref["joint"], s["bin7"],
                                                                                 ref["bin7"]))
    assert abs(s["joint"] - ref["joint"]) < 2e-4, "S2 reproduction failed"
    save(base, "base.pkl")
    log("base: %d rows %s..%s in %.0f s" % (len(T), T["date"].min(), T["date"].max(), time.time() - t0))


STAGES["base"] = stage_base


# ====================================================================== method-model adjustment
R5 = 5
I_XKO, I_XSUB, I_YKO, I_YSUB = 0, R5, 2 * R5, 3 * R5
I_XDEC, I_YDEC, I_DRAW = 4 * R5, 4 * R5 + 1, 4 * R5 + 2
NC_ = 4 * R5 + 3
M_METRICS = ["bin7", "method3", "finish", "joint", "round_given_fin", "ko_vs_sub", "method_given_winner", "winner"]


def adjust_joint(P6w, H, draw_c, a_fin, a_ko, a_r1):
    """Level-adjusted joint cells (n x 23, methodround order) from the six-class S2+ml2win and hazard round shapes.
    a_fin: logit offset on P(finish | winner) (same for both winners); a_ko: logit offset on P(KO | finish, winner);
    a_r1: logit offset on P(round 1 | finish by a method, winner) (shapes renormalised over rounds 2..R).
    P(A wins) is untouched. Arrays of length n (or scalars)."""
    n = len(P6w)
    a_fin, a_ko, a_r1 = (np.broadcast_to(np.asarray(v, float), (n,)) for v in (a_fin, a_ko, a_r1))
    out = np.zeros((n, NC_))
    pa = P6w[:, :3].sum(1)
    sides = ((pa, P6w[:, 0], P6w[:, 1], P6w[:, 2], I_XKO, I_XSUB, I_XDEC),
             (1 - pa, P6w[:, 5], P6w[:, 4], P6w[:, 3], I_YKO, I_YSUB, I_YDEC))
    for pw, ko, sb, de, iko, isb, ide in sides:
        tot = np.maximum(ko + sb + de, 1e-12)
        f = np.clip((ko + sb) / tot, 1e-6, 1 - 1e-6)
        k = np.clip(ko / np.maximum(ko + sb, 1e-12), 1e-6, 1 - 1e-6)
        f2 = sig(logit(f) + a_fin)
        k2 = sig(logit(k) + a_ko)
        pko, psb, pde = pw * f2 * k2, pw * f2 * (1 - k2), pw * (1 - f2)
        for mass, base in ((pko, iko), (psb, isb)):
            sh = H[:, base:base + R5]
            sh = sh / np.maximum(sh.sum(1, keepdims=True), 1e-12)
            s1 = np.clip(sh[:, 0], 1e-6, 1 - 1e-6)
            s1n = sig(logit(s1) + a_r1)
            rest = sh[:, 1:] * ((1 - s1n) / np.maximum(1 - s1, 1e-12))[:, None]
            out[:, base] = mass * s1n
            out[:, base + 1:base + R5] = mass[:, None] * rest
        out[:, ide] = pde * (1 - draw_c)
        out[:, I_DRAW] += pde * draw_c
    return out


def split_inputs(P6w, H, R):
    """Per-fight mixture components for the three tracked splits: p_i(a) = sum_j W_ij sigmoid(Z_ij + a).
    fin: finish vs decision (draws count as decision); ko: KO vs SUB given a finish; r1: round 1 given a finish."""
    pa = P6w[:, :3].sum(1)
    out = {}
    fA = (P6w[:, 0] + P6w[:, 1]) / np.maximum(P6w[:, :3].sum(1), 1e-12)
    fB = (P6w[:, 5] + P6w[:, 4]) / np.maximum(P6w[:, 3:].sum(1), 1e-12)
    out["fin"] = (np.stack([pa, 1 - pa], 1), logit(np.stack([fA, fB], 1)))
    kA = P6w[:, 0] / np.maximum(P6w[:, 0] + P6w[:, 1], 1e-12)
    kB = P6w[:, 5] / np.maximum(P6w[:, 5] + P6w[:, 4], 1e-12)
    wA, wB = P6w[:, 0] + P6w[:, 1], P6w[:, 5] + P6w[:, 4]
    s = np.maximum(wA + wB, 1e-12)
    out["ko"] = (np.stack([wA / s, wB / s], 1), logit(np.stack([kA, kB], 1)))
    cells = []
    Wr = []
    for j, base in ((0, I_XKO), (1, I_XSUB), (5, I_YKO), (4, I_YSUB)):
        sh = H[:, base:base + R5]
        sh = sh / np.maximum(sh.sum(1, keepdims=True), 1e-12)
        cells.append(sh[:, 0])
        Wr.append(P6w[:, j])
    Wr = np.stack(Wr, 1)
    Wr = Wr / np.maximum(Wr.sum(1, keepdims=True), 1e-12)
    out["r1"] = (Wr, logit(np.stack(cells, 1)))
    return out


def split_targets(y):
    fin_obs = (y >= 0) & (y != I_DRAW) & (y != I_XDEC) & (y != I_YDEC)
    ok = y >= 0
    is_ko = ((y >= I_XKO) & (y < I_XKO + R5)) | ((y >= I_YKO) & (y < I_YKO + R5))
    rr = np.where(fin_obs, y % R5, -1)
    return {"fin": (ok, fin_obs.astype(float)), "ko": (fin_obs, is_ko.astype(float)),
            "r1": (fin_obs, (rr == 0).astype(float))}


def mix_p(W, Z, a):
    s = sig(Z + a)
    p = (W * s).sum(1)
    dp = (W * s * (1 - s)).sum(1)
    return np.clip(p, 1e-9, 1 - 1e-9), dp


def solve_offset(W, Z, yv, wt, prec, mean0=0.0, a0=0.0, it=8):
    """argmax_a sum wt * Bernoulli loglik(y | p(a)) - prec/2 (a - mean0)^2 (Fisher-scoring Newton)."""
    a = a0
    if len(yv) == 0 or wt.sum() <= 0:
        return mean0
    for _ in range(it):
        p, dp = mix_p(W, Z, a)
        g = (wt * (yv - p) * dp / (p * (1 - p))).sum() - prec * (a - mean0)
        h = (wt * dp * dp / (p * (1 - p))).sum() + prec
        step = g / h
        a += float(np.clip(step, -1, 1))
        if abs(step) < 1e-7:
            break
    return a


def info_at(W, Z, yv, a):
    p, dp = mix_p(W, Z, a)
    return (yv - p) * dp / (p * (1 - p)), dp * dp / (p * (1 - p))


def track_split(day, vint, event, W, Z, yv, obs, cfg, scope=None, brk=(), query=None):
    """Walk-forward offsets for one split. Returns, for every row, the offset used to predict it (from rows on
    strictly earlier days whose split outcome is observed). cfg: {"fam": "ew", "h", "n0", "rho"} or
    {"fam": "kal", "q", "se", "rho", "vb"} or {"fam": "none"}. Vintage: rows predicted by an older model vintage than
    the row being predicted get weight rho^(age) (EW); the Kalman state is multiplied by rho at each refit.
    scope: optional integer group per row (format or division); its offset = league offset + a deviation shrunk to 0
    with precision cfg["n0s"] * 0.2 (EW family only). query: rows that only read the state (snapshots); a day with
    query rows only changes nothing."""
    n = len(day)
    off = np.zeros(n)
    if cfg["fam"] == "none":
        return off
    if query is None:
        query = np.zeros(n, bool)
    u = np.unique(day)
    fam = cfg["fam"]
    rho = cfg.get("rho", 1.0)
    if fam == "ew":
        lam = math.log(2) / (cfg["h"] * YEAR_D)
        prec = cfg["n0"] * 0.2
        a_prev = 0.0
        hist = np.zeros(n, bool)
        prev_a_s = {}
        for d in u:
            rows = np.where(day == d)[0]
            hi = np.where(hist)[0]
            realr = rows[~query[rows]]
            if len(hi):
                wt = np.exp(-lam * (d - day[hi]))
                vnow = vint[rows].max()
                age = np.maximum(vnow - vint[hi], 0)
                wt = wt * np.power(rho, age) if rho < 1 else wt
                keep = wt > 1e-4
                hi, wt = hi[keep], wt[keep]
                a = solve_offset(W[hi], Z[hi], yv[hi], wt, prec, 0.0, a_prev)
                if len(realr):
                    a_prev = a
                off[rows] = a
                if scope is not None:
                    prec_s = cfg["n0s"] * 0.2
                    rg = set(int(x) for x in scope[realr])
                    for g in np.unique(scope[rows]):
                        m = scope[hi] == g
                        key = int(g)
                        a_s = solve_offset(W[hi][m], Z[hi][m], yv[hi][m], wt[m], prec_s, a, prev_a_s.get(key, a))
                        if key in rg:
                            prev_a_s[key] = a_s
                        off[rows[scope[rows] == g]] = a_s
            hist[rows[obs[rows]]] = True
        return off
    if fam == "kal":
        q, se, vb = cfg["q"], cfg["se"], cfg.get("vb", 0.0)
        P0 = cfg.get("P0", 0.05)
        a, P = 0.0, P0
        last = None
        v_cur = None
        bdays = sorted(brk)
        bi = 0
        for d in u:
            rows = np.where(day == d)[0]
            if query[rows].all():
                vq = vint[rows].max()
                off[rows] = rho * a if (v_cur is not None and vq > v_cur) else a
                continue
            if last is not None:
                P += q * (d - last) / YEAR_D
            while bi < len(bdays) and bdays[bi] <= d:
                P += vb
                bi += 1
            vnow = vint[rows].max()
            if v_cur is not None and vnow > v_cur:
                a = rho * a
                P = rho * rho * P + (1 - rho * rho) * P0
            v_cur = vnow if v_cur is None else max(v_cur, vnow)
            off[rows] = a
            ro = rows[obs[rows]]
            for ev in np.unique(event[ro]):
                ii = ro[event[ro] == ev]
                g, h = info_at(W[ii], Z[ii], yv[ii], a)
                G, Hh = g.sum(), h.sum()
                if Hh <= 0:
                    continue
                Rv = 1.0 / Hh + se * se
                K = P / (P + Rv)
                a = a + K * (G / Hh)
                P = (1 - K) * P
            last = d
        return off
    raise ValueError(fam)


def method_grid():
    G = [{"fam": "none"}]
    for h in (0.25, 0.5, 1.0, 2.0, 4.0):
        for n0 in (50, 200, 800):
            for rho in (0.0, 0.5, 1.0):
                G.append({"fam": "ew", "h": h, "n0": n0, "rho": rho})
    for q in (0.005, 0.02, 0.08):
        for se in (0.0, 0.1):
            for rho in (0.0, 0.5, 1.0):
                G.append({"fam": "kal", "q": q, "se": se, "rho": rho})
    return G


def mcfg_name(c):
    if c["fam"] == "none":
        return "none"
    keys = [k for k in ("h", "n0", "q", "se", "rho", "vb", "n0s", "scope") if k in c]
    return c["fam"] + "(" + ",".join("%s=%s" % (k, c[k]) for k in keys) + ")"


SPLIT_METRIC = {"fin": "finish", "ko": "ko_vs_sub", "r1": "round_given_fin"}
SPLIT_BREAK_TARGET = {"fin": "dec", "ko": "ko", "r1": "r1_fin3"}


def method_setup():
    import methodround as MR
    b = load("base.pkl")
    T, y, H, P6w = b["T"], b["y"], b["H"], b["P6w"]
    m = (b["vint"] >= BASE_FOLDS[0]) & (T["date"] < VAULT).to_numpy()
    idx = np.where(m)[0]
    T = T.iloc[idx].reset_index(drop=True)
    o = np.argsort(T["date"].map(dt.date.toordinal).to_numpy(), kind="stable")
    T = T.iloc[o].reset_index(drop=True)
    idx = idx[o]
    S = {"T": T, "y": y[idx], "H": H[idx], "P6w": P6w[idx], "vint": b["vint"][idx], "draw_c": b["draw_c"],
         "pwin": b["pwin"][idx], "MR": MR}
    S["day"] = T["date"].map(dt.date.toordinal).to_numpy()
    S["year"] = T["year"].to_numpy()
    S["event"] = T["event"].to_numpy()
    S["r5"] = (T["rounds"].to_numpy() == 5).astype(int)
    S["div"] = np.array([DIV_IX.get(d, DIV_ALL) for d in T["division"]])
    S["split_in"] = split_inputs(S["P6w"], S["H"], None)
    S["split_y"] = split_targets(S["y"])
    return S


def losses_for(S, offs, rows=None):
    MR = S["MR"]
    J = adjust_joint(S["P6w"], S["H"], S["draw_c"], offs["fin"], offs["ko"], offs["r1"])
    L = MR.per_fight_losses(J, S["y"], S["T"])
    if rows is not None:
        L = {k: v[rows] for k, v in L.items()}
    return L, J


def run_split(S, split, cfg, scope_kind=None):
    W, Z = S["split_in"][split]
    obs, yv = S["split_y"][split]
    brk = ()
    if cfg.get("vb"):
        tk = SPLIT_BREAK_TARGET[split]
        brk = [BREAK_DAYS[b["key"]] for b in BREAKS if tk in b["targets"] or (split == "r1" and "r1_fin5" in b["targets"])]
    if split == "r1":
        # round shape drifts by format: separate trackers for 3- and 5-round bouts
        off = np.zeros(len(yv))
        for f in (0, 1):
            m = S["r5"] == f
            off[m] = track_split(S["day"][m], S["vint"][m], S["event"][m], W[m], Z[m], yv[m], obs[m], cfg, brk=brk)
        return off
    scope = None
    if scope_kind == "format":
        scope = S["r5"]
    elif scope_kind == "division":
        scope = S["div"]
    return track_split(S["day"], S["vint"], S["event"], W, Z, yv, obs, cfg, scope=scope, brk=brk)


def stage_method(args):
    """Rolling-origin CV (annual folds 2016-2023, each fold's S2+ml2win fit on earlier years) of every offset tracker
    per split, then the nested forward-chained gate on 2021-2023 (config per split chosen on 2016..Y-1, 'none'
    unless it gains > 0.0005 on the split's own metric), primary 7-bin (fin+ko) and joint (r1). 2024-25 rows are
    never scored here."""
    S = method_setup()
    MR = S["MR"]
    yr = S["year"]
    cvm = (yr >= M_CV[0]) & (yr <= M_CV[-1])
    zero = np.zeros(len(yr))
    L0, J0 = losses_for(S, {"fin": zero, "ko": zero, "r1": zero})
    # corner symmetry of the adjustment
    rng = np.random.default_rng(5)
    t_off = {k: rng.normal(0, 0.3, len(yr)) for k in ("fin", "ko", "r1")}
    Ja = adjust_joint(S["P6w"], S["H"], S["draw_c"], t_off["fin"], t_off["ko"], t_off["r1"])
    Jb = adjust_joint(S["P6w"][:, ::-1], MR.mirror_cells(S["H"]), S["draw_c"], t_off["fin"], t_off["ko"], t_off["r1"])
    sym = float(np.abs(MR.mirror_cells(Jb) - Ja).max())
    assert sym < 1e-12, sym
    dc = S["draw_c"]
    paA = Ja[:, I_XKO:I_XSUB + R5].sum(1) + Ja[:, I_XDEC] / (1 - dc)
    assert np.abs(paA - S["P6w"][:, :3].sum(1)).max() < 1e-9, "P(A wins) moved"
    log("method: corner-swap check max |mirror(adjust(swap)) - adjust| = %.1e; six-class P(A wins) unchanged" % sym)
    grid = method_grid()
    variants = []
    for split in ("fin", "ko", "r1"):
        for c in grid:
            variants.append((split, c, None))
        # scopes and breaks on top of a few base configs (filled after the plain grid is scored)
    res = {}
    offs = {}
    for split, c, sk in variants:
        nm = split + ":" + mcfg_name(c) + ("" if sk is None else "+" + sk)
        o = run_split(S, split, c, sk)
        offs[nm] = o
        res[nm] = split_scores(S, split, o, L0)
    # scopes (fin: format / division; ko: division) and breaks on the best plain EW / Kalman per split
    extra = []
    for split in ("fin", "ko", "r1"):
        for fam in ("ew", "kal"):
            cand = [k for k in res if k.startswith(split + ":" + fam)]
            best = min(cand, key=lambda k: res[k]["cv"])
            c = dict(next(cc for (sp, cc, sk) in variants if sp == split and split + ":" + mcfg_name(cc) == best))
            if fam == "kal":
                for vb in (0.02, 0.1):
                    extra.append((split, dict(c, vb=vb), None))
            elif split in ("fin", "ko"):
                for n0s in (200, 800):
                    extra.append((split, dict(c, n0s=n0s), "division"))
                if split == "fin":
                    for n0s in (200, 800):
                        extra.append((split, dict(c, n0s=n0s), "format"))
    for split, c, sk in extra:
        nm = split + ":" + mcfg_name(c) + ("" if sk is None else "+" + sk)
        o = run_split(S, split, c, sk)
        offs[nm] = o
        res[nm] = split_scores(S, split, o, L0)
    log("method: %d split variants scored" % len(res))
    for split in ("fin", "ko", "r1"):
        ks = sorted([k for k in res if k.startswith(split + ":")], key=lambda k: res[k]["cv"])
        log("method: %s best 5: %s" % (split, "; ".join("%s %.5f" % (k.split(":", 1)[1], res[k]["cv"]) for k in ks[:5])))
        log("method: %s none %.5f" % (split, res[split + ":none"]["cv"]))
    # nested forward-chained gate 2021-2023
    gate = {"years": {}, "picks": {}}
    nested_off = {k: np.zeros(len(yr)) for k in ("fin", "ko", "r1")}
    for Y in GATE_YEARS:
        trs = [y_ for y_ in M_CV if y_ < Y]
        picks = {}
        for split in ("fin", "ko", "r1"):
            ks = [k for k in res if k.startswith(split + ":")]
            def tot(k):
                return sum(res[k]["sum_by_year"][y_] for y_ in trs) / sum(res[k]["n_by_year"][y_] for y_ in trs)
            bestk = min(ks, key=tot)
            gain = tot(bestk) - tot(split + ":none")
            pick = bestk if gain < -SEL_MIN else split + ":none"
            picks[split] = {"pick": pick, "train_gain": gain}
            m = yr == Y
            nested_off[split][m] = offs[pick][m]
        gate["picks"][Y] = picks
        log("method: gate %d picks %s" % (Y, {k: (v["pick"].split(":", 1)[1], round(v["train_gain"], 5))
                                              for k, v in picks.items()}))
    gm = np.isin(yr, GATE_YEARS)
    Ln, Jn = losses_for(S, nested_off)
    gate["paired"] = paired(S, Ln, L0, gm)
    g7 = gate["paired"]["bin7"]["diff"]
    gj = gate["paired"]["joint"]["diff"]
    gate["pass_bin7"] = bool(g7 < -SEL_MIN)
    gate["pass_joint"] = bool(gj < -SEL_MIN)
    log("method: GATE 2021-23 nested vs static: bin7 %+.5f %s | joint %+.5f %s | method3 %+.5f | finish %+.5f" % (
        g7, gate["paired"]["bin7"]["ci95"], gj, gate["paired"]["joint"]["ci95"], gate["paired"]["method3"]["diff"],
        gate["paired"]["finish"]["diff"]))
    # final choice on 2016-2023 (what the 2024-25 confirmation would use)
    final = {}
    for split in ("fin", "ko", "r1"):
        ks = [k for k in res if k.startswith(split + ":")]
        bestk = min(ks, key=lambda k: res[k]["cv"])
        gain = res[bestk]["cv"] - res[split + ":none"]["cv"]
        final[split] = {"pick": bestk if gain < -SEL_MIN else split + ":none", "best": bestk, "cv_gain": gain}
    fo = {k: offs[final[k]["pick"]] for k in final}
    Lf, Jf = losses_for(S, fo)
    cvp = paired(S, Lf, L0, cvm)
    # decision-share calibration by year (mean predicted vs actual), static vs nested / final
    dcal = dec_calibration(S, {"static": J0, "nested": Jn, "final_cv": Jf}, years=M_CV)
    out = {"res": res, "gate": gate, "final": final, "cv_paired_final": cvp, "dec_cal": dec_calibration_rows(dcal),
           "sym_check": sym, "n_cv": int(cvm.sum()), "n_gate": int(gm.sum()),
           "static_cv": {k: float(np.nanmean(L0[k][cvm])) for k in M_METRICS},
           "static_gate": {k: float(np.nanmean(L0[k][gm])) for k in M_METRICS}}
    jdump(out, "method.json")
    save({"offs": {k: offs[k] for k in set([final[s]["pick"] for s in final] + [final[s]["best"] for s in final])},
          "nested_off": nested_off}, "method_offs.pkl")
    log("method: final (chosen on 2016-2023): %s" % {k: v["pick"].split(":", 1)[1] for k, v in final.items()})


def split_scores(S, split, o, L0):
    z = np.zeros(len(o))
    offs = {"fin": z, "ko": z, "r1": z}
    offs[split] = o
    L, _ = losses_for(S, offs)
    met = SPLIT_METRIC[split]
    yr = S["year"]
    v = L[met]
    sb, nb = {}, {}
    for Y in M_CV:
        m = (yr == Y) & np.isfinite(v)
        sb[Y] = float(v[m].sum())
        nb[Y] = int(m.sum())
    cvm = (yr >= M_CV[0]) & (yr <= M_CV[-1]) & np.isfinite(v)
    r = {"cv": float(v[cvm].mean()), "sum_by_year": sb, "n_by_year": nb}
    for k in ("bin7", "joint", "method3"):
        mm = (yr >= M_CV[0]) & (yr <= M_CV[-1])
        r[k] = float(np.nanmean(L[k][mm]))
    return r


def paired(S, LA, LB, mask, metrics=M_METRICS):
    MR = S["MR"]
    tabs = {"A": {k: np.asarray(LA[k], float)[mask] for k in metrics},
            "B": {k: np.asarray(LB[k], float)[mask] for k in metrics}}
    _, st = MR.cluster_bootstrap(tabs, S["event"][mask])
    return MR.paired_diff(tabs["A"], tabs["B"], st, metrics)


def dec_calibration(S, Js, years):
    yr = S["year"]
    y = S["y"]
    ok = y >= 0
    isdec = ((y == I_XDEC) | (y == I_YDEC) | (y == I_DRAW)).astype(float)
    isko = (((y >= I_XKO) & (y < I_XKO + R5)) | ((y >= I_YKO) & (y < I_YKO + R5))).astype(float)
    out = {}
    for Y in years:
        m = ok & ((yr == Y) if Y < 2024 else (yr >= 2024))
        row = {"n": int(m.sum()), "actual_dec": float(isdec[m].mean()), "actual_ko": float(isko[m].mean())}
        for k, J in Js.items():
            row["pred_dec_" + k] = float((J[m, I_XDEC] + J[m, I_YDEC] + J[m, I_DRAW]).mean())
            row["pred_ko_" + k] = float((J[m, I_XKO:I_XKO + R5].sum(1) + J[m, I_YKO:I_YKO + R5].sum(1)).mean())
        out[int(Y)] = row
    return out


def dec_calibration_rows(d):
    return d


STAGES["method"] = stage_method


# ====================================================================== statlines adjustment
ST_STATS = ["sig_att", "sig_lnd", "h_att", "h_lnd", "b_att", "b_lnd", "l_att", "l_lnd", "d_att", "d_lnd", "c_att",
            "c_lnd", "g_att", "g_lnd", "kd", "td_att", "td_lnd", "ctrl", "sub_att", "rev"]
ST_CV = (2021, 2022, 2023)
ST_KEY = ("sig_lnd", "sig_att", "kd", "td_att", "ctrl")     # the stat levels named in the brief (reported first)


def side_actuals():
    """Per fight id: the 20 statlines stats for side A (first-named) and B, from build_db's ufcstats vectors."""
    lg = {}
    fights, _ = B.parse_fights(lg)
    B.build_vectors(fights, lg)
    out = {}
    for f in fights:
        if not f.stats or f.date >= VAULT:
            continue
        sides = []
        for v in f.stats["v"]:
            g = lambda k: float(v[B.KI[k]])
            d = {"h_att": g("h_att"), "h_lnd": g("h_lnd"), "b_att": g("b_att"), "b_lnd": g("b_lnd"),
                 "l_att": g("l_att"), "l_lnd": g("l_lnd"), "d_att": g("d_att"), "d_lnd": g("d_lnd"),
                 "c_att": g("c_att"), "c_lnd": g("c_lnd"), "g_att": g("g_att"), "g_lnd": g("g_lnd"), "kd": g("kd"),
                 "td_att": g("td_att"), "td_lnd": g("td_lnd"), "ctrl": g("ctrl"), "sub_att": g("sub_att"),
                 "rev": g("rev")}
            d["sig_att"] = d["h_att"] + d["b_att"] + d["l_att"]
            d["sig_lnd"] = d["h_lnd"] + d["b_lnd"] + d["l_lnd"]
            sides.append(d)
        out[f.fid] = sides
    return out


def stat_setup():
    """Rows = fight-sides of statlines_oof.json (sets cv2020, cv, valid; raw2019 has no distributions), joined to the
    realised lines. Vintage = the fold that produced the row (2020, 2021, 2022, 2023; valid = 2024)."""
    so = json.load(open(os.path.join(DERIVED, "statlines_oof.json")))
    act = side_actuals()
    rows = []
    for fid, r in so["fights"].items():
        if r.get("set") not in ("cv2020", "cv", "valid") or r["date"] >= "2026-01-01" or fid not in act:
            continue
        d = dt.date.fromisoformat(r["date"])
        vint = {"cv2020": 2020, "valid": 2024}.get(r["set"], d.year)
        for si, side in enumerate(("A", "B")):
            if side not in r:
                continue
            rows.append((fid, d.toordinal(), d.year, vint, r["t"], r["R"], side, r[side], act[fid][si]))
    rows.sort(key=lambda x: x[1])
    n = len(rows)
    S = {"fid": np.array([x[0] for x in rows]), "day": np.array([x[1] for x in rows]),
         "year": np.array([x[2] for x in rows]), "vint": np.array([x[3] for x in rows]),
         "t": np.array([x[4] for x in rows], float), "side": np.array([x[6] for x in rows])}
    S["event"] = S["fid"]                                      # card ids are not in the OOF file: cluster by date
    S["card"] = S["day"]
    for st in ST_STATS:
        par = np.array([x[7][st] for x in rows], float)
        S[st] = {"par": par, "y": np.array([x[8][st] for x in rows], float), "kind": so["meta"]["kinds"][st]}
    assert S["day"].max() < VAULT.toordinal()
    return S


def st_loglik(kind, y, par, t, a):
    """Per-row log likelihood of the statlines distribution with its mean moved by offset a (log scale for NB counts,
    logit of the mean share for the zero-inflated Beta control model)."""
    from scipy.special import gammaln, betaln
    if kind == "nb":
        mu = par[:, 0] * np.exp(a)
        k = par[:, 1]
        return gammaln(y + k) - gammaln(k) - gammaln(y + 1) + k * np.log(k / (k + mu)) + y * np.log(mu / (k + mu))
    if kind == "zibeta":
        m = sig(logit(par[:, 0]) + a)
        phi, pi = par[:, 1], np.clip(par[:, 2], 1e-9, 1 - 1e-9)
        sh = np.clip(y / (60.0 * t), 1e-6, 1 - 1e-6)
        al, be = m * phi, (1 - m) * phi
        lb = (al - 1) * np.log(sh) + (be - 1) * np.log(1 - sh) - betaln(al, be) - np.log(60.0 * t)
        return np.where(y <= 0, np.log(pi), np.log(1 - pi) + lb)
    raise ValueError(kind)


def st_mean(kind, par, t, a):
    if kind == "nb":
        return par[:, 0] * np.exp(a)
    m = sig(logit(par[:, 0]) + a)
    return (1 - par[:, 2]) * m * 60.0 * t


def st_solve(kind, y, par, t, wt, prec, a0=0.0, it=6):
    """argmax_a sum wt * loglik(a) - prec/2 a^2 by Newton with numeric derivatives."""
    a = a0
    if len(y) == 0:
        return 0.0
    e = 1e-3
    for _ in range(it):
        f0 = (wt * st_loglik(kind, y, par, t, a)).sum() - 0.5 * prec * a * a
        fp = (wt * st_loglik(kind, y, par, t, a + e)).sum() - 0.5 * prec * (a + e) ** 2
        fm = (wt * st_loglik(kind, y, par, t, a - e)).sum() - 0.5 * prec * (a - e) ** 2
        g = (fp - fm) / (2 * e)
        h = (fp - 2 * f0 + fm) / (e * e)
        if h >= 0:
            break
        step = float(np.clip(-g / h, -0.5, 0.5))
        a += step
        if abs(step) < 1e-6:
            break
    return a


def st_info(kind, y, par, t, a):
    """Per-row score and observed information (numeric) at a."""
    e = 1e-3
    f0 = st_loglik(kind, y, par, t, a)
    fp = st_loglik(kind, y, par, t, a + e)
    fm = st_loglik(kind, y, par, t, a - e)
    return (fp - fm) / (2 * e), -(fp - 2 * f0 + fm) / (e * e)


def st_track(S, st, cfg, real=None):
    """Walk-forward offset for one stat (rows on strictly earlier days only). real: mask of observed rows (others
    are snapshot queries: they get the offset of their day and are never assimilated)."""
    D = S[st]
    kind, y, par = D["kind"], D["y"], D["par"]
    t, day, vint = S["t"], S["day"], S["vint"]
    n = len(y)
    if real is None:
        real = np.ones(n, bool)
    off = np.zeros(n)
    if cfg["fam"] == "none":
        return off
    u = np.unique(day)
    rho = cfg.get("rho", 1.0)
    # prior precision in fight-side equivalents: n0 x the median per-row information at a = 0 (pre-2021 rows)
    _, inf0 = st_info(kind, y, par, t, 0.0)
    unit = float(np.median(np.maximum(inf0[(S["year"] < 2021) & real], 1e-6)))
    if cfg["fam"] == "ew":
        lam = math.log(2) / (cfg["h"] * YEAR_D)
        prec = cfg["n0"] * unit
        a_prev = 0.0
        for d in u:
            rows = np.where(day == d)[0]
            hi = np.where((day < d) & real)[0]
            if len(hi):
                wt = np.exp(-lam * (d - day[hi]))
                vnow = vint[rows].max()
                if rho < 1:
                    wt = wt * np.power(rho, np.maximum(vnow - vint[hi], 0))
                keep = wt > 1e-4
                hi, wt = hi[keep], wt[keep]
                a_new = st_solve(kind, y[hi], par[hi], t[hi], wt, prec, a_prev) if len(hi) else 0.0
                if real[rows].any():
                    a_prev = a_new
                off[rows] = a_new
        return off
    if cfg["fam"] == "kal":
        q, se = cfg["q"], cfg["se"]
        P0 = cfg.get("P0", 0.01)
        a, P = 0.0, P0
        last, v_cur = None, None
        for d in u:
            rows = np.where(day == d)[0]
            if not real[rows].any():
                vq = vint[rows].max()
                off[rows] = rho * a if (v_cur is not None and vq > v_cur) else a
                continue
            if last is not None:
                P += q * (d - last) / YEAR_D
            vnow = vint[rows].max()
            if v_cur is not None and vnow > v_cur:
                a = rho * a
                P = rho * rho * P + (1 - rho * rho) * P0
            v_cur = vnow if v_cur is None else max(v_cur, vnow)
            off[rows] = a
            rows = rows[real[rows]]
            if not len(rows):
                last = d
                continue
            g, h = st_info(kind, y[rows], par[rows], t[rows], a)
            G, Hh = g.sum(), max(h.sum(), 1e-9)
            Rv = 1.0 / Hh + se * se
            K = P / (P + Rv)
            a = a + K * (G / Hh)
            P = (1 - K) * P
            last = d
        return off
    raise ValueError(cfg)


def stat_grid():
    G = [{"fam": "none"}]
    for h in (0.25, 0.5, 1.0, 2.0):
        for n0 in (50, 200, 800):
            for rho in (0.0, 0.5, 1.0):
                G.append({"fam": "ew", "h": h, "n0": n0, "rho": rho})
    for q in (0.002, 0.01, 0.04):
        for se in (0.0, 0.05):
            for rho in (0.0, 0.5, 1.0):
                G.append({"fam": "kal", "q": q, "se": se, "rho": rho})
    return G


def st_dev(kind, y, par, t, a):
    mu = np.maximum(st_mean(kind, par, t, a), 1e-9)
    return 2 * (np.where(y > 0, y * np.log(np.maximum(y, 1e-12) / mu), 0.0) - (y - mu))


def stage_stat(args):
    """Forward-chained CV 2021-2023 (statlines folds fit on 2019..Y-1; 2020 rows warm the trackers) of per-stat mean
    offsets. Rule (statlines' own): a stat is adjusted only if the best tracker lowers the pooled 2021-2023 log score
    by more than 0.001 nats per fight-side AND in at least 2 of the 3 years. Nested check: choose on 2021 -> score
    2022; choose on 2021-2022 -> score 2023. 2024-25 rows are never scored here."""
    S = stat_setup()
    yr = S["year"]
    cvm = np.isin(yr, ST_CV)
    grid = stat_grid()
    out = {"stats": {}, "n_rows_cv": int(cvm.sum()), "n_rows": int(len(yr))}
    offs = {}
    for st in ST_STATS:
        D = S[st]
        res = {}
        O = {}
        for c in grid:
            nm = mcfg_name(c)
            o = st_track(S, st, c)
            ll = st_loglik(D["kind"], D["y"], D["par"], S["t"], o)
            dv = st_dev(D["kind"], D["y"], D["par"], S["t"], o)
            O[nm] = o
            res[nm] = {"cv": float(-ll[cvm].mean()), "by_year": {int(Y): float(-ll[yr == Y].mean()) for Y in ST_CV},
                       "dev": float(dv[cvm].mean())}
        base = res["none"]
        best = min(res, key=lambda k: res[k]["cv"])
        gain = res[best]["cv"] - base["cv"]
        wins = sum(res[best]["by_year"][Y] < base["by_year"][Y] for Y in ST_CV)
        adopt = bool(gain < -0.001 and wins >= 2)
        ll0 = st_loglik(D["kind"], D["y"], D["par"], S["t"], 0.0)
        llb = st_loglik(D["kind"], D["y"], D["par"], S["t"], O[best])
        ci = boot_diff(-(llb - ll0)[cvm], S["card"][cvm])
        dv0 = st_dev(D["kind"], D["y"], D["par"], S["t"], 0.0)
        dvb = st_dev(D["kind"], D["y"], D["par"], S["t"], O[best])
        ci_dev = boot_diff((dvb - dv0)[cvm], S["card"][cvm])
        # nested: choose on earlier CV years only
        nested = {}
        nl = np.full(len(yr), np.nan)
        for Y in (2022, 2023):
            trs = [y_ for y_ in ST_CV if y_ < Y]
            def tot(k):
                return np.mean([res[k]["by_year"][y_] for y_ in trs])
            bk = min(res, key=tot)
            pick = bk if tot(bk) - tot("none") < -0.001 else "none"
            nested[Y] = pick
            m = yr == Y
            nl[m] = -st_loglik(D["kind"], D["y"][m], D["par"][m], S["t"][m], O[pick][m])
        mN = np.isfinite(nl)
        ci_n = boot_diff(nl[mN] - (-ll0[mN]), S["card"][mN])
        # mean level check: realised / predicted total by year, static vs adjusted
        lv = {}
        for Y in (2020,) + ST_CV:
            m = yr == Y
            lv[int(Y)] = [float(D["y"][m].sum() / st_mean(D["kind"], D["par"][m], S["t"][m], 0.0).sum()),
                          float(D["y"][m].sum() / st_mean(D["kind"], D["par"][m], S["t"][m], O[best][m]).sum())]
        out["stats"][st] = {"kind": D["kind"], "best": best, "gain": gain, "wins": wins, "adopt": adopt, "ci": ci,
                            "ci_dev": ci_dev, "dev_static": float(dv0[cvm].mean()), "nested": nested,
                            "nested_ci": ci_n, "level_ratio": lv, "res": res}
        offs[st] = O[best]
        log("stat: %-7s best %-30s gain %+.5f [%+.5f, %+.5f] wins %d adopt %s | dev %+.4f | nested %+.5f | act/pred %s" % (
            st, best, gain, ci[1], ci[2], wins, adopt, ci_dev[0], ci_n[0],
            " ".join("%d:%.3f" % (Y, v[0]) for Y, v in lv.items())))
    jdump(out, "stat.json")
    save(offs, "stat_offs.pkl")


STAGES["stat"] = stage_stat


# ====================================================================== stage: prereg / holdout
PREREG = "prereg.json"
LOCK = "holdout.lock"
M_DESC = {   # method candidates scored descriptively on 2024-25 (fixed here, before the look)
    "M1_cv_final": "the CV-final configuration (chosen on 2016-2023; fin / ko 'none' by the 0.0005 rule, r1 Kalman)",
    "M2_fast_dec": "decision-vs-finish EW tracker that the nested gate picked in 2022 and 2023 "
                   "(fin: ew h=0.25 y, n0=200, rho=0, + division n0s=200), alone",
    "M3_both": "M1 + M2",
}


def tracker_pred(L, T, key, entry, prior, k_nb, out_state=False):
    d = target_data(L, T, key)
    brk_all = [BREAK_DAYS[b["key"]] for b in BREAKS if key in b["targets"]]
    fam = entry["fam"]
    dcfg = tuple(entry["dcfg"]) if entry.get("dcfg") else None
    v = entry.get("brk")
    if v is None:
        return d, run_tracker(fam, entry["cfg"], d, d["kind"], prior, k_nb, dcfg, out_state=out_state)
    return d, run_tracker(fam, entry["cfg"], d, d["kind"], prior, k_nb, dcfg, brk=brk_all,
                          vb=v if fam == "kal" else 0.0, phi=v if fam == "ew" else 0.0, out_state=out_state)


def parse_mcfg(nm):
    """'fin:ew(h=0.25,n0=200,rho=0.0,n0s=200)+division' -> (split, cfg, scope)."""
    split, rest = nm.split(":", 1)
    scope = None
    if rest.endswith("+division") or rest.endswith("+format"):
        rest, scope = rest.rsplit("+", 1)
    if rest == "none":
        return split, {"fam": "none"}, None
    fam, args = rest.split("(", 1)
    cfg = {"fam": fam}
    for kv in args.rstrip(")").split(","):
        k, v = kv.split("=")
        cfg[k] = float(v)
    return split, cfg, scope


def stage_prereg(args):
    """Freeze every choice made by CV before the single 2024-25 look (commit this file before running holdout)."""
    tr = jload_c("trackers.json")
    me = jload_c("method.json")
    stt = jload_c("stat.json")
    pre = {"written": dt.datetime.utcnow().isoformat() + "Z",
           "window": ["2024-01-01", "2025-12-31"],
           "league": {k: {"chosen": v["best"], "ref_win5": v["refs"]["win5"], "ref_static": v["refs"]["static"],
                          "brk_variant": v["fam_best"].get("kal+brk") if "kal" in v["best"] else v["fam_best"].get("ew+brk")}
                      for k, v in tr["targets"].items()},
           "league_primary": "per target: mean per-observation loss (Bernoulli NLL for shares, NB NLL for rates) of "
                             "the chosen tracker minus the win5+div reference on 2024-25, card-cluster bootstrap CI; "
                             "expected: stat-level targets (slpm, sapm, tdpm, ctrlpm, subpm, kd100, r108) < 0, outcome-"
                             "mix targets ~0. A target whose CI excludes 0 on the wrong side is 'contradicted' and its "
                             "deployment falls back to the win5+div reference.",
           "league_secondary": "base-rate table for 2024 and 2025 (mean one-step-ahead prediction vs realised); "
                               "the +brk variants (glove / ABC 2024-25 breaks as variance interventions) vs the chosen "
                               "config, descriptive only",
           "method": {"gate": {"bin7": me["gate"]["paired"]["bin7"], "joint": me["gate"]["paired"]["joint"],
                               "pass_bin7": me["gate"]["pass_bin7"], "pass_joint": me["gate"]["pass_joint"]},
                      "production": "unchanged (static S2 + ML v2 winner): the nested forward-chained gate 2021-2023 "
                                    "failed on both 7-bin and joint",
                      "final": {k: v["pick"] for k, v in me["final"].items()},
                      "descriptive": {"M1_cv_final": {k: v["pick"] for k, v in me["final"].items()},
                                      "M2_fast_dec": {"fin": "fin:ew(h=0.25,n0=200.0,rho=0.0,n0s=200.0)+division",
                                                      "ko": "ko:none", "r1": "r1:none"},
                                      "M3_both": {"fin": "fin:ew(h=0.25,n0=200.0,rho=0.0,n0s=200.0)+division",
                                                  "ko": "ko:none", "r1": me["final"]["r1"]["pick"]}},
                      "desc_text": M_DESC,
                      "metrics": "7-bin, method3, finish (decision vs finish), joint, round given finish; decision-"
                                 "share calibration-in-the-large for 2024 and 2025 (mean predicted vs realised)",
                      "expectation": "M1 joint within +-0.002 (CV -0.0008, gate years +0.0005); M2 finish loss lower "
                                     "only if the 2024-25 decision drift persists within the window (the tracker "
                                     "lags by ~3 months); none of them changes production"},
           "stat": {"adopted": {k: v["best"] for k, v in stt["stats"].items() if v["adopt"]},
                    "rule": "statlines' rule on CV 2021-2023: pooled gain > 0.001 nats per fight-side and better in "
                            ">= 2 of 3 years",
                    "fragile": [k for k, v in stt["stats"].items() if v["adopt"] and v["nested_ci"][0] >= 0],
                    "primary": "per adopted stat: NLL per fight-side (adjusted - static) on the 2024-25 'valid' rows, "
                               "date-cluster bootstrap CI. Confirmed if the point is < 0; contradicted (adjustment "
                               "withdrawn) if the CI lies entirely above 0",
                    "secondary": "sig-landed deviance (unchanged by construction: sig_lnd is not adjusted), the "
                                 "non-adopted stats' best trackers (descriptive), level ratios realised / predicted "
                                 "by year"},
           }
    jdump(pre, PREREG)
    log("prereg: written %s" % cpath(PREREG))
    print(json.dumps({"league": {k: v["chosen"] for k, v in pre["league"].items()}, "method": pre["method"]["final"],
                      "stat_adopted": pre["stat"]["adopted"], "fragile": pre["stat"]["fragile"]}, indent=1))


STAGES["prereg"] = stage_prereg


def stage_holdout(args):
    """2024-01-01..2025-12-31 scored ONCE with the frozen choices of prereg.json."""
    dry = bool(getattr(args, "dry", False))
    if os.path.exists(cpath(LOCK)) and not args.force and not dry:
        raise SystemExit("holdout already run (%s); refusing a second look" % cpath(LOCK))
    # --dry: the same code on the last CV year (2023) as the window, no lock (a code check that reads no 2024+ row)
    Y0, Y1 = (2023, 2023) if dry else (2024, 2025)
    YRS = (2023,) if dry else (2024, 2025)
    pre = jload_c(PREREG)
    tr = jload_c("trackers.json")
    out = {"prereg_sha256": hashlib.sha256(open(cpath(PREREG), "rb").read()).hexdigest(), "league": {}, "method": {},
           "stat": {}}
    # ---- league trackers
    L = load("league.pkl")
    T = target_frames(L)
    for key, spec in pre["league"].items():
        tt = tr["targets"][key]
        prior, k_nb = tt["prior"], tt["k_nb"]
        P = {}
        for role in ("chosen", "ref_win5", "ref_static", "brk_variant"):
            nm = spec[role]
            if nm is None:
                continue
            d, P[role] = tracker_pred(L, T, key, tt["res"][nm], prior, k_nb)
        ho = (d["year"] >= Y0) & (d["year"] <= Y1)
        nl = {r: score_obs(d["kind"], d["y"], d["E"], p, k_nb)[0] for r, p in P.items()}
        row = {"n": int(ho.sum()), "loss": {r: float(v[ho].mean()) for r, v in nl.items()},
               "vs_win5": boot_diff((nl["chosen"] - nl["ref_win5"])[ho], d["event"][ho]),
               "vs_static": boot_diff((nl["chosen"] - nl["ref_static"])[ho], d["event"][ho])}
        if "brk_variant" in nl and spec["brk_variant"] != spec["chosen"]:
            row["brk_vs_chosen"] = boot_diff((nl["brk_variant"] - nl["chosen"])[ho], d["event"][ho])
        lv = {}
        for Y in YRS:
            m = d["year"] == Y
            act = d["y"][m].sum() / d["E"][m].sum()
            lv[Y] = {"actual": float(act)}
            for r, p in P.items():
                lv[Y][r] = float((p[m] * d["E"][m]).sum() / d["E"][m].sum())
        row["levels"] = lv
        row["verdict"] = ("contradicted" if row["vs_win5"][1] > 0 else
                          ("confirmed" if row["vs_win5"][2] < 0 else "n.s."))
        out["league"][key] = row
        log("holdout league %-9s chosen - win5 %+.5f [%+.5f, %+.5f] (%s) | %s" % (
            key, row["vs_win5"][0], row["vs_win5"][1], row["vs_win5"][2], row["verdict"],
            " | ".join("%d act %.4f pred %.4f win5 %.4f" % (Y, lv[Y]["actual"], lv[Y]["chosen"], lv[Y]["ref_win5"])
                       for Y in YRS)))
    # ---- method candidates (descriptive; production unchanged)
    S = method_setup()
    yr = S["year"]
    ho = (yr >= Y0) & (yr <= Y1)
    zero = np.zeros(len(yr))
    L0, J0 = losses_for(S, {"fin": zero, "ko": zero, "r1": zero})
    Js = {"static": J0}
    for cand, spec in pre["method"]["descriptive"].items():
        offs = {}
        for split in ("fin", "ko", "r1"):
            sp, cfg, scope = parse_mcfg(spec[split])
            offs[split] = run_split(S, sp, cfg, scope)
        Lc, Jc = losses_for(S, offs)
        Js[cand] = Jc
        out["method"][cand] = {"paired": paired(S, Lc, L0, ho),
                               "loss": {k: float(np.nanmean(Lc[k][ho])) for k in M_METRICS},
                               "offsets_end": {k: float(offs[k][ho][-1]) for k in offs}}
        pp = out["method"][cand]["paired"]
        log("holdout method %-12s bin7 %+.5f %s joint %+.5f %s finish %+.5f %s" % (
            cand, pp["bin7"]["diff"], pp["bin7"]["ci95"], pp["joint"]["diff"], pp["joint"]["ci95"],
            pp["finish"]["diff"], pp["finish"]["ci95"]))
    out["method"]["static_loss"] = {k: float(np.nanmean(L0[k][ho])) for k in M_METRICS}
    dc = {}
    for Y in YRS:
        m = (S["y"] >= 0) & (yr == Y)
        y = S["y"]
        isdec = ((y == I_XDEC) | (y == I_YDEC) | (y == I_DRAW)).astype(float)
        row = {"n": int(m.sum()), "actual_dec": float(isdec[m].mean())}
        for k, J in Js.items():
            row["pred_dec_" + k] = float((J[m, I_XDEC] + J[m, I_YDEC] + J[m, I_DRAW]).mean())
        dc[Y] = row
    out["method"]["dec_cal"] = dc
    log("holdout method decision share: %s" % {Y: {k: round(v, 4) for k, v in r.items() if k != "n"} for Y, r in dc.items()})
    # ---- statlines
    St = stat_setup()
    syr = St["year"]
    sho = (syr >= Y0) & (syr <= Y1)
    stt = jload_c("stat.json")
    for st in ST_STATS:
        D = St[st]
        nm = stt["stats"][st]["best"]
        cfg = {"fam": "none"} if nm == "none" else parse_mcfg("x:" + nm)[1]
        o = st_track(St, st, cfg)
        ll0 = st_loglik(D["kind"], D["y"], D["par"], St["t"], 0.0)
        ll1 = st_loglik(D["kind"], D["y"], D["par"], St["t"], o)
        dv0 = st_dev(D["kind"], D["y"], D["par"], St["t"], 0.0)
        dv1 = st_dev(D["kind"], D["y"], D["par"], St["t"], o)
        lv = {}
        for Y in YRS:
            m = syr == Y
            lv[Y] = [float(D["y"][m].sum() / st_mean(D["kind"], D["par"][m], St["t"][m], 0.0).sum()),
                     float(D["y"][m].sum() / st_mean(D["kind"], D["par"][m], St["t"][m], o[m]).sum())]
        r = {"cfg": nm, "adopted": st in pre["stat"]["adopted"], "n": int(sho.sum()),
             "nll_diff": boot_diff(-(ll1 - ll0)[sho], St["card"][sho]),
             "dev_diff": boot_diff((dv1 - dv0)[sho], St["card"][sho]), "dev_static": float(dv0[sho].mean()),
             "nll_static": float(-ll0[sho].mean()), "level_ratio": lv, "offset_end": float(o[sho][-1])}
        if r["adopted"]:
            r["verdict"] = ("contradicted" if r["nll_diff"][1] > 0 else ("confirmed" if r["nll_diff"][0] < 0 else
                                                                            "not confirmed"))
        out["stat"][st] = r
        log("holdout stat %-7s %s %-30s nll %+.5f [%+.5f, %+.5f] dev %+.4f | act/pred %s %s" % (
            st, "ADOPT" if r["adopted"] else "     ", nm, r["nll_diff"][0], r["nll_diff"][1], r["nll_diff"][2],
            r["dev_diff"][0], " ".join("%d %.3f" % (Y, lv[Y][0]) for Y in YRS), r.get("verdict", "")))
    if dry:
        jdump(out, "holdout_dry.json")
        log("holdout --dry: code check on 2023 written to %s (no lock)" % cpath("holdout_dry.json"))
        return
    jdump(out, "holdout.json")
    with open(cpath(LOCK), "w") as fh:
        fh.write(dt.datetime.utcnow().isoformat() + "Z\n")
    log("holdout: written %s and the lock" % cpath("holdout.json"))


STAGES["holdout"] = stage_holdout


# ====================================================================== stage: periods (descriptive, after the look)
PERIODS = [("2022", "2022-01-01", "2022-12-31"), ("2023", "2023-01-01", "2023-12-31"),
           ("2024 old gloves", "2024-01-01", "2024-05-31"), ("new gloves", "2024-06-01", "2024-11-15"),
           ("transition", "2024-11-16", "2025-02-14"), ("2025 old gloves", "2025-02-15", "2025-12-31")]


def stage_periods(args):
    """League outcome mix and stat levels by glove period (break dates from BREAKS). DESCRIPTIVE ONLY: it reads the
    2024-25 window after the single look and selects nothing; card-cluster bootstrap CIs."""
    if not os.path.exists(cpath(LOCK)):
        raise SystemExit("run holdout first: periods reads the 2024-25 window")
    L = load("league.pkl")
    T = target_frames(L)
    out = {}
    for nm, a, b in PERIODS:
        m = (L["date"] >= dt.date.fromisoformat(a)) & (L["date"] <= dt.date.fromisoformat(b))
        m = m.to_numpy()
        row = {"from": a, "to": b, "cards": int(L.loc[m, "event"].nunique())}
        for key in ("dec", "ko", "sub", "kd100", "slpm", "r108", "tdpm", "ctrlpm"):
            t = T[key]
            mm = m & t["mask"]
            y, E, ev = t["y"][mm], t["E"][mm], L["event"].to_numpy()[mm]
            cl = pd.factorize(ev)[0]
            nc = cl.max() + 1
            sy = np.bincount(cl, weights=y, minlength=nc)
            se = np.bincount(cl, weights=E, minlength=nc)
            rng = np.random.default_rng(3)
            bs = []
            for _ in range(2000):
                w = np.bincount(rng.integers(0, nc, nc), minlength=nc)
                bs.append((w * sy).sum() / max((w * se).sum(), 1e-12))
            u = t.get("unit", 1.0) if t["kind"] == "cnt" else 100.0
            row[key] = [r5(y.sum() / E.sum() * u, 4), r5(np.percentile(bs, 2.5) * u, 4),
                        r5(np.percentile(bs, 97.5) * u, 4), int(mm.sum())]
        out[nm] = row
        log("periods %-16s cards %3d | dec %5.1f%% [%4.1f, %4.1f] | KO %5.1f%% | KD/100 head %.3f [%.3f, %.3f] | SLpM %.2f | 10-8 %.2f%%" % (
            nm, row["cards"], row["dec"][0], row["dec"][1], row["dec"][2], row["ko"][0], row["kd100"][0],
            row["kd100"][1], row["kd100"][2], row["slpm"][0], row["r108"][0]))
    jdump(out, "periods.json")


STAGES["periods"] = stage_periods


# ====================================================================== stage: export
def month_starts(y0, y1):
    return [dt.date(y, m, 1) for y in range(y0, y1 + 1) for m in range(1, 13) if dt.date(y, m, 1) <= dt.date(y1, 1, 1)]


def sig5(x):
    if x is None or not math.isfinite(x):
        return None
    return float("%.5g" % x)


def with_queries(d, qdays):
    """Append snapshot query rows (E = 0, y = 0) for every (query day, division) to a target_data dict."""
    nq = len(qdays) * (DIV_ALL + 1)
    qd = np.repeat(np.array([q.toordinal() for q in qdays]), DIV_ALL + 1)
    qv = np.tile(np.arange(DIV_ALL + 1), len(qdays))
    e = {"day": np.concatenate([d["day"], qd]),
         "year": np.concatenate([d["year"], np.array([dt.date.fromordinal(int(x)).year for x in qd])]),
         "y": np.concatenate([d["y"], np.zeros(nq)]), "E": np.concatenate([d["E"], np.zeros(nq)]),
         "div": np.concatenate([d["div"], qv]),
         "event": np.concatenate([d["event"], np.array(["__q%d" % x for x in qd], dtype=object)]),
         "kind": d["kind"]}
    o = np.argsort(e["day"], kind="stable")
    real = np.concatenate([np.ones(len(d["y"]), bool), np.zeros(nq, bool)])
    for k in ("day", "year", "y", "E", "div", "event"):
        e[k] = e[k][o]
    return e, real[o], qd, qv, o


def adjust_bins7(b7, a_fin, a_ko):
    """7-bin [A KO, A SUB, A DEC, draw, B DEC, B SUB, B KO] version of adjust_joint (the draw keeps its share of the
    decision mass; P(A wins) in the six-class sense is unchanged). Mirrors src/ml/eradrift.js adjustBins7."""
    b7 = np.atleast_2d(np.asarray(b7, float))
    AKO, ASUB, ADEC, DR, BDEC, BSUB, BKO = b7.T
    ds = ADEC + BDEC
    dc = np.where(ds + DR > 0, DR / np.maximum(ds + DR, 1e-300), 0.0)
    shA = np.where(ds > 0, ADEC / np.maximum(ds, 1e-300), 0.5)
    P6 = np.stack([AKO, ASUB, ADEC + DR * shA, BDEC + DR * (1 - shA), BSUB, BKO], 1)
    out = np.zeros_like(b7)
    a_fin = np.broadcast_to(np.asarray(a_fin, float), (len(b7),))
    a_ko = np.broadcast_to(np.asarray(a_ko, float), (len(b7),))
    for j, (ko, sb, de) in enumerate(((0, 1, 2), (5, 4, 3))):
        pw = P6[:, ko] + P6[:, sb] + P6[:, de]
        tot = np.maximum(pw, 1e-12)
        f = np.clip((P6[:, ko] + P6[:, sb]) / tot, 1e-6, 1 - 1e-6)
        k = np.clip(P6[:, ko] / np.maximum(P6[:, ko] + P6[:, sb], 1e-12), 1e-6, 1 - 1e-6)
        f2, k2 = sig(logit(f) + a_fin), sig(logit(k) + a_ko)
        pko, psb, pde = pw * f2 * k2, pw * f2 * (1 - k2), pw * (1 - f2)
        if j == 0:
            out[:, 0], out[:, 1], out[:, 2] = pko, psb, pde * (1 - dc)
        else:
            out[:, 6], out[:, 5], out[:, 4] = pko, psb, pde * (1 - dc)
        out[:, 3] += pde * dc
    return out


def bins7_of(J):
    return np.stack([J[:, I_XKO:I_XKO + R5].sum(1), J[:, I_XSUB:I_XSUB + R5].sum(1), J[:, I_XDEC], J[:, I_DRAW],
                     J[:, I_YDEC], J[:, I_YSUB:I_YSUB + R5].sum(1), J[:, I_YKO:I_YKO + R5].sum(1)], 1)


def method_snapshots(S, spec, qdays):
    """Walk-forward candidate offsets at query days (dev vintage: fold year before 2024, 2024 after) plus the
    deployment value at 2026-01-01 for a model refit through 2025 (vintage 2026). Returns per split:
    {"groups": {...}: [values by query day], "prod_2026": {...}} and the per-row offsets (for the identity check)."""
    out, rows_off = {}, {}
    for split in ("fin", "ko", "r1"):
        sp, cfg, scope = parse_mcfg(spec[split])
        rows_off[split] = run_split(S, sp, cfg, scope)
        if cfg["fam"] == "none":
            continue
        W, Z = S["split_in"][split]
        obs, yv = S["split_y"][split]
        if split == "r1":
            gkind, gvals, gsel = "format", (0, 1), S["r5"]
        elif scope == "division":
            gkind, gvals, gsel = "division", tuple(range(DIV_ALL + 1)), S["div"]
        elif scope == "format":
            gkind, gvals, gsel = "format", (0, 1), S["r5"]
        else:
            gkind, gvals, gsel = "league", (0,), np.zeros(len(yv), int)
        qd_all = list(qdays) + [dt.date(2026, 1, 1)]
        nq = len(qd_all) * len(gvals)
        qday = np.repeat([q.toordinal() for q in qd_all], len(gvals))
        qg = np.tile(gvals, len(qd_all))
        qvint = np.array([min(dt.date.fromordinal(int(x)).year, 2024) for x in qday])
        qvint[-len(gvals):] = 2026
        day = np.concatenate([S["day"], qday])
        vint = np.concatenate([S["vint"], qvint])
        ev = np.concatenate([S["event"], np.array(["__q"] * nq, dtype=object)])
        Wq = np.concatenate([W, np.full((nq, W.shape[1]), 1.0 / W.shape[1])])
        Zq = np.concatenate([Z, np.zeros((nq, Z.shape[1]))])
        yq = np.concatenate([yv, np.zeros(nq)])
        oq = np.concatenate([obs, np.zeros(nq, bool)])
        isq = np.concatenate([np.zeros(len(obs), bool), np.ones(nq, bool)])
        gq = np.concatenate([gsel, qg])
        o = np.argsort(day, kind="stable")
        inv = np.empty_like(o)
        inv[o] = np.arange(len(o))
        brk = ()
        if cfg.get("vb"):
            tk = SPLIT_BREAK_TARGET[split]
            brk = [BREAK_DAYS[b["key"]] for b in BREAKS if tk in b["targets"] or (split == "r1" and "r1_fin5" in b["targets"])]
        if split == "r1":
            off = np.zeros(len(day))
            for f in (0, 1):
                m = gq[o] == f
                oo = o[m]
                off[oo] = track_split(day[oo], vint[oo], ev[oo], Wq[oo], Zq[oo], yq[oo], oq[oo], cfg, brk=brk,
                                      query=isq[oo])
        else:
            off = np.zeros(len(day))
            off[o] = track_split(day[o], vint[o], ev[o], Wq[o], Zq[o], yq[o], oq[o], cfg,
                                 scope=None if gkind == "league" else gq[o], brk=brk, query=isq[o])
        n = len(S["day"])
        chk = float(np.abs(off[:n] - rows_off[split]).max())
        assert chk < 1e-9, ("snapshot run differs from the scored run", split, chk)
        qo = off[n:].reshape(len(qd_all), len(gvals))
        names = {"format": ["3", "5"], "division": DIVS + ["ALL"], "league": ["ALL"]}[gkind]
        out[split] = {"config": spec[split], "group": gkind,
                      "values": {names[i]: [sig5(v) for v in qo[:-1, i]] for i in range(len(gvals))},
                      "prod_2026": {names[i]: sig5(qo[-1, i]) for i in range(len(gvals))}}
    return out, rows_off


def stat_snapshots(St, st, cfg_name_, qdays):
    cfg = {"fam": "none"} if cfg_name_ == "none" else parse_mcfg("x:" + cfg_name_)[1]
    n = len(St["day"])
    qd_all = list(qdays) + [dt.date(2026, 1, 1)]
    nq = len(qd_all)
    qday = np.array([q.toordinal() for q in qd_all])
    qvint = np.array([min(q.year, 2024) for q in qd_all])
    qvint[-1] = 2026
    S2 = {"day": np.concatenate([St["day"], qday]), "vint": np.concatenate([St["vint"], qvint]),
          "year": np.concatenate([St["year"], np.array([q.year for q in qd_all])]),
          "t": np.concatenate([St["t"], np.ones(nq)])}
    D = St[st]
    S2[st] = {"kind": D["kind"], "y": np.concatenate([D["y"], np.zeros(nq)]),
              "par": np.concatenate([D["par"], np.tile(D["par"][:1], (nq, 1))])}
    real = np.concatenate([np.ones(n, bool), np.zeros(nq, bool)])
    o = np.argsort(S2["day"], kind="stable")
    S3 = {k: (v[o] if isinstance(v, np.ndarray) else v) for k, v in S2.items() if k != st}
    S3[st] = {"kind": D["kind"], "y": S2[st]["y"][o], "par": S2[st]["par"][o]}
    off = np.zeros(len(o))
    off[o] = st_track(S3, st, cfg, real=real[o])
    ref = st_track(St, st, cfg)
    chk = float(np.abs(off[:n] - ref).max())
    assert chk < 1e-9, ("stat snapshot run differs", st, chk)
    return [sig5(v) for v in off[n:-1]], sig5(off[-1])


def stage_export(args):
    if not os.path.exists(cpath(LOCK)):
        raise SystemExit("run holdout first (export carries the single-look results)")
    pre = jload_c(PREREG)
    tr = jload_c("trackers.json")
    me = jload_c("method.json")
    stt = jload_c("stat.json")
    ho = jload_c("holdout.json")
    per = jload_c("periods.json") if os.path.exists(cpath("periods.json")) else None
    L = load("league.pkl")
    T = target_frames(L)
    cached = load("tracker_preds.pkl")
    months = month_starts(2012, 2026)
    levels = {}
    for key, spec in pre["league"].items():
        tt = tr["targets"][key]
        verdict = ho["league"][key]["verdict"]
        nm = spec["chosen"] if verdict != "contradicted" else spec["ref_win5"]
        entry = tt["res"][nm]
        d = target_data(L, T, key)
        e, real, qd, qv, o = with_queries(d, months)
        fam = entry["fam"]
        dcfg = tuple(entry["dcfg"]) if entry.get("dcfg") else None
        v = entry.get("brk")
        brk_all = [BREAK_DAYS[b["key"]] for b in BREAKS if key in b["targets"]] if v is not None else ()
        p = run_tracker(fam, entry["cfg"], e, e["kind"], tt["prior"], tt["k_nb"], dcfg, brk=brk_all,
                        vb=(v or 0.0) if fam == "kal" else 0.0, phi=(v or 0.0) if fam == "ew" else 0.0)
        p_real = p[real]
        assert np.abs(p_real - cached[key]["best"]).max() < 1e-9 or nm != tt["best"], key
        pq = p[~real].reshape(len(months), DIV_ALL + 1)      # rows sorted by day; within a day queries keep order
        u = tt["unit"] if tt["kind"] == "cnt" else 1.0
        levels[key] = {"label": tt["label"], "kind": tt["kind"], "unit": u, "config": nm, "holdout_verdict": verdict,
                       "league": [sig5(x * u) for x in pq[:, DIV_ALL]],
                       "div": {DIVS[j]: [sig5(x * u) for x in pq[:, j]] for j in range(DIV_ALL)},
                       "current": {"ALL": sig5(pq[-1, DIV_ALL] * u),
                                   **{DIVS[j]: sig5(pq[-1, j] * u) for j in range(DIV_ALL)}}}
        log("export: levels %-9s %-38s current %s" % (key, nm, levels[key]["current"]["ALL"]))
    # method candidates
    S = method_setup()
    zero = np.zeros(len(S["year"]))
    _, J0 = losses_for(S, {"fin": zero, "ko": zero, "r1": zero})
    mcand = {}
    fights = {}
    b0 = bins7_of(J0)
    m19 = S["year"] >= 2019
    for cand, spec in pre["method"]["descriptive"].items():
        snaps, roff = method_snapshots(S, spec, months)
        _, Jc = losses_for(S, roff)
        bc = bins7_of(Jc)
        # the 7-bin adjuster equals the joint adjuster on the 7 bins
        chk = adjust_bins7(b0, roff["fin"], roff["ko"])
        assert np.abs(chk - bc).max() < 1e-9, "adjust_bins7 != adjust_joint"
        mcand[cand] = {"desc": M_DESC[cand], "splits": snaps,
                       "holdout": {k: ho["method"][cand]["paired"][k] for k in ("bin7", "method3", "finish", "joint",
                                                                                "round_given_fin")}}
        if cand != "M2_fast_dec":            # M1 changes rounds only and M3's 7 bins equal M2's: not stored
            continue
        for i in np.where(m19)[0]:
            fid = S["T"]["id"].iloc[i]
            r = fights.setdefault(fid, {"date": S["T"]["date"].iloc[i].isoformat(),
                                        "set": "holdout" if S["year"][i] >= 2024 else "cv",
                                        "p_a": r5(float(S["P6w"][i, :3].sum())), "rounds": int(S["r5"][i] * 2 + 3),
                                        "division": S["T"]["division"].iloc[i],
                                        "static_bins7": [r5(x, 5) for x in b0[i]]})
            r[cand + "_bins7"] = [r5(x, 5) for x in bc[i]]
    # statlines offsets
    St = stat_setup()
    smonths = month_starts(2020, 2026)
    sts = {}
    for st, r in ho["stat"].items():
        nm = stt["stats"][st]["best"]
        adopted = st in pre["stat"]["adopted"]
        verdict = r.get("verdict")
        if not adopted and nm == "none":
            continue
        vals, prod = stat_snapshots(St, st, nm, smonths)
        on = bool(adopted and verdict == "confirmed")
        sts[st] = {"config": nm, "kind": stt["stats"][st]["kind"], "adopted_cv": adopted, "holdout_verdict": verdict,
                   "enabled": on, "values": vals, "prod_2026": prod, "cv_gain": stt["stats"][st]["gain"],
                   "cv_ci": stt["stats"][st]["ci"], "holdout_nll": r["nll_diff"]}
    doc = {"meta": {"tool": "eradrift 1.0 (2026-11-07)", "built": dt.datetime.utcnow().isoformat() + "Z",
                    "protocol": "fights >= 2026-01-01 dropped at parse; choices by rolling-origin / forward-chained CV "
                                "<= 2023; 2024-25 scored once after the pre-registration (commit 53ca073, "
                                "data/derived/eradrift_prereg.json)",
                    "months": [m.isoformat() for m in months], "stat_months": [m.isoformat() for m in smonths],
                    "levels_semantics": "value at month start m = the tracker's prediction for a fight on day m, "
                                        "from fights strictly before m (shares as probabilities; rates in 'unit' x "
                                        "per-exposure: kd100 per 100 head strikes landed, slpm / sapm per fighter-"
                                        "minute, tdpm / subpm per 15 fighter-minutes, ctrlpm seconds per fighter-"
                                        "minute, r108 per 100 judged rounds)",
                    "offset_semantics": "method: logit offsets on P(finish | winner) (fin), P(KO | finish, winner) "
                                        "(ko), P(round 1 | finish, winner) (r1, by format); values = walk-forward "
                                        "offsets for the dev-vintage S2+ml2win (fold year before 2024, fit < 2024 "
                                        "after); prod_2026 = the offset a model refit through 2025 starts 2026 with. "
                                        "stat: log offsets on the statlines NB mean (dev tables), same vintage rule",
                    "divisions": DIVS, "breaks": BREAKS,
                    "production": {"method": "unchanged (gate failed): EraDrift.adjustCells is the identity unless a "
                                             "candidate is named", "stat": [k for k, v in sts.items() if v["enabled"]]}},
           "levels": levels, "method": {"candidates": mcand, "gate": me["gate"]["paired"], "cv_final": me["final"],
                                        "dec_cal_cv": me["dec_cal"], "dec_cal_holdout": ho["method"]["dec_cal"],
                                        "static_cv": me["static_cv"], "static_holdout": ho["method"]["static_loss"]},
           "stat": sts, "periods": per,
           "cv": {k: {"best": v["best"], "refs": v["refs"], "cv_best": v["res"][v["best"]]["cv"],
                      "cv_win5": v["res"][v["refs"]["win5"]]["cv"], "cv_static": v["res"][v["refs"]["static"]]["cv"],
                      "nested": v["nested_loss"], "nested_win5": v["nested_win5"], "ci": v["ci"], "n": v["n_cv"],
                      "fam_best": {f: [k2, v["res"][k2]["cv"]] for f, k2 in v["fam_best"].items()}}
                  for k, v in tr["targets"].items()},
           "stat_cv": {k: {kk: v[kk] for kk in ("best", "gain", "wins", "adopt", "ci", "ci_dev", "nested", "nested_ci",
                                                "level_ratio", "dev_static")} for k, v in stt["stats"].items()},
           "holdout": {"league": ho["league"], "stat": ho["stat"], "prereg_sha256": ho["prereg_sha256"]},
           "fights": fights}
    # JS test vectors
    rng = np.random.default_rng(7)
    vec = {"levels": [], "bins7": [], "joint": [], "stat": []}
    keys = list(levels)
    for _ in range(60):
        k = keys[rng.integers(len(keys))]
        dd = dt.date(2012, 1, 1) + dt.timedelta(days=int(rng.integers(0, 5200)))
        dv = (DIVS + ["Catch Weight"])[rng.integers(len(DIVS) + 1)]
        vec["levels"].append({"target": k, "date": dd.isoformat(), "division": dv,
                              "expect": level_lookup(doc, k, dd, dv)})
    fids = list(fights)
    for _ in range(40):
        fid = fids[rng.integers(len(fids))]
        r = fights[fid]
        cand = ["M2_fast_dec", "M3_both", None][rng.integers(3)]
        dd = dt.date.fromisoformat(r["date"])
        a_fin, a_ko = cand_offsets(doc, cand, dd, r["division"], r["rounds"])[:2]
        vec["bins7"].append({"bins7": r["static_bins7"], "date": r["date"], "division": r["division"],
                             "rounds": r["rounds"], "candidate": cand,
                             "expect": [r5(x, 9) for x in adjust_bins7(np.array(r["static_bins7"]), a_fin, a_ko)[0]]})
    for _ in range(20):
        i = int(rng.integers(len(S["year"])))
        if S["year"][i] < 2016:
            continue
        cand = ["M1_cv_final", "M3_both"][rng.integers(2)]
        dd = S["T"]["date"].iloc[i]
        rounds = int(S["r5"][i] * 2 + 3)
        a = cand_offsets(doc, cand, dd, S["T"]["division"].iloc[i], rounds)
        Jin = J0[i:i + 1]
        Jout = adjust_from_joint(Jin, *a)
        vec["joint"].append({"joint": [r5(x, 9) for x in Jin[0]], "date": dd.isoformat(),
                             "division": S["T"]["division"].iloc[i], "rounds": rounds, "candidate": cand,
                             "expect": [r5(x, 9) for x in Jout[0]]})
    for _ in range(20):
        dd = dt.date(2020, 1, 1) + dt.timedelta(days=int(rng.integers(0, 2600)))
        means = {st: float(rng.uniform(0.5, 60)) for st in ("sig_lnd", "l_att", "l_lnd", "c_att", "kd", "ctrl")}
        al = bool(rng.integers(2))
        vec["stat"].append({"date": dd.isoformat(), "means": means, "all": al,
                            "expect": stat_adjust(doc, means, dd, use_all=al)})
    doc["test_vectors"] = vec
    with open(OUT_JSON, "w") as fh:
        json.dump(doc, fh, separators=(",", ":"), default=_jdef)
    log("export: %s (%.0f KB; %d fights with candidate bins)" % (OUT_JSON, os.path.getsize(OUT_JSON) / 1024,
                                                                  len(fights)))


def month_index(doc, date, key="months"):
    ms = doc["meta"][key]
    s_ = date.isoformat()
    i = -1
    for j, m in enumerate(ms):
        if m <= s_:
            i = j
        else:
            break
    return i


def level_lookup(doc, target, date, division):
    L = doc["levels"][target]
    i = month_index(doc, date)
    if i < 0:
        return None
    if division in L["div"]:
        return L["div"][division][i]
    return L["league"][i]


def cand_offsets(doc, cand, date, division, rounds):
    """(a_fin, a_ko, a_r1) of a method candidate at a date (month-start snapshot; from 2026-01-01 on, the prod value)."""
    if cand is None:
        return 0.0, 0.0, 0.0
    C = doc["method"]["candidates"][cand]["splits"]
    i = month_index(doc, date)
    prod = date >= dt.date(2026, 1, 1)
    out = []
    for split in ("fin", "ko", "r1"):
        if split not in C or i < 0:
            out.append(0.0)
            continue
        c = C[split]
        if c["group"] == "format":
            g = "5" if rounds == 5 else "3"
        elif c["group"] == "division":
            g = division if division in c["values"] else "ALL"
        else:
            g = "ALL"
        v = c["prod_2026"][g] if prod else c["values"][g][i]
        out.append(float(v or 0.0))
    return tuple(out)


def adjust_from_joint(J, a_fin, a_ko, a_r1):
    """adjust_joint on a 23-cell joint (shapes and the draw share read from the joint itself)."""
    import methodround as MR
    P6 = MR.joint_to_c6(J)
    dsum = J[:, I_XDEC] + J[:, I_YDEC] + J[:, I_DRAW]
    dc = float(J[0, I_DRAW] / dsum[0]) if dsum[0] > 0 else 0.0
    return adjust_joint(P6, J, dc, a_fin, a_ko, a_r1)


def stat_adjust(doc, means, date, use_all=None):
    i = month_index(doc, date, "stat_months")
    prod = date >= dt.date(2026, 1, 1)
    out = {}
    for st, mu in means.items():
        S = doc["stat"].get(st)
        if not S or not (S["enabled"] or use_all) or S["kind"] != "nb" or i < 0:
            out[st] = r5(mu, 9)
            continue
        a = S["prod_2026"] if prod else S["values"][i]
        out[st] = r5(mu * math.exp(a or 0.0), 9)
    return out


STAGES["export"] = stage_export


# ====================================================================== stage: summary
def _ci(c, k=4):
    f = "%+." + str(k) + "f"
    return (f + " [" + f + ", " + f + "]") % tuple(c)


def stage_summary(args):
    """Print every table of research/model_eradrift.md from data/derived/eradrift.json (no refit)."""
    d = json.load(open(OUT_JSON))
    print("== 1. League trackers, rolling-origin CV 2012-2023 (loss per observation; Bernoulli NLL for shares, NB NLL "
          "for rates). 'nested' = config chosen on 2012..Y, scored on Y+1 (2014-2023)")
    print("| target | chosen (pooled CV) | CV chosen | CV win5+div | CV static+div | nested - win5+div [CI] | n |")
    print("|---|---|---|---|---|---|---|")
    for k, v in d["cv"].items():
        print("| %s | %s | %.5f | %.5f | %.5f | %s | %d |" % (k, v["best"], v["cv_best"], v["cv_win5"], v["cv_static"],
                                                           _ci(v["ci"]["nested_vs_win5"], 5), v["n"]))
    print("\n== 2. League trackers on 2024-25 (single look; chosen - win5+div, card-cluster CI) and year levels")
    print("| target | chosen - win5 [CI] | verdict | 2024 actual / chosen / win5 | 2025 actual / chosen / win5 |")
    print("|---|---|---|---|---|")
    for k, v in d["holdout"]["league"].items():
        u = d["levels"][k]["unit"] if d["levels"][k]["kind"] == "cnt" else 100.0
        lv = v["levels"]
        print("| %s | %s | %s | %.3f / %.3f / %.3f | %.3f / %.3f / %.3f |" % (
            k, _ci(v["vs_win5"], 5), v["verdict"], lv["2024"]["actual"] * u, lv["2024"]["chosen"] * u,
            lv["2024"]["ref_win5"] * u, lv["2025"]["actual"] * u, lv["2025"]["chosen"] * u, lv["2025"]["ref_win5"] * u))
    print("\n   break-intervention variants vs the chosen config on 2024-25 (descriptive):")
    for k, v in d["holdout"]["league"].items():
        if "brk_vs_chosen" in v:
            print("   %-9s %s" % (k, _ci(v["brk_vs_chosen"], 5)))
    M = d["method"]
    print("\n== 3. Method model S2 + ML v2 winner: level adjustment")
    g = M["gate"]
    print("gate (nested forward-chained 2021-2023, n %d): 7-bin %s; joint %s; method3 %s; finish %s" % (
        g["bin7"]["n"], _ci([g["bin7"]["diff"]] + g["bin7"]["ci95"], 5), _ci([g["joint"]["diff"]] + g["joint"]["ci95"], 5),
        _ci([g["method3"]["diff"]] + g["method3"]["ci95"], 5), _ci([g["finish"]["diff"]] + g["finish"]["ci95"], 5)))
    print("CV-final config (2016-2023): %s" % {k: v["pick"] for k, v in M["cv_final"].items()})
    print("static CV 2016-2023: %s" % {k: round(v, 5) for k, v in M["static_cv"].items()})
    print("static 2024-25:      %s" % {k: round(v, 5) for k, v in M["static_holdout"].items()})
    print("| candidate (2024-25, vs static) | 7-bin | method3 | finish | joint | round given finish |")
    print("|---|---|---|---|---|---|")
    for c, v in M["candidates"].items():
        h = v["holdout"]
        print("| %s | %s |" % (c, " | ".join(_ci([h[k]["diff"]] + h[k]["ci95"], 4) for k in
                                           ("bin7", "method3", "finish", "joint", "round_given_fin"))))
    print("\n   decision share (mean predicted vs actual), method universe:")
    print("| year | n | actual | static | M2 |")
    print("|---|---|---|---|---|")
    for Y, r in list(M["dec_cal_cv"].items()) + list(M["dec_cal_holdout"].items()):
        print("| %s | %d | %.3f | %.3f | %s |" % (Y, r["n"], r["actual_dec"], r["pred_dec_static"],
                                               "%.3f" % r["pred_dec_M2_fast_dec"] if "pred_dec_M2_fast_dec" in r else
                                               ("%.3f" % r["pred_dec_nested"] + " (nested)")))
    print("\n== 4. Statlines layer: per-stat mean offsets (NLL per fight-side; CV 2021-2023, 2024-25 single look)")
    print("| stat | CV best | CV gain [CI] | years better | CV rule | nested 2022-23 | 2024-25 (best cfg) [CI] | verdict | act/pred 2024 / 2025 |")
    print("|---|---|---|---|---|---|---|---|---|")
    for k, v in d["stat_cv"].items():
        h = d["holdout"]["stat"][k]
        print("| %s | %s | %s | %d/3 | %s | %+.5f | %s | %s | %.3f / %.3f |" % (
            k, v["best"], _ci(v["ci"], 5), v["wins"], "adopt" if v["adopt"] else "-", v["nested_ci"][0],
            _ci(h["nll_diff"], 5), h.get("verdict", "-"), h["level_ratio"]["2024"][0], h["level_ratio"]["2025"][0]))
    if d.get("periods"):
        print("\n== 5. League levels by glove period (DESCRIPTIVE, read after the look; card-cluster CIs)")
        print("| period | cards | decision % | KO % | SUB % | KD per 100 head | sig landed / fighter-min | 10-8 per 100 judged rounds |")
        print("|---|---|---|---|---|---|---|---|")
        for nm, r in d["periods"].items():
            print("| %s (%s..%s) | %d | %.1f [%.1f, %.1f] | %.1f | %.1f | %.3f [%.3f, %.3f] | %.2f | %.2f |" % (
                nm, r["from"], r["to"], r["cards"], r["dec"][0], r["dec"][1], r["dec"][2], r["ko"][0], r["sub"][0],
                r["kd100"][0], r["kd100"][1], r["kd100"][2], r["slpm"][0], r["r108"][0]))
    print("\n== 6. Current levels (after the last 2025 card; league)")
    for k, v in d["levels"].items():
        print("   %-9s %-40s %s  (%s)" % (k, v["config"], v["current"]["ALL"], v["label"]))


STAGES["summary"] = stage_summary


# ====================================================================== main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("stage", choices=list(STAGES))
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dry", action="store_true", help="holdout: run the code on 2023 (CV year) without the lock")
    args = ap.parse_args()
    t0 = time.time()
    STAGES[args.stage](args)
    log("%s done in %.0f s" % (args.stage, time.time() - t0))


if __name__ == "__main__":
    main()
