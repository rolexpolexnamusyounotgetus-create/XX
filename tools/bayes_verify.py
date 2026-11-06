#!/usr/bin/env python3
"""Adversarial verification of tools/bayes.py (task key: bayes). Independent of the builder's scorer and stack code.

    nice -n 5 python3 tools/bayes_verify.py score      # labels from the raw ufcstats CSVs, own joins, own event-cluster
                                                       #   bootstrap: standalone, paired, ablations, free intercept,
                                                       #   uncertainty terciles (2019-2023; 2024-2025 recomputed only)
    nice -n 5 python3 tools/bayes_verify.py stack      # own mirrored non-negative stacker, forward-chained 2021-2023 gate
    nice -n 5 python3 tools/bayes_verify.py lookahead  # perturb every fight from a cut day on (results, rounds, stats,
                                                       #   method) and require identical pre-cut predictions (filter +
                                                       #   monthly EP) and identical yearly hyperparameter fits
    nice -n 5 python3 tools/bayes_verify.py swap       # corner swap of the chosen config on 2023 (builder tested 2019)
    nice -n 5 python3 tools/bayes_verify.py all        # score + stack (the fast stages)

Inputs: data/raw/ufc_fight_results.csv + ufc_event_details.csv (labels, dates, cards; rows dated 2026-01-01 or later are
dropped as they are parsed), data/derived/backtest_dev.json (universe), data/derived/bayes.json (bayes predictions),
ratings.json (whr_rounds, glicko2), ml2.json (ML v2 logistic), market.json (close = p_power_close, open = p_novig_open,
market rating), out/ml2_cache/stack.pkl (ml2's expert columns for the stack partners), out/bayes_cache/pred_*.pkl
(builder's cached OOF predictions, for the ablations). Output: data/derived/bayes_verify.json.
"""
import os

for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "1")
import csv
import datetime as dt
import json
import pickle
import sys
import time

import numpy as np
from scipy.optimize import minimize

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW = os.path.join(ROOT, "data", "raw")
DER = os.path.join(ROOT, "data", "derived")
BCACHE = os.path.join(ROOT, "out", "bayes_cache")
OUT = os.path.join(DER, "bayes_verify.json")
VAULT = dt.date(2026, 1, 1)
SEL_MIN = 0.0005
NBOOT = 2000


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def load_out():
    return json.load(open(OUT)) if os.path.exists(OUT) else {}


def save_out(J):
    J["meta"] = {"tool": "tools/bayes_verify.py", "updated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")}
    json.dump(J, open(OUT, "w"), indent=1, default=float)


# ---------------------------------------------------------------- raw labels (independent of build_db / ratings.py)
def raw_fights():
    ev = {}
    for r in csv.DictReader(open(os.path.join(RAW, "ufc_event_details.csv"))):
        ev[r["EVENT"].strip()] = dt.datetime.strptime(r["DATE"].strip(), "%B %d, %Y").date()
    F = {}
    n2026 = 0
    for r in csv.DictReader(open(os.path.join(RAW, "ufc_fight_results.csv"))):
        e = r["EVENT"].strip()
        d = ev.get(e)
        if d is None:
            continue
        if d >= VAULT:                      # hidden-data protocol: dropped at parse, never read further
            n2026 += 1
            continue
        fid = r["URL"].strip().rstrip("/").split("/")[-1]
        o = r["OUTCOME"].strip()
        F[fid] = {"date": d, "event": e, "y": 1.0 if o == "W/L" else (0.0 if o == "L/W" else np.nan), "outcome": o}
    return F, n2026


def logit(p):
    p = np.clip(np.asarray(p, float), 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


def llv(p, y):
    p = np.clip(np.asarray(p, float), 1e-6, 1 - 1e-6)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


class Boot:
    """Event-cluster bootstrap: the same NBOOT card resamples for every statistic on a given row set."""

    def __init__(self, groups, seed=20261106):
        _, self.g = np.unique(np.asarray(groups), return_inverse=True)
        self.G = self.g.max() + 1
        rng = np.random.default_rng(seed)
        self.W = np.stack([np.bincount(rng.integers(0, self.G, self.G), minlength=self.G) for _ in range(NBOOT)]).astype(float)
        self.C = np.bincount(self.g, minlength=self.G).astype(float)

    def mean_ci(self, v):
        S = np.bincount(self.g, weights=np.asarray(v, float), minlength=self.G)
        bs = (self.W @ S) / (self.W @ self.C)
        return [round(float(np.mean(v)), 5), round(float(np.percentile(bs, 2.5)), 4), round(float(np.percentile(bs, 97.5)), 4)]


def mirrored_slope(p, y):
    z = logit(p)
    z, yy = np.r_[z, -z], np.r_[y, 1 - y]
    f = lambda b: np.sum(np.logaddexp(0, b[0] * z) - yy * b[0] * z)
    return round(float(minimize(f, [1.0], method="L-BFGS-B").x[0]), 3)


# ---------------------------------------------------------------- inputs
def build_table():
    F, n2026 = raw_fights()
    bt = json.load(open(os.path.join(DER, "backtest_dev.json")))["fights"]
    B = json.load(open(os.path.join(DER, "bayes.json")))
    R = json.load(open(os.path.join(DER, "ratings.json")))["predictions"]
    M2 = json.load(open(os.path.join(DER, "ml2.json")))["fights"]
    MK = json.load(open(os.path.join(DER, "market.json")))["fights"]
    rows, audit = [], {"raw_rows_2026_dropped": n2026, "backtest_ids": len(bt), "not_in_raw": [], "nondecisive": 0,
                       "outside_2019_2025": 0, "no_bayes": [], "no_whr": [], "no_ml2lr": [], "date_mismatch": []}
    for e in bt:
        fid = e["id"]
        r = F.get(fid)
        if r is None:
            if e["date"] < "2026-01-01":
                audit["not_in_raw"].append(fid)
            continue
        if not (dt.date(2019, 1, 1) <= r["date"] < VAULT):
            audit["outside_2019_2025"] += 1
            continue
        if str(r["date"]) != e["date"]:
            audit["date_mismatch"].append(fid)
        if np.isnan(r["y"]):
            audit["nondecisive"] += 1
            continue
        b = B["fights"].get(fid)
        w = (R.get(fid) or {}).get("p") or {}
        m = M2.get(fid) or {}
        mk = MK.get(fid) or {}
        row = {"fid": fid, "date": r["date"], "year": r["date"].year, "event": r["event"], "y": r["y"],
               "bayes": b and b.get("p"), "bayes_roll": b and b.get("p_roll"), "bayes_plugin": b and b.get("p_plugin"),
               "logit_sd": b and b.get("logit_sd"), "whr": w.get("whr_rounds"), "glicko2": w.get("glicko2"),
               "elo_full": w.get("elo_full"), "ratings_stack": w.get("stack"),
               "ml2lr": m.get("ml2_lr"), "ml2": m.get("ml2"), "close": mk.get("p_power_close"),
               "open": mk.get("p_novig_open"), "mkt_rating": mk.get("p_market_rating"),
               "nA": e["A"].get("n"), "nB": e["B"].get("n")}
        for k, lst in (("bayes", "no_bayes"), ("whr", "no_whr"), ("ml2lr", "no_ml2lr")):
            if row[k] is None:
                audit[lst].append(fid)
        rows.append(row)
    for k in ("not_in_raw", "no_bayes", "no_whr", "no_ml2lr", "date_mismatch"):
        audit[k + "_n"] = len(audit[k])
        audit[k] = audit[k][:20]
    return rows, audit, B


def arr(rows, k):
    return np.array([np.nan if r[k] is None else r[k] for r in rows], float)


# ---------------------------------------------------------------- stage: score
def stage_score(args):
    rows, audit, B = build_table()
    J = load_out()
    J["join_audit"] = audit
    log("join audit:", {k: v for k, v in audit.items() if not isinstance(v, list)})
    # bayes's own labels must equal the raw labels
    X = pickle.load(open(os.path.join(BCACHE, "data.pkl"), "rb"))
    pos = {f: i for i, f in enumerate(X["fid"])}
    lab_bad = [r["fid"] for r in rows if r["fid"] in pos and X["win"][pos[r["fid"]]] != r["y"]]
    J["label_mismatch_vs_bayes_data"] = len(lab_bad)
    log("label mismatches (raw vs bayes data.pkl): %d" % len(lab_bad))
    yr = arr(rows, "year")
    y = arr(rows, "y")
    ev = np.array([r["event"] for r in rows])
    out = {}
    for win, (lo, hi) in (("2019-2023", (2019, 2023)), ("2024-2025", (2024, 2025))):
        base = (yr >= lo) & (yr <= hi)
        need = ["bayes", "whr", "glicko2", "ml2lr"]
        m = base & np.all([~np.isnan(arr(rows, k)) for k in need], 0)
        bt = Boot(ev[m])
        lb = llv(arr(rows, "bayes")[m], y[m])
        W = {"n": int(m.sum()), "standalone": {}, "paired_bayes_minus": {}}
        for k in ("bayes", "bayes_plugin", "whr", "glicko2", "elo_full", "ratings_stack", "ml2lr", "mkt_rating"):
            p = arr(rows, k)[m]
            if np.isnan(p).any():
                continue
            W["standalone"][k] = {"ll": bt.mean_ci(llv(p, y[m])),
                                  "acc": round(float(np.mean((p > 0.5) == (y[m] > 0.5))), 4), "slope": mirrored_slope(p, y[m])}
            if k != "bayes":
                W["paired_bayes_minus"][k] = bt.mean_ci(lb - llv(p, y[m]))
        if lo == 2024:
            p = arr(rows, "bayes_roll")[m]
            W["standalone"]["bayes_roll"] = {"ll": bt.mean_ci(llv(p, y[m])), "slope": mirrored_slope(p, y[m])}
            W["paired_bayes_minus"]["bayes_roll"] = bt.mean_ci(lb - llv(p, y[m]))
        for k in ("close", "open"):
            mk = ~np.isnan(arr(rows, k)[m])
            b2 = Boot(ev[m][mk])
            W["paired_bayes_minus"][k] = b2.mean_ci(lb[mk] - llv(arr(rows, k)[m][mk], y[m][mk]))
            W["paired_bayes_minus"][k].append(int(mk.sum()))
            W["standalone"][k] = {"ll": b2.mean_ci(llv(arr(rows, k)[m][mk], y[m][mk])), "n": int(mk.sum())}
        # free-intercept check (unmirrored, the corner order as listed): y ~ a + b logit(p)
        W["free_intercept"] = {}
        for k in ("bayes", "whr", "ml2lr"):
            z = logit(arr(rows, k)[m])
            f = lambda c: np.sum(np.logaddexp(0, c[0] + c[1] * z) - y[m] * (c[0] + c[1] * z))
            r = minimize(f, [0.0, 1.0], method="BFGS")
            se = np.sqrt(np.diag(r.hess_inv))
            W["free_intercept"][k] = {"a": round(float(r.x[0]), 4), "a_se": round(float(se[0]), 4), "b": round(float(r.x[1]), 3),
                                      "mean_p": round(float(np.mean(arr(rows, k)[m])), 4),
                                      "ll_gain_from_a_and_b": round(float(r.fun / m.sum() - llv(arr(rows, k)[m], y[m]).mean()), 5)}
        W["share_A_wins"] = round(float(y[m].mean()), 4)
        # uncertainty terciles by the posterior sd of the result logit
        sdv = arr(rows, "logit_sd")[m]
        pb = arr(rows, "bayes")[m]
        q = np.quantile(sdv, [1 / 3, 2 / 3])
        tb = np.digitize(sdv, q)
        nmin = np.minimum(arr(rows, "nA")[m], arr(rows, "nB")[m])
        W["sd_terciles"] = [{"n": int((tb == t).sum()), "acc": round(float(np.mean(((pb > 0.5) == (y[m] > 0.5))[tb == t])), 4),
                             "ll": round(float(llv(pb[tb == t], y[m][tb == t]).mean()), 5),
                             "share_newcomer_bouts": round(float(np.mean(nmin[tb == t] <= 2)), 3)} for t in range(3)]
        out[win] = W
        log(win, "n", W["n"], {k: v["ll"] for k, v in W["standalone"].items()})
        log("  paired bayes minus:", W["paired_bayes_minus"])
        log("  free intercept:", W["free_intercept"], "share A", W["share_A_wins"])
        log("  sd terciles:", W["sd_terciles"])
    J["score"] = out
    J["ablations"] = ablations(rows)
    J["method"] = method_check(B)
    save_out(J)


def method_check(B):
    """bayes 23 cells vs methodround S, outcome cells from the raw CSV (KO/TKO incl. doctor, Submission, Decision*,
    draws; DQ / NC / overturned / could-not-continue skipped). Own losses: joint, method3, round given a finish."""
    ev = {r["EVENT"].strip(): dt.datetime.strptime(r["DATE"].strip(), "%B %d, %Y").date()
          for r in csv.DictReader(open(os.path.join(RAW, "ufc_event_details.csv")))}
    out_cell = {}
    for r in csv.DictReader(open(os.path.join(RAW, "ufc_fight_results.csv"))):
        d = ev.get(r["EVENT"].strip())
        if d is None or d >= VAULT:
            continue
        fid = r["URL"].strip().rstrip("/").split("/")[-1]
        o, me, rd = r["OUTCOME"].strip(), r["METHOD"].strip(), int(r["ROUND"].strip() or 0)
        if o == "D/D":
            out_cell[fid] = (22, d, r["EVENT"].strip())
            continue
        if o not in ("W/L", "L/W"):
            continue
        a = o == "W/L"
        if me in ("KO/TKO", "TKO - Doctor's Stoppage"):
            c = (0 if a else 10) + rd - 1
        elif me == "Submission":
            c = (5 if a else 15) + rd - 1
        elif me.startswith("Decision"):
            c = 20 if a else 21
        else:
            continue
        out_cell[fid] = (c, d, r["EVENT"].strip())
    MR = json.load(open(os.path.join(DER, "methodround.json")))["fights"]
    res = {}
    for win, (lo, hi) in (("2019-2023", (2019, 2023)), ("2024-2025", (2024, 2025))):
        cb, cs, yc, evs = [], [], [], []
        for fid, r in B["fights"].items():
            oc = out_cell.get(fid)
            s = (MR.get(fid) or {}).get("S")
            if oc is None or s is None or not (lo <= oc[1].year <= hi) or any(v is None for v in r["cells"]):
                continue
            R = int(MR[fid]["rounds"])
            row = np.zeros(23)
            row[0:R], row[5:5 + R], row[10:10 + R], row[15:15 + R] = s[0:R], s[R:2 * R], s[2 * R:3 * R], s[3 * R:4 * R]
            row[20:23] = s[4 * R:4 * R + 3]
            cb.append(r["cells"])
            cs.append(row)
            yc.append(oc[0])
            evs.append(oc[2])
        y = np.array(yc)
        bt = Boot(evs)
        L = {}
        for nm, P in (("bayes", np.array(cb, float)), ("S", np.array(cs))):
            P = np.clip(P, 1e-9, None)
            P = P / P.sum(1, keepdims=True)
            n = len(y)
            ko = P[:, 0:5].sum(1) + P[:, 10:15].sum(1)
            sb = P[:, 5:10].sum(1) + P[:, 15:20].sum(1)
            de = P[:, 20] + P[:, 21] + P[:, 22]
            isko = ((y >= 0) & (y < 5)) | ((y >= 10) & (y < 15))
            issb = ((y >= 5) & (y < 10)) | ((y >= 15) & (y < 20))
            rr = np.where(isko | issb, y % 5, 0)
            finr = P[:, 0:5] + P[:, 5:10] + P[:, 10:15] + P[:, 15:20]
            fin = isko | issb
            L[nm] = {"joint": -np.log(P[np.arange(n), y]),
                     "method3": -np.log(np.where(isko, ko, np.where(issb, sb, de))),
                     "round_given_fin": np.where(fin, -np.log(finr[np.arange(n), rr] / np.maximum(ko + sb, 1e-12)), np.nan)}
        W = {"n": int(len(y))}
        for k in ("joint", "method3", "round_given_fin"):
            ok = ~np.isnan(L["bayes"][k])
            b2 = Boot(np.array(evs)[ok])
            W[k] = {"bayes": round(float(L["bayes"][k][ok].mean()), 4), "S": round(float(L["S"][k][ok].mean()), 4),
                    "bayes_minus_S": b2.mean_ci(L["bayes"][k][ok] - L["S"][k][ok])}
        res[win] = W
        log("method", win, W)
    return res


def cached_oof(variant, sched, X):
    """Builder's cached OOF predictions (pA = variance-aware link) for 2019-2023, mapped to fid."""
    out = {}
    for Y in range(2019, 2024):
        p = os.path.join(BCACHE, "pred_%s_%s_oof%d.pkl" % (variant, sched, Y))
        if not os.path.exists(p):
            return None
        P = pickle.load(open(p, "rb"))
        for i, pa, pp in zip(P["idx"], P["pA"], P["pA_plugin"]):
            if X["year"][i] == Y:
                out[X["fid"][i]] = (pa, pp)
    return out


def ablations(rows):
    X = pickle.load(open(os.path.join(BCACHE, "data.pkl"), "rb"))
    yr = arr(rows, "year")
    m = (yr <= 2023) & ~np.isnan(arr(rows, "bayes")) & ~np.isnan(arr(rows, "whr")) & ~np.isnan(arr(rows, "ml2lr"))
    R = [r for r, k in zip(rows, m) if k]
    y = np.array([r["y"] for r in R])
    bt = Boot([r["event"] for r in R])
    P = {}
    for v, s in (("main", "month"), ("main", "quarter"), ("main", "year"), ("main", "none"), ("nostats", "quarter"),
                 ("nostats", "year"), ("nostats", "none")):
        c = cached_oof(v, s, X)
        if c is None:
            continue
        P["%s|%s" % (v, s)] = np.array([c[r["fid"]][0] for r in R])
        P["%s|%s|plugin" % (v, s)] = np.array([c[r["fid"]][1] for r in R])
    pj = np.array([r["bayes"] for r in R])
    out = {"n": len(R), "export_vs_cache_max_abs": round(float(np.max(np.abs(pj - P["main|month"]))), 6)}
    L = {k: llv(v, y) for k, v in P.items()}
    for a, b in (("main|month", "main|none"), ("main|month", "main|quarter"), ("main|quarter", "main|year"),
                 ("main|year", "main|none"), ("main|month", "nostats|quarter"), ("main|quarter", "nostats|quarter"),
                 ("main|year", "nostats|year"), ("main|none", "nostats|none"), ("main|month", "main|month|plugin")):
        out["%s minus %s" % (a, b)] = bt.mean_ci(L[a] - L[b])
    out["ll"] = {k: round(float(v.mean()), 5) for k, v in L.items()}
    log("ablations:", out)
    return out


# ---------------------------------------------------------------- stage: stack (own implementation)
def fit_weights(Z, y, w):
    """Non-negative logit weights, no intercept, fit on explicitly mirrored rows (recency weights w)."""
    Zm, ym, wm = np.r_[Z, -Z], np.r_[y, 1 - y], np.r_[w, w]
    wm = wm / wm.sum()

    def f(b):
        q = Zm @ b
        return np.sum(wm * (np.logaddexp(0, q) - ym * q)), Zm.T @ (wm * (1 / (1 + np.exp(-q)) - ym))
    r = minimize(f, np.full(Z.shape[1], 0.3), jac=True, method="L-BFGS-B", bounds=[(0, None)] * Z.shape[1])
    return r.x


def stage_stack(args):
    rows, audit, B = build_table()
    S = pickle.load(open(os.path.join(ROOT, "out", "ml2_cache", "stack.pkl"), "rb"))["D"]
    col = {"ml2lr": "ml2lr_static", "ml2": "ml2_static", "feat_lr": "feat_lr", "mkt_rating": "mkt_rating"}
    ext = {c: dict(zip(S["fid"], S[v].to_numpy(float))) for c, v in col.items()}
    T = [r for r in rows if r["bayes"] is not None and r["fid"] in ext["ml2"]]
    for r in T:
        for c in col:
            r["x_" + c] = ext[c][r["fid"]]
    y = np.array([r["y"] for r in T])
    yr = np.array([r["year"] for r in T])
    ev = np.array([r["event"] for r in T])

    def Z(cols):
        out = []
        for c in cols:
            k = "x_" + c if c in col else c
            v = np.array([np.nan if r[k] is None else r[k] for r in T], float)
            out.append(np.where(np.isnan(v), 0.0, logit(np.clip(v, 0.01, 0.99))))
        return np.stack(out, 1)
    has = {"line": ~np.isnan(arr(T, "close")), "noline": np.ones(len(T), bool), "open": ~np.isnan(arr(T, "open"))}
    sets = {"line": [["close", "ml2"], ["close", "ml2lr"], ["close", "whr"]],
            "noline": [["ml2", "mkt_rating", "feat_lr"], ["ml2lr", "mkt_rating"], ["whr", "glicko2"], ["whr"]],
            "open": [["open", "ml2"], ["open", "ml2lr"]]}

    def cv(cols, ok):
        Zc = Z(cols)
        res = {}
        for h in (None, 3.0, 1.5):
            pr = np.full(len(T), np.nan)
            for Y in (2021, 2022, 2023):
                tr = ok & (yr >= 2019) & (yr <= Y - 1)
                w = np.ones(tr.sum()) if h is None else 0.5 ** ((Y - yr[tr]) / h)
                b = fit_weights(Zc[tr], y[tr], w)
                te = ok & (yr == Y)
                pr[te] = 1 / (1 + np.exp(-(Zc[te] @ b)))
            m = ok & (yr >= 2021) & (yr <= 2023)
            res[h] = (float(llv(pr[m], y[m]).mean()), pr)
        hb = min(res, key=lambda h: res[h][0] + (0 if h is None else SEL_MIN))
        trf = ok & (yr >= 2019) & (yr <= 2023)
        wf = np.ones(trf.sum()) if hb is None else 0.5 ** ((2024 - yr[trf]) / hb)
        bf = fit_weights(Zc[trf], y[trf], wf)
        va = ok & (yr >= 2024)
        pv = np.full(len(T), np.nan)
        pv[va] = 1 / (1 + np.exp(-(Zc[va] @ bf)))
        return res[hb][0], hb, res[hb][1], bf, pv
    G = {}
    for regime, lst in sets.items():
        ok = has[regime]
        mcv = ok & (yr >= 2021) & (yr <= 2023)
        mva = ok & (yr >= 2024)
        bcv, bva = Boot(ev[mcv]), Boot(ev[mva])
        for cols in lst:
            c0, h0, p0, b0, v0 = cv(cols, ok)
            c1, h1, p1, b1, v1 = cv(cols + ["bayes"], ok)
            key = "%s|%s + bayes" % (regime, "+".join(cols))
            G[key] = {"n_cv": int(mcv.sum()), "cv_base": round(c0, 5), "cv_plus": round(c1, 5), "gain": round(c1 - c0, 5),
                      "h_base": h0, "h_plus": h1, "enters": bool(c1 - c0 < -SEL_MIN),
                      "paired_cv": bcv.mean_ci(llv(p1[mcv], y[mcv]) - llv(p0[mcv], y[mcv])),
                      "bayes_weight_fit_2019_2023": round(float(b1[-1]), 3),
                      "weights_plus": dict(zip(cols + ["bayes"], np.round(b1, 3).tolist())),
                      "valid_2024_2025_plus_minus_base": bva.mean_ci(llv(v1[mva], y[mva]) - llv(v0[mva], y[mva])),
                      "n_valid": int(mva.sum())}
            log("%-40s CV %.5f -> %.5f gain %+.5f %s %s | w_bayes %.3f | 2024-25 %s" % (
                key, c0, c1, c1 - c0, G[key]["paired_cv"], "ENTERS" if G[key]["enters"] else "rejected",
                b1[-1], G[key]["valid_2024_2025_plus_minus_base"]))
    J = load_out()
    J["stack_gate"] = G
    save_out(J)


# ---------------------------------------------------------------- stage: lookahead (perturbation test on the model code)
def perturb(X, cut_day, seed=3):
    """Copy of the bayes data arrays with every fight on/after cut_day scrambled: winner flipped, round-encoder
    targets flipped, method changed, every count replaced by noise. Pre-cut entries are untouched."""
    import copy
    Y = copy.deepcopy(X)
    rng = np.random.default_rng(seed)
    m = Y["day"] >= cut_day
    n = int(m.sum())
    Y["win"] = np.where(m & ~np.isnan(X["win"]), 1.0 - np.nan_to_num(X["win"]), X["win"])
    for a, b in (("ry_played", "rw_played"), ("ry_fin", "rw_fin"), ("ry_rem", "rw_rem")):
        Y[a] = np.where(m, Y[b] - X[a], X[a])
    Y["cat"] = np.where(m & np.isin(X["cat"], (1, 2, 3)), 1 + (X["cat"] % 3), X["cat"])
    Y["rsig"][m] = rng.poisson(40, Y["rsig"][m].shape)
    for k in ("td", "sub", "kd", "head", "ctl"):
        Y[k][m] = rng.poisson(5, (n, 2)) * (30 if k == "ctl" else 1)
    Y["sig"][m] = Y["rsig"][m].sum(-1)
    return Y


def stage_lookahead(args):
    sys.path.insert(0, HERE)
    import bayes as BY
    X = BY.load_data()
    res = {}
    # (1) predictions: OOF 2022 with the 2022 hyperparameters, monthly EP + filter; cut mid-June 2022
    cut = dt.date(2022, 6, 15).toordinal()
    Xp = perturb(X, cut)
    BY.baselines(Xp)            # walk-forward baselines rebuilt on the perturbed data
    sched, H = BY.config_H(X, "main", "month", 2022)
    t0 = time.time()
    P0 = BY.predict_year(X, H, 2022, schedule=sched, key="lk_base")
    P1 = BY.predict_year(Xp, H, 2022, schedule=sched, key="lk_pert")
    pre = X["day"][P0["idx"]] < cut
    post = ~pre
    d_pre = float(np.max(np.abs(P0["pA"][pre] - P1["pA"][pre])))
    d_cells = float(np.nanmax(np.abs(P0["cells"][pre] - P1["cells"][pre])))
    d_post = float(np.max(np.abs(P0["pA"][post] - P1["pA"][post])))
    cache = pickle.load(open(BY.pred_path("main", "month", "oof2022"), "rb"))
    d_cache = float(np.max(np.abs(cache["pA"] - P0["pA"])))
    res["predict_oof2022_month"] = {"cut": "2022-06-15", "n_pre": int(pre.sum()), "n_post": int(post.sum()),
                                    "max_abs_dp_pre_cut": d_pre, "max_abs_dcells_pre_cut": d_cells,
                                    "max_abs_dp_post_cut (must be > 0)": d_post,
                                    "rerun_vs_builder_cache_max_abs": d_cache, "sec": round(time.time() - t0)}
    log("predict look-ahead:", res["predict_oof2022_month"])
    # (2) the yearly empirical-Bayes fit for 2021 (data before 2021-01-01), warm-started from the cached 2020 fit,
    # on data perturbed from 2021-01-01 on, vs the cached fit_main_2021
    if not args.quick:
        cut2 = dt.date(2021, 1, 1).toordinal()
        Xq = perturb(X, cut2, seed=5)
        BY.baselines(Xq)
        BY._SD.clear()
        BY._SD["main"] = BY.static_design(Xq)        # the EB code reads the "main" design: build it from perturbed data
        H20 = pickle.load(open(BY.year_path("main", 2020), "rb"))["H"]
        t0 = time.time()
        Hq = BY.fit_year(Xq, 2021, H20, em_iters=1, sweeps=2, stat_sweeps=1, logf=lambda *a: None)
        Hc = pickle.load(open(BY.year_path("main", 2021), "rb"))["H"]
        diffs = {}
        for k in ("qf", "qy", "Sigma0", "mu0", "drift_a", "drift_b", "sig_u", "sig_e", "w_round", "w_fround", "w_rem",
                  "do", "lay", "beta_up"):
            diffs[k] = float(np.max(np.abs(np.asarray(Hq[k], float) - np.asarray(Hc[k], float))))
        diffs["win_beta"] = float(np.max(np.abs(Hq["win"]["beta"] - Hc["win"]["beta"])))
        diffs["k"] = float(max(abs(Hq["k"][s] - Hc["k"][s]) for s in Hq["k"]))
        res["fit_2021_on_post2020_perturbed"] = {"max_abs_diff_vs_cached_fit": diffs, "max": max(diffs.values()),
                                                 "sec": round(time.time() - t0)}
        log("fit look-ahead:", res["fit_2021_on_post2020_perturbed"])
        BY._SD.clear()
    J = load_out()
    J["lookahead"] = res
    save_out(J)


# ---------------------------------------------------------------- stage: damping (the note's EP damping claim)
def stage_damping(args):
    """The note says converged log loss does not depend on the EP damping (0.66201 / 0.66202 / 0.66202 at 0.5 / 0.8 /
    1.0 'on a test year'); 0.66201 is nostats / yearly EP / 2019 in cv.log, so rerun that: EP at 2019-01-01 with each
    damping, filter through 2019, score the 2019 backtest fights."""
    sys.path.insert(0, HERE)
    import bayes as BY
    X = BY.load_data()
    H = pickle.load(open(BY.year_path("nostats", 2019), "rb"))["H"]
    a, b = BY.jan1(2019), BY.jan1(2020)
    out = {}
    for d in (0.5, 0.8, 1.0):
        S = BY.ep_snapshot(X, H, a, damp=d, key="dmp")
        R = BY.run_filter(X, H, b, init=S, from_day=a, store=True, key="dmp")
        idx = np.flatnonzero((X["year"] == 2019) & R["done"] & X["evalrow"])
        _, pA, _, _ = BY.cells(X, R, H, idx)
        out[str(d)] = {"ll": round(float(llv(pA, X["win"][idx]).mean()), 5), "n": int(len(idx)), "ep_iters": len(S["iters"]) + 1}
        log("damping", d, out[str(d)])
    J = load_out()
    J["damping_2019_nostats_yearly"] = out
    save_out(J)


# ---------------------------------------------------------------- stage: swap (chosen config on 2023)
def stage_swap(args):
    sys.path.insert(0, HERE)
    import bayes as BY
    X = BY.load_data()
    sched, H = BY.config_H(X, "main", "month", 2023)
    Y = BY.swap_data(X)
    BY.baselines(Y)
    P1 = BY.predict_year(X, H, 2023, schedule=sched, key="sw_a")
    P2 = BY.predict_year(Y, H, 2023, schedule=sched, key="sw_b")
    sw = np.r_[np.arange(10, 20), np.arange(0, 10), 21, 20, 22]
    out = {"year": 2023, "schedule": sched, "n": int(len(P1["idx"])),
           "max|pA + pA_swapped - 1|": float(np.max(np.abs(P1["pA"] + P2["pA"] - 1))),
           "max|cells - mirrored swapped cells|": float(np.max(np.abs(P1["cells"] - P2["cells"][:, sw])))}
    log("swap 2023:", out)
    J = load_out()
    J["swap_2023"] = out
    save_out(J)


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("stage", choices=["score", "stack", "lookahead", "swap", "damping", "all"])
    ap.add_argument("--quick", action="store_true")
    a = ap.parse_args()
    if a.stage == "all":
        stage_score(a)
        stage_stack(a)
    else:
        {"score": stage_score, "stack": stage_stack, "lookahead": stage_lookahead, "swap": stage_swap,
         "damping": stage_damping}[a.stage](a)
