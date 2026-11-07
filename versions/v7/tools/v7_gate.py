#!/usr/bin/env python3
"""v7_gate.py: the engine v7 train gate (docs/V6_V10_PLAN.md section 3, cycle 1 re-bundled onto the v4 simulator + cycle 2, market
props for how and when; 7.1 item 10) on a tools/predict_harness.js run that holds the v7 package (mode v7: cycle-1 cells with props
OFF, the bout's de-vigged props consensus recorded per fight) and the honest v4 package (mode cmp4) on 2019-2023.

    python3 tools/v7_gate.py fits  <harness.json> [--out f.json]        pool / props weight fits only (no metric, no comparator)
    python3 tools/v7_gate.py gate  <harness.json> --out <score.json> [--tests <tests.json>]     THE gate (binding once, by protocol)
    python3 tools/v7_gate.py power <score.json> --n-look N [--effect E] [--contrast primary|props]

RULES (written before any v7 gate metric was computed; committed with the protocol file data/derived/v7/gate_protocol.json):
- Packages. v7 = FightEngine.predict of versions/v7 (winner: the ML v2 head stack of the line regime, data/derived/v6_stacks.json,
  forward-chained by year; method x round: w x rescaled v4-simulator cells + (1 - w) x rescaled S2 cells; then, where the bout has
  method props, the props pool: method given the winner = joint-linear pool [pi, 1 - pi] of the cells' and the props' mixes, each
  weighted by its own P(side wins); round shapes from the cells; draw = drawC x P(decision); decShift 0). v7np = the same package
  with props off (cycle 1's cells). cmp4 = the honest v4 package (the latest kept version's package composition: MoE expert stack
  by line regime with the v4 engine as an expert, per-year stackers fit on 2019..Y-1 with this simulator's evalv rows; methodround
  S / SM cells; w x rescaled simulator cells + (1 - w) x rescaled S / SM cells). One simulator for all three (common random numbers).
- Forward-chained weights (every weight that scores year Y is fit on years before Y):
    w (each package, its own): the w in {0, 0.05, ..., 1} minimising the no-line package's joint method x round log loss (who x how
      x when) on 2019..Y-1 (all fights with an outcome) - the rule of tools/predict_score.py fit_w; the same w in every regime;
    pi (v7): the props-pool weight on the cells, pi in {0, 0.01, ..., 1}, minimising the method-given-the-winner log loss of the
      pooled method mix on CLOSE-regime fights of 2021..Y-1 that have a closing line, method props (m6) and a decisive outcome, the
      cells pooled with that year's w (the package as refit at the start of year Y); props start in 2021, so pi exists for 2022
      and 2023 only; ties keep the smaller pi.
    The look (2024-25) uses w fit on 2019-2023 and pi fit on 2021-2023 (written into versions/v7/params3.js before the freeze).
- Rows. Winner metrics on decisive fights (clip 1e-4); 7-bin, method (KO / SUB / DEC, a draw counts as DEC) and joint on fights
  with an outcome (cells normalised, clip 1e-6); round given a finish (methodround's unsided round | finish) on finishes; P(decision)
  = A DEC + B DEC + DRAW cells, observed = UD / SD / MD / DRAW. 'close' / 'open' rows need that line for every package (no fallback
  rows); 'none' takes all fights; 'close+props' = close rows whose bout has method props.
- Intervals. Paired differences, 20,000 event-cluster bootstrap resamples (cluster = card: event + date), seed 7; Monte Carlo SE of
  each bound (10 batches); a bound within 2 Monte Carlo SE of its threshold is marginal and decided by the clustered normal bound
  (tools/predict_score.py check_upper, the v6-review rule).
- GATE (all must hold):
  C1, cycle 1's parts on the v4 simulator (V6_V10_PLAN section 3, cycle 1 "Train-only acceptance test"; scored years 2021-2023;
     v7np minus cmp4):
       open and no-line winner log loss: CI upper < 0 and point <= -0.001; close winner: CI upper <= +0.0005;
       7-bin: CI upper < 0 in EACH regime; method: CI upper <= +0.002 in each regime.
  C2, cycle 2 (section 3, cycle 2 "Train-only acceptance test"; forward folds: fit 2021 -> score 2022, fit 2021-22 -> score 2023;
     close+props rows; v7 minus v7np, the winner held fixed so this is method given the winner):
       7-bin: CI upper < 0; method: CI upper <= +0.003 (the 7.1 item 4 "not worse" tolerance);
       round given a finish: CI upper <= +0.002; P(decision): |mean predicted - observed| <= 0.02 pooled over the scored rows;
       winner bit-identical: the composed cells give P(A) / (P(A) + P(B)) = p within 1e-12 on every row, and v7np's p equals the v6
       package's p (data/derived/v6/gate_train.json, 9 decimals) on every shared fight x regime row where both are 'ml2stack'.
  T, checks from tests/test_v7.js on the frozen files (--tests): simulator identity with versions/v4, flag-off identities, corner
     swap < 1e-12 (props on and off), S2 JS = Python <= 1e-9 on 40 rows; and here: the Python props composition = the shipped JS
     (versions/v7/ml/blend.js applyProps) <= 1e-9 on every C2 row.
- Reported, never decisive: the look's primary contrast on train (v7 minus cmp4, close+props, 2022-2023: 7-bin, method, joint,
  winner) and its power; open+props and none+props (v7 minus v7np, the close-fit pi); leave-one-year-out pi over 2021-2023; a
  forward-chained decShift fit (labeled knob, stays 0); by-year rows; who x how x when vs methodround model S (tools/methodround.py
  --score); soft CE vs the close (screen).
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
sys.path.insert(0, HERE)
import predict_score as PS  # noqa: E402

PCLIP, CCLIP = 1e-4, 1e-6
W_GRID = [round(0.05 * k, 2) for k in range(21)]
PI_GRID = [round(0.01 * k, 2) for k in range(101)]
C1_YEARS = (2021, 2022, 2023)
C2_YEARS = (2022, 2023)
PROPS_FROM = 2021
DRAW_C = 0.01457
TOL = {"method_c2": 0.003, "rgf_c2": 0.002, "pdec_c2": 0.02, "close_c1": 0.0005, "method_c1": 0.002}


# ------------------------------------------------------------------ outcomes and losses
def outcome(r):
    return PS.outcome(r)


def mcls(y):
    return {"KO": 0, "SUB": 1, "DEC": 2, "DRAW": 2}[y["cls"]]


def row_losses(c, R, y, p):
    """Every per-row loss / statistic for cells c (package layout), winner p, outcome y."""
    c = np.asarray(c, float)
    c = c / c.sum()
    out = PS.cell_losses(c, R, y)
    fin = [c[r] + c[R + r] + c[2 * R + r] + c[3 * R + r] for r in range(R)]
    pfin = sum(fin)
    out["pdec"] = float(c[4 * R] + c[4 * R + 1] + c[4 * R + 2])
    out["ydec"] = 1.0 if y["cls"] in ("DEC", "DRAW") else 0.0
    if y["cls"] in ("KO", "SUB"):
        r = min(max(y["round"], 1), R) - 1
        out["rgf"] = -math.log(max(fin[r] / max(pfin, 1e-12), CCLIP))
    else:
        out["rgf"] = float("nan")
    wl = PS.win_losses(p, y)
    if wl:
        out.update({k: wl[k] for k in ("winLL", "brier", "acc")})
        # method given the winner
        s = 0 if y["winner"] == "A" else 1
        base = 0 if s == 0 else 2 * R
        ko = sum(c[base:base + R])
        sub = sum(c[base + R:base + 2 * R])
        dec = c[4 * R + s]
        tot = ko + sub + dec
        m = [ko / tot, sub / tot, dec / tot]
        out["mgw"] = -math.log(max(m[mcls(y)], CCLIP))
    else:
        for k in ("winLL", "brier", "acc", "mgw"):
            out[k] = float("nan")
    return out


# ------------------------------------------------------------------ the props composition (Python port of src/ml/propspool.js +
# src/ml/blend.js applyProps; checked against the shipped JS on every scored row)
def to_mr(c, R):
    M, Rs, tots = [], [], []
    for s in (0, 1):
        base = 0 if s == 0 else 2 * R
        ko = list(c[base:base + R]) + [0.0] * (5 - R)
        sub = list(c[base + R:base + 2 * R]) + [0.0] * (5 - R)
        dec = c[4 * R + s]
        k, b = sum(ko), sum(sub)
        tot = k + b + dec
        M.append([k / tot, b / tot, dec / tot])
        Rs.append([[x / max(k, 1e-12) for x in ko], [x / max(b, 1e-12) for x in sub]])
        tots.append(tot)
    return M, Rs, tots[0] / (tots[0] + tots[1])


def props_M(m6):
    a, b = m6[0:3], m6[3:6]
    sa, sb = sum(a), sum(b)
    return [[x / sa for x in a], [x / sb for x in b]]


def pool_jlin(Mc, Mp, w, Wsrc, beta=(0.0, 0.0, 0.0)):
    out = []
    for s in (0, 1):
        cw = [w[j] * (Wsrc[j] if s == 0 else 1 - Wsrc[j]) for j in (0, 1)]
        tot = cw[0] + cw[1]
        out.append([(cw[0] * Mc[s][k] + cw[1] * Mp[s][k]) / tot for k in range(3)])
    if any(b != 0 for b in beta):
        for s in (0, 1):
            e = [out[s][k] * math.exp(beta[k]) for k in range(3)]
            t = sum(e)
            out[s] = [x / t for x in e]
    return out


def compose(p, M, Rs, R, draw_c):
    P = [0.0] * 23
    Wm = [p, 1 - p]
    draw = draw_c * (Wm[0] * M[0][2] + Wm[1] * M[1][2])
    nd = 1 - draw
    for s, (bko, bsub, bdec) in enumerate(((0, 5, 20), (10, 15, 21))):
        ws = nd * Wm[s]
        for r in range(5):
            P[bko + r] = ws * M[s][0] * Rs[s][0][r]
            P[bsub + r] = ws * M[s][1] * Rs[s][1][r]
        P[bdec] = ws * M[s][2]
    P[22] = draw
    if R == 3:
        for b in (0, 5, 10, 15):
            P[b + 3] = 0.0
            P[b + 4] = 0.0
    t = sum(P)
    P = [x / t for x in P]
    out = [0.0] * (4 * R + 3)
    for r in range(R):
        out[r], out[R + r], out[2 * R + r], out[3 * R + r] = P[r], P[5 + r], P[10 + r], P[15 + r]
    out[4 * R], out[4 * R + 1], out[4 * R + 2] = P[20], P[21], P[22]
    return out


def apply_props(cells, R, p, m6, pi, dec_shift=0.0, draw_c=DRAW_C):
    Mc, Rs, p_own = to_mr(list(cells), R)
    Mp = props_M(m6)
    Wp = sum(m6[0:3]) / sum(m6)
    w = [pi, 1 - pi]
    M = pool_jlin(Mc, Mp, w, [p_own, Wp], (0.0, 0.0, dec_shift))
    return compose(p, M, Rs, R, draw_c), M


def has_props(r):
    pr = r.get("props") or {}
    m6 = pr.get("m6")
    return isinstance(m6, list) and len(m6) == 6 and all(isinstance(x, (int, float)) and x >= 0 for x in m6) and sum(m6) > 0


# ------------------------------------------------------------------ fits
def fit_w(recs, pk, years):
    return PS.fit_w(recs, pk, tuple(years))


def pooled(e, w):
    return PS.pool(e["simR"], e["mrR"], w) if (w is not None and e.get("mrR")) else np.asarray(e["cells"], float)


def fit_pi(recs, v7, years, w, dec_shift=0.0):
    rows = []
    for r in recs:
        if int(r["date"][:4]) not in years or r.get("err") or not has_props(r):
            continue
        e = (r["pk"].get(v7) or {}).get("close")
        if not e or e.get("lineMissing"):
            continue
        y = outcome(r)
        if y is None or y["winner"] not in ("A", "B"):
            continue
        Mc, Rs, p_own = to_mr(list(pooled(e, w)), r["rounds"])
        m6 = r["props"]["m6"]
        rows.append((Mc, props_M(m6), [p_own, sum(m6[0:3]) / sum(m6)], 0 if y["winner"] == "A" else 1, mcls(y)))
    best = None
    for pi in PI_GRID:
        tot = 0.0
        for Mc, Mp, Ws, s, k in rows:
            M = pool_jlin(Mc, Mp, [pi, 1 - pi], Ws, (0.0, 0.0, dec_shift))
            tot += -math.log(max(M[s][k], CCLIP))
        m = tot / max(1, len(rows))
        if best is None or m < best[1] - 1e-12:
            best = (pi, m)
    return {"pi": best[0], "mgw": round(best[1], 5), "n": len(rows), "years": list(years), "w_cells_pool": w}


def fit_dec_shift(recs, v7, years, w, pi):
    """Labeled-knob diagnostic: the DEC logit shift in {-0.5, ..., 0.5} (step 0.01) minimising method given the winner on top of
    the props pool (same rows as fit_pi). Reported only; params keep decShift 0."""
    grid = [round(-0.5 + 0.01 * k, 2) for k in range(101)]
    rows = []
    for r in recs:
        if int(r["date"][:4]) not in years or r.get("err") or not has_props(r):
            continue
        e = (r["pk"].get(v7) or {}).get("close")
        if not e or e.get("lineMissing"):
            continue
        y = outcome(r)
        if y is None or y["winner"] not in ("A", "B"):
            continue
        Mc, Rs, p_own = to_mr(list(pooled(e, w)), r["rounds"])
        m6 = r["props"]["m6"]
        rows.append((Mc, props_M(m6), [p_own, sum(m6[0:3]) / sum(m6)], 0 if y["winner"] == "A" else 1, mcls(y)))
    best = None
    for b in grid:
        tot = sum(-math.log(max(pool_jlin(Mc, Mp, [pi, 1 - pi], Ws, (0.0, 0.0, b))[s][k], CCLIP)) for Mc, Mp, Ws, s, k in rows)
        m = tot / max(1, len(rows))
        if best is None or m < best[1] - 1e-12:
            best = (b, m)
    return {"decShift": best[0], "mgw": round(best[1], 5), "n": len(rows), "years": list(years)}


def all_fits(recs, v7, cmp):
    out = {"w": {}, "pi": {}}
    for name in [x for x in (v7, cmp) if x]:
        out["w"][name] = {str(Y): fit_w(recs, name, range(2019, Y)) for Y in C1_YEARS}
        out["w"][name]["fit_2019_2023"] = fit_w(recs, name, range(2019, 2024))
    for Y in C2_YEARS:
        wY = out["w"][v7][str(Y)]["w"]
        out["pi"][str(Y)] = fit_pi(recs, v7, range(PROPS_FROM, Y), wY)
    out["pi"]["fit_2021_2023"] = fit_pi(recs, v7, range(PROPS_FROM, 2024), out["w"][v7]["fit_2019_2023"]["w"])
    return out


# ------------------------------------------------------------------ package cells per row
def package_cells(r, kind, pkg, fits, v7, mode):
    """mode: 'np' (props off, forward-chained w), 'props' (props on where the bout has props, forward-chained w and pi),
    'cmp' (the comparator, its own w). Returns (cells, p, props_applied) or None."""
    yr = int(r["date"][:4])
    e = (r["pk"].get(pkg) or {}).get(kind)
    if not e:
        return None
    w = fits["w"][pkg].get(str(yr), {}).get("w") if str(yr) in fits["w"][pkg] else None
    if w is None:
        return None
    c = pooled(e, w)
    if mode == "props" and has_props(r):
        pi = (fits["pi"].get(str(yr)) or {}).get("pi")
        if pi is None:
            return None
        c2, _ = apply_props(c, r["rounds"], e["p"], r["props"]["m6"], pi)
        return np.asarray(c2), e["p"], True
    return np.asarray(c, float), e["p"], False


# ------------------------------------------------------------------ paired scoring
METRICS = ("winLL", "brier", "acc", "bin7", "method", "joint", "rgf", "mgw", "pdec", "ydec", "soft")
DEC_METRICS = ("winLL", "brier", "acc", "mgw", "soft")


def paired(rows, names, years, kind):
    """rows: list of (record, outcome, {pkg: (cells, p)}); returns levels, paired diffs (names[0] - names[1]) with CIs."""
    L = {n: {m: [] for m in METRICS} for n in names}
    groups, dec, fin = [], [], []
    for r, y, cp in rows:
        groups.append((r["event"] or "") + "|" + r["date"])
        dec.append(1.0 if y["winner"] in ("A", "B") else 0.0)
        fin.append(1.0 if y["cls"] in ("KO", "SUB") else 0.0)
        close = None
        if kind.startswith("close"):
            for pv in r["pk"].values():
                e0 = (pv or {}).get("close")
                if e0 and e0.get("line") is not None and not e0.get("lineMissing"):
                    close = e0["line"]
                    break
        for n in names:
            c, p = cp[n]
            lo = row_losses(c, r["rounds"], y, p)
            if close is not None and y["winner"] in ("A", "B"):
                q = min(max(close, PCLIP), 1 - PCLIP)
                pp = min(max(p, PCLIP), 1 - PCLIP)
                lo["soft"] = -(q * math.log(pp) + (1 - q) * math.log(1 - pp))
            else:
                lo["soft"] = float("nan")
            for m in METRICS:
                L[n][m].append(lo[m])
    groups = np.array(groups)
    dec, fin = np.asarray(dec), np.asarray(fin)
    out = {"kind": kind, "years": list(years), "n_outcome": len(rows), "n_decisive": int(dec.sum()), "n_finish": int(fin.sum()),
           "n_cards": int(len(set(groups.tolist()))), "packages": {}}
    for n in names:
        a = {m: np.asarray(v, float) for m, v in L[n].items()}
        dm = dec > 0
        ps = np.array([cp[n][1] for _, _, cp in rows])
        ys = np.array([1.0 if y["winner"] == "A" else 0.0 for _, y, _ in rows])
        e, s = PS.calib(ps[dm], ys[dm])
        out["packages"][n] = {"winLL": round(float(np.nanmean(a["winLL"])), 5), "brier": round(float(np.nanmean(a["brier"])), 5),
                              "acc": round(float(np.nanmean(a["acc"])), 4), "ece": e, "slope": s, "bin7": round(float(a["bin7"].mean()), 5),
                              "method": round(float(a["method"].mean()), 5), "joint": round(float(a["joint"].mean()), 5),
                              "rgf": round(float(np.nanmean(a["rgf"])), 5) if fin.sum() else None, "mgw": round(float(np.nanmean(a["mgw"])), 5),
                              "pdec": round(float(a["pdec"].mean()), 4), "ydec": round(float(a["ydec"].mean()), 4)}
        if kind.startswith("close"):
            out["packages"][n]["softCE_vs_close"] = round(float(np.nanmean(a["soft"])), 5)
    if len(names) == 2 and len(rows):
        n1, n0 = names
        A1 = {m: np.asarray(L[n1][m], float) for m in METRICS}
        A0 = {m: np.asarray(L[n0][m], float) for m in METRICS}
        cols = {"_dec": dec, "_fin": fin}
        for m in ("bin7", "method", "joint"):
            cols[m] = A1[m] - A0[m]
        for m in DEC_METRICS:
            cols[m] = np.where(dec > 0, np.nan_to_num(A1[m] - A0[m]), 0.0)
        cols["rgf"] = np.where(fin > 0, np.nan_to_num(A1["rgf"] - A0["rgf"]), 0.0)
        cols["pdec1"] = A1["pdec"] - A1["ydec"]
        cols["pdec0"] = A0["pdec"] - A0["ydec"]
        bs = PS.cluster_boot(groups, cols)
        ones = np.ones(len(groups))
        dif = {}
        for m in ("bin7", "method", "joint"):
            dif[m] = {"diff": round(float(cols[m].mean()), 5), "ci": PS.ci(bs[m]), "ci_mcse": PS.ci_mcse(bs[m]),
                      "normal": PS.normal_ci(groups, cols[m], ones)}
        for m in DEC_METRICS + ("rgf",):
            if m == "soft" and not kind.startswith("close"):
                continue
            den = cols["_fin"] if m == "rgf" else cols["_dec"]
            bden = bs["_fin"] if m == "rgf" else bs["_dec"]
            mm = cols[m].sum() / max(1.0, den.sum())
            ratio = bs[m] / np.maximum(bden, 1e-12)
            dif[m] = {"diff": round(float(mm), 5), "ci": PS.ci(ratio), "ci_mcse": PS.ci_mcse(ratio), "normal": PS.normal_ci(groups, cols[m], den)}
        for k, col in (("pdec_bias_" + n1, "pdec1"), ("pdec_bias_" + n0, "pdec0")):
            dif[k] = {"diff": round(float(cols[col].mean()), 5), "ci": PS.ci(bs[col])}
        out["paired"] = {"%s - %s" % (n1, n0): dif}
        out["boot"] = dict(PS.BOOT)
    return out


def collect(recs, kind, years, spec, fits, v7, need_props=False):
    """spec: list of (name, pkg, mode). Rows where every package has cells (and the line for close / open)."""
    rows = []
    for r in recs:
        yr = int(r["date"][:4])
        if yr not in years or r.get("err"):
            continue
        y = outcome(r)
        if y is None:
            continue
        if need_props and not has_props(r):
            continue
        cp, ok = {}, True
        for name, pkg, mode in spec:
            e = (r["pk"].get(pkg) or {}).get(kind)
            if not e or (kind != "none" and e.get("lineMissing")):
                ok = False
                break
            pc = package_cells(r, kind, pkg, fits, v7, mode)
            if pc is None:
                ok = False
                break
            cp[name] = (pc[0], pc[1])
        if ok:
            rows.append((r, y, cp))
    return rows


def methodround_cells(rows, name, d0, d1):
    sub = {r["id"]: {"cells": [float(x) for x in (cp[name][0] / cp[name][0].sum())]} for r, _, cp in rows}
    with tempfile.TemporaryDirectory() as td:
        inp, outp = os.path.join(td, "in.json"), os.path.join(td, "out.json")
        json.dump(sub, open(inp, "w"))
        subprocess.run([sys.executable, os.path.join(HERE, "methodround.py"), "--score", inp, "--score-from", d0, "--score-until", d1,
                        "--score-out", outp, "--backtest", os.path.join(ROOT, "data/derived/backtest_dev.json")],
                       check=True, capture_output=True, env=dict(os.environ, OMP_NUM_THREADS="1"))
        return json.load(open(outp))


def js_parity(rows, blend_path):
    """The Python props composition vs the shipped JS (FightBlend.applyProps) on every row: max |cell difference|."""
    items = []
    for r, y, cp in rows:
        items.append({"cells": [float(x) for x in cp["_off"][0]], "R": r["rounds"], "p": float(cp["_off"][1]), "m6": r["props"]["m6"],
                      "pi": cp["_pi"], "py": [float(x) for x in cp["v7"][0]]})
    js = ("const FB=require(process.argv[1]);const fs=require('fs');const D=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));"
          "let mx=0,n=0;for(const it of D){const o=FB.applyProps(it.cells,it.R,it.p,{m6:it.m6},{mode:'jlin',w:[it.pi,1-it.pi],decShift:0,drawC:%r});"
          "if(!o.rec.applied)throw new Error('not applied');for(let i=0;i<o.cells.length;i++)mx=Math.max(mx,Math.abs(o.cells[i]-it.py[i]));"
          "const s=o.cells,R=it.R;let a=0,b=0;for(let i=0;i<2*R;i++){a+=s[i];b+=s[2*R+i];}a+=s[4*R];b+=s[4*R+1];"
          "mx=Math.max(mx,0);n++;if(Math.abs(a/(a+b)-it.p)>1e-12)throw new Error('winner moved '+(a/(a+b)-it.p));}"
          "console.log(JSON.stringify({n:n,max_abs_diff:mx}));") % DRAW_C
    with tempfile.TemporaryDirectory() as td:
        f = os.path.join(td, "rows.json")
        json.dump(items, open(f, "w"))
        res = subprocess.run(["node", "-e", js, blend_path, f], check=True, capture_output=True, text=True)
        return json.loads(res.stdout.strip().splitlines()[-1])


def v6_identity(recs, v7):
    """v7np's p vs the v6 package's p (data/derived/v6/gate_train.json) on shared fight x regime rows where both are ml2stack."""
    path = os.path.join(ROOT, "data/derived/v6/gate_train.json")
    if not os.path.exists(path):
        return {"error": "data/derived/v6/gate_train.json missing"}
    G = {f["id"]: f for f in json.load(open(path))["fights"]}
    n = same = 0
    bad = []
    for r in recs:
        g = G.get(r["id"])
        if not g or r.get("err") or g.get("err"):
            continue
        for kind, e in (r["pk"].get(v7) or {}).items():
            w = ((g["pk"].get("v6") or {}).get(kind))
            if not w or e.get("source") != "ml2stack" or w.get("source") != "ml2stack":
                continue
            n += 1
            if e["p"] == w["p"]:
                same += 1
            elif len(bad) < 5:
                bad.append([r["id"], kind, e["p"], w["p"]])
    return {"rows": n, "identical": same, "examples_differing": bad, "pass": n > 0 and n == same}


def gate(path, out=None, tests=None):
    D = json.load(open(path))
    recs = D["fights"]
    meta = D["meta"]
    v7 = [p["name"] for p in meta["packages"] if p["mode"] == "v7"][0]
    cmp = [p["name"] for p in meta["packages"] if p["mode"] == "cmp4"][0]
    v7dir = [p["dir"] for p in meta["packages"] if p["mode"] == "v7"][0]
    fits = all_fits(recs, v7, cmp)
    res = {"meta": {"tool": "tools/v7_gate.py gate", "input": os.path.relpath(path, ROOT), "harness": meta, "rules": __doc__.split("RULES")[1].strip(),
                    "boot": dict(PS.BOOT)},
           "fits": fits, "errors": [r["id"] for r in recs if r.get("err")][:20], "n_err": sum(1 for r in recs if r.get("err"))}
    # ---- C1: cycle 1 on the v4 simulator (v7np - cmp4), 2021-2023
    C1 = {}
    for kind in ("open", "none", "close"):
        rows = collect(recs, kind, C1_YEARS, [("v7np", v7, "np"), ("cmp4", cmp, "cmp")], fits, v7)
        C1[kind] = paired(rows, ["v7np", "cmp4"], C1_YEARS, kind)
        C1[kind]["by_year"] = {str(Y): paired([x for x in rows if int(x[0]["date"][:4]) == Y], ["v7np", "cmp4"], (Y,), kind)["packages"] for Y in C1_YEARS}
    res["C1"] = C1
    # ---- C2: cycle 2 (v7 - v7np), close+props, 2022-2023
    rows2 = collect(recs, "close", C2_YEARS, [("v7", v7, "props"), ("v7np", v7, "np")], fits, v7, need_props=True)
    res["C2"] = paired(rows2, ["v7", "v7np"], C2_YEARS, "close+props")
    res["C2"]["by_year"] = {str(Y): paired([x for x in rows2 if int(x[0]["date"][:4]) == Y], ["v7", "v7np"], (Y,), "close+props")["packages"] for Y in C2_YEARS}
    # winner identity inside the composition + JS parity
    for r, y, cp in rows2:
        cp["_off"] = cp["v7np"]
        cp["_pi"] = fits["pi"][r["date"][:4]]["pi"]
    maxw = 0.0
    for r, y, cp in rows2:
        c, R, p = cp["v7"][0], r["rounds"], cp["v7"][1]
        a = sum(c[0:2 * R]) + c[4 * R]
        b = sum(c[2 * R:4 * R]) + c[4 * R + 1]
        maxw = max(maxw, abs(a / (a + b) - p), abs(cp["v7"][1] - cp["v7np"][1]))
    res["C2"]["winner_identity_max_abs"] = maxw
    try:
        res["C2"]["js_parity"] = js_parity(rows2, os.path.join(ROOT, v7dir, "ml", "blend.js"))
    except Exception as e:  # noqa: BLE001
        res["C2"]["js_parity"] = {"error": str(e)[:400]}
    res["C2"]["v6_identity"] = v6_identity(recs, v7)
    # ---- reported, never decisive
    rep = {}
    rows3 = collect(recs, "close", C2_YEARS, [("v7", v7, "props"), ("cmp4", cmp, "cmp")], fits, v7, need_props=True)
    rep["primary_contrast_close_props"] = paired(rows3, ["v7", "cmp4"], C2_YEARS, "close+props")
    for kind in ("open", "none"):
        rr = collect(recs, kind, C2_YEARS, [("v7", v7, "props"), ("v7np", v7, "np")], fits, v7, need_props=True)
        rep["props_%s" % kind] = paired(rr, ["v7", "v7np"], C2_YEARS, kind + "+props")
    # close regime, all rows (props where they exist) v7 - cmp4, 2022-2023, and C2 with every close row (degrade rows included)
    rr = collect(recs, "close", C2_YEARS, [("v7", v7, "props"), ("cmp4", cmp, "cmp")], fits, v7)
    rep["v7_vs_cmp4_close_all_rows"] = paired(rr, ["v7", "cmp4"], C2_YEARS, "close")
    rr = collect(recs, "close", C2_YEARS, [("v7", v7, "props"), ("v7np", v7, "np")], fits, v7)
    rep["props_close_all_rows"] = paired(rr, ["v7", "v7np"], C2_YEARS, "close")
    # leave-one-year-out pi (2021-2023), cells with the 2019-2023 w
    loyo = {}
    w_all = fits["w"][v7]["fit_2019_2023"]["w"]
    lf = {"w": {v7: {str(Y): {"w": w_all} for Y in (2021, 2022, 2023)}}, "pi": {}}
    for Y in (2021, 2022, 2023):
        lf["pi"][str(Y)] = fit_pi(recs, v7, [x for x in (2021, 2022, 2023) if x != Y], w_all)
    rl = collect(recs, "close", (2021, 2022, 2023), [("v7", v7, "props"), ("v7np", v7, "np")], lf, v7, need_props=True)
    loyo["pi"] = {k: v["pi"] for k, v in lf["pi"].items()}
    loyo["score"] = paired(rl, ["v7", "v7np"], (2021, 2022, 2023), "close+props (LOYO)")
    rep["loyo_2021_2023"] = loyo
    # decShift diagnostic (forward-chained)
    rep["decShift_forward_chained"] = {str(Y): fit_dec_shift(recs, v7, range(PROPS_FROM, Y), fits["w"][v7][str(Y)]["w"], fits["pi"][str(Y)]["pi"]) for Y in C2_YEARS}
    # who x how x when vs model S
    mr = {}
    # V7_GATE_SYNTHETIC=1: code check on randomized outcomes only (methodround.py scores against backtest_dev.json's real outcomes)
    for nm, rws in (() if os.environ.get("V7_GATE_SYNTHETIC") else (("C2_close_props", rows2), ("primary_close_props", rows3))):
        for pk in ("v7", "v7np", "cmp4"):
            if rws and pk in rws[0][2]:
                try:
                    mr["%s|%s" % (nm, pk)] = methodround_cells(rws, pk, "2022-01-01", "2024-01-01")
                except Exception as e:  # noqa: BLE001
                    mr["%s|%s" % (nm, pk)] = {"error": str(e)[:300]}
    rep["methodround_vs_S"] = mr
    res["reported"] = rep
    # ---- tests from tests/test_v7.js
    T = json.load(open(tests)) if tests and os.path.exists(tests) else None
    res["tests"] = T
    # ---- verdict
    k1 = "v7np - cmp4"
    det = {}
    P1 = {k: C1[k]["paired"][k1] for k in C1}
    det["C1 open winner: CI upper < 0 and point <= -0.001"] = PS.check_upper(P1["open"]["winLL"], 0.0, True, -0.001)
    det["C1 no-line winner: CI upper < 0 and point <= -0.001"] = PS.check_upper(P1["none"]["winLL"], 0.0, True, -0.001)
    det["C1 close winner: CI upper <= +0.0005"] = PS.check_upper(P1["close"]["winLL"], TOL["close_c1"], False)
    for k in ("open", "none", "close"):
        det["C1 7-bin (%s): CI upper < 0" % k] = PS.check_upper(P1[k]["bin7"], 0.0, True)
        det["C1 method (%s): CI upper <= +0.002" % k] = PS.check_upper(P1[k]["method"], TOL["method_c1"], False)
    P2 = res["C2"]["paired"]["v7 - v7np"]
    det["C2 7-bin (close+props): CI upper < 0"] = PS.check_upper(P2["bin7"], 0.0, True)
    det["C2 method (close+props): CI upper <= +0.003"] = PS.check_upper(P2["method"], TOL["method_c2"], False)
    det["C2 round given a finish (close+props): CI upper <= +0.002"] = PS.check_upper(P2["rgf"], TOL["rgf_c2"], False)
    pd_ = res["C2"]["packages"]["v7"]
    det["C2 P(decision) within 2 points of observed (pooled)"] = {"pass": abs(pd_["pdec"] - pd_["ydec"]) <= TOL["pdec_c2"] + 1e-12,
                                                                   "predicted": pd_["pdec"], "observed": pd_["ydec"], "abs_gap": round(abs(pd_["pdec"] - pd_["ydec"]), 4)}
    det["C2 winner bit-identical (composition, 1e-12)"] = {"pass": maxw <= 1e-12, "max_abs": maxw}
    det["C2 winner identical to the v6 package (ml2stack rows)"] = {"pass": bool(res["C2"]["v6_identity"].get("pass")), **res["C2"]["v6_identity"]}
    jp = res["C2"]["js_parity"]
    det["T props composition: Python = shipped JS <= 1e-9"] = {"pass": "max_abs_diff" in jp and jp["max_abs_diff"] <= 1e-9 and jp["n"] == len(rows2), **jp}
    if T:
        for k, v in T.get("checks", {}).items():
            det["T " + k] = {"pass": bool(v.get("pass")), "info": v.get("info")}
    else:
        det["T tests/test_v7.js results present"] = {"pass": False, "info": "no --tests file"}
    det["harness: no failed fights"] = {"pass": res["n_err"] == 0, "n_err": res["n_err"]}
    checks = {k: bool(v["pass"]) for k, v in det.items()}
    res["gate"] = {"checks": checks, "pass": all(checks.values()), "detail": det}
    if out:
        json.dump(res, open(out, "w"), indent=1, default=float)
    return res


def power(path, n_look, effect=None, contrast="primary", metric="bin7", out=None):
    S = json.load(open(path))
    R = S["reported"]["primary_contrast_close_props"] if contrast == "primary" else S["C2"]
    d = list(R["paired"].values())[0][metric]
    n_gate = R["n_outcome"] if metric in ("bin7", "method", "joint") else R["n_decisive"]
    se_gate = (d.get("normal") or {}).get("se")
    se = se_gate * math.sqrt(n_gate / float(n_look))
    e = abs(effect if effect is not None else d["diff"])
    pw = PS.norm_cdf(e / se - 1.959964) + PS.norm_cdf(-e / se - 1.959964)
    res = {"gate_score": os.path.relpath(path, ROOT), "contrast": contrast, "metric": metric, "n_gate": n_gate, "n_look": n_look,
           "se_gate_normal": se_gate, "se_look": round(se, 6), "mde_80": round(2.8 * se, 5), "effect": -e, "effect_source": "gate point estimate" if effect is None else "given",
           "power": round(pw, 3), "underpowered": pw < 0.5}
    if out:
        json.dump(res, open(out, "w"), indent=1)
    return res


def show(res):
    if "fits" in res:
        f = res["fits"]
        print("w:", {k: {y: v["w"] for y, v in d.items()} for k, d in f["w"].items()})
        print("pi:", {y: v["pi"] for y, v in f["pi"].items()})
    for blk in ("C1",):
        for kind, R in res.get(blk, {}).items():
            print("== C1 %s: n %d / decisive %d / cards %d" % (kind, R["n_outcome"], R["n_decisive"], R["n_cards"]))
            for k, d in R.get("paired", {}).items():
                print("   %s: %s" % (k, {m: (v["diff"], v["ci"]) for m, v in d.items() if m in ("winLL", "bin7", "method", "joint")}))
    if "C2" in res:
        R = res["C2"]
        print("== C2 close+props: n %d / decisive %d / finishes %d / cards %d" % (R["n_outcome"], R["n_decisive"], R["n_finish"], R["n_cards"]))
        for k, d in R.get("paired", {}).items():
            print("   %s: %s" % (k, {m: (v["diff"], v["ci"]) for m, v in d.items() if m in ("winLL", "bin7", "method", "joint", "rgf", "mgw")}))
        print("   levels:", R["packages"])
    for k, v in res.get("gate", {}).get("checks", {}).items():
        dd = res["gate"]["detail"][k]
        extra = ""
        if "boot_upper" in dd:
            extra = "  (boot upper %+.5f, MC SE %.6f, normal upper %+.5f, threshold %+.4f%s)" % (
                dd["boot_upper"], dd["mcse_upper"], dd["normal_upper"], dd["threshold"], ", MARGINAL: normal bound decides" if dd["marginal"] else "")
        print("  [%s] %s%s" % ("PASS" if v else "FAIL", k, extra))
    if "gate" in res:
        print("GATE:", "PASS" if res["gate"]["pass"] else "FAIL")


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["fits", "gate", "power"])
    ap.add_argument("path")
    ap.add_argument("--out")
    ap.add_argument("--tests")
    ap.add_argument("--n-look", type=int)
    ap.add_argument("--effect", type=float)
    ap.add_argument("--contrast", default="primary")
    ap.add_argument("--metric", default="bin7")
    a = ap.parse_args()
    if a.cmd == "fits":
        D = json.load(open(a.path))
        v7 = [p["name"] for p in D["meta"]["packages"] if p["mode"] == "v7"][0]
        cm = [p["name"] for p in D["meta"]["packages"] if p["mode"] == "cmp4"]
        f = all_fits(D["fights"], v7, cm[0] if cm else None)
        res = {"meta": {"tool": "tools/v7_gate.py fits", "input": os.path.relpath(a.path, ROOT), "note": "fits only: no metric, no comparator",
                        "harness_protocol": D["meta"].get("protocol")}, "fits": f}
        if a.out:
            json.dump(res, open(a.out, "w"), indent=1)
        show(res)
    elif a.cmd == "gate":
        show(gate(a.path, a.out, a.tests))
    else:
        if not a.n_look:
            raise SystemExit("power: --n-look is required")
        print(json.dumps(power(a.path, a.n_look, a.effect, a.contrast, a.metric, a.out), indent=1))


if __name__ == "__main__":
    main()
