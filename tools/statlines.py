#!/usr/bin/env python3
"""statlines: distributional per-fight stat-line models (task key: statlines).

For each fighter in a matchup: the predictive DISTRIBUTION (not only the mean) of his significant strikes attempted and
landed (total, head / body / leg, distance / clinch / ground), takedowns attempted and landed, knockdowns, submission
attempts, reversals and control time, (1) given that the fight lasts t minutes and (2) unconditionally, mixed over a
fight-length distribution (methodround model S cells + a pre-2019 within-round finish-time table).

Model (per stat, chosen by time-ordered CV on data before 2024):
  mean  log mu = log(base rate x t) + corrections, where the base rate is the verified mlrates stat-line model blended
        with the fighter embeddings (research/model_mlrates.md, research/model_embed.md; the blend refit inside every
        fold) and the corrections are t-terms (log t, finished, finished x log t, five rounds) [nb_t], plus a ridge GLM on
        page-computable matchup features [nb_glm], or a LightGBM correction on everything [nb_gbm];
  shape negative binomial with log k = linear in (log t, finished, log base mean, five rounds) [NB2 heads], optionally
        zero-inflated (logit pi) for sparse stats; control time also as a zero-inflated Beta on the share of fight time.

Hidden-data protocol (docs/BACKLOG.md; docs/V6_V10_PLAN.md 5-6):
  - every fight dated 2026-01-01 or later is dropped at load (the inputs were parsed with 2026 dropped; asserted here);
  - rows are mlrates' out-of-fold fight-sides: 2019-2023 time-ordered folds (trained 2010..year-1), 2024-2025 the dev
    model (trained 2010-2023); every second-stage fit for year Y uses rows from 2019..Y-1 only;
  - CV years 2021, 2022, 2023 (expanding window from 2019); every choice (candidate per stat, ridge, zero-inflation,
    the winner-expert variant, whether it enters a stack) is made on them;
  - 2024-01-01..2025-12-31 is scored ONCE by `final` (fits on 2019-2023), reported, never selected on;
  - corner symmetry: no corner input anywhere (each row is "attacker X vs defender Y"); the swap test is asserted;
  - CIs: event-cluster bootstrap (2,000 resamples of event dates), paired for differences.

Run from the project root (nice it; the box is shared):
    nice -n 5 python3 tools/statlines.py build      # assemble the row table (about 30 s)
    nice -n 5 python3 tools/statlines.py cv         # candidates x folds 2021-2023, selection (writes cv.json)
    nice -n 5 python3 tools/statlines.py actuals    # actual lines of the backtest fights (input of the engine run)
    nice -n 5 node tools/statlines_engine.js --actuals out/statlines_cache/actuals.json --out out/statlines_cache/engine_v4.json
    nice -n 5 python3 tools/statlines.py cvfit      # CV-year evaluation (conditional, unconditional, engine) + winner OOF
    nice -n 5 python3 tools/statlines.py gate       # stat-line winner expert: forward-chained stack gate (2021-2023)
    nice -n 5 python3 tools/statlines.py prereg     # freeze the choices before the look
    nice -n 5 python3 tools/statlines.py final      # the ONE look at 2024-2025 + exports (statlines.json, statlines_oof.json)
    nice -n 5 python3 tools/statlines.py fixtures   # JS parity fixtures for tests/test_statdist.js
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

import numpy as np
from scipy.optimize import minimize
from scipy.special import betainc, betaln, digamma, expit, gammaln

warnings.filterwarnings("ignore")
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
if HERE not in sys.path:
    sys.path.insert(0, HERE)
DER = os.path.join(ROOT, "data", "derived")
CACHE = os.environ.get("STATLINES_CACHE", os.path.join(ROOT, "out", "statlines_cache"))
MLR_CACHE = os.path.join(ROOT, "out", "mlrates_cache", "dataset.pkl")
VAULT_FROM = "2026-01-01"
CV_YEARS = (2021, 2022, 2023)
FIRST_YEAR = 2019
VALID = ("2024-01-01", "2025-12-31")
TOOL_VERSION = "statlines 1.0 (2026-11-06)"
SEED = 20261106

STATS = ["sig_att", "sig_lnd", "h_att", "h_lnd", "b_att", "b_lnd", "l_att", "l_lnd", "d_att", "d_lnd", "c_att", "c_lnd",
         "g_att", "g_lnd", "kd", "td_att", "td_lnd", "ctrl", "sub_att", "rev"]
SI = {s: i for i, s in enumerate(STATS)}
LABEL = {"sig_att": "sig. strikes attempted", "sig_lnd": "sig. strikes landed", "h_att": "head attempted",
         "h_lnd": "head landed", "b_att": "body attempted", "b_lnd": "body landed", "l_att": "leg attempted",
         "l_lnd": "leg landed", "d_att": "distance attempted", "d_lnd": "distance landed", "c_att": "clinch attempted",
         "c_lnd": "clinch landed", "g_att": "ground attempted", "g_lnd": "ground landed", "kd": "knockdowns",
         "td_att": "takedowns attempted", "td_lnd": "takedowns landed", "ctrl": "control seconds",
         "sub_att": "submission attempts", "rev": "reversals"}
SPARSE = {"kd", "td_att", "td_lnd", "sub_att", "rev", "g_att", "g_lnd", "c_att", "c_lnd"}
# mlrates targets (order of mlrates_oof.json meta.targets)
MLT = ["d_att", "c_att", "g_att", "h_att", "b_att", "l_att", "td_att", "sub_att", "rev", "ctrl", "acc_h", "acc_b",
       "acc_l", "acc_d", "acc_c", "acc_g", "td_acc", "kd_h"]
MI = {t: i for i, t in enumerate(MLT)}
# embedding task for each mlrates target, and whether the exported (CV-selected) recipe keeps the embedding term
EMB_TASK = {"d_att": "d_att", "c_att": "c_att", "g_att": "g_att", "h_att": "h_att", "b_att": "b_att", "l_att": "l_att",
            "td_att": "td_att", "sub_att": "sub_att", "rev": "rev", "ctrl": "ctrl", "acc_h": "h_acc", "acc_b": "b_acc",
            "acc_l": "l_acc", "acc_d": "d_acc", "acc_c": "c_acc", "acc_g": "g_acc", "td_acc": "td_acc", "kd_h": "kd"}
OPP_KEYS = ["dAtt", "dAttAg", "cAtt", "cAttAg", "gAtt", "gAttAg", "tdAtt", "tdAttAg", "tdAcc", "tdAccAg", "ctrl", "octrl",
            "topSkill", "escWeak", "sub", "subAg", "pow", "chin", "acc0", "acc1", "acc2", "accAg0", "accAg1", "accAg2"]
# page-computable GLM features: (own|opp, base stat) log per-minute base rates, plus a few oppadj logs
GLM_OPPADJ = ["dAtt", "cAtt", "gAtt", "tdAtt", "ctrl", "dAttAg", "cAttAg", "gAttAg", "tdAttAg", "octrl"]
# hand-set dominance weights for the winner expert (engine v1-v3 judging defaults, CLAUDE.md; not fit to any 2019+ data):
# head 1, body 0.8, leg 0.55 per landed strike (distance/clinch); ground landed 0.85 replaces its target weight; KD 12;
# takedown 3; control 0.06 per second; submission attempt 7
DOM_W = {"h_lnd": 1.0, "b_lnd": 0.8, "l_lnd": 0.55, "kd": 12.0, "td_lnd": 3.0, "ctrl": 0.06, "sub_att": 7.0}


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def sha_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for b in iter(lambda: fh.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()[:16]


def jload(name):
    return json.load(open(os.path.join(DER, name)))


def r5(x):
    return None if x is None or not np.isfinite(x) else float(round(float(x), 5))


# ====================================================================== build: the row table
def stage_build(args):
    os.makedirs(CACHE, exist_ok=True)
    t0 = time.time()
    ds = pickle.load(open(MLR_CACHE, "rb"))
    rows = [r for r in ds["rows"] if r["date"] < VAULT_FROM]
    assert len(rows) == len(ds["rows"]), "mlrates dataset holds a 2026 fight"
    M = ds["M"]
    import build_db as B
    KI = B.KI
    rowpos = {r["id"]: i for i, r in enumerate(ds["rows"])}
    oof = jload("mlrates_oof.json")
    assert oof["meta"]["targets"] == MLT
    oofF = {k: v for k, v in oof["fights"].items() if v["date"] < VAULT_FROM}
    emb = jload("embed.json")
    divs = emb["model"]["divs"]
    didx = {d: i for i, d in enumerate(divs)}
    tasks = [t["name"] for t in emb["meta"]["tasks"]]
    TI = {t: i for i, t in enumerate(tasks)}
    Q = emb["quarters"]
    QC = [np.array(q["C"]) for q in Q]
    QW = [np.array(q["W"]) for q in Q]
    QV = [np.array(q["V"]) for q in Q]
    snaps = emb["snapshots"]
    opp = jload("oppadj.json")["snapshots"]
    mr = jload("methodround.json")["fights"]
    bt = {f["id"]: f for f in jload("backtest_dev.json")["fights"] if f["date"] < VAULT_FROM}
    recipe = jload("embed_model.json")["mlrates_blend"]["targets"]
    keep_emb = {t: abs(recipe[t]["b"][2]) > 0 for t in MLT}
    era0 = dt.date(2015, 1, 1).toordinal()
    K = QW[0].shape[1]

    def eta_of(ex, ey, q, dv, era, five):
        z = np.zeros(QC[q].shape[1])
        z[0] = 1.0
        z[1 + dv] = 1.0
        z[-2] = era
        z[-1] = five
        return QC[q] @ z + QW[q] @ ex[:K] + QV[q] @ ey[K:]

    def opp_vec(o):
        if not o:
            return np.zeros(len(OPP_KEYS))
        v = []
        for k in OPP_KEYS:
            if k.startswith("accAg"):
                x = o["accAg"][int(k[-1])]
            elif k.startswith("acc"):
                x = o["acc"][int(k[-1])]
            else:
                x = o.get(k, 1.0)
            v.append(math.log(max(float(x), 1e-3)))
        return np.array(v)

    R = {k: [] for k in ("fid", "date", "year", "side", "rounds", "t", "fin", "both_prior", "has_emb", "division",
                         "Y", "ML", "MLo", "ETA", "ETAo", "EMB", "EMBo", "WINL", "OPP", "OPPo", "XF", "nX", "nY",
                         "method", "winner")}
    cells, n_q_bad = {}, 0
    for fid in sorted(oofF, key=lambda k: (oofF[k]["date"], k)):
        v = oofF[fid]
        ri = rowpos.get(fid)
        if ri is None:
            continue
        r = ds["rows"][ri]
        assert r["date"] == v["date"] and r["date"] < VAULT_FROM
        sn = snaps.get(fid)
        o = opp.get(fid)
        t = float(r["minutes"])
        Rr = int(r["rounds"]) if r["rounds"] in (3, 5) else 3
        fin = 1.0 if t < 5 * Rr - 1.0 / 60 else 0.0
        if fid in mr and mr[fid]["date"] < VAULT_FROM and mr[fid].get("S"):
            assert mr[fid]["fit_through"] < r["date"]
            cells[fid] = {"R": len(mr[fid]["S"]) and (len(mr[fid]["S"]) - 3) // 4, "S": mr[fid]["S"]}
        eta = [None, None]
        if sn:
            q = int(sn["q"])
            if not Q[q]["T"] <= r["date"]:      # a refit dated T uses rows strictly before T
                n_q_bad += 1
            dv = didx.get(r["division"], didx.get(r["prior_division"], didx["Lightweight"]))
            era = (dt.date.fromisoformat(r["date"]).toordinal() - era0) / 3652.5
            five = 1.0 if r["rounds"] == 5 else 0.0
            ea, eb = np.array(sn["A"]), np.array(sn["B"])
            eta = [eta_of(ea, eb, q, dv, era, five), eta_of(eb, ea, q, dv, era, five)]
        for s in (0, 1):
            vv = r["v"][s]
            y = []
            for st in STATS:
                if st == "sig_att":
                    y.append(vv[KI["h_att"]] + vv[KI["b_att"]] + vv[KI["l_att"]])
                elif st == "sig_lnd":
                    y.append(vv[KI["h_lnd"]] + vv[KI["b_lnd"]] + vv[KI["l_lnd"]])
                else:
                    y.append(vv[KI[st]])
            R["fid"].append(fid)
            R["date"].append(r["date"])
            R["year"].append(r["year"])
            R["side"].append(s)
            R["rounds"].append(Rr)
            R["t"].append(t)
            R["fin"].append(fin)
            R["both_prior"].append(bool(r["sides"][0]["n"] > 0 and r["sides"][1]["n"] > 0))
            R["has_emb"].append(sn is not None)
            R["division"].append(r["division"])
            R["Y"].append(y)
            R["ML"].append(v["A" if s == 0 else "B"])
            R["MLo"].append(v["B" if s == 0 else "A"])
            R["ETA"].append(eta[s] if sn else np.full(len(tasks), np.nan))
            R["ETAo"].append(eta[1 - s] if sn else np.full(len(tasks), np.nan))
            tagX, tagY = ("A", "B") if s == 0 else ("B", "A")
            R["EMB"].append(np.array(sn[tagX]) if sn else np.zeros(2 * K))
            R["EMBo"].append(np.array(sn[tagY]) if sn else np.zeros(2 * K))
            R["WINL"].append((sn["win_logit"] if s == 0 else -sn["win_logit"]) if sn else 0.0)
            R["OPP"].append(opp_vec(o[tagX]) if o else np.zeros(len(OPP_KEYS)))
            R["OPPo"].append(opp_vec(o[tagY]) if o else np.zeros(len(OPP_KEYS)))
            mi = 2 * ri + s
            assert M["row"][mi] == ri and M["side"][mi] == s
            R["XF"].append(M["X"][mi])
            R["nX"].append(r["sides"][s]["n"])
            R["nY"].append(r["sides"][1 - s]["n"])
            R["method"].append(r["method"])
            R["winner"].append(r["winner"])
    T = {}
    for k, v in R.items():
        T[k] = np.array(v) if k not in ("fid", "date", "division", "method", "winner") else np.array(v, dtype=object)
    T["Y"] = T["Y"].astype(float)
    T["ML"] = T["ML"].astype(float)
    T["MLo"] = T["MLo"].astype(float)
    T["cells"] = cells
    T["tasks"] = tasks
    T["TI"] = TI
    T["keep_emb"] = keep_emb
    T["fnames"] = ds["fnames"]
    T["inputs"] = {"mlrates_dataset": sha_file(MLR_CACHE), "mlrates_oof.json": sha_file(os.path.join(DER, "mlrates_oof.json")),
                   "embed.json": sha_file(os.path.join(DER, "embed.json")), "oppadj.json": sha_file(os.path.join(DER, "oppadj.json")),
                   "methodround.json": sha_file(os.path.join(DER, "methodround.json")),
                   "embed_model.json": sha_file(os.path.join(DER, "embed_model.json"))}
    T["finish_time"] = finish_time_table(ds["rows"])
    T["bt_ids"] = set(bt)
    # one cluster key per card: debut rows (not in the backtest set) take the event name of the backtest fights on their
    # date (one event per date in 2019-2025); the original build keyed them by the date string, which split 268 of 295
    # cards into two clusters in the all-rows tables (verifier fix; CI widths change by about 10% or less, no conclusion changes;
    # research/model_statlines.md, Verification log)
    ev_of_date = {f["date"]: f["event"] for f in bt.values()}
    T["event"] = np.array([bt[f]["event"] if f in bt else ev_of_date.get(d, d) for f, d in zip(T["fid"], T["date"])],
                          dtype=object)
    assert max(T["date"]) < VAULT_FROM and n_q_bad == 0
    pickle.dump(T, open(os.path.join(CACHE, "table.pkl"), "wb"), protocol=4)
    n = len(T["fid"])
    log("table: %d fight-sides (%d fights) %s..%s, both-prior %d, with embedding %d, S cells %d fights; quarter-order "
        "violations %d (%.1fs)" % (n, n // 2, min(T["date"]), max(T["date"]), int(T["both_prior"].sum()),
                                     int(T["has_emb"].sum()), len(cells), n_q_bad, time.time() - t0))


def finish_time_table(rows):
    """Within-round finish-time shares (10 bins of 30 s) by method (KO incl. doctor/corner, SUB) and round (1, later),
    from finishes dated 2010-01-01..2018-12-31 only (fixed table; no evaluation year contributes)."""
    tab = {}
    for m in ("KO", "SUB"):
        for g in ("r1", "rN"):
            tab[m + "|" + g] = np.full(10, 1.0)        # one pseudo-count per bin
    for r in rows:
        if not ("2010-01-01" <= r["date"] < "2019-01-01"):
            continue
        meth = r["method"]
        if meth not in ("KO", "SUB", "DOC") or not r.get("time_s"):
            continue
        m = "SUB" if meth == "SUB" else "KO"
        b = min(9, max(0, int((float(r["time_s"]) - 1e-6) // 30)))
        tab[m + "|" + ("r1" if r["rnd"] == 1 else "rN")][b] += 1
    return {k: (v / v.sum()).tolist() for k, v in tab.items()}


def load_table():
    return pickle.load(open(os.path.join(CACHE, "table.pkl"), "rb"))


# ====================================================================== GLM helpers (embedding blend refit per fold)
def _irls(Z, y, e, kind, iters=40, ridge=1e-6):
    """Poisson (log link, exposure e) or binomial (logit link, trials e) GLM by Newton; returns coefficients."""
    b = np.zeros(Z.shape[1])
    if kind == "pois":
        b[0] = math.log(max(y.sum(), 1e-9) / max(e.sum(), 1e-9))
    for _ in range(iters):
        eta = Z @ b
        if kind == "pois":
            mu = e * np.exp(np.clip(eta, -30, 30))
            g = Z.T @ (y - mu) - ridge * b
            H = (Z * mu[:, None]).T @ Z + ridge * np.eye(len(b))
        else:
            p = expit(eta)
            g = Z.T @ (y - e * p) - ridge * b
            H = (Z * (e * p * (1 - p))[:, None]).T @ Z + ridge * np.eye(len(b))
        step = np.linalg.solve(H, g)
        b = b + step
        if np.max(np.abs(step)) < 1e-9:
            break
    return b


def _link_ml(t, x):
    if t == "ctrl":
        return np.log(np.maximum(x / 60.0, 1e-6))
    if t == "kd_h":
        return np.log(np.clip(x, 1e-6, 1 - 1e-6))
    if t.startswith("acc") or t == "td_acc":
        p = np.clip(x, 1e-6, 1 - 1e-6)
        return np.log(p / (1 - p))
    return np.log(np.maximum(x, 1e-9))


def blend_fit(T, tr):
    """Refit the mlrates + embedding blend on rows tr: per mlrates target, link(rate) = b0 + b1 link(ml) [+ b2 eta]
    (b2 only where the exported recipe keeps it), plus a no-embedding recalibration (b0, b1) for rows without a
    snapshot. Returns {target: {"emb": b or None, "noemb": b}}."""
    Y, E = T["Y"], T["t"]
    out = {}
    for t in MLT:
        ml = _link_ml(t, T["ML"][:, MI[t]])
        if t in ("acc_h", "acc_b", "acc_l", "acc_d", "acc_c", "acc_g", "td_acc"):
            num = {"acc_h": "h_lnd", "acc_b": "b_lnd", "acc_l": "l_lnd", "acc_d": "d_lnd", "acc_c": "c_lnd",
                   "acc_g": "g_lnd", "td_acc": "td_lnd"}[t]
            y, e, kind = Y[:, SI[num]], Y[:, SI[num.replace("lnd", "att")]], "binom"
        elif t == "kd_h":
            y, e, kind = Y[:, SI["kd"]], Y[:, SI["h_lnd"]], "pois"
        else:
            y, e, kind = Y[:, SI[t]], E.copy(), "pois"
            if t == "ctrl":
                y = y / 60.0           # control minutes per minute: Poisson-type fit on minutes
        ok = tr & (e > 0)
        one = np.ones(len(y))
        Z1 = np.c_[one, ml]
        b1 = _irls(Z1[ok], y[ok], e[ok], kind)
        b2 = None
        if T["keep_emb"][t]:
            eta = T["ETA"][:, T["TI"][EMB_TASK[t]]]
            okk = ok & T["has_emb"]
            Z2 = np.c_[one, ml, np.nan_to_num(eta)]
            b2 = _irls(Z2[okk], y[okk], e[okk], kind)
        out[t] = {"emb": b2, "noemb": b1}
    return out


def blend_apply(T, B, opp=False):
    """Blended per-minute rates / probabilities (n x 18) for the attacker (opp=False) or the opponent (opp=True)."""
    ML = T["MLo"] if opp else T["ML"]
    ETA = T["ETAo"] if opp else T["ETA"]
    out = np.zeros_like(ML)
    for t in MLT:
        ml = _link_ml(t, ML[:, MI[t]])
        b = B[t]
        z = b["noemb"][0] + b["noemb"][1] * ml
        if b["emb"] is not None:
            eta = ETA[:, T["TI"][EMB_TASK[t]]]
            z2 = b["emb"][0] + b["emb"][1] * ml + b["emb"][2] * np.nan_to_num(eta)
            z = np.where(T["has_emb"], z2, z)
        if t in ("acc_h", "acc_b", "acc_l", "acc_d", "acc_c", "acc_g", "td_acc"):
            out[:, MI[t]] = expit(z)
        elif t == "kd_h":
            out[:, MI[t]] = np.minimum(np.exp(z), 0.5)
        elif t == "ctrl":
            out[:, MI[t]] = 60.0 * np.exp(z)
        else:
            out[:, MI[t]] = np.exp(z)
    return out


def base_rates(RT):
    """Per-minute base rates of the 20 stats from blended mlrates targets (n x 18) -> n x 20."""
    g = lambda t: RT[:, MI[t]]
    out = np.zeros((RT.shape[0], len(STATS)))
    h, b, l = g("h_att"), g("b_att"), g("l_att")
    hl, bl, ll_ = h * g("acc_h"), b * g("acc_b"), l * g("acc_l")
    out[:, SI["sig_att"]] = h + b + l
    out[:, SI["sig_lnd"]] = hl + bl + ll_
    out[:, SI["h_att"]], out[:, SI["h_lnd"]] = h, hl
    out[:, SI["b_att"]], out[:, SI["b_lnd"]] = b, bl
    out[:, SI["l_att"]], out[:, SI["l_lnd"]] = l, ll_
    for p in ("d", "c", "g"):
        out[:, SI[p + "_att"]] = g(p + "_att")
        out[:, SI[p + "_lnd"]] = g(p + "_att") * g("acc_" + p)
    out[:, SI["kd"]] = hl * g("kd_h")
    out[:, SI["td_att"]] = g("td_att")
    out[:, SI["td_lnd"]] = g("td_att") * g("td_acc")
    out[:, SI["ctrl"]] = g("ctrl")
    out[:, SI["sub_att"]] = g("sub_att")
    out[:, SI["rev"]] = g("rev")
    return np.maximum(out, 1e-6)


# ====================================================================== distributions
def nb_logpmf(y, mu, k):
    mu = np.maximum(mu, 1e-10)
    return gammaln(y + k) - gammaln(k) - gammaln(y + 1) + k * np.log(k / (k + mu)) + y * np.log(mu / (k + mu))


def pois_logpmf(y, mu):
    mu = np.maximum(mu, 1e-10)
    return y * np.log(mu) - mu - gammaln(y + 1)


def nb_cdf(j, mu, k):
    """P(Y <= j) for NB(mu, k); j, mu, k broadcastable; j < 0 -> 0."""
    j = np.asarray(j, float)
    p = k / (k + np.maximum(mu, 1e-12))
    out = betainc(k, np.maximum(j, 0) + 1.0, p)
    return np.where(j < 0, 0.0, out)


class Dist:
    """A predictive distribution per row: kind 'nb' (mu, k), 'zinb' (mu, k, pi), 'pois' (mu), 'zibeta' (pi, m, phi,
    cap = 60 t seconds; control time)."""
    def __init__(self, kind, **p):
        self.kind = kind
        self.p = {k: np.asarray(v, float) for k, v in p.items()}

    def mean(self):
        p = self.p
        if self.kind in ("nb", "pois"):
            return p["mu"]
        if self.kind == "zinb":
            return (1 - p["pi"]) * p["mu"]
        return (1 - p["pi"]) * p["m"] * p["cap"]

    def var(self):
        p = self.p
        if self.kind == "pois":
            return p["mu"]
        if self.kind == "nb":
            return p["mu"] + p["mu"] ** 2 / p["k"]
        if self.kind == "zinb":
            m, v = p["mu"], p["mu"] + p["mu"] ** 2 / p["k"]
            return (1 - p["pi"]) * (v + m * m) - ((1 - p["pi"]) * m) ** 2
        m, phi, c = p["m"], p["phi"], p["cap"]
        ex, ex2 = m, m * (m * phi + 1) / (phi + 1)
        return c * c * ((1 - p["pi"]) * ex2 - ((1 - p["pi"]) * ex) ** 2)

    def logpmf(self, y):
        p = self.p
        if self.kind == "pois":
            return pois_logpmf(y, p["mu"])
        if self.kind == "nb":
            return nb_logpmf(y, p["mu"], p["k"])
        if self.kind == "zinb":
            f = nb_logpmf(y, p["mu"], p["k"])
            return np.where(y == 0, np.log(p["pi"] + (1 - p["pi"]) * np.exp(f)), np.log1p(-p["pi"]) + f)
        return zibeta_logmass(y, p["pi"], p["m"], p["phi"], p["cap"])

    def cdf_grid(self, J):
        """P(Y <= j) for j = 0..J (rows x (J + 1)); NB / Poisson by the cumulative log-pmf recurrence (fast)."""
        p = self.p
        j = np.arange(J)[None, :]
        if self.kind in ("nb", "zinb", "pois"):
            mu = np.maximum(p["mu"], 1e-12)[:, None]
            if self.kind == "pois":
                lp0 = -mu
                term = np.log(mu) - np.log(j + 1.0)
            else:
                k = p["k"][:, None]
                lp0 = k * (np.log(k) - np.log(k + mu))
                term = np.log(j + k) - np.log(j + 1.0) + (np.log(mu) - np.log(k + mu))
            lpmf = np.concatenate([lp0, lp0 + np.cumsum(term, 1)], 1)
            F = np.minimum(np.cumsum(np.exp(lpmf), 1), 1.0)
            if self.kind == "zinb":
                F = p["pi"][:, None] + (1 - p["pi"][:, None]) * F
            return F
        return self.cdf(np.arange(J + 1)[None, :].repeat(len(p["pi"]), 0))

    def cdf(self, j):
        """P(Y <= j) (rows x grid when j is 2-D)."""
        p = {k: (v[:, None] if np.ndim(j) == 2 else v) for k, v in self.p.items()}
        if self.kind == "pois":
            from scipy.stats import poisson
            return np.where(np.asarray(j) < 0, 0.0, poisson.cdf(j, p["mu"]))
        if self.kind == "nb":
            return nb_cdf(j, p["mu"], p["k"])
        if self.kind == "zinb":
            return np.where(np.asarray(j) < 0, 0.0, p["pi"] + (1 - p["pi"]) * nb_cdf(j, p["mu"], p["k"]))
        return zibeta_cdf(j, p["pi"], p["m"], p["phi"], p["cap"])


def zibeta_logmass(y, pi, m, phi, cap):
    """Log probability mass of control seconds y on a 1-second grid: P(0) = pi; y > 0 -> (1 - pi) Beta density of the
    share s = y / cap times the bin width 1 / cap (s kept inside half a second of the ends)."""
    s = np.clip(y / cap, 0.5 / cap, 1 - 0.5 / cap)
    a, b = m * phi, (1 - m) * phi
    lb = (a - 1) * np.log(s) + (b - 1) * np.log1p(-s) - betaln(a, b) - np.log(cap)
    return np.where(y <= 0, np.log(pi), np.log1p(-pi) + lb)


def zibeta_cdf(j, pi, m, phi, cap):
    j = np.asarray(j, float)
    s = np.clip((j + 0.5) / cap, 0.0, 1.0)
    out = pi + (1 - pi) * betainc(m * phi, (1 - m) * phi, s)
    return np.where(j < 0, 0.0, np.where(j + 0.5 >= cap, 1.0, out))


def grid_max(st, dist):
    """Upper end of the count grid for CRPS / PIT tables: far beyond the 99.99% point."""
    mu = dist.mean()
    sd = np.sqrt(np.maximum(dist.var(), 1e-9))
    if st == "ctrl":
        return int(min(1500, np.max(dist.p["cap"]) + 2)) if dist.kind == "zibeta" else int(np.max(mu + 12 * sd) + 10)
    return int(np.max(mu + 14 * sd) + 10)


def score_rows(st, y, dist, rng, chunk=400):
    """Per-row log score (log pmf), CRPS (sum over the integer grid), randomized PIT, naive 10-90% band hit."""
    n = len(y)
    lp = dist.logpmf(y)
    J = grid_max(st, dist)
    crps = np.zeros(n)
    pit = np.zeros(n)
    band = np.zeros(n)
    v = rng.random(n)
    for a in range(0, n, chunk):
        b = min(n, a + chunk)
        sub = Dist(dist.kind, **{k: x[a:b] for k, x in dist.p.items()})
        g = np.arange(J + 1)[None, :].repeat(b - a, 0)
        F = sub.cdf_grid(J)
        yy = y[a:b]
        ind = (g >= yy[:, None]).astype(float)
        crps[a:b] = ((F - ind) ** 2).sum(1)
        Fy = np.take_along_axis(F, np.clip(yy.astype(int), 0, J)[:, None], 1)[:, 0]
        Fm = np.where(yy >= 1, np.take_along_axis(F, np.clip(yy.astype(int) - 1, 0, J)[:, None], 1)[:, 0], 0.0)
        if st == "ctrl" and dist.kind != "zibeta":
            pass
        pit[a:b] = Fm + v[a:b] * (Fy - Fm)
        q10 = (F >= 0.1).argmax(1)
        q90 = (F >= 0.9).argmax(1)
        band[a:b] = (yy >= q10) & (yy <= q90)
    return {"lp": lp, "crps": crps, "pit": np.clip(pit, 0, 1), "band": band}


def pois_dev(y, mu):
    mu = np.maximum(mu, 1e-10)
    return 2 * (np.where(y > 0, y * np.log(np.maximum(y, 1e-300) / mu), 0.0) - (y - mu))


# ====================================================================== the second-stage models
def t_terms(t, R):
    lt = np.log(np.maximum(t, 0.05))
    fin = (t < 5 * R - 1.0 / 60).astype(float)
    return np.c_[np.ones(len(t)), lt, fin, fin * lt, (R == 5).astype(float)], fin, lt


def k_terms(t, R, lmu, rich):
    lt = np.log(np.maximum(t, 0.05))
    fin = (t < 5 * R - 1.0 / 60).astype(float)
    if not rich:
        return np.c_[np.ones(len(t)), lt, fin]
    return np.c_[np.ones(len(t)), lt, fin, np.clip(lmu, -8, 8), (R == 5).astype(float)]


def fit_nb(y, off, Xm, Xk, lam_m=None, Xp=None, w=None, init=None, maxiter=400):
    """NB2 (optionally zero-inflated) regression by L-BFGS: log mu = off + Xm b; log k = Xk g; logit pi = Xp d.
    lam_m: per-column ridge on b (0 = free). Returns (b, g, d)."""
    n = len(y)
    w = np.ones(n) if w is None else w
    pm, pk = Xm.shape[1], Xk.shape[1]
    pp = 0 if Xp is None else Xp.shape[1]
    lam = np.zeros(pm) if lam_m is None else np.asarray(lam_m, float)
    W = w.sum()

    def unpack(th):
        return th[:pm], th[pm:pm + pk], th[pm + pk:]

    def f(th):
        b, g, d = unpack(th)
        eta = np.clip(off + Xm @ b, -20, 20)
        mu = np.exp(eta)
        lk = np.clip(Xk @ g, -6, 9)
        k = np.exp(lk)
        r = k + mu
        lf = gammaln(y + k) - gammaln(k) - gammaln(y + 1) + k * (lk - np.log(r)) + y * (eta - np.log(r))
        dmu = (y - mu) * k / r                                   # d lf / d eta
        dk = k * (digamma(y + k) - digamma(k) + lk - np.log(r) + 1 - (k + y) / r)   # d lf / d log k
        if pp:
            pi = expit(Xp @ d)
            z = y == 0
            f0 = np.exp(lf)
            L0 = pi + (1 - pi) * f0
            ll = np.where(z, np.log(np.maximum(L0, 1e-300)), np.log1p(-pi) + lf)
            dmu = np.where(z, (1 - pi) * f0 * dmu / np.maximum(L0, 1e-300), dmu)
            dk = np.where(z, (1 - pi) * f0 * dk / np.maximum(L0, 1e-300), dk)
            dpi_eta = np.where(z, (1 - f0) * pi * (1 - pi) / np.maximum(L0, 1e-300), -pi)
            gd = -(Xp.T @ (w * dpi_eta)) / W
        else:
            ll = lf
            gd = np.zeros(0)
        val = -(w * ll).sum() / W + 0.5 * (lam * b * b).sum() / W
        gb = -(Xm.T @ (w * dmu)) / W + lam * b / W
        gg = -(Xk.T @ (w * dk)) / W
        return val, np.concatenate([gb, gg, gd])

    th0 = np.zeros(pm + pk + pp) if init is None else init.copy()
    if init is None:
        th0[pm] = 1.0
        if pp:
            th0[pm + pk] = -3.0
    r = minimize(f, th0, jac=True, method="L-BFGS-B", options={"maxiter": maxiter})
    return unpack(r.x)


def fit_zibeta(y, cap, off_m, Xm, Xphi, Xp, lam_m=None, lam_p=None, maxiter=400):
    """Zero-inflated Beta on the share s = y / cap (control time): logit pi = Xp d; logit m = off_m + Xm b;
    log phi = Xphi g; ridge lam_m on b and lam_p on d (per column). Returns (b, g, d)."""
    s = np.clip(y / cap, 0.5 / cap, 1 - 0.5 / cap)
    z = y <= 0
    ls, l1s = np.log(s), np.log1p(-s)
    pm, pg, pp = Xm.shape[1], Xphi.shape[1], Xp.shape[1]
    lam = np.zeros(pm) if lam_m is None else np.asarray(lam_m, float)
    lpp = np.zeros(pp) if lam_p is None else np.asarray(lam_p, float)
    n = len(y)

    def f(th):
        b, g, d = th[:pm], th[pm:pm + pg], th[pm + pg:]
        m = expit(np.clip(off_m + Xm @ b, -15, 15))
        phi = np.exp(np.clip(Xphi @ g, -4, 8))
        pi = expit(Xp @ d)
        a, bb = m * phi, (1 - m) * phi
        lb = (a - 1) * ls + (bb - 1) * l1s - betaln(a, bb)
        ll = np.where(z, np.log(pi), np.log1p(-pi) + lb)
        da = ls - digamma(a) + digamma(phi)
        db = l1s - digamma(bb) + digamma(phi)
        dm_eta = phi * (da - db) * m * (1 - m)
        dphi = phi * (m * da + (1 - m) * db)
        dpi = np.where(z, 1 - pi, -pi)
        nz = (~z).astype(float)
        val = -ll.sum() / n + 0.5 * (lam * b * b).sum() / n + 0.5 * (lpp * d * d).sum() / n
        gb = -(Xm.T @ (nz * dm_eta)) / n + lam * b / n
        gg = -(Xphi.T @ (nz * dphi)) / n
        gd = -(Xp.T @ dpi) / n + lpp * d / n
        return val, np.concatenate([gb, gg, gd])

    th0 = np.zeros(pm + pg + pp)
    th0[pm] = 1.5
    r = minimize(f, th0, jac=True, method="L-BFGS-B", options={"maxiter": maxiter})
    return r.x[:pm], r.x[pm:pm + pg], r.x[pm + pg:]


def std_fit(X):
    mu = X.mean(0)
    sd = X.std(0)
    sd[sd < 1e-9] = 1.0
    return mu, sd


class Fold:
    """Everything one fold needs: training mask, the refit blend, base rates (own and opponent), GLM feature matrix."""
    def __init__(self, T, tr):
        self.tr = tr
        self.B = blend_fit(T, tr)
        self.RT = blend_apply(T, self.B)
        self.RTo = blend_apply(T, self.B, opp=True)
        self.BR = base_rates(self.RT)          # per-minute base rate of each stat (attacker)
        self.BRo = base_rates(self.RTo)        # the opponent's
        self.G = glm_raw(T, self.BR, self.BRo)
        self.Gmu, self.Gsd = std_fit(self.G[tr])


GLM_NAMES = (["own_" + s for s in ("sig_att", "sig_lnd", "td_att", "ctrl", "sub_att", "kd")]
             + ["opp_" + s for s in ("sig_att", "sig_lnd", "td_att", "ctrl", "sub_att", "kd")]
             + ["win_logit", "has_emb"] + ["oppadj_" + k for k in GLM_OPPADJ] + ["oppadjo_" + k for k in GLM_OPPADJ])


def glm_raw(T, BR, BRo):
    cols = [np.log(BR[:, SI[s]]) for s in ("sig_att", "sig_lnd", "td_att", "ctrl", "sub_att", "kd")]
    cols += [np.log(BRo[:, SI[s]]) for s in ("sig_att", "sig_lnd", "td_att", "ctrl", "sub_att", "kd")]
    cols += [T["WINL"], T["has_emb"].astype(float)]
    oi = [OPP_KEYS.index(k) for k in GLM_OPPADJ]
    return np.c_[np.array(cols).T, T["OPP"][:, oi], T["OPPo"][:, oi]]


def glm_design(Fd, rows, fin):
    """Standardized page-computable features plus finished x (win logit, own/opp sig landed) interactions."""
    Z = (Fd.G[rows] - Fd.Gmu) / Fd.Gsd
    wl = Z[:, GLM_NAMES.index("win_logit")]
    return np.c_[Z, fin * wl, fin * Z[:, GLM_NAMES.index("own_sig_lnd")], fin * Z[:, GLM_NAMES.index("opp_sig_lnd")]]


# candidates: (name, family, options)
def candidates(st):
    c = [("pois_base", "pois", {}), ("nb_base", "nb", {"t": False, "glm": None}),
         ("nb_t", "nb", {"t": True, "glm": None})]
    for lam in (30.0, 300.0, 3000.0, 10000.0, 30000.0):
        c.append(("nb_glm_l%g" % lam, "nb", {"t": True, "glm": lam}))
    c.append(("nb_gbm", "gbm", {}))
    if st in SPARSE:
        c.append(("zinb_t", "nb", {"t": True, "glm": None, "zi": True}))
        c.append(("zinb_glm_l300", "nb", {"t": True, "glm": 300.0, "zi": True}))
    if st == "ctrl":
        c.append(("zibeta_t", "zibeta", {"glm": None}))
        c.append(("zibeta_glm_l300", "zibeta", {"glm": 300.0}))
    return c


class StatModel:
    """One fitted candidate for one stat on one fold; .dist(rows, t) gives the predictive distribution of the stat for
    those rows at fight lengths t (minutes)."""
    def __init__(self, T, Fd, st, name, family, opt):
        self.T, self.Fd, self.st, self.name, self.family, self.opt = T, Fd, st, name, family, opt
        self.j = SI[st]

    def _parts(self, rows, t):
        T, Fd = self.T, self.Fd
        R = T["rounds"][rows]
        Xt, fin, lt = t_terms(t, R)
        base = Fd.BR[rows, self.j] * t
        lmu0 = np.log(np.maximum(base, 1e-8))
        G = glm_design(Fd, rows, fin) if self.opt.get("glm") else None
        return R, Xt, fin, lt, lmu0, G

    def fit(self, rows):
        T, st = self.T, self.st
        y = T["Y"][rows, self.j]
        t = T["t"][rows]
        R, Xt, fin, lt, lmu0, G = self._parts(rows, t)
        o = self.opt
        if self.family == "pois":
            return self
        if self.family == "zibeta":
            cap = 60.0 * t
            sh = np.clip(np.exp(lmu0) / cap, 1e-4, 0.98)
            off = np.log(sh / (1 - sh))
            Xm = Xt if not o.get("glm") else np.c_[Xt, G]
            lam = np.r_[np.zeros(Xt.shape[1]), np.full(0 if G is None else G.shape[1], o.get("glm") or 0.0)]
            Xphi = np.c_[np.ones(len(t)), lt, fin]
            Xp = self._zb_p(lmu0, cap, lt, fin, G)
            lp = np.r_[np.zeros(4), np.full(0 if G is None else G.shape[1], o.get("glm") or 0.0)]
            self.b, self.g, self.d = fit_zibeta(y, cap, off, Xm, Xphi, Xp, lam, lp)
            return self
        if self.family == "gbm":
            # LightGBM Poisson correction on top of nb_t (fit first, in-fold), rounds by early stopping on the last
            # training year, then the NB shape refit with the boosted mean as offset
            self.base = StatModel(T, self.Fd, st, "nb_t", "nb", {"t": True, "glm": None}).fit(rows)
            import lightgbm as lgb
            Xg = self._gbm_X(rows, t)
            lm_b = np.log(self.base.dist(rows, t).p["mu"])
            yrs = T["year"][rows]
            last = yrs.max()
            a, v = yrs < last, yrs == last
            prm = dict(objective="poisson", learning_rate=0.03, num_leaves=7, min_data_in_leaf=100,
                       feature_fraction=0.5, bagging_fraction=0.8, bagging_freq=1, lambda_l2=10.0, verbose=-1,
                       num_threads=1, seed=7, poisson_max_delta_step=0.7)
            if a.sum() > 500 and v.sum() > 200:
                dtr = lgb.Dataset(Xg[a], y[a], init_score=lm_b[a], free_raw_data=False)
                dva = lgb.Dataset(Xg[v], y[v], init_score=lm_b[v], reference=dtr)
                bst = lgb.train(prm, dtr, 600, valid_sets=[dva], callbacks=[lgb.early_stopping(40, verbose=False)])
                nr = max(1, bst.best_iteration)
            else:
                nr = 50
            self.nrounds = nr
            dall = lgb.Dataset(Xg, y, init_score=lm_b)
            self.bst = lgb.train(prm, dall, int(round(nr * 1.1)))
            lm = lm_b + self.bst.predict(Xg, raw_score=True)
            Xk = k_terms(t, R, lmu0, True)
            _, self.g, _ = fit_nb(y, lm, np.zeros((len(y), 0)), Xk)
            return self
        Xm = Xt if o.get("t") else Xt[:, :1]
        lam = np.zeros(Xm.shape[1])
        if o.get("glm"):
            Xm = np.c_[Xm, G]
            lam = np.r_[lam, np.full(G.shape[1], o["glm"])]
        Xk = k_terms(t, R, lmu0, bool(o.get("glm"))) if o.get("t") else np.ones((len(t), 1))
        Xp = np.c_[np.ones(len(t)), np.clip(lmu0, -8, 8), lt, fin] if o.get("zi") else None
        self.b, self.g, self.d = fit_nb(y, lmu0, Xm, Xk, lam, Xp)
        return self

    @staticmethod
    def _zb_p(lmu0, cap, lt, fin, G):
        X = np.c_[np.ones(len(lt)), np.clip(lmu0 - np.log(cap), -10, 2), lt, fin]
        return X if G is None else np.c_[X, G]

    def _gbm_X(self, rows, t):
        T, Fd = self.T, self.Fd
        R = T["rounds"][rows]
        _, fin, lt = t_terms(t, R)
        return np.c_[T["XF"][rows], T["EMB"][rows], T["EMBo"][rows], T["OPP"][rows], T["OPPo"][rows],
                     np.log(Fd.BR[rows]), np.log(Fd.BRo[rows]), lt, fin, T["WINL"][rows], R]

    def dist(self, rows, t):
        T, o = self.T, self.opt
        R, Xt, fin, lt, lmu0, G = self._parts(rows, t)
        if self.family == "pois":
            return Dist("pois", mu=np.exp(lmu0))
        if self.family == "zibeta":
            cap = 60.0 * t
            sh = np.clip(np.exp(lmu0) / cap, 1e-4, 0.98)
            off = np.log(sh / (1 - sh))
            Xm = Xt if not o.get("glm") else np.c_[Xt, G]
            m = expit(np.clip(off + Xm @ self.b, -15, 15))
            phi = np.exp(np.clip(np.c_[np.ones(len(t)), lt, fin] @ self.g, -4, 8))
            pi = expit(self._zb_p(lmu0, cap, lt, fin, G) @ self.d)
            return Dist("zibeta", pi=pi, m=m, phi=phi, cap=cap)
        if self.family == "gbm":
            lm_b = np.log(self.base.dist(rows, t).p["mu"])
            lm = lm_b + self.bst.predict(self._gbm_X(rows, t), raw_score=True)
            k = np.exp(np.clip(k_terms(t, R, lmu0, True) @ self.g, -6, 9))
            return Dist("nb", mu=np.exp(np.clip(lm, -20, 20)), k=k)
        Xm = Xt if o.get("t") else Xt[:, :1]
        if o.get("glm"):
            Xm = np.c_[Xm, G]
        Xk = k_terms(t, R, lmu0, bool(o.get("glm"))) if o.get("t") else np.ones((len(t), 1))
        mu = np.exp(np.clip(lmu0 + Xm @ self.b, -20, 20))
        k = np.exp(np.clip(Xk @ self.g, -6, 9))
        if o.get("zi"):
            pi = expit(np.c_[np.ones(len(t)), np.clip(lmu0, -8, 8), lt, fin] @ self.d)
            return Dist("zinb", mu=mu, k=k, pi=pi)
        return Dist("nb", mu=mu, k=k)


def folds_of(T):
    """Expanding-window folds: {Y: (train mask, test mask)} for the CV years, plus 'valid' (train 2019-2023, test
    2024-2025) and 'y2020' (train 2019, test 2020; winner-expert history only)."""
    yr = T["year"]
    F = {Y: ((yr >= FIRST_YEAR) & (yr < Y), yr == Y) for Y in CV_YEARS}
    F["y2020"] = ((yr >= FIRST_YEAR) & (yr < 2020), yr == 2020)
    F["valid"] = ((yr >= FIRST_YEAR) & (yr <= 2023), (yr >= 2024) & (yr <= 2025))
    return F


# ====================================================================== bootstrap helpers
class Boot:
    """Event-cluster bootstrap: resample event keys with replacement (same draws for every statistic)."""
    def __init__(self, groups, n=2000, seed=11):
        self.keys, self.inv = np.unique(groups, return_inverse=True)
        rng = np.random.default_rng(seed)
        G = len(self.keys)
        self.W = np.zeros((n, G))
        for b in range(n):
            self.W[b] = np.bincount(rng.integers(0, G, G), minlength=G)

    def mean_ci(self, v):
        s = np.bincount(self.inv, weights=v, minlength=len(self.keys))
        c = np.bincount(self.inv, minlength=len(self.keys)).astype(float)
        bm = (self.W @ s) / np.maximum(self.W @ c, 1e-12)
        return float(v.mean()), float(np.percentile(bm, 2.5)), float(np.percentile(bm, 97.5))


def fmt_ci(t, d=4):
    return "%+.*f [%+.*f, %+.*f]" % (d, t[0], d, t[1], d, t[2])


def pit_summary(pit):
    h = np.histogram(pit, bins=10, range=(0, 1))[0]
    n = max(len(pit), 1)
    sh = h / n
    return {"hist10": h.tolist(), "in80": float(((pit >= 0.1) & (pit <= 0.9)).mean()),
            "above90": float((pit > 0.9).mean()), "below10": float((pit < 0.1).mean()),
            "max_bin_dev": float(np.max(np.abs(sh - 0.1))), "chi2": float(((h - n / 10) ** 2 / (n / 10)).sum())}


# ====================================================================== stage: cv
def stage_cv(args):
    T = load_table()
    F = folds_of(T)
    rng = np.random.default_rng(SEED)
    stats = args.stats.split(",") if args.stats else STATS
    out = {"per_stat": {}, "choice": {}, "rule": SELECT_RULE}
    store = {}
    folds = {Y: Fold(T, F[Y][0]) for Y in CV_YEARS}
    for st in stats:
        cands = candidates(st)
        res = {}
        for name, fam, opt in cands:
            if args.skip_gbm and fam == "gbm":
                continue
            per_year = {}
            lp_all, crps_all, dev_all, pit_all, band_all, ev_all = [], [], [], [], [], []
            t1 = time.time()
            for Y in CV_YEARS:
                tr, te = F[Y]
                rtr, rte = np.flatnonzero(tr), np.flatnonzero(te)
                m = StatModel(T, folds[Y], st, name, fam, opt).fit(rtr)
                d = m.dist(rte, T["t"][rte])
                y = T["Y"][rte, SI[st]]
                sc = score_rows(st, y, d, rng)
                dv = pois_dev(y, d.mean())
                per_year[str(Y)] = {"nll": float(-sc["lp"].mean()), "crps": float(sc["crps"].mean()),
                                    "dev": float(dv.mean()), "n": int(len(y))}
                lp_all.append(sc["lp"]); crps_all.append(sc["crps"]); dev_all.append(dv); pit_all.append(sc["pit"])
                band_all.append(sc["band"]); ev_all.append(T["event"][rte])
                store[(st, name, Y)] = {"lp": sc["lp"], "crps": sc["crps"], "dev": dv, "pit": sc["pit"],
                                        "mean": d.mean(), "rows": rte}
            lp, cr, dv, pit = (np.concatenate(x) for x in (lp_all, crps_all, dev_all, pit_all))
            res[name] = {"nll": float(-lp.mean()), "crps": float(cr.mean()), "dev": float(dv.mean()),
                         "band80_naive": float(np.concatenate(band_all).mean()), "pit": pit_summary(pit),
                         "by_year": per_year}
            log("%-8s %-15s NLL %.4f CRPS %.4f dev %.4f PIT in80 %.3f >P90 %.3f <P10 %.3f (%.1fs)" % (
                st, name, res[name]["nll"], res[name]["crps"], res[name]["dev"], res[name]["pit"]["in80"],
                res[name]["pit"]["above90"], res[name]["pit"]["below10"], time.time() - t1))
        out["per_stat"][st] = res
        out["choice"][st] = select(res, js_only=False)
        out.setdefault("choice_js", {})[st] = select(res, js_only=True)
        log("%-8s chosen %s (JS-evaluable: %s)" % (st, out["choice"][st], out["choice_js"][st]))
    path = os.path.join(CACHE, "cv%s.json" % ("_" + args.tag if args.tag else ""))
    json.dump(out, open(path, "w"), indent=1)
    pickle.dump(store, open(os.path.join(CACHE, "cv_store%s.pkl" % ("_" + args.tag if args.tag else "")), "wb"))
    log("wrote %s" % path)


SELECT_RULE = ("per stat, start from nb_base (the verified mlrates + embedding mean with one NB shape); walk the ladder "
               "nb_t -> best nb_glm (ridge 30/300/3000/10000/30000) -> nb_gbm, and for sparse stats also the zero-inflated versions "
               "(and for control the zero-inflated Beta); a candidate replaces the current choice only if its pooled "
               "2021-2023 CV log score (NLL per fight-side) is lower by more than 0.001 nats AND it is lower in at least 2 "
               "of the 3 CV years. 'JS-evaluable' excludes nb_gbm (the page has no tree evaluator for it).")


def select(res, js_only):
    def better(a, b):
        if a not in res or b not in res:
            return False
        ra, rb = res[a], res[b]
        wins = sum(ra["by_year"][str(Y)]["nll"] < rb["by_year"][str(Y)]["nll"] for Y in CV_YEARS)
        return ra["nll"] < rb["nll"] - 0.001 and wins >= 2
    cur = "nb_base"
    if better("nb_t", cur):
        cur = "nb_t"
    glms = [k for k in res if k.startswith("nb_glm")]
    if glms:
        g = min(glms, key=lambda k: res[k]["nll"])
        if better(g, cur):
            cur = g
    if not js_only and better("nb_gbm", cur):
        cur = "nb_gbm"
    zis = [k for k in res if k.startswith("zinb") or k.startswith("zibeta")]
    if zis:
        z = min(zis, key=lambda k: res[k]["nll"])
        if better(z, cur):
            cur = z
    return cur


# ====================================================================== stage: actuals (input of tools/statlines_engine.js)
def stage_actuals(args):
    """Actual stat lines of the backtest fights (2019-2025; 2026 dropped at load) for tools/statlines_engine.js."""
    T = load_table()
    out = {}
    for i in range(len(T["fid"])):
        f = T["fid"][i]
        if f not in T["bt_ids"]:
            continue
        e = out.setdefault(f, {"minutes": float(T["t"][i]), "rounds": int(T["rounds"][i]), "date": T["date"][i]})
        e["AB"[T["side"][i]]] = {st: float(T["Y"][i, SI[st]]) for st in STATS}
    assert max(v["date"] for v in out.values()) < VAULT_FROM
    p = os.path.join(CACHE, "actuals.json")
    json.dump(out, open(p, "w"))
    log("wrote %s (%d fights)" % (p, len(out)))


# ====================================================================== fight-length mixture (unconditional lines)
def length_grid(T, rows):
    """Fight-length distribution per row from the methodround S cells (P(finish in round r by KO/TKO or submission,
    either man), P(decision or draw)) and the fixed pre-2019 within-round finish-time table (10 bins of 30 s).
    Returns {R: (row positions into `rows`, t grid P, weights n x P)} with P = 10 R + 1 (last point = the distance)."""
    ft = T["finish_time"]
    mids = (np.arange(10) + 0.5) * 0.5
    out = {}
    for R in (3, 5):
        pos = [k for k, i in enumerate(rows) if T["rounds"][i] == R and T["fid"][i] in T["cells"]]
        if not pos:
            continue
        tg = np.r_[np.concatenate([5.0 * r + mids for r in range(R)]), 5.0 * R]
        W = np.zeros((len(pos), len(tg)))
        for a, k in enumerate(pos):
            S = np.asarray(T["cells"][T["fid"][rows[k]]]["S"], float)
            assert len(S) == 4 * R + 3
            S = S / S.sum()
            for r in range(R):
                ko, sb = S[r] + S[2 * R + r], S[R + r] + S[3 * R + r]
                g = "r1" if r == 0 else "rN"
                W[a, 10 * r:10 * r + 10] = ko * np.asarray(ft["KO|" + g]) + sb * np.asarray(ft["SUB|" + g])
            W[a, -1] = S[4 * R:].sum()
        out[R] = (np.array(pos), tg, W)
    return out


def mixture_scores(st, model, T, rows, y, rng, chunk=60):
    """Unconditional predictive distribution of stat st for rows (mixture over the fight-length grid): per-row log
    score, CRPS, randomized PIT, naive 10-90% band hit, mean, P10/P50/P90. Rows without S cells get nan."""
    n = len(rows)
    res = {k: np.full(n, np.nan) for k in ("lp", "crps", "pit", "band", "mean", "q10", "q50", "q90")}
    G = length_grid(T, rows)
    v = rng.random(n)
    for R, (pos, tg, W) in G.items():
        P = len(tg)
        for a in range(0, len(pos), chunk):
            pp = pos[a:a + chunk]
            m = len(pp)
            rr = np.repeat(np.asarray(rows)[pp], P)
            tt = np.tile(tg, m)
            d = model.dist(rr, tt)
            w = W[a:a + chunk].reshape(-1)
            yy = np.repeat(y[pp], P)
            lp = d.logpmf(yy)
            if d.kind == "zibeta":
                lp = np.where(yy > d.p["cap"] + 0.5, -np.inf, lp)
            with np.errstate(divide="ignore"):
                lw = np.log(np.maximum(w, 0)) + lp
            lw = lw.reshape(m, P)
            mx = np.max(lw, 1, keepdims=True)
            res["lp"][pp] = (mx[:, 0] + np.log(np.exp(lw - mx).sum(1)))
            res["mean"][pp] = (w * d.mean()).reshape(m, P).sum(1)
            J = grid_max(st, d) if d.kind != "zibeta" else int(60 * 5 * R + 2)
            J = min(J, 4000)
            g = np.arange(J + 1)[None, :]
            F = (d.cdf_grid(J) * w[:, None]).reshape(m, P, J + 1).sum(1)
            F = np.minimum(F, 1.0)
            yi = y[pp].astype(int)
            ind = (g >= y[pp][:, None]).astype(float)
            res["crps"][pp] = ((F - ind) ** 2).sum(1)
            Fy = np.take_along_axis(F, np.clip(yi, 0, J)[:, None], 1)[:, 0]
            Fm = np.where(yi >= 1, np.take_along_axis(F, np.clip(yi - 1, 0, J)[:, None], 1)[:, 0], 0.0)
            res["pit"][pp] = np.clip(Fm + v[pp] * (Fy - Fm), 0, 1)
            for q, key in ((0.1, "q10"), (0.5, "q50"), (0.9, "q90")):
                res[key][pp] = (F >= q).argmax(1)
            res["band"][pp] = (y[pp] >= res["q10"][pp]) & (y[pp] <= res["q90"][pp])
    return res


class PoisModel:
    """Poisson at a per-minute base rate (mean only; the comparator 'the mean model with a Poisson spread')."""
    def __init__(self, BR, j):
        self.BR, self.j = BR, j

    def dist(self, rows, t):
        return Dist("pois", mu=np.maximum(self.BR[rows, self.j] * t, 1e-8))


def raw_base(T):
    """Per-minute base rates from the raw mlrates out-of-fold rates (no embedding blend, no recalibration)."""
    return base_rates(np.maximum(T["ML"], 1e-9))


def chosen_js(cv):
    return cv["choice_js"]


def cand_of(st, name):
    for n, f, o in candidates(st):
        if n == name:
            return n, f, o
    raise KeyError((st, name))


def fit_set(T, Fd, rows_tr, choice):
    return {st: StatModel(T, Fd, st, *cand_of(st, choice[st])).fit(rows_tr) for st in STATS}


# ====================================================================== evaluation of one fold set
EVAL_CANDS = ("chosen", "nb_base", "pois_base", "pois_mlraw")


def eval_fold(T, Fd, models, nbb, rows, rng, mix=True):
    """Per stat: conditional (actual t) scores for the chosen model and the comparators, plus the unconditional
    mixture for the chosen model and the Poisson-blend comparator. Returns {st: {cand: {metric: array}}}."""
    t = T["t"][rows]
    RAW = raw_base(T)
    out = {}
    for st in STATS:
        j = SI[st]
        y = T["Y"][rows, j]
        o = {}
        for cn in EVAL_CANDS:
            if cn == "chosen":
                d = models[st].dist(rows, t)
            elif cn == "nb_base":
                d = nbb[st].dist(rows, t)
            elif cn == "pois_base":
                d = PoisModel(Fd.BR, j).dist(rows, t)
            else:
                d = PoisModel(RAW, j).dist(rows, t)
            sc = score_rows(st, y, d, rng)
            sc["dev"] = pois_dev(y, d.mean())
            sc["mean"] = d.mean()
            sc["ae_med"] = np.abs(y - median_of(d))
            if cn == "chosen":
                sc["par"] = {k: np.asarray(v, float) for k, v in d.p.items()}
            o[cn] = sc
        if mix:
            o["chosen_mix"] = mixture_scores(st, models[st], T, rows, y, rng)
            o["chosen_mix"]["dev"] = pois_dev(y, np.nan_to_num(o["chosen_mix"]["mean"], nan=1.0))
            o["pois_base_mix"] = mixture_scores(st, PoisModel(Fd.BR, j), T, rows, y, rng)
            o["pois_base_mix"]["dev"] = pois_dev(y, np.nan_to_num(o["pois_base_mix"]["mean"], nan=1.0))
        out[st] = o
    return out


def median_of(d):
    J = grid_max("x", d) if d.kind != "zibeta" else int(np.max(d.p["cap"]) + 2)
    J = min(J, 4000)
    med = np.zeros(len(d.mean()))
    n = len(med)
    for a in range(0, n, 300):
        b = min(n, a + 300)
        sub = Dist(d.kind, **{k: x[a:b] for k, x in d.p.items()})
        F = sub.cdf_grid(J)
        med[a:b] = (F >= 0.5).argmax(1)
    return med


def summarize(sc, mask=None):
    m = np.ones(len(sc["lp"]), bool) if mask is None else mask
    m = m & np.isfinite(sc["lp"])
    r = {"n": int(m.sum()), "nll": r5(-sc["lp"][m].mean()), "crps": r5(sc["crps"][m].mean()),
         "dev": r5(sc["dev"][m].mean())}
    if "ae_med" in sc:
        r["mae_median"] = r5(sc["ae_med"][m].mean())
    r["band80_naive"] = r5(sc["band"][m].mean())
    ps = pit_summary(sc["pit"][m])
    r["pit_in80"] = r5(ps["in80"])
    r["pit_above90"] = r5(ps["above90"])
    r["pit_below10"] = r5(ps["below10"])
    r["pit_hist10"] = ps["hist10"]
    return r


# ====================================================================== engine comparison
ENG_F = {"mean": 0, "var": 1, "pit": 2, "crps": 3, "in80": 4, "cmean": 5, "dmean": 6, "dvar": 7, "dpit": 8, "dcrps": 9,
         "din80": 10}


def load_engine(path):
    E = json.load(open(path))
    assert E["meta"]["until"] <= VAULT_FROM
    return E


def engine_compare(T, ev, rows, E, boot, years_note):
    """Per stat on backtest fight-sides with an engine record: (a) conditional means at the actual length (engine's
    rate-based mean vs ours), (b) went-the-distance fights, engine sims that went the distance vs our distribution at
    t = 5R: CRPS, PIT, 80% coverage, (c) unconditional: engine's full simulated distribution vs our length mixture."""
    F = E["fights"]
    fid = T["fid"][rows]
    side = T["side"][rows]
    rec = [F.get(f) for f in fid]
    ok = np.array([r is not None and r.get("err") is None and "A" in r for r in rec])
    out = {"meta": {"engine": "%s / %s, %d sims per order" % (E["meta"]["engine_version"], E["meta"]["params_version"],
                                                               E["meta"]["sims_per_order"]), "years": years_note}}
    grp = T["event"][rows]
    for st in STATS:
        j = SI[st]
        y = T["Y"][rows, j]
        A = np.full((len(rows), 11), np.nan)
        for k, r in enumerate(rec):
            if ok[k]:
                v = r["AB"[side[k]]][st]
                A[k, :len(v)] = v
        o = ev[st]
        res = {}
        # (a) conditional mean at the actual length
        m = ok & np.isfinite(A[:, ENG_F["cmean"]])
        de = pois_dev(y, np.maximum(A[:, ENG_F["cmean"]], 1e-6))
        for cn in ("chosen", "pois_base", "pois_mlraw"):
            res["cond_mean_dev|%s - engine" % cn] = ci_list(boot, o[cn]["dev"] - de, m, grp)
        res["cond_mean_dev|engine"] = r5(de[m].mean())
        res["cond_mean_dev|chosen"] = r5(o["chosen"]["dev"][m].mean())
        res["cond_mean_dev|pois_base"] = r5(o["pois_base"]["dev"][m].mean())
        res["n_cond"] = int(m.sum())
        # (b) went the distance: engine's decision sims vs our conditional distribution (actual t = 5R)
        md = ok & np.isfinite(A[:, ENG_F["dcrps"]])
        res["dist"] = {"n": int(md.sum()),
                       "engine": {"crps": r5(A[md, ENG_F["dcrps"]].mean()),
                                  "dev": r5(pois_dev(y[md], np.maximum(A[md, ENG_F["dmean"]], 1e-6)).mean()),
                                  "band80_naive": r5(A[md, ENG_F["din80"]].mean()),
                                  **{("pit_" + k): r5(v) for k, v in pit_summary(A[md, ENG_F["dpit"]]).items()
                                     if k in ("in80", "above90", "below10")},
                                  "pit_hist10": pit_summary(A[md, ENG_F["dpit"]])["hist10"]},
                       "chosen": {"crps": r5(o["chosen"]["crps"][md].mean()), "dev": r5(o["chosen"]["dev"][md].mean()),
                                  "band80_naive": r5(o["chosen"]["band"][md].mean()),
                                  **{("pit_" + k): r5(v) for k, v in pit_summary(o["chosen"]["pit"][md]).items()
                                     if k in ("in80", "above90", "below10")},
                                  "pit_hist10": pit_summary(o["chosen"]["pit"][md])["hist10"]},
                       "crps|chosen - engine": ci_list(boot, o["chosen"]["crps"] - np.nan_to_num(A[:, ENG_F["dcrps"]]),
                                                       md, grp)}
        # (c) unconditional
        if "chosen_mix" in o:
            mu = ok & np.isfinite(o["chosen_mix"]["crps"])
            deu = pois_dev(y, np.maximum(np.nan_to_num(A[:, ENG_F["mean"]], nan=1.0), 1e-6))
            res["uncond"] = {"n": int(mu.sum()),
                             "engine": {"crps": r5(A[mu, ENG_F["crps"]].mean()), "dev": r5(deu[mu].mean()),
                                        "band80_naive": r5(A[mu, ENG_F["in80"]].mean()),
                                        **{("pit_" + k): r5(v) for k, v in pit_summary(A[mu, ENG_F["pit"]]).items()
                                           if k in ("in80", "above90", "below10")},
                                        "pit_hist10": pit_summary(A[mu, ENG_F["pit"]])["hist10"]},
                             "chosen_mix": {"crps": r5(o["chosen_mix"]["crps"][mu].mean()),
                                            "dev": r5(o["chosen_mix"]["dev"][mu].mean()),
                                            "nll": r5(-o["chosen_mix"]["lp"][mu].mean()),
                                            "band80_naive": r5(o["chosen_mix"]["band"][mu].mean()),
                                            **{("pit_" + k): r5(v) for k, v in pit_summary(o["chosen_mix"]["pit"][mu]).items()
                                               if k in ("in80", "above90", "below10")},
                                            "pit_hist10": pit_summary(o["chosen_mix"]["pit"][mu])["hist10"]},
                             "pois_base_mix": {"crps": r5(o["pois_base_mix"]["crps"][mu].mean()),
                                               "dev": r5(o["pois_base_mix"]["dev"][mu].mean()),
                                               "nll": r5(-o["pois_base_mix"]["lp"][mu].mean()),
                                               "pit_in80": r5(pit_summary(o["pois_base_mix"]["pit"][mu])["in80"])},
                             "crps|chosen_mix - engine": ci_list(boot, np.nan_to_num(o["chosen_mix"]["crps"])
                                                                 - np.nan_to_num(A[:, ENG_F["crps"]]), mu, grp),
                             "dev|chosen_mix - engine": ci_list(boot, np.nan_to_num(o["chosen_mix"]["dev"]) - deu, mu, grp)}
        out[st] = res
    return out


def ci_list(boot_maker, d, mask, grp):
    """Event-cluster bootstrap mean and 95% CI of d over mask (fresh Boot on the masked groups, fixed seed)."""
    if mask.sum() == 0:
        return None
    b = boot_maker(grp[mask])
    m, lo, hi = b.mean_ci(d[mask])
    return [r5(m), r5(lo), r5(hi)]


_BOOTS = {}


def boot_for(groups):
    key = hashlib.md5("|".join(map(str, groups)).encode()).hexdigest()
    if key not in _BOOTS:
        _BOOTS[key] = Boot(groups, n=2000, seed=11)
    return _BOOTS[key]


# ====================================================================== winner expert (dominance from stat lines)
DOM_SCALE = 0.05     # fixed logit per dominance point (set before any fit; the stack weight rescales it)


def dominance(means):
    """means: {stat: array} expected fight totals -> expected dominance points (DOM_W, engine judging defaults)."""
    return sum(w * means[s] for s, w in DOM_W.items())


def mix_means(T, rows, mean_fn):
    """Unconditional expected totals per stat for rows with S cells: sum_p w_p E[stat | t_p]. mean_fn(st, rr, tt)."""
    G = length_grid(T, rows)
    out = {st: np.full(len(rows), np.nan) for st in DOM_W}
    for R, (pos, tg, W) in G.items():
        P = len(tg)
        rr = np.repeat(np.asarray(rows)[pos], P)
        tt = np.tile(tg, len(pos))
        for st in DOM_W:
            out[st][pos] = (mean_fn(st, rr, tt) * W.reshape(-1)).reshape(len(pos), P).sum(1)
    return out


def mix_means_all(T, rows, models):
    """Unconditional expected totals of every stat (nan for rows without S cells)."""
    G = length_grid(T, rows)
    out = {st: np.full(len(rows), np.nan) for st in STATS}
    for R, (pos, tg, W) in G.items():
        P = len(tg)
        rr = np.repeat(np.asarray(rows)[pos], P)
        tt = np.tile(tg, len(pos))
        for st in STATS:
            out[st][pos] = (models[st].dist(rr, tt).mean() * W.reshape(-1)).reshape(len(pos), P).sum(1)
    return out


def winner_logits(T, rows_fight_sides, mean_fn):
    """Per fight: DOM_SCALE x (dominance A - dominance B) from unconditional expected totals. Antisymmetric by
    construction: each side is 'attacker X vs defender Y' and no corner input enters."""
    rows = np.asarray(rows_fight_sides)
    mm = mix_means(T, rows, mean_fn)
    D = dominance(mm)
    by = {}
    for k, i in enumerate(rows):
        by.setdefault(T["fid"][i], [np.nan, np.nan])[T["side"][i]] = D[k]
    return {f: DOM_SCALE * (v[0] - v[1]) for f, v in by.items() if np.isfinite(v[0]) and np.isfinite(v[1])}


# ====================================================================== corner symmetry (swap test)
def swap_test(T, J=None, n_model=150):
    """Data level: every fight's two rows are exact mirrors (attacker inputs <-> defender inputs, win logit negated,
    same length / rounds). Model level (J = exported tables): the mirrored input of side 0 gives exactly side 1's
    distribution for every stat. No corner input exists anywhere, so both must hold exactly."""
    pos = {}
    for i, (f, s) in enumerate(zip(T["fid"], T["side"])):
        pos.setdefault(f, [None, None])[s] = i
    bad = 0
    pairs = [v for v in pos.values() if v[0] is not None and v[1] is not None]
    for a, b in pairs:
        ok = (np.array_equal(T["ML"][a], T["MLo"][b]) and np.array_equal(T["MLo"][a], T["ML"][b])
              and np.array_equal(np.nan_to_num(T["ETA"][a]), np.nan_to_num(T["ETAo"][b]))
              and np.array_equal(T["OPP"][a], T["OPPo"][b]) and T["WINL"][a] == -T["WINL"][b]
              and T["t"][a] == T["t"][b] and T["rounds"][a] == T["rounds"][b] and T["has_emb"][a] == T["has_emb"][b])
        bad += not ok
    res = {"pairs": len(pairs), "data_mismatch": bad}
    if J is not None:
        Jm = dict(J, _ti=T["TI"])
        worst = 0.0
        for a, b in pairs[:: max(1, len(pairs) // n_model)][:n_model]:
            ia = row_input(T, a)
            mir = {"ml": ia["mlo"], "mlo": ia["ml"], "eta": ia["etao"], "etao": ia["eta"], "has_emb": ia["has_emb"],
                   "win_logit": -ia["win_logit"], "opp": ia["oppo"], "oppo": ia["opp"], "rounds": ia["rounds"]}
            ib = row_input(T, b)
            for st in STATS:
                _, p1 = py_eval(Jm, mir, st, float(T["t"][a]))
                _, p2 = py_eval(Jm, ib, st, float(T["t"][b]))
                worst = max(worst, max(abs(p1[k] - p2[k]) for k in p1))
        res["model_max_abs_diff"] = worst
        assert worst == 0.0, "model swap test failed: %g" % worst
    assert bad == 0, "data swap test failed on %d fights" % bad
    log("swap test: %s" % res)
    return res


# ====================================================================== stage: cvfit (CV-year evaluation, OOF, engine)
def stage_cvfit(args):
    T = load_table()
    F = folds_of(T)
    cv = json.load(open(os.path.join(CACHE, "cv.json")))
    ch = chosen_js(cv)
    rng = np.random.default_rng(SEED + 1)
    E = load_engine(os.path.join(CACHE, "engine_v4.json"))
    R = {"choice_js": ch, "choice_all": cv["choice"], "engine": {}, "swap_test": swap_test(T)}
    store, wl = {}, {}
    nb_base = {st: "nb_base" for st in STATS}
    allrows, allev = [], {}
    for Y in CV_YEARS:
        tr, te = F[Y]
        rtr, rte = np.flatnonzero(tr), np.flatnonzero(te)
        Fd = Fold(T, tr)
        models = fit_set(T, Fd, rtr, ch)
        nbb = fit_set(T, Fd, rtr, nb_base)
        ev = eval_fold(T, Fd, models, nbb, rte, rng)
        store[Y] = {"rows": rte, "ev": ev}
        allrows.append(rte)
        wl.update(winner_logits(T, rte, lambda st, rr, tt: models[st].dist(rr, tt).mean()))
        log("CV year %d: %d rows evaluated" % (Y, len(rte)))
    rows = np.concatenate(allrows)
    def cat(parts):
        if isinstance(parts[0], dict):
            return {k: np.concatenate([p[k] for p in parts]) for k in parts[0]}
        return np.concatenate(parts)
    ev = {st: {cn: {k: cat([store[Y]["ev"][st][cn][k] for Y in CV_YEARS])
                    for k in store[CV_YEARS[0]]["ev"][st][cn]} for cn in store[CV_YEARS[0]]["ev"][st]} for st in STATS}
    R.update(report_block(T, rows, ev, "2021-2023 (forward-chained CV years; folds trained 2019..Y-1)"))
    R["engine"] = engine_compare(T, ev, rows, E, boot_for,
                                 "2021-2023; NOTE engine v4 params (selfcal-pre2024) were tuned on 2019-2023, so its "
                                 "levels are in-sample here; 2024-2025 (final) is the clean comparison")
    # winner-expert history: 2019 from the raw mlrates OOF rates (no second stage; no earlier row to fit one on),
    # 2020 from the y2020 fold (trained on 2019), 2021-2023 from the CV folds above
    RAW = raw_base(T)
    r19 = np.flatnonzero(T["year"] == 2019)
    wl.update(winner_logits(T, r19, lambda st, rr, tt: RAW[rr, SI[st]] * tt))
    tr20, te20 = F["y2020"]
    Fd20 = Fold(T, tr20)
    m20 = fit_set(T, Fd20, np.flatnonzero(tr20), ch)
    r20 = np.flatnonzero(te20)
    wl.update(winner_logits(T, r20, lambda st, rr, tt: m20[st].dist(rr, tt).mean()))
    ev20 = {}
    mm20 = mix_means_all(T, r20, m20)
    for st in STATS:
        d = m20[st].dist(r20, T["t"][r20])
        ev20[st] = {"chosen": {"par": {k: np.asarray(v, float) for k, v in d.p.items()}}, "chosen_mix": {"mean": mm20[st]}}
    pickle.dump({"rows": rows, "ev": ev, "oof20": {"rows": r20, "ev": ev20}}, open(os.path.join(CACHE, "cvfit_store.pkl"), "wb"))
    json.dump({f: r5(v) for f, v in wl.items()}, open(os.path.join(CACHE, "winner_oof.json"), "w"))
    json.dump(R, open(os.path.join(CACHE, "cv_eval.json"), "w"), indent=1)
    log("wrote cv_eval.json, winner_oof.json (%d fights)" % len(wl))
    print_report(R)


def report_block(T, rows, ev, label):
    """Tables: per stat, conditional scores for each candidate (all rows and the backtest universe), paired CIs of the
    chosen model vs the comparators, PIT / coverage; unconditional mixture summaries."""
    grp = T["event"][rows]
    bp = T["both_prior"][rows]
    out = {"label": label, "n_rows": int(len(rows)), "n_both_prior": int(bp.sum()), "per_stat": {}}
    for st in STATS:
        o = ev[st]
        r = {"all": {cn: summarize(o[cn]) for cn in EVAL_CANDS},
             "backtest_universe": {cn: summarize(o[cn], bp) for cn in EVAL_CANDS}}
        for cn in ("nb_base", "pois_base", "pois_mlraw"):
            for met in ("lp", "crps", "dev"):
                d = o["chosen"][met] - o[cn][met]
                if met == "lp":
                    d = -d       # NLL difference
                r["chosen - %s|%s" % (cn, {"lp": "nll", "crps": "crps", "dev": "dev"}[met])] = ci_list(
                    boot_for, d, np.ones(len(rows), bool), grp)
        r["dev_rel|chosen vs pois_base"] = r5((o["chosen"]["dev"].mean() / o["pois_base"]["dev"].mean() - 1) * 100)
        r["dev_rel|chosen vs pois_mlraw"] = r5((o["chosen"]["dev"].mean() / o["pois_mlraw"]["dev"].mean() - 1) * 100)
        if "chosen_mix" in o:
            mm = np.isfinite(o["chosen_mix"]["lp"])
            r["uncond"] = {"chosen_mix": summarize(o["chosen_mix"], mm), "pois_base_mix": summarize(o["pois_base_mix"], mm)}
            r["uncond"]["chosen_mix - pois_base_mix|nll"] = ci_list(
                boot_for, -(o["chosen_mix"]["lp"] - o["pois_base_mix"]["lp"]), mm, grp)
        out["per_stat"][st] = r
    return out


def print_report(R):
    log("label: %s" % R.get("label"))
    for st in STATS:
        r = R["per_stat"][st]
        a = r["all"]
        log("%-8s chosen %-14s NLL %.4f (pois %.3f nb_base %.4f) dev %.3f (blend %.3f, raw %.3f; %+.2f%%) in80 %.3f "
            ">P90 %.3f <P10 %.3f | vs nb_base NLL %s" % (
                st, R["choice_js"][st], a["chosen"]["nll"], a["pois_base"]["nll"], a["nb_base"]["nll"],
                a["chosen"]["dev"], a["pois_base"]["dev"], a["pois_mlraw"]["dev"], r["dev_rel|chosen vs pois_base"],
                a["chosen"]["pit_in80"], a["chosen"]["pit_above90"], a["chosen"]["pit_below10"],
                r["chosen - nb_base|nll"]))
        e = R.get("engine", {}).get(st)
        if e:
            u = e.get("uncond", {})
            log("         engine: cond-mean dev eng %.3f ours %.3f diff %s | distance-only CRPS eng %.3f ours %.3f in80 "
                "eng %.3f ours %.3f | uncond CRPS eng %.3f ours %.3f in80 eng %.3f ours %.3f" % (
                    e["cond_mean_dev|engine"], e["cond_mean_dev|chosen"], e["cond_mean_dev|chosen - engine"],
                    e["dist"]["engine"]["crps"], e["dist"]["chosen"]["crps"], e["dist"]["engine"]["pit_in80"],
                    e["dist"]["chosen"]["pit_in80"], u.get("engine", {}).get("crps", np.nan),
                    u.get("chosen_mix", {}).get("crps", np.nan), u.get("engine", {}).get("pit_in80", np.nan),
                    u.get("chosen_mix", {}).get("pit_in80", np.nan)))


# ====================================================================== stage: gate (forward-chained stack CV)
GATE_SETS = {
    "line": [("market+ml2", ["market", "ml2"]), ("page: market+ml2lr", ["market", "ml2lr"])],
    "noline": [("ml2+mkt_rating+feat_lr", ["ml2", "mkt_rating", "feat_lr"]), ("page: ml2lr+mkt_rating", ["ml2lr", "mkt_rating"])],
    "open": [("open+ml2", ["open", "ml2"]), ("page: open+ml2lr", ["open", "ml2lr"])],
}


def M2():
    """tools/ml2.py's stack code (stack_fit, zmat, rec_w, stack_predict, ll, compare, SEL_MIN); the statlines expert is
    routed through ml2.col_for like ml2's own experts ('statlines_static' / 'statlines_roll')."""
    import ml2 as m2
    if not getattr(m2, "_statlines_patched", False):
        orig = m2.col_for

        def col_for(c, scheme):
            if c == "statlines":
                return c + "_" + scheme
            return orig(c, scheme)
        m2.col_for = col_for
        m2._statlines_patched = True
    return m2


def expert_D(wl_oof, wl_valid=None):
    D = pickle.load(open(os.path.join(ROOT, "out", "ml2_cache", "stack.pkl"), "rb"))["D"].copy()
    assert str(D["date"].max()) < VAULT_FROM
    p = lambda f, src: (1 / (1 + math.exp(-src[f]))) if (src and f in src and src[f] is not None) else np.nan
    yr = D["year"].to_numpy()
    st = [p(f, wl_oof) if y <= 2023 else (p(f, wl_valid) if wl_valid else np.nan) for f, y in zip(D["fid"], yr)]
    D["statlines_static"] = st
    D["statlines_roll"] = st          # one static fit (2019-2023) for 2024-2025; no rolling refit
    return D


def stage_gate(args):
    m2 = M2()
    wl = json.load(open(os.path.join(CACHE, "winner_oof.json")))
    D = expert_D(wl)
    y, yr = D["y"].to_numpy(float), D["year"].to_numpy()
    cov = np.isfinite(D["statlines_static"].to_numpy(float))
    log("ml2 stack table: %d fights 2019-2025; statlines expert on %d of %d 2019-2023 fights" % (
        len(D), int((cov & (yr <= 2023)).sum()), int((yr <= 2023).sum())))
    rows_of = {"line": D["market"].notna().to_numpy(), "noline": np.ones(len(D), bool), "open": D["open"].notna().to_numpy()}
    # symmetry: the expert is antisymmetric by construction; check its mirrored fit (no intercept) is well defined
    m = cov & (yr <= 2023)
    z = np.log(D["statlines_static"].to_numpy(float)[m] / (1 - D["statlines_static"].to_numpy(float)[m]))
    alone = {"n": int(m.sum()), "ll": r5(m2.ll(1 / (1 + np.exp(-z)), y[m])), "acc": r5(float(np.mean((z > 0) == (y[m] == 1))))}
    R = {"sets": {}, "gate": {}, "paired_cv_years": {}, "expert_alone_2019_2023": alone, "rule": (
        "ml2's rule: the statlines expert enters a stack only if the forward-chained 2021-2023 stack CV log loss "
        "(fit on 2019..Y-1, recency half-life chosen from {none, 3, 1.5} with the same 0.0005 penalty) improves by more "
        "than SEL_MIN = %g" % m2.SEL_MIN)}
    P = {}
    for regime, sets in GATE_SETS.items():
        allsets = list(sets) + [(nm + " + statlines", cols + ["statlines"]) for nm, cols in sets]
        for nm, cols in allsets:
            cvs, preds = {}, {}
            for h in (None, 3.0, 1.5):
                tot = nn = 0.0
                pr = np.full(len(D), np.nan)
                for Y in CV_YEARS:
                    mm = rows_of[regime] & (yr == Y)
                    pp, _ = m2.stack_predict(D, cols, "static", h, Y - 1, mm, rows_of[regime])
                    pr[mm] = pp
                    tot += m2.ll(pp, y[mm]) * mm.sum()
                    nn += mm.sum()
                cvs[str(h)] = round(tot / nn, 5)
                preds[str(h)] = pr
            hb = min(cvs, key=lambda k: cvs[k] + (0 if k == "None" else m2.SEL_MIN))
            h = None if hb == "None" else float(hb)
            _, b = m2.stack_predict(D, cols, "static", h, 2023, np.zeros(len(D), bool), rows_of[regime])
            key = "%s|%s" % (regime, nm)
            R["sets"][key] = {"cols": cols, "cv_by_h": cvs, "chosen_h": h, "cv": cvs[hb],
                              "weights_fit_2019_2023": dict(zip(cols, np.round(b, 4).tolist()))}
            P[key] = preds[hb]
            log("stack CV %-6s %-38s CV %.5f (h %s) w<=2023 %s" % (regime, nm, cvs[hb], h, np.round(b, 3)))
        for nm, cols in sets:
            kb, kn = "%s|%s" % (regime, nm), "%s|%s + statlines" % (regime, nm)
            gain = R["sets"][kn]["cv"] - R["sets"][kb]["cv"]
            R["gate"][kn] = {"cv_base": R["sets"][kb]["cv"], "cv_plus": R["sets"][kn]["cv"], "gain": round(gain, 5),
                             "enters": bool(gain < -m2.SEL_MIN),
                             "statlines_weight": R["sets"][kn]["weights_fit_2019_2023"]["statlines"]}
            mm = rows_of[regime] & (yr >= 2021) & (yr <= 2023)
            R["paired_cv_years"][kn + " vs base"] = m2.compare(P[kn][mm], P[kb][mm], y[mm], D["event"].to_numpy()[mm])
            log("GATE %-44s gain %+.5f -> %s %s" % (kn, gain, "ENTERS" if gain < -m2.SEL_MIN else "rejected",
                                                    R["paired_cv_years"][kn + " vs base"]))
    json.dump(R, open(os.path.join(CACHE, "gate.json"), "w"), indent=1, default=float)
    log("wrote gate.json")


# ====================================================================== export (JSON tables for src/ml/statdist.js)
def export_set(Fd, models, fit_label):
    blend = {}
    for t in MLT:
        b = Fd.B[t]
        blend[t] = {"emb": None if b["emb"] is None else [float(x) for x in b["emb"]], "noemb": [float(x) for x in b["noemb"]],
                    "task": EMB_TASK[t]}
    st_out = {}
    for st, m in models.items():
        assert m.family in ("nb", "zibeta"), "only JS-evaluable families are exported"
        o = m.opt
        kind = "zibeta" if m.family == "zibeta" else ("zinb" if o.get("zi") else "nb")
        st_out[st] = {"cand": m.name, "kind": kind, "t": bool(o.get("t", True)), "glm": bool(o.get("glm")),
                      "b": [float(x) for x in m.b], "g": [float(x) for x in m.g],
                      "d": [float(x) for x in m.d] if (m.d is not None and len(m.d)) else []}
    return {"fit": fit_label, "blend": blend, "glm_mu": [float(x) for x in Fd.Gmu], "glm_sd": [float(x) for x in Fd.Gsd],
            "stats": st_out}


def py_eval(J, inp, st, t):
    """Reference evaluator of an exported model set (mirrors src/ml/statdist.js): inp = {ml: [18] raw mlrates rates of
    the attacker, mlo: the defender's, eta / etao: embedding task predictors or None, has_emb, win_logit (attacker's),
    opp / oppo: {key: factor} or {}, rounds}. Returns (kind, params dict) at fight length t (minutes)."""
    def blend(ml, eta):
        out = np.zeros(len(MLT))
        for k, tn in enumerate(MLT):
            b = J["blend"][tn]
            z0 = _link_ml(tn, np.array([ml[k]]))[0]
            if b["emb"] is not None and inp["has_emb"] and eta is not None:
                z = b["emb"][0] + b["emb"][1] * z0 + b["emb"][2] * eta[J["_ti"][b["task"]]]
            else:
                z = b["noemb"][0] + b["noemb"][1] * z0
            if tn in ("acc_h", "acc_b", "acc_l", "acc_d", "acc_c", "acc_g", "td_acc"):
                out[k] = expit(z)
            elif tn == "kd_h":
                out[k] = min(math.exp(z), 0.5)
            elif tn == "ctrl":
                out[k] = 60 * math.exp(z)
            else:
                out[k] = math.exp(z)
        return base_rates(out[None, :])[0]
    BR = blend(inp["ml"], inp.get("eta"))
    BRo = blend(inp["mlo"], inp.get("etao"))
    R = inp["rounds"]
    lt = math.log(max(t, 0.05))
    fin = 1.0 if t < 5 * R - 1.0 / 60 else 0.0
    Xt = np.array([1.0, lt, fin, fin * lt, 1.0 if R == 5 else 0.0])
    lmu0 = math.log(max(BR[SI[st]] * t, 1e-8))
    S = J["stats"][st]
    G = None
    if S["glm"]:
        raw = [math.log(BR[SI[s]]) for s in ("sig_att", "sig_lnd", "td_att", "ctrl", "sub_att", "kd")]
        raw += [math.log(BRo[SI[s]]) for s in ("sig_att", "sig_lnd", "td_att", "ctrl", "sub_att", "kd")]
        raw += [inp["win_logit"], 1.0 if inp["has_emb"] else 0.0]
        raw += [math.log(max(float(inp["opp"].get(k, 1.0)), 1e-3)) for k in GLM_OPPADJ]
        raw += [math.log(max(float(inp["oppo"].get(k, 1.0)), 1e-3)) for k in GLM_OPPADJ]
        Z = (np.array(raw) - np.array(J["glm_mu"])) / np.array(J["glm_sd"])
        wl, so, sp = Z[GLM_NAMES.index("win_logit")], Z[GLM_NAMES.index("own_sig_lnd")], Z[GLM_NAMES.index("opp_sig_lnd")]
        G = np.r_[Z, fin * wl, fin * so, fin * sp]
    b, g, d = np.array(S["b"]), np.array(S["g"]), np.array(S["d"])
    if S["kind"] == "zibeta":
        cap = 60.0 * t
        sh = min(max(math.exp(lmu0) / cap, 1e-4), 0.98)
        off = math.log(sh / (1 - sh))
        Xm = Xt if G is None else np.r_[Xt, G]
        m = expit(np.clip(off + Xm @ b, -15, 15))
        phi = math.exp(np.clip(np.array([1.0, lt, fin]) @ g, -4, 8))
        Xp = np.r_[np.array([1.0, np.clip(lmu0 - math.log(cap), -10, 2), lt, fin]), G if G is not None else []]
        pi = expit(Xp @ d)
        return "zibeta", {"pi": pi, "m": m, "phi": phi, "cap": cap}
    Xm = Xt if S["t"] else Xt[:1]
    if G is not None:
        Xm = np.r_[Xm, G]
    if not S["t"]:
        Xk = np.array([1.0])
    elif S["glm"]:
        Xk = np.array([1.0, lt, fin, np.clip(lmu0, -8, 8), 1.0 if R == 5 else 0.0])
    else:
        Xk = np.array([1.0, lt, fin])
    mu = math.exp(np.clip(lmu0 + Xm @ b, -20, 20))
    k = math.exp(np.clip(Xk @ g, -6, 9))
    if S["kind"] == "zinb":
        pi = expit(np.array([1.0, np.clip(lmu0, -8, 8), lt, fin]) @ d)
        return "zinb", {"mu": mu, "k": k, "pi": pi}
    return "nb", {"mu": mu, "k": k}


def row_input(T, i):
    """The exported evaluator's input for table row i (attacker = side T['side'][i])."""
    eta = T["ETA"][i] if T["has_emb"][i] else None
    etao = T["ETAo"][i] if T["has_emb"][i] else None
    oi = [OPP_KEYS.index(k) for k in GLM_OPPADJ]
    return {"ml": T["ML"][i].tolist(), "mlo": T["MLo"][i].tolist(),
            "eta": None if eta is None else eta.tolist(), "etao": None if etao is None else etao.tolist(),
            "has_emb": bool(T["has_emb"][i]), "win_logit": float(T["WINL"][i]),
            "opp": {k: float(np.exp(T["OPP"][i][j])) for k, j in zip(GLM_OPPADJ, oi)},
            "oppo": {k: float(np.exp(T["OPPo"][i][j])) for k, j in zip(GLM_OPPADJ, oi)}, "rounds": int(T["rounds"][i])}


def check_export(T, J, models, rows, tol=1e-6):
    """The exported tables reproduce StatModel.dist (relative tolerance) on sample rows at their actual lengths."""
    J = dict(J, _ti=T["TI"])
    worst = 0.0
    for i in rows:
        inp = row_input(T, i)
        for st in STATS:
            kind, p = py_eval(J, inp, st, float(T["t"][i]))
            d = models[st].dist(np.array([i]), np.array([T["t"][i]]))
            for k, v in p.items():
                ref = float(d.p[k][0])
                worst = max(worst, abs(v - ref) / max(abs(ref), 1e-9))
    assert worst < tol, "export mismatch %.3g" % worst
    return worst


def finite_json(o):
    """Replace non-finite floats (e.g. a rejected CV candidate's infinite log score) by None: strict JSON for JS."""
    if isinstance(o, dict):
        return {k: finite_json(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [finite_json(v) for v in o]
    if isinstance(o, (float, np.floating)):
        return float(o) if np.isfinite(o) else None
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, np.bool_):
        return bool(o)
    return o


def g4(x):
    return None if x is None or not np.isfinite(x) else float("%.4g" % float(x))


def par_list(kind, p, k):
    if kind == "zibeta":
        return [g4(p["m"][k]), g4(p["phi"][k]), g4(p["pi"][k])]
    if kind == "zinb":
        return [g4(p["mu"][k]), g4(p["k"][k]), g4(p["pi"][k])]
    return [g4(p["mu"][k]), g4(p["k"][k])]


# ====================================================================== stage: final (the ONE look at 2024-2025)
def stage_final(args):
    T = load_table()
    F = folds_of(T)
    cv = json.load(open(os.path.join(CACHE, "cv.json")))
    ch = chosen_js(cv)
    for need in ("gate.json", "prereg.json", "cvfit_store.pkl", "winner_oof.json", "cv_eval.json"):
        assert os.path.exists(os.path.join(CACHE, need)), "final needs %s first (selection is finished before the look)" % need
    pre = json.load(open(os.path.join(CACHE, "prereg.json")))
    assert pre["choice_js"] == ch, "choice changed after pre-registration"
    lock = os.path.join(CACHE, "final.lock")
    if os.path.exists(lock) and not args.force_rewrite:
        raise SystemExit("final already ran (%s); the 2024-2025 look is spent. --force-rewrite only re-exports the same "
                         "numbers (same seeds, same code)" % open(lock).read().strip())
    rng = np.random.default_rng(SEED + 2)
    E = load_engine(os.path.join(CACHE, "engine_v4.json"))
    tr, te = F["valid"]
    rtr, rte = np.flatnonzero(tr), np.flatnonzero(te)
    assert T["date"][rte].max() < VAULT_FROM and T["date"][rtr].max() < VALID[0]
    Fd = Fold(T, tr)
    models = fit_set(T, Fd, rtr, ch)
    nbb = fit_set(T, Fd, rtr, {st: "nb_base" for st in STATS})
    ev = eval_fold(T, Fd, models, nbb, rte, rng)
    R = {"choice_js": ch, "prereg": pre}
    R.update(report_block(T, rte, ev, "2024-2025 (scored once; models fit on 2019-2023)"))
    R["engine"] = engine_compare(T, ev, rte, E, boot_for, "2024-2025 (engine v4 params tuned on 2019-2023; clean)")
    print_report(R)
    # winner expert on 2024-2025 (static: fit 2019-2023) and the gate stacks, reported as confirmation only
    wl_oof = json.load(open(os.path.join(CACHE, "winner_oof.json")))
    wlv = winner_logits(T, rte, lambda st, rr, tt: models[st].dist(rr, tt).mean())
    gate = json.load(open(os.path.join(CACHE, "gate.json")))
    m2 = M2()
    D = expert_D(wl_oof, wlv)
    y, yr = D["y"].to_numpy(float), D["year"].to_numpy()
    rows_of = {"line": D["market"].notna().to_numpy(), "noline": np.ones(len(D), bool), "open": D["open"].notna().to_numpy()}
    va = (yr >= 2024) & (yr <= 2025)
    W = {}
    for key, g in gate["gate"].items():
        regime, nm = key.split("|", 1)
        base = nm.replace(" + statlines", "")
        mm = rows_of[regime] & va
        pr = {}
        for k2 in (regime + "|" + base, key):
            s = gate["sets"][k2]
            pr[k2], _ = m2.stack_predict(D, s["cols"], "static", s["chosen_h"], 2023, mm, rows_of[regime])
        W[key + " vs base (2024-2025, static fit <= 2023)"] = dict(m2.compare(pr[key], pr[regime + "|" + base], y[mm],
                                                                                D["event"].to_numpy()[mm]),
                                                                     entered_by_cv=g["enters"])
        log("2024-25 %-44s %s (entered by CV: %s)" % (key, W[key + " vs base (2024-2025, static fit <= 2023)"], g["enters"]))
    zz = D["statlines_static"].to_numpy(float)
    mv = va & np.isfinite(zz)
    W["expert_alone_2024_2025"] = {"n": int(mv.sum()), "ll": r5(m2.ll(zz[mv], y[mv])),
                                   "acc": r5(float(np.mean((zz[mv] > 0.5) == (y[mv] == 1))))}
    R["winner"] = W
    # exports: dev (fit 2019-2023) and production (fit 2019-2025, the same pre-registered procedure; deployment)
    J_dev = export_set(Fd, models, "2019-01-01..2023-12-31")
    smp = rte[np.random.default_rng(5).choice(len(rte), 40, replace=False)]
    R["export_check_dev"] = check_export(T, J_dev, models, smp)
    yrall = T["year"]
    trp = (yrall >= FIRST_YEAR) & (yrall <= 2025)
    Fdp = Fold(T, trp)
    mp = fit_set(T, Fdp, np.flatnonzero(trp), ch)
    J_prod = export_set(Fdp, mp, "2019-01-01..2025-12-31")
    R["export_check_prod"] = check_export(T, J_prod, mp, smp)
    R["swap_test"] = swap_test(T, J_dev)
    write_exports(T, cv, ch, J_dev, J_prod, R, ev, rte, wl_oof, wlv)
    json.dump(R, open(os.path.join(CACHE, "final_eval.json"), "w"), indent=1, default=float)
    open(lock, "w").write("final ran %s UTC" % dt.datetime.utcnow().strftime("%Y-%m-%d %H:%M"))
    log("final done")


def write_exports(T, cv, ch, J_dev, J_prod, R, ev, rte, wl_oof, wlv):
    cvs = pickle.load(open(os.path.join(CACHE, "cvfit_store.pkl"), "rb"))
    cve = json.load(open(os.path.join(CACHE, "cv_eval.json")))
    gate = json.load(open(os.path.join(CACHE, "gate.json")))
    kinds = {st: J_dev["stats"][st]["kind"] for st in STATS}
    # ---------------------------------------------------------------- OOF table
    fights = {}

    def put(rows, evd, set_name):
        for k, i in enumerate(rows):
            f = T["fid"][i]
            e = fights.setdefault(f, {"date": T["date"][i], "set": set_name, "t": round(float(T["t"][i]), 4),
                                      "R": int(T["rounds"][i])})
            o = {}
            for st in STATS:
                p = evd[st]["chosen"]["par"]
                um = evd[st].get("chosen_mix", {}).get("mean")
                o[st] = par_list(kinds[st], p, k) + [g4(um[k]) if um is not None else None]
            e["AB"[T["side"][i]]] = o
    o20 = cvs["oof20"]
    put(o20["rows"], o20["ev"], "cv2020")
    put(cvs["rows"], cvs["ev"], "cv")
    put(rte, ev, "valid")
    for f, e in fights.items():
        z = wl_oof.get(f) if e["set"] != "valid" else wlv.get(f)
        e["p_dom"] = None if z is None else g4(1 / (1 + math.exp(-z)))
    dates = {f: d for f, d in zip(T["fid"], T["date"])}
    for f, z in wl_oof.items():           # 2019 fights: winner expert only (no second-stage distribution row)
        if f not in fights and z is not None:
            fights[f] = {"date": dates[f], "set": "raw2019", "p_dom": g4(1 / (1 + math.exp(-z)))}
    assert max(e["date"] for e in fights.values()) < VAULT_FROM
    oof = {"meta": {"tool": TOOL_VERSION, "built": dt.datetime.utcnow().isoformat() + "Z",
                    "what": "walk-forward predictive stat-line distributions per fight-side (attacker = A or B) at the "
                            "fight's ACTUAL length t, plus the unconditional mean (mixture over the methodround S "
                            "fight-length distribution; backtest fights only)",
                    "sets": {"cv2020": "2020 fights, second stage trained on 2019 only (blend refit on 2019)",
                             "cv": "2021-2023 forward-chained CV folds (trained 2019..Y-1)",
                             "valid": "2024-2025, trained 2019-2023 (dev model); scored once",
                             "raw2019": "2019 fights: p_dom only (from raw mlrates OOF rates; no earlier row to fit on)"},
                    "stats": STATS, "kinds": kinds,
                    "fields": "per stat: nb -> [mu, k, uncond_mean]; zinb -> [mu, k, pi, uncond_mean]; zibeta (control "
                              "seconds) -> [m, phi, pi, uncond_mean] with share s = y / (60 t) ~ Beta(m phi, (1 - m) phi) "
                              "and P(0) = pi; NB2 variance mu + mu^2 / k; zinb P(0) = pi + (1 - pi) NB(0)",
                    "p_dom": "statlines winner expert P(A wins) = sigmoid(%g x (dominance A - dominance B)), dominance "
                             "from expected unconditional totals with the engine's judging weights %s; 2019 rows from raw "
                             "mlrates OOF rates (no second stage), 2020 y2020 fold" % (DOM_SCALE, json.dumps(DOM_W)),
                    "rule": "2026 fights dropped at load; never fit or scored"},
           "fights": fights}
    json.dump(finite_json(oof), open(os.path.join(DER, "statlines_oof.json"), "w"), separators=(",", ":"), allow_nan=False)
    # ---------------------------------------------------------------- model + evaluation tables
    small = lambda blk: {k: v for k, v in blk.items() if k != "per_stat"}
    doc = {"meta": {"tool": TOOL_VERSION, "built": dt.datetime.utcnow().isoformat() + "Z", "inputs": T["inputs"],
                    "protocol": "fights dated 2026-01-01+ dropped at load; selection by forward-chained CV 2021-2023 "
                                "(fit 2019..Y-1); 2024-2025 scored once (fit 2019-2023); production refit 2019-2025 by "
                                "the same procedure (deployment, never scored)",
                    "report": "research/model_statlines.md", "evaluator": "src/ml/statdist.js"},
           "stats": STATS, "labels": LABEL, "mlrates_targets": MLT, "glm_names": GLM_NAMES, "glm_oppadj": GLM_OPPADJ,
           "glm_extra": ["fin*win_logit", "fin*own_sig_lnd", "fin*opp_sig_lnd"],
           "embed_tasks": T["tasks"], "finish_time": T["finish_time"], "dom": {"w": DOM_W, "scale": DOM_SCALE},
           "choice_js": ch, "choice_all": cv["choice"], "selection_rule": cv["rule"],
           "models": {"dev": J_dev, "prod": J_prod},
           "eval": {"cv_2021_2023": cve, "valid_2024_2025": {k: v for k, v in R.items() if k not in ("prereg",)}},
           "gate": gate,
           "cv_candidates": {st: {n: {k: v for k, v in r.items() if k in ("nll", "crps", "dev", "by_year")}
                                  for n, r in cv["per_stat"][st].items()} for st in STATS}}
    json.dump(finite_json(doc), open(os.path.join(DER, "statlines.json"), "w"), separators=(",", ":"), allow_nan=False)
    log("wrote data/derived/statlines.json and statlines_oof.json (%d fights)" % len(fights))


# ====================================================================== stage: fixtures (JS parity)
def stage_fixtures(args):
    T = load_table()
    J = json.load(open(os.path.join(DER, "statlines.json")))
    rng = np.random.default_rng(3)
    cases = []
    idx = list(rng.choice(len(T["fid"]), 24, replace=False))
    idx += [int(np.flatnonzero(~T["has_emb"])[0]), int(np.flatnonzero(T["rounds"] == 5)[0])]
    for which in ("dev", "prod"):
        Jm = dict(J["models"][which], _ti={t: i for i, t in enumerate(J["embed_tasks"])})
        for i in idx[:14] if which == "prod" else idx:
            inp = row_input(T, i)
            for t in (float(T["t"][i]), 2.5, 15.0 if T["rounds"][i] == 3 else 25.0):
                out = {}
                for st in STATS:
                    kind, p = py_eval(Jm, inp, st, t)
                    d = Dist(kind, **{k: np.array([v]) for k, v in p.items()})
                    y = T["Y"][i, SI[st]]
                    grid = np.array([[0, 1, 3, int(y), int(d.mean()[0])]])
                    out[st] = {"kind": kind, "p": {k: float(v) for k, v in p.items()}, "mean": float(d.mean()[0]),
                               "var": float(d.var()[0]), "y": float(y), "logpmf_y": float(d.logpmf(np.array([y]))[0]),
                               "cdf": {str(int(g)): float(c) for g, c in zip(grid[0], d.cdf(grid)[0])}}
                cases.append({"which": which, "row": int(i), "input": inp, "t": t, "out": out})
    # mixture fixtures: unconditional mean / quantiles for a few backtest rows (dev models)
    mixes = []
    Jm = dict(J["models"]["dev"], _ti={t: i for i, t in enumerate(J["embed_tasks"])})
    bt_rows = [i for i in idx if T["fid"][i] in T["cells"]][:6]
    for i in bt_rows:
        inp = row_input(T, i)
        G = length_grid(T, [i])
        R = int(T["rounds"][i])
        pos, tg, W = G[R]
        o = {}
        for st in ("sig_lnd", "td_lnd", "ctrl", "kd"):
            Fm, mean = None, 0.0
            Jmax = 1502 if st == "ctrl" else 400
            for tp, w in zip(tg, W[0]):
                kind, p = py_eval(Jm, inp, st, float(tp))
                d = Dist(kind, **{k: np.array([v]) for k, v in p.items()})
                c = d.cdf(np.arange(Jmax)[None, :])[0] * w
                Fm = c if Fm is None else Fm + c
                mean += w * d.mean()[0]
            o[st] = {"mean": float(mean), "q10": int((Fm >= 0.1).argmax()), "q50": int((Fm >= 0.5).argmax()),
                     "q90": int((Fm >= 0.9).argmax())}
        mixes.append({"row": int(i), "input": inp, "S": T["cells"][T["fid"][i]]["S"], "rounds": R, "out": o})
    path = os.path.join(ROOT, "tests", "fixtures", "statdist_fixtures.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump({"meta": {"tool": TOOL_VERSION, "statlines_sha": sha_file(os.path.join(DER, "statlines.json"))},
               "cases": cases, "mixtures": mixes}, open(path, "w"), separators=(",", ":"))
    log("wrote %s (%d cases, %d mixtures)" % (path, len(cases), len(mixes)))


# ====================================================================== stage: prereg (freeze choices before final)
def stage_prereg(args):
    cv = json.load(open(os.path.join(CACHE, "cv.json")))
    gate = json.load(open(os.path.join(CACHE, "gate.json")))
    p = os.path.join(CACHE, "prereg.json")
    if os.path.exists(p):
        raise SystemExit("prereg.json exists; the choices are frozen")
    doc = {"written": dt.datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"), "choice_js": cv["choice_js"],
           "choice_all": cv["choice"], "selection_rule": cv["rule"],
           "winner_expert_enters": {k: v["enters"] for k, v in gate["gate"].items()},
           "primary": "per-stat conditional log score (NLL per fight-side) of the chosen model vs nb_base (the "
                      "mlrates + embedding blend mean with one NB shape) and vs pois_base (the same mean, Poisson); "
                      "Poisson deviance of the mean vs pois_base (blend) and pois_mlraw (mlrates alone); PIT in80 "
                      "target 0.80 +- 0.02; engine v4 comparison (distance-only CRPS / PIT; unconditional CRPS / PIT; "
                      "conditional-mean deviance) descriptive",
           "decision": "the stat-line model ships as the distributional layer if its 2024-2025 conditional NLL is not "
                       "worse than nb_base on any stat beyond the CI and PIT in80 stays within 0.78-0.82 on the large "
                       "counts; nothing is re-selected on 2024-2025"}
    json.dump(doc, open(p, "w"), indent=1)
    log("wrote %s" % p)


# ====================================================================== stage: tables (markdown for the research note)
def _ci(c, d=3):
    return "n/a" if c is None else "%+.*f [%+.*f, %+.*f]" % (d, c[0], d, c[1], d, c[2])


def _pct(x):
    return "%.3f" % x if x is not None else "n/a"


def md_tables(R, title):
    L = ["### %s" % title, "",
         "Conditional on the actual fight length t (all fight-sides in the window: %d; backtest universe, both men with a "
         "prior UFC fight: %d). NLL = log score per fight-side (nats); dev = Poisson deviance of the mean; in80 = share "
         "of randomized PITs inside [0.1, 0.9] (target 0.80); CIs: 2,000 event-cluster resamples, paired." % (
             R["n_rows"], R["n_both_prior"]), "",
         "| stat | chosen | NLL chosen | NLL nb_base | NLL Poisson(blend) | NLL diff vs nb_base | dev chosen | dev blend | dev mlrates | dev diff vs blend | dev % vs blend | in80 | >P90 | <P10 |",
         "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for st in STATS:
        r = R["per_stat"][st]
        a = r["all"]
        L.append("| %s | %s | %.4f | %.4f | %.3f | %s | %.3f | %.3f | %.3f | %s | %+.2f%% | %.3f | %.3f | %.3f |" % (
            st, R["choice_js"][st], a["chosen"]["nll"], a["nb_base"]["nll"], a["pois_base"]["nll"],
            _ci(r["chosen - nb_base|nll"], 4), a["chosen"]["dev"], a["pois_base"]["dev"], a["pois_mlraw"]["dev"],
            _ci(r["chosen - pois_base|dev"]), r["dev_rel|chosen vs pois_base"], a["chosen"]["pit_in80"],
            a["chosen"]["pit_above90"], a["chosen"]["pit_below10"]))
    L += ["", "Interval calibration of the comparators (same rows): in80 of Poisson(blend) / nb_base / chosen.", "",
          "| stat | Poisson(blend) in80 | nb_base in80 | chosen in80 | chosen naive 10-90% band hit | chosen MAE of median | nb_base MAE of median |",
          "|---|---|---|---|---|---|---|"]
    for st in STATS:
        a = R["per_stat"][st]["all"]
        L.append("| %s | %.3f | %.3f | %.3f | %.3f | %.3f | %.3f |" % (st, a["pois_base"]["pit_in80"], a["nb_base"]["pit_in80"],
                                                              a["chosen"]["pit_in80"], a["chosen"]["band80_naive"],
                                                              a["chosen"]["mae_median"], a["nb_base"]["mae_median"]))
    E = R.get("engine")
    if E:
        L += ["", "Engine %s (%s)." % (E["meta"]["engine"], E["meta"]["years"]), "",
              "Conditional mean at the actual length (engine: rate-based mean, simulated totals / simulated minutes x t) "
              "and fights that went the distance (engine: only its simulations that went the distance; ours at t = 5R):", "",
              "| stat | n | dev engine | dev chosen | diff chosen - engine | distance n | CRPS engine | CRPS chosen | CRPS diff | in80 engine | in80 chosen | >P90 engine | >P90 chosen |",
              "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
        for st in STATS:
            e = E[st]
            dd = e["dist"]
            L.append("| %s | %d | %.3f | %.3f | %s | %d | %.3f | %.3f | %s | %.3f | %.3f | %.3f | %.3f |" % (
                st, e["n_cond"], e["cond_mean_dev|engine"], e["cond_mean_dev|chosen"], _ci(e["cond_mean_dev|chosen - engine"]),
                dd["n"], dd["engine"]["crps"], dd["chosen"]["crps"], _ci(dd["crps|chosen - engine"]),
                dd["engine"]["pit_in80"], dd["chosen"]["pit_in80"], dd["engine"]["pit_above90"], dd["chosen"]["pit_above90"]))
        L += ["", "Unconditional lines (no length given): engine's full simulated distribution vs our mixture over the "
                  "methodround S fight-length grid; dev is the evalv-style deviance of the unconditional mean:", "",
              "| stat | n | CRPS engine | CRPS ours | CRPS diff | dev engine | dev ours | dev diff | in80 engine | in80 ours | >P90 engine | >P90 ours | <P10 engine | <P10 ours | NLL ours | NLL Poisson(blend) mix |",
              "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
        for st in STATS:
            u = E[st].get("uncond")
            if not u:
                continue
            L.append("| %s | %d | %.3f | %.3f | %s | %.3f | %.3f | %s | %.3f | %.3f | %.3f | %.3f | %.3f | %.3f | %.4f | %.3f |" % (
                st, u["n"], u["engine"]["crps"], u["chosen_mix"]["crps"], _ci(u["crps|chosen_mix - engine"]),
                u["engine"]["dev"], u["chosen_mix"]["dev"], _ci(u["dev|chosen_mix - engine"]), u["engine"]["pit_in80"],
                u["chosen_mix"]["pit_in80"], u["engine"]["pit_above90"], u["chosen_mix"]["pit_above90"],
                u["engine"]["pit_below10"], u["chosen_mix"]["pit_below10"], u["chosen_mix"]["nll"], u["pois_base_mix"]["nll"]))
        L += ["", "PIT histograms (10 bins, counts) for key stats:", "", "| stat | model | histogram |", "|---|---|---|"]
        for st in ("sig_lnd", "sig_att", "td_att", "td_lnd", "ctrl", "kd", "sub_att"):
            e = E[st]
            L.append("| %s | ours, given t (all rows) | %s |" % (st, " ".join(map(str, R["per_stat"][st]["all"]["chosen"]["pit_hist10"]))))
            L.append("| %s | Poisson(blend), given t | %s |" % (st, " ".join(map(str, R["per_stat"][st]["all"]["pois_base"]["pit_hist10"]))))
            L.append("| %s | engine, distance only | %s |" % (st, " ".join(map(str, e["dist"]["engine"]["pit_hist10"]))))
            L.append("| %s | ours, distance only | %s |" % (st, " ".join(map(str, e["dist"]["chosen"]["pit_hist10"]))))
            if e.get("uncond"):
                L.append("| %s | engine, unconditional | %s |" % (st, " ".join(map(str, e["uncond"]["engine"]["pit_hist10"]))))
                L.append("| %s | ours, unconditional | %s |" % (st, " ".join(map(str, e["uncond"]["chosen_mix"]["pit_hist10"]))))
    return "\n".join(L)


def stage_tables(args):
    cv = json.load(open(os.path.join(CACHE, "cv.json")))
    L = ["### CV candidates (2021-2023 pooled NLL per fight-side; selection rule: %s)" % cv["rule"], "",
         "| stat | " + " | ".join(["pois_base", "nb_base", "nb_t", "nb_glm_l30", "nb_glm_l300", "nb_glm_l3000",
                                   "nb_glm_l10000", "nb_glm_l30000", "nb_gbm", "zinb_t", "zinb_glm_l300", "zibeta_t",
                                   "zibeta_glm_l300"]) + " | chosen (JS) | chosen (any) |",
         "|---" * 16 + "|"]
    for st in STATS:
        r = cv["per_stat"][st]
        cells = []
        for n in ("pois_base", "nb_base", "nb_t", "nb_glm_l30", "nb_glm_l300", "nb_glm_l3000", "nb_glm_l10000",
                  "nb_glm_l30000", "nb_gbm", "zinb_t", "zinb_glm_l300", "zibeta_t", "zibeta_glm_l300"):
            cells.append(("%.4f" % r[n]["nll"]) if n in r else "")
        L.append("| %s | %s | %s | %s |" % (st, " | ".join(cells), cv["choice_js"][st], cv["choice"][st]))
    print("\n".join(L) + "\n")
    p = os.path.join(CACHE, "cv_eval.json")
    if os.path.exists(p):
        print(md_tables(json.load(open(p)), "Forward-chained CV years 2021-2023") + "\n")
    p = os.path.join(CACHE, "gate.json")
    if os.path.exists(p):
        G = json.load(open(p))
        L = ["### Winner expert: forward-chained stack gate (2021-2023)", "",
             "Expert alone on 2019-2023 (walk-forward): log loss %.4f, accuracy %.3f (n %d)." % (
                 G["expert_alone_2019_2023"]["ll"], G["expert_alone_2019_2023"]["acc"], G["expert_alone_2019_2023"]["n"]), "",
             "| stack | CV base | CV + statlines | gain | enters (gain < -0.0005) | statlines weight (fit <= 2023) | paired CV-years diff [CI] |",
             "|---|---|---|---|---|---|---|"]
        for k, g in G["gate"].items():
            pc = G["paired_cv_years"][k + " vs base"]
            L.append("| %s | %.5f | %.5f | %+.5f | %s | %.3f | %+.5f [%+.4f, %+.4f] |" % (
                k, g["cv_base"], g["cv_plus"], g["gain"], "yes" if g["enters"] else "no", g["statlines_weight"],
                pc["diff"], pc["diff_ci"][0], pc["diff_ci"][1]))
        print("\n".join(L) + "\n")
    p = os.path.join(CACHE, "final_eval.json")
    if os.path.exists(p):
        F = json.load(open(p))
        print(md_tables(F, "2024-2025 confirmation (scored once; fit 2019-2023)") + "\n")
        L = ["### Winner expert on 2024-2025 (confirmation only)", "", "| comparison | n | a | b | diff [CI] | entered by CV |",
             "|---|---|---|---|---|---|"]
        for k, v in F["winner"].items():
            if k.startswith("expert_alone"):
                continue
            L.append("| %s | %d | %.5f | %.5f | %+.5f [%+.4f, %+.4f] | %s |" % (k, v["n"], v["a"], v["b"], v["diff"],
                                                                         v["diff_ci"][0], v["diff_ci"][1], v["entered_by_cv"]))
        ea = F["winner"]["expert_alone_2024_2025"]
        L.append("")
        L.append("Expert alone 2024-2025: log loss %.4f, accuracy %.3f (n %d)." % (ea["ll"], ea["acc"], ea["n"]))
        print("\n".join(L))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("stage")
    ap.add_argument("--stats", default="")
    ap.add_argument("--tag", default="")
    ap.add_argument("--skip-gbm", action="store_true")
    ap.add_argument("--force-rewrite", action="store_true")
    args = ap.parse_args()
    STAGES[args.stage](args)


STAGES = {"build": stage_build, "cv": stage_cv, "actuals": stage_actuals, "cvfit": stage_cvfit, "gate": stage_gate,
          "prereg": stage_prereg, "final": stage_final, "fixtures": stage_fixtures, "tables": stage_tables}

if __name__ == "__main__":
    main()
