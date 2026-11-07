#!/usr/bin/env python3
"""v8_gate.py: scores engine v8's TRAIN gate from a tools/v8_gate.js harness file (docs/V6_V10_PLAN.md cycle 3
"Train-only acceptance test"; 7.1 item 10: rules committed before the binding run, the binding run happens once, 20,000
event-cluster resamples with seed 7, Monte Carlo SE of every bound, a bound within 2 MC SE of its threshold is decided by the
clustered normal bound; the helpers are tools/predict_score.py's).

    python3 tools/v8_gate.py pit   <harness.json>                       # PIT coverage and means per arm (spread-sd fit, dev runs)
    python3 tools/v8_gate.py score <harness.json> --out <score.json>    # the gate (RULES below)

Definitions are tools/evalv.js's: P(A wins) = (A wins + 0.5) / (decisive sims + 1) clipped to [0.005, 0.995]; 7-bin and method
probabilities smoothed with one pseudo-simulation spread over the corner-symmetric TRAIN base distribution; per-fighter Poisson
deviance of the real total vs the simulated mean (unconditional on fight length) averaged over both fighters; MAE likewise.
"""
import argparse
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import predict_score as PS  # noqa: E402  (cluster_boot, ci, ci_mcse, normal_ci, check_upper; BOOT = 20,000 / seed 7)

STATS = ["sig_lnd", "sig_att", "h_lnd", "b_lnd", "l_lnd", "kd", "td_lnd", "td_att", "ctrl", "sub_att"]
NS = len(STATS)

# ====================================================================== RULES (pre-registered; data/derived/v8/gate_protocol.json)
RULES = {
    "comparator": "cmp4 = every v8 flag off (= engine 4.0.0, tests/test_v8.js) on the same honest inputs, same fights, common random numbers",
    "contrasts": "sub-part x: arm 'all' minus arm '-x' (leave-one-out, paired); package: the kept configuration minus cmp4",
    "total_deviance": "per fight: mean over the 10 stats of (per-fighter Poisson deviance / cmp4's train mean deviance of that stat); "
                      "x100 = mean relative change in %; the plan's 'total 10-stat Poisson deviance' (raw sum reported too)",
    "mean_moving_subparts": ["embed", "retarget"],
    "spread_subparts": {"tdIntent": "td_att", "ctrlSpread": "ctrl"},
    "keep_mean_moving": {
        "K1": "total relative deviance: CI upper < 0",
        "K2": "no single stat worse: for each of the 10 stats, the deviance difference's CI lower bound <= 0",
        "K3": "TD and control MAE not worse beyond the CI: td_lnd, td_att and ctrl MAE difference CI lower bound <= 0",
        "K4": "TD-attempt PIT of the arm with the sub-part (fight-sides, randomized PIT): inside the 80% band >= 0.78 and above P90 <= 0.12",
        "K5": "winner log loss, 7-bin and method: CI upper <= +0.002",
        "K6": "base rates of the arm with the sub-part (train, pooled): KO share +-0.02, SUB +-0.015, DEC +-0.035, KD per 100 head +-12% rel, "
              "TD per 15 +-10% rel, control per 15 +-10% rel of actual (mlcal tolerances; DEC = KO + SUB tolerance since its error is "
              "minus their sum and the draw share's)"},
    "keep_spread": {
        "S1": "its stat's PIT calibration error CE = |in80 - 0.80| + |>P90 - 0.10| + |<P10 - 0.10| (fight-sides) is lower with the "
              "sub-part: CI upper of the CE difference < 0 (CE recomputed per resample)",
        "S2": "deviance not worse in the plan's gate sense ('no single stat worse', 'not worse beyond the CI'): the total relative "
              "deviance difference and every one of the 10 stats' deviance differences have a CI lower bound <= 0",
        "K3-K6": "as for the mean-moving sub-parts",
        "why": "a mean-preserving spread draw cannot lower the deviance of the mean by construction, and the plan's PIT criterion (K4) "
               "needs the TD-intent draw; reading K1 literally for these sub-parts would make the cycle's own criteria contradict "
               "each other, so their improvement criterion is the purpose they serve (PIT), and the deviance criterion is 'not worse' "
               "in the same CI sense the plan uses for 'no single stat worse' and the MAE criterion (a 0.5%-of-level bound, as in "
               "V6_V10_PLAN 6.3, is narrower than the paired train CI of the large counts, so a sub-part with no effect would fail it)"},
    "package": "the kept configuration vs cmp4 must pass K1-K6 (as a package); the version's gate PASSES only if at least one sub-part "
               "is kept and the package passes",
    "final_configuration": "kept = all four -> arm 'all'; three -> arm '-x'; otherwise one pre-registered confirmation run of the kept "
                           "configuration (same command, arms cmp4 + final) is binding for the package check",
    "bootstrap": "20,000 event-cluster resamples (card = event + date), seed 7; Monte Carlo SE of each bound (10 batches); a bound within "
                 "2 MC SE of its threshold is decided by the clustered normal bound",
    "tests": "every test listed in the protocol must pass on the candidate files before the binding run",
}
TOL = {"KO": (0.02, False), "SUB": (0.015, False), "DEC": (0.035, False), "kd100": (0.12, True), "td15": (0.10, True), "ctrl15": (0.10, True)}


def outcome_base(fights):
    """evalv.js baseDist: corner-symmetric outcome shares from the TRAIN fights (smoothing prior)."""
    c = {"KO": 0, "SUB": 0, "DEC": 0, "DRAW": 0}
    byR = {3: {"ko": [0] * 3, "sub": [0] * 3, "dec": 0, "draw": 0, "n": 0}, 5: {"ko": [0] * 5, "sub": [0] * 5, "dec": 0, "draw": 0, "n": 0}}
    n = 0
    for f in fights:
        y = f["outcome"]
        if not y:
            continue
        c[y["cls"]] += 1
        n += 1
        R = f["rounds"]
        q = byR[R]
        q["n"] += 1
        r = min(R, y["round"]) - 1
        if y["cls"] == "KO":
            q["ko"][r] += 1
        elif y["cls"] == "SUB":
            q["sub"][r] += 1
        elif y["cls"] == "DEC":
            q["dec"] += 1
        else:
            q["draw"] += 1
    b7 = [v / n for v in (c["KO"] / 2, c["SUB"] / 2, c["DEC"] / 2, c["DRAW"], c["DEC"] / 2, c["SUB"] / 2, c["KO"] / 2)]
    cells = {}
    for R in (3, 5):
        q = byR[R]
        m = max(1, q["n"])
        v = [x / 2 / m for x in q["ko"]] + [x / 2 / m for x in q["sub"]] + [x / 2 / m for x in q["ko"]] + [x / 2 / m for x in q["sub"]]
        v += [q["dec"] / 2 / m, q["dec"] / 2 / m, q["draw"] / m]
        s = sum(v) or 1
        cells[R] = [(x + 1e-4) / (s + 1e-4 * len(v)) for x in v]
    return {"b7": b7, "cells": cells}


def pois_dev(y, mu):
    mu = max(mu, 1e-6)
    return 2 * ((y * math.log(y / mu) if y > 0 else 0) - (y - mu))


def per_fight(a, f, base):
    R, n, c = f["rounds"], a["n"], a["cells"]
    s = lambda i, j: sum(c[i:j])
    aKO, aSUB, bKO, bSUB = s(0, R), s(R, 2 * R), s(2 * R, 3 * R), s(3 * R, 4 * R)
    aDEC, bDEC, DR = c[4 * R], c[4 * R + 1], c[4 * R + 2]
    raw7 = [aKO, aSUB, aDEC, DR, bDEC, bSUB, bKO]
    b7 = [(v + base["b7"][i]) / (n + 1) for i, v in enumerate(raw7)]
    aW, bW = aKO + aSUB + aDEC, bKO + bSUB + bDEC
    pA = min(0.995, max(0.005, (aW + 0.5) / (aW + bW + 1)))
    return {"pA": pA, "b7": b7, "pKO": (aKO + bKO) / n, "pSUB": (aSUB + bSUB) / n, "pDEC": (aDEC + bDEC + DR) / n}


def losses(f, a, base):
    pf = per_fight(a, f, base)
    L = {}
    y = f["outcome"]
    if y:
        k7 = 3 if y["cls"] == "DRAW" else (2 if y["winner"] == "A" else 4) if y["cls"] == "DEC" else (1 if y["winner"] == "A" else 5) if y["cls"] == "SUB" else (0 if y["winner"] == "A" else 6)
        L["bin7"] = -math.log(pf["b7"][k7])
        s3 = {"KO": pf["b7"][0] + pf["b7"][6], "SUB": pf["b7"][1] + pf["b7"][5], "DEC": pf["b7"][2] + pf["b7"][3] + pf["b7"][4]}
        L["method"] = -math.log(s3["DEC" if y["cls"] == "DRAW" else y["cls"]])
        if y["winner"] in ("A", "B"):
            yy = 1 if y["winner"] == "A" else 0
            p = pf["pA"]
            L["winLL"] = -(yy * math.log(p) + (1 - yy) * math.log(1 - p))
        L["_ko"], L["_sub"], L["_dec"] = pf["pKO"], pf["pSUB"], pf["pDEC"]
        L["_aKO"], L["_aSUB"], L["_aDEC"] = float(y["cls"] == "KO"), float(y["cls"] == "SUB"), float(y["cls"] in ("DEC", "DRAW"))
        L["_n"] = 1.0
    act = f.get("actual")
    if act and act.get("A") and act.get("B"):
        st = a["st"]
        for k, sk in enumerate(STATS):
            ya, yb = act["A"].get(sk), act["B"].get(sk)
            if ya is None or yb is None:
                continue
            L["dev_" + sk] = 0.5 * (pois_dev(ya, st[k]) + pois_dev(yb, st[NS + k]))
            L["mae_" + sk] = 0.5 * (abs(ya - st[k]) + abs(yb - st[NS + k]))
        # base-rate pieces (sums over both fighters)
        L["_skd"], L["_shl"] = st[STATS.index("kd")] + st[NS + STATS.index("kd")], st[STATS.index("h_lnd")] + st[NS + STATS.index("h_lnd")]
        L["_akd"], L["_ahl"] = act["A"]["kd"] + act["B"]["kd"], act["A"]["h_lnd"] + act["B"]["h_lnd"]
        L["_std"], L["_atd"] = st[STATS.index("td_lnd")] + st[NS + STATS.index("td_lnd")], act["A"]["td_lnd"] + act["B"]["td_lnd"]
        L["_sct"], L["_act"] = st[STATS.index("ctrl")] + st[NS + STATS.index("ctrl")], act["A"]["ctrl"] + act["B"]["ctrl"]
        L["_smin"], L["_amin"] = a["mins"], float(act.get("minutes") or 0)
        # PIT indicators per stat (sums over the two fighters; nan-safe counts)
        for k, sk in enumerate(STATS):
            ps = [a["pit"][k], a["pit"][NS + k]]
            ps = [p for p in ps if p is not None]
            if not ps:
                continue
            L["pin_" + sk] = float(sum(1 for p in ps if 0.1 <= p <= 0.9))
            L["phi_" + sk] = float(sum(1 for p in ps if p > 0.9))
            L["plo_" + sk] = float(sum(1 for p in ps if p < 0.1))
            L["pn_" + sk] = float(len(ps))
    return L


def load(path):
    H = json.load(open(path))
    fights = [f for f in H["fights"] if not f.get("err")]
    assert all(f["date"] < "2024-01-01" for f in fights), "a non-train fight in the harness file"
    return H, fights


def table(H, fights):
    base = outcome_base(fights)
    arms = H["meta"]["arms"]
    Ls = {arm: [losses(f, f["arms"][arm], base) for f in fights] for arm in arms}
    groups = [f["event"] + "|" + f["date"] for f in fights]
    return arms, Ls, groups


def col(L, k):
    return np.array([l.get(k, np.nan) for l in L], float)


def pit_summary(L):
    out = {}
    for sk in STATS:
        n = np.nansum(col(L, "pn_" + sk))
        if n <= 0:
            continue
        i80, hi, lo = np.nansum(col(L, "pin_" + sk)) / n, np.nansum(col(L, "phi_" + sk)) / n, np.nansum(col(L, "plo_" + sk)) / n
        out[sk] = {"in80": round(float(i80), 4), "gtP90": round(float(hi), 4), "ltP10": round(float(lo), 4), "n": int(n),
                   "ce": round(abs(i80 - 0.8) + abs(hi - 0.1) + abs(lo - 0.1), 4)}
    return out


def base_rates(L):
    s = lambda k: float(np.nansum(col(L, k)))
    n = s("_n")
    br = {"KO": (s("_ko") / n, s("_aKO") / n), "SUB": (s("_sub") / n, s("_aSUB") / n), "DEC": (s("_dec") / n, s("_aDEC") / n),
          "kd100": (100 * s("_skd") / s("_shl"), 100 * s("_akd") / s("_ahl")),
          "td15": (15 * s("_std") / 2 / s("_smin"), 15 * s("_atd") / 2 / s("_amin")),
          "ctrl15": (15 * s("_sct") / 2 / s("_smin"), 15 * s("_act") / 2 / s("_amin"))}
    out = {}
    for k, (sim, act) in br.items():
        tol, rel = TOL[k]
        t = tol * act if rel else tol
        out[k] = {"sim": round(sim, 5), "actual": round(act, 5), "err": round(sim - act, 5), "tol": round(t, 5), "inside": bool(abs(sim - act) <= t)}
    return out


def cmd_pit(a):
    H, fights = load(a.harness)
    arms, Ls, _ = table(H, fights)
    print("%d fights, arms %s" % (len(fights), arms))
    for arm in arms:
        P = pit_summary(Ls[arm])
        dv = {sk: round(float(np.nanmean(col(Ls[arm], "dev_" + sk))), 3) for sk in STATS}
        br = base_rates(Ls[arm])
        print("%-28s td_att in80 %.3f >P90 %.3f <P10 %.3f CE %.3f | ctrl in80 %.3f >P90 %.3f <P10 %.3f CE %.3f | dev td_att %.3f ctrl %.2f | td15 %.3f/%.3f ctrl15 %.1f/%.1f"
              % (arm, P["td_att"]["in80"], P["td_att"]["gtP90"], P["td_att"]["ltP10"], P["td_att"]["ce"], P["ctrl"]["in80"], P["ctrl"]["gtP90"],
                 P["ctrl"]["ltP10"], P["ctrl"]["ce"], dv["td_att"], dv["ctrl"], br["td15"]["sim"], br["td15"]["actual"], br["ctrl15"]["sim"], br["ctrl15"]["actual"]))
    if a.out:
        json.dump({arm: {"pit": pit_summary(Ls[arm]), "base_rates": base_rates(Ls[arm]),
                         "dev": {sk: float(np.nanmean(col(Ls[arm], "dev_" + sk))) for sk in STATS}} for arm in arms}, open(a.out, "w"), indent=1)


# ---------------------------------------------------------------------- paired contrasts
def paired(groups, La, Lb, keys, norm=None):
    """Paired differences a - b for each key (rows where both are finite), bootstrap CI + MC SE + clustered normal CI."""
    out = {}
    for k in keys:
        if k == "total":
            da = np.array([np.mean([la["dev_" + s] / norm[s] for s in STATS]) if all(("dev_" + s) in la for s in STATS) else np.nan for la in La])
            db = np.array([np.mean([lb["dev_" + s] / norm[s] for s in STATS]) if all(("dev_" + s) in lb for s in STATS) else np.nan for lb in Lb])
        elif k == "total_raw":
            da = np.array([sum(la["dev_" + s] for s in STATS) if all(("dev_" + s) in la for s in STATS) else np.nan for la in La])
            db = np.array([sum(lb["dev_" + s] for s in STATS) if all(("dev_" + s) in lb for s in STATS) else np.nan for lb in Lb])
        else:
            da, db = col(La, k), col(Lb, k)
        d = da - db
        ok = np.isfinite(d)
        g = [groups[i] for i in range(len(groups)) if ok[i]]
        v = d[ok]
        bs = PS.cluster_boot(g, {"d": v})["d"]
        out[k] = {"diff": round(float(v.mean()), 6), "ci": [round(float(np.percentile(bs, 2.5)), 6), round(float(np.percentile(bs, 97.5)), 6)],
                  "ci_mcse": PS.ci_mcse(bs), "normal": PS.normal_ci(g, v, np.ones(len(v))), "n": int(len(v))}
    return out


def pit_ce_diff(groups, La, Lb, sk):
    """CE(with) - CE(without) for stat sk, recomputed per resample from the share sums (same event-cluster draws)."""
    cols = {}
    for tag, L in (("a", La), ("b", Lb)):
        for q in ("pin", "phi", "plo", "pn"):
            cols[tag + q] = np.nan_to_num(col(L, q + "_" + sk))
    # cluster_boot returns resampled MEANS of each column (sum / rows); shares are ratios of those means
    bs = PS.cluster_boot(groups, cols)

    def ce(t, src):
        n = src[t + "pn"]
        return np.abs(src[t + "pin"] / n - 0.8) + np.abs(src[t + "phi"] / n - 0.1) + np.abs(src[t + "plo"] / n - 0.1)
    d = ce("a", bs) - ce("b", bs)
    pt = {k: v.mean() for k, v in cols.items()}
    est = float(ce("a", pt) - ce("b", pt))
    return {"diff": round(est, 6), "ci": [round(float(np.percentile(d, 2.5)), 6), round(float(np.percentile(d, 97.5)), 6)], "ci_mcse": PS.ci_mcse(d)}


def check_lower(d, thr):
    """'CI lower bound <= thr' (not significantly worse), with the marginal rule mirrored from check_upper."""
    lb, mc = d["ci"][0], (d.get("ci_mcse") or [0, 0])[0]
    nb = (d.get("normal") or {}).get("ci", [None, None])[0]
    marginal = abs(lb - thr) < 2 * mc
    use = nb if (marginal and nb is not None) else lb
    return {"pass": bool(use <= thr), "boot_lower": lb, "mcse_lower": mc, "normal_lower": nb, "threshold": thr, "marginal": bool(marginal),
            "decided_by": "normal" if (marginal and nb is not None) else "bootstrap"}


def contrast(groups, La, Lb, norm, kind, spread_stat=None):
    keys = ["total", "total_raw", "winLL", "bin7", "method"] + ["dev_" + s for s in STATS] + ["mae_" + s for s in STATS]
    P = paired(groups, La, Lb, keys, norm)
    C = {}
    pitA = pit_summary(La)
    brA = base_rates(La)
    if kind == "mean":
        C["K1 total relative deviance: CI upper < 0"] = PS.check_upper(P["total"], 0.0, True)
        for s in STATS:
            C["K2 dev_%s not worse: CI lower <= 0" % s] = check_lower(P["dev_" + s], 0.0)
    else:
        ce = pit_ce_diff(groups, La, Lb, spread_stat)
        P["pit_ce_" + spread_stat] = ce
        C["S1 PIT calibration error of %s improves: CI upper < 0" % spread_stat] = PS.check_upper(ce, 0.0, True)
        C["S2 total relative deviance not worse: CI lower <= 0"] = check_lower(P["total"], 0.0)
        for s in STATS:
            C["S2 dev_%s not worse: CI lower <= 0" % s] = check_lower(P["dev_" + s], 0.0)
    for s in ("td_lnd", "td_att", "ctrl"):
        C["K3 mae_%s not worse: CI lower <= 0" % s] = check_lower(P["mae_" + s], 0.0)
    C["K4 TD-attempt PIT: in80 >= 0.78"] = {"pass": bool(pitA["td_att"]["in80"] >= 0.78), "value": pitA["td_att"]["in80"]}
    C["K4 TD-attempt PIT: >P90 <= 0.12"] = {"pass": bool(pitA["td_att"]["gtP90"] <= 0.12), "value": pitA["td_att"]["gtP90"]}
    for k in ("winLL", "bin7", "method"):
        C["K5 %s: CI upper <= +0.002" % k] = PS.check_upper(P[k], 0.002, False)
    for k, v in brA.items():
        C["K6 base rate %s inside tolerance" % k] = {"pass": v["inside"], "sim": v["sim"], "actual": v["actual"], "tol": v["tol"]}
    ok = all(c["pass"] for c in C.values())
    return {"pass": ok, "failed": [k for k, c in C.items() if not c["pass"]], "checks": C, "paired": P, "pit_with": pitA, "pit_without": pit_summary(Lb),
            "base_rates_with": brA, "base_rates_without": base_rates(Lb)}


def cmd_score(a):
    H, fights = load(a.harness)
    arms, Ls, groups = table(H, fights)
    assert "cmp4" in arms
    norm = {s: float(np.nanmean(col(Ls["cmp4"], "dev_" + s))) for s in STATS}
    out = {"meta": {"tool": "tools/v8_gate.py score", "harness": a.harness, "harness_meta": H["meta"], "n_fights": len(fights),
                    "failed_fights": sum(1 for f in H["fights"] if f.get("err")), "boot": PS.BOOT, "norm_dev_cmp4": norm},
           "rules": RULES, "subparts": {}, "levels": {}}
    for arm in arms:
        out["levels"][arm] = {"dev": {s: round(float(np.nanmean(col(Ls[arm], "dev_" + s))), 4) for s in STATS},
                              "mae": {s: round(float(np.nanmean(col(Ls[arm], "mae_" + s))), 4) for s in STATS},
                              "winLL": round(float(np.nanmean(col(Ls[arm], "winLL"))), 5), "bin7": round(float(np.nanmean(col(Ls[arm], "bin7"))), 5),
                              "method": round(float(np.nanmean(col(Ls[arm], "method"))), 5), "pit": pit_summary(Ls[arm]), "base_rates": base_rates(Ls[arm])}
    kept = []
    if "all" in arms:
        for x in RULES["mean_moving_subparts"] + list(RULES["spread_subparts"]):
            if "-" + x not in arms:
                continue
            kind = "mean" if x in RULES["mean_moving_subparts"] else "spread"
            r = contrast(groups, Ls["all"], Ls["-" + x], norm, kind, RULES["spread_subparts"].get(x))
            out["subparts"][x] = r
            if r["pass"]:
                kept.append(x)
    out["kept"] = kept
    allx = RULES["mean_moving_subparts"] + list(RULES["spread_subparts"])
    dropped = [x for x in allx if x not in kept]
    final = "all" if not dropped else ("-" + dropped[0] if len(dropped) == 1 else None)
    if a.final_arm:
        final = a.final_arm
    out["final_arm"] = final
    if not kept:
        out["package"] = None
        out["result"] = "FAIL"
        out["reason"] = "no sub-part kept"
    elif final is None or final not in arms:
        out["package"] = None
        out["result"] = "PENDING"
        out["reason"] = "the kept set %s matches no simulated arm: run the pre-registered confirmation run" % kept
    else:
        pk = contrast(groups, Ls[final], Ls["cmp4"], norm, "mean")
        out["package"] = pk
        out["result"] = "PASS" if pk["pass"] else "FAIL"
        out["reason"] = "package %s vs cmp4: %s" % (final, "all checks pass" if pk["pass"] else "failed " + ", ".join(pk["failed"]))
    json.dump(out, open(a.out, "w"), indent=1, default=float)
    print("kept sub-parts:", kept, "| final arm:", final, "| RESULT:", out["result"], "-", out["reason"])
    for x, r in out["subparts"].items():
        P = r["paired"]
        print("  %-11s %s  total %+.4f [%+.4f, %+.4f]  winLL %+.4f  bin7 %+.4f  method %+.4f%s" % (
            x, "KEEP" if r["pass"] else "drop", P["total"]["diff"], P["total"]["ci"][0], P["total"]["ci"][1], P["winLL"]["diff"],
            P["bin7"]["diff"], P["method"]["diff"], "" if r["pass"] else "  failed: " + "; ".join(r["failed"])))
    if out.get("package"):
        P = out["package"]["paired"]
        print("  package %s vs cmp4: total %+.4f [%+.4f, %+.4f]; ctrl dev %+.3f [%+.3f, %+.3f]; sig_att %+.3f; sig_lnd %+.3f; td_lnd %+.4f" % (
            final, P["total"]["diff"], P["total"]["ci"][0], P["total"]["ci"][1], P["dev_ctrl"]["diff"], P["dev_ctrl"]["ci"][0], P["dev_ctrl"]["ci"][1],
            P["dev_sig_att"]["diff"], P["dev_sig_lnd"]["diff"], P["dev_td_lnd"]["diff"]))


def main():
    ap = argparse.ArgumentParser()
    sp = ap.add_subparsers(dest="cmd", required=True)
    p1 = sp.add_parser("pit")
    p1.add_argument("harness")
    p1.add_argument("--out")
    p2 = sp.add_parser("score")
    p2.add_argument("harness")
    p2.add_argument("--out", required=True)
    p2.add_argument("--final-arm", help="(confirmation run) the arm holding the kept configuration")
    a = ap.parse_args()
    {"pit": cmd_pit, "score": cmd_score}[a.cmd](a)


if __name__ == "__main__":
    main()
