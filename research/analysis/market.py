import sys
import numpy as np, pandas as pd
d = pd.read_csv(sys.argv[1])  # ufc-master.csv from github.com/shortlikeafox/ultimate_ufc_dataset (Apache-2.0)
print([c for c in d.columns if "odds" in c.lower()][:20])
d["date"] = pd.to_datetime(d.date, errors="coerce")
print("date range", d.date.min(), d.date.max(), "rows", len(d))
d = d[d.Winner.isin(["Red", "Blue"]) & d.R_odds.notna() & d.B_odds.notna()].copy()
def imp(o): return np.where(o < 0, -o / (-o + 100), 100 / (o + 100))
pr, pb = imp(d.R_odds.values), imp(d.B_odds.values)
d["over"] = pr + pb - 1
d["pR"] = pr / (pr + pb)
y = (d.Winner == "Red").astype(float).values
p = d.pR.clip(1e-6, 1 - 1e-6).values
print("overround mean %.4f median %.4f" % (d.over.mean(), d.over.median()))
print("market (proportional de-vig): n %d, logloss %.4f, brier %.4f, fav acc %.4f" % (len(d), -(y*np.log(p)+(1-y)*np.log(1-p)).mean(), ((p-y)**2).mean(), ((p > 0.5) == (y == 1))[p != 0.5].mean()))
# favourite perspective buckets
pf = np.maximum(p, 1 - p); yf = np.where(p >= 0.5, y, 1 - y)
b = pd.cut(pf, [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 1.0])
t = pd.DataFrame({"implied": pf, "won": yf}).groupby(b, observed=True).agg(implied=("implied", "mean"), won=("won", "mean"), n=("won", "size"))
t["diff"] = t.won - t.implied
print(t.round(3).to_string())
# recalibration slope: logit(P(y)) = a + b*logit(p)  (Newton)
z = np.log(p / (1 - p)); X = np.column_stack([np.ones_like(z), z])
beta = np.zeros(2)
for _ in range(50):
    q = 1 / (1 + np.exp(-(X @ beta))); H = X.T @ (X * (q*(1-q))[:, None]); g = X.T @ (y - q)
    s = np.linalg.solve(H, g); beta += s
se = np.sqrt(np.diag(np.linalg.inv(H)))
print("recalibration: intercept %.3f (se %.3f), slope %.3f (se %.3f) -> slope CI [%.3f, %.3f]" % (beta[0], se[0], beta[1], se[1], beta[1]-1.96*se[1], beta[1]+1.96*se[1]))
# symmetric slope only (no corner intercept)
yy = np.r_[y, 1-y]; zz = np.r_[z, -z]
bb = 1.0
for _ in range(50):
    q = 1/(1+np.exp(-bb*zz)); g = (zz*(yy-q)).sum(); h = (zz*zz*q*(1-q)).sum(); bb += g/h
print("symmetric slope %.3f (se ~%.3f)" % (bb, 1/np.sqrt(h/2)))
d["year"] = d.date.dt.year
by = d.assign(y=y, p=p).groupby("year").apply(lambda g: pd.Series({"n": len(g), "logloss": -(g.y*np.log(g.p)+(1-g.y)*np.log(1-g.p)).mean(), "fav_acc": ((g.p > 0.5) == (g.y == 1)).mean()}))
print(by.round(4).to_string())
