#!/usr/bin/env python3
"""Checks for tools/bayes.py and data/derived/bayes.json.

1. bayes.json invariants: no fight dated 2026 or later; probabilities in (0, 1); method x round cells sum to 1 and
   agree with p_plugin's side (P(A wins) from the cells equals the variance-aware or plug-in p, whichever the config
   used); the plugin's 7-bin mapping sums to 1; the confirm look was not forced; the stack gate decisions in the file
   match the frozen rule (enters iff the CV gain beats 0.0005).
2. Corner symmetry of the inference itself on an early slice (fights before 1998, fast): the filter and an EP
   refit on the corner-swapped data give mirrored states and P(A) + P(B) = 1.

Run from the project root: python3 tests/test_bayes.py
"""
import json
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))


def test_json():
    d = json.load(open(os.path.join(ROOT, "data", "derived", "bayes.json")))
    cfg = d["meta"]["config"]
    assert d["fights"], "no fights"
    for f, r in d["fights"].items():
        assert r["date"] < "2026-01-01", f
        for k in ("p", "p_plugin"):
            assert 0.0 < r[k] < 1.0, (f, k)
        c = np.array(r["cells"], float)
        assert abs(c.sum() - 1.0) < 2e-3, (f, c.sum())
        pa = (c[0:10].sum() + c[20]) / (1.0 - c[22])
        ref = r["p"] if cfg["varaware"] else r["p_plugin"]
        assert abs(pa - ref) < 2e-3, (f, pa, ref)
    import importlib.util
    spec = importlib.util.spec_from_file_location("bayes_plugin_bins", os.path.join(ROOT, "tools", "blindtest_plugins",
                                                                                     "bayes.py"))
    src = open(spec.origin).read()
    ns = {}
    exec(src.split("@register")[0].replace("from blindtest import register, Stored, MoEStack, _MOE_BASE", ""), ns)
    r = next(iter(d["fights"].values()))
    assert abs(sum(ns["_bins7"](r["cells"])) - 1.0) < 2e-3
    if d.get("confirm"):
        assert d["confirm"]["forced_rerun"] is False
    if d.get("stack"):
        for k, g in d["stack"]["gate"].items():
            assert g["enters"] == (g["gain"] < -0.0005), k
    if d.get("swaptest"):
        assert d["swaptest"]["max|pA + pA_swapped - 1|"] < 1e-6
    print("bayes.json: %d fights, config %s, invariants ok" % (len(d["fights"]), cfg["key"]))


def test_symmetry():
    import bayes as BY
    X = BY.load_data()
    Y = BY.swap_data(X)
    H = BY.pickle.load(open(BY.year_path("main", 2019), "rb"))["H"]
    cut = BY.dt.date(1998, 1, 1).toordinal()
    R1 = BY.run_filter(X, H, cut, key="main")
    R2 = BY.run_filter(Y, H, cut, key="swap")
    idx = np.flatnonzero(R1["done"])
    assert np.allclose(R1["m0"][idx, 0], R2["m0"][idx, 1], atol=1e-10)
    S1 = BY.ep_snapshot(X, H, cut, key="main")
    S2 = BY.ep_snapshot(Y, H, cut, key="swap")
    assert np.allclose(S1["M"], S2["M"], atol=1e-8) and np.allclose(S1["P"], S2["P"], atol=1e-8)
    end = BY.dt.date(1999, 1, 1).toordinal()
    F1 = BY.run_filter(X, H, end, init=S1, from_day=cut, key="main")
    F2 = BY.run_filter(Y, H, end, init=S2, from_day=cut, key="swap")
    j = np.flatnonzero(F1["done"])
    p1 = BY.win_prob(H["win"]["beta"], *BY.feat_moments(F1, j))[0]
    p2 = BY.win_prob(H["win"]["beta"], *BY.feat_moments(F2, j))[0]
    assert np.max(np.abs(p1 + p2 - 1)) < 1e-10
    print("symmetry: filter %d fights, EP over %d fights, %d predictions mirrored (max |p+p'-1| %.1e)" % (
        len(idx), S1["nf"], len(j), np.max(np.abs(p1 + p2 - 1))))


if __name__ == "__main__":
    test_json()
    test_symmetry()
    print("ok")
