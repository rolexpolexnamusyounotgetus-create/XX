"""Blind-test plugin: calibration and drift (tools/calib.py -> data/derived/calib.json), registered only when that file
carries per-fight predictions.

calib.json fights[id] (backtest fights 2019-2025): set (hist = 2019-2023, valid = 2024-2025) and per stack head
(noline = ML v2 logistic + market rating, open = opener + ML v2 logistic, line = close + ML v2 logistic):
  <head>     the pre-registered choice of tools/calib.py (data/derived/calib_prereg.json). Nothing passed the CV gate,
             so it is the incumbent: tools/ml2.py's page stack, forward-chained 2021-2023 (fit 2019..Y-1, no 2019-2020
             history) and fit 2019-2023 for 2024-2025 (forward_models.json ml2_static weights). open / line equal
             ml2's published static predictions; noline differs on 9 2024-25 fights where market.json has no
             p_market_rating (ml2 enters that input as logit 0; calib feeds ml2's table rating mr_p), 0.58940 vs
             0.58899 (verifier, research/model_calib.md "Verification log").
  <head>_wf  experimental control: the same stack fit each year on 2013..Y-1 with a trailing temperature refit before
             every card (the temperature family's 2016-2020 choice), walk-forward through 2024-2025. Rejected by the
             2021-2023 gate; registered so the harness can show what a deployed recalibration would have done.
History rows are each column's strictly out-of-sample predictions: 2021-2023 for <head> (ml2's forward-chained fit
needs 2019-2020 as its first training years) and 2019-2023 for <head>_wf.
"""
from blindtest import register, Stored

_HEADS = (("noline", None), ("open", "open"), ("line", "close"))


def _load(ctx):
    d = ctx.json("calib.json")
    return d if d and isinstance(d.get("fights"), dict) and d["fights"] else None


def _cols(ctx, d, key):
    P, H = {}, {}
    for i, r in d["fights"].items():
        if i not in ctx.fights or r.get(key) is None:
            continue
        P[i] = r[key]
        if r.get("set") == "hist":
            H[i] = r[key]
    return P, H


def _factory(key, desc_v):
    def fac(ctx):
        d = _load(ctx)
        if not d:
            return None
        P, H = _cols(ctx, d, key)
        if not P:
            return None
        return Stored(P, history=H, version="calib.json built %s, %s" % (d["meta"].get("built"), key), note=desc_v)
    return fac


for _h, _line in _HEADS:
    register("calib_" + _h, line=_line,
             desc="tools/calib.py pre-registered choice for the %s stack (none passed: the incumbent ml2 page stack)" % _h)(
        _factory(_h, "incumbent ml2 page stack (calib_prereg.json chose no recalibration)"))
    register("calib_%s_wf" % _h, line=_line, experimental=True,
             desc="control: %s stack + walk-forward trailing temperature refit every card (rejected by the CV gate)" % _h)(
        _factory(_h + "_wf", "long-history stack + per-card trailing temperature (temp family's 2016-2020 choice)"))
