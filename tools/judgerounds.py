#!/usr/bin/env python3
"""
judgerounds.py - round-by-round judges' scores for UFC decisions, matched to ufcstats fight ids, and the
round-level training set for the v8 judging model.

WHY NOT SCRAPE MMADECISIONS.COM DIRECTLY
  mmadecisions.com/robots.txt (updated 2025-03-04) allows a list of search-engine crawlers and ends with
  "User-agent: * / Disallow: /". Our agent is not on the list, so the site is off limits to us. Instead
  this script uses two public, already-published datasets whose round scores come from MMA Decisions
  (fetched from raw.githubusercontent.com, which has no robots.txt, at <= 1 request/second):

  N  nlbair/ufc-data v0.1.1 (Noah Bair, CC BY 4.0, Zenodo doi:10.5281/zenodo.23458636), file
     data/ufc_judge_rounds.csv: one row per judge per round, 2013-02-16..2026-10-10, keyed by the ufcstats
     fight id, with published and pre-deduction ("raw") scores. Matched by the author on event date,
     names and all three card totals.
  D  martindavies-code/ufc-judging-analysis (Martin Davies, no license file; used here for private
     research only, credited): data/ufc_round_scores.csv + data/ufc_scorecards.csv, 1996..2026-10-24,
     published scores keyed by MMA Decisions decision id. This script matches each decision to a ufcstats
     fight itself (event date +-1 day and fuzzy names, checked against N's crosswalk on the overlap).
     D's 48 hand-entered stoppage-fight cards (data/stoppage_scorecards.json) have no cited source; they
     are kept apart as "stoppage_unverified" and are not in the training rows.

  Where both sources cover a fight, N is used (it carries deductions) and D cross-checks it round by round.

WHAT IT WRITES
  data/derived/judgerounds.json       {meta, judges, fights: {fight_id: {..., judges: [{name, id, rounds:
                                      [[a,b],...], total: [a,b], raw?: [[a,b],...]}], validation}},
                                      stoppage_unverified}. a/b follow the ufcstats BOUT order (A first).
  data/derived/judgerounds_rows.json  {meta, rounds: {cols, rows}, scores: {cols, rows}}: one row per scored
                                      round with both fighters' ufcstats round stats, and one row per judge
                                      per round (published and pre-deduction scores).
  Both hold fights before --vault-from (default 2026-01-01) only. Fights on or after it go to the vault
  directory outside the repo (judgerounds_vault.json, judgerounds_rows_vault.json), as in make_vault.py.
  research/data_judgerounds.md is written by hand from the printed report.

USAGE
  python3 tools/judgerounds.py --fetch      # download/refresh the cached source files (about 15 requests)
  python3 tools/judgerounds.py              # build from the cache (a few seconds, pandas + numpy only)
"""
import argparse
import datetime as dt
import difflib
import functools
import hashlib
import itertools
import json
import math
import os
import re
import sys
import time
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
CACHE = RAW / "web_cache" / "github"
DERIVED = ROOT / "data" / "derived"
VAULT_DIR = "/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vault"
UA = "FightLabSim/1.0 (private research)"

SOURCES = {
    "nlbair": ("https://raw.githubusercontent.com/nlbair/ufc-data/main/",
               ["README.md", "METHODS.md", "SOURCES.md", "LICENSE", "CITATION.cff",
                "data/ufc_judge_rounds.csv", "data/id_crosswalk_all.csv", "data/judge_names.csv",
                "data/jurisdiction_lookup.csv", "codebook/codebook_judge_rounds.csv"]),
    "davies": ("https://raw.githubusercontent.com/martindavies-code/ufc-judging-analysis/main/",
               ["README.md", "data/ufc_round_scores.csv", "data/ufc_scorecards.csv",
                "data/ufc_judge_appearances.csv", "data/stoppage_scorecards.json",
                "src/round_parser.py", "src/parser.py"]),
}

# Weights from the EM round-winner fit in research/data_baserates.md (docs/BACKLOG.md, Judging), used here
# only as a sanity check of the joined data, never refit.
EM_W = {"head": 0.179, "body": 0.133, "leg": 0.105, "kd": 2.42, "td": 0.286, "ctrl_min": 0.46, "sub": 0.85}


vault_from_g = [dt.date(2026, 1, 1)]


# ------------------------------------------------------------------ fetch
def fetch(refresh=False):
    import requests
    import urllib.robotparser
    last = 0.0
    for key, (base, files) in SOURCES.items():
        host = re.match(r"https://[^/]+", base).group(0)
        rp = urllib.robotparser.RobotFileParser(host + "/robots.txt")
        r = requests.get(host + "/robots.txt", headers={"User-Agent": UA}, timeout=30)
        time.sleep(1.1)
        if r.status_code == 200:
            rp.parse(r.text.splitlines())
        else:
            rp.allow_all = True              # 4xx robots.txt: no restrictions (RFC 9309)
        for f in files:
            out = CACHE / key / f
            if out.exists() and not refresh:
                continue
            if not rp.can_fetch(UA, base + f):
                print("robots.txt disallows", base + f)
                continue
            wait = 1.1 - (time.time() - last)
            if wait > 0:
                time.sleep(wait)
            resp = requests.get(base + f, headers={"User-Agent": UA}, timeout=120)
            last = time.time()
            print(resp.status_code, len(resp.content), base + f)
            if resp.status_code == 200:
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_bytes(resp.content)
    (CACHE / "FETCHED.json").write_text(json.dumps({
        "fetched": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "user_agent": UA,
        "files": {"%s/%s" % (k, f): sha256(CACHE / k / f) for k, (_, fs) in SOURCES.items() for f in fs
                  if (CACHE / k / f).exists()}}, indent=1))


def sha256(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()[:16]


# ------------------------------------------------------------------ names
def norm(s):
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode("ascii").lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


NICK = {"mike": "michael", "doug": "douglas", "dave": "david", "rich": "richard", "rick": "richard",
        "chris": "christopher", "tony": "anthony", "jim": "james", "bob": "robert", "sal": "salvatore",
        "jeff": "jeffrey", "ron": "ronald", "andy": "andrew", "pat": "patricia", "ben": "benjamin"}
# ring names that share no token with the ufcstats name
ALIASES = {"kimbo slice": "kevin ferguson"}


@functools.lru_cache(maxsize=None)
def name_sim(a, b):
    """0..1 similarity for person names written by different sites."""
    a, b = norm(a), norm(b)
    a, b = ALIASES.get(a, a), ALIASES.get(b, b)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    ta, tb = a.split(), b.split()
    if "".join(ta) == "".join(tb) or "".join(ta[::-1]) == "".join(tb) or sorted(ta) == sorted(tb):
        return 0.95                                   # "Heili Alateng" / "Alatengheili", reordered names
    ca = [NICK.get(t, t) for t in ta]
    cb = [NICK.get(t, t) for t in tb]
    if ca == cb:
        return 0.98
    r = difflib.SequenceMatcher(None, a.replace(" ", ""), b.replace(" ", "")).ratio()
    sa, sb = set(ca), set(cb)
    if sa <= sb or sb <= sa:
        r = max(r, 0.9)
    if ta[-1] == tb[-1] or ta[-1].replace(" ", "") == tb[-1]:
        r = max(r, 0.85 if ca[0][:1] == cb[0][:1] else 0.75)
    elif len(sa & sb) >= 1 and len(ta) > 1 and len(tb) > 1:
        r = max(r, 0.6)
    return r


def slug_names(url):
    """'https://mmadecisions.com/decision/16431/Petr-Yan-vs-Merab-Dvalishvili' -> ('Petr Yan', 'Merab Dvalishvili')."""
    last = str(url).rstrip("/").rsplit("/", 1)[-1]
    parts = re.split(r"-vs-", last, flags=re.I)
    if len(parts) != 2:
        return None
    return tuple(p.replace("-", " ").strip() for p in parts)


# ------------------------------------------------------------------ ufcstats
def load_csv(name):
    d = pd.read_csv(RAW / name, dtype=str, keep_default_na=False)
    d.columns = [c.strip() for c in d.columns]
    for c in d.columns:
        d[c] = d[c].astype(str).str.strip()
    return d


def parse_format(s):
    m = re.match(r"^(\d+)\s*Rnd", s)
    sched = int(m.group(1)) if m else 1
    p = re.search(r"\(([\d\-]+)\)", s)
    lengths = [int(x) for x in p.group(1).split("-") if x] if p else None
    return sched, lengths


def parse_mmss(s):
    m = re.match(r"^(\d+):(\d\d)$", s or "")
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None


DETAIL_CARD = re.compile(r"\s*([^\d.]*?)\s*(\d+)\s*-\s*(\d+)\s*\.")


def load_ufcstats():
    ev = load_csv("ufc_event_details.csv")
    ev_date, ev_loc = {}, {}
    for e in ev.itertuples(index=False):
        try:
            ev_date[e.EVENT] = dt.datetime.strptime(e.DATE, "%B %d, %Y").date()
            ev_loc[e.EVENT] = e.LOCATION
        except ValueError:
            pass
    res = load_csv("ufc_fight_results.csv").rename(columns={"TIME FORMAT": "FORMAT"})
    res["idx"] = np.arange(len(res))
    res["known"] = res["EVENT"].isin(set(ev_date))
    res = (res.sort_values(["known", "idx"], ascending=[False, True])
              .drop_duplicates("URL", keep="first").sort_values("idx"))
    fights = {}
    for r in res.itertuples(index=False):
        date = ev_date.get(r.EVENT)
        names = r.BOUT.split(" vs. ")
        if date is None or len(names) != 2:
            continue
        fid = r.URL.rstrip("/").rsplit("/", 1)[-1]
        sched, lengths = parse_format(r.FORMAT)
        winner = {"W/L": "A", "L/W": "B", "D/D": "D", "NC/NC": "NC"}.get(r.OUTCOME, "NC")
        wc = r.WEIGHTCLASS
        tourn = "Tournament" in wc
        cards = [(nm.strip(), int(x), int(y)) for nm, x, y in DETAIL_CARD.findall(r.DETAILS)]
        fights[fid] = dict(
            fid=fid, idx=int(r.idx), event=r.EVENT, date=date, loc=ev_loc.get(r.EVENT, ""),
            A=names[0].strip(), B=names[1].strip(), winner=winner, method=r.METHOD, wc=wc,
            title=("Title" in wc and not tourn) or "Championship" in wc, women="Women" in wc,
            rnd=int(r.ROUND) if r.ROUND.isdigit() else 1, time_s=parse_mmss(r.TIME), sched=sched,
            lengths=lengths, referee=r.REFEREE, details=r.DETAILS,
            ufc_cards=cards if r.METHOD.startswith("Decision") or r.METHOD == "Overturned" else [])
    by_date = defaultdict(list)
    for f in fights.values():
        by_date[f["date"]].append(f)
    return fights, by_date


STAT_XY = (("SIG.STR.", "sig"), ("HEAD", "head"), ("BODY", "body"), ("LEG", "leg"), ("DISTANCE", "dist"),
           ("CLINCH", "clinch"), ("GROUND", "ground"), ("TOTAL STR.", "tot"), ("TD", "td"))
STAT_N = (("KD", "kd"), ("SUB.ATT", "sub"), ("REV.", "rev"))
STAT_COLS = [p + s for _, p in STAT_XY for s in ("_l", "_a")] + [k for _, k in STAT_N] + ["ctrl"]


def load_round_stats(fights):
    st = load_csv("ufc_fight_stats.csv")
    st = st[st["ROUND"] != ""].copy()
    key = defaultdict(set)
    for f in fights.values():
        key[(f["event"], f["A"] + " vs. " + f["B"])].add(f["fid"])
    st["fid"] = [next(iter(key[k])) if len(key.get(k, ())) == 1 else None for k in zip(st["EVENT"], st["BOUT"])]
    st = st[st["fid"].notna()].copy()
    st["side"] = [0 if n == fights[f]["A"] else (1 if n == fights[f]["B"] else -1)
                  for n, f in zip(st["FIGHTER"], st["fid"])]
    st = st[st["side"] >= 0].copy()
    st["rnd"] = st["ROUND"].str.extract(r"(\d+)", expand=False).astype(int)
    for col, p in STAT_XY:
        ex = st[col].str.extract(r"^(\d+)\s*of\s*(\d+)$")
        st[p + "_l"] = pd.to_numeric(ex[0], errors="coerce")
        st[p + "_a"] = pd.to_numeric(ex[1], errors="coerce")
    for col, k in STAT_N:
        st[k] = pd.to_numeric(st[col], errors="coerce")
    ctrl = st["CTRL"].str.extract(r"^(\d+):(\d\d)$")
    st["ctrl"] = pd.to_numeric(ctrl[0], errors="coerce") * 60 + pd.to_numeric(ctrl[1], errors="coerce")
    st = st.drop_duplicates(["fid", "side", "rnd"])
    out = {}
    for row in st[["fid", "side", "rnd"] + STAT_COLS].itertuples(index=False):
        vals = [None if (v is None or (isinstance(v, float) and math.isnan(v))) else int(v) for v in row[3:]]
        out[(row[0], row[2], row[1])] = vals
    return out


# ------------------------------------------------------------------ source N (nlbair)
def load_nlbair(fights, log):
    n = pd.read_csv(CACHE / "nlbair/data/ufc_judge_rounds.csv", low_memory=False)
    cw = pd.read_csv(CACHE / "nlbair/data/id_crosswalk_all.csv", low_memory=False)
    cards = {}
    orient_check = Counter()
    for fid, g in n.groupby("fight_id", sort=False):
        f = fights.get(fid)
        if f is None:
            log["N_fight_not_in_ufcstats"].append(fid)
            continue
        p1 = bool(g["primary_is_f1"].iloc[0])
        prim = g["primary_name"].iloc[0]
        # check: the primary fighter's name should match A when primary_is_f1
        sa, sb = name_sim(prim, f["A"]), name_sim(prim, f["B"])
        orient_check["consistent" if (sa >= sb) == p1 else "inconsistent"] += 1
        judges = []
        for (pos, jid, jname), gj in g.groupby(["judge_pos", g["judge_id"].fillna(-1), "judge_name"], sort=True):
            rounds = {}
            for r in gj.itertuples(index=False):
                pp, op = int(r.primary_score_published), int(r.opponent_score_published)
                pr, orw = int(r.primary_score_raw), int(r.opponent_score_raw)
                rounds[int(r.round)] = (pp, op, pr, orw) if p1 else (op, pp, orw, pr)
            judges.append(dict(jid=int(jid) if jid != -1 else None, name=jname, pos=int(pos), rounds=rounds))
        cards[fid] = dict(src="N", mmad_id=int(g["mmad_decision_id"].iloc[0]), judges=judges, raw_known=True,
                          jurisdiction=g["jurisdiction"].iloc[0])
    log["N_orientation_check"] = dict(orient_check)
    cwm = cw.dropna(subset=["mmad_decision_id"])
    crosswalk = {int(m): fid for m, fid in zip(cwm["mmad_decision_id"], cwm["fight_id"])}
    return cards, crosswalk


# ------------------------------------------------------------------ source D (davies)
def match_fight(n1, n2, dates, by_date, totals=None):
    """Best ufcstats fight for a bout named (n1, n2) on any of `dates`; returns (fid, swapped, s1, s2, margin)."""
    cands = []
    for d in dates:
        for f in by_date.get(d, ()):
            s_ab = (name_sim(n1, f["A"]), name_sim(n2, f["B"]))
            s_ba = (name_sim(n1, f["B"]), name_sim(n2, f["A"]))
            sw = sum(s_ba) > sum(s_ab)
            s = s_ba if sw else s_ab
            score = sum(s)
            if f["method"].startswith("Decision"):
                score += 0.05
            if totals and f["ufc_cards"]:
                ut = sorted(tuple(sorted((x, y))) for _, x, y in f["ufc_cards"])
                if ut == sorted(tuple(sorted(t)) for t in totals):
                    score += 0.1
            cands.append((score, f["fid"], sw, s))
    if not cands:
        return None
    cands.sort(reverse=True)
    best = cands[0]
    margin = best[0] - (cands[1][0] if len(cands) > 1 else 0.0)
    return best[1], best[2], best[3][0], best[3][1], margin


def load_davies(fights, by_date, log):
    sc = pd.read_csv(CACHE / "davies/data/ufc_scorecards.csv", dtype={"decision_id": str})
    rs = pd.read_csv(CACHE / "davies/data/ufc_round_scores.csv", dtype={"decision_id": str})
    sc["date"] = pd.to_datetime(sc["event_date"], format="%B %d, %Y", errors="coerce").dt.date
    meta = {r.decision_id: r for r in sc.itertuples(index=False)}
    by_dec = {k: g for k, g in rs[~rs["is_finish"]].groupby("decision_id", sort=False)}
    cards, matched = {}, {}
    unmatched = []
    for did, m in meta.items():
        names = slug_names(m.decision_url) or (m.fighter_1, m.fighter_2)
        if pd.isna(m.date):
            unmatched.append((did, "no date"))
            continue
        totals = []
        for j in (1, 2, 3):
            t = re.match(r"^\s*(\d+)\s*-\s*(\d+)\s*$", str(getattr(m, "j%d_score" % j)))
            if t:
                totals.append((int(t.group(1)), int(t.group(2))))
        dates = [m.date + dt.timedelta(days=k) for k in (0, -1, 1)]
        hit = match_fight(names[0], names[1], dates, by_date, totals)
        if hit is None:
            unmatched.append((did, "no ufcstats event within a day"))
            continue
        fid, swapped, s1, s2, margin = hit
        ok = (min(s1, s2) >= 0.6) or (max(s1, s2) >= 0.95 and min(s1, s2) >= 0.4)
        if not ok:
            unmatched.append((did, "names: %s / %s vs %s (%.2f %.2f)" % (names[0], names[1],
                              fights[fid]["A"] + " vs. " + fights[fid]["B"], s1, s2)))
            continue
        matched[did] = dict(fid=fid, swapped=swapped, sim=(round(s1, 3), round(s2, 3)), margin=round(margin, 3),
                            names=names, totals=totals)
        g = by_dec.get(did)
        if g is None:
            continue                                   # totals only on MMA Decisions
        judges = []
        g = g.assign(pos=g.groupby("round_num").cumcount() + 1)
        for pos, gj in g.groupby("pos", sort=True):
            names = gj["judge_name"].unique()
            if len(names) != 1:
                log["D_judge_order_inconsistent"].append(did)
            jid = gj["judge_id"].iloc[0]
            rounds = {}
            for r in gj.itertuples(index=False):
                a, b = (int(r.score_f2), int(r.score_f1)) if swapped else (int(r.score_f1), int(r.score_f2))
                rounds[int(r.round_num)] = (a, b, None, None)
            judges.append(dict(jid=None if pd.isna(jid) else int(jid), name=names[0], pos=int(pos), rounds=rounds))
        if fid in cards:
            log["D_duplicate_fight"].append((did, fid))
            continue
        cards[fid] = dict(src="D", mmad_id=int(did), judges=judges, raw_known=False)
    log["D_decisions"] = len(meta)
    log["D_unmatched"] = unmatched
    return cards, matched


def load_davies_stoppage(fights, by_date, judge_ids):
    js = json.loads((CACHE / "davies/data/stoppage_scorecards.json").read_text())
    sc = pd.read_csv(CACHE / "davies/data/ufc_scorecards.csv", dtype={"decision_id": str})
    sc["date"] = pd.to_datetime(sc["event_date"], format="%B %d, %Y", errors="coerce").dt.date
    ev_date = {str(e): d for e, d in zip(sc["event_id"], sc["date"]) if pd.notna(d)}
    out = {}
    for x in js:
        d = ev_date.get(str(x["event_id"]))
        dates = [d + dt.timedelta(days=k) for k in (0, -1, 1)] if d else list(by_date)
        hit = match_fight(x["fighter_1"], x["fighter_2"], dates, by_date)
        if not hit or min(hit[2], hit[3]) < 0.6:
            continue
        fid, sw = hit[0], hit[1]
        f = fights[fid]
        judges = []
        for j in x["judges"]:
            rr = [j["scores"][str(r)] for r in range(1, int(x["rounds_scored"]) + 1)]
            rr = [[b, a] if sw else [a, b] for a, b in rr]
            judges.append(dict(name=j["judge_name"], id=judge_ids.get(norm(j["judge_name"])), rounds=rr,
                               total=[sum(r[0] for r in rr), sum(r[1] for r in rr)]))
        out[fid] = dict(date=f["date"].isoformat(), event=f["event"], A=f["A"], B=f["B"], winner=f["winner"],
                        method=f["method"], end_round=f["rnd"], source_key=x["fight_id"], judges=judges)
    return out


# ------------------------------------------------------------------ checks
def best_perm(sim):
    """Assignment rows -> columns maximizing the summed similarity matrix (at most 3 x 3)."""
    best, bp = -1e9, None
    nr, nc = len(sim), len(sim[0]) if sim else 0
    for perm in itertools.permutations(range(nc), min(nr, nc)):
        v = sum(sim[i][perm[i]] for i in range(len(perm)))
        if v > best:
            best, bp = v, perm
    return bp or ()


def oriented_ufc(f):
    """ufcstats cards as (name, A, B, raw pair); loser-first when there is a winner, unordered (None) otherwise."""
    out = []
    for nm, x, y in f["ufc_cards"][-3:]:
        if f["winner"] == "A":
            out.append((nm, y, x, (x, y)))
        elif f["winner"] == "B":
            out.append((nm, x, y, (x, y)))
        else:
            out.append((nm, None, None, (x, y)))
    return out


def card_totals(j):
    rs = [j["rounds"][r] for r in sorted(j["rounds"])]
    return [sum(r[0] for r in rs), sum(r[1] for r in rs)]


def same_total(t, c):
    return (sorted(t) == sorted(c[3])) if c[1] is None else (t == [c[1], c[2]])


def validate_ufc(f, judges, stats, name_votes):
    """Compare each judge's published total with the ufcstats DETAILS card of the same judge."""
    uc = oriented_ufc(f)
    if len(uc) < 3:
        stats["fights_without_3_ufcstats_cards"] += 1
        return {"ufc": "n/a"}
    tots = [card_totals(j) for j in judges]
    full = len(judges) == 3
    fm = None
    if full:
        if uc[0][1] is None:
            fm = sorted(tuple(sorted(t)) for t in tots) == sorted(tuple(sorted(c[3])) for c in uc)
        else:
            fm = sorted(map(tuple, tots)) == sorted((c[1], c[2]) for c in uc)
            if not fm and sorted(tuple(t[::-1]) for t in tots) == sorted((c[1], c[2]) for c in uc):
                stats["fight_totals_swapped"] += 1
        stats["fights_checked"] += 1
        stats["fight_totals_agree"] += int(fm)
    else:
        stats["partial_panel_fights_checked"] += 1
    known = lambda nm: bool(nm) and not norm(nm).startswith("unknown")
    sim = [[(name_sim(j["name"], c[0]) if known(j["name"]) and known(c[0]) else 0.0)
            + 0.01 * same_total(tots[i], c) for c in uc] for i, j in enumerate(judges)]
    perm = best_perm(sim)
    agree, diffs = 0, []
    for i, k in enumerate(perm):
        c = uc[k]
        ns = name_sim(judges[i]["name"], c[0]) if known(judges[i]["name"]) and known(c[0]) else None
        if ns is not None:
            stats["cards_both_named"] += 1
            stats["cards_name_sim_ge_0.7"] += int(ns >= 0.7)
            if ns >= 0.7 and judges[i].get("jid") is not None:
                name_votes[judges[i]["jid"]][c[0]] += 1
        ok = same_total(tots[i], c)
        agree += int(ok)
        if not ok:
            diffs.append([judges[i]["name"], tots[i], list(c[3]) if c[1] is None else [c[1], c[2]]])
    key = "" if full else "partial_panel_"
    stats[key + "cards_checked"] += len(perm)
    stats[key + "cards_agree"] += agree
    if full:
        v = {"ufc": "agree" if fm and agree == 3 else ("totals_agree_names_differ" if fm else "differs")}
    else:
        v = {"ufc": "agree_partial_panel" if agree == len(perm) else "differs_partial_panel"}
    if diffs:
        v["diffs"] = diffs
    return v


def completeness(f, judges):
    """True when every judge scored the same contiguous rounds 1..R and R fits how the fight ended."""
    sets = [sorted(j["rounds"]) for j in judges]
    if not sets or not all(sets):
        return False
    same = len({tuple(x) for x in sets}) == 1
    contiguous = all(x == list(range(1, len(x) + 1)) for x in sets)
    R = max(len(x) for x in sets)
    full_len = f["lengths"][f["rnd"] - 1] * 60 if f["lengths"] and f["rnd"] <= len(f["lengths"]) else None
    went_distance = f["rnd"] == f["sched"] and f["time_s"] == full_len
    r_ok = (R == f["sched"]) if went_distance else (R in (f["rnd"] - 1, f["rnd"]))
    return bool(same and contiguous and r_ok)


def compare_sources(cN, cD, stats, examples):
    """Round-by-round comparison of the two sources for one fight (judges matched by MMA Decisions id)."""
    dj = {j["jid"]: j for j in cD["judges"] if j["jid"] is not None}
    d_unknown = [j for j in cD["judges"] if j["jid"] is None]
    same_fight = True
    for j in cN["judges"]:
        k = dj.get(j["jid"])
        if k is None and j["jid"] is None and d_unknown:
            # unnamed judges: pair with the unnamed D card whose rounds match best
            key = lambda c: sum((c["rounds"].get(r, (0, 0))[:2] == v[:2]) for r, v in j["rounds"].items())
            k = max(d_unknown, key=key)
            d_unknown.remove(k)
            stats["unnamed_judges_paired"] += 1
        if k is None:
            stats["judge_not_in_D"] += 1
            same_fight = False
            continue
        for r, sc in j["rounds"].items():
            d = k["rounds"].get(r)
            stats["rounds_compared"] += 1
            if d is None:
                stats["round_missing_in_D"] += 1
                same_fight = False
            elif (sc[0], sc[1]) == (d[0], d[1]):
                stats["rounds_identical"] += 1
            elif (sc[0], sc[1]) == (d[1], d[0]):
                stats["rounds_swapped"] += 1
                same_fight = False
            else:
                stats["rounds_differ"] += 1
                same_fight = False
        extra = set(k["rounds"]) - set(j["rounds"])
        stats["round_extra_in_D"] += len(extra)
    stats["fights_compared"] += 1
    stats["fights_identical"] += int(same_fight)
    if not same_fight and len(examples) < 25:
        examples.append(cN["mmad_id"])


# ------------------------------------------------------------------ build
def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("--fetch", action="store_true", help="download missing source files, then build")
    ap.add_argument("--refresh", action="store_true", help="re-download every source file")
    ap.add_argument("--vault-from", default="2026-01-01")
    ap.add_argument("--vault-dir", default=VAULT_DIR)
    a = ap.parse_args()
    if a.fetch or a.refresh:
        fetch(refresh=a.refresh)
    vault_from = dt.date.fromisoformat(a.vault_from)
    vault_from_g[0] = vault_from

    log = defaultdict(list)
    fights, by_date = load_ufcstats()
    cN, crosswalk = load_nlbair(fights, log)
    cD, matchedD = load_davies(fights, by_date, log)

    # D matcher accuracy against N's crosswalk (same MMA Decisions id)
    mstat = Counter()
    for did, m in matchedD.items():
        t = crosswalk.get(int(did))
        if t is not None:
            mstat["checked"] += 1
            mstat["same_fight"] += int(t == m["fid"])
            if t != m["fid"]:
                log["D_match_disagrees_with_N"].append((did, m["fid"], t))
    log["D_matcher_vs_N_crosswalk"] = dict(mstat)

    # merge: N first, D for the rest; cross-check overlap
    cmp_stats, cmp_examples = Counter(), []
    merged = {}
    for fid in set(cN) | set(cD):
        if fid in cN:
            merged[fid] = dict(cN[fid], also_D=fid in cD)
            if fid in cD:
                compare_sources(cN[fid], cD[fid], cmp_stats, cmp_examples)
        else:
            merged[fid] = dict(cD[fid], also_D=False)

    # judge registry (MMA Decisions ids); judges without an id get one by name, else a negative id
    jname = {}
    for c in merged.values():
        for j in c["judges"]:
            if j["jid"] is not None:
                jname.setdefault(j["jid"], j["name"])
    jn = pd.read_csv(CACHE / "nlbair/data/judge_names.csv")
    for i, nm in zip(jn["judge_id"], jn["judge_name"]):
        jname[int(i)] = nm                              # N's spelling wins (keeps Mc/Mac capitals)
    by_norm = {norm(v): k for k, v in jname.items()}
    synth = {}
    for c in merged.values():
        for j in c["judges"]:
            if j["jid"] is None and norm(j["name"]).startswith("unknown"):
                j["name"] = "Unknown Judge"
                continue
            if j["jid"] is None:
                k = by_norm.get(norm(j["name"]))
                if k is None:
                    k = synth.setdefault(norm(j["name"]), -(len(synth) + 1))
                    jname[k] = j["name"]
                j["jid"] = k

    # validation against ufcstats DETAILS (published totals; loser first) and card completeness
    vstats, name_votes = Counter(), defaultdict(Counter)
    for fid, c in merged.items():
        c["validation"] = validate_ufc(fights[fid], c["judges"], vstats, name_votes)
        c["complete"] = completeness(fights[fid], c["judges"])
        if c["validation"]["ufc"] != "agree":
            log["ufc_disagreements"].append((fid, c["src"], c["validation"]))
    judge_ids_by_ufcname = {}
    for jid, votes in name_votes.items():
        for nm in votes:
            judge_ids_by_ufcname[norm(nm)] = jid
    stop = load_davies_stoppage(fights, by_date, {**{norm(v): k for k, v in jname.items()}, **judge_ids_by_ufcname})

    # slugs where the project already resolved people (backtest) or the roster name is unique
    slug_of = {}
    try:
        roster = json.load(open(DERIVED / "fighters.json"))["fighters"]
        cnt = Counter(v["name"] for v in roster.values())
        slug_of = {v["name"]: s for s, v in roster.items() if cnt[v["name"]] == 1}
    except (OSError, KeyError, ValueError):
        pass
    bt_slugs = {}
    try:
        for f in json.load(open(DERIVED / "backtest.json"))["fights"]:
            bt_slugs[f["id"]] = (f["A"].get("slug"), f["B"].get("slug"))
    except (OSError, KeyError, ValueError):
        pass

    rstats = load_round_stats(fights)

    # ---------------------------------------------------------- outputs
    def fight_record(fid, c):
        f = fights[fid]
        sl = bt_slugs.get(fid) or (slug_of.get(f["A"]), slug_of.get(f["B"]))
        js = []
        for j in sorted(c["judges"], key=lambda j: j["pos"]):
            rr = [j["rounds"][r] for r in sorted(j["rounds"])]
            rec = dict(name=jname.get(j["jid"], j["name"]), id=j["jid"],
                       rounds=[[x[0], x[1]] for x in rr], total=card_totals(j))
            if c["raw_known"] and any((x[2], x[3]) != (x[0], x[1]) for x in rr):
                rec["raw"] = [[x[2], x[3]] for x in rr]
            js.append(rec)
        rec = dict(date=f["date"].isoformat(), event=f["event"], loc=f["loc"], A=f["A"], B=f["B"],
                   A_slug=sl[0], B_slug=sl[1], winner=f["winner"], method=f["method"], sched=f["sched"],
                   end_round=f["rnd"], end_time=f["time_s"], title=bool(f["title"]), wc=f["wc"],
                   referee=f["referee"], src=c["src"] + ("+D" if c.get("also_D") else ""),
                   mmad_id=c["mmad_id"], raw_known=c["raw_known"], complete=c["complete"], judges=js,
                   validation=c["validation"])
        if c.get("jurisdiction"):
            rec["jurisdiction"] = c["jurisdiction"]
        return rec

    def round_rows(fids):
        rcols = (["fid", "date", "rnd", "sched", "mins", "end_rnd", "title", "women", "wc", "winner", "src",
                  "raw_known", "complete", "ufc_check", "has_stats", "ded_A", "ded_B", "nJ", "nA", "nB", "nE", "n_wide"]
                 + ["A_" + k for k in STAT_COLS] + ["B_" + k for k in STAT_COLS])
        scols = ["ri", "jid", "pos", "A", "B", "A_raw", "B_raw"]
        rows, srows = [], []
        for fid in fids:
            c, f = merged[fid], fights[fid]
            rset = sorted({r for j in c["judges"] for r in j["rounds"]})
            for r in rset:
                if f["lengths"] and r <= len(f["lengths"]) and r <= f["rnd"]:
                    mins = f["lengths"][r - 1] if r < f["rnd"] else (f["time_s"] or 0) / 60.0
                else:
                    mins = None
                sa, sb = rstats.get((fid, r, 0)), rstats.get((fid, r, 1))
                has = sa is not None and sb is not None
                sc = [(j, j["rounds"][r]) for j in c["judges"] if r in j["rounds"]]
                dA = dB = None
                if c["raw_known"]:
                    dA = max(x[2] - x[0] for _, x in sc)
                    dB = max(x[3] - x[1] for _, x in sc)
                rawm = [((x[2] - x[3]) if c["raw_known"] else (x[0] - x[1])) for _, x in sc]
                ri = len(rows)
                rows.append([fid, f["date"].isoformat(), r, f["sched"], None if mins is None else round(mins, 3),
                             r == f["rnd"], bool(f["title"]), bool(f["women"]), f["wc"], f["winner"],
                             c["src"], c["raw_known"], c["complete"], c["validation"]["ufc"], has, dA, dB, len(sc), sum(m > 0 for m in rawm),
                             sum(m < 0 for m in rawm), sum(m == 0 for m in rawm), sum(abs(m) >= 2 for m in rawm)]
                            + (sa if sa else [None] * len(STAT_COLS)) + (sb if sb else [None] * len(STAT_COLS)))
                for j, x in sc:
                    srows.append([ri, j["jid"], j["pos"], x[0], x[1], x[2], x[3]])
        return {"cols": rcols, "rows": rows}, {"cols": scols, "rows": srows}

    dev = sorted((fid for fid in merged if fights[fid]["date"] < vault_from),
                 key=lambda k: (fights[k]["date"], -fights[k]["idx"]))
    vault = sorted((fid for fid in merged if fights[fid]["date"] >= vault_from),
                   key=lambda k: (fights[k]["date"], -fights[k]["idx"]))

    rounds_dev, scores_dev = round_rows(dev)
    report = summarize(rounds_dev, scores_dev, fights, merged, dev, jname)
    judges_tbl = judge_table(rounds_dev, scores_dev, jname, name_votes)

    fetched = {}
    try:
        fetched = json.loads((CACHE / "FETCHED.json").read_text())
    except (OSError, ValueError):
        pass
    unmatched_D = log["D_unmatched"]
    meta = {
        "built": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "tool": "tools/judgerounds.py",
        "sources": {
            "N": "nlbair/ufc-data v0.1.1 (Noah Bair 2026, CC BY 4.0, doi:10.5281/zenodo.23458636); "
                 "round scores from MMA Decisions, stats from ufcstats.com",
            "D": "martindavies-code/ufc-judging-analysis (Martin Davies 2026, no license file; private research "
                 "use, credited); round scores parsed from MMA Decisions",
            "ufcstats": "data/raw/*.csv (Greco1899/scrape_ufc_stats snapshot)",
            "why_not_mmadecisions_direct": "mmadecisions.com/robots.txt disallows all agents except listed "
                                           "search engines",
            "fetched": fetched.get("fetched"), "file_sha256_16": fetched.get("files"),
        },
        "orientation": "every [a, b] pair is [A, B] = the two names of the ufcstats BOUT string in order",
        "scores": "rounds/total are published scores (after point deductions; they add up to the official "
                  "totals); raw (only where it differs) adds the deducted point back = the judge's view of the "
                  "round. raw_known=false (source D only) means deductions cannot be separated.",
        "split": {"dev_until": a.vault_from, "n_dev_fights": len(dev), "n_vault_fights": len(vault),
                  "vault_files": [os.path.join(a.vault_dir, "judgerounds_vault.json"),
                                  os.path.join(a.vault_dir, "judgerounds_rows_vault.json")]},
        "checks": {
            "ufcstats_totals": dict(vstats),
            "source_overlap_N_vs_D": dict(cmp_stats),
            "source_overlap_examples_mmad_ids": cmp_examples,
            "D_matcher_vs_N_crosswalk": log["D_matcher_vs_N_crosswalk"],
            "D_matcher_disagreements": log["D_match_disagrees_with_N"][:50],
            "N_orientation_check": log["N_orientation_check"],
            "D_unmatched": len(unmatched_D), "D_unmatched_examples": unmatched_D[:40],
            "N_fights_not_in_ufcstats": log["N_fight_not_in_ufcstats"],
        },
        "report_dev": report,
    }
    out = {"meta": meta, "judges": judges_tbl,
           "fights": {fid: fight_record(fid, merged[fid]) for fid in dev},
           "stoppage_unverified": {
               "_note": "48 partial cards for fights that ended inside the distance, hand-entered in source D "
                        "(data/stoppage_scorecards.json) with no cited source. Not verified, not in the rows.",
               **{k: v for k, v in stop.items() if dt.date.fromisoformat(v["date"]) < vault_from}}}
    rows_out = {"meta": {
        "built": meta["built"], "tool": "tools/judgerounds.py", "split": meta["split"],
        "orientation": meta["orientation"],
        "rounds": "one row per scored round of a decision. Stats are ufcstats per-round counts for A and B "
                  "(x_l landed, x_a attempted; sig = head+body+leg = dist+clinch+ground; ctrl in seconds; "
                  "kd, sub (attempts), rev (reversals)). mins = round length actually fought. end_rnd = the "
                  "fight ended in this round (technical decisions can end early). ded_A/ded_B = points "
                  "deducted from A/B in the round (null if unknown). nA/nB/nE = judges giving the round to "
                  "A/B/even before deductions (published when raw_known=false); n_wide = judges with a margin "
                  ">= 2 (10-8 or wider). complete = every judge scored the same rounds 1..R and R fits how "
                  "the fight ended; ufc_check = agreement of the fight's card totals with ufcstats (agree, "
                  "agree_partial_panel, totals_agree_names_differ, differs, differs_partial_panel, n/a). "
                  "A clean training subset: complete & ufc_check in (agree, agree_partial_panel, "
                  "totals_agree_names_differ).",
        "scores": "one row per judge per round: ri = row index into rounds.rows, jid = MMA Decisions judge id "
                  "(negative = no id, matched by name), pos = card position on MMA Decisions, A/B = published "
                  "score, A_raw/B_raw = before deductions (null when unknown).",
        "load": "pd.DataFrame(d['rounds']['rows'], columns=d['rounds']['cols']); same for scores; "
                "merge scores.ri -> rounds index",
        "judges": "see data/derived/judgerounds.json -> judges"},
        "rounds": rounds_dev, "scores": scores_dev}

    write_json(DERIVED / "judgerounds.json", out)
    write_json(DERIVED / "judgerounds_rows.json", rows_out)
    os.makedirs(a.vault_dir, exist_ok=True)
    rounds_v, scores_v = round_rows(vault)
    write_json(Path(a.vault_dir) / "judgerounds_vault.json",
               {"meta": dict(meta, report_dev=None), "fights": {fid: fight_record(fid, merged[fid]) for fid in vault},
                "stoppage_unverified": {k: v for k, v in stop.items()
                                        if dt.date.fromisoformat(v["date"]) >= vault_from}})
    write_json(Path(a.vault_dir) / "judgerounds_rows_vault.json",
               {"meta": rows_out["meta"], "rounds": rounds_v, "scores": scores_v})

    # ---------------------------------------------------------- print
    print("fights with round scores: %d (dev %d, vault %d); sources N %d, D-only %d, overlap %d" % (
        len(merged), len(dev), len(vault), sum(c["src"] == "N" for c in merged.values()),
        sum(c["src"] == "D" for c in merged.values()), sum(c.get("also_D", False) for c in merged.values())))
    print("D matcher vs N crosswalk:", log["D_matcher_vs_N_crosswalk"], " unmatched D decisions:", len(unmatched_D))
    print("N orientation check:", log["N_orientation_check"])
    print("source overlap N vs D:", dict(cmp_stats))
    print("ufcstats totals check:", dict(vstats))
    print("stoppage_unverified matched:", len(stop))
    print(json.dumps(report, indent=1))


def write_json(path, obj):
    def default(o):
        if isinstance(o, (np.integer,)):
            return int(o)
        if isinstance(o, (np.floating,)):
            return float(o)
        if isinstance(o, (np.bool_,)):
            return bool(o)
        if isinstance(o, (dt.date,)):
            return o.isoformat()
        raise TypeError(type(o))
    with open(path, "w") as fh:
        json.dump(obj, fh, separators=(",", ":"), default=default)
    print("wrote", path, "%.1f MB" % (os.path.getsize(path) / 1e6))


# ------------------------------------------------------------------ summaries (dev period only)
def frame(tbl):
    return pd.DataFrame(tbl["rows"], columns=tbl["cols"])


def summarize(rounds, scores, fights, merged, dev, jname):
    R, S = frame(rounds), frame(scores)
    S = S.join(R[["date", "sched", "raw_known", "nJ", "src", "has_stats"]], on="ri")
    S["year"] = S["date"].str[:4].astype(int)
    R["year"] = R["date"].str[:4].astype(int)
    S["mA"] = np.where(S["raw_known"], S["A_raw"], S["A"]).astype(float) - \
        np.where(S["raw_known"], S["B_raw"], S["B"]).astype(float)
    S["mP"] = (S["A"] - S["B"]).astype(float)
    rep = {}
    rep["fights"] = len(dev)
    rep["fights_by_source"] = dict(Counter(merged[f]["src"] + ("+D" if merged[f].get("also_D") else "") for f in dev))
    rep["fights_by_year"] = dict(sorted(Counter(fights[f]["date"].year for f in dev).items()))
    dev_set = set(dev)
    ufc_dec = Counter(f["date"].year for f in fights.values()
                      if f["method"].startswith("Decision") and f["date"] < vault_from_g[0])
    have = Counter(fights[f]["date"].year for f in dev_set if fights[f]["method"].startswith("Decision"))
    rep["coverage_of_ufcstats_decisions_by_year"] = {
        y: "%d/%d" % (have.get(y, 0), n) for y, n in sorted(ufc_dec.items()) if y >= 2005}
    rep["coverage_of_ufcstats_decisions_2013_2025"] = round(
        sum(have.get(y, 0) for y in range(2013, 2026)) / max(sum(ufc_dec.get(y, 0) for y in range(2013, 2026)), 1), 4)
    rep["fights_complete"] = int(sum(merged[f]["complete"] for f in dev))
    rep["fights_by_ufc_check"] = dict(Counter(merged[f]["validation"]["ufc"] for f in dev))
    rep["fights_with_3_judges"] = int(sum(len(merged[f]["judges"]) == 3 for f in dev))
    rep["rounds"] = len(R)
    rep["judge_rounds"] = len(S)
    rep["judges"] = int(S["jid"].nunique())
    rep["rounds_with_3_judges"] = int((R["nJ"] == 3).sum())
    rep["rounds_with_stats"] = int(R["has_stats"].sum())
    # margins, judge-round level (pre-deduction where known)
    am = S["mA"].abs()
    rep["judge_round_margin_share"] = {"10-10": round(float((am == 0).mean()), 5),
                                       "10-9": round(float((am == 1).mean()), 5),
                                       "10-8": round(float((am == 2).mean()), 5),
                                       "10-7 or wider": round(float((am >= 3).mean()), 5)}
    k = S["raw_known"]
    rep["judge_round_10_8_plus_raw_known"] = round(float((S.loc[k, "mA"].abs() >= 2).mean()), 5)
    rep["judge_round_10_8_plus_published_all"] = round(float((S["mP"].abs() >= 2).mean()), 5)
    rep["deductions_rounds_raw_known"] = int(((R["ded_A"].fillna(0) > 0) | (R["ded_B"].fillna(0) > 0)).sum())
    # per-year and per era 10-8 rate (raw where known)
    yr = S.groupby("year").apply(lambda g: pd.Series({"judge_rounds": len(g),
                                                      "share_10_8_plus": round(float((g["mA"].abs() >= 2).mean()), 4),
                                                      "share_10_10": round(float((g["mA"] == 0).mean()), 4)}),
                                 include_groups=False)
    rep["by_year"] = {int(y): {k2: (int(v) if k2 == "judge_rounds" else float(v)) for k2, v in row.items()}
                      for y, row in yr.iterrows()}
    # round level agreement (3-judge rounds)
    R3 = R[R["nJ"] == 3]
    unanimous = (R3["nA"] == 3) | (R3["nB"] == 3)
    split21 = ((R3["nA"] == 2) & (R3["nB"] == 1)) | ((R3["nB"] == 2) & (R3["nA"] == 1))
    rep["rounds3_unanimous_winner"] = round(float(unanimous.mean()), 4)
    rep["rounds3_split_2_1"] = round(float(split21.mean()), 4)
    rep["rounds3_with_an_even_score"] = round(float((R3["nE"] > 0).mean()), 4)
    rep["rounds3_any_10_8"] = round(float((R3["n_wide"] > 0).mean()), 4)
    rep["rounds3_all_three_10_8"] = round(float((R3["n_wide"] == 3).mean()), 4)
    # pairwise judge disagreement on the round winner
    piv = S[S["nJ"] == 3].copy()
    piv["w"] = np.sign(piv["mA"])
    g = piv.groupby("ri")["w"].apply(list)
    pairs = dis = 0
    for ws in g:
        for x, y in itertools.combinations(ws, 2):
            pairs += 1
            dis += int(x != y)
    rep["judge_pair_round_disagreement"] = round(dis / max(pairs, 1), 4)
    # by era
    def era(y):
        return "2006-2012" if y < 2013 else ("2013-2016" if y < 2017 else ("2017-2022" if y < 2023 else "2023-2025"))
    R3e = R3.assign(era=R3["year"].map(era), unan=unanimous)
    rep["by_era_rounds3"] = {e: {"rounds": int(len(g2)), "unanimous_winner": round(float(g2["unan"].mean()), 4),
                                 "any_10_8": round(float((g2["n_wide"] > 0).mean()), 4),
                                 "share_judge_10_8": round(float(g2["n_wide"].sum() / (3 * len(g2))), 4)}
                             for e, g2 in R3e.groupby("era")}
    # sanity checks against the stats (majority winner vs simple stat leaders), raw-known 3-judge rounds
    Rs = R3[R3["has_stats"] & (R3["nA"] != R3["nB"])].copy()
    maj = np.where(Rs["nA"] > Rs["nB"], 1, -1)
    dsig = (Rs["A_sig_l"] - Rs["B_sig_l"]).to_numpy(float)
    em = (EM_W["head"] * (Rs["A_head_l"] - Rs["B_head_l"]) + EM_W["body"] * (Rs["A_body_l"] - Rs["B_body_l"])
          + EM_W["leg"] * (Rs["A_leg_l"] - Rs["B_leg_l"]) + EM_W["kd"] * (Rs["A_kd"] - Rs["B_kd"])
          + EM_W["td"] * (Rs["A_td_l"] - Rs["B_td_l"]) + EM_W["ctrl_min"] * (Rs["A_ctrl"] - Rs["B_ctrl"]) / 60.0
          + EM_W["sub"] * (Rs["A_sub"] - Rs["B_sub"])).to_numpy(float)
    nz = np.isfinite(dsig) & (dsig != 0)
    rep["majority_winner_vs_sig_leader"] = {"rounds": int(nz.sum()),
                                            "agree": round(float((np.sign(dsig[nz]) == maj[nz]).mean()), 4)}
    nz2 = np.isfinite(em) & (em != 0)
    rep["majority_winner_vs_EM_weights"] = {"rounds": int(nz2.sum()),
                                            "agree": round(float((np.sign(em[nz2]) == maj[nz2]).mean()), 4),
                                            "agree_2019_2023": round(float((np.sign(em[nz2]) == maj[nz2])[
                                                (Rs["year"].to_numpy()[nz2] >= 2019) &
                                                (Rs["year"].to_numpy()[nz2] <= 2023)].mean()), 4)}
    # judge-level: rounds per judge
    per = S.groupby("jid").size()
    rep["judges_with_100_rounds"] = int((per >= 100).sum())
    rep["judges_with_500_rounds"] = int((per >= 500).sum())
    top = per.sort_values(ascending=False).head(15)
    rep["top_judges_by_rounds"] = {jname.get(int(j), str(j)): int(n) for j, n in top.items()}
    return rep


def judge_table(rounds, scores, jname, name_votes):
    R, S = frame(rounds), frame(scores)
    S = S.join(R[["date", "raw_known", "nJ", "nA", "nB", "fid"]], on="ri")
    mA = np.where(S["raw_known"], S["A_raw"], S["A"]).astype(float) - \
        np.where(S["raw_known"], S["B_raw"], S["B"]).astype(float)
    S["w"] = np.sign(mA)
    S["wide"] = np.abs(mA) >= 2
    # dissent: the other two judges agree with each other on a winner and this judge differs
    oA = S["nA"] - (S["w"] > 0)
    oB = S["nB"] - (S["w"] < 0)
    S["others_agree"] = (S["nJ"] == 3) & (((oA == 2) & (oB == 0)) | ((oB == 2) & (oA == 0)))
    S["dissent"] = S["others_agree"] & (((oA == 2) & (S["w"] <= 0)) | ((oB == 2) & (S["w"] >= 0)))
    out = {}
    for jid, g in S.groupby("jid"):
        jid = int(jid)
        out[str(jid)] = {
            "name": jname.get(jid, str(jid)),
            "ufcstats_names": dict(name_votes.get(jid, Counter()).most_common()),
            "fights": int(g["fid"].nunique()), "rounds": int(len(g)),
            "first": g["date"].min(), "last": g["date"].max(),
            "share_10_8_plus": round(float(g["wide"].mean()), 4),
            "share_10_10": round(float((g["w"] == 0).mean()), 4),
            "dissent_rate": round(float(g["dissent"].sum() / max(int(g["others_agree"].sum()), 1)), 4),
        }
    return out


if __name__ == "__main__":
    main()
