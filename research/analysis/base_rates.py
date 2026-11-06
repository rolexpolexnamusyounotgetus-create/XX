"""Knockdown, finish, pace base rates from the snapshot."""
import os
import sys
import numpy as np
import pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from load import load, round_pairs

res, st, dob = load()
rp = round_pairs(res, st)
f = res.set_index("fid")
rp = rp.join(f[["date", "div", "mgroup", "rnd", "tsec", "resA", "resB", "sched", "dur", "lbs"]], on="fid")
rp = rp[rp.date >= "2015-01-01"]
print("rounds 2015+:", len(rp), "fights:", rp.fid.nunique())

# ---- KD per landed significant head strike, by division
g = rp.groupby("div")
kd = (g.A_kd.sum() + g.B_kd.sum())
hl = (g.A_head_l.sum() + g.B_head_l.sum())
sl = (g.A_sig_l.sum() + g.B_sig_l.sum())
tbl = pd.DataFrame({"kd": kd, "head_landed": hl, "kd_per_100_head": 100 * kd / hl, "kd_per_100_sig": 100 * kd / sl})
tot = pd.Series({"kd": kd.sum(), "head_landed": hl.sum(), "kd_per_100_head": 100 * kd.sum() / hl.sum(),
                 "kd_per_100_sig": 100 * kd.sum() / sl.sum()}, name="ALL")
print("\nKD per landed head strike (2015+):\n", pd.concat([tbl, tot.to_frame().T]).round(3).to_string())

# ---- Finish shares by division (2015+, fights with a division)
fr = res[(res.date >= "2015-01-01") & res["div"].notna() & res.mgroup.isin(["DEC", "KO", "SUB"])]
ms = pd.crosstab(fr["div"], fr.mgroup, normalize="index").round(3)
ms["n"] = fr.groupby("div").size()
print("\nMethod shares 2015+:\n", ms.to_string())

# ---- KD -> finish conversion: rounds where exactly one side scored >=1 KD
last = rp.merge(res[["fid", "rnd"]].rename(columns={"rnd": "last_rnd"}), on="fid")
fin_round = last[last.r == last.last_rnd]
x = last.copy()
x["kdA_only"] = (x.A_kd > 0) & (x.B_kd == 0)
x["kdB_only"] = (x.B_kd > 0) & (x.A_kd == 0)
x["is_last"] = x.r == x.last_rnd
a = x[x.kdA_only]
b = x[x.kdB_only]
convA = (a.is_last & (a.resA == "W") & (a.mgroup == "KO")).mean()
convB = (b.is_last & (b.resB == "W") & (b.mgroup == "KO")).mean()
n_kd_rounds = len(a) + len(b)
conv = ((a.is_last & (a.resA == "W") & (a.mgroup == "KO")).sum() + (b.is_last & (b.resB == "W") & (b.mgroup == "KO")).sum()) / n_kd_rounds
print(f"\nRounds with KD by one side only: {n_kd_rounds}; KO/TKO finish by the KD scorer in that same round: {conv:.3f}")
# any-win conversion in fight
fa = a.drop_duplicates("fid"); fb = b.drop_duplicates("fid")
print("Fight won by a fighter who scored a KD (one-sided KD rounds):",
      round(((fa.resA == "W").sum() + (fb.resB == "W").sum()) / (len(fa) + len(fb)), 3))
# share of KO/TKO wins where finisher had a KD in final round
ko = fin_round[fin_round.mgroup == "KO"]
wA = ko.resA == "W"
had = np.where(wA, ko.A_kd > 0, ko.B_kd > 0)
print("Share of KO/TKO finishes where the winner scored >=1 KD in the finishing round:", round(had.mean(), 3), "n", len(ko))

# ---- Pace by round: fights that went the distance
for R in (3, 5):
    dd = rp[(rp.sched == R) & (rp.mgroup == "DEC")]
    p = dd.groupby("r").apply(lambda d: pd.Series({
        "sig_l_per_min_both": (d.A_sig_l.sum() + d.B_sig_l.sum()) / (5 * len(d)),
        "sig_a_per_min_both": (d.A_sig_a.sum() + d.B_sig_a.sum()) / (5 * len(d)),
        "acc": (d.A_sig_l.sum() + d.B_sig_l.sum()) / (d.A_sig_a.sum() + d.B_sig_a.sum()),
        "td_att_per_round_both": (d.A_td_a.sum() + d.B_td_a.sum()) / len(d),
        "ctrl_sec_per_round_both": (d.A_ctrl.sum() + d.B_ctrl.sum()) / len(d),
        "kd_per_100_head": 100 * (d.A_kd.sum() + d.B_kd.sum()) / (d.A_head_l.sum() + d.B_head_l.sum()),
        "n": len(d)}))
    p["landed_vs_r1"] = p.sig_l_per_min_both / p.sig_l_per_min_both.iloc[0]
    print(f"\nPace by round, {R}-round decisions (2015+):\n", p.round(3).to_string())

# Pace for ALL scheduled 5-round fights, per minute actually fought in each round
d5 = rp[rp.sched == 5].copy()
d5["mins"] = np.where(d5.r == d5.rnd, d5.tsec / 60, 5.0)
p = d5.groupby("r").apply(lambda d: pd.Series({
    "sig_l_per_min_both": (d.A_sig_l.sum() + d.B_sig_l.sum()) / d.mins.sum(),
    "kd_per_100_head": 100 * (d.A_kd.sum() + d.B_kd.sum()) / (d.A_head_l.sum() + d.B_head_l.sum()), "n": len(d)}))
print("\nAll scheduled 5-rounders, landed per minute fought:\n", p.round(3).to_string())

# ---- Finish hazard by round (conditional on starting the round)
for R in (3, 5):
    ff = res[(res.sched == R) & (res.date >= "2015-01-01") & res.mgroup.isin(["DEC", "KO", "SUB"])]
    rows = []
    for r in range(1, R + 1):
        started = (ff.rnd >= r).sum()
        ko = ((ff.rnd == r) & (ff.mgroup == "KO")).sum()
        sub = ((ff.rnd == r) & (ff.mgroup == "SUB")).sum()
        rows.append((r, started, ko / started, sub / started))
    print(f"\nFinish hazard by round, {R}-round fights 2015+ (KO, SUB per round started):")
    print(pd.DataFrame(rows, columns=["round", "started", "ko_hazard", "sub_hazard"]).round(4).to_string(index=False))
    print("decision share:", round((ff.mgroup == "DEC").mean(), 3), "n", len(ff))
