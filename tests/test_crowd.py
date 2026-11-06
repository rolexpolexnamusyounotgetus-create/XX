#!/usr/bin/env python3
"""Tests for tools/crowd.py (crowd and expert consensus picks).

    python3 tests/test_crowd.py

Offline: parser fixtures, name matching, the contest-lock check, ledger orientation of forward captures, the vault
guard (tools/crowd.py selftest), then invariants of the committed data/derived/crowd.json: no 2026 fight, every
input corner-symmetric, no same-day panel or post-lock contest card reaching a probability, the cv decisions computed
on the current data and the one 2024-25 look applying exactly those decisions.
"""
import copy
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import crowd as C  # noqa: E402


def main():
    C.cmd_selftest(None)
    d = json.load(open(C.OUT_JSON))
    F = d["fights"]
    assert F and all(r["date"] < C.VAULT_FROM for r in F.values()), "2026 rows in crowd.json"
    n_rw = n_mm = 0
    for fid, r in F.items():
        for strict in (False, True):
            p = C.crowd_probs(r, strict=strict)
            r2 = copy.deepcopy(r)
            if "rw" in r2:
                r2["rw"]["n_a"], r2["rw"]["n_b"] = r2["rw"]["n_b"], r2["rw"]["n_a"]
            if "mm" in r2:
                r2["mm"]["share_a"] = 1 - r2["mm"]["share_a"]
            q = C.crowd_probs(r2, strict=strict)
            assert set(p) == set(q) and all(abs(p[k] + q[k] - 1) < 1e-9 for k in p), fid
        p = C.crowd_probs(r)
        if r.get("rw"):
            assert ("rw" in p) == (r["rw"]["frozen"] == "pre_event"), fid
            assert r["rw"]["frozen"] != "pre_event" or r["rw"]["days_before"] >= 1, fid
            n_rw += "rw" in p
        if r.get("mm"):
            assert ("mm" in p) == (r["mm"]["freeze"] != "lock_after_bound"), fid
            n_mm += "mm" in p
    assert n_rw > 400 and n_mm > 500, (n_rw, n_mm)
    cv = d["cv"]
    assert cv["meta"]["data_hash"] == C._data_hash(F), "cv stage was run on different data"
    assert all(int(y) <= 2023 for y in cv["coverage"]["rows"]), "cv stage saw validation years"
    if "confirm" in d:
        assert d["confirm"]["decisions_applied"] == cv["decisions"]["summary"]
        assert d["confirm"]["meta"]["data_hash"] == cv["meta"]["data_hash"]
    sw = cv["swap"]
    assert max(max(v["max_abs_dp"], v["max_abs_dw"]) for v in sw.values() if isinstance(v, dict)) < 1e-9
    print("test_crowd: ok (%d fights, %d RotoWire and %d Money MMA inputs)" % (len(F), n_rw, n_mm))


if __name__ == "__main__":
    main()
