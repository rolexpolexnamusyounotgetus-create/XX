#!/usr/bin/env python3
"""v8_statlines_folds.py: leak-free statlines tables for engine v8's realised-rate retarget (docs/V6_V10_PLAN.md cycle 3;
research/model_statlines.md "Use": the v8 retarget pass targets the verified distributional stat-line layer).

The exported statlines model "dev" (data/derived/statlines.json) is fit on 2019-2023, so on train fights it is in-sample. The
v8 train gate therefore uses forward-chained fold tables, built by statlines' own code with its PRE-REGISTERED per-stat choice
(statlines.json choice_js; nothing is re-selected here):
    f2020  second stage fit on 2019            -> targets for 2020 fights
    f2021  fit on 2019-2020                     -> 2021 fights
    f2022  fit on 2019-2021                     -> 2022 fights
    f2023  fit on 2019-2022                     -> 2023 fights
    dev    fit on 2019-2023 (= statlines.json models.dev, reproduced and checked)  -> 2024-2025 fights (validation look only)
2019 fights get no table (no earlier 2019+ row to fit on): the retarget stays off for them (flagged in the targets file).
Exactly the folds statlines' own CV used (statlines_oof.json sets cv2020 / cv / valid), so the fold tables are checked against
the stored out-of-fold distributions.

Inputs per backtest fight (backtest_dev.json orientation, A attacking B and B attacking A): statlines' row table (mlrates
out-of-fold rates, embedding snapshot etas, oppadj snapshots, the embedding win logit), via statlines.row_input. Nothing dated
2026-01-01 or later is read (statlines drops it at load and asserts).

    STATLINES_CACHE=out/v8_statlines_cache nice -n 5 python3 tools/statlines.py build
    STATLINES_CACHE=out/v8_statlines_cache nice -n 5 python3 tools/v8_statlines_folds.py
    node tools/v8_targets.js        (per-minute engine targets at full length with src/ml/statdist.js engineTargets)

Writes data/derived/v8/statlines_folds.json (StatDist-loadable: models f2020..f2023, dev) and data/derived/v8/statlines_inputs.json.
"""
import os

for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "1")
import datetime as dt
import json
import math
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
os.environ.setdefault("STATLINES_CACHE", os.path.join(ROOT, "out", "v8_statlines_cache"))
import statlines as S  # noqa: E402

DER = os.path.join(ROOT, "data", "derived")
OUT = os.path.join(DER, "v8")
FOLDS = {"f2020": (2019, 2019), "f2021": (2019, 2020), "f2022": (2019, 2021), "f2023": (2019, 2022), "dev": (2019, 2023)}


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def rel(a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    return float(np.max(np.abs(a - b) / np.maximum(np.abs(b), 1e-6))) if a.size else 0.0


def main():
    os.makedirs(OUT, exist_ok=True)
    t0 = time.time()
    T = S.load_table()
    assert max(T["date"]) < S.VAULT_FROM, "a 2026 row in the statlines table"
    SJ = json.load(open(os.path.join(DER, "statlines.json")))
    ch = SJ["choice_js"]
    yr = T["year"]
    models, fits = {}, {}
    for lab, (y0, y1) in FOLDS.items():
        tr = (yr >= y0) & (yr <= y1)
        Fd = S.Fold(T, tr)
        ms = S.fit_set(T, Fd, np.flatnonzero(tr), ch)
        J = S.export_set(Fd, ms, "%d-01-01..%d-12-31" % (y0, y1))
        models[lab] = J
        fits[lab] = (Fd, ms)
        log("fold %s fit on %d-%d: %d rows" % (lab, y0, y1, int(tr.sum())))
    # ---- check 1: the dev refit reproduces the exported statlines.json models.dev
    D0, D1 = SJ["models"]["dev"], models["dev"]
    worst = {"glm_mu": rel(D1["glm_mu"], D0["glm_mu"]), "glm_sd": rel(D1["glm_sd"], D0["glm_sd"])}
    for st in S.STATS:
        for k in ("b", "g", "d"):
            worst["%s.%s" % (st, k)] = rel(D1["stats"][st][k], D0["stats"][st][k])
    for t in S.MLT:
        for k in ("emb", "noemb"):
            if D0["blend"][t][k] is not None:
                worst["blend.%s.%s" % (t, k)] = rel(D1["blend"][t][k], D0["blend"][t][k])
    dev_repro = max(worst.values())
    log("dev refit vs statlines.json models.dev: max relative coefficient difference %.3g" % dev_repro)
    assert dev_repro < 1e-4, "dev refit does not reproduce statlines.json (%s)" % sorted(worst.items(), key=lambda x: -x[1])[:3]
    # ---- check 2: the fold tables reproduce the stored out-of-fold distributions (statlines_oof.json, 4 significant digits)
    OOF = json.load(open(os.path.join(DER, "statlines_oof.json")))["fights"]
    fold_of_year = {2020: "f2020", 2021: "f2021", 2022: "f2022", 2023: "f2023", 2024: "dev", 2025: "dev"}
    rows_by = {}
    for i, (fid, sd) in enumerate(zip(T["fid"], T["side"])):
        rows_by.setdefault(fid, {})[int(sd)] = i
    oof_worst, n_chk = 0.0, 0
    rng = np.random.default_rng(8)
    sample = [f for f in OOF if OOF[f]["set"] in ("cv2020", "cv", "valid")]
    sample = [sample[j] for j in rng.choice(len(sample), 120, replace=False)]
    for fid in sample:
        o = OOF[fid]
        y = int(o["date"][:4])
        Fd, ms = fits[fold_of_year[y]]
        for sd, key in ((0, "A"), (1, "B")):
            i = rows_by[fid][sd]
            for st in S.STATS:
                d = ms[st].dist(np.array([i]), np.array([T["t"][i]]))
                par = S.par_list(d.kind, d.p, 0)
                ref = o[key][st][:len(par)]
                for a, b in zip(par, ref):
                    if a is None or b is None:
                        continue
                    oof_worst = max(oof_worst, abs(a - b) / max(abs(b), 1e-4))
                    n_chk += 1
    log("fold tables vs statlines_oof.json: %d parameters, max relative difference %.3g (stored at 4 significant digits)" % (n_chk, oof_worst))
    assert oof_worst < 2e-3, "fold tables do not reproduce statlines_oof.json"
    # ---- per-fight inputs in backtest_dev orientation
    bt = json.load(open(os.path.join(DER, "backtest_dev.json")))
    btf = {f["id"]: f for f in bt["fights"] if f["date"] < S.VAULT_FROM}
    inputs, side_ok, n_side = {}, 0, 0
    for fid in sorted(T["bt_ids"]):
        f = btf.get(fid)
        if f is None or fid not in rows_by or len(rows_by[fid]) != 2:
            continue
        assert f["date"] < S.VAULT_FROM
        iA, iB = rows_by[fid][0], rows_by[fid][1]
        # side 0 must be backtest A: check the actual lines
        if f.get("actual") and f["actual"].get("A"):
            n_side += 1
            if abs(T["Y"][iA, S.SI["sig_lnd"]] - f["actual"]["A"]["sig_lnd"]) < 1e-9 and abs(T["Y"][iB, S.SI["sig_lnd"]] - f["actual"]["B"]["sig_lnd"]) < 1e-9:
                side_ok += 1
        rA = S.row_input(T, iA)
        rB = S.row_input(T, iB)
        y = int(f["date"][:4])
        inputs[fid] = {"date": f["date"], "rounds": int(rA["rounds"]), "fold": fold_of_year.get(y),
                       "mlA": rA["ml"], "mlB": rA["mlo"], "etaA": rA["eta"], "etaB": rA["etao"], "hasEmb": bool(rA["has_emb"]),
                       "winLogit": rA["win_logit"], "oppA": rA["opp"], "oppB": rA["oppo"],
                       "_mirror_ok": bool(np.allclose(rB["ml"], rA["mlo"]) and abs(rB["win_logit"] + rA["win_logit"]) < 1e-9)}
    assert side_ok == n_side, "side 0 is not backtest A on %d fights" % (n_side - side_ok)
    n_mirror = sum(1 for v in inputs.values() if v["_mirror_ok"])
    log("inputs: %d backtest fights (side check %d/%d, mirror check %d)" % (len(inputs), side_ok, n_side, n_mirror))
    # ---- python reference targets (per-minute rate at full length t = 5R, the went-the-distance condition) for a sample
    ref = {}
    for fid in list(sorted(inputs))[::40]:
        v = inputs[fid]
        if not v["fold"]:
            continue
        J = dict(models[v["fold"]], _ti=T["TI"])
        R = v["rounds"]
        tt = 5.0 * R
        out = {}
        for key, inp in (("A", {"ml": v["mlA"], "mlo": v["mlB"], "eta": v["etaA"], "etao": v["etaB"], "has_emb": v["hasEmb"],
                               "win_logit": v["winLogit"], "opp": v["oppA"], "oppo": v["oppB"], "rounds": R}),
                         ("B", {"ml": v["mlB"], "mlo": v["mlA"], "eta": v["etaB"], "etao": v["etaA"], "has_emb": v["hasEmb"],
                                "win_logit": -v["winLogit"], "opp": v["oppB"], "oppo": v["oppA"], "rounds": R})):
            out[key] = {}
            for st in S.STATS:
                kind, p = S.py_eval(J, inp, st, tt)
                if kind == "zibeta":
                    mean = (1 - p["pi"]) * p["m"] * p["cap"]
                elif kind == "zinb":
                    mean = (1 - p["pi"]) * p["mu"]
                else:
                    mean = p["mu"]
                out[key][st] = float(mean / tt)
        ref[fid] = out
    folds_json = {k: SJ[k] for k in ("stats", "labels", "mlrates_targets", "glm_names", "glm_oppadj", "glm_extra", "embed_tasks",
                                    "finish_time", "choice_js")}
    folds_json["meta"] = {"tool": "tools/v8_statlines_folds.py", "built": dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
                          "what": "statlines model tables (src/ml/statdist.js format) fit forward-chained on 2019..Y-1 with the "
                                  "pre-registered statlines choice_js, for engine v8's leak-free retarget on train; dev = 2019-2023 "
                                  "(= statlines.json models.dev)",
                          "folds": {k: "%d-%d" % v for k, v in FOLDS.items()},
                          "fold_of_year": {str(k): v for k, v in fold_of_year.items()},
                          "no_table": "2019 fights (no earlier 2019+ row): retarget off",
                          "checks": {"dev_refit_vs_statlines_json_max_rel": dev_repro,
                                     "folds_vs_statlines_oof_max_rel": oof_worst, "folds_vs_statlines_oof_n": n_chk},
                          "statlines_json_sha256_16": S.sha_file(os.path.join(DER, "statlines.json")),
                          "table_inputs": T["inputs"], "rule": "2026 fights dropped at load (asserted)"}
    folds_json["models"] = models
    with open(os.path.join(OUT, "statlines_folds.json"), "w") as fh:
        json.dump(S.finite_json(folds_json), fh)
    clean = {k: {kk: vv for kk, vv in v.items() if not kk.startswith("_")} for k, v in inputs.items()}
    with open(os.path.join(OUT, "statlines_inputs.json"), "w") as fh:
        json.dump({"meta": {"tool": "tools/v8_statlines_folds.py", "built": folds_json["meta"]["built"],
                            "what": "per-fight statdist inputs in backtest_dev orientation (A attacking B / B attacking A) from "
                                    "statlines' row table: mlrates out-of-fold rates, embedding snapshot etas, oppadj snapshots, win logit",
                            "fold": "statlines_folds.json model set per fight year (null for 2019)", "n": len(clean),
                            "python_reference_targets": "per-minute means at t = 5R for every 40th fight (tests/test_v8.js parity)"},
                   "fights": clean, "python_ref": ref}, fh)
    log("wrote data/derived/v8/statlines_folds.json and statlines_inputs.json (%.0f s)" % (time.time() - t0))


if __name__ == "__main__":
    main()
