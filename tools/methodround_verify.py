#!/usr/bin/env python3
"""Adversarial verification of tools/methodround.py (reviewer's tool; does not change the model).

    python3 tools/methodround_verify.py            # all checks (about 10-15 minutes on 4 cores)
    python3 tools/methodround_verify.py --score    # part 1 only (independent rescoring, seconds)

Part 1  Independent rescoring. Reads only data/derived/backtest.json (outcomes, A/B order, Elo, priors_asof),
        data/derived/methodround.json (stored per-fight cells) and data/derived/market.json (method props). It
        re-derives every outcome cell and every headline log loss with code written from scratch (no import of
        methodround.py), plus event-cluster bootstrap CIs, the corner (A/B) statistics and a "corner-aware"
        reference that shows what an asymmetric model could have gained from the ufcstats listing order.
Part 2  Look-ahead canary. Rebuilds methodround's walk-forward table from raw data truncated at several cut
        dates inside 2024-2026 (every fight after the cut deleted) and checks that the features of the fights
        on the cut date are identical to those in the full-data run. Any feature touched by later data differs.
        Also: duplicate fights, outcome labels vs backtest.json, A/B orientation vs backtest.json, Elo vs
        backtest.json.
Part 3  Corner symmetry by refit. Swaps A and B for a random half of all fights (features, outcomes, market),
        refits the frozen through-2023 model and checks that held-out predictions are the exact mirror.
Part 4  Forking-paths audit. The hyperparameters fixed in code (recency half-life, training start, minute
        shrinkage, career-sum features) were set during development, when every run printed 2024+ numbers.
        For a few alternatives it reports the 2020-2023 CV score next to the 2024+ score: if 2024+ favours the
        shipped setting while CV does not, the held-out result was likely tuned on.
Writes data/derived/methodround_verify.json.
"""
import argparse
import json
import math
import os
import sys
import time
from collections import Counter, defaultdict

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BT = os.path.join(ROOT, "data", "derived", "backtest.json")
MR = os.path.join(ROOT, "data", "derived", "methodround.json")
MK = os.path.join(ROOT, "data", "derived", "market.json")
OUT = os.path.join(ROOT, "data", "derived", "methodround_verify.json")
LBS = {"Flyweight": 125, "Bantamweight": 135, "Featherweight": 145, "Lightweight": 155, "Welterweight": 170,
       "Middleweight": 185, "Light Heavyweight": 205, "Heavyweight": 265, "Women's Strawweight": 115,
       "Women's Flyweight": 125, "Women's Bantamweight": 135, "Women's Featherweight": 145}
NON_DIV = {"Catch Weight", "Open Weight"}
EPS = 1e-9


# ------------------------------------------------------------------------------------------ part 1
def outcome(res, R):
    """(winner, method class, round) from a backtest.json result; None when excluded (NC, DQ, other)."""
    w, m, r = res["winner"], res["method"], int(res.get("round") or 1)
    if w == "D":
        return ("D", "DRAW", r)
    if w not in ("A", "B"):
        return None
    cls = {"KO": "KO", "DOC": "KO", "SUB": "SUB", "UD": "DEC", "SD": "DEC", "MD": "DEC"}.get(m)
    if cls is None:
        return None
    return (w, cls, min(max(r, 1), R))


def unpack(v, R):
    """Stored compact list -> dict of arrays (renormalised; the JSON is rounded to 4 dp)."""
    v = np.clip(np.asarray(v, float), 1e-6, None)
    v = v / v.sum()
    return {"AKO": v[0:R], "ASUB": v[R:2 * R], "BKO": v[2 * R:3 * R], "BSUB": v[3 * R:4 * R],
            "ADEC": v[4 * R], "BDEC": v[4 * R + 1], "DRAW": v[4 * R + 2]}


def losses(c, o):
    """Per-fight negative log likelihoods for one prediction c (unpack dict) and outcome o."""
    w, cls, r = o
    pA = c["AKO"].sum() + c["ASUB"].sum() + c["ADEC"]
    pB = c["BKO"].sum() + c["BSUB"].sum() + c["BDEC"]
    ko, sub = c["AKO"].sum() + c["BKO"].sum(), c["ASUB"].sum() + c["BSUB"].sum()
    dec = c["ADEC"] + c["BDEC"] + c["DRAW"]
    fin_r = c["AKO"] + c["BKO"] + c["ASUB"] + c["BSUB"]
    L = {}
    if cls == "DRAW":
        cell, b7 = c["DRAW"], c["DRAW"]
    elif cls == "DEC":
        cell = b7 = c[w + "DEC"]
    else:
        cell = c[w + cls][r - 1]
        b7 = c[w + cls].sum()
    L["joint"] = -math.log(max(cell, EPS))
    L["bin7"] = -math.log(max(b7, EPS))
    p3 = {"KO": ko, "SUB": sub, "DEC": dec, "DRAW": dec}[cls]
    L["method3"] = -math.log(p3)
    L["finish"] = -math.log(dec if cls in ("DEC", "DRAW") else ko + sub)
    if cls in ("KO", "SUB"):
        L["round_given_fin"] = -math.log(fin_r[r - 1] / (ko + sub))
        L["ko_vs_sub"] = -math.log((ko if cls == "KO" else sub) / (ko + sub))
        mr = (c["AKO"] + c["BKO"])[r - 1] if cls == "KO" else (c["ASUB"] + c["BSUB"])[r - 1]
    else:
        L["round_given_fin"] = L["ko_vs_sub"] = np.nan
        mr = dec
    L["method_round"] = -math.log(mr)
    if w in ("A", "B"):
        pa = pA / (pA + pB)
        p_w = pa if w == "A" else 1 - pa
        L["winner"] = -math.log(p_w)
        L["winner_acc"] = 0.5 if abs(pa - 0.5) < 1e-9 else float((pa > 0.5) == (w == "A"))
        tot = pA if w == "A" else pB
        wc = c[w + "DEC"] if cls == "DEC" else c[w + cls].sum()
        L["method_given_winner"] = -math.log(wc / tot)
    else:
        L["winner"] = L["winner_acc"] = L["method_given_winner"] = np.nan
    return L


def base_cells(f, priors, k=50.0, elo=False):
    """Division x format base rates from backtest.json priors_asof[fight year] (5 calendar years before), shrunk
    toward the all-division rates (k = 50 fights), catch weights use the heavier home division."""
    y = f["date"][:4]
    R = 5 if f["rounds"] == 5 else 3
    P = priors[y]
    d = f["division"]
    if d in NON_DIV:
        hs = [h for h in (f["A"].get("home"), f["B"].get("home")) if h in LBS]
        d = max(hs, key=lambda h: LBS[h]) if hs else "ALL"
    allp = P["ALL"]["fin%d" % R]
    dv = (P.get(d) or P["ALL"]).get("fin%d" % R) or allp
    n = dv["n"] if dv is not allp else 0
    wgt = n / (n + k)
    mix = lambda key: wgt * np.asarray(dv[key], float) + (1 - wgt) * np.asarray(allp[key], float)
    ko, sub, dec, draw = mix("KO"), mix("SUB"), float(mix("DEC")), float(mix("DRAW"))
    tot = ko.sum() + sub.sum() + dec + draw
    pa = 1 / (1 + 10 ** ((f["B"]["elo"] - f["A"]["elo"]) / 400)) if elo else 0.5
    return {"AKO": ko / tot * pa, "ASUB": sub / tot * pa, "BKO": ko / tot * (1 - pa), "BSUB": sub / tot * (1 - pa),
            "ADEC": dec / tot * pa, "BDEC": dec / tot * (1 - pa), "DRAW": draw / tot}


def market_cells(m, R, draw_c=0.014):
    a_ko, a_sub, a_dec, b_ko, b_sub, b_dec = m["method6"]
    shape = None
    rd = m.get("round_dist")
    if rd and len(rd) == R + 1 and sum(rd[:R]) > 0:
        shape = np.asarray(rd[:R], float) / sum(rd[:R])
    if shape is None:
        shape = np.array([0.5, 0.33, 0.17]) if R == 3 else np.array([0.36, 0.26, 0.18, 0.12, 0.08])
    c = {"AKO": a_ko * shape, "ASUB": a_sub * shape, "BKO": b_ko * shape, "BSUB": b_sub * shape,
         "ADEC": a_dec * (1 - draw_c), "BDEC": b_dec * (1 - draw_c), "DRAW": (a_dec + b_dec) * draw_c}
    t = sum(np.sum(v) for v in c.values())
    return {k: v / t for k, v in c.items()}


def blend(c1, c2, a):
    return {k: (1 - a) * c1[k] + a * c2[k] for k in c1}


def boot(tables, clusters, B=2000, seed=20261106):
    """Event-cluster bootstrap: per model/metric mean + 95% CI; paired differences via the same draws."""
    rng = np.random.default_rng(seed)
    _, cl = np.unique(np.asarray(clusters), return_inverse=True)
    k = cl.max() + 1
    W = rng.multinomial(k, np.full(k, 1.0 / k), size=B).astype(float)

    def stat(v):
        v = np.asarray(v, float)
        ok = ~np.isnan(v)
        s = np.bincount(cl[ok], weights=v[ok], minlength=k)
        n = np.bincount(cl[ok], minlength=k).astype(float)
        return float(v[ok].mean()), (W @ s) / np.maximum(W @ n, 1e-9), int(ok.sum())

    def ci(v):
        m, b, n = stat(v)
        return {"mean": round(m, 5), "ci95": [round(float(np.percentile(b, 2.5)), 5),
                                               round(float(np.percentile(b, 97.5)), 5)], "n": n}

    def diff(a, b):
        a, b = np.asarray(a, float), np.asarray(b, float)
        d = np.where(np.isnan(a) | np.isnan(b), np.nan, a - b)
        m, bt, n = stat(d)
        return {"diff": round(m, 5), "ci95": [round(float(np.percentile(bt, 2.5)), 5),
                                               round(float(np.percentile(bt, 97.5)), 5)],
                "p_ge_0": round(float((bt >= 0).mean()), 4), "n": n}
    return ci, diff


METS = ["method3", "finish", "round_given_fin", "ko_vs_sub", "bin7", "joint", "method_round", "method_given_winner",
        "winner", "winner_acc"]


def part1(B=2000):
    t0 = time.time()
    bt = json.load(open(BT))
    mr = json.load(open(MR))
    mk = json.load(open(MK))["fights"]
    pri = bt["priors_asof"]
    fights = [f for f in bt["fights"] if f["date"] >= "2024-01-01"]
    out = {"n_backtest_2024plus": len(fights)}
    rows = []
    miss = Counter()
    for f in fights:
        R = 5 if f["rounds"] == 5 else 3
        o = outcome(f["result"], R)
        if o is None:
            miss["excluded_" + f["result"]["method"]] += 1
            continue
        e = mr["fights"].get(f["id"])
        if e is None or "S" not in e:
            miss["no_prediction"] += 1
            continue
        if e["rounds"] != R or e["date"] != f["date"]:
            miss["join_mismatch"] += 1
        rows.append((f, o, R, e))
    out["excluded"] = dict(miss)
    out["n_scored"] = len(rows)
    T = defaultdict(lambda: defaultdict(list))
    ev, ev_m = [], []
    pa_S, aw = [], []
    for f, o, R, e in rows:
        cS, cSM = unpack(e["S"], R), unpack(e["SM"], R)
        cb, cbe = base_cells(f, pri), base_cells(f, pri, elo=True)
        for name, c in (("S", cS), ("SM", cSM), ("base_division", cb), ("base_division_elo", cbe)):
            for k, v in losses(c, o).items():
                T[name][k].append(v)
        ev.append(f["event"])
        if o[0] in ("A", "B"):
            pA_ = cS["AKO"].sum() + cS["ASUB"].sum() + cS["ADEC"]
            pB_ = cS["BKO"].sum() + cS["BSUB"].sum() + cS["BDEC"]
            pa_S.append(pA_ / (pA_ + pB_))
            aw.append(o[0] == "A")
        m = mk.get(f["id"])
        has = bool(m and m.get("method6"))
        if has:
            cm = market_cells(m, R)
            for name, c in (("S", cS), ("SM", cSM), ("market", cm), ("blend", blend(cSM, cm, 0.6)),
                            ("base_division_elo", cbe)):
                for k, v in losses(c, o).items():
                    T["mk_" + name][k].append(v)
            ev_m.append(f["event"])
    ci, diff = boot(None, ev, B)
    res = {nm: {k: ci(T[nm][k]) for k in METS} for nm in ("S", "SM", "base_division", "base_division_elo")}
    res_d = {"S_minus_base_division": {k: diff(T["S"][k], T["base_division"][k]) for k in METS},
             "S_minus_base_division_elo": {k: diff(T["S"][k], T["base_division_elo"][k]) for k in METS},
             "SM_minus_S": {k: diff(T["SM"][k], T["S"][k]) for k in METS}}
    cim, diffm = boot(None, ev_m, B)
    resm = {nm: {k: cim(T["mk_" + nm][k]) for k in METS} for nm in ("S", "SM", "market", "blend", "base_division_elo")}
    resm_d = {"SM_minus_market": {k: diffm(T["mk_SM"][k], T["mk_market"][k]) for k in METS},
              "S_minus_market": {k: diffm(T["mk_S"][k], T["mk_market"][k]) for k in METS},
              "blend_minus_market": {k: diffm(T["mk_blend"][k], T["mk_market"][k]) for k in METS}}
    # corner statistics
    aw = np.array(aw, float)
    pa_S = np.array(pa_S)
    p_corner = aw.mean()
    corner = {"A_win_share_decisive": round(float(p_corner), 4), "n_decisive": int(len(aw)),
              "A_win_share_ci95": [round(float(p_corner - 1.96 * math.sqrt(p_corner * (1 - p_corner) / len(aw))), 4),
                                   round(float(p_corner + 1.96 * math.sqrt(p_corner * (1 - p_corner) / len(aw))), 4)],
              "S_mean_pA": round(float(pa_S.mean()), 4),
              "S_mean_pA_when_A_won": round(float(pa_S[aw == 1].mean()), 4),
              "S_mean_pA_when_B_won": round(float(pa_S[aw == 0].mean()), 4),
              "constant_corner_prior_ll": round(float(-(aw * np.log(p_corner) + (1 - aw) * np.log(1 - p_corner)).mean()), 4),
              "note": "S is symmetric by construction; a corner-aware intercept (A wins %.1f%%) would have scored "
                      "%.4f with no fighter information" % (100 * p_corner, -(aw * np.log(p_corner) + (1 - aw) * np.log(1 - p_corner)).mean())}
    # corner-aware tilt on S: how much would adding the 2019-2023 A-share as an intercept move S? (diagnostic)
    bt_tune = [f for f in bt["fights"] if f["date"] < "2024-01-01" and f["result"]["winner"] in ("A", "B")]
    p_tune = np.mean([f["result"]["winner"] == "A" for f in bt_tune])
    lo = np.log(pa_S / (1 - pa_S)) + math.log(p_tune / (1 - p_tune))
    pt = 1 / (1 + np.exp(-lo))
    corner["A_win_share_2019_2023"] = round(float(p_tune), 4)
    corner["S_winner_ll"] = round(float(-(aw * np.log(pa_S) + (1 - aw) * np.log(1 - pa_S)).mean()), 4)
    corner["S_plus_corner_intercept_winner_ll"] = round(float(-(aw * np.log(pt) + (1 - aw) * np.log(1 - pt)).mean()), 4)
    # reported numbers from methodround.json for the comparison table
    rep = mr["test"]["metrics"]
    repm = mr["test"]["market_subset"]["metrics"]
    cmp_rows = []
    for nm, rk in (("S", "S"), ("SM", "SM"), ("base_division", "base_division"), ("base_division_elo", "base_division_elo")):
        for k in ("method3", "finish", "round_given_fin", "bin7", "joint", "winner", "winner_acc", "method_given_winner"):
            if k in rep[rk]:
                cmp_rows.append({"model": nm, "metric": k, "reported": rep[rk][k]["mean"], "rescored": res[nm][k]["mean"],
                                 "abs_diff": round(abs(rep[rk][k]["mean"] - res[nm][k]["mean"]), 5)})
    for nm, rk in (("S", "S"), ("SM", "SM"), ("market", "market_props"), ("blend", "SM_market_blend")):
        for k in ("method3", "finish", "round_given_fin", "joint"):
            cmp_rows.append({"model": "props_subset_" + nm, "metric": k, "reported": repm[rk][k]["mean"],
                             "rescored": resm[nm][k]["mean"],
                             "abs_diff": round(abs(repm[rk][k]["mean"] - resm[nm][k]["mean"]), 5)})
    out.update({"n_props_subset": len(ev_m), "metrics": res, "paired": res_d, "props_subset": resm,
                "props_paired": resm_d, "corner": corner, "reported_vs_rescored": cmp_rows,
                "max_abs_diff_vs_reported": max(r["abs_diff"] for r in cmp_rows),
                "seconds": round(time.time() - t0, 1)})
    return out


# ------------------------------------------------------------------------------------------ parts 2-4
def _mr():
    sys.path.insert(0, HERE)
    import methodround as M
    return M


FEATURE_SKIP = {"id", "winner", "method", "cls", "rnd", "time_s", "fight_s"}   # outcome columns (not features)


def table_cols(T):
    return [c for c in T.columns if c not in FEATURE_SKIP]


def part2(cuts):
    """Truncation canary + data integrity."""
    M = _mr()
    import pandas as pd
    B = M.B
    t0 = time.time()
    T, priors, fights, people, state, elo_now = M.build_table()
    T = T.reset_index(drop=True)
    res = {"n_table": int(len(T))}
    # duplicates
    res["duplicate_ids"] = int(T["id"].duplicated().sum())
    key = [(d, tuple(sorted((a or "?", b or "?")))) for d, a, b in zip(T["date"], T["A_slug"], T["B_slug"])]
    res["duplicate_date_pair"] = int(pd.Series(key).duplicated().sum())
    key2 = [(e, tuple(sorted((a or "?", b or "?")))) for e, a, b in zip(T["event"], T["A_name"], T["B_name"])]
    res["duplicate_event_pair"] = int(pd.Series(key2).duplicated().sum())
    # orientation, labels and Elo vs backtest.json
    bt = {f["id"]: f for f in json.load(open(BT))["fights"]}
    Ti = T.set_index("id")
    common = [i for i in bt if i in Ti.index]
    res["backtest_ids_in_table"] = len(common)
    res["backtest_ids_missing_from_table"] = len(bt) - len(common)
    flip = sum(1 for i in common if bt[i]["A"]["slug"] != Ti.at[i, "A_slug"])
    res["orientation_mismatch_vs_backtest"] = int(flip)
    lab = 0
    for i in common:
        r = bt[i]["result"]
        if r["winner"] != Ti.at[i, "winner"] or r["method"] != Ti.at[i, "method"] or \
                (r["winner"] in "AB" and int(r["round"]) != int(Ti.at[i, "rnd"])):
            lab += 1
    res["label_mismatch_vs_backtest"] = int(lab)
    de = np.array([abs(bt[i]["A"]["elo"] - Ti.at[i, "A_elo"]) for i in common] +
                  [abs(bt[i]["B"]["elo"] - Ti.at[i, "B_elo"]) for i in common])
    res["elo_max_abs_diff_vs_backtest"] = round(float(de.max()), 3)
    dn = np.array([abs(bt[i]["A"]["n"] - Ti.at[i, "A_n"]) for i in common])
    res["n_fights_mismatch_vs_backtest"] = int((dn > 0).sum())
    dk = np.array([abs(bt[i]["A"]["ko_losses"] - Ti.at[i, "A_ko_losses"]) for i in common])
    res["ko_losses_mismatch_vs_backtest"] = int((dk > 0).sum())
    print("  part 2: full table %d rows, integrity done (%.0fs)" % (len(T), time.time() - t0))
    # truncation canary: features of the fights on the cut day must not change when later fights are deleted
    PR = M.prior_frame(T, priors)
    FX, FY, _, _ = M.build_features(T, PR)
    orig_parse = B.parse_fights
    canary = []
    for cut in cuts:
        cut_d = pd.Timestamp(cut).date()

        def trunc(log, _o=orig_parse, _c=cut_d):
            fs, evd = _o(log)
            return [f for f in fs if f.date <= _c], evd
        B.parse_fights = trunc
        try:
            Tc, pc, *_ = M.build_table()
        finally:
            B.parse_fights = orig_parse
        Tc = Tc.reset_index(drop=True)
        on = Tc[Tc["date"] == cut_d]
        ids = list(on["id"])
        full = T[T["id"].isin(ids)].set_index("id").loc[ids]
        tr = on.set_index("id").loc[ids]
        worst, bad_cols = 0.0, set()
        for c in table_cols(T):
            if c in ("A_S", "B_S", "A_C", "B_C"):
                a = np.stack(full[c].to_numpy())
                b = np.stack(tr[c].to_numpy())
                d = float(np.max(np.abs(a - b))) if a.size else 0.0
            elif full[c].dtype.kind in "fi":
                a, b = full[c].to_numpy(float), tr[c].to_numpy(float)
                d = float(np.nanmax(np.abs(a - b))) if len(a) else 0.0
                if np.any(np.isnan(a) != np.isnan(b)):
                    d = max(d, 1.0)
            else:
                d = float(sum(str(x) != str(y) for x, y in zip(full[c], tr[c])))
            if d > 1e-9:
                bad_cols.add(c)
            worst = max(worst, d)
        # model features (after shrinkage toward priors) too
        PRc = M.prior_frame(Tc, pc)
        FXc, _, _, _ = M.build_features(Tc, PRc)
        fx_full = FX.loc[T.index[T["id"].isin(ids)]].set_index(T.loc[T["id"].isin(ids), "id"]).loc[ids]
        fx_tr = FXc.loc[on.index].set_index(on["id"]).loc[ids]
        fd = float(np.nanmax(np.abs(fx_full.to_numpy(float) - fx_tr.to_numpy(float)))) if len(ids) else 0.0
        canary.append({"cut": cut, "fights_on_cut_day": len(ids), "table_cols_checked": len(table_cols(T)),
                       "max_abs_diff_table": worst, "cols_differing": sorted(bad_cols),
                       "model_features_checked": int(FX.shape[1]), "max_abs_diff_model_features": fd})
        print("  part 2: cut %s: %d fights, table diff %.3g, feature diff %.3g (%.0fs)" % (
            cut, len(ids), worst, fd, time.time() - t0))
    res["truncation_canary"] = canary
    res["seconds"] = round(time.time() - t0, 1)
    return res


def swap_half(D, M, seed=5):
    """Swap A and B for a random half of all fights: table columns, features, outcomes, market."""
    import pandas as pd
    rng = np.random.default_rng(seed)
    T = D["T"].copy()
    n = len(T)
    sw = rng.random(n) < 0.5
    acols = [c for c in T.columns if c.startswith("A_")]
    for c in acols:
        bc = "B_" + c[2:]
        a, b = T[c].copy(), T[bc].copy()
        T.loc[sw, c], T.loc[sw, bc] = b[sw].values, a[sw].values
    T.loc[sw, "winner"] = T.loc[sw, "winner"].map({"A": "B", "B": "A"}).fillna(T.loc[sw, "winner"])
    FX, FY = D["FX"].copy(), D["FY"].copy()
    FX.loc[sw], FY.loc[sw] = D["FY"].loc[sw].values, D["FX"].loc[sw].values
    y = D["y"].copy()
    y[sw] = M.mirror_index(D["y"][sw])
    PMK = D["PMK"].copy()
    PMK[sw] = M.mirror_cells(D["PMK"][sw])
    D2 = dict(D, T=T, FX=FX, FY=FY, y=y, PMK=PMK)
    return D2, sw


def part3_4(B=2000, quick=False):
    M = _mr()
    import pandas as pd
    t0 = time.time()
    D = M.prepare()
    T, y = D["T"], D["y"]
    mr = json.load(open(MR))
    ch = mr["meta"]["chosen"]
    cfgs = M.variant_cfgs(D["stat_cols"], ch["C6_S"], ch["C6_SM"], ch["C_win"])
    test = (T["date"] >= M.TEST_FROM).to_numpy()
    ev = test & (y >= 0)
    w = M.Window(D, 2024, {"S": cfgs["S"], "SM": cfgs["SM"]}, ch["C_haz"])
    PS = w.predict(D, test, "S")[0]
    PSM = w.predict(D, test, "SM")[0]
    out = {}
    # (a) fresh refit equals the stored predictions
    ids = T["id"][test].to_numpy()
    stored = mr["fights"]
    dmax = 0.0
    for k, i in enumerate(ids):
        e = stored.get(i)
        if not e or "S" not in e:
            continue
        R = 5 if T["rounds"][test].iat[k] == 5 else 3
        P = PS[k]
        cmp_ = np.concatenate([P[M.I_XKO:M.I_XKO + R], P[M.I_XSUB:M.I_XSUB + R], P[M.I_YKO:M.I_YKO + R],
                               P[M.I_YSUB:M.I_YSUB + R], P[[M.I_XDEC, M.I_YDEC, M.I_DRAW]]])
        dmax = max(dmax, float(np.max(np.abs(cmp_ - np.asarray(e["S"])))))
    out["refit_vs_stored_S_max_abs_diff"] = round(dmax, 6)
    L0 = M.summarize_losses(M.losses_on(PS[ev[test]], D, ev))
    out["refit_S_heldout"] = {k: round(v, 5) for k, v in L0.items()}
    print("  part 3: refit through 2023 reproduces stored S to %.2g (%.0fs)" % (dmax, time.time() - t0))
    # (b) corner symmetry by refit on half-swapped data
    D2, sw = swap_half(D, M)
    w2 = M.Window(D2, 2024, {"S": cfgs["S"], "SM": cfgs["SM"]}, ch["C_haz"])
    for v, P0 in (("S", PS), ("SM", PSM)):
        P2 = w2.predict(D2, test, v)[0]
        swt = sw[test]
        P2b = P2.copy()
        P2b[swt] = M.mirror_cells(P2[swt])
        out["swap_refit_%s_max_abs_cell_diff" % v] = float(np.max(np.abs(P2b - P0)))
        L2 = M.summarize_losses(M.losses_on(P2[ev[test]], D2, ev))
        L1 = M.summarize_losses(M.losses_on(P0[ev[test]], D, ev))
        out["swap_refit_%s_metric_max_abs_diff" % v] = float(max(abs(L2[k] - L1[k]) for k in L1))
    out["swap_share"] = round(float(sw.mean()), 3)
    print("  part 3: swap refit S cell diff %.2g, metric diff %.2g (%.0fs)" % (
        out["swap_refit_S_max_abs_cell_diff"], out["swap_refit_S_metric_max_abs_diff"], time.time() - t0))
    # (c) forking paths: alternatives to settings fixed in code; CV 2020-2023 vs 2024+
    vm = T["year"].isin(M.VALID_YEARS).to_numpy()
    def haz_oof():
        Hh = np.zeros((len(T), M.NC_))
        for v in M.VALID_YEARS:
            tr = ((T["year"] < v) & (T["year"] >= M.HAZ_START)).to_numpy()
            va = (T["year"] == v).to_numpy()
            hz = M.HazardModel(M.HAZ_COLS, C=ch["C_haz"], C_dec=M.C_DEC).fit(T[tr], D["FX"][tr], D["FY"][tr], y[tr])
            Hh[va] = hz.predict(T[va], D["FX"][va], D["FY"][va])
        return Hh
    Hcv = haz_oof()
    Htest = w.haz.predict(T[test], D["FX"][test], D["FY"][test])
    draw_c = ch["draw_c"]

    def score_cfg(cols, start, hl, FXa=None, FYa=None):
        FXa = D["FX"] if FXa is None else FXa
        FYa = D["FY"] if FYa is None else FYa
        P6 = np.zeros((len(T), 6))
        for v in M.VALID_YEARS:
            tr = ((T["year"] < v) & (T["year"] >= start)).to_numpy()
            va = (T["year"] == v).to_numpy()
            m = M.C6Logit(cols, C=ch["C6_S"], hl_years=hl).fit(T[tr], FXa[tr], FYa[tr], y[tr])
            P6[va] = m.predict6(T[va], FXa[va], FYa[va])
        cv = M.summarize_losses(M.losses_on(M.joint_from_c6(P6[vm], Hcv[vm], draw_c), D, vm))
        tr = ((T["year"] < 2024) & (T["year"] >= start)).to_numpy()
        m = M.C6Logit(cols, C=ch["C6_S"], hl_years=hl).fit(T[tr], FXa[tr], FYa[tr], y[tr])
        P6t = m.predict6(T[test], FXa[test], FYa[test])
        te = M.summarize_losses(M.losses_on(M.joint_from_c6(P6t, Htest, draw_c)[ev[test]], D, ev))
        return {"cv_method3": round(cv["method3"], 5), "cv_joint": round(cv["joint"], 5),
                "cv_winner": round(cv["winner"], 5), "test_method3": round(te["method3"], 5),
                "test_joint": round(te["joint"], 5), "test_winner": round(te["winner"], 5)}
    sc = D["stat_cols"]
    alts = [("shipped (hl 8, start 2012, k_min 15, with career sums)", sc, 2012, 8),
            ("half-life 4 years", sc, 2012, 4), ("no recency weighting", sc, 2012, None),
            ("train from 2008", sc, 2008, 8), ("train from 2016", sc, 2016, 8),
            ("without career-sum (cs_) features", [c for c in sc if "_cs_" not in c], 2012, 8),
            ("without year trend", [c for c in sc if c != "yr"], 2012, 8)]
    if quick:
        alts = alts[:2]
    fp = []
    for name, cols, start, hl in alts:
        r = score_cfg(cols, start, hl)
        r["setting"] = name
        fp.append(r)
        print("  part 4: %-55s cv joint %.4f test joint %.4f (%.0fs)" % (name, r["cv_joint"], r["test_joint"],
                                                                         time.time() - t0))
    # minute shrinkage alternative (k_min = 30): rebuild features
    if not quick:
        sh = dict(M.SHRINK, k_min=30.0)
        FXa, FYa, _, _ = M.build_features(T, D["PR"], sh)
        r = score_cfg(sc, 2012, 8, FXa, FYa)
        r["setting"] = "k_min = 30 minutes"
        fp.append(r)
        print("  part 4: %-55s cv joint %.4f test joint %.4f (%.0fs)" % (r["setting"], r["cv_joint"],
                                                                         r["test_joint"], time.time() - t0))
    cv_rank = sorted(fp, key=lambda r: r["cv_joint"])
    te_rank = sorted(fp, key=lambda r: r["test_joint"])
    out["forking_paths"] = {"rows": fp, "cv_best": cv_rank[0]["setting"], "test_best": te_rank[0]["setting"],
                            "shipped_cv_rank": 1 + [r["setting"] for r in cv_rank].index(fp[0]["setting"]),
                            "shipped_test_rank": 1 + [r["setting"] for r in te_rank].index(fp[0]["setting"]),
                            "n_settings": len(fp)}
    out["seconds"] = round(time.time() - t0, 1)
    return out


def part5_ablations():
    """Reproduce the report's 'did not earn a place' claims on the tuning period only (expanding-window CV,
    validation years 2020-2023; nothing from 2024+ is read). The shipped run() never calls C6GBM, FactorModel or
    Recalibrator, so these claims were not reproducible from the pipeline."""
    M = _mr()
    t0 = time.time()
    D = M.prepare()
    T, y, FX, FY = D["T"], D["y"], D["FX"], D["FY"]
    ch = json.load(open(MR))["meta"]["chosen"]
    sc = D["stat_cols"]
    vm = T["year"].isin(M.VALID_YEARS).to_numpy()
    H = np.zeros((len(T), M.NC_))
    P = {k: np.zeros((len(T), 6)) for k in ("logit", "lgbm", "factor")}
    for v in M.VALID_YEARS:
        trh = ((T["year"] < v) & (T["year"] >= M.HAZ_START)).to_numpy()
        tr = ((T["year"] < v) & (T["year"] >= 2012)).to_numpy()
        va = (T["year"] == v).to_numpy()
        H[va] = M.HazardModel(M.HAZ_COLS, C=ch["C_haz"], C_dec=M.C_DEC).fit(T[trh], FX[trh], FY[trh], y[trh]) \
            .predict(T[va], FX[va], FY[va])
        P["logit"][va] = M.C6Logit(sc, C=ch["C6_S"], hl_years=M.HL_YEARS).fit(T[tr], FX[tr], FY[tr], y[tr]) \
            .predict6(T[va], FX[va], FY[va])
        P["lgbm"][va] = M.C6GBM(sc, hl_years=M.HL_YEARS).fit(T[tr], FX[tr], FY[tr], y[tr]).predict6(T[va], FX[va], FY[va])
        P["factor"][va] = M.FactorModel(sc, sc, C_win=0.002, C_meth=0.002, hl_years=M.HL_YEARS) \
            .fit(T[tr], FX[tr], FY[tr], y[tr]).predict6(T[va], FX[va], FY[va])
        print("  part 5: fold %d (%.0fs)" % (v, time.time() - t0))
    # recalibration of the logit OOF, leave-one-validation-year-out
    c6 = M.cells_to_c6(y)
    P["logit_recal"] = P["logit"].copy()
    for v in M.VALID_YEARS:
        fit_m = vm & (T["year"] != v).to_numpy()
        va = (T["year"] == v).to_numpy()
        rc = M.Recalibrator().fit(P["logit"][fit_m], np.where(fit_m, c6, -1)[fit_m])
        P["logit_recal"][va] = rc.apply(P["logit"][va])
    P["blend_30pct_lgbm"] = 0.7 * P["logit"] + 0.3 * P["lgbm"]
    res = {}
    for k, P6 in P.items():
        s = M.summarize_losses(M.losses_on(M.joint_from_c6(P6[vm], H[vm], ch["draw_c"]), D, vm))
        res[k] = {m: round(s[m], 5) for m in ("method3", "joint", "winner", "finish", "bin7")}
    base = res["logit"]
    for k in res:
        res[k]["d_method3_vs_logit"] = round(res[k]["method3"] - base["method3"], 5)
        res[k]["d_joint_vs_logit"] = round(res[k]["joint"] - base["joint"], 5)
    res["n_cv_fights"] = int((vm & (y >= 0)).sum())
    res["seconds"] = round(time.time() - t0, 1)
    return res


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--score", action="store_true", help="part 1 only")
    ap.add_argument("--ablations", action="store_true", help="part 5 only (tuning-period ablations), merged into "
                                                                "the existing output")
    ap.add_argument("--quick", action="store_true")
    args = ap.parse_args(argv)
    if args.ablations:
        res = json.load(open(OUT)) if os.path.exists(OUT) else {}
        print("part 5: tuning-period ablations (2020-2023 CV only)")
        res["part5_ablations"] = part5_ablations()
        json.dump(res, open(OUT, "w"), indent=1, default=lambda o: o.item() if hasattr(o, "item") else str(o))
        print("wrote", OUT)
        return
    res = {"tool": "tools/methodround_verify.py", "built": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    print("part 1: independent rescoring")
    res["part1_rescoring"] = part1(400 if args.quick else 2000)
    p1 = res["part1_rescoring"]
    print("  scored %d fights; max |reported - rescored| = %.5f" % (p1["n_scored"], p1["max_abs_diff_vs_reported"]))
    if not args.score:
        print("part 2: look-ahead canary and data integrity")
        cuts = ["2024-01-13", "2024-07-13", "2025-03-01", "2025-10-04", "2026-06-27"] if not args.quick else ["2025-03-01"]
        res["part2_leakage"] = part2(cuts)
        print("part 3/4: symmetry refit and forking-paths audit")
        res["part3_4"] = part3_4(quick=args.quick)
    json.dump(res, open(OUT, "w"), indent=1, default=lambda o: o.item() if hasattr(o, "item") else str(o))
    print("wrote", OUT)


if __name__ == "__main__":
    main()
