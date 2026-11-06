"""Blind-test plugin: seqnet (tools/seqnet.py -> data/derived/seqnet.json), registered only when that file exists.

seqnet.json per backtest fight id: set (oof = 2019-2023 annual expanding refits, valid = 2024-2025), p (2019-2023 OOF;
2024-2025 from the fit before 2024-01-01), p_annual (fit before Jan 1 of the fight's year: the walk-forward blind
prediction for 2024-2025), fit_through, bins7 / bins7_annual. The harness uses p_annual for the window and the oof
rows as stacker history. The two stack experiments add seqnet to the MoE stackers as an extra expert; the stack gate
in tools/seqnet.py (ml2's forward-chained 2021-2023 CV) decides whether it belongs in any production stack.
"""
from blindtest import register, Stored, MoEStack, _MOE_BASE


def _load(ctx):
    d = ctx.json("seqnet.json")
    return d if d and isinstance(d.get("fights"), dict) else None


@register("seqnet", desc="seqnet: siamese GRU over career sequences (tools/seqnet.py), annual walk-forward refit")
def _seqnet(ctx):
    d = _load(ctx)
    if not d:
        return None
    P, H, FT, BN = {}, {}, {}, {}
    for i, r in d["fights"].items():
        if i not in ctx.fights:
            continue
        if r.get("set") == "oof" and r.get("p") is not None:
            H[i] = r["p"]
            P[i] = r["p"]
            FT[i] = r.get("fit_through")
        elif r.get("set") == "valid" and r.get("p_annual") is not None:
            P[i] = r["p_annual"]
            FT[i] = r.get("fit_through")
            if r.get("bins7_annual"):
                BN[i] = r["bins7_annual"]
    return Stored(P, history=H, bins=BN, fit_through=FT,
                  version="seqnet.json built %s, p_annual (oof history: p)" % d["meta"].get("built"),
                  note="tools/seqnet.py: refit before each calendar year on fights strictly earlier; seed ensemble")


@register("moe_noline_seqnet", group="stack", refit="event", needs=tuple(sorted(set(_MOE_BASE.values()) | {"seqnet"})),
          desc="moe_noline with seqnet as an extra expert (absent-regime config), refit before every card",
          experimental=True)
def _moe_noline_seqnet(ctx):
    return MoEStack(ctx, dict(_MOE_BASE, seqnet="seqnet"), "absent") if _load(ctx) else None


@register("moe_close_seqnet", group="stack", refit="event", line="close",
          needs=tuple(sorted(set(_MOE_BASE.values()) | {"seqnet", "market_close"})),
          desc="moe_close with seqnet as an extra expert (present-regime config), refit before every card",
          experimental=True)
def _moe_close_seqnet(ctx):
    return MoEStack(ctx, dict(_MOE_BASE, seqnet="seqnet", market="market_close"), "present") if _load(ctx) else None
