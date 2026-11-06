#!/usr/bin/env python3
"""embed_blend_loyo.py: train-only checks and leave-one-year-out coefficients for the engine's embedding blend
(engine v5 merge step 4, params.components.embed; research/model_embed.md "Integration recipe").

The exported stat-line recipe (data/derived/embed_model.json mlrates_blend.targets = params3.js embed.recipe) is, per
mlrates target,  link(rate) = b0 + b1 link(mlrates rate) + b2 eta_embedding[task],  fit on mlrates' 2019-2023
out-of-fold rows, with b2 = 0 where time-ordered CV inside 2019-2023 rejected the embedding term. Used on train fights
that recipe is in-sample, so the backtest harness (tools/mlpathrec.js) gives each train fight the recipe refit WITHOUT its
year (leave-one-year-out; the keep set stays the exported one). This tool:
  1. rebuilds the per-row inputs: mlrates_oof.json (time-ordered folds), the embedding task predictors exactly as the engine
     path computes them (node tools/mlpathrec.js --dump-embed-train: embed.json snapshots + their quarterly refit), and the
     actual directed counts and exposures of the 18 targets (tools/mlrates.py's dataset cache; built from data/raw if
     missing); TRAIN fights only (2019-01-01..2023-12-31 of backtest_dev.json); nothing from 2024 on is read;
  2. checks that the full 2019-2023 fit reproduces the exported recipe (same inputs as tools/embed.py, up to its 4-decimal
     snapshot rounding);
  3. fits coef_loyo[year] (recipe without that year) and scores each year with the recipe that did not see it: mean relative
     deviance change over the 18 targets, blend vs the recalibrated mlrates (b2 = 0; the embedding's own gain, as in the
     report) and vs the raw mlrates rates, with 95% event-date cluster bootstrap intervals; per target, per year, and for
     attackers with 1-3 prior UFC fights;
  4. writes data/derived/embed_blend_loyo.json.

    python3 tools/embed_blend_loyo.py            (about a minute)
"""
from __future__ import annotations

import json
import math
import os
import pickle
import subprocess
import sys
import tempfile
from collections import defaultdict

for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "1")
import numpy as np  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DER = os.path.join(ROOT, "data", "derived")
TRAIN = ("2019-01-01", "2024-01-01")
YEARS = list(range(2019, 2024))
SEED = 20261106
# mlrates target -> (numerator key, exposure: "min" or a key), as tools/mlrates.py TARGETS
TGT = {"d_att": ("d_att", "min"), "c_att": ("c_att", "min"), "g_att": ("g_att", "min"), "h_att": ("h_att", "min"),
       "b_att": ("b_att", "min"), "l_att": ("l_att", "min"), "td_att": ("td_att", "min"), "sub_att": ("sub_att", "min"),
       "rev": ("rev", "min"), "ctrl": ("ctrl", "min"), "acc_h": ("h_lnd", "h_att"), "acc_b": ("b_lnd", "b_att"),
       "acc_l": ("l_lnd", "l_att"), "acc_d": ("d_lnd", "d_att"), "acc_c": ("c_lnd", "c_att"), "acc_g": ("g_lnd", "g_att"),
       "td_acc": ("td_lnd", "td_att"), "kd_h": ("kd", "h_lnd")}


def glm_newton(Z, y, n, binom, iters=50, ridge=1e-6):
    """tools/embed.py _glm_newton (Poisson log link with exposure n, or binomial logit with n trials)."""
    b = np.zeros(Z.shape[1])
    if not binom:
        b[0] = math.log(max(y.sum(), 1e-9) / max(n.sum(), 1e-9))
    for _ in range(iters):
        e = Z @ b
        if binom:
            pr = 1 / (1 + np.exp(-e))
            g = Z.T @ (n * pr - y) + ridge * b
            H = (Z * (n * pr * (1 - pr))[:, None]).T @ Z + ridge * np.eye(len(b))
        else:
            mu = n * np.exp(np.clip(e, -30, 20))
            g = Z.T @ (mu - y) + ridge * b
            H = (Z * mu[:, None]).T @ Z + ridge * np.eye(len(b))
        step = np.linalg.solve(H, g)
        b -= step
        if np.abs(step).max() < 1e-10:
            break
    return b


def dev1(y, n, eta, binom):
    """tools/embed.py _dev1."""
    if binom:
        mu = n / (1 + np.exp(-eta))
        t1 = np.where(y > 0, y * np.log(np.maximum(y, 1e-12) / np.maximum(mu, 1e-12)), 0.0)
        t2 = np.where(n - y > 0, (n - y) * np.log(np.maximum(n - y, 1e-12) / np.maximum(n - mu, 1e-12)), 0.0)
        return 2 * (t1 + t2)
    mu = n * np.exp(np.clip(eta, -30, 20))
    return 2 * (np.where(y > 0, y * np.log(np.maximum(y, 1e-12) / np.maximum(mu, 1e-12)), 0.0) - (y - mu))


def blend_link(tname, binom_task, ml):
    """tools/embed.py _blend_link: mlrates output -> the blend's link scale (and whether the blend is binomial)."""
    if tname == "ctrl":
        return np.log(np.maximum(ml / 60.0, 1e-6)), False
    if tname == "kd_h":
        return np.log(np.clip(ml, 1e-6, 1 - 1e-6)), False
    if binom_task:
        pm = np.clip(ml, 1e-6, 1 - 1e-6)
        return np.log(pm / (1 - pm)), True
    return np.log(np.maximum(ml, 1e-9)), False


def boot_ci(delta, clusters, n_boot=2000, seed=SEED):
    rng = np.random.default_rng(seed)
    d = np.asarray(delta, float)
    _, inv = np.unique(np.asarray(clusters), return_inverse=True)
    cs = np.bincount(inv, weights=d)
    cn = np.bincount(inv).astype(float)
    pick = rng.integers(0, len(cs), (n_boot, len(cs)))
    bs = cs[pick].sum(1) / cn[pick].sum(1)
    return float(d.mean()), float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5))


def load_rows():
    """Directed actual counts (60-key vectors) and minutes per (fight id, side) from tools/mlrates.py's dataset."""
    sys.path.insert(0, HERE)
    import mlrates as MR  # noqa: E402
    cache = os.path.join(MR.CACHE, "dataset.pkl")
    if os.path.exists(cache):
        with open(cache, "rb") as fh:
            rows = pickle.load(fh)["rows"]
        src = cache
    else:
        rows, _ = MR.build_dataset()
        src = "tools/mlrates.py build_dataset (data/raw)"
    out = {}
    for r in rows:
        if not (TRAIN[0] <= r["date"] < TRAIN[1]):
            continue                      # train years only: nothing from 2024 on is read
        out[r["id"]] = (r["v"], r["minutes"])
    return out, MR.KI, src


def main():
    bt = json.load(open(os.path.join(DER, "backtest_dev.json")))
    fights = {f["id"]: f for f in bt["fights"] if TRAIN[0] <= f["date"] < TRAIN[1]}
    oof = json.load(open(os.path.join(DER, "mlrates_oof.json")))
    targets = oof["meta"]["targets"]
    model = json.load(open(os.path.join(DER, "embed_model.json")))
    recipe = model["mlrates_blend"]["targets"]
    tasks = [t[0] for t in model["tasks"]]
    task_bin = {t[0]: t[1] == "bin" for t in model["tasks"]}
    with tempfile.TemporaryDirectory() as td:
        dump = os.path.join(td, "etas.json")
        subprocess.run(["node", os.path.join(HERE, "mlpathrec.js"), "--dump-embed-train", dump], check=True,
                       stdout=subprocess.DEVNULL)
        etas = json.load(open(dump))
    assert etas["meta"]["tasks"] == tasks, "task order differs between embed.json and embed_model.json"
    act, KI, src = load_rows()

    R = []                                           # (fid, side, year, date, n_ufc, ML[18], ETA[21], v, minutes)
    miss = defaultdict(int)
    for fid, f in sorted(fights.items()):
        o = oof["fights"].get(fid)
        e = etas["fights"].get(fid)
        a = act.get(fid)
        if not o or not o.get("A") or not o.get("B") or not str(o.get("src", "")).startswith("cv"):
            miss["oof"] += 1
            continue
        if not e:
            miss["eta"] += 1
            continue
        if not a:
            miss["actual"] += 1
            continue
        v, mins = a
        for s, tag in ((0, "A"), (1, "B")):
            R.append((fid, s, int(f["date"][:4]), f["date"], int(f[tag]["n"]), o[tag], e["eta" + tag], v[s], float(mins)))
    yrs = np.array([r[2] for r in R])
    dates = np.array([r[3] for r in R])
    nufc = np.array([r[4] for r in R])
    ML = np.array([r[5] for r in R], float)
    ETA = np.array([r[6] for r in R], float)
    print("train rows %d (fights %d; skipped %s); actuals from %s" % (len(R), len(fights), dict(miss), src))

    keep = {t: abs(recipe[t]["b"][2]) > 0 for t in targets}
    full_check, loyo, per_target = {}, {y: {} for y in YEARS}, {}
    dv = {"raw": [], "recal": [], "blend": []}
    for k, tn in enumerate(targets):
        num, ex = TGT[tn]
        y = np.array([r[7][KI[num]] for r in R], float)
        n = np.array([r[8] if ex == "min" else r[7][KI[ex]] for r in R], float)
        if tn == "ctrl":
            y = y / 60.0                               # control minutes per fight minute (tools/embed.py units)
        ok = n > 0
        task = recipe[tn]["task"]
        lm, binom = blend_link(tn, task_bin[task], ML[:, k])
        le = ETA[:, tasks.index(task)]
        one = np.ones(len(y))
        Z1, Z2 = np.c_[one, lm], np.c_[one, lm, le]
        Zb = Z2 if keep[tn] else Z1
        # 2. the full 2019-2023 fit vs the exported recipe
        bf = glm_newton(Zb[ok], y[ok], n[ok], binom)
        bf = np.r_[bf, 0.0] if not keep[tn] else bf
        full_check[tn] = {"refit": [round(float(x), 6) for x in bf], "exported": recipe[tn]["b"],
                          "max_abs_diff": round(float(np.max(np.abs(bf - np.array(recipe[tn]["b"])))), 6)}
        # 3. leave-one-year-out fits and scores
        d_raw, d1, d2 = np.zeros(len(y)), np.zeros(len(y)), np.zeros(len(y))
        for vy in YEARS:
            a = ok & (yrs != vy)
            b = ok & (yrs == vy)
            b1 = glm_newton(Z1[a], y[a], n[a], binom)
            b2 = glm_newton(Zb[a], y[a], n[a], binom)
            loyo[vy][tn] = {"task": task, "link": recipe[tn]["link"], "units": recipe[tn]["units"],
                            "b": [round(float(x), 6) for x in (b2 if keep[tn] else np.r_[b2, 0.0])]}
            d_raw[b] = dev1(y[b], n[b], lm[b], binom)
            d1[b] = dev1(y[b], n[b], Z1[b] @ b1, binom)
            d2[b] = dev1(y[b], n[b], Zb[b] @ b2, binom)
        dv["raw"].append(d_raw)
        dv["recal"].append(d1)
        dv["blend"].append(d2)
        mu, lo, hi = boot_ci(d2 - d1, dates)
        base = d1.mean()
        per_target[tn] = {"keep_b2": keep[tn], "loyo_dev_raw": round(float(d_raw.sum()), 2),
                          "loyo_dev_recal": round(float(d1.sum()), 2), "loyo_dev_blend": round(float(d2.sum()), 2),
                          "rel_change_vs_recal": round(mu / base, 5), "ci95": [round(lo / base, 5), round(hi / base, 5)]}
        print("  %-7s keep b2 %-5s  blend vs recal %+.2f%% [%+.2f, %+.2f]   full-fit max |b - exported| %.4f" % (
            tn, keep[tn], 100 * mu / base, 100 * lo / base, 100 * hi / base, full_check[tn]["max_abs_diff"]))
    NTg = len(targets)

    def mean_rel(mask, which, ref):
        contrib = np.zeros(int(mask.sum()))
        for dr, dx in zip(dv[ref], dv[which]):
            contrib += (dx[mask] - dr[mask]) / max(dr[mask].sum(), 1e-9) / NTg
        mu, lo, hi = boot_ci(contrib, dates[mask])
        kk = len(contrib)
        return {"n_rows": kk, "mean": round(mu * kk, 5), "ci95": [round(lo * kk, 5), round(hi * kk, 5)]}

    allm = np.ones(len(R), bool)
    segs = {"all": allm, "attacker 1-3 UFC fights": nufc <= 3, "attacker 4+": nufc >= 4}
    for y_ in YEARS:
        segs[str(y_)] = yrs == y_
    check = {}
    for sk, m in segs.items():
        check[sk] = {"blend_vs_recal": mean_rel(m, "blend", "recal"), "blend_vs_raw": mean_rel(m, "blend", "raw"),
                     "recal_vs_raw": mean_rel(m, "recal", "raw")}
        c = check[sk]
        print("  %-24s n %5d  blend vs recal %+.2f%% [%+.2f, %+.2f]  blend vs raw %+.2f%% [%+.2f, %+.2f]" % (
            sk, c["blend_vs_recal"]["n_rows"], 100 * c["blend_vs_recal"]["mean"], 100 * c["blend_vs_recal"]["ci95"][0],
            100 * c["blend_vs_recal"]["ci95"][1], 100 * c["blend_vs_raw"]["mean"], 100 * c["blend_vs_raw"]["ci95"][0],
            100 * c["blend_vs_raw"]["ci95"][1]))
    out = {
        "meta": {"tool": "tools/embed_blend_loyo.py", "window": "TRAIN 2019-01-01..2023-12-31 (backtest_dev.json); "
                 "nothing dated 2024-01-01 or later is read", "rows": len(R), "skipped": dict(miss), "actuals": src,
                 "inputs": "mlrates_oof.json (time-ordered folds), embedding etas from tools/mlpathrec.js "
                           "(embed.json snapshots + quarterly refits), tools/mlrates.py directed counts",
                 "keep_set": "the exported recipe's (b2 = 0 for rev, acc_g, td_acc, kd_h: time-ordered CV inside 2019-2023)",
                 "metric": "mean over the 18 targets of the relative change in summed deviance, each year scored by the "
                           "recipe fit without it; 95% CI: 2,000 event-date cluster resamples"},
        "coef_loyo": {str(y_): loyo[y_] for y_ in YEARS},
        "full_fit_check": full_check,
        "full_fit_max_abs_diff": max(v["max_abs_diff"] for v in full_check.values()),
        "train_check": {"segments": check, "per_target": per_target},
    }
    with open(os.path.join(DER, "embed_blend_loyo.json"), "w") as fh:
        json.dump(out, fh, indent=1)
    print("wrote data/derived/embed_blend_loyo.json; full-fit max |b - exported| = %.4f" % out["full_fit_max_abs_diff"])


if __name__ == "__main__":
    main()
