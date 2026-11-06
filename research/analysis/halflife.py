"""Which time-decay half-life makes pre-fight rate estimates most predictive? Also the shrinkage strength.
Simple symmetric logistic on rate differences; train 2012-2019, test 2020-2026 (both fighters >=2 prior UFC fights)."""
import os
import sys
import numpy as np
import pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from load import load, round_pairs

res, st, dob = load()
rp = round_pairs(res, st)
tot = rp.groupby("fid").sum(numeric_only=True)
res = res[res.date.notna() & res.dur.notna()].copy()
rows = []
for side, opp in (("A", "B"), ("B", "A")):
    d = res[["fid", "date", "dur", side, opp, "res" + side]].copy()
    d.columns = ["fid", "date", "dur", "f", "o", "result"]
    t = tot.reindex(d.fid)
    for k in ["sig_l", "kd", "td_l", "td_a", "sub", "head_l", "ctrl"]:
        d["x_" + k] = t["%s_%s" % (side, k)].values
        d["o_" + k] = t["%s_%s" % (opp, k)].values
    rows.append(d)
L = pd.concat(rows)
L = L[L.x_sig_l.notna()].sort_values(["f", "date"]).reset_index(drop=True)
L["min"] = L.dur / 60
L["age"] = (L.date - L.f.map(dob)).dt.days / 365.25
cols = ["min", "x_sig_l", "o_sig_l", "x_td_l", "o_td_l", "x_td_a", "o_td_a", "x_kd", "o_kd", "x_sub", "x_ctrl", "o_ctrl"]
league = {c: L[c].sum() / L["min"].sum() for c in cols if c != "min"}
X = L[cols].to_numpy(float)
yrs = (L.date - pd.Timestamp("1990-01-01")).dt.days.to_numpy() / 365.25
starts = np.r_[0, np.flatnonzero(L.f.values[1:] != L.f.values[:-1]) + 1, len(L)]


def decayed(h):
    out = np.zeros_like(X)
    nprev = np.zeros(len(L))
    for a, b in zip(starts[:-1], starts[1:]):
        yy, xx = yrs[a:b], X[a:b]
        dt = yy[:, None] - yy[None, :]
        w = np.tri(b - a, b - a, -1) * (0.5 ** (dt / h) if h else 1.0)
        out[a:b] = w @ xx
        nprev[a:b] = np.arange(b - a)
    return out, nprev


def feats(S, k):
    m = S[:, 0] + k
    r = {c: (S[:, i] + k * league[c]) / m for i, c in enumerate(cols) if c != "min"}
    return np.column_stack([r["x_sig_l"], r["o_sig_l"], r["x_td_l"], r["o_td_l"], r["x_kd"], r["o_kd"], r["x_sub"], r["x_ctrl"], r["o_ctrl"]])


def logit_fit(X, y, l2=1e-3):
    b = np.zeros(X.shape[1])
    for _ in range(60):
        p = 1 / (1 + np.exp(-(X @ b)))
        H = X.T @ (X * (p * (1 - p))[:, None]) + l2 * np.eye(X.shape[1])
        step = np.linalg.solve(H, X.T @ (y - p) - l2 * b)
        b += step
        if np.abs(step).max() < 1e-9:
            break
    return b


def evaluate(h, k, with_age=False):
    S, nprev = decayed(h)
    F = feats(S, k)
    df = pd.DataFrame(F, index=L.index)
    df["fid"], df["f"], df["date"], df["res"], df["n"], df["age"] = L.fid, L.f, L.date, L.result, nprev, L.age
    a = df.groupby("fid").nth(0).set_index("fid")
    b_ = df.groupby("fid").nth(1).set_index("fid")
    j = a.join(b_, lsuffix="_a", rsuffix="_b", how="inner")
    j = j[j.res_a.isin(["W", "L"]) & (j.n_a >= 2) & (j.n_b >= 2) & (j.date_a >= "2012-01-01")]
    if with_age:
        j = j[j.age_a.notna() & j.age_b.notna()]
    fa = j[[f"{i}_a" for i in range(F.shape[1])]].to_numpy() - j[[f"{i}_b" for i in range(F.shape[1])]].to_numpy()
    sd = fa.std(0) + 1e-9
    fa = fa / sd
    if with_age:
        fa = np.column_stack([fa, (j.age_a - j.age_b).to_numpy() / 5])
    y = (j.res_a == "W").to_numpy(float)
    tr = (j.date_a < "2020-01-01").to_numpy()
    Xs = np.vstack([fa[tr], -fa[tr]]); ys = np.r_[y[tr], 1 - y[tr]]
    bb = logit_fit(Xs, ys)
    p = 1 / (1 + np.exp(-(fa[~tr] @ bb)))
    p = p.clip(1e-6, 1 - 1e-6)
    ll = -(y[~tr] * np.log(p) + (1 - y[~tr]) * np.log(1 - p)).mean()
    acc = ((p > 0.5) == (y[~tr] == 1)).mean()
    return ll, acc, (~tr).sum()


print("half-life sweep (k = 30 pseudo-minutes):")
for h in [0.5, 1, 1.5, 2, 3, 4, 6, None]:
    ll, acc, n = evaluate(h, 30)
    print(f"  h={h}: test logloss {ll:.4f} acc {acc:.4f} n {n}")
print("shrinkage sweep (h = 2y):")
for k in [0, 10, 30, 60, 120, 240]:
    ll, acc, n = evaluate(2, k)
    print(f"  k={k} min: test logloss {ll:.4f} acc {acc:.4f}")
for h in [1, 2, 3, None]:
    ll, acc, n = evaluate(h, 60, with_age=True)
    print(f"with age diff, h={h}, k=60: test logloss {ll:.4f} acc {acc:.4f} n {n}")
