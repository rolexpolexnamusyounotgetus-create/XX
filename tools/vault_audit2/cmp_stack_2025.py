#!/usr/bin/env python3
"""VAULT AUDIT 2 (auditor only): the cmp4 package's MoE expert stacker fit through 2025-12-31 (vault_audits[1].fits: "cmp4's MoE
stacker = tools/blindtest.py export --fit-through 2025-12-31 on the v4 simulator's fold-honest rows (the per-year recipe of
data/derived/v7/cmp_stack_v4pkg_fit*.json extended to 2025)"). Deployment fit; nothing here is scored.

    nice -n 5 python3 tools/vault_audit2/cmp_stack_2025.py [--vault <dir>]

The per-year recipe (BLINDTEST_MOE_ENGINE_TRAIN=v7 tools/blindtest.py export --fit-through Y-12-31) fits moe_close / moe_noline /
moe_open (tools/moe.py configurations from moe.json, the production expert map with engine = engine_v7) on each expert's
out-of-sample rows from 2019-01-01. Extended to 2025 the rows are assembled exactly as the production export (export_stack, the fit
of blindtest_stack.json through 2025) assembles them: 2019-2023 = each expert's history rows; 2024-2025 = the blind replay's
walk-forward rows (data/derived/blindtest.json fights[id].p[key][0]); the engine expert's 2024-2025 rows are the v7 engine's
(= the v4 simulator's) evalv rows on its fold-honest inputs (<vault>/audit2/evalv/v7cmp_val.json, tools/vault_audit2/evalv_vault2.js
--mode dev2425; equal to data/derived/evalv/v4_repro_dev_val.json row for row). blindtest.py's own code fits and exports.

Check first: the same driver with cutoff 2024-01-01 must reproduce data/derived/v7/cmp_stack_v4pkg_fit2023.json (every linear
weight, gate and calibration). Output: <vault>/audit2/cmp_stack_v4pkg_fit2025.json (src/ml/moe.js format, `model` + `model_open`).
"""
import argparse
import datetime as dt
import json
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
ap = argparse.ArgumentParser()
ap.add_argument("--vault", default="/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vault")
a = ap.parse_args()
AUD = os.path.join(a.vault, "audit2")
os.environ["BLINDTEST_MOE_ENGINE_TRAIN"] = "v7"
os.environ["BLINDTEST_MOE_ENGINE"] = "engine_v7"
sys.path.insert(0, os.path.join(ROOT, "tools"))
import numpy as np  # noqa: E402
import blindtest as BT  # noqa: E402

args = types.SimpleNamespace(cmd="export", models=None, ml_refit="event", tree_refit="month", boot=2000, no_cache=False, quick=False,
                             out=None, cards=None, fit_through=None, stack_out=None, perturb_from=None)
BT.load_plugins()
V7VAL = json.load(open(os.path.join(AUD, "evalv", "v7cmp_val.json")))
V4VAL = {r["id"]: r["pA"] for r in json.load(open(os.path.join(ROOT, "data", "derived", "evalv", "v4_repro_dev_val.json")))["fights"] if r.get("pA") is not None}
eng_2425 = {r["id"]: r["pA"] for r in V7VAL["fights"] if r.get("pA") is not None}
assert all(abs(eng_2425[k] - V4VAL[k]) == 0 for k in eng_2425 if k in V4VAL), "v7 engine rows differ from v4's on 2024-25"


def build(cutoff):
    ctx = BT.Ctx(args)
    keys = BT.topo(list(BT.EXPORT.values()) + [BT.EXPORT_OPEN])
    models = {k: BT.REGISTRY[k]["factory"](ctx) for k in keys}
    P = {k: {f: v for f, v in models[k].history().items() if f in ctx.fights and BT.HIST_FROM <= ctx.date[f] < min(cutoff, BT.WINDOW[0])}
         for k in keys}
    if cutoff > BT.WINDOW[0]:
        doc = json.load(open(BT.OUT_JSON))
        for f, r in doc["fights"].items():
            if f not in ctx.fights or not (BT.WINDOW[0] <= ctx.date[f] < cutoff):
                continue
            for k in keys:
                if k == BT._ENGK:
                    continue
                if k in r["p"] and r["p"][k][0] is not None:
                    P[k][f] = r["p"][k][0]
        for f, v in eng_2425.items():
            if f in ctx.fights and BT.WINDOW[0] <= ctx.date[f] < cutoff:
                P[BT._ENGK][f] = v
    mo = ctx.json("moe.json")
    full = list(mo["model"]["experts"])
    out = {"method": "switch", "on": "market", "experts": full, "pclip": BT.PCLIP, "optional_groups": mo["model"].get("optional_groups")}
    out_open, fit_info = dict(out), {}

    def block(key):
        m = models[key]
        info = m.fit(cutoff, P)
        fit_info[key] = info
        lin = {}
        for pat, (idx, ls) in m.st.lin.items():
            names = [m.names[j] for j in idx]
            lin["+".join(e for e in full if e in names)] = {m.names[j]: float(w) for j, w in zip(idx, ls.w)}
        return {"method": "linear", "experts": full, "pclip": BT.PCLIP, "hp": m.hp,
                "gate": {"names": list(m.MO.GATE_NAMES), "mu": [float(x) for x in m.mu], "sd": [float(x) for x in m.sd]},
                "calibration": m.cal.export() if hasattr(m.cal, "export") else {"type": "none"}, "linear": lin}

    for regime, key in BT.EXPORT.items():
        out[regime] = block(key)
    out_open["present"] = block(BT.EXPORT_OPEN)
    out_open["absent"] = out["absent"]
    n_rows = {k: len(v) for k, v in P.items()}
    n_2425 = {k: sum(1 for f in v if ctx.date[f] >= BT.WINDOW[0]) for k, v in P.items()}
    return out, out_open, fit_info, models, keys, n_rows, n_2425


def maxdiff(x, y, path=""):
    if isinstance(x, dict):
        if set(x) != set(y):
            return float("inf"), path + " keys " + str(sorted(set(x) ^ set(y)))[:200]
        best = (0.0, "")
        for k in x:
            d = maxdiff(x[k], y[k], path + "/" + str(k))
            if d[0] > best[0]:
                best = d
        return best
    if isinstance(x, list):
        if len(x) != len(y):
            return float("inf"), path + " len"
        best = (0.0, "")
        for i, (u, v) in enumerate(zip(x, y)):
            d = maxdiff(u, v, path + "[%d]" % i)
            if d[0] > best[0]:
                best = d
        return best
    if isinstance(x, (int, float)) and isinstance(y, (int, float)) and not isinstance(x, bool):
        return abs(float(x) - float(y)), path
    return (0.0, "") if x == y else (float("inf"), path + " %r != %r" % (x, y))


# ---------------- reproduction of the frozen per-year fit through 2023
o23, oo23, fi23, _, _, _, _ = build("2024-01-01")
ref = json.load(open(os.path.join(ROOT, "data", "derived", "v7", "cmp_stack_v4pkg_fit2023.json")))
rep = {"model": maxdiff(o23, ref["model"]), "model_open": maxdiff(oo23, ref["model_open"]),
       "fit_info": {k: [fi23[k]["fit_through"], fi23[k]["n_train"], ref["meta"]["fit_info"][k]["fit_through"], ref["meta"]["fit_info"][k]["n_train"]] for k in fi23}}
print("reproduction of cmp_stack_v4pkg_fit2023.json: model max diff %.3g (%s); model_open %.3g (%s)" % (rep["model"][0], rep["model"][1], rep["model_open"][0], rep["model_open"][1]))
print("  fit_info:", rep["fit_info"])
if not (rep["model"][0] < 1e-9 and rep["model_open"][0] < 1e-9):
    raise SystemExit("the driver does not reproduce the frozen per-year stacker; refusing to extend it")

# ---------------- fit through 2025
o25, oo25, fi25, models, keys, n_rows, n_2425 = build("2026-01-01")
for k, v in fi25.items():
    assert v["fit_through"] <= "2025-12-31", (k, v)
res = {"meta": {"tool": "tools/vault_audit2/cmp_stack_2025.py (tools/blindtest.py's fit and export code, cutoff 2026-01-01)",
                "built": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
                "fit": "decisive dev fights 2019-01-01..2025-12-31: 2019-2023 each expert's out-of-sample history rows; 2024-2025 the blind replay's "
                       "walk-forward rows (blindtest.json) and, for the engine expert, the v7 engine's (v4 simulator's) evalv rows on fold-honest "
                       "inputs; nothing dated 2026 is read",
                "purpose": "VAULT AUDIT 2 only: cmp4's MoE stacker fit through 2025-12-31 (vault_audits[1].fits)",
                "experts_map": {r: models[k].map for r, k in BT.EXPORT.items()},
                "experts_map_open": {"present": models[BT.EXPORT_OPEN].map, "absent": models[BT.EXPORT["absent"]].map},
                "versions": {k: models[k].version for k in keys}, "fit_info": fi25, "rows_per_expert": n_rows, "rows_2024_2025": n_2425,
                "reproduction_fit2023": rep, "engine_rows_2024_2025": "%d rows, equal to data/derived/evalv/v4_repro_dev_val.json" % len(eng_2425)},
       "model": o25, "model_open": oo25}
json.dump(res, open(os.path.join(AUD, "cmp_stack_v4pkg_fit2025.json"), "w"), indent=1)
w = lambda key: models[key].weights()
print("fit through 2025: fit_info %s" % {k: (v["fit_through"], v["n_train"]) for k, v in fi25.items()})
print("  weights present %s\n  absent %s\n  open %s" % (w(BT.EXPORT["present"]), w(BT.EXPORT["absent"]), w(BT.EXPORT_OPEN)))
print("  rows 2024-25 per expert:", n_2425)
print("wrote", os.path.join(AUD, "cmp_stack_v4pkg_fit2025.json"))
