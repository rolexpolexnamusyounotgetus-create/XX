"""Blind-test plugin: era-drift level adjustment of the method model (tools/eradrift.py -> data/derived/eradrift.json),
registered when that file exists. Status: monitored candidate, NOT adopted (the nested forward-chained 2021-2023 gate
failed: 7-bin -0.00007 [-0.00167, +0.00144], joint +0.0005).

eradrift.json fights[fid] (2019-2025 rows of the S2+ml2win walk-forward table): p_a = the ML v2 winner probability
(both variants condition on it and never re-predict the winner); static_bins7 = S2 + ML v2 winner on annual folds
(tools/ml2.py method stage, reproduced exactly: CV 2020-23 joint 2.14070), M2_fast_dec_bins7 = the same cells with
the pre-registered decision-vs-finish tracker (EW half-life 0.25 y on the model's own residuals, division deviations
shrunk to the league, vintage weight 0) applied walk-forward: each fight uses residuals of fights on strictly earlier
days only. set "cv" (2019-2023: annual folds fit before Jan 1 of Y) or "holdout" (2024-2025: fit < 2024, single look).
Bins: [A KO, A SUB, A DEC, draw, B DEC, B SUB, B KO]. Neither variant adds winner information (experimental: no
stacker should read them as winner experts). Corner symmetry: the offsets act identically on both winners'
decision-vs-finish split; tests/test_eradrift.js asserts adjust(mirror) == mirror(adjust).
"""
import datetime as dt

from blindtest import register, Stored


def _load(ctx):
    d = ctx.json("eradrift.json")
    return d if d and isinstance(d.get("fights"), dict) else None


def _make(ctx, d, key):
    P, B, H, FT = {}, {}, {}, {}
    for i, r in d["fights"].items():
        if i not in ctx.fights or r.get(key) is None:
            continue
        P[i] = r["p_a"]
        B[i] = r[key]
        y = int(r["date"][:4])
        if key == "static_bins7":
            FT[i] = "2023-12-31" if r["set"] == "holdout" else "%d-12-31" % (y - 1)
        else:   # the tracker reads results up to the day before the card
            FT[i] = (dt.date.fromisoformat(r["date"]) - dt.timedelta(days=1)).isoformat()
        if r["set"] == "cv":
            H[i] = r["p_a"]
    return P, B, H, FT


@register("eradrift_m2", experimental=True,
          desc="S2 + ML v2 winner with a walk-forward decision-vs-finish level tracker (tools/eradrift.py M2; "
               "monitored candidate, gate failed)")
def _m2(ctx):
    d = _load(ctx)
    if not d:
        return None
    P, B, H, FT = _make(ctx, d, "M2_fast_dec_bins7")
    return Stored(P, history=H, bins=B, fit_through=FT, version="eradrift.json built %s (M2)" % d["meta"].get("built"),
                  note="offsets walk-forward from earlier days; 2024-2025 single look") if P else None


@register("eradrift_static", experimental=True,
          desc="reference: S2 + ML v2 winner as rebuilt by tools/eradrift.py base (annual folds 2014-2024)")
def _static(ctx):
    d = _load(ctx)
    if not d:
        return None
    P, B, H, FT = _make(ctx, d, "static_bins7")
    return Stored(P, history=H, bins=B, fit_through=FT, version="eradrift.json built %s (static)" % d["meta"].get("built"),
                  note="tools/ml2.py method-stage folds, 2024-2025 fit < 2024") if P else None
