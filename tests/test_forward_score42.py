#!/usr/bin/env python3
"""tests/test_forward_score42.py: fwd-4.2 scoring in tools/forward_ledger.py (data/predictions/README.md "Forward model
v4.2", Scoring).

    python3 tests/test_forward_score42.py          (a few seconds; offline, reads the local Greco1899 CSVs in data/raw)

1. parse_greco_stats on data/raw/ufc_event_details.csv + ufc_fight_stats.csv equals an independent per-round sum for
   every bout of a real 2025 event (no 2026 row is read).
2. match_stats records a bout only with a verified win / draw result and full round coverage, matches the names in
   either orientation, and sums only through the result's round.
3. compute_scores: the debut method block (primary vs base rates) and the stat-line block equal hand computations;
   fwd-4.1 files get neither block; a draw is scored for stat lines but void for the winner and the method.
4. score --no-fetch end to end on a temporary ledger folder: scores.json / scores.md carry the new sections.
"""
import csv
import importlib.util
import io
import json
import math
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("forward_ledger", os.path.join(ROOT, "tools", "forward_ledger.py"))
FL = importlib.util.module_from_spec(spec)
spec.loader.exec_module(FL)
FAILS, CHECKS = [], [0]


def ok(c, msg):
    CHECKS[0] += 1
    if not c:
        FAILS.append(msg)
        print("FAIL", msg)


def near(a, b, t=1e-12):
    return a is not None and b is not None and abs(a - b) <= t


# ---------------------------------------------------------------- 1. parse vs an independent per-round sum
evd = open(os.path.join(ROOT, "data", "raw", "ufc_event_details.csv"), encoding="utf-8").read()
fst = open(os.path.join(ROOT, "data", "raw", "ufc_fight_stats.csv"), encoding="utf-8").read()
# the newest 2025 event with stat rows (no 2026 row is read: hidden-data protocol, docs/BACKLOG.md)
import datetime as dt
dates = {}
for row in csv.DictReader(io.StringIO(evd)):
    try:
        dates[row["EVENT"].strip()] = dt.datetime.strptime(row["DATE"].strip(), "%B %d, %Y").date().isoformat()
    except ValueError:
        pass
with_stats = {row["EVENT"].strip() for row in csv.DictReader(io.StringIO(fst))}
EVENT, DATE = max(((e, d) for e, d in dates.items() if e in with_stats and d < "2026-01-01"), key=lambda x: x[1])
ok(DATE.startswith("2025"), "1. a 2025 event with stat rows (%s %s)" % (EVENT, DATE))
GS = FL.parse_greco_stats(evd, fst, {DATE})
indep, seen = {}, set()
for row in csv.reader(io.StringIO(fst)):
    if not row or row[0].strip() != EVENT or not row[2].startswith("Round "):
        continue
    k = (row[1].strip(), row[3].strip(), row[2].strip())
    if k in seen:
        continue
    seen.add(k)
    t = indep.setdefault((row[1].strip(), row[3].strip()), {"sig_lnd": 0, "sig_att": 0, "td_lnd": 0, "td_att": 0, "ctrl": 0,
                                                            "kd": 0, "sub_att": 0, "rounds": 0})
    sl, sa = row[5].split(" of ")
    tl, ta = row[8].split(" of ")
    mm, ss = row[12].split(":") if ":" in row[12] else ("0", "0")
    for key, v in (("sig_lnd", sl), ("sig_att", sa), ("td_lnd", tl), ("td_att", ta), ("kd", row[4]), ("sub_att", row[10])):
        t[key] += int(float(v))      # counts are "2" or "2.0" in the CSV
    t["ctrl"] += 60 * int(mm) + int(ss)
    t["rounds"] += 1
nb = 0
for (d, a, b), rec in GS.items():
    ok(d == DATE and rec["event"] == EVENT, "1. parsed bout carries the event and date")
    for fname, rounds in rec["fighters"].items():
        bout = [k for k in indep if FL.norm_name(k[1]) == fname and FL.norm_name(k[0].split(" vs")[0]) in (a, b)]
        ok(len(bout) == 1, "1. %s found once in the independent sum" % fname)
        if len(bout) != 1:
            continue
        ref = indep[bout[0]]
        ok(len(rounds) == ref["rounds"], "1. %s rounds %d vs %d" % (fname, len(rounds), ref["rounds"]))
        for st in FL.STAT_KEYS:
            ok(sum(r[st] for r in rounds.values()) == ref[st], "1. %s %s total" % (fname, st))
    nb += 1
ok(nb >= 8, "1. at least 8 bouts parsed for %s (%d)" % (EVENT, nb))
print("1. %s (%s): %d bouts parsed, per-round sums match an independent parse" % (EVENT, DATE, nb))

# ---------------------------------------------------------------- 2. match_stats rules
(d0, a0, b0), rec0 = sorted(GS.items(), key=lambda kv: -max(len(v) for v in kv[1]["fighters"].values()))[0]
names = {}
for k in indep:
    if FL.norm_name(k[1]) in rec0["fighters"]:
        names[FL.norm_name(k[1])] = k[1]
fa, fb = sorted(rec0["fighters"])
R = max(rec0["fighters"][fa])
sl_block = {"a": {}, "b": {}}


def doc_for(swap=False, bouts_extra=()):
    A, B = (names[fb], names[fa]) if swap else (names[fa], names[fb])
    return {"date": DATE, "event": EVENT, "bouts": [{"bout_id": "t:1", "a": {"name": A, "slug": None}, "b": {"name": B, "slug": None},
                                                    "statlines": sl_block}] + list(bouts_extra)}


def res(**kw):
    r = {"bout_id": "t:1", "outcome": "win", "winner": "a", "round": R, "verified": True}
    r.update(kw)
    return [r]


got = FL.match_stats(doc_for(), GS, set(), res())
ok(len(got) == 1, "2. verified win with full coverage is recorded")
if got:
    for st in FL.STAT_KEYS:
        ref_a = indep[[k for k in indep if FL.norm_name(k[1]) == fa][0]][st]
        ok(got[0]["a"][st] == ref_a, "2. a %s = the per-round total" % st)
    ok(got[0]["rounds"] == R and got[0]["a"]["ufcstats_name"] == fa, "2. rounds and the matched ufcstats name are recorded")
sw = FL.match_stats(doc_for(swap=True), GS, set(), res())
ok(len(sw) == 1 and sw[0]["a"]["ufcstats_name"] == fb and sw[0]["b"]["sig_lnd"] == got[0]["a"]["sig_lnd"], "2. swapped orientation matches by name")
ok(not FL.match_stats(doc_for(), GS, set(), res(verified=False)), "2. unverified result: not recorded")
ok(not FL.match_stats(doc_for(), GS, set(), res(outcome="nc", winner=None)), "2. no contest: not recorded")
ok(len(FL.match_stats(doc_for(), GS, set(), res(outcome="draw", winner=None))) == 1, "2. draw: recorded")
ok(not FL.match_stats(doc_for(), GS, set(), res(round=R + 1)), "2. rows missing for a round through the result's round: not recorded")
ok(not FL.match_stats(doc_for(), GS, {"t:1"}, res()), "2. already recorded: skipped (append-only)")
if R >= 2:
    part = FL.match_stats(doc_for(), GS, set(), res(round=R - 1))
    rows_a = rec0["fighters"][fa]
    ok(part and part[0]["a"]["sig_lnd"] == sum(rows_a[k]["sig_lnd"] for k in range(1, R)), "2. sums only through the result's round")
nostat = doc_for()
nostat["bouts"][0].pop("statlines")
ok(not FL.match_stats(nostat, GS, set(), res()), "2. a bout without a stat-line block (fwd-4.1) is never fetched")
print("2. match_stats: %s vs %s, %d rounds" % (names[fa], names[fb], R))

# ---------------------------------------------------------------- 3. compute_scores against hand computations
pm1 = {"a_ko": 0.2, "a_sub": 0.1, "a_dec": 0.294, "draw": 0.01, "b_dec": 0.2, "b_sub": 0.096, "b_ko": 0.1}
pm1s = {"a_ko": 0.25, "a_sub": 0.1, "a_dec": 0.244, "draw": 0.01, "b_dec": 0.2, "b_sub": 0.1, "b_ko": 0.096}
pm2 = {"a_ko": 0.15, "a_sub": 0.05, "a_dec": 0.25, "draw": 0.01, "b_dec": 0.3, "b_sub": 0.09, "b_ko": 0.15}
fc = lambda m, p10, p50, p90, bl: {"mean": m, "p10": p10, "p50": p50, "p90": p90, "blend_mean": bl}
SL2 = {"stats": list(FL.STAT_KEYS),
       "a": {st: fc(40.0, 20, 38, 60, 45.0) for st in FL.STAT_KEYS},
       "b": {st: fc(3.0, 0, 2, 6, 2.0) for st in FL.STAT_KEYS}}
V42, V41 = "fwd-4.2: test", "fwd-4.1: test"
doc42 = {"event": "Test", "date": "2026-12-30", "model": {"version": V42}, "bouts": [
    {"bout_id": "x:debut", "p_a": 0.6, "p_a_noline": 0.6, "p_elo": 0.55, "market": None, "models": {"elo": 0.55, "debut_model": 0.58},
     "p_method": pm1, "p_distance": 0.504, "p_method_secondary": {"division_base_rates": {"p_method": pm1s, "p_distance": 0.454}},
     "statlines": SL2, "flags": ["debut_b"]},
    {"bout_id": "x:vet", "p_a": 0.4, "p_a_noline": 0.45, "p_elo": 0.5, "market": None, "models": {"elo": 0.5, "debut_model": None},
     "p_method": pm2, "p_distance": 0.56, "statlines": SL2, "flags": []},
    {"bout_id": "x:draw", "p_a": 0.5, "p_a_noline": 0.5, "p_elo": 0.5, "market": None, "models": {}, "p_method": pm2,
     "p_distance": 0.56, "statlines": SL2, "flags": []}]}
doc41 = {"event": "Old", "date": "2026-11-07", "model": {"version": V41}, "bouts": [
    {"bout_id": "y:debut", "p_a": 0.3, "p_a_noline": 0.3, "p_elo": 0.3, "market": None, "models": {}, "p_method": pm1,
     "p_distance": 0.5, "flags": ["debut_a"]}]}
results = [{"bout_id": "x:debut", "outcome": "win", "winner": "a", "method": "KO/TKO", "round": 1, "verified": True},
           {"bout_id": "x:vet", "outcome": "win", "winner": "b", "method": "Decision - Unanimous", "round": 3, "verified": True},
           {"bout_id": "x:draw", "outcome": "draw", "winner": None, "method": "Decision - Split", "round": 3, "verified": True},
           {"bout_id": "y:debut", "outcome": "win", "winner": "b", "method": "SUB", "round": 2, "verified": True}]
ya = {"sig_lnd": 50, "sig_att": 61, "td_lnd": 0, "td_att": 19, "ctrl": 40, "kd": 1, "sub_att": 2}
yb = {"sig_lnd": 3, "sig_att": 0, "td_lnd": 7, "td_att": 1, "ctrl": 2, "kd": 0, "sub_att": None}
stats = [{"bout_id": "x:vet", "a": ya, "b": yb}, {"bout_id": "x:draw", "a": ya, "b": yb},
         {"bout_id": "y:debut", "a": ya, "b": yb}]
files = [("a.json", None, doc42, None), ("b.json", None, doc41, None)]
S = FL.compute_scores(files, results, 300, stats)
md = S["method_debut"]
ok(list(md) == [V42], "3. method_debut only for the fwd-4.2 version (fwd-4.1 debut bout ignored)")
o = md[V42]
ok(o["n"] == 1, "3. one decisive debut bout")
ok(near(o["primary"]["log_loss_7way"], -math.log(0.2)) and near(o["base_rates"]["log_loss_7way"], -math.log(0.25)), "3. 7-way log loss")
ok(near(o["primary"]["log_loss_given_winner"], -math.log(0.2 / 0.594)) and
   near(o["base_rates"]["log_loss_given_winner"], -math.log(0.25 / 0.594)), "3. method given the winner")
ok(near(o["primary"]["log_loss_method3"], -math.log(0.3 / 0.99)) and near(o["base_rates"]["log_loss_method3"], -math.log(0.346 / 0.99)),
   "3. marginal KO / SUB / DEC")
ok(near(o["primary"]["distance_brier"], 0.504 ** 2) and near(o["base_rates"]["distance_brier"], 0.454 ** 2), "3. distance Brier")
sl = S["statlines"]
ok(list(sl) == [V42], "3. statlines only for the fwd-4.2 version")
v = sl[V42]
ok(v["sig_lnd"]["n"] == 4 and v["sig_lnd"]["n_bouts"] == 2, "3. stat lines: vet + draw bouts, 2 sides each (debut bout has no stats record)")
ok(v["sub_att"]["n"] == 2, "3. a missing actual (None) is skipped")
pd = lambda y, m: 2 * ((y * math.log(y / m) if y > 0 else 0) - (y - m))
ok(near(v["sig_lnd"]["deviance_mean"], (2 * pd(50, 40) + 2 * pd(3, 3)) / 4) and
   near(v["sig_lnd"]["deviance_blend_mean"], (2 * pd(50, 45) + 2 * pd(3, 2)) / 4), "3. Poisson deviance of the mean and of the blend mean")
ok(near(v["td_lnd"]["deviance_mean"], (2 * pd(0, 40) + 2 * pd(7, 3)) / 4), "3. deviance with y = 0")
ok(near(v["sig_lnd"]["coverage_p10_p90"], 1.0) and near(v["sig_att"]["coverage_p10_p90"], 0.5) and near(v["sig_att"]["below_p10"], 0.0)
   and near(v["td_att"]["below_p10"], 0.5) and near(v["td_lnd"]["below_p10"], 0.5) and near(v["td_lnd"]["above_p90"], 0.5),
   "3. band coverage, above p90, below p10 (inclusive band)")
ok(near(v["sig_lnd"]["mae_p50"], (12 + 1) / 2), "3. MAE of p50")
ok(S["n_scored"] == 3 and S["n_void"] == 1, "3. the draw stays void for the winner metrics")
ok(S["models"][V42].get("debut_model", {}).get("n") == 1, "3. models.debut_model scored like any models entry")
S41 = FL.compute_scores([("b.json", None, doc41, None)], results, 300, stats)
ok("method_debut" not in S41 and "statlines" not in S41, "3. a fwd-4.1-only ledger gets neither new block")
print("3. compute_scores: debut method and stat-line metrics match hand computations")

# ---------------------------------------------------------------- 4. score --no-fetch end to end
with tempfile.TemporaryDirectory() as tdir:
    doc = dict(doc42, created_utc="2026-11-07T00:00:00Z", lock_utc="2099-12-30T22:00:00Z", event="UFC Test Night: v42")
    with open(os.path.join(tdir, "2026-12-30_ufc-test-night-v42.json"), "w") as fh:
        json.dump(doc, fh)
    with open(os.path.join(tdir, "results.json"), "w") as fh:
        json.dump({"results": results[:3]}, fh)
    with open(os.path.join(tdir, "statlines_results.json"), "w") as fh:
        json.dump({"results": stats[:2]}, fh)
    r = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "forward_ledger.py"), "score", "--no-fetch", "--dir", tdir,
                        "--boot", "200"], capture_output=True, text=True, cwd=ROOT)
    ok(r.returncode == 0, "4. score --no-fetch runs (%s)" % r.stderr[-300:])
    sj = json.load(open(os.path.join(tdir, "scores.json")))
    smd = open(os.path.join(tdir, "scores.md")).read()
    ok("method_debut" in sj and "statlines" in sj and sj.get("n_statline_bouts") == 2, "4. scores.json has the fwd-4.2 blocks")
    ok("Debut method model vs division base rates" in smd and "Stat lines, fwd-4.2" in smd, "4. scores.md has the fwd-4.2 tables")
    ok(json.load(open(os.path.join(tdir, "statlines_results.json")))["results"] == stats[:2], "4. statlines_results.json untouched without a fetch")
print("4. score --no-fetch: scores.json / scores.md carry the fwd-4.2 sections")

# ---------------------------------------------------------------- 5. stat-line CI: the bout-level bootstrap resamples bouts
# README "Forward model v4.2": the stat-line deviance difference uses the event-cluster bootstrap widened to the bout-level
# one. Rows are fight-sides, so a bout's two sides must move together: with one bout on one card both levels collapse to
# the estimate (resampling fight-sides instead would give a non-degenerate interval).
row = lambda side, y, mu: {"version": "fwd-4.2: t", "date": "2026-11-14", "bout_id": "2026-11-14:x__y", "side": side,
                           "stat": "sig_lnd", "y": y, "mean": mu, "blend_mean": 30.0, "p10": 0, "p50": 30, "p90": 80}
c1 = FL.score_statlines([row("a", 10.0, 20.0), row("b", 60.0, 40.0)], 400)["fwd-4.2: t"]["sig_lnd"]["deviance_minus_blend"]
ok(c1["lo_bout"] == c1["hi_bout"] == c1["est"] and c1["lo"] == c1["hi"] == c1["est"],
   "5. one bout: the bout-level stat-line interval collapses to the estimate (%r)" % c1)
two = [row("a", 10.0, 20.0), row("b", 60.0, 40.0)] + [dict(r, bout_id="2026-11-14:u__v") for r in (row("a", 5.0, 25.0), row("b", 70.0, 35.0))]
c2 = FL.score_statlines(two, 400)["fwd-4.2: t"]["sig_lnd"]["deviance_minus_blend"]
ok(c2["lo_bout"] < c2["hi_bout"], "5. two bouts: the bout-level interval is non-degenerate (%r)" % c2)
ok(FL.boot_ci([1.0, -2.0, 0.5], ["e1", "e1", "e2"], 300) == FL.boot_ci([1.0, -2.0, 0.5], ["e1", "e1", "e2"], 300, units=None),
   "5. boot_ci default (one value per bout) is unchanged for every other caller")
print("5. stat-line CI: the bout-level bootstrap resamples bouts, not fight-sides")

print(("FAILED %d of %d checks" % (len(FAILS), CHECKS[0])) if FAILS else ("ok %d/%d checks" % (CHECKS[0], CHECKS[0])))
sys.exit(1 if FAILS else 0)
