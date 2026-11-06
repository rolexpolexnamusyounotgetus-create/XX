"""Blind-test plugin: the stat-line winner expert (tools/statlines.py -> data/derived/statlines_oof.json, p_dom).

p_dom = sigmoid(0.05 x (expected dominance A - expected dominance B)), dominance from each man's unconditional expected
stat line (mixture over the methodround S fight-length grid) with the engine's judging weights (head 1, body 0.8,
leg 0.55 per landed strike, KD 12, takedown 3, control 0.06 per second, submission attempt 7). Walk-forward: 2019 rows
from raw mlrates out-of-fold rates, 2020 from a second stage trained on 2019, 2021-2023 from the forward-chained CV
folds (history), 2024-2025 from the 2019-2023 fit (static; no rolling refit). Antisymmetric by construction (no corner
input). The forward-chained stack gate in research/model_statlines.md decides whether it may enter a stack; it is
registered as experimental for the replay either way.
"""
from blindtest import register, Stored


@register("statlines_dom", experimental=True,
          desc="stat-line winner expert (tools/statlines.py): expected judging dominance from the distributional lines")
def _statlines_dom(ctx):
    d = ctx.json("statlines_oof.json")
    if not d or not isinstance(d.get("fights"), dict):
        return None
    P, H = {}, {}
    for i, r in d["fights"].items():
        if i not in ctx.fights or r.get("p_dom") is None:
            continue
        P[i] = r["p_dom"]
        if r.get("set") in ("raw2019", "cv2020", "cv"):
            H[i] = r["p_dom"]
    return Stored(P, history=H, version="statlines_oof.json built %s, p_dom" % d["meta"].get("built"),
                  note="2019-2023 walk-forward history; 2024-2025 static fit through 2023-12-31")
