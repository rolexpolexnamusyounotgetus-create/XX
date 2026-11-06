#!/usr/bin/env python3
"""
baserates.py - league base rates and calibration targets for the v3 fight engine.

Reads the ufcstats snapshot in data/raw (github.com/Greco1899/scrape_ufc_stats, scraped from
ufcstats.com) and computes, for several bout groups (all UFC, lightweight, featherweight, 5-round,
title, plus every division), the numbers the engine is calibrated against:

  method split, finish hazard by round, finish position / strike type, per-15 strike rates by position
  and target, accuracies, knockdown rates, knockdown -> finish conversion, takedown and control rates,
  submission rates and conversion, position-time estimates, round-level distributions, fight-night form
  spread, corner/doctor stoppages, the 5-round pace curve, judging (10-8s, splits, per-judge counts) and
  a logistic round-winner model fitted with numpy only (clean-card subset plus an EM fit on all cards).

Outputs
  data/derived/baserates.json          machine-readable, keyed by group / block
  data/derived/baserates_tables.md     every table in markdown (regenerated each run)

Usage
  python3 tools/baserates.py
  python3 tools/baserates.py --since 2018-01-01
  python3 tools/baserates.py --group "bw=division:Bantamweight"   # extra group by canonical division
  python3 tools/baserates.py --group "wbw=Women's Bantamweight"   # or name=regex on WEIGHTCLASS
  python3 tools/baserates.py --quiet

Conventions (checked against the data, see research/data_baserates.md)
  * Strings in the CSVs carry stray trailing spaces; everything is stripped.
  * OUTCOME "W/L" / "L/W" refers to the two names in BOUT in order.
  * Judges' scores in DETAILS are written "loser - winner" (fight loser first), whatever the BOUT order:
    every unanimous decision since 2015 reads low-high, and dissenting cards in split decisions read
    high-low. Draw cards are unordered.
  * Fight time uses 5-minute rounds: (ROUND-1)*300 + TIME. Only all-5-minute-round formats are used for
    time-based rates.
  * ufcstats CTRL counts control time, which includes clinch control against the fence as well as
    ground top/back control, so CTRL is an upper bound on ground time. The script splits it with a
    least-squares decomposition (see position_time).
"""
import argparse
import json
import math
import re
import sys
import datetime as dt
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]

FMT3 = "3 Rnd (5-5-5)"
FMT5 = "5 Rnd (5-5-5-5-5)"
FIVE_MIN_FMT = re.compile(r"^\d Rnd( \+ OT)? \((5-)*5\)$")
DIVISIONS = ["Women's Strawweight", "Women's Flyweight", "Women's Bantamweight", "Women's Featherweight",
             "Flyweight", "Bantamweight", "Featherweight", "Lightweight", "Welterweight", "Middleweight",
             "Light Heavyweight", "Heavyweight", "Catch Weight", "Open Weight"]
RESULT_CATS = ["KO/TKO", "SUB", "U-DEC", "S-DEC", "M-DEC", "DRAW"]  # excludes NC, DQ, OTHER
RNG_SEED = 20261106


# ----------------------------------------------------------------------------------------------
# loading and parsing
# ----------------------------------------------------------------------------------------------
def _load(path):
    d = pd.read_csv(path)
    for c in d.columns:
        if not pd.api.types.is_numeric_dtype(d[c]):
            d[c] = d[c].str.strip()
    return d


def _secs(series):
    m = series.str.extract(r"^(\d+):(\d{2})$").astype(float)
    return m[0] * 60 + m[1]


def _of(series):
    m = series.str.extract(r"(\d+)\s*of\s*(\d+)").astype(float)
    return m[0], m[1]


def division_of(wc):
    if not isinstance(wc, str):
        return "Unknown"
    for d in DIVISIONS:  # women's first, then "Light Heavyweight" before "Heavyweight"
        if d in wc:
            if d == "Heavyweight" and "Light Heavyweight" in wc:
                continue
            if d in ("Flyweight", "Bantamweight", "Featherweight", "Strawweight") and "Women" in wc:
                continue
            return d
    return "Other"


def classify_ko(method, det):
    """KO/TKO kind. ufcstats writes non-strike stoppages as 'to<free text>' (e.g. 'toCorner Stoppage',
    'toKnee Injury', 'toReferee Stoppage Between Rounds')."""
    low = det.lower()
    if method == "TKO - Doctor's Stoppage":
        return "doctor"
    if det.startswith("to") or det == "":
        if "corner" in low:
            return "corner"
        if "injur" in low:
            return "injury"
        if "cut" in low:
            return "doctor"
        if "between rounds" in low:
            return "between_rounds_other"
        return "unspecified"
    return "strikes"


KO_STRIKE_PATTERNS = [
    (r"^Spinning Back Fist", "Punch", "spinning back fist"), (r"^Spinning Back Kick", "Kick", "spinning back kick"),
    (r"^Spinning Back Elbow", "Elbow", "spinning back elbow"), (r"^Flying Knee", "Knee", "flying knee"),
    (r"^Punch", "Punch", None), (r"^Kick", "Kick", None), (r"^Knee", "Knee", None), (r"^Elbow", "Elbow", None),
    (r"^Slam", "Slam", None), (r"^Headbutt", "Headbutt", None), (r"^Stomp", "Stomp", None),
]
GROUND_SUBPOS = ["Mount", "Back Control", "Half Guard", "Side Control", "Crucifix", "North-South",
                 "Bottom", "Guard", "Scramble"]


def parse_ko_detail(det):
    """'Punches to Head From Mount' -> (strike, target, pos, subpos, special, sub_to_strikes)."""
    strike, special = "Other", None
    for pat, lab, sp in KO_STRIKE_PATTERNS:
        if re.match(pat, det):
            strike, special = lab, sp
            break
    target = "Head" if re.search(r"\bHead\b", det) else "Body" if re.search(r"\bBody\b", det) else \
        "Leg" if re.search(r"\bLegs?\b", det) else "Unknown"
    pos, subpos = None, None
    if "At Distance" in det:
        pos, subpos = "distance", "distance"
    elif "In Clinch" in det:
        pos, subpos = "clinch", "clinch"
    elif "On Ground" in det:
        pos, subpos = "ground", "ground (unspecified)"
    else:
        m = re.search(r"From (" + "|".join(re.escape(s) for s in GROUND_SUBPOS) + r")", det)
        if m:
            pos = "ground"
            sp = m.group(1)
            subpos = "bottom (striker on bottom)" if sp == "Bottom" else sp.lower()
    if pos is None and special in ("spinning back fist", "spinning back kick", "flying knee", "spinning back elbow"):
        pos, subpos = "distance", "distance (implied)"
    if pos is None:
        pos, subpos = "unknown", "unknown"
    return strike, target, pos, subpos, special, ("Submission to Strikes" in det)


SUB_TYPES = [("Rear Naked Choke", "Rear-naked choke"), ("Guillotine", "Guillotine"), ("Arm Triangle", "Arm triangle"),
             ("Triangle", "Triangle"), ("Armbar", "Armbar"), ("D'Arce", "D'Arce"), ("Anaconda", "Anaconda"),
             ("Kimura", "Kimura"), ("Heel Hook", "Heel hook"), ("Kneebar", "Kneebar"), ("Neck Crank", "Neck crank"),
             ("Ankle Lock", "Ankle lock"), ("Americana", "Americana"), ("Von Flue", "Von Flue"),
             ("Peruvian", "Peruvian necktie"), ("Ezekiel", "Ezekiel"), ("Calf Slicer", "Calf slicer"),
             ("North-South Choke", "North-south choke"), ("Brabo", "Brabo/D'Arce"), ("Twister", "Twister"),
             ("Omoplata", "Omoplata"), ("Keylock", "Keylock")]


def parse_sub_detail(det):
    typ = "Other"
    for key, lab in SUB_TYPES:
        if key in det:
            typ = lab
            break
    if "Standing" in det:
        pos = "standing"
    elif "Bottom" in det or "Drop to Guard" in det or "Drop to Ground" in det or re.search(r"From Guard\b", det):
        pos = "bottom (submitter on bottom)"
    elif "Back Control" in det or typ == "Rear-naked choke":
        pos = "back"
    elif re.search(r"From (Mount|Side Control|Half Guard|North-South|Crucifix|Top)", det):
        pos = "top"
    elif "On Ground" in det:
        pos = "ground (unspecified)"
    else:
        pos = "unspecified"
    return typ, pos


def load_data(raw_dir, since):
    raw = Path(raw_dir)
    R = _load(raw / "ufc_fight_results.csv")
    E = _load(raw / "ufc_event_details.csv")
    S = _load(raw / "ufc_fight_stats.csv")
    notes = []

    E["DATE"] = pd.to_datetime(E["DATE"], format="%B %d, %Y")
    R["order"] = np.arange(len(R))
    R = R.merge(E[["EVENT", "DATE"]], on="EVENT", how="left")
    # the snapshot lists some events twice under old and new names (same fight URLs); keep the dated copy
    dupu = R.duplicated("URL", keep=False)
    if dupu.any():
        renamed = sorted(R.loc[dupu & R.DATE.isna(), "EVENT"].unique().tolist())
        R = R.sort_values(["DATE", "order"], na_position="last").drop_duplicates("URL", keep="first")
        R = R.sort_values("order")
        notes.append(f"{int(dupu.sum() // 2)} fights appear twice under two event names (same fight URL); kept the "
                     f"copy whose event has a date, dropped the copies under {renamed}")
    missing = R.loc[R.DATE.isna(), "EVENT"].unique().tolist()
    if missing:
        # results file is newest-first: borrow the date of the nearest newer event in file order
        R = R.sort_values("order")
        R["DATE"] = R["DATE"].ffill().bfill()
        notes.append(f"{len(missing)} event(s) missing from ufc_event_details.csv; dates imputed from the "
                     f"neighbouring event in results order: {missing}")
    # duplicates on (EVENT, BOUT) cannot be joined to stats unambiguously; drop them
    dup = R.duplicated(["EVENT", "BOUT"], keep=False)
    if dup.any():
        notes.append(f"dropped {int(dup.sum())} rows with duplicate (EVENT, BOUT): "
                     f"{R.loc[dup, 'BOUT'].unique().tolist()}")
        R = R[~dup]
    data_max = R.DATE.max()
    F = R[R.DATE >= pd.Timestamp(since)].copy()
    F["fid"] = F["URL"]
    names = F.BOUT.str.split(" vs. ", n=1, expand=True)
    F["n0"], F["n1"] = names[0], names[1]
    F["det"] = F["DETAILS"].fillna("")
    F["wc"] = F["WEIGHTCLASS"]
    F["division"] = F["wc"].map(division_of)
    F["title"] = F["wc"].str.match(r"^UFC .*Title Bout$") & ~F["wc"].str.contains("Superfight")
    F["fmt"] = F["TIME FORMAT"]
    F["five_min"] = F["fmt"].str.match(FIVE_MIN_FMT.pattern)
    F["sched"] = F["fmt"].str.extract(r"^(\d) Rnd")[0].astype(float)
    F["five"] = F["fmt"].str.startswith("5 Rnd")
    F["end_round"] = F["ROUND"].astype(int)
    F["end_sec"] = _secs(F["TIME"])
    F["fight_sec"] = np.where(F.five_min, (F.end_round - 1) * 300 + F.end_sec, np.nan)
    F["winner"] = np.select([F.OUTCOME.eq("W/L"), F.OUTCOME.eq("L/W")], [0, 1], -1)
    m, o = F.METHOD, F.OUTCOME
    F["cat"] = np.select(
        [o.eq("NC/NC"), o.eq("D/D"), m.eq("DQ"), m.isin(["KO/TKO", "TKO - Doctor's Stoppage"]), m.eq("Submission"),
         m.eq("Decision - Unanimous"), m.eq("Decision - Split"), m.eq("Decision - Majority")],
        ["NC", "DRAW", "DQ", "KO/TKO", "SUB", "U-DEC", "S-DEC", "M-DEC"], "OTHER")
    F["finish"] = F.cat.isin(["KO/TKO", "SUB"])
    F["ko_kind"] = [classify_ko(mm, dd) if c == "KO/TKO" else None for mm, dd, c in zip(F.METHOD, F.det, F.cat)]
    ko = [parse_ko_detail(d) if k == "strikes" else (None,) * 6 for d, k in zip(F.det, F.ko_kind)]
    for i, col in enumerate(["ko_strike", "ko_target", "ko_pos", "ko_subpos", "ko_special", "ko_sub2str"]):
        F[col] = [t[i] for t in ko]
    sb = [parse_sub_detail(d) if c == "SUB" else (None, None) for d, c in zip(F.det, F.cat)]
    F["sub_type"] = [t[0] for t in sb]
    F["sub_pos"] = [t[1] for t in sb]
    F["year"] = F.DATE.dt.year

    # ---- per fighter-round stats ----
    S = S.merge(F[["EVENT", "BOUT", "fid", "n0", "n1", "end_round", "end_sec", "five_min", "winner", "cat",
                   "ko_kind", "ko_pos", "finish", "fmt", "sched"]], on=["EVENT", "BOUT"], how="inner")
    S["rnd"] = S["ROUND"].str.extract(r"(\d+)")[0].astype(int)
    pairs = {"SIG.STR.": "sig", "TOTAL STR.": "tot", "TD": "td", "HEAD": "head", "BODY": "body", "LEG": "leg",
             "DISTANCE": "dist", "CLINCH": "clinch", "GROUND": "ground"}
    for src, short in pairs.items():
        S[short + "_l"], S[short + "_a"] = _of(S[src])
    S["kd"] = S["KD"]
    S["sub"] = S["SUB.ATT"]
    S["rev"] = S["REV."]
    S["ctrl"] = _secs(S["CTRL"])
    S["idx"] = np.where(S.FIGHTER == S.n0, 0, np.where(S.FIGHTER == S.n1, 1, -1))
    S["rsec"] = np.where(S.rnd < S.end_round, 300.0, np.where(S.rnd == S.end_round, S.end_sec, np.nan))
    num = [c for c in S.columns if c.endswith("_l") or c.endswith("_a")] + ["kd", "sub", "rev", "ctrl"]
    # validation: every round 1..end_round present with both fighters, names matched, numbers parsed
    g = S.groupby("fid")
    chk = pd.DataFrame({"rows": g.size(), "maxr": g.rnd.max(), "minidx": g.idx.min(),
                        "nan": g[num].apply(lambda x: int(x.isna().to_numpy().sum()))})
    chk = chk.join(F.set_index("fid")[["end_round", "five_min"]])
    good = chk[(chk.rows == 2 * chk.end_round) & (chk.maxr == chk.end_round) & (chk.minidx >= 0) &
               (chk.nan == 0) & chk.five_min].index
    bad = len(chk) - len(good)
    if bad:
        notes.append(f"{bad} fights excluded from stats-based measures (round rows missing, unparsed numbers, "
                     f"unmatched names or non-5-minute rounds)")
    S = S[S.fid.isin(good)].copy()
    S["ctrl"] = np.minimum(S["ctrl"], S["rsec"])
    F["has_stats"] = F.fid.isin(good)
    # opponent columns
    opp_cols = ["sig_l", "sig_a", "head_l", "body_l", "leg_l", "dist_l", "clinch_l", "ground_l", "tot_l",
                "kd", "td_l", "td_a", "ctrl", "sub", "rev"]
    O = S[["fid", "rnd", "idx"] + opp_cols].copy()
    O["idx"] = 1 - O["idx"]
    S = S.merge(O.rename(columns={c: "o_" + c for c in opp_cols}), on=["fid", "rnd", "idx"], how="left")
    return F, S, notes, data_max


# ----------------------------------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------------------------------
def r4(x, n=4):
    if x is None:
        return None
    try:
        if isinstance(x, (np.integer,)):
            return int(x)
        if isinstance(x, (int,)):
            return x
        x = float(x)
    except (TypeError, ValueError):
        return x
    if math.isnan(x) or math.isinf(x):
        return None
    return round(x, n)


def clean(obj):
    """Make an object JSON-safe (numpy types, NaN -> None)."""
    if isinstance(obj, dict):
        return {str(k): clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [clean(v) for v in obj]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating, float)):
        return r4(obj, 6)
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    return obj


def share(a, b):
    return float(a) / float(b) if b else None


def wilson(k, n, z=1.96):
    """95% Wilson interval for k successes in n trials."""
    if not n:
        return [None, None]
    p = k / n
    den = 1 + z * z / n
    c = (p + z * z / (2 * n)) / den
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return [max(0.0, c - h), min(1.0, c + h)]


# ----------------------------------------------------------------------------------------------
# fight-level blocks
# ----------------------------------------------------------------------------------------------
def methods_block(Fg):
    n = len(Fg)
    counts = Fg.cat.value_counts().reindex(["KO/TKO", "SUB", "U-DEC", "S-DEC", "M-DEC", "DRAW", "NC", "DQ", "OTHER"],
                                           fill_value=0)
    ko = Fg[Fg.cat == "KO/TKO"].ko_kind.value_counts().reindex(
        ["strikes", "doctor", "corner", "injury", "between_rounds_other", "unspecified"], fill_value=0)
    dec = counts[["U-DEC", "S-DEC", "M-DEC"]].sum()
    res = Fg.cat.isin(RESULT_CATS).sum()
    return {
        "n": n,
        "counts": counts.to_dict(),
        "shares": {k: share(v, n) for k, v in counts.items()},
        "ko_breakdown_counts": ko.to_dict(),
        "ko_breakdown_share_of_fights": {k: share(v, n) for k, v in ko.items()},
        "finish_rate": share(Fg.finish.sum(), res),
        "decision_rate": share(dec + counts["DRAW"], res),
        "decision_type_shares": {k: share(counts[k], dec) for k in ["U-DEC", "S-DEC", "M-DEC"]},
        "note": "shares are of all fights in the group; finish_rate/decision_rate exclude NC, DQ and other",
    }


def hazard_block(Fg, R):
    fmt = FMT3 if R == 3 else FMT5
    d = Fg[(Fg.fmt == fmt) & Fg.cat.isin(RESULT_CATS)]
    N = len(d)
    rows = []
    for r in range(1, R + 1):
        reached = int((d.end_round >= r).sum())
        fin = d[(d.end_round == r) & d.finish]
        expo = np.where(d.end_round > r, 300.0, np.where(d.end_round == r, d.end_sec, 0.0)).sum() / 60.0
        rows.append({"round": r, "reached": reached, "finishes": len(fin),
                     "ko_tko": int((fin.cat == "KO/TKO").sum()), "sub": int((fin.cat == "SUB").sum()),
                     "share_of_all": share(len(fin), N), "conditional": share(len(fin), reached),
                     "conditional_ci95": wilson(len(fin), reached),
                     "ko_conditional": share((fin.cat == "KO/TKO").sum(), reached),
                     "sub_conditional": share((fin.cat == "SUB").sum(), reached),
                     "per_minute": share(len(fin), expo)})
    return {"format": fmt, "n": N, "went_distance": share((~d.finish).sum(), N), "rounds": rows}


def timing_block(Fg):
    fin = Fg[Fg.finish & Fg.five_min]
    between = fin[(fin.end_sec >= 300) & fin.ko_kind.isin(["corner", "doctor", "injury", "unspecified",
                                                           "between_rounds_other"])]
    inr = fin.drop(between.index)
    mins = np.clip(np.floor((inr.end_sec - 1e-6) / 60), 0, 4).astype(int)
    tab = {}
    for kind, sub in [("all", inr), ("ko_tko", inr[inr.cat == "KO/TKO"]), ("sub", inr[inr.cat == "SUB"])]:
        mm = np.clip(np.floor((sub.end_sec - 1e-6) / 60), 0, 4).astype(int)
        cnt = np.bincount(mm, minlength=5)
        tab[kind] = {"n": int(len(sub)), "by_minute_share": [share(c, len(sub)) for c in cnt],
                     "last_10s_share": share((sub.end_sec >= 290).sum(), len(sub)),
                     "first_30s_share": share((sub.end_sec <= 30).sum(), len(sub)),
                     "median_sec_into_round": float(np.median(sub.end_sec)) if len(sub) else None}
    tab["between_rounds_stoppages"] = int(len(between))
    tab["note"] = "in-round finishes only; corner/doctor/injury stoppages at 5:00 counted separately"
    return tab


def finish_detail_block(Fg):
    k = Fg[(Fg.cat == "KO/TKO") & (Fg.ko_kind == "strikes")]
    n = len(k)
    out = {"n_ko_strikes": n}

    def vc(series, n_):
        c = series.value_counts()
        return {str(i): {"n": int(v), "share": share(v, n_)} for i, v in c.items()}
    out["position"] = vc(k.ko_pos, n)
    out["subposition"] = vc(k.ko_subpos, n)
    out["strike"] = vc(k.ko_strike, n)
    out["target"] = vc(k.ko_target, n)
    out["special"] = vc(k.ko_special.dropna(), n)
    out["submission_to_strikes"] = {"n": int(k.ko_sub2str.sum()), "share": share(k.ko_sub2str.sum(), n)}
    ct = pd.crosstab(k.ko_pos, k.ko_strike)
    out["position_x_strike"] = {p: {s: int(ct.loc[p, s]) for s in ct.columns} for p in ct.index}
    s = Fg[Fg.cat == "SUB"]
    out["n_sub"] = len(s)
    out["sub_type"] = vc(s.sub_type, len(s))
    out["sub_position"] = vc(s.sub_pos, len(s))
    return out


def stoppage_block(Fg):
    n = len(Fg)
    ko = Fg[Fg.cat == "KO/TKO"]
    res = {"n": n}
    for kind in ["doctor", "corner", "injury"]:
        x = ko[ko.ko_kind == kind]
        res[kind] = {"n": len(x), "per_fight": share(len(x), n),
                     "per_100_fights": 100 * share(len(x), n) if n else None,
                     "between_rounds_share": share((x.end_sec >= 300).sum(), len(x)),
                     "by_round": x.end_round.value_counts().sort_index().to_dict()}
    # corner/doctor stoppage per round started (5-round fights only, rounds 1-5)
    d5 = Fg[Fg.fmt == FMT5]
    per_round = []
    for r in range(1, 6):
        reached = (d5.end_round >= r).sum()
        cd = ((d5.end_round == r) & d5.ko_kind.isin(["doctor", "corner"])).sum()
        per_round.append({"round": r, "reached": int(reached), "corner_or_doctor": int(cd),
                          "rate_per_round_reached": share(cd, reached)})
    res["five_round_corner_doctor_by_round"] = per_round
    btw = ko[(ko.end_sec >= 300) & (ko.ko_kind != "strikes")]
    res["between_rounds"] = {"n": len(btw), "per_100_fights": 100 * share(len(btw), n) if n else None,
                             "by_kind": btw.ko_kind.value_counts().to_dict(),
                             "note": "KO/TKO recorded at 5:00 of a round with a non-strike detail: retirements "
                                     "on the stool, doctor or referee stoppages between rounds"}
    doc = ko[ko.ko_kind == "doctor"].det.str.lower()
    res["doctor_reasons"] = {"cut": int(doc.str.contains("cut").sum()), "eye": int(doc.str.contains("eye").sum()),
                             "other": int((~doc.str.contains("cut|eye")).sum())}
    return res


# ----------------------------------------------------------------------------------------------
# stats-level blocks
# ----------------------------------------------------------------------------------------------
STRIKE_KEYS = ["sig", "head", "body", "leg", "dist", "clinch", "ground", "tot"]


def rates_block(Sg):
    T = Sg.rsec.sum()  # fighter-seconds (each round counted once per fighter)
    fight_min = T / 2 / 60
    out = {"fighter_minutes": T / 60, "fight_minutes": fight_min, "per15": {}, "accuracy": {}}
    for k in STRIKE_KEYS:
        out["per15"][k + "_landed"] = Sg[k + "_l"].sum() / T * 900
        out["per15"][k + "_attempted"] = Sg[k + "_a"].sum() / T * 900
        out["accuracy"][k] = share(Sg[k + "_l"].sum(), Sg[k + "_a"].sum())
    for k, col in [("kd", "kd"), ("td_landed", "td_l"), ("td_attempted", "td_a"), ("sub_att", "sub"),
                   ("reversals", "rev"), ("ctrl_sec", "ctrl")]:
        out["per15"][k] = Sg[col].sum() / T * 900
    out["accuracy"]["td"] = share(Sg.td_l.sum(), Sg.td_a.sum())
    sl = Sg.sig_l.sum()
    sa = Sg.sig_a.sum()
    out["landed_share"] = {k: share(Sg[k + "_l"].sum(), sl) for k in ["head", "body", "leg", "dist", "clinch", "ground"]}
    out["attempted_share"] = {k: share(Sg[k + "_a"].sum(), sa) for k in ["head", "body", "leg", "dist", "clinch", "ground"]}
    out["sig_share_of_total_landed"] = share(sl, Sg.tot_l.sum())
    return out


def kd_block(Sg, Fg):
    kd = Sg.kd.sum()
    lo = (Sg.head_l - Sg.ground_l).clip(lower=0).sum()
    hi = np.minimum(Sg.head_l, Sg.dist_l + Sg.clinch_l).sum()
    mid = (lo + hi) / 2
    out = {"knockdowns": kd,
           "per100_standing_head_landed": 100 * kd / mid if mid else None,
           "per100_standing_head_landed_range": [100 * kd / hi if hi else None, 100 * kd / lo if lo else None],
           "standing_head_landed_bounds": [lo, hi],
           "per100_head_landed_all_positions": 100 * kd / Sg.head_l.sum(),
           "per100_dist_clinch_landed": 100 * kd / (Sg.dist_l + Sg.clinch_l).sum(),
           "per100_sig_landed": 100 * kd / Sg.sig_l.sum(),
           "per15": kd / Sg.rsec.sum() * 900,
           "note": "ufcstats gives head and position totals but not their cross-tab; standing head landed is "
                   "bounded by max(HEAD-GROUND,0) and min(HEAD, DIST+CLINCH); the point value uses the midpoint"}
    # knockdown -> finish
    k = Sg[Sg.kd >= 1]
    same = k.rnd == k.end_round
    won = k.winner == k.idx
    fin_same = same & won & k.finish
    ko_same = same & won & (k.cat == "KO/TKO")
    out["fighter_rounds_with_kd"] = len(k)
    out["p_finish_same_round_given_kd"] = share(fin_same.sum(), len(k))
    out["p_ko_tko_same_round_given_kd"] = share(ko_same.sum(), len(k))
    for lab, msk in [("one_kd", k.kd == 1), ("two_plus_kd", k.kd >= 2)]:
        out["p_finish_same_round_given_" + lab] = share((fin_same & msk).sum(), msk.sum())
        out["n_" + lab] = int(msk.sum())
    out["p_scorer_wins_fight_given_kd"] = share(won.sum(), len(k))
    out["p_scorer_finishes_later_given_kd_no_same_round_finish"] = share(
        (won & k.finish & ~same).sum(), (~fin_same).sum())
    # how many KO/TKO-by-strikes finishes show a KD by the winner in the final round
    fr = Sg[(Sg.rnd == Sg.end_round) & (Sg.idx == Sg.winner) & (Sg.cat == "KO/TKO") & (Sg.ko_kind == "strikes")]
    out["share_ko_strike_finishes_with_winner_kd_in_final_round"] = share((fr.kd >= 1).sum(), len(fr))
    for pos in ["distance", "clinch", "ground"]:
        x = fr[fr.ko_pos == pos]
        out[f"share_ko_finishes_{pos}_with_kd"] = share((x.kd >= 1).sum(), len(x))
    # finishing hazards per landed strike (for engine follow-up / GNP calibration)
    kos = Fg[(Fg.cat == "KO/TKO") & (Fg.ko_kind == "strikes") & Fg.has_stats]
    out["ground_ko_per100_ground_landed"] = 100 * (kos.ko_pos == "ground").sum() / Sg.ground_l.sum()
    out["standing_ko_per100_standing_head_landed"] = 100 * kos.ko_pos.isin(["distance", "clinch"]).sum() / mid
    fr_nokd = fr[(fr.kd == 0) & fr.ko_pos.isin(["distance", "clinch"])]
    out["standing_ko_without_kd_per100_standing_head_landed"] = 100 * len(fr_nokd) / mid
    return out


def grappling_block(Sg, Fg):
    T = Sg.rsec.sum()
    ctrl = Sg.ctrl.sum()
    subs = Sg["sub"].sum()
    sub_wins = int(((Fg.cat == "SUB") & Fg.has_stats).sum())
    fr = Sg[(Sg.rnd == Sg.end_round) & (Sg.idx == Sg.winner) & (Sg.cat == "SUB")]
    out = {"td_landed_per15": Sg.td_l.sum() / T * 900, "td_attempted_per15": Sg.td_a.sum() / T * 900,
           "td_accuracy": share(Sg.td_l.sum(), Sg.td_a.sum()),
           "ctrl_sec_per15": ctrl / T * 900,
           "ctrl_sec_per_td_landed": share(ctrl, Sg.td_l.sum()),
           "sub_att_per15": subs / T * 900,
           "sub_att_per_ctrl_minute": share(subs, ctrl / 60),
           "sub_att_total": subs, "sub_finishes": sub_wins,
           "sub_conversion": share(sub_wins, subs),
           "share_sub_finishes_with_winner_sub_att_recorded_in_final_round": share((fr["sub"] >= 1).sum(), len(fr)),
           "reversals_per15": Sg.rev.sum() / T * 900,
           "p_round_has_td_landed_by_fighter": share((Sg.td_l >= 1).sum(), len(Sg))}
    return out


def position_time_block(Sg):
    """Split CTRL into clinch and ground parts with a no-intercept least-squares fit at round level:
       ctrl_round ~ b_c * clinch_att + b_g * ground_att + b_td * td_landed (both fighters summed)."""
    Rr = Sg.groupby(["fid", "rnd"]).agg(ctrl=("ctrl", "sum"), clinch_a=("clinch_a", "sum"),
                                        ground_a=("ground_a", "sum"), td_l=("td_l", "sum"),
                                        rsec=("rsec", "first")).reset_index()
    X = Rr[["clinch_a", "ground_a", "td_l"]].to_numpy(float)
    y = Rr.ctrl.to_numpy(float)
    b, *_ = np.linalg.lstsq(X, y, rcond=None)
    b = np.maximum(b, 0)
    clinch_c = np.minimum(b[0] * Rr.clinch_a.to_numpy(), y)
    ground_c = y - clinch_c
    T = Rr.rsec.sum()
    pred = X @ b
    r2 = 1 - ((y - pred) ** 2).sum() / ((y - y.mean()) ** 2).sum()
    pure = (Rr.ground_a == 0) & (Rr.td_l == 0)
    r_pc = share(y[pure].sum(), Rr.clinch_a[pure].sum())  # ctrl per clinch attempt where no ground/TD happened
    clinch_hi = np.minimum(r_pc * Rr.clinch_a.to_numpy(), y)
    out = {"ctrl_share_of_fight_time": y.sum() / T,
           "fit": {"sec_ctrl_per_clinch_sig_att": b[0], "sec_ctrl_per_ground_sig_att": b[1],
                   "sec_ctrl_per_td_landed": b[2], "r2": r2, "n_rounds": len(Rr)},
           "est_share": {"ground": ground_c.sum() / T, "clinch_control": clinch_c.sum() / T,
                         "distance_or_neutral": 1 - y.sum() / T},
           "est_share_alt_pure_clinch_ratio": {"ground": (y - clinch_hi).sum() / T, "clinch_control": clinch_hi.sum() / T,
                                               "distance_or_neutral": 1 - y.sum() / T},
           "est_ground_minutes": ground_c.sum() / 60,
           "pure_clinch_rounds_ctrl_per_clinch_att": r_pc,
           "rounds_with_no_clinch_ground_td_mean_ctrl": float(y[(Rr.clinch_a == 0) & (Rr.ground_a == 0) &
                                                               (Rr.td_l == 0)].mean()),
           "note": "CTRL includes clinch control on the fence, so ctrl_share is an upper bound on ground time; "
                   "neutral clinch and scrambles fall into distance_or_neutral"}
    return out


def dist_stats(x):
    x = np.asarray(x, float)
    mu, var = x.mean(), x.var(ddof=1)
    q = np.percentile(x, [10, 25, 50, 75, 90])
    return {"n": len(x), "mean": mu, "sd": math.sqrt(var), "var_over_mean": var / mu if mu else None,
            "nb_k": mu * mu / (var - mu) if var > mu else None,
            "p10": q[0], "p25": q[1], "p50": q[2], "p75": q[3], "p90": q[4], "p_zero": float((x == 0).mean())}


def round_dist_block(Sg):
    full = Sg[Sg.rsec >= 300]
    out = {"note": "full 5-minute rounds only; per fighter unless 'round_total'"}
    for k in ["sig_l", "sig_a", "head_l", "body_l", "leg_l", "dist_l", "clinch_l", "ground_l", "tot_l", "td_a",
              "td_l", "ctrl", "kd", "sub"]:
        out[k] = dist_stats(full[k])
    out["round_total_sig_l"] = dist_stats(full.sig_l + full.o_sig_l)
    out["p_kd_in_round_by_fighter"] = float((full.kd >= 1).mean())
    out["corr_sig_l_between_opponents"] = float(np.corrcoef(full.sig_l, full.o_sig_l)[0, 1])
    # within-fight persistence: same fighter, round r vs r+1 (both full)
    a = full[["fid", "idx", "rnd", "sig_l"]]
    b = a.copy()
    b["rnd"] = b["rnd"] - 1
    j = a.merge(b, on=["fid", "idx", "rnd"], suffixes=("", "_next"))
    out["corr_sig_l_round_to_next_same_fighter"] = float(np.corrcoef(j.sig_l, j.sig_l_next)[0, 1])
    out["td_landed_round_pmf"] = {str(i): float((full.td_l == i).mean()) for i in range(0, 4)}
    out["td_landed_round_pmf"]["4+"] = float((full.td_l >= 4).mean())
    return out


def form_block(Sg, min_fights=4):
    """Fight-to-fight spread of a fighter's sig-strike output after removing his own level and the
    opponent's allowance (two-way fixed effects on log rate), minus Poisson sampling noise."""
    full = Sg[Sg.rsec >= 300]  # full rounds only, so every round is a 5-minute draw
    g = full.groupby(["fid", "idx", "FIGHTER"]).agg(
        l=("sig_l", "sum"), a=("sig_a", "sum"), nr=("rnd", "size"),
        vl=("sig_l", lambda s: s.var(ddof=1)), va=("sig_a", lambda s: s.var(ddof=1))).reset_index()
    opp = g[["fid", "idx", "FIGHTER"]].copy()
    opp["idx"] = 1 - opp["idx"]
    g = g.merge(opp.rename(columns={"FIGHTER": "OPP"}), on=["fid", "idx"])
    g = g[g.nr >= 2].copy()
    res = {}
    for col, vcol, lab in [("l", "vl", "sig_landed"), ("a", "va", "sig_attempted")]:
        d = g.copy()
        for _ in range(6):  # iterate the minimum-fights filter on both sides
            cf = d.FIGHTER.value_counts()
            co = d.OPP.value_counts()
            d = d[d.FIGHTER.map(cf).ge(min_fights) & d.OPP.map(co).ge(min_fights)]
        mean_r = (d[col] + 0.5) / d.nr  # per-round mean
        y = np.log(mean_r)
        a = pd.Series(0.0, index=d.index)
        o = pd.Series(0.0, index=d.index)
        mu = y.mean()
        for _ in range(50):
            a = (y - mu - o).groupby(d.FIGHTER).transform("mean")
            o = (y - mu - a).groupby(d.OPP).transform("mean")
        e = y - mu - a - o
        n = len(d)
        p = d.FIGHTER.nunique() + d.OPP.nunique() - 1
        var_e = (e ** 2).sum() / max(n - p, 1)
        samp_pois = (1.0 / (d[col] + 0.5)).mean()
        samp_within = (d[vcol] / d.nr / mean_r ** 2).mean()  # delta method with within-fight round variance
        res[lab] = {"n_fighter_fights": n, "n_fighters": int(d.FIGHTER.nunique()),
                    "resid_sd_log": math.sqrt(var_e), "poisson_sd_log": math.sqrt(samp_pois),
                    "within_fight_sd_log": math.sqrt(samp_within),
                    "implied_form_sd_log_vs_poisson": math.sqrt(max(var_e - samp_pois, 0)),
                    "implied_form_sd_log": math.sqrt(max(var_e - samp_within, 0)),
                    "fighter_effect_sd_log": float(a.groupby(d.FIGHTER).first().std()),
                    "opponent_effect_sd_log": float(o.groupby(d.OPP).first().std())}
    res["note"] = ("full rounds only, fighter-fights with >= 2 full rounds; two-way fixed effects (fighter output, "
                   f"opponent allowance) on log mean per-round count; fighters and opponents with >= {min_fights} "
                   "such fights. resid_sd_log is the calibration target for between-fight spread; implied_form_sd "
                   "removes the sampling noise implied by round-to-round variance inside the fight. It still holds "
                   "style-matchup interaction, so it is an upper bound on pure night-to-night form.")
    return res


def pace_block(Sg, Fg, fmt=FMT5, R=5):
    fids = Fg[(Fg.fmt == fmt)].fid
    s = Sg[Sg.fid.isin(fids) & (Sg.rsec >= 300)]
    dist_fids = Fg[(Fg.fmt == fmt) & ~Fg.finish & Fg.cat.isin(RESULT_CATS)].fid
    out = {}
    for lab, sub in [("all_full_rounds", s), ("went_distance_only", s[s.fid.isin(dist_fids)])]:
        rows = []
        for r in range(1, R + 1):
            x = sub[sub.rnd == r]
            T = x.rsec.sum()
            if not len(x):
                continue
            lo = (x.head_l - x.ground_l).clip(lower=0).sum()
            hi = np.minimum(x.head_l, x.dist_l + x.clinch_l).sum()
            rows.append({"round": r, "fighter_rounds": len(x),
                         "sig_landed_per_min": x.sig_l.sum() / T * 60, "sig_att_per_min": x.sig_a.sum() / T * 60,
                         "sig_acc": share(x.sig_l.sum(), x.sig_a.sum()),
                         "head_landed_per_min": x.head_l.sum() / T * 60, "body_landed_per_min": x.body_l.sum() / T * 60,
                         "leg_landed_per_min": x.leg_l.sum() / T * 60,
                         "dist_att_per_min": x.dist_a.sum() / T * 60, "clinch_att_per_min": x.clinch_a.sum() / T * 60,
                         "ground_att_per_min": x.ground_a.sum() / T * 60,
                         "td_att_per15": x.td_a.sum() / T * 900, "td_acc": share(x.td_l.sum(), x.td_a.sum()),
                         "ctrl_sec_per_round": x.ctrl.sum() / len(x),
                         "kd_per100_standing_head": 100 * x.kd.sum() / ((lo + hi) / 2) if (lo + hi) else None})
        base = rows[0]["sig_att_per_min"] if rows else None
        for row in rows:
            row["att_ratio_to_r1"] = share(row["sig_att_per_min"], base)
            row["landed_ratio_to_r1"] = share(row["sig_landed_per_min"], rows[0]["sig_landed_per_min"])
        out[lab] = rows
    out["n_fights_went_distance"] = int(len(dist_fids))
    return out


# ----------------------------------------------------------------------------------------------
# judging
# ----------------------------------------------------------------------------------------------
CARD_RE = re.compile(r"(.+?)\s(\d{1,2})\s-\s(\d{1,2})\.")


def parse_cards(det):
    return [(m.group(1).strip(), int(m.group(2)), int(m.group(3))) for m in CARD_RE.finditer(det)]


def decisions_frame(Fg):
    d = Fg[Fg.cat.isin(["U-DEC", "S-DEC", "M-DEC", "DRAW"]) & Fg.METHOD.str.startswith("Decision")].copy()
    d["cards"] = d.det.map(parse_cards)
    d = d[d.cards.map(len) == 3]
    d = d[d.fmt.isin([FMT3, FMT5]) & (d.end_round == d.sched)]
    return d


def judging_block(Fg, top_judges=25):
    d = decisions_frame(Fg)
    out = {"n_decisions_parsed": len(d)}
    nd = d[d.cat != "DRAW"]
    out["type_shares"] = {k: share((nd.cat == k).sum(), len(nd)) for k in ["U-DEC", "S-DEC", "M-DEC"]}
    out["draws"] = int((d.cat == "DRAW").sum())
    out["draw_share_of_decisions"] = share((d.cat == "DRAW").sum(), len(d))
    # cards
    rows = []
    for _, f in d.iterrows():
        R = int(f.sched)
        for name, lo, wi in f.cards:
            rows.append({"fid": f["fid"], "year": f["year"], "R": R, "judge": name, "l": lo, "w": wi, "cat": f["cat"],
                         "five": R == 5})
    C = pd.DataFrame(rows)
    C["sum"] = C.l + C.w
    C["implied_108"] = 19 * C.R - C["sum"]
    C["margin"] = C.w - C.l
    out["n_cards"] = len(C)
    out["cards_implied_108_or_deduction_share"] = share((C.implied_108 > 0).sum(), len(C))
    out["implied_108_per_round"] = share(C.implied_108.clip(lower=0).sum(), (C.R).sum())
    out["cards_with_10_10_or_odd_total"] = int((C.implied_108 < 0).sum())
    for R in (3, 5):
        x = C[C.R == R]
        out[f"implied_108_per_round_{R}rd"] = share(x.implied_108.clip(lower=0).sum(), x.R.sum())
    # how often a fight has at least one card with an implied 10-8
    fight108 = C.groupby("fid").implied_108.max()
    out["decisions_with_any_implied_108_share"] = share((fight108 > 0).sum(), len(fight108))
    yr = C.groupby("year").apply(lambda x: pd.Series({"cards": len(x),
                                                      "per_round": x.implied_108.clip(lower=0).sum() / x.R.sum()}),
                                 include_groups=False)
    out["implied_108_per_round_by_year"] = {int(k): {"cards": int(v.cards), "per_round": v.per_round}
                                            for k, v in yr.iterrows()}
    # score patterns, by format, for non-draw decisions
    pats = {}
    for R in (3, 5):
        x = C[(C.R == R) & (C.cat != "DRAW")]
        vc = (x.w.astype(str) + "-" + x.l.astype(str)).value_counts()
        pats[str(R)] = {k: {"n": int(v), "share": share(v, len(x))} for k, v in vc.head(12).items()}
    out["card_patterns_winner_first"] = pats
    # disagreement
    nd_ids = set(nd.fid)
    Cn = C[C.fid.isin(nd_ids)]
    out["share_decisions_cards_not_identical"] = share(
        Cn.groupby("fid").apply(lambda x: x[["l", "w"]].drop_duplicates().shape[0] > 1, include_groups=False).sum(),
        len(nd_ids))
    out["share_decisions_judges_disagree_on_winner"] = share((nd.cat != "U-DEC").sum(), len(nd))
    # minimum round-level disagreement between judge pairs (10-9-only cards)
    clean = Cn[Cn.implied_108 == 0].copy()
    clean["wr"] = (clean.R + clean.margin) / 2  # rounds to the fight winner
    dis, tot = 0.0, 0
    for fid, x in clean.groupby("fid"):
        if len(x) != 3:
            continue
        w = x.wr.to_numpy()
        R = int(x.R.iloc[0])
        for i in range(3):
            for j in range(i + 1, 3):
                dis += abs(w[i] - w[j])
                tot += R
    out["min_pairwise_round_disagreement_rate"] = share(dis, tot)
    # per-judge
    C["dissent"] = False
    for fid, x in C[C.cat.isin(["S-DEC", "M-DEC"])].groupby("fid"):
        idx_min = x.index[x.margin <= 0]  # card for the loser (split) or a drawn card (majority)
        C.loc[idx_min, "dissent"] = True
    jt = C.groupby("judge").agg(cards=("fid", "size"), rounds=("R", "sum"), dissent=("dissent", "sum"),
                                i108=("implied_108", lambda s: s.clip(lower=0).sum()),
                                first=("year", "min"), last=("year", "max"),
                                margin=("margin", "mean")).sort_values("cards", ascending=False)
    jt["dissent_rate"] = jt.dissent / jt.cards
    jt["implied_108_per_round"] = jt.i108 / jt.rounds
    out["judges_total"] = int(len(jt))
    out["per_judge_top"] = [{"judge": j, "cards": int(r.cards), "years": f"{int(r['first'])}-{int(r['last'])}",
                             "dissent_rate": r.dissent_rate, "implied_108_per_round": r.implied_108_per_round,
                             "mean_margin_to_fight_winner": r.margin} for j, r in jt.head(top_judges).iterrows()]
    out["dissent_rate_overall"] = share(C.dissent.sum(), len(C))
    return out, C


# ----------------------------------------------------------------------------------------------
# round-winner model (numpy logistic regression)
# ----------------------------------------------------------------------------------------------
def logit_fit(X, y, w=None, ridge=1e-6, iters=100):
    """No-intercept logistic regression by IRLS (Newton). y may be soft labels in [0, 1]."""
    n, k = X.shape
    w = np.ones(n) if w is None else w
    beta = np.zeros(k)
    for _ in range(iters):
        z = np.clip(X @ beta, -30, 30)
        p = 1 / (1 + np.exp(-z))
        g = X.T @ (w * (y - p)) - ridge * beta
        H = (X * (w * p * (1 - p))[:, None]).T @ X + ridge * np.eye(k)
        step = np.linalg.solve(H, g)
        beta += step
        if np.max(np.abs(step)) < 1e-9:
            break
    z = np.clip(X @ beta, -30, 30)
    p = 1 / (1 + np.exp(-z))
    H = (X * (w * p * (1 - p))[:, None]).T @ X + ridge * np.eye(k)
    se = np.sqrt(np.diag(np.linalg.inv(H)))
    ll = float((w * (y * np.log(p + 1e-12) + (1 - y) * np.log(1 - p + 1e-12))).sum())
    return beta, se, ll, p


FEATURE_SETS = {
    "target": ["head_l", "body_l", "leg_l", "kd", "td_l", "ctrl_min", "sub"],
    "position": ["dist_l", "clinch_l", "ground_l", "kd", "td_l", "ctrl_min", "sub"],
    "extended": ["head_l", "body_l", "leg_l", "sig_miss", "nonsig_l", "kd", "td_l", "td_miss", "ctrl_min", "sub", "rev"],
}


def round_diffs(Sg):
    s = Sg.copy()
    s["ctrl_min"] = s.ctrl / 60
    s["sig_miss"] = s.sig_a - s.sig_l
    s["nonsig_l"] = (s.tot_l - s.sig_l).clip(lower=0)
    s["td_miss"] = s.td_a - s.td_l
    cols = sorted(set(sum(FEATURE_SETS.values(), [])) | {"sig_l"})
    a = s[s.idx == 0].set_index(["fid", "rnd"])[cols]
    b = s[s.idx == 1].set_index(["fid", "rnd"])[cols]
    return (a - b).dropna()


def round_model_block(Fg, Sg, cards, holdout_from="2023-01-01"):
    D = round_diffs(Sg)
    dec = decisions_frame(Fg)
    dec = dec[dec.cat != "DRAW"]
    out = {}
    # ---- clean subset: every judge gave the fight winner every round 10-9 ----
    clean_ids = [f.fid for f in dec.itertuples()
                 if all(lo == 9 * int(f.sched) and wi == 10 * int(f.sched) for _, lo, wi in f.cards)]
    cl = dec[dec.fid.isin(clean_ids)].set_index("fid")
    Dc = D[D.index.get_level_values(0).isin(clean_ids)]
    yc = (cl.loc[Dc.index.get_level_values(0), "winner"].to_numpy() == 0).astype(float)
    out["clean_subset"] = {"n_fights": len(clean_ids), "n_rounds": len(Dc),
                           "definition": "decisions where all three cards are 30-27 (or 50-45) for the winner, "
                                         "so every round's winner is known"}
    for name, feats in FEATURE_SETS.items():
        X = Dc[feats].to_numpy(float)
        beta, se, ll, p = logit_fit(X, yc)
        acc = float(((p > 0.5) == (yc == 1)).mean())
        out["clean_subset"][name] = {"coef": dict(zip(feats, beta)), "se": dict(zip(feats, se)),
                                     "loglik": ll, "in_sample_round_accuracy": acc,
                                     "head_equiv": {f: b / beta[0] for f, b in zip(feats, beta)}}
    # ---- EM on all 10-9-only cards (each judge's card separately) ----
    C = cards[cards.fid.isin(set(dec.fid))].copy()
    C = C[(C.implied_108 == 0)].copy()
    C["k"] = ((C.R + C.margin) / 2).astype(int)  # rounds to the fight winner on this card
    win = dec.set_index("fid").winner
    Dw = D.copy()
    sign = np.where(win.reindex(Dw.index.get_level_values(0)).to_numpy() == 0, 1.0, -1.0)
    Dw = Dw.mul(sign, axis=0)  # oriented winner - loser
    Dw = Dw[Dw.index.get_level_values(0).isin(set(C.fid))]
    C = C[C.fid.isin(set(Dw.index.get_level_values(0)))]
    em_out = {"n_cards": len(C), "n_fights": int(C.fid.nunique()),
              "definition": "all decision cards whose total implies only 10-9 rounds; latent round winners "
                            "per judge, EM with a weighted no-intercept logistic M-step"}

    def em_fit(Cs, feats, iters=60):
        # card-round rows
        Xf = {fid: Dw.loc[fid][feats].sort_index().to_numpy(float) for fid in Cs.fid.unique()}
        beta = np.zeros(len(feats))
        rows_X, rows_card = [], []
        for ci, c in enumerate(Cs.itertuples()):
            Xc = Xf[c.fid]
            if Xc.shape[0] != c.R:
                continue
            rows_X.append(Xc)
            rows_card.append((ci, c.R, c.k))
        Xall = np.vstack(rows_X)
        groups = {}
        start = 0
        for ci, R, k in rows_card:
            groups.setdefault((R, k), []).append(start)
            start += R
        Zs = {}
        for (R, k) in groups:
            Z = np.array([[(m >> i) & 1 for i in range(R)] for m in range(2 ** R)], float)
            Zs[(R, k)] = Z[Z.sum(1) == k]
        for it in range(iters):
            z = np.clip(Xall @ beta, -30, 30)
            p = 1 / (1 + np.exp(-z))
            post = np.empty_like(p)
            for (R, k), starts in groups.items():
                idx = np.array(starts)[:, None] + np.arange(R)[None, :]
                P = p[idx]
                L = np.log(P + 1e-12) @ Zs[(R, k)].T + np.log(1 - P + 1e-12) @ (1 - Zs[(R, k)]).T
                L -= L.max(1, keepdims=True)
                W = np.exp(L)
                W /= W.sum(1, keepdims=True)
                post[idx] = W @ Zs[(R, k)]
            new, se, ll, _ = logit_fit(Xall, post)
            if np.max(np.abs(new - beta)) < 1e-6:
                beta = new
                break
            beta = new
        return beta, len(rows_card), Xall.shape[0]

    for name, feats in FEATURE_SETS.items():
        beta, ncards, nrows = em_fit(C, feats)
        em_out[name] = {"coef": dict(zip(feats, beta)), "head_equiv": {f: b / beta[0] for f, b in zip(feats, beta)},
                        "n_card_rounds": nrows}
    out["em_all_cards"] = em_out

    # ---- holdout: fit EM on decisions before holdout_from, predict decision winners after ----
    dates = dec.set_index("fid").DATE
    train_ids = set(dates[dates < pd.Timestamp(holdout_from)].index)
    test = dec[dec.DATE >= pd.Timestamp(holdout_from)]
    feats = FEATURE_SETS["target"]
    beta_tr, _, _ = em_fit(C[C.fid.isin(train_ids)], feats)
    # clean-subset model fitted on the same training window, for comparison
    Dct = Dc[Dc.index.get_level_values(0).isin(train_ids)]
    yct = (cl.loc[Dct.index.get_level_values(0), "winner"].to_numpy() == 0).astype(float)
    beta_cl, _, _, _ = logit_fit(Dct[feats].to_numpy(float), yct)

    def predict(beta):
        preds, ys, base = [], [], []
        for f in test.itertuples():
            if f.fid not in D.index.get_level_values(0):
                continue
            X = D.loc[f.fid][feats].sort_index().to_numpy(float)  # fighter A (first listed) minus B
            if X.shape[0] != int(f.sched):
                continue
            p = 1 / (1 + np.exp(-np.clip(X @ beta, -30, 30)))
            dist = np.array([1.0])  # Poisson-binomial over rounds won by A
            for pr in p:
                dist = np.convolve(dist, [1 - pr, pr])
            R = len(p)
            q = dist[(R // 2) + 1:].sum()  # A wins a judge's card (10-9-only)
            preds.append(q ** 3 + 3 * q ** 2 * (1 - q))
            ys.append(1.0 if f.winner == 0 else 0.0)
            sl = D.loc[f.fid]["sig_l"].sum()
            base.append(1.0 if sl > 0 else 0.0 if sl < 0 else 0.5)
        preds, ys, base = np.array(preds), np.array(ys), np.array(base)
        eps = 1e-6
        base_correct = np.where(base == 0.5, 0.5, ((base > 0.5) == (ys == 1)).astype(float))
        bins = np.clip((preds * 10).astype(int), 0, 9)
        calib = [{"bin": f"{b / 10:.1f}-{(b + 1) / 10:.1f}", "n": int((bins == b).sum()),
                  "mean_pred": float(preds[bins == b].mean()) if (bins == b).any() else None,
                  "observed": float(ys[bins == b].mean()) if (bins == b).any() else None} for b in range(10)]
        return {"n_test_decisions": len(ys), "accuracy": float(((preds > 0.5) == (ys == 1)).mean()),
                "brier": float(((preds - ys) ** 2).mean()),
                "log_loss": float(-(ys * np.log(np.clip(preds, eps, 1 - eps)) +
                                    (1 - ys) * np.log(np.clip(1 - preds, eps, 1 - eps))).mean()),
                "baseline_more_sig_landed_accuracy": float(base_correct.mean()), "calibration": calib}
    em_m = predict(beta_tr)
    cl_m = predict(beta_cl)
    out["holdout"] = dict(em_m, train_before=holdout_from, coef_train=dict(zip(feats, beta_tr)),
                          clean_model=dict(cl_m, coef_train=dict(zip(feats, beta_cl))),
                          note="judges treated as independent given round stats; 10-8s ignored; "
                               "baseline = fighter with more sig strikes landed (ties count half)")
    return out


# ----------------------------------------------------------------------------------------------
# summaries across groups
# ----------------------------------------------------------------------------------------------
def group_block(F, S, mask, label, with_judging=True):
    Fg = F[mask]
    Sg = S[S.fid.isin(set(Fg.fid))]
    blk = {"label": label, "n_fights": len(Fg), "n_fights_with_stats": int(Fg.has_stats.sum()),
           "date_range": [str(Fg.DATE.min().date()), str(Fg.DATE.max().date())] if len(Fg) else None,
           "methods": methods_block(Fg),
           "hazard": {"3": hazard_block(Fg, 3), "5": hazard_block(Fg, 5)},
           "finish_timing": timing_block(Fg),
           "finish_detail": finish_detail_block(Fg),
           "stoppages": stoppage_block(Fg)}
    if len(Sg):
        blk["rates"] = rates_block(Sg)
        blk["knockdowns"] = kd_block(Sg, Fg)
        blk["grappling"] = grappling_block(Sg, Fg)
        blk["position_time"] = position_time_block(Sg)
        blk["grappling"]["sub_att_per_est_ground_minute"] = share(Sg["sub"].sum(),
                                                                  blk["position_time"]["est_ground_minutes"])
        blk["round_dist"] = round_dist_block(Sg)
    if with_judging:
        d = decisions_frame(Fg)
        if len(d) >= 20:
            j, _ = judging_block(Fg, top_judges=0)
            blk["judging"] = {k: j[k] for k in ["n_decisions_parsed", "type_shares", "draw_share_of_decisions",
                                                "implied_108_per_round", "cards_implied_108_or_deduction_share",
                                                "share_decisions_judges_disagree_on_winner",
                                                "min_pairwise_round_disagreement_rate"]}
    return blk


def division_table(F, S):
    rows = []
    for div in DIVISIONS:
        Fg = F[F.division == div]
        if len(Fg) < 30:
            continue
        Sg = S[S.fid.isin(set(Fg.fid))]
        m = methods_block(Fg)
        rt = rates_block(Sg)
        kd = kd_block(Sg, Fg)
        gr = grappling_block(Sg, Fg)
        rows.append({"division": div, "n_fights": len(Fg), "ko_tko": m["shares"]["KO/TKO"], "sub": m["shares"]["SUB"],
                     "decision": m["decision_rate"], "finish_rate": m["finish_rate"],
                     "slpm": rt["per15"]["sig_landed"] / 15, "sapm_att": rt["per15"]["sig_attempted"] / 15,
                     "sig_acc": rt["accuracy"]["sig"], "head_acc": rt["accuracy"]["head"],
                     "body_acc": rt["accuracy"]["body"], "leg_acc": rt["accuracy"]["leg"],
                     "dist_acc": rt["accuracy"]["dist"], "clinch_acc": rt["accuracy"]["clinch"],
                     "ground_acc": rt["accuracy"]["ground"],
                     "head_share": rt["landed_share"]["head"], "body_share": rt["landed_share"]["body"],
                     "leg_share": rt["landed_share"]["leg"], "dist_share": rt["landed_share"]["dist"],
                     "clinch_share": rt["landed_share"]["clinch"], "ground_share": rt["landed_share"]["ground"],
                     "kd15": rt["per15"]["kd"], "kd_per100_standing_head": kd["per100_standing_head_landed"],
                     "p_finish_same_round_given_kd": kd["p_finish_same_round_given_kd"],
                     "td15": gr["td_landed_per15"], "td_att15": gr["td_attempted_per15"], "td_acc": gr["td_accuracy"],
                     "ctrl15_sec": gr["ctrl_sec_per15"], "ctrl_per_td": gr["ctrl_sec_per_td_landed"],
                     "sub15": gr["sub_att_per15"], "sub_conv": gr["sub_conversion"]})
    return rows


def by_year_table(F, S):
    rows = []
    for y, Fg in F.groupby("year"):
        Sg = S[S.fid.isin(set(Fg.fid))]
        m = methods_block(Fg)
        rt = rates_block(Sg)
        kd = kd_block(Sg, Fg)
        rows.append({"year": int(y), "n_fights": len(Fg), "finish_rate": m["finish_rate"],
                     "ko_tko": m["shares"]["KO/TKO"], "sub": m["shares"]["SUB"],
                     "sig_landed_per15": rt["per15"]["sig_landed"], "sig_acc": rt["accuracy"]["sig"],
                     "td_att_per15": rt["per15"]["td_attempted"], "td_acc": rt["accuracy"]["td"],
                     "ctrl_sec_per15": rt["per15"]["ctrl_sec"],
                     "kd_per100_standing_head": kd["per100_standing_head_landed"]})
    return rows


# ----------------------------------------------------------------------------------------------
# markdown
# ----------------------------------------------------------------------------------------------
def pct(x, d=1):
    return "-" if x is None else f"{100 * x:.{d}f}%"


def num(x, d=2):
    return "-" if x is None else f"{x:,.{d}f}"


def md_table(headers, rows):
    out = ["| " + " | ".join(headers) + " |", "|" + "|".join("---" for _ in headers) + "|"]
    for r in rows:
        out.append("| " + " | ".join(str(c) for c in r) + " |")
    return "\n".join(out)


def render_md(J):
    G = J["groups"]
    keys = list(G.keys())
    L = [f"# Base-rate tables (auto-generated by tools/baserates.py)", "",
         f"Generated {J['meta']['generated']} from {J['meta']['raw_dir']}, fights on or after {J['meta']['since']} "
         f"(data through {J['meta']['data_max_date']}). Numbers are per fighter unless stated.", ""]
    L += ["## Groups and method split", ""]
    L.append(md_table(["Group", "Fights", "KO/TKO", "of which doctor", "corner", "Sub", "U-DEC", "S-DEC", "M-DEC",
                       "Draw", "NC", "DQ", "Finish rate"],
                      [[G[k]["label"], G[k]["n_fights"], pct(G[k]["methods"]["shares"]["KO/TKO"]),
                        pct(G[k]["methods"]["ko_breakdown_share_of_fights"]["doctor"]),
                        pct(G[k]["methods"]["ko_breakdown_share_of_fights"]["corner"]),
                        pct(G[k]["methods"]["shares"]["SUB"]), pct(G[k]["methods"]["shares"]["U-DEC"]),
                        pct(G[k]["methods"]["shares"]["S-DEC"]), pct(G[k]["methods"]["shares"]["M-DEC"]),
                        pct(G[k]["methods"]["shares"]["DRAW"]), pct(G[k]["methods"]["shares"]["NC"]),
                        pct(G[k]["methods"]["shares"]["DQ"]), pct(G[k]["methods"]["finish_rate"])] for k in keys]))
    L += ["", "## Finish hazard by round", ""]
    for k in keys:
        for R in ("3", "5"):
            h = G[k]["hazard"][R]
            if h["n"] < 15:
                continue
            L.append(f"**{G[k]['label']}, {h['format']}** (n = {h['n']}, went the distance {pct(h['went_distance'])})")
            L.append("")
            L.append(md_table(["Round", "Reached", "Finishes", "KO/TKO", "Sub", "Share of all fights",
                               "Conditional on reaching (95% CI)", "Per minute"],
                              [[r["round"], r["reached"], r["finishes"], r["ko_tko"], r["sub"], pct(r["share_of_all"]),
                                f"{pct(r['conditional'])} ({pct(r['conditional_ci95'][0], 0)}-"
                                f"{pct(r['conditional_ci95'][1], 0)})", num(r["per_minute"], 4)] for r in h["rounds"]]))
            L.append("")
    L += ["## Finish timing within the round (in-round finishes)", ""]
    L.append(md_table(["Group", "n", "0-1 min", "1-2", "2-3", "3-4", "4-5", "Last 10 s", "First 30 s", "Median s"],
                      [[G[k]["label"], G[k]["finish_timing"]["all"]["n"]] +
                       [pct(x) for x in G[k]["finish_timing"]["all"]["by_minute_share"]] +
                       [pct(G[k]["finish_timing"]["all"]["last_10s_share"]),
                        pct(G[k]["finish_timing"]["all"]["first_30s_share"]),
                        num(G[k]["finish_timing"]["all"]["median_sec_into_round"], 0)] for k in keys]))
    L += ["", "## KO/TKO finish position and strike (strike stoppages only)", ""]
    pos_keys = ["distance", "clinch", "ground", "unknown"]
    L.append(md_table(["Group", "n"] + pos_keys + ["Punch", "Kick", "Knee", "Elbow", "Slam", "Head", "Body", "Leg",
                                                   "Sub to strikes"],
                      [[G[k]["label"], G[k]["finish_detail"]["n_ko_strikes"]] +
                       [pct(G[k]["finish_detail"]["position"].get(p, {}).get("share", 0)) for p in pos_keys] +
                       [pct(G[k]["finish_detail"]["strike"].get(s, {}).get("share", 0))
                        for s in ["Punch", "Kick", "Knee", "Elbow", "Slam"]] +
                       [pct(G[k]["finish_detail"]["target"].get(t, {}).get("share", 0)) for t in ["Head", "Body", "Leg"]] +
                       [pct(G[k]["finish_detail"]["submission_to_strikes"]["share"])] for k in keys]))
    a = G[keys[0]]["finish_detail"]
    L += ["", f"Ground sub-positions ({G[keys[0]]['label']}):", ""]
    L.append(md_table(["Sub-position", "n", "Share of strike KO/TKOs"],
                      [[p, v["n"], pct(v["share"])] for p, v in a["subposition"].items()]))
    L += ["", f"Submission types and positions ({G[keys[0]]['label']}, n = {a['n_sub']}):", ""]
    L.append(md_table(["Type", "n", "Share"], [[p, v["n"], pct(v["share"])] for p, v in list(a["sub_type"].items())[:14]]))
    L.append("")
    L.append(md_table(["Position", "n", "Share"], [[p, v["n"], pct(v["share"])] for p, v in a["sub_position"].items()]))
    L += ["", "## Strike rates per 15 minutes (per fighter) and accuracy", ""]
    hdr = ["Group", "Sig landed", "Sig att", "Acc", "Head l/a", "Body l/a", "Leg l/a", "Dist l/a", "Clinch l/a",
           "Ground l/a", "Total landed"]
    rows = []
    for k in keys:
        if "rates" not in G[k]:
            continue
        p = G[k]["rates"]["per15"]
        rows.append([G[k]["label"], num(p["sig_landed"]), num(p["sig_attempted"]), pct(G[k]["rates"]["accuracy"]["sig"])] +
                    [f"{num(p[t + '_landed'])} / {num(p[t + '_attempted'])}" for t in
                     ["head", "body", "leg", "dist", "clinch", "ground"]] + [num(p["tot_landed"])])
    L.append(md_table(hdr, rows))
    L.append("")
    L.append(md_table(["Group", "Head acc", "Body acc", "Leg acc", "Dist acc", "Clinch acc", "Ground acc",
                       "Landed head/body/leg", "Landed dist/clinch/ground"],
                      [[G[k]["label"]] + [pct(G[k]["rates"]["accuracy"][t]) for t in
                                          ["head", "body", "leg", "dist", "clinch", "ground"]] +
                       ["/".join(pct(G[k]["rates"]["landed_share"][t], 0) for t in ["head", "body", "leg"]),
                        "/".join(pct(G[k]["rates"]["landed_share"][t], 0) for t in ["dist", "clinch", "ground"])]
                       for k in keys if "rates" in G[k]]))
    L += ["", "## Knockdowns", ""]
    L.append(md_table(["Group", "KD", "KD/15", "per 100 standing head landed (range)", "per 100 head landed",
                       "per 100 sig landed", "P(finish same round given KD)", "1 KD", "2+ KD", "P(scorer wins)",
                       "KO-by-strikes with winner KD in final round"],
                      [[G[k]["label"], int(G[k]["knockdowns"]["knockdowns"]), num(G[k]["knockdowns"]["per15"], 3),
                        f"{num(G[k]['knockdowns']['per100_standing_head_landed'])} "
                        f"({num(G[k]['knockdowns']['per100_standing_head_landed_range'][0])}-"
                        f"{num(G[k]['knockdowns']['per100_standing_head_landed_range'][1])})",
                        num(G[k]["knockdowns"]["per100_head_landed_all_positions"]),
                        num(G[k]["knockdowns"]["per100_sig_landed"]),
                        pct(G[k]["knockdowns"]["p_finish_same_round_given_kd"]),
                        pct(G[k]["knockdowns"]["p_finish_same_round_given_one_kd"]),
                        pct(G[k]["knockdowns"]["p_finish_same_round_given_two_plus_kd"]),
                        pct(G[k]["knockdowns"]["p_scorer_wins_fight_given_kd"]),
                        pct(G[k]["knockdowns"]["share_ko_strike_finishes_with_winner_kd_in_final_round"])]
                       for k in keys if "knockdowns" in G[k]]))
    L.append("")
    L.append(md_table(["Group", "Ground KO per 100 ground landed", "Standing KO per 100 standing head landed",
                       "Standing KO without KD per 100 standing head"],
                      [[G[k]["label"], num(G[k]["knockdowns"]["ground_ko_per100_ground_landed"], 3),
                        num(G[k]["knockdowns"]["standing_ko_per100_standing_head_landed"], 3),
                        num(G[k]["knockdowns"]["standing_ko_without_kd_per100_standing_head_landed"], 3)]
                       for k in keys if "knockdowns" in G[k]]))
    L += ["", "## Grappling", ""]
    L.append(md_table(["Group", "TD landed/15", "TD att/15", "TD acc", "CTRL s/15", "CTRL s per TD", "Sub att/15",
                       "Sub att per ctrl min (per est. ground min)", "Sub conversion", "Rev/15"],
                      [[G[k]["label"], num(G[k]["grappling"]["td_landed_per15"]),
                        num(G[k]["grappling"]["td_attempted_per15"]), pct(G[k]["grappling"]["td_accuracy"]),
                        num(G[k]["grappling"]["ctrl_sec_per15"], 1), num(G[k]["grappling"]["ctrl_sec_per_td_landed"], 1),
                        num(G[k]["grappling"]["sub_att_per15"], 3),
                        f"{num(G[k]['grappling']['sub_att_per_ctrl_minute'], 3)} "
                        f"({num(G[k]['grappling']['sub_att_per_est_ground_minute'], 3)})",
                        pct(G[k]["grappling"]["sub_conversion"]), num(G[k]["grappling"]["reversals_per15"], 3)]
                       for k in keys if "grappling" in G[k]]))
    L += ["", "## Position time (estimated)", ""]
    L.append(md_table(["Group", "CTRL share of fight time", "Est. ground (alt)", "Est. clinch control (alt)",
                       "Distance or neutral", "s CTRL per clinch att", "s per ground att", "s per TD", "R2"],
                      [[G[k]["label"], pct(G[k]["position_time"]["ctrl_share_of_fight_time"]),
                        f"{pct(G[k]['position_time']['est_share']['ground'])} "
                        f"({pct(G[k]['position_time']['est_share_alt_pure_clinch_ratio']['ground'])})",
                        f"{pct(G[k]['position_time']['est_share']['clinch_control'])} "
                        f"({pct(G[k]['position_time']['est_share_alt_pure_clinch_ratio']['clinch_control'])})",
                        pct(G[k]["position_time"]["est_share"]["distance_or_neutral"]),
                        num(G[k]["position_time"]["fit"]["sec_ctrl_per_clinch_sig_att"], 1),
                        num(G[k]["position_time"]["fit"]["sec_ctrl_per_ground_sig_att"], 1),
                        num(G[k]["position_time"]["fit"]["sec_ctrl_per_td_landed"], 1),
                        num(G[k]["position_time"]["fit"]["r2"], 2)] for k in keys if "position_time" in G[k]]))
    L += ["", "## Round-level distributions (full rounds, per fighter)", ""]
    L.append(md_table(["Group", "Stat", "n", "Mean", "SD", "Var/mean", "NB k", "P10", "P50", "P90", "P(0)"],
                      [[G[k]["label"], st, G[k]["round_dist"][st]["n"], num(G[k]["round_dist"][st]["mean"]),
                        num(G[k]["round_dist"][st]["sd"]), num(G[k]["round_dist"][st]["var_over_mean"]),
                        num(G[k]["round_dist"][st]["nb_k"]), num(G[k]["round_dist"][st]["p10"], 0),
                        num(G[k]["round_dist"][st]["p50"], 0), num(G[k]["round_dist"][st]["p90"], 0),
                        pct(G[k]["round_dist"][st]["p_zero"])]
                       for k in keys if "round_dist" in G[k] for st in ["sig_l", "sig_a", "head_l", "body_l", "leg_l",
                                                                         "td_l", "ctrl"]]))
    L.append("")
    L.append(md_table(["Group", "Corr(A, B) sig landed in a round", "Corr(round r, r+1) same fighter",
                       "P(KD by fighter in a round)"],
                      [[G[k]["label"], num(G[k]["round_dist"]["corr_sig_l_between_opponents"], 3),
                        num(G[k]["round_dist"]["corr_sig_l_round_to_next_same_fighter"], 3),
                        pct(G[k]["round_dist"]["p_kd_in_round_by_fighter"], 2)] for k in keys if "round_dist" in G[k]]))
    L += ["", "## Corner, doctor and injury stoppages", ""]
    L.append(md_table(["Group", "Fights", "Doctor", "per 100", "Corner", "per 100", "Injury", "per 100"],
                      [[G[k]["label"], G[k]["n_fights"]] + sum([[G[k]["stoppages"][x]["n"],
                                                                 num(G[k]["stoppages"][x]["per_100_fights"])]
                                                                for x in ["doctor", "corner", "injury"]], [])
                       for k in keys]))
    L.append("")
    L.append(md_table(["Group", "Between-round stoppages (KO/TKO at 5:00, non-strike)", "per 100 fights", "By kind"],
                      [[G[k]["label"], G[k]["stoppages"]["between_rounds"]["n"],
                        num(G[k]["stoppages"]["between_rounds"]["per_100_fights"]),
                        ", ".join(f"{a} {b}" for a, b in G[k]["stoppages"]["between_rounds"]["by_kind"].items())]
                       for k in keys]))
    st = G[keys[0]]["stoppages"]["five_round_corner_doctor_by_round"]
    L += ["", "Corner or doctor stoppage by round, 5-round fights (all UFC):", ""]
    L.append(md_table(["Round", "Reached", "Corner/doctor stoppages", "Rate"],
                      [[r["round"], r["reached"], r["corner_or_doctor"], pct(r["rate_per_round_reached"], 2)] for r in st]))
    # pace
    P = J["pace_curve"]
    L += ["", "## Pace curve, 5-round fights (full rounds)", ""]
    for lab in ["all_full_rounds", "went_distance_only"]:
        L.append(f"**{lab.replace('_', ' ')}**" + (f" (n fights = {P['five_round']['n_fights_went_distance']})"
                                                   if lab == "went_distance_only" else ""))
        L.append("")
        L.append(md_table(["Round", "Fighter-rounds", "Sig landed/min", "Sig att/min", "Acc", "Att vs R1",
                           "Head/Body/Leg landed/min", "TD att/15", "TD acc", "CTRL s/round", "KD per 100 standing head"],
                          [[r["round"], r["fighter_rounds"], num(r["sig_landed_per_min"]), num(r["sig_att_per_min"]),
                            pct(r["sig_acc"]), num(r["att_ratio_to_r1"], 3),
                            f"{num(r['head_landed_per_min'])}/{num(r['body_landed_per_min'])}/{num(r['leg_landed_per_min'])}",
                            num(r["td_att_per15"]), pct(r["td_acc"]), num(r["ctrl_sec_per_round"], 1),
                            num(r["kd_per100_standing_head"])] for r in P["five_round"][lab]]))
        L.append("")
    L.append(f"**LW+FW 5-round fights, went distance only** (n fights = {P['five_round_lw_fw']['n_fights_went_distance']})")
    L.append("")
    L.append(md_table(["Round", "Fighter-rounds", "Sig landed/min", "Sig att/min", "Acc", "Att vs R1", "TD att/15",
                       "CTRL s/round"],
                      [[r["round"], r["fighter_rounds"], num(r["sig_landed_per_min"]), num(r["sig_att_per_min"]),
                        pct(r["sig_acc"]), num(r["att_ratio_to_r1"], 3), num(r["td_att_per15"]),
                        num(r["ctrl_sec_per_round"], 1)] for r in P["five_round_lw_fw"]["went_distance_only"]]))
    L.append("")
    L.append("**3-round fights, for comparison (all full rounds)**")
    L.append("")
    L.append(md_table(["Round", "Fighter-rounds", "Sig landed/min", "Sig att/min", "Acc", "Att vs R1", "TD att/15",
                       "CTRL s/round"],
                      [[r["round"], r["fighter_rounds"], num(r["sig_landed_per_min"]), num(r["sig_att_per_min"]),
                        pct(r["sig_acc"]), num(r["att_ratio_to_r1"], 3), num(r["td_att_per15"]),
                        num(r["ctrl_sec_per_round"], 1)] for r in P["three_round"]["all_full_rounds"]]))
    # judging
    Jg = J["judging"]
    L += ["", "## Judging", ""]
    L.append(f"Decisions parsed: {Jg['n_decisions_parsed']} ({Jg['n_cards']} cards). Unanimous "
             f"{pct(Jg['type_shares']['U-DEC'])}, split {pct(Jg['type_shares']['S-DEC'])}, majority "
             f"{pct(Jg['type_shares']['M-DEC'])} of non-draw decisions; draws {pct(Jg['draw_share_of_decisions'])} "
             f"of decisions. Judges disagree on the winner in {pct(Jg['share_decisions_judges_disagree_on_winner'])} "
             f"of decisions; cards are not identical in {pct(Jg['share_decisions_cards_not_identical'])}. "
             f"Minimum pairwise round disagreement: {pct(Jg['min_pairwise_round_disagreement_rate'])} of rounds. "
             f"Implied 10-8 (or deduction) per round: {pct(Jg['implied_108_per_round'], 2)} "
             f"(3-rd {pct(Jg['implied_108_per_round_3rd'], 2)}, 5-rd {pct(Jg['implied_108_per_round_5rd'], 2)}); "
             f"cards with one: {pct(Jg['cards_implied_108_or_deduction_share'])}; decisions with at least one such "
             f"card: {pct(Jg['decisions_with_any_implied_108_share'])}.")
    L.append("")
    for R in ("3", "5"):
        L.append(f"Card patterns, {R} rounds (winner's score first):")
        L.append("")
        L.append(md_table(["Card", "n", "Share"], [[k, v["n"], pct(v["share"])]
                                                   for k, v in Jg["card_patterns_winner_first"][R].items()]))
        L.append("")
    L.append("Implied 10-8 per round by year:")
    L.append("")
    L.append(md_table(["Year", "Cards", "Per round"], [[y, v["cards"], pct(v["per_round"], 2)]
                                                       for y, v in Jg["implied_108_per_round_by_year"].items()]))
    L.append("")
    L.append("Most frequent judges:")
    L.append("")
    L.append(md_table(["Judge", "Cards", "Years", "Dissent rate", "Implied 10-8 per round", "Mean margin to winner"],
                      [[r["judge"], r["cards"], r["years"], pct(r["dissent_rate"]), pct(r["implied_108_per_round"], 2),
                        num(r["mean_margin_to_fight_winner"])] for r in Jg["per_judge_top"]]))
    # round model
    M = J["round_model"]
    L += ["", "## Round-winner model (logistic, no intercept, A minus B differentials)", ""]
    for src, title in [("clean_subset", "Clean subset (every card 30-27 / 50-45)"),
                       ("em_all_cards", "EM on all 10-9-only cards")]:
        L.append(f"**{title}**: " + (f"{M[src]['n_fights']} fights, {M[src]['n_rounds']} rounds" if src == "clean_subset"
                                     else f"{M[src]['n_cards']} cards from {M[src]['n_fights']} fights"))
        L.append("")
        for name in FEATURE_SETS:
            blk = M[src][name]
            hdr = ["Feature", "Coef"] + (["SE"] if "se" in blk else []) + ["Head-strike equivalents"]
            rows = []
            for f, c in blk["coef"].items():
                rows.append([f, num(c, 4)] + ([num(blk["se"][f], 4)] if "se" in blk else []) +
                            [num(blk["head_equiv"][f], 2)])
            extra = f" (in-sample round accuracy {pct(blk['in_sample_round_accuracy'])})" if "in_sample_round_accuracy" in blk else ""
            L.append(f"_{name} features_{extra}")
            L.append("")
            L.append(md_table(hdr, rows))
            L.append("")
    H = M["holdout"]
    L.append(f"Holdout: models fit on decisions before {H['train_before']}, tested on {H['n_test_decisions']} later "
             f"decisions (target features, three independent judges).")
    L.append("")
    L.append(md_table(["Model", "Accuracy", "Brier", "Log loss"],
                      [["EM, all 10-9 cards", pct(H["accuracy"]), num(H["brier"], 3), num(H["log_loss"], 3)],
                       ["Clean subset", pct(H["clean_model"]["accuracy"]), num(H["clean_model"]["brier"], 3),
                        num(H["clean_model"]["log_loss"], 3)],
                       ["More sig strikes landed", pct(H["baseline_more_sig_landed_accuracy"]), "-", "-"]]))
    L.append("")
    L.append("EM model calibration on the holdout (P(first-listed fighter wins the decision)):")
    L.append("")
    L.append(md_table(["Bin", "n", "Mean predicted", "Observed"],
                      [[c["bin"], c["n"], pct(c["mean_pred"]), pct(c["observed"])] for c in H["calibration"]]))
    # divisions
    L += ["", "## Divisions", ""]
    L.append(md_table(["Division", "Fights", "KO/TKO", "Sub", "Dec", "SLpM", "Sig acc", "Head/Body/Leg acc",
                       "KD/15", "KD per 100 st. head", "P(fin given KD)", "TD/15", "TD acc", "CTRL s/15", "CTRL/TD",
                       "Sub/15", "Sub conv"],
                      [[r["division"], r["n_fights"], pct(r["ko_tko"]), pct(r["sub"]), pct(r["decision"]),
                        num(r["slpm"]), pct(r["sig_acc"]),
                        f"{pct(r['head_acc'], 0)}/{pct(r['body_acc'], 0)}/{pct(r['leg_acc'], 0)}", num(r["kd15"], 3),
                        num(r["kd_per100_standing_head"]), pct(r["p_finish_same_round_given_kd"]), num(r["td15"]),
                        pct(r["td_acc"]), num(r["ctrl15_sec"], 0), num(r["ctrl_per_td"], 0), num(r["sub15"], 3),
                        pct(r["sub_conv"])] for r in J["divisions"]]))
    L += ["", "## By year (all UFC)", ""]
    L.append(md_table(["Year", "Fights", "Finish rate", "KO/TKO", "Sub", "Sig landed/15", "Sig acc", "TD att/15",
                       "TD acc", "CTRL s/15", "KD per 100 st. head"],
                      [[r["year"], r["n_fights"], pct(r["finish_rate"]), pct(r["ko_tko"]), pct(r["sub"]),
                        num(r["sig_landed_per15"]), pct(r["sig_acc"]), num(r["td_att_per15"]), pct(r["td_acc"]),
                        num(r["ctrl_sec_per15"], 0), num(r["kd_per100_standing_head"])] for r in J["by_year"]]))
    F_ = J["form"]
    L += ["", "## Fight-night form spread", ""]
    L.append(md_table(["Stat", "Fighter-fights", "Fighters", "Residual SD (log)", "Poisson SD", "Within-fight SD",
                       "Implied form SD", "Fighter effect SD", "Opponent effect SD"],
                      [[k, v["n_fighter_fights"], v["n_fighters"], num(v["resid_sd_log"], 3), num(v["poisson_sd_log"], 3),
                        num(v["within_fight_sd_log"], 3), num(v["implied_form_sd_log"], 3),
                        num(v["fighter_effect_sd_log"], 3), num(v["opponent_effect_sd_log"], 3)]
                       for k, v in F_.items() if isinstance(v, dict)]))
    L.append("")
    L.append(F_["note"])
    L += ["", "## Notes", ""] + [f"- {n}" for n in J["meta"]["notes"]]
    return "\n".join(L) + "\n"


# ----------------------------------------------------------------------------------------------
# engine targets: the curated numbers v3 reads
# ----------------------------------------------------------------------------------------------
def engine_targets(J):
    G = J["groups"]
    a, lw, fw, f5, ti = G["all"], G["lightweight"], G["featherweight"], G["five_round"], G["title"]
    M = J["round_model"]
    em = M["em_all_cards"]["target"]["coef"]
    t = {
        "kd_per_standing_head_landed": {k: G[k]["knockdowns"]["per100_standing_head_landed"] / 100 for k in G},
        "p_finish_same_round_given_kd": {k: G[k]["knockdowns"]["p_finish_same_round_given_kd"] for k in G},
        "ground_ko_per_ground_landed": {k: G[k]["knockdowns"]["ground_ko_per100_ground_landed"] / 100 for k in G},
        "standing_ko_without_kd_per_standing_head_landed":
            {k: G[k]["knockdowns"]["standing_ko_without_kd_per100_standing_head_landed"] / 100 for k in G},
        "td_accuracy": {k: G[k]["grappling"]["td_accuracy"] for k in G},
        "ctrl_sec_per_td_landed": {k: G[k]["grappling"]["ctrl_sec_per_td_landed"] for k in G},
        "ground_ctrl_sec_per_td_fit": {k: G[k]["position_time"]["fit"]["sec_ctrl_per_td_landed"] for k in G},
        "sub_conversion": {k: G[k]["grappling"]["sub_conversion"] for k in G},
        "sub_att_per_ctrl_minute": {k: G[k]["grappling"]["sub_att_per_ctrl_minute"] for k in G},
        "est_ground_share": {k: G[k]["position_time"]["est_share"]["ground"] for k in G},
        "est_clinch_control_share": {k: G[k]["position_time"]["est_share"]["clinch_control"] for k in G},
        "finish_conditional_by_round_5rd": {k: [r["conditional"] for r in G[k]["hazard"]["5"]["rounds"]]
                                            for k in G if G[k]["hazard"]["5"]["n"] >= 30},
        "finish_conditional_by_round_3rd": {k: [r["conditional"] for r in G[k]["hazard"]["3"]["rounds"]]
                                            for k in G if G[k]["hazard"]["3"]["n"] >= 30},
        "went_distance_5rd": {k: G[k]["hazard"]["5"]["went_distance"] for k in G if G[k]["hazard"]["5"]["n"] >= 30},
        "corner_doctor_per_round_5rd": [r["rate_per_round_reached"] for r in a["stoppages"]["five_round_corner_doctor_by_round"]],
        "pace_att_ratio_5rd_went_distance": [r["att_ratio_to_r1"] for r in J["pace_curve"]["five_round"]["went_distance_only"]],
        "pace_att_ratio_3rd": [r["att_ratio_to_r1"] for r in J["pace_curve"]["three_round"]["all_full_rounds"]],
        "round_sig_landed_nb_k": {k: G[k]["round_dist"]["sig_l"]["nb_k"] for k in G},
        "corr_sig_landed_opponents_round": {k: G[k]["round_dist"]["corr_sig_l_between_opponents"] for k in G},
        "form_sd_log_sig_landed": J["form"]["sig_landed"]["implied_form_sd_log"],
        "form_sd_log_sig_attempted": J["form"]["sig_attempted"]["implied_form_sd_log"],
        "between_fight_resid_sd_log_sig_landed": J["form"]["sig_landed"]["resid_sd_log"],
        "between_fight_resid_sd_log_sig_attempted": J["form"]["sig_attempted"]["resid_sd_log"],
        "sub_att_per_est_ground_minute": {k: G[k]["grappling"]["sub_att_per_est_ground_minute"] for k in G},
        "between_round_stoppages_per_100_fights": {k: G[k]["stoppages"]["between_rounds"]["per_100_fights"] for k in G},
        "judging": {"unanimous_share": J["judging"]["type_shares"]["U-DEC"],
                    "split_share": J["judging"]["type_shares"]["S-DEC"],
                    "majority_share": J["judging"]["type_shares"]["M-DEC"],
                    "draw_share_of_decisions": J["judging"]["draw_share_of_decisions"],
                    "implied_108_per_round": J["judging"]["implied_108_per_round"],
                    "min_pairwise_round_disagreement": J["judging"]["min_pairwise_round_disagreement_rate"],
                    "round_logit_coef_em_target": em,
                    "round_logit_coef_clean_target": M["clean_subset"]["target"]["coef"]},
    }
    return t


# ----------------------------------------------------------------------------------------------
def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--raw", default=str(ROOT / "data" / "raw"))
    ap.add_argument("--out", default=str(ROOT / "data" / "derived" / "baserates.json"))
    ap.add_argument("--md", default=str(ROOT / "data" / "derived" / "baserates_tables.md"))
    ap.add_argument("--since", default="2015-01-01")
    ap.add_argument("--holdout-from", default="2023-01-01")
    ap.add_argument("--group", action="append", default=[], help="extra group name=regex on WEIGHTCLASS")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args(argv)

    F, S, notes, data_max = load_data(args.raw, args.since)
    groups = {
        "all": (np.ones(len(F), bool), f"All UFC {args.since[:4]}+"),
        "lightweight": (F.division.eq("Lightweight").to_numpy(), "Lightweight"),
        "featherweight": (F.division.eq("Featherweight").to_numpy(), "Featherweight (men)"),
        "five_round": (F.five.to_numpy(), "5-round bouts"),
        "title": (F.title.to_numpy(), "UFC title bouts"),
        "lw_fw_five_round": ((F.division.isin(["Lightweight", "Featherweight"]) & F.five).to_numpy(),
                             "LW+FW 5-round bouts"),
    }
    for g in args.group:
        name, rx = g.split("=", 1)
        if rx.startswith("division:"):  # exact canonical division, e.g. division:Bantamweight (men only)
            groups[name] = (F.division.eq(rx.split(":", 1)[1]).to_numpy(), name)
        else:
            groups[name] = (F.wc.str.contains(rx, regex=True, na=False).to_numpy(), name)
    J = {"meta": {"generated": dt.datetime.now().strftime("%Y-%m-%d %H:%M"), "raw_dir": str(Path(args.raw)),
                  "since": args.since, "data_max_date": str(data_max.date()), "n_fights": len(F),
                  "n_fights_with_stats": int(F.has_stats.sum()), "notes": notes,
                  "group_definitions": {
                      "all": "every UFC bout on or after --since",
                      "lightweight": "WEIGHTCLASS names Lightweight (non-title, title, interim, TUF finals)",
                      "featherweight": "WEIGHTCLASS names Featherweight, men only",
                      "five_round": "TIME FORMAT starts with '5 Rnd'",
                      "title": "WEIGHTCLASS matches 'UFC ... Title Bout' (undisputed and interim, men and women; "
                               "TUF / Road to UFC tournament finals excluded)",
                      "lw_fw_five_round": "lightweight or featherweight, 5-round"},
                  "sources": ["https://github.com/Greco1899/scrape_ufc_stats", "http://ufcstats.com"]},
         "groups": {}}
    for key, (mask, label) in groups.items():
        J["groups"][key] = group_block(F, S, mask, label)
        if not args.quiet:
            print(f"[group] {key}: {J['groups'][key]['n_fights']} fights", file=sys.stderr)
    jud, cards = judging_block(F)
    J["judging"] = jud
    J["round_model"] = round_model_block(F, S, cards, holdout_from=args.holdout_from)
    J["pace_curve"] = {"five_round": pace_block(S, F, FMT5, 5), "three_round": pace_block(S, F, FMT3, 3),
                       "five_round_lw_fw": pace_block(S, F[F.division.isin(["Lightweight", "Featherweight"])], FMT5, 5)}
    J["form"] = form_block(S)
    J["divisions"] = division_table(F, S)
    J["by_year"] = by_year_table(F, S)
    J["engine_targets"] = engine_targets(J)
    J = clean(J)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(J, indent=1))
    md = render_md(J)
    Path(args.md).parent.mkdir(parents=True, exist_ok=True)
    Path(args.md).write_text(md)
    if not args.quiet:
        print(md)
        print(f"wrote {out} and {args.md}", file=sys.stderr)
    return J


if __name__ == "__main__":
    main()
