#!/usr/bin/env python3
"""Fighter report: fight log, rates and engine inputs for any UFC fighter.

Reads the ufcstats snapshot in data/raw/ (Greco1899/scrape_ufc_stats format) and writes, for one
fighter (or two with --vs):

  data/derived/fighter_<slug>.json   profile: bio, record, per-fight log with both sides' totals,
                                     career / last-3y / last-4y / time-decayed rates, chin and power,
                                     defense, pace curves, division splits, opponent-adjusted indices,
                                     engine-v3 sum vectors (docs/ENGINE_V3_SPEC.md key names) and the
                                     division priors the rates should be shrunk toward
  data/derived/fighter_<slug>.md     the same as a readable report
  data/derived/matchup_<a>__<b>.json/.md   (with --vs) common opponents, two-step links and a
                                     head-to-head projection table of the rates an engine combines

Usage:
  python3 tools/fighter_report.py "Alexander Volkanovski"
  python3 tools/fighter_report.py "Alexander Volkanovski" --vs "Justin Gaethje" --division Lightweight
  python3 tools/fighter_report.py "Max Holloway" --asof 2024-04-13 --half-life 730

Conventions (also written into the JSON "meta" block):
  * Rates use only fights with round stats. Minutes = completed rounds at scheduled length plus the
    final round's clock time.
  * "o"-prefixed numbers are what opponents did to the fighter (absorbed, conceded).
  * Time decay weights each fight by 0.5 ** (days before the as-of date / half-life); default 730 days.
  * KO/TKO includes doctor and corner stoppages (ufcstats files both under KO/TKO or "TKO - Doctor's").
  * ufcstats control time includes clinch control as well as ground control.
  * Fighters are matched by name. ufcstats has a handful of duplicate names (e.g. Bruno Silva,
    Michael McDonald); the script warns when the name is ambiguous because bouts carry no fighter id.
"""
from __future__ import annotations

import argparse
import difflib
import json
import math
import re
import sys
from datetime import date, datetime
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "derived"

HALF_LIFE_DAYS = 730
PRIOR_YEARS = 6          # window for division priors (league rates)
EB_MIN_EXPOSURE = 150    # head strikes, min exposure for a fighter to enter the EB dispersion fit
STAT_PAIRS = ["SIG.STR.", "TOTAL STR.", "TD", "HEAD", "BODY", "LEG", "DISTANCE", "CLINCH", "GROUND"]
PAIR_NAMES = {"SIG.STR.": "sig", "TOTAL STR.": "tot", "TD": "td", "HEAD": "head", "BODY": "body",
              "LEG": "leg", "DISTANCE": "dist", "CLINCH": "clinch", "GROUND": "ground"}
OWN = ["kd", "sub", "rev", "ctrl"] + [f"{p}_{x}" for p in PAIR_NAMES.values() for x in ("l", "a")]
DIVISIONS = [  # order matters: longer names first so "Light Heavyweight" wins over "Heavyweight"
    ("Women's Strawweight", 115), ("Women's Flyweight", 125), ("Women's Bantamweight", 135),
    ("Women's Featherweight", 145), ("Light Heavyweight", 205), ("Super Heavyweight", 999),
    ("Strawweight", 115), ("Flyweight", 125), ("Bantamweight", 135), ("Featherweight", 145),
    ("Lightweight", 155), ("Welterweight", 170), ("Middleweight", 185), ("Heavyweight", 265),
    ("Catch Weight", None), ("Open Weight", None),
]
DIV_LBS = dict(DIVISIONS)


# ----------------------------------------------------------------------------------------------
# Loading and parsing
# ----------------------------------------------------------------------------------------------

def _strip(df: pd.DataFrame) -> pd.DataFrame:
    df.columns = [c.strip() for c in df.columns]
    for c in df.columns:
        if not pd.api.types.is_numeric_dtype(df[c]):
            df[c] = df[c].astype("string").str.strip().replace({"": pd.NA})
    return df


def _mmss(s) -> float:
    """'m:ss' -> seconds; '--' or missing -> NaN."""
    if s is None or (isinstance(s, float) and math.isnan(s)) or pd.isna(s):
        return float("nan")
    m = re.match(r"^(\d+):(\d{1,2})$", str(s))
    return float(int(m.group(1)) * 60 + int(m.group(2))) if m else float("nan")


def _fmt_rounds(fmt) -> list[float] | None:
    """'5 Rnd (5-5-5-5-5)' -> [5,5,5,5,5]; 'No Time Limit' -> None."""
    if fmt is None or pd.isna(fmt):
        return None
    m = re.search(r"\(([\d\-]+)\)", str(fmt))
    return [float(x) for x in m.group(1).split("-")] if m else None


def _division(wc) -> str:
    s = "" if wc is None or pd.isna(wc) else str(wc)
    for name, _ in DIVISIONS:
        if name.lower() in s.lower():
            return name
    return "Other"


def _method(method, detail) -> str:
    m = "" if method is None or pd.isna(method) else str(method)
    if m.startswith("KO/TKO"):
        return "KO/TKO"
    if "Doctor" in m:
        return "KO/TKO"          # doctor stoppage, counted with KO/TKO as ufcstats' summary does
    if m.startswith("Submission"):
        return "SUB"
    if m == "Decision - Unanimous":
        return "U-DEC"
    if m == "Decision - Split":
        return "S-DEC"
    if m == "Decision - Majority":
        return "M-DEC"
    if m == "Could Not Continue":
        return "CNC"
    if m in ("DQ", "Overturned", "Other"):
        return m.upper() if m == "DQ" else m
    return m or "unknown"


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


class DB:
    """Parsed snapshot: fights (one row per bout), rounds (one row per fighter per round) and
    ff (one row per fighter per bout with own and opponent totals)."""

    def __init__(self, raw: Path = RAW):
        self.raw = raw
        ev = _strip(pd.read_csv(raw / "ufc_event_details.csv"))
        res = _strip(pd.read_csv(raw / "ufc_fight_results.csv"))
        st = _strip(pd.read_csv(raw / "ufc_fight_stats.csv"))
        self.tott = _strip(pd.read_csv(raw / "ufc_fighter_tott.csv"))
        self.details = _strip(pd.read_csv(raw / "ufc_fighter_details.csv"))

        ev["date"] = pd.to_datetime(ev["DATE"], format="%B %d, %Y", errors="coerce")
        res = res.merge(ev[["EVENT", "date", "LOCATION"]], on="EVENT", how="left")
        # The scrape lists a few cards twice under two names (e.g. "Noche UFC: Lopes vs. Silva" and
        # "UFC Fight Night: Lopes vs. Silva") with the same fight URLs. Keep one row per fight URL,
        # preferring the event name that has a date; drop fights whose event has no date at all.
        res = res.sort_values("date", na_position="last").drop_duplicates("URL", keep="first")
        self.dropped_undated = sorted(res.loc[res["date"].isna(), "EVENT"].unique().tolist())
        res = res[res["date"].notna()].copy()
        ab = res["BOUT"].str.split(" vs. ", n=1, expand=True)
        res["A"], res["B"] = ab[0].str.strip(), ab[1].str.strip()
        oc = res["OUTCOME"].str.split("/", n=1, expand=True)
        res["resA"], res["resB"] = oc[0], oc[1]
        res["division"] = res["WEIGHTCLASS"].map(_division)
        res["title"] = res["WEIGHTCLASS"].str.contains("Title", na=False) & ~res["WEIGHTCLASS"].str.contains(
            "Tournament", na=False)
        res["interim"] = res["WEIGHTCLASS"].str.contains("Interim", na=False)
        res["method"] = [_method(m, d) for m, d in zip(res["METHOD"], res["DETAILS"])]
        res["end_round"] = res["ROUND"].astype(int)
        res["end_s"] = res["TIME"].map(_mmss)
        res["fmt"] = res["TIME FORMAT"].map(_fmt_rounds)
        res["sched_rounds"] = res["fmt"].map(lambda f: len(f) if f else 1)
        res["fight_id"] = res["URL"]

        def _minutes(row):
            f, er, es = row["fmt"], row["end_round"], row["end_s"]
            if not f:
                return es / 60.0 if er == 1 else float("nan")
            return sum(f[: er - 1]) + es / 60.0
        res["minutes"] = res.apply(_minutes, axis=1)
        res["dup_key"] = res.duplicated(["EVENT", "BOUT"], keep=False)
        self.fights = res

        # --- round stats ---
        st = st.dropna(subset=["FIGHTER", "ROUND"]).copy()
        for col in STAT_PAIRS:
            x = st[col].str.extract(r"(\d+)\s+of\s+(\d+)").astype(float)
            st[PAIR_NAMES[col] + "_l"], st[PAIR_NAMES[col] + "_a"] = x[0], x[1]
        st["kd"] = pd.to_numeric(st["KD"], errors="coerce")
        st["sub"] = pd.to_numeric(st["SUB.ATT"], errors="coerce")
        st["rev"] = pd.to_numeric(st["REV."], errors="coerce")
        st["ctrl"] = st["CTRL"].map(_mmss)
        st["rnd"] = st["ROUND"].str.extract(r"(\d+)").astype(int)
        keyed = res[~res["dup_key"]][["EVENT", "BOUT", "fight_id", "A", "B", "fmt", "end_round", "end_s"]]
        st = st.merge(keyed, on=["EVENT", "BOUT"], how="inner")
        side = np.where(st["FIGHTER"] == st["A"], "A", np.where(st["FIGHTER"] == st["B"], "B", ""))
        st["side"] = side
        # resolve name mismatches within a bout by elimination
        bad = st["side"] == ""
        if bad.any():
            for fid, g in st[bad].groupby("fight_id"):
                sides = set(st.loc[(st["fight_id"] == fid) & ~bad, "side"])
                rest = {"A", "B"} - sides
                names = g["FIGHTER"].unique()
                if len(rest) == 1 and len(names) == 1:
                    st.loc[g.index, "side"] = rest.pop()
            st = st[st["side"] != ""]

        def _rmin(row):
            f, r, er, es = row["fmt"], row["rnd"], row["end_round"], row["end_s"]
            if r == er:
                return es / 60.0
            if f and r <= len(f):
                return f[r - 1]
            return 5.0
        st["rmin"] = st.apply(_rmin, axis=1)
        self.rounds = st[["fight_id", "rnd", "side", "FIGHTER", "rmin"] + OWN].copy()

        # --- fighter-fight long table ---
        agg = self.rounds.groupby(["fight_id", "side"])[OWN].sum(min_count=1).reset_index()
        ctrl_known = self.rounds.assign(ck=self.rounds["ctrl"].notna() * self.rounds["rmin"]).groupby(
            ["fight_id", "side"])["ck"].sum().reset_index()
        agg = agg.merge(ctrl_known, on=["fight_id", "side"])
        nr = self.rounds.groupby(["fight_id", "side"])["rnd"].max().rename("rds").reset_index()
        agg = agg.merge(nr, on=["fight_id", "side"])
        base_cols = ["fight_id", "date", "EVENT", "BOUT", "WEIGHTCLASS", "division", "title", "interim",
                     "METHOD", "method", "DETAILS", "end_round", "TIME", "end_s", "TIME FORMAT",
                     "sched_rounds", "minutes", "REFEREE", "LOCATION"]
        rows = []
        for me, op, rme in (("A", "B", "resA"), ("B", "A", "resB")):
            x = res[base_cols].copy()
            x["fighter"], x["opponent"], x["result"] = res[me], res[op], res[rme]
            x["side"] = me
            own = agg[agg["side"] == me].drop(columns="side")
            opp = agg[agg["side"] == op].drop(columns="side")
            opp = opp.rename(columns={c: "o_" + c for c in OWN + ["ck", "rds"]})
            x = x.merge(own, on="fight_id", how="left").merge(opp, on="fight_id", how="left")
            rows.append(x)
        ff = pd.concat(rows, ignore_index=True)
        ff["has_stats"] = ff["sig_a"].notna() & ff["o_sig_a"].notna()
        ff = ff.sort_values(["date", "fight_id", "side"]).reset_index(drop=True)
        self.ff = ff
        self.snapshot = ev["date"].max()

    # ------------------------------------------------------------------------------------------
    def find(self, name: str) -> str:
        names = pd.unique(pd.concat([self.ff["fighter"], self.tott["FIGHTER"]]).dropna())
        low = {n.lower(): n for n in names}
        if name.lower() in low:
            return low[name.lower()]
        sub = [n for n in names if name.lower() in n.lower()]
        if len(sub) == 1:
            return sub[0]
        close = difflib.get_close_matches(name, list(names), n=6, cutoff=0.6)
        raise SystemExit(f"Fighter '{name}' not found. Closest: {sub[:6] or close}")

    def bio(self, name: str) -> dict:
        t = self.tott[self.tott["FIGHTER"] == name]
        d = self.details.assign(full=(self.details["FIRST"].fillna("") + " " + self.details["LAST"].fillna("")).str.strip())
        nick = d.loc[d["full"] == name, "NICKNAME"].dropna()
        out = {"name": name, "nick": nick.iloc[0] if len(nick) else None, "ambiguous_name": bool(len(t) > 1)}
        if len(t):
            r = t.iloc[0]
            out.update(height_in=_inches(r["HEIGHT"]), reach_in=_inches(r["REACH"]),
                       weight_listed=None if pd.isna(r["WEIGHT"]) else str(r["WEIGHT"]),
                       stance=None if pd.isna(r["STANCE"]) else str(r["STANCE"]),
                       dob=_dob(r["DOB"]), ufcstats_url=None if pd.isna(r["URL"]) else str(r["URL"]))
        return out


def _inches(s):
    if s is None or pd.isna(s):
        return None
    m = re.match(r"(\d+)'\s*(\d+)", str(s))
    if m:
        return int(m.group(1)) * 12 + int(m.group(2))
    m = re.match(r'(\d+(?:\.\d+)?)"', str(s))
    return float(m.group(1)) if m else None


def _dob(s):
    if s is None or pd.isna(s) or str(s).strip() in ("--", ""):
        return None
    try:
        return datetime.strptime(str(s), "%b %d, %Y").date().isoformat()
    except ValueError:
        return None


# ----------------------------------------------------------------------------------------------
# Aggregation and rates
# ----------------------------------------------------------------------------------------------

SUM_COLS = OWN + ["o_" + c for c in OWN] + ["minutes", "ck", "o_ck", "rds"]


def sums(df: pd.DataFrame, w: pd.Series | None = None) -> dict:
    """Weighted sums over fighter-fights that have stats."""
    d = df[df["has_stats"]]
    ww = pd.Series(1.0, index=d.index) if w is None else w.loc[d.index]
    out = {c: float((d[c].fillna(0) * ww).sum()) for c in SUM_COLS}
    out["n"] = float(ww.sum())
    out["n_fights"] = int(len(d))
    return out


def _div(a, b, scale=1.0):
    return float(a) / float(b) * scale if b and b > 0 else None


def rates(s: dict) -> dict:
    m = s["minutes"]
    r = {
        "fights": s["n_fights"], "weight": round(s["n"], 3), "minutes": round(m, 2),
        # striking volume and accuracy
        "slpm": _div(s["sig_l"], m), "sapm": _div(s["o_sig_l"], m),
        "sig_att_pm": _div(s["sig_a"], m), "opp_sig_att_pm": _div(s["o_sig_a"], m),
        "sig_acc": _div(s["sig_l"], s["sig_a"]), "opp_sig_acc": _div(s["o_sig_l"], s["o_sig_a"]),
        "tot_lpm": _div(s["tot_l"], m), "tot_apm": _div(s["tot_a"], m),
        "diff_pm": _div(s["sig_l"] - s["o_sig_l"], m),
    }
    r["sig_def"] = None if r["opp_sig_acc"] is None else 1 - r["opp_sig_acc"]
    for t in ("head", "body", "leg", "dist", "clinch", "ground"):
        r[f"{t}_acc"] = _div(s[f"{t}_l"], s[f"{t}_a"])
        r[f"opp_{t}_acc"] = _div(s[f"o_{t}_l"], s[f"o_{t}_a"])
        r[f"{t}_share_l"] = _div(s[f"{t}_l"], s["sig_l"])
        r[f"{t}_share_a"] = _div(s[f"{t}_a"], s["sig_a"])
        r[f"opp_{t}_share_l"] = _div(s[f"o_{t}_l"], s["o_sig_l"])
        r[f"{t}_lpm"] = _div(s[f"{t}_l"], m)
        r[f"opp_{t}_lpm"] = _div(s[f"o_{t}_l"], m)
    r.update({
        # power and chin
        "kd15": _div(s["kd"], m, 15), "okd15": _div(s["o_kd"], m, 15),
        "kd": s["kd"], "okd": s["o_kd"], "head_l": s["head_l"], "o_head_l": s["o_head_l"],
        "power_kd_per100_head": _div(s["kd"], s["head_l"], 100),
        "chin_kd_per100_head_abs": _div(s["o_kd"], s["o_head_l"], 100),
        "power_kd_per100_sig": _div(s["kd"], s["sig_l"], 100),
        "chin_kd_per100_sig_abs": _div(s["o_kd"], s["o_sig_l"], 100),
        # grappling
        "td_att15": _div(s["td_a"], m, 15), "td_l15": _div(s["td_l"], m, 15),
        "td_acc": _div(s["td_l"], s["td_a"]),
        "otd_att15": _div(s["o_td_a"], m, 15), "otd_l15": _div(s["o_td_l"], m, 15),
        "opp_td_acc": _div(s["o_td_l"], s["o_td_a"]),
        "ctrl15_s": _div(s["ctrl"], s["ck"], 15), "octrl15_s": _div(s["o_ctrl"], s["o_ck"], 15),
        "ctrl_share": _div(s["ctrl"], s["ck"] * 60), "octrl_share": _div(s["o_ctrl"], s["o_ck"] * 60),
        "ctrl_per_td_s": _div(s["ctrl"], s["td_l"]), "octrl_per_otd_s": _div(s["o_ctrl"], s["o_td_l"]),
        "sub15": _div(s["sub"], m, 15), "osub15": _div(s["o_sub"], m, 15),
        "rev15": _div(s["rev"], m, 15), "orev15": _div(s["o_rev"], m, 15),
    })
    r["td_def"] = None if r["opp_td_acc"] is None else 1 - r["opp_td_acc"]
    return r


def spec_sums(df: pd.DataFrame, rounds: pd.DataFrame, w: pd.Series | None) -> dict:
    """Sums in docs/ENGINE_V3_SPEC.md key names (C = undecayed when w is None, S = decayed)."""
    s = sums(df, w)
    d = df[df["has_stats"]]
    ww = pd.Series(1.0, index=df.index) if w is None else w
    out = {"min": s["minutes"], "n": s["n"], "rds": s["rds"]}
    m = {"d": "dist", "c": "clinch", "g": "ground", "h": "head", "b": "body", "l": "leg", "t": "tot", "s": "sig"}
    for k, v in m.items():
        out[f"{k}_att"], out[f"{k}_lnd"] = s[f"{v}_a"], s[f"{v}_l"]
        out[f"o{k}_att"], out[f"o{k}_lnd"] = s[f"o_{v}_a"], s[f"o_{v}_l"]
    out.update(kd=s["kd"], okd=s["o_kd"], td_att=s["td_a"], td_lnd=s["td_l"], otd_att=s["o_td_a"],
               otd_lnd=s["o_td_l"], ctrl=s["ctrl"], octrl=s["o_ctrl"], sub_att=s["sub"], osub_att=s["o_sub"],
               rev=s["rev"], orev=s["o_rev"])
    allf = df  # results count every bout, with or without stats
    for res, key in (("W", "w"), ("L", "l")):
        sel = allf["result"] == res
        out[f"ko_{key}"] = float((ww[sel] * (allf.loc[sel, "method"] == "KO/TKO")).sum())
        out[f"sub_{key}"] = float((ww[sel] * (allf.loc[sel, "method"] == "SUB")).sum())
        out[f"dec_{key}"] = float((ww[sel] * allf.loc[sel, "method"].str.endswith("DEC")).sum())
    # pace in scheduled 5-round fights
    r5 = rounds[rounds["sched_rounds"] == 5]
    for i in range(1, 6):
        rr = r5[r5["rnd"] == i]
        wr = rr["w"] if w is not None else 1.0
        out[f"r5_min_{i}"] = float((rr["rmin"] * wr).sum())
        out[f"r5_lnd_{i}"] = float((rr["sig_l"] * wr).sum())
        out[f"r5_att_{i}"] = float((rr["sig_a"] * wr).sum())
    out["r5_min"] = sum(out[f"r5_min_{i}"] for i in range(1, 6))
    return {k: round(v, 4) for k, v in out.items()}


# ----------------------------------------------------------------------------------------------
# Division priors and empirical-Bayes prior strengths
# ----------------------------------------------------------------------------------------------

def division_priors(db: DB, division: str, asof: pd.Timestamp, years: int = PRIOR_YEARS) -> dict:
    lo = asof - pd.DateOffset(years=years)
    d = db.ff[(db.ff["division"] == division) & (db.ff["date"] > lo) & (db.ff["date"] <= asof)]
    s = sums(d)
    r = rates(s)
    bouts = db.fights[(db.fights["division"] == division) & (db.fights["date"] > lo) & (db.fights["date"] <= asof)]
    n = len(bouts)
    mc = bouts["method"].value_counts()
    r["bouts"] = n
    r["window"] = [lo.date().isoformat(), asof.date().isoformat()]
    r["lbs"] = DIV_LBS.get(division)
    r["method_split"] = {k: round(float(v) / n, 4) for k, v in mc.items()} if n else {}
    dec = bouts["method"].str.endswith("DEC")
    r["finish_rate"] = round(1 - float(dec.mean()), 4) if n else None
    b5 = bouts[bouts["sched_rounds"] == 5]
    r["five_round_bouts"] = int(len(b5))
    r["five_round_finish_rate"] = round(1 - float(b5["method"].str.endswith("DEC").mean()), 4) if len(b5) else None
    # KD-to-finish: share of fights with >= 1 KD by the winner that ended in winner's KO/TKO
    r["pace_5rd"] = pace(db, d.assign(w=1.0), sched=5)
    # prior strengths: fit k on the whole sex group (all men's or all women's divisions) in the window,
    # each fighter against his own division's pooled rate; then p is this division's rate
    grp = db.ff[db.ff["division"].isin(_sex_group(division)) & (db.ff["date"] > lo) & (db.ff["date"] <= asof)]
    r["eb"] = {}
    for key, num, den, mn in (("chin_head", "o_kd", "o_head_l", 20), ("power_head", "kd", "head_l", 20),
                              ("sig_acc", "sig_l", "sig_a", 50), ("opp_sig_acc", "o_sig_l", "o_sig_a", 50),
                              ("head_acc", "head_l", "head_a", 50), ("opp_head_acc", "o_head_l", "o_head_a", 50),
                              ("td_acc", "td_l", "td_a", 5), ("opp_td_acc", "o_td_l", "o_td_a", 5)):
        e = eb_strength(grp, num, den, min_n=mn)
        e["p_pooled_group"] = e.get("p")
        dp = sums(d)
        e["p"] = round(dp[num] / dp[den], 5) if dp[den] else e.get("p")
        e["k_division_only"] = eb_strength(d, num, den, min_n=mn).get("k")
        if e.get("k") is not None and e["p"] is not None:
            e["tau"] = round(math.sqrt(e["p"] * (1 - e["p"]) / (e["k"] + 1)), 5)
        r["eb"][key] = e
    return r


_LGAMMA = np.frompyfunc(math.lgamma, 1, 1)


def _lbeta(a, b):
    a = np.asarray(a, dtype=float); b = np.asarray(b, dtype=float)
    return (_LGAMMA(a) + _LGAMMA(b) - _LGAMMA(a + b)).astype(float)


def eb_strength(d: pd.DataFrame, num: str, den: str, min_n: int = 20,
                grid: np.ndarray | None = None) -> dict:
    """Beta-binomial prior strength by maximum likelihood over fighters in d.

    Each fighter's career counts (x events in n trials, e.g. knockdowns absorbed in head strikes
    absorbed) are modeled as Binomial(n, theta_i) with theta_i ~ Beta(k p_div, k (1 - p_div)), where
    p_div is the pooled rate of the fighter's main division in d and k is shared. The shrunk estimate
    for a fighter is then (x + k p) / (n + k). Returns p (pooled over d), k, the implied between-
    fighter sd of theta (tau, at p), the fighter count and, for comparison, a method-of-moments k."""
    grid = np.logspace(0.5, 5.0, 181) if grid is None else grid
    dd = d[d["has_stats"]]
    if dd.empty:
        return {"p": None, "k": None, "tau": None, "fighters": 0}
    mins = dd.groupby(["fighter", "division"])["minutes"].sum().reset_index()
    main = mins.sort_values("minutes").groupby("fighter").tail(1).set_index("fighter")["division"]
    g = dd.groupby("fighter")[[num, den]].sum()
    g["div"] = main.reindex(g.index)
    divp = dd.groupby("division")[[num, den]].sum()
    divp = (divp[num] / divp[den]).to_dict()
    g = g[g[den] >= min_n]
    if len(g) < 10:
        return {"p": None, "k": None, "tau": None, "fighters": int(len(g))}
    x, n = g[num].values.astype(float), g[den].values.astype(float)
    pi = np.clip(g["div"].map(divp).values.astype(float), 1e-6, 1 - 1e-6)
    ll = []
    for k in grid:
        a, b = k * pi, k * (1 - pi)
        ll.append(float((_lbeta(x + a, n - x + b) - _lbeta(a, b)).sum()))
    ll = np.array(ll)
    i = int(np.argmax(ll))
    k = float(grid[i])
    # approximate 95% interval from the profile likelihood (drop of 1.92)
    ok = grid[ll >= ll[i] - 1.92]
    p = float(x.sum() / n.sum())
    tau = math.sqrt(p * (1 - p) / (k + 1))
    # method of moments for comparison
    obs = x / n
    v_obs = np.average((obs - pi) ** 2, weights=n) * len(n) / (len(n) - 1)
    v_bin = np.average(pi * (1 - pi) / n, weights=n)
    tau2 = v_obs - v_bin
    k_mom = float(np.mean(pi * (1 - pi)) / tau2 - 1) if tau2 > 0 else None
    return {"p": round(p, 5), "k": round(k, 1), "k_95": [round(float(ok.min()), 1), round(float(ok.max()), 1)],
            "at_grid_edge": bool(i in (0, len(grid) - 1)), "tau": round(tau, 5), "fighters": int(len(g)),
            "min_exposure": min_n, "unit": den, "k_mom": None if k_mom is None else round(k_mom, 1),
            "div_p": {k_: round(float(v), 5) for k_, v in divp.items() if np.isfinite(v)}}


def _sex_group(division: str) -> list[str]:
    women = [d for d, _ in DIVISIONS if d.startswith("Women's")]
    men = [d for d, lb in DIVISIONS if not d.startswith("Women's") and lb and lb < 999]
    return women if division.startswith("Women's") else men


def shrink(x, n, eb):
    if eb.get("p") is None or eb.get("k") is None:
        return None
    return (x + eb["k"] * eb["p"]) / (n + eb["k"])


# ----------------------------------------------------------------------------------------------
# Pace, splits, opponent adjustment
# ----------------------------------------------------------------------------------------------

def pace(db: DB, ff_sub: pd.DataFrame, sched: int = 5, reached_last: bool = False) -> list[dict]:
    """Output per minute by round number in scheduled `sched`-round fights."""
    keys = ff_sub[ff_sub["sched_rounds"] == sched][["fight_id", "side", "w", "end_round"]]
    if reached_last:
        keys = keys[keys["end_round"] == sched]
    if keys.empty:
        return []
    rr = db.rounds.merge(keys, on=["fight_id", "side"])
    opp = db.rounds.rename(columns={c: "o_" + c for c in OWN}).copy()
    opp["side"] = opp["side"].map({"A": "B", "B": "A"})
    rr = rr.merge(opp[["fight_id", "rnd", "side"] + ["o_" + c for c in OWN]], on=["fight_id", "rnd", "side"],
                  how="left")
    out = []
    for i in range(1, sched + 1):
        x = rr[rr["rnd"] == i]
        if x.empty:
            continue
        w = x["w"]
        mins = float((x["rmin"] * w).sum())
        row = {"round": i, "fights": int(len(x)), "minutes": round(mins, 2)}
        for c, lab in (("sig_l", "slpm"), ("sig_a", "sig_att_pm"), ("o_sig_l", "sapm"), ("o_sig_a", "opp_att_pm"),
                       ("head_l", "head_lpm"), ("leg_l", "leg_lpm"), ("td_a", "td_att_pm"),
                       ("kd", "kd_pm"), ("o_kd", "okd_pm")):
            row[lab] = _div(float((x[c].fillna(0) * w).sum()), mins)
        row["sig_acc"] = _div(float((x["sig_l"] * w).sum()), float((x["sig_a"] * w).sum()))
        row["opp_sig_acc"] = _div(float((x["o_sig_l"] * w).sum()), float((x["o_sig_a"] * w).sum()))
        out.append(row)
    if out and out[0]["slpm"]:
        for row in out:
            row["slpm_vs_r1"] = _div(row["slpm"], out[0]["slpm"])
            row["att_vs_r1"] = _div(row["sig_att_pm"], out[0]["sig_att_pm"])
    return out


def opponent_adjusted(db: DB, fx: pd.DataFrame, k_min: float = 15.0,
                      asof: pd.Timestamp | None = None) -> tuple[list[dict], dict]:
    """For each fight, what the fighter did vs what the opponent usually allows/does in all his other
    UFC fights (leave-one-out, shrunk toward the league with k_min minutes). Index > 1 = better than
    the opponent's norm for 'landed' and 'acc'; < 1 = better for 'absorbed' and 'opp_acc'."""
    ff = db.ff[db.ff["has_stats"]]
    if asof is not None:
        ff = ff[ff["date"] <= asof]
    tot = ff.groupby("fighter")[["minutes", "sig_l", "sig_a", "o_sig_l", "o_sig_a", "td_l", "td_a", "o_td_l",
                                 "o_td_a"]].sum()
    lg = ff[["minutes", "sig_l", "sig_a", "o_sig_l", "o_sig_a"]].sum()
    lg_pm = lg["sig_l"] / lg["minutes"]
    lg_acc = lg["sig_l"] / lg["sig_a"]
    rows, agg = [], {"landed": 0.0, "exp_landed": 0.0, "absorbed": 0.0, "exp_absorbed": 0.0,
                     "acc_l": 0.0, "acc_exp_l": 0.0, "oacc_l": 0.0, "oacc_exp_l": 0.0}
    for _, f in fx[fx["has_stats"]].iterrows():
        if f["opponent"] not in tot.index:
            continue
        o = tot.loc[f["opponent"]]
        # opponent's other fights: remove this fight (from the opponent's perspective, own/opp swap)
        o_min = o["minutes"] - f["minutes"]
        o_abs = o["o_sig_l"] - f["sig_l"]          # what others landed on the opponent
        o_land = o["sig_l"] - f["o_sig_l"]         # what the opponent landed on others
        o_abs_att = o["o_sig_a"] - f["sig_a"]
        o_land_att = o["sig_a"] - f["o_sig_a"]
        abs_pm = (o_abs + k_min * lg_pm) / (o_min + k_min)
        land_pm = (o_land + k_min * lg_pm) / (o_min + k_min)
        acc_vs = (o_abs + 100 * lg_acc) / (o_abs_att + 100)       # accuracy others had vs opponent
        acc_by = (o_land + 100 * lg_acc) / (o_land_att + 100)     # opponent's own accuracy
        exp_l, exp_a = abs_pm * f["minutes"], land_pm * f["minutes"]
        rows.append({"date": f["date"].date().isoformat(), "opponent": f["opponent"],
                     "opp_other_min": round(float(o_min), 1),
                     "landed": int(f["sig_l"]), "exp_landed": round(float(exp_l), 1),
                     "landed_idx": _r(_div(f["sig_l"], exp_l)),
                     "absorbed": int(f["o_sig_l"]), "exp_absorbed": round(float(exp_a), 1),
                     "absorbed_idx": _r(_div(f["o_sig_l"], exp_a)),
                     "acc": _r(_div(f["sig_l"], f["sig_a"])), "opp_usual_acc_allowed": _r(acc_vs),
                     "opp_acc": _r(_div(f["o_sig_l"], f["o_sig_a"])), "opp_usual_acc": _r(acc_by)})
        agg["landed"] += f["sig_l"]; agg["exp_landed"] += exp_l
        agg["absorbed"] += f["o_sig_l"]; agg["exp_absorbed"] += exp_a
        agg["acc_l"] += f["sig_l"]; agg["acc_exp_l"] += acc_vs * f["sig_a"]
        agg["oacc_l"] += f["o_sig_l"]; agg["oacc_exp_l"] += acc_by * f["o_sig_a"]
    summary = {"landed_idx": _r(_div(agg["landed"], agg["exp_landed"])),
               "absorbed_idx": _r(_div(agg["absorbed"], agg["exp_absorbed"])),
               "acc_idx": _r(_div(agg["acc_l"], agg["acc_exp_l"])),
               "opp_acc_idx": _r(_div(agg["oacc_l"], agg["oacc_exp_l"])),
               "note": "landed/acc > 1 and absorbed/opp_acc < 1 are better than the opponents' norms"}
    return rows, summary


def _r(x, nd=3):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(float(x), nd)


# ----------------------------------------------------------------------------------------------
# Profile
# ----------------------------------------------------------------------------------------------

def fight_log(fx: pd.DataFrame) -> list[dict]:
    out = []
    for _, f in fx.iterrows():
        row = {
            "date": f["date"].date().isoformat() if pd.notna(f["date"]) else None,
            "event": f["EVENT"], "opponent": f["opponent"], "weightclass": f["WEIGHTCLASS"],
            "division": f["division"], "title": bool(f["title"]), "result": f["result"],
            "method": f["method"], "method_raw": f["METHOD"], "detail": None if pd.isna(f["DETAILS"]) else f["DETAILS"],
            "round": int(f["end_round"]), "time": f["TIME"], "format": f["TIME FORMAT"],
            "sched_rounds": int(f["sched_rounds"]), "minutes": _r(f["minutes"], 2),
            "referee": None if pd.isna(f["REFEREE"]) else f["REFEREE"], "has_stats": bool(f["has_stats"]),
            "fight_url": f["fight_id"],
        }
        if f["has_stats"]:
            for who, pre in (("for", ""), ("against", "o_")):
                row[who] = {
                    "sig": [int(f[pre + "sig_l"]), int(f[pre + "sig_a"])],
                    "head": [int(f[pre + "head_l"]), int(f[pre + "head_a"])],
                    "body": [int(f[pre + "body_l"]), int(f[pre + "body_a"])],
                    "leg": [int(f[pre + "leg_l"]), int(f[pre + "leg_a"])],
                    "dist": [int(f[pre + "dist_l"]), int(f[pre + "dist_a"])],
                    "clinch": [int(f[pre + "clinch_l"]), int(f[pre + "clinch_a"])],
                    "ground": [int(f[pre + "ground_l"]), int(f[pre + "ground_a"])],
                    "total": [int(f[pre + "tot_l"]), int(f[pre + "tot_a"])],
                    "kd": int(f[pre + "kd"]), "td": [int(f[pre + "td_l"]), int(f[pre + "td_a"])],
                    "ctrl_s": None if pd.isna(f[pre + "ctrl"]) else int(f[pre + "ctrl"]),
                    "sub_att": int(f[pre + "sub"]), "rev": int(f[pre + "rev"]),
                }
        out.append(row)
    return out


def record(fx: pd.DataFrame) -> dict:
    rec = {"w": 0, "l": 0, "d": 0, "nc": 0}
    for res, key in (("W", "w"), ("L", "l"), ("D", "d"), ("NC", "nc")):
        rec[key] = int((fx["result"] == res).sum())
    for res, key in (("W", "w"), ("L", "l")):
        sel = fx[fx["result"] == res]
        rec[f"ko_{key}"] = int((sel["method"] == "KO/TKO").sum())
        rec[f"sub_{key}"] = int((sel["method"] == "SUB").sum())
        rec[f"dec_{key}"] = int(sel["method"].str.endswith("DEC").sum())
        rec[f"other_{key}"] = int(len(sel)) - rec[f"ko_{key}"] - rec[f"sub_{key}"] - rec[f"dec_{key}"]
    return rec


def profile(db: DB, name: str, asof: pd.Timestamp | None = None, half_life: float = HALF_LIFE_DAYS,
            prior_divisions: list[str] | None = None) -> dict:
    name = db.find(name)
    asof = pd.Timestamp(asof) if asof is not None else db.snapshot
    fx = db.ff[(db.ff["fighter"] == name) & (db.ff["date"] <= asof)].copy()
    if fx.empty:
        raise SystemExit(f"No UFC fights for {name} on or before {asof.date()}")
    days = (asof - fx["date"]).dt.days.astype(float)
    fx["w"] = 0.5 ** (days / half_life)
    one = pd.Series(1.0, index=fx.index)
    bio = db.bio(name)
    if bio.get("dob"):
        dob = pd.Timestamp(bio["dob"])
        bio["age_asof"] = round((asof - dob).days / 365.2425, 2)
        bio["age_years"] = int(asof.year - dob.year - ((asof.month, asof.day) < (dob.month, dob.day)))
    # windows
    win = {
        "career": fx.index,
        "last3y": fx.index[fx["date"] > asof - pd.DateOffset(years=3)],
        "last4y": fx.index[fx["date"] > asof - pd.DateOffset(years=4)],
    }
    sums_tbl = {k: sums(fx.loc[idx]) for k, idx in win.items()}
    sums_tbl["decayed"] = sums(fx, fx["w"])
    # sums at the half-lives tools/fit_combine.py scans, so a matchup can use each rate's tuned decay
    sums_hl = {"None": sums_tbl["career"]}
    for h in (1460, 730, 365):
        sums_hl[str(h)] = sums(fx, 0.5 ** (days / h))
    rate_tbl = {k: rates(v) for k, v in sums_tbl.items()}
    # divisions fought (by fights) and current division = most frequent in last 3 years (ties -> latest)
    divs = fx["division"].value_counts().to_dict()
    recent = fx[fx["date"] > asof - pd.DateOffset(years=3)]
    cur = (recent if len(recent) else fx)
    counts = cur["division"].value_counts()
    top = counts[counts == counts.max()].index
    current_div = cur[cur["division"].isin(top)].iloc[-1]["division"]
    split = {}
    for dv, g in fx.groupby("division"):
        rr = rates(sums(g))
        rr["record"] = record(g)
        rr["dates"] = [g["date"].min().date().isoformat(), g["date"].max().date().isoformat()]
        split[dv] = rr
    # rounds with weights for pace / spec sums
    rk = fx[["fight_id", "side", "w", "sched_rounds", "end_round"]]
    rr_w = db.rounds.merge(rk, on=["fight_id", "side"])
    pace_tbl = {
        "five_round_all": pace(db, fx.assign(w=1.0), 5),
        "five_round_went_5": pace(db, fx.assign(w=1.0), 5, reached_last=True),
        "five_round_decayed": pace(db, fx, 5),
        "three_round_all": pace(db, fx.assign(w=1.0), 3),
    }
    # priors for the divisions that matter
    pdivs = prior_divisions or sorted({current_div} | {d for d in divs if d in DIV_LBS and DIV_LBS[d]},
                                      key=lambda d: -divs.get(d, 0))
    priors = {dv: division_priors(db, dv, asof) for dv in pdivs if dv in DIV_LBS}
    pr = priors.get(current_div) or next(iter(priors.values()), None)
    # shrunk chin / power (empirical Bayes toward the current division)
    eb_tbl = {}
    if pr:
        for k in ("career", "last4y", "decayed"):
            s = sums(fx, fx["w"]) if k == "decayed" else sums(fx.loc[win[k]])
            eb_tbl[k] = {
                "chin_kd_per100_head_abs_shrunk": _r(100 * (shrink(s["o_kd"], s["o_head_l"], pr["eb"]["chin_head"]) or float("nan")), 3),
                "power_kd_per100_head_shrunk": _r(100 * (shrink(s["kd"], s["head_l"], pr["eb"]["power_head"]) or float("nan")), 3),
                "prior_division": current_div,
            }
    adj_rows, adj_sum = opponent_adjusted(db, fx, asof=asof)
    for dv in split:
        split[dv]["opponent_adjusted"] = opponent_adjusted(db, fx[fx["division"] == dv], asof=asof)[1]
    # chin events: knockdowns absorbed plus KO/TKO losses with no knockdown recorded in that fight
    ko_nokd = fx[(fx["result"] == "L") & (fx["method"] == "KO/TKO") & (fx["o_kd"].fillna(0) == 0)]
    chin_events = {}
    for k, idx in win.items():
        sub = fx.loc[idx]
        ev = float(sub["o_kd"].fillna(0).sum()) + float(sub.index.isin(ko_nokd.index).sum())
        h = float(sub.loc[sub["has_stats"], "o_head_l"].sum())
        chin_events[k] = {"events": ev, "head_abs": h, "per100_head": _r(_div(ev, h, 100), 3)}
    chin_events["ko_losses_without_kd"] = [
        {"date": r_.date.date().isoformat(), "opponent": r_.opponent, "detail": r_.DETAILS, "round": int(r_.end_round)}
        for r_ in ko_nokd.itertuples()]
    finishes_absorbed = [
        {"date": r_.date.date().isoformat(), "opponent": r_.opponent, "method": r_.method, "detail": r_.DETAILS,
         "round": int(r_.end_round), "time": r_.TIME, "kd_absorbed": int(r_.o_kd) if pd.notna(r_.o_kd) else None}
        for r_ in fx[(fx["result"] == "L") & (fx["method"].isin(["KO/TKO", "SUB"]))].itertuples()]
    kd_log = [{"date": r_.date.date().isoformat(), "opponent": r_.opponent, "kd_for": int(r_.kd), "kd_against": int(r_.o_kd),
               "result": r_.result, "method": r_.method}
              for r_ in fx[fx["has_stats"] & ((fx["kd"] > 0) | (fx["o_kd"] > 0))].itertuples()]
    prof = {
        "meta": {
            "source": "ufcstats.com via github.com/Greco1899/scrape_ufc_stats (data/raw)",
            "snapshot": db.snapshot.date().isoformat(), "asof": asof.date().isoformat(),
            "built": datetime.now().isoformat(timespec="seconds"), "half_life_days": half_life,
            "prior_years": PRIOR_YEARS, "script": "tools/fighter_report.py",
            "notes": ["rates use fights with round stats only",
                      "o-prefixed = what opponents did to this fighter",
                      "KO/TKO includes doctor and corner stoppages",
                      "ctrl = ufcstats control time (clinch + ground)"],
        },
        "slug": slugify(name), **bio,
        "division": current_div, "divisions": {k: int(v) for k, v in divs.items()},
        "record": record(fx),
        "n_fights": int(len(fx)), "n_with_stats": int(fx["has_stats"].sum()),
        "n_5rd": int((fx["sched_rounds"] == 5).sum()), "n_title": int(fx["title"].sum()),
        "first_fight": fx["date"].min().date().isoformat(), "last_fight": fx["date"].max().date().isoformat(),
        "days_since_last": int((asof - fx["date"].max()).days),
        "kd_absorbed_career": int(fx["o_kd"].fillna(0).sum()), "ko_losses": int(record(fx)["ko_l"]),
        "pace_ratio": [_r(r_.get("slpm_vs_r1")) for r_ in pace_tbl["five_round_all"]],
        "pace_w": [_r(r_["minutes"], 1) for r_ in pace_tbl["five_round_all"]],
        "rates": rate_tbl, "sums": sums_tbl, "sums_by_half_life": sums_hl, "eb": eb_tbl, "chin_events": chin_events,
        "finishes_absorbed": finishes_absorbed, "knockdown_log": kd_log, "pace": pace_tbl, "division_split": split,
        "opponent_adjusted": {"summary": adj_sum, "fights": adj_rows},
        "spec_sums": {"C": spec_sums(fx, rr_w, None), "S": spec_sums(fx, rr_w, fx["w"])},
        "priors": priors,
        "fights": fight_log(fx),
    }
    return prof


# ----------------------------------------------------------------------------------------------
# Matchup: common opponents, links, head-to-head projection
# ----------------------------------------------------------------------------------------------

def _o(p):
    return p / (1 - p)


def log5(p, q, lg):
    """Odds-ratio combination: attacker's rate p, defender's allowed rate q, league rate lg."""
    if None in (p, q, lg):
        return None
    o = _o(p) * _o(q) / _o(lg)
    return o / (1 + o)


def loglin(r_att, r_def, prior):
    if None in (r_att, r_def, prior) or prior == 0:
        return None
    return prior * (r_att / prior) * (r_def / prior)


CF_DEFAULT = {"sig_att_pm": 60, "sig_lnd_pm": 80, "sig_acc": 800, "td_att_pm": 30, "td_acc": 50, "kd_per_head": 500}


def load_combine_fit(path: Path = OUT / "combine_fit.json") -> dict:
    """Shrinkage k and exponents from tools/fit_combine.py; neutral defaults if it hasn't been run."""
    cf = {k: {"shrink_k": v, "half_life_days": None, "a": 1.0, "b": 1.0, "c": 0.0} for k, v in CF_DEFAULT.items()}
    try:
        fits = json.loads(Path(path).read_text())["fits"]
        for k in cf:
            if k in fits:
                cf[k].update({kk: fits[k][kk] for kk in ("shrink_k", "half_life_days", "a", "b", "c") if kk in fits[k]})
    except (OSError, ValueError, KeyError):
        pass
    return cf


def _shr(num, den, k, prior):
    return (float(num) + k * prior) / (float(den) + k)


def comb_rate(x, y, L, f, pure=True):
    if pure or f is None:
        return L * (x / L) * (y / L)
    return L * math.exp(f["c"]) * (x / L) ** f["a"] * (y / L) ** f["b"]


def comb_prob(x, y, L, f, pure=True):
    lg = lambda p: math.log(p / (1 - p))
    if pure or f is None:
        e = lg(x) + lg(y) - lg(L)
    else:
        e = lg(L) + f["c"] + f["a"] * (lg(x) - lg(L)) + f["b"] * (lg(y) - lg(L))
    return 1 / (1 + math.exp(-e))


def matchup(db: DB, pa: dict, pb: dict, division: str | None = None, window: str = "tuned",
            rounds: int = 5) -> dict:
    a, b = pa["name"], pb["name"]
    asof = pd.Timestamp(pa["meta"]["asof"])
    if division is None:
        division = max([pa["division"], pb["division"]], key=lambda d: DIV_LBS.get(d) or 0)
    pr = division_priors(db, division, asof)
    fa = db.ff[(db.ff["fighter"] == a) & (db.ff["date"] <= asof)]
    fb = db.ff[(db.ff["fighter"] == b) & (db.ff["date"] <= asof)]
    common = sorted(set(fa["opponent"]) & set(fb["opponent"]))
    co = []
    for x in common:
        entry = {"opponent": x, a: [], b: []}
        for nm, fx in ((a, fa), (b, fb)):
            g = fx[fx["opponent"] == x]
            for _, f in g.iterrows():
                e = {"date": f["date"].date().isoformat(), "event": f["EVENT"], "result": f["result"],
                     "method": f["method"], "round": int(f["end_round"]), "time": f["TIME"],
                     "minutes": _r(f["minutes"], 2)}
                if f["has_stats"]:
                    e.update(sig=[int(f["sig_l"]), int(f["sig_a"])], opp_sig=[int(f["o_sig_l"]), int(f["o_sig_a"])],
                             kd=int(f["kd"]), okd=int(f["o_kd"]), td=[int(f["td_l"]), int(f["td_a"])],
                             otd=[int(f["o_td_l"]), int(f["o_td_a"])], ctrl_s=_r(f["ctrl"], 0),
                             octrl_s=_r(f["o_ctrl"], 0), slpm=_r(_div(f["sig_l"], f["minutes"]), 2),
                             sapm=_r(_div(f["o_sig_l"], f["minutes"]), 2),
                             acc=_r(_div(f["sig_l"], f["sig_a"])), opp_acc=_r(_div(f["o_sig_l"], f["o_sig_a"])),
                             head=[int(f["head_l"]), int(f["head_a"])], o_head=[int(f["o_head_l"]), int(f["o_head_a"])])
                entry[nm].append(e)
            entry[nm + "_rates"] = rates(sums(g))
        co.append(entry)
    # two-step links: a fought X, X fought Y, Y fought b (X != b, Y != a), last 8 years
    lo = asof - pd.DateOffset(years=8)
    allff = db.ff[(db.ff["date"] > lo) & (db.ff["date"] <= asof)]
    opp_a = set(fa[fa["date"] > lo]["opponent"]) - {b}
    opp_b = set(fb[fb["date"] > lo]["opponent"]) - {a}
    links = []
    xy = allff[allff["fighter"].isin(opp_a) & allff["opponent"].isin(opp_b)]
    for _, f in xy.iterrows():
        ra = fa[fa["opponent"] == f["fighter"]]
        rb = fb[fb["opponent"] == f["opponent"]]
        links.append({
            "x": f["fighter"], "y": f["opponent"],
            "a_vs_x": "; ".join(f"{r.result} {r.method} R{r.end_round} ({r.date.year})" for r in ra.itertuples()),
            "x_vs_y": f"{f['result']} {f['method']} R{int(f['end_round'])} ({f['date'].year})",
            "y_vs_b": "; ".join(f"{('L' if r.result == 'W' else 'W' if r.result == 'L' else r.result)} "
                                 f"{r.method} R{r.end_round} ({r.date.year})" for r in rb.itertuples()),
        })
    # head-to-head projection: shrink each man's window sums toward the projection division, then combine
    cf = load_combine_fit()

    def side(px, py):
        out = {}
        f = lambda key: cf[key]

        def S(prof, key):
            # each rate uses the half-life its walk-forward fit preferred, unless a fixed window was asked for
            if window != "tuned":
                return prof["sums"][window]
            return prof["sums_by_half_life"][str(cf[key].get("half_life_days"))]
        x, y = S(px, "sig_att_pm"), S(py, "sig_att_pm")
        kpm, kacc = f("sig_att_pm")["shrink_k"], f("sig_acc")["shrink_k"]
        klnd = f("sig_lnd_pm")["shrink_k"]
        x_att, y_att = _shr(x["sig_a"], x["minutes"], kpm, pr["sig_att_pm"]), _shr(y["o_sig_a"], y["minutes"], kpm, pr["sig_att_pm"])
        xa_, ya_ = S(px, "sig_acc"), S(py, "sig_acc")
        x_acc, y_acc = _shr(xa_["sig_l"], xa_["sig_a"], kacc, pr["sig_acc"]), _shr(ya_["o_sig_l"], ya_["o_sig_a"], kacc, pr["sig_acc"])
        xl_, yl_ = S(px, "sig_lnd_pm"), S(py, "sig_lnd_pm")
        x_lnd, y_lnd = _shr(xl_["sig_l"], xl_["minutes"], klnd, pr["slpm"]), _shr(yl_["o_sig_l"], yl_["minutes"], klnd, pr["slpm"])
        out["x_att_shrunk"], out["y_att_allowed_shrunk"] = x_att, y_att
        out["x_acc_shrunk"], out["y_acc_allowed_shrunk"] = x_acc, y_acc
        out["sig_att_pm"] = comb_rate(x_att, y_att, pr["sig_att_pm"], f("sig_att_pm"), pure=True)
        out["sig_att_pm_fit"] = comb_rate(x_att, y_att, pr["sig_att_pm"], f("sig_att_pm"), pure=False)
        out["sig_acc"] = comb_prob(x_acc, y_acc, pr["sig_acc"], f("sig_acc"), pure=True)
        out["sig_acc_fit"] = comb_prob(x_acc, y_acc, pr["sig_acc"], f("sig_acc"), pure=False)
        out["slpm_att_x_acc"] = out["sig_att_pm"] * out["sig_acc"]
        out["slpm_loglin"] = comb_rate(x_lnd, y_lnd, pr["slpm"], f("sig_lnd_pm"), pure=True)
        out["slpm_fit"] = comb_rate(x_lnd, y_lnd, pr["slpm"], f("sig_lnd_pm"), pure=False)
        xc, yc = px["sums"]["career"], py["sums"]["career"]
        out["slpm_v2_avg"] = 0.5 * (_div(xc["sig_l"], xc["minutes"]) + _div(yc["o_sig_l"], yc["minutes"]))
        for t in ("head", "body", "leg"):
            xa = _shr(xa_[f"{t}_l"], xa_[f"{t}_a"], kacc, pr[f"{t}_acc"])
            ya = _shr(ya_[f"o_{t}_l"], ya_[f"o_{t}_a"], kacc, pr[f"{t}_acc"])
            out[f"{t}_acc"] = comb_prob(xa, ya, pr[f"{t}_acc"], f("sig_acc"), pure=True)
            out[f"{t}_share_a"] = _div(x[f"{t}_a"], x["sig_a"])
        # knockdowns per landed head strike: power x chin, both shrunk toward the division
        p0 = pr["power_kd_per100_head"] / 100
        kkd = f("kd_per_head")["shrink_k"]
        xk, yk = S(px, "kd_per_head"), S(py, "kd_per_head")
        pw = _shr(xk["kd"], xk["head_l"], kkd, p0)
        ch = _shr(yk["o_kd"], yk["o_head_l"], kkd, p0)
        out["power_shrunk_per100"], out["chin_shrunk_per100"] = 100 * pw, 100 * ch
        out["kd_per100_head"] = 100 * comb_rate(pw, ch, p0, f("kd_per_head"), pure=True)
        ebk_p, ebk_c = pr["eb"]["power_head"].get("k"), pr["eb"]["chin_head"].get("k")
        if ebk_p and ebk_c:
            out["kd_per100_head_ebk"] = 100 * comb_rate(_shr(xk["kd"], xk["head_l"], ebk_p, p0),
                                                        _shr(yk["o_kd"], yk["o_head_l"], ebk_c, p0), p0, None, pure=True)
        out["head_lpm"] = out["sig_att_pm"] * out["head_share_a"] * out["head_acc"]
        out["kd_per_25min_naive"] = out["head_lpm"] * out["kd_per100_head"] / 100 * rounds * 5
        ktd, ktda = f("td_att_pm")["shrink_k"], f("td_acc")["shrink_k"]
        xt, yt = S(px, "td_att_pm"), S(py, "td_att_pm")
        x_td, y_td = _shr(xt["td_a"], xt["minutes"], ktd, pr["td_att15"] / 15), _shr(yt["o_td_a"], yt["minutes"], ktd, pr["td_att15"] / 15)
        xq, yq = S(px, "td_acc"), S(py, "td_acc")
        x_tda, y_tda = _shr(xq["td_l"], xq["td_a"], ktda, pr["td_acc"]), _shr(yq["o_td_l"], yq["o_td_a"], ktda, pr["td_acc"])
        out["td_att15"] = 15 * comb_rate(x_td, y_td, pr["td_att15"] / 15, f("td_att_pm"), pure=False)
        out["td_att15_pure"] = 15 * comb_rate(x_td, y_td, pr["td_att15"] / 15, f("td_att_pm"), pure=True)
        out["td_acc"] = comb_prob(x_tda, y_tda, pr["td_acc"], f("td_acc"), pure=False)
        out["td_acc_pure"] = comb_prob(x_tda, y_tda, pr["td_acc"], f("td_acc"), pure=True)
        out["td_l15"] = out["td_att15"] * out["td_acc"]
        out["ctrl_per_td_s"] = _div(xc["ctrl"], xc["td_l"])
        out["sub15"] = 15 * comb_rate(_shr(xc["sub"], xc["minutes"], 60, pr["sub15"] / 15),
                                      _shr(yc["o_sub"], yc["minutes"], 60, pr["sub15"] / 15), pr["sub15"] / 15, None, pure=True)
        T = rounds * 5
        out["exp_sig_landed_full"] = out["slpm_att_x_acc"] * T
        out["exp_head_landed_full"] = out["head_lpm"] * T
        out["exp_td_landed_full"] = out["td_l15"] * T / 15
        return {k: _r(v, 4) for k, v in out.items()}

    proj = {a: side(pa, pb), b: side(pb, pa)}
    return {
        "meta": {"asof": asof.date().isoformat(), "division": division, "window": window, "rounds": rounds,
                 "method": "each rate shrunk toward the projection division with the walk-forward-tuned k "
                           "(data/derived/combine_fit.json); rates: prior*(x/prior)*(y_allowed/prior); probabilities: "
                           "log5 on odds; '_fit' rows use the fitted exponents instead",
                 "combine_fit": {k: {kk: v[kk] for kk in ("shrink_k", "half_life_days", "a", "b", "c") if kk in v}
                                 for k, v in cf.items()}},
        "fighters": [a, b], "prior": {k: pr[k] for k in pr if k not in ("pace_5rd",)},
        "prior_pace_5rd": pr["pace_5rd"], "common_opponents": co, "links": links, "projection": proj,
        "raw": {a: {w: pa["rates"][w] for w in ("career", "last3y", "decayed")},
                b: {w: pb["rates"][w] for w in ("career", "last3y", "decayed")}},
    }


# ----------------------------------------------------------------------------------------------
# Markdown rendering
# ----------------------------------------------------------------------------------------------

def _f(x, nd=2, pct=False):
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return "-"
    return f"{100 * x:.{max(nd - 1, 0)}f}%" if pct else f"{x:.{nd}f}"


def _la(v):
    return f"{v[0]}/{v[1]}" if v else "-"


def _mmss_s(s):
    if s is None:
        return "-"
    s = int(round(s))
    return f"{s // 60}:{s % 60:02d}"


RATE_ROWS = [
    ("Fights with stats", "fights", 0, False), ("Minutes", "minutes", 1, False),
    ("Sig. landed / min (SLpM)", "slpm", 2, False), ("Sig. absorbed / min (SApM)", "sapm", 2, False),
    ("Sig. attempted / min", "sig_att_pm", 2, False), ("Opp. sig. attempted / min", "opp_sig_att_pm", 2, False),
    ("Sig. accuracy", "sig_acc", 3, True), ("Opp. sig. accuracy vs him (1 - defense)", "opp_sig_acc", 3, True),
    ("Strike differential / min", "diff_pm", 2, False),
    ("Head accuracy", "head_acc", 3, True), ("Opp. head accuracy vs him", "opp_head_acc", 3, True),
    ("Distance accuracy", "dist_acc", 3, True), ("Opp. distance accuracy vs him", "opp_dist_acc", 3, True),
    ("Head share of sig. attempts", "head_share_a", 3, True), ("Body share of sig. attempts", "body_share_a", 3, True),
    ("Leg share of sig. attempts", "leg_share_a", 3, True),
    ("Distance share of sig. landed", "dist_share_l", 3, True), ("Clinch share of sig. landed", "clinch_share_l", 3, True),
    ("Ground share of sig. landed", "ground_share_l", 3, True),
    ("Leg kicks absorbed / min", "opp_leg_lpm", 2, False),
    ("Knockdowns / 15", "kd15", 2, False), ("Knockdowns absorbed / 15", "okd15", 2, False),
    ("KD per 100 sig. head landed (power)", "power_kd_per100_head", 2, False),
    ("KD absorbed per 100 sig. head absorbed (chin)", "chin_kd_per100_head_abs", 2, False),
    ("Takedowns attempted / 15", "td_att15", 2, False), ("Takedowns landed / 15", "td_l15", 2, False),
    ("Takedown accuracy", "td_acc", 3, True), ("Opp. takedowns attempted / 15", "otd_att15", 2, False),
    ("Takedown defense", "td_def", 3, True), ("Control seconds / 15", "ctrl15_s", 0, False),
    ("Controlled seconds / 15", "octrl15_s", 0, False), ("Sub. attempts / 15", "sub15", 2, False),
    ("Opp. sub. attempts / 15", "osub15", 2, False),
]


def render_profile_md(p: dict) -> str:
    L = []
    rec = p["record"]
    L.append(f"# {p['name']}: UFC fight log and profile")
    L.append("")
    L.append(f"Generated by `tools/fighter_report.py` from the ufcstats snapshot (through {p['meta']['snapshot']}); "
             f"as-of date {p['meta']['asof']}; time decay half-life {p['meta']['half_life_days']} days.")
    L.append("")
    bits = [f"Nickname: {p.get('nick') or '-'}", f"DOB: {p.get('dob') or 'unknown'}"]
    if p.get("age_asof"):
        bits.append(f"age {p['age_years']} ({p['age_asof']:.2f} years) at as-of date")
    bits += [f"height {p.get('height_in') or '-'} in", f"reach {p.get('reach_in') or '-'} in",
             f"stance {p.get('stance') or '-'}", f"current division (most fights, last 3 years): {p['division']}"]
    L.append("- " + "; ".join(bits))
    L.append(f"- UFC record {rec['w']}-{rec['l']}-{rec['d']} ({rec['nc']} NC). Wins: {rec['ko_w']} KO/TKO, "
             f"{rec['sub_w']} sub, {rec['dec_w']} dec, {rec['other_w']} other. Losses: {rec['ko_l']} KO/TKO, "
             f"{rec['sub_l']} sub, {rec['dec_l']} dec, {rec['other_l']} other.")
    L.append(f"- {p['n_fights']} UFC fights ({p['n_with_stats']} with round stats), {p['n_5rd']} scheduled for five "
             f"rounds, {p['n_title']} title fights; first {p['first_fight']}, last {p['last_fight']} "
             f"({p['days_since_last']} days before as-of). Divisions: "
             + ", ".join(f"{k} {v}" for k, v in p["divisions"].items()))
    if p.get("ambiguous_name"):
        L.append("- WARNING: more than one ufcstats fighter has this name; bouts are matched by name only.")
    L.append("")
    L.append("## Fight log")
    L.append("")
    L.append("| # | Date | Event | Opponent | Class | Res | Method | Detail | Rd | Time | Sched |")
    L.append("|---|---|---|---|---|---|---|---|---|---|---|")
    for i, f in enumerate(p["fights"], 1):
        cls = f["division"] + (" (title)" if f["title"] else "")
        det = (f["detail"] or "").replace("|", "/")
        if f["method"].endswith("DEC"):
            det = _cards(det)
        L.append(f"| {i} | {f['date']} | {f['event']} | {f['opponent']} | {cls} | {f['result']} | {f['method']} | "
                 f"{det} | {f['round']} | {f['time']} | {f['sched_rounds']} |")
    L.append("")
    L.append("## Per-fight totals (landed/attempted; for = this fighter, ag = opponent)")
    L.append("")
    L.append("| # | Opponent | Min | Sig for | Sig ag | Head for | Head ag | Body for | Body ag | Leg for | Leg ag | "
             "Dist for | Dist ag | Clinch for | Clinch ag | Ground for | Ground ag | KD for-ag | TD for | TD ag | "
             "Ctrl for | Ctrl ag | Sub for-ag |")
    L.append("|" + "---|" * 23)
    for i, f in enumerate(p["fights"], 1):
        if not f["has_stats"]:
            L.append(f"| {i} | {f['opponent']} | {f['minutes']} | no round stats |" + " |" * 19)
            continue
        a, o = f["for"], f["against"]
        L.append(f"| {i} | {f['opponent']} | {f['minutes']:.2f} | {_la(a['sig'])} | {_la(o['sig'])} | {_la(a['head'])} | "
                 f"{_la(o['head'])} | {_la(a['body'])} | {_la(o['body'])} | {_la(a['leg'])} | {_la(o['leg'])} | "
                 f"{_la(a['dist'])} | {_la(o['dist'])} | {_la(a['clinch'])} | {_la(o['clinch'])} | {_la(a['ground'])} | "
                 f"{_la(o['ground'])} | {a['kd']}-{o['kd']} | {_la(a['td'])} | {_la(o['td'])} | {_mmss_s(a['ctrl_s'])} | "
                 f"{_mmss_s(o['ctrl_s'])} | {a['sub_att']}-{o['sub_att']} |")
    L.append("")
    L.append("## Rates: career, last 3 years, time-decayed, and the division prior")
    L.append("")
    pr = p["priors"].get(p["division"])
    cols = ["career", "last3y", "last4y", "decayed"]
    L.append("| Rate | Career | Last 3y | Last 4y | Decayed (HL 2y) | " + (f"{p['division']} league ({pr['window'][0][:4]}-{pr['window'][1][:4]}) |" if pr else "|"))
    L.append("|---|---|---|---|---|---|")
    for lab, key, nd, pct in RATE_ROWS:
        vals = [_f(p["rates"][c].get(key), nd, pct) for c in cols]
        lg = _f(pr.get(key), nd, pct) if pr and key not in ("fights", "minutes") else "-"
        L.append(f"| {lab} | " + " | ".join(vals) + f" | {lg} |")
    L.append("")
    L.append("League column pools every fighter-minute in the division over the window (each bout counted from both "
             "sides), so league SLpM equals league SApM.")
    L.append("")
    L.append("## Chin and power")
    L.append("")
    L.append("| Window | KD absorbed | Sig. head absorbed | KD per 100 head absorbed | Shrunk (EB) | KD scored | "
             "Sig. head landed | KD per 100 head landed | Shrunk (EB) |")
    L.append("|---|---|---|---|---|---|---|---|---|")
    for c in ("career", "last4y", "last3y", "decayed"):
        r = p["rates"][c]
        eb = p["eb"].get(c, {})
        L.append(f"| {c} | {r['okd']:.2f} | {r['o_head_l']:.1f} | {_f(r['chin_kd_per100_head_abs'])} | "
                 f"{_f(eb.get('chin_kd_per100_head_abs_shrunk'))} | {r['kd']:.2f} | {r['head_l']:.1f} | "
                 f"{_f(r['power_kd_per100_head'])} | {_f(eb.get('power_kd_per100_head_shrunk'))} |")
    ce = p["chin_events"]
    L.append("")
    L.append("Chin events (knockdowns absorbed plus KO/TKO losses with no knockdown recorded) per 100 sig. head strikes absorbed: "
             + "; ".join(f"{k} {ce[k]['events']:.0f} in {ce[k]['head_abs']:.0f} = {_f(ce[k]['per100_head'])}"
                         for k in ("career", "last4y", "last3y")) + ".")
    if ce["ko_losses_without_kd"]:
        L.append("KO/TKO losses with no knockdown recorded: " + "; ".join(
            f"{x['date']} {x['opponent']} (R{x['round']}, {x['detail']})" for x in ce["ko_losses_without_kd"]) + ".")
    L.append("")
    if p["knockdown_log"]:
        L.append("Fights with knockdowns: " + "; ".join(
            f"{x['date']} {x['opponent']} {x['kd_for']}-{x['kd_against']} ({x['result']} {x['method']})" for x in p["knockdown_log"]) + ".")
        L.append("")
    if p["finishes_absorbed"]:
        L.append("Finish losses: " + "; ".join(
            f"{x['date']} {x['opponent']} {x['method']} R{x['round']} {x['time']} ({x['detail']}; KD absorbed {x['kd_absorbed']})"
            for x in p["finishes_absorbed"]) + ".")
        L.append("")
    if pr:
        ebc, ebp = pr["eb"]["chin_head"], pr["eb"]["power_head"]
        L.append(f"Division baseline ({p['division']}, {pr['window'][0]} to {pr['window'][1]}): "
                 f"{_f(pr['power_kd_per100_head'])} KD per 100 sig. head strikes landed. Shrinkage: beta-binomial prior "
                 f"strength k fit by maximum likelihood over {ebc.get('fighters')} fighters in the same sex group and window "
                 f"(at least {ebc.get('min_exposure')} head strikes, each against his division's rate): chin k = {ebc.get('k')} "
                 f"head strikes absorbed (95% {ebc.get('k_95')}; between-fighter sd {_f(100 * ebc['tau'] if ebc.get('tau') is not None else None)} "
                 f"per 100; {p['division']}-only fit {ebc.get('k_division_only')}); power k = {ebp.get('k')} head strikes landed "
                 f"(95% {ebp.get('k_95')}; sd {_f(100 * ebp['tau'] if ebp.get('tau') is not None else None)} per 100; "
                 f"division-only {ebp.get('k_division_only')}). Decayed counts are weighted.")
    L.append("")
    L.append("## Pace curve: output by round in scheduled five-round fights")
    L.append("")
    for key, title in (("five_round_all", "All five-round fights (rounds weighted by minutes fought)"),
                       ("five_round_went_5", "Only fights that reached round 5 (same fights in every row)"),
                       ("three_round_all", "Three-round fights, for comparison")):
        rows = p["pace"][key]
        if not rows:
            continue
        L.append(f"**{title}**")
        L.append("")
        L.append("| Round | Fights | Minutes | Sig. landed/min | vs R1 | Sig. att/min | Acc. | Absorbed/min | Opp. acc. | Head l/min | Leg l/min | TD att/min |")
        L.append("|---|---|---|---|---|---|---|---|---|---|---|---|")
        for r in rows:
            L.append(f"| {r['round']} | {r['fights']} | {r['minutes']:.1f} | {_f(r['slpm'])} | {_f(r.get('slpm_vs_r1'))} | "
                     f"{_f(r['sig_att_pm'])} | {_f(r['sig_acc'], 3, True)} | {_f(r['sapm'])} | {_f(r['opp_sig_acc'], 3, True)} | "
                     f"{_f(r['head_lpm'])} | {_f(r['leg_lpm'])} | {_f(r['td_att_pm'], 3)} |")
        L.append("")
    if pr and pr.get("pace_5rd"):
        L.append(f"**{p['division']} league, five-round fights ({pr['window'][0][:4]}-{pr['window'][1][:4]})**: landed/min vs R1 by round: "
                 + ", ".join(f"R{r['round']} {_f(r.get('slpm_vs_r1'))}" for r in pr["pace_5rd"]))
        L.append("")
    L.append("## By division")
    L.append("")
    L.append("| Division | Fights | Record | Dates | Min | SLpM | SApM | Acc. | Opp. acc. | KD/15 | KD abs/15 | Chin /100 | TD att/15 | TD acc. | TD def. | Ctrl s/15 | Ctrled s/15 |")
    L.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for dv, r in p["division_split"].items():
        rc = r["record"]
        L.append(f"| {dv} | {r['fights']} | {rc['w']}-{rc['l']}-{rc['d']} | {r['dates'][0]} to {r['dates'][1]} | {r['minutes']:.1f} | "
                 f"{_f(r['slpm'])} | {_f(r['sapm'])} | {_f(r['sig_acc'], 3, True)} | {_f(r['opp_sig_acc'], 3, True)} | "
                 f"{_f(r['kd15'])} | {_f(r['okd15'])} | {_f(r['chin_kd_per100_head_abs'])} | {_f(r['td_att15'])} | "
                 f"{_f(r['td_acc'], 3, True)} | {_f(r['td_def'], 3, True)} | {_f(r['ctrl15_s'], 0)} | {_f(r['octrl15_s'], 0)} |")
    L.append("")
    L.append("## Opponent-adjusted (leave-one-out vs each opponent's other UFC fights)")
    L.append("")
    s = p["opponent_adjusted"]["summary"]
    L.append(f"Career indices: landed {_f(s['landed_idx'])}x what opponents usually absorb; absorbed {_f(s['absorbed_idx'])}x "
             f"what opponents usually land; accuracy {_f(s['acc_idx'])}x opponents' usual accuracy allowed; opponents' "
             f"accuracy {_f(s['opp_acc_idx'])}x their usual. Above 1 is better for landed/accuracy, below 1 is better for "
             f"absorbed/opponents' accuracy.")
    L.append("")
    L.append("| Date | Opponent | Opp. other min | Landed | Expected | Idx | Absorbed | Expected | Idx | Acc. | Opp. usually allows | Opp. acc. | Opp. usual acc. |")
    L.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for r in p["opponent_adjusted"]["fights"]:
        L.append(f"| {r['date']} | {r['opponent']} | {r['opp_other_min']} | {r['landed']} | {r['exp_landed']} | {_f(r['landed_idx'])} | "
                 f"{r['absorbed']} | {r['exp_absorbed']} | {_f(r['absorbed_idx'])} | {_f(r['acc'], 3, True)} | "
                 f"{_f(r['opp_usual_acc_allowed'], 3, True)} | {_f(r['opp_acc'], 3, True)} | {_f(r['opp_usual_acc'], 3, True)} |")
    L.append("")
    return "\n".join(L)


def _cards(det: str) -> str:
    """'Judge A 27 - 30.Judge B 28 - 29.' -> '27-30, 28-29' (scores only)."""
    sc = re.findall(r"(\d+)\s*-\s*(\d+)", det)
    return ", ".join(f"{x}-{y}" for x, y in sc) if sc else det


def render_matchup_md(m: dict, pa: dict, pb: dict) -> str:
    a, b = m["fighters"]
    L = [f"# {a} vs {b}: data matchup", ""]
    L.append(f"As-of {m['meta']['asof']}; projection division {m['meta']['division']}; rate window "
             f"'{m['meta']['window']}'; {m['meta']['rounds']} rounds.")
    L.append("")
    L.append("## Common opponents")
    L.append("")
    if not m["common_opponents"]:
        L.append("None in the UFC data.")
    for c in m["common_opponents"]:
        L.append(f"### {c['opponent']}")
        L.append("")
        L.append("| Fighter | Date | Result | Method | Rd | Time | Sig for | Sig ag | SLpM | SApM | Acc. | Opp. acc. | Head for | Head ag | KD for-ag | TD for | TD ag | Ctrl for | Ctrl ag |")
        L.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
        for nm in (a, b):
            for e in c[nm]:
                if "sig" in e:
                    L.append(f"| {nm} | {e['date']} | {e['result']} | {e['method']} | {e['round']} | {e['time']} | {_la(e['sig'])} | "
                             f"{_la(e['opp_sig'])} | {_f(e['slpm'])} | {_f(e['sapm'])} | {_f(e['acc'], 3, True)} | {_f(e['opp_acc'], 3, True)} | "
                             f"{_la(e['head'])} | {_la(e['o_head'])} | {e['kd']}-{e['okd']} | {_la(e['td'])} | {_la(e['otd'])} | "
                             f"{_mmss_s(e['ctrl_s'])} | {_mmss_s(e['octrl_s'])} |")
                else:
                    L.append(f"| {nm} | {e['date']} | {e['result']} | {e['method']} | {e['round']} | {e['time']} |" + " - |" * 13)
        ra, rb = c[a + "_rates"], c[b + "_rates"]
        L.append("")
        L.append(f"Pooled vs {c['opponent']}: {a} {ra['minutes']:.1f} min, SLpM {_f(ra['slpm'])}, SApM {_f(ra['sapm'])}, "
                 f"KD {ra['kd']:.0f}-{ra['okd']:.0f}; {b} {rb['minutes']:.1f} min, SLpM {_f(rb['slpm'])}, SApM {_f(rb['sapm'])}, "
                 f"KD {rb['kd']:.0f}-{rb['okd']:.0f}.")
        L.append("")
    L.append("## Two-step links (last 8 years)")
    L.append("")
    L.append(f"{a} fought X, X fought Y, Y fought {b}. Results are from the first-named fighter's side in each column.")
    L.append("")
    if m["links"]:
        L.append(f"| X | {a} vs X | X vs Y | Y | Y vs {b} |")
        L.append("|---|---|---|---|---|")
        for l in m["links"]:
            L.append(f"| {l['x']} | {l['a_vs_x']} | {l['x_vs_y']} | {l['y']} | {l['y_vs_b']} |")
    else:
        L.append("None.")
    L.append("")
    L.append("## Raw rates side by side")
    L.append("")
    L.append(f"| Rate | {a} career | {a} last 3y | {a} decayed | {b} career | {b} last 3y | {b} decayed | {m['meta']['division']} league |")
    L.append("|---|---|---|---|---|---|---|---|")
    pr = m["prior"]
    for lab, key, nd, pct in RATE_ROWS:
        va = [_f(m["raw"][a][w].get(key), nd, pct) for w in ("career", "last3y", "decayed")]
        vb = [_f(m["raw"][b][w].get(key), nd, pct) for w in ("career", "last3y", "decayed")]
        lg = _f(pr.get(key), nd, pct) if key not in ("fights", "minutes") else "-"
        L.append(f"| {lab} | " + " | ".join(va + vb) + f" | {lg} |")
    L.append("")
    L.append("## Head-to-head projection (what an engine would combine)")
    L.append("")
    cfm = m["meta"]["combine_fit"]
    L.append("Each fighter's rate is first shrunk toward the projection division with the pseudo-exposure k that "
             "tools/fit_combine.py tuned walk-forward, using the time-decay half-life that won for that rate (" + ", ".join(
                 f"{k} k={v['shrink_k']}, half-life {v.get('half_life_days') or 'none'}" for k, v in cfm.items())
             + "). Per-minute rates then combine log-linearly: league x (attacker / league) x (defender allows / league); "
             "accuracies combine by log5 on odds against the division. 'Fitted' rows use the regression exponents "
             "(" + ", ".join(f"{k} a={v['a']}, b={v['b']}" for k, v in cfm.items()) + "). Out of sample (2024 onward) the "
             "pure rule beat the fitted exponents for strikes, accuracy and knockdowns, and the fitted rule won for takedowns, "
             "so those are the recommended rows. Expected totals ignore finishes, damage and fatigue.")
    L.append("")
    rows = [("Attacker sig. attempts / min, shrunk", "x_att_shrunk", 2, False),
            ("Defender sig. attempts allowed / min, shrunk", "y_att_allowed_shrunk", 2, False),
            ("Sig. attempted / min (log-linear)", "sig_att_pm", 2, False),
            ("Sig. attempted / min (fitted exponents)", "sig_att_pm_fit", 2, False),
            ("Attacker accuracy, shrunk", "x_acc_shrunk", 3, True), ("Defender accuracy allowed, shrunk", "y_acc_allowed_shrunk", 3, True),
            ("Sig. accuracy (log5)", "sig_acc", 3, True), ("Sig. accuracy (fitted)", "sig_acc_fit", 3, True),
            ("Sig. landed / min = att x acc", "slpm_att_x_acc", 2, False),
            ("Sig. landed / min (log-linear on landed)", "slpm_loglin", 2, False),
            ("Sig. landed / min (fitted)", "slpm_fit", 2, False), ("Sig. landed / min (v2 average, raw)", "slpm_v2_avg", 2, False),
            ("Head share of attempts", "head_share_a", 3, True), ("Head accuracy (log5)", "head_acc", 3, True),
            ("Body share of attempts", "body_share_a", 3, True), ("Body accuracy (log5)", "body_acc", 3, True),
            ("Leg share of attempts", "leg_share_a", 3, True), ("Leg accuracy (log5)", "leg_acc", 3, True),
            ("Head strikes landed / min", "head_lpm", 2, False),
            ("Attacker power, KD per 100 head landed (shrunk)", "power_shrunk_per100", 2, False),
            ("Defender chin, KD per 100 head absorbed (shrunk)", "chin_shrunk_per100", 2, False),
            ("KD per 100 head landed (power x chin)", "kd_per100_head", 2, False),
            ("Same, with the EB (career-dispersion) k", "kd_per100_head_ebk", 2, False),
            ("Naive KD per 25 min", "kd_per_25min_naive", 2, False),
            ("Takedown attempts / 15 (fitted)", "td_att15", 2, False), ("Takedown attempts / 15 (log-linear)", "td_att15_pure", 2, False),
            ("Takedown accuracy (fitted)", "td_acc", 3, True), ("Takedown accuracy (log5)", "td_acc_pure", 3, True),
            ("Takedowns landed / 15", "td_l15", 2, False), ("Control s per TD (own history)", "ctrl_per_td_s", 0, False),
            ("Sub. attempts / 15", "sub15", 2, False),
            ("Expected sig. landed over the full distance", "exp_sig_landed_full", 0, False),
            ("Expected head strikes landed, full distance", "exp_head_landed_full", 0, False),
            ("Expected takedowns landed, full distance", "exp_td_landed_full", 2, False)]
    L.append(f"| Projected rate | {a} on {b} | {b} on {a} |")
    L.append("|---|---|---|")
    for lab, key, nd, pct in rows:
        L.append(f"| {lab} | {_f(m['projection'][a].get(key), nd, pct)} | {_f(m['projection'][b].get(key), nd, pct)} |")
    L.append("")
    return "\n".join(L)


# ----------------------------------------------------------------------------------------------

def _json_default(o):
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return None if np.isnan(o) else float(o)
    if isinstance(o, (pd.Timestamp, date)):
        return o.isoformat()
    if o is pd.NA:
        return None
    raise TypeError(type(o))


def _clean(o):
    if isinstance(o, dict):
        return {str(k): _clean(v) for k, v in o.items()}
    if isinstance(o, list):
        return [_clean(v) for v in o]
    if isinstance(o, float):
        return None if math.isnan(o) else round(o, 6)
    if o is pd.NA:
        return None
    return o


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("fighter", help='fighter name as on ufcstats, e.g. "Alexander Volkanovski"')
    ap.add_argument("--vs", help="second fighter: adds a matchup report (common opponents, projection)")
    ap.add_argument("--division", help="division for the matchup projection (default: heavier of the two)")
    ap.add_argument("--asof", help="as-of date YYYY-MM-DD (default: latest event in the snapshot)")
    ap.add_argument("--half-life", type=float, default=HALF_LIFE_DAYS, help="decay half-life in days (default 730)")
    ap.add_argument("--window", default="tuned", choices=["tuned", "career", "last3y", "last4y", "decayed"],
                    help="rate window for the matchup projection (tuned = each rate's walk-forward half-life)")
    ap.add_argument("--raw", default=str(RAW), help="directory with the ufcstats CSVs")
    ap.add_argument("--out", default=str(OUT), help="output directory for JSON and markdown")
    ap.add_argument("--no-md", action="store_true", help="skip markdown output")
    ap.add_argument("--print", action="store_true", help="also print the markdown to stdout")
    args = ap.parse_args(argv)

    db = DB(Path(args.raw))
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    asof = pd.Timestamp(args.asof) if args.asof else None
    names = [args.fighter] + ([args.vs] if args.vs else [])
    profs = []
    for nm in names:
        p = profile(db, nm, asof, args.half_life)
        profs.append(p)
        jp = out / f"fighter_{p['slug']}.json"
        jp.write_text(json.dumps(_clean(p), indent=1, default=_json_default))
        print(f"wrote {jp}", file=sys.stderr)
        if not args.no_md:
            md = render_profile_md(p)
            mp = out / f"fighter_{p['slug']}.md"
            mp.write_text(md)
            print(f"wrote {mp}", file=sys.stderr)
            if args.print:
                print(md)
    if args.vs:
        pa, pb = profs
        div = args.division
        for p in (pa, pb):  # make sure both carry priors for the projection division
            if div and div not in p["priors"]:
                p["priors"][div] = division_priors(db, div, pd.Timestamp(p["meta"]["asof"]))
        m = matchup(db, pa, pb, div, args.window)
        stem = f"matchup_{pa['slug']}__{pb['slug']}"
        (out / f"{stem}.json").write_text(json.dumps(_clean(m), indent=1, default=_json_default))
        print(f"wrote {out / (stem + '.json')}", file=sys.stderr)
        if not args.no_md:
            md = render_matchup_md(m, pa, pb)
            (out / f"{stem}.md").write_text(md)
            print(f"wrote {out / (stem + '.md')}", file=sys.stderr)
            if args.print:
                print(md)


if __name__ == "__main__":
    main()
