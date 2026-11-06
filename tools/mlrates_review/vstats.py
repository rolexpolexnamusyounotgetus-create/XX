"""Reviewer: independent per-stat validation of mlrates on backtest_dev.json actuals (fresh code; does not use the
analyst's dataset pickle or deviance functions). 2024-2025: dev model via the JS evaluator (with the true layoff, and
with layoff missing as backtest_dev provides it), 2019-2023: out-of-fold table. Engine v3 static expectation as the
baseline. Fight-cluster bootstrap CIs."""
import json, math, sys
import numpy as np

ROOT = "/home/user/XX"
import os
V = os.environ.get("MLRATES_REVIEW_DIR", "/home/user/XX/out/mlrates_review")
bt = {f["id"]: f for f in json.load(open(ROOT + "/data/derived/backtest_dev.json"))["fights"]}
pred = json.load(open(V + "/vpred.json"))
oof = json.load(open(ROOT + "/data/derived/mlrates_oof.json"))
TN = oof["meta"]["targets"]


def pdev(y, mu):
    mu = np.maximum(mu, 1e-12)
    return 2 * (np.where(y > 0, y * np.log(np.maximum(y, 1e-12) / mu), 0) - (y - mu))


def bdev(y, n, p):
    p = np.clip(p, 1e-9, 1 - 1e-9)
    a = np.where(y > 0, y * np.log(np.maximum(y, 1e-12) / np.maximum(n * p, 1e-12)), 0)
    b = np.where(n - y > 0, (n - y) * np.log(np.maximum(n - y, 1e-12) / np.maximum(n * (1 - p), 1e-12)), 0)
    return 2 * (a + b)


def boot(d, g, reps=2000, seed=3):
    rng = np.random.default_rng(seed)
    u, inv = np.unique(g, return_inverse=True)
    s = np.bincount(inv, weights=d); c = np.bincount(inv)
    st = [s[k].sum() / c[k].sum() for k in (rng.integers(0, len(u), len(u)) for _ in range(reps))]
    return d.mean(), np.percentile(st, 2.5), np.percentile(st, 97.5)


def derived(r):
    """per-minute expectations / probabilities for the observable stat lines from a rates dict"""
    att = r["d_att"] + r["c_att"] + r["g_att"]
    return {"sig_att": ("p", att), "sig_acc": ("b", (r["d_att"] * r["acc_d"] + r["c_att"] * r["acc_c"] + r["g_att"] * r["acc_g"]) / att),
            "h_lnd": ("p", r["h_att"] * r["acc_h"]), "b_lnd": ("p", r["b_att"] * r["acc_b"]), "l_lnd": ("p", r["l_att"] * r["acc_l"]),
            "td_att": ("p", r["td_att"]), "td_acc": ("b", r["td_acc"]), "ctrl": ("p", r["ctrl"]), "sub_att": ("p", r["sub_att"]),
            "kd_h": ("b", r["kd_h"])}


def obs(a, mins):
    return {"sig_att": (a["sig_att"], mins), "sig_acc": (a["sig_lnd"], a["sig_att"]), "h_lnd": (a["h_lnd"], mins),
            "b_lnd": (a["b_lnd"], mins), "l_lnd": (a["l_lnd"], mins), "td_att": (a["td_att"], mins),
            "td_acc": (a["td_lnd"], a["td_att"]), "ctrl": (a["ctrl"], mins), "sub_att": (a["sub_att"], mins),
            "kd_h": (a["kd"], a["h_lnd"])}


def run(period, rows, srcs):
    stats = list(derived({k: 1.0 for k in TN}).keys())
    res = {}
    for st in stats:
        Y, E, G, P = [], [], [], {s: [] for s in srcs}
        kind = None
        for r in rows:
            f = bt[r["id"]]
            mins = f["actual"]["minutes"]
            if not mins or mins <= 0:
                continue
            for si, tag in ((0, "A"), (1, "B")):
                y, e = obs(f["actual"][tag], mins)[st]
                if e is None or e <= 0 or y is None:
                    continue
                vals = {}
                for s in srcs:
                    rr = r[s][si]
                    if rr is None:
                        break
                    kind, v = derived(rr)[st]
                    vals[s] = v
                if len(vals) < len(srcs):
                    continue
                Y.append(y); E.append(e); G.append(r["id"])
                for s in srcs:
                    P[s].append(vals[s])
        Y, E, G = np.array(Y, float), np.array(E, float), np.array(G)
        dv = {}
        for s in srcs:
            p = np.array(P[s])
            dv[s] = pdev(Y, E * p) if kind == "p" else bdev(Y, E, p)
        row = {"n": len(Y)}
        for s in srcs:
            row[s] = float(dv[s].mean())
        for s in srcs:
            if s != "eng":
                m, lo, hi = boot(dv[s] - dv["eng"], G)
                row[s + "-eng"] = [float(m), float(lo), float(hi)]
        res[st] = row
    print("\n== %s (backtest_dev actuals, mean deviance per fight-side) ==" % period)
    for st, row in res.items():
        txt = "  %-8s n=%4d " % (st, row["n"]) + " ".join("%s %.4f" % (s, row[s]) for s in srcs)
        for s in srcs:
            if s != "eng":
                m, lo, hi = row[s + "-eng"]
                txt += " | %s-eng %+.4f [%+.4f, %+.4f]%s" % (s, m, lo, hi, "*" if hi < 0 or lo > 0 else "")
        print(txt)
    return res


out = {}
# 2024-2025 validation: dev model with true layoff ("lay"), with layoff missing ("noLay"), OOF table dev rates ("oofdev")
val, tr = [], []
for p in pred:
    y = int(p["date"][:4])
    e = oof["fights"].get(p["id"])
    oo = [dict(zip(TN, e["A"])), dict(zip(TN, e["B"]))] if (e and "A" in e and "B" in e) else [None, None]
    p["oof"] = oo
    (val if y >= 2024 else tr).append(p)
# consistency: JS(dev, true layoff, backtest_dev S) vs analyst's stored dev rates (pickle S)
mx = 0.0
for p in val:
    for si in (0, 1):
        if p["oof"][si] is None:
            continue
        for k in TN:
            mx = max(mx, abs(math.log(p["lay"][si][k] / p["oof"][si][k])))
print("max |log(JS dev rate on backtest_dev side / analyst's stored dev rate)| over 2024-25:", "%.2e" % mx)
out["val"] = run("2024-2025, dev model (trained 2010-2023)", val, ["eng", "lay", "noLay", "oof"])
out["train"] = run("2019-2023, out-of-fold rates", tr, ["eng", "oof"])
json.dump(out, open(V + "/vstats.json", "w"), indent=1)
