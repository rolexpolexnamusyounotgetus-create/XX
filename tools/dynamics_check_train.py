#!/usr/bin/env python3
"""dynamics_check_train.py: the round-level acceptance check of research/model_dynamics.md (section 7) on TRAIN fights.

tools/dynamics.py's engine check compares engine-simulated rounds with real rounds of the same matchups on the
2024-2025 validation period. The hidden-data protocol keeps validation for version selection, so this wrapper runs
the very same estimators (dynamic random-effects output / accuracy decomposition, knockdown frailty Poisson, round
targets, late-round ratios, round correlations) on 2019-2023 fights only: the panel is cut to train rows before
anything else, and the engine CSVs come from tools/dynamics_bt.js (--csv, train fights, out-of-fold learned rates).

Usage: python3 tools/dynamics_check_train.py --out check.json label1=engine1.csv [label2=engine2.csv ...]
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import dynamics as dy  # noqa: E402


def summary(res):
    out = {}
    d = res["dynre"]["out"]
    out["out_engine"] = d["engine"]["var_components_null"]; out["out_real"] = d["real"]["var_components_null"]
    out["out_curve_engine"] = d["engine"]["round_curve"]; out["out_curve_real"] = d["real"]["round_curve"]
    a = res["dynre"]["acc"]
    out["acc_engine"] = a["engine"]["var_components_null"]; out["acc_real"] = a["real"]["var_components_null"]
    out["round_corr"] = res["round_correlations"]
    k = res["kd_hazard"]
    out["kd_frailty_engine"] = k["engine"]["null"].get("frailty_var"); out["kd_frailty_real"] = k["real"]["null"].get("frailty_var")
    out["kd_profile_engine"] = k["engine"]["null"].get("round_profile"); out["kd_profile_real"] = k["real"]["null"].get("round_profile")
    tg = res["targets_by_round"]
    out["ko_by_round"] = {c: {"engine": tg["engine"].get(c, {}).get("p_round_ends_ko_tko"), "real": tg["real"].get(c, {}).get("p_round_ends_ko_tko")}
                          for c in sorted(tg["real"])}
    out["att_pm_by_round"] = {c: {"engine": tg["engine"].get(c, {}).get("sig_att_pm"), "real": tg["real"].get(c, {}).get("sig_att_pm")}
                              for c in sorted(tg["real"])}
    out["kd100_by_round"] = {c: {"engine": tg["engine"].get(c, {}).get("kd_per100_standing_head"), "real": tg["real"].get(c, {}).get("kd_per100_standing_head")}
                             for c in sorted(tg["real"])}
    out["late_ratio"] = res["late_ratio"]
    out["kd_skip_round"] = res.get("kd_skip_round")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("csvs", nargs="+")
    a = ap.parse_args()
    t0 = time.time()
    F, S, notes = dy.build_panel()
    S = S[S.period == "train"].copy()           # 2019-01-01..2023-12-31 only; nothing later is kept
    S = dy.add_covariates(S)
    print(f"train panel: {S.fid.nunique()} fights, {len(S)} fighter-rounds ({time.time() - t0:.0f}s)", flush=True)
    J = {"meta": {"tool": "tools/dynamics_check_train.py", "period": dy.TRAIN, "note": "dynamics.py engine_check on train fights"}}
    for spec in a.csvs:
        lab, csv = spec.split("=", 1)
        print(f"engine check {lab}: {csv}", flush=True)
        res = dy.engine_check(S, csv, lab, real_period="train")   # real rows: 2019-2023 only
        J[lab] = {"summary": summary(res), "full": res}
        s = J[lab]["summary"]
        print(json.dumps({k: s[k] for k in ("out_engine", "out_real", "acc_engine", "acc_real", "round_corr", "kd_frailty_engine",
                                            "kd_frailty_real", "kd_profile_engine", "kd_profile_real", "kd_skip_round")}, indent=None, default=float), flush=True)
        json.dump(J, open(a.out, "w"), indent=1, default=float)
    print(f"wrote {a.out} ({time.time() - t0:.0f}s)")


if __name__ == "__main__":
    main()
