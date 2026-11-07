#!/usr/bin/env python3
"""Adversarial verification of tools/finishing.py (task key: finishing). Verifier's own code: outcomes are read straight
from data/raw/ufc_fight_results.csv + ufc_event_details.csv with pandas (no build_db), and losses, beta search and the
event-cluster bootstrap are written here from scratch. Never reads a 2026 outcome.

Run from the project root. CACHE = $FIN_CACHE or out/finishing_cache (a full `base .. swap` re-run of
tools/finishing.py into a scratch FIN_CACHE reproduces the builder's cache exactly):

    python3 tools/finishing_verify.py score      # re-score data/derived/finishing.json cells (2020-23 nested OOF,
                                                 #   2021-23, and the already-reported 2024-25 look) vs raw outcomes
    python3 tools/finishing_verify.py gate       # own stack gate 2021-2023 (7-bin and joint), 0.0005 rule
    python3 tools/finishing_verify.py rounds     # round candidates: sided round loss per finish by period and by year
    python3 tools/finishing_verify.py eb         # own re-implementation: name-matched raw finishing rates + sklearn
                                                 #   conditional logit, chosen on 2016-19, scored on 2020-23 (no 2024+)
    python3 tools/finishing_verify.py lookahead  # perturb every outcome after 2022-07-01, refit fold 2022: rows on or
                                                 #   before must not move; exported 2024-25 cells = fresh fit < 2024
    python3 tools/finishing_verify.py corner     # free-intercept check: corner flag added to the method model, 2020-23
"""
import datetime as dt
import json
import os
import pickle
import sys
from collections import defaultdict

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE = os.environ.get("FIN_CACHE", os.path.join(ROOT, "out", "finishing_cache"))
R5 = 5
VAULT = dt.date(2026, 1, 1)


# ---------------------------------------------------------------------- raw outcomes (own parser)
def raw_rows(until=VAULT):
    ev = pd.read_csv(os.path.join(ROOT, "data/raw/ufc_event_details.csv"), dtype=str, keep_default_na=False)
    evd = {}
    for e, d in zip(ev["EVENT"], ev["DATE"]):
        try:
            evd[e.strip()] = dt.datetime.strptime(d.strip(), "%B %d, %Y").date()
        except ValueError:
            pass
    r = pd.read_csv(os.path.join(ROOT, "data/raw/ufc_fight_results.csv"), dtype=str, keep_default_na=False)
    out = {}
    for e, bout, o, m, rd, url in zip(r["EVENT"], r["BOUT"], r["OUTCOME"], r["METHOD"], r["ROUND"], r["URL"]):
        d = evd.get(e.strip())
        if d is None or d >= until or d >= VAULT:          # never read 2026 outcomes
            continue
        fid = url.strip().rstrip("/").rsplit("/", 1)[-1]
        o, m, rd = o.strip(), m.strip(), rd.strip()
        w = {"W/L": "A", "L/W": "B", "D/D": "D"}.get(o)
        cls = None
        if w == "D":
            cls = "DRAW"
        elif w in ("A", "B"):
            cls = ("KO" if m in ("KO/TKO", "TKO - Doctor's Stoppage") else "SUB" if m == "Submission"
                   else "DEC" if m.startswith("Decision") else None)
        nm = [x.strip() for x in bout.split(" vs. ")]
        out.setdefault(fid, {"event": e.strip(), "date": d, "winner": w, "cls": cls,
                             "rnd": int(rd) if rd.isdigit() else 1, "names": nm if len(nm) == 2 else None})
    return out


def boot(d, cl, B=2000, seed=20261107):
    """Event-cluster bootstrap of a mean (ratio of resampled card sums); returns mean and 95% CI."""
    rng = np.random.default_rng(seed)
    u, inv = np.unique(np.asarray(cl), return_inverse=True)
    s = np.bincount(inv, weights=d, minlength=len(u))
    c = np.bincount(inv, minlength=len(u)).astype(float)
    idx = rng.integers(0, len(u), size=(B, len(u)))
    bs = s[idx].sum(1) / c[idx].sum(1)
    return float(d.mean()), float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5))


def fmt(t):
    return "%+.5f [%+.5f, %+.5f]" % t


# ---------------------------------------------------------------------- score
def compact_losses(rec, kc, kb, oc):
    """7-bin, joint and round-given-finish NLL from the exported R-round compact cells and bins7."""
    R = rec["rounds"]
    c = np.clip(np.array(rec[kc], float), 1e-9, None)
    c /= c.sum()
    b = np.clip(np.array(rec[kb], float), 1e-9, None)
    b /= b.sum()
    w, m = oc["winner"], oc["cls"]
    if m is None:
        return None
    if m == "DRAW":
        return -np.log(b[3]), -np.log(c[4 * R + 2]), None
    if m == "DEC":
        return -np.log(b[2 if w == "A" else 4]), -np.log(c[4 * R if w == "A" else 4 * R + 1]), None
    rr = min(max(oc["rnd"], 1), R) - 1
    blk = {("A", "KO"): 0, ("A", "SUB"): 1, ("B", "KO"): 2, ("B", "SUB"): 3}[(w, m)]
    fin = c[:4 * R].reshape(4, R)
    return (-np.log(b[{0: 0, 1: 1, 2: 6, 3: 5}[blk]]), -np.log(c[blk * R + rr]),
            -np.log(fin[:, rr].sum() / fin.sum()))


def cmd_score():
    d = json.load(open(os.path.join(ROOT, "data/derived/finishing.json")))
    oc = raw_rows()
    F = d["fights"]
    print("fights in export %d; not found in raw %d; latest export date %s" % (
        len(F), sum(f not in oc for f in F), max(r["date"] for r in F.values())))
    sets = (("nested OOF 2020-2023", lambda r: r["set"] == "nested_oof" and "2020" <= r["date"][:4] <= "2023"),
            ("nested OOF 2021-2023 (gate years, raw input)", lambda r: r["set"] == "nested_oof" and "2021" <= r["date"][:4] <= "2023"),
            ("2024-2025 single look (re-score of the reported numbers)", lambda r: r["set"] == "holdout"))
    for name, sel in sets:
        rows = []
        for f, r in F.items():
            if not sel(r) or f not in oc:
                continue
            assert str(oc[f]["date"]) == r["date"], f
            a = compact_losses(r, "cells", "bins7", oc[f])
            b = compact_losses(r, "s2ml2win_cells", "s2ml2win_bins7", oc[f])
            if a is not None:
                rows.append((oc[f]["event"], r["date"][:4], a, b))
        ev = np.array([x[0] for x in rows])
        yy = np.array([x[1] for x in rows])
        b7 = np.array([[x[2][0], x[3][0]] for x in rows])
        jt = np.array([[x[2][1], x[3][1]] for x in rows])
        fm = np.array([x[2][2] is not None for x in rows])
        rg = np.array([[x[2][2], x[3][2]] for x in rows if x[2][2] is not None], float)
        print("\n== %s: %d fights, %d cards" % (name, len(rows), len(set(ev))))
        print("7-bin  finishing %.5f  S2+ml2win %.5f  diff %s" % (b7[:, 0].mean(), b7[:, 1].mean(), fmt(boot(b7[:, 0] - b7[:, 1], ev))))
        print("joint  finishing %.5f  S2+ml2win %.5f  diff %s" % (jt[:, 0].mean(), jt[:, 1].mean(), fmt(boot(jt[:, 0] - jt[:, 1], ev))))
        print("round given finish (n %d)  diff %s" % (fm.sum(), fmt(boot(rg[:, 0] - rg[:, 1], ev[fm]))))
        print("round part of the joint gain (joint - 7-bin, per fight)  diff %s" % fmt(
            boot((jt[:, 0] - b7[:, 0]) - (jt[:, 1] - b7[:, 1]), ev)))
        for y in sorted(set(yy)):
            m = yy == y
            print("  %s n %d 7-bin finishing %.5f vs %.5f" % (y, m.sum(), b7[m, 0].mean(), b7[m, 1].mean()))


# ---------------------------------------------------------------------- gate / rounds (own joint construction)
def cells(P6, H, draw_c):
    n = len(P6)
    J = np.zeros((n, 23))
    for j, blk in ((0, 0), (1, 1), (5, 2), (4, 3)):
        sh = H[:, blk * R5:(blk + 1) * R5]
        J[:, blk * R5:(blk + 1) * R5] = P6[:, [j]] * sh / sh.sum(1, keepdims=True)
    J[:, 20] = P6[:, 2] * (1 - draw_c)
    J[:, 21] = P6[:, 3] * (1 - draw_c)
    J[:, 22] = (P6[:, 2] + P6[:, 3]) * draw_c
    return J


def nll(J, lab):
    J = np.clip(J, 1e-9, None)
    J = J / J.sum(1, keepdims=True)
    b7, jt = np.zeros(len(J)), np.zeros(len(J))
    for i, o in enumerate(lab):
        w, cls, r = o["winner"], o["cls"], o["rnd"]
        if cls == "DRAW":
            b7[i] = jt[i] = J[i, 22]
        elif cls == "DEC":
            b7[i] = jt[i] = J[i, 20 if w == "A" else 21]
        else:
            blk = {("A", "KO"): 0, ("A", "SUB"): 1, ("B", "KO"): 2, ("B", "SUB"): 3}[(w, cls)]
            b7[i] = J[i, blk * R5:(blk + 1) * R5].sum()
            jt[i] = J[i, blk * R5 + min(max(r, 1), R5) - 1]
    return -np.log(b7), -np.log(jt)


def _cache():
    sys.path.insert(0, HERE)
    import finishing  # noqa: F401  (FoldData pickles under this module name)
    base = pickle.load(open(os.path.join(CACHE, "base.pkl"), "rb"))
    G = pickle.load(open(os.path.join(CACHE, "grid.pkl"), "rb"))
    nz = pickle.load(open(os.path.join(CACHE, "nested_oof.pkl"), "rb"))
    oc = raw_rows(until=dt.date(2024, 1, 1))
    T = base["T"]
    lab = [oc.get(f) for f in T["id"]]
    yr = T["year"].to_numpy()
    ok = np.array([o is not None and o["cls"] is not None for o in lab]) & (yr < 2024)
    return base, G, nz, lab, yr, ok


def cmd_gate():
    base, G, nz, lab, yr, ok = _cache()
    draw_c = base["draw_c"]
    ev = base["T"]["event"].to_numpy()
    Jinc = cells(np.nan_to_num(base["P6_S2w"], nan=1 / 6), base["H"], draw_c)
    cands = {"nested procedure (primary)": (nz["P6"], nz["H"]),
             "nested method, S2 round shapes": (nz["P6"], base["H"]),
             "S2+ml2win + production round model (round picked on 2016-23: optimistic)":
                 (base["P6_S2w"], G["H"]["haz|C0.003|slope0"].astype(float)),
             "production method + round (both picked on 2016-23: optimistic, not a valid gate input)":
                 (G["P6"]["core|st2008|hl8|C0.001"].astype(float), G["H"]["haz|C0.003|slope0"].astype(float))}
    for name, (P6, H) in cands.items():
        have = ~np.isnan(P6).any(1) & ok
        Jf = np.full_like(Jinc, np.nan)
        Jf[have] = cells(P6[have], H[have], draw_c)
        for metric in (0, 1):
            ds, cl, betas = [], [], {}
            for Y in (2021, 2022, 2023):
                h = have & (yr >= 2017) & (yr < Y)
                lh = [lab[i] for i in np.flatnonzero(h)]
                best = None
                for b in np.round(np.arange(0, 1.0001, 0.05), 2):
                    s = nll(b * Jf[h] + (1 - b) * Jinc[h], lh)[metric].mean()
                    if best is None or s < best[0] - 1e-12:
                        best = (s, float(b))
                betas[Y] = best[1]
                m = have & (yr == Y)
                lm = [lab[i] for i in np.flatnonzero(m)]
                ds.append(nll(best[1] * Jf[m] + (1 - best[1]) * Jinc[m], lm)[metric] - nll(Jinc[m], lm)[metric])
                cl.append(ev[m])
            r = boot(np.concatenate(ds), np.concatenate(cl))
            print("%-92s %-5s betas %s blend - S2+ml2win %s -> %s" % (name, ("7-bin", "joint")[metric], betas, fmt(r),
                                                                     "PASS" if r[0] < -0.0005 else "fail"))


def cmd_rounds():
    base, G, nz, lab, yr, ok = _cache()
    rows = ok & (yr >= 2016)
    idx = np.flatnonzero(rows)
    L = [lab[i] for i in idx]
    fin = np.array([o["cls"] in ("KO", "SUB") for o in L])
    P6 = np.nan_to_num(base["P6_S2w"], nan=1 / 6)[idx]
    b7i, ji = nll(cells(P6, base["H"][idx], base["draw_c"]), L)
    y = yr[idx]
    for k in ("haz|C0.003|slope0", "haz+eb+fight+win+filter+cardio|C0.003|slope0", "eb+fight+win+filter+cardio|C0.003|slope1"):
        b7, j = nll(cells(P6, G["H"][k][idx].astype(float), base["draw_c"]), L)
        d = (j - b7) - (ji - b7i)
        per = " | ".join("%d-%d %+.4f" % (lo, hi, d[(y >= lo) & (y <= hi) & fin].mean())
                         for lo, hi in ((2016, 2019), (2020, 2023), (2021, 2023)))
        print("%-46s per finish vs S2 shapes: %s" % (k, per))
        print("%-46s by year: %s" % ("", {int(v): round(float(d[(y == v) & fin].mean()), 4) for v in range(2016, 2024)}))


# ---------------------------------------------------------------------- eb (own re-implementation, CV years only)
def cmd_eb():
    from sklearn.linear_model import LogisticRegression
    from sklearn.preprocessing import StandardScaler
    base = pickle.load(open(os.path.join(CACHE, "base.pkl"), "rb"))
    T = base["T"]
    raw = raw_rows(until=dt.date(2024, 1, 1))
    hist = defaultdict(list)
    for fid, o in raw.items():
        if not o["names"]:
            continue
        okf = o["cls"] in ("KO", "SUB", "DEC", "DRAW")
        for s, nm in enumerate(o["names"]):
            won, lost = o["winner"] == "AB"[s], o["winner"] == "BA"[s]
            hist[nm].append((o["date"], float(won and o["cls"] == "KO"), float(won and o["cls"] == "SUB"),
                             float(okf and o["cls"] in ("DEC", "DRAW")), float(lost and o["cls"] == "KO"),
                             float(lost and o["cls"] == "SUB"), float(okf)))
    n = len(T)
    C = np.full((n, 2, 6), np.nan)
    for i, (fid, date) in enumerate(zip(T["id"], T["date"])):
        o = raw.get(fid)
        if o is None or not o["names"]:
            continue
        for s, nm in enumerate(o["names"]):
            h = [t for t in hist[nm] if t[0] < date]
            C[i, s] = np.array([sum(t[j] for t in h) for j in range(1, 7)]) if h else 0.0
    yr = T["year"].to_numpy()
    ws = np.where(T["winner"].to_numpy() == "A", 0, np.where(T["winner"].to_numpy() == "B", 1, -1))
    mc = T["cls"].map({"KO": 0, "SUB": 1, "DEC": 2}).fillna(-1).astype(int).to_numpy()
    dec_ok = (ws >= 0) & (mc >= 0) & ~np.isnan(C[:, 0, 0])
    print("methodround rows %d; matched to raw (< 2024) %d; 2024+ rows skipped by design %d" % (
        n, int((~np.isnan(C[:, 0, 0])).sum()), int((yr >= 2024).sum())))
    z = np.log(base["pwin"] / (1 - base["pwin"]))
    S2 = [base["FX2"][base["cols_s2"]].to_numpy(float), base["FY2"][base["cols_s2"]].to_numpy(float)]
    inc = np.nan_to_num(base["P6_S2w"], nan=1 / 6)
    qinc = [inc[:, :3] / inc[:, :3].sum(1, keepdims=True), inc[:, [5, 4, 3]] / inc[:, 3:].sum(1, keepdims=True)]

    def design(o, v, k, use_eb):
        zz = z if o == 0 else -z
        parts = [S2[o], zz[:, None], np.abs(zz)[:, None]]
        if use_eb:
            tr = (yr < v) & ~np.isnan(C[:, 0, 0])
            tot = C[tr].sum((0, 1))
            p = np.clip(tot[:5] / tot[5], 1e-3, 1 - 1e-3)
            r = (np.nan_to_num(C[:, :, :5]) + k * p) / (np.nan_to_num(C[:, :, 5:6]) + k)
            E = np.log(r / (1 - r)) - np.log(p / (1 - p))
            parts += [E[:, o, [0, 1, 2, 3, 4]], E[:, 1 - o, [3, 4, 2, 0, 1]]]
        return np.hstack(parts)

    def cv(years, k, Cc, use_eb):
        a, b, e = [], [], []
        for v in years:
            XA, XB = design(0, v, k, use_eb), design(1, v, k, use_eb)
            tr = (yr < v) & (yr >= 2008) & dec_ok
            Xtr = np.where((ws[tr] == 0)[:, None], XA[tr], XB[tr])
            sc = StandardScaler().fit(Xtr)
            m = LogisticRegression(C=Cc, max_iter=5000, tol=1e-8).fit(sc.transform(Xtr), mc[tr])
            qA, qB = m.predict_proba(sc.transform(XA)), m.predict_proba(sc.transform(XB))
            rows = (yr == v) & dec_ok
            for q, out in (((qA, qB), a), ((qinc[0], qinc[1]), b)):
                qq = np.where((ws[rows] == 0)[:, None], q[0][rows], q[1][rows])
                out.append(-np.log(qq[np.arange(rows.sum()), mc[rows]]))
            e.append(T["event"].to_numpy()[rows])
        return np.concatenate(a), np.concatenate(b), np.concatenate(e)
    best = {}
    for use_eb in (False, True):
        for k in ((4.0, 8.0, 16.0) if use_eb else (0.0,)):
            for Cc in (0.0007, 0.001, 0.0015, 0.002):
                s = cv((2016, 2017, 2018, 2019), k, Cc, use_eb)[0].mean()
                if use_eb not in best or s < best[use_eb][0]:
                    best[use_eb] = (s, k, Cc)
    res = {}
    for use_eb in (False, True):
        _, k, Cc = best[use_eb]
        res[use_eb] = cv((2020, 2021, 2022, 2023), k, Cc, use_eb)
        print("choice on 2016-19: EB %s k %g C %g -> 2020-23 method given winner %.5f (S2+ml2win %.5f, n %d)" % (
            use_eb, k, Cc, res[use_eb][0].mean(), res[use_eb][1].mean(), len(res[use_eb][0])))
    a1, b1, ev = res[True]
    a0 = res[False][0]
    print("own conditional + EB  - S2+ml2win: %s" % fmt(boot(a1 - b1, ev)))
    print("own conditional no EB - S2+ml2win: %s" % fmt(boot(a0 - b1, ev)))
    print("own EB block                     : %s" % fmt(boot(a1 - a0, ev)))


# ---------------------------------------------------------------------- lookahead / corner (builder's model code)
def cmd_lookahead():
    sys.path.insert(0, HERE)
    import finishing as FN
    base, feats = FN.load("base.pkl"), FN.load("feats.pkl")
    pc = FN.production_cfgs()
    f0 = pc["filter"]
    D = dt.date(2022, 7, 1).toordinal()

    def build(fe):
        filt, _ = FN.run_filter(fe, base, f0["sigma0"], f0["tau"])
        fd = FN.FoldData(base, fe, 2022, filt, FN.cardio_block(fe, base), use_pre=pc["use_pre"])
        return (FN.oof_method(base, {2022: fd}, [2022], pc["method"]), FN.oof_round(base, {2022: fd}, [2022], pc["round"]),
                np.stack([fd.U[r] for r in fd.U], 0))
    P0, H0, U0 = build(feats)
    fp = dict(feats)
    E = feats["E"].copy()
    late = E["day"].to_numpy() >= D
    rng = np.random.default_rng(5)
    for a, b in (("w_ko", "l_ko"), ("w_sub", "l_sub"), ("w_dec", "l_dec"), ("w_r1", "l_r1"), ("w_late", "l_late")):
        va, vb = E.loc[late, a].to_numpy().copy(), E.loc[late, b].to_numpy().copy()
        E.loc[late, a], E.loc[late, b] = vb, va
    for c in ("c_m1", "c_l1", "c_mL", "c_lL", "c_om1", "c_ol1", "c_omL", "c_olL"):
        E.loc[late, c] = rng.random(late.sum()) * 50
    fp["E"] = E
    fp["seq"] = [(a, b, d, y, dv, {"A": "B", "B": "A"}.get(w, w), {0: 1, 1: 2, 2: 0}.get(bh, bh)) + (fid,)
                 if d >= D else (a, b, d, y, dv, w, bh, fid) for (a, b, d, y, dv, w, bh, fid) in feats["seq"]]
    P1, H1, U1 = build(fp)
    T = base["T"]
    day = np.array([d.toordinal() for d in T["date"]])
    yr = T["year"].to_numpy()
    pre, post = (yr == 2022) & (day <= D), (yr == 2022) & (day > D)
    print("fold 2022, outcomes/stats from 2022-07-01 on perturbed: rows on/before %d max |dP6| %.2g |dH| %.2g |dEB| %.2g;"
          " rows after %d max |dP6| %.3g |dEB| %.3g (must move)" % (
              pre.sum(), np.abs(P1[pre] - P0[pre]).max(), np.abs(H1[pre] - H0[pre]).max(), np.abs(U1[:, pre] - U0[:, pre]).max(),
              post.sum(), np.abs(P1[post] - P0[post]).max(), np.abs(U1[:, post] - U0[:, post]).max()))
    FD = FN.get_folds(base, feats, f0, pc["use_pre"], years=(2024,))
    w = yr >= 2024
    J = FN.MR.joint_from_c6(FN.oof_method(base, FD, [2024], pc["method"])[w], FN.oof_round(base, FD, [2024], pc["round"])[w],
                            base["draw_c"])
    ex = json.load(open(os.path.join(ROOT, "data/derived/finishing.json")))["fights"]
    mx, n = 0.0, 0
    for i, c in zip(np.flatnonzero(w), J):
        r = ex.get(T["id"].iat[i])
        if r is None:
            continue
        R = r["rounds"]
        comp = list(c[0:R]) + list(c[5:5 + R]) + list(c[10:10 + R]) + list(c[15:15 + R]) + list(c[20:23])
        mx, n = max(mx, float(np.abs(np.array(comp) - np.array(r["cells"])).max())), n + 1
    print("exported 2024-25 cells vs a fresh fit on fights < 2024: %d fights, max |diff| %.1g (export rounds to 1e-5;"
          " nothing scored)" % (n, mx))


def cmd_corner():
    sys.path.insert(0, HERE)
    import finishing as FN
    base, feats = FN.load("base.pkl"), FN.load("feats.pkl")
    pc = FN.production_cfgs()
    FD = FN.get_folds(base, feats, pc["filter"], pc["use_pre"], years=FN.GRID_YEARS)
    orig = FN.design

    def flagged(fd, o, spec):
        X = orig(fd, o, spec)
        return np.hstack([X, np.full((len(X), 1), 1.0 if o == 0 else 0.0)])
    rows = FN.rows_of(base, FN.CV_YEARS)
    P0 = FN.oof_method(base, FD, FN.CV_YEARS, pc["method"])
    FN.design = flagged
    P1 = FN.oof_method(base, FD, FN.CV_YEARS, pc["method"])
    _, _, mdl = FN.cm_fold(FD[2023], base, pc["method"]["spec"], pc["method"]["C"], pc["method"]["start"], None,
                           pc["method"]["hl"])
    FN.design = orig
    L0 = FN.losses(base, FN.joint(base, P0, base["H"], rows), rows)
    L1 = FN.losses(base, FN.joint(base, P1, base["H"], rows), rows)
    for m in ("bin7", "method_given_winner"):
        print("%s 2020-23: symmetric production model %.5f, + free corner flag %.5f (diff %+.5f)" % (
            m, np.nanmean(L0[m]), np.nanmean(L1[m]), np.nanmean(L1[m] - L0[m])))
    print("corner-flag coefficients (KO, SUB, DEC; standardized), fold 2023:", np.round(mdl.lr.coef_[:, -1], 4))


if __name__ == "__main__":
    cmds = {"score": cmd_score, "gate": cmd_gate, "rounds": cmd_rounds, "eb": cmd_eb, "lookahead": cmd_lookahead,
            "corner": cmd_corner}
    if len(sys.argv) != 2 or sys.argv[1] not in cmds:
        raise SystemExit(__doc__)
    cmds[sys.argv[1]]()
