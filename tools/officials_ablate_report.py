#!/usr/bin/env python3
"""officials_ablate_report.py - metrics for tools/officials_ablate.js shards (train years 2019-2023 only).

Every fight is scored in both corner orders (each orientation in its own frame) and the two losses are averaged, so
nothing can learn the ufcstats winner-first ordering. Differences between variants are paired per fight (common random
numbers) with 95% intervals from a bootstrap that resamples whole events (a card shares its judges and referee).

Metrics: winner log loss (decisive fights), soft-label cross-entropy against the power-no-vig closing line
(market.json p_power_close), 7-bin outcome log loss, method log loss (KO/TKO, SUB, decision), decision metrics
(P(decision) log loss; decision outcome log loss over A UD/SD/MD, draw, B MD/SD/UD on fights that went the distance;
winner log loss on decisions; unanimous-vs-not log loss), UD/SD/MD/draw calibration, stat-line Poisson deviance, and
the base-rate table (predicted vs actual).

  python3 tools/officials_ablate_report.py <shard.json>... [--out report.json] [--md report.md]
"""
import argparse
import json
import math
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
VARS = ["off", "lg", "jd", "full"]
PAIRS = [("lg", "off"), ("jd", "lg"), ("full", "jd"), ("jd", "off"), ("full", "off")]
STATS = ["sig_lnd", "sig_att", "h_lnd", "b_lnd", "l_lnd", "kd", "td_lnd", "td_att", "ctrl", "sub_att"]
DEC = ["UD", "SD", "MD"]


def derived(name):
    a = ROOT / "data" / "derived" / name
    return a if a.exists() else Path("/home/user/XX/data/derived") / name


def swap_bins(b):
    return b[::-1]


def actual_frame(res, o):
    w = res["winner"]
    if o == 1:
        w = {"A": "B", "B": "A"}.get(w, w)
    return w, res["method"]


def bin_of(w, m):
    if w == "D":
        return 3
    if w not in ("A", "B"):
        return None
    k = 1 if m == "SUB" else (2 if m in DEC else 0)
    return k if w == "A" else 6 - k


def dec_idx(w, m):
    if w == "D":
        return 3
    if m not in DEC or w not in ("A", "B"):
        return None
    k = DEC.index(m)
    return k if w == "A" else 6 - k


def boot(d, g, n=2000, seed=7):
    d = np.asarray(d, float)
    codes, gi = np.unique(np.asarray(g, dtype=object).astype(str), return_inverse=True)
    sums = np.bincount(gi, weights=d, minlength=len(codes))
    cnts = np.bincount(gi, minlength=len(codes)).astype(float)
    rng = np.random.default_rng(seed)
    pick = rng.integers(0, len(codes), (n, len(codes)))
    bs = sums[pick].sum(1) / cnts[pick].sum(1)
    return {"mean": float(d.mean()), "lo": float(np.percentile(bs, 2.5)), "hi": float(np.percentile(bs, 97.5)),
            "n": int(len(d)), "events": int(len(codes))}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("shards", nargs="+")
    ap.add_argument("--out")
    ap.add_argument("--md")
    a = ap.parse_args()
    rows, meta = [], []
    for s in a.shards:
        d = json.loads(Path(s).read_text())
        rows += d["rows"]
        meta.append(d["meta"])
    bt = {f["id"]: f for f in json.loads(derived("backtest_dev.json").read_text())["fights"]}
    mk = json.loads(derived("market.json").read_text())["fights"]
    assert all(r["date"] < "2024-01-01" for r in rows), "train years only"

    L = {k: {v: [] for v in VARS} for k in ["winner", "soft", "bin7", "method", "pdec", "dectype", "decwin", "unan", "statdev"]}
    G = {k: [] for k in L}
    statdev_by = {v: {s: 0.0 for s in STATS} for v in VARS}
    base = {v: {"n": 0, "ko": 0.0, "sub": 0.0, "dec": 0.0, "draw": 0.0, "UD": 0.0, "SD": 0.0, "MD": 0.0, "DRAWd": 0.0, "decn": 0.0,
                "n108": 0.0, "rj": 0.0, "fin_r": np.zeros(5), "mins": 0.0, "kd": 0.0} for v in VARS + ["actual"]}
    calib = {v: [] for v in VARS}           # (pred P(non-UD | decision), actual non-UD) on decision fights
    nfl = 0
    for r in rows:
        f = bt[r["id"]]
        res, act = f["result"], f["actual"]
        nR = f["rounds"]
        q = mk.get(r["id"], {}).get("p_power_close")
        per = {k: {v: [] for v in VARS} for k in L}
        for o, ob in enumerate(r["o"]):
            w, m = actual_frame(res, o)
            V = ob["v"]
            ya = act["B"] if o else act["A"]
            yb = act["A"] if o else act["B"]
            for v in VARS:
                x = V[v]
                n = x["n"]
                b = np.array(x["bins"], float)
                dc = np.array(x["dec"], float)
                pa, pb = b[:3].sum(), b[4:].sum()
                p_a = (pa + 0.5) / (pa + pb + 1.0)
                if w in ("A", "B"):
                    per["winner"][v].append(-math.log(p_a if w == "A" else 1 - p_a))
                if q is not None:
                    qq = q if o == 0 else 1 - q
                    per["soft"][v].append(-(qq * math.log(p_a) + (1 - qq) * math.log(1 - p_a)))
                bi = bin_of(w, m)
                if bi is not None:
                    per["bin7"][v].append(-math.log((b[bi] + 0.5) / (n + 3.5)))
                    meth = np.array([b[0] + b[6], b[1] + b[5], b[2] + b[3] + b[4]])
                    mi = 1 if m == "SUB" else (2 if (m in DEC or w == "D") else 0)
                    per["method"][v].append(-math.log((meth[mi] + 0.5) / (n + 1.5)))
                    pdec = (b[2] + b[3] + b[4] + 0.5) / (n + 1.0)
                    isdec = m in DEC or w == "D"
                    per["pdec"][v].append(-math.log(pdec if isdec else 1 - pdec))
                di = dec_idx(w, m)
                if di is not None:
                    tot = dc.sum()
                    per["dectype"][v].append(-math.log((dc[di] + 0.5) / (tot + 3.5)))
                    da, db = dc[:3].sum(), dc[4:].sum()
                    pda = (da + 0.5) / (da + db + 1.0)
                    if w in ("A", "B"):
                        per["decwin"][v].append(-math.log(pda if w == "A" else 1 - pda))
                    pn = (tot - dc[0] - dc[6] + 0.5) / (tot + 1.0)
                    nonud = m in ("SD", "MD") or w == "D"
                    per["unan"][v].append(-math.log(pn if nonud else 1 - pn))
                    calib[v].append((pn, 1.0 if nonud else 0.0))
                # stat-line Poisson deviance (both sides; control in minutes)
                dev = 0.0
                for s in STATS:
                    for side, y in (("A", ya), ("B", yb)):
                        mu = max(1e-6, x["st"][side][s] / (60.0 if s == "ctrl" else 1.0))
                        yy = max(0.0, float(y.get(s, 0) or 0) / (60.0 if s == "ctrl" else 1.0))
                        dd = 2 * ((yy * math.log(yy / mu) if yy > 0 else 0.0) - (yy - mu))
                        dev += dd
                        statdev_by[v][s] += dd
                per["statdev"][v].append(dev)
                # base rates (predicted; fights with a result, as the actual table)
                if w not in ("A", "B", "D"):
                    continue
                B = base[v]
                B["n"] += 1
                B["ko"] += (b[0] + b[6]) / n
                B["sub"] += (b[1] + b[5]) / n
                B["dec"] += (b[2] + b[4]) / n
                B["draw"] += b[3] / n
                tot = dc.sum()
                if tot > 0:
                    B["UD"] += (dc[0] + dc[6]) / n
                    B["SD"] += (dc[1] + dc[5]) / n
                    B["MD"] += (dc[2] + dc[4]) / n
                    B["DRAWd"] += dc[3] / n
                    B["decn"] += tot / n
                B["n108"] += x["n108"] / n
                B["rj"] += x["rj"] / n
                fr = np.array(x["finR"], float) / n
                B["fin_r"][:len(fr)] += fr
                B["mins"] += x["mins"] / n
                B["kd"] += (x["st"]["A"]["kd"] + x["st"]["B"]["kd"])
            # actual base rates (once per orientation, so both tables weigh fights equally)
            A = base["actual"]
            if w in ("A", "B", "D"):
                A["n"] += 1
                isdec = m in DEC or w == "D"
                A["ko"] += 1.0 if (not isdec and m != "SUB") else 0.0
                A["sub"] += 1.0 if m == "SUB" else 0.0
                A["dec"] += 1.0 if m in DEC else 0.0
                A["draw"] += 1.0 if w == "D" else 0.0
                if isdec:
                    A["decn"] += 1
                    A[m if m in DEC else "DRAWd"] += 1
                    cards = res.get("cards") or []
                    if len(cards) == 3:
                        A["rj"] += 3 * nR
                        A["n108"] += sum(max(0, 19 * nR - (c[0] + c[1])) for c in cards)
                else:
                    A["fin_r"][res["round"] - 1] += 1
                A["mins"] += res["fight_s"] / 60.0
                A["kd"] += (act["A"].get("kd", 0) or 0) + (act["B"].get("kd", 0) or 0)
        for k in L:
            if all(len(per[k][v]) == 2 for v in VARS):
                for v in VARS:
                    L[k][v].append(float(np.mean(per[k][v])))
                G[k].append(r["event"])
        nfl += 1

    out = {"meta": {"fights": nfl, "shards": meta, "years": "2019-01-01..2023-12-31", "orientations": 2,
                    "smoothing": "probabilities from sim counts with +0.5 per cell"}, "metrics": {}, "diffs": {}}
    for k in L:
        out["metrics"][k] = {v: float(np.mean(L[k][v])) for v in VARS}
        out["metrics"][k]["n"] = len(G[k])
        out["diffs"][k] = {f"{x}-{y}": boot(np.array(L[k][x]) - np.array(L[k][y]), G[k]) for x, y in PAIRS}
    out["statdev_by_stat"] = {v: {s: statdev_by[v][s] / max(1, base[v]["n"]) for s in STATS} for v in VARS}
    bt_tab = {}
    for v, B in base.items():
        n = max(1, B["n"])
        rjd = B["rj"]
        bt_tab[v] = {"n": B["n"], "ko": B["ko"] / n, "sub": B["sub"] / n, "decision": B["dec"] / n, "draw": B["draw"] / n,
                     "UD|dec": B["UD"] / max(1e-9, B["decn"]), "SD|dec": B["SD"] / max(1e-9, B["decn"]), "MD|dec": B["MD"] / max(1e-9, B["decn"]),
                     "draw|dec": B["DRAWd"] / max(1e-9, B["decn"]), "10-8 per judge-round": B["n108"] / max(1e-9, rjd),
                     "finish R1..R5": (B["fin_r"] / n).tolist(), "minutes": B["mins"] / n, "kd per fight": B["kd"] / n}
    out["base_rates"] = bt_tab
    cal = {}
    for v in VARS:
        c = np.array(calib[v])
        qs = np.quantile(c[:, 0], [0, 0.2, 0.4, 0.6, 0.8, 1.0])
        rowsc = []
        for i in range(5):
            mask = (c[:, 0] >= qs[i]) & ((c[:, 0] < qs[i + 1]) if i < 4 else (c[:, 0] <= qs[i + 1]))
            rowsc.append([float(c[mask, 0].mean()), float(c[mask, 1].mean()), int(mask.sum())])
        cal[v] = {"mean_pred": float(c[:, 0].mean()), "obs": float(c[:, 1].mean()), "quintiles": rowsc}
    out["nonUD_calibration"] = cal
    if a.out:
        Path(a.out).write_text(json.dumps(out, indent=1))

    # markdown
    names = {"winner": "Winner log loss (decisive)", "soft": "Soft-label CE vs closing line", "bin7": "7-bin outcome log loss",
             "method": "Method log loss (KO/SUB/DEC)", "pdec": "P(decision) log loss", "dectype": "Decision outcome log loss (7-way | decision)",
             "decwin": "Winner log loss on decisions", "unan": "Unanimous vs split/majority/draw log loss (| decision)",
             "statdev": "Stat-line Poisson deviance (per fight, 10 stats x 2)"}
    md = ["| Metric | n | off (v4) | lg | jd | full | lg - off [95% CI] | jd - lg [95% CI] | full - jd [95% CI] | full - off [95% CI] |",
          "|---|---|---|---|---|---|---|---|---|---|"]
    for k, nm in names.items():
        M, D = out["metrics"][k], out["diffs"][k]

        def ci(x):
            return f"{x['mean']:+.4f} [{x['lo']:+.4f}, {x['hi']:+.4f}]"
        md.append(f"| {nm} | {M['n']} | {M['off']:.4f} | {M['lg']:.4f} | {M['jd']:.4f} | {M['full']:.4f} | {ci(D['lg-off'])} | "
                  f"{ci(D['jd-lg'])} | {ci(D['full-jd'])} | {ci(D['full-off'])} |")
    md.append("")
    md.append("| Base rate | actual | off (v4) | lg | jd | full |")
    md.append("|---|---|---|---|---|---|")
    for key in ["ko", "sub", "decision", "draw", "UD|dec", "SD|dec", "MD|dec", "draw|dec", "10-8 per judge-round", "minutes", "kd per fight"]:
        vals = [bt_tab[v][key] for v in ["actual"] + VARS]
        fmt = (lambda x: f"{x:.2f}") if key in ("minutes", "kd per fight") else (lambda x: f"{100 * x:.1f}%")
        md.append(f"| {key} | " + " | ".join(fmt(x) for x in vals) + " |")
    fr = ["finish R1..R5"]
    md.append("| finish by round | " + " | ".join("/".join(f"{100 * x:.1f}" for x in bt_tab[v]["finish R1..R5"][:5]) for v in ["actual"] + VARS) + " |")
    md.append("")
    md.append("| non-UD calibration (| decision) | mean predicted | observed | quintiles (pred/obs/n) |")
    md.append("|---|---|---|---|")
    for v in VARS:
        c = cal[v]
        md.append(f"| {v} | {100 * c['mean_pred']:.1f}% | {100 * c['obs']:.1f}% | " +
                  "; ".join(f"{100 * p:.0f}/{100 * o:.0f}/{n}" for p, o, n in c["quintiles"]) + " |")
    txt = "\n".join(md)
    if a.md:
        Path(a.md).write_text(txt + "\n")
    print(txt)
    del fr


if __name__ == "__main__":
    main()
