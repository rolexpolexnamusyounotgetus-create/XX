#!/usr/bin/env python3
"""Independent re-implementation of the durability headline (adversarial check of tools/durability.py).

Fresh code: it does NOT import tools/durability.py or tools/build_db.py. It parses data/raw/*.csv directly,
identifies fighters by their ufcstats name (no people resolution), recomputes every pre-fight feature, the
trailing league level, the walk-forward Gamma chin / power effects, and fits the Poisson models with statsmodels.
It then scores the held-out ladder on 2024-01-01 onward (fit 2008-2023) and reports fight-clustered and
fighter-multiway-clustered SEs, a level-neutral comparison (each half-year rescaled to its observed total; a
diagnostic that uses outcomes, never a model), and the chin-exponent claim. "F" is the analyst's original
36-parameter model; "Fr" is the reduced model chosen by the one-SE elimination on 2019-2023.

    python3 tools/durability_verify.py            # about 1 minute; prints a table, writes data/derived/durability_verify.json
"""
import os
for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "1")
import datetime as dt
import json
import math
import re
from collections import defaultdict

import numpy as np
import pandas as pd
import statsmodels.api as sm

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "data", "derived", "durability_verify.json")
FIT = ("2008-01-01", "2023-12-31")
VFIT = ("2008-01-01", "2018-12-31")
VAL = ("2019-01-01", "2023-12-31")
TEST = "2024-01-01"
ALPHA_C = ALPHA_P = 3.0
LEVEL_DAYS = 730
WIN = 365


def rd(name):
    d = pd.read_csv(os.path.join(RAW, name), dtype=str, keep_default_na=False)
    d.columns = [c.strip() for c in d.columns]
    return d.apply(lambda s: s.str.strip())


def div_of(wc):
    w = wc.lower()
    for pat, dv in (("women's strawweight", "WSW"), ("women's flyweight", "WFLY"), ("women's bantamweight", "WBW"),
                    ("women's featherweight", "WFW"), ("light heavyweight", "LHW"), ("heavyweight", "HW"),
                    ("middleweight", "MW"), ("welterweight", "WW"), ("lightweight", "LW"), ("featherweight", "FW"),
                    ("bantamweight", "BW"), ("flyweight", "FLY"), ("strawweight", "WSW"), ("catch", "CW")):
        if pat in w:
            return dv
    return "OW"


def lnd(s):
    m = re.match(r"^(\d+)\s*of\s*(\d+)$", s)
    return float(m.group(1)) if m else 0.0


def load():
    ev = rd("ufc_event_details.csv")
    edate = {e: dt.datetime.strptime(d, "%B %d, %Y").date() for e, d in zip(ev.EVENT, ev.DATE) if d}
    res = rd("ufc_fight_results.csv").rename(columns={"TIME FORMAT": "FMT"})
    res["i"] = np.arange(len(res))
    res = res[res.EVENT.isin(edate)].drop_duplicates("URL", keep="first")
    res = res[res.BOUT.str.count(" vs. ") == 1].copy()
    res["date"] = res.EVENT.map(edate)
    res = res.sort_values(["date", "i"], ascending=[True, False])          # file is newest first, main event first
    st = rd("ufc_fight_stats.csv")
    st = st[st.ROUND != ""].copy()
    for c in ("KD",):
        st[c] = pd.to_numeric(st[c], errors="coerce").fillna(0.0)
    for c in ("HEAD", "DISTANCE", "CLINCH", "GROUND"):
        st[c] = st[c].map(lnd)
    agg = st.groupby(["EVENT", "BOUT", "FIGHTER"])[["KD", "HEAD", "DISTANCE", "CLINCH", "GROUND"]].sum()
    nb = res.groupby(["EVENT", "BOUT"]).size()
    tott = rd("ufc_fighter_tott.csv")
    cnt = tott.FIGHTER.value_counts()
    dob = {}
    for n, d in zip(tott.FIGHTER, tott.DOB):
        if cnt[n] == 1 and d and d != "--":
            try:
                dob[n] = dt.datetime.strptime(d, "%b %d, %Y").date()
            except ValueError:
                pass
    return res, agg, nb, dob


def stand_head(h, dd, c, g):
    return 0.5 * (max(h - g, 0.0) + min(h, dd + c))


def build():
    res, agg, nb, dob = load()
    S = defaultdict(lambda: {"n": 0, "first": None, "last": None, "oh": 0.0, "ev": [], "last_kol": 0,
                             "dkd": 0.0, "dh": 0.0, "dokd": 0.0, "doh": 0.0, "dt": None, "hist": []})
    LBS = {"FLY": 125, "BW": 135, "FW": 145, "LW": 155, "WW": 170, "MW": 185, "LHW": 205, "HW": 265,
           "WSW": 115, "WFLY": 125, "WBW": 135, "WFW": 145}
    rows = []
    for r in res.itertuples(index=False):
        A, Bn = [x.strip() for x in r.BOUT.split(" vs. ")]
        if A == Bn:
            continue
        day = r.date.toordinal()
        win = {"W/L": 0, "L/W": 1}.get(r.OUTCOME)
        ko = r.METHOD == "KO/TKO"
        division = div_of(r.WEIGHTCLASS)
        five = 1.0 if r.FMT.startswith("5 Rnd") else 0.0
        title = 1.0 if (("Title" in r.WEIGHTCLASS and "Tournament" not in r.WEIGHTCLASS) or "Championship" in r.WEIGHTCLASS) else 0.0
        stats = None
        if nb.get((r.EVENT, r.BOUT), 0) == 1:
            try:
                sa = agg.loc[(r.EVENT, r.BOUT, A)]
                sb = agg.loc[(r.EVENT, r.BOUT, Bn)]
                stats = (sa, sb)
            except KeyError:
                stats = None
        feats = []
        for nm in (A, Bn):
            s = S[nm]
            # decay the v3-style sums to today (half-life 730 days) without mutating
            f = 0.5 ** ((day - s["dt"]) / 730.0) if s["dt"] is not None else 1.0
            age = (r.date - dob[nm]).days / 365.25 if nm in dob else np.nan
            okd_r = sum(k for d0, k, _ in s["ev"] if day - d0 <= WIN)
            okd_o = sum(k for d0, k, _ in s["ev"] if day - d0 > WIN)
            kol_r = sum(k for d0, _, k in s["ev"] if day - d0 <= WIN)
            kol_o = sum(k for d0, _, k in s["ev"] if day - d0 > WIN)
            lay = day - s["last"] if s["n"] else np.nan
            real = [d for d0, d in s["hist"] if d not in ("CW", "OW") and day - d0 <= 1096]
            if not real:
                real = [d for d0, d in s["hist"] if d not in ("CW", "OW")]
            home = None
            if real:
                vc = pd.Series(real).value_counts()
                best = vc.max()
                home = next(d for d in real[::-1] if vc[d] == best)
            feats.append({"age": age, "n": s["n"], "yrs": (day - s["first"]) / 365.25 if s["n"] else 0.0, "lay": lay,
                          "oh": s["oh"], "okd_r": okd_r, "okd_o": okd_o, "kol_r": kol_r, "kol_o": kol_o,
                          "last_kol": s["last_kol"], "dkd": s["dkd"] * f, "dh": s["dh"] * f, "dokd": s["dokd"] * f,
                          "doh": s["doh"] * f,
                          "up_lbs": max(0.0, (LBS.get(division) or 0) - LBS[home]) if (home in LBS and division in LBS
                                                                                       and (division[0] == "W") == (home[0] == "W")) else 0.0})
        for att in (0, 1):
            dfn = 1 - att
            fa, fd = feats[att], feats[dfn]
            row = {"fid": r.URL, "date": r.date.isoformat(), "day": day, "div": division, "five": five, "title": title,
                   "att": (A, Bn)[att], "def": (A, Bn)[dfn], "y": np.nan, "E": np.nan, "H": np.nan}
            if stats is not None:
                sa = stats[att]
                row["y"] = float(sa.KD)
                row["E"] = stand_head(sa.HEAD, sa.DISTANCE, sa.CLINCH, sa.GROUND)
                row["H"] = float(sa.HEAD)
            for k, v in fd.items():
                row["d_" + k] = v
            for k, v in fa.items():
                row["a_" + k] = v
            rows.append(row)
        # update both fighters after both directions are recorded
        for s_i, nm in enumerate((A, Bn)):
            s = S[nm]
            if s["dt"] is not None:
                f = 0.5 ** ((day - s["dt"]) / 730.0)
                for k in ("dkd", "dh", "dokd", "doh"):
                    s[k] *= f
            s["dt"] = day
            okd = 0.0
            if stats is not None:
                me, op = stats[s_i], stats[1 - s_i]
                okd = float(op.KD)
                s["oh"] += float(op.HEAD)
                s["dkd"] += float(me.KD)
                s["dh"] += float(me.HEAD)
                s["dokd"] += okd
                s["doh"] += float(op.HEAD)
            kol = 1 if (ko and win is not None and win != s_i) else 0
            s["ev"].append((day, okd, kol))
            s["last_kol"] = kol
            if s["first"] is None:
                s["first"] = day
            s["last"] = day
            s["n"] += 1
            s["hist"].append((day, division))
    X = pd.DataFrame(rows)
    return X


def add(X):
    for p in ("d", "a"):
        a = X[p + "_age"]
        X[p + "_age_na"] = a.isna().astype(float)
        a = a.fillna(30.0)
        X[p + "_agec"] = a - 30
        X[p + "_ageh"] = np.clip(a - 30, 0, None)
        X[p + "_lognp"] = np.log1p(X[p + "_n"])
        X[p + "_debut"] = (X[p + "_n"] == 0).astype(float)
    X["d_oh100"] = X.d_oh / 100.0
    lay = X.d_lay
    X["d_lay_s"] = ((lay < 120) & lay.notna()).astype(float)
    X["d_lay_m"] = ((lay >= 365) & (lay < 730)).astype(float)
    X["d_lay_l"] = (lay >= 730).astype(float)
    X["d_lastko"] = X.d_last_kol.astype(float)
    X["d_koshort"] = X.d_lastko * ((lay < 180) & lay.notna())
    # trailing league level over [day - 730, day), all rows with stats
    s = X[X.E.notna()].groupby("day").agg(kd=("y", "sum"), E=("E", "sum")).sort_index()
    days = s.index.to_numpy()
    ck = np.concatenate([[0], np.cumsum(s.kd.to_numpy())])
    cE = np.concatenate([[0], np.cumsum(s.E.to_numpy())])
    lv = {}
    for d in np.unique(X.day):
        hi = np.searchsorted(days, d, "left")
        w = LEVEL_DAYS
        while True:
            lo = np.searchsorted(days, d - w, "left")
            if ck[hi] - ck[lo] >= 30 or w > 7300:
                break
            w *= 2
        lv[d] = (ck[hi] - ck[lo]) / (cE[hi] - cE[lo]) if cE[hi] > cE[lo] else np.nan
    X["lv"] = X.day.map(lv)
    X["lv"] = X.lv.fillna(X.lv.dropna().iloc[0])
    X["use"] = X.E.notna() & (X.E > 0)
    for dv in sorted(X["div"].unique()):
        if dv not in ("LW", "OW"):
            X["div_" + dv] = (X["div"] == dv).astype(float)
    return X


COV = ["d_agec", "d_ageh", "d_age_na", "a_agec", "a_ageh", "d_yrs", "d_lognp", "d_oh100", "d_okd_r", "d_okd_o",
       "d_kol_r", "d_kol_o", "d_debut", "d_lay_s", "d_lay_m", "d_lay_l", "d_lastko", "d_koshort",
       "a_yrs", "a_lognp", "a_debut"]
# the reduced covariate set chosen by the one-SE elimination on 2019-2023 in tools/durability.py (verification run)
COV_R = ["d_agec", "d_ageh", "d_age_na", "d_okd_r", "d_okd_o", "d_kol_r", "d_kol_o", "a_agec", "a_ageh"]


def walk(X, base, use_c=True, use_p=True, ac=ALPHA_C, ap=ALPHA_P):
    """Walk-forward Gamma posterior means; both directions of a fight predicted before updating."""
    Yc, Mc, Yp, Mp = defaultdict(float), defaultdict(float), defaultdict(float), defaultdict(float)
    chin = np.ones(len(X))
    pw = np.ones(len(X))
    cs = np.zeros(len(X)); cr = np.zeros(len(X))
    fid = X.fid.to_numpy(); de = X["def"].to_numpy(); at = X.att.to_numpy()
    y = np.nan_to_num(X.y.to_numpy(float)); use = X.use.to_numpy()
    i, n = 0, len(X)
    while i < n:
        j = i
        while j < n and fid[j] == fid[i]:
            j += 1
        for r in range(i, j):
            cs[r], cr[r] = ac + Yc[de[r]], ac + Mc[de[r]]
            if use_c:
                chin[r] = cs[r] / cr[r]
            if use_p:
                pw[r] = (ap + Yp[at[r]]) / (ap + Mp[at[r]])
        for r in range(i, j):
            if use[r]:
                Yc[de[r]] += y[r]; Mc[de[r]] += base[r] * pw[r]
                Yp[at[r]] += y[r]; Mp[at[r]] += base[r] * chin[r]
        i = j
    return chin, pw


def fit(X, cols, fm, eb=False, use_c=True, use_p=True, level=True, extra=None, iters=5, ap=ALPHA_P):
    Z = sm.add_constant(X[cols].to_numpy(float), has_constant="add") if cols else np.ones((len(X), 1))
    y = np.nan_to_num(X.y.to_numpy(float))
    E = np.where(X.use, X.E.fillna(1.0), 1.0)
    off0 = np.log(E) + (np.log(X.lv.to_numpy(float)) if level else 0.0) + (0.0 if extra is None else extra)
    fe = np.zeros(len(X))
    chin = pw = np.ones(len(X))
    for it in range(iters if eb else 1):
        m = sm.GLM(y[fm], Z[fm], family=sm.families.Poisson(), offset=(off0 + fe)[fm]).fit()
        if not eb:
            break
        base = np.exp(Z @ m.params + off0) * X.use.to_numpy()
        chin, pw = walk(X, base, use_c, use_p, ap=ap)
        fe = np.log(chin) + np.log(pw)
    if eb:
        m = sm.GLM(y[fm], Z[fm], family=sm.families.Poisson(), offset=(off0 + fe)[fm]).fit()
    mu = np.exp(Z @ m.params + off0 + fe)
    return {"m": m, "mu": mu, "chin": chin, "pow": pw, "lin": Z @ m.params, "off0": off0}


def dev(y, mu):
    mu = np.maximum(mu, 1e-12)
    return 2 * (np.where(y > 0, y * np.log(np.where(y > 0, y, 1) / mu), 0.0) - (y - mu))


def se_fight(X, mask, d):
    g = pd.Series(d[mask]).groupby(X.fid.to_numpy()[mask]).sum()
    return float(g.std(ddof=1) * math.sqrt(len(g)))


def se_fighter(X, mask, d):
    """Multiway cluster SE for a sum over rows where each row belongs to both of its fighters' clusters."""
    t = d[mask] - d[mask].mean()
    de = X["def"].to_numpy()[mask]; at = X.att.to_numpy()[mask]
    s = pd.Series(np.concatenate([t, t])).groupby(np.concatenate([de, at])).sum()
    pair = np.array(["|".join(sorted(p)) for p in zip(de, at)])
    q = pd.Series(t).groupby(pair).sum()
    v = float((s ** 2).sum() - (q ** 2).sum())
    return math.sqrt(max(v, 0.0))


def v3_off(X, fm):
    tr = X[fm]
    pdiv = tr.groupby("div").y.sum() / tr.groupby("div").H.sum()
    p = X["div"].map(pdiv).fillna(tr.y.sum() / tr.H.sum()).to_numpy(float)
    k = 230.0
    pw = ((X.a_dkd + k * p) / (X.a_dh + k)) / p
    ch = ((X.d_dokd + k * p) / (X.d_doh + k)) / p
    ac = np.exp(0.04 * np.clip(X.d_age.fillna(30) - 34, 0, None))
    ap = np.exp(-0.03 * np.clip(X.a_age.fillna(30) - 34, 0, None))
    ko = np.minimum(1.15, 1.04 ** (X.d_kol_r + X.d_kol_o))
    sz = np.exp(0.05 * X.d_up_lbs / 10) * np.exp(-0.03 * X.a_up_lbs / 10)
    return np.log((pw * ch * ac * ap * ko * sz).to_numpy(float))


def main():
    X = add(build())
    win = lambda lo, hi=None: (X.use & (X.date >= lo) & ((X.date <= hi) if hi else True)).to_numpy()
    fm, tm = win(*FIT), win(TEST)
    divs = [c for c in X.columns if c.startswith("div_")]
    ctx = divs + ["five", "title"]
    print("rows %d, fit rows %d (KD %d), test rows %d (KD %d), test fights %d" % (
        len(X), fm.sum(), X.y[fm].sum(), tm.sum(), X.y[tm].sum(), X.fid[tm].nunique()))
    models = {
        "M0L": fit(X, [], fm),
        "M1": fit(X, ctx, fm),
        "M3": fit(X, ctx + COV, fm),
        "V3": fit(X, divs, fm, extra=v3_off(X, fm)),
        "E3": fit(X, ctx, fm, eb=True),
        "F": fit(X, ctx + COV, fm, eb=True),
        "Fnokd": fit(X, ctx + [c for c in COV if c not in ("d_okd_r", "d_okd_o")], fm, eb=True),
        "Fr": fit(X, ctx + COV_R, fm, eb=True, ap=2.5),
    }
    y = np.nan_to_num(X.y.to_numpy(float))
    D = {k: dev(y, v["mu"]) for k, v in models.items()}
    out = {"rows_test": int(tm.sum()), "kd_test": int(y[tm].sum()), "fights_test": int(X.fid[tm].nunique()), "ladder": [], "pairs": []}
    per = (pd.to_datetime(X.date).dt.year.astype(str) + np.where(pd.to_datetime(X.date).dt.month <= 6, "a", "b")).to_numpy()

    def resc(mu):
        """Level-neutral diagnostic (uses outcomes): each half-year's predictions scaled to its observed total."""
        out_ = mu.copy()
        for p_ in np.unique(per[tm]):
            mm = tm & (per == p_)
            out_[mm] = mu[mm] * y[mm].sum() / mu[mm].sum()
        return out_

    for k, v in models.items():
        mu = v["mu"]
        dres = dev(y, resc(mu))
        out["ladder"].append({"model": k, "dev_test": round(float(D[k][tm].sum()), 2), "kd_exp": round(float(mu[tm].sum()), 1),
                              "dev_test_rescaled": round(float(dres[tm].sum()), 2)})
        print("  %-6s dev %.1f  exp %.1f  rescaled dev %.1f" % (k, D[k][tm].sum(), mu[tm].sum(), dres[tm].sum()))
    # paired comparisons
    R = {k: dev(y, resc(v["mu"])) for k, v in models.items()}
    for a, b in (("F", "M0L"), ("F", "V3"), ("F", "E3"), ("F", "M3"), ("E3", "V3"), ("E3", "M0L"), ("M3", "M1"),
                 ("Fnokd", "F"), ("Fr", "M0L"), ("Fr", "V3"), ("Fr", "E3"), ("Fr", "F")):
        d = D[a] - D[b]
        dr = R[a] - R[b]
        row = {"model": a, "vs": b, "diff": round(float(d[tm].sum()), 2), "se_fight": round(se_fight(X, tm, d), 2),
               "se_fighter_multiway": round(se_fighter(X, tm, d), 2), "diff_rescaled": round(float(dr[tm].sum()), 2),
               "se_rescaled_fighter": round(se_fighter(X, tm, dr), 2)}
        out["pairs"].append(row)
        print("  %-5s vs %-4s %+.1f (fight SE %.1f, fighter-multiway SE %.1f)  level-neutral %+.1f (SE %.1f)" % (
            a, b, row["diff"], row["se_fight"], row["se_fighter_multiway"], row["diff_rescaled"], row["se_rescaled_fighter"]))
    # chin exponent: calibration slope on validation (fit 2008-2018), then apply on test
    vfm, vm = win(*VFIT), win(*VAL)
    rv = fit(X, ctx + COV, vfm, eb=True)
    offv = rv["lin"] + rv["off0"]
    Zs = np.column_stack([np.ones(len(X)), np.log(rv["chin"]), np.log(rv["pow"])])
    sl = sm.GLM(y[vm], Zs[vm], family=sm.families.Poisson(), offset=offv[vm]).fit()
    Ft = models["F"]
    offt = Ft["lin"] + Ft["off0"]
    slt = sm.GLM(y[tm], Zs[tm] * 0 + np.column_stack([np.ones(len(X)), np.log(Ft["chin"]), np.log(Ft["pow"])])[tm],
                 family=sm.families.Poisson(), offset=offt[tm]).fit()
    bc = float(sl.params[1])
    mu_e = np.exp(offt) * Ft["chin"] ** bc * Ft["pow"]
    # keep the fit-period total unchanged by the exponent (renormalize on 2008-2023)
    mu_e *= Ft["mu"][fm].sum() / mu_e[fm].sum()
    de_ = dev(y, mu_e) - D["F"]
    out["chin_exponent"] = {"val_slope_chin": round(bc, 4), "val_se": round(float(sl.bse[1]), 4),
                            "val_slope_pow": round(float(sl.params[2]), 4),
                            "test_slope_chin": round(float(slt.params[1]), 4), "test_se": round(float(slt.bse[1]), 4),
                            "test_slope_pow": round(float(slt.params[2]), 4),
                            "test_gain": round(float(de_[tm].sum()), 2), "se_fight": round(se_fight(X, tm, de_), 2)}
    print("  chin exponent:", out["chin_exponent"])
    with open(OUT, "w") as fh:
        json.dump(out, fh, indent=1)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
