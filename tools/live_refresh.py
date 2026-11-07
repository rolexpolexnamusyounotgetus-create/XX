#!/usr/bin/env python3
"""Live roster inputs for forward model v4.4: the frozen models of fwd-4.3 fed per-fighter state that includes the newest
verified UFC results (data/predictions/README.md, "Forward model v4.4 (Nov 7, 2026)", pre-registered before this code).

Run from the project root:

    python3 tools/live_refresh.py build                      # fetch Greco1899 + ESPN, verify, rebuild data/derived/live/
    python3 tools/live_refresh.py build --until 2026-11-08   # include events dated on or before this day only
    python3 tools/live_refresh.py regress                    # the zero-diff rule alone: cutoff 2026-10-31, compare with
                                                             # the fwd-4.3 pinned files (out/live_refresh/regress_*)
    python3 tools/live_refresh.py check [--lock ISO]         # what `forward_ledger.py predict --fwd 4.4` checks
    python3 tools/live_refresh.py show                       # manifest summary and per-fighter changes

What `build` does, in order:
  1. Results. The Greco1899 scrape_ufc_stats CSVs (ufcstats) at the upstream HEAD commit, pinned by SHA
     (raw.githubusercontent.com/<owner>/<repo>/<sha>/<file>, User-Agent "FightLabSim/1.0"), saved under out/ (data/raw is
     never written). Fights dated on or before 2026-10-31 (the fwd-4.3 snapshot) are kept as the pinned build kept them.
     Every bout dated after it must pass the two-source rule against ESPN's public scoreboard: both fighters matched, the
     same winner (or no winner for a draw / no contest), the same final round, finish vs decision; and ufcstats must have
     per-round stats for both men through that round. A failing bout is dropped from the live CSV copies and listed. An
     event ESPN does not list stops the cutoff before it. --raw-dir reads local CSVs instead (tests, regress).
  2. Builders, each in its own process inside a shadow tree out/live_refresh/<run>/shadow (copies of the builder modules,
     the filtered CSVs, copies of the pinned inputs they read; vault environment variables pointed at a throwaway folder
     that must stay empty). Only these functions are called, with the frozen parameters of the pinned files:
       fighters  build_db parse/people/vectors, run_elo(K, boost of elo_report.json), walk, build_priors, fighter_profile
       market    Kalman continuation of market.json ratings with eval.market_rating.params (no replay, no grid)
       ratings   ratings load_data/prepare/run_system (stored params, 11 systems)/run_dims (stored dim_params)/roster_states
       ml        ml load_all/run_elo/margin_elo (stored K, w)/build_table/roster_features, export rounding, mr from market
       ml2       page_model() roster: v (ml_live), r (4 systems, pre-review opp_ufc_w count), mr (market_live), pre (preufc)
       methodround  build_table walk state -> js_model extras and priors
     No builder `main` runs, nothing is refit, and nothing under data/derived/*.json, backtest*, *_oof*, research or the
     sealed vault directory is written.
  3. Guards: every frozen key of each live file equals the pinned file's; the frozen weight files keep their fwd-4.3 hashes
     before and after; the zero-diff rule (`regress`) holds for every live file.
  4. data/derived/live/<name>_live.json + manifest.json (as_of, sources, sha256 of every output, code hashes, guards).
"""
import argparse
import csv
import datetime as dt
import hashlib
import io
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DERIVED = os.path.join(ROOT, "data", "derived")
LIVE_DIR = os.path.join(DERIVED, "live")
WORK_ROOT = os.path.join(ROOT, "out", "live_refresh")
TOOL = "tools/live_refresh.py 1.0"
UA = "FightLabSim/1.0"
GRECO_GIT = "https://github.com/Greco1899/scrape_ufc_stats.git"
GRECO_RAW = "https://raw.githubusercontent.com/Greco1899/scrape_ufc_stats/%s/%s"
ESPN = "https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard?dates=%s"
GRECO_FILES = ("ufc_event_details.csv", "ufc_fight_details.csv", "ufc_fight_results.csv", "ufc_fight_stats.csv",
               "ufc_fighter_details.csv", "ufc_fighter_tott.csv")
PIN_SNAPSHOT = "2026-10-31"                     # fwd-4.3's roster snapshot (fighters.json meta.snapshot)
PIN_GRECO_COMMIT = "3d4886d222e72be2c5336b49b98b721f5103d949"   # "2026-11-01 data refresh": the CSVs of the pinned build
PIN_CSV_SHA16 = {"ufc_event_details.csv": "34b43588d55c757a", "ufc_fight_details.csv": "b3abd2d38a0c4ec1",
                 "ufc_fight_results.csv": "c1c3ee8004a205ef", "ufc_fight_stats.csv": "873527e4231fc9c7",
                 "ufc_fighter_details.csv": "a1f6e4326217fab9", "ufc_fighter_tott.csv": "3296e67941f984cd"}
# README "Files and hashes fwd-4.3 reads" (tests/test_forward_v44.js checks this equals forward_ledger.FWD43_PINNED)
FWD43_PINNED = {
    "data/derived/fighters.json": "df4d868a2195fb4a", "data/derived/moe_page.json": "34a33d1837e9b912",
    "data/derived/ml.json": "444b7b1e62086cc1", "data/derived/market.json": "8edb0a6cc9c3ca4f",
    "data/derived/methodround.json": "b26b7e373367f346", "data/derived/mlrates.json": "6dec930e670f7c70",
    "data/derived/ml2.json": "0837826dbc05cd1f", "data/derived/forward_models.json": "20269ec7642c1db8",
    "data/derived/ratings.json": "5fc4f8a3be14051f", "data/derived/preufc.json": "30111c93e864dfe0",
    "data/derived/blindtest_stack.json": "ded17ce026bbff29", "data/derived/debut.json": "f6709d52292ccc83",
    "data/derived/statlines.json": "30c3a959a1a3ac2a", "data/derived/embed_model.json": "061d9fba48cc6633",
    "data/derived/oppadj.json": "c27c8c6de3733c59",
    "versions/v4/engine3.js": "6c661f68a4c41c1d", "versions/v4/params3.js": "e16a6481319f9b15",
    "versions/v4/ml/mlrates.js": "b563032dd9468f7b",
    "src/ml/moe.js": "ad1097b488bbb3ac", "src/ml/mlpage.js": "d4c72febf5c57666", "src/ml/ml2.js": "0b62c4462dd7a915",
    "src/ml/debut.js": "e5bbc188f4cf42c9", "src/ml/statdist.js": "c7facbbc4b406be1", "src/ml/embed.js": "e3fa72fd6c0b140b",
    "tools/methodround_model.js": "fea58a2f9beff3ca",
}
# The live set (README "Forward model v4.4" section 1): live file -> pinned file and the JSON paths that are rebuilt.
# Every other key is copied from the pinned file and guarded. oppadj.json is pre-registered as live, but its roster
# builder is not part of tools/live_refresh.py 1.0, so under the zero-diff rule fwd-4.4 reads it at its fwd-4.3 pin
# (README implementation addendum).
LIVE = {
    "fighters": {"pinned": "data/derived/fighters.json", "file": "fighters_live.json",
                 "paths": [("fighters",), ("priors",), ("meta", "snapshot"), ("meta", "n_fights"), ("meta", "n_stat_fights")]},
    "market": {"pinned": "data/derived/market.json", "file": "market_live.json", "paths": [("ratings",)]},
    "ratings": {"pinned": "data/derived/ratings.json", "file": "ratings_live.json", "paths": [("roster",)]},
    "ml": {"pinned": "data/derived/ml.json", "file": "ml_live.json", "paths": [("roster",), ("page_model", "snapshot")]},
    "ml2": {"pinned": "data/derived/ml2.json", "file": "ml2_live.json",
            "paths": [("page_model", "roster"), ("page_model", "snapshot")]},
    "methodround": {"pinned": "data/derived/methodround.json", "file": "methodround_live.json",
                    "paths": [("js_model", "extras"), ("js_model", "priors")]},
}
NOT_LIVE = {"oppadj": "data/derived/oppadj.json"}      # pre-registered live, read at its pin (no 1.0 builder)
# the frozen files: fwd-4.3's pins minus the live set (weights, preufc, debut, embeddings, evaluators, engine)
FROZEN = {p: h for p, h in FWD43_PINNED.items() if p not in {v["pinned"] for v in LIVE.values()}}
BUILDER_MODULES = ("build_db.py", "ml.py", "ratings.py", "preufc.py", "methodround.py")
DROP_PROFILE_KEYS = ("ko_losses_365", "kd_absorbed_365", "last_ko_loss", "layoff", "ufc_years", "dur")
GUARDED_WRITE_PREFIXES = (os.path.join(DERIVED, "live") + os.sep, os.path.join(ROOT, "out") + os.sep)


# ====================================================================== small helpers
def now_utc():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0)


def iso(t):
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sha16(path):
    return sha256_file(path)[:16] if os.path.exists(path) else None


def jload(path):
    with open(path) as fh:
        return json.load(fh)


def dumps_compact(obj):
    """The pinned files' format (json.dump with compact separators, ASCII): every pinned live-set file round-trips
    through it byte for byte."""
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=True, allow_nan=False)


def guarded_write(path, text, mode="w"):
    ap = os.path.abspath(path)
    if not ap.startswith(GUARDED_WRITE_PREFIXES):
        raise SystemExit("refused: tools/live_refresh.py writes only under data/derived/live/ and out/ (asked: %s)" % path)
    os.makedirs(os.path.dirname(ap), exist_ok=True)
    with open(ap, mode) as fh:
        fh.write(text)


def get_path(obj, path):
    for k in path:
        obj = obj[k]
    return obj


def set_path(obj, path, value):
    for k in path[:-1]:
        obj = obj[k]
    obj[path[-1]] = value


def frozen_part(obj, paths):
    """The object with its live paths removed (deep copy via JSON)."""
    c = json.loads(json.dumps(obj))
    for p in paths:
        o = c
        for k in p[:-1]:
            o = o[k]
        o.pop(p[-1], None)
    return c


def frozen_sha(obj, paths):
    return hashlib.sha256(dumps_compact(frozen_part(obj, paths)).encode()).hexdigest()


def fetch(url, dest=None, timeout=90):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read()
    if dest:
        guarded_write(dest, data, "wb")
    return data


def fl():
    """tools/forward_ledger.py as a module (name matching, ESPN parsing conventions, closing-line proxy)."""
    if HERE not in sys.path:
        sys.path.insert(0, HERE)
    import forward_ledger
    return forward_ledger


def leaf_diff(a, b, path="", out=None, limit=12):
    """Differences between two JSON values: (count, max abs numeric diff, sample paths)."""
    if out is None:
        out = {"n": 0, "max_abs": 0.0, "examples": []}
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a or k not in b:
                out["n"] += 1
                if len(out["examples"]) < limit:
                    out["examples"].append("%s/%s only in %s" % (path, k, "live" if k in a else "pinned"))
            else:
                leaf_diff(a[k], b[k], path + "/" + str(k), out, limit)
    elif isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
        for i, (x, y) in enumerate(zip(a, b)):
            leaf_diff(x, y, path + "[%d]" % i, out, limit)
    elif a != b:
        out["n"] += 1
        if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
            out["max_abs"] = max(out["max_abs"], abs(a - b))
        if len(out["examples"]) < limit:
            out["examples"].append("%s: live %s, pinned %s" % (path, json.dumps(a)[:60], json.dumps(b)[:60]))
    return out


# ====================================================================== 1. results: Greco1899 + ESPN two-source rule
def greco_head():
    out = subprocess.run(["git", "ls-remote", GRECO_GIT, "refs/heads/main"], capture_output=True, text=True, timeout=60)
    m = re.match(r"^([0-9a-f]{40})\s", out.stdout or "")
    if not m:
        raise SystemExit("cannot read the Greco1899 upstream HEAD (git ls-remote): %s" % (out.stderr or out.stdout)[:300])
    return m.group(1)


def fetch_greco(commit, dest):
    os.makedirs(dest, exist_ok=True)
    got = {}
    for f in GRECO_FILES:
        p = os.path.join(dest, f)
        if not os.path.exists(p):
            fetch(GRECO_RAW % (commit, f), p)
        got[f] = sha256_file(p)
    return got


def read_csv_rows(path):
    with open(path, newline="", encoding="utf-8") as fh:
        rd = csv.reader(fh)
        header = next(rd)
        return header, list(rd)


def event_dates(raw_dir):
    h, rows = read_csv_rows(os.path.join(raw_dir, "ufc_event_details.csv"))
    ie, idt = h.index("EVENT"), h.index("DATE")
    out = {}
    for r in rows:
        try:
            out[r[ie].strip()] = dt.datetime.strptime(r[idt].strip(), "%B %d, %Y").date().isoformat()
        except Exception:
            continue
    return out


def greco_new_bouts(raw_dir, after, until):
    """Bouts of events dated in (after, until]: [{event, date, bout, names, outcome, method, round, time, format, url}]."""
    ed = event_dates(raw_dir)
    h, rows = read_csv_rows(os.path.join(raw_dir, "ufc_fight_results.csv"))
    ix = {k: h.index(k) for k in h}
    out = []
    for r in rows:
        ev = r[ix["EVENT"]].strip()
        d = ed.get(ev)
        if not d or not (after < d <= until):
            continue
        names = [x.strip() for x in r[ix["BOUT"]].split(" vs. ")]
        out.append({"event": ev, "date": d, "bout": r[ix["BOUT"]], "names": names, "outcome": r[ix["OUTCOME"]].strip(),
                    "method": r[ix["METHOD"]].strip(), "round": r[ix["ROUND"]].strip(), "time": r[ix["TIME"]].strip(),
                    "format": r[ix["TIME FORMAT"]].strip(), "url": r[ix["URL"]].strip()})
    return out


def greco_stat_rounds(raw_dir, events):
    """{(event, bout): {fighter name: set(rounds)}} from ufc_fight_stats.csv for the given events."""
    h, rows = read_csv_rows(os.path.join(raw_dir, "ufc_fight_stats.csv"))
    ie, ib, ir, ifi = h.index("EVENT"), h.index("BOUT"), h.index("ROUND"), h.index("FIGHTER")
    out = {}
    for r in rows:
        if r[ie].strip() not in events:
            continue
        m = re.match(r"^Round (\d+)$", r[ir].strip())
        if m:
            out.setdefault((r[ie].strip(), r[ib].strip()), {}).setdefault(r[ifi].strip(), set()).add(int(m.group(1)))
    return out


def espn_board(date_iso, cache_dir):
    """ESPN scoreboard competitions for an event date (the date and the next UTC day): list of dicts, or None when
    neither page could be read."""
    F = fl()
    comps, read = [], 0
    for d in sorted({date_iso, (dt.date.fromisoformat(date_iso) + dt.timedelta(days=1)).isoformat()}):
        p = os.path.join(cache_dir, "espn_%s.json" % d)
        try:
            raw = open(p, "rb").read() if os.path.exists(p) else fetch(ESPN % d.replace("-", ""), p)
            j = json.loads(raw)
            read += 1
        except Exception:
            continue
        for ev in j.get("events", []):
            for c in ev.get("competitions", []):
                cs = c.get("competitors") or []
                st = (c.get("status") or {})
                if len(cs) != 2:
                    continue
                comps.append({"event": ev.get("name"), "names": [F.norm_name(x["athlete"]["displayName"]) for x in cs],
                              "winner": [bool(x.get("winner")) for x in cs], "completed": bool((st.get("type") or {}).get("completed")),
                              "period": st.get("period"), "clock": st.get("displayClock"),
                              "rounds": ((c.get("format") or {}).get("regulation") or {}).get("periods"), "page": d})
    return comps if read else None


def _tokens(n):
    return {t for t in n.split() if len(t) >= 3}


def match_espn(names, comps):
    """The ESPN competition with both fighters (exact / last name + first initial, else shared name tokens)."""
    F = fl()
    a, b = F.norm_name(names[0]), F.norm_name(names[1])
    for c in comps:
        cand = set(c["names"])
        ma, mb = F.name_match(a, cand), F.name_match(b, cand)
        if ma and mb and ma != mb:
            return c, (c["names"].index(ma), c["names"].index(mb))
    for c in comps:
        ia = [i for i, n in enumerate(c["names"]) if _tokens(n) & _tokens(a)]
        ib = [i for i, n in enumerate(c["names"]) if _tokens(n) & _tokens(b)]
        if len(ia) == 1 and len(ib) == 1 and ia != ib:
            return c, (ia[0], ib[0])
    return None, None


def two_source(bout, comps, stat_rounds):
    """None when the bout passes; else the reason it is held out (README v4.4 section 2)."""
    c, idx = match_espn(bout["names"], comps)
    if c is None:
        return "not listed on ESPN's scoreboard"
    if not c["completed"]:
        return "ESPN: not completed"
    o = bout["outcome"]
    g_win = {"W/L": 0, "L/W": 1}.get(o)
    e_win = [i for i, w in enumerate(c["winner"]) if w]
    if g_win is not None:
        if len(e_win) != 1 or idx[g_win] != e_win[0]:
            return "winner differs (ufcstats %s, ESPN %s)" % (bout["names"][g_win], [c["names"][i] for i in e_win] or "none")
    elif e_win:
        return "ufcstats %s, ESPN has a winner" % o
    g_round = int(bout["round"]) if bout["round"].isdigit() else None
    if g_round is None or c["period"] != g_round:
        return "final round differs (ufcstats %s, ESPN %s)" % (bout["round"], c["period"])
    g_dec = "decision" in bout["method"].lower()
    sched = c.get("rounds") or (5 if "5 Rnd" in bout["format"] else 3)
    e_dec = c["period"] == sched and str(c["clock"]) == "5:00"
    if g_win is not None and g_dec != e_dec:
        return "finish vs decision differs (ufcstats %s, ESPN round %s %s)" % (bout["method"], c["period"], c["clock"])
    have = stat_rounds.get((bout["event"], bout["bout"].strip()), {})
    need = set(range(1, g_round + 1))
    for n in bout["names"]:
        if not need <= have.get(n, set()):
            return "ufcstats per-round stats incomplete for %s" % n
    return None


def verify_new(raw_dir, until, cache_dir, offline_espn=None):
    """Two-source check of every bout after the pinned snapshot -> (as_of, kept bouts, held-out bouts, events log)."""
    bouts = greco_new_bouts(raw_dir, PIN_SNAPSHOT, until)
    events = sorted({(b["date"], b["event"]) for b in bouts})
    stat_rounds = greco_stat_rounds(raw_dir, {e for _, e in events})
    as_of, kept, held, log = PIN_SNAPSHOT, [], [], []
    stop = False
    for d, ev in events:
        evb = [b for b in bouts if b["event"] == ev]
        if stop:
            held += [dict(b, reason="after an event that failed the two-source check") for b in evb]
            continue
        comps = offline_espn.get(d) if offline_espn is not None else espn_board(d, cache_dir)
        if not comps:
            held += [dict(b, reason="ESPN scoreboard unavailable for %s" % d) for b in evb]
            log.append({"event": ev, "date": d, "status": "stopped: ESPN scoreboard unavailable"})
            stop = True
            continue
        res = [(b, two_source(b, comps, stat_rounds)) for b in evb]
        ok = [b for b, r in res if r is None]
        if not ok:
            held += [dict(b, reason=r) for b, r in res]
            log.append({"event": ev, "date": d, "status": "stopped: no bout passed"})
            stop = True
            continue
        kept += ok
        held += [dict(b, reason=r) for b, r in res if r is not None]
        as_of = max(as_of, d)
        log.append({"event": ev, "date": d, "status": "included", "bouts": len(evb), "passed": len(ok)})
    return as_of, kept, held, log


def write_filtered_raw(src, dst, as_of, held):
    """Copies of the six CSVs without events after as_of and without held-out bouts (byte copies when nothing drops)."""
    os.makedirs(dst, exist_ok=True)
    ed = event_dates(src)
    late = {e for e, d in ed.items() if d > as_of}
    drop = {(b["event"], b["bout"].strip()) for b in held}
    counts = {}
    for f in GRECO_FILES:
        sp, dp = os.path.join(src, f), os.path.join(dst, f)
        if f in ("ufc_fighter_details.csv", "ufc_fighter_tott.csv"):
            shutil.copyfile(sp, dp)
            continue
        h, rows = read_csv_rows(sp)
        ie = h.index("EVENT")
        ib = h.index("BOUT") if "BOUT" in h else None
        keep = [r for r in rows if r[ie].strip() not in late and not (ib is not None and (r[ie].strip(), r[ib].strip()) in drop)]
        counts[f] = len(rows) - len(keep)
        if len(keep) == len(rows):
            shutil.copyfile(sp, dp)
        else:
            with open(dp, "w", newline="", encoding="utf-8") as fh:
                w = csv.writer(fh, lineterminator="\n")
                w.writerow(h)
                w.writerows(keep)
    return counts


# ====================================================================== 2. shadow tree and builder steps
def make_shadow(work, raw_dir):
    S = os.path.join(work, "shadow")
    if os.path.exists(S):
        shutil.rmtree(S)
    for d in ("tools", "data/raw", "data/derived", "cache"):
        os.makedirs(os.path.join(S, d), exist_ok=True)
    code = {}
    for m in BUILDER_MODULES:
        shutil.copyfile(os.path.join(HERE, m), os.path.join(S, "tools", m))
        code["tools/" + m] = sha256_file(os.path.join(HERE, m))
    for f in os.listdir(os.path.join(ROOT, "data", "raw")):      # wikidata name tables etc. (not the Greco CSVs)
        p = os.path.join(ROOT, "data", "raw", f)
        if f.endswith(".csv") and f not in GRECO_FILES and os.path.isfile(p):
            shutil.copyfile(p, os.path.join(S, "data", "raw", f))
    for f in GRECO_FILES:
        shutil.copyfile(os.path.join(raw_dir, f), os.path.join(S, "data", "raw", f))
    shutil.copyfile(os.path.join(ROOT, "data", "overrides.json"), os.path.join(S, "data", "overrides.json"))
    for f in ("preufc.json", "ratings.json", "elo_report.json", "market.json", "ml.json", "ml2.json", "methodround.json"):
        shutil.copyfile(os.path.join(DERIVED, f), os.path.join(S, "data", "derived", f))
    # read-only reference for the builders' evaluation-set bookkeeping (ratings.load_data); never written
    os.symlink(os.path.join(DERIVED, "backtest.json"), os.path.join(S, "data", "derived", "backtest.json"))
    return S, code


def step_env(S):
    env = dict(os.environ)
    trash = os.path.join(S, "vault_unused")
    env.update({"VAULT_DIR": trash, "ML_VAULT_DIR": trash, "RATINGS_VAULT_DIR": trash,
                "ML_CACHE_DIR": os.path.join(S, "cache"), "ML_OUT_JSON": os.path.join(S, "cache", "ml_unused.json"),
                "PYTHONHASHSEED": "0"})
    return env


def run_step(name, work, S):
    t0 = time.time()
    r = subprocess.run([sys.executable, os.path.abspath(__file__), "_step", name, work], cwd=S, env=step_env(S),
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit("live step %s failed:\n%s\n%s" % (name, r.stdout[-3000:], r.stderr[-3000:]))
    return round(time.time() - t0, 1)


def _shadow_import(S):
    sys.path.insert(0, os.path.join(S, "tools"))


def _check_modules(S, names):
    for n in names:
        mod = sys.modules.get(n)
        if mod is not None and not os.path.abspath(mod.__file__).startswith(os.path.join(S, "tools")):
            raise SystemExit("module %s was imported from %s, not the shadow tree" % (n, mod.__file__))


def step_fighters(work):
    """fighters_live.json + the bouts after the pinned snapshot (for the market) + first-4 UFC bout dates (ml2 rule)."""
    S = os.path.join(work, "shadow")
    _shadow_import(S)
    import build_db as B
    _check_modules(S, ["build_db"])
    pinned = jload(os.path.join(DERIVED, "fighters.json"))
    ch = jload(os.path.join(DERIVED, "elo_report.json"))["chosen"]
    log = {}
    fights, _ = B.parse_fights(log)
    people = B.build_people(fights, log)
    B.build_vectors(fights, log)
    elo_now, elo_pre, _ = B.run_elo(fights, ch["K"], ch["boost"], ch.get("boost_fights", 5), store=True)
    half = pinned["meta"]["half_life_days"]
    state, entries = B.walk(fights, people, elo_pre, half)
    snap = fights[-1].date
    snap_day = snap.toordinal()
    for stt in state.values():
        if stt["t"] is not None and snap_day > stt["t"]:
            stt["S"] *= math.exp(-math.log(2) / half * (snap_day - stt["t"]))
            stt["t"] = snap_day
    priors = B.build_priors(fights, B.PRIORS_FROM, None)
    since = dt.date.fromisoformat(pinned["meta"]["roster_since"])
    keyset = set()
    for prof in pinned["fighters"].values():
        keyset |= set(prof)
    roster = {}
    for p, stt in state.items():
        if p.startswith("amb:") or not stt["fights"] or stt["fights"][-1][0].date < since:
            continue
        prof = B.fighter_profile(p, stt, people, elo_now, snap_day)
        for k in DROP_PROFILE_KEYS:
            prof.pop(k, None)
        extra = set(prof) - keyset
        if extra:
            raise SystemExit("fighters: profile keys not in the pinned file: %s" % sorted(extra))
        roster[people[p]["slug"]] = prof
    roster = dict(sorted(roster.items()))
    out = json.loads(json.dumps(pinned))
    out["fighters"] = roster
    out["priors"] = priors
    out["meta"]["snapshot"] = snap.isoformat()
    out["meta"]["n_fights"] = len(fights)
    out["meta"]["n_stat_fights"] = log["fights_with_stats"]
    guarded_write(os.path.join(work, "out", "fighters_live.json"), dumps_compact(out))   # = build_db.write_json
    # side outputs
    seen = {}
    new = []
    k4 = {}
    for f in fights:
        a, b = f.persons
        for q in (a, b):
            if len(k4.setdefault(q, [])) < 4:
                k4[q].append(f.date.isoformat())
        if f.date.isoformat() > PIN_SNAPSHOT and a != b:
            new.append({"fid": f.fid, "date": f.date.isoformat(), "event": f.event, "bout": f.bout,
                        "A": people[a].get("slug") if not a.startswith("amb:") else None,
                        "B": people[b].get("slug") if not b.startswith("amb:") else None,
                        "amb": a.startswith("amb:") or b.startswith("amb:"),
                        "prior_a": seen.get(a, 0), "prior_b": seen.get(b, 0), "winner": f.winner})
        if a != b:
            seen[a] = seen.get(a, 0) + 1
            seen[b] = seen.get(b, 0) + 1
    side = {"as_of": snap.isoformat(), "new_bouts": new,
            "k_dates": {people[q]["slug"]: v for q, v in k4.items() if not q.startswith("amb:") and people[q].get("slug")},
            "logs": {k: log[k] for k in ("duplicate_fight_rows_dropped", "excluded_fights", "aliases", "ambiguous_names",
                                         "unmatched_names", "tott_distrusted", "tott_unverified") if k in log},
            "elo": {"K": ch["K"], "boost": ch["boost"], "boost_fights": ch.get("boost_fights", 5)}}
    guarded_write(os.path.join(work, "steps", "fighters_side.json"), json.dumps(side, default=str))


def _ratings_roster(S, systems, oppufc_clean, with_dims):
    _shadow_import(S)
    import ratings as RT
    _check_modules(S, ["ratings", "build_db"])
    RT.OPPUFC_CLEAN = oppufc_clean
    D = RT.load_data()
    RT.prepare(D, lambda *a: None)
    J = jload(os.path.join(DERIVED, "ratings.json"))
    finals = {}
    for k in systems:
        v = J["systems"][k]
        P = dict(v["params"])
        _, _, st = RT.run_system(D, v["kind"], P, record=True, eval_idx=D.bt_idx[:5])
        finals[k] = {"kind": v["kind"], "P": P, "state": st if v["kind"] != "whr" else None,
                     "model": st if v["kind"] == "whr" else None}
    DP = J["systems"]["dims"]["dim_params"]
    dstate = {}
    if with_dims:
        _, _, _, dstate = RT.run_dims(D, DP, record=True)
    roster = RT.roster_states(D, finals, DP, dstate, D.day[-1])
    rf = {"coef": {k: float(v) for k, v in D.round_fit["coef"].items()}, "n_cards": int(D.round_fit["n_cards"])}
    return roster, dt.date.fromordinal(int(D.day[-1])).isoformat(), rf, J


def step_ratings(work):
    S = os.path.join(work, "shadow")
    J0 = jload(os.path.join(DERIVED, "ratings.json"))
    systems = [k for k, v in J0["systems"].items() if v.get("kind") in ("elo", "glicko2", "trueskill", "whr")]
    roster, ref, rf, J = _ratings_roster(S, systems, True, True)
    out = json.loads(json.dumps(J))
    out["roster"] = roster
    guarded_write(os.path.join(work, "out", "ratings_live.json"), dumps_compact(out))
    guarded_write(os.path.join(work, "steps", "ratings_side.json"), json.dumps({"ref_day": ref, "systems": systems,
                                                                                 "round_fit": rf}))


def step_ratings_ml2(work):
    S = os.path.join(work, "shadow")
    systems = jload(os.path.join(DERIVED, "ml2.json"))["page_model"]["rating_systems"]
    roster, ref, rf, _ = _ratings_roster(S, systems, False, False)
    guarded_write(os.path.join(work, "steps", "ratings_ml2.json"),
                  json.dumps({"ref_day": ref, "systems": systems, "oppufc_clean": False, "round_fit": rf,
                              "roster": {s: {k: row.get(k) for k in systems} for s, row in roster.items()}}))


def step_ml(work):
    S = os.path.join(work, "shadow")
    _shadow_import(S)
    import ml as M
    B = M.B
    _check_modules(S, ["ml", "build_db"])
    pinned = jload(os.path.join(DERIVED, "ml.json"))
    ch = jload(os.path.join(DERIVED, "elo_report.json"))["chosen"]
    if (M.ELO_K, M.ELO_BOOST) != (ch["K"], ch["boost"]):
        raise SystemExit("ml.py ELO_K / ELO_BOOST differ from elo_report.json's chosen values")
    fights, people, elo_pre = M.load_all()
    R_elo, _, _ = B.run_elo(fights, M.ELO_K, M.ELO_BOOST)
    tun = pinned["tuning"]["margin_elo"]
    xr, R_extra = {}, {}
    for mode, key in (("sig", "elo_sig"), ("judge", "elo_judge")):
        xr[key], _, R_extra[key] = M.margin_elo(fights, tun[key]["K"], tun[key]["w_share"], mode)
    df, state, _ = M.build_table(fights, people, elo_pre, xr)
    live_f = jload(os.path.join(S, "data", "derived", "fighters.json"))["fighters"]
    rost = M.roster_features(fights, people, state, R_elo, R_extra, None, live_f)
    under = ("_dob", "_last_fight", "_division", "_prev_lbs", "_lbs_fought")
    keys = set()
    for row in pinned["roster"].values():
        keys |= {k for k in row if not k.startswith("_") and k not in ("mr_mu", "mr_sd")}
    mkt = jload(os.path.join(work, "out", "market_live.json"))["ratings"]
    roster = {}
    for slug, fx in rost.items():
        r = {}
        for k in sorted(keys):
            v = fx.get(k)
            r[k] = None if v is None or (isinstance(v, float) and not math.isfinite(v)) else float("%.6g" % v)
        for k in under:
            r[k] = fx.get(k)
        if slug in mkt:
            r["mr_mu"], r["mr_sd"] = mkt[slug][0], mkt[slug][1]
        roster[slug] = r
    out = json.loads(json.dumps(pinned))
    out["roster"] = roster
    out["page_model"]["snapshot"] = fights[-1].date.isoformat()
    guarded_write(os.path.join(work, "out", "ml_live.json"), dumps_compact(out))
    guarded_write(os.path.join(work, "steps", "ml_side.json"), json.dumps({"snapshot": fights[-1].date.isoformat(),
                  "margin_elo": {k: {"K": tun[k]["K"], "w_share": tun[k]["w_share"]} for k in tun}, "n_roster": len(roster)}))


def step_methodround(work):
    S = os.path.join(work, "shadow")
    _shadow_import(S)
    import methodround as MR
    _check_modules(S, ["methodround", "build_db"])
    pinned = jload(os.path.join(DERIVED, "methodround.json"))
    T, priors, fights, people, state, elo_now = MR.build_table()
    # export_js_model's own extras / priors code (tools/methodround.py), the coefficients are not touched
    pri = {}
    for d, P in priors["live"].items():
        pri[d] = {k: (round(float(P[k]), 8) if P.get(k) is not None else None) for k in MR.PRIOR_FIELDS}
        pri[d]["lbs"] = P.get("lbs")
    extras = {}
    for p, st in state.items():
        P = people.get(p)
        if not P or not P.get("slug") or p.startswith("amb:") or not st["n_all"]:
            continue
        if st["last"] is None or dt.date.fromordinal(st["last"][0]) < dt.date(2019, 1, 1):
            continue
        extras[P["slug"]] = [st["streak"], st["last"][1], round(st["fin_min_w"], 2), st["fin_n_w"],
                             round(st["fin_min_l"], 2), st["fin_n_l"], st["r1_w"], st["r1_l"], round(st["dur"], 2),
                             st["dur_n"], round(st["opp_elo"] / st["n_all"], 1)]
    out = json.loads(json.dumps(pinned))
    out["js_model"]["extras"] = json.loads(json.dumps(extras, default=MR._json_default))
    out["js_model"]["priors"] = json.loads(json.dumps(pri, default=MR._json_default))
    guarded_write(os.path.join(work, "out", "methodround_live.json"), dumps_compact(out))
    guarded_write(os.path.join(work, "steps", "methodround_side.json"),
                  json.dumps({"walk_to": str(T["date"].max()), "n_extras": len(extras)}))


def step_ml2(work):
    S = os.path.join(work, "shadow")
    _shadow_import(S)
    import preufc as PU
    _check_modules(S, ["preufc"])
    pinned = jload(os.path.join(DERIVED, "ml2.json"))
    pm = pinned["page_model"]
    need, sysn, pre_keys = pm["keys"], pm["rating_systems"], pm["pre_keys"]
    mlj = jload(os.path.join(work, "out", "ml_live.json"))
    R2 = jload(os.path.join(work, "steps", "ratings_ml2.json"))
    if R2["systems"] != sysn:
        raise SystemExit("ml2: rating systems differ")
    mkr = jload(os.path.join(work, "out", "market_live.json"))["ratings"]
    PJ = jload(os.path.join(DERIVED, "preufc.json"))["fighters"]
    k_dates = jload(os.path.join(work, "steps", "fighters_side.json"))["k_dates"]
    roster = {}
    for slug, fx in mlj["roster"].items():
        row = [fx.get(k) for k in need]
        rr = R2["roster"].get(slug, {})
        rat = [[rr[s_]["mu"], rr[s_].get("sd", 0.0)] if rr.get(s_) and rr[s_].get("mu") is not None else None for s_ in sysn]
        kd = k_dates.get(slug, [])
        ok = (len(kd) < 4 or kd[3] >= "2015-01-01")
        cur = (PJ.get(slug) or {}).get("current")
        pre = None
        if ok and cur:
            v = PU.side_pre(cur, fx.get("n") or 0)
            pre = [None if (isinstance(v[k], float) and math.isnan(v[k])) else round(v[k], 6) for k in pre_keys]
        roster[slug] = {"v": row, "r": rat, "mr": mkr.get(slug), "pre": pre}
    out = json.loads(json.dumps(pinned))
    out["page_model"]["roster"] = roster
    out["page_model"]["snapshot"] = mlj["page_model"]["snapshot"]
    guarded_write(os.path.join(work, "out", "ml2_live.json"), dumps_compact(out))


STEPS = {"fighters": step_fighters, "ratings": step_ratings, "ratings_ml2": step_ratings_ml2, "ml": step_ml,
         "methodround": step_methodround, "ml2": step_ml2}


# ====================================================================== market: Kalman continuation (frozen params)
def odds_close_lines(timeline_path):
    """Pre-fight closing proxies from tools/odds_upcoming.py's timeline: per bout the last capture before its start
    (phase pre_start), the BestFightOdds sportsbook mean, multiplicative no-vig (bfo_p_a_novig; exchanges excluded)."""
    if not os.path.exists(timeline_path):
        return []
    T = jload(timeline_path)
    out = []
    for b in T.get("bouts", []):
        caps = [c for c in b.get("captures", []) if c.get("phase") == "pre_start" and c.get("bfo_p_a_novig") is not None]
        if not caps:
            continue
        c = caps[-1]
        out.append({"date": b["date"], "A": b.get("A"), "B": b.get("B"), "A_slug": b.get("A_slug"), "B_slug": b.get("B_slug"),
                    "p_a": c["bfo_p_a_novig"], "captured_utc": c.get("t"), "snapshot": c.get("snapshot"),
                    "start_utc": b.get("start_utc"), "bout_id": b.get("bout_id")})
    return out


def find_close(bout, lines, names):
    """The pre-fight close for a live bout (A = first ufcstats name), oriented to A; None when no capture matches."""
    F = fl()
    d0 = dt.date.fromisoformat(bout["date"])
    na, nb = (F.norm_name(x) for x in names)
    for L in lines:
        if abs((dt.date.fromisoformat(L["date"]) - d0).days) > 1:
            continue
        la = (L["A_slug"] or "", F.norm_name(L["A"] or ""))
        lb = (L["B_slug"] or "", F.norm_name(L["B"] or ""))
        def same(slug, nm, side):
            return (side[0] and side[0] == slug) or (nm and F.name_match(nm, {side[1]}))
        if same(bout["A"], na, la) and same(bout["B"], nb, lb):
            return L["p_a"], L
        if same(bout["A"], na, lb) and same(bout["B"], nb, la):
            return 1 - L["p_a"], L
    return None, None


def market_continue(pinned, new_bouts, as_of, lines, names_by_fid):
    """market.json ratings continued from the stored state (README v4.4 section 1; audit section 4.1)."""
    P = pinned["eval"]["market_rating"]["params"]
    sig_m, tau, v0, mu0, kappa = P["sig_m"], P["tau_per_year"], P["v0"], P.get("mu0", 0.0), P["kappa_result"]
    snap = dt.date.fromisoformat(pinned["eval"]["market_rating"]["live_snapshot_stream_to"])
    cur = pinned["ratings"]
    mu, var, last, n, virtual = {}, {}, {}, {}, {}
    for s, (m, sd, ld, nn) in cur.items():
        mu[s], var[s], last[s], n[s] = m, sd * sd, snap, nn      # sd at the snapshot: var drifted to it (or capped)
        virtual[s] = ld
    log, restarted = [], []
    stream = [b for b in new_bouts if b["date"] > snap.isoformat() and b["date"] <= as_of and not b["amb"]
              and b["A"] and b["B"] and b["prior_a"] >= 1 and b["prior_b"] >= 1]   # market.py's post-nlbair rule
    skipped = [b for b in new_bouts if b not in stream and b["date"] > snap.isoformat()]
    stream.sort(key=lambda e: (e["date"], e["fid"]))
    touched = set()
    for e in stream:
        d = dt.date.fromisoformat(e["date"])
        for k in (e["A"], e["B"]):
            if k not in mu:
                mu[k], var[k], n[k] = mu0, v0, 0
                restarted.append(k)
            else:
                gap = (d - last[k]).days / 365.25
                var[k] = min(var[k] + tau * tau * max(gap, 0), v0 * 2)
            last[k] = d
            virtual.pop(k, None)
            touched.add(k)
        i, j = e["A"], e["B"]
        p, L = find_close(e, lines, names_by_fid.get(e["fid"], ["", ""]))
        y = {"A": 1.0, "B": 0.0, "D": 0.5}.get(e["winner"])
        m = mu[i] - mu[j]
        s2 = var[i] + var[j]
        if p is not None:
            z = math.log(min(max(p, 0.02), 0.98) / (1 - min(max(p, 0.02), 0.98)))
            S_ = s2 + sig_m * sig_m
            r = z - m
            ki, kj = var[i] / S_, var[j] / S_
            mu[i] += ki * r
            mu[j] -= kj * r
            var[i] *= (1 - ki)
            var[j] *= (1 - kj)
        if y is not None and kappa > 0:
            m2 = mu[i] - mu[j]
            p2 = 1 / (1 + math.exp(-m2))
            g, h = y - p2, p2 * (1 - p2)
            den = 1 + kappa * h * (var[i] + var[j])
            mu[i] += kappa * var[i] * g / den
            mu[j] -= kappa * var[j] * g / den
            var[i] *= 1 - kappa * var[i] * h / den
            var[j] *= 1 - kappa * var[j] * h / den
        n[i] += 1
        n[j] += 1
        log.append({"fid": e["fid"], "date": e["date"], "A": i, "B": j, "winner": e["winner"],
                    "close_p_a": None if p is None else round(p, 4),
                    "close_source": None if L is None else "odds timeline last pre-start capture %s (%s)" % (L["snapshot"], L["captured_utc"]),
                    "update": "line + result" if p is not None else "result only (no pre-fight capture)"})
    out = {}
    end = dt.date.fromisoformat(as_of)
    for s in list(cur) + [k for k in mu if k not in cur]:
        if s in cur and s not in touched and end == snap:
            out[s] = cur[s]                                       # nothing to drift: the stored entry, unchanged
            continue
        gap = (end - last[s]).days / 365.25
        sd = math.sqrt(min(var[s] + tau * tau * gap, 2 * v0))
        out[s] = [round(mu[s], 4) if s in touched else cur[s][0], round(sd, 4),
                  last[s].isoformat() if s in touched else virtual[s], n[s]]
    info = {"params": {"sig_m": sig_m, "tau_per_year": tau, "v0": v0, "mu0": mu0, "kappa_result": kappa},
            "stored_snapshot": snap.isoformat(), "drifted_to": as_of, "updates": log, "restarted": restarted,
            "not_in_stream": [{"fid": b["fid"], "date": b["date"], "bout": b["bout"],
                               "why": "debut or ambiguous name (market.py's post-nlbair stream takes backtest fights only)"}
                              for b in skipped]}
    return out, info


# ====================================================================== build / regress / check
def frozen_check():
    return {p: {"pinned": h, "found": sha16(os.path.join(ROOT, p))} for p, h in FROZEN.items()
            if sha16(os.path.join(ROOT, p)) != h}


def pinned_live_check():
    return {v["pinned"]: {"pinned": FWD43_PINNED[v["pinned"]], "found": sha16(os.path.join(ROOT, v["pinned"]))}
            for v in LIVE.values() if sha16(os.path.join(ROOT, v["pinned"])) != FWD43_PINNED[v["pinned"]]}


def build_set(raw_dir, until, work, offline_espn=None, timeline=None):
    """Verify, build every live file into work/out, guard. Returns (info dict, {name: path})."""
    t0 = time.time()
    os.makedirs(os.path.join(work, "out"), exist_ok=True)
    os.makedirs(os.path.join(work, "steps"), exist_ok=True)
    as_of, kept, held, evlog = verify_new(raw_dir, until, os.path.join(work, "espn"), offline_espn)
    filt = os.path.join(work, "raw_filtered")
    dropped = write_filtered_raw(raw_dir, filt, as_of, held)
    S, code = make_shadow(work, filt)
    times = {"fighters": run_step("fighters", work, S)}
    shutil.copyfile(os.path.join(work, "out", "fighters_live.json"), os.path.join(S, "data", "derived", "fighters.json"))
    side = jload(os.path.join(work, "steps", "fighters_side.json"))
    if side["as_of"] != as_of:
        raise SystemExit("fighters snapshot %s differs from the verified as_of %s" % (side["as_of"], as_of))
    # market (in process): continuation from the stored state
    pm = jload(os.path.join(DERIVED, "market.json"))
    lines = odds_close_lines(timeline or os.path.join(DERIVED, "odds_upcoming.json"))
    names = {}
    for b in kept:
        names[b["url"].rstrip("/").split("/")[-1]] = b["names"]
    mk, minfo = market_continue(pm, side["new_bouts"], as_of, lines, names)
    pm2 = json.loads(json.dumps(pm))
    pm2["ratings"] = mk
    guarded_write(os.path.join(work, "out", "market_live.json"), dumps_compact(pm2))
    for st in ("ratings", "ratings_ml2", "ml", "methodround"):
        times[st] = run_step(st, work, S)
    times["ml2"] = run_step("ml2", work, S)
    trash = os.path.join(S, "vault_unused")
    if os.path.exists(trash) and os.listdir(trash):
        raise SystemExit("a builder wrote into the throwaway vault folder: %s" % os.listdir(trash))
    # guards: frozen keys of every live file equal the pinned file's
    guards, paths = {}, {}
    for name, spec in LIVE.items():
        p = os.path.join(work, "out", spec["file"])
        L, Pn = jload(p), jload(os.path.join(ROOT, spec["pinned"]))
        guards[name] = frozen_sha(L, spec["paths"]) == frozen_sha(Pn, spec["paths"])
        paths[name] = p
    rs = jload(os.path.join(work, "steps", "ratings_side.json"))
    pinned_rf = jload(os.path.join(DERIVED, "ratings.json"))["meta"]["round_model"]["coef"]
    guards["ratings_round_model"] = all(abs(rs["round_fit"]["coef"][k] - pinned_rf[k]) < 1e-9 for k in pinned_rf)
    guards["ratings_ref_day"] = rs["ref_day"] == as_of
    guards["ml2_ratings_ref_day"] = jload(os.path.join(work, "steps", "ratings_ml2.json"))["ref_day"] == as_of
    info = {"as_of": as_of, "until": until, "events_after_pin": evlog,
            "bouts_added": [{k: b[k] for k in ("date", "event", "bout", "outcome", "method", "round", "url")} for b in kept],
            "bouts_held_out": [{k: b[k] for k in ("date", "event", "bout", "outcome", "method", "round", "url", "reason")}
                               for b in held],
            "rows_dropped_from_csv_copies": dropped, "market": minfo, "guards": guards, "step_seconds": times,
            "builder_code_sha256": code, "fighters_logs": side["logs"], "elo": side["elo"],
            "ml_margin_elo": jload(os.path.join(work, "steps", "ml_side.json"))["margin_elo"],
            "ratings_round_model": rs["round_fit"], "seconds": round(time.time() - t0, 1)}
    return info, paths


def regress_raw(work):
    """The pinned build's CSVs: data/raw when its hashes are the pinned ones, else the upstream commit PIN_GRECO_COMMIT."""
    raw = os.path.join(ROOT, "data", "raw")
    if all(sha16(os.path.join(raw, f)) == h for f, h in PIN_CSV_SHA16.items()):
        return raw, "data/raw (sha256 = the pinned Oct 31 CSVs)"
    dest = os.path.join(WORK_ROOT, "greco_" + PIN_GRECO_COMMIT[:12])
    got = fetch_greco(PIN_GRECO_COMMIT, dest)
    bad = [f for f, h in PIN_CSV_SHA16.items() if got[f][:16] != h]
    if bad:
        raise SystemExit("upstream %s CSVs do not match the pinned hashes: %s" % (PIN_GRECO_COMMIT[:7], bad))
    return dest, "Greco1899 %s" % PIN_GRECO_COMMIT[:12]


def regress(work=None, quiet=False):
    """Zero-diff rule: the live builders at cutoff 2026-10-31 against the fwd-4.3 pinned files (byte equality)."""
    work = work or os.path.join(WORK_ROOT, "regress_" + now_utc().strftime("%Y%m%d-%H%M%S"))
    raw, src = regress_raw(work)
    info, paths = build_set(raw, PIN_SNAPSHOT, work, offline_espn={})
    res = {"cutoff": PIN_SNAPSHOT, "raw": src, "work": os.path.relpath(work, ROOT), "files": {}}
    for name, spec in LIVE.items():
        a, b = open(paths[name], "rb").read(), open(os.path.join(ROOT, spec["pinned"]), "rb").read()
        same = a == b
        r = {"identical_bytes": same, "sha256_16": hashlib.sha256(a).hexdigest()[:16], "pinned_sha256_16": FWD43_PINNED[spec["pinned"]]}
        if not same:
            r["diff"] = leaf_diff(json.loads(a), json.loads(b))
        res["files"][name] = r
        if not quiet:
            print("  zero-diff %-12s %s" % (name, "identical bytes (sha256 %s)" % r["sha256_16"] if same else
                                            "DIFFERS: %d values, max abs %.3g, e.g. %s" % (r["diff"]["n"], r["diff"]["max_abs"], r["diff"]["examples"][:3])))
    res["guards"] = info["guards"]
    res["ok"] = all(v["identical_bytes"] for v in res["files"].values()) and all(info["guards"].values())
    res["seconds"] = info["seconds"]
    return res


def cmd_regress(args):
    f0 = frozen_check()
    if f0 or pinned_live_check():
        raise SystemExit("refused: pinned files differ from fwd-4.3: %s %s" % (f0, pinned_live_check()))
    res = regress()
    print(json.dumps({k: v for k, v in res.items() if k != "files"}, indent=1))
    print("zero-diff rule: %s" % ("HOLDS for every live file" if res["ok"] else "FAILS"))
    if args.out:
        guarded_write(args.out, json.dumps(res, indent=1))
    return 0 if res["ok"] else 1


def git(*a):
    try:
        return subprocess.check_output(["git", "-C", ROOT] + list(a), stderr=subprocess.DEVNULL, text=True).strip()
    except Exception:
        return None


def cmd_build(args):
    t0 = now_utc()
    until = args.until or t0.date().isoformat()
    f0, p0 = frozen_check(), pinned_live_check()
    if f0 or p0:
        raise SystemExit("refused: files pinned by fwd-4.3 differ (frozen %s, live-set pins %s); the live inputs are built "
                         "only against fwd-4.3's pinned files" % (f0, p0))
    stamp = t0.strftime("%Y%m%d-%H%M%S")
    work = os.path.join(WORK_ROOT, "build_" + stamp)
    sources = {}
    if args.raw_dir:
        raw = os.path.abspath(args.raw_dir)
        sources["results"] = {"kind": "local CSVs (--raw-dir)", "dir": os.path.relpath(raw, ROOT),
                              "sha256": {f: sha256_file(os.path.join(raw, f)) for f in GRECO_FILES}}
    else:
        commit = args.greco_commit or greco_head()
        raw = os.path.join(WORK_ROOT, "greco_" + commit[:12])
        got = fetch_greco(commit, raw)
        sources["results"] = {"kind": "Greco1899/scrape_ufc_stats (ufcstats)", "repo": GRECO_GIT, "commit": commit,
                              "url_pattern": GRECO_RAW % (commit, "<file>"), "user_agent": UA, "sha256": got,
                              "saved_to": os.path.relpath(raw, ROOT)}
    print("results: %s" % sources["results"].get("commit", raw))
    zero = None
    if not args.no_regress:
        print("zero-diff rule (cutoff %s) ..." % PIN_SNAPSHOT)
        zero = regress(os.path.join(work, "regress"))
    print("live build (events through %s) ..." % until)
    tl = os.path.join(DERIVED, "odds_upcoming.json")
    info, paths = build_set(raw, until, os.path.join(work, "live"), timeline=tl)
    f1 = frozen_check()
    if f1:
        raise SystemExit("refused: a frozen file changed during the build: %s" % f1)
    if not all(info["guards"].values()):
        raise SystemExit("refused: guard failed: %s" % info["guards"])
    out_dir = os.path.abspath(args.out)
    files = {}
    for name, spec in LIVE.items():
        dst = os.path.join(out_dir, spec["file"])
        guarded_write(dst, open(paths[name]).read())
        files[name] = {"file": os.path.relpath(dst, ROOT), "sha256": sha256_file(dst), "replaces": spec["pinned"],
                       "replaces_sha256_16": FWD43_PINNED[spec["pinned"]], "live_paths": [".".join(p) for p in spec["paths"]],
                       "frozen_part_sha256": frozen_sha(jload(dst), spec["paths"]),
                       "status": "ok" if (zero is None or zero["files"][name]["identical_bytes"]) and info["guards"][name]
                       else "failed"}
    espn_pages = sorted(os.listdir(os.path.join(work, "live", "espn"))) if os.path.exists(os.path.join(work, "live", "espn")) else []
    sources["second_source"] = {"kind": "ESPN public scoreboard JSON", "url_pattern": ESPN % "<YYYYMMDD>", "pages": espn_pages}
    sources["odds"] = {"kind": "tools/odds_upcoming.py timeline (pre-fight captures only)",
                       "file": os.path.relpath(tl, ROOT), "sha256": sha256_file(tl) if os.path.exists(tl) else None}
    manifest = {
        "tool": TOOL, "readme_section": "data/predictions/README.md 'Forward model v4.4 (Nov 7, 2026)'",
        "as_of": info["as_of"], "until": until, "built_utc": iso(now_utc()), "code_commit": git("rev-parse", "HEAD"),
        "uncommitted_code": bool(git("status", "--porcelain", "--", "tools")),
        "code_sha256": dict({"tools/live_refresh.py": sha256_file(os.path.abspath(__file__))}, **info["builder_code_sha256"]),
        "pinned_snapshot": PIN_SNAPSHOT, "sources": sources, "files": files,
        "not_live": {k: {"file": v, "sha256_16": FWD43_PINNED[v], "why": "pre-registered live, but tools/live_refresh.py "
                         "1.0 has no roster builder for it; fwd-4.4 reads it at its fwd-4.3 pin (zero-diff rule)"}
                     for k, v in NOT_LIVE.items()},
        "frozen_files_sha256_16": FROZEN, "frozen_files_ok": not f1,
        "frozen_parameters": {"elo": info["elo"], "fighters": {"half_life_days": 730.0, "roster_since": "2021-01-01",
                                                               "priors_from": "2018-01-01"},
                              "market": info["market"]["params"], "ml_margin_elo": info["ml_margin_elo"],
                              "ratings": "data/derived/ratings.json systems.*.params and systems.dims.dim_params",
                              "ml2_rating_code": "tools/ratings.py with OPPUFC_CLEAN = False (the code of the pinned ml2.json roster)",
                              "ratings_round_model": info["ratings_round_model"]},
        "guards": info["guards"], "zero_diff": None if zero is None else {"ok": zero["ok"], "raw": zero["raw"],
                                                                        "files": {k: {kk: vv for kk, vv in v.items() if kk != "diff"}
                                                                                  for k, v in zero["files"].items()}},
        "results": {"events_after_pin": info["events_after_pin"], "bouts_added": info["bouts_added"],
                    "bouts_held_out": info["bouts_held_out"], "rows_dropped_from_csv_copies": info["rows_dropped_from_csv_copies"]},
        "market_update": info["market"], "fighters_logs": info["fighters_logs"],
        "changes_vs_pinned": changes_vs_pinned(paths), "seconds": round((now_utc() - t0).total_seconds(), 1),
        "work_dir": os.path.relpath(work, ROOT),
    }
    manifest["ok"] = all(f["status"] == "ok" for f in files.values()) and zero is not None and zero["ok"]
    guarded_write(os.path.join(out_dir, "manifest.json"), json.dumps(manifest, indent=1) + "\n")
    print("as_of %s; %d bouts added after %s, %d held out; zero-diff %s; wrote %s (manifest sha256 %s)"
          % (info["as_of"], len(info["bouts_added"]), PIN_SNAPSHOT, len(info["bouts_held_out"]),
             "not run" if zero is None else ("holds" if zero["ok"] else "FAILS"), os.path.relpath(out_dir, ROOT),
             sha256_file(os.path.join(out_dir, "manifest.json"))[:16]))
    return 0 if manifest["ok"] else 1


def changes_vs_pinned(paths):
    """Per-fighter diagnostics (never an input): roster fighters whose live values differ from the pinned files."""
    out = {}
    F0, F1 = jload(os.path.join(DERIVED, "fighters.json"))["fighters"], jload(paths["fighters"])["fighters"]
    out["fighters"] = {"added": sorted(set(F1) - set(F0)), "changed": sorted(s for s in F0 if s in F1 and F0[s] != F1[s])}
    for name, key in (("ratings", ("roster",)), ("ml", ("roster",)), ("ml2", ("page_model", "roster")),
                      ("market", ("ratings",)), ("methodround", ("js_model", "extras"))):
        A = get_path(jload(os.path.join(ROOT, LIVE[name]["pinned"])), key)
        Bv = get_path(jload(paths[name]), key)
        out[name] = {"added": sorted(set(Bv) - set(A)), "n_changed": sum(1 for s in A if s in Bv and A[s] != Bv[s])}
    return out


def check_live(live_dir=None, lock=None):
    """README v4.4 section 4: (ok, reason, info). ok False means fwd-4.4 falls back to fwd-4.3's pinned inputs."""
    live_dir = live_dir or LIVE_DIR
    mp = os.path.join(live_dir, "manifest.json")
    info = {"manifest": os.path.relpath(mp, ROOT)}
    try:
        M = jload(mp)
    except Exception as e:
        return False, "manifest missing or unreadable (%s)" % e.__class__.__name__, info
    info.update({"manifest_sha256": sha256_file(mp), "as_of": M.get("as_of"), "built_utc": M.get("built_utc"),
                 "greco_commit": ((M.get("sources") or {}).get("results") or {}).get("commit"),
                 "files": {k: (v or {}).get("sha256") for k, v in (M.get("files") or {}).items()}})
    if set(M.get("files") or {}) != set(LIVE):
        return False, "manifest does not list exactly the live set %s" % sorted(LIVE), info
    for name, spec in LIVE.items():
        f = M["files"][name]
        p = os.path.join(live_dir, spec["file"])
        if not os.path.exists(p):
            return False, "live file missing: %s" % spec["file"], info
        if sha256_file(p) != f.get("sha256"):
            return False, "live file sha256 differs from the manifest: %s" % spec["file"], info
        if f.get("status") != "ok":
            return False, "manifest marks %s as %s" % (spec["file"], f.get("status")), info
        L, Pn = jload(p), jload(os.path.join(ROOT, spec["pinned"]))
        if frozen_sha(L, spec["paths"]) != frozen_sha(Pn, spec["paths"]):
            return False, "guard: a frozen key of %s differs from %s" % (spec["file"], spec["pinned"]), info
    if not (M.get("zero_diff") or {}).get("ok"):
        return False, "manifest has no passing zero-diff check", info
    if not M.get("ok"):
        return False, "manifest not ok", info
    if (M.get("as_of") or "") < PIN_SNAPSHOT:
        return False, "as_of %s is before %s" % (M.get("as_of"), PIN_SNAPSHOT), info
    if lock is not None:
        try:
            built = dt.datetime.fromisoformat(M["built_utc"].replace("Z", "+00:00"))
        except Exception:
            return False, "manifest built_utc unreadable", info
        if built >= lock:
            return False, "built at or after the lock (%s >= %s)" % (M["built_utc"], iso(lock)), info
    return True, None, info


def cmd_check(args):
    lock = dt.datetime.fromisoformat(args.lock.replace("Z", "+00:00")) if args.lock else None
    ok, why, info = check_live(args.live_dir, lock)
    print(json.dumps({"ok": ok, "reason": why, **info}, indent=1))
    return 0 if ok else 1


def cmd_show(args):
    M = jload(os.path.join(args.live_dir or LIVE_DIR, "manifest.json"))
    print("as_of %s (built %s, commit %s), greco %s" % (M["as_of"], M["built_utc"], (M.get("code_commit") or "")[:7],
                                                       (M["sources"]["results"].get("commit") or "local")[:12]))
    print("events after %s: %s" % (PIN_SNAPSHOT, M["results"]["events_after_pin"] or "none"))
    print("bouts added %d, held out %d" % (len(M["results"]["bouts_added"]), len(M["results"]["bouts_held_out"])))
    for b in M["results"]["bouts_held_out"]:
        print("  held out: %s %s: %s" % (b["date"], b["bout"], b["reason"]))
    print("changes vs pinned: %s" % json.dumps(M["changes_vs_pinned"])[:2000])
    print("zero-diff: %s; guards: %s; ok: %s" % ((M.get("zero_diff") or {}).get("ok"), M["guards"], M["ok"]))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build")
    b.add_argument("--until", default=None, help="include events dated on or before this day (default: today, UTC)")
    b.add_argument("--raw-dir", default=None, help="read these six CSVs instead of fetching Greco1899 (tests)")
    b.add_argument("--greco-commit", default=None, help="upstream commit to fetch (default: HEAD of main)")
    b.add_argument("--out", default=LIVE_DIR, help="output folder (default data/derived/live; must be under it or out/)")
    b.add_argument("--no-regress", action="store_true", help="skip the zero-diff run (the manifest is then not ok)")
    r = sub.add_parser("regress")
    r.add_argument("--out", default=None, help="write the result JSON here (under out/)")
    c = sub.add_parser("check")
    c.add_argument("--live-dir", default=None)
    c.add_argument("--lock", default=None)
    s = sub.add_parser("show")
    s.add_argument("--live-dir", default=None)
    st = sub.add_parser("_step")
    st.add_argument("name", choices=sorted(STEPS))
    st.add_argument("work")
    args = ap.parse_args()
    if args.cmd == "_step":
        return STEPS[args.name](args.work)
    return {"build": cmd_build, "regress": cmd_regress, "check": cmd_check, "show": cmd_show}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main() or 0)
