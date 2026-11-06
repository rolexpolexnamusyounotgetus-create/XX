#!/usr/bin/env python3
"""Adversarial verification of seqnet (tools/seqnet.py, research/model_seqnet.md). Own code throughout: own log loss,
own event-cluster bootstrap (different seed), own mirrored no-intercept stacker, own outcome parsing from the raw
ufcstats CSVs. It reads the builder's caches (out/seqnet_cache/data.pkl, walk.pkl, hpcv.json) and published files
(data/derived/seqnet.json, out/ml2_cache/stack.pkl, data/derived/methodround.json) only as inputs to re-derive.

    nice -n 5 python3 tools/seqnet_verify.py protocol   # 2026 scan, history strictly before the fight, labels vs raw
                                                         # CSV, walk training windows, ensemble vs seqnet.json, HP choice
    nice -n 5 python3 tools/seqnet_verify.py score      # own winner scores + paired CIs, free-intercept check,
                                                         # missingness subsets, 7-bin vs methodround S, seed curve
    nice -n 5 python3 tools/seqnet_verify.py gate       # own stack gate (forward-chained 2021-2023, 0.0005 rule) and
                                                         # looser stackers (signed weights, free intercept)
    nice -n 5 python3 tools/seqnet_verify.py repro      # retrain one walk refit (2023, seed 101) and compare logits
    nice -n 5 python3 tools/seqnet_verify.py all

Writes data/derived/seqnet_verify.json (one block per stage). Never reads a fight dated 2026-01-01 or later.
"""
import json
import os
import pickle
import subprocess
import sys
import datetime as dt

import numpy as np
import pandas as pd
from scipy.optimize import minimize

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "out", "seqnet_cache")
OUT = os.path.join(ROOT, "data", "derived", "seqnet_verify.json")
VAULT = "2026-01-01"
SEL = 0.0005


def save(stage, obj):
    R = json.load(open(OUT)) if os.path.exists(OUT) else {}
    R[stage] = obj
    R["_meta"] = {"tool": "tools/seqnet_verify.py", "updated": dt.datetime.utcnow().isoformat() + "Z"}
    json.dump(R, open(OUT, "w"), indent=1, default=float)


def sg(z):
    return 1 / (1 + np.exp(-z))


def lg(p, c=1e-6):
    p = np.clip(np.asarray(p, float), c, 1 - c)
    return np.log(p / (1 - p))


def nll(p, y):
    p = np.clip(np.asarray(p, float), 1e-9, 1 - 1e-9)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


def boot(d, groups, n=2000, seed=20261106):
    """mean of d and a 95% event-cluster bootstrap CI (cards resampled with replacement, ratio of sums)."""
    d = np.asarray(d, float)
    g = pd.factorize(np.asarray(groups))[0]
    G = g.max() + 1
    S = np.bincount(g, d, G)
    C = np.bincount(g, minlength=G).astype(float)
    rng = np.random.default_rng(seed)
    W = rng.multinomial(G, np.full(G, 1.0 / G), size=n)          # card multiplicities per resample
    bs = (W @ S) / (W @ C)
    return round(float(d.mean()), 5), [round(float(np.percentile(bs, 2.5)), 5), round(float(np.percentile(bs, 97.5)), 5)]


def slope(p, y):
    z = lg(p, 1e-6)
    r = minimize(lambda b: np.sum(np.logaddexp(0, b[0] * z) - y * b[0] * z), [1.0], method="L-BFGS-B",
                 bounds=[(0.01, 10)])
    return round(float(r.x[0]), 3)


def raw_outcomes():
    """fid -> (date, winner A/B/D/NC, method class) straight from the raw ufcstats CSVs."""
    res = pd.read_csv(os.path.join(ROOT, "data", "raw", "ufc_fight_results.csv"))
    ev = pd.read_csv(os.path.join(ROOT, "data", "raw", "ufc_event_details.csv"))
    ev["EVENT"] = ev["EVENT"].str.strip()
    dmap = {e: pd.to_datetime(d, format="%B %d, %Y").date().isoformat() for e, d in zip(ev["EVENT"], ev["DATE"])}
    out = {}
    for r in res.itertuples(index=False):
        fid = str(r.URL).rstrip("/").rsplit("/", 1)[-1]
        date = dmap.get(str(r.EVENT).strip())
        if date is None or date >= VAULT:
            continue                                  # the vault: never read past this line
        w = {"W/L": "A", "L/W": "B", "D/D": "D"}.get(str(r.OUTCOME).strip(), "NC")
        m = str(r.METHOD).strip().lower()
        if m.startswith("ko") or "tko" in m:
            mc = "KO"
        elif m.startswith("submission"):
            mc = "SUB"
        elif m.startswith("decision"):
            mc = "DEC"
        else:
            mc = "OTHER"
        out[fid] = (date, w, mc)
    return out


def load_D():
    """ml2's expert table plus seqnet.json's p (static) and p_annual, joined by fight id."""
    D = pickle.load(open(os.path.join(ROOT, "out", "ml2_cache", "stack.pkl"), "rb"))["D"].copy()
    S = json.load(open(os.path.join(ROOT, "data", "derived", "seqnet.json")))["fights"]
    D["sq"] = [S[f]["p"] if f in S else np.nan for f in D["fid"]]
    D["sq_ann"] = [S[f]["p_annual"] if f in S else np.nan for f in D["fid"]]
    D["sq_y"] = [S[f]["y"] if f in S else -1 for f in D["fid"]]
    return D, S


# ====================================================================== protocol
def stage_protocol():
    out = {}
    d = pickle.load(open(os.path.join(CACHE, "data.pkl"), "rb"))
    ex = d["ex"]
    out["data_last_fight"] = d["last_fight"]
    out["n_examples_2026_or_later"] = int(sum(e["date"].isoformat() >= VAULT for e in ex))
    out["max_token_day"] = dt.date.fromordinal(int(d["tok_day"].max())).isoformat()
    # every history token strictly before the fight it feeds (and so never the fight itself)
    bad_same, bad_after, n_tok = 0, 0, 0
    for e in ex:
        for s in (0, 1):
            h = e["sides"][s]["hist"]
            if not h:
                continue
            td = d["tok_day"][h]
            n_tok += len(h)
            bad_same += int((td == e["day"]).sum())
            bad_after += int((td > e["day"]).sum())
    out["history_tokens_checked"] = n_tok
    out["history_tokens_same_day"] = bad_same
    out["history_tokens_after"] = bad_after
    # labels and dates against the raw CSV (own parse)
    raw = raw_outcomes()
    D, S = load_D()
    mism, miss = [], 0
    for f, yv in zip(D["fid"], D["y"]):
        r = raw.get(f)
        if r is None:
            miss += 1
            continue
        if r[1] not in ("A", "B") or (1 if r[1] == "A" else 0) != int(yv):
            mism.append(f)
    out["labels_vs_raw_csv"] = {"n": int(len(D)), "missing_in_raw": miss, "mismatch": len(mism)}
    out["seqnet_json_label_mismatch_vs_ml2"] = int(np.sum(D["sq_y"].to_numpy() != D["y"].to_numpy()))
    out["seqnet_json_vs_ml2_ids"] = {"ml2_rows": int(len(D)), "seqnet_rows": len(S),
                                     "ml2_without_seqnet": int(D["sq"].isna().sum()),
                                     "seqnet_dates_2026": int(sum(v["date"] >= VAULT for v in S.values()))}
    # walk-forward windows: recompute the training rows of every refit from the arrays and compare n_train
    sys.path.insert(0, os.path.join(ROOT, "tools"))
    import seqnet as SQ
    A = SQ.build_arrays(d)
    W = pickle.load(open(os.path.join(CACHE, "walk.pkl"), "rb"))
    cfg = W["cfg"]["cfg"]
    win = {}
    for (Y, s), r in sorted(W["full"].items()):
        cut = dt.date(Y, 1, 1).toordinal()
        tr = (A["DAY"] < cut) & (A["YEAR"] >= cfg["train_from"]) & (~A["AMB"]) & \
             ((~np.isnan(A["YW"])) | (A["SN"].sum((1, 2)) > 0))
        py = sorted(set(A["YEAR"][r["pidx"]].tolist()))
        win.setdefault(str(Y), {"n_train_recomputed": int(tr.sum()), "n_train_logged": set(), "pred_years": py,
                                "last_train_day": dt.date.fromordinal(int(A["DAY"][tr].max())).isoformat()})
        win[str(Y)]["n_train_logged"].add(int(r["n_train"]))
    for v in win.values():
        v["n_train_logged"] = sorted(v["n_train_logged"])
        v["match"] = v["n_train_logged"] == [v["n_train_recomputed"]]
        v["pred_after_train"] = min(v["pred_years"]) > int(v["last_train_day"][:4]) or \
            (min(v["pred_years"]) == int(v["last_train_day"][:4]) + 1)
    out["walk_windows"] = win
    # ensemble recomputed from walk.pkl (own averaging) vs the published p / p_annual
    pos = {f: i for i, f in enumerate(A["FID"])}
    zs, za = np.full(len(A["DAY"]), np.nan), np.full(len(A["DAY"]), np.nan)
    for Y in range(2019, 2026):
        runs = [r for (YY, s), r in W["full"].items() if YY == Y]
        z = np.mean([r["pred"]["z"] for r in runs], 0)
        yrs = A["YEAR"][runs[0]["pidx"]]
        za[runs[0]["pidx"][yrs == Y]] = z[yrs == Y]
        if Y < 2024:
            zs[runs[0]["pidx"][yrs == Y]] = z[yrs == Y]
        elif Y == 2024:
            zs[runs[0]["pidx"]] = z
    ii = np.array([pos[f] for f in D["fid"]])
    out["ensemble_vs_json_maxabs"] = {"p": float(np.nanmax(np.abs(sg(zs[ii]) - D["sq"].to_numpy(float)))),
                                      "p_annual": float(np.nanmax(np.abs(sg(za[ii]) - D["sq_ann"].to_numpy(float))))}
    # HP CV re-scored from the raw runs (own mask: decisive, not ambiguous, both men with a prior UFC fight)
    H = json.load(open(os.path.join(CACHE, "hpcv.json")))
    ev_ok = (~A["AMB"]) & (~np.isnan(A["YW"])) & (A["NPRIOR"].min(1) >= 1)
    cvs = {}
    for nm in sorted({k.split("|")[0] for k in H["runs"]}):
        tot, n = 0.0, 0
        for Y in (2016, 2017, 2018):
            rs = [H["runs"]["%s|%d|%d" % (nm, Y, s)] for s in (11, 12)]
            jj = np.array([pos[f] for f in rs[0]["fid"]])
            assert all(r["fid"] == rs[0]["fid"] for r in rs)
            z = np.mean([np.array(r["z"]) for r in rs], 0)
            m = ev_ok[jj] & (A["YEAR"][jj] == Y)
            tot += nll(sg(z[m]), A["YW"][jj][m]).sum()
            n += int(m.sum())
        cvs[nm] = round(tot / n, 5)
    pick = min(cvs, key=lambda k: cvs[k] + (0 if k == "base" else SEL))
    passing = [k for k in cvs if k != "base" and cvs[k] < cvs["base"] - SEL]
    out["hpcv_rescored"] = {"cv": cvs, "n": n, "pick_with_0.0005_rule": pick, "passing": passing,
                            "builder_chosen": json.load(open(os.path.join(CACHE, "chosen.json")))["name"]}
    # timeline: pre-registration commit vs the single look
    try:
        ct = subprocess.check_output(["git", "-C", ROOT, "show", "-s", "--format=%cI", "8e41138"], text=True).strip()
    except Exception:
        ct = None
    out["timeline"] = {"chosen_frozen": json.load(open(os.path.join(CACHE, "chosen.json")))["frozen"],
                       "prereg_commit": ct,
                       "confirm_scored_at": json.load(open(os.path.join(CACHE, "confirm.json")))["scored_at"],
                       "confirm_forced_rerun": json.load(open(os.path.join(CACHE, "confirm.json")))["forced_rerun"]}
    for k, v in out.items():
        print(k, v if not isinstance(v, dict) or len(str(v)) < 400 else json.dumps(v)[:800], flush=True)
    save("protocol", out)


# ====================================================================== score
def stage_score():
    out = {}
    D, S = load_D()
    y, yr, ev = D["y"].to_numpy(float), D["year"].to_numpy(), D["event"].to_numpy()
    cols = {"seqnet": "sq", "seqnet annual": "sq_ann", "ml2 blend": "ml2_static", "ml2 logistic": "ml2lr_static",
            "ml v1": "ml", "market rating": "mkt_rating", "elo": "elo", "close": "market", "open": "open"}
    for per, m0 in (("oof_2019_2023", (yr >= 2019) & (yr <= 2023)), ("valid_2024_2025", yr >= 2024)):
        blk = {"standalone": {}, "seqnet_minus": {}}
        for k, c in cols.items():
            p = D[c].to_numpy(float)
            m = m0 & ~np.isnan(p)
            if m.sum() == 0:
                continue
            blk["standalone"][k] = {"n": int(m.sum()), "ll": round(float(nll(p[m], y[m]).mean()), 5),
                                    "slope": slope(p[m], y[m])}
            if c not in ("sq", "sq_ann"):
                q = D["sq"].to_numpy(float)
                blk["seqnet_minus"][k] = dict(zip(("diff", "ci"), boot(nll(q[m], y[m]) - nll(p[m], y[m]), ev[m])),
                                              n=int(m.sum()))
        out[per] = blk
    # free-intercept check (unmirrored fit y ~ a + b z on 2019-2023): a corner-order exploit would show as a mean
    # P(A) above the others' and a smaller free intercept
    fi = {}
    m0 = (yr >= 2019) & (yr <= 2023)
    for k in ("seqnet", "ml2 blend", "close", "elo"):
        p = D[cols[k]].to_numpy(float)
        z, yy = lg(p[m0], 1e-6), y[m0]
        f = lambda t: np.mean(np.logaddexp(0, t[0] + t[1] * z) - yy * (t[0] + t[1] * z))
        r1, r0 = minimize(f, [0, 1]), minimize(lambda t: f([0, t[0]]), [1])
        fi[k] = {"mean_pA": round(float(p[m0].mean()), 4), "mean_y": round(float(yy.mean()), 4),
                 "free_intercept": round(float(r1.x[0]), 3), "ll_gain_from_intercept": round(float(r1.fun - r0.fun), 5)}
    out["free_intercept_oof"] = fi
    # missing tale-of-the-tape subsets: a current-snapshot leak would make seqnet look better where values are missing
    d = pickle.load(open(os.path.join(CACHE, "data.pkl"), "rb"))
    exi = {e["fid"]: e for e in d["ex"]}
    miss = np.array([any(not exi[f]["sides"][s].get(k) for s in (0, 1) for k in ("height", "reach")) or
                     any(exi[f]["sides"][s]["age"] is None for s in (0, 1)) for f in D["fid"]])
    mside = []
    for f in D["fid"]:
        e = exi[f]
        ms = [not e["sides"][s].get("reach") or e["sides"][s]["age"] is None for s in (0, 1)]
        mside.append(0 if (ms[0] and not ms[1]) else (1 if (ms[1] and not ms[0]) else -1))
    mside = np.array(mside)
    q, b2 = D["sq"].to_numpy(float), D["ml2_static"].to_numpy(float)
    mm = {}
    for per, m0 in (("oof", (yr >= 2019) & (yr <= 2023)), ("valid", yr >= 2024)):
        for lab, m in (("any size/DOB missing", miss), ("all present", ~miss)):
            mk = m0 & m
            mm["%s | %s" % (per, lab)] = dict(zip(("seqnet_minus_ml2", "ci"), boot(nll(q[mk], y[mk]) - nll(b2[mk], y[mk]),
                                                                                  ev[mk])), n=int(mk.sum()))
        one = m0 & (mside >= 0)
        win_missing_side = np.where(mside[one] == 0, y[one], 1 - y[one])
        pc = D["market"].to_numpy(float)[one]
        p_close_missing = np.where(mside[one] == 0, pc, 1 - pc)
        p_sq_missing = np.where(mside[one] == 0, q[one], 1 - q[one])
        mm["%s | one side missing reach or DOB" % per] = {
            "n": int(one.sum()), "missing_side_won": round(float(win_missing_side.mean()), 4),
            "close_said": round(float(np.nanmean(p_close_missing)), 4),
            "seqnet_said": round(float(p_sq_missing.mean()), 4)}
    out["missingness"] = mm
    # 7-bin method x round vs methodround S from the published JSONs and raw outcomes (own scoring)
    raw = raw_outcomes()
    mr = json.load(open(os.path.join(ROOT, "data", "derived", "methodround.json")))["fights"]
    rows = []
    for f, yv, Y, e in zip(D["fid"], y, yr, ev):
        r = raw.get(f)
        if r is None or r[2] == "OTHER" or f not in mr or "sum_S" not in mr[f] or S[f].get("bins7") is None:
            continue
        w = r[1]
        k = {("A", "KO"): 0, ("A", "SUB"): 1, ("A", "DEC"): 2, ("B", "DEC"): 4, ("B", "SUB"): 5, ("B", "KO"): 6}[(w, r[2])]
        ps = np.asarray(S[f]["bins7"], float)
        pm = np.asarray(mr[f]["sum_S"]["bins7"], float)
        rows.append((Y, e, -np.log(max(ps[k] / ps.sum(), 1e-9)), -np.log(max(pm[k] / pm.sum(), 1e-9))))
    R = pd.DataFrame(rows, columns=["year", "event", "sq", "S"])
    out["bin7_vs_S"] = {}
    for per, m in (("2019_2023", R["year"] <= 2023), ("2024_2025", R["year"] >= 2024)):
        rr = R[m]
        out["bin7_vs_S"][per] = {"n": int(len(rr)), "seqnet": round(float(rr["sq"].mean()), 4),
                                 "S": round(float(rr["S"].mean()), 4),
                                 "diff_ci": boot(rr["sq"] - rr["S"], rr["event"])}
    # seed-ensemble curve from walk.pkl (own averaging, first k seeds)
    sys.path.insert(0, os.path.join(ROOT, "tools"))
    W = pickle.load(open(os.path.join(CACHE, "walk.pkl"), "rb"))
    seeds = sorted({s for (_, s) in W["full"]})
    A_fid = np.array([e["fid"] for e in d["ex"]])
    A_year = np.array([e["year"] for e in d["ex"]])
    pos = {f: i for i, f in enumerate(A_fid)}
    ii = np.array([pos[f] for f in D["fid"]])
    curve = {}
    for k in (1, 2, 4, 8):
        z = np.full(len(A_fid), np.nan)
        for Y in range(2019, 2024):
            runs = [W["full"][(Y, s)] for s in seeds[:k]]
            pid = runs[0]["pidx"]
            t = A_year[pid] == Y
            z[pid[t]] = np.mean([r["pred"]["z"][t] for r in runs], 0)
        m = (yr >= 2019) & (yr <= 2023)
        curve[str(k)] = round(float(nll(sg(z[ii][m]), y[m]).mean()), 5)
    out["oof_by_n_seeds"] = curve
    print(json.dumps(out, indent=1, default=float)[:6000], flush=True)
    save("score", out)


# ====================================================================== gate
def zcol(D, c, pclip=0.01):
    p = D[c].to_numpy(float)
    return np.where(np.isnan(p), 0.0, lg(np.clip(p, pclip, 1 - pclip), 1e-9))


def fit_stack(Z, y, w, signed=False, intercept=False, mirrored=True):
    """Logit-weight stacker. mirrored: rows (z, y) and (-z, 1 - y); the intercept column is not flipped (so with
    mirroring it can only fit noise; without mirroring it can learn the corner order)."""
    if mirrored:
        Z, y, w = np.r_[Z, -Z], np.r_[y, 1 - y], np.r_[w, w]
    if intercept:
        Z = np.c_[Z, np.ones(len(Z))]
    w = w / w.sum()
    k = Z.shape[1]

    def f(b):
        q = Z @ b
        return np.sum(w * (np.logaddexp(0, q) - y * q)) + 1e-4 * b @ b, Z.T @ (w * (sg(q) - y)) + 2e-4 * b
    nb = k - int(intercept)
    bnds = [(None, None) if signed else (0, None)] * nb + ([(None, None)] if intercept else [])
    return minimize(f, np.full(k, 0.2), jac=True, method="L-BFGS-B", bounds=bnds).x


def stack_cv(D, cols, ok, y, yr, h, **kw):
    Z = np.c_[[zcol(D, c) for c in cols]].T
    pred = np.full(len(D), np.nan)
    for Y in (2021, 2022, 2023):
        tr = ok & (yr >= 2019) & (yr < Y)
        w = np.ones(tr.sum()) if h is None else 0.5 ** ((Y - yr[tr]) / h)
        b = fit_stack(Z[tr], y[tr], w, **kw)
        te = ok & (yr == Y)
        zt = np.c_[Z[te], np.ones(te.sum())] if kw.get("intercept") else Z[te]
        pred[te] = sg(zt @ b)
    m = ok & (yr >= 2021) & (yr <= 2023)
    return float(nll(pred[m], y[m]).mean()), pred


def stage_gate():
    D, _ = load_D()
    y, yr, ev = D["y"].to_numpy(float), D["year"].to_numpy(), D["event"].to_numpy()
    ok = {"line": D["market"].notna().to_numpy(), "open": D["open"].notna().to_numpy(),
          "noline": np.ones(len(D), bool)}
    pairs = {"line": [["market", "ml2_static"], ["market", "ml2lr_static"]],
             "open": [["open", "ml2_static"], ["open", "ml2lr_static"]],
             "noline": [["ml2_static", "mkt_rating", "feat_lr"], ["ml2lr_static", "mkt_rating"]]}
    out = {"gate": {}, "looser": {}}
    cvm = (yr >= 2021) & (yr <= 2023)
    for reg, sets in pairs.items():
        for base in sets:
            res = {}
            for nm, cols in (("base", base), ("plus", base + ["sq"])):
                cand = {h: stack_cv(D, cols, ok[reg], y, yr, h) for h in (None, 3.0, 1.5)}
                hb = min(cand, key=lambda h: cand[h][0] + (0 if h is None else SEL))
                res[nm] = (round(cand[hb][0], 5), hb, cand[hb][1])
            gain = res["plus"][0] - res["base"][0]
            m = ok[reg] & cvm
            key = "%s: %s" % (reg, "+".join(base))
            out["gate"][key] = {"cv_base": res["base"][0], "h_base": res["base"][1], "cv_plus": res["plus"][0],
                                "h_plus": res["plus"][1], "gain": round(gain, 5), "enters": bool(gain < -SEL),
                                "paired_cv_years": boot(nll(res["plus"][2][m], y[m]) - nll(res["base"][2][m], y[m]),
                                                        ev[m])}
            # looser stackers (h fixed at None): signed weights; free intercept unmirrored (the corner-order exploit)
            lo = {}
            for lab, kw in (("signed weights", {"signed": True}),
                            ("free intercept, unmirrored", {"intercept": True, "mirrored": False})):
                cb, _ = stack_cv(D, base, ok[reg], y, yr, None, **kw)
                cp, _ = stack_cv(D, base + ["sq"], ok[reg], y, yr, None, **kw)
                lo[lab] = {"cv_base": round(cb, 5), "cv_plus": round(cp, 5), "gain": round(cp - cb, 5)}
            out["looser"][key] = lo
            print("GATE %-40s %s | looser %s" % (key, {k: v for k, v in out["gate"][key].items()}, lo), flush=True)
    # builder's published gate for comparison
    sj = json.load(open(os.path.join(ROOT, "data", "derived", "seqnet.json")))["cv"]["stack"]["gate"]
    out["builder_gate"] = {k: {"cv_base": v["cv_base"], "cv_plus": v["cv_plus"], "gain": v["gain"],
                               "seqnet_weight": v["seqnet_weight"]} for k, v in sj.items()}
    save("gate", out)


# ====================================================================== repro
def stage_repro():
    sys.path.insert(0, os.path.join(ROOT, "tools"))
    import seqnet as SQ
    A = SQ.get_arrays()
    W = pickle.load(open(os.path.join(CACHE, "walk.pkl"), "rb"))
    cfg = dict(SQ.DEFAULT_CFG, **SQ.cfg_of(W["cfg"]["name"]))
    Y, seed = 2023, 101
    ref = W["full"][(Y, seed)]
    r = SQ.fit_one(A, cfg, seed, SQ.day_of(Y), epochs=W["epochs"][Y], pred_idx=ref["pidx"])
    dz = np.abs(r["pred"]["z"] - ref["pred"]["z"])
    out = {"refit": Y, "seed": seed, "epochs": W["epochs"][Y], "n_train": r["n_train"], "n_train_ref": ref["n_train"],
           "max_abs_logit_diff": float(dz.max()), "mean_abs_logit_diff": float(dz.mean())}
    print(out, flush=True)
    save("repro", out)


if __name__ == "__main__":
    st = sys.argv[1] if len(sys.argv) > 1 else "all"
    for name, fn in (("protocol", stage_protocol), ("score", stage_score), ("gate", stage_gate), ("repro", stage_repro)):
        if st in (name, "all"):
            fn()
