"""Score the styles_sos train-only ablation (tools/styles_sos_ablate.js output) on 2019-2023 backtest_dev fights.

    python3 tools/styles_sos_score.py <out.json> <ablation_part.json> [<ablation_part.json> ...] [--base off]

Metrics per configuration, each as the paired difference against the base configuration (default "off") with a 95%
event-cluster bootstrap CI (2000 replicates; every fight of a resampled UFC card enters with the card's weight, all
configurations on the same replicate):
  winner log loss      decisive fights; p = pA / (pA + pB) from the symmetrised (both corner orders) simulation
  soft CE vs close     cross-entropy against the closing line's no-vig power probability (data/derived/market.json
                       p_power_close), every fight with a close: -[q log p + (1 - q) log(1 - p)]
  7-bin log loss       A KO/TKO, A sub, A dec, draw, B dec, B sub, B KO/TKO (KO/TKO includes doctor and corner stoppages)
  method log loss      KO/TKO, submission, decision or draw (winner-agnostic)
  stat-line deviance   per fight side, Poisson deviance of the actual count against the simulated rate per minute times
                       the actual minutes (control: quasi-Poisson on seconds), per stat and summed as relative change
  base-rate table      league rates of the simulated fights vs actual (method split, finish rate by round, per-15 rates,
                       accuracies, decision split), with the bootstrap CI of each change
Probabilities are smoothed with half a simulated fight per class so a zero-count outcome stays finite. Only fights dated
before 2024-01-01 are accepted.
"""
import json
import math
import os
import sys
from collections import defaultdict

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def dev_path(name):
    p = os.path.join(ROOT, "data", "derived", name)
    return p if os.path.exists(p) else os.path.join("/home/user/XX/data/derived", name)


STATS = ["sig_att", "sig_lnd", "h_lnd", "b_lnd", "l_lnd", "kd", "td_att", "td_lnd", "ctrl", "sub_att"]


def actual_bin(res):
    w, m = res["winner"], res["method"]
    if w == "D" or m == "DRAW":
        return 3
    if w not in ("A", "B"):
        return None
    k = {"KO": 0, "DOC": 0, "SUB": 1, "UD": 2, "SD": 2, "MD": 2}.get(m)
    if k is None:
        return None
    return k if w == "A" else 6 - k


def main():
    args = [a for a in sys.argv[1:]]
    base_cfg = "off"
    if "--base" in args:
        i = args.index("--base")
        base_cfg = args[i + 1]
        del args[i:i + 2]
    only = None
    if "--configs" in args:          # score only these configurations (the base one is always kept)
        i = args.index("--configs")
        only = args[i + 1].split(",")
        del args[i:i + 2]
    out_path, parts = args[0], args[1:]
    rows, meta, configs = {}, None, []
    for p in parts:          # parts of one run, or several runs (same seeds and sims) with different configurations
        d = json.load(open(p))
        if meta is not None and d["meta"]["sims_per_orientation"] != meta["sims_per_orientation"]:
            raise SystemExit("runs with different sims per orientation cannot be paired")
        meta = dict(d["meta"])
        for c in d["meta"]["configs"]:
            if c not in configs:
                configs.append(c)
        for fid, r in d["rows"].items():
            rows.setdefault(fid, {}).update(r)
    if only:
        configs = [c for c in configs if c == base_cfg or c in only]
    meta["configs"] = configs
    rows = {fid: r for fid, r in rows.items() if all(c in r for c in configs)}
    sims_total = 2 * meta["sims_per_orientation"]
    bt = json.load(open(dev_path("backtest_dev.json")))
    mk = json.load(open(dev_path("market.json")))["fights"]
    F = [f for f in bt["fights"] if f["id"] in rows]
    assert all(f["date"] < "2024-01-01" for f in F), "2024+ fight in the ablation"
    n = len(F)
    events = sorted({f["event"] for f in F})
    eidx = {e: i for i, e in enumerate(events)}
    ev = np.array([eidx[f["event"]] for f in F])
    N = sims_total

    def sm(p, k):          # smoothing: half a simulated fight per class
        return (np.asarray(p) * N + 0.5) / (N + 0.5 * k)

    per = {c: {} for c in configs}
    dec_mask = np.array([f["result"]["winner"] in ("A", "B") for f in F])
    yA = np.array([1.0 if f["result"]["winner"] == "A" else 0.0 for f in F])
    q = np.array([mk.get(f["id"], {}).get("p_power_close", np.nan) if mk.get(f["id"]) else np.nan for f in F], dtype=float)
    has_q = ~np.isnan(q)
    bins_true = [actual_bin(f["result"]) for f in F]
    has_bin = np.array([b is not None for b in bins_true])
    btrue = np.array([b if b is not None else 0 for b in bins_true])
    mtrue = np.array([{0: 0, 6: 0, 1: 1, 5: 1, 2: 2, 3: 2, 4: 2}[b] for b in btrue])
    has_act = np.array([bool(f.get("actual")) and (f["actual"] or {}).get("minutes", 0) > 0 for f in F])
    for c in configs:
        pA = np.array([rows[f["id"]][c]["pA"] for f in F])
        pB = np.array([rows[f["id"]][c]["pB"] for f in F])
        bins = np.array([rows[f["id"]][c]["bins"] for f in F])
        pw = (pA * N + 0.5) / ((pA + pB) * N + 1.0)
        per[c]["winner"] = -(yA * np.log(pw) + (1 - yA) * np.log(1 - pw))
        qq = np.where(has_q, q, 0.5)
        per[c]["soft"] = -(qq * np.log(pw) + (1 - qq) * np.log(1 - pw))
        pb = sm(bins, 7)
        per[c]["bin7"] = -np.log(pb[np.arange(n), btrue])
        meth = np.column_stack([bins[:, 0] + bins[:, 6], bins[:, 1] + bins[:, 5], bins[:, 2] + bins[:, 3] + bins[:, 4]])
        pm = sm(meth, 3)
        per[c]["method"] = -np.log(pm[np.arange(n), mtrue])
        per[c]["pwin"] = pw
        # stat-line deviance per side and stat
        for st in STATS:
            dv = np.zeros(n)
            for i, f in enumerate(F):
                if not has_act[i]:
                    continue
                a = f["actual"]
                mins = a["minutes"]
                for side, rk in (("A", "rA"), ("B", "rB")):
                    y = float(a[side][st])
                    mu = max(rows[f["id"]][c][rk][st] * mins, 1e-9)
                    dv[i] += 2 * ((y * math.log(y / mu) if y > 0 else 0.0) - (y - mu))
            per[c]["dev_" + st] = dv
    masks = {"winner": dec_mask, "soft": has_q, "bin7": has_bin, "method": has_bin}
    for st in STATS:
        masks["dev_" + st] = has_act
    rng = np.random.default_rng(20261106)
    B = 2000
    W = np.zeros((B, n))
    ne = len(events)
    for b in range(B):
        cnt = np.bincount(rng.integers(0, ne, ne), minlength=ne)
        W[b] = cnt[ev]

    def mean_ci(metric, c):
        mk_ = masks[metric]
        x = per[c][metric] * mk_
        x0 = per[base_cfg][metric] * mk_
        w = W * mk_[None, :]
        est = x[mk_].mean()
        d = (x - x0)[mk_].mean()
        dd = (w @ (x - x0)) / w.sum(1)
        return float(est), float(d), [float(np.percentile(dd, 2.5)), float(np.percentile(dd, 97.5))], int(mk_.sum())

    def sum_ci(metric, c):
        mk_ = masks[metric]
        x = per[c][metric] * mk_
        x0 = per[base_cfg][metric] * mk_
        tot = float(x.sum())
        d = float((x - x0).sum())
        dd = W @ (x - x0)
        return tot, d, [float(np.percentile(dd, 2.5)), float(np.percentile(dd, 97.5))], d / float(x0.sum())

    res = {"meta": dict(meta, n_fights=n, n_events=ne, base=base_cfg, bootstrap=B, sims_per_fight=N,
                        n_decisive=int(dec_mask.sum()), n_close=int(has_q.sum()), n_bin=int(has_bin.sum())),
           "metrics": {}, "statline": {}, "baserates": {}}
    def calib_slope(pw):
        """no-intercept logistic slope of the outcome on logit(p) over decisive fights (symmetric: p is symmetrised)"""
        x = np.log(pw[dec_mask] / (1 - pw[dec_mask]))
        y = yA[dec_mask]
        b = 1.0
        for _ in range(50):
            pr = 1 / (1 + np.exp(-b * x))
            g = np.sum((y - pr) * x)
            h = np.sum(pr * (1 - pr) * x * x)
            b += g / h
        return float(b)

    for c in configs:
        res["metrics"][c] = {m: dict(zip(("value", "diff", "ci", "n"), mean_ci(m, c)))
                             for m in ("winner", "soft", "bin7", "method")}
        pw = per[c]["pwin"]
        res["metrics"][c]["calibration"] = {"slope": calib_slope(pw),
                                            "mean_abs_logit": float(np.mean(np.abs(np.log(pw / (1 - pw))))),
                                            "accuracy": float(np.mean((pw[dec_mask] > 0.5) == (yA[dec_mask] == 1)))}
        res["statline"][c] = {}
        rel = np.zeros(B)
        relpt = 0.0
        for st in STATS:
            tot, d, ci, r = sum_ci("dev_" + st, c)
            res["statline"][c][st] = {"deviance": tot, "diff": d, "ci": ci, "rel": r}
            x0 = per[base_cfg]["dev_" + st] * has_act
            relpt += d / x0.sum() / len(STATS)
            rel += (W @ ((per[c]["dev_" + st] - per[base_cfg]["dev_" + st]) * has_act)) / (W @ x0) / len(STATS)
        res["statline"][c]["mean_rel_change"] = {"value": float(relpt), "ci": [float(np.percentile(rel, 2.5)), float(np.percentile(rel, 97.5))]}
    # base-rate table
    def rates_for(c, w=None):
        w = np.ones(n) if w is None else w
        o = {}
        bins = np.array([rows[f["id"]][c]["bins"] for f in F])
        o["KO/TKO share"] = float((w * (bins[:, 0] + bins[:, 6])).sum() / w.sum())
        o["SUB share"] = float((w * (bins[:, 1] + bins[:, 5])).sum() / w.sum())
        o["DEC share"] = float((w * (bins[:, 2] + bins[:, 4])).sum() / w.sum())
        o["draw share"] = float((w * bins[:, 3]).sum() / w.sum())
        for R in (3, 5):
            sel = np.array([f["rounds"] == R for f in F])
            ws = w * sel
            for r in range(R):
                v = np.array([(rows[f["id"]][c]["finA"][r] + rows[f["id"]][c]["finB"][r]) if f["rounds"] == R else 0.0 for f in F])
                o["finish R%d (%d-rd)" % (r + 1, R)] = float((ws * v).sum() / max(ws.sum(), 1e-9))
        mins = np.array([rows[f["id"]][c]["avgMin"] for f in F])
        for st in ["sig_att", "sig_lnd", "d_att", "kd", "td_att", "td_lnd", "ctrl", "sub_att"]:
            v = np.array([rows[f["id"]][c]["rA"][st] + rows[f["id"]][c]["rB"][st] for f in F]) * mins
            o[st + " per 15 (per fighter)"] = float((w * v).sum() / (w * mins).sum() * 15 / 2)
        sa = np.array([(rows[f["id"]][c]["rA"]["sig_att"] + rows[f["id"]][c]["rB"]["sig_att"]) for f in F]) * mins
        sl = np.array([(rows[f["id"]][c]["rA"]["sig_lnd"] + rows[f["id"]][c]["rB"]["sig_lnd"]) for f in F]) * mins
        o["sig accuracy"] = float((w * sl).sum() / (w * sa).sum())
        ta = np.array([(rows[f["id"]][c]["rA"]["td_att"] + rows[f["id"]][c]["rB"]["td_att"]) for f in F]) * mins
        tl = np.array([(rows[f["id"]][c]["rA"]["td_lnd"] + rows[f["id"]][c]["rB"]["td_lnd"]) for f in F]) * mins
        o["TD accuracy"] = float((w * tl).sum() / (w * ta).sum())
        dist = np.array([rows[f["id"]][c]["dist"] for f in F])
        for k in ("UD", "SD", "MD"):
            v = np.array([rows[f["id"]][c]["dec"][k] for f in F]) * dist
            o["decisions: " + k] = float((w * v).sum() / (w * dist).sum())
        return o

    def actual_rates(w=None):
        w = np.ones(n) if w is None else w
        o = {}
        kb = has_bin * w
        o["KO/TKO share"] = float((kb * np.isin(btrue, [0, 6])).sum() / kb.sum())
        o["SUB share"] = float((kb * np.isin(btrue, [1, 5])).sum() / kb.sum())
        o["DEC share"] = float((kb * np.isin(btrue, [2, 4])).sum() / kb.sum())
        o["draw share"] = float((kb * (btrue == 3)).sum() / kb.sum())
        for R in (3, 5):
            sel = np.array([f["rounds"] == R for f in F]) * kb
            for r in range(R):
                v = np.array([1.0 if (f["result"]["round"] == r + 1 and btrue[i] not in (2, 3, 4)) else 0.0 for i, f in enumerate(F)])
                o["finish R%d (%d-rd)" % (r + 1, R)] = float((sel * v).sum() / max(sel.sum(), 1e-9))
        aw = has_act * w
        mins = np.array([(f["actual"] or {}).get("minutes", 0) if has_act[i] else 0 for i, f in enumerate(F)])
        for st in ["sig_att", "sig_lnd", "kd", "td_att", "td_lnd", "ctrl", "sub_att"]:
            v = np.array([(f["actual"]["A"][st] + f["actual"]["B"][st]) if has_act[i] else 0 for i, f in enumerate(F)])
            o[st + " per 15 (per fighter)"] = float((aw * v).sum() / (aw * mins).sum() * 15 / 2)
        o["d_att per 15 (per fighter)"] = None
        sa = np.array([(f["actual"]["A"]["sig_att"] + f["actual"]["B"]["sig_att"]) if has_act[i] else 0 for i, f in enumerate(F)])
        sl = np.array([(f["actual"]["A"]["sig_lnd"] + f["actual"]["B"]["sig_lnd"]) if has_act[i] else 0 for i, f in enumerate(F)])
        o["sig accuracy"] = float((aw * sl).sum() / (aw * sa).sum())
        ta = np.array([(f["actual"]["A"]["td_att"] + f["actual"]["B"]["td_att"]) if has_act[i] else 0 for i, f in enumerate(F)])
        tl = np.array([(f["actual"]["A"]["td_lnd"] + f["actual"]["B"]["td_lnd"]) if has_act[i] else 0 for i, f in enumerate(F)])
        o["TD accuracy"] = float((aw * tl).sum() / (aw * ta).sum())
        meths = [f["result"]["method"] for f in F]
        dm = np.array([m in ("UD", "SD", "MD") for m in meths]) * w
        for k in ("UD", "SD", "MD"):
            o["decisions: " + k] = float((dm * np.array([m == k for m in meths])).sum() / dm.sum())
        return o

    act = actual_rates()
    pts = {c: rates_for(c) for c in configs}
    # bootstrap the base-rate changes (200 replicates: the table is descriptive)
    boot = {c: defaultdict(list) for c in configs}
    for b in range(200):
        w = W[b]
        r0 = rates_for(base_cfg, w)
        for c in configs:
            if c == base_cfg:
                continue
            r1 = rates_for(c, w)
            for k in r1:
                boot[c][k].append(r1[k] - r0[k])
    for k in act:
        res["baserates"][k] = {"actual": act[k]}
        for c in configs:
            ent = {"sim": pts[c][k]}
            if c != base_cfg and boot[c][k]:
                ent["diff"] = pts[c][k] - pts[base_cfg][k]
                ent["ci"] = [float(np.percentile(boot[c][k], 2.5)), float(np.percentile(boot[c][k], 97.5))]
            res["baserates"][k][c] = ent
    with open(out_path, "w") as fh:
        json.dump(res, fh, indent=1)
    # console summary
    print("fights %d (decisive %d, with close %d), events %d, sims/fight %d, base %s" %
          (n, dec_mask.sum(), has_q.sum(), ne, N, base_cfg))
    for c in configs:
        m = res["metrics"][c]
        print("%-11s winner %.4f (%+.4f [%+.4f, %+.4f])  soft %.4f (%+.4f [%+.4f, %+.4f])  7bin %.4f (%+.4f [%+.4f, %+.4f])  method %.4f (%+.4f [%+.4f, %+.4f])  statline rel %+.4f [%+.4f, %+.4f]"
              % (c, m["winner"]["value"], m["winner"]["diff"], *m["winner"]["ci"], m["soft"]["value"], m["soft"]["diff"], *m["soft"]["ci"],
                 m["bin7"]["value"], m["bin7"]["diff"], *m["bin7"]["ci"], m["method"]["value"], m["method"]["diff"], *m["method"]["ci"],
                 res["statline"][c]["mean_rel_change"]["value"], *res["statline"][c]["mean_rel_change"]["ci"]))
        cal = res["metrics"][c]["calibration"]
        print("            calibration slope %.3f, mean |logit p| %.3f, accuracy %.4f" % (cal["slope"], cal["mean_abs_logit"], cal["accuracy"]))


if __name__ == "__main__":
    main()
