#!/usr/bin/env python3
"""Build the v3 fight-engine database from the ufcstats snapshot in data/raw/.

Run from the project root:

    python3 tools/build_db.py                  # default half-life 730 days
    python3 tools/build_db.py --half-life 540  # different time decay for the S sums
    python3 tools/build_db.py --priors-window 4  # trailing years behind each backtest year's priors_asof
    python3 tools/build_db.py --priors-until 2024-01-01 --priors-only --priors-out data/derived/priors_dev.json
                                               # train-only league priors for tuning / dev evaluation (engine v4+)

Writes (see docs/ENGINE_V3_SPEC.md, "Profile format" and "Calibration and validation"):

    data/derived/fighters.json    roster profiles (everyone with a UFC fight since --roster-since)
    data/derived/priors.json      division league rates from fights since 2018-01-01 (before --priors-until if given)
    data/derived/priors_dev.json  (with --priors-until 2024-01-01 --priors-only) train-period league rates
    data/derived/backtest.json    walk-forward pre-fight snapshots for fights since 2019-01-01
    data/derived/elo_report.json  Elo K selection (tuned 2019-2023) and 2024+ metrics
    data/overrides.json           only if missing: appearance placeholders for the default matchup

Everything is derived from the CSVs; nothing is fetched. Pure Python 3 + pandas + numpy.
tools/README.md documents the pipeline, the outputs and how to add or override a fighter.
"""
import argparse
import datetime as dt
import difflib
import json
import math
import os
import re
import sys
import time
import unicodedata
from collections import Counter, defaultdict

import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "data", "derived")
OVERRIDES = os.path.join(ROOT, "data", "overrides.json")

SOURCE = ("ufcstats.com via Greco1899/scrape_ufc_stats (data/raw/*.csv snapshot); "
          "built by tools/build_db.py")

# ------------------------------------------------------------------ sum keys (spec order)
STRIKE_KEYS = "d_att d_lnd c_att c_lnd g_att g_lnd h_att h_lnd b_att b_lnd l_att l_lnd t_att t_lnd".split()
OWN = STRIKE_KEYS + ["kd", "td_att", "td_lnd", "ctrl", "sub_att", "rev"]   # per-row stats of one fighter
OPP = ["o" + k for k in STRIKE_KEYS] + ["okd", "otd_att", "otd_lnd", "octrl", "osub_att", "orev"]
KEYS = (["min", "n", "rds"]
        + STRIKE_KEYS
        + ["o" + k for k in STRIKE_KEYS]
        + ["kd", "okd", "td_att", "td_lnd", "otd_att", "otd_lnd", "ctrl", "octrl",
           "sub_att", "osub_att", "rev", "orev",
           "ko_w", "ko_l", "sub_w", "sub_l", "dec_w", "dec_l",
           "r5_min"]
        + ["r5_min_%d" % k for k in range(1, 6)]
        + ["r5_lnd_%d" % k for k in range(1, 6)])
KI = {k: i for i, k in enumerate(KEYS)}
NK = len(KEYS)
OWN_IDX = np.array([KI[k] for k in OWN])
OPP_IDX = np.array([KI[k] for k in OPP])

# ------------------------------------------------------------------ divisions
DIVISIONS = ["Flyweight", "Bantamweight", "Featherweight", "Lightweight", "Welterweight", "Middleweight",
             "Light Heavyweight", "Heavyweight", "Women's Strawweight", "Women's Flyweight",
             "Women's Bantamweight", "Women's Featherweight", "Catch Weight", "Open Weight"]
LBS = {"Flyweight": 125, "Bantamweight": 135, "Featherweight": 145, "Lightweight": 155, "Welterweight": 170,
       "Middleweight": 185, "Light Heavyweight": 205, "Heavyweight": 265, "Women's Strawweight": 115,
       "Women's Flyweight": 125, "Women's Bantamweight": 135, "Women's Featherweight": 145,
       "Catch Weight": None, "Open Weight": None}
NON_DIV = {"Catch Weight", "Open Weight"}          # bouts that say nothing about a home division
# searched in this order, first hit wins (women's and light heavyweight before their substrings)
DIV_PATTERNS = [("women's strawweight", "Women's Strawweight"), ("women's flyweight", "Women's Flyweight"),
                ("women's bantamweight", "Women's Bantamweight"), ("women's featherweight", "Women's Featherweight"),
                ("light heavyweight", "Light Heavyweight"), ("super heavyweight", "Heavyweight"),
                ("heavyweight", "Heavyweight"), ("middleweight", "Middleweight"), ("welterweight", "Welterweight"),
                ("lightweight", "Lightweight"), ("featherweight", "Featherweight"),
                ("bantamweight", "Bantamweight"), ("flyweight", "Flyweight"), ("strawweight", "Women's Strawweight"),
                ("catch weight", "Catch Weight"), ("catchweight", "Catch Weight"), ("open weight", "Open Weight")]

# bout names that match neither a fighter-details name nor a tott name; checked by hand
MANUAL_ALIASES = {"Nick Galanti": "Nicholas Galanti", "Rafael Cerquiera": "Rafael Cerqueira"}

BACKTEST_FROM = dt.date(2019, 1, 1)
PRIORS_FROM = dt.date(2018, 1, 1)
ELO_TUNE = (2019, 2023)
ELO_TEST_FROM = 2024


# ------------------------------------------------------------------ small helpers
def load(name):
    d = pd.read_csv(os.path.join(RAW, name), dtype=str, keep_default_na=False)
    for c in d.columns:
        d[c] = d[c].astype(str).str.strip()
    d.columns = [c.strip() for c in d.columns]
    return d


def url_id(url):
    return url.rstrip("/").rsplit("/", 1)[-1] if url else ""


def slugify(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii").lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s or "x"


def tokens(s):
    return {t for t in re.split(r"[^a-z]+", slugify(s).replace("-", " ")) if len(t) >= 3}


def rnd(x, sig=4):
    """Compact number for JSON: exact small ints stay ints, floats keep `sig` significant digits."""
    if x is None:
        return None
    if isinstance(x, (bool, np.bool_)):
        return bool(x)
    if isinstance(x, (int, np.integer)):
        return int(x)
    x = float(x)
    if not math.isfinite(x):
        return None
    if x == 0:
        return 0
    if x.is_integer() and abs(x) < 1e7:
        return int(x)
    y = float("%.*g" % (sig, x))
    return int(y) if y.is_integer() and abs(y) < 1e15 else y


def rlist(a, sig=4):
    return [rnd(v, sig) for v in a]


def mmss(sec):
    if sec is None:
        return None
    sec = int(round(sec))
    return "%d:%02d" % (sec // 60, sec % 60)


def parse_mmss(s):
    m = re.match(r"^(\d+):(\d\d)$", s or "")
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None


def parse_date(s, fmt):
    try:
        return dt.datetime.strptime(s, fmt).date()
    except (ValueError, TypeError):
        return None


def parse_height(s):
    m = re.match(r"^(\d+)'\s*(\d+)\"?$", s or "")
    return int(m.group(1)) * 12 + int(m.group(2)) if m else None


def parse_inches(s):
    m = re.match(r"^(\d+(?:\.\d+)?)\"?$", s or "")
    return rnd(float(m.group(1))) if m else None


def parse_lbs(s):
    m = re.match(r"^(\d+)\s*lbs", s or "")
    return int(m.group(1)) if m else None


def division_of(wc):
    low = wc.lower()
    for pat, div in DIV_PATTERNS:
        if pat in low:
            return div
    return "Open Weight"    # early no-weight-class tournaments ("UFC 2 Tournament Title Bout")


def parse_format(s):
    """'3 Rnd (5-5-5)' -> (3, [5, 5, 5]); '1 Rnd + OT (12-3)' -> (1, [12, 3]); 'No Time Limit' -> (1, None)."""
    m = re.match(r"^(\d+)\s*Rnd", s)
    sched = int(m.group(1)) if m else 1
    p = re.search(r"\(([\d\-]+)\)", s)
    lengths = [int(x) for x in p.group(1).split("-") if x] if p else None
    return sched, lengths


def clean_detail(s):
    s = re.sub(r"^to(?=[A-Z])", "", s or "")          # scraper glue: "toCorner Stoppage"
    s = re.sub(r"(Distance|Clinch|Ground|Mount|Guard|Control|Position|Crucifix|Head|Body|Leg)(?=[A-Z])",
               r"\1, ", s)
    return s.strip()


def mode_recent(hist, ref_day, years=3):
    """Most frequent real division in the last `years` before ref_day, else career; ties -> most recent."""
    def pick(items):
        if not items:
            return None
        c = Counter(d for _, d in items)
        best = max(c.values())
        for day, d in reversed(items):        # most recent among the tied
            if c[d] == best:
                return d
    real = [(day, d) for day, d in hist if d not in NON_DIV]
    lo = ref_day - int(round(365.25 * years))
    return (pick([x for x in real if x[0] >= lo]) or pick(real)
            or pick([x for x in hist if x[0] >= lo]) or pick(hist))


def pace_curve(m5, l5, m3, l3):
    """Landed/min by round relative to round 1 (5-round fights; else 3-round fights for rounds 1-3).

    5-round data is used only when some 5-round fight reached round 2: a lone 5-round fight that ended
    in round 1 says nothing about pace and must not hide the 3-round curve."""
    has3 = m3[0] > 0 and l3[0] > 0
    if m5[0] > 0 and l5[0] > 0 and (m5[1] > 0 or not has3):
        base = l5[0] / m5[0]
        return ([rnd((l5[k] / m5[k]) / base, 3) if m5[k] > 0 else None for k in range(5)],
                [rnd(m5[k], 3) for k in range(5)])
    if has3:
        base = l3[0] / m3[0]
        return ([rnd((l3[k] / m3[k]) / base, 3) if m3[k] > 0 else None for k in range(3)] + [None, None],
                [rnd(m3[k], 3) for k in range(3)] + [0, 0])
    return None, None


def pace3_curve(m3, l3):
    """The 3-round curve on its own (rounds 1-3), so a profile keeps it even when `pace` is 5-round."""
    if m3[0] > 0 and l3[0] > 0:
        base = l3[0] / m3[0]
        return ([rnd((l3[k] / m3[k]) / base, 3) if m3[k] > 0 else None for k in range(3)],
                [rnd(m3[k], 3) for k in range(3)])
    return None, None


def write_json(path, obj):
    text = json.dumps(obj, separators=(",", ":"), ensure_ascii=True, allow_nan=False)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    return len(text.encode("utf-8"))


def human(n):
    return "%.2f MB" % (n / 1e6) if n >= 1e6 else "%.1f KB" % (n / 1e3)


# ------------------------------------------------------------------ fights
class Fight:
    __slots__ = ("fid", "idx", "event", "date", "day", "bout", "names", "winner", "method_raw", "method",
                 "cat", "corner", "division", "wc", "title", "tourn", "rnd", "time_s", "lengths", "sched",
                 "fight_s", "detail", "cards", "persons", "stats")


def method_of(raw, winner):
    if winner == "NC":
        return "CNC" if raw == "Could Not Continue" else "NC"
    if winner == "D":
        return "DRAW"
    return {"KO/TKO": "KO", "TKO - Doctor's Stoppage": "DOC", "Submission": "SUB", "Decision - Unanimous": "UD",
            "Decision - Split": "SD", "Decision - Majority": "MD", "DQ": "DQ"}.get(raw, "OTHER")


def parse_fights(log):
    ev = load("ufc_event_details.csv")
    ev_date = {}
    for e in ev.itertuples(index=False):
        d = parse_date(e.DATE, "%B %d, %Y")
        if d:
            ev_date[e.EVENT] = d
    res = load("ufc_fight_results.csv").rename(columns={"TIME FORMAT": "FORMAT"})
    res["idx"] = np.arange(len(res))
    res["known"] = res["EVENT"].isin(set(ev_date))
    # the scrape lists two Noche UFC cards twice under different event names: keep one copy per fight URL
    dups = int(res["URL"].duplicated().sum())
    res = (res.sort_values(["known", "idx"], ascending=[False, True])
              .drop_duplicates("URL", keep="first").sort_values("idx"))
    excluded = []
    fights = []
    for r in res.itertuples(index=False):
        date = ev_date.get(r.EVENT)
        names = r.BOUT.split(" vs. ")
        if date is None or len(names) != 2:
            excluded.append({"event": r.EVENT, "bout": r.BOUT,
                             "why": "event date missing from ufc_event_details.csv" if date is None else "bout name"})
            continue
        f = Fight()
        f.fid = url_id(r.URL)
        f.idx = int(r.idx)
        f.event, f.date, f.day, f.bout = r.EVENT, date, date.toordinal(), r.BOUT
        f.names = (names[0].strip(), names[1].strip())
        f.winner = {"W/L": "A", "L/W": "B", "D/D": "D", "NC/NC": "NC"}.get(r.OUTCOME, "NC")
        f.method_raw = r.METHOD
        f.method = method_of(r.METHOD, f.winner)
        f.cat = {"KO": "ko", "DOC": "ko", "SUB": "sub", "UD": "dec", "SD": "dec", "MD": "dec",
                 "DQ": "dq"}.get(f.method) if f.winner in ("A", "B") else None
        det = clean_detail(r.DETAILS)
        f.corner = f.method == "KO" and "corner" in det.lower()
        f.wc = r.WEIGHTCLASS
        f.division = division_of(r.WEIGHTCLASS)
        f.tourn = "Tournament" in r.WEIGHTCLASS
        f.title = ("Title" in r.WEIGHTCLASS and not f.tourn) or "Championship" in r.WEIGHTCLASS
        f.rnd = int(r.ROUND) if r.ROUND.isdigit() else 1
        f.time_s = parse_mmss(r.TIME)
        f.sched, f.lengths = parse_format(r.FORMAT)
        if f.time_s is None:
            f.fight_s = None
        elif f.lengths:
            f.fight_s = sum(f.lengths[:f.rnd - 1]) * 60 + f.time_s
        else:
            f.fight_s = f.time_s
        # judges' cards: ufcstats writes each card loser-first ("Judge 28 - 29."); store them as [A, B].
        # No-contests (overturned decisions) are skipped: with no winner the orientation is unknown, and the
        # raw order there is not loser-first (e.g. Argueta vs. Johns 2023 lists the original winner first).
        # The raw text stays in `detail`.
        f.cards = None
        if f.winner != "NC" and (f.method in ("UD", "SD", "MD", "DRAW") or r.METHOD.startswith("Decision")
                                 or r.METHOD == "Overturned"):
            pairs = [(int(a), int(b)) for a, b in re.findall(r"(\d+)\s*-\s*(\d+)\.", r.DETAILS)]
            if pairs:
                if f.winner == "A":
                    pairs = [(b, a) for a, b in pairs]
                f.cards = [list(p) for p in pairs[-3:]]
        if f.cards and f.method in ("UD", "SD", "MD", "DRAW"):
            f.detail = " ".join("%d-%d" % tuple(c) for c in f.cards)
        else:
            f.detail = det
        f.persons = None
        f.stats = None
        fights.append(f)
    fights.sort(key=lambda f: (f.day, -f.idx))     # file is newest-first, main event first
    log["duplicate_fight_rows_dropped"] = dups
    log["excluded_fights"] = excluded
    return fights, ev_date


# ------------------------------------------------------------------ people
def build_people(fights, log):
    det = load("ufc_fighter_details.csv")
    tott = load("ufc_fighter_tott.csv")
    det["NAME"] = (det["FIRST"] + " " + det["LAST"]).str.strip().str.replace(r"\s+", " ", regex=True)
    info = {}                                   # url id -> person info
    det_by_name = defaultdict(list)
    for r in det.itertuples(index=False):
        i = url_id(r.URL)
        info[i] = {"id": i, "name": r.NAME, "nick": r.NICKNAME or None, "tott": None}
        det_by_name[r.NAME].append(i)
    tott_by_name = defaultdict(list)
    tott_rows = {}
    for r in tott.itertuples(index=False):
        i = url_id(r.URL)
        row = {"FIGHTER": r.FIGHTER, "HEIGHT": r.HEIGHT, "WEIGHT": r.WEIGHT, "REACH": r.REACH,
               "STANCE": r.STANCE, "DOB": r.DOB}
        tott_rows[i] = row
        tott_by_name[r.FIGHTER].append(i)
        if i not in info:
            info[i] = {"id": i, "name": r.FIGHTER, "nick": None, "tott": None}
    bout_names = set()
    for f in fights:
        bout_names.update(f.names)

    aliases = {}
    candidates = {}
    unmatched = []
    det_names = list(det_by_name)
    for n in sorted(bout_names):
        if n in det_by_name:
            candidates[n] = det_by_name[n]
        elif n in tott_by_name and len(tott_by_name[n]) == 1 and tokens(n) & tokens(info[tott_by_name[n][0]]["name"]):
            candidates[n] = tott_by_name[n]
            aliases[n] = {"to": info[tott_by_name[n][0]]["name"], "how": "tott name"}
        elif n in MANUAL_ALIASES and MANUAL_ALIASES[n] in det_by_name:
            candidates[n] = det_by_name[MANUAL_ALIASES[n]]
            aliases[n] = {"to": MANUAL_ALIASES[n], "how": "manual"}
        else:
            close = [c for c in difflib.get_close_matches(n, det_names, n=3, cutoff=0.88) if c not in bout_names]
            if len(close) == 1 and len(det_by_name[close[0]]) == 1:
                candidates[n] = det_by_name[close[0]]
                aliases[n] = {"to": close[0], "how": "fuzzy"}
            else:
                candidates[n] = []
                unmatched.append(n)

    # ambiguous names: one bout name, several ufcstats people. Resolve per bout by weight, then by
    # continuity with that name's confidently resolved bouts.
    def weight(i):
        row = tott_rows.get(i)
        return parse_lbs(row["WEIGHT"]) if row else None

    def iso_dob(i):
        d = parse_date((tott_rows.get(i) or {}).get("DOB"), "%b %d, %Y")
        return d.isoformat() if d else None

    amb_names = sorted(n for n, c in candidates.items() if len(c) > 1)
    assign = {}                                 # (fid, side) -> person id
    amb_report = []
    for n in amb_names:
        cands = candidates[n]
        bouts = [(f, s) for f in fights for s in (0, 1) if f.names[s] == n]
        sure, unsure = {}, []
        for f, s in bouts:
            lbs = LBS.get(f.division)
            pick = None
            if lbs:
                diffs = sorted((abs(weight(i) - lbs), i) for i in cands if weight(i) is not None)
                if diffs and diffs[0][0] <= 15 and (len(diffs) == 1 or diffs[1][0] >= diffs[0][0] + 10):
                    pick = diffs[0][1]
            if pick:
                sure[(f.fid, s)] = (pick, f.day)
            else:
                unsure.append((f, s))
        for f, s in unsure:
            near = sorted((abs(day - f.day), i) for (i, day) in sure.values() if abs(day - f.day) <= 4 * 365)
            if near:
                sure[(f.fid, s)] = (near[0][1], f.day)
        unresolved = 0
        for f, s in bouts:
            if (f.fid, s) in sure:
                assign[(f.fid, s)] = sure[(f.fid, s)][0]
            else:
                assign[(f.fid, s)] = "amb:" + slugify(n)
                unresolved += 1
        per = Counter(assign[(f.fid, s)] for f, s in bouts)
        item = {
            "name": n,
            "people": [{"id": i, "nick": info[i]["nick"], "lbs": weight(i),
                        "dob": iso_dob(i), "bouts": per.get(i, 0)} for i in cands],
            "unresolved_bouts": unresolved,
            "how": "per bout: nearest tott weight to the division limit (margin >= 10 lb), else the same "
                   "person as the name's nearest confidently resolved bout within 4 years"}
        blank = [i for i in cands if weight(i) is None]
        if blank:
            # the weight rule cannot rule such a person out; say so instead of merging silently
            item["assumption"] = ("%s have no tott weight (no height, weight or date of birth on ufcstats) and "
                                  "are assumed not to be the bout fighter" % ", ".join(blank))
        amb_report.append(item)
    # names shared by several ufcstats people that never appear in a bout: listed for completeness
    for n in sorted(set(k for k, v in det_by_name.items() if len(v) > 1)
                    | set(k for k, v in tott_by_name.items() if len(v) > 1)):
        if n in amb_names:
            continue
        ids = sorted(set(det_by_name.get(n, [])) | set(tott_by_name.get(n, [])))
        amb_report.append({
            "name": n,
            "people": [{"id": i, "nick": info[i]["nick"], "lbs": weight(i),
                        "dob": iso_dob(i), "bouts": 0} for i in ids],
            "unresolved_bouts": 0, "how": "no UFC bouts under this name in the snapshot"})
    amb_report.sort(key=lambda a: a["name"])

    for f in fights:
        ps = []
        for s in (0, 1):
            n = f.names[s]
            c = candidates.get(n) or []
            if len(c) == 1:
                ps.append(c[0])
            elif len(c) > 1:
                ps.append(assign[(f.fid, s)])
            else:
                ps.append("name:" + slugify(n))
        f.persons = tuple(ps)

    # people that actually fought, with display name and tott attributes
    people = {}
    divcount = defaultdict(Counter)
    for f in fights:
        for s in (0, 1):
            divcount[f.persons[s]][f.division] += 1
    distrusted = []
    unverified = []
    for f in fights:
        for s in (0, 1):
            p = f.persons[s]
            if p in people:
                continue
            if p.startswith("amb:") or p.startswith("name:"):
                people[p] = {"id": None, "name": f.names[s], "nick": None, "tott": None}
                continue
            base = info.get(p, {"name": f.names[s], "nick": None})
            people[p] = {"id": p, "name": base["name"], "nick": base["nick"], "tott": None}
    for p, P in people.items():
        if P["id"] is None:
            continue
        name = P["name"]
        row = None
        byname = tott_by_name.get(name, [])
        real = [d for d in divcount[p] if LBS.get(d)]
        home = max(real, key=lambda d: divcount[p][d]) if real else None
        if len(byname) == 1 and name not in amb_names and byname[0] != p and p in tott_rows:
            # crossed rows: this person's own tott row carries another name while the row carrying his name
            # sits under another ufcstats id (Jose Montanha / Henrique Da Silva Lopes). Either row could be
            # his, so trust neither.
            own = tott_rows[p]
            distrusted.append({"name": name, "tott_name": own["FIGHTER"], "tott_lbs": parse_lbs(own["WEIGHT"]),
                               "home": home, "why": "crossed tott rows: own row names %s; the row named %s is "
                                                    "under id %s" % (own["FIGHTER"], name, byname[0])})
        elif len(byname) == 1 and name not in amb_names:
            row = tott_rows[byname[0]]
        elif p in tott_rows:
            row = tott_rows[p]
            if not (tokens(row["FIGHTER"]) & tokens(name)):
                # the tott row under this URL carries another name; keep it only if the weight fits
                w = parse_lbs(row["WEIGHT"])
                if home is None or w is None or abs(w - LBS[home]) > 20:
                    distrusted.append({"name": name, "tott_name": row["FIGHTER"], "tott_lbs": w, "home": home,
                                       "why": "own tott row carries another name and its weight does not fit "
                                              "the home division"})
                    row = None
                else:
                    unverified.append({"name": name, "tott_name": row["FIGHTER"], "tott_lbs": w, "home": home})
        if row:
            dob = parse_date(row["DOB"], "%b %d, %Y")
            P["tott"] = {"dob": dob, "height_in": parse_height(row["HEIGHT"]), "reach_in": parse_inches(row["REACH"]),
                         "stance": row["STANCE"] or None, "lbs": parse_lbs(row["WEIGHT"])}

    # slugs: unique across everyone who fought
    by_slug = defaultdict(list)
    for p, P in people.items():
        by_slug[slugify(P["name"])].append(p)
    for s, ps in by_slug.items():
        if len(ps) == 1:
            people[ps[0]]["slug"] = s
            continue
        used = set()
        for p in ps:
            P = people[p]
            cand = s + "-" + slugify(P["nick"]) if P["nick"] else s + "-" + (P["id"] or "x")[:6]
            if cand in used or cand in by_slug:
                cand = s + "-" + (P["id"] or slugify(p))[:8]
            used.add(cand)
            P["slug"] = cand
    log["aliases"] = aliases
    log["unmatched_names"] = unmatched
    log["ambiguous_names"] = amb_report
    log["tott_distrusted"] = distrusted
    log["tott_unverified"] = unverified
    return people


# ------------------------------------------------------------------ round stats -> per-fight vectors
def build_vectors(fights, log):
    st = load("ufc_fight_stats.csv")
    st = st[st["ROUND"] != ""].copy()
    key = defaultdict(list)
    for f in fights:
        key[(f.event, f.bout)].append(f)
    fmap = {k: v[0] for k, v in key.items() if len(v) == 1}
    st["fight"] = [fmap.get(k) for k in zip(st["EVENT"], st["BOUT"])]
    dropped_amb = int(st["fight"].isna().sum())
    st = st[st["fight"].notna()].copy()
    st["fid"] = [f.fid for f in st["fight"]]
    st["side"] = [0 if n == f.names[0] else (1 if n == f.names[1] else -1) for n, f in zip(st["FIGHTER"], st["fight"])]
    st = st[st["side"] >= 0].copy()
    st["rnd"] = st["ROUND"].str.extract(r"(\d+)", expand=False).astype(int)

    def xy(col, lnd, att):
        ex = st[col].str.extract(r"^(\d+)\s*of\s*(\d+)$")
        st[lnd] = pd.to_numeric(ex[0], errors="coerce").fillna(0.0)
        st[att] = pd.to_numeric(ex[1], errors="coerce").fillna(0.0)

    for col, p in (("DISTANCE", "d"), ("CLINCH", "c"), ("GROUND", "g"), ("HEAD", "h"), ("BODY", "b"),
                   ("LEG", "l"), ("TOTAL STR.", "t"), ("TD", "td")):
        xy(col, p + "_lnd", p + "_att")
    for col, k in (("KD", "kd"), ("SUB.ATT", "sub_att"), ("REV.", "rev")):
        st[k] = pd.to_numeric(st[col], errors="coerce").fillna(0.0)
    ctrl = st["CTRL"].str.extract(r"^(\d+):(\d\d)$")
    st["ctrl"] = (pd.to_numeric(ctrl[0], errors="coerce") * 60 + pd.to_numeric(ctrl[1], errors="coerce")).fillna(0.0)
    st["sig"] = st["d_lnd"] + st["c_lnd"] + st["g_lnd"]

    # minutes in each round: full scheduled length, except the last round = TIME
    def round_min(f, r):
        if r > f.rnd:
            return None
        if r < f.rnd:
            return float(f.lengths[r - 1]) if f.lengths and r - 1 < len(f.lengths) else 5.0
        return f.time_s / 60.0 if f.time_s is not None else None

    st["mins"] = [round_min(f, r) for f, r in zip(st["fight"], st["rnd"])]
    bad = int(st["mins"].isna().sum())
    st = st[st["mins"].notna()]
    agg = st.groupby(["fid", "side"])[OWN].sum()
    own = {k: v for k, v in zip(agg.index, agg.to_numpy(dtype=float))}
    rs = st.groupby(["fid", "side", "rnd"]).agg(sig=("sig", "sum"), mins=("mins", "first"), kd=("kd", "sum"))
    per_round = defaultdict(dict)
    for (fid, side, r), sig, mins, kd in zip(rs.index, rs["sig"], rs["mins"], rs["kd"]):
        per_round[(fid, side)][r] = (float(sig), float(mins), float(kd))

    n_ok = 0
    for f in fights:
        a, b = own.get((f.fid, 0)), own.get((f.fid, 1))
        if a is None or b is None:
            continue
        rounds = sorted(set(per_round[(f.fid, 0)]) | set(per_round[(f.fid, 1)]))
        mins = {r: (per_round[(f.fid, 0)].get(r) or per_round[(f.fid, 1)].get(r))[1] for r in rounds}
        tot = sum(mins.values())
        vecs, r3 = [], []
        for s, mine, theirs in ((0, a, b), (1, b, a)):
            v = np.zeros(NK)
            v[KI["min"]] = tot
            v[KI["n"]] = 1
            v[KI["rds"]] = len(rounds)
            v[OWN_IDX] = mine
            v[OPP_IDX] = theirs
            if f.cat:
                won = (f.winner == "A") == (s == 0)
                if f.cat in ("ko", "sub", "dec"):
                    v[KI[f.cat + ("_w" if won else "_l")]] = 1
            sig = {r: per_round[(f.fid, s)].get(r, (0.0, 0.0, 0.0))[0] for r in rounds}
            if f.sched == 5:
                v[KI["r5_min"]] = tot
                for r in rounds:
                    if r <= 5:
                        v[KI["r5_min_%d" % r]] = mins[r]
                        v[KI["r5_lnd_%d" % r]] = sig[r]
            m3, l3 = np.zeros(3), np.zeros(3)
            if f.sched == 3:
                for r in rounds:
                    if r <= 3:
                        m3[r - 1], l3[r - 1] = mins[r], sig[r]
            vecs.append(v)
            r3.append((m3, l3))
        kd_rounds = [[r for r in rounds if per_round[(f.fid, s)].get(r, (0, 0, 0))[2] > 0] for s in (0, 1)]
        f.stats = {"v": vecs, "r3": r3, "min": tot, "kd_rounds": kd_rounds}
        n_ok += 1
    log["stat_rows_dropped_ambiguous_bout"] = dropped_amb
    log["stat_rows_dropped_bad_round"] = bad
    log["fights_with_stats"] = n_ok


# ------------------------------------------------------------------ Elo
def run_elo(fights, K, boost=1.0, boost_n=5, store=False):
    R = defaultdict(lambda: 1500.0)
    N = Counter()
    pre = {} if store else None
    preds = []
    for f in fights:
        a, b = f.persons
        if a == b:
            continue
        ra, rb = R[a], R[b]
        ea = 1.0 / (1.0 + 10.0 ** ((rb - ra) / 400.0))
        if store:
            pre[f.fid] = (ra, rb)
        if f.winner in ("A", "B") and N[a] >= 1 and N[b] >= 1 and not (a.startswith("amb:") or b.startswith("amb:")):
            preds.append((f.date.year, ea, 1.0 if f.winner == "A" else 0.0))
        if f.winner in ("A", "B", "D"):
            sa = {"A": 1.0, "B": 0.0, "D": 0.5}[f.winner]
            ka = K * (boost if N[a] < boost_n else 1.0)
            kb = K * (boost if N[b] < boost_n else 1.0)
            R[a] = ra + ka * (sa - ea)
            R[b] = rb + kb * ((1.0 - sa) - (1.0 - ea))
        N[a] += 1
        N[b] += 1
    return R, pre, preds


def metrics(rows):
    if not rows:
        return {"n": 0}
    p = np.clip(np.array([r[1] for r in rows]), 1e-6, 1 - 1e-6)
    y = np.array([r[2] for r in rows])
    return {"n": int(len(rows)),
            "log_loss": float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p))),
            "brier": float(np.mean((p - y) ** 2)),
            "accuracy": float(np.mean((p > 0.5) == (y > 0.5)))}


def calib_bins(rows, nb=10):
    out = []
    for k in range(nb):
        lo, hi = k / nb, (k + 1) / nb
        sel = [r for r in rows if lo <= r[1] < hi or (k == nb - 1 and r[1] == 1.0)]
        if sel:
            out.append({"lo": lo, "hi": hi, "n": len(sel), "pred": rnd(np.mean([r[1] for r in sel])),
                        "obs": rnd(np.mean([r[2] for r in sel]))})
    return out


def tune_elo(fights):
    grid = []
    for K in range(16, 81, 4):
        for boost in (1.0, 1.5, 2.0, 2.5):
            _, _, preds = run_elo(fights, K, boost)
            tune = metrics([r for r in preds if ELO_TUNE[0] <= r[0] <= ELO_TUNE[1]])
            grid.append({"K": K, "boost": boost, "tune": tune})
    best = min(grid, key=lambda g: g["tune"]["log_loss"])
    R, pre, preds = run_elo(fights, best["K"], best["boost"], store=True)
    test_rows = [r for r in preds if r[0] >= ELO_TEST_FROM]
    report = {
        "rule": "walk-forward Elo over every UFC fight since 1994; start 1500; scale 400; draws score 0.5; "
                "no-contests skipped; K multiplied by `boost` while a fighter has fewer than 5 prior UFC fights",
        "selection": "minimum log loss on %d-%d decisive fights where both men had a prior UFC fight" % ELO_TUNE,
        "chosen": {"K": best["K"], "boost": best["boost"], "boost_fights": 5},
        "tune_2019_2023": best["tune"],
        "test_2024_plus": metrics(test_rows),
        "test_calibration": calib_bins(test_rows),
        "coin_flip_log_loss": math.log(2),
        "grid": [{"K": g["K"], "boost": g["boost"], "log_loss": rnd(g["tune"]["log_loss"], 5),
                  "brier": rnd(g["tune"]["brier"], 5), "accuracy": rnd(g["tune"]["accuracy"], 4)} for g in grid],
    }
    return R, pre, report


# ------------------------------------------------------------------ walk-forward profiles + backtest
def side_actual(v):
    g = lambda k: rnd(v[KI[k]])
    return {"sig_lnd": rnd(v[KI["d_lnd"]] + v[KI["c_lnd"]] + v[KI["g_lnd"]]),
            "sig_att": rnd(v[KI["d_att"]] + v[KI["c_att"]] + v[KI["g_att"]]),
            "kd": g("kd"), "td_lnd": g("td_lnd"), "td_att": g("td_att"), "ctrl": g("ctrl"),
            "sub_att": g("sub_att"), "h_lnd": g("h_lnd"), "b_lnd": g("b_lnd"), "l_lnd": g("l_lnd")}


def new_state():
    return {"S": np.zeros(NK), "C": np.zeros(NK), "t": None, "n_all": 0, "ko_losses": 0, "hist": [],
            "r3m": np.zeros(3), "r3l": np.zeros(3), "fights": [],
            "rec": Counter()}


def walk(fights, people, elo_pre, half_life):
    state = defaultdict(new_state)
    entries = []
    lam = math.log(2) / half_life

    def decay_to(stt, day):
        if stt["t"] is not None and day > stt["t"]:
            stt["S"] *= math.exp(-lam * (day - stt["t"]))
        stt["t"] = day if stt["t"] is None else max(stt["t"], day)

    for f in fights:
        a, b = f.persons
        if a == b:
            continue
        sa, sb = state[a], state[b]
        decay_to(sa, f.day)
        decay_to(sb, f.day)
        if (f.date >= BACKTEST_FROM and sa["n_all"] >= 1 and sb["n_all"] >= 1
                and not a.startswith("amb:") and not b.startswith("amb:")):
            sides = {}
            for tag, p, stt, elo in (("A", a, sa, elo_pre[f.fid][0]), ("B", b, sb, elo_pre[f.fid][1])):
                P = people[p]
                T = P["tott"] or {}
                dob = T.get("dob")
                pace, pace_w = pace_curve(stt["C"][[KI["r5_min_%d" % k] for k in range(1, 6)]],
                                          stt["C"][[KI["r5_lnd_%d" % k] for k in range(1, 6)]],
                                          stt["r3m"], stt["r3l"])
                pace3, pace3_w = pace3_curve(stt["r3m"], stt["r3l"])
                sides[tag] = {
                    "slug": P["slug"], "name": P["name"],
                    "age": rnd((f.date - dob).days / 365.25, 3) if dob else None,
                    "n": stt["n_all"], "ko_losses": stt["ko_losses"], "kd_absorbed": rnd(stt["C"][KI["okd"]]),
                    "elo": rnd(elo, 4), "home": mode_recent(stt["hist"], f.day),
                    "height_in": T.get("height_in"), "reach_in": T.get("reach_in"), "stance": T.get("stance"),
                    "pace": pace, "pace_w": pace_w, "pace3": pace3, "pace3_w": pace3_w,
                    "S": rlist(stt["S"]),
                }
            e = {"id": f.fid, "date": f.date.isoformat(), "event": f.event, "division": f.division,
                 "rounds": f.sched, "title": f.title}
            if f.division in NON_DIV:
                # catch / open weight priors mix men and women: point at the heavier pre-fight home division
                homes = [sides[t]["home"] for t in ("A", "B") if LBS.get(sides[t]["home"])]
                if homes:
                    e["prior_division"] = max(homes, key=lambda d: LBS[d])
            if f.tourn:
                e["tourn"] = True
            e["A"], e["B"] = sides["A"], sides["B"]
            e["result"] = {"winner": f.winner, "method": f.method, "round": f.rnd, "time_s": f.time_s,
                           "fight_s": f.fight_s, "detail": f.detail}
            if f.corner:
                e["result"]["corner"] = True
            if f.cards:
                e["result"]["cards"] = f.cards
            if f.stats:
                e["actual"] = {"A": side_actual(f.stats["v"][0]), "B": side_actual(f.stats["v"][1]),
                               "minutes": rnd(f.stats["min"])}
            else:
                e["actual"] = None
            entries.append(e)
        # apply the fight
        for s, p, stt in ((0, a, sa), (1, b, sb)):
            if f.stats:
                v = f.stats["v"][s]
                stt["S"] += v
                stt["C"] += v
                m3, l3 = f.stats["r3"][s]
                stt["r3m"] += m3
                stt["r3l"] += l3
            stt["n_all"] += 1
            stt["hist"].append((f.day, f.division))
            stt["fights"].append((f, s))
            won = f.winner == ("A" if s == 0 else "B")
            lost = f.winner == ("B" if s == 0 else "A")
            rec = stt["rec"]
            if f.winner == "D":
                rec["d"] += 1
            elif f.winner == "NC":
                rec["nc"] += 1
            elif won or lost:
                rec["w" if won else "l"] += 1
                c = f.cat or "other"
                rec[c + ("_w" if won else "_l")] += 1
                if lost and f.method == "KO":
                    stt["ko_losses"] += 1
    return state, entries


# ------------------------------------------------------------------ priors
PRIOR_MIN_FIGHTS = 20                     # fewer stat fights than this in the window -> borrow another group
PRIOR_FALLBACK = {"Women's Featherweight": "Women's Bantamweight"}   # else "ALL"


def build_priors(fights, since, until=None):
    """League rates from fights with since <= date (< until when given)."""
    G = defaultdict(lambda: {"v": np.zeros(NK), "r3m": np.zeros(3), "r3l": np.zeros(3), "nf": 0, "nstat": 0,
                             "kd_r": 0, "kd_fin": 0,
                             "fmt": {3: Counter(), 5: Counter()}, "mins": {3: [], 5: []}, "allmins": []})
    for f in fights:
        if f.date < since or (until is not None and f.date >= until):
            continue
        for g in (f.division, "ALL"):
            X = G[g]
            X["nf"] += 1
            if f.sched in (3, 5):
                c = X["fmt"][f.sched]
                c["n"] += 1
                if f.method in ("KO", "DOC") and f.rnd <= f.sched:
                    c["KO%d" % f.rnd] += 1
                elif f.method == "SUB" and f.rnd <= f.sched:
                    c["SUB%d" % f.rnd] += 1
                elif f.method in ("UD", "SD", "MD"):
                    c["DEC"] += 1
                    c[f.method] += 1
                elif f.method == "DRAW":
                    c["DRAW"] += 1
                else:
                    c["OTH"] += 1
                if f.fight_s is not None:
                    X["mins"][f.sched].append(f.fight_s / 60.0)
            if f.fight_s is not None:
                X["allmins"].append(f.fight_s / 60.0)
            if f.stats:
                X["nstat"] += 1
                for s in (0, 1):
                    X["v"] += f.stats["v"][s]
                    m3, l3 = f.stats["r3"][s]
                    X["r3m"] += m3
                    X["r3l"] += l3
                    for r in f.stats["kd_rounds"][s]:
                        X["kd_r"] += 1
                        if f.method == "KO" and f.rnd == r and f.winner == ("A" if s == 0 else "B"):
                            X["kd_fin"] += 1
    out = {}
    for g in DIVISIONS + ["ALL"]:
        if g not in G:
            continue
        X = G[g]
        v = X["v"]
        m = v[KI["min"]]
        if m <= 0:
            continue
        val = lambda k: v[KI[k]]
        ratio = lambda a, b: rnd(a / b) if b > 0 else None
        P = {"lbs": LBS.get(g), "n_fights": X["nf"], "n_stat_fights": X["nstat"], "fighter_min": rnd(m)}
        for k in KEYS:
            P[k] = rnd(val(k) / m)                      # per fighter-minute
        for p in ("d", "c", "g", "h", "b", "l", "t"):
            P["acc_" + p] = ratio(val(p + "_lnd"), val(p + "_att"))
        sig_l = val("d_lnd") + val("c_lnd") + val("g_lnd")
        sig_a = val("d_att") + val("c_att") + val("g_att")
        P["acc_sig"] = ratio(sig_l, sig_a)
        P["slpm"] = rnd(sig_l / m)
        P["kd_per_h"] = ratio(val("kd"), val("h_lnd"))
        P["kd15"] = rnd(15 * val("kd") / m)
        P["td_acc"] = ratio(val("td_lnd"), val("td_att"))
        P["td15"] = rnd(15 * val("td_lnd") / m)
        P["ctrl_per_td"] = ratio(val("ctrl"), val("td_lnd"))
        P["ctrl15"] = rnd(15 * val("ctrl") / m)
        P["sub15"] = rnd(15 * val("sub_att") / m)
        P["sub_conv"] = ratio(val("sub_w"), val("sub_att"))
        P["kd_fin"] = ratio(X["kd_fin"], X["kd_r"])
        for sched in (3, 5):
            c = X["fmt"][sched]
            n = c["n"]
            if n == 0:
                P["fin%d" % sched] = None
                P["dec%d" % sched] = None
                continue
            P["fin%d" % sched] = {"n": n,
                                  "KO": [rnd(c["KO%d" % r] / n) for r in range(1, sched + 1)],
                                  "SUB": [rnd(c["SUB%d" % r] / n) for r in range(1, sched + 1)],
                                  "DEC": rnd(c["DEC"] / n), "DRAW": rnd(c["DRAW"] / n), "OTH": rnd(c["OTH"] / n)}
            nd = c["DEC"]
            P["dec%d" % sched] = ({"UD": rnd(c["UD"] / nd), "SD": rnd(c["SD"] / nd), "MD": rnd(c["MD"] / nd)}
                                  if nd else None)
            P["mpf%d" % sched] = rnd(np.mean(X["mins"][sched])) if X["mins"][sched] else None
        P["mpf"] = rnd(np.mean(X["allmins"])) if X["allmins"] else None
        p5, _ = pace_curve([val("r5_min_%d" % k) for k in range(1, 6)], [val("r5_lnd_%d" % k) for k in range(1, 6)],
                           [0, 0, 0], [0, 0, 0])
        p3, _ = pace_curve([0] * 5, [0] * 5, X["r3m"], X["r3l"])
        P["pace5"] = p5
        P["pace3"] = p3[:3] if p3 else None
        out[g] = P
    # divisions with no or too few fights in the window (Open Weight since 2018; Women's Featherweight in early
    # backtest windows): borrow the rates of a related group, keeping the group's own counts for reference
    for g in DIVISIONS:
        n_own = G[g]["nstat"] if g in G else 0
        if g in out and n_own >= PRIOR_MIN_FIGHTS:
            continue
        fb = PRIOR_FALLBACK.get(g)
        if not (fb in out and out[fb]["n_stat_fights"] >= PRIOR_MIN_FIGHTS and "fallback" not in out[fb]):
            fb = "ALL"
        if fb in out:
            out[g] = dict(out[fb], lbs=LBS.get(g), n_fights=G[g]["nf"] if g in G else 0, n_stat_fights=n_own,
                          fallback=fb)
    return {g: out[g] for g in DIVISIONS + ["ALL"] if g in out}


# ------------------------------------------------------------------ fighters.json
METHOD_SHORT = {"KO": "KO/TKO", "DOC": "TKO (doctor)", "SUB": "SUB", "UD": "U-DEC", "SD": "S-DEC", "MD": "M-DEC",
                "DRAW": "DRAW", "DQ": "DQ", "NC": "NC", "CNC": "CNC", "OTHER": "OTHER"}


def fighter_profile(p, stt, people, elo_now, snap_day):
    P = people[p]
    T = P["tott"] or {}
    rec = stt["rec"]
    record = {k: int(rec.get(k, 0)) for k in ("w", "l", "d", "nc", "ko_w", "sub_w", "dec_w", "ko_l", "sub_l",
                                              "dec_l", "dq_w", "dq_l")}
    divs = Counter(d for _, d in stt["hist"])
    pace, pace_w = pace_curve(stt["C"][[KI["r5_min_%d" % k] for k in range(1, 6)]],
                              stt["C"][[KI["r5_lnd_%d" % k] for k in range(1, 6)]], stt["r3m"], stt["r3l"])
    pace3, pace3_w = pace3_curve(stt["r3m"], stt["r3l"])
    recent = []
    for f, s in reversed(stt["fights"][-6:]):
        res = {"A": "W" if s == 0 else "L", "B": "L" if s == 0 else "W"}.get(f.winner, f.winner)
        item = {"date": f.date.isoformat(), "opp": people[f.persons[1 - s]]["name"], "res": res,
                "method": "TKO (corner)" if f.corner else METHOD_SHORT.get(f.method, f.method),
                "rd": f.rnd, "time": mmss(f.time_s), "wc": f.division, "title": f.title}
        if f.method in ("KO", "SUB", "DOC") and f.detail:
            item["how"] = f.detail[:48]
        recent.append(item)
    last = stt["fights"][-1][0].date.isoformat() if stt["fights"] else None
    return {
        "name": P["name"], "nick": P["nick"], "id": P["id"],
        "dob": T["dob"].isoformat() if T.get("dob") else None,
        "height_in": T.get("height_in"), "reach_in": T.get("reach_in"), "stance": T.get("stance"),
        "division": mode_recent(stt["hist"], snap_day),
        "divisions": dict(divs.most_common()),
        "record": record, "last_fight": last, "n_fights": stt["n_all"],
        "n_5rd": sum(1 for f, _ in stt["fights"] if f.sched == 5),
        "ko_losses": stt["ko_losses"], "kd_absorbed": rnd(stt["C"][KI["okd"]]),
        "elo": int(round(elo_now[p])),
        "S": rlist(stt["S"]), "C": rlist(stt["C"]),
        "pace": pace, "pace_w": pace_w, "pace3": pace3, "pace3_w": pace3_w,
        "recent": recent,
    }


def career_line(prof):
    C = dict(zip(KEYS, prof["C"]))
    m = C["min"] or 1
    lnd = C["d_lnd"] + C["c_lnd"] + C["g_lnd"]
    att = C["d_att"] + C["c_att"] + C["g_att"]
    ab = C["od_lnd"] + C["oc_lnd"] + C["og_lnd"]
    oatt = C["od_att"] + C["oc_att"] + C["og_att"]
    tda = C["td_lnd"] / C["td_att"] if C["td_att"] else float("nan")
    tdd = 1 - C["otd_lnd"] / C["otd_att"] if C["otd_att"] else float("nan")
    return ("%s: %.1f min, SLpM %.2f, SApM %.2f, acc %.0f%%, def %.0f%%, TD/15 %.2f, TD acc %.0f%%, TD def %.0f%%, "
            "KD %d for / %d against, sub/15 %.2f, record %s, Elo %d, division %s"
            % (prof["name"], m, lnd / m, ab / m, 100 * lnd / max(att, 1), 100 * (1 - ab / max(oatt, 1)),
               15 * C["td_lnd"] / m, 100 * tda, 100 * tdd, C["kd"], C["okd"], 15 * C["sub_att"] / m,
               "%(w)d-%(l)d-%(d)d (%(nc)d NC)" % prof["record"], prof["elo"], prof["division"]))


# ------------------------------------------------------------------ overrides.json
def hexcol(n):
    return "#%06x" % n


def ensure_overrides():
    if os.path.exists(OVERRIDES):
        return False
    # copied from the v2 rig SPECS in src/show3d.js (A = Volkanovski, B = Gaethje)
    data = {
        "_note": "Hand-entered tweaks layered on data/derived/fighters.json by slug. 'appearance' drives the 3D "
                 "rig; any profile field (nick, height_in, reach_in, stance, dob, division) may be overridden; "
                 "'manual' holds fighters not in the data, each with a 'rates' block in ufcstats career format "
                 "(slpm sapm acc def td15 tdAcc tdDef sub15 kd15 head body leg dist clinch ground mins). "
                 "See tools/README.md.",
        "fighters": {
            "alexander-volkanovski": {"appearance": {"skin": hexcol(0xd9a383), "hair": hexcol(0x231710), "beard": True,
                                                     "shorts": hexcol(0x2563c9), "trim": hexcol(0xe9eef5),
                                                     "glove": hexcol(0x16181c)}},
            "justin-gaethje": {"appearance": {"skin": hexcol(0xd59a7c), "hair": hexcol(0x6b4a33), "beard": False,
                                              "shorts": hexcol(0xc9312f), "trim": hexcol(0x111111),
                                              "glove": hexcol(0x16181c)}},
        },
        "manual": {},
    }
    with open(OVERRIDES, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    return True


PRIORS_NOTES = ("sum keys are per fighter-minute (league average fighter); acc_* landed/attempted; "
                "kd_per_h knockdowns per landed head strike; td_acc; ctrl_per_td control seconds per "
                "takedown landed; sub_conv submission wins per attempt; kd_fin share of rounds with a "
                "knockdown that the knockdown scorer finished by KO/TKO; finN/decN finish split by round "
                "for N-round fights; paceN landed/min by round vs round 1; mpfN minutes per fight")


def write_priors_file(path, priors, snap, built, until):
    path = path if os.path.isabs(path) else os.path.join(ROOT, path)
    meta = {"source": SOURCE, "snapshot": snap.isoformat(), "built": built, "since": PRIORS_FROM.isoformat(),
            "until": until.isoformat() if until else None, "keys": KEYS, "notes": PRIORS_NOTES,
            "use": ("train-only league priors (hidden-data protocol): engine self-calibration targets, tuning and "
                    "dev evaluation. Not for live predictions." if until else
                    "production league priors (every fight up to the snapshot); live use only")}
    size = write_json(path, {"meta": meta, "priors": priors})
    print("wrote %s: %d groups, fights %s..%s, %s" % (os.path.relpath(path, ROOT), len(priors),
                                                     PRIORS_FROM.isoformat(), until.isoformat() if until else snap.isoformat(),
                                                     human(size)))
    return size


def priors_only(args, until):
    """--priors-only: parse, drop fights on/after --priors-until, build round stats and write the priors file."""
    t0 = time.time()
    log = {}
    fights, _ = parse_fights(log)
    n_all = len(fights)
    if until is not None:
        fights = [f for f in fights if f.date < until]      # nothing on or after the cutoff is processed further
    print("parsed %d fights; kept %d before %s" % (n_all, len(fights), until.isoformat() if until else "the snapshot"))
    build_people(fights, log)
    build_vectors(fights, log)
    snap = fights[-1].date
    priors = build_priors(fights, PRIORS_FROM, until)
    built = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    write_priors_file(args.priors_out, priors, snap, built, until)
    lw = priors.get("Lightweight", {})
    print("Lightweight priors: n %s fights, SLpM %.2f, acc %.3f, KD per head landed %.4f, TD acc %.3f, ctrl/15 %.0f s"
          % (lw.get("n_fights"), lw.get("slpm", 0), lw.get("acc_sig", 0), lw.get("kd_per_h", 0), lw.get("td_acc", 0),
             lw.get("ctrl15", 0)))
    print("done in %.1f s" % (time.time() - t0))


# ------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--half-life", type=float, default=730.0, help="decay half-life in days for S sums (730)")
    ap.add_argument("--roster-since", default="2021-01-01", help="fighters.json keeps fighters with a UFC fight on "
                                                                 "or after this date (2021-01-01)")
    ap.add_argument("--priors-window", type=int, default=5,
                    help="years of fights before Jan 1 of each backtest year used for backtest.json priors_asof (5)")
    ap.add_argument("--priors-until", default=None,
                    help="live league priors (priors.json / fighters.json priors) use only fights dated before this "
                         "ISO date. Default: every fight up to the snapshot (production). Tuning and dev evaluation "
                         "use 2024-01-01 (hidden-data protocol, docs/BACKLOG.md)")
    ap.add_argument("--priors-only", action="store_true",
                    help="write only the priors file (--priors-out) and stop; with --priors-until, fights on or after "
                         "that date are dropped right after parsing, so nothing later is processed")
    ap.add_argument("--priors-out", default=None,
                    help="priors file to write (default data/derived/priors.json; --priors-only requires it to be "
                         "given explicitly so the production file is not overwritten by accident)")
    args = ap.parse_args()
    until = dt.date.fromisoformat(args.priors_until) if args.priors_until else None
    if args.priors_only:
        if not args.priors_out:
            raise SystemExit("--priors-only needs --priors-out (e.g. data/derived/priors_dev.json)")
        return priors_only(args, until)
    t0 = time.time()
    os.makedirs(OUT, exist_ok=True)
    log = {}

    fights, _ = parse_fights(log)
    print("parsed %d fights (%s to %s); %d duplicate rows dropped; %d excluded (no event date)"
          % (len(fights), fights[0].date, fights[-1].date, log["duplicate_fight_rows_dropped"],
             len(log["excluded_fights"])))
    people = build_people(fights, log)
    print("people who fought: %d; aliases merged: %d; ambiguous names: %d (unresolved bouts: %d); "
          "tott rows distrusted: %d; unmatched bout names: %d"
          % (len(people), len(log["aliases"]), len(log["ambiguous_names"]),
             sum(a["unresolved_bouts"] for a in log["ambiguous_names"]), len(log["tott_distrusted"]),
             len(log["unmatched_names"])))
    build_vectors(fights, log)
    print("fights with round stats: %d" % log["fights_with_stats"])

    elo_now, elo_pre, elo_report = tune_elo(fights)
    ch, te = elo_report["chosen"], elo_report["test_2024_plus"]
    print("Elo: K=%d boost=%.1f; tune log loss %.4f; 2024+ n=%d log loss %.4f Brier %.4f accuracy %.3f"
          % (ch["K"], ch["boost"], elo_report["tune_2019_2023"]["log_loss"], te["n"], te["log_loss"], te["brier"],
             te["accuracy"]))

    state, entries = walk(fights, people, elo_pre, args.half_life)
    snap = fights[-1].date
    snap_day = snap.toordinal()
    for stt in state.values():                     # decay everyone's S to the snapshot date
        if stt["t"] is not None and snap_day > stt["t"]:
            stt["S"] *= math.exp(-math.log(2) / args.half_life * (snap_day - stt["t"]))
            stt["t"] = snap_day

    priors = build_priors(fights, PRIORS_FROM, until)
    # walk-forward priors for the backtest: the live priors above include every fight up to the snapshot,
    # 2024+ test fights among them, so a backtest that shrinks toward them would see the test period's
    # league rates. priors_asof[Y] uses only fights in [Jan 1 of Y - window, Jan 1 of Y).
    priors_asof = {}
    for y in range(BACKTEST_FROM.year, snap.year + 1):
        priors_asof[str(y)] = build_priors(fights, dt.date(y - args.priors_window, 1, 1), dt.date(y, 1, 1))
    built =dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    since = dt.date.fromisoformat(args.roster_since)
    roster = {}
    for p, stt in state.items():
        if p.startswith("amb:") or not stt["fights"]:
            continue
        if stt["fights"][-1][0].date < since:
            continue
        P = people[p]
        roster[P["slug"]] = fighter_profile(p, stt, people, elo_now, snap_day)
    roster = dict(sorted(roster.items()))

    meta = {
        "source": SOURCE, "snapshot": snap.isoformat(), "built": built, "half_life_days": args.half_life,
        "roster_since": args.roster_since, "n_fights": len(fights), "n_stat_fights": log["fights_with_stats"],
        "keys": KEYS,
        "notes": {
            "S": "sums decayed by 0.5^(days before snapshot / half_life); C: career sums. Both cover UFC fights "
                 "with round stats; record, n_fights and ko_losses cover every UFC bout",
            "ctrl": "ufcstats control seconds count clinch control as well as ground control",
            "results": "ko_* include doctor and corner stoppages; DQ wins and losses are in record.dq_w/dq_l only",
            "ko_losses": "career KO/TKO losses by strikes or corner stoppage (doctor stoppages excluded)",
            "pace": "sig landed per minute by round in 5-round fights relative to round 1, weights = minutes; "
                    "3-round fights (rounds 1-3) when no 5-round fight of his reached round 2. pace3/pace3_w: "
                    "the 3-round curve on its own (shrink toward priors pace3 for 3-round bouts)",
            "r5_min_k": "extra keys beyond the spec list: minutes in round k of 5-round fights (pace denominators)",
            "division": "most frequent division (catch/open weight ignored) over the 3 years before the snapshot, "
                        "else career",
            "title": "championship bouts (undisputed, interim, superfight); TUF / Road to UFC tournament finals "
                     "are not titles",
            "tott": "height/reach/stance/dob come from the tott row carrying the fighter's name, else the row under "
                    "his ufcstats id; tott_distrusted rows were dropped (attributes null); tott_unverified rows carry "
                    "another name and were kept only because the weight fits the fighter's division",
            "priors": "live league rates from fights since %s; a group with fewer than %d stat fights borrows "
                      "another group's rates (field `fallback`)" % (PRIORS_FROM.isoformat(), PRIOR_MIN_FIGHTS),
            "eras": "pre-2001 weight-class names are ufcstats' labels as scraped (e.g. 1997-2000 'Lightweight' was "
                    "170 lb or under); no roster or backtest fighter is affected",
        },
        "ambiguous_names": log["ambiguous_names"],
        "aliases": log["aliases"],
        "unmatched_names": log["unmatched_names"],
        "tott_distrusted": log["tott_distrusted"],
        "tott_unverified": log["tott_unverified"],
        "excluded_fights": log["excluded_fights"],
    }
    size_f = write_json(os.path.join(OUT, "fighters.json"), {"meta": meta, "priors": priors, "fighters": roster})
    size_p = write_json(os.path.join(OUT, "priors.json"), {
        "meta": {"source": SOURCE, "snapshot": snap.isoformat(), "built": built, "since": PRIORS_FROM.isoformat(),
                 "until": until.isoformat() if until else None, "keys": KEYS,
                 "notes": "sum keys are per fighter-minute (league average fighter); acc_* landed/attempted; "
                          "kd_per_h knockdowns per landed head strike; td_acc; ctrl_per_td control seconds per "
                          "takedown landed; sub_conv submission wins per attempt; kd_fin share of rounds with a "
                          "knockdown that the knockdown scorer finished by KO/TKO; finN/decN finish split by round "
                          "for N-round fights; paceN landed/min by round vs round 1; mpfN minutes per fight"},
        "priors": priors})
    if args.priors_out and os.path.abspath(args.priors_out) != os.path.abspath(os.path.join(OUT, "priors.json")):
        write_priors_file(args.priors_out, priors, snap, built, until)
    n_dec = sum(1 for e in entries if e["result"]["winner"] in ("A", "B"))
    a_rate = sum(1 for e in entries if e["result"]["winner"] == "A") / max(n_dec, 1)
    size_b = write_json(os.path.join(OUT, "backtest.json"), {
        "meta": {"source": SOURCE, "snapshot": snap.isoformat(), "built": built, "half_life_days": args.half_life,
                 "from": BACKTEST_FROM.isoformat(), "n": len(entries), "keys": KEYS,
                 "priors_window_years": args.priors_window,
                 "notes": "each side's S is decayed to the fight date and built only from earlier UFC fights; "
                          "elo is pre-fight (see elo_report.json); "
                          "result.time_s is seconds into the final round, fight_s total elapsed; cards are "
                          "[A, B] per judge (order unknown for draws; omitted for no-contests, whose raw text "
                          "stays in detail)",
                 "corner": "A is the first name in the ufcstats bout (usually the red corner). A won %.1f%% of "
                           "the %d decisive entries, so the engine and the metrics must treat the corners "
                           "symmetrically (or average over the swap); never use the A/B position as a feature"
                           % (100 * a_rate, n_dec),
                 "priors": "shrink toward priors_asof[date[:4]][prior_division or division]: division rates "
                           "from fights in the %d years before Jan 1 of the entry's year, so no fight on or after "
                           "that date leaks in. fighters.json / priors.json priors include every fight up to the "
                           "snapshot (2024+ test fights among them) and are for live use only. prior_division is "
                           "set for catch / open weight bouts: the heavier pre-fight home division of the two"
                           % args.priors_window},
        "priors_asof": priors_asof,
        "fights": entries})
    elo_report["built"] = built
    elo_report["snapshot"] = snap.isoformat()
    size_e = write_json(os.path.join(OUT, "elo_report.json"), elo_report)
    made = ensure_overrides()

    print("wrote data/derived/fighters.json: %d fighters, %s" % (len(roster), human(size_f)))
    print("wrote data/derived/priors.json: %d groups, %s" % (len(priors), human(size_p)))
    print("wrote data/derived/backtest.json: %d entries (%d in 2024+), priors_asof %s-%s, %s"
          % (len(entries), sum(1 for e in entries if e["date"] >= "2024-01-01"), min(priors_asof),
             max(priors_asof), human(size_b)))
    print("wrote data/derived/elo_report.json, %s" % human(size_e))
    print("data/overrides.json: %s" % ("created" if made else "exists, left alone"))
    print()
    lw = priors.get("Lightweight", {})
    print("Lightweight priors: SLpM %.2f, acc %.3f, KD per head landed %.4f, TD acc %.3f, ctrl/15 %.0f s, "
          "5-rd pace %s" % (lw.get("slpm", 0), lw.get("acc_sig", 0), lw.get("kd_per_h", 0), lw.get("td_acc", 0),
                            lw.get("ctrl15", 0), lw.get("pace5")))
    for slug in ("alexander-volkanovski", "justin-gaethje"):
        if slug in roster:
            print(career_line(roster[slug]))
            print("   pace %s  recent: %s" % (roster[slug]["pace"], "; ".join(
                "%s %s %s %s R%d" % (r["date"], r["res"], r["opp"], r["method"], r["rd"])
                for r in roster[slug]["recent"][:3])))
    print("\ndone in %.1f s" % (time.time() - t0))


if __name__ == "__main__":
    main()
