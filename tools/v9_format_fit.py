#!/usr/bin/env python3
"""v9_format_fit.py: the joint level pass by format for engine v9 components.format (docs/V6_V10_PLAN.md cycle 4 work item 6),
fit ONCE on the 2019-2023 train fights (backtest_dev.json; nothing dated 2024 or later), development seed 102, 300 sims per order.

Parameters and targets (one damped multiplicative fixed point, all four at once; the v4 parameters are untouched):
    stop   doctor / corner hazard scale, both formats   <- between-round stoppages per round-interval reached, pooled over formats
                                                           (2019-2023: 11 events in 2,983 intervals; strong prior = one scale, the
                                                           engine's damage build-up keeps its 3- vs 5-round ratio)
    kd5    5-round knockdown factor                      <- knockdowns per 100 head strikes landed in 5-round fights
    late5  5-round rounds 4-5 finish-hazard factor        <- share of 5-round fights finished in round 4 or 5
    conv   knockdown-to-finish conversion odds, all      <- KO/TKO share (doctor stoppages included) of fights with an outcome
Actual between-round stoppage: method DOC, or KO/TKO at 5:00 of a round before the last (corner stoppages are recorded that way).
Rule of the plan item "add the 5-round format KD factor only if the gap is still more than 2 SE after the pass": the 5-round KD
gap is checked first on the comparator run and reported; kd5 is fit only if |gap| > 2 SE (Poisson SE on the actual knockdowns).

    nice -n 5 python3 tools/v9_format_fit.py [--iters 6] [--out data/derived/v9/format_fit.json]
"""
import argparse
import json
import math
import os
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def run(arm_params, out, seed=102, sims=300):
    arm = "fmt=" + json.dumps(arm_params, separators=(",", ":"))
    cmd = ["nice", "-n", "5", "node", "tools/v9_gate.js", "--out", out, "--arms", "", "--arm", arm, "--sims", str(sims),
           "--seed", str(seed), "--workers", "3", "--skip-ref"]
    cmd = [c for c in cmd if c != ""]
    cmd.remove("--arms")
    subprocess.run(cmd, cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
    return json.load(open(os.path.join(ROOT, out)))


def measures(D, arm):
    st_s = st_r = act_s = act_r = 0.0
    kd_s = h_s = kd_a = h_a = 0.0
    late_s = late_a = n5 = 0.0
    ko_s = ko_a = n_out = 0.0
    for f in D["fights"]:
        if f["err"]:
            continue
        a = f["arms"][arm]
        R = f["rounds"]
        c = a["cells"]
        fin = [(c[k] + c[R + k] + c[2 * R + k] + c[3 * R + k]) / a["n"] for k in range(R)]
        ko = sum(c[k] + c[2 * R + k] for k in range(R)) / a["n"]
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
        if f["outcome"]:
            n_out += 1
            ko_s += ko
            ko_a += 1 if f["outcome"]["cls"] == "KO" else 0
        if R == 5:
            n5 += 1
            late_s += fin[3] + fin[4]
            late_a += 1 if (m in ("KO", "DOC", "SUB") and rd >= 4) else 0
            st = a["st"]
            kd_s += st[5] + st[15]
            h_s += st[2] + st[12]
            if f["actual"]:
                kd_a += f["actual"]["A"]["kd"] + f["actual"]["B"]["kd"]
                h_a += f["actual"]["A"]["h_lnd"] + f["actual"]["B"]["h_lnd"]
    return {"stop_sim": st_s / st_r, "stop_act": act_s / act_r, "stop_events": act_s, "stop_intervals": act_r,
            "kd5_sim": 100 * kd_s / h_s, "kd5_act": 100 * kd_a / h_a, "kd5_n_kd": kd_a,
            "late_sim": late_s / n5, "late_act": late_a / n5, "n5": n5, "ko_sim": ko_s / n_out, "ko_act": ko_a / n_out}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--iters", type=int, default=6)
    ap.add_argument("--out", default="data/derived/v9/format_fit.json")
    a = ap.parse_args()
    os.makedirs(os.path.join(ROOT, "out/v9"), exist_ok=True)
    base = {"components": {"levels": False, "judgeWF": False, "format": False}}
    D0 = run(base, "out/v9/fmtfit_base.json")
    m0 = measures(D0, "fmt")
    se = m0["kd5_act"] / math.sqrt(max(1.0, m0["kd5_n_kd"]))
    gap_z = (m0["kd5_sim"] - m0["kd5_act"]) / se
    use_kd5 = abs(gap_z) > 2
    print("comparator: %s; 5-round KD gap z %.2f -> kd5 %s" % (json.dumps({k: round(v, 5) for k, v in m0.items()}), gap_z, "fit" if use_kd5 else "fixed at 1"))
    p = {"kd5": 1.0, "late5": 1.0, "conv": 1.0, "stop": 1.0}
    hist = [{"params": dict(p), "m": m0}]
    for it in range(a.iters):
        arm = {"components": {"levels": False, "judgeWF": False, "format": True}, "format": dict(p)}
        D = run(arm, "out/v9/fmtfit_it%d.json" % it)
        m = measures(D, "fmt")
        hist.append({"params": dict(p), "m": m})
        print("it %d %s -> %s" % (it, json.dumps({k: round(v, 4) for k, v in p.items()}),
                                  json.dumps({k: round(m[k], 5) for k in ("stop_sim", "kd5_sim", "late_sim", "ko_sim")})))
        damp = 0.8
        p["stop"] *= (m["stop_act"] / m["stop_sim"]) ** damp
        if use_kd5:
            p["kd5"] *= (m["kd5_act"] / m["kd5_sim"]) ** damp
        p["late5"] *= (m["late_act"] / m["late_sim"]) ** (damp * 1.2)
        # KO share responds less than one for one to the conversion odds: elasticity ~0.5 on the share
        p["conv"] *= (m["ko_act"] / m["ko_sim"]) ** (damp * 2.0)
    out = {"meta": {"tool": "tools/v9_format_fit.py", "window": "train 2019-01-01..2023-12-31 (backtest_dev.json)", "seed": 102, "sims": 300,
                    "kd5_gap_z_on_comparator": gap_z, "kd5_fit": use_kd5,
                    "targets": {k: m0[k] for k in ("stop_act", "kd5_act", "late_act", "ko_act", "stop_events", "stop_intervals", "n5")}},
           "final": {k: round(v, 4) for k, v in p.items()}, "history": hist}
    json.dump(out, open(os.path.join(ROOT, a.out), "w"), indent=1)
    print("final", out["final"], "->", a.out)


if __name__ == "__main__":
    main()
