#!/usr/bin/env python3
"""Method-and-round model: P(KO/TKO), P(submission), P(decision), the finishing round, and who wins how.

Run from the project root (about 3-6 minutes on 4 cores):

    python3 tools/methodround.py                 # build features, tune on 2019-2023, report on 2024+, write outputs
    python3 tools/methodround.py --quick         # fewer bootstrap draws and a smaller tuning grid (smoke test)
    python3 tools/methodround.py --score sim.json    # score the simulator (or any model) on the same fights/metrics

Reads   data/raw/*.csv (through tools/build_db.py's loaders, so people, aliases and Elo match the pipeline),
        data/derived/backtest.json (fight ids), data/derived/fighters.json (roster outputs), and, when present,
        data/derived/market.json (tools/market.py: closing moneylines, method / round props) and
        data/raw/odds/nlbair_odds.csv (2013-2018 closing ranges) for the market variant and benchmark.
Writes  data/derived/methodround.json   per-fight predictions keyed by backtest (ufcstats) fight id, held-out
                                        metrics, roster-level outputs keyed by slug, and a compact JS model
        research/model_methodround.md    method, held-out results with bootstrap CIs, calibration, recommendation

Outcome space. Every fight resolves into one cell of {X by KO/TKO in round r, X by submission in round r,
X by decision, draw} for X in {A, B} and r = 1..scheduled rounds (KO/TKO includes doctor and corner
stoppages). DQ and no-contests are excluded from training and scoring. Everything the page needs (finish
rate, method split, 7-bin outcome, finishing-round distribution, P(fighter wins by KO/sub/dec)) is a
marginal of this joint distribution.

Walk-forward discipline. Every feature for a fight comes from that fighter's UFC fights strictly before
the fight date (same-day fights excluded), division priors come from the five calendar years before
the fight's year, hyperparameters and blend weights are chosen by expanding-window CV with validation
years 2020-2023 only, and the 2024+ fights are scored once with the frozen choice. A second, "yearly
refit" variant re-estimates coefficients at each Jan 1 on everything before it, with the same frozen
hyperparameters (what a deployed model would do); it is reported separately.

Corners. A is the first name in the ufcstats bout and wins 56% of decisive fights, so the models never
see the corner: every fight is used twice in training (A/B and B/A), and predictions average the two
orientations, so swapping the fighters swaps the probabilities exactly.
"""
import argparse
import datetime as dt
import json
import math
import os
import sys
import time

for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):   # single-threaded BLAS is faster
    os.environ.setdefault(_v, "1")                                          # for these small dense problems
from collections import Counter, defaultdict

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import build_db as B  # noqa: E402  (the pipeline's parsers, people matching and Elo)

OUT_JSON = os.path.join(ROOT, "data", "derived", "methodround.json")
OUT_MD = os.path.join(ROOT, "research", "model_methodround.md")
BACKTEST = os.path.join(ROOT, "data", "derived", "backtest.json")
FIGHTERS = os.path.join(ROOT, "data", "derived", "fighters.json")

TRAIN_FROM = dt.date(2008, 1, 1)       # oldest fight used for training (pre-2008 finish rates are a different sport)
TUNE_YEARS = (2019, 2023)
VALID_YEARS = (2020, 2021, 2022, 2023)  # expanding-window CV folds inside the tuning period
TEST_FROM = dt.date(2024, 1, 1)
ELO_K, ELO_BOOST = 44, 1.5             # chosen by tools/build_db.py on 2019-2023 (data/derived/elo_report.json)
HALF_LIFE = 730.0                      # same decay as fighters.json / backtest.json S sums
PRIOR_WINDOW = 5
KI = B.KI
KEYS = B.KEYS


# ============================================================== 1. walk-forward fight table
def ko_class(f):
    """Method class of a decisive fight: KO (incl. doctor/corner), SUB, DEC; None for DQ/NC/other."""
    if f.winner == "D":
        return "DRAW"
    if f.winner not in ("A", "B"):
        return None
    return {"KO": "KO", "DOC": "KO", "SUB": "SUB", "UD": "DEC", "SD": "DEC", "MD": "DEC"}.get(f.method)


def new_person():
    return {"S": np.zeros(len(KEYS)), "C": np.zeros(len(KEYS)), "t": None, "n_all": 0, "rec": Counter(),
            "ko_losses": 0, "hist": [], "last": None, "n5": 0, "streak": 0, "fin_min_w": 0.0, "fin_n_w": 0,
            "fin_min_l": 0.0, "fin_n_l": 0, "r1_w": 0, "r1_l": 0, "dur": 0.0, "dur_n": 0, "opp_elo": 0.0}


REC_KEYS = ["w", "l", "d", "nc", "ko_w", "sub_w", "dec_w", "ko_l", "sub_l", "dec_l"]


def build_table(log=None):
    """One row per UFC fight from TRAIN_FROM on where both men had an earlier UFC bout (no ambiguous people).
    Per side: S (730-day decayed sums, stat fights), C (career sums), the career record over every bout,
    finishing-time tendencies, last fight, age, Elo, physicals. All strictly pre-fight."""
    log = log if log is not None else {}
    t0 = time.time()
    fights, _ = B.parse_fights(log)
    people = B.build_people(fights, log)
    B.build_vectors(fights, log)
    elo_now, elo_pre, _ = B.run_elo(fights, ELO_K, ELO_BOOST, store=True)
    years = list(range(TRAIN_FROM.year, fights[-1].date.year + 1))
    priors = {y: B.build_priors(fights, dt.date(y - PRIOR_WINDOW, 1, 1), dt.date(y, 1, 1)) for y in years}
    print("  parsed %d fights, %d people, priors for %d years (%.1fs)" % (len(fights), len(people), len(years),
                                                                          time.time() - t0))
    lam = math.log(2) / HALF_LIFE
    state = defaultdict(new_person)
    rows = []
    # same-day guard: fights on one card are applied after the whole card is snapshotted
    by_day = defaultdict(list)
    for f in fights:
        by_day[f.day].append(f)
    for day in sorted(by_day):
        card = by_day[day]
        for f in card:
            a, b = f.persons
            if a == b:
                continue
            for p in (a, b):
                st = state[p]
                if st["t"] is not None and day > st["t"]:
                    st["S"] *= math.exp(-lam * (day - st["t"]))
                st["t"] = day if st["t"] is None else max(st["t"], day)
            sa, sb = state[a], state[b]
            if (f.date >= TRAIN_FROM and sa["n_all"] >= 1 and sb["n_all"] >= 1
                    and not a.startswith("amb:") and not b.startswith("amb:")):
                r = {"id": f.fid, "date": f.date, "day": day, "year": f.date.year, "event": f.event,
                     "division": f.division, "rounds": f.sched, "title": bool(f.title), "tourn": bool(f.tourn),
                     "winner": f.winner, "method": f.method, "cls": ko_class(f), "rnd": f.rnd,
                     "time_s": f.time_s, "fight_s": f.fight_s}
                homes = []
                for tag, p, st, elo in (("A", a, sa, elo_pre[f.fid][0]), ("B", b, sb, elo_pre[f.fid][1])):
                    P = people[p]
                    T = P["tott"] or {}
                    dob = T.get("dob")
                    home = B.mode_recent(st["hist"], day)
                    homes.append(home)
                    r[tag + "_slug"] = P.get("slug")
                    r[tag + "_name"] = P["name"]
                    r[tag + "_age"] = (f.date - dob).days / 365.25 if dob else np.nan
                    r[tag + "_elo"] = elo
                    r[tag + "_n"] = st["n_all"]
                    r[tag + "_n5"] = st["n5"]
                    r[tag + "_ko_losses"] = st["ko_losses"]
                    r[tag + "_height"] = T.get("height_in") or np.nan
                    r[tag + "_reach"] = T.get("reach_in") or np.nan
                    r[tag + "_stance"] = T.get("stance") or ""
                    r[tag + "_home"] = home
                    r[tag + "_layoff"] = (day - st["last"][0]) if st["last"] else np.nan
                    lr = st["last"][1] if st["last"] else ""
                    r[tag + "_last"] = lr
                    r[tag + "_streak"] = st["streak"]
                    r[tag + "_fin_min_w"] = st["fin_min_w"]
                    r[tag + "_fin_n_w"] = st["fin_n_w"]
                    r[tag + "_fin_min_l"] = st["fin_min_l"]
                    r[tag + "_fin_n_l"] = st["fin_n_l"]
                    r[tag + "_r1_w"] = st["r1_w"]
                    r[tag + "_r1_l"] = st["r1_l"]
                    r[tag + "_dur"] = st["dur"]
                    r[tag + "_dur_n"] = st["dur_n"]
                    r[tag + "_opp_elo"] = st["opp_elo"] / st["n_all"] if st["n_all"] else np.nan
                    for k in REC_KEYS:
                        r[tag + "_rec_" + k] = st["rec"].get(k, 0)
                    r[tag + "_S"] = st["S"].copy()
                    r[tag + "_C"] = st["C"].copy()
                pdiv = f.division
                if f.division in B.NON_DIV:
                    hs = [h for h in homes if B.LBS.get(h)]
                    pdiv = max(hs, key=lambda d: B.LBS[d]) if hs else "ALL"
                r["prior_div"] = pdiv
                rows.append(r)
        # apply the whole card after every snapshot of the day
        for f in card:
            a, b = f.persons
            if a == b:
                continue
            cls = ko_class(f)
            for s, p in ((0, a), (1, b)):
                st = state[p]
                if f.stats:
                    v = f.stats["v"][s]
                    st["S"] += v
                    st["C"] += v
                st["n_all"] += 1
                st["n5"] += 1 if f.sched == 5 else 0
                st["hist"].append((f.day, f.division))
                st["opp_elo"] += elo_pre[f.fid][1 - s]
                won = f.winner == ("A" if s == 0 else "B")
                lost = f.winner == ("B" if s == 0 else "A")
                rec = st["rec"]
                if f.winner == "D":
                    rec["d"] += 1
                elif f.winner == "NC":
                    rec["nc"] += 1
                elif won or lost:
                    rec["w" if won else "l"] += 1
                    if f.cat in ("ko", "sub", "dec"):
                        rec[f.cat + ("_w" if won else "_l")] += 1
                    if lost and f.method == "KO":
                        st["ko_losses"] += 1
                if f.fight_s is not None and f.winner in ("A", "B", "D"):
                    st["dur"] += f.fight_s / 60.0
                    st["dur_n"] += 1
                    if cls in ("KO", "SUB"):
                        if won:
                            st["fin_min_w"] += f.fight_s / 60.0
                            st["fin_n_w"] += 1
                            st["r1_w"] += 1 if f.rnd == 1 else 0
                        else:
                            st["fin_min_l"] += f.fight_s / 60.0
                            st["fin_n_l"] += 1
                            st["r1_l"] += 1 if f.rnd == 1 else 0
                res = "W" if won else ("L" if lost else f.winner)
                st["streak"] = (max(st["streak"], 0) + 1 if won else (min(st["streak"], 0) - 1 if lost else 0))
                st["last"] = (f.day, res + ("_" + cls if cls in ("KO", "SUB", "DEC") else ""))
    T = pd.DataFrame(rows)
    print("  walk-forward table: %d fights %s..%s (%.1fs)" % (len(T), T.date.min(), T.date.max(), time.time() - t0))
    priors["live"] = B.build_priors(fights, fights[-1].date.replace(year=fights[-1].date.year - PRIOR_WINDOW), None)
    return T, priors, fights, people, state, elo_now


# ============================================================== 2. features
WOMEN = {"Women's Strawweight", "Women's Flyweight", "Women's Bantamweight", "Women's Featherweight"}
PRIOR_FIELDS = ["min", "n", "ko_w", "ko_l", "sub_w", "sub_l", "dec_w", "dec_l", "kd", "okd", "h_lnd", "oh_lnd",
                "d_lnd", "c_lnd", "g_lnd", "d_att", "c_att", "g_att", "td_lnd", "td_att", "ctrl", "sub_att", "l_lnd",
                "t_att", "kd_per_h", "acc_sig", "td_acc", "sub_conv", "mpf"]

# shrinkage strengths (pseudo-exposure toward the division prior); tuned values are written to the JSON
SHRINK = {"k_fight": 3.0,      # fights, for per-fight result rates
          "k_min": 15.0,       # minutes, for per-minute rates (CV: 15 < 20 < 30 < 60)
          "k_head": 300.0,     # landed head strikes, for knockdown power / chin
          "k_att": 150.0,      # attempts, for accuracies
          "k_sub": 6.0}        # submission attempts, for conversion / defence


def prior_frame(T, priors):
    """Per-row prior rates (division of the bout, or the heavier home division for catch weights)."""
    out = {k: np.empty(len(T)) for k in PRIOR_FIELDS + ["lbs"]}
    keys = T["prior_year"] if "prior_year" in T else T["year"]
    for i, (y, d) in enumerate(zip(keys, T["prior_div"])):
        P = priors[y].get(d) or priors[y]["ALL"]
        for k in PRIOR_FIELDS:
            v = P.get(k)
            out[k][i] = v if v is not None else priors[y]["ALL"][k]
        out["lbs"][i] = B.LBS.get(d) or P.get("lbs") or 170
    return pd.DataFrame(out, index=T.index)


def side_features(T, PR, tag, sh):
    """Profile features of one side from its pre-fight sums; returns a dict of arrays."""
    S = np.stack(T[tag + "_S"].to_numpy())
    C = np.stack(T[tag + "_C"].to_numpy())
    g = lambda k: S[:, KI[k]]
    m, n = g("min"), g("n")
    kf, km, kh, ka, ks = sh["k_fight"], sh["k_min"], sh["k_head"], sh["k_att"], sh["k_sub"]
    p = lambda k: PR[k].to_numpy()
    sig_l = g("d_lnd") + g("c_lnd") + g("g_lnd")
    sig_a = g("d_att") + g("c_att") + g("g_att")
    osig_l = g("od_lnd") + g("oc_lnd") + g("og_lnd")
    osig_a = g("od_att") + g("oc_att") + g("og_att")
    p_sig = p("d_lnd") + p("c_lnd") + p("g_lnd")
    p_siga = p("d_att") + p("c_att") + p("g_att")
    pf = lambda k: p(k) / p("n")                                   # league per-fighter-fight rate
    F = {}
    for k in ("ko_w", "ko_l", "sub_w", "sub_l"):
        F[k + "_pf"] = (g(k) + kf * pf(k)) / (n + kf)                # per fight
        F[k + "_pm"] = 15 * (g(k) + km * p(k)) / (m + km)            # per 15 min (finishing hazard)
    F["dec_pf"] = (g("dec_w") + g("dec_l") + kf * (pf("dec_w") + pf("dec_l"))) / (n + kf)
    F["kd15"] = 15 * (g("kd") + km * p("kd")) / (m + km)
    F["okd15"] = 15 * (g("okd") + km * p("okd")) / (m + km)
    F["pow"] = (g("kd") + kh * p("kd_per_h")) / (g("h_lnd") + kh)
    F["chin"] = (g("okd") + kh * p("kd_per_h")) / (g("oh_lnd") + kh)
    F["slpm"] = (sig_l + km * p_sig) / (m + km)
    F["sapm"] = (osig_l + km * p_sig) / (m + km)
    F["hlpm"] = (g("h_lnd") + km * p("h_lnd")) / (m + km)
    F["hapm"] = (g("oh_lnd") + km * p("h_lnd")) / (m + km)
    F["acc"] = (sig_l + ka * p("acc_sig")) / (sig_a + ka)
    F["oacc"] = (osig_l + ka * p("acc_sig")) / (osig_a + ka)
    F["att_pm"] = (sig_a + km * p_siga) / (m + km)
    F["td15"] = 15 * (g("td_lnd") + km * p("td_lnd")) / (m + km)
    F["otd15"] = 15 * (g("otd_lnd") + km * p("td_lnd")) / (m + km)
    F["tda15"] = 15 * (g("td_att") + km * p("td_att")) / (m + km)
    F["td_acc"] = (g("td_lnd") + ka / 5 * p("td_acc")) / (g("td_att") + ka / 5)
    F["otd_acc"] = (g("otd_lnd") + ka / 5 * p("td_acc")) / (g("otd_att") + ka / 5)
    F["ctrl"] = (g("ctrl") + km * p("ctrl")) / (m + km) / 60.0       # share of time in control
    F["octrl"] = (g("octrl") + km * p("ctrl")) / (m + km) / 60.0
    F["gnd"] = (g("g_lnd") + km * p("g_lnd")) / (m + km)
    F["ognd"] = (g("og_lnd") + km * p("g_lnd")) / (m + km)
    F["sub15"] = 15 * (g("sub_att") + km * p("sub_att")) / (m + km)
    F["osub15"] = 15 * (g("osub_att") + km * p("sub_att")) / (m + km)
    F["sub_conv"] = (g("sub_w") + ks * p("sub_conv")) / (g("sub_att") + ks)
    F["sub_def"] = (g("sub_l") + ks * p("sub_conv")) / (g("osub_att") + ks)
    F["leg_share"] = (g("l_lnd") + 20 * p("l_lnd") / p_sig) / (sig_l + 20)
    F["mpf"] = (m + kf * p("mpf")) / (n + kf)
    # career record over every UFC bout (includes fights without round stats)
    na = T[tag + "_n"].to_numpy(float)
    rec = lambda k: T[tag + "_rec_" + k].to_numpy(float)
    for k in ("ko_w", "ko_l", "sub_w", "sub_l"):
        F["c_" + k] = (rec(k) + kf * pf(k)) / (na + kf)
    F["c_dec"] = (rec("dec_w") + rec("dec_l") + kf * (pf("dec_w") + pf("dec_l"))) / (na + kf)
    F["c_win"] = (rec("w") + kf * 0.5) / (rec("w") + rec("l") + kf)
    dur, dn = T[tag + "_dur"].to_numpy(float), T[tag + "_dur_n"].to_numpy(float)
    F["c_mpf"] = (dur + kf * p("mpf")) / (dn + kf)
    fw, fwn = T[tag + "_fin_min_w"].to_numpy(float), T[tag + "_fin_n_w"].to_numpy(float)
    fl, fln = T[tag + "_fin_min_l"].to_numpy(float), T[tag + "_fin_n_l"].to_numpy(float)
    F["fin_t_w"] = (fw + 2 * 6.5) / (fwn + 2)                        # mean minute of his finishing wins
    F["fin_t_l"] = (fl + 2 * 6.5) / (fln + 2)
    F["r1_w"] = (T[tag + "_r1_w"].to_numpy(float) + 2 * 0.5) / (fwn + 2)
    F["r1_l"] = (T[tag + "_r1_l"].to_numpy(float) + 2 * 0.5) / (fln + 2)
    age = T[tag + "_age"].to_numpy(float)
    F["age"] = np.where(np.isnan(age), 30.0, age)
    F["age30"] = np.maximum(0.0, F["age"] - 30.0)
    F["n_all"] = na
    F["n5"] = T[tag + "_n5"].to_numpy(float)
    F["ko_losses"] = T[tag + "_ko_losses"].to_numpy(float)
    F["kd_abs"] = C[:, KI["okd"]]
    F["elo"] = T[tag + "_elo"].to_numpy(float)
    F["opp_elo"] = T[tag + "_opp_elo"].fillna(1500).to_numpy(float)
    lay = T[tag + "_layoff"].to_numpy(float)
    F["layoff"] = np.where(np.isnan(lay), 365.0, lay)
    last = T[tag + "_last"].to_numpy()
    F["last_ko_l"] = (last == "L_KO").astype(float)
    F["last_fin_l"] = np.isin(last, ["L_KO", "L_SUB"]).astype(float)
    F["last_fin_w"] = np.isin(last, ["W_KO", "W_SUB"]).astype(float)
    F["streak"] = T[tag + "_streak"].to_numpy(float)
    F["height"] = T[tag + "_height"].to_numpy(float)
    F["reach"] = T[tag + "_reach"].to_numpy(float)
    F["south"] = (T[tag + "_stance"].to_numpy() == "Southpaw").astype(float)
    F["min_S"] = m
    F["n_S"] = n
    # career (undecayed) versions of the finishing and grappling rates: a long career's old evidence
    gc = lambda k: C[:, KI[k]]
    mc = gc("min")
    csig = gc("d_lnd") + gc("c_lnd") + gc("g_lnd")
    cosig = gc("od_lnd") + gc("oc_lnd") + gc("og_lnd")
    F["cs_sub15"] = 15 * (gc("sub_att") + km * p("sub_att")) / (mc + km)
    F["cs_osub15"] = 15 * (gc("osub_att") + km * p("sub_att")) / (mc + km)
    F["cs_td15"] = 15 * (gc("td_lnd") + km * p("td_lnd")) / (mc + km)
    F["cs_otd15"] = 15 * (gc("otd_lnd") + km * p("td_lnd")) / (mc + km)
    F["cs_ctrl"] = (gc("ctrl") + km * p("ctrl")) / (mc + km)
    F["cs_octrl"] = (gc("octrl") + km * p("ctrl")) / (mc + km)
    F["cs_kd15"] = 15 * (gc("kd") + km * p("kd")) / (mc + km)
    F["cs_okd15"] = 15 * (gc("okd") + km * p("kd")) / (mc + km)
    F["cs_slpm"] = (csig + km * p_sig) / (mc + km)
    F["cs_sapm"] = (cosig + km * p_sig) / (mc + km)
    F["cs_subw"] = (gc("sub_w") + kf * pf("sub_w")) / (gc("n") + kf)
    F["cs_kow"] = (gc("ko_w") + kf * pf("ko_w")) / (gc("n") + kf)
    return F


def lg(x, eps=1e-4):
    return np.log(np.maximum(x, eps))


def logit(p, eps=1e-4):
    p = np.clip(p, eps, 1 - eps)
    return np.log(p / (1 - p))


CS_KEYS = ["cs_sub15", "cs_osub15", "cs_td15", "cs_otd15", "cs_ctrl", "cs_octrl", "cs_kd15", "cs_okd15", "cs_slpm",
           "cs_sapm", "cs_subw", "cs_kow"]


def add_market_features(T, FX, FY, pm):
    """Closing-line log-odds for X (Elo-implied where no line exists) and its absolute value."""
    elo_l = ((T["A_elo"] - T["B_elo"]) / 400.0 * np.log(10)).to_numpy()
    ml = np.where(pm.notna().to_numpy(), logit(pm.fillna(0.5).to_numpy(), 1e-3), elo_l)
    FX["mk"], FY["mk"] = ml, -ml
    FX["mk_a"] = FY["mk_a"] = np.abs(ml)
    return FX, FY


def build_features(T, PR, sh=None):
    """Directional design for orientation X=A, Y=B and its mirror (X=B, Y=A).
    Returns (FX, FY) where FX[i] describes fight i from A's side; FY from B's side. Columns are identical."""
    sh = sh or SHRINK
    SA, SB = side_features(T, PR, "A", sh), side_features(T, PR, "B", sh)
    p = lambda k: PR[k].to_numpy()
    p_sig = p("d_lnd") + p("c_lnd") + p("g_lnd")
    lbs = PR["lbs"].to_numpy()
    women = T["division"].isin(WOMEN).to_numpy() | T["prior_div"].isin(WOMEN).to_numpy()
    common = {
        "lbs": (lbs - 160) / 50.0,
        "hw": (lbs >= 250).astype(float),
        "women": women.astype(float),
        "r5": (T["rounds"].to_numpy() == 5).astype(float),
        "title": T["title"].to_numpy().astype(float),
        "catch": T["division"].isin(B.NON_DIV).to_numpy().astype(float),
        "yr": (T["year"].to_numpy() - 2016) / 10.0,
        "lg_ko": logit((p("ko_w")) / p("n") * 2),     # league P(KO) per fight in the bout's division (prior window)
        "lg_sub": logit((p("sub_w")) / p("n") * 2),
        "lg_mpf": lg(p("mpf")),
    }

    def direction(X, Y):
        D = {}
        # own-side (attacker) and opponent-side (defender) profile, as logs where rates
        for k in ("ko_w_pf", "sub_w_pf", "ko_w_pm", "sub_w_pm", "kd15", "pow", "slpm", "hlpm", "acc", "td15",
                  "tda15", "td_acc", "ctrl", "gnd", "sub15", "sub_conv", "c_ko_w", "c_sub_w", "att_pm",
                  "leg_share"):
            D["x_" + k] = lg(X[k])
        for k in ("ko_l_pf", "sub_l_pf", "ko_l_pm", "sub_l_pm", "okd15", "chin", "sapm", "hapm", "oacc", "otd15",
                  "otd_acc", "octrl", "ognd", "osub15", "sub_def", "c_ko_l", "c_sub_l"):
            D["y_" + k] = lg(Y[k])
        # attacker's own defence and defender's own offence (both matter: wars, counters, reversals)
        for k in ("ko_l_pf", "sub_l_pf", "okd15", "chin", "sapm", "otd15", "osub15"):
            D["x_" + k] = lg(X[k])
        for k in ("ko_w_pf", "sub_w_pf", "kd15", "pow", "slpm", "td15", "sub15"):
            D["y_" + k] = lg(Y[k])
        # symmetric fight-length tendencies
        D["s_dec"] = logit(X["dec_pf"]) + logit(Y["dec_pf"])
        D["s_cdec"] = logit(X["c_dec"]) + logit(Y["c_dec"])
        D["s_mpf"] = lg(X["mpf"]) + lg(Y["mpf"])
        D["s_cmpf"] = lg(X["c_mpf"]) + lg(Y["c_mpf"])
        # log5-style matchup intensities (attacker x defender / league)
        D["m_ko_pm"] = lg(X["ko_w_pm"]) + lg(Y["ko_l_pm"]) - lg(15 * p("ko_w"))
        D["m_sub_pm"] = lg(X["sub_w_pm"]) + lg(Y["sub_l_pm"]) - lg(15 * p("sub_w"))
        D["m_kd"] = lg(X["kd15"]) + lg(Y["okd15"]) - lg(15 * p("kd"))
        D["m_pow"] = lg(X["pow"]) + lg(Y["chin"]) - lg(p("kd_per_h"))
        D["m_str"] = lg(X["slpm"]) + lg(Y["sapm"]) - lg(p_sig)
        D["m_td"] = lg(X["td15"]) + lg(Y["otd15"]) - lg(15 * p("td_lnd"))
        D["m_ctrl"] = lg(X["ctrl"]) + lg(Y["octrl"]) - lg(p("ctrl") / 60)
        D["m_gnd"] = lg(X["gnd"]) + lg(Y["ognd"]) - lg(p("g_lnd"))
        D["m_subatt"] = lg(X["sub15"]) + lg(Y["osub15"]) - lg(15 * p("sub_att"))
        D["m_subcv"] = logit(X["sub_conv"]) + logit(Y["sub_def"]) - logit(p("sub_conv"))
        # experience, age, durability
        D["x_age30"], D["y_age30"] = X["age30"], Y["age30"]
        D["x_age"], D["y_age"] = (X["age"] - 30) / 5, (Y["age"] - 30) / 5
        D["x_nlog"], D["y_nlog"] = np.log1p(X["n_all"]), np.log1p(Y["n_all"])
        D["x_kol"], D["y_kol"] = np.log1p(X["ko_losses"]), np.log1p(Y["ko_losses"])
        D["y_kol_age"] = np.log1p(Y["ko_losses"]) * Y["age30"] / 5
        D["x_kdabs"], D["y_kdabs"] = np.log1p(X["kd_abs"]), np.log1p(Y["kd_abs"])
        D["x_lay"], D["y_lay"] = np.log1p(X["layoff"] / 30), np.log1p(Y["layoff"] / 30)
        D["x_lastkol"], D["y_lastkol"] = X["last_ko_l"], Y["last_ko_l"]
        D["x_lastfinw"], D["y_lastfinw"] = X["last_fin_w"], Y["last_fin_w"]
        D["x_streak"], D["y_streak"] = np.clip(X["streak"], -4, 6) / 3, np.clip(Y["streak"], -4, 6) / 3
        D["x_fint"], D["y_fint"] = lg(X["fin_t_w"]), lg(Y["fin_t_l"])
        D["x_r1"], D["y_r1"] = logit(X["r1_w"]), logit(Y["r1_l"])
        D["x_cwin"], D["y_cwin"] = logit(X["c_win"]), logit(Y["c_win"])
        # strength
        D["d_elo"] = (X["elo"] - Y["elo"]) / 100.0
        D["a_elo"] = np.abs(D["d_elo"])
        D["d_oppelo"] = (X["opp_elo"] - Y["opp_elo"]) / 100.0
        hgt = X["height"] - Y["height"]
        rch = X["reach"] - Y["reach"]
        D["d_height"] = np.where(np.isnan(hgt), 0.0, hgt) / 3
        D["d_reach"] = np.where(np.isnan(rch), np.where(np.isnan(hgt), 0.0, hgt), rch) / 3
        D["d_age"] = (X["age"] - Y["age"]) / 5
        D["oppst"] = ((X["south"] + Y["south"]) == 1).astype(float)
        for k, v in common.items():
            D[k] = v
        D["x_lowdata"] = 1.0 / (1.0 + X["n_S"])
        D["y_lowdata"] = 1.0 / (1.0 + Y["n_S"])
        for k in CS_KEYS:
            D["x_" + k] = lg(X[k])
            D["y_" + k] = lg(Y[k])
        return pd.DataFrame(D, index=T.index)

    return direction(SA, SB), direction(SB, SA), SA, SB


# ============================================================== 3. outcome space and metrics
R5 = 5
NC_ = 4 * R5 + 3                     # cells: XKO r1..5, XSUB r1..5, YKO r1..5, YSUB r1..5, XDEC, YDEC, DRAW
I_XKO, I_XSUB, I_YKO, I_YSUB = 0, R5, 2 * R5, 3 * R5
I_XDEC, I_YDEC, I_DRAW = 4 * R5, 4 * R5 + 1, 4 * R5 + 2
C6 = ["XKO", "XSUB", "XDEC", "YDEC", "YSUB", "YKO"]


def outcome_cells(T):
    """Observed cell (orientation X = A) per fight; -1 when excluded (DQ / NC / unknown)."""
    y = np.full(len(T), -1)
    for i, (cls, w, r, R) in enumerate(zip(T["cls"], T["winner"], T["rnd"], T["rounds"])):
        if cls == "DRAW":
            y[i] = I_DRAW
        elif cls == "DEC":
            y[i] = I_XDEC if w == "A" else I_YDEC
        elif cls in ("KO", "SUB"):
            r = int(min(max(r, 1), R5))
            base = {("A", "KO"): I_XKO, ("A", "SUB"): I_XSUB, ("B", "KO"): I_YKO, ("B", "SUB"): I_YSUB}[(w, cls)]
            y[i] = base + r - 1
    return y


def mirror_cells(P):
    """Swap the roles of X and Y in a joint array (n x NC_)."""
    Q = np.empty_like(P)
    Q[:, I_XKO:I_XKO + R5], Q[:, I_YKO:I_YKO + R5] = P[:, I_YKO:I_YKO + R5], P[:, I_XKO:I_XKO + R5]
    Q[:, I_XSUB:I_XSUB + R5], Q[:, I_YSUB:I_YSUB + R5] = P[:, I_YSUB:I_YSUB + R5], P[:, I_XSUB:I_XSUB + R5]
    Q[:, I_XDEC], Q[:, I_YDEC], Q[:, I_DRAW] = P[:, I_YDEC], P[:, I_XDEC], P[:, I_DRAW]
    return Q


def marginals(P):
    """Named marginals of a joint (orientation X = A)."""
    xko, xsub = P[:, I_XKO:I_XKO + R5], P[:, I_XSUB:I_XSUB + R5]
    yko, ysub = P[:, I_YKO:I_YKO + R5], P[:, I_YSUB:I_YSUB + R5]
    M = {"XKO": xko.sum(1), "XSUB": xsub.sum(1), "XDEC": P[:, I_XDEC], "DRAW": P[:, I_DRAW],
         "YDEC": P[:, I_YDEC], "YSUB": ysub.sum(1), "YKO": yko.sum(1)}
    M["KO"] = M["XKO"] + M["YKO"]
    M["SUB"] = M["XSUB"] + M["YSUB"]
    M["DEC"] = M["XDEC"] + M["YDEC"] + M["DRAW"]
    M["FIN"] = M["KO"] + M["SUB"]
    M["ko_r"] = xko + yko
    M["sub_r"] = xsub + ysub
    M["fin_r"] = M["ko_r"] + M["sub_r"]
    M["pA"] = M["XKO"] + M["XSUB"] + M["XDEC"]
    M["pB"] = M["YKO"] + M["YSUB"] + M["YDEC"]
    return M


EPS = 1e-9


def per_fight_losses(P, y, T):
    """Per-fight negative log likelihoods for every scored target (nan where a target does not apply)."""
    P = np.clip(P, EPS, None)
    P = P / P.sum(1, keepdims=True)
    M = marginals(P)
    n = len(y)
    ok = y >= 0
    L = {}
    L["joint"] = np.where(ok, -np.log(P[np.arange(n), np.maximum(y, 0)]), np.nan)
    is_ko = ((y >= I_XKO) & (y < I_XKO + R5)) | ((y >= I_YKO) & (y < I_YKO + R5))
    is_sub = ((y >= I_XSUB) & (y < I_XSUB + R5)) | ((y >= I_YSUB) & (y < I_YSUB + R5))
    is_dec = (y == I_XDEC) | (y == I_YDEC) | (y == I_DRAW)
    p_obs3 = np.where(is_ko, M["KO"], np.where(is_sub, M["SUB"], M["DEC"]))
    L["method3"] = np.where(ok, -np.log(p_obs3), np.nan)
    L["finish"] = np.where(ok, -np.log(np.where(is_dec, M["DEC"], M["FIN"])), np.nan)
    b7 = np.select([(y >= I_XKO) & (y < I_XKO + R5), (y >= I_XSUB) & (y < I_XSUB + R5), y == I_XDEC, y == I_DRAW,
                    y == I_YDEC, (y >= I_YSUB) & (y < I_YSUB + R5), (y >= I_YKO) & (y < I_YKO + R5)],
                   [M["XKO"], M["XSUB"], M["XDEC"], M["DRAW"], M["YDEC"], M["YSUB"], M["YKO"]], 1.0)
    L["bin7"] = np.where(ok, -np.log(b7), np.nan)
    # unsided method x round (KO r, SUB r, decision incl. draw)
    rr = np.where(is_ko | is_sub, (y % R5), 0)
    p_mr = np.where(is_ko, M["ko_r"][np.arange(n), rr], np.where(is_sub, M["sub_r"][np.arange(n), rr], M["DEC"]))
    L["method_round"] = np.where(ok, -np.log(p_mr), np.nan)
    # finishing round given a finish (3- or 5-round)
    fin = ok & (is_ko | is_sub)
    p_r = M["fin_r"][np.arange(n), rr] / M["FIN"]
    L["round_given_fin"] = np.where(fin, -np.log(p_r), np.nan)
    # method given a finish (KO vs SUB)
    L["ko_vs_sub"] = np.where(fin, -np.log(np.where(is_ko, M["KO"], M["SUB"]) / M["FIN"]), np.nan)
    # winner, decisive fights only (draws / NC excluded), draw mass removed
    dec_ok = ok & (y != I_DRAW)
    a_won = ((y >= I_XKO) & (y < I_XSUB + R5)) | (y == I_XDEC)
    pa = M["pA"] / (M["pA"] + M["pB"])
    L["winner"] = np.where(dec_ok, -np.log(np.where(a_won, pa, 1 - pa)), np.nan)
    L["winner_brier"] = np.where(dec_ok, (pa - a_won) ** 2, np.nan)
    # method given the actual winner (decisive fights): what a winner ensemble would take from this model
    p_cell_m = np.where(is_dec, np.where(a_won, M["XDEC"], M["YDEC"]),
                        np.where(is_ko, np.where(a_won, M["XKO"], M["YKO"]), np.where(a_won, M["XSUB"], M["YSUB"])))
    L["method_given_winner"] = np.where(dec_ok, -np.log(p_cell_m / np.where(a_won, M["pA"], M["pB"])), np.nan)
    L["winner_acc"] = np.where(dec_ok, np.where(np.abs(pa - 0.5) < 1e-9, 0.5, ((pa > 0.5) == a_won) * 1.0), np.nan)
    # Brier for the 3-class method
    o3 = np.stack([is_ko, is_sub, is_dec], 1).astype(float)
    p3 = np.stack([M["KO"], M["SUB"], M["DEC"]], 1)
    L["method3_brier"] = np.where(ok, ((p3 - o3) ** 2).sum(1), np.nan)
    return L


def summarize_losses(L):
    return {k: float(np.nanmean(v)) for k, v in L.items()}


# ============================================================== 4. models
from scipy.optimize import minimize  # noqa: E402


class StandardScaler:
    def fit(self, X):
        self.mean_ = X.mean(0)
        sd = X.std(0)
        self.scale_ = np.where(sd > 1e-9, sd, 1.0)
        return self

    def transform(self, X):
        return (X - self.mean_) / self.scale_


class LogisticRegression:
    """Multinomial (or binary) logit with an L2 penalty on standardized slopes, fit by L-BFGS.
    Objective: sum_i w_i * NLL_i / sum_i w_i + 1 / (2 C n_eff) * |W|^2, so C plays the sklearn role scaled
    per observation. Intercepts are not penalized. Columns listed in `free` (e.g. baseline-hazard dummies)
    are not penalized either."""

    def __init__(self, C=1.0, max_iter=2000, tol=1e-7, fit_intercept=True, free=None):
        self.C, self.max_iter, self.tol, self.fit_intercept, self.free = C, max_iter, tol, fit_intercept, free

    def fit(self, X, y, sample_weight=None):
        X = np.asarray(X, float)
        y = np.asarray(y)
        self.classes_ = np.unique(y)
        k = len(self.classes_)
        Y = (y[:, None] == self.classes_[None, :]).astype(float)
        w = np.ones(len(y)) if sample_weight is None else np.asarray(sample_weight, float)
        w = w / w.sum()
        n, d = X.shape
        pen = np.ones(d)
        if self.free is not None:
            pen[np.asarray(self.free)] = 0.0
        lam = 1.0 / (self.C * len(y))
        fi = 1 if self.fit_intercept else 0

        def f(theta):
            W = theta.reshape(d + fi, k)
            Z = X @ W[:d]
            if fi:
                Z = Z + W[d]
            Z = Z - Z.max(1, keepdims=True)
            E = np.exp(Z)
            s = E.sum(1)
            P = E / s[:, None]
            nll = (w * (np.log(s) - (Z * Y).sum(1))).sum()
            R = (P - Y) * w[:, None]
            G = np.empty_like(W)
            G[:d] = X.T @ R + lam * pen[:, None] * W[:d]
            if fi:
                G[d] = R.sum(0)
            return nll + 0.5 * lam * (pen[:, None] * W[:d] ** 2).sum(), G.ravel()

        th0 = np.zeros((d + fi) * k)
        if fi:
            th0.reshape(d + fi, k)[d] = np.log(np.maximum(Y.T @ w, 1e-6))
        r = minimize(f, th0, jac=True, method="L-BFGS-B", options={"maxiter": self.max_iter, "gtol": self.tol})
        W = r.x.reshape(d + fi, k)
        # identify: centre the class columns (softmax is invariant to a common shift)
        W = W - W.mean(1, keepdims=True)
        self.coef_ = W[:d].T.copy()
        self.intercept_ = W[d].copy() if fi else np.zeros(k)
        self.n_iter_ = r.nit
        return self

    def decision_function(self, X):
        return np.asarray(X, float) @ self.coef_.T + self.intercept_

    def predict_proba(self, X):
        Z = self.decision_function(X)
        Z = Z - Z.max(1, keepdims=True)
        E = np.exp(Z)
        return E / E.sum(1, keepdims=True)


def recency_weights(years, ref_year, hl_years):
    if not hl_years:
        return np.ones(len(years))
    return 0.5 ** ((ref_year - np.asarray(years, float)) / hl_years)


def baseline_joint(T, priors, k_shrink=50.0, elo=False):
    """Division x scheduled-rounds base rates from the five years before the fight's year (priors_asof),
    shrunk toward the all-division rates for the same format; winner 50/50 or split by pre-fight Elo."""
    P = np.zeros((len(T), NC_))
    for i, (y, d, R) in enumerate(zip(T["year"], T["prior_div"], T["rounds"])):
        R = 5 if R == 5 else 3
        allp = priors[y]["ALL"]["fin%d" % R]
        dv = (priors[y].get(d) or priors[y]["ALL"]).get("fin%d" % R) or allp
        n = dv["n"] if dv is not allp else 0
        w = n / (n + k_shrink) if k_shrink else 1.0
        mix = lambda key: w * np.asarray(dv[key], float) + (1 - w) * np.asarray(allp[key], float)
        ko, sub = mix("KO"), mix("SUB")
        dec, draw = float(mix("DEC")), float(mix("DRAW"))
        tot = ko.sum() + sub.sum() + dec + draw
        pa = 0.5
        if elo:
            pa = 1.0 / (1.0 + 10 ** ((T["B_elo"].iat[i] - T["A_elo"].iat[i]) / 400.0))
        P[i, I_XKO:I_XKO + R] = ko / tot * pa
        P[i, I_YKO:I_YKO + R] = ko / tot * (1 - pa)
        P[i, I_XSUB:I_XSUB + R] = sub / tot * pa
        P[i, I_YSUB:I_YSUB + R] = sub / tot * (1 - pa)
        P[i, I_XDEC] = dec / tot * pa
        P[i, I_YDEC] = dec / tot * (1 - pa)
        P[i, I_DRAW] = draw / tot
    return P


def round_design(R, r):
    """Baseline-hazard dummies: separate round shapes for 3- and 5-round bouts."""
    d = np.zeros(8)
    d[(r - 1) if R == 3 else 3 + (r - 1)] = 1.0
    return d


ROUND_COLS = ["h3_r1", "h3_r2", "h3_r3", "h5_r1", "h5_r2", "h5_r3", "h5_r4", "h5_r5"]


class HazardModel:
    """Discrete-time competing risks: per round, P(no finish), P(X KO), P(X SUB), P(Y KO), P(Y SUB) by a
    multinomial logit on fight features + round dummies (+ optional round-slope interactions); fights that
    reach the final bell go to a decision-winner logit. Trained on both orientations of every fight."""

    def __init__(self, cols, C=0.05, C_dec=0.05, slope_cols=(), hl_years=None):
        self.cols, self.C, self.C_dec, self.slope_cols, self.hl = list(cols), C, C_dec, list(slope_cols), hl_years

    def _rows(self, F, R, r):
        base = F[self.cols].to_numpy(float)
        rd = np.stack([round_design(RR, rr) for RR, rr in zip(R, r)])
        sl = F[self.slope_cols].to_numpy(float) * ((np.asarray(r, float) - 1) / 2)[:, None] if self.slope_cols \
            else np.zeros((len(F), 0))
        return np.hstack([base, sl, rd])

    def fit(self, T, FX, FY, y):
        ok = y >= 0
        T, FX, FY, y = T[ok], FX[ok], FY[ok], y[ok]
        w0 = recency_weights(T["year"], T["year"].max() + 1, self.hl)
        Rs = np.where(T["rounds"].to_numpy() == 5, 5, 3)
        Xs, ys, ws, idx_f, idx_r = [], [], [], [], []
        for orient, F in ((0, FX), (1, FY)):
            yy = y if orient == 0 else mirror_index(y)
            for i in range(len(T)):
                R = Rs[i]
                c = yy[i]
                if c in (I_XDEC, I_YDEC, I_DRAW):
                    last, cls = R, 0
                else:
                    grp, rr = c // R5, c % R5 + 1
                    last, cls = min(rr, R), {0: 1, 1: 2, 2: 3, 3: 4}[grp]
                for r in range(1, last + 1):
                    idx_f.append((orient, i))
                    idx_r.append((R, r))
                    ys.append(cls if r == last else 0)
                    ws.append(w0[i])
        # assemble design in blocks
        rows_o = np.array([o for o, _ in idx_f])
        rows_i = np.array([i for _, i in idx_f])
        RR = np.array([a for a, _ in idx_r])
        rr = np.array([b for _, b in idx_r])
        Fall = pd.concat([FX.reset_index(drop=True), FY.reset_index(drop=True)], ignore_index=True)
        take = rows_i + rows_o * len(T)
        X = self._rows(Fall.iloc[take].reset_index(drop=True), RR, rr)
        nb = X.shape[1] - 8
        self.scaler = StandardScaler().fit(X[:, :nb])
        X[:, :nb] = self.scaler.transform(X[:, :nb])
        self.lr = LogisticRegression(C=self.C, free=list(range(nb, X.shape[1])), fit_intercept=False)
        self.lr.fit(X, np.array(ys), sample_weight=np.array(ws))
        # decision winner (X wins | decision), both orientations, draws excluded
        dmask = (y == I_XDEC) | (y == I_YDEC)
        Xd = np.vstack([FX[dmask][self.cols].to_numpy(float), FY[dmask][self.cols].to_numpy(float)])
        yd = np.concatenate([(y[dmask] == I_XDEC), (y[dmask] == I_YDEC)]).astype(int)
        wd = np.concatenate([w0[dmask], w0[dmask]])
        self.dscaler = StandardScaler().fit(Xd)
        self.dlr = LogisticRegression(C=self.C_dec, fit_intercept=False)
        self.dlr.fit(self.dscaler.transform(Xd), yd, sample_weight=wd)
        ndec = dmask.sum()
        self.draw_c = float(((y == I_DRAW).sum() + 0.5) / (ndec + (y == I_DRAW).sum() + 1))
        return self

    def _predict_one(self, T, F):
        n = len(T)
        Rs = np.where(T["rounds"].to_numpy() == 5, 5, 3)
        P = np.zeros((n, NC_))
        S = np.ones(n)
        classes = list(self.lr.classes_)
        for r in range(1, 6):
            act = Rs >= r
            if not act.any():
                break
            X = self._rows(F[act], Rs[act], np.full(act.sum(), r))
            nb = X.shape[1] - 8
            X[:, :nb] = self.scaler.transform(X[:, :nb])
            h = self.lr.predict_proba(X)
            H = np.zeros((act.sum(), 5))
            for j, c in enumerate(classes):
                H[:, c] = h[:, j]
            Sa = S[act]
            idx = np.where(act)[0]
            P[idx, I_XKO + r - 1] = Sa * H[:, 1]
            P[idx, I_XSUB + r - 1] = Sa * H[:, 2]
            P[idx, I_YKO + r - 1] = Sa * H[:, 3]
            P[idx, I_YSUB + r - 1] = Sa * H[:, 4]
            S[idx] = Sa * H[:, 0]
        q = self.dlr.predict_proba(self.dscaler.transform(F[self.cols].to_numpy(float)))[:, 1]
        P[:, I_XDEC] = S * q * (1 - self.draw_c)
        P[:, I_YDEC] = S * (1 - q) * (1 - self.draw_c)
        P[:, I_DRAW] = S * self.draw_c
        return P

    def predict(self, T, FX, FY):
        return 0.5 * (self._predict_one(T, FX) + mirror_cells(self._predict_one(T, FY)))


def mirror_index(y):
    """Observed cell index under the X/Y swap."""
    out = y.copy()
    for a, b in ((I_XKO, I_YKO), (I_XSUB, I_YSUB)):
        ma = (y >= a) & (y < a + R5)
        mb = (y >= b) & (y < b + R5)
        out[ma] = y[ma] - a + b
        out[mb] = y[mb] - b + a
    out[y == I_XDEC] = I_YDEC
    out[y == I_YDEC] = I_XDEC
    return out


def cells_to_c6(y):
    """Joint cell -> 6-class label (XKO, XSUB, XDEC, YDEC, YSUB, YKO); -1 for draws/excluded."""
    c = np.full(len(y), -1)
    c[(y >= I_XKO) & (y < I_XKO + R5)] = 0
    c[(y >= I_XSUB) & (y < I_XSUB + R5)] = 1
    c[y == I_XDEC] = 2
    c[y == I_YDEC] = 3
    c[(y >= I_YSUB) & (y < I_YSUB + R5)] = 4
    c[(y >= I_YKO) & (y < I_YKO + R5)] = 5
    return c


def c6_mirror(P6):
    return P6[:, ::-1]


def joint_from_c6(P6, H, draw_c):
    """Spread a 6-class distribution over rounds with the hazard model's conditional round shapes."""
    P = np.zeros((len(P6), NC_))
    for j, base in ((0, I_XKO), (1, I_XSUB), (5, I_YKO), (4, I_YSUB)):
        shape = H[:, base:base + R5]
        shape = shape / np.maximum(shape.sum(1, keepdims=True), 1e-12)
        P[:, base:base + R5] = P6[:, [j]] * shape
    P[:, I_XDEC] = P6[:, 2] * (1 - draw_c)
    P[:, I_YDEC] = P6[:, 3] * (1 - draw_c)
    P[:, I_DRAW] = (P6[:, 2] + P6[:, 3]) * draw_c
    return P


def joint_to_c6(P):
    M = marginals(P)
    d = M["XDEC"] + M["YDEC"] + M["DRAW"]
    xs = M["XDEC"] / np.maximum(M["XDEC"] + M["YDEC"], 1e-12)
    return np.stack([M["XKO"], M["XSUB"], d * xs, d * (1 - xs), M["YSUB"], M["YKO"]], 1)


class C6Logit:
    """Multinomial logit over the six who-and-how outcomes, both orientations, averaged at prediction."""

    def __init__(self, cols, C=0.05, hl_years=None):
        self.cols, self.C, self.hl = list(cols), C, hl_years

    def fit(self, T, FX, FY, y):
        c = cells_to_c6(y)
        ok = c >= 0
        w0 = recency_weights(T["year"][ok], T["year"].max() + 1, self.hl)
        X = np.vstack([FX[ok][self.cols].to_numpy(float), FY[ok][self.cols].to_numpy(float)])
        yy = np.concatenate([c[ok], 5 - c[ok]])
        self.scaler = StandardScaler().fit(X)
        self.lr = LogisticRegression(C=self.C)
        self.lr.fit(self.scaler.transform(X), yy, sample_weight=np.concatenate([w0, w0]))
        return self

    def predict6(self, T, FX, FY):
        pa = self.lr.predict_proba(self.scaler.transform(FX[self.cols].to_numpy(float)))
        pb = self.lr.predict_proba(self.scaler.transform(FY[self.cols].to_numpy(float)))
        return 0.5 * (pa + c6_mirror(pb))


class C6GBM:
    """LightGBM multiclass over the six outcomes; same orientation averaging."""

    def __init__(self, cols, params=None, rounds=300, hl_years=None):
        self.cols, self.hl, self.rounds = list(cols), hl_years, rounds
        self.params = dict(objective="multiclass", num_class=6, learning_rate=0.03, num_leaves=7,
                           min_data_in_leaf=60, feature_fraction=0.6, bagging_fraction=0.8, bagging_freq=1,
                           lambda_l2=10.0, verbose=-1, num_threads=1, seed=7)
        if params:
            self.params.update(params)

    def fit(self, T, FX, FY, y):
        import lightgbm as lgb
        c = cells_to_c6(y)
        ok = c >= 0
        w0 = recency_weights(T["year"][ok], T["year"].max() + 1, self.hl)
        X = np.vstack([FX[ok][self.cols].to_numpy(float), FY[ok][self.cols].to_numpy(float)])
        yy = np.concatenate([c[ok], 5 - c[ok]])
        ds = lgb.Dataset(X, yy, weight=np.concatenate([w0, w0]), free_raw_data=False)
        self.m = lgb.train(self.params, ds, num_boost_round=self.rounds)
        return self

    def predict6(self, T, FX, FY):
        pa = self.m.predict(FX[self.cols].to_numpy(float))
        pb = self.m.predict(FY[self.cols].to_numpy(float))
        return 0.5 * (pa + c6_mirror(pb))


# ============================================================== 5. market inputs (benchmark and optional feature)
MARKET_JSON = os.path.join(ROOT, "data", "derived", "market.json")
NLBAIR = os.path.join(ROOT, "data", "raw", "odds", "nlbair_odds.csv")


def am_to_dec(a):
    a = np.asarray(a, float)
    return np.where(a > 0, 1 + a / 100.0, 1 + 100.0 / np.abs(a))


def power_devig(dA, dB):
    """Power margin removal for a two-way line: find k with (1/dA)^k + (1/dB)^k = 1; returns p_A."""
    qa, qb = 1.0 / dA, 1.0 / dB
    lo, hi = 0.5, 3.0
    for _ in range(60):
        k = 0.5 * (lo + hi)
        s = qa ** k + qb ** k
        lo, hi = (k, hi) if s > 1 else (lo, k)
    k = 0.5 * (lo + hi)
    return qa ** k


def _nm(s):
    import unicodedata
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()
    return "".join(ch for ch in s if ch.isalnum() or ch == " ").split()


def _same(a, b):
    import difflib
    ta, tb = _nm(a), _nm(b)
    if not ta or not tb:
        return 0.0
    return max(difflib.SequenceMatcher(None, " ".join(ta), " ".join(tb)).ratio(),
               1.0 if ta[-1] == tb[-1] and ta[0][0] == tb[0][0] else 0.0)


def load_market(T):
    """Pre-fight closing moneyline P(A wins) per fight (power de-vig): data/derived/market.json (2019+,
    consensus close, oriented A/B) else nlbair/ufc-data closing-range midpoints (2013+, keyed by the
    ufcstats fight id, orientation by name). Also the market's method / round props where market.json has
    them (US books on BestFightOdds, about 2021 on). Closing lines are known only minutes before the
    fight: the market variant is a live/stacking model, never a pre-fight-week forecast."""
    pm = pd.Series(np.nan, index=T.index)
    src = pd.Series("", index=T.index)
    m6 = {}
    rd = {}
    pdec = {}
    pos = {fid: i for i, fid in zip(T.index, T["id"])}
    if os.path.exists(MARKET_JSON):
        mk = json.load(open(MARKET_JSON))["fights"]
        for fid, v in mk.items():
            i = pos.get(fid)
            if i is None:
                continue
            cd = v.get("close_dec")
            if cd and cd[0] and cd[1] and cd[0] > 1 and cd[1] > 1:
                pm[i] = power_devig(cd[0], cd[1])
                src[i] = "market.json"
            if v.get("method6"):
                m6[i] = v["method6"]
            if v.get("round_dist"):
                rd[i] = v["round_dist"]
            if v.get("p_dec") is not None:
                pdec[i] = v["p_dec"]
    if os.path.exists(NLBAIR):
        nb = pd.read_csv(NLBAIR)
        nb = nb[nb["f1_close_low"].notna() & nb["f2_close_low"].notna()]
        for r in nb.itertuples(index=False):
            i = pos.get(r.fight_id)
            if i is None or not np.isnan(pm[i]):
                continue
            d1 = 0.5 * (am_to_dec(r.f1_close_low) + am_to_dec(r.f1_close_high))
            d2 = 0.5 * (am_to_dec(r.f2_close_low) + am_to_dec(r.f2_close_high))
            if not (d1 > 1 and d2 > 1):
                continue
            p1 = float(power_devig(d1, d2))
            a = T.at[i, "A_name"]
            flip = _same(a, r.f2_name) > _same(a, r.f1_name)
            pm[i] = 1 - p1 if flip else p1
            src[i] = "nlbair"
    return pm, src, m6, rd, pdec


def market_joint(T, m6, rd, draw_c):
    """The market's own joint over the outcome cells (where method props exist): method6 spread over rounds
    by the round props' finish-round shape (or the division base-rate shape when absent)."""
    idx = sorted(m6)
    P = np.full((len(T), NC_), np.nan)
    for i in idx:
        a_ko, a_sub, a_dec, b_ko, b_sub, b_dec = m6[i]
        R = 5 if T.at[i, "rounds"] == 5 else 3
        shape = None
        if i in rd and len(rd[i]) == R + 1:
            fr = np.asarray(rd[i][:R], float)
            if fr.sum() > 0:
                shape = fr / fr.sum()
        if shape is None:
            shape = np.array([0.5, 0.33, 0.17]) if R == 3 else np.array([0.36, 0.26, 0.18, 0.12, 0.08])
        row = np.zeros(NC_)
        row[I_XKO:I_XKO + R] = a_ko * shape
        row[I_XSUB:I_XSUB + R] = a_sub * shape
        row[I_YKO:I_YKO + R] = b_ko * shape
        row[I_YSUB:I_YSUB + R] = b_sub * shape
        row[I_XDEC] = a_dec * (1 - draw_c)
        row[I_YDEC] = b_dec * (1 - draw_c)
        row[I_DRAW] = (a_dec + b_dec) * draw_c
        P[T.index.get_loc(i)] = row / row.sum()
    return P


class FactorModel:
    """Factorized who-and-how: P(X wins) by a symmetric binary logit, then P(KO, SUB, DEC | X wins) by a
    3-class logit oriented on the winner. Lets the method part carry its own features and penalty."""

    def __init__(self, win_cols, meth_cols, C_win=0.002, C_meth=0.002, hl_years=None):
        self.wc, self.mc, self.Cw, self.Cm, self.hl = list(win_cols), list(meth_cols), C_win, C_meth, hl_years

    def fit(self, T, FX, FY, y):
        c = cells_to_c6(y)
        ok = c >= 0
        w0 = recency_weights(T["year"][ok], T["year"].max() + 1, self.hl)
        a_won = np.isin(c[ok], [0, 1, 2])
        Xw = np.vstack([FX[ok][self.wc].to_numpy(float), FY[ok][self.wc].to_numpy(float)])
        yw = np.concatenate([a_won, ~a_won]).astype(int)
        self.ws = StandardScaler().fit(Xw)
        self.wl = LogisticRegression(C=self.Cw, fit_intercept=False).fit(self.ws.transform(Xw), yw,
                                                                        sample_weight=np.concatenate([w0, w0]))
        # method given the winner: rows oriented with X = winner
        FW = np.where(a_won[:, None], FX[ok][self.mc].to_numpy(float), FY[ok][self.mc].to_numpy(float))
        m3 = np.select([np.isin(c[ok], [0, 5]), np.isin(c[ok], [1, 4])], [0, 1], 2)
        self.ms = StandardScaler().fit(FW)
        self.ml = LogisticRegression(C=self.Cm).fit(self.ms.transform(FW), m3, sample_weight=w0)
        return self

    def _one(self, FX, FY):
        pw = self.wl.predict_proba(self.ws.transform(FX[self.wc].to_numpy(float)))[:, 1]
        ma = self.ml.predict_proba(self.ms.transform(FX[self.mc].to_numpy(float)))
        mb = self.ml.predict_proba(self.ms.transform(FY[self.mc].to_numpy(float)))
        return np.stack([pw * ma[:, 0], pw * ma[:, 1], pw * ma[:, 2], (1 - pw) * mb[:, 2], (1 - pw) * mb[:, 1],
                         (1 - pw) * mb[:, 0]], 1)

    def predict6(self, T, FX, FY):
        return 0.5 * (self._one(FX, FY) + c6_mirror(self._one(FY, FX)))


class Recalibrator:
    """Symmetric post-hoc recalibration of a 6-class who-and-how distribution:
    P'(c) proportional to P(c)^b * exp(a_method(c)), with a_DEC = 0 and the same a for X and Y; fit on
    out-of-fold predictions from the tuning years only."""

    def fit(self, P6, c6, w=None):
        from scipy.optimize import minimize as _min
        ok = c6 >= 0
        L = np.log(np.clip(P6[ok], 1e-9, None))
        y = c6[ok]
        w = np.ones(ok.sum()) if w is None else w[ok]

        def nll(th):
            b, aK, aS = th
            Z = b * L + np.array([aK, aS, 0, 0, aS, aK])
            Z = Z - Z.max(1, keepdims=True)
            lp = Z - np.log(np.exp(Z).sum(1, keepdims=True))
            return -(w * lp[np.arange(len(y)), y]).sum() / w.sum()

        r = _min(nll, np.array([1.0, 0.0, 0.0]), method="Nelder-Mead", options={"xatol": 1e-5, "fatol": 1e-8})
        self.b, self.aK, self.aS = map(float, r.x)
        return self

    def apply(self, P6):
        Z = self.b * np.log(np.clip(P6, 1e-9, None)) + np.array([self.aK, self.aS, 0, 0, self.aS, self.aK])
        Z = Z - Z.max(1, keepdims=True)
        E = np.exp(Z)
        return E / E.sum(1, keepdims=True)


class WinLogit:
    """Symmetric binary winner logit (no intercept, both orientations)."""

    def __init__(self, cols, C=0.003, hl_years=None):
        self.cols, self.C, self.hl = list(cols), C, hl_years

    def fit(self, T, FX, FY, y):
        c = cells_to_c6(y)
        ok = c >= 0
        w0 = recency_weights(T["year"][ok], T["year"].max() + 1, self.hl)
        a_won = np.isin(c[ok], [0, 1, 2])
        X = np.vstack([FX[ok][self.cols].to_numpy(float), FY[ok][self.cols].to_numpy(float)])
        yy = np.concatenate([a_won, ~a_won]).astype(int)
        self.sc = StandardScaler().fit(X)
        self.lr = LogisticRegression(C=self.C, fit_intercept=False).fit(self.sc.transform(X), yy,
                                                                       sample_weight=np.concatenate([w0, w0]))
        return self

    def predict_pa(self, FX, FY):
        pa = self.lr.predict_proba(self.sc.transform(FX[self.cols].to_numpy(float)))[:, 1]
        pb = self.lr.predict_proba(self.sc.transform(FY[self.cols].to_numpy(float)))[:, 1]
        return 0.5 * (pa + 1 - pb)


def reweight_winner(P6, pa):
    """Keep the 6-class model's method-given-winner shares, replace its P(A wins)."""
    xa = P6[:, :3] / np.maximum(P6[:, :3].sum(1, keepdims=True), 1e-12)
    yb = P6[:, 3:] / np.maximum(P6[:, 3:].sum(1, keepdims=True), 1e-12)
    return np.hstack([xa * pa[:, None], yb * (1 - pa)[:, None]])


FIGHT_COLS = ["lbs", "hw", "women", "r5", "title", "catch", "yr", "lg_ko", "lg_sub", "lg_mpf"]
HAZ_COLS = FIGHT_COLS + ["x_fint", "y_fint", "x_r1", "y_r1", "s_dec", "s_mpf", "s_cmpf", "m_ko_pm", "m_sub_pm", "m_kd",
                         "m_pow", "m_str", "m_td", "m_ctrl", "m_subatt", "a_elo", "d_elo", "x_kd15", "y_okd15",
                         "x_sub15", "y_osub15", "x_ko_w_pf", "y_ko_l_pf", "x_sub_w_pf", "y_sub_l_pf", "x_age30",
                         "y_age30"]
MARKET_COLS = ["mk", "mk_a"]


class MethodRoundModel:
    """The full model: 6-class who-and-how logit (+ optional separate winner logit) spread over rounds by the
    competing-risks hazard model's conditional round shapes."""

    def __init__(self, cfg):
        self.cfg = dict(cfg)

    def fit(self, T, FX, FY, y):
        c = self.cfg
        m6 = (T["year"] >= c["start"]).to_numpy()
        self.c6 = C6Logit(c["cols"], C=c["C6"], hl_years=c["hl"]).fit(T[m6], FX[m6], FY[m6], y[m6])
        mh = (T["year"] >= c["haz_start"]).to_numpy()
        self.haz = HazardModel(HAZ_COLS, C=c["C_haz"], C_dec=c["C_dec"]).fit(T[mh], FX[mh], FY[mh], y[mh])
        self.win = None
        if c.get("win_cols"):
            self.win = WinLogit(c["win_cols"], C=c["C_win"], hl_years=c["hl"]).fit(T[m6], FX[m6], FY[m6], y[m6])
        return self

    def predict(self, T, FX, FY, return_parts=False):
        P6 = self.c6.predict6(T, FX, FY)
        if self.win is not None:
            P6 = reweight_winner(P6, self.win.predict_pa(FX, FY))
        H = self.haz.predict(T, FX, FY)
        P = joint_from_c6(P6, H, self.haz.draw_c)
        return (P, P6, H) if return_parts else P


# ============================================================== 6. evaluation helpers
def cluster_bootstrap(loss_tables, clusters, B=2000, seed=11):
    """Event-cluster bootstrap of mean losses. loss_tables: {model: {metric: per-fight array (nan = n/a)}}.
    Returns per model/metric mean + 95% CI, and a resampling matrix for paired differences."""
    rng = np.random.default_rng(seed)
    cl = pd.factorize(np.asarray(clusters))[0]
    k = cl.max() + 1
    W = rng.multinomial(k, np.full(k, 1.0 / k), size=B).astype(float)   # B x clusters resample counts

    def stat(v):
        ok = ~np.isnan(v)
        s = np.bincount(cl[ok], weights=v[ok], minlength=k)
        n = np.bincount(cl[ok], minlength=k).astype(float)
        boot = (W @ s) / np.maximum(W @ n, 1e-9)
        return float(v[ok].mean()), boot

    out, boots = {}, {}
    for mname, L in loss_tables.items():
        out[mname], boots[mname] = {}, {}
        for met, v in L.items():
            v = np.asarray(v, float)
            if np.all(np.isnan(v)):
                continue
            mean, bt = stat(v)
            out[mname][met] = {"mean": round(mean, 5), "ci95": [round(float(np.percentile(bt, 2.5)), 5),
                                                                 round(float(np.percentile(bt, 97.5)), 5)],
                               "n": int((~np.isnan(v)).sum())}
            boots[mname][met] = bt
    return out, (W, cl, stat)


def paired_diff(LA, LB, stat_tuple, metrics):
    """Mean difference A - B on fights where both are defined, with an event-cluster bootstrap CI."""
    W, cl, stat = stat_tuple
    res = {}
    for met in metrics:
        a, b = np.asarray(LA[met], float), np.asarray(LB[met], float)
        d = np.where(np.isnan(a) | np.isnan(b), np.nan, a - b)
        if np.all(np.isnan(d)):
            continue
        mean, bt = stat(d)
        res[met] = {"diff": round(mean, 5), "ci95": [round(float(np.percentile(bt, 2.5)), 5),
                                                      round(float(np.percentile(bt, 97.5)), 5)],
                    "p_worse_or_equal": round(float((bt >= 0).mean()), 4), "n": int((~np.isnan(d)).sum())}
    return res


def wilson(k, n, z=1.96):
    if n == 0:
        return [None, None]
    p = k / n
    den = 1 + z * z / n
    c = (p + z * z / (2 * n)) / den
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return [round(c - h, 4), round(c + h, 4)]


def calib_table(p, o, nb=10):
    """Reliability by predicted-probability quantile bins + ECE + logistic calibration slope/intercept."""
    p, o = np.asarray(p, float), np.asarray(o, float)
    order = np.argsort(p)
    bins = np.array_split(order, nb)
    rows, ece = [], 0.0
    for b in bins:
        if len(b) == 0:
            continue
        pm_, om = p[b].mean(), o[b].mean()
        rows.append({"pred": round(float(pm_), 4), "obs": round(float(om), 4), "n": int(len(b)),
                     "obs_ci95": wilson(int(o[b].sum()), len(b))})
        ece += len(b) / len(p) * abs(pm_ - om)
    lr = LogisticRegression(C=1e6).fit(logit(p, 1e-6)[:, None], o.astype(int))
    slope = float(lr.coef_[1, 0] - lr.coef_[0, 0])
    inter = float(lr.intercept_[1] - lr.intercept_[0])
    return {"bins": rows, "ece": round(float(ece), 4), "slope": round(slope, 3), "intercept": round(inter, 3),
            "mean_pred": round(float(p.mean()), 4), "mean_obs": round(float(o.mean()), 4), "n": int(len(p))}


def outcome_flags(y):
    is_ko = ((y >= I_XKO) & (y < I_XKO + R5)) | ((y >= I_YKO) & (y < I_YKO + R5))
    is_sub = ((y >= I_XSUB) & (y < I_XSUB + R5)) | ((y >= I_YSUB) & (y < I_YSUB + R5))
    is_dec = (y == I_XDEC) | (y == I_YDEC) | (y == I_DRAW)
    return is_ko, is_sub, is_dec


def calibration_report(P, y, T):
    ok = y >= 0
    P, y, T = P[ok], y[ok], T[ok]
    M = marginals(P)
    is_ko, is_sub, is_dec = outcome_flags(y)
    rep = {"KO": calib_table(M["KO"], is_ko), "SUB": calib_table(M["SUB"], is_sub),
           "DEC": calib_table(M["DEC"], is_dec), "FINISH": calib_table(M["FIN"], ~is_dec)}
    # per-fighter win-by-method: each fight gives two sides x three methods
    side_p, side_o = defaultdict(list), defaultdict(list)
    for nm, a_cells, b_cells in (("win_KO", M["XKO"], M["YKO"]), ("win_SUB", M["XSUB"], M["YSUB"]),
                                 ("win_DEC", M["XDEC"], M["YDEC"])):
        if nm == "win_KO":
            oa = (y >= I_XKO) & (y < I_XKO + R5)
            ob = (y >= I_YKO) & (y < I_YKO + R5)
        elif nm == "win_SUB":
            oa = (y >= I_XSUB) & (y < I_XSUB + R5)
            ob = (y >= I_YSUB) & (y < I_YSUB + R5)
        else:
            oa, ob = y == I_XDEC, y == I_YDEC
        rep[nm] = calib_table(np.concatenate([a_cells, b_cells]), np.concatenate([oa, ob]))
    # finishing round shares, by format
    rr = {}
    for R in (3, 5):
        m = (T["rounds"].to_numpy() == 5) == (R == 5)
        if m.sum() == 0:
            continue
        rows = []
        r_obs = np.where(~is_dec[m], y[m] % R5 + 1, 0)
        for r in range(1, R + 1):
            rows.append({"round": r, "pred_ko": round(float(M["ko_r"][m, r - 1].mean()), 4),
                         "obs_ko": round(float((is_ko[m] & (r_obs == r)).mean()), 4),
                         "pred_sub": round(float(M["sub_r"][m, r - 1].mean()), 4),
                         "obs_sub": round(float((is_sub[m] & (r_obs == r)).mean()), 4)})
        rr["%d_rounds" % R] = {"n": int(m.sum()), "rounds": rows,
                               "pred_dec": round(float(M["DEC"][m].mean()), 4),
                               "obs_dec": round(float(is_dec[m].mean()), 4)}
    rep["by_round"] = rr
    return rep


# ============================================================== 7. pipeline
METRICS = ["joint", "method3", "finish", "bin7", "method_round", "round_given_fin", "ko_vs_sub", "method_given_winner",
           "winner", "winner_brier", "winner_acc", "method3_brier"]


class Window:
    """Everything fit on one training window (fights before Jan 1 of `until`): the hazard model (shared by
    both variants) and each variant's 6-class / winner logits."""

    def __init__(self, D, until, cfgs, C_haz):
        T, FX, FY, y = D["T"], D["FX"], D["FY"], D["y"]
        self.until = until
        tr = (T["year"] < until).to_numpy()
        mh = tr & (T["year"] >= HAZ_START).to_numpy()
        self.haz = HazardModel(HAZ_COLS, C=C_haz, C_dec=C_DEC).fit(T[mh], FX[mh], FY[mh], y[mh])
        self.parts = {}
        for name, c in cfgs.items():
            m = tr & (T["year"] >= c["start"]).to_numpy()
            c6 = C6Logit(c["cols"], C=c["C6"], hl_years=c["hl"]).fit(T[m], FX[m], FY[m], y[m])
            win = WinLogit(c["win_cols"], C=c["C_win"], hl_years=c["hl"]).fit(T[m], FX[m], FY[m], y[m]) \
                if c.get("win_cols") else None
            self.parts[name] = (c6, win)

    def predict(self, D, mask, name):
        T, FX, FY = D["T"][mask], D["FX"][mask], D["FY"][mask]
        c6, win = self.parts[name]
        P6 = c6.predict6(T, FX, FY)
        if win is not None:
            P6 = reweight_winner(P6, win.predict_pa(FX, FY))
        H = self.haz.predict(T, FX, FY)
        return joint_from_c6(P6, H, self.haz.draw_c), P6, H


HAZ_START = 2008
C_DEC = 0.003
HL_YEARS = 8


def variant_cfgs(stat_cols, C6_S=0.002, C6_SM=0.002, C_win=0.003):
    return {"S": {"cols": stat_cols, "C6": C6_S, "start": 2012, "hl": HL_YEARS},
            "SM": {"cols": stat_cols + MARKET_COLS, "C6": C6_SM, "start": 2013, "hl": HL_YEARS,
                   "win_cols": stat_cols + MARKET_COLS, "C_win": C_win}}


def losses_on(P, D, mask):
    return per_fight_losses(P, D["y"][mask], D["T"][mask])


def tune(D, quick=False):
    """Expanding-window CV inside the tuning period (validation years 2020-2023, train on everything
    earlier). Returns the chosen hyperparameters and the CV tables."""
    T, FX, FY, y = D["T"], D["FX"], D["FY"], D["y"]
    stat_cols = D["stat_cols"]
    vmask = T["year"].isin(VALID_YEARS).to_numpy()
    log = {"hazard": [], "S": [], "SM": [], "market_blend": []}
    t0 = time.time()
    # 1) hazard penalty (round shapes): fit per fold once per C, reuse
    Cs_h = [0.01] if quick else [0.003, 0.01, 0.03]
    H_by_C = {}
    for Ch in Cs_h:
        H = np.zeros((len(T), NC_))
        for v in VALID_YEARS:
            tr = ((T["year"] < v) & (T["year"] >= HAZ_START)).to_numpy()
            va = (T["year"] == v).to_numpy()
            hz = HazardModel(HAZ_COLS, C=Ch, C_dec=C_DEC).fit(T[tr], FX[tr], FY[tr], y[tr])
            H[va] = hz.predict(T[va], FX[va], FY[va])
        H_by_C[Ch] = H
        print("  tune hazard C=%g (%.0fs)" % (Ch, time.time() - t0))
    draw_c = float(((y[(T["year"] < 2024).to_numpy()] == I_DRAW).sum())
                   / max(1, np.isin(y[(T["year"] < 2024).to_numpy()], [I_XDEC, I_YDEC, I_DRAW]).sum()))

    def cv6(cols, C, start, win_cols=None, C_win=None):
        P6 = np.zeros((len(T), 6))
        for v in VALID_YEARS:
            tr = ((T["year"] < v) & (T["year"] >= start)).to_numpy()
            va = (T["year"] == v).to_numpy()
            m = C6Logit(cols, C=C, hl_years=HL_YEARS).fit(T[tr], FX[tr], FY[tr], y[tr])
            P6[va] = m.predict6(T[va], FX[va], FY[va])
            if win_cols:
                w = WinLogit(win_cols, C=C_win, hl_years=HL_YEARS).fit(T[tr], FX[tr], FY[tr], y[tr])
                P6[va] = reweight_winner(P6[va], w.predict_pa(FX[va], FY[va]))
        return P6

    H0 = H_by_C[0.01]
    Cs6 = [0.002] if quick else [0.001, 0.002, 0.004]
    best_S = None
    for C in Cs6:
        P6 = cv6(stat_cols, C, 2012)
        s = summarize_losses(losses_on(joint_from_c6(P6, H0, draw_c)[vmask], D, vmask))
        log["S"].append({"C6": C, **{k: round(v, 5) for k, v in s.items()}})
        if best_S is None or s["joint"] < best_S[0]:
            best_S = (s["joint"], C, P6)
    P6_S = best_S[2]
    for Ch, H in H_by_C.items():
        s = summarize_losses(losses_on(joint_from_c6(P6_S, H, draw_c)[vmask], D, vmask))
        log["hazard"].append({"C_haz": Ch, **{k: round(v, 5) for k, v in s.items()}})
    C_haz = min(log["hazard"], key=lambda r: r["joint"])["C_haz"]
    H = H_by_C[C_haz]
    print("  tune S: C6=%g C_haz=%g (%.0fs)" % (best_S[1], C_haz, time.time() - t0))
    best_SM = None
    Cws = [0.003] if quick else [0.002, 0.003, 0.005]
    for C in Cs6:
        for Cw in Cws:
            P6 = cv6(stat_cols + MARKET_COLS, C, 2013, stat_cols + MARKET_COLS, Cw)
            s = summarize_losses(losses_on(joint_from_c6(P6, H, draw_c)[vmask], D, vmask))
            log["SM"].append({"C6": C, "C_win": Cw, **{k: round(v, 5) for k, v in s.items()}})
            if best_SM is None or s["joint"] < best_SM[0]:
                best_SM = (s["joint"], C, Cw, P6)
    print("  tune SM: C6=%g C_win=%g (%.0fs)" % (best_SM[1], best_SM[2], time.time() - t0))
    # 3) blend of the stats+market model with the market's own method / round props (2021-2023 OOF)
    P_SM = joint_from_c6(best_SM[3], H, draw_c)
    PMK = D["PMK"]
    hm = vmask & ~np.isnan(PMK[:, 0])
    best_a = None
    for a in np.round(np.arange(0, 1.01, 0.1), 2):
        Q = (1 - a) * P_SM[hm] + a * PMK[hm]
        s = summarize_losses(losses_on(Q, D, hm))
        log["market_blend"].append({"a_market": float(a), "n": int(hm.sum()), **{k: round(v, 5) for k, v in s.items()}})
        if best_a is None or s["joint"] < best_a[0]:
            best_a = (s["joint"], float(a))
    chosen = {"C6_S": best_S[1], "C6_SM": best_SM[1], "C_win": best_SM[2], "C_haz": C_haz, "a_market": best_a[1],
              "draw_c": round(draw_c, 5)}
    print("  tune market blend a=%.1f (%.0fs)" % (best_a[1], time.time() - t0))
    return chosen, log


def prepare(quick=False):
    T, priors, fights, people, state, elo_now = build_table()
    T = T.reset_index(drop=True)
    PR = prior_frame(T, priors)
    FX, FY, SA, SB = build_features(T, PR)
    stat_cols = list(FX.columns)
    pm, src, m6, rd, pdec = load_market(T)
    FX, FY = add_market_features(T, FX, FY, pm)
    y = outcome_cells(T)
    PMK = market_joint(T, m6, rd, 0.014)
    D = {"T": T, "PR": PR, "PMK": PMK, "FX": FX, "FY": FY, "y": y, "stat_cols": stat_cols, "pm": pm, "msrc": src,
         "m6": m6, "rd": rd, "pdec": pdec, "priors": priors, "fights": fights, "people": people, "state": state,
         "elo_now": elo_now}
    return D


# ============================================================== 8. live inputs (roster, matchups)
def side_row(tag, P, st, day, date, elo_now):
    """The table columns build_table writes for one side, from a person's walk state at `day` (live use)."""
    T_ = P["tott"] or {}
    dob = T_.get("dob")
    lam = math.log(2) / HALF_LIFE
    S = st["S"] * (math.exp(-lam * (day - st["t"])) if st["t"] is not None and day > st["t"] else 1.0)
    r = {tag + "_slug": P.get("slug"), tag + "_name": P["name"],
         tag + "_age": (date - dob).days / 365.25 if dob else np.nan, tag + "_elo": elo_now,
         tag + "_n": st["n_all"], tag + "_n5": st["n5"], tag + "_ko_losses": st["ko_losses"],
         tag + "_height": T_.get("height_in") or np.nan, tag + "_reach": T_.get("reach_in") or np.nan,
         tag + "_stance": T_.get("stance") or "", tag + "_home": B.mode_recent(st["hist"], day),
         tag + "_layoff": (day - st["last"][0]) if st["last"] else np.nan,
         tag + "_last": st["last"][1] if st["last"] else "", tag + "_streak": st["streak"],
         tag + "_fin_min_w": st["fin_min_w"], tag + "_fin_n_w": st["fin_n_w"], tag + "_fin_min_l": st["fin_min_l"],
         tag + "_fin_n_l": st["fin_n_l"], tag + "_r1_w": st["r1_w"], tag + "_r1_l": st["r1_l"],
         tag + "_dur": st["dur"], tag + "_dur_n": st["dur_n"],
         tag + "_opp_elo": st["opp_elo"] / st["n_all"] if st["n_all"] else np.nan,
         tag + "_S": S, tag + "_C": st["C"].copy()}
    for k in REC_KEYS:
        r[tag + "_rec_" + k] = st["rec"].get(k, 0)
    return r


def live_frame(D, pairs, live_priors_year):
    """Virtual fights for live use. pairs: list of dicts {a, b (person ids), division, rounds, title, date}."""
    rows = []
    elo_now = D["elo_now"]
    for q in pairs:
        day = q["date"].toordinal()
        r = {"id": q.get("id", ""), "date": q["date"], "day": day, "year": q["date"].year,
             "prior_year": live_priors_year, "event": "live",
             "division": q["division"], "rounds": q["rounds"], "title": q.get("title", False), "tourn": False,
             "winner": "", "method": "", "cls": None, "rnd": 0, "time_s": None, "fight_s": None}
        r.update(side_row("A", D["people"][q["a"]], D["state"][q["a"]], day, q["date"], elo_now[q["a"]]))
        r.update(side_row("B", D["people"][q["b"]], D["state"][q["b"]], day, q["date"], elo_now[q["b"]]))
        pdiv = q["division"]
        if pdiv in B.NON_DIV:
            hs = [h for h in (r["A_home"], r["B_home"]) if B.LBS.get(h)]
            pdiv = max(hs, key=lambda d: B.LBS[d]) if hs else "ALL"
        r["prior_div"] = pdiv
        rows.append(r)
    return pd.DataFrame(rows)


# ============================================================== 9. main
def rd4(x):
    return [round(float(v), 4) for v in x]


def compact_joint(row, R):
    """Per-fight joint for the JSON: A KO by round, A SUB by round, B KO by round, B SUB by round, A dec,
    B dec, draw (scheduled rounds only)."""
    return (rd4(row[I_XKO:I_XKO + R]) + rd4(row[I_XSUB:I_XSUB + R]) + rd4(row[I_YKO:I_YKO + R])
            + rd4(row[I_YSUB:I_YSUB + R]) + rd4(row[[I_XDEC, I_YDEC, I_DRAW]]))


def summary_of(P):
    M = marginals(P)
    return {"p_fin": M["FIN"], "p_ko": M["KO"], "p_sub": M["SUB"], "p_dec": M["DEC"], "p_a": M["pA"],
            "p_b": M["pB"], "p_draw": M["DRAW"]}


def run(args):
    t0 = time.time()
    print("1/7 data and features")
    D = prepare(args.quick)
    T, y = D["T"], D["y"]
    print("2/7 tuning on %d-%d (validation years %s)" % (TUNE_YEARS[0], TUNE_YEARS[1], VALID_YEARS))
    chosen, tune_log = tune(D, args.quick)
    cfgs = variant_cfgs(D["stat_cols"], chosen["C6_S"], chosen["C6_SM"], chosen["C_win"])
    print("3/7 walk-forward fits (%.0fs)" % (time.time() - t0))
    test = (T["date"] >= TEST_FROM).to_numpy()
    preds = {k: np.full((len(T), NC_), np.nan) for k in ("S", "SM", "S_refit", "SM_refit")}
    fit_through = np.full(len(T), "", dtype=object)
    windows = {}
    oof_years = [] if args.quick else list(range(2019, 2024))
    for until in oof_years + [2024, 2025, 2026]:
        w = Window(D, until, cfgs, chosen["C_haz"])
        windows[until] = w
        if until < 2024:
            m = (T["year"] == until).to_numpy()
            for v in ("S", "SM"):
                preds[v][m] = w.predict(D, m, v)[0]
                preds[v + "_refit"][m] = preds[v][m]
            fit_through[m] = "%d-12-31" % (until - 1)
        elif until == 2024:
            for v in ("S", "SM"):
                preds[v][test] = w.predict(D, test, v)[0]
            m = (T["year"] == 2024).to_numpy()
            for v in ("S", "SM"):
                preds[v + "_refit"][m] = preds[v][m]
        else:
            m = (T["year"] == until).to_numpy()
            for v in ("S", "SM"):
                preds[v + "_refit"][m] = w.predict(D, m, v)[0]
        print("  window < %d done (%.0fs)" % (until, time.time() - t0))
    fit_through[test] = "2023-12-31"
    base = baseline_joint(T, D["priors"], k_shrink=50, elo=False)
    base_elo = baseline_joint(T, D["priors"], k_shrink=50, elo=True)
    base_raw = baseline_joint(T, D["priors"], k_shrink=0, elo=False)
    PMK = D["PMK"]
    a = chosen["a_market"]
    blend = np.where(np.isnan(PMK), np.nan, (1 - a) * preds["SM"] + a * np.nan_to_num(PMK))
    blend_refit = np.where(np.isnan(PMK), np.nan, (1 - a) * preds["SM_refit"] + a * np.nan_to_num(PMK))

    print("4/7 held-out evaluation, 2024-01-01 .. %s (%.0fs)" % (T["date"].max(), time.time() - t0))
    ev = test & (y >= 0)
    Tt = T[ev]
    models = {"base_division_raw": base_raw, "base_division": base, "base_division_elo": base_elo,
              "S": preds["S"], "S_refit": preds["S_refit"], "SM": preds["SM"], "SM_refit": preds["SM_refit"]}
    L = {k: losses_on(v[ev], D, ev) for k, v in models.items()}
    boot, st = cluster_bootstrap(L, Tt["event"].to_numpy(), B=400 if args.quick else 2000)
    paired = {
        "S_minus_base_division": paired_diff(L["S"], L["base_division"], st, METRICS),
        "S_minus_base_division_elo": paired_diff(L["S"], L["base_division_elo"], st, METRICS),
        "SM_minus_S": paired_diff(L["SM"], L["S"], st, METRICS),
        "S_refit_minus_S": paired_diff(L["S_refit"], L["S"], st, METRICS),
        "SM_minus_base_division_elo": paired_diff(L["SM"], L["base_division_elo"], st, METRICS),
    }
    # market props subset
    hm = ev & ~np.isnan(PMK[:, 0])
    Th = T[hm]
    Lm = {"market_props": losses_on(PMK[hm], D, hm), "SM": losses_on(preds["SM"][hm], D, hm),
          "S": losses_on(preds["S"][hm], D, hm), "SM_market_blend": losses_on(blend[hm], D, hm),
          "SM_refit_market_blend": losses_on(blend_refit[hm], D, hm),
          "base_division_elo": losses_on(base_elo[hm], D, hm)}
    boot_m, st_m = cluster_bootstrap(Lm, Th["event"].to_numpy(), B=400 if args.quick else 2000)
    paired_m = {"SM_minus_market": paired_diff(Lm["SM"], Lm["market_props"], st_m, METRICS),
                "S_minus_market": paired_diff(Lm["S"], Lm["market_props"], st_m, METRICS),
                "blend_minus_market": paired_diff(Lm["SM_market_blend"], Lm["market_props"], st_m, METRICS),
                "blend_minus_SM": paired_diff(Lm["SM_market_blend"], Lm["SM"], st_m, METRICS)}
    calib = {"S": calibration_report(preds["S"][ev], y[ev], Tt), "SM": calibration_report(preds["SM"][ev], y[ev], Tt),
             "base_division": calibration_report(base[ev], y[ev], Tt),
             "market_props": calibration_report(PMK[hm], y[hm], Th),
             "SM_market_blend": calibration_report(blend[hm], y[hm], Th)}
    # by division and format: method3 / joint vs base
    by_div = []
    for dv, g in Tt.groupby("division"):
        ix = np.where(ev)[0][np.isin(np.where(ev)[0], g.index.to_numpy())]
        if len(ix) < 15:
            continue
        mm = np.zeros(len(T), bool)
        mm[ix] = True
        ls, lb = losses_on(preds["S"][mm], D, mm), losses_on(base[mm], D, mm)
        is_ko, is_sub, is_dec = outcome_flags(y[mm])
        Ms = marginals(preds["S"][mm])
        by_div.append({"division": dv, "n": int(len(ix)), "obs_ko": round(float(is_ko.mean()), 3),
                       "obs_sub": round(float(is_sub.mean()), 3), "obs_dec": round(float(is_dec.mean()), 3),
                       "pred_ko": round(float(Ms["KO"].mean()), 3), "pred_sub": round(float(Ms["SUB"].mean()), 3),
                       "pred_dec": round(float(Ms["DEC"].mean()), 3),
                       "method3_S": round(float(np.nanmean(ls["method3"])), 4),
                       "method3_base": round(float(np.nanmean(lb["method3"])), 4),
                       "joint_S": round(float(np.nanmean(ls["joint"])), 4),
                       "joint_base": round(float(np.nanmean(lb["joint"])), 4)})
    by_fmt = []
    for R in (3, 5):
        mm = ev & ((T["rounds"].to_numpy() == 5) == (R == 5))
        row = {"rounds": R, "n": int(mm.sum())}
        for nm in ("S", "SM", "base_division"):
            lsx = losses_on(models[nm][mm], D, mm)
            row[nm] = {k: round(float(np.nanmean(lsx[k])), 4) for k in ("joint", "method3", "finish", "round_given_fin",
                                                                       "winner")}
        by_fmt.append(row)
    by_year = []
    for yr_ in sorted(Tt["year"].unique()):
        mm = ev & (T["year"] == yr_).to_numpy()
        row = {"year": int(yr_), "n": int(mm.sum())}
        for nm in ("S", "S_refit", "SM", "SM_refit", "base_division"):
            lsx = losses_on(models[nm][mm], D, mm)
            row[nm] = {k: round(float(np.nanmean(lsx[k])), 4) for k in ("joint", "method3", "winner")}
        by_year.append(row)
    # tuning-period walk-forward (out-of-fold) numbers, for reference
    oof = None
    if oof_years:
        om = T["year"].isin(oof_years).to_numpy() & (y >= 0)
        oof = {nm: summarize_losses(losses_on(v[om], D, om)) for nm, v in
               (("S", preds["S"]), ("SM", preds["SM"]), ("base_division", base), ("base_division_elo", base_elo))}
        oof = {k: {m: round(v, 5) for m, v in d.items()} for k, d in oof.items()}
        oof["n"] = int(om.sum())

    print("5/7 roster and matchup outputs (%.0fs)" % (time.time() - t0))
    w_live = Window(D, 2027, cfgs, chosen["C_haz"])
    roster, matchups = roster_outputs(D, w_live, args)
    print("6/7 compact JS model (%.0fs)" % (time.time() - t0))
    js_model = export_js_model(D, w_live, chosen)
    js_check = verify_js(js_model, D, w_live)
    print("7/7 writing outputs (%.0fs)" % (time.time() - t0))
    bt_ids = set(f["id"] for f in json.load(open(BACKTEST))["fights"])
    fights_out = {}
    for i in np.where(T["id"].isin(bt_ids).to_numpy())[0]:
        R = 5 if T.at[i, "rounds"] == 5 else 3
        rec = {"date": T.at[i, "date"].isoformat(), "rounds": R, "fit_through": fit_through[i]}
        for v in ("S", "SM"):
            P = preds[v][i]
            if np.isnan(P).any():
                continue
            rec[v] = compact_joint(P, R)
        if "S" not in rec:
            continue
        if T.at[i, "year"] >= 2025:
            for v in ("S_refit", "SM_refit"):
                rec[v] = compact_joint(preds[v][i], R)
        sm = summary_of(preds["S"][i:i + 1])
        rec["sum_S"] = {k: round(float(v[0]), 4) for k, v in sm.items()}
        Mg = marginals(preds["S"][i:i + 1])
        rec["sum_S"]["bins7"] = [round(float(Mg[c][0]), 4) for c in ("XKO", "XSUB", "XDEC", "DRAW", "YDEC", "YSUB",
                                                                     "YKO")]
        fights_out[T.at[i, "id"]] = rec
    out = {
        "meta": {
            "tool": "tools/methodround.py", "built": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
            "snapshot": T["date"].max().isoformat(),
            "what": "Method-and-round benchmark: per fight P(A/B by KO/TKO in round r), P(A/B by submission in round r), "
                    "P(A/B by decision), P(draw); everything else (finish, method split, 7-bin, finishing round, "
                    "P(fighter wins by KO/sub/dec)) is a marginal",
            "cells": "fights[id][variant] = A KO r1..R, A SUB r1..R, B KO r1..R, B SUB r1..R, A DEC, B DEC, DRAW "
                     "(R = scheduled rounds; A = first ufcstats name, as in backtest.json); KO/TKO includes doctor "
                     "and corner stoppages; DQ and no-contests are not modelled",
            "variants": {"S": "stats only: pre-fight UFC stats, record, age, Elo; usable for any matchup at any time",
                         "SM": "S plus the closing moneyline (log-odds) as a feature and a separate winner logit; the "
                               "line is known only minutes before the fight, so SM is a live/stacking variant",
                         "*_refit": "same hyperparameters, coefficients re-estimated each Jan 1 on everything before "
                                    "(2025 and 2026 fights only; 2024 equals the frozen fit)"},
            "walk_forward": "features use only fights before the fight date; priors from the 5 calendar years before "
                            "the fight's year; hyperparameters and blend weight chosen by expanding-window CV with "
                            "validation years 2020-2023; 2019-2023 predictions are out-of-fold (fit_through = Dec 31 "
                            "of the previous year); 2024+ predictions come from the fit through 2023-12-31",
            "chosen": chosen, "shrink": SHRINK, "train_from": {"S": 2012, "SM": 2013, "hazard": HAZ_START},
            "recency_half_life_years": HL_YEARS, "elo": {"K": ELO_K, "boost": ELO_BOOST},
            "market_sources": "data/derived/market.json (tools/market.py: consensus closing moneyline; method6, round "
                              "and decision props from US books on BestFightOdds, 2021+); nlbair/ufc-data closing "
                              "ranges (data/raw/odds/nlbair_odds.csv) for 2013-2018 moneylines",
            "n_fights_table": int(len(T)), "n_backtest_fights": len(fights_out),
            "market_json_built": (json.load(open(MARKET_JSON))["meta"].get("built")
                                  if os.path.exists(MARKET_JSON) else None),
        },
        "tuning": {"cv": tune_log, "oof_2019_2023": oof},
        "test": {"period": [TEST_FROM.isoformat(), T["date"].max().isoformat()], "n": int(ev.sum()),
                 "metrics": boot, "paired": paired, "market_subset": {"n": int(hm.sum()), "metrics": boot_m,
                                                                      "paired": paired_m},
                 "calibration": calib, "by_division": by_div, "by_format": by_fmt, "by_year": by_year},
        "matchups": matchups,
        "roster": roster,
        "js_model": js_model,
        "js_check": js_check,
        "fights": fights_out,
    }
    with open(OUT_JSON, "w") as fh:
        json.dump(out, fh, separators=(",", ":"), allow_nan=False, default=_json_default)
    print("  wrote %s (%.1f MB)" % (OUT_JSON, os.path.getsize(OUT_JSON) / 1e6))
    write_report(out)
    print("  wrote %s; done in %.0fs" % (OUT_MD, time.time() - t0))


def _json_default(o):
    if isinstance(o, (np.bool_,)):
        return bool(o)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return None if np.isnan(o) else float(o)
    if isinstance(o, (dt.date,)):
        return o.isoformat()
    if isinstance(o, np.ndarray):
        return o.tolist()
    raise TypeError(type(o))


# ============================================================== 10. roster outputs, JS export, check
JS_SRC = os.path.join(HERE, "methodround_model.js")
LIVE_FIELD_SINCE = dt.date(2025, 1, 1)


def _r(x, k=5):
    return [round(float(v), k) for v in np.ravel(x)]


def export_js_model(D, w, chosen):
    """Coefficients + preprocessing for tools/methodround_model.js (fit on every fight through the snapshot,
    same hyperparameters as the held-out model)."""
    def lr_part(model_lr, scaler, cols, binary=False):
        part = {"cols": list(cols), "mean": _r(scaler.mean_, 6), "scale": _r(scaler.scale_, 6)}
        if binary:
            part["coef"] = _r(model_lr.coef_[1] - model_lr.coef_[0], 6)
        else:
            part["coef"] = [_r(r, 6) for r in model_lr.coef_]
            part["intercept"] = _r(model_lr.intercept_, 6)
        return part

    c6S, _ = w.parts["S"]
    c6M, winM = w.parts["SM"]
    hz = w.haz
    assert list(hz.lr.classes_) == [0, 1, 2, 3, 4]
    nb = len(HAZ_COLS)
    haz = {"cols": HAZ_COLS, "mean": _r(hz.scaler.mean_[:nb], 6), "scale": _r(hz.scaler.scale_[:nb], 6),
           "coef": [_r(r, 6) for r in hz.lr.coef_], "round_cols": ROUND_COLS}
    dec = lr_part(hz.dlr, hz.dscaler, HAZ_COLS, binary=True)
    pri = {}
    for d, P in D["priors"]["live"].items():
        pri[d] = {k: (round(float(P[k]), 8) if P.get(k) is not None else None) for k in PRIOR_FIELDS}
        pri[d]["lbs"] = P.get("lbs")
    extras = {}
    for p, st in D["state"].items():
        P = D["people"].get(p)
        if not P or not P.get("slug") or p.startswith("amb:") or not st["n_all"]:
            continue
        if st["last"] is None or dt.date.fromordinal(st["last"][0]) < dt.date(2019, 1, 1):
            continue
        extras[P["slug"]] = [st["streak"], st["last"][1], round(st["fin_min_w"], 2), st["fin_n_w"],
                             round(st["fin_min_l"], 2), st["fin_n_l"], st["r1_w"], st["r1_l"], round(st["dur"], 2),
                             st["dur_n"], round(st["opp_elo"] / st["n_all"], 1)]
    return {
        "version": 1, "fit_through": D["T"]["date"].max().isoformat(),
        "note": "evaluate with tools/methodround_model.js (source embedded below); profiles are fighters.json "
                "entries; extras[slug] = [streak, last result code, finishing-win minutes, finishing wins, "
                "finished-loss minutes, finished losses, round-1 finishing wins, round-1 finished losses, career "
                "fight minutes (all bouts), bouts with a time, mean pre-fight opponent Elo]",
        "keys": KEYS, "shrink": SHRINK, "lbs": B.LBS, "draw_c": round(float(hz.draw_c), 6), "priors": pri,
        "c6": {"S": lr_part(c6S.lr, c6S.scaler, c6S.cols), "SM": lr_part(c6M.lr, c6M.scaler, c6M.cols)},
        "win": {"SM": lr_part(winM.lr, winM.sc, winM.cols, binary=True)},
        "hazard": haz, "decision": dec, "extras": extras,
        "source": open(JS_SRC).read(),
    }


def _profile_for_js(D, p, snap_day):
    """A fighters.json-shaped profile from the walk state (for the JS check and for fighters missing from
    fighters.json)."""
    st, P = D["state"][p], D["people"][p]
    T_ = P["tott"] or {}
    lam = math.log(2) / HALF_LIFE
    S = st["S"] * (math.exp(-lam * (snap_day - st["t"])) if st["t"] is not None and snap_day > st["t"] else 1.0)
    rec = {k: int(st["rec"].get(k, 0)) for k in REC_KEYS}
    return {"S": _r(S, 8), "C": _r(st["C"], 8), "record": rec, "n_fights": st["n_all"], "n_5rd": st["n5"],
            "ko_losses": st["ko_losses"], "dob": T_["dob"].isoformat() if T_.get("dob") else None,
            "elo": float(D["elo_now"][p]), "height_in": T_.get("height_in"), "reach_in": T_.get("reach_in"),
            "stance": T_.get("stance") or "", "last_fight": dt.date.fromordinal(st["last"][0]).isoformat(),
            "division": B.mode_recent(st["hist"], snap_day)}


def live_predict(D, w, pairs, variant="S", pm=None):
    LT = live_frame(D, pairs, "live")
    PRl = prior_frame(LT, D["priors"])
    FXl, FYl, _, _ = build_features(LT, PRl)
    FXl, FYl = add_market_features(LT, FXl, FYl, pm if pm is not None else pd.Series(np.nan, index=LT.index))
    Dl = {"T": LT, "FX": FXl, "FY": FYl}
    P, P6, H = w.predict(Dl, np.ones(len(LT), bool), variant)
    return LT, P


def verify_js(js_model, D, w, n=40, seed=3):
    """Python vs node on random live matchups (fight date = snapshot so S decays identically)."""
    import subprocess
    import tempfile
    rng = np.random.default_rng(seed)
    snap = D["T"]["date"].max()
    snap_day = snap.toordinal()
    slug2p = {D["people"][p]["slug"]: p for p in D["state"] if D["people"].get(p, {}).get("slug")}
    cands = [s for s in js_model["extras"] if s in slug2p and D["state"][slug2p[s]]["last"][0] >= dt.date(2023, 1, 1).toordinal()]
    pairs, profs = [], []
    divs = ["Lightweight", "Heavyweight", "Women's Strawweight", "Flyweight", "Catch Weight", "Middleweight"]
    for k in range(n):
        a, b = rng.choice(cands, 2, replace=False)
        q = {"a": slug2p[a], "b": slug2p[b], "division": divs[k % len(divs)], "rounds": 5 if k % 3 == 0 else 3,
             "title": k % 4 == 0, "date": snap}
        pairs.append(q)
        profs.append({"a": _profile_for_js(D, q["a"], snap_day), "b": _profile_for_js(D, q["b"], snap_day),
                      "opts": {"slugA": a, "slugB": b, "division": q["division"], "rounds": q["rounds"],
                               "title": q["title"], "date": snap.isoformat(),
                               "pMarketA": (0.3 + 0.4 * (k % 5) / 4) if k % 2 else None}})
    pm = pd.Series([pr["opts"]["pMarketA"] if pr["opts"]["pMarketA"] is not None else np.nan for pr in profs])
    LT, PS = live_predict(D, w, pairs, "S")
    _, PM = live_predict(D, w, pairs, "SM", pm)
    with tempfile.TemporaryDirectory() as td:
        mp = os.path.join(td, "model.json")
        cp = os.path.join(td, "cases.json")
        json.dump({k: v for k, v in js_model.items() if k != "source"}, open(mp, "w"), default=_json_default)
        json.dump(profs, open(cp, "w"), default=_json_default)
        code = ("const MR=require(%s);const m=require(%s);const cases=require(%s);const mr=MR.create(m);"
                "console.log(JSON.stringify(cases.map(c=>{const o=mr.predict(c.a,c.b,c.opts);"
                "return {v:o.variant,b7:o.bins7,fr:o.finRound};})));") % (json.dumps(JS_SRC), json.dumps(mp),
                                                                           json.dumps(cp))
        try:
            res = subprocess.run(["node", "-e", code], capture_output=True, text=True, timeout=120)
            js = json.loads(res.stdout)
        except Exception as e:  # node missing or failed
            return {"ok": False, "error": str(e)[:300]}
    worst = 0.0
    for k, o in enumerate(js):
        P = PM[k] if o["v"] == "SM" else PS[k]
        Mg = marginals(P[None, :])
        py7 = [Mg[c][0] for c in ("XKO", "XSUB", "XDEC", "DRAW", "YDEC", "YSUB", "YKO")]
        R = pairs[k]["rounds"]
        pyfr = list(Mg["fin_r"][0, :R])
        worst = max(worst, max(abs(a - b) for a, b in zip(py7 + pyfr, o["b7"] + o["fr"])))
    return {"ok": worst < 2e-3, "cases": len(js), "max_abs_diff": round(worst, 6),
            "note": "Python live model vs tools/methodround_model.js on random roster matchups (S and SM variants); "
                    "differences come from fighters.json-style rounding of S/C/Elo"}


def roster_outputs(D, w, args):
    """Per fighter (fighters.json slug): P(win/lose by KO, SUB, decision) and P(finish) averaged over every
    fighter in his division active since LIVE_FIELD_SINCE (3 rounds, non-title, fight on the snapshot date),
    stats-only variant. Plus the default matchup."""
    snap = D["T"]["date"].max()
    fj = json.load(open(FIGHTERS))["fighters"]
    slug2p = {D["people"][p]["slug"]: p for p in D["state"] if D["people"].get(p, {}).get("slug")}
    by_div = defaultdict(list)
    field = defaultdict(list)
    for slug, prof in fj.items():
        p = slug2p.get(slug)
        dv = prof.get("division")
        if p is None or dv not in B.LBS or dv in B.NON_DIV:
            continue
        by_div[dv].append(p)
        if prof.get("last_fight") and prof["last_fight"] >= LIVE_FIELD_SINCE.isoformat():
            field[dv].append(p)
    roster = {}
    for dv, members in sorted(by_div.items()):
        fl = field[dv]
        if len(fl) < 5:
            continue
        pairs = [{"a": a, "b": b, "division": dv, "rounds": 3, "title": False, "date": snap}
                 for a in members for b in fl if a != b]
        if args.quick:
            pairs = pairs[:2000]
        out = []
        for i in range(0, len(pairs), 20000):
            LT, P = live_predict(D, w, pairs[i:i + 20000], "S")
            out.append(P)
        P = np.vstack(out)
        Mg = marginals(P)
        A = np.array([q["a"] for q in pairs[:len(P)]])
        for a in np.unique(A):
            m = A == a
            slug = D["people"][a]["slug"]
            g = lambda k: round(float(Mg[k][m].mean()), 4)
            pa = g("pA")
            roster[slug] = {"division": dv, "n_opponents": int(m.sum()),
                            "vs_field": {"win": pa, "win_ko": g("XKO"), "win_sub": g("XSUB"), "win_dec": g("XDEC"),
                                         "lose_ko": g("YKO"), "lose_sub": g("YSUB"), "lose_dec": g("YDEC"),
                                         "draw": g("DRAW"), "finish": g("FIN"), "ko": g("KO"), "sub": g("SUB"),
                                         "dec": g("DEC")},
                            "method_given_win": {"ko": round(g("XKO") / pa, 4), "sub": round(g("XSUB") / pa, 4),
                                                 "dec": round(g("XDEC") / pa, 4)}}
    # default matchup (A = Volkanovski, blue in the page)
    matchups = {}
    va, ga = slug2p.get("alexander-volkanovski"), slug2p.get("justin-gaethje")
    if va and ga:
        q = [{"a": va, "b": ga, "division": "Lightweight", "rounds": 5, "title": True, "date": dt.date(2026, 11, 6)}]
        for variant, pmv, note in (("S", None, "stats only"),
                                   ("SM", 0.372, "with the no-vig market price Volkanovski 37.2% (openers Oct 24-25, "
                                                 "2026, docs/BACKLOG.md)")):
            LT, P = live_predict(D, w, q, variant, None if pmv is None else pd.Series([pmv]))
            Mg = marginals(P)
            f = lambda k: round(float(Mg[k][0]), 4)
            matchups["alexander-volkanovski__justin-gaethje__%s" % variant] = {
                "A": "alexander-volkanovski", "B": "justin-gaethje", "division": "Lightweight", "rounds": 5,
                "title": True, "variant": variant, "note": note,
                "bins7": {"A_KO": f("XKO"), "A_SUB": f("XSUB"), "A_DEC": f("XDEC"), "draw": f("DRAW"),
                          "B_DEC": f("YDEC"), "B_SUB": f("YSUB"), "B_KO": f("YKO")},
                "p_A": f("pA"), "p_B": f("pB"), "p_finish": f("FIN"), "p_ko": f("KO"), "p_sub": f("SUB"),
                "p_dec": f("DEC"), "finish_round": _r(Mg["fin_r"][0, :5], 4),
                "A_finish_round": _r((P[0, I_XKO:I_XKO + 5] + P[0, I_XSUB:I_XSUB + 5]), 4),
                "B_finish_round": _r((P[0, I_YKO:I_YKO + 5] + P[0, I_YSUB:I_YSUB + 5]), 4)}
    return roster, matchups


# ============================================================== 11. report
def _ci(d, k=4):
    if not d:
        return "n/a"
    return ("%%.%df [%%.%df, %%.%df]" % (k, k, k)) % (d["mean"], d["ci95"][0], d["ci95"][1])


def _dci(d, k=4):
    if not d:
        return "n/a"
    return ("%%+.%df [%%+.%df, %%+.%df]" % (k, k, k)) % (d["diff"], d["ci95"][0], d["ci95"][1])


def _md_table(head, rows):
    out = ["| " + " | ".join(head) + " |", "|" + "|".join("---" for _ in head) + "|"]
    out += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(out)


def _market_provenance(meta):
    """Which market.json build the market numbers use, and a warning when the file on disk is newer."""
    used = meta.get("market_json_built")
    if not used:
        return (" The market.json build used is not recorded in this JSON (older run); compare with "
                "tools/methodround_verify.py --score before relying on the market rows.")
    txt = " Built from market.json of %s." % used
    try:
        now = json.load(open(MARKET_JSON))["meta"].get("built")
        if now and now != used:
            txt += (" market.json on disk is now %s: rerun `python3 tools/methodround.py` to refresh SM and the "
                    "market rows." % now)
    except (OSError, ValueError, KeyError):
        pass
    return txt


def write_report(o):
    te = o["test"]
    mt = te["metrics"]
    ch = o["meta"]["chosen"]
    names = {"base_division_raw": "Division x format base rates (raw 5-yr window)",
             "base_division": "Division x format base rates (shrunk to all-division, k=50)",
             "base_division_elo": "Base rates x Elo winner split",
             "S": "**Model S** (stats only, frozen fit through 2023)", "S_refit": "Model S, yearly refit",
             "SM": "**Model SM** (stats + closing moneyline, frozen)", "SM_refit": "Model SM, yearly refit"}
    met_cols = [("method3", "Method 3-class LL"), ("finish", "Finish vs decision LL"), ("bin7", "7-bin LL"),
                ("method_round", "Method x round LL"), ("joint", "Who x how x when LL"),
                ("round_given_fin", "Round given finish LL"), ("ko_vs_sub", "KO vs SUB given finish LL"),
                ("method_given_winner", "Method given winner LL"), ("winner", "Winner LL"),
                ("winner_acc", "Winner accuracy")]
    L = []
    L.append("# Method-and-round model (methodround)\n")
    L.append("Built %s by `tools/methodround.py` from the ufcstats snapshot through %s. Outputs: "
             "`data/derived/methodround.json` (per-fight predictions keyed by backtest fight id, held-out metrics, "
             "roster outputs keyed by slug, compact JS model), `tools/methodround_model.js` (evaluator). "
             "This is the benchmark the simulator's method-and-round distribution has to match or beat.\n"
             % (o["meta"]["built"][:16].replace("T", " ") + " UTC", o["meta"]["snapshot"]))
    L.append("## Bottom line\n")
    s, b, be = mt["S"], mt["base_division"], mt["base_division_elo"]
    pdx = te["paired"]["S_minus_base_division"]
    L.append("- Held out on %d UFC fights from Jan 1, 2024 to %s (draws kept as their own cell; DQ and no-contests "
             "dropped), never used for any choice. Confidence intervals are 95%% event-cluster bootstrap (2,000 draws)."
             % (te["n"], te["period"][1]))
    L.append("- **Method (KO/TKO, submission, decision):** model S log loss %s vs %s for division base rates; "
             "difference %s. Finish-vs-decision %s vs %s." % (_ci(s["method3"]), _ci(b["method3"]),
                                                             _dci(pdx.get("method3")), _ci(s["finish"]),
                                                             _ci(b["finish"])))
    L.append("- **Who wins how (7 bins):** %s vs %s (base rates x Elo); **who x how x when** (every round cell): "
             "%s vs %s." % (_ci(s["bin7"]), _ci(be["bin7"]), _ci(s["joint"]), _ci(be["joint"])))
    L.append("- **Winner** (a by-product): %s log loss, %.1f%% accuracy, vs Elo %s." % (
        _ci(s["winner"]), 100 * s["winner_acc"]["mean"], _ci(be["winner"])))
    sm = te["market_subset"]
    if sm["n"]:
        mm = sm["metrics"]
        L.append("- **Against the betting market's own method props** (%d held-out fights with US-book method and "
                 "round props): market method LL %s, model SM %s, model S %s; the %.0f/%.0f blend of SM and the "
                 "market %s (blend weight chosen on 2021-2023)." % (
                     sm["n"], _ci(mm["market_props"]["method3"]), _ci(mm["SM"]["method3"]),
                     _ci(mm["S"]["method3"]), 100 * (1 - ch["a_market"]), 100 * ch["a_market"],
                     _ci(mm["SM_market_blend"]["method3"])))
    L.append("")
    L.append("## Held-out results (2024+)\n")
    rows = []
    for k in ("base_division_raw", "base_division", "base_division_elo", "S", "S_refit", "SM", "SM_refit"):
        r = [names[k]]
        for mkey, _ in met_cols:
            d = mt[k].get(mkey)
            r.append(("%.1f%%" % (100 * d["mean"])) if mkey == "winner_acc" else (("%.4f" % d["mean"]) if d else ""))
        rows.append(r)
    L.append(_md_table(["Model"] + [c[1] for c in met_cols], rows))
    L.append("\nLower is better for every log loss (LL). Joint = the full outcome space (A or B, KO/TKO or "
             "submission, in round r; decision winner; draw). Brier for the 3-class method: S %.4f, base %.4f.\n"
             % (mt["S"]["method3_brier"]["mean"], mt["base_division"]["method3_brier"]["mean"]))
    L.append("**95% CIs and paired differences (event-cluster bootstrap):**\n")
    rows = []
    for k in ("base_division", "base_division_elo", "S", "SM"):
        rows.append([names[k], _ci(mt[k]["method3"]), _ci(mt[k]["finish"]), _ci(mt[k]["bin7"]),
                     _ci(mt[k]["joint"]), _ci(mt[k]["winner"])])
    L.append(_md_table(["Model", "Method LL", "Finish LL", "7-bin LL", "Joint LL", "Winner LL"], rows))
    L.append("")
    rows = []
    for k, lab in (("S_minus_base_division", "S - division base rates"),
                   ("S_minus_base_division_elo", "S - base rates x Elo"),
                   ("SM_minus_S", "SM - S"), ("S_refit_minus_S", "S yearly refit - S frozen"),
                   ("SM_minus_base_division_elo", "SM - base rates x Elo")):
        pdd = te["paired"][k]
        rows.append([lab] + [_dci(pdd.get(m)) for m in ("method3", "finish", "bin7", "joint", "round_given_fin",
                                                       "method_given_winner", "winner")])
    L.append(_md_table(["Paired difference", "Method", "Finish", "7-bin", "Joint", "Round given finish",
                        "Method given winner", "Winner"], rows))
    L.append("\nNegative = the first model is better. The differences are on the same fights, so their CIs are "
             "much tighter than the CIs of the levels.\n")
    if sm["n"]:
        L.append("### Versus the market's method and round props\n")
        mm = sm["metrics"]
        rows = []
        for k, lab in (("base_division_elo", "Base rates x Elo"), ("S", "Model S"), ("SM", "Model SM"),
                       ("market_props", "Market props (US books, power de-vig, averaged)"),
                       ("SM_market_blend", "SM + market blend (a=%.1f)" % ch["a_market"]),
                       ("SM_refit_market_blend", "SM refit + market blend")):
            rows.append([lab] + [_ci(mm[k].get(m)) for m in ("method3", "finish", "ko_vs_sub", "round_given_fin",
                                                             "method_given_winner", "bin7", "joint", "winner")])
        L.append(_md_table(["Model", "Method", "Finish", "KO vs SUB", "Round given finish", "Method given winner",
                            "7-bin", "Joint", "Winner"], rows))
        L.append("")
        rows = []
        for k, lab in (("SM_minus_market", "SM - market"), ("S_minus_market", "S - market"),
                       ("blend_minus_market", "blend - market"), ("blend_minus_SM", "blend - SM")):
            pdd = sm["paired"][k]
            rows.append([lab] + [_dci(pdd.get(m)) for m in ("method3", "finish", "ko_vs_sub", "round_given_fin",
                                                           "method_given_winner", "bin7", "joint")])
        L.append(_md_table(["Paired difference", "Method", "Finish", "KO vs SUB", "Round given finish",
                            "Method given winner", "7-bin", "Joint"], rows))
        L.append("\nThe market props come from `data/derived/market.json` (tools/market.py): per-book closing "
                 "\"wins by KO/TKO / submission / decision\" prices, power-normalised and averaged over US books, "
                 "spread over rounds with the books' \"fight ends in round k\" props. They exist from 2021 on.%s\n"
                 % _market_provenance(o["meta"]))
    L.append("## Calibration (held out, model S)\n")
    cs = te["calibration"]["S"]
    rows = []
    for k in ("KO", "SUB", "DEC", "FINISH", "win_KO", "win_SUB", "win_DEC"):
        c = cs[k]
        rows.append([k, c["n"], "%.3f" % c["mean_pred"], "%.3f" % c["mean_obs"], "%.3f" % c["ece"],
                     "%.2f" % c["slope"], "%.2f" % c["intercept"]])
    L.append(_md_table(["Event", "n", "Mean predicted", "Observed", "ECE", "Slope", "Intercept"], rows))
    L.append("\nSlope = logistic recalibration slope of the outcome on logit(p) (1 = calibrated, < 1 = "
             "overconfident, > 1 = underconfident). win_* pool both corners (two rows per fight).\n")
    for k in ("KO", "SUB", "DEC"):
        c = cs[k]
        L.append("**P(%s) by decile:** " % k + "; ".join("%.2f→%.2f (n=%d)" % (r["pred"], r["obs"], r["n"])
                                                        for r in c["bins"]) + "\n")
    br = cs["by_round"]
    for key, v in br.items():
        rows = [[r["round"], "%.3f" % r["pred_ko"], "%.3f" % r["obs_ko"], "%.3f" % r["pred_sub"], "%.3f" % r["obs_sub"]]
                for r in v["rounds"]]
        rows.append(["decision", "%.3f" % v["pred_dec"], "%.3f" % v["obs_dec"], "", ""])
        L.append("**Finishing round, %s bouts (n=%d)**\n" % (key.replace("_", " "), v["n"]))
        L.append(_md_table(["Round", "P(KO) pred", "KO obs", "P(SUB) pred", "SUB obs"], rows))
        L.append("")
    L.append("## By division and format (held out)\n")
    rows = [[d["division"], d["n"], "%.2f/%.2f/%.2f" % (d["pred_ko"], d["pred_sub"], d["pred_dec"]),
             "%.2f/%.2f/%.2f" % (d["obs_ko"], d["obs_sub"], d["obs_dec"]), "%.4f" % d["method3_S"],
             "%.4f" % d["method3_base"], "%.4f" % d["joint_S"], "%.4f" % d["joint_base"]] for d in te["by_division"]]
    L.append(_md_table(["Division", "n", "Pred KO/SUB/DEC", "Obs KO/SUB/DEC", "Method LL S", "Method LL base",
                        "Joint LL S", "Joint LL base"], rows))
    L.append("")
    rows = []
    for r in te["by_format"]:
        rows.append(["%d rounds" % r["rounds"], r["n"]] + ["%.4f / %.4f" % (r["S"][k], r["base_division"][k])
                                                           for k in ("method3", "finish", "round_given_fin", "joint")])
    L.append(_md_table(["Format", "n", "Method S/base", "Finish S/base", "Round|fin S/base", "Joint S/base"], rows))
    L.append("")
    rows = [[r["year"], r["n"], "%.4f" % r["S"]["method3"], "%.4f" % r["S_refit"]["method3"],
             "%.4f" % r["SM"]["method3"], "%.4f" % r["base_division"]["method3"], "%.4f" % r["S"]["joint"],
             "%.4f" % r["base_division"]["joint"]] for r in te["by_year"]]
    L.append(_md_table(["Year", "n", "Method S", "Method S refit", "Method SM", "Method base", "Joint S",
                        "Joint base"], rows))
    L.append("")
    L.append("## How to use the outputs\n")
    L.append("""- `fights[id]` (every backtest.json fight, 2019+): `S` and `SM` hold the joint as A KO r1..R, A SUB r1..R,
  B KO r1..R, B SUB r1..R, A dec, B dec, draw (R = scheduled rounds, A = first ufcstats name); `sum_S` has P(finish),
  P(KO), P(SUB), P(dec), P(A), P(B) and the 7 bins; `fit_through` says which fit produced it (2019-2023 are
  out-of-fold, 2024+ the fit through 2023; `S_refit` / `SM_refit` for 2025-2026).
- `roster[slug]`: each fighter's win/lose-by-method shares against his current division field.
- `js_model` + `tools/methodround_model.js`: `MethodRound.create(js_model).predict(profA, profB, {slugA, slugB,
  division, rounds, title, date, pMarketA})` with fighters.json profiles; returns the cells, bins7, finish-round
  distribution and method-given-win for each fighter (S without `pMarketA`, SM with it).
- Score the simulator (or any model) on the same fights and metrics: write `{fight_id: {"cells": [...]}}` (same
  layout as above) or `{fight_id: {"bins7": [...], "fin_round": [...]}}` and run
  `python3 tools/methodround.py --score sim.json` (paired event-cluster bootstrap against model S).
""")
    L.append("## Method\n")
    L.append("""**Data.** Every UFC bout in the ufcstats snapshot, parsed with `tools/build_db.py`'s own loaders so
people, aliases and Elo match the pipeline. A walk-forward pass over all %d bouts since 2008 (both fighters with an
earlier UFC bout) snapshots each fighter before every fight: the 730-day decayed sums `S` (identical to
backtest.json, checked to 5e-4 relative), career sums `C`, the career record by method over every bout (also bouts
without round stats), finishing-time tendencies, last result, streak, layoff, age, pre-fight Elo, mean opponent
Elo and physicals. Same-day bouts never see each other. Division priors come from the five calendar years before
the fight's year (`build_db.build_priors`), the same rule as `backtest.json` `priors_asof`.

**Outcome space.** {A, B} x {KO/TKO, submission} x round 1..R, plus A by decision, B by decision and draw (R = 3 or
5 scheduled rounds). KO/TKO includes doctor and corner stoppages. Every reported target is a marginal of this joint.

**Features (%d, all pre-fight).** Per side, shrunk toward the bout's division prior (pseudo-exposure: %s fights for
per-fight result rates, %s minutes for per-minute rates, %s landed head strikes for knockdown power and chin, %s
attempts for accuracies, %s submission attempts for conversion): KO/sub wins and losses per fight and per 15
minutes, decision share, knockdowns scored/absorbed per 15, KD per landed head strike (power) and absorbed per head
strike taken (chin), strikes landed/absorbed, accuracy and defence, takedowns landed/absorbed, takedown accuracy
and defence, control share both ways, ground strikes both ways, submission attempts both ways, submission
conversion and defence, minutes per fight; the same finishing and grappling rates from undecayed career sums;
career record rates; mean minute and round-1 share of his finishes / finished losses; age, years past 30,
experience, KO losses, knockdowns absorbed (career), KO losses x age, layoff, last-fight KO loss, streak.
Matchup terms: log5-style attacker x defender intensities (KO hazard, sub hazard, KD rate, KD power vs chin,
strike volume, takedowns, control, ground strikes, sub attempts, sub conversion), symmetric fight-length
tendencies, Elo difference and its absolute value, height/reach/age differences, open stance; fight terms:
division weight, heavyweight, women, 5 rounds, title, catch weight, year, and the division's prior KO/sub rates and
minutes per fight. SM adds the closing-line log-odds (power de-vig) and its absolute value.

**Models.**
1. *Who-and-how:* a multinomial logit over six outcomes (A KO, A SUB, A DEC, B DEC, B SUB, B KO) with an L2
   penalty on standardized coefficients (C = %s for S, %s for SM, per-observation scale), recency weights
   (half-life %d years), trained on 2012+ (S) / 2013+ (SM) fights. Every fight is used in both orientations and
   predictions average the two, so the A/B corner (A wins 56%%) never leaks and swapping fighters swaps the
   probabilities exactly. SM replaces the six-class model's winner share with a separate symmetric winner logit
   (C = %s) and keeps its method-given-winner shares.
2. *When:* a discrete-time competing-risks model: per round, a multinomial logit over {no finish, A KO, A SUB, B KO,
   B SUB} with separate unpenalized baseline hazards for each round of 3- and 5-round bouts and 37 shared
   finishing-tendency features (C = %s), trained on 2008+ fight-rounds in both orientations; a symmetric logit
   picks the decision winner. Its conditional round shapes (P(round r | A KO), ...) spread the six-class
   probabilities over rounds; a draw takes %.2f%% of the decision mass.
3. *Market blend (live only):* when US-book method props exist, (1 - a) x SM + a x market joint, a = %.1f chosen on
   2021-2023.

**What did not earn a place (tuning-period CV, 2020-2023 validation years):** LightGBM six-class models
(method LL about 0.008 worse than the logit; a 30%% blend gained 0.001 joint LL, not worth the opacity or the
page size); a post-hoc temperature + per-method bias recalibration (no gain under leave-one-year-out); shorter
recency half-lives (3-4 years slightly worse); training from 2008 (slightly worse than 2012 for the six-class
model); a factorized winner x method-given-winner model (better winner, worse method; its winner part is reused
in SM). Feature-group ablations: grappling, submission, fight-length tendencies and division terms carry the
method signal; striking volume, age/experience and Elo carry the winner signal; recent-form and durability
groups are roughly neutral for method (kept for the winner and for the page). These comparisons are not executed
by `run()` (the LightGBM, factorized and recalibration classes are kept for reference only), and the fixed
settings (half-life, training start, shrinkage, feature list) were set during development; `python3
tools/methodround_verify.py` re-runs both checks on the same folds (see the Verification log).

**Tuning (expanding window, validation years 2020-2023):**
""" % (o["meta"]["n_fights_table"], len(o["js_model"]["c6"]["S"]["cols"]), SHRINK["k_fight"], SHRINK["k_min"],
       SHRINK["k_head"], SHRINK["k_att"], SHRINK["k_sub"], ch["C6_S"], ch["C6_SM"], HL_YEARS, ch["C_win"],
       ch["C_haz"], 100 * o["js_model"]["draw_c"], ch["a_market"]))
    cv = o["tuning"]["cv"]
    rows = [["S", "C6=%g" % r["C6"], "%.4f" % r["method3"], "%.4f" % r["joint"], "%.4f" % r["winner"]] for r in cv["S"]]
    rows += [["SM", "C6=%g, C_win=%g" % (r["C6"], r["C_win"]), "%.4f" % r["method3"], "%.4f" % r["joint"],
              "%.4f" % r["winner"]] for r in cv["SM"]]
    rows += [["hazard", "C_haz=%g" % r["C_haz"], "%.4f" % r["method3"], "%.4f" % r["joint"],
              "rgf %.4f" % r["round_given_fin"]] for r in cv["hazard"]]
    L.append(_md_table(["Part", "Setting", "Method LL", "Joint LL", "Winner LL"], rows))
    if cv["market_blend"]:
        L.append("\nMarket blend on the %d 2021-2023 fights with props: " % cv["market_blend"][0]["n"]
                 + "; ".join("a=%.1f joint %.4f method %.4f" % (r["a_market"], r["joint"], r["method3"])
                             for r in cv["market_blend"]) + ".\n")
    oof = o["tuning"].get("oof_2019_2023")
    if oof:
        L.append("Walk-forward out-of-fold 2019-2023 (each year predicted by a fit through the previous Dec 31; "
                 "the hyperparameters were chosen on 2020-2023, so these are tuning-period numbers, not held out; "
                 "n=%d): S method %.4f / joint %.4f / winner %.4f; base rates method %.4f / joint %.4f; base x Elo "
                 "winner %.4f.\n" % (oof["n"], oof["S"]["method3"], oof["S"]["joint"], oof["S"]["winner"],
                                     oof["base_division"]["method3"], oof["base_division"]["joint"],
                                     oof["base_division_elo"]["winner"]))
    L.append("## Roster and the default matchup\n")
    for k, v in o["matchups"].items():
        b7 = v["bins7"]
        L.append("- **Volkanovski vs Gaethje, 5 x 5 at 155, %s:** Volk %.1f%% (KO %.1f, sub %.1f, dec %.1f), Gaethje "
                 "%.1f%% (KO %.1f, sub %.1f, dec %.1f), draw %.1f%%; finish %.1f%% (KO/TKO %.1f%%, sub %.1f%%); "
                 "finish by round %s." % (v["note"], 100 * v["p_A"], 100 * b7["A_KO"], 100 * b7["A_SUB"],
                                          100 * b7["A_DEC"], 100 * v["p_B"], 100 * b7["B_KO"], 100 * b7["B_SUB"],
                                          100 * b7["B_DEC"], 100 * b7["draw"], 100 * v["p_finish"],
                                          100 * v["p_ko"], 100 * v["p_sub"],
                                          ", ".join("%.1f" % (100 * x) for x in v["finish_round"])))
    ro = o["roster"]
    L.append("- `roster[slug]`: %d fighters, P(win/lose by KO, SUB, decision), P(finish) and method-given-win, "
             "averaged over everyone in the fighter's division with a UFC fight since %s (3 rounds, stats-only "
             "model fit through the snapshot)." % (len(ro), LIVE_FIELD_SINCE.isoformat()))
    top = sorted(ro.items(), key=lambda kv: -kv[1]["vs_field"]["win_ko"])[:5]
    L.append("  Highest P(win by KO/TKO) vs their division field: " + "; ".join(
        "%s %.0f%%" % (k, 100 * v["vs_field"]["win_ko"]) for k, v in top) + ".")
    tops = sorted(ro.items(), key=lambda kv: -kv[1]["vs_field"]["win_sub"])[:5]
    L.append("  Highest P(win by submission): " + "; ".join("%s %.0f%%" % (k, 100 * v["vs_field"]["win_sub"])
                                                         for k, v in tops) + ".")
    jc = o["js_check"]
    L.append("- JS model (`js_model` in the JSON, evaluator `tools/methodround_model.js`, fit through the snapshot): "
             "%s; Python vs node on %s random roster matchups, max abs difference %s."
             % ("verified" if jc.get("ok") else "CHECK FAILED", jc.get("cases"), jc.get("max_abs_diff")))
    L.append("")
    L.append("## Recommendation for the final ensemble\n")
    mgw = te["paired"]["S_minus_base_division_elo"].get("method_given_winner", {})
    rnd_txt = "n/a"
    if sm["n"]:
        dm = sm["paired"]["SM_minus_market"]
        rnd_txt = ("SM - market on the 2024+ props subset: method %s, KO vs SUB %s, round given finish %s, method "
                   "given winner %s" % (_dci(dm.get("method3")), _dci(dm.get("ko_vs_sub")),
                                        _dci(dm.get("round_given_fin")), _dci(dm.get("method_given_winner"))))
    L.append("Evidence behind the recommendations: method given the actual winner, S - base rates %s; %s.\n"
             % (_dci(mgw), rnd_txt))
    L.append("""1. **Use this model as the method/round prior and as the yardstick for the simulator.** The v3+ engine's
   simulated method distribution should be scored on the same held-out fights with the same metrics (method
   3-class LL, finish LL, round-given-finish LL, 7-bin and joint LL, plus the calibration tables above):
   `python3 tools/methodround.py --score sim.json`. If the engine does not beat model S on method and round, the
   page should take its method/round split from here and use the engine for the play-by-play and the story.
2. **Factorize the final forecast:** P(A wins) from the winner ensemble (market + Elo + engine + this model's
   winner), then P(method, round | winner) from this model's conditional shares (`methodGivenWin` in the JS
   output; the per-fight cells give the same). That keeps the winner question with the stack and uses this
   model for what it was built for (the evidence line above gives its method-given-winner edge over base
   rates). When method props are posted, take the conditional shares from the SM + market blend instead: on
   method given the winner the props beat SM clearly (see item 3), so this model's shares are the fallback
   for fights without props, not a replacement for them.""")
    if sm["n"]:
        dm, db = sm["paired"]["SM_minus_market"], sm["paired"]["blend_minus_market"]
        L.append("""3. **Live, with a line:** use SM, and when method props are posted, blend with them (weight a in the meta).
   The props beat SM on the 3-class method (%s, borderline: not robust to small changes in the props set)
   and clearly on method given the winner
   (%s); finish vs decision (%s) and KO vs submission (%s) lean the same way but neither is significant on its
   own (the props price in pre-UFC records, camp news and styles the stats do not see). The model matches them
   on the finishing round (%s), and the blend is within noise of the props or better on every target (method
   %s, joint %s, winner %s).""" % (_dci(dm.get("method3")), _dci(dm.get("method_given_winner")),
                                    _dci(dm.get("finish")), _dci(dm.get("ko_vs_sub")), _dci(dm.get("round_given_fin")),
                                    _dci(db.get("method3")), _dci(db.get("joint")), _dci(db.get("winner"))))
    else:
        L.append("3. **Live, with a line:** use SM, and when method props are posted, blend with them (weight a in "
                 "the meta).")
    L.append("""4. **Without a line** (hypothetical matchups such as Volkanovski vs Gaethje before odds): use S.
5. Natural next inputs: pre-UFC records (tools/preufc.py; Sherdog crawl was incomplete when this ran, so it is not
   used), opponent-adjusted rates (tools/oppadj.py) and the durability model's chin/power estimates
   (data/derived/durability.json) as extra features; refit with `python3 tools/methodround.py`.
""")
    L.append("## Limitations\n")
    if sm["n"]:
        L.append("- Method and round are noisy targets: on the held-out props subset the market's method log loss is "
                 "%.3f against %.3f for base rates x Elo (uniform over three classes: 1.099). Gains of 0.01-0.05 "
                 "in log loss are what good looks like here." % (sm["metrics"]["market_props"]["method3"]["mean"],
                                                                 sm["metrics"]["base_division_elo"]["method3"]["mean"]))
    L.append("""- The stats-only variant knows nothing about weight-class moves, injuries, camp changes or pre-UFC
  records; for Volkanovski vs Gaethje it favours Volkanovski on his UFC numbers while the market makes Gaethje a
  clear favourite. Use SM (or the winner ensemble) whenever a line exists.
- Draws are a fixed share of decision outcomes; DQ and no-contests are not modelled (excluded from scoring).
- The SM variant needs the closing line; scored on 2024+ it is a live model, not a fight-week forecast.
- The market props benchmark covers fights with US-book props (2021+) and uses averaged, power-normalised
  prices; a single sharp book could be stronger.
- Roster outputs are averages over the current division field with the stats-only model; they describe
  tendencies, not any particular matchup.
""")
    # keep a reviewer's "## Verification log" (appended by hand / tools/methodround_verify.py) across rebuilds
    keep = ""
    if os.path.exists(OUT_MD):
        old = open(OUT_MD).read()
        j = old.find("\n## Verification log")
        if j >= 0:
            keep = old[j:]
    with open(OUT_MD, "w") as fh:
        fh.write("\n".join(L).rstrip("\n") + "\n" + keep)


def expand_cells(v, R):
    """Compact per-fight list (A KO r1..R, A SUB r1..R, B KO r1..R, B SUB r1..R, A DEC, B DEC, DRAW) -> joint."""
    P = np.zeros(NC_)
    v = np.asarray(v, float)
    P[I_XKO:I_XKO + R], P[I_XSUB:I_XSUB + R] = v[0:R], v[R:2 * R]
    P[I_YKO:I_YKO + R], P[I_YSUB:I_YSUB + R] = v[2 * R:3 * R], v[3 * R:4 * R]
    P[[I_XDEC, I_YDEC, I_DRAW]] = v[4 * R:4 * R + 3]
    return P


def score(path, period_from="2024-01-01", period_until=None, out=None, backtest=None):
    """Score another model (e.g. the simulator) on the same fights and metrics as this benchmark.
    Input JSON: {fight_id: {"cells": [compact list as in methodround.json]}} or {fight_id: {"bins7": [A KO, A SUB,
    A DEC, draw, B DEC, B SUB, B KO], "fin_round": [P(finish in r1..R), optional]}} with A/B as in backtest.json.
    period_until (exclusive) bounds the scored dates; out writes the metrics as JSON (tools/evalv.js); backtest
    points at another backtest file (tools/evalv.js passes backtest_dev.json, which never holds a 2026 fight)."""
    bt = {f["id"]: f for f in json.load(open(backtest or BACKTEST))["fights"]}
    mr = json.load(open(OUT_JSON))["fights"]
    sub = json.load(open(path))
    ids = [i for i in sub if i in bt and i in mr and bt[i]["date"] >= period_from and "S" in mr[i]
           and (period_until is None or bt[i]["date"] < period_until)]
    rows = []
    for i in ids:
        f = bt[i]
        res = f["result"]
        cls = {"KO": "KO", "DOC": "KO", "SUB": "SUB", "UD": "DEC", "SD": "DEC", "MD": "DEC", "DRAW": "DRAW"}.get(
            res["method"])
        rows.append({"id": i, "rounds": 5 if f["rounds"] == 5 else 3, "cls": cls if res["winner"] in "ABD" else None,
                     "winner": res["winner"], "rnd": res["round"], "event": f["event"]})
    T = pd.DataFrame(rows)
    y = outcome_cells(T)
    Pm = np.stack([expand_cells(mr[i]["S"], R) for i, R in zip(T["id"], T["rounds"])])
    Ps = np.zeros_like(Pm)
    has_rounds = True
    for k, (i, R) in enumerate(zip(T["id"], T["rounds"])):
        e = sub[i]
        if "cells" in e:
            Ps[k] = expand_cells(e["cells"], R)
            continue
        b7 = np.asarray(e["bins7"], float)
        if "fin_round" in e:
            shape = np.asarray(e["fin_round"][:R], float)
        else:
            has_rounds = False
            shape = Pm[k, I_XKO:I_XKO + R] + Pm[k, I_XSUB:I_XSUB + R] + Pm[k, I_YKO:I_YKO + R] + Pm[k, I_YSUB:I_YSUB + R]
        shape = shape / max(shape.sum(), 1e-12)
        Ps[k, I_XKO:I_XKO + R], Ps[k, I_XSUB:I_XSUB + R] = b7[0] * shape, b7[1] * shape
        Ps[k, I_YKO:I_YKO + R], Ps[k, I_YSUB:I_YSUB + R] = b7[6] * shape, b7[5] * shape
        Ps[k, [I_XDEC, I_DRAW, I_YDEC]] = b7[2], b7[3], b7[4]
    ok = y >= 0
    Ls = per_fight_losses(Ps[ok], y[ok], T[ok])
    Lm = per_fight_losses(Pm[ok], y[ok], T[ok])
    _, st = cluster_bootstrap({"x": Ls}, T["event"][ok].to_numpy(), B=2000)
    d = paired_diff(Ls, Lm, st, METRICS)
    keys = METRICS if has_rounds else [m for m in METRICS if m not in ("joint", "method_round", "round_given_fin")]
    print("scored %d fights from %s%s (submission vs methodround model S, walk-forward)" % (
        ok.sum(), period_from, (" to " + period_until) if period_until else ""))
    for m in keys:
        if m in d:
            print("  %-16s submitted %.4f  model S %.4f  diff %+.4f [%+.4f, %+.4f]" % (
                m, np.nanmean(Ls[m]), np.nanmean(Lm[m]), d[m]["diff"], d[m]["ci95"][0], d[m]["ci95"][1]))
    if out:
        res = {"n": int(ok.sum()), "from": period_from, "until": period_until, "has_rounds": has_rounds,
               "metrics": {m: {"submitted": float(np.nanmean(Ls[m])), "model_S": float(np.nanmean(Lm[m])),
                               "diff": d[m]["diff"], "ci95": d[m]["ci95"]} for m in keys if m in d}}
        with open(out, "w") as fh:
            json.dump(res, fh, indent=1)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--quick", action="store_true", help="small grids, no 2019-2023 out-of-fold fits, 400 bootstraps")
    ap.add_argument("--score", metavar="JSON", help="score another model's per-fight predictions against this "
                                                    "benchmark (see score()) instead of fitting")
    ap.add_argument("--score-from", default="2024-01-01", help="first fight date scored with --score")
    ap.add_argument("--score-until", default=None, help="scored dates are before this (exclusive; default: no bound)")
    ap.add_argument("--score-out", default=None, help="write the --score metrics to this JSON file")
    ap.add_argument("--backtest", default=None, help="backtest file for --score (default data/derived/backtest.json)")
    ap.add_argument("--report", action="store_true", help="rewrite the markdown report from the existing JSON")
    args = ap.parse_args(argv)
    if args.score:
        score(args.score, args.score_from, args.score_until, args.score_out, args.backtest)
    elif args.report:
        write_report(json.load(open(OUT_JSON)))
        print("wrote", OUT_MD)
    else:
        run(args)


if __name__ == "__main__":
    main()
