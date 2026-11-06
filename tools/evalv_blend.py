#!/usr/bin/env python3
"""evalv_blend.py: the STANDARD EVALUATION's blend test (tools/evalv.js calls it on a version's validation run).

Refits the MoE stacker (tools/moe.py: the page expert set, its Stacker class, the linear family the MoE fit chose per
regime, with the same expert-dropout patterns) with an engine version's probabilities in place of the stored engine
expert, and reports
  - the validated engine weight: the weight the stacker fit on 2019-2023 gives the engine, per availability pattern
    (with the closing line; without it), and
  - the blend's validation log loss with vs without the engine (same stacker family, the engine dropped), with a paired
    event-cluster bootstrap CI (moe.boot_ci), on 2024-01-01..2025-12-31 decisive fights.
The other experts are moe.py's cached predictions (out/moe_cache/experts.pkl, static for 2024-2025: trained through
2023) plus market.json, exactly as `moe.py fit` builds them. Calibration is left out on both sides of the comparison
(the MoE's temperature step is fit on CV years; both arms would get the same treatment).

    python3 tools/evalv_blend.py --engine-bt out/evalv/v4_engine_bt.json --out data/derived/evalv/v4_blend.json
    python3 tools/evalv_blend.py --engine-bt <file> --dry      # train-only plumbing check: fit 2019-2022, score 2023

Input engine file: {"meta": {...}, "fights": {id: {"pA": P(A wins | decisive)}}} with A/B as in backtest_dev.json.
"""
import argparse
import importlib.util
import json
import os
import pickle
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
spec = importlib.util.spec_from_file_location("moe", os.path.join(HERE, "moe.py"))
moe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(moe)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--engine-bt", required=True)
    ap.add_argument("--out", default=None)
    ap.add_argument("--dry", action="store_true", help="fit on 2019-2022 and score 2023 (never reads a 2024+ outcome)")
    ap.add_argument("--boot", type=int, default=2000)
    args = ap.parse_args()

    with open(os.path.join(moe.CACHE, "experts.pkl"), "rb") as fh:
        E = pickle.load(fh)
    bt = moe.load_json("backtest_dev.json")
    btmap = {f["id"]: f for f in bt["fights"] if f["date"] < moe.VAULT_FROM.isoformat()}
    sel = [i for i, fid in enumerate(E["ids"]) if fid in btmap]
    ids = [E["ids"][i] for i in sel]
    y = E["y"][sel]
    dates = np.array([E["dates"][i] for i in sel])
    yr = moe.years_of(dates)
    events = np.array([btmap[i]["event"] + "|" + btmap[i]["date"] for i in ids])
    P = {k: E["pred"][k][sel] for k in E["pred"]}
    Ps = {k: E["pred_static"][k][sel] for k in E["pred_static"]}
    with open(args.engine_bt) as fh:
        eng = json.load(fh)
    pe = np.array([(lambda e: e["pA"] if e and "pA" in e else np.nan)(eng["fights"].get(i)) for i in ids], dtype=float)
    P["engine"] = pe
    mk = moe.load_json("market.json")
    mf = mk["fights"] if mk else {}
    P["market"] = np.array([(mf.get(i) or {}).get("p_power_close") or (mf.get(i) or {}).get("p_novig_close") or np.nan
                            for i in ids], dtype=float)
    ext, ext_s, _ = moe.external_experts(ids)
    P.update(ext)
    Ps.update(ext_s)
    for k in P:
        if k not in Ps:
            Ps[k] = P[k]
    experts = [k for k in ["market", "mkt_rating", "engine", "ml", "feat_lr", "elo_sig", "elo"] if k in P]
    DROPS, REGIMES, _ = moe.make_drops(experts)
    dec = np.isfinite(y)
    if args.dry:
        TR = dec & (yr >= 2019) & (yr <= 2022)
        VA = dec & (yr == 2023)
        PV = P                      # 2023 rows: rolling == static
    else:
        TR = dec & (dates >= moe.TRAIN[0]) & (dates <= moe.TRAIN[1])
        VA = dec & (dates >= moe.VALID[0]) & (dates <= moe.VALID[1])
        PV = Ps                     # static experts for the validation years (trained through 2023)
    cover = {"train": float(np.isfinite(pe[TR]).mean()), "valid": float(np.isfinite(pe[VA]).mean())}

    def LM(PP):
        L = np.column_stack([moe.logit(np.clip(PP[k], moe.PCLIP, 1 - moe.PCLIP)) for k in experts])
        M = np.column_stack([np.isfinite(PP[k]) for k in experts])
        return np.where(M, L, 0.0), M

    L, M = LM(P)
    Lv, _ = LM(PV)
    G = np.zeros((len(L), 1))
    chosen = (moe.load_json("moe.json") or {}).get("report", {}).get("chosen", {})
    hp = {"market": (chosen.get("market") or {}).get("hp", {}), "nomarket": (chosen.get("nomarket") or {}).get("hp", {"h": 1.5})}
    res = {"meta": {"tool": "tools/evalv_blend.py", "engine_bt": os.path.relpath(args.engine_bt, ROOT), "engine_meta": eng.get("meta"),
                    "experts": experts, "dry": args.dry, "train": "2019-2022" if args.dry else "2019-2023",
                    "valid": "2023" if args.dry else "2024-2025", "engine_coverage": cover, "hp": hp,
                    "family": "linear (constrained logit-linear, no intercept), one weight vector per availability pattern"},
           "patterns": {}}
    for reg, h in hp.items():
        st = moe.Stacker("linear", experts, DROPS, h).fit(L[TR], M[TR], G[TR], y[TR], yr[TR])
        base = set() if reg == "market" else {"market"}
        with_e = [e for e in experts if e not in base]
        without_e = [e for e in with_e if e != "engine"]
        out = {}
        for name, keep in (("with_engine", with_e), ("without_engine", without_e)):
            Mk = M & np.array([e in keep for e in experts])[None, :]
            ok = VA & Mk[:, [experts.index(e) for e in keep]].all(1)
            z = st.logit(Lv[ok], Mk[ok], G[ok])
            pat = frozenset(keep)
            w = dict(zip([experts[i] for i in st.lin[pat][0]], [float(v) for v in st.lin[pat][1].w])) if pat in st.lin else None
            out[name] = {"ok": ok, "p": moe.sigm(z), "weights": w}
        both = out["with_engine"]["ok"] & out["without_engine"]["ok"]
        iw = np.where(out["with_engine"]["ok"])[0]
        io = np.where(out["without_engine"]["ok"])[0]
        pw = np.full(len(y), np.nan); pw[iw] = out["with_engine"]["p"]
        po = np.full(len(y), np.nan); po[io] = out["without_engine"]["p"]
        idx = np.where(both)[0]
        yy = y[idx]
        d = moe.boot_ci(pw[idx], yy, events[idx], ref=po[idx], B=args.boot)
        ew = (out["with_engine"]["weights"] or {}).get("engine")
        if ew is None or abs(ew) < 1e-6:
            # engine weight 0: the two arms are the same blend up to the optimizer's tolerance (differences ~1e-6 whose
            # bootstrap CI can exclude 0 and read as 'significant'); report the comparison as exactly level (v4.0.1 fix)
            d = {"est": 0.0, "lo": 0.0, "hi": 0.0, "p_gt0": None, "raw": d,
                 "note": "engine weight 0: with and without are the same blend; raw optimizer-tolerance difference kept under 'raw'"}
        res["patterns"][reg] = {
            "n": int(len(idx)), "experts_with": with_e, "experts_without": without_e,
            "engine_weight": (out["with_engine"]["weights"] or {}).get("engine"),
            "weights_with": out["with_engine"]["weights"], "weights_without": out["without_engine"]["weights"],
            "logloss_with": moe.metrics(pw[idx], yy)["log_loss"], "logloss_without": moe.metrics(po[idx], yy)["log_loss"],
            "diff_with_minus_without": d}
        r = res["patterns"][reg]
        print("%-9s n=%d  engine weight %.3f  log loss with %.4f  without %.4f  diff %+.4f [%+.4f, %+.4f]" % (
            reg, r["n"], r["engine_weight"] or 0.0, r["logloss_with"], r["logloss_without"], d["est"], d["lo"], d["hi"]))
    res["summary"] = {reg: {"engine_weight": v["engine_weight"], "logloss_with": v["logloss_with"],
                            "logloss_without": v["logloss_without"], "diff": v["diff_with_minus_without"], "n": v["n"]}
                      for reg, v in res["patterns"].items()}
    res["summary"]["dry"] = args.dry
    if args.out:
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        with open(args.out, "w") as fh:
            json.dump(res, fh, indent=1)
        print("wrote", args.out)


if __name__ == "__main__":
    main()
