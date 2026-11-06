#!/usr/bin/env python3
"""Checks for tools/linemove.py's output (data/derived/linemove.json) and its parser.

    python3 tests/test_linemove.py

1. hidden-data protocol: the parser drops every row dated 2026-01-01 or later; no exported fight is dated 2026+;
2. the exported stacks: two non-negative weights, no intercept; the test vectors reproduce from the weights and the
   corner swap is exact (p(A,B) + p(B,A) = 1 to 1e-12);
3. the two pre-registrations exist and the 2024-2025 blocks carry the verdicts they define;
4. per-fight block: probabilities in (0, 1), sets assigned by year, the point-0 opener identical in both de-vig columns.
"""
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
D = json.load(open(os.path.join(ROOT, "data", "derived", "linemove.json")))
n_ok = 0


def ok(cond, msg):
    global n_ok
    assert cond, msg
    n_ok += 1


def logit(p, clip=0.01):
    p = min(max(p, clip), 1 - clip)
    return math.log(p / (1 - p))


def sig(z):
    return 1 / (1 + math.exp(-z))


# 1. protocol
os.environ.setdefault("OMP_NUM_THREADS", "1")
import linemove as LM  # noqa: E402

mus, dropped = LM.load_bfo_matchups_dev()
ok(all((m.get("date") or "") < LM.VAULT_S for m in mus.values()), "a 2026 matchup survived the dev parser")
ok(sum(dropped.values()) > 0, "the parser dropped no 2026 rows (expected some)")
ok(all(v["date"] < "2026-01-01" for v in D["fights"].values()), "an exported fight is dated 2026+")

# 2. stacks
W = D["weights"]
for name in ("open_trained", "consensus", "close_trained"):
    for k in ("weights_fit_2019_2023", "weights_production_2019_2025"):
        b = W[name][k]
        ok(len(b) == 2 and all(x >= 0 for x in b), "%s %s: expected two non-negative weights" % (name, k))
    ok(W[name]["intercept"] is False, "intercept flag")
for v in D["test_vectors"]:
    zl, zm = logit(v["line"]), logit(v["ml2lr"])
    for name in W:
        for k in ("weights_fit_2019_2023", "weights_production_2019_2025"):
            b = W[name][k]
            p = sig(b[0] * zl + b[1] * zm)
            ps = sig(-b[0] * zl - b[1] * zm)
            ok(abs(p - v["%s|%s" % (name, k)]) < 1e-9, "test vector mismatch %s %s" % (name, k))
            ok(abs(p + ps - 1) < 1e-12, "corner swap")

# 3. pre-registrations and verdicts
ok("primary" in D["prereg"] and "secondaries" in D["prereg_addendum"], "pre-registrations missing")
va = D["validation_2024_2025"]
ok(va["first_look"]["primary_verdict"] in ("confirmed", "not confirmed", "not confirmed (CI upper > +0.0005)",
                                           "contradicted"), "primary verdict")
ok(va["addendum_look"]["as_run_verdict"] in ("confirmed", "not confirmed", "contradicted"), "addendum verdict")
ok(D["routing"]["decision"].startswith("keep fwd-4.1") == (va["first_look"]["primary_verdict"] == "contradicted"),
   "routing decision does not follow the pre-registered failure rule")

# 4. per-fight block
for fid, r in D["fights"].items():
    yr = int(r["date"][:4])
    ok(r["set"] == ("valid" if yr >= 2024 else ("oof" if yr >= 2021 else "train")), "set of %s" % fid)
    ok(all(p is not None and 0 < p < 1 for p in r["traj"] + r["traj_mult"]), "trajectory of %s" % fid)
    ok(abs(r["traj"][0] - r["traj_mult"][0]) < 1e-9, "opener de-vig of %s" % fid)
    for k, p in r.items():
        if k.startswith("p_") and p is not None:
            ok(0 < p < 1, "%s of %s" % (k, fid))
print("test_linemove: %d checks passed" % n_ok)
