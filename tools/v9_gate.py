#!/usr/bin/env python3
"""v9_gate.py: scores engine v9's TRAIN gate (docs/V6_V10_PLAN.md cycle 4 "Train-only acceptance test") from a tools/v9_gate.js
harness file, under data/derived/v9/gate_protocol.json (V6_V10_PLAN 7.1 item 10: rules committed before the binding run, the
binding run happens once, 20,000 event-cluster resamples with seed 7, Monte Carlo SE of every bound, a bound within 2 MC SE of
its threshold is decided by the normal bound; helpers from tools/predict_score.py and tools/v8_gate.py).

    python3 tools/v9_gate.py score <harness.json> --replay data/derived/v9/drift_replay.json --out <score.json>

Per-fight definitions are tools/evalv.js's (as tools/v8_gate.py): P(A wins) = (A wins + 0.5) / (decisive sims + 1) clipped to
[0.005, 0.995]; 7-bin and method smoothed with one pseudo-simulation of the corner-symmetric outcome base; per-fighter Poisson
deviance of the real total vs the simulated mean, averaged over the two fighters.
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
import predict_score as PS  # noqa: E402
import v8_gate as V8  # noqa: E402  (outcome_base, losses, paired, check_lower, col, pit_summary; same STATS order)

STATS = V8.STATS
NS = len(STATS)
IX = {s: i for i, s in enumerate(STATS)}
BIND_YEARS = (2021, 2022, 2023)
G6_YEARS = (2019, 2020, 2021, 2022, 2023)

# ====================================================================== RULES (pre-registered; data/derived/v9/gate_protocol.json)
RULES = {
    "comparator": "cmp4 = every v9 flag off (= engine 4.0.0 bit for bit, tests/test_v9.js) on the same honest inputs, same fights, common random numbers",
    "candidate": "arm 'all' = the v9 candidate as selected: components.judgeWF + components.format on, components.levels off (the 2019-2020 "
                 "rolling-origin choice kept no level tracker, data/derived/v9/levels_select.json)",
    "scope": "rolling origin: choices made on 2019-2020 (judging recipe, tracker keep/drop, dispersion), the binding checks G1, G2 and G7 on the "
             "2021-2023 train fights; G6 on the 2019-2023 five-round fights and between-round intervals (the plan's '2019-23 rate'); "
             "levels always from earlier fights",
    "checks": {
        "G1": "year-level base-rate error falls (CI < 0 on 2021-23) for each of sig landed per 15, accuracy (sig landed / sig attempted), "
              "KD per 100 head landed, TD (landed) per 15, control per 15 and finish rate: statistic = mean over 2021, 2022, 2023 of "
              "|sim_year - actual_year| (evalv.js pooled ratios within each year), candidate minus cmp4; CI from 20,000 event-cluster "
              "resamples stratified by year (cards resampled within their year); pass iff the CI upper bound < 0 for ALL six "
              "(a marginal bound is decided by the normal bound mean + 1.96 x bootstrap sd)",
        "G2a": "sig-landed deviance on 2021-23 improves: per-fight Poisson deviance of sig landed (mean of the two fighters), paired, CI upper < 0",
        "G2b": "total stat deviance not worse: the mean relative 10-stat deviance (tools/v8_gate.py 'total': per fight the mean over the 10 "
               "stats of the deviance divided by cmp4's mean of that stat) paired difference CI upper <= +0.005 (+0.5% of level, the "
               "plan's 6.3 / 7.1 item 4 stat-line 'not worse' tolerance)",
        "G3": "per-card stacks vs annual-static stacks: NOT APPLICABLE. v9's base (v4, the latest kept version) has no predict() package and no "
              "stack weight provider, and the verified calibration study (research/model_calib.md) found no per-card / recency scheme that "
              "beats the incumbents on the forward-chained 2021-23 gate; the component is not built",
        "G4": "method-head offsets vs static intercepts: NOT APPLICABLE. The eradrift verifier did not adopt method-level offsets (nested "
              "forward-chained 2021-23 gate: 7-bin -0.00007 [-0.00167, +0.00144]), and v4 has no method head; the component is not built",
        "G5": "replayed over 2015-23, the drift rule fires at most once: rule 6.5.1 (b) as pre-registered (a one-way switch) on the stored "
              "2015-2023 quarterly replay checks (data/derived/calib.json rule.replay_2015_2023), switch events <= 1; the trigger-condition "
              "count and episodes are reported (research/model_calib.md: the criterion is vacuous for a one-way rule)",
        "G6a": "5-round R4 KO-type hazard covers the real value: 95% event-cluster CI of (sim - actual) hazard of a KO/TKO (doctor / corner "
               "included) in round 4 among 5-round fights that reached round 4, 2019-2023, contains 0",
        "G6b": "5-round R5 SUB hazard covers the real value: the same for a submission in round 5 among fights that reached round 5",
        "G6c": "doctor / corner <= 1.5 x the 2019-23 rate: simulated between-round stoppages per round-interval reached (both formats) <= 1.5 x "
               "the actual 2019-2023 rate (point estimates; actual = method DOC, or KO/TKO at 5:00 of a round before the last)",
        "G7": "winner log loss, 7-bin and method on 2021-23: paired CI upper <= +0.002 each",
    },
    "pass": "the gate passes iff every applicable check (G1, G2a, G2b, G5, G6a, G6b, G6c, G7 x 3) passes; G3 and G4 are recorded as not applicable",
    "bootstrap": "20,000 event-cluster resamples (card = event + date), seed 7; Monte Carlo SE of each bound (10 batches); a bound within 2 MC SE "
                 "of its threshold is decided by the clustered normal bound (G1: mean + 1.96 x bootstrap sd)",
    "descriptive_only": "leave-one-out arms -judgeWF / -format and the +levels arm (every tracker on, as designed before the 2019-2020 choice) "
                        "are scored the same way and reported; they cannot change the decision or re-enter v9",
}
BR_KEYS = ["sigLnd15", "acc", "kd100", "td15", "ctrl15", "finish"]


def load(path, years=None):
    H = json.load(open(path))
    fights = [f for f in H["fights"] if not f.get("err")]
    assert all(f["date"] < "2024-01-01" for f in fights), "a non-train fight in the harness file"
    if years:
        fights = [f for f in fights if int(f["date"][:4]) in years]
    return H, fights


def br_cols(f, a):
    """Per-fight sums feeding the year-level base rates (sim from arm a, actual from the fight)."""
    st, act = a["st"], f.get("actual")
    R, c, n = f["rounds"], a["cells"], a["n"]
    fin = (sum(c[0:4 * R])) / n
    out = {"s_sl": st[IX["sig_lnd"]] + st[NS + IX["sig_lnd"]], "s_sa": st[IX["sig_att"]] + st[NS + IX["sig_att"]],
           "s_kd": st[IX["kd"]] + st[NS + IX["kd"]], "s_hl": st[IX["h_lnd"]] + st[NS + IX["h_lnd"]],
           "s_td": st[IX["td_lnd"]] + st[NS + IX["td_lnd"]], "s_ct": st[IX["ctrl"]] + st[NS + IX["ctrl"]], "s_min": a["mins"],
           "s_fin": fin if f["outcome"] else 0.0, "n_out": 1.0 if f["outcome"] else 0.0,
           "a_fin": 1.0 if (f["outcome"] and f["outcome"]["cls"] in ("KO", "SUB")) else 0.0}
    if act and act.get("A") and act.get("B"):
        A, B = act["A"], act["B"]
        out.update({"a_sl": A["sig_lnd"] + B["sig_lnd"], "a_sa": A["sig_att"] + B["sig_att"], "a_kd": A["kd"] + B["kd"], "a_hl": A["h_lnd"] + B["h_lnd"],
                    "a_td": A["td_lnd"] + B["td_lnd"], "a_ct": A["ctrl"] + B["ctrl"], "a_min": float(act.get("minutes") or 0), "has_act": 1.0})
    else:
        out.update({k: 0.0 for k in ("a_sl", "a_sa", "a_kd", "a_hl", "a_td", "a_ct", "a_min", "has_act")})
        for k in ("s_sl", "s_sa", "s_kd", "s_hl", "s_td", "s_ct", "s_min"):
            out[k] = 0.0       # stat base rates over fights with recorded totals only (evalv.js)
    return out


def rates_from_sums(S):
    """S: dict of summed columns (arrays allowed). Returns {key: (sim, act)}."""
    return {"sigLnd15": (15 * S["s_sl"] / 2 / S["s_min"], 15 * S["a_sl"] / 2 / S["a_min"]),
            "acc": (S["s_sl"] / S["s_sa"], S["a_sl"] / S["a_sa"]),
            "kd100": (100 * S["s_kd"] / S["s_hl"], 100 * S["a_kd"] / S["a_hl"]),
            "td15": (15 * S["s_td"] / 2 / S["s_min"], 15 * S["a_td"] / 2 / S["a_min"]),
            "ctrl15": (15 * S["s_ct"] / 2 / S["s_min"], 15 * S["a_ct"] / 2 / S["a_min"]),
            "finish": (S["s_fin"] / S["n_out"], S["a_fin"] / S["n_out"])}


def year_level(fights, Ha, Hb, years, B=None, seed=None):
    """G1: per base rate, mean over years of |sim - act|, arm a minus arm b, stratified event-cluster bootstrap."""
    B = PS.BOOT["B"] if B is None else B
    seed = PS.BOOT["seed"] if seed is None else seed
    rng = np.random.default_rng(seed)
    keys = list(br_cols(fights[0], fights[0]["arms"][Ha]).keys())
    pt = {"a": {}, "b": {}}
    bs = {"a": {k: np.zeros(B) for k in BR_KEYS}, "b": {k: np.zeros(B) for k in BR_KEYS}}
    per_year = {}
    for y in years:
        fy = [f for f in fights if int(f["date"][:4]) == y]
        groups = sorted({f["event"] + "|" + f["date"] for f in fy})
        gi = {g: i for i, g in enumerate(groups)}
        G = len(groups)
        sums = {}
        for tag, arm in (("a", Ha), ("b", Hb)):
            M = np.zeros((G, len(keys)))
            for f in fy:
                c = br_cols(f, f["arms"][arm])
                M[gi[f["event"] + "|" + f["date"]]] += np.array([c[k] for k in keys])
            sums[tag] = M
        k = rng.integers(0, G, (B, G))
        per_year[y] = {}
        for tag in ("a", "b"):
            M = sums[tag]
            tot = {kk: M[:, j].sum() for j, kk in enumerate(keys)}
            r = rates_from_sums(tot)
            per_year[y][tag] = {b_: {"sim": round(float(r[b_][0]), 5), "act": round(float(r[b_][1]), 5), "abs_err": round(float(abs(r[b_][0] - r[b_][1])), 5)} for b_ in BR_KEYS}
            Sb = {kk: M[:, j][k].sum(axis=1) for j, kk in enumerate(keys)}
            rb = rates_from_sums(Sb)
            for b_ in BR_KEYS:
                bs[tag][b_] += np.abs(rb[b_][0] - rb[b_][1]) / len(years)
                pt[tag][b_] = pt[tag].get(b_, 0.0) + abs(r[b_][0] - r[b_][1]) / len(years)
    out = {}
    for b_ in BR_KEYS:
        d = bs["a"][b_] - bs["b"][b_]
        est = pt["a"][b_] - pt["b"][b_]
        sd = float(d.std(ddof=1))
        rec = {"diff": round(float(est), 6), "err_cand": round(float(pt["a"][b_]), 6), "err_cmp": round(float(pt["b"][b_]), 6),
               "ci": [round(float(np.percentile(d, 2.5)), 6), round(float(np.percentile(d, 97.5)), 6)], "ci_mcse": PS.ci_mcse(d),
               "normal": {"se": round(sd, 6), "ci": [round(est - 1.959964 * sd, 6), round(est + 1.959964 * sd, 6)], "note": "mean + 1.96 x bootstrap sd"}}
        out[b_] = rec
    return out, per_year


def g6(fights, arm, B=None, seed=None):
    """5-round R4 KO-type and R5 SUB hazards (sim - actual, event-cluster CI) and the between-round stoppage rate (both formats)."""
    groups, cols = [], {k: [] for k in ("s4", "r4", "a4", "ar4", "s5", "r5", "a5", "ar5")}
    st_s = st_r = act_s = act_r = 0.0
    for f in fights:
        a = f["arms"][arm]
        R, c, n = f["rounds"], a["cells"], a["n"]
        fin = [(c[k] + c[R + k] + c[2 * R + k] + c[3 * R + k]) / n for k in range(R)]
        cum = 0.0
        for k in range(R - 1):
            cum += fin[k]
            st_r += 1 - cum + a["stop"][k]
            st_s += a["stop"][k]
        r = f["result"]
        m, rd, ts = r["method"], r["round"], r.get("time_s")
        for k in range(R - 1):
            if rd > k + 1 or (rd == k + 1 and ts == 300 and m in ("KO", "DOC")):
                act_r += 1
        if m in ("KO", "DOC") and ts == 300 and rd < R:
            act_s += 1
        if R != 5 or not f["outcome"]:
            continue
        groups.append(f["event"] + "|" + f["date"])
        ko4 = (c[3] + c[2 * R + 3]) / n
        sub5 = (c[R + 4] + c[3 * R + 4]) / n
        reach4 = 1 - sum(fin[:3])
        reach5 = 1 - sum(fin[:4])
        y = f["outcome"]
        cols["s4"].append(ko4); cols["r4"].append(reach4)
        cols["s5"].append(sub5); cols["r5"].append(reach5)
        cols["a4"].append(1.0 if (y["cls"] == "KO" and y["round"] == 4) else 0.0)
        cols["ar4"].append(1.0 if (y["round"] >= 4 or y["cls"] in ("DEC", "DRAW")) else 0.0)
        cols["a5"].append(1.0 if (y["cls"] == "SUB" and y["round"] == 5) else 0.0)
        cols["ar5"].append(1.0 if (y["round"] >= 5 or y["cls"] in ("DEC", "DRAW")) else 0.0)
    cols = {k: np.array(v) for k, v in cols.items()}
    bs = PS.cluster_boot(groups, cols, B, seed)
    out = {}
    for tag, s, r, a_, ar in (("R4_KO", "s4", "r4", "a4", "ar4"), ("R5_SUB", "s5", "r5", "a5", "ar5")):
        d = bs[s] / bs[r] - bs[a_] / bs[ar]
        sim, act = cols[s].sum() / cols[r].sum(), cols[a_].sum() / cols[ar].sum()
        lo, hi = float(np.percentile(d, 2.5)), float(np.percentile(d, 97.5))
        out[tag] = {"sim": round(float(sim), 5), "actual": round(float(act), 5), "events": int(cols[a_].sum()), "reached": int(cols[ar].sum()),
                    "diff": round(float(sim - act), 5), "ci": [round(lo, 5), round(hi, 5)], "ci_mcse": PS.ci_mcse(d), "pass": bool(lo <= 0 <= hi)}
    out["stoppage"] = {"sim_rate": round(st_s / st_r, 6), "actual_rate": round(act_s / act_r, 6), "actual_events": int(act_s), "actual_intervals": int(act_r),
                       "ratio": round((st_s / st_r) / (act_s / act_r), 4), "pass": bool(st_s / st_r <= 1.5 * act_s / act_r)}
    return out


def extra_rates(fights, arm):
    """Reported base-rate table pieces not in G1: KO / SUB / DEC shares, decision split, 10-8 share, finish by round."""
    n = ko = sub = dec = 0.0
    aKO = aSUB = aDEC = 0.0
    sUD = sSD = sMD = 0.0
    aUD = aSD = aMD = 0.0
    sW = sR = aW = aR = 0.0
    fr = {3: {"n": 0, "s": [0.0] * 3, "a": [0.0] * 3}, 5: {"n": 0, "s": [0.0] * 5, "a": [0.0] * 5}}
    for f in fights:
        a, y = f["arms"][arm], f["outcome"]
        if not y:
            continue
        R, c, m = f["rounds"], a["cells"], a["n"]
        n += 1
        ko += sum(c[k] + c[2 * R + k] for k in range(R)) / m
        sub += sum(c[R + k] + c[3 * R + k] for k in range(R)) / m
        dec += (c[4 * R] + c[4 * R + 1] + c[4 * R + 2]) / m
        aKO += y["cls"] == "KO"; aSUB += y["cls"] == "SUB"; aDEC += y["cls"] in ("DEC", "DRAW")
        nd = sum(a["dec"])
        if nd:
            sUD += a["dec"][0] / m; sSD += a["dec"][1] / m; sMD += a["dec"][2] / m
        aUD += y["method"] == "UD"; aSD += y["method"] == "SD"; aMD += y["method"] == "MD"
        sW += a["n108"]; sR += 3 * a["decRounds"]
        cards = (f.get("result") or {}).get("cards")
        if y["method"] in ("UD", "SD", "MD", "DRAW") and cards and len(cards) == 3:
            for cc in cards:
                rj = max(1, round((cc[0] + cc[1]) / 19))
                aW += max(0, 19 * rj - (cc[0] + cc[1])); aR += rj
        q = fr[R]; q["n"] += 1
        for k in range(R):
            q["s"][k] += (c[k] + c[R + k] + c[2 * R + k] + c[3 * R + k]) / m
        if y["cls"] in ("KO", "SUB"):
            q["a"][min(R, y["round"]) - 1] += 1
    sD, aD = sUD + sSD + sMD, aUD + aSD + aMD
    return {"KO": [round(ko / n, 5), round(aKO / n, 5)], "SUB": [round(sub / n, 5), round(aSUB / n, 5)], "DEC": [round(dec / n, 5), round(aDEC / n, 5)],
            "decision_split_sim": {"UD": round(sUD / sD, 4), "SD": round(sSD / sD, 4), "MD": round(sMD / sD, 4)},
            "decision_split_act": {"UD": round(aUD / aD, 4), "SD": round(aSD / aD, 4), "MD": round(aMD / aD, 4)},
            "r108": [round(sW / sR, 5), round(aW / max(1, aR), 5)],
            "finByRound3": {"sim": [round(x / fr[3]["n"], 4) for x in fr[3]["s"]], "act": [round(x / fr[3]["n"], 4) for x in fr[3]["a"]]},
            "finByRound5": {"sim": [round(x / max(1, fr[5]["n"]), 4) for x in fr[5]["s"]], "act": [round(x / max(1, fr[5]["n"]), 4) for x in fr[5]["a"]]},
            "note": "[sim, actual]; r108 = 10-8 judge-rounds per decision judge-round (evalv.js; actual card-implied)"}


def evaluate(H, arm, ref="cmp4"):
    _, fb = load(H["_path"], BIND_YEARS)
    base = V8.outcome_base(fb)
    La = [V8.losses(f, f["arms"][arm], base) for f in fb]
    Lb = [V8.losses(f, f["arms"][ref], base) for f in fb]
    groups = [f["event"] + "|" + f["date"] for f in fb]
    norm = {s: float(np.nanmean(V8.col(Lb, "dev_" + s))) for s in STATS}
    P = V8.paired(groups, La, Lb, ["total", "winLL", "bin7", "method"] + ["dev_" + s for s in STATS] + ["mae_" + s for s in STATS], norm)
    G1, per_year = year_level(fb, arm, ref, BIND_YEARS)
    _, f6 = load(H["_path"], G6_YEARS)
    G6 = g6(f6, arm)
    G6ref = g6(f6, ref)
    C = {}
    for b_ in BR_KEYS:
        C["G1 year-level %s error falls: CI upper < 0" % b_] = PS.check_upper(G1[b_], 0.0, True)
    C["G2a sig-landed deviance improves: CI upper < 0"] = PS.check_upper(P["dev_sig_lnd"], 0.0, True)
    C["G2b total stat deviance not worse: CI upper <= +0.005 (0.5% of level)"] = PS.check_upper(P["total"], 0.005, False)
    C["G6a 5-round R4 KO-type hazard: CI of sim - actual covers 0"] = {"pass": G6["R4_KO"]["pass"], **G6["R4_KO"]}
    C["G6b 5-round R5 SUB hazard: CI of sim - actual covers 0"] = {"pass": G6["R5_SUB"]["pass"], **G6["R5_SUB"]}
    C["G6c doctor / corner <= 1.5 x the 2019-23 rate"] = {"pass": G6["stoppage"]["pass"], **G6["stoppage"]}
    for k in ("winLL", "bin7", "method"):
        C["G7 %s: CI upper <= +0.002" % k] = PS.check_upper(P[k], 0.002, False)
    return {"checks": C, "paired_2021_2023": P, "year_level": G1, "year_table": per_year, "g6_candidate": G6, "g6_comparator": G6ref,
            "rates_2021_2023": {"cand": extra_rates(fb, arm), "cmp": extra_rates(fb, ref)}, "n_bind": len(fb), "n_g6_fights": len(f6),
            "norm_dev_cmp4": norm}


def cmd_score(a):
    H = json.load(open(a.harness))
    H["_path"] = a.harness
    arms = H["meta"]["arms"]
    assert "cmp4" in arms and "all" in arms
    rep = json.load(open(a.replay))
    g5 = {"pass": rep["rule_b"]["switch_events"] <= 1, **rep["rule_b"]}
    out = {"meta": {"tool": "tools/v9_gate.py score", "harness": a.harness, "replay": a.replay, "harness_meta": {k: v for k, v in H["meta"].items() if k != "level_trace"},
                    "boot": PS.BOOT, "binding_years": list(BIND_YEARS), "g6_years": list(G6_YEARS),
                    "failed_fights": sum(1 for f in H["fights"] if f.get("err"))},
           "rules": RULES}
    main = evaluate(H, "all")
    main["checks"]["G5 drift rule replay 2015-2023: switch events <= 1"] = g5
    main["checks"]["G3 per-card stacks vs annual-static"] = {"pass": None, "applicable": False, "why": RULES["checks"]["G3"]}
    main["checks"]["G4 method-head offsets vs static intercepts"] = {"pass": None, "applicable": False, "why": RULES["checks"]["G4"]}
    appl = {k: v for k, v in main["checks"].items() if v.get("pass") is not None}
    failed = [k for k, v in appl.items() if not v["pass"]]
    out["candidate"] = main
    out["result"] = "PASS" if not failed else "FAIL"
    out["failed"] = failed
    out["descriptive"] = {}
    for arm in arms:
        if arm in ("cmp4", "all"):
            continue
        d = evaluate(H, arm)
        out["descriptive"][arm] = {"failed_checks_if_it_were_the_candidate": [k for k, v in d["checks"].items() if v.get("pass") is not None and not v["pass"]],
                                   "paired_2021_2023": {k: d["paired_2021_2023"][k] for k in ("total", "winLL", "bin7", "method", "dev_sig_lnd", "dev_sig_att", "dev_ctrl", "dev_td_att", "dev_kd")},
                                   "year_level": d["year_level"], "g6": d["g6_candidate"]}
        if arm != "+levels":
            dd = evaluate(H, "all", arm)
            out["descriptive"][arm]["all_minus_this_arm"] = {k: dd["paired_2021_2023"][k] for k in ("total", "winLL", "bin7", "method", "dev_sig_lnd", "dev_ctrl", "dev_kd")}
    json.dump(out, open(a.out, "w"), indent=1, default=float)
    P = main["paired_2021_2023"]
    print("RESULT: %s%s" % (out["result"], ("  failed: " + "; ".join(failed)) if failed else ""))
    for k, v in main["checks"].items():
        if v.get("pass") is None:
            print("  n/a  %s" % k)
            continue
        extra = ""
        if k.startswith("G1"):
            b_ = k.split()[2]
            r = main["year_level"][b_]
            extra = "  %+.5f [%+.5f, %+.5f] (err %.5f vs %.5f)" % (r["diff"], r["ci"][0], r["ci"][1], r["err_cand"], r["err_cmp"])
        elif k.startswith("G2a"):
            extra = "  %+.4f [%+.4f, %+.4f]" % (P["dev_sig_lnd"]["diff"], *P["dev_sig_lnd"]["ci"])
        elif k.startswith("G2b"):
            extra = "  %+.5f [%+.5f, %+.5f]" % (P["total"]["diff"], *P["total"]["ci"])
        elif k.startswith("G7"):
            kk = k.split()[1].rstrip(":")
            extra = "  %+.5f [%+.5f, %+.5f]" % (P[kk]["diff"], *P[kk]["ci"])
        elif k.startswith("G6a") or k.startswith("G6b"):
            extra = "  sim %.4f act %.4f diff %+.4f [%+.4f, %+.4f]" % (v["sim"], v["actual"], v["diff"], v["ci"][0], v["ci"][1])
        elif k.startswith("G6c"):
            extra = "  sim %.5f act %.5f ratio %.2f" % (v["sim_rate"], v["actual_rate"], v["ratio"])
        elif k.startswith("G5"):
            extra = "  switch events %d (fired %s); condition met %d of %d quarters, %d episodes" % (v["switch_events"], v["fired_at"], v["n_quarters_condition_met"], v["n_checks"], v["condition_episodes"])
        print("  %s %s%s" % ("PASS" if v["pass"] else "FAIL", k, extra))
    print("wrote", a.out)


def main():
    ap = argparse.ArgumentParser()
    sp = ap.add_subparsers(dest="cmd", required=True)
    p = sp.add_parser("score")
    p.add_argument("harness")
    p.add_argument("--replay", required=True)
    p.add_argument("--out", required=True)
    a = ap.parse_args()
    {"score": cmd_score}[a.cmd](a)


if __name__ == "__main__":
    main()
