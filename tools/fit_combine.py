#!/usr/bin/env python3
"""Fit how two fighters' rates combine in a fight (walk-forward, no leakage).

For every UFC fight with round stats in the fit window where both men had at least MIN_PRIOR_MIN
minutes of earlier UFC fights with stats, take each man's career-to-date rates from earlier fights
only, shrink them toward the division (league) rate, and regress what actually happened:

  count rates (Poisson, exposure = minutes, or landed head strikes for knockdowns):
      log E[y / exposure] = log L + c + a * log(x / L) + b * log(y_allowed / L)
  probabilities (binomial logit):
      logit P = logit L + c + a * (logit x - logit L) + b * (logit y_allowed - logit L)

x is the attacker's prior rate, y_allowed the defender's prior rate conceded, L the league rate in the
fight's division. a = b = 1 with c = 0 is the pure log-linear / log5 rule in docs/ENGINE_V3_SPEC.md.
Coefficients are fit on TRAIN years and scored on TEST years against (i) the pure rule and (ii) the
v2-style average of the two rates.

Writes data/derived/combine_fit.json; tools/fighter_report.py uses it for matchup projections.

Usage: python3 tools/fit_combine.py [--train 2012-01-01:2023-12-31] [--test 2024-01-01:2026-10-31]
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fighter_report import DB, OUT, DIV_LBS  # noqa: E402

MIN_PRIOR_MIN = 15.0
CUM = ["minutes", "sig_a", "sig_l", "o_sig_a", "o_sig_l", "head_a", "head_l", "o_head_a", "o_head_l",
       "td_a", "td_l", "o_td_a", "o_td_l", "kd", "o_kd", "ctrl", "o_ctrl", "sub", "o_sub"]
# shrinkage pseudo-exposure for the predictors (minutes, attempts, head strikes); tuned on TRAIN below
K = {"pm": 40.0, "acc": 150.0, "td_pm": 45.0, "td_acc": 12.0, "kd": 230.0}
HL_GRID = [None, 1460, 730, 365]
K_GRID = {"pm": [5, 10, 20, 30, 40, 60, 80, 120, 180], "acc": [25, 50, 100, 150, 200, 300, 500, 800, 1200, 2000, 3500],
          "td_pm": [10, 20, 30, 45, 60, 90, 120, 180, 270], "td_acc": [2, 4, 6, 9, 12, 20, 30, 50],
          "kd": [50, 100, 150, 230, 300, 500, 800, 1200, 2000]}
SPEC_K = {"sig_att_pm": "pm", "sig_lnd_pm": "pm", "sig_acc": "acc", "td_att_pm": "td_pm", "td_acc": "td_acc",
          "kd_per_head": "kd"}


def irls_poisson(X, y, off, iters=50):
    b = np.zeros(X.shape[1])
    b[0] = math.log(max(y.sum(), 1e-9) / np.exp(off).sum())
    for _ in range(iters):
        eta = X @ b + off
        mu = np.exp(eta)
        z = eta - off + (y - mu) / mu
        W = mu
        XtW = X.T * W
        nb = np.linalg.solve(XtW @ X, XtW @ z)
        if np.max(np.abs(nb - b)) < 1e-9:
            b = nb
            break
        b = nb
    mu = np.exp(X @ b + off)
    phi = float(np.sum((y - mu) ** 2 / mu) / max(len(y) - X.shape[1], 1))
    cov = np.linalg.inv((X.T * mu) @ X) * phi
    return b, np.sqrt(np.diag(cov)), phi


def irls_logit(X, y, n, off, iters=50):
    b = np.zeros(X.shape[1])
    for _ in range(iters):
        eta = X @ b + off
        p = 1 / (1 + np.exp(-eta))
        W = n * p * (1 - p) + 1e-12
        z = eta - off + (y - n * p) / W
        XtW = X.T * W
        nb = np.linalg.solve(XtW @ X, XtW @ z)
        if np.max(np.abs(nb - b)) < 1e-9:
            b = nb
            break
        b = nb
    p = 1 / (1 + np.exp(-(X @ b + off)))
    W = n * p * (1 - p) + 1e-12
    phi = float(np.sum((y - n * p) ** 2 / W) / max(len(y) - X.shape[1], 1))
    cov = np.linalg.inv((X.T * W) @ X) * phi
    return b, np.sqrt(np.diag(cov)), phi


def pois_dev(y, mu):
    mu = np.maximum(mu, 1e-12)
    t = np.where(y > 0, y * np.log(np.maximum(y, 1e-12) / mu), 0.0)
    return float(2 * np.sum(t - (y - mu)))


def binom_dev(y, n, p):
    p = np.clip(p, 1e-9, 1 - 1e-9)
    a = np.where(y > 0, y * np.log(np.maximum(y, 1e-12) / (n * p)), 0.0)
    m = n - y
    bb = np.where(m > 0, m * np.log(np.maximum(m, 1e-12) / (n * (1 - p))), 0.0)
    return float(2 * np.sum(a + bb))


def logit(p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


def build_rows(db: DB, hl: float | None = None) -> pd.DataFrame:
    """One row per fighter per fight with p_* = his sums over EARLIER fights (decayed by half-life hl
    days relative to this fight's date, or undecayed if hl is None) and q_* = the opponent's."""
    ff = db.ff[db.ff["has_stats"]].copy()
    ff = ff.sort_values(["date", "fight_id"]).reset_index(drop=True)
    for c in CUM:
        ff[c] = ff[c].fillna(0.0)
    g = ff.groupby("fighter")
    ff["p_minutes_raw"] = g["minutes"].cumsum() - ff["minutes"]
    if hl is None:
        for c in CUM:
            ff["p_" + c] = g[c].cumsum() - ff[c]          # sums over earlier fights only
    else:
        P = np.zeros((len(ff), len(CUM)))
        days = (ff["date"] - pd.Timestamp("1990-01-01")).dt.days.values.astype(float)
        S = ff[CUM].values.astype(float)
        for _, idx in g.indices.items():
            idx = np.sort(idx)
            d = days[idx]
            W = np.tril(0.5 ** ((d[:, None] - d[None, :]) / hl), k=-1)
            P[idx] = W @ S[idx]
        for j, c in enumerate(CUM):
            ff["p_" + c] = P[:, j]
    pri = ff[["fight_id", "fighter", "p_minutes_raw"] + ["p_" + c for c in CUM]].rename(
        columns={"fighter": "opponent", "p_minutes_raw": "q_minutes_raw", **{"p_" + c: "q_" + c for c in CUM}})
    rows = ff.merge(pri, on=["fight_id", "opponent"], how="inner")
    rows = rows[(rows["p_minutes_raw"] >= MIN_PRIOR_MIN) & (rows["q_minutes_raw"] >= MIN_PRIOR_MIN)]
    rows = rows[rows["division"].map(lambda d: DIV_LBS.get(d) is not None)]
    return rows


def league(db: DB, lo, hi) -> pd.DataFrame:
    ff = db.ff[db.ff["has_stats"] & (db.ff["date"] >= lo) & (db.ff["date"] <= hi)]
    s = ff.groupby("division")[CUM].sum()
    L = pd.DataFrame(index=s.index)
    L["att_pm"] = s["sig_a"] / s["minutes"]
    L["lnd_pm"] = s["sig_l"] / s["minutes"]
    L["acc"] = s["sig_l"] / s["sig_a"]
    L["td_pm"] = s["td_a"] / s["minutes"]
    L["td_acc"] = s["td_l"] / s["td_a"]
    L["kd_head"] = s["kd"] / s["head_l"]
    return L


def features(rows: pd.DataFrame, L: pd.DataFrame, K: dict = K) -> pd.DataFrame:
    r = rows.join(L, on="division")
    sh = lambda num, den, k, prior: (num + k * prior) / (den + k)
    # attacker (p_) and defender-allowed (q_o*)
    r["x_att"] = sh(r["p_sig_a"], r["p_minutes"], K["pm"], r["att_pm"])
    r["y_att"] = sh(r["q_o_sig_a"], r["q_minutes"], K["pm"], r["att_pm"])
    r["x_lnd"] = sh(r["p_sig_l"], r["p_minutes"], K["pm"], r["lnd_pm"])
    r["y_lnd"] = sh(r["q_o_sig_l"], r["q_minutes"], K["pm"], r["lnd_pm"])
    r["x_acc"] = sh(r["p_sig_l"], r["p_sig_a"], K["acc"], r["acc"])
    r["y_acc"] = sh(r["q_o_sig_l"], r["q_o_sig_a"], K["acc"], r["acc"])
    r["x_td"] = sh(r["p_td_a"], r["p_minutes"], K["td_pm"], r["td_pm"])
    r["y_td"] = sh(r["q_o_td_a"], r["q_minutes"], K["td_pm"], r["td_pm"])
    r["x_tdacc"] = sh(r["p_td_l"], r["p_td_a"], K["td_acc"], r["td_acc"])
    r["y_tdacc"] = sh(r["q_o_td_l"], r["q_o_td_a"], K["td_acc"], r["td_acc"])
    r["x_pow"] = sh(r["p_kd"], r["p_head_l"], K["kd"], r["kd_head"])
    r["y_chin"] = sh(r["q_o_kd"], r["q_o_head_l"], K["kd"], r["kd_head"])
    return r


SPECS = {
    # name: (kind, y, exposure/trials, x, y_allowed, league col)
    "sig_att_pm": ("pois", "sig_a", "minutes", "x_att", "y_att", "att_pm"),
    "sig_lnd_pm": ("pois", "sig_l", "minutes", "x_lnd", "y_lnd", "lnd_pm"),
    "sig_acc": ("logit", "sig_l", "sig_a", "x_acc", "y_acc", "acc"),
    "td_att_pm": ("pois", "td_a", "minutes", "x_td", "y_td", "td_pm"),
    "td_acc": ("logit", "td_l", "td_a", "x_tdacc", "y_tdacc", "td_acc"),
    "kd_per_head": ("pois", "kd", "head_l", "x_pow", "y_chin", "kd_head"),
}


def fit_one(tr: pd.DataFrame, te: pd.DataFrame, spec) -> dict:
    kind, yc, ec, xc, yac, lc = spec
    tr = tr[tr[ec] > 0]
    te = te[te[ec] > 0]
    out = {"kind": kind, "n_train": int(len(tr)), "n_test": int(len(te))}

    def design(d):
        if kind == "pois":
            x1, x2 = np.log(d[xc] / d[lc]), np.log(d[yac] / d[lc])
            off = np.log(d[ec]) + np.log(d[lc])
        else:
            x1, x2 = logit(d[xc]) - logit(d[lc]), logit(d[yac]) - logit(d[lc])
            off = logit(d[lc])
        X = np.column_stack([np.ones(len(d)), x1, x2])
        return X, off.values

    Xtr, otr = design(tr)
    Xte, ote = design(te)
    ytr, yte = tr[yc].values.astype(float), te[yc].values.astype(float)
    if kind == "pois":
        b, se, phi = irls_poisson(Xtr, ytr, otr)
        mu_fit = np.exp(Xte @ b + ote)
        mu_pure = np.exp(Xte @ np.array([0, 1, 1]) + ote)
        mu_avg = te[ec].values * 0.5 * (te[xc].values + te[yac].values)
        mu_lg = np.exp(ote)
        dev = {"fit": pois_dev(yte, mu_fit), "pure_loglinear": pois_dev(yte, mu_pure),
               "average": pois_dev(yte, mu_avg), "league_only": pois_dev(yte, mu_lg)}
        ratio = {"fit": float(yte.sum() / mu_fit.sum()), "pure_loglinear": float(yte.sum() / mu_pure.sum()),
                 "average": float(yte.sum() / mu_avg.sum())}
        # per-fight mean absolute % error of the count (fights with exposure >= 5 min for per-minute rates)
        m = te[ec].values >= (5 if ec == "minutes" else 20)
        mape = {k: float(np.mean(np.abs(v[m] - yte[m]) / np.maximum(yte[m], 1))) for k, v in
                (("fit", mu_fit), ("pure_loglinear", mu_pure), ("average", mu_avg), ("league_only", mu_lg))}
    else:
        n_tr, n_te = tr[ec].values.astype(float), te[ec].values.astype(float)
        b, se, phi = irls_logit(Xtr, ytr, n_tr, otr)
        p_fit = 1 / (1 + np.exp(-(Xte @ b + ote)))
        p_pure = 1 / (1 + np.exp(-(Xte @ np.array([0, 1, 1]) + ote)))
        p_avg = 0.5 * (te[xc].values + te[yac].values)
        p_lg = 1 / (1 + np.exp(-ote))
        dev = {"fit": binom_dev(yte, n_te, p_fit), "pure_log5": binom_dev(yte, n_te, p_pure),
               "average": binom_dev(yte, n_te, p_avg), "league_only": binom_dev(yte, n_te, p_lg)}
        ratio = {"fit": float(yte.sum() / (n_te * p_fit).sum()), "pure_log5": float(yte.sum() / (n_te * p_pure).sum()),
                 "average": float(yte.sum() / (n_te * p_avg).sum())}
        mape = None
    out.update({"c": round(float(b[0]), 4), "a": round(float(b[1]), 4), "b": round(float(b[2]), 4),
                "se": [round(float(x), 4) for x in se], "dispersion": round(phi, 3),
                "test_deviance": {k: round(v, 1) for k, v in dev.items()},
                "test_observed_over_predicted": {k: round(v, 4) for k, v in ratio.items()}})
    if mape:
        out["test_mean_abs_rel_err"] = {k: round(v, 4) for k, v in mape.items()}
    return out


def pure_train_dev(tr: pd.DataFrame, spec) -> float:
    kind, yc, ec, xc, yac, lc = spec
    d = tr[tr[ec] > 0]
    y = d[yc].values.astype(float)
    if kind == "pois":
        mu = d[ec].values * d[lc].values * (d[xc].values / d[lc].values) * (d[yac].values / d[lc].values)
        return pois_dev(y, mu)
    eta = logit(d[xc].values) + logit(d[yac].values) - logit(d[lc].values)
    return binom_dev(y, d[ec].values.astype(float), 1 / (1 + np.exp(-eta)))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--train", default="2012-01-01:2023-12-31")
    ap.add_argument("--test", default="2024-01-01:2026-10-31")
    ap.add_argument("--out", default=str(OUT / "combine_fit.json"))
    args = ap.parse_args(argv)
    t0, t1 = [pd.Timestamp(x) for x in args.train.split(":")]
    s0, s1 = [pd.Timestamp(x) for x in args.test.split(":")]
    db = DB()
    rows_by_hl = {hl: build_rows(db, hl) for hl in HL_GRID}
    rows = rows_by_hl[None]
    L = league(db, t0, s1)
    res = {"meta": {"train": args.train, "test": args.test, "min_prior_minutes": MIN_PRIOR_MIN,
                    "shrink_k_default": K,
                    "rows_train": int(((rows["date"] >= t0) & (rows["date"] <= t1)).sum()),
                    "rows_test": int(((rows["date"] >= s0) & (rows["date"] <= s1)).sum()),
                    "model": "count: log E[y/exp] = log L + c + a log(x/L) + b log(y_allowed/L); "
                             "prob: logit p = logit L + c + a (logit x - logit L) + b (logit y_allowed - logit L)",
                    "league": {d: {k: round(float(v), 5) for k, v in row.items()} for d, row in L.iterrows()
                               if DIV_LBS.get(d)}},
           "fits": {}}
    for name, spec in SPECS.items():
        kk = SPEC_K[name]
        scan, hl_scan = {}, {}
        for hl in HL_GRID:
            for kv in K_GRID[kk]:
                r = features(rows_by_hl[hl], L, {**K, kk: float(kv)})
                tr = r[(r["date"] >= t0) & (r["date"] <= t1)]
                scan[(hl, kv)] = pure_train_dev(tr, spec)
            kb = min((v, k_) for (h, k_), v in scan.items() if h == hl)[1]
            r = features(rows_by_hl[hl], L, {**K, kk: float(kb)})
            te_ = r[(r["date"] >= s0) & (r["date"] <= s1)]
            hl_scan[str(hl)] = {"best_k": kb, "train_dev_pure": round(scan[(hl, kb)], 1),
                                "test_dev_pure": round(pure_train_dev(te_, spec), 1)}
        hbest, kbest = min(scan, key=scan.get)
        r = features(rows_by_hl[hbest], L, {**K, kk: float(kbest)})
        tr = r[(r["date"] >= t0) & (r["date"] <= t1)]
        te = r[(r["date"] >= s0) & (r["date"] <= s1)]
        res["fits"][name] = fit_one(tr, te, spec)
        f = res["fits"][name]
        f["shrink_k"] = kbest
        f["half_life_days"] = hbest
        f["decay_scan"] = hl_scan
        f["shrink_unit"] = {"pm": "minutes", "acc": "attempts", "td_pm": "minutes", "td_acc": "attempts",
                            "kd": "landed head strikes"}[kk]
        f["train_dev_pure_by_k"] = {str(k_): round(v, 1) for (h, k_), v in scan.items() if h == hbest}
        # high-high check: attacker and defender both >= 1.25x league
        kind, yc, ec, xc, yac, lc = spec
        if kind == "pois":
            hh = te[(te[xc] / te[lc] >= 1.25) & (te[yac] / te[lc] >= 1.25) & (te[ec] > 0)]
            if len(hh) >= 20:
                pure = (hh[ec] * hh[lc] * (hh[xc] / hh[lc]) * (hh[yac] / hh[lc])).sum()
                avg = (hh[ec] * 0.5 * (hh[xc] + hh[yac])).sum()
                fit = (hh[ec] * hh[lc] * np.exp(f["c"]) * (hh[xc] / hh[lc]) ** f["a"] * (hh[yac] / hh[lc]) ** f["b"]).sum()
                f["test_high_high"] = {"n": int(len(hh)), "observed": round(float(hh[yc].sum()), 1),
                                       "pure": round(float(pure), 1), "fit": round(float(fit), 1),
                                       "average": round(float(avg), 1)}
        print(f"{name:12s} hl={hbest} k={kbest} a={f['a']:.3f} b={f['b']:.3f} c={f['c']:+.3f}  test dev {f['test_deviance']}"
              f" hh {f.get('test_high_high')}\n   decay scan {hl_scan}", file=sys.stderr)
    Path(args.out).write_text(json.dumps(res, indent=1))
    print(f"wrote {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
