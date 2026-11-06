#!/usr/bin/env python3
"""ML v2 feature union (task key: ml2): the winner model rebuilt on every verified feature source.

Run from the project root (stages cache into out/ml2_cache/, so each can be re-run alone):

    nice -n 5 python3 tools/ml2.py table      # feature union table (2010-2025; every 2026+ fight dropped at parse)
    nice -n 5 python3 tools/ml2.py cv         # time-ordered CV on pre-2024 data: blocks, penalties, trees
    nice -n 5 python3 tools/ml2.py fit        # OOF 2019-2023, static-2023 and monthly-rolling 2024-2025 predictions
    nice -n 5 python3 tools/ml2.py stage2     # 2019+-only sources (durability, oppadj, mlrates, methodround) on top
    nice -n 5 python3 tools/ml2.py stack      # no-line / with-line MoE-style stacks vs the current stack and the close
    nice -n 5 python3 tools/ml2.py method     # methodround model S refit with the new features (method, 7-bin)
    nice -n 5 python3 tools/ml2.py verify     # truncation / flipped-result tests of the rebuilt rating features
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
STAGES = {}

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
    out["calib_slope"] = round(M.calib_slope(p, y)[1], 3)
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
PRE_METHOD = ["pre_ko", "pre_sub", "pre_kol", "pre_subl"]        # finish profile, for the method model


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
        for k in PRE_CORE + PRE_METHOD:
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


# ====================================================================== stage: cv (pre-2024 only)
BLOCKS = [(2016, 2017), (2018, 2019), (2020, 2021), (2022, 2023)]
TAUS = [2.0, 4.0, 8.0, 16.0, None]
LAMS = [0.02, 0.05, 0.1, 0.2]
NEW_BLOCKS = ["rat", "mr", "pre", "fw", "exp", "gate"]
SEL_MIN = 0.0005
_G = {}


def superset_matrix(T, pm):
    """Every candidate LR column (the pre block once per fade tau) so CV configs are column subsets."""
    cfg = {"blocks": ["rat", "mr", "fw", "exp", "gate"], "pre_means": pm,
           "rat_sys": RATING_SYSTEMS}
    X = lr_matrix(T, cfg)
    for tau in TAUS:
        P = new_terms(T, {"blocks": ["pre"], "tau": tau, "pre_means": pm})
        P.columns = ["%s@%s" % (c, tau) for c in P.columns]
        X = pd.concat([X, P], axis=1)
    return X


def block_cols(X, blocks, tau, rat_sys=("whr_rounds", "glicko2", "elo_full", "trueskill_mov"), drop_groups=()):
    cols = [c for c in BASE_COLS if M.term_group(c) not in drop_groups]
    if "rat" in blocks:
        cols += ["z_" + s for s in rat_sys]
    if "mr" in blocks:
        cols += ["z_mr"]
    if "pre" in blocks:
        cols += ["d_%s@%s" % (k, tau) for k in PRE_CORE]
    if "fw" in blocks:
        cols += [c for c in X.columns if c.startswith("d_fw_")]
    if "exp" in blocks:
        cols += ["d_n12", "d_n35"]
    if "gate" in blocks:
        cols += (["g_mr_new"] if "mr" in blocks else []) + ["g_whr_new", "g_elo_new"]
    return cols


def cv_masks(T, y0, y1, train_set="all", since=None):
    yr = T["year"].to_numpy()
    tr = T["dec"].to_numpy() & (yr < y0)
    if since:
        tr &= yr >= since
    if train_set == "both_exp":
        tr &= T["both_exp"].to_numpy()
    va = T["evalrow"].to_numpy() & (yr >= y0) & (yr <= y1)
    return tr, va


def _lr_cv_one(job):
    cols, lam, rec, train_set, since = job
    T, X, y = _G["T"], _G["X"], _G["y"]
    Xc = X[cols].to_numpy(float)
    yrs = T["year"].to_numpy()
    tot, n, per = 0.0, 0, []
    for y0, y1 in BLOCKS:
        tr, va = cv_masks(T, y0, y1, train_set, since)
        m = M.LRModel(lam, rec).fit(Xc[tr], y[tr], yrs[tr], y0)
        l = ll(m.predict(Xc[va]), y[va])
        tot += l * va.sum()
        n += va.sum()
        per.append(round(l, 5))
    return round(tot / n, 5), per


def run_jobs(fn, jobs, n_jobs):
    if n_jobs <= 1 or len(jobs) < 2:
        return [fn(j) for j in jobs]
    from multiprocessing import Pool
    with Pool(n_jobs) as pool:
        return pool.map(fn, jobs)


def lr_search(cols, n_jobs, lams=LAMS, rec=None, train_set="all", since=None):
    res = run_jobs(_lr_cv_one, [(cols, lam, rec, train_set, since) for lam in lams], n_jobs)
    k = int(np.argmin([r[0] for r in res]))
    return {"lam": lams[k], "cv": res[k][0], "blocks": res[k][1], "grid": {str(l): r[0] for l, r in zip(lams, res)}}


def stage_cv(args):
    S = load_table()
    T = S["df"]
    pm = pre_means(T)
    X = superset_matrix(T, pm)
    y = T["y"].fillna(0.5).to_numpy(float)
    _G.update(T=T, X=X, y=y)
    sym = symmetry_check(T, {"blocks": NEW_BLOCKS, "tau": 8.0, "pre_means": pm})
    log("symmetry check %s" % sym)
    assert sym["ok"], sym
    R = {"symmetry": sym, "pre_means": pm}
    nj = args.jobs
    # 1. baseline: ml.py's 80 terms (reproduces its CV)
    base = lr_search(block_cols(X, [], None), nj)
    log("base LR CV %.5f (lam %s) %s" % (base["cv"], base["lam"], base["blocks"]))
    R["base"] = base
    # 2. greedy forward selection of the new blocks (tau of the pre block searched when it enters)
    chosen, cur, tau = [], base, 8.0
    path = []
    while True:
        best = None
        for b in NEW_BLOCKS:
            if b in chosen:
                continue
            if b == "gate" and not ({"rat", "mr"} & set(chosen)):
                continue
            taus = TAUS if b == "pre" else [tau]
            for tt in taus:
                r = lr_search(block_cols(X, chosen + [b], tt), nj)
                log("  + %s (tau %s): CV %.5f lam %s" % (b, tt, r["cv"], r["lam"]))
                path.append({"step": len(chosen) + 1, "add": b, "tau": tt, "cv": r["cv"], "lam": r["lam"]})
                if best is None or r["cv"] < best[1]["cv"]:
                    best = (b, r, tt)
        if best is None or best[1]["cv"] > cur["cv"] - SEL_MIN:
            break
        chosen.append(best[0])
        cur, tau = best[1], best[2]
        log("ADD %s -> CV %.5f (lam %s, tau %s)" % (best[0], cur["cv"], cur["lam"], tau))
    R["forward"] = {"path": path, "chosen": chosen, "tau": tau, "cv": cur["cv"], "lam": cur["lam"]}
    # 3. rating systems: the four rated best by ratings.py's own tuning vs all seven
    rs_best = ("whr_rounds", "glicko2", "elo_full", "trueskill_mov")
    if "rat" in chosen:
        alt = {}
        for name, rs in (("whr_rounds only", ("whr_rounds",)), ("whr_rounds+glicko2", ("whr_rounds", "glicko2")),
                         ("four", rs_best), ("all seven", tuple(RATING_SYSTEMS))):
            r = lr_search(block_cols(X, chosen, tau, rs), nj)
            alt[name] = r["cv"]
            log("  rating set %s: CV %.5f" % (name, r["cv"]))
        pick = min(alt, key=alt.get)
        if alt[pick] < alt["four"] - SEL_MIN:
            rs_best = {"whr_rounds only": ("whr_rounds",), "whr_rounds+glicko2": ("whr_rounds", "glicko2"),
                       "all seven": tuple(RATING_SYSTEMS)}[pick]
        R["rating_sets"] = alt
    R["rat_sys"] = list(rs_best)
    cur = lr_search(block_cols(X, chosen, tau, rs_best), nj)
    # 4. backward elimination of ml.py's base groups now that the new blocks are in
    drops, bpath = [], []
    groups = sorted({M.term_group(c) for c in BASE_COLS})
    while True:
        best = None
        for g in groups:
            if g in drops:
                continue
            r = lr_search(block_cols(X, chosen, tau, rs_best, drops + [g]), nj, lams=[cur["lam"]])
            bpath.append({"drop": g, "cv": r["cv"]})
            if best is None or r["cv"] < best[1]["cv"]:
                best = (g, r)
        if best is None or best[1]["cv"] > cur["cv"] - SEL_MIN:
            break
        drops.append(best[0])
        cur = lr_search(block_cols(X, chosen, tau, rs_best, drops), nj)
        log("DROP base group %s -> CV %.5f" % (best[0], cur["cv"]))
    R["backward"] = {"path": bpath, "dropped": drops}
    cols = block_cols(X, chosen, tau, rs_best, drops)
    # 5. training set and recency weighting
    alt = {"all": cur["cv"]}
    for name, kw in (("both_exp", {"train_set": "both_exp"}), ("recency 8y", {"rec": 8.0}),
                     ("recency 4y", {"rec": 4.0}), ("since 2013", {"since": 2013})):
        r = lr_search(cols, nj, lams=[cur["lam"]], **kw)
        alt[name] = r["cv"]
        log("  train variant %s: CV %.5f" % (name, r["cv"]))
    pick = min(alt, key=alt.get)
    train = {"train_set": "all", "rec": None, "since": None}
    if alt[pick] < alt["all"] - SEL_MIN:
        train = {"both_exp": {"train_set": "both_exp", "rec": None, "since": None},
                 "recency 8y": {"train_set": "all", "rec": 8.0, "since": None},
                 "recency 4y": {"train_set": "all", "rec": 4.0, "since": None},
                 "since 2013": {"train_set": "all", "rec": None, "since": 2013}}[pick]
    R["train_variants"] = alt
    fin = lr_search(cols, nj, lams=[0.01, 0.02, 0.03, 0.05, 0.07, 0.1, 0.15, 0.2, 0.3],
                    rec=train["rec"], train_set=train["train_set"], since=train["since"])
    log("FINAL LR: %d terms, blocks %s, tau %s, lam %s, CV %.5f (base %.5f)"
        % (len(cols), chosen, tau, fin["lam"], fin["cv"], base["cv"]))
    R["lr"] = {"cols": cols, "blocks": chosen, "tau": tau, "rat_sys": list(rs_best), "drop_groups": drops,
               "lam": fin["lam"], "cv": fin["cv"], "cv_blocks": fin["blocks"], "grid": fin["grid"], **train}
    # 6. single-block ablations from the final model (CV change when one new block is removed)
    abl = {}
    for b in chosen:
        r = lr_search(block_cols(X, [c for c in chosen if c != b], tau, rs_best, drops), nj, lams=[fin["lam"]],
                      rec=train["rec"], train_set=train["train_set"], since=train["since"])
        abl[b] = round(r["cv"] - fin["cv"], 5)
    R["lr_ablation_drop_one"] = abl
    log("ablation (CV change when dropped): %s" % abl)
    # 7. trees
    R["trees"] = tune_trees(T, X, y, cols, args)
    json.dump(R, open(os.path.join(CACHE, "cv.json"), "w"), indent=1, default=float)


# ------------------------------------------------------------------ trees
GBM_CFGS = [
    {"num_leaves": 7, "min_data_in_leaf": 160, "feature_fraction": 0.6, "bagging_fraction": 0.7, "lambda_l2": 60.0},
    {"num_leaves": 5, "min_data_in_leaf": 200, "feature_fraction": 0.4, "bagging_fraction": 0.8, "lambda_l2": 30.0},
    {"num_leaves": 11, "min_data_in_leaf": 240, "feature_fraction": 0.5, "bagging_fraction": 0.7, "lambda_l2": 100.0},
    {"num_leaves": 4, "min_data_in_leaf": 120, "feature_fraction": 0.3, "bagging_fraction": 0.8, "lambda_l2": 10.0},
    {"num_leaves": 7, "min_data_in_leaf": 320, "feature_fraction": 0.3, "bagging_fraction": 0.85, "lambda_l2": 30.0},
]
XGB_CFGS = [
    {"max_depth": 4, "min_child_weight": 60, "subsample": 0.9, "colsample_bytree": 0.4, "lambda": 50.0},
    {"max_depth": 3, "min_child_weight": 40, "subsample": 0.8, "colsample_bytree": 0.3, "lambda": 20.0},
    {"max_depth": 2, "min_child_weight": 30, "subsample": 0.8, "colsample_bytree": 0.5, "lambda": 10.0},
]
LGB_LR, XGB_ETA = 0.04, 0.04
CHECKS = list(range(50, 801, 25))


def tree_mats(T, X, cols):
    Xl = X[BASE_COLS + [c for c in cols if c not in BASE_COLS]]    # trees always see ml.py's full base set
    G0 = gbm_matrix(T, Xl, False)
    G1 = gbm_matrix(T, Xl, True)
    return G0, G1


def mono_vec(G, on):
    return [1 if (on and c in ["d_" + m for m in MONO] + MONO) else 0 for c in G.columns]


def lgb_train(cfg, G0, G1, y, rounds, seed, mono, sw=None):
    import lightgbm as lgb
    Xa = pd.concat([G0, G1], ignore_index=True)
    ya = np.r_[y, 1 - y]
    p = dict(cfg)
    p.update(objective="binary", verbose=-1, num_threads=1, max_bin=63, seed=seed, bagging_seed=seed,
             feature_fraction_seed=seed, bagging_freq=1, deterministic=True, force_row_wise=True,
             learning_rate=LGB_LR)
    if mono:
        p["monotone_constraints"] = mono_vec(G0, True)
        p["monotone_constraints_method"] = "advanced"
    return lgb.train(p, lgb.Dataset(Xa, ya, weight=None if sw is None else np.r_[sw, sw]), num_boost_round=rounds)


def lgb_predict(m, G0, G1, it=None):
    return 0.5 * (m.predict(G0, num_iteration=it) + 1 - m.predict(G1, num_iteration=it))


def xgb_train(cfg, G0, G1, y, rounds, seed, mono):
    import xgboost as xgb
    Xa = pd.concat([G0, G1], ignore_index=True)
    ya = np.r_[y, 1 - y]
    p = dict(cfg)
    p.update(objective="binary:logistic", eval_metric="logloss", nthread=1, tree_method="hist", max_bin=63,
             seed=seed, verbosity=0, eta=XGB_ETA)
    if mono:
        p["monotone_constraints"] = "(" + ",".join(str(v) for v in mono_vec(G0, True)) + ")"
    return xgb.train(p, xgb.DMatrix(Xa, label=ya), num_boost_round=rounds)


def xgb_predict(m, G0, G1, it=None):
    import xgboost as xgb
    r = (0, it) if it else (0, 0)
    return 0.5 * (m.predict(xgb.DMatrix(G0), iteration_range=r) + 1 - m.predict(xgb.DMatrix(G1), iteration_range=r))


def _tree_cv_one(job):
    kind, cfg, mono, seed = job
    T, G0, G1, y = _G["T"], _G["G0"], _G["G1"], _G["y"]
    curves = {c: [0.0, 0] for c in CHECKS}
    per = []
    for y0, y1 in BLOCKS:
        tr, va = cv_masks(T, y0, y1)
        if kind == "lgb":
            m = lgb_train(cfg, G0[tr], G1[tr], y[tr], CHECKS[-1], seed, mono)
            preds = {c: lgb_predict(m, G0[va], G1[va], c) for c in CHECKS}
        else:
            m = xgb_train(cfg, G0[tr], G1[tr], y[tr], CHECKS[-1], seed, mono)
            preds = {c: xgb_predict(m, G0[va], G1[va], c) for c in CHECKS}
        for c in CHECKS:
            curves[c][0] += ll(preds[c], y[va]) * va.sum()
            curves[c][1] += va.sum()
    curve = {c: v[0] / v[1] for c, v in curves.items()}
    best = min(curve, key=curve.get)
    return {"kind": kind, "cfg": cfg, "mono": mono, "seed": seed, "rounds": best, "cv": round(curve[best], 5),
            "curve": {str(c): round(v, 5) for c, v in curve.items() if c % 100 == 0}}


def tune_trees(T, X, y, cols, args):
    G0, G1 = tree_mats(T, X, cols)
    _G.update(G0=G0, G1=G1)
    log("tree design: %d columns" % G0.shape[1])
    jobs = [("lgb", c, False, 1) for c in GBM_CFGS] + [("xgb", c, False, 1) for c in XGB_CFGS]
    if args.quick:
        jobs = jobs[:2] + jobs[len(GBM_CFGS):len(GBM_CFGS) + 1]
    res = run_jobs(_tree_cv_one, jobs, args.jobs)
    for r in res:
        log("  %s %s rounds %d CV %.5f" % (r["kind"], r["cfg"], r["rounds"], r["cv"]))
    out = {"search": res}
    for kind in ("lgb", "xgb"):
        rr = [r for r in res if r["kind"] == kind]
        b = min(rr, key=lambda r: r["cv"])
        # monotone constraints on the rating / Elo / market-rating differences, and a second seed
        mres = run_jobs(_tree_cv_one, [(kind, b["cfg"], True, 1), (kind, b["cfg"], False, 2)], args.jobs)
        log("  %s best + monotone: CV %.5f (rounds %d); other seed: %.5f" % (kind, mres[0]["cv"], mres[0]["rounds"],
                                                                              mres[1]["cv"]))
        pick = mres[0] if mres[0]["cv"] < b["cv"] - 0.0002 else b
        out[kind] = {"cfg": pick["cfg"], "mono": pick["mono"], "rounds": pick["rounds"], "cv": pick["cv"],
                     "cv_no_mono": b["cv"], "cv_mono": mres[0]["cv"], "cv_seed2": mres[1]["cv"]}
    return out


STAGES["cv"] = stage_cv


# ====================================================================== stage: fit (OOF, static, rolling)
LGB_SEEDS = [1, 2, 3, 4, 5]
XGB_SEEDS = [1, 2, 3]
LR_OOF_YEARS = list(range(2012, 2024))       # LR: annual expanding refits (feeds the method model too)
TREE_OOF_YEARS = list(range(2019, 2024))


def month_starts():
    out = []
    for y in (2024, 2025):
        for m in range(1, 13):
            out.append(dt.date(y, m, 1))
    return out


def windows():
    """(name, train_until (exclusive date), predict mask builder) for every refit."""
    W = []
    for Y in LR_OOF_YEARS:
        W.append(("oof%d" % Y, dt.date(Y, 1, 1), (dt.date(Y, 1, 1), dt.date(Y + 1, 1, 1)), "oof"))
    W.append(("static", dt.date(2024, 1, 1), (dt.date(2024, 1, 1), dt.date(2026, 1, 1)), "static"))
    ms = month_starts()
    for k, d in enumerate(ms):
        nxt = ms[k + 1] if k + 1 < len(ms) else dt.date(2026, 1, 1)
        W.append(("roll%s" % d.isoformat()[:7], d, (d, nxt), "roll"))
    return W


def train_mask(T, until, lrcfg):
    m = T["dec"].to_numpy() & (T["date"] < until).to_numpy()
    if lrcfg.get("train_set") == "both_exp":
        m &= T["both_exp"].to_numpy()
    if lrcfg.get("since"):
        m &= (T["year"] >= lrcfg["since"]).to_numpy()
    return m


def _fit_job(job):
    kind, seed, wname, until, (d0, d1) = job
    T, X, y, C = _G["T"], _G["X"], _G["y"], _G["C"]
    tr = train_mask(T, until, C["lr"])
    te = ((T["date"] >= d0) & (T["date"] < d1)).to_numpy()
    if te.sum() == 0:
        return (kind, seed, wname, np.array([], int), np.array([]), None)
    yrs = T["year"].to_numpy()
    ref = until.year if until.month == 1 else until.year + until.month / 12.0
    if kind in ("lr", "lr_base"):
        cols = C["lr"]["cols"] if kind == "lr" else _G["base_cols"]
        lam = C["lr"]["lam"] if kind == "lr" else C["base"]["lam"]
        rec = C["lr"].get("rec") if kind == "lr" else None
        Xc = X[cols].to_numpy(float)
        m = M.LRModel(lam, rec).fit(Xc[tr], y[tr], yrs[tr], ref)
        p = m.predict(Xc[te])
        return (kind, seed, wname, np.flatnonzero(te), p, m.coef)
    G0, G1 = _G["G0"], _G["G1"]
    tc = C["trees"][kind]
    if kind == "lgb":
        m = lgb_train(tc["cfg"], G0[tr], G1[tr], y[tr], tc["rounds"], seed, tc["mono"])
        p = lgb_predict(m, G0[te], G1[te])
    else:
        m = xgb_train(tc["cfg"], G0[tr], G1[tr], y[tr], tc["rounds"], seed, tc["mono"])
        p = xgb_predict(m, G0[te], G1[te])
    return (kind, seed, wname, np.flatnonzero(te), p, None)


def nonneg_blend(Z, y, lam=1e-3):
    return M.fit_lr(Z, y, lam, nonneg=True)


def stage_fit(args):
    S = load_table()
    T = S["df"]
    C = json.load(open(os.path.join(CACHE, "cv.json")))
    pm = C["pre_means"]
    X = superset_matrix(T, pm)
    y = T["y"].fillna(0.5).to_numpy(float)
    G0, G1 = tree_mats(T, X, C["lr"]["cols"])
    _G.update(T=T, X=X, y=y, C=C, G0=G0, G1=G1, base_cols=block_cols(X, [], None))
    jobs = []
    for wname, until, rng, kind_w in windows():
        jobs.append(("lr", 0, wname, until, rng))
        jobs.append(("lr_base", 0, wname, until, rng))
        if kind_w == "oof" and until.year not in TREE_OOF_YEARS:
            continue
        for sd in LGB_SEEDS:
            jobs.append(("lgb", sd, wname, until, rng))
        for sd in XGB_SEEDS:
            jobs.append(("xgb", sd, wname, until, rng))
    log("fit: %d jobs" % len(jobs))
    t0 = time.time()
    res = run_jobs(_fit_job, jobs, args.jobs)
    log("fit jobs done in %.0f s" % (time.time() - t0))
    n = len(T)
    P = {}
    coefs = {}
    for kind, seed, wname, idx, p, coef in res:
        scheme = "oof" if wname.startswith("oof") else ("static" if wname == "static" else "roll")
        key = (kind, scheme)
        if key not in P:
            P[key] = {}
        acc = P[key].setdefault(seed, np.full(n, np.nan))
        acc[idx] = p
        if coef is not None:
            coefs[(kind, wname)] = coef
    preds = {}
    for (kind, scheme), bys in P.items():
        arr = np.vstack(list(bys.values()))
        if kind in ("lgb", "xgb"):        # seed ensemble: average in logit space
            preds[(kind, scheme)] = sig(np.nanmean(logit(arr, 1e-6), axis=0))
        else:
            preds[(kind, scheme)] = arr[0]
        if kind in ("lgb", "xgb"):
            preds[(kind + "_seed1", scheme)] = arr[0]
    # blend weights on OOF 2019-2023 backtest rows (non-negative logit weights, no intercept)
    ev = T["evalrow"].to_numpy()
    yr = T["year"].to_numpy()
    oo = ev & (yr >= 2019) & (yr <= 2023)
    Z = np.c_[[logit(preds[(k, "oof")][oo], 1e-6) for k in ("lr", "lgb", "xgb")]].T
    w = nonneg_blend(Z, y[oo])
    log("blend weights lr/lgb/xgb on OOF 2019-2023: %s" % np.round(w, 3))
    # leave-one-year-out check of the blend inside 2019-2023
    loyo = []
    for Y in range(2019, 2024):
        a = oo & (yr != Y)
        b = oo & (yr == Y)
        Za = np.c_[[logit(preds[(k, "oof")][a], 1e-6) for k in ("lr", "lgb", "xgb")]].T
        Zb = np.c_[[logit(preds[(k, "oof")][b], 1e-6) for k in ("lr", "lgb", "xgb")]].T
        wy = nonneg_blend(Za, y[a])
        loyo.append(ll(sig(Zb @ wy), y[b]) * b.sum())
    blend_loyo = sum(loyo) / oo.sum()
    for scheme in ("oof", "static", "roll"):
        if (scheme == "oof"):
            Zs = np.c_[[logit(np.nan_to_num(preds[(k, scheme)], nan=0.5), 1e-6) for k in ("lr", "lgb", "xgb")]].T
        else:
            Zs = np.c_[[logit(preds[(k, scheme)], 1e-6) for k in ("lr", "lgb", "xgb")]].T
        b = sig(Zs @ w)
        if scheme == "oof":
            b[np.isnan(preds[("lgb", "oof")])] = np.nan
        preds[("blend", scheme)] = b
    F = {"preds": {"%s|%s" % k: v for k, v in preds.items()}, "blend_w": w.tolist(), "blend_loyo": blend_loyo,
         "coefs": {"%s|%s" % k: v for k, v in coefs.items()}, "fid": T["fid"].tolist()}
    pickle.dump(F, open(os.path.join(CACHE, "fit.pkl"), "wb"))
    quick_report(T, F)


def quick_report(T, F):
    ev = T["evalrow"].to_numpy()
    yr = T["year"].to_numpy()
    y = T["y"].to_numpy(float)
    oo = ev & (yr >= 2019) & (yr <= 2023)
    va = ev & (yr >= 2024) & (yr <= 2025)
    for k in ("lr_base|oof", "lr|oof", "lgb|oof", "xgb|oof", "blend|oof"):
        p = F["preds"][k]
        log("OOF 2019-23 %-12s %.5f" % (k, ll(p[oo], y[oo])))
    for k in sorted(F["preds"]):
        if k.endswith("static") or k.endswith("roll"):
            p = F["preds"][k]
            log("2024-25 %-18s %.5f  acc %.3f" % (k, ll(p[va], y[va]), metrics(p[va], y[va])["accuracy"]))


STAGES["fit"] = stage_fit


# ====================================================================== stage: stage2 (2019+-only sources on top)
def late_blocks(T, late):
    """Antisymmetric terms from the sources that exist only for 2019+ backtest fights. NaN where absent."""
    n = len(T)
    out = {}
    fids = T["fid"].tolist()
    du = np.full((n, 3), np.nan)
    oa = np.full((n, 14), np.nan)
    ml = np.full((n, 5), np.nan)
    ms = np.full((n, 2), np.nan)
    for i, f in enumerate(fids):
        e = late.get(f)
        if not e:
            continue
        if "du" in e:
            cA, pA, cB, pB, kA, kB = e["du"]
            du[i] = (cA - cB, pA - pB, kA - kB)
        if "oa" in e:
            oa[i] = np.array(e["oa"][0]) - np.array(e["oa"][1])
        if "mlr" in e:
            v = []
            for side in (0, 1):
                r = dict(zip(["d_att", "c_att", "g_att", "h_att", "b_att", "l_att", "td_att", "sub_att", "rev", "ctrl",
                              "acc_h", "acc_b", "acc_l", "acc_d", "acc_c", "acc_g", "td_acc", "kd_h"], e["mlr"][side]))
                land = r["h_att"] * r["acc_h"] + r["b_att"] * r["acc_b"] + r["l_att"] * r["acc_l"]
                v.append([math.log(land + 1e-3), math.log(r["h_att"] * r["acc_h"] * r["kd_h"] + 1e-4),
                          math.log(r["td_att"] * r["td_acc"] + 1e-3), math.log(r["ctrl"] + 1e-2),
                          math.log(r["sub_att"] + 1e-3)])
            ml[i] = np.array(v[0]) - np.array(v[1])
        if "mr_s" in e:
            pa, pb, pfin, pko, psub = e["mr_s"]
            ms[i] = (float(logit(pa / (pa + pb), 1e-4)), 0.0)
    out["du"] = pd.DataFrame(du, columns=["du_chin", "du_pow", "du_kdp"], index=T.index)
    out["oa"] = pd.DataFrame(oa, columns=["oa_" + k for k in ["dAtt", "dAttAg", "tdAtt", "tdAttAg", "tdAcc",
                             "tdAccAg", "ctrl", "octrl", "sub", "subAg", "pow", "chin", "acc", "accAg"]], index=T.index)
    out["mlr"] = pd.DataFrame(ml, columns=["mlr_land", "mlr_kd", "mlr_td", "mlr_ctrl", "mlr_sub"], index=T.index)
    out["mrs"] = pd.DataFrame(ms[:, :1], columns=["mrs_z"], index=T.index)
    return out


def resid_fit(z, Xe, y, lam, sw=None):
    """No-intercept logistic on [z, Xe] with L2 on the Xe coefficients only (standardised), z unpenalised."""
    from scipy.optimize import minimize
    Xs = Xe / (Xe.std(0) + 1e-9) if Xe.shape[1] else Xe
    s = Xe.std(0) + 1e-9 if Xe.shape[1] else np.ones(0)
    A = np.c_[z, Xs]
    sw = np.ones(len(y)) / len(y) if sw is None else sw / sw.sum()

    def f(w):
        q = A @ w
        p = sig(q)
        reg = 0.5 * lam * (w[1:] @ w[1:])
        g = A.T @ (sw * (p - y))
        g[1:] += lam * w[1:]
        return np.sum(sw * (np.logaddexp(0, q) - y * q)) + reg, g
    from scipy.optimize import minimize as _m
    r = _m(f, np.r_[1.0, np.zeros(A.shape[1] - 1)], jac=True, method="L-BFGS-B")
    return np.r_[r.x[0], r.x[1:] / s]


def stage_stage2(args):
    S = load_table()
    T = S["df"]
    F = pickle.load(open(os.path.join(CACHE, "fit.pkl"), "rb"))
    L = late_blocks(T, S["late"])
    ev = T["evalrow"].to_numpy()
    yr = T["year"].to_numpy()
    y = T["y"].to_numpy(float)
    z = {sch: logit(F["preds"]["blend|" + sch], 1e-6) for sch in ("oof", "static", "roll")}
    R = {}
    base_rows = ev & (yr >= 2019) & (yr <= 2023)
    combos = {"du": ["du"], "oa": ["oa"], "mlr": ["mlr"], "mrs": ["mrs"], "du+mlr": ["du", "mlr"],
              "all four": ["du", "oa", "mlr", "mrs"]}
    for name, bl in combos.items():
        Xe = pd.concat([L[b] for b in bl], axis=1)
        okc = Xe.notna().all(1).to_numpy()
        rows = base_rows & okc
        best = None
        for lam in (0.01, 0.03, 0.1, 0.3, 1.0, 3.0, 10.0):
            tot0 = tot1 = nn = 0.0
            for Y in (2021, 2022, 2023):
                tr = rows & (yr < Y)
                te = rows & (yr == Y)
                w0 = resid_fit(z["oof"][tr], np.zeros((tr.sum(), 0)), y[tr], lam)
                w1 = resid_fit(z["oof"][tr], Xe.to_numpy(float)[tr], y[tr], lam)
                p0 = sig(z["oof"][te] * w0[0])
                p1 = sig(np.c_[z["oof"][te], Xe.to_numpy(float)[te]] @ w1)
                tot0 += ll(p0, y[te]) * te.sum()
                tot1 += ll(p1, y[te]) * te.sum()
                nn += te.sum()
            r = {"lam": lam, "cv_ml2_only": round(tot0 / nn, 5), "cv_with": round(tot1 / nn, 5),
                 "gain": round((tot1 - tot0) / nn, 5), "n": int(nn)}
            if best is None or r["cv_with"] < best["cv_with"]:
                best = r
        # one look at 2024-25 (static: fit 2019-2023), reported whatever the CV says
        tr = rows
        vrows = ev & (yr >= 2024) & (yr <= 2025) & okc
        w1 = resid_fit(z["oof"][tr], Xe.to_numpy(float)[tr], y[tr], best["lam"])
        w0 = resid_fit(z["oof"][tr], np.zeros((tr.sum(), 0)), y[tr], best["lam"])
        p1 = sig(np.c_[z["static"][vrows], Xe.to_numpy(float)[vrows]] @ w1)
        p0 = sig(z["static"][vrows] * w0[0])
        cmpv = compare(p1, p0, y[vrows], T["event"].to_numpy()[vrows], 1000)
        best.update({"valid_static": cmpv, "coef": dict(zip(["z_ml2"] + list(Xe.columns), np.round(w1, 4).tolist())),
                     "adopt": best["gain"] < -SEL_MIN})
        R[name] = best
        log("stage2 %-9s CV gain %+.5f (lam %s) adopt=%s | 2024-25 %+.5f %s" % (name, best["gain"], best["lam"],
            best["adopt"], cmpv["diff"], cmpv["diff_ci"]))
    json.dump(R, open(os.path.join(CACHE, "stage2.json"), "w"), indent=1, default=float)


STAGES["stage2"] = stage_stage2


# ====================================================================== stage: stack
def expert_table(T, F):
    """Per backtest fight 2019-2025: every stack input as P(A wins), OOF for 2019-2023, static and rolling for
    2024-2025 where the expert has a rolling version."""
    ids = T["fid"].tolist()
    idx = {f: i for i, f in enumerate(ids)}
    mlj = dev_only(jload("ml.json")["fights"])
    mk = dev_only(jload("market.json")["fights"])
    eng = jload("moe_engine_bt.json")["fights"]
    E = pickle.load(open(os.path.join(ROOT, "out", "moe_cache", "experts.pkl"), "rb"))
    ev = T["evalrow"].to_numpy() & (T["year"] >= 2019).to_numpy() & (T["year"] <= 2025).to_numpy()
    rows = np.flatnonzero(ev)
    D = pd.DataFrame({"fid": [ids[i] for i in rows]})
    D["i"] = rows
    D["date"] = T["date"].to_numpy()[rows]
    D["year"] = T["year"].to_numpy()[rows]
    D["event"] = T["event"].to_numpy()[rows]
    D["y"] = T["y"].to_numpy()[rows]
    g = lambda d, k: [d.get(f, {}).get(k, np.nan) if d.get(f, {}).get(k) is not None else np.nan for f in D["fid"]]
    D["market"] = g(mk, "p_power_close")
    D["market_mult"] = g(mk, "p_novig_close")
    D["open"] = g(mk, "p_novig_open")
    D["mkt_rating"] = g(mk, "p_market_rating")
    D["ml"] = g(mlj, "lr")
    D["ml_roll"] = [mlj.get(f, {}).get("lr_refit", mlj.get(f, {}).get("lr")) for f in D["fid"]]
    D["ml_stack"] = g(mlj, "stack")
    D["elo_sig"] = g(mlj, "elo_sig")
    D["elo"] = g(mlj, "elo")
    D["engine"] = [(eng[f]["pA"] / (eng[f]["pA"] + eng[f]["pB"])) if f in eng else np.nan for f in D["fid"]]
    eidx = {f: k for k, f in enumerate(E["ids"])}
    fl_static = E["pred_static"]["feat_lr"]
    fl_roll = E["pred"]["feat_lr"]
    D["feat_lr"] = [fl_static[eidx[f]] if f in eidx else np.nan for f in D["fid"]]
    D["feat_lr_roll"] = [fl_roll[eidx[f]] if f in eidx else np.nan for f in D["fid"]]
    for sch in ("static", "roll"):            # 2019-2023 rows: OOF (annual refits) in both schemes
        D["ml2_" + sch] = F["preds"]["blend|oof"][rows]
        D["ml2lr_" + sch] = F["preds"]["lr|oof"][rows]
        va = (D["year"] >= 2024).to_numpy()
        D.loc[va, "ml2_" + sch] = F["preds"]["blend|" + sch][rows][va]
        D.loc[va, "ml2lr_" + sch] = F["preds"]["lr|" + sch][rows][va]
    D["nA"] = T["nA"].to_numpy()[rows]
    D["nB"] = T["nB"].to_numpy()[rows]
    D["division"] = T["division"].to_numpy()[rows]
    D["five"] = T["five"].to_numpy()[rows]
    D["women"] = T["women"].to_numpy()[rows]
    D["lbs"] = T["lbs"].to_numpy()[rows]
    return D


def stack_fit(Z, y, w=None):
    """Non-negative logit weights, no intercept (moe 'linear'); Z: n x k logits (0 where an expert is absent)."""
    from scipy.optimize import minimize
    n, k = Z.shape
    w = np.ones(n) if w is None else w
    w = w / w.sum()

    def f(b):
        q = Z @ b
        p = sig(q)
        return np.sum(w * (np.logaddexp(0, q) - y * q)) + 1e-4 * b @ b, Z.T @ (w * (p - y)) + 2e-4 * b
    r = minimize(f, np.full(k, 0.3), jac=True, method="L-BFGS-B", bounds=[(0, None)] * k)
    return r.x


def zmat(D, cols, pclip=0.01):
    return np.c_[[np.nan_to_num(logit(np.clip(D[c].to_numpy(float), pclip, 1 - pclip), 1e-6)) for c in cols]].T


def rec_w(years, ref, h):
    return np.ones(len(years)) if not h else 0.5 ** ((ref - np.asarray(years, float)) / h)


STACKS = {
    "line": {
        "current": ["market", "mkt_rating", "engine", "ml", "feat_lr", "elo_sig", "elo"],
        "current+ml2": ["market", "mkt_rating", "engine", "ml", "feat_lr", "elo_sig", "elo", "ml2"],
        "market+ml2": ["market", "ml2"],
        "market+ml2+mkt_rating+feat_lr": ["market", "ml2", "mkt_rating", "feat_lr"],
        "page: market+ml2lr": ["market", "ml2lr"],
    },
    "noline": {
        "current": ["mkt_rating", "engine", "ml", "feat_lr", "elo_sig", "elo"],
        "current+ml2": ["mkt_rating", "engine", "ml", "feat_lr", "elo_sig", "elo", "ml2"],
        "ml2 alone": ["ml2"],
        "ml2+mkt_rating+feat_lr": ["ml2", "mkt_rating", "feat_lr"],
        "page: ml2lr+mkt_rating": ["ml2lr", "mkt_rating"],
    },
}


def col_for(c, scheme):
    if c in ("ml2", "ml2lr"):
        return c + "_" + scheme
    if scheme == "roll" and c in ("ml", "feat_lr"):
        return c + "_roll"
    return c


def stack_predict(D, cols, scheme, h, fit_until_year, pred_mask, rows_ok):
    """Fit the stack on OOF/rolling-history rows with year <= fit_until_year, predict pred_mask."""
    cc = [col_for(c, scheme if scheme == "roll" else "static") for c in cols]
    tr = rows_ok & (D["year"] <= fit_until_year).to_numpy() & (D["year"] >= 2019).to_numpy()
    Z = zmat(D, cc)
    b = stack_fit(Z[tr], D["y"].to_numpy(float)[tr], rec_w(D["year"].to_numpy()[tr], fit_until_year + 1, h))
    return sig(Z[pred_mask] @ b), b


def stage_stack(args):
    S = load_table()
    T = S["df"]
    F = pickle.load(open(os.path.join(CACHE, "fit.pkl"), "rb"))
    D = expert_table(T, F)
    y = D["y"].to_numpy(float)
    yr = D["year"].to_numpy()
    has_line = D["market"].notna().to_numpy()
    R = {"cv": {}, "valid": {}, "weights": {}, "segments": {}}
    out_preds = {}
    for regime, sets in STACKS.items():
        rows_ok = has_line if regime == "line" else np.ones(len(D), bool)
        for name, cols in sets.items():
            # forward-chained CV inside 2019-2023 for the recency half-life
            cvs = {}
            for h in (None, 3.0, 1.5):
                tot = nn = 0.0
                for Y in (2021, 2022, 2023):
                    m = rows_ok & (yr == Y)
                    p, _ = stack_predict(D, cols, "static", h, Y - 1, m, rows_ok)
                    tot += ll(p, y[m]) * m.sum()
                    nn += m.sum()
                cvs[str(h)] = round(tot / nn, 5)
            hbest = min(cvs, key=lambda k: cvs[k] + (0 if k == "None" else SEL_MIN))
            h = None if hbest == "None" else float(hbest)
            va = rows_ok & (yr >= 2024) & (yr <= 2025)
            p_st, b = stack_predict(D, cols, "static", h, 2023, va, rows_ok)
            # rolling: experts' rolling predictions; stack refit each January (2025 from <= 2024)
            p_ro = np.full(len(D), np.nan)
            for Y in (2024, 2025):
                m = rows_ok & (yr == Y)
                pp, _ = stack_predict(D, cols, "roll", h, Y - 1, m, rows_ok)
                p_ro[m] = pp
            key = "%s|%s" % (regime, name)
            full_st = np.full(len(D), np.nan)
            full_st[va] = p_st
            out_preds[key + "|static"] = full_st
            out_preds[key + "|roll"] = p_ro
            R["cv"][key] = {"by_h": cvs, "chosen_h": h}
            R["weights"][key] = dict(zip(cols, np.round(b, 4).tolist()))
            R["valid"][key] = {"static": metrics(p_st, y[va]), "roll": metrics(p_ro[va], y[va])}
            log("%-6s %-32s CV %.5f (h %s) | 2024-25 static %.5f roll %.5f | w %s" % (
                regime, name, cvs[hbest], h, ll(p_st, y[va]), ll(p_ro[va], y[va]), np.round(b, 3)))
    # paired comparisons
    cmpd = {}
    va_all = (yr >= 2024) & (yr <= 2025)
    ev_grp = D["event"].to_numpy()
    for regime in ("line", "noline"):
        rows_ok = has_line if regime == "line" else np.ones(len(D), bool)
        va = rows_ok & va_all
        for sch in ("static", "roll"):
            new = out_preds["%s|current+ml2|%s" % (regime, sch)][va]
            cur = out_preds["%s|current|%s" % (regime, sch)][va]
            cmpd["%s|%s|current+ml2 vs current" % (regime, sch)] = compare(new, cur, y[va], ev_grp[va])
            mk = has_line & va_all
            if regime == "noline":
                vv = mk[va]
                cmpd["%s|%s|current+ml2 vs close" % (regime, sch)] = compare(new[vv], D["market"].to_numpy()[va][vv],
                                                                             y[va][vv], ev_grp[va][vv])
                cmpd["%s|%s|current vs close" % (regime, sch)] = compare(cur[vv], D["market"].to_numpy()[va][vv],
                                                                         y[va][vv], ev_grp[va][vv])
            else:
                cmpd["%s|%s|current+ml2 vs close" % (regime, sch)] = compare(new, D["market"].to_numpy()[va], y[va],
                                                                             ev_grp[va])
                cmpd["%s|%s|current vs close" % (regime, sch)] = compare(cur, D["market"].to_numpy()[va], y[va],
                                                                         ev_grp[va])
    for k, v in cmpd.items():
        log("%-42s a %.5f b %.5f diff %+.5f %s" % (k, v["a"], v["b"], v["diff"], v["diff_ci"]))
    R["paired"] = cmpd
    # segments (2024-2025, static and rolling): no-line and with-line stacks, current vs + ML v2, vs the close
    Tv = pd.DataFrame({"nA": D["nA"], "nB": D["nB"], "lbs": D["lbs"], "women": D["women"], "five": D["five"],
                       "division": D["division"]})
    close = D["market"].to_numpy(float)
    segs = segments_of(Tv, np.flatnonzero(va_all), np.nan_to_num(close[va_all], nan=0.5))
    SG = {}
    for name, m in segs.items():
        rows = np.flatnonzero(va_all)[m]
        rl = rows[has_line[rows]]
        if len(rl) < 25:
            continue
        r = {"n": int(len(rows)), "n_line": int(len(rl)), "close": round(ll(close[rl], y[rl]), 5)}
        for sch in ("static", "roll"):
            nl_new = out_preds["noline|current+ml2|" + sch]
            nl_cur = out_preds["noline|current|" + sch]
            ln_new = out_preds["line|current+ml2|" + sch]
            ln_cur = out_preds["line|current|" + sch]
            r[sch] = {"noline_current": round(ll(nl_cur[rows], y[rows]), 5),
                      "noline_ml2": round(ll(nl_new[rows], y[rows]), 5),
                      "noline_ml2_on_line_fights": round(ll(nl_new[rl], y[rl]), 5),
                      "line_current": round(ll(ln_cur[rl], y[rl]), 5), "line_ml2": round(ll(ln_new[rl], y[rl]), 5),
                      "noline ml2 - current": compare(nl_new[rows], nl_cur[rows], y[rows], ev_grp[rows], 1000),
                      "noline ml2 - close": compare(nl_new[rl], close[rl], y[rl], ev_grp[rl], 1000),
                      "line ml2 - current": compare(ln_new[rl], ln_cur[rl], y[rl], ev_grp[rl], 1000),
                      "line ml2 - close": compare(ln_new[rl], close[rl], y[rl], ev_grp[rl], 1000)}
        SG[name] = r
        q = r["static"]
        log("seg %-48s n %3d | noline cur %.4f ml2 %.4f (%+.4f) | close %.4f | line cur %.4f ml2 %.4f (%+.4f vs close)"
            % (name, r["n"], q["noline_current"], q["noline_ml2"], q["noline ml2 - current"]["diff"], r["close"],
               q["line_current"], q["line_ml2"], q["line ml2 - close"]["diff"]))
    R["segments"] = SG
    # by year, and the forward-chained CV years 2021-2023 for the recommended stacks (out of sample there too)
    BY = {}
    for Y in (2021, 2022, 2023):
        for regime in ("line", "noline"):
            rows_ok = has_line if regime == "line" else np.ones(len(D), bool)
            m = rows_ok & (yr == Y)
            for name in ("current", "current+ml2"):
                p, _ = stack_predict(D, STACKS[regime][name], "static", R["cv"]["%s|%s" % (regime, name)]["chosen_h"],
                                     Y - 1, m, rows_ok)
                BY.setdefault(str(Y), {})["%s|%s" % (regime, name)] = round(ll(p, y[m]), 5)
            mc = m & has_line
            BY[str(Y)]["close"] = round(ll(close[mc], y[mc]), 5)
    for Y in (2024, 2025):
        m = yr == Y
        BY[str(Y)] = {k + "|" + sch: round(ll(out_preds[k + "|" + sch][m & (has_line if k.startswith("line") else True)],
                                              y[m & (has_line if k.startswith("line") else True)]), 5)
                      for k in ("line|current", "line|current+ml2", "noline|current", "noline|current+ml2")
                      for sch in ("static", "roll")}
        BY[str(Y)]["close"] = round(ll(close[m & has_line], y[m & has_line]), 5)
    R["by_year"] = BY
    # pooled out-of-sample 2021-2025: forward-chained CV years (fit on 2019..Y-1) + 2024-2025 static (fit <= 2023)
    POOL = {}
    for regime in ("line", "noline"):
        rows_ok = has_line if regime == "line" else np.ones(len(D), bool)
        pp = {}
        for name in ("current", "current+ml2"):
            arr = np.full(len(D), np.nan)
            h = R["cv"]["%s|%s" % (regime, name)]["chosen_h"]
            for Y in (2021, 2022, 2023):
                m = rows_ok & (yr == Y)
                arr[m], _ = stack_predict(D, STACKS[regime][name], "static", h, Y - 1, m, rows_ok)
            v = rows_ok & va_all
            arr[v] = out_preds["%s|%s|static" % (regime, name)][v]
            pp[name] = arr
        m = rows_ok & (yr >= 2021) & (yr <= 2025) & has_line
        POOL[regime + " current+ml2 - current"] = compare(pp["current+ml2"][m], pp["current"][m], y[m], ev_grp[m])
        POOL[regime + " current+ml2 - close"] = compare(pp["current+ml2"][m], close[m], y[m], ev_grp[m])
        POOL[regime + " current - close"] = compare(pp["current"][m], close[m], y[m], ev_grp[m])
        mc = rows_ok & (yr >= 2021) & (yr <= 2023) & has_line
        POOL[regime + " CV years 2021-2023 current+ml2 - close"] = compare(pp["current+ml2"][mc], close[mc], y[mc], ev_grp[mc])
        POOL[regime + " CV years 2021-2023 current+ml2 - current"] = compare(pp["current+ml2"][mc], pp["current"][mc],
                                                                             y[mc], ev_grp[mc])
    for k, v in POOL.items():
        log("pooled %-50s n %d diff %+.5f %s" % (k, v["n"], v["diff"], v["diff_ci"]))
    R["pooled_2021_2025"] = POOL
    # production weights for the page (inputs the page can compute: the ML v2 logistic page model, the market
    # rating, the de-vigged line), refit on 2019-2025 (OOF 2019-2023 + monthly-rolling 2024-2025 predictions)
    PROD = {}
    for regime, name in (("line", "page: market+ml2lr"), ("noline", "page: ml2lr+mkt_rating")):
        rows_ok = has_line if regime == "line" else np.ones(len(D), bool)
        h = R["cv"]["%s|%s" % (regime, name)]["chosen_h"]
        cols = STACKS[regime][name]
        _, b = stack_predict(D, cols, "roll", h, 2025, np.zeros(len(D), bool), rows_ok)
        PROD[regime] = {"inputs": cols, "weights": np.round(b, 4).tolist(), "recency_half_life_years": h,
                        "fit": "2019-2025 (OOF 2019-2023, monthly-rolling 2024-2025), no intercept, non-negative",
                        "pclip": 0.01}
    R["page_stack"] = PROD
    log("page stack weights: %s" % PROD)
    log("by year: %s" % json.dumps(BY))
    pickle.dump({"D": D, "preds": out_preds}, open(os.path.join(CACHE, "stack.pkl"), "wb"))
    json.dump(R, open(os.path.join(CACHE, "stack.json"), "w"), indent=1, default=float)


STAGES["stack"] = stage_stack


# ====================================================================== stage: method (methodround model S refit)
METHOD_METRICS = ["joint", "method3", "bin7", "finish", "method_round", "winner", "method_given_winner", "ko_vs_sub"]


def method_new_cols(MT, T2, F, tau, pm):
    """New side-oriented columns for methodround's FX (X = A) and FY (X = B). The ML v2 logit is the LR's
    annual-refit OOF prediction for 2012-2023 rows and the static (<= 2023) prediction for 2024-2025."""
    pos = {f: i for i, f in enumerate(T2["fid"])}
    ii = np.array([pos.get(f, -1) for f in MT["id"]])
    have = ii >= 0
    j = np.where(have, ii, 0)
    yr = MT["year"].to_numpy()
    z_oof = logit(F["preds"]["lr|oof"], 1e-6)
    z_st = logit(F["preds"]["lr|static"], 1e-6)
    zb_oof = logit(np.nan_to_num(F["preds"]["blend|oof"], nan=0.5), 1e-6)
    zb_st = logit(F["preds"]["blend|static"], 1e-6)
    z = np.where(yr >= 2024, z_st[j], z_oof[j])
    zb = np.where(yr >= 2024, zb_st[j], zb_oof[j])
    ok = have & ~np.isnan(z) & (yr >= 2012)
    z = np.where(ok, z, 0.0)
    zb = np.where(ok & ~np.isnan(zb), zb, z)
    zw = np.where(have, logit(T2["r_whr_rounds"].to_numpy(float), 1e-3)[j], 0.0)
    zm = np.where(have, np.nan_to_num(logit(T2["mr_p"].to_numpy(float), 1e-3))[j], 0.0)

    def side(s):
        n = T2["n" + s[0]].to_numpy(float)[j]
        fade = T2[s + "pre_ok"].to_numpy(float)[j] * (np.exp(-n / tau) if tau else 1.0) * have
        out = {}
        for k in ("pre_ko", "pre_sub", "pre_kol", "pre_subl", "pre_fin", "pre_finl"):
            v = T2[s + k].to_numpy(float)[j]
            mu = np.nanmean(T2.loc[(T2["date"] < dt.date(2024, 1, 1)) & (T2[s + "pre_ok"] > 0), s + k])
            out[k] = np.nan_to_num(v - mu) * fade
        out["missed"] = np.nan_to_num(T2[s + "fw_missed"].to_numpy(float)[j]) * have
        return out
    A, Bs = side("A_"), side("B_")
    FXn = {"n_z": z, "n_az": np.abs(z), "n_zw": zw, "n_azw": np.abs(zw), "n_zm": zm, "n_azm": np.abs(zm)}
    FYn = {"n_z": -z, "n_az": np.abs(z), "n_zw": -zw, "n_azw": np.abs(zw), "n_zm": -zm, "n_azm": np.abs(zm)}
    for k in ("pre_ko", "pre_sub", "pre_fin"):
        FXn["x_" + k], FYn["x_" + k] = A[k], Bs[k]
        FXn["y_" + k], FYn["y_" + k] = Bs[k], A[k]
    for k in ("pre_kol", "pre_subl", "pre_finl"):
        FXn["y_" + k], FYn["y_" + k] = Bs[k], A[k]
        FXn["x_" + k], FYn["x_" + k] = A[k], Bs[k]
    FXn["x_missed"], FYn["x_missed"] = A["missed"], Bs["missed"]
    FXn["y_missed"], FYn["y_missed"] = Bs["missed"], A["missed"]
    pwin = sig(zb)
    return pd.DataFrame(FXn, index=MT.index), pd.DataFrame(FYn, index=MT.index), pwin, ok


def stage_method(args):
    import methodround as MR
    S = load_table()
    T2 = S["df"]
    F = pickle.load(open(os.path.join(CACHE, "fit.pkl"), "rb"))
    C = json.load(open(os.path.join(CACHE, "cv.json")))
    D = MR.prepare(False)
    T, FX, FY, y = D["T"], D["FX"], D["FY"], D["y"]
    assert T["date"].max() < VAULT
    chosen = jload("methodround.json")["meta"]["chosen"]
    draw_c = chosen["draw_c"]
    nX, nY, pwin, okz = method_new_cols(T, T2, F, C["lr"]["tau"], C["pre_means"])
    FX2 = pd.concat([FX, nX], axis=1)
    FY2 = pd.concat([FY, nY], axis=1)
    stat = D["stat_cols"]
    new = list(nX.columns)
    yrs = T["year"].to_numpy()
    vmask = np.isin(yrs, MR.VALID_YEARS)
    # hazard (round shapes) per fold, methodround's chosen penalty; reused by every variant
    H = np.zeros((len(T), MR.NC_))
    for v in list(MR.VALID_YEARS) + [2024]:
        tr = ((T["year"] < v) & (T["year"] >= MR.HAZ_START)).to_numpy()
        va = (T["year"] == v).to_numpy() if v < 2024 else (T["year"] >= 2024).to_numpy()
        hz = MR.HazardModel(MR.HAZ_COLS, C=chosen["C_haz"], C_dec=MR.C_DEC).fit(T[tr], FX[tr], FY[tr], y[tr])
        H[va] = hz.predict(T[va], FX[va], FY[va])
    log("method: hazard fits done")

    def run6(cols, C, start, fxx, fyy):
        P6 = np.full((len(T), 6), np.nan)
        for v in list(MR.VALID_YEARS) + [2024]:
            tr = ((T["year"] < v) & (T["year"] >= start)).to_numpy()
            va = (T["year"] == v).to_numpy() if v < 2024 else (T["year"] >= 2024).to_numpy()
            m = MR.C6Logit(cols, C=C, hl_years=MR.HL_YEARS).fit(T[tr], fxx[tr], fyy[tr], y[tr])
            P6[va] = m.predict6(T[va], fxx[va], fyy[va])
        return P6

    variants = {}
    variants["S"] = run6(stat, chosen["C6_S"], 2012, FX, FY)
    cvres = {}
    best = None
    for Cc in (0.001, 0.002, 0.004):
        P6 = run6(stat + new, Cc, 2012, FX2, FY2)
        Pj = MR.joint_from_c6(P6, H, draw_c)
        s_ = MR.summarize_losses(MR.losses_on(Pj[vmask], D, vmask))
        cvres[str(Cc)] = {k: round(v, 5) for k, v in s_.items()}
        log("  S2 C6=%g CV joint %.5f method3 %.5f bin7 %.5f" % (Cc, s_["joint"], s_["method3"], s_["bin7"]))
        if best is None or s_["joint"] < best[0]:
            best = (s_["joint"], Cc, P6)
    variants["S2"] = best[2]
    variants["S+ml2win"] = MR.reweight_winner(variants["S"], pwin)
    variants["S2+ml2win"] = MR.reweight_winner(variants["S2"], pwin)
    J = {k: MR.joint_from_c6(v, H, draw_c) for k, v in variants.items()}
    out = {"chosen_C6_S2": best[1], "cv_grid_S2": cvres, "cv": {}, "test": {}, "paired_cv": {}, "paired_test": {}}
    for k, P in J.items():
        out["cv"][k] = {m: round(v, 5) for m, v in MR.summarize_losses(MR.losses_on(P[vmask], D, vmask)).items()}
    test = (T["date"] >= dt.date(2024, 1, 1)).to_numpy() & (y >= 0)
    L = {k: MR.losses_on(P[test], D, test) for k, P in J.items()}
    Lcv = {k: MR.losses_on(P[vmask], D, vmask) for k, P in J.items()}
    bt, st = MR.cluster_bootstrap(L, T["event"].to_numpy()[test], B=2000)
    btc, stc = MR.cluster_bootstrap(Lcv, T["event"].to_numpy()[vmask], B=1000)
    out["test"] = bt
    for k in ("S2", "S+ml2win", "S2+ml2win"):
        out["paired_test"][k + " - S"] = MR.paired_diff(L[k], L["S"], st, METHOD_METRICS)
        out["paired_cv"][k + " - S"] = MR.paired_diff(Lcv[k], Lcv["S"], stc, METHOD_METRICS)
    # selection rule: the variant with the lowest CV joint loss (2020-2023), if better than S by > 0.0005
    cvj = {k: out["cv"][k]["joint"] for k in J}
    pick = min(cvj, key=cvj.get)
    out["chosen"] = pick if cvj[pick] < cvj["S"] - SEL_MIN else "S"
    out["n_test"] = int(test.sum())
    out["n_cv"] = int((vmask & (y >= 0)).sum())
    for k in J:
        log("  %-10s CV joint %.5f method3 %.5f bin7 %.5f | 2024-25 joint %.5f method3 %.5f bin7 %.5f winner %.5f"
            % (k, out["cv"][k]["joint"], out["cv"][k]["method3"], out["cv"][k]["bin7"], bt[k]["joint"]["mean"],
               bt[k]["method3"]["mean"], bt[k]["bin7"]["mean"], bt[k]["winner"]["mean"]))
    for k, v in out["paired_test"].items():
        log("  %s: %s" % (k, {m: (v[m]["diff"], v[m]["ci95"]) for m in ("joint", "method3", "bin7", "winner")}))
    log("  chosen by CV: %s" % out["chosen"])
    # against the market's method / round props (2024-25 fights with props) and tools/ml.py's 7-bin model
    PMK = D["PMK"]
    hm = test & ~np.isnan(PMK[:, 0])
    Lm = {"market_props": MR.losses_on(PMK[hm], D, hm), "S": MR.losses_on(J["S"][hm], D, hm),
          out["chosen"]: MR.losses_on(J[out["chosen"]][hm], D, hm)}
    btm, stm = MR.cluster_bootstrap(Lm, T["event"].to_numpy()[hm], B=2000)
    out["market_subset"] = {"n": int(hm.sum()), "means": btm,
                            "chosen - market_props": MR.paired_diff(Lm[out["chosen"]], Lm["market_props"], stm,
                                                                    METHOD_METRICS),
                            "S - market_props": MR.paired_diff(Lm["S"], Lm["market_props"], stm, METHOD_METRICS)}
    a_mk = jload("methodround.json")["meta"]["chosen"]["a_market"]
    Bm = (1 - a_mk) * J[out["chosen"]][hm] + a_mk * PMK[hm]
    Lb = MR.losses_on(Bm, D, hm)
    out["market_subset"]["blend(%.1f market) - market_props" % a_mk] = MR.paired_diff(Lb, Lm["market_props"], stm,
                                                                                     METHOD_METRICS)
    log("  market props subset n=%d: chosen-market %s; S-market %s" % (
        hm.sum(), {m: out["market_subset"]["chosen - market_props"][m]["diff"] for m in ("method3", "bin7")},
        {m: out["market_subset"]["S - market_props"][m]["diff"] for m in ("method3", "bin7")}))
    mlj = dev_only(jload("ml.json")["fights"])
    b7o = dict(zip(T2["fid"], T2["bin7"]))
    rows = [i for i in np.flatnonzero(test) if T["id"].iloc[i] in mlj and mlj[T["id"].iloc[i]].get("bins7")
            and b7o.get(T["id"].iloc[i]) is not None and b7o[T["id"].iloc[i]] >= 0]
    l_ml = np.array([-math.log(max(mlj[T["id"].iloc[i]]["bins7"][int(b7o[T["id"].iloc[i]])], 1e-9)) for i in rows])
    msk = np.zeros(len(T), bool)
    msk[rows] = True
    l_ch = MR.losses_on(J[out["chosen"]][msk], D, msk)["bin7"]
    bb = boot(T["event"].to_numpy()[msk], [l_ch, l_ml, l_ch - l_ml], 2000)
    out["vs_ml_v1_bins7"] = {"n": int(msk.sum()), "chosen": round(float(l_ch.mean()), 5), "ml_v1": round(float(l_ml.mean()), 5),
                             "diff": round(float((l_ch - l_ml).mean()), 5), "diff_ci": ci_of(bb[:, 2])}
    log("  7-bin vs tools/ml.py bins7: %s" % out["vs_ml_v1_bins7"])
    # per-fight 2024-25 cells of the chosen variant (A KO r1..R, ...) for the export
    out["_pred_test"] = {T["id"].iloc[i]: J[out["chosen"]][i].round(5).tolist() for i in np.flatnonzero(test)}
    json.dump(out, open(os.path.join(CACHE, "method.json"), "w"), default=float)


STAGES["method"] = stage_method


# ====================================================================== stage: export (report numbers, page model, JSON)
def segments_of(T, rows, close):
    nA, nB = T["nA"].to_numpy()[rows], T["nB"].to_numpy()[rows]
    nmin = np.minimum(nA, nB)
    lbs = T["lbs"].to_numpy()[rows]
    women = T["women"].to_numpy()[rows] > 0
    five = T["five"].to_numpy()[rows] > 0
    div = T["division"].to_numpy()[rows]
    fav = np.maximum(close, 1 - close)
    seg = {
        "newcomer bout (a side with 1-2 prior UFC fights)": nmin <= 2,
        "middle (fewer-fight side has 3-7)": (nmin >= 3) & (nmin <= 7),
        "veterans (both 8+)": nmin >= 8,
        "both newcomers (both 1-2)": np.maximum(nA, nB) <= 2,
        "men 125-145": ~women & (lbs <= 145),
        "men 155-185": ~women & (lbs >= 155) & (lbs <= 185),
        "men 205-265": ~women & (lbs >= 205),
        "women": women,
        "3 rounds": ~five,
        "5 rounds": five,
        "pick'em (close favourite < 60%)": fav < 0.6,
        "moderate favourite (60-75%)": (fav >= 0.6) & (fav < 0.75),
        "heavy favourite (75%+)": fav >= 0.75,
    }
    for d in ("Flyweight", "Bantamweight", "Featherweight", "Lightweight", "Welterweight", "Middleweight",
              "Light Heavyweight", "Heavyweight", "Women's Strawweight", "Women's Flyweight", "Women's Bantamweight"):
        m = div == d
        if m.sum() >= 40:
            seg["division: " + d] = m
    return seg


def calib_bins(p, y, edges=(0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.9, 1.0001)):
    """Favourite-side calibration (each fight counted once, from the favourite's side)."""
    q = np.where(p >= 0.5, p, 1 - p)
    o = np.where(p >= 0.5, y, 1 - y)
    out = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (q >= lo) & (q < hi)
        if m.sum():
            out.append({"lo": lo, "hi": round(min(hi, 1.0), 2), "n": int(m.sum()), "pred": round(float(q[m].mean()), 4),
                        "obs": round(float(o[m].mean()), 4)})
    return out


def stage_export(args):
    S = load_table()
    T = S["df"]
    C = json.load(open(os.path.join(CACHE, "cv.json")))
    F = pickle.load(open(os.path.join(CACHE, "fit.pkl"), "rb"))
    st2 = json.load(open(os.path.join(CACHE, "stage2.json"))) if os.path.exists(os.path.join(CACHE, "stage2.json")) else None
    SK = pickle.load(open(os.path.join(CACHE, "stack.pkl"), "rb")) if os.path.exists(os.path.join(CACHE, "stack.pkl")) else None
    SKJ = json.load(open(os.path.join(CACHE, "stack.json"))) if os.path.exists(os.path.join(CACHE, "stack.json")) else None
    MJ = json.load(open(os.path.join(CACHE, "method.json"))) if os.path.exists(os.path.join(CACHE, "method.json")) else None
    P = F["preds"]
    ev = T["evalrow"].to_numpy()
    yr = T["year"].to_numpy()
    y = T["y"].to_numpy(float)
    grp = T["event"].to_numpy()
    oo = ev & (yr >= 2019) & (yr <= 2023)
    va = ev & (yr >= 2024) & (yr <= 2025)
    mlj = dev_only(jload("ml.json")["fights"])
    mk = dev_only(jload("market.json")["fights"])
    fids = T["fid"].to_numpy()
    ext = {"ml_v1_lr": np.array([mlj.get(f, {}).get("lr", np.nan) for f in fids], float),
           "ml_v1_blend": np.array([mlj.get(f, {}).get("ml", np.nan) for f in fids], float),
           "ml_v1_stack": np.array([mlj.get(f, {}).get("stack", np.nan) for f in fids], float),
           "elo": np.array([mlj.get(f, {}).get("elo", np.nan) for f in fids], float),
           "close": np.array([mk.get(f, {}).get("p_power_close", np.nan) for f in fids], float),
           "open": np.array([mk.get(f, {}).get("p_novig_open", np.nan) for f in fids], float),
           "mkt_rating": np.array([mk.get(f, {}).get("p_market_rating", np.nan) for f in fids], float)}
    res = {"oof_2019_2023": {}, "valid_2024_2025": {"static": {}, "rolling": {}}, "paired": {}, "by_year": {},
           "calibration": {}, "segments": {}}
    for k in ("lr_base", "lr", "lgb", "xgb", "blend"):
        res["oof_2019_2023"]["ml2_" + k if k != "lr_base" else "ml_v1_lr_reproduced"] = metrics(P[k + "|oof"][oo], y[oo])
    res["oof_2019_2023"]["ml_v1_lr"] = metrics(ext["ml_v1_lr"][oo], y[oo])
    res["oof_2019_2023"]["elo"] = metrics(ext["elo"][oo], y[oo])
    for sch, key in (("static", "static"), ("rolling", "roll")):
        for k in ("lr_base", "lr", "lgb", "lgb_seed1", "xgb", "xgb_seed1", "blend"):
            nm = "ml2_" + k if k != "lr_base" else "ml_v1_lr_reproduced"
            p = P[k + "|" + key][va]
            m = metrics(p, y[va])
            b = boot(grp[va], [ll_vec(p, y[va])], 2000)
            m["log_loss_ci"] = ci_of(b[:, 0])
            res["valid_2024_2025"][sch][nm] = m
    for k in ("ml_v1_lr", "ml_v1_blend", "ml_v1_stack", "elo"):
        res["valid_2024_2025"]["static"][k] = metrics(ext[k][va], y[va])
    hc = va & ~np.isnan(ext["close"])
    ho = va & ~np.isnan(ext["open"]) & ~np.isnan(ext["close"])
    res["valid_2024_2025"]["static"]["close (fights with a line)"] = metrics(ext["close"][hc], y[hc])
    res["valid_2024_2025"]["static"]["open (fights with both lines)"] = metrics(ext["open"][ho], y[ho])
    # paired comparisons on 2024-2025
    for sch, key in (("static", "static"), ("rolling", "roll")):
        for k in ("lr", "blend"):
            p = P[k + "|" + key]
            res["paired"]["%s ml2_%s - ml_v1_lr" % (sch, k)] = compare(p[va], ext["ml_v1_lr"][va], y[va], grp[va])
            res["paired"]["%s ml2_%s - ml_v1_blend" % (sch, k)] = compare(p[va], ext["ml_v1_blend"][va], y[va], grp[va])
            res["paired"]["%s ml2_%s - ml_v1_stack(elo+ml+mkt_rating)" % (sch, k)] = compare(
                p[va & ~np.isnan(ext["ml_v1_stack"])], ext["ml_v1_stack"][va & ~np.isnan(ext["ml_v1_stack"])],
                y[va & ~np.isnan(ext["ml_v1_stack"])], grp[va & ~np.isnan(ext["ml_v1_stack"])])
            res["paired"]["%s ml2_%s - elo" % (sch, k)] = compare(p[va], ext["elo"][va], y[va], grp[va])
            res["paired"]["%s ml2_%s - close" % (sch, k)] = compare(p[hc], ext["close"][hc], y[hc], grp[hc])
            res["paired"]["%s ml2_%s - open" % (sch, k)] = compare(p[ho], ext["open"][ho], y[ho], grp[ho])
        res["paired"]["%s ml2_blend - ml2_lr" % sch] = compare(P["blend|" + key][va], P["lr|" + key][va], y[va], grp[va])
        res["paired"]["%s ml2_lgb(5 seeds) - ml2_lgb(1 seed)" % sch] = compare(P["lgb|" + key][va], P["lgb_seed1|" + key][va],
                                                                            y[va], grp[va])
    res["paired"]["rolling - static (ml2_blend)"] = compare(P["blend|roll"][va], P["blend|static"][va], y[va], grp[va])
    res["paired"]["rolling - static (ml2_lr)"] = compare(P["lr|roll"][va], P["lr|static"][va], y[va], grp[va])
    res["paired"]["ml_v1_lr_reproduced - ml_v1_lr (static)"] = compare(P["lr_base|static"][va], ext["ml_v1_lr"][va],
                                                                      y[va], grp[va], 500)
    res["paired"]["oof 2019-2023 ml2_blend - ml_v1_lr"] = compare(P["blend|oof"][oo], ext["ml_v1_lr"][oo], y[oo], grp[oo])
    res["paired"]["oof 2019-2023 ml2_lr - ml_v1_lr"] = compare(P["lr|oof"][oo], ext["ml_v1_lr"][oo], y[oo], grp[oo])
    # by year
    for Y in range(2019, 2026):
        m = ev & (yr == Y)
        sch = "oof" if Y < 2024 else "static"
        row = {"n": int(m.sum()), "ml_v1_lr": round(ll(ext["ml_v1_lr"][m], y[m]), 5),
               "ml2_lr": round(ll(P["lr|" + sch][m], y[m]), 5), "ml2_blend": round(ll(P["blend|" + sch][m], y[m]), 5),
               "elo": round(ll(ext["elo"][m], y[m]), 5),
               "ml2_blend_slope": round(M.calib_slope(P["blend|" + sch][m], y[m])[1], 3)}
        mc = m & ~np.isnan(ext["close"])
        row["close"] = round(ll(ext["close"][mc], y[mc]), 5)
        if Y >= 2024:
            row["ml2_blend_rolling"] = round(ll(P["blend|roll"][m], y[m]), 5)
        res["by_year"][str(Y)] = row
    for k, key in (("ml2_blend static", "blend|static"), ("ml2_blend rolling", "blend|roll"), ("ml2_lr static", "lr|static")):
        res["calibration"][k] = calib_bins(P[key][va], y[va])
    res["calibration"]["ml_v1_lr"] = calib_bins(ext["ml_v1_lr"][va], y[va])
    res["calibration"]["close"] = calib_bins(ext["close"][hc], y[hc])
    res["calibration"]["ml2_blend OOF 2019-2023"] = calib_bins(P["blend|oof"][oo], y[oo])
    # segments
    close_va = ext["close"]
    seg = segments_of(T, np.flatnonzero(va), np.nan_to_num(close_va[va], nan=0.5))
    for name, m in seg.items():
        rows = np.flatnonzero(va)[m]
        if len(rows) < 25:
            continue
        r = {"n": int(len(rows))}
        for k, pv in (("ml_v1_lr", ext["ml_v1_lr"]), ("ml2_lr", P["lr|static"]), ("ml2_blend", P["blend|static"]),
                      ("ml2_blend_rolling", P["blend|roll"]), ("elo", ext["elo"])):
            r[k] = round(ll(pv[rows], y[rows]), 5)
        rc = rows[~np.isnan(ext["close"][rows])]
        r["n_line"] = int(len(rc))
        r["close"] = round(ll(ext["close"][rc], y[rc]), 5)
        r["ml2_blend_on_line_fights"] = round(ll(P["blend|static"][rc], y[rc]), 5)
        r["ml2_blend - ml_v1_lr"] = compare(P["blend|static"][rows], ext["ml_v1_lr"][rows], y[rows], grp[rows], 1000)
        r["ml2_blend - close"] = compare(P["blend|static"][rc], ext["close"][rc], y[rc], grp[rc], 1000)
        res["segments"][name] = r
    # gap to the close in newcomer bouts, v1 vs v2
    out = {"meta": {}, "cv": C, "results": res, "stage2": st2, "stacks": SKJ, "method": None, "fights": {}}
    if MJ:
        out["method"] = {k: v for k, v in MJ.items() if not k.startswith("_")}
    # per-fight predictions (backtest fights 2019-2025)
    stackp = {}
    if SK:
        D = SK["D"]
        for key, arr in SK["preds"].items():
            stackp[key] = dict(zip(D["fid"], arr))
    for i in np.flatnonzero(ev & (yr >= 2019) & (yr <= 2025)):
        f = fids[i]
        sch = "oof" if yr[i] < 2024 else "static"
        e = {"set": "oof" if yr[i] < 2024 else "valid", "y": int(y[i]),
             "ml2": round(float(P["blend|" + sch][i]), 4), "ml2_lr": round(float(P["lr|" + sch][i]), 4),
             "ml2_lgb": round(float(P["lgb|" + sch][i]), 4), "ml2_xgb": round(float(P["xgb|" + sch][i]), 4),
             "mr": None if np.isnan(T["mr_p"].iloc[i]) else round(float(T["mr_p"].iloc[i]), 4)}
        if yr[i] >= 2024:
            e["ml2_roll"] = round(float(P["blend|roll"][i]), 4)
            e["p_rolling"] = e["ml2_roll"]            # name tools/blindtest_plugins/ml2.py looks for first
            e["ml2_lr_roll"] = round(float(P["lr|roll"][i]), 4)
            for key, dd in stackp.items():
                v = dd.get(f)
                if v is not None and not np.isnan(v) and ("current+ml2" in key):
                    e["stack_" + key.replace("|current+ml2|", "_")] = round(float(v), 4)
        out["fights"][f] = e
    out["page_model"] = page_model(T, C, F, args)
    out["meta"] = {
        "tool": "tools/ml2.py", "built": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "protocol": "every fight dated 2026-01-01 or later dropped right after parsing (build_db.parse_fights wrapped); "
                    "all choices by time-ordered CV on pre-2024 data (expanding window, validation blocks 2016-17, "
                    "2018-19, 2020-21, 2022-23; stacks forward-chained 2021-2023 from 2019); 2024-01-01..2025-12-31 "
                    "scored once. static = models fit on fights before 2024-01-01; rolling = refit on the first of "
                    "every month on all fights before it (stacks refit each January)",
        "sources": {"base": "tools/ml.py feature table (rebuilt here, 2010-2025)",
                    "ratings": "tools/ratings.py systems rerun with its tuned parameters over 2009-2025 "
                               "(check vs ratings.json: %s)" % {k: v["max_abs_diff"] for k, v in S["ratings_check"].items()},
                    "market_rating": "tools/market.py Kalman market rating rebuilt from 2013 (check vs market.json: %s)"
                                     % S["mr_check"],
                    "preufc": "data/derived/preufc.json strict snapshots (tools/preufc.side_pre), target rule applied "
                              "pre-fight",
                    "fightweek": "data/derived/fightweek.json",
                    "late (stage2)": "durability.json, oppadj.json, mlrates_oof.json, methodround.json (2019+ only)"},
        "orientation": "P(A wins | decisive), A = first ufcstats name; every model is corner-symmetric",
        "keys": {"fights": "per backtest fight id 2019-2025: set (oof = 2019-2023 annual refit, valid = 2024-2025), "
                           "y, ml2 (blend: LR + LightGBM + XGBoost), ml2_lr, ml2_lgb, ml2_xgb, mr (market rating), "
                           "ml2_roll / ml2_lr_roll (monthly rolling refit, valid only), stack_<regime>_<scheme> "
                           "(current+ml2 stacks, valid only)",
                 "page_model": "logistic ML v2 for any two roster fighters (src/ml/ml2.js)"}}
    json.dump(clean(out), open(OUT_JSON, "w"), separators=(",", ":"))
    log("wrote %s (%.0f kB)" % (OUT_JSON, os.path.getsize(OUT_JSON) / 1024))


def clean(o):
    if isinstance(o, dict):
        return {str(k): clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, (np.floating, float)):
        return None if (math.isnan(o) or math.isinf(o)) else float(o)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, np.ndarray):
        return clean(o.tolist())
    if isinstance(o, (np.bool_,)):
        return bool(o)
    return o


# ------------------------------------------------------------------ page model (logistic ML v2 for any matchup)
def rating_prob(kind, kap, ra, rb):
    """tools/ratings.py matchup_probs: P(a beats b) from current ratings {mu, sd}."""
    d = ra["mu"] - rb["mu"]
    if kind == "elo":
        return 1 / (1 + math.exp(-kap * d))
    if kind == "glicko2":
        g = 1.0 / math.sqrt(1.0 + 3.0 * (ra["sd"] ** 2 + rb["sd"] ** 2) / math.pi ** 2)
        return 1 / (1 + math.exp(-kap * g * d))
    if kind == "trueskill":
        return 0.5 * math.erfc(-(kap * d / math.sqrt(2.0 + ra["sd"] ** 2 + rb["sd"] ** 2)) / math.sqrt(2))
    vd = ra["sd"] ** 2 + rb["sd"] ** 2
    return 1 / (1 + math.exp(-kap * d / math.sqrt(1.0 + math.pi * kap * kap * vd / 8.0)))


def mr_prob(a, b, days_after_snapshot):
    g = max(days_after_snapshot, 0) / 365.25
    va = min(a[1] ** 2 + MR_PARAMS["tau"] ** 2 * g, 2 * MR_PARAMS["v0"])
    vb = min(b[1] ** 2 + MR_PARAMS["tau"] ** 2 * g, 2 * MR_PARAMS["v0"])
    return 1 / (1 + math.exp(-(a[0] - b[0]) / math.sqrt(1 + math.pi * (va + vb) / 8)))


def _lg(p, c):
    p = min(max(p, c), 1 - c)
    return math.log(p / (1 - p))


def page_eval(model, a, b, fight, probs=None):
    """Reference logit of the page model (mirror of src/ml/ml2.js). a, b: side dicts after M.page_sides plus
    'n', 'r' {sys: {mu, sd}}, 'mr' [mu, sd, last, n], 'pre' {key: value} (None when unavailable); fight:
    {date, lbs, ...; fw: {A: {...}, B: {...}} optional}. probs: precomputed {sys or 'mr': P(A)} (table checks)."""
    z = M.eval_terms([t for t in model["terms"] if t["type"] in ("logr", "logit", "lin", "hinge", "flag", "share",
                                                                "stance")], a, b)
    days = (dt.date.fromisoformat(fight["date"]) - dt.date.fromisoformat(model["snapshot"])).days
    nA, nB = a["n"], b["n"]
    g_new = 1.0 if min(nA, nB) <= 2 else 0.0
    cache = {}

    def zr(sys_, kind, kap):
        if probs is not None and sys_ in probs:
            return _lg(probs[sys_], 1e-3)
        ra, rb = (a.get("r") or {}).get(sys_), (b.get("r") or {}).get(sys_)
        if not ra or not rb:
            return 0.0
        return _lg(rating_prob(kind, kap, ra, rb), 1e-3)

    def zm():
        if probs is not None and "mr" in probs:
            return 0.0 if probs["mr"] is None else _lg(probs["mr"], 1e-3)
        if not a.get("mr") or not b.get("mr"):
            return 0.0
        return _lg(mr_prob(a["mr"], b["mr"], days), 1e-3)
    fw = fight.get("fw") or {}
    for t in model["terms"]:
        ty = t["type"]
        if ty == "rating":
            x = zr(t["sys"], t["kind"], t["kappa"])
        elif ty == "mr":
            x = zm()
        elif ty == "pre":
            def pv(s, n):
                if not s.get("pre"):
                    return 0.0
                v = s["pre"].get(t["key"])
                f = math.exp(-n / t["tau"]) if t["tau"] else 1.0
                return 0.0 if v is None else (v - t["mean"]) * f
            x = pv(a, nA) - pv(b, nB)
        elif ty == "fw":
            x = float((fw.get("A") or {}).get(t["key"], 0.0) or 0.0) - float((fw.get("B") or {}).get(t["key"], 0.0) or 0.0)
        elif ty == "nbucket":
            x = float(t["lo"] <= nA <= t["hi"]) - float(t["lo"] <= nB <= t["hi"])
        elif ty == "gate":
            inner = {"mr": zm, "whr": lambda: zr("whr_rounds", t.get("kind", "whr"), t.get("kappa", 1.0)),
                     "elo_judge": lambda: (a["elo_judge"] - b["elo_judge"]) * 0.01}[t["inner"]]()
            x = inner * g_new
        else:
            continue
        z += t["coef"] * x
    return z


def page_model(T, C, F, args):
    import preufc as PU
    lrc = C["lr"]
    cols = lrc["cols"]
    pm = C["pre_means"]
    X = superset_matrix(T, pm)
    y = T["y"].fillna(0.5).to_numpy(float)
    tr = train_mask(T, VAULT, lrc)
    mdl = M.LRModel(lrc["lam"], lrc.get("rec")).fit(X[cols].to_numpy(float)[tr], y[tr], T["year"].to_numpy()[tr],
                                                   2026)
    coef = dict(zip(cols, mdl.coef))
    RJ = jload("ratings.json")
    terms = []
    for t in BASE_SPECS:
        if t["name"] in coef:
            terms.append(dict(t, coef=float(coef[t["name"]])))
    for c in cols:
        if c in BASE_COLS:
            continue
        if c == "z_mr":
            t = {"name": c, "type": "mr"}
        elif c.startswith("z_"):
            sy = RJ["systems"][c[2:]]
            t = {"name": c, "type": "rating", "sys": c[2:], "kind": sy["kind"],
                 "kappa": float(sy["params"].get("kappa", 1.0))}
        elif c.startswith("d_pre_"):
            k = c[2:].split("@")[0]
            t = {"name": c, "type": "pre", "key": k, "mean": pm[k], "tau": lrc["tau"]}
        elif c.startswith("d_fw_"):
            t = {"name": c, "type": "fw", "key": c[2:]}
        elif c in ("d_n12", "d_n35"):
            t = {"name": c, "type": "nbucket", "lo": 1 if c == "d_n12" else 3, "hi": 2 if c == "d_n12" else 5}
        elif c.startswith("g_"):
            inner = {"g_mr_new": "mr", "g_whr_new": "whr", "g_elo_new": "elo_judge"}[c]
            t = {"name": c, "type": "gate", "inner": inner}
            if inner == "whr":
                t.update(kind="whr", kappa=float(RJ["systems"]["whr_rounds"]["params"].get("kappa", 1.0)))
        else:
            raise ValueError(c)
        t["coef"] = float(coef[c])
        terms.append(t)
    mlj = jload("ml.json")
    snap = mlj["page_model"]["snapshot"]
    model = {"snapshot": snap, "terms": terms, "mr_params": MR_PARAMS, "train": "every decisive UFC fight 2010-01-01.."
             "2025-12-31 (the same rows and settings the validation used, refit through 2025)",
             "n_train": int(tr.sum()), "lam": lrc["lam"]}
    # table self-check: page_eval on table rows (precomputed rating / market-rating probabilities) equals the
    # design-matrix logit
    sub = np.flatnonzero(T["evalrow"].to_numpy())[::23][:150]
    errs = []
    for i in sub:
        r = T.iloc[i]
        a = {k[2:]: (None if (isinstance(v, float) and math.isnan(v)) else v) for k, v in r.items() if k.startswith("A_")}
        b = {k[2:]: (None if (isinstance(v, float) and math.isnan(v)) else v) for k, v in r.items() if k.startswith("B_")}
        a["n"], b["n"] = r["nA"], r["nB"]
        for s_, d_ in (("A_", a), ("B_", b)):
            d_["pre"] = {k: r[s_ + k] for k in PRE_CORE} if r[s_ + "pre_ok"] > 0 else None
            if d_["pre"]:
                d_["pre"] = {k: (None if math.isnan(v) else v) for k, v in d_["pre"].items()}
        probs = {s_: r["r_" + s_] for s_ in RATING_SYSTEMS}
        probs["mr"] = None if math.isnan(r["mr_p"]) else r["mr_p"]
        fight = {"date": snap, "fw": {"A": {k[2:]: r[k] for k in r.index if k.startswith("A_fw_")},
                                      "B": {k[2:]: r[k] for k in r.index if k.startswith("B_fw_")}}}
        for s_ in ("A", "B"):
            fight["fw"][s_] = {k: (0.0 if (v is None or (isinstance(v, float) and math.isnan(v))) else v)
                               for k, v in fight["fw"][s_].items()}
        z1 = page_eval(model, a, b, fight, probs)
        z0 = float(X[cols].iloc[i].to_numpy(float) @ mdl.coef)
        errs.append(abs(z1 - z0))
    model["selfcheck_table_max_abs_logit_diff"] = float(max(errs))
    log("page model: %d terms; table self-check max |logit diff| %.2e" % (len(terms), max(errs)))
    # roster: base values from ml.json's roster (live through the snapshot), ratings.json, market.json,
    # preufc.json current snapshots
    need = sorted({t["key"] for t in terms if "key" in t and t["type"] in ("logr", "logit", "lin", "hinge", "flag")}
                  | {t[k] for t in terms if t["type"] == "share" for k in ("u", "v")}
                  | {"southpaw", "orthodox", "elo_judge", "n", "_dob", "_last_fight", "years_ufc", "_prev_lbs",
                     "_lbs_fought"} - set(M.DYNAMIC_KEYS) | {"years_ufc"})
    sys_needed = sorted({t["sys"] for t in terms if t["type"] == "rating"} |
                        ({"whr_rounds"} if any(t["type"] == "gate" and t["inner"] == "whr" for t in terms) else set()))
    mkr = jload("market.json")["ratings"]
    PJ = jload("preufc.json")["fighters"]
    base = build_base()
    slug2p = {v: k for k, v in base["people_slug"].items()}
    roster = {}
    for slug, fx in mlj["roster"].items():
        row = [fx.get(k) for k in need]
        rr = RJ["roster"].get(slug, {})
        rat = [[rr[s_]["mu"], rr[s_].get("sd", 0.0)] if rr.get(s_) and rr[s_].get("mu") is not None else None
               for s_ in sys_needed]
        kd = base["k_dates"].get(slug2p.get(slug), [])
        ok = (len(kd) < 4 or kd[3] >= dt.date(2015, 1, 1))
        cur = (PJ.get(slug) or {}).get("current")
        pre = None
        if ok and cur:
            v = PU.side_pre(cur, fx.get("n") or 0)
            pre = [None if (isinstance(v[k], float) and math.isnan(v[k])) else round(v[k], 6) for k in PRE_CORE]
        roster[slug] = {"v": row, "r": rat, "mr": mkr.get(slug), "pre": pre}
    model["keys"] = need
    model["rating_systems"] = sys_needed
    model["pre_keys"] = PRE_CORE
    model["roster"] = roster
    # test vectors: Python reference for random roster pairs (the Node test must match to 1e-9)
    rng = np.random.default_rng(5)
    slugs = sorted(roster)
    pairs = [("alexander-volkanovski", "justin-gaethje")] + [tuple(rng.choice(slugs, 2, replace=False))
                                                              for _ in range(39)]
    tv = []
    for k, (sa, sb) in enumerate(pairs):
        fight = {"date": "2026-12-12" if k % 2 == 0 else snap, "lbs": 155 if k == 0 else [125, 145, 170, 205][k % 4],
                 "five": 1 if k % 5 == 0 else 0}
        if k % 3 == 1:
            fight["fw"] = {"A": {"fw_home_intl": 1.0, "fw_missed": 1.0}, "B": {"fw_repl": 1.0, "fw_repl14": 1.0}}
        a = side_for_page(model, sa, fight)
        b = side_for_page(model, sb, fight)
        z = page_eval(model, a, b, fight)
        tv.append({"a": sa, "b": sb, "fight": fight, "logit": z, "pA": 1 / (1 + math.exp(-z))})
    model["test_vectors"] = tv
    vg = tv[0]
    log("page model: Volkanovski vs Gaethje (Dec 12, 2026, 155 lb, 5 rounds) P(Volk) = %.4f" % vg["pA"])
    return model


def side_for_page(model, slug, fight):
    R = model["roster"][slug]
    fx = {k: v for k, v in zip(model["keys"], R["v"])}
    v = M.page_sides(fx, fight["date"], fight.get("lbs"), model["snapshot"])
    v["n"] = fx.get("n") or 0
    v["r"] = {s_: ({"mu": x[0], "sd": x[1]} if x else None) for s_, x in zip(model["rating_systems"], R["r"])}
    v["mr"] = R["mr"]
    v["pre"] = {k: x for k, x in zip(model["pre_keys"], R["pre"])} if R["pre"] else None
    return v


STAGES["export"] = stage_export


# ====================================================================== stage: verify (truncation tests of the new features)
def stage_verify(args):
    """Truncation and flipped-result tests of the rebuilt rating features. Each system is run twice in the same
    process (same inputs): the full stream to 2025-12-31 and the stream cut at CUT; every prediction for a fight
    before CUT must be identical. A third run reverses every result on/after CUT: earlier predictions must not
    move. Also reports how far the cached features are from a rebuild with the current preufc.json (the ratings'
    newcomer prior reads it), so a later preufc.json rebuild is visible."""
    import ratings as RT
    S = load_table()
    T = S["df"]
    cut = dt.date(2024, 6, 1)
    out = {"cut": cut.isoformat()}
    D = RT.load_data()
    RT.prepare(D, log=lambda s: None)
    J = jload("ratings.json")
    ev_all = np.where(D.day >= dt.date(2009, 1, 1).toordinal())[0]
    early = ev_all[D.day[ev_all] < cut.toordinal()]
    late = ev_all[D.day[ev_all] >= cut.toordinal()]
    cached = pickle.load(open(os.path.join(CACHE, "ratings_all.pkl"), "rb"))
    cidx = {f: i for i, f in enumerate(cached["fid"])}
    Df = RT.load_data()
    RT.prepare(Df, log=lambda s: None)
    flip = (Df.day >= cut.toordinal()) & Df.obs
    Df.y = np.where(flip, 1 - Df.y, Df.y)
    Df.winner = [{"A": "B", "B": "A"}.get(w, w) if f else w for w, f in zip(Df.winner, flip)]
    for name in ("whr_rounds", "glicko2", "elo_full", "trueskill_mov"):
        Sy = J["systems"][name]
        pf, _, _ = RT.run_system(D, Sy["kind"], Sy["params"], until=VAULT.toordinal(), record=False, eval_idx=ev_all)
        pt, _, _ = RT.run_system(D, Sy["kind"], Sy["params"], until=cut.toordinal(), record=False, eval_idx=early)
        px, _, _ = RT.run_system(Df, Sy["kind"], Sy["params"], until=VAULT.toordinal(), record=False, eval_idx=ev_all)
        pc = cached["p"][name][[cidx[D.fid[i]] for i in ev_all]]
        out[name] = {"n_before_cut": int(len(early)),
                     "truncation_max_abs_diff": float(np.nanmax(np.abs(pt[early] - pf[early]))),
                     "flip_after_cut_max_abs_diff_before": float(np.nanmax(np.abs(px[early] - pf[early]))),
                     "flip_after_cut_share_changed_after": float(np.mean(np.abs(px[late] - pf[late]) > 1e-9)),
                     "cached_vs_current_preufc_max_abs_diff": float(np.nanmax(np.abs(pf[ev_all] - pc)))}
        log("verify %s: %s" % (name, out[name]))
    sub = T[T["date"] < cut].copy()
    mr_cut, _, _ = build_market_rating(sub)
    mr_full = T.set_index("fid")["mr_p"]
    d = [abs(v[0] - mr_full[f]) for f, v in mr_cut.items() if f in mr_full.index and not np.isnan(mr_full[f])]
    out["market_rating"] = {"n": len(d), "truncation_max_abs_diff": float(max(d))}
    log("verify market rating: %s" % out["market_rating"])
    json.dump(out, open(os.path.join(CACHE, "verify.json"), "w"), indent=1)


STAGES["verify"] = stage_verify


# ====================================================================== main


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("stage", choices=["table", "cv", "fit", "stage2", "stack", "method", "verify", "export", "all"])
    ap.add_argument("--jobs", type=int, default=2)
    ap.add_argument("--quick", action="store_true")
    args = ap.parse_args()
    order = (["table", "cv", "fit", "stage2", "stack", "method", "verify", "export"] if args.stage == "all"
             else [args.stage])
    for st in order:
        t0 = time.time()
        log("== stage %s" % st)
        (stage_table if st == "table" else STAGES[st])(args)
        log("== stage %s done in %.0f s" % (st, time.time() - t0))


if __name__ == "__main__":
    main()
