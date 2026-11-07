#!/usr/bin/env python3
"""v6_embed_fh.py: the v6 review gate (1), second half: the engine's embedding-blend calibration fit FOLD-HONESTLY.

The embedding blend (engine component embed; recipe link(rate) = b0 + b1 link(mlrates rate) + b2 eta_embedding[task],
b2 = 0 where CV dropped the term) is fit on mlrates' 2019-2023 out-of-fold rows. tools/embed_blend_loyo.py gives each
train fight the recipe refit WITHOUT its year (leave-one-year-out: later years included), on the pooled-weight OOF rates.
Here each year y gets the recipe fit on the rows of 2019..y-1 only, built on the fold-honest learned rates
(data/derived/mlrates_oof_fh.json, tools/v6_foldhonest.py):
  - 2019 has no earlier row: identity recipe (b0 0, b1 1, b2 0: the raw learned rates, no embedding term);
  - 2020..2023: expanding fits; '2024' (used for 2024-2025 by the v6 harness) = the fit on all of 2019-2023.
The keep set (which targets carry b2) stays the exported recipe's. Output: data/derived/embed_blend_fh.json
{ coef_fh: { year: { target: { task, link, units, b } } }, meta }. Nothing dated 2024-01-01 or later is read.

    nice -n 5 python3 tools/v6_embed_fh.py
"""
from __future__ import annotations

import datetime as dt
import json
import os
import subprocess
import sys
import tempfile
from collections import defaultdict

for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "1")
import numpy as np  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import embed_blend_loyo as EB  # noqa: E402

DER = os.path.join(ROOT, "data", "derived")
YEARS = [2019, 2020, 2021, 2022, 2023]


def main():
    bt = json.load(open(os.path.join(DER, "backtest_dev.json")))
    fights = {f["id"]: f for f in bt["fights"] if EB.TRAIN[0] <= f["date"] < EB.TRAIN[1]}
    oof = json.load(open(os.path.join(DER, "mlrates_oof_fh.json")))
    targets = oof["meta"]["targets"]
    model = json.load(open(os.path.join(DER, "embed_model.json")))
    recipe = model["mlrates_blend"]["targets"]
    tasks = [t[0] for t in model["tasks"]]
    task_bin = {t[0]: t[1] == "bin" for t in model["tasks"]}
    with tempfile.TemporaryDirectory() as td:
        dump = os.path.join(td, "etas.json")
        subprocess.run(["node", os.path.join(HERE, "mlpathrec.js"), "--dump-embed-train", dump], check=True, stdout=subprocess.DEVNULL)
        etas = json.load(open(dump))
    act, KI, src = EB.load_rows()
    R, miss = [], defaultdict(int)
    for fid, f in sorted(fights.items()):
        o, e, a = oof["fights"].get(fid), etas["fights"].get(fid), act.get(fid)
        if not o or not o.get("A") or not o.get("B") or not str(o.get("src", "")).startswith("cv"):
            miss["oof"] += 1
            continue
        if not e:
            miss["eta"] += 1
            continue
        if not a:
            miss["actual"] += 1
            continue
        v, mins = a
        for s, tag in ((0, "A"), (1, "B")):
            R.append((int(f["date"][:4]), o[tag], e["eta" + tag], v[s], float(mins)))
    yrs = np.array([r[0] for r in R])
    ML = np.array([r[1] for r in R], float)
    ETA = np.array([r[2] for r in R], float)
    keep = {t: abs(recipe[t]["b"][2]) > 0 for t in targets}
    coef = {str(y): {} for y in YEARS + [2024]}
    dev = {"fh": 0.0, "raw": 0.0}
    for k, tn in enumerate(targets):
        num, ex = EB.TGT[tn]
        y = np.array([r[3][KI[num]] for r in R], float)
        n = np.array([r[4] if ex == "min" else r[3][KI[ex]] for r in R], float)
        if tn == "ctrl":
            y = y / 60.0
        ok = n > 0
        task = recipe[tn]["task"]
        lm, binom = EB.blend_link(tn, task_bin[task], ML[:, k])
        le = ETA[:, tasks.index(task)]
        one = np.ones(len(y))
        Zb = np.c_[one, lm, le] if keep[tn] else np.c_[one, lm]
        for vy in YEARS + [2024]:
            a = ok & (yrs < vy)
            if not a.any():
                b = np.array([0.0, 1.0, 0.0])
            else:
                b = EB.glm_newton(Zb[a], y[a], n[a], binom)
                b = b if keep[tn] else np.r_[b, 0.0]
            coef[str(vy)][tn] = {"task": task, "link": recipe[tn]["link"], "units": recipe[tn]["units"],
                                 "b": [round(float(x), 6) for x in b]}
            if vy <= 2023:
                m = ok & (yrs == vy)
                Zs = np.c_[one, lm, le]
                dev["fh"] += float(EB.dev1(y[m], n[m], Zs[m] @ b, binom).sum())
                dev["raw"] += float(EB.dev1(y[m], n[m], lm[m], binom).sum())
    out = {"meta": {"tool": "tools/v6_embed_fh.py", "built": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
                    "window": "TRAIN 2019-01-01..2023-12-31 (backtest_dev.json); nothing dated 2024-01-01 or later is read",
                    "inputs": "mlrates_oof_fh.json (fold-honest stack weights), embedding etas (tools/mlpathrec.js), "
                              "tools/mlrates.py directed counts (%s)" % src, "rows": len(R), "skipped": dict(miss),
                    "rule": "coef_fh[y] fit on 2019..y-1 rows; 2019 = identity (no earlier row); '2024' = fit on 2019-2023 "
                            "(the v6 harness's recipe for 2024-2025); keep set = the exported recipe's",
                    "summed_deviance_2019_2023": {"fold_honest_recipe": round(dev["fh"], 2), "raw_rates": round(dev["raw"], 2)}},
           "coef_fh": coef}
    json.dump(out, open(os.path.join(DER, "embed_blend_fh.json"), "w"), indent=1)
    print("wrote data/derived/embed_blend_fh.json (%d rows); summed deviance 2019-2023: fold-honest recipe %.1f vs raw %.1f" % (
        len(R), dev["fh"], dev["raw"]))


if __name__ == "__main__":
    main()
