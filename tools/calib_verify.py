#!/usr/bin/env python3
"""Verifier of tools/calib.py (task key calib): an independent re-derivation of the stack gate, the pre-registered
2024-25 numbers, the plugin columns and a few report claims. Own code: it does not import tools/calib.py or ml2.py.

    nice -n 5 python3 tools/calib_verify.py gate      # ~6 min: incumbents + recency / percard / temp / temp_annual on
                                                      # the 2016-20 inner origins and the 2021-23 gate, 4 heads
    nice -n 5 python3 tools/calib_verify.py oddseg    # ~2 min: odd and segment families' inner choices (noline, open)
    nice -n 5 python3 tools/calib_verify.py confirm   # ~2 min: swap test, recompute (not re-select) the single 2024-25
                                                      # look, plugin columns vs own incumbents, sharpness k
    nice -n 5 python3 tools/calib_verify.py claims    # seconds: free-intercept check, cross-family slope shift,
                                                      # market-rating gap; reads data/derived/calib.json
Writes data/derived/calib_verify.json (one key per stage). 2026+ rows are dropped at parse; the gate / oddseg stages read
only rows before 2024; the confirm stage recomputes the frozen 2024-25 objects already scored once by calib.py confirm.

Raw inputs: out/ml2_cache/table.pkl (ml2's table: ratings, market rating mr_p, universe flags), out/ml2_cache/fit.pkl
(ML v2 logistic annual-expanding OOF 2012-2023 and static <2024 predictions), data/derived/market.json (2019+ dev lines),
data/raw/odds/nlbair_odds.csv (pre-2019 lines). 2026+ rows dropped at parse.
"""
import os, sys, json, pickle, datetime as dt
os.environ.setdefault("OMP_NUM_THREADS", "1")
import numpy as np, pandas as pd
from scipy.optimize import minimize

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_JSON = os.path.join(ROOT, "data", "derived", "calib_verify.json")
VAULT = "2026-01-01"


def sig(z): return 1 / (1 + np.exp(-z))
def lg(p, c=1e-6):
    p = np.clip(p, c, 1 - c); return np.log(p / (1 - p))
def llv(p, y):
    p = np.clip(p, 1e-6, 1 - 1e-6); return -(y * np.log(p) + (1 - y) * np.log(1 - p))


# ------------------------------------------------------------------ table from raw
T = pickle.load(open(f"{ROOT}/out/ml2_cache/table.pkl", "rb"))["df"]
F = pickle.load(open(f"{ROOT}/out/ml2_cache/fit.pkl", "rb"))
assert list(F["fid"]) == T["fid"].tolist()
keep = (T["date"].astype(str) < VAULT).to_numpy() & T["y"].notna().to_numpy() & ~T["amb"].astype(bool).to_numpy()
yr_all = T["year"].to_numpy().astype(int)
lr = np.where(yr_all >= 2024, np.asarray(F["preds"]["lr|static"], float), np.asarray(F["preds"]["lr|oof"], float))
mk = json.load(open(f"{ROOT}/data/derived/market.json"))["fights"]
nl = pd.read_csv(f"{ROOT}/data/raw/odds/nlbair_odds.csv", low_memory=False)
nl = nl[nl.event_date < VAULT].drop_duplicates("fight_id").set_index("fight_id")
close = np.full(len(T), np.nan); opn = np.full(len(T), np.nan)
for i, f in enumerate(T["fid"]):
    m = mk.get(f)
    if m and m.get("p_power_close") is not None:
        close[i] = m["p_power_close"]; opn[i] = m["p_novig_open"] if m.get("p_novig_open") is not None else np.nan
    elif f in nl.index and bool(nl.at[f, "has_odds"]):
        assert nl.at[f, "f1_id"] == T["a"].iat[i]          # orientation: nlbair f1 must be table A
        close[i] = nl.at[f, "f1_close_prob_novig"]; opn[i] = nl.at[f, "f1_open_prob_novig"]
D = pd.DataFrame({"fid": T["fid"], "date": T["date"].astype(str), "year": yr_all, "event": T["event"].astype(str),
                  "y": T["y"].astype(float), "ev": T["evalrow"].astype(bool), "lr": lr, "mr": T["mr_p"].astype(float),
                  "close": pd.to_numeric(close), "open": pd.to_numeric(opn)})[keep].reset_index(drop=True)
assert D.date.max() < VAULT
y = D.y.to_numpy().copy(); yr = D.year.to_numpy(); dates = D.date.to_numpy()
dord = np.array([dt.date.fromisoformat(d).toordinal() for d in dates], float)
ROWS = {"noline": D.ev & D.lr.notna() & (D.year >= 2013), "open": D.ev & D.lr.notna() & D.open.notna(),
        "line": D.ev & D.lr.notna() & D.close.notna(), "ml2lr": D.ev & D.lr.notna()}
ROWS = {k: v.to_numpy() for k, v in ROWS.items()}
COLS = {"noline": ["lr", "mr"], "open": ["open", "lr"], "line": ["close", "lr"], "ml2lr": ["lr"]}
H0 = {"noline": 1.5, "open": None, "line": None, "ml2lr": None}


def Zof(cols):
    return np.column_stack([np.nan_to_num(lg(np.clip(D[c].to_numpy(float), 0.01, 0.99))) for c in cols])


def nn_stack(Z, yy, w):
    """non-negative, no-intercept logistic stack; weights normalised, ridge 1e-4 (the stack objective as published)."""
    w = w / w.sum()
    def f(b):
        q = Z @ b
        return np.sum(w * (np.logaddexp(0, q) - yy * q)) + 1e-4 * b @ b
    def g(b):
        return Z.T @ (w * (sig(Z @ b) - yy)) + 2e-4 * b
    r = minimize(f, np.full(Z.shape[1], 0.3), jac=g, method="TNC", bounds=[(0, None)] * Z.shape[1],
                 options={"maxfun": 2000, "ftol": 1e-13, "xtol": 1e-12, "gtol": 1e-10})
    return r.x


def annual(head, h, years, hist_from):
    Z = Zof(COLS[head]); ok = ROWS[head]; P = np.full(len(D), np.nan)
    for Y in years:
        tr = ok & (yr >= hist_from) & (yr <= Y - 1)
        w = np.ones(tr.sum()) if not h else 0.5 ** ((Y - yr[tr]) / h)
        b = nn_stack(Z[tr], y[tr], w)
        m = ok & (yr == Y); P[m] = sig(Z[m] @ b)
    return P


def percard(head, h, years, hist_from):
    Z = Zof(COLS[head]); ok = ROWS[head]; P = np.full(len(D), np.nan)
    tgt = ok & np.isin(yr, years)
    for d in sorted(set(dates[tgt])):
        do = dt.date.fromisoformat(d).toordinal()
        tr = ok & (yr >= hist_from) & (dord < do)
        a = (do - dord[tr]) / 365.25
        w = np.ones(tr.sum()) if not h else 0.5 ** (a / h)
        b = nn_stack(Z[tr], y[tr], w)
        m = tgt & (dates == d); P[m] = sig(Z[m] @ b)
    return P


def temp_fit(z, yy, w, sd):
    """1-parameter MAP: z' = a z, prior a ~ N(1, sd^2) in fight units (sd None = flat). Newton."""
    a = 1.0; prec = 0.0 if sd is None else 1 / sd ** 2
    for _ in range(100):
        p = sig(a * z)
        g = np.sum(w * (p - yy) * z) + prec * (a - 1)
        H = np.sum(w * p * (1 - p) * z * z) + prec + 1e-12
        st = g / H; a -= st
        if abs(st) < 1e-12: break
    return a


def temp_wf(base, rows, years, half_life=None, last_n=None, sd=None, annual_max_age=None):
    out = np.full(len(D), np.nan); z = lg(base); fin = rows & np.isfinite(base); tgt = fin & np.isin(yr, years)
    keys = ["%d-01-01" % Y for Y in years] if annual_max_age else sorted(set(dates[tgt]))
    for d in keys:
        do = dt.date.fromisoformat(d).toordinal()
        hh = np.flatnonzero(fin & (dord < do)); a = (do - dord[hh]) / 365.25
        if last_n:
            o = np.argsort(a, kind="stable"); hh, a = hh[o[:last_n]], a[o[:last_n]]
        w = np.ones(len(hh)) if not half_life else 0.5 ** (a / half_life)
        if annual_max_age:
            w = np.where(a <= annual_max_age, w, 0.0)
        if (w > 0).sum() < 60:
            continue
        aa = temp_fit(z[hh], y[hh], w, sd)
        m = tgt & ((dates == d) if not annual_max_age else (yr == int(d[:4])))
        out[m] = sig(aa * z[m])
    return out


def slope(p, yy):
    return temp_fit(lg(p), yy, np.ones(len(yy)), None)


class Boot:
    def __init__(self, g, n=2000, seed=12345):
        codes, self.g = np.unique(g, return_inverse=True); G = len(codes)
        rng = np.random.default_rng(seed)
        self.W = np.array([np.bincount(rng.integers(0, G, G), minlength=G) for _ in range(n)], float)
        self.C = np.bincount(self.g, minlength=G).astype(float); self.G = G

    def diff(self, a, b, yy):
        d = llv(a, yy) - llv(b, yy); S = np.bincount(self.g, weights=d, minlength=self.G)
        bs = (self.W @ S) / (self.W @ self.C)
        return float(d.mean()), [float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5))]




def _save(key, obj):
    doc = json.load(open(OUT_JSON)) if os.path.exists(OUT_JSON) else {}
    doc[key] = obj
    doc["meta"] = {"tool": "tools/calib_verify.py (verifier of tools/calib.py, Nov 6, 2026)",
                   "protocol": "2026+ dropped at parse; gate/oddseg read < 2024 only; confirm recomputes the frozen, "
                               "pre-registered 2024-25 objects (no new selection)"}
    with open(OUT_JSON + ".tmp", "w") as fh:
        json.dump(doc, fh, indent=1, default=float)
    os.replace(OUT_JSON + ".tmp", OUT_JSON)


def stage_gate():
    assert D.date.max() < VAULT
    res = {}
    gate = (yr >= 2021) & (yr <= 2023); inner = (yr >= 2016) & (yr <= 2020)
    yrs = list(range(2016, 2024))
    for head in ("noline", "open", "line", "ml2lr"):
        ok = ROWS[head]; mg = ok & gate; mi = ok & inner
        B = Boot(D.event.to_numpy()[mg])
        if head == "ml2lr":
            inc = np.where(ok & (yr < 2024), D.lr.to_numpy(), np.nan); base = inc
        else:
            inc = annual(head, H0[head], [2021, 2022, 2023], 2019)
            base = annual(head, H0[head], list(range(2014, 2024)), 2013)
        R = {"n_gate": int(mg.sum()), "n_inner": int(mi.sum()), "inc_gate_ll": float(llv(inc[mg], y[mg]).mean()),
             "inc_gate_slope": float(slope(inc[mg], y[mg])), "schemes": {}}
        sch = {}
        if head != "ml2lr":
            for h in (None, 0.5, 1.0, 1.5):
                sch["recency h=%s" % h] = annual(head, h, yrs, 2013)
            for h in (None, 1.0, 0.75):
                sch["percard h=%s" % h] = percard(head, h, yrs, 2013)
        for hl in (0.5, 1.0, 2.0, 4.0, 8.0):
            for sd in (None, 0.3, 0.15, 0.08):
                sch["temp half_life=%s sd=%s" % (hl, sd)] = temp_wf(base, ok, yrs, half_life=hl, sd=sd)
        for n in (200, 400, 800):
            for sd in (None, 0.15):
                sch["temp last_n=%s sd=%s" % (n, sd)] = temp_wf(base, ok, yrs, last_n=n, sd=sd)
        for ma in (1.0, 2.0, 4.0):
            sch["temp_annual max_age=%s" % ma] = temp_wf(base, ok, yrs, annual_max_age=ma)
        for lab, P in sch.items():
            Pi = np.where(np.isfinite(P), P, base); Pg = np.where(np.isfinite(P), P, inc)
            dif, cil = B.diff(Pg[mg], inc[mg], y[mg])
            R["schemes"][lab] = {"inner_ll": round(float(llv(Pi[mi], y[mi]).mean()), 5),
                                 "gate_ll": round(float(llv(Pg[mg], y[mg]).mean()), 5), "gate_vs_inc": round(dif, 5),
                                 "ci": [round(c, 4) for c in cil]}
        temps = {k: v for k, v in R["schemes"].items() if k.startswith("temp ")}
        R["temp_inner_choice"] = min(temps, key=lambda k: temps[k]["inner_ll"])
        R["temp_gate_best"] = min(temps, key=lambda k: temps[k]["gate_ll"])
        print(head, "incumbent gate %.5f (slope %.3f)" % (R["inc_gate_ll"], R["inc_gate_slope"]),
              "| temp inner choice", R["temp_inner_choice"], R["schemes"][R["temp_inner_choice"]], flush=True)
        for lab, v in R["schemes"].items():
            if not lab.startswith("temp "):
                print("   %-24s inner %.5f gate %+.5f [%+.4f, %+.4f]" % (lab, v["inner_ll"], v["gate_vs_inc"], *v["ci"]))
        res[head] = R
    _save("gate", res)


def _flags(p):
    T = pickle.load(open(f"{ROOT}/out/ml2_cache/table.pkl", "rb"))["df"].set_index("fid")
    g = lambda c: T.loc[D.fid, c].to_numpy(float)
    women, lbs, five, nmin = g("women"), g("lbs"), g("five"), np.minimum(g("nA"), g("nB"))
    return np.column_stack([women, ((women == 0) & (lbs >= 205)).astype(float), ((nmin >= 1) & (nmin <= 2)).astype(float),
                            (nmin == 0).astype(float), five, (np.maximum(p, 1 - p) >= 0.75).astype(float)])


def _map_fit(X, yy, w, m0, prec):
    t = m0.copy()
    for _ in range(100):
        p = sig(X @ t); g = X.T @ (w * (p - yy)) + prec * (t - m0)
        H = (X * (w * p * (1 - p))[:, None]).T @ X + np.diag(prec) + 1e-9 * np.eye(len(t))
        st = np.linalg.solve(H, g); t = t - st
        if np.max(np.abs(st)) < 1e-11:
            break
    return t


def stage_oddseg():
    res = {}
    gate = (yr >= 2021) & (yr <= 2023)
    for head in ("noline", "open"):
        ok = ROWS[head]; mg = ok & gate
        inc = annual(head, H0[head], [2021, 2022, 2023], 2019)
        base = annual(head, H0[head], list(range(2014, 2024)), 2013)
        B = Boot(D.event.to_numpy()[mg]); z = lg(base); S = _flags(np.nan_to_num(base, nan=0.5))
        fin = ok & np.isfinite(base); tgt = fin & gate
        for lab, kind, hl, sa, sb in (("odd half_life=1 sd_a=0.15 sd_b=0.05", "odd", 1.0, 0.15, 0.05),
                                      ("segment all six half_life=2 sd_a=0.15 sd_b=0.05", "segment", 2.0, 0.15, 0.05)):
            X = np.column_stack([z, z * np.abs(z)]) if kind == "odd" else np.column_stack([z] + [z * S[:, k] for k in range(6)])
            k = X.shape[1]; m0 = np.r_[1.0, np.zeros(k - 1)]; prec = np.r_[1 / sa ** 2, np.full(k - 1, 1 / sb ** 2)]
            P = np.full(len(D), np.nan)
            for d in sorted(set(dates[tgt])):
                do = dt.date.fromisoformat(d).toordinal(); hh = fin & (dord < do); a = (do - dord[hh]) / 365.25
                t = _map_fit(X[hh], y[hh], 0.5 ** (a / hl), m0, prec)
                m = tgt & (dates == d); P[m] = sig(X[m] @ t)
            P = np.where(np.isfinite(P), P, inc)
            d_, c_ = B.diff(P[mg], inc[mg], y[mg])
            res["%s | %s" % (head, lab)] = {"gate_vs_inc": round(d_, 5), "ci": [round(c, 4) for c in c_]}
            print(head, lab, res["%s | %s" % (head, lab)], flush=True)
    _save("oddseg", res)


def stage_confirm():
    out = {}
    orig = {c: D[c].to_numpy().copy() for c in ("lr", "mr", "close", "open")}
    y0 = y.copy()
    base = annual("noline", 1.5, list(range(2014, 2024)), 2013)
    pt = temp_wf(base, ROWS["noline"], [2021], last_n=200, sd=0.15)
    pc = percard("open", 1.0, [2021], 2013)
    for c in orig:
        D[c] = 1 - orig[c]
    y[:] = 1 - y0
    base_s = annual("noline", 1.5, list(range(2014, 2024)), 2013)
    pt_s = temp_wf(base_s, ROWS["noline"], [2021], last_n=200, sd=0.15)
    pc_s = percard("open", 1.0, [2021], 2013)
    for c in orig:
        D[c] = orig[c]
    y[:] = y0
    m, m2 = np.isfinite(pt), np.isfinite(pc)
    out["swap_max_abs"] = {"stack_base": float(np.nanmax(np.abs(base + base_s - 1))),
                           "temp_last200": float(np.max(np.abs(pt[m] + pt_s[m] - 1))),
                           "percard_open_h1": float(np.max(np.abs(pc[m2] + pc_s[m2] - 1)))}
    print("swap (optimizer tolerance)", out["swap_max_abs"], flush=True)
    va = (yr >= 2024) & (yr <= 2025); close = D.close.to_numpy(float); ev = D.event.to_numpy()
    conf, incs = {}, {}
    for head in ("noline", "open", "line", "ml2lr"):
        ok = ROWS[head]; mm = ok & va
        if head == "ml2lr":
            inc = D.lr.to_numpy(float).copy()
        else:
            Z = Zof(COLS[head]); tr = ok & (yr >= 2019) & (yr <= 2023)
            w = np.ones(tr.sum()) if not H0[head] else 0.5 ** ((2024 - yr[tr]) / H0[head])
            b = nn_stack(Z[tr], y[tr], w); inc = np.full(len(D), np.nan); inc[mm] = sig(Z[mm] @ b)
        mc = mm & np.isfinite(close)
        d_, c_ = Boot(ev[mc]).diff(inc[mc], close[mc], y[mc])
        conf[head] = {"n": int(mm.sum()), "log_loss": round(float(llv(inc[mm], y[mm]).mean()), 5),
                      "slope": round(float(slope(inc[mm], y[mm])), 3), "n_close": int(mc.sum()),
                      "vs_close": round(d_, 5), "vs_close_ci": [round(c, 4) for c in c_]}
        if head == "noline":
            bl = annual("noline", 1.5, list(range(2014, 2026)), 2013)
            ptv = temp_wf(bl, ok, [2024, 2025], last_n=200, sd=0.15); ptv = np.where(np.isfinite(ptv), ptv, inc)
            d2, c2 = Boot(ev[mm]).diff(ptv[mm], inc[mm], y[mm])
            conf[head]["descriptive_temp_last200"] = {"log_loss": round(float(llv(ptv[mm], y[mm]).mean()), 5),
                                                      "slope": round(float(slope(ptv[mm], y[mm])), 3),
                                                      "vs_static_incumbent": round(d2, 5), "ci": [round(c, 4) for c in c2]}
        incs[head] = inc
        print(head, conf[head], flush=True)
    out["confirm_recomputed"] = conf
    cj = json.load(open(f"{ROOT}/data/derived/calib.json")); fx = {f: i for i, f in enumerate(D.fid)}
    out["plugin"] = {}
    for head in ("noline", "open", "line"):
        mine = np.where(va, incs[head], annual(head, H0[head], [2021, 2022, 2023], 2019))
        dh, dv, early = [], [], 0
        for f, r in cj["fights"].items():
            if head not in r:
                continue
            i = fx[f]
            if r["set"] == "hist" and yr[i] < 2021:
                early += 1
                continue
            (dh if r["set"] == "hist" else dv).append(abs(r[head] - mine[i]))
        out["plugin"][head] = {"n_hist": len(dh), "n_valid": len(dv), "hist_rows_before_2021": early,
                               "max_abs_hist": float(max(dh)), "max_abs_valid": float(max(dv))}
        print("plugin", head, out["plugin"][head], flush=True)
    r = ROWS["noline"] & (yr >= 2021) & (yr <= 2023); Z = Zof(["lr", "mr"])[r]
    zv, zp = Z @ np.array([0.7049, 0.5526]), Z @ np.array([1.0335, 0.3906])
    out["sharpness_k"] = round(float(zp @ zv / (zv @ zv)), 4)
    print("k", out["sharpness_k"])
    _save("confirm", out)


def stage_claims():
    out = {}
    gate = (yr >= 2021) & (yr <= 2023)
    from scipy.optimize import minimize as _min
    out["free_intercept_gate"] = {}
    for head in ("noline", "line"):
        ok = ROWS[head]; mg = ok & gate
        inc = annual(head, H0[head], [2021, 2022, 2023], 2019); z = lg(inc[mg]); yy = y[mg]
        f = lambda t: np.mean(np.logaddexp(0, t[0] + t[1] * z) - yy * (t[0] + t[1] * z))
        r1 = _min(f, [0, 1]); r0 = _min(lambda t: f([0, t[0]]), [1])
        out["free_intercept_gate"][head] = {"mean_pA": round(float(inc[mg].mean()), 3), "mean_y": round(float(yy.mean()), 3),
                                            "intercept": round(float(r1.x[0]), 3),
                                            "ll_gain_in_sample": round(float(r1.fun - r0.fun), 5)}
    cj = json.load(open(f"{ROOT}/data/derived/calib.json"))
    by, c24 = cj["drift"]["by_year"], cj["confirm"]["drift_2024_2025"]
    fams = [f for f in c24 if all(str(Y) in by.get(f, {}) for Y in range(2014, 2024))]
    out["cross_family_mean_log_slope"] = {"families": fams, "by_year": {
        str(Y): round(float(np.mean(np.log([by[f][str(Y)]["slope"] if Y < 2024 else c24[f][str(Y)]["slope"] for f in fams]))), 3)
        for Y in range(2014, 2026)}}
    mk = json.load(open(f"{ROOT}/data/derived/market.json"))["fights"]
    b = np.array([mk.get(f, {}).get("p_market_rating", np.nan) for f in D.fid], float); a = D.mr.to_numpy(float)
    va = ROWS["noline"] & (yr >= 2024); both = (yr >= 2019) & ROWS["noline"] & np.isfinite(a) & np.isfinite(b)
    miss = va & ~np.isfinite(b)
    Dm = D.mr.copy(); D.loc[miss, "mr"] = np.nan
    ok = ROWS["noline"]; tr = ok & (yr >= 2019) & (yr <= 2023); Z = Zof(["lr", "mr"])
    bb = nn_stack(Z[tr], y[tr], 0.5 ** ((2024 - yr[tr]) / 1.5)); p = sig(Z[va] @ bb); D["mr"] = Dm
    out["market_rating_gap"] = {"max_abs_diff_where_both_2019_2025": float(np.max(np.abs(a[both] - b[both]))),
                                "n_2024_25_missing_in_market_json": int(miss.sum()),
                                "noline_static_with_those_missing": [round(float(llv(p, y[va]).mean()), 5),
                                                                     round(float(slope(p, y[va])), 3)]}
    print(json.dumps(out, indent=1))
    _save("claims", out)


if __name__ == "__main__":
    st = sys.argv[1] if len(sys.argv) > 1 else "claims"
    {"gate": stage_gate, "oddseg": stage_oddseg, "confirm": stage_confirm, "claims": stage_claims}[st]()
