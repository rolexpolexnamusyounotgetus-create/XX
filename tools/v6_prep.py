#!/usr/bin/env python3
"""v6_prep.py: train-only inputs for engine v6 (docs/V6_V10_PLAN.md section 3, cycle 1: ML v2 heads inside
FightEngine.predict, line routing, S2 method/round cells).

    nice -n 5 python3 tools/v6_prep.py stacks     # ML v2 winner stacks per line regime, forward-chained weights
    nice -n 5 python3 tools/v6_prep.py s2         # S2 method/round cells (walk-forward) + the JS model (fit <= 2025)
    nice -n 5 python3 tools/v6_prep.py all

Protocol (docs/BACKLOG.md "Hidden-data protocol"): every fight dated 2026-01-01 or later is dropped at parse (tools/ml2.py
wraps build_db.parse_fights); every weight that scores a fight is fit on rows strictly before that fight's year (the
2024-2025 rows use fits through 2023-12-31); the production objects are fit through 2025-12-31 and never score a backtest
fight. Every model is corner-symmetric (no intercept; mirrored rows / antisymmetric features).

stacks  -> data/derived/v6_stacks.json. Per regime (none / open / close) and ML v2 head (blend = the CV choice:
           LR + LightGBM + XGBoost; lr = the logistic the page could evaluate before v6), the ML v2 stack of
           research/model_ml2.md section 6 (no line: ML v2 + market rating, recency half-life 1.5 y; open: opener + ML v2;
           close: closing line + ML v2), non-negative logit weights without intercept, fit on the 2019..Y-1 out-of-fold
           rows for Y = 2021, 2022, 2023 (the forward-chained gate) and 2024 (= fit through 2023-12-31: validation), plus
           the production fit (2019-2025: out-of-fold 2019-2023 and the monthly-rolling 2024-2025 predictions, as
           ml2.json page_model.stack). The half-lives are ml2.py's CV choice (none / 3 / 1.5 by forward-chained CV
           2021-2023), fixed here.
s2      -> data/derived/mr_s2.json. methodround.py's 6-class model with ml2.py's S2 columns (research/model_ml2.md
           section 7; C6 = 0.002, its CV choice) and methodround's hazard (round shapes), refit per fold year v on years
           < v (2019..2023) and on years < 2024 for 2024-2025: fights[id] = { S2: cells [A KO r1..R, A SUB r1..R, B KO,
           B SUB, A DEC, B DEC, DRAW], rounds, fit_through }. js_model: the same model fit on 2012..2025 (hazard
           2008..2025) for tools/methodround_model.js variant "S2", with 40 Python test vectors (full feature rows).
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import pickle
import sys

for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "1")
import numpy as np  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import ml2 as M2  # noqa: E402  (wraps build_db.parse_fights: 2026+ dropped at parse)

DER = os.path.join(ROOT, "data", "derived")
VAULT = dt.date(2026, 1, 1)
GATE_YEARS = [2021, 2022, 2023]
FIT_YEARS = [2021, 2022, 2023, 2024]          # weights for scoring year Y are fit on 2019..Y-1
REGIMES = {
    # regime: (ML v2 stack inputs with "ML2" standing for the head column, half-life chosen by ml2.py's CV, rows)
    "none": (["ML2", "mkt_rating"], 1.5, "all"),
    "open": (["open", "ML2"], None, "open"),
    "close": (["market", "ML2"], None, "close"),
}
HEADS = {"blend": "ml2", "lr": "ml2lr"}
PCLIP = 0.01


def log(*a):
    print("[v6_prep]", *a, flush=True)


def now():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def ll(p, y):
    p = np.clip(p, 1e-4, 1 - 1e-4)
    return float(np.mean(-(y * np.log(p) + (1 - y) * np.log(1 - p))))


def stage_stacks(args):
    S = M2.load_table()
    T = S["df"]
    assert T["date"].max() < VAULT
    F = pickle.load(open(os.path.join(M2.CACHE, "fit.pkl"), "rb"))
    D = M2.expert_table(T, F)
    y = D["y"].to_numpy(float)
    yr = D["year"].to_numpy()
    rows = {"all": np.ones(len(D), bool), "open": D["open"].notna().to_numpy(), "close": D["market"].notna().to_numpy()}
    out = {"meta": {"tool": "tools/v6_prep.py stacks", "built": now(),
                    "fit": "non-negative logit weights, no intercept (tools/ml2.py stack_fit), inputs logit(clip(p, 0.01, "
                           "0.99)); weights for scoring year Y fit on 2019..Y-1 out-of-fold rows (ML v2: annual refits "
                           "2019-2023; market.json lines and market rating); 'Y2024' = fit through 2023-12-31 (validation "
                           "and backtests of 2024-2025); 'production' = 2019-2025 with the monthly-rolling ML v2 rows for "
                           "2024-2025 (as ml2.json page_model.stack): page / ledger only, never a backtest",
                    "regimes": {k: {"inputs": v[0], "recency_half_life_years": v[1], "rows": v[2]} for k, v in REGIMES.items()},
                    "heads": {"blend": "ML v2 blend (LR 0.43 + LightGBM 0.40 + XGBoost 0.15; the CV choice)",
                              "lr": "ML v2 logistic (ml2.json page_model; the pre-v6 page head)"},
                    "half_life_source": "tools/ml2.py stage_stack forward-chained CV 2021-2023 (h in none, 3, 1.5): no "
                                        "line 1.5, open none, close none (research/model_ml2.md section 6)",
                    "protocol": "2026+ dropped at parse; nothing from 2024-2025 enters a weight that scores 2024-2025"},
           "stacks": {}, "cv": {}, "per_fight": {}}
    ids = D["fid"].tolist()
    for head, hcol in HEADS.items():
        for reg, (cols0, h, rk) in REGIMES.items():
            cols = [hcol if c == "ML2" else c for c in cols0]
            ok = rows[rk]
            key = "%s|%s" % (reg, head)
            blk = {"inputs": [("ml2" if c == hcol else c) for c in cols], "columns": cols, "recency_half_life_years": h,
                   "pclip": PCLIP, "by_fit_year": {}}
            tot = n = 0.0
            pf = {}
            for Y in FIT_YEARS:
                m = ok & ((yr == Y) if Y < 2024 else (yr >= 2024))
                p, b = M2.stack_predict(D, cols, "static", h, Y - 1, m, ok)
                tr = ok & (yr <= Y - 1) & (yr >= 2019)
                blk["by_fit_year"][str(Y)] = {"weights": [float(x) for x in b], "fit_through": "%d-12-31" % (Y - 1),
                                              "n_train": int(tr.sum()),
                                              "scores": "%d" % Y if Y < 2024 else "2024-2025"}
                if Y in GATE_YEARS:
                    tot += ll(p, y[m]) * m.sum()
                    n += m.sum()
                for i, q in zip(np.flatnonzero(m), p):
                    pf.setdefault(ids[i], {})[key] = round(float(q), 8)
            # production: 2019-2025, rolling ML v2 rows for 2024-2025 (page_model.stack's construction)
            mp = ok & (yr >= 2019)
            _, bp = M2.stack_predict(D, cols, "roll", h, 2025, mp, ok)
            blk["production"] = {"weights": [float(x) for x in bp], "fit_through": "2025-12-31",
                                 "n_train": int(mp.sum()), "ml2_rows_2024_2025": "monthly rolling refits"}
            out["stacks"][key] = blk
            out["cv"][key] = {"forward_chained_2021_2023": round(tot / n, 5), "n": int(n)}
            for fid, v in pf.items():
                out["per_fight"].setdefault(fid, {}).update(v)
            log("%-12s CV 2021-23 %.5f (n %d) | fit<=2023 w %s | production w %s" % (
                key, tot / n, n, np.round(blk["by_fit_year"]["2024"]["weights"], 4), np.round(bp, 4)))
    # the page-model weights ml2.py exported (the lr head's production fit must reproduce them)
    pm = M2.jload("ml2.json")["page_model"]["stack"]
    out["meta"]["check_page_model_stack"] = {
        "none|lr": [pm["noline"]["weights"], out["stacks"]["none|lr"]["production"]["weights"]],
        "open|lr": [pm["open"]["weights"], out["stacks"]["open|lr"]["production"]["weights"]],
        "close|lr": [pm["line"]["weights"], out["stacks"]["close|lr"]["production"]["weights"]]}
    fm = M2.jload("forward_models.json").get("ml2_static") or {}
    out["meta"]["check_forward_models_ml2_static"] = {k: (fm.get(k) or {}).get("weights") for k in ("noline", "open", "line")}
    json.dump(out, open(os.path.join(DER, "v6_stacks.json"), "w"), indent=None, separators=(",", ":"))
    log("wrote data/derived/v6_stacks.json")
    log("page_model check:", json.dumps(out["meta"]["check_page_model_stack"]))
    log("forward_models ml2_static:", json.dumps(out["meta"]["check_forward_models_ml2_static"]))


# ====================================================================== S2 cells
S2_FOLDS = [2019, 2020, 2021, 2022, 2023, 2024]     # 2024 = fit < 2024, scores 2024-2025


def _s2_setup():
    import methodround as MR
    S = M2.load_table()
    T2 = S["df"]
    F = pickle.load(open(os.path.join(M2.CACHE, "fit.pkl"), "rb"))
    C = json.load(open(os.path.join(M2.CACHE, "cv.json")))
    D = MR.prepare(False)
    T, FX, FY, y = D["T"], D["FX"], D["FY"], D["y"]
    assert T["date"].max() < VAULT
    chosen = M2.jload("methodround.json")["meta"]["chosen"]
    nX, nY, pwin, okz = M2.method_new_cols(T, T2, F, C["lr"]["tau"], C["pre_means"])
    import pandas as pd
    FX2 = pd.concat([FX, nX], axis=1)
    FY2 = pd.concat([FY, nY], axis=1)
    return MR, D, T, FX, FY, y, FX2, FY2, list(nX.columns), chosen, T2, F, C


def stage_s2(args):
    MR, D, T, FX, FY, y, FX2, FY2, new, chosen, T2, F, C = _s2_setup()
    C6 = M2.jload("ml2.json")["method"]["chosen_C6_S2"]
    stat = D["stat_cols"]
    cols = stat + new
    draw_c = chosen["draw_c"]
    yrs = T["year"].to_numpy()
    n = len(T)
    H = np.full((n, MR.NC_), np.nan)
    P6 = np.full((n, 6), np.nan)
    FT = np.array([None] * n, dtype=object)
    for v in S2_FOLDS:
        trh = ((T["year"] < v) & (T["year"] >= MR.HAZ_START)).to_numpy()
        tr6 = ((T["year"] < v) & (T["year"] >= 2012)).to_numpy()
        va = (T["year"] == v).to_numpy() if v < 2024 else (T["year"] >= 2024).to_numpy()
        hz = MR.HazardModel(MR.HAZ_COLS, C=chosen["C_haz"], C_dec=MR.C_DEC).fit(T[trh], FX[trh], FY[trh], y[trh])
        H[va] = hz.predict(T[va], FX[va], FY[va])
        m6 = MR.C6Logit(cols, C=C6, hl_years=MR.HL_YEARS).fit(T[tr6], FX2[tr6], FY2[tr6], y[tr6])
        P6[va] = m6.predict6(T[va], FX2[va], FY2[va])
        FT[va] = str(T["date"][(T["year"] < v).to_numpy()].max())
        log("S2 fold %d: %d rows scored (C6 fit on %d, hazard on %d)" % (v, va.sum(), tr6.sum(), trh.sum()))
    have = ~np.isnan(P6[:, 0])
    J = np.full((n, MR.NC_), np.nan)
    J[have] = MR.joint_from_c6(P6[have], H[have], draw_c)
    # check against ml2.py's stored CV numbers (2020-2023 folds, S2 at the chosen C6)
    vm = np.isin(yrs, MR.VALID_YEARS) & have
    s_ = MR.summarize_losses(MR.losses_on(J[vm], D, vm))
    ref = M2.jload("ml2.json")["method"]["cv_grid_S2"][str(C6)]
    log("S2 CV 2020-23 joint %.5f bin7 %.5f method3 %.5f (ml2.json: joint %.5f bin7 %.5f method3 %.5f)" % (
        s_["joint"], s_["bin7"], s_["method3"], ref["joint"], ref["bin7"], ref["method3"]))
    # cells per backtest id, in FightBlend's layout [A KO r1..R, A SUB r1..R, B KO r1..R, B SUB r1..R, A DEC, B DEC, D]
    bt = json.load(open(os.path.join(DER, "backtest_dev.json")))
    dev_ids = {f["id"]: f for f in bt["fights"] if f["date"] < "2026-01-01"}
    ids = T["id"].tolist()
    fights = {}
    for i in np.flatnonzero(have):
        fid = ids[i]
        if fid not in dev_ids:
            continue
        R = int(dev_ids[fid]["rounds"] or 3)
        fights[fid] = {"S2": _cells(J[i], R), "rounds": R, "fit_through": FT[i], "date": str(T["date"].iloc[i])}
    log("S2 cells for %d of %d dev fights" % (len(fights), len(dev_ids)))
    # production model (2012..2025; hazard 2008..2025) for the JS evaluator
    js = export_s2_js(MR, D, T, FX, FY, FX2, FY2, y, cols, new, C6, chosen, C, T2)
    out = {"meta": {"tool": "tools/v6_prep.py s2", "built": now(), "C6": C6, "draw_c": draw_c,
                    "folds": "fold v: 6-class model fit on 2012..v-1, hazard on %d..v-1, scores year v (2019-2023); v = 2024 "
                             "scores 2024-2025 (fit through 2023-12-31)" % MR.HAZ_START,
                    "columns": cols, "new_columns": new,
                    "cv_2020_2023": {k: round(v, 5) for k, v in s_.items()}, "cv_2020_2023_ml2_json": ref,
                    "layout": "[A KO r1..R, A SUB r1..R, B KO r1..R, B SUB r1..R, A DEC, B DEC, DRAW] (FightBlend)",
                    "protocol": "2026+ dropped at parse; each fold sees only earlier years"},
           "fights": fights, "js_model": js}
    json.dump(out, open(os.path.join(DER, "mr_s2.json"), "w"), separators=(",", ":"))
    log("wrote data/derived/mr_s2.json")


def _cells(Jrow, R):
    """methodround joint (23: X KO r1-5, X SUB r1-5, Y KO r1-5, Y SUB r1-5, X DEC, Y DEC, DRAW) -> FightBlend layout."""
    j = [float(x) for x in Jrow]
    out = j[0:R] + j[5:5 + R] + j[10:10 + R] + j[15:15 + R] + [j[20], j[21], j[22]]
    s = sum(out)
    return [round(x / s, 9) for x in out]


def export_s2_js(MR, D, T, FX, FY, FX2, FY2, y, cols, new, C6, chosen, C, T2):
    yrs = T["year"].to_numpy()
    tr6 = (yrs >= 2012) & (yrs <= 2025)
    trh = (yrs >= MR.HAZ_START) & (yrs <= 2025)
    m6 = MR.C6Logit(cols, C=C6, hl_years=MR.HL_YEARS).fit(T[tr6], FX2[tr6], FY2[tr6], y[tr6])
    hz = MR.HazardModel(MR.HAZ_COLS, C=chosen["C_haz"], C_dec=MR.C_DEC).fit(T[trh], FX[trh], FY[trh], y[trh])
    assert list(hz.lr.classes_) == [0, 1, 2, 3, 4]
    nb = len(MR.HAZ_COLS)
    full = lambda a: [float(x) for x in np.ravel(a)]
    c6 = {"cols": list(cols), "mean": full(m6.scaler.mean_), "scale": full(m6.scaler.scale_),
          "coef": [full(r) for r in m6.lr.coef_], "intercept": full(m6.lr.intercept_)}
    haz = {"cols": list(MR.HAZ_COLS), "mean": full(hz.scaler.mean_[:nb]), "scale": full(hz.scaler.scale_[:nb]),
           "coef": [full(r) for r in hz.lr.coef_], "round_cols": list(MR.ROUND_COLS)}
    dec = {"cols": list(MR.HAZ_COLS), "mean": full(hz.dscaler.mean_), "scale": full(hz.dscaler.scale_),
           "coef": full(hz.dlr.coef_[1] - hz.dlr.coef_[0]) if hz.dlr.coef_.shape[0] > 1 else full(hz.dlr.coef_[0])}
    # pre-UFC centring means (train rows before 2024, as method_new_cols) and the fade constant
    pre_mu = {}
    for s in ("A_", "B_"):
        for k in ("pre_ko", "pre_sub", "pre_kol", "pre_subl", "pre_fin", "pre_finl"):
            pre_mu.setdefault(k, {})[s] = float(np.nanmean(T2.loc[(T2["date"] < dt.date(2024, 1, 1)) & (T2[s + "pre_ok"] > 0), s + k]))
    # test vectors: 40 rows of 2024-2025 fights with their full feature rows (both directions) and Python joint cells
    rng = np.random.default_rng(6)
    cand = np.flatnonzero((yrs >= 2024) & (yrs <= 2025))
    pick = rng.choice(cand, 40, replace=False)
    Hh = hz.predict(T.iloc[pick], FX.iloc[pick], FY.iloc[pick])
    P6 = m6.predict6(T.iloc[pick], FX2.iloc[pick], FY2.iloc[pick])
    Jp = MR.joint_from_c6(P6, Hh, hz.draw_c)
    vectors = []
    for k, i in enumerate(pick):
        R = 5 if int(T["rounds"].iloc[i] or 3) == 5 else 3
        vectors.append({"id": str(T["id"].iloc[i]), "rounds": R,
                        "DA": {c: float(FX2[c].iloc[i]) for c in set(cols) | set(MR.HAZ_COLS)},
                        "DB": {c: float(FY2[c].iloc[i]) for c in set(cols) | set(MR.HAZ_COLS)},
                        "joint23": [float(x) for x in Jp[k]]})
    return {"version": 1, "variant": "S2", "fit_through": str(T["date"][tr6].max()),
            "note": "S2 = methodround's 6-class model with ML v2's columns (research/model_ml2.md section 7) and "
                    "methodround's hazard; evaluate with tools/methodround_model.js createS2(js_model) (full precision, "
                    "fit 2012..2025 / hazard %d..2025: page and ledger only, never a backtest)" % MR.HAZ_START,
            "c6": c6, "hazard": haz, "decision": dec, "draw_c": float(hz.draw_c), "new_columns": list(new),
            "pre_mu": pre_mu, "pre_tau": C["lr"]["tau"], "vectors": vectors}


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["stacks", "s2", "all"])
    a = ap.parse_args()
    if a.cmd in ("stacks", "all"):
        stage_stacks(a)
    if a.cmd in ("s2", "all"):
        stage_s2(a)


if __name__ == "__main__":
    main()
