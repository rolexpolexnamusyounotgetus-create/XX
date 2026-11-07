#!/usr/bin/env python3
"""v6_foldhonest.py: the v6 review gate (1) (docs/BACKLOG.md "v6 GATES"; docs/CHANGELOG.md v5.0.1, issue "Out-of-fold
tables in-sample for low-dimensional fitted pieces"): refit the mlrates stack weights FOLD-HONESTLY.

mlrates_oof.json (tools/mlrates.py) builds each 2019-2023 fight's learned rates from time-ordered folds (fold year y
trained on 2010..y-1), but blends the three components (GLM, GBM, MLP) with stack weights fit on the pooled 2019-2023
out-of-fold rows, so every train fight's rates use weights that saw its own year. This tool reruns the folds with the
saved hyper-parameters (out/mlrates_cache/fit_state.pkl: GBM rounds, MLP epochs, GLM lambdas and pairs, all chosen on the
2010-2016 / 2017-2018 split), adds folds 2017 and 2018, and fits the weights for year y on the out-of-fold rows of
2017..y-1 only (expanding window). Output: data/derived/mlrates_oof_fh.json (same format as mlrates_oof.json; 2024-2025
rows are copied unchanged from mlrates_oof.json: the dev model trained 2010-2023 is already honest for them).

Check: the reproduced folds, blended with the original pooled weights, must equal mlrates_oof.json's 2019-2023 rates (its
5 significant digits).

    nice -n 5 python3 tools/v6_foldhonest.py          (about 10 minutes, one process)
"""
from __future__ import annotations

import datetime as dt
import json
import os
import pickle
import sys
import time

for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "1")
import numpy as np  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import mlrates as MR  # noqa: E402

DER = os.path.join(ROOT, "data", "derived")
FOLDS = [2017, 2018, 2019, 2020, 2021, 2022, 2023]
SCORE_YEARS = [2019, 2020, 2021, 2022, 2023]


def log(*a):
    print("[foldhonest]", *a, flush=True)


def main():
    from scipy.optimize import minimize
    t0 = time.time()
    d = MR.load_dataset()
    M = d["M"]
    X, Y, EX, BASE = M["X"], M["Y"], M["E"], M["BASE"]
    yr = M["year"]
    assert not (yr >= MR.CUTOFF.year).any()
    nt = len(MR.TNAMES)
    OFF = np.column_stack([MR.link(t, BASE[:, t]) for t in range(nt)])
    st = pickle.load(open(os.path.join(MR.CACHE, "fit_state.pkl"), "rb"))
    rounds, lam_t, mlp_epochs, pairs_t, tw = st["rounds"], st["lam"], st["epochs"], st["pairs"], st["tw"]
    oof = {k: np.full((len(yr), nt), np.nan) for k in ("glm", "gbm", "mlp")}
    for b in FOLDS:
        trm = (yr >= MR.TRAIN_FROM.year) & (yr < b)
        tem = yr == b
        mean = X[trm].mean(0)
        sd = X[trm].std(0) + 1e-6
        for t in range(nt):
            e = EX[:, t]
            a = trm & (e > 0)
            Za = MR.glm_design(X[a], mean, sd, pairs_t[t])
            Zt = MR.glm_design(X[tem], mean, sd, pairs_t[t])
            b0, bb = MR.glm_fit(Za, Y[a, t], e[a], OFF[a, t], MR.TARGETS[t][1], lam_t[t], iters=15,
                                pen_mult=MR.glm_pen(t, len(pairs_t[t])))
            oof["glm"][tem, t] = b0 + Zt @ bb
            bst, _ = MR.gbm_fit(t, X[a], Y[a, t], e[a], OFF[a, t], rounds[t])
            oof["gbm"][tem, t] = bst.predict(X[tem], raw_score=True)
        acc = np.zeros((tem.sum(), nt))
        for s in range(MR.FOLD_MLP_SEEDS):
            net = MR.mlp_train(X[trm], Y[trm], EX[trm], OFF[trm], seed=200 + s, task_w=tw, fixed_epochs=mlp_epochs,
                               **MR.MLP_CFG)
            acc += MR.mlp_predict(net, X[tem]) / MR.FOLD_MLP_SEEDS
        oof["mlp"][tem] = acc
        log("fold %d done (%.0fs)" % (b, time.time() - t0))

    def fit_w(m, t):
        e = EX[:, t]
        mm = m & (e > 0)
        y_, e_, o_ = Y[mm, t], e[mm], OFF[mm, t]
        Dm = np.column_stack([oof[k][mm, t] for k in ("glm", "gbm", "mlp")])
        f = lambda w: MR.target_dev(t, y_, e_, o_ + Dm @ w).mean()
        r = minimize(f, np.array([0.34, 0.33, 0.33]), method="L-BFGS-B", bounds=[(0, 1.5)] * 3)
        return [float(x) for x in r.x], int(mm.sum())

    # check: pooled 2019-2023 weights (as tools/mlrates.py) reproduce the stored stack and the stored rates
    pooled = [fit_w(np.isin(yr, SCORE_YEARS), t)[0] for t in range(nt)]
    pooled_r = [[(round(v, 4) if v >= 1e-3 else 0.0) for v in w] for w in pooled]
    stored = [[s["glm"], s["gbm"], s["mlp"]] for s in st["stack"]]
    stored_r = [[(round(v, 4) if v >= 1e-3 else 0.0) for v in w] for w in stored]
    w_err = float(np.max(np.abs(np.array(pooled_r) - np.array(stored_r))))
    log("pooled weights reproduce fit_state: max |diff| %.2e" % w_err)
    # fold-honest weights per scoring year (expanding window from 2017)
    W_fh = {}
    for y in SCORE_YEARS:
        m = (yr >= FOLDS[0]) & (yr < y)
        W_fh[y] = []
        for t in range(nt):
            w, n = fit_w(m, t)
            W_fh[y].append([(round(v, 4) if v >= 1e-3 else 0.0) for v in w])
    # rates
    old = json.load(open(os.path.join(DER, "mlrates_oof.json")))
    fight = M["row"]
    rows = d["rows"]

    def eta_for(k, W):
        e = OFF[k].copy()
        for t in range(nt):
            for j, c in enumerate(("glm", "gbm", "mlp")):
                if W[t][j]:
                    e[t] += W[t][j] * np.nan_to_num(oof[c][k, t])
        return e
    tab = {}
    max_rel = 0.0
    n_chk = 0
    for k in np.where(np.isin(yr, SCORE_YEARS))[0]:
        r = rows[fight[k]]
        side = "AB"[M["side"][k]]
        e_old = eta_for(k, stored_r)
        rates_old = [MR.sig(MR.inv_link(t, e_old[t]), 5) for t in range(nt)]
        ref = (old["fights"].get(r["id"]) or {}).get(side)
        if ref:
            for a, b_ in zip(rates_old, ref):
                if b_:
                    max_rel = max(max_rel, abs(a - b_) / abs(b_))
            n_chk += 1
        e_new = eta_for(k, W_fh[int(yr[k])])
        ent = tab.setdefault(r["id"], {"date": r["date"], "src": "cv%d-fh" % yr[k]})
        ent[side] = [MR.sig(MR.inv_link(t, e_new[t]), 5) for t in range(nt)]
    log("reproduction of mlrates_oof.json 2019-2023 with the pooled weights: %d sides, max relative diff %.2e" % (n_chk, max_rel))
    for fid, ent in old["fights"].items():
        if ent.get("src") == "dev":
            tab[fid] = ent
    # summary of the change
    ch = []
    for fid, ent in tab.items():
        o = old["fights"].get(fid)
        if not o or ent.get("src") == "dev":
            continue
        for s in "AB":
            if o.get(s) and ent.get(s):
                ch.extend([abs(np.log(max(a, 1e-9) / max(b_, 1e-9))) for a, b_ in zip(ent[s], o[s]) if a and b_])
    out = {"meta": {"name": "mlrates out-of-fold rates, fold-honest stack weights", "targets": MR.TNAMES,
                    "built": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(), "tool": "tools/v6_foldhonest.py",
                    "note": "2019-2023: the time-ordered folds of tools/mlrates.py (fold y trained on 2010..y-1, hyper-parameters "
                            "from out/mlrates_cache/fit_state.pkl), blended with stack weights fit on the out-of-fold rows of "
                            "2017..y-1 only (folds 2017 and 2018 added for that); 2024-2025: mlrates_oof.json's dev rows "
                            "unchanged. src cv<year>-fh / dev. No 2026 fight is present.",
                    "weights_by_year": {str(y): {MR.TNAMES[t]: W_fh[y][t] for t in range(nt)} for y in SCORE_YEARS},
                    "weights_pooled_2019_2023": {MR.TNAMES[t]: stored_r[t] for t in range(nt)},
                    "check": {"pooled_weights_max_abs_diff": w_err, "reproduction_max_rel_diff": max_rel, "sides_checked": n_chk},
                    "change_vs_mlrates_oof": {"median_abs_log_ratio": float(np.median(ch)), "p95_abs_log_ratio": float(np.percentile(ch, 95)),
                                              "max_abs_log_ratio": float(np.max(ch))}},
           "fights": tab}
    json.dump(out, open(os.path.join(DER, "mlrates_oof_fh.json"), "w"), separators=(",", ":"))
    log("wrote data/derived/mlrates_oof_fh.json (%d fights); change vs mlrates_oof.json: median |log ratio| %.4f, p95 %.4f, max %.4f (%.0fs)" % (
        len(tab), np.median(ch), np.percentile(ch, 95), np.max(ch), time.time() - t0))


if __name__ == "__main__":
    main()
