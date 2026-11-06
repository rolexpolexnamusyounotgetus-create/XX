#!/usr/bin/env python3
"""v5_joint_levels.py: joint knockdown / finish level check for engine v5 (components durability + dynamics), TRAIN only.

v5 merge step 2 (docs/CHANGELOG.md "v5 merge log"). Both components carry a global knockdown scale (durability.kdCal,
matched with dynamics off; dyn.kdLevel3 / kdLevel5, matched with durability off and before step 1's koComp factors), and
dynamics carries the finish levels (convLevel, stkoScale, gnpScale). This report compares the four configurations with
the 2019-2023 actuals so the Calibrate stage can set ONE joint knockdown level. It does not change any parameter.

Input: merged tools/dynamics_bt.js output with configs s1 (both off), dur, dyn, both (walk-forward inputs: frozen
profiles, as-of priors, out-of-fold learned rates, durability walk-forward records + train NORM).
  node tools/dynamics_bt.js --out part0.json --part 0 --parts 3 --sims 50 \
    --cfg s1='{"components":{"durability":false,"dynamics":false}}' --cfg dur='{"components":{"dynamics":false}}' \
    --cfg dyn='{"components":{"durability":false}}' --cfg both='{}'
  node tools/dynamics_bt.js --merge joint.json part0.json part1.json part2.json
  python3 tools/v5_joint_levels.py joint.json joint_report.json      (also writes joint_report.txt)

Actuals: backtest_dev.json results and fight-level stats of the same train fights (KD per 15, KD per 100 head landed,
finish shares by round); per-round KD per 100 standing head landed from data/derived/dynamics.json targets_by_round.train
(all UFC rounds 2019-2023, the research panel; ufcstats has no standing split per backtest fight). Uncertainty of the
actuals: event-cluster bootstrap (NBOOT, default 2,000). Refuses any fight dated 2024-01-01 or later.
"""
import collections
import json
import os
import random
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
run = json.load(open(sys.argv[1]))
bt = json.load(open(os.path.join(ROOT, "data/derived/backtest_dev.json")))
dyn = json.load(open(os.path.join(ROOT, "data/derived/dynamics.json")))
P0 = None
fights = {f["id"]: f for f in bt["fights"] if "2019-01-01" <= f["date"] < "2024-01-01"}
bad = [i for i in run["fights"] if i not in fights]
if bad:
    sys.exit("refusing: %d fights in the run are not 2019-2023 train fights (hidden-data protocol)" % len(bad))
ids = sorted(i for i in run["fights"] if all(not run["fights"][i].get(c[0], {}).get("err") for c in run["meta"]["configs"]))
CFGS = [c[0] for c in run["meta"]["configs"]]
RS = run["meta"]["rt_columns"]
ci = {k: i for i, k in enumerate(RS)}
CLS = {"KO": "KO", "DOC": "KO", "SUB": "SUB", "UD": "DEC", "SD": "DEC", "MD": "DEC", "DRAW": "DEC"}   # NC / CNC / DQ: None


def fight_rows(i):
    f = fights[i]
    nR = f["rounds"]
    r = f["result"]
    a = f["actual"]
    act = {"nR": nR, "cls": CLS.get(r["method"]), "round": r.get("round") or 1, "secs": r.get("fight_s") or 0,
           "kd": (a["A"].get("kd") or 0) + (a["B"].get("kd") or 0), "h": (a["A"].get("h_lnd") or 0) + (a["B"].get("h_lnd") or 0),
           "event": f["event"]}
    sims = {}
    for c in CFGS:
        s = run["fights"][i][c]
        n = s["n"]
        rt = s["rt"]
        sims[c] = {"secs": sum(row[ci["secs"]] for row in rt[0]) / n,
                   "kdR": [(rt[0][q][ci["kd"]] + rt[1][q][ci["kd"]]) / n for q in range(nR)],
                   "shR": [(rt[0][q][ci["sh_lnd"]] + rt[1][q][ci["sh_lnd"]]) / n for q in range(nR)],
                   "hR": [(rt[0][q][ci["h_lnd"]] + rt[1][q][ci["h_lnd"]]) / n for q in range(nR)],
                   "ko": s["ko"], "sub": s["sub"], "dec": s["dec"], "koEnd": [x / n for x in s["koEnd"]],
                   "kdConv": sum(s["kdConv"]) / n, "kdN": sum(s["kd"]) / n, "kdRounds": sum(s["kdRounds"]) / n,
                   "stko": s["stko"] / n, "gtko": s["gtko"] / n, "n": n}
    return act, sims


D = {i: fight_rows(i) for i in ids}


def agg(sel, fn):
    num = den = 0.0
    for i in sel:
        a, b = fn(D[i])
        num += a
        den += b
    return num / den if den else float("nan")


events = collections.defaultdict(list)
for i in ids:
    events[D[i][0]["event"]].append(i)
EV = sorted(events)
random.seed(20261106)
NB = int(os.environ.get("NBOOT", "2000"))
BOOT = [[random.choice(EV) for _ in EV] for _ in range(NB)]


def boot_ci(sel_fn, fn):
    vals = []
    for b in BOOT:
        sel = [i for e in b for i in events[e] if sel_fn(i)]
        vals.append(agg(sel, fn))
    vals.sort()
    return vals[int(0.025 * len(vals))], vals[int(0.975 * len(vals)) - 1]


def fmt(x, d=3):
    return ("%." + str(d) + "f") % x


out = {"meta": {"fights": len(ids), "configs": CFGS, "run": run["meta"], "nboot": NB}, "tables": {}}
lines = []


def P(s=""):
    lines.append(s)
    print(s)


P("Joint knockdown / finish level check, TRAIN 2019-2023: %d fights, %d sims per fight per config (both corner orders), configs %s"
  % (len(ids), D[ids[0]][1][CFGS[0]]["n"], ", ".join(CFGS)))
P("engine %s, params %s, engine3 sha256 %s..., params3 sha256 %s..." % (run["meta"]["engine_version"], run["meta"]["params_version"],
  run["meta"]["engine3_sha256_16"], run["meta"]["params3_sha256_16"]))
P()
for fmtR in (3, 5, None):
    sel_fn = (lambda i, R=fmtR: R is None or D[i][0]["nR"] == R)
    sel = [i for i in ids if sel_fn(i)]
    lab = "all" if fmtR is None else "%d-round" % fmtR
    act = agg(sel, lambda d: (d[0]["kd"], d[0]["secs"] / 900))
    lo, hi = boot_ci(sel_fn, lambda d: (d[0]["kd"], d[0]["secs"] / 900))
    row = {"actual": act, "ci": [lo, hi], "n": len(sel)}
    for c in CFGS:
        row[c] = agg(sel, lambda d, c=c: (sum(d[1][c]["kdR"]), d[1][c]["secs"] / 900))
    out["tables"]["kd15_" + lab] = row
    P("KD per 15 min, %s (n=%d): actual %s [%s, %s]; " % (lab, len(sel), fmt(act), fmt(lo), fmt(hi)) +
      "; ".join("%s %s (x%s)" % (c, fmt(row[c]), fmt(row[c] / act, 3)) for c in CFGS))
    act = agg(sel, lambda d: (d[0]["kd"], 1.0))
    lo, hi = boot_ci(sel_fn, lambda d: (d[0]["kd"], 1.0))
    row = {"actual": act, "ci": [lo, hi]}
    for c in CFGS:
        row[c] = agg(sel, lambda d, c=c: (sum(d[1][c]["kdR"]), 1.0))
    out["tables"]["kdfight_" + lab] = row
    P("KD per fight, %s: actual %s [%s, %s]; " % (lab, fmt(act), fmt(lo), fmt(hi)) + "; ".join("%s %s" % (c, fmt(row[c])) for c in CFGS))
    act = agg(sel, lambda d: (100 * d[0]["kd"], d[0]["h"]))
    lo, hi = boot_ci(sel_fn, lambda d: (100 * d[0]["kd"], d[0]["h"]))
    row = {"actual": act, "ci": [lo, hi]}
    for c in CFGS:
        row[c] = agg(sel, lambda d, c=c: (100 * sum(d[1][c]["kdR"]), sum(d[1][c]["hR"])))
    out["tables"]["kd100h_" + lab] = row
    P("KD per 100 head landed (all positions), %s: actual %s [%s, %s]; " % (lab, fmt(act), fmt(lo), fmt(hi)) +
      "; ".join("%s %s" % (c, fmt(row[c])) for c in CFGS))
    row = {c: agg(sel, lambda d, c=c: (d[1][c]["kdConv"], d[1][c]["kdRounds"])) for c in CFGS}
    out["tables"]["kdconv_round_" + lab] = row
    row2 = {c: agg(sel, lambda d, c=c: (d[1][c]["kdConv"], d[1][c]["kdN"])) for c in CFGS}
    out["tables"]["kdconv_kd_" + lab] = row2
    P("strike finish by the man who scored a KD, same round: per KD round " + "; ".join("%s %s" % (c, fmt(row[c])) for c in CFGS) +
      " | per KD " + "; ".join("%s %s" % (c, fmt(row2[c])) for c in CFGS) + "  (dynamics.json train conversion 0.512 per KD)")
    P()

P("KD per 100 standing head landed by round (real: dynamics.json targets_by_round.train, all UFC 2019-2023 rounds)")
for R in (3, 5):
    sel = [i for i in ids if D[i][0]["nR"] == R]
    tb = dyn["targets_by_round"]["train"]
    real = [tb["%d_%d" % (R, q + 1)]["kd_per100_standing_head"] for q in range(R)]
    nkd = [tb["%d_%d" % (R, q + 1)]["n_kd"] for q in range(R)]
    row = {"real": real, "real_n_kd": nkd}
    for c in CFGS:
        row[c] = [agg(sel, lambda d, c=c, q=q: (100 * d[1][c]["kdR"][q], d[1][c]["shR"][q])) for q in range(R)]
    out["tables"]["kd100sh_by_round_%dR" % R] = row
    P("  %d rounds  real   %s   (KDs %s)" % (R, " / ".join(fmt(x, 2) for x in real), "/".join(str(x) for x in nkd)))
    for c in CFGS:
        P("  %d rounds  %-5s  %s" % (R, c, " / ".join(fmt(x, 2) for x in row[c])))
P()

P("Finish share by round (share of the format's fights; KO class = KO/TKO/GNP/doctor/corner as tools/evalv.js); NC/CNC/DQ excluded")
for R in (3, 5):
    selR = lambda i, R=R: D[i][0]["nR"] == R and D[i][0]["cls"]
    sel = [i for i in ids if selR(i)]
    n = len(sel)

    def hit(d, q, kind):
        a = d[0]
        okc = a["cls"] in ("KO", "SUB") if kind == "fin" else a["cls"] == kind
        return 1.0 if okc and a["round"] == q + 1 else 0.0

    tab = {}
    for kind in ("fin", "KO", "SUB"):
        real = [sum(hit(D[i], q, kind) for i in sel) / n for q in range(R)]
        cis = [list(boot_ci(selR, lambda d, q=q, kind=kind: (hit(d, q, kind), 1.0))) for q in range(R)]
        tab[kind] = {"real": real, "ci": cis}
        for c in CFGS:
            if kind == "fin":
                v = [sum(D[i][1][c]["ko"][q] + D[i][1][c]["sub"][q] for i in sel) / n for q in range(R)]
            elif kind == "KO":
                v = [sum(D[i][1][c]["ko"][q] for i in sel) / n for q in range(R)]
            else:
                v = [sum(D[i][1][c]["sub"][q] for i in sel) / n for q in range(R)]
            tab[kind][c] = v
    tot = {}
    for kind in ("fin", "KO", "SUB"):
        lo, hi = boot_ci(selR, lambda d, kind=kind: (sum(hit(d, q, kind) for q in range(R)), 1.0))
        tot[kind] = {"real": sum(tab[kind]["real"]), "ci": [lo, hi]}
        for c in CFGS:
            tot[kind][c] = sum(tab[kind][c])
    # hazard per round reached (finishes in round r / fights reaching round r)
    haz = {}
    for kind in ("fin", "KO", "SUB"):
        haz[kind] = {}
        for c in ["real"] + CFGS:
            v = tab[kind][c]
            fin = tab["fin"][c]
            h, alive = [], 1.0
            for q in range(R):
                h.append(v[q] / alive if alive > 0 else float("nan"))
                alive -= fin[q]
            haz[kind][c] = h
    out["tables"]["finish_by_round_%dR" % R] = {"n": n, "by_round": tab, "totals": tot, "hazard": haz}
    P("  %d rounds (n=%d)" % (R, n))
    for kind in ("fin", "KO", "SUB"):
        rr = tab[kind]
        P("    %-4s real  %s   total %s [%s, %s]   (95%% CI by round %s)" % (
            kind, " / ".join(fmt(100 * x, 1) for x in rr["real"]), fmt(100 * tot[kind]["real"], 1), fmt(100 * tot[kind]["ci"][0], 1),
            fmt(100 * tot[kind]["ci"][1], 1), " ".join("[%s,%s]" % (fmt(100 * a, 1), fmt(100 * b, 1)) for a, b in rr["ci"])))
        for c in CFGS:
            P("    %-4s %-5s %s   total %s" % (kind, c, " / ".join(fmt(100 * x, 1) for x in rr[c]), fmt(100 * tot[kind][c], 1)))
    P("    hazard per round reached, KO class: " + "; ".join("%s %s" % (c, " / ".join(fmt(x, 3) for x in haz["KO"][c])) for c in ["real"] + CFGS))
    P("    hazard per round reached, SUB:      " + "; ".join("%s %s" % (c, " / ".join(fmt(x, 3) for x in haz["SUB"][c])) for c in ["real"] + CFGS))
P()

P("Non-knockdown stoppages (rounds without a KD by either man), share of strike KO/TKO finishes; descriptive")
row = {}
for c in CFGS:
    ko = sum(sum(D[i][1][c]["koEnd"]) for i in ids)
    row[c] = {"standing_tko_noKD": sum(D[i][1][c]["stko"] for i in ids) / ko, "gnp_noKD": sum(D[i][1][c]["gtko"] for i in ids) / ko}
out["tables"]["noKD_stoppage_share"] = row
P("  " + "; ".join("%s standing %s, ground %s" % (c, fmt(100 * row[c]["standing_tko_noKD"], 1), fmt(100 * row[c]["gnp_noKD"], 1)) for c in CFGS) +
  "  (step 1 targets, data/derived/ko_composition_pre2024.json: standing without a KD 7.2%, all ground 28.6%)")
P()

P("Implied single-factor knockdown re-match for 'both' (actual / sim KD per 15), informational only; Calibrate sets one joint level")
PRM_KD = {"3-round": ("kdLevel3", 0.655), "5-round": ("kdLevel5", 0.559)}
for lab in ("3-round", "5-round", "all"):
    t = out["tables"]["kd15_" + lab]
    if "both" not in t:
        continue
    fac = t["actual"] / t["both"]
    lo, hi = t["actual"] / t["both"] * t["ci"][0] / t["actual"], t["actual"] / t["both"] * t["ci"][1] / t["actual"]
    t["implied_factor_both"] = fac
    t["implied_factor_both_ci"] = [lo, hi]
    extra = ""
    if lab in PRM_KD:
        k, v = PRM_KD[lab]
        extra = " (%s %s -> about %s if matched by kdLevel alone)" % (k, v, fmt(v * fac, 3))
    P("  %s: x%s [%s, %s from the actuals' CI]%s; kdCal 1.1639618 -> about %s if matched by kdCal alone" % (
        lab, fmt(fac, 3), fmt(lo, 3), fmt(hi, 3), extra, fmt(1.1639618 * fac, 4)))
json.dump(out, open(sys.argv[2], "w"), indent=1)
open(os.path.splitext(sys.argv[2])[0] + ".txt", "w").write("\n".join(lines) + "\n")
