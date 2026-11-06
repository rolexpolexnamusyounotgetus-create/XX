#!/usr/bin/env python3
"""mlcal_verify.py: independent metrics for the mlcal review (no code shared with tools/mlcal.py).

Inputs are the per-fight count files written by tools/mlcal_verify.js (both corner orders, own seeds) and the
validation ledger data/derived/mlcal_val_ledger.json. Outcomes are re-coded here from backtest_dev.json.

  python3 tools/mlcal_verify.py score  --base <val_baseline.json> [--cand label=<file.json> ...] [--train-base <train_baseline.json>]
  python3 tools/mlcal_verify.py ledger      # re-derive every ledger entry's metrics from its stored per-fight predictions

Definitions (same as the mlcal report so numbers are comparable):
  P(A wins) = (A-win sims + 0.5) / (decisive sims + 1), clipped to [0.005, 0.995]; winner log loss over decisive
  fights; 7-bin probabilities (counts + pi7) / (N + 1), pi7 = corner-symmetric train 7-bin shares.
Elo references (both corner-symmetric, no intercept):
  raw    p = 1 / (1 + 10^(-(eloA - eloB)/400))
  fitted p = sigmoid(s * (eloA - eloB)), s fit by maximum likelihood on 2019-2023 train fights only.
Blend diagnostic (needs --train-base): logit p = a * logit(p_engine) + b * (eloA - eloB) / 400, no intercept,
fit on train fights (mirrored, so no corner term can be learned), scored once on validation.
Never reads a fight dated 2026-01-01 or later.
"""
import argparse
import json
import math
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
B = 2000


def outcome(r):
    if r["winner"] == "D":
        return 3
    if r["winner"] not in ("A", "B"):
        return None
    m = r["method"]
    k = 0 if m in ("KO", "TKO", "DOC") else 1 if m == "SUB" else 2 if m in ("UD", "SD", "MD") else None
    if k is None:
        return None
    return k if r["winner"] == "A" else 6 - k


def load_bt():
    bt = json.load(open(os.path.join(ROOT, "data/derived/backtest_dev.json")))
    fights = [f for f in bt["fights"] if f["date"] < "2026-01-01"]
    return {f["id"]: f for f in fights}, fights


def pi7_train(fights):
    c = np.zeros(7)
    for f in fights:
        if "2019-01-01" <= f["date"] < "2024-01-01":
            y = outcome(f["result"])
            if y is not None:
                c[y] += 1
    c = (c + c[::-1]) / 2
    return c / c.sum()


def probs(fr, pi7):
    c = np.array([x["counts"] for x in fr], float)
    n = np.array([x["n"] for x in fr], float)
    cA, cB = c[:, :3].sum(1), c[:, 4:].sum(1)
    p = np.clip((cA + 0.5) / (cA + cB + 1), 0.005, 0.995)
    q = (c + pi7[None, :]) / (n[:, None] + 1)
    return p, q


def boot(v, seed=5):
    rng = np.random.default_rng(seed)
    v = np.asarray(v, float)
    idx = rng.integers(0, len(v), size=(B, len(v)))
    m = v[idx].mean(1)
    return {"mean": round(float(v.mean()), 5), "lo": round(float(np.percentile(m, 2.5)), 5), "hi": round(float(np.percentile(m, 97.5)), 5)}


def ll(p, y):
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


def fit_slope(x, y, x2=None):
    """No-intercept logistic regression on mirrored rows (x, y) and (-x, 1-y); x may be 1-d or 2-d."""
    X = np.atleast_2d(np.asarray(x, float).T).T if np.ndim(x) == 1 else np.asarray(x, float)
    X = np.vstack([X, -X])
    Y = np.concatenate([y, 1 - y])
    w = np.zeros(X.shape[1])
    for _ in range(50):                        # Newton
        z = X @ w
        p = 1 / (1 + np.exp(-z))
        g = X.T @ (p - Y)
        H = (X * (p * (1 - p))[:, None]).T @ X + 1e-9 * np.eye(X.shape[1])
        step = np.linalg.solve(H, g)
        w -= step
        if np.abs(step).max() < 1e-10:
            break
    return w


def ece_sym(p, y, nb=10):
    pp = np.concatenate([p, 1 - p])
    yy = np.concatenate([y, 1 - y])
    b = np.minimum(nb - 1, (pp * nb).astype(int))
    return float(sum(abs(pp[b == i].mean() - yy[b == i].mean()) * (b == i).sum() for i in range(nb) if (b == i).any()) / len(pp))


def cmd_score(a):
    by_id, fights = load_bt()
    pi7 = pi7_train(fights)
    base = json.load(open(a.base))["fights"]
    for x in base:
        f = by_id[x["id"]]
        assert x["y"] == outcome(f["result"]), x["id"]
        assert "2024-01-01" <= f["date"] < "2026-01-01"
    ids = [x["id"] for x in base]
    y7 = np.array([x["y"] for x in base])
    dec = y7 != 3
    yw = (y7 < 3).astype(float)
    eA = np.array([by_id[i]["A"]["elo"] if by_id[i]["A"]["elo"] is not None else 1500 for i in ids], float)
    eB = np.array([by_id[i]["B"]["elo"] if by_id[i]["B"]["elo"] is not None else 1500 for i in ids], float)
    # Elo scale fit on train only
    tr = [f for f in fights if "2019-01-01" <= f["date"] < "2024-01-01" and outcome(f["result"]) not in (None, 3)]
    tx = np.array([((f["A"]["elo"] or 1500) - (f["B"]["elo"] or 1500)) / 400 for f in tr])
    ty = np.array([1.0 if outcome(f["result"]) < 3 else 0.0 for f in tr])
    s = fit_slope(tx, ty)[0]
    d = (eA - eB) / 400
    pe_raw = 1 / (1 + 10 ** (-d))
    pe_fit = 1 / (1 + np.exp(-s * d))
    out = {"n_fights": len(base), "n_decisive": int(dec.sum()), "elo_fit_params": {"slope_per_400": round(float(s), 4),
           "raw_equivalent": round(float(math.log(10)), 4), "n_train": len(tr)}}
    sets = {"baseline": base}
    for c in a.cand or []:
        lab, fn = c.split("=", 1)
        fr = json.load(open(fn))["fights"]
        assert [x["id"] for x in fr] == ids
        sets[lab] = fr
    L = {}
    for lab, fr in sets.items():
        p, q = probs(fr, pi7)
        L[lab] = {"winLL": ll(p[dec], yw[dec]), "brier": (p[dec] - yw[dec]) ** 2, "binLL": -np.log(q[np.arange(len(y7)), y7]),
                  "acc": np.where(p[dec] > 0.5, yw[dec], np.where(p[dec] < 0.5, 1 - yw[dec], 0.5)), "p": p}
        out[lab] = {k: boot(L[lab][k]) for k in ("winLL", "brier", "binLL", "acc")}
        out[lab]["ece_sym"] = round(ece_sym(p[dec], yw[dec]), 4)
        out[lab]["vs_elo_raw"] = boot(L[lab]["winLL"] - ll(pe_raw[dec], yw[dec]))
        out[lab]["vs_elo_fit"] = boot(L[lab]["winLL"] - ll(pe_fit[dec], yw[dec]))
        if lab != "baseline":
            out[lab]["vs_baseline"] = {k: boot(L[lab][k] - L["baseline"][k]) for k in ("winLL", "brier", "binLL")}
    out["elo_raw"] = {"winLL": boot(ll(pe_raw[dec], yw[dec])), "ece_sym": round(ece_sym(pe_raw[dec], yw[dec]), 4)}
    out["elo_fit"] = {"winLL": boot(ll(pe_fit[dec], yw[dec])), "ece_sym": round(ece_sym(pe_fit[dec], yw[dec]), 4)}
    # agreement with the ledger's per-fight predictions (same parameter set, different seeds and code)
    if a.ledger_hash:
        led = {e["hash"]: e for e in json.load(open(os.path.join(ROOT, "data/derived/mlcal_val_ledger.json")))["entries"]}
        for pair in a.ledger_hash:
            lab, h = pair.split("=", 1)
            pf = {f["id"]: f for f in led[h]["perFight"]}
            pl = np.array([pf[i]["pA"] for i in ids])
            yl = np.array([np.nan if pf[i]["winA"] is None else pf[i]["winA"] for i in ids])
            assert np.array_equal(np.nan_to_num(yl, nan=-1)[dec], yw[dec]) and np.isnan(yl[~dec]).all(), "ledger outcomes disagree"
            out[lab]["ledger_agreement"] = {"hash": h, "ledger_winLL": round(float(ll(np.clip(pl[dec], 0.005, 0.995), yw[dec]).mean()), 5),
                                            "mean_abs_dp": round(float(np.abs(pl - L[lab]["p"]).mean()), 4),
                                            "corr_logit": round(float(np.corrcoef(np.log(pl / (1 - pl)), np.log(L[lab]["p"] / (1 - L[lab]["p"])))[0, 1]), 4),
                                            "outcomes_match": True}
    # blend / temperature diagnostic, fit on train predictions of the same parameter set
    if a.train_base:
        trf = json.load(open(a.train_base))["fights"]
        for x in trf:
            assert "2019-01-01" <= by_id[x["id"]]["date"] < "2024-01-01"
        ty7 = np.array([x["y"] for x in trf])
        tdec = ty7 != 3
        tyw = (ty7 < 3).astype(float)[tdec]
        tp, _ = probs(trf, pi7)
        tlg = np.log(tp / (1 - tp))[tdec]
        tde = np.array([((by_id[x["id"]]["A"]["elo"] or 1500) - (by_id[x["id"]]["B"]["elo"] or 1500)) / 400 for x in trf])[tdec]
        t_only = fit_slope(tlg, tyw)[0]
        wb = fit_slope(np.column_stack([tlg, tde]), tyw)
        p0 = L["baseline"]["p"][dec]
        lg = np.log(p0 / (1 - p0))
        pt = 1 / (1 + np.exp(-t_only * lg))
        pb = 1 / (1 + np.exp(-(wb[0] * lg + wb[1] * d[dec])))
        out["train_fit_diagnostics"] = {
            "n_train": int(tdec.sum()), "train_engine_winLL": round(float(ll(tp[tdec], tyw).mean()), 5),
            "temperature_a": round(float(t_only), 4), "blend_a_engine_logit": round(float(wb[0]), 4), "blend_b_per_400_elo": round(float(wb[1]), 4),
            "val_temperature_winLL": boot(ll(pt, yw[dec])), "val_temperature_vs_baseline": boot(ll(pt, yw[dec]) - L["baseline"]["winLL"]),
            "val_blend_winLL": boot(ll(pb, yw[dec])), "val_blend_vs_baseline": boot(ll(pb, yw[dec]) - L["baseline"]["winLL"]),
            "val_blend_ece_sym": round(ece_sym(pb, yw[dec]), 4)}
    print(json.dumps(out, indent=1))
    if a.out:
        json.dump(out, open(a.out, "w"), indent=1)


def cmd_ledger(a):
    by_id, fights = load_bt()
    led = json.load(open(os.path.join(ROOT, "data/derived/mlcal_val_ledger.json")))
    base = None
    rows = []
    for e in led["entries"]:
        pf = e["perFight"]
        for f in pf:
            bf = by_id[f["id"]]
            assert "2024-01-01" <= bf["date"] < "2026-01-01", f["id"]
            y = outcome(bf["result"])
            assert y == f["bin"], (f["id"], y, f["bin"])
            assert f["winA"] == (None if y == 3 else (1 if y < 3 else 0))
        p = np.array([f["pA"] for f in pf])
        w = np.array([f["winA"] is not None for f in pf])
        yw = np.array([f["winA"] or 0 for f in pf], float)
        q = np.array([f["q"][f["bin"]] for f in pf])
        wl = ll(p[w], yw[w])
        if e["label"] == "baseline" and base is None:
            base = {f["id"]: i for i, f in enumerate(pf)}, wl, -np.log(q)
        r = {"hash": e["hash"], "label": e["label"], "n": len(pf), "winLL": round(float(wl.mean()), 5),
             "stored_winLL": round(e["result"]["winLL"], 5), "binLL": round(float(-np.log(q).mean()), 5),
             "stored_binLL": round(e["result"]["binLL"], 5)}
        if base is not None and e["label"] != "baseline":
            order = [base[0][f["id"]] for f in pf]
            assert order == list(range(len(pf)))
            r["paired_winLL_vs_base"] = boot(wl - base[1])
            r["paired_win+0.5bins_vs_base"] = boot((wl + 0.5 * (-np.log(q))[w]) - (base[1] + 0.5 * base[2][w]))
        rows.append(r)
    print(json.dumps({"entries": rows, "n_distinct_sets": len({e["hash"] for e in led["entries"]})}, indent=1))


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("score")
    p.add_argument("--base", required=True)
    p.add_argument("--cand", action="append")
    p.add_argument("--train-base")
    p.add_argument("--ledger-hash", action="append", help="label=hash: compare with that ledger entry's per-fight predictions")
    p.add_argument("--out")
    sub.add_parser("ledger")
    a = ap.parse_args()
    {"score": cmd_score, "ledger": cmd_ledger}[a.cmd](a)


if __name__ == "__main__":
    main()
