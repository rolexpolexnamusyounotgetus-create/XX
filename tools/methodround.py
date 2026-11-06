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
    _, elo_pre, _ = B.run_elo(fights, ELO_K, ELO_BOOST, store=True)
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
    return T, priors, fights, people, state


# ============================================================== 2. features
WOMEN = {"Women's Strawweight", "Women's Flyweight", "Women's Bantamweight", "Women's Featherweight"}
PRIOR_FIELDS = ["min", "n", "ko_w", "ko_l", "sub_w", "sub_l", "dec_w", "dec_l", "kd", "okd", "h_lnd", "oh_lnd",
                "d_lnd", "c_lnd", "g_lnd", "d_att", "c_att", "g_att", "td_lnd", "td_att", "ctrl", "sub_att", "l_lnd",
                "t_att", "kd_per_h", "acc_sig", "td_acc", "sub_conv", "mpf"]

# shrinkage strengths (pseudo-exposure toward the division prior); tuned values are written to the JSON
SHRINK = {"k_fight": 3.0,      # fights, for per-fight result rates
          "k_min": 30.0,       # minutes, for per-minute rates
          "k_head": 300.0,     # landed head strikes, for knockdown power / chin
          "k_att": 150.0,      # attempts, for accuracies
          "k_sub": 6.0}        # submission attempts, for conversion / defence


def prior_frame(T, priors):
    """Per-row prior rates (division of the bout, or the heavier home division for catch weights)."""
    out = {k: np.empty(len(T)) for k in PRIOR_FIELDS + ["lbs"]}
    for i, (y, d) in enumerate(zip(T["year"], T["prior_div"])):
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
    return F


def lg(x, eps=1e-4):
    return np.log(np.maximum(x, eps))


def logit(p, eps=1e-4):
    p = np.clip(p, eps, 1 - eps)
    return np.log(p / (1 - p))


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
