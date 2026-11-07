#!/usr/bin/env python3
"""v5_train_ablation_report.py: markdown tables + the pre-registered decision rule for Calibrate A (TRAIN 2019-2023 only).

Reads data/derived/v5_train_ablation[_<tag>].json (tools/v5_train_ablation.js) and data/derived/v5_train_ablation_mr[_<tag>].json
(tools/v5_train_ablation_mr.py) and prints the tables for research/v5_train_ablation.md, with each arm's verdict under the rule
written there before the run (eps = 0.0005 neutral band on the primary, soft-label CE vs the closing line).

    python3 tools/v5_train_ablation_report.py [--tag main] [--json out.json]
"""
import argparse
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EPS = 0.0005
TOL = 1e-9                                  # |x| below this is 0 (floating-point noise: e.g. deductions move no method mass)
STRUCT = {"-dynamics"}                      # capability / structure components (kept unless removal helps)
LABEL = {"-durability": "durability", "-dynamics": "dynamics", "-sos": "styles_sos SOS (neither SOS nor oppadj)",
         "oppadj": "oppadj instead of SOS", "-embed": "embed", "-preufc": "preufc", "-emJudge": "v401 (a) emJudge",
         "-deductions": "v401 (b) deductions", "-mlLevels": "v401 (c) mlLevels", "-tdCap": "v401 (d) tdCap",
         "-koTargets": "v401 (e) koTargets", "v3p": "v3 params + learned rates", "v3pj": "v3 params + learned rates, v5 judging",
         "final": "final defaults", "all": "as merged (all on)"}


def ci(d, k=4, scale=1.0):
    e, lo, hi = d["est"] * scale, d["lo"] * scale, d["hi"] * scale
    f = "%+." + str(k) + "f"
    s = (f % e) + " [" + (f % lo) + ", " + (f % hi) + "]"
    if d["lo"] > TOL or d["hi"] < -TOL:
        s = "**" + s + "**"
    return s


def mrd(d, k=4):
    return {"est": d["diff"], "lo": d["ci95"][0], "hi": d["ci95"][1]}


def secondaries(P, M):
    """Secondary metrics as {name: {est, lo, hi}} (arm minus all; > 0 = worse without the component)."""
    s = {"winner": P["winLL"], "7-bin": P["bin7"], "method": P["method"], "stat lines": P["devTot"]}
    if M:
        s["method x round"] = mrd(M["method_round"])
        s["who x how x when"] = mrd(M["joint"])
    return s


def verdict(arm, P, M):
    p = P["softCE"]
    sec = secondaries(P, M)
    worse = [k for k, v in sec.items() if v["lo"] > TOL]
    better = [k for k, v in sec.items() if v["hi"] < -TOL]
    neutral = p["lo"] >= -EPS and p["hi"] <= EPS
    if arm in STRUCT:
        helps = (p["hi"] < -TOL) or (better and p["est"] <= 0)
        return ("off (removal helps)" if helps else "keep (structure; removal does not help)"), worse, better, neutral
    if p["est"] > 0 and not neutral:
        return "keep (primary worse without it)", worse, better, neutral
    if neutral and worse and not better:
        return "keep (primary neutral; secondary worse without it)", worse, better, neutral
    return "off", worse, better, neutral


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", default="main")
    ap.add_argument("--json", default=None)
    a = ap.parse_args()
    tag = ("_" + a.tag) if a.tag else ""
    S = json.load(open(os.path.join(ROOT, "data/derived", "v5_train_ablation%s.json" % tag)))
    mrp = os.path.join(ROOT, "data/derived", "v5_train_ablation_mr%s.json" % tag)
    MRJ = json.load(open(mrp)) if os.path.exists(mrp) else None
    REF = S["meta"].get("ref", "all")
    arms = [k for k in S["meta"]["arms"] if k != REF]
    m = S["meta"]
    print("Run: %d fights x 2 orders x %d sims per arm, %d event-date clusters, %d bootstrap resamples, errors %d, wall %.0f s." % (
        m["fights"], m["sims_per_order"], m["clusters"], m["bootstrap"], m["errors"], m["wall_s"]))
    print("Engine %s (sha256 %s...), params %s (sha256 %s...).\n" % (m["engine_version"], m["engine_sha256"][:12], m["params_version"], m["params_sha256"][:12]))
    L = S["levels"][REF]
    RL = LABEL.get(REF, REF)
    print("### Levels of the reference arm, %s (train, 95%% event-cluster intervals)\n" % RL)
    print("| metric | %s |" % RL)
    print("|---|---|")
    for k, nm in [("softCE", "Soft-label CE vs the close"), ("winLL", "Winner log loss"), ("brier", "Brier"), ("acc", "Accuracy"),
                  ("bin7", "7-bin log loss"), ("method", "Method log loss")]:
        d = L[k]
        print("| %s (n %d) | %.4f [%.4f, %.4f] |" % (nm, d["n"], d["est"], d["lo"], d["hi"]))
    if MRJ:
        for k, nm in [("method_round", "Method x round (methodround)"), ("joint", "Who x how x when (methodround)")]:
            d, s = MRJ["levels"][REF][k], MRJ["levels"]["S"][k]
            vs = MRJ["vs_S"][REF][k]
            print("| %s | %.4f [%.4f, %.4f]; model S %.4f, all - S %+.4f [%+.4f, %+.4f] |" % (nm, d["mean"], d["ci95"][0], d["ci95"][1], s["mean"], vs["diff"], vs["ci95"][0], vs["ci95"][1]))
    print()
    print("### Paired differences: arm minus %s (> 0 = removing the component hurts; bold = 95%% interval excludes 0)\n" % RL)
    hdr = "| arm (removed / changed) | soft CE vs close | winner LL | 7-bin | method | method x round | who x how x when | stat lines (% rel.) | rule verdict |"
    print(hdr)
    print("|" + "---|" * 9)
    V = {}
    for arm in arms:
        P = S["paired"][arm]
        M = MRJ["vs_all"].get(arm) if MRJ else None
        v, worse, better, neutral = verdict(arm, P, M)
        if arm == "oppadj":
            p = P["softCE"]
            nb = p["lo"] >= -EPS and p["hi"] <= EPS
            st = P["devTot"]
            if p["est"] < 0 and not nb:
                v = "oppadj replaces SOS"
            elif nb and st["hi"] < 0:
                v = "oppadj replaces SOS (stat lines decide)"
            else:
                v = "SOS stays (oppadj not better)"
        if arm == "-sos":
            v = "information (exactly one of SOS / oppadj stays)"
        if arm in ("v3p", "v3pj"):
            p = P["softCE"]
            bad = [k for k in ("winLL", "bin7", "method") if P[k]["lo"] > TOL]
            v = "adopt v3 params" if (p["hi"] < -TOL and not bad) else "v4 parameter set stays"
        if arm in ("final", "all"):
            v = "confirmation"
        V[arm] = {"verdict": v, "secondary_worse_without": worse, "secondary_better_without": better, "primary_clearly_neutral": neutral}
        row = [LABEL.get(arm, arm), ci(P["softCE"]), ci(P["winLL"]), ci(P["bin7"]), ci(P["method"]),
               ci(mrd(M["method_round"])) if M else "", ci(mrd(M["joint"])) if M else "", ci(P["devTot"], 2, 100.0), v]
        print("| " + " | ".join(row) + " |")
    print()
    print("### Stat-line deviance per target (arm minus %s, per fighter; bold = interval excludes 0)\n" % RL)
    T = ["sig_lnd", "sig_att", "td_lnd", "td_att", "ctrl", "kd", "h_lnd", "sub_att"]
    print("| arm | " + " | ".join(T) + " |")
    print("|" + "---|" * (len(T) + 1))
    print("| %s level | " % RL + " | ".join("%.3f" % L["dev_" + t]["est"] for t in T) + " |")
    for arm in arms:
        P = S["paired"][arm]
        print("| %s | " % LABEL.get(arm, arm) + " | ".join(ci(P["dev_" + t], 3 if t != "ctrl" else 2) for t in T) + " |")
    print()
    print("### Other methodround metrics (arm minus %s)\n" % RL)
    if MRJ:
        ks = ["finish", "round_given_fin", "ko_vs_sub", "method_given_winner", "method3"]
        print("| arm | " + " | ".join(ks) + " |")
        print("|" + "---|" * (len(ks) + 1))
        print("| %s level | " % RL + " | ".join("%.4f" % MRJ["levels"][REF][k]["mean"] for k in ks) + " |")
        for arm in arms:
            M = MRJ["vs_all"][arm]
            print("| %s | " % LABEL.get(arm, arm) + " | ".join(ci(mrd(M[k])) for k in ks) + " |")
        print()
    print("### Base rates (simulated, train fights; actual in the first row)\n")
    B0 = S["baseRates"][REF]
    cols = ["finish", "KO", "SUB", "draw", "R1/R2/R3 (3 rd)", "R1..R5 (5 rd)", "KD/100 head", "UD/SD/MD", "10-8", "sig/15", "TD/15", "ctrl/15"]
    print("| arm | " + " | ".join(cols) + " |")
    print("|" + "---|" * (len(cols) + 1))

    def row(br, key):
        g = lambda o: o[key]
        out = ["%.1f" % (100 * g(br["finish"])), "%.1f" % (100 * g(br["KO"])), "%.1f" % (100 * g(br["SUB"])), "%.2f" % (100 * g(br["draw"])),
               "/".join("%.1f" % (100 * x) for x in br["finByRound3"][key]), "/".join("%.1f" % (100 * x) for x in br["finByRound5"][key]),
               "%.3f" % g(br["kdPer100Head"]),
               "/".join("%.1f" % (100 * br["decision"][key][k]) for k in ("UD", "SD", "MD")),
               "%.2f" % (100 * g(br["r108"])), "%.1f" % g(br["sigLndPer15"]), "%.3f" % g(br["tdPer15"]), "%.1f" % g(br["ctrlPer15"])]
        return out
    print("| actual | " + " | ".join(row(B0, "actual")) + " |")
    print("| %s | " % RL + " | ".join(row(B0, "sim")) + " |")
    for arm in arms:
        print("| %s | " % LABEL.get(arm, arm) + " | ".join(row(S["baseRates"][arm], "sim")) + " |")
    print()
    print("ML (learned rates) applied: " + ", ".join("%s %.1f%%" % (k, 100 * v) for k, v in S["ml_applied"].items()))
    if a.json:
        json.dump(V, open(a.json, "w"), indent=1)


if __name__ == "__main__":
    main()
