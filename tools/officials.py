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


def load_nationality(people_names):
    """Map ufcstats fighter names to an ISO3 country (Wikidata country for sport, else citizenship,
    else birth country). Matched by normalized name; ambiguous names dropped."""
    if not WIKIDATA.exists():
        return {}, {"matched": 0, "note": "wikidata file missing; run with --fetch-wikidata"}
    w = pd.read_csv(WIKIDATA)
    w["key"] = w["name"].fillna("").map(lambda s: re.sub(r"[^a-z]", "", s.lower()))
    best = {}
    for key, g in w.groupby("key"):
        if not key or g.item.nunique() > 1:
            continue
        for col in ("sc", "cc", "bc"):
            vals = g[col].dropna()
            if len(vals):
                # citizenship can list several countries: take the most frequent (ties: first)
                best[key] = vals.value_counts().index[0]
                break
    out = {}
    for nm in people_names:
        k = re.sub(r"[^a-z]", "", nm.lower())
        if k in best:
            out[nm] = best[k]
    return out, {"wikidata_people": int(w.item.nunique()), "matched_names": len(out),
                 "names_needed": len(people_names)}


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


def main_data_check():
    F, S, D, rows, notes, data_max = build_data()
    sizes = []
    for r in rows:
        tot = 0
        for (dA, dB) in DED_OPTS:
            ps = [card_patterns(r["R"], a, b, dA, dB, r["winner"] == -1) for (_, _, a, b) in r["cards"]]
            if any(p is None for p in ps):
                continue
            tot += np.prod([len(p) for p in ps])
        sizes.append(tot)
    sizes = np.array(sizes)
    log("triples per fight: mean", sizes.mean(), "max", sizes.max(), "total", sizes.sum(),
        "zero", (sizes == 0).sum())
    return rows, sizes


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", default="all")
    ap.add_argument("--fetch-wikidata", action="store_true")
    args = ap.parse_args()
    if args.fetch_wikidata:
        fetch_wikidata()
    if args.stage == "check":
        main_data_check()
