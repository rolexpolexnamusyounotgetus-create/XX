"""Round-level judging model fitted from judges' fight totals plus round stats.

Each judge's totals (loser-first in ufcstats) imply how many rounds that judge gave the fight winner
(a feasible set when 10-8s make it ambiguous). Rounds are independent Bernoulli with
logit p_r = beta . (winner - loser stats in round r), no intercept. The likelihood of a judge's
card is P(K in feasible set), computed by enumerating all 2^R round patterns.
"""
import itertools
import os
import sys
import numpy as np
import pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from load import load, round_pairs, judges

res, st, dob = load()
rp = round_pairs(res, st)
dec = res[res.mgroup.eq("DEC") & res.sched.isin([3, 5]) & res.resA.isin(["W", "L"]) & res.date.ge("2001-01-01")].copy()


def feasible(W, L, R):
    """Rounds won by the fight winner on this card (no 10-10, 10-8 allowed, 10-7 ignored)."""
    if W + L > 19 * R or W + L < 18 * R:
        return None
    lo = max(W - 9 * R, int(np.ceil((10 * R - L) / 2)), 0)
    hi = min((W - 8 * R) // 2, 10 * R - L, R)
    ks = [k for k in range(lo, hi + 1)]
    return ks or None


FEATS_T = ["head_l", "body_l", "leg_l", "kd", "td_l", "ctrl_min", "sub", "rev", "sig_miss"]
FEATS_P = ["dist_l", "clinch_l", "ground_l", "kd", "td_l", "ctrl_min", "sub", "rev", "sig_miss"]

rp = rp.copy()
for s in "AB":
    rp[s + "_ctrl_min"] = rp[s + "_ctrl"] / 60
    rp[s + "_sig_miss"] = rp[s + "_sig_a"] - rp[s + "_sig_l"]
rp = rp.set_index(["fid", "r"]).sort_index()

rows = []   # per judge card: fid, R, feasible-mask over k, n_108, year
Xs = {3: [], 5: []}
masks = {3: [], 5: []}
meta = {3: [], 5: []}
for f in dec.itertuples():
    R = int(f.sched)
    try:
        sub = rp.loc[f.fid]
    except KeyError:
        continue
    if len(sub) != R or sub.index.min() != 1 or sub.index.max() != R:
        continue
    cards = judges(f.DETAILS)
    if len(cards) != 3:
        continue
    win = "A" if f.resA == "W" else "B"
    los = "B" if win == "A" else "A"
    allf = sorted(set(FEATS_T + FEATS_P))
    X = np.column_stack([sub[win + "_" + c].values - sub[los + "_" + c].values for c in allf]).astype(float)
    if np.isnan(X).any():
        continue
    for (L, W) in cards:
        ks = feasible(W, L, R)
        if ks is None:
            continue
        m = np.zeros(R + 1, bool)
        m[ks] = True
        Xs[R].append(X)
        masks[R].append(m)
        meta[R].append((f.fid, f.date.year, 19 * R - W - L, len(ks) > 1, f.METHOD))
ALLF = sorted(set(FEATS_T + FEATS_P))
print("cards:", {R: len(masks[R]) for R in (3, 5)})

PAT = {R: np.array(list(itertools.product([0, 1], repeat=R)), float) for R in (3, 5)}


def loglik_grad(beta, feats, sel, R):
    idx = [ALLF.index(c) for c in feats]
    X = np.stack([Xs[R][i][:, idx] for i in sel])          # n x R x p
    M = np.stack([masks[R][i] for i in sel])                # n x (R+1)
    z = X @ beta                                            # n x R
    p = 1 / (1 + np.exp(-z))
    P = PAT[R]                                              # 2^R x R
    lp = P[None] * np.log(p[:, None, :] + 1e-300) + (1 - P[None]) * np.log(1 - p[:, None, :] + 1e-300)
    w = np.exp(lp.sum(-1))                                  # n x 2^R  pattern probs
    k = P.sum(1).astype(int)                                # 2^R
    ok = M[:, k]                                            # n x 2^R
    num = (w * ok).sum(1)
    ll = np.log(num + 1e-300)
    post = w * ok / (num[:, None] + 1e-300)                 # posterior over patterns
    Ew = post @ P                                           # n x R  E[win_r | card]
    g_i = ((Ew - p)[:, :, None] * X).sum(1)                 # n x p
    return ll, g_i


def fit(feats, sel3, sel5, iters=60):
    beta = np.zeros(len(feats))
    for it in range(iters):
        ll3, g3 = loglik_grad(beta, feats, sel3, 3) if len(sel3) else (np.zeros(0), np.zeros((0, len(feats))))
        ll5, g5 = loglik_grad(beta, feats, sel5, 5) if len(sel5) else (np.zeros(0), np.zeros((0, len(feats))))
        G = np.vstack([g3, g5])
        g = G.sum(0)
        H = G.T @ G + 1e-6 * np.eye(len(feats))              # BHHH
        step = np.linalg.solve(H, g)
        beta = beta + step
        if np.abs(step).max() < 1e-7:
            break
    se = np.sqrt(np.diag(np.linalg.inv(H)))
    return beta, se, ll3.sum() + ll5.sum(), len(sel3) + len(sel5)


def era_sel(R, y0, y1):
    return [i for i, m in enumerate(meta[R]) if y0 <= m[1] <= y1]


def show(name, feats, y0, y1):
    s3, s5 = era_sel(3, y0, y1), era_sel(5, y0, y1)
    b, se, ll, n = fit(feats, s3, s5)
    out = pd.DataFrame({"beta": b, "se": se}, index=feats)
    base = b[feats.index("head_l")] if "head_l" in feats else b[feats.index("dist_l")]
    out["in_head_strike_units"] = out.beta / base
    print(f"\n== {name} {y0}-{y1}: cards {n}, loglik {ll:.1f}")
    print(out.round(4).to_string())
    return b


b_all = show("target model", FEATS_T, 2010, 2026)
show("target model", FEATS_T, 2010, 2016)
show("target model", FEATS_T, 2017, 2024)
show("target model", FEATS_T, 2025, 2026)
show("position model", FEATS_P, 2010, 2026)

# Predictive check: share of cards where the most likely round count matches
# 10-8 frequency by year (per judge-round) from totals
m3 = pd.DataFrame(meta[3], columns=["fid", "year", "n108", "amb", "method"]).assign(R=3)
m5 = pd.DataFrame(meta[5], columns=["fid", "year", "n108", "amb", "method"]).assign(R=5)
mm = pd.concat([m3, m5])
yr = mm.groupby("year").apply(lambda d: pd.Series({"cards": len(d), "rate_108_per_judge_round": d.n108.sum() / d.R.sum(),
                                                   "cards_with_108": (d.n108 > 0).mean()}))
print("\n10-8 frequency by year (from judges' totals, decisions only):\n", yr.round(4).to_string())

# split decision share by year
d2 = res[res.mgroup.eq("DEC") & res.date.ge("2010-01-01")]
sp = d2.groupby(d2.date.dt.year).METHOD.apply(lambda s: pd.Series({"split": s.str.contains("Split").mean(),
                                                                    "majority": s.str.contains("Majority").mean(), "n": len(s)})).unstack()
print("\nSplit / majority share of decisions by year:\n", sp.round(3).to_string())

# judge disagreement on round counts (cards within a fight)
dis = mm.groupby("fid").size()
print("\ncards per fight distribution:", dis.value_counts().to_dict())

np.save(os.path.join(os.path.dirname(os.path.abspath(__file__)), "judge_beta.npy"), b_all)
