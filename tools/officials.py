#!/usr/bin/env python3
"""
officials.py - v8 engine component: judges and referees, fit on the ufcstats snapshot.

DATA. Every decision's three judges' totals are parsed from DETAILS (ufcstats writes the fight loser's
score first; draw cards are unordered; "Point Deducted: ... by <name>" prefixes are parsed and stripped)
and mapped to the two fighters. Where tools/judgerounds.py has the official round-by-round cards (MMA
Decisions via two GitHub datasets; 3,182 of 3,876 decisions with all three judges, 154 partial panels)
the observed round scores are used, before deductions where known; judges are identified by their MMA
Decisions id (ufcstats spellings mapped to it). Fights from 2026-01-01 on are never used (hidden-data
protocol, docs/BACKLOG.md).

JUDGES. A round-level latent model explains each card: in round r of fight f, judge j sees

    eta_jfr = exp(n_j) * [ exp(v_j + w_V t) * V_fr + exp(p_j + w_K t) * K_fr + exp(g_j + w_G t) * G_fr
                           + h * home_fr + u_fr ],          u_fr ~ N(0, sigma_u^2) shared by the 3 judges
    V = b_head dHead + b_body dBody + b_leg dLeg      (landed strike differentials, A - B)
    K = b_kd dKD                                      (knockdown differential)
    G = b_td dTD + b_ctrl dCtrlMin + b_sub dSubAtt + b_rev dRev
    t = (year - 2017) / 10;  home = [A is a home fighter] - [B is] (Wikidata nationality vs event country)

and scores the round for A with P = sigmoid(eta) (logistic own noise). The round winner W gets a 10-8
with P = sigmoid(c0 + c_year + c_j + th_V V_W + th_K K_W + th_G G_W + th_u u_W) (scores oriented to W);
a 10-10 has a small fixed probability. A card with round scores contributes its observed pattern; a card
known only by its total contributes the sum over every round-outcome pattern (B10-8, B10-9, 10-10,
A10-9, A10-8 per round) consistent with it. The shared noise is integrated per round by Gauss-Hermite
quadrature, which makes the three cards of a fight dependent. Point deductions are latent (fight-level,
per fighter, 0/1/2 points) unless known. Judge effects (n sharpness, v volume, p knockdown, g grappling,
c 10-8 propensity) are Gaussian random effects shrunk to the league: MAP, variances by empirical Bayes
times a multiplier tuned on 2019-2023 (fit before 2019); posterior sds from the information (outer
product of per-fight scores) plus the prior precision. MAP by preconditioned L-BFGS with JAX gradients.

REFEREES. Per-referee random intercepts (penalized GLMs, Laplace/EB and walk-forward tuned shrinkage):
knockdown-round finish conversion; quick-stoppage proxies for KD-to-stoppage time (finishing blow is a
single strike; follow-up ground strikes in the finishing round, quasi-Poisson); standing TKO without a KD
per landed standing strike; ground-and-pound stoppage per landed ground strike; overall KO/TKO rate;
doctor stoppages; DQs; point deductions (observed from MMA Decisions raw vs published round scores).

WALK-FORWARD. Tuning: fit before 2019, score 2019-2023. Held-out: fit before 2024 (frozen), score
2024-01-01..2025-12-31. Final tables: fit on everything before 2026. Never fit on the test period.

Outputs
  data/derived/officials.json   league judging params (with SEs), per-judge table, region pools and
                                summaries, per-referee multipliers and pools, deduction model and checks,
                                held-out metrics
  research/model_officials.md   method, results, recommendation (written from the printed results)
  out/officials/                fold pickles and JAX compilation cache (gitignored)

Usage
  python3 tools/officials.py --stage all     # three folds in parallel, then the post stage (hours under load)
  python3 tools/officials.py --stage fold --test-year 2024 --tag test --eval-years 2024,2025 \
          --tau-mults 0.5,1,2 --models indep,league,league_home,judges,judges_home
  python3 tools/officials.py --stage post    # deductions, referees, tables, officials.json from fold pickles
  python3 tools/officials.py --fetch-wikidata   # refresh data/raw/wikidata_mma_people.csv (nationality)

Needs pandas, numpy, scipy and jax (pip install "jax[cpu]"). Inputs: data/raw/*.csv,
data/derived/judgerounds.json, data/raw/wikidata_mma_people.csv and wikidata_mma_altlabels.csv (Wikidata,
CC0).
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
VAULT_FROM = pd.Timestamp("2026-01-01")   # hidden-data protocol (docs/BACKLOG.md): never fit or score 2026 fights
JUDGEROUNDS = ROOT / "data" / "derived" / "judgerounds.json"
JR_CLEAN = {"agree", "agree_partial_panel", "totals_agree_names_differ"}

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
    import unicodedata
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z]", "", s)


def load_nationality(people_names, dob=None):
    """Map ufcstats fighter names to a set of ISO3 home countries: Wikidata country for sport plus every
    citizenship, else birth country. Matched by normalized English label or alias; a name shared by several Wikidata people
    is resolved by date of birth (ufcstats tale of the tape) or dropped. Fallback: same date of birth and
    same last name."""
    if not WIKIDATA.exists():
        return {}, {"matched": 0, "note": "wikidata file missing; run with --fetch-wikidata"}
    w = pd.read_csv(WIKIDATA)
    alt = pd.read_csv(WIKIDATA_ALT) if WIKIDATA_ALT.exists() else pd.DataFrame(columns=["item", "alt"])
    w["dob"] = pd.to_datetime(w["dob"].astype(str).str[:10], errors="coerce")
    country, wdob = {}, {}
    for item, g in w.groupby("item"):
        # home countries: country for sport plus every citizenship; birth country only when neither is listed
        cs = set(g["sc"].dropna()) | set(g["cc"].dropna())
        if not cs:
            cs = set(g["bc"].dropna())
        if cs:
            country[item] = frozenset(cs)
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


def outcome_code(a, b):
    m = a - b
    return 4 if m >= 2 else 3 if m == 1 else 2 if m == 0 else 1 if m == -1 else 0


def load_judgerounds():
    """Round-by-round judges' scores (tools/judgerounds.py, from MMA Decisions via two GitHub datasets) and a
    map from ufcstats judge-name keys to MMA Decisions judge ids."""
    if not JUDGEROUNDS.exists():
        return {}, {}, {}
    d = json.loads(JUDGEROUNDS.read_text())
    namemap, best = {}, {}
    for jid, j in d["judges"].items():
        for nm, c in (j.get("ufcstats_names") or {}).items():
            k = judge_key(nm)
            if c > best.get(k, 0):
                best[k] = c
                namemap[k] = "m" + str(jid)
        k = judge_key(j["name"])
        if k not in namemap:
            namemap[k] = "m" + str(jid)
    names = {"m" + str(jid): j["name"] for jid, j in d["judges"].items()}
    return d["fights"], namemap, names


def merge_rounds(r, jr, namemap):
    """Replace or complete a decision's DETAILS cards with observed round scores where available.
    Cards become (key, name, A_total, B_total, codes or None); r['dfix'] = deductions known (or None)."""
    R = r["R"]
    det = [(namemap.get(k, "u:" + k) if k != "unknown" else "unknown", nm, a, b, None) for (k, nm, a, b) in r["cards"]]
    r["src"], r["dfix"], r["ded_known"] = "totals", None, None
    if jr is None or not jr.get("complete") or jr["validation"]["ufc"] not in JR_CLEAN:
        r["cards"] = det
        return r
    obs = []
    dA = dB = 0
    for j in jr["judges"]:
        rr = j.get("raw") or j["rounds"]
        if len(rr) != R:
            r["cards"] = det
            return r
        if j.get("raw"):
            dA = max(dA, sum(x[0] for x in j["raw"]) - j["total"][0])
            dB = max(dB, sum(x[1] for x in j["raw"]) - j["total"][1])
        key = "m" + str(j["id"]) if j.get("id") is not None else "unknown"
        obs.append((key, j["name"], j["total"][0], j["total"][1], np.array([outcome_code(a, b) for a, b in rr], np.int8)))
    rest = list(det)
    for o in obs:          # drop the DETAILS card each observed judge corresponds to (name first, then totals)
        hit = None
        for i, c in enumerate(rest):
            if c[0] == o[0]:
                hit = i
                break
        if hit is None:
            for i, c in enumerate(rest):
                if (c[2], c[3]) == (o[2], o[3]) or (r["winner"] == -1 and (c[3], c[2]) == (o[2], o[3])):
                    hit = i
                    break
        if hit is not None:
            rest.pop(hit)
    cards = obs + rest[: max(0, 3 - len(obs))]
    if len(cards) != 3:
        r["cards"] = det
        return r
    r["cards"] = cards
    r["src"] = "rounds" if len(obs) == 3 else "partial"
    if jr.get("raw_known"):
        r["dfix"] = (dA, dB)
        r["ded_known"] = (dA, dB)
    else:
        r["dfix"] = (0, 0)      # D-only fights: published round scores taken as the verdicts
    return r


def build_data():
    F, S, notes, data_max = br.load_data(RAW, SINCE)
    F = F[F.DATE < VAULT_FROM].copy()
    S = S[S.fid.isin(set(F.fid))].copy()
    data_max = F.DATE.max()
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
    JRf, namemap, jnames = load_judgerounds()
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
        r = {"fid": f.fid, "date": f.DATE, "year": int(f.year), "R": R, "n0": f.n0, "n1": f.n1,
             "winner": int(f.winner), "cat": f.cat, "cards": oc, "ded": ded, "region": f.region,
             "country": f.country, "referee": f.referee, "division": f.division, "title": bool(f.title),
             "X": X[FEATS].to_numpy(float), "Xall": X}
        rows.append(merge_rounds(r, JRf.get(str(f.fid).rsplit("/", 1)[-1]), namemap))
    for r in rows:
        if r["src"] == "totals" and r["ded"] is not None:
            r["dfix"] = (r["ded"][0], r["ded"][1])
    global JUDGE_NAMES
    JUDGE_NAMES = jnames
    log(f"decisions kept {len(rows)} (before {VAULT_FROM.date()}); dropped {dict(drop)}; card sources "
        f"{dict(Counter(r['src'] for r in rows))}")
    return F, S, D, rows, notes, data_max


JUDGE_NAMES = {}


def card_n108(card, R):
    """10-8 (or wider) rounds on a card: observed rounds when known, else implied by the total (upper bound)."""
    if card[4] is not None:
        return int(np.isin(card[4], [0, 4]).sum())
    return max(0, 19 * R - card[2] - card[3])


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
    A card with observed round scores contributes its one pattern; a totals-only card every pattern with
    those totals. Returns (codes [n, R] of o1*25+o2*5+o3, dopt [n]) or None. Unknown deductions are
    latent options tried in stages: none/one point per side first; two points and 10-10 rounds only when
    nothing else fits. Known deductions (DETAILS or MMA Decisions raw scores) are fixed (code 6)."""
    R, draw = r["R"], r["winner"] == -1
    fixed = r.get("dfix")
    if fixed is not None:
        stages = [([tuple(fixed)], False), ([tuple(fixed)], True)]
    else:
        stages = [(DED_OPTS[:3], False), (DED_OPTS, False), (DED_OPTS[:3], True), (DED_OPTS, True)]
    for opts, allow in stages:
        P, idx = patterns(R, allow)
        codes, dcode, n = [], [], 0
        for (dA, dB) in opts:
            ps = []
            for card in r["cards"]:
                a, b, obs = card[2], card[3], card[4]
                if obs is not None:
                    ps.append(np.asarray(obs, np.int32)[None, :])
                    continue
                out = []
                for (x, y) in ([(a, b), (b, a)] if (draw and a != b) else [(a, b)]):
                    v = idx.get((x + dA, y + dB))
                    if v is not None:
                        out.append(v)
                if not out:
                    ps = None
                    break
                ps.append(P[np.unique(np.concatenate(out))].astype(np.int32))
            if ps is None:
                continue
            n += len(ps[0]) * len(ps[1]) * len(ps[2])
            if n > cap:
                return None
            P1, P2, P3 = ps
            c = (P1[:, None, None, :] * 25 + P2[None, :, None, :] * 5 + P3[None, None, :, :]).reshape(-1, R)
            codes.append(c)
            dcode.append(np.full(len(c), 6 if fixed is not None else DED_OPTS.index((dA, dB)), np.int8))
        if codes:
            if n > prune and len(codes) > 1 and dcode[0][0] == 0:
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
            hd = (int(r["country"] in a) - int(r["country"] in b)) if (a and b) else 0
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
NODES = 10
TAU_DEFAULT = {"n": 0.15, "v": 0.15, "p": 0.25, "g": 0.2, "c": 0.4}
EFF = ["n", "v", "p", "g", "c"]


def init_params(nJ):
    return {"beta": np.array([0.18, 0.13, 0.10, 2.4, 0.28, 0.46, 0.84, 0.3]), "w": np.zeros(3),
            "log_su": np.array(0.0), "h": np.zeros(2), "c0": np.array(-3.0), "th": np.array([0.3, 0.3, 0.3, 0.3]),
            "cy": np.zeros(NYEARS), "lg_e10": np.array(-6.0), "lpi": np.log(np.array([0.01, 0.002, 0.001])),
            "E": np.zeros((nJ, 5))}


LAYOUT = [("beta", (8,)), ("w", (3,)), ("log_su", ()), ("h", (2,)), ("c0", ()), ("th", (4,)), ("cy", (NYEARS,)),
          ("lg_e10", ()), ("lpi", (3,))]


N_GLOBAL = sum(int(np.prod(sh)) if sh else 1 for _, sh in LAYOUT)


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
    NG = N_GLOBAL

    def grad_g(xg, xE, d, fl, tau_v, nJ, nF):
        return jax.grad(obj)(jnp.concatenate([xg, xE]), d, fl, tau_v, nJ, nF)[:NG]
    _JAX["hg"] = jax.jit(jax.jacfwd(grad_g), static_argnums=(5, 6))
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

    def hess_g(self, x, cfg, tau):
        jnp = self.fns["jnp"]
        x = jnp.asarray(x)
        return np.asarray(self.fns["hg"](x[:N_GLOBAL], x[N_GLOBAL:], self.data, jnp.asarray(flags_of(cfg)),
                                         jnp.asarray([tau[k] for k in EFF]), self.dz.nJ, self.dz.nF))

    def slot_grad(self, x, cfg):
        jnp = self.fns["jnp"]
        return np.asarray(self.fns["sg"](jnp.asarray(x), self.data, jnp.asarray(flags_of(cfg)), self.dz.nJ, self.dz.nF))


def make_precond(M, x, cfg, tau, Tg=None):
    """Linear preconditioner: exact Hessian of the global block (eigenvalues floored; reused if Tg given) and,
    for judge effects, the per-judge information diagonal (outer product of per-fight scores) plus the prior
    precision."""
    t0 = time.time()
    lam = None
    if Tg is None:
        H = M.hess_g(x, cfg, tau)
        H = 0.5 * (H + H.T)
        lam, Q = np.linalg.eigh(H)
        lam = np.maximum(lam, max(1.0, 1e-4 * lam.max()))
        Tg = Q / np.sqrt(lam)[None, :]                 # x_g = x0_g + Tg z_g
    nJ = M.dz.nJ
    dE = np.tile([1.0 / tau[k] ** 2 for k in EFF], (nJ, 1))
    if float(cfg.get("judges", 1)):
        _, info = bhhh_sd(M.dz, x, lambda z: M.slot_grad(z, cfg), tau)
        dE = dE + np.einsum("jkk->jk", info)
    if lam is not None:
        log(f"  preconditioner built in {time.time() - t0:.0f}s (global eig {lam.min():.3g}..{lam.max():.3g})")
    return {"Tg": Tg, "sE": 1.0 / np.sqrt(dE.ravel())}


def fit_model(dz, cfg, tau, flat_init=None, maxiter=None, verbose=True, model=None, precond=None):
    """MAP fit by L-BFGS-B in preconditioned coordinates. Returns (x, Model)."""
    from scipy.optimize import minimize
    import os
    M = model or Model(dz)
    x0 = ravel(init_params(dz.nJ)) if flat_init is None else np.asarray(flat_init, float)
    maxiter = maxiter or int(os.environ.get("OFFICIALS_MAXITER", 3000))
    t0 = time.time()
    if precond is None:
        Tg, sE = np.eye(N_GLOBAL), np.ones(len(x0) - N_GLOBAL)
    else:
        Tg, sE = precond["Tg"], precond["sE"]

    def to_x(z):
        return x0 + np.concatenate([Tg @ z[:N_GLOBAL], sE * z[N_GLOBAL:]])

    def f(z):
        v, g = M.vg(to_x(z), cfg, tau)
        return v, np.concatenate([Tg.T @ g[:N_GLOBAL], sE * g[N_GLOBAL:]])
    it = [0]

    def cb(zk):
        it[0] += 1
        if verbose and it[0] % 50 == 0:
            log(f"    it {it[0]}  {time.time() - t0:.0f}s")
    res = minimize(f, np.zeros(len(x0)), jac=True, method="L-BFGS-B", callback=cb,
                   options={"maxiter": maxiter, "maxcor": 30, "gtol": 1e-3, "ftol": 1e-10})
    if verbose:
        log(f"  fit: {res.nit} it, {res.nfev} evals, obj {res.fun:.2f}, {time.time() - t0:.0f}s, {res.message}")
    return to_x(res.x), M


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
        self.pre = {}

    def fit(self, model, tau, init=None, init_jidx=None, eb_rounds=0):
        x0 = ravel(init_params(self.dz.nJ)) if init is None else remap(init, init_jidx or self.jidx, self.jidx)
        cfg = MODELS[model]
        log(f"fit {model} < {self.year_end}: {self.dz.nF} fights, {self.dz.nJ} judges, tau "
            f"{ {k: round(v, 3) for k, v in tau.items()} }")
        key = "j" if cfg.get("judges", 1) else "l"
        if key not in self.pre:
            pre = make_precond(self.M, x0, cfg, tau)
            x, _ = fit_model(self.dz, cfg, tau, flat_init=x0, model=self.M, precond=pre, maxiter=120)
            self.pre[key] = make_precond(self.M, x, cfg, tau)     # rebuilt near the optimum, reused afterwards
            x0 = x
        pre = make_precond(self.M, x0, cfg, tau, Tg=self.pre[key]["Tg"])
        x, _ = fit_model(self.dz, cfg, tau, flat_init=x0, model=self.M, precond=pre)
        cov = None
        for k in range(eb_rounds):
            cov, info = bhhh_sd(self.dz, x, lambda z: self.M.slot_grad(z, cfg), tau)
            tau = eb_tau(unravel(x, self.dz.nJ)["E"], cov, self.ncards)
            log(f"  EB tau -> { {k: round(v, 3) for k, v in tau.items()} }")
            pre = make_precond(self.M, x, cfg, tau, Tg=self.pre[key]["Tg"])
            x, _ = fit_model(self.dz, cfg, tau, flat_init=x, model=self.M, precond=pre)
        if cfg.get("judges", 1):
            cov, info = bhhh_sd(self.dz, x, lambda z: self.M.slot_grad(z, cfg), tau)
        return {"x": x, "jidx": self.jidx, "tau": tau, "model": model, "year_end": self.year_end, "cov": cov,
                "nF": self.dz.nF, "train_ll": self.M.ll(x, cfg)}


def evaluate(fit, rows, nat, years, nsim=8000, seed=7):
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
    jh = W.fit("judges_home", TAU_DEFAULT, init=base["x"], eb_rounds=1)
    tau_eb = jh["tau"]
    for m in ("indep", "league_home"):
        if m in models:
            fits[m] = W.fit(m, tau_eb, init=base["x"])
    for mult in tau_mults:
        tau = {k: v * mult for k, v in tau_eb.items()}
        sfx = "" if mult == 1.0 else f"@{mult:g}"
        if "judges_home" in models:
            fits["judges_home" + sfx] = jh if mult == 1.0 else W.fit("judges_home", tau, init=jh["x"])
        if "judges" in models:
            fits["judges" + sfx] = W.fit("judges", tau, init=fits.get("judges_home" + sfx, jh)["x"])
    res = {}
    for name, f in fits.items():
        ev = evaluate(f, rows, nat, years_eval) if any(r["year"] in years_eval for r in rows) else None
        res[name] = {"eval": ev, "x": f["x"], "jidx": f["jidx"], "tau": f["tau"], "cov": f["cov"], "model": f["model"],
                     "th": to_np(unravel(np.asarray(f["x"]), len(f["jidx"]))), "train_nF": f["nF"],
                     "ncards": W.ncards}
        if ev is not None:
            log(f"  {name}: held-out card ll/fight {ev['card_ll'].mean():.4f} on {len(ev['fids'])} fights")
        with open(CACHE / f"fold_{tag}.pkl", "wb") as fh:
            pickle.dump({"test_year": test_year, "years_eval": years_eval, "tau_eb": tau_eb,
                         "tau_mults": list(tau_mults), "models": res}, fh)
    return res


# ================================================================================================
# post-fit: deductions, judge indices, pools
# ================================================================================================
DED_GROUPS = {"none": [0], "A": [1, 3], "B": [2, 4], "both": [5]}


def deduction_posterior(x, dz, cfg):
    """P(point deduction | three cards, round stats) per fight, split by fighter. Recorded deductions = 1."""
    import copy
    lls = {}
    base = Model(dz).ll(x, cfg)
    for name, codes in DED_GROUPS.items():
        d2 = copy.copy(dz)
        d2.buckets = [(fi, idx, dd, mask & np.isin(dd, codes)) for fi, idx, dd, mask in dz.buckets]
        lls[name] = Model(d2).ll(x, cfg)
    P = {k: np.exp(np.where(np.isfinite(v), v - base, -np.inf)) for k, v in lls.items()}
    rec = np.array([r["ded"] is not None for r in dz.rows])
    out = pd.DataFrame({"fid": [r["fid"] for r in dz.rows], "p_none": P["none"], "p_A": P["A"], "p_B": P["B"],
                        "p_both": P["both"], "recorded": rec,
                        "referee": [r["referee"] for r in dz.rows], "year": [r["year"] for r in dz.rows]})
    out["p_any"] = np.where(rec, 1.0, 1 - out.p_none)
    return out


def canonical_rounds():
    """A - B round differentials (FEATS order) for interpretable judge indices."""
    return {
        "damage_vs_control": np.array([3, 0, 0, 1, -1, -2.5, 0, 0], float),
        "volume_vs_grappling": np.array([8, 2, 2, 0, -2, -3, -1, 0], float),
        "close_striking": np.array([3, 1, 0, 0, 0, 0, 0, 0], float),
    }


def judge_round_prob(th, e, X, t_era, nodes=40):
    xq, wq = np.polynomial.hermite.hermgauss(nodes)
    u = np.exp(th["log_su"]) * xq * np.sqrt(2.0)
    w = wq / np.sqrt(np.pi)
    b = th["beta"]
    V, K, G = X[..., :3] @ b[:3], X[..., 3] * b[3], X[..., 4:] @ b[4:]
    core = (np.exp(e[..., 1] + th["w"][0] * t_era) * V + np.exp(e[..., 2] + th["w"][1] * t_era) * K +
            np.exp(e[..., 3] + th["w"][2] * t_era) * G)
    eta = np.exp(e[..., 0])[..., None] * (core[..., None] + u)
    return (w / (1 + np.exp(-eta))).sum(-1)


def judge_p108(th, e, X, year_idx, nodes=40):
    """P(10-8 | A wins the round) for a dominant A round."""
    xq, wq = np.polynomial.hermite.hermgauss(nodes)
    u = np.exp(th["log_su"]) * xq * np.sqrt(2.0)
    w = wq / np.sqrt(np.pi)
    b = th["beta"]
    V, K, G = X[:3] @ b[:3], X[3] * b[3], X[4:] @ b[4:]
    z = th["c0"] + th["cy"][year_idx] + e[..., 4][..., None] + th["th"][0] * V + th["th"][1] * K + th["th"][2] * G \
        + th["th"][3] * u
    # weight u by P(A wins | u) so the 10-8 rate is conditional on A winning (league judge)
    eta = V * 1 + K + G + u
    pw = 1 / (1 + np.exp(-eta))
    return ((w * pw) / (1 + np.exp(-z))).sum(-1) / (w * pw).sum()


def judge_table(fit, rows, display, ndraw=1000, seed=3):
    """Per-judge effects with Laplace sds and interpretable indices (current era)."""
    th = fit["th"]
    jidx = fit["jidx"]
    cov = fit["cov"]
    tau = fit["tau"]
    rng = np.random.default_rng(seed)
    t_era = (2026 - 2017) / 10.0
    yidx = 2026 - YEAR0
    CR = canonical_rounds()
    zero = np.zeros(5)
    league = {k: float(judge_round_prob(th, zero, v, t_era)) for k, v in CR.items()}
    dom = np.array([20, 3, 2, 1, 0, 1.0, 0, 0], float)
    league108 = float(judge_p108(th, zero, dom, yidx))
    # empirical stats per judge
    emp = defaultdict(lambda: {"cards": 0, "rounds": 0, "i108": 0, "dissent": 0, "years": [], "regions": Counter(),
                               "recent": 0, "absdev": [], "names": Counter(), "rd_n": 0, "rd_dis": 0,
                               "obs_rounds": 0, "obs108": 0})
    for r in rows:
        R = r["R"]
        cards = r["cards"]
        margins = [c[2] - c[3] for c in cards]
        allobs = all(c[4] is not None for c in cards)
        for i, card in enumerate(cards):
            k, nm, a, b = card[0], card[1], card[2], card[3]
            if k == "unknown":
                continue
            e = emp[k]
            e["cards"] += 1
            e["rounds"] += R
            e["names"][nm] += 1
            e["i108"] += card_n108(card, R)
            if card[4] is not None:
                e["obs_rounds"] += R
                e["obs108"] += int(np.isin(card[4], [0, 4]).sum())
            if allobs:
                # round-level dissent: the other two agree on a winner and this judge does not
                w = [np.sign(np.asarray(c[4], int) - 2) for c in cards]
                oth = [w[q] for q in range(3) if q != i]
                agree = (oth[0] == oth[1]) & (oth[0] != 0)
                e["rd_n"] += int(agree.sum())
                e["rd_dis"] += int((agree & (w[i] != oth[0])).sum())
            e["years"].append(r["year"])
            e["regions"][r["region"]] += 1
            if r["year"] >= 2022:
                e["recent"] += 1
            if r["winner"] != -1:
                win_margin = (a - b) if r["winner"] == 0 else (b - a)
                if r["cat"] in ("S-DEC", "M-DEC") and win_margin <= 0:
                    e["dissent"] += 1
                others = [margins[j] for j in range(3) if j != i]
                e["absdev"].append(abs((a - b) - np.mean(others)))
    out = []
    for k, i in jidx.items():
        e = emp[k]
        m = th["E"][i]
        C = cov[i] if cov is not None else np.diag([tau[q] ** 2 for q in EFF])
        draws = rng.multivariate_normal(m, C, ndraw)
        idx = {}
        for nm_, Xc in CR.items():
            pj = judge_round_prob(th, draws, Xc, t_era)
            pm = float(judge_round_prob(th, m, Xc, t_era))
            lg = math.log(league[nm_] / (1 - league[nm_]))
            lj = np.log(pj / (1 - pj)) - lg
            idx[nm_] = {"p": pm, "logit_vs_league": float(math.log(pm / (1 - pm)) - lg), "sd": float(lj.std())}
        p108 = float(judge_p108(th, m, dom, yidx))
        out.append({"key": k, "name": JUDGE_NAMES.get(k) or (e["names"].most_common(1)[0][0] if e["names"] else k),
                    "cards": e["cards"], "cards_2022_on": e["recent"],
                    "years": [int(min(e["years"])), int(max(e["years"]))] if e["years"] else None,
                    "regions": dict(e["regions"].most_common(4)),
                    "effects": {q: float(m[n]) for n, q in enumerate(EFF)},
                    "sd": {q: float(math.sqrt(C[n, n])) for n, q in enumerate(EFF)},
                    "power_index": idx["damage_vs_control"], "volume_vs_grappling": idx["volume_vs_grappling"],
                    "close_striking": idx["close_striking"],
                    "p108_dominant": p108, "p108_league": league108,
                    "emp_dissent_rate": e["dissent"] / e["cards"] if e["cards"] else None,
                    "emp_round_dissent_rate": e["rd_dis"] / e["rd_n"] if e["rd_n"] else None,
                    "emp_round_dissent_n": e["rd_n"],
                    "emp_obs108_per_round": e["obs108"] / e["obs_rounds"] if e["obs_rounds"] else None,
                    "obs_rounds": e["obs_rounds"],
                    "emp_implied108_per_round": e["i108"] / e["rounds"] if e["rounds"] else None,
                    "emp_mean_abs_dev_from_others": float(np.mean(e["absdev"])) if e["absdev"] else None})
    return out, league, league108


def region_pools(rows, jt, since=2022):
    """Who judges where (cards since `since`), for sampling a panel when officials are unknown."""
    known = {j["key"] for j in jt}
    pools = defaultdict(Counter)
    for r in rows:
        if r["year"] < since:
            continue
        for c in r["cards"]:
            k = c[0]
            if k != "unknown":
                pools[r["region"]][k if k in known else "_other"] += 1
    out = {}
    for reg, c in pools.items():
        tot = sum(c.values())
        out[reg] = {"cards": tot, "judges": [{"key": k, "share": round(v / tot, 4)} for k, v in c.most_common()]}
    return out


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


def glmm_fit(y, X, g, family, offset=None, tau=0.3, ref_levels=None, iters=50, ridge_b=1e-3, disp=1.0):
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
        r = (y - mu) / disp
        W = W / disp
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
        ll = float(np.sum(y * eta - mu)) / disp
        W = mu / disp
    Hbb = (X * W[:, None]).T @ X + ridge_b * np.eye(p)
    out = {"levels": levels, "tau": tau, "loglik": ll, "family": family, "cols": None, "beta": beta, "disp": disp}
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
        # log p(y | tau) ~ l(beta, u) + log N(u; 0, tau^2) + G/2 log 2pi - 1/2 log det H  (beta integrated flat)
        out["log_marginal"] = float(ll - 0.5 * np.sum(u ** 2) / tau ** 2
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


def pearson_disp(y, X, g, fam, off):
    """Quasi-Poisson dispersion from the fixed-effects fit (1 for binomial)."""
    if fam != "poisson":
        return 1.0
    f = glmm_fit(y, X, g, fam, off, tau=0.0)
    mu = glmm_predict(f, X, g, off)
    return float(max(1.0, np.sum((y - mu) ** 2 / np.maximum(mu, 1e-9)) / max(1, len(y) - X.shape[1])))


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
        disp = pearson_disp(y[tr], Xa[tr], g[tr], fam, None if o is None else o[tr])
        losses = {}
        for tau in TAU_GRID:
            f = glmm_fit(y[tr], Xa[tr], g[tr], fam, None if o is None else o[tr], tau=tau, disp=disp)
            losses[tau] = float(unit_loss(f, y[va], Xa[va], g[va], None if o is None else o[va]).mean())
        tau_star = min(losses, key=losses.get)
        # Laplace marginal on the training window (< 2024) as a cross-check
        trn = yr < test_from
        lm = {}
        for tau in TAU_GRID[1:]:
            f = glmm_fit(y[trn], Xa[trn], g[trn], fam, None if o is None else o[trn], tau=tau, disp=disp)
            lm[tau] = f["log_marginal"]
        tau_lm = max(lm, key=lm.get)
        # test with yearly refits
        L0, L1, L2 = [], [], []
        for ty in sorted(set(yr[yr >= test_from])):
            trw = yr < ty
            te = yr == ty
            ot, oe = (None, None) if o is None else (o[trw], o[te])
            f0 = glmm_fit(y[trw], Xa[trw], g[trw], fam, ot, tau=0.0)
            f1 = glmm_fit(y[trw], Xa[trw], g[trw], fam, ot, tau=max(tau_star, 1e-9), disp=disp)
            f2 = glmm_fit(y[trw], Xa[trw], g[trw], fam, ot, tau=tau_lm, disp=disp)
            L0.append(unit_loss(f0, y[te], Xa[te], g[te], oe))
            L1.append(unit_loss(f1, y[te], Xa[te], g[te], oe))
            L2.append(unit_loss(f2, y[te], Xa[te], g[te], oe))
        L0, L1, L2 = np.concatenate(L0), np.concatenate(L1), np.concatenate(L2)
        res[name] = {"n_units": int(len(y)), "events": float(y.sum()), "tau_tuned": tau_star, "dispersion": disp,
                     "tune_loss": losses, "tau_laplace_pre2024": tau_lm,
                     "test_n": int(len(L0)), "test_events": float(y[yr >= test_from].sum()),
                     "test_loss_league": float(L0.mean()), "test_loss_ref": float(L1.mean()),
                     "test_delta": boot_diff(L1, L0), "test_loss_ref_laplace": float(L2.mean()),
                     "test_delta_laplace": boot_diff(L2, L0), "family": fam}
        log(f"  ref {name}: n {len(y)}, events {y.sum():.0f}, tau* {tau_star} (Laplace {tau_lm}), "
            f"2024+ loss {L0.mean():.5f} -> {L1.mean():.5f}")
    return res


def ref_final(units, taus, min_show=15, deductions=None):
    """Final per-referee effects fit on all data (for the engine table)."""
    out = {}
    for name, (df, y, X, off, fam) in units.items():
        tau = max(taus.get(name, 0.0), 0.0)
        ya, Xa, ga = np.asarray(y, float), X.to_numpy(float), df.referee.to_numpy()
        oa = None if off is None else np.asarray(off, float)
        disp = pearson_disp(ya, Xa, ga, fam, oa)
        f = glmm_fit(ya, Xa, ga, fam, oa, tau=max(tau, 1e-9), disp=disp)
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


def referee_pools(Fh, since=2022):
    pools = defaultdict(Counter)
    for reg, ref, yr in zip(Fh.region, Fh.referee, Fh.year):
        if yr >= since and ref:
            pools[reg][ref] += 1
    return {reg: {"fights": sum(c.values()), "referees": [{"name": k, "share": round(v / sum(c.values()), 4)}
                                                          for k, v in c.most_common()]} for reg, c in pools.items()}


def run_referees(F, S, ded=None):
    """Walk-forward referee models, final per-referee table (all data), deduction rates."""
    units, Fh = ref_unit_frames(F, S)
    wf = ref_walkforward(units)
    # published shrinkage: the empirical-Bayes (Laplace) tau on all data; tuned tau kept as a sensitivity value
    taus_eb, taus_tuned = {}, {}
    for name, (df, y, X, off, fam) in units.items():
        ya, Xa, ga = np.asarray(y, float), X.to_numpy(float), df.referee.to_numpy()
        oa = None if off is None else np.asarray(off, float)
        disp = pearson_disp(ya, Xa, ga, fam, oa)
        lm = {t: glmm_fit(ya, Xa, ga, fam, oa, tau=t, disp=disp)["log_marginal"] for t in TAU_GRID[1:]}
        taus_eb[name] = max(lm, key=lm.get)
        taus_tuned[name] = wf[name]["tau_tuned"]
    fin_eb = ref_final(units, taus_eb)
    fin_tuned = ref_final(units, {k: max(v, 1e-9) for k, v in taus_tuned.items()})
    Fall = F.copy()
    Fall["referee"] = Fall["REFEREE"].fillna("").str.strip()
    E = br._load(RAW / "ufc_event_details.csv")
    Fall["region"] = Fall.EVENT.map(dict(zip(E.EVENT, E.LOCATION))).map(lambda l: region_of(l)[1])
    out = {"units": {}, "wf": wf, "taus_eb": taus_eb, "taus_tuned": taus_tuned}
    for name in units:
        out["units"][name] = {"definition": REF_UNITS[name], "family": units[name][4],
                              "n_units": wf[name]["n_units"], "events": wf[name]["events"],
                              "tau_eb_all_data": taus_eb[name], "tau_tuned_2019_2023": taus_tuned[name],
                              "league_rate_2019_on": fin_eb[name]["league_recent"],
                              "fixed_effects": dict(zip(fin_eb[name]["cols"], map(float, fin_eb[name]["beta"]))),
                              "dispersion": fin_eb[name]["disp"],
                              "heldout_2024_on": {k: wf[name][k] for k in ("test_n", "test_events", "test_loss_league",
                                                                         "test_loss_ref", "test_delta",
                                                                         "test_loss_ref_laplace", "test_delta_laplace")}}
    # per-referee rows
    refs = sorted(set(Fall.referee) - {""})
    nf = Fall.groupby("referee").size()
    nf19 = Fall[Fall.year >= 2019].groupby("referee").size()
    yrs = Fall.groupby("referee").year.agg(["min", "max"])
    regs = Fall.groupby("referee").region.agg(lambda x: dict(Counter(x).most_common(3)))
    rows = []
    for ref in refs:
        row = {"name": ref, "fights": int(nf.get(ref, 0)), "fights_2019_on": int(nf19.get(ref, 0)),
               "years": [int(yrs.loc[ref, "min"]), int(yrs.loc[ref, "max"])], "regions": regs.get(ref, {})}
        for name in units:
            for tag, fin in (("", fin_eb), ("_tuned", fin_tuned)):
                f = fin[name]
                li = {k: i for i, k in enumerate(f["levels"])}
                if ref in li:
                    i = li[ref]
                    row[name + tag] = {"mult": float(math.exp(f["u"][i])), "u": float(f["u"][i]),
                                       "sd": float(f["u_sd"][i]), "n": int(f["n"][i]), "events": float(f["events"][i])}
        rows.append(row)
    # quick-stoppage index: single-strike KD finish (logit) minus follow-up strikes (log), tuned-tau effects
    for row in rows:
        if "kd_single_tuned" in row and "kd_follow_tuned" in row:
            row["kd_speed_index"] = row["kd_single_tuned"]["u"] - row["kd_follow_tuned"]["u"]
    out["referees"] = rows
    out["pools"] = referee_pools(Fall)
    out["recorded_deductions"] = None
    if ded is not None:
        d = ded.copy()
        g = d.referee.to_numpy()
        X = np.column_stack([np.ones(len(d)), (d.year.to_numpy() - 2015) / 10.0])
        lm = {t: glmm_fit(d.p_any.to_numpy(), X, g, "binomial", tau=t)["log_marginal"] for t in TAU_GRID[1:]}
        tded = max(lm, key=lm.get)
        f = glmm_fit(d.p_any.to_numpy(), X, g, "binomial", tau=tded)
        li = {k: i for i, k in enumerate(f["levels"])}
        base = float(d[d.year >= 2019].p_any.mean())
        for row in rows:
            if row["name"] in li:
                i = li[row["name"]]
                row["deduction"] = {"decisions": int(f["n"][i]), "expected_deductions": float(f["events"][i]),
                                    "odds_mult": float(math.exp(f["u"][i])), "sd": float(f["u_sd"][i])}
        out["deduction_model"] = {"tau_eb": tded, "league_rate_per_decision_2019_on": base,
                                  "by_year": d.groupby("year").p_any.mean().round(4).to_dict()}
    return out


def metrics_block(ev, rows_by_fid):
    rows = [rows_by_fid[f] for f in ev["fids"]]
    m = decision_metrics(ev["probs"], rows)
    m["card_ll"] = float(np.mean(ev["card_ll"]))
    # 10-8: predicted vs observed share of cards with an implied 10-8 (or deduction)
    obs108 = np.array([[card_n108(c, r["R"]) > 0 for c in r["cards"]] for r in rows])
    m["pred_card108_rate"] = float(ev["any108"].mean())
    m["obs_card108_rate"] = float(obs108.mean())
    return m


def strip_private(m):
    return {k: v for k, v in m.items() if not k.startswith("_")}


def assemble(rows, nat, natinfo, F, S, data_max, notes, refs, ded, dedval, final_fit, final_W):
    import pickle
    by_fid = {r["fid"]: r for r in rows}
    tune = pickle.load(open(CACHE / "fold_tune.pkl", "rb"))
    test = pickle.load(open(CACHE / "fold_test.pkl", "rb"))
    J = {"tuning_2019_2023": {}, "heldout_2024_on": {}}
    # ---- tuning: choose the tau multiplier by the exact-card log-likelihood on 2019-2023
    tm = {}
    for name, v in tune["models"].items():
        mb = metrics_block(v["eval"], by_fid)
        J["tuning_2019_2023"][name] = strip_private(mb)
        tm[name] = mb
    cands = {name: tm[name]["card_ll"] for name in tm if name.startswith("judges_home")}
    best = max(cands, key=cands.get)
    mult = 1.0 if "@" not in best else float(best.split("@")[1])
    J["tau_multiplier"] = mult
    J["tau_eb_pre2019"] = tune["tau_eb"]
    log(f"tuning picks {best} (tau x {mult})")
    sfx = "" if mult == 1.0 else f"@{mult:g}"
    # ---- held-out 2024+
    hm = {}
    for name in ("indep", "league", "league_home", "judges" + sfx, "judges_home" + sfx):
        v = test["models"][name]
        hm[name] = metrics_block(v["eval"], by_fid)
        J["heldout_2024_on"][name.replace(sfx, "")] = strip_private(hm[name])
    L, Jm, JH, LH = hm["league"], hm["judges" + sfx], hm["judges_home" + sfx], hm["league_home"]
    evL, evJ, evJH = (test["models"][n]["eval"] for n in ("league", "judges" + sfx, "judges_home" + sfx))
    J["heldout_2024_on"]["comparisons"] = {
        "judges_vs_league": {"winner_logloss": boot_diff(Jm["_ll_w"], L["_ll_w"]),
                             "class7_logloss": boot_diff(Jm["_ll7"], L["_ll7"]),
                             "split_logloss": boot_diff(Jm["_ll_nu"], L["_ll_nu"]),
                             "card_ll_per_fight": boot_diff(evJ["card_ll"], evL["card_ll"])},
        "judges_home_vs_judges": {"winner_logloss": boot_diff(JH["_ll_w"], Jm["_ll_w"]),
                                  "card_ll_per_fight": boot_diff(evJH["card_ll"], evJ["card_ll"])},
        "league_home_vs_league": {"winner_logloss": boot_diff(LH["_ll_w"], L["_ll_w"]),
                                  "card_ll_per_fight": boot_diff(test["models"]["league_home"]["eval"]["card_ll"],
                                                                 evL["card_ll"])},
        "league_vs_indep": {"winner_logloss": boot_diff(L["_ll_w"], hm["indep"]["_ll_w"]),
                            "class7_logloss": boot_diff(L["_ll7"], hm["indep"]["_ll7"]),
                            "split_logloss": boot_diff(L["_ll_nu"], hm["indep"]["_ll_nu"]),
                            "card_ll_per_fight": boot_diff(evL["card_ll"], test["models"]["indep"]["eval"]["card_ll"])},
        "note": "negative = better for log losses; positive = better for card log-likelihood"}
    pA_L = evL["probs"][:, :3].sum(1)
    pA_J = evJH["probs"][:, :3].sum(1)
    dp = np.abs(pA_J - pA_L)
    J["heldout_2024_on"]["judge_effect_size"] = {
        "median_abs_dP_winner": float(np.median(dp)), "p90_abs_dP_winner": float(np.percentile(dp, 90)),
        "max_abs_dP_winner": float(dp.max()), "share_abs_dP_over_5pts": float((dp > 0.05).mean()),
        "share_favorite_flips": float(((pA_J > 0.5) != (pA_L > 0.5)).mean())}
    J["heldout_2024_on"]["calibration_judges_home"] = calib_table(JH["_q"], JH["_ya"])
    J["heldout_2024_on"]["calibration_indep"] = calib_table(hm["indep"]["_q"], hm["indep"]["_ya"])
    yrs = np.array(evJH["years"])
    J["heldout_2024_on"]["by_year"] = {}
    for y in sorted(set(yrs)):
        msk = yrs == y
        J["heldout_2024_on"]["by_year"][int(y)] = {
            "n": int(msk.sum()), "card_ll_league": float(evL["card_ll"][msk].mean()),
            "card_ll_judges_home": float(evJH["card_ll"][msk].mean())}
    # ---- final fit: league params and judge table
    th = final_fit["th"]
    J["tau"] = final_fit["tau"]
    J["league"] = {
        "features": FEATS, "groups": {g: [f for f in FEATS if GROUP[f] == i] for i, g in enumerate(GROUP_NAMES)},
        "beta": dict(zip(FEATS, map(float, th["beta"]))),
        "head_strike_units": {f: float(b / th["beta"][0]) for f, b in zip(FEATS, th["beta"])},
        "era_trend_per_decade": dict(zip(GROUP_NAMES, map(float, th["w"]))),
        "era_t": "t = (year - 2017) / 10; group weight x exp(w_group * t)",
        "sigma_shared": float(np.exp(th["log_su"])),
        "home": {"usa_events": float(th["h"][0]), "outside_usa": float(th["h"][1])},
        "ten_eight": {"c0": float(th["c0"]), "c_by_year": {int(YEAR0 + i): float(c) for i, c in enumerate(th["cy"])
                                                            if YEAR0 + i <= data_max.year},
                      "theta": dict(zip(["V", "K", "G", "u"], map(float, th["th"])))},
        "p_10_10": float(1 / (1 + np.exp(-th["lg_e10"]))),
        "deduction_prior": dict(zip(["one_point_per_fighter", "two_points_per_fighter", "both_one_point"],
                                    map(float, np.exp(th["lpi"]))))}
    if "se_global" in final_fit:
        se = final_fit["se_global"]
        J["league"]["se"] = {"beta": dict(zip(FEATS, map(float, se["beta"]))),
                             "era_trend_per_decade": dict(zip(GROUP_NAMES, map(float, se["w"]))),
                             "log_sigma_shared": float(se["log_su"]),
                             "home": {"usa_events": float(se["h"][0]), "outside_usa": float(se["h"][1])},
                             "ten_eight_theta": dict(zip(["V", "K", "G", "u"], map(float, se["th"]))),
                             "c0": float(se["c0"]),
                             "note": "Laplace (inverse Hessian of the MAP objective over the global block, judge "
                                     "effects held at their MAP values)"}
    jt, league_idx, league108 = judge_table(final_fit, rows, {})
    jt.sort(key=lambda d: -d["cards"])
    J["league_canonical"] = {"round_prob": league_idx, "p108_dominant": league108}
    J["judges"] = jt
    J["region_pools"] = region_pools(rows, jt)
    jmap = {j["key"]: j for j in jt}
    regsum = {}
    for reg, pool in J["region_pools"].items():
        w = [(jmap[x["key"]], x["share"]) for x in pool["judges"] if x["key"] in jmap]
        tot = sum(sh for _, sh in w) or 1.0
        regsum[reg] = {"cards_2022_on": pool["cards"], "n_judges": len(pool["judges"]),
                       "mean_effects": {q: float(sum(j["effects"][q] * sh for j, sh in w) / tot) for q in EFF},
                       "mean_power_index": float(sum(j["power_index"]["logit_vs_league"] * sh for j, sh in w) / tot),
                       "mean_p108_dominant": float(sum(j["p108_dominant"] * sh for j, sh in w) / tot)}
    # observed 10-8 rate by region (2022+)
    reg108 = defaultdict(lambda: [0, 0])
    for r in rows:
        if r["year"] >= 2022:
            for c in r["cards"]:
                reg108[r["region"]][0] += card_n108(c, r["R"])
                reg108[r["region"]][1] += r["R"]
    for reg in regsum:
        n8, nr = reg108[reg]
        regsum[reg]["obs_implied108_per_round"] = n8 / nr if nr else None
    J["region_summary"] = regsum
    act = [j for j in jt if j["cards_2022_on"] >= 30]
    act.sort(key=lambda d: -d["power_index"]["logit_vs_league"])
    J["power_friendly"] = {"definition": "logit P(judge gives the round to the fighter with +1 KD and +3 head strikes "
                                         "over one with a takedown and 2.5 min control) minus the league judge's; "
                                         "judges with 30+ cards since 2022",
                           "most": [{k: j[k] for k in ("name", "cards", "cards_2022_on", "power_index")} for j in act[:8]],
                           "least": [{k: j[k] for k in ("name", "cards", "cards_2022_on", "power_index")} for j in act[-8:]]}
    J["deductions"] = dedval
    out = {"meta": {"source": "ufcstats snapshot data/raw (DETAILS judges' totals, loser-first; REFEREE); Wikidata "
                              "nationality (CC0) for the home effect", "snapshot": str(data_max.date()),
                    "built": dt.date.today().isoformat(), "tool": "tools/officials.py",
                    "n_decisions": len(rows), "n_cards": 3 * len(rows),
                    "nationality": natinfo, "notes": notes,
                    "walk_forward": "tau multiplier tuned on 2019-2023 (fit before 2019); held-out 2024-01-01 on "
                                    "(fit before 2024, frozen); final tables fit on all data"},
           "judging": J, "referees": refs}
    return out


def to_jsonable(o):
    if isinstance(o, dict):
        return {str(k): to_jsonable(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [to_jsonable(v) for v in o]
    if isinstance(o, (np.floating, float)):
        v = float(o)
        return None if not math.isfinite(v) else round(v, 6)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, np.ndarray):
        return to_jsonable(o.tolist())
    if isinstance(o, (np.bool_,)):
        return bool(o)
    return o


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


def deduction_validation(x, cfg, rows, nat, jidx, year_max):
    """Hide known deductions and check that the totals-only model finds them. Truth: MMA Decisions raw vs
    published round scores (2013-2025, raw_known) plus the deductions DETAILS records (mostly 2001-2015).
    Each validation fight is reduced to its three published card totals with the deduction latent."""
    import copy
    era, truth = [], []
    for r in rows:
        if r.get("ded_known") is not None:
            t = r["ded_known"]
        elif r["ded"] is not None:
            t = (r["ded"][0], r["ded"][1])
        else:
            continue
        q = copy.copy(r)
        q["cards"] = [(c[0], c[1], c[2], c[3], None) for c in r["cards"]]
        q["dfix"], q["ded"] = None, None
        era.append(q)
        truth.append(tuple(t))
    dz = Design(era, jidx, nat, year_max)
    post = deduction_posterior(x, dz, cfg)
    tmap = {r["fid"]: t for r, t in zip(era, truth)}
    post["true"] = post.fid.map(lambda f: sum(tmap[f]) > 0)
    post["true_side"] = post.fid.map(lambda f: "A" if tmap[f][0] > 0 and tmap[f][1] == 0 else
                                     "B" if tmap[f][1] > 0 and tmap[f][0] == 0 else ("both" if sum(tmap[f]) else None))
    y = post.true.to_numpy()
    sc = post.p_any.to_numpy()
    from scipy.stats import rankdata
    rk = rankdata(sc)
    n1, n0 = int(y.sum()), int((~y).sum())
    auc = float((rk[y].sum() - n1 * (n1 + 1) / 2) / (n1 * n0)) if n1 and n0 else None
    rec = post[post.true]
    side_ok = [(row.p_A > row.p_B) == (row.true_side == "A") for row in rec.itertuples() if row.true_side in ("A", "B")]
    top = post.sort_values("p_any", ascending=False).head(n1)
    bins = [0, 0.05, 0.2, 0.5, 0.8, 1.01]
    cal = []
    for lo, hi in zip(bins[:-1], bins[1:]):
        m = (sc >= lo) & (sc < hi)
        cal.append({"bin": f"{lo:.2f}-{min(hi, 1):.2f}", "n": int(m.sum()),
                    "pred": float(sc[m].mean()) if m.any() else None, "obs": float(y[m].mean()) if m.any() else None})
    return {"fights": int(len(post)), "with_deduction": n1, "sum_posterior": float(sc.sum()),
            "posterior_mean_true": float(sc[y].mean()) if n1 else None,
            "posterior_mean_false": float(sc[~y].mean()), "auc": auc,
            "precision_at_n_true": float(top.true.mean()) if n1 else None,
            "side_correct_share": float(np.mean(side_ok)) if side_ok else None, "calibration": cal,
            "excluded_too_many_patterns": int(len(era) - len(post))}


def run_post(rows, nat, natinfo, F, S, data_max, notes):
    import pickle
    final = pickle.load(open(CACHE / "fold_final.pkl", "rb"))
    tune = pickle.load(open(CACHE / "fold_tune.pkl", "rb"))
    cands = {}
    by_fid = {r["fid"]: r for r in rows}
    for name, v in tune["models"].items():
        if name.startswith("judges_home"):
            cands[name] = float(np.mean(v["eval"]["card_ll"]))
    best = max(cands, key=cands.get)
    mult = 1.0 if "@" not in best else float(best.split("@")[1])
    sfx = "" if mult == 1.0 else f"@{mult:g}"
    W = Window(rows, nat, VAULT_FROM.year)
    if "judges_home" + sfx in final["models"]:
        ff = final["models"]["judges_home" + sfx]
    else:
        tau = {k: v * mult for k, v in final["tau_eb"].items()}
        f = W.fit("judges_home", tau, init=final["models"]["judges_home"]["x"])
        ff = {"x": f["x"], "jidx": f["jidx"], "tau": f["tau"], "cov": f["cov"], "model": "judges_home",
              "th": to_np(unravel(np.asarray(f["x"]), len(f["jidx"])))}
    cfg = MODELS["judges_home"]
    # standard errors of the global parameters (Laplace, conditional on the judge effects)
    Hg = W.M.hess_g(ff["x"], cfg, ff["tau"])
    Hg = 0.5 * (Hg + Hg.T)
    try:
        covg = np.linalg.inv(Hg)
        se = np.sqrt(np.clip(np.diag(covg), 0, None))
    except np.linalg.LinAlgError:
        se = np.full(N_GLOBAL, np.nan)
    ff["se_global"] = unravel(np.concatenate([se, np.zeros(5 * len(ff["jidx"]))]), len(ff["jidx"]))
    dedval = deduction_validation(ff["x"], cfg, rows, nat, ff["jidx"], 2025)
    log(f"deduction validation: { {k: v for k, v in dedval.items() if k != 'calibration'} }")
    # observed deductions per decision (MMA Decisions raw scores, 2013-2025) for the referee model
    obs = [{"fid": r["fid"], "referee": r["referee"], "year": r["year"], "p_any": float(sum(r["ded_known"]) > 0)}
           for r in rows if r.get("ded_known") is not None]
    ded = pd.DataFrame(obs)
    dedval["observed_rate_per_decision_by_year"] = ded.groupby("year").p_any.mean().round(4).to_dict()
    dedval["observed_decisions"] = int(len(ded))
    dedval["observed_with_deduction"] = int(ded.p_any.sum())
    refs = run_referees(F, S, ded)
    out = assemble(rows, nat, natinfo, F, S, data_max, notes, refs, ded, dedval, ff, W)
    OUT.write_text(json.dumps(to_jsonable(out), indent=1))
    log(f"wrote {OUT} ({OUT.stat().st_size / 1e3:.0f} KB)")
    with open(CACHE / "post.pkl", "wb") as fh:
        pickle.dump({"ded": ded, "dedval": dedval, "refs": refs, "out": out}, fh)
    return out


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
    elif args.stage == "post":
        F, S, D, rows, nat, info, notes, data_max = load_all()
        run_post(rows, nat, info, F, S, data_max, notes)
    elif args.stage == "all":
        import subprocess
        procs = []
        for tag, ty, ev, models in (("tune", 2019, "2019,2020,2021,2022,2023", "league,league_home,judges_home"),
                                    ("test", 2024, "2024,2025", "indep,league,league_home,judges,judges_home"),
                                    ("final", 2026, "2026", "league,judges_home")):
            procs.append(subprocess.Popen([sys.executable, __file__, "--stage", "fold", "--test-year", str(ty),
                                           "--tag", tag, "--eval-years", ev, "--tau-mults", "0.5,1,2",
                                           "--models", models]))
        for p_ in procs:
            p_.wait()
        F, S, D, rows, nat, info, notes, data_max = load_all()
        run_post(rows, nat, info, F, S, data_max, notes)
