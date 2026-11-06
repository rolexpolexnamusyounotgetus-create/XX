#!/usr/bin/env python3
"""Adversarial verification of tools/oppadj.py (opponent / strength-of-schedule adjustment).

Three parts, each writing into data/derived/oppadj_verify.json:

  fresh   Independent re-implementation of the headline held-out result (2024-2025 per-fight deviance of the
          opponent-adjusted rates vs the engine's raw shrunk rates) for takedown attempts, control and distance
          strike attempts. Own row construction from build_db's parsed fights, own engine-raw rates from the
          backtest S, own fit (exact joint Newton on the penalized Poisson MAP with a sparse Hessian, not the
          analyst's alternating IPF), own scoring and bootstraps (fight-cluster and a two-way fighter
          "pigeonhole" bootstrap). Also checks fighter order, the actual-stat join and that S is pre-fight, and
          a placebo that shows the leakage check has power (fitting through the fight's own date).
  attrib  Uses oppadj.py's own code and its cached grid to split the gains: half-life averaging vs the
          opponent adjustment (raw re-tuned and no-opp baselines given the same averaging), the
          combination-exponent claim (raw re-tuned rates on 2019-2023 and every model on 2024-2025), an
          oracle re-level on 2024-2025 (level drift vs ranking), and the ML-stack gain from raw re-tuned rates.
  vg      The Volkanovski vs Gaethje roster factors: Volkanovski's factors are computed against Featherweight
          priors but the fight is simulated at Lightweight; measures the mismatch.

    python3 tools/oppadj_verify.py --part fresh
    python3 tools/oppadj_verify.py --part attrib --cache <oppadj grid pickle>
    python3 tools/oppadj_verify.py --part vg

Walk-forward: every fit for a fight on day T uses rows with day < T; levels are fit on 2019-2023; 2024-2025 is
only scored; 2026 (vault) is never scored.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import subprocess
import sys
import time
from collections import defaultdict

for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "1")
import numpy as np  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import build_db as B  # noqa: E402

OUT = os.path.join(ROOT, "data", "derived")
OUTF = os.path.join(OUT, "oppadj_verify.json")
KI = B.KI
TUNE = ("2019-01-01", "2023-12-31")
TEST = ("2024-01-01", "2026-01-01")      # [lo, hi); 2026 is the vault


def load_out():
    try:
        return json.load(open(OUTF))
    except (OSError, ValueError):
        return {"meta": {"tool": "tools/oppadj_verify.py", "reviewed": "tools/oppadj.py"}}


def save_out(o):
    o["meta"]["updated"] = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    B.write_json(OUTF, o)


def r(x, s=4):
    return B.rnd(float(x), s)


# ====================================================================== part 1: fresh re-implementation
def params3():
    js = "process.stdout.write(JSON.stringify(require(%s)))" % json.dumps(os.path.join(ROOT, "src", "params3.js"))
    return json.loads(subprocess.run(["node", "-e", js], capture_output=True, text=True, check=True).stdout)


def lg_quant(P, gs):
    """Minimal league quantities (written from the engine's definitions, not copied from oppadj.py)."""
    cf = P["ctrl"] / 60.0
    ground = 2 * cf * gs
    clinch = 2 * cf * (1 - gs)
    dist = 1 - ground - clinch
    stand = 1 - ground
    return {"dist": dist, "stand": stand, "dAtt": P["d_att"] / dist, "tdAtt": P["td_att"] / stand,
            "ctrl": P["ctrl"]}


class Rows:
    def __init__(self, gs):
        log = {}
        fights, _ = B.parse_fights(log)
        people = B.build_people(fights, log)
        B.build_vectors(fights, log)
        self.bt = json.load(open(os.path.join(OUT, "backtest.json")))
        bt_by = {e["id"]: e for e in self.bt["fights"]}
        snap = fights[-1].date
        # walk-forward priors per year (backtest priors_asof for 2019+, the same 5-year rule before)
        pri = {}
        for y in range(2004, snap.year + 1):
            pri[y] = self.bt["priors_asof"].get(str(y)) or B.build_priors(fights, dt.date(y - 5, 1, 1), dt.date(y, 1, 1))
        self.pri = pri
        hist = defaultdict(list)
        ids = {}
        R = []
        checks = {"order_mismatch": 0, "actual_mismatch": 0, "bt_entries": 0, "bt_with_stats": 0}
        self.fight_rows = {}
        for f in fights:
            a, b = f.persons
            if a == b:
                continue
            ok = f.stats and not (a.startswith("amb:") or b.startswith("amb:")) and f.date >= dt.date(2001, 1, 1)
            if ok:
                e = bt_by.get(f.fid)
                if e is not None:
                    g = e.get("prior_division") or e["division"]
                elif f.division in B.NON_DIV:
                    hs = [B.mode_recent(hist[q], f.day) for q in (a, b) if hist[q]]
                    hs = [h for h in hs if B.LBS.get(h)]
                    g = max(hs, key=lambda d: B.LBS[d]) if hs else "ALL"
                else:
                    g = f.division
                yr = max(2004, f.date.year)
                P = pri[yr].get(g) or pri[yr]["ALL"]
                Pa = dict(pri[yr]["ALL"])
                Pa.update({k: v for k, v in P.items() if v is not None})
                Lq = lg_quant(Pa, gs)
                for s in (0, 1):
                    for q in f.persons:
                        ids.setdefault(q, len(ids))
                    R.append((f.day, ids[f.persons[s]], ids[f.persons[1 - s]], f.fid, s, f.stats["v"][s], Lq))
                if e is not None:
                    checks["bt_with_stats"] += 1
                    for s, t in enumerate("AB"):
                        if people[f.persons[s]]["slug"] != e[t]["slug"]:
                            checks["order_mismatch"] += 1
                        act = e["actual"][t]
                        v = f.stats["v"][s]
                        if (abs(act["td_att"] - v[KI["td_att"]]) > 1e-6 or abs(act["ctrl"] - v[KI["ctrl"]]) > 0.5
                                or abs(act["sig_att"] - (v[KI["d_att"]] + v[KI["c_att"]] + v[KI["g_att"]])) > 1e-6):
                            checks["actual_mismatch"] += 1
            hist[a].append((f.day, f.division))
            hist[b].append((f.day, f.division))
        checks["bt_entries"] = len(self.bt["fights"])
        R.sort(key=lambda x: (x[0], x[3], x[4]))
        self.NP = len(ids)
        self.slug = {i: (people[q]["slug"] if q in people else q) for q, i in ids.items()}
        self.day = np.array([x[0] for x in R], float)
        self.X = np.array([x[1] for x in R], int)
        self.Y = np.array([x[2] for x in R], int)
        self.V = np.array([x[5] for x in R], float)
        self.Lq = [x[6] for x in R]
        self.idx = {(x[3], x[4]): i for i, x in enumerate(R)}
        self.checks = checks
        # test / tune sides: backtest entries, A then B
        self.ent = [e for e in self.bt["fights"] if (e["id"], 0) in self.idx]
        self.srow = np.array([self.idx[(e["id"], s)] for e in self.ent for s in (0, 1)], int)
        self.sdate = np.array([e["date"] for e in self.ent for _ in (0, 1)])
        self.sday = self.day[self.srow]
        self.S = np.array([e[t]["S"] for e in self.ent for t in "AB"], float)
        self.tune = (self.sdate >= TUNE[0]) & (self.sdate <= TUNE[1])
        self.test = (self.sdate >= TEST[0]) & (self.sdate < TEST[1])

    def s_check(self, hl=730.0):
        """Recompute each side's decayed sums from rows strictly before the fight; compare to backtest S and to
        the same sums including the fight itself (the leak signature)."""
        lam = math.log(2) / hl
        by = defaultdict(list)
        for i in range(len(self.X)):
            by[self.X[i]].append(i)
        sc = KI["td_att"], KI["ctrl"], KI["d_att"], KI["min"]
        worst_pre, worst_incl, n_cmp = 0.0, 0.0, 0
        for j, rr in enumerate(self.srow):
            if self.sdate[j] < "2019-01-01":
                continue
            q, T = self.X[rr], self.day[rr]
            ii = np.array(by[q])
            pre = ii[self.day[ii] < T]
            Spre = np.exp(-lam * (T - self.day[pre])) @ self.V[pre] if len(pre) else np.zeros(self.V.shape[1])
            Sinc = Spre + self.V[rr]
            for k in sc:
                b = self.S[j, k]
                den = max(1.0, abs(b))
                worst_pre = max(worst_pre, abs(Spre[k] - b) / den)
            worst_incl = max(worst_incl, abs(Sinc[KI["min"]] - self.S[j, KI["min"]]))
            n_cmp += 1
        return {"sides_compared": n_cmp, "max_rel_err_vs_presums_td_ctrl_datt_min": r(worst_pre, 3),
                "note": "backtest S equals the decayed sums of rows strictly before the fight (pre-2001 fights, "
                        "if any, would show up here as small differences)"}


def family(rows, name, gs):
    """(y, E, L) per row for one family, written from the engine's definitions."""
    V = rows.V
    mn = V[:, KI["min"]]
    c, oc = V[:, KI["ctrl"]], V[:, KI["octrl"]]
    if name == "tdAtt":
        return V[:, KI["td_att"]], np.maximum(0.3 * mn, mn - (c + oc) / 60 * gs), np.array([q["tdAtt"] for q in rows.Lq])
    if name == "ctrl":
        return c, mn, np.array([q["ctrl"] for q in rows.Lq])
    if name == "dAtt":
        return V[:, KI["d_att"]], np.maximum(0.25 * mn, mn - (c + oc) / 60), np.array([q["dAtt"] for q in rows.Lq])
    raise KeyError(name)


def engine_raw(rows, name, p):
    """Engine v3 raw shrunk rates from the backtest S (src/engine3.js fighterRates formulas), per side, and the
    log-linear / log5 combination: mu = E * R_off,X * R_def,Y / L."""
    S = rows.S
    gs = p["ctrlGroundShare"]
    Lq = [rows.Lq[i] for i in rows.srow]
    mn = np.maximum(0, S[:, KI["min"]])
    c, oc = S[:, KI["ctrl"]], S[:, KI["octrl"]]
    if name == "tdAtt":
        stand = np.array([q["stand"] for q in Lq])
        L = np.array([q["tdAtt"] for q in Lq])
        ex = np.maximum(0.3 * mn, mn - (c + oc) / 60 * gs)
        k = p["kTdPM"] * stand
        ro = (S[:, KI["td_att"]] + k * L) / (ex + k)
        rd = (S[:, KI["otd_att"]] + k * L) / (ex + k)
    elif name == "ctrl":
        L = np.array([q["ctrl"] for q in Lq])
        k = p["kPM"]
        ro = (c + k * L) / (mn + k)
        rd = (oc + k * L) / (mn + k)
    else:
        dist = np.array([q["dist"] for q in Lq])
        L = np.array([q["dAtt"] for q in Lq])
        ex = np.maximum(0.25 * mn, mn - (c + oc) / 60)
        k = p["kPM"] * dist
        ro = (S[:, KI["d_att"]] + k * L) / (ex + k)
        rd = (S[:, KI["od_att"]] + k * L) / (ex + k)
    opp = np.arange(len(ro)) ^ 1
    return ro * rd[opp] / L      # per unit exposure


def newton_fit(X, Y, w, y, EL, NP, a_o, a_d, o, d, tol=1e-9, maxit=50):
    """Joint MAP of y ~ Poisson(EL * exp(o_X + d_Y)) with pseudo-data priors a*(o - e^o) per effect: exact
    Newton steps on all 2*NP effects at once (sparse Hessian), backtracking on the objective."""
    import scipy.sparse as sp
    import scipy.sparse.linalg as spl

    def obj(o, d):
        eta = o[X] + d[Y]
        return -(np.sum(w * (y * eta - EL * np.exp(eta))) + np.sum(a_o * (o - np.exp(o))) + np.sum(a_d * (d - np.exp(d))))

    f0 = obj(o, d)
    for it in range(maxit):
        mu = w * EL * np.exp(o[X] + d[Y])
        go = np.bincount(X, w * y - mu, NP) + a_o * (1 - np.exp(o))
        gd = np.bincount(Y, w * y - mu, NP) + a_d * (1 - np.exp(d))
        g = np.r_[go, gd]
        if np.abs(g).max() < tol * max(1.0, np.abs(a_o).max()):
            break
        hoo = np.bincount(X, mu, NP) + a_o * np.exp(o)
        hdd = np.bincount(Y, mu, NP) + a_d * np.exp(d)
        off = sp.coo_matrix((mu, (X, Y + NP)), shape=(2 * NP, 2 * NP))
        H = sp.diags(np.r_[hoo, hdd]) + off + off.T
        step = spl.spsolve(H.tocsc(), g)
        t = 1.0
        while t > 1e-6:
            on, dn = o + t * step[:NP], d + t * step[NP:]
            fn = obj(on, dn)
            if fn <= f0 + 1e-12 * abs(f0):
                break
            t *= 0.5
        o, d, f0 = on, dn, fn
        if np.abs(t * step).max() < 1e-10:
            break
    return o, d, it


def walk_fresh(rows, y, E, L, hl, ko, kd, through_own_date=False):
    """Walk-forward fit at every distinct backtest date; returns per side c + o_X + d_Y (log rate multiplier
    over L). through_own_date=True is the placebo leak (rows with day <= T)."""
    EL = E * L
    lam = math.log(2) / hl
    NP = rows.NP
    o, d = np.zeros(NP), np.zeros(NP)
    sides_by = defaultdict(list)
    for j, T in enumerate(rows.sday):
        sides_by[T].append(j)
    out = np.zeros(len(rows.srow))
    its = []
    for T in sorted(sides_by):
        na = int(np.searchsorted(rows.day, T, side="right" if through_own_date else "left"))
        X, Y = rows.X[:na], rows.Y[:na]
        w = np.exp(-lam * (T - rows.day[:na]))
        yy, ee, ll = y[:na], E[:na], L[:na]
        c = math.log(np.sum(w * yy) / np.sum(w * ee * ll))
        WE_o, WE_d = np.bincount(X, w * ee, NP), np.bincount(Y, w * ee, NP)
        WEL_o, WEL_d = np.bincount(X, w * ee * ll, NP), np.bincount(Y, w * ee * ll, NP)
        Lg = np.sum(w * ee * ll) / np.sum(w * ee)
        Lo = np.where(WE_o > 0, WEL_o / np.maximum(WE_o, 1e-300), Lg)
        Ld = np.where(WE_d > 0, WEL_d / np.maximum(WE_d, 1e-300), Lg)
        a_o, a_d = ko * Lo * math.exp(c), kd * Ld * math.exp(c)
        o, d, it = newton_fit(X, Y, w, yy, EL[:na] * math.exp(c), NP, a_o, a_d, o, d)
        its.append(it)
        js = np.array(sides_by[T])
        Xs = rows.X[rows.srow[js]]
        Ys = rows.Y[rows.srow[js]]
        out[js] = c + o[Xs] + d[Ys]
    return out, float(np.mean(its))


def pdev(y, mu):
    mu = np.maximum(mu, 1e-12)
    return 2 * (np.where(y > 0, y * np.log(np.maximum(y, 1e-12) / mu), 0.0) - (y - mu))


def boots(rows, d_base, d_new, mask, nb=2000, seed=5):
    """95% intervals for sum(d_base - d_new) over masked test sides: fight-cluster bootstrap and a two-way
    (fighter) pigeonhole bootstrap with Poisson(1) weights per person, side weight w_X * w_Y."""
    diff = np.where(mask, d_base - d_new, 0.0)
    base = np.where(mask, d_base, 0.0)
    pf = (diff[0::2] + diff[1::2])
    pb = (base[0::2] + base[1::2])
    keep = mask[0::2] | mask[1::2]
    pf, pb = pf[keep], pb[keep]
    rng = np.random.default_rng(seed)
    ix = rng.integers(0, len(pf), size=(nb, len(pf)))
    fc = pf[ix].sum(1)
    fcp = 100 * fc / pb[ix].sum(1)
    Xs = rows.X[rows.srow]
    Ys = rows.Y[rows.srow]
    tot = []
    totp = []
    for _ in range(nb):
        wp = rng.poisson(1.0, rows.NP).astype(float)
        ws = wp[Xs] * wp[Ys]
        tot.append(np.sum(ws * diff))
        totp.append(100 * np.sum(ws * diff) / max(np.sum(ws * base), 1e-9))
    tot, totp = np.array(tot), np.array(totp)
    q = lambda a: [r(np.percentile(a, 2.5), 4), r(np.percentile(a, 97.5), 4)]
    return {"delta": r(diff.sum(), 6), "pct": r(100 * diff.sum() / base.sum(), 4), "n_fights": int(keep.sum()),
            "fight_cluster_95": q(fc), "fight_cluster_pct_95": q(fcp),
            "two_way_fighter_95": q(tot), "two_way_fighter_pct_95": q(totp),
            "se_ratio_two_way_over_fight": r(np.std(tot) / max(np.std(fc), 1e-12), 3)}


def part_fresh(args):
    t0 = time.time()
    p = params3()
    gs = p["ctrlGroundShare"]
    rows = Rows(gs)
    o = load_out()
    res = {"checks": dict(rows.checks), "params3_version": p.get("version")}
    res["checks"]["s_pre_fight"] = rows.s_check()
    print("rows %d, persons %d, sides %d, checks %s (%.0f s)" % (len(rows.X), rows.NP, len(rows.srow), res["checks"],
                                                                   time.time() - t0))
    opp = json.load(open(os.path.join(OUT, "oppadj.json")))
    fams = opp["results"]["families"]
    cfg = {"tdAtt": [(1095, 8, 16)], "ctrl": [(1460, 10, 20)],
           "dAtt": [(c["half_life_days"], c["k_offense"], c["k_defense"]) for c in fams["dAtt"]["chosen"]["configs"]]}
    lam = {nm: fams[nm]["chosen"]["blend_lambda"] for nm in cfg}
    res["families"] = {}
    for nm in args.families.split(","):
        y_all, E_all, L_all = family(rows, nm, gs)
        ys, Es, Ls = y_all[rows.srow], E_all[rows.srow], L_all[rows.srow]
        ok = Es >= 0.5
        tu, te = ok & rows.tune, ok & rows.test
        eng = engine_raw(rows, nm, p) * Es
        lins = []
        for hl, ko, kd in cfg[nm]:
            t1 = time.time()
            lin, its = walk_fresh(rows, y_all, E_all, L_all, hl, ko, kd)
            lins.append(lin)
            print("  %s fit hl %d k %s/%s: %.0f s, mean Newton its %.1f" % (nm, hl, ko, kd, time.time() - t1, its))
        adj = Es * Ls * np.exp(np.mean(lins, axis=0))
        fin = np.exp(lam[nm] * np.log(adj) + (1 - lam[nm]) * np.log(np.maximum(eng, 1e-12)))
        out = {"configs": cfg[nm], "lambda": lam[nm], "n_tune": int(tu.sum()), "n_test": int(te.sum())}
        devs = {}
        for lab, mu in (("engine_raw", eng), ("opp_adjusted", adj), ("final", fin)):
            s = ys[tu].sum() / mu[tu].sum()
            dv = pdev(ys, mu * s)
            devs[lab] = dv
            so = ys[te].sum() / mu[te].sum()
            out[lab] = {"tune_scale": r(s), "tune_dev": r(dv[tu].sum(), 6), "test_dev": r(dv[te].sum(), 6),
                        "test_dev_oracle_level": r(pdev(ys, mu * so)[te].sum(), 6),
                        "test_obs_over_pred_after_tune_level": r(so / s)}
        out["final_vs_engine"] = boots(rows, devs["engine_raw"], devs["final"], te)
        out["adjusted_vs_engine"] = boots(rows, devs["engine_raw"], devs["opp_adjusted"], te)
        # the analyst's numbers for the same quantities
        A = fams[nm]
        out["analyst"] = {"engine_raw_test": A["deviance"]["engine_raw"]["test"],
                          "opp_adjusted_test": A["deviance"]["opp_adjusted"]["test"],
                          "final_test": A["deviance"]["final_blend"]["test"],
                          "final_vs_engine_pct": A["test_delta_bootstrap_95"]["final_vs_engine_raw"]["pct_of_baseline"],
                          "n_test_sides": A["n_test_sides"]}
        # agreement with the analyst's stored factors on 2024-25 sides (lambda-1 adjusted log multiplier)
        if nm in ("tdAtt", "ctrl"):
            f_off, f_def = {"tdAtt": ("tdAtt", "tdAttAg"), "ctrl": ("ctrl", "octrl")}[nm]
            snaps = opp["snapshots"]
            Fo = np.array([snaps[e["id"]][t][f_off] for e in rows.ent for t in "AB"], float)
            Fd = np.array([snaps[e["id"]][t][f_def] for e in rows.ent for t in "AB"], float)
            oppi = np.arange(len(Fo)) ^ 1
            # final_analyst / engine = Fo * Fd[opp] up to the calibration term and rounding (3 significant digits)
            ratio_a = np.log(Fo * Fd[oppi])
            ratio_f = np.log(fin / eng)
            m = te
            out["factor_agreement_test"] = {
                "corr_log_change": r(np.corrcoef(ratio_a[m], ratio_f[m])[0, 1], 5),
                "median_abs_diff_log_change": r(np.median(np.abs((ratio_a - ratio_a[m].mean()) - (ratio_f - ratio_f[m].mean()))[m]), 4),
                "p99_abs_diff_log_change": r(np.percentile(np.abs((ratio_a - ratio_a[m].mean()) - (ratio_f - ratio_f[m].mean()))[m], 99), 4)}
        res["families"][nm] = out
        fv = out["final_vs_engine"]
        print("%s: test dev engine %.0f adj %.0f final %.0f | final vs engine %.2f%% fight95 %s two-way95 %s | analyst %.2f%%"
              % (nm, out["engine_raw"]["test_dev"], out["opp_adjusted"]["test_dev"], out["final"]["test_dev"],
                 fv["pct"], fv["fight_cluster_pct_95"], fv["two_way_fighter_pct_95"], out["analyst"]["final_vs_engine_pct"]))
        o["fresh"] = res
        save_out(o)
    # placebo: what a leak would look like (fit through the fight's own date) for takedown attempts
    if "tdAtt" in args.families.split(",") and not args.no_placebo:
        y_all, E_all, L_all = family(rows, "tdAtt", gs)
        ys, Es, Ls = y_all[rows.srow], E_all[rows.srow], L_all[rows.srow]
        ok = Es >= 0.5
        tu, te = ok & rows.tune, ok & rows.test
        lin, _ = walk_fresh(rows, y_all, E_all, L_all, 1095, 8, 16, through_own_date=True)
        mu = Es * Ls * np.exp(lin)
        s = ys[tu].sum() / mu[tu].sum()
        res["placebo_leak_tdAtt"] = {"test_dev_with_own_fight_in_fit": r(pdev(ys, mu * s)[te].sum(), 6),
                                     "test_dev_walk_forward": res["families"]["tdAtt"]["opp_adjusted"]["test_dev"],
                                     "note": "fitting through the fight's own date leaks the outcome; the gap shows "
                                             "the check would catch a leak"}
        print("placebo", res["placebo_leak_tdAtt"])
    res["runtime_s"] = round(time.time() - t0, 1)
    o["fresh"] = res
    save_out(o)


# ====================================================================== part 2: attribution with oppadj's own code
def part_attrib(args):
    import pickle
    import oppadj as O
    t0 = time.time()
    p = O.engine_params()
    D = O.Data(p)
    D.sides_by_date = O._sides_by_date(D)
    ev = O.Evaluator(D, p)
    with open(args.cache, "rb") as fh:
        raw, G, hls, kg = pickle.load(fh)
    opp = json.load(open(os.path.join(OUT, "oppadj.json")))
    fams = opp["results"]["families"]
    o = load_out()
    res = {"families": {}}
    Ss = {730: D.s_S}
    need_hl = set()
    for nm in fams:
        need_hl |= {c[0] for c in raw[nm]}
    for hl in sorted(need_hl):
        if hl not in Ss:
            t1 = time.time()
            Ss[hl] = D.side_sums(hl)
            print("side sums hl %d: %.0f s" % (hl, time.time() - t1))
    te_all = D.s_test

    # the cached grid may cover more backtest entries than today's backtest.json (it was built before the 2026
    # vault entries were removed from that file): map the cached side arrays onto today's entries by fight id
    old_ids = list(opp["snapshots"].keys())
    pos = {fid: i for i, fid in enumerate(old_ids)}
    sel = np.array([2 * pos[e["id"]] + s for e in D.entries for s in (0, 1)], int)
    assert len(next(iter(G.values()))[0]) == 2 * len(old_ids), "cached grid does not match oppadj.json snapshots"

    def arrs(nm, c, mode="full"):
        if mode == "full":
            return tuple(a.astype(float)[sel] for a in G[(nm,) + tuple(c) + ("full",)][:3])
        hl, ko, kd = c
        return (G[(nm, hl, ko, ko, "nosos")][0].astype(float)[sel], G[(nm, hl, kd, kd, "nosos")][1].astype(float)[sel],
                G[(nm, hl, ko, ko, "nosos")][2].astype(float)[sel])

    def raw_pred(nm, c):
        kind, (fo, fd), kname = O.FAMILIES[nm][:3]
        R = O.fighter_rates(Ss[c[0]], D.sL, p, k={kname: {fo: c[1], fd: c[2]}})
        return ev.pred_raw(nm, R), R

    def comb_mask(nm, terms, mask):
        """O.comb_fit on an arbitrary mask (the analyst's version is tune-only)."""
        f = ev.fam[nm]
        sv = f["tune"]
        f["tune"] = mask
        try:
            return O.comb_fit(ev, nm, terms)
        finally:
            f["tune"] = sv

    for nm, A in fams.items():
        kind = O.FAMILIES[nm][0]
        f = ev.fam[nm]
        te = f["test"]
        tu = f["tune"]
        cfgs = [(c["half_life_days"], c["k_offense"], c["k_defense"]) for c in A["chosen"]["configs"]]
        avg = len(cfgs) > 1
        pe = ev.pred_raw(nm, ev.engine_R)
        pa = O.avg_preds(kind, [ev.pred_adj(nm, *arrs(nm, c)) for c in cfgs])
        rt = A["deviance"]["raw_tuned"]
        rc = (rt["half_life_days"], rt["k_offense"], rt["k_defense"])
        pr_single, Rr = raw_pred(nm, rc)
        sc = {k: ev.score(nm, v) for k, v in (("engine", pe), ("adj", pa), ("raw_single", pr_single))}
        out = {"averaged": avg, "configs": cfgs}
        if avg:
            # the same averaging for the baselines: each half-life at its own best k on 2019-2023
            raw_cfg = {hl: min((c for c in raw[nm] if c[0] == hl), key=lambda c: raw[nm][c]["tune"]) for hl in hls}
            pr_avg = O.avg_preds(kind, [raw_pred(nm, c)[0] for c in raw_cfg.values()])
            nos = {}
            for hl in hls:
                cand = [(hl, a_, b_) for a_ in kg[nm] for b_ in kg[nm]]
                nos[hl] = min(cand, key=lambda c: ev.score(nm, ev.pred_adj(nm, *arrs(nm, c, "nosos")))["tune"])
            pn_avg = O.avg_preds(kind, [ev.pred_adj(nm, *arrs(nm, c, "nosos")) for c in nos.values()])
            bf = (A["single_vs_average_tune"]["single_best"]["half_life_days"], A["single_vs_average_tune"]["single_best"]["k_offense"],
                  A["single_vs_average_tune"]["single_best"]["k_defense"])
            pa_single = ev.pred_adj(nm, *arrs(nm, bf))
            sc["raw_avg"] = ev.score(nm, pr_avg)
            sc["nosos_avg"] = ev.score(nm, pn_avg)
            sc["adj_single"] = ev.score(nm, pa_single)
            out["raw_avg_configs"] = [list(c) for c in raw_cfg.values()]
            out["nosos_avg_configs"] = [list(c) for c in nos.values()]
            for lab, a_, b_ in (("adj_avg_vs_raw_avg", "raw_avg", "adj"), ("adj_avg_vs_nosos_avg", "nosos_avg", "adj"),
                                ("adj_single_vs_raw_single", "raw_single", "adj_single"),
                                ("raw_avg_vs_raw_single", "raw_single", "raw_avg"),
                                ("raw_avg_vs_engine", "engine", "raw_avg")):
                bd = O.boot_delta(D, sc[a_]["dev"], sc[b_]["dev"], te, 2000)
                out[lab] = {"pct_of_baseline": r(100 * bd[0] / sc[a_]["test"], 4), "delta": r(bd[0], 5),
                            "lo": r(bd[1], 5), "hi": r(bd[2], 5),
                            "tune_pct": r(100 * (sc[a_]["tune"] - sc[b_]["tune"]) / sc[a_]["tune"], 4)}
        out["test_dev"] = {k: r(v["test"], 6) for k, v in sc.items()}
        out["tune_dev"] = {k: r(v["tune"], 6) for k, v in sc.items()}
        # combination exponents: raw re-tuned on 2019-2023 (the analyst only fit engine raw and adjusted), and on
        # 2024-2025 for all three (diagnostic: is the "exponent 1 is right" claim a tune-period artefact?)
        tadj = O.avg_terms([O.adj_terms(ev, *arrs(nm, c)) for c in cfgs])
        traw = O.raw_terms(ev, nm, Rr)
        teng = O.raw_terms(ev, nm, ev.engine_R)
        out["comb_exponents"] = {
            "tune": {"engine_raw": comb_mask(nm, teng, tu), "raw_tuned": comb_mask(nm, traw, tu), "opp_adjusted": comb_mask(nm, tadj, tu)},
            "test": {"engine_raw": comb_mask(nm, teng, te), "raw_tuned": comb_mask(nm, traw, te), "opp_adjusted": comb_mask(nm, tadj, te)}}
        # oracle re-level on 2024-25 (diagnostic only): how much of the gain is level drift vs ranking
        def oracle(pred):
            if kind == "count":
                s_ = f["y"][te].sum() / pred[te].sum()
                return O.pois_dev(f["y"], pred * s_)[te].sum()
            dl = 0.0
            for _ in range(50):
                pp = O.sigm(pred[te] + dl)
                st = (f["y"][te].sum() - (f["E"][te] * pp).sum()) / max((f["E"][te] * pp * (1 - pp)).sum(), 1e-12)
                dl += st
                if abs(st) < 1e-10:
                    break
            return O.binom_dev(f["y"], f["E"], pred + dl)[te].sum()
        lam = A["chosen"]["blend_lambda"]
        pfin = O.blend(kind, pa, pe, lam)
        oe, of_ = oracle(pe), oracle(pfin)
        out["oracle_level_test"] = {"engine": r(oe, 6), "final": r(of_, 6), "final_vs_engine_pct": r(100 * (oe - of_) / oe, 4),
                                    "tune_level_final_vs_engine_pct": A["test_delta_bootstrap_95"]["final_vs_engine_raw"]["pct_of_baseline"]}
        res["families"][nm] = out
        msg = "%-9s test dev engine %.0f raw %.0f adj %.0f" % (nm, sc["engine"]["test"], sc["raw_single"]["test"], sc["adj"]["test"])
        if avg:
            msg += " | raw_avg %.0f nosos_avg %.0f adj_single %.0f | adj_avg vs raw_avg %.2f%% [%s, %s]" % (
                sc["raw_avg"]["test"], sc["nosos_avg"]["test"], sc["adj_single"]["test"],
                out["adj_avg_vs_raw_avg"]["pct_of_baseline"], out["adj_avg_vs_raw_avg"]["lo"], out["adj_avg_vs_raw_avg"]["hi"])
        print(msg)
        print("   comb a (tune eng/raw/adj): %.2f %.2f %.2f | (test): %.2f %.2f %.2f | oracle-level gain %.2f%% vs %.2f%%" % (
            out["comb_exponents"]["tune"]["engine_raw"]["a"], out["comb_exponents"]["tune"]["raw_tuned"]["a"],
            out["comb_exponents"]["tune"]["opp_adjusted"]["a"], out["comb_exponents"]["test"]["engine_raw"]["a"],
            out["comb_exponents"]["test"]["raw_tuned"]["a"], out["comb_exponents"]["test"]["opp_adjusted"]["a"],
            out["oracle_level_test"]["final_vs_engine_pct"], out["oracle_level_test"]["tune_level_final_vs_engine_pct"]))
        o["attrib"] = res
        save_out(o)

    # ML stack: does the gain over the ML rates come from the opponent adjustment or from re-tuned/averaged raw
    # rates? Same protocol as oppadj.py (coefficient fit on 2019-2023, scored on 2024-25), x from either source.
    mo = json.load(open(os.path.join(OUT, "mlrates_oof.json")))
    tg = mo["meta"]["targets"]
    MLMAP = {"dAtt": "d_att", "ctrl": "ctrl", "tdAtt": "td_att", "accH": "acc_h"}
    mins_ = D.V[D.s_row][:, O.KI["min"]]
    mlres = {}
    for nm, t in MLMAP.items():
        A = fams[nm]
        kind = O.FAMILIES[nm][0]
        f = ev.fam[nm]
        jt = tg.index(t)
        mlr = np.array([mo["fights"][e["id"]][sd][jt] if e["id"] in mo["fights"] else np.nan
                        for e in D.entries for sd in ("A", "B")], float)
        cfgs = [(c["half_life_days"], c["k_offense"], c["k_defense"]) for c in A["chosen"]["configs"]]
        pe = ev.pred_raw(nm, ev.engine_R)
        pa = O.avg_preds(kind, [ev.pred_adj(nm, *arrs(nm, c)) for c in cfgs])
        pfin = O.blend(kind, pa, pe, A["chosen"]["blend_lambda"])
        if len(cfgs) > 1:
            raw_cfg = {hl: min((c for c in raw[nm] if c[0] == hl), key=lambda c: raw[nm][c]["tune"]) for hl in hls}
            praw = O.avg_preds(kind, [raw_pred(nm, c)[0] for c in raw_cfg.values()])
        else:
            rt = A["deviance"]["raw_tuned"]
            praw = raw_pred(nm, (rt["half_life_days"], rt["k_offense"], rt["k_defense"]))[0]
        y = f["y"]
        if kind == "count":
            n_ = mins_
            off = np.log(np.maximum(n_ * mlr, 1e-12))
            xs = {"oppadj_final": np.log(np.maximum(pfin, 1e-12) / np.maximum(pe, 1e-12)),
                  "raw_retuned": np.log(np.maximum(praw, 1e-12) / np.maximum(pe, 1e-12))}
            okm = np.isfinite(mlr) & (mlr > 0) & (pe > 0) & (pfin > 0) & (praw > 0)
        else:
            n_ = f["E"]
            off = O.logit(np.clip(mlr, 1e-6, 1 - 1e-6))
            xs = {"oppadj_final": pfin - pe, "raw_retuned": praw - pe}
            okm = np.isfinite(mlr)
        tu, te = f["tune"] & okm, f["test"] & okm

        def fitp(cols, m):
            X = np.column_stack([np.ones(m.sum())] + [c[m] for c in cols])
            b = np.zeros(X.shape[1])
            for _ in range(80):
                if kind == "count":
                    mu = np.exp(X @ b + off[m]); W, rr = mu, y[m] - mu
                else:
                    pp = O.sigm(X @ b + off[m]); W, rr = n_[m] * pp * (1 - pp) + 1e-12, y[m] - n_[m] * pp
                st = np.linalg.solve((X.T * W) @ X + 1e-9 * np.eye(X.shape[1]), X.T @ rr)
                b += st
                if np.abs(st).max() < 1e-10:
                    break
            return b

        def devs(b, cols):
            X = np.column_stack([np.ones(len(y))] + list(cols))
            z = X @ b + off
            return O.pois_dev(y, np.exp(z)) if kind == "count" else O.binom_dev(y, n_, z)

        d0 = devs(fitp([], tu), [])
        row = {"test_dev_ml": r(d0[te].sum(), 6)}
        dd = {}
        for lab, x in xs.items():
            b1 = fitp([x], tu)
            d1 = devs(b1, [x])
            dd[lab] = d1
            bt_ = O.boot_delta(D, d0, d1, te, 2000)
            row[lab] = {"beta_tune": r(b1[1]), "gain_pct": r(100 * bt_[0] / d0[te].sum(), 4), "gain_95": [r(bt_[1], 5), r(bt_[2], 5)]}
        b2 = fitp([xs["raw_retuned"], xs["oppadj_final"]], tu)
        d2 = devs(b2, [xs["raw_retuned"], xs["oppadj_final"]])
        bt2 = O.boot_delta(D, dd["raw_retuned"], d2, te, 2000)
        row["oppadj_on_top_of_ml_and_raw_retuned"] = {"betas_tune": [r(b2[1]), r(b2[2])],
                                                      "gain_pct_vs_ml_plus_raw": r(100 * bt2[0] / dd["raw_retuned"][te].sum(), 4),
                                                      "gain_95": [r(bt2[1], 5), r(bt2[2], 5)]}
        mlres[nm] = row
        print("ML %-6s oppadj %.2f%% %s | raw re-tuned %.2f%% %s | oppadj beyond ML+raw %.2f%% %s" % (
            nm, row["oppadj_final"]["gain_pct"], row["oppadj_final"]["gain_95"], row["raw_retuned"]["gain_pct"],
            row["raw_retuned"]["gain_95"], row["oppadj_on_top_of_ml_and_raw_retuned"]["gain_pct_vs_ml_plus_raw"],
            row["oppadj_on_top_of_ml_and_raw_retuned"]["gain_95"]))
    res["over_mlrates"] = mlres
    res["runtime_s"] = round(time.time() - t0, 1)
    o["attrib"] = res
    save_out(o)


# ====================================================================== part 3: Volkanovski vs Gaethje division mismatch
def part_vg(args):
    import oppadj as O
    p = O.engine_params()
    fj = json.load(open(os.path.join(OUT, "fighters.json")))
    opp = json.load(open(os.path.join(OUT, "oppadj.json")))
    rec = opp["results"]["recommendation"]["families"]
    lp = json.load(open(os.path.join(OUT, "priors.json")))["priors"]

    def prior(div):
        P = dict(lp["ALL"])
        P.update({k: v for k, v in lp[div].items() if v is not None})
        return P
    keys = [("live", "Featherweight"), ("live", "Lightweight")]
    pbk = {k: prior(k[1]) for k in keys}
    out = {}
    for slug in ("alexander-volkanovski", "justin-gaethje"):
        S = np.array([fj["fighters"][slug]["S"]] * 2, float)
        L = O.LTable(keys, pbk, p)
        R = O.fighter_rates(S, L, p)
        home = fj["fighters"][slug]["division"]
        h, x = (0 if home == "Featherweight" else 1), 1      # x = the bout division (Lightweight)
        # count factors: F = (Lbar exp(c/2 + o) / R)^lam * kappa. Moving the bout division changes Lbar and R:
        # the factor the engine should use at the bout division is F_home * ((Lbar_x / Lbar_h) * (R_h / R_x))^lam
        cmp_ = {}
        for nm, fld_pair in (("dAtt", ("dAtt", "dAttAg")), ("cAtt", ("cAtt", "cAttAg")), ("gAtt", ("gAtt", "gAttAg")),
                             ("tdAtt", ("tdAtt", "tdAttAg")), ("ctrl", ("ctrl", "octrl"))):
            lam = rec[nm]["engine_path_lambda"]
            base = O.family_base(nm, L)
            for fld in fld_pair:
                corr = ((base[x] / base[h]) * (R[fld][h] / R[fld][x])) ** lam
                cmp_[fld] = {"roster_factor": opp["roster"][slug][fld], "x_bout_division_correction": r(corr, 4),
                             "factor_at_bout_division": r(opp["roster"][slug][fld] * corr, 4)}
        # takedown success odds: shift = logit R.tdAcc - logit league; league and R change with division
        lam = rec["tdAcc"]["engine_path_lambda"]
        for fld in ("tdAcc", "tdAccAg"):
            lb = O.logit(L.P_td_acc)
            corr = math.exp(lam * ((lb[x] - lb[h]) - (O.logit(R[fld][x]) - O.logit(R[fld][h]))))
            cmp_[fld] = {"roster_factor": opp["roster"][slug][fld], "x_bout_division_correction": r(corr, 4),
                         "factor_at_bout_division": r(opp["roster"][slug][fld] * corr, 4)}
        # accuracy odds (head, leg): F = exp(lam * (c/2 + a - accSh) + kappa'); accSh depends on the division's
        # accuracy table, so the bout-division factor is F_home * exp(-lam * (accSh_x - accSh_h))
        for t, nm in ((0, "accH"), (2, "accL")):
            lam = rec[nm]["engine_path_lambda"]
            for lab, key in (("acc", "accSh"), ("accAg", "accAgSh")):
                corr = math.exp(-lam * (R[key][x, t] - R[key][h, t]))
                cmp_["%s[%d]" % (lab, t)] = {"roster_factor": opp["roster"][slug][lab][t], "x_bout_division_correction": r(corr, 4),
                                             "factor_at_bout_division": r(opp["roster"][slug][lab][t] * corr, 4)}
        out[slug] = {"home_division": home, "bout_division": "Lightweight", "fields": cmp_}
        print(slug, home, {k: v["x_bout_division_correction"] for k, v in cmp_.items()})
    o = load_out()
    o["vg_division"] = out
    save_out(o)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--part", required=True, choices=["fresh", "attrib", "vg"])
    ap.add_argument("--families", default="tdAtt,ctrl,dAtt")
    ap.add_argument("--cache", default="")
    ap.add_argument("--no-placebo", action="store_true")
    args = ap.parse_args()
    {"fresh": part_fresh, "attrib": part_attrib, "vg": part_vg}[args.part](args)


if __name__ == "__main__":
    main()
