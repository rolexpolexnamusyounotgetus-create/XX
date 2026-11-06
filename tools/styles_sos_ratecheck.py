"""Rate-level check of the section-9 style modifiers on top of the rates the engine actually uses (2019-2023 only).

    python3 tools/styles_sos_ratecheck.py <priors_asof.json> <sos_rows.json> <offsets.json> [out.json]

For each default-on block (research/model_styles.md section 9) and coefficient set ("ab1", "fit"), the prescribed shift
s per fight side (computed exactly as src/styles_sos.js does: styles.py Side.features on the frozen snapshot with
priors_asof, open centred) is tested against the realised per-fight counts with the path's own prediction as offset:
  ml    the learned stat-line model's out-of-fold rates (what engine v4 re-targets its tables to)
  base  engine v4's static expectation with the learned rates off (log-linear composition, a = b = 1)
Blocks and outcomes: dist_att -> distance attempts, td_att -> takedown attempts, gnp_att -> ground attempts,
ctrl_per_td -> control seconds (quasi-Poisson; control per takedown at a fixed takedown count). Reported: the deviance
change of adding s as a fixed offset (level refit), and the fitted slope on s (1 = the prescribed size adds fully,
0 = the path already holds it) with a fight-clustered SE and its leave-one-year-out CV deviance change. The style
coefficients themselves were fit on 2019-2023 by tools/styles.py, so the fixed-offset change is in-sample for them;
the slope's LOYO change is out-of-fold for the slope only.
"""
import json
import math
import os
import sys
from collections import defaultdict

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import styles as ST  # noqa: E402
from sos_wf import irls, dev_terms, sandwich_se  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def dev_path(name):
    p = os.path.join(ROOT, "data", "derived", name)
    return p if os.path.exists(p) else os.path.join("/home/user/XX/data/derived", name)


SETS = {
    "ab1": {"dist_att": [("length_d", 0.052357), ("open", -0.067632)],
            "td_att": [("length_d", -0.096627), ("zy_vol", 0.16794), ("zy_td_def", -0.074101)],
            "ctrl_per_td": [("zy_td_def", -0.1069)],
            "gnp_att": [("zy_sub_int", 0.10378), ("zy_kd_pow", 0.074442)]},
    "fit": {"dist_att": [("length_d", 0.063904), ("open", -0.073081), ("zy_kd_pow", -0.023806)],
            "td_att": [("zy_td_int", -0.076253), ("length_d", -0.13401), ("zy_vol", 0.076694), ("zy_td_def", -0.093306)],
            "ctrl_per_td": [("zy_td_def", -0.069025), ("zy_sub_int", 0.026359)],
            "gnp_att": [("zy_sub_int", 0.10412), ("zy_kd_pow", 0.085885)]},
}
OPEN_MEAN = 0.274637
OUTCOME = {"dist_att": ("d_att", "d_att"), "td_att": ("td_att", "td_att"), "gnp_att": ("g_att", "g_att"),
           "ctrl_per_td": ("ctrl", "ctrl")}


def main():
    pa_path, rows_path, off_path = sys.argv[1:4]
    out_path = sys.argv[4] if len(sys.argv) > 4 else None
    PA = json.load(open(pa_path))
    bt = json.load(open(dev_path("backtest_dev.json")))
    sj = json.load(open(dev_path("styles.json")))
    mu, sd = sj["zscore"]["mu"], sj["zscore"]["sd"]
    ex = ST.Side(bt["meta"]["keys"])
    feats = {}
    for f in bt["fights"]:
        if not ("2019-01-01" <= f["date"] < "2024-01-01"):
            continue
        div = f.get("prior_division") or f["division"]
        P = PA[f["date"][:4]].get(div) or PA[f["date"][:4]]["ALL"]
        if P.get("fallback") and P["fallback"] in PA[f["date"][:4]]:
            P = PA[f["date"][:4]][P["fallback"]]
        feats[f["id"]] = (ex.features(f["A"]["S"], P, f["A"]), ex.features(f["B"]["S"], P, f["B"]))
    rows = json.load(open(rows_path))
    offs = json.load(open(off_path))
    res = {}
    for set_name, blocks in SETS.items():
        for blk, terms in blocks.items():
            ycol, ocol = OUTCOME[blk]
            for path in ("ml", "base"):
                Y, OFF, S, CL, YR = [], [], [], [], []
                for r in rows:
                    o = offs.get(r["id"], {}).get(path, {}).get(r["side"])
                    if not o or r["min"] <= 0 or r["id"] not in feats:
                        continue
                    fA, fB = feats[r["id"]]
                    fx, fy = (fA, fB) if r["side"] == "A" else (fB, fA)
                    s = 0.0
                    for t, c in terms:
                        v = ST.term_value(t, fx, fy, mu, sd)
                        if t == "open":
                            v -= OPEN_MEAN
                        s += c * v
                    Y.append(r[ycol]); OFF.append(math.log(max(o[ocol], 1e-6) * r["min"])); S.append(s)
                    CL.append(r["id"]); YR.append(r["year"])
                Y, OFF, S, YR = map(np.array, (Y, OFF, S, YR))
                one = np.ones(len(Y))
                X0 = one[:, None]
                b0 = irls(X0, Y, OFF, "poisson")
                b0s = irls(X0, Y, OFF + S, "poisson")
                d_fixed = float(dev_terms(X0, Y, OFF + S, "poisson", b0s).sum() - dev_terms(X0, Y, OFF, "poisson", b0).sum())
                X1 = np.column_stack([one, S])
                b1 = irls(X1, Y, OFF, "poisson")
                se = sandwich_se(X1, Y, OFF, "poisson", b1, CL)
                dterm = np.zeros(len(Y))
                for yv in sorted(set(YR.tolist())):
                    tr, te = YR != yv, YR == yv
                    c0 = irls(X0[tr], Y[tr], OFF[tr], "poisson")
                    c1 = irls(X1[tr], Y[tr], OFF[tr], "poisson")
                    dterm[te] = dev_terms(X1[te], Y[te], OFF[te], "poisson", c1) - dev_terms(X0[te], Y[te], OFF[te], "poisson", c0)
                ids = np.array(CL)
                uniq, inv = np.unique(ids, return_inverse=True)
                per = np.bincount(inv, weights=dterm, minlength=len(uniq))
                rng = np.random.default_rng(7)
                boots = [per[rng.integers(0, len(uniq), len(uniq))].sum() for _ in range(1000)]
                null_dev = float(dev_terms(X0, Y, OFF, "poisson", b0).sum())
                key = "%s/%s/%s" % (set_name, blk, path)
                res[key] = {"n": int(len(Y)), "dev_fixed_change": d_fixed, "dev_fixed_rel": d_fixed / null_dev,
                            "slope": float(b1[1]), "slope_se": float(se[1]), "loyo_cv_change": float(dterm.sum()),
                            "loyo_ci": [float(np.percentile(boots, 2.5)), float(np.percentile(boots, 97.5))],
                            "sd_s": float(S.std())}
                print("%-5s %-12s %-4s n=%5d  fixed s: dev %+9.1f (%+.3f%%)  slope %.2f (se %.2f)  LOYO slope CV %+8.1f [%+.1f, %+.1f]  sd(s) %.3f"
                      % (set_name, blk, path, len(Y), d_fixed, 100 * d_fixed / null_dev, b1[1], se[1], dterm.sum(),
                         res[key]["loyo_ci"][0], res[key]["loyo_ci"][1], S.std()))
    if out_path:
        json.dump(res, open(out_path, "w"), indent=1)


if __name__ == "__main__":
    main()
