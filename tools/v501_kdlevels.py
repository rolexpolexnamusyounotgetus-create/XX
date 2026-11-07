"""v501_kdlevels.py (engine v5.0.1; v5 review "the KD base-rate failure has a structural cause"): walk-forward league knockdown
levels for every development backtest fight (2019-2025; the vault is never read), the input of tools/v501_kdlevel_cv.js.

    python3 tools/v501_kdlevels.py      -> data/derived/kd_levels_wf.json

For each fight date t: league knockdowns per landed standing head strike over [t - w, t) (strictly earlier fight days, the
durability table and exposure of tools/durability.py, its trailing_level with the same widening rule) for w = 365, 730 (the
durability records' level), 1095, 1460 and 1825 days, and since 2008-01-01 ("long-run"). Rows dated 2026-01-01 or later are
dropped before anything is computed. """
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import durability as D  # noqa: E402

WINDOWS = [365, 730, 1095, 1460, 1825]


def main():
    df, state, people, fights, snap_day = D.build_table()
    spec = dict(D.DEFAULT_SPEC)
    X = D.prepare(df, spec)
    X = X[X.date < "2026-01-01"].reset_index(drop=True)
    bt = json.load(open(os.path.join(D.ROOT, "data", "derived", "backtest_dev.json")))
    dev = {f["id"]: f["date"] for f in bt["fights"]}
    lv = {}
    for w in WINDOWS:
        lv["L%d" % w] = D.trailing_level(X, w)
    import datetime as dt
    start = dt.date(2008, 1, 1).toordinal()
    # since-2008 level: cumulative KD / exposure over [2008-01-01, t)
    s = X[X.has_stats == 1].groupby("day").agg(kd=("y", "sum"), E=("E", "sum")).sort_index()
    days = s.index.to_numpy()
    ckd = np.concatenate([[0.0], np.cumsum(s.kd.to_numpy())]); cE = np.concatenate([[0.0], np.cumsum(s.E.to_numpy())])
    import bisect
    lo0 = bisect.bisect_left(days, start)
    out_long = {}
    for day in np.unique(X.day.to_numpy()):
        hi = bisect.bisect_left(days, day)
        out_long[day] = (ckd[hi] - ckd[lo0]) / (cE[hi] - cE[lo0]) if cE[hi] > cE[lo0] else np.nan
    lv["Llong"] = X.day.map(out_long)
    fid_col = "fid" if "fid" in X.columns else None
    res, miss = {}, 0
    for i in range(len(X)):
        fid = str(X[fid_col].iat[i]).rstrip("/").split("/")[-1]
        if fid not in dev or fid in res:
            continue
        res[fid] = {k: round(float(v.iat[i]), 7) for k, v in lv.items()}
        res[fid]["date"] = dev[fid]
    miss = sum(1 for k in dev if k not in res)
    out = {"meta": {"tool": "tools/v501_kdlevels.py", "windows_days": WINDOWS, "long_from": "2008-01-01",
                    "note": "league KD per landed standing head strike over [t - w, t), strictly earlier fight days (durability.py trailing_level); no row dated 2026 or later is read",
                    "n": len(res), "missing": miss},
           "fights": res}
    json.dump(out, open(os.path.join(D.ROOT, "data", "derived", "kd_levels_wf.json"), "w"), separators=(",", ":"))
    print("kd_levels_wf.json:", len(res), "fights,", miss, "missing")


if __name__ == "__main__":
    main()
