#!/usr/bin/env python3
"""test_drift_monitor.py: tools/drift_monitor.py (engine cycle 4 drift monitor; docs/V6_V10_PLAN.md 6.5.1 (b)).
Synthetic inputs only (no fight data); plus the 2015-2023 replay of rule (b) on the stored calib.json checks.
    python3 tests/test_drift_monitor.py
"""
import importlib.util
import json
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("dm", os.path.join(ROOT, "tools", "drift_monitor.py"))
DM = importlib.util.module_from_spec(spec)
spec.loader.exec_module(DM)
spec2 = importlib.util.spec_from_file_location("calib", os.path.join(ROOT, "tools", "calib.py"))
CB = importlib.util.module_from_spec(spec2)
spec2.loader.exec_module(CB)
fails = []


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + (("  (" + detail + ")") if detail else ""))
    if not ok:
        fails.append(name)


def synth_rows(n, start="2027-01-01", dec_shift=0.0, ratio=1.0, seed=1):
    rng = np.random.default_rng(seed)
    rows = []
    d0 = np.datetime64(start)
    for i in range(n):
        date = str(d0 + np.timedelta64(int(i * 365 / 520), "D"))
        dp = float(rng.uniform(0.3, 0.7))
        kop = float(rng.uniform(0.15, 0.45)) * (1 - dp)
        y_dec = float(rng.uniform() < min(0.99, dp + dec_shift))
        fin = y_dec == 0
        y_ko = float(fin and rng.uniform() < kop / max(1e-9, 1 - dp))
        r1p = 0.45
        mu = {s: float(rng.uniform(20, 60)) for s in DM.RATIO_SERIES}
        rows.append({"date": date, "dec_p": dp, "dec_y": y_dec, "ko_p": kop, "ko_y": y_ko, "fin": fin, "r1_p": r1p,
                     "r1_y": float(fin and rng.uniform() < r1p), "stats": {s: [float(rng.poisson(ratio * m)), m] for s, m in mu.items()}})
    return rows


# 1 an empty ledger: rule (b) default, every alarm quiet
rb = CB.drift_rule_b([], "2027-06-30")
al = DM.alarms([], "2027-06-30")
check("1 empty ledger: rule (b) keeps h1.5, no alarm", rb["setting"] == "h1.5" and not any(v["fired"] for v in al.values()))

# 2 calibrated synthetic stream: no alarm in 2 years (allowing for chance: count fired series <= 1)
cal = DM.alarms(synth_rows(1040, seed=3), "2029-01-01")
nf = sum(1 for v in cal.values() if v["fired"])
check("2 calibrated stream: at most one chance alarm over 7 series x 8 quarters", nf <= 1, "fired %d" % nf)

# 3 a persistent decision-share shift (+8 points) and a 15% stat-level excess fire their alarms
sh = DM.alarms(synth_rows(1040, dec_shift=0.08, ratio=1.15, seed=4), "2029-01-01")
check("3a decision share +8 points: alarm fires", sh["decision"]["fired"], str(sh["decision"]["fired_at"]))
check("3b realised / predicted 1.15: stat alarms fire", all(sh[s]["fired"] for s in DM.RATIO_SERIES))

# 4 the alarm needs two consecutive quarters (one excluding check alone does not fire)
chk = [{"quarter_end": "q1", "ready": True, "ci_includes_1": False}, {"quarter_end": "q2", "ready": True, "ci_includes_1": True},
       {"quarter_end": "q3", "ready": True, "ci_includes_1": False}, {"quarter_end": "q4", "ready": True, "ci_includes_1": True},
       {"quarter_end": "q5", "ready": True, "ci_includes_1": True}, {"quarter_end": "q6", "ready": True, "ci_includes_1": True}]
r = DM.rule_b_replay(chk)
check("4 rule (b) replay: fires at the second consecutive including check, once (one-way); condition counted per quarter",
      r["fired_at"] == "q5" and r["switch_events"] == 1 and r["n_quarters_condition_met"] == 2 and r["condition_episodes"] == 1)

# 5 corner symmetry: swapping a / b leaves the level channel unchanged (shares and ratios are corner-free) and mirrors rule (b)
rows = synth_rows(600, seed=5)
a1 = DM.alarms(rows, "2028-06-30")
sw = [dict(r) for r in rows]
a2 = DM.alarms(sw, "2028-06-30")
check("5a level channel is corner-free", json.dumps(a1, sort_keys=True) == json.dumps(a2, sort_keys=True))
rng = np.random.default_rng(6)
tr = [{"date": rows[i]["date"], "p": float(rng.uniform(0.2, 0.8)), "y": float(rng.uniform() < 0.5)} for i in range(600)]
trs = [{"date": t["date"], "p": 1 - t["p"], "y": 1 - t["y"]} for t in tr]
b1, b2 = CB.drift_rule_b(tr, "2028-06-30"), CB.drift_rule_b(trs, "2028-06-30")
check("5b rule (b) is corner-symmetric", [c.get("slope") for c in b1["checks"]] == [c.get("slope") for c in b2["checks"]] and b1["fired_at"] == b2["fired_at"])

# 6 breaks are logged and flagged on windows that span them
rows24 = synth_rows(520, start="2024-01-01", seed=7)
a24 = DM.alarms(rows24, "2025-06-30")
fl = [c["breaks_in_window"] for c in a24["decision"]["checks"] if c.get("ready")]
check("6 a window spanning the 2024 glove trial is flagged", any("gloves2024" in x for x in fl))

# 7 the 2015-2023 replay on the stored calib.json checks: one switch event (2015-09-30), the condition held at many quarters
C = json.load(open(os.path.join(ROOT, "data", "derived", "calib.json")))
rp = DM.rule_b_replay(C["rule"]["replay_2015_2023"]["checks"])
check("7 replay 2015-2023: one switch event at 2015-09-30 (calib.json first_fire)", rp["switch_events"] == 1 and rp["fired_at"] == C["rule"]["replay_2015_2023"]["first_fire"],
      "%d quarters met in %d episodes" % (rp["n_quarters_condition_met"], rp["condition_episodes"]))

# 8 tracked series (MoE no-line): from fwd-4.3 on it is models.moe_noline only; a fwd-4.3 / 4.4 / 4.5 bout whose moe_noline is
#   null is left out of it (its p_a_noline is the ML v2 no-line stack), while a fwd-4.1 / 4.2 bout's p_a_noline is the MoE stack
import tempfile
with tempfile.TemporaryDirectory() as td:
    vers = ["fwd-4.1", "fwd-4.2", "fwd-4.3", "fwd-4.4", "fwd-4.5"]
    res = []
    for i, v in enumerate(vers):
        date = "2026-12-%02d" % (i + 1)
        bid = "%s:a-%d__b-%d" % (date, i, i)
        doc = {"event": "Test %d" % i, "date": date, "created_utc": date + "T00:00:00Z", "lock_utc": date + "T20:00:00Z",
               "model": {"version": v + ": synthetic"},
               "bouts": [{"bout_id": bid, "flags": [], "p_a_noline": 0.6, "models": {"moe_noline": None}}]}
        json.dump(doc, open(os.path.join(td, "%s_test-%d.json" % (date, i)), "w"))
        res.append({"bout_id": bid, "outcome": "win", "winner": "a", "verified": True})
    json.dump({"results": res}, open(os.path.join(td, "results.json"), "w"))
    trig, track, _ = DM.ledger_rows(td)
    check("8 MoE tracked series: p_a_noline stands in only for fwd-4.1 / 4.2 (fwd-4.3, 4.4, 4.5 with a null moe_noline left out)",
          len(trig) == 5 and [t["date"] for t in track] == ["2026-12-01", "2026-12-02"], "trigger %d, tracked %d" % (len(trig), len(track)))

print("\n%d failures" % len(fails))
sys.exit(1 if fails else 0)
