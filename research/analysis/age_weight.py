"""Age curves, chin/power by age, weight-class moves, Elo baseline, all from the snapshot."""
import os
import sys
import numpy as np
import pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from load import load, round_pairs

res, st, dob = load()
rp = round_pairs(res, st)
res = res.sort_values(["date", "fid"], ascending=[True, False]).reset_index(drop=True)  # within event, file order is reverse
res = res[res.date.notna()]

# ---------------- per-fighter-fight long table with fight totals
tot = rp.groupby("fid").sum(numeric_only=True)
long = []
for side, opp in (("A", "B"), ("B", "A")):
    d = res[["fid", "date", "div", "lbs", "mgroup", "sched", "dur", "title", side, opp, "res" + side]].copy()
    d.columns = ["fid", "date", "div", "lbs", "mgroup", "sched", "dur", "title", "f", "o", "result"]
    t = tot.reindex(d.fid)
    for k in ["kd", "head_l", "sig_l", "sig_a", "td_l"]:
        d["x_" + k] = t["%s_%s" % (side, k)].values
        d["o_" + k] = t["%s_%s" % (opp, k)].values
    long.append(d)
L = pd.concat(long).sort_values(["date", "fid"]).reset_index(drop=True)
L["age"] = (L.date - L.f.map(dob)).dt.days / 365.25
L["oage"] = (L.date - L.o.map(dob)).dt.days / 365.25
L["men"] = L["div"].notna() & ~L["div"].fillna("").str.startswith("W ")

# ---------------- walk-forward Elo (K=48, 400 scale), result W/L only
elo, n_f = {}, {}
pre_a, pre_b = [], []
K = 48
for r in res.itertuples():
    ea, eb = elo.get(r.A, 1500.0), elo.get(r.B, 1500.0)
    pre_a.append(ea); pre_b.append(eb)
    if r.resA in ("W", "L"):
        s = 1.0 if r.resA == "W" else 0.0
        e = 1 / (1 + 10 ** ((eb - ea) / 400))
        elo[r.A] = ea + K * (s - e); elo[r.B] = eb - K * (s - e)
        n_f[r.A] = n_f.get(r.A, 0) + 1; n_f[r.B] = n_f.get(r.B, 0) + 1
res["eloA"], res["eloB"] = pre_a, pre_b
ee = res.set_index("fid")
L["elo"] = np.where(L.f.values == ee.loc[L.fid, "A"].values, ee.loc[L.fid, "eloA"].values, ee.loc[L.fid, "eloB"].values)
L["oelo"] = np.where(L.f.values == ee.loc[L.fid, "A"].values, ee.loc[L.fid, "eloB"].values, ee.loc[L.fid, "eloA"].values)
L["exp"] = 1 / (1 + 10 ** ((L.oelo - L.elo) / 400))
L["n_prev"] = L.groupby("f").cumcount()
L["o_prev"] = L.groupby("o").cumcount()  # approx (counts appearances as opponent column)
L["win"] = (L.result == "W").astype(float)
D = L[L.result.isin(["W", "L"]) & (L.date >= "2010-01-01")].copy()

# Elo baseline accuracy/logloss on 2015+ fights where both had >=3 prior fights (one row per fight)
one = D[(D.date >= "2015-01-01")].drop_duplicates("fid")
nprev_map = L.set_index(["fid", "f"]).n_prev
one = one[one.n_prev >= 3]
p = one.exp.clip(1e-6, 1 - 1e-6)
print("Elo K=48 baseline 2015+ (fighter row with >=3 prior):",
      "acc", round(((p > 0.5) == (one.win == 1)).mean(), 4), "logloss", round(-(one.win * np.log(p) + (1 - one.win) * np.log(1 - p)).mean(), 4),
      "brier", round(((p - one.win) ** 2).mean(), 4), "n", len(one))

# ---------------- age: win rate vs age gap, and result minus Elo expectation by age bucket
D2 = D[D.age.notna() & D.oage.notna()].copy()
D2["gap"] = D2.age - D2.oage
bins = [-99, -8, -5, -3, -1, 1, 3, 5, 8, 99]
D2["gapb"] = pd.cut(D2.gap, bins)
print("\nWin rate by age gap (fighter minus opponent, years), 2010+:")
print(D2.groupby("gapb", observed=True).agg(win=("win", "mean"), exp_elo=("exp", "mean"), n=("win", "size")).round(3).to_string())

D2["ageb"] = pd.cut(D2.age, [0, 24, 27, 30, 32, 34, 36, 38, 60])
print("\nBy fighter age bucket: win rate, Elo-expected, residual (result - Elo expectation), 2010+:")
g = D2[D2.n_prev >= 2].groupby("ageb", observed=True)
print(g.agg(win=("win", "mean"), exp=("exp", "mean"), n=("win", "size")).assign(resid=lambda x: x.win - x.exp).round(3).to_string())


# logistic regression: win ~ elo logit + age gap + older-than-35 terms (numpy Newton)
def logit_fit(X, y, iters=50):
    b = np.zeros(X.shape[1])
    for _ in range(iters):
        p = 1 / (1 + np.exp(-(X @ b)))
        W = p * (1 - p)
        H = X.T @ (X * W[:, None]) + 1e-8 * np.eye(X.shape[1])
        step = np.linalg.solve(H, X.T @ (y - p))
        b += step
        if np.abs(step).max() < 1e-9:
            break
    se = np.sqrt(np.diag(np.linalg.inv(H)))
    return b, se


one2 = D2[(D2.n_prev >= 2) & (D2.o_prev >= 0)].copy()
one2 = one2.drop_duplicates("fid")  # one orientation per fight (first listed row)
rng = np.random.default_rng(0)
flip = rng.random(len(one2)) < 0.5
sgn = np.where(flip, -1, 1)
eloz = (one2.elo - one2.oelo) / 400 * np.log(10) * sgn
gap = one2.gap * sgn
o35 = (np.clip(one2.age - 34, 0, None) - np.clip(one2.oage - 34, 0, None)) * sgn
y = np.where(flip, 1 - one2.win, one2.win)
X = np.column_stack([eloz, gap, o35])
b, se = logit_fit(X, y)
print("\nLogit win ~ Elo + age gap + years past 34 (difference), 2010+, n=%d" % len(y))
for nm, bb, ss in zip(["elo_logit (should be ~1)", "per year of age gap", "per year past 34 (extra)"], b, se):
    print(f"  {nm:28s} {bb:+.4f} (se {ss:.4f})")

# ---------------- chin and power by age: KD absorbed per landed head strike absorbed, vs division average
R = L[(L.date >= "2010-01-01") & L.x_head_l.notna() & L.age.notna() & L["div"].notna()].copy()
lg = R.groupby("div").apply(lambda d: d.x_kd.sum() / d.x_head_l.sum())
R["kd_rate_div"] = R["div"].map(lg)
R["exp_kd_abs"] = R.o_head_l * R.kd_rate_div
R["exp_kd_scored"] = R.x_head_l * R.kd_rate_div
R["ageb"] = pd.cut(R.age, [0, 27, 30, 33, 35, 37, 39, 60])
g = R.groupby("ageb", observed=True)
chin = pd.DataFrame({"kd_abs_obs/exp": g.o_kd.sum() / g.exp_kd_abs.sum(), "kd_scored_obs/exp": g.x_kd.sum() / g.exp_kd_scored.sum(),
                     "ko_loss_rate": g.apply(lambda d: ((d.result == "L") & (d.mgroup == "KO")).mean()),
                     "fights": g.size(), "kd_abs": g.o_kd.sum()})
print("\nChin and power by age (2010+, pooled, vs division KD-per-head-strike):\n", chin.round(3).to_string())

# within-fighter: for each fighter, compare buckets vs that fighter's own <=33 baseline
R["old"] = pd.cut(R.age, [0, 33, 36, 60], labels=["<=33", "34-36", "37+"])
w = R.groupby(["f", "old"], observed=True).agg(obs=("o_kd", "sum"), exp=("exp_kd_abs", "sum"), obs_s=("x_kd", "sum"), exp_s=("exp_kd_scored", "sum"),
                                                  n=("fid", "size"), kol=("result", lambda s: 0)).reset_index()
piv = w.pivot(index="f", columns="old", values=["obs", "exp", "obs_s", "exp_s", "n"])
for later in ["34-36", "37+"]:
    ok = piv["n"]["<=33"].notna() & piv["n"][later].notna() & (piv["n"]["<=33"] >= 3)
    pp = piv[ok]
    ratio_early = pp["obs"]["<=33"].sum() / pp["exp"]["<=33"].sum()
    ratio_late = pp["obs"][later].sum() / pp["exp"][later].sum()
    pr_e = pp["obs_s"]["<=33"].sum() / pp["exp_s"]["<=33"].sum()
    pr_l = pp["obs_s"][later].sum() / pp["exp_s"][later].sum()
    print(f"Within-fighter ({ok.sum()} fighters with >=3 fights at <=33 and some at {later}): "
          f"chin obs/exp {ratio_early:.3f} -> {ratio_late:.3f} (x{ratio_late / ratio_early:.2f}); "
          f"power obs/exp {pr_e:.3f} -> {pr_l:.3f} (x{pr_l / pr_e:.2f}); KD absorbed late {pp['obs'][later].sum():.0f}")

# prior KO losses and chin
R = R.sort_values(["date", "fid"])
R["ko_loss"] = ((R.result == "L") & (R.mgroup == "KO")).astype(int)
R["prev_ko_losses"] = R.groupby("f").ko_loss.cumsum() - R.ko_loss
Lall = L.sort_values(["date", "fid"]).copy()
Lall["ko_loss"] = ((Lall.result == "L") & (Lall.mgroup == "KO")).astype(int)
Lall["prev_ko_losses_all"] = Lall.groupby("f").ko_loss.cumsum() - Lall.ko_loss
R = R.merge(Lall[["fid", "f", "prev_ko_losses_all"]], on=["fid", "f"], how="left")
R["pkb"] = pd.cut(R.prev_ko_losses_all, [-1, 0, 1, 2, 99], labels=["0", "1", "2", "3+"])
g = R.groupby("pkb", observed=True)
print("\nChin by prior UFC KO/TKO losses (2010+):\n", pd.DataFrame({"kd_abs_obs/exp": g.o_kd.sum() / g.exp_kd_abs.sum(),
      "ko_loss_rate": g.ko_loss.mean(), "fights": g.size()}).round(3).to_string())

# ---------------- weight-class moves (men's divisions; home = modal division of last 3 prior fights)
order = ["Flyweight", "Bantamweight", "Featherweight", "Lightweight", "Welterweight", "Middleweight", "Light Heavyweight", "Heavyweight"]
rank = {d: i for i, d in enumerate(order)}
M = L[L.men & L["div"].isin(order)].sort_values(["date", "fid"]).copy()
M["dr"] = M["div"].map(rank)
homes = []
hist = {}
for r in M.itertuples():
    h = hist.get(r.f, [])
    homes.append(pd.Series(h[-3:]).mode().iloc[0] if len(h) >= 2 else np.nan)
    hist.setdefault(r.f, []).append(r.dr)
M["home"] = homes
M["move"] = M.dr - M.home
MM = M[M.home.notna() & M.result.isin(["W", "L"]) & (M.date >= "2010-01-01")].copy()
MM["mv"] = np.select([MM.move <= -1, MM.move == 0, MM.move == 1, MM.move >= 2], ["down", "same", "up1", "up2+"], "na")
lgm = R.groupby("div").kd_rate_div.first()
MM["exp_kd_abs"] = MM.o_head_l * MM["div"].map(lg)
g = MM.groupby("mv")
print("\nWeight-class moves (men, home = modal of last 3 prior UFC fights, >=2 prior), 2010+:")
print(pd.DataFrame({"win": g.win.mean(), "elo_exp": g.exp.mean(), "resid": g.win.mean() - g.exp.mean(),
                    "ko_loss_rate": g.apply(lambda d: ((d.result == "L") & (d.mgroup == "KO")).mean()),
                    "kd_abs_obs/exp": g.o_kd.sum() / g.exp_kd_abs.sum(), "n": g.size()}).round(3).to_string())
# within-fighter chin change for movers up: compare their same-division fights vs up fights
up_f = MM[MM.mv == "up1"].f.unique()
s_same = MM[MM.f.isin(up_f) & (MM.mv == "same")]
s_up = MM[MM.f.isin(up_f) & (MM.mv == "up1")]
print("Within movers-up: chin obs/exp at home %.3f vs up %.3f; KO-loss rate %.3f vs %.3f; win %.3f vs %.3f (resid %.3f vs %.3f)" % (
    s_same.o_kd.sum() / s_same.exp_kd_abs.sum(), s_up.o_kd.sum() / s_up.exp_kd_abs.sum(),
    ((s_same.result == "L") & (s_same.mgroup == "KO")).mean(), ((s_up.result == "L") & (s_up.mgroup == "KO")).mean(),
    s_same.win.mean(), s_up.win.mean(), (s_same.win - s_same.exp).mean(), (s_up.win - s_up.exp).mean()))
# Opponents' perspective: when the opponent moved up into this division, does the native's power show up more?
# Age x up interaction (older movers)
o = MM[(MM.mv == "up1") & MM.age.notna()]
print("Movers up aged 34+: win %.3f, resid %.3f, KO-loss %.3f, n %d" % (
    o[o.age >= 34].win.mean(), (o[o.age >= 34].win - o[o.age >= 34].exp).mean(),
    ((o[o.age >= 34].result == "L") & (o[o.age >= 34].mgroup == "KO")).mean(), (o.age >= 34).sum()))

# ---------------- time decay check: does recent form predict better? compare correlation of
# per-fight landed-differential with previous-fight vs 3-years-ago fights (simple)
