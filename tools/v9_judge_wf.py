#!/usr/bin/env python3
"""v9_judge_wf.py: walk-forward judging weights for engine v9 (docs/V6_V10_PLAN.md cycle 4, work item 2).

For every year Y the EM round-winner weights are refit on judges' cards dated strictly before Jan 1 of Y, with the same code
as tools/judge_em_train.py (tools/baserates.py round_model_block: EM over 10-9-only cards, latent round winners per judge,
weighted no-intercept logistic M-step). The plan asks for "per-year EM weights from judge_em_train-style windows ending at
Y-1, shrunk toward the multi-year fit". Candidate recipes (fixed before any number was computed):

    exp     the multi-year fit: cards 2015-01-01 .. Y-01-01 (expanding)
    win2    the last two years:  cards (Y-2)-01-01 .. Y-01-01
    win3    the last three years
    shr2    half-way between win2 and exp (coefficient average)
    shr3    half-way between win3 and exp

Selection (rolling origin, V6_V10_PLAN cycle 4 "window ... chosen on 2019-20"): each recipe's weights for Y predict the real
decision winners of year Y (judges independent given the round stats, 10-9-only Poisson-binomial over rounds, as the
judge_em_train holdout does); the recipe with the lowest pooled 2019-2020 decision log loss is chosen, ties within 0.0005
go to exp (the simplest, most data). 2021-2023 numbers are printed for information only (the engine gate confirms there).

Hidden-data protocol: the fight table is cut at 2026-01-01 right after loading, before any statistic is computed; a fit for Y
uses cards dated before Jan 1 of Y only. Rows for 2024 and 2025 are the deployment weights for a look (walk-forward inside
the validation window, as the as-of priors are); 2026 (cards before 2026-01-01) is the live row. No 2024+ decision is scored.

    nice -n 5 python3 tools/v9_judge_wf.py [--out data/derived/v9/judge_wf.json]
"""
import argparse
import datetime as dt
import importlib.util
import json
import os

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
spec = importlib.util.spec_from_file_location("baserates", os.path.join(HERE, "baserates.py"))
br = importlib.util.module_from_spec(spec)
spec.loader.exec_module(br)

SINCE = "2015-01-01"
VAULT = pd.Timestamp("2026-01-01")
YEARS = list(range(2019, 2027))
SELECT_YEARS = [2019, 2020]
INFO_YEARS = [2021, 2022, 2023]
RECIPES = ["exp", "win2", "win3", "shr2", "shr3"]
FEATS = br.FEATURE_SETS["target"]
ENGINE_KEYS = {"head_l": "head", "body_l": "body", "leg_l": "leg", "kd": "kd", "td_l": "td", "ctrl_min": "ctrlMin", "sub": "sub"}


def em_coef(F, S, lo, hi):
    """EM 'target' coefficients on cards of fights dated in [lo, hi)."""
    Fw = F[(F.DATE >= pd.Timestamp(lo)) & (F.DATE < pd.Timestamp(hi))].copy()
    Sw = S[S.fid.isin(set(Fw.fid))].copy()
    _, cards = br.judging_block(Fw)
    # holdout_from inside the window keeps round_model_block's holdout branch non-empty; only em_all_cards is used
    mid = (pd.Timestamp(lo) + (pd.Timestamp(hi) - pd.Timestamp(lo)) / 2).strftime("%Y-%m-%d")
    M = br.round_model_block(Fw, Sw, cards, holdout_from=mid)
    em = M["em_all_cards"]
    c = em["target"]["coef"]
    return np.array([c[f] for f in FEATS]), {"n_cards": em["n_cards"], "n_fights": em["n_fights"], "lo": lo, "hi": hi,
                                             "date_max_used": str(Fw.DATE.max().date())}


def decision_ll(F, S, beta, year):
    """Decision-winner log loss for real decisions of `year` (first-listed fighter's P from 10-9-only round model)."""
    Fy = F[(F.DATE >= pd.Timestamp(f"{year}-01-01")) & (F.DATE < pd.Timestamp(f"{year + 1}-01-01"))]
    dec = br.decisions_frame(Fy)
    dec = dec[dec.cat != "DRAW"]
    D = br.round_diffs(S[S.fid.isin(set(dec.fid))])
    ids = set(D.index.get_level_values(0))
    ll, n = [], 0
    for f in dec.itertuples():
        if f.fid not in ids:
            continue
        X = D.loc[f.fid][FEATS].sort_index().to_numpy(float)
        if X.shape[0] != int(f.sched):
            continue
        p = 1 / (1 + np.exp(-np.clip(X @ beta, -30, 30)))
        dist = np.array([1.0])
        for pr in p:
            dist = np.convolve(dist, [1 - pr, pr])
        R = len(p)
        q = dist[(R // 2) + 1:].sum()
        pa = q ** 3 + 3 * q ** 2 * (1 - q)
        pa = min(max(pa, 1e-6), 1 - 1e-6)
        y = 1.0 if f.winner == 0 else 0.0
        ll.append(-(y * np.log(pa) + (1 - y) * np.log(1 - pa)))
    return np.array(ll)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--raw", default=os.path.join(ROOT, "data", "raw"))
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "derived", "v9", "judge_wf.json"))
    a = ap.parse_args()
    F, S, notes, _ = br.load_data(a.raw, SINCE)
    F = F[F.DATE < VAULT].copy()                  # hidden-data protocol: no 2026 row past this line
    S = S[S.fid.isin(set(F.fid))].copy()
    assert F.DATE.max() < VAULT
    fits, coefs = {}, {}
    for Y in YEARS:
        hi = f"{Y}-01-01"
        b_exp, i_exp = em_coef(F, S, SINCE, hi)
        b_w2, i_w2 = em_coef(F, S, f"{Y - 2}-01-01", hi)
        b_w3, i_w3 = em_coef(F, S, f"{Y - 3}-01-01", hi)
        coefs[Y] = {"exp": b_exp, "win2": b_w2, "win3": b_w3, "shr2": 0.5 * (b_w2 + b_exp), "shr3": 0.5 * (b_w3 + b_exp)}
        fits[Y] = {"exp": i_exp, "win2": i_w2, "win3": i_w3}
        print(f"{Y}: exp {np.round(b_exp, 4).tolist()}  win2 {np.round(b_w2, 4).tolist()}", flush=True)
    # selection on 2019-2020 decisions (each year's weights fit on cards before it)
    sel, info = {}, {}
    for r in RECIPES:
        lls = {Y: decision_ll(F, S, coefs[Y][r], Y) for Y in SELECT_YEARS + INFO_YEARS}
        pooled = np.concatenate([lls[Y] for Y in SELECT_YEARS])
        sel[r] = {"ll_2019_2020": float(pooled.mean()), "n": int(len(pooled)), "by_year": {str(Y): float(lls[Y].mean()) for Y in SELECT_YEARS}}
        inf = np.concatenate([lls[Y] for Y in INFO_YEARS])
        info[r] = {"ll_2021_2023": float(inf.mean()), "n": int(len(inf))}
    best = min(RECIPES, key=lambda r: sel[r]["ll_2019_2020"])
    chosen = "exp" if sel["exp"]["ll_2019_2020"] - sel[best]["ll_2019_2020"] <= 0.0005 else best
    for r in RECIPES:
        print(f"  {r:5s} 2019-20 ll {sel[r]['ll_2019_2020']:.5f} (n {sel[r]['n']})   [info 2021-23 {info[r]['ll_2021_2023']:.5f}]")
    print("chosen recipe:", chosen)
    by_year = {str(Y): {ENGINE_KEYS[f]: round(float(v), 6) for f, v in zip(FEATS, coefs[Y][chosen])} for Y in YEARS}
    out = {"meta": {"tool": "tools/v9_judge_wf.py", "built": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                    "since": SINCE, "vault_cut": str(VAULT.date()), "date_max_loaded": str(F.DATE.max().date()), "notes": notes,
                    "rule": "row Y = EM 'target' weights on judges' cards dated before Jan 1 of Y (recipe below); the engine uses the row of the fight's year (components.judgeWF)",
                    "recipes": RECIPES, "selection": "lowest pooled 2019-2020 decision-winner log loss, ties within 0.0005 to exp",
                    "chosen": chosen, "selection_scores": sel, "info_2021_2023_not_used": info},
           "fits": {str(Y): fits[Y] for Y in YEARS},
           "coef_all_recipes": {str(Y): {r: dict(zip([ENGINE_KEYS[f] for f in FEATS], np.round(coefs[Y][r], 6).tolist())) for r in RECIPES} for Y in YEARS},
           "byYear": by_year}
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w") as fh:
        json.dump(br.clean(out), fh, indent=1)
    print("wrote", os.path.relpath(a.out, ROOT))


if __name__ == "__main__":
    main()
