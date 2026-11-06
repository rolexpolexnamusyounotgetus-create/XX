"""Blind-test plugin (added by the blindtest verification, Nov 6): the close-trained MoE stack fed the opening line.

`moe_close_fed_open` refits exactly like `moe_close` (the closing line in the market slot of every training row) but
predicts each card with the opening line in that slot. That is what a forward prediction does when it pushes an early
line through close-trained weights (blindtest_stack.json 'model'). Paired against `moe_open` (weights trained with the
open) it measures the cost of the mismatch; tools/blindtest.py export writes the open-trained weights as 'model_open'.
"""
from blindtest import register, MoEStack, _MOE_BASE


class _FedOpen(MoEStack):
    def _with_open(self, fn, fids, P):
        keep = self.map["market"]
        self.map["market"] = "market_open"
        try:
            return fn(fids, P)
        finally:
            self.map["market"] = keep

    def predict(self, fids, P):
        return self._with_open(super().predict, fids, P)

    def predict_swapped(self, fids, P):
        return self._with_open(super().predict_swapped, fids, P)


@register("moe_close_fed_open", group="stack", refit="event", line="open", experimental=True,
          needs=tuple(sorted(set(_MOE_BASE.values()) | {"market_close", "market_open"})),
          desc="control: moe_close's close-trained weights fed the opening line at prediction time (pair with moe_open)")
def _moe_close_fed_open(ctx):
    m = _FedOpen(ctx, dict(_MOE_BASE, market="market_close"), "present")
    m.version += ", predicted with market=market_open"
    return m
