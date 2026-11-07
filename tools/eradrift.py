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
    Ebar = float(np.mean(E)) if len(E) else 1.0
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
    Ebar = float(np.mean(E))
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


def track_split(day, vint, event, W, Z, yv, obs, cfg, scope=None, brk=()):
    """Walk-forward offsets for one split. Returns, for every row, the offset used to predict it (from rows on
    strictly earlier days whose split outcome is observed). cfg: {"fam": "ew", "h", "n0", "rho"} or
    {"fam": "kal", "q", "se", "rho", "vb"} or {"fam": "none"}. Vintage: rows predicted by an older model vintage than
    the row being predicted get weight rho^(age) (EW); the Kalman state is multiplied by rho at each refit.
    scope: optional integer group per row (format or division); its offset = league offset + a deviation shrunk to 0
    with precision cfg["n0s"] * 0.2 (EW family only)."""
    n = len(day)
    off = np.zeros(n)
    if cfg["fam"] == "none":
        return off
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
            if len(hi):
                wt = np.exp(-lam * (d - day[hi]))
                vnow = vint[rows].max()
                age = np.maximum(vnow - vint[hi], 0)
                wt = wt * np.power(rho, age) if rho < 1 else wt
                keep = wt > 1e-4
                hi, wt = hi[keep], wt[keep]
                a = solve_offset(W[hi], Z[hi], yv[hi], wt, prec, 0.0, a_prev)
                a_prev = a
                off[rows] = a
                if scope is not None:
                    prec_s = cfg["n0s"] * 0.2
                    for g in np.unique(scope[rows]):
                        m = scope[hi] == g
                        key = int(g)
                        a_s = solve_offset(W[hi][m], Z[hi][m], yv[hi][m], wt[m], prec_s, a, prev_a_s.get(key, a))
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


# ====================================================================== main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("stage", choices=list(STAGES))
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    t0 = time.time()
    STAGES[args.stage](args)
    log("%s done in %.0f s" % (args.stage, time.time() - t0))


if __name__ == "__main__":
    main()
