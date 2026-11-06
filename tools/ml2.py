#!/usr/bin/env python3
"""ML v2 feature union (task key: ml2): the winner model rebuilt on every verified feature source.

Run from the project root (stages cache into out/ml2_cache/, so each can be re-run alone):

    nice -n 5 python3 tools/ml2.py table      # feature union table (2010-2025; every 2026+ fight dropped at parse)
    nice -n 5 python3 tools/ml2.py cv         # time-ordered CV on pre-2024 data: blocks, penalties, trees
    nice -n 5 python3 tools/ml2.py fit        # OOF 2019-2023, static-2023 and monthly-rolling 2024-2025 predictions
    nice -n 5 python3 tools/ml2.py stage2     # 2019+-only sources (durability, oppadj, mlrates, methodround) on top
    nice -n 5 python3 tools/ml2.py stack      # no-line / with-line MoE-style stacks vs the current stack and the close
    nice -n 5 python3 tools/ml2.py method     # methodround model S refit with the new features (method, 7-bin)
    nice -n 5 python3 tools/ml2.py export     # data/derived/ml2.json (+ the page model and JS test vectors)
    nice -n 5 python3 tools/ml2.py all        # everything above in order

Needs Python 3 with numpy, pandas, scipy, scikit-learn, lightgbm, xgboost. The box is shared: BLAS is pinned to
one thread and tree work uses at most --jobs 2 processes.

Hidden-data protocol (docs/BACKLOG.md). build_db.parse_fights is wrapped at import so that every fight dated
2026-01-01 or later is dropped right after parsing, before people, vectors, Elo, ratings, market ratings or any
feature is built: no 2026 result can reach a fit, a choice or a score here. Every choice (feature blocks, penalties,
fade, tree configurations, blend and stack weights, calibration) is made by time-ordered CV on data before
2024-01-01; the validation years 2024-01-01..2025-12-31 are scored once. Sources keyed by backtest id
(ratings.json, market.json, durability.json, oppadj.json, mlrates_oof.json, methodround.json) are read only for
fights dated before 2026-01-01.

Corner symmetry (Evaluation rule): every logistic term is an A-minus-B antisymmetric function and no model has an
intercept; trees are trained on both corner orders and predictions average the two; stacks are no-intercept
logit-linear on mirrored data. The run asserts that swapping the corners maps every design to its negative.

research/model_ml2.md has the method, the results and the integration recipe.
"""
import os

for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "1")
import argparse
import datetime as dt
import hashlib
import json
import math
import pickle
import sys
import time
import warnings
from collections import defaultdict

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.dirname(HERE)
DERIVED = os.path.join(ROOT, "data", "derived")
CACHE = os.environ.get("ML2_CACHE", os.path.join(ROOT, "out", "ml2_cache"))
OUT_JSON = os.path.join(DERIVED, "ml2.json")
VAULT = dt.date(2026, 1, 1)
VAULT_S = "2026-01-01"
TEST_FROM, TEST_TO = 2024, 2025
os.makedirs(CACHE, exist_ok=True)
warnings.filterwarnings("ignore")

import build_db as B  # noqa: E402

_parse_orig = B.parse_fights


def _parse_dev_only(log):
    """build_db.parse_fights with every fight dated on or after VAULT removed right after parsing."""
    fights, ex = _parse_orig(log)
    return [f for f in fights if f.date < VAULT], ex


B.parse_fights = _parse_dev_only
import ml as M  # noqa: E402  (feature table, designs, LR/tree helpers; uses B.parse_fights)


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def jload(name):
    return json.load(open(os.path.join(DERIVED, name)))


def dev_only(d, datekey="date"):
    """Drop every entry dated on or after the vault (sources keyed by backtest id carry 2026 rows)."""
    return {k: v for k, v in d.items() if not (isinstance(v, dict) and str(v.get(datekey, "")) >= VAULT_S)}


def sig(z):
    return 1.0 / (1.0 + np.exp(-z))


def logit(p, c=1e-4):
    p = np.clip(np.asarray(p, float), c, 1 - c)
    return np.log(p / (1 - p))


# ====================================================================== metrics and bootstrap
def ll_vec(p, y):
    p = np.clip(np.asarray(p, float), 1e-6, 1 - 1e-6)
    y = np.asarray(y, float)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


def ll(p, y):
    return float(np.mean(ll_vec(p, y)))


def metrics(p, y):
    p = np.asarray(p, float)
    y = np.asarray(y, float)
    out = {"n": int(len(y)), "log_loss": round(ll(p, y), 5), "brier": round(float(np.mean((p - y) ** 2)), 5),
           "accuracy": round(float(np.mean(np.where(p == 0.5, 0.5, (p > 0.5) == (y > 0.5)))), 4)}
    out["calib_slope"] = round(M.calib_slope(p, y), 3)
    out["ece_sym"] = round(M.ece_sym(p, y), 4)
    return out


def boot(groups, arrays, n=2000, seed=7):
    """Event-cluster bootstrap of the mean of each per-fight array. Returns (B x k) matrix of means."""
    rng = np.random.default_rng(seed)
    g = pd.Series(list(groups)).astype("category").cat.codes.to_numpy()
    G = g.max() + 1
    A = np.vstack([np.asarray(a, float) for a in arrays]).T          # n x k
    S = np.zeros((G, A.shape[1]))
    np.add.at(S, g, A)
    C = np.bincount(g, minlength=G).astype(float)
    out = np.empty((n, A.shape[1]))
    for b in range(n):
        w = np.bincount(rng.integers(0, G, G), minlength=G).astype(float)
        out[b] = (w @ S) / (w @ C)
    return out


def ci_of(v):
    return [round(float(np.percentile(v, 2.5)), 4), round(float(np.percentile(v, 97.5)), 4)]


def compare(pa, pb, y, groups, n=2000, seed=7):
    """Mean log loss of a, b and a - b with event-cluster CIs (paired)."""
    la, lb = ll_vec(pa, y), ll_vec(pb, y)
    bs = boot(groups, [la, lb, la - lb], n, seed)
    return {"n": int(len(y)), "a": round(float(la.mean()), 5), "b": round(float(lb.mean()), 5),
            "a_ci": ci_of(bs[:, 0]), "diff": round(float((la - lb).mean()), 5), "diff_ci": ci_of(bs[:, 2]),
            "p_a_better": round(float(np.mean(bs[:, 2] < 0)), 3)}


# ====================================================================== stage: table
RATING_SYSTEMS = ["whr_rounds", "glicko2", "elo_full", "trueskill_mov", "whr_mov", "elo_rounds", "whr_hybrid"]


def cache_key():
    h = hashlib.sha256()
    for fn in sorted(os.listdir(B.RAW)):
        if fn.endswith(".csv"):
            st = os.stat(os.path.join(B.RAW, fn))
            h.update(("%s:%d:%d" % (fn, st.st_size, int(st.st_mtime))).encode())
    h.update(open(os.path.join(HERE, "ml.py"), "rb").read().split(
        b"# ====================================================================== logistic design")[0])
    return h.hexdigest()[:12]


def build_base():
    path = os.path.join(CACHE, "base_%s.pkl" % cache_key())
    if os.path.exists(path):
        return pickle.load(open(path, "rb"))
    t0 = time.time()
    fights, people, elo_pre = M.load_all()
    assert max(f.date for f in fights) < VAULT
    R_elo, _, _ = B.run_elo(fights, M.ELO_K, M.ELO_BOOST)
    tun, xr, R_extra = {}, {}, {}
    for mode, key in (("sig", "elo_sig"), ("judge", "elo_judge")):
        t = M.tune_margin_elo(fights, mode)
        tun[key] = {k: v for k, v in t.items() if k != "grid"}
        xr[key], _, R_extra[key] = M.margin_elo(fights, t["K"], t["w_share"], mode)
    df, state, _ = M.build_table(fights, people, elo_pre, xr, snapshot=dt.date(2025, 12, 31))
    df = M.add_derived(df)
    # prior UFC fights per side (walk-forward count, every UFC bout since 1994)
    seen = defaultdict(int)
    npr = {}
    for f in fights:
        a, b = f.persons
        npr[f.fid] = (seen[a], seen[b])
        seen[a] += 1
        seen[b] += 1
    df["nA"] = df["fid"].map(lambda k: npr[k][0])
    df["nB"] = df["fid"].map(lambda k: npr[k][1])
    # date of each person's 4th UFC bout (prior count 3): pre-UFC snapshots are complete for anyone whose
    # bouts 1-4 include one on/after 2015-01-01 (tools/preufc.py target rule), a fact known before later bouts
    k_dates = defaultdict(list)
    for f in fights:
        for p in f.persons:
            if len(k_dates[p]) < 4:
                k_dates[p].append(f.date)
    obj = {"df": df, "tun": tun, "k_dates": dict(k_dates), "people_slug": {p: (P.get("slug") or p)
                                                                          for p, P in people.items()}}
    pickle.dump(obj, open(path, "wb"))
    log("base table %s in %.0f s" % (df.shape, time.time() - t0))
    return obj


def build_ratings():
    """Rerun tools/ratings.py systems with the parameters it tuned on 2019-2023 (ratings.json) over every bout,
    the data stream cut at 2026-01-01, so 2010-2018 training rows get the same features as 2019-2025."""
    path = os.path.join(CACHE, "ratings_all.pkl")
    if os.path.exists(path):
        return pickle.load(open(path, "rb"))
    import ratings as RT
    D = RT.load_data()
    RT.prepare(D, log=lambda s: None)
    assert D.day.max() < VAULT.toordinal()
    J = jload("ratings.json")
    ev = np.where(D.day >= dt.date(2009, 1, 1).toordinal())[0]
    out = {}
    for name in RATING_SYSTEMS:
        S = J["systems"][name]
        t0 = time.time()
        p, rec, _ = RT.run_system(D, S["kind"], S["params"], until=VAULT.toordinal(), record=True, eval_idx=ev)
        out[name] = {"p": p, "rec": rec}
        log("ratings %s rebuilt in %.0f s" % (name, time.time() - t0))
    # check against ratings.json on the dev backtest fights
    fidx = {f: i for i, f in enumerate(D.fid)}
    chk = {}
    for name in RATING_SYSTEMS:
        d = [abs(out[name]["p"][fidx[f]] - e["p"][name]) for f, e in dev_only(J["predictions"]).items()
             if f in fidx and e["p"].get(name) is not None]
        chk[name] = {"n": len(d), "max_abs_diff": float(max(d))}
    obj = {"fid": list(D.fid), "p": {k: v["p"] for k, v in out.items()}, "rec": {k: v["rec"] for k, v in out.items()},
           "check_vs_ratings_json": chk}
    pickle.dump(obj, open(path, "wb"))
    return obj


MR_PARAMS = {"sig_m": 0.5, "tau": 0.5, "v0": 1.5, "mu0": 0.0, "kappa": 1.5}   # market.json eval.market_rating.params


def build_market_rating(df):
    """tools/market.py's walk-forward Kalman market rating (filter on earlier closing lines and results), rebuilt
    from 2013 so pre-2019 rows have it. Same stream as market.py (nlbair closes; this tool's closes from
    market.json for dev fights), cut at 2025-12-31. Returns per fid: p_A, mu/var/n per side before the fight."""
    nl = pd.read_csv(os.path.join(ROOT, "data", "raw", "odds", "nlbair_odds.csv"), low_memory=False)
    nl = nl[nl["event_date"] < VAULT_S]
    mk = dev_only(jload("market.json")["fights"])
    # market.json has no date per entry: restrict to dev fights through the base table
    dev_ids = set(df["fid"])
    stream, have = [], set()
    for q in nl.itertuples():
        if q.fight_id in mk and "p_novig_close" in mk[q.fight_id]:
            pc = mk[q.fight_id]["p_novig_close"]
        elif q.has_odds and not pd.isna(q.f1_close_prob_novig):
            pc = q.f1_close_prob_novig
        else:
            pc = None
        y = {1.0: 1.0, 2.0: 0.0, 0.0: 0.5}.get(q.winner)
        stream.append({"id": q.fight_id, "date": q.event_date, "i": q.f1_id, "j": q.f2_id, "p": pc, "y": y})
        have.add(q.fight_id)
    sub = df[(df["date"] >= dt.date(2013, 1, 1))]
    for r in sub.itertuples():
        if r.fid in have or r.fid not in mk or r.amb:
            continue
        y = {"A": 1.0, "B": 0.0, "D": 0.5}.get(r.winner)
        stream.append({"id": r.fid, "date": r.date.isoformat(), "i": r.a, "j": r.b,
                       "p": mk[r.fid].get("p_novig_close"), "y": y})
    stream.sort(key=lambda x: (x["date"], x["id"]))
    P = MR_PARAMS
    mu, var, last, n = {}, {}, {}, defaultdict(int)
    out = {}
    for e in stream:
        if e["date"] >= VAULT_S:
            break
        d = dt.date.fromisoformat(e["date"])
        for k in (e["i"], e["j"]):
            if k not in mu:
                mu[k], var[k] = P["mu0"], P["v0"]
            else:
                gap = (d - last[k]).days / 365.25
                var[k] = min(var[k] + P["tau"] ** 2 * max(gap, 0), P["v0"] * 2)
            last[k] = d
        i, j = e["i"], e["j"]
        m = mu[i] - mu[j]
        s2 = var[i] + var[j]
        out[e["id"]] = (1 / (1 + math.exp(-m / math.sqrt(1 + math.pi * s2 / 8))), mu[i], var[i], n[i],
                        mu[j], var[j], n[j], e["p"] is not None)
        if e["p"] is not None:
            z = math.log(min(max(e["p"], 0.02), 0.98) / (1 - min(max(e["p"], 0.02), 0.98)))
            S = s2 + P["sig_m"] ** 2
            rr = z - m
            ki, kj = var[i] / S, var[j] / S
            mu[i] += ki * rr
            mu[j] -= kj * rr
            var[i] *= (1 - ki)
            var[j] *= (1 - kj)
        if e["y"] is not None and P["kappa"] > 0:
            m2 = mu[i] - mu[j]
            p2 = 1 / (1 + math.exp(-m2))
            g, h = e["y"] - p2, p2 * (1 - p2)
            den = 1 + P["kappa"] * h * (var[i] + var[j])
            mu[i] += P["kappa"] * var[i] * g / den
            mu[j] -= P["kappa"] * var[j] * g / den
            var[i] *= 1 - P["kappa"] * var[i] * h / den
            var[j] *= 1 - P["kappa"] * var[j] * h / den
        n[i] += 1
        n[j] += 1
    chk = [abs(out[f][0] - v["p_market_rating"]) for f, v in mk.items() if f in out and "p_market_rating" in v
           and f in dev_ids]
    state = {k: [mu[k], var[k], last[k].isoformat(), n[k]] for k in mu}
    return out, {"n": len(chk), "max_abs_diff": float(max(chk)) if chk else None,
                 "share_gt_1e-3": float(np.mean(np.array(chk) > 1e-3)) if chk else None}, state


PRE_CORE = ["pre_wpct", "pre_logn", "pre_fin", "pre_finl", "pre_streak", "pre_feed", "pre_grad", "pre_oppufc",
            "pre_netelo", "pre_dwcs", "pre_agedeb"]


def build_preufc(df, k_dates, slug_of):
    """Per side: preufc.side_pre (strict network) from the snapshot of that bout, kept only when the fighter is
    in preufc's target set by a pre-fight rule (one of his first four UFC bouts on/after 2015-01-01, the
    current bout included), so presence never depends on how his career went afterwards."""
    import preufc as PU
    J = jload("preufc.json")
    cols = J["meta"]["snapshot_columns"]
    ci = {c: k for k, c in enumerate(cols)}
    snaps = {}
    for slug, rec in J["fighters"].items():
        for row in rec.get("snapshots") or []:
            if row[ci["date"]] >= VAULT_S:
                continue
            snaps[(row[ci["fid"]], slug)] = {c: row[ci[c]] for c in cols}
    cut = dt.date(2015, 1, 1)
    out = {}
    for r in df.itertuples():
        res = []
        for p, nprior in ((r.a, r.nA), (r.b, r.nB)):
            kd = k_dates.get(p, [])
            ok = any(d >= cut for d in kd[:min(int(nprior), 3) + 1])
            s = snaps.get((r.fid, slug_of.get(p, p))) if ok else None
            v = PU.side_pre(s, nprior) if s else None
            res.append(v)
        out[r.fid] = res
    return out


def build_fightweek(df):
    J = jload("fightweek.json")["fights"]
    out = {}
    for fid in df["fid"]:
        e = J.get(fid)
        if not e or e.get("date", "") >= VAULT_S:
            continue
        iso = (e.get("venue") or {}).get("iso3")
        sides = []
        for s in ("A", "B"):
            sn = (e.get("short_notice") or {}).get(s)
            tz = (e.get("tz_shift_h") or {}).get(s)
            km = (e.get("travel_km") or {}).get(s)
            sides.append({
                "fw_missed": float(bool((e.get("missed") or {}).get(s))),
                "fw_repl": float(bool((e.get("replacement") or {}).get(s))),
                "fw_repl14": float(bool((e.get("replacement") or {}).get(s)) and sn is not None and sn <= 14),
                "fw_home_intl": float(bool((e.get("home") or {}).get(s)) and iso not in (None, "USA")),
                "fw_home_any": float(bool((e.get("home_any") or {}).get(s))),
                "fw_tz": abs(tz) if tz is not None else np.nan,
                "fw_travel": math.log1p(km / 1000.0) if km is not None else np.nan,
                "fw_oppchg": float((e.get("opp_change") or {}).get(s) is not None),
            })
        out[fid] = (sides, {"no_crowd": float(bool(e.get("no_crowd"))), "alt": (e.get("venue") or {}).get("altitude_m")})
    return out


def build_late(df):
    """2019+-only sources keyed by backtest id (durability, oppadj, mlrates_oof, methodround S)."""
    fids = set(df["fid"])
    out = defaultdict(dict)
    du = dev_only(jload("durability.json")["backtest"])
    for f, e in du.items():
        if f in fids:
            out[f]["du"] = (math.log(e["A"]["chin_re"]), math.log(e["A"]["pow_re"]), math.log(e["B"]["chin_re"]),
                            math.log(e["B"]["pow_re"]), math.log(e["p"]["A"]), math.log(e["p"]["B"]))
    oa = jload("oppadj.json")["snapshots"]
    keys = ["dAtt", "dAttAg", "tdAtt", "tdAttAg", "tdAcc", "tdAccAg", "ctrl", "octrl", "sub", "subAg", "pow", "chin"]
    for f, e in oa.items():
        if f in fids:
            va = [math.log(max(e["A"][k], 1e-3)) for k in keys] + [math.log(max(e["A"]["acc"][0], 1e-3)),
                                                                  math.log(max(e["A"]["accAg"][0], 1e-3))]
            vb = [math.log(max(e["B"][k], 1e-3)) for k in keys] + [math.log(max(e["B"]["acc"][0], 1e-3)),
                                                                  math.log(max(e["B"]["accAg"][0], 1e-3))]
            out[f]["oa"] = (va, vb)
    mr = dev_only(jload("mlrates_oof.json")["fights"])
    for f, e in mr.items():
        if f in fids:
            out[f]["mlr"] = (e["A"], e["B"], e.get("src"))
    me = dev_only(jload("methodround.json")["fights"])
    for f, e in me.items():
        if f in fids and e.get("sum_S"):
            s = e["sum_S"]
            out[f]["mr_s"] = (s["p_a"], s["p_b"], s["p_fin"], s["p_ko"], s["p_sub"])
    return dict(out)


def stage_table(args):
    base = build_base()
    df = base["df"].copy()
    df = df[df["date"] < VAULT].reset_index(drop=True)
    rat = build_ratings()
    fidx = {f: i for i, f in enumerate(rat["fid"])}
    ii = df["fid"].map(fidx)
    assert ii.notna().all()
    ii = ii.astype(int).to_numpy()
    for name in RATING_SYSTEMS:
        df["r_" + name] = rat["p"][name][ii]
    for name in ("whr_rounds", "glicko2"):           # rating uncertainty per side (sd), for the newcomer gate
        rec = rat["rec"][name][ii]
        df["A_rsd_" + name] = rec[:, 1]
        df["B_rsd_" + name] = rec[:, 3]
    mr, mr_chk, mr_state = build_market_rating(df)
    cols = ["mr_p", "A_mr_mu", "A_mr_var", "A_mr_n", "B_mr_mu", "B_mr_var", "B_mr_n", "mr_line"]
    vals = np.array([mr.get(f, (np.nan,) * 7 + (False,)) for f in df["fid"]], dtype=object)
    for k, c in enumerate(cols):
        df[c] = vals[:, k].astype(float)
    df["mr_ok"] = df["mr_p"].notna().astype(float)
    pre = build_preufc(df, base["k_dates"], base["people_slug"])
    for s_i, s in enumerate(("A_", "B_")):
        df[s + "pre_ok"] = [float(pre[f][s_i] is not None) for f in df["fid"]]
        for k in PRE_CORE:
            df[s + k] = [(pre[f][s_i] or {}).get(k, np.nan) for f in df["fid"]]
    fw = build_fightweek(df)
    for s_i, s in enumerate(("A_", "B_")):
        for k in ("fw_missed", "fw_repl", "fw_repl14", "fw_home_intl", "fw_home_any", "fw_tz", "fw_travel",
                  "fw_oppchg"):
            df[s + k] = [fw[f][0][s_i][k] if f in fw else np.nan for f in df["fid"]]
    df["fw_ok"] = df["fid"].isin(fw).astype(float)
    late = build_late(df)
    df["y"] = df["winner"].map({"A": 1.0, "B": 0.0})
    df["dec"] = df["winner"].isin(["A", "B"]) & ~df["amb"]
    df["evalrow"] = df["dec"] & df["both_exp"]
    pickle.dump({"df": df, "late": late, "mr_check": mr_chk, "mr_state": mr_state,
                 "ratings_check": rat["check_vs_ratings_json"], "tun": base["tun"]},
                open(os.path.join(CACHE, "table.pkl"), "wb"))
    log("table %s; market rating check %s; ratings check %s" % (df.shape, mr_chk,
        {k: round(v["max_abs_diff"], 6) for k, v in rat["check_vs_ratings_json"].items()}))
    cov = df.groupby("year").agg(n=("fid", "size"), mr=("mr_ok", "mean"), pre=("A_pre_ok", "mean"),
                                 fw=("fw_ok", "mean")).round(3)
    log("coverage by year:\n%s" % cov.to_string())


def load_table():
    return pickle.load(open(os.path.join(CACHE, "table.pkl"), "rb"))


# ====================================================================== designs
BASE_SPECS = [t for t in M.lr_term_specs() if M.term_group(t["name"]) != "striking rates"]  # ml.py's 80 terms
BASE_COLS = [t["name"] for t in BASE_SPECS]
PRE_MEAN = {}          # centring of the pre-UFC block (debut-side means, 2015-2023), set in prep_designs


def pre_means(df):
    m = (df["date"] < dt.date(2024, 1, 1))
    vals = {}
    for k in PRE_CORE:
        a = df.loc[m & (df["A_pre_ok"] > 0) & (df["nA"] == 0), "A_" + k]
        b = df.loc[m & (df["B_pre_ok"] > 0) & (df["nB"] == 0), "B_" + k]
        vals[k] = float(pd.concat([a, b]).mean())
    return vals


def side_pre_terms(df, s, tau, means):
    n = df["n" + s[0]].to_numpy(float)
    ok = df[s + "pre_ok"].to_numpy(float)
    fade = ok * (np.exp(-n / tau) if tau else 1.0)
    out = {}
    for k in PRE_CORE:
        v = df[s + k].to_numpy(float) - means[k]
        out[k] = np.nan_to_num(v) * fade
    return out


def new_terms(df, cfg):
    """Antisymmetric A-minus-B terms of the new blocks. cfg: {'blocks': [...], 'tau': pre fade}."""
    blocks = cfg["blocks"]
    T = {}
    nA, nB = df["nA"].to_numpy(float), df["nB"].to_numpy(float)
    nmin = np.minimum(nA, nB)
    g_new = (nmin <= 2).astype(float)
    if "rat" in blocks:
        for name in cfg.get("rat_sys", ["whr_rounds", "glicko2", "elo_full", "trueskill_mov"]):
            T["z_" + name] = logit(df["r_" + name].to_numpy(float), 1e-3)
    if "mr" in blocks:
        z = np.nan_to_num(logit(df["mr_p"].to_numpy(float), 1e-3))
        T["z_mr"] = z
    if "pre" in blocks:
        pa = side_pre_terms(df, "A_", cfg.get("tau", 8.0), cfg["pre_means"])
        pb = side_pre_terms(df, "B_", cfg.get("tau", 8.0), cfg["pre_means"])
        for k in PRE_CORE:
            T["d_" + k] = pa[k] - pb[k]
    if "fw" in blocks:
        for k in ("fw_missed", "fw_repl", "fw_repl14", "fw_home_intl", "fw_home_any", "fw_oppchg"):
            T["d_" + k] = np.nan_to_num(df["A_" + k].to_numpy(float) - df["B_" + k].to_numpy(float))
        for k in ("fw_tz", "fw_travel"):
            T["d_" + k] = np.nan_to_num(df["A_" + k].to_numpy(float) - df["B_" + k].to_numpy(float))
    if "exp" in blocks:          # UFC-experience buckets (antisymmetric indicator differences)
        T["d_n12"] = ((nA >= 1) & (nA <= 2)).astype(float) - ((nB >= 1) & (nB <= 2)).astype(float)
        T["d_n35"] = ((nA >= 3) & (nA <= 5)).astype(float) - ((nB >= 3) & (nB <= 5)).astype(float)
    if "gate" in blocks:         # newcomer gate: market-rating / rating evidence weighted up in newcomer bouts
        if "z_mr" in T:
            T["g_mr_new"] = T["z_mr"] * g_new
        zr = logit(df["r_whr_rounds"].to_numpy(float), 1e-3)
        T["g_whr_new"] = zr * g_new
        T["g_elo_new"] = (df["A_elo_judge"] - df["B_elo_judge"]).to_numpy(float) * 0.01 * g_new
    return pd.DataFrame(T, index=df.index)


def lr_matrix(df, cfg):
    Xb = M.lr_design(df, BASE_SPECS)
    Xn = new_terms(df, cfg)
    return pd.concat([Xb, Xn], axis=1)


def flip_df(df):
    """Swap the corners of a table (A_ <-> B_, nA <-> nB, P(A) -> 1 - P(A), M_ antisymmetric terms negated)."""
    g = df.copy()
    for c in df.columns:
        if c.startswith("A_"):
            g["B_" + c[2:]] = df[c]
        elif c.startswith("B_"):
            g["A_" + c[2:]] = df[c]
    g["nA"], g["nB"] = df["nB"], df["nA"]
    g["a"], g["b"] = df["b"], df["a"]
    for c in ["mr_p"] + ["r_" + s for s in RATING_SYSTEMS]:
        g[c] = 1 - df[c]
    for c in M.M_ANTI:
        g["M_" + c] = -df["M_" + c]
    g["y"] = 1 - df["y"]
    return g


GBM_SIDE_X = ["nA_", "mr_var", "rsd_whr_rounds", "pre_ok"]
MONO = ["d_elo", "d_elo_sig", "d_elo_judge", "z_whr_rounds", "z_glicko2", "z_elo_full", "z_trueskill_mov", "z_mr"]


def gbm_matrix(df, Xlr, flip=False):
    """ml.py's tree design (side levels, A-minus-B terms, matchup, context) plus the new blocks' terms and a few
    side levels / symmetric context for the newcomer handling. flip=True builds the swapped-corner rows."""
    G = M.gbm_design(df, Xlr[BASE_COLS], flip)
    sg = -1.0 if flip else 1.0
    for c in Xlr.columns:
        if "d_" + c not in G.columns:
            G["d_" + c] = sg * Xlr[c].to_numpy(float)
    a, b = ("B_", "A_") if flip else ("A_", "B_")
    na, nb = (df["nB"], df["nA"]) if flip else (df["nA"], df["nB"])
    G["a_nprior"], G["b_nprior"] = na.to_numpy(float), nb.to_numpy(float)
    for k in ("mr_var", "rsd_whr_rounds", "pre_ok"):
        G["a_" + k] = df[a + k].to_numpy(float)
        G["b_" + k] = df[b + k].to_numpy(float)
    G["s_nmin"] = np.minimum(df["nA"], df["nB"]).to_numpy(float)
    G["s_mr_ok"] = df["mr_ok"].to_numpy(float)
    return G


def prep_designs(T, cfg):
    X = lr_matrix(T, cfg)
    return X


def symmetry_check(T, cfg):
    sub = T[T["evalrow"]].sample(300, random_state=1)
    X1 = lr_matrix(sub, cfg)
    X2 = lr_matrix(flip_df(sub), cfg)
    err = float(np.abs(X1.to_numpy() + X2.to_numpy()).max())
    G0 = gbm_matrix(sub, X1, False)
    G1f = gbm_matrix(flip_df(sub), X2, False)
    G1 = gbm_matrix(sub, X1, True)
    err_g = float(np.nanmax(np.abs(G1.to_numpy(float) - G1f.to_numpy(float))))
    return {"lr_max_abs(X + X_swapped)": err, "gbm_max_abs(flip - built_from_swapped)": err_g,
            "ok": err < 1e-9 and err_g < 1e-9}


# ====================================================================== main
STAGES = {}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("stage", choices=["table", "cv", "fit", "stage2", "stack", "method", "export", "all"])
    ap.add_argument("--jobs", type=int, default=2)
    ap.add_argument("--quick", action="store_true")
    args = ap.parse_args()
    order = ["table", "cv", "fit", "stage2", "stack", "method", "export"] if args.stage == "all" else [args.stage]
    for st in order:
        t0 = time.time()
        log("== stage %s" % st)
        (stage_table if st == "table" else STAGES[st])(args)
        log("== stage %s done in %.0f s" % (st, time.time() - t0))


if __name__ == "__main__":
    main()
