#!/usr/bin/env python3
"""line_stack.py: the line-only winner stack, the fallback headline of FightEngine.predict when the v6 ML v2 head stack
cannot be evaluated (a UFC debutant or a manual fighter outside ML v2's roster) and a line exists (v6 review, issue "debut
and manual bouts drop the line": src/ml/blend.js 1.2.1, source 'line').

    python3 tools/line_stack.py [--out data/derived/line_stack.json]

Model, per line kind, exactly the construction of the v6 stacks (tools/v6_prep.py) with the line as the only input:
    logit P(A wins) = b * logit(clip(line, 0.01)),  no intercept, fit on mirrored rows (both corner orders), so it is exactly
    corner-symmetric and cannot learn the ufcstats first-name ordering (docs/BACKLOG.md "Evaluation rule").
    open  = data/derived/market.json p_novig_open  (proportional de-vig: what src/ml/blend.js lineOf gives an opener)
    close = data/derived/market.json p_power_close (power de-vig: what lineOf gives a closing line)
Rows: decisive fights of data/derived/backtest_dev.json dated 2019-01-01..2023-12-31 that have the line (train only; the
validation window and the vault are never read: rows are filtered by date before anything else). Forward-chained fits
`by_fit_year[Y]` use 2019..Y-1 (Y = 2021..2024; '2024' = fit through 2023-12-31, the one backtests of 2024-25 may use);
`production` is the 2019-2023 fit (no refit through 2025: the fallback is rare and the slope is stable, so the
deployment refit was not worth a second procedure).
The backtest universe has no debut bouts, so this fallback never moves a scored backtest number; it serves the page and the
forward ledger.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PCLIP = 0.01
KEYS = {"open": "p_novig_open", "close": "p_power_close"}


def logit(p):
    p = min(max(p, PCLIP), 1 - PCLIP)
    return math.log(p / (1 - p))


def fit_slope(rows):
    """Mirrored no-intercept logistic regression of y on z; Newton. rows: [(z, y)]; returns b, its SE, mean log loss."""
    b = 1.0
    for _ in range(50):
        g = h = 0.0
        for z, y in rows:
            for zz, yy in ((z, y), (-z, 1 - y)):
                q = 1 / (1 + math.exp(-b * zz))
                g += (yy - q) * zz
                h += q * (1 - q) * zz * zz
        step = g / h
        b += step
        if abs(step) < 1e-12:
            break
    ll = 0.0
    for z, y in rows:
        q = 1 / (1 + math.exp(-b * z))
        q = min(max(q, 1e-4), 1 - 1e-4)
        ll -= y * math.log(q) + (1 - y) * math.log(1 - q)
    return b, 1 / math.sqrt(h), ll / max(1, len(rows))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "data/derived/line_stack.json"))
    a = ap.parse_args()
    bt = json.load(open(os.path.join(ROOT, "data/derived/backtest_dev.json")))
    mk = json.load(open(os.path.join(ROOT, "data/derived/market.json")))["fights"]
    rows = {k: [] for k in KEYS}
    for f in bt["fights"]:
        if not ("2019-01-01" <= f["date"] < "2024-01-01"):
            continue
        w = (f.get("result") or {}).get("winner")
        if w not in ("A", "B"):
            continue
        m = mk.get(f["id"]) or {}
        for kind, key in KEYS.items():
            q = m.get(key)
            if isinstance(q, (int, float)) and 0 < q < 1:
                rows[kind].append((int(f["date"][:4]), logit(q), 1.0 if w == "A" else 0.0))
    out = {"meta": {"tool": "tools/line_stack.py", "built": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                    "what": "line-only winner stack: logit p = slope * logit(clip(line, pclip)), no intercept, mirrored fit",
                    "rows": "decisive data/derived/backtest_dev.json fights 2019-01-01..2023-12-31 with the line (train only)",
                    "inputs": KEYS, "pclip": PCLIP,
                    "use": "src/ml/blend.js 1.2.1: fallback headline (source 'line') when the ML v2 head stack is unavailable and a line exists"},
           "stacks": {}}
    for kind in KEYS:
        blk = {"input": KEYS[kind], "pclip": PCLIP, "by_fit_year": {}}
        for Y in (2021, 2022, 2023, 2024):
            r = [(z, y) for yr, z, y in rows[kind] if yr < Y]
            b, se, ll = fit_slope(r)
            blk["by_fit_year"][str(Y)] = {"slope": round(b, 6), "se": round(se, 6), "n": len(r), "fit_through": "%d-12-31" % (Y - 1),
                                          "train_logloss": round(ll, 5)}
        p = dict(blk["by_fit_year"]["2024"])
        p["note"] = "production = the 2019-2023 fit"
        blk["production"] = p
        out["stacks"][kind] = blk
        print(kind, {Y: (v["slope"], v["se"], v["n"]) for Y, v in blk["by_fit_year"].items()})
    json.dump(out, open(a.out, "w"), indent=1)
    print("wrote", os.path.relpath(a.out, ROOT))


if __name__ == "__main__":
    main()
