"""Blind-test plugin: the props pool for how and when (tools/props.py -> data/derived/props.json), registered when that
file exists.

props.json fights[fid].pool: 23 cells [A KO r1..5, A SUB r1..5, B KO r1..5, B SUB r1..5, A dec, B dec, draw] of the
CV-chosen pool (method | winner = joint-linear pool of S2 and the de-vigged method props, weights fit by forward-chained
CV on 2021..Y-1; round shapes = S2's hazard, round props failed the CV gate), composed with the close-regime winner
stack W_close (market + ML v2, forward-chained). 2022-2023 rows are the forward-chained CV predictions (history),
2024-2025 rows use the parameters fit on 2021-2023 (the single pre-registered look). Fights without method props fall
back to S2's conditionals (the degrade rule), so the pool covers every 2022-2025 fight in the method table.

P(A) is W_close exactly (the pool never moves the winner), so in the winner tables this is the close stack; the
interesting column is the 7-bin table (harness `seven_bin`, paired against mr_S). It reads the closing line.
"""
from blindtest import register, Stored


def _bins(c):
    aK, aS, bK, bS = sum(c[0:5]), sum(c[5:10]), sum(c[10:15]), sum(c[15:20])
    aD, bD, dr = c[20], c[21], c[22]
    pa, pb = aK + aS + aD, bK + bS + bD
    return pa / max(1e-12, pa + pb), [aK, aS, aD, dr, bD, bS, bK]


@register("props_pool", line="close", experimental=True,
          desc="props pool (tools/props.py): S2 + de-vigged method props for method | winner, S2 round shapes, "
               "composed with the close stack; publishes 7-bin")
def _props_pool(ctx):
    d = ctx.json("props.json")
    if not d or not isinstance(d.get("fights"), dict):
        return None
    P, B, H, FT = {}, {}, {}, {}
    for i, r in d["fights"].items():
        if i not in ctx.fights or not r.get("pool"):
            continue
        p, b = _bins(r["pool"])
        P[i], B[i] = p, b
        yr = int(r["date"][:4])
        FT[i] = "%d-12-31" % (yr - 1) if r.get("set") == "cv" else "2023-12-31"
        if r.get("set") == "cv":
            H[i] = p
    return Stored(P, history=H, bins=B, fit_through=FT,
                  version="props.json built %s, pool %s" % (d["meta"].get("built"), d["model"]["spec"]["name"]),
                  note="2022-2023 forward-chained CV (fit 2021..Y-1); 2024-2025 fit 2021-2023 (the single look)",
                  symmetric="by construction (corner swap asserted in tools/props.py cv)")
