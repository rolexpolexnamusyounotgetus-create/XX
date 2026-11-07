"""Blind-test plugin: the finishing model (tools/finishing.py -> data/derived/finishing.json), registered when that file
exists. Status: monitored candidate, NOT adopted (its forward-chained 2021-2023 stack gate failed).

finishing.json fights[fid]: set "nested_oof" (2019-2023: year Y predicted by the candidates the nested forward-chained
selection picked on 2016..Y-1, each fit on fights before Jan 1 of Y) or "holdout" (2024-2025: the production
configuration fit on fights before 2024-01-01, the single look); p_a = the ML v2 winner probability the model
conditions on (it never re-predicts the winner); bins7 = [A KO, A SUB, A DEC, draw, B DEC, B SUB, B KO];
s2ml2win_bins7 = the incumbent S2 + ML v2 winner rebuilt on the same folds (tools/ml2.py method stage, reproduced to
1e-5 on 2020-2023), registered alongside so the harness's 7-bin table pairs them on the same fights.
P(A) is the ML v2 winner for both, so neither adds winner information (both are experimental: no stacker should read
them as winner experts). Corner symmetry: winner-oriented method model and finisher-oriented round model, no corner
term; the corner-swap refit test in tools/finishing.py swap passes at 1e-15.
"""
from blindtest import register, Stored


def _load(ctx):
    d = ctx.json("finishing.json")
    return d if d and isinstance(d.get("fights"), dict) else None


def _make(ctx, d, key):
    P, B, H, FT = {}, {}, {}, {}
    for i, r in d["fights"].items():
        if i not in ctx.fights or r.get(key) is None:
            continue
        P[i] = r["p_a"]
        B[i] = r[key]
        y = int(r["date"][:4])
        FT[i] = "2023-12-31" if r["set"] == "holdout" else "%d-12-31" % (y - 1)
        if r["set"] == "nested_oof":
            H[i] = r["p_a"]
    return P, B, H, FT


@register("finishing", experimental=True,
          desc="finishing model (tools/finishing.py): P(method | winner) from S2's design + EB finishing tendencies, "
               "round given winner and method; winner = ML v2 (monitored candidate, not adopted)")
def _finishing(ctx):
    d = _load(ctx)
    if not d:
        return None
    P, B, H, FT = _make(ctx, d, "bins7")
    return Stored(P, history=H, bins=B, fit_through=FT, version="finishing.json built %s" % d["meta"].get("built"),
                  note="2019-2023 nested forward-chained OOF; 2024-2025 production fit < 2024 (single look)") if P else None


@register("finishing_s2ml2win", experimental=True,
          desc="reference: S2 + ML v2 winner (the incumbent method / round model) as rebuilt by tools/finishing.py base")
def _s2ml2win(ctx):
    d = _load(ctx)
    if not d:
        return None
    P, B, H, FT = _make(ctx, d, "s2ml2win_bins7")
    return Stored(P, history=H, bins=B, fit_through=FT, version="finishing.json built %s (s2ml2win)" % d["meta"].get("built"),
                  note="tools/ml2.py method-stage folds (annual), 2024-2025 fit < 2024") if P else None
