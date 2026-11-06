#!/usr/bin/env python3
"""Adversarial verification of tools/crowd.py (verifier's own code: it does not import tools/crowd.py or tools/ml2.py).

    nice -n 5 python3 tools/crowd_verify.py reparse    # own parse of data/raw/crowd_cache + own ufcstats matching
    nice -n 5 python3 tools/crowd_verify.py compare    # own parse vs data/derived/crowd.json
    nice -n 5 python3 tools/crowd_verify.py gate mine  # own stack gate (mirrored, no intercept), own parse, <= 2023 rows
    nice -n 5 python3 tools/crowd_verify.py gate builder   # same code on crowd.json's inputs
    nice -n 5 python3 tools/crowd_verify.py alone      # crowd alone (forward slope) + leak checks, own parse, <= 2023
    nice -n 5 python3 tools/crowd_verify.py confirm    # reproduces (never selects on) the reported 2024-25 static rows

Outputs go to out/crowd_cache/verify/ (gitignored). Results: research/model_crowd.md "Verification log".
2026 fights are dropped at parse; the gate, alone and leak checks keep only rows dated before 2024.
"""
import collections
import csv
import datetime as dt
import glob
import html
import json
import os
import pickle
import re
import sys
import unicodedata

import lxml.html
import numpy as np
from scipy.optimize import minimize, minimize_scalar

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.join(ROOT, "out", "crowd_cache", "verify")
os.makedirs(HERE, exist_ok=True)


def cmd_reparse():

    CACHE = ROOT + "/data/raw/crowd_cache"
    OUT = HERE

    def nm(s):
        s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
        s = re.sub(r"['’`]", "", s)
        return " ".join(re.sub(r"[^a-z0-9]+", " ", s).split())

    # ---- ufcstats fights, 2026 dropped at parse
    ev_date = {}
    for r in csv.DictReader(open(ROOT + "/data/raw/ufc_event_details.csv")):
        try:
            d = dt.datetime.strptime(r["DATE"].strip(), "%B %d, %Y").date()
        except ValueError:
            continue
        ev_date[r["EVENT"].strip()] = d
    fights = []
    seen_url = set()
    n26 = 0
    for r in csv.DictReader(open(ROOT + "/data/raw/ufc_fight_results.csv")):
        e = r["EVENT"].strip()
        if e not in ev_date or r["URL"] in seen_url:
            continue
        seen_url.add(r["URL"])
        d = ev_date[e]
        if d >= dt.date(2026, 1, 1):
            n26 += 1
            continue
        ns = r["BOUT"].split(" vs. ")
        if len(ns) != 2:
            continue
        out = r["OUTCOME"].strip()
        fights.append(dict(fid=r["URL"].rstrip("/").rsplit("/", 1)[-1], date=d, event=e, a=ns[0].strip(), b=ns[1].strip(),
                           w={"W/L": "A", "L/W": "B"}.get(out)))
    by_date = collections.defaultdict(list)
    for f in fights:
        by_date[f["date"]].append(f)

    def toks(s):
        return set(nm(s).split())

    def sim(x, y):
        tx, ty = toks(x), toks(y)
        if not tx or not ty:
            return 0
        if nm(x) == nm(y):
            return 3
        if tx == ty:
            return 3
        lx, ly = nm(x).split()[-1], nm(y).split()[-1]
        if lx == ly:
            return 2
        if tx & ty:
            return 1
        return 0

    def cands(d0, d1):
        d = d0
        while d <= d1:
            for f in by_date.get(d, []):
                yield f
            d += dt.timedelta(days=1)

    def match_pair(a, b, d0, d1):
        best = []
        for f in cands(d0, d1):
            s1 = min(sim(a, f["a"]), sim(b, f["b"]))
            s2 = min(sim(a, f["b"]), sim(b, f["a"]))
            if max(s1, s2) >= 1:
                best.append((max(s1, s2), s2 > s1, f))
        if not best:
            return None
        best.sort(key=lambda t: -t[0])
        if len(best) > 1 and best[1][0] == best[0][0] and best[1][2]["fid"] != best[0][2]["fid"]:
            return ("ambiguous", [x[2]["fid"] for x in best[:3]])
        return best[0]

    def pick_side(p, a, b):
        P = nm(p)
        if not P:
            return None
        ta, tb, tp = toks(a), toks(b), set(P.split())
        ia, ib = len(tp & ta), len(tp & tb)
        if ia != ib:
            return "A" if ia > ib else "B"
        # compact compare (e.g. "DellaMaddalena", hyphenation)
        pc, ac, bc = P.replace(" ", ""), nm(a).replace(" ", ""), nm(b).replace(" ", "")
        if (pc in ac) != (pc in bc):
            return "A" if pc in ac else "B"
        return None

    # ---- RotoWire
    rw_rows = {}
    rw_stats = collections.Counter()
    rw_unmatched = []
    for fn in sorted(glob.glob(CACHE + "/rotowire/mma_article_*.html")):
        raw = open(fn, encoding="utf-8", errors="replace").read()
        m = re.search(r'"datePublished"\s*:\s*"(\d{4}-\d\d-\d\d)', raw)
        if not m:
            rw_stats["nodate"] += 1
            continue
        pub = dt.date.fromisoformat(m.group(1))
        doc = lxml.html.fromstring(raw)
        bouts = collections.OrderedDict()
        for tb in doc.iter("table"):
            trs = tb.findall(".//tr")
            if not trs:
                continue
            hdr = [c.text_content().strip() for c in trs[0] if c.tag in ("td", "th")]
            if not hdr or "matchup" not in hdr[0].lower():
                continue
            off = 2 if len(hdr) > 1 and "weight" in hdr[1].lower() else 1
            pk = [h.strip() for h in hdr[off:]]
            for tr in trs[1:]:
                cells = [c for c in tr if c.tag in ("td", "th")]
                if not cells:
                    continue
                txt = " ".join(cells[0].text_content().split())
                if not re.search(r"\bvs\b", txt, re.I):
                    continue
                parts = re.split(r"\bvs\.?", txt, flags=re.I)[:2]
                parts = [re.sub(r"\((?:[+-]?\d+|C)\)", "", p).strip() for p in parts]
                if len(parts) != 2 or not all(parts):
                    continue
                key = (nm(parts[0]), nm(parts[1]))
                rec = bouts.setdefault(key, {"a": parts[0], "b": parts[1], "picks": {}})
                for j, c in enumerate(cells[off:off + len(pk)]):
                    t = " ".join(c.text_content().split())
                    if t and t.upper() not in ("N/A", "-", "--"):
                        rec["picks"][pk[j]] = t
        if not bouts:
            rw_stats["no_table"] += 1
            continue
        for rec in bouts.values():
            rw_stats["bouts"] += 1
            mt = match_pair(rec["a"], rec["b"], pub, pub + dt.timedelta(days=10))
            if mt is None or mt[0] == "ambiguous":
                rw_unmatched.append((os.path.basename(fn)[12:60], rec["a"], rec["b"], str(pub), mt and mt[1]))
                continue
            _, sw, f = mt
            na = nb = un = 0
            for t in rec["picks"].values():
                s = pick_side(t, rec["a"], rec["b"])
                if s is None:
                    un += 1
                    continue
                if sw:
                    s = "B" if s == "A" else "A"
                na += s == "A"; nb += s == "B"
            rw_stats["unresolved_picks"] += un
            if na + nb == 0:
                continue
            rw_rows[f["fid"]] = dict(date=str(f["date"]), n_a=na, n_b=nb, days=(f["date"] - pub).days, w=f["w"],
                                     a=f["a"], b=f["b"], src_a=rec["a"], src_b=rec["b"])
    rw_stats["matched"] = len(rw_rows)

    # ---- Money MMA
    mm_rows = {}
    mm_stats = collections.Counter()
    mm_unmatched = []
    for fn in sorted(glob.glob(CACHE + "/moneymma/p_*pick-em-results*.html")):
        raw = open(fn, encoding="utf-8", errors="replace").read()
        m = re.search(r'"datePublished"\s*:\s*"(\d{4}-\d\d-\d\d)', raw)
        if not m:
            mm_stats["nodate"] += 1
            continue
        pub = dt.date.fromisoformat(m.group(1))
        i = raw.find('class="available-content"')
        body = raw[i:] if i >= 0 else raw
        t = lxml.html.fromstring(body).text_content() if body.strip() else ""
        # text_content loses line breaks between <p>; re-split on the pattern "Name – NN%"
        j = t.find("Consensus Picks")
        if j < 0:
            mm_stats["no_block"] += 1
            continue
        seg = t[j + len("Consensus Picks"):]
        k = seg.find("Consensus Overall")
        seg = seg[:k] if k >= 0 else seg[:500]
        picks = re.findall(r"([A-Z][^%\d]*?)\s*[–—\-:]+\s*(\d{1,3})\s*%", seg)
        if not picks:
            mm_stats["no_picks"] += 1
            continue
        for name, pct in picks:
            name = name.strip()
            mm_stats["picks"] += 1
            hits = []
            for f in cands(pub - dt.timedelta(days=9), pub):
                for side in ("A", "B"):
                    s = sim(name, f["a"] if side == "A" else f["b"])
                    if s >= 2:
                        hits.append((s, f, side))
            if not hits:
                mm_unmatched.append((os.path.basename(fn)[2:-5], name, str(pub)))
                continue
            hits.sort(key=lambda h: -h[0])
            if len(hits) > 1 and hits[1][0] == hits[0][0] and hits[1][1]["fid"] != hits[0][1]["fid"]:
                # take the latest card (results post follows the card) only if unique by date
                ds = sorted(set(h[1]["date"] for h in hits if h[0] == hits[0][0]))
                top = [h for h in hits if h[0] == hits[0][0] and h[1]["date"] == ds[-1]]
                if len(set(h[1]["fid"] for h in top)) != 1:
                    mm_unmatched.append((os.path.basename(fn)[2:-5], name, str(pub), "ambiguous"))
                    continue
                hits = top
            s, f, side = hits[0]
            p = int(pct) / 100
            mm_rows[f["fid"]] = dict(date=str(f["date"]), share_a=p if side == "A" else 1 - p, pick=side, pub=str(pub),
                                     w=f["w"], a=f["a"], b=f["b"], name=name)
    mm_stats["matched"] = len(mm_rows)
    json.dump({"rw": rw_rows, "mm": mm_rows, "rw_stats": rw_stats, "mm_stats": mm_stats, "rw_unmatched": rw_unmatched,
               "mm_unmatched": mm_unmatched, "n2026_dropped": n26}, open(OUT + "/reparse.json", "w"), indent=1, default=str)
    print("dropped 2026 at parse:", n26)
    print("RW", dict(rw_stats), "unmatched", len(rw_unmatched))
    for u in rw_unmatched: print("  ", u)
    print("MM", dict(mm_stats), "unmatched", len(mm_unmatched))
    for u in mm_unmatched: print("  ", u)



def cmd_compare():
    R = json.load(open(HERE + "/reparse.json"))
    C = json.load(open(ROOT + "/data/derived/crowd.json"))
    F = C["fights"]
    crw = {k: v["rw"] for k, v in F.items() if "rw" in v}
    cmm = {k: v["mm"] for k, v in F.items() if "mm" in v}
    print("rw: mine", len(R["rw"]), "builder", len(crw), "common", len(set(R["rw"]) & set(crw)))
    for k in sorted(set(R["rw"]) ^ set(crw)):
        print("  rw only in", "mine" if k in R["rw"] else "builder", k, R["rw"].get(k) or {x: crw[k][x] for x in ("n_a", "n_b", "days_before", "article")}, F.get(k, {}).get("a"), F.get(k, {}).get("b"))
    diff = [(k, R["rw"][k]["n_a"], R["rw"][k]["n_b"], crw[k]["n_a"], crw[k]["n_b"]) for k in set(R["rw"]) & set(crw)
            if (R["rw"][k]["n_a"], R["rw"][k]["n_b"]) != (crw[k]["n_a"], crw[k]["n_b"])]
    print("rw count differences", len(diff))
    for d in diff: print("  ", d, R["rw"][d[0]]["src_a"], R["rw"][d[0]]["src_b"], R["rw"][d[0]]["a"], R["rw"][d[0]]["b"])
    dd = [(k, R["rw"][k]["days"], crw[k]["days_before"]) for k in set(R["rw"]) & set(crw) if R["rw"][k]["days"] != crw[k]["days_before"]]
    print("rw days differences", dd[:10])
    print("mm: mine", len(R["mm"]), "builder", len(cmm), "common", len(set(R["mm"]) & set(cmm)))
    for k in sorted(set(R["mm"]) ^ set(cmm)):
        print("  mm only in", "mine" if k in R["mm"] else "builder", k, R["mm"].get(k) or cmm[k]["post"], F.get(k, {}).get("a"))
    dm = [(k, R["mm"][k]["share_a"], cmm[k]["share_a"]) for k in set(R["mm"]) & set(cmm) if abs(R["mm"][k]["share_a"] - cmm[k]["share_a"]) > 1e-6]
    print("mm share differences", len(dm), dm[:10])



def cmd_gate():

    S = pickle.load(open(ROOT + "/out/ml2_cache/stack.pkl", "rb"))
    D = S["D"]
    D = D[D["year"] <= 2023].reset_index(drop=True)
    assert str(D["date"].max()) < "2024-01-01"
    R = json.load(open(HERE + "/reparse.json"))
    CJ = json.load(open(ROOT + "/data/derived/crowd.json"))["fights"]
    SRC = sys.argv[2] if len(sys.argv) > 2 else "mine"
    n = len(D)
    cols = {k: np.full(n, np.nan) for k in ("rw", "mm", "crowd", "mm_s", "crowd_s")}
    idx = {f: i for i, f in enumerate(D["fid"])}
    for fid, i in idx.items():
        zs, zs_s = [], []
        if SRC == "mine":
            r = R["rw"].get(fid)
            if r and r["days"] >= 1:
                p = (r["n_a"] + 0.5) / (r["n_a"] + r["n_b"] + 1)
                cols["rw"][i] = p; zs.append(np.log(p / (1 - p))); zs_s.append(np.log(p / (1 - p)))
            m = R["mm"].get(fid)
            if m:
                p = min(max(m["share_a"], 0.03), 0.97)
                cols["mm"][i] = p; zs.append(np.log(p / (1 - p)))
                frz = CJ.get(fid, {}).get("mm", {}).get("freeze")
                if frz in ("lock_verified", "contest_pre_event"):
                    cols["mm_s"][i] = p; zs_s.append(np.log(p / (1 - p)))
        else:   # builder's crowd.json fields, but recomputed here
            r = CJ.get(fid, {}).get("rw")
            if r and r["frozen"] == "pre_event":
                p = (r["n_a"] + 0.5) / (r["n"] + 1)
                cols["rw"][i] = p; zs.append(np.log(p / (1 - p))); zs_s.append(np.log(p / (1 - p)))
            m = CJ.get(fid, {}).get("mm")
            if m and m["freeze"] != "lock_after_bound":
                p = min(max(m["share_a"], 0.03), 0.97)
                cols["mm"][i] = p; zs.append(np.log(p / (1 - p)))
                if m["freeze"] in ("lock_verified", "contest_pre_event"):
                    cols["mm_s"][i] = p; zs_s.append(np.log(p / (1 - p)))
        if zs:
            cols["crowd"][i] = 1 / (1 + np.exp(-np.mean(zs)))
        if zs_s:
            cols["crowd_s"][i] = 1 / (1 + np.exp(-np.mean(zs_s)))
    for k, v in cols.items():
        D[k] = v
    y = D["y"].to_numpy(float)
    yr = D["year"].to_numpy()
    ev = D["event"].to_numpy()

    def Z(c):
        c = {"ml2": "ml2_static", "ml2lr": "ml2lr_static"}.get(c, c)
        p = np.clip(D[c].to_numpy(float), 0.01, 0.99)
        z = np.log(p / (1 - p))
        return np.where(np.isnan(z), 0.0, z)

    def fit(Zm, yv, w, signed_last=0, intercept=False):
        # mirrored rows: (z, y) and (-z, 1-y); with intercept the constant column is NOT flipped (that is the point of
        # the free-intercept check: it can only learn the corner order)
        Zf = np.r_[Zm, -Zm]; yf = np.r_[yv, 1 - yv]; wf = np.r_[w, w]
        if intercept:
            Zf = np.c_[Zf, np.ones(len(Zf))]
        wf = wf / wf.sum()
        k = Zf.shape[1]
        def f(b):
            q = Zf @ b
            p = 1 / (1 + np.exp(-q))
            return np.sum(wf * (np.logaddexp(0, q) - yf * q)) + 1e-4 * b @ b, Zf.T @ (wf * (p - yf)) + 2e-4 * b
        kk = k - (1 if intercept else 0)
        bnds = [(0, None)] * (kk - signed_last) + [(None, None)] * signed_last + ([(None, None)] if intercept else [])
        return minimize(f, np.full(k, 0.3), jac=True, method="L-BFGS-B", bounds=bnds).x

    def ll(p, yv):
        p = np.clip(p, 1e-12, 1 - 1e-12)
        return -(yv * np.log(p) + (1 - yv) * np.log(1 - p))

    def cv(cset, ok, signed=0, h=None, intercept=False, unmirrored=False):
        Zm = np.c_[[Z(c) for c in cset]].T
        pred = np.full(n, np.nan)
        for Y in (2021, 2022, 2023):
            tr = ok & (yr < Y) & (yr >= 2019)
            w = np.ones(tr.sum()) if not h else 0.5 ** ((Y - yr[tr]) / h)
            if unmirrored:     # plain fit with a free intercept on the ufcstats order (the corner-order exploit)
                Zt = np.c_[Zm[tr], np.ones(tr.sum())]
                ww = w / w.sum()
                def f(b):
                    q = Zt @ b; p = 1 / (1 + np.exp(-q))
                    return np.sum(ww * (np.logaddexp(0, q) - y[tr] * q)) + 1e-4 * b @ b, Zt.T @ (ww * (p - y[tr])) + 2e-4 * b
                b = minimize(f, np.full(Zt.shape[1], 0.3), jac=True, method="L-BFGS-B",
                             bounds=[(0, None)] * len(cset) + [(None, None)]).x
                te = ok & (yr == Y)
                pred[te] = 1 / (1 + np.exp(-(np.c_[Zm[te], np.ones(te.sum())] @ b)))
                continue
            b = fit(Zm[tr], y[tr], w, signed, intercept)
            te = ok & (yr == Y)
            zt = Zm[te]
            if intercept:
                zt = np.c_[zt, np.ones(te.sum())]
            pred[te] = 1 / (1 + np.exp(-(zt @ b)))
        m = ok & np.isin(yr, (2021, 2022, 2023))
        return float(ll(pred[m], y[m]).mean()), pred, b

    def cv_choose(cset, ok, signed=0):
        res = {h: cv(cset, ok, signed, h) for h in (None, 3.0, 1.5)}
        hb = min(res, key=lambda h: res[h][0] + (0 if h is None else 0.0005))
        return res[hb][0], hb, res[hb][1], res[hb][2]

    def boot(a, b, mask, B=2000, seed=3):
        d = (ll(a[mask], y[mask]) - ll(b[mask], y[mask]))
        g = ev[mask]
        u, gi = np.unique(g, return_inverse=True)
        s = np.bincount(gi, d); c = np.bincount(gi)
        rng = np.random.default_rng(seed)
        out = []
        for _ in range(B):
            k = rng.integers(0, len(u), len(u))
            out.append(s[k].sum() / c[k].sum())
        return round(float(d.mean()), 5), [round(float(np.percentile(out, 2.5)), 4), round(float(np.percentile(out, 97.5)), 4)]

    has = {"line": D["market"].notna().to_numpy(), "open": D["open"].notna().to_numpy(), "noline": np.ones(n, bool)}
    BASES = {"line": {"market+ml2": ["market", "ml2"], "page: market+ml2lr": ["market", "ml2lr"]},
             "noline": {"ml2+mkt_rating+feat_lr": ["ml2", "mkt_rating", "feat_lr"], "page: ml2lr+mkt_rating": ["ml2lr", "mkt_rating"]},
             "open": {"open+ml2": ["open", "ml2"], "page: open+ml2lr": ["open", "ml2lr"]}}
    print("source:", SRC, "| coverage 2021-23:", {k: int((~np.isnan(v) & np.isin(yr, (2021, 2022, 2023))).sum()) for k, v in cols.items()})
    out = {}
    for reg, sets in BASES.items():
        ok = has[reg]
        for bn, bc in sets.items():
            cb, hb, pb, wb = cv_choose(bc, ok)
            line = "%-6s %-26s base %.5f (h %s)" % (reg, bn, cb, hb)
            best = None
            for c in ("rw", "mm", "crowd", "mm_s", "crowd_s"):
                for sg in (0, 1):
                    cc, hc, pc, wc = cv_choose(bc + [c], ok, sg)
                    g = cc - cb
                    cov = ok & np.isin(yr, (2021, 2022, 2023)) & ~np.isnan(D[c].to_numpy(float))
                    out["%s|%s|%s%s" % (reg, bn, c, "s" if sg else "")] = {"gain": round(g, 6), "h": hc, "w_last": round(float(wc[-1]), 4),
                                                                           "covered": boot(pc, pb, cov), "pass": g < -0.0005}
                    if c in ("rw", "mm", "crowd") and (best is None or cc < best[1]):
                        best = (c + (" signed" if sg else ""), cc, g)
            npass = sum(1 for k, v in out.items() if k.startswith("%s|%s|" % (reg, bn)) and v["pass"])
            print(line, "| best primary %s gain %+.5f | passing %d of 10" % (best[0], best[2], npass))
    # free-intercept check on the close base (+crowd): mirrored training forces the intercept to ~0; an unmirrored fit
    # with a free intercept learns ufcstats' winner-first order
    ok = has["line"]
    for cset in (["market", "ml2"], ["market", "ml2", "crowd"]):
        c0, p0, b0 = cv(cset, ok, 0, 1.5)
        c1, p1, b1 = cv(cset, ok, 0, 1.5, intercept=True)
        c2, p2, b2 = cv(cset, ok, 0, 1.5, unmirrored=True)
        print("intercept check %-24s no-intercept %.5f | mirrored+intercept %.5f (b0 %+.4f) | UNmirrored+intercept %.5f (b0 %+.4f)"
              % ("+".join(cset), c0, c1, b1[-1], c2, b2[-1]))
    json.dump(out, open(HERE + "/gate_%s.json" % SRC, "w"), indent=1, default=str)



def cmd_alone():
    R = json.load(open(HERE + "/reparse.json"))
    S = pickle.load(open(ROOT + "/out/ml2_cache/stack.pkl", "rb"))
    D = S["D"]; D = D[D["year"] <= 2023].reset_index(drop=True)
    def lg(p): return np.log(p / (1 - p))
    inp = {}
    for fid, r in R["rw"].items():
        if r["days"] >= 1 and r["date"] < "2024-01-01":
            inp.setdefault(fid, {})["rw"] = (r["n_a"] + .5) / (r["n_a"] + r["n_b"] + 1)
    for fid, m in R["mm"].items():
        if m["date"] < "2024-01-01":
            inp.setdefault(fid, {})["mm"] = min(max(m["share_a"], .03), .97)
    for fid, d in inp.items():
        d["crowd"] = 1 / (1 + np.exp(-np.mean([lg(v) for v in d.values()])))
    win = {}
    for src in ("rw", "mm"):
        for fid, r in R[src].items():
            if r["w"] in ("A", "B"):
                win[fid] = (1.0 if r["w"] == "A" else 0.0, int(r["date"][:4]))
    def ll(p, y):
        p = np.clip(p, 1e-12, 1 - 1e-12); return -(y * np.log(p) + (1 - y) * np.log(1 - p))
    def boot(d, g, B=2000, seed=5):
        u, gi = np.unique(g, return_inverse=True); s = np.bincount(gi, d); c = np.bincount(gi)
        rng = np.random.default_rng(seed); o = []
        for _ in range(B):
            k = rng.integers(0, len(u), len(u)); o.append(s[k].sum() / c[k].sum())
        return round(float(d.mean()), 4), [round(float(np.percentile(o, 2.5)), 4), round(float(np.percentile(o, 97.5)), 4)]
    idx = {f: i for i, f in enumerate(D["fid"])}
    y = D["y"].to_numpy(float); yr = D["year"].to_numpy(); ev = D["event"].to_numpy()
    both = D["market"].notna().to_numpy() & D["open"].notna().to_numpy()
    for c in ("rw", "mm", "crowd"):
        rows = [(lg(d[c]), win[f][0], win[f][1]) for f, d in inp.items() if c in d and f in win]
        z = np.array([r[0] for r in rows]); yy = np.array([r[1] for r in rows]); yy_r = np.array([r[2] for r in rows])
        pc = np.full(len(D), np.nan); sl = {}
        for Y in range(2019, 2024):
            m = yy_r < Y
            if m.sum() < 15: continue
            b = minimize_scalar(lambda b: np.sum(np.logaddexp(0, b * z[m]) - yy[m] * b * z[m]), bounds=(0, 10), method="bounded").x
            sl[Y] = round(b, 3)
            for f, d in inp.items():
                if c in d and f in idx and yr[idx[f]] == Y:
                    pc[idx[f]] = 1 / (1 + np.exp(-b * lg(d[c])))
        m = ~np.isnan(pc) & both
        res = {"n": int(m.sum()), "cards": len(set(ev[m])), "slopes": sl, "crowd": round(ll(pc[m], y[m]).mean(), 4)}
        for k in ("elo", "ml2_static", "open", "market"):
            q = D[k].to_numpy(float)[m]
            res[k] = round(ll(q, y[m]).mean(), 4)
            res["crowd-" + k] = boot(ll(pc[m], y[m]) - ll(q, y[m]), ev[m])
        raw = D[c].to_numpy(float)[m] if c in D else np.array([inp[f][c] for f in D["fid"][m]])
        print(c, json.dumps(res))
        # leak check: where the raw crowd majority disagrees with the close favourite
        if c in ("rw", "mm"):
            mk = np.array([c in inp.get(f, {}) for f in D["fid"]]) & D["market"].notna().to_numpy()
            rawc = np.array([inp[f][c] if c in inp.get(f, {}) else np.nan for f in D["fid"]])[mk]
            pm = D["market"].to_numpy(float)[mk]; yk = y[mk]
            dis = (np.abs(rawc - .5) > 1e-9) & ((rawc > .5) != (pm > .5))
            print("   leak check %s: n %d, disagreements %d, crowd side won %d (%.1f%%); crowd majority acc %.3f vs close fav %.3f"
                  % (c, mk.sum(), dis.sum(), ((rawc > .5) == (yk > .5))[dis].sum(), 100 * ((rawc > .5) == (yk > .5))[dis].mean(),
                     np.mean(((rawc > .5) == (yk > .5))[np.abs(rawc - .5) > 1e-9]), np.mean((pm > .5) == (yk > .5))))



def cmd_confirm():
    S = pickle.load(open(ROOT + "/out/ml2_cache/stack.pkl", "rb"))
    D = S["D"].reset_index(drop=True)
    assert str(D["date"].max()) < "2026-01-01"
    CJ = json.load(open(ROOT + "/data/derived/crowd.json"))["fights"]
    n = len(D)
    cols = {k: np.full(n, np.nan) for k in ("rw", "mm", "crowd")}
    for i, fid in enumerate(D["fid"]):
        r = CJ.get(fid)
        if not r: continue
        zs = []
        if r.get("rw") and r["rw"]["frozen"] == "pre_event":
            p = (r["rw"]["n_a"] + .5) / (r["rw"]["n"] + 1); cols["rw"][i] = p; zs.append(np.log(p / (1 - p)))
        if r.get("mm") and r["mm"]["freeze"] != "lock_after_bound":
            p = min(max(r["mm"]["share_a"], .03), .97); cols["mm"][i] = p; zs.append(np.log(p / (1 - p)))
        if zs: cols["crowd"][i] = 1 / (1 + np.exp(-np.mean(zs)))
    for k, v in cols.items(): D[k] = v
    y = D["y"].to_numpy(float); yr = D["year"].to_numpy(); ev = D["event"].to_numpy()
    def Z(c):
        c = {"ml2": "ml2_static", "ml2lr": "ml2lr_static"}.get(c, c)
        p = np.clip(D[c].to_numpy(float), .01, .99); z = np.log(p / (1 - p)); return np.where(np.isnan(z), 0, z)
    def fit(Zm, yv, w, sg):
        Zf = np.r_[Zm, -Zm]; yf = np.r_[yv, 1 - yv]; wf = np.r_[w, w]; wf = wf / wf.sum(); k = Zf.shape[1]
        def f(b):
            q = Zf @ b; p = 1 / (1 + np.exp(-q))
            return np.sum(wf * (np.logaddexp(0, q) - yf * q)) + 1e-4 * b @ b, Zf.T @ (wf * (p - yf)) + 2e-4 * b
        return minimize(f, np.full(k, .3), jac=True, method="L-BFGS-B", bounds=[(0, None)] * (k - sg) + [(None, None)] * sg).x
    def ll(p, yv): p = np.clip(p, 1e-12, 1 - 1e-12); return -(yv * np.log(p) + (1 - yv) * np.log(1 - p))
    def boot(d, g, B=2000, seed=9):
        u, gi = np.unique(g, return_inverse=True); s = np.bincount(gi, d); c = np.bincount(gi); rng = np.random.default_rng(seed); o = []
        for _ in range(B):
            k = rng.integers(0, len(u), len(u)); o.append(s[k].sum() / c[k].sum())
        return round(float(d.mean()), 4), [round(float(np.percentile(o, 2.5)), 4), round(float(np.percentile(o, 97.5)), 4)]
    def static(cset, ok, h, sg=0):
        Zm = np.c_[[Z(c) for c in cset]].T
        tr = ok & (yr <= 2023) & (yr >= 2019); w = np.ones(tr.sum()) if not h else 0.5 ** ((2024 - yr[tr]) / h)
        b = fit(Zm[tr], y[tr], w, sg); te = ok & (yr >= 2024)
        return 1 / (1 + np.exp(-(Zm[te] @ b))), te, b
    has = {"line": D["market"].notna().to_numpy(), "open": D["open"].notna().to_numpy(), "noline": np.ones(n, bool)}
    G = json.load(open(HERE + "/gate_builder.json"))
    for reg, base, hb, c, sg in (("line", ["market", "ml2"], None, "mm", 1), ("line", ["market", "ml2lr"], None, "mm", 1),
                                 ("noline", ["ml2", "mkt_rating", "feat_lr"], 1.5, "crowd", 0),
                                 ("noline", ["ml2lr", "mkt_rating"], 1.5, "crowd", 0), ("open", ["open", "ml2"], None, "mm", 0)):
        key = "%s|%s|%s%s" % (reg, {"line": {"ml2": "market+ml2", "ml2lr": "page: market+ml2lr"}, "noline": {"ml2": "ml2+mkt_rating+feat_lr", "ml2lr": "page: ml2lr+mkt_rating"}, "open": {"ml2": "open+ml2"}}[reg][base[1] if reg != "noline" else base[0]], c, "s" if sg else "")
        hc = G[key]["h"]; hc = None if hc in (None, "None") else float(hc)
        pb, te, wb = static(base, has[reg], hb)
        pc, _, wc = static(base + [c], has[reg], hc, sg)
        print("%-48s h %s/%s  base %.5f  +%s %.5f  diff %s  crowd w %+.3f" % (key, hb, hc, ll(pb, y[te]).mean(), c, ll(pc, y[te]).mean(),
              boot(ll(pc, y[te]) - ll(pb, y[te]), ev[te]), wc[-1]))



if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "reparse"
    {"reparse": cmd_reparse, "compare": cmd_compare, "gate": cmd_gate, "alone": cmd_alone, "confirm": cmd_confirm}[cmd]()
