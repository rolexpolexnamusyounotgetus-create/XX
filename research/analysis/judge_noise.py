"""How correlated are judges beyond the box score? Compare observed agreement of round counts
across the three cards with the model's prediction under independent judges, then fit a shared
round-level noise sd that reproduces the observed agreement."""
import os
import sys, itertools
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "judging.py")).read().split("b_all = show")[0])
b = np.load(os.path.join(os.path.dirname(os.path.abspath(__file__)), "judge_beta.npy"))
idx = [ALLF.index(c) for c in FEATS_T]
# group 3-round cards by fight, keep fights with 3 unambiguous cards, 2010+
m3 = pd.DataFrame(meta[3], columns=["fid", "year", "n108", "amb", "method"])
m3["k"] = [int(np.argmax(m)) if m.sum() == 1 else -1 for m in masks[3]]
m3["i"] = np.arange(len(m3))
g = m3[(m3.year >= 2010)].groupby("fid")
fights = [(fid, d.i.values, d.k.values) for fid, d in g if len(d) == 3 and (d.k >= 0).all()]
print("fights with 3 unambiguous 3-round cards:", len(fights))
obs_unan = np.mean([len(set(k)) == 1 for _, _, k in fights])
X = np.stack([Xs[3][i[0]][:, idx] for _, i, _ in fights])   # n x 3 x p
rng = np.random.default_rng(1)
def sim_unan(sig_u, scale, nsim=200):
    z = X @ (b * scale)                                  # n x 3
    u = rng.normal(0, sig_u, (nsim,) + z.shape)          # shared per round
    p = 1 / (1 + np.exp(-(z[None] + u)))
    J = rng.random((3,) + p.shape) < p[None]             # judges x nsim x n x 3
    K = J.sum(-1)                                         # judges x nsim x n
    unan = (K[0] == K[1]) & (K[1] == K[2])
    # also marginal winner-round share to check calibration
    return unan.mean(), J.mean()
obs_share = np.mean([k.mean() / 3 for _, _, k in fights])
print("observed: all three cards same round count:", round(obs_unan, 3), " mean share of rounds to winner:", round(obs_share, 3))
for sig_u in [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0]:
    scale = np.sqrt(1 + 0.346 * sig_u ** 2)
    un, sh = sim_unan(sig_u, scale)
    print(f"sigma_u {sig_u:.1f} (beta x {scale:.2f}): sim unanimity {un:.3f}, sim share {sh:.3f}")
