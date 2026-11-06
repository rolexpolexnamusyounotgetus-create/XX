#!/usr/bin/env python3
"""Adversarial verification of tools/statlines.py (reviewer's tool; does not change the model or its outputs).

    nice -n 5 python3 tools/statlines_verify.py            # all parts (about 1-2 minutes); writes data/derived/statlines_verify.json
    nice -n 5 python3 tools/statlines_verify.py targets    # one part: targets | inputs | repro | engine | gate

Needs the builder's caches (out/statlines_cache/table.pkl and engine_v4.json, out/mlrates_cache/dataset.pkl,
out/ml2_cache/stack.pkl). Nothing here imports tools/statlines.py.

targets  Re-parses data/raw/ufc_fight_stats.csv / ufc_fight_results.csv / ufc_event_details.csv from scratch (2026 dropped
         at parse; a fight listed under two event names counted once) and compares the 20 per-fighter totals, the minutes
         and the scheduled rounds with the builder's table; lists 2019-2025 raw bouts missing from the table.
inputs   Recomputes every joined input from the raw JSON files (mlrates_oof.json, embed.json quarter matrices -> eta,
         win logit, oppadj.json, methodround.json S cells) and checks timing (embedding snapshot = latest quarterly refit
         dated on or before the fight; S fit_through < fight date) and the universe overlaps.
repro    Independent re-implementation of the second stage: the mlrates + embedding blend refit with statsmodels GLMs
         per fold, NB2 with covariate-dependent shape and the zero-inflated Beta with own scipy code. Reports, per stat,
         the log-score decomposition chosen - nb_base = (nb_t - nb_base) [time terms: log t, finished, finished x log t,
         five rounds] + (chosen - nb_t) [the ridge GLM], coverage, mean deviance, and the control log score with the
         exact 1-second bin mass instead of the density approximation. CIs: 2,000 card-level cluster resamples (one key
         per card, see the clustering note in research/model_statlines.md, Verification log).
engine   From the committed data/derived/statlines_oof.json and the builder's engine_v4.json: unconditional deviance and
         evalv-style MAE of the unconditional mean (the v8 acceptance metric), and the deviance comparison restricted to
         fights that went the distance (the only subset where engine and model condition on the same information).
gate     Re-runs the forward-chained 2021-2023 stack gate with tools/ml2.py's stack_predict / compare / SEL_MIN, reading
         the expert from the committed statlines_oof.json (p_dom, 2019-2023 only), plus a free-intercept check.
"""
import os

for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "1")
import csv
import datetime as dt
import json
import math
import pickle
import re
import sys
import time

import numpy as np
from scipy.optimize import minimize
from scipy.special import betainc, betaln, digamma, expit, gammaln

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW = os.path.join(ROOT, "data", "raw")
DER = os.path.join(ROOT, "data", "derived")
SLC = os.path.join(ROOT, "out", "statlines_cache")
VAULT = "2026-01-01"
STATS = ["sig_att", "sig_lnd", "h_att", "h_lnd", "b_att", "b_lnd", "l_att", "l_lnd", "d_att", "d_lnd", "c_att", "c_lnd",
         "g_att", "g_lnd", "kd", "td_att", "td_lnd", "ctrl", "sub_att", "rev"]
COL = {s: i for i, s in enumerate(STATS)}
OUT = {}


def r4(x):
    return None if x is None or not np.isfinite(x) else round(float(x), 4)


def boot_ci(v, groups, B=2000, seed=99):
    keys, inv = np.unique(groups, return_inverse=True)
    G = len(keys)
    s = np.bincount(inv, weights=v, minlength=G)
    c = np.bincount(inv, minlength=G).astype(float)
    rng = np.random.default_rng(seed)
    bm = np.empty(B)
    for i in range(B):
        w = np.bincount(rng.integers(0, G, G), minlength=G)
        bm[i] = (w @ s) / (w @ c)
    return [r4(v.mean()), r4(np.percentile(bm, 2.5)), r4(np.percentile(bm, 97.5))]


def fmt(c):
    return "%+.4f [%+.4f, %+.4f]" % tuple(c)


def load_T():
    return pickle.load(open(os.path.join(SLC, "table.pkl"), "rb"))


def card_keys(T):
    """One cluster key per card: the backtest event name, also for the non-backtest (debut) rows on the same date."""
    bt = [f for f in json.load(open(os.path.join(DER, "backtest_dev.json")))["fights"] if f["date"] < VAULT]
    ev = {}
    for f in bt:
        ev.setdefault(f["date"], set()).add(f["event"])
    assert all(len(v) == 1 for v in ev.values())
    return np.array([next(iter(ev[d])) if d in ev else d for d in T["date"]], dtype=object)


# ====================================================================== targets
def parse_raw():
    norm = lambda s: re.sub(r"\s+", " ", (s or "").strip())
    ev_date = {norm(r["EVENT"]): dt.datetime.strptime(r["DATE"].strip(), "%B %d, %Y").date().isoformat()
               for r in csv.DictReader(open(os.path.join(RAW, "ufc_event_details.csv"), encoding="utf-8"))}
    url_of = {(norm(r["EVENT"]), norm(r["BOUT"])): r["URL"].strip().rsplit("/", 1)[-1]
              for r in csv.DictReader(open(os.path.join(RAW, "ufc_fight_details.csv"), encoding="utf-8"))}
    fights = {}
    for r in csv.DictReader(open(os.path.join(RAW, "ufc_fight_results.csv"), encoding="utf-8")):
        d = ev_date.get(norm(r["EVENT"]))
        if d is None or d >= VAULT:
            continue
        fid = r["URL"].strip().rsplit("/", 1)[-1]
        m, s = r["TIME"].strip().split(":")
        fmt_ = r["TIME FORMAT"].strip()
        fights[fid] = {"date": d, "minutes": 5 * (int(r["ROUND"]) - 1) + int(m) + int(s) / 60.0,
                       "rounds": 5 if fmt_.startswith("5 Rnd") else (3 if fmt_.startswith("3 Rnd") else None),
                       "names": tuple(norm(x) for x in norm(r["BOUT"]).split(" vs. ")), "A": None, "B": None}

    def of(x):
        x = x.strip()
        if x in ("", "---"):
            return 0, 0
        a, b = x.split(" of ")
        return int(a), int(b)

    def ctrl(x):
        x = x.strip()
        if x in ("", "--", "---"):
            return 0
        m, s = x.split(":")
        return int(m) * 60 + int(s)
    acc, seen, ndup = {}, set(), 0
    for r in csv.DictReader(open(os.path.join(RAW, "ufc_fight_stats.csv"), encoding="utf-8")):
        fid = url_of.get((norm(r["EVENT"]), norm(r["BOUT"])))
        if fid is None or fid not in fights or not r["ROUND"].strip().startswith("Round"):
            continue
        nm = norm(r["FIGHTER"])
        k2 = (fid, r["ROUND"].strip(), nm)
        if k2 in seen:                       # same fight listed under two event names (renamed cards)
            ndup += 1
            continue
        seen.add(k2)
        a, b = fights[fid]["names"]
        side = "A" if nm == a else ("B" if nm == b else None)
        if side is None:
            continue
        e = acc.setdefault((fid, side), {k: 0 for k in STATS})
        for c, p in (("HEAD", "h"), ("BODY", "b"), ("LEG", "l"), ("DISTANCE", "d"), ("CLINCH", "c"), ("GROUND", "g")):
            l, at = of(r[c])
            e[p + "_lnd"] += l
            e[p + "_att"] += at
        l, at = of(r["SIG.STR."]); e["sig_lnd"] += l; e["sig_att"] += at
        l, at = of(r["TD"]); e["td_lnd"] += l; e["td_att"] += at
        e["kd"] += int(float(r["KD"] or 0)); e["sub_att"] += int(float(r["SUB.ATT"] or 0)); e["rev"] += int(float(r["REV."] or 0))
        e["ctrl"] += ctrl(r["CTRL"])
    for (fid, side), e in acc.items():
        fights[fid][side] = e
    return fights, ndup


def part_targets(T):
    F, ndup = parse_raw()
    mis, miss, tmis, rmis = {}, 0, 0, 0
    for i, (f, s) in enumerate(zip(T["fid"], T["side"])):
        r = F.get(f)
        if r is None or r["AB"[s]] is None:
            miss += 1
            continue
        for j, st in enumerate(STATS):
            if abs(r["AB"[s]][st] - T["Y"][i, j]) > 1e-9:
                mis[st] = mis.get(st, 0) + 1
        tmis += abs(r["minutes"] - T["t"][i]) > 1e-6
        rmis += r["rounds"] != T["rounds"][i]
    ids = set(T["fid"])
    notin = [f for f, r in F.items() if "2019-01-01" <= r["date"] < VAULT and f not in ids]
    OUT["targets"] = {"rows": int(len(T["fid"])), "missing_in_raw": miss, "stat_mismatches": mis, "minutes_mismatches": int(tmis),
                      "rounds_mismatches": int(rmis), "raw_2019_2025_bouts_not_in_table": len(notin),
                      "duplicate_listing_rows_skipped": ndup}
    print("targets:", OUT["targets"])
    return F


# ====================================================================== inputs
def part_inputs(T):
    ds = pickle.load(open(os.path.join(ROOT, "out", "mlrates_cache", "dataset.pkl"), "rb"))
    rowof = {r["id"]: r for r in ds["rows"]}
    oof = json.load(open(os.path.join(DER, "mlrates_oof.json")))["fights"]
    emb = json.load(open(os.path.join(DER, "embed.json")))
    Q, divs, snaps = emb["quarters"], emb["model"]["divs"], emb["snapshots"]
    didx = {d: i for i, d in enumerate(divs)}
    opp = json.load(open(os.path.join(DER, "oppadj.json")))["snapshots"]
    mr = json.load(open(os.path.join(DER, "methodround.json")))["fights"]
    K = np.array(Q[0]["W"]).shape[1]
    bad = {}
    add = lambda k: bad.__setitem__(k, bad.get(k, 0) + 1)
    for i, (f, s) in enumerate(zip(T["fid"], T["side"])):
        X, Yk = ("A", "B") if s == 0 else ("B", "A")
        if not (np.allclose(T["ML"][i], oof[f][X]) and np.allclose(T["MLo"][i], oof[f][Yk])):
            add("mlrates")
        sn, r = snaps.get(f), rowof[f]
        if sn:
            q = sn["q"]
            ok_q = [k for k, qq in enumerate(Q) if qq["T"] <= r["date"]]
            if not Q[q]["T"] <= r["date"]:
                add("snapshot_after_fight")
            elif max(ok_q) != q:
                add("snapshot_not_latest")
            dv = didx.get(r["division"], didx.get(r["prior_division"], didx["Lightweight"]))
            era = (dt.date.fromisoformat(r["date"]).toordinal() - dt.date(2015, 1, 1).toordinal()) / 3652.5
            C = np.array(Q[q]["C"])
            z = np.zeros(C.shape[1]); z[0] = 1; z[1 + dv] = 1; z[-2] = era; z[-1] = 1.0 if r["rounds"] == 5 else 0.0
            eta = C @ z + np.array(Q[q]["W"]) @ np.array(sn[X])[:K] + np.array(Q[q]["V"]) @ np.array(sn[Yk])[K:]
            if not np.allclose(eta, T["ETA"][i]):
                add("eta")
            if abs((sn["win_logit"] if s == 0 else -sn["win_logit"]) - T["WINL"][i]) > 1e-12:
                add("win_logit")
        elif T["has_emb"][i]:
            add("emb_flag")
        if f not in opp and np.any(T["OPP"][i] != 0):
            add("oppadj")
        if f in mr and mr[f].get("S") and mr[f]["fit_through"] >= r["date"]:
            add("S_fit_after_fight")
    bp = T["both_prior"]
    OUT["inputs"] = {"mismatches": bad, "both_prior_rows": int(bp.sum()), "has_emb_rows": int(T["has_emb"].sum()),
                     "both_prior_without_S": int(sum(1 for i, f in enumerate(T["fid"]) if bp[i] and f not in T["cells"])),
                     "both_prior_without_oppadj": int(sum(1 for i, f in enumerate(T["fid"]) if bp[i] and f not in opp)),
                     "both_prior_not_backtest": int(sum(1 for i, f in enumerate(T["fid"]) if bp[i] != (f in T["bt_ids"]))),
                     "methodround_json_rows_dated_2026": int(sum(1 for v in mr.values() if v["date"] >= VAULT)),
                     "oppadj_json_snapshots_for_2026_fights": int(sum(1 for f in opp if f in mr and mr[f]["date"] >= VAULT))}
    print("inputs:", OUT["inputs"])


# ====================================================================== repro
MLT = ["d_att", "c_att", "g_att", "h_att", "b_att", "l_att", "td_att", "sub_att", "rev", "ctrl", "acc_h", "acc_b", "acc_l",
       "acc_d", "acc_c", "acc_g", "td_acc", "kd_h"]
ACC = {"acc_h": "h", "acc_b": "b", "acc_l": "l", "acc_d": "d", "acc_c": "c", "acc_g": "g", "td_acc": "td"}
TASK = {"acc_h": "h_acc", "acc_b": "b_acc", "acc_l": "l_acc", "acc_d": "d_acc", "acc_c": "c_acc", "acc_g": "g_acc", "kd_h": "kd"}
GLM_OPPADJ = ["dAtt", "cAtt", "gAtt", "tdAtt", "ctrl", "dAttAg", "cAttAg", "gAttAg", "tdAttAg", "octrl"]
OPP_KEYS = ["dAtt", "dAttAg", "cAtt", "cAttAg", "gAtt", "gAttAg", "tdAtt", "tdAttAg", "tdAcc", "tdAccAg", "ctrl", "octrl",
            "topSkill", "escWeak", "sub", "subAg", "pow", "chin", "acc0", "acc1", "acc2", "accAg0", "accAg1", "accAg2"]
# the builder's frozen choices (out/statlines_cache/prereg.json): ridge per stat, None = nb_t, "base" = nb_base
CHOSEN = {"sig_att": 10000, "sig_lnd": 3000, "h_att": 10000, "h_lnd": 3000, "b_att": 30000, "b_lnd": 30000, "l_att": 10000,
          "l_lnd": 30000, "d_att": 10000, "d_lnd": 3000, "c_att": 3000, "c_lnd": 3000, "g_att": 3000, "g_lnd": 300, "kd": None,
          "td_att": 300, "td_lnd": 3000, "ctrl": 300, "sub_att": 300, "rev": "base"}


def link(tn, x):
    if tn == "ctrl":
        return np.log(np.maximum(x / 60, 1e-6))
    if tn == "kd_h":
        return np.log(np.clip(x, 1e-6, 1 - 1e-6))
    if tn in ACC:
        p = np.clip(x, 1e-6, 1 - 1e-6)
        return np.log(p / (1 - p))
    return np.log(np.maximum(x, 1e-9))


def blend(T, Y, t, tr):
    import statsmodels.api as sm
    keep = json.load(open(os.path.join(DER, "embed_model.json")))["mlrates_blend"]["targets"]
    n = len(t)
    outs = []
    for opp in (False, True):
        ML = T["MLo"] if opp else T["ML"]
        ETA = T["ETAo"] if opp else T["ETA"]
        out = np.zeros((n, len(MLT)))
        for k, tn in enumerate(MLT):
            if tn in ACC:
                y, e, fam = Y[:, COL[ACC[tn] + "_lnd"]], Y[:, COL[ACC[tn] + "_att"]], "bin"
            elif tn == "kd_h":
                y, e, fam = Y[:, COL["kd"]], Y[:, COL["h_lnd"]], "pois"
            else:
                y, e, fam = Y[:, COL[tn]] / (60.0 if tn == "ctrl" else 1.0), t.copy(), "pois"
            ok = tr & (e > 0)
            xtr = link(tn, T["ML"][:, k])

            def fit(X, m):
                if fam == "pois":
                    return sm.GLM(y[m], X[m], family=sm.families.Poisson(), exposure=e[m]).fit().params
                return sm.GLM(np.c_[y[m], e[m] - y[m]], X[m], family=sm.families.Binomial()).fit().params
            b1 = fit(np.c_[np.ones(n), xtr], ok)
            xa = link(tn, ML[:, k])
            z = b1[0] + b1[1] * xa
            if abs(keep[tn]["b"][2]) > 0:
                ti = T["TI"][TASK.get(tn, tn)]
                b2 = fit(np.c_[np.ones(n), xtr, np.nan_to_num(T["ETA"][:, ti])], ok & T["has_emb"])
                z = np.where(T["has_emb"], b2[0] + b2[1] * xa + b2[2] * np.nan_to_num(ETA[:, ti]), z)
            out[:, k] = expit(z) if fam == "bin" else (np.minimum(np.exp(z), 0.5) if tn == "kd_h" else
                                                       (60 * np.exp(z) if tn == "ctrl" else np.exp(z)))
        outs.append(out)
    return outs


def rates20(RT):
    g = lambda tn: RT[:, MLT.index(tn)]
    h, b, l = g("h_att"), g("b_att"), g("l_att")
    o = {"sig_att": h + b + l, "sig_lnd": h * g("acc_h") + b * g("acc_b") + l * g("acc_l"), "h_att": h, "h_lnd": h * g("acc_h"),
         "b_att": b, "b_lnd": b * g("acc_b"), "l_att": l, "l_lnd": l * g("acc_l"), "kd": h * g("acc_h") * g("kd_h"),
         "td_att": g("td_att"), "td_lnd": g("td_att") * g("td_acc"), "ctrl": g("ctrl"), "sub_att": g("sub_att"), "rev": g("rev")}
    for p in "dcg":
        o[p + "_att"] = g(p + "_att")
        o[p + "_lnd"] = g(p + "_att") * g("acc_" + p)
    return np.maximum(np.c_[[o[s] for s in STATS]].T, 1e-6)


def nb_ll(y, mu, k):
    return gammaln(y + k) - gammaln(k) - gammaln(y + 1) + k * np.log(k / (k + mu)) + y * np.log(mu / (k + mu))


def fit_nb(y, off, Xm, Xk, ridge):
    pm = Xm.shape[1]

    def f(th):
        b, g = th[:pm], th[pm:]
        eta = np.clip(off + Xm @ b, -20, 20)
        mu = np.exp(eta)
        lk = np.clip(Xk @ g, -6, 9)
        k = np.exp(lk)
        r = k + mu
        ll = gammaln(y + k) - gammaln(k) - gammaln(y + 1) + k * (lk - np.log(r)) + y * (eta - np.log(r))
        gm = (y - mu) * k / r
        gk = k * (digamma(y + k) - digamma(k) + lk - np.log(r) + 1 - (k + y) / r)
        return -ll.sum() + 0.5 * (ridge * b * b).sum(), np.r_[-(Xm.T @ gm) + ridge * b, -(Xk.T @ gk)]
    th = np.zeros(pm + Xk.shape[1])
    th[pm] = 1.0
    r = minimize(f, th, jac=True, method="L-BFGS-B", options={"maxiter": 2000, "maxfun": 4000})
    return r.x[:pm], r.x[pm:]


def pit_nb(y, mu, k, rng):
    out = np.zeros(len(y))
    for a in range(0, len(y), 300):
        b = slice(a, a + 300)
        J = int(np.max(y[b]) + 2)
        j = np.arange(J)[None, :]
        m, kk = mu[b][:, None], k[b][:, None]
        lp0 = kk * (np.log(kk) - np.log(kk + m))
        F = np.minimum(np.cumsum(np.exp(np.concatenate([lp0, lp0 + np.cumsum(np.log(j + kk) - np.log(j + 1.0) + np.log(m)
                                                                             - np.log(kk + m), 1)], 1)), 1), 1)
        yi = y[b].astype(int)
        ii = np.arange(len(yi))
        Fy = F[ii, yi]
        Fm = np.where(yi > 0, F[ii, np.maximum(yi - 1, 0)], 0)
        out[b] = Fm + rng.random(len(yi)) * (Fy - Fm)
    return out


def fit_zb(y, cap, off, Xm, Xphi, Xp, rm, rp):
    s = np.clip(y / cap, 0.5 / cap, 1 - 0.5 / cap)
    z = y <= 0
    ls, l1 = np.log(s), np.log1p(-s)
    pm, pg = Xm.shape[1], Xphi.shape[1]

    def f(th):
        b, g, d = th[:pm], th[pm:pm + pg], th[pm + pg:]
        m = expit(np.clip(off + Xm @ b, -15, 15))
        phi = np.exp(np.clip(Xphi @ g, -4, 8))
        pi = expit(Xp @ d)
        a, bb = m * phi, (1 - m) * phi
        ll = np.where(z, np.log(pi), np.log1p(-pi) + (a - 1) * ls + (bb - 1) * l1 - betaln(a, bb))
        da = ls - digamma(a) + digamma(phi)
        db = l1 - digamma(bb) + digamma(phi)
        nz = ~z
        return (-ll.sum() + 0.5 * (rm * b * b).sum() + 0.5 * (rp * d * d).sum(),
                np.r_[-(Xm.T @ (nz * phi * (da - db) * m * (1 - m))) + rm * b, -(Xphi.T @ (nz * phi * (m * da + (1 - m) * db))),
                      -(Xp.T @ np.where(z, 1 - pi, -pi)) + rp * d])
    th = np.zeros(pm + pg + Xp.shape[1])
    th[pm] = 1.5
    r = minimize(f, th, jac=True, method="L-BFGS-B", options={"maxiter": 2000, "maxfun": 4000})
    return r.x[:pm], r.x[pm:pm + pg], r.x[pm + pg:]


def part_repro(T, F):
    Y = np.array([[F[f]["AB"[s]][st] for st in STATS] for f, s in zip(T["fid"], T["side"])], float)
    assert np.array_equal(Y, T["Y"])
    n = len(Y)
    t = T["t"].astype(float)
    R = T["rounds"].astype(int)
    yr = T["year"].astype(int)
    fin = (t < 5 * R - 1 / 60).astype(float)
    lt = np.log(np.maximum(t, 0.05))
    five = (R == 5).astype(float)
    cards = card_keys(T)
    folds = {str(y): ((yr >= 2019) & (yr < y), yr == y) for y in (2021, 2022, 2023)}
    folds["valid"] = ((yr >= 2019) & (yr <= 2023), (yr >= 2024) & (yr <= 2025))
    rng = np.random.default_rng(1)
    store = {}
    for name, (tr, te) in folds.items():
        t0 = time.time()
        RT, RTo = blend(T, Y, t, tr)
        BR, BRo = rates20(RT), rates20(RTo)
        oi = [OPP_KEYS.index(k) for k in GLM_OPPADJ]
        six = [COL[s] for s in ("sig_att", "sig_lnd", "td_att", "ctrl", "sub_att", "kd")]
        G = np.c_[np.log(BR[:, six]), np.log(BRo[:, six]), T["WINL"], T["has_emb"].astype(float), T["OPP"][:, oi], T["OPPo"][:, oi]]
        sd = G[tr].std(0)
        sd[sd < 1e-9] = 1
        Z = (G - G[tr].mean(0)) / sd
        GL = np.c_[Z, fin * Z[:, 12], fin * Z[:, 1], fin * Z[:, 7]]
        Xt = np.c_[np.ones(n), lt, fin, fin * lt, five]
        Xk3 = np.c_[np.ones(n), lt, fin]
        one_tr = np.ones((tr.sum(), 1))
        for st in STATS:
            j = COL[st]
            y = Y[:, j]
            base = BR[:, j] * t
            off = np.log(np.maximum(base, 1e-8))
            lp, mean, pit = {}, {}, {}
            b, g = fit_nb(y[tr], off[tr], one_tr, one_tr, np.zeros(1))
            mu0, k0 = np.exp(off[te] + b[0]), np.full(te.sum(), np.exp(g[0]))
            lp["nb_base"], mean["nb_base"], pit["nb_base"] = nb_ll(y[te], mu0, k0), mu0, pit_nb(y[te], mu0, k0, rng)
            lp["pois"], mean["pois"] = y[te] * np.log(base[te]) - base[te] - gammaln(y[te] + 1), base[te]
            if st == "ctrl":
                cap = 60 * t
                sh = np.clip(base / cap, 1e-4, 0.98)
                offm = np.log(sh / (1 - sh))
                Xm, Xphi = np.c_[Xt, GL], np.c_[np.ones(n), lt, fin]
                Xp = np.c_[np.ones(n), np.clip(off - np.log(cap), -10, 2), lt, fin, GL]
                b, g, d = fit_zb(y[tr], cap[tr], offm[tr], Xm[tr], Xphi[tr], Xp[tr], np.r_[np.zeros(5), np.full(GL.shape[1], 300.0)],
                                 np.r_[np.zeros(4), np.full(GL.shape[1], 300.0)])
                m = expit(np.clip(offm[te] + Xm[te] @ b, -15, 15))
                phi = np.exp(np.clip(Xphi[te] @ g, -4, 8))
                pi = expit(Xp[te] @ d)
                a_, b_ = m * phi, (1 - m) * phi
                yy, cc = y[te], cap[te]
                s = np.clip(yy / cc, 0.5 / cc, 1 - 0.5 / cc)
                lp["chosen"] = np.where(yy <= 0, np.log(pi), np.log1p(-pi) + (a_ - 1) * np.log(s) + (b_ - 1) * np.log1p(-s)
                                        - betaln(a_, b_) - np.log(cc))
                hi = betainc(a_, b_, np.clip((yy + 0.5) / cc, 0, 1))
                lo = betainc(a_, b_, np.clip((yy - 0.5) / cc, 0, 1))
                lp["chosen_exact_bin"] = np.where(yy <= 0, np.log(pi + (1 - pi) * hi), np.log(np.maximum((1 - pi) * (hi - lo), 1e-300)))
                Fy, Fm = pi + (1 - pi) * hi, np.where(yy <= 0, 0, pi + (1 - pi) * lo)
                pit["chosen"] = Fm + rng.random(len(yy)) * (Fy - Fm)
                mean["chosen"] = (1 - pi) * m * cc
            else:
                b, g = fit_nb(y[tr], off[tr], Xt[tr], Xk3[tr], np.zeros(5))
                mu1, k1 = np.exp(off[te] + Xt[te] @ b), np.exp(np.clip(Xk3[te] @ g, -6, 9))
                lp["nb_t"], mean["nb_t"], pit["nb_t"] = nb_ll(y[te], mu1, k1), mu1, pit_nb(y[te], mu1, k1, rng)
                lam = CHOSEN[st]
                if lam == "base":
                    lp["chosen"], mean["chosen"], pit["chosen"] = lp["nb_base"], mean["nb_base"], pit["nb_base"]
                elif lam is None:
                    lp["chosen"], mean["chosen"], pit["chosen"] = lp["nb_t"], mean["nb_t"], pit["nb_t"]
                else:
                    Xm = np.c_[Xt, GL]
                    Xk = np.c_[np.ones(n), lt, fin, np.clip(off, -8, 8), five]
                    b, g = fit_nb(y[tr], off[tr], Xm[tr], Xk[tr], np.r_[np.zeros(5), np.full(GL.shape[1], float(lam))])
                    mu2, k2 = np.exp(off[te] + Xm[te] @ b), np.exp(np.clip(Xk[te] @ g, -6, 9))
                    lp["chosen"], mean["chosen"], pit["chosen"] = nb_ll(y[te], mu2, k2), mu2, pit_nb(y[te], mu2, k2, rng)
            store[(name, st)] = {"lp": lp, "mean": mean, "pit": pit, "y": y[te], "grp": cards[te]}
        print("  repro fold %s (%.0fs)" % (name, time.time() - t0), flush=True)
    pdev = lambda y, mu: 2 * (np.where(y > 0, y * np.log(np.maximum(y, 1e-300) / np.maximum(mu, 1e-10)), 0) - (y - mu))
    res = {}
    for period, fl in (("cv_2021_2023", ["2021", "2022", "2023"]), ("valid_2024_2025", ["valid"])):
        res[period] = {}
        print("\n%s (card-level cluster CIs)" % period)
        print("| stat | NLL chosen | NLL nb_base | chosen - nb_base | nb_t - nb_base (time terms) | chosen - nb_t (GLM) | in80 chosen | dev chosen vs blend |")
        print("|---|---|---|---|---|---|---|---|")
        for st in STATS:
            P = [store[(f, st)] for f in fl]
            g = np.concatenate([p["grp"] for p in P])
            y = np.concatenate([p["y"] for p in P])
            L = {k: -np.concatenate([p["lp"][k] for p in P]) for k in P[0]["lp"]}
            M = {k: np.concatenate([p["mean"][k] for p in P]) for k in P[0]["mean"]}
            pit = np.concatenate([p["pit"]["chosen"] for p in P])
            e = {"nll_chosen": r4(L["chosen"].mean()), "nll_nb_base": r4(L["nb_base"].mean()),
                 "chosen_minus_nb_base": boot_ci(L["chosen"] - L["nb_base"], g),
                 "in80_chosen": r4(((pit >= 0.1) & (pit <= 0.9)).mean()),
                 "dev_chosen_minus_blend": boot_ci(pdev(y, M["chosen"]) - pdev(y, M["pois"]), g),
                 "dev_blend": r4(pdev(y, M["pois"]).mean())}
            if "nb_t" in L:
                e["nb_t_minus_nb_base"] = boot_ci(L["nb_t"] - L["nb_base"], g)
                e["chosen_minus_nb_t"] = boot_ci(L["chosen"] - L["nb_t"], g)
            if "chosen_exact_bin" in L:
                e["nll_chosen_exact_bin"] = r4(L["chosen_exact_bin"].mean())
                e["exact_bin_minus_nb_base"] = boot_ci(L["chosen_exact_bin"] - L["nb_base"], g)
            res[period][st] = e
            print("| %s | %.4f | %.4f | %s | %s | %s | %.3f | %s |" % (
                st, e["nll_chosen"], e["nll_nb_base"], fmt(e["chosen_minus_nb_base"]),
                fmt(e["nb_t_minus_nb_base"]) if "nb_t_minus_nb_base" in e else "n/a",
                fmt(e["chosen_minus_nb_t"]) if "chosen_minus_nb_t" in e else "n/a", e["in80_chosen"],
                "%+.3f [%+.3f, %+.3f]" % tuple(e["dev_chosen_minus_blend"])))
            if "nll_chosen_exact_bin" in e:
                print("|   ctrl, exact 1-s bin mass | %.4f | | %s | | | | |" % (e["nll_chosen_exact_bin"], fmt(e["exact_bin_minus_nb_base"])))
    OUT["repro"] = res


# ====================================================================== engine
def part_engine(T, F):
    E = json.load(open(os.path.join(SLC, "engine_v4.json")))
    assert E["meta"]["until"] <= VAULT
    E = E["fights"]
    O = json.load(open(os.path.join(DER, "statlines_oof.json")))
    kinds = O["meta"]["kinds"]
    bt = {f["id"]: f["event"] for f in json.load(open(os.path.join(DER, "backtest_dev.json")))["fights"] if f["date"] < VAULT}
    pdev = lambda y, mu: 2 * (np.where(y > 0, y * np.log(np.maximum(y, 1e-300) / np.maximum(mu, 1e-10)), 0) - (y - mu))

    def cmean(kind, p, t):
        return (1 - p[2]) * p[0] * 60 * t if kind == "zibeta" else ((1 - p[2]) * p[0] if kind == "zinb" else p[0])
    res = {}
    for sets, label in (("valid", "valid_2024_2025"), ("cv", "cv_2021_2023")):
        res[label] = {}
        print("\nengine v4 vs statlines, %s" % label)
        print("| stat | uncond dev engine / ours / diff [CI] | MAE of uncond mean engine / ours / diff [CI] | went the distance: dev engine (decision sims) / ours (t = 5R) / diff [CI] |")
        print("|---|---|---|---|")
        for st in STATS:
            rows = []
            for f, e in O["fights"].items():
                if e.get("set") != sets or f not in E or E[f].get("err") or "A" not in E[f]:
                    continue
                for s in "AB":
                    p = e[s][st]
                    if p[-1] is None:
                        continue
                    ee = E[f][s][st]
                    rows.append((F[f][s][st], ee[0], p[-1], ee[6] if len(ee) > 6 else np.nan, cmean(kinds[st], p, e["t"]),
                                 e["t"] < 5 * e["R"] - 1 / 60, bt[f]))
            y, em, om, edm, ocm = (np.array([r[k] for r in rows], float) for k in range(5))
            fin = np.array([r[5] for r in rows], bool)
            g = np.array([r[6] for r in rows], dtype=object)
            m = (~fin) & np.isfinite(edm)
            r = {"n": int(len(y)), "uncond_dev_engine": r4(pdev(y, em).mean()), "uncond_dev_ours": r4(pdev(y, om).mean()),
                 "uncond_dev_diff": boot_ci(pdev(y, om) - pdev(y, em), g),
                 "mae_engine": r4(np.abs(y - em).mean()), "mae_ours": r4(np.abs(y - om).mean()),
                 "mae_diff": boot_ci(np.abs(y - om) - np.abs(y - em), g), "n_distance": int(m.sum()),
                 "distance_dev_engine": r4(pdev(y[m], edm[m]).mean()), "distance_dev_ours": r4(pdev(y[m], ocm[m]).mean()),
                 "distance_dev_diff": boot_ci(pdev(y[m], ocm[m]) - pdev(y[m], edm[m]), g[m])}
            res[label][st] = r
            print("| %s | %.3f / %.3f / %s | %.3f / %.3f / %s | %.3f / %.3f / %s (n %d) |" % (
                st, r["uncond_dev_engine"], r["uncond_dev_ours"], fmt(r["uncond_dev_diff"]), r["mae_engine"], r["mae_ours"],
                fmt(r["mae_diff"]), r["distance_dev_engine"], r["distance_dev_ours"], fmt(r["distance_dev_diff"]), r["n_distance"]))
    OUT["engine"] = res


# ====================================================================== gate
def part_gate():
    sys.path.insert(0, HERE)
    import ml2 as m2
    orig = m2.col_for
    m2.col_for = lambda c, s: "sl_verify" if c == "statlines" else orig(c, s)
    D = pickle.load(open(os.path.join(ROOT, "out", "ml2_cache", "stack.pkl"), "rb"))["D"].copy()
    assert str(D["date"].max()) < VAULT
    O = json.load(open(os.path.join(DER, "statlines_oof.json")))["fights"]
    D["sl_verify"] = [O[f]["p_dom"] if (f in O and O[f].get("p_dom") is not None and y <= 2023) else np.nan
                      for f, y in zip(D["fid"], D["year"])]
    y, yr = D["y"].to_numpy(float), D["year"].to_numpy()
    rows_of = {"line": D["market"].notna().to_numpy(), "noline": np.ones(len(D), bool), "open": D["open"].notna().to_numpy()}
    sets = {"line": [["market", "ml2"], ["market", "ml2lr"]], "noline": [["ml2", "mkt_rating", "feat_lr"], ["ml2lr", "mkt_rating"]],
            "open": [["open", "ml2"], ["open", "ml2lr"]]}

    def cv(cols, regime, h):
        tot = nn = 0
        pr = np.full(len(D), np.nan)
        for Yr in (2021, 2022, 2023):
            mm = rows_of[regime] & (yr == Yr)
            p, _ = m2.stack_predict(D, cols, "static", h, Yr - 1, mm, rows_of[regime])
            pr[mm] = p
            tot += m2.ll(p, y[mm]) * mm.sum()
            nn += mm.sum()
        return tot / nn, pr
    res = {}
    for regime, ss in sets.items():
        for cols in ss:
            best = {}
            for tag, cc in (("base", cols), ("plus", cols + ["statlines"])):
                r = {h: cv(cc, regime, h) for h in (None, 3.0, 1.5)}
                hb = min(r, key=lambda h: r[h][0] + (0 if h is None else m2.SEL_MIN))
                _, b = m2.stack_predict(D, cc, "static", hb, 2023, np.zeros(len(D), bool), rows_of[regime])
                best[tag] = (r[hb][0], r[hb][1], b)
            mm = rows_of[regime] & (yr >= 2021) & (yr <= 2023)
            c = m2.compare(best["plus"][1][mm], best["base"][1][mm], y[mm], D["event"].to_numpy()[mm])
            key = "%s|%s" % (regime, "+".join(cols))
            res[key] = {"cv_base": r4(best["base"][0]), "cv_plus": r4(best["plus"][0]),
                        "gain": round(best["plus"][0] - best["base"][0], 5), "enters": bool(best["plus"][0] - best["base"][0] < -m2.SEL_MIN),
                        "w_statlines_fit_2023": round(float(best["plus"][2][-1]), 4), "paired": [c["diff"]] + c["diff_ci"]}
            print("gate %-34s %s" % (key, res[key]))
    cov = np.isfinite(D["sl_verify"].to_numpy(float)) & (yr <= 2023)
    p = D["sl_verify"].to_numpy(float)[cov]
    z, yy = np.log(p / (1 - p)), y[cov]

    def fitlr(X):
        return minimize(lambda b: np.sum(np.logaddexp(0, X @ b) - yy * (X @ b)), np.zeros(X.shape[1])).x
    b0, b1, bi = fitlr(z[:, None]), fitlr(np.c_[np.ones(len(z)), z]), fitlr(np.ones((len(z), 1)))
    res["free_intercept_2019_2023"] = {"n": int(cov.sum()), "slope_no_intercept": r4(b0[0]), "intercept_with_expert": r4(b1[0]),
                                       "slope_with_intercept": r4(b1[1]), "intercept_only": r4(bi[0]), "a_win_share": r4(yy.mean()),
                                       "expert_alone_ll": r4(m2.ll(p, yy))}
    print("free intercept:", res["free_intercept_2019_2023"])
    OUT["gate"] = res


def main():
    parts = sys.argv[1:] or ["targets", "inputs", "repro", "engine", "gate"]
    T = load_T()
    F = None
    if any(p in parts for p in ("targets", "repro", "engine")):
        F = part_targets(T) if "targets" in parts else parse_raw()[0]
    if "inputs" in parts:
        part_inputs(T)
    if "repro" in parts:
        part_repro(T, F)
    if "engine" in parts:
        part_engine(T, F)
    if "gate" in parts:
        part_gate()
    if len(parts) == 5:
        OUT["meta"] = {"tool": "tools/statlines_verify.py", "built": dt.datetime.utcnow().isoformat() + "Z",
                       "note": "verifier's independent checks of tools/statlines.py; see research/model_statlines.md, Verification log"}
        json.dump(OUT, open(os.path.join(DER, "statlines_verify.json"), "w"), indent=1, default=float)
        print("wrote data/derived/statlines_verify.json")


if __name__ == "__main__":
    main()
