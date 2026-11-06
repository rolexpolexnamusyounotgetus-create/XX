#!/usr/bin/env python3
"""Method-and-round model: P(KO/TKO), P(submission), P(decision), the finishing round, and who wins how.

Run from the project root (about 3-6 minutes on 4 cores):

    python3 tools/methodround.py                 # build features, tune on 2019-2023, report on 2024+, write outputs
    python3 tools/methodround.py --quick         # fewer bootstrap draws and a smaller tuning grid (smoke test)

Reads   data/raw/*.csv (through tools/build_db.py's loaders, so people, aliases and Elo match the pipeline),
        data/derived/fighters.json (roster outputs), and, when present, the method-prop odds of the
        Ultimate UFC Dataset (ufc-master.csv; pass --uud PATH) as a market benchmark.
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
    L["winner_acc"] = np.where(dec_ok, ((pa > 0.5) == a_won) * 1.0 + (pa == 0.5) * 0.5, np.nan)
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
METRICS = ["joint", "method3", "finish", "bin7", "method_round", "round_given_fin", "ko_vs_sub", "winner",
           "winner_brier", "winner_acc", "method3_brier"]


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
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return None if np.isnan(o) else float(o)
    if isinstance(o, (dt.date,)):
        return o.isoformat()
    if isinstance(o, np.ndarray):
        return o.tolist()
    raise TypeError(type(o))
