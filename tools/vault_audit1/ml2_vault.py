#!/usr/bin/env python3
"""VAULT AUDIT 1 (auditor only): ML v2 inputs for the sealed 2026 fights, from frozen fits only.

    nice -n 5 python3 tools/vault_audit1/ml2_vault.py [--vault <dir>] [--jobs 2]

1. Feature table. tools/ml2.py's own table builders (build_base: tools/ml.py's walk-forward table; build_ratings: the
   ratings.py systems with their frozen 2019-2023 parameters; build_market_rating: the walk-forward Kalman market rating
   on earlier closing lines; build_preufc; build_fightweek) are run with ml2's parse cutoff moved from 2026-01-01 to
   2026-11-01, so 2026 rows get features built strictly from earlier fights (and, for the market rating, earlier
   closing lines from <vault>/market_vault.json). The cutoff is restored before anything else runs. Check: every
   pre-2026 design row must equal the frozen table's (out/ml2_cache/run1/table.pkl).
2. ML v2 logistic, two frozen fits, nothing refit:
     prod   ml2.json page_model.terms coefficients (fit on every decisive fight 2010-2025; the forward ledger's ml2_lr)
     static fit.pkl coefs['lr|static'] (fit on 2010-2023; what 2024-25 validation scored)
   Check: static on 2024-25 rows equals ml2.json fights[*].ml2_lr.
3. ML v2 blend (static, for S2+ml2win only): the LightGBM / XGBoost members are not stored, so they are retrained with
   their frozen configuration, rounds and seeds on rows dated before 2024-01-01 (ml2.py's "static" window); check: the
   retrained static predictions on 2024-25 rows equal fit.pkl's. Blend weights fit.pkl blend_w.
4. S, S2, S2+ml2win cells (method x round, tools/ml2.py stage_method's 2024 fold: hazard and six-class models fit on rows
   dated before 2024 with the frozen penalties; chosen C6 for S2 from ml2.json method). Check: S on 2024-25 and on the
   vault equals methodround.json's S (fit through 2023-12-31).
Output: <vault>/audit1/ml2_vault.json (per vault fight: ml2_lr_prod, ml2_lr_static, ml2_blend_static, mr, cells S/S2/
S2+ml2win, checks). Never writes inside the repository.
"""
import argparse, datetime as dt, json, os, pickle, shutil, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
ap = argparse.ArgumentParser()
ap.add_argument("--vault", default="/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vault")
ap.add_argument("--jobs", type=int, default=2)
a = ap.parse_args()
AUD = os.path.join(a.vault, "audit1")
CACHE = os.path.join(AUD, "ml2_cache")
os.makedirs(CACHE, exist_ok=True)
os.environ["ML2_CACHE"] = CACHE
FROZEN = os.path.join(ROOT, "out", "ml2_cache")
for fn in ("cv.json", "fit.pkl"):
    shutil.copyfile(os.path.join(FROZEN, fn), os.path.join(CACHE, fn))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import ml2  # noqa: E402

t0 = time.time()
CUT, CUT_S = dt.date(2026, 11, 1), "2026-11-01"
DEV_VAULT, DEV_VAULT_S = ml2.VAULT, ml2.VAULT_S
MV = json.load(open(os.path.join(a.vault, "market_vault.json")))["fights"]
_jload = ml2.jload


def jload_vault(name):
    d = _jload(name)
    if name == "market.json":
        d = dict(d)
        d["fights"] = dict(d["fights"])
        d["fights"].update(MV)            # 2026 closing lines (pre-fight BFO closes), for later fights' market rating
    return d


# ---------------------------------------------------------------- 1. table (cutoff moved, then restored)
ml2.VAULT, ml2.VAULT_S, ml2.jload = CUT, CUT_S, jload_vault
try:
    base = ml2.build_base()
    df = base["df"].copy()
    df = df[df["date"] < CUT].reset_index(drop=True)
    rat = ml2.build_ratings()
    fidx = {f: i for i, f in enumerate(rat["fid"])}
    ii = df["fid"].map(fidx)
    assert ii.notna().all()
    ii = ii.astype(int).to_numpy()
    for name in ml2.RATING_SYSTEMS:
        df["r_" + name] = rat["p"][name][ii]
    for name in ("whr_rounds", "glicko2"):
        rec = rat["rec"][name][ii]
        df["A_rsd_" + name] = rec[:, 1]
        df["B_rsd_" + name] = rec[:, 3]
    mr, mr_chk, _ = ml2.build_market_rating(df)
    cols = ["mr_p", "A_mr_mu", "A_mr_var", "A_mr_n", "B_mr_mu", "B_mr_var", "B_mr_n", "mr_line"]
    vals = np.array([mr.get(f, (np.nan,) * 7 + (False,)) for f in df["fid"]], dtype=object)
    for k, c in enumerate(cols):
        df[c] = vals[:, k].astype(float)
    df["mr_ok"] = df["mr_p"].notna().astype(float)
    pre = ml2.build_preufc(df, base["k_dates"], base["people_slug"])
    for s_i, s in enumerate(("A_", "B_")):
        df[s + "pre_ok"] = [float(pre[f][s_i] is not None) for f in df["fid"]]
        for k in ml2.PRE_CORE + ml2.PRE_METHOD:
            df[s + k] = [(pre[f][s_i] or {}).get(k, np.nan) for f in df["fid"]]
    fw = ml2.build_fightweek(df)
    for s_i, s in enumerate(("A_", "B_")):
        for k in ("fw_missed", "fw_repl", "fw_repl14", "fw_home_intl", "fw_home_any", "fw_tz", "fw_travel", "fw_oppchg"):
            df[s + k] = [fw[f][0][s_i][k] if f in fw else np.nan for f in df["fid"]]
    df["fw_ok"] = df["fid"].isin(fw).astype(float)
    df["y"] = df["winner"].map({"A": 1.0, "B": 0.0})
    df["dec"] = df["winner"].isin(["A", "B"]) & ~df["amb"]
    df["evalrow"] = df["dec"] & df["both_exp"]
    import methodround as MR
    D = MR.prepare(False)                 # methodround table (its parse goes through ml2's wrapper: cutoff 2026-11-01)
finally:
    ml2.VAULT, ml2.VAULT_S, ml2.jload = DEV_VAULT, DEV_VAULT_S, _jload
print("table %s, max date %s (%.0f s); market-rating check %s" % (df.shape, df["date"].max(), time.time() - t0, mr_chk), flush=True)
T = df
C = json.load(open(os.path.join(CACHE, "cv.json")))
pm = C["pre_means"]
X = ml2.superset_matrix(T, pm)
cols = C["lr"]["cols"]
vault_ids = {f["id"]: f for f in json.load(open(os.path.join(a.vault, "backtest_vault.json")))["fights"]}
fid = T["fid"].tolist()
pos = {f: i for i, f in enumerate(fid)}
yr = T["year"].to_numpy()
checks = {"market_rating_vs_market_json": mr_chk}

# frozen table: pre-2026 design rows must match
TF = pickle.load(open(os.path.join(FROZEN, "run1", "table.pkl"), "rb"))["df"]
XF = ml2.superset_matrix(TF, pm)
common = [f for f in TF["fid"] if f in pos]
ia = np.array([pos[f] for f in common])
ib = np.array([i for i, f in enumerate(TF["fid"]) if f in pos])
dX = np.nanmax(np.abs(X[cols].to_numpy(float)[ia] - XF[cols].to_numpy(float)[ib]))
checks["pre2026_design_max_abs_diff_vs_frozen_table"] = float(dX)
checks["pre2026_rows_matched"] = [len(common), len(TF)]
dcol = np.nanmax(np.abs(X[cols].to_numpy(float)[ia] - XF[cols].to_numpy(float)[ib]), axis=0)
nrow = (np.abs(X[cols].to_numpy(float)[ia] - XF[cols].to_numpy(float)[ib]) > 1e-9).sum(axis=0)
checks["pre2026_design_cols_differing"] = {c: [float(v), int(r)] for c, v, r in zip(cols, dcol, nrow) if v > 1e-9}
pickle.dump({"T": T, "fid": T["fid"].tolist()}, open(os.path.join(CACHE, "table_vault.pkl"), "wb"))
print("pre-2026 design rows vs frozen table: max |diff| %.3g over %d / %d rows" % (dX, len(common), len(TF)), flush=True)

# ---------------------------------------------------------------- 2. ML v2 logistic, frozen coefficients
F = pickle.load(open(os.path.join(CACHE, "fit.pkl"), "rb"))
c_static = np.asarray(F["coefs"]["lr|static"], float)
J2 = json.load(open(os.path.join(ROOT, "data", "derived", "ml2.json")))
terms = {t["name"]: t["coef"] for t in J2["page_model"]["terms"]}
missing_terms = [c for c in cols if c not in terms]
assert not missing_terms, missing_terms
c_prod = np.array([terms[c] for c in cols], float)
Xc = X[cols].to_numpy(float)
z_static, z_prod = Xc @ c_static, Xc @ c_prod
p_static, p_prod = 1 / (1 + np.exp(-z_static)), 1 / (1 + np.exp(-z_prod))
mlj = J2["fights"]
d = [abs(p_static[pos[k]] - v["ml2_lr"]) for k, v in mlj.items() if k in pos and v.get("set") == "valid" and v.get("ml2_lr") is not None]
checks["static_vs_ml2json_valid_max_abs"] = [len(d), float(max(d))]
print("ML v2 static vs ml2.json 2024-25 ml2_lr: n %d max |diff| %.2e" % (len(d), max(d)), flush=True)

# ---------------------------------------------------------------- 3. static blend members (retrained, frozen config)
y = T["y"].fillna(0.5).to_numpy(float)
G0, G1 = ml2.tree_mats(T, X, cols)
tr = ml2.train_mask(T, dt.date(2024, 1, 1), C["lr"])
te = (T["date"] >= dt.date(2024, 1, 1)).to_numpy()
fpos = {f: i for i, f in enumerate(F["fid"])}
preds = {}
for kind, seeds in (("lgb", ml2.LGB_SEEDS), ("xgb", ml2.XGB_SEEDS)):
    tc = C["trees"][kind]
    arr = []
    for sd in seeds:
        if kind == "lgb":
            m = ml2.lgb_train(tc["cfg"], G0[tr], G1[tr], y[tr], tc["rounds"], sd, tc["mono"])
            p = ml2.lgb_predict(m, G0[te], G1[te])
        else:
            m = ml2.xgb_train(tc["cfg"], G0[tr], G1[tr], y[tr], tc["rounds"], sd, tc["mono"])
            p = ml2.xgb_predict(m, G0[te], G1[te])
        arr.append(p)
        print("  %s seed %d done (%.0f s)" % (kind, sd, time.time() - t0), flush=True)
    full = np.full(len(T), np.nan)
    full[te] = ml2.sig(np.mean(ml2.logit(np.vstack(arr), 1e-6), axis=0))
    preds[kind] = full
    ref = F["preds"][kind + "|static"]
    dd = [abs(full[pos[f]] - ref[fpos[f]]) for f in F["fid"] if f in pos and 2024 <= yr[pos[f]] <= 2025 and not np.isnan(ref[fpos[f]])]
    checks[kind + "_static_retrain_vs_fitpkl_2024_25_max_abs"] = [len(dd), float(max(dd))]
    print("%s static retrain vs fit.pkl on 2024-25: n %d max |diff| %.2e" % (kind, len(dd), max(dd)), flush=True)
w = np.asarray(F["blend_w"], float)
Zs = np.c_[ml2.logit(p_static, 1e-6), ml2.logit(preds["lgb"], 1e-6), ml2.logit(preds["xgb"], 1e-6)]
blend_static = ml2.sig(Zs @ w)
dd = [abs(blend_static[pos[f]] - F["preds"]["blend|static"][fpos[f]]) for f in F["fid"] if f in pos and 2024 <= yr[pos[f]] <= 2025]
checks["blend_static_vs_fitpkl_2024_25_max_abs"] = [len(dd), float(np.nanmax(dd))]

# ---------------------------------------------------------------- 4. S, S2, S2+ml2win cells (2024 fold: fit < 2024)
MT, FX, FY, Ym = D["T"], D["FX"], D["FY"], D["y"]
chosen = json.load(open(os.path.join(ROOT, "data", "derived", "methodround.json")))["meta"]["chosen"]
draw_c = chosen["draw_c"]
Fx = {"preds": {}}
n2 = len(T)
for key, arr_new in (("lr|static", p_static), ("blend|static", blend_static)):
    v = arr_new.copy()
    Fx["preds"][key] = v
for key in ("lr|oof", "blend|oof"):
    v = np.full(n2, np.nan)
    ref = F["preds"][key]
    for f, i in fpos.items():
        if f in pos:
            v[pos[f]] = ref[i]
    Fx["preds"][key] = v
nX, nY, pwin, okz = ml2.method_new_cols(MT, T, Fx, C["lr"]["tau"], pm)
FX2, FY2 = pd.concat([FX, nX], axis=1), pd.concat([FY, nY], axis=1)
stat, new = D["stat_cols"], list(nX.columns)
myr = MT["year"].to_numpy()
trm = (myr < 2024)
va = (myr >= 2024)
hz = MR.HazardModel(MR.HAZ_COLS, C=chosen["C_haz"], C_dec=MR.C_DEC).fit(MT[trm & (myr >= MR.HAZ_START)], FX[trm & (myr >= MR.HAZ_START)],
                                                                      FY[trm & (myr >= MR.HAZ_START)], Ym[trm & (myr >= MR.HAZ_START)])
H = np.zeros((len(MT), MR.NC_))
H[va] = hz.predict(MT[va], FX[va], FY[va])
c6s2 = J2["method"]["chosen_C6_S2"]


def fit6(cols_, Cc, fxx, fyy):
    tr6 = trm & (myr >= 2012)
    m = MR.C6Logit(cols_, C=Cc, hl_years=MR.HL_YEARS).fit(MT[tr6], fxx[tr6], fyy[tr6], Ym[tr6])
    P6 = np.full((len(MT), 6), np.nan)
    P6[va] = m.predict6(MT[va], fxx[va], fyy[va])
    return P6


P6 = {"S": fit6(stat, chosen["C6_S"], FX, FY), "S2": fit6(stat + new, c6s2, FX2, FY2)}
P6["S2+ml2win"] = MR.reweight_winner(P6["S2"], pwin)
Jc = {k: MR.joint_from_c6(v, H, draw_c) for k, v in P6.items()}
mrj = json.load(open(os.path.join(ROOT, "data", "derived", "methodround.json")))["fights"]
mid = MT["id"].tolist()


def compact(cells23, R):
    """methodround's 23-cell layout (5-round slots) -> compact list A KO r1..R, A SUB r1..R, B KO, B SUB, A DEC, B DEC, DRAW"""
    c = np.asarray(cells23, float)
    return (list(c[0:R]) + list(c[5:5 + R]) + list(c[10:10 + R]) + list(c[15:15 + R]) + [c[20], c[21], c[22]])


dS_val, dS_vault = [], []
out = {}
for i, f in enumerate(mid):
    if not va[i]:
        continue
    R = 5 if int(MT["rounds"].iloc[i]) == 5 else 3
    cS = compact(Jc["S"][i], R)
    ref = mrj.get(f, {}).get("S")
    if ref is not None and len(ref) == len(cS):
        dd_ = float(np.max(np.abs(np.asarray(cS) - np.asarray(ref))))
        (dS_vault if f in vault_ids else dS_val).append(dd_)
    if f in vault_ids:
        out[f] = {"cells": {k: [round(float(x), 6) for x in compact(Jc[k][i], R)] for k in Jc}, "rounds": R}
checks["S_refit_vs_methodround_json_S_2024_25_max_abs"] = [len(dS_val), float(max(dS_val)) if dS_val else None]
checks["S_refit_vs_methodround_json_S_vault_max_abs"] = [len(dS_vault), float(max(dS_vault)) if dS_vault else None]
print("S (fit<2024) vs methodround.json S: 2024-25 n %d max %.2e; vault n %d max %.2e" % (
    len(dS_val), max(dS_val) if dS_val else -1, len(dS_vault), max(dS_vault) if dS_vault else -1), flush=True)
for f in vault_ids:
    if f not in pos:
        continue
    i = pos[f]
    e = out.setdefault(f, {})
    e.update({"ml2_lr_prod": round(float(p_prod[i]), 6), "ml2_lr_static": round(float(p_static[i]), 6),
              "ml2_blend_static": round(float(blend_static[i]), 6),
              "mr": None if np.isnan(T["mr_p"].iloc[i]) else round(float(T["mr_p"].iloc[i]), 6),
              "slug_a": T["slug_a"].iloc[i] if "slug_a" in T else None})
# market rating vs market_vault p_market_rating (independent build by tools/market.py)
dm = [abs(out[f]["mr"] - MV[f]["p_market_rating"]) for f in out if out[f].get("mr") is not None and MV.get(f, {}).get("p_market_rating") is not None]
checks["vault_mr_vs_market_vault_max_abs"] = [len(dm), float(max(dm)) if dm else None]
rv = json.load(open(os.path.join(a.vault, "ratings_vault.json")))["fights"]
dr = [abs(T["r_whr_rounds"].iloc[pos[f]] - rv[f]["p"]["whr_rounds"]) for f in rv if f in pos]
checks["vault_whr_rounds_vs_ratings_vault_max_abs"] = [len(dr), float(max(dr)) if dr else None]
res = {"meta": {"tool": "tools/vault_audit1/ml2_vault.py", "built": dt.datetime.now(dt.timezone.utc).isoformat(),
                "wall_s": round(time.time() - t0, 1), "checks": checks,
                "missing_vault_fights": sorted(set(vault_ids) - set(out)),
                "notes": "ml2_lr_prod = ml2.json page_model terms (fit 2010-2025); ml2_lr_static = fit.pkl lr|static (fit 2010-2023); "
                         "ml2_blend_static = static LR + retrained LGB/XGB (frozen config/seeds, fit < 2024) with fit.pkl blend_w; "
                         "cells S / S2 / S2+ml2win = stage_method's 2024 fold (fit < 2024); mr = walk-forward market rating"},
       "fights": out}
json.dump(res, open(os.path.join(AUD, "ml2_vault.json"), "w"), separators=(",", ":"))
print(json.dumps(checks, indent=1))
print("wrote %s: %d vault fights (%.0f s)" % (os.path.join(AUD, "ml2_vault.json"), len(out), time.time() - t0))
