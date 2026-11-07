#!/usr/bin/env python3
"""tests/test_live_refresh.py: tools/live_refresh.py (forward model v4.4 live inputs, data/predictions/README.md).

    python3 tests/test_live_refresh.py            (about 90 s: two builds of the live set)
    python3 tests/test_live_refresh.py --quick    (skips parts 6 and 7, the builds)

1. Market continuation = tools/market.py run_rating. A synthetic stream (fighters, dates, closing lines with gaps, draws,
   no contests, variance caps) is filtered in one pass and, separately, filtered to a cut date, stored the way market.json
   stores it (mu and sd drifted to the snapshot, 4 decimals), and continued by live_refresh.market_continue. The two agree
   to the stored rounding (exactly, up to rounding ties, when the stored state is unrounded).
2. Two-source rule on a real dev-period card (UFC Fight Night: Royval vs. Kape, Dec 13 2025; data/raw CSVs and the ESPN
   fixture): all 12 bouts pass, including a draw and reversed corner orders; a changed winner, round or finish class, a
   missing stats round, a bout missing on ESPN and an unavailable scoreboard are held out (or stop the cutoff).
3. Filtered CSV copies: byte copies when nothing is dropped; events after as_of and held-out bouts are removed. Pinned
   period (verifier fix): rows of events up to 2026-10-31 come from the pinned CSVs even when the fetched copy rewrote
   them, later events from the fetched copy; the rewrites are counted. The finish-vs-decision rule also covers a draw.
3b. Odds: the closing proxy is the last capture before the bout's start; post-start captures and pre_start captures made
   after the latest start_utc are never used.
4. Guards and check_live: the frozen part of each live file equals the pinned file's; check_live passes on a good live
   folder and fails (fallback) on a missing manifest, a changed live file, a changed frozen key, a build after the lock,
   an as_of before 2026-10-31 and a failed status.
5. Constants: live_refresh's fwd-4.3 pins equal tools/forward_ledger.py's; the frozen set excludes exactly the live set.
6. Zero-diff rule: `regress` at cutoff 2026-10-31 reproduces every live file byte for byte.
7. Integration on a SYNTHETIC post-snapshot card (a temporary copy of the Oct 31 CSVs plus a made-up Nov 7 event that
   repeats the Oct 31 card; never written outside a temp folder): as_of moves to Nov 7, every participant's record and
   market rating move, non-participants keep their Elo and profile sums, and every guard holds.
"""
import copy
import csv
import datetime as dt
import json
import math
import os
import random
import shutil
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import live_refresh as LR  # noqa: E402
import forward_ledger as FL  # noqa: E402
import market as MK  # noqa: E402

QUICK = "--quick" in sys.argv
fails = checks = 0


def ok(c, msg):
    global fails, checks
    checks += 1
    if not c:
        fails += 1
        print("FAIL", msg)


# ---------------------------------------------------------------- 1. market continuation
def part1():
    P = {"sig_m": 0.5, "tau_per_year": 0.5, "v0": 1.5, "mu0": 0.0, "kappa_result": 1.5}
    rng = random.Random(7)
    ids = ["f%02d" % i for i in range(40)]
    stream, d = [], dt.date(2021, 1, 1)
    for k in range(700):
        d += dt.timedelta(days=rng.choice([0, 0, 3, 7, 14]))
        i, j = rng.sample(ids[:30] if k < 600 else ids, 2)          # ten newcomers appear after the cut
        p = None if rng.random() < 0.15 else rng.uniform(0.1, 0.9)
        y = rng.choice([1.0, 1.0, 0.0, 0.0, 0.5, None])
        stream.append({"id": "x%04d" % k, "date": d.isoformat(), "i": i, "j": j, "p": p, "y": y})
    cut = stream[599]["date"]
    end = (dt.date.fromisoformat(stream[-1]["date"]) + dt.timedelta(days=9)).isoformat()
    args = (P["sig_m"], P["tau_per_year"], P["v0"], 0.0, P["kappa_result"])
    _, full = MK.run_rating(stream, *args)
    _, st1 = MK.run_rating([e for e in stream if e["date"] <= cut], *args)
    cutd = dt.date.fromisoformat(cut)
    tau, v0 = P["tau_per_year"], P["v0"]

    def stored(state, at, rnd):
        out = {}
        for f, (m, v, ld, n) in state.items():
            sd = math.sqrt(min(v + tau * tau * (at - dt.date.fromisoformat(ld)).days / 365.25, 2 * v0))
            out[f] = [round(m, 4) if rnd else m, round(sd, 4) if rnd else sd, ld, n]
        return out
    expect = stored(full, dt.date.fromisoformat(end), True)
    new = [{"fid": e["id"], "date": e["date"], "A": e["i"], "B": e["j"], "amb": False, "prior_a": 1, "prior_b": 1,
            "winner": {1.0: "A", 0.0: "B", 0.5: "D"}.get(e["y"], "NC"), "bout": e["id"]}
           for e in stream if e["date"] > cut]
    lines = {e["id"]: e["p"] for e in stream}
    for rnd, tol in ((True, 3e-4), (False, 1.01e-4)):
        pinned = {"eval": {"market_rating": {"params": P, "live_snapshot_stream_to": cut}}, "ratings": stored(st1, cutd, rnd)}
        got, info = LR.market_continue(pinned, new, end, lambda e: (lines[e["fid"]], {"snapshot": "t"}) if lines[e["fid"]] is not None else (None, None))
        ok(set(got) == set(expect), "1. same fighters (%s stored state)" % ("rounded" if rnd else "unrounded"))
        dm = max(abs(got[f][0] - expect[f][0]) for f in expect)
        ds = max(abs(got[f][1] - expect[f][1]) for f in expect)
        ok(dm <= tol and ds <= tol, "1. mu / sd match run_rating within %g (max %g / %g, %s)" % (tol, dm, ds, "rounded" if rnd else "unrounded"))
        ok(all(got[f][2:] == expect[f][2:] for f in expect), "1. last fight date and n exact")
        ok(len(info["restarted"]) == len([f for f in expect if f not in st1]), "1. newcomers start at (mu0, v0)")
        print("1. market continuation vs run_rating (%s stored state): max |d mu| %.1e, max |d sd| %.1e over %d fighters, %d updates"
              % ("rounded" if rnd else "unrounded", dm, ds, len(expect), len(info["updates"])))
    # no new bout and as_of = the stored snapshot: the stored block, unchanged
    pinned = {"eval": {"market_rating": {"params": P, "live_snapshot_stream_to": cut}}, "ratings": stored(st1, cutd, True)}
    got, _ = LR.market_continue(pinned, [], cut, lambda e: (None, None))
    ok(got == pinned["ratings"], "1. no new bout at the stored snapshot: ratings unchanged")
    # debut and ambiguous bouts stay out of the stream (market.py's post-nlbair rule)
    nb = [dict(new[0], prior_a=0), dict(new[1], amb=True)]
    got, info = LR.market_continue(pinned, nb, end, lambda e: (None, None))
    ok(len(info["updates"]) == 0 and len(info["not_in_stream"]) == 2, "1. debut / ambiguous bouts are not market updates")


# ---------------------------------------------------------------- 2. two-source rule
def part2():
    fx = json.load(open(os.path.join(ROOT, "tests", "fixtures", "live_espn_20251213.json")))
    comps = LR.parse_espn(fx["pages"]["20251213"], "2025-12-13") + LR.parse_espn(fx["pages"]["20251214"], "2025-12-14")
    raw = os.path.join(ROOT, "data", "raw")
    as_of, kept, held, log = LR.verify_new(raw, "2025-12-13", None, {"2025-12-13": comps}, after="2025-12-12")
    ok(as_of == "2025-12-13" and len(kept) == 12 and not held, "2. all 12 Royval vs. Kape bouts pass (%d kept, %d held)" % (len(kept), len(held)))
    ok(any(b["outcome"] == "D/D" for b in kept), "2. the draw passes (no winner on either source)")
    print("2. two-source rule: 12 of 12 bouts of Dec 13, 2025 pass")

    def run(cs, stats=None):
        sr = stats if stats is not None else LR.greco_stat_rounds(raw, {"UFC Fight Night: Royval vs. Kape"})
        bouts = LR.greco_new_bouts(raw, "2025-12-12", "2025-12-13")
        return {b["bout"]: LR.two_source(b, cs, sr) for b in bouts}
    t = copy.deepcopy(comps)
    for c in t:
        if "manel kape" in c["names"]:
            c["winner"] = [not w for w in c["winner"]]
        if "giga chikadze" in c["names"]:
            c["period"] = 3
        if "cesar almeida" in c["names"]:
            c["clock"] = "2:10"
        if "jamey lyn horth" in c["names"]:
            c["names"] = ["someone else", "another one"]
    r = run(t)
    ok((r["Brandon Royval vs. Manel Kape"] or "").startswith("winner differs"), "2. changed winner is held out")
    ok((r["Giga Chikadze vs. Kevin Vallejos"] or "").startswith("final round differs"), "2. changed round is held out")
    ok((r["Cesar Almeida vs. Cezary Oleksiejczuk"] or "").startswith("finish vs decision"), "2. changed finish class is held out")
    ok((r["Jamey-Lyn Horth vs. Tereza Bleda"] or "").startswith("not listed"), "2. a bout missing on ESPN is held out")
    ok(sum(v is None for v in r.values()) == 8, "2. the other 8 bouts still pass")
    t2 = copy.deepcopy(comps)
    for c in t2:
        if "kennedy nzechukwu" in c["names"]:                     # the draw (no winner on either source)
            c["clock"] = "2:10"
    ok((run(t2)["Kennedy Nzechukwu vs. Marcus Buchecha"] or "").startswith("finish vs decision"),
       "2. a draw whose finish class differs is held out (the rule covers draws and no contests too)")
    sr = LR.greco_stat_rounds(raw, {"UFC Fight Night: Royval vs. Kape"})
    for k in sr:
        if k[1] == "Sean Sharaf vs. Steven Asplund":
            sr[k]["Sean Sharaf"].discard(2)
    ok((run(comps, sr)["Sean Sharaf vs. Steven Asplund"] or "").startswith("ufcstats per-round stats incomplete"),
       "2. a missing stats round is held out")
    as_of, kept, held, log = LR.verify_new(raw, "2025-12-13", None, {}, after="2025-12-12")
    ok(as_of == "2025-12-12" and not kept and len(held) == 12 and log[0]["status"].startswith("stopped"),
       "2. no scoreboard: the cutoff stops before the event")


# ---------------------------------------------------------------- 3. filtered copies
def part3(tmp):
    raw = os.path.join(ROOT, "data", "raw")
    d1 = os.path.join(tmp, "f1")
    c = LR.write_filtered_raw(raw, d1, "2026-10-31", [])
    ok(all(v == 0 for v in c.values()) and all(open(os.path.join(raw, f), "rb").read() == open(os.path.join(d1, f), "rb").read()
                                               for f in LR.GRECO_FILES), "3. nothing dropped: byte copies")
    d2 = os.path.join(tmp, "f2")
    held = [{"event": "UFC Fight Night: Royval vs. Kape", "bout": "Brandon Royval vs. Manel Kape"}]
    c = LR.write_filtered_raw(raw, d2, "2026-10-24", held)
    ev = LR.event_dates(d2)
    ok(max(ev.values()) <= "2026-10-24" and c["ufc_fight_results.csv"] >= 13, "3. events after as_of dropped (%s)" % c)
    rows = list(csv.DictReader(open(os.path.join(d2, "ufc_fight_results.csv"))))
    ok(not any(r["BOUT"].strip() == "Brandon Royval vs. Manel Kape" for r in rows), "3. held-out bout dropped")
    ok(sum(r["EVENT"].strip() == "UFC Fight Night: Royval vs. Kape" for r in rows) == 11, "3. the rest of its card kept")
    print("3. filtered CSV copies: byte copies when nothing drops; late events and held-out bouts removed")
    # pinned period (README v4.4 section 2): an upstream copy that rewrites one Oct 31 stats row and adds a later event
    up = os.path.join(tmp, "upstream")
    os.makedirs(up)
    new_ev = "SYNTHETIC LATER EVENT (not a real card)"
    for f in LR.GRECO_FILES:
        h, rows = LR.read_csv_rows(os.path.join(raw, f))
        add = []
        if f == "ufc_event_details.csv":
            r2 = list(rows[0])
            r2[h.index("EVENT")], r2[h.index("DATE")] = new_ev, "November 07, 2026"
            add = [r2]
        elif f == "ufc_fight_results.csv":
            r2 = list(rows[0])
            r2[h.index("EVENT")] = new_ev
            add = [r2]
        if f == "ufc_fight_stats.csv":
            rows[0] = list(rows[0])
            rows[0][h.index("SIG.STR.")] = "999 of 999"            # an upstream rewrite of a pinned-period row
        with open(os.path.join(up, f), "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh, lineterminator="\n")
            w.writerow(h)
            w.writerows(add + rows)
    mg = os.path.join(tmp, "merged")
    mi = LR.merge_pinned(up, raw, mg)
    st = list(csv.DictReader(open(os.path.join(mg, "ufc_fight_stats.csv"), newline="", encoding="utf-8")))
    ok(not any(r["SIG.STR."] == "999 of 999" for r in st) and open(os.path.join(mg, "ufc_fight_stats.csv"), "rb").read()
       == open(os.path.join(raw, "ufc_fight_stats.csv"), "rb").read(), "3. merge: a rewritten pinned-period row is the pinned row")
    ok(mi["ufc_fight_stats.csv"] == {"later_event_rows": 0, "pinned_period_rows_only_upstream": 1, "pinned_period_rows_only_pinned": 1},
       "3. merge: the rewrite is counted (%s)" % mi["ufc_fight_stats.csv"])
    rs = LR.read_csv_rows(os.path.join(mg, "ufc_fight_results.csv"))[1]
    ok(rs[0][0].strip() == new_ev and rs[1:] == LR.read_csv_rows(os.path.join(raw, "ufc_fight_results.csv"))[1]
       and mi["ufc_fight_results.csv"]["later_event_rows"] == 1, "3. merge: later-event rows first, then the pinned rows")
    ok(LR.event_dates(mg)[new_ev] == "2026-11-07", "3. merge: the later event keeps its date")
    print("3. pinned period: rows of events up to %s come from the pinned CSVs; upstream rewrites are counted" % LR.PIN_SNAPSHOT)


# ---------------------------------------------------------------- 3b. odds: pre-fight captures only
def part3b(tmp):
    T = {"bouts": [{"date": "2026-11-07", "A": "X One", "B": "Y Two", "A_slug": "x-one", "B_slug": "y-two",
                    "start_utc": "2026-11-07T22:00:00Z", "bout_id": "b1",
                    "captures": [{"t": "2026-11-06T10:00:00Z", "phase": "pre_start", "bfo_p_a_novig": 0.60},
                                 {"t": "2026-11-07T21:00:00Z", "phase": "pre_start", "bfo_p_a_novig": 0.62},
                                 {"t": "2026-11-07T22:30:00Z", "phase": "pre_start", "bfo_p_a_novig": 0.90},
                                 {"t": "2026-11-08T09:00:00Z", "phase": "post_start", "bfo_p_a_novig": 0.99},
                                 {"t": "2026-11-07T21:30:00Z", "phase": "pre_start", "bfo_p_a_novig": None}]},
                   {"date": "2026-11-07", "A": "Z Three", "B": "W Four", "A_slug": "z-three", "B_slug": "w-four",
                    "start_utc": "2026-11-07T22:00:00Z", "bout_id": "b2",
                    "captures": [{"t": "2026-11-07T23:00:00Z", "phase": "pre_start", "bfo_p_a_novig": 0.5}]}]}
    p = os.path.join(tmp, "timeline.json")
    json.dump(T, open(p, "w"))
    L = {x["bout_id"]: x for x in LR.odds_close_lines(p)}
    ok(set(L) == {"b1"} and L["b1"]["p_a"] == 0.62 and L["b1"]["captured_utc"] == "2026-11-07T21:00:00Z",
       "3b. odds: the last capture before the bout's start; captures at or after it (even marked pre_start) never used")
    print("3b. odds: closing proxy = last capture before the start (post-start and late pre_start captures excluded)")


# ---------------------------------------------------------------- 4. guards and check_live
def part4(tmp):
    live = LR.LIVE_DIR
    if not os.path.exists(os.path.join(live, "manifest.json")):
        print("SKIP 4 (no data/derived/live)")
        return
    for name, spec in LR.LIVE.items():
        L, P = LR.jload(os.path.join(live, spec["file"])), LR.jload(os.path.join(ROOT, spec["pinned"]))
        ok(LR.frozen_sha(L, spec["paths"]) == LR.frozen_sha(P, spec["paths"]), "4. %s: frozen part equals the pinned file" % name)
    g, _, info = LR.check_live(live, dt.datetime(2026, 11, 14, 22, tzinfo=dt.timezone.utc))
    ok(g, "4. check_live passes on data/derived/live (%s)" % _)

    def variant(tag, fn):
        d = os.path.join(tmp, "live_" + tag)
        shutil.copytree(live, d)
        fn(d)
        return LR.check_live(d, dt.datetime(2026, 11, 14, 22, tzinfo=dt.timezone.utc))

    def rewrite_manifest(d, f):
        M = LR.jload(os.path.join(d, "manifest.json"))
        f(M)
        open(os.path.join(d, "manifest.json"), "w").write(json.dumps(M))

    def bad_frozen(d):
        p = os.path.join(d, "ml2_live.json")
        J = LR.jload(p)
        J["page_model"]["terms"][0]["coef"] = J["page_model"]["terms"][0].get("coef", 0) + 0.1
        open(p, "w").write(LR.dumps_compact(J))
        rewrite_manifest(d, lambda M: M["files"]["ml2"].update(sha256=LR.sha256_file(p)))

    def bad_live_bytes(d):
        p = os.path.join(d, "market_live.json")
        J = LR.jload(p)
        k = next(iter(J["ratings"]))
        J["ratings"][k][0] += 0.5
        open(p, "w").write(LR.dumps_compact(J))
    cases = {"no manifest": lambda d: os.remove(os.path.join(d, "manifest.json")),
             "missing file": lambda d: os.remove(os.path.join(d, "ratings_live.json")),
             "sha differs": bad_live_bytes,
             "frozen key": bad_frozen,
             "as_of early": lambda d: rewrite_manifest(d, lambda M: M.update(as_of="2026-10-24")),
             "status failed": lambda d: rewrite_manifest(d, lambda M: M["files"]["ml"].update(status="failed")),
             "no zero-diff": lambda d: rewrite_manifest(d, lambda M: M.update(zero_diff=None)),
             "built after lock": lambda d: rewrite_manifest(d, lambda M: M.update(built_utc="2026-11-14T22:00:00Z"))}
    for tag, fn in cases.items():
        g, why, _ = variant(tag.replace(" ", "_"), fn)
        ok(not g and why, "4. check_live fails on: %s (%s)" % (tag, why))
    # a live (not frozen) change with a matching manifest passes: the live part is what a refresh changes
    def live_change(d):
        p = os.path.join(d, "market_live.json")
        bad_live_bytes(d)
        rewrite_manifest(d, lambda M: M["files"]["market"].update(sha256=LR.sha256_file(p)))
    g, why, _ = variant("live_change", live_change)
    ok(g, "4. a changed live part with a matching manifest passes (%s)" % why)
    print("4. guards: frozen parts equal the pinned files; check_live passes, and fails on %d tampered variants" % len(cases))


# ---------------------------------------------------------------- 5. constants
def part5():
    ok(LR.FWD43_PINNED == FL.FWD43_PINNED, "5. live_refresh FWD43_PINNED = forward_ledger FWD43_PINNED")
    ok(set(LR.FROZEN) == set(LR.FWD43_PINNED) - {v["pinned"] for v in LR.LIVE.values()}, "5. frozen set = pins minus the live set")
    ok("data/derived/oppadj.json" in LR.FROZEN and "data/derived/embed_model.json" in LR.FROZEN
       and "data/derived/debut.json" in LR.FROZEN, "5. oppadj, embed_model and debut stay frozen in 1.0")
    ok(FL.fwd_for_date("2026-11-14") == "4.4" and FL.fwd_for_date("2026-11-13") == "4.1", "5. --fwd auto: 4.4 from 2026-11-14")


# ---------------------------------------------------------------- 6. zero-diff rule
def part6(tmp):
    res = LR.regress(os.path.join(LR.WORK_ROOT, "test_regress"), quiet=True)
    for name, r in res["files"].items():
        ok(r["identical_bytes"], "6. zero-diff: %s reproduces the pinned file byte for byte" % name)
    ok(all(res["guards"].values()), "6. guards hold at the pinned cutoff")
    print("6. zero-diff rule at cutoff 2026-10-31: %s (%.0f s)" % ("every live file byte-identical" if res["ok"] else "FAILS", res["seconds"]))


# ---------------------------------------------------------------- 7. integration on a synthetic post-snapshot card
def part7(tmp):
    raw = os.path.join(ROOT, "data", "raw")
    syn = os.path.join(tmp, "raw_synthetic")
    os.makedirs(syn)
    src_ev, new_ev, new_date = "UFC Fight Night: Moicano vs. Nolan", "SYNTHETIC TEST EVENT (not a real card)", "November 07, 2026"
    for f in LR.GRECO_FILES:
        h, rows = LR.read_csv_rows(os.path.join(raw, f))
        add = []
        if "EVENT" in h:
            ie = h.index("EVENT")
            for r in rows:
                if r[ie].strip() == src_ev:
                    r2 = list(r)
                    r2[ie] = new_ev
                    if "DATE" in h:
                        r2[h.index("DATE")] = new_date
                    if "URL" in h:
                        r2[h.index("URL")] = r[h.index("URL")].rstrip("/") + "synthetic"
                    add.append(r2)
        with open(os.path.join(syn, f), "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh, lineterminator="\n")
            w.writerow(h)
            w.writerows(add + rows)                       # Greco files are newest first
    bouts = LR.greco_new_bouts(syn, LR.PIN_SNAPSHOT, "2026-11-07")
    comps = []
    for b in bouts:                                       # a scoreboard that agrees (synthetic second source)
        win = {"W/L": [True, False], "L/W": [False, True]}.get(b["outcome"], [False, False])
        dec = "decision" in b["method"].lower()
        comps.append({"event": new_ev, "names": [FL.norm_name(n) for n in b["names"]], "winner": win, "completed": True,
                      "period": int(b["round"]), "clock": "5:00" if dec else "2:00", "rounds": 5 if "5 Rnd" in b["format"] else 3})
    work = os.path.join(LR.WORK_ROOT, "test_integration")
    if os.path.exists(work):
        shutil.rmtree(work)
    info, paths = LR.build_set(syn, "2026-11-07", work, offline_espn={"2026-11-07": comps}, timeline=os.path.join(tmp, "none.json"))
    ok(info["as_of"] == "2026-11-07" and len(info["bouts_added"]) == len(bouts) > 0, "7. as_of moves to the synthetic card (%d bouts)" % len(bouts))
    ok(all(info["guards"].values()), "7. every guard holds: %s" % info["guards"])
    F0 = LR.jload(os.path.join(ROOT, "data", "derived", "fighters.json"))
    F1 = LR.jload(paths["fighters"])
    ok(F1["meta"]["snapshot"] == "2026-11-07" and F1["meta"]["n_fights"] == F0["meta"]["n_fights"] + len(bouts), "7. fighters snapshot and fight count")
    side = LR.jload(os.path.join(work, "steps", "fighters_side.json"))
    part = {s for b in side["new_bouts"] for s in (b["A"], b["B"]) if s}
    ok(all(F1["fighters"][s]["n_fights"] == F0["fighters"][s]["n_fights"] + 1 for s in part if s in F0["fighters"]),
       "7. every participant has one more fight")
    others = [s for s in F0["fighters"] if s not in part]
    ok(all(F1["fighters"][s]["elo"] == F0["fighters"][s]["elo"] and F1["fighters"][s]["C"] == F0["fighters"][s]["C"] for s in others),
       "7. non-participants keep their Elo and career sums")
    M0 = LR.jload(os.path.join(ROOT, "data", "derived", "market.json"))["ratings"]
    M1 = LR.jload(paths["market"])["ratings"]
    upd = {u["A"] for u in info["market"]["updates"]} | {u["B"] for u in info["market"]["updates"]}
    ok(upd and all(M1[s][3] == M0[s][3] + 1 and M1[s][2] == "2026-11-07" for s in upd if s in M0), "7. market: participants updated")
    ok(all(M1[s][0] == M0[s][0] and M1[s][1] >= M0[s][1] for s in M0 if s not in upd), "7. market: others keep mu, sd drifts up")
    ok(all(u["update"].startswith("result only") for u in info["market"]["updates"]), "7. market: no pre-fight capture -> result-only updates")
    R1 = LR.jload(paths["ratings"])["roster"]
    ok(sum(1 for s in part if s in R1 and R1[s]["glicko2"] != LR.jload(os.path.join(ROOT, "data/derived/ratings.json"))["roster"][s]["glicko2"]) == len(part & set(R1)),
       "7. ratings: every participant's glicko2 moved")
    ok(LR.jload(paths["ml2"])["page_model"]["snapshot"] == "2026-11-07" and LR.jload(paths["ml"])["page_model"]["snapshot"] == "2026-11-07",
       "7. ml / ml2 snapshots = as_of")
    print("7. integration (synthetic Nov 7 card, %d bouts): as_of 2026-11-07, %d participants changed, guards hold (%.0f s)"
          % (len(bouts), len(part), info["seconds"]))


def main():
    tmp = tempfile.mkdtemp(prefix="live_refresh_test_")
    part1()
    part2()
    part3(tmp)
    part3b(tmp)
    part4(tmp)
    part5()
    if not QUICK:
        part6(tmp)
        part7(tmp)
    shutil.rmtree(tmp, ignore_errors=True)
    print("%d checks, %d failures" % (checks, fails))
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
