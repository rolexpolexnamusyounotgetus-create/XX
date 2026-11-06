"""Blind-test plugin: line timing (tools/linemove.py -> data/derived/linemove.json), registered only when that file exists.

linemove.json "fights" (decisive dev evaluation fights 2019-2025 with a full 10-point BFO sparkline, a close and an open):
traj = P(A) at sparkline points 0..9 (point 0 = the single-book opener, multiplicative de-vig; 1-9 = BFO mean odds, power
de-vig; 9 = the mean close), traj_mult = the same with the multiplicative de-vig; set = train (2019-2020) / oof
(2021-2023, forward-chained CV: fit 2019..Y-1) / valid (2024-2025). Predictions at point 8, the last pre-close consensus
snapshot (the regime of a forward-ledger capture):
  p_cons8_*         consensus stack (sparkline points 4-8 pooled + ML v2 logistic, no intercept, non-negative)
  p_open_fed8mult_* fwd-4.1 as run: open-trained stack (opener + ML v2 logistic) fed the multiplicative consensus
2024-2025 use the January-refit columns (*_roll: refit on 2019..Y-1 with ML v2's monthly-rolling logistic); the oof rows
are the stacker history. The routing verdict (research/model_linemove.md): the consensus stack passed the pre-2024 gate
but was contradicted on 2024-2025, so both stacks are experimental controls; nothing here enters a default stack.
"""
from blindtest import register, Stored


def _load(ctx):
    d = ctx.json("linemove.json")
    return d if d and isinstance(d.get("fights"), dict) else None


def _cols(ctx, d, oof_key, valid_key):
    P, H = {}, {}
    for i, r in d["fights"].items():
        if i not in ctx.fights:
            continue
        if r.get("set") == "oof" and r.get(oof_key) is not None:
            H[i] = r[oof_key]
            P[i] = r[oof_key]
        elif r.get("set") == "valid" and r.get(valid_key) is not None:
            P[i] = r[valid_key]
    return P, H


@register("line_cons8", group="benchmark", line="close", experimental=True,
          desc="BFO mean consensus at sparkline point 8 (last pre-close snapshot), power de-vig (tools/linemove.py)")
def _line_cons8(ctx):
    d = _load(ctx)
    if not d:
        return None
    P = {i: r["traj"][8] for i, r in d["fights"].items() if i in ctx.fights and r.get("traj") and r["traj"][8] is not None}
    return Stored(P, history={i: p for i, p in P.items() if d["fights"][i]["set"] != "valid"},
                  version="linemove.json built %s, traj[8]" % d["meta"].get("built"),
                  note="index-only snapshot (no timestamp); between the opener and the close") if P else None


@register("linemove_cons", group="model", line="close", experimental=True,
          desc="consensus-trained stack (points 4-8 + ML v2 logistic) fed the point-8 consensus; January refit")
def _linemove_cons(ctx):
    d = _load(ctx)
    if not d:
        return None
    P, H = _cols(ctx, d, "p_cons8_oof", "p_cons8_roll")
    return Stored(P, history=H, version="linemove.json built %s, p_cons8_roll (history: p_cons8_oof)" % d["meta"].get("built"),
                  note="passed the pre-2024 gate, contradicted on 2024-2025 (research/model_linemove.md)") if P else None


@register("linemove_open_fed_cons", group="model", line="close", experimental=True,
          desc="control: fwd-4.1 as run, open-trained stack fed the multiplicative point-8 consensus; January refit")
def _linemove_open_fed_cons(ctx):
    d = _load(ctx)
    if not d:
        return None
    P, H = _cols(ctx, d, "p_open_fed8mult_oof", "p_open_fed8mult_roll")
    return Stored(P, history=H, version="linemove.json built %s, p_open_fed8mult_roll" % d["meta"].get("built")) if P else None
