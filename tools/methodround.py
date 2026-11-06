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
