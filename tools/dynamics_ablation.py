#!/usr/bin/env python3
"""dynamics_ablation.py: score a tools/dynamics_bt.js run (flag on vs flag off) on 2019-2023 backtest fights.

Metrics (every one symmetric: the runner averages both corner orders; no intercepts, nothing fit here):
  winner      log loss of P(winner) on fights with a winner (draws, NC, CNC dropped; p = pA / (pA + pB))
  soft_close  cross-entropy of p against the closing line's no-vig power probability (data/derived/market.json
              p_power_close), every train fight with a close; 3-4.6x less noisy than the outcome (research/model_market.md)
  bin7        7-outcome log loss: A KO/TKO, A SUB, A DEC, draw, B DEC, B SUB, B KO/TKO (doctor stoppages are KO/TKO)
  method      3-way log loss: KO/TKO, SUB, decision (incl. draw)
  method_rd   (2R + 1)-way log loss: KO/TKO in round r, SUB in round r, decision
  statline    Poisson deviance of each real fighter's fight totals (sig attempts / landed, head / body / leg landed,
              knockdowns, takedown attempts / landed, submission attempts; control minutes as quasi-Poisson) against
              exposure-matched predictions: sum over the rounds the real fight lasted of the simulated per-second rate in
              that round (among simulations that reached it) x the real seconds
  base rates  simulated vs real: outcome mix, KO/TKO and SUB hazard by format and round, minutes, stats per 15 min
CIs: paired bootstrap over events (cluster = UFC event), 2,000 resamples, percentile 95%.

Usage: python3 tools/dynamics_ablation.py <run.json> [--out report.json] [--on on --off off] [--boot 2000]
Refuses any fight dated 2024-01-01 or later (hidden-data protocol) unless DYN_ALLOW_VALIDATION=1.
"""
import argparse
import json
import math
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def data_file(rel):
    p = os.path.join(ROOT, rel)
    return p if os.path.exists(p) else os.path.join("/home/user/XX", rel)


KO_M = {"KO", "TKO", "DOC", "CORNER"}
DEC_M = {"UD", "SD", "MD"}
STATS = ["sig_att", "sig_lnd", "h_lnd", "b_lnd", "l_lnd", "kd", "td_att", "td_lnd", "sub_att"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("run")
    ap.add_argument("--out", default=None)
    ap.add_argument("--on", default="on")
    ap.add_argument("--off", default="off")
    ap.add_argument("--boot", type=int, default=2000)
    ap.add_argument("--seed", type=int, default=20261106)
    a = ap.parse_args()

    R = json.load(open(a.run))
    bt = json.load(open(data_file("data/derived/backtest_dev.json")))
    mk = json.load(open(data_file("data/derived/market.json")))["fights"]
    btf = {f["id"]: f for f in bt["fights"]}
    cols = R["meta"]["rt_columns"]
    ci = {c: i for i, c in enumerate(cols)}
    cfgs = [a.off, a.on]

    rows = []
    for fid, rec in R["fights"].items():
        f = btf[fid]
        if f["date"] >= "2024-01-01" and os.environ.get("DYN_ALLOW_VALIDATION") != "1":
            sys.exit("refusing: validation-period fight in the run (hidden-data protocol)")
        if any(c not in rec or rec[c].get("err") for c in cfgs):
            continue
        rows.append((fid, f, rec))
    n = len(rows)
    events = sorted({f["event"] for _, f, _ in rows})
    eidx = {e: i for i, e in enumerate(events)}
    ev = np.array([eidx[f["event"]] for _, f, _ in rows])
    print(f"{n} fights, {len(events)} events, configs {cfgs}, sims/orientation {R['meta']['sims_per_orientation']}")

    # ------------------------------------------------------------ per-fight metric columns (NaN = not applicable)
    M = {}   # name -> {cfg: array}
    def put(name, cfg, i, v):
        M.setdefault(name, {c: np.full(n, np.nan) for c in cfgs})[cfg][i] = v

    Nsim = {c: None for c in cfgs}
    real = {k: np.full(n, np.nan) for k in ["ko", "sub", "dec", "mins", "five"]}
    for i, (fid, f, rec) in enumerate(rows):
        res = f["result"]; mth = res["method"]; win = res["winner"]; nR = rec["rounds"]
        valid7 = mth in KO_M or mth == "SUB" or mth in DEC_M or mth == "DRAW"
        real["five"][i] = 1.0 if nR == 5 else 0.0
        if valid7:
            real["ko"][i] = 1.0 if mth in KO_M else 0.0
            real["sub"][i] = 1.0 if mth == "SUB" else 0.0
            real["dec"][i] = 1.0 if (mth in DEC_M or mth == "DRAW") else 0.0
            real["mins"][i] = res["fight_s"] / 60.0 if res.get("fight_s") else np.nan
        q = (mk.get(fid) or {}).get("p_power_close")
        for c in cfgs:
            x = rec[c]; N = x["n"]
            pA, pB = x["pA"], x["pB"]
            # winner probability with a half-count floor (finite log loss for 0 / N)
            p = (pA * N + 0.5) / ((pA + pB) * N + 1.0)
            if win in ("A", "B") and mth not in ("NC", "CNC"):
                put("winner", c, i, -math.log(p if win == "A" else 1 - p))
            if q is not None and mth not in ("NC", "CNC"):
                put("soft_close", c, i, -(q * math.log(p) + (1 - q) * math.log(1 - p)))
            fl = 0.5 / N
            bins = np.array(x["bins"]) + fl; bins /= bins.sum()
            if valid7:
                if mth == "DRAW":
                    b = 3
                else:
                    k = 0 if mth in KO_M else (1 if mth == "SUB" else 2)
                    b = k if win == "A" else 6 - k
                put("bin7", c, i, -math.log(bins[b]))
                pm = np.array([bins[0] + bins[6], bins[1] + bins[5], bins[2] + bins[3] + bins[4]])
                put("method", c, i, -math.log(pm[0 if mth in KO_M else (1 if mth == "SUB" else 2)]))
                vec = np.array(x["ko"] + x["sub"] + [x["dec"]]) + fl; vec /= vec.sum()
                rr = int(res["round"]) - 1
                kk = rr if mth in KO_M else (nR + rr if mth == "SUB" else 2 * nR)
                if mth in KO_M or mth == "SUB":
                    kk = min(kk, (nR + nR - 1) if mth == "SUB" else nR - 1)
                put("method_rd", c, i, -math.log(vec[kk]))
            # exposure-matched stat lines
            act = f.get("actual")
            if act and res.get("round") and res.get("time_s") is not None and mth not in ("NC", "CNC"):
                rend = int(res["round"]); tend = float(res["time_s"])
                dev = {st: 0.0 for st in STATS + ["ctrl"]}
                for side, sk in ((0, "A"), (1, "B")):
                    rt = x["rt"][side]
                    for st in STATS + ["ctrl"]:
                        mu, lastrate = 0.0, None
                        for r in range(min(rend, nR)):
                            row = rt[r]
                            if row[ci["secs"]] > 0:
                                lastrate = row[ci[st]] / row[ci["secs"]]
                            if lastrate is not None:
                                mu += lastrate * (300.0 if r < rend - 1 else tend)
                        y = float(act[sk].get(st, 0) or 0)
                        if st == "ctrl":
                            y /= 60.0; mu /= 60.0
                        mu = max(mu, 1e-6)
                        dev[st] += 2 * ((y * math.log(y / mu) if y > 0 else 0.0) - (y - mu))
                for st, d in dev.items():
                    put("dev_" + st, c, i, d)
                put("statline", c, i, sum(d for st, d in dev.items() if st != "ctrl"))
    # ------------------------------------------------------------ paired event-cluster bootstrap
    rng = np.random.default_rng(a.seed)
    E = len(events)
    W = rng.multinomial(E, np.ones(E) / E, size=a.boot).astype(float)   # B x E resample counts

    def ev_sum(v):
        s = np.zeros(E); np.add.at(s, ev, np.nan_to_num(v)); return s

    def ev_cnt(v):
        s = np.zeros(E); np.add.at(s, ev, (~np.isnan(v)).astype(float)); return s

    out = {"meta": {"run": os.path.basename(a.run), "n_fights": n, "n_events": E, "boot": a.boot, "configs": cfgs,
                    "sims_per_orientation": R["meta"]["sims_per_orientation"], "run_meta": R["meta"]}, "metrics": {}, "base_rates": {}}
    print("\n=== flag-on vs flag-off (mean per fight; diff = on - off; paired event-cluster bootstrap 95% CI) ===")
    order = ["winner", "soft_close", "bin7", "method", "method_rd", "statline"] + ["dev_" + s for s in STATS + ["ctrl"]]
    for name in order:
        if name not in M:
            continue
        v0, v1 = M[name][a.off], M[name][a.on]
        ok = ~np.isnan(v0) & ~np.isnan(v1)
        v0 = np.where(ok, v0, np.nan); v1 = np.where(ok, v1, np.nan)
        c = ev_cnt(v0); s0 = ev_sum(v0); s1 = ev_sum(v1)
        m0, m1 = s0.sum() / c.sum(), s1.sum() / c.sum()
        bc = W @ c; b0 = (W @ s0) / bc; b1 = (W @ s1) / bc
        d = b1 - b0
        lo, hi = np.percentile(d, [2.5, 97.5])
        out["metrics"][name] = {"n": int(c.sum()), "off": m0, "on": m1, "diff": m1 - m0, "ci95": [float(lo), float(hi)],
                                "ci95_off": [float(x) for x in np.percentile(b0, [2.5, 97.5])],
                                "ci95_on": [float(x) for x in np.percentile(b1, [2.5, 97.5])]}
        print(f"{name:14s} n={int(c.sum()):5d}  off {m0:.5f}  on {m1:.5f}  diff {m1 - m0:+.5f} [{lo:+.5f}, {hi:+.5f}]")

    # ------------------------------------------------------------ base-rate table
    print("\n=== base rates: simulated vs real (2019-2023 backtest fights) ===")
    valid = ~np.isnan(real["ko"])
    fmt = {3: valid & (real["five"] == 0), 5: valid & (real["five"] == 1)}

    def sim_col(cfg, fn):
        return np.array([fn(rec[cfg], rec["rounds"]) for _, _, rec in rows], dtype=float)

    def ratio_ci(num_by_cfg, den_by_cfg, real_num, real_den, label):
        """mean ratio sum(num)/sum(den) per config and for the real fights; CIs for sim - real and on - off."""
        res = {}
        rs_n = ev_sum(real_num); rs_d = ev_sum(real_den)
        rb = (W @ rs_n) / np.maximum(W @ rs_d, 1e-12)
        res["real"] = float(rs_n.sum() / max(rs_d.sum(), 1e-12))
        bb = {}
        for c in cfgs:
            sn = ev_sum(num_by_cfg[c]); sd = ev_sum(den_by_cfg[c])
            res[c] = float(sn.sum() / max(sd.sum(), 1e-12))
            bb[c] = (W @ sn) / np.maximum(W @ sd, 1e-12)
            res[c + "_minus_real_ci95"] = [float(x) for x in np.percentile(bb[c] - rb, [2.5, 97.5])]
        res["on_minus_off_ci95"] = [float(x) for x in np.percentile(bb[a.on] - bb[a.off], [2.5, 97.5])]
        out["base_rates"][label] = res
        print(f"{label:28s} real {res['real']:.4f}  off {res[a.off]:.4f} {fmtci(res[a.off + '_minus_real_ci95'])}  "
              f"on {res[a.on]:.4f} {fmtci(res[a.on + '_minus_real_ci95'])}  on-off {fmtci(res['on_minus_off_ci95'])}")

    def fmtci(c):
        return f"[{c[0]:+.4f},{c[1]:+.4f}]"

    one = valid.astype(float)
    for lab, key, fn in (("P(KO/TKO)", "ko", lambda x, nR: sum(x["ko"])), ("P(SUB)", "sub", lambda x, nR: sum(x["sub"])),
                         ("P(decision)", "dec", lambda x, nR: x["dec"])):
        num = {c: np.where(valid, sim_col(c, fn), np.nan) for c in cfgs}
        den = {c: np.where(valid, 1.0, np.nan) for c in cfgs}
        ratio_ci(num, den, np.where(valid, real[key], np.nan), np.where(valid, one, np.nan), lab)
    # hazards by format and round: P(round ends KO/TKO | round reached), same for SUB
    for R_ in (3, 5):
        sel = fmt[R_]
        for r in range(R_):
            for kind in ("ko", "sub"):
                def reach(x, nR, r=r):
                    return 1.0 - sum(x["ko"][:r]) - sum(x["sub"][:r])
                num = {c: np.where(sel, sim_col(c, lambda x, nR, r=r, kind=kind: x[kind][r] if r < nR else 0.0), np.nan) for c in cfgs}
                den = {c: np.where(sel, sim_col(c, reach), np.nan) for c in cfgs}
                rnum = np.full(n, np.nan); rden = np.full(n, np.nan)
                for i, (_, f, rec) in enumerate(rows):
                    if not sel[i]:
                        continue
                    res_ = f["result"]; rr = int(res_["round"]) - 1; mth = res_["method"]
                    rden[i] = 1.0 if rr >= r else 0.0
                    hit = (mth in KO_M) if kind == "ko" else (mth == "SUB")
                    rnum[i] = 1.0 if (rr == r and hit) else 0.0
                ratio_ci(num, den, rnum, rden, f"{R_}rd R{r + 1} {kind.upper()} hazard")
    # minutes and per-15 stats
    num = {c: np.where(valid, sim_col(c, lambda x, nR: x["mins"]), np.nan) for c in cfgs}
    den = {c: np.where(valid, 1.0, np.nan) for c in cfgs}
    ratio_ci(num, den, real["mins"], np.where(np.isnan(real["mins"]), np.nan, 1.0), "minutes per fight")
    for st in ["sig_lnd", "sig_att", "kd", "td_lnd", "ctrl", "sub_att"]:
        def simst(x, nR, st=st):
            return sum(x["rt"][s][r][ci[st]] for s in (0, 1) for r in range(nR)) / x["n"]
        def simsec(x, nR):
            return sum(x["rt"][0][r][ci["secs"]] for r in range(nR)) / x["n"] / 60.0
        num = {c: np.where(valid, sim_col(c, simst) * 15, np.nan) for c in cfgs}
        den = {c: np.where(valid, sim_col(c, simsec), np.nan) for c in cfgs}
        rn = np.full(n, np.nan); rd = np.full(n, np.nan)
        for i, (_, f, rec) in enumerate(rows):
            act = f.get("actual")
            if valid[i] and act and act.get("minutes"):
                rn[i] = 15 * (float(act["A"].get(st, 0) or 0) + float(act["B"].get(st, 0) or 0))
                rd[i] = float(act["minutes"])
        ratio_ci(num, den, rn, rd, f"{st} per 15 (both)")
    # knockdown conversion and non-KD stoppage rates (simulated only; targets from data/derived/dynamics.json)
    dj = json.load(open(os.path.join(ROOT, "data", "derived", "dynamics.json")))
    for c in cfgs:
        kd = sum(sum(rec[c]["kd"]) for _, _, rec in rows); conv = sum(sum(rec[c]["kdConv"]) for _, _, rec in rows)
        st = sum(rec[c]["stko"] for _, _, rec in rows); gt = sum(rec[c]["gtko"] for _, _, rec in rows)
        es = sum(rec[c]["expSh"] for _, _, rec in rows); eg = sum(rec[c]["expG"] for _, _, rec in rows)
        out["base_rates"]["sim_" + c + "_kd_conversion"] = conv / max(kd, 1)
        out["base_rates"]["sim_" + c + "_stko_per_sh"] = st / max(es, 1)
        out["base_rates"]["sim_" + c + "_gtko_per_g"] = gt / max(eg, 1)
        print(f"sim {c}: KD->finish per KD {conv / max(kd, 1):.3f} (train data {dj['finish_hazard']['kd_conversion']['null']['rate_train']:.3f}); "
              f"standing TKO no-KD per sh {st / max(es, 1):.6f} (data {dj['finish_hazard']['non_kd_stoppage']['rate_per_standing_head_st_train']:.6f}); "
              f"ground TKO no-KD per g {gt / max(eg, 1):.5f} (data {dj['finish_hazard']['non_kd_stoppage']['rate_per_ground_strike_gt_train']:.5f})")
    if a.out:
        json.dump(out, open(a.out, "w"), indent=1)
        print("wrote", a.out)


if __name__ == "__main__":
    main()
