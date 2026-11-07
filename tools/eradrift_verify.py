#!/usr/bin/env python3
"""Adversarial verification of tools/eradrift.py (task key: eradrift). Verifier's own code: fights, stats and judges'
cards are parsed straight from data/raw/ufc_fight_results.csv, ufc_event_details.csv and ufc_fight_stats.csv with
pandas (no build_db); 2026+ rows are dropped right after the event date is read. Trackers, scorers, the gate and the
card-cluster bootstrap are written here from scratch. Reads the builder's cache (ERA_CACHE or out/eradrift_cache) only
for the S2 + ML v2 winner fold cells (base.pkl, which `eradrift.py base` rebuilds bit-identically and which reproduce
ml2's CV numbers) and, in `decomp`, to call the builder's own tracker functions for an attribution split.

Run from the project root (nice -n 5; each stage takes seconds):

    python3 tools/eradrift_verify.py parse    # own league table; compare with the builder's league.pkl fight by fight
    python3 tools/eradrift_verify.py league   # own league trackers (win5 / EW / scalar EKF, one shared division
                                              #   layer): nested rolling-origin CV 2014-2023 vs win5, then 2024-25
    python3 tools/eradrift_verify.py decomp   # (a) KO / KD / sub-attempt gains split into league level vs division
                                              #   layer with the builder's functions; (b) glove-period table from the own
                                              #   parse; (c) method-universe decision excess by glove period
    python3 tools/eradrift_verify.py gate     # own decision-vs-finish tracker on S2 + ML v2 winner, own 7-bin scorer,
                                              #   nested forward-chained gate 2021-2023 (0.0005 rule), swap test
    python3 tools/eradrift_verify.py stat     # own leg / clinch statline offsets (raw actuals, card clusters)
"""
import datetime as dt
import json
import math
import os
import pickle
import re
import sys

import numpy as np
import pandas as pd
from scipy.optimize import minimize_scalar
from scipy.special import gammaln

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW = os.path.join(ROOT, "data", "raw")
CACHE = os.environ.get("ERA_CACHE", os.path.join(ROOT, "out", "eradrift_cache"))
OUT = os.path.join(ROOT, "out", "eradrift_verify")
VAULT = dt.date(2026, 1, 1)
os.makedirs(OUT, exist_ok=True)


# ----------------------------------------------------------------------------------------------- own parse
def _of(s):
    m = re.match(r"\s*(\d+)\s+of\s+(\d+)", str(s))
    return (int(m.group(1)), int(m.group(2))) if m else (0, 0)


def _mmss(s):
    m = re.match(r"\s*(\d+):(\d+)", str(s))
    return int(m.group(1)) * 60 + int(m.group(2)) if m else 0


def _num(s):
    s = str(s).strip()
    return int(float(s)) if s not in ("", "--") else 0


def parse():
    ev = pd.read_csv(os.path.join(RAW, "ufc_event_details.csv"))
    edate = {}
    for e in ev.itertuples(index=False):
        try:
            edate[str(e.EVENT).strip()] = dt.datetime.strptime(str(e.DATE).strip(), "%B %d, %Y").date()
        except ValueError:
            pass
    res = pd.read_csv(os.path.join(RAW, "ufc_fight_results.csv"), dtype=str).fillna("")
    res["known"] = res["EVENT"].str.strip().isin(set(edate))
    res["ix"] = range(len(res))
    res = res.sort_values(["known", "ix"], ascending=[False, True]).drop_duplicates("URL").sort_values("ix")
    rows = []
    for r in res.itertuples(index=False):
        evn = r.EVENT.strip()
        d = edate.get(evn)
        if d is None or d >= VAULT:                # 2026+ dropped at parse
            continue
        fmt = r._7.strip()
        sched = {"3 Rnd (5-5-5)": 3, "5 Rnd (5-5-5-5-5)": 5}.get(fmt)
        if sched is None:
            continue
        m, out = r.METHOD.strip(), r.OUTCOME.strip()
        if out == "D/D":
            cls = "DRAW"
        elif out in ("W/L", "L/W"):
            cls = ("KO" if m.startswith("KO/TKO") or m.startswith("TKO - Doctor") else
                   "SUB" if m.startswith("Submission") else "DEC" if m.startswith("Decision") else "OTHER")
        else:
            cls = "OTHER"
        rnd = int(r.ROUND) if r.ROUND.strip().isdigit() else 1
        cards = [(int(a), int(b)) for a, b in re.findall(r"(\d+)\s*-\s*(\d+)\.", r.DETAILS)]
        n108 = jr = np.nan
        if cls in ("DEC", "DRAW") and len(cards) >= 3:
            n108 = jr = 0
            for a, b in cards[-3:]:
                nr = int(round((a + b) / 19.0))
                n108 += max(0, 19 * nr - (a + b))
                jr += nr
        rows.append({"fid": r.URL.strip().rsplit("/", 1)[-1], "event": evn, "bout": r.BOUT.strip(), "date": d,
                     "year": d.year, "day": d.toordinal(), "sched": sched, "cls": cls, "rnd": rnd,
                     "fight_s": (rnd - 1) * 300 + _mmss(r.TIME), "wc": r.WEIGHTCLASS.strip(), "n108": n108,
                     "jr": jr})
    F = pd.DataFrame(rows)
    assert F["date"].max() < VAULT
    st = pd.read_csv(os.path.join(RAW, "ufc_fight_stats.csv"), dtype=str).fillna("")
    st["EVENT"], st["BOUT"] = st["EVENT"].str.strip(), st["BOUT"].str.strip()
    keep = set(zip(F["event"], F["bout"]))
    agg = {}
    for r in st.itertuples(index=False):
        k = (r.EVENT, r.BOUT)
        if k not in keep:
            continue
        a = agg.setdefault(k, dict(sig_lnd=0, sig_att=0, h_lnd=0, kd=0, td_att=0, ctrl=0, sub_att=0))
        sl, sa = _of(r._5)
        a["sig_lnd"] += sl
        a["sig_att"] += sa
        a["h_lnd"] += _of(r.HEAD)[0]
        a["kd"] += _num(r.KD)
        a["td_att"] += _of(r.TD)[1]
        a["ctrl"] += _mmss(r.CTRL)
        a["sub_att"] += _num(r._10)
    for c in ("sig_lnd", "sig_att", "h_lnd", "kd", "td_att", "ctrl", "sub_att"):
        F["s_" + c] = [agg.get(k, {}).get(c, np.nan) for k in zip(F["event"], F["bout"])]
    has = np.array([k in agg for k in zip(F["event"], F["bout"])])
    F["fmin"] = np.where(has & (F["fight_s"] > 0), 2.0 * F["fight_s"] / 60.0, np.nan)
    return F.sort_values(["day", "event"]).reset_index(drop=True)


def own_table():
    p = os.path.join(OUT, "fights.pkl")
    if not os.path.exists(p):
        parse().to_pickle(p)
    return pd.read_pickle(p)


def stage_parse():
    F = parse()
    F.to_pickle(os.path.join(OUT, "fights.pkl"))
    F = F[F["year"] >= 2001]
    L = pd.read_pickle(os.path.join(CACHE, "league.pkl"))
    print("own table: %d fights 2001-01-01..%s; builder league.pkl: %d" % (len(F), F["date"].max(), len(L)))
    m = F.merge(L, on="fid", how="outer", suffixes=("", "_b"), indicator=True)
    print("join:", m["_merge"].value_counts().to_dict())
    b = m[m["_merge"] == "both"]
    print("class mismatches %d, format mismatches %d" % ((b["cls"] != b["cls_b"]).sum(), (b["sched"] != b["sched_b"]).sum()))
    for c in ("sig_lnd", "sig_att", "h_lnd", "kd", "td_att", "ctrl", "sub_att"):
        x, y = b["s_" + c].astype(float), b["s_" + c + "_b"].astype(float)
        print("  %-8s mismatches %d" % (c, int((np.abs(x - y) > 1e-9).sum())))
    print("  fmin     mismatches %d" % int((np.abs(b["fmin"] - b["s_fmin"]) > 1e-9).sum()))
    for c in ("n108", "jr"):
        x, y = b[c].astype(float), b[c + "_b"].astype(float)
        print("  %-8s mismatches %d (both present %d)" % (c, int((np.abs(x - y) > 1e-9).sum()), int((x.notna() & y.notna()).sum())))
    ro = m[m["_merge"] == "right_only"]
    print("builder-only fights (own parse drops them): %d, by year %s, classes %s" % (
        len(ro), ro["year_b"].value_counts().sort_index().to_dict(), ro["cls_b"].value_counts().to_dict()))


# ----------------------------------------------------------------------------------------------- shared helpers
def boot(diff, cl, B=2000, seed=1):
    diff = np.asarray(diff, float)
    c = pd.factorize(np.asarray(cl))[0]
    nc = c.max() + 1
    s = np.bincount(c, weights=diff, minlength=nc)
    n = np.bincount(c, minlength=nc).astype(float)
    rng = np.random.default_rng(seed)
    bs = np.empty(B)
    for i in range(B):
        w = np.bincount(rng.integers(0, nc, nc), minlength=nc)
        bs[i] = (w * s).sum() / (w * n).sum()
    return float(diff.mean()), float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5))


def nbll(y, mu, k):
    return gammaln(y + k) - gammaln(k) - gammaln(y + 1) + k * np.log(k / (k + mu)) + y * np.log(mu / (k + mu))


def _division(wc):
    w = wc.replace("UFC ", "").replace("Interim ", "").replace(" Title", "").replace(" Bout", "")
    for d in ("Women's Strawweight", "Women's Flyweight", "Women's Bantamweight", "Women's Featherweight",
              "Light Heavyweight", "Heavyweight", "Middleweight", "Welterweight", "Lightweight", "Featherweight",
              "Bantamweight", "Flyweight", "Strawweight"):
        if d in w:
            return d
    return "ALL"


# ----------------------------------------------------------------------------------------------- league trackers
def stage_league():
    F = own_table()
    F = F[F["year"] >= 2001].reset_index(drop=True)
    F["div"] = F["wc"].map(_division)
    oc = F["cls"].isin(["KO", "SUB", "DEC", "DRAW"]).to_numpy()
    st = F["fmin"].notna().to_numpy()
    fm = F["fmin"].to_numpy(float)
    TG = {"dec": ("bin", oc, F["cls"].isin(["DEC", "DRAW"]).to_numpy(float), np.ones(len(F))),
          "ko": ("bin", oc, (F["cls"] == "KO").to_numpy(float), np.ones(len(F))),
          "kd100": ("cnt", st & (F["s_h_lnd"] > 0).to_numpy(), F["s_kd"].to_numpy(float), F["s_h_lnd"].to_numpy(float)),
          "slpm": ("cnt", st, F["s_sig_lnd"].to_numpy(float), fm),
          "sapm": ("cnt", st, F["s_sig_att"].to_numpy(float), fm),
          "tdpm": ("cnt", st, F["s_td_att"].to_numpy(float), fm),
          "ctrlpm": ("cnt", st, F["s_ctrl"].to_numpy(float), fm),
          "subpm": ("cnt", st, F["s_sub_att"].to_numpy(float), fm),
          "r108": ("cnt", F["jr"].notna().to_numpy(), F["n108"].to_numpy(float), F["jr"].to_numpy(float))}
    print("league level trackers with ONE shared division layer (trailing 5-year division/league ratio, 30 obs);"
          " loss per fight, nested = chosen on 2012..Y-1, scored on Y")
    for key, (kind, mask, y, E) in TG.items():
        m = mask & np.isfinite(y) & np.isfinite(E) & (E > 0)
        d = {"y": y[m], "E": E[m], "year": F["year"].to_numpy()[m], "day": F["day"].to_numpy()[m],
             "event": F["event"].to_numpy()[m], "div": F["div"].to_numpy()[m]}
        pre = d["year"] < 2012
        prior = d["y"][pre].sum() / d["E"][pre].sum()
        k = None
        if kind == "cnt":
            mu = d["E"][pre] * prior
            k = float(np.clip((mu ** 2).sum() / max(((d["y"][pre] - mu) ** 2 - mu).sum(), 1e-9), 0.5, 1e6))
        lg = lambda p: np.log(p / (1 - p))
        fac = np.zeros(len(d["y"])) if kind == "bin" else np.ones(len(d["y"]))
        for Y in np.unique(d["year"]):
            w = (d["year"] >= Y - 5) & (d["year"] < Y)
            if not w.any():
                continue
            pL, Eb = d["y"][w].sum() / d["E"][w].sum(), d["E"][w].mean()
            for g in np.unique(d["div"][d["year"] == Y]):
                if g == "ALL":
                    continue
                ww = w & (d["div"] == g)
                pD = (d["y"][ww].sum() + 30 * pL * Eb) / (d["E"][ww].sum() + 30 * Eb)
                mm = (d["year"] == Y) & (d["div"] == g)
                fac[mm] = (lg(pD) - lg(pL)) if kind == "bin" else pD / pL
        Eb = d["E"].mean()
        P = {}
        p = np.empty(len(d["y"]))
        for Y in np.unique(d["year"]):
            w = (d["year"] >= Y - 5) & (d["year"] < Y)
            p[d["year"] == Y] = (d["y"][w].sum() + 5 * prior * Eb) / (d["E"][w].sum() + 5 * Eb)
        P["win5"] = p
        days = np.unique(d["day"])
        for h in (0.25, 0.5, 1, 2, 3, 5):
            lam, Sy, SE, last, p = math.log(2) / (h * 365.25), 0.0, 0.0, None, np.empty(len(d["y"]))
            for dd in days:
                ii = np.where(d["day"] == dd)[0]
                if last is not None:
                    a = math.exp(-lam * (dd - last))
                    Sy, SE = Sy * a, SE * a
                p[ii] = (Sy + 5 * prior * Eb) / (SE + 5 * Eb)
                Sy, SE, last = Sy + d["y"][ii].sum(), SE + d["E"][ii].sum(), dd
            P["ew%g" % h] = p
        for q in ((0.002, 0.01, 0.03, 0.1, 0.3) if kind == "bin" else (0.0005, 0.002, 0.01, 0.03, 0.1)):
            x = float(lg(prior)) if kind == "bin" else math.log(prior)
            V, last, p = 1.0, None, np.empty(len(d["y"]))
            for dd in days:
                ii = np.where(d["day"] == dd)[0]
                if last is not None:
                    V += q * (dd - last) / 365.25
                p[ii] = 1 / (1 + math.exp(-x)) if kind == "bin" else math.exp(x)
                for e in np.unique(d["event"][ii]):
                    jj = ii[d["event"][ii] == e]
                    if kind == "bin":
                        pp = 1 / (1 + math.exp(-x))
                        g, H = (d["y"][jj] - pp).sum(), len(jj) * pp * (1 - pp)
                    else:
                        mu = d["E"][jj] * math.exp(x)
                        g, H = ((d["y"][jj] - mu) * k / (k + mu)).sum(), (mu * k / (k + mu)).sum()
                    x += V * g / (1 + V * H)
                    V = V / (1 + V * H)
                last = dd
            P["kal%g" % q] = p

        def loss(pL):
            if kind == "bin":
                pr = np.clip(1 / (1 + np.exp(-(lg(pL) + fac))), 1e-9, 1 - 1e-9)
                return -(d["y"] * np.log(pr) + (1 - d["y"]) * np.log(1 - pr))
            return -nbll(d["y"], np.maximum(d["E"] * pL * fac, 1e-12), k)
        Ls = {nm: loss(p) for nm, p in P.items()}
        yr = d["year"]
        tot = lambda nm, yrs: Ls[nm][np.isin(yr, yrs)].mean()
        nested = np.full(len(yr), np.nan)
        picks = set()
        for Y in range(2014, 2024):
            pk = min(Ls, key=lambda nm: tot(nm, list(range(2012, Y))))
            picks.add(pk)
            nested[yr == Y] = Ls[pk][yr == Y]
        cv = (yr >= 2014) & (yr <= 2023)
        r = boot(nested[cv] - Ls["win5"][cv], d["event"][cv])
        final = min(Ls, key=lambda nm: tot(nm, list(range(2012, 2024))))
        ho = yr >= 2024
        rh = boot(Ls[final][ho] - Ls["win5"][ho], d["event"][ho])
        print("%-7s nested - win5 %+.5f [%+.5f, %+.5f] picks %s | final %-8s 2024-25 final - win5 %+.5f [%+.5f, %+.5f]" % (
            key, r[0], r[1], r[2], sorted(picks), final, rh[0], rh[1], rh[2]))


# ----------------------------------------------------------------------------------------------- decomposition
def stage_decomp():
    sys.path.insert(0, HERE)
    os.environ.setdefault("ERA_CACHE", CACHE)
    import eradrift as E
    L = E.load("league.pkl")
    T = E.target_frames(L)
    tr = E.jload_c("trackers.json")
    print("(a) builder's trackers: chosen vs win5+div, then the same league tracker vs win5 with NO division layer, and"
          " a no-drift expanding mean with the EW division layer (descriptive on 2024-25: the look has happened)")
    for key, pairs in (("ko", [("ew(h=5)+div(3,30)", "win5+div(3,30)"), ("ew(h=5)", "win5"),
                               ("static+div(3,30)", "win5+div(3,30)")]),
                       ("kd100", [("ew(h=5)+div(10,30)", "win5+div(3,30)"), ("ew(h=5)", "win5"),
                                  ("static+div(10,30)", "win5+div(3,30)")]),
                       ("subpm", [("kal(q=0.03,se=0.1)+div(0.3,0.002)", "win5+div(3,150)"),
                                  ("kal(q=0.03,se=0.1)", "win5")]),
                       ("slpm", [("kal(q=0.002,se=0)+brk(vb=0.05)", "win5+div(3,30)"), ("kal(q=0.002,se=0)", "win5"),
                                 ("kal(q=0.002,se=0)+brk(vb=0.05)", "kal(q=0.002,se=0)")]),
                       ("r108", [("kal(q=0.03,se=0)", "win5")])):
        tt = tr["targets"][key]
        d = E.target_data(L, T, key)
        nl = {}
        for a, b in pairs:
            for nm in (a, b):
                if nm not in nl:
                    _, p = E.tracker_pred(L, T, key, tt["res"][nm], tt["prior"], tt["k_nb"])
                    nl[nm] = E.score_obs(d["kind"], d["y"], d["E"], p, tt["k_nb"])[0]
            cvm = (d["year"] >= 2012) & (d["year"] <= 2023)
            ho = (d["year"] >= 2024) & (d["year"] <= 2025)
            c = boot((nl[a] - nl[b])[cvm], d["event"][cvm], seed=11)
            h = boot((nl[a] - nl[b])[ho], d["event"][ho], seed=11)
            print("  %-6s %-34s - %-16s CV 2012-23 %+.5f [%+.5f, %+.5f] | 2024-25 %+.5f [%+.5f, %+.5f]" % (
                key, a, b, *c, *h))
    print("(a2) builder's nested league CV re-scored without the break variants (their base configs were picked on"
          " pooled 2012-2023): nested - win5 reference, 2014-2023")
    for key, tt in tr["targets"].items():
        d = E.target_data(L, T, key)
        nY = {Y: int((d["year"] == Y).sum()) for Y in tr["years"]}
        res = tt["res"]
        names = [nm for nm in res if "brk" not in nm]
        num = den = ref = 0.0
        for Y1 in tr["years"][2:]:
            pick = min(names, key=lambda nm: sum(res[nm]["by_year"][str(Y)] * nY[Y] for Y in tr["years"] if Y < Y1))
            num += res[pick]["by_year"][str(Y1)] * nY[Y1]
            ref += res[tt["refs"]["win5"]]["by_year"][str(Y1)] * nY[Y1]
            den += nY[Y1]
        print("  %-9s without breaks %+.5f | as reported %+.5f" % (key, (num - ref) / den,
                                                                   tt["nested_loss"] - tt["nested_win5"]))
    F = own_table()
    print("(b) glove periods from the own parse (league; dec / KO / SUB %, KD per 100 head, sig landed per fighter-min,"
          " 10-8 per 100 judged rounds)")
    per = [("2022", "2022-01-01", "2022-12-31"), ("2023", "2023-01-01", "2023-12-31"),
           ("Jan-May 2024", "2024-01-01", "2024-05-31"), ("new gloves", "2024-06-01", "2024-11-15"),
           ("transition", "2024-11-16", "2025-02-14"), ("2025 old gloves", "2025-02-15", "2025-12-31")]
    for nm, a, b in per:
        m = (F["date"] >= dt.date.fromisoformat(a)) & (F["date"] <= dt.date.fromisoformat(b))
        o, s, j = m & F["cls"].isin(["KO", "SUB", "DEC", "DRAW"]), m & F["fmin"].notna(), m & F["jr"].notna()
        print("  %-16s cards %2d | dec %.1f KO %.1f SUB %.1f | KD %.3f | SLpM %.2f | 10-8 %.2f" % (
            nm, F.loc[m, "event"].nunique(), 100 * F.loc[o, "cls"].isin(["DEC", "DRAW"]).mean(),
            100 * (F.loc[o, "cls"] == "KO").mean(), 100 * (F.loc[o, "cls"] == "SUB").mean(),
            100 * F.loc[s, "s_kd"].sum() / F.loc[s, "s_h_lnd"].sum(), F.loc[s, "s_sig_lnd"].sum() / F.loc[s, "fmin"].sum(),
            100 * F.loc[j, "n108"].sum() / F.loc[j, "jr"].sum()))
    print("(c) method universe (S2 + ML v2 winner static cells, fit < 2024): decision excess by glove period")
    b = pickle.load(open(os.path.join(CACHE, "base.pkl"), "rb"))
    y, P6, dc = b["y"], b["P6w"], b["draw_c"]
    dates = b["T"]["date"].to_numpy()
    ok = (y >= 0) & (b["vint"] >= 2016)
    pdec = P6[:, 2] + P6[:, 3]                       # six-class decision cells (draws are a share of these)
    isdec = np.isin(y, (20, 21, 22)).astype(float)
    tot = None
    for nm, a, bb in per[2:] + [("2024-25", "2024-01-01", "2025-12-31"), ("2016-23", "2016-01-01", "2023-12-31")]:
        m = ok & (dates >= dt.date.fromisoformat(a)) & (dates <= dt.date.fromisoformat(bb))
        ex = float((isdec[m] - pdec[m]).sum())
        if nm == "2024-25":
            tot = ex
        print("  %-16s n %4d actual %.3f static %.3f excess %+.1f pts (%+.1f decisions)" % (
            nm, m.sum(), isdec[m].mean(), pdec[m].mean(), 100 * (isdec[m].mean() - pdec[m].mean()), ex))
    m = ok & (dates >= dt.date(2024, 6, 1)) & (dates <= dt.date(2024, 11, 15))
    print("  new-glove window share of the 2024-25 excess: %.0f%%" % (100 * (isdec[m] - pdec[m]).sum() / tot))


# ----------------------------------------------------------------------------------------------- method gate
def stage_gate():
    b = pickle.load(open(os.path.join(CACHE, "base.pkl"), "rb"))
    idx = np.where(b["vint"] >= 2014)[0]
    day = np.array([d.toordinal() for d in b["T"]["date"].iloc[idx]])
    o = np.argsort(day, kind="stable")
    idx, day = idx[o], day[o]
    P6, y, vint = b["P6w"][idx], b["y"][idx], b["vint"][idx]
    yr, ev, dc = b["T"]["year"].to_numpy()[idx], b["T"]["event"].to_numpy()[idx], b["draw_c"]
    ok = y >= 0
    obs7 = np.full(len(y), -1)
    for lo, hi, k in ((0, 5, 0), (5, 10, 1), (20, 21, 2), (22, 23, 3), (21, 22, 4), (15, 20, 5), (10, 15, 6)):
        obs7[(y >= lo) & (y < hi)] = k
    assert ((obs7 >= 0) == ok).all()

    def parts(P):
        pA = P[:, :3].sum(1)
        fA = np.clip((P[:, 0] + P[:, 1]) / P[:, :3].sum(1), 1e-6, 1 - 1e-6)
        fB = np.clip((P[:, 5] + P[:, 4]) / P[:, 3:].sum(1), 1e-6, 1 - 1e-6)
        return pA, np.log(fA / (1 - fA)), np.log(fB / (1 - fB)), P[:, 0] / (P[:, 0] + P[:, 1]), P[:, 5] / (P[:, 5] + P[:, 4])
    sg = lambda z: 1 / (1 + np.exp(-z))

    def loss7(P, ob, a):
        pA, lA, lB, kA, kB = parts(P)
        fa, fb = sg(lA + a), sg(lB + a)
        dA, dB = pA * (1 - fa), (1 - pA) * (1 - fb)
        B7 = np.stack([pA * fa * kA, pA * fa * (1 - kA), dA * (1 - dc), (dA + dB) * dc, dB * (1 - dc),
                       (1 - pA) * fb * (1 - kB), (1 - pA) * fb * kB], 1)
        return np.where(ob >= 0, -np.log(np.clip(B7[np.arange(len(ob)), np.maximum(ob, 0)], 1e-12, None)), np.nan)

    def pfin(P, a):
        pA, lA, lB, _, _ = parts(P)
        return pA * sg(lA + a) + (1 - pA) * sg(lB + a)
    yfin = np.isin(obs7, (0, 1, 5, 6)).astype(float)

    def lossfin(P, a):
        p = np.clip(pfin(P, a), 1e-12, 1 - 1e-12)
        return np.where(ok, -(yfin * np.log(p) + (1 - yfin) * np.log(1 - p)), np.nan)

    def track(P, h, n0, rho):
        lam, prec, off = math.log(2) / (h * 365.25), n0 * 0.2, np.zeros(len(y))
        pf_cache = {}
        for d in np.unique(day):
            rows = np.where(day == d)[0]
            hi = np.where((day < d) & ok)[0]
            if not len(hi):
                continue
            w = np.exp(-lam * (d - day[hi]))
            if rho < 1:
                w = w * np.power(rho, np.maximum(vint[rows].max() - vint[hi], 0))
            kk = w > 1e-4
            hi, w = hi[kk], w[kk]
            if not len(hi):
                continue
            Ph, yy = P[hi], yfin[hi]

            def f(a):
                p = np.clip(pfin(Ph, a), 1e-12, 1 - 1e-12)
                return -(w * (yy * np.log(p) + (1 - yy) * np.log(1 - p))).sum() + 0.5 * prec * a * a
            off[rows] = minimize_scalar(f, bounds=(-2, 2), method="bounded", options={"xatol": 1e-7}).x
        return off

    L70 = loss7(P6, obs7, 0.0)
    ho, gy = ok & (yr >= 2024), ok & np.isin(yr, (2021, 2022, 2023))
    print("own 7-bin scorer: static 2024-25 %.5f (ml2 1.5171); 2020-23 %.5f (ml2 CV 1.60642); gate years %.5f" % (
        np.nanmean(L70[ho]), np.nanmean(L70[ok & (yr >= 2020) & (yr <= 2023)]), np.nanmean(L70[gy])))
    # corner swap: flip a random half of the fights; offsets and losses must not move
    rng = np.random.default_rng(2)
    sw = rng.random(len(y)) < 0.5
    P6s = np.where(sw[:, None], P6[:, ::-1], P6)
    obs7s = np.where(sw & (obs7 >= 0), 6 - obs7, obs7)
    o1, o2 = track(P6, 0.25, 200, 0.0), track(P6s, 0.25, 200, 0.0)
    print("swap test (random half of corners flipped): max |offset diff| %.1e, max |7-bin loss diff| %.1e" % (
        np.abs(o1 - o2).max(), np.nanmax(np.abs(loss7(P6, obs7, o1) - loss7(P6s, obs7s, o2)))))
    grid = [(h, n0, rho) for h in (0.25, 0.5, 1.0, 2.0, 4.0) for n0 in (50, 200, 800) for rho in (0.0, 0.5, 1.0)]
    OFF = {"none": np.zeros(len(y))}
    for g in grid:
        OFF[g] = o1 if g == (0.25, 200, 0.0) else track(P6, *g)
    LF = {g: lossfin(P6, o) for g, o in OFF.items()}
    L7 = {g: loss7(P6, obs7, o) for g, o in OFF.items()}
    cv = ok & (yr >= 2016) & (yr <= 2023)
    for metric, LL in (("finish", LF), ("7-bin", L7)):
        nested, picks = np.full(len(y), np.nan), {}
        for Y in (2021, 2022, 2023):
            trm = ok & (yr >= 2016) & (yr < Y)
            best = min(LL, key=lambda g: np.nanmean(LL[g][trm]))
            gain = np.nanmean(LL[best][trm]) - np.nanmean(LL["none"][trm])
            pick = best if gain < -0.0005 else "none"
            picks[Y] = "%s (train gain %+.5f)" % (pick, gain)
            nested[ok & (yr == Y)] = L7[pick][ok & (yr == Y)]
        r = boot((nested - L70)[gy], ev[gy], seed=3)
        print("gate, select on %s over 2016..Y-1: %s\n   7-bin nested - static 2021-23 %+.5f [%+.5f, %+.5f] -> %s" % (
            metric, picks, *r, "PASS" if r[0] < -0.0005 else "FAIL"))
    m2 = (0.25, 200, 0.0)
    print("league-only M2 analogue %s: pooled 2016-23 finish %+.5f, 7-bin %+.5f; by year finish %s" % (
        m2, np.nanmean(LF[m2][cv]) - np.nanmean(LF["none"][cv]), np.nanmean(L7[m2][cv]) - np.nanmean(L70[cv]),
        {Y: round(float(np.nanmean(LF[m2][ok & (yr == Y)]) - np.nanmean(LF["none"][ok & (yr == Y)])), 4)
         for Y in range(2016, 2024)}))
    r = boot((L7[m2] - L70)[ho], ev[ho], seed=3)
    print("descriptive 2024-25 (look already taken): 7-bin %+.5f [%+.5f, %+.5f]; decision share predicted %.3f vs static"
          " %.3f, actual %.3f" % (*r, (1 - pfin(P6, OFF[m2]))[ho].mean(), (1 - pfin(P6, 0.0))[ho].mean(),
                                 1 - yfin[ho].mean()))


# ----------------------------------------------------------------------------------------------- statlines
def stage_stat():
    so = json.load(open(os.path.join(ROOT, "data", "derived", "statlines_oof.json")))
    F = own_table()
    fid_ev = dict(zip(F["fid"], F["event"]))
    key = {(e, b): f for f, e, b in zip(F["fid"], F["event"], F["bout"])}
    st = pd.read_csv(os.path.join(RAW, "ufc_fight_stats.csv"), dtype=str).fillna("")
    act = {}
    for r in st.itertuples(index=False):
        f = key.get((r.EVENT.strip(), r.BOUT.strip()))
        if f is None:
            continue
        names = [x.strip() for x in r.BOUT.split(" vs. ")]
        side = names.index(r.FIGHTER.strip()) if r.FIGHTER.strip() in names else None
        if side is None:
            continue
        a = act.setdefault(f, [dict(l_att=0, l_lnd=0, c_att=0, c_lnd=0) for _ in range(2)])
        a[side]["l_lnd"] += _of(r.LEG)[0]
        a[side]["l_att"] += _of(r.LEG)[1]
        a[side]["c_lnd"] += _of(r.CLINCH)[0]
        a[side]["c_att"] += _of(r.CLINCH)[1]
    rows, miss = [], 0
    for fid, r in so["fights"].items():
        if r.get("set") not in ("cv2020", "cv", "valid") or r["date"] >= "2026-01-01":
            continue
        if fid not in act:
            miss += 1
            continue
        d = dt.date.fromisoformat(r["date"])
        v = {"cv2020": 2020, "valid": 2024}.get(r["set"], d.year)
        for si, s in enumerate(("A", "B")):
            if s in r:
                rows.append((d.toordinal(), d.year, v, fid_ev[fid], r[s], act[fid][si]))
    rows.sort(key=lambda x: x[0])
    print("statlines OOF fights without own raw actuals: %d; fight-sides %d" % (miss, len(rows)))
    day, yr = np.array([x[0] for x in rows]), np.array([x[1] for x in rows])
    vint, ev = np.array([x[2] for x in rows]), np.array([x[3] for x in rows])
    for stat, (h, n0, rho) in (("l_att", (2.0, 200, 0.0)), ("l_lnd", (2.0, 200, 0.0)), ("c_att", (0.5, 50, 0.5)),
                               ("c_lnd", (1.0, 50, 0.5))):
        mu = np.array([x[4][stat][0] for x in rows])
        k = np.array([x[4][stat][1] for x in rows])
        yy = np.array([x[5][stat] for x in rows], float)
        prec = n0 * float(np.median((mu * k / (k + mu))[yr < 2021]))
        lam, off = math.log(2) / (h * 365.25), np.zeros(len(yy))
        for d in np.unique(day):
            rr = np.where(day == d)[0]
            hi = np.where(day < d)[0]
            w = np.exp(-lam * (d - day[hi]))
            if rho < 1:
                w = w * np.power(rho, np.maximum(vint[rr].max() - vint[hi], 0))
            kk = w > 1e-4
            hi, w = hi[kk], w[kk]
            if not len(hi):
                continue
            f = lambda a: -(w * nbll(yy[hi], mu[hi] * math.exp(a), k[hi])).sum() + 0.5 * prec * a * a
            off[rr] = minimize_scalar(f, bounds=(-1.5, 1.5), method="bounded", options={"xatol": 1e-7}).x
        dl = -(nbll(yy, mu * np.exp(off), k) - nbll(yy, mu, k))
        cv, ho = np.isin(yr, (2021, 2022, 2023)), yr >= 2024
        r, rh = boot(dl[cv], ev[cv], seed=5), boot(dl[ho], ev[ho], seed=5)
        print("%-5s %s CV 2021-23 %+.5f [%+.5f, %+.5f] by year %s | 2024-25 %+.5f [%+.5f, %+.5f] (card clusters)" % (
            stat, (h, n0, rho), *r, {Y: round(float(dl[yr == Y].mean()), 4) for Y in (2021, 2022, 2023)}, *rh))


STAGES = {"parse": stage_parse, "league": stage_league, "decomp": stage_decomp, "gate": stage_gate, "stat": stage_stat}

if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in STAGES:
        raise SystemExit(__doc__)
    STAGES[sys.argv[1]]()
