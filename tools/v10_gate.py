#!/usr/bin/env python3
"""v10_gate.py: the engine v10 BUNDLE-LEVEL train gate (data/derived/v10/gate_protocol.json). v10 = the v4 simulator + v8's stat-line
bundle as v8 shipped it + v7's prediction package (ML v2 head stacks by line regime, S2 cells, the verified props pool) + cycle 5
(newcomer path, explainer coherence). Two harness files: tools/predict_harness.js (packages v10 and cmp4, 2019-2023) and
tools/v10_stat_gate.js (engine arms cmp4 / all / leave-one-out, 2019-2023).

    python3 tools/v10_gate.py fits <predict_harness.json> [--out f.json]     pool / props weight fits of the v10 package only
                                                                             (no metric, no comparator; NON-BINDING)
    python3 tools/v10_gate.py gate <predict_harness.json> <stat_harness.json> --tests <test_v10.json> --out <score.json>
    python3 tools/v10_gate.py power <score.json> --n-look N [--effect E]
    python3 tools/v10_gate.py look <predict_harness_val.json> <stat_harness_val.json> --decide <evalv_decide v10 vs v4 val json>
                                   --gate <gate score.json> --out <look score.json>     THE v10 look (pre-registered in
                                   data/derived/version_history.json v10 prereg; written before any 2024-2025 number; run once)

RULES (written before any v10 gate metric was computed; committed with data/derived/v10/gate_protocol.json; the RULES dict below is
the binding text):
- Window: 2021-01-01..2023-12-31 (the forward-chained window: every weight that scores year Y is fit on years before Y; ML v2 head
  stacks fit2020 / fit2021 / fit2022; comparator stackers cmp_stack_v4pkg_fit<Y-1>; statlines targets fold f<Y>).
- PRIMARY: open-regime winner log loss of the v10 predict package minus the honest v4 package (cmp4, exactly as v7 defined it:
  versions/v7 engine with params.blend overridden to { winner 'stack', mrModel 'S', debut / statDist / props off }, per-year
  stackers data/derived/v7/cmp_stack_v4pkg_fit<Y-1>.json), decisive 2021-2023 fights that have an opener for both packages; paired
  difference, 20,000 event-cluster resamples (seed 7), Monte Carlo SE, a bound within 2 MC SE of its threshold decided by the
  clustered normal bound. PASS iff point < 0 AND upper <= +0.002 (V6_V10_PLAN 6.3 winner "not worse" tolerance). The props pool
  never moves the winner (bit-identical composition), so the primary rows are scored with the package's p as recorded.
- CO-PRIMARY: total stat-line relative deviance (tools/v8_gate.py definition: per fight, the mean over the 10 recorded stats of the
  per-fighter Poisson deviance divided by cmp4's mean deviance of that stat on the same fights) of arm 'all' (the v10 engine) minus
  arm 'cmp4' (every v8 flag off = engine 4.0.0) on the 2021-2023 fights of the stat harness; paired, same bootstrap and marginal rule.
  PASS iff upper <= +0.005 (+0.5% of level, 6.3 stat-line tolerance).
- INTEGRITY (preconditions, not statistical criteria): both harness runs complete with 0 failed fights; the tests named in the
  protocol passed on the frozen files before the protocol commit (--tests holds test_v10's record).
- VERDICT: PASS iff PRIMARY and CO-PRIMARY and INTEGRITY. Nothing else gates.
- DESCRIPTIVE ONLY (never gating): the other regimes (no line, close) and every other metric (Brier, accuracy, ECE, slope, 7-bin,
  method, who x how x when, round given a finish, method given the winner, P(decision)); the full package with props (props where the
  year has a forward-chained pi: 2022-2023) vs cmp4 and vs v10 without props; per-part leave-one-out of the package (props off; the
  v4 simulator's cells instead of v10's; S / SM cells instead of S2; the MoE expert-stack winner instead of the ML v2 head stack) and
  of the engine (all minus -embed / -retarget / -tdIntent on stat lines, engine winner, 7-bin, method); stat-line base rates and PIT;
  who x how x when vs methodround model S (tools/methodround.py --score); wiring checks (v10's winner equals v7's ml2stack rows;
  cmp4's records equal v7's gate cmp4 records); the look's MDE and power from the primary's paired SE.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import predict_score as PS  # noqa: E402
import v7_gate as G7  # noqa: E402
import v8_gate as G8  # noqa: E402

YEARS = (2021, 2022, 2023)
RULES = {
    "window": "2021-01-01..2023-12-31 (forward-chained: every weight scoring year Y fit on years < Y)",
    "primary": {"metric": "open-regime winner log loss", "contrast": "v10 predict package minus cmp4 (the honest v4 package exactly as v7 defined it)",
                "rows": "decisive 2021-2023 fights with an opener for both packages", "pass": "point < 0 AND paired 95% CI upper <= +0.002",
                "tolerance_source": "V6_V10_PLAN 6.3 / 7.1 item 4 winner 'not worse' tolerance"},
    "co_primary": {"metric": "total stat-line relative deviance (tools/v8_gate.py 'total')", "contrast": "stat-harness arm 'all' (v10 engine) minus arm 'cmp4' (engine 4.0.0)",
                   "rows": "2021-2023 fights of tools/v10_stat_gate.js", "pass": "paired 95% CI upper <= +0.005 (+0.5% of level)",
                   "tolerance_source": "V6_V10_PLAN 6.3 / 7.1 item 4 stat-line 'not worse' tolerance"},
    "integrity": "both harness runs: 0 failed fights; the protocol's tests passed on the frozen files before the protocol commit",
    "verdict": "PASS iff primary AND co-primary AND integrity; nothing else gates",
    "bootstrap": "20,000 event-cluster resamples (card = event + date), seed 7; Monte Carlo SE of each bound (10 batches); a bound within 2 MC SE "
                 "of its threshold is marginal and decided by the clustered normal bound (tools/predict_score.py check_upper)",
    "descriptive_only": ["no-line and close regimes", "Brier, accuracy, ECE, slope, 7-bin, method, joint, round given a finish, method given the winner, P(decision)",
                         "package with props vs cmp4 and vs v10 without props", "package leave-one-out: -props, -simulator (v4 cells), -S2 (S / SM cells), -winner (MoE stack)",
                         "engine leave-one-out: -embed, -retarget, -tdIntent", "stat-line base rates and PIT", "who x how x when vs methodround model S",
                         "wiring checks", "look MDE and power"],
}


# ------------------------------------------------------------------ helpers
def rescale(c, R, p):
    """FightBlend.rescale: P(A) / (P(A) + P(B)) = p, keeping the draw share and each side's method / round mix."""
    c = [float(x) for x in c]
    pA = sum(c[0:2 * R]) + c[4 * R]
    pB = sum(c[2 * R:4 * R]) + c[4 * R + 1]
    dec = max(1e-12, 1 - c[4 * R + 2])
    fA = p * dec / pA if pA > 0 else 0.0
    fB = (1 - p) * dec / pB if pB > 0 else 0.0
    out = c[:]
    for i in range(2 * R):
        out[i] *= fA
        out[2 * R + i] *= fB
    out[4 * R] *= fA
    out[4 * R + 1] *= fB
    return out


def add_variants(recs, v10="v10", cmp="cmp4"):
    """Pseudo packages for the descriptive package leave-one-out (composed exactly from the recorded pieces):
       v10_simv4: v10's winner and S2 cells with the v4 simulator's cells (cmp4's simR rescaled to v10's p);
       v10_S:     v10's winner and simulator cells with S / SM cells (cmp4's mrR rescaled to v10's p);
       v10_moe:   the MoE expert-stack winner (cmp4's p) with v10's cells rescaled to it."""
    for r in recs:
        if r.get("err"):
            continue
        a, b = r["pk"].get(v10) or {}, r["pk"].get(cmp) or {}
        R = r["rounds"]
        for name in ("v10_simv4", "v10_S", "v10_moe"):
            r["pk"][name] = {}
        for kind, e in a.items():
            c = b.get(kind)
            if not e or not c:
                continue
            base = {"lineMissing": e.get("lineMissing") or c.get("lineMissing"), "line": e.get("line")}
            if c.get("simR") and e.get("mrR"):
                r["pk"]["v10_simv4"][kind] = dict(base, p=e["p"], simR=rescale(c["simR"], R, e["p"]), mrR=e["mrR"], cells=e["cells"])
            if e.get("simR") and c.get("mrR"):
                r["pk"]["v10_S"][kind] = dict(base, p=e["p"], simR=e["simR"], mrR=rescale(c["mrR"], R, e["p"]), cells=e["cells"])
            if e.get("simR") and e.get("mrR"):
                r["pk"]["v10_moe"][kind] = dict(base, p=c["p"], simR=rescale(e["simR"], R, c["p"]), mrR=rescale(e["mrR"], R, c["p"]), cells=e["cells"])
    return recs


def pkg_rows(recs, kind, spec, fits, years, need_props=False):
    """G7.collect with one extra mode, 'pkg' = the package as used: the props pool where the bout has props AND the year has a
    forward-chained pi (2022-2023), else the cells (the package's documented degrade when no props weights exist)."""
    rows = []
    for r in recs:
        yr = int(r["date"][:4])
        if yr not in years or r.get("err"):
            continue
        y = G7.outcome(r)
        if y is None or (need_props and not G7.has_props(r)):
            continue
        cp, ok = {}, True
        for name, pkg, mode in spec:
            e = (r["pk"].get(pkg) or {}).get(kind)
            if not e or (kind != "none" and e.get("lineMissing")):
                ok = False
                break
            m = mode
            if mode == "pkg":
                m = "props" if (G7.has_props(r) and (fits["pi"].get(str(yr)) or {}).get("pi") is not None) else "np"
            pc = G7.package_cells(r, kind, pkg, fits, "v10", m)
            if pc is None:
                ok = False
                break
            cp[name] = (pc[0], pc[1])
        if ok:
            rows.append((r, y, cp))
    return rows


def fits_for(recs, names):
    out = {"w": {}, "pi": {}}
    for name in names:
        out["w"][name] = {str(Y): G7.fit_w(recs, name, range(2019, Y)) for Y in YEARS}
        out["w"][name]["fit_2019_2023"] = G7.fit_w(recs, name, range(2019, 2024))
    for Y in (2022, 2023):
        out["pi"][str(Y)] = G7.fit_pi(recs, "v10", range(G7.PROPS_FROM, Y), out["w"]["v10"][str(Y)]["w"])
    out["pi"]["fit_2021_2023"] = G7.fit_pi(recs, "v10", range(G7.PROPS_FROM, 2024), out["w"]["v10"]["fit_2019_2023"]["w"])
    return out


def brief(res, key):
    d = res.get("paired", {}).get(key, {})
    return {m: {"diff": v["diff"], "ci": v["ci"]} for m, v in d.items() if m in ("winLL", "brier", "acc", "bin7", "method", "joint", "rgf", "mgw")}


# ------------------------------------------------------------------ fits (non-binding)
def cmd_fits(a):
    D = json.load(open(a.harness))
    recs = D["fights"]
    names = [p["name"] for p in D["meta"]["packages"]]
    if names != ["v10"]:
        raise SystemExit("fits: run on a harness file holding the v10 package only (no comparator), got %s" % names)
    f = fits_for(recs, ["v10"])
    out = {"tool": "tools/v10_gate.py fits", "harness": os.path.relpath(a.harness, ROOT), "note": "NON-BINDING fits only: weights, no metric, no comparator",
           "w": f["w"]["v10"], "pi": f["pi"], "failed_fights": sum(1 for r in recs if r.get("err"))}
    print(json.dumps({"w": {k: v["w"] for k, v in out["w"].items()}, "pi": {k: v["pi"] for k, v in out["pi"].items()}}, indent=1))
    if a.out:
        json.dump(out, open(a.out, "w"), indent=1)


# ------------------------------------------------------------------ wiring checks
def wiring(recs):
    path = os.path.join(ROOT, "data/derived/v7/gate_train.json")
    G = {f["id"]: f for f in json.load(open(path))["fights"]}
    n = same = n4 = same4 = 0
    ex, ex4 = [], []
    for r in recs:
        g = G.get(r["id"])
        if not g or r.get("err") or g.get("err"):
            continue
        for kind, e in (r["pk"].get("v10") or {}).items():
            w = (g["pk"].get("v7") or {}).get(kind)
            if w and e.get("source") == "ml2stack" and w.get("source") == "ml2stack":
                n += 1
                if e["p"] == w["p"]:
                    same += 1
                elif len(ex) < 3:
                    ex.append([r["id"], kind, e["p"], w["p"]])
        for kind, e in (r["pk"].get("cmp4") or {}).items():
            w = (g["pk"].get("cmp4") or {}).get(kind)
            if w:
                n4 += 1
                if e["p"] == w["p"] and e["cells"] == w["cells"] and e.get("simR") == w.get("simR") and e.get("mrR") == w.get("mrR"):
                    same4 += 1
                elif len(ex4) < 3:
                    ex4.append([r["id"], kind, e["p"], w["p"]])
    return {"v10_winner_eq_v7_ml2stack": {"rows": n, "identical": same, "examples": ex, "pass": n > 0 and n == same},
            "cmp4_eq_v7_gate_cmp4": {"rows": n4, "identical": same4, "examples": ex4, "pass": n4 > 0 and n4 == same4}}


# ------------------------------------------------------------------ the gate
def cmd_gate(a):
    D = json.load(open(a.harness))
    recs = D["fights"]
    meta = D["meta"]
    names = {p["mode"]: p["name"] for p in meta["packages"]}
    assert names.get("v10") == "v10" and names.get("cmp4") == "cmp4", names
    assert all(r["date"] < "2024-01-01" for r in recs), "a non-train fight in the predict harness file"
    add_variants(recs)
    fits = fits_for(recs, ["v10", "cmp4", "v10_simv4", "v10_S", "v10_moe"])
    H, F = G8.load(a.stat, YEARS)
    arms, Ls, groups = G8.table(H, F)
    assert "cmp4" in arms and "all" in arms

    res = {"meta": {"tool": "tools/v10_gate.py gate", "predict_harness": os.path.relpath(a.harness, ROOT), "stat_harness": os.path.relpath(a.stat, ROOT),
                    "predict_meta": meta, "stat_meta": H["meta"], "boot": dict(PS.BOOT), "years": list(YEARS)}, "rules": RULES, "fits": fits}

    # ---------------- integrity
    tests = json.load(open(a.tests)) if a.tests else None
    integ = {"predict_harness_failed": sum(1 for r in recs if r.get("err")), "stat_harness_failed": H["meta"].get("failed_fights", None),
             "tests": {"file": a.tests, "passes": tests.get("passes") if tests else None, "fails": tests.get("fails") if tests else None}}
    integ["pass"] = integ["predict_harness_failed"] == 0 and integ["stat_harness_failed"] == 0 and bool(tests) and tests.get("fails") == 0
    res["integrity"] = integ

    # ---------------- PRIMARY
    rows = G7.collect(recs, "open", YEARS, [("v10", "v10", "np"), ("cmp4", "cmp4", "cmp")], fits, "v10")
    P1 = G7.paired(rows, ["v10", "cmp4"], YEARS, "open")
    d1 = P1["paired"]["v10 - cmp4"]["winLL"]
    c1 = PS.check_upper(d1, 0.002, False)
    prim = {"diff": d1["diff"], "ci": d1["ci"], "ci_mcse": d1["ci_mcse"], "normal": d1["normal"], "n_decisive": P1["n_decisive"], "n_cards": P1["n_cards"],
            "levels": {k: P1["packages"][k]["winLL"] for k in ("v10", "cmp4")}, "check_upper": c1, "point_lt_0": d1["diff"] < 0}
    prim["pass"] = bool(prim["point_lt_0"] and c1["pass"])
    res["primary"] = prim
    res["regimes"] = {"open": P1}

    # ---------------- CO-PRIMARY
    norm = {s: float(np.nanmean(G8.col(Ls["cmp4"], "dev_" + s))) for s in G8.STATS}
    keys = ["total", "total_raw", "winLL", "bin7", "method"] + ["dev_" + s for s in G8.STATS] + ["mae_" + s for s in G8.STATS]
    P2 = G8.paired(groups, Ls["all"], Ls["cmp4"], keys, norm)
    c2 = PS.check_upper(P2["total"], 0.005, False)
    co = {"diff": P2["total"]["diff"], "ci": P2["total"]["ci"], "ci_mcse": P2["total"]["ci_mcse"], "normal": P2["total"]["normal"], "n_fights": P2["total"]["n"],
          "check_upper": c2, "pass": bool(c2["pass"]), "norm_dev_cmp4": norm}
    res["co_primary"] = co
    res["engine_all_vs_cmp4"] = P2

    res["verdict"] = "PASS" if (prim["pass"] and co["pass"] and integ["pass"]) else "FAIL"
    res["failed"] = [k for k, ok in (("primary", prim["pass"]), ("co_primary", co["pass"]), ("integrity", integ["pass"])) if not ok]

    # ---------------- DESCRIPTIVE
    desc = {}
    for kind in ("none", "close"):
        rk = G7.collect(recs, kind, YEARS, [("v10", "v10", "np"), ("cmp4", "cmp4", "cmp")], fits, "v10")
        res["regimes"][kind] = G7.paired(rk, ["v10", "cmp4"], YEARS, kind)
    pk = {}
    for kind in ("open", "none", "close"):
        rk = pkg_rows(recs, kind, [("v10", "v10", "pkg"), ("cmp4", "cmp4", "cmp")], fits, YEARS)
        pk[kind] = G7.paired(rk, ["v10", "cmp4"], YEARS, kind)
    desc["package_with_props_vs_cmp4"] = pk
    rp = pkg_rows(recs, "close", [("v10", "v10", "pkg"), ("v10np", "v10", "np")], fits, (2022, 2023), need_props=True)
    desc["props_effect_close_props_2022_2023"] = G7.paired(rp, ["v10", "v10np"], (2022, 2023), "close+props")
    loo = {}
    for kind in ("open", "none", "close"):
        loo[kind] = {}
        for nm in ("v10_simv4", "v10_S", "v10_moe"):
            rk = pkg_rows(recs, kind, [("v10", "v10", "np"), (nm, nm, "np")], fits, YEARS)
            loo[kind]["v10 - " + nm] = brief(G7.paired(rk, ["v10", nm], YEARS, kind), "v10 - " + nm)
    desc["package_leave_one_out"] = {"note": "v10 minus the package with one part replaced (props off in both); negative = the part helps", "rows": loo}
    eng = {}
    for x in ("embed", "retarget", "tdIntent"):
        if "-" + x in arms:
            eng[x] = G8.paired(groups, Ls["all"], Ls["-" + x], ["total", "winLL", "bin7", "method", "dev_ctrl", "dev_td_att", "dev_sig_lnd", "dev_sig_att"], norm)
    desc["engine_leave_one_out"] = {"note": "arm 'all' minus arm '-x' on 2021-2023; negative = the sub-part helps", "rows": eng}
    desc["engine_levels"] = {arm: {"dev": {s: round(float(np.nanmean(G8.col(Ls[arm], "dev_" + s))), 4) for s in G8.STATS},
                                   "winLL": round(float(np.nanmean(G8.col(Ls[arm], "winLL"))), 5), "bin7": round(float(np.nanmean(G8.col(Ls[arm], "bin7"))), 5),
                                   "method": round(float(np.nanmean(G8.col(Ls[arm], "method"))), 5), "pit": G8.pit_summary(Ls[arm]),
                                   "base_rates": G8.base_rates(Ls[arm])} for arm in arms}
    try:
        if os.environ.get("V10_GATE_SYNTHETIC") == "1":
            raise RuntimeError("synthetic code check: methodround.py --score (which reads the real outcomes) is skipped")
        mr = {}
        for kind in ("none", "open", "close"):
            rk = pkg_rows(recs, kind, [("v10", "v10", "pkg"), ("cmp4", "cmp4", "cmp")], fits, YEARS)
            mr[kind] = {nm: G7.methodround_cells(rk, nm, "2021-01-01", "2024-01-01") for nm in ("v10", "cmp4")}
        desc["methodround_vs_S"] = mr
    except Exception as e:  # the yardstick is descriptive; a failure is recorded, never a gate result
        desc["methodround_vs_S"] = {"error": str(e)[:300]}
    desc["wiring"] = wiring(recs)
    res["descriptive"] = desc
    if a.out:
        json.dump(res, open(a.out, "w"), indent=1, default=float)
    show(res)


def show(res):
    p, c = res["primary"], res["co_primary"]
    print("VERDICT: %s %s" % (res["verdict"], ("(failed: " + ", ".join(res["failed"]) + ")") if res["failed"] else ""))
    print("PRIMARY open winner LL v10 - cmp4: %+.5f [%+.5f, %+.5f] (MC SE %s; normal upper %s; n %d decisive, %d cards) -> %s" % (
        p["diff"], p["ci"][0], p["ci"][1], p["ci_mcse"], p["normal"]["ci"][1] if p.get("normal") else None, p["n_decisive"], p["n_cards"], "PASS" if p["pass"] else "FAIL"))
    print("CO-PRIMARY total stat deviance all - cmp4: %+.5f [%+.5f, %+.5f] (n %d) -> %s" % (c["diff"], c["ci"][0], c["ci"][1], c["n_fights"], "PASS" if c["pass"] else "FAIL"))
    print("INTEGRITY:", res["integrity"])
    for kind, R in res["regimes"].items():
        print("  regime %-5s v10 - cmp4: %s" % (kind, brief(R, "v10 - cmp4")))


def cmd_power(a):
    S = json.load(open(a.path))
    p = S["primary"]
    se_gate = (p.get("normal") or {}).get("se")
    if not se_gate:
        se_gate = (p["ci"][1] - p["ci"][0]) / (2 * 1.959964)
    se = se_gate * math.sqrt(p["n_decisive"] / float(a.n_look))
    e = abs(a.effect if a.effect is not None else p["diff"])
    pw = PS.norm_cdf(e / se - 1.959964) + PS.norm_cdf(-e / se - 1.959964)
    out = {"gate_score": os.path.relpath(a.path, ROOT), "contrast": "primary: open-regime winner log loss, v10 package minus cmp4", "n_gate": p["n_decisive"],
           "n_look": a.n_look, "se_gate_normal": se_gate, "se_look": round(se, 6), "mde_80": round(2.8 * se, 5), "effect": -e,
           "effect_source": "gate point estimate" if a.effect is None else "given", "power": round(pw, 3), "underpowered": pw < 0.5}
    print(json.dumps(out, indent=1))
    if a.out:
        json.dump(out, open(a.out, "w"), indent=1)


# ------------------------------------------------------------------ the look (pre-registered; version_history.json v10 prereg)
LOOK_YEARS = (2024, 2025)
LOOK_RULES = {
    "scored_object": "the predict package (FightEngine.predict of versions/v10); summarize() for stat lines and base rates",
    "primary": "open-regime winner log loss, v10 package minus cmp4 (the honest v4 package, versions/v7:cmp4), decisive 2024-2025 fights with an opener "
               "for both packages, refit schedule BOTH WALK-FORWARD (v10 --ml2-rolling with stack weights fit through 2023; cmp4 the blind replay's "
               "walk-forward experts with its stacker fit through 2023)",
    "branch1": "keep if the primary's paired 95% CI upper < 0 (20,000 event-cluster resamples, seed 7; marginal bounds by the clustered normal bound)",
    "branch2": "keep if (a) the primary is not worse: CI upper <= +0.002, AND (b) the branch-2 metric is clearly better: total stat-line relative "
               "deviance (tools/v8_gate.py definition) of the v10 engine minus v4 (tools/v10_stat_gate.js --split val, arms all vs cmp4) has CI upper < 0, "
               "AND (c) no base-rate drift: tools/evalv_decide.js's paired base-rate test (v10 vs v4 evalv val runs) passes on the 2024-2025 window "
               "EXCLUDING the announced glove-trial window 2024-06-01..2024-11-15 (V6_V10_PLAN 7.1 item 9; its sensitivity_no_glove_trial block), "
               "the full-window table reported next to it",
    "flags": ["confirmation look (every ingredient scored on 2024-25 in research; the v6 look scored the same ML v2 winner head)",
              "gate design informed by v7 / v8 train results",
              "kept under the glove-window amendment (only if branch 2 keeps while the full-window base-rate test fails)"],
    "secondaries_never_decisive": "no-line and close regime winner; Brier, accuracy, ECE, slope; 7-bin, method, joint, round given a finish, method "
                                  "given the winner, P(decision) in every regime, props pool where available; per-stat deviances; who x how x when vs "
                                  "methodround S; v10 vs the v5.0.1 package (pkg 'v501' when the harness holds it); base-rate tables; blend test",
}


def cmd_look(a):
    D = json.load(open(a.harness))
    recs = D["fights"]
    assert all("2024-01-01" <= r["date"] < "2026-01-01" for r in recs), "the look reads 2024-2025 only"
    G = json.load(open(a.gate))
    if G.get("verdict") != "PASS":
        raise SystemExit("look: the train gate did not pass")
    w10, wc = G["fits"]["w"]["v10"]["fit_2019_2023"]["w"], G["fits"]["w"]["cmp4"]["fit_2019_2023"]["w"]
    pi = G["fits"]["pi"]["fit_2021_2023"]["pi"]
    fits = {"w": {"v10": {str(y): {"w": w10} for y in LOOK_YEARS}, "cmp4": {str(y): {"w": wc} for y in LOOK_YEARS}},
            "pi": {str(y): {"pi": pi} for y in LOOK_YEARS}}
    names = [p["name"] for p in D["meta"]["packages"]]
    if a.v501:
        # descriptive continuity with v6 (never decisive): the v5.0.1 package's rows from the v6 look (data/derived/v6/look_val.json, static
        # ML v2 schedule, its own inputs) paired by fight id with v10's rows; w 0.30 is v5.0.1's frozen pool weight (the winner ignores it)
        V6 = {f["id"]: f for f in json.load(open(a.v501))["fights"] if not f.get("err")}
        for r in recs:
            g = V6.get(r["id"])
            if g and (g["pk"].get("v501")):
                r["pk"]["v501"] = g["pk"]["v501"]
        names = names + ["v501"]
        fits["w"]["v501"] = {str(y): {"w": 0.30} for y in LOOK_YEARS}
    res = {"meta": {"tool": "tools/v10_gate.py look", "predict_harness": os.path.relpath(a.harness, ROOT), "stat_harness": os.path.relpath(a.stat, ROOT),
                    "decide": os.path.relpath(a.decide, ROOT), "gate": os.path.relpath(a.gate, ROOT), "boot": dict(PS.BOOT), "weights": {"w_v10": w10, "w_cmp4": wc, "pi": pi}},
           "rules": LOOK_RULES}
    rows = G7.collect(recs, "open", LOOK_YEARS, [("v10", "v10", "np"), ("cmp4", "cmp4", "cmp")], fits, "v10")
    P1 = G7.paired(rows, ["v10", "cmp4"], LOOK_YEARS, "open")
    d1 = P1["paired"]["v10 - cmp4"]["winLL"]
    b1 = PS.check_upper(d1, 0.0, True)
    nw = PS.check_upper(d1, 0.002, False)
    Hs = json.load(open(a.stat))
    Fs = [f for f in Hs["fights"] if not f.get("err")]
    assert all("2024-01-01" <= f["date"] < "2026-01-01" for f in Fs)
    # smoothing prior for the engine-level 7-bin / method from the TRAIN fights of the gate's stat harness (v10 review fix; the v10
    # look itself ran before this fix with the scored fights' own outcome shares, weight 1/601, secondaries only)
    _, Fbase = G8.load(os.path.join(ROOT, a.base_stat or G["meta"]["stat_harness"]), YEARS)
    arms, Ls, groups = G8.table(Hs, Fs, base_fights=Fbase)
    norm = {s_: float(np.nanmean(G8.col(Ls["cmp4"], "dev_" + s_))) for s_ in G8.STATS}
    P2 = G8.paired(groups, Ls["all"], Ls["cmp4"], ["total", "total_raw", "winLL", "bin7", "method"] + ["dev_" + s_ for s_ in G8.STATS], norm)
    sb = PS.check_upper(P2["total"], 0.0, True)
    DEC = json.load(open(a.decide))
    ng = DEC.get("sensitivity_no_glove_trial") or {}
    full_fail = (DEC.get("branch2", {}).get("base_rates") or {}).get("paired_fail")
    base_ok = isinstance(ng.get("paired_fail"), list) and len(ng["paired_fail"]) == 0
    branch1 = bool(b1["pass"])
    branch2 = (not branch1) and bool(nw["pass"]) and bool(sb["pass"]) and base_ok
    res["primary"] = {"diff": d1["diff"], "ci": d1["ci"], "ci_mcse": d1["ci_mcse"], "normal": d1["normal"], "n_decisive": P1["n_decisive"], "n_cards": P1["n_cards"],
                      "levels": {k: P1["packages"][k]["winLL"] for k in ("v10", "cmp4")}, "branch1_check": b1, "not_worse_check": nw}
    res["branch2_metric"] = {"total": P2["total"], "check": sb, "paired": P2}
    res["base_rates"] = {"governing_no_glove_paired_fail": ng.get("paired_fail"), "full_window_paired_fail": full_fail, "pass": base_ok}
    res["decision"] = {"keep": branch1 or branch2, "branch": "branch 1" if branch1 else ("branch 2" if branch2 else "neither"),
                       "kept_under_glove_amendment": bool(branch2 and full_fail), "flags": ["confirmation look", "gate design informed by v7 / v8 train results"]}
    sec = {}
    for kind in ("none", "close"):
        rk = G7.collect(recs, kind, LOOK_YEARS, [("v10", "v10", "np"), ("cmp4", "cmp4", "cmp")], fits, "v10")
        sec[kind] = G7.paired(rk, ["v10", "cmp4"], LOOK_YEARS, kind)
    sec["open"] = P1
    pk = {}
    for kind in ("open", "none", "close"):
        rk = pkg_rows(recs, kind, [("v10", "v10", "pkg"), ("cmp4", "cmp4", "cmp")], fits, LOOK_YEARS)
        pk[kind] = G7.paired(rk, ["v10", "cmp4"], LOOK_YEARS, kind)
    sec["package_with_props_vs_cmp4"] = pk
    if "v501" in names:
        rk = G7.collect(recs, "open", LOOK_YEARS, [("v10", "v10", "np"), ("v501", "v501", "cmp")], fits, "v10")
        sec["vs_v501_open_descriptive"] = brief(G7.paired(rk, ["v10", "v501"], LOOK_YEARS, "open"), "v10 - v501")
    res["secondaries"] = sec
    if a.out:
        json.dump(res, open(a.out, "w"), indent=1, default=float)
    print(json.dumps({"primary": {k: res["primary"][k] for k in ("diff", "ci", "n_decisive")}, "branch2_total": {k: P2["total"][k] for k in ("diff", "ci")},
                      "base_rates": res["base_rates"], "decision": res["decision"]}, indent=1))


def main():
    ap = argparse.ArgumentParser()
    sp = ap.add_subparsers(dest="cmd", required=True)
    f = sp.add_parser("fits")
    f.add_argument("harness")
    f.add_argument("--out")
    g = sp.add_parser("gate")
    g.add_argument("harness")
    g.add_argument("stat")
    g.add_argument("--tests", required=True)
    g.add_argument("--out", required=True)
    lk = sp.add_parser("look")
    lk.add_argument("harness")
    lk.add_argument("stat")
    lk.add_argument("--decide", required=True)
    lk.add_argument("--gate", required=True)
    lk.add_argument("--out", required=True)
    lk.add_argument("--v501", help="data/derived/v6/look_val.json (descriptive v5.0.1-package contrast, v6 continuity)")
    lk.add_argument("--base-stat", help="train stat harness for the smoothing prior (default: the gate score's meta.stat_harness)")
    w = sp.add_parser("power")
    w.add_argument("path")
    w.add_argument("--n-look", type=int, required=True)
    w.add_argument("--effect", type=float)
    w.add_argument("--out")
    a = ap.parse_args()
    {"fits": cmd_fits, "gate": cmd_gate, "power": cmd_power, "look": cmd_look}[a.cmd](a)


if __name__ == "__main__":
    main()
