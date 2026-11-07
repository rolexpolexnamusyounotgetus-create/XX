#!/usr/bin/env python3
"""VAULT AUDIT 2 (auditor only): ML v2 and method/round inputs for the sealed 2026 fights, fit through 2025-12-31 by the
frozen production procedures (data/derived/version_history.json vault_audits[1].fits). Nothing is tuned; every fit below
is a frozen specification whose production object exists in the repository, and each is checked against it.

    nice -n 5 python3 tools/vault_audit2/ml2s2_vault.py [--vault <dir>]

Inputs: the ML v2 feature table that vault audit 1 built with ml2's own builders and the parse cutoff moved to 2026-11-01
(<vault>/audit1/ml2_cache/table_vault.pkl; pre-2026 rows checked there against the frozen table), methodround's table
(MR.prepare with the same moved cutoff), out/ml2_cache/{cv.json, fit.pkl}.

1. ML v2 logistic, production: ml2.json page_model terms (fit 2010-2025).
2. ML v2 blend, production: the page logistic + LightGBM / XGBoost refit with the frozen configuration on every decisive
   fight before 2026-01-01 (tools/v6_trees.py's procedure = data/derived/ml2_trees.json); check: the 40 exported vectors
   (design rows and per-model outputs) are reproduced; blend weights ml2_trees.json blend_w.
3. S fit through 2025-12-31 (methodround stage-method fold 2026: hazard 2008..2025, six-class 2012..2025); check vs
   methodround.json S_refit on the vault fights.
4. S2 production: data/derived/mr_s2.json js_model (fit 2012..2025, hazard 2008..2025) evaluated by tools/methodround_model.js
   createS2 on the vault fights' feature rows (DA / DB). The ML v2 columns of a 2026 row use the production logistic (the latest
   fit before the scored year, as 2024-25 rows use the fit through 2023). Check: a Python refit of the same specification on
   2012..2025 rows reproduces js_model's coefficients, and its vault cells equal the JS cells.
Output: <vault>/audit2/ml2s2_vault.json. Never writes inside the repository.
"""
import argparse
import datetime as dt
import json
import os
import pickle
import shutil
import subprocess
import sys
import tempfile
import time

for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "1")
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
ap = argparse.ArgumentParser()
ap.add_argument("--vault", default="/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vault")
a = ap.parse_args()
AUD1 = os.path.join(a.vault, "audit1")
AUD = os.path.join(a.vault, "audit2")
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
checks = {}

# ---------------------------------------------------------------- tables
T = pickle.load(open(os.path.join(AUD1, "ml2_cache", "table_vault.pkl"), "rb"))["T"]
ml2.VAULT, ml2.VAULT_S = CUT, CUT_S
try:
    import methodround as MR
    D = MR.prepare(False)
finally:
    ml2.VAULT, ml2.VAULT_S = DEV_VAULT, DEV_VAULT_S
print("tables: ML v2 %s (max %s), methodround %s (max %s) (%.0f s)" % (T.shape, T["date"].max(), D["T"].shape, D["T"]["date"].max(), time.time() - t0), flush=True)
C = json.load(open(os.path.join(CACHE, "cv.json")))
pm = C["pre_means"]
X = ml2.superset_matrix(T, pm)
cols = C["lr"]["cols"]
fid = T["fid"].tolist()
pos = {f: i for i, f in enumerate(fid)}
yr = T["year"].to_numpy()
vault = {f["id"]: f for f in json.load(open(os.path.join(a.vault, "backtest_vault.json")))["fights"]}

# ---------------------------------------------------------------- 1. production logistic
J2 = json.load(open(os.path.join(ROOT, "data", "derived", "ml2.json")))
terms = {t["name"]: t["coef"] for t in J2["page_model"]["terms"]}
c_prod = np.array([terms[c] for c in cols], float)
Xc = X[cols].to_numpy(float)
p_prod = 1 / (1 + np.exp(-(Xc @ c_prod)))
F = pickle.load(open(os.path.join(CACHE, "fit.pkl"), "rb"))

# ---------------------------------------------------------------- 2. production trees (frozen config, rows < 2026)
y = T["y"].fillna(0.5).to_numpy(float)
G0, G1 = ml2.tree_mats(T, X, cols)
tr = ml2.train_mask(T, dt.date(2026, 1, 1), C["lr"])
checks["tree_train_rows"] = int(tr.sum())
TJ = json.load(open(os.path.join(ROOT, "data", "derived", "ml2_trees.json")))
checks["ml2_trees_n_train"] = TJ["meta"]["n_train"]
vec_ids = [v["id"] for v in TJ["vectors"]]
vi = np.array([pos[i] for i in vec_ids])
G0a, G1a = np.asarray(G0, float), np.asarray(G1, float)
checks["vector_design_max_abs_g0"] = float(max(np.nanmax(np.abs(np.asarray(v["g0"], float) - G0a[pos[v["id"]]])) for v in TJ["vectors"]))
checks["vector_design_max_abs_g1"] = float(max(np.nanmax(np.abs(np.asarray(v["g1"], float) - G1a[pos[v["id"]]])) for v in TJ["vectors"]))
te = np.array([f in vault for f in fid]) | np.isin(np.arange(len(fid)), vi)
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
    full = np.full(len(T), np.nan)
    full[te] = ml2.sig(np.mean(ml2.logit(np.vstack(arr), 1e-6), axis=0))
    preds[kind] = full
    checks[kind + "_vs_ml2_trees_vectors_max_abs"] = float(max(abs(full[pos[v["id"]]] - v[kind]) for v in TJ["vectors"]))
    print("%s production refit: vs ml2_trees.json vectors max |diff| %.2e (%.0f s)" % (kind, checks[kind + "_vs_ml2_trees_vectors_max_abs"], time.time() - t0), flush=True)
bw = TJ["blend_w"]
checks["blend_w_vs_fitpkl_max_abs"] = float(np.max(np.abs(np.asarray([bw["lr"], bw["lgb"], bw["xgb"]]) - np.asarray(F["blend_w"], float))))
blend_prod = ml2.sig(bw["lr"] * ml2.logit(p_prod, 1e-6) + bw["lgb"] * ml2.logit(preds["lgb"], 1e-6) + bw["xgb"] * ml2.logit(preds["xgb"], 1e-6))

# ---------------------------------------------------------------- 3 / 4. method / round
MT, FX, FY, Ym = D["T"], D["FX"], D["FY"], D["y"]
chosen = json.load(open(os.path.join(ROOT, "data", "derived", "methodround.json")))["meta"]["chosen"]
mrj = json.load(open(os.path.join(ROOT, "data", "derived", "methodround.json")))["fights"]
S2J = json.load(open(os.path.join(ROOT, "data", "derived", "mr_s2.json")))["js_model"]
n2 = len(T)
Fx = {"preds": {}}
fpos = {f: i for i, f in enumerate(F["fid"])}
for key in ("lr|oof", "blend|oof", "lr|static", "blend|static"):
    v = np.full(n2, np.nan)
    ref = F["preds"][key]
    for f, i in fpos.items():
        if f in pos:
            v[pos[f]] = ref[i]
    Fx["preds"][key] = v
# 2026 rows: the latest fit before the scored year (production, fit through 2025), as 2024-25 rows use the fit through 2023
v26 = (yr >= 2026)
Fx["preds"]["lr|static"] = np.where(v26, p_prod, Fx["preds"]["lr|static"])
Fx["preds"]["blend|static"] = np.where(v26, blend_prod, Fx["preds"]["blend|static"])
nX, nY, pwin, okz = ml2.method_new_cols(MT, T, Fx, C["lr"]["tau"], pm)
FX2, FY2 = pd.concat([FX, nX], axis=1), pd.concat([FY, nY], axis=1)
stat, new = D["stat_cols"], list(nX.columns)
myr = MT["year"].to_numpy()
trm = (myr <= 2025)
va = (myr >= 2026)
hz = MR.HazardModel(MR.HAZ_COLS, C=chosen["C_haz"], C_dec=MR.C_DEC).fit(MT[trm & (myr >= MR.HAZ_START)], FX[trm & (myr >= MR.HAZ_START)],
                                                                      FY[trm & (myr >= MR.HAZ_START)], Ym[trm & (myr >= MR.HAZ_START)])
H = np.zeros((len(MT), MR.NC_))
H[va] = hz.predict(MT[va], FX[va], FY[va])
c6s2 = J2["method"]["chosen_C6_S2"]
tr6 = trm & (myr >= 2012)
mS = MR.C6Logit(stat, C=chosen["C6_S"], hl_years=MR.HL_YEARS).fit(MT[tr6], FX[tr6], FY[tr6], Ym[tr6])
mS2 = MR.C6Logit(stat + new, C=c6s2, hl_years=MR.HL_YEARS).fit(MT[tr6], FX2[tr6], FY2[tr6], Ym[tr6])
P6S = np.full((len(MT), 6), np.nan)
P6S2 = np.full((len(MT), 6), np.nan)
P6S[va] = mS.predict6(MT[va], FX[va], FY[va])
P6S2[va] = mS2.predict6(MT[va], FX2[va], FY2[va])
JS = MR.joint_from_c6(P6S, H, chosen["draw_c"])
JS2 = MR.joint_from_c6(P6S2, H, chosen["draw_c"])
# refit vs the exported production S2 (js_model)
checks["s2_refit_vs_js_model_c6_coef_max_abs"] = float(np.max(np.abs(np.asarray(mS2.lr.coef_) - np.asarray(S2J["c6"]["coef"]))))
checks["s2_refit_vs_js_model_c6_cols_equal"] = list(stat + new) == list(S2J["c6"]["cols"])
checks["s2_refit_vs_js_model_hazard_coef_max_abs"] = float(np.max(np.abs(np.asarray(hz.lr.coef_) - np.asarray(S2J["hazard"]["coef"]))))
checks["draw_c_methodround_vs_js_model"] = [chosen["draw_c"], S2J["draw_c"], float(hz.draw_c)]


def compact(cells23, R):
    c = np.asarray(cells23, float)
    return list(c[0:R]) + list(c[5:5 + R]) + list(c[10:10 + R]) + list(c[15:15 + R]) + [c[20], c[21], c[22]]


mid = MT["id"].tolist()
need = sorted(set(stat + new) | set(MR.HAZ_COLS) | set(S2J["c6"]["cols"]) | set(S2J["hazard"]["cols"]))
rows, out, dS = {}, {}, []
for i, f in enumerate(mid):
    if not va[i] or f not in vault:
        continue
    R = 5 if int(MT["rounds"].iloc[i]) == 5 else 3
    rows[f] = {"R": R, "DA": {c: float(FX2[c].iloc[i]) for c in need}, "DB": {c: float(FY2[c].iloc[i]) for c in need}}
    cS = compact(JS[i], R)
    ref = (mrj.get(f) or {}).get("S_refit")
    if ref is not None and len(ref) == len(cS):
        dS.append(float(np.max(np.abs(np.asarray(cS) - np.asarray(ref)))))
    out[f] = {"rounds": R, "S_fit2025_py": [round(float(x), 7) for x in cS], "S2_py": [round(float(x), 7) for x in compact(JS2[i], R)]}
checks["S_fit2025_vs_methodround_json_S_refit_vault_max_abs"] = [len(dS), float(max(dS)) if dS else None]
# JS evaluation of the exported production S2 (the object the frozen packages carry)
with tempfile.TemporaryDirectory() as td:
    inp, outp = os.path.join(td, "rows.json"), os.path.join(td, "cells.json")
    json.dump(rows, open(inp, "w"))
    js = ("const MR=require(process.argv[1]);const fs=require('fs');const S2=JSON.parse(fs.readFileSync(process.argv[2],'utf8')).js_model;"
          "const m=MR.createS2(S2);const R=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));const o={};"
          "let vmax=0;for(const v of S2.vectors){const r=m.fromFeatures(v.DA,v.DB,v.rounds);for(let i=0;i<23;i++)vmax=Math.max(vmax,Math.abs(r.joint23[i]-v.joint23[i]));}"
          "for(const id in R){const r=m.fromFeatures(R[id].DA,R[id].DB,R[id].R);const s=r.cells.reduce((a,b)=>a+b,0);o[id]=r.cells.map(x=>x/s);}"
          "fs.writeFileSync(process.argv[4],JSON.stringify({cells:o,vectors_max_abs:vmax}));")
    subprocess.run(["node", "-e", js, os.path.join(ROOT, "tools", "methodround_model.js"), os.path.join(ROOT, "data", "derived", "mr_s2.json"), inp, outp], check=True)
    JR = json.load(open(outp))
checks["s2_js_vs_js_model_vectors_max_abs"] = JR["vectors_max_abs"]
dd = []
for f, c in JR["cells"].items():
    out[f]["S2"] = [round(float(x), 9) for x in c]
    py = np.asarray(out[f]["S2_py"], float)
    dd.append(float(np.max(np.abs(np.asarray(c) - py / py.sum()))))
checks["s2_js_cells_vs_python_refit_vault_max_abs"] = [len(dd), max(dd) if dd else None]
for f in vault:
    if f not in pos:
        continue
    i = pos[f]
    e = out.setdefault(f, {})
    e.update({"ml2_lr_prod": float(p_prod[i]), "ml2_blend_prod": float(blend_prod[i]), "lgb_prod": float(preds["lgb"][i]), "xgb_prod": float(preds["xgb"][i]),
              "mr": None if np.isnan(T["mr_p"].iloc[i]) else float(T["mr_p"].iloc[i])})
# audit 1's ml2_vault.json production logistic must be the same numbers
A1 = json.load(open(os.path.join(AUD1, "ml2_vault.json")))["fights"]
checks["ml2_lr_prod_vs_audit1_max_abs"] = float(max(abs(out[f]["ml2_lr_prod"] - A1[f]["ml2_lr_prod"]) for f in out if f in A1 and "ml2_lr_prod" in out[f]))
missing = sorted(f for f in vault if not (out.get(f) or {}).get("S2") or "ml2_blend_prod" not in (out.get(f) or {}))
res = {"meta": {"tool": "tools/vault_audit2/ml2s2_vault.py", "built": dt.datetime.now(dt.timezone.utc).isoformat(), "wall_s": round(time.time() - t0, 1),
                "checks": checks, "missing_vault_fights": missing,
                "notes": "ml2_lr_prod = ml2.json page_model (fit 2010-2025); ml2_blend_prod = page LR + LGB/XGB refit on rows < 2026 with the frozen "
                         "configuration (= ml2_trees.json, checked on its 40 vectors) with ml2_trees blend_w; S2 = mr_s2.json js_model (production, fit "
                         "2012..2025) evaluated in JS; S_fit2025_py = methodround S refit through 2025 (check vs methodround.json S_refit); "
                         "cells in FightBlend layout [A KO r1..R, A SUB r1..R, B KO, B SUB, A DEC, B DEC, DRAW]"},
       "fights": out}
json.dump(res, open(os.path.join(AUD, "ml2s2_vault.json"), "w"), separators=(",", ":"))
print(json.dumps(checks, indent=1))
print("wrote %s: %d vault fights, %d missing (%.0f s)" % (os.path.join(AUD, "ml2s2_vault.json"), len(out), len(missing), time.time() - t0))
