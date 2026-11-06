"""Walk-forward strength of schedule (opponent quality) for the styles_sos engine component (sub-flag b).

Run from the project root:

    python3 tools/sos_wf.py build              # dev build: fights before 2026-01-01 only (hidden-data protocol)
    python3 tools/sos_wf.py rows               # 2019-2023 rate-level rows (actual stats + SOS) for the fit
    python3 tools/sos_wf.py fit <offsets.json> # Poisson / binomial fits of the SOS coefficients, 2019-2023 only

What it measures. A fighter's decayed career rates are measured against the opponents he happened to face. For
every UFC fight (chronological walk over data/raw, the same parse as tools/build_db.py), each opponent Y's
pre-fight shrunk rates against the division prior of that fight's year (priors_asof: fights in the 5 years before
Jan 1 of the year) give two quality vectors:

    allowed by Y (what X's offense faced):  a = [dAtt, acc, tdAtt, tdAcc, kd]
        dAtt  log( shr(od_att, distMin, L_dAtt, 40 L_dist) / L_dAtt )        distance attempts allowed per distance minute
        acc   logit( shr(od_lnd, od_att, acc_d, 150) ) - logit(acc_d)        distance accuracy allowed (log-odds)
        tdAtt log( shr(otd_att, standMin, L_tdAtt, 45 L_stand) / L_tdAtt )   takedown attempts allowed per standing minute
        tdAcc logit( shr(otd_lnd, otd_att, td_acc, 12) ) - logit(td_acc)     takedown success allowed (log-odds)
        kd    log( shr(okd, oh_lnd, kd_per_h, 230) / kd_per_h )              chin (KD absorbed per head strike absorbed)
    produced by Y (what X's defense faced):  o = [dAtt, acc, tdAtt, tdAcc, kd] from Y's own d_att, d_lnd/d_att,
        td_att, td_lnd/td_att, kd/h_lnd with the same shrinkage

(shrinkage constants and exposure estimates mirror src/engine3.js fighterRates: kPM 40, kAcc 150, kTdPM 45,
kTdAcc 12, kKD 230, ground share of control 0.84). X accumulates, with the same 730-day half-life as the profile
sums S, the exposure-weighted sums num += w * q and den += w, where w is X's exposure for that stat in the fight
(offense: distance minutes, own distance attempts, standing minutes, own takedown attempts, own head strikes landed;
defense: distance minutes, opponents' distance attempts, standing minutes, opponents' takedown attempts, head strikes
landed on him). The stored pair per stat is [q, w] = [num / den, den], frozen before each fight. The engine turns it
into a bias of the shrunk rate, q * w / (w + k), with k the engine's own prior strength (kPM L_dist, kAcc, kTdPM
L_stand, kTdAcc, kKD), and multiplies the matchup rate by exp(beta_a * bias_a(X) + beta_o * bias_o(Y)) with the
coefficients fit here on 2019-2023 (one-step strength of schedule; the opponents' own rates are not re-adjusted).

Outputs: data/derived/sos_wf.json (per backtest fight id: pre-fight [q, w] for both corners; meta with the
coefficients). Leakage: the walk only ever uses fights before the one being recorded; the dev build drops every fight
dated 2026-01-01 or later right after parsing, so no vault fight is read; coefficients use 2019-2023 rows only.
"""
import argparse
import datetime as dt
import json
import math
import os
import sys
import time
from collections import defaultdict

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_db as B  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PATH = os.path.join(ROOT, "data", "derived", "sos_wf.json")
HALF_LIFE = 730.0
GS = 0.84
STATS = ["dAtt", "acc", "tdAtt", "tdAcc", "kd"]
KI = B.KI


def shr(ev, ex, prior, k):
    return (ev + k * prior) / (max(0.0, ex) + k)


def logit(p):
    p = min(max(p, 1e-6), 1 - 1e-6)
    return math.log(p / (1 - p))


def quality(S, P):
    """allowed (a) and produced (o) quality vectors of one fighter's pre-fight sums S against prior P"""
    g = lambda k: float(S[KI[k]])
    m = g("min")
    cf = P["ctrl"] / 60.0
    Ldist = max(0.1, 1 - 2 * cf)
    Lstand = max(0.2, 1 - 2 * cf * GS)
    ctl = (g("ctrl") + g("octrl")) / 60.0
    dm = max(0.25 * m, m - ctl)
    sm = max(0.3 * m, m - ctl * GS)
    LdAtt = P["d_att"] / Ldist
    LtdAtt = P["td_att"] / Lstand
    a0, t0, k0 = P["acc_d"], P["td_acc"], P["kd_per_h"]
    a = [math.log(shr(g("od_att"), dm, LdAtt, 40 * Ldist) / LdAtt),
         logit(shr(g("od_lnd"), g("od_att"), a0, 150)) - logit(a0),
         math.log(shr(g("otd_att"), sm, LtdAtt, 45 * Lstand) / LtdAtt),
         logit(shr(g("otd_lnd"), g("otd_att"), t0, 12)) - logit(t0),
         math.log(shr(g("okd"), g("oh_lnd"), k0, 230) / k0)]
    o = [math.log(shr(g("d_att"), dm, LdAtt, 40 * Ldist) / LdAtt),
         logit(shr(g("d_lnd"), g("d_att"), a0, 150)) - logit(a0),
         math.log(shr(g("td_att"), sm, LtdAtt, 45 * Lstand) / LtdAtt),
         logit(shr(g("td_lnd"), g("td_att"), t0, 12)) - logit(t0),
         math.log(shr(g("kd"), g("h_lnd"), k0, 230) / k0)]
    return a, o


def exposures(v):
    """offense and defense weights of one fighter's own fight vector v"""
    g = lambda k: float(v[KI[k]])
    m = g("min")
    ctl = (g("ctrl") + g("octrl")) / 60.0
    dm = max(0.25 * m, m - ctl)
    sm = max(0.3 * m, m - ctl * GS)
    off = [dm, g("d_att"), sm, g("td_att"), g("h_lnd")]
    dfn = [dm, g("od_att"), sm, g("otd_att"), g("oh_lnd")]
    return off, dfn


def load_fights(until):
    log = {}
    fights, _ = B.parse_fights(log)
    n_all = len(fights)
    fights = [f for f in fights if f.date < until]          # nothing on or after the cutoff is processed further
    print("parsed %d fights; kept %d before %s" % (n_all, len(fights), until.isoformat()))
    people = B.build_people(fights, log)
    B.build_vectors(fights, log)
    return fights, people


def priors_by_year(fights, years, window=5):
    return {y: B.build_priors(fights, dt.date(y - window, 1, 1), dt.date(y, 1, 1)) for y in years}


def prior_for(PA, f, homes):
    P = PA.get(f.date.year) or {}
    if "ALL" not in P:      # the first UFC years have no 5-year window: borrow the earliest year that has one
        P = next((PA[y] for y in sorted(PA) if "ALL" in PA[y]), {})
    div = f.division
    if div in B.NON_DIV:
        hs = [h for h in homes if B.LBS.get(h)]
        if hs:
            div = max(hs, key=lambda d: B.LBS[d])
    return P.get(div) or P.get("ALL")


def walk(fights, PA, record_from, half_life=HALF_LIFE):
    lam = math.log(2) / half_life
    st = defaultdict(lambda: {"S": np.zeros(B.NK), "t": None, "n": 0, "hist": [],
                              "na": np.zeros(5), "da": np.zeros(5), "no": np.zeros(5), "do": np.zeros(5)})
    rec, rows = {}, []

    def decay(s, day):
        if s["t"] is not None and day > s["t"]:
            fac = math.exp(-lam * (day - s["t"]))
            for k in ("S", "na", "da", "no", "do"):
                s[k] *= fac
        s["t"] = day if s["t"] is None else max(s["t"], day)

    def pair(s, which):
        n, d = (s["na"], s["da"]) if which == "a" else (s["no"], s["do"])
        return [[round(float(n[i] / d[i]), 5) if d[i] > 0 else 0.0, round(float(d[i]), 3)] for i in range(5)]

    for f in fights:
        a, b = f.persons
        if a == b:
            continue
        sa, sb = st[a], st[b]
        decay(sa, f.day)
        decay(sb, f.day)
        homes = [B.mode_recent(sa["hist"], f.day), B.mode_recent(sb["hist"], f.day)]
        if (f.date >= record_from and sa["n"] >= 1 and sb["n"] >= 1
                and not a.startswith("amb:") and not b.startswith("amb:")):
            rec[f.fid] = {"date": f.date.isoformat(),
                          "A": {"a": pair(sa, "a"), "o": pair(sa, "o"), "S_min": round(float(sa["S"][KI["min"]]), 3)},
                          "B": {"a": pair(sb, "a"), "o": pair(sb, "o"), "S_min": round(float(sb["S"][KI["min"]]), 3)}}
            if f.stats:
                rows.append((f, [pair(sa, "a"), pair(sa, "o")], [pair(sb, "a"), pair(sb, "o")]))
        if f.stats:
            P = prior_for(PA, f, homes)
            qa, qo = quality(sa["S"], P)       # A's pre-fight quality (what B faced)
            qb_a, qb_o = quality(sb["S"], P)   # B's pre-fight quality (what A faced)
            for s, me, opp_a, opp_o in ((0, sa, qb_a, qb_o), (1, sb, qa, qo)):
                off, dfn = exposures(f.stats["v"][s])
                for i in range(5):
                    me["na"][i] += off[i] * opp_a[i]
                    me["da"][i] += off[i]
                    me["no"][i] += dfn[i] * opp_o[i]
                    me["do"][i] += dfn[i]
        for s, stt in ((0, sa), (1, sb)):
            if f.stats:
                stt["S"] += f.stats["v"][s]
            stt["n"] += 1
            stt["hist"].append((f.day, f.division))
    return rec, rows, st


def cmd_build(args):
    t0 = time.time()
    until = dt.date.fromisoformat(args.until)
    if until > dt.date(2026, 1, 1) and not args.production:
        raise SystemExit("--until after 2026-01-01 reads vault fights; pass --production for the release build only")
    fights, people = load_fights(until)
    years = sorted({f.date.year for f in fights})
    PA = priors_by_year(fights, years)
    rec, rows, st = walk(fights, PA, dt.date(2019, 1, 1))
    old = {}
    if os.path.exists(OUT_PATH):
        try:
            old = json.load(open(OUT_PATH)).get("meta", {})
        except Exception:
            old = {}
    meta = {
        "name": "walk-forward strength of schedule (styles_sos component, sub-flag b)",
        "built": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "until": until.isoformat(), "half_life_days": HALF_LIFE, "stats": STATS,
        "pair": "[q, w]: exposure-weighted mean opponent quality (log ratio or log-odds vs the division prior of each "
                "fight's year) and its decayed exposure; 'a' = what his opponents allowed (faced by his offense), "
                "'o' = what his opponents produced (faced by his defense); frozen before the fight",
        "weights": {"offense": ["distance minutes", "own distance attempts", "standing minutes", "own takedown attempts",
                                "own head strikes landed"],
                    "defense": ["distance minutes", "opponents' distance attempts", "standing minutes",
                                "opponents' takedown attempts", "head strikes landed on him"]},
        "n_fights": len(rec), "source": "tools/sos_wf.py build (data/raw via tools/build_db.py parse)",
    }
    for k in ("coef", "coef_loyo", "fit"):
        if k in old:
            meta[k] = old[k]
    roster = None
    if args.roster:
        snap_day = fights[-1].day
        lam = math.log(2) / HALF_LIFE
        roster = {}
        for p, s in st.items():
            if p.startswith("amb:") or s["t"] is None:
                continue
            fac = math.exp(-lam * (snap_day - s["t"]))
            slug = people[p]["slug"] if p in people else p
            roster[slug] = {"a": [[round(float(s["na"][i] / s["da"][i]), 5) if s["da"][i] > 0 else 0.0,
                                   round(float(s["da"][i] * fac), 3)] for i in range(5)],
                            "o": [[round(float(s["no"][i] / s["do"][i]), 5) if s["do"][i] > 0 else 0.0,
                                   round(float(s["do"][i] * fac), 3)] for i in range(5)]}
        meta["roster_asof"] = fights[-1].date.isoformat()
    out = {"meta": meta, "fights": rec}
    if roster is not None:
        out["roster"] = roster
    B.write_json(OUT_PATH, out)
    # rate-level rows for the fit (2019-2023 only)
    if args.rows:
        dump_rows(rows, args.rows)
    print("wrote %s: %d fights%s in %.1f s" % (OUT_PATH, len(rec), (", %d roster" % len(roster)) if roster else "",
                                                time.time() - t0))


def dump_rows(rows, path):
    out = []
    for f, sa, sb in rows:
        if not (dt.date(2019, 1, 1) <= f.date < dt.date(2024, 1, 1)):
            continue
        for s, me, opp in ((0, sa, sb), (1, sb, sa)):
            v = f.stats["v"][s]
            g = lambda k: float(v[KI[k]])
            out.append({"id": f.fid, "event": f.event, "year": f.date.year, "side": "AB"[s], "min": g("min"),
                        "d_att": g("d_att"), "d_lnd": g("d_lnd"), "td_att": g("td_att"), "td_lnd": g("td_lnd"),
                        "kd": g("kd"), "h_lnd": g("h_lnd"), "c_att": g("c_att"), "g_att": g("g_att"),
                        "ctrl": g("ctrl"), "octrl": g("octrl"),
                        "qa_x": me[0], "qo_y": opp[1]})
    with open(path, "w") as fh:
        json.dump(out, fh)
    print("wrote %d rate rows (2019-2023) to %s" % (len(out), path))


# ------------------------------------------------------------------ fit
def irls(X, y, off, fam, expo=None, ridge=1e-6, it=50):
    """Poisson (log link, exposure folded into off) or binomial (logit, y successes of expo trials) GLM"""
    n, p = X.shape
    beta = np.zeros(p)
    for _ in range(it):
        eta = off + X @ beta
        if fam == "poisson":
            mu = np.exp(np.clip(eta, -30, 30))
            W = mu
            z = eta - off + (y - mu) / np.maximum(mu, 1e-12)
        else:
            pr = 1 / (1 + np.exp(-np.clip(eta, -30, 30)))
            mu = expo * pr
            W = np.maximum(expo * pr * (1 - pr), 1e-12)
            z = eta - off + (y - mu) / W
        H = X.T @ (W[:, None] * X) + ridge * np.eye(p)
        nb = np.linalg.solve(H, X.T @ (W * z))
        if np.max(np.abs(nb - beta)) < 1e-10:
            beta = nb
            break
        beta = nb
    return beta


def dev_terms(X, y, off, fam, beta, expo=None):
    eta = off + X @ beta
    if fam == "poisson":
        mu = np.exp(np.clip(eta, -30, 30))
        with np.errstate(divide="ignore", invalid="ignore"):
            t = np.where(y > 0, y * np.log(y / mu), 0.0) - (y - mu)
        return 2 * t
    pr = np.clip(1 / (1 + np.exp(-np.clip(eta, -30, 30))), 1e-9, 1 - 1e-9)
    with np.errstate(divide="ignore", invalid="ignore"):
        t1 = np.where(y > 0, y * np.log(y / (expo * pr)), 0.0)
        t2 = np.where(expo - y > 0, (expo - y) * np.log((expo - y) / (expo * (1 - pr))), 0.0)
    return 2 * (t1 + t2)


def sandwich_se(X, y, off, fam, beta, clusters, expo=None):
    eta = off + X @ beta
    if fam == "poisson":
        mu = np.exp(np.clip(eta, -30, 30))
        W = mu
        r = y - mu
    else:
        pr = 1 / (1 + np.exp(-np.clip(eta, -30, 30)))
        W = expo * pr * (1 - pr)
        r = y - expo * pr
    H = X.T @ (W[:, None] * X)
    Hi = np.linalg.inv(H)
    sc = X * r[:, None]
    G = defaultdict(lambda: np.zeros(X.shape[1]))
    for c, s in zip(clusters, sc):
        G[c] += s
    M = sum(np.outer(g, g) for g in G.values())
    V = Hi @ M @ Hi
    return np.sqrt(np.diag(V))


def cmd_fit(args):
    rows = json.load(open(args.rows))
    offs = json.load(open(args.offsets))
    sos = json.load(open(OUT_PATH))
    # engine prior strengths for the bias q * w / (w + k): kPM L_dist (about 24 distance minutes), kAcc, kTdPM L_stand
    # (about 32 standing minutes), kTdAcc, kKD; L_dist / L_stand use the league control share (about 0.2 of a minute
    # each way), the same constants src/styles_sos.js uses
    K = [40 * 0.62, 150.0, 45 * 0.72, 12.0, 230.0]
    res = {"K": K, "stats": {}}
    rng = np.random.default_rng(20261106)
    for path in ("ml", "base"):
        res["stats"][path] = {}
        for si, st in enumerate(STATS):
            Y, OFF, EX, XA, XO, CL, YR = [], [], [], [], [], [], []
            for r in rows:
                o = offs.get(r["id"], {}).get(path, {}).get(r["side"])
                if not o:
                    continue
                qa, wa = r["qa_x"][si]
                qo, wo = r["qo_y"][si]
                ba = qa * wa / (wa + K[si])
                bo = qo * wo / (wo + K[si])
                if st == "dAtt":
                    if r["min"] <= 0:
                        continue
                    y, off, ex = r["d_att"], math.log(max(o["d_att"], 1e-6) * r["min"]), None
                elif st == "tdAtt":
                    if r["min"] <= 0:
                        continue
                    y, off, ex = r["td_att"], math.log(max(o["td_att"], 1e-6) * r["min"]), None
                elif st == "acc":
                    if r["d_att"] <= 0:
                        continue
                    y, off, ex = r["d_lnd"], logit(o["acc_d"]), r["d_att"]
                elif st == "tdAcc":
                    if r["td_att"] <= 0:
                        continue
                    y, off, ex = r["td_lnd"], logit(o["td_acc"]), r["td_att"]
                else:
                    if r["h_lnd"] <= 0:
                        continue
                    y, off, ex = r["kd"], logit(o["kd_h"]), r["h_lnd"]
                Y.append(y); OFF.append(off); EX.append(ex); XA.append(ba); XO.append(bo); CL.append(r["id"])
                YR.append(r["year"])
            fam = "poisson" if st in ("dAtt", "tdAtt") else "binomial"
            Y, OFF, XA, XO, YR = map(np.array, (Y, OFF, XA, XO, YR))
            EX = np.array(EX, dtype=float) if fam == "binomial" else None
            one = np.ones(len(Y))
            X0 = one[:, None]
            X1 = np.column_stack([one, XA, XO])
            b0 = irls(X0, Y, OFF, fam, EX)
            b1 = irls(X1, Y, OFF, fam, EX)
            se = sandwich_se(X1, Y, OFF, fam, b1, CL, EX)
            # leave-one-year-out CV deviance change (per fight-side terms, for a fight bootstrap)
            dterm = np.zeros(len(Y))
            loyo = {}
            for yv in sorted(set(YR.tolist())):
                tr, te = YR != yv, YR == yv
                e_tr = EX[tr] if EX is not None else None
                e_te = EX[te] if EX is not None else None
                c0 = irls(X0[tr], Y[tr], OFF[tr], fam, e_tr)
                c1 = irls(X1[tr], Y[tr], OFF[tr], fam, e_tr)
                loyo[str(yv)] = [float(c1[1]), float(c1[2]), float(XA[tr].mean()), float(XO[tr].mean())]
                dterm[te] = (dev_terms(X1[te], Y[te], OFF[te], fam, c1, e_te)
                             - dev_terms(X0[te], Y[te], OFF[te], fam, c0, e_te))
            # fight-clustered bootstrap of the CV deviance change
            ids = np.array(CL)
            uniq, inv = np.unique(ids, return_inverse=True)
            per = np.bincount(inv, weights=dterm, minlength=len(uniq))
            boots = []
            for _ in range(2000):
                pick = rng.integers(0, len(uniq), len(uniq))
                boots.append(per[pick].sum())
            lo, hi = np.percentile(boots, [2.5, 97.5])
            res["stats"][path][st] = {
                "n": int(len(Y)), "family": fam, "intercept_only": float(b0[0]),
                "beta_a": float(b1[1]), "beta_o": float(b1[2]), "se_a": float(se[1]), "se_o": float(se[2]),
                "z_a": float(b1[1] / se[1]), "z_o": float(b1[2] / se[2]),
                "cv_dev_change": float(dterm.sum()), "cv_ci": [float(lo), float(hi)], "loyo": loyo,
                "sd_bias_a": float(np.std(XA)), "sd_bias_o": float(np.std(XO)),
                "center": [float(XA.mean()), float(XO.mean())],
            }
            print("%-4s %-5s n=%5d beta_a %+.3f (z %+.2f)  beta_o %+.3f (z %+.2f)  CV dev %+8.1f [%+.1f, %+.1f]  sd(bias) %.3f/%.3f"
                  % (path, st, len(Y), b1[1], b1[1] / se[1], b1[2], b1[2] / se[2], dterm.sum(), lo, hi,
                     np.std(XA), np.std(XO)))
    # coefficient rows are [beta_a, beta_o, center_a, center_o]: the engine uses beta_a (bias_a - center_a) + beta_o
    # (bias_o - center_o), so the league level the engine was calibrated to is kept on average.
    # selection rule (pre-registered, 2019-2023 only): a stat's adjustment is on for a path when its LOYO CV deviance
    # change has a fight-bootstrap CI below zero; otherwise its coefficients are set to 0.
    coef, coef_loyo = {}, {}
    for path, d in res["stats"].items():
        coef[path], coef_loyo[path] = {}, {}
        for st, r in d.items():
            on = r["cv_ci"][1] < 0
            r["on"] = bool(on)
            ca, co = r["center"]
            coef[path][st] = ([round(r["beta_a"], 4), round(r["beta_o"], 4), round(ca, 5), round(co, 5)] if on
                              else [0.0, 0.0, 0.0, 0.0])
            for yv, c in r["loyo"].items():
                coef_loyo[path].setdefault(yv, {})[st] = ([round(c[0], 4), round(c[1], 4), round(c[2], 5), round(c[3], 5)]
                                                          if on else [0.0, 0.0, 0.0, 0.0])
    sos["meta"]["coef"] = coef
    sos["meta"]["coef_loyo"] = coef_loyo
    sos["meta"]["fit"] = {"K": K, "rule": "on when the 2019-2023 leave-one-year-out CV deviance change has a "
                                           "fight-bootstrap 95% CI below zero; LOYO tables for the ablation",
                          "stats": res["stats"]}
    B.write_json(OUT_PATH, sos)
    print("coefficients written to", OUT_PATH)
    print(json.dumps(coef))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build")
    b.add_argument("--until", default="2026-01-01", help="drop fights on or after this date right after parsing")
    b.add_argument("--production", action="store_true", help="allow --until after 2026-01-01 (release build only)")
    b.add_argument("--roster", action="store_true", help="also write the decayed table for every fighter (live use)")
    b.add_argument("--rows", default=None, help="write the 2019-2023 rate-level rows for the fit to this file")
    f = sub.add_parser("fit")
    f.add_argument("rows")
    f.add_argument("offsets")
    args = ap.parse_args()
    if args.cmd == "build":
        cmd_build(args)
    else:
        cmd_fit(args)


if __name__ == "__main__":
    main()
