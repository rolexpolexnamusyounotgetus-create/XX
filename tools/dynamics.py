#!/usr/bin/env python3
"""
dynamics.py - v6 FIGHT DYNAMICS fits from round-level UFC stats.

Five studies, all walk-forward (fit on fights 2019-01-01..2023-12-31, report on 2024-01-01..snapshot;
2010-2018 used only as a labeled robustness extension, never the test period):

  1. state effects: output (sig attempts / min), accuracy, takedown attempts and control in round r as a
     function of what happened earlier in the same fight (head strikes and knockdowns absorbed, own output,
     control time both ways, takedowns), round number and 3- vs 5-round format;
  2. per-fighter late-round output ratios with hierarchical (empirical-Bayes) shrinkage, and a held-out test
     of whether past ratios predict future ones (vs the engine's current kPace rule);
  3. between-round adaptation: does losing round r (judges' consensus from the cards where known, or the
     sig-strike differential) change output, takedown attempts or accuracy in round r+1;
  4. momentum after knockdowns: next-round rates of the scorer and of the man who was dropped;
  5. finish hazard vs accumulated damage: knockdowns per landed standing head strike, knockdown-to-finish
     conversion and non-knockdown stoppages as functions of damage absorbed in earlier rounds, with a
     gamma frailty per fighter-fight (the engine's fight-night form draws play that role).

Estimators: the dynamic random-effects models use the z-transform likelihood (covariates that are
functions of earlier-round outcomes are predetermined; the process starts fresh in round 1, so there is no
initial-conditions problem). Naive within-fight fixed-effects fits are reported next to them to show the
mean-reversion bias they carry. A round-level simulator (null and fitted) checks that the fitted models
reproduce the held-out auxiliary statistics.

Inputs:  data/raw/*.csv (via tools/baserates.load_data and tools/build_db people resolution),
         data/derived/backtest.json (engine pace fields, for the kPace check)
Outputs: data/derived/dynamics.json; tables printed; the report is research/model_dynamics.md

Usage:   python3 tools/dynamics.py            (about 2-4 minutes)
         python3 tools/dynamics.py --quick    (skips bootstrap and simulation checks)
"""
import argparse
import datetime as dt
import json
import math
import os
import sys
import time
from collections import defaultdict

import numpy as np
import pandas as pd
from scipy import optimize, special, stats

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import baserates as br  # noqa: E402
import build_db as bd   # noqa: E402

OUT_JSON = os.path.join(ROOT, "data", "derived", "dynamics.json")
FMT3, FMT5 = br.FMT3, br.FMT5
TRAIN = ("2019-01-01", "2023-12-31")
EXT = ("2010-01-01", "2018-12-31")
TEST = ("2024-01-01", "2099-12-31")
RNG = np.random.default_rng(20261106)


# ================================================================================================
# panel
# ================================================================================================
def build_panel():
    """One row per fighter-round with outcomes, opponent outcomes, cumulative (earlier-round) state and
    lagged round results. Only 3x5 and 5x5 formats."""
    F, S, notes, data_max = br.load_data(os.path.join(ROOT, "data", "raw"), "2001-01-01")
    F = F[F.has_stats & F.fmt.isin([FMT3, FMT5])].copy()
    S = S[S.fid.isin(F.fid)].copy()
    # people ids (namesakes resolved by build_db)
    log = {}
    fights, _ = bd.parse_fights(log)
    bd.build_people(fights, log)
    pid = {}
    for f in fights:
        if f.persons:
            pid[(f.fid, 0)] = f.persons[0]
            pid[(f.fid, 1)] = f.persons[1]
    F["fkey"] = F.fid.map(bd.url_id)
    S["fkey"] = S.fid.map(bd.url_id)
    S["pid"] = [pid.get((k, i)) for k, i in zip(S.fkey, S.idx)]
    S["opid"] = [pid.get((k, 1 - i)) for k, i in zip(S.fkey, S.idx)]
    S = S.merge(F[["fid", "DATE", "division", "title", "five", "ko_target", "ko_pos", "METHOD", "det", "REFEREE"]],
                on="fid", how="left")
    S["R"] = np.where(S.five, 5, 3)
    S = S.sort_values(["DATE", "fid", "idx", "rnd"]).reset_index(drop=True)
    # standing head landed (ufcstats does not cross head x position): midpoint of the bounds, as baserates
    for p in ("", "o_"):
        pass
    lo = (S.head_l - S.ground_l).clip(lower=0)
    hi = np.minimum(S.head_l, S.dist_l + S.clinch_l)
    S["sh_l"] = (lo + hi) / 2
    O = S[["fid", "rnd", "idx", "sh_l", "head_a", "sig_a", "tot_a", "dist_a", "clinch_a", "ground_a", "body_a",
           "leg_a"]].copy()
    O["idx"] = 1 - O["idx"]
    O = O.rename(columns={c: "o_" + c for c in ["sh_l", "head_a", "sig_a", "tot_a", "dist_a", "clinch_a",
                                                "ground_a", "body_a", "leg_a"]})
    S = S.drop(columns=[c for c in ["o_sig_a", "o_tot_a"] if c in S.columns]).merge(O, on=["fid", "rnd", "idx"],
                                                                                   how="left")
    S["mins"] = S.rsec / 60.0
    S["full"] = S.rsec >= 300
    S["last"] = S.rnd == S.end_round
    # fight end, from the point of view of the row's fighter
    won = S.winner == S.idx
    lost = S.winner == (1 - S.idx)
    ko = S.cat.eq("KO/TKO")
    strikes = S.ko_kind.eq("strikes")
    S["fin_ko_against"] = (S["last"] & ko & strikes & lost).astype(int)    # stopped by strikes (KO/TKO/GNP)
    S["fin_ko_for"] = (S["last"] & ko & strikes & won).astype(int)
    S["fin_sub_against"] = (S["last"] & S.cat.eq("SUB") & lost).astype(int)
    S["fin_sub_for"] = (S["last"] & S.cat.eq("SUB") & won).astype(int)
    S["fin_other_against"] = (S["last"] & ko & ~strikes & lost).astype(int)  # doctor, corner, injury
    S["fin_ground"] = S.ko_pos.eq("ground") if "ko_pos" in S else False
    # cumulative state before the round (same fight, same fighter): sums over earlier rounds
    cum_src = {
        "c_att": "sig_a", "c_tot": "tot_a", "c_lnd": "sig_l", "c_hl": "head_l", "c_tda": "td_a", "c_tdl": "td_l",
        "c_ctrl": "ctrl", "c_kd": "kd", "c_sub": "sub",
        "c_oatt": "o_sig_a", "c_ohl": "o_head_l", "c_osl": "o_sig_l", "c_osh": "o_sh_l", "c_obl": "o_body_l",
        "c_oll": "o_leg_l", "c_ogl": "o_ground_l", "c_okd": "o_kd", "c_otdl": "o_td_l", "c_otda": "o_td_a",
        "c_octrl": "o_ctrl", "c_osub": "o_sub", "c_otot": "o_tot_l",
    }
    g = S.groupby(["fid", "idx"], sort=False)
    for c, src in cum_src.items():
        S[c] = g[src].cumsum() - S[src]
    S["c_min"] = g["mins"].cumsum() - S["mins"]
    # lagged (previous round) quantities
    lag_src = {"l_sigl": "sig_l", "l_osigl": "o_sig_l", "l_att": "sig_a", "l_oatt": "o_sig_a", "l_kd": "kd",
               "l_okd": "o_kd", "l_hl": "head_l", "l_ohl": "o_head_l", "l_tdl": "td_l", "l_otdl": "o_td_l",
               "l_ctrl": "ctrl", "l_octrl": "o_ctrl", "l_tda": "td_a", "l_acc_l": "sig_l", "l_sub": "sub",
               "l_osub": "o_sub", "l_bl": "body_l", "l_ll": "leg_l", "l_obl": "o_body_l", "l_oll": "o_leg_l"}
    for c, src in lag_src.items():
        S[c] = g[src].shift(1)
    S["year"] = S.DATE.dt.year
    S["period"] = np.select([(S.DATE >= TRAIN[0]) & (S.DATE <= TRAIN[1]), (S.DATE >= TEST[0]),
                             (S.DATE >= EXT[0]) & (S.DATE <= EXT[1])], ["train", "test", "ext"], "old")
    return F, S, notes


# ================================================================================================
# judges' round labels
# ================================================================================================
def card_rounds_lost(cards, R):
    """cards: list of (name, loser_total, winner_total). Returns per card k = rounds the FIGHT LOSER won,
    assuming no 10-10 rounds and no 10-8 against the fight winner; None where inconsistent."""
    out = []
    for _, lt, wt in cards:
        k = 10 * R - wt
        e = 9 * R + k - lt     # 10-8 rounds won by the fight winner
        out.append(k if (0 <= k <= R and 0 <= e <= R) else None)
    return out


def judge_labels(F, S, coef):
    """Soft label P(fighter lost round r on a judge's card), averaged over the three judges, for decisions that
    went the distance. Which round(s) the loser won on a card is inferred from round stats with the round
    logistic model (coef): P(subset A) proportional to prod_{r in A} odds_r(loser) over subsets of size k."""
    from itertools import combinations
    d = F[F.cat.isin(["U-DEC", "S-DEC", "M-DEC"]) & (F.end_round == F.sched) & (F.end_sec == 300)].copy()
    d["cards"] = d.det.map(br.parse_cards)
    d = d[d.cards.map(len) == 3]
    feats = list(coef.keys())
    s = S[S.fid.isin(d.fid)].copy()
    s["ctrl_min"] = s.ctrl / 60
    o = s.copy()
    lab = {}
    piv = {}
    for (fid, idx), x in s.groupby(["fid", "idx"]):
        piv[(fid, idx)] = x.sort_values("rnd")
    nk = 0
    sure = {}
    for r in d.itertuples(index=False):
        R = int(r.sched)
        W, L = int(r.winner), 1 - int(r.winner)
        if (r.fid, W) not in piv or (r.fid, L) not in piv:
            continue
        xw, xl = piv[(r.fid, W)], piv[(r.fid, L)]
        if len(xw) != R or len(xl) != R:
            continue
        diff = np.zeros(R)
        for f_, c_ in coef.items():
            col = f_
            diff += c_ * (xl[col].to_numpy() - xw[col].to_numpy())
        odds = np.exp(np.clip(diff, -30, 30))      # odds that the fight loser won each round
        ks = card_rounds_lost(r.cards, R)
        if any(k is None for k in ks):
            continue
        nk += 1
        pl = np.zeros(R)
        for k in ks:
            if k == 0:
                continue
            subs = list(combinations(range(R), k))
            w = np.array([np.prod(odds[list(A)]) for A in subs])
            w /= w.sum()
            for A, wa in zip(subs, w):
                pl[list(A)] += wa
        pl /= 3.0                      # share of judges who gave round r to the fight loser
        for rr in range(R):
            lab[(r.fid, L, rr + 1)] = pl[rr]          # P(fight loser WON round) -> loser lost round w.p. 1-pl
            lab[(r.fid, W, rr + 1)] = 1 - pl[rr]
        sure[r.fid] = all(k == 0 for k in ks)
    # lab[(fid, idx, rnd)] = expected share of judges that gave the round to fighter idx
    return lab, sure, nk


def fit_round_logit(S, F, period):
    """Round-winner logistic on clean sweeps (all cards 30-27 / 50-45) from the given period only."""
    d = F[F.cat.isin(["U-DEC"]) & (F.end_round == F.sched) & (F.end_sec == 300) &
          (F.DATE >= period[0]) & (F.DATE <= period[1])].copy()
    d["cards"] = d.det.map(br.parse_cards)
    d = d[d.cards.map(len) == 3]
    d = d[[all(card_rounds_lost(c, int(R)) == [0, 0, 0]) and len(c) == 3 for c, R in zip(d.cards, d.sched)]]
    feats = ["head_l", "body_l", "leg_l", "kd", "td_l", "ctrl_min", "sub"]
    s = S[S.fid.isin(d.fid)].copy()
    s["ctrl_min"] = s.ctrl / 60
    a = s.set_index(["fid", "rnd", "idx"])[feats]
    rows, ys = [], []
    for r in d.itertuples(index=False):
        W = int(r.winner)
        for rr in range(1, int(r.sched) + 1):
            try:
                xw = a.loc[(r.fid, rr, W)].to_numpy(float)
                xl = a.loc[(r.fid, rr, 1 - W)].to_numpy(float)
            except KeyError:
                continue
            rows.append(xw - xl); ys.append(1.0)
            rows.append(xl - xw); ys.append(0.0)
    X, y = np.array(rows), np.array(ys)
    beta, se, ll, _ = br.logit_fit(X, y, ridge=1e-3)
    return dict(zip(feats, beta)), dict(zip(feats, se)), len(d)


if __name__ == "__main__" and "--panel-only" in sys.argv:
    t = time.time()
    F, S, notes = build_panel()
    print(time.time() - t, len(F), len(S))
