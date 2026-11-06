"""Blind-test plugin: ML v2 (tools/ml2.py -> data/derived/ml2.json), registered only when that file exists.

Reads per-fight P(A wins) keyed by backtest fight id. Prefers a rolling/refit column for 2024-2025 when the tool
publishes one, else its frozen pre-2024 fit; 2019-2023 rows are used as stacker history only when they are marked
out-of-fold ('set'/'split' in oof|cv|tune-oof). Edit the key lists below if ml2.json names its columns differently.
"""
from blindtest import register, Stored, MoEStack, _MOE_BASE

P_KEYS = ("p_rolling", "rolling", "p_refit", "refit", "lr_refit", "stack_refit", "p", "pA", "p_a", "ml2", "stack", "lr")
OOF_TAGS = ("oof", "cv", "oof_cv")


def _pick(r):
    for k in P_KEYS:
        v = r.get(k)
        if isinstance(v, (int, float)) and 0 <= v <= 1:
            return float(v), k
    return None, None


@register("ml2", desc="ML v2 (tools/ml2.py), its walk-forward predictions as published in data/derived/ml2.json")
def _ml2(ctx):
    d = ctx.json("ml2.json")
    if not d or not isinstance(d.get("fights"), dict):
        return None
    P, H, used = {}, {}, set()
    for i, r in d["fights"].items():
        if not isinstance(r, dict) or i not in ctx.fights:
            continue
        p, k = _pick(r)
        if p is None:
            continue
        P[i] = p
        used.add(k)
        if ctx.date[i] < "2024-01-01" and (r.get("set") in OOF_TAGS or r.get("split") in OOF_TAGS):
            H[i] = p
    if not P:
        return None
    return Stored(P, history=H, version="ml2.json built %s, column %s" % ((d.get("meta") or {}).get("built"), "/".join(sorted(used))),
                  note="stacker history only from rows marked out-of-fold")


@register("moe_noline_ml2", group="stack", refit="event", needs=tuple(sorted(set(_MOE_BASE.values()) | {"ml2"})),
          desc="moe_noline with ML v2 as an extra expert (absent-regime config)", experimental=True)
def _moe_ml2(ctx):
    if ctx.json("ml2.json") is None:
        return None
    return MoEStack(ctx, dict(_MOE_BASE, ml2="ml2"), "absent")
