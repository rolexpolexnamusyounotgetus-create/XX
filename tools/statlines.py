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
    nice -n 5 python3 tools/statlines.py engine     # score the engine's realised lines (needs tools/statlines_engine.js output)
    nice -n 5 python3 tools/statlines.py winner     # stat-line winner expert + forward-chained stack gate (2021-2023)
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
    T["event"] = np.array([bt[f]["event"] if f in bt else d for f, d in zip(T["fid"], T["date"])], dtype=object)
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
        F = sub.cdf(g)
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
    for lam in (30.0, 300.0, 3000.0):
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
               "nb_t -> best nb_glm (ridge 3/30/300) -> nb_gbm, and for sparse stats also the zero-inflated versions "
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("stage")
    ap.add_argument("--stats", default="")
    ap.add_argument("--tag", default="")
    ap.add_argument("--skip-gbm", action="store_true")
    args = ap.parse_args()
    STAGES[args.stage](args)


STAGES = {"build": stage_build, "cv": stage_cv}

if __name__ == "__main__":
    main()
