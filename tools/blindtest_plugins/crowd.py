"""Blind-test plugin: crowd and expert consensus picks (tools/crowd.py -> data/derived/crowd.json), registered only when
that file exists.

Per backtest fight id, crowd.json carries the RotoWire panel (rw: n_a, n_b, frozen) and the Money MMA pick'em
consensus (mm: share_a, freeze). The inputs are pre-fight by construction (research/model_crowd.md "Freeze"): a panel
counts only when its article was published at least a day before the card; a Money MMA card is dropped when its stated
lock is later than the main card's earliest start (none were); both rules live in tools/crowd.crowd_probs, which this
plugin calls. Probabilities are the raw stack inputs (panel share shrunk with 0.5 pseudo-picks per side, contest share
clipped to [0.03, 0.97], 'crowd' = mean logit of the two), not calibrated forecasts (forward-fit slopes are 0.25-0.56),
so the stand-alone rows of these models are descriptive; their use is as stack experts. Coverage is partial
(pay-per-view main cards, and the five contest bouts of each card from Feb 2022), so the harness leaves them out of
its common set (it needs >= 95% window coverage) and the stackers treat a missing crowd as an absent expert.
All entries are experimental: tools/crowd.py's forward-chained 2021-2023 stack CV did not adopt any crowd column in the
no-line, open or close stacks, nor in the method model (research/model_crowd.md), so no production stack reads them.
"""
from blindtest import register, Stored, MoEStack, _MOE_BASE
import crowd as _C


def _load(ctx):
    d = ctx.json("crowd.json")
    return d if d and isinstance(d.get("fights"), dict) else None


def _cols(ctx, d, key):
    P, H = {}, {}
    for i, r in d["fights"].items():
        if i not in ctx.fights:                   # dev fights only (2026 never present in crowd.json either)
            continue
        p = _C.crowd_probs(r).get(key)
        if p is None:
            continue
        P[i] = p
        if "2019-01-01" <= r["date"] < "2024-01-01":
            H[i] = p                              # pre-fight inputs, no fit involved: usable as stacker history
    return P, H


def _stored(key, desc):
    @register("crowd_" + key if key != "crowd" else "crowd", desc=desc, experimental=True)
    def _f(ctx):
        d = _load(ctx)
        if not d:
            return None
        P, H = _cols(ctx, d, key)
        return Stored(P, history=H, version="crowd.json built %s (%s)" % (d["meta"].get("built"), key),
                      note="raw consensus input, not a calibrated forecast; partial coverage") if P else None
    return _f


_stored("rw", "RotoWire expert panel share (pay-per-view main cards; raw stack input)")
_stored("mm", "Money MMA pick'em contest consensus share (five main-card bouts per card, Feb 2022 on; raw stack input)")
_stored("crowd", "mean logit of the RotoWire panel and the Money MMA consensus (raw stack input)")


@register("moe_noline_crowd", group="stack", refit="event", needs=tuple(sorted(set(_MOE_BASE.values()) | {"crowd"})),
          desc="experiment: moe_noline + the crowd consensus as an extra expert (absent where not covered)",
          experimental=True)
def _moe_noline_crowd(ctx):
    return MoEStack(ctx, dict(_MOE_BASE, crowd="crowd"), "absent") if _load(ctx) else None


@register("moe_open_crowd", group="stack", refit="event", line="open",
          needs=tuple(sorted(set(_MOE_BASE.values()) | {"crowd", "market_open"})),
          desc="experiment: moe_open + the crowd consensus as an extra expert", experimental=True)
def _moe_open_crowd(ctx):
    return MoEStack(ctx, dict(_MOE_BASE, crowd="crowd", market="market_open"), "present") if _load(ctx) else None


@register("moe_close_crowd", group="stack", refit="event", line="close",
          needs=tuple(sorted(set(_MOE_BASE.values()) | {"crowd", "market_close"})),
          desc="experiment: moe_close + the crowd consensus as an extra expert", experimental=True)
def _moe_close_crowd(ctx):
    return MoEStack(ctx, dict(_MOE_BASE, crowd="crowd", market="market_close"), "present") if _load(ctx) else None
