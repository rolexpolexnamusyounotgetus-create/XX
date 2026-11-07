#!/usr/bin/env python3
"""test_props_capture.py: the forward ledger's opt-in props capture (tools/props_ledger.py; engine v7 work,
docs/V6_V10_PLAN.md cycle 2 item 6). Recorded next to a ledger file, never scored. Checks: the A/B mirror (twice = identity,
m6 halves swap, Python = src/ml/blend.js mirrorProps), orientation of a reversed bout id, the newest snapshot before a lock,
and that the capture copies the snapshot's consensus (the one power de-vig) unchanged.
    python3 tests/test_props_capture.py"""
import datetime as dt
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import forward_ledger as FL  # noqa: E402
import props_ledger as PL  # noqa: E402

fails = 0


def check(name, ok, info=""):
    global fails
    print(("PASS  " if ok else "FAIL  ") + name + ("  (" + info + ")" if info else ""))
    fails += 0 if ok else 1


snaps = sorted(f for f in os.listdir(os.path.join(ROOT, "data/predictions")) if f.startswith("props_snapshot_"))
check("a props snapshot exists (tools/props.py capture)", bool(snaps), ", ".join(snaps))
S = json.load(open(os.path.join(ROOT, "data/predictions", snaps[-1])))
b0 = [b for b in S["bouts"] if b.get("bout_id") and (b.get("consensus") or {}).get("m6")][0]
c = b0["consensus"]
m = PL.mirror_props(c)
check("mirror swaps the m6 halves", m["m6"] == c["m6"][3:6] + c["m6"][0:3])
mm = PL.mirror_props(m)
check("mirror twice = identity (ml to 1e-15)", all(mm[k] == c[k] for k in c if k != "ml") and abs(mm.get("ml", 0) - c.get("ml", 0)) < 1e-15)
js = ("const FB=require(process.argv[1]);const c=JSON.parse(process.argv[2]);process.stdout.write(JSON.stringify(FB.mirrorProps(c)));")
out = json.loads(subprocess.run(["node", "-e", js, os.path.join(ROOT, "src/ml/blend.js"), json.dumps(c)], check=True, capture_output=True, text=True).stdout)
diff = max(abs(a - b) for k in ("m6", "wr", "mr", "itd") if k in c for a, b in zip(out[k], m[k]))
check("Python mirror = src/ml/blend.js mirrorProps", diff == 0 and abs(out.get("ml", 0) - m.get("ml", 0)) == 0, "max diff %g" % diff)
t = FL.parse_utc(S["meta"]["snapshot_utc"])
snapp = PL.latest_props_snapshot(os.path.join(ROOT, "data/predictions"), t + dt.timedelta(hours=1))
check("newest snapshot before a lock is found", snapp is not None and snapp[1].endswith(snaps[-1]))
check("a snapshot taken after the lock is not used", PL.latest_props_snapshot(os.path.join(ROOT, "data/predictions"), t - dt.timedelta(seconds=1), snaps[-1][len("props_snapshot_"):-5]) is None)
d0, rest = b0["bout_id"].split(":", 1)
sa, sb = rest.split("__", 1)
rev = "%s:%s__%s" % (d0, sb, sa)
doc = PL.capture_doc(snapp, [b0["bout_id"], rev, "2099-01-01:nobody__no-one"], None, "test.json", t + dt.timedelta(hours=1))
r0, r1, r2 = doc["bouts"]
check("found bout: consensus copied unchanged", r0["found"] and not r0["flipped_from_snapshot"] and r0["consensus"]["m6"] == c["m6"])
check("reversed bout id: found, flagged, mirrored", r1["found"] and r1["flipped_from_snapshot"] and r1["consensus"]["m6"] == c["m6"][3:6] + c["m6"][0:3])
check("unknown bout: recorded as not found", (not r2["found"]) and r2["consensus"] is None and not r2["has_method_props"])
check("capture says it is never scored", "never scored" in doc["meta"]["tool"] and doc["n_with_method_props"] == 2)
print("%d failed" % fails)
sys.exit(1 if fails else 0)
