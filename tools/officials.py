#!/usr/bin/env python3
"""
officials.py - v8 engine component: judges and referees, fit on the ufcstats snapshot.

JUDGES. Every judge's card total in DETAILS is parsed (ufcstats writes the fight loser's score first;
draw cards are unordered) and mapped to the two fighters. A round-level latent model explains each
card: in round r of fight f, judge j sees

    eta_jfr = exp(n_j) * [ exp(v_j + w_V t) * V_fr + exp(p_j + w_K t) * K_fr + exp(g_j + w_G t) * G_fr
                           + h * home_fr + u_fr ],          u_fr ~ N(0, sigma_u^2) shared by the 3 judges
    V = b_head dHead + b_body dBody + b_leg dLeg      (landed strike differentials, A - B)
    K = b_kd dKD                                      (knockdown differential)
    G = b_td dTD + b_ctrl dCtrlMin + b_sub dSubAtt + b_rev dRev
    t = (year - 2017) / 10

and scores the round for A with P = sigmoid(eta) (logistic own noise). The round winner W gets a 10-8
with P = sigmoid(c0 + c_year + c_j + th_V V_W + th_K K_W + th_G G_W + th_u u_W) (scores oriented to W);
a 10-10 has a small fixed probability. Only card totals are observed, so each card's likelihood is the
sum over every round-outcome pattern (B10-8, B10-9, 10-10, A10-9, A10-8 per round) consistent with its
totals; the shared noise is integrated per round by Gauss-Hermite quadrature, which makes the three
cards of a fight dependent. Point deductions are latent (fight-level, per fighter, 0/1/2 points) unless
DETAILS records them. Judge effects (n, v, p, g, c) are Gaussian random effects shrunk to the league
(MAP with hyperparameters chosen by walk-forward predictive likelihood on 2019-2023); posterior sds
from the Laplace approximation.

REFEREES. Per-referee random effects (penalized GLMs, shrunk to the league) on: knockdown-round
finish conversion, finishing-sequence length after a knockdown (proxies for KD-to-stoppage time:
share of KD finishes stopped at distance with no follow-up on the ground, ground strikes landed in
the finishing round), standing TKO without a knockdown per landed standing head strike, ground-and-
pound stoppage per landed ground strike, point deductions (posterior from the judge model plus the
few recorded in DETAILS) and DQs.

Walk-forward: hyperparameters tuned on 2019-2023 (train on years before each tuning year), reported on
2024+ with parameters refit on all data before each test year. Never fit on the test period.

Outputs
  data/derived/officials.json   machine-readable: league judging params, per-judge and per-referee
                                tables, sampling pools by region, held-out metrics
  research/model_officials.md   (written by hand from the printed results)

Usage
  python3 tools/officials.py                 # everything (about 30-60 minutes on 4 cores)
  python3 tools/officials.py --stage data    # parse and summarize only
  python3 tools/officials.py --quick         # skip the hyperparameter grid (use the stored choice)

Needs pandas, numpy, scipy and jax (pip install "jax[cpu]"). Nationality for the home-fighter effect comes
from Wikidata (CC0): data/raw/wikidata_mma_people.csv, fetched once with --fetch-wikidata.
"""
import argparse
import itertools
import json
import math
import re
import sys
import time
import datetime as dt
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import baserates as br  # noqa: E402  (loader and card regex shared with the base-rate tool)

RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "derived" / "officials.json"
WIKIDATA = RAW / "wikidata_mma_people.csv"
WIKIDATA_ALT = RAW / "wikidata_mma_altlabels.csv"
SINCE = "2001-01-01"

FEATS = ["head_l", "body_l", "leg_l", "kd", "td_l", "ctrl_min", "sub", "rev"]
GROUP = {"head_l": 0, "body_l": 0, "leg_l": 0, "kd": 1, "td_l": 2, "ctrl_min": 2, "sub": 2, "rev": 2}
GROUP_NAMES = ["volume", "knockdown", "grappling"]

# round outcome codes: 0 B10-8, 1 B10-9, 2 10-10, 3 A10-9, 4 A10-8
SC_A = np.array([8, 9, 10, 10, 10])
SC_B = np.array([10, 10, 10, 9, 8])
DED_OPTS = [(0, 0), (1, 0), (0, 1), (2, 0), (0, 2), (1, 1)]   # points deducted from (A, B)

COUNTRY_ISO = {"USA": "USA", "Brazil": "BRA", "Canada": "CAN", "United Kingdom": "GBR", "United Arab Emirates": "ARE",
               "Australia": "AUS", "China": "CHN", "Mexico": "MEX", "Japan": "JPN", "Singapore": "SGP", "Sweden": "SWE",
               "Germany": "DEU", "France": "FRA", "New Zealand": "NZL", "Russia": "RUS", "Ireland": "IRL",
               "Azerbaijan": "AZE", "Saudi Arabia": "SAU", "South Korea": "KOR", "Poland": "POL", "Netherlands": "NLD",
               "Serbia": "SRB", "Qatar": "QAT", "Denmark": "DNK", "Uruguay": "URY", "Czech Republic": "CZE",
               "Argentina": "ARG", "Chile": "CHL", "Croatia": "HRV", "Philippines": "PHL", "Puerto Rico": "PRI"}
REGION = {"USA": "USA (other states)", "BRA": "Brazil", "CAN": "Canada", "GBR": "UK and Ireland", "IRL": "UK and Ireland",
          "ARE": "Middle East", "SAU": "Middle East", "QAT": "Middle East", "AZE": "Middle East",
          "AUS": "Australia and NZ", "NZL": "Australia and NZ",
          "CHN": "Asia", "JPN": "Asia", "SGP": "Asia", "KOR": "Asia", "PHL": "Asia",
          "MEX": "Latin America", "ARG": "Latin America", "CHL": "Latin America", "URY": "Latin America",
          "PRI": "Latin America",
          "SWE": "Europe", "DEU": "Europe", "FRA": "Europe", "RUS": "Europe", "POL": "Europe", "NLD": "Europe",
          "SRB": "Europe", "DNK": "Europe", "CZE": "Europe", "HRV": "Europe"}


def log(*a):
    print(*a, flush=True)


# ================================================================================================
# data
# ================================================================================================
def judge_key(name):
    k = re.sub(r"[^a-z]", "", name.lower())
    return JUDGE_ALIASES.get(k, k)


# spelling variants checked by hand (fuzzy matches with the same commission and years)
JUDGE_ALIASES = {"mamunahquerido": "maimunahquerido", "stephenfaragher": "stevefaragher",
                 "ritchiegerard": "richiegerrard"}

DED_RE = re.compile(r"^(?P<what>(?:Two )?Points? Deducted): (?P<why>.*?) by (?P<rest>.*)$")


def parse_cards_full(det, n0, n1):
    """Cards as (judge_name, first_score, second_score) plus any recorded deduction.
    Returns cards, deduction dict {0: pts, 1: pts} or None, and a flag for unparseable text."""
    det = det or ""
    ded = None
    cards = br.parse_cards(det)
    m = DED_RE.match(det)
    if m:
        pts = 2 if m.group("what").startswith("Two") else 1
        rest = m.group("rest")
        ded = {0: 0, 1: 0}
        who = None
        if rest.startswith("Each Fighter"):
            ded = {0: 1, 1: 1}
            strip = "Each Fighter"
        else:
            for idx, nm in ((0, n0), (1, n1)):
                toks = nm.split()
                for cand in (toks[-1], " ".join(toks[1:]), nm):
                    if rest.startswith(cand) and (who is None or len(cand) > len(strip)):
                        who, strip = idx, cand
            if who is None:
                return cards, None, True
            ded[who] = pts
        # the first card's name carries the deduction prefix: remove it
        first = det[: det.find(rest)] + strip
        fixed = []
        for i, (nm, a, b) in enumerate(cards):
            if i == 0:
                nm = det[len(first): det.find(f"{a} - {b}")].strip() or "unknown"
            fixed.append((nm, a, b))
        cards = fixed
    return cards, ded, False


def region_of(location):
    parts = [p.strip() for p in str(location).split(",")]
    country = COUNTRY_ISO.get(parts[-1], "OTH")
    if country == "USA" and len(parts) >= 2 and parts[-2] == "Nevada":
        return country, "Nevada"
    return country, REGION.get(country, "Other")


def _nkey(s):
    s = str(s).lower()
    s = (s.replace("á", "a").replace("ã", "a").replace("é", "e").replace("í", "i").replace("ó", "o")
         .replace("ú", "u").replace("ç", "c").replace("ñ", "n").replace("ö", "o").replace("ü", "u"))
    return re.sub(r"[^a-z]", "", s)


def load_nationality(people_names, dob=None):
    """Map ufcstats fighter names to an ISO3 country: Wikidata country for sport, else citizenship, else
    birth country. Matched by normalized English label or alias; a name shared by several Wikidata people
    is resolved by date of birth (ufcstats tale of the tape) or dropped. Fallback: same date of birth and
    same last name."""
    if not WIKIDATA.exists():
        return {}, {"matched": 0, "note": "wikidata file missing; run with --fetch-wikidata"}
    w = pd.read_csv(WIKIDATA)
    alt = pd.read_csv(WIKIDATA_ALT) if WIKIDATA_ALT.exists() else pd.DataFrame(columns=["item", "alt"])
    w["dob"] = pd.to_datetime(w["dob"].astype(str).str[:10], errors="coerce")
    country, wdob = {}, {}
    for item, g in w.groupby("item"):
        for col in ("sc", "cc", "bc"):
            vals = g[col].dropna()
            if len(vals):
                country[item] = vals.value_counts().index[0]
                break
        wdob[item] = set(g["dob"].dropna())
    keys = defaultdict(set)
    for item, nm in zip(w["item"], w["name"]):
        if isinstance(nm, str):
            keys[_nkey(nm)].add(item)
    for item, nm in zip(alt["item"], alt["alt"]):
        if isinstance(nm, str):
            keys[_nkey(nm)].add(item)
    bydob = defaultdict(set)
    for item, ds in wdob.items():
        for d in ds:
            bydob[d].add(item)
    labels = dict(zip(w["item"], w["name"]))
    out, how = {}, Counter()
    dob = dob or {}
    for nm in people_names:
        cands = {i for i in keys.get(_nkey(nm), set()) if i in country}
        d = dob.get(nm)
        if len(cands) > 1 and d is not None:
            cands = {i for i in cands if d in wdob.get(i, set())}
        if len(cands) == 1:
            out[nm] = country[cands.pop()]
            how["name"] += 1
            continue
        if not cands and d is not None:
            last = _nkey(nm.split()[-1])
            c2 = {i for i in bydob.get(d, set()) if i in country and last and last in _nkey(labels.get(i, ""))}
            if len(c2) == 1:
                out[nm] = country[c2.pop()]
                how["dob+last name"] += 1
    return out, {"wikidata_people": int(w.item.nunique()), "matched_names": len(out),
                 "names_needed": len(people_names), "how": dict(how)}


def fetch_wikidata():
    import urllib.parse
    import urllib.request
    q = ('SELECT ?item ?name ?ufc ?sherdog ?cc ?bc ?sc ?dob WHERE { { ?item wdt:P9722 ?ufc } UNION '
         '{ ?item wdt:P2818 ?sherdog } OPTIONAL { ?item wdt:P9722 ?ufc } OPTIONAL { ?item wdt:P2818 ?sherdog } '
         'OPTIONAL { ?item wdt:P27 ?c . ?c wdt:P298 ?cc } OPTIONAL { ?item wdt:P1532 ?s . ?s wdt:P298 ?sc } '
         'OPTIONAL { ?item wdt:P19 ?b . ?b wdt:P17 ?bcn . ?bcn wdt:P298 ?bc } OPTIONAL { ?item wdt:P569 ?dob } '
         'OPTIONAL { ?item rdfs:label ?name FILTER(LANG(?name)="en") } }')
    url = "https://query.wikidata.org/sparql?" + urllib.parse.urlencode({"query": q})
    req = urllib.request.Request(url, headers={"Accept": "text/csv", "User-Agent": "Mozilla/5.0 (research script)"})
    with urllib.request.urlopen(req, timeout=300) as r:
        WIKIDATA.write_bytes(r.read())
    log("wrote", WIKIDATA)


def build_data():
    F, S, notes, data_max = br.load_data(RAW, SINCE)
    E = br._load(RAW / "ufc_event_details.csv")
    loc = dict(zip(E.EVENT, E.LOCATION))
    F["location"] = F.EVENT.map(loc)
    reg = F.location.map(region_of)
    F["country"] = [r[0] for r in reg]
    F["region"] = [r[1] for r in reg]
    F["referee"] = F["REFEREE"].fillna("").str.strip()
    # ---- round differentials A - B (A = first name in BOUT)
    s = S.copy()
    s["ctrl_min"] = s.ctrl / 60.0
    cols = ["head_l", "body_l", "leg_l", "kd", "td_l", "ctrl_min", "sub", "rev", "sig_l", "ground_l", "dist_l",
            "clinch_l", "head_a", "sig_a", "td_a"]
    a = s[s.idx == 0].set_index(["fid", "rnd"])[cols]
    b = s[s.idx == 1].set_index(["fid", "rnd"])[cols]
    D = (a - b).dropna()
    # ---- decisions with three cards over full scheduled rounds
    dec = F[F.cat.isin(["U-DEC", "S-DEC", "M-DEC", "DRAW"]) & F.METHOD.str.startswith("Decision")
            & F.fmt.isin([br.FMT3, br.FMT5]) & (F.end_round == F.sched) & F.has_stats].copy()
    rows, drop = [], Counter()
    Dg = {fid: g.droplevel(0).sort_index() for fid, g in D.groupby(level=0)}
    for f in dec.itertuples():
        cards, ded, bad = parse_cards_full(f.det, f.n0, f.n1)
        if bad:
            drop["deduction text unparsed"] += 1
            continue
        if len(cards) != 3:
            drop["not three cards"] += 1
            continue
        R = int(f.sched)
        X = Dg.get(f.fid)
        if X is None or len(X) != R or list(X.index) != list(range(1, R + 1)):
            drop["round stats incomplete"] += 1
            continue
        oc = []
        for nm, lo, hi in cards:
            if f.winner == 0:
                oc.append((judge_key(nm) if nm != "unknown" else "unknown", nm, hi, lo))   # (A, B)
            elif f.winner == 1:
                oc.append((judge_key(nm) if nm != "unknown" else "unknown", nm, lo, hi))
            else:
                oc.append((judge_key(nm) if nm != "unknown" else "unknown", nm, lo, hi))   # draw: unordered
        rows.append({"fid": f.fid, "date": f.DATE, "year": int(f.year), "R": R, "n0": f.n0, "n1": f.n1,
                     "winner": int(f.winner), "cat": f.cat, "cards": oc, "ded": ded, "region": f.region,
                     "country": f.country, "referee": f.referee, "division": f.division, "title": bool(f.title),
                     "X": X[FEATS].to_numpy(float), "Xall": X})
    log(f"decisions kept {len(rows)}; dropped {dict(drop)}")
    return F, S, D, rows, notes, data_max


# ================================================================================================
# card pattern enumeration
# ================================================================================================
_PAT = {}


def patterns(R, allow1010=True):
    """All outcome sequences for R rounds with totals; 10-10 at most once, 10-8 at most twice per side."""
    key = (R, allow1010)
    if key not in _PAT:
        P = np.array(list(itertools.product(range(5), repeat=R)), np.int8)
        n10 = (P == 2).sum(1)
        ok = (n10 <= (1 if allow1010 else 0)) & ((P == 0).sum(1) <= 3) & ((P == 4).sum(1) <= 3)
        P = P[ok]
        ta = SC_A[P].sum(1)
        tb = SC_B[P].sum(1)
        idx = defaultdict(list)
        for i, (x, y) in enumerate(zip(ta, tb)):
            idx[(int(x), int(y))].append(i)
        _PAT[key] = (P, {k: np.array(v) for k, v in idx.items()})
    return _PAT[key]


def card_patterns(R, a, b, dA, dB, draw):
    """Pattern indices consistent with a card (a, b) for (A, B) after deductions dA, dB."""
    P, idx = patterns(R)
    out = []
    for (x, y) in ([(a, b), (b, a)] if (draw and a != b) else [(a, b)]):
        v = idx.get((x + dA, y + dB))
        if v is not None:
            out.append(v)
    if not out:
        return None
    return np.unique(np.concatenate(out))


def fight_triples(r, cap=100000, prune=2000):
    """Joint (card1, card2, card3) round-outcome patterns consistent with a fight's three cards.
    Returns (codes [n, R] of o1*25+o2*5+o3, dopt [n]) or None. Deduction options are tried in stages:
    none/one point per side first; two points and 10-10 rounds only when nothing else fits."""
    R, draw = r["R"], r["winner"] == -1
    if r["ded"] is not None:
        stages = [([(r["ded"][0], r["ded"][1])], False), ([(r["ded"][0], r["ded"][1])], True)]
        recorded = True
    else:
        stages = [(DED_OPTS[:3], False), (DED_OPTS, False), (DED_OPTS[:3], True), (DED_OPTS, True)]
        recorded = False
    for opts, allow in stages:
        P, idx = patterns(R, allow)
        codes, dcode, n = [], [], 0
        for (dA, dB) in opts:
            ps = []
            for (_, _, a, b) in r["cards"]:
                out = []
                for (x, y) in ([(a, b), (b, a)] if (draw and a != b) else [(a, b)]):
                    v = idx.get((x + dA, y + dB))
                    if v is not None:
                        out.append(v)
                if not out:
                    ps = None
                    break
                ps.append(np.unique(np.concatenate(out)))
            if ps is None:
                continue
            n += len(ps[0]) * len(ps[1]) * len(ps[2])
            if n > cap:
                return None
            P1, P2, P3 = (P[q].astype(np.int32) for q in ps)
            c = (P1[:, None, None, :] * 25 + P2[None, :, None, :] * 5 + P3[None, None, :, :]).reshape(-1, R)
            codes.append(c)
            dcode.append(np.full(len(c), 6 if recorded else DED_OPTS.index((dA, dB)), np.int8))
        if codes:
            if n > prune and len(codes) > 1 and dcode[0][0] == 0:
                # heavy fight: the no-deduction branch is feasible; drop the rare deduction branches
                return codes[0], dcode[0]
            return np.vstack(codes), np.concatenate(dcode)
    return None


class Design:
    """Flat arrays for a set of decisions. Judges not in `jidx` (and unnamed cards) map to the zero row.
    Only the (round, outcome-triple) combinations some consistent pattern uses are kept; fights are put in
    buckets by their number of joint patterns and padded, so the likelihood is dense array work."""
    BUCKETS = (8, 32, 128, 512, 2048, 6200)

    def __init__(self, rows, jidx, nat, year_max_param, cap=6200):
        self.rows = []
        X, J, home, us, yr, tt, trips, frf = [], [], [], [], [], [], [], []
        nJ = len(jidx)
        nfr = 0
        for r in rows:
            t = fight_triples(r, cap)
            if t is None:
                continue
            codes, dcode = t
            self.rows.append(r)
            R = r["R"]
            gidx = codes.astype(np.int64) + ((nfr + np.arange(R)) * 125)[None, :]
            trips.append((gidx, dcode))
            X.append(r["X"])
            J.append(np.tile([jidx.get(c[0], nJ) for c in r["cards"]], (R, 1)))
            a, b = nat.get(r["n0"]), nat.get(r["n1"])
            hd = (int(a == r["country"]) - int(b == r["country"])) if (a and b) else 0
            home.append(np.full(R, hd, float))
            us.append(np.full(R, float(r["country"] == "USA")))
            yr.append(np.full(R, min(r["year"], year_max_param) - YEAR0))
            tt.append(np.full(R, (r["year"] - 2017) / 10.0))
            frf.append(np.full(R, len(self.rows) - 1))
            nfr += R
        self.nF, self.nfr, self.nJ = len(self.rows), nfr, nJ
        self.fr_f = np.concatenate(frf).astype(np.int32)
        self.X = np.vstack(X)
        self.J = np.vstack(J).astype(np.int32)
        self.home = np.concatenate(home)
        self.us = np.concatenate(us)
        self.yr = np.concatenate(yr).astype(np.int32)
        self.t = np.concatenate(tt)
        allg = np.unique(np.concatenate([g.ravel() for g, _ in trips]))
        self.ufr = (allg // 125).astype(np.int32)
        code = allg % 125
        self.ua, self.ub, self.uc = (code // 25).astype(np.int32), ((code // 5) % 5).astype(np.int32), (code % 5).astype(np.int32)
        nu = len(allg)
        self.nu = nu
        # buckets
        self.buckets = []
        sizes = np.array([len(g) for g, _ in trips])
        lo = 0
        for B in self.BUCKETS:
            fi = np.nonzero((sizes > lo) & (sizes <= B))[0]
            lo = B
            if not len(fi):
                continue
            M = min(B, int(sizes[fi].max()))
            idx = np.full((len(fi), M, 5), nu, np.int32)      # nu = the constant-zero (log 1) slot
            dd = np.zeros((len(fi), M), np.int32)
            mask = np.zeros((len(fi), M), bool)
            for k, f in enumerate(fi):
                g, d = trips[f]
                R = g.shape[1]
                idx[k, :len(g), :R] = np.searchsorted(allg, g)
                dd[k, :len(g)] = d
                mask[k, :len(g)] = True
            self.buckets.append((fi.astype(np.int32), idx, dd, mask))
        self.n_trip = int(sizes.sum())
        self.n_pad = int(sum(b[1].shape[0] * b[1].shape[1] for b in self.buckets))

    def arrays(self):
        import jax.numpy as jnp
        d = {k: jnp.array(getattr(self, k)) for k in ("X", "J", "home", "us", "yr", "t", "ufr", "ua", "ub", "uc")}
        d["buckets"] = [tuple(jnp.array(a) for a in b) for b in self.buckets]
        return d


YEAR0, NYEARS = 2001, 2027 - 2001
NODES = 12
TAU_DEFAULT = {"n": 0.15, "v": 0.15, "p": 0.25, "g": 0.2, "c": 0.4}
EFF = ["n", "v", "p", "g", "c"]


def init_params(nJ):
    return {"beta": np.array([0.18, 0.13, 0.10, 2.4, 0.28, 0.46, 0.84, 0.3]), "w": np.zeros(3),
            "log_su": np.array(0.0), "h": np.zeros(2), "c0": np.array(-3.0), "th": np.array([0.3, 0.3, 0.3, 0.3]),
            "cy": np.zeros(NYEARS), "lg_e10": np.array(-6.0), "lpi": np.log(np.array([0.01, 0.002, 0.001])),
            "E": np.zeros((nJ, 5))}


LAYOUT = [("beta", (8,)), ("w", (3,)), ("log_su", ()), ("h", (2,)), ("c0", ()), ("th", (4,)), ("cy", (NYEARS,)),
          ("lg_e10", ()), ("lpi", (3,))]


def ravel(th):
    return np.concatenate([np.ravel(np.asarray(th[k], float)) for k, _ in LAYOUT] + [np.ravel(th["E"])])


def unravel(flat, nJ):
    out, i = {}, 0
    for k, shp in LAYOUT:
        n = int(np.prod(shp)) if shp else 1
        out[k] = flat[i:i + n].reshape(shp)
        i += n
    out["E"] = flat[i:i + nJ * 5].reshape((nJ, 5))
    return out


_JAX = {}


def _jax_fns():
    """Module-level jitted functions; flags (shared, judges, home, trend) and tau are runtime arrays, so one
    compile serves every model variant on the same design."""
    if _JAX:
        return _JAX
    import os
    import jax
    import jax.numpy as jnp
    from functools import partial
    jax.config.update("jax_enable_x64", True)
    try:
        CACHE.mkdir(parents=True, exist_ok=True)
        jax.config.update("jax_compilation_cache_dir", str(CACHE / "jaxcache"))
        jax.config.update("jax_persistent_cache_min_compile_time_secs", 2.0)
    except Exception:
        pass
    xq, wq = np.polynomial.hermite.hermgauss(NODES)
    xq = np.asarray(xq * np.sqrt(2.0))
    wq = np.asarray(wq / np.sqrt(np.pi))

    def fr_logP(th, d, fl, extra=None):
        use_sh, use_j, use_h, use_tr = fl[0], fl[1], fl[2], fl[3]
        X, tt, home, us, yr = d["X"], d["t"], d["home"], d["us"], d["yr"]
        b = th["beta"]
        V = X[:, :3] @ b[:3]
        K = X[:, 3] * b[3]
        G = X[:, 4:] @ b[4:]
        Ez = jnp.vstack([th["E"] * use_j, jnp.zeros((1, 5))])
        eff = Ez[d["J"]]
        if extra is not None:
            eff = eff + extra
        w = th["w"] * use_tr
        core = (jnp.exp(eff[..., 1] + w[0] * tt[:, None]) * V[:, None] +
                jnp.exp(eff[..., 2] + w[1] * tt[:, None]) * K[:, None] +
                jnp.exp(eff[..., 3] + w[2] * tt[:, None]) * G[:, None] +
                use_h * (th["h"][0] * us + th["h"][1] * (1 - us))[:, None] * home[:, None])
        su = jnp.exp(th["log_su"]) * use_sh
        u = su * xq
        eta = jnp.exp(eff[..., 0])[..., None] * (core[..., None] + u[None, None, :])
        lin = th["th"][0] * V + th["th"][1] * K + th["th"][2] * G
        cc = th["c0"] + th["cy"][yr]
        zA = (cc[:, None] + eff[..., 4] + lin[:, None])[..., None] + th["th"][3] * u[None, None, :]
        zB = (cc[:, None] + eff[..., 4] - lin[:, None])[..., None] - th["th"][3] * u[None, None, :]
        ls = jax.nn.log_sigmoid
        e10 = jax.nn.sigmoid(th["lg_e10"])
        l1 = jnp.log1p(-e10)
        return jnp.stack([l1 + ls(-eta) + ls(zB), l1 + ls(-eta) + ls(-zB), jnp.log(e10) + 0 * eta,
                          l1 + ls(eta) + ls(-zA), l1 + ls(eta) + ls(zA)], -1)

    def fight_ll(th, d, fl, nF, extra=None):
        P = jnp.exp(fr_logP(th, d, fl, extra))
        ufr = d["ufr"]
        Q = jnp.sum(wq[None, :] * P[ufr, 0, :, d["ua"]] * P[ufr, 1, :, d["ub"]] * P[ufr, 2, :, d["uc"]], 1)
        logQ = jnp.concatenate([jnp.log(Q + 1e-300), jnp.zeros(1)])
        pi = jnp.exp(th["lpi"])
        p00 = 1 - 2 * pi[0] - 2 * pi[1] - pi[2]
        lprior = jnp.log(jnp.stack([p00, pi[0], pi[0], pi[1], pi[1], pi[2], jnp.array(1.0)]))
        out = jnp.zeros(nF)
        for fi, idx, dd, mask in d["buckets"]:
            tl = jnp.where(mask, logQ[idx].sum(-1) + lprior[dd], -jnp.inf)
            out = out.at[fi].set(jax.scipy.special.logsumexp(tl, axis=1))
        return out

    def penalty(th, fl, tau_v):
        pen = 0.5 * jnp.sum((th["E"] / tau_v[None, :]) ** 2) * fl[1]
        pen += 0.5 * jnp.sum(jnp.diff(th["cy"]) ** 2) / 0.3 ** 2 + 0.5 * jnp.sum(th["cy"] ** 2) / 1.0 ** 2
        pen += 0.5 * 1e-2 * (jnp.sum(th["w"] ** 2) + jnp.sum(th["h"] ** 2) + jnp.sum(th["th"] ** 2))
        pen += 0.5 * 1e-4 * jnp.sum(th["beta"] ** 2)
        pen += 0.5 * (th["log_su"] / 2.0) ** 2
        return pen

    def obj(flat, d, fl, tau_v, nJ, nF):
        th = unravel(flat, nJ)
        return -jnp.sum(fight_ll(th, d, fl, nF)) + penalty(th, fl, tau_v)

    _JAX["vg"] = jax.jit(jax.value_and_grad(obj), static_argnums=(4, 5))
    _JAX["ll"] = jax.jit(lambda flat, d, fl, nJ, nF: fight_ll(unravel(flat, nJ), d, fl, nF), static_argnums=(3, 4))

    def slot_grad(flat, d, fl, nJ, nF):
        th = unravel(flat, nJ)
        nfr = d["X"].shape[0]
        return jax.grad(lambda ex: jnp.sum(fight_ll(th, d, fl, nF, ex)))(jnp.zeros((nfr, 3, 5)))
    _JAX["sg"] = jax.jit(slot_grad, static_argnums=(3, 4))
    _JAX["jnp"] = jnp
    return _JAX


def flags_of(cfg):
    return np.array([float(cfg.get(k, 1)) for k in ("shared", "judges", "home", "trend")])


class Model:
    """Bound evaluation functions for one design."""

    def __init__(self, dz):
        self.fns = _jax_fns()
        self.dz = dz
        self.data = dz.arrays()

    def vg(self, x, cfg, tau):
        jnp = self.fns["jnp"]
        v, g = self.fns["vg"](jnp.asarray(x), self.data, jnp.asarray(flags_of(cfg)),
                              jnp.asarray([tau[k] for k in EFF]), self.dz.nJ, self.dz.nF)
        return float(v), np.asarray(g, dtype=float)

    def ll(self, x, cfg):
        jnp = self.fns["jnp"]
        return np.asarray(self.fns["ll"](jnp.asarray(x), self.data, jnp.asarray(flags_of(cfg)), self.dz.nJ, self.dz.nF))

    def slot_grad(self, x, cfg):
        jnp = self.fns["jnp"]
        return np.asarray(self.fns["sg"](jnp.asarray(x), self.data, jnp.asarray(flags_of(cfg)), self.dz.nJ, self.dz.nF))


def fit_model(dz, cfg, tau, flat_init=None, maxiter=None, verbose=True, model=None):
    """MAP fit by L-BFGS-B. Returns (x, Model)."""
    from scipy.optimize import minimize
    import os
    M = model or Model(dz)
    x0 = ravel(init_params(dz.nJ)) if flat_init is None else flat_init
    maxiter = maxiter or int(os.environ.get("OFFICIALS_MAXITER", 3000))
    t0 = time.time()
    res = minimize(lambda x: M.vg(x, cfg, tau), x0, jac=True, method="L-BFGS-B",
                   options={"maxiter": maxiter, "maxcor": 30, "gtol": 1e-5})
    if verbose:
        log(f"  fit: {res.nit} it, obj {res.fun:.2f}, {time.time() - t0:.0f}s, {res.message}")
    return res.x, M


def judge_index(rows, min_cards=1):
    c = Counter(cd[0] for r in rows for cd in r["cards"] if cd[0] != "unknown")
    keys = sorted(k for k, n in c.items() if n >= min_cards)
    return {k: i for i, k in enumerate(keys)}


def to_np(th):
    return {k: np.asarray(v) for k, v in th.items()}


def bhhh_sd(dz, th_flat, slot_grad_fn, tau):  # noqa: D401
    """Per-judge posterior covariance of (n, v, p, g, c): (sum_f g_f g_f' + diag(1/tau^2))^-1, where g_f is
    fight f's score with respect to that judge's effects (outer product of per-fight gradients)."""
    G = slot_grad_fn(th_flat)                         # nfr x 3 x 5
    nJ = dz.nJ
    key = (dz.fr_f[:, None].astype(np.int64) * (nJ + 1) + dz.J).ravel()
    gg = G.reshape(-1, 5)
    df = pd.DataFrame(gg, columns=EFF)
    df["key"] = key
    agg = df.groupby("key")[EFF].sum()
    jid = (agg.index.to_numpy() % (nJ + 1))
    A = agg.to_numpy()
    info = np.zeros((nJ + 1, 5, 5))
    np.add.at(info, jid, A[:, :, None] * A[:, None, :])
    prec = info[:nJ] + np.diag([1.0 / tau[k] ** 2 for k in EFF])[None]
    cov = np.linalg.inv(prec)
    return cov, info[:nJ]


def eb_tau(E, cov, ncards, min_cards=1, floor=0.02):
    """Empirical-Bayes update tau_k^2 = mean over judges of (E_jk^2 + Var_jk)."""
    m = ncards >= min_cards
    t2 = (E[m] ** 2 + np.einsum("jkk->jk", cov[m])).mean(0)
    return {k: float(max(floor, math.sqrt(v))) for k, v in zip(EFF, t2)}


DECISION_CLASSES = ["A_UD", "A_SD", "A_MD", "DRAW", "B_MD", "B_SD", "B_UD"]


def simulate_decisions(th, dz, nsim=20000, seed=0, judge_mask=None):
    """Monte Carlo decision outcome probabilities for every fight in a Design (round stats and judges given).
    Returns probs [nF, 7] over DECISION_CLASSES, P(card A > B / A < B / =) per judge [nF, 3, 3] and
    P(any 10-8 on a card) [nF, 3]."""
    rng = np.random.default_rng(seed)
    b, E = th["beta"], th["E"]
    Ez = np.vstack([E, np.zeros((1, 5))])
    if judge_mask is not None:
        Ez = Ez * judge_mask
    su = float(np.exp(th["log_su"]))
    e10 = 1 / (1 + np.exp(-th["lg_e10"]))
    pi = np.exp(th["lpi"])
    pd_ = np.array([1 - 2 * pi[0] - 2 * pi[1] - pi[2], pi[0], pi[0], pi[1], pi[1], pi[2]])
    out = np.zeros((dz.nF, 7))
    cardp = np.zeros((dz.nF, 3, 3))
    any108 = np.zeros((dz.nF, 3))
    starts = np.r_[0, np.cumsum([r["R"] for r in dz.rows])]
    for f in range(dz.nF):
        sl = slice(starts[f], starts[f + 1])
        X = dz.X[sl]
        R = X.shape[0]
        V, K, G = X[:, :3] @ b[:3], X[:, 3] * b[3], X[:, 4:] @ b[4:]
        tt, hm, us, yr = dz.t[sl][0], dz.home[sl][0], dz.us[sl][0], dz.yr[sl][0]
        hh = (th["h"][0] * us + th["h"][1] * (1 - us)) * hm
        u = rng.normal(0, su, (nsim, R))
        totA = np.zeros((nsim, 3))
        totB = np.zeros((nsim, 3))
        n108 = np.zeros((nsim, 3))
        lin = th["th"][0] * V + th["th"][1] * K + th["th"][2] * G
        for j in range(3):
            e = Ez[dz.J[sl][0, j]]
            core = (np.exp(e[1] + th["w"][0] * tt) * V + np.exp(e[2] + th["w"][1] * tt) * K +
                    np.exp(e[3] + th["w"][2] * tt) * G + hh)
            eta = np.exp(e[0]) * (core[None, :] + u)
            aw = rng.random((nsim, R)) < 1 / (1 + np.exp(-eta))
            cc = th["c0"] + th["cy"][yr] + e[4]
            zW = np.where(aw, cc + lin[None, :] + th["th"][3] * u, cc - lin[None, :] - th["th"][3] * u)
            big = rng.random((nsim, R)) < 1 / (1 + np.exp(-zW))
            tie = rng.random((nsim, R)) < e10
            sa = np.where(tie, 10, np.where(aw, 10, np.where(big, 8, 9)))
            sb = np.where(tie, 10, np.where(~aw, 10, np.where(big, 8, 9)))
            totA[:, j] = sa.sum(1)
            totB[:, j] = sb.sum(1)
            n108[:, j] = (big & ~tie).sum(1)
        dopt = rng.choice(6, size=nsim, p=pd_)
        dA = np.array([d[0] for d in DED_OPTS])[dopt]
        dB = np.array([d[1] for d in DED_OPTS])[dopt]
        totA -= dA[:, None]
        totB -= dB[:, None]
        ca = (totA > totB).sum(1)
        cb = (totB > totA).sum(1)
        cd = 3 - ca - cb
        cls = np.full(nsim, 3)
        cls[(ca == 3)] = 0
        cls[(ca == 2) & (cb == 1)] = 1
        cls[(ca == 2) & (cd == 1)] = 2
        cls[(cb == 2) & (cd == 1)] = 4
        cls[(cb == 2) & (ca == 1)] = 5
        cls[(cb == 3)] = 6
        out[f] = np.bincount(cls, minlength=7) / nsim
        for j in range(3):
            cardp[f, j] = [(totA[:, j] > totB[:, j]).mean(), (totA[:, j] < totB[:, j]).mean(),
                           (totA[:, j] == totB[:, j]).mean()]
            any108[f, j] = (n108[:, j] > 0).mean()
    return out, cardp, any108


def actual_class(r):
    """Observed decision class with A = first name in BOUT."""
    if r["winner"] == -1:
        return 3
    cat = r["cat"]
    k = {"U-DEC": 0, "S-DEC": 1, "M-DEC": 2}[cat]
    return k if r["winner"] == 0 else 6 - k


def decision_metrics(probs, rows, eps=1e-4):
    y = np.array([actual_class(r) for r in rows])
    pA = probs[:, :3].sum(1)
    pB = probs[:, 4:].sum(1)
    nd = y != 3
    q = np.clip(pA[nd] / np.maximum(pA[nd] + pB[nd], 1e-12), eps, 1 - eps)
    ya = (y[nd] < 3).astype(float)
    ll_w = -(ya * np.log(q) + (1 - ya) * np.log(1 - q))
    P7 = np.clip(probs, eps, 1)
    P7 = P7 / P7.sum(1, keepdims=True)
    ll7 = -np.log(P7[np.arange(len(y)), y])
    # split-or-majority vs unanimous (orientation-free): P(not unanimous) incl draws
    pnu = 1 - probs[:, 0] - probs[:, 6]
    ynu = ~np.isin(y, [0, 6])
    pnu_c = np.clip(pnu, eps, 1 - eps)
    ll_nu = -(ynu * np.log(pnu_c) + (~ynu) * np.log(1 - pnu_c))
    return {"n": int(len(y)), "n_nondraw": int(nd.sum()),
            "winner_logloss": float(ll_w.mean()), "winner_brier": float(((q - ya) ** 2).mean()),
            "winner_acc": float(((q > 0.5) == (ya == 1)).mean()),
            "class7_logloss": float(ll7.mean()), "split_logloss": float(ll_nu.mean()),
            "pred_split_rate": float(pnu.mean()), "obs_split_rate": float(ynu.mean()),
            "_ll_w": ll_w, "_ll7": ll7, "_ll_nu": ll_nu, "_q": q, "_ya": ya}


def calib_table(q, y, nb=10):
    bins = np.clip((q * nb).astype(int), 0, nb - 1)
    return [{"bin": f"{k / nb:.1f}-{(k + 1) / nb:.1f}", "n": int((bins == k).sum()),
             "pred": float(q[bins == k].mean()) if (bins == k).any() else None,
             "obs": float(y[bins == k].mean()) if (bins == k).any() else None} for k in range(nb)]


def boot_diff(a, b, n=2000, seed=1):
    """Mean of a - b with a bootstrap 95% interval over fights."""
    rng = np.random.default_rng(seed)
    d = np.asarray(a) - np.asarray(b)
    bs = d[rng.integers(0, len(d), (n, len(d)))].mean(1)
    return {"mean": float(d.mean()), "lo": float(np.percentile(bs, 2.5)), "hi": float(np.percentile(bs, 97.5))}


# ================================================================================================
# judge-model driver (walk-forward)
# ================================================================================================
CACHE = ROOT / "out" / "officials"
MODELS = {"indep": {"shared": 0, "judges": 0, "home": 0},
          "league": {"judges": 0, "home": 0},
          "league_home": {"judges": 0},
          "judges": {"home": 0},
          "judges_home": {}}


def remap(x_old, jidx_old, jidx_new):
    """Warm start: carry every parameter over; judge rows by key (new judges start at 0)."""
    th = unravel(np.asarray(x_old), len(jidx_old))
    E = np.zeros((len(jidx_new), 5))
    for k, i in jidx_new.items():
        if k in jidx_old:
            E[i] = th["E"][jidx_old[k]]
    th = dict(th)
    th["E"] = E
    return ravel(th)


class Window:
    """Training decisions before year_end (Jan 1) with their design and compiled model."""

    def __init__(self, rows, nat, year_end):
        self.year_end = year_end
        self.rows = [r for r in rows if r["year"] < year_end]
        self.jidx = judge_index(self.rows)
        self.dz = Design(self.rows, self.jidx, nat, year_end - 1)
        self.M = Model(self.dz)
        starts = np.r_[0, np.cumsum([r["R"] for r in self.dz.rows])][:-1]
        self.ncards = np.bincount(self.dz.J[starts].ravel(), minlength=self.dz.nJ + 1)[:self.dz.nJ]

    def fit(self, model, tau, init=None, init_jidx=None, eb_rounds=0):
        x0 = None if init is None else remap(init, init_jidx or self.jidx, self.jidx)
        cfg = MODELS[model]
        log(f"fit {model} < {self.year_end}: {self.dz.nF} fights, {self.dz.nJ} judges, tau "
            f"{ {k: round(v, 3) for k, v in tau.items()} }")
        x, _ = fit_model(self.dz, cfg, tau, flat_init=x0, model=self.M)
        cov = None
        for k in range(eb_rounds):
            cov, info = bhhh_sd(self.dz, x, lambda z: self.M.slot_grad(z, cfg), tau)
            tau = eb_tau(unravel(x, self.dz.nJ)["E"], cov, self.ncards)
            log(f"  EB tau -> { {k: round(v, 3) for k, v in tau.items()} }")
            x, _ = fit_model(self.dz, cfg, tau, flat_init=x, model=self.M)
        if cfg.get("judges", 1):
            cov, info = bhhh_sd(self.dz, x, lambda z: self.M.slot_grad(z, cfg), tau)
        return {"x": x, "jidx": self.jidx, "tau": tau, "model": model, "year_end": self.year_end, "cov": cov,
                "nF": self.dz.nF, "train_ll": self.M.ll(x, cfg)}


def evaluate(fit, rows, nat, years, nsim=20000, seed=7):
    """Held-out: exact-card log-lik and decision metrics on decisions in `years` with frozen params."""
    te = [r for r in rows if r["year"] in years]
    dz = Design(te, fit["jidx"], nat, fit["year_end"] - 1)
    cfg = MODELS[fit["model"]]
    ll = Model(dz).ll(fit["x"], cfg)
    th = to_np(unravel(np.asarray(fit["x"]), len(fit["jidx"])))
    th_sim = dict(th)
    if not cfg.get("shared", 1):
        th_sim["log_su"] = np.array(-30.0)
    if not cfg.get("judges", 1):
        th_sim["E"] = np.zeros_like(th["E"])
    if not cfg.get("home", 1):
        th_sim["h"] = np.zeros(2)
    if not cfg.get("trend", 1):
        th_sim["w"] = np.zeros(3)
    probs, cardp, any108 = simulate_decisions(th_sim, dz, nsim=nsim, seed=seed)
    return {"fids": [r["fid"] for r in dz.rows], "card_ll": ll, "probs": probs, "cardp": cardp, "any108": any108,
            "years": [r["year"] for r in dz.rows], "rows_meta": [{k: r[k] for k in ("fid", "year", "R", "winner", "cat",
                                                                                    "n0", "n1", "cards", "referee",
                                                                                    "region")} for r in dz.rows]}


def run_fold(rows, nat, test_year, tag, models=("indep", "league", "league_home", "judges", "judges_home"),
             tau_mults=(1.0,), years_eval=None):
    """One walk-forward fold: fit every model on decisions before test_year, evaluate on years_eval.
    Judge-effect variances: empirical Bayes on the training window, times each multiplier in tau_mults."""
    import pickle
    CACHE.mkdir(parents=True, exist_ok=True)
    years_eval = years_eval or [test_year]
    W = Window(rows, nat, test_year)
    base = W.fit("league", TAU_DEFAULT)
    fits = {"league": base}
    jf = W.fit("judges", TAU_DEFAULT, init=base["x"], eb_rounds=2)
    tau_eb = jf["tau"]
    for m in models:
        if m in ("league", "judges", "judges_home"):
            continue
        fits[m] = W.fit(m, tau_eb, init=base["x"])
    for mult in tau_mults:
        tau = {k: v * mult for k, v in tau_eb.items()}
        sfx = "" if mult == 1.0 else f"@{mult:g}"
        f = jf if mult == 1.0 else W.fit("judges", tau, init=jf["x"])
        if "judges" in models:
            fits["judges" + sfx] = f
        if "judges_home" in models:
            fits["judges_home" + sfx] = W.fit("judges_home", tau, init=f["x"])
    res = {}
    for name, f in fits.items():
        ev = evaluate(f, rows, nat, years_eval)
        res[name] = {"eval": ev, "x": f["x"], "jidx": f["jidx"], "tau": f["tau"], "cov": f["cov"], "model": f["model"],
                     "th": to_np(unravel(np.asarray(f["x"]), len(f["jidx"]))), "train_nF": f["nF"],
                     "ncards": W.ncards}
        log(f"  {name}: held-out card ll/fight {ev['card_ll'].mean():.4f} on {len(ev['fids'])} fights")
        with open(CACHE / f"fold_{tag}.pkl", "wb") as fh:
            pickle.dump({"test_year": test_year, "years_eval": years_eval, "tau_eb": tau_eb,
                         "tau_mults": list(tau_mults), "models": res}, fh)
    return res


# ================================================================================================
# referees
# ================================================================================================
SINGLE_RE = re.compile(r"^(Punch|Kick|Knee|Elbow|Spinning Back Fist|Spinning Back Kick|Flying Knee|Spinning Back Elbow|"
                       r"Headbutt|Slam|Stomp) ")
DIV_GROUP = {"Women's Strawweight": "W", "Women's Flyweight": "W", "Women's Bantamweight": "W",
             "Women's Featherweight": "W", "Flyweight": "FLY-BW", "Bantamweight": "FLY-BW",
             "Featherweight": "FW-LW", "Lightweight": "FW-LW", "Welterweight": "WW-MW", "Middleweight": "WW-MW",
             "Light Heavyweight": "LHW-HW", "Heavyweight": "LHW-HW", "Catch Weight": "FW-LW", "Open Weight": "LHW-HW"}


def referee_units(F, S):
    """Fighter-round and fight-level tables for the referee models (fights with round stats)."""
    Fh = F[F.has_stats].copy()
    Fh["referee"] = Fh["REFEREE"].fillna("").str.strip()
    Fh["dgrp"] = Fh.division.map(DIV_GROUP).fillna("FW-LW")
    Fh["single"] = Fh.det.str.match(SINGLE_RE.pattern)
    cols = ["fid", "referee", "dgrp", "year", "title", "five", "single", "DATE"]
    U = S.merge(Fh[cols], on="fid", how="inner")
    U["last"] = U.rnd == U.end_round
    U["ko_fin"] = U["last"] & (U.winner == U.idx) & (U.cat == "KO/TKO") & (U.ko_kind == "strikes")
    U["stand_l"] = U.dist_l + U.clinch_l
    return Fh, U


def design_fixed(df, kind):
    """Fixed-effect design: division group, era, round, five-round, title (+ unit-specific terms)."""
    cols = {}
    for g in ["W", "FLY-BW", "WW-MW", "LHW-HW"]:
        cols["div_" + g] = (df.dgrp == g).astype(float)
    yr = (df.year - 2015) / 10.0
    cols["yr"] = yr
    cols["yr2"] = yr ** 2
    if "rnd" in df:
        cols["rnd"] = (df.rnd - 1).astype(float)
    cols["five"] = df.five.astype(float)
    cols["title"] = df.title.astype(float)
    if kind == "kd":
        cols["kd2"] = (df.kd >= 2).astype(float)
        cols["okd"] = (df.o_kd >= 1).astype(float)
        cols["log_stand"] = np.log1p(df.stand_l)
    if kind in ("single", "follow"):
        cols["kd2"] = (df.kd >= 2).astype(float)
    X = pd.DataFrame(cols, index=df.index)
    X.insert(0, "const", 1.0)
    return X


def glmm_fit(y, X, g, family, offset=None, tau=0.3, ref_levels=None, iters=50, ridge_b=1e-3):
    """Random-intercept GLM by penalized Newton: eta = X b + u_g + offset, u ~ N(0, tau^2).
    family: 'binomial' or 'poisson'. The one-hot random-effect block is handled with group sums, so the
    Hessian is [X'WX, X'WZ; Z'WX, diag(Z'WZ) + 1/tau^2]. Returns beta, u per level with Laplace sds, loglik
    and the Laplace log marginal likelihood (beta profiled)."""
    y = np.asarray(y, float)
    X = np.asarray(X, float)
    off = np.zeros(len(y)) if offset is None else np.asarray(offset, float)
    levels = ref_levels if ref_levels is not None else sorted(set(g))
    li = {k: i for i, k in enumerate(levels)}
    gi = np.array([li.get(k, -1) for k in g])
    ok = gi >= 0
    gi_ok = gi[ok]
    p, G = X.shape[1], len(levels)
    use_re = tau > 0
    beta = np.zeros(p)
    u = np.zeros(G)
    if family == "poisson":
        beta[0] = math.log(max(y.sum(), 0.5) / max(np.exp(off).sum(), 1e-9))
    else:
        m = min(max(y.mean(), 1e-4), 1 - 1e-4)
        beta[0] = math.log(m / (1 - m))

    def eta_of(beta, u):
        e = X @ beta + off
        if use_re:
            e = e.copy()
            e[ok] += u[gi_ok]
        return e

    for _ in range(iters):
        eta = eta_of(beta, u)
        if family == "binomial":
            mu = 1 / (1 + np.exp(-eta))
            W = mu * (1 - mu)
        else:
            mu = np.exp(np.clip(eta, -30, 30))
            W = mu
        r = y - mu
        gb = X.T @ r - ridge_b * beta
        Hbb = (X * W[:, None]).T @ X + ridge_b * np.eye(p)
        if use_re:
            gu = np.bincount(gi_ok, weights=r[ok], minlength=G) - u / tau ** 2
            Duu = np.bincount(gi_ok, weights=W[ok], minlength=G) + 1.0 / tau ** 2
            Hbu = np.zeros((p, G))
            for k in range(p):
                Hbu[k] = np.bincount(gi_ok, weights=(X[ok, k] * W[ok]), minlength=G)
            # Schur complement on beta
            S_ = Hbb - (Hbu / Duu[None, :]) @ Hbu.T
            rhs = gb - Hbu @ (gu / Duu)
            db = np.linalg.solve(S_, rhs)
            du = (gu - Hbu.T @ db) / Duu
        else:
            db = np.linalg.solve(Hbb, gb)
            du = np.zeros(G)
        beta += db
        u += du
        if max(np.abs(db).max(), np.abs(du).max() if G else 0) < 1e-8:
            break
    eta = eta_of(beta, u)
    if family == "binomial":
        mu = 1 / (1 + np.exp(-eta))
        ll = float(np.sum(y * np.log(mu + 1e-12) + (1 - y) * np.log(1 - mu + 1e-12)))
        W = mu * (1 - mu)
    else:
        mu = np.exp(eta)
        ll = float(np.sum(y * eta - mu))
        W = mu
    Hbb = (X * W[:, None]).T @ X + ridge_b * np.eye(p)
    out = {"levels": levels, "tau": tau, "loglik": ll, "family": family, "cols": None, "beta": beta}
    if use_re:
        Duu = np.bincount(gi_ok, weights=W[ok], minlength=G) + 1.0 / tau ** 2
        Hbu = np.zeros((p, G))
        for k in range(p):
            Hbu[k] = np.bincount(gi_ok, weights=(X[ok, k] * W[ok]), minlength=G)
        S_ = Hbb - (Hbu / Duu[None, :]) @ Hbu.T
        Sinv = np.linalg.inv(S_)
        out["beta_sd"] = np.sqrt(np.diag(Sinv))
        # var(u_k) = 1/D_k + (Hbu[:,k]/D_k)' Sinv (Hbu[:,k]/D_k)
        Bk = Hbu / Duu[None, :]
        out["u"] = u
        out["u_sd"] = np.sqrt(1.0 / Duu + np.einsum("pk,pq,qk->k", Bk, Sinv, Bk))
        out["n"] = np.bincount(gi_ok, minlength=G).astype(float)
        out["events"] = np.bincount(gi_ok, weights=y[ok], minlength=G)
        out["log_marginal"] = float(ll - 0.5 * np.sum(u ** 2) / tau ** 2 - G * math.log(tau)
                                    - 0.5 * np.sum(np.log(Duu * tau ** 2)) - 0.5 * np.linalg.slogdet(S_)[1])
    else:
        out["beta_sd"] = np.sqrt(np.diag(np.linalg.inv(Hbb)))
    return out


def glmm_predict(fit, X, g, offset=None):
    X = np.asarray(X, float)
    eta = X @ fit["beta"] + (0 if offset is None else np.asarray(offset, float))
    if "u" in fit:
        li = {k: i for i, k in enumerate(fit["levels"])}
        eta = eta + np.array([fit["u"][li[k]] if k in li else 0.0 for k in g])
    return 1 / (1 + np.exp(-eta)) if fit["family"] == "binomial" else np.exp(eta)


def unit_loss(fit, y, X, g, offset=None):
    mu = glmm_predict(fit, X, g, offset)
    y = np.asarray(y, float)
    if fit["family"] == "binomial":
        mu = np.clip(mu, 1e-9, 1 - 1e-9)
        return -(y * np.log(mu) + (1 - y) * np.log(1 - mu))
    from scipy.special import gammaln
    return mu - y * np.log(np.maximum(mu, 1e-12)) + gammaln(y + 1)


REF_UNITS = {
    "kd_finish": "P(the knockdown scorer finishes by KO/TKO in the same round | fighter-round with >= 1 KD)",
    "kd_single": "P(the finishing blow is a single strike, i.e. stopped on the knockdown blow | KD-round KO finish) "
                 "- proxy for a quick stoppage (no follow-up flurry)",
    "kd_follow": "ground strikes landed by the finisher in the KD-round KO finish (Poisson multiplier) - proxy for "
                 "the time from knockdown to stoppage",
    "stand_tko": "standing TKO without a knockdown: hazard per landed standing (distance + clinch) sig strike, "
                 "rounds where the striker scored no KD",
    "gnp_tko": "ground-and-pound stoppage without a knockdown: hazard per landed ground sig strike",
    "any_ko": "P(fight ends by KO/TKO from strikes) per fight, controls for division/era/format (overall index)",
    "doctor": "P(doctor stoppage) per fight",
    "dq": "P(disqualification) per fight",
}


def ref_unit_frames(F, S):
    Fh, U = referee_units(F, S)
    out = {}
    kd = U[U.kd >= 1].copy()
    out["kd_finish"] = (kd, kd.ko_fin.astype(float), design_fixed(kd, "kd"), None, "binomial")
    kf = kd[kd.ko_fin].copy()
    out["kd_single"] = (kf, kf.single.astype(float), design_fixed(kf, "single"), None, "binomial")
    out["kd_follow"] = (kf, kf.ground_l.astype(float), design_fixed(kf, "follow"), None, "poisson")
    nk = U[(U.kd == 0) & (U.stand_l > 0)].copy()
    y = (nk.ko_fin & nk.ko_pos.isin(["distance", "clinch"])).astype(float)
    out["stand_tko"] = (nk, y, design_fixed(nk, "stand"), np.log(nk.stand_l), "poisson")
    ng = U[(U.kd == 0) & (U.ground_l > 0)].copy()
    y = (ng.ko_fin & (ng.ko_pos == "ground")).astype(float)
    out["gnp_tko"] = (ng, y, design_fixed(ng, "gnp"), np.log(ng.ground_l), "poisson")
    fx = Fh[Fh.five_min].copy()
    fx["five"] = fx.five.astype(bool)
    out["any_ko"] = (fx, ((fx.cat == "KO/TKO") & (fx.ko_kind == "strikes")).astype(float), design_fixed(fx, "fight"),
                     None, "binomial")
    out["doctor"] = (fx, (fx.ko_kind == "doctor").astype(float), design_fixed(fx, "fight"), None, "binomial")
    out["dq"] = (fx, (fx.cat == "DQ").astype(float), design_fixed(fx, "fight")[["const", "yr"]], None, "binomial")
    return out, Fh


TAU_GRID = [0.0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.6, 0.8]


def ref_walkforward(units, tune=(2019, 2023), test_from=2024):
    """Tau per unit by held-out loss on 2019-2023 (fit before 2019); report 2024+ with yearly refits
    (fit on everything before each test year) with and without referee effects."""
    res = {}
    for name, (df, y, X, off, fam) in units.items():
        yr = df.year.to_numpy()
        g = df.referee.to_numpy()
        y = np.asarray(y, float)
        Xa = X.to_numpy(float)
        o = None if off is None else np.asarray(off, float)
        tr = yr < tune[0]
        va = (yr >= tune[0]) & (yr <= tune[1])
        losses = {}
        for tau in TAU_GRID:
            f = glmm_fit(y[tr], Xa[tr], g[tr], fam, None if o is None else o[tr], tau=tau)
            losses[tau] = float(unit_loss(f, y[va], Xa[va], g[va], None if o is None else o[va]).mean())
        tau_star = min(losses, key=losses.get)
        # Laplace marginal on the training window (< 2024) as a cross-check
        trn = yr < test_from
        lm = {}
        for tau in TAU_GRID[1:]:
            f = glmm_fit(y[trn], Xa[trn], g[trn], fam, None if o is None else o[trn], tau=tau)
            lm[tau] = f["log_marginal"]
        tau_lm = max(lm, key=lm.get)
        # test with yearly refits
        L0, L1, nt = [], [], 0
        for ty in sorted(set(yr[yr >= test_from])):
            trw = yr < ty
            te = yr == ty
            f0 = glmm_fit(y[trw], Xa[trw], g[trw], fam, None if o is None else o[trw], tau=0.0)
            f1 = glmm_fit(y[trw], Xa[trw], g[trw], fam, None if o is None else o[trw], tau=max(tau_star, 1e-9))
            L0.append(unit_loss(f0, y[te], Xa[te], g[te], None if o is None else o[te]))
            L1.append(unit_loss(f1, y[te], Xa[te], g[te], None if o is None else o[te]))
        L0, L1 = np.concatenate(L0), np.concatenate(L1)
        res[name] = {"n_units": int(len(y)), "events": float(y.sum()), "tau_tuned": tau_star,
                     "tune_loss": losses, "tau_laplace_pre2024": tau_lm,
                     "test_n": int(len(L0)), "test_events": float(y[yr >= test_from].sum()),
                     "test_loss_league": float(L0.mean()), "test_loss_ref": float(L1.mean()),
                     "test_delta": boot_diff(L1, L0), "family": fam}
        log(f"  ref {name}: n {len(y)}, events {y.sum():.0f}, tau* {tau_star} (Laplace {tau_lm}), "
            f"2024+ loss {L0.mean():.5f} -> {L1.mean():.5f}")
    return res


def ref_final(units, taus, min_show=15, deductions=None):
    """Final per-referee effects fit on all data (for the engine table)."""
    out = {}
    for name, (df, y, X, off, fam) in units.items():
        tau = max(taus.get(name, 0.0), 0.0)
        f = glmm_fit(np.asarray(y, float), X.to_numpy(float), df.referee.to_numpy(), fam,
                     None if off is None else np.asarray(off, float), tau=max(tau, 1e-9))
        f["cols"] = list(X.columns)
        # league reference rate (mean prediction with u = 0 over the recent era)
        rec = df.year.to_numpy() >= 2019
        Xr = X.to_numpy(float)[rec]
        o = None if off is None else np.asarray(off, float)[rec]
        eta0 = Xr @ f["beta"] + (0 if o is None else o)
        if fam == "binomial":
            base = float((1 / (1 + np.exp(-eta0))).mean())
        else:
            base = float(np.exp(eta0).sum() / (np.exp(o).sum() if o is not None else len(eta0)))
        f["league_recent"] = base
        f["recent_n"] = {}
        yrs = df.year.to_numpy()
        for k in f["levels"]:
            f["recent_n"][k] = int(((df.referee.to_numpy() == k) & (yrs >= 2019)).sum())
        out[name] = f
    return out


def load_all():
    """Decisions plus nationality map (cached for the parallel fold processes)."""
    F, S, D, rows, notes, data_max = build_data()
    names = sorted({r["n0"] for r in rows} | {r["n1"] for r in rows})
    T = br._load(RAW / "ufc_fighter_tott.csv")
    T["dob"] = pd.to_datetime(T.DOB, format="%b %d, %Y", errors="coerce")
    dup = T.FIGHTER.duplicated(keep=False)
    dob = T[~dup].set_index("FIGHTER").dob.dropna().to_dict()
    nat, info = load_nationality(names, dob)
    return F, S, D, rows, nat, info, notes, data_max


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", default="all")
    ap.add_argument("--fetch-wikidata", action="store_true")
    ap.add_argument("--test-year", type=int, default=2024)
    ap.add_argument("--tau-mults", default="1")
    ap.add_argument("--tag", default=None)
    ap.add_argument("--eval-years", default=None)
    ap.add_argument("--models", default="indep,league,league_home,judges,judges_home")
    args = ap.parse_args()
    if args.fetch_wikidata:
        fetch_wikidata()
    if args.stage == "fold":
        F, S, D, rows, nat, info, notes, data_max = load_all()
        ev = [int(y) for y in args.eval_years.split(",")] if args.eval_years else None
        run_fold(rows, nat, args.test_year, args.tag or str(args.test_year), models=tuple(args.models.split(",")),
                 tau_mults=tuple(float(m) for m in args.tau_mults.split(",")), years_eval=ev)
