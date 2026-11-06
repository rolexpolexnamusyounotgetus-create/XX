"""Reviewer: score the independent two-orientation simulator re-run (vsim.js outputs)."""
import json, math, sys, glob
import numpy as np

import os
V = os.environ.get("MLRATES_REVIEW_DIR", "/home/user/XX/out/mlrates_review")
bt = {f["id"]: f for f in json.load(open("/home/user/XX/data/derived/backtest_dev.json"))["fights"]}
files = sys.argv[1:]
rows = []
for fp in files:
    rows += json.load(open(fp))["rows"]
N = json.load(open(files[0]))["N"]
eps = 0.5 / N


def ll(p, y):
    p = min(max(p, 1e-4), 1 - 1e-4)
    return -(y * math.log(p) + (1 - y) * math.log(1 - p))


def bucket(f):
    w, m = f["result"]["winner"], f["result"]["method"]
    if w not in ("A", "B"):
        return 3 if m == "DRAW" else None
    k = 0 if m in ("KO", "DOC") else (1 if m == "SUB" else (2 if m in ("UD", "SD", "MD") else None))
    if k is None:
        return None
    return k if w == "A" else 6 - k


def boot(d, reps=2000, seed=5):
    rng = np.random.default_rng(seed)
    n = len(d)
    st = [d[rng.integers(0, n, n)].mean() for _ in range(reps)]
    return float(d.mean()), float(np.percentile(st, 2.5)), float(np.percentile(st, 97.5))


R = {k: {"ab": [], "mir": [], "sym": [], "brier": [], "acc": [], "ll7": [], "bias": [], "accsym": []} for k in ("plain", "ml")}
elo, yrs, ids = [], [], []
for r in rows:
    f = bt[r["id"]]
    w = f["result"]["winner"]
    b = bucket(f)
    for k in ("plain", "ml"):
        ab, ba = r["AB"][k], r["BA"][k]
        pAB = ab["pA"] / max(1e-9, ab["pA"] + ab["pB"])          # P(fighter A wins), A in corner 1
        pBA = ba["pB"] / max(1e-9, ba["pA"] + ba["pB"])          # P(fighter A wins), A in corner 2
        R[k]["bias"].append(pAB - pBA)
        if b is not None:
            bAB = np.array(ab["bins"]) * (1 - 7 * eps) + eps
            bBA = np.array(ba["bins"][::-1]) * (1 - 7 * eps) + eps
            R[k]["ll7"].append(0.5 * (-math.log(bAB[b]) - math.log(bBA[b])))
        if w in ("A", "B"):
            y = 1.0 if w == "A" else 0.0
            ps = 0.5 * (pAB + pBA)
            R[k]["ab"].append(ll(pAB, y))
            R[k]["mir"].append(0.5 * (ll(pAB, y) + ll(pBA, y)))
            R[k]["sym"].append(ll(ps, y))
            R[k]["brier"].append(0.5 * ((pAB - y) ** 2 + (pBA - y) ** 2))
            R[k]["acc"].append(0.5 * ((1.0 if (pAB > 0.5) == (y > 0.5) else 0.5 if pAB == 0.5 else 0.0) +
                                      (1.0 if (pBA > 0.5) == (y > 0.5) else 0.5 if pBA == 0.5 else 0.0)))
            R[k]["accsym"].append(1.0 if (ps > 0.5) == (y > 0.5) else 0.5 if ps == 0.5 else 0.0)
    if w in ("A", "B"):
        y = 1.0 if w == "A" else 0.0
        pe = 1 / (1 + 10 ** ((f["B"]["elo"] - f["A"]["elo"]) / 400))
        elo.append(ll(pe, y)); yrs.append(f["date"][:4]); ids.append(r["id"])
out = {"n_rows": len(rows), "n_decisive": len(elo), "N": N, "elo_ll": float(np.mean(elo))}
for k in ("plain", "ml"):
    out[k] = {m: float(np.mean(v)) for m, v in R[k].items()}
    bias = np.array(R[k]["bias"])
    out[k]["corner_bias_mean"] = float(bias.mean())
    out[k]["corner_bias_se"] = float(bias.std() / math.sqrt(len(bias)))
for m in ("ab", "mir", "sym", "brier", "acc", "accsym", "ll7"):
    d = np.array(R["ml"][m]) - np.array(R["plain"][m])
    out["ml_minus_plain_" + m] = boot(d)
yrs = np.array(yrs)
dm = np.array(R["ml"]["mir"]) - np.array(R["plain"]["mir"])
out["by_year_mirrored"] = {y: {"n": int((yrs == y).sum()), "plain": float(np.mean(np.array(R["plain"]["mir"])[yrs == y])),
                               "ml": float(np.mean(np.array(R["ml"]["mir"])[yrs == y]))} for y in sorted(set(yrs))}
# 1st-named-corner sanity: share of decisive fights won by A
out["A_win_share"] = float(np.mean([1.0 if bt[i]["result"]["winner"] == "A" else 0.0 for i in ids]))
print(json.dumps(out, indent=1))
