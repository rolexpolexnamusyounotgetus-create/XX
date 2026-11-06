"""Blind-test plugin: the MoE stackers with the simulator removed (controls for the engine's contribution).

moe_noline_noeng vs moe_noline and moe_close_noeng vs moe_close, paired on the same fights, measure what the newest
engine (the one the main stackers use, blindtest._ENGK) adds to the blended winner probability in the blind replay.
"""
from blindtest import register, MoEStack, _MOE_BASE

_NOENG = {k: v for k, v in _MOE_BASE.items() if k != "engine"}


@register("moe_noline_noeng", group="stack", refit="event", needs=tuple(sorted(set(_NOENG.values()))), experimental=True,
          desc="control: moe_noline without the simulator expert, refit before every card")
def _moe_noline_noeng(ctx):
    return MoEStack(ctx, _NOENG, "absent")


@register("moe_close_noeng", group="stack", refit="event", line="close", experimental=True,
          needs=tuple(sorted(set(_NOENG.values()) | {"market_close"})),
          desc="control: moe_close without the simulator expert, refit before every card")
def _moe_close_noeng(ctx):
    return MoEStack(ctx, dict(_NOENG, market="market_close"), "present")
