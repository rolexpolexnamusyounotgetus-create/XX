"""Blind-test plugin: the debut-path model (tools/debut.py -> data/derived/debut.json), registered when that file exists.

The debut model predicts bouts with a UFC debutant (a side at 0 prior UFC bouts). The harness universe
(data/derived/backtest_dev.json) requires both men to have a prior UFC bout, so the two universes are disjoint and the
harness discards every debut prediction at the door: on the backtest universe this plugin registers nothing (the
factory returns None). It is here so that a harness universe that includes debut bouts (a forward-ledger replay, or a
future debut-inclusive blind test) picks the model up with the same Stored contract as ml2.py:

  predictions[fid] (debut.json): set "oof" = forward-chained CV 2019-2023 (fit on 2012..Y-1, annual), "valid" =
  2024-2025 annual walk-forward (the single look); debut = the debut model, stack_close / stack_noline = the stacks
  with the CV-frozen structure (weights fit on 2019..Y-1 out-of-sample rows).
The stack CV the model went through is tools/debut.py cv (ml2's stack_fit and the 0.0005 rule, forward-chained
2021-2023), reported in research/model_debut.md.
"""
from blindtest import register, Stored


def _load(ctx):
    d = ctx.json("debut.json")
    return d if d and isinstance(d.get("predictions"), dict) else None


def _cols(ctx, d, key):
    P, H = {}, {}
    for i, r in d["predictions"].items():
        if i not in ctx.fights or r.get(key) is None:
            continue
        P[i] = r[key]
        if r.get("set") == "oof":
            H[i] = r[key]
    return P, H


@register("debut", desc="debut-path model (tools/debut.py): global network rating + pre-UFC + replacement flags; "
                        "debut universe only (disjoint from the backtest universe)")
def _debut(ctx):
    d = _load(ctx)
    if not d:
        return None
    P, H = _cols(ctx, d, "debut")
    if not P:
        return None                      # backtest universe: no debut bouts, nothing to register
    return Stored(P, history=H, version="debut.json built %s" % d["meta"].get("built"),
                  note="annual forward-chained fits (2012..Y-1); 2024-2025 = the single look")
