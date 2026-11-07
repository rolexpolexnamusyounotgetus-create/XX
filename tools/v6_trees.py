#!/usr/bin/env python3
"""v6_trees.py: export ML v2's tree models for the JS tree evaluator (src/ml/ml2trees.js; V6_V10_PLAN 7.1 item 7).

ML v2's CV choice is the blend LR 0.434 + LightGBM 0.399 + XGBoost 0.153 (non-negative logit weights, no intercept;
research/model_ml2.md). The page could only evaluate the logistic. This tool refits the frozen tree configuration
(out/ml2_cache/cv.json: LightGBM 5 seeds x 350 rounds, XGBoost 3 seeds x 475 rounds, on both corner orientations) on
every decisive fight 2010-2025 (the page model's rows; 2026 is dropped at parse), exports every tree in a compact array
form, and writes Python reference vectors:
  - static check: the same configuration fit on fights before 2024 reproduces ml2.json / fit.pkl's static 2024-2025
    predictions exactly (so the production refit is the validated model, refit);
  - export check: the exported arrays, evaluated in Python, equal the libraries' own predictions;
  - test vectors: 40 design-row pairs (G0 = A's view, G1 = the swapped view) with the per-model and blended outputs.

    nice -n 5 python3 tools/v6_trees.py        -> data/derived/ml2_trees.json (+ size report)
"""
from __future__ import annotations

import datetime as dt
import gzip
import json
import math
import os
import pickle
import sys

for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "1")
import numpy as np  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import ml2 as M2  # noqa: E402

DER = os.path.join(ROOT, "data", "derived")


def log(*a):
    print("[v6_trees]", *a, flush=True)


def sig(z):
    return 1 / (1 + np.exp(-z))


def logit(p, eps=1e-6):
    p = np.clip(p, eps, 1 - eps)
    return np.log(p / (1 - p))


def lgb_export(m):
    """LightGBM model -> list of trees: {f: [...], t: [...], l: [...], r: [...], dl: [...], mt: [...], v: [...]} where
    internal node i splits on feature f[i] at threshold t[i] (x <= t -> left), children >= 0 are internal nodes and
    child < 0 is leaf ~child; dl = default_left, mt = missing type (0 None, 1 Zero, 2 NaN)."""
    out = []
    for ti in m.dump_model()["tree_info"]:
        F, Tt, L, R, DL, MT, V = [], [], [], [], [], [], []

        def walk(n):
            if "leaf_index" in n or "leaf_value" in n and "split_feature" not in n:
                V.append(float(n["leaf_value"]))
                return ~(len(V) - 1)
            k = len(F)
            F.append(int(n["split_feature"])); Tt.append(float(n["threshold"])); L.append(0); R.append(0)  # float64 thresholds
            DL.append(1 if n.get("default_left") else 0)
            MT.append({"None": 0, "Zero": 1, "NaN": 2}[n.get("missing_type", "None")])
            assert n.get("decision_type", "<=") == "<="
            L[k] = walk(n["left_child"]); R[k] = walk(n["right_child"])
            return k
        root = walk(ti["tree_structure"])
        out.append({"f": F, "t": Tt, "l": L, "r": R, "dl": DL, "mt": MT, "v": V, "root": root})
    return out


def lgb_eval_tree(T, x):
    n = T["root"]
    if n < 0:
        return T["v"][~n]
    while n >= 0:
        v = x[T["f"][n]]
        mt = T["mt"][n]
        if math.isnan(v):
            if mt == 2:
                go_left = bool(T["dl"][n])
            else:
                v = 0.0
                go_left = v <= T["t"][n] if mt != 1 else bool(T["dl"][n])
        elif mt == 1 and abs(v) <= 1e-35:
            go_left = bool(T["dl"][n])
        else:
            go_left = v <= T["t"][n]
        n = T["l"][n] if go_left else T["r"][n]
    return T["v"][~n]


def xgb_export(m, names):
    """XGBoost booster -> trees {f, t, yes, no, miss, v} (x < t -> yes; NaN -> miss), leaves as ~index; plus base margin."""
    out = []
    fidx = {nm: i for i, nm in enumerate(names)}
    for js in m.get_dump(dump_format="json"):
        n0 = json.loads(js)
        F, Tt, Y, N, MS, V = [], [], [], [], [], []
        idmap = {}

        def walk(n):
            if "leaf" in n:
                V.append(float(np.float32(n["leaf"])))
                return ~(len(V) - 1)
            k = len(F)
            idmap[n["nodeid"]] = k
            f = n["split"]
            F.append(fidx[f] if f in fidx else int(str(f).lstrip("f"))); Tt.append(float(np.float32(n["split_condition"])))
            Y.append(0); N.append(0); MS.append(0)
            ch = {c["nodeid"]: c for c in n["children"]}
            Y[k] = walk(ch[n["yes"]]); N[k] = walk(ch[n["no"]])
            MS[k] = Y[k] if n["missing"] == n["yes"] else N[k]
            return k
        root = walk(n0)
        out.append({"f": F, "t": Tt, "y": Y, "n": N, "m": MS, "v": V, "root": root})
    cfg = json.loads(m.save_config())
    bs = float(cfg["learner"]["learner_model_param"]["base_score"].strip("[]"))
    return out, bs


def xgb_eval_tree(T, x):
    n = T["root"]
    if n < 0:
        return T["v"][~n]
    while n >= 0:
        v = x[T["f"][n]]
        if math.isnan(v):
            n = T["m"][n]
        else:   # XGBoost compares in float32 (JS: Math.fround)
            n = T["y"][n] if np.float32(v) < np.float32(T["t"][n]) else T["n"][n]
    return T["v"][~n]


def main():
    S = M2.load_table()
    T = S["df"]
    assert T["date"].max() < dt.date(2026, 1, 1)
    C = json.load(open(os.path.join(M2.CACHE, "cv.json")))
    F = pickle.load(open(os.path.join(M2.CACHE, "fit.pkl"), "rb"))
    X = M2.superset_matrix(T, C["pre_means"])
    y = T["y"].fillna(0.5).to_numpy(float)
    G0, G1 = M2.tree_mats(T, X, C["lr"]["cols"])
    names = list(G0.columns)
    tc = C["trees"]
    # 1) static reproduction (fit < 2024)
    tr_s = M2.train_mask(T, dt.date(2024, 1, 1), C["lr"])
    te = ((T["date"] >= dt.date(2024, 1, 1)) & (T["date"] < dt.date(2026, 1, 1))).to_numpy()
    chk = {}
    for kind, seeds in (("lgb", M2.LGB_SEEDS), ("xgb", M2.XGB_SEEDS)):
        ps = []
        for sd in seeds:
            if kind == "lgb":
                m = M2.lgb_train(tc[kind]["cfg"], G0[tr_s], G1[tr_s], y[tr_s], tc[kind]["rounds"], sd, tc[kind]["mono"])
                ps.append(M2.lgb_predict(m, G0[te], G1[te]))
            else:
                m = M2.xgb_train(tc[kind]["cfg"], G0[tr_s], G1[tr_s], y[tr_s], tc[kind]["rounds"], sd, tc[kind]["mono"])
                ps.append(M2.xgb_predict(m, G0[te], G1[te]))
        p = sig(np.mean(logit(np.vstack(ps)), axis=0))
        chk[kind] = float(np.max(np.abs(p - F["preds"][kind + "|static"][te])))
        log("static %s reproduces fit.pkl: max |diff| %.2e" % (kind, chk[kind]))
    # 2) production fit 2010-2025
    tr = M2.train_mask(T, dt.date(2026, 1, 1), C["lr"])
    models = {"lgb": [], "xgb": []}
    for sd in M2.LGB_SEEDS:
        models["lgb"].append(M2.lgb_train(tc["lgb"]["cfg"], G0[tr], G1[tr], y[tr], tc["lgb"]["rounds"], sd, tc["lgb"]["mono"]))
    for sd in M2.XGB_SEEDS:
        models["xgb"].append(M2.xgb_train(tc["xgb"]["cfg"], G0[tr], G1[tr], y[tr], tc["xgb"]["rounds"], sd, tc["xgb"]["mono"]))
    exp = {"lgb": [lgb_export(m) for m in models["lgb"]], "xgb": []}
    xbs = []
    for m in models["xgb"]:
        t_, bs = xgb_export(m, names)
        exp["xgb"].append(t_)
        xbs.append(bs)
    # 3) export check on 200 rows + 40 test vectors (2024-2025 rows; production model)
    rng = np.random.default_rng(11)
    rows = rng.choice(np.flatnonzero(te), 200, replace=False)
    A0, A1 = G0.to_numpy(float), G1.to_numpy(float)

    def ens(kind, x0, x1):
        zs = []
        for k, trees in enumerate(exp[kind]):
            if kind == "lgb":
                p0 = sig(sum(lgb_eval_tree(t_, x0) for t_ in trees))
                p1 = sig(sum(lgb_eval_tree(t_, x1) for t_ in trees))
            else:
                b = math.log(xbs[k] / (1 - xbs[k]))
                p0 = sig(b + sum(xgb_eval_tree(t_, x0) for t_ in trees))
                p1 = sig(b + sum(xgb_eval_tree(t_, x1) for t_ in trees))
            zs.append(float(logit(np.array([0.5 * (p0 + 1 - p1)]))[0]))
        return float(sig(np.mean(zs)))
    lib = {}
    for kind in ("lgb", "xgb"):
        ps = []
        for m in models[kind]:
            ps.append((M2.lgb_predict if kind == "lgb" else M2.xgb_predict)(m, G0.iloc[rows], G1.iloc[rows]))
        lib[kind] = sig(np.mean(logit(np.vstack(ps)), axis=0))
    err = {k: max(abs(ens(k, A0[i], A1[i]) - lib[k][j]) for j, i in enumerate(rows)) for k in ("lgb", "xgb")}
    log("export check (200 rows): lgb %.2e xgb %.2e" % (err["lgb"], err["xgb"]))
    w = [float(v) for v in F["blend_w"]]
    vec = []
    for j, i in enumerate(rows[:40]):
        x0, x1 = [None if math.isnan(v) else float(v) for v in A0[i]], [None if math.isnan(v) else float(v) for v in A1[i]]
        pl, px = ens("lgb", A0[i], A1[i]), ens("xgb", A0[i], A1[i])
        vec.append({"id": str(T["fid"].iloc[i]), "g0": x0, "g1": x1, "lgb": float(pl), "xgb": float(px)})
    doc = {"meta": {"tool": "tools/v6_trees.py", "built": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
                    "fit": "every decisive UFC fight 2010-01-01..2025-12-31 (tools/ml2.py train_mask, the page model's rows), both "
                           "corner orientations; frozen configuration out/ml2_cache/cv.json; 2026 dropped at parse",
                    "lgb": {"cfg": tc["lgb"]["cfg"], "rounds": tc["lgb"]["rounds"], "seeds": M2.LGB_SEEDS, "learning_rate": M2.LGB_LR},
                    "xgb": {"cfg": tc["xgb"]["cfg"], "rounds": tc["xgb"]["rounds"], "seeds": M2.XGB_SEEDS, "eta": M2.XGB_ETA},
                    "static_reproduction_max_abs_diff": chk, "export_check_max_abs_diff": err,
                    "prediction": "per seed p = 0.5 (f(g0) + 1 - f(g1)); seeds averaged in logit space; blend logit = "
                                  "w_lr logit(p_lr) + w_lgb logit(p_lgb) + w_xgb logit(p_xgb) (clip 1e-6), no intercept",
                    "n_train": int(tr.sum())},
           "columns": names, "blend_w": {"lr": w[0], "lgb": w[1], "xgb": w[2]},
           "lgb": exp["lgb"], "xgb": exp["xgb"], "xgb_base_score": [float(b) for b in xbs], "vectors": vec}
    s = json.dumps(doc, separators=(",", ":"))
    open(os.path.join(DER, "ml2_trees.json"), "w").write(s)
    gz = len(gzip.compress(s.encode()))
    log("wrote data/derived/ml2_trees.json: %.0f KB raw, %.0f KB gzipped (budget 1 MB gzipped)" % (len(s) / 1024, gz / 1024))


if __name__ == "__main__":
    main()
