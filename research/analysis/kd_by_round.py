import os
import sys
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from load import load, round_pairs
res, st, dob = load()
rp = round_pairs(res, st).join(res.set_index("fid")[["date", "rnd", "sched", "tsec", "mgroup"]], on="fid")
rp = rp[rp.date >= "2010-01-01"]
for R, reach in ((3, 3), (5, 3), (5, 5)):
    d = rp[(rp.sched == R) & (rp.rnd >= reach) & (rp.r <= reach)]
    g = d.groupby("r")
    t = pd.DataFrame({"kd_per_100_head": 100 * (g.A_kd.sum() + g.B_kd.sum()) / (g.A_head_l.sum() + g.B_head_l.sum()),
                      "head_landed_per_round": (g.A_head_l.sum() + g.B_head_l.sum()) / g.size(),
                      "acc": (g.A_sig_l.sum() + g.B_sig_l.sum()) / (g.A_sig_a.sum() + g.B_sig_a.sum()),
                      "n": g.size()})
    print(f"{R}-round fights that reached round {reach} (any result), 2010+:\n", t.round(3).to_string(), "\n")
# within-fighter output change after being out-landed in a round (3-round fights reaching R2), vs a matched control
d = rp[(rp.sched == 3) & (rp.rnd >= 2)]
r1 = d[d.r == 1].set_index("fid"); r2 = d[d.r == 2].set_index("fid")
j = r1.join(r2, lsuffix="1", rsuffix="2", how="inner")
j = j[(j.A_sig_a1 + j.B_sig_a1 > 10) & (j.A_sig_a2 + j.B_sig_a2 > 10)]
share1 = j.A_sig_a1 / (j.A_sig_a1 + j.B_sig_a1)
share2 = j.A_sig_a2 / (j.A_sig_a2 + j.B_sig_a2)
behind = (j.A_sig_l1 < j.B_sig_l1)
# regress share2 on share1 and behind-on-landed (adaptation beyond regression to the mean)
X = np.column_stack([np.ones(len(j)), share1 - 0.5, behind.astype(float) - (j.B_sig_l1 < j.A_sig_l1).astype(float)])
b = np.linalg.lstsq(X, share2 - 0.5, rcond=None)[0]
print("Attempt share R2 ~ share R1 + (behind on landed in R1):", np.round(b, 4), "n", len(j))
