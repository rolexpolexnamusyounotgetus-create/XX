#!/usr/bin/env python3
"""v6_look_wiring.py: the pre-registered wiring-abort check for the v6 validation look (data/derived/version_history.json,
entry v6, prereg.failure_criteria item 2), run on the harness output BEFORE anything is scored.

    python3 tools/v6_look_wiring.py data/derived/v6/look_val.json [--out data/derived/v6/look_val_wiring.json]

Outcome-blind: it reads only the wiring fields of each per-fight record (err, source, fit, variant, lineKind, lineMissing,
pool weight) and the package metadata; it never reads a result, so it computes no metric. Abort (exit 3) when:
  - any harness error (rec.err; the harness also records a simulator-cell mismatch across line kinds as an error);
  - any v6 open-regime row whose source is not 'ml2stack', whose fit is not 'Y2024' or whose method/round variant is not 'S2';
  - the frozen files in the harness metadata differ from the pre-registered hashes (prereg.files_sha256).
Also reported (not abort criteria): the same fields for every package and kind, and the open-regime row counts.
"""
import collections
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    path = sys.argv[1]
    out = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else None
    D = json.load(open(path))
    H = json.load(open(os.path.join(ROOT, "data/derived/version_history.json")))
    e = [v for v in H["versions"] if v["version"] == "v6"][0]
    pre = e["prereg"]["files_sha256"]
    meta = D["meta"]
    problems = []
    if meta["split"] != "val" or meta["range"] != ["2024-01-01", "2026-01-01"]:
        problems.append("not a 2024-25 validation run: %s %s" % (meta["split"], meta["range"]))
    if meta.get("sims_per_order") != 300:
        problems.append("sims per order %s, pre-registered 300" % meta.get("sims_per_order"))
    if "own" not in meta["inputs"]["input_pipelines"]:
        problems.append("input pipelines: %s (pre-registered: own)" % meta["inputs"]["input_pipelines"])
    pk = {p["name"]: p for p in meta["packages"]}
    v6 = [p for p in meta["packages"] if p["mode"] == "v6"][0]
    if v6["engine_sha256"] != pre["versions/v6/engine3.js"] or v6["params_sha256"] != pre["versions/v6/params3.js"] \
            or v6["blend_sha256"] != pre["versions/v6/ml/blend.js"]:
        problems.append("v6 package files differ from the pre-registered hashes")
    if meta["inputs"]["v6_stacks_sha256"] != pre["data/derived/v6_stacks.json"] or meta["inputs"]["mr_s2_sha256"] != pre["data/derived/mr_s2.json"]:
        problems.append("v6 stacks / S2 cells differ from the pre-registered hashes")
    cmp_ = [p for p in meta["packages"] if p["mode"] == "v5"][0]
    if cmp_["dir"] != "versions/v5.0.1-rejected":
        problems.append("comparator dir %s, pre-registered versions/v5.0.1-rejected" % cmp_["dir"])
    errs = [r["id"] for r in D["fights"] if r.get("err")]
    if errs:
        problems.append("%d harness errors, e.g. %s" % (len(errs), errs[:3]))
    cnt = collections.Counter()
    bad_open = []
    n_open_v6 = 0
    for r in D["fights"]:
        if r.get("err"):
            continue
        for name, kinds in r["pk"].items():
            for kind, x in kinds.items():
                cnt["%s|%s|%s|%s|%s|lineKind=%s|lineMissing=%s|w=%s" % (name, kind, x["source"], x["fit"], x["variant"], x["lineKind"],
                                                                      bool(x["lineMissing"]), x["w"])] += 1
                if name == v6["name"] and kind == "open":
                    n_open_v6 += 1
                    if x["source"] != "ml2stack" or x["fit"] != "Y2024" or x["variant"] != "S2":
                        bad_open.append((r["id"], x["source"], x["fit"], x["variant"]))
    if bad_open:
        problems.append("%d v6 open-regime rows not ml2stack / Y2024 / S2, e.g. %s" % (len(bad_open), bad_open[:3]))
    res = {"tool": "tools/v6_look_wiring.py", "input": os.path.relpath(path, ROOT), "n_fights": len(D["fights"]), "harness_errors": len(errs),
           "v6_open_rows": n_open_v6, "v6_open_rows_bad": len(bad_open), "fields": dict(sorted(cnt.items())),
           "abort": bool(problems), "problems": problems}
    for k, v in sorted(cnt.items()):
        print("  %-90s %d" % (k, v))
    print("WIRING:", "ABORT" if problems else "OK", problems)
    if out:
        json.dump(res, open(out, "w"), indent=1)
    sys.exit(3 if problems else 0)


if __name__ == "__main__":
    main()
