"""Metrics for tools/durability_ablation.js runs: variant vs baseline with paired event-cluster bootstrap CIs.

    python3 tools/durability_ablation_report.py DIR [--base off] [--vs on] [--boot 2000] [--json out.json] [--md out.md]

Per fight, each variant's probabilities are the average of the A-B and B-A runs (corner-symmetric). Metrics:
- winner log loss on decisive fights, p(A) = P(A wins) / (P(A wins) + P(B wins));
- soft-label cross-entropy against the closing line, -(q log p + (1 - q) log(1 - p)) with q = market.json p_power_close
  (3-4.6x less noisy than the 0/1 label, research/model_market.md);
- 7-bin log loss (A KO/TKO, A SUB, A DEC, draw, B DEC, B SUB, B KO/TKO; doctor stoppages count as KO/TKO; NC and DQ
  excluded) and 3-way method log loss (KO/TKO, SUB, decision or draw);
- stat-line deviance: Poisson deviance of each side's simulated mean against the actual count (control in minutes);
- base rates: simulated vs actual finish, KO/TKO, SUB, round-1 finish shares, knockdowns per fight, KD O/E by
  defender age band and prior KO losses.
Probabilities are floored at 0.5 / (2 x sims) (Monte Carlo zeros). CIs: 2.5-97.5% of B bootstrap resamples of events
(all fights of a UFC event move together), paired (the same resample for both variants).
"""
import json, math, os, sys, glob, argparse
import numpy as np

W = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser()
ap.add_argument("dir")
ap.add_argument("--base", default="off")
ap.add_argument("--vs", default="on")
ap.add_argument("--boot", type=int, default=2000)
ap.add_argument("--json", default=None)
ap.add_argument("--md", default=None)
a = ap.parse_args()


def derived(name):
    p = os.path.join(W, "data", "derived", name)
    return json.load(open(p if os.path.exists(p) else os.path.join("/home/user/XX/data/derived", name)))


runs = {}
meta = None
for fn in sorted(glob.glob(os.path.join(a.dir, "part*of*.json"))):
    j = json.load(open(fn))
    meta = meta or j["meta"]
    runs.update(j["fights"])
bt = {f["id"]: f for f in derived("backtest_dev.json")["fights"]}
mk = derived("market.json")["fights"]
dur = derived("durability.json")["backtest"]
ids = sorted(i for i in runs if a.base in runs[i]["o"]["AB"] and a.vs in runs[i]["o"]["AB"])
assert all(bt[i]["date"] < "2024-01-01" for i in ids) or os.environ.get("ALLOW_VALIDATION"), "2024+ fights in a train report"
V = [a.base, a.vs]
N = meta["sims_per_orientation"]
FLOOR = 0.5 / (2 * N)


def sym(r, v):
    ab, ba = r["o"]["AB"][v], r["o"]["BA"][v]
    n = ab["n"] + ba["n"]
    pA = (ab["win"][0] + ba["win"][1]) / n
    pB = (ab["win"][1] + ba["win"][0]) / n
    bins = [(ab["bins"][k] + ba["bins"][6 - k]) / n for k in range(7)]
    st = {}
    for s in ab["A"]:
        st[s] = ((ab["A"][s] + ba["B"][s]) / n, (ab["B"][s] + ba["A"][s]) / n)
    finA = [(x + y) / n for x, y in zip(ab["finA"], ba["finB"])]
    finB = [(x + y) / n for x, y in zip(ab["finB"], ba["finA"])]
    return {"pA": pA, "pB": pB, "bins": bins, "st": st, "finA": finA, "finB": finB, "min": (ab["min"] + ba["min"]) / n,
            "kd": (0.5 * (ab["kd"][0] + ba["kd"][1]), 0.5 * (ab["kd"][1] + ba["kd"][0]))}


def outcome7(res):
    m, w = res["method"], res["winner"]
    if w == "D":
        return 3
    if w not in ("A", "B"):
        return None
    k = 0 if m in ("KO", "DOC") else 1 if m == "SUB" else 2 if m in ("UD", "SD", "MD") else None
    if k is None:
        return None
    return k if w == "A" else 6 - k


rows = []
for i in ids:
    f, r = bt[i], runs[i]
    res = f["result"]
    S = {v: sym(r, v) for v in V}
    row = {"id": i, "event": f["event"], "date": f["date"], "rounds": f["rounds"], "year": f["date"][:4], "S": S, "res": res,
           "act": f.get("actual"), "o7": outcome7(res), "q": (mk.get(i) or {}).get("p_power_close"),
           "ageA": f["A"].get("age"), "ageB": f["B"].get("age"), "kolA": f["A"].get("ko_losses", 0), "kolB": f["B"].get("ko_losses", 0)}
    rows.append(row)
events = sorted(set(r["event"] for r in rows))
eidx = {e: k for k, e in enumerate(events)}
EI = np.array([eidx[r["event"]] for r in rows])
rng = np.random.default_rng(20261106)
BOOT = [np.bincount(rng.integers(0, len(events), len(events)), minlength=len(events)) for _ in range(a.boot)]


def clipp(p):
    return min(max(p, FLOOR), 1 - FLOOR)


def per_fight(fn):
    """fn(row, S) -> value or None; returns arrays (mask, base, vs)."""
    m, x, y = [], [], []
    for r in rows:
        u = fn(r, r["S"][a.base]); w = fn(r, r["S"][a.vs])
        if u is None or w is None:
            m.append(False); x.append(0.0); y.append(0.0)
        else:
            m.append(True); x.append(u); y.append(w)
    return np.array(m), np.array(x), np.array(y)


def boot_mean_diff(mask, x, y):
    """paired event bootstrap of mean(y) - mean(x) over masked fights."""
    ev = EI[mask]
    sx = np.bincount(ev, weights=x[mask], minlength=len(events)); sy = np.bincount(ev, weights=y[mask], minlength=len(events))
    c = np.bincount(ev, minlength=len(events)).astype(float)
    d = []
    for wts in BOOT:
        n = (wts * c).sum()
        d.append(((wts * sy).sum() - (wts * sx).sum()) / n)
    d = np.array(d)
    return float(y[mask].mean() - x[mask].mean()), float(np.percentile(d, 2.5)), float(np.percentile(d, 97.5))


def boot_ratio(mask, num, den):
    ev = EI[mask]
    sn = np.bincount(ev, weights=num[mask], minlength=len(events)); sd = np.bincount(ev, weights=den[mask], minlength=len(events))
    vals = [(w * sn).sum() / (w * sd).sum() for w in BOOT]
    return float(num[mask].sum() / den[mask].sum()), float(np.percentile(vals, 2.5)), float(np.percentile(vals, 97.5))


OUT = {"meta": meta, "n_fights": len(rows), "n_events": len(events), "base": a.base, "vs": a.vs, "metrics": {}, "by_year": {}, "base_rates": [], "kd_oe": {}}


def metric(name, fn, note=""):
    mask, x, y = per_fight(fn)
    d, lo, hi = boot_mean_diff(mask, x, y)
    OUT["metrics"][name] = {"n": int(mask.sum()), a.base: float(x[mask].mean()), a.vs: float(y[mask].mean()), "diff": d, "lo": lo, "hi": hi, "note": note}
    by = {}
    for yr in sorted(set(r["year"] for r in rows)):
        mm = mask & np.array([r["year"] == yr for r in rows])
        if mm.sum():
            by[yr] = {"n": int(mm.sum()), a.base: float(x[mm].mean()), a.vs: float(y[mm].mean()), "diff": float(y[mm].mean() - x[mm].mean())}
    OUT["by_year"][name] = by
    return mask, x, y


def winner_ll(r, s):
    w = r["res"]["winner"]
    if w not in ("A", "B"):
        return None
    p = clipp(s["pA"] / max(1e-12, s["pA"] + s["pB"]))
    return -math.log(p if w == "A" else 1 - p)


def soft_ce(r, s):
    q = r["q"]
    if q is None:
        return None
    p = clipp(s["pA"] / max(1e-12, s["pA"] + s["pB"]))
    return -(q * math.log(p) + (1 - q) * math.log(1 - p))


def ll7(r, s):
    k = r["o7"]
    if k is None:
        return None
    return -math.log(max(s["bins"][k], FLOOR))


def method_ll(r, s):
    k = r["o7"]
    if k is None:
        return None
    b = s["bins"]
    pm = [b[0] + b[6], b[1] + b[5], b[2] + b[3] + b[4]]
    j = 0 if k in (0, 6) else 1 if k in (1, 5) else 2
    return -math.log(max(pm[j], FLOOR))


def brier(r, s):
    w = r["res"]["winner"]
    if w not in ("A", "B"):
        return None
    p = s["pA"] / max(1e-12, s["pA"] + s["pB"])
    return (p - (1.0 if w == "A" else 0.0)) ** 2


def round_ll(r, s):
    # finish round (or decision) log loss, winner-agnostic: categories R1..Rn finish, decision/draw
    res = r["res"]
    k = r["o7"]
    if k is None:
        return None
    n = r["rounds"]
    fin = [s["finA"][j] + s["finB"][j] for j in range(n)]
    dec = max(FLOOR, 1 - sum(fin))
    if k in (2, 3, 4):
        return -math.log(dec)
    j = min(n, max(1, int(res["round"]))) - 1
    return -math.log(max(fin[j], FLOOR))


metric("winner_log_loss", winner_ll, "decisive fights; symmetric")
metric("brier", brier, "decisive fights")
metric("soft_ce_close", soft_ce, "cross-entropy vs closing-line p_power_close")
metric("outcome7_log_loss", ll7, "7 bins")
metric("method_log_loss", method_ll, "KO/TKO, SUB, decision")
metric("round_log_loss", round_ll, "finish round 1..n or decision")

STAT_DEV = ["sig_lnd", "sig_att", "h_lnd", "kd", "td_lnd", "td_att", "sub_att", "ctrl"]


def pdev(y, mu):
    mu = max(mu, 1e-9)
    return 2 * ((y * math.log(y / mu) if y > 0 else 0.0) - (y - mu))


for st in STAT_DEV:
    def fn(r, s, st=st):
        act = r["act"]
        if not act:
            return None
        tot = 0.0
        for k2, side in ((0, "A"), (1, "B")):
            y = act[side][st]
            mu = s["st"][st][k2]
            if st == "ctrl":
                y, mu = y / 60.0, mu / 60.0
            tot += pdev(y, mu)
        return tot / 2
    metric("dev_" + st, fn, "Poisson deviance per fight-side" + (" (minutes)" if st == "ctrl" else ""))


# ---------------- base rates (simulated vs actual) ----------------
def br_row(name, fsim, fact, mask_fn=lambda r: True):
    m = np.array([mask_fn(r) and fact(r) is not None for r in rows])
    act = np.array([fact(r) if mm else 0.0 for r, mm in zip(rows, m)], float)
    xs = np.array([fsim(r["S"][a.base], r) if mm else 0.0 for r, mm in zip(rows, m)], float)
    ys = np.array([fsim(r["S"][a.vs], r) if mm else 0.0 for r, mm in zip(rows, m)], float)
    d, lo, hi = boot_mean_diff(m, xs, ys)
    db, lob, hib = boot_mean_diff(m, act, xs)
    dv, lov, hiv = boot_mean_diff(m, act, ys)
    OUT["base_rates"].append({"name": name, "n": int(m.sum()), "actual": float(act[m].mean()), a.base: float(xs[m].mean()), a.vs: float(ys[m].mean()),
                              "vs_minus_base": [d, lo, hi], "base_minus_actual": [db, lob, hib], "vs_minus_actual": [dv, lov, hiv]})


fin_act = lambda r: None if r["o7"] is None else (0.0 if r["o7"] in (2, 3, 4) else 1.0)
ko_act = lambda r: None if r["o7"] is None else (1.0 if r["o7"] in (0, 6) else 0.0)
sub_act = lambda r: None if r["o7"] is None else (1.0 if r["o7"] in (1, 5) else 0.0)
r1_act = lambda r: None if r["o7"] is None else (1.0 if r["o7"] not in (2, 3, 4) and int(r["res"]["round"]) == 1 else 0.0)
br_row("finish rate", lambda s, r: 1 - s["bins"][2] - s["bins"][3] - s["bins"][4], fin_act)
br_row("finish rate, 3 rounds", lambda s, r: 1 - s["bins"][2] - s["bins"][3] - s["bins"][4], fin_act, lambda r: r["rounds"] == 3)
br_row("finish rate, 5 rounds", lambda s, r: 1 - s["bins"][2] - s["bins"][3] - s["bins"][4], fin_act, lambda r: r["rounds"] == 5)
br_row("KO/TKO rate", lambda s, r: s["bins"][0] + s["bins"][6], ko_act)
br_row("KO/TKO rate, 5 rounds", lambda s, r: s["bins"][0] + s["bins"][6], ko_act, lambda r: r["rounds"] == 5)
br_row("SUB rate", lambda s, r: s["bins"][1] + s["bins"][5], sub_act)
br_row("round-1 finish rate", lambda s, r: s["finA"][0] + s["finB"][0], r1_act)
br_row("draw rate", lambda s, r: s["bins"][3], lambda r: None if r["o7"] is None else (1.0 if r["o7"] == 3 else 0.0))
br_row("knockdowns per fight", lambda s, r: s["st"]["kd"][0] + s["st"]["kd"][1], lambda r: (r["act"]["A"]["kd"] + r["act"]["B"]["kd"]) if r["act"] else None)
br_row("knockdowns per fight, 5 rounds", lambda s, r: s["st"]["kd"][0] + s["st"]["kd"][1], lambda r: (r["act"]["A"]["kd"] + r["act"]["B"]["kd"]) if r["act"] else None, lambda r: r["rounds"] == 5)
br_row("sig landed per fight (both)", lambda s, r: s["st"]["sig_lnd"][0] + s["st"]["sig_lnd"][1], lambda r: (r["act"]["A"]["sig_lnd"] + r["act"]["B"]["sig_lnd"]) if r["act"] else None)
br_row("minutes per fight", lambda s, r: s["min"], lambda r: r["res"]["fight_s"] / 60.0 if r["res"].get("fight_s") else None)
br_row("P(favourite wins) mean", lambda s, r: max(s["pA"], s["pB"]) / max(1e-12, s["pA"] + s["pB"]), lambda r: None if r["res"]["winner"] not in ("A", "B") else 0.0)

# ---------------- KD observed / simulated expected by defender band (a fight-side is the defender of the other's KDs)
def kd_oe(label, band_fn):
    out = {}
    groups = {}
    for idx, r in enumerate(rows):
        if not r["act"]:
            continue
        for k2, side, other in ((0, "A", "B"), (1, "B", "A")):
            g = band_fn(r, side)
            if g is None:
                continue
            obs = r["act"][other]["kd"]
            e0 = r["S"][a.base]["st"]["kd"][1 - k2]
            e1 = r["S"][a.vs]["st"]["kd"][1 - k2]
            groups.setdefault(g, []).append((idx, obs, e0, e1))
    for g in sorted(groups):
        L = groups[g]
        idxs = np.array([t[0] for t in L]); obs = np.array([t[1] for t in L], float)
        e0 = np.array([t[2] for t in L]); e1 = np.array([t[3] for t in L])
        ev = EI[idxs]
        so = np.bincount(ev, weights=obs, minlength=len(events)); s0 = np.bincount(ev, weights=e0, minlength=len(events)); s1 = np.bincount(ev, weights=e1, minlength=len(events))
        b0 = [(w * so).sum() / (w * s0).sum() for w in BOOT]; b1 = [(w * so).sum() / (w * s1).sum() for w in BOOT]
        out[g] = {"n": len(L), "kd": float(obs.sum()), "exp_" + a.base: float(e0.sum()), "exp_" + a.vs: float(e1.sum()),
                  "oe_" + a.base: [float(obs.sum() / e0.sum()), float(np.percentile(b0, 2.5)), float(np.percentile(b0, 97.5))],
                  "oe_" + a.vs: [float(obs.sum() / e1.sum()), float(np.percentile(b1, 2.5)), float(np.percentile(b1, 97.5))]}
    OUT["kd_oe"][label] = out


def age_band(r, side):
    ag = r["age" + side]
    if ag is None:
        return None
    return "<27" if ag < 27 else "27-30" if ag < 30 else "30-33" if ag < 33 else "33-36" if ag < 36 else "36+"


kd_oe("defender age", age_band)
kd_oe("defender prior KO losses", lambda r, side: "0" if r["kol" + side] == 0 else "1" if r["kol" + side] == 1 else "2+")
kd_oe("year", lambda r, side: r["year"])
kd_oe("all", lambda r, side: "all")

# ---------------- print
def f4(x):
    return "%.4f" % x


print("fights %d, events %d, sims/orientation %d, variants %s vs %s, ml %s" % (len(rows), len(events), N, a.base, a.vs, meta.get("ml")))
print("%-22s %6s %9s %9s %9s  %s" % ("metric", "n", a.base, a.vs, "diff", "95% CI (event bootstrap, paired)"))
for k, v in OUT["metrics"].items():
    print("%-22s %6d %9.4f %9.4f %+9.4f  [%+.4f, %+.4f]" % (k, v["n"], v[a.base], v[a.vs], v["diff"], v["lo"], v["hi"]))
print("\nwinner log loss by year:", {y: "%.4f->%.4f" % (b[a.base], b[a.vs]) for y, b in OUT["by_year"]["winner_log_loss"].items()})
print("soft CE by year:", {y: "%.4f->%.4f" % (b[a.base], b[a.vs]) for y, b in OUT["by_year"]["soft_ce_close"].items()})
print("\n%-32s %6s %8s %8s %8s  %-26s %-26s" % ("base rate", "n", "actual", a.base, a.vs, a.vs + "-" + a.base, a.vs + "-actual"))
for b in OUT["base_rates"]:
    print("%-32s %6d %8.3f %8.3f %8.3f  %+.3f [%+.3f,%+.3f]   %+.3f [%+.3f,%+.3f]" % (b["name"], b["n"], b["actual"], b[a.base], b[a.vs],
          b["vs_minus_base"][0], b["vs_minus_base"][1], b["vs_minus_base"][2], b["vs_minus_actual"][0], b["vs_minus_actual"][1], b["vs_minus_actual"][2]))
for lab, g in OUT["kd_oe"].items():
    print("\nKD observed / simulated by %s:" % lab)
    for k, v in g.items():
        o0, o1 = v["oe_" + a.base], v["oe_" + a.vs]
        print("  %-6s n %5d KD %5.0f  O/E %s %.2f [%.2f,%.2f]  %s %.2f [%.2f,%.2f]" % (k, v["n"], v["kd"], a.base, o0[0], o0[1], o0[2], a.vs, o1[0], o1[1], o1[2]))
if a.json:
    json.dump(OUT, open(a.json, "w"), indent=1)
