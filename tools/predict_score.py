#!/usr/bin/env python3
"""predict_score.py: metrics, paired event-cluster CIs, the forward-chained pool-weight fit and the v6 train gate for
tools/predict_harness.js outputs (docs/V6_V10_PLAN.md section 3, cycle 1).

    python3 tools/predict_score.py gate data/derived/v6/gate_train.json [--out data/derived/v6/gate_train_score.json]
    python3 tools/predict_score.py look data/derived/v6/look_val.json --wfile data/derived/v6/gate_train_score.json ...

Rules fixed BEFORE the full gate run was scored (written with the harness, Nov 7 2026 ~06:25 UTC):
- Scored years: 2021, 2022, 2023 (forward-chained: every weight that scores year Y is fit on 2019..Y-1).
- Pool weight w (v6 package only; the v5 package keeps its frozen 0.30): for scoring year Y, the w in {0, 0.05, ..., 1}
  minimising the joint method x round log loss (who x how x when) of the no-line package cells on 2019..Y-1 (all
  fights with an outcome); the same w is used in all three regimes. The look uses w fit on 2019-2023.
- Regimes: 'close' and 'open' are scored on fights that HAVE that line (no fallback rows); 'none' on all fights.
- Winner metrics on decisive fights (clip 1e-4); 7-bin, method (KO / SUB / DEC, a draw counts as DEC) and joint on fights
  with an outcome (cells normalised, clip 1e-6), as tools/predict_eval.js.
- Paired differences v6 - v5 with 2,000 event-cluster bootstrap resamples (cluster = card: event + date), seed 7.
- GATE (V6_V10_PLAN section 3, "Train-only acceptance test"), all must hold:
    open and no-line winner log loss: CI upper < 0 and point <= -0.001;
    close winner: CI upper <= +0.0005;
    7-bin: CI upper < 0 in EACH of the three regimes; method: CI upper <= +0.002 in each regime;
    (checked elsewhere, reported here when the files exist) corner swap < 1e-12, JS / Python S2 cells <= 1e-9 on 40 pairs,
    flag-off identity.
- Soft cross-entropy against the closing line is reported as a screen only (never decisive).
- Comparator inputs (fixed ~07:00 UTC, after the fold-honest refits made the two input pipelines differ; disclosed in the
  v6 version entry): each package runs on its OWN frozen input pipeline (its copy's mlpathrec.js and its version's
  learned-rate table), the convention of tools/evalv.js; the v5 package's MoE stacker was fit on engine rows from that
  pipeline. A run with shared inputs (the v6 pipeline fed to both packages) is reported as a sensitivity, never decisive.
"""
from __future__ import annotations

import json
import math
import os
import subprocess
import sys
import tempfile

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
GATE_YEARS = (2021, 2022, 2023)
W_GRID = [round(0.05 * k, 2) for k in range(21)]
PCLIP, CCLIP = 1e-4, 1e-6
KINDS = ("open", "none", "close")
CLS = {"KO": "KO", "DOC": "KO", "SUB": "SUB", "UD": "DEC", "SD": "DEC", "MD": "DEC", "DRAW": "DRAW"}


def outcome(r):
    res = r["result"]
    cls = CLS.get(res.get("method"))
    w = res.get("winner")
    if not cls or (cls != "DRAW" and w not in ("A", "B")):
        return None
    return {"winner": "D" if cls == "DRAW" else w, "cls": cls, "round": int(res.get("round") or 1)}


def cell_index(y, R):
    if y["cls"] == "DRAW":
        return 4 * R + 2
    if y["cls"] == "DEC":
        return 4 * R if y["winner"] == "A" else 4 * R + 1
    r = min(max(y["round"], 1), R) - 1
    sub = y["cls"] == "SUB"
    if y["winner"] == "A":
        return (R if sub else 0) + r
    return (3 * R if sub else 2 * R) + r


def bins7(c, R):
    return [sum(c[0:R]), sum(c[R:2 * R]), c[4 * R], c[4 * R + 2], c[4 * R + 1], sum(c[3 * R:4 * R]), sum(c[2 * R:3 * R])]


def k7(y):
    if y["cls"] == "DRAW":
        return 3
    if y["cls"] == "DEC":
        return 2 if y["winner"] == "A" else 4
    if y["cls"] == "SUB":
        return 1 if y["winner"] == "A" else 5
    return 0 if y["winner"] == "A" else 6


def cell_losses(c, R, y):
    c = np.asarray(c, float)
    c = c / c.sum()
    b7 = np.clip(np.asarray(bins7(c, R)), CCLIP, 1)
    s3 = {"KO": b7[0] + b7[6], "SUB": b7[1] + b7[5], "DEC": b7[2] + b7[3] + b7[4]}
    return {"bin7": -math.log(b7[k7(y)]), "method": -math.log(s3["DEC" if y["cls"] == "DRAW" else y["cls"]]),
            "joint": -math.log(max(c[cell_index(y, R)], CCLIP))}


def win_losses(p, y):
    if y["winner"] not in ("A", "B") or p is None:
        return None
    yy = 1.0 if y["winner"] == "A" else 0.0
    q = min(max(p, PCLIP), 1 - PCLIP)
    return {"winLL": -(yy * math.log(q) + (1 - yy) * math.log(1 - q)), "brier": (q - yy) ** 2,
            "acc": 0.5 if q == 0.5 else float((q > 0.5) == (yy == 1.0)), "_p": q, "_y": yy}


def pool(simR, mrR, w):
    a, b = np.asarray(simR, float), np.asarray(mrR, float)
    return w * a + (1 - w) * b


def fit_w(recs, pk, years):
    """w in W_GRID minimising the no-line joint log loss over fights of `years` (v6 package)."""
    best = None
    rows = [(r, outcome(r)) for r in recs if int(r["date"][:4]) in years and pk in r["pk"] and r["pk"][pk].get("none")]
    rows = [(r, y) for r, y in rows if y is not None and r["pk"][pk]["none"]["mrR"]]
    for w in W_GRID:
        tot = 0.0
        for r, y in rows:
            e = r["pk"][pk]["none"]
            tot += cell_losses(pool(e["simR"], e["mrR"], w), r["rounds"], y)["joint"]
        m = tot / max(1, len(rows))
        if best is None or m < best[1] - 1e-12:
            best = (w, m)
    return {"w": best[0], "joint": round(best[1], 5), "n": len(rows), "years": list(years)}


def cluster_boot(groups, cols, B=2000, seed=7):
    """Event-cluster bootstrap of column means: cols = dict name -> per-row array (rows aligned with groups)."""
    keys = sorted(set(groups))
    idx = {k: [] for k in keys}
    for i, g in enumerate(groups):
        idx[g].append(i)
    G = [np.array(idx[k]) for k in keys]
    rng = np.random.default_rng(seed)
    sums = {c: np.array([v[g].sum() for g in G]) for c, v in cols.items()}
    cnt = np.array([len(g) for g in G], float)
    out = {c: np.empty(B) for c in cols}
    for b in range(B):
        k = rng.integers(0, len(G), len(G))
        n = cnt[k].sum()
        for c in cols:
            out[c][b] = sums[c][k].sum() / n
    return out


def ci(a):
    return [round(float(np.percentile(a, 2.5)), 5), round(float(np.percentile(a, 97.5)), 5)]


def calib(ps, ys):
    ps, ys = np.asarray(ps), np.asarray(ys)
    if len(ps) == 0:
        return None, None
    P = np.r_[ps, 1 - ps]
    Y = np.r_[ys, 1 - ys]
    bins = np.minimum(9, (P * 10).astype(int))
    e = sum(abs(P[bins == b].mean() - Y[bins == b].mean()) * (bins == b).sum() for b in range(10) if (bins == b).any()) / len(P)
    x = np.log(P / (1 - P))
    beta = 1.0
    for _ in range(40):
        q = 1 / (1 + np.exp(-beta * x))
        beta += ((Y - q) * x).sum() / max(1e-9, (q * (1 - q) * x * x).sum())
    return round(float(e), 4), round(float(beta), 3)


def score_kind(recs, kind, pkgs, wmap, years):
    """Per-row losses for each package on `kind` rows of `years`, paired. wmap: {pkg: {year: w}} (None = as run)."""
    rows = []
    for r in recs:
        yr = int(r["date"][:4])
        if yr not in years or r.get("err"):
            continue
        y = outcome(r)
        if y is None:
            continue
        es = [r["pk"].get(p, {}).get(kind) for p in pkgs]
        if any(e is None for e in es):
            continue
        if kind != "none" and any(e["lineMissing"] for e in es):
            continue
        rows.append((r, y, es, yr))
    L = {p: {"winLL": [], "brier": [], "acc": [], "bin7": [], "method": [], "joint": [], "soft": [], "_p": [], "_y": [], "dec": []} for p in pkgs}
    groups = []
    for r, y, es, yr in rows:
        groups.append((r["event"] or "") + "|" + r["date"])
        close = None
        if kind == "close":
            close = es[0]["line"]
        for p, e in zip(pkgs, es):
            w = wmap.get(p, {}).get(yr) if wmap.get(p) else None
            c = pool(e["simR"], e["mrR"], w) if (w is not None and e["mrR"]) else np.asarray(e["cells"], float)
            cl = cell_losses(c, r["rounds"], y)
            wl = win_losses(e["p"], y)
            for k in ("bin7", "method", "joint"):
                L[p][k].append(cl[k])
            if wl:
                for k in ("winLL", "brier", "acc", "_p", "_y"):
                    L[p][k].append(wl[k])
                L[p]["dec"].append(1.0)
                if close is not None:
                    q = min(max(close, PCLIP), 1 - PCLIP)
                    pp = min(max(e["p"], PCLIP), 1 - PCLIP)
                    L[p]["soft"].append(-(q * math.log(pp) + (1 - q) * math.log(1 - pp)))
                else:
                    L[p]["soft"].append(float("nan"))
            else:
                for k in ("winLL", "brier", "acc", "_p", "_y", "soft"):
                    L[p][k].append(float("nan"))
                L[p]["dec"].append(0.0)
    groups = np.array(groups)
    out = {"n_outcome": len(rows), "n_decisive": int(sum(L[pkgs[0]]["dec"])), "n_cards": int(len(set(groups))), "packages": {}}
    for p in pkgs:
        a = {k: np.asarray(v, float) for k, v in L[p].items()}
        dm = a["dec"] > 0
        e, s = calib(a["_p"][dm], a["_y"][dm])
        out["packages"][p] = {"winLL": round(float(np.nanmean(a["winLL"])), 5), "brier": round(float(np.nanmean(a["brier"])), 5),
                              "acc": round(float(np.nanmean(a["acc"])), 4), "ece": e, "slope": s,
                              "bin7": round(float(a["bin7"].mean()), 5), "method": round(float(a["method"].mean()), 5),
                              "joint": round(float(a["joint"].mean()), 5)}
        if kind == "close":
            out["packages"][p]["softCE_vs_close"] = round(float(np.nanmean(a["soft"])), 5)
    if len(pkgs) == 2:
        p1, p0 = pkgs
        A1 = {k: np.asarray(L[p1][k], float) for k in L[p1]}
        A0 = {k: np.asarray(L[p0][k], float) for k in L[p0]}
        dm = A1["dec"] > 0
        cols = {}
        for k in ("bin7", "method", "joint"):
            cols[k] = A1[k] - A0[k]
        for k in ("winLL", "brier", "acc", "soft"):
            d = np.where(dm, A1[k] - A0[k], 0.0)
            cols[k] = d
        cols["_dec"] = dm.astype(float)
        bs = cluster_boot(groups, cols)
        dif = {}
        for k in ("bin7", "method", "joint"):
            dif[k] = {"diff": round(float(cols[k].mean()), 5), "ci": ci(bs[k])}
        for k in ("winLL", "brier", "acc") + (("soft",) if kind == "close" else ()):
            # decisive-only mean = sum(d) / n_decisive within each resample
            m = cols[k].sum() / max(1.0, cols["_dec"].sum())
            ratio = bs[k] / np.maximum(bs["_dec"], 1e-12)
            dif[k] = {"diff": round(float(m), 5), "ci": ci(ratio)}
        out["paired"] = {"%s - %s" % (p1, p0): dif}
    return out


def methodround_score(recs, pk, kind, wmap, years, d0, d1):
    sub = {}
    for r in recs:
        yr = int(r["date"][:4])
        if yr not in years or r.get("err") or pk not in r["pk"] or not r["pk"][pk].get(kind):
            continue
        e = r["pk"][pk][kind]
        if kind != "none" and e["lineMissing"]:
            continue
        w = wmap.get(pk, {}).get(yr) if wmap.get(pk) else None
        c = pool(e["simR"], e["mrR"], w) if (w is not None and e["mrR"]) else np.asarray(e["cells"], float)
        sub[r["id"]] = {"cells": [float(x) for x in c / c.sum()]}
    with tempfile.TemporaryDirectory() as td:
        inp, outp = os.path.join(td, "in.json"), os.path.join(td, "out.json")
        json.dump(sub, open(inp, "w"))
        subprocess.run([sys.executable, os.path.join(HERE, "methodround.py"), "--score", inp, "--score-from", d0,
                        "--score-until", d1, "--score-out", outp, "--backtest", os.path.join(ROOT, "data/derived/backtest_dev.json")],
                       check=True, capture_output=True, env=dict(os.environ, OMP_NUM_THREADS="1"))
        return json.load(open(outp))


def gate(path, out=None):
    D = json.load(open(path))
    recs = D["fights"]
    pk_names = [p["name"] for p in D["meta"]["packages"]]
    v6 = [p["name"] for p in D["meta"]["packages"] if p["mode"] == "v6"][0]
    v5 = [p["name"] for p in D["meta"]["packages"] if p["mode"] == "v5"][0]
    pkgs = [v6, v5]
    # forward-chained pool weight for the v6 package
    wfit = {Y: fit_w(recs, v6, tuple(range(2019, Y))) for Y in GATE_YEARS}
    wfit_all = fit_w(recs, v6, tuple(range(2019, 2024)))
    wmap = {v6: {Y: wfit[Y]["w"] for Y in GATE_YEARS}, v5: None}
    res = {"meta": {"tool": "tools/predict_score.py gate", "input": os.path.relpath(path, ROOT), "harness": D["meta"],
                    "rules": __doc__.split("Rules fixed")[1].split("\"\"\"")[0].strip() if "Rules fixed" in __doc__ else None},
           "pool_weight": {"by_year": {str(Y): wfit[Y] for Y in GATE_YEARS}, "fit_2019_2023": wfit_all},
           "regimes": {}, "by_year": {}}
    for kind in KINDS:
        res["regimes"][kind] = score_kind(recs, kind, pkgs, wmap, set(GATE_YEARS))
        for Y in GATE_YEARS:
            res["by_year"].setdefault(str(Y), {})[kind] = {p: v for p, v in score_kind(recs, kind, pkgs, wmap, {Y})["packages"].items()}
    # who x how x when vs model S (methodround --score), each package, 2021-2023
    res["methodround"] = {}
    for kind in KINDS:
        for p in pkgs:
            try:
                res["methodround"]["%s|%s" % (p, kind)] = methodround_score(recs, p, kind, wmap, set(GATE_YEARS), "2021-01-01", "2024-01-01")
            except Exception as e:  # noqa: BLE001
                res["methodround"]["%s|%s" % (p, kind)] = {"error": str(e)[:300]}
    # gate verdict
    key = "%s - %s" % (v6, v5)
    P = {k: res["regimes"][k]["paired"][key] for k in KINDS}
    checks = {
        "open winner: CI upper < 0 and point <= -0.001": P["open"]["winLL"]["ci"][1] < 0 and P["open"]["winLL"]["diff"] <= -0.001,
        "no-line winner: CI upper < 0 and point <= -0.001": P["none"]["winLL"]["ci"][1] < 0 and P["none"]["winLL"]["diff"] <= -0.001,
        "close winner: CI upper <= +0.0005": P["close"]["winLL"]["ci"][1] <= 0.0005,
    }
    for k in KINDS:
        checks["7-bin (%s): CI upper < 0" % k] = P[k]["bin7"]["ci"][1] < 0
        checks["method (%s): CI upper <= +0.002" % k] = P[k]["method"]["ci"][1] <= 0.002
    res["gate"] = {"checks": checks, "pass": all(checks.values())}
    if out:
        json.dump(res, open(out, "w"), indent=1)
    return res


def show(res):
    print("pool weight by year:", {k: v["w"] for k, v in res["pool_weight"]["by_year"].items()}, "| 2019-2023:", res["pool_weight"]["fit_2019_2023"])
    for kind, R in res["regimes"].items():
        print("== %s: n outcome %d, decisive %d, cards %d" % (kind, R["n_outcome"], R["n_decisive"], R["n_cards"]))
        for p, m in R["packages"].items():
            print("   %-6s %s" % (p, m))
        for k, d in R.get("paired", {}).items():
            print("   %s: %s" % (k, {m: (v["diff"], v["ci"]) for m, v in d.items()}))
    for k, v in res.get("gate", {}).get("checks", {}).items():
        print("  [%s] %s" % ("PASS" if v else "FAIL", k))
    if "gate" in res:
        print("GATE:", "PASS" if res["gate"]["pass"] else "FAIL")


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["gate"])
    ap.add_argument("path")
    ap.add_argument("--out")
    a = ap.parse_args()
    if a.cmd == "gate":
        show(gate(a.path, a.out))


if __name__ == "__main__":
    main()
