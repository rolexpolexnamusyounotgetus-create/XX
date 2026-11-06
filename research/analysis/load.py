"""Shared loader for the UFC stats snapshot (read-only)."""
import re
import numpy as np
import pandas as pd

RAW = "/home/user/XX/data/raw/"

MEN = {"Flyweight": 125, "Bantamweight": 135, "Featherweight": 145, "Lightweight": 155,
       "Welterweight": 170, "Middleweight": 185, "Light Heavyweight": 205, "Heavyweight": 265}
WOMEN = {"Strawweight": 115, "Flyweight": 125, "Bantamweight": 135, "Featherweight": 145}


def strip(df):
    df.columns = [c.strip() for c in df.columns]
    for c in df.columns:
        if pd.api.types.is_object_dtype(df[c]) or pd.api.types.is_string_dtype(df[c]):
            df[c] = df[c].astype('string').str.strip().astype(object).where(df[c].notna(), None)
    return df


def division(wc):
    if not isinstance(wc, str):
        return None
    w = wc.replace("Title", "").replace("Bout", "").replace("UFC", "").replace("Interim", "").strip()
    women = "Women's" in w
    w = w.replace("Women's", "").strip()
    table = WOMEN if women else MEN
    # longest name first so "Light Heavyweight" wins over "Heavyweight"
    for name in sorted(table, key=len, reverse=True):
        if w.endswith(name) or w == name:
            if "Tournament" in wc or "Ultimate Fighter" in wc or "Road to" in wc:
                pass
            return ("W " if women else "") + name
    return None


def lbs(div):
    if not isinstance(div, str):
        return np.nan
    if div.startswith("W "):
        return WOMEN[div[2:]]
    return MEN[div]


def xofy(s):
    a = s.str.extract(r"(\d+)\s+of\s+(\d+)")
    return pd.to_numeric(a[0], errors="coerce"), pd.to_numeric(a[1], errors="coerce")


def mmss(s):
    a = s.str.extract(r"(\d+):(\d+)")
    return pd.to_numeric(a[0], errors="coerce") * 60 + pd.to_numeric(a[1], errors="coerce")


def load():
    ev = strip(pd.read_csv(RAW + "ufc_event_details.csv"))
    ev["date"] = pd.to_datetime(ev.DATE, format="%B %d, %Y", errors="coerce")
    res = strip(pd.read_csv(RAW + "ufc_fight_results.csv"))
    res = res.merge(ev[["EVENT", "date", "LOCATION"]], on="EVENT", how="left")
    ab = res.BOUT.str.split(r"\s+vs\.\s+", n=1, expand=True)
    res["A"], res["B"] = ab[0].str.strip(), ab[1].str.strip()
    oc = res.OUTCOME.str.split("/", expand=True)
    res["resA"], res["resB"] = oc[0], oc[1]
    res["div"] = res.WEIGHTCLASS.map(division)
    res["lbs"] = res["div"].map(lbs)
    res["title"] = res.WEIGHTCLASS.str.contains("Title", na=False)
    res["rnd"] = pd.to_numeric(res.ROUND, errors="coerce")
    res["tsec"] = mmss(res.TIME)
    res["sched"] = pd.to_numeric(res["TIME FORMAT"].str.extract(r"^(\d) Rnd \(5")[0], errors="coerce")
    m = res.METHOD
    res["mgroup"] = np.select(
        [m.str.startswith("Decision"), m.str.startswith("KO/TKO") | m.str.contains("Doctor"), m.str.startswith("Submission")],
        ["DEC", "KO", "SUB"], "OTHER")
    res["dur"] = (res.rnd - 1) * 300 + res.tsec
    res["fid"] = np.arange(len(res))

    st = strip(pd.read_csv(RAW + "ufc_fight_stats.csv"))
    st["r"] = pd.to_numeric(st.ROUND.str.extract(r"(\d+)")[0], errors="coerce")
    for col, short in [("SIG.STR.", "sig"), ("TOTAL STR.", "tot"), ("TD", "td"), ("HEAD", "head"), ("BODY", "body"),
                       ("LEG", "leg"), ("DISTANCE", "dist"), ("CLINCH", "clinch"), ("GROUND", "ground")]:
        l, a = xofy(st[col].astype(str))
        st[short + "_l"], st[short + "_a"] = l, a
    st["kd"] = pd.to_numeric(st.KD, errors="coerce")
    st["sub"] = pd.to_numeric(st["SUB.ATT"], errors="coerce")
    st["rev"] = pd.to_numeric(st["REV."], errors="coerce")
    st["ctrl"] = mmss(st.CTRL.astype(str))
    tott = strip(pd.read_csv(RAW + "ufc_fighter_tott.csv"))
    tott["dob"] = pd.to_datetime(tott.DOB, format="%b %d, %Y", errors="coerce")
    dup = tott.FIGHTER.duplicated(keep=False)
    dob = tott[~dup].set_index("FIGHTER").dob
    return res, st, dob


KEYS = ["kd", "sig_l", "sig_a", "tot_l", "tot_a", "td_l", "td_a", "head_l", "head_a", "body_l", "body_a", "leg_l",
        "leg_a", "dist_l", "dist_a", "clinch_l", "clinch_a", "ground_l", "ground_a", "sub", "rev", "ctrl"]


def round_pairs(res, st):
    """One row per fight-round with A_* and B_* columns (A/B in BOUT order)."""
    s = st.merge(res[["EVENT", "BOUT", "A", "B", "fid"]], on=["EVENT", "BOUT"], how="inner")
    sa = s[s.FIGHTER == s.A][["fid", "r"] + KEYS].rename(columns={k: "A_" + k for k in KEYS})
    sb = s[s.FIGHTER == s.B][["fid", "r"] + KEYS].rename(columns={k: "B_" + k for k in KEYS})
    rp = sa.merge(sb, on=["fid", "r"], how="inner")
    rp = rp.drop_duplicates(["fid", "r"])
    return rp


def judges(details):
    """Parse 'Name 28 - 29.Name 29 - 28.' into list of (loser_score, winner_score) per judge."""
    if not isinstance(details, str):
        return []
    return [(int(a), int(b)) for a, b in re.findall(r"(\d+)\s*-\s*(\d+)", details)]
