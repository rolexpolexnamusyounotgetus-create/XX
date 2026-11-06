"""League (division) priors from 2019+ round stats: attempts, accuracy by target/position, grappling."""
import os
import sys
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from load import load, round_pairs
res, st, dob = load()
rp = round_pairs(res, st).join(res.set_index("fid")[["date", "div", "rnd", "tsec"]], on="fid")
rp = rp[(rp.date >= "2019-01-01") & rp["div"].notna()]
rp["mins"] = np.where(rp.r == rp.rnd, rp.tsec / 60, 5.0)
def summ(d):
    s = lambda k: d["A_" + k].sum() + d["B_" + k].sum()
    fm = 2 * d.mins.sum()   # fighter-minutes
    o = {"sig_att_pm": s("sig_a") / fm, "sig_land_pm": s("sig_l") / fm, "acc_sig": s("sig_l") / s("sig_a"),
         "acc_head": s("head_l") / s("head_a"), "acc_body": s("body_l") / s("body_a"), "acc_leg": s("leg_l") / s("leg_a"),
         "acc_dist": s("dist_l") / s("dist_a"), "acc_clinch": s("clinch_l") / s("clinch_a"), "acc_ground": s("ground_l") / s("ground_a"),
         "share_att_head": s("head_a") / s("sig_a"), "share_att_body": s("body_a") / s("sig_a"), "share_att_leg": s("leg_a") / s("sig_a"),
         "share_att_dist": s("dist_a") / s("sig_a"), "share_att_clinch": s("clinch_a") / s("sig_a"), "share_att_ground": s("ground_a") / s("sig_a"),
         "td_att_per15": 15 * s("td_a") / fm, "td_acc": s("td_l") / s("td_a"), "ctrl_share": s("ctrl") / 60 / (d.mins.sum()),
         "ctrl_sec_per_td": s("ctrl") / max(s("td_l"), 1), "sub_att_per15": 15 * s("sub") / fm, "rev_per15": 15 * s("rev") / fm,
         "kd_per100_head": 100 * s("kd") / s("head_l"), "fighter_minutes": fm}
    return pd.Series(o)
t = rp.groupby("div").apply(summ)
t.loc["ALL"] = summ(rp)
pd.set_option("display.width", 250)
print(t.T.round(3).to_string())
