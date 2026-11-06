"""Blind-test plugin: ML v2 (tools/ml2.py -> data/derived/ml2.json), registered only when that file exists.

ml2.json per backtest fight id: set (oof = 2019-2023 annual expanding refits, valid = 2024-2025), ml2 (LR + LightGBM +
XGBoost blend, static <2024 fit), ml2_lr, ml2_roll / ml2_lr_roll (refit on the first of every month on all fights
before it: the walk-forward blind predictions for 2024-2025), stack_<noline|line>_<static|roll> (tools/ml2.py's own
stacks, 2024-2025 only). The harness uses the monthly rolling columns for the window and the oof rows as stacker
history; tools/ml2.py's stacks are scored as published (no history, so no stacker reads them).
"""
from blindtest import register, Stored, MoEStack, _MOE_BASE


def _load(ctx):
    d = ctx.json("ml2.json")
    return d if d and isinstance(d.get("fights"), dict) else None


def _cols(ctx, d, roll, static):
    P, H = {}, {}
    for i, r in d["fights"].items():
        if i not in ctx.fights:
            continue
        if r.get("set") == "oof" and r.get(static) is not None:
            H[i] = r[static]
            P[i] = r[static]
        elif r.get("set") == "valid":
            v = r.get(roll) if roll else None
            v = v if v is not None else r.get(static)
            if v is not None:
                P[i] = v
    return P, H


@register("ml2", desc="ML v2 blend (tools/ml2.py: LR + LightGBM + XGBoost on the feature union), monthly rolling refit")
def _ml2(ctx):
    d = _load(ctx)
    if not d:
        return None
    P, H = _cols(ctx, d, "ml2_roll", "ml2")
    return Stored(P, history=H, version="ml2.json built %s, ml2_roll (oof history: ml2)" % d["meta"].get("built"),
                  note="tools/ml2.py walk-forward: monthly refit before each 2024-2025 month; history = annual-refit OOF")


@register("ml2_lr", desc="ML v2 logistic alone (tools/ml2.py ml2_lr_roll), monthly rolling refit")
def _ml2_lr(ctx):
    d = _load(ctx)
    if not d:
        return None
    P, H = _cols(ctx, d, "ml2_lr_roll", "ml2_lr")
    return Stored(P, history=H, version="ml2.json built %s, ml2_lr_roll" % d["meta"].get("built"))


@register("ml2_stack_noline", desc="tools/ml2.py's own no-line stack (stack_noline_roll, refit each January)")
def _ml2_stack_noline(ctx):
    d = _load(ctx)
    if not d:
        return None
    P = {i: r["stack_noline_roll"] for i, r in d["fights"].items() if i in ctx.fights and r.get("stack_noline_roll") is not None}
    return Stored(P, version="ml2.json built %s, stack_noline_roll" % d["meta"].get("built")) if P else None


@register("ml2_stack_line", line="close", desc="tools/ml2.py's own stack with the closing line (stack_line_roll)")
def _ml2_stack_line(ctx):
    d = _load(ctx)
    if not d:
        return None
    P = {i: r["stack_line_roll"] for i, r in d["fights"].items() if i in ctx.fights and r.get("stack_line_roll") is not None}
    return Stored(P, version="ml2.json built %s, stack_line_roll" % d["meta"].get("built")) if P else None


@register("moe_noline_ml2", group="stack", refit="event", needs=tuple(sorted(set(_MOE_BASE.values()) | {"ml2"})),
          desc="moe_noline with ML v2 as an extra expert (absent-regime config), refit before every card", experimental=True)
def _moe_ml2(ctx):
    return MoEStack(ctx, dict(_MOE_BASE, ml2="ml2"), "absent") if _load(ctx) else None


@register("moe_close_ml2", group="stack", refit="event", line="close",
          needs=tuple(sorted(set(_MOE_BASE.values()) | {"ml2", "market_close"})),
          desc="moe_close with ML v2 as an extra expert (present-regime config), refit before every card", experimental=True)
def _moe_close_ml2(ctx):
    return MoEStack(ctx, dict(_MOE_BASE, ml2="ml2", market="market_close"), "present") if _load(ctx) else None
