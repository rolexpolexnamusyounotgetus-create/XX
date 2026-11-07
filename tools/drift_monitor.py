#!/usr/bin/env python3
"""drift_monitor.py: the forward-ledger drift monitor of engine cycle 4 (docs/V6_V10_PLAN.md 6.5.1 (b) and cycle 4 work item 5;
research/model_eradrift.md section 7; research/model_props.md "decision share"; research/model_calib.md section 4).

Two channels, both read ONLY scored forward-ledger bouts (never the backtest, never the vault), and neither changes a model:

1. Winner drift rule 6.5.1 (b), exactly as pre-registered (Nov 6, 2026, before vault audit 1) and as data/predictions/README.md
   "Drift rule 6.5.1(b): the column it reads" names its series:
   - trigger series: each scored row's own `p_a_noline` (fwd-4.1 / 4.2: the MoE stack; fwd-4.3 on: the ML v2 no-line stack);
   - tracked series: the MoE no-line stack (`p_a_noline` in fwd-4.1 / 4.2 files, `models.moe_noline` from fwd-4.3), reported only;
   - rows: scored bouts with outcome `win`, debut bouts left out, date order (ties in file order);
   - check: at every calendar quarter end, the trailing-200 mirrored slope and its Wald 95% CI (tools/calib.py slope_monitor);
     the rule fires at the first quarter end whose check and the previous quarter's check are ready and both include 1, and
     then the production no-line stack switches from h 1.5 (+ its temperature) to h 3, T 1. One-way: there is no switch-back
     clause. The window, test and threshold are NOT changed here (a change after audit 1 is "not clean on the vault", 6.5.2;
     research/model_calib.md lists the properties a later re-specification should fix).
2. Level alarms (eradrift section 7.5, + the decision share of research/model_props.md), a separate channel with its own state:
   over the trailing 200 scored bouts at each quarter end, calibration in the large of
   - the decision share (P(goes the distance) = p_distance, draws counted as decisions), the KO/TKO share (a_ko + b_ko), and
     the round-1 share of finishes (sum of p_finish_round[*][0] / (1 - p_distance), over finished bouts), each as
     mean(outcome - prediction) with a normal 95% CI;
   - the realised / predicted ratio of sig strikes landed, control, takedown attempts and knockdowns (the fwd-4.2+ stat-line
     block's per-fighter means against statlines_results.json), as log(sum actual / sum predicted) with a delta-method CI.
   An alarm fires at the first quarter end whose check and the previous one's both have a CI that excludes 0 (the same
   two-quarter clock as rule (b)). An alarm OPENS A REVIEW, which may pre-register a new candidate; it never applies a tilt.
   Dated, pre-announced structural breaks (equipment, rules, judging criteria) are logged in the output with their effective
   date and source and flagged on every check whose window spans them; they are variance interventions, never fitted tilts.

    python3 tools/drift_monitor.py ledger [--as-of YYYY-MM-DD] [--dir data/predictions] [--out data/predictions/drift_monitor.json]
    python3 tools/drift_monitor.py replay [--gate <v9 gate output>] [--arm all] [--out data/derived/v9/drift_replay.json]

`ledger` regenerates the ledger metadata file (never hand-edited). `replay` is the cycle-4 gate item "replayed over 2015-23, the
drift rule fires at most once": rule (b) on the stored 2015-2023 replay checks of the deployed-style no-line stack
(data/derived/calib.json rule.replay_2015_2023, refit each year on 2013..Y-1, h 1.5; tools/calib.py stage_rule), plus, as a
descriptive line, the level alarms run on a v9 gate run's simulated fights (2019-2023 train)."""
import argparse
import datetime as dt
import importlib.util
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def _load(name, file):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, file))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


WINDOW = 200
Z = 1.96
SHARE_SERIES = ("decision", "ko", "r1_finish")
RATIO_SERIES = ("sig_lnd", "ctrl", "td_att", "kd")
# dated, pre-announced breaks (research/model_eradrift.md section 1, sources checked Nov 7, 2026); new entries are appended with
# their source BEFORE their effective date passes; the monitor only logs and flags them
BREAKS = [
    {"key": "gloves2024", "effective": "2024-06-01", "announced": "2024-04-12", "what": "redesigned UFC glove from UFC 302",
     "source": "Sherdog Apr 12, 2024; Wikipedia UFC 302; CBS Sports"},
    {"key": "abcrules2024", "effective": "2024-11-01", "announced": "2024-07-23", "what": "12-6 elbows legal, 'grounded' redefined (where adopted)",
     "source": "ESPN; CBS Sports; combatsportslaw.com"},
    {"key": "oldgloves2024", "effective": "2024-11-16", "announced": "2024-11-12", "what": "old glove back from UFC 309",
     "source": "Cageside Press Nov 13, 2024; ESPN"},
    {"key": "oldgloves2025", "effective": "2025-02-15", "announced": "2025-02-15", "what": "old gloves for every fighter from UFC Vegas 102",
     "source": "Bloody Elbow Feb 15, 2025; theScore"},
]


def quarter_ends(first_iso, as_of_iso):
    y, m = int(first_iso[:4]), int(first_iso[5:7])
    q = (m - 1) // 3
    out = []
    while True:
        end = "%04d-%s" % (y, ("03-31", "06-30", "09-30", "12-31")[q])
        if end >= as_of_iso:
            return out
        out.append(end)
        q += 1
        if q == 4:
            y, q = y + 1, 0


def share_check(y, p):
    """Calibration in the large of a share: mean(y - p), normal 95% CI."""
    y, p = np.asarray(y, float), np.asarray(p, float)
    d = y - p
    n = len(d)
    m = float(d.mean())
    se = float(d.std(ddof=1) / math.sqrt(n)) if n > 1 else float("inf")
    return {"n": n, "pred": round(float(p.mean()), 5), "obs": round(float(y.mean()), 5), "gap": round(m, 5),
            "ci": [round(m - Z * se, 5), round(m + Z * se, 5)], "excludes_0": bool(m - Z * se > 0 or m + Z * se < 0)}


def ratio_check(y, mu):
    """Realised / predicted ratio: log(sum y / sum mu), delta-method 95% CI over bouts."""
    y, mu = np.asarray(y, float), np.asarray(mu, float)
    Y, M = float(y.sum()), float(mu.sum())
    if M <= 0 or Y <= 0:
        return {"n": len(y), "ratio": None, "excludes_0": False}
    r = Y / M
    se = math.sqrt(float(((y - r * mu) ** 2).sum())) / Y
    lr = math.log(r)
    return {"n": len(y), "ratio": round(r, 5), "log_ratio": round(lr, 5), "ci": [round(lr - Z * se, 5), round(lr + Z * se, 5)],
            "excludes_0": bool(lr - Z * se > 0 or lr + Z * se < 0)}


def alarms(rows, as_of, window=WINDOW):
    """Level-alarm channel. rows: [{date, dec_p, dec_y, ko_p, ko_y, fin (bool), r1_p (P(R1 | finish)), r1_y, stats: {stat: [y, mu]}}].
    Returns {series: {checks, fired, fired_at}} with the two-quarter clock (CI excludes 0 at two consecutive quarter ends)."""
    rs = sorted(enumerate(rows), key=lambda t: (t[1]["date"], t[0]))
    rs = [r for _, r in rs]
    out = {s: {"checks": [], "fired": False, "fired_at": None} for s in SHARE_SERIES + RATIO_SERIES}
    if not rs:
        return out
    prev = {s: False for s in out}
    for q in quarter_ends(rs[0]["date"], as_of):
        sel = [r for r in rs if r["date"] <= q][-window:]
        ready = len(sel) >= window
        spans = [b["key"] for b in BREAKS if sel and sel[0]["date"] < b["effective"] <= q]
        for s in out:
            if not ready:
                chk = {"quarter_end": q, "n": len(sel), "ready": False}
            elif s == "decision":
                chk = dict(quarter_end=q, ready=True, **share_check([r["dec_y"] for r in sel], [r["dec_p"] for r in sel]))
            elif s == "ko":
                chk = dict(quarter_end=q, ready=True, **share_check([r["ko_y"] for r in sel], [r["ko_p"] for r in sel]))
            elif s == "r1_finish":
                fs = [r for r in sel if r["fin"] and r.get("r1_p") is not None]
                chk = dict(quarter_end=q, ready=len(fs) > 10, **(share_check([r["r1_y"] for r in fs], [r["r1_p"] for r in fs]) if len(fs) > 10 else {"n": len(fs)}))
            else:
                st = [r["stats"][s] for r in sel if r.get("stats") and s in r["stats"]]
                ok = len(st) >= window // 2
                chk = dict(quarter_end=q, ready=ok, **(ratio_check([a for a, _ in st], [m for _, m in st]) if ok else {"n": len(st)}))
            chk["breaks_in_window"] = spans
            exc = bool(chk.get("ready") and chk.get("excludes_0"))
            if exc and prev[s] and not out[s]["fired"]:
                out[s]["fired"], out[s]["fired_at"] = True, q
            prev[s] = exc
            out[s]["checks"].append(chk)
    return out


# ---------------------------------------------------------------------------------------------- the forward ledger
def method_class(m):
    m = (m or "").upper()
    if m.startswith("KO") or "TKO" in m or "DOCTOR" in m:
        return "KO"
    if m.startswith("SUB"):
        return "SUB"
    if "DEC" in m:
        return "DEC"
    return None


def ledger_rows(pred_dir):
    FL = _load("forward_ledger", "forward_ledger.py")
    res = {r["bout_id"]: r for r in (FL.jload(os.path.join(pred_dir, "results.json"), {}) or {}).get("results", [])}
    srs = {r["bout_id"]: r for r in (FL.jload(os.path.join(pred_dir, "statlines_results.json"), {}) or {}).get("results", [])}
    trig, track, lev = [], [], []
    for (f, created, doc, ct) in FL.scored_files(pred_dir):
        ver = str((doc.get("model") or {}).get("version", ""))
        for b in doc["bouts"]:
            r = res.get(b["bout_id"])
            if not r or r.get("outcome") not in ("win", "draw") or (r.get("verified") is False):
                continue
            debut = any(str(x).startswith("debut") for x in (b.get("flags") or []))
            if r["outcome"] == "win" and not debut and b.get("p_a_noline") is not None:
                y = 1.0 if r.get("winner") == "a" else 0.0
                trig.append({"date": doc["date"], "p": b["p_a_noline"], "y": y})
                moe = (b.get("models") or {}).get("moe_noline")
                moe_p = (moe.get("p_a") if isinstance(moe, dict) else moe) if moe is not None else (b["p_a_noline"] if not ver.startswith(("fwd-4.3", "fwd-4.4")) else None)
                if moe_p is not None:
                    track.append({"date": doc["date"], "p": moe_p, "y": y})
            pm, pd_, pfr = b.get("p_method"), b.get("p_distance"), b.get("p_finish_round")
            cls = "DEC" if r["outcome"] == "draw" else method_class(r.get("method"))
            if not pm or pd_ is None or cls is None:
                continue
            fin = cls in ("KO", "SUB")
            r1p = None
            if pfr and (1 - pd_) > 1e-9:
                r1p = (pfr["a"][0] + pfr["b"][0]) / (1 - pd_)
            row = {"date": doc["date"], "dec_p": pd_, "dec_y": 1.0 if cls == "DEC" else 0.0, "ko_p": pm.get("a_ko", 0) + pm.get("b_ko", 0),
                   "ko_y": 1.0 if cls == "KO" else 0.0, "fin": fin, "r1_p": r1p, "r1_y": 1.0 if (fin and r.get("round") == 1) else 0.0, "stats": {}}
            sl, sr = b.get("statlines"), srs.get(b["bout_id"])
            if sl and sr:
                for s in RATIO_SERIES:
                    try:
                        ya, yb = sr["a"][s], sr["b"][s]
                        ma, mb = sl["a"][s]["mean"], sl["b"][s]["mean"]
                    except (KeyError, TypeError):
                        continue
                    if None in (ya, yb, ma, mb):
                        continue
                    row["stats"][s] = [ya + yb, ma + mb]
            lev.append(row)
    return trig, track, lev


def cmd_ledger(a):
    CB = _load("calib", "calib.py")
    as_of = a.as_of or dt.date.today().isoformat()
    trig, track, lev = ledger_rows(a.dir)
    out = {"meta": {"tool": "tools/drift_monitor.py ledger", "built": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                    "as_of": as_of, "window": WINDOW, "rule": "docs/V6_V10_PLAN.md 6.5.1 (b) as pre-registered; level alarms per research/model_eradrift.md 7.5 + research/model_props.md (decision share)",
                    "note": "regenerated by script; never hand-edited. Neither channel changes a model: rule (b) switches the production no-line stack to h 3 / T 1 (a new fwd version with a README addendum first); an alarm opens a review."},
           "rule_b": {"trigger_series": {"column": "p_a_noline", "n_rows": len(trig), **CB.drift_rule_b(trig, as_of)},
                      "tracked_series": {"column": "MoE no-line stack (models.moe_noline / p_a_noline in fwd-4.1, 4.2)", "n_rows": len(track), **CB.drift_rule_b(track, as_of)}},
           "level_alarms": {"n_rows": len(lev), "series": alarms(lev, as_of)},
           "breaks": BREAKS}
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w") as fh:
        json.dump(out, fh, indent=1)
    rb = out["rule_b"]["trigger_series"]
    print("rule (b): %d scored rows, %d checks, setting %s%s; level alarms on %d rows: %s" % (
        len(trig), len(rb["checks"]), rb["setting"], (" (fired %s)" % rb["fired_at"]) if rb["fired"] else "", len(lev),
        ", ".join("%s %s" % (s, "FIRED " + v["fired_at"] if v["fired"] else "quiet") for s, v in out["level_alarms"]["series"].items())))
    print("wrote", os.path.relpath(a.out, ROOT))


# ---------------------------------------------------------------------------------------------- the replay (gate item)
def rule_b_replay(checks):
    """Rule (b) on stored quarterly checks [{quarter_end, ready, ci_includes_1}]: the one-way switch (as pre-registered), and
    how often the trigger condition held (two consecutive ready checks including 1) and in how many separate episodes."""
    prev, fired_at, cond, episodes, in_ep = False, None, [], 0, False
    for c in checks:
        inc = bool(c.get("ready") and c.get("ci_includes_1"))
        met = inc and prev
        if met:
            cond.append(c["quarter_end"])
            if fired_at is None:
                fired_at = c["quarter_end"]
            if not in_ep:
                episodes += 1
        in_ep = met
        prev = inc
    return {"switch_events": 1 if fired_at else 0, "fired_at": fired_at, "n_checks": len(checks),
            "n_quarters_condition_met": len(cond), "condition_episodes": episodes, "quarters_condition_met": cond}


def gate_rows(gate_file, arm, lo="2019-01-01", hi="2024-01-01"):
    """Level-alarm rows from a v9 gate run's simulated fights (train only)."""
    D = json.load(open(gate_file))
    st_ix = {s: i for i, s in enumerate(D["meta"]["stats"])}
    rows = []
    for f in D["fights"]:
        if f["err"] or not f["outcome"] or not (lo <= f["date"] < hi):
            continue
        a = f["arms"][arm]
        R, c, n = f["rounds"], a["cells"], a["n"]
        ko = sum(c[k] + c[2 * R + k] for k in range(R)) / n
        dec = (c[4 * R] + c[4 * R + 1] + c[4 * R + 2]) / n
        r1 = (c[0] + c[R] + c[2 * R] + c[3 * R]) / n
        cls = f["outcome"]["cls"]
        fin = cls in ("KO", "SUB")
        row = {"date": f["date"], "dec_p": dec, "dec_y": 1.0 if cls in ("DEC", "DRAW") else 0.0, "ko_p": ko, "ko_y": 1.0 if cls == "KO" else 0.0,
               "fin": fin, "r1_p": r1 / max(1e-9, 1 - dec), "r1_y": 1.0 if (fin and f["outcome"]["round"] == 1) else 0.0, "stats": {}}
        if f["actual"]:
            for s in RATIO_SERIES:
                i = st_ix[s]
                row["stats"][s] = [f["actual"]["A"][s] + f["actual"]["B"][s], a["st"][i] + a["st"][len(st_ix) + i]]
        rows.append(row)
    return rows


def cmd_replay(a):
    C = json.load(open(os.path.join(ROOT, "data/derived/calib.json")))
    rep = C["rule"]["replay_2015_2023"]
    rb = rule_b_replay(rep["checks"])
    out = {"meta": {"tool": "tools/drift_monitor.py replay", "built": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                    "rule_b_source": "data/derived/calib.json rule.replay_2015_2023 (deployed-style no-line stack refit each year on 2013..Y-1, h 1.5; trailing-200 mirrored slope at quarter ends 2015-2023; tools/calib.py stage_rule)",
                    "reading": "rule 6.5.1 (b) is a one-way switch as pre-registered, so a replay has at most one switch event by construction (research/model_calib.md: the criterion 'fires at most once' then says nothing); the trigger-condition count and episodes are reported so the rule's near-unconditional firing stays visible"},
           "rule_b": rb}
    if a.gate:
        rows = gate_rows(a.gate, a.arm)
        al = alarms(rows, "2024-01-01")
        out["level_alarms_descriptive"] = {"source": os.path.relpath(a.gate, ROOT), "arm": a.arm, "window": "2019-2023 train (simulated fights)", "n_rows": len(rows),
                                           "fired": {s: v["fired_at"] for s, v in al.items()},
                                           "n_fired": sum(1 for v in al.values() if v["fired"]), "series": al}
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w") as fh:
        json.dump(out, fh, indent=1)
    print("rule (b) replay 2015-2023: switch events %d (fired %s); condition met at %d of %d quarter ends in %d episodes" % (
        rb["switch_events"], rb["fired_at"], rb["n_quarters_condition_met"], rb["n_checks"], rb["condition_episodes"]))
    if a.gate:
        print("level alarms (descriptive, %s / %s): %s" % (a.gate, a.arm, out["level_alarms_descriptive"]["fired"]))
    print("wrote", os.path.relpath(a.out, ROOT))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    p1 = sub.add_parser("ledger")
    p1.add_argument("--as-of", default=None)
    p1.add_argument("--dir", default=os.path.join(ROOT, "data", "predictions"))
    p1.add_argument("--out", default=os.path.join(ROOT, "data", "predictions", "drift_monitor.json"))
    p2 = sub.add_parser("replay")
    p2.add_argument("--gate", default=None)
    p2.add_argument("--arm", default="all")
    p2.add_argument("--out", default=os.path.join(ROOT, "data", "derived", "v9", "drift_replay.json"))
    a = ap.parse_args()
    {"ledger": cmd_ledger, "replay": cmd_replay}[a.cmd](a)


if __name__ == "__main__":
    main()
