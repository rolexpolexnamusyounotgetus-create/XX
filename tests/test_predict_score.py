#!/usr/bin/env python3
"""test_predict_score.py: tools/predict_score.py after the v6 review (docs/CHANGELOG.md "v6 review").

    python3 tests/test_predict_score.py

1. the vectorised event-cluster bootstrap draws exactly what the per-resample loop drew (same B, seed);
2. with --B 2000 the scorer reproduces the recorded v6 gate (data/derived/v6/gate_train_score.json) bit for bit, regime by
   regime (paired diffs and CIs);
3. the marginal rule: a bound within 2 Monte Carlo SE of its threshold is decided by the clustered normal bound;
4. power(): SE scaled by sqrt(n_gate / n_look); the v6 primary (-0.004 on 842 fights) had power below 0.5;
5. the review's re-score at B = 20,000 (data/derived/v6/review/): the own-input gate passes, the shared-input gate fails.
"""
import json
import math
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import predict_score as ps  # noqa: E402

fails = passes = 0


def check(name, ok, info=""):
    global fails, passes
    if ok:
        passes += 1
    else:
        fails += 1
    print("%s  %s%s" % ("PASS" if ok else "FAIL", name, ("  (" + info + ")") if info else ""))


# 1. vectorised bootstrap = the old loop
rng0 = np.random.default_rng(3)
groups = np.array(["g%d" % (i % 37) for i in range(400)])
cols = {"a": rng0.normal(size=400), "b": rng0.normal(size=400)}
keys = sorted(set(groups))
G = [np.where(groups == k)[0] for k in keys]
sums = {c: np.array([v[g].sum() for g in G]) for c, v in cols.items()}
cnt = np.array([len(g) for g in G], float)
r = np.random.default_rng(7)
old = {c: np.empty(2000) for c in cols}
for b in range(2000):
    k = r.integers(0, len(G), len(G))
    n = cnt[k].sum()
    for c in cols:
        old[c][b] = sums[c][k].sum() / n
new = ps.cluster_boot(groups, cols, B=2000, seed=7)
check("vectorised cluster bootstrap = the per-resample loop (B 2000, seed 7)", all(np.array_equal(old[c], new[c]) for c in cols))

# 2. reproduce the recorded v6 gate at B = 2000
ps.BOOT["B"], ps.BOOT["seed"] = 2000, 7
D = json.load(open(os.path.join(ROOT, "data/derived/v6/gate_train.json")))
REC = json.load(open(os.path.join(ROOT, "data/derived/v6/gate_train_score.json")))
recs = D["fights"]
wfit = {Y: ps.fit_w(recs, "v6", tuple(range(2019, Y)))["w"] for Y in ps.GATE_YEARS}
wmap = {"v6": wfit, "v501": None}
bad = []
for kind in ps.KINDS:
    s = ps.score_kind(recs, kind, ["v6", "v501"], wmap, set(ps.GATE_YEARS))
    a, b = s["paired"]["v6 - v501"], REC["regimes"][kind]["paired"]["v6 - v501"]
    for m in b:
        if a[m]["diff"] != b[m]["diff"] or a[m]["ci"] != b[m]["ci"]:
            bad.append((kind, m))
    if s["packages"] != REC["regimes"][kind]["packages"]:
        bad.append((kind, "packages"))
check("B 2000 reproduces the recorded v6 gate (paired diffs, CIs, package levels)", not bad, str(bad) if bad else "3 regimes")

# 3. marginal rule
d = {"diff": -0.006, "ci": [-0.012, -0.0001], "ci_mcse": [0.0001, 0.0001], "normal": {"ci": [-0.0119, 0.0002]}}
c = ps.check_upper(d, 0.0, True, -0.001)
check("marginal bound (within 2 MC SE) is decided by the normal bound", c["marginal"] and c["decided_by"] == "normal" and not c["pass"], json.dumps(c))
d2 = {"diff": -0.006, "ci": [-0.012, -0.001], "ci_mcse": [0.0001, 0.0001], "normal": {"ci": [-0.0119, 0.0002]}}
c2 = ps.check_upper(d2, 0.0, True, -0.001)
check("a clear bound is decided by the bootstrap", (not c2["marginal"]) and c2["decided_by"] == "bootstrap" and c2["pass"])

# 4. power
p = ps.power(os.path.join(ROOT, "data/derived/v6/review/gate_train_rescore_B20000.json"), 842, -0.004)
se_g = p["se_gate_normal"]
check("power: SE_look = SE_gate x sqrt(n_gate / n_look); MDE = 2.8 SE", abs(p["se_look"] - se_g * math.sqrt(p["n_gate"] / 842.0)) < 1e-6 and abs(p["mde_80"] - 2.8 * p["se_look"]) < 1e-5,
      "SE gate %.5f, look %.5f, MDE %.4f" % (se_g, p["se_look"], p["mde_80"]))
check("the v6 primary was underpowered (power < 0.5 at -0.004 on 842 fights)", p["underpowered"] and p["power"] < 0.5, "power %.3f" % p["power"])

# 5. the review's re-score at B = 20,000
own = json.load(open(os.path.join(ROOT, "data/derived/v6/review/gate_train_rescore_B20000.json")))
sh = json.load(open(os.path.join(ROOT, "data/derived/v6/review/gate_train_shared_rescore_B20000.json")))
check("B 20,000: the own-input gate passes, the shared-input gate fails (no-line and close winner)",
      own["gate"]["pass"] and not sh["gate"]["pass"] and own["gate"]["boot"]["B"] == 20000 and
      not sh["gate"]["checks"]["no-line winner: CI upper < 0 and point <= -0.001"] and not sh["gate"]["checks"]["close winner: CI upper <= +0.0005"])
print("\n%d passed, %d failed" % (passes, fails))
sys.exit(1 if fails else 0)
