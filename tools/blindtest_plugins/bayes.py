"""Blind-test plugin: bayes (tools/bayes.py -> data/derived/bayes.json), registered only when that file exists.

Hierarchical Bayesian dynamic skill model: 11 time-varying skills per fighter (overall, striking offence/defence,
takedown offence/defence, control, submission threat/defence, power, chin, cardio) with random-walk dynamics scaled by
inactivity, age-curve drift and an age / pre-UFC newcomer prior; likelihood over soft round wins, method and per-round
stat counts (negative binomial). Inference: Laplace-ADF filter after every fight day plus EP smoothing refits of the
whole history on the CV-chosen schedule; hyperparameters refit by empirical Bayes each Jan 1 on earlier fights.

bayes.json per backtest fight id: set (oof = 2019-2023, hyperparameters fit before Jan 1 of the fight's year;
valid = 2024-2025), p (oof, or 2024-2025 from the fit before 2024-01-01), p_roll (2025 from the fit before
2025-01-01: the walk-forward blind prediction), cells (23 method x round cells, A = first ufcstats name). The harness
uses p_roll for the window and the oof rows as stacker history. The stack experiments add bayes to the MoE stackers as
an extra expert; the stack gate in tools/bayes.py (ml2's forward-chained 2021-2023 CV) decides whether it belongs in
any production stack.
"""
from blindtest import register, Stored, MoEStack, _MOE_BASE


def _load(ctx):
    d = ctx.json("bayes.json")
    return d if d and isinstance(d.get("fights"), dict) else None


def _bins7(c):
    """23 cells -> 7 bins [A KO, A SUB, A DEC, DRAW, B DEC, B SUB, B KO]."""
    if not c or any(v is None for v in c):
        return None
    return [sum(c[0:5]), sum(c[5:10]), c[20], c[22], c[21], sum(c[15:20]), sum(c[10:15])]


@register("bayes", desc="bayes: hierarchical dynamic skill model (tools/bayes.py), EP refits + filter, annual EB refit")
def _bayes(ctx):
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
        if r.get("set") == "valid":
            v = r.get("p_roll") if r.get("p_roll") is not None else r.get("p")
            if v is not None:
                P[i] = v
            if r.get("p_roll") is not None:
                # verifier fix: p_roll for 2025 comes from the hyperparameter fit through 2024-12-31, not the static
                # fit's 2023-12-31; record the cutoff of the prediction actually served
                FT[i] = r.get("fit_through_roll") or ("2024-12-31" if r.get("date", "") >= "2025-01-01" else FT[i])
        b = _bins7(r.get("cells"))
        if b and r.get("set") == "valid":
            BN[i] = b
    return Stored(P, history=H, bins=BN, fit_through=FT,
                  version="bayes.json built %s, p_roll (oof history: p)" % d["meta"].get("built"),
                  note="tools/bayes.py: hyperparameters refit each Jan 1 on earlier fights; states by EP refits + "
                       "filtered updates after every fight day")


@register("moe_noline_bayes", group="stack", refit="event", needs=tuple(sorted(set(_MOE_BASE.values()) | {"bayes"})),
          desc="moe_noline with bayes as an extra expert (absent-regime config), refit before every card",
          experimental=True)
def _moe_noline_bayes(ctx):
    return MoEStack(ctx, dict(_MOE_BASE, bayes="bayes"), "absent") if _load(ctx) else None


@register("moe_close_bayes", group="stack", refit="event", line="close",
          needs=tuple(sorted(set(_MOE_BASE.values()) | {"bayes", "market_close"})),
          desc="moe_close with bayes as an extra expert (present-regime config), refit before every card",
          experimental=True)
def _moe_close_bayes(ctx):
    return MoEStack(ctx, dict(_MOE_BASE, bayes="bayes", market="market_close"), "present") if _load(ctx) else None
