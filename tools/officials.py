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


def fight_triples(r, cap=100000):
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
            return np.vstack(codes), np.concatenate(dcode)
    return None


class Design:
    """Flat arrays for a set of decisions. Judges not in `jidx` (and unnamed cards) map to the zero row."""

    def __init__(self, rows, jidx, nat, year_max_param, cap=100000):
        self.rows, kept = [], []
        X, J, T, home, us, yr, tt, fr_f, tri, tD, tF = [], [], [], [], [], [], [], [], [], [], []
        nJ = len(jidx)
        nfr = 0
        for r in rows:
            t = fight_triples(r, cap)
            if t is None:
                continue
            codes, dcode = t
            fi = len(self.rows)
            self.rows.append(r)
            R = r["R"]
            base = (nfr + np.arange(R)) * 125
            idx = codes + base[None, :]
            pad = np.full((len(idx), 5 - R), -1, np.int64)
            tri.append(np.hstack([idx, pad]))
            tD.append(dcode)
            tF.append(np.full(len(idx), fi, np.int32))
            X.append(r["X"])
            J.append(np.tile([jidx.get(c[0], nJ) for c in r["cards"]], (R, 1)))
            a, b = nat.get(r["n0"]), nat.get(r["n1"])
            hd = (int(a == r["country"]) - int(b == r["country"])) if (a and b) else 0
            home.append(np.full(R, hd, float))
            us.append(np.full(R, float(r["country"] == "USA")))
            yr.append(np.full(R, min(r["year"], year_max_param) - YEAR0))
            tt.append(np.full(R, (r["year"] - 2017) / 10.0))
            fr_f.append(np.full(R, fi))
            nfr += R
        self.nF, self.nfr, self.nJ = len(self.rows), nfr, nJ
        self.X = np.vstack(X)
        self.J = np.vstack(J).astype(np.int32)
        T = np.vstack(tri)
        T[T < 0] = nfr * 125           # padding points at a constant log 1
        self.T = T.astype(np.int32)
        self.tD = np.concatenate(tD).astype(np.int32)
        self.tF = np.concatenate(tF)
        self.home = np.concatenate(home)
        self.us = np.concatenate(us)
        self.yr = np.concatenate(yr).astype(np.int32)
        self.t = np.concatenate(tt)
        self.fr_f = np.concatenate(fr_f).astype(np.int32)


YEAR0, NYEARS = 2001, 2027 - 2001
NODES = 20
TAU_DEFAULT = {"n": 0.15, "v": 0.15, "p": 0.25, "g": 0.2, "c": 0.4}
EFF = ["n", "v", "p", "g", "c"]


def init_params(nJ):
    return {"beta": np.array([0.18, 0.13, 0.10, 2.4, 0.28, 0.46, 0.84, 0.3]), "w": np.zeros(3),
            "log_su": np.log(1.0), "h": np.zeros(2), "c0": -3.0, "th": np.array([0.3, 0.3, 0.3, 0.3]),
            "cy": np.zeros(NYEARS), "lg_e10": -6.0, "lpi": np.log(np.array([0.01, 0.002, 0.001])),
            "E": np.zeros((nJ, 5))}


def make_model(dz, cfg, tau):
    """Returns (objective(theta_flat), per-fight loglik(theta_flat), unravel, flat0)."""
    import jax
    import jax.numpy as jnp
    from jax.flatten_util import ravel_pytree
    jax.config.update("jax_enable_x64", True)
    xq, wq = np.polynomial.hermite.hermgauss(NODES)
    xq = jnp.array(xq * np.sqrt(2.0))
    wq = jnp.array(wq / np.sqrt(np.pi))
    X = jnp.array(dz.X)
    Jx = jnp.array(dz.J)
    T = jnp.array(dz.T)
    tD = jnp.array(dz.tD)
    tF = jnp.array(dz.tF)
    home = jnp.array(dz.home)
    us = jnp.array(dz.us)
    yr = jnp.array(dz.yr)
    tt = jnp.array(dz.t)
    nF, nfr = dz.nF, dz.nfr
    tau_v = jnp.array([tau[k] for k in EFF])
    p0 = init_params(dz.nJ)
    flat0, unravel = ravel_pytree({k: jnp.array(v, dtype=jnp.float64) for k, v in p0.items()})
    use_sh, use_j, use_h, use_tr = (float(cfg.get(k, 1)) for k in ("shared", "judges", "home", "trend"))

    def fr_logP(th, extra=None):
        b = th["beta"]
        V = X[:, :3] @ b[:3]
        K = X[:, 3] * b[3]
        G = X[:, 4:] @ b[4:]
        Ez = jnp.vstack([th["E"] * use_j, jnp.zeros((1, 5))])
        eff = Ez[Jx]                                   # nfr x 3 x 5
        if extra is not None:
            eff = eff + extra
        w = th["w"] * use_tr
        core = (jnp.exp(eff[..., 1] + w[0] * tt[:, None]) * V[:, None] +
                jnp.exp(eff[..., 2] + w[1] * tt[:, None]) * K[:, None] +
                jnp.exp(eff[..., 3] + w[2] * tt[:, None]) * G[:, None] +
                use_h * (th["h"][0] * us + th["h"][1] * (1 - us))[:, None] * home[:, None])
        su = jnp.exp(th["log_su"]) * use_sh
        u = su * xq                                    # G
        eta = jnp.exp(eff[..., 0])[..., None] * (core[..., None] + u[None, None, :])
        lin = th["th"][0] * V + th["th"][1] * K + th["th"][2] * G
        cc = th["c0"] + th["cy"][yr]
        zA = (cc[:, None] + eff[..., 4] + lin[:, None])[..., None] + th["th"][3] * u[None, None, :]
        zB = (cc[:, None] + eff[..., 4] - lin[:, None])[..., None] - th["th"][3] * u[None, None, :]
        ls = jax.nn.log_sigmoid
        e10 = jax.nn.sigmoid(th["lg_e10"])
        l1 = jnp.log1p(-e10)
        lp = jnp.stack([l1 + ls(-eta) + ls(zB), l1 + ls(-eta) + ls(-zB), jnp.log(e10) + 0 * eta,
                        l1 + ls(eta) + ls(-zA), l1 + ls(eta) + ls(zA)], -1)        # nfr x 3 x G x 5
        return lp

    def fight_ll(th, extra=None):
        lp = fr_logP(th, extra)
        P = jnp.exp(lp)
        Q = jnp.einsum("q,nqa,nqb,nqc->nabc", wq, P[:, 0], P[:, 1], P[:, 2]).reshape(-1)
        logQ = jnp.concatenate([jnp.log(Q + 1e-300), jnp.zeros(1)])
        pi = jnp.exp(th["lpi"])
        p00 = 1 - 2 * pi[0] - 2 * pi[1] - pi[2]
        lprior = jnp.log(jnp.stack([p00, pi[0], pi[0], pi[1], pi[1], pi[2], jnp.array(1.0)]))
        tl = logQ[T].sum(1) + lprior[tD]
        m = jax.ops.segment_max(tl, tF, num_segments=nF)
        s = jax.ops.segment_sum(jnp.exp(tl - m[tF]), tF, num_segments=nF)
        return jnp.log(s) + m

    def penalty(th):
        pen = 0.5 * jnp.sum((th["E"] / tau_v[None, :]) ** 2) * use_j
        pen += 0.5 * jnp.sum(jnp.diff(th["cy"]) ** 2) / 0.3 ** 2 + 0.5 * jnp.sum(th["cy"] ** 2) / 1.0 ** 2
        pen += 0.5 * 1e-2 * (jnp.sum(th["w"] ** 2) + jnp.sum(th["h"] ** 2) + jnp.sum(th["th"] ** 2))
        pen += 0.5 * 1e-4 * jnp.sum(th["beta"] ** 2)
        pen += 0.5 * ((th["log_su"] - 0.0) / 2.0) ** 2
        return pen

    def obj(flat):
        th = unravel(flat)
        return -jnp.sum(fight_ll(th)) + penalty(th)

    vg = jax.jit(jax.value_and_grad(obj))
    ll_fn = jax.jit(lambda flat: fight_ll(unravel(flat)))

    def slot_grad(flat):
        th = unravel(flat)
        g = jax.grad(lambda ex: jnp.sum(fight_ll(th, ex)))(jnp.zeros((nfr, 3, 5)))
        return g
    return vg, ll_fn, unravel, np.asarray(flat0), jax.jit(slot_grad)


def fit_model(dz, cfg, tau, flat_init=None, maxiter=3000, verbose=True):
    from scipy.optimize import minimize
    vg, ll_fn, unravel, flat0, slot_grad = make_model(dz, cfg, tau)
    x0 = flat0 if flat_init is None else flat_init

    def f(x):
        v, g = vg(x)
        return float(v), np.asarray(g, dtype=float)
    t0 = time.time()
    res = minimize(f, x0, jac=True, method="L-BFGS-B", options={"maxiter": maxiter, "maxcor": 30, "gtol": 1e-6})
    if verbose:
        log(f"  fit: {res.nit} it, obj {res.fun:.2f}, {time.time() - t0:.0f}s, {res.message}")
    return res.x, unravel, ll_fn, slot_grad


def judge_index(rows, min_cards=1):
    c = Counter(cd[0] for r in rows for cd in r["cards"] if cd[0] != "unknown")
    keys = sorted(k for k, n in c.items() if n >= min_cards)
    return {k: i for i, k in enumerate(keys)}
