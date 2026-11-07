#!/usr/bin/env python3
"""blend_anchor component: extract the walk-forward expert inputs the 2019-2023 ablation needs from the MoE cache.

    python3 tools/blend_anchor_prep.py [--cache out/moe_cache] [--out data/derived/blend_anchor_dev.json]

Reads out/moe_cache/experts.pkl (python3 tools/moe.py experts) and writes, for every backtest_dev fight dated
2019-01-01..2023-12-31 ONLY (the hidden-data protocol: nothing from 2024 on is extracted, so the ablation cannot
touch validation or vault fights):

  fights[id] = { date, y (1 = A won, 0 = B won, null = draw / NC), feat_lr (strictly out-of-fold page feature LR:
                 each year predicted by a fit on earlier years), elo (walk-forward Elo P(A)), rdA, rdB (Glicko RD,
                 Elo points, pre-fight), nA, nB (prior UFC fights) }
  coef_page[year] = the expanding-window feature-LR coefficients trained on years < year (tools/moe.py
                 lr_coefs, full 65-feature model) restricted to the 60 page features in data/derived/moe.json
                 feat.names order: used only to propagate profile noise into the feature-LR logit for the
                 uncertainty interval, so a fight's interval never uses coefficients fit on its own year or later.

The other experts (ml.json lr / elo_sig, market.json close and market rating, methodround.json S/SM, mlrates_oof.json)
are read straight from data/derived by tools/blend_anchor_bt.js.
"""
import argparse
import json
import math
import os
import pickle
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
LAST = "2023-12-31"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=os.environ.get("MOE_CACHE", os.path.join(ROOT, "out", "moe_cache")))
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "derived", "blend_anchor_dev.json"))
    a = ap.parse_args()
    with open(os.path.join(a.cache, "experts.pkl"), "rb") as fh:
        E = pickle.load(fh)
    with open(os.path.join(ROOT, "data", "derived", "moe.json")) as fh:
        page_names = json.load(fh)["feat"]["names"]
    fn = E["feat_names"]
    fights = {}
    for i, fid in enumerate(E["ids"]):
        d = E["dates"][i]
        if not ("2019-01-01" <= d <= LAST):
            continue
        r = E["rows"][i]
        y = E["y"][i]
        fl = float(E["pred"]["feat_lr"][i])
        el = float(E["pred"]["elo"][i])
        fights[fid] = {
            "date": d,
            "y": None if not math.isfinite(float(y)) else int(round(float(y))),
            "feat_lr": round(fl, 6) if math.isfinite(fl) else None,
            "elo": round(el, 6) if math.isfinite(el) else None,
            "rdA": round(float(r["A"].get("glicko_rd", 350.0)), 2),
            "rdB": round(float(r["B"].get("glicko_rd", 350.0)), 2),
            "nA": int(r["A"].get("n", 0) or 0), "nB": int(r["B"].get("n", 0) or 0),
        }
    coef_page = {}
    for yr, c in E["lr_coefs"].items():
        if int(yr) > 2023:
            continue
        coef_page[str(yr)] = [float(c[fn.index(n)]) for n in page_names]
    out = {
        "meta": {
            "tool": "tools/blend_anchor_prep.py",
            "source": "out/moe_cache/experts.pkl (tools/moe.py experts): pred.feat_lr (expanding-window OOF), pred.elo, "
                      "rows[].A/B.glicko_rd, lr_coefs[year]",
            "window": "2019-01-01..%s only (hidden-data protocol)" % LAST,
            "n": len(fights),
            "orientation": "A = first-named ufcstats fighter; every probability is P(A wins)",
        },
        "coef_page": coef_page,
        "fights": fights,
    }
    with open(a.out, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    print("wrote %s: %d fights (<= %s), coefficient years %s" % (a.out, len(fights), LAST, sorted(coef_page)))


if __name__ == "__main__":
    sys.exit(main())
